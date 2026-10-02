// @vitest-environment jsdom
// 阅读视图表格呈现契约（工单 #12）：
// - 表格是独立块种类（table），携带源锚点，与标题/段落同构
// - 渲染为真实 <table> 语义标签（markdown-it GFM），列对齐以内联样式保留
// - 只读：无输入控件、无 contenteditable（阅读视图除任务勾选外只读）
// - 转义管道 \| 渲染为字面 |（与 live 侧 GFM 拆分一致的单元格里呈单格）
// - 虚拟化下表格块按需挂载/回收（复用 #7 机制），滚动不重复解析
// - 双视图语义对拍：live 表格行装饰数 = reading 挂载表格行数（小文档全挂载）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import {
  createReadingBlockElement,
  READING_CLASS_NAMES,
} from '../../src/webview/readingView'
import { VirtualReadingView } from '../../src/webview/readingVirtualView'
import { buildLivePreviewDecorations } from '../../src/webview/liveDecorations'
import { EditorSelection, Text } from '@codemirror/state'
import { LIVE_CLASS_NAMES } from '../../src/webview/liveDecorations'

const TABLE_DOC = [
  '# 表格样例',
  '',
  '| 名字 | 数量 |',
  '| --- | :---: |',
  '| 苹果 | 3 |',
  '| 香蕉\\|梨 | 4 |',
  '',
  '结尾。',
  '',
].join('\n')

describe('阅读块模型：表格独立成块', () => {
  it('格内换行显示为 br，行内代码和带属性的 HTML 保持字面文本', () => {
    const text = '| 上<br>下 | `a<br>b` |\n| --- | --- |\n| 甲<br/>乙<br />丙 | <br onclick="x()"> |'
    const table = splitReadingBlocks(text).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, text)
    expect(el.querySelectorAll('th')[0]!.querySelectorAll('br')).toHaveLength(1)
    expect(el.querySelectorAll('th')[1]!.textContent).toBe('a<br>b')
    expect(el.querySelectorAll('td')[0]!.querySelectorAll('br')).toHaveLength(2)
    expect(el.querySelectorAll('td')[1]!.querySelector('br')).toBeNull()
    expect(el.querySelectorAll('td')[1]!.textContent).toContain('<br onclick="x()">')
  })
  it('表格切为 kind=table 的块，区间覆盖表头到末行，带源锚点', () => {
    const blocks = splitReadingBlocks(TABLE_DOC)
    const table = blocks.find((b) => b.kind === 'table')
    expect(table).toBeDefined()
    expect(table!.start).toBe(TABLE_DOC.indexOf('| 名字'))
    expect(table!.end).toBeGreaterThan(TABLE_DOC.indexOf('| 香蕉'))
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'table', 'paragraph'])
  })

  it('表格块渲染出真实 table/thead/tbody 语义标签与对齐样式', () => {
    const table = splitReadingBlocks(TABLE_DOC).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, TABLE_DOC)
    expect(el.querySelector('table')).not.toBeNull()
    expect(el.querySelector('thead th')).not.toBeNull()
    expect(el.querySelectorAll('tbody tr')).toHaveLength(2)
    // GFM 列对齐保留在内联样式（markdown-it 默认产物）
    const ths = Array.from(el.querySelectorAll('th'))
    expect(ths[1]!.getAttribute('style')).toContain('text-align:center')
  })

  it('转义管道渲染为字面 |（单格内容，不切列）', () => {
    const table = splitReadingBlocks(TABLE_DOC).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, TABLE_DOC)
    const rows = Array.from(el.querySelectorAll('tbody tr'))
    const escapedRow = rows.find((r) => r.textContent!.includes('香蕉'))
    expect(escapedRow).toBeDefined()
    const tds = Array.from(escapedRow!.querySelectorAll('td'))
    expect(tds[0]!.textContent).toBe('香蕉|梨')
    expect(tds).toHaveLength(2)
  })

  it('行内代码里的管道符不切列，表头与数据行均保留完整内容（#22）', () => {
    const text = [
      '| `键|名` | 普通 |',
      '| --- | --- |',
      '| `x|y` | z |',
      '| ``a|b`` | w |',
      '',
    ].join('\n')
    const table = splitReadingBlocks(text).find((b) => b.kind === 'table')
    expect(table).toBeDefined()
    const el = createReadingBlockElement(table!, text)
    expect(Array.from(el.querySelectorAll('thead th'), (th) => th.textContent)).toEqual(['键|名', '普通'])
    expect(Array.from(el.querySelectorAll('tbody tr'), (tr) =>
      Array.from(tr.querySelectorAll('td'), (td) => td.textContent),
    )).toEqual([['x|y', 'z'], ['a|b', 'w']])
  })

  it('表格块只读：无输入控件、无 contenteditable、无事件属性', () => {
    const table = splitReadingBlocks(TABLE_DOC).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, TABLE_DOC)
    expect(el.querySelectorAll('input, select, textarea, button')).toHaveLength(0)
    expect(el.querySelectorAll('[contenteditable]')).toHaveLength(0)
    expect(el.querySelector('table')!.getAttribute('onclick')).toBeNull()
  })

  it('表格块类名为稳定入口（vsidian-reading-table）', () => {
    const table = splitReadingBlocks(TABLE_DOC).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, TABLE_DOC)
    expect(el.classList.contains(READING_CLASS_NAMES.tableBlock)).toBe(true)
    expect(el.classList.contains(READING_CLASS_NAMES.block)).toBe(true)
  })
})

describe('虚拟化下的表格块', () => {
  let heightSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  })
  afterEach(() => {
    heightSpy.mockRestore()
  })

  function stubClientHeight(container: HTMLElement, h: number): void {
    Object.defineProperty(container, 'clientHeight', { value: h, configurable: true })
  }

  it('表格块与其他块同窗口挂载；滚动/重算不重复解析', () => {
    const container = document.createElement('div')
    container.className = READING_CLASS_NAMES.view
    document.body.appendChild(container)
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(TABLE_DOC)
    // 小文档全量窗口内：表格块已挂载
    expect(container.querySelector(`.${READING_CLASS_NAMES.tableBlock} table`)).not.toBeNull()
    const parseBefore = view.getStats().parseCount
    view.handleScroll()
    view.updateNow()
    expect(view.getStats().parseCount).toBe(parseBefore)
    view.dispose()
  })

  it('大文档：表格块进入窗口才挂载，滚出即回收 DOM', () => {
    // 300 段铺垫 + 表格 + 300 段尾部（单行段落估计高 36px）
    const lines: string[] = []
    for (let i = 0; i < 300; i++) {
      lines.push(`第 ${i} 段铺垫文本`, '')
    }
    lines.push('| h1 | h2 |', '| --- | --- |', '| a | b |', '')
    for (let i = 0; i < 300; i++) {
      lines.push(`尾 ${i} 段收尾文本`, '')
    }
    const text = lines.join('\n')
    const container = document.createElement('div')
    container.className = READING_CLASS_NAMES.view
    document.body.appendChild(container)
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    // 顶部窗口（约前 28 块）不含表格
    expect(container.querySelector(`.${READING_CLASS_NAMES.tableBlock}`)).toBeNull()
    // 滚到中部（表格附近：约 300*36=10800px）
    container.scrollTop = 10600
    view.updateNow()
    const tableEl = container.querySelector(`.${READING_CLASS_NAMES.tableBlock}`)
    expect(tableEl).not.toBeNull()
    expect((tableEl as HTMLElement).dataset['vsidianSrcStart']).toBe(String(text.indexOf('| h1 |')))
    // 滚回顶部：表格块回收
    container.scrollTop = 0
    view.updateNow()
    expect(container.querySelector(`.${READING_CLASS_NAMES.tableBlock}`)).toBeNull()
    view.dispose()
  })
})

describe('双视图表格语义对拍（小文档全挂载）', () => {
  it('live 表格行装饰数与 reading 表格行数一致', () => {
    const live = buildLivePreviewDecorations(
      Text.of(TABLE_DOC.split('\n')),
      EditorSelection.single(0),
    )
    let liveTableLines = 0
    live.between(0, TABLE_DOC.length, (_f, _t, value) => {
      const cls = (value.spec as { class?: string })['class'] ?? ''
      if (cls.split(' ').includes(LIVE_CLASS_NAMES.tableLine)) {
        liveTableLines += 1
      }
    })
    const table = splitReadingBlocks(TABLE_DOC).find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, TABLE_DOC)
    const readingRows = el.querySelectorAll('tr').length // thead 1 + tbody 2
    expect(liveTableLines).toBe(4)
    expect(readingRows).toBe(3)
    // 4 行 = 表头 + 分隔 + 2 数据行；阅读侧分隔行不渲染为行 → 4-1=3
    expect(liveTableLines - 1).toBe(readingRows)
  })
})

// ---- #296 二轮：引用内表格前缀残缺 → reading 同口径整表回退源码 ----

describe('引用表格前缀残缺的 reading 回退（#296 二轮）', () => {
  it('数据行缺 > 的引用表：不渲染半张表，按源文呈现', () => {
    const text = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n| 丙 | 丁 |\n\n后文'
    const blocks = splitReadingBlocks(text)
    const tableBlocks = blocks.filter((b) => b.kind === 'table')
    expect(tableBlocks).toHaveLength(0)
    // 受影响表按源文呈现（markdown-it 会把残缺行踢出留半张表头表）
    const sourceBlock = blocks.find((b) => b.html.includes('| 甲 | 乙 |'))
    expect(sourceBlock).toBeDefined()
    expect(sourceBlock!.html).not.toContain('<table>')
  })

  it('完好引用表与顶层表不受回退判定影响', () => {
    const intact = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n\n后文'
    // 引用表在 reading 是 blockquote 块（表嵌其内），顶层表是 table 块
    const quote = splitReadingBlocks(intact).find((b) => b.kind === 'blockquote')
    expect(quote).toBeDefined()
    const el = createReadingBlockElement(quote!, intact)
    expect(el.querySelectorAll('th')).toHaveLength(2)
    expect(el.querySelectorAll('td')).toHaveLength(2)
    const top = '前文\n\n| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n\n后文'
    const topTable = splitReadingBlocks(top).find((b) => b.kind === 'table')
    expect(topTable).toBeDefined()
    expect(createReadingBlockElement(topTable!, top).querySelectorAll('td'))
      .toHaveLength(2)
  })

  it('lazy 分隔行（合法形态）不触发回退', () => {
    const text = '> | 甲 | 乙 |\n| --- | --- |\n> | 丙 | 丁 |'
    // markdown-it 不认 lazy 分隔行（不成表）——该形态在 reading 天然为
    // 段落，不因回退判定产生额外 table 块
    expect(splitReadingBlocks(text).filter((b) => b.kind === 'table')).toHaveLength(0)
  })
})

describe('「块内表格渲染」设置：reading 容器表源文回退（#296 三轮）', () => {
  it('设置关闭：完好引用表也按源文呈现（与 live 退普通行同口径）', () => {
    const text = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n\n后文'
    const quote = splitReadingBlocks(text, { containerTableSource: false }).find((b) => b.kind === 'blockquote')
    expect(quote).toBeDefined()
    const el = createReadingBlockElement(quote!, text)
    expect(el.querySelectorAll('th, td')).toHaveLength(0)
    expect(el.textContent).toContain('| 甲 | 乙 |')
  })

  it('设置关闭：列表内表格同样回退源文；顶层表不受影响', () => {
    const text = '前文\n\n- | 甲 | 乙 |\n  | --- | --- |\n  | 丙 | 丁 |\n\n| 顶 | 层 |\n| --- | --- |\n| a | b |\n\n后文'
    const blocks = splitReadingBlocks(text, { containerTableSource: false })
    const list = blocks.find((b) => b.kind === 'list')
    expect(list).toBeDefined()
    const listEl = createReadingBlockElement(list!, text)
    expect(listEl.querySelectorAll('th, td')).toHaveLength(0)
    expect(listEl.textContent).toContain('| 甲 | 乙 |')
    const top = blocks.find((b) => b.kind === 'table')
    expect(top).toBeDefined()
    expect(createReadingBlockElement(top!, text).querySelectorAll('td')).toHaveLength(2)
  })

  it('设置缺省（true）：容器表照常渲染，行为与设置项落地前一致', () => {
    const text = '前文\n\n> | 甲 | 乙 |\n> | --- | --- |\n> | 丙 | 丁 |\n\n后文'
    const quote = splitReadingBlocks(text).find((b) => b.kind === 'blockquote')
    expect(createReadingBlockElement(quote!, text).querySelectorAll('th')).toHaveLength(2)
  })
})
