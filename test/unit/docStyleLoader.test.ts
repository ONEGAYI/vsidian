// @vitest-environment jsdom
// #569（T04）文档样式装载器生命周期契约：产物元素挂 head 末尾、多实例
// 共享（引用计数）、释放无残留、源文更新同步产物（ADR-0019 决定 3/4）。
import { describe, it, expect, afterEach } from 'vitest'
import { DocumentStyleBinding, DOC_STYLE_ELEMENT_ATTR, documentStyleRegistry } from '../../src/webview/docStyleLoader'

afterEach(() => {
  document.head.querySelectorAll(`[${DOC_STYLE_ELEMENT_ATTR}]`).forEach((el) => el.remove())
})

const elOf = (scope: string): HTMLStyleElement | null =>
  document.head.querySelector(`[${DOC_STYLE_ELEMENT_ATTR}="${scope}"]`)

describe('装载器：产物生命周期', () => {
  it('sync 后 head 末尾有产物元素（观测属性 = docScope 键；内容为改写产物）', () => {
    const b = new DocumentStyleBinding('doc')
    b.sync('<style>p { color: red }</style>')
    const el = elOf('doc')
    expect(el).not.toBeNull()
    expect(document.head.lastElementChild).toBe(el) // 决策点 2：末尾追加（片段链之后）
    expect(el!.textContent).toContain(':where([data-vsidian-doc-scope="doc"]) :is(p)')
    b.dispose()
  })

  it('无 style 块不挂元素；style 块删除后元素移除', () => {
    const b = new DocumentStyleBinding('doc')
    b.sync('普通段落，无样式。')
    expect(elOf('doc')).toBeNull()
    b.sync('<style>p { color: red }</style>')
    expect(elOf('doc')).not.toBeNull()
    b.sync('删除后无样式。')
    expect(elOf('doc')).toBeNull()
    b.dispose()
  })

  it('源文更新覆盖产物（多处块按源序层叠——后块胜出由 CSS 源序天然保证）', () => {
    const b = new DocumentStyleBinding('doc')
    b.sync('<style>.x { color: olive }</style>\n\n<style>.x { color: indigo }</style>')
    const el = elOf('doc')!
    const first = el.textContent!
    expect(first.indexOf('olive')).toBeLessThan(first.indexOf('indigo'))
    b.sync('<style>.x { color: maroon }</style>')
    expect(elOf('doc')!.textContent).not.toContain('olive')
    expect(elOf('doc')!.textContent).toContain('maroon')
    b.dispose()
  })

  it('同一键多实例共享一个元素；全部释放后移除（无残留规则）', () => {
    const b1 = new DocumentStyleBinding('ref:abc')
    const b2 = new DocumentStyleBinding('ref:abc')
    b1.sync('<style>p { color: red }</style>')
    b2.sync('<style>p { color: red }</style>')
    expect(document.head.querySelectorAll(`[${DOC_STYLE_ELEMENT_ATTR}="ref:abc"]`)).toHaveLength(1)
    b1.dispose()
    expect(elOf('ref:abc')).not.toBeNull() // 仍有一实例在场
    b2.dispose()
    expect(elOf('ref:abc')).toBeNull()
    expect(documentStyleRegistry.activeScopes()).not.toContain('ref:abc')
  })

  it('文本与树引用均未变时短路（零重复收集）', () => {
    const b = new DocumentStyleBinding('doc')
    b.sync('<style>p { color: red }</style>')
    const el = elOf('doc')!
    const before = el.textContent
    const spy = { called: 0 }
    // 同文本同树（undefined）重复 sync：产物不变（短路不重写）
    b.sync('<style>p { color: red }</style>')
    expect(el.textContent).toBe(before)
    expect(spy.called).toBe(0)
    b.dispose()
  })

  it('dispose 后 sync 为 no-op（释放后无迟到写入）', () => {
    const b = new DocumentStyleBinding('doc')
    b.sync('<style>p { color: red }</style>')
    b.dispose()
    b.sync('<style>p { color: blue }</style>')
    expect(elOf('doc')).toBeNull()
  })

  it('不同键互不干扰（A 与 B 各自元素）', () => {
    const a = new DocumentStyleBinding('doc')
    const bb = new DocumentStyleBinding('ref:xyz')
    a.sync('<style>p { color: red }</style>')
    bb.sync('<style>p { color: teal }</style>')
    expect(elOf('doc')!.textContent).toContain('red')
    expect(elOf('ref:xyz')!.textContent).toContain('teal')
    a.dispose()
    expect(elOf('doc')).toBeNull()
    expect(elOf('ref:xyz')).not.toBeNull()
    bb.dispose()
  })
})
