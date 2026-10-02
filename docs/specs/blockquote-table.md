# 引用块内表格

规格：[GitHub #296](https://github.com/ONEGAYI/vsidian/issues/296)。诊断证据（Lezer 树结构对照、三层缺口定位）见该票正文，此处不重复。本规格已获用户确认（2026-10-02）；实现与人工验收状态另记。

## 问题与目标

引用块（blockquote）内的表格在 Live 模式完全源码化（网格装饰不生效）、在引用块内插入表格直接落成顶层表格（脱离引用层级）、结构编辑（插删行列）不保持引用层级。三层缺口同根：表格功能整体不感知引用块容器。目标：引用块内（含多层引用、引用内列表）的表格获得与顶层表格一致的网格形态与编辑体验；列表场景的创建缺口一并补齐。

## 已确认交互契约（用户 2026-10-02 批复）

1. **网格化**：引用块内表格（含 `> > ` 多层、`> - ` 引用内列表）在 Live 模式呈现网格形态，与顶层表格同观感；`>` 前缀的渲染态显隐沿用 QuoteMark 既有机制（未触及时隐藏、触及显形），网格行与引用行类（竖条、背景）组合呈现不互斥。
2. **插入保持层级**：在引用块内执行插入表格，产出各表格行携带对应层级前缀——表头行带完整容器前缀（引用层 + 列表标记），分隔与数据行同层（列表场景后续行用内容列缩进替代标记）；表格前后的分隔空行带同层引用前缀（`> ` 形态），保持引用块视觉连续。多层引用逐层还原。
3. **结构编辑补前缀**：插行、行尾追加、插删列的行重建、格区粘贴的整表重建等所有产出新表格行的操作，新行携带所在表格行的前缀；删除整表或删除行时连同该行前缀一起删净（用户确认的「消」语义）。
4. **不做自动清层**：删除表格后残留的 `> ` 空行不自动清理——空引用行的退出交给既有「行前缀延续」行为（CONTEXT.md 词条），避免删表格引发未预期的引用块坍缩。
5. **lazy 行独立前缀**：引用块内无 `>` 前缀的表格行（lazy continuation，如无前缀分隔行）按该行自身前缀（长度 0）运算——各行前缀独立计算，不一表一常量。
6. **不受影响面不回归**：阅读模式（markdown-it 已正常渲染）；顶层表格与列表内表格的既有网格装饰；`table-interaction-rework.md` 的全部交互契约。

## 实施决策

- **前缀语义单一口径**：某表格行的前缀 = 行首到该行表格结构节点（TableHeader/TableDelimiter/TableRow）起点的距离。装饰层（网格计划）、结构层（行身份）、选区层（点击收缩）统一此口径；Lezer 行身份节点的 `from` 即内容首，天然覆盖多层引用、引用内列表、缩进引用与 lazy 行。
- **行身份携带前缀**：`TableRowInfo` 增可选字段 `prefixLen`（缺省 0，不改变既有调用与测试构造）；`tableRowsAt` 从行身份节点与行首的距离填充。
- **网格计划放行 QuoteMark**：`tableGridPlan` 遍历 Table 直接子节点时显式跳过 QuoteMark（引用行前缀在 Lezer 树中挂 Table 直接子节点，实测形态见 #296）；其余未知直接子节点仍整体降级为源码形态，**不放宽既有安全边界**。
- **行文本空白替换运算（实施演化，取代原「剥离」方案）**：所有按整行文本解析表格结构的调用点（`parseTableDelimiter`、`tableRowCellsForColumns`、`splitTableRowCells`、`collectColumnSamples`）改为传「前缀替换为等宽空格的整行 + 行首 lineStart」（`tableCells.ts` 的 `blankContainerPrefix`）。剥除方案在实施中被推翻：无边界纯空白行（` | | `）的行身份节点本身跳过行首空白（前缀 1），剥除后形态从无边界变有边界、尾段空白被吞格数掉一，整表降级——TDD 既有用例暴露。替换方案让结构性字符（`>`/列表标记）不参与格拆分、留下的空白交给 `splitTableRowCells` 既有的边界容忍机制消化，行内坐标全程零偏移（无需前后加减 prefixLen）。区间重建仍从前缀右端起（前缀原文保留在文档中）。
- **创建层复用形态学单一事实源**：插入表格的前缀解析复用 `src/shared/listPrefix.ts` 的 `parseLinePrefix`（引用层 + 缩进 + 列表标记），不另起解析；表格行前缀不含任务标记（表格行不是列表项）。
- **纯函数层保持树无关**：`tableStructure`/`tableRegion` 只做字符串与区间运算，前缀作为行身份数据传入，语义继续由单测固定。

## 审查轮补齐（review-loops，2026-10-02）

首轮交付后的高强度审查（三只读子代理 + 主代理核实）确认九项缺口并修复，核心两项为 P1：

- **格切分内建前缀感知（取代散装 blank 接线）**：`splitTableRowCells` / `tableRowCellsForColumns` / `parseTableDelimiter` / `planBlankRowCellInput` 增可选 `prefixLen` 参数（缺省 0，既有调用零变化），内部做「blank + **首格 from clamp 到前缀右端**」。clamp 是关键增量：无边界行（`> a | b`）blank 后首段含内容不被 shift，不 clamp 时首格区间覆盖前缀区——插列管道落到 `>` 之前、删列吞掉 `>`、列移动把 `> ` 带进格值、剪贴板格值被污染（P1）。全部消费点（tableEditing / liveDecorations / tableRegion 家族 / tableControls / quickActionState / formatOperations / syncController IME 收尾）统一改传原文 + prefixLen；无树上下文处用 `containerPrefixLen` 形态学回退（审查证实与树口径一致）。
- **格内编辑防护层接线（P1）**：修复前 `editableGridCellAt` 对引用表整体返回 null——① 分隔行查找 `firstChild.nextSibling` 被 QuoteMark 挡住（改按名遍历）；② 原文切分多出含 `>` 的首格与列数不符（改传 prefixLen）。下游 Enter 拆行、跨格选区键入吞字、Mod-a/方向键/鼠标选区失效全部随之修复；canonical 重建（清空兜底、暴露管道重写）补行首前缀，引用行不因重建丢层级。
- **创建层三处保底**：裸列表标记（`-`、`1.`，gap1 为空的合法空项形态）与裸引用 `>` 后保底一个空格——此前产出 `-|  |  |` 粘连形态且表格脱离列表层级；正文行中部插表的右侧文字补完整前缀（含列表标记）——此前裸行落在引用块外（引用空行打断 lazy continuation，实测 markdown-it 确认降层）。
- **插列无边界分支（基线缺陷顺带修复）**：目标列是首格且该行无左边界管道时，piece 从「空格+管道」改为「管道开头」形态（`'| |'` / `'| --- |'`）——前者与行首空白融合、列数不增，**顶层无边界行的插列静默无效是基线既有缺陷**，引用场景由 #296 放大可见，一并修复并以新契约钉住。
- 验证：25 项新契约测试先红后绿（撤修复可复现全部缺口）；全量单测 4982、browser 全脚本、集成全量（含新增引用表编辑防护用例）另行记录于当轮提交。

## 渲染断裂修复（真机验收报障，2026-10-02 第二轮）

审查轮全绿交付后用户真机验收（A56 视觉夹具）报障**渲染断裂**：引用内表格一表拆两块（互补列分块）、两块垂直错位约一行高、列序与源相反、引用竖条整体丢失、拖拽手柄悬空、底部控件条横贯全宽。经 Playwright Chromium 复现（`tmpDiagBq` 诊断脚本，与真机截图同构）并裸 CM6 隔离实验钉住根因：

- **根因一（格位抢占）**：CM6 对行首 `Decoration.replace({})`（QuoteMark/ListMark 隐藏所用）**固有产出 `<span contenteditable="false"></span>` 空占位**——裸 CM6 实验证实与 mark 装饰无关、无法从发射侧消除。该 span 在 `display: grid` 的表格行内是 grid item：每层容器前缀占掉一格位，格子整体右移一格、尾列 wrap 到第二排。同时解释拆两块（互补列）、错位一行、列序颠倒（首列被挤至右块）与行高翻倍。引用内列表续行的管道前裸缩进空格（匿名 grid item）与列表圆点 `::before` 伪元素同为此族占位。
- **根因二（竖条覆盖）**：网格行通用规则的 `padding: 0; box-shadow: none`（#42 引入）源顺序在 `.vsidian-quote-line` 之后，同特异性抹平了引用竖条与内容缩进——顶层表格行为无差，引用表格行竖条全失。
- **根因三（别名桥缺口）**：`tableGridLineDeco` 不走 `applyObsidianDomAlias`，网格行丢 `.HyperMD-quote` 等兼容别名（样式契约承诺的选择器不命中）。
- **为何自动化全绿仍漏**：集成绘制层断言落在 elementFromPoint 命中与 gridDisplay（存在性/命中），文字仍在 DOM、命中照样成立；jsdom 无布局。**没有断言「同行格子同水平带、列序正确、网格背景连续」**——真机截图是唯一抓到它的验收层。

修复（三层）：

- **前缀 mark 化**：`emitTableRowMarks` 对 grid 行发射 `vsidian-table-prefix` mark 覆盖 `[line.from, line.from + prefixLen)`（与 QuoteMark/ListMark 的 replace 区间重叠由 CM6 自动拆分，实测安全）；光标/选区触及前缀区时退场（与 QuoteMark 显形联动，可编辑层级）。CSS 隐藏清单追加 `.vsidian-table-prefix` 与 `> span[contenteditable="false"]:not([class])`（replace 空占位），格位外行级残留一律排除出 grid 放置；列表圆点 `::before` 改 `position: absolute` 挂行缘。
- **竖条恢复**：删除网格行通用规则的 `padding: 0; box-shadow: none`（顶层行为不变），新增 `.vsidian-table-grid-row.vsidian-quote-line` 组合规则恢复 inset 竖条与 `calc(0.9em + 3px)` 内容缩进——引用内表格行与普通引用行同观感。
- **别名桥补齐**：`tableGridLineDeco` 的行类串过 `applyObsidianDomAlias`。

回归钉法（防同型盲区）：新增浏览器脚本 `blockquoteTablePaint`（入 `run.mjs` 清单）——五场景（顶层对照/单层/双层/引用内列表/无边界）断言**同行格同水平带 ±1px、列序=源列序、各行首格左对齐、行高不翻倍、竖条 computed box-shadow、HyperMD-quote 别名、格内文字命中**；jsdom 钉前缀 mark 发射/触及退场/顶层不发与别名；`tablePaintCssContract` 钉隐藏清单选择器与竖条规则（断言只查声明区——规则头注释会提到被删声明的历史）。样式清单新增公开条目 `live-table-prefix`（双语），`live-table-grid-row` purpose 补记组合态语义。

触及态已知边界：光标进入前缀区时前缀文本显形并参与行内布局（占首格位、格区右移）——短暂编辑态，回到格内即恢复；「触及显形可编辑」语义完整（既有 jsdom 契约钉住），布局让位不在本票修复范围。

## 二轮真机反馈修复（拖选蒙版 / 边界导航 / 残缺回退，2026-10-02 第四轮）

渲染断裂修复交付后用户真机复验提出三项，全部落地：

- **跨格拖选蒙版失效（缺陷）**：引用表格拖选时光标被折叠但蒙版不出现、拖选钉死。根因：`emitTableRowMarks` 的 region 消费判定 `region.tableFrom === table.from` 用 Lezer Table 节点 from（跳过前缀落在管道位）对比拖选锚定的表格首行行首——引用表两者相差 prefixLen 恒不等，蒙版类永不并入格装饰。修复：判等归一到行首口径（`doc.lineAt(table.from).from`）；全仓排查仅此一处跨口径判等。回归：jsdom 直接传 region 断言蒙版类并入 + 浏览器真拖选 2×2 蒙版四格。
- **边界水平导航（交互契约，用户指令）**：此前首格最左按 Left 被吞键卡死（`navTargetsOf` 无左邻目标仍 `return true`），表格内外键盘不可互达——顶层同样卡死。新契约：①首格最左 Left / 末格最右 Right 直达表格块外紧邻行（行尾/行首）；表格贴文档边界时交原生落行首/行尾（前缀触及显形，层级编辑入口保留）。②紧邻表格的外部行尾/行首按 Right/Left 直达首/末格**内容**（跳过隐藏前缀与管道——所见即所得，下一个可见位置就是格内容）。垂直方向的进出接管既有（`moveVerticallyAcrossGrid`），水平对齐补齐。
- **引用前缀残缺 → 整表回退源码（降级契约，用户指令；live 与 reading 同口径）**：残缺场景（删除某行 `>`、纯缩进续行）下，Lezer 仍把脱离引用块的行留在 Table 内并网格化（视觉混入）、markdown-it 则踢出残缺行渲染半张表头表（两侧不一致且都不是用户想要的）。新契约：表头与各数据行的引用层级须一致（`tableCells.quoteDepthOfLine`，live 树内行集合同义校验 + reading 形态学 `quoteTableRowsDegraded` 同源共享），不一致时 live 整表不网格化（回退源码行类）、reading 把 blockquote 内的表格部分替换为源文 `<pre class="vsidian-reading-table-source">`（残缺行本身已是相邻段落，不再渲染半张表）。**分隔行豁免**（无前缀 lazy 分隔是 GFM 常见合法形态，契约 5 保留）；顶层表层级恒 0 不受影响。已知边界：Lezer 已把残缺行拆出表外的形态（如数据行多一层 `> >`，表内只剩孤儿表头）超出表内可判定范围——live 孤儿表头暂保持网格化、reading 侧形态学判定仍会回退；拆散形态待真机反馈后另行开票。
- 验证：jsdom 先红后绿（蒙版 1 + 导航 7 + 降级 live 6 + reading 3）；浏览器 `blockquoteTablePaint` 增补「边界导航与拖选蒙版」场景（真实键盘四向进出 + 真拖选）；双模式端到端探针复核六种残缺形态（完好/lazy 豁免不受影响，主场景两侧一致回退）。

## 三轮真机反馈修复（拖选纳入前缀 / 右键两缺陷 / 实验性开关，2026-10-02 第五轮）

二轮交付后用户复验再提三组，全部落地：

- **格内起点拖选跨格把引用符号纳入选区（缺陷）**：先点击单元格落光标、再拖选跨格时 `> ` 显形进选区。根因是**显形谓词用区间重叠语义**——非空选区跨越前缀/QuoteMark 隐藏区即触发退场显形，而「选区区间覆盖中间隐藏结构」恰是跨格拖选的常态。修复：新增**端点触及**谓词 `selectionEndpointsTouchRange`（折叠光标与旧语义一致；非空选区只有 head/anchor 端点落入区间才算触及），前缀 mark（`liveDecorations` 表格前缀退场）与 QuoteMark/ListMark 隐藏退场三处换用——跨越不显形、扩选到行首（端点进入）仍可编辑层级。回归：jsdom 跨越不退场/端点进入退场两例 + 浏览器真拖选断言「表格行可见文本不含 `>`」（视觉口径——field 层前缀 mark 计 2 为伴证；DOM 中该 mark 被 QuoteMark replace 优先占位不直接出现，断言不查 DOM 存在性）。
- **右键两关键缺陷（#186 补票，bug2 立即修复）**：
  - 块内表格右键未识别为表格右键——降级矩阵失效。根因：`shared/contextMenu.ts` 的 `TABLE_DELIMITER_RE` 不认行首容器前缀，引用表分隔行 `> |---|` 不匹配 → zone 判 normal、格式/段落/插入整簇不置灰。修复：分隔行判定先剥容器前缀（`parseLinePrefix` 同源于 `containerPrefixLen`）；引用/quote-list 组合容器与顶层表同矩阵。
  - 选中单元格后右键失焦选区——两条链路同时修：①Chrome contenteditable 右键 mousedown 默认把选区重定位到点击处，`contextMenuSelectionGuard`（domEventHandlers）在右键落入选区内**或活跃矩形蒙版的表格行区间内**时 preventDefault（蒙版态 CM6 选区折叠在锚格，需按蒙版行区间判；VSCode 同款语义，contextmenu 照常触发）；②右键菜单 `focusMenuDom` 夺焦触发 `tableRegionSelection.onBlur` 清矩形蒙版（用户「失焦选区」的字面机制）——onBlur 对 relatedTarget/activeElement 在 `.vsidian-context-menu`/`.vsidian-outline-menu` 内的夺焦豁免，菜单关闭还焦后蒙版保持。
  - **职能转移（用户决策）**：边界导航只做出入不承担引用层级控制；「移除引用块 / 增一层引用」等层级操作职能转移至表格专属右键菜单——已补进 #186 切片清单（本轮未实施菜单项本身）。
- **设置侧栏「实验性功能」分组 + 「块内表格渲染」开关（用户指令）**：侧栏新增第三内置分组「实验性功能」（`experimental.*` 前缀定义，锥形瓶图标；#163「侧栏两组」契约随之修订），页内首个标题组「表格行为」（`experimental.table.*`），首项 `experimental.table.blockRender`（boolean 默认开）。关闭时：live 经 `tableContainerRenderFacet`（Compartment 热重配，`liveDecorationsField` 检测 facet 变化全量重建、gridPlans 缓存丢弃）对容器前缀行不网格化（回 #296 之前形态——引用行类照旧、管道源文可见）。三轮落地时 reading 曾同步回退源文；**六轮用户决策改为设置只管 live**——reading 原行为就是 markdown-it 渲染且无风险，containerTableSource 通道整体拆除（残缺回退的 quoteTableRowsDegraded 判定不受影响），设置描述文案同步改为「仅实时预览」。设置页搜索分组、宿主快照默认值（`settingsService` 注册表驱动）、语言包双语同步接入。
- 验证：jsdom 先红后绿（前缀端点 2 + zone 2 + 保选区 1 + 蒙版豁免 1 + 设置渲染 2 + 默认快照 1 + 降级 3 + facet 2）；浏览器 `blockquoteTablePaint` 增补「拖选前缀保持隐藏与右键保选区」场景、`settingsPage` 增补实验性分组绘制层断言（开关可见/默认开/标题可见）；全量单测 5017、compile、样式契约 8 项、全量浏览器 136.55s 全绿。

## 四轮真机反馈修复（拖拽移动后前缀显形 / undo 同款，2026-10-02 第六轮）

三轮交付（rebase 至 main 04f9524 后）用户真机复验报障：**拖拽把手交换列/移动行后引用块符号显形、网格破裂；移动后按撤销同样显形；点击表格外即恢复正常**。定位两层同根因——移动与撤销的 selection 都交给 CM6 默认映射，而映射对「光标落在替换区间内部」的既定行为是归到区间左端（`SelectionRange.map` 的 assoc=-1 语义）：

- **移动落点（缺陷）**：`runTableRowMove`/`runTableColumnMove` 的 dispatch 不带 selection。行移动的 change 含前缀整行替换，格内光标映到行首（前缀区左端）；列移动的 change 从前缀右端起替换，光标映到 `lineFrom + prefixLen`（前缀区闭区间右端）——两端都命中三轮引入的「端点触及显形」谓词，前缀显形、网格破裂。修复：两个 planner（`planTableRowMove`/`planTableColumnMove`）增可选 `cursor` 参数并返回 `selection`——**光标随原内容搬移**（行移动：目标物理行行首 + 原行内偏移——行首按置换后各槽位文本累计，见下方审查轮补正；列移动：原格内容跟随列变换到新列，保留内容内偏移并 clamp），光标不在内容行上（表外/分隔行）不给 selection、维持默认映射（表外位置不受行内替换影响）。调用方 dispatch 时带上；顶层表格同样受益（此前光标映到行首隐藏管道，视觉无感但位置语义差）。
- **撤销落点（同根缺陷）**：undo 反推的整行替换经 `dispatchExternalChanges` 的 `selection.map(ChangeSet)` 映射，格内容里的好光标同样被归到区间左端（前缀端点）。修复：外部变更应用后用**变更后 state** 的网格信息把主光标钳回最近格内容（`clampExternalCursor`——落前缀/管道/格缘空白时钳到最近格 `contentFrom`/`contentTo`，已在格内容或非网格行返回不动），selection-only 补事务与变更事务同步连发、浏览器只渲染最终态。口径边界：只处理折叠主光标；**用户主动定位**（本地选区事务）不经过该通道，「点击前缀编辑引用层级」的显形语义不受影响。
- 回归钉法：jsdom 三例（列交换光标跟随原格内容且不在前缀闭区间、行移动同款、undo 后不在前缀闭区间——全链路走 `setupLinked` 宿主撤销通道）；浏览器 `blockquoteTablePaint` 增补「拖拽交换列后前缀保持隐藏」场景（真抓手 pointer 拖拽：列 0 把手拖到列 1 右半，断言交换生效 + 表格行可见文本不含 `>` + 光标留在行内容区）。已知边界：光标在分隔行上发起移动时维持默认映射（分隔行无格内容可钳，用户不会在分隔行编辑后再拖把手，真机有反馈再议）。

## 审查轮补正（review-loops 第二次，2026-10-02，三只读子代理 + 主代理核实）

对六七轮交付的高强度审查发现六轮修复一处 P1 缺陷与一批 P3，全部修复：

- **行移动光标错位（P1）**：`planTableRowMove` 的 selection 用**旧目标行** lineFrom 加行内偏移——「行文本等长搬移」假设只对置换前成立，各物理行接收的新文本长度不同，后续行起点随前方槽位长度差平移（列移动做了 newLineTexts 补偿、行移动漏做）。不等长行下光标跨格漂移（探针实证偏 6-8 字符），行尾光标极端组合可复现显形报障。修复：目标槽位新行首按 `[槽0新文本, 分隔行(不变), 槽1..k-1 新文本]` 逐行 +1 换行累计；planner 契约注释钉死 doc 须为 LF 形态。回归：不等长行两例（格内容精确跟随 + 行尾光标落新行尾不进前缀）。
- **外部钳制两处收敛（P2/P3）**：①补事务用单 anchor spec 会整体替换选区、坍缩多光标（审查探针实证 2 range → 1）——改逐 range 钳制（EditorSelection.create 保持全部 range 与 mainIndex）；②无条件钳制会拽走用户主动放在**网格行前缀区**的远处光标（显形编辑态被误伤）——钳制收窄为「端点落在本笔替换区间内的折叠光标」（区间内才会被映射重定位，区间外不动）。回归：多光标 undo 不坍缩 + 远处网格行前缀光标不动两例。
- **move 类 dispatch 保多光标（P3）**：`runTable*Move` 的 `{ anchor }` spec 同样坍缩多 range——新增 `moveSelectionSpec`：其余 range 按 changes 默认映射、main（折叠光标）用 plan 跟随点；main 非空（选区态）退默认映射。回归：多 range 拖列不折叠且 main 跟随。
- **列移动前缀显形守恒（P3）**：光标在行首容器前缀区（`cursor < lineFrom + prefixLen`）拖列时前缀不参与列交换、字符级不变——selection 直接保留行内偏移（此前被吸附进首格内容，显形编辑态意外丢失）；与行移动的显形守恒口径统一。回归一例。
- **维护批（P3）**：`settings.ts` 键注释更新为七轮口径（仅 live）；`tableEditing.ts` 孤儿注释归位与挤行整理；tree.json 补登 `blockquoteTablePaint.mjs`/`blockquoteTablePaintFixture.ts`（经 file-tree 技能入口）；`styleContractEn.test.ts` 标题计数 171→172 与断言对齐；reading 残缺判定的全文 `split` 提为切块入口一次（逐块 split 是 O(块数×全文行数)，引用表密集大文档可感知——审查实测 500 块/3000 行约半耗时在此）。
- 验证：六例先红后绿；全量单测/compile/样式契约/浏览器全量见提交记录。

## 五轮真机反馈修订（「块内表格渲染」只管 live，2026-10-02 第七轮）

用户反馈：该开关只应影响 live——reading 原行为就是 markdown-it 渲染且无风险。拆除 reading 侧接线：`splitReadingBlocks` / `renderReadingBlocks` / `readingVirtualView.setDocument` 的 `containerTableSource` 通道整体删除（`ReadingSplitOptions` 移除，`applyTableBlockRenderSetting` 只热重配 live facet、不再重载 reading 全文）；语言包描述改「仅实时预览，阅读模式始终渲染」。残缺回退（`quoteTableRowsDegraded`）是独立判定不受影响。回归：readingTable 新组 2 例经类型擦除传入关闭值、断言运行时被忽略（通道若被重建即红）。

## 验证与完成条件

- TDD：三层契约测试先行暴露缺口（装饰类名断言、创建产出文本断言、结构操作纯函数断言），再实现转绿。
- 装饰层断言落在用户可见物：网格行类、格 mark 文本（`>` 不得入格内容）、分隔行隐藏类；组合态（引用行 + 网格行）至少一条集成断言落在绘制层探针（`view.state.paint`），CSS 关键规则由契约测试钉住。
- 既有表格测试全绿（`tableCells`/`tableStructure`/`tableOps`/`tableRegion`/`tableCreate`/`liveTable`）；运行 compile、test:unit、test:browser、test:integration。
- 更新人工验证清单与文件树；自动验证不是用户验收。

## 已知边界（一期不含）

- 引用块内**裸空行或 lazy 正文行**上插入表格不猜测引用层级：光标行无容器前缀时按顶层表格产出（形态学不猜上下文）。
- 混合前缀表（含 lazy 行）的整块重建（格区粘贴的扩行）新行取区域首行前缀；行移动（拖排）按整行文本移动，前缀随行走。

## 参考与范围

不包含：引用块内 frontmatter 表格、引用块嵌套表格之外的容器新支持、Obsidian 式任意容器内表格拖拽迁移。执行目录：独立 worktree `vsidian-wt/blockquote-table-296`（分支 `blockquote-table-296`，基于 main 3171ab8——2026-10-02 用户确认「开始」后动工）。未授权推送、合并或版本发布。

Blocked by: 无
