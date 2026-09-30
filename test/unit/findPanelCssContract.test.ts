// 查找面板绘制 CSS 契约（工单 #236）：jsdom 控制器测试（find.test.ts）
// 断言的是类名切换（DOM 层），此处钉住 main.css 对应源规则——防止样式
// 表被误删或只剩 DOM 类名而面板实际不可用（PR #37 P0 教训：样式注入
// 失效时 DOM 断言照样通过）。替换行显隐是纯 CSS 行为（无 JS 内联样式），
// 规则缺失即替换栏常驻显示，故显隐对是本文件最重要的断言。
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

describe('查找面板 CSS 契约（#236）', () => {
  it('面板 open 态显隐：默认 none，open 类展开为 flex', () => {
    expect(rule('.vsidian-find', /display:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-find.vsidian-find-open', /display:\s*flex/)).toBeTruthy()
  })

  it('面板为 column 布局（toggle + 主行 + 替换行的三段结构前提）', () => {
    expect(rule('.vsidian-find', /flex-direction:\s*column/)).toBeTruthy()
  })

  it('替换行显隐对：默认收起（display:none），-open 类展开（display:flex）', () => {
    expect(rule('.vsidian-find .vsidian-find-replace', /display:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-replace.vsidian-find-replace-open', /display:\s*flex/)).toBeTruthy()
  })

  it('主行与替换行为左缘 toggle 让位（padding-left）', () => {
    expect(rule('.vsidian-find .vsidian-find-row', /padding-left:\s*20px/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-replace', /padding-left:\s*20px/)).toBeTruthy()
  })

  it('三开关激活态点亮规则覆盖 Aa/ab/.* 三类（合并选择器同款样式）', () => {
    const active = rule('.vsidian-find .vsidian-find-case-active,\n.vsidian-find .vsidian-find-word-active,\n.vsidian-find .vsidian-find-regexp-active')
    expect(active).toMatch(/background-color:\s*var\(--vscode-button-background/)
  })

  it('非法正则反馈：输入框 invalid 类红边（inputValidation 错误色）', () => {
    expect(rule('.vsidian-find .vsidian-find-input.vsidian-find-input-invalid', /border-color:\s*var\(--vscode-inputValidation-errorBorder/)).toBeTruthy()
  })

  it('替换栏展开切换箭头随 aria-expanded 翻转（180 度）', () => {
    expect(rule('.vsidian-find .vsidian-find-toggle[aria-expanded=\'true\']', /rotate\(180deg\)/)).toBeTruthy()
  })

  it('替换输入框与主输入框同款输入样式（合并选择器共用规则）', () => {
    expect(rule('.vsidian-find .vsidian-find-input,\n.vsidian-find .vsidian-find-replace-input', /background-color:\s*var\(--vscode-input-background/)).toBeTruthy()
  })
})
