# 2026-10 右键菜单场景差异化批次——切片记录

状态：2026-10-10 切片（现状盘点 + 开票），承接 2026-09 菜单批次（[batch-2026-09-menu.md](batch-2026-09-menu.md)）遗留的三张票位 #186/#187/#188；**未实施**。右键菜单规格单一事实源仍为 [context-menu.md](context-menu.md)（菜单结构与安全降级矩阵随各实施 PR 演进）；本文件是切片决策回执与工单索引。

## 切片输入：现状盘点结论（2026-10-10）

三场景只读盘点（file:line 证据已进各票票面），要点：

- **公共前提成票**：菜单谓词数据面 `MenuContextSnapshot` 仅 `zone/hasSelection/blockTarget/line` 四字段（`src/shared/contextMenu.ts:78-84`），采集点 `syncController.contextSnapshotAt`（`src/webview/syncController.ts:7068`）丢弃场景坐标——三场景差异化项都需要「右键命中处的结构化负载」，拆为共同前置基建票。注意该类型经 `addonPage.ts:103-104` re-export 进入附加组件页面 SDK 面，扩展须过 addon 契约门禁评估（`check:addoncompat`）。
- **表格**：结构六操作（增删行列）、拖排、格区复制/删除/粘贴、选择行/列全部已有纯函数与执行管线（`tableStructure.ts` / `tableRegion.ts` / `tableControls.ts` / `tableEditing.ts`）；六个结构操作已进键位注册表（默认未绑定）与命令面板；**无任何右键入口**。[blockquote-table.md](blockquote-table.md) 三轮节已有用户决策：「移除引用块 / 增一层引用」层级操作**职能转移至表格专属右键菜单**（当时未实施菜单项本身），纳入本批表格票。
- **图形块**：呈现态既有能力 = `edit` 按钮（仅 Live）+ `popup` 按钮（双视图）+ 弹窗内刷新 / 导出 SVG / 导出 PNG（`diagramPopup.ts` / `diagramExport.ts`，宿主落盘通道 `diagram.export` 现成）；呈现态无复制源码入口；「编辑入口收敛到 `edit` 按钮」为 [graphic-code-block-interaction.md](graphic-code-block-interaction.md) 契约 2；popup 与导出按生效渲染器 svg 取图能力 gate（按钮不虚设惯例）。
- **链接**：Ctrl+单击 / 渲染态单击跳转经 activate 消息族（判定次序双链→嵌入→树驱动→宽松，`liveLinks.ts:704-813`），悬停判定 `liveLinkSpecAt` 同族；全仓**无**复制链接地址 / 显示文字类操作；「复制块链接避免称『复制链接』」为 CONTEXT.md 术语约束（:111）。

## 切片决策

| # | 决策点 | 结论 |
|---|---|---|
| S1 | 拆票结构 | 1 张快照基建票先行 + 3 张场景票（表格 / 图形块 / 链接）并行；沿 2026-09 批次「基建先行、内容按场景」惯例（Q5） |
| S2 | 场景数据通道 | `MenuContextSnapshot` 增可选命中负载（table / link / graphic），采集集中在 `contextSnapshotAt`；负载只在对应 zone 采集，结构敏感区不采链接 |
| S3 | 图形块「编辑源码」右键项 | **不纳入**——维持「编辑入口收敛到 `edit` 按钮」规格契约（#187 票面明确扩展须用户确认）；确需增设时先修订规格契约措辞并经用户确认再开票（开放项） |
| S4 | 链接打开项 | 与 Ctrl+单击**同源** activate 消息，不新造跳转链路；外部 scheme 准入仍归宿主 `linkTarget.ts` |
| S5 | 嵌入与格内链接 | 均不接专属项（嵌入卡独立交互体系；格内维持降级矩阵简化，格内链接已有单击即跳） |
| S6 | 图标资产 | 场景票登记 iconKey 两表同步（`CONTEXT_MENU_ICON_KEYS` + `quick-action-icons.py` KEYS）即合规；资产生成非实施阻塞（渲染层无规则时留空降级），资产缺口由 #441 承接 |
| S7 | 键位 | 新命令一律进操作注册表评估记录、默认未绑定；提示列由注册表派生（「提示列只派生自键位注册表」边界不变） |
| S8 | 票位处置 | #186/#187/#188 关闭，由本批新票承接；已实施部分在关闭评论记录（见「票位关闭回执」） |

## 开票清单（2026-10-10 已建票，均 `ready-for-agent`）

| 工单 | 主题 | 依赖 | 承接票位 |
|---|---|---|---|
| [#436](https://github.com/ONEGAYI/vsidian/issues/436) | 快照场景命中负载（基建，不加菜单项） | 无，先行 | 三票位公共前置 |
| [#437](https://github.com/ONEGAYI/vsidian/issues/437) | 表格场景簇——结构操作、选择、复制与引用层级项 | #436 | #186 |
| [#438](https://github.com/ONEGAYI/vsidian/issues/438) | 图形块场景簇——弹窗预览、导出与复制源码 | #436 | #187 |
| [#439](https://github.com/ONEGAYI/vsidian/issues/439) | 链接场景项——打开链接、复制地址、复制显示文字 | #436 | #188 |
| [#441](https://github.com/ONEGAYI/vsidian/issues/441) | 场景簇图标资产生成（表格/图形块/链接新 icon key 候选 13 枚） | 生成可先行；对账随 #437–#439 | S6 落地 |

依赖图：#436 → { #437, #438, #439 }。三张场景票相互可并行；同触 `CONTEXT_MENU_ITEMS` 表与语言包文件，后开工方 rebase（沿 vscode-ops 批次 D7 惯例）。#441（资产）与四票并行启动，最终对账在场景票合入后（#436 不涉及图标）。

## 已定边界（沿既有契约，切片不放宽）

- 阅读模式与 frontmatter 头区不接管；内置项不可删只可隐藏；提示列只派生自键位注册表；内置菜单最深两级（[context-menu.md](context-menu.md)「扩展约定（落档）」节）。
- 表格：列宽拖拽 / 对齐设置 / 合并单元格 / 单格搬移 / Excel 区域粘贴不做（table-interaction-rework.md 排除项）；粘贴永不删行列；残缺表层级操作置灰不猜。
- 图形块：剪贴板复制图片、弹窗内编辑、弹窗实时同步为规格非目标；弹窗局部键不进宿主键位。
- 链接：裸 URL 不识别为链接（lezer 现状口径）；外部 scheme 准入归宿主；措辞遵守「避免称『复制链接』」术语约束。

## 明确不包含（本批范围外）

- 普通围栏代码块（zone='fence'）差异化（无票位）。
- 媒体 / 脚注 / callout 菜单项（未定档；图标备用记账不变）。
- 表格「上移 / 下移行」类移动项（拖排已有把手语义，如需另开票）。
- 链接「复制为 Markdown 源码」「编辑链接目标」（另议）。

## 开放项（需用户决策，非本批实施内容）

- **图形块「编辑源码」是否增设右键项**：扩展「编辑入口收敛到 `edit` 按钮」边界须用户确认；确认后修订 graphic-code-block-interaction.md 契约措辞再开票。
- ~~场景簇图标资产批量生成~~ → 已落票 [#441](https://github.com/ONEGAYI/vsidian/issues/441)（候选语义表 13 枚 + 复用映射；生成走 `ai-icon-sheet-to-svg` 流程，与四票并行，对账随场景票合入）。

## 票位关闭回执

- **#186** → #437（+#436）。已实施部分不重复开票：块内表格 zone 识别（`TABLE_DELIMITER_RE` 剥容器前缀）与右键保选区（`contextMenuSelectionGuard` / 蒙版行区间判定）已随 blockquote-table 三轮修复落地（2026-10-02）。
- **#187** → #438（+#436）。「编辑源码」右键项因边界不纳入（S3），开放项记录。
- **#188** → #439（+#436）。打开项与 Ctrl+单击同源（S4）。
