// CFDirect 单测：/api/core-stats 代理（fail-soft）、eg 防漂移关键键、
// eg/cpuGuard 新字段的默认值与控制台渲染（新内核可操作、旧内核禁用）。
// 夹具与 config-guard 同口径：本地 HTTP 服务托管内核 fixture；「升级内核」
// 用一层 shim 拦截 /<uuid>/stats 返回契约内的统计 JSON，不改 fixture 本身。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

process.env.CFNEW_ALLOW_PRIVATE = 'yes';
const { handlePanel } = await import('../server.mjs');
const { createSubscriptionEngine } = await import('../engine.mjs');
const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const coreSource = await readFile(process.env.CFNEW_TEST_CORE || new URL('../../test/core-fixture.mjs', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(coreSource.replace(/import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];?/, (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("隔离测试不建立代理连接"); };')).toString('base64'))).default;

const STATS = {
  startedAt: 1761450000000,
  egressMode: 'auto',
  connections: { total: 10, direct: 7, fallback: 2, failed: 1 },
  disconnects: { client_gone: 3, upstream_error: 1, budget_exceeded: 0, cpu_guard_cut: 0, normal_close: 5 },
  cpuGuard: { mode: 'monitor', wouldCut: 4, cut: 0 },
  proxyip: { total: 14, available: 13, tripped: 1, candidates: [] }
};

async function fixture(run) {
  const values = new Map([['c', JSON.stringify({ ae: 'yes', yx: '104.16.1.1:443#节点', ev: 'yes', epi: 'yes', epd: 'no', egi: 'no', ena: 'no' })]]);
  const storage = { get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, value) => values.set(key, value) };
  let statsMode = 'old';
  const server = createServer(async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (statsMode === 'new' && incoming.url.endsWith('/stats')) {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify(STATS));
      return;
    }
    if (statsMode === 'html' && incoming.url.endsWith('/stats')) {
      // 旧内核没有 /stats：未知子路径回落到控制台 HTML（200、非 JSON）。
      outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      outgoing.end('<!DOCTYPE html><html><body>console</body></html>');
      return;
    }
    const response = await worker.fetch(new Request('http://' + incoming.headers.host + incoming.url, { method: incoming.method, ...(body.length ? { body } : {}) }), { u: UUID, C: storage });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const host = 'http://127.0.0.1:' + server.address().port;
  const api = '/worker-api/' + Buffer.from(host).toString('base64url') + '/' + UUID;
  const request = (path, init) => handlePanel(new Request('https://panel.example' + path, init));
  const coreStats = (body, method = 'POST') => request('/api/core-stats', { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  try { await run({ values, api, host, request, coreStats, setStatsMode: mode => { statsMode = mode; } }); }
  finally { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
}

test('旧内核无 stats 端点（回落 HTML）：/api/core-stats 返回 200 fail-soft 占位结构', async () => fixture(async ({ coreStats, host, setStatsMode }) => {
  setStatsMode('html');
  const response = await coreStats({ host, uuid: UUID });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: false, unavailable: true });
}));

test('真实新内核 stats：/api/core-stats 转发且形状符合契约', async () => fixture(async ({ coreStats, host }) => {
  const response = await coreStats({ host, uuid: UUID });
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.notEqual(stats.unavailable, true);
  assert.equal(typeof stats.startedAt, 'string');
  assert.equal(typeof stats.egress, 'string');
  assert.equal(typeof stats.cpuGuard, 'string');
  assert.equal(typeof stats.connections.total, 'number');
  assert.equal(typeof stats.connections.direct_ok, 'number');
  assert.equal(typeof stats.connections.fallback_ok, 'number');
  assert.equal(typeof stats.connections.all_failed, 'number');
  for (const key of ['client_gone', 'upstream_error', 'budget_exceeded', 'cpu_guard_cut', 'normal_close']) {
    assert.equal(typeof stats.disconnects[key], 'number', 'disconnects.' + key);
  }
  assert.equal(typeof stats.guard.wouldCut, 'number');
  assert.equal(typeof stats.guard.cut, 'number');
  assert.ok(Array.isArray(stats.proxyipPool));
}));

test('升级内核：/api/core-stats 原样转发 stats JSON', async () => fixture(async ({ coreStats, host, setStatsMode }) => {
  setStatsMode('new');
  const response = await coreStats({ host, uuid: UUID });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), STATS);
}));

test('/api/core-stats 只接受 POST；坏 UUID 与坏请求体同样 fail-soft', async () => fixture(async ({ coreStats, host, request }) => {
  const get = await coreStats({ host, uuid: UUID }, 'GET');
  assert.equal(get.status, 405);
  const badUuid = await coreStats({ host, uuid: '00000000-0000-4000-8000-000000000000' });
  assert.equal(badUuid.status, 200);
  assert.deepEqual(await badUuid.json(), { ok: false, unavailable: true });
  const badBody = await request('/api/core-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' });
  assert.equal(badBody.status, 200);
  assert.deepEqual(await badBody.json(), { ok: false, unavailable: true });
}));

test('eg 是防漂移关键键（无确认 409、配置不变）；cpuGuard 不是关键键（不触发 409 确认）', async () => fixture(async ({ api, request }) => {
  const post = (body) => request(api + '/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const rejected = await post({ eg: 'direct' });
  assert.equal(rejected.status, 409);
  const rejectedBody = await rejected.json();
  assert.equal(rejectedBody.needConfirm, true);
  assert.ok(rejectedBody.criticalChanged.includes('eg'));
  const config = await (await request(api + '/api/config')).json();
  assert.notEqual(config.eg, 'direct', '被拒后 eg 不应变化');
  // cpuGuard 与 freeCpu 同口径不进关键集：面板不得以 409 拦截（后续由内核按
  // 其字段表处理，旧夹具会整表拒绝、新夹具会保存成功，都不属于防漂移确认）。
  const guard = await post({ cpuGuard: 'protect' });
  assert.notEqual(guard.status, 409);
  await guard.text();
}));

test('eg/cpuGuard 默认值与控制台渲染：新内核可操作、旧内核禁用并提示升级', async () => {
  const defaults = createSubscriptionEngine({}, UUID).defaults;
  assert.equal(defaults.eg, 'auto');
  assert.equal(defaults.cpuGuard, 'monitor');
  for (const config of [{ eg: 'proxyip', cpuGuard: 'protect' }, {}]) {
    const html = await (await createSubscriptionEngine(config, UUID).render(new Request('https://worker.example/' + UUID))).text();
    const supported = Object.hasOwn(config, 'eg');
    const egSelect = html.match(/<select[^>]*id="eg"[^>]*>/)[0];
    const guardSelect = html.match(/<select[^>]*id="cpuGuard"[^>]*>/)[0];
    assert.equal(egSelect.includes('disabled'), !supported);
    assert.equal(guardSelect.includes('disabled'), !Object.hasOwn(config, 'cpuGuard'));
    assert.ok(html.includes('aria-describedby="egHint"'));
    assert.ok(html.includes('aria-describedby="cpuGuardHint"'));
    if (!supported) assert.ok(html.includes('当前内核不支持'));
    for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
  }
});

test('控制台新形态：CFDIRECT 品牌、仪表盘区、侧栏导航、无旧 sq- 主题类', async () => {
  const html = await (await createSubscriptionEngine({ eg: 'auto', cpuGuard: 'monitor' }, UUID).render(new Request('https://worker.example/' + UUID))).text();
  assert.ok(html.includes('CFDIRECT'));
  assert.ok(!html.includes('CFUSION'));
  assert.ok(html.includes('id="dashboardCard"'));
  assert.ok(html.includes('id="cdDashBody"'));
  assert.ok(html.includes('class="cd-sidenav"'));
  assert.ok(html.includes('id="cdEgBadge"'));
  assert.ok(html.includes('AUTO'));
  assert.ok(!html.includes('sq-'), '旧 Squarespace 主题类不应再出现');
  assert.ok(!/FX/.test(html.replace('Free CPU', '')), '不应出现 FX 特效开关字样');
  const bridge = await readFile(new URL('../bridge.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes('/api/core-stats'));
  assert.ok(bridge.includes('cdDashBody'));
  new Function(bridge);
});
