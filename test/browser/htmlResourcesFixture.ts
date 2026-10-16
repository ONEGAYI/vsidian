// #570（T05）HTML 链接图片与 CSS 资源文档归属的浏览器回归装配：装配生产
// webview 控制器 + 伪造资源宿主（image.request / htmlResource.request 自动
// 回包——data: URL 让浏览器真实装载与绘制）。验证面：Live/Reading 的 HTML
// img/srcset 装载、文档样式 url() 背景绘制、@font-face 字体装载、媒体属性
// 归属改写、Live 链接点击不意外跳转、Reading 链接意图上报、失效重取。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import katexFontWoff2 from '../../node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 测试字体（真实 woff2——esbuild dataurl 装配，经伪造宿主以 data: URL
 *  回包；@font-face 装载走浏览器标准管线） */
export const TEST_FONT_DATA_URL: string = katexFontWoff2

/** 出站消息观测 */
const sent: WebviewToHost[] = []

/** 伪造资源宿主的解析表（文件名 → data: URL；未登记的相对路径 404 失败） */
const resourceTable = new Map<string, string>()
/** 解析请求日志（归属断言：url 与是否携带 sourceDocUri） */
const resourceLog: Array<{ kind: string; url: string; sourceDocUri?: string }> = []
/** 代次（失效重取的 URL 变化证据） */
let resourceGeneration = 0

/** 1x1 红色 PNG（图片装载/背景绘制的最小真实资源） */
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
/** 2x1 蓝绿 PNG（srcset 二候选用——与红色区分） */
const WIDE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const bridge: VsCodeBridge = {
  postMessage(message) {
    const msg = message as WebviewToHost
    sent.push(msg)
    // 伪造资源宿主：image.request（markdown 图既有通道）与 htmlResource.request
    //（T05 新通道）自动回包；reqId 原样配对
    if (msg.kind === 'image.request' || msg.kind === 'htmlResource.request') {
      const url = msg.kind === 'image.request' ? msg.src : msg.url
      resourceLog.push({
        kind: msg.kind,
        url,
        ...(msg.sourceDocUri !== undefined ? { sourceDocUri: msg.sourceDocUri } : {}),
      })
      const hit = resourceTable.get(url)
      window.setTimeout(() => {
        controller.handleHostMessage(hit !== undefined
          ? (msg.kind === 'image.request'
            ? { kind: 'image.result', reqId: msg.reqId, ok: true, src: hit }
            : { kind: 'htmlResource.result', reqId: msg.reqId, ok: true, url: hit })
          : (msg.kind === 'image.request'
            ? { kind: 'image.result', reqId: msg.reqId, ok: false, reason: 'not-found', detail: url }
            : { kind: 'htmlResource.result', reqId: msg.reqId, ok: false, reason: 'not-found', detail: url }))
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

const DOC_URI = 'file:///d%3A/notes/html-res.md'

/** 活跃内容域（双容器常驻、非活跃者 display:none——按可见性取域） */
function htmlResActiveScope(): ParentNode | null {
  const reading = document.querySelector<HTMLElement>('.vsidian-view-reading')
  if (reading && reading.getClientRects().length > 0) {
    return reading
  }
  return document.querySelector('.cm-content')
}

Object.assign(window, {
  /** 装载文档并登记资源表（相对名 → data: URL；缺省给红色 PNG） */
  initHtmlResDoc(text: string, resources: Record<string, string> = {}) {
    resourceTable.clear()
    resourceLog.length = 0
    resourceGeneration = 0
    for (const [name, url] of Object.entries(resources)) {
      resourceTable.set(name, url)
    }
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'html-res-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setHtmlResMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  htmlResSent(): WebviewToHost[] {
    return [...sent]
  },
  htmlResLog(): Array<{ kind: string; url: string; sourceDocUri?: string }> {
    return [...resourceLog]
  },
  /** 模拟文件变化：换 URL（加代次参数）+ 广播失效（走真实 image.invalidate
   *  通道——hub 与文档样式注册表均消费） */
  htmlResInvalidate(srcs: string[]) {
    resourceGeneration += 1
    for (const src of srcs) {
      const hit = resourceTable.get(src)
      if (hit !== undefined) {
        resourceTable.set(src, `${hit}#g${resourceGeneration}`)
      }
    }
    controller.handleHostMessage({ kind: 'image.invalidate', srcs })
  },
  htmlResActiveScope: htmlResActiveScope,
  /** HTML 内容观测（两种模式的渲染根统一采集） */
  readHtmlResImgs() {
    const scope = htmlResActiveScope()
    if (!scope) {
      return []
    }
    return Array.from(scope.querySelectorAll<HTMLImageElement>('.vsidian-live-html img, .vsidian-reading-html img, .vsidian-live-inline-html img')).map((img) => ({
      state: img.dataset['vsidianImgState'] ?? null,
      src: img.getAttribute('src'),
      srcset: img.getAttribute('srcset'),
      currentSrc: img.currentSrc,
      naturalWidth: img.naturalWidth,
      complete: img.complete,
    }))
  },
  /** 媒体属性观测 */
  readHtmlResMedia() {
    const scope = htmlResActiveScope()
    if (!scope) {
      return []
    }
    return Array.from(scope.querySelectorAll('video[src], video[poster], audio[src], source[src]')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: el.getAttribute('src'),
      poster: el.getAttribute('poster'),
    }))
  },
  /** 文档样式产物观测（元素计算背景 = url() 绘制证据；元素取活跃域内的
   *  首个命中——非活跃容器副本 display:none 其 computed 不作证据） */
  readHtmlResDocStyle() {
    const scope = htmlResActiveScope()
    const hero = scope?.querySelector<HTMLElement>('.t5-hero') ?? null
    const fontProbe = scope?.querySelector<HTMLElement>('.t5-font') ?? null
    return {
      heroBackground: hero ? getComputedStyle(hero).backgroundImage : null,
      fontSpec: fontProbe ? getComputedStyle(fontProbe).fontFamily : null,
      fontLoaded: document.fonts.check('16px T5Test'),
      productText: document.querySelector('style[data-vsidian-doc-style="doc"]')?.textContent ?? null,
    }
  },
  /** 当前页面 URL（导航守卫断言） */
  htmlResPageUrl(): string {
    return window.location.href
  },
  controller,
  RED_PNG,
  WIDE_PNG,
  TEST_FONT_DATA_URL,
})
