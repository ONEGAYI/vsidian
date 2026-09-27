// Obsidian 变量别名桥 CSS 契约（#132）：main.css 的 vsidian 公开变量默认
// 定义必须保持「var(Obsidian 原名, 原默认值)」形态——变量桥被删除、别名
// 写错、或 fallback 被改掉都会在此失败（「变量作用域错误会失败」的守卫）。
// 期望值从 OBSIDIAN_VARIABLE_ALIASES 派生，不手写字面量。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { OBSIDIAN_VARIABLE_ALIASES } from '../../src/shared/styleContract'

const css = readFileSync(new URL('../../src/webview/main.css', import.meta.url), 'utf8')

describe('obsidianAliasCssContract：变量桥形态', () => {
  it('每个承诺的 vsidian 变量在 main.css 含 Obsidian 名 fallback 定义', () => {
    for (const { obsidian, vsidian, fallback } of OBSIDIAN_VARIABLE_ALIASES) {
      const expected = `${vsidian}: var(${obsidian}, ${fallback});`
      expect(css.includes(expected), `main.css 应含 ${expected}`).toBe(true)
    }
  })

  it('浅色主题覆盖同样保留 Obsidian fallback（--text-highlight-bg）', () => {
    const match = css.match(/body\.vscode-light #app \{[^}]*--vsidian-highlight-background: ([^;]+);/)
    expect(match, '浅色高亮覆盖块应存在').not.toBeNull()
    expect(match![1]).toBe('var(--text-highlight-bg, #ffe066)')
  })

  it('别名桥注释标记存在（防误删段落）', () => {
    expect(css.includes('#132 Obsidian 变量别名桥')).toBe(true)
  })

  it('定义次数守恒：深浅双定义的变量恰 2 处，其余恰 1 处', () => {
    for (const { vsidian } of OBSIDIAN_VARIABLE_ALIASES) {
      const count = css.split(`${vsidian}:`).length - 1
      // 高亮底色为深浅双定义（#app + body.vscode-light 分支），其余 1 处；
      // 出现第 3 处即重复定义冲突（后者覆盖前者，桥语义漂移）
      const expected = vsidian === '--vsidian-highlight-background' ? 2 : 1
      expect(count, `${vsidian} 定义次数`).toBe(expected)
    }
  })
})
