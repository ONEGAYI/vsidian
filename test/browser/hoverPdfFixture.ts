// #337 PDF 悬停首条闭环浏览器 fixture：装配生产 webview 控制器，悬停
// 指向本地 PDF 的双链/普通链接（真实指针驱动开浮层），宿主 pdf 载荷回包
// 经伪造通道注入（与真实 handleHostMessage 同入口）；PDF 装配资源经
// __setPdfAssetsForTest 指到虚拟 URL（套件用 page.route fulfill 到真实
// 构建产物——pdfMain/pdfWorker 与 pdfjs 资产目录）。真实 PDF.js 装配、
// blob worker 与 canvas 绘制全链路在生产代码路径上验证。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { __setPdfAssetsForTest } from '../../src/webview/pdfRender'
import { hoverPopupProbe, turnHoverPdfPage } from '../../src/webview/hoverPopup'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request 载荷断言 + 零写回断言） */
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
  /** 装配父文档（Reading 起步——PDF 悬停的主场景） */
  initHoverPdfDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'hover-pdf',
      docUri: DOC_URI,
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  /** 装配 PDF 装配资源替身（虚拟 URL 由套件路由 fulfill） */
  applyPdfAssets(assets: {
    mainJs: string; workerJs: string; cMapUrl: string
    fontUrl: string; wasmUrl: string; iccUrl: string
  }) {
    __setPdfAssetsForTest(assets)
  },
  /** 出站消息快照 */
  hoverPdfSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 宿主 pdf 载荷回包注入（与生产 handleHostMessage 同入口） */
  respondHoverPdfResult(payload: {
    reqId: number; instanceId: string; pdfUri: string; bytes: number
    page?: number; version?: number
  }) {
    controller.handleHostMessage({
      kind: 'hover.result',
      reqId: payload.reqId,
      instanceId: payload.instanceId,
      ok: true,
      contentKind: 'pdf',
      target: { fsPath: 'D:\\notes\\资料.pdf', relPath: '资料.pdf' },
      version: payload.version ?? 3,
      text: '',
      range: { start: 0, end: 0 },
      scope: { kind: 'pdf', ...(payload.page !== undefined ? { page: payload.page } : {}) },
      pdf: { uri: payload.pdfUri, bytes: payload.bytes },
    } as HostToWebview)
  },
  /** 宿主失败回包注入 */
  respondHoverPdfFail(payload: { reqId: number; instanceId: string; reason: string; anchor?: string }) {
    controller.handleHostMessage({
      kind: 'hover.result',
      reqId: payload.reqId,
      instanceId: payload.instanceId,
      ok: false,
      reason: payload.reason as never,
      ...(payload.anchor !== undefined ? { anchor: payload.anchor } : {}),
    } as HostToWebview)
  },
  /** 浮层观测（view.state 探针同源的 hoverPopupProbe 形态） */
  readHoverPdf(): {
    open: boolean
    state: string
    scope: string
    pdf: { phase: string; page: number; totalPages: number; canvasWidth: number; canvasHeight: number; errorReason: string; requestedPage: number }
  } {
    return hoverPopupProbe()
  },
  /** canvas 中心与九宫格采样（绘制层断言——非 DOM 存在性） */
  readPdfCanvasPixels(): { w: number; h: number; center: number[]; nonWhiteRatio: number } | null {
    const canvas = document.querySelector<HTMLCanvasElement>('.vsidian-hover-pdf-canvas')
    if (!canvas || canvas.width === 0) {
      return null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return null
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhite = 0
    const total = canvas.width * canvas.height
    for (let i = 0; i < total; i++) {
      if (data[i * 4] < 245 || data[i * 4 + 1] < 245 || data[i * 4 + 2] < 245) {
        nonWhite++
      }
    }
    const cx = Math.floor(canvas.width / 2)
    const cy = Math.floor(canvas.height / 2)
    const idx = (cy * canvas.width + cx) * 4
    return {
      w: canvas.width,
      h: canvas.height,
      center: [data[idx], data[idx + 1], data[idx + 2]],
      nonWhiteRatio: nonWhite / total,
    }
  },
  /** 翻页操作驱动（生产键位路由同款实现入口） */
  turnPdfPage(delta: number): boolean {
    return turnHoverPdfPage(delta === 0 ? 1 : (delta > 0 ? 1 : -1))
  },
})
