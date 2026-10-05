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

describe('块 id 标记隐藏（#163 验收反馈）：阅读渲染输入先剥离标记', () => {
  it('行尾与独立行双形态标记不出现；正文保留', () => {
    const blocks = splitReadingBlocks('段甲 ^tail999\n\n段乙\n\n^std888\n')
    const paras = blocks.filter((b) => b.kind === 'paragraph')
    expect(paras).toHaveLength(2)
    expect(paras[0]!.html).toContain('段甲')
    expect(paras[0]!.html).not.toContain('tail999')
    expect(paras.map((b) => b.html).join('')).not.toContain('std888')
  })

  it('围栏内的字面 ^id 保留（代码内容）；锚点坐标系不受剥离影响', () => {
    const text = '段甲\n\n```\ncode ^keep\n```\n\n段乙 ^b1\n'
    const blocks = splitReadingBlocks(text)
    const fence = blocks.find((b) => b.kind === 'code-block')!
    expect(fence.html).toContain('code ^keep')
    // 剥离保行数：段乙仍锚定原文行（行尾标记剥成空白后行区间不变）
    const para = blocks.filter((b) => b.kind === 'paragraph').find((b) => b.html.includes('段乙'))!
    expect(text.slice(para.start, para.end)).toBe('段乙 ^b1')
  })
})

describe('splitReadingBlocks：嵌入块（#222 独占行挂载适配）', () => {
  it('独占正文一行的 ![[…]] 切为 embed 块：区间为该行、inner 携带原文', () => {
    const text = '前文\n\n![[目标笔记]]\n\n后文\n'
    const blocks = splitReadingBlocks(text)
    const embed = blocks.find((b) => b.kind === 'embed')
    expect(embed).toBeDefined()
    expect(embed!.start).toBe(text.indexOf('![[目标笔记]]'))
    expect(embed!.end).toBe(text.indexOf('![[目标笔记]]') + '![[目标笔记]]'.length)
    expect(embed!.embedInner).toBe('目标笔记')
    // 相邻段落不受影响
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'embed', 'paragraph'])
  })

  it('带缩进（≤3 空格）与行尾空白的独占行照常成块；标题/块/别名目标同样成块', () => {
    const text = '  ![[目标#章节]]  \n![[笔记#^b1]]\n![[目标|显示别名]]\n'
    const blocks = splitReadingBlocks(text)
    expect(blocks.filter((b) => b.kind === 'embed').map((b) => b.embedInner))
      .toEqual(['目标#章节', '笔记#^b1', '目标|显示别名'])
  })

  it('混排（行内有其他内容）保留段落源文，不产 embed 块', () => {
    const text = '前缀 ![[目标]] 后缀\n'
    expect(splitReadingBlocks(text).some((b) => b.kind === 'embed')).toBe(false)
    expect(splitReadingBlocks(text)[0]!.kind).toBe('paragraph')
  })

  it('围栏代码与行内代码内的 ![[…]] 不命中（代码区域字面文本）', () => {
    const text = ['```text', '![[目标]]', '```', '', '`![[目标]]` 行内代码', ''].join('\n')
    expect(splitReadingBlocks(text).some((b) => b.kind === 'embed')).toBe(false)
  })

  it('表格格内的 ![[…]] 不命中（表格块整体保留）', () => {
    const text = '| 列甲 | 列乙 |\n| --- | --- |\n| ![[目标]] | b |\n'
    const blocks = splitReadingBlocks(text)
    expect(blocks.some((b) => b.kind === 'embed')).toBe(false)
    expect(blocks.some((b) => b.kind === 'table')).toBe(true)
  })

  it('列表项与引用块内的 ![[…]] 不命中（容器内嵌入 1.5 期接入）', () => {
    const text = '- 项目 ![[目标]]\n\n> 引用 ![[目标]]\n'
    const blocks = splitReadingBlocks(text)
    expect(blocks.some((b) => b.kind === 'embed')).toBe(false)
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'blockquote'])
  })

  it('多行段落（嵌入行 + 懒续行）不命中——非独占行', () => {
    const text = '![[目标]]\n续行文本\n'
    expect(splitReadingBlocks(text).some((b) => b.kind === 'embed')).toBe(false)
  })

  it('非法/残缺嵌入形态保留段落源文（空目标、多级标题、未闭合）', () => {
    for (const line of ['![[ ]]', '![[a#b#c]]', '![[未闭合']) {
      const blocks = splitReadingBlocks(`${line}\n`)
      expect(blocks.some((b) => b.kind === 'embed'), line).toBe(false)
      expect(blocks[0]!.kind, line).toBe('paragraph')
    }
  })

  it('embed 块占位 html 为可点击引用行（wikilink 类 + 嵌入修饰类；主文档挂载时替换为卡片）', () => {
    const text = '![[目标#章节|别名]]\n'
    const embed = splitReadingBlocks(text).find((b) => b.kind === 'embed')!
    expect(embed.html).toContain('vsidian-wikilink')
    expect(embed.html).toContain('vsidian-embed-ref')
    // href 为 | 之前目标原文（与双链 a 同口径）；文本保留嵌入形态可辨识
    expect(embed.html).toContain('href="目标#章节"')
    expect(embed.html).toContain('![[别名]]')
  })
})

// #336（P3-04）图片嵌入块形态：独占行 `![[图.png]]` 不升级为嵌入卡片块
// （不新增文件名引用卡片壳），按普通段落走 markdown-it 渲染（inline 规则
// 产 img——与 `![](图.png)` 独行段落同块形态）；含图片嵌入的混排多行段
// 落整体保持段落（markdown 嵌入行经 #246 占位提升路径挂卡，不因同段图
// 片嵌入丢卡片）。
describe('#336 图片嵌入块形态：独行图不入嵌入块', () => {
  it('独占行图片嵌入 → 段落块（kind=paragraph，无 embedInner——不挂卡片壳）', () => {
    const blocks = splitReadingBlocks('![[图.png]]\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('paragraph')
    expect((blocks[0] as { embedInner?: string }).embedInner).toBeUndefined()
    expect(blocks[0]!.html).toContain('<img')
  })

  it('混排多行段落（markdown 嵌入 + 图片嵌入）→ 整段保持段落（占位提升路径挂卡）', () => {
    const blocks = splitReadingBlocks('![[目标笔记]]\n![[图.png]]\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('paragraph')
    expect((blocks[0] as { embedInner?: string }).embedInner).toBeUndefined()
    expect(blocks[0]!.html).toContain('<img')
  })

  it('纯 markdown 多行嵌入段不变（仍逐行升级嵌入块）', () => {
    const blocks = splitReadingBlocks('![[A]]\n![[B]]\n')
    expect(blocks.map((b) => b.kind)).toEqual(['embed', 'embed'])
  })
})
