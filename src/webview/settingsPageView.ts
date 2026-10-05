// 设置页分页容器：宿主快照为权威，全局搜索只负责设置入口定位。
// #93 i18n 起：框架文案经 t() 取词（语言包由 localeBoot 首帧从数据岛
// 装配、locale.changed 换包，本视图订阅换包事件重渲染常驻文本）；string
// 枚举定义渲染为下拉控件（boolean 仍为开关）。#95 起设置项定义文案同样
// 键化（def.titleKey/descriptionKey → t() 取词），搜索按取词后的显示
// 文本匹配。
import { t, onLocaleChanged } from '../shared/i18n'
import type { MessageKey } from '../shared/locales/en'
import { bindLocale } from './localeDom'
import { isHostToWebview } from '../shared/protocol'
import {
  DEFAULT_EDITOR_GUARD_KEY,
  isSettingEnabled,
  type SettingDefinition,
  type SettingsPayload,
  type SettingsPayloadValue,
  type StringEnumSettingDefinition,
  type StringTextSettingDefinition,
} from '../shared/settings'

export interface SettingsPageBridge { postMessage(message: unknown): void }

/** 已实现的附加分页才注册；分页自己的搜索不占用全局搜索框。 */
export interface SettingsPageSection {
  id: string
  title: string
  description: string
  /** 分页图标（侧栏导航与搜索分组共用）。#231 外观合并：'palette' 由
   *  CSS 片段分页槽位改为调色板字形并被「外观」合并分页沿用（画笔字形
   *  退役）；'book'（#132 样式参考分页）随侧栏条目合并一并退役；
   *  'folderCog' 为「文件与链接」分页（#332 原索引维护改名承接）字形
   *  （#332 二轮自链环 glyph 换装：文件夹 + 右下角齿轮，用户指定意象）；
   *  'keyboard' 为快捷键分页的字形（#264 中文分词分页退役——其曾占位借
   *  用的 keyboard 槽位随之消失） */
  icon: 'keyboard' | 'editor' | 'palette' | 'folderCog'
  entries: readonly { id: string; title: string; description?: string }[]
  /**
   * 附加分页内嵌标准设置行组（#332 设置重组）：每组由视图统一装配为 h3
   * 组容器 + 标准设置行（与本页 defs 同一渲染与依赖灰化链路，快照回推的
   * data-setting-key 同步天然覆盖），空组跳过；组条目进全局搜索索引并归
   * 本分页分组命中（点击进分页并定位组内行）。前缀过滤以视图装配的定义
   * 表为源——fixture 场景自然为空组，分页实现不直接引用生产注册表。
   */
  defsGroups?: readonly {
    titleKey: MessageKey
    icon?: SettingsGroupIcon
    prefixes: readonly string[]
  }[]
  /** 返回清理函数；focusEntry 为全局搜索定位到的入口。 */
  mount(parent: HTMLElement, focusEntry?: string): void | (() => void)
  /**
   * 会话内恢复（PR #346 方案 A）：捕获分页内输入态（settings.uiState 的
   * state 透传载荷，宿主不解释内容）。无输入态的分页不实现；实现须在
   * 任意时刻可调用且同态幂等（滚动上报路径不调，输入态变化与分页切换
   * 上报路径调用）。录制/菜单开合类瞬态不入载荷（恢复无意义且可能误存
   * 键位——由各分页实现自行排除）
   */
  captureState?(): unknown
  /**
   * 应用恢复的分页内输入态（面板重载后宿主经 settings.focusSection{state}
   * 回放）。调用时序契约：在 mount 之前——mount 按已恢复的字段渲染；
   * 载荷形态不符整条忽略（安全降级到默认输入态）。显式定位（mount 带
   * focusEntry）不走本方法（定位语义优先，分页自身的清空分支兜底）
   */
  restoreState?(state: unknown): void
  /**
   * 视图注入的输入态变化回调（与 captureState 配对）：分页在用户输入
   * 改变 captureState 结果时调用，视图据此重报 uiState 携带最新 state
   */
  setStateSink?(sink: () => void): void
}

/**
 * 分页内二级标题组委托（#264 分词组引入，挂编辑器页尾；#323 常规页装配
 * 扩展起支持挂任意内建分组页）：组内容与组内定位由实现自行装配（承载
 * 标准设置行之外的呈现形态），条目进全局搜索索引（归所挂分组的搜索分组
 * 命中）；与 SettingsPageSection 互斥——本接口不产生侧栏分页槽位，也不得
 * 以此新增分页形态。
 */
export interface SettingsPageDelegateGroup {
  /** 组标题语言键（h3 二级标题，t(titleKey) 取词） */
  readonly titleKey: MessageKey
  /** 兼容路由：宿主按退役分页 id 发起 settings.focusSection 时打开所属页
   *  并定位到本组（entry 原样透传给 mount，语义不变）；新组无退役分页则缺省 */
  readonly legacySectionId?: string
  /** 组标题图标槽位（SettingsGroupIcon 注册表驱动，与 defs 组同一 h3
   *  路径：内联字形与 #265 生图资产同槽）：缺省 = 槽位空缺，标题文字
   *  起点不变（分词组的 wordSegment 已随 #265 生图接线登记） */
  readonly icon?: SettingsGroupIcon
  /** 全局搜索条目（id = mount 的 focusEntry 定位键） */
  readonly entries: readonly { id: string; title: string; description?: string }[]
  /** 组内容装配进容器（vsidian-settings-group）；返回的清理函数于分页
   *  重渲染/切换时调用（释放内部 parent 引用） */
  mount(parent: HTMLElement, focusEntry?: string): void | (() => void)
}

/**
 * 编辑器页小节（editorSectionDefs 的元素）：defs 标准组与 group 委托组
 * 互斥——标准臂有 defs 无 group，委托臂有 group 无 defs（对侧属性以
 * `?: undefined` 钉成可辨识联合，互斥靠类型不靠约定）。icon 为二级组
 * 标题图标槽（标准臂四枚内联字形，委托臂生图资产或空缺）。
 */
type EditorSection =
  | { titleKey: MessageKey; icon: SettingsGroupIcon; defs: () => readonly SettingDefinition[]; group?: undefined }
  | { titleKey: MessageKey; icon?: SettingsGroupIcon; defs?: undefined; group: SettingsPageDelegateGroup }

export const SETTINGS_PAGE_CLASS_NAMES = {
  root: 'vsidian-settings', title: 'vsidian-settings-title',
  subtitle: 'vsidian-settings-subtitle', list: 'vsidian-settings-list',
  item: 'vsidian-settings-item', itemTitle: 'vsidian-settings-item-title',
  itemDescription: 'vsidian-settings-item-description', checkbox: 'vsidian-settings-checkbox',
  select: 'vsidian-settings-select',
  /** #161 自由文本设置项的 text input（类名随控件分支稳定） */
  textInput: 'vsidian-settings-text',
  range: 'vsidian-settings-range', rangeWrap: 'vsidian-settings-range-wrap',
  rangeValue: 'vsidian-settings-range-value',
  empty: 'vsidian-settings-empty',
} as const

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = cls
  if (text) el.textContent = text
  return el
}

/** 字形 path 注册表（24 viewBox 单 path；icon() 单表的数据源，装配仍只走
 *  icon() 一条路径，新增 kind = 联合类型加名 + 本表加行）。
 *  search：放大镜（侧栏搜索框前缀）；
 *  keyboard：键盘（快捷键分页）；
 *  general（#96「常规」分组；#230 换形）：双拨杆开关——通用偏好开关的
 *  惯用意象（上枚圆点居左、下枚圆点居右；lucide toggle-left/right 的纵排
 *  同构，替换原地球字形的「语言/网络」语义）；
 *  palette（#231 外观合并分页）：调色板——带颜料孔圆点与拇指孔内凹的画板
 *  （lucide palette 主体轮廓线性化，颜料孔以 stroke-linecap 圆点子路径
 *  表达，仍为单 path 线性风格；#128 起槽位沿用的「样式定制」意象不变，
 *  原画笔字形随合并退役）；
 *  editor：铅笔起笔（「编辑器」分组）；
 *  folderCog（#332 二轮「文件与链接」分页）：文件夹 + 右下角齿轮（lucide
 *  folder-cog 组合线性化——文件/链接域与索引维护的合体意象，替换原链环
 *  glyph）；用户指定意象，SVG 自绘（2026-10-04 拍板）；
 *  display/editing/codeblock/image（#263 编辑器页二级组标题四枚，v2 拍板
 *  清单原样 path）：显示 = 显示器、编辑 = 双 I 光标、代码块 = 尖括号、
 *  图片 = 山形相框（#265 生图两枚从独立 SVG 资产加载，不在本表）；
 *  shield（#323 常规页「默认编辑器」组标题）：盾牌（lucide shield 线性
 *  化——守护意象）；
 *  links（形态改版批次链环）与 refview（#298 占位链环）随 #332 二轮三处
 *  链环重复整改退役（引用全部迁移至上述三枚新字形）；
 *  book（#132 样式参考分页）随 #231 侧栏条目合并退役；
 *  #163 一轮曾为符号/代码块/图片三组新增 keyboard 复用与 code/image 形，
 *  二轮还原为页内小节后侧栏不再使用，已随分支退役。 */
const ICON_PATHS = {
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  keyboard: 'M3 5h18v14H3zM6 9h1m3 0h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10',
  general: 'M7 2h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8ZM8 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4M7 14h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8ZM16 16a2 2 0 1 0 0 4 2 2 0 1 0 0-4',
  palette: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z M13.5 6.5h.01 M17.5 10.5h.01 M8.5 7.5h.01 M6.5 12.5h.01',
  editor: 'M14 4l6 6M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16z',
  // #332 二轮（用户指定意象，lucide folder-cog 线性化）：folder-cog 主体
  // + 齿轮圆与 8 根放射齿；pointerLink/dbLink 两枚曾以内联字形过渡，资产
  // 交付后改走生图槽（GENERATED_GROUP_ICONS + CSS 映射），本表不再承载
  folderCog:
    'M10.3 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.98a2 2 0 0 1 1.69.9l.66 1.2A2 2 0 0 0 12 6h8a2 2 0 0 1 2 2v3.3M18 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6M14.305 19.53l.923-.382M15.228 16.852l-.923-.383M16.852 15.228l-.383-.923M16.852 20.772l-.383.924M19.148 15.228l.383-.923M19.53 21.696l-.382-.924M20.772 16.852l.924-.383M20.772 19.148l.924.383',
  display: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM8 21h8M12 17v4',
  editing: 'M7 4v16M5 4h4M5 20h4M17 4v16M15 4h4M15 20h4',
  codeblock: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0M21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  // experimental（#296 三轮「实验性功能」侧栏组）：锥形瓶（lucide
  // flask-conical 线性化——实验意象）；table（实验页「表格行为」小节
  // 标题）：外框 + 中缝十字的 2×2 网格
  experimental:
    'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2 M8.5 2h7 M7 15h10',
  table: 'M3 5h18v14H3zM12 5v14M3 12h18',
} as const

function icon(kind: keyof typeof ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', ICON_PATHS[kind])
  svg.append(path)
  return svg
}

/** 二级组标题图标：内联线性字形与生图资产（generated 槽）两类。
 *  生图四枚（#265 打字机/分词起，#332 二轮增引用视图/索引维护两枚）：
 *  typewriter / wordSegment / pointerLink（手型指针+链接下划线，#298 占
 *  位链环的正式兑现）/ dbLink（数据库圆柱+锁链）——经 GENERATED_GROUP_
 *  ICONS 走 CSS 背景映射（media/quick-actions 明暗资产）；两者的内联临时
 *  字形随资产交付退役（#298 占位链环 → 一轮内联 → 二轮生图资产）；
 *  table（#296 三轮）：实验页「表格行为」小节标题；
 *  shield（#323）：常规页「默认编辑器」委托组标题（守护意象内联字形）；
 *  refview（#298 占位）与 links（#332 一轮借位）随二轮三处链环重复整改
 *  一并退役（全仓引用迁移至新字形）。 */
export type SettingsGroupIcon = 'display' | 'editing' | 'codeblock' | 'image' | 'typewriter' | 'wordSegment' | 'pointerLink' | 'table' | 'shield' | 'dbLink'

/** 生图资产槽位：这些 kind 不走 ICON_PATHS 内联字形，装配为 generated
 *  span（CSS 按 data-icon 映射 media/quick-actions 明暗背景） */
type GeneratedGroupIcon = 'typewriter' | 'wordSegment' | 'pointerLink' | 'dbLink'
const GENERATED_GROUP_ICONS: readonly GeneratedGroupIcon[] = ['typewriter', 'wordSegment', 'pointerLink', 'dbLink']

function isGeneratedGroupIcon(kind: SettingsGroupIcon): kind is GeneratedGroupIcon {
  return (GENERATED_GROUP_ICONS as readonly string[]).includes(kind)
}

/** 二级组标题图标装配（#332 起导出）：内联字形与生图资产同槽返回，附
 *  加分页自有内容内的 h3 组标题（如文件与链接页「索引维护」）复用同一
 *  路径——组标题容器语言不因装配方分叉。 */
export function groupIcon(kind: SettingsGroupIcon): SVGSVGElement | HTMLSpanElement {
  if (isGeneratedGroupIcon(kind)) {
    const glyph = element('span', 'vsidian-settings-generated-icon')
    glyph.dataset.icon = kind
    glyph.setAttribute('aria-hidden', 'true')
    return glyph
  }
  return icon(kind)
}

export class SettingsPageView {
  private values: SettingsPayload | undefined
  private listEl: HTMLElement | undefined
  /** 主区滚动容器（#155 独立滚动骨架：侧栏与主区各自 overflow） */
  private mainEl: HTMLElement | undefined
  /** 上次渲染上下文（分页+查询）：变化时主区滚动复位到顶部 */
  private lastRenderKey: string | undefined
  private search: HTMLInputElement | undefined
  private nav: HTMLElement | undefined
  private status: HTMLElement | undefined
  private titleEl: HTMLElement | undefined
  /** 当前分组；undefined = 尚未选择（回落首个分类，#96 general 组置顶） */
  private active: string | undefined
  private pending = 0
  private saveFailed = false
  /** 当前分页内容卸载器集合（标准分页 mount 与编辑器页委托组 mount 的
   *  清理函数逐个收集）：编辑器页多委托组并存，重渲染/切页时全部执行 */
  private sectionDisposers: Array<() => void> = []
  private offLocale: (() => void) | undefined

  constructor(private readonly bridge: SettingsPageBridge,
    private readonly defs: readonly SettingDefinition[],
    private readonly sections: readonly SettingsPageSection[] = [],
    /** #264 编辑器页二级组委托（分词）：挂编辑器页尾，不占侧栏槽位 */
    private readonly editorGroups: readonly SettingsPageDelegateGroup[] = [],
    /** #323 常规页二级组委托（默认编辑器守护）：挂常规页标准行之后，
     *  不占侧栏槽位（常规页装配扩展——委托组机制此前只挂编辑器页尾） */
    private readonly generalGroups: readonly SettingsPageDelegateGroup[] = []) {
    // PR #346：分页内输入态变化的上报钩子——分页捕获态一变即重报 uiState
    //（携带最新 state 载荷），宿主记忆与分页现场保持同步
    for (const section of sections) {
      section.setStateSink?.(() => this.reportUiState(true))
    }
  }

  mount(parent: HTMLElement): void {
    const root = element('div', SETTINGS_PAGE_CLASS_NAMES.root)
    const sidebar = element('aside', 'vsidian-settings-sidebar')
    // #101：常驻骨架文案经 localeDom 登记（创建即写词 + 换包单点重刷）——
    // 此前 search/nav 四属性不随 render() 重建，是换包漏刷点
    this.titleEl = element('h1', SETTINGS_PAGE_CLASS_NAMES.title)
    bindLocale(this.titleEl, 'text', 'settings.pageTitle')
    sidebar.append(this.titleEl)
    if (this.defs.length || this.sections.length) {
      const searchWrap = element('div', 'vsidian-settings-search-wrap')
      this.search = element('input', 'vsidian-settings-search')
      this.search.type = 'search'
      bindLocale(this.search, 'placeholder', 'settings.searchPlaceholder')
      bindLocale(this.search, 'aria-label', 'settings.searchAriaLabel')
      this.search.addEventListener('input', () => this.render())
      this.search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { this.search!.value = ''; this.render() }
      })
      searchWrap.append(icon('search'), this.search)
      const navLabel = element('p', 'vsidian-settings-nav-label')
      bindLocale(navLabel, 'text', 'settings.navLabel')
      this.nav = element('nav', 'vsidian-settings-nav')
      bindLocale(this.nav, 'aria-label', 'settings.navAriaLabel')
      sidebar.append(searchWrap, navLabel, this.nav)
    }
    const main = element('main', 'vsidian-settings-main')
    this.status = element('p', 'vsidian-settings-status')
    this.status.setAttribute('role', 'status')
    this.listEl = element('div', SETTINGS_PAGE_CLASS_NAMES.list)
    main.append(this.status, this.listEl)
    root.append(sidebar, main)
    this.mainEl = main
    // 会话内恢复：主区滚动实时上报（浏览器 scroll 事件本身已按帧节流，
    // 无需再节流）；分页上下文变化的上报在 render 尾部
    main.addEventListener('scroll', () => this.reportUiState())
    parent.append(root)
    // 语言切换重渲染（#93/#101）：常驻骨架（标题/搜索框/侧栏标签）由
    // localeDom 注册表单点重刷；列表与分页是 render() 的重建产物，随换包
    // 整体重建取新词。搜索输入框为持久元素，重渲染不重建不夺焦
    this.offLocale = onLocaleChanged(() => this.applyLocale())
    this.render()
  }

  /** 语言换包后的重渲染：列表与分页整体重建（骨架文案经 localeDom 重刷） */
  private applyLocale(): void {
    this.render()
  }

  /**
   * 释放视图资源（取消语言换包订阅）。生产路径的视图寿命 = 页面寿命
   * （页面卸载即整体销毁），无需调用；同一模块状态反复挂载视图的场景
   * （单测）用它防监听器累积。
   */
  dispose(): void {
    this.offLocale?.()
    this.offLocale = undefined
  }

  /** 切换到指定分类（附加分页或内建分组）；entry（#231）为分页内进一步
   *  定位的条目 id（外观分页按归属路由页内页签）；整页重渲染（#132）。
   *  #264 兼容路由：宿主按退役分页 id（legacySectionId，如分词
   *  'wordSegment'）发起定位时打开编辑器页，entry 透传给对应委托组。
   *  scroll（可选，会话内恢复）：渲染复位后应用的主区滚动位置——缺省 =
   *  保持 render 的复位语义（顶部）；未知分页整条忽略（不设滚动）。
   *  state（可选，PR #346）：恢复的分页内输入态载荷——在 mount 之前应用
   *  （mount 按已恢复字段渲染）；entry 在场时不应用（显式定位语义优先，
   *  防御性跳过——协议约定二者不同时携带） */
  selectSection(id: string, entry?: string, scroll?: number, state?: unknown): void {
    if (this.generalGroups.some((g) => g.legacySectionId === id)) id = 'general'
    if (this.editorGroups.some((g) => g.legacySectionId === id)) id = 'editor'
    const known = this.categories().some((c) => c.id === id)
    if (!known) return
    this.active = id
    if (state !== undefined && entry === undefined) {
      this.sections.find((s) => s.id === id)?.restoreState?.(state)
    }
    this.render(entry)
    if (scroll !== undefined && this.mainEl) this.mainEl.scrollTop = scroll
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) return
    // #132 样式参考：宿主命令定位到指定附加分页（未知 id 忽略）；
    // #231 外观合并：entry 可选透传（分页内定位）；
    // 会话内恢复：scroll 可选透传（面板重开/重载后恢复滚动位置）、
    // state（PR #346）可选透传（分页内输入态回放，selectSection 内应用）
    if (message.kind === 'settings.focusSection') {
      this.selectSection(message.section, message.entry, message.scroll, message.state)
      return
    }
    if (message.kind === 'settings.snapshot' || message.kind === 'settings.changed') {
      this.values = message.values
      if (this.pending > 0) {
        this.pending--
        this.saveFailed ||= message.kind === 'settings.snapshot'
        if (this.status) this.status.textContent = this.pending ? t('settings.saving')
          : this.saveFailed ? t('settings.saveFailed') : t('settings.saveDone')
      }
      // 同步值不重建分页，也不夺走搜索框和开关的键盘焦点。
      for (const box of this.listEl?.querySelectorAll<HTMLInputElement>('input[data-setting-key]') ?? []) {
        const def = this.defs.find((d) => d.key === box.dataset.settingKey)!
        if (def.type === 'number') {
          // #175 滑块：值、值文本与 aria-valuetext 就地同步（铺满档显示词）。
          // 显示值读回 input.value：浏览器对 range 有步进吸附（手改存量
          // 906 会吸附到 900），文本须与 thumb 实际位置一致
          const raw = this.value(def)
          const numeric = typeof raw === 'number' ? raw : def.default
          box.value = String(numeric)
          this.syncRangeDisplay(def, box, Number(box.value))
        } else if (box.type === 'text') {
          // #161 控件分型回显：checkbox 用 checked；自由文本 text input 用
          // value（同一 data-setting-key 选择器命中两类控件）
          box.value = String(this.value(def))
        } else {
          box.checked = this.value(def) === true
        }
        this.setControlDisabled(box, box.closest(`.${SETTINGS_PAGE_CLASS_NAMES.item}`), !isSettingEnabled(this.defs, this.values ?? {}, def))
      }
      for (const select of this.listEl?.querySelectorAll<HTMLSelectElement>('select[data-setting-key]') ?? []) {
        const def = this.defs.find((d) => d.key === select.dataset.settingKey)
        if (def) {
          select.value = String(this.value(def))
          this.setControlDisabled(select, select.closest(`.${SETTINGS_PAGE_CLASS_NAMES.item}`), !isSettingEnabled(this.defs, this.values ?? {}, def))
        }
      }
    }
  }
  getValues(): SettingsPayload | undefined { return this.values }
  private value(def: SettingDefinition): SettingsPayloadValue {
    const raw = this.values?.[def.key]
    if (def.type === 'boolean') {
      return typeof raw === 'boolean' ? raw : def.default
    }
    if (def.type === 'number') {
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= def.min && raw <= def.max ? raw : def.default
    }
    // #161 string 分型：枚举按值域；自由文本按 maxLength（与
    // valueMatchesType 同口径，超长/类型不符回默认）
    if ('enum' in def) {
      return typeof raw === 'string' && def.enum.includes(raw) ? raw : def.default
    }
    return typeof raw === 'string' && raw.length <= def.maxLength ? raw : def.default
  }
  /** 分组规则（#96 general 前缀；#163 验收反馈二轮还原）：侧栏只分
   *  general.* 常规与其余 editor.* 编辑器两组；分类职责由编辑器页内的
   *  组内小节承担（显示/符号输入/代码块/图片，editorSectionDefs）。
   *  键名即持久化标识，分组纯展示归属（重组零迁移：已存设置值不受影响） */
  private generalDefs(): readonly SettingDefinition[] {
    // #322 默认编辑器守护开关不由本表渲染：#323 起常规页以「默认编辑器」
    // 委托组呈现（wordSegment 排除同款），排除防标准设置行与搜索内建
    // 分组（toEntries 以本表为源）重复呈现
    return this.defs.filter((d) => d.key.startsWith('general.') && d.key !== DEFAULT_EDITOR_GUARD_KEY)
  }
  private symbolDefs(): readonly SettingDefinition[] {
    return this.defs.filter((d) => d.key.startsWith('editor.symbol'))
  }
  /** 编辑器页「编辑」小节：编辑能力类（#237 多光标 editor.multicursor；
   *  批次后续票的选词/分词设置同归此节） */
  private editingDefs(): readonly SettingDefinition[] {
    return this.defs.filter((d) => d.key.startsWith('editor.multicursor') || d.key.startsWith('editor.paste'))
  }
  private codeblockDefs(): readonly SettingDefinition[] {
    return this.defs.filter((d) => d.key.startsWith('codeblock.'))
  }
  /** 实验性页全部定义（侧栏分组与搜索分组的条目源）：experimental.* 前缀 */
  private experimentalDefs(): readonly SettingDefinition[] {
    return this.defs.filter((d) => d.key.startsWith('experimental.'))
  }
  /** 实验性页「表格行为」小节：experimental.table.* */
  private experimentalTableDefs(): readonly SettingDefinition[] {
    return this.defs.filter((d) => d.key.startsWith('experimental.table.'))
  }
  /** 编辑器页「显示」小节：非 general 且不属其他小节的 editor.* 定义
   *  （#296 三轮起 experimental.* 归「实验性功能」侧栏分组，上游 editorDefs
   *  一并排除） */
  private displayDefs(): readonly SettingDefinition[] {
    return this.editorDefs().filter(
      (d) => !d.key.startsWith('editor.symbol') && !d.key.startsWith('editor.multicursor') && !d.key.startsWith('editor.paste') &&
      !d.key.startsWith('codeblock.'))
  }
  private editorDefs(): readonly SettingDefinition[] {
    // #239 分词三键（editor.wordSegment*）不由本表渲染；#264 起呈现归编辑
    // 器页尾「中文分词」委托组（wordSegmentSettings 同组渲染选择与下载管
    // 理，值仍走标准保存链路），排除保留防止标准设置行与搜索内建分组重复
    // 呈现（搜索条目由委托组 entries 提供）；#296 三轮 experimental.* 归
    // 独立「实验性功能」侧栏分组，同样不进编辑器页（displayDefs 以上游
    // editorDefs 为基，一并排除）；#332 起图片（image.*）与引用视图
    // （hover.*/embed.*）两族迁至「文件与链接」分页（分页 defsGroups 按
    // 同一前缀收纳，搜索随该分页分组命中）
    return this.defs.filter((d) => !d.key.startsWith('general.') && !d.key.startsWith('editor.wordSegment') &&
      !d.key.startsWith('experimental.') && !d.key.startsWith('image.') &&
      !d.key.startsWith('hover.') && !d.key.startsWith('embed.'))
  }
  /** 编辑器页内小节（顺序即渲染顺序）；空小节由调用方跳过不渲染。
   *  icon 为二级组标题图标，注册表驱动（#263 内联字形 + #265 生图资产）。
   *  #264 起尾部追加委托组（分词）：组内容非标准设置行，经 group.mount
   *  装配，图标经组对象 icon 槽登记、走与 defs 组同一 h3 容器路径（结构
   *  不加特判；未登记 = 槽位空缺，布局机制对其无差别）。
   *  标准组/委托组互斥由 EditorSection 可辨识联合钉住。
   *  #332 起图片/引用视图两小节迁出（文件与链接分页 defsGroups 承接）。 */
  private editorSectionDefs(): EditorSection[] {
    return [
      { titleKey: 'settings.groupDisplay', icon: 'display', defs: () => this.displayDefs() },
      { titleKey: 'settings.groupEditing', icon: 'editing', defs: () => this.editingDefs() },
      { titleKey: 'settings.groupSymbols', icon: 'typewriter', defs: () => this.symbolDefs() },
      { titleKey: 'settings.groupCodeblock', icon: 'codeblock', defs: () => this.codeblockDefs() },
      ...this.editorGroups.map((group): EditorSection => ({ titleKey: group.titleKey, icon: group.icon, group })),
    ]
  }
  /** 实验性页内小节（#296 三轮；顺序即渲染顺序，空小节跳过；首个为
   *  「表格行为」experimental.table.*——后续实验域按同前缀模式追加行） */
  private experimentalSectionDefs(): EditorSection[] {
    return [
      { titleKey: 'settings.groupExperimentalTable', icon: 'table', defs: () => this.experimentalTableDefs() },
    ]
  }
  private categories() {
    // #332 二轮：「文件与链接」附加分页提前进内建段——与「实验性功能」
    // 槽位互换（2026-10-04 用户拍板），文件/链接域紧跟编辑器（Obsidian
    // 相邻心智），实验性退居其后；其余附加分页仍排内建之后。
    // icon 放宽到字形注册表全集（内建分组与提前分页同列表混排）
    const builtIn: Array<{ id: string; title: string; icon: keyof typeof ICON_PATHS }> = []
    // 空组不注册（fixture 可能只含部分前缀——空组不得占据默认激活位）；
    // #323：委托组同样计入所属页的注册条件（常规页仅有委托组时也注册）
    if (this.generalDefs().length > 0 || this.generalGroups.length > 0) {
      builtIn.push({ id: 'general', title: t('settings.generalSection'), icon: 'general' })
    }
    if (this.editorDefs().length > 0) {
      builtIn.push({ id: 'editor', title: t('settings.editorCategory'), icon: 'editor' })
    }
    const filesLinks = this.sections.filter((s) => s.id === 'index')
    const trailingSections = this.sections.filter((s) => s.id !== 'index')
    builtIn.push(...filesLinks)
    // #296 三轮「实验性功能」侧栏分组（experimental.* 的独立归属页）
    if (this.experimentalDefs().length > 0) {
      builtIn.push({ id: 'experimental', title: t('settings.experimentalSection'), icon: 'experimental' })
    }
    return [...builtIn, ...trailingSections]
  }
  private render(focusEntry?: string): void {
    if (!this.listEl) return
    // #155 主区独立滚动：分页或搜索上下文变化时滚动复位；同分页内的重渲染
    // （开关回显、换包）保持滚动位置。复位先于内容重建，focusEntry 的
    // scrollIntoView 在其之后执行，定位不受影响
    const query = this.search?.value.trim().toLocaleLowerCase() ?? ''
    const renderKey = `${this.active ?? ''}|${query}`
    const contextChanged = renderKey !== this.lastRenderKey
    this.lastRenderKey = renderKey
    if (contextChanged && this.mainEl) this.mainEl.scrollTop = 0
    for (const dispose of this.sectionDisposers) dispose()
    this.sectionDisposers = []
    // #96 默认分组 = 首个分类（有常规定义时即「常规」）；active 指向已
    // 消失的分类时回落首个（定义表运行时可变：测试 fixture 注册/注销）
    const active = this.categories().find((c) => c.id === this.active) ?? this.categories()[0]
    this.nav?.replaceChildren()
    for (const category of this.categories()) {
      const button = element('button', 'vsidian-settings-nav-item')
      button.type = 'button'
      button.setAttribute('aria-current', !query && active?.id === category.id ? 'page' : 'false')
      button.append(icon(category.icon), document.createTextNode(category.title))
      button.addEventListener('click', () => {
        this.active = category.id
        if (this.search) this.search.value = ''
        this.render()
        this.nav?.querySelector<HTMLButtonElement>('[aria-current=page]')?.focus()
      })
      this.nav?.append(button)
    }
    this.renderContent(focusEntry, query, active)
    // 会话内恢复（面板关闭/隐藏重载后还原分页与滚动）：分页或搜索上下文
    // 变化即上报 UI 态——同分页回显重渲染（开关回显、换包）不重复上报；
    // 宿主在下次 settings.get 握手按记忆补发 focusSection{scroll, state}。
    // 首帧回落默认页（active 未选）不上报：重开装载时首帧 render 先于
    // settings.get 到达宿主，若上报会把宿主记忆覆盖成默认页，握手补发的
    // 恢复就永远落回默认——只认用户真实所在（点过侧栏/搜索路由/滚动）的
    // 分页；默认页内滚动仍经 scroll 事件上报（带上滚动值）。
    // 切页上报携带新分页的 state 载荷（PR #346，captureState 产物）
    if (contextChanged && this.active) this.reportUiState(true)
  }

  /** 会话内恢复上报：当前生效分页（active 未选时回落首个分类，与 render
   *  的回落渲染一致）与主区滚动位置。无激活分类（空 defs fixture）不发，
   *  宿主侧空 section 同样忽略。scrollTop 取整：DOM scrollTop 是 double，
   *  zoom/分数缩放下产生小数，协议守卫只收非负整数（不取整整条被静默
   *  丢弃，恢复失效）；恢复误差 ≤0.5px 不可感知。
   *  withState（PR #346）：输入态变化与分页切换的上报携带当前分页的
   *  captureState 载荷（宿主不解释内容，原样记忆回放）；滚动上报不重报
   *  state——输入态未变省载荷，宿主对同分页的无 state 上报保留既有记忆 */
  private reportUiState(withState = false): void {
    const id = this.active ?? this.categories()[0]?.id
    if (!id) return
    const state = withState ? this.sections.find((s) => s.id === id)?.captureState?.() : undefined
    this.bridge.postMessage({
      kind: 'settings.uiState',
      section: id,
      scrollTop: Math.round(this.mainEl?.scrollTop ?? 0),
      ...(state !== undefined ? { state } : {}),
    })
  }

  /** 列表主体装配（render 的内容半）：搜索结果、附加分页委托与内建分组
   *  的渲染路径；query/active 为 render 已算好的渲染上下文。内部 return
   *  只退出装配，不影响 render 尾部的上报 */
  private renderContent(
    focusEntry: string | undefined,
    query: string,
    active: { id: string } | undefined,
  ): void {
    if (!this.listEl) return
    const list = this.listEl
    list.replaceChildren()
    if (query) {
      list.append(element('h2', 'vsidian-settings-heading', t('settings.searchResults')))
      // 搜索按用户看到的显示文本匹配：设置项定义经 t() 取词后参与过滤
      // （titleKey/descriptionKey → 当前语言文本，#95 键化迁移），分组与
      // 侧栏一致（#96 general/editor 两组；#163 二轮还原后内建分类只在
      // 编辑器页内小节，不参与搜索分组列）
      const toEntries = (defs: readonly SettingDefinition[]) =>
        defs.map((d) => ({
          id: d.key,
          title: t(d.titleKey),
          ...(d.descriptionKey ? { description: t(d.descriptionKey) } : {}),
        }))
      const groups = [
        { id: 'general', title: t('settings.generalSection'), entries: [
          ...toEntries(this.generalDefs()),
          // #323 常规页委托组条目（默认编辑器状态行/守护开关）随常规分组
          // 命中：点击进常规页并以条目 id 定位组内对应块（编辑器页委托组
          // 归编辑器分组的同一口径）
          ...this.generalGroups.flatMap((g) => g.entries),
        ] },
        // #264 委托组条目（分词 engine/resource）随编辑器分组命中：点击进
        // 编辑器页并以条目 id 定位组内对应块
        { id: 'editor', title: t('settings.editorCategory'), entries: [
          ...toEntries(this.editorDefs()),
          ...this.editorGroups.flatMap((g) => g.entries),
        ] },
        // #296 三轮 experimental.* 随「实验性功能」分组命中（无委托组）
        { id: 'experimental', title: t('settings.experimentalSection'), entries: toEntries(this.experimentalDefs()) },
        // #332 附加分页内嵌标准行组的条目随分页分组命中（点击进分页并
        // 定位组内行）；自有 entries（组内非标准行入口）缀后。分组对象显式
        // 构造——分页实现以原型 getter 暴露 id/title，对象展开取不到
        ...this.sections.map((s) => ({
          id: s.id,
          title: s.title,
          entries: [
            ...(s.defsGroups ?? []).flatMap((g) =>
              toEntries(this.defs.filter((d) => g.prefixes.some((p) => d.key.startsWith(p))))),
            ...s.entries,
          ],
        })),
      ]
      let count = 0
      for (const group of groups) for (const entry of group.entries) {
        if (!`${entry.title} ${entry.description ?? ''}`.toLocaleLowerCase().includes(query)) continue
        count++
        const result = element('button', 'vsidian-settings-result')
        result.type = 'button'
        result.append(element('span', 'vsidian-settings-result-category', group.title),
          element('strong', '', entry.title), element('span', SETTINGS_PAGE_CLASS_NAMES.itemDescription, entry.description))
        result.addEventListener('click', () => {
          this.active = group.id
          this.search!.value = ''
          this.render(entry.id)
        })
        list.append(result)
      }
      const summary = element('p', SETTINGS_PAGE_CLASS_NAMES.subtitle,
        count ? t('settings.searchCount', { count }) : t('settings.searchEmpty'))
      summary.setAttribute('role', 'status')
      list.insertBefore(summary, list.children[1] ?? null)
      return
    }
    if (!active) {
      list.append(element('p', SETTINGS_PAGE_CLASS_NAMES.empty, t('settings.empty')))
      return
    }
    const section = this.sections.find((s) => s.id === active.id)
    if (section) {
      list.append(element('h2', 'vsidian-settings-heading', section.title),
        element('p', SETTINGS_PAGE_CLASS_NAMES.subtitle, section.description))
      // #332 分页内嵌标准设置行组：视图统一装配（h3 组容器 + 标准行，依赖
      // 灰化与快照回推共用既有链路）；空组跳过（fixture 只含部分前缀时不占位）
      for (const group of section.defsGroups ?? []) {
        const defs = this.defs.filter((d) => group.prefixes.some((p) => d.key.startsWith(p)))
        if (!defs.length) continue
        const container = element('div', 'vsidian-settings-group')
        const title = element('h3', 'vsidian-settings-group-title')
        if (group.icon) title.append(groupIcon(group.icon))
        title.append(document.createTextNode(t(group.titleKey)))
        container.append(title)
        list.append(container)
        this.renderDefItems(container, defs, focusEntry)
      }
      const content = element('div', 'vsidian-settings-section-content')
      list.append(content)
      const dispose = section.mount(content, focusEntry)
      if (dispose) this.sectionDisposers.push(dispose)
      return
    }
    // 常规分组：标准行直铺（无小节），#323 起标准行之后可挂二级委托组
    //（默认编辑器守护——见下方装配块）；编辑器分组（#163 二轮还原）：页内
    // 按组内标题分小节（显示/符号输入/代码块/图片），各小节一个容器，空
    // 小节不渲染。#155 容器语言：组内条目包进分组容器（圆角 + 色差底），
    // 随分页统一
    if (active.id === 'general') {
      list.append(element('h2', 'vsidian-settings-heading', t('settings.generalSection')),
        element('p', SETTINGS_PAGE_CLASS_NAMES.subtitle, t('settings.generalSectionDescription')))
      const group = element('div', 'vsidian-settings-group')
      list.append(group)
      // 容器先入文档再填充：renderDefItems 的 focusEntry focus/scrollIntoView
      // 需要条目已在文档中，游离节点上 focus 不生效
      this.renderDefItems(group, this.generalDefs(), focusEntry)
      // #323 常规页委托组（默认编辑器守护）：标准行之后逐组挂载，结构与
      // 编辑器页委托组同构（独立分组容器 + h3 标题；mount 返回的清理函数
      // 收进卸载器集合，重渲染/切页时释放）
      for (const delegate of this.generalGroups) {
        const container = element('div', 'vsidian-settings-group')
        const title = element('h3', 'vsidian-settings-group-title')
        if (delegate.icon) title.append(groupIcon(delegate.icon))
        title.append(document.createTextNode(t(delegate.titleKey)))
        container.append(title)
        list.append(container)
        const dispose = delegate.mount(container, focusEntry)
        if (dispose) this.sectionDisposers.push(dispose)
      }
      return
    }
    // 实验性分组（#296 三轮）：页内按小节标题分组（首个为「表格行为」，
    // experimental.table.*），结构与编辑器页小节同构（h3 标题 + 分组容器，
    // 空小节不渲染；当前无委托组形态）
    if (active.id === 'experimental') {
      list.append(element('h2', 'vsidian-settings-heading', t('settings.experimentalSection')),
        element('p', SETTINGS_PAGE_CLASS_NAMES.subtitle, t('settings.experimentalSectionDescription')))
      let rendered = false
      for (const section of this.experimentalSectionDefs()) {
        const defs = section.defs?.() ?? []
        if (!defs.length) continue
        const container = element('div', 'vsidian-settings-group')
        const title = element('h3', 'vsidian-settings-group-title')
        if (section.icon) title.append(groupIcon(section.icon))
        title.append(document.createTextNode(t(section.titleKey)))
        container.append(title)
        list.append(container)
        this.renderDefItems(container, defs, focusEntry)
        rendered = true
      }
      if (!rendered) {
        list.append(element('p', SETTINGS_PAGE_CLASS_NAMES.empty, t('settings.empty')))
      }
      return
    }
    list.append(element('h2', 'vsidian-settings-heading', t('settings.editorCategory')),
      element('p', SETTINGS_PAGE_CLASS_NAMES.subtitle, t('settings.editorSubtitle')))
    let rendered = false
    for (const section of this.editorSectionDefs()) {
      const defs = section.defs?.() ?? []
      // 委托组（#264 分词）不由 defs 驱动：条目呈现在组内，恒渲染
      if (!defs.length && !section.group) continue
      const container = element('div', 'vsidian-settings-group')
      // #263/#265 组标题图标：h3 保持 flex + gap 布局（图标置左 padding
      // 缘、文字右移），内联字形和生图资产同占 16px；委托组（#264）走
      // 同一 h3 容器路径，图标随组对象槽位登记，未登记则槽位空缺。
      const title = element('h3', 'vsidian-settings-group-title')
      if (section.icon) title.append(groupIcon(section.icon))
      title.append(document.createTextNode(t(section.titleKey)))
      container.append(title)
      list.append(container)
      if (section.group) {
        // 委托组：内容与组内定位（focusEntry = 组条目 id）由组自行装配；
        // 清理函数收进卸载器集合（重渲染/切页时释放内部 parent 引用；
        // 多委托组并存时逐个收集，不相互覆盖）
        const dispose = section.group.mount(container, focusEntry)
        if (dispose) this.sectionDisposers.push(dispose)
      } else {
        this.renderDefItems(container, defs, focusEntry)
      }
      rendered = true
    }
    if (!rendered) {
      list.append(element('p', SETTINGS_PAGE_CLASS_NAMES.empty, t('settings.empty')))
    }
  }

  /** 设置项行渲染（editor / general 两组共用：标题、说明与控件装配）。
   *  #155 跟进：dependsOn 依赖关闭时控件禁用 + 条目灰化类（注册表驱动，
   *  值不清除；回推同步点 syncControlEnabledState 就地联动） */
  private renderDefItems(list: HTMLElement, defs: readonly SettingDefinition[], focusEntry?: string): void {
    for (const def of defs) {
      const item = element('div', SETTINGS_PAGE_CLASS_NAMES.item)
      const label = element('label', 'vsidian-settings-item-label')
      const text = element('span', 'vsidian-settings-item-copy')
      text.append(element('span', SETTINGS_PAGE_CLASS_NAMES.itemTitle, t(def.titleKey)))
      // #93 控件分流：boolean → 复选开关；string 枚举 → 下拉（enum 顺序即
      // 选项顺序，显示名见 optionLabel 的三级回退）；#161 string 自由文本
      // → text input（enum 有无分型，maxLength 上限随定义）；#175 number →
      // 滑块（range + 值文本，0 档显示词经 zeroLabelKey 取词，注册表驱动）
      let control: HTMLInputElement | HTMLSelectElement
      let rangeReadout: HTMLElement | undefined
      if (def.type === 'string') {
        control = 'enum' in def ? this.buildSelect(def) : this.buildTextInput(def)
      } else if (def.type === 'number') {
        const range = this.buildRange(def)
        control = range.input
        rangeReadout = range.readout
      } else {
        control = this.buildCheckbox(def)
      }
      if (!isSettingEnabled(this.defs, this.values ?? {}, def)) {
        this.setControlDisabled(control, item, true)
      }
      if (def.descriptionKey) {
        const desc = element('span', SETTINGS_PAGE_CLASS_NAMES.itemDescription, t(def.descriptionKey))
        desc.id = `description-${def.key}`
        text.append(desc)
        control.setAttribute('aria-describedby', desc.id)
      }
      control.dataset.settingKey = def.key
      control.setAttribute('aria-label', t(def.titleKey))
      if (rangeReadout) {
        const wrap = element('span', SETTINGS_PAGE_CLASS_NAMES.rangeWrap)
        wrap.append(control, rangeReadout)
        label.append(text, wrap)
      } else {
        label.append(text, control)
      }
      item.append(label)
      list.append(item)
      if (focusEntry === def.key) {
        item.classList.add('vsidian-settings-item-located')
        control.focus()
        item.scrollIntoView?.({ block: 'nearest' })
      }
    }
  }

  /** 依赖禁用态落盘：控件 disabled + 条目灰化类（与否反之） */
  private setControlDisabled(control: HTMLInputElement | HTMLSelectElement, item: Element | null, disabled: boolean): void {
    control.disabled = disabled
    item?.classList.toggle('vsidian-settings-item-disabled', disabled)
  }

  private buildCheckbox(def: BooleanSettingDefinitionLike): HTMLInputElement {
    const box = element('input', SETTINGS_PAGE_CLASS_NAMES.checkbox)
    box.type = 'checkbox'
    box.checked = this.value(def) === true
    box.addEventListener('change', () => {
      if (!this.pending) this.saveFailed = false
      this.pending++
      if (this.status) this.status.textContent = t('settings.saving')
      this.bridge.postMessage({ kind: 'settings.set', values: { [def.key]: box.checked } })
    })
    return box
  }

  /**
   * 枚举选项显示名（#96 三级回退）：optionLabels 静态显示名（语言自名等
   * 不随界面语言变化者）> optionLabelKeys 消息键（经 t() 取词，随当前语言
   * 变化，如语言设置 auto 档「自动 / Auto」）> 枚举原值
   */
  private optionLabel(def: StringEnumSettingDefinitionLike, value: string): string {
    const staticLabel = def.optionLabels?.[value]
    if (staticLabel !== undefined) {
      return staticLabel
    }
    const key = def.optionLabelKeys?.[value]
    return key !== undefined ? t(key) : value
  }

  private buildSelect(def: StringEnumSettingDefinitionLike): HTMLSelectElement {
    const select = element('select', SETTINGS_PAGE_CLASS_NAMES.select)
    const current = String(this.value(def))
    for (const value of def.enum) {
      const option = element('option', '', this.optionLabel(def, value))
      option.value = value
      if (value === current) {
        option.selected = true
      }
      select.append(option)
    }
    select.value = current
    select.addEventListener('change', () => {
      if (!this.pending) this.saveFailed = false
      this.pending++
      if (this.status) this.status.textContent = t('settings.saving')
      this.bridge.postMessage({ kind: 'settings.set', values: { [def.key]: select.value } })
    })
    return select
  }

  /**
   * #161 自由文本控件：text input，值经宿主按定义校验（超长整批拒绝后
   * 以权威快照回显恢复）；change（失焦/回车）时上送，与 checkbox/select
   * 同一保存链路
   */
  private buildTextInput(def: StringTextSettingDefinitionLike): HTMLInputElement {
    const input = element('input', SETTINGS_PAGE_CLASS_NAMES.textInput)
    input.type = 'text'
    input.value = String(this.value(def))
    input.maxLength = def.maxLength
    input.addEventListener('change', () => {
      if (!this.pending) this.saveFailed = false
      this.pending++
      if (this.status) this.status.textContent = t('settings.saving')
      this.bridge.postMessage({ kind: 'settings.set', values: { [def.key]: input.value } })
    })
    return input
  }

  /**
   * #175 number 设置项的滑块控件：range + 值文本（0 档显示词经
   * zeroLabelKey 取词、非 0 值带单位后缀，均来自定义注册表）。拖动中
   * （input）即时刷新值文本与 aria-valuetext；释放（change）才上送
   * settings.set——保存语义与其他控件一致（宿主权威，回推回显）。
   */
  private buildRange(def: NumberSettingDefinitionLike): { input: HTMLInputElement; readout: HTMLElement } {
    const input = element('input', SETTINGS_PAGE_CLASS_NAMES.range)
    input.type = 'range'
    input.min = String(def.min)
    input.max = String(def.max)
    input.step = String(def.step)
    const raw = this.value(def)
    const numeric = typeof raw === 'number' ? raw : def.default
    input.value = String(numeric)
    // 读回吸附后的值做显示（见快照同步处同注释）
    const shown = Number(input.value)
    const readout = element('span', SETTINGS_PAGE_CLASS_NAMES.rangeValue, this.numberValueText(def, shown))
    this.syncRangeDisplay(def, input, shown, readout)
    input.addEventListener('input', () => this.syncRangeDisplay(def, input, Number(input.value), readout))
    input.addEventListener('change', () => {
      if (!this.pending) this.saveFailed = false
      this.pending++
      if (this.status) this.status.textContent = t('settings.saving')
      this.bridge.postMessage({ kind: 'settings.set', values: { [def.key]: Number(input.value) } })
    })
    return { input, readout }
  }

  /** 滑块值显示文本：0 且定义有 zeroLabelKey 时取词（铺满档），否则原值 + 单位后缀 */
  private numberValueText(def: NumberSettingDefinitionLike, value: number): string {
    if (value === 0 && def.zeroLabelKey) {
      return t(def.zeroLabelKey)
    }
    return def.unit ? `${value}${def.unit}` : String(value)
  }

  /** 滑块显示态同步：值文本与 aria-valuetext（快照回推与拖动共用） */
  private syncRangeDisplay(def: NumberSettingDefinitionLike, input: HTMLInputElement, value: number, readout?: HTMLElement): void {
    const text = this.numberValueText(def, value)
    const target = readout ?? input.parentElement?.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.rangeValue}`)
    if (target) target.textContent = text
    input.setAttribute('aria-valuetext', text)
  }
}

/** 渲染层对定义的结构收窄（避免在分流点反复判 type）；string 双形态直接
 *  引用 shared 接口（#161：枚举 / 自由文本按 enum 有无分型） */
type BooleanSettingDefinitionLike = Extract<SettingDefinition, { type: 'boolean' }>
type StringEnumSettingDefinitionLike = StringEnumSettingDefinition
type StringTextSettingDefinitionLike = StringTextSettingDefinition
type NumberSettingDefinitionLike = Extract<SettingDefinition, { type: 'number' }>
