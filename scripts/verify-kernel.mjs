// CFDirect 内核独立验证脚本（不属于 panel 测试套件）
// 运行：node ~/workspace/cfdirect/scripts/verify-kernel.mjs
//
// 覆盖范围（均为真实执行，不是文本匹配）：
//  A. Worker 级：以面板测试同款方式加载 core/_worker.js（剥离 cloudflare:sockets
//     导入、data-URL 导入、KV mock），真实调用 /<uuid>/stats 与 /api/config：
//     默认 eg=auto / cpuGuard=monitor、保存读回、freeCpu=yes 向 protect 的兼容
//     优先级、非法 eg 回落 auto、无 UUID 前缀访问 /stats 得 404。
//  B. 函数级：从内核原文提取 pt / zz* / oe / O / Ke / Hn，在受控闭包里真实
//     执行（Le/nt/CeL/ye/et/G 为行为可控的假件），验证 eg 三种模式分支、
//     直连负缓存、ProxyIP 熔断与 fail-open、4s episode 预算与
//     budget_exceeded 计数、pt 三档语义。
// 未覆盖：WS 协议握手（Node 无 WebSocketPair）与 XHTTP 帧解析（Tn）本身——
//     Ke 的调用点在 an() 内、Hn 的调用点在 Rn 内，本脚本验证的是 Ke/Hn
//     函数本体与 /stats 路由，协议层沿用基线 122 项面板测试的覆盖。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CORE = new URL('../core/_worker.js', import.meta.url);
const source = await readFile(CORE, 'utf8');
const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';
let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('  ✔', name);
}

/* ================= A. Worker 级：/stats 路由与配置联动 ================= */
console.log('A. /stats 路由与配置联动');
{
  const stripped = source.replace(
    /import\s*\{\s*connect as ([^}]+)\}\s*from\s*['"]cloudflare:sockets['"];/,
    (_, name) => 'const ' + name.trim() + ' = () => { throw new Error("此验证不建立代理连接"); };');
  assert.notEqual(stripped, source, 'sockets 导入应被剥离');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(stripped).toString('base64'))).default;
  const values = new Map([['c', JSON.stringify({})]]);
  const C = { get: async key => JSON.parse(values.get(key) || 'null'), put: async (key, v) => values.set(key, v) };
  const env = { u: uuid, C };
  const get = async (path, e = env) => worker.fetch(new Request('https://worker.example' + path), e);
  const post = async (obj, e = env) => worker.fetch(
    new Request('https://worker.example/' + uuid + '/api/config', { method: 'POST', body: JSON.stringify(obj) }), e);

  const s0 = await (await get('/' + uuid + '/stats')).json();
  ok('stats 默认 egress=auto', s0.egress === 'auto');
  ok('stats 默认 cpuGuard=monitor', s0.cpuGuard === 'monitor');
  ok('stats 计数全零且结构完整', s0.connections.total === 0 && s0.connections.direct_ok === 0
    && s0.rg && s0.rg.used === 0 && s0.rg.fallback === 0
    && s0.disconnects.cpu_guard_cut === 0 && s0.guard.wouldCut === 0
    && Array.isArray(s0.proxyipPool) && typeof s0.startedAt === 'string' && s0.windowSec >= 0);

  ok('保存 eg=direct 成功', (await post({ eg: 'direct' })).status === 200);
  ok('stats 反映 eg=direct', (await (await get('/' + uuid + '/stats')).json()).egress === 'direct');
  ok('保存 cpuGuard=off 成功', (await post({ cpuGuard: 'off' })).status === 200);
  ok('stats 反映 cpuGuard=off', (await (await get('/' + uuid + '/stats')).json()).cpuGuard === 'off');
  ok('保存 freeCpu=yes 成功', (await post({ freeCpu: 'yes' })).status === 200);
  const s1 = await (await get('/' + uuid + '/stats')).json();
  ok('freeCpu=yes 兼容优先于 cpuGuard=off → protect', s1.cpuGuard === 'protect');
  const bad = await post({ eg: 'bogus' });
  const cfg = await (await get('/' + uuid + '/api/config')).json();
  ok('eg=bogus 保存后 stats 仍回落 auto', (await (await get('/' + uuid + '/stats')).json()).egress === 'auto'
    && (bad.status === 200 || bad.status === 400) && typeof cfg === 'object');
  ok('无 UUID 前缀 /stats → 404', (await get('/stats')).status === 404);
  ok('/region 既有路由完好', (await get('/' + uuid + '/region')).status === 200);
  ok('保存 countryViaProxy=yes 成功（新字段已注册）', (await post({ countryViaProxy: 'yes' })).status === 200);
  ok('保存 countryEntryDomain 成功（新字段已注册）', (await post({ countryEntryDomain: 'entry.example' })).status === 200);
  const cfg2 = await (await get('/' + uuid + '/api/config')).json();
  ok('配置读回 countryViaProxy/countryEntryDomain', cfg2.countryViaProxy === 'yes'
    && cfg2.countryEntryDomain === 'entry.example'
    && cfg2.countryNodes === 'no' && typeof cfg2.countryRegions === 'string');
  ok('未注册键仍被整表拒绝 400', (await post({ zzzUnknownKey: '1' })).status === 400);
}

/* ================= 提取工具 ================= */
function extract(from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, '提取锚点: ' + from);
  return source.slice(a, b);
}
const ptSrc = extract('function pt(A){', 'function zzS(){');
const zzSrc = extract('function zzS(){', 'function $n(A){');
const oeSrc = extract('function oe(e){', 'async function an(e){');
const oSrc = extract('function O(e){', 'function Se(e');
const keSrc = extract('async function Ke(', 'function O(e){');
const hnSrc = extract('async function Hn(', 'async function Rn(');

/* ================= B1. pt 三档 ================= */
console.log('B1. pt 三档（off / monitor / protect）');
{
  const pt = new Function(ptSrc + ';return pt;')();
  // off
  const off = pt(0);
  off.consume(10 * 1024 * 1024);
  ok('off: 大流量不断开不计数', off.exhausted === false && off.wouldCut === false && off.enabled === false);
  ok('off: 旧布尔 false 等价', pt(false).enabled === false);
  // monitor
  const mon = pt(1);
  let would = 0;
  mon.onWouldCut(() => would++);
  mon.consume(200 * 1024);
  ok('monitor: 阈值内不触发', would === 0 && mon.wouldCut === false);
  mon.consume(200 * 1024); // 累计 400KiB > 384KiB
  ok('monitor: 跨字节阈值只计一次', would === 1 && mon.wouldCut === true);
  mon.consume(200 * 1024);
  ok('monitor: 重复跨越不重复计、永不断开', would === 1 && mon.exhausted === false && mon.enabled === false);
  const mon2 = pt(1);
  let would2 = 0;
  mon2.onWouldCut(() => would2++);
  for (let i = 0; i < 97; i++) mon2.consume(1); // 97 分片 > 96
  ok('monitor: 跨分片阈值（96）触发', would2 === 1);
  // protect
  const pro = pt(2);
  let cut = 0, exh = 0;
  pro.onCut(() => cut++);
  pro.onExhausted(() => exh++);
  assert.throws(() => pro.consume(400 * 1024), e => e.code === 'FREE_CPU_BUDGET');
  passed++; console.log('  ✔ protect: 跨阈值抛 FREE_CPU_BUDGET');
  ok('protect: onCut 与 onExhausted 各触发一次', cut === 1 && exh === 1 && pro.exhausted === true && pro.enabled === true);
  ok('protect: 旧布尔 true 等价', pt(true).enabled === true);
}

/* ================= B2. zz 助手：负缓存 / 熔断 / 排序 ================= */
console.log('B2. zz 助手（负缓存、健康分、熔断、fail-open）');
{
  const zz = new Function('let zzs=null;' + zzSrc + ';return {zzS,zzNeg,zzPool,zzOrd,zzOk,zzBad};')();
  const S = zz.zzS();
  ok('负缓存未命中为空', zz.zzNeg('a.example') === false);
  S.neg.set('a.example', Date.now() + 60000);
  ok('负缓存命中（TTL 内）', zz.zzNeg('a.example') === true);
  S.neg.set('b.example', Date.now() - 1);
  ok('负缓存过期自动失效并删除', zz.zzNeg('b.example') === false && !S.neg.has('b.example'));
  const cand = [{ k: 'p1:443' }, { k: 'p2:443' }, { k: 'p3:443' }];
  zz.zzBad('p2:443'); zz.zzBad('p2:443'); // cf=2
  ok('健康排序：低连续失败优先', zz.zzOrd(cand)[0].k !== 'p2:443'
    && zz.zzOrd(cand).at(-1).k === 'p2:443');
  zz.zzBad('p2:443'); // cf=3 → 熔断
  const h = zz.zzPool('p2:443');
  ok('连续失败 3 次熔断（until 未来）', h.cf === 3 && h.until > Date.now());
  const ord = zz.zzOrd(cand);
  ok('熔断候选被跳过、其余保留', ord.length === 2 && !ord.some(c => c.k === 'p2:443'));
  zz.zzBad('p1:443'); zz.zzBad('p1:443'); zz.zzBad('p1:443');
  zz.zzBad('p3:443'); zz.zzBad('p3:443'); zz.zzBad('p3:443');
  ok('全熔断 fail-open 回落全池', zz.zzOrd(cand).length === 3);
  zz.zzOk('p1:443');
  ok('成功清零连续失败', zz.zzPool('p1:443').cf === 0 && zz.zzPool('p1:443').ok === 1);
}

/* ================= B3/B4. Ke / Hn 的 eg 分支 ================= */
function makeScope2(Eg, behavior, candidates) {
  const calls = [];
  const Le = async (host, port, fetcher, ze, deadline) => {
    calls.push(host);
    const b = behavior.get(host) || 'fail';
    if (b === 'ok') return {
      writable: { getWriter: () => ({ write: async () => {}, releaseLock: () => {} }) },
      closed: new Promise(() => {}), close: () => {},
    };
    if (b === 'hang') {
      await new Promise(r => setTimeout(r, Math.max(0, (deadline || Date.now()) - Date.now())));
      throw new Error('connect deadline');
    }
    throw new Error('connect failed: ' + host);
  };
  const nt = async () => { throw new Error('nt unavailable in harness'); };
  const celCalls = [];
  const CeL = (region) => { celCalls.push(region); return typeof candidates === 'function' ? candidates(region) : candidates; };
  const ye = (e, sock) => ({ ye: true, sock });
  const he = ms => new Promise(r => setTimeout(r, ms));
  const et = async () => {};
  const gCalls = [];
  const G = () => { gCalls.push(1); };
  const pt = new Function(ptSrc + ';return pt;')();
  const factory = new Function(
    'Le', 'nt', 'CeL', 'ye', 'he', 'et', 'G', 'Eg', 'v',
    'let zzs=null;' + zzSrc + oeSrc + oSrc + hnSrc + keSrc +
    ';let zst=null;const zzp={ms:4e3,n:4};const N="",J="JP",ee=!0,q=!1,Q=!1,j=!1,ne={},ue=1,Ze=2;' +
    'return {Hn,Ke,zzS};');
  const built = factory(Le, nt, CeL, ye, he, et, G, Eg, pt(0));
  return { ...built, calls, gCalls, celCalls };
}

const PX = [
  { domain: 'px1.example', port: 443, regionCode: 'JP' },
  { domain: 'px2.example', port: 443, regionCode: 'JP' },
];
const freshState = () => ({ socket: null, writer: null, drainUpload: null });

console.log('B3. Hn（XHTTP 建连）eg 分支');
{
  // auto：直连成功
  let sc = makeScope2('auto', new Map([['t.example', 'ok']]), PX);
  const r1 = await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn auto 直连成功走 ye', !!r1 && r1.ye === true);
  ok('Hn auto 直连计数 direct=1/total=1', sc.zzS().direct === 1 && sc.zzS().total === 1);
  ok('Hn auto 直连成功不碰 ProxyIP', !sc.calls.includes('px1.example'));

  // auto：直连失败 → 降级；第二次同目标跳过直连（负缓存）
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  const r2 = await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn auto 降级成功', !!r2 && sc.zzS().fallback === 1);
  const before = sc.calls.filter(h => h === 't.example').length;
  const r3 = await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn auto 负缓存：第二次不再试直连', !!r3
    && sc.calls.filter(h => h === 't.example').length === before && sc.zzS().fallback === 2);

  // proxyip：行为同方案 2（主试直连→兜底），且不用负缓存
  sc = makeScope2('proxyip', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  await sc.Hn({ hostname: 't.example', port: 443 });
  const pb = sc.calls.filter(h => h === 't.example').length;
  await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn proxyip 无负缓存：第二次仍试直连', sc.calls.filter(h => h === 't.example').length === pb + 1
    && sc.zzS().fallback === 2);

  // direct：失败即 null，绝不碰 ProxyIP
  sc = makeScope2('direct', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  const r4 = await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn direct 失败返回 null 且不试 ProxyIP', r4 === null
    && !sc.calls.includes('px1.example') && sc.zzS().failed === 1);

  // auto：候选全失败 3 轮 → 熔断；第 4 轮 fail-open 仍尝试
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px1.example', 'fail'], ['px2.example', 'fail']]), PX);
  for (let i = 0; i < 3; i++) await sc.Hn({ hostname: 't.example', port: 443 });
  const pool = sc.zzS().pool;
  ok('Hn 候选连续失败 3 轮后熔断', pool.get('px1.example:443').cf === 3 && pool.get('px1.example:443').until > Date.now());
  const pxCallsBefore = sc.calls.filter(h => h.startsWith('px')).length;
  await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn 全熔断 fail-open 仍试候选', sc.calls.filter(h => h.startsWith('px')).length > pxCallsBefore);

  // auto：全部挂死 → ≈4s 预算封顶，budget_exceeded 计数
  sc = makeScope2('auto', new Map([['t.example', 'hang'], ['px1.example', 'hang'], ['px2.example', 'hang']]), PX);
  const t0 = Date.now();
  const r5 = await sc.Hn({ hostname: 't.example', port: 443 });
  const el = Date.now() - t0;
  ok('Hn 挂死在 ~4s 预算内判失败', r5 === null && el >= 3900 && el < 6000);
  ok('Hn 预算耗尽计 budget_exceeded', sc.zzS().rs.budget_exceeded === 1 && sc.zzS().failed === 1);
}

console.log('B4. Ke（WS 建连）eg 分支');
{
  // auto：直连成功
  let sc = makeScope2('auto', new Map([['t.example', 'ok']]), PX);
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  ok('Ke auto 直连成功 direct=1/total=1', sc.zzS().direct === 1 && sc.zzS().total === 1);
  ok('Ke auto 直连成功不碰 ProxyIP', !sc.calls.includes('px1.example'));

  // auto：直连失败 → 降级成功；第二次跳过直连
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  ok('Ke auto 降级成功 fallback=1', sc.zzS().fallback === 1);
  const before = sc.calls.filter(h => h === 't.example').length;
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  ok('Ke auto 负缓存：第二次不再试直连', sc.calls.filter(h => h === 't.example').length === before
    && sc.zzS().fallback === 2);

  // direct：失败即放弃（G 收尾），不试 ProxyIP，failed 计数
  sc = makeScope2('direct', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  ok('Ke direct 失败不试 ProxyIP 且 failed=1', !sc.calls.includes('px1.example')
    && sc.zzS().failed === 1 && sc.gCalls.length === 1);

  // proxyip：直连失败→兜底（方案 2 行为），无负缓存
  sc = makeScope2('proxyip', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  const pb = sc.calls.filter(h => h === 't.example').length;
  await sc.Ke(1, 't.example', 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null);
  ok('Ke proxyip 无负缓存：第二次仍试直连', sc.calls.filter(h => h === 't.example').length === pb + 1
    && sc.zzS().fallback === 2);
}

console.log('B5. rg 按节点国家出口（降级池地区 + zzRg/zzRgP 校验）');
{
  const zz = new Function('let zzs=null;' + zzSrc + ';return {zzRg, zzRgP};')();
  ok('zzRg 小写转大写', zz.zzRg('de') === 'DE');
  ok('zzRg 合法两位代码透传', zz.zzRg('FR') === 'FR');
  ok('zzRg 非法 XX9 → 忽略（空）', zz.zzRg('XX9') === '');
  ok('zzRg 缺失/空/一位/三位 → 忽略（空）', zz.zzRg(null) === '' && zz.zzRg(undefined) === ''
    && zz.zzRg('') === '' && zz.zzRg('D') === '' && zz.zzRg('DEU') === '');
  // zzRgP：路径段形式优先（客户端可能转义/丢弃 WS 查询串，路径段最稳），查询兜底
  const U = (path, qs) => new URL('https://w.example' + path + (qs ? '?' + qs : ''));
  ok('zzRgP 路径段 /rg-DE/ 命中', zz.zzRgP(U('/rg-DE/', 'ed=2048')) === 'DE');
  ok('zzRgP 路径段在尾部 /uuid8/rg-JP 命中', zz.zzRgP(U('/351c9981/rg-JP')) === 'JP');
  ok('zzRgP 无路径段时回落查询 rg=', zz.zzRgP(U('/', 'ed=2048&rg=GB')) === 'GB');
  ok('zzRgP 路径段优先于查询', zz.zzRgP(U('/rg-DE/', 'rg=US')) === 'DE');
  ok('zzRgP 转义查询 %3F 不误命中', zz.zzRgP(U('/%3Fed=2048&rg=DE')) === '');
  ok('zzRgP 非法段忽略', zz.zzRgP(U('/rg-D3/')) === '' && zz.zzRgP(U('/rg-DEU/')) === '');

  const DEPX = [{ domain: 'px-de.example', port: 443, regionCode: 'DE' }];
  const FRPX = [{ domain: 'px-fr.example', port: 443, regionCode: 'FR' }];
  const byRegion = region => region === 'DE' ? DEPX : region === 'FR' ? FRPX : PX;
  const keArgs = (host, gr) => [1, host, 443, new Uint8Array(0), {}, null, freshState(), '', '', null, null, null, gr];

  // 新口径（2026-10-26 晚修正）：rg 只决定「降级时用哪国 ProxyIP 池」，顺序仍是
  // 直连优先——公共 ProxyIP 中继只对 CF 托管目标透明转发，池优先会打碎非 CF
  // 目标的 TLS（实测 ifconfig.me 证书错配 / google 握手失败），故废弃池优先。
  // Ke auto + rg=DE + 直连成功：走直连，不碰池
  let sc = makeScope2('auto', new Map([['t.example', 'ok'], ['px-de.example', 'ok']]), byRegion);
  await sc.Ke(...keArgs('t.example', 'DE'));
  ok('Ke rg=DE 直连成功走直连（不碰池）', sc.calls[0] === 't.example' && !sc.calls.includes('px-de.example')
    && sc.zzS().direct === 1 && sc.zzS().fallback === 0);
  ok('Ke rg=DE 直连计数 rgUsed=1/rgFallback=1', sc.zzS().rgUsed === 1 && sc.zzS().rgFallback === 1);

  // Ke auto + rg=DE + 直连失败：降级池必须是 DE 池
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px-de.example', 'ok'], ['px1.example', 'ok']]), byRegion);
  await sc.Ke(...keArgs('t.example', 'DE'));
  ok('Ke rg=DE 降级候选地区入参恒为 DE', sc.celCalls.length >= 1 && sc.celCalls.every(r => r === 'DE'));
  ok('Ke rg=DE 降级走 DE 池成功', sc.zzS().fallback === 1 && sc.calls.includes('px-de.example')
    && sc.zzS().rgFallback === 0);

  // Ke Eg=direct + rg：rg 不再绕过 direct 禁令（只认直连）
  sc = makeScope2('direct', new Map([['t.example', 'fail'], ['px-de.example', 'ok']]), byRegion);
  await sc.Ke(...keArgs('t.example', 'DE'));
  ok('Ke direct+rg 直连失败即放弃（不试池）', !sc.calls.includes('px-de.example') && sc.zzS().failed === 1);

  // Ke 并发不串扰：两个 rg 连接直连皆败，各自降级到本国池
  sc = makeScope2('auto', new Map([['a.example', 'fail'], ['b.example', 'fail'], ['px-de.example', 'ok'], ['px-fr.example', 'ok']]), byRegion);
  await Promise.all([sc.Ke(...keArgs('a.example', 'DE')), sc.Ke(...keArgs('b.example', 'FR'))]);
  ok('Ke 并发 rg 不串地区', sc.celCalls.includes('DE') && sc.celCalls.includes('FR')
    && sc.zzS().rgUsed === 2 && sc.zzS().fallback === 2);

  // Hn auto + rg=DE + 直连成功：走直连
  sc = makeScope2('auto', new Map([['t.example', 'ok'], ['px-de.example', 'ok']]), byRegion);
  const hr = await sc.Hn({ hostname: 't.example', port: 443 }, null, 'DE');
  ok('Hn rg=DE 直连成功走直连', !!hr && hr.ye === true && sc.zzS().direct === 1
    && !sc.calls.includes('px-de.example'));
  ok('Hn rg 计数 rgUsed=1/rgFallback=1', sc.zzS().rgUsed === 1 && sc.zzS().rgFallback === 1);

  // Hn auto + rg=DE + 直连失败：降级 DE 池
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px-de.example', 'ok']]), byRegion);
  const hr2 = await sc.Hn({ hostname: 't.example', port: 443 }, null, 'DE');
  ok('Hn rg=DE 降级走 DE 池', !!hr2 && sc.zzS().fallback === 1
    && sc.celCalls.length >= 1 && sc.celCalls.every(r => r === 'DE') && sc.zzS().rgFallback === 0);

  // Hn Eg=direct + rg：不再绕令，直连失败返回 null
  sc = makeScope2('direct', new Map([['t.example', 'fail'], ['px-de.example', 'ok']]), byRegion);
  const hr3 = await sc.Hn({ hostname: 't.example', port: 443 }, null, 'DE');
  ok('Hn direct+rg 直连失败返回 null（不试池）', hr3 === null && !sc.calls.includes('px-de.example'));

  // Hn 无 rg 时 rg 计数保持零（行为不变旁证）
  sc = makeScope2('auto', new Map([['t.example', 'fail'], ['px1.example', 'ok']]), PX);
  await sc.Hn({ hostname: 't.example', port: 443 });
  ok('Hn 无 rg 时 rgUsed/rgFallback 恒零', sc.zzS().rgUsed === 0 && sc.zzS().rgFallback === 0);
}

console.log(`\n全部通过：${passed} 项断言`);
