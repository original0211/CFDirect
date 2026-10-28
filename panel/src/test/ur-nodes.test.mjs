// CFDirect UR 住宅节点单测：直连引擎口径（与 country.test 的 @RG 用例同款
// harness，零外网）——urEnabled + urUuid 时 clash/singbox/base64 三格式尾部
// 固定追加德国/加拿大两条 vless 隧道节点；关闭或无 uuid 时完全不出现。
// server 与优选域名桶同走方案 A（经 __CFDIRECT_DNS_DEPS__ 注入解析）：解析出
// IP 时 server 改 IP、sni/host 恒为隧道主机名；解析失败/null 时回退域名形态，
// 与方案 A 接入前逐字一致。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSubscriptionEngine } from '../engine.mjs';

const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
const UR_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BASE = { ae: 'yes', epd: 'no', epi: 'yes', egi: 'no', ena: 'no', ev: 'yes', yx: '104.16.1.1:443#手填节点' };
const UR_ON = { ...BASE, urEnabled: 'yes', urUuid: UR_UUID, urDeHost: 'urde.brodydung.eu.org', urCaHost: 'urca.brodydung.eu.org' };
const UR_DE_IP = '203.0.113.10';
const UR_CA_IP = '203.0.113.11';
const 解析到IP = async 域名 => 域名 === 'urde.brodydung.eu.org' ? UR_DE_IP : 域名 === 'urca.brodydung.eu.org' ? UR_CA_IP : null;

const sub = async (config, target) => {
  const engine = createSubscriptionEngine(config, UUID);
  const response = await engine.subscribe(new Request('https://worker.example/' + UUID + '/sub?target=' + target));
  assert.equal(response.status, 200);
  return response.text();
};
const subLinks = async config => Buffer.from(await sub(config, 'base64'), 'base64').toString('utf8').trim().split('\n').map(l => new URL(l));
// 注入解析缝（与 subscriptions/country 用例同款）：用例间互不污染、结果确定。
const 注入解析 = async (解析函数, fn) => {
  globalThis.__CFDIRECT_DNS_DEPS__ = { resolve: 解析函数 };
  try { return await fn(); } finally { delete globalThis.__CFDIRECT_DNS_DEPS__; }
};

test('引擎默认值：UR 住宅节点四键', () => {
  const defaults = createSubscriptionEngine({}, UUID).defaults;
  assert.equal(defaults.urEnabled, 'no');
  assert.equal(defaults.urUuid, '');
  assert.equal(defaults.urDeHost, 'urde.brodydung.eu.org');
  assert.equal(defaults.urCaHost, 'urca.brodydung.eu.org');
});

test('base64：开启且有 uuid 时尾部追加德/加两条（server/uuid/path/sni/host 口径）', async () => {
  await 注入解析(async () => null, async () => {
    const links = await subLinks(UR_ON);
    const de = links.filter(l => l.hostname === 'urde.brodydung.eu.org');
    const ca = links.filter(l => l.hostname === 'urca.brodydung.eu.org');
    assert.equal(de.length, 1, '德国住宅节点恰一条');
    assert.equal(ca.length, 1, '加拿大住宅节点恰一条');
    for (const [link, 名称] of [[de[0], '🇩🇪 德国住宅-UR'], [ca[0], '🇨🇦 加拿大住宅-UR']]) {
      assert.equal(link.protocol, 'vless:');
      assert.equal(link.username, UR_UUID, '应使用独立 urUuid 而非订阅 UUID');
      assert.equal(link.port, '443');
      assert.equal(link.searchParams.get('security'), 'tls');
      assert.equal(link.searchParams.get('type'), 'ws');
      assert.equal(link.searchParams.get('path'), '/ws');
      assert.equal(link.searchParams.get('sni'), link.hostname);
      assert.equal(link.searchParams.get('host'), link.hostname);
      assert.equal(decodeURIComponent(link.hash.slice(1)), 名称);
    }
    // 追加在尾部：两条 UR 链接是列表最后两条，且既有节点不受影响
    assert.equal(links.at(-2).hostname, 'urde.brodydung.eu.org');
    assert.equal(links.at(-1).hostname, 'urca.brodydung.eu.org');
    assert.ok(links.some(l => l.hostname === '104.16.1.1'), '手填节点应保留');
  });
});

test('clash：两节点字段与主线 vless 同口径且进入代理分组', async () => {
  await 注入解析(async () => null, async () => {
    const yaml = await sub(UR_ON, 'clash');
    assert.ok(yaml.includes('server: "urde.brodydung.eu.org"'));
    assert.ok(yaml.includes('server: "urca.brodydung.eu.org"'));
    assert.ok(yaml.includes('uuid: ' + UR_UUID), 'clash 应使用 urUuid');
    assert.ok(yaml.includes('path: "/ws"'), 'WS path 应为 /ws');
    assert.ok(yaml.includes('servername: "urde.brodydung.eu.org"'));
    assert.ok(yaml.includes('servername: "urca.brodydung.eu.org"'));
    for (const 名称 of ['德国住宅-UR', '加拿大住宅-UR']) {
      assert.ok(yaml.includes(名称), '应出现节点名 ' + 名称);
      // 出现至少两次：proxies 定义一次 + 至少一个代理分组引用一次
      assert.ok(yaml.split(名称).length - 1 >= 2, 名称 + ' 应进入代理分组');
    }
  });
});

test('singbox：两出站字段完整且进入 select 分组', async () => {
  await 注入解析(async () => null, async () => {
    const data = JSON.parse(await sub(UR_ON, 'singbox'));
    const de = data.outbounds.find(o => o.type === 'vless' && o.server === 'urde.brodydung.eu.org');
    const ca = data.outbounds.find(o => o.type === 'vless' && o.server === 'urca.brodydung.eu.org');
    assert.ok(de && ca, '应有德/加两个 vless 出站');
    for (const [出站, 名称] of [[de, '德国住宅-UR'], [ca, '加拿大住宅-UR']]) {
      assert.equal(出站.uuid, UR_UUID);
      assert.equal(出站.server_port, 443);
      assert.equal(出站.tls.enabled, true);
      assert.equal(出站.tls.server_name, 出站.server);
      assert.equal(出站.transport.type, 'ws');
      assert.equal(出站.transport.path, '/ws');
      assert.equal(出站.transport.headers.Host, 出站.server);
      assert.ok(出站.tag.includes(名称));
      const select = data.outbounds.find(o => o.tag === 'select');
      assert.ok(select.outbounds.includes(出站.tag), 名称 + ' 应进入 select 分组');
    }
  });
});

test('关闭 / 无 uuid / 自定义主机名：显隐与主机名口径', async () => {
  await 注入解析(async () => null, async () => {
    for (const config of [BASE, { ...BASE, urEnabled: 'no', urUuid: UR_UUID }, { ...BASE, urEnabled: 'yes', urUuid: '' }]) {
      const links = await subLinks(config);
      assert.ok(!links.some(l => l.hostname.includes('brodydung.eu.org')), '关闭或无 uuid 时不得出现 UR 节点');
      const yaml = await sub(config, 'clash');
      assert.ok(!yaml.includes('住宅-UR'), 'clash 不得出现 UR 节点');
      const data = JSON.parse(await sub(config, 'singbox'));
      assert.ok(!data.outbounds.some(o => String(o.server || '').includes('brodydung.eu.org')), 'singbox 不得出现 UR 节点');
    }
    const custom = await subLinks({ ...UR_ON, urDeHost: 'de.example.org', urCaHost: 'ca.example.org' });
    assert.ok(custom.some(l => l.hostname === 'de.example.org' && l.searchParams.get('sni') === 'de.example.org'));
    assert.ok(custom.some(l => l.hostname === 'ca.example.org' && l.searchParams.get('host') === 'ca.example.org'));
  });
});

test('base64：解析成功时 server 改 IP、sni/host 保持隧道主机名（方案 A 同口径）', async () => {
  await 注入解析(解析到IP, async () => {
    const links = await subLinks(UR_ON);
    const de = links.filter(l => l.hostname === UR_DE_IP);
    const ca = links.filter(l => l.hostname === UR_CA_IP);
    assert.equal(de.length, 1, '德国住宅节点恰一条且 server 为解析 IP');
    assert.equal(ca.length, 1, '加拿大住宅节点恰一条且 server 为解析 IP');
    for (const [link, 主机, 名称] of [[de[0], 'urde.brodydung.eu.org', '🇩🇪 德国住宅-UR'], [ca[0], 'urca.brodydung.eu.org', '🇨🇦 加拿大住宅-UR']]) {
      assert.equal(link.protocol, 'vless:');
      assert.equal(link.username, UR_UUID, '应使用独立 urUuid 而非订阅 UUID');
      assert.equal(link.port, '443');
      assert.equal(link.searchParams.get('security'), 'tls');
      assert.equal(link.searchParams.get('type'), 'ws');
      assert.equal(link.searchParams.get('path'), '/ws');
      assert.equal(link.searchParams.get('sni'), 主机, 'sni 恒为隧道主机名');
      assert.equal(link.searchParams.get('host'), 主机, 'WS Host 恒为隧道主机名');
      assert.equal(decodeURIComponent(link.hash.slice(1)), 名称);
    }
    assert.equal(links.at(-2).hostname, UR_DE_IP, '德国节点仍追加在尾部倒数第二');
    assert.equal(links.at(-1).hostname, UR_CA_IP, '加拿大节点仍追加在尾部最后');
    assert.ok(links.some(l => l.hostname === '104.16.1.1'), '手填节点应保留');
  });
});

test('clash：解析成功时 server 为 IP、servername 保持隧道主机名', async () => {
  await 注入解析(解析到IP, async () => {
    const yaml = await sub(UR_ON, 'clash');
    assert.ok(yaml.includes('server: "' + UR_DE_IP + '"'), '德国节点 server 应为解析 IP');
    assert.ok(yaml.includes('server: "' + UR_CA_IP + '"'), '加拿大节点 server 应为解析 IP');
    assert.ok(!yaml.includes('server: "urde.brodydung.eu.org"'), '德国节点 server 不得再是域名');
    assert.ok(!yaml.includes('server: "urca.brodydung.eu.org"'), '加拿大节点 server 不得再是域名');
    assert.ok(yaml.includes('servername: "urde.brodydung.eu.org"'), '德国节点 servername 保持主机名');
    assert.ok(yaml.includes('servername: "urca.brodydung.eu.org"'), '加拿大节点 servername 保持主机名');
    assert.ok(yaml.includes('uuid: ' + UR_UUID), 'clash 应使用 urUuid');
  });
});

test('singbox：解析成功时 server 为 IP、tls.server_name 与 WS Host 保持隧道主机名', async () => {
  await 注入解析(解析到IP, async () => {
    const data = JSON.parse(await sub(UR_ON, 'singbox'));
    const de = data.outbounds.find(o => o.type === 'vless' && o.server === UR_DE_IP);
    const ca = data.outbounds.find(o => o.type === 'vless' && o.server === UR_CA_IP);
    assert.ok(de && ca, '应有德/加两个 server 为解析 IP 的 vless 出站');
    assert.equal(de.tls.server_name, 'urde.brodydung.eu.org');
    assert.equal(de.transport.headers.Host, 'urde.brodydung.eu.org');
    assert.equal(ca.tls.server_name, 'urca.brodydung.eu.org');
    assert.equal(ca.transport.headers.Host, 'urca.brodydung.eu.org');
    for (const [出站, 名称] of [[de, '德国住宅-UR'], [ca, '加拿大住宅-UR']]) {
      assert.equal(出站.uuid, UR_UUID);
      assert.equal(出站.server_port, 443);
      assert.equal(出站.transport.path, '/ws');
      assert.ok(出站.tag.includes(名称));
    }
  });
});

test('base64：解析抛错时回退域名形态（与方案 A 接入前逐字一致）', async () => {
  await 注入解析(async () => { throw new Error('dns down'); }, async () => {
    const links = await subLinks(UR_ON);
    const de = links.filter(l => l.hostname === 'urde.brodydung.eu.org');
    const ca = links.filter(l => l.hostname === 'urca.brodydung.eu.org');
    assert.equal(de.length, 1, '解析失败时德国节点回退域名形态');
    assert.equal(ca.length, 1, '解析失败时加拿大节点回退域名形态');
    assert.equal(de[0].searchParams.get('sni'), 'urde.brodydung.eu.org');
    assert.equal(de[0].searchParams.get('host'), 'urde.brodydung.eu.org');
    assert.equal(ca[0].searchParams.get('sni'), 'urca.brodydung.eu.org');
    assert.equal(ca[0].searchParams.get('host'), 'urca.brodydung.eu.org');
    assert.equal(links.at(-2).hostname, 'urde.brodydung.eu.org');
    assert.equal(links.at(-1).hostname, 'urca.brodydung.eu.org');
  });
});

test('解析优先序：UR 隧道主机名先于预设优选域名桶解析，关闭时不花解析预算', async () => {
  const 调用顺序 = [];
  const 记录解析 = async 域名 => { 调用顺序.push(域名); return 解析到IP(域名); };
  await 注入解析(记录解析, async () => {
    // 预设优选域名桶开启（epd=yes、无手填 yx 走预设分支）且 epi/egi/ena 关闭：
    // 本轮有整桶预设域名要解析，UR 两主机名必须排在任何预设域名之前——否则
    // 共享 DoH 预算（24）会被预设桶/rg 先耗尽、UR 每轮静默回退域名形态。
    const 预设加UR = { ae: 'yes', epd: 'yes', epi: 'no', egi: 'no', ena: 'no', ev: 'yes', yx: '', urEnabled: 'yes', urUuid: UR_UUID, urDeHost: 'urde.brodydung.eu.org', urCaHost: 'urca.brodydung.eu.org' };
    const links = await subLinks(预设加UR);
    const 德序 = 调用顺序.indexOf('urde.brodydung.eu.org');
    const 加序 = 调用顺序.indexOf('urca.brodydung.eu.org');
    assert.ok(德序 >= 0 && 加序 >= 0, '两条 UR 隧道主机名都应被解析');
    assert.ok(调用顺序.some(域名 => 域名 === 'cloudflare.182682.xyz'), '本轮应确实有预设优选域名参与解析');
    const 首个预设序 = 调用顺序.findIndex(域名 => 域名 !== 'urde.brodydung.eu.org' && 域名 !== 'urca.brodydung.eu.org');
    assert.ok(首个预设序 > 0, '预设域名解析应发生在 UR 之后');
    assert.ok(德序 < 首个预设序 && 加序 < 首个预设序, 'UR 主机名必须先于任何预设域名解析');
    // 预解析结果被尾部 UR 追加块取用：server 为解析 IP、位置仍在尾部
    assert.equal(links.at(-2).hostname, UR_DE_IP, '德国节点 server 应为预解析 IP 且在尾部');
    assert.equal(links.at(-1).hostname, UR_CA_IP, '加拿大节点 server 应为预解析 IP 且在尾部');
    // 关闭时不得为 UR 主机名花任何解析预算
    调用顺序.length = 0;
    await subLinks({ ...预设加UR, urEnabled: 'no' });
    assert.ok(!调用顺序.includes('urde.brodydung.eu.org') && !调用顺序.includes('urca.brodydung.eu.org'), '关闭时不得解析 UR 主机名');
    assert.ok(调用顺序.length > 0, '关闭时预设域名仍应正常解析');
  });
});

test('控制台渲染：UR 控件存在、旧内核禁用、新内核可操作', async () => {
  for (const config of [{ urEnabled: 'no', urUuid: '', urDeHost: 'urde.brodydung.eu.org', urCaHost: 'urca.brodydung.eu.org' }, {}]) {
    const html = await (await createSubscriptionEngine(config, UUID).render(new Request('https://worker.example/' + UUID))).text();
    const supported = Object.hasOwn(config, 'urEnabled');
    const box = html.match(/<input[^>]*id="urEnabled"[^>]*>/)[0];
    assert.equal(box.includes('disabled'), !supported);
    assert.ok(html.includes('id="urUuid"'));
    assert.ok(html.includes('id="urDeHost"'));
    assert.ok(html.includes('id="urCaHost"'));
    assert.ok(html.includes('id="urSection"'));
    for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script);
  }
});
