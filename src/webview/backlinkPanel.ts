// 反链面板模块（工单 #197 建立；形态改版批次重做呈现层）：右侧栏「反向
// 链接」面板的 DOM 构建与四态渲染。装配模式照大纲面板先例（outline.ts）：
// 本模块产出 {toggle, panel} 形态的构建器 + 稳定类名常量；事件经容器委托
// 挂在 syncController（条目 DOM 重建不丢监听），显隐由侧栏容器的
// vsidian-backlinks-active 类经 CSS 控制（与大纲/出链面板互斥——同域面板
// 区域同一时刻只显示一个）。
//
// 改版后形态（验收反馈一轮，规格 vault-index-backlinks.md「反链面板形态
// 改版」节）：工具栏（排序下拉/搜索/折叠全部/更多上下文）+ 搜索框（按钮
// 下方全宽）+ 页头（「链接当前文件」+ 卡片计数）+ 按来源分组（组头可折
// 叠）+ 组内白色上下文卡片（命中链接的原始 Markdown 语法整体黄底高亮）。
// 分组/排序/过滤纯逻辑在 backlinkGrouping.ts（单测直驱）；交互状态由
// syncController 持有（BacklinkPanelView），本模块只渲染。
//
// 四态（#194 规格「首版反链」：加载中/无引用/更新中/读取失败）：
// - loading：索引未就绪或首扫中（无数据可显示）
// - ready + items 空：无引用（空态占位）
// - ready + updating：索引重建中（顶部细条提示，当前为旧数据）
// - ready + 过滤后 0 条：无匹配占位（搜索过滤语义，与空态区分）
// - error：读取失败（含索引不可用；无工作区单独文案）
//
// 文案一律经 bindLocale（localeDom 换包单点重刷）；本模块不依赖
// vscode/CM6（jsdom 单测直驱）。
import { bindLocale, bindLocaleAttrs, bindLocaleFnAttrs, refreshElementLocale } from './localeDom'
import { t } from '../shared/i18n'
import type { BacklinkItemPayload } from '../shared/protocol'
import type { MessageKey } from '../shared/locales/en'
import {
  BACKLINK_SORT_MODES,
  groupBacklinks,
  type BacklinkSortMode,
  type BacklinkViewOptions,
} from './backlinkGrouping'

type SortMenuEntry = { mode: BacklinkSortMode; key: MessageKey } | { separator: true }

/** 排序菜单清单（渲染序：文件名组 / 分隔 / 编辑时间组 / 分隔 / 创建时间组） */
export const BACKLINK_SORT_MENU: readonly SortMenuEntry[] = [
  { mode: 'name-asc', key: 'backlinks.sortNameAsc' },
  { mode: 'name-desc', key: 'backlinks.sortNameDesc' },
  { separator: true },
  { mode: 'mtime-desc', key: 'backlinks.sortMtimeDesc' },
  { mode: 'mtime-asc', key: 'backlinks.sortMtimeAsc' },
  { separator: true },
  { mode: 'birth-desc', key: 'backlinks.sortBirthDesc' },
  { mode: 'birth-asc', key: 'backlinks.sortBirthAsc' },
]

/** 反链面板的稳定类名（样式与断言的公共锚点） */
export const BACKLINK_CLASS_NAMES = {
  panel: 'vsidian-backlink-panel',
  /** 侧栏顶栏切换按钮 */
  toggle: 'vsidian-backlinks-toggle',
  /** 工具栏（四按钮横排居中） */
  toolbar: 'vsidian-backlink-toolbar',
  /** 工具栏按钮（data-action 区分：sort/search/collapse/context） */
  toolbarButton: 'vsidian-backlink-toolbar-button',
  /** 排序下拉菜单（面板内 absolute 定位；Esc/外点关闭） */
  sortMenu: 'vsidian-backlink-sort-menu',
  /** 菜单项（role=menuitemradio；aria-checked 表当前排序） */
  sortMenuItem: 'vsidian-backlink-sort-item',
  /** 菜单组间分隔线 */
  sortMenuSeparator: 'vsidian-backlink-sort-sep',
  /** 搜索框容器（四按钮下方、水平占满侧栏宽；显隐唯一开关 hidden 属性） */
  searchBox: 'vsidian-backlink-search-box',
  searchInput: 'vsidian-backlink-search-input',
  /** 页头（标题 + 右对齐计数） */
  pageHeader: 'vsidian-backlink-header',
  pageTitle: 'vsidian-backlink-header-title',
  pageCount: 'vsidian-backlink-header-count',
  /** 来源分组（组头 + 卡片列表） */
  group: 'vsidian-backlink-group',
  /** 组头按钮（chevron + 来源名 + 组内计数；点击折叠/展开该组） */
  groupHeader: 'vsidian-backlink-group-header',
  groupName: 'vsidian-backlink-group-name',
  groupCount: 'vsidian-backlink-group-count',
  chevron: 'vsidian-backlink-chevron',
  /** 折叠组标记（叠加在 group 上；卡片区隐藏由 CSS 该类规则控制） */
  groupCollapsed: 'vsidian-backlink-group-collapsed',
  /** 上下文卡片（每条引用一张；可点击跳转） */
  card: 'vsidian-backlink-card',
  /** 兼容锚点（#197 既有公开类名，与 card 并挂——外部片段与契约兼容） */
  item: 'vsidian-backlink-item',
  /** 卡片正文（命中高亮按区间切分文本包 mark） */
  cardText: 'vsidian-backlink-card-text',
  /** 命中链接的原始 Markdown 语法整体高亮（mark 元素；黄底 CSS 变量） */
  hit: 'vsidian-backlink-hit',
  /** 更新中细条（ready + updating 时的顶部提示） */
  updating: 'vsidian-backlink-updating',
  /** 状态占位（loading/empty/error/nomatch 共用容器；文案随 key 变化） */
  placeholder: 'vsidian-backlink-placeholder',
} as const

/** 面板当前快照（最近一次 backlinks.snapshot 的可渲染形态） */
export interface BacklinkPanelSnapshot {
  state: 'loading' | 'ready' | 'error'
  updating: boolean
  reason?: 'no-workspace' | 'read-error'
  items: readonly BacklinkItemPayload[]
}

/** 面板交互视图状态（syncController 持有；渲染时传入，重建不丢） */
export interface BacklinkPanelView extends BacklinkViewOptions {
  /** 更多上下文（长片段）开态（aria-pressed；切换纯显示层） */
  contextLong: boolean
  /** 搜索框可见性（切换按钮驱动；关闭时清空 query 由控制器负责） */
  searchOpen: boolean
  /** 排序下拉菜单打开态（面板内 absolute 定位；Esc/外点关闭） */
  sortMenuOpen: boolean
}

/** 视图状态缺省值（会话内存即可，不持久化——规格「已知边界」） */
export function defaultBacklinkView(): BacklinkPanelView {
  return {
    sortMode: 'name-asc',
    query: '',
    collapsedGroups: new Set<string>(),
    contextLong: false,
    searchOpen: false,
    sortMenuOpen: false,
  }
}

/** 来源显示名：根内相对路径去 .md 扩展（目录段保留——多目录来源可区分） */
export function backlinkSourceLabel(sourceRelPath: string): string {
  return sourceRelPath.replace(/\.md$/i, '')
}

/** 卡片文本的命中高亮切分（纯函数，单测直驱）：短/长片段文本 + 命中
 *  区间在片段内的相对坐标（区间由全文 [start,end) 减片段起点换算；不相
 *  交或载荷缺省时 hit 为空串——整段无高亮） */
export interface BacklinkCardSegments {
  before: string
  hit: string
  after: string
}

export function backlinkCardSegmentsOf(item: BacklinkItemPayload, contextLong: boolean): BacklinkCardSegments {
  const text = contextLong ? (item.snippetLong ?? item.snippet) : item.snippet
  const textStart = contextLong
    ? (item.snippetLongStart ?? item.snippetStart)
    : item.snippetStart
  if (textStart === undefined) {
    // 旧宿主快照无片段起点：全文区间无法可靠换算到片段内坐标——不高亮
    //（错位高亮比无高亮更糟）
    return { before: text, hit: '', after: '' }
  }
  const from = Math.max(0, Math.min(item.start - textStart, text.length))
  const to = Math.max(from, Math.min(item.end - textStart, text.length))
  if (to <= from) {
    return { before: text, hit: '', after: '' }
  }
  return { before: text.slice(0, from), hit: text.slice(from, to), after: text.slice(to) }
}

/** 占位态取词键（loading/empty/error/nomatch；非占位态为 null） */
function placeholderKeyOf(snapshot: BacklinkPanelSnapshot, matchedCount: number, query: string): MessageKey | null {
  if (snapshot.state === 'loading') {
    return 'backlinks.loading'
  }
  if (snapshot.state === 'error') {
    return snapshot.reason === 'no-workspace' ? 'backlinks.errorNoWorkspace' : 'backlinks.error'
  }
  if (snapshot.items.length === 0) {
    return 'backlinks.empty'
  }
  if (matchedCount === 0 && query.trim() !== '') {
    return 'backlinks.searchNoMatch'
  }
  return null
}

/**
 * 按四态渲染面板内容。**固定区复用 + 动态区重建**：updating 细条 / 工具
 * 栏 / 搜索框是面板常驻骨架（复用 DOM 节点只更新状态——搜索输入触发的
 * 重渲染不重建 input，输入焦点与光标不丢）；排序菜单 / 页头 / 分组列表
 * （或占位）为动态区，每次全量重建。事件由容器委托，重建不丢监听；占位
 * 文案按需创建（localeOnDemand 语义：重建时取当前语言包）。
 */
export function renderBacklinksState(
  panel: HTMLElement,
  snapshot: BacklinkPanelSnapshot,
  view: BacklinkPanelView,
): void {
  const grouped = groupBacklinks(snapshot.items, view)
  const placeholderKey = placeholderKeyOf(snapshot, grouped.matchedCount, view.query)

  // ---- 固定区（常驻骨架，无条件建立并复用；文档序：updating 细条 →
  //      工具栏 → 搜索框。loading/error/空文档也保留骨架——面板结构恒定，
  //      探针与用户预期不随数据态漂移；占位在动态区呈现） ----
  let updating = panel.querySelector<HTMLElement>(`:scope > .${BACKLINK_CLASS_NAMES.updating}`)
  if (snapshot.updating && !updating) {
    updating = document.createElement('div')
    updating.className = BACKLINK_CLASS_NAMES.updating
    bindLocale(updating, 'text', 'backlinks.updating')
    panel.prepend(updating)
  } else if (!snapshot.updating && updating) {
    updating.remove()
    updating = null
  }

  let toolbar = panel.querySelector<HTMLElement>(`:scope > .${BACKLINK_CLASS_NAMES.toolbar}`)
  if (!toolbar) {
    toolbar = document.createElement('div')
    toolbar.className = BACKLINK_CLASS_NAMES.toolbar
    toolbar.setAttribute('role', 'toolbar')
    bindLocale(toolbar, 'aria-label', 'backlinks.toolbarLabel')
    toolbar.appendChild(buildToolbarButton('sort', 'backlinks.sortBy'))
    toolbar.appendChild(buildToolbarButton('search', 'backlinks.search'))
    toolbar.appendChild(buildToolbarButton('collapse', 'backlinks.collapseAll'))
    toolbar.appendChild(buildToolbarButton('context', 'backlinks.moreContext'))
    panel.appendChild(toolbar)
  }
  const allCollapsed = grouped.groups.length > 0
    && grouped.groups.every((g) => view.collapsedGroups.has(g.key))
  updateToolbarButtonState(toolbar, 'sort', 'expanded', view.sortMenuOpen)
  updateToolbarButtonState(toolbar, 'search', 'pressed', view.searchOpen)
  updateToolbarButtonState(toolbar, 'collapse', 'pressed', allCollapsed)
  updateToolbarButtonState(toolbar, 'context', 'pressed', view.contextLong)

  let searchBox = panel.querySelector<HTMLElement>(`:scope > .${BACKLINK_CLASS_NAMES.searchBox}`)
  if (!searchBox) {
    searchBox = document.createElement('div')
    searchBox.className = BACKLINK_CLASS_NAMES.searchBox
    const searchInput = document.createElement('input')
    searchInput.type = 'search'
    searchInput.className = BACKLINK_CLASS_NAMES.searchInput
    bindLocale(searchInput, 'placeholder', 'backlinks.searchPlaceholder')
    bindLocale(searchInput, 'aria-label', 'backlinks.searchPlaceholder')
    searchBox.appendChild(searchInput)
    panel.appendChild(searchBox)
  }
  searchBox.hidden = !view.searchOpen
  const searchInput = searchBox.querySelector<HTMLInputElement>(`input.${BACKLINK_CLASS_NAMES.searchInput}`)
  if (searchInput && searchInput.value !== view.query) {
    // 仅在值漂移时回写（外部状态变化；用户键入路径的值来自 input 事件，
    // 相等不写——不重置光标）
    searchInput.value = view.query
  }

  // ---- 动态区（固定区之外全部重建：菜单 / 页头 / 分组列表 / 占位） ----
  for (const child of [...panel.children]) {
    if (child !== updating && child !== toolbar && child !== searchBox) {
      child.remove()
    }
  }
  const dynamic: HTMLElement[] = []

  // 排序下拉菜单（打开时渲染在固定区之下；面板内 absolute 定位由 CSS）
  if (view.sortMenuOpen) {
    dynamic.push(buildSortMenu(view.sortMode))
  }

  // 页头：「链接当前文件」+ 右对齐卡片计数（占位态不渲染——无数据可计）
  if (snapshot.state === 'ready' && snapshot.items.length > 0) {
    const header = document.createElement('div')
    header.className = BACKLINK_CLASS_NAMES.pageHeader
    const title = document.createElement('span')
    title.className = BACKLINK_CLASS_NAMES.pageTitle
    bindLocale(title, 'text', 'backlinks.panelTitle')
    header.appendChild(title)
    const count = document.createElement('span')
    count.className = BACKLINK_CLASS_NAMES.pageCount
    count.textContent = String(grouped.matchedCount)
    bindLocaleFnAttrs(count, () => t('backlinks.countLabel', { n: count.textContent ?? '0' }))
    header.appendChild(count)
    dynamic.push(header)
  }

  if (placeholderKey !== null) {
    // loading / error / 空文档 / 无匹配：占位在动态区（骨架常驻）
    dynamic.push(buildPlaceholder(placeholderKey))
    panel.append(...dynamic)
    return
  }

  // 分组列表（组头可折叠；组内卡片为宿主稳定序）
  for (const group of grouped.groups) {
    const groupEl = document.createElement('div')
    groupEl.className = BACKLINK_CLASS_NAMES.group
    groupEl.dataset['vsidianSource'] = group.key
    const collapsed = view.collapsedGroups.has(group.key)
    if (collapsed) {
      groupEl.classList.add(BACKLINK_CLASS_NAMES.groupCollapsed)
    }
    const headerBtn = document.createElement('button')
    headerBtn.type = 'button'
    headerBtn.className = BACKLINK_CLASS_NAMES.groupHeader
    headerBtn.dataset['vsidianSource'] = group.key
    headerBtn.setAttribute('aria-expanded', String(!collapsed))
    const chevron = document.createElement('span')
    chevron.className = BACKLINK_CLASS_NAMES.chevron
    chevron.setAttribute('aria-hidden', 'true')
    headerBtn.appendChild(chevron)
    const name = document.createElement('span')
    name.className = BACKLINK_CLASS_NAMES.groupName
    name.textContent = group.label
    headerBtn.appendChild(name)
    const groupCount = document.createElement('span')
    groupCount.className = BACKLINK_CLASS_NAMES.groupCount
    groupCount.textContent = String(group.items.length)
    bindLocaleFnAttrs(groupCount, () => t('backlinks.groupCount', { n: groupCount.textContent ?? '0' }))
    headerBtn.appendChild(groupCount)
    groupEl.appendChild(headerBtn)
    for (const item of group.items) {
      groupEl.appendChild(buildCard(item, view))
    }
    dynamic.push(groupEl)
  }
  panel.append(...dynamic)
}

// ---- 构件 ----

function buildPlaceholder(key: MessageKey): HTMLElement {
  const placeholder = document.createElement('div')
  placeholder.className = BACKLINK_CLASS_NAMES.placeholder
  bindLocale(placeholder, 'text', key)
  return placeholder
}

/** 固定区按钮的当前态属性更新（复用节点不重建；collapse 的动态词经
 *  refreshElementLocale 按 aria-pressed 重算） */
function updateToolbarButtonState(
  toolbar: HTMLElement,
  action: 'sort' | 'search' | 'collapse' | 'context',
  kind: 'expanded' | 'pressed',
  value: boolean,
): void {
  const button = toolbar.querySelector<HTMLElement>(`button[data-action="${action}"]`)
  if (!button) {
    return
  }
  button.setAttribute(`aria-${kind}`, String(value))
  refreshElementLocale(button)
}

function buildToolbarButton(action: 'sort' | 'search' | 'collapse' | 'context', key: MessageKey): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = BACKLINK_CLASS_NAMES.toolbarButton
  button.dataset['action'] = action
  if (action === 'sort') {
    // 排序：开下拉菜单（aria-expanded 表菜单开态）
    button.setAttribute('aria-expanded', 'false')
    bindLocaleAttrs(button, key)
  } else if (action === 'collapse') {
    // 折叠全部：二态切换（aria-pressed = 当前处于全部折叠）；动作词随态
    //（回调读按钮自身属性——复用节点上换包/换态重算都取当前值）
    button.setAttribute('aria-pressed', 'false')
    bindLocaleFnAttrs(button, () =>
      t(button.getAttribute('aria-pressed') === 'true' ? 'backlinks.expandAll' : 'backlinks.collapseAll'))
  } else {
    // 搜索框可见性 / 更多上下文长短片段：aria-pressed 表开态
    button.setAttribute('aria-pressed', 'false')
    bindLocaleAttrs(button, key)
  }
  button.appendChild(buildToolbarIcon(action))
  return button
}

function buildSortMenu(current: BacklinkSortMode): HTMLElement {
  const menu = document.createElement('div')
  menu.className = BACKLINK_CLASS_NAMES.sortMenu
  menu.setAttribute('role', 'menu')
  bindLocale(menu, 'aria-label', 'backlinks.sortBy')
  for (const entry of BACKLINK_SORT_MENU) {
    if ('separator' in entry) {
      const sep = document.createElement('div')
      sep.className = BACKLINK_CLASS_NAMES.sortMenuSeparator
      sep.setAttribute('role', 'separator')
      menu.appendChild(sep)
      continue
    }
    const item = document.createElement('button')
    item.type = 'button'
    item.className = BACKLINK_CLASS_NAMES.sortMenuItem
    item.setAttribute('role', 'menuitemradio')
    item.dataset['vsidianSort'] = entry.mode
    item.setAttribute('aria-checked', String(entry.mode === current))
    // 可见文字（对勾由 CSS ::before 承担）：按钮无其他子节点，text 目标
    // 的 textContent 整写不吞元素；bindLocale 保证换包重刷
    bindLocale(item, 'text', entry.key)
    bindLocaleAttrs(item, entry.key)
    menu.appendChild(item)
  }
  return menu
}

function buildCard(item: BacklinkItemPayload, view: BacklinkPanelView): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  // card 为主类；item 为 #197 既有公开类名（并行保留——契约与外部片段锚点）
  el.className = `${BACKLINK_CLASS_NAMES.card} ${BACKLINK_CLASS_NAMES.item}`
  el.dataset['vsidianSource'] = item.sourceRelPath
  el.dataset['vsidianOffset'] = String(item.start)
  bindLocaleAttrs(el, 'backlinks.jumpTo', {
    file: backlinkSourceLabel(item.sourceRelPath),
    n: String(item.line),
  })
  const text = document.createElement('span')
  text.className = BACKLINK_CLASS_NAMES.cardText
  const segments = backlinkCardSegmentsOf(item, view.contextLong)
  text.appendChild(document.createTextNode(segments.before))
  if (segments.hit !== '') {
    const mark = document.createElement('mark')
    mark.className = BACKLINK_CLASS_NAMES.hit
    mark.textContent = segments.hit
    text.appendChild(mark)
  }
  text.appendChild(document.createTextNode(segments.after))
  el.appendChild(text)
  return el
}

/** 出链排序菜单项有效性守卫（容器委托用） */
export function isBacklinkSortMode(v: string): v is BacklinkSortMode {
  return (BACKLINK_SORT_MODES as readonly string[]).includes(v)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * 侧栏链环图标（24 系：两枚互锁胶囊环（织结断口）+ 独立小箭头）。variant
 * 'in' = 反链（镞朝左，折返意象）/ 'out' = 出链（镞朝右）。线宽不写在 SVG
 * 属性上（与侧栏图标同机制），由 CSS 契约钉住（main.css 的 stroke-width
 * 规则 + 契约测试）；状态色由 currentColor 承担。
 */
export function createLinksChainIcon(variant: 'in' | 'out'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  // 链主体（织结双环：右上环与左下环各在交叉处断口——互锁造型）。
  // 验收微调（二轮 0.95→0.85）：链主体与箭头各绕自身几何中心缩放、位置
  // 不动——0.95 时箭头与链环仍显贴靠，0.85 拉开间隙
  appendScaledPathGroup(svg, [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ], 12, 12, 0.85)
  // 箭头（与链环留间隙的独立小箭头；反链朝左折返 / 出链朝右出）
  appendScaledPathGroup(svg, [
    variant === 'in' ? 'M22 18h-7' : 'M14 18h7',
    variant === 'in' ? 'M18 15l-3 3 3 3' : 'M18 15l3 3-3 3',
  ], 18.5, 18, 0.85)
  return svg
}

/** 缩放路径组：绕 (cx, cy) 缩放（translate·scale·translate），描边属性自
 * svg 继承；组内 stroke 随 transform 同步缩放（缩小即变细，属尺寸语义） */
function appendScaledPathGroup(
  svg: SVGSVGElement,
  ds: readonly string[],
  cx: number,
  cy: number,
  scale = 0.85,
): void {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('transform', `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`)
  for (const d of ds) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    g.appendChild(path)
  }
  svg.appendChild(g)
}

/** 反链按钮图标（链环 + 左折返箭头） */
function createBacklinksIcon(): SVGSVGElement {
  return createLinksChainIcon('in')
}

/** 工具栏四小图标（16 系；线宽由 CSS） */
function buildToolbarIcon(action: 'sort' | 'search' | 'collapse' | 'context'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  // sort：左竖箭头 ↑ + 右三条向下递增横线；search：放大镜；
  // collapse：三条满宽横线每条左带小方点；context：竖向双头箭头 ↕
  path.setAttribute(
    'd',
    action === 'sort'
      ? 'M4 2v11M1.8 11l2.2 2.2L6.2 11M9 5h4M9 8.5h5M9 12h6'
      : action === 'search'
        ? 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2M10.8 10.8L15 15'
        : action === 'collapse'
          ? 'M1.5 4h2.5M5.5 4h9M1.5 8h2.5M5.5 8h9M1.5 12h2.5M5.5 12h9'
          : 'M8 2v12M5.5 4.5L8 2l2.5 2.5M5.5 11.5L8 14l2.5-2.5',
  )
  svg.appendChild(path)
  return svg
}

/** 空态文案取词（测试与断言辅助；不经 DOM） */
export function backlinkPlaceholderTextOf(snapshot: BacklinkPanelSnapshot): string {
  const key =
    snapshot.state === 'loading' ? 'backlinks.loading'
      : snapshot.state === 'error'
        ? snapshot.reason === 'no-workspace' ? 'backlinks.errorNoWorkspace' : 'backlinks.error'
        : 'backlinks.empty'
  return t(key)
}

/**
 * 反链 DOM（侧栏顶栏按钮 + 面板容器）。显隐唯一开关是侧栏容器的
 * vsidian-backlinks-active 类（CSS 控制），DOM 上不内联样式；条目内容经
 * renderBacklinksState 维护（初始为 loading 占位——面板打开即有内容语义）。
 */
export function buildBacklinksDom(): { toggle: HTMLButtonElement; panel: HTMLElement } {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = BACKLINK_CLASS_NAMES.toggle
  bindLocaleAttrs(toggle, 'backlinks.label')
  toggle.setAttribute('aria-controls', 'vsidian-backlinks-panel')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.appendChild(createBacklinksIcon())
  const panel = document.createElement('div')
  panel.className = BACKLINK_CLASS_NAMES.panel
  panel.id = 'vsidian-backlinks-panel'
  panel.setAttribute('role', 'region')
  bindLocale(panel, 'aria-label', 'backlinks.panelTitle')
  renderBacklinksState(panel, { state: 'loading', updating: false, items: [] }, defaultBacklinkView())
  return { toggle, panel }
}
