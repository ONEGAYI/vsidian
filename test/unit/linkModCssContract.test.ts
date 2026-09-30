// 修饰键悬停反馈 CSS 契约（#217 验收反馈：Ctrl+悬停链接的可发现性）：
// body.vsidian-mod-link 状态类下，可跳转链接（双链/嵌入引用/普通链接，
// live mark 与渲染态 + Reading a）的 :hover 命中下划线与可点击光标。
import { describe, expect, it } from 'vitest'
import { cssRule, cssRuleBlocks, readMainCss } from './cssContract'

const css = readMainCss()

describe('修饰键悬停反馈（body.vsidian-mod-link）', () => {
  it('状态类下链接 hover 命中下划线 + 可点击光标（三选择器组：双链/普通链接/Reading a）', () => {
    const mod = cssRule(
      css,
      'body.vsidian-mod-link #app .vsidian-view-reading a:hover',
    )
    expect(mod).toMatch(/text-decoration:\s*underline/)
    expect(mod).toMatch(/cursor:\s*pointer/)
    // 组前两个选择器（live 双链类与普通链接类）在同组在场（cssRule 只回
    // 声明体——组选择器文本经 cssRuleBlocks 断言）
    const group = cssRuleBlocks(css).find(
      (b) => b.selector.endsWith('body.vsidian-mod-link #app .vsidian-view-reading a:hover'),
    )
    expect(group?.selector).toContain('body.vsidian-mod-link #app .cm-editor .cm-scroller .vsidian-wikilink:hover')
    expect(group?.selector).toContain('body.vsidian-mod-link #app .cm-editor .cm-scroller .vsidian-link:hover')
  })

  it('状态类规则只在修饰键态命中（无 :hover 常驻改写；渲染态常驻 pointer 规则不受影响）', () => {
    // 不存在脱离 .vsidian-mod-link 的链接 hover 下划线规则（常驻样式不被顺带扩大）
    const suspicious = cssRuleBlocks(css).filter(
      (b) =>
        b.selector.includes(':hover') &&
        (b.selector.includes('vsidian-wikilink') || b.selector.includes('vsidian-link')) &&
        /underline/.test(b.body) &&
        !b.selector.includes('vsidian-mod-link'),
    )
    expect(suspicious, '无修饰键态外的链接 hover 下划线规则').toEqual([])
  })
})
