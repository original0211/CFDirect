// 订阅二维码单测：走与浏览器完全相同的一条路——vendored
// qrcode-generator 1.4.4 源码（服务端注入页面的同一份文件）+ 控制台页内
// 的二维码脚本块，在 node:vm 里求值后调用页面自己的
// 生成订阅二维码SVG / 渲染订阅二维码。全程本地编码、无外部服务。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { createSubscriptionEngine } from '../engine.mjs';

const UUID = '351c9981-04b6-4103-aa4b-864aa9c91469';
// 与线上同形态的完整订阅链接：面板主机 + UUID + /sub?target=clash（88 字符）
const 示例链接 = 'https://cfd-panel.brodydung.eu.org/' + UUID + '/sub?target=clash';

const 库源码 = await readFile(new URL('../qrcode.js', import.meta.url), 'utf8');
const 渲染页 = async headers => (await createSubscriptionEngine({}, UUID)
  .render(new Request('https://worker.example/' + UUID, { headers }))).text();

const 提取脚本块 = (html, 标记) => {
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    if (script.includes(标记)) return script;
  }
  return '';
};

// 先注入库（定义全局 qrcode 工厂，与 server.mjs 的注入顺序一致），
// 再注入页面二维码脚本块（定义两个封装函数）。
const 载入环境 = async () => {
  const html = await 渲染页();
  const 脚本 = 提取脚本块(html, 'function 生成订阅二维码SVG');
  assert.ok(脚本, '控制台页应包含二维码脚本块');
  const 上下文 = vm.createContext({});
  vm.runInContext(库源码, 上下文);
  vm.runInContext(脚本, 上下文);
  return { 上下文, html };
};

test('vendored 库：qrcode-generator 1.4.4 原文件、MIT 许可头在位、无网络请求面', () => {
  assert.ok(库源码.includes('QR Code Generator for JavaScript'));
  assert.ok(库源码.includes('Copyright (c) 2009 Kazuhiko Arase'));
  assert.ok(库源码.includes('Licensed under the MIT license'));
  assert.ok(!库源码.includes('XMLHttpRequest') && !库源码.includes('fetch('), '库不得发起网络请求');
  const 上下文 = vm.createContext({});
  vm.runInContext(库源码, 上下文);
  assert.equal(typeof 上下文.qrcode, 'function', '库应定义全局 qrcode 工厂');
});

test('二维码：完整订阅链接以 M 级字节模式编码无溢出，版本自动选取', async () => {
  const { 上下文 } = await 载入环境();
  const svg = 上下文.生成订阅二维码SVG(示例链接);
  assert.ok(svg.startsWith('<svg'), '应产出 SVG 字符串');
  const 码 = 上下文.qrcode(0, 'M');
  码.addData(示例链接, 'Byte');
  码.make();
  const 模块数 = 码.getModuleCount();
  const 版本 = (模块数 - 17) / 4;
  assert.ok(Number.isInteger(版本) && 版本 >= 5 && 版本 <= 10, '版本应在自动选取范围内，实得 ' + 版本);
  console.log('    示例链接 ' + 示例链接.length + ' 字符 → QR 版本 ' + 版本 + '，模块 ' + 模块数 + '×' + 模块数);
});

test('二维码：finder 图案与四模块静默区正确', async () => {
  const { 上下文 } = await 载入环境();
  const 码 = 上下文.qrcode(0, 'M');
  码.addData(示例链接, 'Byte');
  码.make();
  const n = 码.getModuleCount();
  const 黑 = (r, c) => 码.isDark(r, c);
  // 左上 finder：外框黑、白环、3×3 核心黑；分隔区为白
  assert.equal(黑(0, 0), true); assert.equal(黑(0, 6), true); assert.equal(黑(6, 0), true);
  assert.equal(黑(1, 1), false);
  assert.equal(黑(2, 2), true); assert.equal(黑(3, 3), true); assert.equal(黑(4, 4), true);
  assert.equal(黑(7, 0), false); assert.equal(黑(0, 7), false); assert.equal(黑(7, 7), false);
  // 右上 / 左下 finder 外角与白环
  assert.equal(黑(0, n - 1), true); assert.equal(黑(0, n - 7), true); assert.equal(黑(1, n - 2), false);
  assert.equal(黑(n - 1, 0), true); assert.equal(黑(n - 7, 0), true); assert.equal(黑(n - 2, 1), false);
  // 静默区：封装取 cellSize=4、margin=16（恰 4 个模块）→ viewBox 边长
  // n*4+32，且首个模块 (0,0) 的路径自静默区内沿 M16,16 起。
  const svg = 上下文.生成订阅二维码SVG(示例链接);
  const 边长 = n * 4 + 32;
  assert.ok(svg.includes('viewBox="0 0 ' + 边长 + ' ' + 边长 + '"'), 'viewBox 应含双侧 4 模块静默区');
  assert.ok(svg.includes('d="M16,16'), '首模块应位于静默区内沿 (16,16)');
});

test('订阅视图：二维码容器在链接行之后、caption 按语言、经链接行取值触发渲染', async () => {
  const html = await 渲染页();
  const 卡片起 = html.indexOf('id="clientCard"');
  const 行起 = html.indexOf('id="clientSubRow"');
  const qr起 = html.indexOf('id="clientQr"');
  assert.ok(卡片起 >= 0 && 行起 > 卡片起, '订阅链接行应位于订阅与客户端卡片内');
  assert.ok(qr起 > 行起, '二维码容器应排在订阅链接行之后');
  assert.ok(html.includes('id="clientQrCode"'));
  assert.ok(html.includes('扫码导入'), '中文页 caption 应为扫码导入');
  // 接线：显示订阅行读取链接行（clientSubscriptionUrl）的当前文本并调用
  // 渲染订阅二维码——与复制按钮读取同一元素、同一文本，保证码与复制同值，
  // 且每次生成客户端链接重建链接时都会随之重绘。
  const 显示行 = html.match(/function 显示订阅行\(名称\) \{[\s\S]*?\n\}/);
  assert.ok(显示行, '应能定位显示订阅行函数');
  assert.ok(显示行[0].includes('clientSubscriptionUrl'), '渲染应取链接行元素的值');
  assert.ok(显示行[0].includes('渲染订阅二维码('), '显示订阅行应调用二维码渲染');
  const htmlEn = await 渲染页({ cookie: 'preferredLanguage=en' });
  assert.ok(htmlEn.includes('Scan to import'), '英文页 caption 应为 Scan to import');
});

test('渲染订阅二维码：有链接时填充 SVG 并显形，空链接时隐藏', async () => {
  const { 上下文 } = await 载入环境();
  const 容器 = { hidden: true };
  const 码区 = { innerHTML: '' };
  上下文.document = {
    getElementById: id => id === 'clientQr' ? 容器 : id === 'clientQrCode' ? 码区 : null,
  };
  上下文.渲染订阅二维码(示例链接);
  assert.equal(容器.hidden, false);
  assert.ok(码区.innerHTML.startsWith('<svg'), '码区应被填入 SVG');
  上下文.渲染订阅二维码('');
  assert.equal(容器.hidden, true);
  assert.equal(码区.innerHTML, '');
});

test('服务端接线：库经资产通道注入控制台页（Cloudflare / Node / Vercel 三路）', async () => {
  const server源码 = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(server源码.includes('embeddedAssets?.qrcode'), 'Cloudflare 资产通道应含 qrcode');
  assert.ok(server源码.includes("new URL('./qrcode.js', import.meta.url)"), 'Node 直读应指向 vendored 文件');
  assert.ok(server源码.includes('qrcodeScript'), '控制台页应注入二维码库脚本');
  const cf构建 = await readFile(new URL('../tools/build-cloudflare.mjs', import.meta.url), 'utf8');
  assert.ok(cf构建.includes("qrcode: await textAsset('qrcode.js')"), 'Cloudflare 构建应内嵌 qrcode 资产');
  const vercel构建 = await readFile(new URL('../tools/build-vercel.mjs', import.meta.url), 'utf8');
  assert.ok(vercel构建.includes("'qrcode.js'"), 'Vercel 构建资产表应含 qrcode.js');
});

test('theme.css：二维码样式与 ≤760px 移动层静态口径', async () => {
  const css = await readFile(new URL('../theme.css', import.meta.url), 'utf8');
  // 二维码：CSS 把生成库的黑/白改写为墨/纸，无朱红、无边框
  assert.ok(/\.cd-qr-code svg path \{ fill: var\(--cd-ink\); \}/.test(css), '二维码模块应为墨色');
  assert.ok(/\.cd-qr-code svg rect \{ fill: var\(--cd-bg\); \}/.test(css), '二维码底应为纸面色');
  // 移动层存在且关键规则在位
  const 移动块起 = css.indexOf('@media (max-width: 760px)');
  assert.ok(移动块起 >= 0, '应存在 ≤760px 媒体查询');
  const 移动块 = css.slice(移动块起);
  assert.ok(/\.cd-sidenav \{[^}]*flex-wrap: wrap/.test(移动块), '移动导航应横向可换行');
  assert.ok(/\.cd-nav-link \{[^}]*min-height: 40px/.test(移动块), '导航点按高度应 ≥40px');
  assert.ok(/\.subscription-url \{[^}]*overflow-wrap: anywhere/.test(移动块), '长链接应 anywhere 换行');
  assert.ok(/font-size: 16px !important/.test(移动块), '移动端输入框应 16px 防 iOS 放大');
  assert.ok(/body:not\(\.landing\) \.card \{ margin-top: 40px; \}/.test(移动块), '移动段间距应约 40px');
  assert.ok(/\.cd-dash-grid \{ grid-template-columns: 1fr 1fr;/.test(移动块), '仪表盘栅格应塌为两小列');
  assert.ok(/button, input\[type="submit"\] \{ min-height: 40px; \}/.test(移动块), '按钮点按高度应 ≥40px');
  // 全文件：固定像素宽度不得超过 375（max-/min-width 与媒体条件不计）
  const 固定宽度 = [...css.matchAll(/(?<![-\w])width:\s*(\d+)px/g)].map(m => Number(m[1]));
  assert.ok(固定宽度.length > 0 && 固定宽度.every(w => w <= 375),
    '固定宽度不得超过 375px，实得最大 ' + Math.max(...固定宽度) + 'px');
});
