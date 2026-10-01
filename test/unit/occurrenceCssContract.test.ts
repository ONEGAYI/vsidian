// 查找选项条绘制 CSS 契约（工单 #238）：jsdom 控制器测试（occurrence.test.ts）
// 断言类名切换（DOM 层），此处钉住 main.css 对应源规则——防止样式表被
// 误删或只剩 DOM 类名而选项条实际不可见（PR #37 P0 教训：样式注入失效
// 时 DOM 断言照样通过）。显隐对是纯 CSS 行为（无 JS 内联样式），规则缺
// 失即选项条常驻显示或永不显示，是本文件最重要的断言。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8').replace(/\r\n/g, '\n')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('查找选项条 CSS 契约（#238）', () => {
  it('选项条 open 态显隐对：默认 none，-open 类展开为 flex', () => {
    expect(rule('.vsidian-occurrence-bar', /display:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-occurrence-bar.vsidian-occurrence-bar-open', /display:\s*flex/)).toBeTruthy()
  })

  it('选项条为按钮留位（flex 行布局 + gap）', () => {
    expect(rule('.vsidian-occurrence-bar', /display:\s*none/)).toBeTruthy()
    const open = rule('.vsidian-occurrence-bar.vsidian-occurrence-bar-open')
    expect(open).toMatch(/display:\s*flex/)
  })

  it('三开关点亮规则覆盖 Aa/ab/.* 三类（与主面板同款点亮语言）', () => {
    const active = rule(
      '.vsidian-occurrence-bar .vsidian-occurrence-case-active,\n.vsidian-occurrence-bar .vsidian-occurrence-word-active,\n.vsidian-occurrence-bar .vsidian-occurrence-regexp-active')
    expect(active).toMatch(/background-color:\s*var\(--vscode-button-background/)
  })

  it('面板开关闪烁动画：flash 类引用 keyframes（连按重启的脉冲提示）', () => {
    expect(rule('.vsidian-find .vsidian-find-flash', /animation:\s*vsidian-find-flash/)).toBeTruthy()
    expect(css).toMatch(/@keyframes\s+vsidian-find-flash/)
  })

  it('选项条容器带 widget 边框与背景（VSCode 部件变量族）', () => {
    expect(rule('.vsidian-occurrence-bar', /background-color:\s*var\(--vscode-editorWidget-background/)).toBeTruthy()
  })
})
