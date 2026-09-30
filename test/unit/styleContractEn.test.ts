// 英文平行覆盖一致性契约（#178 机制 + #179 content 域全量 + #180 chrome 域
// 全量）：src/shared/styleContractEn.ts 是条目文档字段英文版的单一事实源——
// 按条目 id 索引、字段级覆盖，取词规则为英文优先、条目或字段缺失回退中文
// 基准（规格 docs/specs/style-reference-i18n.md）。本测试钉住：
// - 覆盖集 id ⊆ 中文清单条目 id（清单删除/改名条目时英文表同步收敛）；
// - 覆盖字段键只含双语字段（purpose/states/dom/deprecated/removed/
//   obsidian.counterpart），不译字段（target/example/aliasTargets/
//   introduced/verification/id/views）不得出现；可选字段仅当中文条目
//   确有该字段时才覆盖（无值字段跳过）；
// - 覆盖值非空字符串；
// - 反向完整性：中文条目双语字段有值 ⇒ 英文覆盖必有对应键且非空
//   （141 条全量；不译字段不在锁内）——防未来新增条目/字段漏翻；
// - content 域 80 条、chrome 域 65 条 id 全量覆盖（#179/#180 域级完整性，
//   合计 141 条全覆盖）——合并 main（#191/#201/#208/#209 并入）+ #213 后基线；
// - 取词纯函数行为：英文语言字段级 merge、非英文语言与覆盖表缺失条目
//   原样返回、原条目不被改写；
// - 生成数据模块（styleGuideData.ts，settings.js 渲染数据）携带同源双语。
import { describe, expect, it } from 'vitest'
import { STYLE_CONTRACT_ENTRIES } from '../../src/shared/styleContract'
import { STYLE_CONTRACT_EN_OVERRIDES, applyStyleContractEntryOverride } from '../../src/shared/styleContractEn'
import { STYLE_GUIDE_EN_OVERRIDES } from '../../src/webview/styleGuideData'

/** 双语字段全集（规格字段分级；obsidian 覆盖形态固定为 { counterpart }） */
const BILINGUAL_KEYS = ['purpose', 'states', 'dom', 'deprecated', 'removed', 'obsidian'] as const

type OverrideField = Exclude<keyof typeof STYLE_CONTRACT_EN_OVERRIDES[string], 'obsidian'>

describe('英文覆盖一致性契约（#178 机制 + #179 content 域全量 + #180 chrome 域全量）', () => {
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

  it('取词：非英文语言原样返回（同一引用，零开销回退）；覆盖表缺条目同样原样返回', () => {
    const entry = entryById.get('container-live')!
    expect(applyStyleContractEntryOverride(entry, 'zh-cn', STYLE_CONTRACT_EN_OVERRIDES)).toBe(entry)
    expect(applyStyleContractEntryOverride(entry, '', STYLE_CONTRACT_EN_OVERRIDES)).toBe(entry)
    // #180 起两域全量覆盖（合并 main 后 140 条），覆盖表已无真实缺口条目——「表内缺条目
    // 原样返回」的回退分支用合成空表保留纯函数行为断言（消费方传入部分
    // 覆盖表仍是合法形态）。
    expect(applyStyleContractEntryOverride(entry, 'en', {})).toBe(entry)
  })

  it('content 域全部 82 条 id 均有英文覆盖（#179 全量交付 + 独行图片布局 + 失败态细分 + #213 行背景变量 + #222 嵌入 + #223 Live 嵌入宿主 + #217 验收反馈转义符）', () => {
    const contentIds = STYLE_CONTRACT_ENTRIES.filter((e) => e.domain === 'content').map((e) => e.id)
    expect(contentIds.length).toBe(82)
    for (const id of contentIds) {
      expect(STYLE_CONTRACT_EN_OVERRIDES[id], `content 条目缺英文覆盖：${id}`).toBeDefined()
    }
  })

  it('chrome 域全部 65 条 id 均有英文覆盖（#180 全量交付 + #191 折行钮 + #208 刷新钮 + 面板批次 + #218 悬停浮层 + #220 属性区）', () => {
    const chromeIds = STYLE_CONTRACT_ENTRIES.filter((e) => e.domain === 'chrome').map((e) => e.id)
    expect(chromeIds.length).toBe(65)
    for (const id of chromeIds) {
      expect(STYLE_CONTRACT_EN_OVERRIDES[id], `chrome 条目缺英文覆盖：${id}`).toBeDefined()
    }
  })

  it('两域合计 147 条全量覆盖，无覆盖表缺口（#179 + #180 收尾 + #191 + #201 + #208/#209 + #213 批次 + #218 悬停浮层 + #220 属性区 + #222 嵌入 + #223 Live 嵌入 + #217 验收反馈转义符）', () => {
    expect(STYLE_CONTRACT_ENTRIES.length).toBe(147)
    expect(Object.keys(STYLE_CONTRACT_EN_OVERRIDES).length).toBe(147)
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      expect(STYLE_CONTRACT_EN_OVERRIDES[entry.id], `条目缺英文覆盖：${entry.id}`).toBeDefined()
    }
  })

  it('取词：本模块覆盖表直连消费（container-reading 字段级覆盖与中文回退）', () => {
    const entry = entryById.get('container-reading')!
    const override = STYLE_CONTRACT_EN_OVERRIDES['container-reading']!
    const localized = applyStyleContractEntryOverride(entry, 'en', STYLE_CONTRACT_EN_OVERRIDES)
    expect(localized.purpose).toBe(override.purpose)
    expect(localized.obsidian.counterpart).toBe(override.obsidian!.counterpart)
    expect(applyStyleContractEntryOverride(entry, 'zh-cn', STYLE_CONTRACT_EN_OVERRIDES)).toBe(entry)
  })

  it('反向完整性：中文条目双语字段有值 ⇒ 英文覆盖必有对应键且非空（145 条全量）', () => {
    // 双语字段反向锁（规格字段分级）：purpose/dom 为必填恒锁；states/
    // deprecated/removed 为可选，中文条目确有该字段才锁；example 等不译
    // 字段不在锁内。防未来新增条目/改写字段时英文覆盖漏跟（正向键锁
    // 只防「覆盖表脏键」，此锁防「基准扩展后覆盖静默缺失」）。
    const requiredKeys = ['purpose', 'dom'] as const
    const optionalKeys = ['states', 'deprecated', 'removed'] as const
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      const override = STYLE_CONTRACT_EN_OVERRIDES[entry.id]
      for (const key of requiredKeys) {
        const enValue = override?.[key]
        expect(
          typeof enValue === 'string' && enValue.trim().length > 0,
          `${entry.id}.${key}：必填双语字段英文覆盖缺失或为空`,
        ).toBe(true)
      }
      for (const key of optionalKeys) {
        if (entry[key] === undefined) continue
        const enValue = override?.[key]
        expect(
          typeof enValue === 'string' && enValue.trim().length > 0,
          `${entry.id}.${key}：中文基准有值而英文覆盖缺失或为空`,
        ).toBe(true)
      }
      if (entry.obsidian.counterpart) {
        const enCounterpart = override?.obsidian?.counterpart
        expect(
          typeof enCounterpart === 'string' && enCounterpart.trim().length > 0,
          `${entry.id}.obsidian.counterpart：中文基准有值而英文覆盖缺失或为空`,
        ).toBe(true)
      }
    }
  })
  it('生成数据模块携带同源双语（settings.js 渲染数据由生成器内联）', () => {
    expect(Object.keys(STYLE_GUIDE_EN_OVERRIDES)).toEqual(Object.keys(STYLE_CONTRACT_EN_OVERRIDES))
    for (const [id, override] of Object.entries(STYLE_CONTRACT_EN_OVERRIDES)) {
      expect(STYLE_GUIDE_EN_OVERRIDES[id], `${id} 生成物覆盖与源一致`).toEqual(override)
    }
  })
})
