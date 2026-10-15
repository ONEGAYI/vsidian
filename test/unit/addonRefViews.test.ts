// T05（#544）附加组件只读引用请求——共享形状守卫与目标合成器的契约：
// 合法/非法锚点矩阵（标题/块/行号/行范围）、空 path 页内语义、双链形态
// 不可表达字符拒绝、合成原文与既有形态学（parseWikilinkInner /
// parseTextAnchorSpec）的往返一致性（不建第二套解析——合成目标必须能被
// 生产解析链还原为同一语义）。
import { describe, expect, it } from 'vitest'
import {
  ADDON_REF_BLOCK_ID_RE,
  buildAddonRefHoverTarget,
  isAddonRefAnchor,
  isAddonRefPopupRequest,
  isAddonRefTargetSpec,
} from '../../src/shared/addonRefViews'
import { parseWikilinkInner } from '../../src/shared/wikilink'
import { parseTextAnchorSpec } from '../../src/shared/refText'

describe('锚点形状守卫（合法/非法矩阵）', () => {
  it('标题：非空、不含 # ^ | 换行', () => {
    expect(isAddonRefAnchor({ kind: 'heading', heading: '第二章 概述' })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'heading', heading: '' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: '   ' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: 'a#b' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: 'a^b' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: 'a|b' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: 'a\nb' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'heading', heading: 42 })).toBe(false)
  })

  it('块 ID：字符集同双链形态学', () => {
    expect(isAddonRefAnchor({ kind: 'block', blockId: 'multi-blk' })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'block', blockId: 'abc123' })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'block', blockId: '' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'block', blockId: '有中文' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'block', blockId: 'under_score' })).toBe(false)
    expect(ADDON_REF_BLOCK_ID_RE.test('multi-blk')).toBe(true)
  })

  it('行号：1-based 正整数；行范围：正整数且 startLine <= endLine', () => {
    expect(isAddonRefAnchor({ kind: 'line', line: 1 })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'line', line: 103 })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'line', line: 0 })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'line', line: -3 })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'line', line: 1.5 })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'line', line: '20' })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'range', startLine: 5, endLine: 9 })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'range', startLine: 9, endLine: 9 })).toBe(true)
    expect(isAddonRefAnchor({ kind: 'range', startLine: 9, endLine: 5 })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'range', startLine: 0, endLine: 5 })).toBe(false)
    expect(isAddonRefAnchor({ kind: 'range', startLine: 1 })).toBe(false)
  })

  it('未知 kind 与非对象拒绝', () => {
    expect(isAddonRefAnchor(null)).toBe(false)
    expect(isAddonRefAnchor('heading')).toBe(false)
    expect(isAddonRefAnchor({ kind: 'footnote' })).toBe(false)
  })
})

describe('目标形状守卫', () => {
  it('空 path 仅在带锚点时合法（页内锚点语义）', () => {
    expect(isAddonRefTargetSpec({ path: 'notes/b.md' })).toBe(true)
    expect(isAddonRefTargetSpec({ path: '', anchor: { kind: 'heading', heading: '章' } })).toBe(true)
    expect(isAddonRefTargetSpec({ path: '' })).toBe(false)
  })

  it('路径含双链不可表达字符拒绝（# ^ | 换行）', () => {
    expect(isAddonRefTargetSpec({ path: 'a#b.md' })).toBe(false)
    expect(isAddonRefTargetSpec({ path: 'a^b.md' })).toBe(false)
    expect(isAddonRefTargetSpec({ path: 'a|b.md' })).toBe(false)
    expect(isAddonRefTargetSpec({ path: 'a\nb.md' })).toBe(false)
    expect(isAddonRefTargetSpec({ path: '子目录/笔记.md', anchor: { kind: 'block', blockId: 'blk-1' } })).toBe(true)
  })

  it('请求守卫：source 非空、target 合法、keyboard 可选', () => {
    const base = { source: 'main', target: { path: 'b.md' }, trigger: {} }
    expect(isAddonRefPopupRequest(base)).toBe(true)
    expect(isAddonRefPopupRequest({ ...base, keyboard: true })).toBe(true)
    expect(isAddonRefPopupRequest({ ...base, keyboard: 'yes' })).toBe(false)
    expect(isAddonRefPopupRequest({ ...base, source: '' })).toBe(false)
    expect(isAddonRefPopupRequest({ ...base, target: { path: '' } })).toBe(false)
    expect(isAddonRefPopupRequest({ ...base, trigger: undefined })).toBe(false)
  })
})

describe('目标合成器与既有形态学的往返一致性', () => {
  it('标题/块锚点合成原文可被 parseWikilinkInner 还原', () => {
    const heading = buildAddonRefHoverTarget({ path: 'notes/b', anchor: { kind: 'heading', heading: '第二章' } })
    expect(heading).toBe('notes/b#第二章')
    const parsed = parseWikilinkInner(heading!)
    expect(parsed).toMatchObject({ path: 'notes/b', heading: '第二章', blockId: null })

    const block = buildAddonRefHoverTarget({ path: 'b.md', anchor: { kind: 'block', blockId: 'multi-blk' } })
    expect(block).toBe('b.md#^multi-blk')
    expect(parseWikilinkInner(block!)).toMatchObject({ path: 'b.md', blockId: 'multi-blk', heading: null })

    const inner = buildAddonRefHoverTarget({ path: '', anchor: { kind: 'heading', heading: '页内' } })
    expect(inner).toBe('#页内')
    expect(parseWikilinkInner(inner!)).toMatchObject({ path: '', heading: '页内' })
  })

  it('行号/行范围合成锚点段可被 parseTextAnchorSpec 还原（text 通道语义）', () => {
    const line = buildAddonRefHoverTarget({ path: 'src/main.ts', anchor: { kind: 'line', line: 20 } })
    expect(line).toBe('src/main.ts#line=20')
    const parsedLine = parseWikilinkInner(line!)
    expect(parsedLine?.heading).toBe('line=20')
    expect(parseTextAnchorSpec(parsedLine!.heading!)).toEqual({ line: 20 })

    const range = buildAddonRefHoverTarget({ path: 'a.py', anchor: { kind: 'range', startLine: 10, endLine: 20 } })
    expect(range).toBe('a.py#range=10-20')
    const parsedRange = parseWikilinkInner(range!)
    expect(parseTextAnchorSpec(parsedRange!.heading!)).toEqual({ range: { begin: 10, end: 20 } })
  })

  it('无锚点即路径原文；非法目标返回 null（防御性，不静默降级）', () => {
    expect(buildAddonRefHoverTarget({ path: 'notes/b.md' })).toBe('notes/b.md')
    expect(buildAddonRefHoverTarget({ path: '', anchor: undefined } as never)).toBeNull()
    expect(buildAddonRefHoverTarget({ path: 'a#b' } as never)).toBeNull()
    expect(buildAddonRefHoverTarget({ path: 'b', anchor: { kind: 'range', startLine: 9, endLine: 5 } } as never)).toBeNull()
  })
})
