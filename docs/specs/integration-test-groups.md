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

## 测试钩子与消息通道门控（`_test.*`）

扩展注册 `onegayi.vsidian._test.*` 辅助命令供集成测试观测/注入，仅 `VSIDIAN_TEST_HOOKS=1` 时注册。测试消息通道是**宿主侧门控、webview 侧被动接收**的分层设计：`_test.*` 注入命令（含向 webview 转发 `table.test.key` / `task.test.click` / `reading.test.image` 等）在宿主侧受 `VSIDIAN_TEST_HOOKS` 门控；webview 侧这些消息分支不做二次门控——webview 面板的消息源只有扩展自身（`panel.webview.postMessage`），封住注入源即封住入口。**勿误判为 webview 未设防**：这不是漏加门控，而是分层设计的既定边界。

## #272 传播诊断与采样修复（2026-10-02）

**已确认两项测试采样问题**。#223 的 CI attempt 2 在 731ms 时直接断言缺失卡应为 error，实际仍为 loading；原等待条件只等待三张成功卡，没有等待缺失卡的终态。现改为四卡中三张 content、一张 error 后再检查各卡明细。真实管理器按成功回包先到、缺失回包后到的顺序验证，旧等待条件红、新条件绿。

#244 在本轮 Windows 真宿主再次耗尽 30s（30919ms），首次失败快照证实：C 未保存版本 2 的文档变更、失效广播、重读和回包应用在 **370ms** 内完成。快照同时存在两张 `../two/C`，第一张属于隐藏 Live 根内的递归 Reading 子卡（总块数 3，挂载 0）；另一张属于当前 Reading 根（总块数 3，挂载 3）。原 `.find(host !== 'live')` 误选第一张。`host` 描述卡片自身的挂载适配，不能代表祖先正文模式；新增探针 `rootHost` 区分顶层正文归属，#244 按 Reading 根选择目标。该字段只在观测回报中存在，不增加 DOM 属性或改变递归视图行为。双根管理器的可控回包回归保留 `[0, 3]` 挂载对照，旧筛选红、新筛选绿。

**该本机 #244 样本可以排除传播事件丢失**；历史 CI #244 样本没有链路观测，不能据此认定全部同源。#129 watcher 至样式生效、browser `cssSnippets` 滚回顶部后的标题挂载仍未定性。既有敏感名单、等待预算和失败退出码保持原有语义；本轮不启用自动重试，不据本机通过恢复 core 归属。

### 自动留证与读取方法

敏感用例在执行前通过宿主 `_test.setDiagnostics` 开启观测，结束后关闭并清空。该命令和 `_test.getDiagnostics` 仅在 `VSIDIAN_TEST_HOOKS=1` 注册；webview 按既有宿主门控模式被动接收开关。默认不记录事件，阅读视图的观测回调仅开启时装配，不增加 watcher、刷新或 rAF 调度。

每个记录器保留最近 256 条事件，带本记录器顺序号 `seq`、毫秒时间戳 `at`、阶段 `stage` 和有限状态字段 `data`；字符串截至 192 字符、每事件最多 12 个字段，淘汰数量写入 `dropped`。只记录请求身份、版本、目标路径和状态，不记录正文、修改文本或资源 URL。失效报告最多收录 8 个面板、每面板 32 张卡片。协议拒绝无界或非法观测载荷。

集成失败在公共面板清理之前输出 `[集成测试][DIAGNOSTICS]` 后的 JSON，沿用已有逐项报告与 CI artifact 留存。`panels[].cached=true` 表示最后一次真实 `view.state` 回报，不伪装成失败瞬间的新鲜采样；用例自己的 finally 可能已经清理片段目录，应结合日志时间顺序读取。`host.send.*` 表示尝试出站，`webview.receive.*` 才证明消息已到达。`hover.applied.consumed=true` 表示回包配对被消费，仍需卡片版本/块数等现场证据判断结果。

| 待查链路 | 依次读取的阶段及现场 |
| --- | --- |
| #244 未保存刷新 | `document.changed` → `hover.invalidate`（含接收会话数量）→ `host.send.hover.invalidated` → `webview.receive.hover.invalidated` → `webview.send.hover.request` / `host.receive.hover.request` → 两端 `hover.result` → `hover.applied`；按 `reqId + instanceId` 关联，并核对面板身份、直接来源、目标版本及 `rootHost` |
| #129 CSS 热更 | `snippets.fs` → `snippets.state`（原因、列表与入口版本）→ `snippets.broadcast` → `webview.receive.snippets.snapshot` → `snippets.outcome`；对照面板 `css` 绘制读值。入口 load/error 回报不能单独证明所有嵌套规则已生效 |
| 阅读回顶挂载 | `reading.scroll` → `reading.schedule` → `reading.frame` → `reading.update` → `reading.window`（期望首尾、实际挂载首尾和数量）；`reading.hidden` 表示本次无可用布局 |

browser `cssSnippets` 也开启同一 webview 记录器，等待超时时先输出 `[browser][DIAGNOSTICS]`，包含当前值、最多 16 条 pageerror、阅读窗口和标题数量，再抛出原等待错误。现场采样最多等 1s；采样失败单列，不吞原错误、不重试业务步骤。原 CI `cssSnippets.phases.jsonl` 仅有 build/launch，无法补出当时业务阶段；下次从现有 browser artifact 的 `cssSnippets.log` 读取新增快照。

`rootHost` 表示整张卡片树的根容器，取值为 `live / reading / hover`；嵌套卡自身以 Reading 方式渲染时，仍继承根容器归属。悬停弹窗优先按 `.vsidian-hover-popup` 祖先标为 `hover`，不能因没有 Live 祖先就归为 Reading。#244 的采样按 `rootHost=reading` 选择可见阅读树，排除同目标的隐藏 Live 子树和悬停弹窗副本。

事件不存在只有在观测已启用、对应时间段仍完整且缓存足够新时，才支持定位断点；`dropped > 0` 或无新回报时应报告证据缺口。后续比较同提交的多次 CI 时，先匹配目标与版本，再比较相邻阶段耗时，避免把隐藏副本或旧缓存误判成产品不刷新。

### 本轮验证边界

发布对照为 v0.8.0（`03efef0`），历史样式锚点为 v0.4.0（`75c3df79074bdeaec0f02a38d40124f0cd66f857`）。公开选择器、变量、DOM 关系和历史样式基线未修订；现有 `cssSnippets` 的实际颜色及阅读重挂载断言继续执行，历史基线复验和八项契约检查通过。

实现树证据原位于 `.vscode-test/issue272-*` 和 `out/test/browser-runs/`，不入 Git：保留 #223 与 #244 的采样红绿 JSON、首次 #244 完整诊断失败日志、修复后敏感四项真宿主报告、定向单测/浏览器及类型和样式检查。

汇总树已把这些小报告复制到 `.vscode-test/verification-272-276/issue272-evidence/`，逐文件核对 SHA-256，映射清单为 `.vscode-test/verification-272-276/evidence-copy-manifest.json`。顶层 `issue272-*` 与最终 `integration-sensitive.log` 保留原文件名；原 CI 与本地 browser run 的日志、JSON、JSONL 和 Markdown 保留原相对目录，生成的 JS/CSS/SVG 构建资产不复制。`issue272-sensitive-host-green.log` 虽名称含 green，实际是 #244 根选择诊断红态（退出码 1），不能当作通过证据。

完整回归与独立双轴审查由 #272 + #276 汇总树统一执行。本轮无推送或 CI 执行，不把代理检查表述为用户验收，敏感名单退出仍遵循上节的多次 CI 条件。

## 门禁调整与兼容证据（既有分组实施）

本次 CI 修改的理由是把用户批准的四项临时豁免显式隔离，同时保留检测、失败信号和报告。#129 只迁移上述动态刷新用例，其余 CSS 导入、历史片段绘制与兼容检查仍在 core。独立 `style-contract` job 的基线复验、检查器变更暴露、全量检查、报告上传及发布链路均保持原有语义。

本次不修改公开选择器、CSS 变量、渲染实现、样式清单或历史基线。已发布契约锚点为 v0.4.0（`75c3df79074bdeaec0f02a38d40124f0cd66f857`），未发布 CI 行为以实施基线 `0b3fad4831a986ce6ecc587fa4c742deb6fc6f5f` 对照；通过 `check:stylecontract:baseline` 与 `check:stylecontract` 复验。

## 验证与退出条件

分组契约覆盖真实 runner 入口、五组并集与互斥、原位置保持、错误配置拒绝、名单成员改名/消失/重复、敏感失败继续汇总，以及 CI 依赖图与报告接线。启动器契约验证独立报告和非法组在启动宿主前拒绝。真实宿主分别跑 core 四片与 sensitive，不以本地通过宣称 Linux CI 已稳定或用户已验收。

每项修复后，保留其现有断言，在同一提交的多次 CI 中验证，再从名单移除并恢复 core 归属。新增或扩大豁免须有独立日志与明确决定，不能因单次失败直接移入。#272 继续跟踪 #129/#223/#244 诊断，#202 按原票登记的索引链路跟踪；分组本身不关闭这些问题，也不构成推送、发布或合并授权。

## 既有分组实施的本地验证留证（2026-10-01）

日志位于本次工作树 `logs/`，宿主逐项报告位于 `.vscode-test/`，两者不入 Git。构建读取本工作树源码并产出 `out/`；真实宿主复用已缓存的 1.86.2 可执行文件，为本工作树另建便携目录与 fixture。首次指定缓存路径时发现新工作树尚无 `.vscode-test/`，在测试准备阶段创建目录后运行，未修改既有启动行为。

- 编译与类型检查通过；完整单测为 4879 项 Vitest 与 113 项 Node 启动器等契约全部通过（`ci-group-compile-final.log`、`ci-group-unit-final.log`）。
- TDD 红绿、五组覆盖及接线契约均留证于 `ci-group-red*.log/json`、`ci-group-green*.log` 和 `ci-group-contracts.log`；两个独立只读审查均无可行动问题，记录于 `ci-group-review.md`。
- 历史样式基线复验、当前八项契约检查与文件树严格检查通过（`ci-group-style-baseline.log`、`ci-group-style-current.log`、`ci-group-tree-check.log`）。
- core 四宿主首轮完整执行 240 项，239 过、1 挂：#215 视口锚点在初始状态等待中超时。首次完整失败保留于 `integration-dev-s4.log` 和 `ci-group-core-host-ready.log`，未改变名单、用例或断言。
- 单宿主对照使用原有 `all + 4/4` 入口；这 61 项与 core 第四片完全相同，全部通过（`integration-dev.log`、`ci-group-shard4-control.log`）。对照只证明失败可随运行条件变化，不证明 #215 根因已修复。
- 第五组单独执行四项，全部通过（`integration-sensitive.log`、`ci-group-sensitive-host.log`）。远端 Linux CI 尚未运行，本轮未推送或修改分支保护。

## #272 + #276 汇总验证（2026-10-02）

汇总树为 `D:/.codex/worktrees/issues-272-276/vscode-obsidian-like-editor`。验证基线为 v0.8.0（`03efef0`），两工单合并提交为 `15aa9bf`，悬停根归属审查修复为 `07dcd357`。真实宿主复用缓存的 VSCode 1.82.3 可执行文件，但本树编译产物、每轮独立便携 profile 与新 fixture 均从汇总树启动。

完整 browser 和单宿主 core 先在 `15aa9bf` 通过。审查修复只补探针的 `rootHost=hover` 归属、协议校验和实际 Popup manager 契约；重新编译 `07dcd357` 后，完整单测、敏感组与五个相关 browser 脚本再次通过。下表如实区分两次代码提交，不把前一轮产物说成最终提交产物。

| 检查 | 结果与退出码 | 报告（均位于本树） |
| --- | --- | --- |
| 最终编译与类型检查 | `07dcd357`，退出码 0 | `.vscode-test/verification-272-276/reviewfix-compile.log` |
| 完整单测 | `07dcd357`，225 文件、4893 项 Vitest 与 118 项 Node 契约全过，退出码 0 | `verification-272-276/reviewfix-unit.log` |
| 完整 browser | `15aa9bf`，55/55 脚本通过，121.1 秒，退出码 0 | `out/test/browser-runs/run-NnNNX5/report.json` |
| 审查修复后的 browser | `07dcd357`，recursiveEmbed / hoverPreview / hoverEntry / readingEmbed / cssSnippets 共 5/5 通过，40.9 秒，退出码 0 | `out/test/browser-runs/run-C1bINt/report.json` |
| 单宿主 core 完整前序 | `15aa9bf`，243/243 通过，389.3 秒，宿主与启动器退出码均为 0 | `verification-272-276/final-core-host.log`、`final-core-run.log` |
| 最终单宿主敏感组 | `07dcd357`，4/4 通过；#129 / #202 / #223 / #244 分别 4737 / 3087 / 1665 / 3272ms，宿主与启动器退出码均为 0 | `verification-272-276/final-sensitive-host.log`、`final-sensitive-run.log` |
| 历史样式基线与当前契约 | v0.4.0（`75c3df7`）锚点复验通过，当前八项检查零失败，两命令退出码均为 0 | `verification-272-276/reviewfix-style-baseline.log`、`reviewfix-style-current.log` |
| 文件树与差异检查 | `check --strict` 与 `git diff --check` 通过，退出码 0 | `verification-272-276/final-tree-check.log` |

表中简写的 `verification-272-276/` 均以 `.vscode-test/` 为父目录。长命令首轮即保存完整输出和独立 `*.exit.txt`；宿主逐项报告另保留原生 `.vscode-test/integration-dev.log` / `integration-sensitive.log`。core 本轮仍有 `dir-moved` 的 ENOENT 观察日志，该用例及全部计划项均正常取得 PASS 终态，宿主正常退出；没有重跑、扩预算或放宽断言。

**本轮已经修正的测试机制**：#223 的等待补齐缺失卡终态，避免只等三张 content 卡后提前断言；#244 选择可见 Reading 根，排除隐藏 Live 树和 Popup 同目标副本。本地诊断红态显示 C 刷新传播约 370ms 已完成，旧采样误取隐藏卡，证据仍保留。#276 改为独占 fixture，保留 clean buffer、覆盖层缺席、两个 incoming 引用者及两轮 rename 四条边的强断言；该项在本轮单宿主完整前序下以 1544ms 通过。此前基线的 #125 设置回显与 #239 jieba 下载失败在本轮原入口也通过，后者耗时 4341ms。

**独立审查已闭环**：未参与实现的规范轴与规格轴代理分别复核完整差异，最终均为零项可行动问题。规范轴原 P2 为 Popup 子卡误归 Reading，实际 manager 红测得到 `reading/reading`，修复后为 `hover/reading`，163 项相关测试通过；原红绿 JSON 和日志在 `verification-272-276/hover-root-*`，审查记录在 `verification-272-276/code-review.md`。

**尚未定性的历史 CI 失败**：#129 CSS 刷新及 browser 阅读回顶超时仍需后续同提交 CI 的诊断记录；本机 #244 样本不能替代全部历史 CI 的归因。本轮不声明整个 #272 根治，不移出敏感名单，不自动重试；无远端推送、CI 重跑或合并，代理自检不等于用户验收。
