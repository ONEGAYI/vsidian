# 集成测试四片强制检查与第五敏感组

状态：2026-10-01 用户批准本方案，实施于独立工作树。实现基线为 `0b3fad4831a986ce6ecc587fa4c742deb6fc6f5f`（PR #268 合并提交），原清单 244 项。分组不修复产品行为，不修改用例断言，也不表示已排除产品缺陷。

## 划分与归属

`test/integration/suite/caseSelection.ts` 的 `SENSITIVE_CASES` 是敏感名单的单一事实源，按完整名称精确匹配；每项登记原因、跟踪票和原始证据。不按 Issue 编号或领域关键词批量排除。

| 第五组成员 | 证据与待查问题 |
| --- | --- |
| PDF 导出（#621 T01）：固定输入、真实浏览器生成与本机保存（多页中文 PDF）——CI runner 上 spawn Edge/Chrome 冷启动与打印时长未建立稳定基线；本地全量持续跑，观察足够 run 后按既有退出条件回流 core（2026-10-21 登记） |
| PDF 导出（#622 T02）：完整装配、嵌入展开、缺资源选择与绘制证据——T01 同族真实浏览器链路（spawn/打印时长 + 127.0.0.1 资源服务时序），CI 波动基线未建立；本地全量持续跑，回流条件与 T01 同节（2026-10-21 登记） |
| PDF 导出（#622 T02）：生成中取消释放与重复执行健康——同族取消链路依赖真实浏览器进程生命周期，CI 波动基线未建立；本地全量持续跑（2026-10-21 登记） |
| PDF 导出（#623 T03）：多选区严格切片、顺序与资源同源的真浏览器产物——T01/T02 同族真实浏览器链路（spawn/打印时长 + 127.0.0.1 资源服务时序），CI 波动基线未建立；本地全量持续跑，回流条件与 T01 同节（2026-10-21 登记） |
| PDF 导出（#623 T03）：选区导出取消释放与选区/源文不变式——同族取消链路依赖真实浏览器进程生命周期，CI 波动基线未建立；本地全量持续跑（2026-10-21 登记） |
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

## 浏览器测试分组（browser core / 敏感组，2026-10-14）

浏览器测试（`npm run test:browser`）原为单 job 跑全部脚本清单，任一脚本失败整体非零；#272 抖动族在 browser 的表现为「不同 attempt 随机挂不同套件」（PR #481 四次 attempt 挂三个互不相同套件、main 基线近 10 次 CI 8 红），使 browser 长期随机挂红且无法靠重跑收敛。2026-10-14 用户授权仿照集成第五组建制 browser 敏感组：**结构仿照、语义独立**——分组只作用于浏览器套件选择，不与集成 core/sensitive 组共享名单或退出条件。

`test/browser/groups.mjs` 的 `BROWSER_SENSITIVE_SUITES` 是浏览器敏感名单的单一事实源，按套件名与 `run.mjs` 的 names 精确匹配；每项登记原因、跟踪票和原始证据，不按领域关键词批量排除。名单成员消失于全量清单、或定向 `--suite` 与组别交集为空时立即报错（契约测试 `test/browser/groups.test.mjs` 钉住名单内容与接线）。

| 敏感组成员 | 证据与待查问题 |
| --- | --- |
| addonT10Commands | 同 run attempt 1 断言失败（10.3s）；本地定向单跑稳定通过——CI 时序敏感，根因未定（#446 条目 9） |
| addonRendererTakeover | 同 run attempt 3 断言失败（16.9s），与条目 5 的初始化等待超时同套件（#446 条目 5/9）；本地全绿 |
| tableInput | PR #650 run 40656739949 attempt 1/2 同位挂红（边沿 IME 用例 `waitForFunction` 30s 超时，非断言失败，2026-10-28）；本地单套件 3/3 与三并发全量双绿、与当期改动零交集、合并后 main 同代码 CI 通过——CI 时序敏感，根因未定（#552 条目登记；用户裁决入组） |

tableCaret 的原始两次失败已确认是 `handle-hover` 读隐藏新增带 opacity 时得到空串，报告 `TIMEOUT=false`；约 70s 是套件总耗时。控件重建期间取到脱离 DOM 的节点可稳定复现同款失败。修复将查询与样式读取合在同一浏览器回调，补充重建期间的连续采样回归，并恢复 core；该候选须在同一提交两轮独立 CI 通过后合并，远端证据与勾销状态记录于修复 PR 和 #446 条目 9。根因与本地红绿证据见本文末节。

### CI 语义

- `browser` job 保持既有 job 名与非必需地位不变，改设 `VSIDIAN_TEST_BROWSER_GROUP=core`（全量减敏感名单）；报告 artifact 更名 `browser-core-reports-a<attempt>`。
- 新 job `browser-sensitive` 设 `VSIDIAN_TEST_BROWSER_GROUP=sensitive`，不在任何 needs 链上：不用 continue-on-error、不自动重试、不放宽断言——失败保留红灯、逐套件报告与非零退出码，整轮 workflow 可为 failure，但不阻断必需检查。
- 本地默认（不设环境变量）仍是全量，回归习惯与全量验证口径不变；`VSIDIAN_TEST_BROWSER_GROUP=sensitive npm run test:browser` 单跑敏感组（Git Bash），PowerShell 用 `$env:VSIDIAN_TEST_BROWSER_GROUP='sensitive'` 后清除。

此处「敏感」与集成第五组同义：基于证据的临时隔离，不是豁免归因，不能用来自动归类未来的新失败。移入须有独立日志与明确决定；移回 core（恢复 browser 强制面）须同提交多次 CI 验证通过。分组本身不修复产品行为、不修改套件断言；名单内两套件的共享构建互删已由 PR #520 初步修复，敏感分组仍保留，历史归因与处置见 #446 条目5/9。#446 已关闭归档，后续新增未定性失败统一记录于[跟踪集合 #552](https://github.com/ONEGAYI/vsidian/issues/552)。

### Windows 剪贴板族诊断与互斥（2026-10-10）

**本轮确认了产品兼容缺陷、测试驱动问题和共享资源干扰**。基线为 `7011adee`，宿主为真实 VSCode 1.82.3，开发态加载独立工作树的 `out/extension.js` 与 `out/webview/`。

- #318 的旧哨兵以 NUL 开头，Windows `CF_UNICODETEXT` 在 NUL 处终止。独立宿主探针与 Win32 回读均得到空串，9 次采样全部复现；普通文本哨兵能完整回读。生产哨兵改为普通文本，定义归 `host/searchReveal.ts`，单测钉住 Windows 回读兼容性与「不能冒充匹配输出」两项约束。
- #318 的测试只等待任意含查询词的条目，现场实际选中、打开 `proto-b.md`，却等待 `proto-a.md`。就绪条件改为甲文件的具体匹配，首条断言核对完整行列与行文本。
- #69 只等剪贴板相对前值变化，会误收迟到的前一次文本；现按 fixture 的独立预期成品等待。#183 的 copy/cut 载荷相同，剪切前写不同哨兵，避免旧复制值冒充剪切完成；粘贴后的成品改为等待回读，保留文本全等要求。
- 2026-10-10 的 Windows 隐藏桌面仍在 `WinSta0`，剪贴板属于窗口站，多个宿主共享它（[微软窗口站文档](https://learn.microsoft.com/en-us/windows/win32/winstation/window-stations)）。四宿主对照中 #69 与 #291 失败，单宿主同组 7/7 通过；加入跨进程互斥后，四宿主同组 7/7 通过。当时普通文本探针也出现过延后回读旧值，尚未识别具体来源，不能把所有历史失败都归给同一进程。

`test/integration/suite/clipboardLock.ts` 的 `CLIPBOARD_CASE_NAMES` 是互斥名单唯一入口，覆盖 #69、Live/阅读代码卡复制、#183 菜单与块链接、#291、#318，以及 #438 图形块复制源码与 #439 链接复制九项。Windows runner 仅在这些用例正文期间持有会话内命名互斥量；其余用例继续并发，切片位置、core/sensitive 归属与 Linux 调度不变。新增真实宿主剪贴板用例时同步登记名单；契约检查名称存在且唯一、保持 core 归属，并检查 `cases.ts` 中直接调用宿主剪贴板的用例没有漏录，再用真实 Windows 子进程验证互斥与抛错释放。2026-10-15 补齐 #438/#439 的遗漏（独立缺陷 #538）；#446 条目14历史失败未记录覆盖写或最后读值，不能据此将该历史现场直接归因于名单遗漏。

互斥量协调参与本机制的测试进程，不阻止同一窗口站内的其他剪贴板程序。用例结束或调用方退出关闭 stdin 时释放；获取、释放失败均报错，不自动重执行用例、不扩大等待预算。

**2026-10-15 窗口站隔离（#540，承接 #446 条目14）**：原 #69 在正确写入后仍两次实际出现 `copyChildren` 超时。只读 Win32 序列号/窗口所有者采样确认，正确写完后43ms/30ms，所有者是微信输入法3.0.0.34的 `wetype_server.exe`，读值随后变回前序复制文本。经用户授权，临时暂停同一引擎时原例通过，恢复后原超时重现；不把自动重启后的退出尝试算作有效关闭对照。原历史92e14a01没有所有者与最后读值，不能逐帧补写当时唯一原因。

Windows `desktop` 路径改用 `CreateWindowStation(null, …)`，由系统按登录会话命名非交互窗口站，再将真实宿主放到其中的独立桌面；用户的 `WinSta0` 剪贴板不再与该测试路径共享。自定义命名窗口站在普通权限下被拒绝，修复不要求提权。并行宿主可共享系统生成的测试窗口站，九项真实剪贴板用例仍须持有既有会话内互斥。`foreground` 路径继续使用当前桌面，Linux 调度、分组、切片算法和复制等待预算不变。

永久契约从公开 `runTestHost` 启动真实 Windows 子进程：直接查询窗口站身份，验证与用户窗口站不同、真实系统剪贴板可读写，且测试哨兵不流入用户剪贴板。探针也持有既有剪贴板互斥，避免同机单测与集成同时运行时互相覆盖。旧启动器在窗口站身份断言失败，候选通过；原 #69 亦在输入法保持运行时通过。输入法引擎已恢复，管理服务经用户授权的 UAC 启动后恢复 Running/Automatic；退出/暂停输入法仅用于诊断，不是日常测试前置要求。完整回归与交付证据见 #540，不将本机通过替代 Linux CI 或用户人工验收。

单测使用每例独立的随机锁名，同一用例内的两个真实子进程仍争用同一把锁。这样可以验证互斥与释放，又不会排队等待正在运行的集成用例；不同锁名可独立执行也有断言。2026-10-11 的并行复验曾因单测使用固定集成锁名而在 5 秒超时，隔离红测与绿测分别保存在 `lock-isolation-red.log` / `lock-isolation-green.log`。

证据保存在本次实现树 `out/test/clipboard-investigation/`：`baseline-windows-desktop-host.log` 为原始 3/7 失败，`search-navigation-trace-host.log` 为选中乙、等待甲的现场，`sentinel-red.json` 与 `sentinel-green.log` 为哨兵红绿，`clipboard-lock-red.log` 为互斥红测，`family-four-shards-s*.log` 与 `family-four-shards-locked-s*.log` 为四宿主对照。名单仍在 core；本机通过不等于 Linux CI 或人工验收完成。

最终本地验证：`compile-final.log` 退出码 0；`unit-final.log` 为 7552 项 Vitest 与 181 项 Node 契约全过；`family-single-final-host.log` 与四片 `family-four-shards-locked-s*.log` 各合计 7/7 通过、宿主退出码均为 0。`git diff --check` 通过。本次新增文件已通过技能入口登记；文件树严格检查仍报七个基线既有漏项，`tree-baseline-comparison.json` 逐项证实这些文件在 `7011adee` 已跟踪而未收录，未扩大本次变更修补其他领域台账。

2026-10-11 对齐 `4d9102ae` 后，编译通过；锁名隔离后的全量单测为 7586 项 Vitest 通过、181 项 Node 契约零失败（175 通过，foreground 模式按启动器约定跳过六项独立桌面探针，`publish-unit-isolated.log`）。这六项探针随后在默认 desktop 模式单独补验，全部通过（`publish-desktop-probes.log`）。

同轮本机隐藏桌面四片复验为 0/7（`publish-family-four.log`）。绕过业务链路，直接调用 `vscode.env.clipboard.writeText/readText` 的普通文本探针连续三轮、每轮三次采样均回读空串（`publish-raw-clipboard-host.log`）；当前环境未满足原生剪贴板回读前提，不能把这轮失败当作修复后的通过证据。该环境变化的具体来源尚未识别，互斥机制不修复这一系统读写边界；远端 CI 与本机结果分别记录，不用重试、跳过用例或放宽断言掩盖。

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

**2026-10-11 状态补核**：[#304](https://github.com/ONEGAYI/vsidian/pull/304) 已于 2026-10-02 合并（`4fbb829d`）。同一提交 `b02ee81ae0f8a0c74331b81fcc968e205dbbd09c` 的 [36998926653](https://github.com/ONEGAYI/vsidian/actions/runs/36998926653) 与 [36999059633](https://github.com/ONEGAYI/vsidian/actions/runs/36999059633) 两次独立 CI 均为 attempt 1 成功；本轮从 GitHub 读回确认。当前 main `5d3f46dd` 的四种时序回归 4/4 与 `cssSnippets` 再验通过，#294 补齐证据后关闭。前文保留诊断阶段当时的结论；本次自动化复验不等于用户人工验收。

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

## #446：表格装饰重发与采样就绪（2026-10-11）

**条目 1 的表格插入线有可重复缺陷**。CI `38010114937`、`38048478551` 的 `tableCaret.log` 与本机三并发基线轮 `run-p2gLrB` 同错失败；修复前的后续轮 `run-1HdSY5` 还复现 `tableEmbed` S4 行插入线缺失，后者与本次固定的行装饰重发路径相符。只增加等待仍失败（`run-5nlLUN`），排除“等待一下就会恢复”的处置方式。

真实浏览器新增 `handle-column-refresh` / `handle-row-refresh`：先通过原生指针拖动绘出插入线，再经公开 `metricsCompartment` 重配字体度量，不移动指针，验证两帧后提示仍在并继续完成拖放。旧实现两项稳定失败。原因是度量或高度计划重发 `liveDecorationsField.decos` 时，CM6 重写行/格类名；纯装饰变化可没有文档、选区或几何变化，控件层因而不重绘。修复把装饰集合变化纳入原有重绘调度，继续用当前拖动状态恢复插入线，不建立第二套状态源。

**条目 2 的 T08 弱等待已固定**。原条件 `titles[0] !== titles[1]` 在调序前也成立，允许下一步详情操作与迟到的宿主回显竞争。夹具将调序回显延迟 100ms，精确行序断言在旧实现中得到调序前顺序。测试现在等待完整目标行序，并按行为键展开详情；说明文字、例子、徽章色、失败回弹与真实键盘入口断言保留。没有加宽等待预算或自动重跑。

**条目 3 已修复并勾销**。提交 `e78cae2c` 的大纲剪贴板成品采样与会话内跨进程互斥已在 main；本轮真宿主 #69 复制五项再验通过。条目 4 则改为等待 `readingWikilinkCount === 3`。同面修复 #10 链接/图片、#8 伪语法/frontmatter、#12 阅读表格四处默认零计数的弱等待，保留原断言、组别和分片。新增单测直接运行实际采样回调，五处均已先观察红态，再验证完成快照。

**样式兼容范围**：本次触及网格行/格的装饰更新与把手浮层重绘；发布对照为 v0.11.0（`c16349ac`），实施基点为 `5d3f46dd`。网格行/格、把手与插入线既有类名、DOM 关系、颜色变量与作用域均保留，样式清单和历史基线未改。列插入线另断言实际绘制的 3px 焦点色边条；历史 CSS 基线与当前契约检查通过。#294 原有标题挂载及 CSS 颜色断言继续保留。

证据在 `D:/.codex/worktrees/fix-446-294/vscode-obsidian-like-editor/out/test/`：`446-decoration-refresh-red.log` / `446-decoration-refresh-green.log`、`446-t08-delayed-reply-red.log` / `446-t08-green.log`、`446-reading-*-red.json` / `446-reading-all-green.json`。`446-integration-focused.log` 与宿主自有 `.vscode-test/integration-dev.log` 记录 9/9 通过，包含五处阅读采样和 #69 剪贴板对拍。完整回归结果以下方最终验证记录为准；本轮未推送代码或运行候选分支 CI，不把本机通过当作远端验证。

| 最终验证 | 结果 | 证据 |
| --- | --- | --- |
| 全量 Vitest 与 Node 契约 | 340 文件、7679 项 Vitest；181 项 Node 契约，零失败 | `446-unit-full.log` |
| 完整浏览器回归 | 默认三并发，94/94 套件通过，退出码 0 | `446-browser-full.log`、`browser-runs/run-ndImze/report.json` |
| 表格与 T08 稳定性轮次 | 全量后追加两轮三并发，各 3/3 通过，未重跑失败用例 | `446-stability-round1.log` / `446-stability-round2.log`，原生报告 `run-ROri5F` / `run-WEejDp` |
| 真宿主定向回归 | 独立测试桌面、开发态 VSCode 1.82.3，9/9 通过 | `446-integration-focused.log` |
| 编译与类型检查 | 退出码 0；生成产物无变化 | `446-compile-complete.log` |
| 历史样式与当前契约 | git 锚点复验通过；八项检查零失败 | `446-style-baseline.log`、`446-style-current.log` |
| 文件树 | strict 校验通过 | `446-tree-final.log` |

追加验证的第一次命令未透传 `--suite`，误启了第二轮全量；`run-q5i5CC` 被本轮主动中断，原生报告 `exitCode=null`，不计入验证样本。上表两轮定向验证随后经直接调用调度器完成。临时诊断代码已清除；本轮代码仅在 `codex/fix-446-294` 本地分支，尚未推送。

## #446 条目 9：tableCaret 控件重建与样式采样（2026-10-14）

**历史失败是断言失败，不是超时**。固定提交 `756c1fe5` 的 CI run `38450365230` attempt 2/4 原始 `tableCaret.log` 均在 `handle-hover` 的“离开表格后新增带隐藏”断言得到 `'' !== '0'`，结束行均为 `EXIT=1 SIGNAL= TIMEOUT=false`。70.67s / 67.33s 是整套脚本耗时；行/列插入线及度量重发场景在两轮都通过。本项与条目 1 的插入线缺失分开归因。

**可重复机制是采样持有了旧按钮**。`TableControlsView.render()` 重建浮层控件；生产度量或装饰更新可以触发这一路径。Playwright 的 `Locator.evaluate` 先解析节点句柄，再调用句柄的 evaluate，两次异步调用之间允许页面更新。若按钮在此期间被替换，回调仍收到旧按钮；其 `isConnected=false`，`getComputedStyle(...).opacity` 是空串，当前按钮的 opacity 则为 `0`。

红测之后按三个预测收敛：

| 候选原因 | 可证伪预测 | 观测 |
| --- | --- | --- |
| 采样句柄过期 | 旧按钮断开连接且读空串，当前按钮仍隐藏；合并查询与读取后消失 | 度量重配红测 3/3、持续重配红测 10/10 符合；同条件原子采样 10/10 通过 |
| 悬停状态未清除或退出坐标仍在表格内 | 当前按钮的 opacity 应为 `1` | 同次采样当前按钮为 `0`，不符合 |
| 样式未装载 | 当前连接按钮也无法得到预期 opacity | 原生移入/移出及当前按钮读值符合 `1`/`0`，不符合 |

本机自然场景 20/20 通过；仅在退出后持续经既有 `refreshTableLayout()` 度量入口触发控件重建，保持原采样回调，即稳定复现空串。永久回归 `handle-hover-refresh` 在该入口持续重配时连续采样 10 次，每次都要求隐藏断言成立，未设置重试或延长预算。行/列新增带的样式采样改为在同一个 `page.evaluate` 回调中查询当前 DOM 并读取计算样式；生产控件、CSS 和原生指针交互均未修改。

**本地验证**：基线 `3977b0a4` 的完整 tableCaret 通过；新增回归配旧采样时失败，修正采样后完整套件通过。日志在独立工作树 `D:/.codex/worktrees/tablecaret-root-cause/vscode-obsidian-like-editor/out/test/`：

- CI 原始证据：`ci-a2/run-fJx2xH/tableCaret.log`、`ci-a4/run-X6Vvp0/tableCaret.log`。
- 短复现：`446-hover-natural.log`、`446-hover-reconfigure-red.log`、`446-hover-churn-red.log`、`446-hover-churn-green.log`。
- 完整套件：`446-tablecaret-baseline.log`、`446-tablecaret-regression-red.log`、`446-tablecaret-regression-green.log`；对应原生报告 `run-boxnrx`、`run-ihJLPC`、`run-x3gwda`。

历史 CI 没有记录节点连接状态，具体是哪次页面更新替换了按钮仍无法从旧日志还原；本轮固定的是能解释同款空串的采样竞态。tableCaret 恢复 core 的候选同步更新分组契约；合并前须完成同一提交两轮独立 Linux CI 验证，结果以修复 PR 与 #446 台账为准。#446 内另外两项套件及其他未解决条目仍保持打开，不因 tableCaret 修复一起勾销。

## #446 条目 8/10：diff 前置与孙位身份等待（2026-10-14 后续调查）

本轮从 main `1ced1953`（v1.0.0）建立独立工作树，核对最近 18 次 CI 与开放的稳定性 Issue。最新 [run 38514133619](https://github.com/ONEGAYI/vsidian/actions/runs/38514133619) 全绿；此前两轮 main 红灯分别是 [38510350338](https://github.com/ONEGAYI/vsidian/actions/runs/38510350338) 的 P2-01 diff 标签页等待超时，以及 [38511777005](https://github.com/ONEGAYI/vsidian/actions/runs/38511777005) 在 `Resolving version...` 阶段连接宿主下载服务超时。后者尚未启动用例、没有生成宿主报告，不与断言抖动混为同根因。

**条目 8 的探针假设已可重复证伪**。CI 的 `diff-temp-created` 已记录 `bTabs:1`；本机无既有 B 标签时原用例通过，固定“先打开 B，再写入冲突版本”后稳定复现旧等待超时。真实宿主中，原文本标签变为 dirty/pinned，打开 diff 后仍保留；这不是等待更久就会自动回收的临时编辑器。候选按打开前的非 diff 视图种类及分组校验打开后状态，保留正确 diff 目标、B 内容/dirty、临时副本与关闭释放断言；没有增加预算或关闭 B 的脏标签来迁就测试。历史 CI 未记录既有标签种类，不能还原其每个标签；固定相同 `bTabs:1` 前置的宿主重放验证了旧独占性假设不成立。调研正文的相关断言已同步收窄。

**条目 10 的等待弱于后续身份断言**。旧谓词以 `cards.length >= 5` 就绪，随后却按 `inner` 建 Map 并要求五个唯一位置。同一个匹配快照中，四个唯一位置加一张重复卡会通过等待，再在“缺格内位”的断言失败；`waitViewState` 返回的正是匹配快照，不存在第二次采样解释。新增单测直接执行实际谓词，回放这一快照时旧实现返回 true；候选逐个等待五个目标 `inner` 均有已绑定的 Live 卡，拒绝重复卡凑数与格内位未绑定状态。原独立端口、真实输入、保存归属断言保留，产品引用链路未改。

本地验证使用独立桌面的 VSCode 1.82.3，开发态加载本树 `out/extension.js` 与 `out/webview/`。P2-01 全组 18 项、P2-09 两项分别通过，最终组合运行 20/20 通过；完整 Vitest 7900 项、Node 契约 192 项及 compile/类型检查通过。本轮未更改分组，未将本地通过记作 Linux CI 或用户人工验收。文件树严格校验仍报告主线既有的 14 项漏录；本次既有文件的职责说明经维护入口更新，没有新增漏录项。

证据在独立树 `D:/.codex/worktrees/ci-stability-followup/vscode-obsidian-like-editor/out/test/`：`p201-existing-preview-red-host.log`、`p201-existing-tab-green-host.log`、`p201-all-green-host.log`、`p209-readiness-red.json` / `p209-readiness-green.json`、`p209-host-green-report.log`、`ci-audit-unit-full.json`、`ci-audit-node-contracts.log`、`ci-audit-compile.log`。历史 CI 原始报告另存 `D:/.codex/evidence/vsidian-ci-audit-20261014/`。

**仍待独立归因**：#446 的 T09/T10、Mermaid 恢复、T15 输入样例及 #293 CSS 刷新保持待查。T09 在 `38489048403` 的“停用内置接管与恢复”场景也出现 `waitForBoxCount` 8 秒超时，另五个场景通过，不与旧场景直接合并归因。大纲 #67 的“当前档圆点实心绘制”已在 `38491605871` 与 `38503490734` 两轮第 4 片复现，另有 #446 既有评论记录，属于后续高优先级线索。本轮未修改这些用例的断言。

**已修复的历史失败分开记录**：`38502547733` 的 addonSettings 布尔字段开关宽度曾读到 0（预期 36px）；当前 main 已包含 `09067ea3` 的保存回灌节点替换等待与原子几何读取修正。该项不再作为本轮新增缺陷。#446 另记的本机 textarea 样式空串是不同场景，尚无本轮同根因或已修复的证据。

## #446 条目 11：大纲右端圆点在侧栏过渡期被裁切（2026-10-14）

历史两轮第 4 片失败均是初始快照的 `panelPainted=true`、`sliderPainted=true`、`sliderActiveDotPainted=false`、`chevronPainted=true`，默认档仍为 5。初始等待只检查侧栏 open、面板命中与 101 条目；这些条件不足以保证最右圆点已经可见。

**真实 Chromium 固定了这一窗口**：沿用生产控制器、样式和绘制探针，暂停原生侧栏宽度过渡在 40% 时间处。侧栏宽约 159.84px，面板和滑块中心已经命中，圆点中心却在 1000px 视口外的 x≈1090.16；圆点类名正确、背景为 `rgb(14, 99, 156)`，但 `elementFromPoint` 返回 null。结束过渡后侧栏宽 280px，圆点中心 x=971、绘制探针转为 true，类名与背景不变。旧等待会接受过渡期快照，随后原圆点断言稳定失败。历史 CI 没记录该帧几何，不能逐帧还原；本轮证明了原等待缺口及能复现相同失败快照的生产过渡机制。

**修正只收紧就绪条件**：等待滑块、当前档圆点和折叠箭头的既有绘制探针全部为 true，再执行原断言；预算、产品样式、绘制探针实现和 core/sensitive 分组均未改。单测执行 #67 的实际回调，过渡期快照在旧条件下先红；候选拒绝圆点、滑块或箭头尚未绘制的快照。浏览器回归永久保留暂停过渡的绘制证据，继续验证原点击、拖拽、展开和编辑存活场景。

本地 compile/类型检查、完整 Vitest 7918/7918、`outlineCollapse` 七项浏览器场景通过。同步 main `366449ac` 的 Mermaid 主题扩展后，文件树通过三方字段合并保留两边职责，重新编译、完整 Vitest 7927/7927 与 Node 契约 192/192 通过。真实 VSCode 1.82.3 开发态加载本树产物，大纲整组 14/15；目标 #67 用例通过，唯一失败是 #69 `copyChildren` 剪贴板更新超时，保留报告另列待查，不称作环境原因或全组通过。文件树职责经维护入口同步；严格检查仍是 main 既有 14 项漏录，没有新增结构错误。本地验证不替代 Linux CI 与人工验收。

证据：本树 `out/test/outline-animation-red.log`、`outline-readiness-red.json` / `outline-readiness-green.json`、`outline-unit-full.json`、`outline-browser-final.log` 及对应浏览器报告、`outline-final-compile-fixed.log`、`outline-native-all.log` / `outline-native-all-report.log`；交付时归档至 `D:/.codex/evidence/vsidian-outline-dot-20261014/`。

**本轮补查的新失败保持独立**：main [38521864148](https://github.com/ONEGAYI/vsidian/actions/runs/38521864148) 的第 2 片挂在 #111 图表弹窗装载；[38520568957](https://github.com/ONEGAYI/vsidian/actions/runs/38520568957) 的 tableCaret 是“靠近右边新增列带出现”预期 opacity=1、实际 0，`handle-hover-refresh` 仍通过，套件 69.109s、`TIMEOUT=false`。这些不等于先前控件重建时样式空串的根因复发，也不因本轮 #67 修正而联动勾销。

## #446 条目 13 / #496：表格新增带重建丢失静止指针悬停态（2026-10-14）

**已固定真实呈现缺陷**：Chromium 原生指针靠近表格右边后新增列带 opacity=1；保持指针不动，用既有 `refreshTableLayout` 重发表格度量。刷新前后表格右边界均为 952px，指针为 x=948/y=80、距边界 4px，源文不变。控件确已重建，旧按钮断开连接；当前新按钮仍连接在 DOM 中，却丢失 `vsidian-table-control-hover`、opacity=0。原子查询当前按钮仍见红，排除了本次回放是读取旧节点空样式的解释。新增行带也能按同一重建机制复现。历史 CI 只有 opacity=0、没有控件代次与几何，不能宣称逐帧还原；本轮证明了可复现同形态的生产缺陷，独立开票 #496。

`TableControlsView.render` 每次重建整层按钮，原新增带悬停类只由指针事件写入。候选保存最近的新增带指针坐标，在控件重建后按**当前**可见表格边界重新计算显隐；进入新增带同步坐标，离开时清空。没有复制旧 DOM、旧类或固定旧几何；边界移远后应隐藏。修正限定在新增行/列带，不将其他抓手的状态概括为已修复。

永久浏览器场景 `handle-hover-visible-refresh` 覆盖行/列新增带、指针离开后的重配与零文本写回；原 `handle-hover-refresh` 的隐藏态原子采样回归保留。单测覆盖静止指针、当前边界移开、新增带内部移动和离开后重建。原生回放先红后绿，不延长预算、不调整 core/sensitive 分组。

**契约基线**：已发布 v1.0.0，提交 `1ced19532a9ef1e1a8a34b1da075fbc8c694469d`。公开 `live-table-grid-row` / `live-table-grid-cell` 的节点、选择器和变量入口保留；控件层、新增带与悬停类为既有实现锚点，本次没有新增公开条目。历史格选择器片段在新回归中实际改变 padding，并在该布局下验证新增带显隐。按钮沿用既有 20px 盒、4px 圆角、editor/toolbar 主题变量，新增带沿用 12px 带与热区；本次没有改变元素形态、样式值或登记新档位。历史基线复验与当前样式契约检查通过。用户可见修正只记入 Unreleased，物理鼠标验收留在 manual-verification 的未勾选条目。

证据保存在本树 `out/test/column-hover-probe-red.log`、`column-hover-visible-red.log` 及对应 `tableCaret.log` / `report.json`、`column-hover-browser-final.log` 及其报告、单测 JSON、`column-hover-style-baseline.log` / `column-hover-style-check.log`。交付时另存 `D:/.codex/evidence/vsidian-table-column-hover-20261014/`；本地与候选 CI 的结论分开记录。

本地 tableCaret 83 个场景、相关单测、compile/类型检查与样式契约通过。首轮全量 Vitest 为 7927/7928，唯一失败是 #372 两表优化模板互异断言；该用例只装配 `livePreviewDecorations`，未装配本次修改的表格控件，同日另一实施会话两轮全量已有同款失败。单独 liveTable 151/151 通过。与 Vitest 同时执行的 Node 契约为 190/192，两项宿主 700ms 超时快照未收到目标输出；改为单独执行后 192/192 通过。原失败与独立通过日志均保留，这些对照不等于未定性项已修复，不修改其断言或预算以迁就当前修正。

推送前同步 main `c71caaab`（包含 #494），文件树按三方字段合并保留双方 16 项变动，人工清单保留两边待验项。新基线 compile/类型检查、完整 Vitest 7977/7977 与 Node 契约 192/192 通过；tableCaret 83 个浏览器场景、历史样式基线复验与当前契约检查通过。文件树 strict 全部通过，主线已补齐此前漏录。日志为 `column-hover-rebased-compile.log`、`column-hover-rebased-unit-all.log`、`column-hover-rebased-browser.log`、`column-hover-rebased-style-baseline.log` / `column-hover-rebased-style-check.log`、`column-hover-tree-merge.json`、`column-hover-tree-rebased-check.log`。旧基线的未定性失败仍在 #446 单独跟踪，不因新基线一轮通过勾销。

## #446 条目 15 / 18 与 #500：统一度量夹具，修正引用表可见扫描（2026-10-14）

**条目 15 已固定测试夹具根因**。原 I-7 用例让优化查询的脱离 DOM 替身行报 400/300px，却让度量插件查询的实际行报 0。独立生产 EditorView 的受控时钟回放：1ms 时顶层优化计划已发布，两表模板不同；161ms 时尾随测量撤掉 availablePx，两表都回到历史失败的 92fr/20fr 轻量模板。回放始终保留几何 mock，证明失败不要求提前 mockRestore；仅让实际行也报正宽度，跨过同一发布后有效度量仍保留。历史全量没有这一时间线，不声称还原每轮执行帧。

永久夹具统一真实网格行几何，使测量与按表优化共同看到 400/300px 轨道净宽（含 CM 行盒 padding 的 border-box 分别为 408/308px）；度量注入值匹配实际首行。受控时钟推进到 200ms 覆盖原尾随窗口，随后校验有效度量、两表分别发布、模板互异和零文本写回。不是延长真实等待预算，也没有改生产度量的不可测降级逻辑。

**独立产品缺陷另列条目 18 / #500**。网格段从含容器前缀的物理行首起，Lezer Table.from 在前缀之后。可见扫描从段首向上找 Table 祖先时，引用表被漏掉。旧 I-7 仅要求模板不同，会接受“顶层表优化、引用表仍轻量”的状态。统一夹具后，单层、多层、引用内列表与 lazy 分隔行四项契约都先失败：预期两表各发布一次，实际只有一次。

修正把可见扫描定位改为从网格段末端向内查询既有 Table 祖先，避开行首前缀。独立需求审查进一步发现同一活动识别缺口：两端在表外的跨越选区、以及光标不在引用表内的矩形区域，都因使用含前缀的起点而漏识别。新增四类引用的两组活动态契约分别先红（完整搜索预期 0、实际 1），再同步跨越选区的段末定位和矩形区域表头行末定位；区域仍保留物理行首身份。12 项永久契约转绿，整份 liveTable 162/162 通过。不新增前缀解析，不改变安全网格判定、优化模型、预算、活动／IME／离屏语义。

浏览器原 README“引用”场景实际没有引用前缀，本轮补齐，进入或离开表格之前的初次扫描等待在旧实现 5 秒超时；候选通过，原高度、净宽、文字绘制与源文断言保留。

**样式兼容基线**：已发布 v1.0.0，提交 `1ced19532a9ef1e1a8a34b1da075fbc8c694469d`。公开 live-table-grid-row/cell、引用别名、行属性与列宽变量入口保留，没有新增样式条目或改变元素形态。历史格选择器的 padding 片段在真实引用布局下读到 8px；历史基线复验和当前契约检查通过。用户可见修正写入 Unreleased，人工待验未勾选。

**发布同步**：推送期间主线发布 v1.0.1，锚点 `5f2929ea6f259b92ebb3b52aa1c7607930da8cd0`；另存该标签的清单与 CSS 快照。CHANGELOG 保持已发布段落原样，#500 留在新 Unreleased；文件树按字段三方合并保留本票三项职责，并采用主线对 #502 新单测的描述。发布后基线重跑 compile/类型、完整 Vitest 8010/8010、Node 192/192、样式历史基线/当前契约及文件树 strict 均通过。表格源码和 CSS 未变，原生输入沿用上一段同一表格代码的 91/11 场景报告，不将发布同步称为新产品修正。

基线 `a267f120` 上 compile/类型检查、完整 Vitest 7982/7982、Node 契约 192/192、tableCaret 与引用绘制通过；文件树 strict 通过。补齐活动态修正并同步 main `09840779`（#502）后，compile/类型检查、完整 Vitest 8010/8010、Node 契约 192/192、tableCaret 91 场景与引用绘制 11 场景通过，历史样式基线及当前契约通过。CHANGELOG 冲突按三方核对保留两项修正；经文件树入口补录 #502 新增的块查询单测后 strict 通过。引用绘制日志既有汇总分母写作 8，tableCaret 部分汇总也未包含全部场景，结论按逐场景 PASS 和 report.json 状态记录，本轮未改汇总公式。分组与敏感名单不变，条目 16/17 及其他未定性项继续独立跟踪。

证据：本树 out/test/table-width15-probe-red.log、table-width15-consistent-trace.json、table-width15-both-contract-red.json / green.json、table-width15-active-red.json / green.json、table-width15-region-red.json、table-width15-active-final.json、table-width15-browser-red.log（run-Oo1WqY）、table-width15-quote-browser-green.log（run-Kb1wuX）、table-width15-browser-green.log（run-KDTjKW）；同步后的 table-width15-rebased-unit-full.log、compile.log、table-browser.log（run-9ltoqo）、quote-browser.log（run-JfFwNq）、style-baseline.log / style-check.log、tree-final.log。交付归档 D:/.codex/evidence/vsidian-table-width15-20261014/，本地与候选 CI 结论分开记录。

## #446 条目 16：700ms 快照测试混入启动与流抵达耗时（2026-10-14）

**根因在测试夹具的就绪前提**。原快照用例要求在700ms停止时已经收到假宿主的完整目标输出，但计时从包装进程spawn后开始，包含Windows PowerShell启动、Add-Type编译、Node目标启动和管道抵达。停止时缓冲没有任何行，则生产逻辑只打印超时原因；收到部分行则只快照已收行。这两种行为符合当时的输入状态，原用例没有保证快照验证所需的输出就绪。

**原并行条件已复现**。原两项单独执行2/2，通过全量Vitest加载后0/2，760.6/832.4ms结束，分别缺少“最近输出”与last-marker，症状与旧日志一致。旁路只记录阶段文件，不向stdout/stderr增加诊断：单独运行目标输出250–257ms抵达；并行一轮包装脚本473ms才开始，741ms停止时未完成C#编译、没有接收输出。另轮编译675ms、包装前缀695ms、710ms停止，仍无目标输出；再一轮同一毫秒内按先early-0、后停止、再含last-marker块的顺序抵达，快照只含停止前已收行。历史两轮没有阶段时间线，不逐帧断言都停在C#编译；本轮固定了同路径、同负载下的夹具竞态。

**修正只控制快照测试的时钟和就绪**。真实包装层与Node子进程保留；父测试只模拟setTimeout，等待stdout完整目标标记，再推进至699ms验证尚未停止，700ms验证立即报告超时，随后检查原124退出码、断点标记与尾部保留。另加首输出前700ms到期的空缓冲契约，禁止伪造快照。用例独立5000ms时限约束启动就绪与清理；宿主timeoutMs仍为700，生产全程计时、tail缓冲及杀树实现不变。就绪标记缺失的隔离探针触发1000ms真实测试取消后，after hook仍停止并等待本次树退出，收尾标记成功。

原负载下完整Node契约193/193，三个快照用例通过；负载生成的Vitest为8009/8010，唯一失败是未改的wikilinkSuggestSession:634“清空查询后 ↓ 未高亮首项”expected0/actualnull，另记条目19，当时未归因，不改其断言。标准串行compile/类型、完整Vitest8010/8010与Node193/193通过，文件树strict通过。本票只改测试夹具和维护文档；没有webview输入/样式或宿主实现变更，真实包装层的超时、中断、异常及进程树清理原契约仍以真实时钟运行。候选CI与本机并行诊断分开记录，其他#446未定性项不联动勾销。

证据：本树out/test/host16-original-solo.log、original-under-load.log、timeline-solo.json / timeline-load.json、before-vitest.json、fixed-under-load-node-all.log、fixed-load-vitest.json、snapshots-final.log、cancel-probe.log / json、standard-unit.log、compile.log、tree-check.log及host16-diagnosis.md（同组文件均带host16-前缀）。交付归档D:/.codex/evidence/vsidian-host16-timeout-20261014/；旁路探针仅在忽略目录，不进提交。

## #446 条目 19：双链高亮夹具未等待去抖后的新查询（2026-10-14）

**原失败位于空查询后的方向键选择**。原报告wikilinkSuggestSession.test.ts:634预期0、实际null，对应删除为起始空查询后按↓；非空查询身份消失取首项的断言在627行已经通过。此前台账将两处混称，本轮按原堆栈纠正。

**已固定快慢回包的红绿对照**。保持原输入、回包、真实keydown和高亮断言，只将首次回包耗时固定为0/80ms：快分支通过，慢分支稳定在原方向键步骤失败，单例47ms。慢回包使下一次文件查询启用自适应去抖；删除时会话已换代，最新出站却仍是reqId1/generation1/query方。夹具立即回灌旧请求，生产守卫正确拒收，浮层维持0项的加载态。原activeIndex=null断言把加载态误作已就绪空查询无高亮，直到↓后才失败。

只推进待发查询的模拟时间，新空查询reqId2/generation2出站；同样回包得到两项，初始无高亮，↓后索引0。非空同查询重排、身份消失与空查询身份消失步骤均继续通过。历史全量没有逐阶段时钟记录，不声称已测得旧现场RTT；本轮证明夹具对慢回包缺少就绪前提，可稳定复现同形态断言。

**最小修正只改会话契约**：固定0/80ms快慢分支和父测试时钟；删除后推进查询调度，先断言新空查询及新reqId，再确认两项真实候选就绪，随后执行原高亮与身份消失断言。生产去抖、响应守卫、高亮、按键、DOM与样式实现均未改，没有延长真实等待预算或修改分组。单文件74/74通过；代理自检不替代真实IME和物理键盘的人工验收。

初始基线de106027上，compile/类型、文件树strict、原生wikilinkSuggest48/48通过。完整npm run test:unit与额外Node契约并行运行，Vitest8011/8011及两份Node193/193均通过，覆盖原并行诊断条件。RTK本轮成功解析后未更新JSON/tee，原.vitest/json/output.json仍是上一轮数据；本轮统计只取带退出码的日志，不以旧报告充当新证据。候选CI与本机诊断分开留存，其余#446未归因条目不联动勾销。

推送前同步main的拖放光标、阅读布局与Live选区修正：678a4972上的完整Vitest8013/8013、Node193/193与wikilinkSuggest48/48通过；进一步同步eee043c6，compile/类型、完整Vitest8016/8016、Node193/193与浏览器48/48通过。新基线文件树strict报三项已有漏录：dropCursorPaint.mjs、dropCursorPaintFixture.ts和readingMermaidMarginCssContract.test.ts，基线tree.json同样缺少；本票两项职责更新正确，保留该基线问题，不称最终全树strict通过。

证据：本树out/test/highlight19-original-solo.log、clock-red.log、public-trace-red.log / green.log、session-green.log、compile.log及diagnosis.md（同组文件均带highlight19-前缀）。交付归档D:/.codex/evidence/vsidian-highlight19-20261014/；临时DEBUG-highlight19输出已从测试移除。

## #446 条目20：P2-14保存等待弱于文档干净断言（初步修正，2026-10-14）

主线CI38564195639的第3片101/102，三层引用组合用例在磁盘已包含新编辑文本后，紧接的“保存后C干净”断言失败，1328ms。原等待只验证磁盘内容，未验证后续断言要求的TextDocument.isDirty状态。

直接执行P2-14实际采样回调：磁盘含新文本、文档仍dirty时旧回调放行，53ms稳定红。候选同次采样在读取磁盘后检查文档干净；永久契约同时拒绝“已落盘但仍dirty”和“文档干净但磁盘仍旧”，两项齐备才完成。原20秒预算、dirty断言、A/B零落盘、干净关闭与订阅回收均保留，生产保存实现与core分组不变。

初始基线12d39c89上，开发态真实VSCode1.82.3加载本树产物，目标用例2599ms通过；实际采样8/8、compile/类型、完整Vitest8017/8017与Node193/193通过。本轮确认的是测试等待条件缺口，历史没有保存完成和dirty事件时间线，不将dirty滞后的具体阶段说满。持续dirty仍会在原预算内失败，等待后的再次置dirty仍由原断言拦截。

推送前同步main56e03882的多光标IME/API修正，重新compile/类型、完整Vitest8024/8024与Node193/193通过，真实目标用例2461ms通过。采样名称明确为“孙目标保存落盘且干净”，持续失败时不会仅报告磁盘条件。

文件树仅更新本票三项职责；初始基线三项漏录保留，同步后另有main新增multicursorIme.mjs/Fixture.ts两项漏录，共五项，未称全树strict通过。证据为out/test/save20-callback-red-final.log、callback-green.log、native.log / native-report.log、compile.log、unit-full.log、rebased-unit.log、rebased-native.log及diagnosis.md（同组文件均带save20前缀）。候选CI与本机初步验证分开记录，其他未归因项不联动勾销。

## #446 条目7/17：T15装载等待依赖短期事件日志（初步修正，2026-10-14）

PR #517首候选a5c70036的CI38571228234第1片103/104，ui-command再次等待页面装载30秒超时。第3片P2-14与其余十项检查通过；原失败保留，没有直接重跑。原报告只有全局事件尾部，未记录目标页面的装载快照。

抽取并执行生产recordEvent与集成waitForPageLoaded：loaded成功事件随后被200条其他通道请求淘汰，目标页面仍活跃，旧等待却未完成，21ms稳定红。事件缓冲只保留最近200条，不能承担当前装载状态查询。

既有等待改读目标文件的view.state.addonPage.active，七个调用点显式绑定刚打开的文件。三套样例的后续目录、行为、命令、绘制与设置断言、30秒预算、生产装载器及事件容量均保留。活跃装载不等于异步工厂所有贡献已就绪；后续断言继续验证贡献。失败诊断包含目标页面装载快照与该组件事件，避免高频通道请求覆盖有用的尾部。

永久回放验证日志淘汰后可完成、缺少页面/已卸载/其他组件活跃仍不能放行；另验证七个等待地址与刚打开文件一致。本轮实现一度把渲染文件写成t15-renderer.md，地址契约先红后修正为实际t15-render.md，不把这次实现错误当历史根因。就绪契约10/10、compile/类型通过，真实VSCode1.82.3开发态独立桌面的T15六个完整用例通过（界面目标2840ms、输入2778ms）。

本轮证明测试观测缺口，历史CI缺少完整目标事件时间线，尚不能把条目7/17每次失败都归为日志淘汰，两项继续未定因跟踪。其余条目5/6/9/12/14本机对照均通过，已在Issue补证据，未拿到目标红的路径未修改或勾销。证据为out/test/t15-ring-red.log、ring-green.log、target-contract-red.log、final-callback.log、all-native.log / all-native-report.log、compile.log及ring-diagnosis.md（同组文件均带t15前缀）；候选CI与本机结果分开记录。

### 真实宿主补充：T12空轮询淹没装载事件（2026-10-15）

**已复现原装载等待的完整红态**。在b7aec94c基线、VSCode1.82.3独立桌面保留五项T12前序用例，再运行T15目标。只在忽略目录的集成bundle恢复旧事件等待，保留原30秒预算及目标后续断言，输入/UI分别30628/30618ms超时；超时快照确认各自目标页面仍在addonPage.active。此前700ms观察段中，T12 nextCalls增加1396–1850，200条缓冲有197–200条为t12.next；当前状态等待完成时，旧成功事件已经不可见。

**真实根因链由两部分构成**：旧等待将短期装载事件当作当前页面状态；T12夹具在无命令的成功应答后立即重新查询，持续挤掉成功事件。T12页面源码git对象90291ad6f0943541276b9b30503cf764a7bad37c、宿主夹具对象1782b9a2ae3570a2d6643adabff099904d80a383，在条目7的d96b9b5e、条目17的c71caaab与本轮b7aec94c三个提交相同。历史报告尾部与本轮阶段形态相同，支持该链路；旧CI仍缺消息逐帧记录，不声称测得其实际轮询速率或每次失败的唯一原因。

**本轮只修正T12夹具空轮询**：无命令时等待100ms；有命令时继续立即处理并消费队列，arm回执照常发送，释放标记阻止后续请求。代价是空队列之后的新命令最多多等一个100ms查询间隔。保留PR #517的目标页面当前状态等待，不回退到事件日志；本轮旧等待绿测也观察到“旧成功事件仍在、当前页面尚未活跃”的提前放行，说明旧谓词的另一边界仍存在。

永久契约执行完整T12页面入口，在公开defineAddonPage与channel.request边界驱动应答：空应答原实现立即出现第二次请求，期望1/实际2先红；修正验证100ms节奏、有命令立即回报与释放时不再出站，3/3通过。真实宿主只改变上述轮询分支、仍使用旧等待，原七项从5/7变为7/7；改回当前等待并保留六处700ms观测的T12/T15整组11/11通过，T12增量降到1–8次，目标页面保持活跃。诊断时增加的采样延迟与输出仅在忽略目录bundle，提交不携带。

证据为out/test/t15-followup-native.log/report.log、old-native.log/report.log、old-wait-green.log/report.log、current-native-green.log/report.log、poll-red.json与poll-final-green.json（同组文件均带t15-followup前缀）。新增时间线与本轮红绿独立于旧CI；原报告、旧失败预算、core归组以及目标的输入/行为/命令/菜单/绘制断言均保留。

最终去掉诊断bundle，原样T12/T15 core整组11/11通过；真实键盘T12故障暂停/编辑继续/手动恢复四场景通过。compile/类型、完整Vitest8051/8051与Node194/194、文件树strict通过。仅提交空轮询分支、公开SDK契约与本节记录，探针未进入正式集成产物。

基线56e03882上完整Vitest8026/8026与Node193/193通过。文件树相关职责由维护入口更新；全树严格检查仍仅为前节列出的五项主线既有漏录，没有新增漏录。

独立审查发现永久测试不应绑定生产私有recordEvent变量名。实际记录器抽取回放留在忽略目录作为诊断证据；永久回归通过公开命令mock提供独立截断快照，并执行真实等待函数。公开边界旧等待仍先红（t15-public-red.log），修正后10/10通过（t15-public-green.log），不为测试新增生产接口。

## #446 条目5/9：附加组件测试构建清空其他套件的资源（2026-10-14）

**并发构建互删已稳定复现**。buildTestAddons原来每次清空同一个.build目录；此前套件已经启动HTTP资源服务，后来的套件仍会删除它正在提供的组件脚本。使用生产装载器、公开SDK产物及真实HTTP读文件，启动第二次真实构建后，T10脚本读取ENOENT，装载结局script-load-failed，active为空，随后在原注册预算内报t10.register收件超时。正常两套件11场景与串行40次初始装载均通过，只有加入这一并发构建条件才出现目标红。

永久契约从公开buildTestAddons布局消费脚本：第二次构建期间，第一次已返回的资源必须仍可读取且内容不变。旧实现151ms失败，整轮215ms；候选160ms通过，真实HTTP对照756ms通过。永久测试不抽取私有实现，测试仅清理已核实由自身拥有的子目录。

历史run38450365230的a1中，T10运行窗口内T09在4516ms后启动；a3中，T09运行窗口内T11在2848ms后启动。条目5原run38141117256 a1中，T09运行窗口内T11在4029ms后启动。历史head756c1fe5的构建器同样删除共享根。这些记录与并发互删条件吻合；旧HTTP服务没有保留文件读取错误，部分场景没有断言装载结局，不将历史每轮的具体丢失文件说满。

**最小修正**：每次构建在已忽略的.build下创建独立run-*目录并返回布局，不再清空共同父目录。所有消费者仍从布局取路径，脚本与样式内容、生产装载器、注册和渲染实现、原等待预算及敏感分组不变。消费者存活期间产物保留；测试产物不进入VSIX。

基线26469180上compile/类型、完整Vitest8026/8026与Node194/194通过；七个已纳入调度器的SDK消费者三并发、禁构建复用通过（run-DmqnvK），独立T06真实键盘宿主六场景通过。真实VSCode1.82.3开发态T02装载/T09绘制接管/T10注册三例通过（1666/967/1120ms）。推送前基线另前移至17b999fd，本轮保留v1.0.2发布准备与相关改动后重新验证；不回填已发布CHANGELOG。

**独立旧断言另记**。未纳入调度器的T07键盘宿主脚本在首场景要求三个目录项，但#464夹具已增加恒不修饰、不上报行为事件的locale-name。旧共享目录产物与本轮隔离产物字节相同，均有该条目，失败不是构建隔离引入。修正为独立列举三个输入行为和多语言样例的四个ID；原默认链、调序、停用、IME、退格、表格源码与Tab七场景全部通过，未改生产行为或夹具。

条目6的额外30次0/80/200ms控制器重建对照通过，只覆盖内存桥与dispose路径，仍不覆盖真实VSCode销毁/消息保存的全部环节，继续未定因。证据为out/test/446-build-isolation-red.log / green.log、446-build-read-probe.log / green-final.log、446-build-consumers-browser-final.log、446-build-unit-full.log、446-build-native.log / report.log及446-build-diagnosis.md；目录断言证据为446-build-t07-browser.log / green.log。候选CI与本机证据分开记录，两套浏览器敏感组的恢复仍按既定多轮独立Linux验证条件评估。

同步17b999fd后，compile/类型、完整Vitest8034/8034与Node194/194通过；独立T12真实键盘宿主四场景通过。文件树相关职责和新契约已同步，strict通过；此前五项主线漏录由17b999fd收录，本轮没有重复补录。

完整浏览器三并发、禁构建复用为97/98通过（run-P20LWJ，304.08s）；SDK消费者全部通过，唯一失败是未改的addonSettings.mjs:293 textarea圆角expected2px/actual空字符串，另按设置页采样路径追查，不称全量全绿。独立审查指出回归测试应在取得布局后即登记自有目录，避免后续断言失败遗漏清理；修正登记时机后，公开构建契约1/1通过，187ms。

## #446 条目21：设置页textarea重建与绘制采样竞态（2026-10-14）

**目标红在原路径再现**。完整浏览器97/98后，只给原采样增加连接状态记录，不改变原输入、宿主回包与样式断言；十二次上限对照在第四次重现圆角空字符串。被测textarea已脱离DOM，display/radius/resize均为空、高度0；同一次回调查询到的当前textarea仍连接，圆角2px、高78px。设置保存回包会重建控件，Locator先取得节点再执行测量之间存在重建窗口。单独通过的三次记录均采到当前连接节点。

**公开回推红绿**。原Locator回调内经已有addons.settingsState消息触发生产设置页重建，稳定得到相同空串/0与当前2px/78px对照。候选改在同一页面回调内查询当前textarea并测量，十次真实状态回推后逐次验证原可见性、2px圆角、vertical及最小72px；原多行键盘输入、保存、数组粘贴及其余设置场景保留。没有改生产重建、DOM、CSS、样式契约、预算或分组。

完整addonSettings套件通过（run-UdDzwz，2.41s），诊断输出只在忽略目录。证据为out/test/446-note-normal-loop.log、446-note-forced-red.log、446-note-browser-green.log与对应浏览器报告；历史全量没有节点代次快照，本轮原路径补齐连接状态。该条目与条目12的mermaid.md宿主状态超时独立，不联动勾销。

## #446 条目22：图片总高变化先于锚点补偿完成（初步修正，2026-10-15）

主线548397c7的CI38591628850 attempt1第4片102/103，动态图片增高用例1898ms失败：240px增高后锚点视觉位置0.921875→220.71875。相同代码树的候选CI38590389656第4片同用例1320ms通过，原主线失败未重跑。此前等待只检查总高增量达到236px，随即断言锚点位置稳定；总高变化没有涵盖ResizeObserver排队、后续帧测量和滚动补偿。

**同形态快照已取得**。同一生产控制器、CSS、400块样本生成器、view.locate与reading.test.image公开钩子，受控时钟下仅改变定位后0/32/80ms的起步时机：内容总高已增长243px（仍在原±4px容差内），目标锚点6832保持，但视觉位置从−0.078125变为219.71875，旧等待已经放行。后续帧scrollTop从6450补到6670，视觉位置回到−0.28125；过渡中还会出现当前锚点身份尚未恢复的快照。直接执行实际等待回调，候选拒绝这些快照，等原目标身份、尺寸增长和视觉补偿齐备才完成。历史CI没有逐帧日志，不把本轮时钟阶段当作旧现场时间线；本机原用例单次2113ms通过，不能以此排除原竞态。

**修正只补齐集成采样条件**。原15秒预算、240px增高、目标锚点身份、2px视觉容差、总高±4px以及零写回断言保留；生产图片钩子、RO调度、补偿、DOM/CSS和core分组均未修改。该修正证明测试不得把尺寸抵达当作补偿完成，不证明所有过渡帧都不可见；持续不补偿或目标身份不恢复仍在原预算失败，最终断言继续执行。

永久契约执行真实采样回调，拒绝高度已增长但尚未补偿、仅初始20px、错误目标身份及缺少目标布局；旧实现先红，修正后整份就绪契约11/11绿。首次红测日志记录EXIT1，当轮JSON读出10过/1失败，目标期望undefined但实际放行快照；完整JSON随后被绿测覆盖，只保留读回观测摘要，不冒充原完整JSON。完整Vitest8035/8035、Node194/194与compile/类型通过。三用例烟测一度误用竖线分隔，筛选未命中、未执行用例，单独保留启动错误；正确入口使用逗号。

证据在out/test/image22-native-original.log / report.log、image22-browser-timeline.log、image22-browser-controlled-green.log、image22-readiness-red.log / red-observation.json / green.log、image22-unit-full.log、image22-compile.log与image22-native-final.log。诊断夹具和逐帧探针只在忽略目录；候选CI与本机证据分开，其他未归因条目不联动勾销。

推送前同步main38be3c75的Mermaid暗色/Live图形修正，compile/类型、文件树strict及真实阅读三例3/3通过（目标1082ms）。新基线全量首次与compile同机运行时两个Vitest worker异常退出3221226505，位于webLinkMetaService/proxyAgent，8022/8046完成、24项未完成，未进入Node阶段；无断言失败记录，另记条目23，不归为本票已修复。两文件单worker77/77、Node契约另跑194/194通过；无compile并行的一次独立全量8046/8046与Node194/194通过。原失败保留，条件相关不等于因果，不据独立通过勾销23；当轮旧JSON仍为此前11项报告，仅取带退出码的日志统计。

## #446 条目12：历史弹窗等待阶段定位与诊断补全（2026-10-15）

**后续入口已迁移**：本节保留历史调查记录；条目12仍未定因、未修复，现于[#552](https://github.com/ONEGAYI/vsidian/issues/552)等待新证据。旧 #446 已按用户要求归档关闭。

**已定位到第二段弹窗SVG等待**。原主线696a1668的CI38521864148第2片在60841ms超时。按原提交归档源码及原lockfile重新安装依赖，只重建集成入口（esbuild0.28.2、原node18/cjs配置）；lockfile与构建脚本git对象分别为7f1bd52c656cfd847a4ca35bc774a3700f79bcc9、b3685f5936b4c43823780365ff71db115176c78f。旧堆栈70875:13、76270:20、85812:9三处均与重建bundle对齐，source map对应cases.ts:1345、7464与index.ts:168；7464是弹窗请求之后等待overlay与overlaySvg的第二段。由此排除首次frame等待与后续reading等待为这一次超时所在阶段，不据此判定弹窗未打开还是取图失败。

当前12163dcf基线的真实Chromium/生产控制器、CSS、Mermaid产物和原五围栏fixture，在首次frame就绪后0/250/1000ms三种点击时机均装载SVG。首次快照可为5个frame、0个渲染终态，立即点击仍成功；不能把pending frame本身认定为根因。这是HTTP夹具对照，未复刻VSCode iframe与完整宿主条件，不替代旧Linux现场。初次探针误用不存在的media类名，后验overlaySvg实际为true；该装配错误单独保留，修正选择器后的三组均通过，不作为目标红。

**已修正的缺陷是超时报告丢失现有探针**。waitViewState原摘要省略live/reading Mermaid计数和paint中的Mermaid/graphic字段；即使最后采样已携带overlay、overlaySvg与渲染分态，报错仍只留下模式和光标等字段。永久契约直接执行实际waitViewState，用公开宿主采样边界提供两帧，验证超时报告保留最后一帧的图形字段与原错误文本；旧实现187ms稳定失败，最小修正只追加上述现有字段，12项就绪/诊断契约通过。生产取图、弹窗、DOM/CSS、原60秒预算、装载/绘制断言与分组均不动。此修正改善下一次失败的可归因性，条目12继续未勾销。

条目14另做保留前序用例的完整大纲组对照：Windows独立桌面、VSCode1.82.3开发态15/15，复制用例3865ms通过。旧copyChildren超时21795ms，没有最后实际剪贴板值或写入完成时间线；本次通过不作为根治，未改复制、互斥、预算或成品断言，仍未勾销。

日志为out/test/graphic12-historical-install.log、graphic12-historical-build.log、graphic12-stage-map.json、graphic12-browser-probe.log（装配错误）/corrected.log、graphic12-diagnostics-red.log/green.log和clipboard14-group-control.log/report.log。历史源码与source map仅为忽略目录中的诊断证据，不加入发行产物；临时DEBUG-graphic12探针不进入提交。

本地验证：compile/类型、完整Vitest8047/8047与Node194/194、文件树strict通过；真实VSCode1.82.3三项图形集成3/3（目标1933ms），graphicPopup完整原生浏览器套件通过（run-dTCq50，14.27s）。这些通过验证诊断补全未破坏原链路，不据此关闭条目12或14。

## #446 条目6：光标状态延迟与iframe销毁的交叠（初步修复，2026-10-15）

**异步传输下取得2029→0的确定性红**。使用VSCode1.82.3安装目录中的原API注入脚本、生产控制器与CSS、原viewport-mermaid.md及真实嵌套iframe。API先同步更新iframe内state，再经MessageChannel发送JSON；对照按该版本webviewElement.dispose的顺序移除iframe并停止接收。纯光标定位后0/80/200ms销毁的六次均恢复到0，300ms两次均保持2029。保留接收器只改一个变量，前三档各一次均恢复2029。

**销毁时补发已发送，但没有抵达被撤销的接收器**。pagehide和visibilitychange均触发生产flush，发送的anchor为2029；原250ms光标保存尚未到期，隐藏前宿主仍没有该锚点。保留接收器的对照收到补发，而按销毁顺序撤销接收器的对照未收到。这补齐了此前同一JS环境、同步内存桥的对照所缺失的边界。原失败CI38141117256没有消息时间线，本轮没有重新复现原生宿主的历史失败，不能将上述边界实验当作旧现场；条目6继续保留未勾选状态。

对应上游事实源为[1.82.3的API注入与MessageChannel](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/webview/browser/pre/index.html)、[状态接收与iframe销毁](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/webview/browser/webviewElement.ts)及[隐藏时释放webview](https://github.com/microsoft/vscode/blob/1.82.3/src/vs/workbench/contrib/webview/browser/overlayWebview.ts)。这些源码支持传输与释放机制，不包含旧CI的事件时序。

**修正为Live纯选区变化立即提交锚点**。移除对应250ms计时器，只复用既有persistState；光标变化不测量布局，滚动视口采样与恢复仍走原去抖。取舍是每次锚点变化会多发小型状态JSON，减少等待窗口；不宣称同一任务内发送后立刻销毁的异步消息必然送达。文本同步、历史、持久化格式、DOM/CSS及原用例预算与分组均不改。

永久viewMode契约在隐藏前检查桥状态，并以独立JSON快照重建新控制器；旧实现预期偏移24、实际undefined，修正后33/33通过。原异步通道矩阵12/12通过；使用真实Mermaid产物的0/80/150/200/300ms矩阵15/15通过，已观测到实际SVG和允许的error终态。完整Vitest8048/8048与Node194/194、compile/类型通过；原生viewToggle浏览器套件通过（run-Qq9nSl），真实VSCode1.82.3原Mermaid标签切换用例通过。

证据为out/test/mermaid6-public-seam-red.json/green.json、mermaid6-iframe-transport-observed.log、mermaid6-iframe-transport-green.log、mermaid6-iframe-real-paint-green.log及独立真实产物JSON、mermaid6-unit-full.log、mermaid6-native-green.log/report.log。诊断探针只在忽略目录；红轮通道JSON随后被同名绿轮覆写，原红取证以保留的带退出码日志为准，不冒充原完整JSON。自动验证不代替物理键盘/鼠标、IME与日用安装态人工验收。

### 实际编辑器的快速切页回归（2026-10-15）

本轮将纯光标保存窗口推进到实际VSCode1.82.3开发态路径：“定位到第123行、确认LF光标、立即打开另一标签再切回”，不先等图表或滚动稳定。永久回归采用同内容的viewport-fast-mermaid.md独立夹具，追加独立用例到清单末尾；原Mermaid用例本体、冷启动条件、围栏终态、中心行±2与光标保持断言以及已有分片位置均保留，新例仍为core、30秒恢复预算及零写回断言。

只在忽略目录构建替换修复前控制器，其他产物与夹具同a3f5c188。旧控制器对象33ae2fe9dc00f5921d842a6979b8c1df3992cef5与68f5a657源码一致；诊断原型中旧实现切走前选区2029、保存定时器仍pending、API缓存无新锚点，正常切页后恢复0，原30秒预算内失败（整例32247ms）。现行控制器切走前已保存2029，切回保持2029，完整原型4227ms通过；曾将阶段放入原用例的中间版本也取得32221ms红态，最终拆为独立夹具以保留原冷启动路径。新源码不新增生产接口或私有状态断言，永久独立用例的红绿另留证。

坐标以已就绪view.state.text的LF模型计算，宿主该fixture为CRLF，offsetAt第123行2151对应LF2029。诊断中未构建成功就启动的样本、使用宿主坐标导致切走前超时的样本及启动命令引号错误，均独立标为无效，不充当产品红测；原始日志保留。

本轮证明实际编辑器快速定位后切页的窗口，与此前真实API/iframe销毁对照相互支持。历史失败的原用例先等待围栏和视口落定，缺逐消息时间线，不能将新增快速前序冒充其原样现场或证明每次失败的唯一原因。条目6是否按初步范围收口以独立复核和最终候选验证为准；人工验收未联动。证据为out/test/mermaid6-followup-old-native-lf.log/report.log、current-native-valid.log/report.log、permanent-red-native.log/report.log与invalid-sample.md（同组均带mermaid6-followup前缀）。

最终独立用例在旧控制器下切回0，32137ms红态；正式构建去掉诊断字段/输出后，原Mermaid用例3451ms、新快速用例1114ms均通过。compile/类型、完整Vitest8051/8051与Node194/194、文件树strict通过；中间版本也做过完整回归，最终统计仅取final前缀日志。旧生产者只用于忽略目录的诊断产物，提交不包含生产控制器改动或额外协议字段。

## #446 条目24 / #550：视口保存窗口与源码中心（2026-10-15）

CI38684976209候选802d582a的原Mermaid切标签例62144ms超时，光标已为2029、围栏容器为0；同源测试堆栈定位到光标恢复后的围栏终态等待。main及精确候选的本机完整第1分片均通过，只作为负样本。

真实VSCode1.82.3的acquireVsCodeApi、MessageChannel及iframe销毁对照补齐了保存边界。生产控制器和真实Mermaid在围栏到终态后立即切走，隐藏前父端缓存只有anchor2029、没有viewport；销毁时flush已发出完整viewport，但接收器已撤销而未收到。重建后光标2029、scrollTop0、围栏为空。仅等待300ms或仅保留旧接收器的对照均正常。只保存像素值的中间实现仍使源码中心116→133，保留旧centerOffset也会回到上一次滚动区域。

修正为滚动像素位置立即写入桥缓存，新滚动清除旧源码中心提示；源码中心每帧最多读取一次并补写，替代250ms尾随采样。隐藏、销毁与模式切换取消在途采样。持久化格式、光标/文本编辑管线、DOM/CSS和原core分组、等待预算与绘制断言保持。

永久viewMode契约固定隐藏前JSON、覆盖Live/reading恢复及同帧三次滚动只读取一次最新中心。viewToggle夹具以销毁前缓存重建，销毁中补发不进入新实例；明暗主题继续验证两模式位置，新增第二次滚动不重放旧中心的场景。真实API/真实Mermaid修正后0/300ms对照均恢复4个围栏到既有终态、光标2029和中心行116。

历史CI缺少父端缓存与逐帧滚动记录，不证明本机制是该轮唯一原因；也不承诺同一JS任务发送后立刻销毁的异步消息必然送达。本项按已复现保存缺口初步修复，条目12的弹窗SVG等待另查，人工验收独立。证据为out/test/mermaid24-viewport-contract-red.log、frame-contract-red.log、viewtoggle-browser-red.log、iframe-viewport-real-baseline.log、iframe-viewport-real-keep-observer.log、iframe-real-frame-green.log及frame前缀回归日志；中间只保存像素值的失败另存，不充当最终验证。

## #552：等待缺口与符号套件开销加固（2026-10-22）

本轮以 `f7763956` 为基线，在 Windows / Node 24.20.0 / 锁定 Chromium / VSCode 1.82.3 开发态验证。生产代码、原断言、等待预算及 core/sensitive 名单保持原有语义；修订集中在测试驱动与采样条件。

| 对应记录 | 已验证的缺口与修订 |
| --- | --- |
| 条目35，symbolInput | 每场景重新装载编辑器脚本的累计开销可超过 120 秒。改为复用页面、脚本和 CDP 会话，每场景销毁重建生产控制器并清空消息与帧样本；新增设置和未确认编辑的隔离回归 |
| 条目26，IME 热切换 | 异步出站可能晚于唯一一次 ack，后续无人确认新请求。改为在原等待周期内持续履行宿主回执职责，落定后仍验证扩展摘除和文本完整 |
| 条目33，#13 零写回 | 新表头可早于 applyEdit 完成及计数结算到达。等上一操作计数推进后再取得拒绝操作基线，保留原零写回断言 |
| PR #603 后的 #281 保存失败 | 落盘不代表 dirty 已清零。保存等待同时覆盖新内容落盘和目标干净，再验证圆点消失与父文档不变 |
| PR #614 后的 #569 探针 null | 样式产物在场不代表 Reading 标签已挂载。等三个计算色取得字符串，错误颜色仍交原断言；超时摘要补 docStyle 末帧 |

**红绿证据**：执行真实集成采样回调，旧条件误放行 dirty 文档、未挂载标签及未结算计数，修订后拒绝这些快照。IME 探针暂缓组合结束的零延迟任务，首次 ack 为 null；释放任务后旧等待失败，持续回执后原三场景通过。探针使用 500ms 快速失败窗口，正式用例仍为原 30 秒预算。

symbolInput 原 76 场景本机基线为 37.024s；复用夹具并新增隔离场景后，最终三套件并发中的 77 场景为 6.33s。CDP 六倍 CPU 减速对照中，旧入口 120.701s 超时，复用入口 24.600s 通过。减速对照证明开销改进，不等同于复刻 GitHub runner，也不证明所有历史超时均由同一原因造成。

**本地验证**：28 项等待、诊断及分组契约通过；另 88 项 CSS 导入与同步控制器测试通过。最终 browser 的 symbolInput / addonHotSwitch / wikilinkSuggest 三套件通过。真宿主先跑 #13/#246/#281/#569/#570 五项，再补 #381 三项；计数修订后单独复验 #13 通过，类型检查通过。首次启动因工作树缺 .vscode-test 目录而未进入用例；中间一次 #13 因新增变量误放相邻用例失败。两者均已修正，失败日志分别保留。

**未定因部分**：条目25 的 88 项单测及 #246/#381 原等待本机通过，只作为负样本；条目12仍按既定安排等待新证据。PR #606 的跨功能八项超时未取得新的 runner/文件事件证据，不作同因判断。GitHub 台账未勾销，Linux CI 与人工验收未由本机检查替代。

日志在工作树 `out/test/552/`：readiness-red-report.json、readiness-green.log、table-counter-red-confirmed.log、final-unit.log、addon-red.log / addon-green.log、symbol-slow-red/ / symbol-slow-reuse/、browser-final.log、integration-targets-host.log、integration-381-host.log、integration-table-fixed.log、typecheck-final.log。最终 browser 完整报告为 `out/test/browser-runs/run-KouZ4g/`。失败与通过记录分别保留，不因阶段切换重跑全量。
