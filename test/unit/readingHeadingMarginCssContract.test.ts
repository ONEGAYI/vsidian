// 阅读标题块水平盒契约（#206）：限宽档（#175）下块居中依赖
// .vsidian-reading-block 的 margin: 0 auto；heading-1..6 装饰类直接挂在
// 块 div 自身上，且规则在源序更靠后位置——若其 margin 简写含水平分量
// （margin-left/right 被置 0），同特异性下会覆盖 auto，标题贴左而正文
// 居中（限宽档标题与正文左缘错开）。契约：heading 规则的垂直间距一律走
// margin-block，不得声明任何水平盒声明；同时钉住块居中规则本身的 auto，
// 防双向回归。
//
// 正则覆盖矩阵（review-loops 第 1 轮发现 1/2 修正）：物理与逻辑属性的
// 水平全家族（-left/-right/-inline 及 -inline-start/-end）、裸简写
// （含水平分量）、大小写不敏感、声明前注释不绕过锚定。取舍：值字符串
// 中出现属性名字样的极端形态会误报（人工核查即可），宁可误报不漏报。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const HORIZONTAL_BOX_DECLS =
  /(^|[^-\w])(margin|padding)(?:-inline(?:-start|-end)?|-left|-right)?\s*:/i

describe('阅读标题块水平盒契约（#206）', () => {
  it('heading-1..6 规则不含水平 margin/padding 声明（限宽档居中不被覆盖）', () => {
    const css = readMainCss()
    for (let lv = 1; lv <= 6; lv++) {
      const body = cssRule(css, `.vsidian-view-reading .vsidian-reading-heading-${lv}`)
      const hit = HORIZONTAL_BOX_DECLS.exec(body)
      expect(
        hit,
        `heading-${lv} 规则声明了水平盒属性「${hit?.[2]}」，会在限宽档覆盖 .vsidian-reading-block 的居中 auto（#206）：${body.trim()}`,
      ).toBeNull()
      expect(body, `heading-${lv} 垂直间距应走 margin-block`).toMatch(/margin-block\s*:/)
    }
  })

  it('限宽档块居中依赖的 .vsidian-reading-block 规则保持 margin: 0 auto（#175）', () => {
    const body = cssRule(readMainCss(), '.vsidian-view-reading .vsidian-reading-block')
    expect(body, '#175 限宽档块级居中（margin: 0 auto）不得移除').toMatch(/margin:\s*0\s+auto/)
  })

  it('水平盒声明正则的拦截/放行矩阵（防线自身被钉住）', () => {
    const mustHit = [
      'margin: 0.6em 0 0.4em',
      'margin-left: 0',
      'margin-right: auto',
      'margin-inline: auto',
      'margin-inline-start: 40px',
      'margin-inline-end: 0',
      'padding: 0 20px',
      'padding-left: 1em',
      'padding-inline: 0',
      'padding-inline-start: 2px',
      '/* note */ margin-left: 0',
      'MARGIN-LEFT: 10px',
      'font-size: 1.55em; margin: 0.6em 0 0.4em; color: red',
    ]
    const mustMiss = [
      'margin-block: 0.6em 0.4em',
      'margin-block-start: 0.6em',
      'margin-top: 1em',
      'margin-bottom: 0.4em',
      'padding-block: 0.4em',
      'padding-top: 1em',
      'font-size: 1.55em',
      'color: var(--vsidian-heading-color-1)',
      'font-weight: 600',
    ]
    for (const decl of mustHit) {
      expect(HORIZONTAL_BOX_DECLS.test(decl), `应拦截：${decl}`).toBe(true)
    }
    for (const decl of mustMiss) {
      expect(HORIZONTAL_BOX_DECLS.test(decl), `应放行：${decl}`).toBe(false)
    }
  })
})
