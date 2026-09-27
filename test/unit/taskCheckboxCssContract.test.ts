// @vitest-environment jsdom
// 任务 checkbox 呈现契约（钉子测试，#121 验收修复）：main.css 的
// checkbox 盒与对勾规则是任务列表符号呈现的单一事实源——盒尺寸、
// 「右缘→正文」空隙公式（对齐普通列表行圆点口径）、对勾盒内居中
// （绝对定位铺满 + flex 双向居中，✓ 字形基线不再锚点偏左下）。
// 本测试读 CSS 源文本钉住关键规则不被无意改动；jsdom 声明仅为与其
// 余 webview 契约测试同环境，自身只读文件、不触 DOM。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

/** 提取唯一匹配（不匹配或多次匹配直接失败，提示维护点） */
function extractOne(label: string, pattern: RegExp): RegExpMatchArray {
  const matches = [...css.matchAll(pattern)]
  expect(
    matches.length,
    `main.css 中「${label}」应恰好出现一次（模式 ${String(pattern)}，实际 ${matches.length} 处）`,
  ).toBe(1)
  return matches[0]!
}

describe('任务 checkbox 呈现与 main.css 的一致', () => {
  it('盒形态：0.85em 方形、relative 定位（对勾绝对居中的包含块）', () => {
    const rule = extractOne('checkbox 盒规则', /\.vsidian-task-checkbox\s*\{[^}]*\}/g)
    expect(rule[0]).toMatch(/position:\s*relative/)
    expect(rule[0]).toMatch(/width:\s*0\.85em/)
    expect(rule[0]).toMatch(/height:\s*0\.85em/)
  })

  it('空隙公式：右缘→正文对齐普通行「圆点墨迹右缘→正文」（1ch 盒空白 + 7px - 0.25em 墨迹）', () => {
    const rule = extractOne('checkbox 盒规则', /\.vsidian-task-checkbox\s*\{[^}]*\}/g)
    expect(rule[0], '空隙应经 margin 表达且跨字号跟随（calc）').toMatch(
      /margin:\s*0\s+calc\(1ch \+ 7px - 0\.25em\)\s+0\s+0/,
    )
  })

  it('对勾盒内居中：绝对定位铺满 + flex 双向居中', () => {
    const rule = extractOne(
      '对勾规则',
      /\.vsidian-task-checkbox:checked::after[\s\S]*?\}/g,
    )
    expect(rule[0], '对勾应以盒为包含块绝对定位铺满').toMatch(/position:\s*absolute/)
    expect(rule[0]).toMatch(/inset:\s*0/)
    expect(rule[0], '水平垂直双向居中').toMatch(/align-items:\s*center/)
    expect(rule[0]).toMatch(/justify-content:\s*center/)
  })

  it('旧形态不回流：对勾不得回到基线对齐的 inline-block', () => {
    const rule = extractOne(
      '对勾规则',
      /\.vsidian-task-checkbox:checked::after[\s\S]*?\}/g,
    )
    expect(rule[0]).not.toMatch(/display:\s*inline-block/)
  })
})
