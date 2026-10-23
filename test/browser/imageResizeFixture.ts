// 图片拖动与尺寸浏览器验收 fixture（#635/#636）：真实生产控制器 + 产物
// CSS，出站消息全量记录（edit.request 断言「一次拖动一笔撤销」与「Esc
// 不写文档」），图源解析被替身拦截（image.request → 同步回灌 image.result，
// webview 侧装载链路仍走产线代码）。
import { WebviewSyncController } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息（测试脚本读取：edit.request 计数与写回内容） */
const sent: WebviewToHost[] = []
/** 源文 src → 回灌的可加载地址（data: URI） */
const served = new Map<string, string>()
let saved: unknown

const controller = new WebviewSyncController({
  postMessage(m: unknown) {
    const msg = m as WebviewToHost & { src?: string; reqId?: number }
    sent.push(msg)
    if (msg.kind === 'image.request' && msg.src !== undefined && served.has(msg.src)) {
      controller.handleHostMessage({
        kind: 'image.result',
        reqId: msg.reqId!,
        ok: true,
        src: served.get(msg.src)!,
      } as HostToWebview)
    }
  },
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)

Object.assign(window, {
  controller,
  sentImage: () => sent,
  clearSentImage: () => { sent.length = 0 },
  initImgDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'img',
      docUri: 'file:///img.md',
      version: 1,
      text,
    })
  },
  setImgMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  serveImg(src: string, servedSrc: string) {
    served.set(src, servedSrc)
  },
})
