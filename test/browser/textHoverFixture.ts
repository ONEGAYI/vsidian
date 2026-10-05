// 可读文本悬停（#340 / P3-08）浏览器回归 fixture：装配生产 webview 控制器
// （与 hoverPreviewFixture 同模式），宿主回包经伪造通道注入（handleHost
// Message 同入口）——text 载荷、token 分层、外观广播与错误分态的驱动面。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
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
controller.mount(document.getElementById('app')!, [])

Object.assign(window, {
  initTextDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'text-hover',
      docUri: 'file:///d%3A/notes/parent.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  textSent(): WebviewToHost[] {
    return [...sent]
  },
  respond(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 浮层文本视图快照（绘制层断言的数据源——行号/颜色/滚动几何） */
  readTextView() {
    const scrollEl = document.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')
    if (!scrollEl) {
      return { open: false }
    }
    const clip = scrollEl.getBoundingClientRect()
    const lines = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-line'))
    const gutters = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-gutter-line'))
    const spans = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-line span'))
      .filter((span) => (span.textContent ?? '').length > 0)
      .map((span) => ({
        text: span.textContent ?? '',
        color: getComputedStyle(span).color,
        painted: getComputedStyle(span).visibility === 'visible' &&
          getComputedStyle(span).display !== 'none',
        inViewport: (() => {
          const box = span.getBoundingClientRect()
          return box.bottom > clip.top && box.top < clip.bottom && box.height > 0
        })(),
      }))
    const stateEl = document.querySelector<HTMLElement>('.vsidian-hover-popup-state')
    return {
      open: true,
      lineCount: lines.length,
      gutterNumbers: gutters.map((g) => g.textContent ?? ''),
      spans,
      scrollTop: scrollEl.scrollTop,
      scrollHeight: scrollEl.scrollHeight,
      clientHeight: scrollEl.clientHeight,
      stateVisible: stateEl !== null && stateEl.style.display !== 'none',
      stateText: stateEl?.textContent ?? '',
      fontFamily: getComputedStyle(scrollEl.querySelector<HTMLElement>('.vsidian-text-view') ?? scrollEl).fontFamily,
      fontSize: getComputedStyle(scrollEl.querySelector<HTMLElement>('.vsidian-text-view') ?? scrollEl).fontSize,
    }
  },
  /** 横向滚动几何探针（2026-10-05 验收 5b 改版）：横滚归宿主滚动区、
      code 区不自持横滚、行号列 sticky 钉视口左缘——横条贴浮窗视口底缘
      的结构性前提（滚动条本体 headless 不渲染，断言落在滚动几何上） */
  readTextHScroll() {
    const scrollEl = document.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')
    const code = scrollEl?.querySelector<HTMLElement>('.vsidian-text-code') ?? null
    const gutter = scrollEl?.querySelector<HTMLElement>('.vsidian-text-gutter') ?? null
    if (!scrollEl || !code || !gutter) {
      return { present: false as const }
    }
    code.scrollLeft = 100
    const codeSelfScroll = code.scrollLeft
    const clip = scrollEl.getBoundingClientRect()
    const gutterAt0 = gutter.getBoundingClientRect().left - clip.left
    scrollEl.scrollLeft = 80
    const scrollLeftApplied = scrollEl.scrollLeft
    const gutterAt80 = gutter.getBoundingClientRect().left - clip.left
    const gutterWidth = gutter.getBoundingClientRect().width
    scrollEl.scrollLeft = 0
    return {
      present: true as const,
      scrollWidth: scrollEl.scrollWidth,
      clientWidth: scrollEl.clientWidth,
      codeSelfScroll,
      scrollLeftApplied,
      gutterAt0,
      gutterAt80,
      gutterWidth,
    }
  },
})
