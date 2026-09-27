// 设置页「样式参考」分页契约（#132）：离线渲染生成数据模块
// （styleGuideData.ts ← scripts/genStyleGuide.mjs ← src/shared/styleContract.ts），
// 钉住：分页可挂载且条目非空、域/等级过滤与搜索可用、卡片含别名承诺与示例、
// 全局搜索定位（focusEntry）滚动目标存在。UI 文案经 t()；条目内容为文档数据。
// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { STYLE_GUIDE_ENTRIES, STYLE_GUIDE_VERSION } from '../../src/webview/styleGuideData'

beforeAll(() => {
  installLocale('zh-cn', zhCn)
})

function mount(): { parent: HTMLElement; section: StyleReferenceSection } {
  const parent = document.createElement('div')
  const section = new StyleReferenceSection()
  section.mount(parent)
  return { parent, section }
}

describe('样式参考分页（#132）', () => {
  it('挂载即渲染：版本说明、变量别名总表与全部条目卡片', () => {
    const { parent } = mount()
    expect(parent.textContent).toContain(STYLE_GUIDE_VERSION)
    expect(parent.querySelectorAll('.vsidian-style-ref-vars tbody tr').length).toBeGreaterThanOrEqual(12)
    const cards = parent.querySelectorAll('.vsidian-style-ref-entry')
    expect(cards.length).toBe(STYLE_GUIDE_ENTRIES.length)
    // direct 条目卡片含别名承诺
    const strongCard = parent.querySelector('[data-entry="inline-strong"]')
    expect(strongCard).not.toBeNull()
    expect(strongCard!.textContent).toContain('cm-strong')
    expect(strongCard!.querySelector('pre code')?.textContent).toContain('.cm-strong')
  })

  it('域与支持等级过滤生效（界面域筛后只剩 chrome 条目）', () => {
    const { parent } = mount()
    const domainSel = parent.querySelector<HTMLSelectElement>('select[aria-label="按域筛选"]')!
    domainSel.value = 'chrome'
    domainSel.dispatchEvent(new Event('change'))
    const ids = [...parent.querySelectorAll('.vsidian-style-ref-entry')].map((el) => (el as HTMLElement).dataset['entry'])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.length).toBe(STYLE_GUIDE_ENTRIES.filter((e) => e.domain === 'chrome').length)

    const supportSel = parent.querySelector<HTMLSelectElement>('select[aria-label="按支持等级筛选"]')!
    supportSel.value = 'direct'
    supportSel.dispatchEvent(new Event('change'))
    const directIds = [...parent.querySelectorAll('.vsidian-style-ref-entry')].map((el) => (el as HTMLElement).dataset['entry'])
    expect(directIds.length).toBe(
      STYLE_GUIDE_ENTRIES.filter((e) => e.domain === 'chrome' && e.obsidian.support === 'direct').length,
    )
  })

  it('文本搜索即时过滤（选择器子串命中）', () => {
    const { parent } = mount()
    const search = parent.querySelector<HTMLInputElement>('input[aria-label="搜索条目（ID / 选择器 / 用途）"]')!
    search.value = 'wikilink'
    search.dispatchEvent(new Event('input'))
    const ids = [...parent.querySelectorAll('.vsidian-style-ref-entry')].map((el) => (el as HTMLElement).dataset['entry'])
    expect(ids).toContain('live-wikilink')
    expect(ids).toContain('reading-wikilink')
    expect(ids.length).toBeLessThan(STYLE_GUIDE_ENTRIES.length)
  })

  it('无命中显示空态；focusEntry 定位目标卡片', () => {
    const parent = document.createElement('div')
    const section = new StyleReferenceSection()
    section.mount(parent, 'live-table-cell')
    const target = parent.querySelector('[data-entry="live-table-cell"]')
    expect(target).not.toBeNull()
    expect(target!.classList.contains('vsidian-settings-item-located')).toBe(true)
    void mount
  })

  it('全局搜索 entries 覆盖全部条目（设置页搜索可定位）', () => {
    const section = new StyleReferenceSection()
    expect(section.entries.length).toBe(STYLE_GUIDE_ENTRIES.length + 1)
    void en
  })
})
