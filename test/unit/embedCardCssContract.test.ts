// 嵌入卡片 CSS 契约（#222）：钉住 main.css 的卡片壳/边条/限高/占位行/
// 只读 checkbox 源规则，防止样式表被误删或只剩 DOM 类名（hoverPopupCssContract
// 同模式）。真实 computed style、限高滚动与视口回收在 test/browser
// readingEmbed 套件验证。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')
  .replace(/\r\n/g, '\n')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('嵌入卡片 CSS 契约（#222；#223 起卡片壳规则并列 Live 宿主）', () => {
  it('卡片壳：只保留左引用竖条（#217 验收反馈——无底色/无边框/无圆角，与 Reading 正文观感对齐）', () => {
    // #223 两选择器并列（Reading 块 + Live widget 宿主同款绘制）；组以
    // Live 选择器置尾，断言组文本同时包含两侧选择器
    const card = rule('#app .cm-editor .cm-content .vsidian-live-embed .vsidian-embed-card')
    expect(card).toMatch(/border-left:\s*3px solid var\(--vsidian-quote-bar-color\)/)
    // 验收反馈改版：整圈边框取消（border: none 后仅左边条重立）、底色透明、
    // 圆角规则不再发射（默认直角）
    expect(card).toMatch(/border:\s*none/)
    expect(card).toMatch(/background-color:\s*transparent/)
    expect(card).not.toMatch(/border-radius/)
    expect(card.split('{')[0])
      .toContain('#app .vsidian-view-reading .vsidian-reading-embed .vsidian-embed-card')
  })

  it('Live 嵌套 Reading 容器重置 white-space（#217 验收反馈：行距对齐）', () => {
    // CM6 .cm-content 的 white-space: pre 级联会把块 innerHTML 尾部换行
    // 渲染成幽灵行盒（每块撑高约一行、列表逐项翻倍——浏览器实测）；
    // 嵌套容器重置回 normal
    const nested = rule('#app .cm-editor .cm-content .vsidian-live-embed .vsidian-view-reading')
    expect(nested).toMatch(/white-space:\s*normal/)
  })

  it('顶部栏无底色（#217 验收反馈：融入白底，保留下分隔线区分文件名）', () => {
    const header = rule('#app .vsidian-embed-card .vsidian-embed-card-header')
    expect(header).not.toMatch(/background/)
    expect(header).toMatch(/border-bottom:/)
  })

  it('#223 Live 下方形态宿主：块级呈现（显形态源文行下方的独立块）', () => {
    const below = rule('#app .cm-editor .cm-content .vsidian-live-embed-below')
    expect(below).toMatch(/display:\s*block/)
  })

  it('顶部栏与文件名：横排布局（标题居左、入口居右）、文件名走描述色', () => {
    const header = rule('#app .vsidian-embed-card .vsidian-embed-card-header')
    expect(header).toMatch(/display:\s*flex/)
    expect(header).toMatch(/justify-content:\s*space-between/)
    const title = rule('#app .vsidian-embed-card .vsidian-embed-card-title')
    expect(title).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
  })

  it('内容滚动区内 Reading 容器贴边微收（嵌套正文不贴卡片边缘）', () => {
    const nested = rule('#app .vsidian-embed-card .vsidian-embed-card-scroll .vsidian-view-reading')
    expect(nested).toMatch(/padding:/)
  })

  it('右上角打开入口：图标按钮尺寸与 hover/focus 可见反馈', () => {
    const open = rule('#app .vsidian-embed-card .vsidian-embed-card-open')
    expect(open).toMatch(/cursor:\s*pointer/)
    const hover = rule(
      '#app .vsidian-embed-card .vsidian-embed-card-open:hover,\n#app .vsidian-embed-card .vsidian-embed-card-open:focus-visible',
    )
    expect(hover).toMatch(/border-color:/)
  })

  it('内容滚动区：限高缺省 480 与内部滚动（长内容不撑破正文流）', () => {
    const scroll = rule('#app .vsidian-embed-card .vsidian-embed-card-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
    expect(scroll).toMatch(/max-height:\s*480px/)
  })

  it('就地状态行：在场绘制文案（loading/错误分态不隐藏整个卡片）', () => {
    const state = rule('#app .vsidian-embed-card .vsidian-embed-card-state')
    expect(state).not.toMatch(/display:\s*none/)
    expect(state).toMatch(/padding/)
    expect(state).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
  })

  it('只读契约：卡片内任务 checkbox 不响应指针（与悬停浮层同款并列规则）', () => {
    // 并列组以既有浮层选择器置尾（hoverPopupCssContract 的 endsWith 契约
    // 零改动通过）；嵌入作用域在组首，按组文本包含断言
    const box = rule('.vsidian-hover-popup input\[type="checkbox"\]')
    expect(box).toMatch(/pointer-events:\s*none/)
    expect(box.split('{')[0]).toContain('.vsidian-embed-card input[type="checkbox"]')
  })

  it('属性区折叠规则覆盖嵌入卡片作用域（fm 折叠键规则在卡片内同样生效）', () => {
    const collapsedRow = rule('#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row')
    expect(collapsedRow).toMatch(/display:\s*none/)
    expect(collapsedRow.split('{')[0])
      .toContain('#app .vsidian-embed-card .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row')
    const toggle = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle')
    expect(toggle).toMatch(/opacity:\s*0/)
    expect(toggle).toMatch(/pointer-events:\s*none/)
    expect(toggle.split('{')[0]).toContain('.vsidian-embed-card .vsidian-hover-fm-toggle')
  })
})

describe('错误分态样式区分（验收反馈）', () => {
  it('卡片错误状态行挂错误修饰类：主题错误色（与 loading 描述色区分）', () => {
    const error = rule('#app .vsidian-embed-card .vsidian-embed-card-state-error')
    expect(error).toMatch(/color:\s*var\(--vscode-errorForeground/)
  })
})

describe('Live 隐形态呈现（验收反馈：不留隐形源码行）', () => {
  it('宿主块级化 + 零高块级化 inline replace 前后的 cm-widgetBuffer（垂直导航坐标锚）', () => {
    const host = rule('#app .cm-editor .cm-content .vsidian-live-embed')
    expect(host).toMatch(/display:\s*block/)
    // buffer 零高块级化是一条双选择器组规则（前后 buffer 各一）：不能
    // display:none——完全摘除布局盒会破坏 CM6 行内块坐标锚（posAtCoords
    // 垂直探测在区间尾拿不到 rect 直接跳过整块，方向键从上向下越过嵌入
    // 行）；零高块级保留布局盒且不占行位，观感与隐藏等同（验收反馈实测）
    const hasLeading = /#app \.cm-editor \.cm-content \.cm-line > \.cm-widgetBuffer:has\(\+ \.vsidian-live-embed\),\s*\n#app \.cm-editor \.cm-content \.cm-line > \.vsidian-live-embed \+ \.cm-widgetBuffer\s*\{\s*\n\s*display:\s*block;\s*\n\s*height:\s*0;\s*\n\}/
    expect(css.match(hasLeading), 'buffer 前后零高块级化组规则应在场').not.toBeNull()
  })

  it('Live 宿主间距 padding 化 + 卡片壳 margin 清零（高度记账与渲染一致）', () => {
    // 卡片壳 margin 折叠出行盒，CM6 高度记账（行号 gutter/视口测算依据）
    // 不含它——每卡漏记上下 margin 合量导致行号错位逐卡累积（验收反馈
    // 实测）；间距由宿主 padding 承担（计入盒子高，记账与渲染一致）
    const host = rule('#app .cm-editor .cm-content .vsidian-live-embed')
    expect(host).toMatch(/padding:\s*7px 0/)
    const card = rule('#app .cm-editor .cm-content .vsidian-live-embed > .vsidian-embed-card')
    expect(card).toMatch(/margin:\s*0/)
  })
})

describe('#248 表格格内嵌入 CSS 契约（格容器下的宿主与缓冲形态）', () => {
  it('Reading 表格 td/th 内流内宿主：宽度受限（不撑破列/挤邻格）', () => {
    const host = rule('#app .vsidian-view-reading table th .vsidian-reading-embed-mixed')
    expect(host).toMatch(/max-width:\s*100%/)
    expect(host.split('{')[0])
      .toContain('#app .vsidian-view-reading table td .vsidian-reading-embed-mixed')
  })

  it('Live 网格格内紧邻嵌入宿主的 cm-widgetBuffer 零高块级化（其余 widget 的坐标锚不动）', () => {
    // 组规则以末尾选择器（后侧 buffer）定位，断言同时覆盖前侧（:has 形态）
    const after = rule('#app .cm-editor .cm-scroller .vsidian-table-grid-row > .vsidian-table-grid-cell .vsidian-live-embed + .cm-widgetBuffer')
    expect(after).toMatch(/display:\s*block/)
    expect(after).toMatch(/height:\s*0/)
    expect(after.split('{')[0])
      .toContain('#app .cm-editor .cm-scroller .vsidian-table-grid-row > .vsidian-table-grid-cell .cm-widgetBuffer:has(+ .vsidian-live-embed)')
  })

  it('Live 网格格内的嵌入宿主：宽度受限与收紧的上下内边距', () => {
    const host = rule('#app .cm-editor .cm-scroller .vsidian-table-grid-row > .vsidian-table-grid-cell .vsidian-live-embed')
    expect(host).toMatch(/max-width:\s*100%/)
    expect(host).toMatch(/padding:\s*3px 0/)
  })

  it('Live 网格格内的卡内容滚动区：横向内层滚动（宽内容不撑破列）', () => {
    const scroll = rule('#app .cm-editor .cm-scroller .vsidian-table-grid-row > .vsidian-table-grid-cell .vsidian-live-embed .vsidian-embed-card-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
  })
})
