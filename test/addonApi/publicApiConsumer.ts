// #362 T13 附加组件公开声明的编译期消费者（消费编译验证）。
//
// 职责（票面验收：「六组已实现接口有公开声明……消费编译不导入内部
// 控制器」）：本文件只从公开事实源模块导入声明并做类型级钉住断言——
// 删除公开成员、收窄枚举或改 facet 形状会让 `npm run compile` 失败。
// 纪律由 test/unit/addonApiSurface.test.ts 钉住：
// - 导入模块白名单 = src/shared 的 addon 公开模块 + 宿主导出面
//   （addonWiring / addonRegistry，仅 type-only——它们 import vscode，
//   值导入会引入内部装配依赖）；
// - 禁止导入 src/webview、src/host 其余模块（内部控制器不作 SDK）。
//
// 本文件不是运行时测试（vitest 不收集；无 .test 后缀）——它是「三类公开
// 消费样例可编译」的最小常驻形态，与 test/fixtures/addon-v02/ 的行为样例
// 互补：这里钉签名形状，夹具钉行为。
import {
  ADDON_API_VERSION,
  ADDON_IDENTITY_MANIFEST_VERSION,
  ADDON_MANIFEST_FIELD,
  type AddonDeclarationParseResult,
  type AddonIdentityDeclaration,
  type AddonRegisterRejection,
  type AddonStatusKind,
} from '../../src/shared/addonIdentity'
import type { AddonApiEntry, AddonApiGroup, AddonApiReleaseRecord } from '../../src/shared/addonApiCatalog'
import type {
  AddonChannelOutcome,
  AddonLoadFailureReason,
  AddonPageFactory,
  AddonPageKind,
  VsidianAddonPageSdk,
} from '../../src/shared/addonPage'
import type {
  AddonApplyEditsRequest,
  AddonApplyEditsResult,
  AddonEditCredential,
  AddonEditHistory,
  AddonEditRejection,
  AddonEditorSnapshot,
  AddonSelectionRange,
  AddonViewHandle,
  AddonViewInfo,
  AddonViewType,
  AddonViewsFacet,
} from '../../src/shared/addonEditApi'
import type {
  AddonBehaviorChangeEvent,
  AddonBehaviorRegistration,
  AddonBehaviorsFacet,
  AddonBehaviorRegisterResult,
} from '../../src/shared/addonBehaviors'
import type {
  AddonSettingDefinition,
  AddonSettingSource,
  AddonSettingValue,
} from '../../src/shared/addonSettings'
import type {
  AddonRendererRegistration,
  AddonRenderersFacet,
} from '../../src/shared/addonRenderers'
import type {
  AddonCommandDefinition,
  AddonMenuItemDefinition,
} from '../../src/shared/addonCommands'
import type {
  AddonUiButtonDefinition,
  AddonUiPanelDefinition,
} from '../../src/shared/addonUi'
import type {
  AddonDefinition,
  AddonEnableContext,
  AddonSettingsContextApi,
  AddonSetupContext,
} from '../../src/host/addons/addonRegistry'
import type { VsidianAddonExports } from '../../src/host/addons/addonWiring'

/** 双向可赋值 = 类型相等（钉 union 成员集：多一个、少一个成员都失败） */
type Equals<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false

/** 从结果 union 提取失败分支的 reason 成员（naked 泛型参数触发分配：逐
 *  成员匹配 { ok: false } 分支，成功分支归 never） */
type FailureReason<T> = T extends { ok: false; reason: infer R } ? R : never

// ---- 值消费（shared 公开常量可被组件作者导入） ----

/** 宿主当前候选稳定 API 版本（「1.0.0」——候选，未发布） */
export const consumedApiVersion: string = ADDON_API_VERSION
/** 私有身份声明字段名（「vsidianAddon」） */
export const consumedManifestField: string = ADDON_MANIFEST_FIELD
/** 身份声明格式版本（1，与 API 版本分开） */
export const consumedManifestVersion: number = ADDON_IDENTITY_MANIFEST_VERSION

// ---- 枚举钉住（可辨认拒绝/状态是接口冻结面：新增或删除成员都是契约变更） ----

/** T06 八种可辨认编辑拒绝 */
export type PinnedEditRejections =
  | 'view-disposed'
  | 'read-only'
  | 'suspended'
  | 'stale-snapshot'
  | 'history-boundary'
  | 'conflict'
  | 'error'
  | 'invalid-request'
export const editRejectionsPinned: Equals<AddonEditRejection, PinnedEditRejections> = true

/** T01 四种注册拒绝 */
export type PinnedRegisterRejections =
  | 'not-addon-extension'
  | 'extension-not-in-host'
  | 'incompatible-api'
  | 'already-registered'
export const registerRejectionsPinned: Equals<AddonRegisterRejection, PinnedRegisterRejections> = true

/** 七种组件状态（设置页呈现面） */
export type PinnedStatusKinds =
  | 'registered'
  | 'activating'
  | 'awaiting-registration'
  | 'incompatible'
  | 'activation-failed'
  | 'host-unavailable'
  | 'invalid-declaration'
export const statusKindsPinned: Equals<AddonStatusKind, PinnedStatusKinds> = true

/** 页面文本坐标与撤回边界声明（LF/UTF-16；atomic|joinPrevious） */
export const viewTypesPinned: Equals<AddonViewType, 'main' | 'embed' | 'hover'> = true
export const editHistoryPinned: Equals<AddonEditHistory, 'atomic' | 'joinPrevious'> = true
export const settingSourcesPinned: Equals<AddonSettingSource, 'default' | 'user' | 'workspace'> = true

/** 通道结束态（timeout/released 本地终结；rejected 宿主侧拒绝） */
export type PinnedChannelReasons = 'timeout' | 'released' | 'rejected'
export const channelOutcomePinned: Equals<FailureReason<AddonChannelOutcome>, PinnedChannelReasons> = true

/** T07 行为注册拒绝码 */
export type PinnedBehaviorReasons = 'invalid-registration' | 'duplicate-id' | 'not-editor-page' | 'released'
export const behaviorReasonsPinned: Equals<FailureReason<AddonBehaviorRegisterResult>, PinnedBehaviorReasons> = true

/** T02 五种装载失败原因 */
export type PinnedLoadFailureReasons =
  | 'already-loaded'
  | 'script-load-failed'
  | 'identity-mismatch'
  | 'no-factory-registered'
  | 'factory-error'
export const loadFailureReasonsPinned: Equals<AddonLoadFailureReason, PinnedLoadFailureReasons> = true

// ---- facet 形状钉住（Pick 键不存在即编译失败——删除/改名公开成员被发现） ----

/** 页面 SDK 十三个公开面（六个能力 facet + 装配/资源/通信/释放） */
export type SdkSurface = Pick<
  VsidianAddonPageSdk,
  | 'addon'
  | 'experimental'
  | 'views'
  | 'behaviors'
  | 'commands'
  | 'menus'
  | 'renderers'
  | 'ui'
  | 'registerExtension'
  | 'mountRoot'
  | 'resourceUri'
  | 'channel'
  | 'onDispose'
>

/** views 面（枚举/获取/创建/销毁订阅） */
export type ViewsSurface = Pick<AddonViewsFacet, 'list' | 'get' | 'onCreated' | 'onDisposed'>
/** behaviors 面（注册与只读观察分开） */
export type BehaviorsSurface = Pick<AddonBehaviorsFacet, 'register' | 'onChanged'>
/** renderers 面 */
export type RenderersSurface = Pick<AddonRenderersFacet, 'register'>
/** 宿主导出 API */
export type ExportsSurface = Pick<VsidianAddonExports, 'apiVersion' | 'registerAddon'>
/** 注册定义两段生命周期 */
export type DefinitionSurface = Pick<AddonDefinition, 'setup' | 'enable'>
/** setup 上下文的设置能力面 */
export type SettingsContextSurface = Pick<
  AddonSettingsContextApi,
  'registerPage' | 'registerDefinitions' | 'get' | 'getSource' | 'update' | 'clearWorkspaceOverride' | 'onChanged'
>

// ---- 组合消费（公开形状可以组装出一次完整接入——证明声明互相咬合） ----

/** 一次编辑提交的可组装链路：句柄 → 快照 → 请求 → 结果/凭据 */
export type EditFlowShapes = {
  handle: AddonViewHandle
  info: AddonViewInfo
  snapshot: AddonEditorSnapshot
  selection: AddonSelectionRange
  request: AddonApplyEditsRequest
  result: AddonApplyEditsResult
  credential: AddonEditCredential
}

/** 页面工厂形态（构建桥 defineAddonPage 的第二参数） */
export type PageFactoryShape = AddonPageFactory
export type PageKinds = AddonPageKind

/** 行为注册到事件的组合 */
export type BehaviorShapes = {
  registration: AddonBehaviorRegistration
  changeEvent: AddonBehaviorChangeEvent
}

/** 设置定义到值的组合 */
export type SettingShapes = {
  definition: AddonSettingDefinition
  value: AddonSettingValue
}

/** 渲染与界面注册形状 */
export type RendererShapes = { registration: AddonRendererRegistration }
export type CommandShapes = { definition: AddonCommandDefinition; menuItem: AddonMenuItemDefinition }
export type UiShapes = { button: AddonUiButtonDefinition; panel: AddonUiPanelDefinition }

/** 宿主上下文组合 */
export type HostContextShapes = {
  setup: AddonSetupContext
  enable: AddonEnableContext
}

/** 语义清单与台账的公开数据形状（生成器消费的同一份） */
export type CatalogShapes = {
  group: AddonApiGroup
  entry: AddonApiEntry
  release: AddonApiReleaseRecord
}

// ---- 声明解析结果可辨形状（发现面） ----
export type DeclarationParseShapes = AddonIdentityDeclaration | AddonDeclarationParseResult
