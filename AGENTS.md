# vsidian

VSCode 扩展：在 VSCode 中提供类 Obsidian 的 Markdown 编辑体验。

> 功能范围与规格见 [docs/specs/mvp.md](docs/specs/mvp.md)、[docs/specs/](docs/specs/) 与 [docs/trees/specs.md](docs/trees/specs.md)；人工验证清单见 [docs/specs/manual-verification.md](docs/specs/manual-verification.md)；用户变更见 [CHANGELOG.md](CHANGELOG.md)。本文件是项目级 agent 规则的**单一入口**：横切约定常驻于此，领域落档正文在指针目标（specs 与项目技能）中维护——改动正文只改指针目标，不在本文件建副本。

## 约定

### 横切红线
- **通用工程规范**：提交、TDD、文件树维护遵循工程根 `D:\CODE\Project\AGENTS.md`。
- **CI 敏感期处置（用户授权，至 #684 清零）**：纯文档提交（`.md`/`.txt`）直推 `main`（`ci.yml` 自动跳过全量检查）；代码变更合并仍以全绿为准，仅[跟踪集合 #684](https://github.com/ONEGAYI/vsidian/issues/684)内的已知未定性抖动挂红不重跑不回滚。
- **插件设置入口**：用户设置统一在 Vsidian 自有设置页展示与修改，不复用 VSCode 设置中心；新增设置项须验证持久化、回显与生效。
- **用户可见文字一律 i18n**：webview、设置页、宿主提示及 `package.json` 命令标题/描述必须经 `src/shared/locales/` 与 `t()` 添加，禁止硬编码中/英文字面量；`package.nls.*.json` 由构建脚本生成。
- **视觉层断言（评审必查）**：呈现/样式/渲染类变更须断言用户可见结果（可见性、对齐、颜色），不能只测 DOM 存在性或几何坐标；**涉及呈现的新特性至少一条集成断言落在绘制层**（`view.state.paint` 探针），CSS 关键规则由契约测试钉住。
- **操作与快捷键注册**：可绑定操作须在 `src/shared/keybindings.ts` 评估并登记入口、默认绑定与生效模式（写操作仅 Live 正文覆盖宿主），支持显式清空与恢复默认且清空不因重启恢复。
- **大纲样式原则**：结构装饰与正文标题同源引用 `--vsidian-heading-color-1..6`；条目固定字重 400，强调与透传白名单仅由显式行内标记触发（`OutlineSpanKind` / `SPAN_KIND_BY_NODE`）。

### 领域落档指针（修改对应领域前必读目标章节）
- **附加组件公开 API（1.1.0 已稳定）**：修改发现/调用、公开 API、台账或门禁前，必读 [ADR-0012](docs/adr/0012-vsidian-addons-distribution-api-governance.md)、[开发者指南](docs/addons/developer-guide.md)「文档维护入口」及 [API 门禁规格](docs/specs/addons-api-gate.md)；事实源在 `src/shared/addonApiCatalog.ts`，改后同步 `npm run gen:addonapi` / `check:addonapi` / `check:addoncompat`。
- **公开样式契约**：修改 webview DOM、类名、CSS 变量、主题、片段加载路径，或样式指南、样式兼容测试、历史基线及相关 CI 时，加载技能 **style-contract**（`.agents/skills/style-contract/SKILL.md`）；结构化清单在 `src/shared/styleContract.ts`。修改检查器、历史基线或门禁工作流前，必读 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)（须先跑 `npm run check:stylecontract:baseline` 复验基线再跑 `npm run check:stylecontract`）。
- **UI 元素形态契约**：新增或修改自绘 UI 元素前，必读 [docs/specs/ui-patterns.md](docs/specs/ui-patterns.md) 并加载技能 **ui-patterns**（`.agents/skills/ui-patterns/SKILL.md`）。
- **图形化代码块**：改支持语言、按钮组、弹窗或导出前，必读 [docs/specs/graphic-code-block-interaction.md](docs/specs/graphic-code-block-interaction.md)「扩展约定（落档）」。
- **符号输入与行内围栏**：改符号对、成对行内标记、选区包裹、Tab 越界或 IME 组合输入前，必读 [docs/specs/symbol-input.md](docs/specs/symbol-input.md)。
- **frontmatter 表格**：改成型/降级、卡片或 Popover 编辑前，必读 [docs/specs/frontmatter-table.md](docs/specs/frontmatter-table.md)「实施落档约定」（事实源 `src/shared/frontmatterTable.ts`）。
- **CSS 片段导入与界面域样式**：改 `@import` 分析、HTTPS 加载或 CSP 前，必读 [docs/specs/css-snippets.md](docs/specs/css-snippets.md)「实施落档约定」。
- **可读行宽与双模式列布局**：改限宽、列居中或 `--file-line-width` 相关变量前，必读 [docs/specs/viewport-width.md](docs/specs/viewport-width.md)「实施落档」。
- **工作区引用索引**：改索引调度、排除、rename 通道、图片失效或快照前，必读 [docs/specs/vault-index-backlinks.md](docs/specs/vault-index-backlinks.md)。
- **短名补查与绝对路径引用**：改解析规划、路径类型设置、跨根引用或绝对资源根前，必读 [docs/specs/markdown-shortname-links.md](docs/specs/markdown-shortname-links.md)「#556 实施落档」（事实源 `src/shared/vaultLink.ts`）。
- **原生 HTML 与文档样式**：改块级 HTML、行内 HTML、文档 `<style>` 作用域或 HTML/CSS 资源归属前，必读 [docs/specs/html-rendering.md](docs/specs/html-rendering.md) 对应实施落档节（事实源 `src/shared/htmlBlock.ts`、`htmlInline.ts`、`docStyle.ts`、`htmlResource.ts`）。
- **统一右键菜单**：增改菜单项、簇、子菜单或图标接线前，必读 [docs/specs/context-menu.md](docs/specs/context-menu.md)「扩展约定（落档）」。
- **悬停提示**：增改控件或浮层按钮提示前，必读 [docs/specs/tooltip.md](docs/specs/tooltip.md)「接管机制」（唯一载体 `data-tooltip`，禁用原生 `title`）。
- **图片尺寸与拖动**：改尺寸后缀、显示尺寸写入或拖动手柄前，必读 [docs/specs/image-resize.md](docs/specs/image-resize.md)（事实源 `src/shared/imageSize.ts`）。
- **引用块内表格**：改表格网格计划、行前缀剥离或容器感知前，必读 [docs/specs/blockquote-table.md](docs/specs/blockquote-table.md)。
- **正文标题折叠**：改折叠区间、gutter/阅读态交互或落点展开接线前，必读 [docs/specs/heading-fold.md](docs/specs/heading-fold.md)（事实源 `src/webview/headingFold.ts`）。
- **PDF 导出**：改固定输入 payload、导出页装配、CDP 后端、Remote SSH 执行或批量重试前，必读 [docs/specs/pdf-export.md](docs/specs/pdf-export.md)。

## 技术栈、构建与测试

- **架构红线**：TypeScript + CodeMirror 6（单包组合，**禁 `codemirror` 聚合包与 `basicSetup`/`history`**，撤销归宿主 `WorkspaceEdit`）；`src/shared/` 为两端纯逻辑共享层（禁 `vscode`/DOM 依赖）；webview 全程 LF 坐标，宿主 `NewlineCoordinator` 负责双向转换。
- **构建与依赖**：esbuild 多产物（`npm run compile` 串联 `tsc --noEmit`）；依赖锁精确版本（无 `^`），`engines.vscode ^1.82.3` 与 `@types/vscode 1.82.0` 对齐，`@types/node` 锁 22.x 但**宿主代码仍按 Node 18 API 面编码**；worktree 用 `node scripts/linkDeps.mjs <工作树>` 链接共享 `.deps` 缓存（**junction 在场禁 `npm ci/install`**）。
- **测试门禁**：命令清单见 `package.json`。
  - 涉及 webview 输入/光标行为变更，合并前必跑 `npm run test:browser`（三并发，`out/test/browser-runs/`）。
  - 集成测试按 `VSIDIAN_TEST_GROUP=core|sensitive` 分组与 `VSIDIAN_ITEST_SHARDS=4` 分片，完整名单、耗时预算与 `_test.*` 钩子门控见 [docs/specs/integration-test-groups.md](docs/specs/integration-test-groups.md)；复核失败优先读 `.vscode-test/` 或下载 CI artifact 报告，不为补看信息重跑。
  - 性能基线与测量见 [docs/perf/2026-09-mvp-performance-summary.md](docs/perf/2026-09-mvp-performance-summary.md)（`node test/perf/runPerf.mjs`）。

## 流程与协作入口

- **打包与发布**：加载技能 **release**（`.agents/skills/release/SKILL.md`）；包体红线在 `scripts/release.mjs`。
- **Issue 跟踪**：GitHub `ONEGAYI/vsidian`，约定见 [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)。
- **领域文档**：单一领域上下文，维护约定见 [docs/agents/domain.md](docs/agents/domain.md)。

## 文件树（简版速览）

```
<!-- file-tree:tree:begin 由脚本渲染，禁止手改 -->
vsidian/
├── .agents/               # agent 技能与本地配置
│   └── skills/ # 已部署 agent 技能
│       ├── ai-icon-sheet-to-svg/ # AI单图图标转SVG技能
│       ├── file-tree/            # file-tree 技能部署实例
│       ├── release/…             # 打包与发布流程项目技能目录
│       ├── style-contract/…      # 样式契约修改约束项目技能目录
│       └── ui-patterns/…         # UI元素形态契约项目技能目录
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
├── CHANGELOG-API.md       # 附加组件 API 变更日志
├── CHANGELOG.md           # 面向用户的版本变更日志
├── CLAUDE.md              # Claude 专属规则导入入口
├── CONTEXT.md             # 领域语言与产品边界事实源
├── docs/                  # 项目文档根
│   ├── addons/     # 附加组件开发者文档
│   │   ├── api-reference.md     # 公开 API 版本参考（生成）
│   │   ├── developer-guide.md   # 附加组件开发指南
│   │   └── example-repo-plan.md # 示例仓库准备说明
│   ├── adr/…       # 架构决策记录
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
│   ├── images/     # 文档图片
│   │   └── readme/ # 中英 README 展示图
│   ├── perf/…      # 性能实测数据与测量工具说明
│   ├── research/…  # 技术调研报告
│   ├── specs/…     # 产品规格
│   └── trees/      # 文件树子视图承载目录
│       ├── perf.md  # 性能实测归档视图
│       ├── specs.md # 产品与实施规格视图：全量展开
│       └── src.md   # 源码结构视图：三端全量展开
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
├── scripts/…              # 仓库工具脚本目录
├── src/                   # 扩展源码
│   ├── extension.ts # 扩展激活入口
│   ├── host/…       # 宿主端实现
│   ├── pdfExecutor/ # PDF 本机执行端扩展
│   │   ├── extension.ts     # PDF 执行端扩展入口
│   │   ├── package.json     # PDF 执行端清单模板
│   │   └── resourceQueue.ts # 执行端挂起资源队列
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
