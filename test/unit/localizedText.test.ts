// #473 枚举档位本地化标签——多语言文本选值纯函数契约测试。
// 语义与 #464 行为名多语言（resolveAddonBehaviorName）对齐：键规整
// trim+小写、zh 系候选链 zh-cn→zh→en、非 zh 只试 en、全缺取字典序
// 最小键（兜底非空、确定性）。
import { describe, expect, it } from 'vitest'
import {
  LOCALIZED_TEXT_DEFAULT_LIMITS,
  isUsableLocalizedText,
  normalizeLocaleKey,
  resolveLocalizedText,
} from '../../src/shared/localizedText'

describe('#473 多语言文本（localizedText）', () => {
  it('纯字符串直值原样返回（不随语言切换）', () => {
    expect(resolveLocalizedText('直值', 'zh-cn')).toBe('直值')
    expect(resolveLocalizedText('plain', 'en')).toBe('plain')
  })

  it('键规整：trim + 小写（" ZH-CN " 与 "zh-cn" 同键）', () => {
    expect(normalizeLocaleKey(' ZH-CN ')).toBe('zh-cn')
    expect(resolveLocalizedText({ ' ZH-CN ': '中文', en: 'EN' }, 'zh-cn')).toBe('中文')
  })

  it('zh 系页面语言候选链 zh-cn → zh → en', () => {
    expect(resolveLocalizedText({ 'zh-cn': '简中', en: 'EN' }, 'zh-cn')).toBe('简中')
    expect(resolveLocalizedText({ zh: '中文', en: 'EN' }, 'zh-cn')).toBe('中文')
    expect(resolveLocalizedText({ zh: '中文', en: 'EN' }, 'zh-tw')).toBe('中文')
    expect(resolveLocalizedText({ en: 'EN', ja: '日本語' }, 'zh-cn')).toBe('EN')
  })

  it('非 zh 页面语言只试 en', () => {
    expect(resolveLocalizedText({ 'zh-cn': '简中', en: 'EN' }, 'en')).toBe('EN')
  })

  it('候选全缺：取规整后字典序最小的键（兜底非空、确定性）', () => {
    expect(resolveLocalizedText({ fr: 'FR', de: 'DE' }, 'zh-cn')).toBe('DE')
    expect(resolveLocalizedText({ fr: 'FR', de: 'DE' }, 'en')).toBe('DE')
    expect(resolveLocalizedText({ 'zh-cn': '简中', ja: '日本語' }, 'ja')).toBe('日本語')
  })

  it('守卫外输入的防御：空映射返回空串（不抛、不传播 undefined）', () => {
    expect(resolveLocalizedText({} as never, 'zh-cn')).toBe('')
  })

  it('守卫 isUsableLocalizedText：直值与合法映射通过，非法形态拒绝', () => {
    expect(isUsableLocalizedText('x', LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(true)
    expect(isUsableLocalizedText({ 'zh-cn': '中文', en: 'EN' }, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(true)
    expect(isUsableLocalizedText('', LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false) // 直值 trim 非空
    expect(isUsableLocalizedText('   ', LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false)
    expect(isUsableLocalizedText(null, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false)
    expect(isUsableLocalizedText(123, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false)
    expect(isUsableLocalizedText([], LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false)
    expect(isUsableLocalizedText({}, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false) // 空映射拒绝
    expect(isUsableLocalizedText({ a: '' }, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false) // 值空
    expect(isUsableLocalizedText({ a: 1 }, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false) // 值非字符串
    expect(isUsableLocalizedText({ zh: '中', ZH: '重' }, LOCALIZED_TEXT_DEFAULT_LIMITS)).toBe(false) // 键规整重复
  })

  it('守卫上限：文本长度 / 语言键长度 / 映射条目数（对齐 #464 行为名常量）', () => {
    const limits = LOCALIZED_TEXT_DEFAULT_LIMITS
    expect(limits.textLimit).toBe(256)
    expect(limits.localeKeyLimit).toBe(64)
    expect(limits.localesLimit).toBe(32)
    expect(isUsableLocalizedText('x'.repeat(256), limits)).toBe(true)
    expect(isUsableLocalizedText('x'.repeat(257), limits)).toBe(false)
    expect(isUsableLocalizedText({ ['x'.repeat(64)]: 'v' }, limits)).toBe(true)
    expect(isUsableLocalizedText({ ['x'.repeat(65)]: 'v' }, limits)).toBe(false)
    const full: Record<string, string> = {}
    for (let i = 0; i < 32; i++) full[`l${i}`] = 'v'
    expect(isUsableLocalizedText(full, limits)).toBe(true)
    full['l32'] = 'v'
    expect(isUsableLocalizedText(full, limits)).toBe(false)
  })
})
