// @vitest-environment jsdom
// CSS 片段设置分页契约（#128）：分页注册与文案取词、目录行（选择/打开/
// 刷新动作上送）、宿主 snippets.state 回显（清单/开关/失败态）、开关上送、
// 搜索 entries 动态并入，以及「设置页不注入用户 CSS」（不创建任何片段链）。
import { describe, it, expect, beforeEach } from 'vitest'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)

function makeSection(): { section: CssSnippetSettingsSection; sent: unknown[]; parent: HTMLElement } {
  const sent: unknown[] = []
  const section = new CssSnippetSettingsSection({ postMessage: (m) => sent.push(m) })
  const parent = document.createElement('div')
  section.mount(parent)
  return { section, sent, parent }
}

/** 模拟宿主下发 snippets.state（经协议校验的正式形态） */
function pushState(
  section: CssSnippetSettingsSection,
  state: { directory: string | null; readError?: boolean; version?: number; entries?: Array<{ name: string; enabled: boolean }> },
): void {
  const message = {
    kind: 'snippets.state',
    directory: state.directory,
    readError: state.readError ?? false,
    version: state.version ?? 1,
    entries: state.entries ?? [],
  }
  expect(isHostToWebview(message)).toBe(true)
  section.handleHostMessage(message)
}

beforeEach(() => {
  document.head.querySelectorAll('link[data-vsidian-snippet]').forEach((el) => el.remove())
})

describe('分页注册与空状态', () => {
  it('作为附加分页进设置页：侧栏出现分类（palette 图标），正文标题与字典同源', () => {
    const sent: unknown[] = []
    const section = new CssSnippetSettingsSection({ postMessage: (m) => sent.push(m) })
    const view = new SettingsPageView({ postMessage: (m) => sent.push(m) }, [], [section])
    const root = document.createElement('div')
    view.mount(root)
    const nav = [...root.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    const cssNav = nav.find((b) => b.textContent === zhCn['cssSnippets.title'])
    expect(cssNav, '侧栏应出现 CSS 片段分类').toBeTruthy()
    cssNav!.click()
    expect(root.querySelector('.vsidian-settings-heading')?.textContent).toBe(zhCn['cssSnippets.title'])
    expect(root.querySelector('.vsidian-settings-subtitle')?.textContent).toBe(zhCn['cssSnippets.description'])
  })

  it('未收到状态时：目录行显示未配置提示，三个动作按钮可用', () => {
    const { parent, sent } = makeSection()
    expect(parent.querySelector('.vsidian-css-snippets-directory-path')?.textContent)
      .toBe(zhCn['cssSnippets.noDirectory'])
    const buttons = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-css-snippets-actions button')]
    expect(buttons.map((b) => b.textContent)).toEqual([
      zhCn['cssSnippets.chooseDirectory'], zhCn['cssSnippets.openDirectory'], zhCn['cssSnippets.refresh'],
    ])
    buttons[0]!.click()
    buttons[1]!.click()
    buttons[2]!.click()
    expect(sent).toEqual([
      { kind: 'snippets.chooseDirectory' },
      { kind: 'snippets.openDirectory' },
      { kind: 'snippets.refresh' },
    ])
  })
})

describe('宿主状态回显与开关上送', () => {
  it('snippets.state 回显目录与逐项开关；翻转复选框上送 snippets.setEnabled', () => {
    const { section, sent, parent } = makeSection()
    pushState(section, {
      directory: 'D:\\片段 目录',
      entries: [
        { name: 'a.css', enabled: false },
        { name: 'b.css', enabled: true },
      ],
    })
    expect(parent.querySelector('.vsidian-css-snippets-directory-path')?.textContent).toBe('D:\\片段 目录')
    const items = [...parent.querySelectorAll<HTMLLabelElement>('.vsidian-css-snippets-item')]
    expect(items).toHaveLength(2)
    const boxes = [...parent.querySelectorAll<HTMLInputElement>('input[data-snippet-name]')]
    expect(boxes.map((b) => b.dataset.snippetName)).toEqual(['a.css', 'b.css'])
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
    boxes[0]!.checked = true
    boxes[0]!.dispatchEvent(new Event('change'))
    expect(sent).toEqual([{ kind: 'snippets.setEnabled', name: 'a.css', enabled: true }])
  })

  it('读取失败：常驻警告状态条（字典文案 + error 样式类）；清单仍显示最近成功条目', () => {
    const { section, parent } = makeSection()
    pushState(section, {
      directory: 'D:/gone',
      readError: true,
      entries: [{ name: 'a.css', enabled: true }],
    })
    const status = parent.querySelector<HTMLElement>('.vsidian-css-snippets-status')
    expect(status?.textContent).toBe(zhCn['cssSnippets.readError'])
    expect(status?.classList.contains('vsidian-css-snippets-status-error')).toBe(true)
    expect(parent.querySelectorAll('input[data-snippet-name]')).toHaveLength(1)
  })

  it('目录已配置但无 .css：空目录提示', () => {
    const { section, parent } = makeSection()
    pushState(section, { directory: 'D:/empty', entries: [] })
    expect(parent.querySelector('.vsidian-css-snippets-status')?.textContent)
      .toBe(zhCn['cssSnippets.emptyDirectory'])
  })

  it('状态更新就地重渲染（同一 mount 点清空重建，不累积）', () => {
    const { section, parent } = makeSection()
    pushState(section, { directory: 'D:/x', entries: [{ name: 'a.css', enabled: false }] })
    pushState(section, { directory: 'D:/x', entries: [
      { name: 'a.css', enabled: true }, { name: 'b.css', enabled: false },
    ] })
    const boxes = [...parent.querySelectorAll<HTMLInputElement>('input[data-snippet-name]')]
    expect(boxes.map((b) => b.dataset.snippetName)).toEqual(['a.css', 'b.css'])
    expect(boxes[0]!.checked).toBe(true)
  })
})

describe('搜索 entries 与不注入用户 CSS', () => {
  it('entries 动态并入：目录行静态入口 + 已知片段文件条目', () => {
    const { section } = makeSection()
    expect(section.entries.map((e) => e.id)).toEqual(['directory'])
    pushState(section, { directory: 'D:/x', entries: [
      { name: 'a.css', enabled: false }, { name: 'b.css', enabled: false },
    ] })
    expect(section.entries.map((e) => e.id)).toEqual(['directory', 'snippet:a.css', 'snippet:b.css'])
    expect(section.entries[0]!.title).toBe(zhCn['cssSnippets.directoryLabel'])
  })

  it('设置页不注入用户 CSS：任何状态下都不创建片段 <link>（与编辑器 webview 的装配器无关）', () => {
    const { section, parent } = makeSection()
    pushState(section, { directory: 'D:/x', entries: [{ name: 'a.css', enabled: true }] })
    expect(document.head.querySelectorAll('link[data-vsidian-snippet]')).toHaveLength(0)
    expect(parent.querySelectorAll('link')).toHaveLength(0)
  })
})
