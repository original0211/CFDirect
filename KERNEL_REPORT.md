# KERNEL_REPORT —— CFDirect 内核施工报告（2026-10-25）

施工范围：仅 `core/_worker.js`（与 `panel/test/core-fixture.mjs` 逐字节同步）、
`scripts/verify-kernel.mjs`（新增）、本报告。未碰 panel/src、未部署、未动 CFusion。
基线：7d12d6c（CFusion 方案 2 内核，39,205 字节）→ 终态 42,817 字节（+3,612）。

## 1. 现状链路（动手前核查，与 PROXYIP_BUDGET_REPORT 一致）

- 入口 `Wn.fetch` → 每请求新建 `$n(env)` 闭包 → 路由 `On()`：先读 KV 配置
  （`Bn` 30s 缓存）→ `ie()` 合并（env 别名表 `Nt` → KV 覆盖 `M` → 默认表 `F`，
  `Ht` 归一化）→ `Dn()` 把配置灌进闭包变量（Q/q/j 由 `qj` 解析、N=p、J/B 地区、
  `v=pt(freeCpu==="yes")`）。
- WS 路径 `an()`：协议解析后调 `Ke()`。Ke 的 episode 结构：主试 1 次
  （`y=q&&w ? 出站代理 nt() : Q ? Le 直连竞速 : w ? nt() : Le`）→ 失败走
  `H()` 兜底（q&&w 直接放弃；Q&&w 先 nt 重试再 `px()`；否则 `px(w)`）；
  `px()` 在方案 2 预算（`zzp={ms:4000,n:4}`、episode 截止 `ep.d`）内轮试
  ProxyIP 候选（自定义 `p` 只试 1 个，否则 `CeL()` 列表）。已建连断开由
  `Ke` 的 `L()` 回调经 `H(!0)` 以**新预算**重连。
- XHTTP 路径 `Rn()`→`Hn()`：同构（主试 `o()`=Le / `a()`=nt → `px()` 兜底，
  失败返回 null）。`st=45s` 为会话存活上限。
- freeCpu：`pt(enabled)` 是每请求闭包的预算实例，`consume()` 在 WS 泵
  （`et` 等）与 XHTTP 泵共 7 处被调用，超限（384KiB / 96 分片）抛
  `FREE_CPU_BUDGET` 并触发 `onExhausted` 订阅者拆连。`v.enabled` 还被
  an()/XHTTP 泵用作缓冲尺寸与让步节奏开关。
- **关键约束**：`$n` 闭包每请求新建——跨请求的计数器/缓存只能放模块级
  （zzf/zzn/zzb 的既有模式），本次新增模块级 `zzs` 即循此例。

## 2. 改动与接入点

### 2.1 出口策略引擎（配置 `eg`，F 默认 `"auto"`，Nt 别名 `eg/EG`）
`Dn()` 解析：`Eg ∈ {direct, proxyip}` 取原值，其余（含缺省/非法）回落 `"auto"`。

- **proxyip**：`Ke`/`Hn` 逻辑与方案 2 **逐字不变**（不读负缓存、不重排候选）；
  仅多记健康计数（纯计数，不影响行为）。
- **direct**：`Ke.px()` 入口直接返回 false；`Hn.px()` 入口直接抛错。出站代理
  （SOCKS `nt()`）不是 ProxyIP，direct 下保留原有 nt 尝试/重试，语义为
  「不用 ProxyIP 兜底」。
- **auto**：
  - 直连优先即现有主试（Le 直连或 nt 出站，视 qj/s 配置——「直连」口径 =
    非 ProxyIP 的主尝试，与现网行为一致，不新造路径）。
  - 负缓存：主试为 Le 直连（`y===false` / `u===false`）且失败、且非守卫耗尽
    时，`zzS().neg.set(host, now+10min)`；下次同 host 在 auto 下主试前命中
    `zzNeg()` 即跳过直连、直接走原兜底分支（Ke 走 `H()`、Hn 走 catch 兜底）。
    qj="only"（q&&w）是用户显式出站独占，其 `H()` 放弃语义不被 eg 覆盖
    （该模式下主试永不为 Le，负缓存永不写入，天然不冲突）。
  - 健康分/熔断：模块级 `zzS().pool`（key=`地址:端口`）记 ok/fail/连续失败
    cf/熔断截止 until。`px()` 每次尝试后 `zzOk`/`zzBad`（cf≥3 → until=
    now+5min）。auto 下进循环前 `zzOrd()`：剔除熔断中的候选、按 cf 升序；
    全部熔断时回落全池（fail-open）；自定义 `p` 单候选不重排（剔除逻辑对
    单元素列表在 zzOrd 内短路，且全熔断回落亦覆盖）。

### 2.2 Stats（模块级 `zzS()`，路由 `GET /<uuid>/stats`）
路由插在 `/region` 之前，沿用 `u()` 的 UUID 前缀匹配（无前缀 404 已验证）。

计数接入点与口径：
- `total`：Ke / Hn 每次调用 +1（= 一次建连 episode；XHTTP 每 POST 一次，
  与其「每请求一连接」的模型一致）。
- `direct_ok`：主试成功（Ke 主试、Ke 在 Q&&w 兜底里的 nt 重试成功、Hn 主试、
  Hn 在 Q&&j 分支的 nt 重试成功）。口径：非 ProxyIP 路径的成功，含 SOCKS
  出站（现网未启用 `s`，实际即 Le 直连）。
- `fallback_ok`：`px()` 内任一候选成功（Ke/Hn 各一处）。
- `all_failed`：Ke 的 `H()` 三个放弃点统一走 `fl()` 计数（含重连 episode 的
  最终放弃——重连失败计 failed 但不重复计 total，面板展示时以 total 为
  分母需知此不对称）；Hn 两处 `return null` 前走 `fl()`。
- 断开原因（仅已建连会话的收尾计一次，WS 在 `an()` 的 `L()` 首跑处、
  XHTTP 在 `Rn()` 的 race finally 处；`v.exhausted` 时跳过——那是守卫
  切断，已由 cpu_guard_cut 计）：
  - `client_gone`：客户端 close 先到且远端 socket 尚在（`zst.cc && !zst.rg`；
    cc 由注册在 L 之前的一个 close 监听捕获，含关闭码）。
  - `normal_close`：远端先结束（rg）且客户端随后以 1000 关闭；XHTTP 侧
    downloader/uploader 正常完成或 45s 存活上限到达。
  - `upstream_error`：其余收尾（远端异常关闭、泵错误、XHTTP 泵出错），
    以及**无法可靠定性的收尾一律归此**——这是设计口径，不是精确归因：
    WS 的 close 事件不携带发起方信息，cc/rg 双标志是尽力而为的判别，
    竞态下（如客户端与远端几乎同时关闭）可能误归 upstream_error。
  - `budget_exceeded`：episode 放弃时截止已过或候选数已满
    （`dl()<=0 || ep.k>=zzp.n`），与 all_failed 同时计（它是 failed 的
    原因子集，不是互斥分类）。
  - `cpu_guard_cut`：pt protect 档在 `k` 翻转点经 `onCut` 钩子计（Dn 注册，
    钩子只碰模块计数器）。XHTTP 会话跨多个请求、每请求一个 pt 实例，
    同一逻辑会话理论上可被多次翻转各计一次——WS（单请求单会话）口径
    精确，XHTTP 为近似，面板文案应按「切断次数」而非「被切会话数」理解。
- `guard.wouldCut / cut`：见 2.3。`proxyipPool` 快照与 `directNegCache.entries`
  随 /stats 返回；`startedAt/windowSec` 为 isolate 启动时刻与窗口（面板需
  明示「当前实例窗口」——isolate 回收即清零，多 isolate 间不聚合）。

会话状态载体：`$n` 闭包变量 `zst`（{est, via, rg, cc, code}），Ke/Hn 在
成功点写入、Ke 的远端 close 回调置 rg、an() 读取判读。闭包每请求新建、
每请求至多一个会话，无并发串扰。

### 2.3 cpuGuard 三档（F 默认 `"monitor"`，Nt 别名 `cpuGuard/CPUGUARD/CPU_GUARD`）
`pt()` 改为档位制：入参 2=protect / 1=monitor / 0=off，兼容旧布尔
（true→2、false→0，其余调用点 `pt(!1)` 与 `v.enabled` 语义不变：
`enabled` 仅 protect 为 true——缓冲尺寸与泵让步节奏与 freeCpu=yes/no
旧行为逐项一致，monitor 不改变它们）。
`Dn()` 定档：`cpuGuard==="protect" || freeCpu==="yes"` → protect（旧字段
兼容优先）；`cpuGuard==="off"` → off；其余 → monitor（默认）。
- protect：与旧 freeCpu=yes 同一代码路径（阈值同为 384KiB/96、抛
  FREE_CPU_BUDGET、onExhausted 拆连），另加 onCut 计数钩子。
- monitor：复用 protect 的同一 `consume()` 计数点（字节+分片同口径累计），
  跨阈值时置 `wouldCut` 并触发 `onWouldCut` 一次（Dn 钩子 →
  guard.wouldCut++），**不抛错、不断开、不置 exhausted**；跨越后 consume
  直接返回（停止累计，计数语义为「该连接已越线」而非越线后流量）。
- off：consume 直接返回，不计不断。

## 3. 验证

- 语法：`node --check`（.mjs 模块解析）通过。
- 面板全量：`cd panel && npm test` **122/122 通过**（fixture 已同步新内核，
  cmp 逐字节一致）。注意：新配置键 eg/cpuGuard 已进内核 F 表，内核侧
  `/api/config` 保存校验（键须在 F 内）因此放行；面板侧字段表由面板施工
  代理同步，本报告不越界。
- 独立验证 `scripts/verify-kernel.mjs`：**46 项断言全过**，均为真实执行：
  - A 组（Worker 级，面板测试同款加载：剥 sockets 导入 + data-URL +
    KV mock）：/stats 默认值、eg/cpuGuard 保存后 stats 实时反映、
    freeCpu=yes 对 cpuGuard=off 的兼容优先级（→protect）、eg=bogus 回落
    auto、无 UUID 前缀 404、/region 完好。
  - B1（pt 原文提取）：三档阈值/分片、monitor 只计一次不断开、protect
    抛错与双钩子、布尔兼容。
  - B2（zz 原文提取）：负缓存 TTL 命中/过期删除、健康排序、3 次熔断、
    熔断跳过、全熔断 fail-open、成功清零。
  - B3（Hn 原文提取 + 假 Le/nt/CeL/ye）：auto 直连/降级/负缓存跳步、
    proxyip 无负缓存（方案 2 对照）、direct 不碰 ProxyIP、全失败 failed
    计数、候选熔断与 fail-open、全挂死 ≈4s（实测 3900–6000ms 窗口内）
    判失败且 budget_exceeded=1。
  - B4（Ke 原文提取 + 假件）：同 B3 的 WS 版分支（直连/降级/负缓存/
    direct 放弃且 G 收尾一次/proxyip 对照）。

## 4. 未覆盖项与风险

- **协议层未在本脚本覆盖**：Node 无 WebSocketPair，an() 的 VLESS/Trojan
  握手与 Ke 的真实 socket 泵送、Tn 的 XHTTP 帧解析未做端到端执行；
  Ke/Hn 本体由提取 harness 覆盖，协议层沿用基线 122 项测试与现网既有
  行为（本次未改协议代码）。真实流量验证须待部署后由主线完成。
- **stats 为 isolate 级**：多 isolate 并行时面板只读到命中那一个 isolate
  的计数；isolate 回收清零。已在 /stats 返回 startedAt/windowSec 供面板
  明示口径，未做 KV 聚合（设计如此，后续如需全局口径再立项）。
- **断开原因 best-effort**：client_gone / normal_close / upstream_error 的
  判别依赖 cc/rg 双标志与关闭码，竞态下有误归（见 2.2 口径说明）；
  budget_exceeded 与 all_failed 非互斥；cpu_guard_cut 在 XHTTP 跨请求
  场景为近似计数。
- **负缓存粒度为 host**：同 host 不同端口共用一条（端口在 key 外）——
  有意为之（CF 托管判定按 host），但同 host 某端口直连失败会让其它
  端口 10 分钟内也跳直连，影响面有限且有 ProxyIP 兜底。
- **健康分在 proxyip 模式只记不用**：为守「方案 2 行为不变」的红线，
  proxyip 模式候选顺序仍为 CeL 原序；健康排序/熔断跳过只在 auto 生效。
- **Pi/OpenRouter 用量：0 次。** 本次改动点全部位于标识符压缩的单文件
  内核，锚点与闭包关系需在完整上下文内逐项核对，外部模型无此上下文，
  起草产出仍需逐行复核、净收益为负，故未调用；全部代码与测试由本代理
  亲自完成并以 122 项套件 + 46 项断言复核。
