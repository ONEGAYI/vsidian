# 原生 HTML 批次性能收口测量（#574 / T09）

## 测量对象与目的

T02–T08 落地原生 HTML 渲染（块级/行内 widget、净化、文档内 `<style>` 装载、资源归属解析、媒体/iframe/SVG/MathML）后的针对性性能档位，验证：

1. **视口有界性保持**——HTML widget 与文档样式产物不破坏「全文模型与视口 DOM 分离」（ADR-0005）；不以常驻全文 DOM 兑现 CSS。
2. **输入延迟不劣化**——HTML 密集文档与样式源文编辑的逐字符输入延迟与纯文本基线同量级。
3. **离屏资源回收**——图片密集 HTML 文档的块挂载/卸载窗口有界，DOM 内图片槽位保持视口规模。

## 规模与环境

| 项 | 值 |
|---|---|
| 测量时间 | 2026-10-17（报告 `startedAt` 2026-10-17T01:52:46Z） |
| 宿主 | VSCode **1.86.2** 便携宿主（性能档历史固定版本——与既有 `docs/perf/data/perf-report.json` 全部数据同宿主，跨批次对比不换宿主） |
| 驱动 | `PERF_SCOPES=html node test/perf/runPerf.mjs docs/perf/data/html-574`（HTML 档定向；探针经 `_test.perfProbe`/`_test.readingPerf` 生产钩子，键入与真实 dispatch 同构） |
| 报告 | [data/html-574/perf-report.json](data/html-574/perf-report.json)（既有基线 [data/perf-report.json](data/perf-report.json) 未动） |
| 日志 | `out/test/t09-perf-html.log`（退出码 0） |

档位与规模（生成器 `test/perf/gen-sample.mjs`，#574 新增）：

| 档位 | 规模 | 载体 |
|---|---|---|
| htmlMany | 600 片段 / 4404 行 / 116 KB | 块级表格、短 div（含行内 span 混排）与段落交替 |
| htmlLong | 2000 片段 / 14674 行 / 389 KB | 同构 ×3.3 体量档（对比 DOM 有界性） |
| htmlGiantTable | 单表 400 行×4 列（稀疏 colspan/rowspan）/ 38 KB | 单块大体量 |
| htmlStyle | `<style>` 400 规则 + 120 消费块 / 29 KB | 样式源文编辑（探针键入按 fixture 设计落在样式块源文内） |
| htmlImageDense | 300 个含 `<img>` 的 HTML 块（引用 24 张 probe SVG）/ 42 KB | 离屏资源回收 |

## 基线与候选

基线取既有报告 `docs/perf/data/perf-report.json`（2026-10-03，同 1.86.2 宿主）：

| 指标 | 纯文本基线（1k/10k/100k） | HTML 候选（htmlMany/htmlLong） | 结论 |
|---|---|---|---|
| Live 视口 DOM（.cm-content 全元素） | 59 → 59（10 万行不变） | 228 → 228 / 228 → 228（3.3 倍体量不变） | **有界保持**：HTML widget 使单屏 DOM 高于纯文本（每屏 ~7 个表格/块级 widget 的原生 DOM），但与文档体量解耦 |
| Reading 挂载块 | 50/50，max 80 | 47/46，max 76 / 47/46，max 76 | **窗口保持**：挂载窗口与纯文本基线同规模，不随总块数（1202→4002）增长 |
| 输入延迟 avg | 33.3–37.0 ms | 33.6 ms / 39.3 ms | 同量级；htmlLong 的 39.3 ms 仍在基线离散范围内（max 50 ms） |
| 长任务（longtask） | — | 全档 0 条（Chromium 观测窗口内） | 无秒级卡顿样本 |

单项结论：

- **单大表格（htmlGiantTable）**：整表是**一个块级 widget/一个 Reading 块**（总块数 3），Live DOM 1675 恒定、Reading 挂载 2 恒定——DOM 恒定不随滚动增长；输入延迟 avg 53.8 ms（max 70.4）高于纯文本基线（相邻行编辑带装饰更新），量级可接受。**边界如实记录**：Reading 侧未对巨型 HTML 块做块内分片（与 #7 时代「整块挂载」同语义，代码围栏的 FENCE_CHUNK_LINES 分片不覆盖 HTML 块）——400 行全表在进入视口时一次性构建；这是单块边界的既定语义而非本批回归，更大的单表需要块内分片时应另立票据。
- **样式更新（htmlStyle）**：探针键入落在 400 规则 `<style>` 块源文内，逐字符 avg **24.2 ms**（max 33.4）——「样式源文编辑 → 全文收集/改写/产物更新 → 绘制」的完整往返低于纯文本基线均值（规则改写为词法级，未随规则数劣化）。
- **离屏资源回收（htmlImageDense）**：602 块文档，Reading 挂载窗口 10→11（max 79）；DOM 内图片槽位（`data-vsidian-img-state` 计数）装载后 **4 个**、滚动回收后仍 **4 个**（loading 0 / error 0）——槽位保持视口规模而非文档规模（300 块的图片 DOM 不同时常驻），块卸载连带槽位回收。
- **模式切换**：→reading 108–561 ms（htmlLong 最长，含 4002 块的块模型构建）、→live 109–125 ms，与既有档位同量级。

## 结论

HTML 批次未破坏视口有界性与虚拟化边界：Live DOM 与 Reading 挂载窗口均与文档体量解耦，输入延迟与纯文本基线同量级，样式更新与资源回收成本在位。单大表格的块内分片是已记录的边界项，不阻塞收口。**本报告不设新性能阈值**——验收口径沿用 mvp.md「MVP 性能契约」的既有模型（体量增长 10 倍 DOM ≤ 2 倍；本批 3.3 倍体量 DOM 零增长）。
