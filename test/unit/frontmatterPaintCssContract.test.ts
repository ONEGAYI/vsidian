// frontmatter 表格卡片绘制 CSS 契约（#140 Popover 改版）：真实宿主的
// computed style 与命中测试验证实际呈现，此处钉住对应源规则，防止样式
// 表被误删或只剩 DOM 类名而探针失效（tablePaintCssContract 同模式）。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('frontmatter 表格卡片 CSS 契约（#140 Popover 改版）', () => {
  it('键值行按两列网格绘制；卡片行承载边框与背景且不因别名桥降透明', () => {
    expect(rule('.cm-scroller .vsidian-fm-row')).toMatch(/display:\s*grid/)
    expect(rule('.cm-scroller .vsidian-fm-row')).toMatch(/grid-template-columns:\s*minmax\(120px,\s*32%\)\s*1fr/)
    const card = rule('.cm-line.vsidian-fm-card-line')
    expect(card).toMatch(/opacity:\s*1/)
    expect(card).toMatch(/border-left:\s*1px solid var\(--vscode-panel-border/)
    expect(card).toMatch(/border-right:\s*1px solid var\(--vscode-panel-border/)
  })

  it('格无边框无行间分隔（行区干净，靠卡片边框与标题栏微亮条分界）；键名弱化 + 类型图标', () => {
    const cell = rule('.cm-scroller .vsidian-fm-row > .vsidian-fm-cell')
    expect(cell).toMatch(/border:\s*0/)
    expect(cell).not.toMatch(/border-top:\s*1px/)
    expect(cell).toMatch(/white-space:\s*pre-wrap/)
    expect(cell).not.toMatch(/display:\s*none/)
    const key = rule('.cm-scroller .vsidian-fm-row > .vsidian-fm-key')
    expect(key).toMatch(/font-weight:\s*normal/)
    expect(key).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
    // 验收二轮：参考图键名亮度 ≈ 值的 45%，descriptionForeground 之上再压一档
    expect(key).toMatch(/opacity:\s*0\.7/)
    expect(key).not.toMatch(/background:\s*var\(--vsidian-table-background/)
    // 键名类型图标：标量 T / 数组宿主行列表形（参考图行首图标）
    expect(rule('.cm-scroller .vsidian-fm-row > .vsidian-fm-key::before')).toMatch(/content:\s*'T'/)
    expect(rule('.cm-scroller .vsidian-fm-row.vsidian-fm-list-row > .vsidian-fm-key::before')).toMatch(/content:\s*'≡'/)
  })

  it('观感二轮修复：行级 grid 不限宽（防右侧空洞）、行区透明、标题栏 buffer 隐藏 + 微亮条', () => {
    // 限宽曾把行级背景/边框收窄到 880px，与头部行（撑满）错位，右侧形成
    // 编辑器底色空洞 + 右边框断裂（真机验收图实测）——行级 grid 必须撑满
    expect(rule('.cm-scroller .vsidian-fm-row')).not.toMatch(/width:\s*min\(/)
    const card = rule('.cm-line.vsidian-fm-card-line')
    // 撞色边界感 = 边框 + 标题栏微亮条，行区不铺底色（参考图形态）
    expect(card).toMatch(/background:\s*none/)
    // 标题栏行 inline widget 的前后 buffer 各占一行文字高（头部行被撑到
    // 1.7 倍正文行高），成型态光标不进头区，停靠点隐藏
    expect(rule('.vsidian-fm-card-edge-top .cm-widgetBuffer')).toMatch(/display:\s*none/)
    // 标题栏微亮条（与行区透明的对比来源）
    expect(rule('#app .vsidian-fm-header')).toMatch(/background:\s*var\(--vsidian-table-background/)
  })

  it('标题栏与修改按钮：图标标题灰、600 字重标题、圆角描边按钮 hover 高亮', () => {
    const header = rule('#app .vsidian-fm-header')
    expect(header).toMatch(/display:\s*flex/)
    expect(header).toMatch(/font-family:\s*var\(--vscode-font-family/)
    expect(rule('#app .vsidian-fm-header-title')).toMatch(/font-weight:\s*600/)
    const edit = rule('#app button.vsidian-fm-edit')
    expect(edit).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(edit).toMatch(/border-radius:\s*6px/)
    // hover 与键盘聚焦兜底共用一块高亮规则
    expect(rule('#app button.vsidian-fm-edit:focus-visible')).toMatch(/background:\s*var\(--vscode-toolbar-hoverBackground/)
  })

  it('冒号与行内注释在绘制层隐藏（不占格位）；独立注释行淡化不隐藏', () => {
    expect(rule('.vsidian-fm-sep')).toMatch(/display:\s*none/)
    expect(rule('.vsidian-fm-comment')).toMatch(/display:\s*none/)
    expect(rule('.vsidian-fm-comment-line')).toMatch(/opacity:\s*0\.45/)
    expect(rule('.vsidian-fm-comment-line')).not.toMatch(/display:\s*none/)
  })

  it('阅读侧同款表格：容器外框圆角、整宽透明、键名弱化 + 图标、占位键列隐藏、空态在场', () => {
    const table = rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-table')
    expect(table).toMatch(/border:\s*1px solid/)
    expect(table).toMatch(/border-radius:\s*6px/)
    expect(table).toMatch(/overflow:\s*hidden/)
    // 观感二轮同款：不限宽、行区透明
    expect(table).toMatch(/width:\s*100%/)
    expect(table).toMatch(/background:\s*none/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-row'))
      .toMatch(/display:\s*grid/)
    const readingKey = rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-key')
    expect(readingKey).toMatch(/font-weight:\s*normal/)
    expect(readingKey).toMatch(/opacity:\s*0\.7/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-key::before'))
      .toMatch(/content:\s*'T'/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-row.vsidian-fm-list-row > .vsidian-fm-key::before'))
      .toMatch(/content:\s*'≡'/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-key-placeholder'))
      .toMatch(/visibility:\s*hidden/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-empty'))
      .toMatch(/padding:\s*4px 12px/)
  })

  it('Popover 浮层：fixed 贴按钮、白底圆角投影；输入框聚焦描边、主按钮主色', () => {
    const popover = rule('.vsidian-fm-popover')
    expect(popover).toMatch(/position:\s*fixed/)
    expect(popover).toMatch(/border-radius:\s*10px/)
    expect(popover).toMatch(/box-shadow:/)
    expect(rule('.vsidian-fm-pop-input:focus')).toMatch(/outline:\s*1px solid var\(--vscode-focusBorder/)
    expect(rule('.vsidian-fm-pop-add')).toMatch(/background:\s*var\(--vscode-button-background/)
    expect(rule('.vsidian-fm-pop-footer')).toMatch(/justify-content:\s*flex-end/)
    // 退役控件样式不得残留（格内编辑时代的行内按钮）
    expect(css).not.toMatch(/\.vsidian-fm-remove/)
    expect(css).not.toMatch(/\.vsidian-fm-add-item/)
    expect(css).not.toMatch(/\.vsidian-fm-add-entry/)
    expect(css).not.toMatch(/\.vsidian-fm-empty-value/)
  })
})
