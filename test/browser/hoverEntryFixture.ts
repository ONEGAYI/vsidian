// #221 全入口悬停浏览器回归 fixture：装配生产 webview 控制器，Live 正文
// （Ctrl+悬停/直接悬停设置）、反链/出链面板（直接悬停）与键盘命令（真实
// 按键 + ui.command 回发）三入口经真实指针/键盘驱动——浮层开闭、载荷形
// 态、焦点往返、键盘模态保活与无目标不误开在真实布局验证。宿主回包经
// fixture 内伪造通道注入（与真实 handleHostMessage 同入口）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { BacklinkItemPayload, HostToWebview, OutlinkItemPayload, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request 载荷断言 + 零写回断言 + 跳转意图回归观测） */
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

const DOC_URI = 'file:///d%3A/notes/parent.md'

Object.assign(window, {
  /** 装配父文档（Live 起步——Live 悬停场景的前置） */
  initHoverEntryDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'hover-entry',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式（view.mode.set，与生产回流同入口） */
  setEntryMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（settings.snapshot 通道；hover.liveDirect 开关的生效面） */
  applyEntrySettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 注入快捷键绑定快照（keybindings.snapshot 通道；真实按键路径的前置） */
  applyEntryKeybindings(overrides: Record<string, string[]>) {
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides })
  },
  /** 注入反链快照（面板条目悬停的目标载荷来源） */
  injectBacklinks(items: BacklinkItemPayload[]) {
    controller.handleHostMessage({
      kind: 'backlinks.snapshot',
      docUri: DOC_URI,
      state: 'ready',
      items,
      seq: 1,
    })
  },
  /** 注入出链快照（面板条目悬停的目标载荷来源；断链条目 resolved:false） */
  injectOutlinks(items: OutlinkItemPayload[]) {
    controller.handleHostMessage({
      kind: 'outlinks.snapshot',
      docUri: DOC_URI,
      state: 'ready',
      items,
      seq: 1,
    })
  },
  /** 命令面板路径的「预览当前链接」（宿主 ui.command 回发，与真实同入口） */
  runPreviewCommand() {
    controller.handleHostMessage({ kind: 'ui.command', op: 'hoverPreviewLink' })
  },
  /** 注入宿主消息（hover.result 等与真实 handleHostMessage 同入口） */
  respondHoverResult(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 已出站消息快照 */
  hoverSent(): WebviewToHost[] {
    return [...sent]
  },
  /** Live 光标设置（纯选区事务，零写回；view 经公开 findFromDOM 取得，
   *  不触控制器私有成员——outlineJumpFixture 同款先例） */
  setLiveCursor(pos: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)
    view?.dispatch({ selection: { anchor: pos } })
  },
  controller,
  /** 浮层观测（与 hoverPreview 套件同款：绘制层可见性、几何、内容与焦点） */
  readHoverPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const scrollEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    const stateEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-state')!
    const centerTopEl = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 30),
    )
    return {
      open: true as const,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      background: style.backgroundColor,
      hitInside: centerTopEl !== null && el.contains(centerTopEl),
      text: (el.textContent ?? '').trim(),
      stateText: (stateEl.textContent ?? '').trim(),
      stateVisible: getComputedStyle(stateEl).display !== 'none',
      scrollable: scrollEl.scrollHeight > scrollEl.clientHeight,
      focusInside: el.contains(document.activeElement),
      focusIsContainer: document.activeElement === el,
      outline: style.outlineStyle,
    }
  },
  /** 当前焦点描述（键盘往返断言素材） */
  readActiveElement(): string {
    const el = document.activeElement
    if (!el || el === document.body) {
      return 'body'
    }
    const cls = (el as HTMLElement).className ?? ''
    return `${el.tagName}.${typeof cls === 'string' ? cls.split(' ')[0] : ''}`
  },
  /** 键盘模态的滚动保活面：父容器滚动派发（capture 监听在 window） */
  dispatchEditorScroll() {
    const scroller = document.querySelector('.cm-scroller')
    if (!scroller) {
      return false
    }
    scroller.dispatchEvent(new Event('scroll'))
    return true
  },
  /** 焦点移出浮层（保活失效面：焦点离场后恢复常规鼠标关闭语义） */
  focusSidebarToggle() {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-sidebar-toggle')
    btn?.focus()
    return btn !== null
  },
})
