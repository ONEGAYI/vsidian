// #359 T10 附加组件命令、菜单与统一快捷键——两端共享的形状与纯校验。
//
// 归属与命名空间规则（ADR-0012「运行与作用范围·菜单边界」2026-10-05 与
// 票面 #359）：附加组件只可新增自己的命令与菜单项；稳定 ID 统一加组件
// 命名空间（`<addonId>.<localId>`）；内置 ID、同名注册间接替换、隐藏/
// 删除/改名及其他组件归属侵犯明确拒绝。内核既有 override/hide 入口不作为
// 公开 SDK（本模块不导出任何覆写路径）。
//
// 结构性免疫（非运行期拦截）：公开注册入口只收**局部 ID**（localId），
// 命名空间前缀由平台注入——组件传入的 id 不可能成为内置菜单 id 或另一
// 组件的命名空间 id（localId 禁含点号，点号是命名空间分隔符）。
//
// 保留 Tab 段拒绝（#125 落档铁律，#427 收窄）：裸 Tab 与 Shift+Tab 属
// 情境输入固定链（围栏越界 → 表格导航 → 行缩进），命令绑定该形态会被
// keybindingRouter 先于 CM6 keymap 拦截（stopPropagation）破坏三段优先级
// ——默认绑定含保留 Tab 段的 chord 注册期拒绝；ctrl/alt/meta+Tab 不参与
// 三段链，#427 起放行（宿主/OS 占用组合不保证事件可达）。
//
// 拒绝面约定（沿 addonSettings 惯例）：SDK 注册拒绝用机器可辨认的
// kebab-case reason 码（+ 英文 detail），不给最终用户界面文案——组件作者
// 的排障文案归宿主输出通道日志（英文拼接）。
import { normalizeChord, chordContainsReservedTab } from './keybindings'
import { CONTEXT_MENU_ICON_KEYS, type MenuPredicate } from './contextMenu'
import type { BindingMode } from './keybindings'

/** 命令局部 ID 合法形态：字母/数字/下划线/连字符，1–64 字符（禁点号——
 *  点号保留给命名空间分隔符，含点即伪造跨组件或内置身份的尝试） */
const ADDON_LOCAL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 展示字段封顶（#395 P3）：名称类用户可见文本（命令 title、菜单 label、
 * 按钮 label/iconText、面板 title、渲染提供者 label）注册期统一封 256。
 * 超限整批拒绝并返回可辨认 reason（不截断、不静默）——异常大载荷不进
 * 协议与界面，量级对齐行为面既有名称字段的合理上界。
 */
export const ADDON_DISPLAY_TEXT_MAX = 256

/** 命名空间限定后的完整 ID 形态（观测/断言面） */
export const ADDON_MENU_ITEM_ID_PATTERN = /^[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,64}$/

/** 局部 ID 拒绝码 */
export type AddonLocalIdProblem = 'empty' | 'dot' | 'too-long' | 'invalid-chars'

/** 默认绑定拒绝码（tab-forbidden = #125 Tab 固定链） */
export type AddonDefaultBindingsProblem = 'not-string' | 'invalid-chord' | 'tab-forbidden'

/** 菜单项形状拒绝码 */
export type AddonMenuItemProblem =
  | AddonLocalIdProblem
  | 'label-empty'
  | 'label-too-long'
  | 'icon-key'
  | 'command-local-id'

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

/** 命名空间 ID：`<addonId>.<localId>`（命令与菜单项同式） */
export function namespacedAddonId(addonId: string, localId: string): string {
  return `${addonId}.${localId}`
}

/** 局部 ID 校验：返回拒绝码；null = 通过 */
export function addonLocalIdProblem(localId: string): AddonLocalIdProblem | null {
  if (typeof localId !== 'string' || localId.length === 0) {
    return 'empty'
  }
  if (localId.includes('.')) {
    return 'dot'
  }
  if (localId.length > 64) {
    return 'too-long'
  }
  if (!ADDON_LOCAL_ID_RE.test(localId)) {
    return 'invalid-chars'
  }
  return null
}

/** 默认绑定校验：返回拒绝码；null = 通过（Tab 通道拒绝见模块头） */
export function addonDefaultBindingsProblem(bindings: readonly string[]): AddonDefaultBindingsProblem | null {
  for (const raw of bindings) {
    if (typeof raw !== 'string') {
      return 'not-string'
    }
    const normalized = normalizeChord(raw)
    if (normalized === null) {
      return 'invalid-chord'
    }
    if (chordContainsReservedTab(normalized)) {
      return 'tab-forbidden'
    }
  }
  return null
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
  /** 归一化后的默认绑定（注册期已拒 Tab 与非法 chord；归一后去重保留首现
   *  序——#449；空数组 = 默认未绑定） */
  defaults: readonly string[]
}

/** 从注册形状构造上报载荷（校验通过的输入才到达这里；defaults 归一化） */
export function buildAddonCommandReport(addonId: string, def: AddonCommandDefinition): AddonCommandReport | null {
  if (addonLocalIdProblem(def.id) !== null) {
    return null
  }
  if (typeof def.title !== 'string' || def.title.length === 0) {
    return null
  }
  if (def.title.length > ADDON_DISPLAY_TEXT_MAX) {
    return null
  }
  if (def.mode !== 'live' && def.mode !== 'reading' && def.mode !== 'both') {
    return null
  }
  const defaults = [...(def.defaultBindings ?? [])]
  if (addonDefaultBindingsProblem(defaults) !== null) {
    return null
  }
  // #449：defaults 归一化 → 去重（保留首现序）→ 入协议。'Ctrl+F' 这类
  // 别名书写是正常组件可达的合法形态（注册期 normalizeChord 非 null 即
  // 过），重复形态去重收口而非拒绝——Set 按插入序迭代即首现序；宿主复验
  // 侧 syncReport 同语义。违约拦截面（保留 Tab 段、非法 chord）不变。
  const normalizedDefaults = [...new Set(defaults.map((raw) => normalizeChord(raw)!))]
  return {
    commandId: namespacedAddonId(addonId, def.id),
    addonId,
    localId: def.id,
    title: def.title,
    mode: def.mode,
    writes: def.writes === true,
    defaults: normalizedDefaults,
  }
}
