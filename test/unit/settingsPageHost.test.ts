// 宿主设置页生命周期契约：异步保存完成时，已关闭的 webview 不可再访问。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vscodeMock = vi.hoisted(() => ({ createWebviewPanel: vi.fn(), envLanguage: 'en' }))

vi.mock('vscode', () => ({
  window: { createWebviewPanel: vscodeMock.createWebviewPanel },
  ViewColumn: { Active: 1 },
  Uri: { joinPath: (...parts: unknown[]) => parts.join('/') },
  // #93：HTML 生成点经 vscode.env.language 解析生效语言（auto 语义）
  env: { language: vscodeMock.envLanguage },
}))

import { createSettingsPage } from '../../src/host/settingsPage'
import { installLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'

function makePanel() {
  let disposed = false
  let onDispose = () => {}
  let onViewState: ((event: { webviewPanel: { visible: boolean } }) => void) | undefined
  const sent: unknown[] = []
  const webview = {
    cspSource: 'vscode-resource:',
    asWebviewUri: () => 'vscode-resource:/settings',
    onDidReceiveMessage: () => ({ dispose: () => {} }),
    postMessage: (message: unknown) => { sent.push(message); return Promise.resolve(true) },
    html: '',
  }
  const panel = {
    title: '',
    get webview() {
      if (disposed) throw new Error('Webview is disposed')
      return webview
    },
    onDidDispose: (callback: () => void) => { onDispose = callback; return { dispose: () => {} } },
    onDidChangeViewState: (callback: (event: { webviewPanel: { visible: boolean } }) => void) => {
      onViewState = callback
      return { dispose: () => { onViewState = undefined } }
    },
    dispose: () => { disposed = true; onDispose() },
    reveal: () => {},
    /** 模拟面板可见性切换（retainContextWhenHidden 不开：隐藏即释放重载） */
    setHidden: () => onViewState?.({ webviewPanel: { visible: false } }),
  }
  return { panel, sent }
}

describe('设置页异步回信与面板生命周期', () => {
  beforeEach(() => vscodeMock.createWebviewPanel.mockReset())

  it('保存尚未完成时关闭面板，不访问已释放 webview', async () => {
    const { panel, sent } = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)
    let finish!: (value: { ok: true; values: Record<string, boolean> }) => void
    const service = {
      getSnapshot: () => ({ 'test.flag': true }),
      apply: () => new Promise<{ ok: true; values: Record<string, boolean> }>((resolve) => { finish = resolve }),
    }
    const page = createSettingsPage({ extensionUri: 'extension' } as never, service as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    page.injectMessage({ kind: 'settings.set', values: { 'test.flag': true } })
    page.close()
    finish({ ok: true, values: { 'test.flag': true } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([])
  })

  it('open() 注入语言数据岛并同步 <html lang>（#93 首帧管线）', () => {
    const { panel } = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(panel)
    const service = {
      getSnapshot: () => ({}),
      apply: () => Promise.resolve({ ok: true as const, values: {} }),
    }
    const page = createSettingsPage({ extensionUri: 'extension' } as never, service as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    // mock env.language 为 en：auto 解析为 en，数据岛与 html lang 同步该语言
    expect(panel.webview.html).toContain('<html lang="en">')
    expect(panel.webview.html).toContain('<script type="application/json" id="vsidian-locale">')
    expect(panel.webview.html).toContain('"lang":"en"')
  })

  it('notifyLocaleChanged：向自身面板发 locale.changed 携完整新包，标题同步新语言（#96）', () => {
    // 宿主装配（真实链路由 provider 先 installHostLocale 再通知；此处直接
    // 模拟两态：zh 开面板 → 切 en）
    installLocale('zh-cn', zhCn)
    const { panel, sent } = makePanel()
    // createWebviewPanel 的第二参即面板标题（真实 API 语义），mock 回填
    vscodeMock.createWebviewPanel.mockImplementation(((_viewType: unknown, title: string) => {
      panel.title = title
      return panel
    }) as never)
    const service = {
      getSnapshot: () => ({}),
      apply: () => Promise.resolve({ ok: true as const, values: {} }),
    }
    const page = createSettingsPage({ extensionUri: 'extension' } as never, service as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    expect(panel.title).toBe(zhCn['settings.pageTitle'])
    // 宿主换包发生在通知之前（title 取词即时为新语言）
    installLocale('en', en)
    page.notifyLocaleChanged('en')
    expect(sent).toContainEqual({ kind: 'locale.changed', lang: 'en', messages: en })
    expect(panel.title).toBe(en['settings.pageTitle'])
    // 面板未开时 no-op（不抛错；下次 open 按新快照语言生成）
    page.close()
    page.notifyLocaleChanged('zh-cn')
    expect(sent).toHaveLength(1)
  })

  it('settings.get 应答链附带当前语言包（#96 R1：重载装回旧语言被拉正）', () => {
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    // 开面板时语言为 en（数据岛随 HTML 固化为 en——重载后装回的即它）
    let snapshot: Record<string, unknown> = { 'general.language': 'en' }
    const service = {
      getSnapshot: () => snapshot,
      apply: () => Promise.resolve({ ok: true as const, values: {} }),
    }
    const page = createSettingsPage({ extensionUri: 'extension' } as never, service as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    expect(fresh.panel.webview.html).toContain('"lang":"en"')
    // 开面板后语言切到 zh-cn：重载页面装回 en 数据岛、经 settings.get 回线
    snapshot = { 'general.language': 'zh-cn' }
    page.injectMessage({ kind: 'settings.get' })
    const out = fresh.sent
    const snapshotIdx = out.findIndex((m) => (m as { kind?: string }).kind === 'settings.snapshot')
    const localeIdx = out.findIndex((m) => (m as { kind?: string }).kind === 'locale.changed')
    expect(snapshotIdx).toBeGreaterThanOrEqual(0)
    // 校准消息在快照应答之后（页面先回显值再对齐语言，顺序可观测）
    expect(localeIdx).toBeGreaterThan(snapshotIdx)
    expect(out[localeIdx]).toEqual({ kind: 'locale.changed', lang: 'zh-cn', messages: zhCn })
  })

  it('openWithSection 带 entry（#231）：面板未就绪时挂起，ready 握手补发携带 entry', () => {
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      { getSnapshot: () => ({}), apply: () => Promise.resolve({ ok: true as const, values: {} }) } as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    // ready 之前定位：宿主挂起 pendingSection（openStyleReference 命令行为，
    // 打开外观并定位「样式参考」页签——entry 用 overview）
    page.openWithSection('appearance', 'overview')
    expect(fresh.sent.some((m) => (m as { kind?: string }).kind === 'settings.focusSection')).toBe(false)
    page.injectMessage({ kind: 'settings.get' })
    expect(fresh.sent).toContainEqual({ kind: 'settings.focusSection', section: 'appearance', entry: 'overview' })
  })

  it('openWithSection：ready 后直接发送；不带 entry 时消息不含该字段（向后兼容形态）', () => {
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      { getSnapshot: () => ({}), apply: () => Promise.resolve({ ok: true as const, values: {} }) } as never,
      { getSnapshot: () => ({}) } as never)
    page.open()
    page.injectMessage({ kind: 'settings.get' })
    fresh.sent.length = 0
    page.openWithSection('appearance', 'overview')
    expect(fresh.sent).toContainEqual({ kind: 'settings.focusSection', section: 'appearance', entry: 'overview' })
    page.openWithSection('appearance')
    expect(fresh.sent).toContainEqual({ kind: 'settings.focusSection', section: 'appearance' })
    expect(fresh.sent.some((m) => (m as { entry?: unknown }).entry === undefined
      && (m as { kind?: string }).kind === 'settings.focusSection')).toBe(true)
  })
})

describe('设置页会话内 UI 态恢复（webview 上报 uiState，重开/重载握手补发）', () => {
  const makeService = () => ({
    getSnapshot: () => ({}),
    apply: () => Promise.resolve({ ok: true as const, values: {} }),
  })
  const kinds = (sent: unknown[]) => sent.map((m) => (m as { kind?: string }).kind)
  const focusSent = (sent: unknown[]) =>
    sent.filter((m) => (m as { kind?: string }).kind === 'settings.focusSection')

  it('webview 上报 uiState → 宿主记忆（getInfo.uiState 可观测）；未上报时为 undefined', () => {
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    expect(page.getInfo().uiState).toBeUndefined()
    page.open()
    page.injectMessage({ kind: 'settings.uiState', section: 'appearance', scrollTop: 120 })
    expect(page.getInfo().uiState).toEqual({ section: 'appearance', scrollTop: 120 })
  })

  it('面板关闭后重开：settings.get 握手补发恢复定位（focusSection 带 scroll），握手前不发', () => {
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    const first = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(first.panel)
    page.open()
    page.injectMessage({ kind: 'settings.uiState', section: 'appearance', scrollTop: 120 })
    page.close()
    const second = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(second.panel)
    page.open()
    // 与 pendingSection 同模式：webview 未装载完成（未 settings.get）前补发会被忽略
    expect(focusSent(second.sent)).toHaveLength(0)
    page.injectMessage({ kind: 'settings.get' })
    expect(second.sent).toContainEqual({ kind: 'settings.focusSection', section: 'appearance', scroll: 120 })
  })

  it('无 UI 态记忆（此前会话未到过设置页或从未切页滚动）：重开握手不补发定位', () => {
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    const first = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(first.panel)
    page.open()
    page.injectMessage({ kind: 'settings.get' })
    page.close()
    const second = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(second.panel)
    page.open()
    page.injectMessage({ kind: 'settings.get' })
    expect(focusSent(second.sent)).toHaveLength(0)
  })

  it('显式定位优先于恢复：pendingSection 在场时握手只补发显式定位，不发恢复', () => {
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    const first = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(first.panel)
    page.open()
    page.injectMessage({ kind: 'settings.uiState', section: 'appearance', scrollTop: 120 })
    page.close()
    const second = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(second.panel)
    page.openWithSection('keybindings')
    page.injectMessage({ kind: 'settings.get' })
    expect(focusSent(second.sent)).toEqual([{ kind: 'settings.focusSection', section: 'keybindings' }])
  })

  it('面板隐藏重载（panel 不换）再次握手：补发幂等，滚动值不丢', () => {
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    page.open()
    page.injectMessage({ kind: 'settings.get' })
    page.injectMessage({ kind: 'settings.uiState', section: 'appearance', scrollTop: 120 })
    // retainContextWhenHidden 不开：切走标签 webview 即释放重载，panel 对象
    // 不变、settings.get 再次到达——恢复消息须再次补发（每次握手恢复）
    page.injectMessage({ kind: 'settings.get' })
    expect(focusSent(fresh.sent)).toEqual([
      { kind: 'settings.focusSection', section: 'appearance', scroll: 120 },
    ])
    expect(kinds(fresh.sent).filter((k) => k === 'settings.snapshot')).toHaveLength(2)
  })

  it('面板隐藏重置 ready：显式定位走挂起-握手补发，stale-ready 窗口不被恢复覆盖', () => {
    // 审查发现（stale-ready）：面板切后台时 webview 释放但 panel 不 dispose，
    // ready 若保持 true，openWithSection 的立即 postMessage 会落入已卸载的
    // webview 而丢失，随后重载握手按记忆补发恢复——显式定位被覆盖
    const fresh = makePanel()
    vscodeMock.createWebviewPanel.mockReturnValue(fresh.panel)
    const page = createSettingsPage({ extensionUri: 'extension' } as never,
      makeService() as never, { getSnapshot: () => ({}) } as never)
    page.open()
    page.injectMessage({ kind: 'settings.get' })
    page.injectMessage({ kind: 'settings.uiState', section: 'keybindings', scrollTop: 40 })
    // 面板切后台（webview 即将释放重载）：ready 必须重置
    fresh.panel.setHidden()
    page.openWithSection('appearance')
    // ready 已重置：定位挂起，不得向已卸载的 webview 立即发送
    expect(focusSent(fresh.sent)).toHaveLength(0)
    // 重载完成握手：补发显式定位（而非恢复 keybindings 记忆）
    page.injectMessage({ kind: 'settings.get' })
    expect(focusSent(fresh.sent)).toEqual([{ kind: 'settings.focusSection', section: 'appearance' }])
  })
})
