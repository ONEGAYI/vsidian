// #339（P3-07）PDF 适合宽度/缩放/文本选择/链接 浏览器 fixture：
// 装配生产 webview 控制器（与 hoverPdfFixture 同款），悬停指向本地 PDF
// 双链（真实指针开浮层），宿主 pdf 载荷回包经伪造通道注入。断言面：
// - 文本层：真实 pdfjs TextLayer span 与画布墨迹对齐（span 矩形映射
//   canvas 像素采样的非白计数——绘制层证据，非 DOM 存在性）、原生选区
//   文本（西文恒定；中文按样本嵌入能力条件断言）；
// - 缩放：zoom 探针、canvas 实际绘制尺寸变化、页码行百分比、预算
//   （canvasBytes ≤ PDF_SCROLL_LIMITS）、重绘后文本层仍对齐；
// - 链接：内部 GoTo 就地翻页（绘制层目标页身份色）、https 外链经
//   link.activate 出站（面板会话身份）、禁用面（ftp/javascript/file/
//   Launch/未知目标）零动作零出站；
// - 全程零 edit.request（只读契约）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { __pdfDocumentStoreStatsForTest, __setPdfAssetsForTest } from '../../src/webview/pdfRender'
import { hoverPopupProbe, resetHoverPdfZoom, zoomHoverPdf } from '../../src/webview/hoverPopup'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（link.activate 断言 + 零写回断言） */
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
  /** 装配父文档（Reading 起步） */
  initZoomPdfDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'pdf-zoom',
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
  zoomPdfSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 宿主 pdf 载荷回包注入（与生产 handleHostMessage 同入口） */
  respondZoomPdfResult(payload: { reqId: number; instanceId: string; pdfUri: string }) {
    controller.handleHostMessage({
      kind: 'hover.result',
      reqId: payload.reqId,
      instanceId: payload.instanceId,
      ok: true,
      contentKind: 'pdf',
      target: { fsPath: 'D:\\notes\\文本链接.pdf', relPath: '文本链接.pdf' },
      version: 3,
      text: '',
      range: { start: 0, end: 0 },
      scope: { kind: 'pdf' },
      pdf: { uri: payload.pdfUri, bytes: 2048 },
    } as HostToWebview)
  },
  /** 浮层观测（#339 probe 扩展：zoom/textLayerPages/linkAnnotations） */
  readZoomPdf(): {
    open: boolean
    state: string
    pdf: {
      phase: string; page: number; totalPages: number; zoom: number
      canvasWidth: number; canvasHeight: number; mountedPages: number
      canvasBytes: number; textLayerPages: number; linkAnnotations: number
    }
  } {
    return hoverPopupProbe()
  },
  /** 缩放操作（生产键位路由同一实现入口：zoomHoverPdf/resetHoverPdfZoom） */
  zoomPdf(factor: number): boolean {
    return zoomHoverPdf(factor)
  },
  resetPdfZoom(): boolean {
    return resetHoverPdfZoom()
  },
  /** 文本层观测：指定页首个含目标文本的 span 的几何与文本 */
  readPdfTextSpan(pageNo: number, text: string): {
    found: boolean
    factor: string
    left: number; top: number; width: number; height: number
    userSelect: string
  } | null {
    const layer = document.querySelector<HTMLElement>(
      `.vsidian-hover-pdf-page[data-page="${pageNo}"] .vsidian-hover-pdf-text`)
    if (!layer) return null
    const spans = [...layer.querySelectorAll<HTMLElement>('span')]
    const hit = spans.find((s) => (s.textContent ?? '').includes(text))
    if (!hit) {
      return { found: false, factor: layer.style.getPropertyValue('--total-scale-factor'),
        left: 0, top: 0, width: 0, height: 0, userSelect: '' }
    }
    const rect = hit.getBoundingClientRect()
    return {
      found: true,
      factor: layer.style.getPropertyValue('--total-scale-factor'),
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      userSelect: getComputedStyle(hit).userSelect,
    }
  },
  /** span 矩形映射画布墨迹：把 span 的视口矩形换算到 canvas 像素坐标，
   *  采样区域内非白像素数（对齐断言的绘制层证据） */
  pdfSpanInkPixels(pageNo: number, text: string): number {
    const layer = document.querySelector<HTMLElement>(
      `.vsidian-hover-pdf-page[data-page="${pageNo}"] .vsidian-hover-pdf-text`)
    const canvas = document.querySelector<HTMLCanvasElement>(
      `.vsidian-hover-pdf-page[data-page="${pageNo}"] canvas`)
    if (!layer || !canvas) return -1
    const hit = [...layer.querySelectorAll<HTMLElement>('span')]
      .find((s) => (s.textContent ?? '').includes(text))
    if (!hit) return -1
    const spanRect = hit.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(1, canvasRect.width)
    const scaleY = canvas.height / Math.max(1, canvasRect.height)
    const x = Math.max(0, Math.floor((spanRect.left - canvasRect.left) * scaleX))
    const y = Math.max(0, Math.floor((spanRect.top - canvasRect.top) * scaleY))
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(spanRect.width * scaleX)))
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(spanRect.height * scaleY)))
    const ctx = canvas.getContext('2d')
    if (!ctx) return -1
    const data = ctx.getImageData(x, y, w, h).data
    let nonWhite = 0
    for (let i = 0; i < data.length / 4; i++) {
      if (data[i * 4] < 245 || data[i * 4 + 1] < 245 || data[i * 4 + 2] < 245) {
        nonWhite++
      }
    }
    return nonWhite
  },
  /** 程序化选区：框选指定 span 的文本节点，返回选区字符串（原生选区语义） */
  selectPdfSpanText(pageNo: number, text: string): string {
    const layer = document.querySelector<HTMLElement>(
      `.vsidian-hover-pdf-page[data-page="${pageNo}"] .vsidian-hover-pdf-text`)
    if (!layer) return ''
    const hit = [...layer.querySelectorAll<HTMLElement>('span')]
      .find((s) => (s.textContent ?? '').includes(text))
    if (!hit || hit.firstChild === null) return ''
    const selection = window.getSelection()
    if (!selection) return ''
    const range = document.createRange()
    range.selectNodeContents(hit.firstChild)
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  },
  /** 链接元素观测（pageNo 缺省取全部窗口页） */
  readPdfLinks(pageNo?: number): Array<{
    kind: string; disabled: boolean; href: string | null
    tooltip: string; left: number; top: number; width: number; height: number
  }> {
    const scope = pageNo !== undefined
      ? `.vsidian-hover-pdf-page[data-page="${pageNo}"]`
      : '.vsidian-hover-popup'
    return [...document.querySelectorAll<HTMLElement>(`${scope} .vsidian-hover-pdf-link`)].map((el) => {
      const rect = el.getBoundingClientRect()
      return {
        kind: el.getAttribute('data-link-kind') ?? '',
        disabled: el.classList.contains('vsidian-hover-pdf-link-disabled'),
        href: el.getAttribute('href'),
        tooltip: el.getAttribute('data-tooltip') ?? '',
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      }
    })
  },
  /** 链接点击驱动（生产 click 处理器同路径） */
  clickPdfLink(pageNo: number, index: number): void {
    const els = document.querySelectorAll<HTMLElement>(
      `.vsidian-hover-pdf-page[data-page="${pageNo}"] .vsidian-hover-pdf-link`)
    els[index]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  },
  /** 页码信息行文本（缩放百分比反馈） */
  pdfPageInfoText(): string {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-pdf-page-info')
    return el?.textContent ?? ''
  },
})
