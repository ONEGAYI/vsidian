// @vitest-environment jsdom
// #410 附加组件标题折叠 API——SDK 链路契约测试（experimental.headingFold）：
// - 注入形态：编辑器页 + 视图注册表在场时提供；设置页缺省（对齐 cm6 口径）
// - 查询面：folds（有效折叠派生视图，不泄原始键集）与 foldable（可折叠
//   区间全集，空节排除）——span 含 key/level/hideFrom/hideTo（LF 偏移）
// - 命令面：apply 五操作（选区驱动，effect 直驱与用户触发同链路）、
//   upToLevel 参数化 foldAll、foldAt/unfoldAt 按区间键批量组合
// - Live-only：reading 态与 hover 只读视图拒绝 read-only；未知句柄
//   view-disposed；释放后迟到调用 view-disposed
// - 零写回：折叠全程不产生 edit.request 出站（折叠是视图态）
import { describe, expect, it, afterEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { LiveEditorInstance, type LiveEditorInstanceDeps } from '../../src/webview/liveInstance'
import { ImageResourceManager } from '../../src/webview/imageResource'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { VsidianAddonPageSdk, AddonPageRegistration } from '../../src/shared/addonPage'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

// 文档与 headingFoldUi 同族：T1/T2 可折叠（嵌套）、Empty 与 Blank 相邻
// （Empty 节仅空白不可折叠）、Blank 节含 tail 可折叠
const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# Empty\n# Blank\n\ntail\n'
const T1_KEY = 0
const T2_KEY = DOC.indexOf('## T2')
const BLANK_KEY = DOC.indexOf('# Blank')

function makeInstanceDeps(sent: WebviewToHost[]): LiveEditorInstanceDeps {
  return {
    send: (message) => sent.push(message),
    persistState: () => {},
    images: new ImageResourceManager({ isDirectSrc: () => false, requestHost: () => {} }),
    isLiveActive: () => true,
    initialDark: false,
  }
}

function mountLive(sent: WebviewToHost[], sessionId: string, text: string): LiveEditorInstance {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const instance = new LiveEditorInstance(host, makeInstanceDeps(sent))
  instance.setSession(sessionId, `file:///${sessionId}.md`)
  instance.handleFullSync(1, text, {})
  return instance
}

interface Harness {
  handle: AddonPageLoaderHandle
  sdk: () => VsidianAddonPageSdk | undefined
  registry: AddonViewRegistry
  setMode: (mode: 'live' | 'reading') => void
}

function mountHarness(mode: 'live' | 'reading' = 'live'): Harness & { sent: WebviewToHost[]; instance: LiveEditorInstance } {
  const sent: WebviewToHost[] = []
  const registry = new AddonViewRegistry()
  const instance = mountLive(sent, 'fold-s', DOC)
  let currentMode = mode
  registry.registerLive({ viewType: 'main', instanceId: 'main', targetDocUri: 'file:///a.md', mode: () => currentMode, instance })
  const registrations: AddonPageRegistration[] = []
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
  let captured: VsidianAddonPageSdk | undefined
  const handle = installAddonPageLoader({
    page: 'editor',
    addonViews: registry,
    send: (message) => { sent.push(message as never) },
    loadScript: () => Promise.resolve({ ok: true }),
    loadCss: () => Promise.resolve('denied'),
    now: () => 1_000,
    scheduleTimeout: (callback) => ({ cancel: () => void callback() }),
  })
  registrations.push({ addonId: 'pub.fold-addon', factory: (sdk) => { captured = sdk }, registeredAt: 1_000 })
  return {
    handle,
    sdk: () => captured,
    registry,
    setMode: (next) => { currentMode = next },
    sent,
    instance,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  for (const view of document.querySelectorAll('.cm-editor')) {
    EditorView.findFromDOM(view as HTMLElement)?.destroy()
  }
})

async function load(h: Harness): Promise<void> {
  await h.handle.load({ addonId: 'pub.fold-addon', generation: 1, page: 'editor', scriptUri: 'https://x/a.js' })
}

describe('experimental.headingFold 注入形态', () => {
  it('编辑器页 + 视图注册表在场：提供折叠面；设置页缺省（对齐 cm6 口径）', async () => {
    const h = mountHarness()
    await load(h)
    expect(h.sdk()!.experimental.headingFold).toBeDefined()
    expect(h.sdk()!.views).toBeDefined()
    h.instance.destroy()

    const registrations: AddonPageRegistration[] = []
    ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
    let settingsSdk: VsidianAddonPageSdk | undefined
    const settingsHandle = installAddonPageLoader({
      page: 'settings',
      send: () => {},
      loadScript: () => Promise.resolve({ ok: true }),
      loadCss: () => Promise.resolve('denied'),
      now: () => 1_000,
      scheduleTimeout: (callback) => ({ cancel: () => void callback() }),
    })
    registrations.push({ addonId: 'pub.fold-addon', factory: (sdk) => { settingsSdk = sdk }, registeredAt: 1_000 })
    await settingsHandle.load({ addonId: 'pub.fold-addon', generation: 1, page: 'settings', scriptUri: 'https://x/a.js' })
    expect(settingsSdk!.experimental.headingFold).toBeUndefined()
    expect(settingsSdk!.experimental.cm6).toBeUndefined()
  })

  it('卸载后迟到调用拒绝 view-disposed（僵尸折叠请求不落视图）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    await h.handle.unload('pub.fold-addon', 1)
    expect(facet.folds('main')).toEqual({ ok: false, reason: 'view-disposed' })
    expect(facet.apply('main', 'foldAll')).toEqual({ ok: false, reason: 'view-disposed' })
    h.instance.destroy()
  })
})

describe('查询面：folds / foldable', () => {
  it('foldable 返回可折叠区间全集（key/level/hideFrom/hideTo；空节排除）', async () => {
    const h = mountHarness()
    await load(h)
    const result = h.sdk()!.experimental.headingFold!.foldable('main')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spans.map((s) => s.key)).toEqual([T1_KEY, T2_KEY, BLANK_KEY])
    expect(result.spans.map((s) => s.level)).toEqual([1, 2, 1])
    // hideFrom = 标题块行尾；hideTo = 下一级别 ≤ 自身标题行首或文档末尾
    // （T1 的节末是 # Empty——level 2 的 T2 是其孩子，不终止 T1 节）
    expect(result.spans[0]).toMatchObject({ hideFrom: 4, hideTo: DOC.indexOf('# Empty') })
    expect(result.spans[1]).toMatchObject({ hideTo: DOC.indexOf('# Empty') })
    expect(result.spans[2]).toMatchObject({ hideTo: DOC.length })
    h.instance.destroy()
  })

  it('foldable 返回值变异不污染共享缓存（防御性拷贝，rl2 第 2 轮复核 P1）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    const first = facet.foldable('main')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // 第三方滥用：改写首项 key、追加脏项（readonly 仅类型层，运行时可变）——
    // 若实现直通 foldableSpansCached 共享数组，变异即污染缓存
    const mutable = first.spans as { key: number; level: number; hideFrom: number; hideTo: number }[]
    mutable[0] = { ...mutable[0], key: 9999 }
    mutable.push({ key: 8888, level: 1, hideFrom: 0, hideTo: 1 })
    // 再次查询不受污染：返回真实标题区间
    const second = facet.foldable('main')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.spans.map((s) => s.key)).toEqual([T1_KEY, T2_KEY, BLANK_KEY])
    // 下游证据：foldAll 消费同一缓存，仅折叠三个真实标题（污染态会并入 4 键）
    expect(facet.apply('main', 'foldAll')).toEqual({ ok: true, applied: 3 })
    const folds = facet.folds('main')
    expect(folds.ok).toBe(true)
    if (!folds.ok) return
    expect(folds.spans.map((s) => s.key)).toEqual([T1_KEY, T2_KEY, BLANK_KEY])
    h.instance.destroy()
  })

  it('folds 初始为空；foldAt 后返回有效折叠派生视图（区间语义与本体一致）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    expect(facet.folds('main')).toEqual({ ok: true, spans: [] })
    expect(facet.foldAt('main', [T1_KEY])).toEqual({ ok: true, applied: 1 })
    const folds = facet.folds('main')
    expect(folds).toEqual({
      ok: true,
      spans: [{ key: T1_KEY, level: 1, hideFrom: 4, hideTo: DOC.indexOf('# Empty') }],
    })
    // 派生视图不泄原始键集：脱靶键（非可折叠标题行首）无行为、不出现
    expect(facet.foldAt('main', [42])).toEqual({ ok: true, applied: 0 })
    expect(facet.folds('main')).toEqual(folds)
    h.instance.destroy()
  })

  it('Live-only：reading 态与 hover 只读视图拒绝 read-only；未知句柄 view-disposed', async () => {
    const h = mountHarness()
    await load(h)
    h.registry.registerReadonly({ viewType: 'hover', instanceId: 'hover:h1', targetDocUri: 'file:///c.md', text: 'c', version: 1 })
    const facet = h.sdk()!.experimental.headingFold!
    expect(facet.folds('hover:h1')).toEqual({ ok: false, reason: 'read-only' })
    expect(facet.foldable('ghost')).toEqual({ ok: false, reason: 'view-disposed' })
    h.setMode('reading')
    expect(facet.folds('main')).toEqual({ ok: false, reason: 'read-only' })
    expect(facet.apply('main', 'foldAll')).toEqual({ ok: false, reason: 'read-only' })
    expect(facet.foldAt('main', [T1_KEY])).toEqual({ ok: false, reason: 'read-only' })
    h.setMode('live')
    expect(facet.folds('main').ok).toBe(true)
    h.instance.destroy()
  })
})

describe('命令面：apply / foldAt / unfoldAt', () => {
  it('apply foldAll/unfoldAll 与 upToLevel 参数化（level ≤ upToLevel 才折叠）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    expect(facet.apply('main', 'foldAll')).toEqual({ ok: true, applied: 3 })
    const allSpans = facet.folds('main')
    expect(allSpans.ok).toBe(true)
    if (allSpans.ok) {
      expect(allSpans.spans).toHaveLength(3)
    }
    expect(facet.apply('main', 'unfoldAll')).toEqual({ ok: true, applied: 3 })
    expect(facet.apply('main', 'unfoldAll')).toEqual({ ok: true, applied: 0 })
    // upToLevel=1：T1 与 Blank（level 1）折叠、T2（level 2）不折
    expect(facet.apply('main', 'foldAll', { upToLevel: 1 })).toEqual({ ok: true, applied: 2 })
    const levelSpans = facet.folds('main')
    expect(levelSpans.ok).toBe(true)
    if (levelSpans.ok) {
      expect(levelSpans.spans.every((s) => s.level <= 1)).toBe(true)
    }
    h.instance.destroy()
  })

  it('apply fold/unfold/toggle 选区驱动（编程触发与用户触发同链路）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    const views = h.sdk()!.views!
    // 光标到文档末尾（tail 内）：辖域 = Blank，fold 折 Blank
    views.get('main')!.editor.setSelection([{ anchor: DOC.length, head: DOC.length }])
    expect(facet.apply('main', 'fold')).toEqual({ ok: true, applied: 1 })
    expect(facet.folds('main')).toMatchObject({ ok: true, spans: [{ key: BLANK_KEY }] })
    // 光标在折叠区间内（tail 内）：unfold 展开包含光标的最深折叠
    expect(facet.apply('main', 'unfold')).toEqual({ ok: true, applied: 1 })
    expect(facet.folds('main')).toEqual({ ok: true, spans: [] })
    // 光标移入 T2 标题行：toggle 折 T2，再 toggle 展
    views.get('main')!.editor.setSelection([{ anchor: T2_KEY + 1, head: T2_KEY + 1 }])
    expect(facet.apply('main', 'toggle')).toEqual({ ok: true, applied: 1 })
    expect(facet.folds('main')).toMatchObject({ ok: true, spans: [{ key: T2_KEY }] })
    expect(facet.apply('main', 'toggle')).toEqual({ ok: true, applied: 1 })
    expect(facet.folds('main')).toEqual({ ok: true, spans: [] })
    h.instance.destroy()
  })

  it('foldAt/unfoldAt 按区间键批量组合（键来自查询结果；applied 为实际变更数）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    expect(facet.foldAt('main', [T1_KEY, T2_KEY, BLANK_KEY])).toEqual({ ok: true, applied: 3 })
    // 已折叠键重复提交：无新变更
    expect(facet.foldAt('main', [T1_KEY])).toEqual({ ok: true, applied: 0 })
    // 展开两键
    expect(facet.unfoldAt('main', [T1_KEY, BLANK_KEY])).toEqual({ ok: true, applied: 2 })
    expect(facet.folds('main')).toMatchObject({ ok: true, spans: [{ key: T2_KEY }] })
    // 空键集 = no-op
    expect(facet.unfoldAt('main', [])).toEqual({ ok: true, applied: 0 })
    h.instance.destroy()
  })

  it('无效请求拒绝：upToLevel 仅 foldAll 接受；键须为非负整数', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    expect(facet.apply('main', 'fold', { upToLevel: 1 })).toEqual({ ok: false, reason: 'invalid-request' })
    expect(facet.apply('main', 'unfoldAll', { upToLevel: 2 })).toEqual({ ok: false, reason: 'invalid-request' })
    expect(facet.apply('main', 'foldAll', { upToLevel: 0 })).toEqual({ ok: false, reason: 'invalid-request' })
    expect(facet.apply('main', 'foldAll', { upToLevel: 2.5 })).toEqual({ ok: false, reason: 'invalid-request' })
    expect(facet.foldAt('main', [1.5])).toEqual({ ok: false, reason: 'invalid-request' })
    expect(facet.foldAt('main', [-1])).toEqual({ ok: false, reason: 'invalid-request' })
    // 形状非法不产生任何折叠变更
    expect(facet.folds('main')).toEqual({ ok: true, spans: [] })
    h.instance.destroy()
  })

  it('折叠零写回：全程无 edit.request 出站（折叠是视图态，不 dirty）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = h.sdk()!.experimental.headingFold!
    facet.apply('main', 'foldAll')
    facet.unfoldAt('main', [T1_KEY])
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    h.instance.destroy()
  })
})
