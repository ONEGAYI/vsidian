# feat: 表格格内嵌入目标 Live 与父表格输入隔离

本地编号：P2-08

GitHub：[#285](https://github.com/ONEGAYI/vsidian/issues/285)

父票：[#227](https://github.com/ONEGAYI/vsidian/issues/227)

Blocked by: [#284](https://github.com/ONEGAYI/vsidian/issues/284)（P2-07）

状态：已实施并合入 [PR #313](https://github.com/ONEGAYI/vsidian/pull/313)（2026-10-03，提交 `926b501`，合并 `72ee825`）。五项验收自动化全部通过，证据见下「执行记录」；真实 IME／物理鼠标观感属人工清单，未冒充已验收。

规格：[二期正式规格](../hover-preview-embed.md)；用户故事 P2-U07、U12、U24；验收 P2-A02–A04、A08、A09、A12、A13。

## 问题与交付

格内引用有源码、转义解码和渲染三套坐标，父表格按键处理不能误把 B 的输入当成 A 格编辑。

表头／数据格内的既有嵌入可进入完整目标 Live，精确映射、焦点、测量和释放正确。

## 实施范围

- 复用 tableCellEmbed 的格内解码与原始 occurrence 坐标，保留转义 | 和别名，不混用解码偏移写 A。
- 进入 B 后内部 EditorView 接管实际输入／选区／滚动，父格导航与父表格操作不截获目标事件。
- 支持父 Reading／Live 和模式覆盖，共享保存／历史／dirty／关闭保护及实例状态。
- 卡片宽度、高度和内部视口跟随格空间，不能退回全文 DOM 常驻或撑坏父表格。

## 验收标准

- [x] 含转义竖线、别名、相邻文本的表头与数据格，A 源码和索引落点保持，输入只改 B。（unit 转义保真契约 + browser 格内输入场景 + 真宿主 #285 例）
- [x] 目标内 Enter／Tab／方向键／选择／菜单不执行 A 表格导航或增删行列，焦点回父格后恢复原行为。（browser 隔离场景：B 只写 B、A 选区零扰动、焦点回 A 后 Tab 切格恢复）
- [x] 父两种模式、目标两种模式、三种链接形态覆盖；Reading 零写回。（browser 模式矩阵场景 + 集成 #248 双模式挂载族）
- [x] 内部滚动位置和选区重挂载可恢复，变高测量与可见绘制正确，输入保护和删除取消保持。（browser 离屏回收重挂场景 + unit 重定位契约；变高 ResizeObserver 与父表格行高联动）
- [x] tableEmbed 和原生 tableCaret 回归通过，不只断言 DOM 存在。（独立树与合并树两层复跑，均含绘制层断言）

## 复用入口与验证

src/webview/tableCellEmbed.ts、embedCard.ts 与父表格输入路径；test/browser/tableEmbed.mjs、tableCaret.mjs。

对可执行行为遵循 TDD，先固定失败契约，再实现。优先生产控制器、公开会话和真宿主验证；接口改造不为每个内部函数增设 mock。 预计一次新 agent 上下文完成；若发现还需扩大接口或全局迁移，先记录具体增量并重新切片，不把未完成行为标为已交付。

## 共同完成条件

- 新增面向用户的文字经两套 locales 与 t()，新增操作评估可绑定入口、默认值和适用模式。
- 涉及 webview 呈现时先执行项目 style-contract，提供实际绘制结果与 CSS 契约证据；新增设置按插件自有页面约定。
- 运行受影响的检查，首次长命令落盘日志和退出码；真实 IME／鼠标／Remote SSH 待验不冒充已验收。
- 本票不包含持久历史／恢复库、PDF 或资源管理器预览；不授权推送、PR 或合并。

完整共同约定与发布次序见 [票据索引](README.md)。

## 执行记录（2026-10-03）

实施在独立树 `D:\.codex\worktrees\p2-08` 完成（TDD 3 重定位契约先红 `logs/p2-08/red-unit.log` + 列/行移动误拦机理对照 `red-phase-probe.log`），提交 `926b501`，合并 `72ee825`（与 P2-06/07 合入区自动合并，父代理复核 remapSources 三票分层与拦截存活检查叠加正确，run.mjs 套件并集）。

红期实证的核心缺陷：父表格行列结构编辑的重写事务**完整覆盖嵌入源区间但逐字保留源文**（格值取原 doc 切片搬运），被 P2-05 删除保护一律拦截——列/行移动在端口在场时整笔被吞且误弹删除确认。修法两件套：

1. **拦截存活检查**（`mainDocChangeFilter`）：覆盖区间时在事务**全部**变更的插入文本中逐字检索嵌入源文（行对换形态下源文落在另一枚变更里）；源文取变更前 doc 的原始源码坐标，不混解码偏移写 A（`\|` 转义原文保真）。存活放行，不存活照常拦截。
2. **重定位键迁移**（`remapSources(changes, doc?)`）：坍缩候选按 sourceStart 升序，经 `claimed` 占位在插入文本内分配命中位（同源文多实例不争位），迁移到新坐标——端口/装载缓存/选区记忆全保持，零 bind/unbind/重载风暴；未命中才冻结死键（undo/删表回填原位恢复仍命中缓存）。

隔离矩阵其余项经 P2-07 容器无关机制天然成立（browser 实测钉住）：B 内 Enter/Tab/方向键/选区只写 B、A 选区零扰动、焦点回 A 后 Tab 切格恢复、卡内拖选不启父格区、变高经 ResizeObserver 与父表格行高联动且限高封顶、离屏回收重挂恢复未保存编辑与选区。

| 检查 | 结果 | 日志 |
| --- | --- | --- |
| `npm run compile` | 通过 | `logs/p2-08/compile-final.log` |
| 全量 unit（243 文件 / 5234 + node 契约 118） | 全绿 | `logs/p2-08/unit-final.log` |
| browser 新套件 tableCellLive 10 场景（真实键盘/拖拽/布局/焦点） | 全过 | `logs/p2-08/browser-final.log` |
| browser 嵌入/表格族 9 套件回归 | 全过 | `logs/p2-08/browser-final.log` |
| 定向集成 1.82.3 真宿主（P2-08 新例 + #248×2 + #13×4 + P2-04×3 + P2-05/07/10 + 表格防护×3 共 17 例） | 17/17 | `logs/p2-08/integration-final.log` |
| `npm run check:stylecontract`（含 baseline） | 八项零失败 | `logs/p2-08/stylecontract-final.log` |

合并树复验（`logs/merge-p2-08/`）：compile 通过、全量 unit 245 文件/5276 例、browser 11 套件（tableCellLive + 表格族 2 + 嵌入族 6 + hoverLive/hoverRefresh）、定向集成 20/20（加 P2-06×2、P2-12×1 复盖 remapSources 热区相邻票）。

**移交父代理的边界**：格内**连击两字**（无停顿）在基线既有暂缓窗口触发 `\|` 转义丢失并使整表降级——embed-free 基线同样复现（`logs/p2-08/diag-base2.mjs`），属表格输入族既有缺陷非本票引入，已另开 [#315](https://github.com/ONEGAYI/vsidian/issues/315) 跟踪（2026-10-03 注：#315 复现尝试三层证据均不可复现——真实 Chromium 9 种驱动组合、jsdom 现状核、机制归因：物理键 keydown-forceFlush 与 DOM 回报 filter 管道双防线覆盖；原探针已删形态不可考；处置待定，tableCellLive 场景 C2 钉住连击不丢 `\|` 转义契约防回归）。同一覆盖变更内多枚同源文实例被重排时按文档序分配命中位——身份证互换仅影响选区/滚动记忆（目标一致，用户不可见）。格内空白表格组合规划（`isLiveActive:false`）与图片粘贴仍是 P2-10/P2-11 既有缺口，P2-14 收口核对。

## #320 增补（2026-10-04）：重定位扫描预算与超限放行/冻结

[#320](https://github.com/ONEGAYI/vsidian/issues/320)（PR #313 终审留档）：`relocatedInterval` 逐字检索（存活检查与坍缩候选重定位共用）最坏 O(候选数 × 插入文本长度 × 源文长度)，且 filter 与 remap 对同一事务各执行一遍——10 万行全选替换 × 64 活跃嵌入可一次性阻塞主线程数百 ms 量级。三层预算常量在 `src/shared/relocationScan.ts`（`sourceTextLength` 4096 / `insertTextLength` 1 MiB / `hitScans` 64，数值依据与叠加最坏口径见该文件注释）。**超限语义 =「无法判定存活」而非「判定已删」**（2026-10-04 产品决策「超限放行 + 冻结」）：filter 侧（A 层与 #321 B 层同口径）命中或超限均放行、`null`（真删除）才拦；remap 侧超限与未命中同待遇冻结死键（undo 回填命中缓存可恢复）。上文执行记录中「未命中才冻结死键」自此按「未命中**或超限**」理解。

既定取舍（review-loops 钉住）：预算被前方 miss 扫描耗尽后**确实未被检视**的变更升为超限——65+ 行表格列移动（`planTableColumnMove` 每行一枚变更）且嵌入行在文档序第 65 位之后不误拦；同一形态下的**真删除**也借超限逃逸确认链（事务落盘、无确认弹窗，恢复走 undo 回填）——这是「无法判定≠判定已删」口径的另一面，边界锚定用例见 `test/unit/tableCellLive.test.ts` #320 组；全部枚完整检视的 miss 仍返回 null 照常拦截（对照例钉住）。
