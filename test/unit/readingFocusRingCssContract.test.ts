// 阅读容器焦点环 CSS 契约（#141 验收修复）：键盘快捷键（Ctrl+Q）切换
// 后对阅读容器的程序化聚焦紧随键盘事件，真机 Chromium 判定其匹配
// :focus-visible 而按 UA 规则 outline:auto 绘制默认焦点环（Windows/
// Electron 下呈黄色），围住整个视口且点击正文不消除。回归防线钉在
// CSS 源文本：浏览器层 headless 下 CDP 合成键盘不触发该启发式
// （viewToggle 套件实证：移除本规则 computed outlineStyle 仍为 none），
// computed 断言钉不住，须钉规则形态。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('阅读容器聚焦不绘制焦点环（#141 验收修复）', () => {
  it('#app .vsidian-view-reading:focus 显式 outline:none（压过 UA :focus-visible 默认环）', () => {
    const rule = cssRule(css, '#app .vsidian-view-reading:focus')
    expect(rule).toMatch(/outline:\s*none/)
  })

  it('规则特异性足够：容器规则本体保持公开入口可覆写', () => {
    // :focus 态规则与容器本体规则（公开入口）并存——本体不得被顺带改动
    const base = cssRule(css, '#app .vsidian-view-reading')
    expect(base).toMatch(/overflow-y:\s*auto/)
  })
})
