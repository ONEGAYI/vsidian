# 统一组件主题与 Codex 内核退役规格（#533 / #535）

## 1. 状态与交付顺序

2026-10-15 用户确认主题统一单选、安装只新增候选、跟随 VSCode 生效明暗，以及替代组件先可安装可用、内核 Codex 后移除。#533 为规格/父票；T07（#546）统一主题机制已实现，待用户整体验收；T08（#535）已于 2026-10-17 实施（旧设置迁移与一次性引导落地，安装态组件版验证、包体实测与阈值重估均已落档，见 §10/§10.1），整体待用户验收。依赖、票号和组合验证记录见[批次索引](batch-2026-10-addon-api-extensions.md)。

架构事实源为 [ADR-0017](../adr/0017-unified-addon-theme-selection.md) 与 [ADR-0012 的主题例外](../adr/0012-vsidian-addons-distribution-api-governance.md)。本规格细化接入和验证，不复制 API 签名或伪称组件已经发行。

## 2. 用户故事

1. **H-U01**：作为用户，我希望 Codex 与其他组件主题都出现在同一页签，以便只在一个地方选择主题。
2. **H-U02**：作为用户，我希望主题选择唯一且互斥，以便选中项就是实际使用的主题。
3. **H-U03**：作为用户，我希望安装主题组件只增加候选，以便当前主题不被自动改掉。
4. **H-U04**：作为用户，我希望主题设置持久保存且重新打开正确回显，以便重启不会改变选择。
5. **H-U05**：作为用户，我希望组件不可用时回落显示但保留主题首选，以便恢复后继续原选择。
6. **H-U06**：作为用户，我希望图形跟随 VSCode 的当前明暗，以便与编辑环境一致。
7. **H-U07**：作为组件作者，我希望读取明暗当前值并收到变化通知，以便更新已挂载图形。
8. **H-U08**：作为用户，我希望显示名称随界面语言变化且能搜索定位主题设置，以便找到正确选项。
9. **H-U09**：作为 Codex 用户，我希望替代组件可安装可用后再移除内置主题，以便不会出现无替代实现的空档。
10. **H-U10**：作为升级用户，我希望旧 codex 设置回落 default 并只收到一次安装引导，以便知道主题的新去向。
11. **H-U11**：作为用户，我希望 default 主题及普通非主题渲染组件保持既有行为，以便主题迁移不扩大影响范围。
12. **H-U12**：作为维护者，我希望移除 ELK 与 Codex 内核适配后实测包体并保持样式兼容，以便发布预算和旧片段仍可信。

## 3. 宿主主题目录

### 3.1 登记与身份

组件在宿主运行功能阶段登记主题元数据，目录不依赖打开某个编辑器页面。声明包含组件内稳定 ID、多语言名称，以及主题关联的本组件渲染提供者与其语言；平台注入组件命名空间，稳定主题身份与显示名分离。

每个主题对同一语言只能关联一个本组件提供者，不接受借主题登记改写其他组件身份。登记校验和批内重复拒绝属于普通 API 结果；停用、故障、注销、卸载和代次结束回收目录与可用性。页面的 renderers 注册仍负责实际执行代码，不能因元数据存在就调用尚未装载的渲染器。

该能力进入稳定 API 候选目录。当前候选 1.0.0 与独立 API 台账的事实不变，不把本体版本当作新的 API 发行记录。

### 3.2 唯一选择与实际渲染

沿现有外观 profile 设置持久化一个全局主题首选，默认是内置 default；不为主题新加用户/工作区两层选择。原「预设主题」第四页签原位更名为「主题」，所有组件主题进入同一选择入口，不增第二个渲染器主题下拉框。

选中主题对其声明语言生效；未声明语言继续一般渲染选择。主题关联提供者只有在其主题被选中时才参与该主题的有效选择，不能因为新安装批次而自动抢占。普通非主题提供者仍沿现有 renderer-selection 规则。

同一组件可有主题提供者和其他普通提供者，分类按关联身份区分，不以“整个组件有一个主题”禁用其所有其他能力。主题用户选择与实际表通过同一宿主权威状态协调，禁止另存一个可独立写入的页面首选互相覆盖。

选择 default 使用内置显示；选中组件主题不可用时回落内置，保留原主题首选并明确回显不可用/当前回落状态，不静默选中另一主题。恢复或手动重试成功后按原首选显示；不自动重试故障组件，不把仍运行的输出 bug 当作降级条件。

### 3.3 过渡内核 Codex（历史）

T07 属于扩展阶段：内核 codex 枚举与实现暂时保留，旧值仍可回显并使用。T08（2026-10-17）已执行旧值迁移与删除：存量 codex 设置在激活时经 globalState 原始 overlay 迁移回落 default 并收到一次性安装引导；内核枚举、色板、图类适配与 ELK 依赖已删除，组件版 Codex 由替代扩展（vsidian-codex-bridge）提供。

## 4. 页面明暗状态

编辑器页面提供独立只读主题环境能力，包含同步当前快照和变化订阅，不扩充为任意 VSCode configuration 读取。沿实际宿主主题四态取得亮/暗及高对比事实，不能把亮色高对比误判为暗色。

状态来源是 VSCode 当前实际生效主题：系统变亮、VSCode 手动固定暗色时仍为暗；VSCode 跟随系统自动切换时，页面与组件随之变化。通知在页面缓存更新后送达，回调中再次读取拿到相同新状态；重复值不重复广播，代次释放自动退订。

现有实验 hostSettings 白名单、默认值和拉取式语义保持，不借此开放 workbench 配置全量读取。组件在明暗回调中更新已挂载文档图形，旧异步渲染结果由现有挂载代次拒收。

图表弹窗继续[现有快照语义](appearance-merge.md)：已取出的弹窗画布不自动改写，刷新/重开与新导出读取当前主题；文档内 Live/阅读图形及时重画。SVG/PNG 背景、图内显式配置优先等现有 Codex 行为由替代组件保留。

## 5. 设置页与呈现要求

采用 ui-patterns 的既有 pill 页签、组头与标准设置行；沿现有外观大卡片承载组头，不嵌套新卡片或发明档位。选择控件保持单选、键盘可达与清晰不可用状态，必要说明走既有 callout/状态行。

显示名使用组件多语言映射，平台标签、错误、迁移提示与页签名称经双语 i18n。搜索路由、选项定位、持久化与重新打开回显同步更新。主题设置不是编辑操作，不新增默认快捷键。

公开 `.vsidian-mermaid` 族、阅读侧入口和错误态语义保持。样式技能的历史基线使用现有 v0.4.0 独立锚点；不能仅保留空壳类名却把图形绘制移动到旧片段无法命中的节点。

## 6. 组件接续与内核退役（T08 / #535）

### 6.1 非循环前置

T07 完成后，bridge#3 可实现并验证组件主题，不依赖 #535 的删除动作。#535 反向等待 T07、bridge#3，以及一份经安装验证的兼容 VSIX/安装渠道产物。可安装可用以具体版本或提交及安装测试记录证明，不能仅凭“API 已合并”或“组件票已关闭”。

本批只修改 bridge#3 的上游依赖和已定主题语义；Mermaid 运行时来源、ELK 加载和实际发行由组件仓库原票继续决定。组件不要求等待全部粘贴规则或导航票完成才能提供主题。

### 6.2 迁移与删除

- 对仍有效选择旧内核 codex 的 profile，迁移为 default，并提供一次性安装引导；已明确选择组件主题或 default 的用户不被残留旧键覆盖。
- 一次性标记与设置同 profile 持久化，重开设置/文档、重启与多窗口不重复发同一迁移引导；不自动安装组件，不自动替用户选组件主题。
- 回落与迁移完成后删除内核专属枚举、色板、图类适配、ELK 依赖及构建分块；内置 default 渲染和公开样式入口保持。
- 打包实测移除后的总体积与单文件最大值，再重估 scripts/release.mjs 的 SIZE_LIMITS，不能拍脑袋恢复某个旧阈值。预算变更需同步项目 release 技能及包内容检查。

## 7. 验证与门禁

- T07 先写单测钉住宿主目录注册/回收、稳定身份、多语言、全局唯一首选、安装不抢占、主题/普通提供者区分、不可用回落与恢复；明暗订阅覆盖缓存先更新、四态与释放。
- 浏览器使用真实设置页与组件消费夹具验证页签更名、单选、来源、搜索定位、保存与重开回显，以及文档图形实际配色。至少一条断言落在绘制层，不能只查选项存在。
- 真宿主验证无编辑器时目录可见、已开多文档切换、主题事件广播与组件停用；API 清单、参考、消费者、覆盖映射及兼容重锚定随实施票维护。
- T08 使用旧设置升级夹具和已安装组件产物，验证 default 回落、引导一次性与组件版 Codex 可选；对流程图及六类适配保留亮暗、布局、画布和导出对照证据（实施口径：本仓自动化收敛为选路正确 + 渲染成功 + default 弹窗/导出回归，六类视觉对照由 bridge 仓逐值对拍与人工待验承载，详见 §10.1）。
- T08 执行 compile、unit、browser、integration，以及 release 打包/包内容与样式契约检查；首次长命令落日志和退出码，复核读报告，不为补看信息重跑。全量宿主按分片或放宽预算，不与 browser 全量同机争抢预算。
- 两票均按项目 ui-patterns/style-contract 要求留证，不能因未改变选择器名字就省略实际命中验证。真实视觉、物理鼠标与安装体验仍记录人工验收状态，不把自动化当作用户验收。

## 8. 不包含与收口

不开放组件接管整个外观页、任意配置读取、自动安装、自动发布、第二个主题选择入口或独立操作系统主题覆盖。本文不新增 CSS 主题变量系统，也不把任意代码块渲染组件都改成主题。

T07 覆盖 H-U01–H-U08、H-U11；T08 覆盖 H-U09/H-U10/H-U12 并复验降级与明暗。#533 在 T07、T08 及对应验收完成前保持开放；#535 不因规格定稿而提前关闭。

## 9. T07 实施落档（#546）

宿主目录事实源为 `AddonThemeService` 与 `src/shared/addonThemes.ts`，公开入口为 `AddonEnableContext.themes`。目录采用按组件整组替换，稳定身份由平台组合；同组件多个主题可以支持同一语言。撤销登记后，当前运行代次仍保留已声明提供者的主题分类，防止页面残留候选变成普通渲染器自动接管；组件代次结束后分类一并回收。

唯一首选使用 profile 设置 `appearance.theme`。设置页每次选择经 `appearanceThemePatch` 同拍写旧 Mermaid 键的内置投影，保留 T08 前旧 codex 设置回显。组件主题不可用时保留首选及不可用行，不自动换选；该主题声明外的语言继续一般渲染规则。

失效主题的声明语言回落内置，不由同语言普通提供者接管。宿主仅为当前唯一首选保存最后成功登记语言的 profile 派生快照，支持停用后冷启动；它不能独立改选主题，也不持久化整个历史目录。切换首选时收回旧快照，同身份重新登记时更新范围；真正未知且没有可信快照的 ID 不推断语言。名称映射在登记边界复制，作者复用并修改原对象不会污染宿主旧快照。相关审查、失败先行及真实同语言竞争证据见[批次记录](batch-2026-10-addon-api-extensions.md)。

页面 `sdk.themeEnvironment` 使用宿主实际主题事件，亮色高对比保持 `dark=false`；缓存先更新、重复值去重、代次退订和组件异常归因都在公开 SDK 消费链验证。已打开图形由组件回调更新；图表弹窗继续既有快照语义。

界面沿用外观第四个 pill 页签、组头图标、标准设置行和徽章，原生 radio 为 16px，未增加卡片层级。新增 UI 档位说明位于 [ui-patterns §2.3](ui-patterns.md)。公开 `.vsidian-mermaid` 族、阅读入口及 CSS 变量未改，历史对照保持 `v0.4.0`（`75c3df79074bdeaec0f02a38d40124f0cd66f857`）；本票起点 `84e91ea028ac64d5f7fab38d51b6b7472494ca3f` 固定未发布实现。样式基线复验与八项门禁仍使用独立历史材料，不改写样式基线。

既有 `settingsPage` 浏览器回归同步改为主题 radio 和新页签名称，保留组头图标、负边距、描边及持久回显断言；亮暗两轮通过（`t07-resume-settings-browser-green.log`）。`addonRendererTakeover` 与 `graphicPopup` 定向回归通过（`t07-resume-graphics-browser.log`），分别保护普通提供者规则和内核 default/Codex 的弹窗快照、配色与导出。

接手续作证据保留在 T07 工作树的 `out/test/t07-resume-*`：边界和回调先红后绿，17 个 focused 单测文件 360 项、compile、`addonThemes` 浏览器五场景及样式契约通过。真宿主 `t07-resume-integration2.log` 为 1/1 通过，覆盖无文档目录、两文档图形计算色、四态主题事件与停用恢复；首轮夹具光标落在围栏导致源码态等待超时，已改为定位到尾段后复验。多文档接线复用 T03 确认的 `panelStateKey(docUri, sessionId)`，避免不同文档的同名 panel ID 相撞。联合全量回归由汇总分支执行；人工检查主题列表与真实系统跟随体验仍待用户验收。API 仍为 1.0.0 候选，不添加发行日期；签名及 renderer-selection 主题例外显式重锚候选兼容基线，理由见 [API 门禁规格](addons-api-gate.md)。

## 10. T08 实施落档（#535，线 1：迁移与删除，2026-10-17）

迁移单一事实源在 `src/shared/codexMigration.ts`（三档矩阵纯函数 `planCodexThemeMigration` + 宿主编排 `runCodexThemeMigration`），vscode 层装配在 `src/host/codexMigrationWiring.ts`。**判据读 globalState `vsidian.settings` 原始 overlay**（未经 sanitize）——旧键定义删除后 sanitize 会把残留 codex 当未知键吞掉，快照层无法区分「曾是 codex」与「从未设置」，一次性引导将永不触发。迁移直写原始 overlay 层（不经 SettingsService.apply——旧键定义删除后任何经 apply 写旧键的补丁都会被定义校验整批拒绝）。

三档矩阵（激活时执行，extension.ts 语言装配后面板建立前）：新键为 codex 身份，或新键 default/缺失且原始旧键 = 'codex' → 双键回落 default + 一次性引导；新键为组件主题身份 → 不动新键、只清旧键残留、不引导；其余无操作。一次性标记为可恢复状态机（PR #581 评审修复发现 1 + 三审 P2-B）：`{state:'pending'}` → `{state:'done', version}`，权威载体是 **globalStorageUri 下的磁盘状态文件 `codex-theme-migration.state.json`**（tmp+rename 原子写；profile 隔离由 globalStorageUri 本身承载）——快速路径、获锁重读与败者轮询全部读磁盘，**不依赖各窗口 globalState memento 缓存**（1.82.3 的 Memento.get 只读本地 _value、写入与跨窗广播分离，缓存过期会重复引导）。持久化顺序「先写 pending、再改设置、发引导、写 done」；pending 落盘后在**与 SettingsService.apply 同一进程内串行链**上重读最新原始 overlay 并按三档矩阵重新判定、只写主题相关键的最小补丁（三审 P2-A：等待窗口内用户保存的组件主题或其他设置不被 await 前捕获的旧快照覆盖；重判落到档 2/档 3 即用户已自行处置——不引导、直接写 done 收口）——任何一次写失败或进程中断后，下次激活从 pending 恢复（设置已迁移 → 补发引导后收口；设置未迁移 → 重走完整迁移，幂等），引导不因中途失败而永久丢失；残余崩溃窗口（引导 fire 与 done 写之间的无 await 同步序内进程被 kill / done 写失败，可能双弹一次）为声明的极端边界。多窗口并发（发现 2 + 三审同修 + 四审 P2-D）：迁移与恢复经 globalStorage 目录的**代次锁（fencing）协议**原子认领（`src/shared/codexMigrationLock.ts`；锁文件族 = 当前代次指针 `codex-theme-migration.lock.gen` + 各代次锁文件 `codex-theme-migration.lock.<n>`，内容 `{token,pid,createdAt,gen}`）——指针只经 tmp+rename 原子前进、首次创建后永不删除（**公开锁路径任意时刻存在**，不存在三审协议「先 rename 夺走再核验」造成的路径暂时消失窗口，第三窗口无法趁虚获锁）；认领 = 读指针 → 对 `lock.<gen+1>` O_EXCL 创建 → 创建后重读指针做**单调性校验**（持滞后指针读数的迟到者删自己的文件退场，绝不写回退指针）→ 指针原子推到 gen+1（提交点）；陈旧接管（阈值 10s）对 mtime 陈旧的当前代次直接以更高代次抢占，步进跳过「存在且已陈旧」的提交窗崩溃孤儿；释放 = 单条 rm **自己代次的确切文件名**（文件名即身份，无观察/校验窗口，旧 owner 永远够不到继任者的文件）；前代残留由新 owner 核对文件名代次后清理（只删严格更低代次，不按过期观察删当前/更高代次）；认领成功者执行完整序列；失败者短等待磁盘 done 出现即静默退出、超时也静默退出（绝不通知，待下次激活恢复）；胜者异常退出后等待者立即接力，胜者崩溃锁残留由陈旧接管兜底，提交窗崩溃孤儿由后续认领步进越过并清理，不影响磁盘 done 的幂等判据。迁移不广播 settings.changed——生产时序上面板建立晚于激活，装载拉取（settings.get）读到迁移后值。

内核删除面：旧键 `appearance.mermaidTheme` 定义条目与 `MermaidPreset` 类型删除（快照不再含旧键、写入按未知键拒绝；`MERMAID_THEME_KEY` 常量保留供迁移读写原始层）；`CODEX_THEME_ID` 与 `resolveThemePreferred` 的 **v1.1.0 兼容形状保留**（PR #581 评审发现 3 恢复兼容壳：前者为 `@deprecated` 常量、值恒 'codex' 不再代表内置身份；后者保留可选第二参 `legacyMermaidValue` 同标 `@deprecated`、传任何值不再影响解析结果——退役 codex 历史值按「目录不命中的未知首选」回落且首选保留）；`buildCodexMermaidConfig`、mermaidEntry 的 ELK import/注册与 codex 分支、mermaidRender 的 preset 机制、设置页内置 codex 单选项、locales `setting.mermaidTheme.*` 四键（两包同步退役，新增 `setting.theme.defaultOption`）全部删除。保留面：default 暗色链路（`MERMAID_DARK_FALLBACK_PALETTE`/`resolveVscodeMermaidPalette`/`buildDarkMermaidThemeVariables`）、站点配置恢复机制（frontmatter/classDef 覆写语义不变）、mermaid-chunks 分块机制、图表弹窗快照语义、公开 `.vsidian-mermaid` 样式族（样式契约基线 v0.4.0 改前改后八项检查均零失败）。`@mermaid-js/layout-elk` 依赖与 lockfile 已收口（306 包共享缓存重建）。

API 面：themes-register 条目 lifecycle 值域收窄为 `default | <addonId>/<themeId>`，候选兼容基线按门禁规格显式重锚（重锚前红证据与理由见重锚定提交及 [API 门禁规格](addons-api-gate.md)）；CHANGELOG-API Unreleased 记账——兼容形状保留（deprecated 常量 + 可选双参）后签名不再破坏，升版幅度预判**倾向次版本 1.2.0**（兼容性修订：语义收窄 + 弃用标注），留发行轮最终裁决，发行日期不在开发段预填。

引导文案 `host.codexThemeMigrated`（双语）：说明去向、当前回落 default、安装与选择归用户（不自动安装、不代选）；VSIDIAN_TEST_HOOKS=1 时通知短路（计数先于短路，集成断言「只引导一次」经 `_test.getCodexMigrationState` 观测）。`_test` 四钩子（get/inject/reset/run）按 VSIDIAN_TEST_HOOKS 门控注册，runner 每用例重置面并入标记清理。

先红后绿证据（日志在 T08 工作树 `out/test/`，均含退出码）：迁移纯函数 15 例（`t08-red-codexMigration.log` EXIT=1 → `t08-green1-codexMigration.log` EXIT=0）；既有单测翻转（`t08-red-flip-unit.log` 8 失败 → `t08-green-flip-unit.log` 132 例）；全量单测 375 文件 8773+ 例（`t08-unit-slice3b.log`，vitest 侧全绿；node --test 侧契约测试在重锚定提交后随 `t08-unit-final.log` 全绿）；API 重锚定红→绿（`t08-addoncompat-pre-reanchor.log` EXIT=1 → `t08-addoncompat-post.log` 10 项零失败）；浏览器 graphicPopup/settingsPage/addonThemes 及相邻 settingsPageRestore+mermaidPaint 全过；集成迁移用例与 T07 主题用例定向通过（默认独立桌面）。三审轮（PR #581 复审修复）：三项反例红 5 例（`t08-review3-red.log` EXIT=1，P2-A 两项 + P2-B/锁竞态）→ 修复后全绿（`t08-review3-commit2b.log` 四文件 54 项）+ 全量单测 377 文件 8776 例（`t08-review3-unit-full.log` EXIT=0）。四审轮（P2-D 锁协议）：受控调度反例红 12 例（`t08-review4-red.log` EXIT=1，对三审实现跑——生产链三窗口 guides=2、协议级接管/释放双 owner，经 `codexLockTestGate` 在每个 fs 原语边界注入第三方认领）→ 代次锁实现后全绿（`t08-review4-green.log` 三文件 41 项）+ compile（`t08-review4-compile.log` EXIT=0）+ 全量单测 377 文件 8779 例（`t08-review4-unit-full.log` EXIT=0）。安装态组件版 Codex 验证（真实安装 bridge VSIX 后经统一主题页选择）与包体实测/SIZE_LIMITS 重估不在本线，归后续线（线 2）。

### 10.1 线 2 落档：安装态验证、包体实测与阈值重估（2026-10-17）

**组件产物与安装验证记录（#535 验收标准 1 的一览）**：

| 项 | 值 |
| --- | --- |
| 组件 | vsidian-codex-bridge（ONEGAYI.vsidian-codex-bridge） |
| 版本 / 提交 | 0.1.0 / `75a0e5d2eb8bc73eace04881066fe7d1824d7bc4` |
| VSIX sha256 | `e0b6eda5242786b7c96cb8cd31f190517042fc6503f5b7e500faa8cf8f8c5bc3`（本仓实测复核一致） |
| 渠道 | GitHub Release（2026-10-16，组件仓自带独立桌面四层安装验证） |
| 旧版对照物 | 本仓 v1.1.0 VSIX（sha256 `0ab6b8182374c9edc9832cc113c0e73cc103c4e56f94f5f2623e1a5feb944ae9`，升级路径的「旧实物」） |
| 安装验证 | `test/integration/runInstalledCodexBridge.mjs` 两阶段真安装链全过（报告 `out/test/t08-phase-legacy.log` / `t08-phase-upgraded.log`，宿主默认独立桌面） |

安装态断言面（`test/integration/suite/codexBridgeInstalledCases.ts`，`VSIDIAN_T08_PHASE` 阶段门控）：legacy 阶段装 v1.1.0 旧 VSIX 证实旧枚举 codex 在旧版语义内合法可保存（升级前状态真实成立）；upgraded 阶段以 `--force` 同版本覆盖为本分支 VSIX + bridge 同装（本分支未升版本号，同版本覆盖承载安装链升级面，版本差异化升级链由 T16 E 先例覆盖），验证 bridge 经真实安装链被发现并注册 Codex 主题、选择后渲染选路走组件（`paint.renderers` 容器 provider 为 `ONEGAYI.vsidian-codex-bridge/codex-mermaid` 且真实绘制）、停用回落 default 且保留首选、恢复重新生效；升级迁移语义（旧键残留回落 default、引导恰一次、不覆盖已选组件主题）在安装产物上复验。

**通道取舍（已如实施行）**：1.82.3 测试宿主的 storage 完全 in-memory（T16 D/E 票面三途径实证，写入/预置均不落盘也不读盘），legacy 会话写入的 globalState 无法跨会话带到 upgraded 会话——升级残留以 `_test.injectCodexLegacyOverlay` 直写原始 overlay 承载（模拟磁盘上的旧键残留），真实跨会话落盘归人工验证清单（安装版真实升级路径）。

**六类图对照口径**：bridge v0.1.0 发行说明已载明其独立契约测试对拍内核色板（逐值迁移），本仓不重复对拍色板值；本仓安装态断言收敛为「选路正确 + 渲染成功 + 弹窗快照/导出链路不回归」（default 路径 graphicPopup 浏览器回归线 1 已覆盖）。完整视觉对照（六类图型亮暗、ELK 布局、画布、导出、显式配置）列为人工待验项（[manual-verification.md](manual-verification.md) T08 线 2 节）。

**包体实测与阈值重估（#535 验收标准 6）**：ELK 分块移除后实测 VSIX 413 文件、解压 12,916 KB ≈ 12.62 MiB（2026-10-17，日志 `out/test/t08-release-package.log` EXIT=0；ELK 在场时约 13.80 MiB）。据此提案总量两线各下调 1.0 MiB 至警告 13.5 / 上限 14.0 MiB（余量 0.88/1.38 MiB，沿 #338 与 ELK 两次裁决的余量风格），单文件 3/4 MiB 与图标 100 KB 不受影响不动；mermaid.js 经 ELK 剥离缩为 25,682 B 按需加载壳（渲染主体移入 mermaid-chunks 分块，最大 chunk 约 443 KB），单文件线锚定对象改为最大单项 main.js（2,573,352 B ≈ 2.46 MB）。**阈值下调无先例、属用户裁决面：上述数值已依据 #535 验收口径（依据实测重估）以提案值生效，发版/验收轮用户可整体回调**；三处同步已按提案值落齐（`scripts/release.mjs` SIZE_LIMITS 与注释史、release 技能「体积红线」节、`test/release/release.test.mjs` 钉值先红后绿）。
