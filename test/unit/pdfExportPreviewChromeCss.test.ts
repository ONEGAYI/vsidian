// PDF 导出模态预览样式契约（验收修复轮）：把用户可见的布局/缩放/骨架
// 关键规则钉在 CSS 文本上——样式注入失效或规则被意外改写时测试先红。
// 观感本体仍由真实宿主/浏览器验收，此处防回潮与常量漂移。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SKELETON_SHIMMER_CYCLE_MS, SKELETON_SHIMMER_DELAY_MS } from '../../src/shared/skeletonTiming'

const css = readFileSync(new URL('../../src/webview/pdfExportModal.css', import.meta.url), 'utf8')

const ruleOf = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped} \\{`).exec(css)
  expect(match, `选择器 ${selector} 应存在`).not.toBeNull()
  const at = match!.index + (match![0].startsWith('\n') ? 1 : 0)
  return css.slice(at, css.indexOf('}', at))
}

describe('PDF 导出模态预览样式契约', () => {
  it('预览列宽按打印纸面宽封顶，右侧栏吸收剩余宽度', () => {
    expect(ruleOf('.vsidian-pdfexport-preview')).toContain('max-width: calc(var(--vsidian-pdfexport-print-width')
    expect(ruleOf('.vsidian-pdfexport')).toContain('display: flex')
    expect(ruleOf('.vsidian-pdfexport-side')).toContain('flex: 1 1 360px')
  })

  it('宽度变化有滑动动画，reduced-motion 下关闭', () => {
    expect(ruleOf('.vsidian-pdfexport')).toContain('transition: max-width 220ms ease')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/)
  })

  it('说明块水平居中（列向 flex 子项不被 max-width 贴左）', () => {
    expect(ruleOf('.vsidian-pdfexport-preview-placeholder')).toContain('margin-inline: auto')
  })

  it('缩放条固定在预览区左下角', () => {
    const bar = ruleOf('.vsidian-pdfexport-zoombar')
    expect(bar).toContain('position: absolute')
    expect(bar).toContain('left: 14px')
    expect(bar).toContain('bottom: 14px')
  })

  it('骨架复用开屏骨架的扫光配方，节拍 fallback 与共享常量一致', () => {
    expect(css).toContain(`var(--vsidian-pdfexport-skeleton-cycle, ${SKELETON_SHIMMER_CYCLE_MS}ms)`)
    expect(css).toContain(`var(--vsidian-pdfexport-skeleton-delay, ${SKELETON_SHIMMER_DELAY_MS}ms)`)
    expect(css).toContain('.vsidian-pdfexport-skeleton-page > .vsidian-skeleton-block::after')
  })
})
