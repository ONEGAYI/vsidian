// @vitest-environment jsdom
// #292 骨架屏控制器生命周期契约：挂载收编（空窗②）、首帧撤除调度、
// 测试冻结（hold）与 release、阅读恢复模式的收编落点、撤除后容器还原。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import {
  SKELETON_ELEMENT_ID,
  SKELETON_HOLD_GLOBAL,
  SKELETON_SHOWN_AT_GLOBAL,
} from '../../src/shared/skeletonTiming'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  ;(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null
}

const DOC_URI = 'file:///d%3A/notes/skeleton.md'
const mountedParents: HTMLElement[] = []
afterEach(() => {
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
  delete (globalThis as Record<string, unknown>)[SKELETON_HOLD_GLOBAL]
  delete (globalThis as Record<string, unknown>)[SKELETON_SHOWN_AT_GLOBAL]
  vi.useRealTimers()
})

const DOC = '# 标题\n\n正文段落甲\n正文段落乙\n'

interface BridgeHarness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(saved?: unknown): BridgeHarness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T>() => saved as T | undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

/** 预置宿主骨架装配（生产 HTML 形态）：#app 内骨架 + 呈现时刻打点 */
function mountPanel(h: BridgeHarness, opts: { hold?: boolean; shownAgoMs?: number } = {}) {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  parent.innerHTML = `<div id="${SKELETON_ELEMENT_ID}" class="vsidian-skeleton" aria-hidden="true"><div class="vsidian-skeleton-column"><div class="vsidian-skeleton-block"></div></div></div>`
  document.body.appendChild(parent)
  mountedParents.push(parent)
  if (opts.hold === true) {
    ;(globalThis as Record<string, unknown>)[SKELETON_HOLD_GLOBAL] = true
  }
  ;(globalThis as Record<string, unknown>)[SKELETON_SHOWN_AT_GLOBAL] =
    performance.now() - (opts.shownAgoMs ?? 10)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
  return { c, parent }
}

const skeletonIn = (parent: HTMLElement): HTMLElement | null =>
  parent.querySelector<HTMLElement>(`#${SKELETON_ELEMENT_ID}`)

describe('#292 骨架屏收编与撤除（jsdom 控制器）', () => {
  it('生产路径：init 全文落地后骨架按计划撤除，容器宿主类一并还原', async () => {
    const h = makeBridge()
    const { parent } = mountPanel(h, { shownAgoMs: 10 })
    // 收编进 live 容器（默认模式），呈现时刻早于延时——就绪即撤
    const skeleton = skeletonIn(parent)
    expect(skeleton, '挂载后骨架应已收编在场').not.toBeNull()
    expect(skeleton!.closest('.vsidian-main')).not.toBeNull()
    expect(parent.querySelector('.vsidian-skeleton-host')).not.toBeNull()
    await vi.waitFor(() => {
      expect(skeletonIn(parent)).toBeNull()
    }, { timeout: 2000 })
    expect(parent.querySelector('.vsidian-skeleton-host')).toBeNull()
  })

  it('hold 冻结：init 后骨架保持在场并回报状态，release 后立即撤除', async () => {
    const h = makeBridge()
    const { c, parent } = mountPanel(h, { hold: true })
    await vi.waitFor(() => {
      const report = h.sent.find((m) => m.kind === '_test.skeleton.report')
      expect(report, '冻结装配下应有状态回报').toBeDefined()
    }, { timeout: 2000 })
    const report = h.sent.find((m) => m.kind === '_test.skeleton.report') as
      Extract<WebviewToHost, { kind: '_test.skeleton.report' }>
    expect(report.present).toBe(true)
    expect(report.container).toBe('live')
    expect(typeof report.shownAt).toBe('number')
    expect(skeletonIn(parent), '冻结期间骨架不得撤除').not.toBeNull()
    c.handleHostMessage({ kind: '_test.skeleton.release' })
    expect(skeletonIn(parent)).toBeNull()
    expect(parent.querySelector('.vsidian-skeleton-host')).toBeNull()
    const last = h.sent.filter((m) => m.kind === '_test.skeleton.report').at(-1) as
      Extract<WebviewToHost, { kind: '_test.skeleton.report' }>
    expect(last.present).toBe(false)
    expect(last.container).toBeNull()
  })

  it('生产装配（无 hold 全局）不发送任何骨架状态回报', async () => {
    const h = makeBridge()
    const { parent } = mountPanel(h)
    await vi.waitFor(() => {
      expect(skeletonIn(parent)).toBeNull()
    }, { timeout: 2000 })
    expect(h.sent.filter((m) => m.kind === '_test.skeleton.report')).toHaveLength(0)
  })

  it('阅读恢复模式：骨架收编进主区覆盖层，回报落点为 reading', () => {
    const h = makeBridge({ seq: 0, viewMode: 'reading' })
    const { parent } = mountPanel(h, { hold: true })
    const skeleton = skeletonIn(parent)
    expect(skeleton, '阅读恢复下骨架应收编在场').not.toBeNull()
    expect(skeleton!.closest('.vsidian-main')).not.toBeNull()
    // 落点不进视图容器（阅读虚拟化会整容器清空子树）
    expect(skeleton!.closest('.vsidian-view-reading')).toBeNull()
    const report = h.sent.find((m) => m.kind === '_test.skeleton.report') as
      Extract<WebviewToHost, { kind: '_test.skeleton.report' }>
    expect(report.container).toBe('reading')
  })

  it('宿主未装配骨架（旧产物/设置页）：mount 与 init 均跳过收编', async () => {
    const h = makeBridge()
    const c = new WebviewSyncController(h.bridge)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    mountedParents.push(parent)
    c.mount(parent)
    c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
    expect(skeletonIn(parent)).toBeNull()
    expect(parent.querySelector('.vsidian-skeleton-host')).toBeNull()
    // 撤除调度对无骨架面板是空操作；release 亦无害
    c.handleHostMessage({ kind: '_test.skeleton.release' })
    expect(h.sent.filter((m) => m.kind === '_test.skeleton.report')).toHaveLength(0)
  })
})
