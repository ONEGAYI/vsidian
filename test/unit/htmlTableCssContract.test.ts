// 原生 HTML 表格默认边框 CSS 契约（#613）：钉住 #567/#568 渲染容器内
// table/th/td 的默认边框与表头底色，及「可覆盖」硬约束——容器经
// :where() 归零特异性（#133 大纲色板先例），裸标签承担 (0,0,1)，用户
// CSS 片段与文档 <style>（层叠序后置于内置）按裸标签源序即可覆盖；
// 同容器不得出现非 :where 版规则（高特异性回潮会压掉用户的 table
// 覆盖）。Live 侧不给 margin：宿主 padding 已承担间距，且 margin 折叠
// 出行盒会造成 CM6 高度记账错位（live-embed #217 口径）。
import { describe, expect, it } from 'vitest'
import { readMainCss } from './cssContract'

const css = readMainCss()

/** 容器 + 元素组合的默认规则分组（:where 容器形态） */
const tableRule = /[^{}]*:where\(#app \.vsidian-(?:live|reading)-html\) table[^{}]*\{[^{}]*\}/gu
const cellRule = /[^{}]*:where\(#app \.vsidian-(?:live|reading)-html\) (?:th|td)[^{}]*\{[^{}]*\}/gu

describe('原生 HTML 表格默认边框 CSS 契约（#613）', () => {
  it('table 默认：collapse + 列宽钳制，Live 与 Reading 两容器同组生效', () => {
    const blocks = css.match(tableRule) ?? []
    expect(blocks.length, '应存在 :where 容器形态的 table 规则').toBeGreaterThan(0)
    // 一个规则分组同时覆盖两容器（Live widget 宿主 + Reading 块）
    const both = blocks.find((b) => b.includes('.vsidian-live-html') && b.includes('.vsidian-reading-html'))
    expect(both, 'Live 与 Reading 容器应共用同一 table 规则分组').toBeTruthy()
    expect(both).toMatch(/border-collapse:\s*collapse/u)
    expect(both).toMatch(/max-width:\s*100%/u)
  })

  it('Reading 侧独有 margin，Live 侧无 margin（宿主 padding 承担间距 + 高度记账口径）', () => {
    const blocks = (css.match(tableRule) ?? [])
      .filter((b) => !b.includes('.vsidian-live-html'))
    expect(blocks.some((b) => /margin:\s*0\.4em 0/u.test(b)),
      'Reading 容器 table 上下间距对齐 reading-table 档位').toBe(true)
    for (const b of css.match(tableRule) ?? []) {
      if (b.includes('.vsidian-live-html')) {
        expect(b, 'Live 容器 table 不得带 margin（记账错位风险）').not.toMatch(/margin:/u)
      }
    }
  })

  it('th/td 默认边框与内边距：复用 Markdown 表格默认档位', () => {
    const blocks = css.match(cellRule) ?? []
    expect(blocks.length, '应存在 :where 容器形态的 th/td 规则').toBeGreaterThan(0)
    const both = blocks.find((b) => b.includes('.vsidian-live-html') && b.includes('.vsidian-reading-html'))
    expect(both, 'Live 与 Reading 容器应共用同一 th/td 规则分组').toBeTruthy()
    expect(both).toMatch(/border:\s*1px solid var\(--vscode-panel-border, rgba\(128, 128, 128, 0\.4\)\)/u)
    expect(both).toMatch(/padding:\s*4px 12px/u)
  })

  it('th 表头底色与加重：跟随主题表格背景变量', () => {
    const blocks = (css.match(cellRule) ?? []).filter((b) => /[^)]\bth\b/u.test(b) && !/\btd\b/u.test(b))
    expect(blocks.length, '应存在仅针对 th 的表头规则').toBeGreaterThan(0)
    const both = blocks.find((b) => b.includes('.vsidian-live-html') && b.includes('.vsidian-reading-html'))
    expect(both, '两容器共用 th 规则分组').toBeTruthy()
    expect(both).toMatch(/background-color:\s*var\(--vsidian-table-background/u)
    expect(both).toMatch(/font-weight:\s*600/u)
  })

  it('可覆盖性防回潮：同容器表格规则不得以非 :where 形态出现', () => {
    // 裸形态 `#app .vsidian-live-html table`（特异性 (1,1,1)）会压掉用户
    // 片段/文档样式里的裸标签 table 覆盖——:where 内形态是 `.vsidian-live-html)`
    // 后接 `)`，不会命中此负向
    expect(css).not.toMatch(/#app \.vsidian-(?:live|reading)-html (?:table|th|td)\b/u)
  })
})
