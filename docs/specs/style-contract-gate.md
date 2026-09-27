# 历史 CSS 契约门禁：CI 接线与远端必需状态（#135）

状态：2026-09-27 实施。规格出处：[#127](https://github.com/ONEGAYI/vsidian/issues/127)「自动兼容与发布门禁」、[css-snippets.md](css-snippets.md) 同名节；检查器本体是 #134（`npm run check:stylecontract`）。本文档记录 CI/发布接线、防绕过机制的诚实边界、远端保护配置实读结果，以及**待用户授权的远端配置操作步骤**。

## CI 接线（代码侧，已交付）

`.github/workflows/ci.yml` 新增独立 job **`style-contract`**（job 名即 required status check 的 context 名，稳定、独立可查），位于 unit 与 integration_shard 之间。步骤序是防线核心——**先证检查器可信，再信检查结果**：

| 序 | 步骤 | 作用 |
| --- | --- | --- |
| 1 | checkout（`fetch-depth: 0` + `fetch-tags: true`） | verify-baseline 需从 git 对象读 v0.4.0 固定 SHA 的映射表，发布记录交叉验证需 refs/tags；浅克隆两者皆缺 |
| 2 | `npm run check:stylecontract:baseline` | 从 git 对象复验候选基线文件与锚定内容零差异——候选篡改历史基线在契约检查**之前**即失败 |
| 3 | 变更暴露（写入 step summary） | 打印检查器/基线/门禁工作流文件相对 PR 基点的 diff 统计到 PR Summary；变更不失败，但使「检查器/基线变更须独立说明审查」（技能 style-contract 硬约定）对评审可见 |
| 4 | `npm run check:stylecontract` | 全量八项检查（基线比较 + 指南一致性 + 弃用期限 + 发布记录三源交叉） |
| 5 | upload-artifact（`if: always()`） | 报告 `out/test/style-contract-report.json` 无论成败均保留（沿用 browser job 报告上传先例） |

失败保留：契约检查失败时 job 失败，报告经 artifact `style-contract-report` 保留；verify-baseline 失败时后续步骤不执行，失败明细在步骤日志中（verify-baseline 无 JSON 报告，退出码与 stderr 为证据）。

## 发布前复验（release 侧，已交付）

`.github/workflows/release.yml` 的 `release` job 在 `npm run release` **之前**插入同一检查链：`check:stylecontract:baseline`（基线复验）→ `check:stylecontract`（30 天弃用期限 / 发布跨度 / 兼容性复验）→ `npm run release`。任一步失败即 job 失败，**不打包、不产出 Release**——与现有 VSIX 发布链路同一条，不另建。复验报告经 artifact `style-contract-report-release` 保留。checkout 补 `fetch-tags: true`（原有 `fetch-depth: 0` 保留，供 release 脚本的 tag 校验与契约复验共用）。

## 防绕过机制与诚实边界

候选分支（含自动编码代理）可修改工作流、检查器与基线本身。分层防线如下，**每层的边界如实声明**：

1. **git 锚定复验**（verify-baseline）：候选改基线 JSON 抹历史承诺 → 从固定 SHA（v0.4.0 tag = 75c3df7）的 git 对象重新解析映射表比对，多一行少一行都失败。边界：候选同时改检查器（弱化复验逻辑）可绕过本地防线——工作流无法自证检查器不被改。
2. **变更可见性**（step summary + PR）：`.github/workflows/`、`scripts/checkStyleContract.mjs`、`scripts/styleContractCheck.mjs`、`test/style-contract/` 的变更在 PR 的 Files changed 与 style-contract job summary 中可见，配合技能 style-contract「检查器/CI/基线变更须独立列出理由与保护效果」约定，使静默替换需要显式评审放行。边界：可见性只是审查辅助，不构成强制。
3. **远端必需检查 + 分支保护**（根治，**已配置**，2026-09-27）：`style-contract` 已加入 main 分支保护的必需检查（配置后读回验证 `contexts = ["unit","integration","style-contract"]`，其余保护项原样），候选删除该 job 或使其失败都不能合并（保护规则在 GitHub 服务端判定，不随候选分支变化）。边界（2026-09-27 实读）：`enforce_admins: false`——管理员（仓库 owner）直接推送仍可绕过分支保护；`allow_force_pushes: false` 已关闭。

本地工作流无法对抗的组合（诚实记录）：候选分支删除 `style-contract` job、删除检查器脚本或 `continue-on-error` 短路检查步骤。对抗手段只剩远端配置：必需检查（job 删除后 context 缺失 → PR 无法满足保护规则，2026-09 起分支保护对缺失 context 的默认行为是挂起等待而非放行）+ 工作流文件变更经 PR 审查（`pull_request` 触发的 workflow 使用 PR merge ref 的 `.github/` 内容，直接 push main 被保护拦截）。

## 远端保护配置实读（2026-09-27，只读）

读取命令与原始 JSON 留存于 `logs/remote-branch-protection-2026-09-27.json` 与 `logs/remote-rules-2026-09-27.json`（logs/ 不入 git，本节为入库记录）：

- `gh api repos/ONEGAYI/vsidian/branches/main/protection` → 200：
  - `required_status_checks.contexts = ["unit", "integration"]`（app_id 15368，GitHub Actions）——与 ci.yml 头注释及预期一致
  - `enforce_admins.enabled = false`；`allow_force_pushes = false`；`allow_deletions = false`；`required_pull_request_reviews` 未配置
- `gh api repos/ONEGAYI/vsidian/rules/branches/main` → `[]`（未使用 rulesets，走经典 branch protection）
- **`style-contract` 不在必需名单**（预期否：本次授权不含远端修改）

以上为**配置前**实读快照。2026-09-27 经用户授权执行第 6 节方式二（API 全量替换，保留既有两项与全部保护项），配置后读回验证：`required_status_checks.contexts = ["unit","integration","style-contract"]`，`strict: false`、`enforce_admins: false`、`restrictions: null`、`allow_force_pushes: false` 与配置前一致。

## 操作步骤（已于 2026-09-27 执行）

前提：仓库 admin 权限；授权范围仅此配置变更，不涉其他保护项。两种方式等价：

**方式一（GitHub UI）**：Settings → Branches → Branch protection rules → `main` → Require status checks to pass before merging → Search → 输入 `style-contract`（需该 job 在默认分支至少成功运行一次后才可搜索到）→ 勾选加入 → Save changes。

**方式二（API，gh CLI）**：PUT 是**全量替换**——`contexts` 数组务必保留现有 `unit`、`integration`（遗漏即解除既有保护）；四个必填字段按当前实读值提供（`restrictions` 与 `required_pull_request_reviews` 传 `null` 维持未配置现状）：

```bash
gh api -X PUT repos/ONEGAYI/vsidian/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["unit", "integration", "style-contract"]
  },
  "enforce_admins": false,
  "restrictions": null,
  "required_pull_request_reviews": null
}
EOF
```

配置后核验（只读）：`gh api repos/ONEGAYI/vsidian/branches/main/protection --jq '.required_status_checks.contexts'` 应含三个 context。

可选加固（由用户决策，非本票要求）：`enforce_admins: true` 使管理员直推同样受必需检查约束（代价是紧急修复须走 PR 或临时豁免）；`required_pull_request_reviews` 要求 PR 批准，配合第 3 层防线。

## 负向演示证据（工单标志性要求）

可重复脚本 `scripts/demoStyleContractGate.mjs`（`node scripts/demoStyleContractGate.mjs`，退出码 0 = 全部符合预期），在系统临时目录构造隔离候选树、真实运行检查器 CLI（与 CI job 同一入口与受保护来源形态），不触碰仓库工作树、不留破坏性提交：

- **场景 A（候选改实现）**：删除公开入口清单条目 `live-heading-line` → exit 1，失败码 `entry-missing:live-heading-line`（附 `guide-stale`，指南一致性同因失败）
- **场景 B（候选改历史基线）**：基线 `sourceRows` 删一行 → `--verify-baseline` exit 1，失败码 `baseline-row-extra`（CI job 第一道防线，排在契约检查之前）
- **场景 C（恢复态）**：真实仓库树原样 → exit 0，八项检查零失败

最近一轮证据：`logs/style-contract-gate-demo-2026-09-27.md` 与 `logs/style-contract-demo-scenario-a-2026-09-27.json`（logs/ 不入 git，重跑脚本即再生）。「候选删除检查步骤/工作流」的负向验证不可在本地自证——该组合由第 3 层（远端必需检查，已于 2026-09-27 配置生效）对抗，见上节诚实边界。

## 汇总验证与人工验收

#135 分支（含 #128–#134 全量合并树）的汇总回归——unit 全量、browser 全量 23 脚本、integration 分片、`check:stylecontract`、`vsce package` 与安装态回归（`runInstalled.mjs`）——结果与日志路径见本文档变更说明（提交正文）及 `logs/` 下对应报告。自动化通过不代替人工验收：真实 IME/物理鼠标/视觉观感的待验清单累积在 [manual-verification.md](manual-verification.md)（各实现票已分别登记，本票不重复罗列；CSS 片段各票的人工验收缺口含真实 SSH 环境与联网字体服务两项，自动化无法替代）。
