// 代码块卡片浏览器 fixture（#189/#190/#191/#389）：真实生产控制器 +
// 产物 CSS，观测双模式几何、按钮态、折行与语言文字实际绘制。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { RefContentInstance, type RefContentMount } from '../../src/webview/refContentInstance'
import { createReadingContainer } from '../../src/webview/readingView'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const controller = new WebviewSyncController({
  postMessage() {},
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)

// #389：对目标文字本身取 Range（引用朴素 code 的一个 token 可跨多行），
// 再裁剪到滚动祖先并命中绘制层。只读探针，不给生产控制器增添操作入口。
function codePaint(selector: string, needle: string) {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = (node.textContent ?? '').indexOf(needle)
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + needle.length)
      let visible = false
      for (const rect of range.getClientRects()) {
        let left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right)
        let top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom)
        let hidden = false
        for (let parent: HTMLElement | null = el; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent)
          if (style.display === 'none' || style.visibility !== 'visible' ||
              style.contentVisibility === 'hidden' || Number(style.opacity) === 0) hidden = true
          const clip = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, clip.left); right = Math.min(right, clip.right)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom)
          }
        }
        if (hidden || right <= left || bottom <= top) continue
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        if (hit && el.contains(hit)) visible = true
      }
      return { visible, color: getComputedStyle(el).color, classes: el.className,
        lineNumber: el.closest('.cm-line, .vsidian-reading-code-line')
          ?.querySelector('.vsidian-code-card-linenumber')?.textContent ?? null }
    }
  }
  return null
}

let reference: RefContentInstance | undefined
let referenceMount: RefContentMount | undefined
let referenceSurface: HTMLElement | undefined
let referenceHighlight = true
function mountCodeReference(text: string, offset: number): void {
  referenceMount?.dispose()
  reference?.dispose()
  referenceSurface?.remove()
  const scroll = document.createElement('div')
  scroll.id = 'code-reference-surface'
  // 仅给独立测试表面提供尺寸；内容、分片、着色和虚拟化全走生产引用装配。
  Object.assign(scroll.style, { position: 'absolute', inset: '0', overflow: 'auto',
    zIndex: '20', background: 'var(--vscode-editor-background, white)' })
  const content = createReadingContainer()
  content.style.overflow = 'visible'
  content.style.height = 'auto'
  scroll.appendChild(content)
  document.getElementById('app')!.appendChild(scroll)
  referenceSurface = scroll
  referenceHighlight = true
  reference = new RefContentInstance({ panelDocUri: 'file:///code-card.md',
    sourceDocUri: 'file:///code-reference.md', range: { start: 0, end: text.length }, occurrence: 'paint' })
  referenceMount = reference.mount({ contentEl: content, scrollEl: scroll, strategy: 'virtual',
    session: () => ({ sessionId: 'code-card', docUri: 'file:///code-card.md' }),
    send() {}, codeHighlight: () => referenceHighlight })
  referenceMount.render({ fsPath: '/code-reference.md', relPath: 'code-reference.md',
    scope: 'block', selector: { kind: 'block', anchor: 'paint' }, version: 1, text,
    range: { start: offset, end: text.length } })
}

Object.assign(window, {
  controller,
  initCode(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'code-card', docUri: 'file:///code-card.md', version: 1, text })
  },
  codePaint,
  mountCodeReference,
  setCodeReferenceHighlight(enabled: boolean) {
    referenceHighlight = enabled
    referenceMount?.refreshCodeHighlight()
  },
  locateCode(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setCodeMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
})
