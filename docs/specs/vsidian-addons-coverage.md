# Vsidian 附加组件首版：用户故事覆盖映射

状态：2026-10-08，随 T18（#367）收口建立。本表是首版批次「29 项用户故事 → 子票 → 公开接口/语义 → 验证用例」的覆盖证据索引：每项已确认规则须有**实际公开接入路径**的验证，不以内部 mock 代替验收。自动化通过不构成用户已验收；人工待验项见 [manual-verification.md](manual-verification.md) 附加组件条目（A59–A66）。

事实源与本文关系：

- 用户故事编号与定义：[vsidian-addons.md](vsidian-addons.md) §2；子票对应关系见[批次索引](batch-2026-10-vsidian-addons.md)「用户故事覆盖」。
- 公开接口条目 ID（下表「接口映射」列）指向语义清单 [src/shared/addonApiCatalog.ts](../../src/shared/addonApiCatalog.ts) 的 `ADDON_API_ENTRIES`（初版 22 条目，当前以生成参考为准；签名不手写第二份）。
- 验证证据路径为仓库相对路径；`t18-*` 日志为 T18 全矩阵回归本轮产物（`out/test/`，不入库）。

## 两组「六组」的对应

规格宣传的六组能力面（视图与编辑、内容渲染、操作与界面、设置、生命周期与通信、诊断）与 API 目录首版的六个分组（`discovery` / `page-sdk` / `behaviors` / `settings` / `renderers` / `commands-menus-ui`，按实现模块面分组）不是一套切法；2026-10 批次起 API 目录追加新分组（首项 `paste-conversion`，#541）。对应关系：

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
| 10 | 输入行为管理（原行为冲突管理，#465/#466 独立分页更名）调序/部分关闭 | #357、#465、#466 | `behavior-order-state` | 单 `addonBehaviorStateService`；浏 `addonT08BehaviorsManage`；集 `addonT08Cases` | 过；观感待验 A60/A71 |
| 11 | 行为名称及归属 | #356、#357 | `behaviors-register`（名称必填 + 组件命名空间） | 同上（管理列表按名称与所属组件展示，目录上报对账） | 过；观感待验 A71（观感项并入） |
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

## 粘贴转换批次故事映射（2026-10 批次，#530 规格冻结）

[声明式粘贴转换规格](addon-paste-conversion.md)的 11 项用户故事（P-U01–P-U11）按切片交付：T01（#541）覆盖 P-U01–P-U06、P-U09–P-U11 的基础链路；P-U07/P-U08（正则/条件/嵌套）归 T02（#542），复验全部基础故事。验证层缩写同上表；T01/T02 证据截至 T02 实施轮（基础故事随 T02 全量复验通过）。

| 故事 | 用户结果（摘要） | 切片 | 接口映射 | 验证证据 |
| --- | --- | --- | --- | --- |
| P-U01 | 宿主登记规则，已开与新开页面共用 | T01 | `paste-rules-register`（enable 生命周期 `paste.registerRules`，身份平台注入） | 单 `addonRuntimePasteRules`（enable 面乙/停用回收/迟到拒绝）；真 `richPasteUndoHost`（真实组件宿主登记，已开/新开双面板消费有效规则） |
| P-U02 | 来源特化 span 恢复为链接 | T01 | `paste-rules-register`（模板槽：字面转义/URL safeUrl/children 拼接） | 单 `htmlToMarkdownPasteRules`（命中/转义/URL）；浏 `addonPasteRules`（双载荷真实键盘） |
| P-U03 | 邻接 strong/code/pre 不被破坏 | T01 | 同上（单条成功只接管命中元素） | 单 `htmlToMarkdownPasteRules`（邻接保持用例）；浏 `addonPasteRules` |
| P-U04 | 不匹配/缺属性/输出非法回内置 | T01 | `paste-rules-register` errors（首条成功接管、失败继续、全失败回内置） | 单 `htmlToMarkdownPasteRules`（缺属性/非法 URL/失败回退）；浏 `addonPasteRules`（撤回后回退） |
| P-U05 | 关闭组件立即恢复内置 | T01 | `paste-rules-register` lifecycle（停用/故障/代次结束撤回并广播） | 单 `addonRuntimePasteRules`（停用/故障/代次回收，新代次登记后旧句柄不能撤回新规则）；浏 `addonPasteRules`（快照撤回与迟到旧版本不复活）；真 `richPasteUndoHost`（停用回内置、重启登记） |
| P-U06 | 纯文本粘贴绕过规则、富文本保留分步撤销 | T01 | `paste-rules-register` modes（纯文本/代码上下文不经规则；等值守卫） | 单 `richPasteAddonRules`（纯文本旁路/两阶段/等值单笔）；浏 `addonPasteRules`（Ctrl+Shift+V、首撤格式次撤文字）；真 `richPasteUndoHost`（真实规则 Ctrl+Shift+V 旁路、两笔 TextDocument Undo、双面板回流） |
| P-U09 | 多组件命中结果稳定 | T01 | `paste-rules-register`（优先级降序、组件 ID 升序、规则 ID 升序确定性序） | 单 `addonPasteRules`（排序）+ `htmlToMarkdownPasteRules`（冲突顺序首条接管） |
| P-U10 | 危险链接仍受 URL 策略限制 | T01 | `paste-rules-register` coordinates（URL 槽经既有 safeUrl） | 单 `htmlToMarkdownPasteRules`（javascript: 拒绝回内置） |
| P-U11 | 错误声明可辨认拒绝 | T01 | `paste-rules-register` errors（invalid-declaration/duplicate-id/too-many/released 整批拒绝） | 单 `addonPasteRules`（校验矩阵）+ `addonRuntimePasteRules`（拒绝不算故障） |
| P-U07 | 正则取值与条件组合 | T02 | `paste-rules-register` coordinates（正则槽：整匹/数字组/命名组捕获，受限 flags，注册时编译与组引用校验；条件树 all/any/not 组合基础/正则谓词；输入超限按取值缺失回退） | 单 `addonPasteRules`（正则校验矩阵/条件矩阵/深度与节点预算/常量钉住）+ `htmlToMarkdownPasteRules`（捕获组命中/无匹配回退/组未参与/输入超限/URL 槽 safeUrl/转义/编译失败回退；条件真值矩阵；多组件冲突确定性；步计费 101 步/段预算推导）；浏 `addonPasteRules`（真实键盘回放） |
| P-U08 | 子元素嵌套转换 | T02 | `paste-rules-register` coordinates（children 槽子规则集：与顶层同语言、ID 槽内局部、先子规则后内置、只向子节点下降；嵌套求值期间外层规则集不参与） | 单 `addonPasteRules`（嵌套深度 16/17、局部 ID、总量并入 256、非法嵌套矩阵）+ `htmlToMarkdownPasteRules`（嵌套命中/内置回退/内外规则不串味/不越出子树/表格上下文/15 层深链/求值异常不放大）；单 `addonRuntimePasteRules`（高级声明经同一登记面进快照、超深整批拒绝不算故障）；浏 `addonPasteRules`（嵌套 HTML 真实回放与分步撤销） |

本批次的公开接入路径：宿主注册面经 `AddonEnableContext.paste`（编译期消费 `test/addonApi/publicApiConsumer.ts` 钉住）；浏览器夹具 `addonPasteRulesFixture` 模拟快照广播，真实宿主探针 `richPasteUndoHost` 则加载 `addon-paste-rules` 夹具，经公开宿主登记→生产快照广播→生产页面粘贴→TextDocument 撤销与停用回收全链。该探针不直接注入规则快照；安装态与人工体验验收另行记录。

## 公开接入路径声明（不以内部 mock 代替）

覆盖表中的行为验证均满足以下之一，未以内部控制器直接充当 SDK：

1. **消费样例**（`test/examples/` 三工程，独立 VSCode 扩展形态，经 `vsidian-addon-sdk` 构建桥消费公开面）在真宿主/安装态/SSH 的端到端用例——这是公开接入路径的主体。
2. **浏览器 host 套件**（`addonHistoryHost`/`addonT06EditHost`/`addonT07Behaviors`/`addonT12FaultPauseHost` 等）经生产控制器 + 真实键盘/IME 驱动公开编辑与行为面。
3. **单测仅覆盖纯逻辑**（选择算法、解析、状态机），不承担「公开接入」语义的验收；表内凡单测独证的条目（如 `settings-definitions` 的形状校验）另有浏/集/样层的路径验证同故事整体。

内部模块（`src/host/addons/` 各服务）不经由组件可达：`test/unit/addonApiSurface.test.ts` 钉住消费导入白名单与 type-only 边界。

## 2026-10 扩展批次：文档导航（#543 / T03）

以下故事定义见 [addon-navigation.md](addon-navigation.md)，公开接口映射为 `document-navigation`；普通链接语法 N-U08–N-U11 由 T04（#534）交付，无新增公开 API 面（形态学解析在宿主链接通道内）。

| 故事 | 公开接入与验证 |
| --- | --- |
| N-U01 / N-U02 / N-U05 | 夹具经公开 `views.openDocument` 请求；`addonDocNavCases` 验证未开 Markdown、重显与标题/块/行真实落点；`addonDocNav` 单测覆盖命中/缺失 |
| N-U03 | `addonDocNavCases` 断言原生编辑器与实际行选区 |
| N-U04 | `addonViews` 注册表验证 embed 来源；`addonDocNavCases` 从引用 B 跳到仅 B 目录存在的文件，并用 A 来源 not-found 对照 |
| N-U06 | `addonDocNav` 单测与集成验证 CRLF；`addonDocNav.mjs` 经生产 SDK/控制器验证阅读高亮与折叠目标重新可见 |
| N-U07 | `addonNavApi` / `addonDocNav` 单测验证无工作区、越根、缺失、非法定位、越界与失败分类；集成补真实宿主拒绝矩阵 |
| N-U08 / N-U09 | `linkTarget` 形态矩阵（`splitLineSuffix` 先于 ADS 拦截、前导零/负数/非数字不构成行号、真 scheme 不剥）；md 行号复用 T03 `hostLineStart` 执行体，text 行号经 `resolveTextNav` strict 判定原生编辑器落位；浏 `lineSuffix`（md/text 行号定位与 href 原文保真）；集成两用例（md 落位含折叠展开/CRLF/阅读态、text reveal + 平台二态） |
| N-U10 | 越界严格失败（目标照常打开 + i18n toast 不静默钳位）、混合定位 blocked（`line-anchor-conflict` 新 reason）；浮窗行号越界同 `anchor-invalid` 分态；单 `linkTarget`/`hoverDocAccess` + 浏 `lineSuffix`（文案就地可见与语言包同源） |
| N-U11 | 无行号外链/普通链接/双链与图片通道维持既有行为（`linkTarget.test.ts` 既有断言零破坏 + T03 导航/链接/悬停/出链/反链/双链定向回归） |
| N-U12 | `addonViews` / `addonDocNav` / `addonDocNavDelivery` 钉住来源注销、旧代次、等待中改短、取消/超时与有界 ack；浏览器经卸载再装载验证旧回包不接入新代次 |

T03 自动化运行证据随票面实施回填，人工验收仍开放。内部端口单测验证确定性时序，公开组件夹具承担实际消费；不把模拟宿主等同于真宿主证明。T04 证据截至本票实施轮（含 T03 定位复验），真机观感项见人工清单 A78。

## 未验项与限制（如实保留）

- **跨会话持久保留**（故事 6、12、24 相关）：测试模式宿主 storage 为 in-memory（T16 已知边界，三途径实证），重启/升级后偏好与首选的读取面不可自动化——写入链路、会话内闭环与权威清单已自动验证，真实重启保留归人工（A62②）。
- **发行态设置写入通道**（故事 20 相关）：SSH 会话远端 ext host 不继承本地 env，发行态语义下测试钩子缺席，组件设置写入通道不可达（T17 未验项，票面已记录）；默认放行路径已验。
- **真机 IME/物理输入/视觉观感**：故事 3/4/7/8/10/11/12/16/17/18/21/28 的观感面归人工清单 A59–A66，自动化通过不写成用户已验收。
- **API 尚为候选**（故事 24）：台账 1.0.0 = candidate，未对外发行、无兼容承诺；SDK 构建桥与类型声明现位于 `test/fixtures/addon-v02/sdk/`，独立成包时签名源随迁（T13 已知边界）。
- **远端必需检查未配置**（故事 24）：`check:addonapi`/`check:addoncompat` 的 CI job 已接线，远端分支保护必需检查名单待用户授权配置（T14 已知边界）。

## 维护约定

全矩阵复现命令（与 T18 票面证据同口径）：`npm run compile`、`npm run test:unit`、`npm run test:browser -- --no-reuse`、`npm run test:integration`、`npm run check:stylecontract`、`npm run check:addonapi`、`npm run check:addoncompat`；安装态与 SSH 线分别为 `node test/integration/runInstalledAddons.mjs`、`node test/integration/runRemoteSshAddons.mjs`（各票面载有前提）。

本表随批次收口建立，此后接口或验证变更时由触碰对应面的票顺带更新（同 `addonApiCatalog.ts` 的维护纪律：改接口必经语义清单与本文）。29 项全绿的口径以 T18 全矩阵回归报告为准（`out/test/t18-*.log`，矩阵结论见票面 t18.md 回填）。

## 2026-10 扩展批次增补（#530–#533 规格）

2026-10-15 起的扩展批次按各自规格另行登记覆盖（首版 29 项之外）。首条：

| 切片 | 用户故事 | 接口映射 | 验证证据 |
| --- | --- | --- | --- |
| T05 只读引用浮窗（#544，[规格](addon-reference-views.md)） | R-U01–R-U07、R-U12 | `ref-views-popup`（`sdk.refViews.requestPopup`——来源 B 解析语境、互斥锚点、单浮窗仲裁、句柄与代次释放、错误分态透传） | 单 `addonRefViews`/`addonRefViewsRuntime`/`addonRefViewsPopup`/`documentSessionRefViews`/`addonPageLoader`；浏 `addonRefViews`（真实指针/键盘 + 绘制层）；集 `addonRefViewsCases`（绘制层与历史样式命中、来源 B、目标更新/失效、停用/页面关闭/租约回收）。R-U08–R-U11（组件容器嵌入）由 T06（#545）交付 |
| T06 组件容器嵌入（#545，[规格](addon-reference-views.md)） | R-U08–R-U11（复验 R-U03/R-U04/R-U07） | `ref-views-embed`（`sdk.refViews.mountEmbed`——容器归属（面板内容根/渲染内容根及其后代）、同容器重复挂载仲裁、独立 occurrence 双实例、整组释放（句柄/脱树/停用/页面结束）、readOnly 递归传递、addonSource 来源覆盖与既有 watch/预算/错误分态复用） | 单 `addonRefViews`（嵌入守卫）/`addonRefViewsEmbed`（容器归属/重复挂载/双实例/释放矩阵/迟到结局）/`addonRefViewsEmbedCard`（只读挂载/首结局兑现/watch 失效恢复/整组释放/孙卡只读继承）/`embedCardCssContract`（卡片壳四锚点并列）/`addonPageLoader`（mountEmbed 注入与 released 守卫）；浏 `addonRefViewsEmbed`（真实面板挂载绘制层——竖条计算色与命中、双实例滚动独立、零写通道、重复挂载、面板关闭整组释放）；集 `addonRefViewsCases`（真宿主目标更新/删除/恢复、释放无残留订阅、文档版本不变） |

## 组件设置详情自绘页优先覆盖（#553）

本票改设置详情呈现关系并新增页面上下文面，公开接口映射为 `page-settings-context`（`sdk.settingsContext`——仅设置页）；呈现规格见 [addon-settings-detail.md](addon-settings-detail.md)。29 项故事中的 13/14/16/18（作用域、清除继承、停用可配置、故障排障）语义不变，呈现载体随本票演进。

| 场景 | 公开接入与验证 |
| --- | --- |
| 详情首屏自绘页（自动装载、无重复表单） | 单 `addonSettingsArea`（#553 组：自动 openAddonPage/应答去重/次级页签/外壳保留）；浏 `addonSettingsContext`（真实 defineAddonPage 夹具装载进详情 + 首屏绘制层断言） |
| 作用域真实传至组件 | 浏 `addonSettingsContext`（夹具经 facet 回显 scope=workspace——显示值与写入目标一致）；单 `addonSettingsArea`/`addonPageLoader`（applyScope 等值不分发、订阅退订） |
| 搜索定位交给自绘页（未开/已开两态） | 单 `addonSettingsArea`（pendingFocus 消费路径与已开路径均交付 runtime、平台不描自己表单）；浏 `addonSettingsContext`（搜索点击 → 夹具回显 locate=def:flag） |
| 生命周期（切换/重开/停用可配置/故障恢复/迟到） | 单 `addonPageLoader`（#553 组：释放整组回收、迟到订阅 no-op、查询不受代次影响）；浏 `addonSettingsContext`（故障撤下/重试恢复/切换组件残留撤除）；停用可配置沿用 `addonT05Cases`（宿主机制未改） |
| 消费编译与门禁 | `publicApiConsumer`（SettingsPageContextSurface 钉住 + union/样例）；`addonApiSurface`（导入白名单 + 防回潮）；基线重锚随票（page-sdk 声明文本变更） |

## 统一主题扩展覆盖（#546 / T07）

本组故事来源为 [addon-themes.md](addon-themes.md)，不改写上方 T18 历史结论。公开宿主面为 `themes-register`，页面面为 `theme-environment`；API 仍为 1.0.0 候选。

| 故事 | 用户结果 | 实际验证路径 |
| --- | --- | --- |
| H-U01/H-U02 | 原页签统一单选，来源可区分 | `themeSettings` / `appearanceSettings` 单测；生产设置页 `addonThemes` 浏览器（真实 CSS、同名来源、单选） |
| H-U03/H-U11 | 安装只加候选，普通渲染器规则保留 | `addonRenderers` / `addonRendererTakeover` / `addonRendererService`；`addonThemes` 浏览器（内置与主题计算色、Live/阅读） |
| H-U04 | 保存与重开回显 | `settingsService` / `themeSettings`；`addonThemes` 浏览器正式 settings.set 回环与切页重开；真实进程重启仍待人工 |
| H-U05 | 不可用回落、首选保留、恢复沿用 | `addonThemes` / `addonThemeService`；`addonThemes` 浏览器；`addonThemeCases` 真宿主链 |
| H-U06/H-U07 | 实际主题四态、缓存先更新、图形重画与释放 | `addonThemeEnvironment` / `addonPageLoader`；`themeEditor` 经公开 SDK 消费；浏览器计算色与退订；`addonThemeCases` 双文档及真实主题事件 |
| H-U08 | 中英文、来源、搜索定位 | `themeSettings`；`addonThemes` 浏览器热换语言包、搜索与主题页签路由 |

本地接手验证报告为 T07 工作树 `out/test/t07-resume-*`；联合全量回归由汇总分支记录。图表弹窗继续既有 `graphicPopup` 快照验证，T08 的安装、迁移和包体收口尚未交付。
