# 附加组件行为禁用态对组件可见（#476）——规格

> 状态：访谈闭环（第一轮 Q12–Q15 全拍板），待定稿确认。代码基线：origin/main @ ee8af89e。

## 0. 需求原文（2026-10-13 票面要点）

- 行为启用状态**只读**可见性（候选形态：SDK behaviors 面扩展 `enabledState()` / `onEnabledChange()`，或经既有状态推送链路下发）。
- 状态口径 = 完整键级 disabled 集合；addon 级 enabled=false 与单项禁用的语义区分随规格明确。
- 变更通知支撑灰态实时同步（拉/推规格期定夺）。
- 票面边界：不改宿主仲裁语义与执行链；存储 version 1 不动或显式迁移；不含组件侧 UI。
- 契约门禁：按 ADR-0012 与 API 契约门禁流程（addonApiCatalog 同步、`gen:addonapi`/`check:addoncompat`，必要时基线重锚定）。
- 消费场景（产品决策 2026-10-13）：easy-typing 规则页回归组件自管（vsidian-easy-typing#50，platform-dependency 挂本票）——被宿主禁用的行为在规则页呈灰态 + tooltip「已在插件行为管理中被禁用」。

## 1. 事实基线（2026-10-13 核查）

### 1.1 SDK 面现状与面可用性矛盾

- `AddonBehaviorsFacet`（`src/shared/addonBehaviors.ts:287-295`）：仅 `register` + `onChanged`；**仅编辑器页提供，设置页为 undefined**（`src/shared/addonPage.ts:148`；设置页 register 返回 `not-editor-page`，`addonPageLoader.ts:431-433`）。当前无任何查询/订阅禁用态的成员。
- 设置页 SDK 只有 `addon` / `resourceUri` / `channel.request` / `onDispose` / `mountRoot()`（`addonPage.ts:125-175`）。
- **矛盾**：消费场景（easy-typing 规则页）在组件**设置页**；且组件被用户停用后设置页**不卸载**（`src/host/addons/addonRuntime.ts:285-302`，`desiredSettingsLoad` 只挡 faulted；setup handler 仅 fault 清空 :680）——「组件已停用但规则页仍开着」是真实场景，禁用态可见必须覆盖。

### 1.2 禁用态的存储与消费链

- `AddonBehaviorStateStore` version 1 = `{ order, disabled }`（disabled 为完整键集合），globalState 单键 `vsidian.addonBehaviors.state.v1`（`src/host/addons/addonWiring.ts:241-252`）。
- 执行链消费：`driveInput` → `effectiveOrder()` → `resolveAddonBehaviorOrder` 用 `store.disabled` 过滤（`src/webview/addonBehaviors.ts:185,:289-292`；`src/shared/addonBehaviors.ts:355-364`）。
- 变更钩子：`AddonBehaviorStateService.onChanged`（`src/host/addons/addonBehaviorStateService.ts:37-114`）已有——落库成功后触发，推送时机可挂。
- addon 级停用：编辑器页收 `addon.unload` + `onDispose` 回调（`addonWiring.ts:680-694`；`addonPageLoader.ts:614-681`）；设置页保留通信能力。

### 1.3 契约先例

- hostSettings（#457）：只读查询面先例，但挂 `sdk.experimental` 且仅编辑器页——形态可参考，路径不同（本票走稳定候选面加法演进）。
- apiCatalog 现有条目：`behaviors-register`（:704-729，endpoints `['editor-page']`）、`behavior-order-state`（:730-749，endpoints `['host']`）。`AddonApiLayer = 'stable-candidate' | 'experimental'`（:48）、`AddonApiEndpoint = 'host' | 'editor-page' | 'settings-page'`（:51）——两端点枚举已存在，无需扩协议。

## 2. 设计树（决策节点与拍板记录）

- **D1 承载面**：**新增独立只读面 `sdk.behaviorState`（命名候选），编辑器页与设置页均提供**；`behaviors` 面不动（维持「仅编辑器页」既有契约声明）。否决：behaviors 面加成员并扩到设置页（改既有面可用性声明，且 `register` 在设置页无意义，面粒度不干净）；挂 experimental（easy-typing 复刻的必要能力，不应实验化）。〔第一轮 Q12 ✅〕
- **D2 形态**：**查询 + 订阅双件**——`enabledState()` 立即返回快照（打开规则页取初值）+ `onEnabledChange(cb)` 返回退订函数（与 `behaviors.onChanged` 风格一致）。否决纯查询（hostSettings 式拉取，不满足灰态实时同步）/纯推送（无初值）。〔Q13 ✅〕
- **D3 状态口径**：快照分两层报事实——`addonRunState: 'enabled' | 'user-disabled'`（faulted 时设置页不装载，组件页不存在，无需报）+ `disabled: 本组件行为的局部 behaviorId 集合`（不报完整键：组件自知 addonId，冗余；接口按「本组件」过滤，天然隔离）。〔Q14 ✅〕
- **D4 两层口径（给 easy-typing#50 的消费语义）**：宿主层（组件停用或单项禁用）与组件层（组件自己的规则开关，如 `rule-state.json` / `deletedBuiltinRuleIds`）是**两层独立开关，分开存储**；生效 = 两层都开启（AND 合并）；灰态判定 = 宿主层任一为真即灰，tooltip 区分「已在插件行为管理中被禁用」与「组件已停用」。「同一开关两面」（组件规则页直接读写宿主 disabled 集）被本票只读边界排除——**这是 #50 首要决断点的平台侧答案**。〔Q14 ✅〕
- **D5 通知时机**：状态落库后**即时**通知（挂 `behaviorStateService.onChanged` 既有钩子；用户在行为管理页拨开关、组件页灰态实时同步）。〔Q13 ✅〕
- **D6 存储**：**version 1 不动**——disabled 键集合形状不变，本票纯只读暴露，无迁移。〔Q15 ✅〕
- **D7 契约登记**：apiCatalog 新条目（候选名 `behavior-enabled-state`，endpoints `['editor-page', 'settings-page']`，layer `stable-candidate`，signatures 指向 shared 事实源新导出符号）；同步 developer-guide「文档维护入口」节与 API 参考（`gen:addonapi` 重生成、`check:addoncompat` 过门禁、消费样例与钉住断言按 AGENTS.md「附加组件公开 API 维护」节全流程）。

## 3. 已定边界

- **只读**：不提供任何写入宿主状态的成员；不改宿主仲裁语义与执行链（票面钉住）。
- 组件被用户停用后设置页仍打开、仍可查询该状态（覆盖 easy-typing 场景的停用灰态）。
- faulted 状态不进快照（故障时设置页不装载，语义上不可达）。

## 4. 明确不包含

- 组件侧 UI：灰态与 tooltip 形态归 #50 组件自管（tooltip 文案组件自定，不强接宿主契约；但用户可见文字组件侧也须 i18n）。
- 宿主行为管理页向组件页的回链（#50 边界：灰态行提示去宿主开启，宿主侧不强制回链）。
- disabled 集合的组件级写入、协商或订阅他人组件的状态。

## 5. 依赖与并行

- 消费方：vsidian-easy-typing#50（platform-dependency 挂本票；其 `deletedBuiltinRuleIds` 与宿主 disabled 的关系按 D4 两层口径消费）。
- 与 #474 无依赖（票面钉住）；与 #472/#473/#475 不同文件面，无撞形。

## 6. 轮次记录

- **R1（2026-10-13）**：Q12 独立只读面（两页可用）✅、Q13 查询+订阅双件与即时通知 ✅、Q14 两层口径与灰态合并语义 ✅、Q15 存储版本不动 ✅。**#476 访谈闭环**，待定稿确认。
