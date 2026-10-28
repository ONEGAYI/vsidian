// Callout 两端对拍（#654/T03，T01 syntax-parity.json 同例扩展）：同一夹具
// 分别驱动 Live 树侧（@codemirror/lang-markdown，生产 markdownTreeParser）
// 与阅读侧（markdown-it 15.0.2，与生产同版同安全配置；块级容器边界由
// 核心产生——生产 callout token 变换不参与，T01 §4 口径），各提取「引用
// 容器清单（深度/行区间/声明）」喂同一识别器后按 (fromLine, depth) 规范序
// 对拍。T01 35 夹具零分歧（F01–F35）；T03 扩展 F36–F44 覆盖全类型、别名、
// 多层嵌套、列表容器与富标题组合。
import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import MarkdownIt from 'markdown-it'
import { markdownTreeParser, docInput } from '../../src/shared/markdownDoc'
import { calloutOfBlockquote } from '../../src/webview/liveDecorations'
import type { CalloutDecl } from '../../src/shared/calloutSyntax'

/** 容器清单条目（T01 对拍形态：depth/fromLine/toLine/decl 串） */
interface Container {
  depth: number
  fromLine: number
  toLine: number
  decl: string
}

function declString(decl: CalloutDecl | null): string {
  if (!decl) return 'none'
  return `${decl.type}|${decl.fold ?? ''}|${decl.title ?? ''}`
}

/** Live 侧：递归枚举 Blockquote（深度 = 引用嵌套层数），声明提取复用
 *  生产 calloutOfBlockquote（识别骑增量树的同一入口） */
function liveContainers(doc: string): Container[] {
  const text = Text.of(doc.split('\n'))
  const tree = markdownTreeParser.parse(docInput(text))
  const out: Container[] = []
  const walk = (node: SyntaxNode, quoteDepth: number): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'Blockquote') {
        const info = calloutOfBlockquote(text, child)
        let endPos = Math.min(child.to, text.length)
        if (endPos > child.from && text.sliceString(endPos - 1, endPos) === '\n') {
          endPos -= 1
        }
        out.push({
          depth: quoteDepth + 1,
          fromLine: text.lineAt(child.from).number,
          toLine: text.lineAt(endPos).number,
          decl: info ? declString(info.decl) : 'none',
        })
        walk(child, quoteDepth + 1)
      } else {
        walk(child, quoteDepth)
      }
    }
  }
  walk(tree.topNode, 0)
  return out.sort((a, b) => a.fromLine - b.fromLine || a.depth - b.depth)
}

/** 阅读侧：markdown-it token 流扫 blockquote_open，直属首段首行喂识别器
 *  （与生产 installCalloutTransform 同一提取口径——首 inline content 首行） */
function mditContainers(doc: string): Container[] {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false })
  const tokens = md.parse(doc, {})
  const out: Container[] = []
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.type === 'blockquote_open') {
      depth += 1
      // 直属首段：紧随的 paragraph（嵌套引用紧跟时非直属——首段归属内层）
      let decl = 'none'
      if (tokens[i + 1]?.type === 'paragraph_open' && tokens[i + 2]?.type === 'inline') {
        const content = tokens[i + 2]!.content
        const nl = content.indexOf('\n')
        const line = nl < 0 ? content : content.slice(0, nl)
        const m = /^\[!([^\]]*)\]([+-])?/.exec(line)
        if (m && m[1] !== '' && /^[A-Za-z0-9_-]+$/.test(m[1]!)) {
          const after = line.slice(m[0].length)
          if (after === '' || /^\s/.test(after)) {
            const title = after.trim() === '' ? undefined : after.trim()
            decl = `${m[1]!.toLowerCase()}|${m[2] ?? ''}|${title ?? ''}`
          }
        }
      }
      // 配对 close（nesting 归零处）确认容器闭合在场，行区间取 open 的 map
      let d = 0
      let closeIdx = i
      for (; closeIdx < tokens.length; closeIdx++) {
        d += tokens[closeIdx]!.nesting
        if (d === 0) break
      }
      if (closeIdx >= tokens.length) continue
      const map = t.map ?? [0, 0]
      out.push({
        depth,
        fromLine: map[0]! + 1,
        toLine: map[1]!,
        decl,
      })
    } else if (t.type === 'blockquote_close') {
      depth -= 1
    }
  }
  return out
}

/** T03 对拍夹具（F36–F44；F01–F35 见 T01 syntax-parity.json 入库件） */
const FIXTURES: Array<{ id: string; desc: string; lines: string[]; anchors?: Record<string, string> }> = [
  {
    id: 'F36-canonical-types',
    desc: '13 规范类型各一独立容器（空行分隔；含 fold 形态）',
    lines: [
      '> [!note] 笔记',
      '',
      '> [!abstract] 摘要',
      '',
      '> [!info]+ 信息可折叠',
      '',
      '> [!todo]- 待办收起',
      '',
      '> [!tip] 提示',
      '',
      '> [!success] 成功',
      '',
      '> [!question] 提问',
      '',
      '> [!warning] 警告',
      '',
      '> [!failure] 失败',
      '',
      '> [!danger] 危险',
      '',
      '> [!bug] 缺陷',
      '',
      '> [!example] 示例',
      '',
      '> [!quote] 引用',
      '',
    ],
    anchors: { count: '13', first: 'note||笔记', todo: 'todo|-|待办收起' },
  },
  {
    id: 'F37-aliases',
    desc: '14 别名照常成型，原标识小写保留（不归并改写）',
    lines: [
      '> [!summary] 摘要一',
      '',
      '> [!tldr] 太长不读',
      '',
      '> [!hint] 提示别名',
      '',
      '> [!important] 重要',
      '',
      '> [!check] 检查',
      '',
      '> [!done] 完成',
      '',
      '> [!help] 求助',
      '',
      '> [!faq] 常见问题',
      '',
      '> [!caution] 谨慎',
      '',
      '> [!attention] 注意',
      '',
      '> [!fail] 失败别名',
      '',
      '> [!missing] 缺失',
      '',
      '> [!error] 错误别名',
      '',
      '> [!cite] 引证',
      '',
    ],
    anchors: { count: '14', important: 'important||重要', faq: 'faq||常见问题' },
  },
  {
    id: 'F38-three-level',
    desc: '三层嵌套 callout（note > tip > warning），各层标题与正文',
    lines: [
      '> [!note] 外层',
      '> > [!tip] 中层',
      '> > > [!warning] 内层',
      '> > > 内层正文',
      '> > 中层正文',
      '> 外层正文',
      '',
    ],
    anchors: { depths: '1,2,3' },
  },
  {
    id: 'F39-quote-wrap-callout',
    desc: '普通引用包 callout 后外层再续行（F20 扩展：内层后外层续行归属）',
    lines: [
      '> 外层普通引用首段',
      '> > [!bug] 内层 callout',
      '> > 内层正文',
      '> 外层 lazy 续行',
      '',
    ],
  },
  {
    id: 'F40-callout-in-list',
    desc: '列表容器内多行 callout + 前后条目（F22 扩展）',
    lines: [
      '- 前置条目',
      '- > [!info] 列表内 callout',
      '  > 列表内正文一',
      '  > 列表内正文二',
      '- 后置条目',
      '',
    ],
    anchors: { decl: 'info||列表内 callout' },
  },
  {
    id: 'F41-table-task-in-callout',
    desc: 'callout 内表格与任务列表混合（F31 扩展任务形态）',
    lines: [
      '> [!success] 混合正文',
      '> | a | b |',
      '> | - | - |',
      '> | 1 | 2 |',
      '>',
      '> - [ ] 未完成任务',
      '> - [x] 已完成任务',
      '',
    ],
    anchors: { decl: 'success||混合正文' },
  },
  {
    id: 'F42-rich-title',
    desc: '富标题源文原样提取（粗体/行内代码/链接；F26/F27 扩展）',
    lines: [
      '> [!tip] **加粗** 与 `code` 标题',
      '',
      '> [!example] [链接文字](https://example.com) 标题',
      '',
      '> [!quote] ~~删除~~ 与 ==高亮== 标题',
      '',
    ],
    anchors: { bold: 'tip||**加粗** 与 `code` 标题', link: 'example||[链接文字](https://example.com) 标题' },
  },
  {
    id: 'F43-alias-case',
    desc: '别名与类型大小写不敏感（IMPORTANT/NoTe 混排）',
    lines: [
      '> [!IMPORTANT] 大写别名',
      '',
      '> [!NoTe] 混合大小写',
      '',
      '> [!CiTe] 引证大写',
      '',
    ],
    anchors: { first: 'important||大写别名' },
  },
  {
    id: 'F44-nested-lazy',
    desc: '嵌套层 lazy 续行归属（内层吞外层续行的 F17/F18 组合扩展）',
    lines: [
      '> [!abstract] 外层',
      '> > [!tldr] 内层',
      'lazy 无前缀行',
      '> 外层段落二',
      '',
    ],
  },
]

describe('Callout 两端对拍（T03 扩展夹具，识别器同源）', () => {
  for (const fx of FIXTURES) {
    it(`${fx.id}：${fx.desc}`, () => {
      const doc = fx.lines.join('\n')
      const live = liveContainers(doc)
      const mdit = mditContainers(doc)
      expect(mdit, '两端容器清单应逐项一致').toEqual(live)
      // 锚点断言（对拍之外钉住关键语义）
      const a = fx.anchors ?? {}
      if (a.count !== undefined) {
        expect(live.filter((c) => c.decl !== 'none'), a.count).toHaveLength(Number(a.count))
      }
      if (a.first !== undefined) expect(live[0]!.decl, a.first).toBe(a.first)
      if (a.todo !== undefined) expect(live.some((c) => c.decl === a.todo), a.todo).toBe(true)
      if (a.important !== undefined) expect(live.some((c) => c.decl === a.important)).toBe(true)
      if (a.faq !== undefined) expect(live.some((c) => c.decl === a.faq)).toBe(true)
      if (a.decl !== undefined) expect(live.some((c) => c.decl === a.decl)).toBe(true)
      if (a.bold !== undefined) expect(live[0]!.decl).toBe(a.bold)
      if (a.link !== undefined) expect(live.some((c) => c.decl === a.link)).toBe(true)
      if (a.depths !== undefined) {
        expect(live.map((c) => c.depth).join(','), a.depths).toBe(a.depths)
      }
    })
  }

  it('F38 三层嵌套：每层声明与行区间锚定（lazy 链式吞尾——两端一致）', () => {
    const doc = FIXTURES.find((f) => f.id === 'F38-three-level')!.lines.join('\n')
    const live = liveContainers(doc)
    expect(live).toEqual([
      { depth: 1, fromLine: 1, toLine: 6, decl: 'note||外层' },
      // 行 6 `> 外层正文` 与行 5 是中/内层的 lazy 续行（T01 F17 同型：lazy
      // 归属内层容器，行区间吞到容器尾）
      { depth: 2, fromLine: 2, toLine: 6, decl: 'tip||中层' },
      { depth: 3, fromLine: 3, toLine: 6, decl: 'warning||内层' },
    ])
  })

  it('T01 既有夹具抽样回归（F17 嵌套 / F20 引用内 callout / F22 列表内 callout）', () => {
    const samples: Array<{ lines: string[]; expect: Container[] }> = [
      {
        lines: ['> [!note] 外层', '> > [!tip] 内层', '> > 内层正文', '> 外层正文'],
        expect: [
          { depth: 1, fromLine: 1, toLine: 4, decl: 'note||外层' },
          { depth: 2, fromLine: 2, toLine: 4, decl: 'tip||内层' },
        ],
      },
      {
        lines: ['> 外层普通引用', '> > [!bug] 内层 callout', '> > 内层正文'],
        expect: [
          { depth: 1, fromLine: 1, toLine: 3, decl: 'none' },
          { depth: 2, fromLine: 2, toLine: 3, decl: 'bug||内层 callout' },
        ],
      },
      {
        lines: ['- 前置条目', '- > [!info] 列表内 callout', '  > 列表内正文', '- 后置条目'],
        expect: [{ depth: 1, fromLine: 2, toLine: 3, decl: 'info||列表内 callout' }],
      },
    ]
    for (const s of samples) {
      const doc = s.lines.join('\n')
      expect(liveContainers(doc)).toEqual(s.expect)
      expect(mditContainers(doc)).toEqual(s.expect)
    }
  })
})
