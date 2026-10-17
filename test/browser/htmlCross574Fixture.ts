// 交叉场景收口装配（#574/T09）：生产 webview 控制器单装配承载四类交叉
// 链路——查找面板定位命中 HTML 源码范围（真实 Ctrl+F）、标题折叠对含
// HTML 块区间的隐藏/落点展开恢复（真实键盘折叠 + view.locate 落点）、
// 悬停浮层内 HTML 块渲染与隔离（真实悬停 + hover.result 注入）、块级
// HTML 源文内的真实 IME 组合定稿（CDP）。观测口径沿用 liveHtml /
// headingFoldReveal / hoverPreview 各 fixture 先例，不新增生产私有路径。
import 'katex/dist/katex.min.css'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost, HostToWebview } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { headingFoldField } from '../../src/webview/headingFold'
import { selectionTouchesRange } from '../../src/webview/liveDecorations'
import '../../src/webview/main.css'

bootLocaleFromDocument()

const sent: WebviewToHost[] = []
const bridge: VsCodeBridge = {
  postMessage(message) {
    sent.push(message as WebviewToHost)
  },
  getState() {
    return undefined
  },
  setState() {},
}
const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

const DOC_URI = 'file:///d%3A/notes/html-cross-574.md'

function mainView(): EditorView | null {
  const el = document.querySelector('.cm-editor')
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
}

Object.assign(window, {
  /** 装载主文档（Live 起步） */
  initCrossDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'html-cross-574', docUri: DOC_URI, version: 1, text,
    })
  },
  /** 宿主消息注入（hover.result 等——真实 handleHostMessage 同入口） */
  respondCross(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 落点定位（锚点/搜索/链接跳转的共同汇聚通道） */
  crossLocate(offset: number, head?: number) {
    controller.handleHostMessage(head === undefined
      ? { kind: 'view.locate', offset }
      : { kind: 'view.locate', offset, head })
  },
  /** 切正文模式（悬停场景走 Reading——wikilink 渲染不依赖 catalog 注入） */
  crossSetMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 出站消息快照（hover.request / edit.request 观测） */
  crossSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 出站编辑类消息计数（零写回断言） */
  crossEditCount(): number {
    return sent.filter((m) => m.kind === 'edit.request').length
  },
  /** 焦点进编辑器 */
  crossFocus() {
    mainView()?.focus()
  },
  /** 当前选区快照 */
  crossSelection(): Array<{ anchor: number; head: number }> {
    const view = mainView()
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  /** 文档全文 */
  crossDocText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  /** 折叠键集快照（headingFoldField 生效值——headingFoldReveal 同款） */
  crossFoldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  /** 块级 HTML 宿主观测（liveHtml 同款口径的裁剪版） */
  readCrossHtmls() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-live-html'))
    return els.map((host) => {
      const rect = host.getBoundingClientRect()
      const cell = host.querySelector<HTMLElement>('td, th')
      const cellRect = cell?.getBoundingClientRect()
      const hit = cellRect && cellRect.width > 0 && cellRect.height > 0
        ? document.elementFromPoint(cellRect.left + cellRect.width / 2, cellRect.top + cellRect.height / 2)
        : null
      return {
        from: Number(host.dataset['vsidianHtmlFrom']),
        to: Number(host.dataset['vsidianHtmlTo']),
        hostHeight: rect.height,
        tablePresent: host.querySelector('table') !== null,
        mergedCell: host.querySelector('td[colspan], td[rowspan]') !== null,
        scriptCount: host.querySelectorAll('script').length,
        hitInside: hit !== null && host.contains(hit),
        text: (host.textContent ?? '').trim(),
      }
    })
  },
  /** 行内 HTML 宿主（liveInlineHtml 同款口径的裁剪版） */
  readCrossInlineHtmls() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-live-inline-html'))
    return els.map((host) => ({
      from: Number(host.dataset['vsidianHtmlFrom']),
      to: Number(host.dataset['vsidianHtmlTo']),
      hostHeight: host.getBoundingClientRect().height,
      text: (host.textContent ?? '').trim(),
      color: host.querySelector<HTMLElement>('[style*="color"]') !== null,
    }))
  },
  /** 块级显隐（selectionTouchesRange 派生——StateField 层） */
  crossHtmlRevealed(from: number, to: number): boolean {
    const state = mainView()?.state
    if (!state) {
      return false
    }
    return selectionTouchesRange(state.selection, from, to)
  },
  /** 悬停浮层 HTML 观测（hoverPreview 同入口观测的裁剪版） */
  readCrossHoverPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const cell = el.querySelector<HTMLElement>('.vsidian-reading-block td[colspan]')
    return {
      open: true as const,
      tableRows: el.querySelectorAll('.vsidian-reading-block table tbody tr').length,
      mergedCellPresent: cell !== null,
      mergedCellColor: cell ? getComputedStyle(cell).color : null,
      docScope: el.querySelector<HTMLElement>('[data-vsidian-doc-scope]')?.dataset['vsidianDocScope'] ?? null,
      scriptCount: el.querySelectorAll('script').length,
      evilRan: (window as unknown as { __crossHoverEvil?: boolean }).__crossHoverEvil === true,
    }
  },
  controller,
})
