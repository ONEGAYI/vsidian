// @vitest-environment jsdom
// #95 i18n：分页文案经 t() 取词——装配生产 zh-cn 语言包，断言与字典同源。
// #93 收尾：全部操作名（含 extra/UI 源）经 titleKey 直取字典（command.* 与
// manifest NLS 同源），不再持字面量存量。
// #155 视觉刷新：筛选签过滤、捕获签（＋原位变 ✓、Enter/✓ 提交、Esc/失焦
// 取消）、⋯ 菜单（清空/恢复默认）与按键捕获过滤模式的 DOM 契约。
import { describe, expect, it } from 'vitest'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// #94 起文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)

function chord(key: string, ctrl = true): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true })
}

describe('快捷键设置页', () => {
  it('extra/UI 源操作名经 titleKey 直取字典渲染（与 manifest NLS 同源）', () => {
    const section = new KeybindingSettingsSection({ postMessage: () => {} })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    for (const [id, key] of [
      ['find', 'command.find.title'],
      ['toggleViewMode', 'command.toggleViewMode.title'],
      ['outlineSearch', 'command.ui.outlineSearch.title'],
    ] as const) {
      const row = root.querySelector<HTMLElement>(`[data-operation-id="${id}"]`)!
      expect(row.querySelector('strong')?.textContent, id).toBe(zhCn[key])
    }
    root.remove()
  })

  it('筛选签：冲突实时计数，四维过滤与 aria-pressed 单选', () => {
    const section = new KeybindingSettingsSection({ postMessage: () => {} })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    section.handleHostMessage({
      kind: 'keybindings.snapshot',
      // italic 与 find 同改 ctrl+b（生效模式可交叠）→ 双方冲突；
      // bold 显式清空（空数组=明确禁用）→ 归「未分配」且算「由我分配」
      overrides: { bold: [], italic: ['ctrl+b'], find: ['ctrl+b'] },
    })
    const rowIds = () => [...root.querySelectorAll('.vsidian-keybindings-row')]
      .map((r) => r.getAttribute('data-operation-id'))
    const chip = (kind: string) =>
      root.querySelector<HTMLButtonElement>(`.vsidian-keybindings-filter[data-filter="${kind}"]`)!
    expect(chip('conflict').textContent)
      .toBe(`${zhCn['keybindingSettings.filterConflicts']} (2)`)
    expect(chip('all')!.getAttribute('aria-pressed')).toBe('true')
    chip('conflict').click()
    expect(rowIds()).toEqual(['italic', 'find'])
    chip('userAssigned').click()
    expect(rowIds()).toEqual(['bold', 'italic', 'find'])
    chip('unassigned').click()
    expect(rowIds()).toContain('bold')
    expect(rowIds()).not.toContain('italic')
    expect(chip('unassigned').getAttribute('aria-pressed')).toBe('true')
    chip('assigned').click()
    expect(rowIds()).toContain('italic')
    expect(rowIds()).not.toContain('bold')
    root.remove()
  })

  it('捕获签：focusEntry 就地打开，＋ 原位变 ✓，Enter 提交走冲突显式替换', () => {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root, 'italic')
    const row = () => root.querySelector<HTMLElement>('[data-operation-id="italic"]')!
    // 全局搜索定位：捕获签就地打开并聚焦，＋ 已被 ✓ 取代
    const capture = row().querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!
    expect(document.activeElement).toBe(capture)
    expect(row().querySelector('.vsidian-keybindings-add')).toBeNull()
    const commit = row().querySelector<HTMLButtonElement>('.vsidian-keybindings-commit')!
    expect(commit.getAttribute('aria-label')).toBe(zhCn['keybindingSettings.commitCapture'])
    expect(commit.disabled, '草稿为空时提交禁用').toBe(true)
    capture.dispatchEvent(chord('b'))
    expect(capture.value).toBe('Ctrl+B')
    expect(commit.disabled).toBe(false)
    // 提交钮 pointerdoen 保持捕获签焦点（不触发失焦取消），点击提交
    commit.dispatchEvent(new Event('pointerdown', { cancelable: true }))
    commit.click()
    // 与粗体默认键冲突：暂不发保存，行内警示条待显式替换
    expect(root.querySelector('.vsidian-keybindings-conflict')?.textContent).toContain(zhCn['format.bold'])
    expect(sent).toEqual([])
    root.querySelector<HTMLButtonElement>('.vsidian-keybindings-conflict button')!.click()
    expect(sent).toMatchObject([{ kind: 'keybindings.set', id: 'italic', bindings: ['ctrl+i', 'ctrl+b'], replaceConflicts: true }])
    root.remove()
  })

  it('捕获签：Enter 提交两段键位直接保存', () => {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    const row = () => root.querySelector<HTMLElement>('[data-operation-id="inlineMath"]')!
    row().querySelector<HTMLButtonElement>('.vsidian-keybindings-add')!.click()
    const capture = row().querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!
    capture.dispatchEvent(chord('k'))
    capture.dispatchEvent(chord('m'))
    expect(capture.value).toBe('Ctrl+K Ctrl+M')
    capture.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sent).toMatchObject([{ kind: 'keybindings.set', id: 'inlineMath', bindings: ['ctrl+k ctrl+m'], replaceConflicts: false }])
    root.remove()
  })

  it('捕获签：Esc 与失焦取消录制，草稿不残留、不发送', () => {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    const row = () => root.querySelector<HTMLElement>('[data-operation-id="bold"]')!
    const add = () => row().querySelector<HTMLButtonElement>('.vsidian-keybindings-add')!
    const capture = () => row().querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!
    add().click()
    capture().focus()
    capture().dispatchEvent(chord('k'))
    expect(capture().value).toBe('Ctrl+K')
    capture().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(row().querySelector('.vsidian-keybindings-capture')).toBeNull()
    // 取消后回退默认键位牌（bold 默认绑定仍在），无任何保存发出
    expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+B')
    add().click()
    capture().focus()
    capture().dispatchEvent(chord('k'))
    capture().blur()
    expect(row().querySelector('.vsidian-keybindings-capture')).toBeNull()
    expect(sent).toEqual([])
    root.remove()
  })

  it('⋯ 菜单：清空绑定与恢复默认经行内菜单发送', () => {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    const row = () => root.querySelector<HTMLElement>('[data-operation-id="bold"]')!
    row().querySelector<HTMLButtonElement>('.vsidian-keybindings-menu-btn')!.click()
    const menu = row().querySelector('.vsidian-keybindings-menu')!
    expect(menu.querySelectorAll('button')[0].textContent).toBe(zhCn['keybindingSettings.clearBindings'])
    menu.querySelectorAll<HTMLButtonElement>('button')[0].click()
    expect(sent[0]).toMatchObject({ kind: 'keybindings.set', id: 'bold', bindings: [] })
    section.handleHostMessage({ kind: 'keybindings.changed', overrides: { bold: [] }, requestId: 1, ok: true })
    expect(row().querySelector('.vsidian-keybindings-unbound')?.textContent)
      .toBe(zhCn['keybindingSettings.unbound'])
    row().querySelector<HTMLButtonElement>('.vsidian-keybindings-menu-btn')!.click()
    expect(row().querySelector('.vsidian-keybindings-menu')!.getAttribute('role')).toBe('menu')
    row().querySelectorAll<HTMLButtonElement>('.vsidian-keybindings-menu button')[1].click()
    expect(sent[1]).toMatchObject({ kind: 'keybindings.reset', id: 'bold' })
    root.remove()
  })

  it('按键捕获过滤模式：键盘图标切换、录制过滤、Esc 退回清空', () => {
    const section = new KeybindingSettingsSection({ postMessage: () => {} })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    section.handleHostMessage({
      kind: 'keybindings.snapshot',
      overrides: { inlineMath: ['ctrl+k ctrl+m'] },
    })
    const rowIds = () => [...root.querySelectorAll('.vsidian-keybindings-row')]
      .map((r) => r.getAttribute('data-operation-id'))
    root.querySelector<HTMLButtonElement>('.vsidian-keybindings-key-toggle')!.click()
    const toggle = root.querySelector<HTMLButtonElement>('.vsidian-keybindings-key-toggle')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.classList.contains('is-active')).toBe(true)
    const search = root.querySelector<HTMLInputElement>('.vsidian-keybindings-search')!
    expect(search.placeholder).toBe(zhCn['keybindingSettings.capturePlaceholder'])
    search.focus()
    search.dispatchEvent(chord('k'))
    search.dispatchEvent(chord('m'))
    expect(search.value).toBe('Ctrl+K Ctrl+M')
    expect(rowIds()).toEqual(['inlineMath'])
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const searchAfter = root.querySelector<HTMLInputElement>('.vsidian-keybindings-search')!
    expect(searchAfter.placeholder).toBe(zhCn['keybindingSettings.searchNamePlaceholder'])
    expect(root.querySelector('.vsidian-keybindings-key-toggle')!.getAttribute('aria-pressed')).toBe('false')
    expect(rowIds().length).toBeGreaterThan(1)
    root.remove()
  })
})
