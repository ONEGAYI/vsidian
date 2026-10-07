# Vsidian 附加组件首版：用户故事覆盖映射

状态：2026-10-08，随 T18（#367）收口建立。本表是首版批次「29 项用户故事 → 子票 → 公开接口/语义 → 验证用例」的覆盖证据索引：每项已确认规则须有**实际公开接入路径**的验证，不以内部 mock 代替验收。自动化通过不构成用户已验收；人工待验项见 [manual-verification.md](manual-verification.md) 附加组件条目（A59–A66）。

事实源与本文关系：

- 用户故事编号与定义：[vsidian-addons.md](vsidian-addons.md) §2；子票对应关系见[批次索引](batch-2026-10-vsidian-addons.md)「用户故事覆盖」。
- 公开接口条目 ID（下表「接口映射」列）指向语义清单 [src/shared/addonApiCatalog.ts](../../src/shared/addonApiCatalog.ts) 的 `ADDON_API_ENTRIES`（22 条目，签名不手写第二份）。
- 验证证据路径为仓库相对路径；`t18-*` 日志为 T18 全矩阵回归本轮产物（`out/test/`，不入库）。

## 两组「六组」的对应

规格宣传的六组能力面（视图与编辑、内容渲染、操作与界面、设置、生命周期与通信、诊断）与 API 目录的六个分组（`discovery` / `page-sdk` / `behaviors` / `settings` / `renderers` / `commands-menus-ui`，按实现模块面分组）不是一套切法。对应关系：

| 规格能力面 | API 目录承载条目 |
| --- | --- |
| 视图与编辑 | `views-editor`、`behaviors-register`（+ `behavior-order-state`） |
| 内容渲染 | `renderers-register`、`renderer-selection` |
| 操作与界面 | `commands-register`、`menus-register`、`ui-buttons-panels` |
| 设置 | `settings-context`、`settings-definitions`、`settings-scope` |
| 生命周期与通信 | `addon-definition`（setup/enable 两段生命周期）、`page-sdk` / `page-load-protocol` / `page-bridge` / `channel`、`cm6-experimental` |
| 诊断 | `addon-status`（状态与故障呈现）、`addon-definition`（故障暂停语义）、`official-registry`（归属登记）；日志与 `diagnostics.reportFault` 语义并入 `addon-definition` 与 `settings-context` 条目 |

## 29 项用户故事映射

图例：验证层缩写——**单**＝Vitest 单测；**浏**＝生产控制器浏览器（原生键盘/CDP IME）；**集**＝开发态真宿主集成；**装**＝安装态五阶段（VSIX 链，`runInstalledAddons.mjs`）；**SSH**＝Remote SSH 两阶段（`runRemoteSshAddons.mjs`）；**样**＝三套独立消费样例（`test/examples/`，经公开面消费，开发态 `addonT15Cases` 与安装态/SSH 复用）。

| # | 用户结果（摘要） | 子票 | 接口映射 | 验证证据 | T18 复核 |
| --- | --- | --- | --- | --- | --- |
| 1 | 经 VSCode 发现安装 | #350、#365 | `manifest-declaration`、`register-addon` | 单 `addonIdentity/addonHostRegistration/addonCoordinator`；集 `addonT02Cases`；装 B/E（CLI `--install-extension` 真链 + 权威清单）；样 VSIX 安装；SSH R1 | 过（unit/集/装/SSH 全绿） |
| 2 | 仅列合法声明 | #350 | `manifest-declaration`（四种可辨认拒绝原因） | 单 `addonIdentity`；集 `addonT02Cases`（incompatible/declaration-invalid 状态） | 过 |
| 3 | 名称来源与实际状态 | #350、#354、#361 | `addon-status`（七状态 + fault 分离） | 单 `addonIdentity`；浏 `addonSidebar`；集 `addonT02Cases`/`addonT05Cases` | 过；观感待验 A59③ |
| 4 | 官方/第三方分组 | #354 | `official-registry` + `addon-status` | 单 `officialAddons`；浏 `addonSidebar`（三组分组/空态） | 过；观感待验 A59①⑥ |
| 5 | 新装兼容默认启用 | #350、#351、#365 | `register-addon`、`addon-definition` | 集 `addonT02Cases`；装 B（发现注册三态）；样（发行态默认放行 + arm 观测） | 过 |
| 6 | 关闭选择持久保留 | #353、#354、#365 | `settings-scope`（user 层）、`addon-definition`（enable 开关） | 浏 `addonSidebar`；集 `addonT05Cases`；装 B/D/E（写入链 + 会话内闭环） | 过；**跨会话读取面受测试宿主 in-memory 限制**（T16 已知边界 2），真实重启保留待人工（A62②） |
| 7 | 已开文档热切换 | #351、#354、#358、#365、#367 | `page-sdk`（代次硬边界）、`page-load-protocol` | 浏 `addonHotSwitch`（CDP IME 组合中切换不丢输入）；集 `addonT05Cases`；装 B（装载指令 diff + 兜底重开） | 过（T18 browser 全量含 addonHotSwitch） |
| 8 | IME 输入与历史安全 | #348、#349、#352、#355、#356、#367 | `views-editor`（revision 快照）、`page-sdk` | V01 探针（真宿主 16 + CDP 4）；浏 `addonPageSdk`/`addonHotSwitch`/`addonT06EditHost`/`addonT07Behaviors`；集 `addonT06Cases`/`addonT07Cases` | 过（T18 browser 全量四 host 套件绿）；真机 IME 观感待验 A63① |
| 9 | 同操作按序共同执行 | #356、#357 | `behaviors-register`（默认可组合 + 显式独占组） | 单 `addonBehaviors`/`addonBehaviorRuntime`；集 `addonT07Cases`；样 input-behavior（真实键入三行为链） | 过 |
| 10 | 行为冲突管理调序/部分关闭 | #357 | `behavior-order-state` | 单 `addonBehaviorStateService`；浏 `addonT08BehaviorsManage`；集 `addonT08Cases` | 过；观感待验 A60 |
| 11 | 行为名称及归属 | #356、#357 | `behaviors-register`（名称必填 + 组件命名空间） | 同上（管理列表按名称与所属组件展示，目录上报对账） | 过；观感待验 A60④ |
| 12 | 渲染安装后自动替换 | #358、#365 | `renderer-selection`（Q28 自动接管） | 单 `addonRendererTakeover`/`addonRendererService`；浏 `addonRendererTakeover`；集 `addonT09Cases`；装 B（builtinSvg=0 绘制层）；样 renderer（mermaid-lite 接管） | 过；真机观感待验 A64 |
| 13 | 用户默认与工作区覆盖 | #353 | `settings-context`、`settings-scope` | 单 `addonSettings`/`addonSettingsService`/`addonRuntimeSettings`；浏 `addonSettings`；集 `addonT04Cases` | 过 |
| 14 | 清除覆盖恢复继承 | #353 | `settings-context`（clearWorkspaceOverride） | 浏 `addonSettings`（清除回退断言）；样 ui-command（分层 default→user→workspace→清除） | 过 |
| 15 | 数组与对象设置 | #353 | `settings-definitions`（一层结构） | 单 `addonSettings`；浏 `addonSettings`（数组/对象基础控件）；样 ui-command（enum/boolean/对象/数组四定义） | 过 |
| 16 | 手动停用后仍可配置 | #351、#354、#365 | `addon-definition`（setup 普通停用保留）、`settings-context` | 浏 `addonSidebar`；集 `addonT05Cases`；装 B（停用后定义与值保留） | 过；观感待验 A59② |
| 17 | 故障原因与手动重试 | #361 | `addon-definition`（全组件暂停 + 代次重试）、`addon-status`（fault 呈现） | 单 `addonRuntime`；浏 `addonSidebar`（重试按钮）/`addonT12FaultPauseHost`；集 `addonT12Cases`；装 B（故障全暂停→编辑可保存→重试恢复）；样 renderer（armCrash + releaseAndReRegister） | 过；观感待验 A59③、A65 |
| 18 | 自定义页故障时平台排障 | #354、#361 | `settings-context`（故障期基础控件 + 平台保留定义） | 集 `addonT05Cases`（排障块）；浏 `addonSidebar`；装 B | 过；观感待验 A59③ |
| 19 | 引用编辑归 B 不误改 A | #348、#352、#355、#367 | `views-editor`（统一句柄目标归当前文档；embed occurrence 身份） | V01 探针（A/B 隔离）；集 `addonT06Cases`/`addonT11Cases`（embed.test.focus 路由）；样 ui-command（面板 target 句柄） | 过 |
| 20 | 同宿主及 Remote 排障 | #350、#366 | `addon-status`（host-unavailable 不臆断原因） | SSH R1/R2（同宿主安装、远端清单镜像、失败侧诊断）；集 `addonT02Cases` | 过（T17 链路重跑绿；发行态设置写入通道不可达的未验项见票面） |
| 21 | 自己的命令菜单按钮面板与设置 | #354、#359、#360、#364 | `commands-register`、`menus-register`、`ui-buttons-panels`、`settings-context`（registerPage） | 单 `addonCommands`/`addonCommandService`/`addonCommandsRuntime`/`addonUi`/`addonUiRuntime`；浏 `addonT10Commands`/`addonT11Ui`；集 `addonT10Cases`/`addonT11Cases`；样 ui-command 全覆盖 | 过；观感待验 A61、A63③ |
| 22 | 宿主/页面 JSON 通信 | #349、#351、#364、#366 | `channel`、`page-bridge`、`page-load-protocol` | V02 探针；单 `addonPageLoader`；浏 `addonPageSdk`；样 ui-command（通道读写）；SSH R1（远端通道） | 过 |
| 23 | 注册与资源释放 | #349、#351、#359、#360、#361、#365、#366、#367 | `page-sdk`（onDispose/代次回收）、`addon-definition`（清理回调）、`ui-buttons-panels`（mount/unmount 回收）、`renderers-register`（release） | 单 `addonPageLoader`/`addonUiRuntime`/`addonRenderersWeb`；浏 `addonPageSdk`/`addonT11Ui`（迟到结果不可见）；集 `addonT12Cases`；装 B/E（重复注册幂等）；SSH R1（卸载释放与手动重接） | 过（T18 稳定性抽验复核重复开关与视图释放，见回归报告） |
| 24 | API 版本文档及兼容弃用 | #362、#363、#364、#365、#367 | 发行台账 `ADDON_API_RELEASES` + 移除规则常量；门禁 `check:addonapi`/`check:addoncompat` | 单 `addonApiRefGen`（台账诚实性负向矩阵）/`addonApiSurface`；T14 基线 + 负向演示（`docs/specs/addons-api-gate.md`） | 过（T18 两门禁重跑绿 + baseline 锚定） |
| 25 | 复用 VSCode 调试与日志 | #361、#362、#364 | `addon-definition` 诊断语义（输出通道、来源标识） | 集 `addonT12Cases`（日志通道）；样（宿主观测自报）；指南 `docs/addons/`（F5/Webview devtools 说明） | 过 |
| 26 | 修饰默认原子独立撤回 | #348、#352、#355、#356、#367 | `views-editor` history（atomic 缺省独立撤回边界） | V01 探针；单 `addonHistoryGrouping`/`addonHistoryCoordinator`/`addonEditApi`；集 `addonHistoryCases`/`addonT06Cases`；浏 `addonHistoryHost`（真实 Ctrl+Z） | 过 |
| 27 | 非原子随上次原子撤回 | #348、#352、#355、#356、#367 | `views-editor` history（joinPrevious + history-boundary 四形态） | V01 探针；集 `addonHistoryCases`；样 input-behavior（括号补全 joinPrevious） | 过 |
| 28 | 正常/整组件故障停用后内置显示 | #358、#361、#367 | `renderer-selection`（Q30 接管条件表） | 浏 `addonRendererTakeover`；集 `addonT09Cases`/`addonT12Cases`；装 B；样 renderer（正常停用降级 + 首选保留 + 恢复、故障降级 + 重试） | 过；真机观感待验 A64 |
| 29 | 仍运行组件负责自身渲染 bug | #358、#361、#367 | `renderer-selection`（仍运行不自动接管） | 单 `addonRendererTakeover`；样 renderer（flow-buggy 自处理降级占位不被换回）；集 `addonT09Cases` | 过 |

## 公开接入路径声明（不以内部 mock 代替）

覆盖表中的行为验证均满足以下之一，未以内部控制器直接充当 SDK：

1. **消费样例**（`test/examples/` 三工程，独立 VSCode 扩展形态，经 `vsidian-addon-sdk` 构建桥消费公开面）在真宿主/安装态/SSH 的端到端用例——这是公开接入路径的主体。
2. **浏览器 host 套件**（`addonHistoryHost`/`addonT06EditHost`/`addonT07Behaviors`/`addonT12FaultPauseHost` 等）经生产控制器 + 真实键盘/IME 驱动公开编辑与行为面。
3. **单测仅覆盖纯逻辑**（选择算法、解析、状态机），不承担「公开接入」语义的验收；表内凡单测独证的条目（如 `settings-definitions` 的形状校验）另有浏/集/样层的路径验证同故事整体。

内部模块（`src/host/addons/` 各服务）不经由组件可达：`test/unit/addonApiSurface.test.ts` 钉住消费导入白名单与 type-only 边界。

## 未验项与限制（如实保留）

- **跨会话持久保留**（故事 6、12、24 相关）：测试模式宿主 storage 为 in-memory（T16 已知边界，三途径实证），重启/升级后偏好与首选的读取面不可自动化——写入链路、会话内闭环与权威清单已自动验证，真实重启保留归人工（A62②）。
- **发行态设置写入通道**（故事 20 相关）：SSH 会话远端 ext host 不继承本地 env，发行态语义下测试钩子缺席，组件设置写入通道不可达（T17 未验项，票面已记录）；默认放行路径已验。
- **真机 IME/物理输入/视觉观感**：故事 3/4/7/8/10/11/12/16/17/18/21/28 的观感面归人工清单 A59–A66，自动化通过不写成用户已验收。
- **API 尚为候选**（故事 24）：台账 1.0.0 = candidate，未对外发行、无兼容承诺；SDK 构建桥与类型声明现位于 `test/fixtures/addon-v02/sdk/`，独立成包时签名源随迁（T13 已知边界）。
- **远端必需检查未配置**（故事 24）：`check:addonapi`/`check:addoncompat` 的 CI job 已接线，远端分支保护必需检查名单待用户授权配置（T14 已知边界）。

## 维护约定

全矩阵复现命令（与 T18 票面证据同口径）：`npm run compile`、`npm run test:unit`、`npm run test:browser -- --no-reuse`、`npm run test:integration`、`npm run check:stylecontract`、`npm run check:addonapi`、`npm run check:addoncompat`；安装态与 SSH 线分别为 `node test/integration/runInstalledAddons.mjs`、`node test/integration/runRemoteSshAddons.mjs`（各票面载有前提）。

本表随批次收口建立，此后接口或验证变更时由触碰对应面的票顺带更新（同 `addonApiCatalog.ts` 的维护纪律：改接口必经语义清单与本文）。29 项全绿的口径以 T18 全矩阵回归报告为准（`out/test/t18-*.log`，矩阵结论见票面 t18.md 回填）。
