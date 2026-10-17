// @vitest-environment jsdom
// 块级 HTML 边界契约（#567/T02）：两端 HTML 块源码区间的对拍测试——
// Live 侧（Lezer markdownLanguage 的 HTMLBlock 节点）与 Reading 侧
// （markdown-it html_block token → splitReadingBlocks 的 html 块）对同一
// 文本必须产出同一区间集合（规格「两端核对过的解析规则，不用正则猜测
// 嵌套范围」）。边界矩阵覆盖：嵌套、空行终止、未闭合、代码上下文排除、
// 注释基线差异（Reading 是解析前字符串级剥离——隐性既定差异，按基线
// 钉住不随手统一）、类型 7 与段落打断、容器（引用/列表）内降级为源码。
import { describe, it, expect } from 'vitest'
import { Text } from '@codemirror/state'
import { docInput, markdownTreeParser } from '../../src/shared/markdownDoc'
import { isPureStyleHtmlBlock, topLevelHtmlBlockSpansOfTree } from '../../src/shared/htmlBlock'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { visitRange } from '../../src/shared/markdownDoc'
import type { SyntaxNode } from '@lezer/common'
import type { Tree } from '@lezer/common'

/** Lezer 侧：顶层 HTMLBlock 节点区间（直接调 shared 事实源） */
function lezerHtmlSpans(text: string): Array<{ from: number; to: number }> {
  const tree = markdownTreeParser.parse(docInput(Text.of(text.split('\n'))))
  return topLevelHtmlBlockSpansOfTree(tree).map((s) => ({ from: s.from, to: s.to }))
}

/** Reading 侧：splitReadingBlocks 产出的 html 块区间 */
function readingHtmlSpans(text: string): Array<{ from: number; to: number }> {
  return splitReadingBlocks(text)
    .filter((b) => b.kind === 'html')
    .map((b) => ({ from: b.start, to: b.end }))
}

const CASES: Array<{ name: string; text: string }> = [
  {
    name: '首条用户路径：colspan/rowspan 表格（前后空行界定）',
    text: '前文段落。\n\n<table>\n  <tr>\n    <td colspan="2" rowspan="3">合并</td>\n    <td>普通</td>\n  </tr>\n</table>\n\n后文段落。',
  },
  {
    name: '嵌套 div（多行，内部无空行）',
    text: '<div class="外">\n  <div class="内">文字</div>\n</div>\n\n段落',
  },
  {
    name: '未闭合 div 至文末（EOF 终止）',
    text: '段落。\n\n<div>\n  <p>未闭合内容\n',
  },
  {
    name: '空行终止：块内空行把后半切成普通段落',
    text: '<div>\n  前半\n\n后半仍按 html 呈现？',
  },
  {
    name: '类型 6 可打断段落（table 起始即成块）',
    text: '段落文字\n<table><tr><td>x</td></tr></table>\n',
  },
  {
    name: '类型 7 不能打断段落（同一段落延续）',
    text: '段落文字\n<span>行内式标签延续段落</span>\n',
  },
  {
    name: '类型 7 空行后独立成块',
    text: '段落文字\n\n<span>独立块</span>\n',
  },
  {
    name: '围栏代码内不产 html 块',
    text: '```\n<div>围栏内字面</div>\n```\n',
  },
  {
    name: '缩进代码内不产 html 块',
    text: '    <div>缩进代码字面</div>\n',
  },
  {
    name: '行内代码中的标签不产 html 块',
    text: '文字 `<div>` 行内代码。\n',
  },
  {
    name: '块内注释：Reading 剥离但区间一致（基线差异钉住）',
    text: '<div><!-- 块内注释 -->内容</div>\n\n段落',
  },
]

describe('两端 HTML 块区间对拍（Lezer HTMLBlock ↔ markdown-it html_block）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const lezer = lezerHtmlSpans(c.text)
      const reading = readingHtmlSpans(c.text)
      expect(lezer).toEqual(reading)
      // 区间切片必须是源文的 HTML 起始（防区间漂移到相邻 Markdown）
      for (const s of lezer) {
        expect(c.text.slice(s.from, s.from + 1)).toBe('<')
      }
    })
  }

  it('块内注释基线差异：Reading 块内容已剥离注释，Lezer 侧保留（不随手统一）', () => {
    const text = '<div><!-- 块内注释 -->内容</div>'
    const readingBlock = splitReadingBlocks(text).find((b) => b.kind === 'html')
    expect(readingBlock).toBeDefined()
    // Reading 渲染输入（block.html）不含注释文本（stripHtmlComments 先行）
    expect(readingBlock!.html).not.toContain('块内注释')
    expect(readingBlock!.html).toContain('内容')
    // Lezer 侧源文区间完整包含注释（Live 常显源码含注释）
    const lezer = lezerHtmlSpans(text)
    expect(text.slice(lezer[0]!.from, lezer[0]!.to)).toContain('<!-- 块内注释 -->')
  })
})

describe('isPureStyleHtmlBlock：纯 <style> 块判定（Q6A——Live 源码常显不占位）', () => {
  it('纯 style 块（带属性、多行规则）命中', () => {
    expect(isPureStyleHtmlBlock('<style>\n  .x { color: red; }\n</style>')).toBe(true)
    expect(isPureStyleHtmlBlock('  <style type="text/css">p{}</style>\n')).toBe(true)
  })

  it('与其他内容混排不命中', () => {
    expect(isPureStyleHtmlBlock('<div>d</div><style>s{}</style>')).toBe(false)
    expect(isPureStyleHtmlBlock('<style>a{}</style><div>d</div>')).toBe(false)
    expect(isPureStyleHtmlBlock('<style>a{}</style>\n<style>b{}</style>')).toBe(false)
    expect(isPureStyleHtmlBlock('<div>只有 div</div>')).toBe(false)
    expect(isPureStyleHtmlBlock('纯文本')).toBe(false)
  })

  it('未闭合 style 不命中（保守：按普通 html 块走渲染降级路径）', () => {
    expect(isPureStyleHtmlBlock('<style>a{}')).toBe(false)
  })
})

describe('顶层 HTML 块扫描的容器排除（引用/列表内降级为源码——两端一致边界）', () => {
  it('引用/列表内的 html 块不进入顶层扫描（Lezer 侧）', () => {
    const text = '> <div>引用内</div>\n\n- <div>列表内</div>\n'
    const tree = markdownTreeParser.parse(docInput(Text.of(text.split('\n'))))
    expect(topLevelHtmlBlockSpansOfTree(tree)).toHaveLength(0)
    // Reading 侧同样不产 html 块（html_block 只在顶层 token 循环被消费）
    expect(readingHtmlSpans(text)).toHaveLength(0)
  })

  it('扫描不吞非 HTMLBlock 的注释节点', () => {
    const text = '<!-- 独立注释块 -->\n'
    const tree: Tree = markdownTreeParser.parse(docInput(Text.of(text.split('\n'))))
    const names: string[] = []
    visitRange(tree, 0, text.length, (node: SyntaxNode) => {
      names.push(node.name)
    })
    expect(names).not.toContain('HTMLBlock')
    expect(topLevelHtmlBlockSpansOfTree(tree)).toHaveLength(0)
  })
})
