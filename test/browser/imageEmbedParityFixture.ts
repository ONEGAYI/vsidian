// #336 图片双链嵌入浏览器回归 fixture：真实生产控制器 + 产物 CSS，同一
// 文档内两种嵌入语法（![[图.png]] 与 ![](图.png)）并排渲染——绘制层一致
// 性、弹窗排除矩阵、悬停图片浮层、SVG 安全与格式解码下界在真实布局
// （Chromium）验证。图源解析宿主通道被替身拦截（image.request → 同步回
// 灌 image.result，webview 侧资源装载链路走产线代码）；hover.result 由
// 测试脚本经 handleHostMessage 同入口注入。
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView } from '@codemirror/view'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request / image.request / edit.request 零写回断言） */
const sent: WebviewToHost[] = []
/** 源文 src → 回灌的可加载地址（data: URI）；value 为 null 表示回 not-found */
const served = new Map<string, string | null>()
/** SVG 脚本执行哨兵（恶意样本 onload/alert 不触发时保持 false） */
let svgScriptRan = false

const controller = new WebviewSyncController({
  postMessage(m: unknown) {
    const msg = m as WebviewToHost & { src?: string; reqId?: number }
    sent.push(msg)
    if (msg.kind === 'image.request' && msg.src !== undefined && served.has(msg.src)) {
      const url = served.get(msg.src)
      controller.handleHostMessage(
        url === null || url === undefined
          ? { kind: 'image.result', reqId: msg.reqId!, ok: false, reason: 'not-found' }
          : { kind: 'image.result', reqId: msg.reqId!, ok: true, src: url },
      )
    }
  },
  getState<T>() { return undefined as T | undefined },
  setState() {},
})
controller.mount(document.getElementById('app')!)


function findLiveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

function makeDataPng(r: number, g: number, b: number, w: number, h: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.fillRect(0, 0, w, h)
  return canvas.toDataURL('image/png')
}

function makeDataUri(mime: string, quality?: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = 24
  canvas.height = 24
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgb(40, 90, 200)'
  ctx.fillRect(0, 0, 24, 24)
  return canvas.toDataURL(mime, quality)
}

/** PNG 字节块重排为 APNG（acTL + fcTL 注入 IDAT 前——单帧动画形态）。
 *  Chromium 的 APNG 解码路径接受该形态（load + naturalWidth>0） */
async function makeApng(r: number, g: number, b: number): Promise<string> {
  const pngUri = makeDataPng(r, g, b, 12, 12)
  const bytes = new Uint8Array(atob(pngUri.split(',')[1]!).split('').map((c) => c.charCodeAt(0)))
  const dv = new DataView(bytes.buffer)
  const chunks: Array<{ type: string; data: Uint8Array }> = []
  let at = 8
  while (at < bytes.length) {
    const len = dv.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    chunks.push({ type, data: bytes.slice(at + 8, at + 8 + len) })
    at += 12 + len
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR')!.data
  const width = new DataView(ihdr.buffer).getUint32(0)
  const height = new DataView(ihdr.buffer).getUint32(4)
  const actl = new Uint8Array(8)
  new DataView(actl.buffer).setUint32(0, 1) // num_frames
  new DataView(actl.buffer).setUint32(4, 0) // num_plays（0 = 无限）
  const fctl = new Uint8Array(26)
  const fd = new DataView(fctl.buffer)
  fd.setUint32(0, 0) // sequence_number
  fd.setUint32(4, width)
  fd.setUint32(8, height)
  fd.setUint32(12, 0) // x_offset
  fd.setUint32(16, 0) // y_offset
  fd.setUint16(20, 1) // delay_num
  fd.setUint16(22, 10) // delay_den
  fctl[24] = 0 // dispose_op
  fctl[25] = 0 // blend_op
  const out: number[] = [...bytes.slice(0, 8)]
  const crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (data: Uint8Array, type: string): number => {
    let c = 0xffffffff
    for (let i = 0; i < type.length; i++) c = crcTable[(c ^ type.charCodeAt(i)) & 0xff]! ^ (c >>> 8)
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const pushChunk = (type: string, data: Uint8Array): void => {
    const len = data.length
    out.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff)
    for (let i = 0; i < 4; i++) out.push(type.charCodeAt(i))
    out.push(...data)
    const crc = crc32(data, type)
    out.push((crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff)
  }
  let actlEmitted = false
  for (const chunk of chunks) {
    if (chunk.type === 'IDAT' && !actlEmitted) {
      pushChunk('acTL', actl)
      pushChunk('fcTL', fctl)
      actlEmitted = true
    }
    pushChunk(chunk.type, chunk.data)
  }
  return 'data:image/png;base64,' + btoa(String.fromCharCode(...out))
}

/** 最小 1x1 BMP（24 位无压缩） */
function makeDataBmp(r: number, g: number, b: number): string {
  const buf = new ArrayBuffer(54 + 4)
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  u8[0] = 0x42; u8[1] = 0x4d // 'BM'
  dv.setUint32(2, 58, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, 1, true)
  dv.setInt32(22, 1, true)
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 24, true)
  u8[54] = b; u8[55] = g; u8[56] = r; u8[57] = 0 // BGR + 填充
  let bin = ''
  for (const byte of u8) bin += String.fromCharCode(byte)
  return 'data:image/bmp;base64,' + btoa(bin)
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

/** 主正文图片槽位观测（rawSrc 承载元素为口径：Reading = img 槽位、
 *  Live = widget span；chrome/block 经所属 frame 生效域读取——Reading 的
 *  frame 是 img 的父级，Live 的 frame 即槽位自身；隐藏视图槽位按布局
 *  在场过滤——getClientRects 为空 = 不在版面） */
function mainImageSlots(): Array<{
  rawSrc: string; state: string; reason: string | undefined
  width: number; height: number
  inTable: boolean; inLink: boolean
  chromeButtons: number; block: boolean
}> {
  return Array.from(document.querySelectorAll<HTMLElement>('.vsidian-image'))
    .filter((slot) => slot.closest('.vsidian-embed-card') === null && slot.closest('.vsidian-hover-popup') === null)
    .filter((slot) => (slot.dataset['vsidianImgSrc'] ?? '') !== '')
    .filter((slot) => slot.getClientRects().length > 0)
    .map((slot) => {
      const frame = slot.classList.contains('vsidian-graphic-frame')
        ? slot
        : slot.closest<HTMLElement>('.vsidian-graphic-frame')
      const box = slot.getBoundingClientRect()
      return {
        rawSrc: slot.dataset['vsidianImgSrc'] ?? '',
        state: slot.dataset['vsidianImgState'] ?? '',
        reason: slot.dataset['vsidianImgReason'],
        width: box.width,
        height: box.height,
        inTable: slot.closest('table') !== null,
        inLink: slot.closest('a') !== null,
        chromeButtons: frame?.querySelectorAll('.vsidian-graphic-chrome button').length ?? 0,
        block: (frame ?? slot).classList.contains('vsidian-image-block'),
      }
    })
}

/** 按图源采样前 count 枚可见槽位的中心像素（文档序；绘制层一致性断言） */
function sampleSlotsOf(rawSrc: string, count: number): Array<{ r: number; g: number; b: number; a: number } | null> {
  return Array.from(document.querySelectorAll<HTMLElement>('.vsidian-image'))
    .filter((node) => node.closest('.vsidian-embed-card') === null && node.closest('.vsidian-hover-popup') === null)
    .filter((node) => (node.dataset['vsidianImgSrc'] ?? '') === rawSrc && node.getClientRects().length > 0)
    .slice(0, count)
    .map((node) => sampleCenter(node))
}

/** 指定图源的全部主正文槽位（按 rawSrc 过滤） */
function slotsOf(rawSrc: string): ReturnType<typeof mainImageSlots> {
  return mainImageSlots().filter((s) => s.rawSrc === rawSrc)
}

Object.assign(window, {
  controller,
  initDoc336(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'img336', docUri: 'file:///d%3A/notes/parent.md', version: 1, text })
  },
  setLiveCursor336(pos: number): boolean {
    const found = findLiveView()
    if (!found) return false
    found.dispatch({ selection: { anchor: pos } })
    return true
  },
  setMode336(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  serveImg336(src: string, url: string | null) {
    served.set(src, url)
  },
  respondHost(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  sent336(): WebviewToHost[] {
    return [...sent]
  },
  makeDataPng,
  makeDataUri,
  makeDataBmp,
  makeApng,
  sampleCenter,
  sampleSlotsOf,
  slotsOf,
  svgScriptFlag(): boolean {
    return svgScriptRan
  },
  /** 注入恶意 SVG 样本（脚本 + onload 内联事件）：仅经 <img> 资源加载，
   *  不得注入 SVG DOM / object / iframe——脚本执行哨兵保持 false */
  makeEvilSvg(): string {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">'
      + '<rect width="24" height="24" fill="rgb(180, 30, 30)"/>'
      + '<script>svgScriptRan = true</script></svg>'
    const evil = svg.replace('<rect', '<rect onload="svgScriptRan = true"')
    return 'data:image/svg+xml;base64,' + btoa(evil)
  },
  setSvgFlag(v: boolean) {
    svgScriptRan = v
  },
  /** 直接解码探测（管线外的解码器下界矩阵）：load+naturalWidth>0 = 支持 */
  async probeDecode(uri: string): Promise<boolean> {
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0)
      img.onerror = () => resolve(false)
      img.src = uri
    })
  },
  /** 浮层内图片观测（rawSrc / 已应用 src / chrome / 绘制像素） */
  readPopupImage(): {
    present: boolean
    rawSrc: string
    appliedSrc: string
    state: string
    chromeButtons: number
    pixel: { r: number; g: number; b: number; a: number } | null
  } {
    const popup = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    const img = popup?.querySelector<HTMLImageElement>('img') ?? null
    return {
      present: img !== null,
      rawSrc: img?.dataset['vsidianImgSrc'] ?? '',
      appliedSrc: img?.getAttribute('src') ?? '',
      state: img?.dataset['vsidianImgState'] ?? '',
      chromeButtons: popup?.querySelectorAll('.vsidian-graphic-frame .vsidian-graphic-chrome button').length ?? 0,
      pixel: img ? sampleCenter(img) : null,
    }
  },
  /** 图片弹窗（查看大图）在场观测（diagramPopup 几何内核共享 overlay） */
  imagePopupOpen(): boolean {
    return document.querySelector('.vsidian-diagram-overlay') !== null
  },
})
