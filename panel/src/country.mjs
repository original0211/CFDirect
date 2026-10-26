// CFDirect 国家节点池（仿 CFNext 的按国家分组展现）：
// 数据源 = bestcf 地区列表（FALLBACK_LISTS）为主：2026-10-26 逐区实测 bestcf
// random-region 共 25 区可用（含欧洲 18 国），行内自带「德国 DE | FRA」式标注。
// wetest_v4 补量路保留（其实测只能解析出少量无名条目、无地区标注，基本为空）。
// 拉取通道与解析器全部复用 optimizer.mjs（fetchText / parseCandidateText / formatEntry），不另造轮子。
// 全程 fail-open：单区失败跳过该区、wetest 失败只少补量、全部失败返回 null（订阅走原流程）。
// 另有 via-proxy 混合模式（countryViaProxy）：RG_REGIONS（内核 ProxyIP 池覆盖的
// 10 国）每区一条统一入口域名行 + @RG 地区标记，国家由内核按 rg 选 ProxyIP 出口
// 实现；池外地区照旧走经典反代 IP 池（详见 buildCountryPool 内分工）。
import {
  FALLBACK_LISTS, OPTIMIZER_SOURCES, REGION_ALIASES,
  fetchText, parseCandidateText, formatEntry, isCloudflareIp
} from './optimizer.mjs';
import { isIP } from 'node:net';
import { fetchPublicTextFetch, resolveHostViaDoh } from './outbound-fetch.mjs';
import { outboundMode } from './runtime.mjs';

// 共享 DoH 解析器（按 host 记忆）：fetch 运行时每次受防护拉取都要先做 A+AAAA 两次
// DoH 子请求，25 个地区列表同属一个 host，若逐个解析，光解析就 50 个子请求、
// 直接撞穿 Workers 免费版「每请求 50 子请求」上限（2026-10-26 线上实测：扩到
// 25 区后国家池全灭、订阅 fail-open 回基线）。同一轮构建内同 host 只解析一次。
export function createSharedResolver(baseResolve = resolveHostViaDoh) {
  const cache = new Map();
  return host => {
    if (!cache.has(host)) cache.set(host, Promise.resolve().then(() => baseResolve(host)));
    return cache.get(host);
  };
}

// 数据源覆盖的 25 个地区：代码 → 旗帜 + 中文名（节点命名与控制台文案共用口径）。
export const COUNTRY_REGIONS = {
  HK: { flag: '🇭🇰', name: '香港' },
  JP: { flag: '🇯🇵', name: '日本' },
  KR: { flag: '🇰🇷', name: '韩国' },
  SG: { flag: '🇸🇬', name: '新加坡' },
  TW: { flag: '🇹🇼', name: '台湾' },
  US: { flag: '🇺🇸', name: '美国' },
  CA: { flag: '🇨🇦', name: '加拿大' },
  DE: { flag: '🇩🇪', name: '德国' },
  FR: { flag: '🇫🇷', name: '法国' },
  GB: { flag: '🇬🇧', name: '英国' },
  NL: { flag: '🇳🇱', name: '荷兰' },
  SE: { flag: '🇸🇪', name: '瑞典' },
  ES: { flag: '🇪🇸', name: '西班牙' },
  IT: { flag: '🇮🇹', name: '意大利' },
  PL: { flag: '🇵🇱', name: '波兰' },
  CH: { flag: '🇨🇭', name: '瑞士' },
  FI: { flag: '🇫🇮', name: '芬兰' },
  CZ: { flag: '🇨🇿', name: '捷克' },
  AT: { flag: '🇦🇹', name: '奥地利' },
  DK: { flag: '🇩🇰', name: '丹麦' },
  IE: { flag: '🇮🇪', name: '爱尔兰' },
  NO: { flag: '🇳🇴', name: '挪威' },
  BE: { flag: '🇧🇪', name: '比利时' },
  PT: { flag: '🇵🇹', name: '葡萄牙' },
  AU: { flag: '🇦🇺', name: '澳大利亚' }
};
export const DEFAULT_COUNTRY_REGIONS = Object.keys(COUNTRY_REGIONS);
export const DEFAULT_COUNTRY_PER_REGION = 8;
export const DEFAULT_COUNTRY_ENTRY_DOMAIN = 'saas.sin.fan';

// 内核 ProxyIP 兜底池真实覆盖（内核侧 2026-10-26 实测）：只有这 10 个地区各有
// 1 个候选；CeL(地区) 对池外地区永不返回空、会按全局序给出别国候选——即给池外
// 地区发 rg 标记，出口必然不是标注的国家，是假的。故 via-proxy（@RG）只对这
// 10 区启用，其余地区在 via-proxy 模式下仍走经典反代 IP 池（混合模式）。
export const RG_REGIONS = ['HK', 'JP', 'KR', 'SG', 'US', 'DE', 'GB', 'NL', 'SE', 'FI'];

const TRUTHY = value => ['yes', 'true', '1', 'on'].includes(String(value ?? '').trim().toLowerCase());

// 统一入口域名清洗（与 engine.mjs 的清洗国家入口域名同口径）：只接受合法主机名
// （至少两段、全小写、无端口/路径/空格），非法回落默认 saas.sin.fan。
const ENTRY_DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export function sanitizeCountryEntryDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  return ENTRY_DOMAIN_RE.test(domain) ? domain : DEFAULT_COUNTRY_ENTRY_DOMAIN;
}

// 地区清洗：大写、只留数据源覆盖的代码、去重保序；清洗后为空回落默认 7 区。
export function sanitizeCountryRegions(value) {
  const out = [];
  for (const piece of String(value ?? '').toUpperCase().split(/[^A-Z]+/)) {
    if (piece && Object.hasOwn(COUNTRY_REGIONS, piece) && !out.includes(piece)) out.push(piece);
  }
  return out.length ? out : [...DEFAULT_COUNTRY_REGIONS];
}

// 每区数量清洗：非数字回落默认 8，数字钳制 1–20。
export function clampCountryPerRegion(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return DEFAULT_COUNTRY_PER_REGION;
  return Math.min(20, Math.max(1, n));
}

// CFNext 风格命名：<旗> <中文名>-<两位序号>，如「🇯🇵 日本-01」。
export function countryNodeName(region, index) {
  const meta = COUNTRY_REGIONS[region];
  return meta.flag + ' ' + meta.name + '-' + String(index + 1).padStart(2, '0');
}

let countryCache = { key: '', at: 0, value: null };
let lastGoodCountry = null;

// 缓存键（buildCountryPool 与 resolveCountryYx 的 lastGood 回退共用，保证同口径）：
// 带模式标签，避免池模式与 via-proxy 模式同地区配置下互相串味。
function countryCacheKey(config = {}) {
  const regions = sanitizeCountryRegions(config.countryRegions).join(',');
  if (TRUTHY(config.countryViaProxy)) return JSON.stringify(['hybrid', regions, clampCountryPerRegion(config.countryPerRegion), sanitizeCountryEntryDomain(config.countryEntryDomain)]);
  return JSON.stringify(['pool', regions, clampCountryPerRegion(config.countryPerRegion)]);
}

// 国家池构建：返回 yx 格式文本（每行 ip:port#名），无可用节点时返回 null。
// deps 与 optimizer 同口径：{ fetchImpl, now, noCache, resetCache }，fetchImpl 缺省走受防护拉取。
export async function buildCountryPool(config = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || null;
  const now = deps.now || Date.now();
  const regions = sanitizeCountryRegions(config.countryRegions);
  const per = clampCountryPerRegion(config.countryPerRegion);
  const cacheKey = countryCacheKey(config);
  if (deps.resetCache) { countryCache = { key: '', at: 0, value: null }; lastGoodCountry = null; }
  if (!deps.noCache && countryCache.value && countryCache.key === cacheKey && now - countryCache.at < 600000) return countryCache.value;

  // 混合模式分工（countryViaProxy=yes 时）：RG_REGIONS 内的地区出「统一入口
  // 域名 + @RG 标记」行（每区一条，入口走 Anycast 优选域名、国家由内核按 rg
  // 选 ProxyIP 出口实现）；RG_REGIONS 外的地区内核 ProxyIP 池没有候选、发 rg
  // 只会拿到别国出口（假国家），故照旧走下面的经典池构建（真实反代 IP）。
  // countryViaProxy=no 时 rgSet 为空，全部地区走经典池，与原行为一致。
  const viaProxy = TRUTHY(config.countryViaProxy);
  const rgSet = new Set(viaProxy ? regions.filter(region => RG_REGIONS.includes(region)) : []);
  const classicRegions = regions.filter(region => !rgSet.has(region));
  const entryDomain = sanitizeCountryEntryDomain(config.countryEntryDomain);

  // 经典池部分：只为 classicRegions 拉 bestcf/wetest（全部地区都是 rg 地区时
  // 一次远程拉取都不发，纯本地生成）。
  const classicByRegion = {};
  if (classicRegions.length) {
    const sharedResolveHost = createSharedResolver();
    const fetchListText = (url, timeoutMs) => {
      if (fetchImpl) return fetchText(fetchImpl, url, timeoutMs);
      if (outboundMode() === 'fetch') return fetchPublicTextFetch(url, { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs, resolveHost: sharedResolveHost });
      return fetchText(null, url, timeoutMs);
    };

    // wetest 全量池只拉一次，跨地区共享；失败静默（补量路断了还有 bestcf 主路）。
    let wetestEntries = [];
    try {
      const text = await fetchListText(OPTIMIZER_SOURCES.wetest_v4.url, 6000);
      wetestEntries = parseCandidateText(text, 443);
    } catch { /* 补量源失败不影响主路 */ }
    const wetestFor = region => {
      const aliases = (REGION_ALIASES[region] || [region]).map(a => a.toUpperCase());
      return wetestEntries.filter(entry => {
        if (!entry.name) return false;
        // 与优选引擎预设模式同口径：IP 条目须落在 CF 地址段内（域名条目豁免）。
        if (isIP(String(entry.ip).replace(/^\[|\]$/g, '')) && !isCloudflareIp(entry.ip)) return false;
        const up = entry.name.toUpperCase();
        return aliases.some(a => up.includes(a));
      });
    };

    await Promise.all(classicRegions.map(async region => {
      const entries = [];
      const seen = new Set();
      const add = (ip, port) => {
        const key = String(ip).toLowerCase();
        if (!ip || seen.has(key) || entries.length >= per) return;
        seen.add(key);
        entries.push({ ip, port: port || 443 });
      };
      // 主路：bestcf 地区列表。真实行格式是「IP:端口#地区随机 | 日本 JP | KIX | …」
      //（2026-10-26 线上实测），必须走 parseCandidateText 解析——早期版本用裸 IP
      // 正则逐行匹配，线上零命中、主路全灭，只剩 wetest 补量在撑（已修复并加回归用例）。
      const list = FALLBACK_LISTS.find(item => item.region === region);
      if (list) {
        try {
          const text = await fetchListText(list.url, 8000);
          for (const entry of parseCandidateText(text, 443)) add(entry.ip, entry.port);
        } catch { /* 单区失败跳过该区 */ }
      }
      // 补量：wetest 同地区条目（按备注名别名归属）。
      if (entries.length < per) for (const entry of wetestFor(region)) add(entry.ip, entry.port);
      classicByRegion[region] = entries.map((entry, index) => formatEntry({ ...entry, name: countryNodeName(region, index) }));
    }));
  }

  // 按配置地区顺序逐区拼接：rg 地区一行、经典地区 per 条，两部分交错保序。
  // fail-open：经典部分全失败时只要有 rg 行仍算成功池（非 null）；两者皆空才 null。
  const merged = [];
  for (const region of regions) {
    if (rgSet.has(region)) {
      const meta = COUNTRY_REGIONS[region];
      merged.push(formatEntry({ ip: entryDomain, port: 443, name: meta.flag + ' ' + meta.name + '@' + region }));
    } else if (classicByRegion[region]) {
      merged.push(...classicByRegion[region]);
    }
  }
  const value = merged.length ? merged.join('\n') : null;
  countryCache = { key: cacheKey, at: now, value };
  if (value) lastGoodCountry = { key: cacheKey, value };
  return value;
}

// 高层入口（server.mjs 在订阅请求时调用，优先级高于 resolveOptimizerYx）：
// countryNodes 未开启或池构建失败/为空 → 返回 null（调用方完全走原流程）。
// 构建异常时回退同配置的上次成功池（lastGood），再无则 null；绝不抛错阻断订阅生成。
export async function resolveCountryYx(config = {}, deps = {}) {
  try {
    if (!TRUTHY(config.countryNodes)) return null;
    let built = null;
    try { built = await buildCountryPool(config, deps); }
    catch (error) { console.warn('[cfdirect] 国家节点池构建异常，回退原优选流程:', error.message); }
    if (built) return built;
    const key = countryCacheKey(config);
    if (lastGoodCountry && lastGoodCountry.key === key) return lastGoodCountry.value;
    return null;
  } catch (error) {
    console.warn('[cfdirect] 国家节点解析异常，回退原优选流程:', error.message);
    return null;
  }
}
