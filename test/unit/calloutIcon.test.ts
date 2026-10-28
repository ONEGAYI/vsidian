// Callout 图标值解析与锁版库契约（#657/T06）：--callout-icon 公开变量的
// 取值形态（Lucide ID / SVG 字符串 / 非法值）与「自定义 ID 消费同一锁版
// 集合」的几何同源断言——库条目与 main.css mask 表的 data URL 解码后
// 逐字符一致（仅 stroke 颜色通道不同：mask 用 #000（alpha 通道）、库用
// currentColor（注入随类型色））。锁版声明 lucide-static 0.462.0
// （T03 取证留痕 out/test/lucide-icons/，0.462.0 无 help-circle/
// alert-triangle/check-circle-2 旧名——别名映射钉住 Obsidian 照录拼写）。
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_ICON_ALIASES,
  CALLOUT_ICON_LIBRARY,
  CALLOUT_ICON_VERSION,
  calloutIconLibraryKeyOf,
  parseCalloutIconValue,
} from '../../src/shared/calloutIcon'
import { CALLOUT_TYPES, calloutTypeOf } from '../../src/shared/calloutSyntax'
import { readMainCss } from './cssContract'

describe('parseCalloutIconValue：--callout-icon 取值形态', () => {
  it('空值/纯空白 → none（未设置或显式清空都走默认通道）', () => {
    expect(parseCalloutIconValue('')).toEqual({ kind: 'none' })
    expect(parseCalloutIconValue('   ')).toEqual({ kind: 'none' })
  })

  it('Lucide ID：lucide- 前缀可省、大小写不敏感、对称引号剥除', () => {
    expect(parseCalloutIconValue('lucide-flame')).toEqual({ kind: 'id', id: 'flame' })
    expect(parseCalloutIconValue('flame')).toEqual({ kind: 'id', id: 'flame' })
    expect(parseCalloutIconValue('LUCIDE-FLAME')).toEqual({ kind: 'id', id: 'flame' })
    expect(parseCalloutIconValue('Flame')).toEqual({ kind: 'id', id: 'flame' })
    expect(parseCalloutIconValue('"lucide-flame"')).toEqual({ kind: 'id', id: 'flame' })
    expect(parseCalloutIconValue("'flame'")).toEqual({ kind: 'id', id: 'flame' })
    // Obsidian 1.14.4 照录形态：help-circle 无前缀、quote-glyph 内部名
    expect(parseCalloutIconValue('help-circle')).toEqual({ kind: 'id', id: 'help-circle' })
    expect(parseCalloutIconValue('quote-glyph')).toEqual({ kind: 'id', id: 'quote-glyph' })
  })

  it('SVG 字符串：<svg 起头（允许前导空白）→ svg 形态保原文', () => {
    const markup = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='1' cy='2' r='3' /></svg>"
    expect(parseCalloutIconValue(markup)).toEqual({ kind: 'svg', markup })
    expect(parseCalloutIconValue(`  ${markup}  `)).toEqual({ kind: 'svg', markup })
    // 引号包裹的形态（片段常见写法）剥外层引号
    expect(parseCalloutIconValue(`"${markup}"`)).toEqual({ kind: 'svg', markup })
  })

  it('非法值 → invalid（含原因）：既非 ID 也非 SVG 的垃圾值', () => {
    expect(parseCalloutIconValue('!!!')).toMatchObject({ kind: 'invalid' })
    expect(parseCalloutIconValue('url(#x)')).toMatchObject({ kind: 'invalid' })
    expect(parseCalloutIconValue('lucide flame')).toMatchObject({ kind: 'invalid' })
    expect(parseCalloutIconValue('lucide-')).toMatchObject({ kind: 'invalid' })
    expect(parseCalloutIconValue('</svg>')).toMatchObject({ kind: 'invalid' })
  })
})

describe('calloutIconLibraryKeyOf：别名解析到锁版库键', () => {
  it('0.462.0 规范名直查命中；库键即规范名', () => {
    expect(calloutIconLibraryKeyOf('flame')).toBe('flame')
    expect(calloutIconLibraryKeyOf('circle-help')).toBe('circle-help')
    expect(calloutIconLibraryKeyOf('pencil')).toBe('pencil')
  })

  it('Obsidian 照录旧拼写经别名表映射到 0.462.0 规范名', () => {
    expect(calloutIconLibraryKeyOf('help-circle')).toBe('circle-help')
    expect(calloutIconLibraryKeyOf('alert-triangle')).toBe('triangle-alert')
    expect(calloutIconLibraryKeyOf('check-circle-2')).toBe('circle-check-big')
    expect(calloutIconLibraryKeyOf('quote-glyph')).toBe('quote')
    // 别名表与映射断言同源（不出现映射到自身的死条目）
    for (const [from, to] of Object.entries(CALLOUT_ICON_ALIASES)) {
      expect(from === to || calloutIconLibraryKeyOf(to)).toBe(to)
      expect(calloutIconLibraryKeyOf(from), from).toBe(to)
    }
  })

  it('未收录 ID（不在随包锁版集合）→ null', () => {
    expect(calloutIconLibraryKeyOf('rocket')).toBeNull()
    expect(calloutIconLibraryKeyOf('lucide-rocket')).toBeNull()
  })

  it('注册表 icon 字段全量可解析（每条目与别名归属的默认图标都在库内）', () => {
    for (const entry of CALLOUT_TYPES) {
      expect(calloutIconLibraryKeyOf(entry.icon), entry.id).not.toBeNull()
    }
    // 未知类型回落条目（note 外观）
    expect(calloutIconLibraryKeyOf(calloutTypeOf('custom-x').icon)).not.toBeNull()
    // important（tip 别名 + 独立变量）图标与 tip 同源 lucide-flame
    expect(calloutTypeOf('important').icon).toBe('lucide-flame')
  })
})

describe('CALLOUT_ICON_LIBRARY：锁版库条目形态', () => {
  it('版本声明锚定 lucide-static 0.462.0', () => {
    expect(CALLOUT_ICON_VERSION).toBe('lucide-static 0.462.0')
  })

  it('每条目为 viewBox 0 0 24 24 的描边 SVG，颜色通道 currentColor（非固定色）', () => {
    for (const [key, svg] of Object.entries(CALLOUT_ICON_LIBRARY)) {
      expect(svg, key).toMatch(/^<svg[^>]*viewBox='0 0 24 24'/)
      expect(svg, key).toContain("stroke='currentColor'")
      expect(svg, key).not.toContain('#000')
      expect(svg, key).not.toContain('<script')
    }
  })

  it('与 main.css mask 表几何同源（data URL 解码后仅 stroke 通道不同）', () => {
    const css = readMainCss()
    // 图标规则整块（选择器 + 声明体到闭合花括号，含 data URL 全文）
    const blocks = css.match(/:where\([^)]*\)\s*\{[^}]*\}/g) ?? []
    const maskRules = blocks.filter((b) => b.includes('--_vsidian-callout-icon:'))
    expect(maskRules.length).toBeGreaterThan(0)
    for (const entry of CALLOUT_TYPES) {
      const key = calloutIconLibraryKeyOf(entry.icon)!
      const rule = maskRules.find((r) => r.includes(`[data-callout='${entry.id}']`))
      expect(rule, entry.id).toBeDefined()
      const encoded = rule!.match(/--_vsidian-callout-icon:\s*url\("data:image\/svg\+xml,(.*?)"\)/)![1]!
      const decoded = encoded.replace(/%3C/g, '<').replace(/%3E/g, '>').replace(/%23/g, '#')
      // mask 通道 stroke='#000'（取 alpha），库通道 stroke='currentColor'——
      // 其余 markup 逐字符一致（含空格），钉住「同一锁版集合」
      expect(decoded.replace("stroke='#000'", "stroke='currentColor'"), key).toBe(CALLOUT_ICON_LIBRARY[key])
    }
  })
})
