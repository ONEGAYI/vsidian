// #338（P3-06）正文嵌入 PDF 浏览器 fixture：装配生产 webview 控制器，
// 父文档正文中的 ![[文件.pdf]] 嵌入经真实挂载链路（Reading 块升级卡片）
// 升级为引用卡片，宿主 pdf 载荷回包经伪造通道注入（与真实
// handleHostMessage 同入口）——卡片侧挂生产 PdfHoverView（真实 pdfjs
// 装配 + canvas 绘制）。容器矩阵（独占行/混排/引用/表格格内/递归孙卡）
// 与双 occurrence 共享/独立滚动的断言面在此装配。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { isHostToWebview, type HostToWebview, type WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { __pdfDocumentStoreStatsForTest, __setPdfAssetsForTest } from '../../src/webview/pdfRender'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 活的 reading 卡容器：多 .vsidian-view-reading 并存（切模式后旧视图
 *  驻留 DOM）时命中含嵌入卡的那个；无则 document 兜底（驱动侧像素与
 *  滚动断言的稳定定位面） */
function liveReadingRoot(): ParentNode {
  return [...document.querySelectorAll('.vsidian-view-reading')]
    .find((el) => el.querySelector('.vsidian-embed-card') !== null) ?? document
}

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
  /** 装配父文档（Reading 起步——正文嵌入的主场景） */
  initEmbedPdfDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'embed-pdf',
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
  embedPdfSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 宿主 pdf 载荷回包注入（与生产 handleHostMessage 同入口；最后一条
   *  消息副本暴露为 __lastPdfReply 供驱动侧断言构造——回包被静默拒收
   *  时的观测面） */
  respondEmbedPdf(payload: {
    reqId: number; instanceId: string; pdfUri: string; bytes: number
    page?: number; version?: number
  }): void {
    const message = {
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
    } as HostToWebview
    ;(window as unknown as { __lastPdfReply?: unknown }).__lastPdfReply = message
    controller.handleHostMessage(message)
  },
  /** 宿主 markdown 回包注入（递归孙卡的中间文档；同返回消费观测） */
  respondEmbedMd(payload: {
    reqId: number; instanceId: string; text: string; version?: number
  }): void {
    controller.handleHostMessage({
      kind: 'hover.result',
      reqId: payload.reqId,
      instanceId: payload.instanceId,
      ok: true,
      target: { fsPath: 'D:\\notes\\子文档.md', relPath: '子文档.md' },
      version: payload.version ?? 2,
      text: payload.text,
      range: { start: 0, end: payload.text.length },
      scope: { kind: 'full' },
    } as HostToWebview)
  },
  /** 宿主失效推送注入（changed/deleted/stale 链路驱动） */
  postEmbedInvalidated(payload: { fsPath: string; status: 'changed' | 'deleted' | 'stale'; generation: number }) {
    controller.handleHostMessage({
      kind: 'hover.invalidated',
      ...payload,
    } as HostToWebview)
  },
  /** 嵌入卡探针（view.state.readingEmbed——含 #338 pdf 字段；返回宽化为
   *  探针字段的可选取结构，驱动断言只取 inner/state/depth/pdf） */
  readEmbedCards(): Array<{
    inner: string; state: string; host?: string; depth?: number
    pdf: { phase: string; page: number; totalPages: number; errorReason: string; mountedPages: number; canvasBytes: number; nonWhiteRatio: number } | null | undefined
  }> {
    const before = sent.length
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = sent.slice(before).find((message) => message.kind === 'view.state')
    return (state?.kind === 'view.state' ? (state.readingEmbed ?? []) : []) as Array<{
      inner: string; state: string; host?: string; depth?: number
      pdf: { phase: string; page: number; totalPages: number; errorReason: string; mountedPages: number; canvasBytes: number; nonWhiteRatio: number } | null | undefined
    }>
  },
  /** 卡片内 PDF 页画布采样（绘制层断言——第 index 张卡的第 pageNo 页；
   *  index = -1 时定位嵌套孙卡——document 级 .vsidian-embed-card 内的
   *  .vsidian-embed-card（混排链的中间文档卡在 live 容器，且 probe 序与
   *  reading 容器内 DOM 序错开，结构定位不受两者影响） */
  readCardPdfPixels(index: number, pageNo?: number): { center: number[]; nonWhiteRatio: number } | null {
    let card: HTMLElement | null = null
    if (index === -1) {
      card = document.querySelector<HTMLElement>('.vsidian-embed-card .vsidian-embed-card')
    } else {
      card = liveReadingRoot().querySelectorAll<HTMLElement>('.vsidian-embed-card')[index] ?? null
    }
    let canvas: HTMLCanvasElement | null = null
    if (card) {
      canvas = pageNo !== undefined
        ? card.querySelector<HTMLCanvasElement>(`.vsidian-hover-pdf-page[data-page="${pageNo}"] canvas`)
        : card.querySelector<HTMLCanvasElement>('.vsidian-hover-pdf-canvas')
    }
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
      center: [data[idx]!, data[idx + 1]!, data[idx + 2]!],
      nonWhiteRatio: nonWhite / total,
    }
  },
  /** 卡片滚动驱动（写卡片滚动区 scrollTop 并派发 scroll——生产监听同源） */
  scrollCardPdf(index: number, top: number): number {
    const card = (liveReadingRoot()).querySelectorAll<HTMLElement>('.vsidian-embed-card')[index]
    const scroll = card?.querySelector<HTMLElement>('.vsidian-embed-card-scroll')
    if (!scroll) return -1
    scroll.scrollTop = top
    scroll.dispatchEvent(new Event('scroll'))
    return scroll.scrollTop
  },
  /** 卡片滚动区实际 scrollTop（滚动互通观测） */
  cardScrollTop(index: number): number {
    const card = (liveReadingRoot()).querySelectorAll<HTMLElement>('.vsidian-embed-card')[index]
    return card?.querySelector<HTMLElement>('.vsidian-embed-card-scroll')?.scrollTop ?? -1
  },
  /** 共享文档存储快照（refs 断言——共享与回收纪律的观测面） */
  pdfDocumentStoreStats(): Array<{ uri: string; refs: number }> {
    return __pdfDocumentStoreStatsForTest()
  },
  /** 父容器切换 Reading/Live（父 Live 源码显隐与 widget 路径驱动） */
  setEmbedPdfMode(mode: 'reading' | 'live') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 开启消息诊断（view.state.diagnostics——hover.applied 消费观测） */
  enableEmbedDiag(): void {
    controller.handleHostMessage({ kind: 'diagnostics.test.set', enabled: true })
  },
  /** 协议校验探针：页内构造的回包被 handleHostMessage 拒收时定位字段 */
  protoCheck(message: unknown): boolean {
    return isHostToWebview(message)
  },
  /** 原始宿主消息注入（诊断旁路：绕过 respond* 的参数化构造直发） */
  respondRaw(message: unknown): void {
    controller.handleHostMessage(message)
  },
})
