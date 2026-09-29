// 表格绘制 CSS 契约：真实宿主的 computed style 与命中测试验证实际呈现，
// 此处钉住对应源规则，防止样式表被误删或只剩 DOM 类名而集成探针失效。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cssRuleExact } from './cssContract'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('表格网格与选中轮廓 CSS 契约（#42/#43）', () => {
  it('网格行按列宽计划绘制（内容比例分配），等分仅为缺省回退', () => {
    const row = rule('.vsidian-table-grid-row')
    expect(row).toMatch(/display:\s*grid/)
    // #142：优先消费行装饰内联的列宽计划（minmax 保底 + fr 占比）；
    // 计划缺失时（源码降级等）回退列数等分——等分不得再成为唯一列宽来源
    expect(row).toMatch(
      /grid-template-columns:\s*var\(--vsidian-table-col-widths,\s*repeat\(var\(--vsidian-table-columns\),\s*minmax\(0,\s*1fr\)\)\)/,
    )
    const cell = rule('.vsidian-table-grid-row > .cm-widgetBuffer + .vsidian-table-grid-cell')
    expect(cell).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(cell).toMatch(/white-space:\s*pre-wrap/)
    expect(cell).not.toMatch(/display:\s*none/)
  })

  it('格位外的行级子元素不参与 grid 放置（#150 视觉保障）', () => {
    // 格内 widget 与其 cm-widgetBuffer 嵌套在 cell span 内（DOM 结构由
    // tableCellWidget.test.ts 钉住）；行级残留的管道/测量缓冲/分隔符必须
    // 从绘制层排除，grid 自动放置只认 cell span，格位不再错乱。
    const hidden = rule('.vsidian-table-grid-delimiter', /display:\s*none/)
    expect(hidden).toContain('.vsidian-table-grid-row > .vsidian-table-pipe')
    expect(hidden).toContain('.vsidian-table-grid-row > .cm-widgetBuffer')
  })

  it('GFM 列对齐三态规则齐全（应用到该列全部单元格，空格占位同构）', () => {
    expect(rule('#app .cm-editor .cm-scroller .vsidian-table-grid-align-left', /text-align/))
      .toMatch(/text-align:\s*left/)
    expect(rule('#app .cm-editor .cm-scroller .vsidian-table-grid-align-center', /text-align/))
      .toMatch(/text-align:\s*center/)
    expect(rule('#app .cm-editor .cm-scroller .vsidian-table-grid-align-right', /text-align/))
      .toMatch(/text-align:\s*right/)
  })

  it('选中行外框及行列浅色高亮保留主题焦点色', () => {
    const row = rule('.vsidian-table-grid-row.vsidian-table-row-selected')
    expect(row).toMatch(/outline:\s*2px solid var\(--vscode-focusBorder/)
    expect(row).toMatch(/border-radius:\s*6px/)
    const fill = rule('.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-selected', /background:/)
    expect(fill).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--vscode-focusBorder/)
  })

  it('选中列两侧与首末端闭合为 2px 外轮廓', () => {
    const column = rule('.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-selected', /border-left:/)
    expect(column).toMatch(/border-left:\s*2px solid var\(--vscode-focusBorder/)
    expect(column).toMatch(/border-right:\s*2px solid var\(--vscode-focusBorder/)
    expect(rule('.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-first'))
      .toMatch(/border-top:\s*2px solid var\(--vscode-focusBorder/)
    expect(rule('.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-last'))
      .toMatch(/border-bottom:\s*2px solid var\(--vscode-focusBorder/)
  })

  it('抓手悬停时绘制出来', () => {
    expect(rule('.vsidian-table-controls button.vsidian-table-control-hover'))
      .toMatch(/opacity:\s*1/)
  })
})

describe('表格行背景透明契约（#213）', () => {
  it('数据行/分隔行背景走独立公开变量且默认透明（行级规则不再引共享表底变量）', () => {
    // 行级规则对表头/分隔/数据行通用；改走 --vsidian-table-row-background 后
    // 数据行与分隔行透明到编辑器背景（向阅读侧 td 对齐）
    const line = rule('.vsidian-table-line')
    expect(line).toMatch(/background-color:\s*var\(--vsidian-table-row-background,\s*transparent\)/)
    expect(line).not.toMatch(/--vsidian-table-background/)
  })

  it('行背景变量定义于 #app 层且默认 transparent，全文件定义唯一', () => {
    // 定义点参考 --vsidian-table-background 的 #app 层模式（无 Obsidian
    // 单一对应变量，不接别名桥；exact 取 #app 本体避免亮色分支干扰）
    const app = cssRuleExact(css, '#app')
    expect(app).toMatch(/--vsidian-table-row-background:\s*transparent;/)
    const defs = css.match(/--vsidian-table-row-background:\s*[^;]+;/g) ?? []
    expect(defs).toHaveLength(1)
  })

  it('表头保留：live 表头格与阅读 th 底色仍走共享变量 --vsidian-table-background', () => {
    const headerCell = rule(
      '.vsidian-table-grid-row.vsidian-table-header-line > .vsidian-table-grid-cell',
      /background:/,
    )
    expect(headerCell).toMatch(/background:\s*var\(--vsidian-table-background/)
    const readingTh = rule('.vsidian-reading-table th')
    expect(readingTh).toMatch(/background-color:\s*var\(--vsidian-table-background/)
    // 阅读 td 无背景（透明），阅读侧零改动
    const readingTd = rule('.vsidian-reading-table td', /font-family/)
    expect(readingTd).not.toMatch(/background/)
  })
})
