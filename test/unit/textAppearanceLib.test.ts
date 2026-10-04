// 文本外观纯逻辑契约（#335 探针建立、#340 转入生产后回归钉住）：TextMate
// scope 匹配 / JSONC 剥离 / 主题链合并 / 语义选择器。断言口径移植自 VSCode
// 1.82.3 官方实现，是颜色对照结论的可信前提——匹配器错了，对照矩阵会系统
// 性跑偏。
import { describe, expect, it } from 'vitest'
import {
  buildCustomTokenRules,
  loadThemeChain,
  matchSemanticSelector,
  normalizeColorHex,
  parseClassifierString,
  pickSemanticCustomRules,
  resolveTextMateColor,
  stripJsonc,
} from '../../src/host/textAppearance/themeResolution'
import { resolveTokenStyle } from '../../src/host/textAppearance/tmScopeMatcher'

describe('stripJsonc', () => {
  it('剥除行注释、块注释与尾逗号，保留字符串内容', () => {
    const input = `{
  // 行注释
  "a": "值//不是注释",
  /* 块
     注释 */
  "b": [1, 2, 3,],
  "c": "含\\"转义与 /* 假块注释",
}`
    const parsed = JSON.parse(stripJsonc(input)) as Record<string, unknown>
    expect(parsed.a).toBe('值//不是注释')
    expect(parsed.b).toEqual([1, 2, 3])
    expect(parsed.c).toBe('含"转义与 /* 假块注释')
  })
})

describe('normalizeColorHex', () => {
  it('支持 #RGB/#RGBA/#RRGGBB/#RRGGBBAA 归一化为小写', () => {
    expect(normalizeColorHex('#ABC')).toBe('#aabbcc')
    expect(normalizeColorHex('#ABCD')).toBe('#aabbccdd')
    expect(normalizeColorHex('#6A9955')).toBe('#6a9955')
    expect(normalizeColorHex('#FFFFFF80')).toBe('#ffffff80')
    expect(normalizeColorHex('not-a-color')).toBeUndefined()
  })
})

describe('TextMate scope 选择器匹配（官方语义）', () => {
  // 注意：该匹配器（resolveScopes/nameMatcher 路径）在官方仅以单 scope 栈
  // 输入使用（语义默认 probe scopes）；多 scope 栈下「单标识符选择器须整栈
  // 消化」是官方行为，不是缺陷。

  it('前缀点匹配：keyword 命中单栈 keyword.control.import', () => {
    const out = resolveTokenStyle([['keyword.control.import.ts']], [
      { source: 'theme', rules: [{ scope: 'keyword', settings: { foreground: '#569cd6' } }] },
    ])
    expect(out?.foreground).toBe('#569cd6')
  })

  it('后代匹配：source.ts keyword 命中 [source.ts, keyword.control]，python 栈不命中', () => {
    const rules = [{ source: 'theme' as const, rules: [{ scope: 'source.ts keyword', settings: { foreground: '#111111' } }] }]
    expect(resolveTokenStyle([['source.ts', 'keyword.control']], rules)?.foreground).toBe('#111111')
    expect(resolveTokenStyle([['source.python', 'keyword.control']], rules)).toBeUndefined()
  })

  it('更具体的选择器得分更高：keyword.control 胜过 keyword', () => {
    const out = resolveTokenStyle([['keyword.control']], [
      {
        source: 'theme',
        rules: [
          { scope: 'keyword', settings: { foreground: '#generic' } },
          { scope: 'keyword.control', settings: { foreground: '#specific' } },
        ],
      },
    ])
    expect(out?.foreground).toBe('#specific')
  })

  it('单标识符选择器对多 scope 栈整栈消化（官方行为：不匹配）', () => {
    const out = resolveTokenStyle([['source.ts', 'keyword.control.import.ts']], [
      { source: 'theme', rules: [{ scope: 'keyword', settings: { foreground: '#569cd6' } }] },
    ])
    expect(out).toBeUndefined()
  })

  it('同分后规则覆盖：custom 规则在 theme 之后接管（用户自定义语义）', () => {
    const out = resolveTokenStyle([['comment']], [
      { source: 'theme', rules: [{ scope: 'comment', settings: { foreground: '#6a9955' } }] },
      { source: 'custom', rules: [{ scope: 'comment', settings: { foreground: '#ff7700' } }] },
    ])
    expect(out?.foreground).toBe('#ff7700')
    expect(out?.source).toBe('custom')
  })

  it('scope 数组形式与逗号列表等价命中', () => {
    const out = resolveTokenStyle([['string.quoted.single.python']], [
      {
        source: 'theme',
        rules: [
          { scope: ['string.quoted.double', 'string.quoted.single'], settings: { foreground: '#ce9178' } },
          { scope: 'string.quoted.single, string.quoted.double', settings: { foreground: '#duplicate' } },
        ],
      },
    ])
    expect(out?.foreground).toBe('#duplicate')
  })
})

describe('用户 tokenColorCustomizations 组装', () => {
  it('分组在前、textMateRules 在后，具体规则同分覆盖分组', () => {
    const rules = buildCustomTokenRules({
      comments: '#aaaaaa',
      textMateRules: [{ scope: 'comment.block.documentation', settings: { foreground: '#bbbbbb' } }],
    })
    expect(rules.map((r) => r.scope)).toEqual(['comment', 'comment.block.documentation'])
    const docBlock = resolveTokenStyle([['comment.block.documentation']], [{ source: 'custom', rules }])
    expect(docBlock?.foreground).toBe('#bbbbbb')
    const lineComment = resolveTokenStyle([['comment.line']], [{ source: 'custom', rules }])
    expect(lineComment?.foreground).toBe('#aaaaaa')
  })
})

describe('语义选择器', () => {
  it('解析 type.modifier:language 形态', () => {
    expect(parseClassifierString('variable.readonly:typescript')).toEqual({
      type: 'variable',
      modifiers: ['readonly'],
      language: 'typescript',
    })
    expect(parseClassifierString('*.deprecated')).toEqual({ type: '*', modifiers: ['deprecated'], language: undefined })
  })

  it('通配、语言限定与修饰符计分', () => {
    const anyDeprecated = parseClassifierString('*.deprecated')
    expect(matchSemanticSelector(anyDeprecated, 'variable', ['deprecated'], 'python')).toBe(100)
    expect(matchSemanticSelector(anyDeprecated, 'variable', [], 'python')).toBe(-1)
    const tsOnly = parseClassifierString('variable:typescript')
    // 具体类型命中 +100、语言限定 +10（官方 TokenSelector.match 计分）
    expect(matchSemanticSelector(tsOnly, 'variable', [], 'typescript')).toBe(110)
    expect(matchSemanticSelector(tsOnly, 'variable', [], 'python')).toBe(-1)
  })

  it('member 经 superType 图被 method 选择器命中', () => {
    const methodSelector = parseClassifierString('method')
    expect(matchSemanticSelector(methodSelector, 'member', [], 'ts')).toBe(99)
    expect(matchSemanticSelector(methodSelector, 'variable', [], 'ts')).toBe(-1)
  })

  it('semanticTokenColorCustomizations 全局 + 主题分组都生效', () => {
    const rules = pickSemanticCustomRules(
      { rules: { variable: '#111111' }, '[Dark Modern]': { rules: { parameter: '#222222' } } },
      'Dark Modern',
    )
    expect(rules.map((r) => r.selector).sort()).toEqual(['parameter', 'variable'])
  })
})

describe('主题 include 链合并', () => {
  it('include 先行、own tokenColors 追加（own 覆盖）、colors 覆盖、semanticHighlighting OR', async () => {
    const files: Record<string, string> = {
      '/base/theme.json': JSON.stringify({
        colors: { 'editor.foreground': '#bbbbbb' },
        tokenColors: [{ scope: 'comment', settings: { foreground: '#6a9955' } }],
        semanticHighlighting: true,
      }),
      '/base/own.json': JSON.stringify({
        include: './theme.json',
        colors: { 'editor.background': '#1f1f1f' },
        tokenColors: [{ scope: 'comment', settings: { foreground: '#7ca977' } }],
        semanticTokenColors: { variable: '#9cdcfe' },
      }),
    }
    const theme = await loadThemeChain('/base/own.json', async (p) => files[p])
    expect(theme.chain).toEqual(['/base/theme.json', '/base/own.json'])
    expect(theme.colors['editor.foreground']).toBe('#bbbbbb')
    expect(theme.colors['editor.background']).toBe('#1f1f1f')
    expect(theme.semanticHighlighting).toBe(true)
    expect(theme.semanticRules).toEqual([{ selector: 'variable', foreground: '#9cdcfe' }])
    // own 规则在后 ⇒ comment 命中 own 的覆盖色（官方 >= 同分覆盖语义）
    const out = resolveTextMateColor({ theme, customTokenRules: [], themeSemanticRules: [], customSemanticRules: [] }, ['comment'])
    expect(out.color).toBe('#7ca977')
    expect(out.layer).toBe('textmate')
  })

  it('规则未命中回退 editor.foreground', async () => {
    const theme = await loadThemeChain('/t.json', async () =>
      JSON.stringify({ colors: { 'editor.foreground': '#cccccc' }, tokenColors: [] }),
    )
    const out = resolveTextMateColor({ theme, customTokenRules: [], themeSemanticRules: [], customSemanticRules: [] }, ['something.odd'])
    expect(out.layer).toBe('fallback-foreground')
    expect(out.color).toBe('#cccccc')
  })

  it('Windows 盘符路径的 include 解析不产生根相对错位（首跑实证回归）', async () => {
    const files: Record<string, string> = {
      'd:/ext/themes/own.json': JSON.stringify({ include: './base.json', tokenColors: [] }),
      'd:/ext/themes/base.json': JSON.stringify({ tokenColors: [{ scope: 'comment', settings: { foreground: '#6a9955' } }] }),
    }
    const theme = await loadThemeChain('d:/ext/themes/own.json', async (p) => files[p])
    expect(theme.chain).toEqual(['d:/ext/themes/base.json', 'd:/ext/themes/own.json'])
    expect(theme.tokenColors).toHaveLength(1)
  })
})
