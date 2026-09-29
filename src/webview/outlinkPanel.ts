// 出链面板模块（出链面板批次）：右侧栏「当前笔记中的链接」面板的 DOM
// 构建与四态渲染。装配与反链面板（backlinkPanel.ts）同模式：{toggle,
// panel} 构建器 + 稳定类名常量；事件经容器委托挂 syncController；显隐由
// 侧栏容器的 vsidian-outlinks-active 类经 CSS 控制（与大纲/反链互斥）。
//
// 形态（验收反馈图二）：页头（标题 + 右上浅灰计数）+ 平铺两行条目
// （行 1 = 链形小图标 + 目标显示名；行 2 = 目标路径，悬挂缩进）；断链条目
// 整体弱化且不可点（aria-disabled + broken 类）。四态与反链一致
// （loading / ready 空=「无链接」/ error 含 no-workspace；updating 细条）。
//
// 点击出站 outlink.activate：宿主打开目标并按链接实际锚点定位。
// 文案一律经 bindLocale；不依赖 vscode/CM6（jsdom 单测直驱）。
import { bindLocale, bindLocaleAttrs, bindLocaleFnAttrs } from './localeDom'
import { t } from '../shared/i18n'
import type { OutlinkItemPayload } from '../shared/protocol'
import { createLinksChainIcon } from './backlinkPanel'

/** 出链面板的稳定类名（样式与断言的公共锚点） */
export const OUTLINK_CLASS_NAMES = {
  panel: 'vsidian-outlink-panel',
  /** 侧栏顶栏切换按钮 */
  toggle: 'vsidian-outlinks-toggle',
  /** 页头（标题 + 右对齐计数） */
  pageHeader: 'vsidian-outlink-header',
  pageTitle: 'vsidian-outlink-header-title',
  pageCount: 'vsidian-outlink-header-count',
  /** 条目（目标显示名 + 路径两行；点击跳转） */
  item: 'vsidian-outlink-item',
  /** 行 1：链形小图标 + 目标显示名 */
  itemName: 'vsidian-outlink-item-name',
  /** 行 2：目标路径（弱化次要色；悬挂缩进，换行不回图标下） */
  itemPath: 'vsidian-outlink-item-path',
  /** 断链弱化标记（叠加在 item 上；不可点由 disabled 属性承担） */
  broken: 'vsidian-outlink-broken',
  /** 更新中细条 */
  updating: 'vsidian-outlink-updating',
  /** 状态占位（loading/empty/error 共用容器） */
  placeholder: 'vsidian-outlink-placeholder',
} as const

/** 面板当前快照（最近一次 outlinks.snapshot 的可渲染形态） */
export interface OutlinkPanelSnapshot {
  state: 'loading' | 'ready' | 'error'
  updating: boolean
  reason?: 'no-workspace' | 'read-error'
  items: readonly OutlinkItemPayload[]
}

/** 目标显示路径：根内相对路径去 .md 扩展（目录段保留——同名目标可区分） */
export function outlinkPathLabel(targetRelPath: string): string {
  return targetRelPath.replace(/\.md$/i, '')
}

/** 条目禁用判定（断链不可点；data-* 由渲染侧写入，跳转走快照载荷） */
export function outlinkItemDisabled(item: OutlinkItemPayload): boolean {
  return !item.resolved
}

/**
 * 按四态渲染面板内容（条目 DOM 全量重建；事件由容器委托）。
 * 占位文案按需创建（localeOnDemand 语义）。
 */
export function renderOutlinksState(panel: HTMLElement, snapshot: OutlinkPanelSnapshot): void {
  if (snapshot.state !== 'ready' || snapshot.items.length === 0) {
    const placeholder = document.createElement('div')
    placeholder.className = OUTLINK_CLASS_NAMES.placeholder
    const key =
      snapshot.state === 'loading' ? 'outlinks.loading'
        : snapshot.state === 'error'
          ? snapshot.reason === 'no-workspace' ? 'outlinks.errorNoWorkspace' : 'outlinks.error'
          : 'outlinks.empty'
    bindLocale(placeholder, 'text', key)
    panel.replaceChildren(placeholder)
    return
  }
  const nodes: HTMLElement[] = []
  if (snapshot.updating) {
    const updating = document.createElement('div')
    updating.className = OUTLINK_CLASS_NAMES.updating
    bindLocale(updating, 'text', 'outlinks.updating')
    nodes.push(updating)
  }
  // 页头：「当前笔记中的链接」+ 右上浅灰计数（总条目数）
  const header = document.createElement('div')
  header.className = OUTLINK_CLASS_NAMES.pageHeader
  const title = document.createElement('span')
  title.className = OUTLINK_CLASS_NAMES.pageTitle
  bindLocale(title, 'text', 'outlinks.panelTitle')
  header.appendChild(title)
  const count = document.createElement('span')
  count.className = OUTLINK_CLASS_NAMES.pageCount
  count.textContent = String(snapshot.items.length)
  bindLocaleFnAttrs(count, () => t('outlinks.countLabel', { n: String(snapshot.items.length) }))
  header.appendChild(count)
  nodes.push(header)
  for (const item of snapshot.items) {
    nodes.push(buildOutlinkItem(item))
  }
  panel.replaceChildren(...nodes)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 条目行 1 的链形小图标（16 系单链环，与侧栏图标同机制——线宽归 CSS） */
function createOutlinkItemIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  // 单链环（互锁双环的紧凑 16 形）：斜向胶囊轮廓
  path.setAttribute(
    'd',
    'M6 6.5 4 8.5a2.6 2.6 0 0 0 3.7 3.7l2-2M10 9.5l2-2a2.6 2.6 0 0 0-3.7-3.7l-2 2',
  )
  svg.appendChild(path)
  return svg
}

function buildOutlinkItem(item: OutlinkItemPayload): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = OUTLINK_CLASS_NAMES.item
  el.dataset['vsidianIndex'] = String(item.start)
  const disabled = outlinkItemDisabled(item)
  if (disabled) {
    el.classList.add(OUTLINK_CLASS_NAMES.broken)
    el.setAttribute('aria-disabled', 'true')
    el.disabled = true
  } else {
    el.dataset['vsidianTarget'] = item.targetFsPath ?? ''
    el.dataset['vsidianAnchor'] = item.anchor
    bindLocaleAttrs(el, 'outlinks.jumpTo', { target: item.targetDisplay })
  }
  const nameRow = document.createElement('span')
  nameRow.className = OUTLINK_CLASS_NAMES.itemName
  nameRow.appendChild(createOutlinkItemIcon())
  const nameText = document.createElement('span')
  nameText.textContent = item.targetDisplay
  nameRow.appendChild(nameText)
  el.appendChild(nameRow)
  const pathRow = document.createElement('span')
  pathRow.className = OUTLINK_CLASS_NAMES.itemPath
  pathRow.textContent = item.resolved && item.targetRelPath !== null
    ? outlinkPathLabel(item.targetRelPath)
    : item.targetDisplay
  el.appendChild(pathRow)
  return el
}

/**
 * 出链 DOM（侧栏顶栏按钮 + 面板容器）。显隐唯一开关是侧栏容器的
 * vsidian-outlinks-active 类（CSS 控制）；条目内容经 renderOutlinksState
 * 维护（初始 loading 占位）。
 */
export function buildOutlinksDom(): { toggle: HTMLButtonElement; panel: HTMLElement } {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = OUTLINK_CLASS_NAMES.toggle
  bindLocaleAttrs(toggle, 'outlinks.label')
  toggle.setAttribute('aria-controls', 'vsidian-outlinks-panel')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.appendChild(createLinksChainIcon('out'))
  const panel = document.createElement('div')
  panel.className = OUTLINK_CLASS_NAMES.panel
  panel.id = 'vsidian-outlinks-panel'
  panel.setAttribute('role', 'region')
  bindLocale(panel, 'aria-label', 'outlinks.panelTitle')
  renderOutlinksState(panel, { state: 'loading', updating: false, items: [] })
  return { toggle, panel }
}
