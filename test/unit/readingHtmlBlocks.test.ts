// @vitest-environment jsdom
// 阅读侧块级 HTML 渲染契约（#567/T02）：html_block token 从「跳过不产块」
// 升级为「净化后渲染」——块序列单调有序、锚点区间真实覆盖源文（此前缝隙
// 归前一块的 floor 语义随之消除）、净化边界（第一道 DOMPurify + 第二道
// sanitizeReadingDom 纵深）、纯 <style> 块隐藏（T04 装载）、script-only
// 回退转义源码、宿主元素类名与 docScope 标记（T04 隔离基座）。
import { describe, it, expect } from 'vitest'
import { splitReadingBlocks, blockForOffset } from '../../src/webview/readingBlocks'
import { createReadingBlockElement, READING_CLASS_NAMES } from '../../src/webview/readingView'
import { sanitizeReadingDom } from '../../src/webview/readingMarkdown'

const TABLE = [
  '<table>',
  '  <tr>',
  '    <td colspan="2" rowspan="3">合并</td>',
  '    <td>普通</td>',
  '  </tr>',
  '</table>',
].join('\n')

const DOC = ['前文段。', '', TABLE, '', '后文段。'].join('\n')
const FROM = DOC.indexOf('<table>')
const TO = FROM + TABLE.length

describe('splitReadingBlocks：html 块化（取代跳过）', () => {
  const blocks = splitReadingBlocks(DOC)

  it('html 块进入块序列，区间精确覆盖源文', () => {
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'html', 'paragraph'])
    const html = blocks[1]!
    expect(html.start).toBe(FROM)
    expect(html.end).toBe(TO)
    expect(DOC.slice(html.start, html.end)).toBe(TABLE)
  })

  it('块内 html 为净化产物（合并单元格保留、非转义文本）', () => {
    const html = blocks[1]!
    expect(html.html).toContain('<table>')
    expect(html.html).toContain('colspan="2"')
    expect(html.html).toContain('rowspan="3"')
  })

  it('锚点可达：offset 落在 html 块内返回该块（此前归前一块）', () => {
    const blocksNow = splitReadingBlocks(DOC)
    const hit = blockForOffset(blocksNow, FROM + 10)
    expect(hit?.kind).toBe('html')
  })

  it('危险内容净化：script/事件属性/伪造系统锚点不进 block.html', () => {
    const evil = '<div onclick="evil()">x</div><script>bad()</script><span data-vsidian-src-start="1">y</span>'
    const [block] = splitReadingBlocks(evil)
    expect(block?.kind).toBe('html')
    expect(block!.html).not.toContain('<script')
    expect(block!.html).not.toContain('onclick')
    expect(block!.html).not.toContain('data-vsidian-src-start')
    expect(block!.html).toContain('<div>x</div>')
  })

  it('script-only 块回退转义源码（可访问原始源码，不吞不执行）', () => {
    const [block] = splitReadingBlocks('<script>alert(1)</script>')
    expect(block?.kind).toBe('html')
    expect(block!.html).toContain('&lt;script&gt;')
    expect(block!.html).not.toContain('<script')
  })

  it('纯 <style> 块隐藏（html 为空——T04 收集器从源文装载）', () => {
    const text = '<style>\n.x { color: red; }\n</style>\n\n段落'
    const blocksNow = splitReadingBlocks(text)
    expect(blocksNow.map((b) => b.kind)).toEqual(['html', 'paragraph'])
    expect(blocksNow[0]!.html).toBe('')
  })

  it('畸形未闭合片段：块边界仍在自身行内（不吞邻接 Markdown）', () => {
    const text = '<div>\n  未闭合\n\n邻接段落照常成块'
    const blocksNow = splitReadingBlocks(text)
    expect(blocksNow.map((b) => b.kind)).toEqual(['html', 'paragraph'])
    expect(blocksNow[1]!.start).toBe(text.indexOf('邻接'))
  })

  it('围栏/缩进/行内代码内的 HTML 保持字面（不产 html 块）', () => {
    const text = '```\n<div>围栏字面</div>\n```\n\n    <div>缩进字面</div>\n\n文字 `<div>` 行内。'
    const kinds = splitReadingBlocks(text).map((b) => b.kind)
    expect(kinds).not.toContain('html')
  })
})

describe('createReadingBlockElement：html 块元素契约', () => {
  const blocks = splitReadingBlocks(DOC)
  const htmlBlock = blocks[1]!

  it('宿主元素类名（vsidian-reading-block + vsidian-reading-html）与源锚点', () => {
    const el = createReadingBlockElement(htmlBlock, DOC)
    expect(el.classList.contains(READING_CLASS_NAMES.block)).toBe(true)
    expect(el.classList.contains(READING_CLASS_NAMES.html)).toBe(true)
    expect(el.dataset['vsidianSrcStart']).toBe(String(FROM))
    expect(el.dataset['vsidianSrcEnd']).toBe(String(TO))
    expect(el.querySelector('table')).not.toBeNull()
  })

  it('内容保持原生语义 DOM：不加生产 Markdown 块类（Q4=B 口径）', () => {
    const el = createReadingBlockElement(htmlBlock, DOC)
    // 内层 table 不携带 vsidian-reading-table（那是 Markdown 表格块的类）
    expect(el.querySelector('.vsidian-reading-table')).toBeNull()
  })

  it('docScope 标记（T04 隔离基座）：传入时挂在渲染根', () => {
    const el = createReadingBlockElement(htmlBlock, DOC, 'doc')
    expect(el.dataset['vsidianDocScope']).toBe('doc')
    const bare = createReadingBlockElement(htmlBlock, DOC)
    expect(bare.dataset['vsidianDocScope']).toBeUndefined()
  })

  it('第二道闸兼容：sanitizeReadingDom 纵深清洗后内容不劣化', () => {
    const el = createReadingBlockElement(htmlBlock, DOC)
    sanitizeReadingDom(el)
    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelector('td[colspan="2"][rowspan="3"]')).not.toBeNull()
  })
})
