// 块级原生 HTML 的 CSS 契约（#567/T02）：Live 宿主与 Reading 块的关键
// 绘制规则钉在 CSS 源文本（样式契约 live-html-widget / reading-html-block
// 条目的规则形态防线——样式注入失效或规则误删时 computed 断言在 headless
// 下不可靠，规则形态钉住与 embedCardCssContract 同款纪律）：
// - Live 宿主块级化 + position:relative（chrome 定位上下文）
// - 悬停边框（focusBorder——ui-patterns §1.1 焦点强调档，不发明档位）
// - 前后 cm-widgetBuffer 零高块级化（键盘垂直导航坐标锚）
// - 按钮组常驻 flex + 宿主悬停/键盘焦点显隐
// - Reading 纯 <style> 块零占位（Q6A）
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('Live HTML 宿主绘制规则（live-html-widget 条目）', () => {
  it('宿主块级化 + 定位上下文（display:block + position:relative）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html')
    expect(rule).toMatch(/display:\s*block/)
    expect(rule).toMatch(/position:\s*relative/)
  })

  it('悬停边框取 focusBorder 主题变量（不硬编码色值）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html:hover')
    expect(rule).toMatch(/outline:\s*1px solid var\(--vscode-focusBorder\)/)
  })

  it('前后 cm-widgetBuffer 零高块级化（布局盒保留作坐标锚）', () => {
    // 两选择器共组一条规则（cssRule 按后缀匹配只取组尾选择器）——组尾
    // 查声明体，组首存在性钉在源文本
    const tail = cssRule(css, '#app .cm-editor .cm-content .cm-line > .vsidian-live-html + .cm-widgetBuffer')
    expect(tail).toMatch(/display:\s*block/)
    expect(tail).toMatch(/height:\s*0/)
    expect(css).toContain('.cm-line > .cm-widgetBuffer:has(+ .vsidian-live-html),')
  })

  it('按钮组常驻 flex；宿主悬停与键盘焦点两态显隐', () => {
    const group = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html > .vsidian-graphic-chrome')
    expect(group).toMatch(/display:\s*flex/)
    // 悬停与键盘焦点共组一条规则（后缀匹配取组尾，组首存在性钉源文本）
    const focus = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html > .vsidian-graphic-chrome button:focus-visible')
    expect(focus).toMatch(/opacity:\s*1/)
    expect(css).toContain('.vsidian-live-html:hover > .vsidian-graphic-chrome button,')
  })
})

describe('Reading HTML 块绘制规则（reading-html-block 条目）', () => {
  it('纯 <style> 块零占位（:empty 态 display:none）', () => {
    const rule = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-html:empty')
    expect(rule).toMatch(/display:\s*none/)
  })

  it('降级源码回退的等宽呈现（pre.vsidian-html-source-fallback）', () => {
    const rule = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-html .vsidian-html-source-fallback')
    expect(rule).toMatch(/font-family:\s*var\(--vscode-editor-font-family/)
  })
})

describe('#572（T07）Live iframe 命中接管（live-html-widget 条目的 frame/shield 子结构）', () => {
  it('wrapper 定位上下文（position:relative——shield 的 inset 参照）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html-frame')
    expect(rule).toMatch(/position:\s*relative/)
  })

  it('行内宿主内 wrapper inline-block（行内流不断行）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-inline-html-content .vsidian-live-html-frame')
    expect(rule).toMatch(/display:\s*inline-block/)
  })

  it('shield 全覆盖压顶（absolute + inset:0 + z-index——帧事件不冒泡的命中载体）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-html-frame-shield')
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/inset:\s*0/)
    expect(rule).toMatch(/z-index:\s*1/)
  })
})
