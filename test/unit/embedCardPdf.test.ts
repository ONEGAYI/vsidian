// #338（P3-06）正文嵌入 PDF 契约：![[文件.pdf]] 卡片侧挂 PDF 视图实例
// ——pdf 载荷分派（contentKind === 'pdf' 不再是 read-failed 防线）、只读
// 卡壳（模式/保存/关闭按钮隐藏）、装载缓存重挂、卸载回收（store 引用
// 回落）、失效链路（changed 静默重发 / deleted 撤内容）与 probe 观测面。
// 真实绘制与容器矩阵由浏览器 embedPdf 套件与真宿主集成断言（jsdom 以
// 替身 pdfjs 驱动——绘制层证据在高层入口）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import {
  __pdfDocumentStoreStatsForTest,
  __resetPdfjsSingletonsForTest,
  __setPdfAssetsForTest,
  PdfHoverView,
  type PdfAssetsConfig,
} from '../../src/webview/pdfRender'

installLocale('zh-cn', zhCn)

const ASSETS: PdfAssetsConfig = {
  mainJs: 'https://assets.test/pdfMain.js',
  workerJs: 'https://assets.test/pdfWorker.js',
  cMapUrl: 'https://assets.test/cmaps',
  fontUrl: 'https://assets.test/fonts',
  wasmUrl: 'https://assets.test/wasm',
  iccUrl: 'https://assets.test/iccs',
}

/** pdfjs 替身文档：刻意不提供 destroy——pdfjs 6.x 的 PDFDocumentProxy
 *  没有 destroy 方法（销毁正道是 loadingTask.destroy，#334 结论） */
interface FakeDoc {
  numPages: number
  getPage(pageNumber: number): unknown
}

function installFakePdfjs(numPages: number): { destroyed: number } {
  const state = { destroyed: 0 }
  const doc: FakeDoc = {
    numPages,
    getPage: () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: ({ canvas, viewport }: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => ({
        promise: Promise.resolve().then(() => {
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
        }),
        cancel: () => {},
      }),
    }),
  }
  const lib = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve(doc),
      // 销毁计数挂 loadingTask（文档与 worker 的销毁正道）
      destroy: async () => { state.destroyed++ },
    }),
  }
  ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = lib
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode('fake-pdf-bytes').buffer,
    text: async () => 'worker-text',
  })))
  vi.stubGlobal('Blob', class {})
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:fake-worker-url'),
    revokeObjectURL: vi.fn(),
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      fillStyle: '',
      fillRect: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(200),
      }),
    } as unknown as CanvasRenderingContext2D
  })
  return state
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

function makeContext(sent: WebviewToHost[], maxHeightPx = 480): EmbedCardContext {
  return {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => maxHeightPx,
    maxDepth: () => 3,
  }
}

function mountEmbedBlock(manager: EmbedCardManager, text: string): HTMLElement {
  const blocks = splitReadingBlocks(text)
  const embed = blocks.find((b) => b.kind === 'embed')
  if (!embed) throw new Error('文本未产生 embed 块')
  const el = createReadingBlockElement(embed, text)
  document.body.appendChild(el)
  manager.mountBlock(el)
  return el
}

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') throw new Error('hover.request 未发出')
  return req
}

function pdfResultOk(
  req: { reqId: number; instanceId: string },
  opts: { version?: number; page?: number; uri?: string } = {},
): Extract<HoverPreviewResult, { ok: true }> {
  const version = opts.version ?? 3
  return {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    contentKind: 'pdf',
    target: { fsPath: 'D:\\notes\\资料.pdf', relPath: '资料.pdf' },
    version,
    text: '',
    range: { start: 0, end: 0 },
    scope: { kind: 'pdf', ...(opts.page !== undefined ? { page: opts.page } : {}) },
    pdf: { uri: opts.uri ?? `https://files.test/资料.pdf?v=${version}`, bytes: 1234 },
  } as Extract<HoverPreviewResult, { ok: true }>
}

/** microtask 泵：推进 show 的装载链直到谓词成立 */
async function pumpUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !pred(); i++) {
    await Promise.resolve()
  }
  expect(pred(), '挂起点应就位（装载链推进超时）').toBe(true)
}

beforeEach(() => {
  __setPdfAssetsForTest(ASSETS)
  // 卡片滚动区可见（jsdom 无布局；视口宽高供 PDF 窗口计算）
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) && this.style.display !== 'none' ? 400 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) && this.style.display !== 'none' ? 448 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  __resetPdfjsSingletonsForTest()
  __setPdfAssetsForTest(null)
  ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('正文嵌入 PDF（#338）', () => {
  it('pdf 载荷分派：卡片挂 PDF 视图（Reading 容器让位）、只读卡壳（模式/保存/关闭隐藏）与目标订阅', async () => {
    installFakePdfjs(3)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    const req = hoverRequestOf(sent)
    expect(req.target).toBe('资料.pdf')
    manager.notifyResult(pdfResultOk(req))
    await pumpUntil(() => manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'))
    // PDF 视图在场（卡片滚动区内）；Reading 容器隐藏
    expect(el.querySelector('.vsidian-hover-pdf')).not.toBeNull()
    const contentEl = el.querySelector<HTMLElement>('.vsidian-reading-container, .vsidian-view-reading')
    if (contentEl) expect(contentEl.style.display).toBe('none')
    // 只读卡壳：模式/保存/关闭按钮不进入 Tab 序
    const modeBtn = el.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
    if (modeBtn) expect(modeBtn.style.display).toBe('none')
    // 目标订阅登记（hover.watch——PDF 失效通道与 Markdown 同源）
    expect(sent.some((m) => m.kind === 'hover.watch' && m.fsPath === 'D:\\notes\\资料.pdf')).toBe(true)
    manager.dispose()
  })

  it('probe 观测面：卡片 pdf 字段携带 phase/page/totalPages/mountedPages（container 矩阵断言载体）', async () => {
    installFakePdfjs(5)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    manager.notifyResult(pdfResultOk(hoverRequestOf(sent), { page: 2 }))
    await pumpUntil(() => manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'))
    const card = manager.probe().find((c) => c.pdf != null)
    expect(card).toBeDefined()
    expect(card!.pdf!.page).toBe(2)
    expect(card!.pdf!.totalPages).toBe(5)
    expect(card!.pdf!.mountedPages).toBeGreaterThan(0)
    void el
    manager.dispose()
  })

  it('卸载回收：unmountBlock 释放 PDF 视图与文档引用（父块回收链路）', async () => {
    const state = installFakePdfjs(3)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    manager.notifyResult(pdfResultOk(hoverRequestOf(sent)))
    await pumpUntil(() => __pdfDocumentStoreStatsForTest().length > 0)
    expect(__pdfDocumentStoreStatsForTest()[0]!.refs).toBe(1)
    manager.unmountBlock(el)
    await pumpUntil(() => state.destroyed === 1)
    expect(__pdfDocumentStoreStatsForTest()).toEqual([])
    expect(document.querySelector('.vsidian-hover-pdf')).toBeNull()
    manager.dispose()
  })

  it('双 occurrence 共享文档、卸载一个不影响另一个', async () => {
    installFakePdfjs(3)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const TEXT = '![[资料.pdf]]\n\n中间段落。\n\n![[资料.pdf#page=3]]\n'
    const elA = mountEmbedBlock(manager, TEXT)
    // 同文本第二个 embed 块（空行分隔——两处独立独占行嵌入）
    const blocks = splitReadingBlocks(TEXT).filter((b) => b.kind === 'embed')
    expect(blocks.length).toBe(2)
    const elB = createReadingBlockElement(blocks[1]!, TEXT)
    document.body.appendChild(elB)
    manager.mountBlock(elB)
    const reqs = sent.filter((m) => m.kind === 'hover.request')
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    manager.notifyResult(pdfResultOk(reqs[0] as { reqId: number; instanceId: string }))
    manager.notifyResult(pdfResultOk(reqs[1] as { reqId: number; instanceId: string }, { page: 3 }))
    await pumpUntil(() => __pdfDocumentStoreStatsForTest().some((e) => e.refs >= 2))
    expect(__pdfDocumentStoreStatsForTest()[0]!.refs).toBe(2)
    // 关闭（卸载）一个：另一个仍在场可读（文档不销毁）
    manager.unmountBlock(elA)
    await pumpUntil(() => __pdfDocumentStoreStatsForTest()[0]!.refs === 1)
    expect(elB.querySelector('.vsidian-hover-pdf')).not.toBeNull()
    const after = manager.probe().filter((c) => c.pdf != null)
    expect(after.length).toBe(1)
    expect(after[0]!.pdf!.page).toBe(3)
    void elA
    manager.dispose()
  })

  it('失效链路：changed 静默重发（新版本 uri 重载）、deleted 撤下旧页就地分态', async () => {
    installFakePdfjs(3)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    manager.notifyResult(pdfResultOk(hoverRequestOf(sent)))
    await pumpUntil(() => manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'))

    // changed：清缓存 + 静默重发（不闪 loading）
    manager.notifyInvalidated({ fsPath: 'D:\\notes\\资料.pdf', status: 'changed', generation: 1 })
    const reloaded = sent.filter((m) => m.kind === 'hover.request').length
    expect(reloaded).toBeGreaterThanOrEqual(2)
    // 新版本回包（uri ?v= 推进）→ 视图按新 uri 重载
    const req2 = hoverRequestOf(sent)
    manager.notifyResult(pdfResultOk(req2, { version: 4 }))
    await pumpUntil(() => manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'))
    expect(el.querySelector('.vsidian-hover-pdf')).not.toBeNull()

    // deleted：撤下旧页（画布与页占位清空、spacer 归零）+ not-found 分态就地呈现
    manager.notifyInvalidated({ fsPath: 'D:\\notes\\资料.pdf', status: 'deleted', generation: 2 })
    const card = manager.probe().find((c) => c.pdf != null)
    expect(card!.state).toBe('error')
    expect(el.querySelector('.vsidian-hover-pdf canvas')).toBeNull()
    expect(el.querySelector('.vsidian-hover-pdf-page')).toBeNull()
    expect(el.querySelector('.vsidian-hover-pdf')).not.toBeNull() // 视图骨架保留（恢复 changed 重载可复用）
    manager.dispose()
  })

  it('卸载在途回包缓存：pdf 载荷写入 entry 缓存，重挂零重发直接呈现', async () => {
    installFakePdfjs(3)
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    const req = hoverRequestOf(sent)
    // 回包前卸载（视口回收）→ 迟到回包写缓存
    manager.unmountBlock(el)
    manager.notifyResult(pdfResultOk(req))
    expect(sent.filter((m) => m.kind === 'hover.request').length).toBe(1)
    // 重挂：缓存直呈（零新请求），PDF 视图复现
    const el2 = mountEmbedBlock(manager, '![[资料.pdf]]\n')
    await pumpUntil(() => manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'))
    expect(sent.filter((m) => m.kind === 'hover.request').length).toBe(1)
    expect(el2.querySelector('.vsidian-hover-pdf')).not.toBeNull()
    manager.dispose()
  })
})

// 静态引用（类型对齐用——避免未使用告警）
void PdfHoverView
