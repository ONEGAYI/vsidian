---
name: style-contract
description: 在 vsidian 仓库修改编辑器 webview 的 DOM、类名、属性、CSS 变量、主题、渲染依赖或 CSS 片段加载路径，或修改样式指南、样式兼容测试、历史基线、契约检查器及相关 CI 工作流时使用：公开样式契约的修改约束——修改前固定旧契约、修改中保留兼容与独立证据、弃用与移除的期限规则、完成条件与交付证据。纯业务逻辑且不影响呈现或样式入口的变更不适用。
---

# 公开样式契约修改约束

**触发范围**：修改编辑器 webview 的 DOM、类名、属性、CSS 变量、主题、渲染依赖或片段加载路径，以及修改样式指南、兼容测试、历史基线或相关 CI 时适用。纯业务逻辑且不影响呈现或样式入口的变更无需执行本节专项检查。

（本技能 2026-09-27 自 AGENTS.md「公开样式契约：Agent 修改约束」节迁入，AGENTS.md 留触发指针；内容未改。）

## 事实入口

[样式 ADR](docs/adr/0004-stable-styling-contract.md)记录决策，**结构化清单 `src/shared/styleContract.ts`（#132 起单一事实源，115 条；#133 起界面域逐项核实完毕）记录现有入口与生命周期**（旧手写映射表已退位为指向清单的迁移说明），[CONTEXT.md](CONTEXT.md)记录片段产品边界。别名桥实现同源表在 `src/shared/obsidianAlias.ts`（发射侧只引该模块，避免清单文档数据进 webview bundle）；界面域渲染验证探针表在 `src/shared/chromeContract.ts`（webview 采集侧只引该模块）；用户指南由清单生成（`npm run gen:styleguide`，compile 链前置，产物入库、一致性由 `test/unit/styleGuideGen.test.ts` 以 `--check` 钉住——改清单后须重跑并提交产物）；渲染验证经 `cssProbe.obsidianAliases`（正文域，探针属性 outline-color）与 `cssProbe.chromeSelectors`（界面域，探针属性为自定义属性 `--vsidian-chrome-probe`——不可见且与 outline-color/text-decoration-color 两套既有探针正交，同一元素挂多套探针类时零层叠串扰，规则形态由 `test/unit/chromeContract.test.ts` 钉住）。

下述行为约束立即适用；**历史契约本地检查器已随 #134 落地**（`npm run check:stylecontract`：独立基线 `test/style-contract/baseline-v0.4.0.json`（v0.4.0 tag 固化快照）对照候选清单比较 + 弃用期限校验 + 别名桥实现一致性 + 指南一致性 + 完整性自检，反规避负向测试与基线驱动旧片段渲染验证在 `test/style-contract/checkStyleContract.test.mjs` 与集成用例「历史基线旧片段渲染验证」；`check:stylecontract:baseline` 从 git 对象复验基线）。target 比较按**类名 token 只增不减**判定（token 消失/替换即改名，括注追加子类/收起态说明放行——#133 数据修正形态）；基线 `lifecycleExemptions` 与 `entryComparisonExemptions` 两键登记**逐条目豁免**（先例：var-heading-accent 期限豁免、mode-toggle「基线承诺从未兑现于任何发布版且有 git 证据」的双层纠错豁免，理由见基线 meta.provenance；豁免不豁免 entry-missing——条目物理删除仍失败，新增豁免须在变更说明中独立列出理由与保护效果）。

**合并必需状态与发布前复验已随 #135 接线**：CI 新增 `style-contract` job（ci.yml；步骤序为 verify-baseline 复验 → 检查器/基线变更暴露到 PR summary → 全量契约检查，报告无论成败经 artifact 保留），release job 在 `npm run release` 前跑同一检查链（失败即不打包不产出 Release）。诚实边界：**远端 main 分支保护必需名单已纳入 style-contract（2026-09-27 经用户授权配置并读回验证：unit/integration/style-contract）**——其失败即阻止合并；边界：enforce_admins:false，管理员（owner）直推仍可绕过分支保护。防绕过机制分层说明见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)（负向演示脚本 `scripts/demoStyleContractGate.mjs` 可重复重跑）。本地工具无法对抗候选分支删除检查器/基线本身（边界与接口见基线 meta.boundary）。

## 修改前：固定旧契约

1. 列出本次受影响的公开入口、适用视图与状态。公开入口包括文档承诺的选择器、变量及必要的 DOM 关系；保留类名但换到错误节点、改变变量作用域或使旧选择器无法命中，同样属于破坏。不要把所有内部类名一概当作公开接口。
2. 记录用于对照的已发布版本及提交 SHA，从该版本读取相关入口和历史片段。未发布的已有约定另以目标分支固定提交为基线；不得仅以当前工作分支重写后的清单证明兼容。历史材料缺失时明确记录缺口，保留旧入口，不能据此宣布“无兼容要求”。
3. 映射表与实现矛盾时核实历史记录和实际渲染；不得为迁就当前实现，直接删去文档承诺或将已公开入口降为内部接口。

## 修改中：保留兼容与独立证据

- 默认保留旧选择器与变量语义，优先通过别名或适配层承接内部重构；别名必须实际命中原有内容，不能只留空节点、无效 CSS 或字符串。
- 新增公开入口须补齐用途、模式、状态、示例及实际效果验证。只改单一事实源 `src/shared/styleContract.ts`（含正文域逐项渲染验证：probe.css 探针规则 + `OBSIDIAN_ALIAS_PROBES` 表 + 集成/浏览器断言三处同源），经 `npm run gen:styleguide` 更新指南产物，禁止另建手写副本；承诺 Obsidian 原名兼容（direct 级）必须同时在 `src/shared/obsidianAlias.ts` 登记别名并在别名探针表登记验证（`test/unit/styleContract.test.ts` 钉住两表与条目 aliasTargets 一致）。
- 禁止为消除失败而删除旧片段、跳过旧用例、降低断言强度、把旧选择器替换成新选择器，或从当前实现重新生成历史期望值。旧断言确有错误时，保留原始基线与失败证据，单列纠错依据和替代验证，不得混作普通重构。
- 兼容检查器、历史基线、CI 工作流的修改须在变更说明中独立列出理由与保护效果；不得通过关闭检查、调整过滤条件或移除必需状态掩盖失败。更改远端保护配置仍遵循用户授权边界。

## 弃用与移除

- 默认长期兼容。确需移除时，先在发布版本中公开弃用声明、替代写法与迁移示例；保留弃用记录，不能删除清单条目以抹去历史。
- 至少经过两个后续次版本且从弃用版本实际发布时起满 30 天，才允许显式移除。例如 0.2.x 弃用，最早 0.4.0 且满 30 天；补丁版本不计次版本，单纯抬高 package.json 版本号不能替代发布过程。跨主版本不得据此自动豁免迁移期。
- PR 和发布前均需提供弃用版本、实际发布日期、后续版本记录、替代入口及旧片段迁移验证。缺少证据或条件未满足时保留兼容入口；到期不自动删除，也不自动授权发布。
- **期限规则已工具化（#134）**：上述条件由 `npm run check:stylecontract` 对照**基线固化发布记录**（tag→SHA + CHANGELOG 日期快照，与候选 CHANGELOG/git tag 交叉验证，矛盾即失败）自动校验——改日期、跳版本号、发布记录缺项不能绕过（29/30 天边界与各规避场景有负向测试钉住）；「弃用声明须含实际发布版本 + 替代写法」同为机器校验项。新版本发布后应更新基线快照并单独评审。

## 完成条件与交付证据

- 对受影响的历史片段，在候选实现的真实浏览器或宿主中验证预期样式及可见结果，并覆盖相关视图、模式切换和视口重新挂载；只检查类名存在、DOM 数量或几何坐标不足以宣布兼容。
- 按影响范围运行现有 CSS 契约与绘制层测试；涉及输入或光标时遵循仓库 AGENTS.md 的浏览器必跑约定。长耗时检查首次即保留日志及退出码。纯规则文档修改仅做内容、链接与差异检查，不为流程添加无意义运行测试。
- 交付说明必须列出受影响入口、基线版本/SHA、保留或弃用方式、验证报告及未验证项。检查受限时如实标记，不把代理自检当作用户验收；自动化未落地前按上述过程提供人工核对证据，不虚构命令或 CI 保障。
- 自动门禁已接入（#135）：「候选分支同时改掉实现、清单和测试仍被独立历史基线拦住」经 `scripts/demoStyleContractGate.mjs`（真实 CLI 隔离演示，可重复）与 #134 反规避负向测试钉住，兼容检查已接入 CI `style-contract` job 与发布前复验。该 job 已加入远端必需名单（2026-09-27 配置读回验证），失败即阻止合并；管理员直推的绕过边界与操作记录见 [docs/specs/style-contract-gate.md](docs/specs/style-contract-gate.md)。
