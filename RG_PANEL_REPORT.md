# RG_PANEL_REPORT — 国家节点「快入口 + 按节点国家 ProxyIP 出口」面板侧施工报告

日期：2026-10-26。范围：仅 `panel/src/**`（engine.mjs / country.mjs / test/country.test.mjs）。
未碰 `core/_worker.js` 与 `panel/test/core-fixture.mjs`，未部署，未动 CFusion。
外部模型调用：0 次（全部自核）。

## 0. 契约与一处实测修正（混合模式的由来）

面板与内核的契约：节点的 WS/XHTTP path 查询参数 `rg=<两位大写地区码>`，内核据此
按节点国家选 ProxyIP 出口。

施工中内核侧交活并实测了内核 ProxyIP 兜底池的真实覆盖，覆盖比预想窄，据此把
via-proxy 从「全地区统一入口」修正为**混合模式**：

- 内核内置 ProxyIP 兜底池只有 10 个地区各 1 个候选：HK、US、SG、JP、KR、DE、SE、NL、FI、GB。
- `CeL(地区)` 永不返回空：对池外地区（如 FR）它按全局序返回别国候选（US 第一），
  即给池外地区发 `rg=FR`，出口必然不是法国——是假国家。
- 因此面板常量 `RG_REGIONS = ['HK','JP','KR','SG','US','DE','GB','NL','SE','FI']`
  （country.mjs:66 并导出），via-proxy 只对这 10 区出 rg 行；其余地区照旧走经典
  bestcf/wetest 反代 IP 池。控制台文案（zh/en）已同步改为此口径。

## 1. yx 地区标记语法

- 语法：yx 条目名称后缀 `@RG`，如 `saas.sin.fan:443#🇩🇪 德国@DE`、`1.2.3.4:443#德国出口@DE`。
- 解析点：engine.mjs `更新自定义优选来源值()`（engine.mjs:5234），名称（含默认名回退后）
  匹配 `/^(.+?)@([A-Z]{2})$/` 时，把地区码存入条目新字段 `rg`、显示名去掉后缀。
  IP 条目存 `{ip, port, isp, rg?}`、域名条目存 `{domain, port, name, rg?}`；
  **无后缀时不写 rg 键**（不是 undefined 占位），行为与此前逐字一致。
- 不误伤既有名称：后缀必须是「恰好两位大写字母结尾」，如
  「加入频道@kejiland00-443-WS-TLS」不匹配，名称与生成结果不变（有用例锁定）。
- 域名条目在 `处理订阅请求()` 的映射（engine.mjs:1322）以
  `...(丁值492.rg ? { rg: 丁值492.rg } : {})` 透传到生成器条目；IP 条目直传列表无需映射。

## 2. 生成器改动点清单（逐个 path 赋值点）

只改三个命名生成器的 path 赋值，渲染器（clash/sing-box/surge/loon/quanx 等共用
link 的 path 字段）一律未动。

| 生成器 | 条目变量 | path 来源 | 赋值点 |
|---|---|---|---|
| `生成链接列表来源源`（vless） | `项目468` | 每条目派生 `条目套接字路径`（engine.mjs:1491）= 带 rg 时 `网页套接字路径471 + '&rg=' + rg`，否则原常量 `'/?ed=2048'` | TLS 分支 `网页套接字参数459`（:1542）、非 TLS 分支 `网页套接字参数456`（:1559） |
| `生成木马链接列表来源源`（trojan） | `项目443` | 同上，派生自 `网页套接字路径446`（engine.mjs:1580） | TLS 分支 `网页套接字参数436`（:1628）、非 TLS 分支 `网页套接字参数`（:1644） |
| `生成扩展超文本链接列表来源源`（xhttp） | `项目68` | 见下方差异说明（engine.mjs:5083） | URLSearchParams 的 `path` 字段（单点） |

不带 rg 的条目 path 逐字不变——`subscriptions.test.mjs` 的黄金哈希用例
（base64/v2ray/surge/loon/quanx 输出哈希）全数通过可证。

**与 brief 的一处事实差异（已按契约实质处理）**：brief 称 xhttp 的 path 同为本地
常量 `'/?ed=2048'`，实际 `生成扩展超文本链接列表来源源` 的 path 是
`` `/${节点路径}` ``（节点路径 = UUID 前 8 位，**没有查询串**）。若照字面追加
`&rg=`，会得到 `/351c9981&rg=DE`——rg 落在路径段里而不是 query，内核读不到。
故 xhttp 带 rg 时生成 `` `/${节点路径}?rg=${rg}` ``，与 WS 的 `/?ed=2048&rg=`
同为 query 参数，符合契约；无 rg 时逐字不变。

未改的同类生成器：`生成链接列表来源新地址列表` / `生成木马链接列表来源新地址列表`
（仓库优选「新地址列表」专用）——其条目来自远程列表解析、结构上永不带 rg，
且 yx 条目从不流经这两个生成器，故不在透传链上。

## 3. via-proxy 混合模式（country.mjs）

新配置：`countryViaProxy`（yes/no，默认 no）、`countryEntryDomain`（默认
`saas.sin.fan`，`sanitizeCountryEntryDomain` 清洗：合法主机名、至少两段、全小写，
非法回落默认；country.mjs:73，engine.mjs:181 有同口径清洗 `清洗国家入口域名`）。

`buildCountryPool` 分工（countryViaProxy 开启时）：

- 配置地区 ∩ RG_REGIONS：每区一条 `<countryEntryDomain>:443#<旗> <中文名>@<代码>`。
- 配置地区 − RG_REGIONS：照旧经典构建（bestcf 主路 + wetest 补量、每区
  countryPerRegion 条、名称无标记）。
- 合并按配置地区顺序逐区拼接（rg 行与经典行交错保序）；全部地区都在
  RG_REGIONS 内时**不发任何远程拉取**；含池外地区才拉源。
- fail-open 不变：经典部分全失败时只剩 rg 行仍返回非 null；rg 地区为空且经典
  全失败才 null。缓存键带 `hybrid` 模式标签并含 per 与域名（与池模式隔离），
  `resolveCountryYx` 的 lastGood 回退共用同一键函数。
- 门控不变：`resolveCountryYx` 先判 countryNodes——countryViaProxy 开但
  countryNodes 关 → 返回 null（有用例锁定）。
- server.mjs 未改：其「国家池 + 手填 yx 拼接」「保留预设优选域名桶」行为保持，
  引擎侧 `国家节点已开启` 判定不变。

引擎命名管线口径（既有行为，非本次引入）：域名条目的节点名统一渲染为
「优选域名-NN」（`获取值节点别名基础` 对非 IP 主机返回固定基名），故 via-proxy
国家节点在客户端里名为优选域名-NN，国家身份由 server（统一域名）+ path 的 rg
承载——与此前手填 saas.sin.fan 条目渲染为「优选域名-01」同口径。经典池的 IP
条目则保留国旗名（如 🇫🇷_法国-01）。

## 4. 配置字段接法（engine.mjs，照 countryNodes 先例）

- 默认值表：`countryViaProxy: 'no'`、`countryEntryDomain: 'saas.sin.fan'`（:141 附近）。
- 清洗：`countryViaProxy` 进 `整理有效配置` 的开关归一列表；`countryEntryDomain`
  经 `清洗国家入口域名` 归一。
- 环境映射：`countryViaProxy: ['countryViaProxy','COUNTRYVIAPROXY','COUNTRY_VIA_PROXY']`、
  `countryEntryDomain: ['countryEntryDomain','COUNTRYENTRYDOMAIN','COUNTRY_ENTRY_DOMAIN']`（:272）。
- 支持探测：`supportsCountryViaProxy = Object.hasOwn(config, 'countryViaProxy')`
  （engine.mjs:90），与 countryNodes 分开探测——旧内核只有国家三键时，旧控件可用、
  新控件禁用并显示「请先更新配套内核」。
- 控制台：国家节点 section 内、countryPerRegion 之后新增开关
  `id="countryViaProxy"`（:2431）与入口域名输入 `id="countryEntryDomain"`（:2437），
  及独立提示行 `id="countryViaProxyHint"`；zh/en 文案按混合口径（10 国列全）。
- 控制台 JS：填充（写入开关值/写入字段值）、收集（读取开关值/读取字段值）、
  禁用时 delete 两键、重置时两键清空，四处均已接。

**内核字段表依赖（面板的假设）**：面板假设内核 F 表含 `countryViaProxy`、
`countryEntryDomain` 两键（内核代理并行补齐）。未补时：控制台新控件禁用并提示
升级、收集配置时不提交这两键，不会触发旧内核整表拒绝。本地测试夹具
`panel/test/core-fixture.mjs` 未改——集成用例以 KV 直接种子这两键（读路径透传
额外键）验证面板逻辑，与内核代理同步 fixture 后的形态一致。

## 5. 测试

`panel/src/test/country.test.mjs` 新增 9 例（原 15 → 24）：

- `sanitizeCountryEntryDomain`：合法保留/大写与尾点归一/URL、带端口、下划线、空值回落。
- `buildCountryPool` via-proxy 纯 RG 配置：零拉取、每区一条 @RG 行、per 不生效、
  自定义域名与非法域名回落。
- `buildCountryPool` 混合模式：DE 出 rg 行、FR 走 fixture bestcf 经典行（保序、
  FR 行无 @ 标记）；经典全失败时只剩 rg 行仍非 null。
- `RG_REGIONS` 内容与内核池覆盖口径逐字一致（10 国集合断言）。
- `resolveCountryYx`：countryViaProxy 开 + countryNodes 关 → null；双开走 via-proxy。
- 引擎默认值：countryViaProxy/countryEntryDomain。
- yx 标记解析（经引擎订阅输出）：IP 与域名条目在 vless/trojan 的 path 尾
  `&rg=<码>`、xhttp 的 `?rg=<码>`；显示名无 `@` 残留；无标记条目 path 逐字不变；
  「加入频道@kejiland00-443-WS-TLS」不被误解析。
- 控制台渲染：via-proxy 两控件存在、按 countryViaProxy 键独立探测禁用/启用、
  内嵌脚本语法可解析。
- 订阅集成（handlePanel + 内核 fixture + KV 种子）：种子
  countryNodes+countryViaProxy 开、地区 DE,JP,FR——clash 中 DE/JP 为
  server=saas.sin.fan 且 path 带 rg=DE/rg=JP，FR 为 bestcf 经典节点
  （🇫🇷_法国-01、server 为池 IP、全局无 rg=FR/@FR），手填 yx 仍追加；
  base64 解码后同样含 rg=DE/rg=JP，FR 链接 path 无 rg。

全量结果：`npm test` **153/153 全绿**（基线 144 + 新增 9，无回归；
含 subscriptions 黄金哈希用例）。

## 6. 未覆盖项

- 内核侧 rg 的读取与 ProxyIP 出口实测不在面板范围（内核代理负责，含其实测的
  各地区出口真实性——面板只保证池外地区不发 rg）。
- via-proxy 国家节点在客户端显示名为「优选域名-NN」（既有命名管线），如需按
  国家显示名需改命名管线，属独立议题、本次未动。
- 未部署；线上开启 countryViaProxy 前需确认内核 F 表已补两键（否则控件禁用，
  属预期保护行为）。
