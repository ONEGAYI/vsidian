# vsidian

VSCode 扩展：在 VSCode 中提供类 Obsidian 的 Markdown 编辑体验。

> 当前状态：**MVP 一期/二期与 2026-09 起各批次（统一右键菜单、工具栏刷新、图片弹窗、悬停预览与文档嵌入、引用索引等）均已落地，整体验收未结**；真实 IME、物理鼠标与视觉观感的验收口径见人工验证清单。功能范围见 [docs/specs/mvp.md](docs/specs/mvp.md)，批次规格见 [docs/specs/](docs/specs/)，待验项与历轮执行记录见 [docs/specs/manual-verification.md](docs/specs/manual-verification.md)，用户可见变更见 [CHANGELOG.md](CHANGELOG.md)。本文件是项目级 agent 规则的**单一入口**：横切约定常驻于此，领域落档约定的正文在指针目标（specs 文档与项目技能）中维护——入口唯一、不另建副本，指针写明触发分支，改动正文只改指针目标。

## 约定

- 通用工程规范（提交规范、TDD、文件树维护）遵循工程根 `D:\CODE\Project\AGENTS.md`，此处不重复展开。
- **CI 敏感期处置（用户授权，2026-10-01）**：纯文档提交（规格、CHANGELOG 等）直推 main，不走 PR；CI 因 #272 已知抖动族挂红不重跑不回滚。代码变更不受豁免，合并仍以该提交全绿为准。至 #272 根治为止。
- **插件设置入口**：Vsidian 面向用户的设置统一在扩展自己的设置页面展示与修改，不复用 VSCode 统一设置中心作为设置界面。后续新增设置项时，同步纳入该页面，并验证设置持久化、重新打开后的回显及变更生效。
- **Vsidian 附加组件公开 API**（2026-10-04 设计方向）：设计或修改附加组件的发现与调用机制、公开 API、配套文档及兼容检查前，必读 [ADR-0012](docs/adr/0012-vsidian-addons-distribution-api-governance.md)。API 文档与 CSS 样式契约同等维护；声明、契约与版本文档以主仓库为事实源，另提供独立示例仓库，文档不要求随 Vsidian VSIX 分发。API 分稳定接口和显式实验入口；发现与安装经 VSCode，具体设置在 Vsidian 自有设置页汇总。接口与兼容检查的设计草案见 [附加组件规格](docs/specs/vsidian-addons.md)，装载、SDK 和宿主历史协调提议及最小探针范围见[技术方案](docs/design/vsidian-addon-api.md)。API 已随 #347 首版批次实施但**仍为 1.0.0 候选、未对外发行**，不将本约定当作已发布契约；实施与门禁的维护纪律见下条（#362/#363 落档）。
- **操作与快捷键注册**：快捷键管理覆盖项目全部面向用户的可绑定操作。每次新增或修改操作，都必须评估并记录是否提供快捷键入口、默认绑定（允许默认未绑定）及生效模式；不能仅因操作不常驻工具栏就省略快捷键入口。写操作快捷键仅在 Live 编辑正文时覆盖宿主绑定，不接管源码模式或设置页输入；注册模型须支持未来其他操作按需覆盖 Live、阅读或双模式。绑定支持显式清空、单项恢复默认与全部恢复默认；清空不能因重启或升级自动恢复。插件内部冲突按键位及生效范围是否重叠判定。
- **图形化代码块扩展约定（#111 落档）**：新增或修改「渲染成图形的围栏代码块」的语言支持、按钮组、图表弹窗或导出行为前，必读 [docs/specs/graphic-code-block-interaction.md](docs/specs/graphic-code-block-interaction.md) 的「扩展约定（落档）」节——注册表两表（`RENDERED_FENCE_LABELS` 与 `graphicRenderers.ts`）必须同步登记，三步接入清单与降级边界在其中。
- **符号输入与行内围栏扩展约定（#103/#107/#123/#124/#125 落档）**：新增符号对、新增成对行内标记操作（粗体/斜体/删除线/行内代码类）、调整选区包裹、Tab 越界、IME 组合期输入行为或 CM6 扩展装配顺序前，必读 [docs/specs/symbol-input.md](docs/specs/symbol-input.md)——注册表驱动路径、装配顺序陷阱、「既有边界不得顺手放宽」清单与测试惯例均在其中。
- **frontmatter 表格扩展约定（#140 落档；2026-09-27 验收反馈改版为「只读表格 + Popover 编辑」）**：新增或修改 frontmatter 成型/降级判定、卡片呈现、Popover 编辑链路、光标引导、浮层同步或卡片折叠前，必读 [docs/specs/frontmatter-table.md](docs/specs/frontmatter-table.md)——成型/降级单一事实源在 `src/shared/frontmatterTable.ts`（新增支持类型只改该模块，并在 `test/unit/frontmatterTable.test.ts` 补降级矩阵）；观感硬约束（行级 grid 不限宽、行区透明）、光标引导口径、浮层同步与一期边界均在规格「实施落档约定」节，改版须保持，台账外边界不得顺手改。
- **视觉层断言（评审必查）**：webview/样式/渲染类变更，评审必须核对断言对象是「用户看到的东西」（可见性、对齐、颜色）而非 DOM 存在性或几何坐标——样式注入失效时后者照样通过（PR #37 P0 实证：CSP 拦截 CM6 注入样式后 74 集成用例仍全绿，正文实际不可见）。涉及呈现的新特性至少一条集成断言落在绘制层（现有 `view.state.paint` 探针），CSS 关键规则由契约测试钉住。
- **大纲样式设计哲学（#65 落档）**：大纲条目的呈现遵循三条原则，后续大纲呈现类变更不得违背。其一，**结构装饰与正文主题同源**——层级颜色等主题性装饰不复制读值，而是与正文标题引用同一 CSS 变量族（`--vsidian-heading-color-1..6`，定义于 `#app`，live 标题行级、阅读标题块级、大纲条目级三侧同引），主题分级着色一处定义多处生效。其二，**强调语义只认显式标记**——条目一律常规字重（400），不继承标题级别的结构性加粗；仅显式 `**粗体**` 段加重，斜体/行内代码/删除线同理只由标记触发。其三，**透传集合 = 正文已支持的行内标记子集**——当前白名单为粗体/斜体/高亮/行内代码/删除线（`OutlineSpanKind`，提取与校验同源；#105 高亮已按同一机制接入），公式/行内颜色待正文支持后按同一白名单机制接入（提取处 `SPAN_KIND_BY_NODE` 加映射即可），大纲侧零额外设计；双链/链接显示别名/链接文字的纯文本，不可点。
- **CSS 片段导入与界面域样式约定（#129/#130/#133 落档）**：修改 CSS 片段依赖导入分析、远程（HTTPS）样式加载、CSP 装配或界面域样式入口前，必读 [docs/specs/css-snippets.md](docs/specs/css-snippets.md) 的「实施落档约定」节——导入形态学与 CSSOM 对齐、远程引用「完全不进本地面」语义、内置样式 `:where()` 零特异性等硬边界在其中。
- **可读行宽与双模式列布局约定（#174/#175 落档）**：修改双模式正文限宽、列居中、Live 行号列跟随、可读行宽设置，或触及 `--file-line-width` / `--vsidian-reading-max-width` / `--vsidian-live-preview-max-width` 变量前，必读 [docs/specs/viewport-width.md](docs/specs/viewport-width.md) 的「实施落档」节——双变量 #app 层同写、0 = 铺满零干预、设置与片段优先序、铺满态零位移与 #32 行号契约修订均在其中。
- **工作区引用索引扩展约定（#194–#202 落档）**：修改索引调度、排除语义、rename 通道、图片失效通道或快照格式前，必读 [docs/specs/vault-index-backlinks.md](docs/specs/vault-index-backlinks.md)——各票实施落档（#198 调度与排除、#199/#200 rename 双通道、#201 图片三层失效、#202 收口）、「已知边界」与「明确不包含」清单在其中；台账外边界不得顺手改。
- **统一右键菜单扩展约定（2026-09 菜单批次落档）**：新增或修改右键菜单项、簇、子菜单、覆写行为、安全降级矩阵或菜单图标接线前，必读 [docs/specs/context-menu.md](docs/specs/context-menu.md) 的「扩展约定（落档）」节——菜单项注册表与图标 key 表的两表同步、三步接入清单与「既有边界不得顺手放宽」清单（阅读/头区不接管、内置只隐藏不删、提示列只派生自键位注册表）均在其中。
- **悬停提示扩展约定（#300 落档）**：新增或修改悬停提示（新控件、新浮层内按钮、键位徽章）前，必读 [docs/specs/tooltip.md](docs/specs/tooltip.md) 的「接管机制」节——悬停词唯一承载属性是 `data-tooltip`（原生 title 已退役，防回潮扫描拦截），文案经 `bindLocale` 家族或动态写属性，带快捷键的操作走 `data-tooltip-keys` 结构化键位徽章（内部 `\n` 分隔、不做文字缀尾），观感与出现延迟经 `--vsidian-tooltip-*` 公开变量（styleContract tooltip 类目）。
- **引用块内表格扩展约定（#296 落档）**：新增或修改表格网格计划、行身份提取（`TableRowInfo`）、表格创建的容器前缀感知，或调整表格行前缀剥离口径（`parseTableDelimiter`/`tableRowCellsForColumns` 等调用点）前，必读 [docs/specs/blockquote-table.md](docs/specs/blockquote-table.md)——前缀语义单一口径、QuoteMark 放行边界（其余未知直接子节点仍整体降级）、结构编辑「补/消」前缀的既定决策与一期边界均在其中；台账外边界不得顺手改。
- **附加组件公开 API 维护（#362/#363 落档）**：新增或修改六组附加组件 API（发现与安装/页面 SDK/行为/设置/渲染提供者/命令菜单界面）的接口形状、语义、实验入口或发行状态前，必读 [docs/addons/developer-guide.md](docs/addons/developer-guide.md) 的「文档维护入口」节——语义清单与发行台账单一事实源在 `src/shared/addonApiCatalog.ts`（签名不手写第二份，条目指向各事实源模块的导出符号）；版本参考由 `npm run gen:addonapi` 生成、`npm run check:addonapi` 校验新鲜度（compile 链前置）；公开声明的编译期消费在 `test/addonApi/publicApiConsumer.ts`，导入面纪律由 `test/unit/addonApiSurface.test.ts` 钉住。签名/语义调整必须同步清单条目、重生成参考、更新消费样例与钉住断言；台账如实区分候选与已发布——未真正发行不得携带发布日期，实际发行是人工落账动作。**契约门禁（#363 T14）**：接口/语义/签名/台账的历史兼容由 `npm run check:addoncompat` 对照 git 锚定基线（`test/addon-api/baseline-bootstrap-1.json`）校验，CI job `addon-api-contract` 先跑 `npm run check:addonapi:baseline` 复验基线可信再跑契约检查；改检查器、基线、清单或门禁工作流前必读 [docs/specs/addons-api-gate.md](docs/specs/addons-api-gate.md)——基线重锚定与发行落账是 `--emit-baseline` 显式动作，须随变更同 PR 提交并独立说明理由。规则依据 [ADR-0012](docs/adr/0012-vsidian-addons-distribution-api-governance.md)「文档与兼容维护」与[规格 §7](docs/specs/vsidian-addons.md)。
- **用户可见文字一律 i18n**：所有面向用户的文字（webview 界面、设置页、宿主通知/确认框、package.json command title 与 displayName/description）必须经 `src/shared/locales/` 语言包与 `t()` 字典映射添加，禁止新增硬编码中/英文字面量；两语言包键集由编译期 parity 把关，回潮由 CI 防回潮扫描（源码 CJK 字面量契约测试）拦截。manifest 侧 `package.nls.*.json` 由构建脚本从字典生成，不在 JSON 里手写。

## 公开样式契约：Agent 修改约束（项目技能 style-contract）

修改编辑器 webview 的 DOM、类名、属性、CSS 变量、主题、渲染依赖或片段加载路径，以及修改样式指南、兼容测试、历史基线或相关 CI 时，先加载项目技能 **style-contract**（`.agents/skills/style-contract/SKILL.md`）并按其流程执行：修改前固定旧契约、修改中保留兼容与独立证据、弃用与移除期限工具化校验（`npm run check:stylecontract`）、完成条件与交付证据。纯业务逻辑且不影响呈现或样式入口的变更无需执行。结构化清单单一事实源在 `src/shared/styleContract.ts`；门禁远端配置见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)。

## 技术栈与构建（工单 #2 确立）

- **运行时**：TypeScript + CodeMirror 6（`@codemirror/state`、`@codemirror/view`、`@codemirror/commands`，单包组合，不用 `codemirror` 聚合包与 basicSetup/history——撤销栈归宿主文本管线）。阅读模式用 markdown-it（#8 起）；公式渲染 KaTeX 0.16.47 + `@vscode/markdown-it-katex` 1.1.2（#59，仅随包 woff2 字体）；Mermaid 11.12.2 独立产物按需懒加载（#60）；代码块卡片（#78–#85，规格 `docs/specs/code-block-card.md`）语法高亮为 Lezer 官方语言包 + `@codemirror/legacy-modes` StreamLanguage 统一引擎（`tok-*` 词表两端共用，`src/webview/codeHighlight.ts`），围栏表复用 `mermaidFencesField`，语言注册表在 `src/shared/codeLangs.ts`。
- **宿主端**（`src/extension.ts`、`src/host/`）：`CustomTextEditorProvider`，保存/dirty/Hot Exit 由 VSCode 文本管线自动处理；`TextDocument` 为权威文本，编辑经 `WorkspaceEdit` 写回。
- **webview 端**（`src/webview/`）：CM6 EditorView + `acquireVsCodeApi` 消息桥；`src/shared/` 为两端共享的消息协议单一事实源（不依赖 vscode/DOM）。协议约定 webview 全程 LF 坐标（CM6 内部把 `\r\n` 规范化为 `\n`，宿主侧 `NewlineCoordinator` 负责双向坐标与文本转换）。
- **构建**：esbuild 多产物——宿主 `out/extension.js`（node18/cjs/external vscode）、编辑器 webview `out/webview/main.js` 与设置页 webview `out/webview/settings.js`（#33；chrome118/iife，CSS 随 import 打包为同名 `.css`）；`npm run compile` 另跑 `tsc --noEmit` 做类型检查（esbuild 不查类型）。worktree 依赖预置：`node scripts/linkDeps.mjs <工作树>` 把 `node_modules` junction 到 `<父目录>/.deps/<lockfile哈希前12位>` 共享缓存（junction 在场禁 `npm ci/install`，防写穿缓存；真实 node_modules 在场时脚本中止不删）。
- **测试**：`npm run test:unit`（vitest + `node --test` 启动器契约，纯逻辑 + jsdom 控制器，无宿主依赖；`VSIDIAN_TEST_HOST_MODE=foreground` 跳过独立桌面探针）；`npm run test:browser`（Playwright headless Chromium 以原生键盘/IME 驱动生产控制器——**涉及 webview 输入/光标行为的变更合并前必跑**，首次需 `npx playwright install chromium`；`VSIDIAN_TEST_BROWSER_CHANNEL=msedge` 仅本机借 Edge 调试）；`npm run test:integration`（1.82.3 真宿主，fixture 由 `test/integration/fixtures.mjs` 统一生成，三条启动器共用 `testHost.mjs` 策略——Windows 默认独立桌面不抢前台，完整逐例输出与退出码自动落盘 `.vscode-test/` 报告（`integration-dev.log` / `integration-installed.log` / `settings-activation.log`），**复核与追查失败优先读报告，不为补看信息重跑**；手动自跑的验证命令日志（含退出码）统一落 `out/test/`）。`_test.*` 注入命令仅 `VSIDIAN_TEST_HOOKS=1` 时注册、宿主侧门控（webview 被动接收的分层设计与「勿误判未设防」辨析见 [docs/specs/integration-test-groups.md](docs/specs/integration-test-groups.md)「测试钩子与消息通道门控」节）。
- **浏览器测试调度与报告**：`npm run test:browser` 经 `test/browser/run.mjs` 默认三并发运行全部脚本（清单即 `names` 数组）；`-- --workers=1` 回退串行，`-- --suite=<名称>` 定向运行，`-- --no-reuse` 禁用本轮构建复用。每轮写入 `out/test/browser-runs/run-*/`（report.json / report.md / 逐脚本日志），任一失败整体非零、单脚本 120 秒超时。CI 无论成败均上传报告（artifact `browser-reports-a<attempt>`，attempt 从 1 起）——CI 失败时 `gh run view` 只有脚本名级结论，断言栈与逐脚本日志先 `gh run download <run-id> -n browser-reports-a<attempt>` 取报告，再决定是否本地复现。测量方法、收益与边界见 [浏览器测试调度实测](docs/perf/2026-09-browser-test-runner.md)。
- **集成测试分组与分片（2026-10-01 用户授权）**：本地默认全量，`VSIDIAN_ITEST_SHARDS=4` 可起四个独立便携宿主；CI 四片设置 `VSIDIAN_TEST_GROUP=core` 与 `VSIDIAN_TEST_SHARD=k/4`，第五组 `integration-sensitive` 独立运行 `VSIDIAN_TEST_GROUP=sensitive`（失败红灯、暂不纳入强制汇总）。完整名称名单、证据、报告留存与本地入口只维护于 [docs/specs/integration-test-groups.md](docs/specs/integration-test-groups.md)；分组不代表根因已排除，不自动扩大豁免。
- **历史契约门禁 job（#135）**：ci.yml 的 `style-contract` job 跑 `npm run check:stylecontract:baseline`（git 锚定基线复验，须在契约检查**之前**——先证检查器可信，再信检查结果）+ `npm run check:stylecontract`（八项全检查），变更统计写 step summary、报告经 artifact（`style-contract-report`）保留。checkout 须 `fetch-depth: 0` + `fetch-tags: true`（浅克隆即缺）；job 名是远端必需检查的 context 候选，改名视同变更保护规则。远端名单现状与授权后操作步骤见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)。
- **打包与安装态回归（#15）**：`npx @vscode/vsce package --no-dependencies` 产出 VSIX（esbuild bundle 自包含，不带 node_modules；`.vscodeignore` 排除 src/test/docs）。`node test/integration/runInstalled.mjs` 把 VSIX 经 `--install-extension` 装入隔离 profile 的 1.82.3 便携宿主（#255 下界矩阵），安装注册链路真实走通；宿主测试模式要求 `--extensionTestsPath` 依赖 `--extensionDevelopmentPath` 同时存在（1.86.2 实测缺则静默挂起，1.82.3 同型装配），故 dev path 指向安装解压目录——加载代码仍是 VSIX 产物而非仓库源码树——后跑同一集成套件。
- **性能测量**：`node test/perf/runPerf.mjs`（1千/1万/10万行、10 KB/100 KB/1 MB、超长行、图片密集与大围栏；报告写 `docs/perf/data/perf-report.json`）；档位数据与解读汇总在 [docs/perf/2026-09-mvp-performance-summary.md](docs/perf/2026-09-mvp-performance-summary.md)。
- **版本锁定**：依赖一律精确版本（无 `^`），提交 lockfile；`engines.vscode ^1.82.3` 与 `@types/vscode 1.82.0` 对齐（#255 降版；vsce 打包门禁强制 types ≤ engines，三启动器默认宿主同版由 testHost 契约钉住）。`@types/node` 锁 22.x（vitest 5 的 vite peer 要求数 >=20.19，类型不进产物，宿主代码仍按 Node 18 API 面编码）。

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
│   ├── addons/     # 附加组件开发者文档
│   │   ├── api-reference.md     # 公开 API 版本参考（生成）
│   │   ├── developer-guide.md   # 附加组件开发指南
│   │   └── example-repo-plan.md # 示例仓库准备说明
│   ├── adr/        # 架构决策记录
│   │   ├── 0001-vscode-186-remote-support.md                  # VSCode 兼容下界与远程支持决策
│   │   ├── 0002-wikilink-on-demand-resolution.md              # 双链按需解析不建持久索引
│   │   ├── 0003-source-text-dual-view-editor.md               # 基于源文本的双视图编辑架构
│   │   ├── 0004-stable-styling-contract.md                    # 一期建立稳定样式入口
│   │   ├── 0005-viewport-rendering.md                         # 全文模型与视口渲染分离
│   │   ├── 0006-rebrand-to-vsidian.md                         # 统一更名为 vsidian 的映射记录
│   │   ├── 0007-css-snippet-env-isolation.md                  # CSS 片段环境隔离决策记录（#131）
│   │   ├── 0008-workspace-reference-index.md                  # 工作区引用索引架构与存储选型
│   │   ├── 0009-referenced-document-views.md                  # 引用文档视图读写分离决策
│   │   ├── 0010-reference-edit-target-session.md              # 引用编辑的目标会话与历史归属
│   │   ├── 0011-reference-full-document-navigation.md         # 引用全文可达与锚点导航决策
│   │   ├── 0012-vsidian-addons-distribution-api-governance.md # 附加组件接入与API治理决策
│   │   ├── 0013-wikilink-completion-file-catalog.md           # 全文件登记与联想架构决策
│   │   └── 0014-vscode-query-matching-for-wikilinks.md        # VSCode 查询匹配复用决策
│   ├── agents/     # agent 操作约定
│   │   ├── domain.md        # 领域文档读取与维护约定
│   │   └── issue-tracker.md # GitHub Issues 操作约定
│   ├── design/     # 设计文档（选择器映射等）
│   │   ├── backlinks-panel-reference.png   # 反链面板形态参考图
│   │   ├── find-panel-icons-reference.png  # 查找面板图标参考图
│   │   ├── links-panel-icons-reference.png # 链环图标参考图（反链/出链）
│   │   ├── obsidian-selector-map.md        # Obsidian 选择器映射表
│   │   ├── outlinks-panel-reference.png    # 出链面板形态参考图
│   │   └── vsidian-addon-api.md            # 附加组件接口与装载技术方案
│   ├── features.md # README 功能与设置详解下沉页
│   ├── perf/…      # 性能实测数据与测量工具说明
│   ├── research/   # 技术调研报告
│   │   ├── data/                                  # 探针证据数据目录
│   │   │   ├── addon-v02-probe-results.json        # V02 探针证据数据
│   │   │   ├── appearance-probe-dark-custom.json   # 外观探针暗色轮证据
│   │   │   └── appearance-probe-light-default.json # 外观探针亮色轮证据
│   │   ├── obsidian-live-preview-editor.md        # Obsidian 技术栈与选型调研
│   │   ├── obsidian-viewport-rendering.md         # 视口渲染性能补充调研
│   │   ├── pdf-engine-compatibility-probe.md      # P3-02 PDF 引擎兼容性探针报告
│   │   ├── vscode-1823-host-route-probes.md       # P2-01 宿主路线探针结论
│   │   ├── vscode-addon-discovery.md              # 附加组件发现与调用边界调研
│   │   ├── vscode-native-text-appearance-probe.md # 原生文字外观复用探针报告
│   │   ├── vscode-quick-open-matching.md          # Ctrl+P 文件匹配源码核查
│   │   ├── vscode-search-view-internals.md        # VSCode 搜索视图内部源码核查
│   │   ├── vsidian-addons-v01-history-probe.md    # V01历史分组验证报告
│   │   ├── vsidian-addons-v02-page-sdk-probe.md   # V02 页面 SDK 探针结论
│   │   └── wikilink-completion-v01-probe.md       # V01 补 ID 与尽力撤销探针报告
│   ├── specs/      # 产品规格
│   │   ├── addons-api-gate.md                   # API 契约门禁 CI 接线规格
│   │   ├── anchor-navigation.md                 # 锚点跳转规格（标题/块引用/复制块链接）
│   │   ├── appearance-merge.md                  # 外观合并分页规格
│   │   ├── batch-2026-09-menu.md                # 右键菜单批次总览与决策回执
│   │   ├── batch-2026-09.md                     # 2026-09 开票批次总览
│   │   ├── batch-2026-10-settings-sections.md   # 2026-10 设置页批次实施树
│   │   ├── batch-2026-10-vscode-ops.md          # 2026-10 编辑器操作批次实施树
│   │   ├── batch-2026-10-vsidian-addons.md      # 附加组件验证与实施批次索引
│   │   ├── batch-2026-10-wikilink-completion.md # 双链输入联想实施批次
│   │   ├── blockquote-accent-bar.md             # 引用块紫色提示边条规格
│   │   ├── blockquote-table.md                  # 引用块内表格规格
│   │   ├── code-block-card.md                   # 代码块卡片功能规格
│   │   ├── code-language-sources.md             # 新词法来源许可与边界
│   │   ├── context-menu.md                      # 统一右键菜单规格（正文全域接管）
│   │   ├── css-snippets.md                      # CSS片段与样式兼容规格
│   │   ├── default-editor-guard.md              # 默认编辑器守护规格
│   │   ├── frontmatter-table.md                 # frontmatter 表格化规格
│   │   ├── graphic-code-block-interaction.md    # 图形化代码块交互规格
│   │   ├── hover-embed-phase2-tickets/…         # 二期票据正文与依赖
│   │   ├── hover-embed-phase3-tickets/…         # 三期票据正文与依赖
│   │   ├── hover-preview-embed.md               # 悬停预览与文档嵌入规格
│   │   ├── html-comment-support.md              # HTML 注释快捷键与呈现规格
│   │   ├── i18n.md                              # 全局 i18n 适配规格
│   │   ├── image-paste.md                       # 图片粘贴插入与资产文件夹规格
│   │   ├── image-popup.md                       # 图片弹窗查看与防误触规格
│   │   ├── integration-host-teardown-noise.md   # CI 收尾退出噪声边界（#211）
│   │   ├── integration-test-groups.md           # 四片强制与第五敏感组规格
│   │   ├── keybindings.md                       # 快捷键清单与默认值
│   │   ├── live-table-column-width.md           # Live 表格列宽规格
│   │   ├── manual-verification.md               # 人工验证清单
│   │   ├── mvp-issues.md                        # MVP GitHub Issue 索引
│   │   ├── mvp.md                               # MVP 规格主文档
│   │   ├── reference-view-group.md              # 引用视图设置组与跳转目标提示规格
│   │   ├── rich-text-paste.md                   # 富文本粘贴与分步撤销规格
│   │   ├── search-reveal.md                     # 外部搜索导航定位恢复规格
│   │   ├── settings-page-visual-refresh.md      # 设置页视觉刷新规格（#155）
│   │   ├── skeleton-screen.md                   # 编辑器初开骨架屏加载规格
│   │   ├── style-contract-gate.md               # 契约门禁 CI 接线与远端配置文档
│   │   ├── style-reference-i18n.md              # 样式参考条目双语化规格
│   │   ├── symbol-input.md                      # 符号输入与行内围栏扩展约定落档
│   │   ├── table-interaction-rework.md          # 表格交互重做规格
│   │   ├── toolbar-refresh.md                   # 工具栏刷新按钮与缓存刷新规格
│   │   ├── toolbar-view-toggle.md               # 工具栏双态切换按钮规格
│   │   ├── tooltip.md                           # 统一自绘悬停提示规格
│   │   ├── vault-index-backlinks.md             # 引用索引与反链实施规格
│   │   ├── viewport-width.md                    # 可读行宽与双模式列布局规格
│   │   ├── vsidian-addons-coverage.md           # 29 用户故事覆盖映射
│   │   ├── vsidian-addons-tickets/…             # 附加组件验证与实施票面
│   │   ├── vsidian-addons.md                    # 附加组件接入与公开API规格草案
│   │   ├── wikilink-completion-tickets/…        # 双链联想验证与实施票面
│   │   └── wikilink-completion.md               # 双链文件输入联想规格
│   └── trees/      # 文件树子视图承载目录
│       ├── perf.md # 性能实测归档视图
│       └── src.md  # 源码结构视图：三端全量展开
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
│   ├── addonApiCompatCheck.mjs   # API 契约门禁纯逻辑模块
│   ├── checkAddonApiCompat.mjs   # API 契约门禁 CLI
│   ├── checkStyleContract.mjs    # 历史契约兼容检查器 CLI
│   ├── demoAddonApiGate.mjs      # API 门禁负向演示脚本
│   ├── demoStyleContractGate.mjs # 契约门禁负向演示脚本
│   ├── genAddonApiRef.mjs        # 附加组件 API 参考生成脚本
│   ├── genNls.d.mts              # NLS 生成器类型声明
│   ├── genNls.mjs                # manifest NLS 文件生成脚本
│   ├── genStyleGuide.mjs         # 样式指南生成脚本
│   ├── linkDeps.mjs              # worktree 依赖预置脚本
│   ├── pdfBuildConfig.mjs        # PDF.js 双产物构建配置事实源
│   ├── quick-action-icons.py     # 快速操作图标生成与校验
│   ├── release.mjs               # 发布脚本：打包、包体检查与上传
│   └── styleContractCheck.mjs    # 契约检查纯逻辑模块
├── src/                   # 扩展源码
│   ├── extension.ts # 扩展激活入口
│   ├── host/…       # 宿主端实现
│   ├── shared/…     # 两端共享纯逻辑
│   └── webview/…    # webview 端实现
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
