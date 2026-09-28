// 设置页「样式参考」英文 UI 呈现（#178 试点端到端）：renderCard 按 UI 语言
// 取词——英文环境试点条目显示英文，未覆盖条目回退中文基准；换包后经设置页
// 壳层重刷路径（applyLocale → render → section.mount 重建）跟随新语言。
// 断言落在用户可见文本（卡片 textContent / 类目名），非 DOM 存在性
// （PR #37 教训：样式注入失效时 DOM 存在性照样通过）。
// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { STYLE_CONTRACT_EN_OVERRIDES } from '../../src/shared/styleContractEn'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'

function mountDetail(focusEntry?: string): HTMLElement {
  const parent = document.createElement('div')
  const section = new StyleReferenceSection({ postMessage: () => undefined })
  section.mount(parent, focusEntry)
  return parent
}

function cardOf(parent: HTMLElement, entryId: string): HTMLElement {
  const card = parent.querySelector<HTMLElement>(`[data-entry="${entryId}"]`)
  expect(card, `条目卡片 ${entryId} 应已渲染`).toBeTruthy()
  return card!
}

beforeAll(() => {
  installLocale('en', en)
})

// 文件级恢复 zh-cn：防御未来测试文件合并时语言状态泄漏
afterAll(() => {
  installLocale('zh-cn', zhCn)
})

describe('样式参考英文 UI 呈现（#178 试点）', () => {
  it('英文环境：试点条目卡片显示英文 purpose / counterpart 与英文骨架标签，中文文案不再出现', () => {
    const parent = mountDetail('container-live')
    // focusEntry 直达详细查询页签并定位试点条目
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(false)
    const liveOverride = STYLE_CONTRACT_EN_OVERRIDES['container-live']!
    const liveCard = cardOf(parent, 'container-live')
    expect(liveCard.textContent).toContain(liveOverride.purpose!)
    expect(liveCard.textContent).toContain(liveOverride.obsidian!.counterpart)
    // 骨架标签走 t() 词条：英文包词条出现在卡片上
    expect(liveCard.textContent).toContain(en['styleRef.obsidianCounterpart'])
    expect(liveCard.textContent).toContain(en['styleRef.supportDirect'])
    // 中文基准文案不再出现（条目数据中文串）
    expect(liveCard.textContent).not.toContain('实时预览）视图容器')
    expect(liveCard.textContent).not.toContain('编辑区容器')
  })

  it('英文环境：reading 容器同样显示英文，未覆盖条目回退中文基准', () => {
    const parent = mountDetail('container-reading')
    const readingOverride = STYLE_CONTRACT_EN_OVERRIDES['container-reading']!
    const readingCard = cardOf(parent, 'container-reading')
    expect(readingCard.textContent).toContain(readingOverride.purpose!)
    expect(readingCard.textContent).toContain(readingOverride.obsidian!.counterpart)
    expect(readingCard.textContent).not.toContain('阅读）视图容器')

    // 回退路径：未覆盖条目（heading 类目 live-heading-line）显示中文基准
    parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-cat[data-category="heading"]')!.click()
    const headingCard = cardOf(parent, 'live-heading-line')
    expect(headingCard.textContent).toContain('行容器')
    expect(headingCard.textContent).toContain('整行级样式入口')
  })

  it('英文环境：搜索按英文取词命中（用途词可检索）', () => {
    const parent = mountDetail('container-live')
    const search = parent.querySelector<HTMLInputElement>('input[type="search"]')!
    search.value = 'codemirror 6 editor'
    search.dispatchEvent(new Event('input'))
    expect(cardOf(parent, 'container-live').textContent).toContain(
      STYLE_CONTRACT_EN_OVERRIDES['container-live']!.purpose!,
    )
    expect(parent.querySelector('.vsidian-style-ref-search-count')!.textContent)
      .toBe(en['styleRef.searchCount'].replace('{count}', '1'))
  })

  it('换包跟随：zh-cn 呈现中文，切英文后经壳层重刷路径重建为英文', () => {
    // 中文装配：试点条目显示中文基准（现状无回归）
    installLocale('zh-cn', zhCn)
    const zhParent = mountDetail('container-live')
    expect(cardOf(zhParent, 'container-live').textContent).toContain('实时预览）视图容器')
    expect(cardOf(zhParent, 'container-live').textContent).not.toContain(
      STYLE_CONTRACT_EN_OVERRIDES['container-live']!.purpose!,
    )

    // 换包 → 设置页壳层 applyLocale 重建 section（此处按同一语义重新 mount）
    installLocale('en', en)
    const enParent = mountDetail('container-live')
    expect(cardOf(enParent, 'container-live').textContent).toContain(
      STYLE_CONTRACT_EN_OVERRIDES['container-live']!.purpose!,
    )
  })
})
