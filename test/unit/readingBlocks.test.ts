// @vitest-environment jsdom
// 阅读块切分契约（工单 #8）：markdown-it token 流驱动的块模型。
// - 块序列单调有序、互不重叠；start/end 为 LF 全文 UTF-16 offset（与协议
//   SerChange 坐标同构；#7 按需挂载与 #9 任务定位依赖此结构）
// - 语义切块：标题（ATX+Setext）/段落/列表（整体一块，li 自带锚点）/引用
//   /围栏代码/水平线/frontmatter；嵌套结构语义渲染
// - 大围栏按行细分（FENCE_CHUNK_LINES）：细分后仍是普通块（#7 机制不变）
// - 未支持语法保留原文（脚注等按普通段落渲染——局部源码降级）
// - 块携带内部 HTML：html:false 的 markdown-it 渲染产物（转义源文）
import { describe, it, expect } from 'vitest'
import {
  FENCE_CHUNK_LINES,
  blockForOffset,
  splitReadingBlocks,
  type ReadingBlock,
} from '../../src/webview/readingBlocks'

const DOC = [
  '---',
  'title: 元',
  '---',
  '# 顶部标题',
  '',
  '第一段文本 **含粗体** 与 `行内码`。',
  '',
  '> 引用一',
  '> 引用二',
  '',
  '- 普通项',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
  '',
  '1. 有序一',
  '',
  '```code',
  '伪内容 # 伪标题 [[双链]]',
  '```',
  '',
  '结尾段',
].join('\n')

function kinds(blocks: ReadingBlock[]): string[] {
  return blocks.map((b) => b.kind)
}

function sliceAt(text: string, b: ReadingBlock): string {
  return text.slice(b.start, b.end)
}

describe('splitReadingBlocks：语义切块与源锚点', () => {
  const blocks = splitReadingBlocks(DOC)

  it('块序列单调有序、互不重叠，锚点区间落在源文内', () => {
    expect(kinds(blocks)).toEqual([
      'frontmatter',
      'heading',
      'paragraph',
      'blockquote',
      'list',
      'list',
      'code-block',
      'paragraph',
    ])
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!
      expect(b.start).toBeLessThan(b.end)
      expect(DOC.slice(b.start, b.end).length).toBe(b.end - b.start)
      if (i > 0) {
        expect(b.start).toBeGreaterThanOrEqual(blocks[i - 1]!.end)
      }
    }
  })

  it('frontmatter 整块提取：合法头区成型表格（值不进 Markdown 解析，无 h1/列表）', () => {
    const fm = blocks[0]!
    expect(sliceAt(DOC, fm)).toBe('---\ntitle: 元\n---')
    expect(fm.html).not.toContain('<h')
    expect(fm.html).not.toContain('<ul')
    // #140：合法头区为表格 HTML（键值分格）；源文 `title: 元` 不整段出现
    expect(fm.html).toContain('vsidian-fm-table')
    expect(fm.html).toContain('vsidian-fm-key">title<')
    expect(fm.html).toContain('vsidian-fm-value">元<')
  })

  it('frontmatter 降级：复杂类型头区保持转义源码块', () => {
    const degraded = splitReadingBlocks('---\ntitle: 元\nouter:\n  inner: 1\n---\n\n正文')
    const fm = degraded[0]!
    expect(fm.kind).toBe('frontmatter')
    expect(fm.html).toContain('vsidian-reading-frontmatter-text')
    expect(fm.html).toContain('title: 元')
    expect(fm.html).not.toContain('vsidian-fm-table')
  })

  it('标题块：级别来自 tag；渲染产物为语义标签（无 # 标记）', () => {
    const heading = blocks[1]!
    expect(heading.kind).toBe('heading')
    expect(heading.level).toBe(1)
    expect(sliceAt(DOC, heading)).toBe('# 顶部标题')
    expect(heading.html).toContain('<h1>顶部标题</h1>')
  })

  it('段落块：行内语义渲染（strong/code），源文锚点覆盖原行', () => {
    const para = blocks[2]!
    expect(para.kind).toBe('paragraph')
    expect(sliceAt(DOC, para)).toBe('第一段文本 **含粗体** 与 `行内码`。')
    expect(para.html).toContain('<strong>含粗体</strong>')
    expect(para.html).toContain('<code>行内码</code>')
  })

  it('引用块：整体一块，内部含语义 p', () => {
    const quote = blocks[3]!
    expect(quote.kind).toBe('blockquote')
    expect(quote.html).toContain('<blockquote>')
    expect(quote.html).toContain('引用一')
  })

  it('列表块：整体一块（无序/有序各一）；li 锚点经渲染规则写入 html', () => {
    const [bullet, ordered] = [blocks[4]!, blocks[5]!]
    expect(sliceAt(DOC, bullet)).toBe('- 普通项\n- [ ] 未完成任务\n- [x] 已完成任务')
    expect(bullet.html).toContain('data-vsidian-src-start')
    expect(bullet.html).toContain('>普通项</li>')
    expect(sliceAt(DOC, ordered)).toBe('1. 有序一')
    expect(ordered.html).toContain('<ol>')
  })

  it('围栏代码块：内容转义呈现（含伪语法），不含围栏标记', () => {
    const code = blocks[6]!
    expect(sliceAt(DOC, code)).toBe('```code\n伪内容 # 伪标题 [[双链]]\n```')
    expect(code.html).toContain('伪内容 # 伪标题 [[双链]]')
    expect(code.html).not.toContain('```code')
  })

  it('未支持语法（脚注 [^1]）按普通段落渲染——保留原文', () => {
    const blocks2 = splitReadingBlocks('脚注样式 [^1] 文本\n')
    expect(blocks2).toHaveLength(1)
    expect(blocks2[0]!.kind).toBe('paragraph')
    expect(blocks2[0]!.html).toContain('[^1]')
  })

  it('嵌套结构：引用内列表、列表内嵌套列表按语义切为一块', () => {
    const text = '> - 引用内列表\n>   - 嵌套项\n'
    const blocks2 = splitReadingBlocks(text)
    expect(blocks2).toHaveLength(1)
    expect(blocks2[0]!.kind).toBe('blockquote')
    expect(blocks2[0]!.html).toContain('嵌套项')
    expect(blocks2[0]!.html).toContain('data-vsidian-src-start="10"') // 嵌套项自身的源锚点
  })

  it('Setext 标题：解析为标题块', () => {
    const blocks2 = splitReadingBlocks('主题行\n===\n正文\n')
    expect(blocks2[0]!.kind).toBe('heading')
    expect(blocks2[0]!.level).toBe(1)
    expect(blocks2[0]!.html).toContain('<h1>主题行</h1>')
  })

  it('未闭合围栏：内容持续到文档末尾', () => {
    const text = '前文\n\n```\n# 伪标题\n末尾仍在围栏内\n'
    const blocks2 = splitReadingBlocks(text)
    const code = blocks2.find((b) => b.kind === 'code-block')!
    expect(code).toBeDefined()
    expect(text.slice(code.start, code.end)).toBe('```\n# 伪标题\n末尾仍在围栏内')
    expect(blocks2.some((b) => b.kind === 'heading')).toBe(false)
  })

  it('空文档与纯空白文档返回空块序列', () => {
    expect(splitReadingBlocks('')).toEqual([])
    expect(splitReadingBlocks('\n\n  \n')).toEqual([])
  })

  it('frontmatter 文档的列表：li 锚点/itemAnchors 用全文行号（回归：body 基行换算）', () => {
    const text = '---\ntitle: 元\n---\n\n正文段\n\n- 甲\n- [x] 乙\n'
    const blocks2 = splitReadingBlocks(text)
    const list = blocks2.find((b) => b.kind === 'list')!
    expect(list.itemAnchors).toEqual([text.indexOf('- 甲'), text.indexOf('- [x]')])
    // html 中的 li 锚点与 itemAnchors 一致
    expect(list.html).toContain(`data-vsidian-src-start="${text.indexOf('- 甲')}"`)
    expect(list.html).toContain(`data-vsidian-src-start="${text.indexOf('- [x]')}"`)
  })

  it('水平线独立成块', () => {
    const text = '上文\n\n---\n\n下文\n'
    const blocks2 = splitReadingBlocks(text)
    expect(blocks2.map((b) => b.kind)).toEqual(['paragraph', 'hr', 'paragraph'])
  })
})

describe('大围栏按行细分（#7 超大单块缓解）', () => {
  function giantFence(lines: number): string {
    const out = ['# 头', '', '```text']
    for (let i = 1; i <= lines; i++) {
      out.push(`围栏内第 ${i} 行：固定宽度样本文本行。`)
    }
    out.push('```', '', '结尾段。')
    return out.join('\n')
  }

  it('超过阈值的围栏切为多个 code-block 块，每片 ≤ 阈值行数', () => {
    const lines = FENCE_CHUNK_LINES * 3 + 7
    const text = giantFence(lines)
    const blocks = splitReadingBlocks(text)
    const chunks = blocks.filter((b) => b.kind === 'code-block')
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    // 各片行数有界
    for (const c of chunks) {
      const lineCount = text.slice(c.start, c.end).split('\n').length
      expect(lineCount).toBeLessThanOrEqual(FENCE_CHUNK_LINES)
    }
    // 片序列连续覆盖整个围栏源区间（无缝隙、无重叠）
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBeGreaterThan(chunks[i - 1]!.end)
    }
    const fenceStart = text.indexOf('```text')
    const fenceEnd = text.lastIndexOf('```') + 3
    expect(chunks[0]!.start).toBe(fenceStart)
    expect(chunks[chunks.length - 1]!.end).toBe(fenceEnd)
    // 首片内容不含开围栏行；末片内容不含闭围栏行（内容与锚点分离）
    expect(chunks[0]!.html).not.toContain('```text')
    expect(chunks[chunks.length - 1]!.html).not.toContain('```')
    expect(chunks[1]!.html).toContain('围栏内第')
    // 语言类保留（后续语法高亮入口）
    expect(chunks[0]!.html).toContain('language-text')
  })

  it('未超阈值的围栏保持单块', () => {
    const text = giantFence(10)
    const blocks = splitReadingBlocks(text)
    expect(blocks.filter((b) => b.kind === 'code-block')).toHaveLength(1)
  })

  it('分片落位跨片行号契约：data-vsidian-code-start/total（片首行 0 基、整块内容行数）', () => {
    const lines = FENCE_CHUNK_LINES * 3 + 7
    const text = giantFence(lines)
    const chunks = splitReadingBlocks(text).filter((b) => b.kind === 'code-block')
    // 整块内容行数 = 187（不含开/闭围栏行）
    expect(chunks[0]!.html).toContain(`data-vsidian-code-total="${lines}"`)
    // 首片内容从围栏体第 0 行起（开围栏行占片内首行，内容 59 行）
    expect(chunks[0]!.html).toContain('data-vsidian-code-start="0"')
    // 第二片覆盖文档行 [start+60, start+119]，片首内容行为围栏体第 59 行
    expect(chunks[1]!.html).toContain('data-vsidian-code-start="59"')
    // 末片 start = 2*59 + 60（前两片内容行 59+60，末片首内容行接续）
    expect(chunks[2]!.html).toContain('data-vsidian-code-start="119"')
  })

  it('分块语言类取 info 首词（CommonMark；js title=x → language-js、c++ → language-c++）', () => {
    const body = Array.from({ length: FENCE_CHUNK_LINES + 2 }, (_, i) => `line-${i}`).join('\n')
    const jsChunks = splitReadingBlocks(`\`\`\`js title=x\n${body}\n\`\`\``)
      .filter((b) => b.kind === 'code-block')
    expect(jsChunks.length).toBeGreaterThan(1)
    expect(jsChunks[0]!.html).toContain('class="language-js"')
    const cppChunks = splitReadingBlocks(`\`\`\`c++\n${body}\n\`\`\``)
      .filter((b) => b.kind === 'code-block')
    expect(cppChunks[0]!.html).toContain('class="language-c++"')
  })
})

describe('blockForOffset：floor 语义（#6 契约保持）', () => {
  const blocks = splitReadingBlocks('# 标题\n\n段落一\n\n- 项\n')

  it('块内 offset 命中该块；缝隙命中前一块；越界 clamp 到末块', () => {
    expect(blockForOffset(blocks, 0)?.kind).toBe('heading')
    expect(blockForOffset(blocks, 6)?.kind).toBe('paragraph') // 段落内
    expect(blockForOffset(blocks, 4)?.kind).toBe('heading') // 行尾换行缝隙 → floor 到标题
    expect(blockForOffset(blocks, 999)?.kind).toBe('list')
    expect(blockForOffset([], 0)).toBeNull()
  })
})

describe('表格管道遮蔽不得改动普通链接（#22）', () => {
  it('URL 中反引号包围的管道符保持原目标', () => {
    const blocks = splitReadingBlocks('[跳转](https://example.com/`a|b`)\n')
    const host = document.createElement('div')
    host.innerHTML = blocks[0]!.html
    const href = host.querySelector('a')?.getAttribute('href')
    expect(href).toContain('%7C')
    expect(href).not.toContain('%EE%80%80')
  })
})

describe('HTML 注释隐藏（#139）：阅读渲染输入先剥离注释', () => {
  it('段落内行内注释不出现；正文文字保留', () => {
    const blocks = splitReadingBlocks('前 <!-- 隐匿 --> 后\n')
    const para = blocks.find((b) => b.kind === 'paragraph')!
    expect(para.html).toContain('前')
    expect(para.html).toContain('后')
    expect(para.html).not.toContain('隐匿')
    expect(para.html).not.toContain('&lt;!--')
  })

  it('跨行块级注释不产出块；两侧段落正常成块', () => {
    const blocks = splitReadingBlocks('段一\n<!-- 块级\n注释 -->\n段二\n')
    expect(blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(2)
    const all = blocks.map((b) => b.html).join('')
    expect(all).not.toContain('块级')
    expect(all).not.toContain('注释')
  })

  it('代码块与行内代码内的字面 <!-- 保留（负面用例）', () => {
    const blocks = splitReadingBlocks('```\n<!-- 围栏内 -->\n```\n\n说明 `<!-- 码 -->` 完\n')
    const fence = blocks.find((b) => b.kind === 'code-block')!
    expect(fence.html).toContain('&lt;!-- 围栏内 --&gt;')
    const para = blocks.find((b) => b.kind === 'paragraph')!
    expect(para.html).toContain('<code>&lt;!-- 码 --&gt;</code>')
  })

  it('frontmatter 内的 <!-- 按源码块呈现（剥离只作用于 body）', () => {
    const blocks = splitReadingBlocks('---\nnote: <!-- 元 -->\n---\n正文\n')
    const fm = blocks[0]!
    expect(fm.kind).toBe('frontmatter')
    expect(fm.html).toContain('&lt;!-- 元 --&gt;')
  })

  it('块锚点坐标系不受剥离影响（剥离保行数，token 行号与原文行一致）', () => {
    const text = '标题段\n<!-- 注 -->\n正文段\n'
    const blocks = splitReadingBlocks(text)
    const paras = blocks.filter((b) => b.kind === 'paragraph')
    expect(paras).toHaveLength(2)
    // 行号不变：两段仍分别锚定行 0 与行 2（注释行剥离后成为空白行，
    // 两侧块照常成块且区间与原文行首尾一致）
    expect(text.slice(paras[0]!.start, paras[0]!.end)).toBe('标题段')
    expect(text.slice(paras[1]!.start, paras[1]!.end)).toBe('正文段')
  })
})
