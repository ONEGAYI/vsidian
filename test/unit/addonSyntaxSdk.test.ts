// @vitest-environment jsdom
// #433 附加组件语法查询面——SDK 链路契约测试（experimental.syntax）：
// - 注入形态：编辑器页 + 视图注册表在场时提供；设置页缺省（对齐
//   headingFold/cm6 口径）
// - 真实链路：LiveEditorInstance 真实装配（liveDecorationsField 增量树
//   与 fm 缓存 + mathBlocksField 跨行块表），矩阵点位走生产取数路径
// - 拒绝分层：reading 态与 hover 只读登记 read-only；未知实例
//   view-disposed；释放后迟到调用 view-disposed；pos 非法 invalid-request
// - pos 超出文档长度钳制到文末（行尾是合法光标位），不抛错不拒绝
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

/** 覆盖主要行类型的样例文档（fm / 标题 / 行内混合 / 跨行公式 / 表格 /
 *  引用 / 列表 / 单行闭合块） */
const DOC = [
  '---',
  't: 1',
  '---',
  '',
  '# H',
  '',
  'text $m$ and `c`.',
  '',
  '$$',
  'x = 1',
  '$$',
  '',
  '| a | b |',
  '| - | - |',
  '',
  '> quote',
  '',
  '- item',
  '',
  '$$y$$',
  '',
  '```',
  '$$',
  'z',
  '$$',
  '```',
  '',
].join('\n')

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
  sent: WebviewToHost[]
  instance: LiveEditorInstance
}

function mountHarness(mode: 'live' | 'reading' = 'live'): Harness {
  const sent: WebviewToHost[] = []
  const registry = new AddonViewRegistry()
  const instance = mountLive(sent, 'syntax-s', DOC)
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
  registrations.push({ addonId: 'pub.syntax-addon', factory: (sdk) => { captured = sdk }, registeredAt: 1_000 })
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
  await h.handle.load({ addonId: 'pub.syntax-addon', generation: 1, page: 'editor', scriptUri: 'https://x/a.js' })
}

const facetOf = (h: Harness) => h.sdk()!.experimental.syntax!

/** DOC 内子串首字符位置（查询点位定位） */
const at = (needle: string, shift = 0): number => DOC.indexOf(needle) + shift

describe('experimental.syntax 注入形态', () => {
  it('编辑器页 + 视图注册表在场：提供查询面；设置页缺省（对齐 headingFold 口径）', async () => {
    const h = mountHarness()
    await load(h)
    expect(h.sdk()!.experimental.syntax).toBeDefined()
    expect(h.sdk()!.experimental.headingFold).toBeDefined()
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
    registrations.push({ addonId: 'pub.syntax-addon', factory: (sdk) => { settingsSdk = sdk }, registeredAt: 1_000 })
    await settingsHandle.load({ addonId: 'pub.syntax-addon', generation: 1, page: 'settings', scriptUri: 'https://x/a.js' })
    expect(settingsSdk!.experimental.syntax).toBeUndefined()
    expect(settingsSdk!.experimental.headingFold).toBeUndefined()
  })

  it('卸载后迟到调用拒绝 view-disposed（僵尸查询不落视图）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    await h.handle.unload('pub.syntax-addon', 1)
    expect(facet.lineTypeAt('main', 0)).toEqual({ ok: false, reason: 'view-disposed' })
    expect(facet.inlineAt('main', 0)).toEqual({ ok: false, reason: 'view-disposed' })
    h.instance.destroy()
  })
})

describe('真实链路：lineTypeAt / inlineAt 矩阵点位（生产取数路径）', () => {
  it('八种行类型在真实实例上按矩阵判定（fm 先行、跨行块表、树枚举、单行闭合块）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    const cases: Array<[number, string, string]> = [
      [at('t: 1'), 'frontmatter', 'fm 内容行（树上反语义被 fm 区间拦截）'],
      [at('# H'), 'heading', 'ATX 标题行'],
      [at('text $m$'), 'text', '行内混合的普通段落'],
      [at('x = 1'), 'formula', '跨行公式块内容行'],
      [at('| a | b |'), 'table', '表头行'],
      [at('> quote'), 'quote', '引用行'],
      [at('- item'), 'list', '列表项'],
      [at('$$y$$'), 'formula', '单行闭合块（补判，不在跨行块表）'],
      [at('z'), 'code', '围栏内跨行 $$ 块内容行（真实 mathBlocksField：块表收、代码上下文守卫判字面代码）'],
    ]
    for (const [pos, want, label] of cases) {
      const result = facet.lineTypeAt('main', pos)
      expect(result.ok, label).toBe(true)
      expect(result.ok ? result.kind : result, label).toBe(want)
    }
    h.instance.destroy()
  })

  it('inlineAt 各点位：行内 code / 行内公式 / 块内公式 / 普通文本', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    expect(facet.inlineAt('main', at('`c`') + 1)).toEqual({ ok: true, kind: 'code', nodeNames: expect.any(Array) })
    expect(facet.inlineAt('main', at('$m$') + 1)).toEqual({ ok: true, kind: 'formula', nodeNames: expect.any(Array) })
    expect(facet.inlineAt('main', at('x = 1') + 1)).toEqual({ ok: true, kind: 'formula', nodeNames: expect.any(Array) })
    expect(facet.inlineAt('main', at('text ') + 1)).toEqual({ ok: true, kind: 'none', nodeNames: expect.any(Array) })
    expect(facet.inlineAt('main', at('t: 1') + 1)).toEqual({ ok: true, kind: 'none', nodeNames: expect.any(Array) })
    h.instance.destroy()
  })

  it('nodeNames 诊断载荷非空（非稳定快照，存在性钉住）', async () => {
    const h = mountHarness()
    await load(h)
    const result = facetOf(h).lineTypeAt('main', at('text $m$'))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Array.isArray(result.nodeNames)).toBe(true)
      expect(result.nodeNames.length).toBeGreaterThan(0)
    }
    h.instance.destroy()
  })
})

describe('拒绝分层（三值，照 headingFold 先例）', () => {
  it('reading 态主正文 → read-only（Live-only 边界）', async () => {
    const h = mountHarness()
    await load(h)
    h.setMode('reading')
    expect(facetOf(h).lineTypeAt('main', 0)).toEqual({ ok: false, reason: 'read-only' })
    expect(facetOf(h).inlineAt('main', 0)).toEqual({ ok: false, reason: 'read-only' })
    h.instance.destroy()
  })

  it('hover 只读登记 → read-only；未知实例 → view-disposed', async () => {
    const h = mountHarness()
    await load(h)
    h.registry.registerReadonly({ viewType: 'hover', instanceId: 'hover-1', targetDocUri: 'file:///a.md', text: '', version: 1 })
    expect(facetOf(h).lineTypeAt('hover-1', 0)).toEqual({ ok: false, reason: 'read-only' })
    expect(facetOf(h).inlineAt('hover-1', 0)).toEqual({ ok: false, reason: 'read-only' })
    expect(facetOf(h).lineTypeAt('no-such', 0)).toEqual({ ok: false, reason: 'view-disposed' })
    h.instance.destroy()
  })

  it('pos 非法（负数/小数/非数值）→ invalid-request；超出文档长度钳制到文末不拒绝', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    for (const bad of [-1, 1.5, Number.NaN, 'x' as unknown as number]) {
      expect(facet.lineTypeAt('main', bad)).toEqual({ ok: false, reason: 'invalid-request' })
      expect(facet.inlineAt('main', bad)).toEqual({ ok: false, reason: 'invalid-request' })
    }
    const beyond = facet.lineTypeAt('main', DOC.length + 100)
    expect(beyond.ok).toBe(true)
    if (beyond.ok) {
      expect(beyond.kind).toBe('text')
    }
    expect(facet.inlineAt('main', DOC.length + 100).ok).toBe(true)
    h.instance.destroy()
  })
})
