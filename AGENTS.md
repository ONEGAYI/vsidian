# vsidian

VSCode 扩展：在 VSCode 中提供类 Obsidian 的 Markdown 编辑体验。

> 当前状态：**MVP 主要功能已实施，整体验收未结**。一期双视图编辑、增量写回、任务、链接图片、双链、表格、查找、三态切换、独立设置页与源文件行号，二期公式渲染、Mermaid 图表、表格交互重做（[#72 规格](docs/specs/table-interaction-rework.md)）与大纲面板二期（#65–#70，样式透传、跳转高亮、折叠滑块、工具条搜索、右键菜单、拖拽排序）均已落地；统一右键菜单批次已落地（2026-09-28，#183 内核：Live 正文全域接管 + 注册/覆写基建 + 剪贴板四项，`blockMenu` 退役、`outlineMenu` 迁移内核并修复子菜单溢出；#184 内容接线：26 枚图标明暗资产接线 + 段落设置按行结构勾选 + 三簇命令分派核查钉住；规格 [docs/specs/context-menu.md](docs/specs/context-menu.md)）；工具栏刷新按钮已落地（2026-09-29，#208：顶栏右端组刷新入口 + 图片缓存全局代次换戳失效通道 + Mermaid 注入失败终态重置，刷新全程状态保持零写回；规格 [docs/specs/toolbar-refresh.md](docs/specs/toolbar-refresh.md)）；图片弹窗与防误触、表格数据行透明已落地（2026-09-29，#212：Markdown 图片接入代码块同款 hover 按钮组 + 本体吞点击 + 全屏弹窗（缩放/平移/刷新/原格式另存导出），链接内嵌与表格网格内图片明确排除，规格 [docs/specs/image-popup.md](docs/specs/image-popup.md)；#213：数据行与分隔行背景透明到编辑器背景、表头保留，新公开变量 `--vsidian-table-row-background`）；悬停预览与文档嵌入一期已落地（2026-09-30，#218–#225：Reading/Live 双侧悬停浮层（全文/章节/块范围 + B 身份来源资源与属性区）与正文嵌入卡片（一层展开、索引/rename 接线、光标驱动源码显隐）、目标变更订阅同步与有界缓存，引用内容全程只读；规格 [docs/specs/hover-preview-embed.md](docs/specs/hover-preview-embed.md)，性能实测见 [docs/perf/2026-09-hover-preview-embed-performance.md](docs/perf/2026-09-hover-preview-embed-performance.md)）；自动化通过不等于真实 IME、物理鼠标与视觉观感已由用户验收。功能范围见 [docs/specs/mvp.md](docs/specs/mvp.md)；待验项与历轮执行记录见 [docs/specs/manual-verification.md](docs/specs/manual-verification.md)；用户可见变更见 [CHANGELOG.md](CHANGELOG.md)。本文件是项目级 agent 规则的**单一入口**：横切约定常驻于此，领域落档约定的正文在指针目标（specs 文档与项目技能）中维护——入口唯一、不另建副本，指针写明触发分支，改动正文只改指针目标。

## 约定

- 通用工程规范（提交规范、TDD、文件树维护）遵循工程根 `D:\CODE\Project\AGENTS.md`，此处不重复展开。
- **插件设置入口**：Vsidian 面向用户的设置统一在扩展自己的设置页面展示与修改，不复用 VSCode 统一设置中心作为设置界面。后续新增设置项时，同步纳入该页面，并验证设置持久化、重新打开后的回显及变更生效。
- **操作与快捷键注册**：快捷键管理覆盖项目全部面向用户的可绑定操作。每次新增或修改操作，都必须评估并记录是否提供快捷键入口、默认绑定（允许默认未绑定）及生效模式；不能仅因操作不常驻工具栏就省略快捷键入口。写操作快捷键仅在 Live 编辑正文时覆盖宿主绑定，不接管源码模式或设置页输入；注册模型须支持未来其他操作按需覆盖 Live、阅读或双模式。绑定支持显式清空、单项恢复默认与全部恢复默认；清空不能因重启或升级自动恢复。插件内部冲突按键位及生效范围是否重叠判定。
- **图形化代码块扩展约定（#111 落档）**：新增或修改「渲染成图形的围栏代码块」的语言支持、按钮组、图表弹窗或导出行为前，必读 [docs/specs/graphic-code-block-interaction.md](docs/specs/graphic-code-block-interaction.md) 的「扩展约定（落档）」节——注册表两表（`RENDERED_FENCE_LABELS` 与 `graphicRenderers.ts`）必须同步登记，三步接入清单与降级边界在其中。
- **符号输入与行内围栏扩展约定（#103/#107/#123/#124/#125 落档）**：新增符号对、新增成对行内标记操作（粗体/斜体/删除线/行内代码类）、调整选区包裹、Tab 越界、IME 组合期输入行为或 CM6 扩展装配顺序前，必读 [docs/specs/symbol-input.md](docs/specs/symbol-input.md)——注册表驱动路径、装配顺序陷阱、「既有边界不得顺手放宽」清单与测试惯例均在其中。

- **frontmatter 表格扩展约定（#140 落档；2026-09-27 验收反馈改版为「只读表格 + Popover 编辑」）**：YAML 头「成型/降级」判定的单一事实源在 `src/shared/frontmatterTable.ts`——自研行级形态学定位区间（tableCells 先例）+ `yaml` 包 parseDocument 兜底合法性与类型，双层各司其职；新增支持类型只改该模块，并在 `test/unit/frontmatterTable.test.ts` 补降级矩阵。成型头区在 live 侧呈现为**只读键值两列表格**（格不可点击编辑，行内 ×/＋、闭合行整行「添加属性」按钮、Tab/Enter 格导航键位均已随格内编辑方案退役），编辑收敛到标题栏「修改」按钮（`frontmatterDecorations.ts` 的 FmCardHeaderWidget，replace 首围栏行）打开的 **Popover**（`frontmatterPopover.ts`：贴按钮 fixed 定位小浮层挂 body，非全屏；结构化输入行 + 底部「添加属性」主按钮）。**编辑链路**：文本输入即时写回（planSetFmKey / planSetFmValue（flow 值整框）/ planSetFmArrayItem）与按钮操作（删行/删项/加项/添加属性，planRemoveFmEntry 等）各为单笔事务走标准出站；浮层事务不带 CM6 选区（键名选中等价物是浮层内 input 全选），**一笔操作 = 一笔 edit.request = 撤销一步**。**成型态不暴露源码**（用户决策）：光标/选区进入成型头区即被引导至闭合行后正文起点——`frontmatterEditing` 的 transactionFilter 硬拦纯选区事务 + updateListener 微任务兜底（初始光标、undo 恢复选区；update 途中不得同步 dispatch 是 CM6 约束，兜底必须延迟重读最新状态）；#183 起引导口径收窄为**选区两端都在头区**（全选/跨头区拖选放行——统一菜单剪贴板全选的语义前提，`Ctrl+A` 在带头区文档的既存缺陷同修复；完全落入头区的选区仍被引导）；`externalSync` 与 undo/redo 事务豁免 filter，头区重析与 `fmModel` 的 fmTouched 增量重析不受影响（头块重建区间仍须 `tr.changes.mapPos` 映射）。**浮层同步**：文档变更经 updateListener 通知浮层按最新模型全量重建行 DOM、焦点与光标位按行标识（`data-entry-from` + role）还原，外部同步改写头区同样回流；头区降级瞬间浮层自动关闭（回源码可编辑），键名空/重复不写回只红边标记（写回即降级），flow 数组为值整框原文编辑。**焦点管理**照 diagramPopup 的 prevFocus 模式（body 不算先前焦点、此时返还按钮），Esc/外点关闭、切阅读或 dispose 关闭；禁止 window.alert。阅读侧合法头区在 `splitReadingBlocks` 产同构表格 HTML（含标题栏、无按钮、值全转义）。成型卡片行同时保留 `vsidian-frontmatter-line` 行类（Obsidian 别名桥 `.cm-hmd-frontmatter` direct 级在成型形态保持命中，降透明副作用由卡片规则重置）。观感硬约束（验收二轮实测教训，改版须保持）：**行级 grid 不限宽**——`vsidian-fm-row` 是行级类（直接作用于 .cm-line），任何 width 上限都会把行级背景/边框一并收窄、与头部行（widget 撑满）错位，右侧形成编辑器底色空洞与断边；**行区透明**（撞色边界感 = 卡片边框 + 标题栏微亮条，不铺底色）；标题栏行的 cm-widgetBuffer 隐藏（inline replace 前后各一个、各占一行文字高，头部行曾被撑到 1.7 倍正文行高）；键名弱化 opacity 0.7 + ::before 类型图标（标量 T / 数组宿主行 `vsidian-fm-list-row` 列表形 ≡，两侧同类名同规则）。样式契约：live-fm-header 为静态探针（chromeSelectors["live-fm-header-live"]），live-fm-popover 与 live-fm-fold 为交互态条目（豁免分工表钉住，行为路径验证）；live-fm-controls / live-fm-add-entry 条目与四个行内控件类名已退役。**卡片折叠（2026-10，与代码卡同交互）**：标题栏整条热区 + 右上折叠 chevron；live 折叠态 = `fmFoldField`（CM6 视图态零写回，切换经零写回 effect 事务触发 liveDecorations 头区行整体重发射），收起 = 键值/项/杂项行连同闭合行整块隐藏、首行携 `vsidian-fm-card-folded` 兼任底边；阅读侧经 `decorateReadingFrontmatterCard`（syncController 挂载钩子注入，布尔态各视图分持）；收起态不发射修改按钮、打开中的 Popover 随折叠关闭；纯指针交互不设快捷键（评估记录在规格）。规格见 [docs/specs/frontmatter-table.md](docs/specs/frontmatter-table.md)「卡片折叠」节。一期边界（`limit-fm-complex-types` 条目钉住）：flow 数组 Popover 内值整框编辑、无项级拆分（阅读侧仍拆项呈现）；行内注释卡片内绘制层隐藏；零缩进 block 序列降级源码。
- **视觉层断言（评审必查）**：webview/样式/渲染类变更，评审必须核对断言对象是"用户看到的东西"（可见性、对齐、颜色）而非 DOM 存在性或几何坐标——样式注入失效时后者照样通过（PR #37 P0 实证：CSP 拦截 CM6 注入样式后 74 集成用例仍全绿，正文实际不可见）。涉及呈现的新特性至少一条集成断言落在绘制层（现有 `view.state.paint` 探针），CSS 关键规则由契约测试钉住。
- **大纲样式设计哲学（#65 落档）**：大纲条目的呈现遵循三条原则，后续大纲呈现类变更不得违背。其一，**结构装饰与正文主题同源**——层级颜色等主题性装饰不复制读值，而是与正文标题引用同一 CSS 变量族（`--vsidian-heading-color-1..6`，定义于 `#app`，live 标题行级、阅读标题块级、大纲条目级三侧同引），主题分级着色一处定义多处生效。其二，**强调语义只认显式标记**——条目一律常规字重（400），不继承标题级别的结构性加粗；仅显式 `**粗体**` 段加重，斜体/行内代码/删除线同理只由标记触发。其三，**透传集合 = 正文已支持的行内标记子集**——当前白名单为粗体/斜体/高亮/行内代码/删除线（`OutlineSpanKind`，提取与校验同源；#105 高亮已按同一机制接入），公式/行内颜色待正文支持后按同一白名单机制接入（提取处 `SPAN_KIND_BY_NODE` 加映射即可），大纲侧零额外设计；双链/链接显示别名/链接文字的纯文本，不可点。
- **CSS 片段导入与界面域样式约定（#129/#130/#133 落档）**：修改 CSS 片段依赖导入分析、远程（HTTPS）样式加载、CSP 装配或界面域样式入口前，必读 [docs/specs/css-snippets.md](docs/specs/css-snippets.md) 的「实施落档约定」节——导入形态学与 CSSOM 对齐、远程引用「完全不进本地面」语义、内置样式 `:where()` 零特异性等硬边界在其中。
- **可读行宽与双模式列布局约定（#174/#175 落档）**：修改双模式正文限宽、列居中、Live 行号列跟随、可读行宽设置，或触及 `--file-line-width` / `--vsidian-reading-max-width` / `--vsidian-live-preview-max-width` 变量前，必读 [docs/specs/viewport-width.md](docs/specs/viewport-width.md) 的「实施落档」节——双变量 #app 层同写、0 = 铺满零干预、设置与片段优先序、铺满态零位移与 #32 行号契约修订均在其中。
- **工作区引用索引扩展约定（#194–#202 落档）**：修改索引调度、排除语义、rename 通道、图片失效通道或快照格式前，必读 [docs/specs/vault-index-backlinks.md](docs/specs/vault-index-backlinks.md)——各票实施落档（#198 调度与排除、#199/#200 rename 双通道、#201 图片三层失效、#202 收口）、「已知边界」与「明确不包含」清单在其中；台账外边界不得顺手改。
- **统一右键菜单扩展约定（2026-09 菜单批次落档）**：新增或修改右键菜单项、簇、子菜单、覆写行为、安全降级矩阵或菜单图标接线前，必读 [docs/specs/context-menu.md](docs/specs/context-menu.md) 的「扩展约定（落档）」节——菜单项注册表与图标 key 表的两表同步、三步接入清单与「既有边界不得顺手放宽」清单（阅读/头区不接管、内置只隐藏不删、提示列只派生自键位注册表）均在其中。

- **用户可见文字一律 i18n**：所有面向用户的文字（webview 界面、设置页、宿主通知/确认框、package.json command title 与 displayName/description）必须经 `src/shared/locales/` 语言包与 `t()` 字典映射添加，禁止新增硬编码中/英文字面量；两语言包键集由编译期 parity 把关，回潮由 CI 防回潮扫描（源码 CJK 字面量契约测试）拦截。manifest 侧 `package.nls.*.json` 由构建脚本从字典生成，不在 JSON 里手写。

## 公开样式契约：Agent 修改约束（项目技能 style-contract）

修改编辑器 webview 的 DOM、类名、属性、CSS 变量、主题、渲染依赖或片段加载路径，以及修改样式指南、兼容测试、历史基线或相关 CI 时，先加载项目技能 **style-contract**（`.agents/skills/style-contract/SKILL.md`）并按其流程执行：修改前固定旧契约、修改中保留兼容与独立证据、弃用与移除期限工具化校验（`npm run check:stylecontract`）、完成条件与交付证据。纯业务逻辑且不影响呈现或样式入口的变更无需执行。结构化清单单一事实源在 `src/shared/styleContract.ts`；门禁远端配置见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)。

## 技术栈与构建（工单 #2 确立）

- **运行时**：TypeScript + CodeMirror 6（`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`，单包组合，不用 `codemirror` 聚合包与 basicSetup/history——撤销栈归宿主文本管线）。阅读模式用 markdown-it（#8 起）；公式渲染 KaTeX 0.16.47 + `@vscode/markdown-it-katex` 1.1.2（#59，仅随包 woff2 字体）；Mermaid 11.12.2 独立产物按需懒加载（#60）；代码块卡片（#78–#85，规格 `docs/specs/code-block-card.md`）语法高亮为 Lezer 官方语言包 + `@codemirror/legacy-modes` StreamLanguage 统一引擎（`tok-*` 词表两端共用，`src/webview/codeHighlight.ts`），围栏表复用 `mermaidFencesField`，语言注册表在 `src/shared/codeLangs.ts`。
- **宿主端**（`src/extension.ts`、`src/host/`）：`CustomTextEditorProvider`，保存/dirty/Hot Exit 由 VSCode 文本管线自动处理；`TextDocument` 为权威文本，编辑经 `WorkspaceEdit` 写回。
- **webview 端**（`src/webview/`）：CM6 EditorView + `acquireVsCodeApi` 消息桥；`src/shared/` 为两端共享的消息协议单一事实源（不依赖 vscode/DOM）。协议约定 webview 全程 LF 坐标（CM6 内部把 `\r\n` 规范化为 `\n`，宿主侧 `NewlineCoordinator` 负责双向坐标与文本转换）。
- **构建**：esbuild 多产物——宿主 `out/extension.js`（node18/cjs/external vscode）、编辑器 webview `out/webview/main.js` 与设置页 webview `out/webview/settings.js`（#33；chrome118/iife，CSS 随 import 打包为同名 `.css`）；`npm run compile` 另跑 `tsc --noEmit` 做类型检查（esbuild 不查类型）。
- **测试**：`npm run test:unit`（vitest + `node --test` 启动器契约（testHost/release/browser 调度与 #134 历史契约检查器 `test/style-contract/checkStyleContract.test.mjs`），纯逻辑 + jsdom 的 webview 控制器，无 VSCode 宿主依赖；`VSIDIAN_TEST_HOST_MODE=foreground` 时跳过独立桌面探针）；`npm run test:browser`（Playwright headless Chromium，用原生键盘/IME 驱动生产控制器验证表格光标与输入回流——keydown 注入测不到 `input.type` 回流路径，**涉及 webview 输入/光标行为的变更合并前必跑**，首次需 `npx playwright install chromium`；CI 的 browser job 在 Linux runner 上跑同一脚本并缓存浏览器二进制，通道同为 Playwright chromium，与本地默认一致，`VSIDIAN_TEST_BROWSER_CHANNEL=msedge` 仅本机借系统 Edge 调试用，不进 CI）；`npm run test:integration`（1.86.2 真宿主，fixture 由 `test/integration/fixtures.mjs` 统一生成，开发态 `runTest.mjs` 与安装态 `runInstalled.mjs` 及空窗口激活 `runSettingsActivation.mjs` 三条路径共用 `testHost.mjs` 启动策略：Windows 默认独立桌面不抢前台，`VSIDIAN_TEST_HOST_MODE=foreground` 切前台；三条启动器都会把本次宿主的完整逐例输出与退出码自动落盘到 `.vscode-test/` 下的运行报告——`integration-dev.log` / `integration-installed.log` / `settings-activation.log`，复核结果、统计用例与追查失败优先读报告文件，不为补看信息重跑）。扩展注册 `onegayi.vsidian._test.*` 辅助命令供集成测试观测/注入（仅 `VSIDIAN_TEST_HOOKS=1` 时注册）。测试消息通道是**宿主侧门控、webview 侧被动接收**的分层设计：`_test.*` 注入命令（含向 webview 转发 `table.test.key`/`task.test.click`/`reading.test.image` 等）在宿主侧受 `VSIDIAN_TEST_HOOKS` 门控；webview 侧这些消息分支不做二次门控——webview 面板的消息源只有扩展自身（`panel.webview.postMessage`），封住注入源即封住入口，勿误判为 webview 未设防。
- **浏览器测试调度与报告**：`npm run test:browser` 经 `test/browser/run.mjs` 默认三并发运行全部浏览器脚本（脚本清单即 run.mjs 的 `names` 数组，不在此重复记数）；`-- --workers=1` 回退串行，`-- --suite=tableCaret,graphicPopup` 定向运行，`-- --no-reuse` 禁用本轮构建复用。每轮写入独立的 `out/test/browser-runs/run-*/`，含 `report.json`、`report.md`、逐脚本日志、构建/浏览器启动阶段计时与运行产物。脚本失败后继续收集其他结果，任一失败整体非零；单脚本 120 秒超时，取消时停止已启动的子进程树。共享构建只在本轮有效，浏览器状态不共享；含插件函数的表格 fixture 保留本进程构建。CI 无论成功失败均上传报告与日志（artifact 名 `browser-reports-a<attempt>`，带重跑 attempt 号——`gh run rerun` 不覆盖旧 attempt 的失败现场，#164）——CI browser job 失败时 `gh run view` 的日志只有脚本名级结论，断言栈与逐脚本日志要先 `gh run download <run-id> -n browser-reports-a<attempt>`（attempt 从 1 起，`gh run view <run-id> --json attempt` 查当前值）取报告，再决定是否本地复现。测量方法、收益与边界见 [浏览器测试调度实测](docs/perf/2026-09-browser-test-runner.md)。
- **集成测试分片**：本地设置 `VSIDIAN_ITEST_SHARDS=4` 再运行 `npm run test:integration`，启动器共用一份 VSCode 程序，为各片创建独立临时便携目录并在全部宿主退出后清理；逐片报告写入 `.vscode-test/integration-dev-s<片号>.log`。缺省仍为单宿主全量测试。CI 使用四个 runner，各注入 `VSIDIAN_TEST_SHARD=k/4` 且只起一个宿主；`integration` 汇总检查保留分支保护所需的稳定名称。
- **历史契约门禁 job（#135）**：ci.yml 的 `style-contract` job 跑 `npm run check:stylecontract:baseline`（git 锚定基线复验，须在契约检查**之前**——先证检查器可信，再信检查结果）+ `npm run check:stylecontract`（八项全检查），并把检查器/基线/门禁工作流文件相对 PR 基点的变更统计写入 step summary 供独立审查；报告无论成败经 artifact（`style-contract-report`）保留。checkout 须 `fetch-depth: 0` + `fetch-tags: true`（verify-baseline 与发布记录交叉验证依赖 git 对象与 refs/tags，浅克隆即缺）。job 名是远端必需检查的 context 候选，改名视同变更保护规则；远端名单现状与授权后操作步骤见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)。
- **打包与安装态回归（#15）**：`npx @vscode/vsce package --no-dependencies` 产出 VSIX（esbuild bundle 自包含，不带 node_modules；`.vscodeignore` 排除 src/test/docs）。`node test/integration/runInstalled.mjs` 把 VSIX 经 `--install-extension` 装入隔离 profile 的 1.86.2 便携宿主（安装注册链路真实走通；1.86 测试模式要求 `--extensionTestsPath` 依赖 `--extensionDevelopmentPath` 同时存在，故 dev path 指向安装解压目录——加载代码仍是 VSIX 产物而非仓库源码树）后跑同一集成套件。
- **性能测量**：`node test/perf/runPerf.mjs`（1千/1万/10万行、10 KB/100 KB/1 MB、超长行、图片密集与大围栏；报告写 `docs/perf/data/perf-report.json`）；档位数据与解读汇总在 [docs/perf/2026-09-mvp-performance-summary.md](docs/perf/2026-09-mvp-performance-summary.md)。
- **版本锁定**：依赖一律精确版本（无 `^`），提交 lockfile；`engines.vscode ^1.86.0` 与 `@types/vscode 1.86.0` 对齐。`@types/node` 锁 22.x（vitest 5 的 vite peer 要求数 >=20.19，类型不进产物，宿主代码仍按 Node 18 API 面编码）。

## 打包与发布（项目技能 release）

准备或执行版本发布（升版本、CHANGELOG、打包 VSIX、体积红线、CI 发布、marketplace 兜底）时，加载项目技能 **release**（`.agents/skills/release/SKILL.md`）按其流程执行。体积阈值事实源在 `scripts/release.mjs` 的 `SIZE_LIMITS`。

## Agent skills

### Issue tracker

使用 GitHub Issues 跟踪需求、缺陷与任务，仓库为 `ONEGAYI/vsidian`。操作约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。

### Domain docs

采用单一领域上下文；术语与架构决策按需记录。读取与维护约定见 [docs/agents/domain.md](docs/agents/domain.md)。

## 文件树（简版速览）

```
<!-- file-tree:tree:begin 由脚本渲染，禁止手改 -->
vsidian/
├── .agents/               # agent 技能与本地配置
│   └── skills/ # 已部署 agent 技能
│       ├── ai-icon-sheet-to-svg/ # AI单图图标转SVG技能
│       ├── file-tree/            # file-tree 技能部署实例
│       ├── release/              # 打包与发布流程项目技能目录
│       │   └── SKILL.md # 打包与发布流程项目技能
│       └── style-contract/       # 样式契约修改约束项目技能目录
│           └── SKILL.md # 样式契约修改约束项目技能
├── .github/               # GitHub 平台配置
│   └── workflows/ # Actions 工作流目录
│       ├── ci.yml      # GitHub CI 工作流
│       └── release.yml # v* 标签触发的发布工作流
├── .gitignore             # Git 忽略规则
├── .vscode/               # VSCode 工作区配置
│   ├── launch.json # F5 扩展宿主启动配置
│   └── tasks.json  # 调试前编译任务
├── .vscodeignore          # VSIX 打包排除清单
├── AGENTS.md              # 项目级 agent 规则单一事实源
├── CHANGELOG.md           # 面向用户的版本变更日志
├── CLAUDE.md              # Claude 专属规则导入入口
├── CONTEXT.md             # 领域语言与产品边界事实源
├── docs/                  # 项目文档根
│   ├── adr/        # 架构决策记录
│   │   ├── 0001-vscode-186-remote-support.md     # 兼容 VSCode 1.86 与远程
│   │   ├── 0002-wikilink-on-demand-resolution.md # 双链按需解析不建持久索引
│   │   ├── 0003-source-text-dual-view-editor.md  # 基于源文本的双视图编辑架构
│   │   ├── 0004-stable-styling-contract.md       # 一期建立稳定样式入口
│   │   ├── 0005-viewport-rendering.md            # 全文模型与视口渲染分离
│   │   ├── 0006-rebrand-to-vsidian.md            # 统一更名为 vsidian 的映射记录
│   │   ├── 0007-css-snippet-env-isolation.md     # CSS 片段环境隔离决策记录（#131）
│   │   ├── 0008-workspace-reference-index.md     # 工作区引用索引架构与存储选型
│   │   └── 0009-referenced-document-views.md     # 引用文档视图读写分离决策
│   ├── agents/     # agent 操作约定
│   │   ├── domain.md        # 领域文档读取与维护约定
│   │   └── issue-tracker.md # GitHub Issues 操作约定
│   ├── design/     # 设计文档（选择器映射等）
│   │   ├── backlinks-panel-reference.png   # 反链面板形态参考图
│   │   ├── find-panel-icons-reference.png  # 查找面板图标参考图
│   │   ├── links-panel-icons-reference.png # 链环图标参考图（反链/出链）
│   │   ├── obsidian-selector-map.md        # Obsidian 选择器映射表
│   │   └── outlinks-panel-reference.png    # 出链面板形态参考图
│   ├── features.md # README 功能与设置详解下沉页
│   ├── perf/       # 性能实测数据与测量工具说明
│   │   ├── 2026-09-browser-test-runner.md             # 浏览器测试调度实测
│   │   ├── 2026-09-code-block-card.md                 # 代码块卡片性能实测（#85）
│   │   ├── 2026-09-hover-preview-embed-performance.md # 悬停与嵌入一期性能实测（#225）
│   │   ├── 2026-09-live-syntax-decorations.md         # 语法树装饰与大围栏细分实测（#8）
│   │   ├── 2026-09-math-rendering.md                  # 公式渲染性能实测（#59）
│   │   ├── 2026-09-mermaid-rendering.md               # Mermaid 性能与边界（#60）
│   │   ├── 2026-09-mvp-performance-summary.md         # MVP 性能档位汇总
│   │   ├── 2026-09-reading-viewport-mount.md          # 阅读按需挂载实测数据
│   │   ├── 2026-09-table-cell-editing.md              # 表格单元格编辑性能实测（#12）
│   │   ├── 2026-09-title-decoration-viewport.md       # 标题切片视口渲染实测数据
│   │   ├── 2026-09-vault-index-storage.md             # 索引存储选型三档基准解读（#195）
│   │   ├── 2026-10-hit-reveal-budget.md               # 命中显形重建预算实测（#251）
│   │   └── data/                                      # 性能探针原始报告数据
│   │       ├── browser-test-runner.json               # 浏览器调度实测数据
│   │       ├── hover-embed-perf-host.json             # #225 真宿主编辑阻塞实测数据
│   │       ├── hover-embed-perf.json                  # #225 状态层嵌入装饰实测数据
│   │       ├── hover-refresh.json                     # #224 引用视图同步定向测量数据
│   │       ├── perf-report.json                       # 性能探针原始报告数据
│   │       ├── vault-index-storage-bench-recheck.json # #202 三档复测报告
│   │       └── vault-index-storage-bench.json         # 索引存储基准原始数据（#195）
│   ├── research/   # 技术调研报告
│   │   ├── obsidian-live-preview-editor.md # Obsidian 技术栈与选型调研
│   │   └── obsidian-viewport-rendering.md  # 视口渲染性能补充调研
│   └── specs/      # 产品规格
│       ├── anchor-navigation.md               # 锚点跳转规格（标题/块引用/复制块链接）
│       ├── appearance-merge.md                # 外观合并分页规格
│       ├── batch-2026-09-menu.md              # 右键菜单批次总览与决策回执
│       ├── batch-2026-09.md                   # 2026-09 开票批次总览
│       ├── batch-2026-10-settings-sections.md # 2026-10 设置页批次实施树
│       ├── batch-2026-10-vscode-ops.md        # 2026-10 编辑器操作批次实施树
│       ├── blockquote-accent-bar.md           # 引用块紫色提示边条规格
│       ├── code-block-card.md                 # 代码块卡片功能规格
│       ├── context-menu.md                    # 统一右键菜单规格（正文全域接管）
│       ├── css-snippets.md                    # CSS片段与样式兼容规格
│       ├── frontmatter-table.md               # frontmatter 表格化规格
│       ├── graphic-code-block-interaction.md  # 图形化代码块交互规格
│       ├── hover-preview-embed.md             # 悬停预览与文档嵌入规格
│       ├── html-comment-support.md            # HTML 注释快捷键与呈现规格
│       ├── i18n.md                            # 全局 i18n 适配规格
│       ├── image-paste.md                     # 图片粘贴插入与资产文件夹规格
│       ├── image-popup.md                     # 图片弹窗查看与防误触规格
│       ├── integration-host-teardown-noise.md # CI 收尾退出噪声边界（#211）
│       ├── keybindings.md                     # 快捷键清单与默认值
│       ├── live-table-column-width.md         # Live 表格列宽规格
│       ├── manual-verification.md             # 人工验证清单
│       ├── mvp-issues.md                      # MVP GitHub Issue 索引
│       ├── mvp.md                             # MVP 规格主文档
│       ├── settings-page-visual-refresh.md    # 设置页视觉刷新规格（#155）
│       ├── style-contract-gate.md             # 契约门禁 CI 接线与远端配置文档
│       ├── style-reference-i18n.md            # 样式参考条目双语化规格
│       ├── symbol-input.md                    # 符号输入与行内围栏扩展约定落档
│       ├── table-interaction-rework.md        # 表格交互重做规格
│       ├── toolbar-refresh.md                 # 工具栏刷新按钮与缓存刷新规格
│       ├── toolbar-view-toggle.md             # 工具栏双态切换按钮规格
│       ├── vault-index-backlinks.md           # 引用索引与反链实施规格
│       └── viewport-width.md                  # 可读行宽与双模式列布局规格
├── esbuild.mjs            # esbuild 多产物构建脚本
├── LICENSE                # MIT 许可证全文
├── media/                 # 随扩展打包的静态资源
│   ├── css-contract-probe.css # 样式契约内部测试片段
│   ├── quick-actions/         # 快速操作明暗图标与源PNG
│   ├── style-reference/       # 样式参考指南生成资产
│   ├── vsidian-icon-256.png   # 扩展图标 256 版，VSIX 打包用
│   └── vsidian-icon.png       # Vsidian 扩展图标
├── package-lock.json      # npm 依赖锁定文件
├── package.json           # 扩展清单与锁定依赖
├── package.nls.json       # 命令默认英文文案
├── package.nls.zh-cn.json # 命令简体中文文案
├── README.en.md           # 英文版 README，与中文版互指
├── README.md              # 项目门面说明
├── scripts/               # 仓库工具脚本目录
│   ├── checkStyleContract.mjs    # 历史契约兼容检查器 CLI
│   ├── demoStyleContractGate.mjs # 契约门禁负向演示脚本
│   ├── genNls.d.mts              # NLS 生成器类型声明
│   ├── genNls.mjs                # manifest NLS 文件生成脚本
│   ├── genStyleGuide.mjs         # 样式指南生成脚本
│   ├── quick-action-icons.py     # 快速操作图标生成与校验
│   ├── release.mjs               # 发布脚本：打包、包体检查与上传
│   └── styleContractCheck.mjs    # 契约检查纯逻辑模块
├── src/                   # 扩展源码
│   ├── extension.ts # 扩展激活入口
│   ├── host/        # 宿主端实现
│   │   ├── cssSnippetService.ts        # CSS 片段宿主权威服务
│   │   ├── cssSnippetWiring.ts         # CSS 片段 vscode 层装配
│   │   ├── diagramExportHost.ts        # 宿主图表导出执行壳
│   │   ├── diagramExportValidate.ts    # 图表导出载荷校验
│   │   ├── documentSession.ts          # 文档会话与写回同步
│   │   ├── editorCsp.ts                # 编辑器 CSP 装配纯模块（#130）
│   │   ├── findOptionsStore.ts         # 查找选项持久化存取
│   │   ├── hostLocale.ts               # 生效语言宿主装配解析帮手
│   │   ├── hoverDocAccess.ts           # 悬停预览文档访问纯逻辑
│   │   ├── hoverRefreshCoordinator.ts  # 引用视图刷新协调器（宿主）
│   │   ├── imageExportHost.ts          # 宿主图片导出执行壳
│   │   ├── imagePasteHost.ts           # 图片粘贴落盘执行壳（#161）
│   │   ├── imagePastePlan.ts           # 图片粘贴纯逻辑（#161）
│   │   ├── imageRefreshCoordinator.ts  # 图片刷新协调器（provider 级）
│   │   ├── imageVersioning.ts          # 图片资源版本表纯逻辑
│   │   ├── jiebaResourceService.ts     # jieba 资源宿主服务（端口注入）
│   │   ├── jiebaResourceWiring.ts      # jieba 资源 vscode 层装配
│   │   ├── jiebaTar.ts                 # npm tarball 最小提取器
│   │   ├── keybindingService.ts        # 快捷键全局存储服务
│   │   ├── linkTarget.ts               # 宿主侧链接目标分类纯逻辑（#10）
│   │   ├── settingsPage.ts             # 独立设置页面板装配
│   │   ├── settingsService.ts          # 宿主设置服务
│   │   ├── styleReferenceExport.ts     # 契约 JSON 导出宿主执行壳
│   │   ├── styleReferenceExportPlan.ts # 契约 JSON 导出纯规划逻辑
│   │   ├── textEditorProvider.ts       # 自定义文本编辑器提供者
│   │   ├── vaultIndexMaintenance.ts    # 索引维护接线：排除持久化与操作编排
│   │   ├── vaultIndexOverlay.ts        # 索引覆盖层与反链查询纯逻辑（#197）
│   │   ├── vaultIndexService.ts        # 引用索引宿主服务（#197）
│   │   ├── vaultIndexWiring.ts         # 索引服务 vscode 层端口装配
│   │   ├── vaultLinkExtract.ts         # 出链抽取纯逻辑（#197）
│   │   ├── vaultRenameWiring.ts        # rename 引用更新装配（#199）
│   │   ├── viewCycle.ts                # 三态视图编排纯逻辑
│   │   └── wikilinkTarget.ts           # 宿主侧双链目标解析纯逻辑（#11）
│   ├── shared/      # 两端共享纯逻辑
│   │   ├── blockId.ts            # 块 id 与块边界单一事实源
│   │   ├── changeMapping.ts      # 变更重定位纯函数
│   │   ├── chromeContract.ts     # 界面域样式契约探针表
│   │   ├── codeLangs.ts          # 代码块语言注册表与别名路由
│   │   ├── contextMenu.ts        # 统一右键菜单内核纯函数单一事实源
│   │   ├── cssSnippetEnv.ts      # CSS 片段环境身份与分桶戳（#131）
│   │   ├── cssSnippetImports.ts  # CSS 片段依赖导入形态学单一事实源
│   │   ├── cssSnippets.ts        # CSS 片段纯逻辑单一事实源
│   │   ├── findOptions.ts        # 查找选项三开关单一事实源
│   │   ├── formatOperations.ts   # 格式操作注册清单
│   │   ├── frontmatterTable.ts   # frontmatter 表格化纯逻辑
│   │   ├── hoverRefresh.ts       # 引用视图同步参数与订阅注册表
│   │   ├── i18n.ts               # t() 取词与语言包装配状态模块
│   │   ├── imageRefresh.ts       # 图片刷新共享常量与核验决策
│   │   ├── jiebaManifest.ts      # jieba 锁定版本与下载源清单
│   │   ├── keybindings.ts        # 快捷键操作与冲突模型
│   │   ├── listPrefix.ts         # 列表引用前缀形态学（#119）
│   │   ├── locales/              # 语言包字典单一事实源
│   │   │   ├── en.ts     # 英文语言包（类型基准）
│   │   │   ├── index.ts  # 语言注册表与解析（仅宿主可引）
│   │   │   ├── island.ts # 语言数据岛构建与解析
│   │   │   └── zh-cn.ts  # 简体中文语言包（编译期 parity）
│   │   ├── looseLink.ts          # 宽松内联链接/图片形态学单一事实源
│   │   ├── math.ts               # 公式形态学纯函数（#59）
│   │   ├── mermaid.ts            # Mermaid 围栏形态学（#60）
│   │   ├── newline.ts            # CRLF/LF 换行协调器
│   │   ├── obsidianAlias.ts      # Obsidian 别名桥实现同源表
│   │   ├── protocol.ts           # 消息协议单一事实源
│   │   ├── settings.ts           # 设置定义与读写纯逻辑
│   │   ├── styleContract.ts      # 公开样式契约清单单一事实源
│   │   ├── styleContractEn.ts    # 样式参考条目英文覆盖单一事实源
│   │   ├── symbols.ts            # 符号注册表单一事实源（#123）
│   │   ├── symbolWrap.ts         # 选区包裹计划纯函数（#124）
│   │   ├── tabEscape.ts          # Tab 越界定位纯函数（#125）
│   │   ├── vaultIndexExclude.ts  # 索引排除模式纯逻辑单一事实源
│   │   ├── vaultIndexModel.ts    # 引用索引内存模型纯逻辑
│   │   ├── vaultIndexSchedule.ts # 索引维护调度纯逻辑与初值常量
│   │   ├── vaultIndexSnapshot.ts # 分片快照存储纯逻辑（#195 选型基线）
│   │   ├── vaultLink.ts          # 根内相对路径解析单一事实源（#196）
│   │   ├── vaultRename.ts        # 引用改写计划纯逻辑（#199）
│   │   ├── wikilink.ts           # 双链形态学单一事实源（#11）
│   │   └── wordSegment.ts        # 中文分词形态学与移动规划纯函数
│   └── webview/     # webview 端实现
│       ├── anchorFlash.ts              # 跳转目标高亮装饰状态
│       ├── appearanceSettings.ts       # 外观合并分页
│       ├── backlinkGrouping.ts         # 反链面板分组排序过滤纯函数
│       ├── backlinkPanel.ts            # 反链面板 DOM 与四态渲染（#197）
│       ├── blockIdStrip.ts             # 阅读渲染块标记剥离纯函数
│       ├── codeCardState.ts            # 卡片共享状态中立模块
│       ├── codeHighlight.ts            # 语法高亮引擎装配与缓存
│       ├── contextMenuDom.ts           # 统一菜单 DOM 装配与子菜单翻转
│       ├── css.d.ts                    # CSS 导入类型声明
│       ├── cssSnippetSettings.ts       # 外观页 CSS 片段页签体
│       ├── diagramExport.ts            # 图表导出序列化与光栅化
│       ├── diagramPopup.ts             # 图表弹窗全屏浮层
│       ├── diagramPopupGeometry.ts     # 弹窗几何纯函数
│       ├── embedCard.ts                # Reading 嵌入卡片管理器
│       ├── fenceEscape.ts              # 围栏 Tab 越界适配层（#125）
│       ├── findSession.ts              # 查找匹配纯函数（#14）
│       ├── fontArrival.ts              # 字体晚到监听（#130）
│       ├── formatOperations.ts         # 格式文本变换规划
│       ├── frontmatterDecorations.ts   # frontmatter 卡片装饰
│       ├── frontmatterEditing.ts       # frontmatter 格导航键位组
│       ├── frontmatterPopover.ts       # frontmatter 属性编辑浮层
│       ├── graphicBlockChrome.ts       # 图形化块右上角按钮组
│       ├── graphicRenderers.ts         # 图形化渲染器注册表
│       ├── hitReveal.ts                # 命中显形活跃命中集单一事实源
│       ├── hoverPopup.ts               # 悬停预览浮层单例
│       ├── hoverPopupGeometry.ts       # 悬停浮层几何纯函数
│       ├── htmlComment.ts              # 阅读侧 HTML 注释剥离纯函数
│       ├── imagePaste.ts               # 图片粘贴拦截适配层（#161）
│       ├── imagePopup.ts               # 图片弹窗全屏浮层单例
│       ├── imageResource.ts            # 图片资源状态机（#10）
│       ├── imageVerifyScheduler.ts     # webview 周期核验定时器调度
│       ├── indentEditing.ts            # Tab 通用行缩进处理器（#120）
│       ├── indexMaintenanceSettings.ts # 设置页索引维护分页
│       ├── keybindingRouter.ts         # 编辑器按键分发器
│       ├── keybindingSettings.ts       # 快捷键设置分页
│       ├── listEditing.ts              # Enter 延续与退格清层（#119）
│       ├── liveBlockId.ts              # 块 id 标记 live 淡化装饰
│       ├── liveCodeCard.ts             # Live 代码块卡片装饰
│       ├── liveDecorations.ts          # 语法树驱动 Live 装饰（#8）
│       ├── liveEmbed.ts                # Live 嵌入装饰与源码显隐
│       ├── liveLineNumbers.ts          # 表格段首行号与绘制探针
│       ├── liveLinks.ts                # live 链接装饰与跳转（#10）
│       ├── liveMath.ts                 # 行内与块级公式 live 装饰（#59）
│       ├── liveMermaid.ts              # Mermaid live 装饰（#60）
│       ├── localeBoot.ts               # webview 语言装配入口
│       ├── localeDom.ts                # 常驻控件文案换包单点重刷注册表
│       ├── localeOnDemand.ts           # 按需控件文案换包 DOM 级重刷
│       ├── main.css                    # webview 全局布局样式
│       ├── main.ts                     # webview 启动入口
│       ├── markdownDoc.ts              # Markdown 文档工具与树查询
│       ├── mathRenderCache.ts          # KaTeX 渲染 LRU 缓存共享模块
│       ├── mermaidEntry.ts             # Mermaid 独立产物入口（#60）
│       ├── mermaidRender.ts            # Mermaid 渲染管线（#60）
│       ├── mermaidTheme.ts             # Mermaid 暗色主题装配
│       ├── multicursor.ts              # 多光标扩展组单一事实源（#237）
│       ├── nextOccurrence.ts           # 选下一处相同词选区计划纯函数
│       ├── outline.ts                  # 大纲全文解析与面板装配
│       ├── outlineCollapse.ts          # 大纲折叠状态机纯函数
│       ├── outlineDrag.ts              # 大纲拖拽移动计划纯函数
│       ├── outlineLocate.ts            # 大纲定位纯函数
│       ├── outlineMenu.ts              # 大纲右键菜单模型纯逻辑
│       ├── outlineSearch.ts            # 大纲标题搜索纯函数
│       ├── outlineSection.ts           # 大纲控制域纯函数
│       ├── outlinkPanel.ts             # 出链面板 DOM 与四态渲染
│       ├── overlayAnchor.ts            # 浮层右缘锚点计划纯函数
│       ├── perfProbe.ts                # webview 性能探针（#5）
│       ├── popupMutex.ts               # 图表与图片弹窗互斥
│       ├── quickActionState.ts         # 快速操作状态判定
│       ├── readingBlocks.ts            # markdown-it 阅读块切分
│       ├── readingCodeCard.ts          # 阅读代码块卡片增强
│       ├── readingFind.ts              # 阅读查找源坐标与字符高亮
│       ├── readingFindSource.ts        # 阅读查找只读源码浮层
│       ├── readingMarkdown.ts          # markdown-it 安全渲染层
│       ├── readingProbe.ts             # 阅读视图性能探针
│       ├── readingView.ts              # 阅读视图 DOM 构建与锚点定位
│       ├── readingViewport.ts          # 阅读视口挂载窗口纯函数
│       ├── readingVirtualView.ts       # 阅读视图虚拟化装配层
│       ├── refReadingContent.ts        # 引用内容只读 Reading 装配
│       ├── settingsMain.ts             # 设置页 webview 入口
│       ├── settingsPage.css            # 设置页样式
│       ├── settingsPageView.ts         # 设置页 webview 视图
│       ├── snippetLoader.ts            # CSS 片段 link 装配器
│       ├── styleGuideData.ts           # 设置页样式参考数据（生成）
│       ├── styleReferenceSettings.ts   # 外观页样式参考页签体
│       ├── symbolAutocomplete.ts       # 符号自动补全编辑器适配层（#123）
│       ├── symbolCompositionState.ts   # IME 选区快照共享状态
│       ├── symbolWrap.ts               # 选区包裹编辑器适配层（#124）
│       ├── syncController.ts           # CM6 同步控制器
│       ├── tableCells.ts               # 表格单元格边界、换行与转义
│       ├── tableColumnWidth.ts         # 表格列宽采样与轨道计划纯函数
│       ├── tableControls.ts            # 表格可见行控件与拖动
│       ├── tableCreate.ts              # 光标处建表规划纯函数
│       ├── tableEditing.ts             # 表格输入钩子（#12）
│       ├── tableRegion.ts              # 表格矩形选区与结构规划
│       ├── tableRegionField.ts         # 表格格区选区状态单一事实源
│       ├── tableRegionSelection.ts     # 表格格区拖选指针交互
│       ├── tableStructure.ts           # 表格导航与增删行列纯函数（#13）
│       ├── taskToggle.ts               # 任务勾选解析纯函数（#9）
│       ├── wordMotion.ts               # 词级移动命令与引擎配置
│       └── wordSegmentSettings.ts      # 设置页中文分词分页
├── test/…                 # 测试根
├── tsconfig.json          # TypeScript 类型检查配置
└── vitest.config.ts       # vitest 单元测试配置
<!-- file-tree:tree:end -->
```

## 文件树标签词表

<!-- file-tree:tags:begin 由脚本渲染，禁止手改 -->
| 标签 | 说明 |
| --- | --- |
| `adr` | 架构决策记录 |
| `convention` | 流程与操作约定 |
| `meta` | 仓库级配置、规则与事实源文档 |
| `research` | 技术调研报告 |
| `spec` | 产品与实施规格 |
<!-- file-tree:tags:end -->
