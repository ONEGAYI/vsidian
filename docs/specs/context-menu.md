# 统一右键菜单规格（Live 正文全域接管）

状态：2026-09-28 设计访谈定档，规格随批次工作树 `docs/specs-batch-202609-menu` 落盘；决策回执与工单索引见 [batch-2026-09-menu.md](batch-2026-09-menu.md)。本文件是右键菜单的**单一事实源**：菜单内容、内核架构、交互契约与扩展约定均以此为准。

## 背景与问题

现状只有两套自绘右键菜单：大纲面板菜单（`outlineMenu.ts`）与正文块菜单（`blockMenu.ts`，仅「复制标题链接 / 复制块链接」两项）。正文其余位置（空行、普通文本、表格行、图形块上）右键一律透传浏览器原生菜单——**接管位反而丢失了剪切/复制/粘贴/全选等基础编辑功能**。本批次把 Live 正文右键统一收为插件控制的自绘菜单，并搭好注册 / 覆写基建，为「插件叠插件」（CONTEXT.md 三期考察）预留稳定入口。

## 范围

**目标**

- Live 正文**全域接管**右键：空行、普通文本、选区、表格行、围栏代码内部、图形块上均弹统一自绘菜单。
- 菜单内核提供**注册与覆写入口**（内置项编译期表 + 运行期覆写层），支持**聚类分组**（分隔线簇）与**多级子菜单**。
- 基础编辑项（剪切/复制/粘贴/全选）随基建交付，作为验收线。
- 旧 `blockMenu` 退役并入；`outlineMenu` 迁移到新内核（行为与视觉不变），并修复其子菜单溢出缺陷。

**非目标**

- **阅读模式不接管右键**（维持 [anchor-navigation.md](anchor-navigation.md) 既定边界，本次不修订）。
- **frontmatter 成型头区不接管**（透传原生菜单），注册表预留上下文谓词点位。
- 媒体（嵌入）、脚注、标注（callout）、新建数据库**不接线**；前三者图标备用生成（记账），数据库不生成。
- 「以纯文本形式粘贴」不做（CM6 粘贴本就是纯文本路径），图标备用生成。
- 表格 / 图形块 / 链接上的**专属差异化菜单项**留票位，本批不做。（2026-10-10 已切片承接：见 [batch-2026-10-menu-scenes.md](batch-2026-10-menu-scenes.md)，工单 #436–#439。）

## 术语

- **统一右键菜单**、**安全降级**的定义见 [CONTEXT.md](../../CONTEXT.md) 领域语言（随本批新增）。
- 「簇」= 分组分隔线隔开的菜单项集合，注册表以组 id 显式登记。

## 菜单结构（正文场景全量）

参考蓝本：Obsidian 编辑器右键菜单（段落正文、无选区场景，四张截图逐项转录，转录记录见批次总览附录）。基础三簇、两条分组线；子菜单内部再分组。场景簇按 zone 追加（#437 表格簇，2026-10 场景批次）。

### 簇 1：链接

| 菜单项 | 命令（`formatOperations` id） | 图标 key | 显隐 / enable |
|---|---|---|---|
| 打开链接 | `openLink` | `externalLink` | 仅链接命中显示（#439）；enable 恒可用 |
| 复制链接地址 | `copyLinkAddress` | `link` | 仅链接命中显示（#439） |
| 复制显示文字 | `copyLinkText` | `copy` | 仅链接命中显示（#439） |
| 新增链接 | `wikilink` | `link` | 常驻 |
| 新增外部链接 | `link` | `externalLink` | 常驻 |
| 复制标题链接 | （`blockMenu` 既有能力迁入） | `link` | 仅标题行显示 |
| 复制块链接 | （`blockMenu` 既有能力迁入） | `link` | 目标块存在时显示；表格按整块，空行隐藏 |

**#439 链接场景三项**（2026-10 批次落地）：命中判定 = `LinkMenuHit` 在场（#436 采集，仅 zone='normal'；嵌入 `![[…]]`、代码上下文、格内链接不采集）。打开链接按族分派激活消息（双链 → `wikilink.activate`，普通/autolink/宽松 → `link.activate`）——与 Ctrl+单击判定族同源同消息，外部 scheme 准入仍归宿主 `linkTarget`（菜单层不预判）；载荷派生纯函数在 `linkMenuCommandPayload`（`src/shared/contextMenu.ts`，复制取材 target 未 trim / href 原样 / display 别名优先同函数钉住）。复制两项经宿主剪贴板桥 text 变体。措辞红线（CONTEXT.md 术语约束）：用「复制链接地址」「复制显示文字」，不得泛称「复制链接」。键位入口（`openLink`/`copyLinkAddress`/`copyLinkText` 操作）默认未绑定，目标 = 焦点实例光标处链接命中（与「预览当前链接」同口径，无命中静默）。

### 簇 1.5：表格专属（`tableOps`，#437；仅 zone='table' 在场，平铺单簇不设子菜单）

| 菜单项 | 命令（键位注册表 id） | 图标 key | enable |
|---|---|---|---|
| 上方/下方插入行、左侧/右侧插入列 | `insertRowAbove` / `insertRowBelow` / `insertColumnLeft` / `insertColumnRight` | 同名新 key（资产归 #441） | 命中负载在场 |
| 删除行 / 删除列 | `deleteRow` / `deleteColumn` | 同名新 key | 命中负载在场 |
| 删除表格 | `deleteTable`（危险项红字） | `deleteTable` | 命中负载在场 |
| 选择行 / 选择列 | `selectTableRow` / `selectTableColumn`（文案参数化 `选择第 {n} 行/列`——labelParams） | `selectRow` / `selectColumn` | 命中行列坐标非 null |
| 选择整表 | `selectWholeTable` | `table`（复用） | 命中负载在场 |
| 复制表格 Markdown | `copyTableMarkdown` | `copy`（复用） | 命中负载在场 |
| 移除引用块 / 增一层引用 | `tableQuoteRemove` / `tableQuoteAdd`（blockquote-table 三轮职能转移项） | `removeQuote` / `quote`（复用） | 层级一致且 ≥1 / 层级一致（0 层可加） |

执行分派在 `runContextMenuCommand` 显式分支（结构六操作经 `runTableEditAt(view, hit.pos, op)` 不先移光标；删除表格整表层 `planTableRegionDelete`；选择三项 `selectTableRegion`（整表=全行全列一步构造）；复制走活跃格区优先（含命中格→格区，否则整表）经宿主剪贴板桥；层级两项经 `planTableQuoteLevel` 逐行独立增删层一笔事务）。命令面板/快捷键入口经 `ui.command` 按光标处表格执行（键位注册表登记、默认未绑定）。

### 场景簇：图形块（#438，仅 zone='graphic' 呈现）

图形块（渲染型围栏）上的专属簇 `graphicOps`，平铺四项、全部只读/导出——**不设「编辑源码」右键项**（编辑入口收敛于 `edit` 按钮是 [graphic-code-block-interaction.md](graphic-code-block-interaction.md) 契约 2 钉住的边界；表格簇见上方簇 1.5 节）：

| 菜单项 | 命令 | 图标 key | 显隐 / enable |
|---|---|---|---|
| 弹窗预览 | `graphicPopup` | `popupPreview` | 仅图形块；enable = svg 取图能力 + 渲染成功 |
| 导出 SVG | `graphicExportSvg` | `exportSvg` | 同上（不经弹窗直发 `diagram.export`） |
| 导出 PNG | `graphicExportPng` | `exportPng` | 同上；光栅化失败 toast 降级提示 |
| 复制源码 | `graphicCopySource` | `copy` | 仅图形块（错误降级块仍可用） |

渲染失败/负载缺省**置灰不隐藏**（保可发现性）；弹窗互斥沿 `popupMutex`，不新增协议消息（复用 `diagram.export`）；图标资产归 #441（留空降级）；四操作进键位注册表、默认未绑定（评估记录见 [keybindings.md](keybindings.md)）。

### 簇 2：块与格式（全部带子菜单）

**文本格式 ▸**（图标 `textFormat`）

| 子项 | 命令 | 图标 key |
|---|---|---|
| 加粗 / 倾斜 / 删除线 / 高亮 | `bold` / `italic` / `strikethrough` / `highlight` | 同名复用 |
| 行内代码 / 行内数学 / 注释 | `inlineCode` / `inlineMath` / `htmlComment` | `inlineCode` / `inlineMath` / `comment` |
| 清除格式 | `clearInline` | `clearInline` |

**段落设置 ▸**（图标 `paragraphStyle`；各项按当前行实际结构点亮勾选，正文场景「正文 ✓」已经参考图证实，其余按同规则推导、人工验收核对。**子菜单内分子类组**（验收反馈落地）：`正文 + 标题 1–6`｜`列表`｜`引用` 三组，组边界落分隔线（与顶级三簇同机制——内核 `sortMenuDefsByGroup` 组聚排 + DOM 组边界分隔线，任意子菜单按 `group` 字段生效，空组自然收敛））

| 子项 | 子组 | 命令 | 图标 key / 徽标 |
|---|---|---|---|
| 正文 | `paragraphHeading` | `headingNone` | `normalText` |
| 标题 1–6 | `paragraphHeading` | `heading1`–`heading6` | 文字徽标 `H1`–`H6`（不经生图） |
| 无序 / 有序 / 任务列表 | `paragraphList` | `bulletList` / `orderedList` / `taskList` | 同名复用 |
| 引用 | `paragraphQuote` | `quote` | `quote`（末组单项——引用之后无更多项，已向用户核实） |

**插入 ▸**（图标 `insertPlus`）

| 子项 | 命令 | 图标 key |
|---|---|---|
| 表格 | 与快速操作条建表同源入口 | `table` |
| 分隔线 | `horizontalRule` | `horizontalRule` |
| 代码块 | `codeBlock` | `codeBlock` |
| 数学块 | `blockMath` | `blockMath` |

**媒体 ▸ 不出现**（嵌入类未定档；图标 `media` 备用生成）。

### 簇 3：剪贴板

| 菜单项 | 图标 key | enable |
|---|---|---|
| 剪切 | `cut` | 有选区 |
| 复制 | `copy` | 有选区 |
| 粘贴 | `paste` | 常驻 |
| 全选 | `selectAll` | 常驻 |

### 上下文差异化与安全降级矩阵

统一接管后，结构敏感区域的**写操作必须置灰**（置灰项仍显示，保留可发现性；「隐藏」仅用于显隐规则声明的场合）：

| 区域 | 簇 1 新增链接 / 新增外部链接 | 簇 1 链接场景三项（#439） | 簇 1 块链接两项 | 表格专属簇（#437） | 图形专属簇（#438） | 簇 2 全部子菜单 | 簇 3 剪贴板 |
|---|---|---|---|---|---|---|---|
| 普通正文 / 空行 | 可用 | 不显示（无链接命中） | 按目标显隐 | **隐藏**（zone 谓词，非表格区不在场） | **不出现**（zone 谓词） | 可用 | 可用 |
| 正文有选区 | 可用 | 不显示（无链接命中） | 按目标显隐 | 隐藏 | 不出现 | 可用 | 剪切/复制亮，其余同左 |
| 表格单元格内 | **置灰** | **不显示**（格内不采链接负载——格内链接已有单击即跳） | 可用（整块） | **在场**：命中负载在场亮；解析失败（源码降级表/残缺表）整簇**置灰不隐藏**；分隔行/ragged 行命中的选择行/列单项置灰；层级两项按一致性 | 不出现 | **整簇置灰** | 可用 |
| 引用块内表格 | 置灰 | 不显示 | 可用（整块） | 在场（层级两项按层级一致性与 ≥1） | 不出现 | 整簇置灰 | 可用 |
| 围栏代码内部 | **置灰** | 不显示 | 可用（整块） | 隐藏 | 不出现（zone='fence'） | **整簇置灰** | 可用 |
| 图形块上（渲染成功） | **置灰** | 不显示 | 可用 | 隐藏 | 四项全亮 | **整簇置灰** | 可用 |
| 图形块上（错误降级 / 无 svg 能力渲染器） | **置灰** | 不显示 | 可用 | 隐藏 | 弹窗/导出三项**置灰**、复制源码仍亮 | **整簇置灰** | 可用 |
| 链接文字上（#436 采集：双链/普通/autolink/宽松） | 可用 | **三项显示且可用**（簇首上下文动作；打开与 Ctrl+单击同源，复制走剪贴板桥） | 按目标显隐 | 隐藏 | 不出现 | 可用 | 可用 |
| frontmatter 成型头区 | — 不接管，透传原生菜单 — | | | | | | |
| 阅读模式 | — 不接管 — | | | | | | |

安全降级由注册表的上下文谓词实现，**新增菜单项必须显式声明 `when` / `enable`，不得默认继承「到处可用」**。

## 内核架构

### 菜单项描述符

注册单位为一条描述符（建议 `MenuItemDescriptor`，模块落 `src/shared/`，文件名实施期定）：

| 字段 | 语义 |
|---|---|
| `id` | 菜单项 id，与命令标识一一对应 |
| `group` | 簇 id（组登记于组表，含组间顺序；组内顺序由 `order` 定） |
| `labelKey` | 语言包消息键（双语言包 parity 把关） |
| `iconKey` / `badge` | 图标 key（须存在于图标 key 表）或文字徽标（如 `H1`–`H6`） |
| `when` | 上下文显隐谓词（如「标题行」「块目标存在」） |
| `enable` | 置灰谓词（如「有选区」「结构敏感区」） |
| `checked` | 勾选态谓词（段落设置为首个消费者；文本格式类不显示勾选——切换语义下勾选意义模糊） |
| `children` | 子项描述符（数据结构支持任意嵌套，**内置菜单最深两级**） |
| `danger` | 危险项红字（大纲菜单既有语义沿用） |
| 快捷键提示 | **不手填**，由键位注册表派生当前生效绑定 |

### 内置表 + 运行期覆写层

- **内置项**：`as const` 编译期表（照 `formatOperations` 惯例），单一事实源。
- **运行期层**：照 `graphicRenderers` 惯例——模块私有 Map + 访问器 + `__registerForTest` 测试钩子。提供 `register`（新增）/ `override(id, partial)`（覆写）/ 隐藏内置项。
- **渲染唯一路径**：内置项全量经运行期层渲染（内置 = 第一个注册者），内核无第二套代码路径。
- **覆写语义**：可换 handler、文案键、图标、`enable` / `checked` / `when` 谓词与可见性；**不允许删除内置项，只允许隐藏**（保底可用性）；同 id 后注册者胜，记录覆写来源便于排查。「后注册者胜」覆盖 register/override 交错序列——覆写同样入还原栈，先注册者的 cleanup 不会清掉更晚的覆写（review 修复轮钉住，契约测试含交错用例）；环嵌套（子树引用自身 id）在注册与覆写期双侧拒绝（覆写换 children 同样是引入面）。已知边界：还原是栈式 LWW——先注册者卸载（cleanup 跳过）后，后注册者再卸载会把条目还原到先注册者的版本（已卸载方短暂「复活」）；当前无运行期注册方，接线第三方注册入口时如需严格卸载语义再评估（review 二轮披露）。此即「插件叠插件」的第一步基建。
- **空组收起**：组内可见项为零时，整组连同分隔线消失；组内置灰项不触发收起。

**附加组件公开边界**（2026-10-05 确认；**T10（#359，2026-10-07）已实施**）：附加组件可以新增自己的菜单项，不允许覆写内置项。上面的同名覆盖、`override` 与隐藏机制属于内核实现，不能原样作为附加组件公开接口；公开接入须校验命名空间与归属，拒绝通过同名注册间接修改内置项。此处记录设计边界，未修改现有内核实现；接入决策见 [ADR-0012](../adr/0012-vsidian-addons-distribution-api-governance.md)。

T10 落地形态：附加组件经页面 SDK `menus.registerItem`（仅编辑器页）新增菜单项——局部 ID 由平台注入命名空间（`<组件ID>.<局部ID>`，局部 ID 禁点号——结构上免疫内置覆写与跨组件归属侵犯），呈现在独立组件簇（`addon.<组件ID>`，追加在内置三簇之后）；label 为组件自由文本（不进 Vsidian 字典，渲染层显式文字优先于 labelKey 取词）；iconKey 须在本文件图标 key 表内（未登记注册拒绝）；提示列沿键位注册表派生（组件命令的生效绑定）。停用/故障/卸载整组件回收（菜单项撤下，内置不受影响）。覆写/隐藏/接管内置项无任何公开入口（内核 override/hide 保持内部实现）。

### 基础编辑项链路（剪切/复制/粘贴/全选）

- **剪切 / 复制 / 粘贴经宿主剪贴板桥**（协议新增消息，沿用大纲菜单 `clipboard.write` 消息桥先例）：剪切 = 读选区文本 → 桥写剪贴板 → 删选区单笔事务；复制 = 读选区 → 桥写；粘贴 = 桥读（`env.clipboard.readText`）→ 光标处插入。已知边界（review 修复轮落档）：写方向**无回执协议**——剪切的选区删除不等写回执，宿主 `writeText` 失败仅控制台记日志（选区已删、剪贴板为旧内容；文档可 Ctrl+Z 恢复）；粘贴读失败 webview 记告警日志不弹窗；`clipboard.write` text 变体按文档权威行尾归一（#81 同 `codeblock.copy`，含大纲复制路径）。
- **全选**：CM6 纯选区事务，本地完成，零写回。
- **键位评估记录**（AGENTS.md 操作注册约定）：四项沿用 CM6 既有默认绑定（Ctrl+X/C/V/A），**不新增** vsidian 键位注册表条目；菜单提示列对这四项显示固定默认提示。

### 场景命中负载（#436 基建：表格/链接/图形块坐标进谓词数据面）

`MenuContextSnapshot`（谓词唯一数据面）自 #436 起含三类**可选**命中负载，供场景差异化菜单项（表格簇 #437 / 图形块簇 #438 / 链接项 #439）的 `when` / `enable` 与执行期消费。本节是字段与采集口径的落档：

- **TableMenuHit**（仅 zone='table'）：命中格的内容行/列索引（表头 = 第 0 行、分隔行无格身份 → null；格数与声明列数不齐的内容行列索引亦为 null）、表头/表体（`inHeader`）、行列总数、表格全部物理行区间（LF 行系）、命中处文档偏移（执行期定位入口输入——`runTableEditAt` 族以 pos 自行解析结构）、引用层级一致性与命中行层级（`quoteDepthOfLine` 同源；分隔行不参与一致性判定，lazy 豁免——与 blockquote-table 规格残缺口径一致）。采集复用 `tableRowsAt`（解析树行身份）与 gridPlans 列数缓存（缺省回退分隔行声明，前缀按行身份 `prefixLen` 剥离）；**解析树不认该表（源码降级表/残缺表）或命中行不在树行集合内时负载缺省**——不阻塞菜单打开，场景票按「负载在场」判 enable（置灰不隐藏）。**#437 已消费**：表格簇（上表）的 when/enable 与执行期输入即本负载；文案参数（选择第 {n} 行）经 labelParams 从 rowIndex/columnIndex 派生。
- **LinkMenuHit**（仅 zone='normal' 且命中链接）：族类（wikilink / link / autolink / loose，判定内核与次序完全复用 Ctrl+单击 activate 族——嵌入 `![[…]]` 经双链扫描守卫排除，代码上下文与头区抑制同口径）；目标原文（双链 `|` 之前未 trim / 外部 href 原样——activate 上报同口径）；显示文字（双链别名优先 / 普通链接链接文字 / autolink URL 本身 / 宽松文字段）；源区间。采集经 `menuLinkHitAtPos`（liveLinks 只读查询，activate 跳转行为零改动）。
- **GraphicMenuHit**（仅 zone='graphic'）：围栏行区间（`scanFenceBlocks`，未闭合到末行）、语言标识（info string trim 后——`isRenderedFenceInfo` 判定同键）、围栏源码（开闭围栏行之间内容）、svg 取图能力（`effectiveGraphicSvgExport(language, 'live')`——弹窗/导出 gate 同口径；能力 ≠ 渲染成功，错误态负载数据面同构）。#438 起负载补 `rendered?: boolean`（右键时 live 渲染容器的 state 属性 DOM 探针——错误降级 false，探针不可得缺省按成功放行、执行路径重渲染兜底），供 graphicOps 弹窗/导出三项的渲染成功 gate。
- **执行期通道**：`openContextMenu` 把完整快照记到控制器字段（`contextMenuTarget` 同款先例；`getContextMenuSnapshot` 只读投影），场景票命令分支执行期取用；锚点过期重验沿 `contextMenuDoc` 既有模式。
- **组序预登记**：`CONTEXT_MENU_GROUP_ORDER` 预登记 `tableOps` / `graphicOps`（链接簇后、块与格式簇前），避免三张场景票并行时同改一行常量；场景组无项时零产出（空组自然收起），预登记不改变菜单呈现。
- **SDK 面**：快照经 `addonPage.ts` re-export 进附加组件页面 SDK 菜单谓词输入，负载组成类型（`TableMenuHit` / `LinkMenuHit` / `MenuLinkKind` / `GraphicMenuHit`）一并透出；语义台账见 `addonApiCatalog.ts` menus-register 条目 `contextPayloads` 字段（向后兼容扩展，无基线重锚定）。

## 交互契约

- **定位**：视口系 fixed、右键点位锚定、右/下缘 clamp、底部放不下翻上方（提为内核公用纯函数，两菜单共用）。
- **子菜单**：默认右侧展开；**右缘放不下自动翻左侧**——此能力即大纲右置时子菜单溢出屏幕缺陷的修复载体，列入迁移验收线。显隐沿用 CSS `:hover` / `:focus-within`（无 JS 展开状态机），父项**点击也展开**作兜底，补 `aria-haspopup` / `aria-expanded` 派生。**子菜单内分组**（验收反馈落地）：子项 `group` 按组聚排（登记序优先、未登记子组按首现序），DOM 在组边界落分隔线（复用顶级 separator 类）；整组不可见时交界自然收敛为单线。
- **键盘**：`role=menu` / `menuitem`；ArrowUp/Down 移动、ArrowRight 进子级、ArrowLeft 退出、Enter/Space 执行、Esc 关闭整个菜单。菜单容器是 `tabindex=-1` 的程序聚焦落点（键盘导航起点），**不画焦点圈**（`:focus` 置 `outline: none`——Chromium `:focus-visible` 启发式会在键盘焦点转移到容器时画出宿主 focusBorder 黄圈；键盘可达性由菜单项按钮承担）。
- **快捷键提示列**：右对齐、**小字 + 降低不透明度，不与菜单项文字抢戏**（用户明确要求）；仅显示当前生效绑定，未绑定不占位。已知边界：剪贴板四项的固定提示按 Ctrl 语义显示（`Ctrl+X/C/V/A`），macOS 宿主实际为 Cmd 修饰——提示失真属已知盲点，待后续批次随平台感知提示一并修订；提示派生对 override 后子级条目的 command 变更不追溯（flatten 先到先得）——极边缘，改子级 command 且期待提示跟随的注册方应整树覆写（review 二轮披露）。
- **互斥与关闭**：同一时间至多一个菜单（沿既有互斥）；外点 pointerdown capture、Esc、执行命令后关闭。
- **锚点过期防御**：菜单打开期间文档变更（如外部同步）即放弃待执行命令（沿 `blockMenu` doc 实例判等模式）。
- **i18n**：全部文案过 `t()` 双语言包；菜单为瞬态 DOM，语言切换后下次打开生效（沿现状惯例）。

## 图标（Codex 移交清单）

生成流程按项目技能 `ai-icon-sheet-to-svg`（Codex 专属，ZCode 侧只产出本清单；key 接入 `scripts/quick-action-icons.py` 的 `KEYS`，风格对齐现有 17 枚快速操作图标：单色极简线稿、明暗两套主题色、18px 可读）。

**复用现有资产（16 枚，零新增）**：`link`、`bold`、`italic`、`strikethrough`、`highlight`、`inlineCode`、`inlineMath`、`clearInline`、`bulletList`、`orderedList`、`taskList`、`quote`、`table`、`horizontalRule`、`codeBlock`、`blockMath`（其中 `link` 同时服务簇 1 三处）。

**需 AI 新生成（14 枚）**：

| key | 图标语义（画什么） | 用途状态 |
|---|---|---|
| `externalLink` | 方框带左上外指箭头 | 接线 |
| `textFormat` | 记号笔笔尖 | 接线 |
| `paragraphStyle` | 段落号 ¶ | 接线 |
| `insertPlus` | 列表行加加号 | 接线 |
| `normalText` | 文本行（≡ 意象） | 接线 |
| `cut` | 张口剪刀 | 接线 |
| `copy` | 双叠方块 | 接线 |
| `paste` | 剪贴板带对勾 | 接线 |
| `selectAll` | 虚线描边方框 | 接线 |
| `comment` | 百分号（注释意象） | 接线 |
| `pastePlain` | 剪贴板带字母 T | #305 接线：粘贴纯文本 |
| `media` | 胶片 | 备用（嵌入类未定档） |
| `footnote` | 页面带笔 | 备用（脚注未定档） |
| `callout` | 引号块 | 备用（callout 属二期清单） |

不生成：`database`（Obsidian Bases，明确用不上）。H1–H6 用文字徽标，不经生图。

## 迁移与退役

- **`blockMenu` 退役**：两项迁入统一菜单簇 1；`blockTargetAt` 命中判定沿用；模块删除，测试迁移到新内核用例。
- **`outlineMenu` 迁移**：DOM 构建改用内核装配（菜单项描述符化：`danger`、disabled、子菜单均已有字段承载）；定位仍为侧栏坐标系；**行为与视觉不变、暂不配图标**（迁移不改视觉，图标只上正文菜单）。子菜单溢出修复随内核翻转能力生效——**「大纲面板右置时子菜单向左翻转不出屏」为迁移验收线**。
- **frontmatter 光标引导口径收窄（实施期决策补记）**：剪贴板「全选」与本菜单接管后，原「选区任一端在头区即引导至正文起点」的引导规则与全选语义冲突（全选必含头区，`Ctrl+A` 会被误弹回正文起点）。#183 起收窄为**选区两端都在头区才引导**（完全落入头区的选区仍被引导；跨头区与正文的选择放行——全选/跨头区拖选语义的前提）。判定在 `frontmatterEditing`，测试 `frontmatterInteraction.test.ts` 已随口径修订。
- **测试注入通道**：新内核对等提供 `*.test.contextMenu / menuClick / menuClose` 协议钩子（沿 `block.test.*` / `outline.test.*` 分层门控先例：宿主侧 `VSIDIAN_TEST_HOOKS` 门控、webview 侧被动接收）；旧钩子保留还是映射由实施期决定，三层测试不得出现无注入路径的菜单。

## 测试与验收

- **单测**（纯函数契约）：描述符表（id 唯一、组存在、图标 key 存在或徽标声明）；覆写层语义（后注册胜 / 隐藏不删 / 来源记录）；定位纯函数含**子菜单左右翻转矩阵**；安全降级矩阵逐区域；勾选判定；DOM 装配（role/aria、分组线、徽标、提示列小字浅色、置灰）。
- **浏览器回归**（Playwright 真实右键，涉输入/光标行为合并前必跑）：正文各区域开菜单、子菜单展开与翻转、快捷键提示渲染、剪贴板桥动作。
- **宿主集成**：注入消息通道端到端 + **绘制层断言**（`view.state.paint` 探针——视觉层断言评审必查约定）+ 新界面类名按 style-contract 技能评估登记契约探针。
- **i18n**：键集 parity 编译期把关；CJK 字面量防回潮扫描照常。
- **人工验证清单**待项（并入 manual-verification.md 本批次节）：物理鼠标开合观感、悬浮圆角条与图标明暗主题、提示列不抢戏、大纲右置子菜单翻转实测、IME 组词期右键不误触发。

## 扩展约定（落档）

新增或修改右键菜单项、簇、子菜单、覆写行为或图标接线前，必读本节：

1. **两表同步**：菜单项注册表新增带图标位的条目时，图标 key 必须已在图标 key 表（`quick-action-icons.py` `KEYS`）登记——接线项不得引用未生成 key；备用图标（`media` / `footnote` / `callout`）在表中登记但菜单不引用，属显式记账。#305 已将既有 `pastePlain` 资产接入纯文本粘贴项。#437 起场景簇按 S6 决策放宽为「两表同步登记即合规」：新 key（表格簇 10 枚）在两表登记但资产与 CSS 接线归 #441 后补（渲染层无规则时留空降级），单测以「待资产清单」钉住对账（`contextMenu.test.ts` 的 `SCENE_KEYS_PENDING_ASSETS`）。
2. **三步接入清单**：①描述符登记（含 `when` / `enable` 显式声明，安全降级矩阵不得因新项破例）→ ②图标 key 接入 → ③语言包双写 + 契约测试钉住。三步缺一不可合入。
3. **既有边界不得顺手放宽**：阅读模式不接管、frontmatter 头区不接管、内置项不可删只可隐藏、菜单提示列数据只派生自键位注册表（剪切/复制/全选固定提示除外；#305 粘贴两项已纳入注册表）、内置菜单最深两级。
4. **覆写层兼容承诺**：覆写语义（后注册胜、隐藏不删、来源记录）是对「插件叠插件」的第一个稳定面，破坏性变更需先出弃用声明。
