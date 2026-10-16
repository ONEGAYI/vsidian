// T06（#545）附加组件只读引用嵌入的 EmbedCardManager 挂载契约（模块级
// jsdom 直驱）：组件容器挂载（readOnly 来源 + addonSource 覆盖随请求出站）、
// 首次装载结局一次性兑现（content / 真实失败原因 / 预算准入）、只读硬边界
//（模式切换入口不出现、零写端口、递归孙卡继承只读）、目标失效沿既有分态
//（changed 静默重载携带同一 addonSource、deleted 撤内容就地错误、恢复重载）、
// 整组释放（hover.unwatch 出站、条目彻底终结不复活、重挂同 occurrence 是
// 全新实例）。真实布局/指针在 test/browser；真宿主租约与回收在集成层。
// 评审 P2 修复：打开按钮来源身份（组件根卡直接来源 B）与 PDF 首载结算时序
//（show 完成才兑现首结局——预布局可见态不算内容装载成功）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
  type EmbedAddonMountOptions,
} from '../../src/webview/embedCard'
import type { RefSourceContext } from '../../src/webview/refContentInstance'
import {
  __resetPdfjsSingletonsForTest,
  __setPdfAssetsForTest,
  type PdfAssetsConfig,
} from '../../src/webview/pdfRender'

installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\b.md'
const B_TEXT = ['# B 目标标题', '', '目标正文一段。', ''].join('\n')
const C_INNER = '内层目标'
const B_WITH_EMBED = ['# B 目标标题', '', `![[${C_INNER}]]`, ''].join('\n')
const C_FS = 'D:\\notes\\内层目标.md'
const C_TEXT = ['# 内层目标', '', '孙卡正文。', ''].join('\n')

interface Harness {
  manager: EmbedCardManager
  sent: WebviewToHost[]
}

function makeHarness(): Harness {
  const sent: WebviewToHost[] = []
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
  }
  return { manager: new EmbedCardManager(context), sent }
}

/** T06 组件容器挂载（生产经 controller.mountAddonRefEmbed 同一入口组装） */
function mountAddonEmbed(
  h: Harness,
  occurrence: string,
  targetText = 'b.md',
  opts: Partial<EmbedAddonMountOptions> = {},
  sourceOver: Partial<RefSourceContext> = {},
): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const source: RefSourceContext = {
    panelDocUri: SESSION.docUri ?? '',
    sourceDocUri: B_FS,
    range: { start: 0, end: 0 },
    occurrence,
    depth: 1,
    treeId: occurrence,
    readOnly: true,
    ...sourceOver,
  }
  h.manager.mountCardInto(host, targetText, 0, 0, 'reading', source, {
    addonSource: { instanceId: 'main', sourceFsPath: '' },
    ...opts,
  })
  return host
}

function requestOf(h: Harness, target = 'b.md'): Extract<WebviewToHost, { kind: 'hover.request' }> {
  const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request' && m.target === target)
  if (!req || req.kind !== 'hover.request') {
    throw new Error(`hover.request（${target}）未发出`)
  }
  return req
}

function okReply(
  req: Extract<WebviewToHost, { kind: 'hover.request' }>,
  text: string,
  fsPath: string,
): Extract<HoverPreviewResult, { ok: true }> {
  const base = (fsPath.split(/[\\/]/).pop() ?? fsPath).replace(/\.md$/, '')
  return {
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath, relPath: `${base}.md` },
    version: 2, text,
    range: { start: 0, end: text.length }, scope: { kind: 'full' },
    sourceLeaseId: `panel-1:source-${req.reqId}`,
  }
}

function loadOk(h: Harness, target = 'b.md', text = B_TEXT, fsPath = B_FS): void {
  h.manager.notifyResult(okReply(requestOf(h, target), text, fsPath))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('组件容器挂载与请求载荷', () => {
  it('挂载即出站 hover.request：addonSource 覆盖 + occurrenceId + retainSource，不带 child source', () => {
    const h = makeHarness()
    mountAddonEmbed(h, 'addon-ref-1', 'b.md', { addonSource: { instanceId: 'embed:b', sourceFsPath: B_FS } })
    const req = requestOf(h)
    expect(req.addonSource).toEqual({ instanceId: 'embed:b', sourceFsPath: B_FS })
    expect(req.occurrenceId).toBe('embed-occ-1') // hostId（P2-07 对外身份）
    expect(req.retainSource).toBe(true)
    expect(req.source).toBeUndefined()
    h.manager.dispose()
  })

  it('首载成功：内容渲染 + 首次结局一次性兑现 {ok:true}；刷新不重复兑现', () => {
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'b.md', { onFirstOutcome: (o) => outcomes.push(o) })
    loadOk(h)
    expect(outcomes).toEqual([{ ok: true }])
    expect(document.body.querySelector('.vsidian-reading-heading-1')?.textContent).toContain('B 目标标题')
    // changed 静默重载（同一 addonSource）不重复兑现
    h.manager.notifyInvalidated({ fsPath: B_FS, status: 'changed', generation: 1 })
    const reload = requestOf(h)
    expect(reload.addonSource).toEqual({ instanceId: 'main', sourceFsPath: '' })
    expect(reload.anchorOptional).toBe(true)
    h.manager.notifyResult({
      kind: 'hover.result', reqId: reload.reqId, instanceId: reload.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: 'b.md' }, version: 3, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
      sourceLeaseId: `panel-1:source-${reload.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    expect(outcomes).toHaveLength(1)
    h.manager.dispose()
  })

  it('目标失败：真实原因一次性兑现（not-found / anchor-invalid）', () => {
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'missing.md', { onFirstOutcome: (o) => outcomes.push(o) })
    const req = requestOf(h, 'missing.md')
    h.manager.notifyResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    expect(outcomes).toEqual([{ ok: false, reason: 'not-found' }])
    // 错误分态就地呈现（状态行命中目标原文）
    const state = document.body.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)
    expect(state?.textContent).toContain('missing.md')
    h.manager.dispose()
  })

  it('预算准入拒绝（maxDepth=0）：' + '一次性兑现 budget/depth，不发请求', () => {
    const h = makeHarness()
    const context: EmbedCardContext = {
      session: () => SESSION,
      send: (message) => { h.sent.push(message) },
      codeHighlight: () => true,
      maxHeightPx: () => 480,
      maxDepth: () => 0,
    }
    const strict = new EmbedCardManager(context)
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    strict.mountCardInto(host, 'b.md', 0, 0, 'reading', {
      panelDocUri: SESSION.docUri ?? '', sourceDocUri: B_FS,
      range: { start: 0, end: 0 }, occurrence: 'addon-ref-1', depth: 1, treeId: 'addon-ref-1', readOnly: true,
    }, { addonSource: { instanceId: 'main', sourceFsPath: '' }, onFirstOutcome: (o) => outcomes.push(o) })
    expect(outcomes).toEqual([{ ok: false, reason: 'depth' }])
    strict.dispose()
  })
})

describe('只读硬边界（R-U04 复验）', () => {
  it('模式切换入口不出现、点击模式入口零写端口、保存入口隐藏', () => {
    const h = makeHarness()
    const host = mountAddonEmbed(h, 'addon-ref-1')
    loadOk(h)
    const modeBtn = host.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
    expect(modeBtn?.style.display).toBe('none')
    expect(modeBtn?.tabIndex).toBe(-1)
    modeBtn?.click() // 防御：即便触发也无端口
    const saveBtn = host.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.save}`)
    expect(saveBtn?.style.display).toBe('none')
    expect(h.sent.filter((m) => m.kind === 'refEdit.bind')).toHaveLength(0)
    h.manager.dispose()
  })

  it('递归孙卡继承只读：B 内 ![[内层目标]] 的孙卡请求走 child source，装载后无写端口', () => {
    const h = makeHarness()
    mountAddonEmbed(h, 'addon-ref-1', 'b.md', {}, { sourceDocUri: B_FS })
    loadOk(h, 'b.md', B_WITH_EMBED)
    // 孙卡（C）请求：child source（parentInstanceId = 根卡 hostId）
    const childReq = requestOf(h, C_INNER)
    expect(childReq.source).toMatchObject({ parentInstanceId: 'embed-occ-1', sourceDocUri: B_FS })
    expect(childReq.addonSource).toBeUndefined()
    h.manager.notifyResult({
      kind: 'hover.result', reqId: childReq.reqId, instanceId: childReq.instanceId, ok: true,
      target: { fsPath: C_FS, relPath: '内层目标.md' }, version: 2, text: C_TEXT,
      range: { start: 0, end: C_TEXT.length }, scope: { kind: 'full' },
      depth: 2, expansionPath: [], sourceLeaseId: `panel-1:source-${childReq.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    expect(h.sent.filter((m) => m.kind === 'refEdit.bind')).toHaveLength(0)
    h.manager.dispose()
  })
})

describe('目标失效与恢复（R-U11）', () => {
  it('deleted：撤下内容就地错误分态；恢复（changed）重载', () => {
    const h = makeHarness()
    mountAddonEmbed(h, 'addon-ref-1')
    loadOk(h)
    const watch = h.sent.find((m) => m.kind === 'hover.watch')
    expect(watch && watch.kind === 'hover.watch' && watch.fsPath).toBe(B_FS)
    h.manager.notifyInvalidated({ fsPath: B_FS, status: 'deleted', generation: 1 })
    const state = document.body.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)
    expect(state?.classList.contains(EMBED_CARD_CLASS_NAMES.stateError)).toBe(true)
    // 恢复：订阅保持（无 unwatch），changed 推送重载
    expect(h.sent.filter((m) => m.kind === 'hover.unwatch')).toHaveLength(0)
    h.manager.notifyInvalidated({ fsPath: B_FS, status: 'changed', generation: 2 })
    const reload = requestOf(h)
    h.manager.notifyResult({
      kind: 'hover.result', reqId: reload.reqId, instanceId: reload.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: 'b.md' }, version: 4, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
      sourceLeaseId: `panel-1:source-${reload.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    const stateAfter = document.body.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)
    expect(stateAfter?.style.display).toBe('none')
    h.manager.dispose()
  })
})

describe('整组释放（R-U07 复验）', () => {
  it('releaseEmbedMount：unwatch 出站、条目彻底终结、重挂同 occurrence 是全新实例', () => {
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = mountAddonEmbed(h, 'addon-ref-1', 'b.md', { onFirstOutcome: (o) => outcomes.push(o) })
    loadOk(h)
    expect(h.sent.some((m) => m.kind === 'hover.watch')).toBe(true)
    h.manager.releaseEmbedMount(host)
    expect(host.textContent).toBe('')
    expect(h.sent.some((m) => m.kind === 'hover.unwatch')).toBe(true)
    // 迟到回包：无配对（条目已终结，不复活缓存）
    const staleReq = requestOf(h)
    expect(h.manager.notifyResult({
      kind: 'hover.result', reqId: staleReq.reqId + 999, instanceId: staleReq.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: 'b.md' }, version: 9, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
    } as Extract<HoverPreviewResult, { ok: true }>)).toBe(false)
    // 重挂同一 occurrence：全新实例（新请求、不渲染旧缓存）
    const host2 = mountAddonEmbed(h, 'addon-ref-1', 'b.md', { onFirstOutcome: (o) => outcomes.push(o) })
    expect(outcomes).toEqual([{ ok: true }]) // 重挂未装载不兑现
    expect(requestOf(h).reqId).toBeGreaterThan(staleReq.reqId)
    expect(host2.querySelector(`.${EMBED_CARD_CLASS_NAMES.scroll}`)).not.toBeNull()
    h.manager.dispose()
  })

  it('pending 释放后首结局不再兑现（迟到结果不重挂）', () => {
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = mountAddonEmbed(h, 'addon-ref-1', 'b.md', { onFirstOutcome: (o) => outcomes.push(o) })
    const req = requestOf(h)
    h.manager.releaseEmbedMount(host)
    h.manager.notifyResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: 'b.md' }, version: 2, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
      sourceLeaseId: `panel-1:source-${req.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    expect(outcomes).toHaveLength(0)
    expect(host.textContent).toBe('')
    h.manager.dispose()
  })

  it('同目标双实例独立（R-U10）：两挂载两请求，互不影响', () => {
    const h = makeHarness()
    mountAddonEmbed(h, 'addon-ref-1', 'b.md')
    mountAddonEmbed(h, 'addon-ref-2', 'b.md')
    const reqs = h.sent.filter((m) => m.kind === 'hover.request')
    expect(reqs).toHaveLength(2)
    // 各自配对回包（instanceId 不同）
    const first = reqs[0] as Extract<WebviewToHost, { kind: 'hover.request' }>
    const second = reqs[1] as Extract<WebviewToHost, { kind: 'hover.request' }>
    expect(first.instanceId).not.toBe(second.instanceId)
    loadOk(h)
    h.manager.notifyResult({
      kind: 'hover.result', reqId: second.reqId, instanceId: second.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: 'b.md' }, version: 2, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
      sourceLeaseId: `panel-1:source-${second.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    const scrollEls = document.querySelectorAll(`.${EMBED_CARD_CLASS_NAMES.scroll}`)
    expect(scrollEls).toHaveLength(2)
    h.manager.dispose()
  })
})

describe('打开按钮来源身份（评审 P2：组件根卡直接来源 B）', () => {
  const B_SUB_FS = 'D:\\notes\\sub\\b.md'
  const C_SUB_FS = 'D:\\notes\\sub\\c.md'
  const C_SUB_TEXT = ['# C 子目录目标', '', '同名目标按 B 目录解析。', ''].join('\n')

  /** A/B 不同目录且面板目录存在同名目标（/notes/c.md 与 /notes/sub/c.md
   *  都在场）——宿主按 sourceDocUri=B 才解析到 sub 侧；webview 侧契约是
   *  打开消息携带 B 身份（fsPath 形态） */
  it('组件根卡（explicitSourceDoc）：打开消息携带 sourceDocUri=B（embed 来源 fsPath，非面板文档）', () => {
    const h = makeHarness()
    const host = mountAddonEmbed(h, 'addon-ref-1', 'c.md', {}, {
      sourceDocUri: B_SUB_FS,
      explicitSourceDoc: true,
    })
    loadOk(h, 'c.md', C_SUB_TEXT, C_SUB_FS)
    const openBtn = host.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.open}`)
    expect(openBtn).not.toBeNull()
    openBtn!.click()
    const activate = h.sent.find((m) => m.kind === 'wikilink.activate')
    expect(activate && activate.kind === 'wikilink.activate' && activate.sourceDocUri)
      .toBe(B_SUB_FS)
    h.manager.dispose()
  })

  it('组件根卡无显式来源（main 来源兜底面板文档）：打开消息不带 sourceDocUri（按面板目录解析，与正文根卡同语义）', () => {
    const h = makeHarness()
    const host = mountAddonEmbed(h, 'addon-ref-1', 'c.md')
    loadOk(h, 'c.md', C_SUB_TEXT, C_SUB_FS)
    host.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.open}`)!.click()
    const activate = h.sent.find((m) => m.kind === 'wikilink.activate')
    expect(activate && activate.kind === 'wikilink.activate' && 'sourceDocUri' in activate)
      .toBe(false)
    h.manager.dispose()
  })

  it('递归孙卡对照不回归：打开消息携带 sourceDocUri=父装载目标（parentInstanceId 链）', () => {
    const h = makeHarness()
    mountAddonEmbed(h, 'addon-ref-1', 'b.md', {}, { sourceDocUri: B_SUB_FS, explicitSourceDoc: true })
    loadOk(h, 'b.md', ['# B 目标标题', '', '![[c.md]]', ''].join('\n'), B_SUB_FS)
    // 孙卡（c.md）装载：child source（parentInstanceId 链）
    const childReq = requestOf(h, 'c.md')
    h.manager.notifyResult({
      kind: 'hover.result', reqId: childReq.reqId, instanceId: childReq.instanceId, ok: true,
      target: { fsPath: C_SUB_FS, relPath: 'c.md' }, version: 2, text: C_SUB_TEXT,
      range: { start: 0, end: C_SUB_TEXT.length }, scope: { kind: 'full' },
      depth: 2, expansionPath: [], sourceLeaseId: `panel-1:source-${childReq.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
    // 孙卡的打开按钮（孙卡卡壳内的 open，非根卡的）
    const cards = document.body.querySelectorAll(`.${EMBED_CARD_CLASS_NAMES.card}`)
    expect(cards.length).toBe(2)
    const childOpen = cards[1]!.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.open}`)
    expect(childOpen).not.toBeNull()
    childOpen!.click()
    const activates = h.sent.filter((m) => m.kind === 'wikilink.activate')
    expect(activates.length).toBe(1) // 根卡 open 未点击——只有孙卡一次
    expect(activates[0]!.kind === 'wikilink.activate' && activates[0]!.sourceDocUri).toBe(B_SUB_FS)
    h.manager.dispose()
  })
})

// ---- 评审 P2：PDF 首载结算时序（mountEmbed 的 promise 兑现） ----
// jsdom 以受控 pdfjs 替身驱动：文档 promise 手动兑现，精确卡住「show 完成
// 前」的时刻。真实绘制在浏览器/集成层（embedCardPdf 同款替身口径）。

const PDF_ASSETS: PdfAssetsConfig = {
  mainJs: 'https://assets.test/pdfMain.js',
  workerJs: 'https://assets.test/pdfWorker.js',
  cMapUrl: 'https://assets.test/cmaps',
  fontUrl: 'https://assets.test/fonts',
  wasmUrl: 'https://assets.test/wasm',
  iccUrl: 'https://assets.test/iccs',
}

interface FakePdfDoc {
  numPages: number
  getPage(): unknown
}

/** 受控 pdfjs：getDocument 的 promise 由测试手动 resolve（成功文档）/reject
 *  （InvalidPDF 等——err.name 分态与生产 classifyLoadError 同源）。
 *  opts.holdRender：页渲染 promise 挂起，由 renderReleases 队列手动释放
 *  （cancel 以 RenderingCancelledException 拒绝——首帧在途/重排矩阵）；
 *  opts.failRenderAt / failViewportAt：第 N 次调用同步抛错（明确失败
 *  路径经外层 catch → setError('resource')）。*/
function installControllablePdfjs(opts?: {
  holdRender?: boolean
  failRenderAt?: number
  failViewportAt?: number
}): {
  resolveDoc: (numPages: number) => void
  rejectDoc: (err: unknown) => void
  renderReleases: Array<() => void>
} {
  let settleResolve: ((doc: FakePdfDoc) => void) | null = null
  let settleReject: ((err: unknown) => void) | null = null
  const pending = new Promise<FakePdfDoc>((resolve, reject) => {
    settleResolve = resolve
    settleReject = reject
  })
  const renderReleases: Array<() => void> = []
  let renderCalls = 0
  let viewportCalls = 0
  const lib = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: pending,
      destroy: async () => {},
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
  return {
    resolveDoc: (numPages) => settleResolve!({
      numPages,
      getPage: () => ({
        getViewport: ({ scale }: { scale: number }) => {
          viewportCalls++
          if (opts?.failViewportAt !== undefined && viewportCalls === opts.failViewportAt) {
            throw new Error('viewport-fail')
          }
          return { width: 612 * scale, height: 792 * scale }
        },
        render: ({ canvas, viewport }: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => {
          renderCalls++
          if (opts?.failRenderAt !== undefined && renderCalls === opts.failRenderAt) {
            throw new Error('render-fail')
          }
          const paint = (): void => {
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
          }
          if (opts?.holdRender !== true) {
            return {
              promise: Promise.resolve().then(paint),
              cancel: () => {},
            }
          }
          let rejectOuter: ((err: Error) => void) | undefined
          const task = {
            promise: new Promise<void>((resolve, reject) => {
              rejectOuter = reject
              renderReleases.push(() => {
                paint()
                resolve()
              })
            }),
            cancel: () => {
              const err = new Error('cancelled')
              err.name = 'RenderingCancelledException'
              task.promise.catch(() => {})
              rejectOuter?.(err)
            },
          }
          return task
        },
      }),
    }),
    rejectDoc: (err) => settleReject!(err),
    renderReleases,
  }
}

/** PDF 载荷成功回包（组件嵌入目标） */
function pdfReply(
  req: Extract<WebviewToHost, { kind: 'hover.request' }>,
): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    contentKind: 'pdf',
    target: { fsPath: 'D:\\notes\\sub\\c.pdf', relPath: 'c.pdf' },
    version: 2, text: '',
    range: { start: 0, end: 0 }, scope: { kind: 'pdf' },
    pdf: { uri: 'https://files.test/c.pdf?v=2', bytes: 1234 },
    sourceLeaseId: `panel-1:source-${req.reqId}`,
  } as Extract<HoverPreviewResult, { ok: true }>
}

/** microtask 泵：推进 show 的装载链直到谓词成立（超时即失败） */
async function pumpUntil(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200 && !pred(); i++) {
    await Promise.resolve()
  }
  expect(pred(), label).toBe(true)
}

/** ResizeObserver 替身（jsdom 无实现）：捕获观察回调并手动触发宽度变化
 *  （卡片挂载前置入——PdfHoverView 构造按 typeof 探测装配） */
function installResizeObserverStub(): { trigger: (width: number) => void } {
  const callbacks: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  return {
    trigger: (width) => {
      for (const callback of callbacks) {
        callback([{ contentRect: { width } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
      }
    },
  }
}

describe('PDF 首载结算时序（评审 P2：show 完成才兑现首结局）', () => {
  beforeEach(() => {
    __setPdfAssetsForTest(PDF_ASSETS)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) && this.style.display !== 'none' ? 448 : 0
    })
  })

  afterEach(() => {
    __resetPdfjsSingletonsForTest()
    __setPdfAssetsForTest(null)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    vi.unstubAllGlobals()
  })

  it('文档 promise pending 期间不结算首结局（预布局可见态不算内容装载成功）', async () => {
    const pdfjs = installControllablePdfjs()
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    // 文档 promise 悬而未决：无论 pump 多少个 microtask，首结局都不得兑现
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
    }
    expect(outcomes).toEqual([])
    // 收尾：成功兑现（避免悬挂的 loading show 影响后续用例）
    pdfjs.resolveDoc(3)
    await pumpUntil(() => outcomes.length === 1, '成功装载后应兑现 {ok:true}')
    expect(outcomes).toEqual([{ ok: true }])
    h.manager.dispose()
  })

  it('InvalidPDFException → 首结局 {ok:false}（异步失败翻得回来，就地错误分态）', async () => {
    const pdfjs = installControllablePdfjs()
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.rejectDoc(Object.assign(new Error('invalid pdf'), { name: 'InvalidPDFException' }))
    await pumpUntil(() => outcomes.length === 1, '装载失败后应兑现 {ok:false}')
    expect(outcomes).toEqual([{ ok: false, reason: 'read-failed' }])
    // 错误分态就地呈现（状态行进入错误显示）
    const state = host.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)
    expect(state?.classList.contains(EMBED_CARD_CLASS_NAMES.stateError)).toBe(true)
    expect(state?.style.display).toBe('')
    h.manager.dispose()
  })

  it('成功 load → 首结局 {ok:true}（内容装载成功才返回成功句柄）', async () => {
    const pdfjs = installControllablePdfjs()
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    // 等内容真实呈现且首结局兑现（probe 的 content 置位先于 show().then
    // 回调一个 microtask——谓词同时覆盖两者）
    await pumpUntil(() => h.manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content') &&
      outcomes.length === 1, 'PDF 内容呈现且首结局兑现')
    expect(outcomes).toEqual([{ ok: true }])
    h.manager.dispose()
  })

  it('释放后迟到失败不兑现（代次守卫契约维持）', async () => {
    const pdfjs = installControllablePdfjs()
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    for (let i = 0; i < 10; i++) {
      await Promise.resolve()
    }
    expect(outcomes).toEqual([])
    // show pending 期间整组释放：firstOutcome 作废
    h.manager.releaseEmbedMount(host)
    pdfjs.rejectDoc(Object.assign(new Error('invalid pdf'), { name: 'InvalidPDFException' }))
    for (let i = 0; i < 30; i++) {
      await Promise.resolve()
    }
    expect(outcomes).toEqual([])
    h.manager.dispose()
  })

  // ---- 第二轮评审 P2 复现矩阵：重排 / 同版本刷新 × 成功 / 失败 / 释放 ----

  it('首帧在途期间容器重排：不提前兑现，替代绘制完成后 {ok:true} 一次（评审复现 A）', async () => {
    const ro = installResizeObserverStub()
    const pdfjs = installControllablePdfjs({ holdRender: true })
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    await pumpUntil(() => pdfjs.renderReleases.length >= 1, '首帧绘制已启动')
    const base = pdfjs.renderReleases.length
    // 容器宽度变化（ResizeObserver 重排）：取消旧绘制 + 替代绘制入队
    ro.trigger(300)
    for (let i = 0; i < 30; i++) {
      await Promise.resolve()
    }
    expect(outcomes, '重排取消不得提前兑现（评审 P2）').toEqual([])
    await pumpUntil(() => pdfjs.renderReleases.length > base, '替代绘制已启动')
    const end = pdfjs.renderReleases.length
    for (let i = base; i < end; i++) {
      pdfjs.renderReleases[i]!()
    }
    await pumpUntil(() => outcomes.length === 1, '替代绘制完成后兑现首结局')
    expect(outcomes).toEqual([{ ok: true }])
    h.manager.dispose()
  })

  it('首帧在途期间同版本刷新：不提前兑现、不永久 loading；内容呈现后 {ok:true} 一次（评审复现 B）', async () => {
    const pdfjs = installControllablePdfjs({ holdRender: true })
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    await pumpUntil(() => pdfjs.renderReleases.length >= 1, '首帧绘制已启动')
    const base = pdfjs.renderReleases.length
    // 同版本刷新：changed 失效触发重发，资源 URI 不变（版本表同 mtime/size）
    h.manager.notifyInvalidated({ fsPath: 'D:\\notes\\sub\\c.pdf', status: 'changed', generation: 1 })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    for (let i = 0; i < 40; i++) {
      await Promise.resolve()
    }
    expect(outcomes, '同 URI 重入不得提前兑现（评审 P2）').toEqual([])
    // 在途首绘完成——两路 show 共享的待等呈现事件（不被重入作废）
    for (let i = 0; i < base; i++) {
      pdfjs.renderReleases[i]!()
    }
    await pumpUntil(() => outcomes.length === 1, '呈现落定后兑现首结局')
    expect(outcomes).toEqual([{ ok: true }])
    expect(
      h.manager.probe().some((c) => c.pdf != null && c.pdf.phase === 'content'),
      '不永久 loading（评审复现 B 的第二失败形态）',
    ).toBe(true)
    h.manager.dispose()
  })

  it('重排等待期间释放：释放终结等待（不兑现成功、不冒充内容）', async () => {
    const ro = installResizeObserverStub()
    const pdfjs = installControllablePdfjs({ holdRender: true })
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    const host = mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    await pumpUntil(() => pdfjs.renderReleases.length >= 1, '首帧绘制已启动')
    ro.trigger(300)
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
    }
    // 整组释放（content.onDispose → 视图 dispose → 等待终结）
    h.manager.releaseEmbedMount(host)
    for (let i = 0; i < 40; i++) {
      await Promise.resolve()
    }
    expect(outcomes).toEqual([])
    h.manager.dispose()
  })

  it('重排替代绘制失败：首结局 {ok:false} 一次（明确失败不冒充成功）', async () => {
    const ro = installResizeObserverStub()
    // 第 3 次 render 调用（替代绘制的首页——首帧页 1/2 已耗 2 次）同步抛错
    const pdfjs = installControllablePdfjs({ holdRender: true, failRenderAt: 3 })
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    await pumpUntil(() => pdfjs.renderReleases.length >= 1, '首帧绘制已启动')
    ro.trigger(300)
    await pumpUntil(() => outcomes.length === 1, '替代绘制失败后兑现首结局')
    expect(outcomes).toEqual([{ ok: false, reason: 'read-failed' }])
    h.manager.dispose()
  })

  it('失败后同 URI 刷新：不重复兑现、不冒充成功（error 态重入早退路径）', async () => {
    const pdfjs = installControllablePdfjs({ failViewportAt: 1 })
    const h = makeHarness()
    const outcomes: Array<{ ok: boolean; reason?: string }> = []
    mountAddonEmbed(h, 'addon-ref-1', 'c.pdf', { onFirstOutcome: (o) => outcomes.push(o) })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    pdfjs.resolveDoc(3)
    await pumpUntil(() => outcomes.length === 1, '绘制失败后兑现 {ok:false}')
    expect(outcomes).toEqual([{ ok: false, reason: 'read-failed' }])
    // 同 URI 刷新到达：首结局一次性——不重复兑现，也不因重试渲染可能自愈
    // 而补发成功（已兑现的失败结局不回改）
    h.manager.notifyInvalidated({ fsPath: 'D:\\notes\\sub\\c.pdf', status: 'changed', generation: 1 })
    h.manager.notifyResult(pdfReply(requestOf(h, 'c.pdf')))
    for (let i = 0; i < 40; i++) {
      await Promise.resolve()
    }
    expect(outcomes).toHaveLength(1)
    h.manager.dispose()
  })
})
