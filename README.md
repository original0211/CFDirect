# CFDirect

**直连优先、自动降级、断连可解释**的 Cloudflare 代理：byJoey/cfnew 精简内核 × 全新运维控制台面板。

立项背景与完整设计：[DESIGN.md](./DESIGN.md)。一句话概括它和同类项目的区别：

- **出口策略引擎（`eg=auto`，默认）**：每条连接先直连，失败自动降级到 ProxyIP 池；直连失败的目标进负缓存（10 分钟）不再反复撞墙；ProxyIP 候选带健康分与熔断，全池熔断时 fail-open 不堵死用户。降级链沿用总预算：单次建连总时限 4 秒、最多 4 个候选。
- **断连可观测**：内核维护连接与断开计数（`/<UUID>/stats`），五类断开原因（客户端离开 / 上游错误 / 预算耗尽 / CPU 守卫切断 / 正常关闭）全部计数，面板第一屏仪表盘直接展示——断了能看到为什么断。
- **CPU 守卫三档（`cpuGuard`）**：`off` / `monitor`（默认，只统计「若开启保护会被切断」的连接，**不断开**）/ `protect`（上游 Free CPU 保护行为）。免费版 10ms CPU 上限下，先看清再决定砍不砍。
- **面板重新设计**：左侧导航 + 顶部状态条的运维控制台，第一屏是出口健康仪表盘；浅底墨字、单一强调橙、等宽数字；简体中文 + English。

实施报告：[KERNEL_REPORT.md](./KERNEL_REPORT.md)、[PANEL_REPORT.md](./PANEL_REPORT.md)、[DEPLOY_REPORT.md](./DEPLOY_REPORT.md)。

## 结构

```
core/    精简内核（单文件 _worker.js）：代理转发 + KV 配置 + 出口策略 + stats
panel/   独立面板：订阅生成、优选引擎、配置管理、仪表盘
scripts/ 部署脚本与内核验证脚本
```

## 来源与署名

本项目是二次开发，不是完全原创：

- `core/_worker.js` 与 `panel/` 基底来自 **byJoey** 的 [cfnew](https://github.com/byJoey/cfnew)（core-only 分支）与 [cfnew-panel](https://github.com/byJoey/cfnew-panel)，经 [CFusion](https://github.com/original0211/CFusion) 的 CPU 热路径优化、ProxyIP 总预算与面板工程化后，在此继续迭代。其许可要求衍生版本保留来源与署名——原件许可见 `panel/LICENSE`，署名见 `panel/NOTICE.md` 与根目录 `NOTICE.md`。
- 优选引擎逻辑（wetest 源、筛选、自动池）移植自 **PAICNI/CFNext** 及自有改进 fork。

## 本地运行面板

```bash
cd panel
npm start   # Node 22+，默认监听 127.0.0.1:3100
npm test    # 自带测试套件（129 项）
```
