// 设置页「样式参考」英文 UI 呈现（#178 试点端到端 + #179 content 域全量 +
// #180 chrome 域全量与全局残留断言）：renderCard 按 UI 语言取词——英文环境
// 140 条条目全部显示英文；换包后经设置页壳层重刷路径（applyLocale → render
// → section.mount 重建）跟随新语言。
// 断言落在用户可见文本（卡片 textContent / 类目名），非 DOM 存在性
// （PR #37 教训：样式注入失效时 DOM 存在性照样通过）。
// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { STYLE_CONTRACT_EN_OVERRIDES } from '../../src/shared/styleContractEn'
import { STYLE_GUIDE_ENTRIES } from '../../src/webview/styleGuideData'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { CJK_RE } from './i18nScan'

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

  it('英文环境：reading 容器同样显示英文，试点外条目（content 与 chrome 域抽验）均显示英文', () => {
    const parent = mountDetail('container-reading')
    const readingOverride = STYLE_CONTRACT_EN_OVERRIDES['container-reading']!
    const readingCard = cardOf(parent, 'container-reading')
    expect(readingCard.textContent).toContain(readingOverride.purpose!)
    expect(readingCard.textContent).toContain(readingOverride.obsidian!.counterpart)
    expect(readingCard.textContent).not.toContain('阅读）视图容器')

    // content 域 #179 起全量覆盖：试点外条目（heading 类目抽验）同样显示英文
    parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-cat[data-category="heading"]')!.click()
    const headingCard = cardOf(parent, 'live-heading-line')
    expect(headingCard.textContent).toContain(STYLE_CONTRACT_EN_OVERRIDES['live-heading-line']!.purpose!)
    expect(headingCard.textContent).not.toContain('行容器')
    expect(headingCard.textContent).not.toContain('整行级样式入口')

    // chrome 域 #180 起全量覆盖：条目（math 类目抽验）显示英文，中文基准不再出现
    parent.querySelector<HTMLButtonElement>('.vsidian-style-ref-cat[data-category="math"]')!.click()
    const mathCard = cardOf(parent, 'live-math')
    expect(mathCard.textContent).toContain(STYLE_CONTRACT_EN_OVERRIDES['live-math']!.purpose!)
    expect(mathCard.textContent).toContain(STYLE_CONTRACT_EN_OVERRIDES['live-math']!.obsidian!.counterpart)
    expect(mathCard.textContent).not.toContain('公式渲染态稳定容器')
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

// ---------------------------------------------------------------------------
// #180 收尾：全局残留断言——英文 UI 下「样式参考」页无中文残留。
//
// 断言口径：汉字 [\u4e00-\u9fff]，直接引用 test/unit/i18nScan.ts 的
// CJK_RE（同一正则对象，非复制；全角标点不算 CJK——renderCard 骨架里的
// 全角冒号是既定呈现，不属残留）。
// 断言层级（用户可见文本层，PR #37 教训）：
// - 总表面板整体 textContent（版本说明/别名桥要点/变量总表 = t() 词条 +
//   ASCII 变量名，本就应无汉字）；
// - 每张条目卡片中承载翻译面的四个可见段落——purpose 段（标题后首个
//   p）、meta 段（视图徽标 + 支持等级 + states）、Obsidian 对应段、life
//   生命周期行（deprecated/removed 词条与英译值在此渲染）——无汉字；
// - 搜索聚合模式对全部 140 条 id 逐一检索（子串命中放大覆盖面），聚合
//   渲染路径（含来源类目 chip 与命中计数行）同口径断言。
// 不译字段按规格保留中文（target / example 会出现在卡片标题 code、示例
// pre），故不做整卡 textContent 汉字断言——那与规格字段分级冲突；段落
// 断言恰好堵住「漏翻条目回退中文基准」这一本票要防的失效模式。life 行
// 行首的 introduced 同为不译字段，且清单 20 条的 introduced 值含中文
// 说明（数据形态不止「#N（日期）」），按规格属既定呈现、不算残留——
// life 断言先剔除行首 introduced 原文再判汉字，只锁翻译面（deprecated/
// removed 词条与英译值）。
// ---------------------------------------------------------------------------
describe('样式参考英文 UI 全局残留断言（#180 收尾）', () => {
  // 显式固定英文环境：不依赖前序 describe 留下的语言状态
  beforeAll(() => {
    installLocale('en', en)
  })

  // introduced 原文表（渲染消费的生成数据与中文基准同源）：renderCard 以
  // introduced 作为 life 行首段拼行，剔除后再对翻译面判汉字
  const introducedById = new Map(STYLE_GUIDE_ENTRIES.map((e) => [e.id, e.introduced]))

  /** 翻译面可见段落无汉字断言（purpose / meta / obsidian / life 四段） */
  function assertCardSectionsHanFree(card: HTMLElement, label: string): void {
    const purpose = card.querySelector('p')
    const meta = card.querySelector('.vsidian-style-ref-meta')
    const obsidian = card.querySelector('.vsidian-style-ref-obsidian')
    for (const [name, el] of [
      ['purpose', purpose],
      ['meta/states', meta],
      ['counterpart', obsidian],
    ] as const) {
      expect(el, `${label}：双语段落 ${name} 未渲染`).toBeTruthy()
      const text = el!.textContent ?? ''
      const m = CJK_RE.exec(text)
      expect(m, `${label}：${name} 段残留汉字「${m?.[0]}」——「${text.slice(0, 80)}」`).toBeNull()
    }
    // life 生命周期行：deprecated/removed 词条与英译值在此渲染；行首
    // introduced 为不译字段（规格保留中文），剔除其原文后断言翻译面
    const life = card.querySelector('.vsidian-style-ref-life')
    expect(life, `${label}：生命周期行未渲染`).toBeTruthy()
    const lifeText = life!.textContent ?? ''
    const introduced = introducedById.get(card.dataset['entry']!) ?? ''
    const translatedPart = lifeText.startsWith(introduced) ? lifeText.slice(introduced.length) : lifeText
    const m = CJK_RE.exec(translatedPart)
    expect(m, `${label}：life 行翻译面残留汉字「${m?.[0]}」——「${lifeText.slice(0, 80)}」`).toBeNull()
  }

  it('总表面板整体无汉字（版本说明/别名桥要点/变量别名总表）', () => {
    const parent = mountDetail('overview')
    const overview = parent.querySelector('.vsidian-style-ref-overview')!
    const m = CJK_RE.exec(overview.textContent ?? '')
    expect(m, `总表面板残留汉字「${m?.[0]}」`).toBeNull()
  })

  it('全部类目遍历渲染（含翻页）：双语字段段落无汉字，且全部条目被遍历到', () => {
    const parent = mountDetail('overview')
    const catButtons = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-cat')]
    // 23 = content 10 + chrome 13（#236 起新增 find-panel 类目）
    expect(catButtons.length).toBe(23)
    const seen = new Set<string>()
    for (const cat of catButtons) {
      const catId = cat.dataset['category']!
      cat.click() // 类目切换重置到第一页（render 语义）
      for (;;) {
        for (const card of parent.querySelectorAll<HTMLElement>('.vsidian-style-ref-entry')) {
          const id = card.dataset['entry']!
          seen.add(id)
          assertCardSectionsHanFree(card, `类目 ${catId} 条目 ${id}`)
        }
        // 翻页：分页行存在时点「下一页」直至禁用（outline 类目 19 条占两页）
        const pageButtons = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-page-btn')]
        const pager = parent.querySelector('.vsidian-style-ref-pager')!
        if (pager.childElementCount > 0) {
          const m = CJK_RE.exec(pager.textContent ?? '')
          expect(m, `类目 ${catId} 分页指示残留汉字`).toBeNull()
        }
        const next = pageButtons[pageButtons.length - 1]
        if (!next || next.disabled) break
        next.click()
      }
    }
    // 遍历完整性：seen 集合必须覆盖清单全部条目（分页/过滤失灵会被此处暴露）
    expect(seen.size).toBe(STYLE_GUIDE_ENTRIES.length)
  })

  it('搜索聚合模式：逐 id 检索全部条目，聚合渲染的双语字段段落与命中计数行无汉字', () => {
    const parent = mountDetail('overview')
    const search = parent.querySelector<HTMLInputElement>('input[type="search"]')!
    for (const entry of STYLE_GUIDE_ENTRIES) {
      search.value = entry.id
      search.dispatchEvent(new Event('input'))
      const cards = [...parent.querySelectorAll<HTMLElement>('.vsidian-style-ref-entry')]
      expect(cards.length, `搜索 ${entry.id} 应至少命中其自身条目`).toBeGreaterThan(0)
      for (const card of cards) {
        assertCardSectionsHanFree(card, `搜索 ${entry.id} 命中条目 ${card.dataset['entry']}`)
      }
      // 聚合提示行（「{count} matches across all categories」）为 t() 词条
      const summary = parent.querySelector('.vsidian-style-ref-search-count')!
      const m = CJK_RE.exec(summary.textContent ?? '')
      expect(m, `搜索 ${entry.id} 聚合计数行残留汉字`).toBeNull()
    }
    // 收尾：清空搜索回到类目浏览形态
    search.value = ''
    search.dispatchEvent(new Event('input'))
    expect(parent.querySelector('.vsidian-style-ref-search-count')).toBeNull()
  })
})
