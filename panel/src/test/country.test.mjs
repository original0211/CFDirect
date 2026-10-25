// CFDirect 国家节点单测：builder 全部用 fixture deps 假拉取（零外网），
// 集成部分与 core-stats 同夹具口径（本地 HTTP 托管内核 fixture、KV 直接种子配置，
// 国家池拉取经 globalThis.__CFDIRECT_COUNTRY_DEPS__ 注入假实现）。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COUNTRY_REGIONS, buildCountryPool, resolveCountryYx,
  sanitizeCountryRegions, clampCountryPerRegion, countryNodeName
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
