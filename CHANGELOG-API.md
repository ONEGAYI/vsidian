# API Changelog

本文件记录 Vsidian 附加组件公开 API 面向调用者的可见行为变更：新增能力面、语义与参数修订、拒绝原因、预算与兼容边界。内部实现（模块拆分、性能手段、测试与文档调整）不在此记录。

- API 版本独立于 Vsidian 本体版本号，但**发行点与本体重合**：API 随扩展一起打包分发，本体每次发布即 API 的发行点。开发中的变更记入顶部 `## Unreleased - 开发中` 段；本体发布时该段非空（本周期有调用者可见的 API 变更）即随发版升版转正为 `## <API 版本> - <日期>` 段，并在顶部重建空 Unreleased 段。
- 升版幅度按变更性质：新增能力与兼容性修订升次版本，破坏性变更（签名/语义不兼容、移除）升主版本并按移除规则评估。发行即开始兼容承诺——弃用与移除的双门槛（两个后续 API 次版本且满 30 天）自实际发行日起算。版本状态以 `src/shared/addonApiCatalog.ts` 的发行台账（`ADDON_API_RELEASES`）为准。
- 接口签名与逐条语义以[公开 API 参考](docs/addons/api-reference.md)为准（从事实源生成，不手改）；本日志只回答「这一版变了什么」。

## Unreleased - 开发中

### 新增

**设置读取快照的两层显式值（#590）**

- `settings.get()` 快照（`AddonSettingsGetSnapshot`）新增可选成员 `userValues` 与 `workspaceValues`：各层**只含显式保存过的键**（含定义外遗留键——存储原样，不因定义集删除）；`workspaceValues` 为 `null` 表无工作区。供组件自绘设置页按作用域层呈现用户层真值（此前只有合并生效值，被工作区覆盖的用户层原值组件侧无法反推）。
- 既有 `values` / `sources` 合并口径与存储结构不变；两成员可选，旧调用形状不受影响。数据源即平台原生表单按层取值的同一通路（服务层 `effectiveSnapshot`）。

### 新增

- 页面 SDK 新增可选只读 `locale` 面（#582，编辑器页与设置页均提供）：`get()` 读取平台生效语言，`onChange(listener)` 在语言代码变化后通知并返回幂等退订；首值主动读取，不立即回放，同码不重复通知。语言与 `general.language` 偏好及 VSCode 显示语言的解析结果同源，当前 `en` / `zh-cn`，公开类型为 `string`。
- 切换语言不重载组件工厂或丢失组件状态；订阅随所属装载释放，迟到订阅无效，回调同步异常按既有组件故障上报。旧宿主须先检测 `sdk.locale`，不能用浏览器/OS 语言猜测平台语言。
- 本项属于开发中新增能力，下次本体发行时 API 需升次版本；当前版本与已发行记录保持不变。

## 1.2.0 - 2026-10-18

兼容性修订版本（随 Vsidian 1.2.0 发布）：无新增能力面与实验入口；内核 Codex 主题退役（#535 / T08）带来的主题首选语义收窄，与 v1.1.0 公开符号的弃用标注——调用形状保持编译期兼容。

### 语义收窄与弃用标注（#535 / T08：内核 Codex 退役）

- v1.1.0 公开符号保持编译期兼容并标注弃用：`resolveThemePreferred` 第二参 `legacyMermaidValue` 标 `@deprecated`，传任何值（含 `'codex'`）不再影响结果；`CODEX_THEME_ID` 标 `@deprecated`——值恒 `'codex'`，不再是内置主题身份，作为未知首选走目录不命中回落。弃用与移除按双门槛约束（两个后续 API 次版本且满 30 天）。
- 语义收窄（退役语义本身）：旧键 `appearance.mermaidTheme` 的设置定义删除、不再参与首选解析——v1.1.0 中「新键 default 且旧键 codex 回显 codex」的过渡分支退役；存量 codex 值不做激活迁移——按目录不命中的未知首选回落 default 显示且首选保留。首选值域由 `default | codex | <addonId>/<themeId>` 收窄为 `default | <addonId>/<themeId>`。
- `resolveActiveTheme` 语义修订：preferred 为退役的 codex 历史值不再「内置恒可用」，按目录不命中的未知首选处理（`available=false`、`effective=default`、`preferred` 保留）。
- `AddonThemesStatePayload.preferredAvailable` 语义收窄：仅 default 恒 true（原「default/codex 恒 true」）。

## 1.1.0 - 2026-10-16

首个随本体发行的 API 版本（随 Vsidian 1.1.0 发布）：1.0.0 候选面与候选期增补并入本版本，自本发行日起产生兼容承诺——弃用与移除受双门槛约束（两个后续 API 次版本且满 30 天）；此前各本体版本携带的候选面不追溯兼容承诺。

### 候选面基线（并入）

- 六组能力面（发现与安装/页面 SDK/输入行为/设置/渲染提供者/命令菜单界面）随 T01–T12 实施与消费样例冻结。
- 编辑接口 `applyEdits` 提交后选区支持数组形态（`AddonSelectionRange[]`），输入行为计划返回的 `selection` 同款（#498）。
- 行为名多语言形态：`name` 可传「语言键 → 名称」映射，语言切换后已注册行为名即时跟随（#464）。
- 实验入口五个：cm6（1.1.0，含 syntaxTree / ensureSyntaxTree / syntaxTreeAvailable 最小集）、headingFold、viewIdentity、syntax、hostSettings——须在清单 experimental 声明兼容范围，不随稳定 API 弃用期限承诺。

### 新增

**粘贴转换规则（#541、#542）**

- `ctx.paste.registerRules`（enable 生命周期）：登记声明式粘贴转换规则。富文本粘贴的 HTML→Markdown 遍历中，命中的来源特化元素（如带私有属性的 span）按模板转回 Markdown 结构，或显式丢弃；显式纯文本粘贴、代码/表格上下文与 plain 守卫不经规则。
- 规则语言为可序列化数据：标签名相等＋属性条件（存在/相等/正则）＋可选条件树（all/any/not）＋取值槽（元素文本/指定属性/子内容转换结果/正则捕获组——支持整匹、数字组、命名组）＋模板产出（`{{name}}` 槽引用；文本/属性/捕获组槽内置转义，URL 槽经 safeUrl 策略，字面部分不转义）。正则声明 pattern＋受限 flags（i/m/s/u，禁 g/y），注册时编译校验；组引用越界或命名组缺失即拒绝，未知字段显式拒绝。
- 嵌套转换在 children 槽声明子规则集（与顶层同一语言，ID 为槽内局部）：子元素先子规则后内置，只沿子节点下降；嵌套求值期间外层规则集不参与。
- 执行顺序确定：优先级降序、组件稳定 ID 升序、规则稳定 ID 升序，首条成功接管、单条失败继续、全部未成功回内置转换；内置 SCRIPT/STYLE 忽略规则先行，组件规则不能复活已忽略节点。
- 生效与撤回：规则全局生效于全部已打开与新打开编辑器；停用、故障、单组释放与代次结束撤回相应规则并广播新快照；一次粘贴在使用开始时捕获注册快照，不拼接两个代次。
- 预算：每组件至多 256 条规则（含嵌套子规则）、条件与嵌套层级各至多 16、单条条件树至多 64 节点、单次粘贴求值至多 100,000 步（规则尝试/条件节点/正则执行各计一步，超限停用该规则、内置转换继续）；正则输入超 4,096 字符按取值缺失处理（该条失败，不截断）。
- 拒绝原因：invalid-declaration / duplicate-id / too-many / released；整批拒绝不部分安装，普通 API 拒绝不算组件故障。

**文档打开与定位（`views.openDocument`，#543）**

- 编辑器页新增文档打开与定位：提交来源实例、目标路径与互斥定位（1-based 行号/标题/块 ID），由宿主打开 Markdown 或原生文本文件并报告实际结果；不提供任意文件读取面。空 target 定位来源文档自身，行号越界不钳末行。
- Live 与阅读态均可调用；来源可为 main/embed/hover 有效视图，设置页不提供。成功区分 opened 与 located；失败携带已打开状态与原因（invalid-request / no-workspace / escape / not-found / view-disposed / anchor-not-found / out-of-bounds / delivery-failed / error），普通拒绝不算组件故障、不重复弹通知。

**只读引用视图（`sdk.refViews`，#544、#545）**

- `requestPopup`：在触发文字或按钮旁打开内核只读引用浮窗。目标支持按来源文档目录解析的相对路径、标题/块锚点与文本行号定位；新请求替换旧浮窗，Esc、来源结束或组件停用时释放。
- `mountEmbed`：把与正文嵌入同款的只读引用卡片挂进本组件已取得的面板内容根（`ui.registerPanel`）或渲染内容根（`renderers.register` 生效容器，可为其后代）。目标与来源语义和 requestPopup 同源；多处同目标挂载共享读取缓存，实例、滚动与状态独立；释放随句柄 release、容器卸载、组件停用等整组终结；重复挂载同一容器拒绝 duplicate-mount，先释放旧实例才可重挂。恒只读、零正文写入、零撤销项——插入 `![[…]]` 仍由编辑 API 显式执行。
- 失败原因透传真实分态（not-found / anchor-invalid / file-too-large / budget 等），不折叠为 not-found。

**主题登记与环境快照（#546）**

- `context.themes.register`（enable 生命周期）：登记主题元数据，进入「外观 → 主题」单选；安装只新增候选，用户显式选择后才接管声明语言，停用回落显示并保留首选。
- `sdk.themeEnvironment`（编辑器页）：读取当前实际明暗与高对比快照并订阅变化，供组件更新已挂载图形。

**设置页上下文（`sdk.settingsContext`，#553）**

- 仅设置页提供：自绘设置页读取并订阅当前作用域（用户默认/当前工作区与工作区在场状态）与全局设置搜索的定位目标（设置定义/分组）；组件据此切换页内标签、定位控件，保持显示值与写入目标一致。

### 修改

- 页面 SDK 注入面：随扩展批次 T06–T11 与 #553 增补新 facet（`views.openDocument` / `sdk.refViews` / `sdk.themeEnvironment` / `sdk.settingsContext` 等）；既有 facet 形状不变。
- 渲染提供者选择：主题类提供者安装后不自动接管，仅新增候选待用户显式选择；普通渲染提供者保留安装后接管规则。
