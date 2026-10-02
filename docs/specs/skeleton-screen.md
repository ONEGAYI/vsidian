# 编辑器初开骨架屏（加载占位）—— 共识定稿

> 状态：**共识定稿（待开票确认）**，2026-10-02。
> 本文档是「文档载好前显示骨架屏」设计访谈（grill 审讯，九题）的共识落点：第二节为决策记录，第七节为票面草稿，经用户确认后建票。
> 定名已定：**骨架屏**（CONTEXT.md 已立词条）。

## 一、问题与目标

**问题**：编辑器初次打开时，正文呈现前有两段空窗，用户看到的是纯空白：

1. **空窗①（脚本加载期）**：webview HTML 就绪到 `out/webview/main.js` 执行前——`#app` 为空，整页空白。
2. **空窗②（正文就绪期）**：main.js 挂载编辑器完成到 init 全文落地、正文首帧绘制前——工具栏等界面件已现，正文区空白，观感形似「空文档」；大文档因全文同步与首帧绘制耗时更长，空窗更明显。

**目标**：空窗期显示骨架屏——通用灰块占位叠加扫光动画，宽度受可读行宽变量约束，正文就绪后按周期收束规则退场，消除「空白 / 空文档」观感。

## 二、共识决策记录（2026-10-02 审讯九题）

| 决策点 | 裁定 |
| --- | --- |
| 触发范围 | 仅编辑器初次打开（含 Hot Exit 恢复与标签重开）；悬停预览、文档嵌入沿用既有占位体系；设置页不包含 |
| 骨架形态 | 通用固定形态，不读文档内容；不模拟行号列 |
| 动效 | 扫光动画 + 启动延时 + 周期收束退出（细则见第三节） |
| 宽度口径 | 引用 Live 侧限宽变量（同源机制），不做模式感知切换；0 = 铺满档下骨架同样铺满 |
| 超时兜底 | 不引入——骨架常驻等价于现状空白，不劣化 |
| 设置项 | 不提供开关 |
| 开票粒度 | 单票承接（规格、实现、测试同票） |
| 存活边界 | 覆盖空窗①+②：骨架保留到正文首帧，期间与真实工具栏共存，仅占内容区 |

## 三、行为规格

### 触发与存活

- 骨架标记内联在 provider 生成的初始 HTML 中（`#app` 内），随 HTML 解析即呈现（覆盖空窗①）；样式与标记同源内联，不依赖外链 `main.css` 到达。
- main.js 挂载编辑器时**不移除**骨架，将其收编进内容区（Live 内容子树），与真实工具栏共存（覆盖空窗②）；阅读容器维持既有 `display:none`。
- 撤除信号 = init 全文落地后的正文首帧（实现可用 rAF 或 CM6 update 侦听，实施票定稿）。

### 动效：扫光 + 启动延时 + 周期收束

记 T0 = 骨架呈现时刻、D = 启动延时、C = 扫光周期、Tr = 正文就绪时刻：

- 骨架先以静态灰块呈现；T0 + D 后开始扫光，循环播放。
- **退出规则**：
  - Tr < T0 + D（动画未开始）：Tr 即撤，全程无动画——瞬间载好的文档不见扫光。
  - 动画已开始：撤除时刻 = T0 + D + ⌈(Tr − (T0 + D)) ÷ C⌉ × C，即**等当前周期播完才撤**（例：1.5 周期载完，第 2 周期末退出）。
- **数值常量**（默认值，落共享常量，实施期可调）：D = 300ms、C = 1.5s。约束：D 须短于大文档载入耗时（大文件必须能看到扫光），定稿前对照 docs/perf 实测档位复核。
- `prefers-reduced-motion: reduce` 下不播扫光（等价「动画未开始」），就绪即撤。

### 宽度口径

- 骨架容器 `max-width` 引用 `--vsidian-live-preview-max-width`（#app 层同写机制，见 [viewport-width.md](viewport-width.md) 实施落档），**不复制读值、不提前读设置**——设置内联值、铺满态（0 档移除内联回退 `none`）的变化自动传导到骨架。
- 不做模式感知切换：双变量缺省同源，仅视图作用域 CSS 片段会产生差异，不为该窄场景在骨架期引入切换；阅读恢复场景下骨架短暂按 Live 口径呈现。
- 骨架不模拟行号列。

### 边界与明确不包含

- 不引入载入超时兜底；不加设置开关。
- 悬停预览、文档嵌入、反链/出链面板的既有占位机制不在本批；若要升级为骨架风格，另行开票。
- 独立设置页 provider 不包含。
- 无面向用户的文字，i18n 不涉及。

## 四、现状事实（实施依据）

- HTML 为 provider 内联模板（`src/host/textEditorProvider.ts` buildWebviewHtml）：`<div id="app">` + locale 数据岛 + nonce 内联脚本 + 外链 `main.js` / `main.css`；CSP 由 `src/host/editorCsp.ts` 构建。
- 握手时序：webview 挂载空 CM6 → postMessage `ready` → 宿主 sendInit（全文）→ webview `handleFullSync` 落地（`src/webview/syncController.ts`）。
- 模式恢复：per-document 模式在构造期自 `vscode.getState` 恢复（早于正文到达）；宿主记忆缺省 live。
- 内容区层级：`#app > .vsidian-body > .vsidian-main >（liveWrapper 内 .cm-editor…）+ readingContainer(初始 hidden)`。
- 仓库无既有骨架/加载占位实现；embed-slot 行内占位、面板 loading/empty/error 四态为域内其他语义，不混用。

## 五、实施注意点（风险）

1. **CSP 与内联样式**：骨架样式必须随 HTML 即时生效（外链 CSS 未到达的空窗①也要有骨架）——实施前核实 `editorCsp.ts` 的 style-src 政策（nonce 或放行内联）；不允许则调整 CSP 装配，该改动触及样式入口，走 style-contract 流程。**PR #37 教训**：CSP 拦截样式时 DOM 存在性断言照样全绿，骨架断言必须落在绘制层。
2. **骨架收编**：挂载期骨架从 `#app` 顶层移入内容子树的 DOM 归宿与定位方式需定型——不遮工具栏、不干扰 CM6 布局测量。
3. **撤除时刻计算**提为共享纯函数（输入 T0 / D / C / Tr 与 reduced-motion 位），单测覆盖「动画未开始 / 周期中 / 恰在周期边界 / reduced-motion」矩阵。
4. **骨架期宽度回跳**（可选优化）：限宽档用户的设置内联在挂载后才落 `#app`，骨架先铺满后收窄会回跳一次；可经初始 HTML 数据岛预注入 `editor.readableLineWidth` 初值消除，实施票定。
5. **样式契约**：新增骨架类名、扫光 keyframes 与颜色 token 须登记 `src/shared/styleContract.ts`（含英文条目，`npm run gen:styleguide`），实施前走 style-contract 技能流程；颜色取主题变量派生（明暗自适应），不硬编码色值。
6. **既有套件回归**：骨架出现在启动期，现有浏览器/集成套件对「挂载后初始 DOM」的断言（如正文为空、特定结构在场）可能受影响，回归时逐套核对。

## 六、测试与验收

- **视觉层断言（评审必查）**：至少一条集成断言落在绘制层——骨架灰块可见、列宽与变量一致、撤除后正文可见；不满足于 DOM 存在性（AGENTS.md 视觉层断言约定）。
- **单测**：撤除时刻计算矩阵（共享纯函数）。
- **集成**：ready→init 时序断言——骨架在场、init 落地后按规则移除（`_test.*` 钩子门控）；宽度断言覆盖限宽档与铺满档。
- **浏览器套件**：真实 Chromium 下断言骨架可见性与宽度受变量控制（变更限宽值后骨架列宽跟随）——新探针或并入现有套件，实施票定。先例参照 `readingWidthProbe`。
- 骨架不涉输入/IME 路径，浏览器套件无新增键盘驱动需求；撤除时序若需跨帧观测，以套件实测为准。

## 七、票面草稿（已建票）

建票记录（2026-10-02）：

- 功能票 **[#292](https://github.com/ONEGAYI/vsidian/issues/292)**：`feat: 编辑器初次打开的骨架屏——灰块+扫光加载占位、受可读行宽约束、周期收束退场`（已加 `ready-for-agent` 标签）。
- 票面正文与下文草稿一致；实施在独立工作树 `impl/2026-10-skeleton-screen` 进行。

标题：`feat: 编辑器初次打开的骨架屏——灰块+扫光加载占位、受可读行宽约束、周期收束退场`

```markdown
## 需求（共识已定稿：docs/specs/skeleton-screen.md）

编辑器初次打开（含 Hot Exit 恢复）时，正文呈现前的空窗显示骨架屏：

- **形态**：通用固定灰块序列（不读文档内容、不模拟行号列），随初始 HTML 即时
  呈现，挂载后收编进内容区与工具栏共存，覆盖「脚本加载」与「正文就绪」两段空窗。
- **动效**：静态灰块经启动延时（默认 300ms）后叠加扫光（周期默认 1.5s）；瞬间
  载好不见动画；动画已开始则等当前周期播完才撤（1.5 周期载完 → 第 2 周期末退出）；
  prefers-reduced-motion 下静态呈现、就绪即撤。
- **宽度**：骨架列宽引用 `--vsidian-live-preview-max-width`（#app 层同写机制），
  不复制读值；0 = 铺满档下骨架同样铺满；不做模式感知切换。
- **边界**：不做超时兜底、不加设置开关；悬停预览/文档嵌入/面板占位与设置页不包含；
  无面向用户文字，i18n 不涉及。

## 实施要点（风险）

1. 骨架样式须随初始 HTML 即时生效且过 CSP（editorCsp style-src 政策核实）——触及
   样式入口，实施前走 style-contract 技能流程；新类名/变量/keyframes 登记契约清单。
2. 挂载期骨架收编进内容区的 DOM 归宿与定位需定型（不遮工具栏、不干扰 CM6 测量）。
3. 撤除时刻计算提为共享纯函数（延时/周期/收束规则/reduced-motion 矩阵单测）；
   撤除信号 = init 全文落地后的正文首帧（rAF 或 CM6 update 侦听，实施定稿）。
4. 可选优化：初始 HTML 数据岛预注入 editor.readableLineWidth 初值，消除骨架期
   宽度回跳。
5. 骨架出现在启动期，回归时逐套核对既有浏览器/集成套件对初始 DOM 的断言。

## 验收

- 空窗两段均有骨架呈现（绘制层断言，非 DOM 存在性）；瞬间载好全程无扫光；
  慢载场景扫光按周期收束退出（边界：恰在周期边界就绪即撤）。
- 限宽档骨架列宽与正文列一致、跟随变量；铺满档骨架铺满。
- `check:stylecontract` 通过；既有集成/浏览器套件回归全绿。
```

### 建票操作

- `gh issue create --title <上> --body-file <正文文件>`（[issue-tracker.md](../agents/issue-tracker.md) 约定，中文标题正文，多行正文写 UTF-8 文件）。
- 标签：建议 `ready-for-agent`（切片完成、验收标准明确）。
- 建票后回填票号至本节，并按 CI 敏感期处置约定处理文档提交（纯文档直推 main）。

## 八、实施落档（#292，2026-10-02）

分支 `impl/2026-10-skeleton-screen` 实现并全量验证。**后续改骨架呈现、撤除规则、装配形态或触及 `shared/skeletonTiming` 常量前，必读本节。**

### 行为契约（钉住，不得顺手放宽）

- **装配单一形态**：骨架样式与标记仅由 `src/host/skeletonScreen.ts` 构造器生成、经 `buildWebviewHtml` 内联进初始 HTML（head `<style>` + `#app` 首子元素）——main.css 不承载骨架规则，外链 CSS 到达前空窗①即有样式（CSP style-src 已放行 unsafe-inline，未改 CSP）。
- **常量同源**：启动延时 300ms / 扫光周期 1500ms 定义于 `src/shared/skeletonTiming.ts`，内联 CSS（animation-delay/周期）与撤除计划（`planSkeletonExit`）共同消费——改扫光节奏只改常量，两侧自动一致。
- **收编落点 = `.vsidian-main` 覆盖层**：挂载时骨架移入主编辑区末尾（`.vsidian-skeleton-host` 提供定位包含块），`top` 按活跃视图容器相对主区实测偏移——**不进视图容器**（阅读虚拟化 `setDocument` 以 `textContent = ''` 整容器清空子树，进容器会在 init 首次渲染被误清除，实施实证）。撤除时还原宿主类与布局。
- **撤除信号**：`handleFullSync` 落地（含空文档）→ 双 rAF（`scheduleFrame` 同款退化）读就绪时刻 → `planSkeletonExit` 定时移除；周期收束规则见第三节，恰在边界就绪即撤。
- **宽度预注入**：非 0 档 `editor.readableLineWidth` 由 provider 经 `readableLineWidthPreset` 预写 `#app` 内联双变量（消除骨架期宽度回跳）；0 档不写，`applyReadableLineWidthSetting` 的 0 档移除/非 0 覆写语义不变。
- **测试通道门控**：`VSIDIAN_TEST_HOOKS=1` 时 provider 嵌入 `__vsidianSkeletonHold` 全局冻结撤除；webview 经 `_test.skeleton.release`（postToPanel）解除、状态经 `_test.skeleton.report` 回报、宿主 `_test.getSkeletonState` 轮询——生产装配不含 hold 全局，回报零消息。

### 契约登记

- 新增 chrome 域类目 `loading`（加载占位）与两条目 `skeleton`（container）/ `skeleton-block`（selector）；英文覆盖、locales 键（`styleRef.category.loading`）与样式指南产物同步。
- `skeleton-block` 列入 chromeContract 动态态豁免表——装载窗口瞬态，探针无法常态采集；呈现断言由浏览器套件 skeletonProbe 承接。

### 验证矩阵（2026-10-02，工作树内全绿）

- `npm run compile` 类型零错；`check:stylecontract` 八项零失败（条目 159：+loading 类目 +2 条目）。
- 单测全量 226 文件通过：新增 `skeletonTiming`（撤除矩阵 10 断言）、`skeletonScreen`（装配形态 9 断言）、`skeletonPanel`（jsdom 生命周期 5 用例）、契约快照联动（类目计数/英文覆盖/翻页遍历/豁免表）。
- 浏览器 `skeletonProbe`（已注册 run.mjs）8 断言：空窗①整页覆盖不透明、收编后贴工具栏下缘、限宽 600 跟随/铺满档与主区等宽、扫光常量（0.3s/1.5s）、reduced-motion 关闭、release 与无冻结路径撤除。
- 集成新增用例「骨架屏：hold 装配下收编在场、release 后撤除」：回报通道与 release 链路真宿主验证。

### 已知边界

- `.vsidian-skeleton-host` 使主区在装载窗口内成为定位包含块——若有绝对定位浮层在此窗口内打开（如快速操作面板），其包含块从 `#app` 变为主区，短暂窗内观感差异可接受；撤除即还原。
- 收编后用户切模式：覆盖层与模式无关、继续覆盖内容区直至撤除（无跨容器迁移）。
- 阅读恢复场景下骨架列宽恒按 Live 口径（Q9 裁定，不为片段差异化切换）。
