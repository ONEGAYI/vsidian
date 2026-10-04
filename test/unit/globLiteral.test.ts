// B-1（review-loops 波次一）：text 目标 per-file watcher 的文件名字面量
// 转义契约。VSCode FileSystemWatcher 的 pattern 经 vs/base/common/glob
// 引擎解析（1.82.3 源码核对）：`[`、`]`、`*`、`?`、`{`、`}` 是 glob
// 元字符（字符类 / 通配 / brace 展开），裸出现在文件名中会错配同目录
// 其他文件或前缀匹配；字符类内（`[` 与 `]` 之间）元字符按字面量解析
// （`]` 作为字符类首字符亦为字面量）。转义 = 字符类包裹。
//
// 本文件钉住转义的不变量与快照；真实 glob 引擎下的端到端行为由真宿主
// 集成用例覆盖（普通文件名主链路），元字符文件名是已知边界（见规格
// 落档注释）。
import { describe, expect, it } from 'vitest'
import { escapeGlobFilenameLiteral } from '../../src/shared/globLiteral'

describe('B-1：FileSystemWatcher 文件名字面量转义', () => {
  it('常规文件名原样返回（无元字符零干预）', () => {
    expect(escapeGlobFilenameLiteral('笔记.txt')).toBe('笔记.txt')
    expect(escapeGlobFilenameLiteral('配置.json')).toBe('配置.json')
    expect(escapeGlobFilenameLiteral('a-b_c.d.ts')).toBe('a-b_c.d.ts')
  })

  it('元字符逐个字符类包裹（快照矩阵）', () => {
    expect(escapeGlobFilenameLiteral('a[b].txt')).toBe('a[[]b[]].txt')
    expect(escapeGlobFilenameLiteral('v1.2?draft.txt')).toBe('v1.2[?]draft.txt')
    expect(escapeGlobFilenameLiteral('copy*note.txt')).toBe('copy[*]note.txt')
    expect(escapeGlobFilenameLiteral('a{b}.txt')).toBe('a[{]b[}].txt')
  })

  it('转义产物为「非元字符序列 ∪ 单字符类 [X]（X 恒为元字符）」交替——结构不变量', () => {
    // VSCode glob 1.82.3 的字符类语义：类内元字符按字面量解析、`]` 作
    // 为类首字符亦为字面量（源码 162 行注释与分支核对）。产物若结构
    // 合此不变量，则每个元字符都处于「只能匹配其字面值」的位置
    const structural = /^(?:[^[\]*?{}]+|\[(?:[[\]*?{}])\])*$/
    for (const name of ['[x].txt', '].json', '{a}.txt', '*?.log', '[[].txt', 'a]]b.txt', '配置[备份].txt']) {
      const escaped = escapeGlobFilenameLiteral(name)
      expect(structural.test(escaped), `${name} → ${escaped}`).toBe(true)
      // 长度守恒：每个元字符膨胀为 3 字符（[、X、]）
      const metaCount = [...name].filter((ch) => '[]*?{}'.includes(ch)).length
      expect(escaped.length, `${name} → ${escaped}`).toBe(name.length + 2 * metaCount)
    }
  })

  it('空串与全元字符文件名不抛异常', () => {
    expect(escapeGlobFilenameLiteral('')).toBe('')
    expect(escapeGlobFilenameLiteral('[]{}*?')).toBe('[[][]][{][}][*][?]')
  })
})
