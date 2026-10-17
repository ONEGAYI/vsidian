// #571（T06）表单 details 与音视频双模式行为的浏览器回归装配：装配生产
// webview 控制器 + 伪造资源宿主（htmlResource.request 回包——合成真实
// WAV 的 data: URL，媒体走浏览器标准解码管线）。验证面：Reading 表单
// 真实输入/选择/勾选、details 真实展开、媒体真实播放（readyState/
// currentTime）、提交不导航、零写回；Live 控件/媒体命中区点击 = 完整源码
// 选区；释放与模式切换后无持续播放。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（零写回断言：edit.* 计数） */
const sent: WebviewToHost[] = []

/** 伪造资源宿主的解析表（文件名 → data: URL） */
const resourceTable = new Map<string, string>()

/** 合成真实可解码 WAV（8kHz 单声道 8-bit 正弦——Chromium 原生管线可播；
 *  video 元素装载纯音频资源同样推进 currentTime，作为视频元素装载面证据） */
function makeToneWavDataUrl(seconds = 3, freq = 440, rate = 8000): string {
  const n = Math.floor(seconds * rate)
  const buf = new ArrayBuffer(44 + n)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  const writeStr = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i))
    }
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + n, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeStr(36, 'data')
  view.setUint32(40, n, true)
  for (let i = 0; i < n; i++) {
    bytes[44 + i] = 128 + Math.round(120 * Math.sin((2 * Math.PI * freq * i) / rate))
  }
  let bin = ''
  for (const b of bytes) {
    bin += String.fromCharCode(b)
  }
  return `data:audio/wav;base64,${btoa(bin)}`
}

const TONE_WAV = makeToneWavDataUrl()

const bridge: VsCodeBridge = {
  postMessage(message) {
    const msg = message as WebviewToHost
    sent.push(msg)
    if (msg.kind === 'image.request' || msg.kind === 'htmlResource.request') {
      const url = msg.kind === 'image.request' ? msg.src : msg.url
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

const DOC_URI = 'file:///d%3A/notes/t6-controls.md'

Object.assign(window, {
  /** 装载文档并登记资源表 */
  initT6Doc(text: string, resources: Record<string, string> = {}) {
    resourceTable.clear()
    for (const [name, url] of Object.entries(resources)) {
      resourceTable.set(name, url)
    }
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 't6-controls-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setT6Mode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  sentT6(): WebviewToHost[] {
    return [...sent]
  },
  /** 抓取当前活跃内容域内全部媒体元素的引用（释放/暂停断言的前后对照） */
  grabT6Media(): Array<{ id: string; paused: boolean; src: string | null; currentTime: number }> {
    const scope = document.querySelector('.vsidian-view-reading')?.getClientRects().length
      ? (document.querySelector('.vsidian-view-reading') as ParentNode)
      : (document.querySelector('.cm-content') as ParentNode)
    if (!scope) {
      return []
    }
    return Array.from(scope.querySelectorAll('video, audio')).map((el, index) => ({
      id: `m${index}:${el.tagName.toLowerCase()}`,
      paused: (el as HTMLMediaElement).paused,
      src: el.getAttribute('src'),
      currentTime: (el as HTMLMediaElement).currentTime,
    }))
  },
  /** 抓媒体元素原引用（脱离查询树的转世元素仍可观测——释放断言用） */
  keepT6MediaRefs(): number {
    const scope = document.querySelector('.vsidian-view-reading')?.getClientRects().length
      ? (document.querySelector('.vsidian-view-reading') as ParentNode)
      : (document.querySelector('.cm-content') as ParentNode)
    const els = scope ? Array.from(scope.querySelectorAll<HTMLMediaElement>('video, audio')) : []
    ;(window as unknown as { __t6MediaRefs: HTMLMediaElement[] }).__t6MediaRefs = els
    return els.length
  },
  readT6MediaRefs(): Array<{ paused: boolean; src: string | null; connected: boolean }> {
    const refs = (window as unknown as { __t6MediaRefs?: HTMLMediaElement[] }).__t6MediaRefs ?? []
    return refs.map((el) => ({ paused: el.paused, src: el.getAttribute('src'), connected: el.isConnected }))
  },
  TONE_WAV,
})
