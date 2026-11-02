import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubscriptionEngine } from '../engine.mjs';

const uuid = '351c9981-04b6-4103-aa4b-864aa9c91469';

function 节点配置64(地址, 端口) {
  const 文本 = [
    'client', 'dev tun', 'proto tcp',
    'remote ' + 地址 + ' ' + 端口,
    'cipher AES-128-CBC', 'auth SHA1',
    '<ca>', '-----BEGIN CERTIFICATE-----', 'CA', '-----END CERTIFICATE-----', '</ca>',
    '<cert>', '-----BEGIN CERTIFICATE-----', 'CERT', '-----END CERTIFICATE-----', '</cert>',
    '<key>', '-----BEGIN PRIVATE KEY-----', 'KEY', '-----END PRIVATE KEY-----', '</key>',
    '',
  ].join('\n');
  return Buffer.from(文本, 'utf8').toString('base64');
}

function 清单行(主机名, 地址, 国家, 端口) {
  const 字段 = [主机名, 地址, '100', '10', '5000000', 国家, 国家, '1', '100', '1', '1000', '2w', 'op', '', 节点配置64(地址, 端口)];
  return 字段.join(',');
}

function 清单(行列表) {
  return ['*vpn_servers', '#HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64', ...行列表, '*'].join('\n');
}

const 默认清单 = 清单([
  清单行('vpn-default-1', '203.0.113.10', 'JP', 1194),
  清单行('vpn-default-2', '203.0.113.11', 'KR', 1194),
]);

// 解析 vg 的 block 风格分组（组名/类型/成员），供 ⭐ 主力与 ⚪ 节点选择断言共用。
function 解析VG分组(body) {
  const 段 = body.split('proxy-groups:')[1].split('\nrules:')[0];
  const 组 = [];
  let 当前 = null;
  let 在成员区 = false;
  for (const 行 of 段.split('\n')) {
    const 组头 = /^  - name: "([^"]+)"/.exec(行);
    if (组头) { 当前 = { name: 组头[1], type: '', members: [] }; 组.push(当前); 在成员区 = false; continue; }
    if (!当前) continue;
    const 类型 = /^    type: (\S+)/.exec(行);
    if (类型) { 当前.type = 类型[1]; continue; }
    if (/^    proxies:$/.test(行)) { 在成员区 = true; continue; }
    if (在成员区) {
      const 成员 = /^      - (?:"([^"]+)"|(\S+))$/.exec(行);
      if (成员) 当前.members.push(成员[1] ?? 成员[2]);
    }
  }
  return 组;
}
const 自定义清单 = 清单([
  清单行('vpn-custom-dup', '203.0.113.10', 'JP', 1194), // 与默认源同地址同端口，应去重
  清单行('vpn-custom-1', '198.51.100.20', 'US', 1195),
]);

test('jkSource：自定义源与默认源合并去重，家宽订阅包含两边节点', async () => {
  const 原fetch = globalThis.fetch;
  const 请求过的网址 = [];
  globalThis.fetch = async 网址 => {
    请求过的网址.push(String(网址));
    if (String(网址).includes('example.com')) return new Response(自定义清单, { status: 200 });
    return new Response(默认清单, { status: 200 });
  };
  try {
    const engine = createSubscriptionEngine(
      { yx: '104.16.1.1:443#测试', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', jk: 'yes', jkSource: 'https://example.com/list.txt' },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(请求过的网址.some(u => u.includes('vpngate.net')), '应拉默认源');
    assert.ok(请求过的网址.some(u => u.includes('example.com')), '应拉自定义源');
    assert.ok(body.includes('203.0.113.10'), '默认源节点在');
    assert.ok(body.includes('203.0.113.11'), '默认源第二个节点在');
    assert.ok(body.includes('198.51.100.20'), '自定义源节点在');
    const 家宽节点数 = (body.match(/type: openvpn/g) || []).length;
    assert.equal(家宽节点数, 3, '合并去重后应为 3 个家宽节点，实际 ' + 家宽节点数);
  } finally {
    globalThis.fetch = 原fetch;
  }
});

test('vg 分组色点系：新组名/主组第一/自动间隔 600/引用跟随改名', async () => {
  const 原fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(默认清单, { status: 200 });
  try {
    const engine = createSubscriptionEngine(
      { yx: '104.16.1.1:443#测试', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', jk: 'yes' },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    // 新组名齐全，旧组名零残留
    for (const 组名 of ['⚪ 节点选择', '🟢 家宽自动', '🔵 家宽节点', '🟡 CF直连']) {
      assert.ok(body.includes('- name: "' + 组名 + '"'), '应有分组 ' + 组名);
    }
    for (const 旧名 of ['⚡ CF前置', '🚀 节点选择', '🏠 家宽自动', '🏠 家宽节点']) {
      assert.ok(!body.includes(旧名), '旧组名不应残留：' + 旧名);
    }
    // 本用例无优选域名-01/rg/UR 在场：⭐ 主力不发组，⚪ 节点选择保持原样居首
    assert.ok(!body.includes('⭐ 主力'), '无主力成员在场时不应出现 ⭐ 主力');
    // 发射顺序：节点选择 → CF直连 → 家宽自动 → 家宽节点
    const 组序 = ['⚪ 节点选择', '🟡 CF直连', '🟢 家宽自动', '🔵 家宽节点']
      .map(组名 => body.indexOf('- name: "' + 组名 + '"'));
    assert.ok(组序.every((v, i) => v >= 0 && (i === 0 || v > 组序[i - 1])), '分组顺序应为主组第一，实际索引 ' + 组序.join(','));
    // 主组成员顺序：CF直连、家宽自动、家宽节点、DIRECT
    const 主组段 = body.slice(组序[0], 组序[1]);
    const 成员序 = ['🟡 CF直连', '🟢 家宽自动', '🔵 家宽节点', 'DIRECT'].map(x => 主组段.indexOf(x));
    assert.ok(成员序.every((v, i) => v >= 0 && (i === 0 || v > 成员序[i - 1])), '主组成员顺序不对：' + 成员序.join(','));
    // 家宽自动：fallback + interval 600 + lazy 不变（新序下它在组序[2]，家宽节点在组序[3]）
    const 自动段 = body.slice(组序[2], 组序[3]);
    assert.ok(自动段.includes('type: fallback'), '家宽自动应为 fallback');
    assert.ok(自动段.includes('interval: 600'), '家宽自动间隔应为 600');
    assert.ok(自动段.includes('lazy: true'), '家宽自动 lazy 应保留');
    // 引用跟随改名：openvpn 节点 dialer-proxy 指向新前置组名、MATCH 指向新主组
    assert.ok(body.includes('dialer-proxy: "🟡 CF直连"'), 'dialer-proxy 应指向 🟡 CF直连');
    assert.ok(body.includes('- MATCH,⚪ 节点选择'), 'MATCH 应指向 ⚪ 节点选择');
    // 节点名口径不变：家宽节点仍 🏠 前缀
    assert.ok(body.includes('"🏠 JP-家宽-01"'), '家宽节点名应保持 🏠 前缀');
  } finally {
    globalThis.fetch = 原fetch;
  }
});

test('vg ⭐ 主力：优选域名-01 + rg 10 国 + UR 2 节点——组居首位、13 成员定序、⚪ 节点选择首位成员', async () => {
  const 原fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(默认清单, { status: 200 });
  // 方案 A 解析注入：全部回退原域名，保证节点名/path 口径确定（钉住入口无 rg、rg 条目带 /rg-XX）。
  globalThis.__CFDIRECT_DNS_DEPS__ = { resolve: async () => null };
  try {
    const rg条目 = [
      ['🇭🇰 香港', 'HK'], ['🇯🇵 日本', 'JP'], ['🇰🇷 韩国', 'KR'], ['🇸🇬 新加坡', 'SG'], ['🇺🇸 美国', 'US'],
      ['🇩🇪 德国', 'DE'], ['🇬🇧 英国', 'GB'], ['🇳🇱 荷兰', 'NL'], ['🇸🇪 瑞典', 'SE'], ['🇫🇮 芬兰', 'FI'],
    ].map(([名称, 代码]) => 'saas.sin.fan:443#' + 名称 + '@' + 代码);
    const engine = createSubscriptionEngine(
      {
        // 首行钉住入口（无 @RG → 渲染名优选域名-01、path 无 /rg- 段），其后 10 条 @RG 手填
        yx: ['saas.sin.fan:443#kejiland00-443-WS-TLS', ...rg条目].join('\n'),
        epi: 'no', epd: 'yes', egi: 'no', ena: 'no', ev: 'yes', et: 'no', ex: 'no', jk: 'yes',
        urEnabled: 'yes', urUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', urDeHost: 'urde.brodydung.eu.org', urCaHost: 'urca.brodydung.eu.org',
      },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    const 组 = 解析VG分组(body);
    assert.deepEqual(组.map(g => g.name), ['⭐ 主力', '⚪ 节点选择', '🟡 CF直连', '🟢 家宽自动', '🔵 家宽节点'], '分组顺序应为 ⭐ 主力居首、其余四组原序');
    assert.equal(组[0].type, 'select');
    assert.deepEqual(组[0].members, [
      '优选域名-01',
      '🇭🇰_香港-01', '🇯🇵_日本-01', '🇰🇷_韩国-01', '🇸🇬_新加坡-01', '🇺🇸_美国-01',
      '🇩🇪_德国-01', '🇬🇧_英国-01', '🇳🇱_荷兰-01', '🇸🇪_瑞典-01', '🇫🇮_芬兰-01',
      '🇩🇪 德国住宅-UR', '🇨🇦 加拿大住宅-UR',
    ], '⭐ 主力成员应为优选域名-01 + 10 rg 定序 + 2 UR');
    assert.equal(组[1].members[0], '⭐ 主力', '⭐ 主力应为 ⚪ 节点选择首位成员');
    assert.equal(组[1].members[1], '🟡 CF直连', '⚪ 节点选择其余成员顺序不变');
  } finally {
    globalThis.fetch = 原fetch;
    delete globalThis.__CFDIRECT_DNS_DEPS__;
  }
});

test('jkSource：未设置时只用默认源，行为与原来一致', async () => {
  const 原fetch = globalThis.fetch;
  const 请求过的网址 = [];
  globalThis.fetch = async 网址 => {
    请求过的网址.push(String(网址));
    return new Response(默认清单, { status: 200 });
  };
  try {
    const engine = createSubscriptionEngine(
      { yx: '104.16.1.1:443#测试', epi: 'yes', epd: 'no', egi: 'no', ena: 'no', ev: 'yes', jk: 'yes' },
      uuid,
    );
    const response = await engine.subscribe(new Request('https://worker.example/sub?target=vg'));
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(请求过的网址.every(u => u.includes('vpngate.net')), '只应拉默认源');
    assert.equal((body.match(/type: openvpn/g) || []).length, 2);
  } finally {
    globalThis.fetch = 原fetch;
  }
});
