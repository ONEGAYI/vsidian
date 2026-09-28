// 反链面板模块（工单 #197）：右侧栏「反向链接」面板的 DOM 构建与四态
// 渲染。装配模式照大纲面板先例（outline.ts）：本模块产出 {toggle, panel}
// 形态的构建器 + 稳定类名常量；事件经容器委托挂在 syncController（条目
// DOM 重建不丢监听），显隐由侧栏容器的 vsidian-backlinks-active 类经
// CSS 控制（与大纲面板互斥——同域面板区域同一时刻只显示一个）。
//
// 四态（#194 规格「首版反链」：加载中/无引用/更新中/读取失败）：
// - loading：索引未就绪或首扫中（无数据可显示）
// - ready + items 空：无引用（空态占位）
// - ready + updating：索引重建中（顶部细条提示，当前为旧数据）
// - error：读取失败（含索引不可用；无工作区单独文案）
//
// 文案一律经 bindLocale（localeDom 换包单点重刷）；本模块不依赖
// vscode/CM6（jsdom 单测直驱）。
import { bindLocale, bindLocaleAttrs } from './localeDom'
import { t } from '../shared/i18n'
import type { BacklinkItemPayload } from '../shared/protocol'

/** 反链面板的稳定类名（样式与断言的公共锚点） */
export const BACKLINK_CLASS_NAMES = {
  panel: 'vsidian-backlink-panel',
  /** 条目（来源 + 片段；点击跳转） */
  item: 'vsidian-backlink-item',
  /** 条目来源行（文件名:行号） */
  itemSource: 'vsidian-backlink-item-source',
  /** 条目片段行（引用行文本，宿主已截断） */
  itemSnippet: 'vsidian-backlink-item-snippet',
  /** 更新中细条（ready + updating 时的顶部提示） */
  updating: 'vsidian-backlink-updating',
  /** 状态占位（loading/empty/error 共用容器；具体文案随 key 变化） */
  placeholder: 'vsidian-backlink-placeholder',
} as const

/** 面板当前快照（最近一次 backlinks.snapshot 的可渲染形态） */
export interface BacklinkPanelSnapshot {
  state: 'loading' | 'ready' | 'error'
  updating: boolean
  reason?: 'no-workspace' | 'read-error'
  items: readonly BacklinkItemPayload[]
}

/** 来源显示名：根内相对路径去 .md 扩展（目录段保留——多目录来源可区分） */
export function backlinkSourceLabel(sourceRelPath: string): string {
  return sourceRelPath.replace(/\.md$/i, '')
}

/**
 * 按四态渲染面板内容（条目 DOM 全量重建；事件由容器委托，重建不丢监听）。
 * 占位文案按需创建（localeOnDemand 语义：重建时取当前语言包）。
 */
export function renderBacklinksState(panel: HTMLElement, snapshot: BacklinkPanelSnapshot): void {
  if (snapshot.state !== 'ready' || snapshot.items.length === 0) {
    const placeholder = document.createElement('div')
    placeholder.className = BACKLINK_CLASS_NAMES.placeholder
    const key =
      snapshot.state === 'loading' ? 'backlinks.loading'
        : snapshot.state === 'error'
          ? snapshot.reason === 'no-workspace' ? 'backlinks.errorNoWorkspace' : 'backlinks.error'
          : 'backlinks.empty'
    bindLocale(placeholder, 'text', key)
    panel.replaceChildren(placeholder)
    return
  }
  const nodes: HTMLElement[] = []
  if (snapshot.updating) {
    const updating = document.createElement('div')
    updating.className = BACKLINK_CLASS_NAMES.updating
    bindLocale(updating, 'text', 'backlinks.updating')
    nodes.push(updating)
  }
  for (const item of snapshot.items) {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = BACKLINK_CLASS_NAMES.item
    el.dataset['vsidianSource'] = item.sourceRelPath
    el.dataset['vsidianOffset'] = String(item.start)
    bindLocaleAttrs(el, 'backlinks.jumpTo', {
      file: backlinkSourceLabel(item.sourceRelPath),
      n: String(item.line),
    })
    const source = document.createElement('span')
    source.className = BACKLINK_CLASS_NAMES.itemSource
    source.textContent = `${backlinkSourceLabel(item.sourceRelPath)}:${item.line}`
    el.appendChild(source)
    const snippet = document.createElement('span')
    snippet.className = BACKLINK_CLASS_NAMES.itemSnippet
    snippet.textContent = item.snippet
    el.appendChild(snippet)
    nodes.push(el)
  }
  panel.replaceChildren(...nodes)
}

/** 当前占位态的 locale 键（probe 与断言辅助；非占位态为 null） */
export function backlinkPlaceholderKeyOf(snapshot: BacklinkPanelSnapshot): string | null {
  if (snapshot.state === 'ready') {
    return snapshot.items.length === 0 ? 'backlinks.empty' : null
  }
  if (snapshot.state === 'loading') {
    return 'backlinks.loading'
  }
  return snapshot.reason === 'no-workspace' ? 'backlinks.errorNoWorkspace' : 'backlinks.error'
}

/**
 * 反链 DOM（侧栏顶栏按钮 + 面板容器）。显隐唯一开关是侧栏容器的
 * vsidian-backlinks-active 类（CSS 控制），DOM 上不内联样式；条目内容经
 * renderBacklinksState 维护（初始为 loading 占位——面板打开即有内容语义）。
 */
export function buildBacklinksDom(): { toggle: HTMLButtonElement; panel: HTMLElement } {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'vsidian-backlinks-toggle'
  bindLocaleAttrs(toggle, 'backlinks.label')
  toggle.setAttribute('aria-controls', 'vsidian-backlinks-panel')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.appendChild(createBacklinksIcon())
  const panel = document.createElement('div')
  panel.className = BACKLINK_CLASS_NAMES.panel
  panel.id = 'vsidian-backlinks-panel'
  panel.setAttribute('role', 'region')
  bindLocale(panel, 'aria-label', 'backlinks.label')
  renderBacklinksState(panel, { state: 'loading', updating: false, items: [] })
  return { toggle, panel }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 反链按钮图标（左指回环箭头意象——「谁引用了我」；线宽不写在 SVG 属性
 *  上，样式失效时由 CSS 契约与集成绘制断言暴露，与侧栏图标同口径） */
function createBacklinksIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'M6.5 3 H12 a1.5 1.5 0 0 1 1.5 1.5 v7 a1.5 1.5 0 0 1 -1.5 1.5 H6.5 M8 8 H1.5 M4 5 L1 8 L4 11')
  svg.appendChild(path)
  return svg
}

/** 空态文案取词（测试与断言辅助；不经 DOM） */
export function backlinkPlaceholderTextOf(snapshot: BacklinkPanelSnapshot): string {
  const key = backlinkPlaceholderKeyOf(snapshot)
  return key === null ? '' : t(key)
}
