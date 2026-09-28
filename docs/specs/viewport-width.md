# 视窗宽度（正文列宽）设置 与 阅读隐形限宽修复 —— 共识草案

> 状态：**共识定稿（待开票确认）**，2026-09-28。工作树 `impl/2026-09-viewport-width`。
> 本文档是 bug 诊断与功能设计的共识落点：两轮访谈结论均已回写（见「已定共识」），第五节为票面草稿，经用户确认后建票并转实施规格。
> 定名已定：**可读行宽**（第一轮 Q1，用户原语「视窗宽度」不再用于正式文案）。

## 一、Bug 诊断（已复现，根因已证实）

**用户报告**：阅读模式下宽度有隐形限制。

**诊断回路**（diagnosing-bugs Phase 1/2，可复跑）：

```
node test/browser/readingWidthProbe.mjs   # 工作树内，真实 Chromium + 生产控制器 + 产物 CSS
```

1280×800 视口实测（2026-09-28，4 断言红）：

| 观测 | Live（对照） | 阅读（侧栏收起） | 阅读（侧栏展开） |
| --- | --- | --- | --- |
| 正文实际宽度 | 1186px（铺满） | **760px**（右缝 472px 空白） | **760px**（不避让） |
| 水平位置 | 行号列后 | **贴左**（左缝 0） | 贴左（不居中） |

**根因**（直接证实）：`src/webview/main.css` 阅读层

```css
--vsidian-reading-max-width: var(--file-line-width, 760px);
.vsidian-reading-block { max-width: var(--vsidian-reading-max-width); margin: 0 0 0.75em; }
```

`--file-line-width` 全源码无代码注入（纯 Obsidian 别名兜底），产品内**无任何设置入口**——用户不写 CSS 片段则恒为 760px 且块级居左。回路中以 `--file-line-width: 900px` 覆盖后块宽立即变 900，钳制来源即此变量。

**假设清单与裁决**：

| 假设 | 预测 | 裁决 |
| --- | --- | --- |
| H1 阅读块 `max-width` 变量兜底 760px | 覆盖变量后宽度跟随 | **证实**（900px 实验） |
| H2 主区容器（vsidian-main）钳制 | 容器 1280/1000 而块 760 | 排除 |
| H3 虚拟化挂载层约束块宽 | 屏内块直接测量仍 760 | 排除 |
| H4 近期回归 | main.css 注释表明 #6/#8/#32 有意保留 | 排除（非回归，是设计缺口） |

**定性**：不是代码行为异常，是**有意的旧设计默认值不可见、不可配**，且与 Live（铺满）不一致。修复方向即本草案第二节的功能（默认档语义见 Q2）。

## 二、功能共识（待访谈定稿）

**目标**：设置页新增**可读行宽**设置项（滑块，0 = 铺满），**对 Live 与阅读两模式同时生效**；内容宽 = min(设定宽, 主区可用宽)（自动避让右侧栏，无额外下限）；内容列在主区（侧栏左缘以左的整个区域，即「左中」）内水平居中，侧栏展开/收起动画期间实时跟随（纯 CSS 可达，回路 A3′ 届时转绿）。两模式各有独立限宽变量，滑块同时驱动，CSS 片段可分别覆盖。

### 已定共识（第一轮 + 中途补充，2026-09-28）

- **定名（Q1）**：「可读行宽」。用户原语「视窗宽度」不进正式文案与设置键；CONTEXT.md 立词条。
- **默认档（Q2）**：默认**铺满**——bug 以「默认无限宽」修复，Live 观感不变、阅读变宽，两模式默认一致。
- **滑块形态（Q3 + 补充）**：单滑块，范围 **0–1600px、步进 20**；**0 = 铺满**（左端档，控件显示「铺满」文本而非 0px），默认 0。设置项落「编辑器」分组，键形如 `editor.readableLineWidth`（实施期定稿）。
- **避让与居中（Q4）**：内容宽 = min(设定宽, 主区可用宽)，无额外下限；内容列在主区（侧栏左缘以左的整个「左中」区域）内水平居中，侧栏展开/收起动画期间实时跟随（纯 CSS，回路 A3′ 届时转绿）。
- **行号列（Q5）**：行号列贴正文列左缘、随列一起居中（Obsidian 行为）；#32「行号列+间距+正文总宽=无行号正文宽」契约在限宽态修订表述并联动契约测试。
- **宽块内容（Q6）**：表格、代码块卡片、frontmatter 卡片、Mermaid 一并钳制进正文列（Obsidian 同款）；表格自身列宽逻辑在列内不变。
- **变量落点（Q7，用户方案）**：**双变量**——`--vsidian-reading-max-width`（既有，阅读侧）+ 新增 `--vsidian-live-preview-max-width`（Live 侧）。滑块一份值**同时写两变量**；CSS 片段可分别单独覆盖任一模式实现差异化。设置优先：非 0 档内联落值，片段覆盖需 `!important`。
- **铺满档机制（Q8，用户定 0 = 铺满；机制随第二轮一并确认）**：0 档产品**不写内联变量**（对齐 Obsidian「关限宽即零干预」：CSS 缺省为不限宽，片段常规规则即可定制两模式）；非 0 档写内联两变量。两基础变量缺省值由 760px / 无 → **`none`**（铺满）。
- **Obsidian 别名扩展（Q9，用户同意）**：`--file-line-width` 接进**两变量**兜底链——`--vsidian-reading-max-width: var(--file-line-width, none)` 与 `--vsidian-live-preview-max-width: var(--file-line-width, none)`；别名桥 `obsidianAlias.ts` 同源表为 live 变量加行（fallback `none`）。片段设一个 Obsidian 名同管两模式（Obsidian 心智），差异化改用 vsidian 双名。

### 非目标

- 原生源码编辑器（VSCode 自身行为，不属本扩展作用域）。
- 独立设置页自身的 850px 版心（另有视觉规格）。
- 大纲侧栏宽度（已有拖宽句柄，`--vsidian-sidebar-width` 独立变量）。

## 三、现状事实（已核实，实施据此展开）

- **布局骨架**：`#app > .vsidian-body`（水平 flex）= `.vsidian-main`（主编辑区，flex:1）+ `.vsidian-sidebar`（右侧大纲栏，默认 280px；显隐唯一开关为 body 的 `vsidian-sidebar-open` 类，宽度 0.15s 过渡）。顶栏在 `.vsidian-main` 内顶部。
- **Live 现状**：`EditorView.lineWrapping` 开启；`.cm-scroller` 仅 24px 基线留白（`--vsidian-content-padding-inline`），无限宽。行号开启时正文左缘 = 24 + 行号列（实测 1280 视口下正文行 left=70、宽 1186）。
- **阅读现状**：容器同样 24px 基线留白；块被 760px 钳制居左（见第一节）。
- **设置链路**：schema 仅 boolean / string 枚举两类（`SettingDefinition`，src/shared/settings.ts），**number 型预留未实现**——滑块项需扩展 schema（min/max/step/单位显示）+ 设置页新增 range 控件（现只有开关与下拉）。设置经 `settings.snapshot`（init 后拉取）/ `settings.changed`（变更广播）推送编辑器 webview，即时生效机制现成。分组规则：`general.*` 归常规组，其余归编辑器组。
- **样式契约**：`--vsidian-reading-max-width` 为公开契约条目（`src/shared/styleContract.ts` var-reading-max-width，Obsidian 别名 `--file-line-width` direct 级；`src/shared/obsidianAlias.ts:82` 同源登记，fallback 760px）。**本变更触及 CSS 变量与呈现，实施前须走 style-contract 技能流程**（固定旧契约 → 保留兼容 → 期限校验）。
- **i18n**：新设置项标题/描述/「铺满」档文案须进 `src/shared/locales/` 双语包；滑块控件 aria 文案同理。

## 四、实施注意点（规格期展开，先记录风险）

1. **CM6 列宽居中 + 行号列跟随**：`.cm-content` 限宽居中易，行号列（`.cm-gutters`，scroller 内粘性定位）随内容一起居中需原型验证可行做法；Obsidian 有先例可考。
2. **阅读虚拟化重排**：宽度变化改变折行高度 → 块高度表须重算（侧栏拖宽今天已触发同类重排，设置变更同一事件类）；须有测试覆盖设置变更后阅读视口正确性。
3. **宽块行为**：表格（自身列宽采样逻辑）、代码卡（内部横向滚动）、frontmatter 卡片（行级 grid 不限宽硬约束——见 AGENTS.md 落档，注意别冲突）在钳制列内的表现需逐项验证。
4. **查找面板/图表弹窗/Popover 等浮层**：不随列钳制，按容器全宽定位（待规格确认）。
5. **#32 行号契约修订**：限宽态下「行号列+间距+正文总宽」的表述与契约测试联动更新。
6. **回归测试**：本探针（readingWidthProbe）改造为正式浏览器套件并入 run.mjs names；断言覆盖双模式宽度一致、居中、侧栏避让、设置值生效。

## 五、票面草稿（待用户确认后建票）

### Bug 票

标题：`bug: 阅读模式正文被 760px 隐形限宽，不可配置且不居中`

```markdown
## 现象

阅读模式正文宽度被钳制在 760px：宽窗口下右侧留大片空白，且正文贴左不居中；
产品内无任何设置入口可调（仅 CSS 片段可覆盖）。Live 模式正文铺满可用宽度，
两模式观感不一致。

## 诊断（已复现，根因已证实）

- 根因：`src/webview/main.css` 阅读层
  `--vsidian-reading-max-width: var(--file-line-width, 760px)`；
  `--file-line-width` 全源码无代码注入，不写 CSS 片段则恒为兜底值；
  `.vsidian-reading-block` 挂该 max-width 且块级居左（margin: 0 0 0.75em）。
- 诊断回路（可复跑，真实 Chromium + 生产控制器）：
  `node test/browser/readingWidthProbe.mjs`（分支 impl/2026-09-viewport-width）。
  1280×800 实测：Live 正文行 1186px 铺满；阅读块 760px、右缝 472px 空白；
  侧栏展开仍 760px 不避让不居中；设 `--file-line-width: 900px` 后块宽立即
  变 900（根因直接证实）。
- 定性：非回归——#6/#8/#32 有意保留的设计默认值不可见、不可配，且与 Live
  行为不一致。

## 修复方向

默认铺满 + 主区居中，由「可读行宽」设置项默认档（0 = 铺满）落地；与功能票
同分支实施，本票随功能票合并关闭。完整共识见
docs/specs/viewport-width.md（分支 impl/2026-09-viewport-width）。

## 验收

- 默认（未改设置）：阅读正文铺满主区可用宽度，与 Live 一致。
- 侧栏展开/收起：正文实时避让并在主区居中。
- 诊断回路断言 A1/A2/A3/A3′ 转绿（转正式回归套件随功能票交付）。
```

### 功能票

标题：`feat: 设置页「可读行宽」——滑块限宽（0=铺满）、双模式生效、避让右侧栏与动态居中`

```markdown
## 需求（共识已定稿：docs/specs/viewport-width.md，分支 impl/2026-09-viewport-width）

设置页新增「可读行宽」设置项：

- **滑块**：0–1600px、步进 20；**0 = 铺满**（控件显示「铺满」而非 0px），
  默认 0；落「编辑器」分组（键形如 editor.readableLineWidth，实施期定稿）。
- **双模式**：Live 与阅读同时生效。双变量：`--vsidian-reading-max-width`
  （既有）+ 新增 `--vsidian-live-preview-max-width`；滑块一份值同写两变量；
  Obsidian 别名 `--file-line-width` 接进两变量兜底链（缺省 `none`）；
  CSS 片段可分别单独覆盖任一模式。
- **优先序**：0 档产品不写内联变量（片段常规规则即可定制）；非 0 档内联
  落值、设置优先（片段覆盖需 `!important`）。
- **避让与居中**：内容宽 = min(设定宽, 主区可用宽)，无额外下限；内容列在
  主区水平居中，侧栏展开/收起动画期间实时跟随。
- **行号列**：贴正文列左缘、随列一起居中；#32「行号列+间距+正文总宽=无行号
  正文宽」契约在限宽态修订表述并联动契约测试。
- **宽块同钳制**：表格、代码块卡片、frontmatter 卡片、Mermaid 一并钳制
  进正文列（表格自身列宽逻辑在列内不变）。
- **非目标**：原生源码模式、独立设置页自身版心、大纲侧栏宽度。

## 实施要点（风险）

1. 设置 schema 扩展 number 型（min/max/step/铺满特殊档，现为 boolean/string
   两类）+ 设置页新增 range 控件（现只有开关与下拉）+ 双语文案 + aria。
2. CM6 行号列随内容居中的实现方式需原型验证（.cm-content 限宽居中 +
   gutters 跟随，Obsidian 有先例）。
3. 阅读虚拟化：宽度变化改变折行高度 → 块高度表重算（侧栏拖宽同类事件），
   须有测试覆盖设置变更后阅读视口正确性。
4. 样式契约：新增公开条目 + 缺省值变更（760px → none），实施前走
   style-contract 技能流程（固定旧契约、兼容保留、期限校验）；别名桥
   obsidianAlias.ts 同步加行。
5. 浮层（查找面板、图表弹窗、Popover）不随列钳制，按容器全宽定位。
6. 回归：readingWidthProbe 转正式浏览器套件并入 run.mjs；断言双模式宽度
   一致、居中、侧栏避让、设置值与片段覆盖的生效次序。

## 验收

- 滑块各档双模式生效；0 档铺满且 CSS 片段常规规则可定制；非 0 档设置优先。
- 侧栏开合实时避让居中；行号列跟随；宽块同钳制。
- 设置持久化、重开回显、变更即时生效；长文档阅读重排正确。
```

### 建票操作

- `gh issue create --title <上> --body-file <正文文件>`（docs/agents/issue-tracker.md 约定，中文标题正文）。
- 两票正文互引（bug 票指向功能票修复方向；建票后补功能票编号回填）。
- 标签暂不加（现有专用标签 code-block-card / ready-for-agent 均不适用；如需主题标签由用户定）。
