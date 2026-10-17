// #573（T08）SVG/MathML 与混合命名空间渲染的浏览器回归装配：A 主文档
// 走生产 WebviewSyncController（伪造资源宿主自动回 data: URL——浏览器真
// 实布局/装载/绘制）；B 嵌入目标直驱**生产装配链**（htmlBlockRenderHtml
// 净化 → mountRefContentBlock 含 ID 作用域 + DocumentStyleBinding 装载
// ——嵌入协议链在集成层，此处钉净化/装配/样式/资源四管线本体）。
// 验证面：SVG 几何/文字/渐变/foreignObject 实际绘制（rect 面积 +
// computed fill + elementFromPoint，非 DOM 存在性）、MathML 结构绘制、
// 行内 SVG 混排不吞前后文、Live 点击选区精确与零写回、净化负向
//（svg onload/script/animate 劫持不进场不执行）、A/B 相同 ID 不串目标
//（B 前缀化 + B 的 CSS #id/url(#id) 协同命中）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView } from '@codemirror/view'
import { htmlBlockRenderHtml } from '../../src/webview/htmlSanitize'
import { mountRefContentBlock } from '../../src/webview/refReadingContent'
import type { HtmlResourceBinding, HtmlResourceSubscribe } from '../../src/webview/htmlResourceMount'
import { DocumentStyleBinding } from '../../src/webview/docStyleLoader'
import { docScopeKeyOf } from '../../src/shared/docStyle'
import '../../src/webview/main.css'

bootLocaleFromDocument()

const sent: WebviewToHost[] = []

/** A 资源解析表（文件名 → data: URL；未登记 404） */
const resourceTable = new Map<string, string>()
/** A 资源请求日志（SVG image href 走 htmlResource 通道的断言载体） */
const resourceLog: Array<{ kind: string; url: string }> = []

const bridge: VsCodeBridge = {
  postMessage(message) {
    const msg = message as WebviewToHost
    sent.push(msg)
    if (msg.kind === 'image.request' || msg.kind === 'htmlResource.request') {
      const url = msg.kind === 'image.request' ? msg.src : msg.url
      resourceLog.push({ kind: msg.kind, url })
      const hit = resourceTable.get(url)
      window.setTimeout(() => {
        controller.handleHostMessage(hit !== undefined
          ? (msg.kind === 'image.request'
            ? { kind: 'image.result', reqId: msg.reqId, ok: true, src: hit }
            : { kind: 'htmlResource.result', reqId: msg.reqId, ok: true, url: hit })
          : (msg.kind === 'image.request'
            ? { kind: 'image.result', reqId: msg.reqId, ok: false, reason: 'not-found' }
            : { kind: 'htmlResource.result', reqId: msg.reqId, ok: false, reason: 'not-found' }))
      }, 0)
    }
  },
  getState() {
    return undefined
  },
  setState() {},
}
const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!)

const DOC_URI = 'file:///d%3A/notes/svg-math.md'

/** B 身份（生产 docScope 键派生——与嵌入实例同一事实源） */
const B_FS = 'D:\\notes\\t08-b.md'
const B_SCOPE = docScopeKeyOf(B_FS)

/** B 资源解析表与日志（B 身份订阅断言载体） */
const bResourceTable = new Map<string, string>()
const bResourceLog: Array<{ url: string }> = []

/** B 资源订阅端口（注入生产 mountRefContentBlock——按 B 表解析） */
const bSubscribe: HtmlResourceSubscribe = (url, apply) => {
  bResourceLog.push({ url })
  const hit = bResourceTable.get(url)
  window.setTimeout(() => apply(hit !== undefined ? { ok: true, url: hit } : { ok: false, reason: 'not-found' }), 0)
  return () => undefined
}

/** B 挂载宿主与生命周期（重复挂载释放前代） */
let bHost: HTMLElement | null = null
let bBinding: HtmlResourceBinding | null = null
let bStyleBinding: DocumentStyleBinding | null = null

function liveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 装载 A 主文档（Live 起步）与 A 资源表 */
  initSvgMathDoc(text: string, resources: Record<string, string> = {}) {
    resourceTable.clear()
    resourceLog.length = 0
    for (const [name, url] of Object.entries(resources)) {
      resourceTable.set(name, url)
    }
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'svg-math-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setSvgMathMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  svgMathSent(): WebviewToHost[] {
    return [...sent]
  },
  svgMathResourceLog(): Array<{ kind: string; url: string }> {
    return [...resourceLog]
  },
  setSvgMathCursor(pos: number) {
    liveView()?.dispatch({ selection: { anchor: pos } })
  },
  svgMathSelection(): Array<{ anchor: number; head: number }> {
    const view = liveView()
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head }))
  },
  focusSvgMathLive() {
    liveView()?.focus()
  },
  svgMathDocText(): string {
    return liveView()?.state.doc.toString() ?? ''
  },

  /**
   * 挂载 B 渲染（生产装配链直驱）：净化 → mountRefContentBlock（ID 作用
   * 域 + B 资源订阅）+ DocumentStyleBinding（B 本篇 style 装载——id 选择
   * 器与 url(#id) 协同断言面）。html 为 B 的 HTML 块源文，css 为 B 的
   * style 内容，resources 为 B 资源表。
   */
  mountSvgMathB(html: string, css: string, resources: Record<string, string> = {}) {
    bBinding?.dispose()
    bBinding = null
    bStyleBinding?.dispose()
    bStyleBinding = null
    bHost?.remove()
    bResourceTable.clear()
    bResourceLog.length = 0
    for (const [name, url] of Object.entries(resources)) {
      bResourceTable.set(name, url)
    }
    bHost = document.createElement('div')
    bHost.className = 'vsidian-svgmathml-b-host'
    bHost.style.width = '400px'
    const el = document.createElement('div')
    el.className = 'vsidian-reading-html vsidian-reading-block'
    el.dataset['vsidianDocScope'] = B_SCOPE
    el.innerHTML = htmlBlockRenderHtml(html)
    bHost.append(el)
    document.getElementById('app')!.append(bHost)
    bBinding = mountRefContentBlock(el, {
      images: null,
      codeHighlight: false,
      fm: null,
      htmlResources: { subscribe: bSubscribe, sourceDocUri: B_FS },
      docScope: B_SCOPE,
    })
    if (css !== '') {
      bStyleBinding = new DocumentStyleBinding(B_SCOPE, { subscribe: bSubscribe })
      bStyleBinding.sync(`<style>${css}</style>`)
    }
  },
  unmountSvgMathB() {
    bBinding?.dispose()
    bBinding = null
    bStyleBinding?.dispose()
    bStyleBinding = null
    bHost?.remove()
    bHost = null
  },
  svgMathBResourceLog(): Array<{ url: string }> {
    return [...bResourceLog]
  },

  /** A 活跃域（live cm-content / reading 容器）内 SVG/MathML 观测 */
  readSvgMathA() {
    const reading = document.querySelector<HTMLElement>('.vsidian-view-reading')
    const scope = reading && reading.getClientRects().length > 0
      ? reading
      : document.querySelector('.cm-content')
    if (!scope) {
      return null
    }
    const svgEls = Array.from(scope.querySelectorAll<SVGElement>('svg'))
    const mathEls = Array.from(scope.querySelectorAll<HTMLElement>('math'))
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { w: r.width, h: r.height }
    }
    const firstShape = svgEls
      .flatMap((s) => Array.from(s.querySelectorAll<SVGElement>('rect, circle')))
      .find((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })
    const hitByPoint = firstShape
      ? (() => {
        const r = firstShape.getBoundingClientRect()
        const ownerSvg = firstShape.closest('svg')
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        // 命中落在该图形所属 svg 子树内即真实接收指针（含 svg/text 命中
        // 形态——绘制的证据是命中不被外物覆盖、不落 display:none 区域）
        return hit !== null && ownerSvg !== null && ownerSvg.contains(hit)
      })()
      : false
    const gradientRect = svgEls
      .flatMap((s) => Array.from(s.querySelectorAll<SVGElement>('rect[fill], circle[fill]')))
      .find((el) => /url\(#/.test(el.getAttribute('fill') ?? '')) ?? null
    const textEl = svgEls.flatMap((s) => Array.from(s.querySelectorAll<SVGElement>('text')))[0] ?? null
    const foDiv = svgEls.flatMap((s) => Array.from(s.querySelectorAll<HTMLElement>('foreignObject div')))[0] ?? null
    const clsRect = svgEls.flatMap((s) => Array.from(s.querySelectorAll<SVGElement>('.svg-cls')))[0] ?? null
    const svgImage = svgEls.flatMap((s) => Array.from(s.querySelectorAll<SVGElement>('image')))[0] ?? null
    return {
      svgs: svgEls.length,
      svgSizes: svgEls.slice(0, 6).map(rect),
      shapeHit: hitByPoint,
      gradientFill: gradientRect ? getComputedStyle(gradientRect).fill : null,
      gradientRectSize: gradientRect ? rect(gradientRect) : null,
      textPainted: textEl ? rect(textEl).w > 0 : false,
      textContent: textEl?.textContent ?? null,
      foreignObjectDivColor: foDiv ? getComputedStyle(foDiv).color : null,
      foreignObjectDivPainted: foDiv ? rect(foDiv).w > 0 : false,
      /** 本篇 style 的类选择器命中 SVG 元素（fill 计算色——T04 对 SVG 命名空间同样生效） */
      clsFillComputed: clsRect ? getComputedStyle(clsRect).fill : null,
      /** SVG image 装载（href 经资源通道解析应用；SVGImageElement 无解码
       *  状态 API——属性应用是管线闭环证据，载荷有效性由 data PNG 保证） */
      svgImageSrc: svgImage?.getAttribute('href') ?? null,
      maths: mathEls.length,
      mathPainted: mathEls.length > 0 ? rect(mathEls[0]!) : null,
      mathHasMfrac: mathEls.some((m) => m.querySelector('mfrac') !== null),
      scriptCount: scope.querySelectorAll('script').length,
      eventAttrCount: Array.from(scope.querySelectorAll('*'))
        .reduce((n, el) => n + Array.from(el.attributes)
          .filter((a) => a.name.toLowerCase().startsWith('on')).length, 0),
      animateHijack: /attributeName="(href|xlink:href|onload)"/i
        .test(scope.querySelector('.vsidian-svgmath-evil')?.outerHTML ?? ''),
    }
  },

  /** B 渲染观测（ID 作用域 + 渐变绘制 + CSS 协同） */
  readSvgMathB() {
    const host = document.querySelector<HTMLElement>('.vsidian-svgmathml-b-host')
    if (!host) {
      return null
    }
    const scopeAttr = host.querySelector('[data-vsidian-doc-scope]')?.getAttribute('data-vsidian-doc-scope') ?? null
    const ids = Array.from(host.querySelectorAll('[id]')).map((el) => el.id)
    const rectEl = host.querySelector<SVGElement>('.b-target')
    const bStyleEl = host.querySelector<SVGElement>('.b-stroke')
    return {
      scope: scopeAttr,
      ids,
      fillAttr: rectEl?.getAttribute('fill') ?? null,
      fillComputed: rectEl ? getComputedStyle(rectEl).fill : null,
      rectPainted: rectEl ? rectEl.getBoundingClientRect().width > 0 : false,
      strokeComputed: bStyleEl ? getComputedStyle(bStyleEl).stroke : null,
      styleProduct: document.querySelector(`style[data-vsidian-doc-style="${B_SCOPE}"]`)?.textContent ?? null,
    }
  },

  /** 恶意载荷执行观测（window 副作用——script/onload/animate 都不得触发） */
  svgMathEvilRan(): boolean {
    return (window as unknown as { __svgMathEvilRan?: boolean }).__svgMathEvilRan === true
  },
  controller,
})
