// 图片弹窗与防误触交互契约（工单 #212，控制器级 jsdom，对齐
// graphicInteraction.test.ts 模式）：按钮组构成（live 双钮 / 阅读单钮 /
// 链接内嵌与表格内不发射）、吞点击（光标不动、widget 不退场、零写回）、
// edit 落位、弹窗开关与 img 槽位装载、刷新重定位（含定位不到兜底）与
// invalidateAll 联动、导出消息形态（外链禁用）、image.test.popup 钩子、
// 协议校验与纯函数矩阵。真实键鼠与观感回归在 test/browser 与集成层。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import {
  closeImagePopup,
  isImagePopupOpen,
  locateImageOccurrence,
  suggestImageExportFileName,
} from '../../src/webview/imagePopup'
import { closeDiagramPopup, isDiagramPopupOpen } from '../../src/webview/diagramPopup'
import {
  __resetMermaidRenderStateForTest,
  __setMermaidApiForTest,
  type MermaidApi,
} from '../../src/webview/mermaidRender'
import { isHostToWebview, isWebviewToHost, type WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/img.md'
const PIC = './assets/pic%20a.png'
const DOC = [
  '# 图片弹窗',
  '',
  `![示例图](${PIC})`,
  '',
  `[![内嵌图](${PIC})](https://example.com/x)`,
  '',
  '| a | b |',
  '|---|---|',
  `| ![表格图](${PIC}) | 2 |`,
  '',
  `![外链图](https://example.com/remote.png)`,
  '',
].join('\n')

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

interface Harness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
  setController(c: WebviewSyncController | null): void
  /** 更新解析替身的地址映射（刷新用例中途换版本地址） */
  setServed(next: Map<string, string>): void
}

/** bridge 内同步回灌 image.request（宿主解析替身；rawSrc → 可加载地址） */
function makeHarness(initial = new Map<string, string>()): Harness {
  const sent: WebviewToHost[] = []
  let controller: WebviewSyncController | null = null
  let served = initial
  const bridge: VsCodeBridge = {
    postMessage: (m) => {
      const msg = m as WebviewToHost
      sent.push(msg)
      if (msg.kind === 'image.request' && served.has(msg.src)) {
        controller?.handleHostMessage({
          kind: 'image.result',
          reqId: msg.reqId,
          ok: true,
          src: served.get(msg.src)!,
        })
      }
    },
    getState: () => undefined,
    setState: () => undefined,
  }
  return {
    bridge,
    sent,
    setController(c) {
      controller = c
    },
    setServed(next) {
      served = next
    },
  }
}

async function settle(times = 14): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function mountDoc(h: Harness, text = DOC): WebviewSyncController {
  const c = new WebviewSyncController(h.bridge)
  h.setController(c)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  c.mount(parent)
  c.handleHostMessage({
    kind: 'init',
    sessionId: 's1',
    docUri: DOC_URI,
    version: 1,
    text,
  })
  // 光标初始在文档头（图片源码区间内，widget 不发射）：移到文末
  const view = c.getView()!
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  return c
}

function liveChromeFrames(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>('.vsidian-graphic-frame.vsidian-image'))
}

/** 已装载图片的手动 load 确认（jsdom 不真加载字节；result 回灌由 bridge
 *  替身同步完成） */
async function confirmLoads() {
  await settle()
  for (const img of document.querySelectorAll<HTMLImageElement>('.vsidian-image img')) {
    img.dispatchEvent(new Event('load'))
  }
  await settle()
}

afterEach(() => {
  closeImagePopup()
  closeDiagramPopup()
  __resetMermaidRenderStateForTest()
  document.body.textContent = ''
})

describe('Live 视图：按钮组构成与排除项（契约 1）', () => {
  it('loaded 普通图片挂 frame（edit+popup 两枚）；链接内嵌与表格网格内不挂（无按钮组）', async () => {
    const h = makeHarness(new Map([
      ['./assets/pic a.png', 'https://res/pic-a.png'],
      ['https://example.com/remote.png', 'https://example.com/remote.png'],
    ]))
    const c = mountDoc(h)
    await confirmLoads()
    const content = c.getView()!.dom
    const frames = liveChromeFrames(content)
    // 普通图片 1 枚（示例图）+ 外链图 1 枚；内嵌/表格图不挂
    expect(frames).toHaveLength(2)
    for (const frame of frames) {
      const buttons = frame.querySelectorAll('.vsidian-graphic-chrome button')
      expect(buttons).toHaveLength(2)
      expect(frame.querySelector('.vsidian-graphic-chrome-edit')).not.toBeNull()
      expect(frame.querySelector('.vsidian-graphic-chrome-popup')).not.toBeNull()
    }
    // 内嵌图片 widget 保持普通槽位形态（无 frame 类、无 chrome）
    const inlineImg = Array.from(
      content.querySelectorAll<HTMLElement>('.vsidian-image'),
    ).find((el) => el.title === '内嵌图')!
    expect(inlineImg.classList.contains('vsidian-graphic-frame')).toBe(false)
    expect(inlineImg.querySelector('.vsidian-graphic-chrome')).toBeNull()
    // 表格内图片同（点击落单元格源码的现状前提）
    const tableImg = Array.from(
      content.querySelectorAll<HTMLElement>('.vsidian-image'),
    ).find((el) => el.title === '表格图')!
    expect(tableImg.classList.contains('vsidian-graphic-frame')).toBe(false)
    expect(tableImg.querySelector('.vsidian-graphic-chrome')).toBeNull()
  })

  it('加载态图片无 chrome（loaded 才有按钮，同构代码块渲染成功态）', async () => {
    const h = makeHarness()
    const c = mountDoc(h, `![示例图](${PIC})
`)
    await settle()
    // 不回灌 result：图片停在 loading——装饰已发射但 render 回调未执行，
    // frame 类在槽位上（chrome 形态确定）而按钮组 DOM 尚未挂载
    const frames = liveChromeFrames(c.getView()!.dom)
    expect(frames.length).toBeGreaterThanOrEqual(1)
    for (const frame of frames) {
      expect(frame.querySelector('.vsidian-graphic-chrome')).toBeNull()
    }
  })
})

describe('Live 视图：吞点击与 edit 落位（契约 2–3）', () => {
  it('点击图片本体：光标不落位、widget 不退场、零写回（防误触本体）', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    await confirmLoads()
    const view = c.getView()!
    const anchorBefore = view.state.selection.main.anchor
    const frame = liveChromeFrames(view.dom).find((el) => el.title === '示例图')!
    frame.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    frame.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(view.state.selection.main.anchor).toBe(anchorBefore)
    expect(liveChromeFrames(view.dom).length).toBeGreaterThanOrEqual(1)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    expect(view.state.doc.toString()).toBe(DOC)
  })

  it('点击 edit 按钮：光标落图片源码起点、widget 退场显源文、零写回', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    await confirmLoads()
    const view = c.getView()!
    const frame = liveChromeFrames(view.dom).find((el) => el.title === '示例图')!
    const edit = frame.querySelector('.vsidian-graphic-chrome-edit') as HTMLButtonElement
    edit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    edit.click()
    await settle()
    expect(view.state.selection.main.anchor).toBe(DOC.indexOf('![示例图]'))
    expect(liveChromeFrames(view.dom).find((el) => el.title === '示例图')).toBeUndefined()
    expect(view.state.doc.toString()).toBe(DOC)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})

describe('图片弹窗（契约 4–6）', () => {
  it('popup 打开：img 槽位装载、role=dialog、overflow 锁定；Esc 关闭恢复并释放槽位', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom).find((el) => el.title === '示例图')!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    expect(isImagePopupOpen()).toBe(true)
    const overlay = document.querySelector('.vsidian-diagram-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute('role')).toBe('dialog')
    const popupImg = overlay!.querySelector<HTMLImageElement>('.vsidian-diagram-media img')
    expect(popupImg).not.toBeNull()
    expect(popupImg!.getAttribute('src')).toBe('https://res/pic-a.png')
    expect(popupImg!.dataset['vsidianImgSrc']).toBe('./assets/pic a.png')
    expect(document.body.style.overflow).toBe('hidden')
    overlay!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(isImagePopupOpen()).toBe(false)
    expect(document.querySelector('.vsidian-diagram-overlay')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    // 弹窗图片槽位已释放（src 清空、状态类归零）
    expect(popupImg!.getAttribute('src')).toBeNull()
  })

  it('弹窗与图表弹窗互斥：打开图片弹窗后开图表弹窗，图片弹窗关闭', async () => {
    __setMermaidApiForTest({
      initialize() {},
      async render() {
        return { svg: '<svg viewBox="0 0 10 10"></svg>' }
      },
    } satisfies MermaidApi)
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h, `![示例图](${PIC})\n\n\`\`\`mermaid\nA-->B\n\`\`\`\n`)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom)[0]!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    expect(isImagePopupOpen()).toBe(true)
    // 开图表弹窗（模块函数直驱，与按钮回调同函数）
    const { openGraphicPopup } = await import('../../src/webview/diagramPopup')
    openGraphicPopup('mermaid', 'A-->B')
    await settle()
    expect(isImagePopupOpen()).toBe(false)
    expect(isDiagramPopupOpen()).toBe(true)
    // 反向：图片弹窗夺回
    const { openImagePopup } = await import('../../src/webview/imagePopup')
    openImagePopup('./assets/pic a.png', '示例图')
    await settle()
    expect(isDiagramPopupOpen()).toBe(false)
    expect(isImagePopupOpen()).toBe(true)
  })

  it('刷新重定位：图仍在文档中走 image.invalidate 重取（新 reqId 新地址）；图被删维持快照', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png?v=1']]))
    const c = mountDoc(h, `![示例图](${PIC})\n`)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom)[0]!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    const popupImg = document.querySelector<HTMLImageElement>('.vsidian-diagram-media img')!
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png?v=1')
    const requestsBefore = h.sent.filter((m) => m.kind === 'image.request').length
    // 图仍在文档中：刷新 → invalidate → 新请求 → 替身回灌新版本地址
    h.setServed(new Map([['./assets/pic a.png', 'https://res/pic-a.png?v=2']]))
    ;(document.querySelector('.vsidian-diagram-refresh') as HTMLButtonElement).click()
    await settle()
    expect(h.sent.filter((m) => m.kind === 'image.request').length).toBe(requestsBefore + 1)
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png?v=2')
    // 图被删（文档中无该 rawSrc）：刷新维持快照（无新请求、地址不变）
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '# 空文\n' } })
    await settle()
    const before = h.sent.filter((m) => m.kind === 'image.request').length
    ;(document.querySelector('.vsidian-diagram-refresh') as HTMLButtonElement).click()
    await settle()
    expect(h.sent.filter((m) => m.kind === 'image.request').length).toBe(before)
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png?v=2')
  })

  it('全局刷新（refresh.invalidated）联动弹窗内同图失效重载（同一资源状态机）', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png?v=1']]))
    const c = mountDoc(h, `![示例图](${PIC})\n`)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom)[0]!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    const popupImg = document.querySelector<HTMLImageElement>('.vsidian-diagram-media img')!
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png?v=1')
    // refresh.invalidated 的 webview 动作本体 = 管理器 invalidateAll（消息
    // 分支直驱同一调用；弹窗 img 是槽位，随全量失效重挂取新代次地址）
    h.setServed(new Map([['./assets/pic a.png', 'https://res/pic-a.png?v=3']]))
    ;(c as unknown as { images: { invalidateAll(): void } }).images.invalidateAll()
    await settle()
    const requestCount = h.sent.filter((m) => m.kind === 'image.request').length
    expect(requestCount).toBeGreaterThanOrEqual(2)
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png?v=3')
  })

  it('导出：经桥发出 image.export（reqId/src/建议文件名/会话字段）；全程零写回', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom).find((el) => el.title === '示例图')!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    ;(document.querySelector('.vsidian-diagram-export-image') as HTMLButtonElement).click()
    await settle()
    const msg = h.sent.find((m): m is Extract<WebviewToHost, { kind: 'image.export' }> =>
      m.kind === 'image.export')
    expect(msg).toBeDefined()
    expect(msg!.src).toBe('./assets/pic a.png')
    expect(msg!.fileName).toBe('pic a.png')
    expect(msg!.sessionId).toBe('s1')
    expect(msg!.docUri).toBe(DOC_URI)
    expect(msg!.reqId).toBeGreaterThan(0)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('外链图：导出按钮禁用 + 悬停提示，不发 image.export', async () => {
    const h = makeHarness()
    const c = mountDoc(h)
    await confirmLoads()
    const frame = liveChromeFrames(c.getView()!.dom).find((el) => el.title === '外链图')!
    ;(frame.querySelector('.vsidian-graphic-chrome-popup') as HTMLButtonElement).click()
    await settle()
    const btn = document.querySelector('.vsidian-diagram-export-image') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    // disabled 不派发 click；悬停提示由 wrapper span 承担
    expect(btn.parentElement?.title).not.toBe('')
    btn.click()
    await settle()
    expect(h.sent.filter((m) => m.kind === 'image.export')).toHaveLength(0)
  })

  it('image.test.popup 钩子：按序号点 popup 按钮；action 只点工具条不重开弹窗', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    await confirmLoads()
    c.handleHostMessage({ kind: 'image.test.popup', view: 'live', index: 0 })
    await settle()
    expect(isImagePopupOpen()).toBe(true)
    c.handleHostMessage({ kind: 'image.test.popup', view: 'live', index: 0, action: 'export' })
    await settle()
    expect(isImagePopupOpen()).toBe(true)
    expect(h.sent.find((m) => m.kind === 'image.export')).toBeDefined()
    c.handleHostMessage({ kind: 'image.test.popup', view: 'live', index: 0, action: 'close' })
    await settle()
    expect(isImagePopupOpen()).toBe(false)
  })
})

describe('阅读视图：按钮组形态（契约 1 的阅读侧）', () => {
  it('非链接/非表格图片包进 frame，按钮组仅 popup 一枚（无 edit）', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    await settle()
    await confirmLoads()
    const container = document.querySelector<HTMLElement>('.vsidian-view-reading')!
    const frames = Array.from(
      container.querySelectorAll<HTMLElement>('.vsidian-graphic-frame.vsidian-image'),
    )
    // 阅读侧普通图片 2 枚（示例图 + 外链图；markdown-it 渲染外链 img）
    expect(frames.length).toBe(2)
    for (const frame of frames) {
      const buttons = frame.querySelectorAll('.vsidian-graphic-chrome button')
      expect(buttons).toHaveLength(1)
      expect(frame.querySelector('.vsidian-graphic-chrome-edit')).toBeNull()
      expect(frame.querySelector('.vsidian-graphic-chrome-popup')).not.toBeNull()
      // chrome 是 img 的后置兄弟（CSS 兄弟选择器前提）
      expect(frame.querySelector('img.vsidian-image')?.nextElementSibling?.classList.contains('vsidian-graphic-chrome')).toBe(true)
    }
    // 链接内嵌图片不包 frame（点击保留链接跳转语义）
    const inLinkImg = Array.from(container.querySelectorAll<HTMLImageElement>('img.vsidian-image')).find(
      (img) => img.alt === '内嵌图',
    )!
    expect(inLinkImg).toBeDefined()
    expect(inLinkImg.closest('a')).not.toBeNull()
    expect(inLinkImg.parentElement?.classList.contains('vsidian-graphic-frame')).toBe(false)
    // 表格内图片不包 frame
    const inTableImg = Array.from(container.querySelectorAll<HTMLImageElement>('img.vsidian-image')).find(
      (img) => img.alt === '表格图',
    )!
    expect(inTableImg.closest('table')).not.toBeNull()
    expect(inTableImg.parentElement?.classList.contains('vsidian-graphic-frame')).toBe(false)
  })

  it('阅读侧独行图 frame 挂块级修饰类，文字混排图不挂（:only-child 误伤回归钉住）', async () => {
    const text = [
      `![独行图](${PIC})`,
      '',
      `文字前缀 ![混排图](${PIC}) 文字后缀`,
      '',
    ].join('\n')
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h, text)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    await settle()
    await confirmLoads()
    const container = document.querySelector<HTMLElement>('.vsidian-view-reading')!
    const frames = Array.from(
      container.querySelectorAll<HTMLElement>('.vsidian-graphic-frame.vsidian-image'),
    )
    expect(frames.length).toBe(2)
    const solo = frames.find((f) => f.querySelector('img')?.alt === '独行图')!
    const mixed = frames.find((f) => f.querySelector('img')?.alt === '混排图')!
    expect(solo.classList.contains('vsidian-image-block')).toBe(true)
    // 混排段的 frame 虽是段落唯一元素子节点（文本节点不参与 :only-child
    // 伪类），JS 判定看到非空白文本——不得块级化，否则混排图被误独占一行
    expect(mixed.classList.contains('vsidian-image-block')).toBe(false)
  })

  it('阅读侧 popup 打开同一弹窗单例；image.test.popup 钩子按 reading 视图定位', async () => {
    const h = makeHarness(new Map([['./assets/pic a.png', 'https://res/pic-a.png']]))
    const c = mountDoc(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    await settle()
    await confirmLoads()
    c.handleHostMessage({ kind: 'image.test.popup', view: 'reading', index: 0 })
    await settle()
    expect(isImagePopupOpen()).toBe(true)
    const popupImg = document.querySelector<HTMLImageElement>('.vsidian-diagram-media img')!
    expect(popupImg.getAttribute('src')).toBe('https://res/pic-a.png')
    closeImagePopup()
  })
})

describe('纯函数矩阵', () => {
  it('locateImageOccurrence：标准/尖括号/带标题边界命中；纯文本提及与改写后不命中', () => {
    const doc = `前文 ![a](./x y.png) 中段\n[![b](<./x y.png>)](u)\n![c](./x y.png "标题")\n看 ./x y.png 提及\n![d](./z.png)\n`
    expect(locateImageOccurrence(doc, './x y.png')).toBe(true)
    expect(locateImageOccurrence(doc, './z.png')).toBe(true)
    expect(locateImageOccurrence(doc, './w.png')).toBe(false)
    expect(locateImageOccurrence(doc, '')).toBe(false)
    // 子串形态不误命中：目标为更长地址的前缀时不得算定位到
    expect(locateImageOccurrence('![a](./x.png.bak)', './x.png')).toBe(false)
    // 引用式提及（无 ]( 前缀）不算
    expect(locateImageOccurrence('文字 ./x y.png 结尾', './x y.png')).toBe(false)
    // 文档为 %20 编码原文：解码形态直接找不到时以 encodeURI 回查命中
    expect(locateImageOccurrence('![a](./assets/pic%20a.png)', './assets/pic a.png')).toBe(true)
    // 两种形态都不在（被改写为其他地址）才算定位不到
    expect(locateImageOccurrence('![a](./assets/other.png)', './assets/pic a.png')).toBe(false)
  })

  it('suggestImageExportFileName：解码 + 剥路径分隔 + 空名兜底（与宿主 sanitize 同值）', () => {
    expect(suggestImageExportFileName('./assets/pic%20a.png')).toBe('pic a.png')
    expect(suggestImageExportFileName('D:\\photos\\图 片.png')).toBe('图 片.png')
    expect(suggestImageExportFileName('https://example.com/a/b.png')).toBe('b.png')
    expect(suggestImageExportFileName('https://example.com/')).toBe('image.png')
  })
})

describe('新增协议消息结构校验', () => {
  it('image.export：合法通过；缺字段/空 src/超长 fileName 拒绝', () => {
    const base = { kind: 'image.export', sessionId: 's1', docUri: DOC_URI, reqId: 1, src: './a.png', fileName: 'a.png' }
    expect(isWebviewToHost(base)).toBe(true)
    expect(isWebviewToHost({ ...base, reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ ...base, src: '' })).toBe(false)
    expect(isWebviewToHost({ ...base, src: 5 })).toBe(false)
    expect(isWebviewToHost({ ...base, fileName: '' })).toBe(false)
    expect(isWebviewToHost({ ...base, fileName: 'x'.repeat(256) })).toBe(false)
    expect(isWebviewToHost({ kind: 'image.export', sessionId: 's1', docUri: DOC_URI, reqId: 1, src: 'a' })).toBe(false)
  })

  it('image.export.result：reason 枚举校验', () => {
    expect(isHostToWebview({ kind: 'image.export.result', reqId: 1, ok: true })).toBe(true)
    expect(isHostToWebview({ kind: 'image.export.result', reqId: 1, ok: false, reason: 'cancelled' })).toBe(true)
    for (const reason of ['invalid', 'not-found', 'read-failed', 'writeFailed']) {
      expect(isHostToWebview({ kind: 'image.export.result', reqId: 1, ok: false, reason })).toBe(true)
    }
    expect(isHostToWebview({ kind: 'image.export.result', reqId: 1, ok: false, reason: 'whatever' })).toBe(false)
    expect(isHostToWebview({ kind: 'image.export.result', reqId: 0, ok: true })).toBe(false)
    expect(isHostToWebview({ kind: 'image.export.result', reqId: 1, ok: 'yes' })).toBe(false)
  })

  it('image.test.popup：view/index/action 枚举校验', () => {
    expect(isHostToWebview({ kind: 'image.test.popup', view: 'live', index: 0 })).toBe(true)
    expect(isHostToWebview({ kind: 'image.test.popup', view: 'reading', index: 2, action: 'export' })).toBe(true)
    expect(isHostToWebview({ kind: 'image.test.popup', view: 'both', index: 0 })).toBe(false)
    expect(isHostToWebview({ kind: 'image.test.popup', view: 'live', index: -1 })).toBe(false)
    expect(isHostToWebview({ kind: 'image.test.popup', view: 'live', index: 0, action: 'export-png' })).toBe(false)
  })
})
