# CFDirect 面板施工报告

施工范围：`panel/src/**` + 新增测试 `panel/src/test/core-stats.test.mjs`。未碰 `core/_worker.js`、`panel/test/core-fixture.mjs`（内核代理负责；施工期间其已同步新夹具，stats 契约按下文真实形状对齐）。
提交：`0e1bb5e feat(panel)`、`2301e4d ui(panel)`（基线 `7d12d6c`，内核代理的三个提交已先行落盘）。

## 1. 品牌

- 控制台顶栏与页脚：CFUSION → **CFDIRECT**（engine.mjs 模板两处）。页头 `<title>` 沿用上游「订阅中心 / Subscription Center」文案，非品牌位，未改。
- 渲染产物全文核验：`CFUSION` 0 处、`CFDIRECT` 在。代码注释与内部全局名（`__CFUSION_*`、`cfusionMeta` 键名）属历史口径/线缆契约，保留不动——其中 `cfusionMeta` 是已落 KV 的配置版本键，改名会丢历史版本链。

## 2. 新设计（theme.css 整表重写）

推翻 Squarespace 长卷轴（编辑式两栏 + 计数序号），换运维控制台形态：

- **布局**：固定顶栏（56px）+ 左侧固定导航（≥1024px 显示，208px，锚点：仪表盘 / 订阅与客户端 / 配置管理 / 优选 IP / 系统状态，后三者分别锚到既有 `#configCard`、`#preferredSection`、`#statusCard`）+ 右侧单列内容（桥接条与卡片同宽 1080px 对齐）。分区是白色面板卡（1px 边框、10px 圆角、极淡阴影），标题带橙色竖 tick；锚点跳转带 `scroll-margin-top` 避让固定顶栏。
- **色彩**：浅底 `#f7f7f5`、面板白、墨色 `#16161a`、单一强调色 Cloudflare 橙 `#f6821f`（保存主按钮、复选框选中态、仪表盘条形图、焦点环、导航 hover tick）。细线分隔 `#e3e3de/#ececea`，数字一律等宽字体。
- **顶栏**：品牌（带橙点）/ 语言 / HUD / **出口模式徽标**（`#cdEgBadge`，橙色胶囊，服务端按当前配置渲染 AUTO/DIRECT/PROXYIP，bridge 拿到 stats 后同步刷新）/ 刷新·重置·保存全部（保存为橙色实心主按钮）。
- 旧 `sq-` 主题类（sq-topbar/sq-subbar/sq-footer/sq-ico 等）在 engine/bridge/theme 三处**全部清零**，统一为 `cd-` 前缀；`cp-` 组件类（操作条、toast、CPU 开关行）是 JS 钩子名，保留。
- 落地页（index.html）沿用同一 theme，提交按钮改橙色主按钮；响应式断点保留（1180 收 HUD、720 顶栏紧凑、540 落地页）。

### 仪表盘数据流

控制台首卡 `#dashboardCard`（服务端渲染骨架 + `#cdDashBody` 挂载点 + 「正在加载内核统计…」占位）→ bridge.js 在 DOMContentLoaded 后 POST 面板 `/api/core-stats {host, uuid}`（取自 `window.CFNEW`）→ 成功则 DOM API 渲染四块（出口健康：直连成功率/降级率/总数/直连/降级/失败；ProxyIP 池：可用/共/已熔断 + 出口模式；CPU 守卫：档位/wouldCut/cut，monitor 且 wouldCut>0 时提示 protect 会切断这些连接；统计窗口：起始时间 + 「当前内核实例窗口，非全量统计」注记 + 刷新按钮）+ 断连原因五类条形分布；失败只把挂载点换成一行「内核统计暂不可用」，不弹窗、不刷屏。全部文案走 bridge BT 词典（zh/en 各 33 个新键）。

**stats 契约（与内核实测对齐）**：施工中途内核代理已落盘新夹具，真实端点返回
`{startedAt: ISO 字符串, windowSec, egress: 'auto', cpuGuard: 'monitor'(字符串), connections:{total, direct_ok, fallback_ok, all_failed}, disconnects:{五类同设计名}, guard:{wouldCut, cut}, proxyipPool:[{target, ok, fail, consecutiveFailures, tripped}], directNegCache:{entries}}`。
bridge 消费端按此契约为主、常见别名（direct/fallback/failed、egressMode、proxyip 对象形、ms 时间戳等）为容错回退，两种形状都能渲染。

## 3. 新字段 eg / cpuGuard 的接法（照 freeCpu 完整口径）

- **字段表（engine）**：`配置默认值` 加 `eg:'auto'`、`cpuGuard:'monitor'`；`获取环境配置快照` 映射加 `eg:['eg','EG']`、`cpuGuard:['cpuGuard','CPUGUARD','CPU_GUARD']`；`整理有效配置` 做枚举归一（非法值回落默认，与内核 fail-closed 互补：面板侧不产非法值）。
- **支持探测**：`supportsEg/supportsCpuGuard = Object.hasOwn(config, ...)`，与 `supportsFreeCpu` 同口径——旧内核配置无此键时下拉禁用并显示「当前内核不支持，请先更新配套内核。」
- **控制台控件**：配置管理卡内 freeCpu 行下方新增两个下拉（auto/direct/proxyip、off/monitor/protect），zh/en 文案齐全（`egLabel/egHint/egAuto/...`、`cpuGuardLabel/...`，含 aria-describedby 提示）。
- **读写回路**：`应用配置到界面` 写值、`收集界面配置` 读值（禁用时删键，不向旧内核提交未知字段）、重置全部配置按禁用状态条件带 `eg:''/cpuGuard:''` 删除键——三处均与 freeCpu 同构。
- **配置汇总**：走既有「当前配置」全量回显（`加载当前配置` 遍历Worker返回），新键自动入表，无需额外代码。
- **防漂移（server.mjs）**：`eg` 纳入 `CRITICAL_CONFIG_KEYS`——理由：出口策略属出站类键，静默变更会整体改变流量出口路径，与既有 `p/qj` 同级；**cpuGuard 不纳入**，与 freeCpu 的既有口径一致（曾评估不拦，属用户主动的保护档位）。测试已断言：eg 无确认 409 且配置不变、cpuGuard 不触发 409。
- **fail-closed 不变**：面板不新增任何绕过内核字段表的通道；表外键仍由内核整表拒绝（内核侧字段表由内核代理同步，夹具已含两键——本侧 core-stats 测试中的真实 stats 与 eg 409 均是与新夹具联跑通过的）。

## 4. /api/core-stats 端点（server.mjs）

- 路由：`POST /api/core-stats {host, uuid}`，置于 preferred 端点之前、绑定 Worker 后缀匹配之后，不与既有路由冲突；非 POST 返回 405。
- 鉴权口径（看先例后定）：与 `/api/preferred/*` 一致——先 `loadWorkerConfig` 成功加载一次目标 Worker 配置才放行（内含 w 绑定校验、UUID/自定义路径校验与 SSRF 通道选择）；读路径不要求管理会话，与其它读接口一致（写路径的管理会话要求不动）。
- 转发：经 `requestWorkerApi`（Cloudflare 下自动走 CORE 服务绑定，Node 下走既有 IP 校验通道）请求内核 `/<uuid>/stats`，200 且 JSON 形状含契约键（connections/disconnects/cpuGuard/proxyip/startedAt/windowStart 任一）时**原样转发**。
- fail-soft：内核不可达、非 200、非 JSON、形状不符（含旧内核回落 HTML)、请求体非法、UUID 无效——一律 HTTP 200 `{ok:false, unavailable:true}`，仪表盘据此显示占位。

## 5. 验证结果

- `npm test`：**129/129 全绿**（基线 122 + 新增 7）。无既有断言因品牌/主题被迫修改——旧测试不断言 sq- 类与 CFUSION 品牌字样（仅注释与内部全局名，保留）。
- 新增测试（core-stats.test.mjs，7 项）：旧内核回落 HTML → fail-soft；真实新夹具 stats 直通且契约形状断言；罐装 stats 原样转发（deepEqual）；405/坏 UUID/坏请求体 fail-soft；eg 409 防漂移 + cpuGuard 非关键键；默认值 + 新旧内核渲染（禁用/提示/脚本可解析）；新形态静态断言（品牌/仪表盘/侧栏/无 sq-/无 FX）。
- 构建：`rm -rf cloudflare/dist && npm run build:cloudflare` 成功，dist 的 cf-assets/engine 含 core-stats、cd-sidenav、CFDIRECT。
- 本地冒烟：引擎直渲染控制台 HTML 121,723 字节（CFDIRECT✓ 仪表盘✓ 侧栏✓ 徽标✓ eg/cpuGuard 控件✓，FX 0、sq- 0、CFUSION 0）；经完整面板管线（handlePanel + fixture）抓控制台 200,734 字节，同样全项通过；`npm start` 起服务 /health 200、落地页 200 且注入新 theme（`--cd-accent: #f6821f` 在、无 sq-）。

## 6. Pi / OpenRouter 使用情况

按上限 6 次内实际调用 **2 次，均失败、零采纳**：① `pf` 默认免费模型（nvidia/nemotron-3-super）上游 404；② 按 AGENTS.md 绕行口径指定 `nvidia/nemotron-3-ultra-550b:free` 时 Pi 报该 provider 无 API key。仪表盘双语文案与 theme.css 均为本人撰写，未用免费模型产出（与「免费模型结论不作数」的既有口径一致）。

## 7. 未覆盖 / 存疑

- **浏览器实机视觉核验未做**：本代理无浏览器通道，布局以结构断言 + 本地管线抓取核验为准；顶栏在中等宽度（720–1024px，侧栏隐藏、HUD 隐藏、徽标保留）下的实际排版建议父级部署后用真实浏览器过一眼（此尺寸下顶栏元素较多，靠 flex 与 overflow-x:auto 兜底）。
- **stats 契约的最终解释权在内核**：bridge 已按落盘夹具的真实形状对齐并保留别名容忍；若内核后续改键名，仪表盘会回落到别名或占位，不会报错。
- `directNegCache.entries` 内核已输出，仪表盘未展示（设计文档未要求；后续若要看负缓存命中可加一行）。
- cpuGuard 的「保存 200」路径依赖内核字段表——夹具已同步，故本侧测试以新夹具联跑通过；对旧内核保存时两键根本不会被提交（控件禁用 + 收集删键），无整表拒绝风险。
