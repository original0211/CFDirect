# CFDirect 国家节点（按国家/地区成组展现）施工报告

- 时间：2026-10-26
- 提交：`55b3107`（池构建）、`36a7f3d`（配置/控件/订阅接入/测试）
- 范围：只改 `panel/**` 与新增文件；未碰 `core/_worker.js`、`panel/test/core-fixture.mjs`；未部署；未动 CFusion；无任何凭据写入。
- 外部模型调用：0 次（全程本模型施工与自核）。

## 功能概述

订阅开启 `countryNodes` 后，面板在生成订阅时实时构建「国家池」：按配置的地区逐个成组产出节点，节点名 CFNext 风格 `🇯🇵 日本-01`（旗帜 + 中文名 + 两位序号），国家池为主、手填 yx 追加在后。效果与 CFNext 的按国家分组展现一致（节点在订阅里按地区顺序连续排列）。

## 数据源与覆盖范围

新建 `panel/src/country.mjs`，数据源全部复用 optimizer.mjs 既有资产，未另造拉取/解析轮子：

| 路 | 来源 | 覆盖 | 说明 |
|---|---|---|---|
| 主路 | bestcf 地区列表（`FALLBACK_LISTS`，`https://bestcf.pages.dev/random-region/<区>/100.txt`） | HK / JP / US / SG / TW 共 5 区 | 行解析正则与 `buildCandidatePool` 的兜底段一致（裸 IPv4 或 IPv4:端口），走 optimizer 已导出的 `fetchText`（本次给它加了 `export`，同一 SSRF 防护通道） |
| 补量 | wetest_v4 全量池（`OPTIMIZER_SOURCES.wetest_v4`） | 7 区（含 KR、DE） | 经 `parseCandidateText` 解析后按 `REGION_ALIASES` 的备注名别名（代码/英文/中文，如 JP/Japan/日本/东京）归属地区；与优选引擎预设模式同口径，IP 条目须落在 Cloudflare 地址段（`isCloudflareIp`），域名条目豁免 |

- **KR、DE 没有 bestcf 地区列表**，只能靠 wetest 补量一路；wetest 页面里没有某区条目时该区整组跳过（不产生空组）。
- 每区先主路、不足 `countryPerRegion` 时按 wetest 顺序补量，按 IP 去重，输出顺序严格按配置地区顺序（并发拉取后按地区下标回填，不乱序）。
- 节点行格式与 `formatEntry` 完全一致（`ip:port#名`，IPv6 加方括号），可直接作为 yx 输入喂给现有引擎。

## 接法

- **配置字段**（照 eg/cpuGuard 完整接法，engine.mjs）：默认值 `countryNodes:'no'`、`countryRegions:'HK,JP,US,SG,TW,KR,DE'`、`countryPerRegion:'8'`；`整理有效配置` 里 countryNodes 进开关归一列表、地区走清洗（大写、只留 7 个合法代码、去重保序、空回落默认全量）、每区数量 parseInt 后钳制 1–20（非数字回落 8）；环境变量映射补三键别名；**未进防漂移关键集**（`CRITICAL_CONFIG_KEYS` 未动，按任务书要求）。
- **支持探测**：与 eg/cpuGuard 同口径——内核配置里无 `countryNodes` 键时判定旧内核，控件 disabled 并显示「请先更新配套内核」，且收集/重置时不提交这三个键，避免旧内核整表拒绝保存。
- **控制台控件**：在「优选 IP」的 otherConfigForm 内、yxURL 块之后新增 `countrySection`：启用开关 + 地区文本框 + 每区数量（number 1–20），zh/en 双语文案，说明开启后订阅以国家节点为主、手填追加在后，并列出当前数据源覆盖的 7 个地区。
- **订阅接入**（server.mjs，与 optimizer 同位置）：订阅请求且缓存未命中时，先 `resolveCountryYx(config)` → 非 null 时 `effectiveConfig.yx = 国家池 + '\n' + 手填 yx（若有）`；为 null 时才走原 `resolveOptimizerYx` 流程。页面渲染仍用原配置。

## 优先级

**countryNodes > optimizerAuto**：两者同时开启且国家池构建成功时，国家池完全接管（optimizer 不再替换 yx，手填仍追加）；国家池失败/为空时自动落回 optimizer 原流程。理由：国家节点的诉求是「订阅以国家分组为主」，与 optimizer 的「单池优选替换」互斥，前者开启即应完整生效，而不是两池混合导致分组被打散。

## 缓存键处理

查 `buildSubCacheKey`（subcache.mjs）：键 = host + uuid + target + method + User-Agent，**不含任何配置内容**（optimizer 的 yx 也不在键内，现口径如此）。防串味靠两点：① 任何配置保存成功后 server 会 `subCache.invalidateWorker(workerBase, uuid)` 全量失效该 Worker 的订阅缓存；② 缓存 TTL 60 秒兜底。国家池内容（随外部源变化）与 optimizerYx 同性质，**结论：不把 countryNodes 相关字段或池内容纳入缓存键**，与现状口径一致——配置变更走保存失效、池内容陈旧最多 60 秒。国家池自身另有模块级 10 分钟缓存 + `lastGood` 上次成功池兜底（仿 `resolveOptimizerYx`），外部源抖动时优先用旧池而不是整池消失。

## fail-open 口径

- 单区拉取失败 → 跳过该区；wetest 失败 → 只少补量；全部失败/为空 → `resolveCountryYx` 返回 null → 订阅完全走原流程（optimizer 或手填）。
- 构建抛异常 → 回退同配置的 lastGood 池，再无则 null；任何情况下不抛错阻断订阅生成。

## 命名在客户端里的实际形态（须知）

yx 层节点名是精确的 `🇯🇵 日本-01`（单测在池文本层断言）。经引擎既有命名管线输出到 clash 时，会被渲染为 `🇯🇵_日本-01-01`：空格→下划线、并追加引擎自己的 `-NN` 序号后缀——这是引擎对**所有** yx 来源节点的一致行为（如手填「手填节点」渲染为「手填节点-01」），非国家节点特有。本次未改引擎命名管线（改它会波及全部既有节点命名，超出任务范围）；集成测试按渲染形态断言并在用例内注明了这一口径。

## 测试结果

- 新增 `panel/src/test/country.test.mjs` 共 12 例，全程零外网（fixture deps 假拉取 + 本地内核 fixture）：
  - builder：地区清洗/数量钳制/命名格式、多区成功（bestcf 截断、wetest 补量与别名归属、非 CF 地址过滤、无数据区跳过、顺序保持）、单区失败跳过、全失败 null、未开启零拉取、lastGood 回退；
  - 引擎：三字段默认值；
  - 订阅集成（handlePanel + 内核 fixture + `globalThis.__CFDIRECT_COUNTRY_DEPS__` 注入假拉取，与 runtime 的 `__CFUSION_OUTBOUND__` 注入先例同口径）：开启后 clash 出现 `🇯🇵_日本-01/-02` 且在手填之前、无 -03（截断生效）；关闭时无国家节点、与现状一致；国家池全失败时 fail-open 回退手填；
  - 控制台渲染：控件存在，旧内核（配置无键）禁用、新内核（配置有键）可操作，双语页面脚本可编译。
- 全量 `npm test`：**141/141 全绿**（基线 129 + 新增 12），无回归。

## 未覆盖项 / 生产落地前置条件（重要）

1. **内核字段表未含 country 三键**：`core/_worker.js` 的 POST /api/config 对不在其默认值表中的键整表拒绝（400）。本任务红线禁改 core，故面板侧已按 eg/cpuGuard 先例做了支持探测与禁用保护，但**生产要真正开启此功能，还需给内核默认值表补 `countryNodes/countryRegions/countryPerRegion` 三键并重新部署内核**（与 eg/cpuGuard 当初的上线路径相同，属本任务范围外）。在那之前，线上控制台会显示控件但处于禁用态、提示升级内核，不会误存坏配置。集成测试用 KV 直接种子配置（读路径透传额外键）验证的是面板订阅逻辑本身。
2. **未部署**：按红线只提交代码，面板 Worker 未重新部署，线上暂无此功能。
3. **真实数据源未实拉验证**：单测全部走 fixture（与仓库既有测试口径一致，零外网）；bestcf/wetest 的真实页面结构若已漂移，builder 会 fail-open 回退原流程，不会把订阅弄坏，但国家组可能为空——上线后建议用真实订阅拉一次核对各区条数。
4. wetest 补量的地区归属靠备注名别名包含匹配，备注写法变化（如新别名）可能漏归属；漏了只少补量，主路不受影响。

## 线上落地补记（2026-10-26 主线）

- 内核字段表已补三键（commit a17dcd1：F 默认值 + 环境别名 + countryNodes 布尔归一），core+panel 已重新部署，线上实例已开启 countryNodes、地区设为 HK,JP,US,SG,TW。
- 首轮线上验证发现主路全灭：bestcf 真实行格式为「IP:端口#地区随机 | 日本 JP | KIX | …」，country.mjs 的裸 IP 正则零命中；wetest HTML 页只能解析出无名条目、无地区标注，补量路同样为空。已修复（主路改用 parseCandidateText + 真实格式回归用例，测试 142/142），面板二次部署后线上 clash 订阅实测：5 区 × 8 = 40 个国家节点（🇯🇵_日本-01-01 式渲染名），base64 订阅同样 40 条国家命名链接。
- KR/DE 结论修正：目前没有可用数据源（bestcf 无此二区列表、wetest 无地区标注），控制台文案已改为实情，默认地区清单线上设为 5 区。

## 扩区补记（2026-10-26 主线）

- Brody 追问欧洲：逐区实测 bestcf random-region 实际支持 25 区（此前 FALLBACK_LISTS 只注册了 5 区，是注册表不全、不是数据源没有）。已全量注册：亚洲 港日韩新台、北美 美加、欧洲 17 国（德法英荷瑞典西班牙意大利波兰瑞士芬兰捷克奥地利丹麦爱尔兰挪威比利时葡萄牙）、澳大利亚；KR 同步由「无源」翻案（池实测 60 条）。线上实例地区清单设为全 25 区。
- 扩区首轮线上全灭教训：fetch 运行时每次受防护拉取 = 2 次 DoH 子请求 + 1 次拉取，25 区 × 3 = 75+ 子请求，撞穿 Workers 免费版「每请求 50 子请求」上限 → 全区失败 → fail-open 回基线。修复：构建期共享 DoH 解析（同 host 一轮只解析一次，子请求降到约 30），补 createSharedResolver 回归用例（全量 143/143）。
- 修复后线上实测：25 区全 present，国家节点 195 个（23 区 × 8 + 比利时 6 + 葡萄牙 5，两池本身不足 8）。

## 稳定性补记（2026-10-26 下午）

- Brody 实测对比：guojia 的「加入频道@kejiland00-443-WS-TLS」（优选域名入口、太原电信 83ms）下载流畅、muse 不断；CFDirect 节点不稳、下载慢、muse 偶断。归因：国家节点是海外第三方反代 IP（多一跳中转、带宽共享、长连接易被中转方掐断），结构上只适合选地区、不适合日常主力；优选域名解析到 CF Anycast、由 CF 按 BGP 就近接入，第一跳质量完全不同。
- 已修复一处自家回归：国家池占用 yx 后，引擎会整体跳过预设优选域名桶——这批国内路由友好的域名入口被顶掉了。现国家模式下同时保留域名桶（线上实测 195 国家 + 42 优选域名 + 分组 15）。远程 IP 桶不补（来源不稳、与国家池重叠）。
- 待 Brody 提供 kejiland 节点 server 地址（或 guojia 订阅链接）后，把同一入口域名置顶加入 CFDirect 手填优选，做同入口对照；若同入口下仍断，再用内核 stats 查出口侧（eg/ProxyIP）归因。
- 后续：Brody 提供 guojia 订阅链接，提取到 kejiland 节点入口为 saas.sin.fan（CF Anycast 162.159.130.234/162.159.135.234），已以手填 yx 加入 CFDirect 并线上确认在场（渲染名 优选域名-01，clash 与 base64 订阅均含此入口）。链接用完即弃、UUID 未入库。
- rg 出口已上线（2026-10-26 晚）：内核支持路径 rg=国家码按连接选该国 ProxyIP 池优先出站（验证 66/66），面板 via-proxy 混合模式（153/153）——池内 10 国（港日韩新美德英荷瑞典芬兰）出 saas.sin.fan 入口 + rg 节点（国旗名保留），池外 15 区照旧经典反代节点；线上实例已开启，实测订阅 10 个 rg 节点 + 115 个经典国家节点 + 优选域名桶，stats 已含 rg.used/fallback 计数待真实流量验证。
- 2026-10-26 21:40 出口复核：Brody 报 10 个 rg 节点出口全显示日本千叶。主线用手写 vless/WS 探针（scripts/probe-rg-exit.py）驱动线上内核实测：rg=DE→DE、US→US、GB→GB、NL→NL、JP→JP（CF trace 的 ip/loc），内核 rg 链路端到端无误；无 rg 时为直连 CF 出口。初步指向客户端侧未把 rg 带上（订阅未刷新/客户端改写 path/测的是其他节点类型），待 Brody 核对客户端内节点 path 字段。注：公共 ProxyIP 中继对非 CF 目标（checkip.amazonaws.com）握手异常，对 CF 目标正常——属中继的目标相关怪癖，非本次故障。
- 2026-10-26 22:30 千叶问题根因确认并修复：Brody 的客户端是 Karing（sing-box 内核）——sing-box 构造 WS 请求 URL 时把 path 中的 ? 转义，查询串里的 rg 丢失，连接回落实例默认地区 JP（wk 预设），故 10 国出口全是千叶。修复：rg 改走路径段 /rg-XX/?ed=2048（XHTTP 为 /uuid8/rg-XX），内核新增 zzRgP 路径优先、查询兜底（harness 72/72、面板 153/153）；线上探针新旧两形式均验证出口正确，线上订阅已确认 10 条新路径在发。Brody 在 Karing 刷新订阅后复测。
- 2026-10-26 22:35–22:47 池优先废弃（重要修正）：Brody 在 Karing 刷新订阅后报 10 个 rg 节点全部超时。探针矩阵实证根因：公共 ProxyIP 中继只对 CF 托管目标透明转发——非 CF 目标经中继 TLS 被打碎（ifconfig.me 证书错配、google 握手失败），而池优先让所有流量先撞中继、TCP 层又判不出失败、永不回落直连，于是 Karing 测速（gstatic）与非 CF 站点全灭；CF 目标（muse/trace）则一直正常。修复：rg 改为「降级定地区」——顺序恢复直连优先，直连失败降级时按 rg 选该国池（Ke/Hn 同步，Hn 的 eg=direct 绕令去除），harness B5 按新口径重写 71/71、面板 153/153，内核已部署；复测 google/ifconfig.me 经 rg 节点恢复正常。代价（如实）：直连成功时出口是 CF 边缘 IP、国家标签不保证；国家出口只在降级走中继时兑现。国家真实性更强的仍是经典反代节点（入口 colo 定地区）。
- 2026-10-27 18:47 target=vg 503 修复：Brody 在 KFusion 添加订阅（target=vg）报 HTTP 503。根因是订阅冷构建的子请求总账：国家池冷拉（~17）＋方案 A 逐域名 DoH 扇出（单域名最坏 4 次、解析不可见域名尤甚）＋家宽列表拉取，叠加超过免费版 50 上限；clash/base64 因 subCache 与热 isolate 幸免，vg 低频必冷构建必死。治理：① 国家池文本与 ② 方案 A 解析图双双改存 SESSION_KV 跨 isolate 复用（cfd:cpool:* / cfd:dnsipmap:v1，冷构建近零拉取）；③ DoH 提供商顺序改 Workers 出口可见优先、单轮 DoH 预算封顶 24 次兜底；④ vg 503 返回前也回写解析图。测试 159/159（新增 KV 池缓存/解析图两例），已部署；复测 vg 连打 6 次全 200、clash/singbox/base64 全 200，方案 A 形态与 18:15 验收一致（128 IP + 40 域名 server、rg 路径 10 条）。
- 2026-10-27 19:1x 家宽节点骤减修复：Brody 报家宽「没几个、大部分超时」。线上 vg 订阅只剩 4 个 openvpn 节点（10-22 CFusion 时期为 40）。根因：获取家宽节点的「边缘连通性过滤」（jk-probe，每节点一次 cloudflare:sockets connect）在 CFDirect 更重的订阅构建里与国家池/方案 A 共享 50 子请求上限，预算中途耗尽后未探到的节点被误判不可达整批剔除，只剩最先探的 4 个。处置：渲染路径停用该过滤（模块与单测保留），解析出的 VPNGate 住宅 TCP 节点全量下发，死活由客户端「家宽自动」url-test/fallback 实时判（志愿者上下线以分钟计，边缘探测本就速朽）。已部署，实测 openvpn 节点 4→67；159/159。
