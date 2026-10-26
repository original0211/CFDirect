# CFDirect 内核：rg 按节点国家出口（RG_EGRESS）施工报告

日期：2026-10-26　范围：仅 `core/_worker.js` + `scripts/verify-kernel.mjs` + 夹具同步。未部署。

## 功能一句话

节点入口统一走优选域名（Anycast 就近接入）后，国家改由出口侧决定：节点在 WS/XHTTP
路径带 `rg=DE` 参数，内核按连接读取 `rg`，用该地区的 ProxyIP 池优先出站。

## 穿线路径（按连接捕获，无模块级可变状态）

校验统一走新助手 `zzRg(v)`：转大写后须匹配 `/^[A-Z]{2}$/`，否则返回 `""`（无 rg）。

- **WS**：`an(e)` 在既有 query 参数解析处（与 `p`/`wk`/`rm`/`s` 并列）算出
  `gr=zzRg(n.searchParams.get("rg"))`，作为第 13 个参数传给两个 `Ke(...)` 调用点
  （vless / trojan）。`Ke(..., gr="")` 把 `gr` 捕获在连接闭包里：池地区
  `d = gr || f || J`（`f` 为既有 `wk` 穿线地区，`J` 为全局地区）。断线重连走同一个
  Ke 闭包内的 `H(!0)`，地区不漂移；不同连接各持自己的 `gr`，同 isolate 并发不串扰
  （验证脚本有双 rg 并发断言）。
- **XHTTP**：`$n` 的 POST 入口 → `Nn(e)`（此处持有完整 Request）算出
  `zzRg(new URL(e.url).searchParams.get("rg"))`，经 `Rn(e, n, t, gr)` 第 4 参 →
  `Hn(a, t, gr)` 第 3 参，`gr` 捕获在 Hn 的每连接上下文（`px` 闭包）里。XHTTP 按
  请求建会话，每次建会话重新解析本请求的 URL，不依赖任何跨请求状态。

管理类路径（`/api/config`、`/stats`、`/region` 等）在进入 `an()`/`Nn()` 之前已被
`$n` 路由分发，不受影响。

## 语义

- 带合法 `rg` 的连接：
  - ProxyIP 候选地区 = `rg`，替代全局 `J`，也优先于 `wk` 参数导出的地区 `f`。
  - **出站顺序改为 ProxyIP 优先**：先完整尝试该国池（仍受方案 2 的 episode 预算
    `zzp` 约束：4 秒 / 最多 4 候选），即使 `Eg=auto` 也不先直连。
  - `Eg=direct` 时 rg 连接同样允许走池——`rg` 是节点级的显式地区指令，优先级高于
    eg 的 direct 偏好；eg 的 CPU/预算纪律不变。实现上 Ke 的 `px(m, fo)` 增加 force
    参、Hn 的 `px` 在 `gr` 非空时不抛 "proxyip disabled by eg"。
  - 该国池为空/全部失败时，**按现有链 fail-over 到直连**（可用性优先），与无 rg
    连接走完全相同的直连代码与负缓存逻辑。
- 不带 rg（或 rg 非法）的连接：代码路径与改动前逐字节等价（`gr=""` 时所有新分支
  短路），既有 46 项验证断言全数不回归。
- 保留的既有口径：
  - 自定义 ProxyIP（全局 `p` 或 WS 的 `p` 参数）非空时，候选仍是该单个 ProxyIP
    （与 `wk` 今天的行为一致），`rg` 此时只决定顺序（池优先）与统计，不改候选。
  - 家宽 only 模式（WS `q&&w` / XHTTP `q&&j`）跳过 rg 预尝试，避免经家宽链再套一层
    ProxyIP（双重代理）；连接按既有 jk 流程走，此时 rg 不生效。
  - WS 已建立连接断线后的同闭包重连（`H(!0)`）里，`px` 走无 force 的既有路径：
    `Eg=direct` 的 rg 连接在重连集内不再重试池，客户端重新 upgrade 即恢复 rg 语义。

## stats 口径

`zzS()` 新增 `rgUsed` / `rgFallback`，`/stats` 输出新增 `rg: {used, fallback}`：

- `used`：带合法 rg 且进入了「池优先」预尝试的连接数（Ke/Hn 各计一次，与
  `connections.total` 的计数粒度一致；家宽 only 跳过预尝试的不计）。
- `fallback`：上述连接中池失败后最终经**直连**建成的数量（Ke 主尝试、Hn 主尝试、
  Hn 的 `Q&&j` catch 分支三个直连建成点各计一次）。经池建成的同时也计入既有
  `connections.fallback_ok`（其口径即「经 ProxyIP 建成」）。
- 注意：连接状态对象 `zst.rg` 是既有的「远端已断开」标记（断连原因分类用），与
  本功能无关，未动。

## 候选池现实（不新造池数据）

内核内置兜底池 `Ve` 只有 10 个地区各 1 个 ProxyIP 域名：HK、US、SG、JP、KR、DE、
SE、NL、FI、GB。`CeL(地区)` 对任意两字代码**永不返回空**：地区匹配开启（`ee`）时
返回全池重排——目标地区在前，其次邻区表（如 DE↔NL/GB/SE/FI），其余按全局序
US,SG,JP,KR,DE,SE,NL,FI,GB。因此：

- `rg` 为池外地区（如 FR）：池中没有该国候选，首候选落到全局序的 US——出口不会是
  法国（与今天 `wk=FR` 的行为完全一致，本次未发明任何池数据）。
- `rg` 为池内地区：首候选即该国 ProxyIP；其失败后按邻区/全局序继续（预算内）。

## 配置字段（仅注册，内核不读）

`F` 默认值表新增 `countryViaProxy: "no"`、`countryEntryDomain: "saas.sin.fan"`，
`Nt()` 补环境别名（`COUNTRYVIAPROXY`/`COUNTRY_VIA_PROXY`、
`COUNTRYENTRYDOMAIN`/`COUNTRY_ENTRY_DOMAIN`），照 eg/cpuGuard 先例。供面板后续
的「国家节点走 ProxyIP 出口」开关使用；未注册键仍被 POST /api/config 整表拒绝。

## 验证

- `node scripts/verify-kernel.mjs`：**66/66 全过**（基线 46 + 新增 20）。
  新增覆盖：stats 的 `rg` 零值结构；两新配置字段保存/读回；未注册键仍 400；
  `zzRg` 校验（小写转大写、XX9/空/一位/三位忽略）；Ke 与 Hn 各自的
  (a) rg=DE 时候选地区入参恒为 DE 且连到 DE 池、(b) 非法 rg 在 zzRg 层被忽略
  （Ke/Hn 收到的即空 gr，另有 Hn 无 rg 时 rg 计数恒零的行为不变旁证）、
  (c) Eg=auto 下池先于直连、Eg=direct 下 rg 绕过禁令走池、池败 fail-over 直连
  并计 rgFallback、双 rg 并发不串地区。
- 面板全量 `npm test`：**144/144 全过**（夹具已同步为新内核）。
- `panel/test/core-fixture.mjs` 与 `core/_worker.js` 已 `cmp` 校验字节一致。

## 未覆盖

- WS 握手 / XHTTP 帧解析本身（Node 无 WebSocketPair/Tn 环境，与基线脚本同样的
  限制）：`an()`/`Nn()` 内的 rg 解析是一行 `zzRg(new URL(...))`，校验逻辑本身已
  函数级验证；端到端待部署后用真实节点 URL 实测。
- 真实 ProxyIP 池连通性与各国出口质量未测（属部署后体感/stats 验收范围）。

外部模型调用：0 次（压缩单文件内核工作按既有纪律由本代理自核完成）。
