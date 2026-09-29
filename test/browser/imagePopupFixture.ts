// 图片弹窗回归 fixture（#212）：真实生产控制器 + 产物 CSS，暴露文档装载、
// 模式切换与图源映射（拦截 image.request 同步回灌 image.result——资源
// 装载链路走产线代码，仅宿主解析被替身），并暴露出站消息（导出链路的
// image.export 形态断言）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const sent: unknown[] = []
/** 源文 src → 回灌的可加载地址（data: URI） */
const served = new Map<string, string>()
const controller = new WebviewSyncController({
  postMessage(m: unknown) {
    const msg = m as { kind: string; src?: string; reqId?: number }
    sent.push(m)
    if (msg.kind === 'image.request' && msg.src !== undefined && served.has(msg.src)) {
      controller.handleHostMessage({
        kind: 'image.result',
        reqId: msg.reqId!,
        ok: true,
        src: served.get(msg.src)!,
      })
    }
  },
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)
Object.assign(window, {
  controller,
  initImgDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'img', docUri: 'file:///img.md', version: 1, text })
  },
  setImgMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  serveImg(src: string, servedSrc: string) {
    served.set(src, servedSrc)
  },
  imgSent() { return sent },
})
