// 悬停文档预览浏览器回归（#218 装配基座；#219 扩展局部范围与普通链接；
// #220 扩展来源资源与浮层内容）：装配生产 webview 控制器，Reading 双链/
// 普通链接悬停浮层由真实指针（Playwright hover / mouse.move / Escape）驱动
// ——开闭时序、移入保活、滚动、四边避障与正文绘制层可见性在真实布局验证。
// 宿主读取回包经 fixture 内伪造通道注入（与真实 handleHostMessage 同入口）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'
import { getRefContentLifecycleStats, getRefReadingBlockCacheStats } from '../../src/webview/refContentInstance'
import { openHoverPopupFor, openHoverPopupForKeyboard } from '../../src/webview/hoverPopup'

bootLocaleFromDocument()

/** 出站消息观测（hover.request 载荷断言 + 零写回断言的 edit.request 计数） */
const sent: WebviewToHost[] = []
const bridge: VsCodeBridge = {
  postMessage(message) {
    sent.push(message as WebviewToHost)
  },
  getState() {
    return undefined
  },
  setState() {},
}
const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
let panelOpened = 0

Object.assign(window, {
  openHoverPanel() {
    const anchor = document.createElement('button')
    anchor.id = 'hover-panel-anchor'
    document.body.appendChild(anchor)
    openHoverPopupFor(anchor, { target: 'B', sourceStart: 0, sourceEnd: 0,
      directFsPath: 'D:/notes/B.md', openAction: () => { panelOpened++ } })
  },
  panelOpenCount() { return panelOpened },
  openHoverKeyboard(target: string) {
    const anchor = document.querySelector<HTMLElement>('a.vsidian-wikilink')!
    const trigger = document.createElement('button')
    trigger.id = 'hover-keyboard-trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    openHoverPopupForKeyboard(anchor, { target, sourceStart: 0, sourceEnd: target.length + 4 })
  },
  /** 装配父文档并切 Reading（宿主消息与生产同入口） */
  initHoverDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'hover-preview',
      docUri: 'file:///d%3A/notes/parent.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  /** 注入设置快照（settings.snapshot 通道；#298 hover.enabled 总开关生效面） */
  applyHoverSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 已出站消息快照（hover.request / image.request / *.activate / edit.request 观测） */
  hoverSent(): WebviewToHost[] {
    return [...sent]
  },
  refCacheStats() { return getRefReadingBlockCacheStats() },
  refLifecycleStats() { return getRefContentLifecycleStats() },
  hoverVirtualStats() {
    const before = sent.length
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = sent.slice(before).find((message) => message.kind === 'view.state')
    return state?.kind === 'view.state' ? state.hoverPreview?.viewStats ?? null : null
  },
  hoverViewportSnapshot() {
    const scrollEl = document.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')
    if (!scrollEl) return { visible: [], scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
    const clip = scrollEl.getBoundingClientRect()
    const visible = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-reading-block'))
      .flatMap((block) => {
        const box = block.getBoundingClientRect()
        const top = Math.max(box.top, clip.top)
        const bottom = Math.min(box.bottom, clip.bottom)
        if (bottom - top < 3) return []
        const hit = document.elementFromPoint(Math.min(box.left + 8, clip.right - 2), (top + bottom) / 2)
        const style = getComputedStyle(block)
        return [{ text: (block.textContent ?? '').trim(), painted:
          style.visibility === 'visible' && style.display !== 'none' && style.opacity !== '0' &&
          hit !== null && block.contains(hit) }]
      })
    return { visible, scrollTop: scrollEl.scrollTop, scrollHeight: scrollEl.scrollHeight,
      clientHeight: scrollEl.clientHeight }
  },
  /** 注入宿主消息（hover.result / image.result / image.invalidate 等与真实
   *  handleHostMessage 同入口——#220 来源资源与属性区场景的驱动通道） */
  respondHoverResult(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  controller,
  /** 浮层观测（断言用户看到的东西：绘制层可见性、几何、内容与禁写态） */
  readHoverPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const scrollEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    const stateEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-state')!
    const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    const centerTopEl = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 30),
    )
    return {
      open: true as const,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      background: style.backgroundColor,
      borderPresent: style.borderWidth !== '0px',
      boxShadow: style.boxShadow !== 'none',
      /** 绘制层证据：浮层上半中心点的命中元素落在浮层内（真实接收
       *  指针/可见，非 display:none 或被完全遮挡） */
      hitInside: centerTopEl !== null && el.contains(centerTopEl),
      contentText: (el.querySelector('.vsidian-reading-heading-1')?.textContent ?? '').trim(),
      /** #219 局部范围断言素材：浮层全部文本与列表项文本（块完整取证） */
      text: (el.textContent ?? '').trim(),
      listItems: Array.from(el.querySelectorAll('.vsidian-reading-block li')).map(
        (li) => (li.textContent ?? '').trim(),
      ),
      tableRows: el.querySelectorAll('.vsidian-reading-block table tbody tr').length,
      codeText: (el.querySelector('.vsidian-reading-block pre')?.textContent ?? '').trim(),
      /** #220 代码高亮：朴素形态 token span 在场（卡片工具条不进入浮层） */
      codeTokenSpans: el.querySelectorAll('.vsidian-reading-block pre code span[class^="tok-"]').length,
      blockCount: el.querySelectorAll('.vsidian-reading-block').length,
      stateText: (stateEl.textContent ?? '').trim(),
      stateVisible: getComputedStyle(stateEl).display !== 'none',
      scrollable: scrollEl.scrollHeight > scrollEl.clientHeight,
      scrollHeight: scrollEl.scrollHeight,
      clientHeight: scrollEl.clientHeight,
      checkboxCount: boxes.length,
      checkboxAllDisabled: boxes.length > 0 && boxes.every((b) => b.disabled),
      activeElement:
        document.activeElement === document.body
          ? 'body'
          : `${document.activeElement?.tagName}.${(document.activeElement as HTMLElement | undefined)?.className ?? ''}`,
    }
  },
  /** #220 笔记属性区观测（绘制层：标题行可见性与底色、行的 display、按钮
   *  透明度/指针/aria——present=false = 无属性区） */
  readHoverFm() {
    const section = document.querySelector<HTMLElement>('.vsidian-hover-popup .vsidian-hover-fm')
    if (!section) {
      return { present: false as const }
    }
    const header = section.querySelector<HTMLElement>('.vsidian-fm-header')
    const btn = section.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')
    const row = section.querySelector<HTMLElement>('.vsidian-fm-row') ?? section.querySelector('pre')
    const headerRect = header?.getBoundingClientRect()
    return {
      present: true as const,
      collapsed: section.classList.contains('vsidian-hover-fm-collapsed'),
      headerVisible:
        header !== null &&
        headerRect !== undefined &&
        headerRect.height > 0 &&
        getComputedStyle(header).display !== 'none',
      headerBg: header ? getComputedStyle(header).backgroundColor : '',
      rowDisplay: row ? getComputedStyle(row).display : 'absent',
      btnOpacity: btn ? getComputedStyle(btn).opacity : '',
      btnPointerEvents: btn ? getComputedStyle(btn).pointerEvents : '',
      btnAriaExpanded: btn?.getAttribute('aria-expanded') ?? '',
      btnLabel: btn?.getAttribute('aria-label') ?? '',
    }
  },
  /** #220 浮层内图片观测（B 身份资源：rawSrc 与已应用的 src） */
  readHoverImages() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return []
    }
    return Array.from(el.querySelectorAll<HTMLImageElement>('img')).map((img) => ({
      rawSrc: img.dataset['vsidianImgSrc'] ?? '',
      appliedSrc: img.getAttribute('src') ?? '',
    }))
  },
  /** 滚动浮层内容到指定位置（保活下的滚动承载） */
  scrollHoverPopup(top: number) {
    const scrollEl = document.querySelector<HTMLElement>('.vsidian-hover-popup .vsidian-hover-popup-scroll')
    if (scrollEl) {
      scrollEl.scrollTop = top
      return scrollEl.scrollTop
    }
    return -1
  },
  /** 悬停锚点几何（避障断言的参照） */
  readAnchor() {
    const a = document.querySelector<HTMLElement>('a.vsidian-wikilink')
    if (!a) {
      return null
    }
    const rect = a.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  },
  /** 滚动父阅读容器，把链接带到距视口底 deltaPx 处（四边避障场景构造） */
  scrollReadingSoAnchorNearBottom(deltaPx: number) {
    const container = document.querySelector<HTMLElement>('.vsidian-view-reading')
    const a = document.querySelector<HTMLElement>('a.vsidian-wikilink')
    if (!container || !a) {
      return false
    }
    const rect = a.getBoundingClientRect()
    const want = window.innerHeight - deltaPx - rect.height
    container.scrollTop += rect.top - want
    return true
  },
})
