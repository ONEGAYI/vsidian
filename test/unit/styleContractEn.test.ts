// 英文平行覆盖一致性契约（#178 机制 + #179 content 域全量）：src/shared/
// styleContractEn.ts 是条目文档字段英文版的单一事实源——按条目 id 索引、
// 字段级覆盖，取词规则为英文优先、条目或字段缺失回退中文基准（规格
// docs/specs/style-reference-i18n.md）。本测试钉住：
// - 覆盖集 id ⊆ 中文清单条目 id（清单删除/改名条目时英文表同步收敛）；
// - 覆盖字段键只含双语字段（purpose/states/dom/deprecated/removed/
//   obsidian.counterpart），不译字段（target/example/aliasTargets/
//   introduced/verification/id/views）不得出现；可选字段仅当中文条目
//   确有该字段时才覆盖（无值字段跳过）；
// - 覆盖值非空字符串；
// - content 域 75 条 id 全量覆盖（#179 域级完整性）；
// - 取词纯函数行为：英文语言字段级 merge、非英文语言与未覆盖条目原样
//   返回、原条目不被改写；
// - 生成数据模块（styleGuideData.ts，settings.js 渲染数据）携带同源双语。
import { describe, expect, it } from 'vitest'
import { STYLE_CONTRACT_ENTRIES } from '../../src/shared/styleContract'
import {
  STYLE_CONTRACT_EN_OVERRIDES,
  applyStyleContractEntryOverride,
  localizedStyleContractEntry,
} from '../../src/shared/styleContractEn'
import { STYLE_GUIDE_EN_OVERRIDES } from '../../src/webview/styleGuideData'

/** 双语字段全集（规格字段分级；obsidian 覆盖形态固定为 { counterpart }） */
const BILINGUAL_KEYS = ['purpose', 'states', 'dom', 'deprecated', 'removed', 'obsidian'] as const

type OverrideField = Exclude<keyof typeof STYLE_CONTRACT_EN_OVERRIDES[string], 'obsidian'>

describe('英文覆盖一致性契约（#178 机制 + #179 content 域全量）', () => {
  const entryById = new Map(STYLE_CONTRACT_ENTRIES.map((entry) => [entry.id, entry]))

  it('覆盖集 id ⊆ 中文清单条目 id', () => {
    expect(Object.keys(STYLE_CONTRACT_EN_OVERRIDES).length).toBeGreaterThan(0)
    for (const id of Object.keys(STYLE_CONTRACT_EN_OVERRIDES)) {
      expect(entryById.has(id), `英文覆盖引用了未知条目 id：${id}`).toBe(true)
    }
  })

  it('覆盖字段键与中文条目形态一致且值非空', () => {
    for (const [id, override] of Object.entries(STYLE_CONTRACT_EN_OVERRIDES)) {
      const entry = entryById.get(id)!
      for (const key of Object.keys(override)) {
        expect(
          (BILINGUAL_KEYS as readonly string[]).includes(key),
          `${id}：覆盖键 ${key} 不在双语字段集（不译字段不得出现）`,
        ).toBe(true)
        if (key === 'obsidian') {
          expect(
            Object.keys(override.obsidian!),
            `${id}：obsidian 覆盖形态固定为 { counterpart }`,
          ).toEqual(['counterpart'])
          expect(override.obsidian!.counterpart.trim().length, `${id}.obsidian.counterpart 非空`).toBeGreaterThan(0)
          continue
        }
        const value = override[key as OverrideField]
        expect(typeof value === 'string' && value.trim().length > 0, `${id}.${key} 为非空字符串`).toBe(true)
        if (key === 'states' || key === 'deprecated' || key === 'removed') {
          expect(key in entry, `${id}：中文条目无 ${key} 字段，覆盖应跳过该字段`).toBe(true)
        }
      }
    }
  })

  it('取词：英文语言应用字段级覆盖，未覆盖字段回退中文基准，原条目不被改写', () => {
    const entry = entryById.get('container-live')!
    const localized = applyStyleContractEntryOverride(entry, 'en', STYLE_CONTRACT_EN_OVERRIDES)
    const override = STYLE_CONTRACT_EN_OVERRIDES['container-live']!
    expect(localized.purpose).toBe(override.purpose)
    expect(localized.dom).toBe(override.dom)
    expect(localized.obsidian.counterpart).toBe(override.obsidian!.counterpart)
    // 未覆盖字段与不译字段回退中文基准
    expect(localized.example).toBe(entry.example)
    expect(localized.views).toBe(entry.views)
    expect(localized.aliasTargets).toBe(entry.aliasTargets)
    expect(localized.introduced).toBe(entry.introduced)
    expect(localized.verification).toBe(entry.verification)
    expect(localized.obsidian.support).toBe(entry.obsidian.support)
    // 纯函数：不原地改写基准条目
    expect(entry.purpose).not.toBe(localized.purpose)
  })

  it('取词：非英文语言与未覆盖条目原样返回（同一引用，零开销回退）', () => {
    const entry = entryById.get('container-live')!
    expect(applyStyleContractEntryOverride(entry, 'zh-cn', STYLE_CONTRACT_EN_OVERRIDES)).toBe(entry)
    expect(applyStyleContractEntryOverride(entry, '', STYLE_CONTRACT_EN_OVERRIDES)).toBe(entry)
    // content 域 #179 起全量覆盖；未覆盖条目取 chrome 域（#180 渐进合入前的真实缺口）
    const uncovered = entryById.get('live-math')!
    expect(applyStyleContractEntryOverride(uncovered, 'en', STYLE_CONTRACT_EN_OVERRIDES)).toBe(uncovered)
  })

  it('content 域全部 75 条 id 均有英文覆盖（#179 全量交付）', () => {
    const contentIds = STYLE_CONTRACT_ENTRIES.filter((e) => e.domain === 'content').map((e) => e.id)
    expect(contentIds.length).toBe(75)
    for (const id of contentIds) {
      expect(STYLE_CONTRACT_EN_OVERRIDES[id], `content 条目缺英文覆盖：${id}`).toBeDefined()
    }
  })

  it('便捷封装 localizedStyleContractEntry 查本模块覆盖表', () => {
    const entry = entryById.get('container-reading')!
    const override = STYLE_CONTRACT_EN_OVERRIDES['container-reading']!
    expect(localizedStyleContractEntry(entry, 'en').purpose).toBe(override.purpose)
    expect(localizedStyleContractEntry(entry, 'en').obsidian.counterpart).toBe(override.obsidian!.counterpart)
    expect(localizedStyleContractEntry(entry, 'zh-cn')).toBe(entry)
  })

  it('生成数据模块携带同源双语（settings.js 渲染数据由生成器内联）', () => {
    expect(Object.keys(STYLE_GUIDE_EN_OVERRIDES)).toEqual(Object.keys(STYLE_CONTRACT_EN_OVERRIDES))
    for (const [id, override] of Object.entries(STYLE_CONTRACT_EN_OVERRIDES)) {
      expect(STYLE_GUIDE_EN_OVERRIDES[id], `${id} 生成物覆盖与源一致`).toEqual(override)
    }
  })
})
