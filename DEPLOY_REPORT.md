# CFDirect 部署报告（2026-10-25）

## 资源（全新创建，未触碰 CFusion / CFNext 任何资源）

| 项 | 值 |
|---|---|
| Workers | `cfdirect-core`、`cfdirect-panel` |
| KV | `cfdirect-kv`（core 绑 `c`）、`cfdirect-session-kv`（panel 绑 `SESSION_KV`） |
| 域名 | `cfd-core.brodydung.eu.org`、`cfd-panel.brodydung.eu.org`（Workers Custom Domains） |
| 面板绑定 | CORE 服务绑定 → cfdirect-core；`w=https://cfd-core.brodydung.eu.org`；管理口令为 secret_text |
| 凭据 | UUID 与管理口令只存本地 `DEPLOYED.md`（gitignored，确认不在仓库内） |

## 线上验证（部署当日，均为真实请求）

- core 根路径 `hello` 200；`/<UUID>/stats` 返回完整契约（egress=auto、cpuGuard=monitor、计数全零起步）。
- core 配置回读：`eg=auto`、`cpuGuard=monitor`、`freeCpu=no` 默认值正确落盘。
- panel `/health` 200 `{"ok":true}`；控制台 200：CFDIRECT 品牌在、旧 CFUSION 0 处、旧 `sq-` 主题类 0 处、仪表盘区在。
- 管理登录/注销 200；`POST /api/core-stats`（带 uuid 请求体）经服务绑定拿到内核 stats 并原样返回——仪表盘数据链路端到端通。
- 初始配置已按 Brody 在 CFusion 的现行口径预置：`jk=yes`、`wk=JP`（其余默认）。订阅：base64 142 条 vless、clash 142 条 vless 节点、vg 家宽链可生成；订阅内 workers.dev 引用 0。
- 测试：panel `npm test` 129/129；内核独立验证脚本 46 项断言全过；fixture 与 core 逐字节一致。

## 已知口径与未覆盖项

- stats 为 isolate 级计数（实例回收清零、多实例不聚合），面板明示「当前实例窗口，非全量」。
- 断开原因归类为 best-effort：WS close 不带发起方信息，个别竞态下可能误归 upstream_error（定不了性的统一归此）。
- 协议层端到端（真实客户端长流）未在本报告覆盖：以三方稳定性探针（guojia / CFusion / CFDirect 同条件对比）单独出 PROBE_REPORT.md 为准；Brody 体感为最终裁决（DESIGN.md 验收红线）。
