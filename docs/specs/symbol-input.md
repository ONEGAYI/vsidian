# 规格：符号输入与行内围栏扩展约定

状态：2026-09-27 从 AGENTS.md「约定」节抽取迁移（内容未改，仅重组分段），AGENTS.md 留触发指针。本文是行内围栏扩展（#103/#107）与符号输入辅助（#123/#124/#125）两族落档约定的单一事实源。

**何时必读**：新增或修改符号自动补全、选区包裹、围栏内 Tab 越界行为（#123/#124/#125）；新增成对行内标记类操作——粗体/斜体/删除线/行内代码等（#103）；改动 IME 组合期输入路径或 CM6 扩展装配顺序；评审上述范围的变更。

## 行内围栏扩展约定（#103 落档）

### 共用路径与登记

粗体/斜体/删除线/行内代码这类成对行内标记统一走 `inlinePlan` 共用路径，两态切换（光标在围栏语法节点内即取消整段）与无选区扩词包裹的光标落位（开围栏内侧，锚点按 `markers.open.length` 从实际定界符计算）是路径级行为，不逐操作实现。

新增此类围栏只需：`src/webview/formatOperations.ts` 的 `INLINE` 表登记 `{ mark, node }`（node 为 Lezer 语法节点名，取消分支按它命中）+ `src/shared/formatOperations.ts` 注册表（titleKey／i18n／快捷键入口评估见 AGENTS.md「操作与快捷键注册」约定），即自动继承全部行为；「清除行内格式」按 `INLINE` 全表遍历，亦自动覆盖。

**代码选区边界（2026-10-14 修复）**：选区完整包含同一行内的代码片段（含首尾反引号）时，粗体／斜体／删除线／高亮允许在片段外层包裹并再次取消，代码和链接原文保留。光标位于代码内部、只选代码内容或选区截断代码片段时仍不写入这些格式；块级代码及 HTML 块仍禁用。命令执行与快速操作按钮通过 `isPartialInlineCodeSelection` 共用行内代码边界判定，不能仅因选区端点属于 `InlineCode` 就拒绝整段。跨行仍沿用逐行包裹规则，不扩展跨行代码片段的处理语义。

**组合前缀（2026-10-14 修复）**：引用、列表、任务与标题是可组合的结构。`lineContainerPrefixLength` 从 `parseLinePrefix` 逐层派生正文落点，覆盖 `> - ## 正文` 和 `- > 正文` 等交错容器，不手写另一份列表／引用识别。五种行内格式与单行链接／双链／行内公式包裹跳过完整前缀；标题仅修改标题标记，列表仅切换列表类型或移除自身标记，引用仅增删外层一层 `>`。列表类型之间、标题级别之间仍按同类操作转换；双链／行内公式仍为插入语义，不增加取消分支。

### 两处例外需主动适配

- 定界符随内容变化的围栏（多反引号、补位空格一类）须在全部三处构造 markers 的分派接入自己的 marker 函数——fresh-wrap 包裹处、`rewriteInlineLine` 重包与 `clearInlineLine` 局部重包各有一处 `codeSpanMarkers` 三元，漏改任一处该路径会退回静态定界符——锚点仍自动。
- 插入型结构（wikilink／inlineMath 所在分支）无切换语义，新操作要两态化须自行设计取消分支。

### 测试惯例

新围栏在 `test/unit/formatOperations.test.ts` 补一条包裹后光标位置断言，并在 `test/unit/formatInteraction.test.ts` 两态往返用例的枚举里加一行（现有五种为显式枚举，不自动生成）。

### 两态覆盖与拆对边界（#107 修复后）

词与既有同类围栏贴边相邻（如 `**a**b` 光标在 b 处，贴边包裹产物被解析为合并节点）与光标停在围栏开边界外侧（行首 `|**词**`、行尾 `**词**|`——取不到词且贴邻即取消该围栏；能取到词的贴邻位置仍扩词包裹）两场景均两态化，随登记继承。

但取消侧的**拆对**仅在「贴边合并形态」下生效——mark 出现序列（`markOccurrences` 按 `INLINE[op].mark` 非重叠扫描）两两配对后每对内部有内容、相邻对零间隙，经 `adjacentMergedMarks` 校验通过，才只拆光标所在对、其余保留；其余形态（含 inlineCode 变长定界按静态单 mark 扫出的内部无内容「对」、内容含字面 mark 的偶数序列、奇数残缺）一律回退整节点摘除。

该扫描点是 #103「三处 markers 分派」之外的第四处（解析侧）mark 扫描，按静态 `INLINE[op].mark` 派生 + 形态校验兜底，不接入 per-op marker 函数。

### 残留边界

`*` 与 `**` 混合粘连（如 `**a***b*`）树形不是简单合并节点，多数进不了取消分支，仍按整拆或字面星号呈现；与贴边产物同形的内容字面 mark（如 `*a**b*` 为单节点、内容 `a**b`）不可区分，按拆对处理。

## 符号输入辅助扩展约定（#123/#124/#125 落档）

符号键入与围栏内 Tab 的三条路径都是注册表驱动的路径级行为。

### 无选区路径：自动补全、闭合越过、自动空对退格（#123）

`src/shared/symbols.ts` 的 `SYMBOL_AUTOCLOSE_REGISTRY` 登记符号对（open/close、代码上下文适用性、`suppressBefore`/`suppressAfter` 相邻字符抑制、自反触发符的 `mirrorAtRunStartOnly` 串首规则），`src/webview/symbolAutocomplete.ts` 的 transactionFilter／StateField／keymap 自动继承。

新增符号只需：注册表加一行（含 `selectionWrap`、`tabEscape` 决定是否参与选区包裹与 Tab 越界）+ `test/unit/symbols.test.ts` 参数化用例钉住其触发/越过/抑制条件（清单数断言同步），不需要改 webview 侧条件分支。

右邻抑制（`suppressAfter`）是**差异化双口径**（#151 参考 VSCode autoClosingBefore / CM6 closeBrackets 先例后的取舍）：括号与引号登记正文中间口径 `isBodyChar`——右邻为非空白且非闭合类字符（词字符、普通标点等「正文中间」形态）时不补全（`|word` 键 `[` 不再越界补出 `[|]word`），右邻空白、行尾或注册表任一 close 字符时照常补全（闭合类集合从注册表派生——新增符号自动继承，嵌套 `[（|）]` 形态照补）；Markdown 触发符维持既有词字符口径 `isWordChar`（右邻普通标点照常补全）。注意与先例的差异（核实 @codemirror/autocomplete 6.20.3 源码后）：CM6 closeBrackets 同样抑制右邻普通标点（其放行集为固定 `)]}:;>`，见 `defaults.before`），本项目放行集从注册表派生，方向一致而集合构成不同；VSCode autoClosingBefore 按语言词字符判定（右邻普通标点放行），本项目连标点也抑制，仅比 VSCode 更保守——这是 #151 落档的显式决策而非先例复刻。两口径差异化并存同样是 #151 的显式决策，不得顺手统一或放宽。transactionFilter 与 IME 提交补全（`attemptCompositionCommitClose`）共用 `shouldAutoclose` 判定，口径变化同时作用于两条路径。

### 选区路径：非空选区键入包裹（#124）

注册表的 `selectionWrap` 字段逐项显式登记包裹能力（**包裹符、自动补全符、Tab 可导航符是三个不同集合，不得等同硬编码**——键入 close 字符不包裹、包裹判定不做邻接抑制），包裹计划纯函数在 `src/shared/symbolWrap.ts`（`planSelectionWrap`：空行序列拆段、纯空白块跳过、产物多 range 原文选区），`src/webview/symbolWrap.ts` 的 transactionFilter 认两种输入形态——单 range 选区替换与 CM6 `replaceSelection` 的多 range 逐条替换（真实键盘在多 range 选区下键入，DOM 原生选区只表达 main range，CM6 的 applyDefaultInsert 经 replaceSelection 覆盖全部 range——跨段第二键叠加包裹的底层机制）；跨段后选区保持多 range（各段原文），依赖随组装配的 `allowMultipleSelections`（EditorState 否则把选区 asSingle；已知呈现边界：未启用 drawSelection，多 range 仅 main range 有原生选区高亮，功能不受影响）。

### 伴生行为：多光标与表格竖线

多光标（CM6 默认手势 Windows/Linux 为 Ctrl+click、macOS 为 Cmd+click）随组可用，表内多光标键入 `|` 经 keymap 命令 `tablePipeKeyHandler` **逐 range 转义** `\|`（任一 range 无需转义才整体交默认，避免多光标语义分裂）——多 range 表格竖线路径不走单 range filter 门控，结构不被裸竖线破坏，symbolInput 浏览器套件有钉住用例。

### 包裹语义边界

连续键入是叠加不取消（与格式按钮两态切换是不同操作）；单换行属同段不拆段、屏幕折行无换行符天然不拆；代码上下文沿 `allowInCode`（Markdown 强调整笔不接管、混合选区不转换块结构）、表格格区（`tableRegionField` 非 null）归 tableEditing 不接管；粘贴/拖放不包裹；IME 组合期间的包裹语义见下文「IME 组合期时序」。

### Tab 越界路径（#125）

光标在有效成对围栏内部且无选区时两步越出。注册表 `tabEscape` 字段是第三个显式集合——括号/引号 12 项表示行内配对扫描参与，markdown 项表示对应树围栏参与（`TAB_ESCAPE_TREE_NODE_NAMES` 五节点与之间源）；**显式决策**：`$` 不登记（行内公式无语法节点，扫描配对边界与公式形态学不一致），wikilink 无专用节点、经方括号行内配对天然纳入（`[[..]]` 栈式配对逐层退出）；定位纯逻辑在 `src/shared/tabEscape.ts`（`matchInlineFences` 栈式配对、自反符号按出现顺序交替、失配 close 忽略；`planTabEscapeTarget` 两步推导——pos 贴闭标记左边界即第二步，无跨按键状态机；嵌套取包含光标的**最窄内容区间**逐层退出），适配层 `src/webview/fenceEscape.ts` 从增量树提取光标行树围栏（首/末子节点须为 mark）后与行内配对合并。

### 装配顺序陷阱

CM6 keymap 与 transactionFilter 的顺序语义相反——keymap 按扩展数组顺序**正序**拼接尝试（靠前者先匹配、return false 落穿给后者），filter 逆序应用（靠后者先过滤）；fenceEscape 的 keymap 必须在 tableEditing **之前**（「格内先越界后切格、正文落缩进」三段优先级），#123/#124 的 filter 在 tableEditing 之后——勿据一方经验摆另一方位置。

### 门控

多 range 与非空选区不接管（多 range 显式决策只处理单 range，保持既有缩进/切格语义）、格区不改写、frontmatter 与块级代码上下文（FencedCode/CodeText/CodeBlock/CodeInfo/HTMLBlock）排除（代码块内 Tab 继续缩进），InlineCode 刻意不排除（行内代码本身是有效树围栏）；命中派发纯选区事务（零写回零 dirty，集成断言 appliedEdits 不增、字节不变）；Shift+Tab 不绑 shift 槽（落穿保持反向切格/缩进，不新增反向越界）；**后续工单不得把命令绑定到 Tab 键**（keybindingRouter 先于 keymap 拦截会破坏三段优先级，见 [keybindings.md](keybindings.md) #125 评估段）。

### 三条既有边界不得顺手放宽

- 越过只认「自动补出的」闭合符号（`autoclosePairs` StateField 记录，手打相邻照常插入；外部同步经 externalSync 注解清空状态，不得用过期位置跳过或删除）。
- 星号序列 `| → *|* → **| → ***|` 由 `mirrorAtRunStartOnly` 钉住且**不得泛化**为所有符号的统一重复输入行为（各符号的重复输入语义以注册项显式登记为准；选区场景的连续包裹是叠加语义、不混用该序列规则；#125 的 Tab 越界与「自动补出来源」无关——覆盖文档既有围栏）。
- 英文尖括号默认不登记（不自动补全、不包裹、不参与越界）。

### IME 组合期时序

- **#123 的 IME 补全走双时机**：组合期间 filter 按 `symbolComposing` StateField 拦截（compositionend 后**延迟一个宏任务**复位——同步 dispatch 会打断 CM6 组合定稿 flush，tableCaret 的 IME 回归实证），提交补全由 compositionend 钩子的微任务 attempt 统一触发并与组合净输入在 deferredLocal 合并单笔出站（一次补全=一笔 edit.request=宿主撤销一次整体恢复；syncController 侧「组合期间一律暂缓」与「组合暂缓的外部增量经 base 系映射应用而非保守暂停」配套——触碰式暂缓的 #4 暂停口径保持不变）。
- **#124 的包裹 filter** 仍按 `input.type.compose` userEvent 排除组合中间与定稿事务（包裹不经 filter 改写组合事务，IME 选区的包裹由 wrapCompositionTracker 在定稿后主动派发——与 #123 补全同款微任务时序，均不在 compositionend 同步 dispatch，会打断 CM6 组合定稿 flush）。**定稿提交恰好等于某注册项 open 的单个起始符号且组合开始时有非空选区时按包裹口径重建**（`src/webview/symbolWrap.ts` 的 wrapCompositionTracker：compositionstart 捕获阶段快照选区原文与代码上下文（先于 CM6 内建跨行删除），compositionend 后微任务重建 `open+原文+close` 并保持原文选中、跨段各 range 同步包裹并支持连续叠加；快照经 `src/webview/symbolCompositionState.ts` 共享——#123 补全 attempt 读到快照即让位，同一提交只允许一条路径生效），无选区、提交完整符号对（既不包裹也不补全）与多字符选字按 #123 口径处理；跨行（跨段）选区经 IME 同样按空行拆段包裹；CM6 在组合开始同步删除跨行选区，须先于内建 observer 快照，并在捕获阶段标记 composing，使删除与定稿重建合并为单笔写回；宿主整段撤销替换若把选区映射成反向范围，外部同步在同一事务中规范为正向原文选区。
- **#125 的 Tab** 是按键命令不是输入事务，组合中 `compositionStarted` 让位即可（tableEditing/indentEditing 同款先判）。
- **行为链驱动面（#595 落档；2026-10-19 评审修订）**：#123 补全与 #124 包裹的 attempt dispatch 均携带 `builtinEditOrigin` 注解（定义于 liveInstance，与 externalSync/addonEditOriginTag 并列）——`maybeDriveAddonBehaviors` 见此注解即不驱动行为链。IME 定稿符号对只驱动一次（#593 补驱动的干净形态：选区 `inputText='【'`、`replaced='ord'`；无选区 `replaced=null`）。**键入路径在 #595 时不在标记覆盖面**：真实键入符号字符的补全/包裹经 transactionFilter 改写并保留 `input.type` userEvent，照常驱动一次（`inputText` 为展开形态如 `()`——#411 起既有行为；初稿曾按 t15 先例记「键入路径天然不驱动」，评审核实该先例描述的是测试通道注入形态——无 userEvent 不经 filter 改写——不外推到真实键入）；该形态差异由 #597 裁决收口归一，见下节「键入路径重排（#597 落档）」。IME 定稿符号对的优先序是**显式契约：行为链先、内置兜底**（#124 attempt 的形态校验是现成让位护栏，区间被组件改写即中止）。`userEvent: 'input.type'` 保留不动（撤销惯例与单笔出站合并不变）；不复用 externalSync（抑制出站回发）与 addonEditOriginTag（origin 元数据 + 强制新撤销段）。

### 键入路径重排（#597 落档）

键入路径与 IME 定稿路径同构（#597 裁决，方案 3，2026-10-19 冻结；方案 2「屏蔽键入路径通知」被否——conv-hw2fw 反例，见 ADR-0020 修订记录与验证报告 `docs/research/597-plan3-probe.md`）。此前键入符号字符经 transactionFilter 原子改写为展开形态（如 `(|)`）并保留 `input.type` userEvent，行为链收到的 `inputText` 是展开形态（`'()'`）——#411 起既有；重排后驱动面与终态分置，硬边界如下（改 `symbolAutocomplete.ts`/`symbolWrap.ts`/`liveInstance.ts` 输入路径前必读）：

- **filter 放行原始事务**：`autocloseInputFilter` 补全分支与 `selectionWrapFilter` 包裹分支不再改写，放行原始键入事务（`(` 一笔），暂存兜底材料（per-view，形如 `symbolCompositionState`）；包裹分支随快照携带选区 ranges/原文/inCode 与表格格区等门控判定——定稿事务会清空 `tableRegionField`，attempt 侧无法复查，镜像 `compositionInTableRegion` 模式。**闭合越过分支保持 filter 内改写**（零 doc 变更、不进驱动面与出站，无坐标问题，不得顺手放行）。
- **兜底 attempt 微任务**：镜像 `attemptCompositionCommitClose`/`attemptCompositionWrap`——形态校验（区间仍为原始键入字符/追加式）不符即让位，符合则补闭合/按段重建（多选区按批量同时坐标重建，delta 只平移批后选区——与 IME 同构，终态与选区覆盖文本和旧 filter 改写逐字一致），携带 `builtinEditOrigin`，`userEvent: 'input.type'` 保留。
- **attempt 入队点 = 符号扩展组内 `updateListener`**（CM6 facet 序：数组靠后者先执行，主簿记 listener 的链驱动入队先于符号组）——**不得从 filter 入队**（filter 先于 updateListener 执行，attempt 会抢在链前落地，打破「键入文本在快照中占据 `[replaced.from, +inputText.length)`」的坐标不变量，产出重复内容）；装配序由测试钉住。
- **出站强制暂缓**：filter 放行时以重指定附注解（`symbolRawInput`，与 `builtinEditOrigin` 并列），`recordLocalChangeSet` 见注解走暂缓分支（不立即出站）；兜底触碰未确认区并入同段——维持「一次补全/包裹 = 一笔 edit.request = 一条宿主撤销记录」。分段语义沿用：无停顿、无光标移动 → 同段单笔。
- **微任务序契约**：链驱动（M1）先启动、内置兜底（M3）后执行（ADR-0020 裁决一沿用到键入路径）；同步类行为以组件产出为终态，异步类行为内置先落地、修饰后至覆盖（既有已知边界同型继承）。SelectKey 管线对 `selections>1` 让位（既有门），多 range 包裹完全由内置兜底承担。
- **驱动面契约**：键入符号字符恰驱动一次，`inputText` 为原始键入字符（`'('`）、`replaced` 为被替换选区——契约语义字段变更（兼容性事件），catalog/developer-guide/CHANGELOG-API 同步、基线显式重锚；不新增开关或兼容模式（用户裁决）。`autoclosePairs` 登记（越过/空对退格依据）移到 attempt：与下一按键之间只隔微任务，事件循环保证不可达竞态；两笔事务在同一事件循环任务内完成（微任务先于渲染），中间态不可见。

### 设置开关

设置键 `editor.symbolAutocomplete`、`editor.symbolSelectionWrap`、`editor.symbolTabEscape` 三个独立布尔开关（均默认开）经各自 Compartment 热重配整组增删。

#139 htmlComment 是首个**带取消分支的插入型操作**：登记 `FORMAT_OPERATIONS` 但不走 INLINE 表（与 wikilink/inlineMath 同类分派），取消分支自行实现——Lezer 实测行内注释节点为 `Comment`、整段（可跨行）为 `CommentBlock`，**不是 HTMLBlock**（那是真 HTML 块，其内注释不可达、不可取消，属允许边界）；空插形态固定 `<!-- -->`（带一个空格——`<!---->` 不解析为 Comment，升级 @lezer/markdown 时 `formatOperations.test.ts` 的 #139 describe 是哨兵）。阅读侧隐藏经 `htmlComment.ts` 的 `stripHtmlComments` 纯函数：**整段真删除（仅保留换行）**——行内不留空位（验收修复：等长空格替换在渲染折叠后残留可见空格，`单<!--注释-->词` 曾显示为 `单 词`）；坐标系安全的前提是全部锚点取行首/行尾偏移（readingBlocks 的 token.map 行号/env.lineStarts 均为原文坐标、查找走 state.doc 原文），新增行内坐标消费者前须先核对此前提，代码保护为保守超集（缩进 ≥4 空格/tab 行不剥，列表续行注释会被多保护——多保护优于误剥）。
