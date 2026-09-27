// 设置页「样式参考」分页契约（#132/#145）：离线渲染生成数据模块
// （styleGuideData.ts ← scripts/genStyleGuide.mjs ← src/shared/styleContract.ts），
// 钉住：#145 小类分栏（类目栏含域分组与计数）、分页（每页 15 条、页码导航、
// 类目切换重置）、跨类目聚合搜索（来源类目标注）、支持等级过滤、
// focusEntry 跳页定位、导出按钮经消息桥请求宿主。
// UI 文案经 t()；条目内容为文档数据。
// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { StyleReferenceSection, categoryEntryCounts } from '../../src/webview/styleReferenceSettings'
import {
  STYLE_GUIDE_CATEGORIES,
  STYLE_GUIDE_ENTRIES,
  STYLE_GUIDE_VERSION,
} from '../../src/webview/styleGuideData'

beforeAll(() => {
  installLocale('zh-cn', zhCn)
})

interface Sent { messages: unknown[] }

function mount(focusEntry?: string): { parent: HTMLElement; section: StyleReferenceSection; sent: Sent } {
  const parent = document.createElement('div')
  const sent: Sent = { messages: [] }
  const section = new StyleReferenceSection({ postMessage: (message) => sent.messages.push(message) })
  section.mount(parent, focusEntry)
  return { parent, section, sent }
}

function cardIds(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll('.vsidian-style-ref-entry')].map((el) => (el as HTMLElement).dataset['entry']!)
}

function catButton(parent: HTMLElement, categoryId: string): HTMLButtonElement {
  const button = parent.querySelector<HTMLButtonElement>(`.vsidian-style-ref-cat[data-category="${categoryId}"]`)
  expect(button, `类目按钮 ${categoryId}`).toBeTruthy()
  return button!
}

describe('样式参考分页（#145 小类分栏与分页）', () => {
  it('挂载即渲染：版本说明、变量别名总表、类目栏（域分组 + 计数）与默认类目首页', () => {
    const { parent } = mount()
    expect(parent.textContent).toContain(STYLE_GUIDE_VERSION)
    expect(parent.querySelectorAll('.vsidian-style-ref-vars tbody tr').length).toBeGreaterThanOrEqual(12)
    // 类目栏：两域分组标题 + 全部类目按钮 + 计数与实际条目数一致
    expect(parent.querySelectorAll('.vsidian-style-ref-cats-domain').length).toBe(2)
    const counts = categoryEntryCounts(STYLE_GUIDE_ENTRIES)
    const buttons = parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-cat')
    expect(buttons.length).toBe(STYLE_GUIDE_CATEGORIES.length)
    for (const button of buttons) {
      const id = button.dataset['category']!
      expect(button.querySelector('.vsidian-style-ref-cat-count')!.textContent).toBe(String(counts.get(id)))
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(STYLE_GUIDE_ENTRIES.length)
    // 默认选中首个类目（content 域 order 1）：其条目渲染且不超过每页上限
    const firstCat = STYLE_GUIDE_CATEGORIES.find((c) => c.domain === 'content' && c.order === 1)!
    expect(catButton(parent, firstCat.id).getAttribute('aria-current')).toBe('true')
    const ids = cardIds(parent)
    expect(ids.length).toBe(Math.min(15, counts.get(firstCat.id)!))
    // 卡片内容不空洞：direct 条目含别名承诺与示例
    const strongCard = parent.querySelector('[data-entry="inline-strong"]')
    if (ids.includes('inline-strong')) {
      expect(strongCard!.textContent).toContain('cm-strong')
      expect(strongCard!.querySelector('pre code')?.textContent).toContain('.cm-strong')
    }
  })

  it('类目切换渲染该类目条目并重置到第一页；大纲类目分页导航可用', () => {
    const { parent } = mount()
    const outline = catButton(parent, 'outline')
    outline.click()
    let ids = cardIds(parent)
    expect(ids.length).toBe(15)
    expect(ids.every((id) => STYLE_GUIDE_ENTRIES.find((e) => e.id === id)!.category === 'outline')).toBe(true)
    expect(outline.getAttribute('aria-current')).toBe('true')
    // 19 条 → 2 页：指示「第 1 / 2 页」，下一页切换内容变化，上一页在首页禁用
    expect(parent.querySelector('.vsidian-style-ref-page-indicator')!.textContent).toBe('第 1 / 2 页')
    expect(parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-pager button')!.disabled).toBe(true)
    parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-pager button')[1]!.click()
    // 翻页后 pager 由 render 重建，重新查询断言
    ids = cardIds(parent)
    expect(ids.length).toBe(4)
    expect(parent.querySelector('.vsidian-style-ref-page-indicator')!.textContent).toBe('第 2 / 2 页')
    expect(parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-pager button')!.disabled).toBe(false)
    expect(parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-pager button')[1]!.disabled).toBe(true)
    // 切换到小类目（单页）：分页导航收起、页码重置
    catButton(parent, 'toolbar-banner').click()
    expect(cardIds(parent).length).toBe(3)
    expect(parent.querySelector('.vsidian-style-ref-pager')!.children.length).toBe(0)
  })

  it('支持等级过滤在当前类目内生效', () => {
    const { parent } = mount()
    catButton(parent, 'heading').click()
    const supportSel = parent.querySelector<HTMLSelectElement>('select[aria-label="按支持等级筛选"]')!
    supportSel.value = 'none'
    supportSel.dispatchEvent(new Event('change'))
    const ids = cardIds(parent)
    expect(ids.length).toBe(
      STYLE_GUIDE_ENTRIES.filter((e) => e.category === 'heading' && e.obsidian.support === 'none').length,
    )
  })

  it('文本搜索跨类目聚合：命中计数、来源类目标注、等级过滤仍生效', () => {
    const { parent } = mount()
    const search = parent.querySelector<HTMLInputElement>('input[aria-label="搜索条目（ID / 选择器 / 用途）"]')!
    search.value = 'wikilink'
    search.dispatchEvent(new Event('input'))
    let ids = cardIds(parent)
    expect(ids).toContain('live-wikilink')
    expect(ids).toContain('reading-wikilink')
    // 跨类目标注（live-wikilink 属 link-image-wikilink 类目；命中数与全集一致）
    expect(parent.querySelector('[data-entry="live-wikilink"] .vsidian-style-ref-cat-chip')!.textContent)
      .toBe(zhCn['styleRef.category.linkImageWikilink'])
    const expected = STYLE_GUIDE_ENTRIES.filter((e) =>
      `${e.id} ${e.target} ${e.purpose}`.toLowerCase().includes('wikilink')).length
    expect(parent.querySelector('.vsidian-style-ref-search-count')!.textContent)
      .toBe(`全部类目命中 ${expected} 条`)
    // 搜索结果分页：上一页/下一页按聚合全集计算
    // 等级过滤叠加
    const supportSel = parent.querySelector<HTMLSelectElement>('select[aria-label="按支持等级筛选"]')!
    supportSel.value = 'direct'
    supportSel.dispatchEvent(new Event('change'))
    ids = cardIds(parent)
    const expectedDirect = STYLE_GUIDE_ENTRIES.filter((e) =>
      `${e.id} ${e.target} ${e.purpose}`.toLowerCase().includes('wikilink') && e.obsidian.support === 'direct').length
    expect(ids.length + (parent.querySelector('.vsidian-style-ref-page-indicator') ? 0 : 0))
      .toBe(Math.min(15, expectedDirect))
  })

  it('无命中显示空态；focusEntry 定位跨页目标（跳到所在类目与页）', () => {
    const { parent } = mount()
    const search = parent.querySelector<HTMLInputElement>('input[aria-label="搜索条目（ID / 选择器 / 用途）"]')!
    search.value = '不存在的词条 xyz'
    search.dispatchEvent(new Event('input'))
    expect(parent.querySelector('.vsidian-settings-empty')!.textContent).toContain('没有条目')

    const parent2 = document.createElement('div')
    const section2 = new StyleReferenceSection({ postMessage: () => undefined })
    // outline-search-hit 落在 outline 类目（19 条）内，跨页目标按类目内序号定位
    const target = STYLE_GUIDE_ENTRIES.find((e) => e.id === 'outline-search-hit')!
    const categorySize = STYLE_GUIDE_ENTRIES.filter((e) => e.category === target.category).length
    const indexInCategory = STYLE_GUIDE_ENTRIES.filter((e) => e.category === target.category).indexOf(target)
    section2.mount(parent2, 'outline-search-hit')
    const el = parent2.querySelector('[data-entry="outline-search-hit"]')
    expect(el).not.toBeNull()
    expect(el!.classList.contains('vsidian-settings-item-located')).toBe(true)
    expect(parent2.querySelector('.vsidian-style-ref-page-indicator')!.textContent)
      .toBe(`第 ${Math.floor(indexInCategory / 15) + 1} / ${Math.ceil(categorySize / 15)} 页`)
  })

  it('导出按钮经消息桥请求宿主（styleRef.export）', () => {
    const { parent, sent } = mount()
    const button = parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-export')!
    expect(button.textContent).toBe(zhCn['styleRef.exportJson'])
    expect(sent.messages.length).toBe(0)
    button.click()
    expect(sent.messages).toEqual([{ kind: 'styleRef.export' }])
  })

  it('全局搜索 entries 覆盖全部条目（设置页搜索可定位）', () => {
    const section = new StyleReferenceSection({ postMessage: () => undefined })
    expect(section.entries.length).toBe(STYLE_GUIDE_ENTRIES.length + 1)
  })
})
