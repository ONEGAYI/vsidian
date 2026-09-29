// live 图片布局回归 fixture：真实生产控制器 + 产物 CSS，暴露文档装载、
// 模式切换、设置快照注入与图源映射（拦截 image.request 同步回灌
// image.result——webview 侧资源装载链路走产线代码，仅宿主解析被替身）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
/** 源文 src → 回灌的可加载地址（data: URI） */
const served = new Map<string, string>()
const controller = new WebviewSyncController({
  postMessage(m: unknown) {
    const msg = m as { kind: string; src?: string; reqId?: number }
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
  setImgSettings(values: Record<string, unknown>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  serveImg(src: string, servedSrc: string) {
    served.set(src, servedSrc)
  },
})
