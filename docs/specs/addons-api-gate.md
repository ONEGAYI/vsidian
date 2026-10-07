# 附加组件 API 契约门禁：CI 接线与远端必需状态（#363 T14）

状态：2026-10-08 实施。规格出处：[#363](https://github.com/ONEGAYI/vsidian/issues/363)「附加组件 T14——可信历史基线、兼容门禁与负向演示」；检查对象是 T13（#362）建立的公开 API 单一事实源。本文档记录检查器架构、可信基线两条路径、CI 接线、防绕过机制的诚实边界、负向演示矩阵，以及**待用户授权的远端必需检查配置操作步骤**（当前未配置，不得表述为已启用）。

## 检查器架构

与 CSS 契约门禁（[style-contract-gate.md](style-contract-gate.md)）同分层先例——纯逻辑模块与 CLI 分离，基线独立于当前声明：

| 层 | 资产 | 职责 |
| --- | --- | --- |
| 事实源（T13） | `src/shared/addonApiCatalog.ts` | 六组 22 条目语义清单 + 发行台账 + `validateAddonApiCatalog` 自洽校验 |
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

| 路径 | 锚点 | 额外核实 | 当前状态 |
| --- | --- | --- | --- |
| **bootstrap**（显式初始基线） | 提交 `abcbfdd7`（T13 集成分支落地树，非发行锚点） | — | **当前生效**：`baseline-bootstrap-1.json`（22 条目 / 12 签名模块 / 台账候选快照） |
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
