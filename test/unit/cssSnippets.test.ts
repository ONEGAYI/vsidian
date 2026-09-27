// CSS 片段纯逻辑契约（#128）：目录片段判定、确定性排序、扫描合并（默认
// 关闭 / 文件消失不出清单）、存量清洗。语义依据 docs/specs/css-snippets.md
// 「已确认行为」与工单 #128 验收标准。
import { describe, it, expect } from 'vitest'
import {
  compareSnippetNames,
  enabledSnippetFiles,
  isSnippetFileName,
  mergeScanEntries,
  sanitizeStoredCssSnippets,
  type CssSnippetState,
} from '../../src/shared/cssSnippets'

describe('片段文件判定（isSnippetFileName）', () => {
  it('接受 .css 与大小写变体，拒绝其他扩展名与裸名', () => {
    expect(isSnippetFileName('theme.css')).toBe(true)
    expect(isSnippetFileName('THEME.CSS')).toBe(true)
    expect(isSnippetFileName('a.b.css')).toBe(true)
    expect(isSnippetFileName('.css')).toBe(true)
    expect(isSnippetFileName('theme.scss')).toBe(false)
    expect(isSnippetFileName('csstxt')).toBe(false)
    expect(isSnippetFileName('')).toBe(false)
  })
})

describe('确定性排序（compareSnippetNames）', () => {
  it('按 code unit 排序：与 locale 无关，大小写位次确定', () => {
    const names = ['b.css', 'A.css', 'a.css', 'B.css', '10.css', '2.css']
    expect([...names].sort(compareSnippetNames)).toEqual([
      '10.css', '2.css', 'A.css', 'B.css', 'a.css', 'b.css',
    ])
  })

  it('数字段不做数值比较（字符串序），保证跨平台一致', () => {
    expect(compareSnippetNames('10.css', '2.css')).toBe(-1)
    expect(compareSnippetNames('2.css', '10.css')).toBe(1)
  })
})

describe('扫描合并（mergeScanEntries）', () => {
  it('新文件默认关闭；显式开启的条目按文件名确定性排序输出', () => {
    expect(mergeScanEntries(['b.css', 'a.css'], { 'b.css': true })).toEqual([
      { name: 'a.css', enabled: false },
      { name: 'b.css', enabled: true },
    ])
  })

  it('开关映射中的多余键不产出条目（文件已删除不出清单），映射值非真值按关闭', () => {
    expect(mergeScanEntries(['a.css'], { 'a.css': true, 'gone.css': true })).toEqual([
      { name: 'a.css', enabled: true },
    ])
    expect(mergeScanEntries(['a.css'], {})).toEqual([{ name: 'a.css', enabled: false }])
  })

  it('重复文件名去重（同一文件只一条目）', () => {
    expect(mergeScanEntries(['a.css', 'a.css'], { 'a.css': true })).toEqual([
      { name: 'a.css', enabled: true },
    ])
  })
})

describe('存量清洗（sanitizeStoredCssSnippets）', () => {
  it('非对象 / 数组 / null 回默认：未配置目录、无开关', () => {
    const empty = { directory: null, enabled: {} }
    expect(sanitizeStoredCssSnippets(undefined)).toEqual(empty)
    expect(sanitizeStoredCssSnippets(null)).toEqual(empty)
    expect(sanitizeStoredCssSnippets([])).toEqual(empty)
    expect(sanitizeStoredCssSnippets('x')).toEqual(empty)
  })

  it('合法形态原样保留（目录 + 显式开关，含 false 值）', () => {
    const stored = { directory: 'D:\\样式\\片段', enabled: { 'a.css': true, 'b.css': false } }
    expect(sanitizeStoredCssSnippets(stored)).toEqual(stored)
  })

  it('非法字段逐项回默认：空串/非串目录归 null；非布尔值与空名键剔除', () => {
    expect(
      sanitizeStoredCssSnippets({ directory: '', enabled: { 'a.css': 'on', '': true, 'b.css': true } }),
    ).toEqual({ directory: null, enabled: { 'b.css': true } })
    expect(sanitizeStoredCssSnippets({ directory: 42, enabled: [] })).toEqual({
      directory: null,
      enabled: {},
    })
  })
})

describe('启用清单（enabledSnippetFiles）', () => {
  it('目录未配置时恒为空；已配置时按序输出启用文件', () => {
    const base: CssSnippetState = {
      directory: null, readError: false, entries: [{ name: 'a.css', enabled: true }], version: 3,
    }
    expect(enabledSnippetFiles(base)).toEqual([])
    expect(
      enabledSnippetFiles({ ...base, directory: 'D:/snips', entries: [
        { name: 'b.css', enabled: true }, { name: 'a.css', enabled: true }, { name: 'c.css', enabled: false },
      ] }),
    ).toEqual(['a.css', 'b.css'])
  })
})
