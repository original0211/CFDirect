// CFDirect 国家节点单测：builder 全部用 fixture deps 假拉取（零外网），
// 集成部分与 core-stats 同夹具口径（本地 HTTP 托管内核 fixture、KV 直接种子配置，
// 国家池拉取经 globalThis.__CFDIRECT_COUNTRY_DEPS__ 注入假实现）。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COUNTRY_REGIONS, buildCountryPool, resolveCountryYx,
  sanitizeCountryRegions, clampCountryPerRegion, countryNodeName,
  sanitizeCountryEntryDomain
} from '../country.mjs';
import { createSubscriptionEngine } from '../engine.mjs';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';

// bestcf 地区列表（行格式与真实源一致：裸 IPv4 或 IPv4:端口）
const BESTCF = {
  HK: ['104.16.11.1', '104.16.11.2', '104.16.11.3', '104.16.11.4'].join('\n'),
  JP: new Error('jp list down'),
  US: ['104.16.13.1:8443', '104.16.13.2'].join('\n'),
  SG: '104.16.14.1',
  TW: ''
};
// wetest_v4 页面：结构化条目带地区备注（含非 CF 地址、他区条目、无名裸 IP 噪声）
const WETEST_PAGE = [
  '104.17.20.2#JP 电信',
  '104.17.20.3:8443#JP 移动',
  '104.17.20.4#US 联通',
  '8.8.8.8:443#JP 移动',
  '104.17.20.5#KR 电信',
  '104.17.20.6#香港 移动',
  '<p>裸地址 104.18.40.4 也在文本里</p>'
].join('\n');

function fakeFetch(routes) {
  return async url => {
    const key = Object.keys(routes).find(k => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => '' };
    const value = routes[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, text: async () => value };
  };
}
const goodFetch = () => fakeFetch({
  'random-region/HK': BESTCF.HK, 'random-region/JP': BESTCF.JP,
  'random-region/US': BESTCF.US, 'random-region/SG': BESTCF.SG, 'random-region/TW': BESTCF.TW,
  'wetest.vip': WETEST_PAGE
});
const downFetch = async () => { throw new Error('all down'); };

test('sanitizeCountryRegions：清洗、去重保序、非法回落默认', () => {
  assert.deepEqual(sanitizeCountryRegions('jp, hk,XX,JP'), ['JP', 'HK']);
  assert.deepEqual(sanitizeCountryRegions(''), ['HK', 'JP', 'KR', 'SG', 'TW', 'US', 'CA', 'DE', 'FR', 'GB', 'NL', 'SE', 'ES', 'IT', 'PL', 'CH', 'FI', 'CZ', 'AT', 'DK', 'IE', 'NO', 'BE', 'PT', 'AU']);
  assert.deepEqual(sanitizeCountryRegions('XX,YY'), ['HK', 'JP', 'KR', 'SG', 'TW', 'US', 'CA', 'DE', 'FR', 'GB', 'NL', 'SE', 'ES', 'IT', 'PL', 'CH', 'FI', 'CZ', 'AT', 'DK', 'IE', 'NO', 'BE', 'PT', 'AU']);
  assert.deepEqual(sanitizeCountryRegions(undefined), ['HK', 'JP', 'KR', 'SG', 'TW', 'US', 'CA', 'DE', 'FR', 'GB', 'NL', 'SE', 'ES', 'IT', 'PL', 'CH', 'FI', 'CZ', 'AT', 'DK', 'IE', 'NO', 'BE', 'PT', 'AU']);
  assert.deepEqual(sanitizeCountryRegions('de'), ['DE']);
});

test('clampCountryPerRegion：默认 8、钳制 1–20', () => {
  assert.equal(clampCountryPerRegion(''), 8);
  assert.equal(clampCountryPerRegion('abc'), 8);
  assert.equal(clampCountryPerRegion('0'), 1);
  assert.equal(clampCountryPerRegion('-3'), 1);
  assert.equal(clampCountryPerRegion('99'), 20);
  assert.equal(clampCountryPerRegion('5'), 5);
});

test('countryNodeName：CFNext 风格旗帜 + 中文名 + 两位序号', () => {
  assert.equal(countryNodeName('JP', 0), '🇯🇵 日本-01');
  assert.equal(countryNodeName('HK', 9), '🇭🇰 香港-10');
  assert.equal(COUNTRY_REGIONS.KR.flag, '🇰🇷');
  assert.equal(COUNTRY_REGIONS.DE.name, '德国');
});

test('buildCountryPool：多区成功、bestcf 截断、wetest 补量与别名归属', async () => {
  const text = await buildCountryPool(
    { countryRegions: 'HK,JP,US,KR,DE', countryPerRegion: '3' },
    { fetchImpl: goodFetch(), noCache: true }
  );
  const lines = text.split('\n');
  const names = lines.map(l => l.split('#')[1]);
  // HK：bestcf 4 条截断到 3
  assert.deepEqual(names.filter(n => n.startsWith('🇭🇰')), ['🇭🇰 香港-01', '🇭🇰 香港-02', '🇭🇰 香港-03']);
  // JP：bestcf 失败 → wetest 补量（JP 电信/JP 移动两条；8.8.8.8 非 CF 段被滤）
  assert.deepEqual(names.filter(n => n.startsWith('🇯🇵')), ['🇯🇵 日本-01', '🇯🇵 日本-02']);
  assert.ok(lines.some(l => l.startsWith('104.17.20.3:8443#🇯🇵 日本-02')), 'wetest 条目端口应保留');
  // US：bestcf 2 条（端口保留）+ wetest US 联通补 1 条
  assert.deepEqual(names.filter(n => n.startsWith('🇺🇸')), ['🇺🇸 美国-01', '🇺🇸 美国-02', '🇺🇸 美国-03']);
  assert.ok(lines.some(l => l.startsWith('104.16.13.1:8443#🇺🇸 美国-01')));
  // KR：无 bestcf 列表，只走 wetest（KR 电信）
  assert.deepEqual(names.filter(n => n.startsWith('🇰🇷')), ['🇰🇷 韩国-01']);
  // DE：两路皆无数据 → 整区跳过，不产生空行
  assert.ok(!names.some(n => n.startsWith('🇩🇪')));
  // 输出顺序与配置地区顺序一致
  assert.ok(names[0].startsWith('🇭🇰') && names.at(-1).startsWith('🇰🇷'));
});

test('buildCountryPool：单区失败跳过、全失败返回 null', async () => {
  const partial = await buildCountryPool(
    { countryRegions: 'JP,SG', countryPerRegion: '8' },
    { fetchImpl: fakeFetch({ 'random-region/SG': BESTCF.SG, 'wetest.vip': new Error('wetest down') }), noCache: true }
  );
  assert.equal(partial, '104.16.14.1:443#🇸🇬 新加坡-01');
  const none = await buildCountryPool(
    { countryRegions: 'HK,JP,KR,SG,TW,US,CA,DE,FR,GB,NL,SE,ES,IT,PL,CH,FI,CZ,AT,DK,IE,NO,BE,PT,AU', countryPerRegion: '8' },
    { fetchImpl: downFetch, noCache: true }
  );
  assert.equal(none, null);
});

test('resolveCountryYx：未开启不拉取直接 null；全失败 fail-open 返回 null', async () => {
  let calls = 0;
  const counting = async () => { calls++; throw new Error('down'); };
  assert.equal(await resolveCountryYx({ countryNodes: 'no' }, { fetchImpl: counting, noCache: true, resetCache: true }), null);
  assert.equal(calls, 0, '未开启时不应发起任何拉取');
  assert.equal(await resolveCountryYx({ countryNodes: 'yes', countryRegions: 'HK', countryPerRegion: '2' }, { fetchImpl: counting, noCache: true }), null);
});

test('resolveCountryYx：构建失败时回退上次成功池（lastGood）', async () => {
  const config = { countryNodes: 'yes', countryRegions: 'SG', countryPerRegion: '8' };
  const first = await resolveCountryYx(config, { fetchImpl: goodFetch(), noCache: true, resetCache: true });
  assert.equal(first, '104.16.14.1:443#🇸🇬 新加坡-01');
  const second = await resolveCountryYx(config, { fetchImpl: downFetch, noCache: true });
  assert.equal(second, first);
});

test('引擎默认值与国家字段清洗（整理有效配置口径）', () => {
  const defaults = createSubscriptionEngine({}, UUID).defaults;
  assert.equal(defaults.countryNodes, 'no');
  assert.equal(defaults.countryRegions, 'HK,JP,KR,SG,TW,US,CA,DE,FR,GB,NL,SE,ES,IT,PL,CH,FI,CZ,AT,DK,IE,NO,BE,PT,AU');
  assert.equal(defaults.countryPerRegion, '8');
});

// —— 订阅集成：经 handlePanel + 内核 fixture，KV 种子配置 ——
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('../../test/core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];?/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

async function fixture(run) {
  const values = new Map();
  const storage = { get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, value) => values.set(key, value) };
  const server = createServer(async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const response = await worker.fetch(new Request('http://' + incoming.headers.host + incoming.url, { method: incoming.method, ...(body.length ? { body } : {}) }), { u: UUID, C: storage });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = 'http://127.0.0.1:' + server.address().port;
  const seed = config => values.set('c', JSON.stringify(config));
  const sub = target => handlePanel(new Request('https://panel.example/sub?uuid=' + UUID + '&host=' + encodeURIComponent(host) + '&target=' + target));
  try { await run({ seed, sub }); }
  finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}

const BASE_SEED = { ae: 'yes', yx: '104.16.1.1:443#手填节点', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' };

test('订阅集成：countryNodes 开启后 clash 出现国家节点、手填追加在后', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE_SEED, countryNodes: 'yes', countryRegions: 'JP', countryPerRegion: '2' });
  globalThis.__CFDIRECT_COUNTRY_DEPS__ = {
    fetchImpl: fakeFetch({
      'random-region/JP': ['104.16.21.1', '104.16.21.2', '104.16.21.3'].join('\n'),
      'wetest.vip': new Error('wetest down')
    }),
    noCache: true, resetCache: true
  };
  try {
    const response = await sub('clash');
    assert.equal(response.status, 200);
    const yaml = await response.text();
    // yx 层节点名是「🇯🇵 日本-01」；clash 输出经引擎既有命名管线渲染
    // （空格→下划线、再追加引擎自己的 -NN 序号后缀，对所有 yx 节点同口径，
    // 如手填节点渲染为「手填节点-01」），故按渲染形态断言。
    assert.ok(yaml.includes('🇯🇵_日本-01'), '应出现国家节点 日本-01');
    assert.ok(yaml.includes('🇯🇵_日本-02'), '应出现国家节点 日本-02');
    assert.ok(!yaml.includes('🇯🇵_日本-03'), '每区截断到 2，不应出现 日本-03');
    assert.ok(yaml.includes('手填节点'), '手填 yx 应追加保留');
    assert.ok(yaml.indexOf('🇯🇵_日本-01') < yaml.indexOf('手填节点'), '国家节点应在手填之前（为主）');
  } finally { delete globalThis.__CFDIRECT_COUNTRY_DEPS__; }
}));

test('订阅集成：countryNodes 关闭时与现状一致（无国家节点）', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE_SEED });
  const response = await sub('clash');
  assert.equal(response.status, 200);
  const yaml = await response.text();
  assert.ok(yaml.includes('手填节点'));
  assert.ok(!yaml.includes('日本-01'), '关闭时不应出现国家节点');
}));

test('订阅集成：国家池全失败 fail-open，回退手填流程', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE_SEED, countryNodes: 'yes', countryRegions: 'JP', countryPerRegion: '2' });
  globalThis.__CFDIRECT_COUNTRY_DEPS__ = { fetchImpl: downFetch, noCache: true, resetCache: true };
  try {
    const response = await sub('clash');
    assert.equal(response.status, 200);
    const yaml = await response.text();
    assert.ok(yaml.includes('手填节点'), '全失败时应回退手填节点');
    assert.ok(!yaml.includes('日本-01'));
  } finally { delete globalThis.__CFDIRECT_COUNTRY_DEPS__; }
}));

test('控制台渲染：国家节点控件存在、旧内核禁用、新内核可操作', async () => {
  for (const config of [{ countryNodes: 'yes', countryRegions: 'JP', countryPerRegion: '2' }, {}]) {
    const html = await (await createSubscriptionEngine(config, UUID).render(new Request('https://worker.example/' + UUID))).text();
    const supported = Object.hasOwn(config, 'countryNodes');
    const box = html.match(/<input[^>]*id="countryNodes"[^>]*>/)[0];
    assert.equal(box.includes('disabled'), !supported);
    assert.ok(html.includes('id="countryRegions"'));
    assert.ok(html.includes('id="countryPerRegion"'));
    assert.ok(html.includes('id="countrySection"'));
    assert.ok(html.includes('覆盖 7 个地区') || html.includes('cover 7 regions') || html.includes('国家节点'));
    for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
  }
});

test('buildCountryPool：真实 bestcf 行格式（IP:端口#地区随机 | 日本 JP | KIX | …）可解析', async () => {
  // 2026-10-26 线上实测的 bestcf random-region 真实返回行（IP 已替换为 CF 段内示例）
  const realList = [
    '104.16.30.1:443#地区随机 | 日本 JP | KIX | 104.16.30.1:443',
    '104.16.30.2:8443#地区随机 | 日本 JP | NRT | 104.16.30.2:8443',
    '104.16.30.3:443#地区随机 | 日本 JP | NRT | 104.16.30.3:443'
  ].join('\n');
  const fetchImpl = fakeFetch({ 'random-region/JP': realList, 'wetest.vip': '' });
  const yx = await buildCountryPool(
    { countryRegions: 'JP', countryPerRegion: '8' },
    { fetchImpl, resetCache: true, noCache: true }
  );
  assert.ok(yx, '真实格式应产出非空池');
  const lines = yx.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('104.16.30.1:443#🇯🇵 日本-01'), lines[0]);
  assert.ok(lines[1].startsWith('104.16.30.2:8443#🇯🇵 日本-02'), lines[1]);
});

test('createSharedResolver：同 host 只解析一次（防子请求上限打穿）', async () => {
  const { createSharedResolver } = await import('../country.mjs');
  let calls = 0;
  const resolver = createSharedResolver(async host => { calls++; return ['93.184.216.34']; });
  const [a, b] = await Promise.all([resolver('bestcf.pages.dev'), resolver('bestcf.pages.dev')]);
  await resolver('bestcf.pages.dev');
  await resolver('www.wetest.vip');
  assert.deepEqual(a, ['93.184.216.34']);
  assert.deepEqual(b, ['93.184.216.34']);
  assert.equal(calls, 2, '两个 host 各解析一次，重复 host 命中缓存');
});

test('sanitizeCountryEntryDomain：合法主机名保留、非法回落默认', () => {
  assert.equal(sanitizeCountryEntryDomain('saas.sin.fan'), 'saas.sin.fan');
  assert.equal(sanitizeCountryEntryDomain('EXAMPLE.com.'), 'example.com');
  assert.equal(sanitizeCountryEntryDomain(' a.b-c.example-domain.org '), 'a.b-c.example-domain.org');
  assert.equal(sanitizeCountryEntryDomain('https://bad.example/x'), 'saas.sin.fan');
  assert.equal(sanitizeCountryEntryDomain('bad_domain'), 'saas.sin.fan');
  assert.equal(sanitizeCountryEntryDomain('example.com:443'), 'saas.sin.fan');
  assert.equal(sanitizeCountryEntryDomain(''), 'saas.sin.fan');
  assert.equal(sanitizeCountryEntryDomain(undefined), 'saas.sin.fan');
});

test('buildCountryPool：via-proxy 模式不拉源、每区一条 @RG 行、per 不生效', async () => {
  let calls = 0;
  const counting = async () => { calls++; throw new Error('via-proxy 不应拉取任何源'); };
  const yx = await buildCountryPool(
    { countryRegions: 'DE,JP', countryViaProxy: 'yes', countryEntryDomain: 'saas.sin.fan', countryPerRegion: '20' },
    { fetchImpl: counting, noCache: true, resetCache: true }
  );
  assert.equal(calls, 0, 'via-proxy 模式不得发起拉取');
  assert.equal(yx, 'saas.sin.fan:443#🇩🇪 德国@DE\nsaas.sin.fan:443#🇯🇵 日本@JP');
  const custom = await buildCountryPool(
    { countryRegions: 'DE', countryViaProxy: 'yes', countryEntryDomain: 'Example.COM.' },
    { fetchImpl: counting, noCache: true }
  );
  assert.equal(custom, 'example.com:443#🇩🇪 德国@DE');
  const fallback = await buildCountryPool(
    { countryRegions: 'DE', countryViaProxy: 'yes', countryEntryDomain: 'not a domain' },
    { fetchImpl: counting, noCache: true }
  );
  assert.equal(fallback, 'saas.sin.fan:443#🇩🇪 德国@DE');
});

test('resolveCountryYx：countryViaProxy 开但 countryNodes 关 → null；双开走 via-proxy', async () => {
  const off = await resolveCountryYx(
    { countryNodes: 'no', countryViaProxy: 'yes', countryRegions: 'DE' },
    { fetchImpl: downFetch, noCache: true }
  );
  assert.equal(off, null);
  const on = await resolveCountryYx(
    { countryNodes: 'yes', countryViaProxy: 'yes', countryRegions: 'DE', countryEntryDomain: 'saas.sin.fan' },
    { fetchImpl: downFetch, noCache: true }
  );
  assert.equal(on, 'saas.sin.fan:443#🇩🇪 德国@DE');
});

test('引擎默认值：countryViaProxy/countryEntryDomain', () => {
  const defaults = createSubscriptionEngine({}, UUID).defaults;
  assert.equal(defaults.countryViaProxy, 'no');
  assert.equal(defaults.countryEntryDomain, 'saas.sin.fan');
});

test('yx 地区标记 @RG：三协议 path 透传 rg、显示名去后缀、无标记与频道名不变', async () => {
  const yx = [
    '104.16.1.1:443#德国出口@DE',
    '104.16.1.2:443#普通节点',
    '104.16.1.3:443#加入频道@kejiland00-443-WS-TLS',
    'saas.sin.fan:443#域名节点@JP',
    'example.org:443#无标记域名'
  ].join('\n');
  const engine = createSubscriptionEngine(
    { ae: 'yes', epd: 'yes', epi: 'yes', egi: 'no', ena: 'no', ev: 'yes', et: 'yes', ex: 'yes', yx },
    UUID
  );
  const response = await engine.subscribe(new Request('https://worker.example/' + UUID + '/sub?target=base64'));
  assert.equal(response.status, 200);
  const links = Buffer.from(await response.text(), 'base64').toString('utf8').trim().split('\n').map(l => new URL(l));
  const pick = host => links.filter(l => l.hostname === host);
  const nameOf = l => decodeURIComponent(l.hash.slice(1));
  // IP 条目带标记：vless/trojan 的 WS path 尾追加 &rg=DE，xhttp 以 ?rg=DE 挂查询
  const de = pick('104.16.1.1');
  assert.equal(de.length, 3, 'DE 条目应生成 vless/trojan/xhttp 三条');
  for (const l of de) {
    const p = l.searchParams.get('path');
    if (l.searchParams.get('type') === 'xhttp') assert.equal(p, '/351c9981?rg=DE');
    else assert.equal(p, '/?ed=2048&rg=DE');
    assert.ok(nameOf(l).startsWith('德国出口'), '显示名应去掉 @DE 后缀：' + nameOf(l));
    assert.ok(!nameOf(l).includes('@'), '显示名不得残留 @');
  }
  // 无标记条目：path 逐字不变、无 rg
  const plain = pick('104.16.1.2');
  assert.equal(plain.length, 3);
  for (const l of plain) {
    const p = l.searchParams.get('path');
    if (l.searchParams.get('type') === 'xhttp') assert.equal(p, '/351c9981');
    else assert.equal(p, '/?ed=2048');
  }
  // 名称含 @ 但后缀不是两位大写码：不解析为标记，名称与 path 均不变
  const channel = pick('104.16.1.3');
  assert.equal(channel.length, 3);
  for (const l of channel) {
    assert.ok(nameOf(l).includes('@kejiland00-443-WS-TLS'), '频道名应原样保留：' + nameOf(l));
    assert.ok(!l.searchParams.get('path').includes('rg='));
  }
  // 无标记域名条目：命名管线不变，仍为「优选域名-NN」，path 无 rg
  const plainDomain = pick('example.org');
  assert.equal(plainDomain.length, 3);
  for ( const l of plainDomain ) {
    assert.ok(nameOf(l).startsWith('优选域名'), '无标记域名应仍为优选域名-NN：' + nameOf(l));
    assert.ok(!l.searchParams.get('path').includes('rg='));
  }
  // 域名条目带标记：rg 同样透传（经域名列表映射不丢失）
  const domain = pick('saas.sin.fan');
  assert.equal(domain.length, 3, '域名条目应生成三条');
  for (const l of domain) {
    const p = l.searchParams.get('path');
    if (l.searchParams.get('type') === 'xhttp') assert.equal(p, '/351c9981?rg=JP');
    else assert.equal(p, '/?ed=2048&rg=JP');
    // 带 rg 的域名条目保留显示名（国家身份必须在名字里可见，主线命名修复口径）；
    // 无 rg 的域名条目仍走既有管线渲染为「优选域名-NN」（见下方无标记域名断言）。
    assert.ok(nameOf(l).startsWith('域名节点'), 'rg 域名条目应保留显示名：' + nameOf(l));
    assert.ok(!nameOf(l).includes('@'));
  }
});

test('buildCountryPool：混合模式——RG 地区出入口行、池外地区（FR）走经典池且不带标记', async () => {
  const routes = fakeFetch({
    'random-region/FR': ['104.16.31.1', '104.16.31.2', '104.16.31.3'].join('\n'),
    'wetest.vip': new Error('wetest down')
  });
  let calls = 0;
  const counting = async url => { calls++; return routes(url); };
  const yx = await buildCountryPool(
    { countryRegions: 'DE,FR', countryViaProxy: 'yes', countryEntryDomain: 'saas.sin.fan', countryPerRegion: '2' },
    { fetchImpl: counting, noCache: true, resetCache: true }
  );
  assert.ok(calls > 0, '含池外地区时应拉取经典池来源');
  const lines = yx.split('\n');
  // 顺序按配置地区：DE（rg 行）在前，FR（经典行）随后
  assert.equal(lines[0], 'saas.sin.fan:443#🇩🇪 德国@DE');
  const frLines = lines.slice(1);
  assert.deepEqual(frLines, ['104.16.31.1:443#🇫🇷 法国-01', '104.16.31.2:443#🇫🇷 法国-02']);
  assert.ok(frLines.every(l => !l.includes('@')), '经典池行不得带 @RG 标记（池外发 rg 是假国家）');
  // fail-open：经典部分全失败时只剩 rg 行，仍是成功池（非 null）
  const partial = await buildCountryPool(
    { countryRegions: 'DE,FR', countryViaProxy: 'yes', countryEntryDomain: 'saas.sin.fan', countryPerRegion: '2' },
    { fetchImpl: downFetch, noCache: true }
  );
  assert.equal(partial, 'saas.sin.fan:443#🇩🇪 德国@DE');
});

test('RG_REGIONS：与内核 ProxyIP 池覆盖口径一致（10 国）', async () => {
  const { RG_REGIONS } = await import('../country.mjs');
  assert.deepEqual([...RG_REGIONS].sort(), ['DE', 'FI', 'GB', 'HK', 'JP', 'KR', 'NL', 'SE', 'SG', 'US']);
});

test('控制台渲染：via-proxy 控件存在、旧内核禁用、新内核可操作', async () => {
  for (const config of [{ countryViaProxy: 'no', countryEntryDomain: 'saas.sin.fan' }, { countryNodes: 'yes' }]) {
    const html = await (await createSubscriptionEngine(config, UUID).render(new Request('https://worker.example/' + UUID))).text();
    const supported = Object.hasOwn(config, 'countryViaProxy');
    const box = html.match(/<input[^>]*id="countryViaProxy"[^>]*>/)[0];
    assert.equal(box.includes('disabled'), !supported);
    const domainInput = html.match(/<input[^>]*id="countryEntryDomain"[^>]*>/)[0];
    assert.equal(domainInput.includes('disabled'), !supported);
    for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
  }
});

test('订阅集成：via-proxy 混合模式（DE/JP 出 rg 行、FR 走经典池无标记）', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE_SEED, epd: 'yes', countryNodes: 'yes', countryViaProxy: 'yes', countryRegions: 'DE,JP,FR', countryEntryDomain: 'saas.sin.fan', countryPerRegion: '2' });
  globalThis.__CFDIRECT_COUNTRY_DEPS__ = {
    fetchImpl: fakeFetch({
      'random-region/FR': ['104.16.31.1', '104.16.31.2', '104.16.31.3'].join('\n'),
      'wetest.vip': new Error('wetest down')
    }),
    noCache: true, resetCache: true
  };
  try {
    const clashResponse = await sub('clash');
    assert.equal(clashResponse.status, 200);
    const yaml = await clashResponse.text();
    // RG 地区：统一入口域名 + path 带 rg（节点名走域名命名管线为优选域名-NN，
    // 国家身份由 server + rg 承载，与手填 saas.sin.fan 条目渲染口径一致）
    assert.ok(yaml.includes('server: "saas.sin.fan"'), 'rg 国家节点 server 应为统一入口域名');
    assert.ok(yaml.includes('/?ed=2048&rg=DE'), '德国节点 WS path 应带 rg=DE');
    assert.ok(yaml.includes('/?ed=2048&rg=JP'), '日本节点 WS path 应带 rg=JP');
    // 池外地区 FR：经典 bestcf 反代 IP 行（IP 条目保留国旗名），且绝不发 rg
    assert.ok(yaml.includes('🇫🇷_法国-01'), 'FR 应出经典国家节点');
    assert.ok(yaml.includes('104.16.31.1'), 'FR 节点 server 应为 bestcf 池 IP');
    assert.ok(!yaml.includes('rg=FR'), 'FR 不得带 rg 参数（内核池外发 rg 是假国家）');
    assert.ok(!yaml.includes('@FR'), 'FR 不得带 @FR 标记');
    const names = [...yaml.matchAll(/- name: "([^"]+)"/g)].map(m => m[1]);
    assert.ok(names.length > 0 && names.every(n => !n.includes('@')), '节点名不得残留 @RG 后缀');
    assert.ok(yaml.includes('手填节点'), '手填 yx 仍应追加保留');
    const base64Response = await sub('base64');
    assert.equal(base64Response.status, 200);
    const text = Buffer.from(await base64Response.text(), 'base64').toString('utf8');
    const links = text.trim().split('\n').map(l => new URL(l));
    const countryLinks = links.filter(l => l.hostname === 'saas.sin.fan');
    assert.ok(countryLinks.length > 0, 'base64 订阅应含统一域名节点');
    assert.ok(countryLinks.some(l => (l.searchParams.get('path') || '').includes('rg=DE')), 'base64 应含 rg=DE');
    assert.ok(countryLinks.some(l => (l.searchParams.get('path') || '').includes('rg=JP')), 'base64 应含 rg=JP');
    assert.ok(countryLinks.every(l => !decodeURIComponent(l.hash.slice(1)).includes('@')), 'base64 节点名不得残留 @');
    const frLinks = links.filter(l => l.hostname === '104.16.31.1');
    assert.ok(frLinks.length > 0, 'base64 应含 FR 经典节点');
    assert.ok(frLinks.every(l => !(l.searchParams.get('path') || '').includes('rg=')), 'FR 经典节点 path 不得带 rg');
  } finally { delete globalThis.__CFDIRECT_COUNTRY_DEPS__; }
}));

test('订阅集成：国家模式下保留预设优选域名桶（日常稳定入口不被国家池顶掉）', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE_SEED, epd: 'yes', countryNodes: 'yes', countryRegions: 'JP', countryPerRegion: '2' });
  globalThis.__CFDIRECT_COUNTRY_DEPS__ = {
    fetchImpl: fakeFetch({
      'random-region/JP': ['104.16.21.1', '104.16.21.2'].join('\n'),
      'wetest.vip': new Error('wetest down')
    }),
    noCache: true, resetCache: true
  };
  try {
    const response = await sub('clash');
    assert.equal(response.status, 200);
    const yaml = await response.text();
    assert.ok(yaml.includes('🇯🇵_日本-01'), '国家节点在场');
    assert.ok(yaml.includes('优选域名-'), '预设优选域名桶同时保留');
  } finally { delete globalThis.__CFDIRECT_COUNTRY_DEPS__; }
}));
