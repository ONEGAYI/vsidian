// @vitest-environment jsdom
// T06（#355）统一视图注册表与 SDK views 面的契约测试：
// - 句柄清单/信息（main 双态、embed、hover 只读）与 onCreated/onDisposed
// - 快照分派（live 实例 / 只读登记 / 未知句柄 view-disposed）
// - applyEdits 的来源注入（addonId/opId 由 SDK 层添加，作者请求不携带）
//   与拒绝矩阵（read-only / stale-snapshot / invalid-request）
// - 装载器 views 面的生命周期边界（卸载后句柄拒绝、设置页无 views 面）
import { describe, expect, it, afterEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { LiveEditorInstance, type LiveEditorInstanceDeps } from '../../src/webview/liveInstance'
import { ImageResourceManager } from '../../src/webview/imageResource'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderEnv,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { AddonPageOutbound, AddonPageRegistration, VsidianAddonPageSdk } from '../../src/shared/addonPage'
import type { WebviewToHost } from '../../src/shared/protocol'
import type { AddonViewInfo } from '../../src/shared/addonEditApi'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeInstanceDeps(sent: WebviewToHost[]): LiveEditorInstanceDeps {
  return {
    send: (message) => sent.push(message),
    persistState: () => {},
    images: new ImageResourceManager({ isDirectSrc: () => false, requestHost: () => {} }),
    isLiveActive: () => true,
    initialDark: false,
  }
}

function mountLive(sent: WebviewToHost[], sessionId: string): LiveEditorInstance {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const instance = new LiveEditorInstance(host, makeInstanceDeps(sent))
  instance.setSession(sessionId, `file:///${sessionId}.md`)
  instance.handleFullSync(1, 'alpha', {})
  return instance
}

afterEach(() => {
  document.body.innerHTML = ''
  for (const view of document.querySelectorAll('.cm-editor')) {
    EditorView.findFromDOM(view as HTMLElement)?.destroy()
  }
})

describe('AddonViewRegistry（页面级视图注册表）', () => {
  it('list/infoOf：main 双态、embed、hover 只读；订阅 onCreated/onDisposed', () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const created: AddonViewInfo[] = []
    const disposed: AddonViewInfo[] = []
    registry.onCreated((info) => created.push(info))
    registry.onDisposed((info) => disposed.push(info))

    let mode: 'live' | 'reading' = 'live'
    const instance = mountLive(sent, 'main-s')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => mode, instance })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ instanceId: 'main', viewType: 'main', editable: true, mode: 'live' })

    mode = 'reading'
    expect(registry.infoOf('main')!.editable).toBe(false)
    expect(registry.infoOf('main')!.mode).toBe('reading')

    const embed = mountLive(sent, 'embed-s')
    registry.registerLive({ viewType: 'embed', instanceId: 'embed:occ-1', targetDocUri: 'file:///b.md', mode: () => 'live', instance: embed })
    registry.registerReadonly({ viewType: 'hover', instanceId: 'hover:occ-2', targetDocUri: 'file:///c.md', text: 'hovered', version: 3 })

    const ids = registry.list().map((v) => v.instanceId).sort()
    expect(ids).toEqual(['embed:occ-1', 'hover:occ-2', 'main'])

    registry.unregister('embed:occ-1')
    expect(disposed.map((v) => v.instanceId)).toEqual(['embed:occ-1'])
    expect(registry.infoOf('embed:occ-1')).toBeUndefined()
    instance.destroy()
    embed.destroy()
  })

  it('snapshotOf：live 实例快照 / hover 只读快照 / 未知句柄 view-disposed', () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => 'live', instance })
    registry.registerReadonly({ viewType: 'hover', instanceId: 'hover:h1', targetDocUri: 'file:///c.md', text: 'content', version: 9 })

    const live = registry.snapshotOf('main')
    expect(live.ok).toBe(true)
    if (live.ok) {
      expect(live.snapshot.text).toBe('alpha')
      expect(live.snapshot.version).toBe(1)
      expect(live.snapshot.revision).toBeGreaterThan(0)
    }
    const ro = registry.snapshotOf('hover:h1')
    expect(ro).toEqual({
      ok: true,
      snapshot: { text: 'content', selections: [], version: 9, revision: 0 },
    })
    expect(registry.snapshotOf('nope')).toEqual({ ok: false, reason: 'view-disposed' })
    instance.destroy()
  })

  it('applyEdits：来源注入（addonId/opId 由调用方层添加）；hover 拒绝 read-only、reading 拒绝、非法请求拒绝', async () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    let mode: 'live' | 'reading' = 'live'
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => mode, instance })
    registry.registerReadonly({ viewType: 'hover', instanceId: 'hover:h1', targetDocUri: 'file:///c.md', text: 'c', version: 1 })

    expect(await registry.applyEdits({ addonId: 'pub.addon', opId: 'op-9', instanceId: 'hover:h1',
      request: { revision: 0, changes: [] } })).toEqual({ ok: false, reason: 'read-only' })
    expect(await registry.applyEdits({ addonId: 'pub.addon', opId: 'op-9', instanceId: 'ghost',
      request: { revision: 0, changes: [] } })).toEqual({ ok: false, reason: 'view-disposed' })

    mode = 'reading'
    expect(await registry.applyEdits({ addonId: 'pub.addon', opId: 'op-9', instanceId: 'main',
      request: { revision: 0, changes: [{ offset: 0, length: 0, text: 'x' }] } })).toEqual({ ok: false, reason: 'read-only' })
    mode = 'live'

    expect(await registry.applyEdits({ addonId: 'pub.addon', opId: 'op-9', instanceId: 'main',
      request: { revision: -1, changes: [] } })).toEqual({ ok: false, reason: 'invalid-request' })

    const revision = registry.snapshotOf('main').ok ? (registry.snapshotOf('main') as { ok: true; snapshot: { revision: number } }).snapshot.revision : 0
    const promise = registry.applyEdits({
      addonId: 'pub.addon', opId: 'op-42', instanceId: 'main',
      request: { revision, changes: [{ offset: 0, length: 0, text: 'X' }] },
    })
    const req = sent.find((m) => m.kind === 'edit.request') as Extract<WebviewToHost, { kind: 'edit.request' }>
    // 来源注入：请求 origin 携带调用方层提供的 addonId/opId（作者请求结构上不可携带）
    expect(req.origin).toEqual({ addonId: 'pub.addon', opId: 'op-42', undo: 'atomic' })
    instance.handleEditAck({ kind: 'edit.ack', seq: req.seq, ok: true, version: 2 })
    expect(await promise).toEqual({ ok: true, credential: { opId: 'op-42', version: 2 } })
    instance.destroy()
  })

  it('setSelectionOf/revealOf 透传 live 实例（非 live 视图拒绝）', () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => 'live', instance })
    expect(registry.setSelectionOf('main', [{ anchor: 1, head: 2 }])).toBe(true)
    expect(registry.revealOf('main', 1)).toBe(true)
    expect(registry.setSelectionOf('hover:x', [{ anchor: 0, head: 0 }])).toBe(false)
    instance.destroy()
  })
})

describe('装载器 SDK views 面（生命周期边界）', () => {
  function loaderHarness(registry: AddonViewRegistry): { handle: AddonPageLoaderHandle; sdk: () => VsidianAddonPageSdk | undefined; sent: AddonPageOutbound[] } {
    const sent: AddonPageOutbound[] = []
    const registrations: AddonPageRegistration[] = []
    ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
    let captured: VsidianAddonPageSdk | undefined
    const env: AddonPageLoaderEnv = {
      page: 'editor',
      addonViews: registry,
      send: (message) => sent.push(message),
      loadScript: () => Promise.resolve({ ok: true }),
      loadCss: () => Promise.resolve('denied'),
      now: () => 1_000,
      scheduleTimeout: (callback) => ({ cancel: () => void callback }),
    }
    const handle = installAddonPageLoader(env)
    registrations.push({
      addonId: 'pub.addon',
      factory: (sdk) => {
        captured = sdk
      },
      registeredAt: 1_000,
    })
    return { handle, sdk: () => captured, sent }
  }

  it('views 面经 SDK 注入：句柄 applyEdits 的 opId 由装载器生成（来源注入完整链）', async () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => 'live', instance })
    const { handle, sdk } = loaderHarness(registry)
    await handle.load({ addonId: 'pub.addon', generation: 1, page: 'editor', scriptUri: 'https://x/a.js' })
    expect(sdk()!.views).toBeDefined()

    const h = sdk()!.views!.get('main')
    expect(h?.info.instanceId).toBe('main')
    const revision = (h!.editor.getSnapshot() as { ok: true; snapshot: { revision: number } }).snapshot.revision
    const promise = h!.editor.applyEdits({ revision, changes: [{ offset: 0, length: 0, text: 'X' }] })
    const req = sent.find((m) => m.kind === 'edit.request') as Extract<WebviewToHost, { kind: 'edit.request' }>
    // opId 形态 = 装载代次 + 序号（组件不可自报）
    expect(req.origin).toEqual({ addonId: 'pub.addon', opId: 'g1-op1', undo: 'atomic' })
    instance.handleEditAck({ kind: 'edit.ack', seq: req.seq, ok: true, version: 2 })
    expect(await promise).toEqual({ ok: true, credential: { opId: 'g1-op1', version: 2 } })
    instance.destroy()
  })

  it('卸载后句柄拒绝（僵尸写入 view-disposed）；views.onCreated/onDisposed 转发订阅', async () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => 'live', instance })
    const { handle, sdk } = loaderHarness(registry)
    await handle.load({ addonId: 'pub.addon', generation: 1, page: 'editor', scriptUri: 'https://x/a.js' })
    const created: AddonViewInfo[] = []
    sdk()!.views!.onCreated((info) => created.push(info))

    registry.registerReadonly({ viewType: 'hover', instanceId: 'hover:h', targetDocUri: 'file:///c.md', text: 'c', version: 1 })
    expect(created.map((v) => v.instanceId)).toEqual(['hover:h'])

    await handle.unload('pub.addon', 1)
    const stale = sdk()!.views!.get('main')
    expect(await stale!.editor.applyEdits({ revision: 0, changes: [{ offset: 0, length: 0, text: 'X' }] }))
      .toEqual({ ok: false, reason: 'view-disposed' })
    expect(stale!.editor.setSelection([{ anchor: 0, head: 0 }])).toBe(false)
    instance.destroy()
  })

  it('同组件换代后旧代次句柄不复活：gen1 闭包句柄在 gen2 在场时仍拒绝', async () => {
    const sent: WebviewToHost[] = []
    const registry = new AddonViewRegistry()
    const instance = mountLive(sent, 's1')
    registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => 'live', instance })
    const registrations: AddonPageRegistration[] = []
    ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
    let sdkGen1: VsidianAddonPageSdk | undefined
    let sdkGen2: VsidianAddonPageSdk | undefined
    const handle = installAddonPageLoader({
      page: 'editor',
      addonViews: registry,
      send: (message) => { sent.push(message as never) },
      loadScript: () => Promise.resolve({ ok: true }),
      loadCss: () => Promise.resolve('denied'),
      now: () => 1_000,
      scheduleTimeout: (callback) => ({ cancel: () => void callback }),
    })
    registrations.push({ addonId: 'pub.addon', factory: (sdk) => { sdkGen1 = sdk }, registeredAt: 1_000 })
    await handle.load({ addonId: 'pub.addon', generation: 1, page: 'editor', scriptUri: 'https://x/a.js' })
    // gen1 期间取句柄（组件闭包持有的形态——异步回调里迟用）
    const stale = sdkGen1!.views!.get('main')
    await handle.unload('pub.addon', 1)
    registrations.push({ addonId: 'pub.addon', factory: (sdk) => { sdkGen2 = sdk }, registeredAt: 1_001 })
    await handle.load({ addonId: 'pub.addon', generation: 2, page: 'editor', scriptUri: 'https://x/a.js' })
    // 旧句柄不得因 gen2 在场而复活：在场比对（active.has）会让它复活，代次比对拒绝
    expect(await stale!.editor.applyEdits({ revision: 0, changes: [{ offset: 0, length: 0, text: 'X' }] }))
      .toEqual({ ok: false, reason: 'view-disposed' })
    // gen2 新句柄正常（opId 前缀 g2）
    const fresh = sdkGen2!.views!.get('main')
    const revision = (fresh!.editor.getSnapshot() as { ok: true; snapshot: { revision: number } }).snapshot.revision
    const promise = fresh!.editor.applyEdits({ revision, changes: [{ offset: 0, length: 0, text: 'Y' }] })
    const req = sent.find((m) => m.kind === 'edit.request' && (m as { origin?: { opId?: string } }).origin?.opId?.startsWith('g2')) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.origin).toEqual({ addonId: 'pub.addon', opId: 'g2-op1', undo: 'atomic' })
    instance.handleEditAck({ kind: 'edit.ack', seq: req.seq, ok: true, version: 2 })
    expect(await promise).toEqual({ ok: true, credential: { opId: 'g2-op1', version: 2 } })
    instance.destroy()
  })

  it('无注册表注入（设置页装配）时 SDK 不提供 views 面', async () => {
    const sent: AddonPageOutbound[] = []
    const registrations: AddonPageRegistration[] = []
    ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
    let captured: VsidianAddonPageSdk | undefined
    const handle = installAddonPageLoader({
      page: 'settings',
      send: (message) => sent.push(message),
      loadScript: () => Promise.resolve({ ok: true }),
      loadCss: () => Promise.resolve('denied'),
      now: () => 1_000,
      scheduleTimeout: (callback) => ({ cancel: () => void callback }),
    })
    registrations.push({ addonId: 'pub.addon', factory: (sdk) => { captured = sdk }, registeredAt: 1_000 })
    await handle.load({ addonId: 'pub.addon', generation: 1, page: 'settings', scriptUri: 'https://x/a.js' })
    expect(captured?.views).toBeUndefined()
  })
})
