// 行内原生 HTML 的浏览器回归装配（#568/T03）：装配生产 webview 控制器，
// Live 视图以行内 inline replace 装饰渲染净化 HTML（span 内联颜色 / br
// 换行，前后正文同行流不断行）、普通点击选中完整源码、方向键落点、双向
// 跨片段选区、兄弟片段独立显隐、嵌套最外层、多选区、IME 组合、编辑与
// 粘贴生产链路、阅读态原位渲染与零写回在真实布局（Chromium）验证。宿主
// 回包经 fixture 内伪造通道注入（真实 handleHostMessage 同入口）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { liveInlineHtmlSpansField } from '../../src/webview/liveInlineHtml'
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

const DOC_URI = 'file:///d%3A/notes/inline-html-doc.md'

/** 公开取 view（不触控制器私有成员——liveHtmlFixture 同款先例） */
function liveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 装载文档（Live 起步） */
  initInlineHtmlDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'inline-html-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式 */
  setInlineHtmlMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 已出站消息快照（edit.request 计数断言） */
  inlineHtmlSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 光标设置（纯选区事务零写回） */
  setInlineHtmlCursor(pos: number) {
    liveView()?.dispatch({ selection: { anchor: pos } })
  },
  /** 多选区设置 */
  setInlineHtmlRanges(positions: Array<[number, number]>) {
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
  inlineHtmlSelection(): Array<{ anchor: number; head: number }> {
    const view = liveView()
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  /** 文档全文 */
  inlineHtmlDocText(): string {
    return liveView()?.state.doc.toString() ?? ''
  },
  /** 焦点进编辑器 */
  focusInlineHtml() {
    liveView()?.focus()
  },
  /** Live 行内宿主观测（绘制层：computed color / br / 净化负向 / 命中） */
  readLiveInlineHosts() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-live-inline-html'))
    return els.map((host) => {
      const rect = host.getBoundingClientRect()
      const colored = host.querySelector<HTMLElement>('[style*="color"]')
      const coloredRect = colored?.getBoundingClientRect()
      const hit = coloredRect && coloredRect.width > 0 && coloredRect.height > 0
        ? document.elementFromPoint(
          coloredRect.left + coloredRect.width / 2,
          coloredRect.top + coloredRect.height / 2)
        : null
      return {
        from: Number(host.dataset['vsidianHtmlFrom']),
        to: Number(host.dataset['vsidianHtmlTo']),
        display: getComputedStyle(host).display,
        hostHeight: rect.height,
        color: colored ? getComputedStyle(colored).color : null,
        brs: host.querySelectorAll('br').length,
        scriptCount: host.querySelectorAll('script').length,
        eventAttrs: [...host.querySelectorAll('*')]
          .reduce((n, el) => n + [...el.attributes]
            .filter((a) => a.name.toLowerCase().startsWith('on')).length, 0),
        forgedAnchor: host.querySelector('[data-vsidian-src-start]') !== null,
        text: (host.textContent ?? '').trim(),
        /** 绘制层证据：颜色元素中心命中落在宿主内 */
        hitInside: hit !== null && host.contains(hit),
      }
    })
  },
  /** 片段表计数与显隐（StateField 层） */
  inlineHtmlSpanInfo(): Array<{ from: number; to: number; revealed: boolean }> {
    const state = liveView()?.state
    const spans = state?.field(liveInlineHtmlSpansField, false)
    if (!state || !spans) {
      return []
    }
    return spans.map((s) => ({
      from: s.from,
      to: s.to,
      revealed: selectionTouchesRange(state.selection, s.from, s.to),
    }))
  },
  /** 阅读态行内渲染观测：容器内带行内颜色样式且不在块级 html 块内的
   *  原生元素（原位渲染无包装类——paint.html.inline 同口径） */
  readReadingInlineColors() {
    const container = document.querySelector('.vsidian-view-reading')
    if (!(container instanceof HTMLElement)) {
      return []
    }
    return Array.from(container.querySelectorAll<HTMLElement>('[style*="color"]'))
      .filter((el) => el.closest('.vsidian-reading-html') === null)
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const hit = rect.width > 0 && rect.height > 0
          ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          : null
        return {
          color: getComputedStyle(el).color,
          text: (el.textContent ?? '').trim(),
          tag: el.tagName.toLowerCase(),
          hitInside: hit !== null && el.contains(hit),
        }
      })
  },
  /** 阅读态 br 计数（容器内、非代码块——原子 br 片段无颜色元素，
   *  paint.html.inline 同口径） */
  readingInlineBrCount(): number {
    const container = document.querySelector('.vsidian-view-reading')
    if (!(container instanceof HTMLElement)) {
      return 0
    }
    return Array.from(container.querySelectorAll('br'))
      .filter((br) => br.closest('.vsidian-reading-code-block') === null)
      .length
  },
  /** 行级源文绘制判据：行 textContent 含指定源文片段且有文本盒子
   *  （liveEmbed/liveHtml 同款口径） */
  inlineHtmlTextPainted(needle: string): boolean {
    for (const line of Array.from(document.querySelectorAll<HTMLElement>('.cm-content .cm-line'))) {
      if ((line.textContent ?? '').includes(needle)) {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let node: Node | null = null
        while ((node = walker.nextNode()) !== null) {
          if (!node.textContent?.includes(needle)) {
            continue
          }
          const range = document.createRange()
          range.selectNodeContents(node)
          if (range.getClientRects().length > 0) {
            return true
          }
        }
      }
    }
    return false
  },
  /** 含指定文本的行高（行内混排不拆行的观感证据） */
  inlineHtmlLineHeightOf(needle: string): number | null {
    for (const line of Array.from(document.querySelectorAll<HTMLElement>('.cm-content .cm-line'))) {
      if ((line.textContent ?? '').includes(needle)) {
        return line.getBoundingClientRect().height
      }
    }
    return null
  },
  controller,
})
