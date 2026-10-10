# Vsidian 附加组件公开 API 参考

> 本文档由 `scripts/genAddonApiRef.mjs` 从语义清单与发行台账单一事实源（`src/shared/addonApiCatalog.ts`）及各事实源模块的 TypeScript 声明自动生成，**禁止手改**；新鲜度由 `npm run check:addonapi` 校验。接入流程、构建桥、调试与迁移的叙述性内容见[开发指南](developer-guide.md)；示例仓库的准备说明见[示例仓库准备](example-repo-plan.md)。

**诚实声明**：当前所有条目与版本均为**候选状态，尚未对外发布**——Vsidian 尚未发行任何稳定 API、SDK 包或独立示例仓库。候选形状已随 T01–T12 的消费样例冻结，发行前不产生兼容承诺。

## 状态、版本与发行台账

**版本号独立于 Vsidian 本体版本**——附加组件声明支持的 API 范围不能以本体版本代替；台账区分候选与实际发行，只有真实发行才携带日期。

| API 版本 | 状态 | 实际发布日期 | 说明 |
| --- | --- | --- | --- |
| 1.0.0 | 候选（未发行） | —（未发行不携带日期） | 首个候选稳定 API：六组能力面（发现与安装/页面 SDK/输入行为/设置/渲染提供者/命令菜单界面）已随 T01–T12 实施与消费样例收敛。候选 = 形状已冻结待发行，尚未对外发布——发行前不产生兼容承诺；升级为 released 须在真实发行时人工落账并填实际发布日期。 |

**实验入口兼容清单**（使用须在清单 `experimental` 声明对应入口与兼容范围；实验入口可能随版本调整，不随稳定 API 弃用期限承诺）：

| 入口 | 版本 | 状态 | 实际发布日期 | 兼容边界 |
| --- | --- | --- | --- | --- |
| `cm6` | 1.1.0 | 候选（未发行） | —（未发行不携带日期） | 页面共享 CM6 运行时（experimental.cm6）。1.1.0 = #406 起暴露面含 language 语法树子集（syntaxTree / ensureSyntaxTree / syntaxTreeAvailable——最小集合，注册类成员不纳入）。使用须在清单 experimental 声明 cm6 兼容范围且含本版本；组件不得重打包 CM6（构建桥拒绝值导入 + 产物静态标记双防线）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。 |
| `headingFold` | 1.0.0 | 候选（未发行） | —（未发行不携带日期） | 页面 SDK 的标题折叠查询与命令（experimental.headingFold，#410）。1.0.0 首版候选：folds / foldable 查询（有效派生视图与可折叠全集，span 不含文本摘要）+ apply 五操作（选区驱动，编程触发与用户触发同链路）+ foldAt / unfoldAt 按区间键批量组合 + foldAll 可 upToLevel 参数化；Live-only（阅读模式不开放，#409 定案）。#426 起 folds 与 foldable 共享同一 doc 版本缓存（调用成本 O(标题数) 过滤，非全文档重扫），实例寻址可经 viewIdentity.instanceIdOf 反查。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。 |
| `viewIdentity` | 1.0.0 | 候选（未发行） | —（未发行不携带日期） | 视图身份反查面（experimental.viewIdentity，#426）。1.0.0 首版候选：instanceIdOf（CM6 EditorView → views 面实例 ID；未装配身份的 view 返回 null）——keymap/扩展回调拿到 view 后据此反查实例，headingFold 等按 ID 寻址的 API 不再依赖「扩展槽仅挂主正文 Live 实例」的装配范围推定。闭包实现无 this 依赖（解构裸传安全）。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。 |
| `syntax` | 1.0.0 | 候选（未发行） | —（未发行不携带日期） | 行类型与行内标记查询面（experimental.syntax，#433，#408 B+ 形态落定）。1.0.0 首版候选：lineTypeAt（八种行类型：frontmatter/code/formula/table/heading/quote/list/text——平台侧组合增量树、frontmatter 区间缓存与跨行公式块表，live 树对 fm 反语义、公式零语义由组合判定补齐）+ inlineAt（code/formula/none 位置级行内标记）+ nodeNames 诊断载荷（祖先链节点名快照，非稳定、不构成兼容承诺）。位置驱动单点查询（µs 级），不暴露树/节点句柄；Live-only。实验入口可能随版本调整，不随稳定 API 弃用期限承诺。 |

### 稳定 API 移除规则

稳定 API 默认长期兼容。确需移除时，先发布弃用说明与替代方案；从包含该弃用的版本实际发布之日起，至少经过两个后续 API 次版本且满 30 天，两项门槛同时满足才允许移除。版本跨度按独立 API 版本计算，不按 Vsidian 本体版本计算。

### 维护入口

- 语义清单与台账（单一事实源）：`src/shared/addonApiCatalog.ts`——新增或修改六组接口时同步条目并重跑 `npm run gen:addonapi` 提交产物。
- 公开声明的编译期消费：`test/addonApi/publicApiConsumer.ts`（删除公开成员、收窄枚举会使 `npm run compile` 失败）；导入面纪律由 `test/unit/addonApiSurface.test.ts` 钉住。
- 消费样例（行为验证）：`test/fixtures/addon-v02/` 各夹具组件。

## 目录

  - [1. 发现与安装](#1-发现与安装)
    - [`manifest-declaration` 私有身份声明（vsidianAddon 清单字段）](#manifest-declaration)
    - [`compatibility` 兼容判定（稳定 API 范围与实验入口）](#compatibility)
    - [`register-addon` 宿主注册入口（registerAddon）](#register-addon)
    - [`addon-definition` 注册定义与两段生命周期（setup/enable）](#addon-definition)
    - [`official-registry` 官方（核心）组件登记表](#official-registry)
    - [`addon-status` 组件状态模型与设置页呈现](#addon-status)
  - [2. 页面 SDK](#2-页面-sdk)
    - [`page-sdk` 注入组件工厂的页面 SDK](#page-sdk)
    - [`page-load-protocol` 页面装载协议（指令与出站消息）](#page-load-protocol)
    - [`page-bridge` SDK 构建桥（vsidian-addon-sdk 虚拟模块）](#page-bridge)
    - [`views-editor` 统一视图与编辑面（views / editor）](#views-editor)
    - [`cm6-experimental` 实验入口：共享 CM6 运行时（experimental.cm6）](#cm6-experimental)
    - [`heading-fold-experimental` 实验入口：标题折叠查询与命令（experimental.headingFold）](#heading-fold-experimental)
    - [`view-identity-experimental` 实验入口：视图身份反查（experimental.viewIdentity）](#view-identity-experimental)
    - [`syntax-experimental` 实验入口：行类型与行内标记查询（experimental.syntax）](#syntax-experimental)
    - [`channel` 页面与宿主通道](#channel)
  - [3. 输入行为](#3-输入行为)
    - [`behaviors-register` 输入行为注册与观察](#behaviors-register)
    - [`behavior-order-state` 行为顺序与逐项开关持久](#behavior-order-state)
  - [4. 设置](#4-设置)
    - [`addon-storage` 组件数据目录与文件监听](#addon-storage)
    - [`settings-context` 宿主设置能力面（setup 上下文）](#settings-context)
    - [`settings-definitions` 可序列化设置定义与值校验](#settings-definitions)
    - [`settings-scope` 作用范围解析与存储](#settings-scope)
  - [5. 渲染提供者](#5-渲染提供者)
    - [`renderers-register` 渲染提供者注册](#renderers-register)
    - [`renderer-selection` 确定性选择、自动接管与首选恢复](#renderer-selection)
  - [6. 命令/菜单/界面](#6-命令菜单界面)
    - [`commands-register` 命令注册与统一快捷键](#commands-register)
    - [`menus-register` 菜单项注册](#menus-register)
    - [`ui-buttons-panels` 工具栏按钮与面板](#ui-buttons-panels)

## 1. 发现与安装

**能力范围**：宿主清单发现、身份声明、兼容判定、注册入口与官方登记

### `manifest-declaration` 私有身份声明（vsidianAddon 清单字段）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#350（T01）

**目标**：组件在自己的 package.json 顶层用私有字段声明身份与兼容范围。没有声明的普通扩展不进入组件列表；声明非法者保留状态与原因，不静默忽略。

语义要点：
- **生命周期**：manifestVersion 是身份声明格式版本（当前 1），与公开 API 版本分开；清单只承担识别与兼容，不列能力与激活条件（能力由代码注册）。
- **错误与拒绝**：四种可辨认拒绝原因：field-not-object / manifest-version-unsupported / api-invalid / experimental-invalid。

签名事实源：`src/shared/addonIdentity.ts`

```ts
/** 私有身份声明字段名（package.json 顶层） */
export const ADDON_MANIFEST_FIELD = 'vsidianAddon'

/** 身份声明格式版本（与公开 API 版本分开） */
export const ADDON_IDENTITY_MANIFEST_VERSION = 1

/** 合法身份声明形状 */
export interface AddonIdentityDeclaration {
  /** 声明格式版本（当前仅支持 1） */
  manifestVersion: number
  /** 支持的稳定 API 范围（semver range 子集，如 '^1.0.0'） */
  api: string
  /** 确有使用时才声明的实验入口兼容范围（入口名 → 版本范围） */
  experimental?: Readonly<Record<string, string>>
}

/** 声明解析结果：none = 普通扩展（无声明，不入组件列表） */
export type AddonDeclarationParseResult =
  | { kind: 'none' }
  | {
      kind: 'invalid'
      /** 拒绝原因（呈现层组句用） */
      reason: 'field-not-object' | 'manifest-version-unsupported' | 'api-invalid' | 'experimental-invalid'
    }
  | { kind: 'ok'; declaration: AddonIdentityDeclaration }
```

**验证**：`test/unit/addonIdentity.test.ts`、`test/integration/suite/addonT02Cases.ts`

### `compatibility` 兼容判定（稳定 API 范围与实验入口）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#350（T01）

**目标**：声明的 api 范围须包含宿主当前稳定 API 版本（首个候选 1.0.0）；声明的实验入口逐项核对宿主已提供且版本匹配。API 版本独立于 Vsidian 本体版本号。

语义要点：
- **生命周期**：不因普通本体升级自动改变稳定 API 兼容判断；宿主实验入口未提供的入口名判 experimental-unsupported（如实反映未发布）。
- **错误与拒绝**：api-range / experimental-unsupported / experimental-incompatible 三种拒绝；experimental 拒绝时点名入口名。

签名事实源：`src/shared/addonIdentity.ts`

```ts
/**
 * 首个候选稳定 API 版本（`^1.0.0` 语义的基准）。当前不存在已发布的公开
 * API——附加组件声明的 api 范围须包含该版本才判兼容；API 版本独立于
 * Vsidian 本体版本号。
 */
export const ADDON_API_VERSION = '1.0.0'

/** 兼容判定的宿主侧输入 */
export interface AddonCompatibilityHost {
  /** 宿主当前提供的稳定 API 版本 */
  apiVersion: string
  /** 宿主当前支持的实验入口表（入口名 → 宿主侧版本范围；未发布的入口不在表内） */
  experimental: Readonly<Record<string, string>>
}

export type AddonCompatibility =
  | { compatible: true }
  | {
      compatible: false
      reason: 'api-range' | 'experimental-unsupported' | 'experimental-incompatible'
      /** experimental 拒绝时点名入口名 */
      entry?: string
    }

/** 兼容判定：声明范围须包含宿主稳定 API 版本；声明的实验入口须宿主已提供
 *  且版本匹配。当前宿主实验入口表为空——任何 experimental 声明都会被判
 *  experimental-unsupported（如实反映「实验入口未发布」）。 */
export function checkAddonCompatibility(
  declaration: AddonIdentityDeclaration,
  host: AddonCompatibilityHost,
): AddonCompatibility {
  if (!satisfiesSemverRange(declaration.api, host.apiVersion)) {
    return { compatible: false, reason: 'api-range' }
  }
  for (const [entry, range] of Object.entries(declaration.experimental ?? {})) {
    const hosted = host.experimental[entry]
    if (hosted === undefined) {
      return { compatible: false, reason: 'experimental-unsupported', entry }
    }
    if (!satisfiesSemverRange(range, hosted)) {
      return { compatible: false, reason: 'experimental-incompatible', entry }
    }
  }
  return { compatible: true }
}
```

**验证**：`test/unit/addonIdentity.test.ts`、`test/unit/addonRegistry.test.ts`

### `register-addon` 宿主注册入口（registerAddon）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#350（T01）、#351（T02）

**目标**：Vsidian activate() 返回的公开导出 API：组件经 extensions.getExtension('onegayi.vsidian').exports 调用 registerAddon 接入。owner 为调用者的原生 Extension 身份，组件激活中即可调用（不要求 isActive）。

语义要点：
- **生命周期**：Vsidian 先就绪 API 再扫描唤醒；VSCode 也可能先原生激活组件——两条路径使用相同的校验。同一接入代次重复注册返回 already-registered（不重跑 setup）；手动重试先 dispose 旧句柄再注册。dispose 重复调用无害。
- **错误与拒绝**：四种拒绝：not-addon-extension / extension-not-in-host / incompatible-api / already-registered（普通 API 拒绝，不算组件故障）。

签名事实源：`src/host/addons/addonWiring.ts`

```ts
/**
 * 公开导出 API（T02 形状；apiVersion 1.0.0 为首个候选版本——草案，未发布，
 * 不冒充已发布稳定契约）。
 */
export interface VsidianAddonExports {
  /** 宿主当前提供的稳定 API 版本 */
  readonly apiVersion: string
  /**
   * 附加组件接入注册入口。owner 为调用者的原生 Extension 身份（至少含
   * id；组件激活中即可调用）。同一接入代次重复注册返回
   * already-registered（不重跑 setup）；手动重试先 dispose 旧句柄（释放
   * 全部贡献）再注册。成功结果的 dispose 即「所属组件释放句柄」（设计
   * §3），重复调用无害。
   */
  registerAddon(
    owner: { id: string },
    definition?: AddonDefinition,
  ): AddonRegistrationResult & { dispose?(): void }
}

/** 本扩展自身 ID（附加组件建议声明对它的原生依赖） */
export const VSIDIAN_EXTENSION_ID = 'onegayi.vsidian'
```

**验证**：`test/unit/addonHostRegistration.test.ts`、`test/unit/addonCoordinator.test.ts`、`test/integration/suite/addonT02Cases.ts`

### `addon-definition` 注册定义与两段生命周期（setup/enable）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#351（T02）

**目标**：设置接入与运行功能分别管理：setup 注册设置定义、自己的设置页与设置通信（普通停用后保留）；enable 注册编辑器页面入口与运行功能（按用户功能开关启停）。

语义要点：
- **生命周期**：setup 在注册成功时本代次恰好一次；enable 开启时调用、关闭或故障时释放所属注册；作者可登记清理回调，退出作用范围时执行。可归因的注册/初始化/回调异常触发全组件故障暂停（释放注册、保留偏好、提供手动重试）。

签名事实源：`src/host/addons/addonRegistry.ts`

```ts
/** 组件注册传入的定义（T02 形状：setup 轻量接入 + enable 运行装配） */
export interface AddonDefinition {
  /** 轻量接入回调：注册成功时在本接入代次恰好调用一次 */
  setup?(context: AddonSetupContext): void
  /** 运行装配回调：按用户功能开关开启时调用；关闭或故障时释放所属注册 */
  enable?(context: AddonEnableContext): void
}

/** 轻量接入上下文（setup 生命周期：设置定义 + 自己的设置入口 + 设置通信。
 *  普通功能停用后保留；故障暂停时回收组件代码——迟到注册被拒） */
export interface AddonSetupContext extends AddonRegistrationContext {
  /** 设置能力面（T04 起含读写与事件；定义归组件隔离范围） */
  readonly settings: AddonSettingsContextApi
  /** #404 组件数据目录（globalStorage 语义的隔离可写目录 + 文件监听；
   *  富结构数据（规则对象等）归本面，不并入设置存储的一层边界） */
  readonly storage: AddonStorageFacet
  /** 设置生命周期通道（归 setup 所在的生命周期） */
  readonly channel: AddonChannelRegistry
}

/** 运行上下文（enable 生命周期：编辑器页面入口 + 运行通道 + 清理回调。
 *  开启时装配；关闭或故障时释放所属注册） */
export interface AddonEnableContext extends AddonRegistrationContext {
  /** 编辑器页入口登记（自身安装目录内的相对路径；每组件一个编辑器入口，
   *  第二个登记拒绝） */
  readonly pages: {
    registerEditor(entry: AddonPageEntryInput): AddonRegistrationHandle
  }
  /** #404 组件数据目录（与 setup 上下文同一实例——数据能力与功能开关无关） */
  readonly storage: AddonStorageFacet
  /** 运行生命周期通道（停用即注销） */
  readonly channel: AddonChannelRegistry
  /** 登记清理回调（停用/故障/代次终结时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

/** 注册面返回的释放句柄（重复 dispose 无害；迟到登记被拒时为 no-op） */
export interface AddonRegistrationHandle {
  dispose(): void
}
```

**验证**：`test/unit/addonRuntime.test.ts`、`test/integration/suite/addonT02Cases.ts`、`test/integration/suite/addonT12Cases.ts`

### `official-registry` 官方（核心）组件登记表

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#354（T05）

**目标**：官方归属只由主仓库维护的扩展 ID 清单判定（唯一入口 isOfficialAddon）；组件不能自行声明「核心」。初版为空占位——首个官方组件发布时在表内登记。

语义要点：
- **生命周期**：登记官方组件只改 officialAddons.ts；表内容变化不构成兼容性承诺（第三方不得依据曾在表内/表外主张契约）。

签名事实源：`src/shared/officialAddons.ts`

```ts
/** 官方附加组件登记条目（extensionId 是判定键；label 备注不参与判定） */
export interface OfficialAddonEntry {
  /** 官方组件的 VSCode 扩展 ID（publisher.name） */
  readonly extensionId: string
  /** 维护备注（用途或发布仓线索；仅文档性质） */
  readonly label?: string
}

/**
 * 官方（核心）附加组件登记表。初版为空占位——首个官方组件发布时在此
 * 登记；「核心组件」侧栏分组随之从空态转为条目列表。
 */
export const OFFICIAL_ADDON_REGISTRY: readonly OfficialAddonEntry[] = [
  // 登记样例（形态参考，勿留注释放行）：
  // { extensionId: 'onegayi.vsidian-official-xxx', label: '官方 xxx 组件' },
]

/** 判定用 ID 清单（登记表的投影视，供 isOfficialAddon 与文档消费） */
export const OFFICIAL_ADDON_EXTENSION_IDS: readonly string[] = OFFICIAL_ADDON_REGISTRY.map(
  (entry) => entry.extensionId,
)
```

**验证**：`test/unit/addonIdentity.test.ts`

### `addon-status` 组件状态模型与设置页呈现

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#350（T01）、#355（T06 运行状态）

**目标**：设置页「附加组件」分页的状态载荷：七种状态覆盖注册、唤醒在途、待注册、不兼容、激活失败、宿主不可查与声明非法；故障暂停标注但不改变「已启用」归类。

语义要点：
- **生命周期**：启用偏好与实际故障分别记录（enabled 与 fault 两个字段）；host-unavailable 原因不可判——不直接写成未安装或装错侧。

签名事实源：`src/shared/addonIdentity.ts`

```ts
export interface AddonStatusEntry {
  /** 组件 ID（沿用 Extension.id） */
  id: string
  /** 展示名（displayName 或 id 回退） */
  label: string
  /** 官方归属（仅 OFFICIAL_ADDON_EXTENSION_IDS 判定） */
  official: boolean
  status: AddonStatusKind
  /** 原因/摘要原文（错误消息、声明范围等；呈现层原样展示或组句） */
  detail?: string
  /** 不兼容时携带的声明 api 范围（组句呈现） */
  apiRange?: string
  /** #351 T02 运行状态（已注册组件附带）：用户偏好生效值（设置页开关
   *  与「已启用/已停用」归类依据）；未注册组件缺省 */
  enabled?: boolean
  /** #351 T02 故障暂停（可归因异常原文——基础可观察，完整诊断归 T12） */
  fault?: { reason: string }
  /** #351 T02 设置页入口当前可装载（「打开设置页」入口可见性） */
  hasSettingsPage?: boolean
  /** #353 T04 已注册设置定义（「基础设置」入口可见性；故障暂停时定义
   *  保留——入口仍在，平台基础控件可用） */
  hasSettingsDefinitions?: boolean
}

/** 设置页状态列表条目（发现/注册协调的呈现载荷；协议 addons.state 使用） */
export type AddonStatusKind =
  /** 已注册（setup 已在本接入代次执行） */
  | 'registered'
  /** 唤醒在途（Vsidian 主动 activate 进行中） */
  | 'activating'
  /** 已激活（原生或唤醒）但组件尚未调用注册入口 */
  | 'awaiting-registration'
  /** 合法声明但 API 范围/实验兼容不符（不唤醒） */
  | 'incompatible'
  /** 主动唤醒失败（激活抛错） */
  | 'activation-failed'
  /** 曾发现，当前宿主已查不到（原因不可判——不等于未安装或装错侧） */
  | 'host-unavailable'
  /** 声明形状非法 */
  | 'invalid-declaration'
```

**验证**：`test/integration/suite/addonT02Cases.ts`、`test/browser/addonSidebar.mjs`

## 2. 页面 SDK

**能力范围**：编辑器/设置页的装载协议、注入 SDK、统一视图与编辑、通道

### `page-sdk` 注入组件工厂的页面 SDK

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页、设置页 · **引入**：#351（T02），facet 随 T06–T11 增补

**目标**：装载器核对入口身份后调用工厂注入 SDK：装载身份（组件 ID + 代次 + 页面种类）、六个能力 facet、CM6 扩展登记、设置页挂载根、资源地址与释放回调。

语义要点：
- **生命周期**：代次是硬边界：旧工厂注册、旧消息、迟到结果不能接入新代次；onDispose 回调在停用/故障/代次回收时执行（重复释放无害）。
- **错误与拒绝**：views/behaviors/commands/menus/renderers/ui 六个 facet 仅编辑器页提供（设置页为 undefined）；resourceUri 越出资源子目录返回 null（组件不得自造越界地址）。

签名事实源：`src/shared/addonPage.ts`

```ts
/** 注入组件工厂的页面 SDK（T02 子集：页面装配、共享运行时、资源与通信
 * 生命周期；T06（#355）起编辑器页提供 views 面——统一视图句柄、快照与
 * 文本提交；T07（#356）起编辑器页提供 behaviors 面——可组合输入行为的
 * 注册与观察；T09（#358）起提供 renderers 面——代码块渲染提供者候选
 * 登记；六组稳定能力的其余部分属后续票） */
export interface VsidianAddonPageSdk {
  /** 本次装载身份：组件 ID + 装载代次 + 页面种类 */
  readonly addon: { id: string; generation: number; page: AddonPageKind }
  /** 实验入口（仅编辑器页提供；设置页为 undefined）：cm6 = CM6 共享
   *  运行时；headingFold = 标题折叠查询与命令（#410）；viewIdentity =
   *  视图身份反查（#426）；syntax = 行类型与行内标记查询（#433）。使用
   *  前须在清单 experimental 声明对应入口的兼容范围 */
  readonly experimental: {
    readonly cm6?: AddonCm6Runtime
    readonly headingFold?: AddonHeadingFoldFacet
    readonly viewIdentity?: AddonViewIdentityFacet
    readonly syntax?: AddonSyntaxFacet
  }
  /** T06（#355）统一视图面（仅编辑器页；设置页为 undefined）：主正文、
   *  嵌入内部 Live 与悬停引用的句柄列表、快照读取、文本提交（默认原子
   *  或显式 joinPrevious）与选区/定位——来源身份由 SDK 注入 */
  readonly views?: AddonViewsFacet
  /** T07（#356）输入行为面（仅编辑器页；设置页为 undefined）：注册可
   *  组合输入行为（按有效序依次修饰同次操作，后续行为读取前序结果，
   *  每次修饰按自己的原子声明提交）与只读输入观察——注册与观察分开，
   *  onChanged 不是原操作的第二写入口 */
  readonly behaviors?: AddonBehaviorsFacet
  /** T10（#359）命令面（仅编辑器页；设置页为 undefined） */
  readonly commands?: AddonSdkCommandsFacet
  /** T10（#359）菜单面（仅编辑器页；设置页为 undefined） */
  readonly menus?: AddonSdkMenusFacet
  /** T09（#358）渲染提供者面（仅编辑器页；设置页为 undefined）：登记
   *  代码块渲染候选——可序列化声明上报宿主参与确定性选择，回调留在
   *  本页执行；生效表广播回来后才承担挂载（顺序不靠装载竞速） */
  readonly renderers?: AddonRenderersFacet
  /** T11（#360）界面面（仅编辑器页；设置页为 undefined）：工具栏按钮与
   *  面板的挂载注册（平台预定义挂载点——不接管内核容器） */
  readonly ui?: AddonSdkUiFacet
  /** 编辑器页：登记 CM6 扩展（经页面装配槽挂载；返回是否被接受） */
  registerExtension(extension: Extension): boolean
  /** 设置页：取得本组件的挂载根（编辑器页返回 null；重复调用各建新根） */
  mountRoot(): HTMLElement | null
  /** 取组件安装目录内资源的本页地址（宿主装载时已按本 webview 授权；
   *  字面 `..` 等越界相对路径返回 null——#395 P3 措辞降级：本层只拦字面
   *  形态，是防呆层而非安全边界，编码变形与同 realm 直连不在防线内；
   *  有效边界是 localResourceRoots 包含性 + 宿主 realpath 守卫） */
  resourceUri(relativePath: string): string | null
  /** 页面 → 宿主 JSON 请求（载荷与结果可序列化；结束态见 AddonChannelOutcome） */
  readonly channel: {
    request(topic: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<AddonChannelOutcome>
  }
  /** 登记释放回调（停用/故障/代次回收时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

/** 组件工厂：由构建辅助工具的 defineAddonPage 登记，装载器注入 SDK 调用 */
export type AddonPageFactory = (sdk: VsidianAddonPageSdk) => void

export type AddonPageKind = 'editor' | 'settings'
```

**验证**：`test/unit/addonPageLoader.test.ts`、`test/browser/addonPageSdk.mjs`、`test/integration/suite/addonT02Cases.ts`

### `page-load-protocol` 页面装载协议（指令与出站消息）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页、设置页 · **引入**：#351（T02）

**目标**：宿主与页面之间的装载/卸载/通道/故障消息形状。装载实现细节（作者一般经构建桥间接使用，不直接记忆桥接名）；每 webview 资源独立授权，不复用另一页 URI。

语义要点：
- **生命周期**：装载指令携带代次；卸载结果区分 not-loaded / stale-generation / already-released；样式逐条独立装载互不牵连。
- **错误与拒绝**：五种装载失败原因：already-loaded / script-load-failed / identity-mismatch / no-factory-registered / factory-error（工厂同步异常与 async 工厂 rejection 同归因：按故障释放全部注册并整代次回滚，rejection 迟到则静默丢弃）。

签名事实源：`src/shared/addonPage.ts`

```ts
/** 宿主下发的装载指令载荷（URI 均由宿主经本 webview 的 asWebviewUri 构造） */
export interface AddonLoadManifest {
  addonId: string
  generation: number
  page: AddonPageKind
  /** 入口脚本的本页地址（须在 localResourceRoots 许可面内，否则资源服务拒绝） */
  scriptUri: string
  /** 随装载注入的样式表地址（逐条独立装载，互不牵连） */
  cssUris?: string[]
  /** 资源子目录的本页基址（resourceUri 的解析锚；缺省时 resourceUri 恒 null） */
  resourceBase?: string
}

/** 装载结果（授权脚本 + 身份核对 + 工厂装配的复合结局） */
export type AddonLoadOutcome =
  | {
      ok: true
      /** 逐条样式的装载结局：authorized = 表已装载可读；denied = 拒绝/失败 */
      css: Array<{ uri: string; status: 'authorized' | 'denied' }>
    }
  | { ok: false; reason: AddonLoadFailureReason; detail?: string }

export type AddonLoadFailureReason =
  /** 同一组件已在装载中（对齐设计 §2.2 的 AlreadyRegistered 语义） */
  | 'already-loaded'
  /** 脚本装载失败：未授权路径被资源服务拒绝、404 或网络失败 */
  | 'script-load-failed'
  /** 登记身份与本次入口身份不符（加载器核对组件 ID） */
  | 'identity-mismatch'
  /** 脚本执行完成但没有登记任何工厂 */
  | 'no-factory-registered'
  /** 工厂或同步装配抛出可归因异常——已按故障释放全部注册 */
  | 'factory-error'

/** 卸载结果（代次核对是硬边界：旧代次指令不生效） */
export type AddonUnloadOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-loaded' | 'stale-generation' | 'already-released' }

/** 宿主 → 页面装载指令 */
export type AddonPageDirective =
  | { type: 'addon.load'; manifest: AddonLoadManifest }
  | { type: 'addon.unload'; addonId: string; generation: number }
  | {
      type: 'addon.channel.reply'
      addonId: string
      generation: number
      requestId: string
      outcome: AddonChannelOutcome
    }
  | { type: 'addon.fault'; addonId: string; generation: number; reason?: string }

/** 页面 → 宿主出站消息 */
export type AddonPageOutbound =
  | {
      type: 'addon.loaded'
      addonId: string
      generation: number
      /** 发出消息的页面种类（宿主按面对比代次——编辑器/设置两计数器独立） */
      page: AddonPageKind
      outcome: AddonLoadOutcome
    }
  | {
      type: 'addon.unloaded'
      addonId: string
      generation: number
      outcome: AddonUnloadOutcome
      /** 释放时已执行的回调数与仍滞留的通道请求数（释放完整性证据） */
      disposals: number
      releasedRequests: number
    }
  | {
      type: 'addon.faulted'
      addonId: string
      generation: number
      page: AddonPageKind
      reason: string
    }
  | {
      type: 'addon.channel.request'
      addonId: string
      generation: number
      page: AddonPageKind
      requestId: string
      topic: string
      payload: unknown
    }
```

**验证**：`test/unit/addonPageLoader.test.ts`

### `page-bridge` SDK 构建桥（vsidian-addon-sdk 虚拟模块）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页、设置页 · **引入**：#349（V02 验证）、#351（T02 生产化）

**目标**：构建辅助工具提供的作者入口：defineAddonPage 在 IIFE 执行时把工厂推入全局登记表（作者不手写全局变量），currentSdk 读装载器注入槽（仅工厂执行期可靠）。

语义要点：
- **生命周期**：构建桥在 esbuild 解析期注入 shim（不是真实 npm 包）；组件产物为独立 IIFE（目标 chrome114——对齐下界宿主 Electron 25 / Chromium 114）。
- **自动规则**：构建桥拒绝 @codemirror/* 值导入（第一道防线）；产物静态标记断言不含 CM6 运行时串（第二道）——组件不得重打包 CM6，须经 experimental.cm6 取得。

签名事实源：`test/fixtures/addon-v02/sdk/vsidian-addon-sdk.d.ts`

```ts
/** 组件页面入口登记：IIFE 执行时调用，装载器核对身份后注入 SDK 调工厂 */
export function defineAddonPage(
  addonId: string,
  factory: (sdk: VsidianAddonPageSdk) => void,
): void

/** 模块作用域取当前 SDK（装载器调用工厂前注入；仅工厂执行期可靠） */
export function currentSdk(): VsidianAddonPageSdk | undefined
```

**验证**：`test/fixtures/addon-v02/sdk/buildAddon.mjs`、`test/browser/addonPageSdk.mjs`

### `views-editor` 统一视图与编辑面（views / editor）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#355（T06）

**目标**：主正文、嵌入内部 Live 与悬停引用共用统一句柄：枚举/订阅实例、读取快照、提交文本修饰（默认原子或显式 joinPrevious）、选区与定位。操作始终归当前目标文档——在引用 B 中编辑不误改父文档 A。

语义要点：
- **适用模式**：live 可写、reading 只读；hover 恒只读（写入拒 read-only）；embed 句柄身份为宿主 occurrence 序号。
- **坐标与数据形状**：全文 UTF-16 code unit 偏移、页面全程 LF（宿主适配器负责行尾转换）；快照含页面未确认输入——revision 标记覆盖「宿主版本未变但页面有未确认输入」的窗口。
- **生命周期**：来源身份由 SDK 注入（opId 按装载代次生成），作者请求结构上不携带身份字段——不能冒充其他组件。
- **错误与拒绝**：八种可辨认拒绝：view-disposed / read-only / suspended / stale-snapshot / history-boundary / conflict / error / invalid-request。旧快照不自动重试（内核输入重定位逻辑不适用于 API 提交）。
- **历史与撤回**：atomic（缺省）= 独立撤回边界；joinPrevious = 随同目标上次原子操作撤回，无可确认前项时拒绝（history-boundary 四种形态：空日志/仅外来/组顶被打断/映射失配）。撤销与重做归宿主文本管线。

签名事实源：`src/shared/addonEditApi.ts`

```ts
/** SDK views 面（views.list / views.get / 变化订阅——设计 §5.1）。
 *  仅编辑器页提供（设置页无编辑视图，views 为 undefined） */
export interface AddonViewsFacet {
  list(): readonly AddonViewInfo[]
  get(instanceId: string): AddonViewHandle | null
  onCreated(callback: (info: AddonViewInfo) => void): () => void
  onDisposed(callback: (info: AddonViewInfo) => void): () => void
}

/** SDK views 面返回的视图句柄（info 快照 + 编辑面） */
export interface AddonViewHandle {
  readonly info: AddonViewInfo
  readonly editor: AddonViewEditorFacet
}

/** views.list() 返回的有效实例句柄信息（设计 §5.1：实例/目标/模式/可编辑） */
export interface AddonViewInfo {
  /** 页面内稳定实例 ID：main 恒 'main'；embed/hover 为 occurrence 键 */
  instanceId: string
  /** 目标文档 URI（主正文 = 面板文档；embed/hover = 引用目标） */
  targetDocUri: string
  mode: AddonViewMode
  viewType: AddonViewType
  editable: boolean
}

/** 视图句柄的编辑面（view.editor.*）：目标从有效句柄取得；来源身份由
 *  SDK 层注入（组件请求不携带），伪来源请求结构上不可表达 */
export interface AddonViewEditorFacet {
  getSnapshot(): AddonSnapshotResult
  applyEdits(request: AddonApplyEditsRequest): Promise<AddonApplyEditsResult>
  /** 设置选区（零文本变更：不出站、不造文本撤销项）；拒绝返回 false */
  setSelection(ranges: AddonSelectionRange[]): boolean
  /** 滚动定位（零文本变更；不移动光标）；拒绝返回 false */
  reveal(offset: number): boolean
}

/** view.editor.getSnapshot() 结果（设计 §5.1：文本、多选区、权威版本、
 *  快照修订标记） */
export interface AddonEditorSnapshot {
  /** 页面文本（UTF-16/LF；含页面未确认输入——快照描述视图现状） */
  text: string
  /** 多选区（有序；只读视图为空数组） */
  selections: AddonSelectionRange[]
  /** 权威文档版本（页面已确认到的宿主版本） */
  version: number
  /** 快照修订标记：页面文档代次计数（本地输入与外部同步都推进）。
   *  提交请求携带快照 revision，执行时点失配即拒绝 stale-snapshot——
   *  覆盖「宿主版本未变但页面有未确认输入」的窗口（设计 §5.1：修订
   *  标记不能只看尚未包含页面未确认状态的宿主版本） */
  revision: number
}

/** 选区范围（LF 偏移；anchor/head 与 CM6 语义一致） */
export interface AddonSelectionRange {
  anchor: number
  head: number
}

/** applyEdits 请求（作者提供的业务修改；来源身份由 SDK 注入，不在此形） */
export interface AddonApplyEditsRequest {
  /** 快照修订标记（getSnapshot 返回值；失配 = 旧快照，明确拒绝） */
  revision: number
  /** 变更列表（LF 坐标，多范围 = 一笔修饰操作，Q29：不按底层变更拆分） */
  changes: SerChange[]
  /** 提交后选区（随同一事务原子应用；缺省保持实例现有选区重定位） */
  selection?: AddonSelectionRange
  /** 撤回边界声明；缺省 atomic */
  history?: AddonEditHistory
}

export type AddonApplyEditsResult =
  | { ok: true; credential: AddonEditCredential }
  | { ok: false; reason: AddonEditRejection }

/** 可辨认拒绝类型（接口冻结面；新增值视为契约变更） */
export type AddonEditRejection =
  /** 句柄已释放 / 实例已销毁 */
  | 'view-disposed'
  /** 只读视图（hover 引用、reading 态主正文）不接受写入 */
  | 'read-only'
  /** 视图失活（冲突暂停写回） */
  | 'suspended'
  /** 快照修订失配（旧快照；内核输入重定位不适用于 API 提交，不自动重试） */
  | 'stale-snapshot'
  /** joinPrevious 无可确认的同目标前项（HistoryBoundaryUnavailable 语义：
   *  空日志、仅外来写入、组顶被外来写入打断、映射失配四种形态） */
  | 'history-boundary'
  /** 宿主冲突拒绝（不可安全重定位 / 暂停面板） */
  | 'conflict'
  /** 宿主写回失败 */
  | 'error'
  /** 请求形状非法（revision/changes/selection 越界或类型错误） */
  | 'invalid-request'

/** 提交凭据（宿主确认后签发；与该笔 edit.ack(ok) 同源版本） */
export interface AddonEditCredential {
  /** 本次修饰操作 ID（SDK 注入；凭据可对账来源记录） */
  opId: string
  /** 宿主确认版本 */
  version: number
}
```

**验证**：`test/unit/addonEditApi.test.ts`、`test/unit/addonViews.test.ts`、`test/integration/suite/addonT06Cases.ts`、`test/browser/addonT06EditHost.mjs`、`test/integration/suite/addonHistoryCases.ts`

### `cm6-experimental` 实验入口：共享 CM6 运行时（experimental.cm6）

**分层**：实验入口（不随稳定 API 弃用期限承诺） · **执行端**：编辑器页 · **引入**：#349（V02）、#351（T02 登记候选版本）、#406（language 语法树子集）
> **实验入口**：清单 `experimental` 声明名 `cm6`——兼容边界见上方实验入口兼容清单。

**目标**：页面 bundle 自构造的 CM6 模块命名空间（state 与 view）与语法树读取子集（language，#406 起），与生产控制器共享同一实例（构造器身份一致）。供高级扩展登记真正的 CM6 Extension 与做基于语法树的行类型判定。

语义要点：
- **生命周期**：仅编辑器页提供（设置页 undefined）；使用前须在清单 experimental 声明 cm6 兼容范围，且范围含宿主提供的入口版本才判兼容。
- **错误与拒绝**：宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。
- **暴露面裁剪**：language 只暴露 syntaxTree / ensureSyntaxTree / syntaxTreeAvailable 三个读树函数（最小暴露集合的单一裁剪点在装载器的 addonCm6LanguageSubset）——LRLanguage / foldGutter / indentUnit 等注册类成员不纳入，addon 不应借实验入口注册语言或改全局语言配置；树与节点类型经 type-only 导入消费（构建桥允许）。已知边界：live 编辑器的 markdown 语法树是内核私有增量解析（不经 @codemirror/language 的 language facet 装配），syntaxTree 在 live 状态上恒为未解析空树——行类型判定类需求不能依赖本入口，平台级树查询能力另行评估。
- **按键优先级**：#402 按键拦截优先级契约（实验层）：扩展槽为平台扩展数组末位——普通 keymap 在平台情境链（Tab 三段/列表续行等）不处理时落空接手；Prec.high 为抢先层（可替代平台键位，返回 false 落穿）；撤销/重做（Mod-z / Shift-Mod-z / Mod-y）是 Prec.highest 的平台保留键闸、在扩展序上先于附加组件槽——addon 用 Prec.highest 也不可越过；Esc 与宿主级快捷键不开放抢先；多组件同层按装载顺序仲裁；实验层 keymap 不进统一快捷键管理，用户关闭 = 停用组件。

签名事实源：`src/shared/addonPage.ts`

```ts
/** 页面提供的共享 CM6 运行时（experimental.cm6 的内容）。值为本页 bundle
 *  内的模块命名空间对象——装载器由页面产物自身构造，因此与生产控制器
 *  共享同一份实例（构造器身份一致的机制来源）。language 是语法树读取
 *  函数子集（#406），非整模块命名空间。 */
export interface AddonCm6Runtime {
  readonly state: typeof import('@codemirror/state')
  readonly view: typeof import('@codemirror/view')
  readonly language: AddonCm6LanguageRuntime
}

/** #406 language 语法树读取子集（@codemirror/language 的最小暴露面）：
 *  只纳入「读树」函数——LRLanguage/foldGutter/indentUnit 等注册类成员不
 *  暴露（addon 不应借实验入口注册语言或改全局语言配置）；树与节点的
 *  类型消费经 type-only 导入（构建桥允许），无需值暴露。 */
export interface AddonCm6LanguageRuntime {
  readonly syntaxTree: (typeof import('@codemirror/language'))['syntaxTree']
  readonly ensureSyntaxTree: (typeof import('@codemirror/language'))['ensureSyntaxTree']
  readonly syntaxTreeAvailable: (typeof import('@codemirror/language'))['syntaxTreeAvailable']
}
```

**验证**：`test/unit/addonPageLoader.test.ts`、`test/browser/addonPageSdk.mjs`

### `heading-fold-experimental` 实验入口：标题折叠查询与命令（experimental.headingFold）

**分层**：实验入口（不随稳定 API 弃用期限承诺） · **执行端**：编辑器页 · **引入**：#410
> **实验入口**：清单 `experimental` 声明名 `headingFold`——兼容边界见上方实验入口兼容清单。

**目标**：页面 SDK 的标题折叠实验入口（sdk.experimental.headingFold，#410）：按 views 面实例 ID 查询有效折叠区间（folds）与可折叠区间全集（foldable），并执行折叠命令（apply 五操作、foldAt/unfoldAt 按区间键批量组合、foldAll 可 upToLevel 参数化）。折叠本体随 #409 落地（Live 实例的 CM6 StateField）；查询消费本体派生视图（不复制派生逻辑），命令直传本体五操作执行体——编程触发与用户触发同链路（effect 直驱，无 DOM-only 路径）。

语义要点：
- **适用模式**：Live-only（#409 定案阅读模式不开放）：reading 态主正文与 hover 只读视图一律 read-only 拒绝；设置页不提供该入口。实例按 views 面句柄寻址（main / embed occurrence 键），折叠态随实例独立；keymap/扩展回调拿到 CM6 view 时经 experimental.viewIdentity.instanceIdOf 反查实例 ID（#426，不依赖扩展槽装配范围推定）。
- **坐标与数据形状**：全文 UTF-16 code unit 偏移、页面全程 LF。span = { key（标题起始行行首）、level（ATX 1–6 / Setext 1–2）、hideFrom（标题块行尾）、hideTo（下一级别 ≤ 自身的标题行首或文档末尾）}；序列化面不含标题文本摘要（大文档保持精简——作者可从快照 text 与 key 对应标题行自取）。
- **生命周期**：折叠是视图态（零写回、不 dirty、不进撤销栈、不跨会话持久化）；全文替换显式清空、编辑时键随增量映射（#409 本体语义）。原始键集不对外——folds 是「折叠键 ∩ 可折叠标题键」的有效派生视图，脱靶键经此过滤天然无行为（foldAt/unfoldAt 的脱靶键静默忽略；applied = 有效折叠区间前后变化数）。#426 起 folds 与 foldable 共享同一 doc 版本的派生缓存（调用成本为 O(标题数) 过滤而非全文档重扫；返回逐项拷贝，组件侧变异不污染缓存），按键热路径消费无需自建行门槛节流。组件代次终结后的迟到调用拒绝 view-disposed。
- **错误与拒绝**：三种可辨认拒绝：view-disposed / read-only / invalid-request（upToLevel 仅 foldAll 接受且须为 1–6 整数；区间键须为非负整数）。使用前须在清单 experimental 声明 headingFold 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。

签名事实源：`src/shared/addonFoldApi.ts`

```ts
/** 折叠区间（LF 偏移；与本体派生视图同构）。key 同时是 foldAt/unfoldAt
 *  的区间定位键——只能来自查询结果（作者自算坐标属脱靶风险自负） */
export interface AddonHeadingFoldSpan {
  /** 折叠键：标题起始行行首 offset（ATX = `#` 行行首；Setext = 内容首行行首） */
  key: number
  /** 标题级别（ATX 1–6 / Setext 1–2） */
  level: number
  /** 隐藏区间起点：标题块行尾（标题行保持可见） */
  hideFrom: number
  /** 隐藏区间终点：下一级别 ≤ 自身的标题行行首，或文档末尾 */
  hideTo: number
}

/** 命令操作（与本体五操作一一对应，编程触发与用户触发同链路）：
 *  fold/unfold/toggle 为选区驱动（按实例当前选区解析目标——组件可先经
 *  views 面 setSelection 定位）；foldAll/unfoldAll 作用全文档 */
export type AddonHeadingFoldOperation = 'fold' | 'unfold' | 'toggle' | 'foldAll' | 'unfoldAll'

/** apply 可选参数（形状守卫见 isAddonHeadingFoldApplyOptions） */
export interface AddonHeadingFoldApplyOptions {
  /** 仅 foldAll 接受：折叠级别上限（level ≤ upToLevel 的可折叠标题才折叠；
   *  合法值 1–6 整数）。其他操作携带即 invalid-request */
  upToLevel?: number
}

/** 拒绝类型（接口冻结面；新增值视为契约变更）：view-disposed = 句柄已
 *  释放/实例已销毁/组件代次已终结；read-only = Live-only 边界（reading
 *  态或 hover 只读视图）；invalid-request = 请求形状非法 */
export type AddonHeadingFoldRejection = 'view-disposed' | 'read-only' | 'invalid-request'

/** 查询结果（spans 按文档序） */
export type AddonHeadingFoldQueryResult =
  | { ok: true; spans: readonly AddonHeadingFoldSpan[] }
  | { ok: false; reason: 'view-disposed' | 'read-only' }

/** 命令结果：applied = 实际发生折叠/展开变更的区间数（有效派生口径的
 *  前后变化数；0 = 无目标或重复提交的静默 no-op） */
export type AddonHeadingFoldCommandResult =
  | { ok: true; applied: number }
  | { ok: false; reason: AddonHeadingFoldRejection }

/** 折叠面（experimental.headingFold 的内容；仅编辑器页提供）。方法按
 *  views 面的实例 ID 寻址——主正文 'main'、嵌入内部 Live 为 occurrence
 *  键（views.list 枚举），折叠态随实例独立 */
export interface AddonHeadingFoldFacet {
  /** 有效折叠区间（派生视图：脱靶键过滤，原始键集不对外） */
  folds(instanceId: string): AddonHeadingFoldQueryResult
  /** 全部可折叠标题区间（空节/纯空白节排除） */
  foldable(instanceId: string): AddonHeadingFoldQueryResult
  /** 五操作执行（选区驱动三操作 + 全文档两操作；upToLevel 仅 foldAll） */
  apply(
    instanceId: string,
    operation: AddonHeadingFoldOperation,
    options?: AddonHeadingFoldApplyOptions,
  ): AddonHeadingFoldCommandResult
  /** 按区间键折叠（键集并入；键须来自查询结果，脱靶键静默忽略） */
  foldAt(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
  /** 按区间键展开（键集差集；脱靶键静默忽略） */
  unfoldAt(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
}
```

**验证**：`test/unit/addonFoldApi.test.ts`、`test/unit/addonHeadingFoldApi.test.ts`、`test/browser/addonHeadingFold.mjs`

### `view-identity-experimental` 实验入口：视图身份反查（experimental.viewIdentity）

**分层**：实验入口（不随稳定 API 弃用期限承诺） · **执行端**：编辑器页 · **引入**：#426
> **实验入口**：清单 `experimental` 声明名 `viewIdentity`——兼容边界见上方实验入口兼容清单。

**目标**：页面 SDK 的视图身份反查面（sdk.experimental.viewIdentity，#426）：CM6 EditorView → views 面实例 ID。keymap/扩展回调拿到的是 view，按实例 ID 寻址的 API（headingFold 查询与命令等）经此换算——不再依赖「扩展槽仅挂主正文 Live 实例」的装配范围推定（该装配范围契约见开发指南「视图身份与扩展槽」）。

语义要点：
- **生命周期**：身份承载于 Live 实例的 CM6 StateField，注册进视图注册表时写入（main 恒 main；embed 为 embed:<hostId>）；实例销毁随 state 消亡。未装配身份的 view（非平台实例或尚未注册）返回 null——组件据此自判。方法为闭包实现，无 this 依赖（解构裸传安全；SDK 各面通用的接收者绑定约束见开发指南）。
- **错误与拒绝**：使用前须在清单 experimental 声明 viewIdentity 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。

签名事实源：`src/shared/addonEditApi.ts`

```ts
/** #426 视图身份反查面（experimental.viewIdentity 的内容）：CM6
 *  EditorView → 平台实例 ID。keymap/扩展回调拿到的是 view，按 ID 寻址
 *  的 API（headingFold 等）经此换算——不再依赖「扩展槽仅挂主正文」的
 *  装配范围推定。方法为闭包实现（无 this 依赖，解构裸传安全） */
export interface AddonViewIdentityFacet {
  /** 反查实例 ID：装配在平台 Live 实例（main/embed）上的 view 返回其
   *  views 面句柄 ID；未装配身份的 view（非平台实例或尚未注册）null */
  instanceIdOf(view: import('@codemirror/view').EditorView): string | null
}
```

**验证**：`test/unit/addonPageLoader.test.ts`、`test/unit/liveInstance.test.ts`、`test/unit/addonRegistry.test.ts`

### `syntax-experimental` 实验入口：行类型与行内标记查询（experimental.syntax）

**分层**：实验入口（不随稳定 API 弃用期限承诺） · **执行端**：编辑器页 · **引入**：#433
> **实验入口**：清单 `experimental` 声明名 `syntax`——兼容边界见上方实验入口兼容清单。

**目标**：页面 SDK 的行类型/行内标记位置查询面（sdk.experimental.syntax，#433，#408 B+ 形态落定）：光标驱动的单点查询，供输入行为类组件判定当前位置语义（替代组件自带的全文档文本扫描）。live 树对 frontmatter 反语义（HorizontalRule/SetextHeading2）、公式零语义（皆 Paragraph），查询面在平台侧组合三条常驻管线（增量树 + frontmatter 区间缓存 + 跨行公式块表）给出平台自有枚举——不暴露树/节点句柄，不把 Lezer 节点名变成事实契约。

语义要点：
- **适用模式**：Live-only：reading 态主正文与 hover 只读视图一律 read-only 拒绝；设置页不提供该入口。实例按 views 面句柄寻址，与 headingFold 同款；keymap/扩展回调可经 viewIdentity.instanceIdOf 反查实例 ID。
- **坐标与数据形状**：全文 UTF-16 code unit 偏移、页面全程 LF。pos 为非负整数（否则 invalid-request；形状校验在边界拒绝之后——视图不在场或非 Live 时先折 view-disposed / read-only）；超出文档长度时钳制到文末（行尾是合法光标位）。
- **生命周期**：位置驱动单点查询（µs 级：三管线常驻快照 + 单行扫描），无全树 iterate 形态；查询零写回。行类型判定链：frontmatter 区间（行级，树上反语义先拦截）→ 跨行公式块表（块级代码上下文内不命中——块表是纯文本扫描，围栏/缩进代码内 $$ 是字面，与 live 渲染抑制同口径；公式块内容含行内代码 span 不受影响）→ 树链枚举（code（围栏与缩进代码）> table > heading > list > quote，嵌套组合取先命中者）→ 单行闭合块 $$x$$（独占一行）→ 兜底 text。行内标记判定链：frontmatter → none（源码态）→ InlineCode → code → 其余代码上下文 → none（$ 为字面）→ 公式块表/当前行扫描 → formula → 兜底 none。
- **错误与拒绝**：三种可辨认拒绝：view-disposed / read-only / invalid-request（pos 须为非负整数）。使用前须在清单 experimental 声明 syntax 兼容范围；宿主未提供该入口或版本不符时整个组件判不兼容（experimental-unsupported / experimental-incompatible）——不是运行期降级。nodeNames 为诊断载荷，显式声明非稳定、不构成兼容承诺（节点名随解析器升级变化）。

签名事实源：`src/shared/addonSyntaxApi.ts`

```ts
/** 行类型枚举（块级维度；callout 一期不入枚举——live 侧无识别管线，
 * 引用块形态统一 quote，落档见 developer-guide「与 Obsidian 上游语义
 * 对照」节） */
export type AddonSyntaxLineKind =
  | 'frontmatter'
  | 'code'
  | 'formula'
  | 'table'
  | 'heading'
  | 'quote'
  | 'list'
  | 'text'

/** 行内标记枚举（位置级行内维度；none = 普通文本位置） */
export type AddonSyntaxInlineKind = 'code' | 'formula' | 'none'

/** 拒绝类型（照 addonFoldApi 三值先例；接口冻结面）：view-disposed =
 * 句柄已释放/实例已销毁/组件代次已终结；read-only = Live-only 边界
 * （reading 态或 hover 只读视图）；invalid-request = 请求形状非法 */
export type AddonSyntaxRejection = 'view-disposed' | 'read-only' | 'invalid-request'

/** 查询成功分支：kind + nodeNames 诊断载荷（光标处祖先链节点名快照，
 * 根→叶）。**非稳定**：节点名随解析器升级变化，不构成兼容承诺 */
export interface AddonSyntaxLineJudge {
  kind: AddonSyntaxLineKind
  nodeNames: readonly string[]
}

export interface AddonSyntaxInlineJudge {
  kind: AddonSyntaxInlineKind
  nodeNames: readonly string[]
}

export type AddonSyntaxLineTypeResult =
  | ({ ok: true } & AddonSyntaxLineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

export type AddonSyntaxInlineResult =
  | ({ ok: true } & AddonSyntaxInlineJudge)
  | { ok: false; reason: 'view-disposed' | 'read-only' | 'invalid-request' }

/** 查询面（experimental.syntax 的内容；仅编辑器页提供）。方法按 views
 * 面的实例 ID 寻址（对齐 headingFold/viewIdentity 先例），pos 为全文
 * UTF-16 code unit 偏移（页面全程 LF） */
export interface AddonSyntaxFacet {
  /** 光标处行类型（块级维度；见 AddonSyntaxLineKind） */
  lineTypeAt(instanceId: string, pos: number): AddonSyntaxLineTypeResult
  /** 位置级行内标记：code（行内代码）/ formula（行内或块内公式）/
   * none（普通文本） */
  inlineAt(instanceId: string, pos: number): AddonSyntaxInlineResult
}
```

**验证**：`test/unit/addonSyntaxApi.test.ts`、`test/unit/addonSyntaxSdk.test.ts`、`test/unit/addonRegistry.test.ts`

### `channel` 页面与宿主通道

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码、编辑器页、设置页 · **引入**：#351（T02）

**目标**：组件宿主代码与自身页面之间的 JSON 请求/结果传递：页面侧 sdk.channel.request，宿主侧 channel.handle 注册 topic 处理器。载荷与结果必须是可序列化数据——不能把 DOM、函数或编辑器实例传过桥。

语义要点：
- **生命周期**：topic 注册归所在的生命周期（setup 或 enable），停用即注销；同名 topic 重复注册拒绝。组件停用、故障或实例释放后，旧消息及异步完成不继续产生编辑写回或重新挂载。
- **错误与拒绝**：rejected = 宿主侧未注册 topic 或业务拒绝；timeout / released 由装载器本地终结（不依赖宿主存活）。

签名事实源：`src/shared/addonPage.ts`

```ts
/** 通道请求结果：普通拒绝与组件异常分开（装载器只报协议性结束态；
 *  rejected = 宿主侧未注册 topic 或业务拒绝；timeout/released 由装载器
 *  本地终结——不依赖宿主存活） */
export type AddonChannelOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: 'timeout' | 'released' | 'rejected' }
```

签名事实源：`src/host/addons/addonRegistry.ts`

```ts
/** 通道注册面（setup/enable 上下文同形状；同名 topic 重复注册拒绝） */
export interface AddonChannelRegistry {
  handle(topic: string, handler: AddonChannelHandler): AddonRegistrationHandle
}

/** 通道处理器（宿主组件代码注册；载荷与结果都是 JSON 数据） */
export type AddonChannelHandler = (payload: unknown) => unknown | Promise<unknown>
```

**验证**：`test/unit/addonPageLoader.test.ts`、`test/browser/addonPageSdk.mjs`

## 3. 输入行为

**能力范围**：可组合行为的注册、观察与顺序/开关持久

### `behaviors-register` 输入行为注册与观察

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#356（T07）

**目标**：注册可组合输入行为：稳定局部 ID + 必填名称 + 可选说明/例子/独占组 + 业务回调。onChanged 为只读观察（通知与修饰分别注册——不是原输入链的第二写入口）。

语义要点：
- **适用模式**：合法可编辑 Live 实例（内核先执行只读、IME 组合中间态、表格网格与既有情境门控；IME 组合定稿（composition commit）驱动一次——userEvent input.type.compose、inputText 为净定稿文本，#399；删除事务白名单 backward/forward/selection/cut/line 驱动（dedent 属缩进命令族不纳入），#400）。
- **坐标与数据形状**：修饰计划相对 context.snapshot（LF 坐标）；后续行为读取前序行为的修饰结果。上下文与观察事件携带 docUri（目标文档 URI，与 views 句柄 targetDocUri 同源：main = 面板文档，embed = 引用目标——在引用 B 内触发时是 B 的 URI，#407）与 replaced（事务替换/删除侧：键入替换选区 = 被替换内容（#401），delete = 被删文本（#400），事务前 LF 坐标，IME 定稿恒 null）。
- **生命周期**：行为能力与适用条件只由代码表达（不复制进清单）；每次修饰按自己的原子声明提交，提交与身份注入由平台完成（行为不能直接写文档）。
- **错误与拒绝**：注册拒绝：invalid-registration / duplicate-id / not-editor-page / released（名称缺失拒绝、说明/例子缺失允许）。
- **历史与撤回**：文本变化不终止链（默认可组合）；确需择一的用显式独占组（同组件命名空间内互斥，跨组件不互斥）——不恢复统一「先接管者生效」。

签名事实源：`src/shared/addonBehaviors.ts`

```ts
/** SDK behaviors 面（仅编辑器页提供；设置页为 undefined）。register 与
 *  onChanged 分开注册——onChanged 不是原输入链的第二写入口 */
export interface AddonBehaviorsFacet {
  /** 登记输入行为（稳定局部 ID + 必填名称 + 可选说明/例子/独占组/撤回
   *  声明 + 业务回调）；名称缺失拒绝，说明/例子缺失允许 */
  register(registration: AddonBehaviorRegistration): AddonBehaviorRegisterResult
  /** 观察用户输入（只读事件；不进入修饰链） */
  onChanged(callback: (event: AddonBehaviorChangeEvent) => void): () => void
}

/** behaviors.register 的注册载荷（作者提供） */
export interface AddonBehaviorRegistration {
  /** 稳定局部 ID（组件内唯一；持久身份的一半） */
  readonly id: string
  /** 必填的用户可读名称（ADR Q27：注册行为时名称必填） */
  readonly name: string
  /** 可选简短说明（推荐提供，不作接入强制条件） */
  readonly description?: string
  /** 可选例子（推荐提供；至多 8 项） */
  readonly examples?: readonly string[]
  /** 可选独占组：同组件内同组行为互斥（按有效序首个适用者生效）；
   *  跨组件不互斥 */
  readonly exclusiveGroup?: string
  /** 撤回边界声明（Q29）：缺省 atomic；joinPrevious = 随同上次原子操作
   *  撤回（每次修饰按自己的原子声明提交） */
  readonly history?: 'atomic' | 'joinPrevious'
  /** 业务回调：返回不处理（null）或文本修饰计划；适用条件由代码表达 */
  readonly onInput: (context: AddonInputContext) => AddonBehaviorInputPlan | null
}

/** 输入行为的操作上下文（技术方案 §5.2：当前快照 + 操作上下文） */
export interface AddonInputContext {
  /** 触发本次链的用户输入 userEvent（CM6 语义，如 'input.type'、
   *  'delete.backward'、'input.type.compose'——IME 定稿） */
  readonly userEvent: string
  /** 本次输入插入的净文本（多选区拼接；不含删除侧；delete 事务为空串） */
  readonly inputText: string
  /** 本次输入替换/删除掉的文本（事务前 LF 坐标）：input.type 替换选区时
   *  为被替换的选区内容（#401——SelectKey 包裹/替换类规则的判定依据：
   *  按键插入发生在选区销毁之后，行为从本字段读回包裹目标）；delete.*
   *  事务时为被删文本（#400——联动删除配对端需要知道删了什么）。多区间
   *  时为全部删除区间的最小包围与按序拼接文本。IME 定稿补驱动恒 null
   *  （组合事务先于 compositionend，替换侧无法归因——#399 边界）；
   *  纯插入无删除侧为 null */
  readonly replaced: AddonReplacedRange | null
  /** 行为读取时点的当前快照——已含本次输入与**前序行为的修饰结果**
   *  （后续行为读取前序结果）；输入点从快照选区读取 */
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与该实例 views 句柄的
   *  targetDocUri 同源：main = 面板文档，embed = 引用目标文档——在
   *  引用 B 内触发时是 B 的 URI，不是宿主文档 A；文件排除类规则据此
   *  判定「我正在哪个文件里被触发」） */
  readonly docUri: string
}

/** 事务替换/删除侧的区间与文本（事务前 LF 坐标） */
export interface AddonReplacedRange {
  /** 全部删除区间的最小包围起点 */
  readonly from: number
  /** 全部删除区间的最小包围终点 */
  readonly to: number
  /** 被替换/删除的文本（按区间顺序拼接） */
  readonly text: string
}

/** 文本修饰计划（行为返回；提交与身份注入由平台完成——行为不能直接
 *  写文档，防绕过链） */
export interface AddonBehaviorInputPlan {
  /** LF 坐标变更列表（相对 context.snapshot） */
  readonly changes: SerChange[]
  /** 提交后选区（可选；缺省保持实例现有选区重定位） */
  readonly selection?: AddonSelectionRange
}

/** onChanged 观察事件（通知分离面：只读观察，无修饰权——技术方案 §5.2
 *  「通知监听与输入修饰回调分别注册」） */
export interface AddonBehaviorChangeEvent {
  readonly userEvent: string
  readonly inputText: string
  /** 替换/删除侧（与 AddonInputContext.replaced 同义：#400/#401） */
  readonly replaced: AddonReplacedRange | null
  readonly snapshot: AddonEditorSnapshot
  /** 本次驱动所属视图的目标文档 URI（#407，与 AddonInputContext.docUri 同源） */
  readonly docUri: string
}

/** 注册结果（SDK behaviors.register 的返回） */
export type AddonBehaviorRegisterResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'invalid-registration' | 'duplicate-id' | 'not-editor-page' | 'released' }
```

**验证**：`test/unit/addonBehaviors.test.ts`、`test/unit/addonBehaviorRuntime.test.ts`、`test/integration/suite/addonT07Cases.ts`、`test/browser/addonT07Behaviors.mjs`

### `behavior-order-state` 行为顺序与逐项开关持久

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#357（T08）

**目标**：行为的持久身份 = 组件 ID + 局部 ID（不以显示名为存储键——改名/本地化不丢配置）；用户排序保留相对次序，新项按默认序（完整键字典序）追加，逐项关闭保留存储。

语义要点：
- **生命周期**：单层 user 持久（不做工作区层）；未知项（已卸载组件）保留存储、不剔除——展示状态而不重新打开用户已关闭的项；调序落库把不可见键锚定回原相对位。

签名事实源：`src/shared/addonBehaviors.ts`

```ts
/** 行为完整键（持久身份）：组件 ID + 局部 ID 以 # 连接 */
export function addonBehaviorFullKey(addonId: string, behaviorId: string): string {
  return `${addonId}#${behaviorId}`
}

/** 行为顺序与逐项开关的持久存储（version 1 冻结）。
 * 存储设计决策（票面要求写明）：
 * - 键 = 行为完整键（组件 ID + 局部 ID），不以显示名为键——改名/本地化
 *   不丢配置；未知项（已卸载）保留存储、不剔除（技术方案 §7：展示状态
 *   而不重新打开用户已关闭的项）。
 * - 单层 user（globalState）持久，不做工作区层——行为开关与顺序是用户
 *   偏好（ADR 未要求两层）；同文档跨窗口行为一致。T08 需要工作区层时
 *   再按 T04 两层模式扩展（version 迁移）。 */
export interface AddonBehaviorStateStore {
  readonly version: 1
  /** 用户排序覆盖（完整键；未列出项按默认序追加） */
  readonly order: readonly string[]
  /** 用户关闭的行为（完整键；不在场 = 开启） */
  readonly disabled: readonly string[]
}

/** 有效序计算（纯函数；webview 链驱动与宿主管理查询共用）：
 * 用户序中的已注册项（保相对次序）→ 未列入用户序的注册项（完整键字典
 * 序追加尾部）→ 剔除关闭项。null store = 无覆盖（全新默认态）。 */
export function resolveAddonBehaviorOrder(
  registeredKeys: readonly string[],
  store: AddonBehaviorStateStore | null,
): string[] {
  const disabled = store === null ? new Set<string>() : new Set(store.disabled)
  return orderedAddonBehaviorKeys(registeredKeys, store).filter((key) => !disabled.has(key))
}

/** T08（#357）展示全序：与 resolveAddonBehaviorOrder 同一口径，但**保留
 * 关闭项在原位**——行为冲突管理列表要呈现已关闭的行为（勾选态另呈，
 * 用户需要辨认与重新开启）；null store = 无覆盖（默认序全开启）。 */
export function orderedAddonBehaviorKeys(
  registeredKeys: readonly string[],
  store: AddonBehaviorStateStore | null,
): string[] {
  const registered = new Set(registeredKeys)
  const listed = store === null ? [] : store.order.filter((key) => registered.has(key))
  const listedSet = new Set(listed)
  const appended = registeredKeys.filter((key) => !listedSet.has(key)).sort()
  return [...listed, ...appended]
}

/** T08（#357）调序落库的未知项保留合并：管理 UI 只提交当前可见（已注册）
 * 行为的新序，本函数把存储中不可见的键（组件停用/无面板上报）按「锚定
 * 到原序列中前一个可见键之后」的规则并回新序——整组件停用期间的其他
 * 调序不丢该组件行为的位置配置，重新注册后回到锚定相对位（票面「整体
 * 停用与单项关闭互相区分、配置不丢」的存储面）。 */
export function mergeBehaviorOrderPreservingUnknown(
  nextOrder: readonly string[],
  previousOrder: readonly string[],
): string[] {
  const next = [...new Set(nextOrder)]
  const nextSet = new Set(next)
  // 不可见键按原序列锚点分组（null = 首个可见键之前）
  const anchored = new Map<string | null, string[]>([[null, []]])
  let anchor: string | null = null
  for (const key of previousOrder) {
    if (nextSet.has(key)) {
      anchor = key
      if (!anchored.has(anchor)) {
        anchored.set(anchor, [])
      }
    } else if (anchored.get(anchor)!.includes(key)) {
      continue // 历史重复只保留一次
    } else {
      anchored.get(anchor)!.push(key)
    }
  }
  const merged: string[] = [...anchored.get(null)!]
  for (const key of next) {
    merged.push(key)
    merged.push(...(anchored.get(key) ?? []))
  }
  return merged
}
```

**验证**：`test/unit/addonBehaviorStateService.test.ts`、`test/integration/suite/addonT08Cases.ts`、`test/browser/addonT08BehaviorsManage.mjs`

## 4. 设置

**能力范围**：定义注册、读写与来源、作用范围、自定义设置页

### `addon-storage` 组件数据目录与文件监听

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#404

**目标**：每组件一个安装目录外的隔离可写数据目录（globalStorage 语义）与目录内文件监听：富结构数据（规则对象等，超出设置存储一层嵌套边界）自由读写，外部同步工具改写文件后自动重载。宿主侧 setup/enable 上下文同形状；页面侧组件经自己的 channel topic 桥接宿主读写。

语义要点：
- **适用模式**：仅宿主端（编辑器/设置页面不直接提供——经组件通道桥接）。
- **坐标与数据形状**：相对路径为正斜杠形态，先过 isSafeAddonStoragePath 守卫（越界/非法一律 invalid-path 拒绝——普通 API 拒绝不算故障）；文件内容按 UTF-8 文本读写。
- **生命周期**：目录 = <vsidian globalStorage>/addons/<addonId>（按需创建）；停用/故障/组件扩展卸载不删数据（随 Vsidian 本体卸载整体清除，重装组件数据仍在）；watcher 惰性创建、多订阅共享，组件停用/故障/代次终结时平台统一注销；onDidChangeFile 回调回 (相对路径, change|delete)，change 含改写与新建。
- **错误与拒绝**：invalid-path（越界/非法相对路径）/ too-large（单文件超 ADDON_STORAGE_FILE_LIMIT_BYTES 8MB）/ error（IO 失败，detail 归因）——可辨认拒绝，不抛出。

签名事实源：`src/shared/addonStorage.ts`

```ts
/** 组件数据目录面（宿主侧 setup/enable 上下文同形状；组件页面侧经
 * channel 桥接宿主消费）。全部相对路径先过 isSafeAddonStoragePath，
 * 越界形态明确拒绝（普通 API 拒绝，不算组件故障）。 */
export interface AddonStorageFacet {
  /** 本组件数据目录的 URI（显示与同步工具配置用） */
  uri(): string
  /** 读 UTF-8 文本文件 */
  readFile(relativePath: string): Promise<AddonStorageResult<string>>
  /** 覆盖写 UTF-8 文本文件（父目录按需创建；content 超单文件上限拒绝） */
  writeFile(relativePath: string, content: string): Promise<AddonStorageResult<null>>
  /** 列目录（相对路径缺省根；recursive 缺省 false 只列一层） */
  list(relativePath?: string, recursive?: boolean): Promise<AddonStorageListResult>
  /** 删文件（不删目录——目录生命周期归卸载策略） */
  deleteFile(relativePath: string): Promise<AddonStorageResult<null>>
  /** 订阅目录内文件变化（外部同步工具改写/新建文件后自动重载的支撑面）；
   * 回调回相对路径与变化类型（change = 改写或新建，delete = 删除）；
   * 返回取消函数；组件停用/故障/代次终结时平台统一注销 watcher */
  onDidChangeFile(callback: (relativePath: string, kind: 'change' | 'delete') => void): AddonStorageWatchHandle
}

export type AddonStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export type AddonStorageListResult =
  | { ok: true; entries: AddonStorageEntryInfo[] }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export interface AddonStorageEntryInfo {
  /** 相对组件数据目录的路径（正斜杠） */
  path: string
  kind: 'file' | 'directory'
}

/** 拒绝码：invalid-path = 越界/非法相对路径；too-large = 单文件超限；
 * error = IO 失败（不存在/权限等，detail 归因） */
export type AddonStorageRejection = 'invalid-path' | 'too-large' | 'error'

/** 相对路径守卫：正斜杠相对路径，段非空且不为 `.`/`..`，无反斜杠、
 * 无盘符/协议头、长度有界。字面守卫是唯一防线：`%xx` 编码形态按字面
 * 目录名处理（Uri.file 不解码、`%2e%2e` 不构成 `..` 逃逸）；数据目录
 * 隔离是 API 卫生而非安全边界——组件本体是宿主侧扩展、本就握有完整
 * vscode.workspace.fs，无更高权限可越。 */
export function isSafeAddonStoragePath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.length > 512) {
    return false
  }
  if (relativePath.includes('\\') || relativePath.includes(':')) {
    return false
  }
  if (relativePath.startsWith('/') || relativePath.includes('//')) {
    return false
  }
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return false
    }
  }
  return true
}

/** 单文件大小上限（字节；writeFile 拒绝超限——防滥用，正常规则文件远小于此） */
export const ADDON_STORAGE_FILE_LIMIT_BYTES = 8 * 1024 * 1024
```

签名事实源：`src/host/addons/addonStorageService.ts`

```ts
/** 页面级服务：按 addonId 派生隔离的存储 facet；release 注销该组件 watcher */
export class AddonStorageService {
  private readonly watchers = new Map<string, WatcherState>()

  constructor(private readonly deps: AddonStorageServiceDeps) {}

  storageFor(addonId: string): AddonStorageFacet {
    const root = `${this.deps.baseDir}/${addonId}`
    const deps = this.deps
    const service = this
    return {
      uri: () => deps.uriOf(addonId),
      readFile: (relativePath) =>
        withGuard(relativePath, async () => ({
          ok: true as const,
          value: Buffer.from(await deps.fs.readFile(`${root}/${relativePath}`)).toString('utf8'),
        })),
      writeFile: (relativePath, content) =>
        withGuard(relativePath, async () => {
          if (Buffer.byteLength(content, 'utf8') > ADDON_STORAGE_FILE_LIMIT_BYTES) {
            return { ok: false as const, reason: 'too-large' as const }
          }
          await deps.fs.createDirectory(`${root}/${dirOf(relativePath)}`)
          await deps.fs.writeFile(`${root}/${relativePath}`, Buffer.from(content, 'utf8'))
          return { ok: true as const, value: null }
        }),
      list: (relativePath, recursive) =>
        listDirectory(deps, root, relativePath ?? '', recursive === true),
      deleteFile: (relativePath) =>
        withGuard(relativePath, async () => {
          await deps.fs.delete(`${root}/${relativePath}`)
          return { ok: true as const, value: null }
        }),
      onDidChangeFile: (callback) => service.subscribe(addonId, root, callback),
    }
  }

  private subscribe(
    addonId: string,
    root: string,
    callback: (relativePath: string, kind: 'change' | 'delete') => void,
  ): { dispose(): void } {
    let state = this.watchers.get(addonId)
    if (!state) {
      const subscribers = new Set<(relativePath: string, kind: 'change' | 'delete') => void>()
      const underlying = this.deps.createWatcher(root, (kind, relativePath) => {
        for (const subscriber of subscribers) {
          try {
            subscriber(relativePath, kind)
          } catch {
            // 订阅方异常不阻断其余订阅
          }
        }
      })
      state = { underlying, subscribers }
      this.watchers.set(addonId, state)
    }
    state.subscribers.add(callback)
    return {
      dispose: () => {
        const current = this.watchers.get(addonId)
        if (!current) return
        current.subscribers.delete(callback)
        if (current.subscribers.size === 0) {
          current.underlying.dispose()
          this.watchers.delete(addonId)
        }
      },
    }
  }

  /** 组件释放（停用/故障/代次终结）：注销该组件 watcher；文件数据保留 */
  release(addonId: string): void {
    this.watchers.get(addonId)?.underlying.dispose()
    this.watchers.delete(addonId)
  }
}

/** 文件系统端口（vscode 层实现 = vscode.workspace.fs；路径为正斜杠
 * 归一后的绝对文件系统路径；FileType 沿用 vscode 枚举数值——File=1、
 * Directory=2，与下方 FILE_TYPE 常量对齐） */
export interface AddonStorageFsPort {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, content: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  readDirectory(path: string): Promise<Array<[string, number]>>
  createDirectory(path: string): Promise<void>
}
```

**验证**：`test/unit/addonStorage.test.ts`

### `settings-context` 宿主设置能力面（setup 上下文）

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#351（T02 页面入口）、#353（T04 读写）

**目标**：setup 生命周期常驻的设置能力：registerPage 登记自己的设置页入口、registerDefinitions 收集可序列化定义、get / getSource 读生效值与来源、update 按批写入指定层、clearWorkspaceOverride 清除工作区覆盖、onChanged 订阅成功保存后的变化。

语义要点：
- **生命周期**：普通停用后保留（已停用组件仍可配置）；故障暂停时回收组件代码——平台保留已取得的定义与值，用基础控件供修正参数后手动重试。
- **错误与拒绝**：按批校验并保存，失败不虚报成功；变化事件只在持久化成功后发出。clearWorkspaceOverride 恢复继承用户默认，不是恢复出厂默认。

签名事实源：`src/host/addons/addonRegistry.ts`

```ts
/**
 * 设置能力面（setup 生命周期常驻——普通停用后保留；技术方案 5.5 形状）。
 * T02 先立 registerPage/registerDefinitions；T04 起接入读写与事件。
 */
export interface AddonSettingsContextApi {
  /** 设置页入口登记（自身安装目录内的相对路径；越界拒绝） */
  registerPage(entry: AddonPageEntryInput): AddonRegistrationHandle
  /** 设置定义收集（可序列化定义；形状校验矩阵见 shared/addonSettings） */
  registerDefinitions(defs: readonly unknown[]): AddonRegistrationHandle
  /** 生效值与来源快照（工作区显式 > 用户默认 > 出厂默认） */
  get(): AddonSettingsGetSnapshot
  /** 单键来源（未定义键为 undefined） */
  getSource(key: string): AddonSettingSource | undefined
  /** 按批校验并保存到指定层（失败不虚报；变化事件只在持久化成功后发出） */
  update(scope: 'user' | 'workspace', patch: Record<string, unknown>): Promise<AddonSettingsUpdateResult>
  /** 清除工作区对某键的覆盖（恢复继承用户默认，不是恢复出厂值） */
  clearWorkspaceOverride(key: string): Promise<AddonSettingsUpdateResult>
  /** 订阅成功保存后的变化（所属组件设置生命周期内有效） */
  onChanged(listener: (change: AddonSettingsChangeEventData) => void): AddonRegistrationHandle
}

/** 设置读取快照（settings.get() 的结果：生效值与来源） */
export interface AddonSettingsGetSnapshot {
  readonly values: Readonly<Record<string, AddonSettingValue>>
  readonly sources: Readonly<Record<string, AddonSettingSource>>
}

/** 设置变化事件（settings.onChanged 的载荷） */
export interface AddonSettingsChangeEventData {
  readonly scope: 'user' | 'workspace'
  readonly keys: readonly string[]
}
```

**验证**：`test/unit/addonRuntimeSettings.test.ts`、`test/integration/suite/addonT04Cases.ts`、`test/browser/addonSettings.mjs`

### `settings-definitions` 可序列化设置定义与值校验

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#353（T04）

**目标**：设置定义可序列化：标量（boolean/number/string）、数组（重复项）与对象（字段表）一层结构；有限数、长度、枚举约束由定义描述——不存在函数校验器形态。

语义要点：
- **错误与拒绝**：定义升级后存量漂移：显式值非法视为该层未设置（跳过继续下层，不从存储删除——定义回退后自动恢复生效）。数组/对象一层硬边界：项与字段必须是标量。

签名事实源：`src/shared/addonSettings.ts`

```ts
/** 组件设置定义（settings.registerDefinitions 的元素形状） */
export type AddonSettingDefinition =
  | (AddonSettingDefinitionBase & { type: 'boolean'; default: boolean })
  | (AddonSettingDefinitionBase & { type: 'number'; min?: number; max?: number; default: number })
  | (AddonSettingDefinitionBase & { type: 'string'; maxLength?: number; enum?: readonly string[]; default: string })
  | (AddonSettingDefinitionBase & {
    type: 'array'
    /** 重复项约束（一层：只描述标量） */
    items: AddonScalarItemSpec
    default: readonly AddonSettingScalarValue[]
    minItems?: number
    maxItems?: number
  })
  | (AddonSettingDefinitionBase & {
    type: 'object'
    /** 字段表（字段控件的数据源；字段键唯一） */
    fields: ReadonlyArray<AddonSettingDefinitionBase & AddonScalarItemSpec & { default: AddonSettingScalarValue }>
    /** 对象出厂值（缺省按字段 default 组装；显式给出时须逐字段合法且恰好覆盖字段集） */
    default?: Readonly<Record<string, AddonSettingScalarValue>>
  })

/** 组件设置值：标量 / 标量数组 / 字段为标量的对象（一层结构硬边界） */
export type AddonSettingValue =
  | AddonSettingScalarValue
  | readonly AddonSettingScalarValue[]
  | { readonly [field: string]: AddonSettingScalarValue }

/** 标量项约束（数组 items 与对象字段共用形状；无嵌套） */
export type AddonScalarItemSpec =
  | { kind: 'boolean' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'string'; maxLength?: number; enum?: readonly string[] }

/** 设置定义形状校验（必需字段与约束自洽；多余字段忽略——组件升级新增元数据不炸老平台） */
export function isAddonSettingDefinition(value: unknown): value is AddonSettingDefinition {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (!definitionBaseValid(value)) return false
  switch (value.type) {
    case 'boolean':
      return typeof value.default === 'boolean'
    case 'number':
      return isNumberSpec({ kind: 'number', min: value.min, max: value.max }) &&
        isFiniteNumber(value.default) &&
        addonScalarValueMatchesSpec(value.default, {
          kind: 'number',
          ...(value.min !== undefined ? { min: value.min as number } : {}),
          ...(value.max !== undefined ? { max: value.max as number } : {}),
        })
    case 'string':
      return isStringSpec({ kind: 'string', maxLength: value.maxLength, enum: value.enum }) &&
        typeof value.default === 'string' &&
        addonScalarValueMatchesSpec(value.default, {
          kind: 'string',
          ...(value.maxLength !== undefined ? { maxLength: value.maxLength as number } : {}),
          ...(value.enum !== undefined ? { enum: value.enum as readonly string[] } : {}),
        })
    case 'array': {
      if (!isAddonScalarItemSpec(value.items)) return false
      if (!Array.isArray(value.default)) return false
      if (value.minItems !== undefined && !isFiniteNumber(value.minItems)) return false
      if (value.maxItems !== undefined && !isFiniteNumber(value.maxItems)) return false
      if (value.minItems !== undefined && value.maxItems !== undefined && (value.minItems as number) > (value.maxItems as number)) {
        return false
      }
      const items = value.items as AddonScalarItemSpec
      if (value.minItems !== undefined && value.default.length < (value.minItems as number)) return false
      if (value.maxItems !== undefined && value.default.length > (value.maxItems as number)) return false
      return value.default.every((entry) => addonScalarValueMatchesSpec(entry, items))
    }
    case 'object': {
      if (!Array.isArray(value.fields) || value.fields.length === 0) return false
      const seenKeys = new Set<string>()
      for (const field of value.fields) {
        if (!isRecord(field)) return false
        // 先取 base 字段（isRecord 收窄下可访问），再做标量项形状判定
        const fieldKey = field.key as string
        const fieldDefault = field.default
        if (!definitionBaseValid(field)) return false
        if (!isAddonScalarItemSpec(field)) return false
        if (seenKeys.has(fieldKey)) return false
        seenKeys.add(fieldKey)
        if (!addonScalarValueMatchesSpec(fieldDefault, field as AddonScalarItemSpec)) return false
      }
      if (value.default === undefined) return true
      if (!isRecord(value.default)) return false
      const objectDefault = value.default as Record<string, unknown>
      const fieldKeys = new Set(value.fields.map((field) => (field as Record<string, unknown>).key as string))
      const defaultKeys = Object.keys(objectDefault)
      if (defaultKeys.length !== fieldKeys.size || !defaultKeys.every((key) => fieldKeys.has(key))) return false
      return value.fields.every((field) => {
        const record = field as Record<string, unknown>
        return addonScalarValueMatchesSpec(objectDefault[record.key as string], field as AddonScalarItemSpec)
      })
    }
    default:
      return false
  }
}

/** 值是否满足定义（数组/对象为一层结构：项与字段值必须是标量） */
export function addonSettingValueMatches(def: AddonSettingDefinition, value: unknown): boolean {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return addonScalarValueMatchesSpec(value, { kind: 'number', ...(def.min !== undefined ? { min: def.min } : {}), ...(def.max !== undefined ? { max: def.max } : {}) })
    case 'string':
      return addonScalarValueMatchesSpec(value, {
        kind: 'string',
        ...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
        ...(def.enum !== undefined ? { enum: def.enum } : {}),
      })
    case 'array': {
      if (!Array.isArray(value)) return false
      if (def.minItems !== undefined && value.length < def.minItems) return false
      if (def.maxItems !== undefined && value.length > def.maxItems) return false
      return value.every((entry) => addonScalarValueMatchesSpec(entry, def.items))
    }
    case 'object': {
      if (!isRecord(value)) return false
      const fieldKeys = new Set(def.fields.map((field) => field.key))
      const valueKeys = Object.keys(value)
      if (valueKeys.length !== fieldKeys.size || !valueKeys.every((key) => fieldKeys.has(key))) return false
      return def.fields.every((field) => addonScalarValueMatchesSpec(value[field.key], field))
    }
  }
}
```

**验证**：`test/unit/addonSettings.test.ts`

### `settings-scope` 作用范围解析与存储

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#353（T04）

**目标**：生效值解析：工作区显式 > 用户默认显式 > 出厂默认；两层存储同构（globalState / workspaceState），结构 version 1 冻结。

语义要点：
- **生命周期**：解析 fail-safe：version 未知或形态不符整层回 null（宁回默认值，不写回、不删除用户数据）；跨窗口不做实时推送，读取以新构造对账（1.82.3 Memento 无变更事件）。

签名事实源：`src/shared/addonSettings.ts`

```ts
/** 生效值来源（规格 5.4：区分出厂默认、用户默认与工作区覆盖） */
export type AddonSettingSource = 'default' | 'user' | 'workspace'

/**
 * 作用范围解析：工作区显式合法值 > 用户默认显式合法值 > 出厂默认。
 * 显式值非法（定义升级后存量漂移）视为该层未设置——跳过继续下层，
 * 不从存储删除（存储原值保留，定义回退后自动恢复生效）。
 */
export function resolveAddonSettingLayer(
  def: AddonSettingDefinition,
  userValue: unknown,
  workspaceValue: unknown,
): { value: AddonSettingValue; source: AddonSettingSource } {
  if (workspaceValue !== undefined && addonSettingValueMatches(def, workspaceValue)) {
    return { value: workspaceValue as AddonSettingValue, source: 'workspace' }
  }
  if (userValue !== undefined && addonSettingValueMatches(def, userValue)) {
    return { value: userValue as AddonSettingValue, source: 'user' }
  }
  return { value: addonSettingDefault(def), source: 'default' }
}

/** 持久层结构：两层同构（user = globalState / workspace = workspaceState） */
export interface AddonSettingsStoreV1 {
  readonly version: typeof ADDON_SETTINGS_STORE_VERSION
  readonly values: Readonly<Record<string, Readonly<Record<string, AddonSettingValue>>>>
}

/** 序列化整层存储（写入持久层的唯一形态） */
export function serializeAddonSettingsStore(values: Record<string, Record<string, AddonSettingValue>>): AddonSettingsStoreV1 {
  return { version: ADDON_SETTINGS_STORE_VERSION, values }
}

/**
 * 解析整层存储（fail-safe）：version 未知、形态不符或任何键的值形态非法
 * → 整层回 null（调用方按空层处理，不写回、不删除用户数据）。
 * version 1 为首个格式，无存量迁移；未来 v2 起在此按旧版逐级转换。
 */
export function parseAddonSettingsStore(raw: unknown): Record<string, Record<string, AddonSettingValue>> | null {
  if (!isRecord(raw) || raw.version !== ADDON_SETTINGS_STORE_VERSION || !isRecord(raw.values)) {
    return null
  }
  const values: Record<string, Record<string, AddonSettingValue>> = {}
  for (const [addonId, layer] of Object.entries(raw.values)) {
    if (!isRecord(layer)) return null
    const perAddon: Record<string, AddonSettingValue> = {}
    for (const [key, value] of Object.entries(layer)) {
      if (!isAddonSettingStoredValue(value)) return null
      perAddon[key] = value
    }
    values[addonId] = perAddon
  }
  return values
}
```

**验证**：`test/unit/addonSettings.test.ts`、`test/unit/addonSettingsService.test.ts`

## 5. 渲染提供者

**能力范围**：代码块渲染候选登记、确定性选择与自动接管

### `renderers-register` 渲染提供者注册

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#358（T09）

**目标**：为一个或多个代码块语言提供渲染候选（可替代内置，含 Mermaid）：可序列化声明上报宿主参与确定性选择，mount/refresh/release 回调留本页执行；可选登记图形导出（exportSvg——弹窗与导出链路共用）。

语义要点：
- **适用模式**：live / reading 非空子集；组件未支持的模式不会收到调用（模式资格筛选在挂载之前完成）。
- **生命周期**：生效表广播回来后才承担挂载（顺序由宿主决定，不靠脚本装载竞速）；接管切换、容器退场、停用或故障时 release（重复无害）；平台保证容器不跨生效代次复用——旧代次容器退场即与组件代码无关。
- **错误与拒绝**：声明非法或代次已终结时拒绝（返回 no-op 句柄，不构成组件故障）。

签名事实源：`src/shared/addonRenderers.ts`

```ts
/** SDK renderers 面（仅编辑器页提供）：登记提供者，返回释放句柄 */
export interface AddonRenderersFacet {
  /** 声明非法或代次已终结时拒绝（no-op 句柄；不构成组件故障） */
  register(spec: AddonRendererRegistration): { dispose(): void }
}

/**
 * 组件页面代码注册渲染提供者的完整形状（技术方案 5.3「renderers.register」
 * 的候选草案）。回调留在 webview 内执行——桥只把可序列化声明
 * （AddonRendererProviderInfo）上报宿主参与选择；宿主的生效表广播回来后
 * 才对挂载生效（顺序由宿主决定，不靠脚本装载竞速）。
 */
export interface AddonRendererRegistration extends AddonRendererProviderInfo {
  /** 容器内挂载（同步入口；异步装载由组件自行管理，结果只进本容器——
   *  平台保证容器不跨生效代次复用，旧代次容器退场即与组件代码无关） */
  mount(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 就地刷新（热切换重派发等；缺省走 release + mount） */
  refresh?(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 释放（接管切换、容器退场、停用或故障；重复释放无害） */
  release?(container: HTMLElement, ctx: AddonRendererMountContext): void
  /** 取导出 SVG 字符串（exportFormats 含 'svg' 时必须提供；弹窗与导出共用） */
  exportSvg?(code: string, language: string): Promise<string>
}

/** 组件页面代码注册的提供者声明（可序列化部分——上报宿主参与选择） */
export interface AddonRendererProviderInfo {
  /** 局部稳定 ID（非空；与组件 ID 组成持久提供者身份，不以显示名作存储键） */
  rendererId: string
  /** 用户可读名称（必填——对齐行为注册「名称必填」约定） */
  label: string
  /** 支持语言（trim 后 info 全等、大小写敏感——与 RENDERED_FENCE_LABELS 同口径） */
  languages: readonly string[]
  /** 支持模式（非空子集；未支持的模式不调用其入口） */
  modes: readonly AddonRendererMode[]
  /** 图形导出能力（弹窗/导出链路的降级依据） */
  exportFormats: readonly AddonRendererExportFormat[]
}

/** 渲染挂载上下文（mount/refresh/release 回调入参；页面端执行） */
export interface AddonRendererMountContext {
  language: string
  /** 目标视图模式（组件未支持的模式不会收到调用） */
  mode: AddonRendererMode
}

/** 宿主侧已知候选（声明 + 归属组件） */
export interface AddonRendererCandidate extends AddonRendererProviderInfo {
  addonId: string
  /** 稳定提供者 ID：`${addonId}/${rendererId}` */
  providerId: string
}
```

**验证**：`test/unit/addonRenderers.test.ts`、`test/unit/addonRenderersWeb.test.ts`、`test/integration/suite/addonT09Cases.ts`

### `renderer-selection` 确定性选择、自动接管与首选恢复

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：组件宿主代码 · **引入**：#358（T09）

**目标**：选择单位是提供者、挂载单位是某视图中的某个代码块。默认序按（发现批次升序, providerId 升序）取末位生效（内置视作批次 0）；用户显式首选优先且不可用时按默认序回退（首选记录不清除）。

语义要点：
- **自动规则**：新安装、兼容且已启用组件成功接入后自动替换所支持语言的现有显示（含内置）——不要求用户先选择渲染器；重启、重复注册与普通升级不当作新安装（批次一经记录不改写）。用户正常停用或整组件故障降级停用后内置接管（无图形内置则普通代码块，首选保留）；组件仍运行而渲染有 bug 时不自动接管、不承诺识别或修复；手动恢复成功后按原选择显示，旧异步结果不得重新挂载。

签名事实源：`src/shared/addonRenderers.ts`

```ts
/** 内置提供者稳定 ID（始终可用；对内置图形语言即 graphicRenderers 注册表） */
export const BUILTIN_RENDERER_PROVIDER_ID = 'builtin'

/** 选择输入（纯函数：候选、可用性谓词、内置语言、首选与批次） */
export interface RendererSelectionInput {
  candidates: readonly AddonRendererCandidate[]
  isAvailable: (candidate: AddonRendererCandidate) => boolean
  /** 内置图形语言（graphicRenderers 注册表键集） */
  builtinLanguages: readonly string[]
  preferred: Readonly<Record<string, string>>
  batches: Readonly<Record<string, number>>
}

/** 单语言选择结果（effective='none' = 无可用提供者且非内置语言 → 普通代码块） */
export interface AddonRendererLanguageSelection {
  language: string
  effective: string
  /** 生效来源：'user' = 用户显式首选且当前可用；'auto' = 确定性默认序 */
  source: 'user' | 'auto'
}

/**
 * 确定性生效提供者选择（纯函数；技术方案 5.3 默认序 + 用户首选）：
 * - 每语言候选 = 可用附加组件候选 + 内置（仅内置图形语言）；
 * - 默认序：按 (批次升序, providerId 升序) 排列取末位生效——内置批次视作
 *   0（新安装默认接管内置语言）、同批末位 = 稳定 ID 最大者、新批次覆盖旧；
 * - 用户首选优先：首选提供者当前可用（含显式选内置）即生效且 source='user'；
 *   不可用则按默认序回退（source='auto'），首选记录不在此清除（Q30 恢复）。
 */
export function selectEffectiveRenderers(input: RendererSelectionInput): { languages: AddonRendererLanguageSelection[] } {
  const languageSet = new Set<string>()
  for (const candidate of input.candidates) {
    for (const language of candidate.languages) {
      const normalized = normalizeRendererLanguage(language)
      if (normalized !== '') {
        languageSet.add(normalized)
      }
    }
  }
  for (const language of input.builtinLanguages) {
    languageSet.add(normalizeRendererLanguage(language))
  }
  const batchOf = (candidate: AddonRendererCandidate): number => input.batches[candidate.addonId] ?? 0
  const languages: AddonRendererLanguageSelection[] = []
  for (const language of [...languageSet].sort()) {
    const available = input.candidates.filter(
      (candidate) =>
        candidate.languages.some((l) => normalizeRendererLanguage(l) === language) && input.isAvailable(candidate),
    )
    const builtinAvailable = input.builtinLanguages.some((l) => normalizeRendererLanguage(l) === language)
    const preferred = input.preferred[language]
    if (preferred === BUILTIN_RENDERER_PROVIDER_ID && builtinAvailable) {
      languages.push({ language, effective: BUILTIN_RENDERER_PROVIDER_ID, source: 'user' })
      continue
    }
    const preferredCandidate = preferred === undefined ? undefined : available.find((c) => c.providerId === preferred)
    if (preferredCandidate) {
      languages.push({ language, effective: preferredCandidate.providerId, source: 'user' })
      continue
    }
    // 确定性默认序：内置视作批次 0、ID 'builtin'，与组件候选合并排序取末位
    const ordered = [...available].sort((a, b) => batchOf(a) - batchOf(b) || (a.providerId < b.providerId ? -1 : 1))
    const last = ordered[ordered.length - 1]
    if (last !== undefined && batchOf(last) > 0) {
      languages.push({ language, effective: last.providerId, source: 'auto' })
      continue
    }
    languages.push({
      language,
      effective: builtinAvailable ? BUILTIN_RENDERER_PROVIDER_ID : 'none',
      source: 'auto',
    })
  }
  return { languages }
}

/**
 * 发现批次分配（幂等）：未见过的 addonId 依次取 nextBatch 起的递增批次；
 * 已记录的不改写（重启、重复注册与普通升级不产生新批次——新安装语义只
 * 认 Vsidian 自己的记录，不声称拿到真实安装时间）。无变化时原引用返回。
 */
export function assignDiscoveryBatches(
  store: AddonRendererStoreV1,
  addonIds: readonly string[],
): { store: AddonRendererStoreV1; changed: boolean } {
  const missing = addonIds.filter((addonId) => !(addonId in store.batches))
  if (missing.length === 0) {
    return { store, changed: false }
  }
  let nextBatch = store.nextBatch
  const batches = { ...store.batches }
  for (const addonId of missing) {
    batches[addonId] = nextBatch
    nextBatch += 1
  }
  return {
    store: { version: store.version, batches, nextBatch, preferred: { ...store.preferred } },
    changed: true,
  }
}

/** 发现批次与用户首选的持久化形状（v1 冻结 fail-safe） */
export interface AddonRendererStoreV1 {
  version: 1
  /** 已记录组件的发现批次（addonId → 批次号；一经记录不改写——重启/重复
   *  注册/普通升级不重新分配，新安装语义据此识别） */
  batches: Record<string, number>
  /** 下一批次号（从 1 起单调递增） */
  nextBatch: number
  /** 用户按语言的显式首选（language → providerId，含 'builtin'）；
   *  内置接管不清除——恢复后按原选择显示 */
  preferred: Record<string, string>
}
```

**验证**：`test/unit/addonRendererTakeover.test.ts`、`test/unit/addonRendererService.test.ts`、`test/browser/addonRendererTakeover.mjs`

## 6. 命令/菜单/界面

**能力范围**：命令、菜单项、工具栏按钮与面板及统一快捷键

### `commands-register` 命令注册与统一快捷键

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#359（T10）

**目标**：新增自己的可绑定命令（title 自由文本，不进 Vsidian 内置字典）：进入统一快捷键管理（冲突检查/绑定/显式清空/恢复默认）与宿主命令面板；执行链三入口（快捷键路由、宿主命令面板、菜单项点击）共用组件回调。#427 起回调携带目标视图句柄（AddonViewHandle | null）——平台在执行时刻解析当前活动视图（焦点嵌入内部 Live → 该实例，否则主正文；无活动视图 null），组件无需自建焦点探针防御链。

语义要点：
- **适用模式**：live / reading / both 由代码声明；写操作快捷键仅在 Live 正文接管宿主绑定——源码模式与设置页输入不接管（沿键位注册表 writes 门控）。
- **生命周期**：命名空间 ID 由平台注入（<组件 ID>.<局部 ID>）；局部 ID 禁点号（含点即伪造跨组件/内置身份）。停用/故障/代次释放整组件回收注册——不影响内置命令，不清用户键位。
- **错误与拒绝**：duplicate-command、tab-forbidden（#125 Tab 固定链——「围栏越界 → 表格导航 → 行缩进」优先级不可绕；#427 收窄为裸 Tab 与 Shift+Tab 段，ctrl/alt/meta+Tab 放行——宿主/OS 占用组合不保证事件可达）、非法 chord 等明确拒绝码；普通 API 拒绝不算故障。

签名事实源：`src/shared/addonCommands.ts`

```ts
/** 组件命令注册形状（sdk.commands.register 的入参；页面 SDK 专用——
 *  回调不进协议，宿主/设置页只消费 AddonCommandReport） */
export interface AddonCommandDefinition {
  /** 组件内局部 ID（无点号；命名空间前缀由平台注入） */
  id: string
  /** 用户可见标题（自由文本——组件文案不进 Vsidian 内置字典，ADR 5.5；
   *  封顶 ADDON_DISPLAY_TEXT_MAX，超限注册拒绝——#395 P3） */
  title: string
  /** 生效模式（由代码声明） */
  mode: BindingMode
  /** 是否写操作（缺省 false：写操作快捷键仅在 Live 正文接管宿主绑定，
   *  源码模式与设置页输入不接管——沿键位注册表 writes 门控） */
  writes?: boolean
  /** 可选默认绑定（默认未绑定允许；Tab 拒绝——见模块头） */
  defaultBindings?: readonly string[]
}

/** 命令注册结果（SDK 注册面返回；拒绝原因可辨认——普通 API 拒绝不算故障） */
export type AddonCommandRegisterResult =
  | { ok: true; commandId: string }
  | { ok: false; reason: string }

/** 协议上报的命令形态（webview → 宿主全量对账；序列化安全——无函数） */
export interface AddonCommandReport {
  /** 命名空间完整 ID（键位路由、菜单提示与宿主命令注册共用） */
  commandId: string
  addonId: string
  localId: string
  title: string
  mode: BindingMode
  writes: boolean
  /** 归一化后的默认绑定（注册期已拒 Tab 与非法 chord；空数组 = 默认未绑定） */
  defaults: readonly string[]
}

/** 局部 ID 拒绝码 */
export type AddonLocalIdProblem = 'empty' | 'dot' | 'too-long' | 'invalid-chars'

/** 默认绑定拒绝码（tab-forbidden = #125 Tab 固定链） */
export type AddonDefaultBindingsProblem = 'not-string' | 'invalid-chord' | 'tab-forbidden'
```

签名事实源：`src/shared/addonPage.ts`

```ts
/** T10（#359）SDK 命令面（仅编辑器页）：注册自己的可绑定命令——操作进入
 *  统一快捷键管理（冲突检查/绑定/清空/恢复），命令面板经宿主命令可达。
 *  命名空间由平台注入（`<addonId>.<localId>`）；同名注册与非法形状明确
 *  拒绝（普通 API 拒绝，不算故障）。
 *  #427 起回调携带目标视图句柄：执行时刻由平台解析当前活动视图（焦点
 *  嵌入内部 Live → 该实例，否则主正文；无活动视图 null）——组件无需
 *  自建焦点探针防御链。 */
export interface AddonSdkCommandsFacet {
  register(def: AddonCommandDefinition, handler: (target: AddonViewHandle | null) => void): AddonCommandRegisterResult & { dispose(): void }
}
```

**验证**：`test/unit/addonCommands.test.ts`、`test/unit/addonCommandService.test.ts`、`test/integration/suite/addonT10Cases.ts`、`test/browser/addonT10Commands.mjs`

### `menus-register` 菜单项注册

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#359（T10）

**目标**：向统一右键菜单新增自己的菜单项：组件簇（addon.<组件 ID>）追加在内置三簇之后；label 自由文本，iconKey 须已在平台图标 key 表登记（组件不能注入新图标资产）。

语义要点：
- **适用模式**：when / enable 谓词输入为打开菜单时采集的结构化快照（MenuContextSnapshot）；结构敏感区置灰的安全降级矩阵由组件自行声明。
- **错误与拒绝**：label 空、icon-key 未登记、command 局部 ID 非法等明确拒绝。不提供覆写/隐藏/接管内置菜单项的任何入口（ADR-0012 菜单边界；结构性免疫：局部 ID 禁点号，传入的 id 不可能成为内置或另一组件的身份）。

签名事实源：`src/shared/addonCommands.ts`

```ts
/** 组件菜单项注册形状（sdk.menus.registerItem 的入参） */
export interface AddonMenuItemDefinition {
  /** 组件内局部 ID（无点号） */
  id: string
  /** 菜单项文字（自由文本） */
  label: string
  /** 图标 key（须已在 CONTEXT_MENU_ICON_KEYS 登记——组件不能注入新图标
   *  资产；未登记 key 注册拒绝，与内置项「两表同步」约束同口径） */
  iconKey?: string
  /** 簇内排序键（缺省 0，稳定排序） */
  order?: number
  /** 挂接的命令局部 ID（缺省 = id；命名空间化后作菜单执行键） */
  command?: string
  /** 上下文显隐谓词（缺省可见；输入为打开菜单时采集的结构化快照） */
  when?: MenuPredicate
  /** 置灰谓词（缺省可用；结构敏感区置灰的安全降级矩阵由组件自行声明） */
  enable?: MenuPredicate
}

/** 菜单项形状校验：返回拒绝码；null = 通过 */
export function addonMenuItemProblem(def: AddonMenuItemDefinition): AddonMenuItemProblem | null {
  const idProblem = addonLocalIdProblem(def.id)
  if (idProblem !== null) {
    return idProblem
  }
  if (typeof def.label !== 'string' || def.label.length === 0) {
    return 'label-empty'
  }
  if (def.label.length > ADDON_DISPLAY_TEXT_MAX) {
    return 'label-too-long'
  }
  if (def.iconKey !== undefined && !(CONTEXT_MENU_ICON_KEYS as readonly string[]).includes(def.iconKey)) {
    return 'icon-key'
  }
  if (def.command !== undefined && addonLocalIdProblem(def.command) !== null) {
    return 'command-local-id'
  }
  return null
}
```

签名事实源：`src/shared/addonPage.ts`

```ts
/** T10（#359）SDK 菜单面（仅编辑器页）：新增自己的右键菜单项——组件簇
 *  （addon.<组件 ID>）追加在内置三簇之后；label 自由文本、iconKey 须在
 *  平台图标 key 表。不提供覆写/隐藏/接管内置菜单项的任何入口（ADR-0012
 *  菜单边界）。 */
export interface AddonSdkMenusFacet {
  registerItem(def: AddonMenuItemDefinition): {
    ok: boolean
    reason?: string
    /** 命名空间菜单项 ID（ok 时给出） */
    id?: string
    dispose(): void
  }
}
```

**验证**：`test/unit/addonCommands.test.ts`、`test/integration/suite/addonT10Cases.ts`、`test/browser/addonT10Commands.mjs`

### `ui-buttons-panels` 工具栏按钮与面板

**分层**：稳定候选（随 1.0.0 候选冻结，未发行） · **执行端**：编辑器页 · **引入**：#360（T11）

**目标**：往平台预定义挂载点新增自己的界面元素：按钮唯一合法槽是工具栏左组尾部容器，面板唯一宿主是主编辑区尾部 dock（面板 chrome 与 dock 样式归平台，内容根内部样式归组件）。按钮动作二选一：挂接已注册命令（点击经命令体系执行、键位徽章取生效绑定）或自带回调。

语义要点：
- **适用模式**：缺省 both；不匹配模式的按钮撤下（注册保留、切回重挂），不符面板强制关闭（不自动复活）。
- **生命周期**：面板关闭（用户或组件 close）即容器移除、内容根脱挂——迟到结果结构上不可见；mount 异常回收并移除注册（不留半装配）；onClick/unmount 异常吞掉留痕（运行期回调异常不升级为全组件故障）；停用/故障/代次释放整组件回收。
- **错误与拒绝**：duplicate-button / duplicate-panel、slot-unknown（槽位白名单外——内置界面/侧栏/设置框架不可挂）、action-conflict / action-missing（动作二选一）、局部 ID 含点等明确拒绝。
- **自动规则**：onClick 与面板 target 由平台注入当前活动视图句柄（焦点所在嵌入内部 Live → B，否则主正文 A——T06 句柄语义，操作归当前目标文档）。

签名事实源：`src/shared/addonUi.ts`

```ts
/** 按钮槽位白名单：当前唯一合法挂载点（其余值注册拒绝——内置界面/侧栏/
 *  设置框架等不可挂；未来新槽位在此登记并同步 styleContract 条目） */
export const ADDON_UI_BUTTON_SLOTS = ['toolbar'] as const

/** 组件按钮注册形状（sdk.ui.registerButton 的入参） */
export interface AddonUiButtonDefinition {
  /** 组件内局部 ID（无点号；命名空间前缀由平台注入） */
  id: string
  /** 用户可见标题（自由文本——aria/提示承载；组件文案不进 Vsidian 内置字典；
   *  封顶 ADDON_DISPLAY_TEXT_MAX，超限注册拒绝——#395 P3） */
  label: string
  /** 挂载槽位（缺省 toolbar；白名单见 ADDON_UI_BUTTON_SLOTS） */
  slot?: AddonUiButtonSlot
  /** 生效模式（缺省 both；不匹配模式的按钮从挂载点撤下） */
  mode?: BindingMode
  /** 槽内排序键（缺省 0，稳定排序） */
  order?: number
  /** 挂接的命令局部 ID（点击经命令体系执行——须为本组件已注册命令） */
  command?: string
  /** 按钮显示文本（缺省 label；单字符/emoji/短词皆可；封顶同 label） */
  iconText?: string
}

/** 组件面板注册形状（sdk.ui.registerPanel 的入参；面板宿主容器是平台
 *  dock——定义形状上无挂载位置字段，界面接管在结构上不可表达） */
export interface AddonUiPanelDefinition {
  /** 组件内局部 ID（无点号） */
  id: string
  /** 面板标题（自由文本——平台面板标题栏展示；封顶 ADDON_DISPLAY_TEXT_MAX，
   *  超限注册拒绝——#395 P3） */
  title: string
  /** 生效模式（缺省 both；不匹配模式的面板强制关闭并回收挂载） */
  mode?: BindingMode
  /** 面板打开时调用（平台提供内容根元素；迟到结果落进已关闭面板的 root
   *  不可见——root 已脱挂） */
  mount(root: unknown, target: AddonUiTargetGetter): void
  /** 面板关闭时调用（可选；重复释放无害） */
  unmount?(root: unknown): void
}

/** 目标句柄获取器（按钮回调与面板 mount 收到）：每次调用动态解析**当前
 *  活动视图**（焦点所在的嵌入内部 Live 或主正文——T06 句柄语义：在引用
 *  B 中操作归 B 不误改父 A）；视图不在场（面板销毁/阅读态只读时）null */
export type AddonUiTargetGetter = () => AddonViewHandle | null
```

签名事实源：`src/shared/addonPage.ts`

```ts
/** T11（#360）SDK 界面面（仅编辑器页）：往**平台预定义挂载点**新增自己
 *  的工具栏按钮与面板——不把内核容器、内置界面、菜单或设置框架交给作者
 *  接管（按钮槽位白名单、面板 dock 唯一宿主）。按钮动作二选一：挂接 T10
 *  已注册命令或自带回调（携当前活动视图句柄——T06 语义，在引用 B 中操作
 *  归 B 不误改父 A）；面板 mount/unmount 管内容根生命周期。随所属视图
 *  模式切换与组件退出完整回收（停用/故障/代次释放本页闭环）。 */
export interface AddonSdkUiFacet {
  /** 注册工具栏按钮（slot 缺省 toolbar——白名单外值拒绝） */
  registerButton(
    def: AddonUiButtonDefinition,
    onClick?: (target: AddonViewHandle | null) => void,
  ): {
    ok: boolean
    reason?: string
    /** 命名空间按钮 ID（ok 时给出） */
    id?: string
    dispose(): void
  }
  /** 注册面板（默认关闭；返回句柄含开闭控制——dispose 后全部拒绝） */
  registerPanel(def: AddonUiPanelDefinition): {
    ok: boolean
    reason?: string
    /** 命名空间面板 ID（ok 时给出） */
    id?: string
    dispose(): void
    open(): boolean
    close(): boolean
    isOpen(): boolean
  }
}
```

**验证**：`test/unit/addonUi.test.ts`、`test/unit/addonUiRuntime.test.ts`、`test/integration/suite/addonT11Cases.ts`、`test/browser/addonT11Ui.mjs`


---

由 src/shared/addonApiCatalog.ts 与各事实源声明生成（scripts/genAddonApiRef.mjs）；产物一致性由 test/unit/addonApiRefGen.test.ts 钉住。

