// 图片刷新浏览器回归（#201）：宿主消息注入驱动生产控制器的失效/重发/
// 状态细分链路——像素替换（画布采样实际呈现颜色，不只 src 字符串）、
// 删除可见态与不可访问区分（computed 绘制层属性）、代次守卫、唤醒核验、
// 图片尺寸变化后的阅读视口稳定。与 imagePasteFixture 同口径（宿主模拟
// 在脚本侧，webview 侧为真实控制器与样式）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** 生成纯色 PNG data URL（画布现制——像素断言的可控图源） */
function makeDataPng(r: number, g: number, b: number, w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/png')
}

/** 采样元素位图中心像素（canvas drawImage + getImageData；data URL 同源不污染） */
function sampleCenter(el: Element): { r: number; g: number; b: number; a: number } | null {
  const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
  if (!(img instanceof HTMLImageElement) || !img.getAttribute('src') || img.naturalWidth === 0) {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2), 1, 1, 0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  return { r: data[0]!, g: data[1]!, b: data[2]!, a: data[3]! }
}

/** 图片槽位观测（双视图）：状态、原因、细分类、已应用 src */
function imageSlots(): Array<{
  state: string
  reason: string
  notfound: boolean
  unreachable: boolean
  src: string
}> {
  const out: Array<{ state: string; reason: string; notfound: boolean; unreachable: boolean; src: string }> = []
  for (const el of document.querySelectorAll('.vsidian-image')) {
    const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
    out.push({
      state: (el as HTMLElement).dataset['vsidianImgState'] ?? '',
      reason: (el as HTMLElement).dataset['vsidianImgReason'] ?? '',
      notfound: el.classList.contains('vsidian-image-notfound'),
      unreachable: el.classList.contains('vsidian-image-unreachable'),
      src: img?.getAttribute('src') ?? '',
    })
  }
  return out
}

/** 绘制层可见性观测：computed 背景/边框色 + 布局尺寸 */
function slotPaint(el: Element): { background: string; borderColor: string; width: number; height: number } {
  const style = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  return {
    background: style.backgroundColor,
    borderColor: style.borderTopColor,
    width: rect.width,
    height: rect.height,
  }
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'image-refresh',
      docUri: 'file:///d/note.md', version: 1, text })
  },
  setViewMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 宿主回发图片解析结果（reqId 对应在途 image.request） */
  respondImage(reqId: number, ok: boolean, payload: string) {
    if (ok) {
      controller.handleHostMessage({ kind: 'image.result', reqId, ok: true, src: payload })
    } else {
      controller.handleHostMessage({ kind: 'image.result', reqId, ok: false, reason: payload as 'not-found' | 'inaccessible' })
    }
  },
  /** 宿主失效通知注入 */
  injectInvalidate(srcs: string[]) {
    controller.handleHostMessage({ kind: 'image.invalidate', srcs })
  },
  /** 宿主唤醒注入（焦点回归/远程重连的及时核验） */
  injectWake() {
    controller.handleHostMessage({ kind: 'image.wake' })
  },
  makeDataPng,
  sampleCenter,
  imageSlots,
  slotPaint,
  readHostMessages() {
    return hostMessages
  },
  readScrollTop(): number {
    const scroller = document.querySelector('.vsidian-reading-container')?.parentElement
      ?? document.querySelector('.cm-scroller')
    return scroller ? (scroller as HTMLElement).scrollTop : 0
  },
  /** 滚动到包含指定文本的块（返回块顶缘的滚动前视口坐标；未找到 -1） */
  scrollToText(text: string): number {
    for (const el of document.querySelectorAll('.vsidian-reading-block p, .vsidian-reading-block h1')) {
      if ((el.textContent ?? '').includes(text)) {
        const scroller = (document.querySelector('.vsidian-reading-container')?.parentElement
          ?? document.querySelector('.cm-scroller')) as HTMLElement | null
        if (!scroller) {
          return -1
        }
        const top = el.getBoundingClientRect().top
        scroller.scrollTop += top - 120
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
        return top
      }
    }
    return -1
  },
  scrollTo(target: number) {
    const scroller = (document.querySelector('.vsidian-reading-container')?.parentElement
      ?? document.querySelector('.cm-scroller')) as HTMLElement | null
    if (scroller) {
      scroller.scrollTop = target
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
  },
  /** 视口内指定文本块的视口顶缘（滚动锚定观测） */
  anchorTopAt(text: string): number | null {
    for (const el of document.querySelectorAll('.vsidian-reading-block p, .vsidian-reading-block h1')) {
      if ((el.textContent ?? '').includes(text)) {
        return el.getBoundingClientRect().top
      }
    }
    return null
  },
})
