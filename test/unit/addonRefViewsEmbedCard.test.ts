// T06（#545）附加组件只读引用嵌入的 EmbedCardManager 挂载契约（模块级
// jsdom 直驱）：组件容器挂载（readOnly 来源 + addonSource 覆盖随请求出站）、
// 首次装载结局一次性兑现（content / 真实失败原因 / 预算准入）、只读硬边界
//（模式切换入口不出现、零写端口、递归孙卡继承只读）、目标失效沿既有分态
//（changed 静默重载携带同一 addonSource、deleted 撤内容就地错误、恢复重载）、
// 整组释放（hover.unwatch 出站、条目彻底终结不复活、重挂同 occurrence 是
// 全新实例）。真实布局/指针在 test/browser；真宿主租约与回收在集成层。
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
