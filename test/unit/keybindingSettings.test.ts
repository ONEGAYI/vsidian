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

/** blur 取消判定在下一帧执行（rAF 焦点锚定）：测试等待一帧再断言 */
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

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

  it('捕获签：Esc 与失焦取消录制，草稿不残留、不发送', async () => {
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
    // 失焦取消在下一帧以实际焦点位置判定（焦点已随 blur 回落 body）
    capture().blur()
    await nextFrame()
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

describe('审查修复（PR #156 复核轮：焦点与菜单编排）', () => {
  function setup(overrides: Record<string, string[]> = {}, focusEntry?: string) {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root, focusEntry)
    section.handleHostMessage({ kind: 'keybindings.snapshot', overrides })
    return { section, root, sent, cleanup: () => root.remove() }
  }
  const addOf = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLButtonElement>(`[data-operation-id="${id}"] .vsidian-keybindings-add`)!
  const captureOf = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLInputElement>(`[data-operation-id="${id}"] .vsidian-keybindings-capture`)!
  const commitOf = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLButtonElement>(`[data-operation-id="${id}"] .vsidian-keybindings-commit`)!

  it('点 ＋ 后捕获签自动聚焦（术语契约：立即捕获键盘输入）', () => {
    const { root, cleanup } = setup()
    addOf(root, 'bold').click()
    const capture = captureOf(root, 'bold')
    expect(capture).toBeTruthy()
    expect(document.activeElement).toBe(capture)
    // 焦点在捕获签上时按键直接进草稿（不经二次聚焦）
    capture.dispatchEvent(chord('b'))
    expect(capture.value).toBe('Ctrl+B')
    cleanup()
  })

  it('⋯ 菜单点击别处收起（规格：点击别处或再点 ⋯ 收起），菜单内点击不收起', () => {
    const { root, cleanup } = setup()
    root.querySelector<HTMLButtonElement>('[data-operation-id="bold"] .vsidian-keybindings-menu-btn')!.click()
    expect(root.querySelector('[data-operation-id="bold"] .vsidian-keybindings-menu')).toBeTruthy()
    // 菜单外的 pointerdown（目标 document）应收起菜单
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector('[data-operation-id="bold"] .vsidian-keybindings-menu')).toBeNull()
    // 重开菜单，pointerdown 落在菜单内目标时不收起
    root.querySelector<HTMLButtonElement>('[data-operation-id="bold"] .vsidian-keybindings-menu-btn')!.click()
    const menu2 = root.querySelector<HTMLElement>('[data-operation-id="bold"] .vsidian-keybindings-menu')!
    menu2.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector('[data-operation-id="bold"] .vsidian-keybindings-menu')).toBeTruthy()
    cleanup()
  })

  it('Backspace 清空草稿后 ✓ 回到禁用态（规格：✓ 在草稿为空时禁用）', () => {
    const { root, cleanup } = setup({}, 'bold')
    const capture = captureOf(root, 'bold')
    capture.dispatchEvent(chord('b'))
    expect(commitOf(root, 'bold').disabled).toBe(false)
    capture.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    expect(capture.value).toBe('')
    expect(commitOf(root, 'bold').disabled).toBe(true)
    cleanup()
  })

  it('blur 移焦到结果区内控件不取消捕获（× 一击 / Tab ✓ / 点另一行 ＋ 均不吞击）', async () => {
    const { root, cleanup } = setup()
    addOf(root, 'bold').click()
    const capture = captureOf(root, 'bold')
    capture.dispatchEvent(chord('b'))
    // 焦点实际移到另一行的 ＋（结果区内）：blur 一帧后录制继续（草稿保留）
    addOf(root, 'italic').focus()
    capture.dispatchEvent(new FocusEvent('blur'))
    await nextFrame()
    expect(root.querySelector('.vsidian-keybindings-capture')).toBeTruthy()
    expect(capture.value).toBe('Ctrl+B')
    // 焦点实际移到搜索框（结果区外）：blur 一帧后取消捕获
    const search = root.querySelector<HTMLInputElement>('.vsidian-keybindings-search')!
    search.focus()
    capture.dispatchEvent(new FocusEvent('blur'))
    await nextFrame()
    expect(root.querySelector('.vsidian-keybindings-capture')).toBeNull()
    cleanup()
  })

  it('宿主键位回推不吞捕获草稿：捕获签重建、草稿回填并重聚焦', () => {
    const { section, root, cleanup } = setup({}, 'bold')
    const capture = captureOf(root, 'bold')
    capture.dispatchEvent(chord('b'))
    // 宿主回推（如另一窗口保存后的快照）：重渲染后捕获签仍在、草稿回填、焦点恢复
    section.handleHostMessage({ kind: 'keybindings.snapshot', overrides: { italic: ['ctrl+b'] } })
    const captureAfter = captureOf(root, 'bold')
    expect(captureAfter).toBeTruthy()
    expect(captureAfter.value).toBe('Ctrl+B')
    expect(document.activeElement).toBe(captureAfter)
    cleanup()
  })

  it('按键捕获过滤模式：搜索框 readOnly 且可访问名随模式切换', () => {
    const { root, cleanup } = setup()
    const searchOf = () => root.querySelector<HTMLInputElement>('.vsidian-keybindings-search')!
    expect(searchOf().readOnly).toBe(false)
    expect(searchOf().getAttribute('aria-label')).toBe(zhCn['keybindingSettings.searchNamePlaceholder'])
    root.querySelector<HTMLButtonElement>('.vsidian-keybindings-key-toggle')!.click()
    // setKeyMode 走全量重渲染：断言落在重建后的新节点上
    expect(searchOf().readOnly).toBe(true)
    expect(searchOf().getAttribute('aria-label')).toBe(zhCn['keybindingSettings.capturePlaceholder'])
    // 切回文字模式恢复可编辑与原名
    root.querySelector<HTMLButtonElement>('.vsidian-keybindings-key-toggle')!.click()
    expect(searchOf().readOnly).toBe(false)
    expect(searchOf().getAttribute('aria-label')).toBe(zhCn['keybindingSettings.searchNamePlaceholder'])
    cleanup()
  })
})

describe('审查修复第 2 轮（N-1：离开意图不被重聚焦劫持）', () => {
  function setup2() {
    const sent: unknown[] = []
    const section = new KeybindingSettingsSection({ postMessage: (m) => sent.push(m) })
    const root = document.createElement('div')
    document.body.append(root)
    section.mount(root)
    section.handleHostMessage({ kind: 'keybindings.snapshot', overrides: {} })
    return { section, root, sent, cleanup: () => root.remove() }
  }
  const add2 = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLButtonElement>(`[data-operation-id="${id}"] .vsidian-keybindings-add`)!

  it('捕获中点筛选签：录制同步取消（筛选是离开意图；用 all 签避免行被过滤的假阳性）', () => {
    const { root, sent, cleanup } = setup2()
    add2(root, 'bold').click()
    const capture = root.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!
    capture.dispatchEvent(chord('b'))
    root.querySelector<HTMLButtonElement>('.vsidian-keybindings-filter[data-filter="all"]')!.click()
    expect(root.querySelector('[data-operation-id="bold"]')).toBeTruthy()
    expect(root.querySelector('.vsidian-keybindings-capture')).toBeNull()
    expect(sent.filter((m) => (m as { kind: string }).kind === 'keybindings.set')).toEqual([])
    cleanup()
  })

  it('捕获中菜单外点收起：目标在结果区外时录制一并取消', () => {
    const { root, cleanup } = setup2()
    add2(root, 'bold').click()
    root.querySelector<HTMLButtonElement>('[data-operation-id="bold"] .vsidian-keybindings-menu-btn')!.click()
    expect(root.querySelector('[data-operation-id="bold"] .vsidian-keybindings-menu')).toBeTruthy()
    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(root.querySelector('[data-operation-id="bold"] .vsidian-keybindings-menu')).toBeNull()
    expect(root.querySelector('.vsidian-keybindings-capture')).toBeNull()
    cleanup()
  })

  it('捕获中点「全部恢复默认」：录制取消且 resetAll 消息照发', () => {
    const { root, sent, cleanup } = setup2()
    add2(root, 'bold').click()
    root.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!.dispatchEvent(chord('b'))
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    buttons.find((b) => b.textContent === zhCn['keybindingSettings.resetAll'])!.click()
    expect(root.querySelector('.vsidian-keybindings-capture')).toBeNull()
    expect(sent.filter((m) => (m as { kind: string }).kind === 'keybindings.resetAll')).toHaveLength(1)
    cleanup()
  })

  it('行内动作与宿主回推仍保留录制（重聚焦白名单路径回归）', async () => {
    const { section, root, sent, cleanup } = setup2()
    add2(root, 'bold').click()
    const capture = root.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')!
    capture.dispatchEvent(chord('b'))
    root.querySelector<HTMLButtonElement>('[data-operation-id="italic"] .vsidian-keybindings-remove')!.click()
    await nextFrame()
    const captureAfter = root.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')
    expect(captureAfter).toBeTruthy()
    expect(captureAfter!.value).toBe('Ctrl+B')
    expect(document.activeElement).toBe(captureAfter)
    expect(sent.filter((m) => (m as { kind: string }).kind === 'keybindings.set')).toHaveLength(1)
    section.handleHostMessage({ kind: 'keybindings.snapshot', overrides: { italic: [] } })
    const captureAgain = root.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')
    expect(captureAgain?.value).toBe('Ctrl+B')
    expect(document.activeElement).toBe(captureAgain)
    cleanup()
  })
})
