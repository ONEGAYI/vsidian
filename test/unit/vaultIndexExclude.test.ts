// #198 索引排除语义纯逻辑契约测试：glob 匹配（默认模式、通配符边界、
// 目录前缀）、模式清洗（去空/去重/上限）、大小写折叠可选。单一事实源
// src/shared/vaultIndexExclude.ts（服务过滤与 vscode 壳共用，不重复实现）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXCLUDE_PATTERNS,
  compileExcludeMatcher,
  globToRegExpSource,
  sanitizeExcludePatterns,
  EXCLUDE_PATTERN_MAX_COUNT,
} from '../../src/shared/vaultIndexExclude'

describe('排除 glob：默认模式语义', () => {
  it('默认模式为 **/.git/** 与 **/node_modules/**（#194 实施初值）', () => {
    expect(DEFAULT_EXCLUDE_PATTERNS).toEqual(['**/.git/**', '**/node_modules/**'])
  })

  it('**/.git/** 匹配任意深度的 .git 目录下文件（含根直属）', () => {
    const m = compileExcludeMatcher(['**/.git/**'])
    expect(m.test('.git/config.md')).toBe(true)
    expect(m.test('notes/.git/HEAD.md')).toBe(true)
    expect(m.test('a/b/.git/hooks/x.md')).toBe(true)
    expect(m.test('agit/readme.md')).toBe(false) // 目录名必须整段为 .git
  })

  it('**/node_modules/** 匹配嵌套 node_modules，不误伤同前缀目录', () => {
    const m = compileExcludeMatcher(['**/node_modules/**'])
    expect(m.test('node_modules/lib/readme.md')).toBe(true)
    expect(m.test('web/node_modules/pkg/a.md')).toBe(true)
    expect(m.test('mynode_modules/pkg/a.md')).toBe(false)
  })
})

describe('排除 glob：通配符边界', () => {
  it('* 不跨目录分隔符', () => {
    const m = compileExcludeMatcher(['*.tmp.md'])
    expect(m.test('a.tmp.md')).toBe(true)
    expect(m.test('sub/a.tmp.md')).toBe(false)
    const deep = compileExcludeMatcher(['**/*.tmp.md'])
    expect(deep.test('sub/a.tmp.md')).toBe(true)
    expect(deep.test('a.tmp.md')).toBe(true)
  })

  it('? 匹配单个非分隔符字符', () => {
    const m = compileExcludeMatcher(['draft?.md'])
    expect(m.test('draft1.md')).toBe(true)
    expect(m.test('draft12.md')).toBe(false)
    expect(m.test('sub/draft1.md')).toBe(false)
  })

  it('中段 ** 跨目录（a/**/b.md 命中 a/b.md 与 a/x/y/b.md）', () => {
    const m = compileExcludeMatcher(['a/**/b.md'])
    expect(m.test('a/b.md')).toBe(true)
    expect(m.test('a/x/y/b.md')).toBe(true)
    expect(m.test('b.md')).toBe(false)
  })

  it('无通配符模式按目录前缀语义：排除该目录整个子树', () => {
    const m = compileExcludeMatcher(['drafts'])
    expect(m.test('drafts/a.md')).toBe(true)
    expect(m.test('drafts/sub/b.md')).toBe(true)
    expect(m.test('drafts-x/a.md')).toBe(false)
    expect(m.test('a/drafts.md')).toBe(false)
  })

  it('路径分隔符归一（反斜杠输入与 / 形态同判）', () => {
    const m = compileExcludeMatcher(['**/.git/**'])
    expect(m.test('notes\\.git\\x.md')).toBe(true)
  })

  it('大小写折叠可选（Windows 宿主 true）', () => {
    const fold = compileExcludeMatcher(['**/.Git/**'], { foldCase: true })
    expect(fold.test('notes/.GIT/x.md')).toBe(true)
    const exact = compileExcludeMatcher(['**/.Git/**'])
    expect(exact.test('notes/.GIT/x.md')).toBe(false)
    expect(exact.test('notes/.Git/x.md')).toBe(true)
  })

  it('正则特殊字符按字面量处理（点号不吞任意字符）', () => {
    const m = compileExcludeMatcher(['a.b.md'])
    expect(m.test('a.b.md')).toBe(true)
    expect(m.test('axb.md')).toBe(false)
    // 字面点号必须被转义为 \.（源串检查）
    expect(globToRegExpSource('a.b.md')).toContain('\\.')
    expect(globToRegExpSource('a.b.md')).not.toMatch(/[^\\]\./)
  })
})

describe('排除模式清洗（sanitizeExcludePatterns）', () => {
  it('去首尾空白、丢弃空项、保序去重', () => {
    const r = sanitizeExcludePatterns([' drafts/** ', '', 'drafts/**', 'x.md'])
    expect(r.patterns).toEqual(['drafts/**', 'x.md'])
    expect(r.invalid).toEqual([])
  })

  it('超长模式判非法（不入清单、进 invalid 供设置页回显）', () => {
    const r = sanitizeExcludePatterns(['a'.repeat(300)])
    expect(r.patterns).toEqual([])
    expect(r.invalid).toHaveLength(1)
  })

  it('超过数量上限的多余模式判非法（前 64 个有效）', () => {
    const many = Array.from({ length: EXCLUDE_PATTERN_MAX_COUNT + 3 }, (_, i) => `d${i}/**`)
    const r = sanitizeExcludePatterns(many)
    expect(r.patterns).toHaveLength(EXCLUDE_PATTERN_MAX_COUNT)
    expect(r.invalid).toHaveLength(3)
  })

  it('非数组输入返回空清单（调用方据此回落默认值）', () => {
    expect(sanitizeExcludePatterns(undefined)).toEqual({ patterns: [], invalid: [] })
    expect(sanitizeExcludePatterns('x.md')).toEqual({ patterns: [], invalid: [] })
    expect(sanitizeExcludePatterns([42])).toEqual({ patterns: [], invalid: [] })
  })

  it('空数组是合法输入（语义为「不排除任何路径」）', () => {
    expect(sanitizeExcludePatterns([])).toEqual({ patterns: [], invalid: [] })
  })
})
