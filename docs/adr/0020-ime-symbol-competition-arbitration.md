# 行为链与内置符号对在 IME 定稿路径的竞争裁决

## 状态

产品约束已接受，2026-10-19。用户在 #595 裁决轮确认两项决定：IME 定稿符号对的优先序为**行为链先、内置兜底**；双驱动排除采用**专用 Annotation**（`builtinEditOrigin`）。同日 #597 裁决轮追加：键入路径同样收敛为「原始输入 → 行为链 → 内置兜底」（方案 3；方案 2 被否——conv-hw2fw 反例，见修订记录），不新增开关或兼容模式。工单 [#595](https://github.com/ONEGAYI/vsidian/issues/595) / [#597](https://github.com/ONEGAYI/vsidian/issues/597)，实施随同票落地；驱动面语义属附加组件 API 契约（developer-guide 行为链触发面、`addonApiCatalog` behaviors-register 条目、CHANGELOG-API Unreleased 语义澄清条目）。

## 背景

PR #594（#593 实施验证）真宿主实测发现：选中文字后经 IME 定稿**符号对字符**（如 `【`）时，两个子系统在同一次输入上竞争——

1. **内置符号对提交补全/包裹**：对 selectionWrap 符号做配对包裹——选区 `ord` 定稿 `【` 的终态是 `w【ord】`（全角兜底）。选区场景实际生效的是 #124 包裹重建（`attemptCompositionWrap`），无选区场景是 #123 提交补全（`attemptCompositionCommitClose`），两路径经共享快照互斥让位。
2. **行为链双驱动**：内置 attempt 的 dispatch 显式携带 `userEvent: 'input.type'`——compositionend 后组合期门控已解除，此事务走 `maybeDriveAddonBehaviors` 事务路径**再驱动一次**行为链。叠加 #593 落地的 compose 补驱动（`inputText='【'`、`replaced='ord'`），同一输入有两次驱动，第二次的 `inputText` 是内置包裹展开后的文本（`【ord】`）。

该形态自 #411（IME 定稿驱动落地）起即存在，非 #593 引入。驱动方为 [vsidian-easy-typing#64](https://github.com/ONEGAYI/vsidian-easy-typing/issues/64)（SelectKey 类组件）。

## 决定

### 裁决一：优先级 = 行为链先、内置兜底

以现状微任务时序为**显式契约**：#593 补驱动（M1）先启动，组件修饰先改写区间即生效；内置 #124 包裹 attempt（M3）后执行，遇区间已被组件改写即中止让位（复用既有形态校验，不新增机制）。终态矩阵：未装组件/行为不适用时内置全角兜底 `w【ord】` 照常落地；装同步类行为时以组件产出为终态；异步类行为（await 通道后才 applyEdit）内置先落地、修饰后至以内置产出为改写基线覆盖——不加链 settle 等待（已知边界）。用户调节面沿用既有「选区包裹」设置开关，不新增设置项。

### 裁决二：双驱动排除 = 新增专用 Annotation

新增专用注解 `builtinEditOrigin`（定义于 `liveInstance.ts`，与 `externalSync`/`addonEditOriginTag` 并列）：#123 与 #124 两处 attempt dispatch 均携带；`maybeDriveAddonBehaviors` 的程序化事务排除条件加一项。效果是 IME 定稿符号对字符**只驱动行为链一次**（#593 补驱动的干净形态）。**键入路径在 #595 时不受本标记影响**：真实键入符号字符的补全/包裹经 transactionFilter 改写并保留 `input.type` userEvent，照常驱动一次（`inputText` 为展开形态如 `()`，#411 起既有行为；初稿曾以 t15 先例论证键入路径天然不驱动，评审推翻——见修订记录）；该形态差异由 #597 裁决收口归一——键入路径同样只以原始输入驱动（见修订记录末条）。

`userEvent: 'input.type'` 保留不动（撤销惯例与「一次补全=一笔 edit.request」出站合并不变）；不复用 `externalSync`（会抑制出站回发，打破「与组合净输入合并单笔出站」落档边界）；不复用 `addonEditOriginTag`（向外发请求注入 origin 元数据并强制开新撤销段）。双驱动消除后，现状「第二次驱动可能被 `chainRunning` 吞掉」的不确定窗口一并消失。

## 被否选项

- **内置先行**：行为链只能拿 `inputText='【ord】'` 多字符展开形态，SelectKey 类「单字符输入 + `replaced` 作包裹目标」判定（#401 语义）没有干净命中面。
- **内置符号能力行为化**：注册进行为链统一排序——需新内置行为身份面、与既有「选区包裹」开关重叠须归并裁决，超本票范围；未来要求按符号粒度调节再立票。
- **不排除、组件自行判别**：全部输入增强组件作者都要写同一套「非原始形态即忽略」防御（选区场景 `inputText='【ord】'`、无选区场景 `inputText='】'`），把平台内部时序产物外推成组件负担。
- **改 userEvent 前缀绕开**：挪用 CM6 userEvent 输入分类语义，且需排查撤销栈与不可枚举第三方消费方的隐性前缀依赖。

## 后果

- 组件作者获得稳定的驱动面契约：**IME 定稿与键入两路径**的行为回调都只见原始输入形态（干净 `inputText`/`replaced`）——IME 定稿路径自 #595 起（内置加工不再以二次驱动外泄），键入路径自 #597 起归一（`inputText` 为原始键入字符、`replaced` 为被替换选区，展开形过渡行为废止）。契约面由 `addonApiCatalog` 语义条目、developer-guide 行为链触发面与 CHANGELOG-API 记载，发行后变更是兼容性事件（语义字段字节冻结，变更须显式重锚基线）。
- IME 定稿符号对的让位护栏复用 #124 attempt 既有形态校验（区间已被改写即中止），不新增仲裁机制；browser 套件（addonT07Behaviors 4b）把 M1 先于 M3 的微任务序、终态矩阵与驱动计数钉进断言。
- 异步类行为组件在选区场景可能先见全角兜底后见自身改写（内置产出为改写基线被覆盖）——接受为已知边界，不为链 settle 加等待。
- 后续新增「compositionend 后微任务主动派发」的内置加工路径（与 #123/#124 同型）应同样携带 `builtinEditOrigin`，维持「IME 定稿只驱动一次行为链」的语义。

## 修订记录

- 2026-10-19（评审第 1 轮）：裁决二初稿以「与普通键入路径归一（t15 先例：beforeinput 拦截路径的符号事务无 `input.type` userEvent，天然不驱动）」论证两路径同只驱动一次——该前提经代码核实**不成立于真实键入**：t15 用例的键入注入经测试通道（无 userEvent，不经 filter 改写），而真实键入符号字符的补全/包裹经 transactionFilter 改写并保留 `input.type` userEvent（symbolAutocomplete 的 `keepEvent` 机制），照常驱动一次且 `inputText` 为展开形态（如 `()`）——此为 #411 起的既有行为。本 ADR、契约语义条目、CHANGELOG-API、symbol-input 落档与 liveInstance 注解注释已同步收窄为「**IME 定稿路径**的内置补全/包裹重建事务不驱动」，并如实记载键入路径既有形态；addonT07Behaviors 新增真实键入场景钉住该既有行为。键入路径行为未变，其 filter 改写事务是否同样排除（形态归一）属后续裁决。

- 2026-10-19（#597 裁决轮）：上条悬置项收口。用户裁决：**键入路径同样收敛为「原始输入 → 行为链 → 内置兜底」（方案 3）**——filter 放行原始键入事务（不再改写为展开形态），行为链恰驱动一次且 `inputText` 为原始键入字符、`replaced` 为被替换选区，内置补全/包裹退为微任务兜底（携带 `builtinEditOrigin` 不驱动）；不新增开关或兼容模式。方案 2（屏蔽键入路径通知）被否：EasyTyping 既有 `builtin-conv-hw2fw` 规则（中文后半角转全角，默认关）按快照文本与光标切片匹配、不消费 `inputText`，其 `trigger_right` 恰好吞掉内置闭合（终态干净 `中（|）`），屏蔽通知即杀死该能力——管线级探针逐字钉住该终态（`docs/research/597-plan3-probe.md`，10/10 绿）。实施随 #597：键入路径与 IME 路径同构重排（放行原始事务、兜底 attempt 微任务、出站强制暂缓、M1 先于 M3），落档见 symbol-input「键入路径重排（#597 落档）」节；契约面五处同步（catalog/developer-guide/CHANGELOG-API/本 ADR/symbol-input）与 `check:addoncompat` 基线重锚随 #597 实施票进行，本 ADR「决定/后果」的键入路径表述已同步收口。例外（评审 002 轮用户裁决）：表格空白行规范化接管域（`blankRowInputPlan` 命中）维持归一前原子改写——该场景 `inputText` 为规范化整行载荷而非原始单字符（base 同为改写形态，无回归），完整统一转 [#600](https://github.com/ONEGAYI/vsidian/issues/600)。
