// Mermaid 围栏形态学契约测试（工单 #60）：shared/mermaid.ts 的 info 识别与
// CommonMark 围栏状态机行扫描。live 装饰与阅读渲染共用同一判定口径。
import { describe, expect, it } from 'vitest'
import {
  isRenderedFenceInfo,
  locateGraphicFenceCode,
  scanFenceSpans,
  scanFencesDetailed,
  type FenceSpan,
} from '../../src/shared/mermaid'

/** 便捷：行数组 + 首行 offset 0 扫描，返回紧凑断言形态 */
function scan(text: string): Array<{ from: number; to: number; rendered: boolean; code: string }> {
  return scanFenceSpans(text.split('\n'), 0).map((s) => ({
    from: s.from,
    to: s.to,
    rendered: s.rendered,
    code: s.code,
  }))
}

describe('isRenderedFenceInfo：info string 判定', () => {
  it('精确匹配 mermaid（前后空白容忍）', () => {
    expect(isRenderedFenceInfo('mermaid')).toBe(true)
    expect(isRenderedFenceInfo(' mermaid ')).toBe(true)
    expect(isRenderedFenceInfo('mermaid\t')).toBe(true)
  })

  it('大小写敏感；非 mermaid 语言与多余词不命中', () => {
    expect(isRenderedFenceInfo('Mermaid')).toBe(false)
    expect(isRenderedFenceInfo('MERMAID')).toBe(false)
    expect(isRenderedFenceInfo('mermaid flowchart')).toBe(false)
    expect(isRenderedFenceInfo('js')).toBe(false)
    expect(isRenderedFenceInfo('')).toBe(false)
  })
})

describe('scanFenceSpans：围栏状态机', () => {
  it('标准 mermaid 围栏：from/to 覆盖开闭围栏行，code 为内容', () => {
    const text = ['前言', '', '```mermaid', 'graph TD', 'A-->B', '```', '', '结尾'].join('\n')
    const spans = scan(text)
    expect(spans).toHaveLength(1)
    const s = spans[0]!
    expect(s.rendered).toBe(true)
    expect(s.from).toBe(text.indexOf('```mermaid'))
    expect(s.to).toBe(text.indexOf('```', 3 + '```mermaid'.length) + 3) // 闭围栏行行尾（不含换行，排他端）
    expect(s.code).toBe('graph TD\nA-->B')
  })

  it('波浪线围栏同样识别；info 前后空白容忍', () => {
    const spans = scan('~~~mermaid  \nflowchart LR\nA-->B\n~~~')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.rendered).toBe(true)
    expect(spans[0]!.code).toBe('flowchart LR\nA-->B')
  })

  it('非 mermaid 围栏产出 span（mermaid=false）供嵌套抑制消费', () => {
    const spans = scan('```js\nlet a = 1\n```')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.rendered).toBe(false)
  })

  it('普通围栏内的伪 mermaid 围栏不产出（嵌套抑制）', () => {
    // 外层 4 反引号围栏包含 ```mermaid 文本：内层不是围栏
    const text = ['````md', '```mermaid', 'graph TD', 'A-->B', '```', '````'].join('\n')
    const spans = scan(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.rendered).toBe(false)
    expect(spans[0]!.code).toBe('```mermaid\ngraph TD\nA-->B\n```')
  })

  it('缩进 4 空格的行不开启围栏（缩进代码块语义）', () => {
    const text = ['    ```mermaid', '    graph TD', '    A-->B', '    ```'].join('\n')
    expect(scan(text)).toHaveLength(0)
  })

  it('行首 Tab 按 CommonMark 折算到 4 倍制表位：Tab 起步的围栏是缩进代码块不开启（D-4）', () => {
    // 一个 Tab = 推进到下一个 4 列边界：行首 Tab 至少 4 列 → 缩进代码块
    expect(scan('\t```mermaid\n\tgraph TD\n\tA-->B\n\t```')).toHaveLength(0)
    // 空格 + Tab：1 列空格后 Tab 推进到 4 列边界（4 列）→ 同为缩进代码块
    expect(scan(' \t```mermaid\n graph TD\n ```')).toHaveLength(0)
    // 双 Tab = 8 列
    expect(scan('\t\t```mermaid\n\tA-->B\n\t```')).toHaveLength(0)
    // 对照：3 空格以内（无 Tab）仍开启围栏（既有口径，Tab 折算不改变）
    expect(scan('   ```mermaid\n   A-->B\n   ```')).toHaveLength(1)
  })

  it('Tab 起步的闭合行不是闭合围栏（内容行；Tab 折算同样作用于闭合判定）', () => {
    // 开启行无缩进、闭合行行首 Tab（≥4 列）→ 不闭合，围栏延伸到下一裸围栏行
    const spans = scan('```mermaid\nA-->B\n\t```\n```')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.code).toBe('A-->B\n\t```')
  })

  it('缩进 0-3 空格的围栏正常识别（列表内围栏容忍）', () => {
    const spans = scan('  ```mermaid\n  graph TD\n  ```')
    expect(spans).toHaveLength(1)
    expect(spans[0]!.rendered).toBe(true)
  })

  it('闭合围栏要求 run ≥ 开启 run 且行内无其他内容', () => {
    // ```` 开启，``` 不闭合
    const shortClose = scan('````mermaid\nA-->B\n```\n````')
    expect(shortClose).toHaveLength(1)
    expect(shortClose[0]!.code).toBe('A-->B\n```')
    // 闭合行带 info → 不是闭合围栏，为内容
    const infoClose = scan('```mermaid\nA-->B\n``` tail')
    expect(infoClose).toHaveLength(0)
  })

  it('未闭合围栏（EOF）不产出（稳定降级为源码）', () => {
    expect(scan('```mermaid\ngraph TD\nA-->B')).toHaveLength(0)
  })

  it('反引号围栏的 info 含反引号时不开启（CommonMark）', () => {
    expect(scan('```mermaid`\nA\n```')).toHaveLength(0)
  })

  it('围栏之后的内容照常开启新围栏；多围栏互不吞并', () => {
    const text = [
      '```mermaid',
      'graph TD',
      'A-->B',
      '```',
      '正文',
      '```mermaid',
      'sequenceDiagram',
      'A->>B: hi',
      '```',
    ].join('\n')
    const spans = scan(text)
    expect(spans).toHaveLength(2)
    expect(spans.every((s) => s.rendered)).toBe(true)
    expect(spans[1]!.code).toBe('sequenceDiagram\nA->>B: hi')
  })

  it('firstLineStart 非零时区间以全文坐标产出（增量窗口直驱）', () => {
    const lines = ['```mermaid', 'graph TD', '```']
    const spans = scanFenceSpans(lines, 100)
    expect(spans[0]!.from).toBe(100)
    expect(spans[0]!.to).toBe(100 + lines.join('\n').length)
  })
})

describe('scanFencesDetailed：窗口扫描的开放状态回报', () => {
  it('窗口末尾处于开放围栏内时 open 回报开启信息', () => {
    const r = scanFencesDetailed(['正文', '```mermaid', 'graph TD'], 0)
    expect(r.spans).toHaveLength(0)
    expect(r.open).not.toBeNull()
    expect(r.open!.from).toBe('正文\n'.length)
    expect(r.open!.rendered).toBe(true)
  })

  it('窗口全部闭合时 open 为 null', () => {
    const r = scanFencesDetailed(['```mermaid', 'A-->B', '```'], 0)
    expect(r.open).toBeNull()
    expect(r.spans).toHaveLength(1)
  })

  it('initialOpen 输入：以已开放状态续扫新行段，闭合产出完整 span（D-3 增量续扫契约）', () => {
    // 第一批：````md 开启后窗口截断 → open 携带已累积内容
    const first = scanFencesDetailed(['````md', 'a'], 0)
    expect(first.open).not.toBeNull()
    expect(first.open!.code).toBe('a')
    // 第二批：只扫新行段（开放状态延续），闭合时 code 含窗口外前缀
    const second = scanFencesDetailed(['b', '````', 'tail'], '````md\na\n'.length, first.open)
    expect(second.spans).toHaveLength(1)
    expect(second.spans[0]!.code).toBe('a\nb')
    expect(second.spans[0]!.rendered).toBe(false)
    expect(second.open).toBeNull()
  })

  it('initialOpen 为空 code 时续扫不引入幻影空行（空内容围栏形态）', () => {
    const first = scanFencesDetailed(['```mermaid'], 0)
    expect(first.open!.code).toBe('')
    const second = scanFencesDetailed(['A-->B', '```'], '```mermaid\n'.length, first.open)
    expect(second.spans).toHaveLength(1)
    expect(second.spans[0]!.code).toBe('A-->B')
    expect(second.spans[0]!.rendered).toBe(true)
  })
})

describe('引用内围栏：前缀剥离（#674 T06）', () => {
  /** 便捷：文本直扫返回原始 FenceSpan（lineMap 断言需要完整产物） */
  function scanRaw(text: string): FenceSpan[] {
    return scanFenceSpans(text.split('\n'), 0)
  }

  it('一层前缀围栏：识别剥前缀裸行，from/to 保持全文坐标，code 剥前缀', () => {
    const text = ['> [!note] 标题', '> ```mermaid', '> graph TD', '> A-->B', '> ```', '> 尾部'].join('\n')
    const spans = scanRaw(text)
    expect(spans).toHaveLength(1)
    const s = spans[0]!
    expect(s.rendered).toBe(true)
    // from 为开围栏行行首（> 处）、to 为闭围栏行行尾——区间覆盖原文（含前缀）
    expect(s.from).toBe(text.indexOf('> ```mermaid'))
    expect(s.to).toBe(text.lastIndexOf('```') + 3)
    expect(text.slice(s.from, s.to)).toBe('> ```mermaid\n> graph TD\n> A-->B\n> ```')
    // 识别输入与产出内容都是剥前缀后的裸行
    expect(s.code).toBe('graph TD\nA-->B')
  })

  it('lineMap 把裸内容行锚回原文坐标（T07 token 着色与装饰锚定换算输入）', () => {
    const text = ['> ```mermaid', '> graph TD', '> A-->B', '> ```'].join('\n')
    const s = scanRaw(text)[0]!
    expect(s.lineMap).toHaveLength(2) // 内容行才进映射，开闭围栏行不进
    expect(s.lineMap[0]).toEqual({ contentOffset: 0, lineStart: '> ```mermaid\n'.length, prefixLen: 2 })
    expect(s.lineMap[1]).toEqual({ contentOffset: 'graph TD\n'.length, lineStart: '> ```mermaid\n> graph TD\n'.length, prefixLen: 2 })
    // 换算契约：裸内容行任一 offset 折算回原文位置 = lineStart + prefixLen + (offset − contentOffset)
    for (const e of s.lineMap) {
      const nl = s.code.indexOf('\n', e.contentOffset)
      const bareLine = s.code.slice(e.contentOffset, nl < 0 ? undefined : nl)
      const docStart = e.lineStart + e.prefixLen
      expect(text.slice(docStart, docStart + bareLine.length)).toBe(bareLine)
    }
  })

  it('顶层（无前缀）围栏的 lineMap 平凡产出（prefixLen=0），映射随扫描产物一并给', () => {
    const s = scanFenceSpans(['```mermaid', 'A-->B', '```'], 100)[0]!
    expect(s.lineMap).toEqual([{ contentOffset: 0, lineStart: 100 + '```mermaid\n'.length, prefixLen: 0 }])
  })

  it('2/3 层前缀与 > 无空格形态同样识别；code 剥同层数前缀', () => {
    const two = scanRaw(['> > ```mermaid', '> > graph TD', '> > ```'].join('\n'))
    expect(two).toHaveLength(1)
    expect(two[0]!.code).toBe('graph TD')
    const three = scanRaw(['>>> ```mermaid', '>>> graph TD', '>>> ```'].join('\n'))
    expect(three[0]!.code).toBe('graph TD')
    const noSpace = scanRaw(['>```mermaid', '>graph TD', '>```'].join('\n'))
    expect(noSpace).toHaveLength(1)
    expect(noSpace[0]!.code).toBe('graph TD')
    expect(noSpace[0]!.lineMap).toEqual([{ contentOffset: 0, lineStart: '>```mermaid\n'.length, prefixLen: 1 }])
  })

  it('不定长前缀：开闭行前缀形态不同（层等价）仍闭合；每层独立消耗 > 与可选空格', () => {
    // 开启行 `> > `（2 层带空格）、内容与闭合行 `>>`（2 层无空格）
    const spans = scanRaw(['> > ```mermaid', '>>graph TD', '>>```'].join('\n'))
    expect(spans).toHaveLength(1)
    expect(spans[0]!.code).toBe('graph TD')
  })

  it('围栏开闭同容器：顶层闭合行不闭合引用内围栏（CommonMark 容器断开）', () => {
    // 引用在无前缀行处断开：引用内围栏未闭合终止（与 markdown-it 核心规则
    // 一致——blockquote 内 fence 自动闭合为空内容），顶层 ``` 是新围栏开启
    const spans = scanRaw(['> ```mermaid', 'graph TD', '```'].join('\n'))
    expect(spans).toHaveLength(0) // 顶层围栏 EOF 未闭合同样不产出
    // 断开行后的顶层围栏可正常闭合（fall-through 重扫不吞行）
    const recovered = scanRaw(['> ```mermaid', 'graph TD', '```', 'js', '```'].join('\n'))
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.code).toBe('js')
  })

  it('闭合行前缀层数多于开启行时不闭合：剥开启层数后剩余是内容（嵌套引用语义）', () => {
    // 开启 1 层；`> > ``` ` 剥 1 层剩 `> ``` ` 不是闭合形态，是内容行
    const spans = scanRaw(['> ```mermaid', '> > ```', '> ```'].join('\n'))
    expect(spans).toHaveLength(1)
    expect(spans[0]!.code).toBe('> ```')
  })

  it('内容行前缀层数多于开启行：剥开启层数后的剩余（含 >）原样进内容', () => {
    const spans = scanRaw(['> ```text', '> > quoted', '> ```'].join('\n'))
    expect(spans).toHaveLength(1)
    expect(spans[0]!.code).toBe('> quoted')
  })

  it('代码中字面 >：内容行剥前缀后行中 > 保留；顶层围栏内容行以 > 开头不剥', () => {
    const quoted = scanRaw(['> ```js', '> const s = "> hi"', '> ```'].join('\n'))
    expect(quoted[0]!.code).toBe('const s = "> hi"')
    // 顶层围栏内容行以 > 开头是字面内容，不剥（depth 0 无前缀可剥）
    const topLevel = scanFenceSpans(['```text', '> quoted line', '```'], 0)
    expect(topLevel[0]!.code).toBe('> quoted line')
    expect(topLevel[0]!.lineMap[0]!.prefixLen).toBe(0)
  })

  it('CommonMark 相对缩进：前缀后 0-3 列开启、4 列是缩进代码块；Tab 折算同口径', () => {
    // 3 空格（剥前缀后）仍开启
    expect(scanRaw(['>    ```mermaid', '>    graph TD', '>    ```'].join('\n'))).toHaveLength(1)
    // 4 空格：缩进代码块不开启（与 markdown-it 对拍口径一致）
    expect(scanRaw(['>     ```mermaid', '>     graph TD', '>     ```'].join('\n'))).toHaveLength(0)
    // 前缀后行首 Tab：折算到 4 列制表位，不开启
    expect(scanRaw(['> \t```mermaid', '> graph TD', '> ```'].join('\n'))).toHaveLength(0)
    // `>` 后直接 Tab（> ? 只吃空格不吃 Tab）：剥 > 后 Tab 起步同样不开启
    expect(scanRaw(['>\t```mermaid', '> graph TD', '> ```'].join('\n'))).toHaveLength(0)
  })

  it('未闭合引用内围栏（EOF）不产出（稳定降级为源码）', () => {
    expect(scanRaw(['> ```mermaid', '> graph TD'].join('\n'))).toHaveLength(0)
  })

  it('增量续扫跨扫描窗口：open 携带前缀深度，闭合产出与全量一致（含 lineMap）', () => {
    const text = ['> ```mermaid', '> graph TD', '> A-->B', '> ```', '> 尾部'].join('\n')
    // 批 1 截断在内容中段；批 2 以 initialOpen 续扫（跨窗口闭合）
    const first = scanFencesDetailed(['> ```mermaid', '> graph TD'], 0)
    expect(first.open).not.toBeNull()
    expect(first.open!.code).toBe('graph TD')
    const second = scanFencesDetailed(['> A-->B', '> ```', '> 尾部'], text.indexOf('> A-->B'), first.open)
    expect(second.spans).toHaveLength(1)
    expect(second.open).toBeNull()
    const full = scanRaw(text)
    expect(second.spans[0]).toEqual(full[0]) // code / lineMap / 区间逐字段一致
  })

  it('增量续扫跨容器边界：open 态下窗口内层数不足的行终止围栏，与全量一致', () => {
    const text = ['> ```mermaid', '> graph', 'plain', '```', 'js', '```'].join('\n')
    const first = scanFencesDetailed(['> ```mermaid', '> graph'], 0)
    expect(first.open).not.toBeNull()
    const second = scanFencesDetailed(['plain', '```', 'js', '```'], text.indexOf('plain'), first.open)
    // 断开行 plain 终止引用内围栏（未闭合不产出）；``` 开顶层围栏闭合于 js 行后
    expect(second.spans).toHaveLength(1)
    expect(second.spans[0]!.code).toBe('js')
    expect(second.spans).toEqual(scanRaw(text))
  })

  it('窗口起点在引用内围栏中段（initialOpen 为空起步）：窗口内裸 ``` 是新开启，不误配', () => {
    // 调用方只传行窗口：窗口首行已在围栏内时以非 open 态起步，窗口内 ``` 按新围栏开启
    const out = scanFencesDetailed(['> graph TD', '> ```', '> tail'], 0)
    expect(out.spans).toHaveLength(0)
    expect(out.open).not.toBeNull()
    expect(out.open!.from).toBe('> graph TD\n'.length)
    expect(out.open!.code).toBe('tail')
    // 窗口内出现层数不足的行：开放围栏终止（open 清空，不吞窗口外状态）
    const broken = scanFencesDetailed(['> ```', 'tail'], 0)
    expect(broken.spans).toHaveLength(0)
    expect(broken.open).toBeNull()
  })
})

describe('FenceSpan 与增量重建的坐标契约', () => {
  it('to 为闭围栏行行尾（不含换行），映射语义与 MathOccurrence 同构', () => {
    const text = '```mermaid\nA\n```\ntail'
    const s: FenceSpan | undefined = scanFenceSpans(text.split('\n'), 0)[0]
    expect(s).toBeDefined()
    expect(text.slice(s!.from, s!.to)).toBe('```mermaid\nA\n```')
  })
})

describe('locateGraphicFenceCode（弹窗刷新重定位，#111 契约 4）', () => {
  it('单围栏被外部改写：返回最新内容（主场景）', () => {
    expect(locateGraphicFenceCode('# t\n\n```mermaid\nC-->D\n```\n', 'mermaid', 'A-->B')).toBe('C-->D')
  })

  it('来源围栏未变：精确匹配返回原文（刷新为无操作，命中缓存）', () => {
    const doc = '```mermaid\nA-->B\n```\n\n```mermaid\nX\n```\n'
    expect(locateGraphicFenceCode(doc, 'mermaid', 'A-->B')).toBe('A-->B')
    expect(locateGraphicFenceCode(doc, 'mermaid', 'X')).toBe('X')
  })

  it('多围栏且旧内容不在：歧义返回 null（回退打开时快照）；非该语言围栏不参与', () => {
    const doc = '```mermaid\nP\n```\n\n```mermaid\nQ\n```\n'
    expect(locateGraphicFenceCode(doc, 'mermaid', 'gone')).toBe(null)
    expect(locateGraphicFenceCode('```plantuml\nP\n```\n', 'mermaid', 'P')).toBe(null)
    expect(locateGraphicFenceCode('', 'mermaid', 'P')).toBe(null)
  })
})
