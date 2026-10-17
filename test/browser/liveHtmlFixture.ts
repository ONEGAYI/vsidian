// 块级原生 HTML 的浏览器回归装配（#567/T02）：装配生产 webview 控制器，
// Live 视图以 CM6 片段替换装饰渲染净化 HTML（悬停边框 + 编辑按钮）、
// 普通点击/编辑按钮选中完整源码、方向键与跨块选区显隐、多选区不坍缩、
// 纯 <style> 块常显、畸形边界与净化负向、阅读态渲染与零写回在真实布局
// （Chromium）验证。宿主回包经 fixture 内伪造通道注入（真实
// handleHostMessage 同入口）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { liveHtmlSpansField } from '../../src/webview/liveHtml'
import { selectionTouchesRange } from '../../src/webview/liveDecorations'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（零写回断言的 edit.request 计数） */
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
controller.mount(document.getElementById('app')!, [
  keymap.of(defaultKeymap),
  EditorState.allowMultipleSelections.of(true),
])

const DOC_URI = 'file:///d%3A/notes/html-doc.md'

/** 公开取 view（不触控制器私有成员——liveEmbedFixture 同款先例） */
function liveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 装载文档（Live 起步） */
  initLiveHtmlDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'live-html-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式 */
  setLiveHtmlMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 已出站消息快照（edit.request 计数断言） */
  liveHtmlSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 光标设置（纯选区事务零写回） */
  setLiveHtmlCursor(pos: number) {
    liveView()?.dispatch({ selection: { anchor: pos } })
  },
  /** 多选区设置 */
  setLiveHtmlRanges(positions: Array<[number, number]>) {
    const view = liveView()
    if (!view) {
      return
    }
    view.dispatch({
      selection: EditorSelection.create(
        positions.map(([a, b]) => EditorSelection.range(a, b)),
        positions.length - 1,
      ),
    })
  },
  /** 当前选区快照（主位与全部 range） */
  liveHtmlSelection(): Array<{ anchor: number; head: number }> {
    const view = liveView()
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  /** 文档全文 */
  liveHtmlDocText(): string {
    return liveView()?.state.doc.toString() ?? ''
  },
  /** 焦点进编辑器 */
  focusLiveHtml() {
    liveView()?.focus()
  },
  /** Live HTML 宿主观测（绘制层） */
  readLiveHtmls() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-live-html'))
    return els.map((host) => {
      const rect = host.getBoundingClientRect()
      const style = getComputedStyle(host)
      const cell = host.querySelector<HTMLElement>('td, th')
      const cellRect = cell?.getBoundingClientRect()
      const hit = cellRect && cellRect.width > 0 && cellRect.height > 0
        ? document.elementFromPoint(cellRect.left + cellRect.width / 2, cellRect.top + cellRect.height / 2)
        : null
      return {
        from: Number(host.dataset['vsidianHtmlFrom']),
        to: Number(host.dataset['vsidianHtmlTo']),
        hostHeight: rect.height,
        borderRadius: style.borderRadius,
        position: style.position,
        outlineColor: style.outlineColor,
        tablePresent: host.querySelector('table') !== null,
        mergedCell: host.querySelector('td[colspan], td[rowspan]') !== null,
        editButton: host.querySelector('.vsidian-graphic-chrome-edit') !== null,
        popupButton: host.querySelector('.vsidian-graphic-chrome-popup') !== null,
        scriptCount: host.querySelectorAll('script').length,
        forgedAnchor: host.querySelector('[data-vsidian-src-start]') !== null,
        tooltip: host.getAttribute('data-tooltip') ?? '',
        /** 绘制层证据：合并格中心命中落在宿主内（真实接收指针） */
        hitInside: hit !== null && host.contains(hit),
        text: (host.textContent ?? '').trim(),
      }
    })
  },
  /** 阅读态 HTML 块观测（绘制层） */
  readReadingHtmls() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-reading-html'))
    return els.map((el) => {
      const rect = el.getBoundingClientRect()
      const cell = el.querySelector<HTMLElement>('td, th')
      const cellRect = cell?.getBoundingClientRect()
      const hit = cellRect && cellRect.width > 0 && cellRect.height > 0
        ? document.elementFromPoint(cellRect.left + cellRect.width / 2, cellRect.top + cellRect.height / 2)
        : null
      return {
        height: rect.height,
        tablePresent: el.querySelector('table') !== null,
        mergedCell: el.querySelector('td[colspan], td[rowspan]') !== null,
        scriptCount: el.querySelectorAll('script').length,
        display: getComputedStyle(el).display,
        docScope: el.dataset['vsidianDocScope'] ?? null,
        hitInside: hit !== null && el.contains(hit),
        text: (el.textContent ?? '').trim(),
      }
    })
  },
  /** 块表计数与显隐（StateField 层） */
  liveHtmlSpanInfo(): Array<{ from: number; to: number; revealed: boolean }> {
    const state = liveView()?.state
    const spans = state?.field(liveHtmlSpansField, false)
    if (!state || !spans) {
      return []
    }
    return spans.map((s) => ({
      from: s.from,
      to: s.to,
      revealed: selectionTouchesRange(state.selection, s.from, s.to),
    }))
  },
  /** 源文行级绘制判据（隐形态整行被 widget 替换后行 textContent 为渲染
   *  内容；显形态行文本全等命中且有文本盒子）——liveEmbed 同款口径 */
  liveHtmlLinePainted(lineText: string): boolean {
    const wanted = lineText.trim()
    for (const line of Array.from(document.querySelectorAll<HTMLElement>('.cm-content .cm-line'))) {
      if ((line.textContent ?? '').trim() !== wanted) {
        continue
      }
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let node: Node | null = null
      while ((node = walker.nextNode()) !== null) {
        const range = document.createRange()
        range.selectNodeContents(node)
        if (range.getClientRects().length > 0) {
          return true
        }
      }
    }
    return false
  },
  controller,
})
