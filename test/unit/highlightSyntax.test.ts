// 高亮语法识别契约（#105）：lezer markdown 解析器不产 `==` 节点，
// markdownTreeParser 经 Highlight 扩展（照 GFM Strikethrough 的 delimiter
// 机制）产出 Highlight/HighlightMark 节点——live 装饰、大纲透传与格式
// 操作（两态切换按节点命中）共用同一语义来源。
// - 配对形态学：成对 `==` 按两侧紧贴空白判定 open/close（flanking 与
//   Strikethrough 同款简化），残缺/空格紧贴形态按普通文本降级
// - 隔离边界：行内代码/围栏代码内容为字面文本，不产高亮节点；
//   `=` 的块级语义（Setext 下划线）不受 inline 扩展影响
// - 既有 GFM 语法（Strikethrough 等）在扩展合并后保持原判（回归钉）
import { describe, it, expect } from 'vitest'
import { Text } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { docInput, markdownTreeParser } from '../../src/shared/markdownDoc'

const parse = (s: string): Tree => markdownTreeParser.parse(docInput(Text.of(s.split('\n'))))

function nodesNamed(tree: Tree, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  const walk = (node: SyntaxNode): void => {
    if (node.name === name) {
      out.push(node)
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      walk(c)
    }
  }
  walk(tree.topNode)
  return out
}

describe('markdownTreeParser：Highlight 扩展（#105 识别层）', () => {
  it('成对 == 产 Highlight 节点：首末 HighlightMark 夹内容区间', () => {
    const text = '正文 ==高亮== 文本'
    const hits = nodesNamed(parse(text), 'Highlight')
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect([hit.from, hit.to]).toEqual([3, 9]) // ==高亮==
    const marks = []
    for (let c = hit.firstChild; c; c = c.nextSibling) {
      if (c.name === 'HighlightMark') {
        marks.push([c.from, c.to])
      }
    }
    expect(marks).toEqual([[3, 5], [7, 9]])
    expect(text.slice(marks[0]![1], marks[1]![0])).toBe('高亮')
  })

  it('单个 == 与前后紧贴空白的 == 不配对（flanking 残缺按普通文本）', () => {
    expect(nodesNamed(parse('a == b'), 'Highlight')).toHaveLength(0)
    expect(nodesNamed(parse('a == b == c'), 'Highlight')).toHaveLength(0)
    expect(nodesNamed(parse('==未闭合'), 'Highlight')).toHaveLength(0)
  })

  it('无空格紧贴与单词形态均可配对（与 Strikethrough 同款 flanking）', () => {
    expect(nodesNamed(parse('a==b=='), 'Highlight')).toHaveLength(1)
    expect(nodesNamed(parse('==起== 中间 ==落=='), 'Highlight')).toHaveLength(2)
  })

  it('行内代码与围栏代码内容为字面文本：不产 Highlight 节点', () => {
    expect(nodesNamed(parse('`==x==`'), 'Highlight')).toHaveLength(0)
    expect(nodesNamed(parse('```\n==x==\n```'), 'Highlight')).toHaveLength(0)
  })

  it('段内跨行可配对（inline 上下文按段落）', () => {
    const hits = nodesNamed(parse('==首行\n次行=='), 'Highlight')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.from).toBe(0)
  })

  it('空内容 ==== 不产可用区间（无字面内容的高亮按源码降级）', () => {
    const hits = nodesNamed(parse('a ===='), 'Highlight')
    // 节点可以存在，但首末 mark 相邻（内容区间为空）——装饰层按空区间不发射
    for (const hit of hits) {
      const first = hit.firstChild
      const last = hit.lastChild
      if (first && last && first.name === 'HighlightMark' && last.name === 'HighlightMark') {
        expect(first.to).toBeGreaterThanOrEqual(last.from)
      }
    }
  })

  it('扩展合并不影响既有 GFM 判定（Strikethrough/表格/任务仍解析）', () => {
    const tree = parse('~~删除~~ 与 [ ] 任务行')
    expect(nodesNamed(tree, 'Strikethrough')).toHaveLength(1)
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    expect(nodesNamed(parse(table), 'Table')).toHaveLength(1)
  })
})

describe('嵌套行内围栏 flanking 宽松基准（#149 识别层）', () => {
  /** 树中首个 Highlight 节点 */
  function firstHighlight(tree: Tree): SyntaxNode | null {
    const walk = (node: SyntaxNode): SyntaxNode | null => {
      if (node.name === 'Highlight') {
        return node
      }
      for (let c = node.firstChild; c; c = c.nextSibling) {
        const hit = walk(c)
        if (hit) {
          return hit
        }
      }
      return null
    }
    return walk(tree.topNode)
  }

  it('票内样例：跨格==**建立**==选区后 → 外层 Highlight 配对、内层 StrongEmphasis 嵌套其内', () => {
    const text = '跨格==**建立**==选区后'
    const tree = parse(text)
    const hit = firstHighlight(tree)
    expect(hit).not.toBeNull()
    expect(text.slice(hit!.from, hit!.to)).toBe('==**建立**==')
    const strong = nodesNamed(tree, 'StrongEmphasis')[0]
    expect(strong).toBeTruthy()
    expect(text.slice(strong!.from, strong!.to)).toBe('**建立**')
    expect(strong!.from).toBeGreaterThanOrEqual(hit!.from)
    expect(strong!.to).toBeLessThanOrEqual(hit!.to)
  })

  it('组合矩阵：外层 == × 内层 {**,* ,__,~~,`} × 汉字紧贴均配对且内层节点落在高亮区间内', () => {
    const matrix: Array<{ inner: string; node: string }> = [
      { inner: '**词**', node: 'StrongEmphasis' },
      { inner: '*词*', node: 'Emphasis' },
      { inner: '__词__', node: 'StrongEmphasis' },
      { inner: '~~词~~', node: 'Strikethrough' },
      { inner: '`词`', node: 'InlineCode' },
    ]
    for (const { inner, node } of matrix) {
      const text = `看==${inner}==的`
      const tree = parse(text)
      const hit = firstHighlight(tree)
      expect(hit, inner).not.toBeNull()
      expect(text.slice(hit!.from, hit!.to), inner).toBe(`==${inner}==`)
      const nested = nodesNamed(tree, node)[0]
      expect(nested, inner).toBeTruthy()
      expect(nested!.from, inner).toBeGreaterThanOrEqual(hit!.from)
      expect(nested!.to, inner).toBeLessThanOrEqual(hit!.to)
    }
  })

  it('字母紧贴与空白外边界照常配对（宽松基准不收窄既有形态）', () => {
    for (const text of ['word==**bold**==end', '空 ==**词**== 界', '（==**词**==）']) {
      expect(firstHighlight(parse(text)), text).not.toBeNull()
    }
  })

  it('内侧空格紧贴仍拒绝：嵌套组合不放宽空白边界', () => {
    for (const text of ['a == **b** == c', 'x== **y** ==z']) {
      expect(nodesNamed(parse(text), 'Highlight'), text).toHaveLength(0)
    }
  })

  it('行内代码内的嵌套形态仍为字面文本：不产 Highlight 节点', () => {
    expect(nodesNamed(parse('`==**x**==`'), 'Highlight')).toHaveLength(0)
  })
})
