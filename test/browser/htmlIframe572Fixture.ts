// #572（T07）iframe 子文档装载隔离与源码显形的浏览器回归装配：装配生产
// webview 控制器 + 伪造资源宿主（htmlResource.request 自动回包——相对
// src 改写为注册地址）。验证面：sandbox 系统强制面（https=allow-scripts、
// srcdoc/本地=零 token）、srcdoc 内容真实可见与帧内脚本零执行、本地页面
// 装载、Live shield 单击帧区选中完整源码（外层命中机制）、Reading 原生
// 交互零父文档写回、父 docStyle 不入帧、显隐/换文档释放无残留。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView } from '@codemirror/view'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（Reading 交互零写回断言的 edit.request 计数） */
const sent: WebviewToHost[] = []

/** 伪造资源宿主的解析表（相对名 → 绝对 URL；未登记的相对路径失败回包） */
const resourceTable = new Map<string, string>()
/** 解析请求日志（iframe src 归属断言） */
const resourceLog: string[] = []

const bridge: VsCodeBridge = {
  postMessage(message) {
    const msg = message as WebviewToHost
    sent.push(msg)
    if (msg.kind === 'htmlResource.request') {
      resourceLog.push(msg.url)
      const hit = resourceTable.get(msg.url)
      window.setTimeout(() => {
        controller.handleHostMessage(hit !== undefined
          ? { kind: 'htmlResource.result', reqId: msg.reqId, ok: true, url: hit }
          : { kind: 'htmlResource.result', reqId: msg.reqId, ok: false, reason: 'not-found', detail: msg.url })
      }, 0)
    }
  },
  getState() {
    return undefined
  },
  setState() {},
}
const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!)

const DOC_URI = 'file:///d%3A/notes/html-iframe.md'

/** 活跃内容域（双容器常驻、非活跃者 display:none） */
function activeScope(): ParentNode | null {
  const reading = document.querySelector<HTMLElement>('.vsidian-view-reading')
  if (reading && reading.getClientRects().length > 0) {
    return reading
  }
  return document.querySelector('.cm-content')
}

Object.assign(window, {
  /** 装载文档并登记资源表（相对名 → 绝对 URL） */
  initIframeDoc(text: string, resources: Record<string, string> = {}) {
    resourceTable.clear()
    resourceLog.length = 0
    for (const [name, url] of Object.entries(resources)) {
      resourceTable.set(name, url)
    }
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'html-iframe-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setIframeMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 活跃域内 iframe 装配面观测（sandbox/src/srcdoc/shield） */
  readIframeFrames() {
    const scope = activeScope()
    if (!scope) {
      return { frames: [] as Array<{ sandbox: string; src: string | null; srcdoc: boolean; shield: boolean }>, shields: 0 }
    }
    const frames = Array.from(scope.querySelectorAll<HTMLIFrameElement>('iframe[data-vsidian-iframe]')).map((f) => ({
      sandbox: f.getAttribute('sandbox') ?? '',
      src: f.getAttribute('src'),
      srcdoc: f.hasAttribute('srcdoc'),
      shield: f.parentElement?.classList.contains('vsidian-live-html-frame') === true &&
        f.parentElement.querySelector('.vsidian-live-html-frame-shield') !== null,
    }))
    return {
      frames,
      shields: scope.querySelectorAll('.vsidian-live-html-frame-shield').length,
    }
  },
  /** Live 选区观测（点击显形断言） */
  iframeSelection(): Array<{ anchor: number; head: number }> {
    const editor = document.querySelector('.cm-editor')
    const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  iframeSent(): WebviewToHost[] {
    return [...sent]
  },
  iframeResourceLog(): string[] {
    return [...resourceLog]
  },
})
