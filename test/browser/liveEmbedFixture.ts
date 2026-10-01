// 父文档 Live 正文嵌入浏览器回归（#223 装配基座）：装配生产 webview 控制器，
// 独占行 ![[…]] 在 Live 视图经 CM6 装饰挂载共用嵌入卡片——光标/选区驱动
// 源码显隐（方向键/鼠标/shift 拖选/多选区）、真实 IME 修改引用、未闭合
// 撤卡与恢复重载、内部选区隔离与绘制层可见性在真实布局（Chromium）验证。
// 宿主回包经 fixture 内伪造通道注入（与真实 handleHostMessage 同入口）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { liveEmbedSpansField } from '../../src/webview/liveEmbed'
import { selectionTouchesRange } from '../../src/webview/liveDecorations'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request 载荷断言 + 零写回断言的 edit.request 计数） */
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
  // 多选区场景（任一 range 命中显形）需要显式开启（CM6 缺省把多 range
  // selection 规约为单 range——生产侧随 symbolSelectionWrap 组按需装配）
  EditorState.allowMultipleSelections.of(true),
])

const DOC_URI = 'file:///d%3A/notes/parent.md'

/** 公开取 view（不触控制器私有成员——hoverEntryFixture 同款先例） */
function liveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 装配父文档（Live 起步——本套件全部场景的默认模式） */
  initLiveEmbedDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'live-embed-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式（view.mode.set，与生产回流同入口；模式切换场景） */
  setLiveEmbedMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入宿主消息（hover.result / settings.snapshot 与真实 handleHostMessage 同入口） */
  respondLiveEmbed(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 已出站消息快照（hover.request / edit.request / *.activate 观测） */
  liveEmbedSent(): WebviewToHost[] {
    return [...sent]
  },
  /** Live 光标设置（纯选区事务零写回） */
  setLiveCursor(pos: number) {
    liveView()?.dispatch({ selection: { anchor: pos } })
  },
  /** Live 多选区设置（任一 range 命中显形场景；主位取末 range） */
  setLiveRanges(positions: Array<[number, number]>) {
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
  /** 当前 CM6 选区快照（主位与全部 range） */
  liveEmbedSelection(): Array<{ anchor: number; head: number }> {
    const view = liveView()
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  /** 当前文档全文（LF） */
  liveEmbedDocText(): string {
    return liveView()?.state.doc.toString() ?? ''
  },
  /** 焦点进编辑器（真实键盘/IME 驱动前提） */
  focusLiveEmbed() {
    liveView()?.focus()
    return document.activeElement instanceof HTMLElement
      ? document.activeElement.className
      : ''
  },
  /** Live 嵌入宿主观测（绘制层：形态、卡片可见性、边条与状态行） */
  readLiveEmbeds() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-live-embed'))
    return els.map((host) => {
      const card = host.querySelector<HTMLElement>('.vsidian-embed-card')
      const rect = host.getBoundingClientRect()
      const cardRect = card?.getBoundingClientRect()
      const style = card ? getComputedStyle(card) : null
      const stateEl = card?.querySelector<HTMLElement>('.vsidian-embed-card-state') ?? null
      const centerEl = cardRect
        ? document.elementFromPoint(cardRect.left + 40, cardRect.top + 12)
        : null
      return {
        below: host.classList.contains('vsidian-live-embed-below'),
        tag: host.tagName,
        hostVisible: rect.height > 0,
        cardPresent: card !== null,
        cardHeight: cardRect?.height ?? 0,
        barWidth: style?.borderLeftWidth ?? '',
        barColor: style?.borderLeftColor ?? '',
        /** 绘制层证据：卡片头部命中元素落在宿主内（真实接收指针） */
        hitInside: centerEl !== null && host.contains(centerEl),
        stateText: (stateEl?.textContent ?? '').trim(),
        stateVisible: stateEl !== null && getComputedStyle(stateEl).display !== 'none',
        text: (card?.textContent ?? '').trim(),
      }
    })
  },
  /** 嵌入宿主计数 */
  liveEmbedCount(): number {
    return document.querySelectorAll('.vsidian-live-embed').length
  },
  /** 嵌入表 StateField 计数（无视口依赖——DOM widget 只在视口内行实例化，
   *  回包后卡片限高使视口外卡不出 DOM；表层数据不受影响） */
  liveEmbedSpanCount(): number {
    const spans = liveView()?.state.field(liveEmbedSpansField, false)
    return spans ? spans.length : -1
  },
  /** 嵌入表逐枚显隐（selectionTouchesRange 同语义，StateField 层观测） */
  liveEmbedRevealStates(): Array<{ inner: string; from: number; to: number; revealed: boolean }> {
    const view = liveView()
    const state = view?.state
    const spans = state?.field(liveEmbedSpansField, false)
    if (!state || !spans) {
      return []
    }
    const selection = state.selection
    return spans.map((s) => ({
      inner: s.inner,
      from: s.from,
      to: s.to,
      revealed: selectionTouchesRange(selection, s.from, s.to),
    }))
  },
  /** 源文绘制层可见性（行级判据）：lineText（trim 后整行文本）是否仍作为
   *  .cm-line 的行级文本渲染——隐形态整行被 replace widget 替换后行
   *  textContent 为卡片内容，行级全等失败即未绘制；显形态行文本全等命中
   *  且行内有文本盒子。行级而非文本节点级：嵌入 mark（#217 验收反馈起
   *  混排/显形源文挂链接 span）会把一行切成多段文本节点，节点级全等对
   *  mark 命中的行天然失效（且嵌入 span 的文本恰为嵌入原文，会误命中
   *  其他行的断言） */
  liveLinePainted(lineText: string): boolean {
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
  /** 文本节点级绘制判据（.cm-content 内任意深度）：代码块卡片等非
   *  .cm-line 容器内的字面文本可见性（围栏内容行由代码卡片渲染，不在
   *  行结构内——行级判据覆盖不到） */
  liveTextPainted(text: string): boolean {
    const wanted = text.trim()
    const content = document.querySelector('.cm-content')
    if (!content) {
      return false
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode()) !== null) {
      if ((node.textContent ?? '').trim() !== wanted) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      if (range.getClientRects().length > 0) {
        return true
      }
    }
    return false
  },
  /** 在卡片内容文本上建立浏览器选区（内部选字复制能力的 Selection 层证据） */
  selectLiveEmbedText(index: number, needle: string): string {
    const host = document.querySelectorAll<HTMLElement>('.vsidian-live-embed')[index]
    if (!host) {
      return ''
    }
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode()) !== null) {
      if ((node.textContent ?? '').includes(needle)) {
        break
      }
    }
    if (!node) {
      return ''
    }
    const offset = (node.textContent ?? '').indexOf(needle)
    const range = document.createRange()
    range.setStart(node, offset)
    range.setEnd(node, offset + needle.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return selection?.toString() ?? ''
  },
  /** Live 滚动容器位置（高度变动不跳动的断言面） */
  liveEmbedScrollTop(): number {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')
    return scroller ? scroller.scrollTop : -1
  },
  /** needle 文本节点的视口 top（布局稳定性断言面） */
  liveEmbedTextTop(needle: string): number {
    const content = document.querySelector('.cm-content')
    if (!content) {
      return -1
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode()) !== null) {
      const t = node.textContent ?? ''
      const at = t.indexOf(needle)
      if (at >= 0) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const rect = range.getBoundingClientRect()
        if (rect.height > 0) {
          return rect.top
        }
      }
    }
    return -1
  },
  controller,
})
