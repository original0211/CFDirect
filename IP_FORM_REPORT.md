# IP_FORM_REPORT — 优选域名桶与 rg 节点改 IP 形式下发（方案 A）

日期：2026-10-27。决策：Brody 2026-10-27 18:05 拍板方案 A 并确认开工。
范围：仅 `panel/src/engine.mjs`（+ 配套测试）。未碰 `core/_worker.js`，未碰
CFusion/CFNext 任何资源。只重新部署了 `cfdirect-panel`。

## 1. 背景与目标

KFusion(mihomo) 对「代理服务器域名」的解析有故障：订阅中 server 为域名的
节点（rg 10 个 + 优选域名 43 个）在 KFusion 全超时，同批 IP 型经典节点正常，
同批域名节点在 Karing 正常，订阅字段逐项核对无误。方案 A：把解析移到
CFDirect 渲染侧——这两组节点的 server 改以解析出的 IP 下发，客户端不再需要
解析服务器域名。

## 2. 实现（panel/src/engine.mjs）

- 新增 `解析域名服务器地址(域名)`：在订阅渲染（`处理订阅请求`）内，对三处
  域名条目映射点统一生效——① 手填 yx 域名条目（含 saas.sin.fan 的
  「优选域名-01」与带 @RG 标记条目）；② 国家模式补回的预设优选域名桶；
  ③ 默认分支的预设优选域名桶。映射把条目 `ip` 换成解析出的 IPv4。
- 解析方式：渲染时经 DoH 实时查询，依次尝试四家解析网络
  （cloudflare-dns.com → dns.google → Quad9 → AliDNS），任一给出 A 记录即
  采用（多家轮换随机取一条）。每家超时 2.5s。
- **fail-safe**：域名无 A 记录/全部查询失败/异常 → 回退原域名作 server，
  绝不让订阅渲染失败（有抛错注入用例锁定）。
- **模块级缓存**：成功 600s、回退 60s（跨请求共享）。动因：一次渲染数十个
  域名逐个 DoH 会徒增延迟并烧子请求；仍属渲染时解析（分钟级新鲜），非静态
  写死。测试缝 `globalThis.__CFDIRECT_DNS_DEPS__.resolve` 存在时绕过缓存。
- **命名防回归**：命名管线（`获取值节点别名基础`）按「地址是否为合法 IP」
  给域名条目派「优选域名-NN」。第一版直接换 IP 后 17 个预设桶节点被误改名为
  `<域名>-NN`——已修：三处映射给条目加 `原域名` 字段，命名分类改按原域名判，
  命名与改前逐字一致（线上有/无对照实测 + 新增断言锁定）。
- SNI/Host 不经此路径：它们恒为工作器域名，保持逐字不变（渲染器原有口径）。
  rg 的 path 段、节点名、节点数、分组均不变。经典反代 IP 节点、国家经典
  节点、原生/备用地址不在范围，未动。

## 3. 测试

`panel && npm test` **157/157 全绿**（基线 153 + 新增 4）：
- country.test：方案 A 正例（rg server→IP、sni/host 不为 IP、rg path 不变、
  FR 经典节点不受影响）、解析抛错 fail-safe 回退；两处既有集成用例钉住
  「解析回退」以保持原断言口径。
- subscriptions.test：手填域名条目 server→IP + 命名仍为优选域名-NN；解析
  失败回退。
- large-list / country @RG 两处既有用例钉住回退（否则真实网络下
  example.com 等会被真解析污染断言）。

## 4. 部署

- 构建：`node panel/src/tools/build-cloudflare.mjs` 重建 dist 后，经
  custom.cloudflare 连接器 multipart 上传 `cfdirect-panel` 全部 18 个模块；
  绑定原样保留（CORE 服务绑定 / PANEL_ADMIN_PASSWORD secret /
  SESSION_KV / w plain_text，上传后回读 settings 核对一致）。
- 部署时间（modified_on）：2026-10-27T10:15:07Z（18:15 CST，终版；
  此前 10:10 / 10:12 两版分别为初版与命名修复版）。
- `cfdirect-core` 未上传、未改动。

## 5. 线上验收（改前基线 vs 改后，实测）

| 项 | 改前 | 改后 | 结论 |
|---|---|---|---|
| clash/base64 节点总数 | 168 / 168 | 168 / 168 | 一致 |
| 节点名称多重集 | — | 与改前完全一致 | 命名零回归 |
| rg 节点（10）server | saas.sin.fan | 162.159.130.234 / 162.159.135.234 | 全 IP 化 |
| rg 节点 sni/host | 工作器域名 | 工作器域名（逐字） | 不变 |
| rg path 段 | 10 条 /rg-XX | 10 条 | 不变 |
| 手填 saas.sin.fan 节点 | 域名 | IP（同上两 IP） | 已转换 |
| 预设桶已转换 | — | 8 个域名 ×2 协议 = 16 条 | 已转换 |
| 原 IP 型节点（115）server | — | 逐名比对零变化 | 无回归 |
| clash servername 集合 | {工作器域名} | {工作器域名} | 不变 |
| 面板 /health | 200 | 200 `{"ok":true}` | 正常 |

连通性抽测（模拟客户端行为：直连条目 IP + SNI/Host=工作器域名请求
`/<UUID>/stats`）：rg 条目 IP（162.159.135.234）→ HTTP 200；预设桶抽样 IP
（104.16.153.51）→ HTTP 200；域名直连对照 → 200。

## 6. 未完全转换的 13 个域名（如实记录）

改后仍有 13 个预设桶域名（×2 协议 = 26 条）保持域名形式，均为解析 fail-safe
回退、非代码遗漏：

- **10 个在任何解析网络下都没有 A 记录**（bestcf.top、cdn.2020111.xyz、
  cf.zhetengsha.eu.org、cloudflare.9jy.cc、cf.zerone-cdn.pp.ua、115155.xyz、
  cname.xirancdn.us、f3058171cad.002404.xyz、8.889288.xyz、
  freeyx.cloudflare88.eu.org）：属失效条目——本机以四家 DoH 复核均无 A
  记录，任何客户端也解析不出，它们在改前同样不可用，与本次改造无关。
- **3 个存在环境差异**（cdn.tzpro.xyz、cf.877771.xyz、xn--b6gac.eu.org）：
  本机与 Node 直跑引擎时四家 DoH 均有 A 记录、且能正确转换；但在 Workers
  出口四家均稳定无结果（四次部署渲染一致），判为 Workers 所在 colo 的
  解析可见性问题，代码侧无可修点。回退缓存仅 60s，若可见性恢复将自动
  转为 IP 形式。这 3 个域名在普通解析环境（Karing 等）下仍可作域名节点
  使用；在 KFusion 下可能仍受其域名解析故障影响（与本次要绕开的故障同
  类），影响面为预设桶 3/21 个域名。

## 7. 订阅地址

**不变**：仍为原面板地址下的 `/<UUID>/sub`（base64）与 `?target=clash`，
客户端刷新即可拿到新形态，无需换链接。
