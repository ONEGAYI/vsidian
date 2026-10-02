// @vitest-environment jsdom
// 工具栏双态视图切换按钮契约（#141）：
// - DOM 序：齿轮、✎ 快速操作、刷新嵌入资源（#208，紧邻双态切换左侧、
//   持有 margin-left:auto 推右）、双态切换、侧栏（紧邻侧栏按钮左侧）
// - 点击经 view.switch.request 出站（target=另一态），不本地切模式
//   （#38 起切换收敛宿主，按钮态由 view.mode.set 回流驱动）
// - 图标与 aria-label/title 随当前态与界面语言双变化（localeDom 注册表
//   换包重刷；模式翻转经 refreshElementLocale 重算——侧栏按钮同款）
// - body 挂稳定模式类 vsidian-mode-live / vsidian-mode-reading（图标显隐
//   的 CSS 驱动锚点；真实绘制断言在浏览器套件）
// - 原生 button 键盘可达；mousedown 只拦默认聚焦不拦 click（✎ 策略同款）
import { describe, it, expect } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'

installLocale('zh-cn', zhCn)

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

function setup(text = '# 标题\n\n正文段。') {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  const c = new WebviewSyncController(bridge)
  const parent = document.createElement('div')
  // 挂进 document：localeDom 换包重刷按 isConnected 判存活——脱挂元素
  // 被当死项剪除（生产挂树在同步创建块内完成，测试须同样挂树）
  document.body.appendChild(parent)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: 'file:///d%3A/notes/toggle.md', version: 1, text })
  return { c, parent, sent }
}

function toolbarButtons(parent: HTMLElement): HTMLElement[] {
  const bar = parent.querySelector<HTMLElement>('.vsidian-toolbar')!
  return [...bar.children].filter((el): el is HTMLElement =>
    el.tagName === 'BUTTON') as HTMLElement[]
}

describe('工具栏双态视图切换按钮（#141）', () => {
  it('DOM 序：齿轮、快速操作、刷新、双态切换、侧栏（刷新紧邻双态左侧）', () => {
    const { c, parent } = setup()
    const buttons = toolbarButtons(parent).map((b) => b.className)
    expect(buttons).toEqual([
      'vsidian-settings-toggle',
      'vsidian-quick-toggle',
      'vsidian-refresh-toggle',
      'vsidian-view-toggle',
      'vsidian-sidebar-toggle',
    ])
    c.dispose()
    parent.remove()
  })

  it('按钮为原生 button 且含书/笔双图标（图标显隐由模式类经 CSS 驱动）', () => {
    const { c, parent } = setup()
    const btn = parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.type).toBe('button')
    const book = btn.querySelector('.vsidian-view-toggle-book')
    const edit = btn.querySelector('.vsidian-view-toggle-edit')
    expect(book, '阅读态图标（书本类）').toBeTruthy()
    expect(edit, 'Live 态图标（编辑类）').toBeTruthy()
    c.dispose()
    parent.remove()
  })

  it('live 态点击出站 view.switch.request target=reading；不本地切模式', () => {
    const { c, parent, sent } = setup()
    const before = sent.length
    parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!.click()
    expect(sent.slice(before)).toEqual([{ kind: 'view.switch.request', target: 'reading' }])
    // 模式未本地切换（#38 收敛宿主：按钮态等 view.mode.set 回流）
    expect(parent.querySelector('.vsidian-body')!.classList.contains('vsidian-mode-live')).toBe(true)
    c.dispose()
    parent.remove()
  })

  it('reading 态点击出站 target=live（view.mode.set 回流后随态反转）', () => {
    const { c, parent, sent } = setup()
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const before = sent.length
    parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!.click()
    expect(sent.slice(before)).toEqual([{ kind: 'view.switch.request', target: 'live' }])
    c.dispose()
    parent.remove()
  })

  it('body 挂稳定模式类：view.mode.set 翻转 vsidian-mode-live / vsidian-mode-reading', () => {
    const { c, parent } = setup()
    const body = parent.querySelector<HTMLElement>('.vsidian-body')!
    expect(body.classList.contains('vsidian-mode-live')).toBe(true)
    expect(body.classList.contains('vsidian-mode-reading')).toBe(false)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(body.classList.contains('vsidian-mode-reading')).toBe(true)
    expect(body.classList.contains('vsidian-mode-live')).toBe(false)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'live' })
    expect(body.classList.contains('vsidian-mode-live')).toBe(true)
    c.dispose()
    parent.remove()
  })

  it('aria-label 与 title 随当前态换词（zh 包）：live=切换到阅读，reading=切换到实时预览', () => {
    const { c, parent } = setup()
    const btn = parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!
    expect(btn.getAttribute('aria-label')).toBe(zhCn['toolbar.switchToReading'])
    expect(btn.getAttribute('data-tooltip')).toBe(zhCn['toolbar.switchToReading'])
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(btn.getAttribute('aria-label')).toBe(zhCn['toolbar.switchToLive'])
    expect(btn.getAttribute('data-tooltip')).toBe(zhCn['toolbar.switchToLive'])
    c.dispose()
    parent.remove()
  })

  it('换包重刷：installLocale(en) 后 aria/title 随语言重算（localeDom 注册表）', () => {
    const { c, parent } = setup()
    const btn = parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!
    installLocale('en', en)
    expect(btn.getAttribute('aria-label')).toBe(en['toolbar.switchToReading'])
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(btn.getAttribute('aria-label')).toBe(en['toolbar.switchToLive'])
    installLocale('zh-cn', zhCn)
    expect(btn.getAttribute('aria-label')).toBe(zhCn['toolbar.switchToLive'])
    c.dispose()
    parent.remove()
  })

  it('mousedown 只拦默认聚焦（不抢正文焦点），click 照常触发', () => {
    const { c, parent, sent } = setup()
    const btn = parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const before = sent.length
    btn.click()
    expect(sent.slice(before)).toEqual([{ kind: 'view.switch.request', target: 'reading' }])
    c.dispose()
    parent.remove()
  })

  it('快捷键 ctrl+Q 经 keybindings.execute 出站（#141 增补）：live 正文聚焦命中，清空后不拦', () => {
    const { c, parent, sent } = setup()
    c.getView()!.focus()
    const before = sent.length
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'q', ctrlKey: true, bubbles: true, cancelable: true,
    }))
    expect(sent.slice(before)).toEqual([{ kind: 'keybindings.execute', id: 'toggleDualView' }])
    c.dispose()
    parent.remove()
  })

  it('suspend 态与 reading 模式下按钮仍可点（切换是纯视图操作，不受写回暂停影响）', () => {
    const { c, parent, sent } = setup()
    c.handleHostMessage({ kind: 'session.suspended', version: 2, reason: 'conflict' })
    const before = sent.length
    parent.querySelector<HTMLButtonElement>('.vsidian-view-toggle')!.click()
    expect(sent.slice(before)).toEqual([{ kind: 'view.switch.request', target: 'reading' }])
    c.dispose()
    parent.remove()
  })
})
