# 集成测试四片强制检查与第五敏感组

状态：2026-10-01 用户批准本方案，实施于独立工作树。实现基线为 `0b3fad4831a986ce6ecc587fa4c742deb6fc6f5f`（PR #268 合并提交），原清单 244 项。分组不修复产品行为，不修改用例断言，也不表示已排除产品缺陷。

## 划分与归属

`test/integration/suite/caseSelection.ts` 的 `SENSITIVE_CASES` 是敏感名单的单一事实源，按完整名称精确匹配；每项登记原因、跟踪票和原始证据。不按 Issue 编号或领域关键词批量排除。

| 第五组成员 | 证据与待查问题 |
| --- | --- |
| #129 被导入 CSS 文件修改自动刷新、删除降级与缺失恢复 | [main 失败与相关代码通过对照](https://github.com/ONEGAYI/vsidian/issues/272#issuecomment-5933902595)；文件变化至样式生效链路超时，延迟与事件丢失尚未区分 |
| #202 百文件增删的队列收敛与索引守恒 | [失败运行](https://github.com/ONEGAYI/vsidian/actions/runs/36864132224)；批量增收敛超时，PR #271 的通过运行约 4 秒，根因未定 |
| #223 Live 挂载与源码显隐、IME 编辑撤销闭环与双零 dirty | [失败 attempt](https://github.com/ONEGAYI/vsidian/actions/runs/36875022608/attempts/2)；缺失卡仍为 loading 时断言错误态，采样与状态推进时序待查 |
| #244 真宿主递归直接来源、三层、设置热更与未保存刷新 | [#272](https://github.com/ONEGAYI/vsidian/issues/272)；同提交可约 3 秒通过或耗尽 30 秒，传播链路待查 |

名单之外继续强制检查：包括 #129 其他导入契约、#222 限高设置，以及已加固的 #215 视口锚点。浏览器构建冲突与滚动恢复失败属于 browser job，不并入本组。

保持原始切片位置：先应用既有 `VSIDIAN_TEST_CASES` 多子串筛选，记录筛选结果中的位置，再按组选择和 `k/N` 取模。移入第五组的用例不占执行项，但其位置不被压缩；后续普通用例不会因本次分组迁移到其他宿主。

基线清单的四片 core 数量为 **60 / 60 / 59 / 61**，第五组为 **4**。此数字仅是基线快照；自动契约按实时清单验证覆盖完整、互不重复，不以固定总数限制未来新增用例。登记成员消失或重复时立即失败，要求显式维护名单。

## CI 语义

- `integration_shard` 仍是四个独立 runner，各设置 `VSIDIAN_TEST_GROUP=core` 与 `VSIDIAN_TEST_SHARD=k/4`。
- 新 job `integration-sensitive` 是第五组，设置 `VSIDIAN_TEST_GROUP=sensitive`，不注入 shard；单独创建 fixture、便携目录及真实 1.86.2 宿主。
- 必需检查 `integration` 只汇总 `integration_shard`，不依赖敏感组。保留远端现有 `unit / integration / style-contract` 名称和保护配置。
- 第五组不用 `continue-on-error`，不自动重试，不放宽断言。失败保留 job 红灯、完整逐项结果和非零退出码，整轮 workflow 可为 failure；第五组不在必需名单，故不阻断上述必需检查已通过的 PR。
- 核心分片上传 `integration-core-s<片号>-a<attempt>`，第五组上传 `integration-sensitive-a<attempt>`。无论成败均尝试上传，重跑不覆盖旧 attempt 的证据。

此处“强制”表示纳入现有必需检查，不承诺这些用例已经全部稳定；“敏感”表示基于证据的临时豁免，不能用来自动归类未来的新失败。

## 本地入口与报告

默认 `npm run test:integration` 仍跑全部用例。`VSIDIAN_ITEST_SHARDS=4` 仍可把默认全量分为四个本地宿主，安装态与设置激活入口不改变。

PowerShell 单跑第五组：

```powershell
$env:VSIDIAN_TEST_GROUP = 'sensitive'
npm run test:integration
Remove-Item Env:VSIDIAN_TEST_GROUP
```

PowerShell 跑四片强制组：

```powershell
$env:VSIDIAN_TEST_GROUP = 'core'
$env:VSIDIAN_ITEST_SHARDS = '4'
npm run test:integration
Remove-Item Env:VSIDIAN_TEST_GROUP
Remove-Item Env:VSIDIAN_ITEST_SHARDS
```

`all` 为默认组，显式组名只接受 `all / core / sensitive`。定向筛选未命中当前组即报错；切片后合法的空片仍允许。开发态 all/core 的报告沿用 `.vscode-test/integration-dev.log` 或 `integration-dev-s<片号>.log`；sensitive 使用 `integration-sensitive.log` 或 `integration-sensitive-s<片号>.log`。报告记录分组、计划数量、逐项 START/PASS/FAIL/TIME 和宿主退出码；首次运行即落盘，复核只读报告。

## 门禁调整与兼容证据

本次 CI 修改的理由是把用户批准的四项临时豁免显式隔离，同时保留检测、失败信号和报告。#129 只迁移上述动态刷新用例，其余 CSS 导入、历史片段绘制与兼容检查仍在 core。独立 `style-contract` job 的基线复验、检查器变更暴露、全量检查、报告上传及发布链路均保持原有语义。

本次不修改公开选择器、CSS 变量、渲染实现、样式清单或历史基线。已发布契约锚点为 v0.4.0（`75c3df79074bdeaec0f02a38d40124f0cd66f857`），未发布 CI 行为以实施基线 `0b3fad4831a986ce6ecc587fa4c742deb6fc6f5f` 对照；通过 `check:stylecontract:baseline` 与 `check:stylecontract` 复验。

## 验证与退出条件

分组契约覆盖真实 runner 入口、五组并集与互斥、原位置保持、错误配置拒绝、名单成员改名/消失/重复、敏感失败继续汇总，以及 CI 依赖图与报告接线。启动器契约验证独立报告和非法组在启动宿主前拒绝。真实宿主分别跑 core 四片与 sensitive，不以本地通过宣称 Linux CI 已稳定或用户已验收。

每项修复后，保留其现有断言，在同一提交的多次 CI 中验证，再从名单移除并恢复 core 归属。新增或扩大豁免须有独立日志与明确决定，不能因单次失败直接移入。#272 继续跟踪 #129/#223/#244 诊断，#202 按原票登记的索引链路跟踪；分组本身不关闭这些问题，也不构成推送、发布或合并授权。

## 本轮本地验证留证

日志位于本次工作树 `logs/`，宿主逐项报告位于 `.vscode-test/`，两者不入 Git。构建读取本工作树源码并产出 `out/`；真实宿主复用已缓存的 1.86.2 可执行文件，为本工作树另建便携目录与 fixture。首次指定缓存路径时发现新工作树尚无 `.vscode-test/`，在测试准备阶段创建目录后运行，未修改既有启动行为。

- 编译与类型检查通过；完整单测为 4879 项 Vitest 与 113 项 Node 启动器等契约全部通过（`ci-group-compile-final.log`、`ci-group-unit-final.log`）。
- TDD 红绿、五组覆盖及接线契约均留证于 `ci-group-red*.log/json`、`ci-group-green*.log` 和 `ci-group-contracts.log`；两个独立只读审查均无可行动问题，记录于 `ci-group-review.md`。
- 历史样式基线复验、当前八项契约检查与文件树严格检查通过（`ci-group-style-baseline.log`、`ci-group-style-current.log`、`ci-group-tree-check.log`）。
- core 四宿主首轮完整执行 240 项，239 过、1 挂：#215 视口锚点在初始状态等待中超时。首次完整失败保留于 `integration-dev-s4.log` 和 `ci-group-core-host-ready.log`，未改变名单、用例或断言。
- 单宿主对照使用原有 `all + 4/4` 入口；这 61 项与 core 第四片完全相同，全部通过（`integration-dev.log`、`ci-group-shard4-control.log`）。对照只证明失败可随运行条件变化，不证明 #215 根因已修复。
- 第五组单独执行四项，全部通过（`integration-sensitive.log`、`ci-group-sensitive-host.log`）。远端 Linux CI 尚未运行，本轮未推送或修改分支保护。
