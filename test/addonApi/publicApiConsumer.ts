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
  AddonCm6Runtime,
  AddonLoadFailureReason,
  AddonPageFactory,
  AddonPageKind,
  AddonSdkCommandsFacet,
  GraphicMenuHit,
  LinkMenuHit,
  MenuContextSnapshot,
  MenuLinkKind,
  TableMenuHit,
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
  AddonViewIdentityFacet,
  AddonViewInfo,
  AddonViewType,
  AddonViewsFacet,
} from '../../src/shared/addonEditApi'
import type {
  AddonHeadingFoldApplyOptions,
  AddonHeadingFoldCommandResult,
  AddonHeadingFoldFacet,
  AddonHeadingFoldOperation,
  AddonHeadingFoldQueryResult,
  AddonHeadingFoldRejection,
  AddonHeadingFoldSpan,
} from '../../src/shared/addonFoldApi'
import type {
  AddonSyntaxFacet,
  AddonSyntaxInlineKind,
  AddonSyntaxInlineResult,
  AddonSyntaxLineKind,
  AddonSyntaxLineTypeResult,
  AddonSyntaxRejection,
} from '../../src/shared/addonSyntaxApi'
import {
  ADDON_HOST_SETTING_KEYS,
  type AddonHostSettingGetResult,
  type AddonHostSettingsFacet,
  type AddonHostSettingKey,
  type AddonHostSettingsRejection,
  type AddonHostSettingValue,
} from '../../src/shared/addonHostSettingsApi'
import {
  resolveAddonBehaviorName,
  type AddonBehaviorChangeEvent,
  type AddonBehaviorEnabledState,
  type AddonBehaviorName,
  type AddonBehaviorRegistration,
  type AddonBehaviorsFacet,
  type AddonBehaviorRegisterResult,
  type AddonBehaviorRunState,
  type AddonBehaviorStateFacet,
} from '../../src/shared/addonBehaviors'
import type {
  AddonLocalizedText,
  AddonSettingDefinition,
  AddonSettingGroup,
  AddonSettingSearchEntry,
  AddonSettingSource,
  AddonSettingValue,
} from '../../src/shared/addonSettings'
import type { AddonStorageFacet, AddonStorageRejection } from '../../src/shared/addonStorage'
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

/** 页面 SDK 十四个公开面（六个能力 facet + 装配/资源/通信/释放；#476 起
 *  含 behaviorState 只读面） */
export type SdkSurface = Pick<
  VsidianAddonPageSdk,
  | 'addon'
  | 'experimental'
  | 'views'
  | 'behaviors'
  | 'behaviorState'
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
/** 实验入口 cm6 运行时（state/view 整命名空间 + #406 language 语法树子集） */
export type Cm6RuntimeSurface = Pick<AddonCm6Runtime, 'state' | 'view' | 'language'>
export type Cm6LanguageSurface = Pick<
  AddonCm6Runtime['language'],
  'syntaxTree' | 'ensureSyntaxTree' | 'syntaxTreeAvailable'
>
/** behaviors 面（注册与只读观察分开） */
export type BehaviorsSurface = Pick<AddonBehaviorsFacet, 'register' | 'onChanged'>
/** #476 行为禁用态只读面（查询 + 订阅双件——无写入成员） */
export type BehaviorStateSurface = Pick<AddonBehaviorStateFacet, 'enabledState' | 'onEnabledChange'>
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

/** 菜单谓词输入的场景命中负载消费（#436：快照三类可选负载组成类型互相
 *  咬合——字段收回/形状收窄使 compile 失败，即钉住） */
export type MenuScenePayloadShapes = {
  snapshot: MenuContextSnapshot
  table: TableMenuHit
  link: LinkMenuHit
  graphic: GraphicMenuHit
  linkKinds: MenuLinkKind
  /** 负载是快照可选字段（zone 限定在场，缺省合法） */
  payloadFields: Pick<MenuContextSnapshot, 'table' | 'link' | 'graphic'>
}

/** 行为注册到事件的组合 */
export type BehaviorShapes = {
  registration: AddonBehaviorRegistration
  changeEvent: AddonBehaviorChangeEvent
}

/** #476 行为禁用态：运行态 union 钉住（接口冻结面——扩态是契约变更）；
 *  快照形状与订阅回调参数同源（消费组合证明声明互相咬合） */
export type PinnedBehaviorRunStates = 'enabled' | 'user-disabled'
export const behaviorRunStatesPinned: Equals<AddonBehaviorRunState, PinnedBehaviorRunStates> = true
export type BehaviorEnabledStateShapes = {
  snapshot: AddonBehaviorEnabledState
  changeCallbackParam: Parameters<Parameters<AddonBehaviorStateFacet['onEnabledChange']>[0]>[0]
  unsubscribeReturn: ReturnType<AddonBehaviorStateFacet['onEnabledChange']>
}

/** #464 多语言行为名：union 形状钉住（string | 语言键映射）——收窄或
 *  放宽（如 any）都编译失败 */
export const behaviorNamePinned: Equals<
  AddonBehaviorName,
  string | { readonly [locale: string]: string }
> = true
/** 注册样例：多语言映射形态（推荐键形小写 BCP47 连字符，如 zh-cn/en） */
export const multilanguageBehaviorName: AddonBehaviorName = { en: 'Auto pairs', 'zh-cn': '括号补全' }
/** 选值函数可被组件作者值导入消费（渲染/上报前按页面语言求显示文本） */
export const resolvedBehaviorNameInZh: string = resolveAddonBehaviorName(multilanguageBehaviorName, 'zh-cn')
export const resolvedBehaviorNameInEn: string = resolveAddonBehaviorName(multilanguageBehaviorName, 'en')

/** #410 标题折叠实验入口：三种拒绝码与五操作字面量（接口冻结面） */
export type PinnedHeadingFoldRejections = 'view-disposed' | 'read-only' | 'invalid-request'
export const headingFoldRejectionsPinned: Equals<AddonHeadingFoldRejection, PinnedHeadingFoldRejections> = true
export type PinnedHeadingFoldOperations = 'fold' | 'unfold' | 'toggle' | 'foldAll' | 'unfoldAll'
export const headingFoldOperationsPinned: Equals<AddonHeadingFoldOperation, PinnedHeadingFoldOperations> = true

/** #410 折叠面（查询二入口 + 命令三入口）与结果形状 */
export type HeadingFoldSurface = Pick<
  AddonHeadingFoldFacet,
  'folds' | 'foldable' | 'apply' | 'foldAt' | 'unfoldAt'
>
export type HeadingFoldShapes = {
  span: AddonHeadingFoldSpan
  applyOptions: AddonHeadingFoldApplyOptions
  queryResult: AddonHeadingFoldQueryResult
  commandResult: AddonHeadingFoldCommandResult
}

/** #426 视图身份反查面（experimental.viewIdentity 的内容） */
export type ViewIdentitySurface = Pick<AddonViewIdentityFacet, 'instanceIdOf'>
/** 反查输入是共享 CM6 运行时的 EditorView（组件 keymap/扩展回调的 view） */
export type ViewIdentityParam = Parameters<AddonViewIdentityFacet['instanceIdOf']>[0]

/** #433 行类型与行内标记查询面：枚举与拒绝码钉住（接口冻结面） */
export type PinnedSyntaxLineKinds =
  | 'frontmatter'
  | 'code'
  | 'formula'
  | 'table'
  | 'heading'
  | 'quote'
  | 'list'
  | 'text'
export const syntaxLineKindsPinned: Equals<AddonSyntaxLineKind, PinnedSyntaxLineKinds> = true
export type PinnedSyntaxInlineKinds = 'code' | 'formula' | 'none'
export const syntaxInlineKindsPinned: Equals<AddonSyntaxInlineKind, PinnedSyntaxInlineKinds> = true
export type PinnedSyntaxRejections = 'view-disposed' | 'read-only' | 'invalid-request'
export const syntaxRejectionsPinned: Equals<AddonSyntaxRejection, PinnedSyntaxRejections> = true
/** 查询面（两方法）与结果形状（nodeNames 诊断载荷非稳定，形状钉住） */
export type SyntaxSurface = Pick<AddonSyntaxFacet, 'lineTypeAt' | 'inlineAt'>
export type SyntaxShapes = {
  lineResult: AddonSyntaxLineTypeResult
  inlineResult: AddonSyntaxInlineResult
}

/** #457 宿主设置白名单读取面：白名单键集与拒绝码钉住（接口冻结面——
 *  新增白名单项是 minor 扩展，须同步台账/文档后在此放宽钉住） */
export type PinnedHostSettingKeys = 'editor.readingBreaks'
export const hostSettingKeysPinned: Equals<AddonHostSettingKey, PinnedHostSettingKeys> = true
export type PinnedHostSettingsRejections = 'invalid-key' | 'view-disposed'
export const hostSettingsRejectionsPinned: Equals<AddonHostSettingsRejection, PinnedHostSettingsRejections> = true
/** 白名单常量可被组件作者值导入（运行时校验自己的 key 集合） */
export const consumedHostSettingKeys: readonly string[] = ADDON_HOST_SETTING_KEYS
/** 读取面（单方法）与结果形状 */
export type HostSettingsSurface = Pick<AddonHostSettingsFacet, 'get'>
export type HostSettingsShapes = {
  getResult: AddonHostSettingGetResult
  value: AddonHostSettingValue
}

/** #427 命令回调签名：携带目标视图句柄（无活动视图 null）——删参/改形即编译失败 */
export const commandsHandlerParamPinned: Equals<
  Parameters<Parameters<AddonSdkCommandsFacet['register']>[1]>,
  [AddonViewHandle | null]
> = true

/** #404 组件数据目录面（读写监听六入口 + 拒绝码钉住） */
export type StorageSurface = Pick<
  AddonStorageFacet,
  'uri' | 'readFile' | 'writeFile' | 'list' | 'deleteFile' | 'onDidChangeFile'
>
export const storageRejectionsPinned: Equals<AddonStorageRejection, 'invalid-path' | 'too-large' | 'error'> = true
/** onDidChangeFile 回调两参契约（相对路径, 变化类型）——删参/收窄 kind 即编译失败 */
export const storageWatchKindPinned: Equals<Parameters<Parameters<AddonStorageFacet['onDidChangeFile']>[0]>[1], 'change' | 'delete'> = true

/** 设置定义到值的组合 */
export type SettingShapes = {
  definition: AddonSettingDefinition
  value: AddonSettingValue
}

/** #473/#475 string 定义呈现形态字段：enumLabels（枚举档位标签，直值或
 *  多语言映射）与 multiline（多行文本声明）——字段改名/删除/形态收窄即
 *  编译失败（AddonLocalizedText 是标签值形态的公开别名） */
export const presentationSettingDefinitions: readonly AddonSettingDefinition[] = [
  {
    key: 'strategy', title: '空格策略', type: 'string',
    enum: ['none', 'soft', 'strict'], default: 'soft',
    enumLabels: {
      none: { 'zh-cn': '不要求空格', en: 'No spaces' },
      soft: '软空格',
    },
  },
  { key: 'prefixes', title: '前缀词典', type: 'string', multiline: true, default: '' },
]
export type EnumLabelText = AddonLocalizedText

/** #472 设置定义分组（引用式）：定义 group 字段引用组声明键，组元数据
 *  （title/description 为 AddonLocalizedText）经注册载荷声明一次、声明
 *  序即呈现序——字段/类型改名或形态收窄即编译失败 */
export const groupedSettingDefinitions: readonly AddonSettingDefinition[] = [
  { key: 'theme', title: '主题', type: 'string', default: 'light', group: 'appearance' },
  { key: 'legacy', title: '兼容项', type: 'boolean', default: true },
]
export const settingGroupDeclarations: readonly AddonSettingGroup[] = [
  { key: 'appearance', title: { 'zh-cn': '外观', en: 'Appearance' }, description: '观感相关' },
]
/** #472 搜索摘要条目（definitions 的元素形状）：title 非空直值、可选说明 */
export const settingSearchEntries: readonly AddonSettingSearchEntry[] = [
  { key: 'theme', title: '主题', description: '配色主题' },
  { key: 'flag', title: '开关项' },
]

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
