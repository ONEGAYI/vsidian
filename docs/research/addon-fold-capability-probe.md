# 附加组件折叠能力现状摸底与边界（#403）

状态：2026-10-08 现状摸底与决策建议（research 交付，无代码实施）。驱动方 [ONEGAYI/vsidian-easy-typing](https://github.com/ONEGAYI/vsidian-easy-typing) 的 CollapsePersistentEnter（折叠标题处 Enter 新建同级标题、不展开折叠）——依赖 Obsidian 的 `editor.getFoldOffsets()` / `getAllFoldableLines()` / `exec('toggleFold')` 折叠 API。

## 结论先行

**vsidian 当前没有承载「正文标题折叠」的功能本体，折叠类 API 无物可开。** 上游依赖的是 Obsidian Live 编辑器的标题折叠体系（折叠偏移记录在编辑器实例上、折叠态影响正文呈现）；vsidian 的 Live 是视口装饰管线，标题折叠功能不存在。开放「折叠区间查询 / 折叠命令」的 API 形状在此现状下是对空集建模——本票不实施，落档边界并给出路线建议。

## 现状盘点（折叠的三个既有载体）

| 载体 | 位置 | 性质 | 与上游需求的差距 |
| --- | --- | --- | --- |
| frontmatter 卡折叠 | `src/webview/frontmatterDecorations.ts`（折叠按钮 + folded 布尔） | 单条装饰的局部开合，无区间语义 | 上游需要的是标题级折叠区间集合 |
| 代码卡折叠 | `src/webview/liveCodeCard.ts`（`codeCardFoldField` StateField） | 逐代码块的卡片开合（呈现态） | 同上；且按块独立、不构成文档级折叠状态 |
| 大纲面板折叠 | `src/webview/outlineCollapse.ts`（档位 + 展开集合状态机，#67） | **面板 UI 状态**（侧栏条目可见性），不是正文折叠 | 上游 `getFoldOffsets` 语义是正文编辑区偏移集合；大纲展开集不含正文折叠的呈现联动 |

`@codemirror/language` 的折叠能力（`foldState` / `foldedRanges` / `toggleFold` / `codeFolding`）在 vsidian 源码中无使用——Live 装饰不装配 `codeFolding`，折叠状态字段不存在于编辑器状态。

## 语义边界（若未来实施，票面要求先明确）

- **Live 模式**：折叠是编辑状态 + 呈现装饰的双重概念——折叠区间集合应承载于 EditorState（StateField），跨外部同步/撤销/重载保持（映射规则与 `codeCardFoldField` 同类问题）；折叠态下的 Enter/Tab 等编辑行为要过既有情境链（#402 优先级模型）。
- **阅读模式**：折叠是**呈现层概念**（DOM 呈现的开合，无编辑状态）——上游 Obsidian 的阅读视图同理。API 形态上应只读（查询折叠呈现态）或不开放（呈现细节不是稳定契约面）。
- **两模式一致性**：Live 折叠与阅读折叠是否联动是产品决策（Obsidian 是联动的）；不联动则 API 分模式语义，联动则需要跨模式状态桥。

## 路线建议

1. **前置**：正文标题折叠是产品级功能（MVP 未含），应先开产品票定义折叠交互（折叠线呈现、折叠保持、撤销语义、跨模式联动），API 开放随功能落地（API 形状：Live 折叠区间的查询/折叠/展开命令，可先实验入口）。
2. **上游移植的近期处置**：CollapsePersistentEnter 保持 blocked（依赖正文折叠功能）；easy-typing 其余功能不受此票影响。
3. **不建议的近路**：把大纲面板展开集冒充折叠区间开放（语义错位，未来必然破坏兼容）；把 frontmatter/代码卡折叠包装成通用折叠 API（局部装饰开合 ≠ 文档折叠状态）。

## 关联

- 票面：[#403](https://github.com/ONEGAYI/vsidian/issues/403)
- 上游需求：vsidian-easy-typing CollapsePersistentEnter
- 优先级契约（本文引用）：[developer-guide](../addons/developer-guide.md)「按键拦截与优先级」、清单 cm6-experimental `semantics.keymap`
