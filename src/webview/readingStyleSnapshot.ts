// 阅读样式快照收集（T02/#622）：编辑器 webview 的主题变量计算值枚举。
//
// 数据面（PDF 导出准备阶段的主题跟随数据源）：
// - dark：body 主题类（与 syncController 的 isVscodeDarkBody 同判定——
//   vscode-dark / vscode-high-contrast 为暗）；
// - vars：body 与 documentElement 的自定义属性计算值中，VSCode 注入的
//   主题 token（--vscode-*）与标题色引用族（--h1-color..--h6-color）——
//   导出页的 main.css 复用需要这些值（webview 里由 VSCode 默认样式表
//   注入，Chrome 导出页没有，快照搬运）；--vsidian-* 族是 main.css 静态
//   定义（导出页同有），不入快照；
// - reading：阅读正文容器的 font-family/size/line-height 计算值（容器
//   不在场回退 body）。
//
// jsdom 可单测（getComputedStyle 对自定义属性的枚举在 jsdom 支持有限，
// 测试经注入的枚举函数替身）。

import type { PdfExportStyleSnapshot } from '../shared/pdfExportPayload'

/** 收集变量名清单的注入点（生产 = getComputedStyle 枚举全部属性） */
export function collectReadingStyleSnapshot(): PdfExportStyleSnapshot | null {
  if (typeof document === 'undefined' || !document.body) {
    return null
  }
  const bodyClass = document.body.classList
  const dark = bodyClass.contains('vscode-dark') || bodyClass.contains('vscode-high-contrast')
  const vars: Record<string, string> = {}
  for (const target of [document.body, document.documentElement]) {
    const style = window.getComputedStyle(target)
    // 枚举形态因引擎而异：Chrome 支持 style iterate；防御性兼容 item(i)
    const names: string[] = []
    if (typeof (style as unknown as { length?: number }).length === 'number') {
      for (let i = 0; i < style.length; i++) {
        const name = style.item(i)
        if (name.startsWith('--')) names.push(name)
      }
    }
    for (const name of names) {
      if (!name.startsWith('--vscode-') && !/^--h[1-6]-color$/.test(name)) {
        continue
      }
      const value = style.getPropertyValue(name).trim()
      if (value !== '') {
        vars[name] = value
      }
    }
  }
  const readingEl = document.querySelector<HTMLElement>('.vsidian-view-reading') ?? document.body
  const readingStyle = window.getComputedStyle(readingEl)
  return {
    dark,
    vars,
    reading: {
      fontFamily: readingStyle.fontFamily || undefined,
      fontSize: readingStyle.fontSize || undefined,
      lineHeight: readingStyle.lineHeight || undefined,
    },
  }
}
