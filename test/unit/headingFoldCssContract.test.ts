// 标题折叠 UI CSS 契约（#414 T03）：箭头/省略号的观感规则与零布局位移
// 硬约束静态钉住——styleContract 的 heading-fold 类目条目 verification 声明
// 的核实途径之一（绘制层断言归浏览器套件 headingFoldUi）。断言 main.css：
// - 观感变量定义于 #app 块，箭头/省略号规则引用之；
// - 箭头绝对定位（不参与流内宽度分配）+ 默认隐藏 + 折叠态常显 + 悬停类显现；
// - 箭头列 overflow 放行（marker 伸出到行号列与正文间距）；
// - margin 迁移形态：--vsidian-ln-gap 间距挂行号列（行号关时正文回
//   --vsidian-content-padding-inline 基线，0 宽箭头列不占位）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../src/webview/main.css'), 'utf8')

/** 首个匹配选择器的规则块 */
function ruleBlock(selector: string): string {
  const at = css.indexOf(selector)
  if (at < 0) return ''
  return css.slice(at, css.indexOf('}', at))
}

describe('标题折叠 UI CSS 契约（#414 T03）', () => {
  it('观感变量定义于 #app 块（箭头双色/悬停色、箭头区宽、省略号观感）', () => {
    const appStart = css.indexOf('#app')
    const appEnd = css.indexOf('}', css.indexOf('{', appStart))
    const appBlock = css.slice(appStart, appEnd)
    for (const v of [
      '--vsidian-fold-arrow-color',
      '--vsidian-fold-arrow-hover-color',
      '--vsidian-fold-arrow-width',
      '--vsidian-fold-ellipsis-color',
    ]) {
      expect(appBlock.includes(`${v}:`), `${v} 应定义于 #app 块`).toBe(true)
    }
  })

  it('箭头按钮绝对定位脱流（零布局位移硬约束：不参与流内宽度分配）', () => {
    const block = ruleBlock('.vsidian-fold-arrow {')
    expect(block).not.toBe('')
    expect(block).toContain('position: absolute')
    // 显隐用 visibility（不用 display：display 切换若被误用为布局载体，
    // 契约可检出——absolute 下两者均零位移，但 visibility 保可访问树语义）
    expect(block).toContain('visibility: hidden')
    expect(block).toContain('var(--vsidian-fold-arrow-width)')
    expect(block).toContain('var(--vsidian-fold-arrow-color)')
  })

  it('折叠态常显 + 悬停武装显现（显现策略：hover 类或折叠修饰二选一可见）', () => {
    const collapsed = ruleBlock('.vsidian-fold-arrow-collapsed {')
    expect(collapsed).toContain('visibility: visible')
    const hover = ruleBlock('.vsidian-fold-hover')
    expect(hover).toContain('visibility: visible')
  })

  it('箭头列：overflow 放行（marker 伸出到行号列与正文间距，baseTheme 默认 hidden 会被覆盖）', () => {
    const gutter = ruleBlock('.vsidian-fold-gutter {')
    expect(gutter).toContain('overflow: visible')
    const cell = ruleBlock('.vsidian-fold-gutter .cm-gutterElement {')
    expect(cell).toContain('position: relative')
  })

  it('悬停色与省略号观感变量被规则引用', () => {
    const hover = ruleBlock('.vsidian-fold-arrow:hover {')
    expect(hover).toContain('var(--vsidian-fold-arrow-hover-color)')
    const ellipsis = ruleBlock('.vsidian-fold-ellipsis {')
    expect(ellipsis).toContain('var(--vsidian-fold-ellipsis-color)')
  })

  it('ln-gap 间距挂行号列而非 gutters 容器（行号关态正文回 padding 基线）', () => {
    const gutters = ruleBlock('#app .cm-editor .cm-scroller .cm-gutters {')
    expect(gutters.includes('margin-right')).toBe(false)
    const lineNumbers = ruleBlock('#app .cm-editor .cm-scroller .cm-lineNumbers {')
    expect(lineNumbers).toContain('margin-right: var(--vsidian-ln-gap)')
  })
})
