// 悬停预览浮层 CSS 契约（#218）：钉住 main.css 对应源规则，防止样式表
// 被误删或只剩 DOM 类名（frontmatterPaintCssContract 同模式）。真实
// computed style 与四边避障在 test/browser hoverPreview 套件验证。
// #220 扩展：浮层挂 #app（主题变量与正文样式天然命中）+ 笔记属性区
// （hover-fm-section）折叠/热区/键盘聚焦规则。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')
  .replace(/\r\n/g, '\n')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  // 匹配两级（#338 扩展）：整头 endsWith（旧路径——单选择器块，以及以
  // 完整分组头为 selector 的断言）；段级 endsWith（新路径——分组选择器
  // 浮层与嵌入卡双作用域并列时，两侧段各取所需）。段级对旧单选择器块
  // 与整头匹配等价（尾段即整头），唯一性语义不变（命中至多一处）
  const found = blocks.filter((block) => {
    const head = block.split('{')[0]!
    const headMatches = head.trim().endsWith(selector) ||
      head.split(',').some((part) => part.trim().endsWith(selector))
    return headMatches && (declaration === undefined || declaration.test(block.split('{')[1] ?? ''))
  })
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('悬停预览浮层 CSS 契约（#218）', () => {
  it('浮层容器：fixed 定位、默认宽 480、最大高 400、实底与投影可辨识', () => {
    const popup = rule('#app > .vsidian-hover-popup')
    expect(popup).toMatch(/position:\s*fixed/)
    expect(popup).toMatch(/width:\s*480px/)
    expect(popup).toMatch(/max-height:\s*400px/)
    // 绘制层可见性：实底背景（非透明）+ 边框 + 投影
    expect(popup).toMatch(/background:\s*var\(--vscode-editor-background/)
    expect(popup).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(popup).toMatch(/box-shadow:/)
  })

  it('内容滚动区：overflow 滚动承载（移入保活可滚动）', () => {
    const scroll = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
  })

  it('标题条：嵌入卡片同款规则并列（横排布局 + 下分隔线；组文本含两侧选择器）', () => {
    // #217 验收跟进：header/title/open 三组规则浮层选择器置首、嵌入
    // 既有选择器置尾（两组测试的 endsWith 匹配各取所需——本侧以嵌入
    // 选择器取块再验 contains 浮层选择器）
    const header = rule('#app .vsidian-embed-card .vsidian-embed-card-header')
    expect(header).toMatch(/display:\s*flex/)
    expect(header).toMatch(/justify-content:\s*space-between/)
    expect(header).toMatch(/border-bottom:/)
    expect(header.split('{')[0])
      .toContain('#app > .vsidian-hover-popup .vsidian-hover-popup-header')
    const title = rule('#app .vsidian-embed-card .vsidian-embed-card-title')
    expect(title).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
    expect(title.split('{')[0])
      .toContain('#app > .vsidian-hover-popup .vsidian-hover-popup-title')
  })

  it('跳转按钮：图标按钮尺寸与 hover/focus 可见反馈（与嵌入打开入口同款并列）', () => {
    const open = rule('#app .vsidian-embed-card .vsidian-embed-card-open')
    expect(open).toMatch(/cursor:\s*pointer/)
    expect(open).toMatch(/width:\s*22px/)
    expect(open.split('{')[0])
      .toContain('#app > .vsidian-hover-popup .vsidian-hover-popup-open')
    const hover = rule(
      '#app > .vsidian-hover-popup .vsidian-hover-popup-open:hover,\n#app > .vsidian-hover-popup .vsidian-hover-popup-open:focus-visible,\n#app .vsidian-embed-card .vsidian-embed-card-open:hover,\n#app .vsidian-embed-card .vsidian-embed-card-open:focus-visible',
    )
    expect(hover).toMatch(/border-color:/)
  })

  it('就地状态行（loading/error）在场绘制，不使用 display:none 隐藏整个浮层', () => {
    const state = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-state')
    expect(state).not.toMatch(/display:\s*none/)
    expect(state).toMatch(/padding/)
  })

  it('内部 Reading 容器随主题排版（字体走正文变量族）', () => {
    const content = rule('.vsidian-hover-popup .vsidian-hover-popup-scroll .vsidian-view-reading')
    expect(content).toMatch(/font-family:\s*var\(--vsidian-content-font-family/)
    expect(content).toMatch(/font-size:\s*var\(--vsidian-content-font-size/)
  })

  it('内部 Reading 容器的紧凑留白覆盖带 #app 的正文规则', () => {
    const content = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-scroll .vsidian-view-reading')
    expect(content).toMatch(/padding:\s*10px 14px/)
  })

  it('任务禁写呈现：浮层内 checkbox 不响应指针（只读契约的样式侧）', () => {
    const box = rule('.vsidian-hover-popup input\[type="checkbox"\]')
    expect(box).toMatch(/pointer-events:\s*none/)
  })
})

describe('悬停 PDF 内容视图 CSS 契约（#337 hover-pdf-view；#338 全文滚动扩展）', () => {
  it('PDF 容器在场承载页塔与页码行（紧凑内边距——浮层与嵌入卡双作用域）', () => {
    const root = rule('#app > .vsidian-hover-popup .vsidian-hover-pdf')
    expect(root).toMatch(/padding:\s*8px/)
    const cardRoot = rule('#app .vsidian-embed-card .vsidian-hover-pdf')
    expect(cardRoot).toMatch(/padding:\s*8px/)
  })

  it('窗口内页占位：内容宽内居中（#338 全文滚动的页池 DOM）', () => {
    const page = rule('#app > .vsidian-hover-popup .vsidian-hover-pdf-page')
    expect(page).toMatch(/display:\s*flex/)
    expect(page).toMatch(/justify-content:\s*center/)
    const cardPage = rule('#app .vsidian-embed-card .vsidian-hover-pdf-page')
    expect(cardPage).toMatch(/justify-content:\s*center/)
  })

  it('页面画布：块级呈现且不超容器内容宽（绘制面即显示面）', () => {
    const canvas = rule('#app > .vsidian-hover-popup .vsidian-hover-pdf-canvas')
    expect(canvas).toMatch(/display:\s*block/)
    expect(canvas).toMatch(/max-width:\s*100%/)
    const cardCanvas = rule('#app .vsidian-embed-card .vsidian-hover-pdf-canvas')
    expect(cardCanvas).toMatch(/max-width:\s*100%/)
  })

  it('页码信息行：sticky 固定滚动区底部、居中弱化反馈（#338 不随滚动走失）', () => {
    const info = rule('#app > .vsidian-hover-popup .vsidian-hover-pdf-page-info')
    expect(info).toMatch(/position:\s*sticky/)
    expect(info).toMatch(/bottom:\s*0/)
    expect(info).toMatch(/text-align:\s*center/)
    expect(info).toMatch(/opacity:\s*0\.85/)
    expect(info).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
    const cardInfo = rule('#app .vsidian-embed-card .vsidian-hover-pdf-page-info')
    expect(cardInfo).toMatch(/position:\s*sticky/)
  })
})

describe('悬停浮层笔记属性区 CSS 契约（#220）', () => {
  it('标题行是悬停热区（position:relative 承载绝对定位按钮）', () => {
    const header = rule('.vsidian-hover-popup .vsidian-hover-fm .vsidian-fm-header')
    expect(header).toMatch(/position:\s*relative/)
  })

  it('切换按钮默认透明不接指针（opacity/pointer-events，非整体隐藏——保留 Tab 可达）', () => {
    const btn = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle')
    expect(btn).toMatch(/opacity:\s*0/)
    expect(btn).toMatch(/pointer-events:\s*none/)
    expect(btn, '不得用整体隐藏类声明（会把按钮移出 Tab 序）').not.toMatch(/visibility:/)
  })

  it('悬停热区与键盘聚焦都显示按钮并接指针（:hover 标题行 + :focus-visible 按钮）', () => {
    const reveal = rule(
      '.vsidian-hover-popup .vsidian-hover-fm .vsidian-fm-header:hover .vsidian-hover-fm-toggle,\n.vsidian-hover-popup .vsidian-hover-fm-toggle:focus-visible',
      /pointer-events:\s*auto/,
    )
    expect(reveal).toMatch(/opacity:\s*1/)
  })

  it('键盘聚焦可见性带焦点轮廓（focus-visible outline）', () => {
    const focus = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle:focus-visible', /outline:/)
    expect(focus).toMatch(/outline:\s*1px solid/)
  })

  it('收起态隐藏属性行与降级源码块（display:none；标题行保留）', () => {
    const rows = rule(
      '#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row',
    )
    expect(rows).toMatch(/display:\s*none/)
    const pre = rule(
      '#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed > pre',
    )
    expect(pre).toMatch(/display:\s*none/)
  })

  it('chevron 收起态旋转（-90° 指向右 = 可展开）', () => {
    const chevron = rule('.vsidian-hover-popup .vsidian-hover-fm-collapsed .vsidian-hover-fm-toggle svg')
    expect(chevron).toMatch(/rotate\(-90deg\)/)
  })
})

describe('错误分态样式区分（验收反馈）', () => {
  it('错误状态行挂错误修饰类：主题错误色（与 loading 描述色区分）', () => {
    const error = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-state-error')
    expect(error).toMatch(/color:\s*var\(--vscode-errorForeground/)
  })
})

describe('P2-06 悬停浮窗根引用内部 Live CSS 契约（#283）', () => {
  it('头部动作组：右对齐成组（标题占剩余宽）', () => {
    const actions = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-actions')
    expect(actions).toMatch(/display:\s*inline-flex/)
    expect(actions).toMatch(/margin-left:\s*auto/)
  })

  it('保存/模式切换/关闭编辑入口：与跳转入口同款图标按钮（尺寸/指针/hover 反馈）', () => {
    const btn = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-close')
    expect(btn.split('{')[0])
      .toContain('#app > .vsidian-hover-popup .vsidian-hover-popup-save')
    expect(btn.split('{')[0])
      .toContain('#app > .vsidian-hover-popup .vsidian-hover-popup-mode')
    expect(btn).toMatch(/width:\s*22px/)
    expect(btn).toMatch(/cursor:\s*pointer/)
    const hover = rule(
      '#app > .vsidian-hover-popup .vsidian-hover-popup-save:hover,\n#app > .vsidian-hover-popup .vsidian-hover-popup-save:focus-visible,\n#app > .vsidian-hover-popup .vsidian-hover-popup-mode:hover,\n#app > .vsidian-hover-popup .vsidian-hover-popup-mode:focus-visible,\n#app > .vsidian-hover-popup .vsidian-hover-popup-close:hover,\n#app > .vsidian-hover-popup .vsidian-hover-popup-close:focus-visible',
    )
    expect(hover).toMatch(/border-color:/)
  })

  it('未保存圆点：警示色加重（紧随目标显示名，绘制层可见）', () => {
    const dot = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-dirty')
    expect(dot).toMatch(/font-weight:\s*700/)
    expect(dot).toMatch(/color:\s*var\(--vscode-editorWarning-foreground/)
  })

  it('内部 Live 编辑器容器：不外滚（滚动由 CM6 自身 scroller 承担）', () => {
    const live = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-live')
    expect(live).toMatch(/overflow:\s*hidden/)
    const editor = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-live .cm-editor')
    expect(editor).toMatch(/max-height:\s*100%/)
  })
})

// ---- #342（P3-10）外链卡片（web 通道）：卡片结构四规则 ----
describe('外链卡片 CSS 契约（#342）', () => {
  it('卡片容器：纵向行距组织（挂在浮层 Reading 容器内，正文留白复用）', () => {
    const card = rule('#app > .vsidian-hover-popup .vsidian-hover-web-card')
    expect(card).toMatch(/display:\s*flex/)
    expect(card).toMatch(/flex-direction:\s*column/)
    expect(card).toMatch(/gap:\s*8px/)
  })

  it('标题：加粗 + 主题前景色 + 长词折行（标题缺席时 JS 以域名兜底）', () => {
    const title = rule('#app > .vsidian-hover-popup .vsidian-hover-web-title')
    expect(title).toMatch(/font-weight:\s*600/)
    expect(title).toMatch(/color:\s*var\(--vscode-editor-foreground/)
    expect(title).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('摘要：描述色次级文字 + 折行（textContent 赋值，无 HTML 注入面）', () => {
    const desc = rule('#app > .vsidian-hover-popup .vsidian-hover-web-desc')
    expect(desc).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
    expect(desc).toMatch(/line-height:\s*1\.5/)
    expect(desc).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('域名链接：主题链接色 + hover/focus 下划线（显式安全链接可点性）', () => {
    const domain = rule('#app > .vsidian-hover-popup .vsidian-hover-web-domain')
    expect(domain).toMatch(/color:\s*var\(--vscode-textLink-foreground/)
    expect(domain).toMatch(/text-decoration:\s*none/)
    // hover/focus-visible 并列组（组文本含两态选择器；尾选择器驱动匹配）
    const hover = rule('#app > .vsidian-hover-popup .vsidian-hover-web-domain:focus-visible')
    expect(hover).toMatch(/text-decoration:\s*underline/)
    expect(hover.split('{')[0]).toContain('.vsidian-hover-web-domain:hover')
  })
})

// ---- #343（P3-11）外链原网页视图（web 通道 page 形态）----
describe('外链原网页视图 CSS 契约（#343）', () => {
  it('页面容器：纵向布局（工具行 / iframe / 说明行的组织）', () => {
    const page = rule('#app > .vsidian-hover-popup .vsidian-hover-web-page')
    expect(page).toMatch(/display:\s*flex/)
    expect(page).toMatch(/flex-direction:\s*column/)
  })

  it('退回卡片按钮：主题链接色 + 边框 + hover/focus 反馈（可点性）', () => {
    const btn = rule('#app > .vsidian-hover-popup .vsidian-hover-web-fallback')
    expect(btn).toMatch(/color:\s*var\(--vscode-textLink-foreground/)
    expect(btn).toMatch(/border:\s*1px solid/)
    expect(btn).toMatch(/cursor:\s*pointer/)
    const hover = rule('#app > .vsidian-hover-popup .vsidian-hover-web-fallback:focus-visible')
    expect(hover).toMatch(/background:/)
    expect(hover.split('{')[0]).toContain('.vsidian-hover-web-fallback:hover')
  })

  it('iframe：100% 宽固定视口高 + 主题背景 + 边框（可见的页面视口区域）', () => {
    const frame = rule('#app > .vsidian-hover-popup .vsidian-hover-web-frame')
    expect(frame).toMatch(/width:\s*100%/)
    expect(frame).toMatch(/height:\s*320px/)
    expect(frame).toMatch(/background:\s*var\(--vscode-editor-background/)
    expect(frame).toMatch(/border:\s*1px solid/)
  })

  it('诚实说明行：描述色次级小字 + 折行', () => {
    const note = rule('#app > .vsidian-hover-popup .vsidian-hover-web-note')
    expect(note).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
    expect(note).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('自动退回原因行：主题错误色（明暗/高对比下实际可见的失败说明）', () => {
    const reason = rule('#app > .vsidian-hover-popup .vsidian-hover-web-reason')
    expect(reason).toMatch(/color:\s*var\(--vscode-errorForeground/)
    expect(reason).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
