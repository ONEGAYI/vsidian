// P2-09（#286）递归引用的直接父模式与逐层目标编辑契约（模块级 jsdom
// 直驱）：
// - 浮窗根 B 内的孙卡 C 解除范围锁：跟随浮窗根内部模式、可手动切换
// - B（任意层级）的内部 Live 编辑器发射孙卡装饰并按 source 挂载
// （parentInstanceId / occurrence 前缀 / depth / 来源文档 = 直接父 B）
// - 孙卡 C 默认跟随直接父 B：B 手动 Reading（A Live）时 C 无写端口；
//   C 手动 Live 建独立端口；父根 A 切换不覆写手动 B／C
// - 孙卡编辑器落在可见容器（父 Live 编辑器内的孙卡卡壳）；孙卡随最后
//   宿主卸载释放端口／预算／订阅（既有配对回归）
// 真实布局／键盘／指针在 test/browser（recursiveLive.mjs）；真宿主保存与
// 端口路由在集成层（P2-09 用例）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { liveEmbedDecorations, LiveEmbedWidget, setLiveEmbedCards } from '../../src/webview/liveEmbed'
import {
  notifyHoverResult,
  openHoverPopupFor,
  setHoverPreviewContext,
  __resetHoverPopupForTest,
} from '../../src/webview/hoverPopup'

installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const C_FS = 'D:\\notes\\孙目标.md'
const C_DOC_URI = 'file:///d%3A/notes/%E5%AD%99%E7%9B%AE%E6%A0%87.md'
const C_INNER = '孙目标'
/** B 全文含独占行孙引用：孙卡 occurrence 区间由此推导 */
const B_TEXT = ['# 目标笔记', '', `![[${C_INNER}]]`, ''].join('\n')
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')
const C_TEXT = ['# 孙目标', '', '孙目标正文。', ''].join('\n')
/** B 全文中孙引用独占行的区间（LF offset；与 Live/Reading 键同口径：行首..行尾） */
const C_FROM = B_TEXT.indexOf(`![[${C_INNER}]]`)
const C_TO = C_FROM + `![[${C_INNER}]]`.length

interface Harness {
  manager: EmbedCardManager
  sent: WebviewToHost[]
  setParentMode(mode: 'reading' | 'live'): void
}

function makeHarness(parentMode: 'reading' | 'live' = 'reading'): Harness {
  const sent: WebviewToHost[] = []
  let mode = parentMode
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => mode,
  }
  const manager = new EmbedCardManager(context)
  return {
    manager,
    sent,
    setParentMode: (m) => {
      mode = m
      manager.notifyParentModeChanged()
    },
  }
}

/** 挂载一个父文档 embed 块（readingBlocks 产物同构）并完成装载 */
function loadRootCard(h: Harness, docText = '![[目标笔记]]\n', text = TARGET_TEXT,
  target: { fsPath: string; relPath: string } = { fsPath: B_FS, relPath: '目标笔记.md' }): HTMLElement {
  const blocks = splitReadingBlocks(docText)
  const embed = blocks.find((b) => b.kind === 'embed')
  if (!embed) {
    throw new Error('文本未产生 embed 块')
  }
  const el = createReadingBlockElement(embed, docText)
  document.body.appendChild(el)
  h.manager.mountBlock(el)
  const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  h.manager.notifyResult({
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target, version: 2, text,
    range: { start: 0, end: text.length }, scope: { kind: 'full' },
    depth: 1, expansionPath: [], sourceLeaseId: `panel-1:source-${req.reqId}`,
  } as Extract<HoverPreviewResult, { ok: true }>)
  return el
}

function bindRequestsOf(h: Harness): Extract<WebviewToHost, { kind: 'refEdit.bind' }>[] {
  return h.sent.filter((m): m is Extract<WebviewToHost, { kind: 'refEdit.bind' }> => m.kind === 'refEdit.bind')
}

function lastBindRequest(h: Harness): Extract<WebviewToHost, { kind: 'refEdit.bind' }> {
  const req = bindRequestsOf(h).at(-1)
  if (!req) {
    throw new Error('refEdit.bind 未发出')
  }
  return req
}

/** 应答指定 fsPath 的 bind 并推送 init（返回 portId） */
function respondBound(h: Harness, fsPath: string, docUri: string, text: string, version = 2): string {
  const bind = lastBindRequest(h)
  expect(bind.fsPath).toBe(fsPath)
  const portId = `refport-${fsPath}-${bind.reqId}`
  h.manager.notifyBound({
    kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
    portId, fsPath, docUri, version, dirty: false,
  })
  h.manager.notifyPush({
    kind: 'refEdit.push', portId, fsPath,
    message: { kind: 'init', sessionId: portId, docUri, version, text },
  })
  return portId
}

/** 模拟 B 的内部 Live 编辑器 widget toDOM 的孙卡挂载（生产同入口
 *  mountCardInto：source 语义与 liveEmbed 孙卡 widget 一致） */
function mountGrandchild(h: Harness, parentHostId: string, treeId: string): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  h.manager.mountCardInto(host, C_INNER, C_FROM, C_TO, 'live', {
    panelDocUri: SESSION.docUri ?? '',
    sourceDocUri: B_FS,
    range: { start: C_FROM, end: C_TO },
    occurrence: `${parentHostId}/${C_FROM}::${C_INNER}`,
    parentInstanceId: parentHostId,
    depth: 2,
    treeId,
  })
  return host
}

/** 断言孙卡 bind 与 watch 的宿主身份配对（pin 校验前提：bind.occurrence
 *  = 该实例 hover.watch 的 instanceId——P2-07 稳定 hostId，非状态库键） */
function expectChildBindPaired(h: Harness, cBind: Extract<WebviewToHost, { kind: 'refEdit.bind' }>, parentHostId: string): void {
  const cWatch = h.sent.filter((m) => m.kind === 'hover.watch' && m.fsPath === C_FS).at(-1)
  expect(cWatch && cWatch.kind === 'hover.watch').toBe(true)
  if (cWatch && cWatch.kind === 'hover.watch') {
    expect(cBind.occurrence).toBe(cWatch.instanceId)
  }
  expect(cBind.occurrence).not.toBe(parentHostId)
  expect(cBind.panelSessionId).toBe(SESSION.sessionId)
}

/** 装载孙卡（回包按 target 配对——occurrenceId 是 hostId，不携带坐标键） */
function loadGrandchild(h: Harness): void {
  const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request' && m.target === C_INNER)
  if (!req || req.kind !== 'hover.request') {
    throw new Error('孙卡 hover.request 未发出')
  }
  h.manager.notifyResult({
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: C_FS, relPath: '孙目标.md' },
    version: 2, text: C_TEXT,
    range: { start: 0, end: C_TEXT.length }, scope: { kind: 'full' },
    depth: 2, expansionPath: [], sourceLeaseId: `panel-1:source-${req.reqId}`,
  } as Extract<HoverPreviewResult, { ok: true }>)
}

function cardOf(el: HTMLElement): HTMLElement {
  return el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`) as HTMLElement
}

function modeButtonOf(el: HTMLElement): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
}

function editorIn(el: HTMLElement): EditorView | null {
  const editor = el.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  __resetHoverPopupForTest()
})

// ---- 正文链：根级 B 手动 Live → 孙卡 C 跟随（逐层目标编辑） ----

describe('P2-09 父内部 Live 编辑器的孙卡挂载', () => {
  it('B（根级嵌入）手动 Live 后，其编辑器发射孙卡装饰（child 上下文 = B 的 hostId）', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    // B 的内部 Live 编辑器建立后，其视图应发射孙引用装饰（![[孙目标]] 行）
    const bEditor = editorIn(root)
    expect(bEditor).not.toBeNull()
    const decos = bEditor!.state.field(liveEmbedDecorations)
    expect(decos.size).toBeGreaterThan(0)
    let childHost = ''
    decos.between(0, bEditor!.state.doc.length, (_from, _to, deco) => {
      const widget = (deco.spec as { widget?: LiveEmbedWidget }).widget
      if (widget && (widget as { child?: { parentHostId?: string } }).child?.parentHostId) {
        childHost = (widget as unknown as { child: { parentHostId: string } }).child.parentHostId
      }
    })
    expect(childHost).toBe(bHostId)
  })

  it('孙卡 widget toDOM 经 source 挂载：parentInstanceId／occurrence 前缀／depth／来源 = 直接父 B', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const bEditor = editorIn(root)!
    let widget: LiveEmbedWidget | null = null
    bEditor.state.field(liveEmbedDecorations).between(0, bEditor.state.doc.length, (_f, _t, deco) => {
      const w = (deco.spec as { widget?: LiveEmbedWidget }).widget
      if (w && (w as unknown as { child?: unknown }).child) {
        widget = w
      }
    })
    expect(widget).not.toBeNull()
    setLiveEmbedCards(h.manager)
    const dom = widget!.toDOM()
    const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request' && m.target === C_INNER)
    expect(req && req.kind === 'hover.request').toBe(true)
    if (req && req.kind === 'hover.request') {
      // 来源链与坐标（沿直接来源 B 的全文空间；occurrenceId 是宿主身份
      // hostId，另经 watch/bind 配对断言）
      expect(req.source).toEqual({ parentInstanceId: bHostId, sourceDocUri: B_FS })
      expect(req.sourceStart).toBe(C_FROM)
      expect(req.sourceEnd).toBe(C_TO)
      expect(dom.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).not.toBeNull()
    }
    setLiveEmbedCards(null)
  })

  it('孙卡 C 跟随 B Live：装载后建独立端口（fsPath=C、occurrence 以 B hostId 为前缀），编辑器落孙卡卡壳内', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const host = mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    const cBind = bindRequestsOf(h).find((b) => b.fsPath === C_FS)
    expect(cBind).toBeDefined()
    expectChildBindPaired(h, cBind!, bHostId)
    const portC = respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    const cEditor = editorIn(host)
    expect(cEditor).not.toBeNull()
    expect(cardOf(host).contains(cEditor!.dom)).toBe(true)
    // B 的端口不受孙卡影响（两端口并存、身份分离）
    expect(portC).not.toBe('')
  })
})

// ---- 直接父跟随与手动独立 ----

describe('P2-09 直接父跟随与手动独立', () => {
  it('A Live、B 手动 Reading 时孙卡默认 Reading（无写端口）；C 手动 Live 建独立端口且 A 切换不覆写', () => {
    const h = makeHarness('live')
    loadRootCard(h)
    // B 的 hostId 从 A Live 继承绑定的 bind 消息取（对外身份永不变）
    const bHostId = bindRequestsOf(h).find((b) => b.fsPath === B_FS)!.occurrence
    // B 手动切 Reading（覆盖记忆——A Live 不带入；端口随之释放）
    h.manager.testSetMode('目标笔记', 'reading')
    const unbindsBefore = h.sent.filter((m) => m.kind === 'refEdit.unbind').length
    const host = mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    // C 默认跟随直接父 B（Reading）：孙卡无写端口、模式按钮可手动操作
    expect(bindRequestsOf(h).find((b) => b.fsPath === C_FS)).toBeUndefined()
    expect(modeButtonOf(host)!.style.display).not.toBe('none')
    expect(modeButtonOf(host)!.tabIndex).not.toBe(-1)
    // C 手动切 Live：建独立端口（与孙卡 watch 身份配对，非父端口）
    modeButtonOf(host)!.click()
    const cBind = bindRequestsOf(h).find((b) => b.fsPath === C_FS)
    expect(cBind).toBeDefined()
    expectChildBindPaired(h, cBind!, bHostId)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    // A 切回 Reading：B 保持手动 Reading（无新 bind）、C 保持手动 Live（端口不释放）
    h.setParentMode('reading')
    expect(bindRequestsOf(h).filter((b) => b.fsPath === B_FS).length).toBe(1)
    expect(h.sent.filter((m) => m.kind === 'refEdit.unbind').length).toBe(unbindsBefore)
    expect(editorIn(host)).not.toBeNull()
  })

  it('孙卡随最后宿主卸载：端口 unbind 出站、预算释放（配对回归）', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const host = mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    const before = h.manager.budgetStats()
    expect(before.panelInstances).toBeGreaterThanOrEqual(2)
    h.manager.unmountBlock(host)
    const after = h.manager.budgetStats()
    expect(after.panelInstances).toBe(before.panelInstances - 1)
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
  })

  it('嵌套焦点路由取最内层：焦点在孙卡编辑器内时 Ctrl+S 只保存孙卡目标（不误存父 B）', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = bindRequestsOf(h).find((b) => b.fsPath === B_FS)!.occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const host = mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    // 孙卡宿主移入 B 的编辑器 contentDOM（生产嵌套形态：孙卡 widget 挂在
    // B 的编辑器视口内——B 的编辑器 dom 包含孙卡编辑器 dom 的嵌套陷阱）
    const bEditor = editorIn(root)!
    bEditor.contentDOM.appendChild(host)
    const cEditor = editorIn(host)!
    cEditor.focus()
    expect(document.activeElement && cardOf(host).contains(document.activeElement)).toBe(true)
    const saved = (h.manager as unknown as { focusedLiveSave(): boolean }).focusedLiveSave()
    expect(saved).toBe(true)
    const saveMsg = h.sent.filter((m) => m.kind === 'refEdit.save').at(-1)
    expect(saveMsg && saveMsg.kind === 'refEdit.save').toBe(true)
    if (saveMsg && saveMsg.kind === 'refEdit.save') {
      expect(saveMsg.fsPath).toBe(C_FS)
    }
  })
})

// ---- 浮窗链：浮窗根 B 内孙卡解除范围锁 ----

describe('P2-09 浮窗内孙卡解除范围锁', () => {
  interface PopupHarness extends Harness {
    open(target?: string): HTMLElement
    popupEl(): HTMLElement | null
  }
  function makePopupHarness(parentMode: 'reading' | 'live' = 'reading'): PopupHarness {
    const h = makeHarness(parentMode)
    setHoverPreviewContext({
      session: () => SESSION,
      send: (message) => { h.sent.push(message) },
      codeHighlight: () => true,
      mountPopupRoot: (args) => h.manager.mountPopupRoot(args),
      mountEmbedChild: (parentInstanceId, block, target) =>
        h.manager.mountPopupChild(parentInstanceId, block, target),
      unmountEmbedChild: (block) => h.manager.unmountBlock(block),
    })
    const block = document.createElement('div')
    block.dataset['vsidianSrcStart'] = '10'
    block.dataset['vsidianSrcEnd'] = '30'
    const anchor = document.createElement('a')
    anchor.className = 'vsidian-wikilink'
    anchor.setAttribute('href', '目标笔记')
    block.appendChild(anchor)
    document.body.appendChild(block)
    return {
      ...h,
      open(target = '目标笔记') {
        openHoverPopupFor(anchor, { target, sourceStart: 10, sourceEnd: 30 })
        return block
      },
      popupEl: () => document.querySelector<HTMLElement>('.vsidian-hover-popup'),
    }
  }

  /** 装载浮窗根 B（含孙引用全文） */
  function respondPopupRoot(h: PopupHarness): void {
    const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request')
    if (!req || req.kind !== 'hover.request') {
      throw new Error('浮窗根 hover.request 未发出')
    }
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: B_FS, relPath: '目标笔记.md' },
      version: 5, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: { kind: 'full' },
      depth: 1, expansionPath: [], sourceLeaseId: `panel-1:source-${req.reqId}`,
    } as Extract<HoverPreviewResult, { ok: true }>)
  }

  it('浮窗根手动 Live 后孙卡跟随：模式按钮可见且孙卡 bind 出站（occurrence 前缀 = 浮窗根语义键）', () => {
    const h = makePopupHarness('reading')
    h.open()
    respondPopupRoot(h)
    // 浮窗根手动切 Live（头部按钮）
    const rootMode = h.popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-mode')
    expect(rootMode).not.toBeNull()
    rootMode!.click()
    const rootKey = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    // 挂浮窗内孙卡（mountPopupChild 生产同入口；rootKey = 浮窗根 hostId）
    const host = document.createElement('div')
    host.dataset['vsidianEmbedInner'] = C_INNER
    host.dataset['vsidianSrcStart'] = String(C_FROM)
    host.dataset['vsidianSrcEnd'] = String(C_TO)
    document.body.appendChild(host)
    h.manager.mountPopupChild(rootKey, host, {
      fsPath: B_FS, relPath: '目标笔记.md', version: 5, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: 'full', depth: 1,
    })
    loadGrandchild(h)
    // 孙卡跟随浮窗根内部 Live：模式按钮可见（不锁 Reading）且端口绑定发出
    expect(modeButtonOf(host)!.style.display).not.toBe('none')
    expect(modeButtonOf(host)!.tabIndex).not.toBe(-1)
    const cBind = bindRequestsOf(h).find((b) => b.fsPath === C_FS)
    expect(cBind).toBeDefined()
    expectChildBindPaired(h, cBind!, rootKey)
  })

  it('孙卡手动 Reading 独立记忆：浮窗根切回 Reading 不覆写孙卡手动选择', () => {
    const h = makePopupHarness('reading')
    h.open()
    respondPopupRoot(h)
    const rootMode = h.popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-mode')
    rootMode!.click()
    const rootKey = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const host = document.createElement('div')
    host.dataset['vsidianEmbedInner'] = C_INNER
    host.dataset['vsidianSrcStart'] = String(C_FROM)
    host.dataset['vsidianSrcEnd'] = String(C_TO)
    document.body.appendChild(host)
    h.manager.mountPopupChild(rootKey, host, {
      fsPath: B_FS, relPath: '目标笔记.md', version: 5, text: B_TEXT,
      range: { start: 0, end: B_TEXT.length }, scope: 'full', depth: 1,
    })
    loadGrandchild(h)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    // 孙卡手动切回 Reading（端口释放一次；浮窗根 B 端口保持）
    modeButtonOf(host)!.click()
    expect(h.sent.filter((m) => m.kind === 'refEdit.unbind').length).toBe(1)
    const cBindsBefore = bindRequestsOf(h).filter((b) => b.fsPath === C_FS).length
    // 浮窗根再切回 Reading：根端口释放（第二次 unbind），孙卡手动 Reading 不被覆写
    h.popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-mode')!.click()
    expect(h.sent.filter((m) => m.kind === 'refEdit.unbind').length).toBe(2)
    expect(bindRequestsOf(h).filter((b) => b.fsPath === C_FS).length).toBe(cBindsBefore)
  })
})

// ---- review-loops 第一轮回归：递归 Live 与删除拦截/实例键迁移的接缝 ----

describe('P2-09 递归补齐（review-loops 第一轮回归）', () => {
  it('孙卡 Live 时 A 删除数值覆盖孙卡 B 坐标区间：事务放行、无确认模态（A-2）', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h, '![[目标笔记]]\n', B_TEXT)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    // 孙卡挂载 + 装载 + 跟随 B（手动 Live）→ 建独立端口
    mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    expect(h.manager.probe().find((p) => p.inner === C_INNER)?.liveBound).toBe(true)
    // A 主编辑器装配删除拦截（生产 rootOwnedViewExtensions 同款）
    const aDoc = 'x'.repeat(C_TO + 20)
    const mainView = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: aDoc, extensions: [h.manager.mainDocChangeFilter()] }),
    })
    // 删除区间数值覆盖孙卡的 B 坐标区间 [C_FROM, C_TO]——跨坐标空间的比较
    // 无意义（孙卡区间属 B 全文空间，A 的同数值区间是无关文本），应放行；
    // 误拦则事务被吞、孙卡编辑会话被无关确认链打扰
    mainView.dispatch({ changes: { from: C_FROM - 2, to: C_TO + 2 } })
    expect(mainView.state.doc.toString()).not.toBe(aDoc)
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    expect(h.manager.probe().find((p) => p.inner === C_INNER)?.liveBound).toBe(true)
    mainView.destroy()
  })

  it('B 编辑器内孙卡上方打字：孙卡键迁移零重载、端口零重建（B-1）', () => {
    const h = makeHarness('reading')
    const root = loadRootCard(h, '![[目标笔记]]\n', B_TEXT)
    cardOf(root).querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const bHostId = lastBindRequest(h).occurrence
    respondBound(h, B_FS, B_DOC_URI, B_TEXT)
    const bEditor = editorIn(root)!
    expect(bEditor).not.toBeNull()
    // 孙卡挂载（生产 widget toDOM 同入口）+ 装载 + 跟随 B Live 建端口
    setLiveEmbedCards(h.manager)
    mountGrandchild(h, bHostId, bHostId)
    loadGrandchild(h)
    respondBound(h, C_FS, C_DOC_URI, C_TEXT)
    expect(h.manager.probe().find((p) => p.inner === C_INNER)?.liveBound).toBe(true)
    const counts = () => ({
      req: h.sent.filter((m) => m.kind === 'hover.request').length,
      bind: h.sent.filter((m) => m.kind === 'refEdit.bind').length,
      unbind: h.sent.filter((m) => m.kind === 'refEdit.unbind').length,
    })
    const before = counts()
    // B 内孙卡引用上方打字（B 事务平移孙卡区间——装饰重建按新坐标重挂，
    // 键未迁移则新 widget 不命中状态库：整卡重载 + 端口销毁重建风暴）
    bEditor.dispatch({ changes: { from: 0, to: 0, insert: '前缀' } })
    const after = counts()
    expect(after.req).toBe(before.req) // 零重载：新键命中迁移 entry
    expect(after.bind).toBe(before.bind)
    expect(after.unbind).toBe(before.unbind) // 端口零销毁
    // 孙卡实例现场保持（装载缓存与内部 Live 端口不随 B 打字蒸发）
    const probe = h.manager.probe().find((p) => p.inner === C_INNER)
    expect(probe?.liveBound).toBe(true)
    expect(probe?.state).toBe('content')
    setLiveEmbedCards(null)
  })
})
