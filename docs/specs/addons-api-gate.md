# 附加组件 API 契约门禁：CI 接线与远端必需状态（#363 T14）

状态：2026-10-08 实施。规格出处：[#363](https://github.com/ONEGAYI/vsidian/issues/363)「附加组件 T14——可信历史基线、兼容门禁与负向演示」；检查对象是 T13（#362）建立的公开 API 单一事实源。本文档记录检查器架构、可信基线两条路径、CI 接线、防绕过机制的诚实边界、负向演示矩阵，以及**待用户授权的远端必需检查配置操作步骤**（当前未配置，不得表述为已启用）。

## 检查器架构

与 CSS 契约门禁（[style-contract-gate.md](style-contract-gate.md)）同分层先例——纯逻辑模块与 CLI 分离，基线独立于当前声明：

| 层 | 资产 | 职责 |
| --- | --- | --- |
| 事实源（T13） | `src/shared/addonApiCatalog.ts` | 语义清单 + 发行台账 + `validateAddonApiCatalog` 自洽校验（首版六组 22 条目；2026-10 首轮扩展组合后七组 33 条目） |
| 独立基线 | `test/addon-api/baseline-bootstrap-1.json` | 从 **git 锚点对象**派生的条目 / 签名声明文本 / 台账快照 + 完整性清单；不信任候选树文件 |
| 纯逻辑模块 | `scripts/addonApiCompatCheck.mjs` | 比较器、期限校验、基线信任验证与全套编排（可被 node --test import） |
| CLI 壳 | `scripts/checkAddonApiCompat.mjs` | `--verify-baseline` / 全检查 / `--emit-baseline`（发射基线）三入口 |
| 契约测试 | `test/addon-api/checkAddonApiCompat.test.mjs` | 45 例（node --test，挂 `npm run test:unit`）：负向矩阵 + 隔离 git fixture |
| 负向演示 | `scripts/demoAddonApiGate.mjs` | 真实 CLI 退出码的隔离验证（证据可重复再生） |
| CI job | `.github/workflows/ci.yml` 的 `addon-api-contract` | 步骤序：基线复验 → 变更暴露 → 契约检查 → 报告 artifact |

命令表：

```bash
npm run check:addonapi:baseline   # 从 git 对象复验基线（先证检查器可信）
npm run check:addoncompat         # 全检查（JSON 报告落 out/test/addon-api-compat-report.json）
node scripts/checkAddonApiCompat.mjs --emit-baseline --anchor <ref>   # bootstrap 重锚定
node scripts/checkAddonApiCompat.mjs --emit-baseline --anchor <tag> --mode release --api-version <semver>  # 发行落账
node scripts/demoAddonApiGate.mjs # 负向演示（退出码 0 = 全部场景符合预期）
```

`--root` / `--baseline` / `--json` 可指向仓库外受保护来源（#135 同型）；全程无网络请求。

## 可信基线：bootstrap 与 release 两条路径

**先验证基线可信，再运行兼容检查**（CI 步骤序的核心）。验证语义：从锚点 git 对象重新派生条目集合、台账快照与全部签名声明文本，与基线文件**精确比对**（多一条、少一条、一字段漂移都失败）；锚点对象不可达（无 `.git` / 浅克隆 / 伪造 SHA / 标签消失）一律失败，不静默接受。

**当前状态澄清（2026-10-18，#582）**：发行台账已记录实际发行的 API 1.1.0 / 1.2.0，1.0.0 仍保留原候选记录；下表及首发流程中「尚未发行」和首个 1.0.0 的未来式表述保留为 2026-10-08 的历史设计记录，不代表当前发行状态。现用基线仍采用 bootstrap 提交锚点，保留已发行记录并继续复验兼容承诺。生成器沿用的 bootstrap `meta.note` 中「首个真实发行前」属于旧模板措辞，不改变实际台账；本票不修改检查器、模板或基线模式，也不伪造 release 标签。

| 路径 | 锚点 | 额外核实 | 当前状态 |
| --- | --- | --- | --- |
| **bootstrap**（显式初始基线） | `baseline-bootstrap-1.json` 的 `meta.anchor` 指向实际实施提交（非发行锚点） | 从 git 对象重派生并逐项复验 | **当前生效**；条目、签名与候选台账数量以该快照为准 |
| **release**（发行基线） | 发行 tag + 台账 `released` 记录 + 实际发布日期 | tag 指向 SHA、锚点台账状态为 released、基线日期与台账一致（三者矛盾即失败） | 未启用——Vsidian 尚未发行任何稳定 API；经隔离 git fixture 验证（见下） |

首个稳定 API（1.0.0）真实发行时的落账流程：人工把台账改 `status: 'released'` 并填实际发布日期 → 打发行 tag → `--emit-baseline --mode release --api-version 1.0.0 --anchor <tag>` 提交新基线（同 PR、独立说明理由）。**发行是人工落账动作**：候选版本不得冒充发行状态（`catalog-selfcheck` 拦截候选携带日期；`baseline-release-not-released` 拦截伪造的发行锚点）。

两条路径的独立证据：契约测试与演示脚本的**隔离 git fixture**（测试内 `git init` 临时仓库 + `fixture/` 前缀标签）——bootstrap 发射→复验通过、release 发射→复验通过、基线被改→失败、tag 被删→失败。fixture 标签不冒充真实 SDK 发行（票面「范围外」）。

bootstrap 锚点是提交而非 tag 的边界：合并采用 merge commit（非 squash）时对象恒可达（`fetch-depth: 0`）；若未来改用 squash 合并，须先给锚点补真实 tag 并以 release 模式重锚定，否则 CI 将因锚点不可达失败（fail-closed，不降级）。

## 检查分项与失败码

全检查十个分项（候选清单加载失败时依赖分项显式记败不隐藏，`ok` 恒 false）：

| 分项 | 拦截对象 | 关键失败码 |
| --- | --- | --- |
| catalog-selfcheck | T13 清单自洽（含台账诚实性：候选不带日期、已发布必有日期） | `catalog-selfcheck` |
| entry-comparison | 删除接口、收回执行端、分层降级、跨组迁移、改组绑定 | `entry-missing`、`endpoints-shrunk`、`layer-downgraded`、`group-changed`、`experimental-entry-changed` |
| （同上）语义层 | 改写目标、收回或改写语义字段 | `purpose-changed`、`semantics-field-retracted`、`semantics-text-changed` |
| （同上）类型层 | 收回签名源（删符号 / 换模块） | `signature-source-retracted` |
| （同上）验证关联 | 收回测试关联 | `verification-retracted` |
| release-history | 改写 / 删除已登记台账记录（状态、日期、实验清单） | `release-history-mutated` |
| removal-deadlines | 提前移除（双门槛）、非法版本号 | `removed-without-deprecation`、`removal-too-early`、`removal-minor-span-insufficient`、`ledger-version-malformed` |
| signatures | 签名符号消失、声明文本变化 | `signature-symbol-missing`、`signature-declaration-changed` |
| verification-files | 关联测试文件被删 | `verification-file-missing` |
| api-version-binding | 宿主版本与台账脱钩、台账超前宿主 | `api-version-not-in-ledger`、`ledger-ahead-of-host`、`api-version-malformed` |
| reference-freshness | 版本参考漂移（check:addonapi 同口径） | `reference-stale` |
| guard-manifest | 检查器资产 / 指南 / 消费面被删 | `guard-file-missing`、`guard-anchor-missing` |

基线复验（`--verify-baseline`）失败码：`baseline-anchor-unreachable`、`baseline-tag-unreachable`、`baseline-tag-sha-mismatch`、`baseline-entry-extra` / `baseline-entry-missing` / `baseline-entry-field-mismatch`、`baseline-release-mismatch`、`baseline-declaration-mismatch`、`baseline-release-not-released`、`baseline-release-date-mismatch`。

**弃用期限双门槛**（`ADDON_API_REMOVAL_RULE` 的机械执行）：移除须「距弃用版本实际发布满 30 天」**且**「弃用版本之后已发行 ≥ 2 个后续 API 次版本」两项同时满足；补丁版本、候选版本、移除版本自身（等待期不能由执行移除的版本自己充当）均不计入跨度。版本跨度按台账（独立 API 版本）计算——检查器不读取 Vsidian 本体版本与 CHANGELOG，结构上不可能把本体版本当 API 跨度。

**语义冻结口径**：目标 / 语义字段 / 签名声明文本按**字节冻结**——自由文本无法机械区分「扩展」与「收窄」，任何变化都要求显式重锚定（`--emit-baseline` 同 PR 提交 + 独立说明），使收窄不可能静默通过。允许的演进：新增条目、扩展执行端、新增语义字段、追加签名源、追加台账版本、experimental 升稳定候选。

**T05（#544）候选基线重锚说明**：实施提交 `9510d9899bc4e146ef4929af7395f1d3b6d0e8c5` 为 `VsidianAddonPageSdk` 增加可选 `refViews` facet，并新增只读浮窗契约条目。旧成员、既有语义与发行台账不删减；原基线 `8e13e78f` 可信复验通过，候选比较仅因 SDK 声明新增字段触发 `signature-declaration-changed`。按既有字节冻结规则，使用 `--emit-baseline --anchor 9510d9899bc4e146ef4929af7395f1d3b6d0e8c5` 从已提交 git 对象重新发射，再运行基线复验及完整兼容检查。独立 API 仍为未发行的 1.0.0 候选，不补发行日期，也不修改检查器或豁免规则。批次集成其他接口后须针对最终组合提交再次复验，必要时显式重锚。

**T02/#542 候选重锚理由（2026-10-16）**：粘贴规则条目 `paste-rules-register` 落地正则捕获组、all/any/not 条件与 children 槽子规则集（P-U07/P-U08）。旧候选基线如实拒绝语义改写与签名文本变化（`out/test/t02-compat-pre-reanchor.log`，8 项失败：coordinates/lifecycle/errors 三处语义文本改写＋`AddonPasteRuleMatch`、`ADDON_PASTE_RULES_MAX_PER_ADDON`、`ADDON_PASTE_RULES_MAX_DEPTH`、`validateAddonPasteRuleDeclarations`、`orderAddonPasteRules` 五个签名声明文本变化——扩展均为可选字段/新增分支/文档注释与函数体实现，公开调用形状未收窄，语义改写是把「属后续批次、显式拒绝」的占位表述更新为已实现能力与预算边界）。在功能、测试与公开消费用例进入提交 `abc2257` 后，以 `--emit-baseline --anchor HEAD` 显式发射并另行提交基线。不改检查器、不豁免条目、不伪造 API 已发行，API 台账仍为 1.0.0 候选。

**T07/#546 候选重锚理由（2026-10-15）**：新增宿主主题注册与页面主题环境，扩展 `AddonEnableContext` / `VsidianAddonPageSdk`，并落实 ADR-0017 已批准的 renderer-selection 主题例外及声明语言范围。旧候选基线如实拒绝这些签名和冻结语义变化（`out/test/t07-resume-compat-before-anchor.log`，6 项失败）；在功能与公开消费用例进入提交 `59555c05` 后，以 `--emit-baseline --anchor HEAD` 显式发射并另行提交基线。保留旧锚点 git 对象及失败报告，新锚点复验和兼容全检查均通过（`t07-resume-api-baseline.log` / `t07-resume-compat.log`）；不改检查器、不豁免条目、不伪造 API 已发行，API 台账仍为 1.0.0 候选。最终汇总分支还需对合并后的公开声明整体重锚核对。

**T06/#545 候选重锚理由（2026-10-16）**：组件容器只读引用嵌入为 `AddonSdkRefViewsFacet` 追加 `mountEmbed` 成员并新增 `ref-views-embed` 条目。旧候选基线如实拒绝该签名文本变化（`signature-declaration-changed`，重锚前失败报告 `out/test/t06-addoncompat.log` 与 `out/test/addon-api-compat-report.json`）；在功能、测试与文档同步进入提交 `5eb3f39d` 后，以 `--emit-baseline --anchor 5eb3f39d` 显式发射（35 条目 / 22 签名模块 / 候选台账）。追加成员与新增条目属允许演进（SDK 侧 facet 由平台提供、组件只消费），旧接口、历史锚点对象与失败证据保留；不改检查器、不加豁免、不伪造发行，API 仍为 1.0.0 候选。组合分支合并后须再次复验，必要时重锚。

**四票组合重锚理由（2026-10-15）**：T01/T03/T05/T07 以真实 merge 保留各实施锚点，组合实施提交为 `8cf6a681`。旧 T01 基线可信复验通过，候选比较记录 7 项预期变化：主题选择目标与自动接管语义两项、宿主登记/页面 SDK/文档导航/渲染选择相关签名五项（`out/test/addon-batch-takeover/api-before-reanchor.json`）。按字节冻结规则执行 `--emit-baseline --anchor 8cf6a681`，从已提交组合对象发射 33 条目、21 签名模块及候选台账快照，随后独立提交并复验。重锚保留旧接口、历史对象和失败证据，不修改检查器、不加豁免，API 1.0.0 仍为未发行候选。

**组合后 T01 契约修复重锚（2026-10-15）**：`7eb4dfc3` 修正真实槽声明判定，并按已批准规格移除整数优先级的额外私有幅度限制。公开调用形状未变，但现有声明提取器对导出校验函数保留完整文本，因此优先级校验实现变化使 `validateAddonPasteRuleDeclarations` 单项触发 `signature-declaration-changed`；其余检查通过，失败证据为 `out/test/addon-batch-takeover/final-api-before-fix.json`。按现有规则以包含修复的 `9c03461b` 显式发射新候选基线，同步生成参考；仍为 33 条目、21 签名模块和未发行的 1.0.0，不改检查器或增加豁免。新锚点可信复验与完整兼容结果见 `final-api-baseline.log` / `final-api-compat.json`。

**独立审查后主题回落修复重锚（2026-10-15）**：两轴审查发现选中主题失效后，同语言普通提供者仍可接管。`b252bb79` 为 `RendererThemeSelectionContext` 增加可选的不可用主题语言范围，修正 `selectEffectiveRenderers` 的内置回落；`f28a3e3d` 进一步保留当前唯一首选的派生语言 profile 快照，覆盖组件冷启动未登记时的既有选择。SDK 调用面、旧条目和发行台账不变。旧锚点可信复验通过，候选检查只在上述接口和选择函数文本报两项 `signature-declaration-changed`，证据为 `out/test/addon-batch-takeover/review-fixes-compat-red.json`。按字节冻结规则从已提交对象 `f28a3e3d` 显式重锚；33 条目、21 模块及候选 1.0.0 保持，生成参考、基线可信复验和十项兼容检查通过（`review-fixes-baseline.log`）。不改检查器、不加豁免，不把审查修复表述为实际 API 发行。

**两票并行重锚合并后的组合重锚（2026-10-16）**：T02（#542）与 T06（#545）从同一主线切出并各自重锚候选基线（锚 `abc22572` / `5eb3f39d`），两侧基线互不含对方新增符号，合并时手工融合无意义。第二批次集成分支真实 merge 合入 T06（组合提交 `7cfbb8b3`）后，旧 T06 侧基线可信复验通过，候选比较如实记录 8 项预期失败——全部为 T02 侧符号（coordinates/lifecycle/errors 三处语义文本改写＋`AddonPasteRuleMatch`、`ADDON_PASTE_RULES_MAX_PER_ADDON`、`ADDON_PASTE_RULES_MAX_DEPTH`、`validateAddonPasteRuleDeclarations`、`orderAddonPasteRules` 五个签名声明文本变化，`out/test/t06-merge-compat-pre-reanchor.log`，与 T02 单票重锚时的失败清单一致，无第三方漂移）。按字节冻结规则从已提交合并对象执行 `--emit-baseline --anchor 7cfbb8b3`，发射 35 条目 / 22 签名模块及候选台账快照，随后独立提交并复验。重锚保留两侧旧锚点 git 对象与失败证据，不修改检查器、不加豁免，API 1.0.0 仍为未发行候选。T04 合入后须对最终组合再次整体复验，必要时重锚。

**#582 页面语言能力重锚理由（2026-10-18）**：运行时、公开消费、文档及异常隔离回归已进入实际远端组合实施对象 `8b948c2e01257ba6d4e58542d8b682664fbf9b27`，其完整树与本轮独立规范、规格两轴审查通过的组合实现一致。公开增量为两种页面共用的 `AddonLocaleFacet` 与 `VsidianAddonPageSdk` 的可选只读 `locale` 成员。旧 `dc7cd3b6ea9b8d9192be1f89bf353d6593ed0547` 基线在该对象的工作树中可信复验通过，实际候选仅因 SDK 声明新增可选成员触发一项 `signature-declaration-changed`，其余九项检查通过（`out/test/582-final-pre-reanchor-trust.log`、`out/test/582-final-pre-reanchor-compat.json`）。按字节冻结规则，执行 `--emit-baseline --anchor 8b948c2e01257ba6d4e58542d8b682664fbf9b27` 从该已提交对象显式生成基线，再将基线和本说明另笔提交在其后，保证实际锚点为最终分支可达祖先。新快照增加 `page-locale` 条目与 facet 声明，更新 SDK 声明；原有 35 条目、其余声明、完整性清单及三条发行台账不改写，仍为 22 个签名模块。保留旧锚点、功能提交和重锚前失败证据，不修改检查器、不加豁免、不调整版本或发布日期。API 1.2.0 的已发行历史不包含本新增能力；能力记入 Unreleased，下一次实际发行须按新增能力提升 API 次版本。重锚前 node 恢复态夹具按旧基线复制验证文件，因此同时报告新 locale 测试缺失；生成新基线收录该条目后自然补齐，不修改夹具或检查规则。

**#590 设置按层显式值重锚理由（2026-10-18）**：功能实现（`AddonSettingsGetSnapshot` 新增可选 `userValues`/`workspaceValues`、runtime `get()` 装配透传）、单测与公开消费样例钉住进入提交 `e5dd0eef`，台账条目改写、CHANGELOG-API Unreleased 与规格落档随后进入提交 `42e66f9a`（完整 `42e66f9a094c8989aca152303d39d7fffabbac8e`）。公开增量为设置读取快照的两个可选成员——旧成员、既有语义与发行台账不删减；`settings-context` 条目的 purpose 与 semantics.coordinates 按「get 附两层显式值」扩展属目标与语义字段字节变化，连同 `AddonSettingsGetSnapshot`/`AddonSettingsContextApi`（get 注释扩写）两项签名声明文本变化，共 3 项预期失败（重锚前失败证据 `out/test/590-compat-pre-reanchor.log` 同轮运行，非清单文件留存）。按字节冻结规则，功能与文档均已进入提交后执行 `--emit-baseline --anchor 42e66f9a094c` 从已提交 git 对象显式发射，基线复验与完整十项兼容检查随后通过。新快照保持 36 条目 / 3 条发行台账 / 22 签名模块，不修改检查器、不加豁免、不调整版本或发布日期。能力记入 CHANGELOG-API Unreleased，下一次实际发行按新增能力提升 API 次版本；API 1.2.0 的已发行历史不包含本新增能力。

**#593 IME 定稿 replaced 语义扩展重锚理由（2026-10-18）**：运行时（liveInstance 组合期通用净变更材料与补发推导）、单测（liveInstanceBehaviorDrive 新增替换选区与迟入组合两用例）、真宿主浏览器回归（addonT07Behaviors 新增 4a 选区场景、第 4 节补纯塌缩 null 断言）、契约文档（addonBehaviors 注释、catalog 语义条目、developer-guide、api-reference 重生成）与 CHANGELOG-API Unreleased 条目进入功能提交 `5032edbd`。公开变化为取值范围放宽：IME 定稿补驱动的 `replaced` 从「恒 null（#399 边界）」扩展为组合期净变更推导（起点坐标系被组合覆盖文本；纯插入与迟入组合仍 null）——类型形状与既有成员不变，`behaviors-register` 条目 semantics.coordinates 语义文本与 `AddonInputContext` 签名声明文本（JSDoc）随之改写。旧基线（锚 `42e66f9a`）可信复验通过，候选比较如实拒绝上述变化（`signature-declaration-changed`，重锚前失败报告 `out/test/addon-api-compat-report.json`）。按字节冻结规则执行 `--emit-baseline --anchor 5032edbd` 从已提交对象显式发射，基线与本说明另笔提交在其后，保证锚点为分支可达祖先。新快照保持 36 条目 / 3 条发行台账 / 22 签名模块；不改检查器、不加豁免、不伪造发行状态。能力记入 CHANGELOG-API Unreleased，属兼容性扩展，下一次实际发行按新增能力提升 API 次版本；API 1.2.0 的已发行历史不包含本能力。

## CI 接线（代码侧，已交付）

`.github/workflows/ci.yml` 新增独立 job **`addon-api-contract`**（job 名即 required status check 的 context 名），与 `style-contract` 同序同型——**先证检查器可信，再信检查结果**：

| 序 | 步骤 | 作用 |
| --- | --- | --- |
| 1 | checkout（`fetch-depth: 0` + `fetch-tags: true`） | verify-baseline 需从 git 对象读锚点提交的清单与签名源原文；浅克隆两者皆缺 |
| 2 | `npm run check:addonapi:baseline` | 从 git 对象复验基线与锚定内容零差异——候选篡改基线在契约检查**之前**即失败；锚点不可达同样失败 |
| 3 | 变更暴露（写入 step summary） | 打印检查器 / 基线 / 清单 / 指南 / 门禁工作流相对 PR 基点的 diff 统计；变更不失败，但须在 PR 描述独立说明（重锚定与发行落账是显式动作） |
| 4 | `npm run check:addoncompat` | 全量十项检查 |
| 5 | upload-artifact（`if: always()`） | 报告 `out/test/addon-api-compat-report.json` 无论成败均保留（名称带 attempt 号，防 rerun 覆盖） |

失败保留：契约检查失败时 job 失败，报告经 artifact `addon-api-contract-report-a<attempt>` 保留；verify-baseline 失败时后续步骤不执行，退出码与 stderr 为证据。

## 防绕过机制与诚实边界

候选分支（含自动编码代理）可修改工作流、检查器与基线本身。分层防线（每层边界如实声明）：

1. **git 锚定复验**（verify-baseline）：候选改基线 JSON 抹历史承诺 → 从锚点 git 对象重新派生比对，多一条少一条都失败。边界：候选同时改检查器（弱化复验逻辑）可绕过本地防线。
2. **变更可见性**（step summary + PR）：检查器 / 基线 / 清单 / 指南 / 工作流的变更在 PR Files changed 与 job summary 可见，配合「检查器/CI/基线变更须独立列出理由」约定，使静默替换需要显式评审放行。边界：可见性只是审查辅助，不构成强制。
3. **远端必需检查 + 分支保护**（根治，**待授权未配置**，见下节）：必需检查在 GitHub 服务端判定，候选删除 job 或使其失败都不能合并。

本地工作流无法对抗的组合（诚实记录）：候选删除 `addon-api-contract` job、删除检查器脚本或 `continue-on-error` 短路检查步骤。对抗手段只剩远端配置。

## 远端保护配置（待授权，未配置）

**当前状态（2026-10-08）**：远端必需检查名单（实读于 style-contract-gate.md 2026-09-27 记录）为 `["unit", "integration", "style-contract"]`——`addon-api-contract` **不在名单**。配置前，其失败只显示在 PR 状态区，**不阻塞合并**（不得表述为已阻止合并或已启用保护）。把本 job 加入必需名单需仓库 admin 权限与用户授权，方式二选一：

**方式一（GitHub UI）**：Settings → Branches → Branch protection rules → `main` → Require status checks to pass before merging → Search → 输入 `addon-api-contract`（需该 job 在默认分支至少成功运行一次后才可搜索到）→ 勾选加入 → Save changes。

**方式二（API，gh CLI）**：PUT 是**全量替换**——`contexts` 数组务必保留现有三项（遗漏即解除既有保护）：

```bash
gh api -X PUT repos/ONEGAYI/vsidian/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["unit", "integration", "style-contract", "addon-api-contract"]
  },
  "enforce_admins": false,
  "restrictions": null,
  "required_pull_request_reviews": null
}
EOF
```

配置后核验（只读）：`gh api repos/ONEGAYI/vsidian/branches/main/protection --jq '.required_status_checks.contexts'` 应含四个 context。配置前其余保护项以当时实读值为准（PUT 全量替换，四个必填字段按实读值提供）。

## 负向演示证据（工单标志性要求）

可重复脚本 `node scripts/demoAddonApiGate.mjs`（退出码 0 = 全部符合预期），在系统临时目录构造隔离候选树与隔离 git fixture、真实运行检查器 CLI（与 CI job 同一入口），不触碰仓库工作树、不留破坏性提交：

| 场景 | 破坏 | 预期（均实测符合） |
| --- | --- | --- |
| A 删除接口 | 清单删条目 `manifest-declaration` | exit 1，`entry-missing` |
| B 收窄参数/结果 | 签名声明 `ADDON_IDENTITY_MANIFEST_VERSION = 1 → 2` | exit 1，`signature-declaration-changed` |
| C 改变只读/目标或故障语义 | 目标文本 + 语义文本改写 | exit 1，`purpose-changed` + `semantics-text-changed` |
| D 篡改基线 | 基线条目字段被改 | `--verify-baseline` exit 1，`baseline-entry-field-mismatch`（CI 第一道防线） |
| E 遗漏指南 | 删 `docs/addons/developer-guide.md` | exit 1，`guard-file-missing` |
| F 提前移除 | 台账双门槛未满 + 条目物理删除 | exit 1，`removal-too-early` + `removal-minor-span-insufficient` + `entry-missing` |
| G 两条基线路径 | 隔离 git fixture：bootstrap / release 发射→复验；篡改基线 | 两路径 exit 0/0；篡改 exit 1 |
| H 恢复态 | 真实仓库树原样 | exit 0 |

证据写入 `logs/addon-api-gate-demo-<日期>.md` 与失败报告 JSON 副本（logs/ 不入 git，重跑脚本即再生）。「候选删除检查步骤/工作流」的负向验证不可在本地自证——该组合由远端必需检查（待授权）对抗，见上节诚实边界。

## 汇总验证与人工验收

T14 分支的汇总回归——`npm run compile`、`npm run test:unit`（新增 45 例契约测试 + 既有防回归）、负向演示重放、`npm run check:stylecontract`（样式门禁独立仍绿）——结果与日志路径见本文档变更说明（提交正文）及 `out/test/t14-*.log`。自动化通过不代替人工验收；附加组件各票的人工验收缺口累积在 [manual-verification.md](manual-verification.md)，本票新增的待验项（远端配置授权、首个真实发行时的 release 落账演练）见票面 t14.md 回填。
