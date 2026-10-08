// #360 T11 附加组件所属按钮、面板与视图界面贡献——两端共享的形状与纯校验。
//
// 归属与挂载边界（ADR-0012「运行与作用范围」与票面 #360）：附加组件只可
// 往**平台预定义挂载点**新增自己的界面元素——按钮槽位白名单（当前仅
// toolbar）与面板 dock 由平台构造与持有；不把内核容器、内置界面、菜单或
// 设置框架交给作者接管（负向：slot 白名单外值明确拒绝，面板定义形状上
// 不存在挂载位置字段）。
//
// 结构性免疫（沿 T10 同款机制）：公开注册入口只收**局部 ID**（localId），
// 命名空间前缀由平台注入——组件传入的 id 不可能成为内置身份或另一组件
// 的命名空间 id（localId 禁含点号）。
//
// 动作二选一：按钮挂接 T10 已注册命令（command 局部 ID——点击经命令体系
// 执行，模式门控与键位复用 T10）或自带回调（onClick——运行期由平台注入
// 当前目标视图句柄，操作归当前目标）；两者都给或都缺明确拒绝。
//
// 拒绝面约定（沿 addonCommands/addonSettings 惯例）：SDK 注册拒绝用机器
// 可辨认的 kebab-case reason 码，不给最终用户界面文案——普通 API 拒绝
// 不算组件故障。
import { ADDON_DISPLAY_TEXT_MAX, addonLocalIdProblem, type AddonLocalIdProblem } from './addonCommands'
import type { BindingMode } from './keybindings'
import type { AddonViewHandle } from './addonEditApi'

/** 按钮槽位白名单：当前唯一合法挂载点（其余值注册拒绝——内置界面/侧栏/
 *  设置框架等不可挂；未来新槽位在此登记并同步 styleContract 条目） */
export const ADDON_UI_BUTTON_SLOTS = ['toolbar'] as const
export type AddonUiButtonSlot = (typeof ADDON_UI_BUTTON_SLOTS)[number]

/** 目标句柄获取器（按钮回调与面板 mount 收到）：每次调用动态解析**当前
 *  活动视图**（焦点所在的嵌入内部 Live 或主正文——T06 句柄语义：在引用
 *  B 中操作归 B 不误改父 A）；视图不在场（面板销毁/阅读态只读时）null */
export type AddonUiTargetGetter = () => AddonViewHandle | null

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

/** 按钮形状拒绝码 */
export type AddonUiButtonProblem =
  | AddonLocalIdProblem
  | 'label-empty'
  | 'label-too-long'
  | 'slot-unknown'
  | 'mode-invalid'
  | 'order-invalid'
  | 'command-local-id'
  | 'action-conflict'
  | 'action-missing'
  | 'icon-text-empty'
  | 'icon-text-too-long'

/** 面板形状拒绝码 */
export type AddonUiPanelProblem =
  | AddonLocalIdProblem
  | 'title-empty'
  | 'title-too-long'
  | 'mode-invalid'
  | 'mount-not-function'
  | 'unmount-not-function'

/** 命名空间 ID：`<addonId>.<localId>`（按钮与面板同式） */
export function namespacedAddonUiId(addonId: string, localId: string): string {
  return `${addonId}.${localId}`
}

/** 命名空间限定后的按钮 ID 形态（观测/断言面；组件 ID 自带 publisher.name
 *  一层点号，故整体至少两段） */
export const ADDON_UI_BUTTON_ID_PATTERN = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,64}$/
/** 命名空间限定后的面板 ID 形态（同上） */
export const ADDON_UI_PANEL_ID_PATTERN = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,64}$/

function isBindingMode(value: unknown): value is BindingMode {
  return value === 'live' || value === 'reading' || value === 'both'
}

/** 按钮形状校验：返回拒绝码；null = 通过。hasOnClick 由运行期据回调在场
 *  与否传入（动作二选一校验需要两侧信息） */
export function addonUiButtonProblem(
  def: AddonUiButtonDefinition,
  opts: { hasOnClick: boolean },
): AddonUiButtonProblem | null {
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
  if (def.slot !== undefined && !(ADDON_UI_BUTTON_SLOTS as readonly string[]).includes(def.slot)) {
    return 'slot-unknown'
  }
  if (def.mode !== undefined && !isBindingMode(def.mode)) {
    return 'mode-invalid'
  }
  if (def.order !== undefined && (typeof def.order !== 'number' || !Number.isFinite(def.order))) {
    return 'order-invalid'
  }
  if (def.command !== undefined && opts.hasOnClick) {
    return 'action-conflict'
  }
  if (def.command === undefined && !opts.hasOnClick) {
    return 'action-missing'
  }
  if (def.command !== undefined && addonLocalIdProblem(def.command) !== null) {
    return 'command-local-id'
  }
  if (def.iconText !== undefined && (typeof def.iconText !== 'string' || def.iconText.length === 0)) {
    return 'icon-text-empty'
  }
  if (def.iconText !== undefined && def.iconText.length > ADDON_DISPLAY_TEXT_MAX) {
    return 'icon-text-too-long'
  }
  return null
}

/** 面板形状校验：返回拒绝码；null = 通过（mount 的 root 参数类型由运行期
 *  环境定型——共享层只校验可调用性） */
export function addonUiPanelProblem(def: AddonUiPanelDefinition): AddonUiPanelProblem | null {
  const idProblem = addonLocalIdProblem(def.id)
  if (idProblem !== null) {
    return idProblem
  }
  if (typeof def.title !== 'string' || def.title.length === 0) {
    return 'title-empty'
  }
  if (def.title.length > ADDON_DISPLAY_TEXT_MAX) {
    return 'title-too-long'
  }
  if (def.mode !== undefined && !isBindingMode(def.mode)) {
    return 'mode-invalid'
  }
  if (typeof def.mount !== 'function') {
    return 'mount-not-function'
  }
  if (def.unmount !== undefined && typeof def.unmount !== 'function') {
    return 'unmount-not-function'
  }
  return null
}
