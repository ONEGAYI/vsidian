# T01 探针结论：路线 A（行级类 + 标题行真实子树）可编辑 Live 容器可行，解锁 T02

调研日期：2026-10-28。状态：[#652](https://github.com/ONEGAYI/vsidian/issues/652)（Callout 批次 T01）技术验证交付——探针在真实 Chromium + 生产 `WebviewSyncController` + 生产 CSS 下运行（Playwright 1.62.1 headless，经 `mount(parent, extraExtensions)` 注入探针扩展，**零生产源码改动**），31/31 断言通过、页面零脚本错误、退出码 0；语法对拍 35/35 夹具两端零分歧。自动化证据不等于用户人工验收（物理 IME、观感归 manual-verification）。

探针脚本留存于本票工作树 `.scratch/callout/`（gitignore，不随提交）：

- `calloutProbeFixture.ts` + `callout-probe.mjs`——可编辑容器三路线与样式/取色/性能探针（`node .scratch/callout/callout-probe.mjs`，日志 `.scratch/callout/probe.log`）
- `parityEntry.ts`——两端语法对拍（`npx esbuild --bundle --platform=node` 后 `node`，结果 `.scratch/callout/parity-result.json`）
- `obsidian-1.14.4-app.css`——本机 Obsidian 1.14.4 asar 提取件（取证源，不入库）
- `perf-baseline.log` / `perf-data/perf-report.json`——`node test/perf/runPerf.mjs .scratch/callout/perf-data` 当前基线

入库证据（供 T02/T03 消费）：[syntax-parity.json](data/callout-t01/syntax-parity.json)、[probe-evidence.json](data/callout-t01/probe-evidence.json)、[obsidian-1144-callout-defaults.json](data/callout-t01/obsidian-1144-callout-defaults.json)。

## 1. 总结论

**推荐路线 A：CM6 行级类（`.cm-line.callout/.callout-title/.callout-content` + `data-callout`）承载容器身份与逐行绘制，标题标记以行内 replace widget 呈现真实 `.callout-icon/.callout-fold` 子树，标题文字用 mark 装饰包真实 `.callout-title-inner`。** 正文行始终是真实 CM6 行——源坐标、跨行拖选、IME、撤销回流、既有正文控件全部原生保持。结论：**通过，解锁 T02**（附 §5.4 的四项实施边界与 §7 的性能红线）。

规格 §4.1 技术验证门逐条结论：

| 硬条件 | 结论 | 证据（探针断言 / 机制） |
| --- | --- | --- |
| 源坐标保持 | **通过** | 装饰零文本替换（仅标记区默认隐藏，触及即显形）；拖选/IME/外部增量的 from/to 全部命中源 offset（G2/G3/G4） |
| 中文 IME 组合输入 | **通过** | CDP 真组合（`Input.imeSetComposition` + `insertText`）于正文行与显形态标题行各实测定稿，光标随定稿前进、行身份不变（G3） |
| 跨行拖选 | **通过** | 标题行→正文行、正文两行真实鼠标拖选，选区坐标逐字节等于源区间（G2） |
| 撤销回流 | **通过（同构通道验证）** | 键入经标准出站链 `edit.request`；宿主撤销 = `doc.changed external` 增量回流，装饰重对齐、容器数不变（G4；宿主真撤销栈不在浏览器缝内，属 T02 集成面） |
| 嵌套结构 | **通过** | 双层嵌套下内外层行级类同挂、最内层 `data-callout` 胜出（G1；属性按深度升序后写胜出实现） |
| 既有正文控件 | **通过** | callout 行内表格网格行、代码行、双链、嵌入槽类名共存（G5：`.vsidian-table-grid-row.callout` 等） |
| 视口性能 | **通过（附红线）** | DOM 数全程有界（10 万行文档顶部/底部均 ≤ 82 行元素）；但探针的"每事务重扫视口树"形态呈 O(doc)（§7），T02 必须骑生产增量窗口发射 |
| 公开选择器 | **通过（边界明确）** | 类级选择器、属性选择器、标题子树后代选择器、片段作用域全部命中；跨行严格容器选择器（`.callout > .callout-content` 等）在 Live 不可达——这是行级形态的**既知边界**而非缺陷，规格 §8.1"正文真实位于 `.callout-content` 所表达的内容结构中"按"正文行即 `.callout-content` 元素"解释成立，严格父子容器家族仅承诺于阅读侧（§6.1 矩阵） |

两个对照路线按规格要求如实取证为**失败**（§5.2/§5.3），且取证过程中固定了两条 CM6 架构事实：**block 装饰必须由 StateField 提供**（ViewPlugin 声明即抛 `RangeError: Block decorations may not be specified via plugins`，探针首跑实证）；**DOM 重挂载会被 CM6 DOM 观察器在下一轮回收**。

## 2. 环境固定

| 项 | 值 |
| --- | --- |
| 仓库基线 | `63b96ab9`（feat/callout-t01，main 同点；生产代码与公开契约本票零改动） |
| 已发布样式基线 | v1.5.1（package.json 与最新 tag 一致）；`limit-callout` 契约条目仍为"不支持"态（styleContract.ts:1427，T06 转已支持时保留历史 id） |
| 浏览器 | Playwright 1.62.1 内置 headless Chromium（生产控制器缝，与 `test:browser` 同源） |
| 集成下界宿主 | VSCode 1.82.3（testHost 契约；本票浏览器探针不涉宿主） |
| Node | v24.20.0（探针进程；产物面向宿主 Node 18 API 面） |
| Obsidian 取证源 | 本机安装 **1.14.4**（`obsidian.asar` 内 app.css 668,223 B + app.js 提取）；帮助页 obsidian-help master；开发者文档 obsidian-developer-docs main（2026-10-28 读取） |

网络抖动记录：obsidian.md 帮助页正文为 JS 渲染，WebFetch 两度失败后改走 GitHub 源仓库成功；GitHub API/raw 间歇 TLS/EOF，按票面重试 2–3 次后全部取证成功，无未取证项。

## 3. Obsidian 默认主题取证（1.14.4，版本锚定）

完整事实表入库 [obsidian-1144-callout-defaults.json](data/callout-t01/obsidian-1144-callout-defaults.json)，要点：

- **类型与别名**：帮助页 14 类型 + 16 别名与规格 §3.2 清单一致；**`important` 在帮助页列为 tip 别名，但 app.css 给它独立变量 `--callout-important`（值 = cyan，图标与 tip 同为 lucide-flame）**——两者并存不矛盾：语法归类按帮助页（tip 别名），CSS 变量面独立登记。这正是规格 §8.2 要求分开核对的那处分歧，T06 需同时落 `--callout-tip` 与 `--callout-important`。
- **变量默认值**（app.css `body` 层）：border-width 0px、border-opacity 0.25、padding `12px 12px 12px 24px`、radius 4px、blend-mode 亮 darken/暗 lighten、title-weight 基础字重+200、content-padding 0、content-background transparent。
- **类型色**：每类型变量引调色板（`--callout-default`→`--color-blue` 亮 #086ddd/暗 #027aff 等，明暗各一组）；`--callout-quote` 为固定 #9e9e9e 不走调色板。**现代默认值为标准 CSS 颜色而非 RGB 三元组**（消费面 `color-mix(in oklch, var(--callout-color) 10%, transparent)`）——1.13 起的破坏性变更（社区 callout-manager issue #54 佐证），对 §6.2 双形态接收设计直接相关。
- **图标**：全部 Lucide id（lucide-pencil/-flame/-check-circle-2…），两处例外照录：question 写作 `help-circle`（无前缀）、quote 为内部名 `quote-glyph`——图标解析须容错无前缀 id 与内部名。
- **DOM 结构（阅读）**：`div.callout > div.callout-title(.callout-icon + .callout-title-inner) + div.callout-content`；折叠态 `is-collapsible`（`data-callout-fold` 为 +/- 时）与 `is-collapsed`（callout 根与 fold 元素双挂）；标题默认派生 = `type.trim().replace(/-/g,' ').toLowerCase()` 首字母大写（app.js 实测，与规格 §3.2 的 `Custom-question` 口径一致）。
- **Live 路线（关键事实）**：Obsidian 1.14.4 自己的 Live 是**整块 block replace widget**（类名 `cm-callout` 挂在 widget 根上，widget 持整块源文），光标/选区触及区间时 widget 整体不发射、整块回源为 `HyperMD-quote` 行（app.css 无任何 `.HyperMD-callout` 行级类；app.js 装配代码 `b(G,K)||(… new s8 … block:!0)` 实证触及判定）。**即 Obsidian 自己也不满足"编辑正文时保留外框"——其编辑态只有引用行样式。我们的硬条件比上游实现更严格，必须独立验证（本报告 §5 即该验证）。**

## 4. 两端语法对拍：35/35 零分歧

夹具与方法入库 [syntax-parity.json](data/callout-t01/syntax-parity.json)：Live 侧 `markdownTreeParser`（生产增量树同一解析器），阅读侧 markdown-it 15.0.2（`createMarkdownRenderer` 同版同安全配置；blockquote/paragraph 块边界由 markdown-it 核心产生，vsidian 自定义 inline 规则不参与）。两侧各提取"引用容器清单（深度/行区间/直属首段首行）"喂同一识别器后按 (fromLine, depth) 规范序对拍。

候选识别器（拟 T02 落 `src/shared/calloutSyntax.ts`）：

- 输入：容器**直属首段首行**的"段起点→行尾"子串（两端解析器均已剥掉引用/列表前缀——对拍即验证此等价）；
- 形态：`/^\[!([^\]]*)\]([+-])?/` 上接三道拒绝——空类型、类型非单标识符 `[A-Za-z0-9_-]+`、声明后紧贴非空白；命中产出 `type`（小写规范化）、`fold`（+/-/无）、`title`。

对拍固定的边界样例（两端一致，T03 不得另写宽松规则）：

| 边界 | 结论 |
| --- | --- |
| 后续段落伪标记（`> [!note] t` 后隔空行再 `[!tip]`） | 不升级，仍是首个 callout 的正文 |
| 首段普通文字、后段才出现标记 | 整块不回溯成型，`[!x]` 按正文文字 |
| lazy continuation（无 `>` 前缀续行） | 归属同一引用容器（首段 lazy 行并入首段，不影响识别） |
| 未闭合围栏吞尾 | 围栏内到容器尾均字面，容器行区间两端一致 |
| 代码内伪标记 / 转义 `\[!note\]` / frontmatter 内 | 均不识别（转义后不匹配 `[!` 起点） |
| `>[!note]` 无空格、`>   [!note]` 多空格 | 均成型（前缀剥离在段起点前完成） |
| 空类型 `[!]`、含空格 `[!note extra]`、未闭合 `[!note t`、紧贴 `[!note]-t` | 全部未成型，按普通引用降级、不补写修复 |
| 嵌套（callout 内 callout / 引用内 callout / callout 内引用 / 列表内 callout） | 容器深度与行区间两侧逐项一致 |
| 大小写 / 未知自定义类型 | 大小写不敏感；未知类型照常成型（回落 note 外观、原标识进 `data-callout`） |

## 5. 可编辑容器三路线实测

### 5.1 路线 A（推荐）：行级类 + 标题行真实子树

实现形态（探针实证可行，生产化建议见 §9）：

- 容器每行挂 `callout` 行级类 + `data-callout` 属性（嵌套行内外层类同挂，属性由最内层胜出）；标题行加 `callout-title`、正文行加 `callout-content`、首末行加圆角类——外框底色/左边框/圆角由**逐行同规则**绘制（等价于容器边框的视觉连续性，与今日引用紫条同机制）。
- 标记 `[!type](fold)` 默认以行内 replace widget 隐藏并呈现真实 `.callout-fold`（含 `is-collapsed` 与 `data-callout-fold`）与 `.callout-icon` DOM；光标/选区触及标题行即显形源码（与生产 QuoteMark/hr 同语义，G1 双向验证）。
- 标题文字经 mark 装饰包真实 `.callout-title-inner` span（真实文本在场，IME/选区原生）。
- 复用生产 `liveDecorationsField` 的增量语法树（`state.field(liveDecorationsField).tree`），不建第二套解析。

### 5.2 路线 B（DOM 重挂载）：失败，不可用

绘制后把行元素移进真实 `div.callout > div.callout-content` 容器（G8 取证）：手术可执行（包到 6 组），但 **CM6 DOM 观察器在下一轮即回收重挂结构**（复检 `stillWrapped=false`，行回到 `.cm-content` 直接子级）；期间点击坐标映射未损坏（41→41）、键入正常——即"可挂但守不住"，无法提供稳定容器。结论：CM6 的 DocView 独占 `.cm-content` 子级所有权，重挂路线出局。

### 5.3 路线 C（整块 block widget）：失败，不可作可编辑容器

即 Obsidian 1.14.4 实测路线。探针以 StateField 发射整块 `block:true` replace（G9 取证）：widget 内 `.callout > .callout-title > .callout-title-inner` 与 `.callout > .callout-content` 严格容器选择器**可达**；但点击正文位置可把光标映射进被替换区间（from=41 落于区间内——不可见光标隐患），其后键入被吞（文档未变）——**正文不可编辑**。要可编辑必须触及即拆件回源（Obsidian 的做法），而整块回源即丢失外框，直接违反规格 §4.1 硬条件。附带架构事实：**block 装饰必须走 StateField**（ViewPlugin 通道声明即抛 `RangeError: Block decorations may not be specified via plugins`，探针首跑实证）。

### 5.4 T02 实施边界（本探针固定）

1. 类型变量表必须以 `:where()` 零特异性 CSS 规则承载，**行元素不得携带内联 `style` 变量**——内联会压死一切用户片段覆盖（探针首跑实证后改型）。
2. 嵌套行 `data-callout` 取最内层容器（升序处理、后写胜出）；跨层视觉（`.callout .callout` 型嵌套片段）在 Live 不承诺，见 §6.1。
3. callout 行需抑制同层引用紫条与引用底（探针以 `box-shadow:none` 预演；正式实现按规格 §4.1"callout 替代该引用层的紫条与引用背景"落 CSS，且内部普通引用仍显示自身样式）。
4. 标题标记显形谓词 = 光标/选区端点触及标题行（与生产 QuoteMark 同款"端点语义"）；选区跨越不显形属既定口径。

## 6. 样式入口验证

### 6.1 选择器矩阵（Live 行级形态 vs 阅读物）

| 选择器家族 | Live（路线 A） | 阅读（真实容器） |
| --- | --- | --- |
| `.callout` 类级 / `[data-callout="x"]` 属性级 | **可达**（逐行命中，`data-callout` 由行属性承载） | **可达** |
| `.callout .callout-title-inner` / `.callout .callout-icon` / `.callout .callout-fold` | **可达**（标题行自身携带 `callout` 类，子树为其后代） | **可达** |
| `.callout > .callout-title` | 不可达（title 是行自身类） | **可达** |
| `.callout > .callout-content` / `.callout .callout-content` | **不可达**（正文行间互无祖先关系——既知边界） | **可达** |
| `.callout .callout`（嵌套容器选择器） | 不可达（同上） | **可达** |
| `.markdown-source-view.mod-cm6 .callout`（Live 片段作用域） | **可达**（live 容器别名桥已挂三类） | — |
| `.markdown-preview-view .callout`（阅读片段作用域） | — | **可达**（阅读容器别名已挂） |

矩阵含义：容器**视觉属性**（底色/边框/内边距/圆角）以 `.callout` 类级规则逐行应用即得容器连续视觉；**严格父子容器选择器**只在阅读侧承诺。T06 的样式参考须按此矩阵写明适用入口（与规格 §7"不把计算色取样扩大成任意 CSS 布局兼容"同源）。

### 6.2 `--callout-color` 双形态接收（实测机理与方案）

CSS 机理实证（css-debug2.mjs）：`background-color: rgba(var(--c), .12); background-color: color-mix(...)` 的"双声明回退"**不成立**——后声明解析期合法、计算期因三元组代入失效时按 `invalid at computed-value time` 置 unset（透明），**不会回退前一声明**。

可行方案（G6 全绿）：拆属性双通道——`background-color: rgba(var(--callout-color), .12)` 吃 RGB 三元组，`background-image: linear-gradient(color-mix(...))` 吃标准色；两通道互斥生效（实测：内置标准色 → 渐变通道绘制、bgc 透明；片段三元组 → bgc `rgba(255,0,0,.12)`、渐变 none）。**非背景通道（标题色/边框色/图标色）无法同时接受两种形态**（CSS 无联合类型）：内置与消费面按标准色（与 Obsidian 1.13+ 一致），三元组片段在这些通道按 unset 降级（如边框退 currentColor）——这是规格 §8.1"同时接受"的实测边界，T06 须在样式参考写明；片段自带消费面（`rgba(var(--callout-color), .1)`）的场景则天然全兼容。

其余：`--callout-icon` 从行级 `:where` 规则经继承可读（`lucide-pencil`）、mask 渐变图标实测绘制；片段热更新（style 元素内容替换即改 computed 色，无需重建）实测可达；圆角首末行 6px/中间 0px 实测正确。

### 6.3 阅读侧选择器验证说明

G6 阅读矩阵以"T02 计划发射形态"的手工样例验证（`.markdown-preview-view` 作用域内严格容器选择器全命中）——阅读侧真实发射属 T02/T03 交付，此处验证的是选择器家族在规划 DOM 形态下的可达性，不冒充已实现。

## 7. 性能基线与候选数据

生产基线（`test/perf/runPerf.mjs`，本轮实测，无 callout）：

| 档 | 打开 | DOM 行元素（基线/键入后/滚动后） | 输入延迟 avg/max | 长任务 |
| --- | --- | --- | --- | --- |
| 1k 行 | 645ms | 59/59/59 | 33.7/50.1ms | 0 |
| 1万行 | 166ms | 59/59/59 | 33.1/33.6ms | 0 |
| 10万行 | 357ms | 59/59/59 | 49.8/50.7ms | 0 |

候选路线 A 探针数据（同机同浏览器；探针为每事务重扫视口树的简化形态）：

| 档 | init | DOM 行元素（顶/底） | 视口内 callout 数 | 键入均构建耗时 |
| --- | --- | --- | --- | --- |
| 1k | 47ms | 57/59 | 1 | 0.27ms |
| 1万 | 103ms | 82/59 | 1 | 1.9ms |
| 10万 | 1373ms | 82/59 | 1 | **21.7ms** |
| 1万无 callout | 70ms | 57/57 | 0 | ~0ms |

结论两条：

- **视口回收/DOM 有界性通过**：三档位顶部与滚动到底后行元素均 ≤ 82，与生产基线同量级；键入无重建风暴（5 键 6 次重建）。
- **红线（探针自我暴露）**：构建耗时随文档规模线性增长（10 万行 21.7ms/键）。根因定位：`@lezer/common` 的 `SyntaxNode.childAfter` 从 index 0 线性前扫（dist/index.cjs 源证），探针"每事务从 topNode 下降扫视口区间"对大文档是 O(doc)。**T02 不得采用该形态**：callout 装饰必须并入 `liveDecorationsField` 既有增量发射路径（Blockquote 分支所在窗口，生产该路径每键只重析变更附近，10 万行实测 ≈1ms），即"识别骑增量树、发射骑增量窗口"，而非独立视口插件重扫。此为本票给 T02 的最强实施约束。

## 8. 菜单取色方法：隐藏探针可行（G7）

方法定型：在菜单打开时创建 `visibility:hidden; position:absolute` 的探针元素，**保留正文样式上下文所需祖先**（`.markdown-preview-view` 类——Obsidian 片段的阅读作用域形态）与**文档样式身份**（`data-vsidian-doc-scope` 属性——docStyleLoader 产物的作用域钩），内放 `.callout[data-callout=<类型>]`，`getComputedStyle` 读 `--callout-color` 计算值。实测：

- 片段色可达（v1 读得 `255, 0, 0`）；文档样式身份作用可达（scoped 规则覆盖为 `12, 34, 56`，移除后回落片段值）；
- 布局隔离成立（探针挂/卸前后参照按钮 rect 逐字节不变）——正文布局不挂在菜单按钮上；
- 热更新路径同 §6.2（style 内容替换即改计算值），满足"打开菜单及主题/片段变化时更新"。

边界：该方法取得的是**颜色类计算值**；任意内容位置或复杂 `:has()` 选择器的完全复刻不承诺（与规格 §7 口径一致）。Live 侧作用域（`.markdown-source-view.mod-cm6`）同法可用（§6.1 已证片段命中）。

## 9. 供 T02/T03 消费的共享模型边界建议

按"纯逻辑下沉 shared、两端适配不复制"的既有架构：

| 模块（建议） | 职责 | 事实源边界 |
| --- | --- | --- |
| `src/shared/calloutSyntax.ts` | 识别器（§4 规格）+ 类型/别名注册表（数据取 obsidian-1144 JSON）+ 折叠符号解析 + 默认标题派生（含 `replace(/-/g,' ')` 首字母大写） | 解析单一事实源；别名归类与 CSS 变量映射**分开登记**（important = tip 别名 + 独立 `--callout-important`） |
| `src/shared/calloutPlan.ts`（或并入前者） | 源文转换规划：插入/切类型/无 Callout 的精确区间与一步原子编辑（T05 消费） | 不含路径/资源逻辑；多选区沿既有主选区口径 |
| Live 适配（`liveDecorations.ts` Blockquote 分支扩展） | 行级类/属性/标记 widget/标题 mark 发射，骑增量窗口 | 类名与别名桥经 obsidianAlias 表登记，不手写字面量 |
| Reading 适配（`readingBlocks.ts`/`readingMarkdown.ts`） | blockquote token → `.callout` 容器发射（AST 变换器形态，§3 阅读结构） | 与 Live 共用 calloutSyntax，不复制类型表 |
| 样式（main.css + styleContract） | `:where()` 类型变量表、双通道背景、`--callout-radius` 等容器变量、`limit-callout` 条目转支持 | 变量清单以 obsidian-1144 JSON + 开发者文档 Callout.md 为准 |

## 10. 未验证项（如实记录）

- **宿主真撤销栈**：浏览器缝无宿主，撤销以 `doc.changed external` 同构通道验证；真 WorkspaceEdit 撤销链路归 T02 集成用例。
- **真实物理 IME/鼠标观感**：CDP 组合与合成事件的时序与真机不同（multicursorIme 同款定位边界声明），归 manual-verification。
- **明暗主题真实观感**：探针在 `vscode-dark` 类下验证；亮色轮与 VSCode 真实主题变量下的观感归 T02/T06 契约测试与人工清单。
- **折叠状态机**（视图态、跨模式共享、光标迁移）：本票仅验证折叠符号解析与 `is-collapsible/is-collapsed` 形态可行，状态机归 T04。
- **悬停/嵌入/PDF 侧复用**：归 T08；本票未在这些场景装配探针。
- **Obsidian 线上版本漂移**：取证锚定 1.14.4 本机安装；上游后续变更不自动跟进，T06 落契约时以发行时点再核。
