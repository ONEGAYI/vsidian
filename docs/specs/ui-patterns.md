# UI 元素形态契约（ui-patterns）

> 状态：2026-10-12 建立（行为冲突管理组头验收缺陷修复的另一半任务）。本文档是**扩展自绘 UI 元素形态的单一事实源**：汇总各元素的统一形态（组标题、卡片圆角、浮层、按钮、徽章等）、给出新增 UI 的取值指引与接入清单。项目技能 [ui-patterns](../../.agents/skills/ui-patterns/SKILL.md) 是它的流程入口——新增或修改 UI 元素前必读并按其执行。
>
> **分工边界**：本文档管「元素长什么样、新 UI 怎么写才一致」；[styleContract.ts](../../src/shared/styleContract.ts)（公开样式契约清单）管「对外承诺的选择器/变量兼容」。浮层族多数类名与变量已入公开契约——本文档对其只做形态汇总并指针，不复制条目语义；两处冲突时公开契约优先。设置页类名为内部样式（不入公开契约），本文档是其唯一形态基准。

## 1. 设计基元（取值档位）

新增 UI 一律从本节档位取值；**不发明新档位**。确需新档位时先更新本表并在变更说明中给出理由。

### 1.1 色彩：主题变量优先，禁止硬编码

| 用途 | 变量族 |
| --- | --- |
| 正文/页面底 | `--vscode-editor-foreground` / `--vscode-editor-background` |
| 说明性文字 | `--vscode-descriptionForeground` |
| 分隔线、卡片描边 | `--vscode-panel-border` |
| 焦点与选中强调 | `--vscode-focusBorder` |
| 导航/列表 hover 与选中 | `--vscode-list-hoverBackground` / `list-activeSelection*` |
| 菜单浮层 | `--vscode-menu-*`（回落 `--vscode-editorWidget-*`） |
| 悬停提示 | `--vscode-editorHoverWidget-*` |
| 控件 | `--vscode-button-*` / `--vscode-dropdown-*` / `--vscode-input-*` |

- 设置页容器色差用内部基调变量：`--vsidian-settings-tint`（前景色）派生 `--vsidian-settings-container-bg`（前景 4% 叠加正文背景）与 `--vsidian-settings-container-border`（前景 10% 透明）——任意主题自适应，**整族切换只改这两条派生**。
- 明暗主题：默认值经变量或 `color-mix` 自适应，不写主题分支；生图图标资产按 `body.vscode-dark` / `vscode-high-contrast` 切换（§2.2）。

### 1.2 圆角谱系

| 档位 | 用途（现状即规范） |
| --- | --- |
| `999px` | pill：拨动开关、筛选签、键位捕获框、各类徽章 |
| `10px` | 设置页二级组卡片（`vsidian-settings-group`）、frontmatter Popover |
| `9px` | 侧栏导航条目 |
| `8px` | 搜索框（设置页/快捷键页）、callout、悬停弹窗、toast（变量化）、富文本粘贴对话框、设置页页内菜单 |
| `6px` | 按钮、键位牌、图标钮、悬停提示卡、双链联想浮层、附加组件面板 |
| `5px` | 右键菜单族（正文右键/大纲菜单/子菜单/快速操作标题菜单） |
| `4px` | 反链排序菜单、查找面板、tooltip 键位徽章 |
| `3px` | 定位高亮外框 |
| `2px` | select / text 输入控件（对齐 VSCode 原生控件观感） |

随形半径不属于档位：圆形与半高条（开关圆点 `50%`、大纲能量条 `1.5px` = 高/2 等按几何随形的半径）不视为新档位，无需登记。

### 1.3 浮层阴影谱系

| 层级 | 取值 |
| --- | --- |
| 菜单 / 联想 / tooltip | `0 2px 8px rgba(0,0,0,.25–.28)` 或 `var(--vscode-widget-shadow)` |
| 快速操作标题菜单 | `0 3px 10px var(--vscode-widget-shadow)` |
| 设置页页内菜单（快捷键「更多操作」） | `0 4px 14px rgba(0,0,0,.22)` |
| 悬停弹窗（hover-popup） | `0 6px 24px rgba(0,0,0,.22)` |
| frontmatter Popover | `0 6px 24px rgba(0,0,0,.18)`（同形异透明度，勿与上一行混用） |
| 富文本粘贴对话框 | `0 8px 32px rgba(0,0,0,.25)` |
| toast | 变量化：明 `0 4px 16px .12` / 暗 `.28`（`--vsidian-toast-shadow`，公开契约） |

### 1.4 z-index 谱系（浮层分层）

编辑器 webview 全局浮层自下而上：

`40` 查找面板 → `60` 引用编辑关闭确认遮罩（局部模态阻断）→ `8500` 阅读查找源反馈 → `9000` 轻提示（toast）与悬停弹窗（同层）→ `9500` 双链联想（编辑中瞬态，高于轻提示）→ `10000–10002` 模态（图片/图表弹窗、富文本粘贴对话框）→ `10500` 悬停提示（高于模态：模态内按钮的提示可呈现）。

挂局部容器的页内菜单不入全局谱（页内无跨层竞争，用局部小值）：设置页快捷键「更多操作」菜单 `6`，编辑器侧大纲菜单 `30`、反链排序菜单 `10`、快速操作标题菜单 `5`。新全局浮层按类型入层，不插新值。

### 1.5 间距与字号节奏

- 组卡片间 `20px`；卡片内边距 `2px 20px 8px`（组头自带 `12px 20px`）；设置行 `18px 0`、行间分隔线（tint 8%）。
- 页标题 24px/600；页副题 13px 说明色；组标题 13px/600；条目标题 14px/500；描述 13px 说明色、行高 1.65；小标签 12px（子组 11px）；徽章 11px。

### 1.6 焦点环

全局 `:focus-visible`：`outline: 2px solid var(--vscode-focusBorder)`、`offset 3px`。特例：悬停提示小卡片用 `1px`（可选中文字的紧凑卡，不抢内容）。新元素默认走全局规则，不自带焦点样式。

## 2. 设置页元素模式

设置页全部为内部类名（不入公开契约），CSS 单文件 `src/webview/settingsPage.css`，视觉刷新基线见 [settings-page-visual-refresh.md](settings-page-visual-refresh.md)。

### 2.1 页面骨架与侧栏

- 两列 grid：侧栏 `236px` + 主区 `minmax(0,1fr)`，**各自独立滚动**（视口锁高）；窄屏（≤约 700px）退化整页滚动（契约由 settingsPage 浏览器用例钉住）。
- 侧栏导航条目：`图标(20px) + 文字`，padding `11px 12px`、圆角 `9px`、透明边框；hover = list-hover；选中（`aria-current="page"`）= activeSelection 前景/背景 + `contrastActiveBorder`。
- 大组标签 12px/600、子组标签 11px 说明色、大组间分隔线（`hr` + panel-border）。
- **分页容器语言两型**：表单型分页（快捷键/外观/索引维护）内容整体住进一张 `vsidian-settings-section-content` 大卡片（圆角 10px、padding 16px 20px，组头可直接作卡片全幅头部——索引维护先例）；多组管理型分页声明 `SettingsPageSection.bare`（附加组件页先例，2026-10-12 验收反馈；输入行为管理页与组件设置页沿用，#465）——内容不套大卡片，组卡片直挂页面列表，**不允许组卡片嵌套进大卡片（卡中卡）**。新分页按内容形态选型并在此登记。
- **同页双态与跨分页导航**（#465 先例：组件设置分页）：一个分页内按宿主权威态整页切换两种视图（组件清单 hub ↔ 打开的组件详情），切换点是消息推送而非侧栏路由——侧栏导航项与 `h2` 页标题保持稳定，详情自带标题与「返回」类按钮回清单态；由分页自身 render 分流（不新增视图层机制）。跨分页导航经分页构造注入的回调（settingsMain 接 `view.selectSection`，微任务延迟——mount 内触发不嵌套重渲染）：源分页只发出「打开」类消息并导航，不在本页渲染目标内容（「附加组件」页对组件设置的渲染通道堵死，守护契约钉住——任何组件设置项不得在该页出现）。

### 2.2 二级组卡片与组标题（本轮契约核心）

标准结构（编辑器页各组、输入行为管理组均此形态）：

```text
div.vsidian-settings-group            ← 卡片：10px 圆角、1px 描边、色差底、padding 2px 20px 8px
├─ h3.vsidian-settings-group-title    ← 组头：负边距全幅（margin 0 -20px；padding 12px 20px）
│    ├─ 图标（16px：内联 svg 或生图 span）      + border-bottom 1px panel-border 通栏
│    └─ 标题文字（起点 44px = 20 padding + 16 图标 + 8 gap）
└─ 内容行（设置行 / 委托组内容 / 空态）
```

- **组头必须挂在卡片内**（负边距 + 通栏下边线由卡片承载）；标题游离卡片外即形态缺陷（#357 验收缺陷先例：行为管理组头 2026-10-12 修复）。
- 图标两形态同一 16px 槽：内联 svg（24 viewBox 单 path、`stroke: currentColor`、1.7 圆角线帽，注册表 `ICON_PATHS` + `SettingsGroupIcon` 类型，`settingsPageView.ts` 单表装配）；生图资产（`span.vsidian-settings-generated-icon[data-icon]` + CSS 背景明暗两套，走 [ai-icon-sheet-to-svg](../../.agents/skills/ai-icon-sheet-to-svg/SKILL.md) 生图管线）。新字形先登记注册表再使用，`aria-hidden` 纯装饰。现役内联字形表见 `settingsPageView.ts` 的 `ICON_PATHS` 注释（#466 起 `inputCursor`＝输入框 + I 型光标，输入行为管理页组头与侧栏导航共用；`sliders`＝三档滑杆组，组件设置页同槽；原 `merge` 分流合流字形随更名退役）。
- 几何钉住：settingsPage 浏览器用例（编辑器页五组）与 T08 用例（输入行为管理组）断言图标 16px、贴左缘 20px、文字 44px、负边距与下边线——**新组头沿用同一断言口径**。
- 组内提示文案（组说明句）作卡片内首行（`margin-top 10px`、说明色），不悬在卡片外。整页单卡片的管理型分页（如输入行为管理页）可把说明句升为分页副题（`vsidian-settings-subtitle`）而不在卡内重复——副题即页级说明位，不算悬空。
- #472 附加组件设置区分组沿用本节结构：组卡片直挂设置区（bare 分页同口径，组间 `20px` 档位），组标题不配图标（组件声明的组无语义字形——不发明）；组描述即上一条「组说明句」模式（`.vsidian-addons-group-description`，卡片内首行说明色）。首容器（功能开关行 + 未分组定义）无组标题恒置顶，组容器按声明序随后。

### 2.3 设置行与控件

- 设置行 `vsidian-settings-item`：`padding 18px 0`、行间分隔线、末行无线；label 两侧布局（文字 copy 左、控件右，gap 28px）；依赖灰化（opacity 0.55 + 控件禁用）由注册表 `dependsOn` 驱动。
- 控件：拨动开关 36×20 pill（`appearance:none` 纯 CSS，选中 focusBorder，120ms 过渡，保留 checkbox 语义）；select/text 圆角 2px（dropdown/input 变量族）；range 用 `accent-color` + 值文本 `tabular-nums`。**新控件类型先在本节登记形态再实现。**
- 多行文本（#475 附加组件设置区，内部类 `vsidian-addons-setting-item > textarea`）：圆角 2px + `--vscode-input-*` 变量族对齐 select/text 档位；`width 100%` / `min-height 72px`（rows=4 语义兜底）/ `resize: vertical` 可拖高；占定义行整行（label 行下方），不进右槽。

### 2.4 按钮、徽章与状态

- 次级按钮（`button-border` + `button-secondary*` 变量族、圆角 6px）：高度三档——工具栏 32px / 操作行 26px（附加组件页）/ 行内微钮 22px（调序按钮）；主按钮用 `--vscode-button-background/foreground`、透明边框（附加组件页市场入口先例）。
- 筛选签：pill 999px、`aria-pressed` 单选，选中态 activeSelection 同导航条目。
- 徽章：pill、11px；警示徽章用 `statusBarItem-error*`（侧栏故障）；行内状态徽章 panel-border 描边 + 说明色。
- 空态：说明色、`padding 24px 0`；状态行（保存反馈）12px 说明色、`role=status`。
- callout：圆角 8px + 左强调条 3px（focusBorder）+ `inputValidation-infoBackground`，承载说明性长文案。
- 外观页「预设主题」沿用现有 pill 页签；「代码块渲染」组头与标准设置行直接放入页签面板，外观页的大卡片承载组头负边距，不再套一层组卡片。Mermaid 的 Codex 图表配色与 16px 节点圆角属于用户选择的图内容预设，不用于设置控件或其他界面元素。
- 定位高亮（搜索/路由跳转落点）：`outline 1px focusBorder + offset 8px`、圆角 3px，类名 `vsidian-settings-item-located`。档位语义是**一次性导航反馈**：显式定位时呈现，约 1.5s 后退场，退场后不重现；定位落点唯一——容器级与条目级描边互斥，定位到具体条目只标条目行，列表级定位才描容器本身。当前落地范围是**附加组件页的列表级与条目级两处**（#462 先例）：条目级高亮经定位态跨推送重渲染保持（时限内不延长寿命）；列表级容器描边仅在定位渲染当次呈现（推送重建即消）；同分页 manage 入口、输入行为管理页 behaviors 入口与其他分页的定位高亮维持既有语义（常驻至下次重渲染），迁移到本档位语义另行落档。

### 2.5 积木式查询构造器（输入行为管理页搜索区，#474）

搜索区不直接输文本，以三类积木可视化组合表达查询（ADR-0015）。结构：

```text
div.vsidian-behavior-query                        ← 查询区（组卡片内，列表上方）
├─ 顶层积木流（flex-wrap；顶层并列 = 隐式 AND）
│   ├─ 字段积木 .vsidian-bq-block--field          ← pill 999px 外壳：字段标签 + text 输入（2px 档）
│   ├─ 逻辑积木 .vsidian-bq-block--logic[data-bq-op] ← 菱形（clip-path 随形，不入圆角档位）；AND/OR 双缺口、NOT 单缺口
│   │    └─ 缺口槽 .vsidian-bq-slot               ← 空槽 = 虚线占位框（拖放/键盘目标）；可嵌任意积木
│   └─ 状态积木 .vsidian-bq-block--status         ← 6px 矩形（按钮档）：标签 + select（2px 档，四态）
├─ span.vsidian-behavior-query-add-wrap > button  ← 加号微钮（22px 档）+ 非禁用包裹（tooltip 载体）；展开三组下拉（页内菜单形态）
└─ button.vsidian-behavior-query-trash            ← 垃圾桶微钮（22px 档，data-tooltip 三用法说明）
```

- **积木三形态**：字段 pill 999px（筛选签同档）内嵌 2px 输入；状态 6px 矩形内嵌 2px select；逻辑菱形带缺口为 clip-path 随形（同 §1.2 随形注记不占圆角档位），缺口槽是虚线框 drop target。积木外壳配色 = 容器基调族（`--vsidian-settings-container-*`）；逻辑积木以 focusBorder 16% 派生底色区分族感（clip-path 裁边框，不用于描边）。
- **发光选中态**：`.vsidian-bq-selected` 整体（含嵌套）`box-shadow: 0 0 0 2px var(--vscode-focusBorder), 0 0 10px color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent)`——明示删除范围（单击/拖到垃圾桶、Delete 删除的是发光整体）。
- **键盘构建两态高亮**：拾取中（Enter 后浅色）= `outline 1px dashed focusBorder`；目标缺口（方向键移动，深色）= `background: color-mix(in srgb, var(--vscode-focusBorder) 25%, transparent)`。Enter 拾取 → 方向键选缺口 → Enter 放下；Esc 取消；Delete 删选中。
- **翻页控件**（行为列表底部）：`<< < 第 x / y 页 > >>` 五件套——四枚行内微钮（22px 档、次级按钮变量族，到头/到底禁用发灰）+ 指示文本 12px 说明色；总页数 ≤ 1 不渲染。
- **上限提示**：积木总数 > 16 时加号禁用（微钮禁用态）+ data-tooltip 说明（D9）。

## 3. 浮层元素模式（编辑器 webview 为主，多数已入公开契约）

| 模式 | 形态要点 | 事实源与契约指针 |
| --- | --- | --- |
| 菜单族（正文右键/大纲菜单/排序菜单/快速操作标题菜单） | `menu` 变量族、圆角 4–5px、padding 3–4px、阴影 §1.3；真实 button 逐项、键盘可达 | [context-menu.md](context-menu.md)、[tooltip.md](tooltip.md)；公开契约 menu/chrome 类目 |
| 悬停提示（tooltip） | 两 webview 共享 `tooltipCard.css`；`--vsidian-tooltip-*` 公开变量（radius 6px、出现延迟等）；悬停词唯一承载 `data-tooltip` | [tooltip.md](tooltip.md)；styleContract tooltip 类目 |
| 双链联想浮层 | 圆角 6px、widget-shadow、widget 变量族、z-index 9500（编辑中瞬态层） | [wikilink-completion.md](wikilink-completion.md) |
| frontmatter Popover | 圆角 10px、阴影 §1.3（.18 透明度档）、z-index 9000 | [frontmatter-table.md](frontmatter-table.md)；公开契约 frontmatter 类目 |
| 富文本粘贴对话框 | 模态对话框、圆角 8px、editorWidget 变量族、z-index 10000 | [rich-text-paste.md](rich-text-paste.md) |
| 设置页页内菜单（快捷键「更多操作」） | 局部绝对定位、圆角 8px、阴影 §1.3、z-index 6（页内局部小值） | `settingsPage.css` 快捷键菜单段 |
| 查找面板 | 绝对定位右上、圆角 4px、widget 变量族、z-index 40 | `main.css` 查找面板段；chromeContract 探针与 `findPanel` 浏览器用例 |
| 悬停弹窗（hover-popup） | 480px 宽、圆角 8px、阴影 §1.3、z-index 9000 | [hover-preview-embed.md](hover-preview-embed.md) |
| 模态（图片/图表弹窗） | 全屏 overlay z-10000 + 背板 `blur(16px) saturate(150%)` 55% 黑 | [image-popup.md](image-popup.md)、[graphic-code-block-interaction.md](graphic-code-block-interaction.md) |
| toast（轻提示） | `--vsidian-toast-*` 公开变量（radius 8px、明暗两套阴影）。#474 形态演进（两 webview 通用）：气泡顶部倒计时条（深色右端锚定向左收缩、悬停/聚焦暂停）+ 气泡内撤销按钮（次级按钮 6px 档）；pointer-events 仅对带撤销按钮的气泡放开（` :has(action)` 限定，无按钮气泡保持穿透） | toast.css 头注；styleContract toast 类目 |

新增浮层：先查上表归型；同型复用变量族与档位，新形态先登记本表。

## 4. 新增 UI 三步接入清单

1. **定形态**：对照 §1 基元与 §2/§3 模式选定档位与结构；没有合型的新元素，先在本文档登记（模式表加行/小节补写）再实现——评审拦「未登记的新形态」。
2. **实现**：主题变量优先（禁硬编码色值）；用户可见文字一律 i18n（`t()`，双语 parity）；图标走注册表/生图管线；明暗两主题可随变量自适应。
3. **钉住**：呈现类变更至少一条断言落绘制层（可见性/几何/计算色/墨迹，非 DOM 存在性）；关键 CSS 规则由契约测试钉住；涉及公开契约条目时走 [style-contract 技能](../../.agents/skills/style-contract/SKILL.md)流程；CHANGELOG 登记用户可见变化。

## 5. 已知不一致（统一候选——未经拍板不擅改）

以下为**现状如实记录**的档位偏离；统一属用户可见变更，需单独立项拍板后同时改本目录与实现：

- 菜单族圆角三档并存：右键/大纲/子菜单/快速操作标题菜单 5px、反链排序菜单 4px、tooltip 与联想浮层 6px——「菜单」意象未收敛到单档。
- 输入控件两档：搜索框 8px（卡片感）vs select/text 2px（VSCode 原生控件向）——语义上有别，是否统一待定。
- 附加组件页「官方组件 / 第三方组件」列表组头仍是旧形态（标题悬卡片外、无图标，`addonSettingsSection.ts` 状态列表渲染处）——与 §2.2 标准形态不符，2026-10-12 已报，待修复与图标拍板（bare 装配后其组卡片已直挂页面层，剩组头形态待整改）。bare 过渡态事实：该 h3 与组件自定义设置页挂载区 h4（`renderAddonPageMount`）仍带组标题类负边距，bare 容器无横向 padding 吸收，分隔线两侧各外溢约 20px（落在主区 padding 内，无裁剪）——两者一并归入该整改票，不做临时覆写（会把标题文字移离列缘，预支待拍板的形态决策）。
- 附加组件基础设置区存在失效 `gap` 死规则（`settingsPage.css` 的 `.vsidian-addons-settings .vsidian-settings-group { gap: 8px }` 作用于 block 容器不生效）——待上一条组头整改时一并处理，行距随该区按 §2.2 标准结构归型。

## 6. 维护纪律

- 本文档是 UI 元素形态的**单一事实源**；CSS 实现与本文档不一致时，以「CSS 实现 + 契约测试」为准，随即修正本文档——不许只改文档不改实现，也不许改实现不更新文档。
- 修改既有元素的取值即修改规范：同步 §1 档位表与对应模式小节、同步/新增绘制层断言、涉及公开契约走 style-contract 技能、用户可见变化进 CHANGELOG。
- 新增元素先登记后实现；删除/退役元素时从本文档移除并注明去向（公开契约条目的弃用另走 style-contract 弃用流程，不受本条管辖）。
