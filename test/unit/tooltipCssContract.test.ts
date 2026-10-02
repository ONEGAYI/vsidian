// 悬停提示 CSS 契约（#300）：公开变量的定义位置与消费关系静态钉住——
// styleContract 的 var-tooltip-* 条目 verification 声明的核实途径。断言
// tooltipCard.css 中：九变量全部定义于 #app 块、视觉变量被
// .vsidian-tooltip / .vsidian-tooltip-key 规则引用（show-delay 由控制器
// JS 读取，不进 CSS 规则）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, '../../src/webview/tooltipCard.css'), 'utf-8')

/** #app 变量定义块（文件首块，至首个闭合大括号） */
const appBlock = css.slice(css.indexOf('#app'), css.indexOf('}', css.indexOf('#app')))

const VISUAL_VARS = [
  '--vsidian-tooltip-background',
  '--vsidian-tooltip-foreground',
  '--vsidian-tooltip-border',
  '--vsidian-tooltip-radius',
  '--vsidian-tooltip-font-size',
  '--vsidian-tooltip-max-width',
  '--vsidian-tooltip-key-background',
  '--vsidian-tooltip-key-foreground',
] as const

describe('悬停提示 CSS 契约（#300）', () => {
  it('九个公开变量全部定义于 #app 块（编辑器与设置页同源继承）', () => {
    for (const v of [...VISUAL_VARS, '--vsidian-tooltip-show-delay']) {
      expect(appBlock.includes(`${v}:`), `${v} 应定义于 #app 块`).toBe(true)
    }
  })

  it('卡片规则引用全部视觉主变量，徽章规则引用徽章双色', () => {
    const cardBlock = css.slice(css.indexOf('.vsidian-tooltip {'), css.indexOf('}', css.indexOf('.vsidian-tooltip {')))
    for (const v of VISUAL_VARS.slice(0, 6)) {
      expect(cardBlock.includes(`var(${v})`), `.vsidian-tooltip 应引用 ${v}`).toBe(true)
    }
    const keyBlock = css.slice(css.indexOf('.vsidian-tooltip-key {'), css.indexOf('}', css.indexOf('.vsidian-tooltip-key {')))
    expect(keyBlock.includes('var(--vsidian-tooltip-key-background)')).toBe(true)
    expect(keyBlock.includes('var(--vsidian-tooltip-key-foreground)')).toBe(true)
  })

  it('主题分支缺席：明暗自适应由宿主变量族承担，文件无 vscode-light/dark 选择器', () => {
    expect(css).not.toMatch(/\.vscode-(light|dark|high-contrast)/)
  })
})
