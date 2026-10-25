# CFDirect 稳定性探针报告（第一轮，2026-10-25 深夜）

## 本轮做了什么

用 sing-box 1.14.4 在本机（Muse VM）分别加载 CFDirect 与 CFusion 的 sing-box 订阅，各取前 3 个 vless 节点，逐节点跑：2MB 下载、10MB 下载 ×2、限速 200KB/s 的 10MB 长连接（≈50 秒）。

## 结果：本机探针无区分力（环境全灭，非系统差异）

- CFDirect 3 节点 × 4 项：全失败，且全部在 0.0–0.1 秒内失败（SOCKS5 握手失败 / TLS syscall 中断）。
- CFusion 3 节点 × 4 项：**同样全失败、同样瞬间失败**。
- 判读：失败点在本机出口环境——VM 的一切出站流量经 hatch-egress-proxy（带凭据的 HTTP 代理），sing-box 的原始 TCP 直拨绕不过去；curl 能通是靠代理环境变量，sing-box 不读该变量。用代理凭据给 sing-box 做 detour 属于挪用运行时基础设施凭据，不做。
- 结论：**该探针在本机测的是 VM 出口，不是 guojia / CFusion / CFDirect 的差异**，数据作废，不作为任何一方的成绩。guojia 一腿本轮也未测（其订阅 UUID 从未记录，需要 Brody 提供订阅链接才能构造客户端配置）。

## 改走的验收路径（与 DESIGN.md 验收红线一致，不降格）

1. **同窗 GraphQL 对比**：Brody 切换到 CFDirect 真实使用后，取首个晚高峰窗口，拉 cfdirect-core 的调用量、超限率（exceededResources + loadShed）、各 status 占比与 CPU 分位，与 CFusion 的 10.2% 基准同口径对比。CFusion 就是这样被量出来的，这是目前唯一有区分力的量化通道。
2. **内核自带 stats**：CFDirect 的断连原因计数（client_gone / upstream_error / budget_exceeded / cpu_guard_cut / normal_close）随真实流量积累，面板仪表盘直接可见——CFusion 时代「断了不知道为什么」的问题，这次有数据对账。
3. **Brody 体感终裁**：他日常用的就是 guojia 基准，切换后的稳定性感受（聊天加载、大文件下载、晚高峰视频）即最终标准；不如 guojia 就逐项按 1、2 的数据定位，不以「已部署」结案。

## 待办

- [ ] Brody 切换 CFDirect 后，跑同窗 GraphQL 对账并回填本报告。
- [ ] 若 Brody 提供 guojia 订阅链接，可在他的客户端环境做三方同条件实测（本机环境不具备该条件）。
