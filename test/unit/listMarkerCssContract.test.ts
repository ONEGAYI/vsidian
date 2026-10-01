// 列表点号 CSS 契约（双视图层级一致性修复）：Live 侧伪圆点按嵌套深度
// 分级（一级实心 •、二级空心 ◦、三级起方块 ▪），与阅读侧浏览器默认
// marker 语义（disc / circle / square）对齐；阅读侧显式钉住三级
// list-style-type，不再依赖 UA 默认样式表（容器被外部片段重置时语义
// 不漂移）。钉住源规则，防止样式表被误删或只剩行类而点号退化为全实心。
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

describe('列表点号层级样式（Live 伪圆点按深度分级）', () => {
  it('一级无序列表：实心圆点（基线规则，源码显形时抑制）', () => {
    const base = rule(
      '.vsidian-list-line.vsidian-list-bullet:not(.vsidian-list-marker-visible)::before',
      /content:\s*'•'/,
    )
    // 基线规则不得携带深度修饰（携带即二级也被吃成实心）
    expect(base).not.toMatch(/-d\d/)
  })

  it('二级无序列表：空心圆点（与阅读侧 circle marker 同语义）', () => {
    expect(rule('.vsidian-list-line-d2.vsidian-list-bullet:not(.vsidian-list-marker-visible)::before'))
      .toMatch(/content:\s*'◦'/)
  })

  it('三级及更深：实心方块（与阅读侧 square marker 同语义；深度类 d3–d8 全覆盖）', () => {
    for (const depth of [3, 4, 5, 6, 7, 8]) {
      expect(css).toMatch(
        new RegExp(`\\.vsidian-list-line-d${depth}\\.vsidian-list-bullet:not\\(\\.vsidian-list-marker-visible\\)::before`),
      )
    }
    // 方块规则集中声明（单一规则覆盖 d3–d8，不逐条散写）
    const square = rule('::before', /content:\s*'▪'/)
    for (const depth of [3, 4, 5, 6, 7, 8]) {
      expect(square).toContain(`.vsidian-list-line-d${depth}.`)
    }
  })
})

describe('列表点号层级样式（阅读侧显式钉住，不依赖 UA 默认）', () => {
  it('一级 disc / 二级 circle / 三级起 square（选择器逐级覆盖，深层恒 square）', () => {
    expect(rule('.vsidian-reading-block ul', /list-style-type:\s*disc/)).toBeTruthy()
    expect(rule('.vsidian-reading-block :is(ul, ol) ul', /list-style-type:\s*circle/)).toBeTruthy()
    expect(rule('.vsidian-reading-block :is(ul, ol) :is(ul, ol) ul', /list-style-type:\s*square/))
      .toBeTruthy()
  })
})
