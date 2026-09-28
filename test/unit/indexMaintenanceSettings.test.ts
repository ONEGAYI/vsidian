// @vitest-environment jsdom
// 索引维护设置分页契约（#198）：分页注册与文案取词、排除模式列表编辑
// （草稿/增删行/保存上送清洗后清单/恢复默认）、宿主 index.state 回显
// （权威清单同步草稿退役）、维护操作按钮态（busy 禁用/取消出现/进度与
// 结果反馈）、无工作区提示。不触任何编辑器 webview。
import { describe, it, expect } from 'vitest'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)

function makeSection(): { section: IndexMaintenanceSection; sent: unknown[]; parent: HTMLElement } {
  const sent: unknown[] = []
  const section = new IndexMaintenanceSection({ postMessage: (m) => sent.push(m) })
  const parent = document.createElement('div')
  section.mount(parent)
  return { section, sent, parent }
}

/** 模拟宿主下发 index.state（经协议校验的正式形态） */
function pushState(
  section: IndexMaintenanceSection,
  state: Partial<Extract<HostToWebview, { kind: 'index.state' }>> = {},
): void {
  const message: Extract<HostToWebview, { kind: 'index.state' }> = {
    kind: 'index.state',
    available: true,
    patterns: ['**/.git/**', '**/node_modules/**'],
    defaults: ['**/.git/**', '**/node_modules/**'],
    status: 'idle',
    progress: null,
    roots: 1,
    notice: null,
    ...state,
  }
  expect(isHostToWebview(message)).toBe(true)
  section.handleHostMessage(message)
}

const inputsOf = (parent: HTMLElement): HTMLInputElement[] =>
  [...parent.querySelectorAll<HTMLInputElement>('.vsidian-index-pattern-input')]

const buttonsOf = (parent: HTMLElement): HTMLButtonElement[] =>
  [...parent.querySelectorAll<HTMLButtonElement>('button')]

const buttonByLabel = (parent: HTMLElement, label: string): HTMLButtonElement | undefined =>
  buttonsOf(parent).find((b) => b.textContent === label)

describe('分页注册与回显', () => {
  it('作为附加分页进设置页：侧栏出现分类，正文标题与字典同源', () => {
    const sent: unknown[] = []
    const section = new IndexMaintenanceSection({ postMessage: (m) => sent.push(m) })
    const view = new SettingsPageView({ postMessage: (m) => sent.push(m) }, [], [section])
    const root = document.createElement('div')
    view.mount(root)
    const nav = [...root.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    const indexNav = nav.find((b) => b.textContent === zhCn['indexMaintenance.title'])
    expect(indexNav, '侧栏应出现索引维护分类').toBeTruthy()
    indexNav!.click()
    expect(root.querySelector('.vsidian-settings-heading')?.textContent).toBe(zhCn['indexMaintenance.title'])
    expect(root.querySelector('.vsidian-settings-subtitle')?.textContent).toBe(zhCn['indexMaintenance.description'])
    view.dispose()
  })

  it('权威清单回显：模式行 = state.patterns + 尾部空行；草稿退役同步', () => {
    const { section, parent } = makeSection()
    pushState(section, { patterns: ['drafts/**'] })
    expect(inputsOf(parent).map((i) => i.value)).toEqual(['drafts/**', ''])
    // 草稿编辑（改首行）后宿主推送新权威值 → 草稿退役、输入框同步
    const first = inputsOf(parent)[0]!
    first.value = 'tmp/**'
    first.dispatchEvent(new Event('input'))
    pushState(section, { patterns: ['a/**', 'b/**'] })
    expect(inputsOf(parent).map((i) => i.value)).toEqual(['a/**', 'b/**', ''])
  })
})

describe('排除模式编辑', () => {
  it('保存上送 trim 后的非空清单（空行与首尾空白过滤）', () => {
    const { section, sent, parent } = makeSection()
    pushState(section, { patterns: ['drafts/**'] })
    // 权威态两行：drafts/** + 尾空行；先占用尾空行
    let inputs = inputsOf(parent)
    inputs[0]!.value = '  keep/**  '
    inputs[0]!.dispatchEvent(new Event('input'))
    inputs[1]!.value = 'new/**'
    inputs[1]!.dispatchEvent(new Event('input'))
    // 草稿被占满后再「添加」产生新尾空行
    buttonByLabel(parent, zhCn['indexMaintenance.addPattern'])!.click()
    inputs = inputsOf(parent) // 点击后 DOM 重建：重新查询
    expect(inputs.length).toBe(3)
    inputs[2]!.value = '   ' // 首尾空白与空行不参与保存
    inputs[2]!.dispatchEvent(new Event('input'))
    buttonByLabel(parent, zhCn['indexMaintenance.savePatterns'])!.click()
    expect(sent).toContainEqual({ kind: 'index.setPatterns', patterns: ['keep/**', 'new/**'] })
  })

  it('添加行不重复尾部空行；移除行后清单至少留一行', () => {
    const { section, parent } = makeSection()
    pushState(section, { patterns: ['a/**'] })
    // 权威态自带尾空行：添加不重复叠加
    buttonByLabel(parent, zhCn['indexMaintenance.addPattern'])!.click()
    expect(inputsOf(parent).length).toBe(2)
    // 尾空行被占用（输入后）再添加 → 新尾空行
    const second = inputsOf(parent)[1]!
    second.value = 'b/**'
    second.dispatchEvent(new Event('input'))
    buttonByLabel(parent, zhCn['indexMaintenance.addPattern'])!.click()
    expect(inputsOf(parent).map((i) => i.value)).toEqual(['a/**', 'b/**', ''])
    // 移除全部实体行：仍保留一行空行（其移除钮禁用）
    const removeButtons = () => [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-index-pattern-remove')]
    removeButtons()[0]!.click() // 移除 a/**
    removeButtons()[0]!.click() // 移除 b/**
    expect(inputsOf(parent).length).toBe(1)
    expect(inputsOf(parent)[0]!.value).toBe('')
    expect(removeButtons()[0]!.disabled).toBe(true)
  })

  it('恢复默认上送 index.resetPatterns（宿主按默认清单保存并回显）', () => {
    const { section, sent, parent } = makeSection()
    pushState(section, { patterns: ['custom/**'] })
    buttonByLabel(parent, zhCn['indexMaintenance.resetPatterns'])!.click()
    expect(sent).toContainEqual({ kind: 'index.resetPatterns' })
  })

  it('无工作区：提示可见、操作按钮禁用、模式编辑仍可用', () => {
    const { section, parent } = makeSection()
    pushState(section, { available: false })
    expect(parent.querySelector('.vsidian-index-unavailable')?.textContent)
      .toBe(zhCn['indexMaintenance.unavailable'])
    expect(buttonByLabel(parent, zhCn['indexMaintenance.rebuild'])!.disabled).toBe(true)
    expect(buttonByLabel(parent, zhCn['indexMaintenance.cleanup'])!.disabled).toBe(true)
    // 模式保存不受影响（持久化后在打开工作区时生效）
    expect(buttonByLabel(parent, zhCn['indexMaintenance.savePatterns'])!.disabled).toBe(false)
  })
})

describe('维护操作反馈', () => {
  it('重建中：操作按钮禁用、取消按钮出现、进度文案随 progress 更新', () => {
    const { section, sent, parent } = makeSection()
    pushState(section, { status: 'rebuilding', progress: { done: 3, total: 10 } })
    expect(buttonByLabel(parent, zhCn['indexMaintenance.rebuild'])!.disabled).toBe(true)
    expect(buttonByLabel(parent, zhCn['indexMaintenance.cleanup'])!.disabled).toBe(true)
    expect(buttonByLabel(parent, zhCn['indexMaintenance.cancel'])).toBeTruthy()
    expect(parent.querySelector('.vsidian-index-progress')?.textContent)
      .toBe(zhCn['indexMaintenance.rebuildProgress'].replace('{done}', '3').replace('{total}', '10'))
    buttonByLabel(parent, zhCn['indexMaintenance.cancel'])!.click()
    expect(sent).toContainEqual({ kind: 'index.cancel' })
  })

  it('清理中同样禁用操作；结果反馈按 notice 种类取词（拒绝项为警示基调）', () => {
    const { section, parent } = makeSection()
    pushState(section, { status: 'cleaning' })
    expect(buttonByLabel(parent, zhCn['indexMaintenance.rebuild'])!.disabled).toBe(true)
    expect(buttonByLabel(parent, zhCn['indexMaintenance.cancel'])).toBeTruthy()
    pushState(section, {
      status: 'idle',
      notice: { kind: 'patterns-invalid', detail: 'bad pattern' },
    })
    const notice = parent.querySelector('.vsidian-index-notice')!
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toBe(
      zhCn['indexMaintenance.noticePatternsInvalid'].replace('{detail}', 'bad pattern'))
    expect(notice.className).toContain('vsidian-index-notice-warn')
  })

  it('成功反馈为常规基调；无 notice 时不渲染反馈行', () => {
    const { section, parent } = makeSection()
    pushState(section)
    expect(parent.querySelector('.vsidian-index-notice')).toBeNull()
    pushState(section, { notice: { kind: 'cleanup-done', detail: '2' } })
    const notice = parent.querySelector('.vsidian-index-notice')!
    expect(notice.textContent).toBe(
      zhCn['indexMaintenance.noticeCleanupDone'].replace('{count}', '2'))
    expect(notice.className).not.toContain('vsidian-index-notice-warn')
  })
})
