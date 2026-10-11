# 集成测试四片强制检查与第五敏感组

状态：2026-10-01 用户批准本方案，实施于独立工作树。实现基线为 `0b3fad4831a986ce6ecc587fa4c742deb6fc6f5f`（PR #268 合并提交），原清单 244 项。分组不修复产品行为，不修改用例断言，也不表示已排除产品缺陷。

## 划分与归属

`test/integration/suite/caseSelection.ts` 的 `SENSITIVE_CASES` 是敏感名单的单一事实源，按完整名称精确匹配；每项登记原因、跟踪票和原始证据。不按 Issue 编号或领域关键词批量排除。

| 第五组成员 | 证据与待查问题 |
| --- | --- |
| #129 被导入 CSS 文件修改自动刷新、删除降级与缺失恢复 | [main 失败与相关代码通过对照](https://github.com/ONEGAYI/vsidian/issues/272#issuecomment-5933902595)；文件变化至样式生效链路超时，延迟与事件丢失尚未区分。**调组后仍在敏感组持续失败**（近 30 个 run 中 sensitive job 4 次失败全为本用例，跟踪票 #293） |
| #202 百文件增删的队列收敛与索引守恒 | [失败运行](https://github.com/ONEGAYI/vsidian/actions/runs/36864132224)；批量增收敛超时，PR #271 的通过运行约 4 秒，根因未定。敏感组 25 次通过均在轻负载单宿主环境，不能证明 core 四分片并发下稳定，保留 |
| #356 附加组件 T07 调序与单项关闭即时生效 | [基线 main run 失败](https://github.com/ONEGAYI/vsidian/actions/runs/37724661505)；近 30 个 run 中 6 次失败（约 20%）、跨 shard 2/3/4 分布，本地单跑稳定通过——CI 环境时序敏感，根因未定（2026-10-08 调入） |
| #364 附加组件 T15 渲染样例停用降级与故障恢复 | [基线 main run 失败](https://github.com/ONEGAYI/vsidian/actions/runs/37724661505)；近 30 个 run 中 6 次失败（约 20%）、mermaid 容器绘制等待超时，本地单跑稳定通过——CI 环境时序敏感，根因未定（2026-10-08 调入） |

**2026-10-08 调组依据**（近 30 个 CI run 统计，逐 job 日志聚合）：#223/#244 的采样修复（#272 落档）已落地，二者在 sensitive job 25 次成功中零失败，满足「同提交多次 CI 验证」退出条件，移回 core 恢复强制检查；T07（#356）与 T15 渲染样例（#364）各 6 次失败、与本次阅读行号变更无关的基线既有失败（基线 94e93a23 同错复现），按「独立日志与明确决定」移入。#129/#202 保留（见上表理由）。

名单之外继续强制检查：包括 #129 其他导入契约、#222 限高设置，以及已加固的 #215 视口锚点。浏览器构建冲突与滚动恢复失败属于 browser job，不并入本组。

#318 搜索定位恢复用例处置（2026-10-03）：原型验证带入的五个用例按裁定收口——显式命令矩阵转正进 core 组（「搜索定位恢复（#318）：显式命令矩阵——首次/重复/多匹配/CRLF/剪贴板恢复」，`integrationCaseGroups.test.ts` 有 `core` 包含断言钉住），自动捕获歧义矩阵、搜索跳转反馈回路（官方 API 落地前必然失败的红测试）、信号盘点与命令面探针（纯观测无断言）四个删除，实证与探针留档于 [#318 原型验证结论评论](https://github.com/ONEGAYI/vsidian/issues/318)与原型分支 `dev/diag-search-reveal`。2026-10-10 的 Windows 诊断与加固见下节；后续新失败仍须按独立证据归因，不自动调入 sensitive。

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

### Windows 剪贴板族诊断与互斥（2026-10-10）

**本轮确认了产品兼容缺陷、测试驱动问题和共享资源干扰**。基线为 `7011adee`，宿主为真实 VSCode 1.82.3，开发态加载独立工作树的 `out/extension.js` 与 `out/webview/`。

- #318 的旧哨兵以 NUL 开头，Windows `CF_UNICODETEXT` 在 NUL 处终止。独立宿主探针与 Win32 回读均得到空串，9 次采样全部复现；普通文本哨兵能完整回读。生产哨兵改为普通文本，定义归 `host/searchReveal.ts`，单测钉住 Windows 回读兼容性与「不能冒充匹配输出」两项约束。
- #318 的测试只等待任意含查询词的条目，现场实际选中、打开 `proto-b.md`，却等待 `proto-a.md`。就绪条件改为甲文件的具体匹配，首条断言核对完整行列与行文本。
- #69 只等剪贴板相对前值变化，会误收迟到的前一次文本；现按 fixture 的独立预期成品等待。#183 的 copy/cut 载荷相同，剪切前写不同哨兵，避免旧复制值冒充剪切完成；粘贴后的成品改为等待回读，保留文本全等要求。
- Windows 的隐藏桌面仍在 `WinSta0`，剪贴板属于窗口站，多个宿主共享它（[微软窗口站文档](https://learn.microsoft.com/en-us/windows/win32/winstation/window-stations)）。四宿主对照中 #69 与 #291 失败，单宿主同组 7/7 通过；加入跨进程互斥后，四宿主同组 7/7 通过。普通文本探针也出现过延后回读旧值，尚未识别具体来源，不能把所有历史失败都归给同一进程。

`test/integration/suite/clipboardLock.ts` 的 `CLIPBOARD_CASE_NAMES` 是互斥名单唯一入口，覆盖 #69、Live/阅读代码卡复制、#183 菜单与块链接、#291 和 #318 七项。Windows runner 仅在这些用例正文期间持有会话内命名互斥量；其余用例继续并发，切片位置、core/sensitive 归属与 Linux 调度不变。新增真实宿主剪贴板用例时同步登记名单；契约检查名称存在且唯一、保持 core 归属，并用真实 Windows 子进程验证互斥与抛错释放。

互斥量协调参与本机制的测试进程，不隔离用户桌面的其他剪贴板程序。用例结束或调用方退出关闭 stdin 时释放；获取、释放失败均报错，不自动重执行用例、不扩大等待预算。命名窗口站隔离在本机普通权限下被拒绝，未纳入实现，也不要求提权。

证据保存在本次实现树 `out/test/clipboard-investigation/`：`baseline-windows-desktop-host.log` 为原始 3/7 失败，`search-navigation-trace-host.log` 为选中乙、等待甲的现场，`sentinel-red.json` 与 `sentinel-green.log` 为哨兵红绿，`clipboard-lock-red.log` 为互斥红测，`family-four-shards-s*.log` 与 `family-four-shards-locked-s*.log` 为四宿主对照。名单仍在 core；本机通过不等于 Linux CI 或人工验收完成。

最终本地验证：`compile-final.log` 退出码 0；`unit-final.log` 为 7552 项 Vitest 与 181 项 Node 契约全过；`family-single-final-host.log` 与四片 `family-four-shards-locked-s*.log` 各合计 7/7 通过、宿主退出码均为 0。`git diff --check` 通过。本次新增文件已通过技能入口登记；文件树严格检查仍报七个基线既有漏项，`tree-baseline-comparison.json` 逐项证实这些文件在 `7011adee` 已跟踪而未收录，未扩大本次变更修补其他领域台账。

## 真宿主文本外观对照套件（#344 接线，2026-10-04）

`npm run test:text-appearance`（`test/integration/runTextAppearance.mjs`）是 #340 产出的生产外观对照套件：在 1.82.3 真宿主内驱动生产 `TextAppearanceService`，断言语法层 token 颜色与 #335 探针对照锚点一致（import `#c586c0` / 注释 `#6a9955` / 字符串 `#ce9178`，主题预置 Default Dark Modern），语义层为可达性观察项。与常规集成回归的差异：**不传 `--disable-extensions`**（内置语言/主题扩展是 grammar 与主题文件的来源），因此不与 core 四片共用宿主装配，独立单轮运行。

- 调度：CI 的 `text-appearance` job（xvfb 单轮，报告上传 `text-appearance-a<attempt>`）；与 `browser` 同为**非必需检查**（2026-09 核查的保护规则仅含 `unit / integration / style-contract`），失败保留红灯与完整报告、不阻断必需检查。ci.yml 改动的实际运行由推送后 CI 验证。
- 本地入口：`npm run test:text-appearance`（先跑 `node esbuild.mjs` 构建套件产物）；报告固定落 `.vscode-test/text-appearance.log`。
- 归属说明：本套件**不在** core/sensitive 分组语义内——它是生产链路与探针的同色证据（横向对照），不承担回归门禁职责。

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

每项修复后，保留其现有断言，在同一提交的多次 CI 中验证，再从名单移除并恢复 core 归属。新增或扩大豁免须有独立日志与明确决定，不能因单次失败直接移入。#129 的剩余诊断转由 #293 跟踪；#223/#244 的采样修复已在 #272 落档，仍保留在敏感组等待上述 CI 条件；#202 按原票登记的索引链路跟踪。议题结案不自动改变分组，也不构成推送、发布或合并授权。

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

**尚未定性的历史 CI 失败**：#129 CSS 刷新及 browser 阅读回顶超时仍需后续同提交 CI 的诊断记录；本机 #244 样本不能替代全部历史 CI 的归因。以上为推送前本地证据，不移出敏感名单，不启用自动重试；代理自检不等于用户验收。

### 后续议题与交付（2026-10-02 用户授权）

用户批准将 #272 已修复的采样问题和诊断交付结案，剩余问题分别转交 [#293 CSS 导入刷新](https://github.com/ONEGAYI/vsidian/issues/293) 与 [#294 阅读回顶标题挂载](https://github.com/ONEGAYI/vsidian/issues/294)。两票保留原始 CI 来源、新增观测读取方式和完成标准；#272 随修复 PR 合并关闭，#276 同样按已满足的完整 core 验证标准关闭。四项敏感名单保持不变，#223/#244 按单项等待同提交的多次 CI 后再评估恢复 core。

推送前基线前移到 `c217529`，新增内容仅为骨架屏规格与文件树。未推送分支先 rebase，文件树冲突经维护脚本按条目三方合并；合并后保留骨架屏登记和本批次三个新增文件条目。rebase 前后 `src/`、`test/`、构建脚本、清单、锁文件及随包资源逐字节一致；随后本节的跟踪编号与敏感名单说明更新只调整元数据，未改分组名称或筛选逻辑。重验报告保留在 `.vscode-test/verification-272-276/publish-*`。

## #293 / #294 后续诊断（2026-10-02）

### #294：延迟定位校准覆盖回顶意图

[CI run 36970685761](https://github.com/ONEGAYI/vsidian/actions/runs/36970685761) 的 `browser-reports-a1` 已捕获新增快照。`cssSnippets` 在「阅读标题块挂载」超时，没有 pageerror，`dropped=0`；最终滚动位置仍为 945，挂载窗口为第 7～36 块，标题数量为 0。窗口与当时滚动位置一致，这份现场不支持把标题缺失直接归为窗口计算错误。

公共视口接口红测固定了同形时序：`scrollToOffset` 定位文末后，先把容器 `scrollTop` 写为 0，再放行定位的 rAF 与宏任务，最后送达滚动事件。原实现把位置重新写回 3240，首块未挂载。测试本体约 86ms，不依赖超时扩大或自动重试。

候选机制与排除依据：

| 候选 | 可检验预测 | 本轮证据 |
| --- | --- | --- |
| 旧定位的异步吸附覆盖新意图 | 回顶后放行旧校准，会重新写回文末 | 红测直接得到 3240；校准前核对位置与请求身份后，同一红测通过 |
| 滚动事件或 rAF 完全丢失 | 主动送达滚动事件并放行帧后应恢复 | 红测已主动送达，窗口仍跟随被旧校准写回的文末位置，不能解释这次覆盖 |
| 首屏窗口计算有误 | 保留窗口算法仍会漏挂首块 | 只修改定位请求的有效期，同一窗口算法恢复首块挂载 |

修复让延迟校准归属于一次定位请求，并记录定位或本视图同步更新后的位置。rAF 与宏任务两个边界均核对请求身份和实际位置；校准时检测到回顶或隐藏，以及新定位、文档替换或销毁，使旧请求失效。`updateNow` 内部的布局补偿继续更新该请求的位置记录，避免把同步更新自身的校正当作新滚动意图。回归覆盖帧前回顶、帧后宏任务前回顶、新定位取代旧定位和实测回填后继续完成布局位移校准。

这里确认的是可重复的覆盖机制，与上述 CI 现场相符；CI 快照没有记录旧校准的逐次写入，不能还原那轮完整的帧间顺序。#294 尚需同一提交的多次 CI 验证，未据本地通过结案。

### #293：原失败已定位到删除降级步骤，机制待核实

[原 CI run 36878422903](https://github.com/ONEGAYI/vsidian/actions/runs/36878422903) 的 shard 2 日志对应提交 `7ceda0d7`。以该提交生成的集成测试 bundle 映射堆栈，`index.js:11484` 是删除 `sub/dep.css` 后，等待 Live 标题装饰色回落为 `rgb(1, 2, 3)` 的断言。此前的文件修改刷新、入口自身规则与阅读切换等待已经返回；原日志未包含 CSS 读值和传播快照，仍不能区分删除事件、广播、嵌套装载或采样问题。

本轮 Windows 1.82.3 定向原用例通过（4178ms）；匹配原 CI 版本的 Windows 1.86.2 再跑 10 轮，全部通过（3347～5146ms）。这些运行保留修改颜色、删除降级、入口自身规则、开关状态与缺失恢复断言。尚无可重复红测，不据检查源码修改 #293 的生产链路，也不恢复 core 归属。

Linux Ubuntu 24.04 临时容器使用 Node 22.23.3 与 VSCode 1.86.2，fixture 位于容器原生 `/tmp`，CSS watcher 走 Linux 文件系统。单项 10 轮全部通过（3239～5361ms）；随后按原 CI 紧邻顺序先跑 #128 目录扫描与 #131 环境身份，再跑 #129 目标用例，共 10 轮、30 项全部通过，其中目标用例 3234～4559ms。Windows/Linux 共取得 31 次目标用例通过，仍不足以确认原失败根因。

Linux 最初的 `xvfb-run` 停在 X server 启动握手，尚未运行 Node 或用例；使用已就绪的隔离 display 执行探针后，两轮宿主均正常退出。`css-linux-stress.exit.txt=137` 是该准备进程清理退出码，不能当作用例失败或通过；实际运行证据是退出码 0 的 `css-linux-exec*` 与 `css-linux-context*`。临时容器、专用镜像和诊断源文件已清理，不改变本机系统依赖。

### 兼容与验证证据

本地工作树为 `D:/.codex/worktrees/e4b6/vscode-obsidian-like-editor`，实现基点 `862537f`，分支 `codex/fix-293-294`。发布对照仍为 v0.8.0（`03efef0`），历史样式锚点为 v0.4.0（`75c3df7`）。受影响的 Reading 容器、块、标题与 spacer 的公开类名、DOM 关系及变量语义全部保留，结构化清单与历史基线没有修改。

报告根目录为 `.vscode-test/verification-293-294/`；browser 原生报告在 `out/test/browser-runs/run-7ArJhv/`。长命令首次执行即保留日志和独立退出码文件，未为补看输出重跑。

| 检查 | 本轮结果 | 报告 |
| --- | --- | --- |
| #294 原红测与四种时序回归 | 原实现失败，修复后 4/4 通过；最终正例同时覆盖同步实测与延迟校准 | `reading-red.json`、`reading-green.log`、`reading-timing-final.log` |
| 全量 Vitest | 232 文件、4962 项通过 | `unit-full.log` |
| Node 启动器等契约 | 112 项通过，6 项按 foreground 模式跳过，零失败 | `node-contracts.log` |
| 完整 browser | 57 套件全部通过，141.19 秒，退出码 0 | `browser-full.log` 与原生 `report.json` / 逐套件日志 |
| 最终编译与类型检查 | 退出码 0；生成内容与基点一致 | `compile-final.log`、`typecheck-commit.log` |
| 真宿主 Reading 与历史 CSS | Windows 1.82.3，9/9 通过，宿主与启动器退出码均为 0 | `reading-host-final.log`、`reading-host-final-report.log` |
| #293 原用例与前序上下文 | Windows 11 次、Linux 20 次目标用例均通过；Linux 前序上下文 30/30 通过 | `css-host-baseline*`、`css-host-stress*`、`css-linux-exec*`、`css-linux-context*` |
| 历史样式基线及当前契约 | git 锚点复验通过，八项检查零失败 | `style-baseline.log`、`style-current.log` |
| 文件树 | 初始 strict 报告基点已有的 10 项 tooltip 漏登记；推送前同步 main 后全量 strict 通过 | `tree-check.log`、`publish-tree-check.log` |

本地阶段未执行推送、远端 CI 或合并。用户于 2026-10-02 授权推送并创建 PR，继续 CI 验证与取证；未授权合并。上述结果不代表用户验收，敏感名单与同提交多次 CI 的退出条件保持原有口径，远端结果按 PR 对应提交及 run 留证。

推送前 fetch 发现 main 前移到 `2b059ed`，三次新增提交只涉及规格和文件树。未发布分支先 rebase；与本地提交 `2c35b1a` 比较，`src/`、`test/`、构建脚本、清单、锁文件和随包资源保持一致。main 已补齐 tooltip 批次的 10 项文件登记，随后全量 `check --strict` 与 #294 四种时序回归均通过（`publish-tree-check.log`、`publish-reading.log`）。

## #309：退役用例的文档复用与异步重读竞争

**本机已复现并定位到 #270 的 B 段**。使用 Windows VSCode 1.82.3 开发态宿主，按原日志的完整用例名称和顺序恢复 62 项，前 61 项通过；堆栈指向 B 段普通编辑器重开后的 `applyEdit`，并非 A 段第一次插入。

VSCode 1.82.3 的 [closeAllEditors 实现](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/browser/parts/editor/editorActions.ts)在选择不保存时执行 soft revert；[TextFileEditorModel.revert](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/services/textfile/common/textFileEditorModel.ts)此时只清 dirty，不重读正文。若模型引用仍存活，clean 不代表 buffer 已与磁盘一致。[普通文件编辑器的 resolve](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts)使用 `reload: { async: true }`，故 `showTextDocument` 返回也不保证磁盘重读完成。

失败后才输出的内存观测保留了原失败：A 段插入得到 v3；621ms 后关闭触发 soft revert；B 段重开启动异步重读，约 73ms 后恢复盘面并推进到 v4；[bulk text edit 的版本校验](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts)随后拒绝旧版本编辑。恢复正文的发起者是普通编辑器重开时的加载链。此处定位的是本机同形失败；历史 CI 未采集内部时间线，不把本机时序冒充 CI 原始观测。

| 候选机制 | 证据与裁决 |
| --- | --- |
| A 段插入被未知 revert 撤回 | A 的 soft revert 来自用例自己的关闭动作；失败堆栈位于 B 段，原判断需修正 |
| B 段重新装载与新编辑竞争 | 红态中重读将 v3 改为 v4 后编辑被拒；实时打印探针的绿态中编辑先完成，重读因版本变化被放弃，两种顺序均有留证 |
| 扩展写回、undo 或额外磁盘写入 | 原票观测为零调用、mtime 不变；本轮捕获的是宿主重读更新模型路径，不需要这些机制参与即可解释该次拒绝 |

**测试约束**：A（面板丢弃）、B（普通编辑器丢弃）、C（显式还原）各自独占无盘面引用的 fixture；不复用前序 rename 文档，也不在三段之间复用 soft revert 后的 buffer。每段验证 clean 初始正文、一次精确插入、覆盖层登记与退役、磁盘未保存。A 不额外调用 `openTextDocument` 持有引用，并检查文档 close；B 则断言文档仍装载、没有 close 事件且已转 clean，保证仍检测 #270 的通用退役路径。C 验证正文已真正恢复。修复不增加等待预算、自动重试或敏感组豁免，不修改生产链路或清单顺序。

**验证结果**：原 62 项顺序红态复现后，隔离 fixture 版本全绿；关闭 B 段 clean 退役接线时，新回归按预期失败。rebase 到合并 #311 后的 `origin/main`（`9f1877e`），编译与类型检查通过，235 个 Vitest 文件 5129 项通过，Node 启动器等契约 112 项通过、6 项按 foreground 模式跳过；四分片 all 组集成测试 252/252 全过，各宿主退出码为 0。

原失败的自动复现仍需约 100～130 秒完整前序，未取得小于 5 秒的独立红态复现。诊断脚本、日志与便携宿主均为本机临时产物，不进入 Git；本地验证不代表用户验收。
