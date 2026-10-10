// 阅读态标题折叠 CSS 契约（#419）：阅读侧箭头/省略号的观感规则与零布局
// 位移硬约束静态钉住——styleContract 的 heading-fold 类目阅读条目
// （fold-arrow-reading / fold-collapsed-reading / fold-ellipsis-reading）
// verification 声明的核实途径之一（绘制层断言归浏览器套件 headingFoldReading）。
// 断言 main.css：
// - 观感与 Live 折叠同源：规则引用同一 --vsidian-fold-* 变量族；
// - 箭头绝对定位伸入容器 padding 留白带（不触发布局、不越容器滚动缘）
//   + 默认隐藏 + 标题块 hover 显现 + 折叠态常显；
// - 省略号行内形态（追加不推标题文本）。
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

describe('阅读态标题折叠 CSS 契约（#419）', () => {
  it('箭头按钮绝对定位脱流 + 默认隐藏 + Live 同源变量（零布局位移硬约束）', () => {
    const block = ruleBlock('.vsidian-view-reading .vsidian-reading-fold-arrow {')
    expect(block).not.toBe('')
    expect(block).toContain('position: absolute')
    // 伸入容器 padding 留白带（不越滚动缘：right:100% 相对标题元素向左伸出）
    expect(block).toContain('right: 100%')
    // 显隐用 visibility（不触发布局；对齐 Live gutter 箭头同款约定）
    expect(block).toContain('visibility: hidden')
    expect(block).toContain('var(--vsidian-fold-arrow-width)')
    expect(block).toContain('var(--vsidian-fold-arrow-color)')
  })

  it('标题块 hover 显现 + 折叠态常显（显现策略：hover 或折叠修饰二选一可见）', () => {
    const hover = ruleBlock('.vsidian-view-reading .vsidian-reading-block:hover .vsidian-reading-fold-arrow {')
    expect(hover).toContain('visibility: visible')
    const collapsed = ruleBlock(
      '.vsidian-view-reading .vsidian-reading-block.vsidian-reading-fold-collapsed .vsidian-reading-fold-arrow {',
    )
    expect(collapsed).toContain('visibility: visible')
  })

  it('折叠态箭头转向右（chevron 旋转，对齐 Live -collapsed 语义）', () => {
    const rotate = ruleBlock(
      '.vsidian-view-reading .vsidian-reading-block.vsidian-reading-fold-collapsed .vsidian-reading-fold-arrow svg {',
    )
    expect(rotate).toContain('rotate(-90deg)')
  })

  it('折叠标题元素为箭头定位上下文（foldTarget 块标记驱动 h1..h6 position）', () => {
    // 规则以选择器列表起始（h1..h6 六项），position 声明在首个 { 后
    const brace = css.indexOf('{', css.indexOf('vsidian-reading-fold-target > h1'))
    expect(brace).toBeGreaterThan(0)
    const block = css.slice(brace, css.indexOf('}', brace))
    expect(block).toContain('position: relative')
  })

  it('省略号行内形态 + Live 同源变量（追加不推标题文本）', () => {
    const block = ruleBlock('.vsidian-view-reading .vsidian-reading-fold-ellipsis {')
    expect(block).not.toBe('')
    expect(block).toContain('display: inline-block')
    expect(block).toContain('var(--vsidian-fold-ellipsis-color)')
    expect(block).toContain('cursor: pointer')
  })

  it('箭头命中桥：透明伪元素外扩铺桥（margin 视觉间隙不可命中的防回潮）', () => {
    // 评审 B1：箭头盒与标题左缘的 4px 间隙属 margin（不参与命中）——指针
    // 穿过间隙时块失 :hover、箭头回 hidden 且不可再命中，慢速移动点不到
    // 箭头。桥 = 透明 ::after 外扩；移除该规则即回归死区（多步移动断言
    // 归浏览器套件 headingFoldReading）
    const block = ruleBlock('.vsidian-view-reading .vsidian-reading-fold-arrow::after {')
    expect(block).not.toBe('')
    expect(block).toContain('position: absolute')
    // 四向外扩（右向外扩覆盖 margin 间隙是桥的本质；上下左提高命中容差）
    expect(block).toMatch(/inset:\s*-4px/)
  })
})
