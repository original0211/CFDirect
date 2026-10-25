# CFDirect 设计文档

立项：2026-10-25（Brody 指令：落实「CFnew 完整版 v3.0 评审」中的最优迭代想法，新建项目、部署 Cloudflare、面板重新设计）
基底：CFusion（byJoey/cfnew 精简内核 core-only × 自研面板），保留 byJoey 署名与 LICENSE/NOTICE。
**验收红线（Brody 2026-10-25 23:39 追加）：体验要比 guojia 更好、更稳定。** guojia = 2026-03 的 byJoey/cfnew Pages 部署，是 Brody 当前实际在用的基准线；本项目任何一项指标输给它都不算交付。

## 一、要解决的问题（来自 CFusion 的实测，不是猜测）

1. 免费版 10ms CPU 上限下，重流量晚高峰超限率仍有 10.2%（方案 2 后），长流转发是主因。
2. 断连不可解释：clientDisconnected 占比 66.6%，用户只能对着「聊天无法完成加载」猜原因。
3. ProxyIP 链是最不稳定环节（上游 v3.0 的判断成立），但纯直连对 CF 托管目标天然不通，需要自动降级而不是二选一。
4. Free CPU 保护是手动二值开关：开了砍下载，不开烧 CPU，中间没有「只监控不砍」的档位。

## 二、核心设计：三件套

### 1. 出口策略引擎（Egress Policy）
配置 `eg`：`auto`（默认）/ `direct` / `proxyip`。
- `auto`：每条连接先直连（cloudflare:sockets 直连目标），快速失败或在分片预算内无进展 → 自动降级到 ProxyIP 池（沿用方案 2 的总预算：单 episode 总时限 4s、最多 4 个候选）。
- 直连负缓存：直连失败的目标（host 级）在 isolate 内记 TTL 10 分钟，后续连接跳过直连直接走 ProxyIP，避免对 CF 托管目标反复撞墙。
- ProxyIP 健康分：候选按成功/失败计数排序，连续失败 3 次熔断 5 分钟；全部熔断时回落全池轮试（fail-open，不把用户堵死）。
- 已建连接的转发路径不做任何改动；断线重连沿用方案 2 的新 episode 规则（新预算、不继承旧计数）。

### 2. 断连可观测（Stats）
内核维护 isolate 级计数器，端点 `GET /<UUID>/stats`（仅 UUID 路径可达，与订阅同级凭据）：
- 连接总数、直连成功/降级成功/全失败数；
- 断开原因分类：client_gone / upstream_error / budget_exceeded / cpu_guard_cut / normal_close；
- CPU 守卫监控计数（见下）；ProxyIP 各候选成功/失败与熔断状态；
- isolate 启动时间与计数窗口（面板明示「当前实例窗口，非全量」，不冒充全局统计）。
面板首页仪表盘消费该端点（经面板 CORE 服务绑定代理），把「为什么断」摆到第一屏。

### 3. CPU 守卫三档（cpuGuard）
`off` / `monitor`（默认）/ `protect`。
- `monitor`：按上游同口径统计单连接字节数与分片数，超过上游阈值（384KiB / 96 片）只计数（stats.cpuGuardWouldCut++）**不断开**，面板据此提示「若开启 protect，这些连接会被切断」。
- `protect`：即上游 Free CPU 保护行为，触发时计数 cpu_guard_cut 并计入断开原因。
- 默认 monitor 是对 guojia 基准的直接回应：guojia 没有这层砍连接的逻辑，稳定性优先，绝不默认引入新的断流源。

## 三、数据面纪律（对 guojia 的稳定性来源的回应）

guojia 显得稳的可能来源：老内核功能少、单请求轻。CFDirect 对齐并加强：
- 继承 CFusion 全部 CPU 热路径优化（常量表 isolate 级构建、惰性 Error、flush 去拷贝、上传缓冲复用）。
- 新功能一律不进转发热路径：策略判断只在建连期；stats 计数为整数自增；负缓存/健康分查表为 Map 操作。
- 面板侧优化器、订阅缓存等 CFusion 既有能力保留，但不增加内核每请求开销。

## 四、面板重新设计

推翻 CFusion 的 Squarespace 式长卷轴，换运维控制台形态：
- 左侧固定导航（仪表盘 / 订阅与客户端 / 配置 / 优选 IP / 系统状态），右侧内容区，顶部状态条只留品牌、核心版本、出口模式徽标、保存动作。
- 第一屏 = 仪表盘：出口健康（直连成功率、降级率、ProxyIP 池可用数）、断连原因分布、CPU 守卫状态与监控计数、近窗口连接数。
- 视觉：浅底 #f7f7f5、墨色 #16161a、单一强调色 Cloudflare 橙 #f6821f、等宽数字；简体中文 + English（沿用双语资产）。
- 配置页沿用 CFusion 的字段口径与防漂移守卫，新增 `eg` 与 `cpuGuard` 两项（含进关键字段表，fail-closed 不变）。

## 五、验收标准（对 guojia 基准）

1. 功能：订阅（clash/vg/base64 等）与 CFusion 同口径全通；配置保存/防漂移/管理登录全通；测试套件全绿（CFusion 122 项适配后 + 新增策略/stats/守卫测试）。
2. 同窗对比（部署后首个晚高峰窗口）：CFDirect 内核超限率须低于 CFusion 的 10.2% 基准；断连原因每一类都有计数、无「未知」黑洞。
3. 脚本化稳定性探针：同一客户端配置分别走 guojia / CFusion / CFDirect，对同一批目标做重复下载与长连接保持测试，CFDirect 的完成率与中断次数不得差于 guojia。探针结果写 PROBE_REPORT.md，输了就写输在哪，不粉饰。
4. Brody 体感为最终裁决：他切换使用后若反馈不如 guojia，逐项按 stats 与探针对照定位，不以「已部署」结案。

## 六、资源命名（全新，不碰 CFusion/CFNext 任何资源）

- Workers：`cfdirect-core`、`cfdirect-panel`；KV：`cfdirect-kv`、`cfdirect-session-kv`。
- 域名：`cfd-core.brodydung.eu.org`、`cfd-panel.brodydung.eu.org`。
- GitHub：`original0211/CFDirect`（public）。
- UUID 与管理口令新生成，只存本项目 DEPLOYED.md（gitignored，永不入仓）。
