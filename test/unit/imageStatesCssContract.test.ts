// 图片失败态细分绘制 CSS 契约（#201）：钉住 main.css 的 notfound /
// unreachable 关键规则——两态在 error 基类上叠加且不冒充彼此（找不到淡红
// 底、不可访问黄系提示）。真实宿主的 computed backgroundColor /
// borderBottomColor 断言在浏览器 imageRefresh 脚本与集成 #201 用例（本
// 契约防样式表被误删或只剩类名——样式注入失效时 DOM 存在性照样通过）。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('图片失败态细分渲染 CSS 契约（#201）', () => {
  it('error 基类保持可见虚线轮廓与重试指针（既有契约不回归）', () => {
    const error = cssRule(css, '#app .vsidian-image.vsidian-image-error')
    expect(error).toMatch(/border:\s*1px dashed/u)
    expect(error).toMatch(/cursor:\s*pointer/u)
  })

  it('notfound：淡红底强调（可见背景是与 error 通用态的绘制层差异来源）', () => {
    const notfound = cssRule(css, '#app .vsidian-image.vsidian-image-notfound')
    expect(notfound).toMatch(
      /background:\s*var\(--vsidian-image-notfound-background, rgba\(190, 17, 0, 0\.08\)\)/u,
    )
  })

  it('unreachable：黄系边框与前景（与 notfound 红系可区分，不冒充删除）', () => {
    const unreachable = cssRule(css, '#app .vsidian-image.vsidian-image-unreachable')
    expect(unreachable).toMatch(
      /border-color:\s*var\(--vscode-inputValidation-warningBorder, #cca700\)/u,
    )
    expect(unreachable).toMatch(
      /color:\s*var\(--vscode-editorWarning-foreground, #cca700\)/u,
    )
  })
})
