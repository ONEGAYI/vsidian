// @vitest-environment jsdom
// 编辑器 webview 与设置的交互契约（#33）：
// - init 后主动发送 settings.get 拉取当前设置快照（webview 不持久化设置，
//   权威在宿主——每次装载都拉取，不依赖本地缓存）
// - settings.snapshot / settings.changed 到达后缓存，view.state 回报携带
//   settings 字段（#34 行号等设置的观测面）
// - 工具栏「设置」按钮：点击发送 settings.open（打开宿主级设置页面板）
// - 宿主侧 documentSession 对 settings.open/get 的处理（PanelPort 注入，
//   与 link.activate 同模式：真实 webview 消息与测试注入共用同一入口）
import { describe, it, expect, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { DocumentSession, type HostDocumentPort, type PanelPort } from '../../src/host/documentSession'
import type { HostToWebview, SettingsPayload, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { mountRefContentBlock } from '../../src/webview/refReadingContent'
import { getRefReadingBlockCacheStats } from '../../src/webview/refContentInstance'
import { closeHoverPopup, openHoverPopupFor, setHoverPreviewContext } from '../../src/webview/hoverPopup'

// #94 起文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)

// jsdom has no range layout. These controller tests inspect DOM/state only;
// browser coverage verifies actual painting with the real layout engine.
if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => Object.assign(new Array<DOMRect>(), { item: () => null })
}
if (Range.prototype.getBoundingClientRect === undefined) {
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/a.md'

function makeBridge() {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T,>() => undefined as T | undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

function mount(bridge: VsCodeBridge): WebviewSyncController {
  const controller = new WebviewSyncController(bridge)
  const parent = document.createElement('div')
  controller.mount(parent)
  return controller
}

function init(c: WebviewSyncController): void {
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: '# 标题' })
}

describe('设置快照拉取与缓存（#33）', () => {
  it('init 后主动发送 settings.get（每次装载都拉取，重载后同样）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c)
    expect(sent).toContainEqual({ kind: 'settings.get' })
    // webview 重载（宿主在重复 ready 后重发 init）后再次拉取
    init(c)
    expect(sent.filter((m) => m.kind === 'settings.get')).toHaveLength(2)
  })

  it('settings.snapshot 与 settings.changed 都更新缓存的 settings', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c)
    sent.length = 0
    c.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': true } })
    c.handleHostMessage({ kind: 'view.state.request' })
    let state = sent.find((m) => m.kind === 'view.state') as Extract<WebviewToHost, { kind: 'view.state' }>
    expect(state.settings).toEqual({ 'editor.lineNumbers': true })

    c.handleHostMessage({ kind: 'settings.changed', values: { 'editor.lineNumbers': false } })
    c.handleHostMessage({ kind: 'view.state.request' })
    const states = sent.filter((m) => m.kind === 'view.state') as Extract<WebviewToHost, { kind: 'view.state' }>[]
    state = states.at(-1)!
    expect(state.settings).toEqual({ 'editor.lineNumbers': false })
  })

  it('未收到任何设置消息时 view.state 的 settings 缺省（向后兼容）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c)
    sent.length = 0
    c.handleHostMessage({ kind: 'view.state.request' })
    const state = sent.find((m) => m.kind === 'view.state') as Extract<WebviewToHost, { kind: 'view.state' }>
    expect(state.settings).toBeUndefined()
  })

  it('设置消息不触碰文档内容与编辑状态（纯缓存）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c)
    const before = c.getView()!.state.doc.toString()
    c.handleHostMessage({ kind: 'settings.changed', values: { 'a.b': true } })
    expect(c.getView()!.state.doc.toString()).toBe(before)
  })
})

describe('工具栏设置入口（#33；#53 图标化）', () => {
  it('工具栏含齿轮设置按钮（内联 SVG + 可访问名称），点击发送 settings.open', () => {
    const { bridge, sent } = makeBridge()
    const parent = document.createElement('div')
    const c = new WebviewSyncController(bridge)
    c.mount(parent)
    const btn = parent.querySelector<HTMLButtonElement>(
      '.vsidian-toolbar button.vsidian-settings-toggle',
    )
    expect(btn, '工具栏应含 vsidian-settings-toggle 按钮').toBeTruthy()
    // #53 起设置入口图标化为齿轮：无文字、有内联 SVG 与可访问名称
    expect(btn!.querySelector('svg'), '设置按钮应为内联 SVG 齿轮图标').toBeTruthy()
    expect(btn!.textContent).not.toContain('设置')
    expect(btn!.getAttribute('aria-label')).toBe(zhCn['sidebar.settings'])
    expect(btn!.getAttribute('data-tooltip')).toBe(zhCn['sidebar.settings'])
    btn!.click()
    expect(sent).toContainEqual({ kind: 'settings.open' })
  })

  it('模式按钮已迁移，工具栏仅剩设置与侧栏切换入口（#38/#53 合并语义）', () => {
    // #33 基线上工具栏并存模式按钮与设置按钮；#38 将模式切换迁移至编辑器
    // 标题栏三态命令；#53 增设右侧栏切换按钮，#141 增设双态视图切换按钮，
    // #208 增设刷新嵌入资源按钮——工具栏五入口，无三态模式按钮
    const { bridge } = makeBridge()
    const parent = document.createElement('div')
    const c = new WebviewSyncController(bridge)
    c.mount(parent)
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-settings-toggle')).toBeTruthy()
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-sidebar-toggle')).toBeTruthy()
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-mode-toggle')).toBeNull()
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-quick-toggle')).toBeTruthy()
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-view-toggle')).toBeTruthy()
    expect(parent.querySelector('.vsidian-toolbar button.vsidian-refresh-toggle')).toBeTruthy()
    expect(parent.querySelectorAll('.vsidian-toolbar button')).toHaveLength(5)
  })
})

describe('宿主侧 documentSession 的设置消息处理（#33，与注入路径同构）', () => {
  const doc: HostDocumentPort = {
    version: 1,
    getText: () => '# 标题',
    applyChanges: async () => true,
    undo: async () => true,
    redo: async () => true,
  }

  function makeSession(settings: { snapshot: SettingsPayload }) {
    const sent: HostToWebview[] = []
    const opened: boolean[] = []
    const port: PanelPort = {
      send: (m) => sent.push(m),
      openSettings: () => {
        opened.push(true)
      },
      requestSettings: () => settings.snapshot,
    }
    const session = new DocumentSession(doc, { docUri: DOC_URI })
    const sessionId = session.attachPanel(port)
    session.handleWebviewMessage({ kind: 'ready' }, sessionId)
    return { session, sessionId, sent, opened }
  }

  it('settings.open 经 PanelPort.openSettings 执行（打开设置页不依赖文档状态）', async () => {
    const { session, sessionId, opened } = makeSession({ snapshot: {} })
    await session.handleWebviewMessage({ kind: 'settings.open' }, sessionId)
    expect(opened).toHaveLength(1)
  })

  it('settings.get 响应当前快照（settings.snapshot 回发）', async () => {
    const { session, sessionId, sent } = makeSession({ snapshot: { 'editor.lineNumbers': true } })
    sent.length = 0
    await session.handleWebviewMessage({ kind: 'settings.get' }, sessionId)
    expect(sent).toContainEqual({
      kind: 'settings.snapshot',
      values: { 'editor.lineNumbers': true },
    })
  })

  it('未注入端口（openSettings 缺省）时消息被安全忽略', async () => {
    const sent: HostToWebview[] = []
    const session = new DocumentSession(doc, { docUri: DOC_URI })
    const sessionId = session.attachPanel({ send: (m) => sent.push(m) })
    await session.handleWebviewMessage({ kind: 'ready' }, sessionId)
    await session.handleWebviewMessage({ kind: 'settings.open' }, sessionId)
    await session.handleWebviewMessage({ kind: 'settings.get' }, sessionId)
    // 无 snapshot 回发、无异常
    expect(sent.filter((m) => m.kind === 'settings.snapshot')).toHaveLength(0)
  })

  it('settings.set 不经 documentSession（设置页链路独立，无副作用）', async () => {
    const { session, sessionId, sent, opened } = makeSession({ snapshot: {} })
    await session.handleWebviewMessage(
      { kind: 'settings.set', values: { 'a.b': true } },
      sessionId,
    )
    expect(opened).toHaveLength(0)
    expect(sent.filter((m) => m.kind === 'settings.snapshot')).toHaveLength(0)
  })
})

describe('mounted reading code-card settings (#389)', () => {
  it('refreshes only changed card settings in place while preserving source, fold, wrap and scroll state', () => {
    const { bridge, sent } = makeBridge()
    const parent = document.createElement('div')
    const c = new WebviewSyncController(bridge)
    c.mount(parent)
    const source = 'Intro\n\n```tcl\nset value "quoted"\nputs $value\n```\n\n```ini\n[board]\nclock=1\n```'
    c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: source })
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const reading = parent.querySelector<HTMLElement>('.vsidian-view-reading')!
    const blocks = [...reading.querySelectorAll<HTMLElement>(':scope > .vsidian-reading-code-block')]
    const first = blocks[0]!
    const second = blocks[1]!
    const refSource = '```tcl\nputs "reference"\n```'
    const reference = createReadingBlockElement(splitReadingBlocks(refSource)[0]!, refSource)
    mountRefContentBlock(reference, { images: null, codeHighlight: true, fm: null })
    reading.querySelector(':scope > .vsidian-reading-paragraph')!.appendChild(reference)
    const snapshot = () => {
      c.handleHostMessage({ kind: 'view.state.request' })
      return sent.filter((m): m is Extract<WebviewToHost, { kind: 'view.state' }> => m.kind === 'view.state').at(-1)!
    }
    const before = snapshot()
    const apply = (kind: 'settings.snapshot' | 'settings.changed', values: SettingsPayload) => c.handleHostMessage({ kind, values })
    try {
      expect(first.querySelector('.tok-string')?.textContent).toBe('"quoted"')
      ;(first.querySelector('.vsidian-code-card-wrap') as HTMLButtonElement).click()
      ;(second.querySelector('.vsidian-code-card-fold') as HTMLButtonElement).click()
      reading.scrollTop = 37
      apply('settings.snapshot', { 'codeblock.highlight': false })
      expect(first.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
      expect(first.querySelector('code')?.textContent).toContain('set value "quoted"')
      expect(second.classList.contains('vsidian-code-card-folded')).toBe(true)
      expect(reading.classList.contains('vsidian-reading-nowrap')).toBe(true)
      expect(reading.scrollTop).toBe(37)
      expect(reading.querySelector(':scope > .vsidian-reading-code-block')).toBe(first)

      apply('settings.changed', { 'codeblock.highlight': true, 'codeblock.card': false })
      expect(first.querySelector('.vsidian-code-card-header')).toBeNull()
      expect(first.querySelector('.tok-string')?.textContent).toBe('"quoted"')
      expect(first.querySelector('code')?.textContent).toBe('set value "quoted"\nputs $value')
      apply('settings.snapshot', { 'codeblock.highlight': true, 'codeblock.card': true })
      expect(first.querySelector('.vsidian-code-card-header')).not.toBeNull()
      expect(second.classList.contains('vsidian-code-card-folded')).toBe(true)
      // 卡内行号 2026-10 起阅读侧不发射：设置开启（默认）也无行号节点
      expect(first.querySelector('.vsidian-code-card-linenumber')).toBeNull()
      apply('settings.changed', { 'codeblock.lineNumbers': false, 'codeblock.copyButton': false })
      expect(first.querySelector('.vsidian-code-card-linenumber')).toBeNull()
      expect(first.querySelector('.vsidian-code-card-copy')).toBeNull()
      expect(second.classList.contains('vsidian-code-card-folded')).toBe(true)
      const header = first.querySelector('.vsidian-code-card-header')
      apply('settings.changed', { 'codeblock.lineNumbers': false, 'codeblock.copyButton': false, 'editor.lineNumbers': false })
      expect(first.querySelector('.vsidian-code-card-header')).toBe(header)
      expect(reference.querySelector('.vsidian-code-card-header')).toBeNull()
      expect(reference.querySelector('code')?.textContent).toBe('puts "reference"')
      const after = snapshot()
      expect(after.readingParseCount).toBe(before.readingParseCount)
      expect(c.getView()!.state.doc.toString()).toBe(source)
      expect(sent.some((m) => m.kind === 'edit.request')).toBe(false)
      expect(reading.classList.contains('vsidian-reading-nowrap')).toBe(true)
    } finally {
      c.dispose()
    }
  })
})


describe('mounted Markdown reference highlight settings (#389)', () => {
  it.each(['embed', 'hover', 'standalone-hover'])('%s refreshes only code tokens without remounting resources or changing state', (kind) => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('vsidian-embed-card-scroll') || this.classList.contains('vsidian-hover-popup-scroll') ? 400 : 0
    })
    const { bridge, sent } = makeBridge()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const c = new WebviewSyncController(bridge)
    c.mount(parent)
    const source = kind === 'embed' ? '![[Reference]]' : '[[Reference]]'
    c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: source })
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    let highlight = true
    if (kind === 'standalone-hover') {
      setHoverPreviewContext({ session: () => ({ sessionId: 's1', docUri: DOC_URI }),
        send: (message) => sent.push(message), codeHighlight: () => highlight })
    }
    try {
      if (kind !== 'embed') {
        const anchor = parent.querySelector<HTMLElement>('.vsidian-view-reading .vsidian-wikilink')!
        openHoverPopupFor(anchor, { target: 'Reference', sourceStart: 0, sourceEnd: source.length })
      }
      const req = sent.find((message): message is Extract<WebviewToHost, { kind: 'hover.request' }> => message.kind === 'hover.request')!
      expect(req).toBeDefined()
      const text = '---\ntitle: Reference\n---\n\n![asset](asset.png)\n\n```tcl\nputs "reference"\n```'
      c.handleHostMessage({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
        target: { fsPath: `D:/notes/${kind}.md`, relPath: `${kind}.md` }, version: 1, text,
        range: { start: 0, end: text.length }, scope: { kind: 'full' } })
      const container = document.querySelector<HTMLElement>(kind === 'embed' ? '.vsidian-embed-card' : '.vsidian-hover-popup')!
      const code = container.querySelector<HTMLElement>('pre > code')!
      expect(code.querySelector('.tok-string')?.textContent).toBe('"reference"')
      const image = container.querySelector('img')
      const fmButton = container.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!
      fmButton.click()
      const scroll = container.querySelector<HTMLElement>(kind === 'embed' ? '.vsidian-embed-card-scroll' : '.vsidian-hover-popup-scroll')!
      scroll.scrollTop = 17
      const before = getRefReadingBlockCacheStats().parses
      const imageRequests = sent.filter((message) => message.kind === 'image.request').length
      const hoverRequests = sent.filter((message) => message.kind === 'hover.request').length
      highlight = false
      c.handleHostMessage({ kind: 'settings.snapshot', values: { 'codeblock.highlight': false } })
      expect(code.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
      expect(code.textContent).toBe('puts "reference"')
      highlight = true
      c.handleHostMessage({ kind: 'settings.changed', values: { 'codeblock.highlight': true } })
      expect(code.querySelector('.tok-string')?.textContent).toBe('"reference"')
      expect(container.querySelector('pre > code')).toBe(code)
      expect(container.querySelector('img')).toBe(image)
      expect(container.querySelector('.vsidian-hover-fm-toggle')).toBe(fmButton)
      expect(fmButton.getAttribute('aria-expanded')).toBe('true')
      expect(scroll.scrollTop).toBe(17)
      expect(container.querySelector('.vsidian-code-card-header')).toBeNull()
      expect(getRefReadingBlockCacheStats().parses).toBe(before)
      expect(sent.filter((message) => message.kind === 'image.request')).toHaveLength(imageRequests)
      expect(sent.filter((message) => message.kind === 'hover.request')).toHaveLength(hoverRequests)
      expect(sent.some((message) => message.kind === 'edit.request')).toBe(false)
      expect(c.getView()!.state.doc.toString()).toBe(source)
    } finally {
      closeHoverPopup()
      c.dispose()
      parent.remove()
      vi.restoreAllMocks()
    }
  })
})

// #423 阅读宽松换行：设置变更 → 渲染器单例重建 → 已开阅读视图重切块重挂
//（br 是换行呈现的直接 DOM 证据）；源文/撤销栈零改动。无关设置变更不
// 触发重解析（滚动路径零额外切块成本）。
describe('reading breaks setting re-renders mounted view (#423)', () => {
  it('breaks on/off re-chunks mounted reading paragraphs; unrelated settings keep parse intact', () => {
    const { bridge, sent } = makeBridge()
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const c = new WebviewSyncController(bridge)
    c.mount(parent)
    const source = '段一甲\n段一乙\n段一丙\n\n结尾段\n'
    c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: source })
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const reading = parent.querySelector<HTMLElement>('.vsidian-view-reading')!
    const snapshot = () => {
      c.handleHostMessage({ kind: 'view.state.request' })
      return sent.filter((m): m is Extract<WebviewToHost, { kind: 'view.state' }> => m.kind === 'view.state').at(-1)!
    }
    const apply = (kind: 'settings.snapshot' | 'settings.changed', values: SettingsPayload) =>
      c.handleHostMessage({ kind, values })
    try {
      // 默认严格：单换行段无 br
      expect(reading.querySelectorAll('p br')).toHaveLength(0)
      const before = snapshot()

      // 无关设置变更：不重切块（parse 计数不变）
      apply('settings.changed', { 'editor.lineNumbers': false })
      expect(snapshot().readingParseCount).toBe(before.readingParseCount)
      expect(reading.querySelectorAll('p br')).toHaveLength(0)

      // 开启宽松：段落重建出 br（两处单换行），源文不变
      apply('settings.changed', { 'editor.readingBreaks': true })
      expect(reading.querySelectorAll('p br')).toHaveLength(2)
      expect(reading.querySelector('p')?.textContent).toContain('段一甲')
      expect(snapshot().readingParseCount).toBeGreaterThan(before.readingParseCount!)
      expect(c.getView()!.state.doc.toString()).toBe(source)
      expect(sent.some((m) => m.kind === 'edit.request')).toBe(false)

      // 快照缺键回默认（严格）——空快照不误触发重建后仍是宽松语义？
      // 缺键按定义默认 false 解析：回严格（与 sanitize 语义一致）
      apply('settings.snapshot', {})
      expect(reading.querySelectorAll('p br')).toHaveLength(0)

      // 再次开启后恢复：值未变的消息不重复重建
      const mid = snapshot().readingParseCount
      apply('settings.changed', { 'editor.readingBreaks': true })
      expect(snapshot().readingParseCount).toBeGreaterThan(mid!)
      expect(reading.querySelectorAll('p br')).toHaveLength(2)
      apply('settings.changed', { 'editor.readingBreaks': true })
      expect(reading.querySelectorAll('p br')).toHaveLength(2)
    } finally {
      // 模块级渲染器单例是共享状态：恢复默认严格，不泄漏到其他用例
      apply('settings.snapshot', {})
      c.dispose()
      parent.remove()
    }
  })
})
