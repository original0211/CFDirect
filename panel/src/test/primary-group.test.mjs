// CFDirect ⭐ 主力分组单测（仅 clash）：主力组由 rg 地区节点（按 path 的
// /rg-XX 段识别、HK→FI 定序）+ UR 住宅节点组成，发在 proxy-groups 第一位，
// 并成为 🚀 节点选择 的首位成员；部分在场只收在场的，全缺席不发组且输出
// 与此前一致。singbox/base64 不受影响。集成口径与 country.test 同夹具
//（本地 HTTP 托管内核 fixture、KV 直接种子配置、国家池/DNS 经注入缝假实现）。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const UR_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

const BASE = { ae: 'yes', yx: '104.16.1.1:443#手填节点', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' };
const RG = { epd: 'yes', countryNodes: 'yes', countryViaProxy: 'yes', countryRegions: 'HK,JP,KR,SG,US,DE,GB,NL,SE,FI', countryEntryDomain: 'saas.sin.fan', countryPerRegion: '1' };
const UR = { urEnabled: 'yes', urUuid: UR_UUID, urDeHost: 'urde.brodydung.eu.org', urCaHost: 'urca.brodydung.eu.org' };
const RG成员 = ['🇭🇰_香港-01', '🇯🇵_日本-01', '🇰🇷_韩国-01', '🇸🇬_新加坡-01', '🇺🇸_美国-01', '🇩🇪_德国-01', '🇬🇧_英国-01', '🇳🇱_荷兰-01', '🇸🇪_瑞典-01', '🇫🇮_芬兰-01'];
const UR成员 = ['🇩🇪 德国住宅-UR', '🇨🇦 加拿大住宅-UR'];

// 只解析 block 风格的分组（⭐ 主力与 🚀 节点选择 均为此风格）。
function 解析分组(yaml) {
  const 段 = yaml.split('proxy-groups:')[1].split('rule-providers:')[0];
  const 组 = [];
  let 当前 = null;
  for (const 行 of 段.split('\n')) {
    const 组头 = /^  - name: "([^"]+)"/.exec(行);
    if (组头) { 当前 = { name: 组头[1], type: '', members: [] }; 组.push(当前); continue; }
    if (!当前) continue;
    const 类型 = /^    type: (\S+)/.exec(行);
    if (类型) { 当前.type = 类型[1]; continue; }
    const 成员 = /^      - (?:"([^"]+)"|(\S+))$/.exec(行);
    if (成员) 当前.members.push(成员[1] ?? 成员[2]);
  }
  return 组;
}

function 注入缝() {
  globalThis.__CFDIRECT_DNS_DEPS__ = { resolve: async () => null };
  globalThis.__CFDIRECT_COUNTRY_DEPS__ = { fetchImpl: async () => { throw new Error('经典池不应被拉取'); }, noCache: true, resetCache: true };
}
function 清除缝() { delete globalThis.__CFDIRECT_DNS_DEPS__; delete globalThis.__CFDIRECT_COUNTRY_DEPS__; }

test('clash：rg 10 国 + UR 2 节点全在场——⭐ 主力 12 成员定序、居分组首位、为 🚀 节点选择首位成员', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE, ...RG, ...UR });
  注入缝();
  try {
    const response = await sub('clash');
    assert.equal(response.status, 200);
    const yaml = await response.text();
    const 组 = 解析分组(yaml);
    assert.equal(组[0].name, '⭐ 主力', '⭐ 主力应为 proxy-groups 第一组');
    assert.equal(组[0].type, 'select');
    assert.deepEqual(组[0].members, [...RG成员, ...UR成员], '成员应为 10 rg 定序 + 2 UR');
    const 主选 = 组.find(g => g.name === '🚀 节点选择');
    assert.ok(主选, '🚀 节点选择应存在');
    assert.equal(主选.members[0], '⭐ 主力', '⭐ 主力应为 🚀 节点选择首位成员');
    assert.equal(主选.members[1], '♻️ 自动选择', '其余成员顺序不变');
    // singbox/base64 不带主力组
    const singbox = JSON.parse(await (await sub('singbox')).text());
    assert.ok(!singbox.outbounds.some(o => String(o.tag).includes('⭐ 主力')), 'singbox 不得出现 ⭐ 主力分组');
    const base64Text = Buffer.from(await (await sub('base64')).text(), 'base64').toString('utf8');
    assert.ok(!base64Text.includes('⭐ 主力'), 'base64 不得出现 ⭐ 主力');
  } finally { 清除缝(); }
}));

test('clash：UR 关闭——⭐ 主力只含 10 个 rg 成员', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE, ...RG });
  注入缝();
  try {
    const yaml = await (await sub('clash')).text();
    const 组 = 解析分组(yaml);
    assert.equal(组[0].name, '⭐ 主力');
    assert.deepEqual(组[0].members, RG成员);
    assert.equal(组.find(g => g.name === '🚀 节点选择').members[0], '⭐ 主力');
  } finally { 清除缝(); }
}));

test('clash：rg 缺席（国家模式关）——⭐ 主力只含 2 个 UR 成员', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE, ...UR });
  注入缝();
  try {
    const yaml = await (await sub('clash')).text();
    const 组 = 解析分组(yaml);
    assert.equal(组[0].name, '⭐ 主力');
    assert.deepEqual(组[0].members, UR成员);
    assert.equal(组.find(g => g.name === '🚀 节点选择').members[0], '⭐ 主力');
  } finally { 清除缝(); }
}));

test('clash：rg 与 UR 全缺席——不发 ⭐ 主力组、🚀 节点选择保持原样', async () => fixture(async ({ seed, sub }) => {
  seed({ ...BASE });
  注入缝();
  try {
    const yaml = await (await sub('clash')).text();
    assert.ok(!yaml.includes('⭐ 主力'), '全缺席时不得出现 ⭐ 主力');
    const 组 = 解析分组(yaml);
    assert.equal(组[0].name, '🚀 节点选择', '首组应仍为 🚀 节点选择');
    assert.equal(组[0].members[0], '♻️ 自动选择', '🚀 节点选择首位成员应仍为 ♻️ 自动选择');
  } finally { 清除缝(); }
}));
