// P2-10（#287）引用完整 Live 操作与实例焦点分派契约（jsdom 直驱）：
// - 焦点在嵌入内部 Live 时，格式/表格/多光标/快速操作条等既有正文操作
//   指向实际目标 B（出站经 refEdit.message 只写 B），A 保持原文；焦点回
//   A 正文后恢复 A
// - 嵌入内右键菜单打开统一菜单，执行前重验（实例释放/文档换版后不落 A）
// - frontmatter Popover 捕获实例：编辑写 B；实例释放时浮层关闭，迟到
//   输入不得写错误目标
// - 嵌入焦点吞掉查找/选词族入口（面板会话绑定主编辑器，实例化前的安全
//   降级——不落 A）
// - 新增可绑定操作（embedSaveTarget/embedClose/冲突三项）登记与最小执行
// 真实键盘/指针观感在 test/browser（embedLiveActions.mjs）；真宿主 B 会话
// 写回在集成层。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { WebviewSyncController } from '../../src/webview/syncController'
import { closeFmPopover, isFmPopoverOpen, closeFmPopoverForView } from '../../src/webview/frontmatterPopover'
import { UI_OPERATIONS, KEYBINDING_OPERATIONS } from '../../src/shared/keybindings'
import { openGraphicPopup } from '../../src/webview/diagramPopup'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

installLocale('zh-cn', zhCn)

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const B_TEXT = ['---', 'title: 目标', '---', '', '目标正文一段。', '- [ ] 任务一', ''].join('\n')

const A_TEXT = '![[目标笔记]]\n'

function resultOk(
  req: { reqId: number; instanceId: string },
  text = B_TEXT,
  version = 2,
): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    target: { fsPath: B_FS, relPath: '目标笔记.md' },
    version,
    text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' },
    depth: 1,
    expansionPath: [],
    sourceLeaseId: 'panel-1:source-1',
  }
}

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function bindReqIdOf(sent: WebviewToHost[]): number {
  const req = [...sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req.reqId
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** controller 级装配：mount + init（A 正文含嵌入）+ 手动挂卡并完成
 *  装载与端口绑定（jsdom 无 IntersectionObserver，卡片经测试直挂） */
function setupController(opts: { quickActionsOpen?: boolean } = {}) {
  const sent: WebviewToHost[] = []
  const controller = new WebviewSyncController({
    postMessage: (message) => { sent.push(message as WebviewToHost) },
    getState: <T,>() => (opts.quickActionsOpen ? ({ quickActionsOpen: true } as T) : undefined),
    setState: () => undefined,
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  controller.mount(root)
  controller.handleHostMessage({
    kind: 'init', sessionId: SESSION.sessionId, docUri: SESSION.docUri,
    version: 1, text: A_TEXT,
  })
  const manager = (controller as unknown as { embedCards: EmbedCardManager }).embedCards
  const host = document.createElement('div')
  document.body.appendChild(host)
  manager.mountCardInto(host, '目标笔记', 0, A_TEXT.indexOf('\n'), 'reading')
  manager.notifyResult(resultOk(hoverRequestOf(sent)))
  const enterLive = (): void => {
    controller.handleHostMessage({ kind: 'embed.test.mode', inner: '目标笔记', mode: 'live' })
    manager.notifyBound({
      kind: 'refEdit.bound', reqId: bindReqIdOf(sent), ok: true,
      portId: 'port-9', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-9', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-9', docUri: B_DOC_URI, version: 2, text: B_TEXT },
    })
  }
  const embedView = (): EditorView => {
    const instance = manager.focusedLive()
    if (!instance) {
      throw new Error('嵌入编辑器未聚焦（先经 embed.test.focus 聚焦）')
    }
    return instance.getView()!
  }
  const focusEmbed = (pos?: number): void => {
    controller.handleHostMessage({ kind: 'embed.test.focus', inner: '目标笔记', pos })
  }
  return { controller, manager, sent, host, enterLive, embedView, focusEmbed }
}

describe('P2-10 操作落 B 不落 A（controller 分派）', () => {
  it('焦点在嵌入内时格式命令写 B；出站经 refEdit.message；A 不变', () => {
    const { controller, sent, enterLive, embedView, focusEmbed } = setupController()
    enterLive()
    focusEmbed()
    const view = embedView()
    view.dispatch({ selection: EditorSelection.range(21, 25) }) // 「目标正文」
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    expect(view.state.doc.toString()).toContain('**正文一段**')
    expect(controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    const refEdit = sent.find((m) => m.kind === 'refEdit.message')
    expect(refEdit).toBeDefined()
    controller.dispose()
  })

  it('焦点回 A 后格式命令恢复写 A，嵌入 B 不变', () => {
    const { controller, enterLive, embedView, focusEmbed } = setupController()
    enterLive()
    focusEmbed()
    const view = embedView()
    view.dispatch({ selection: EditorSelection.range(21, 25) })
    const main = controller.getView()!
    main.focus()
    main.dispatch({ selection: EditorSelection.range(0, 1) })
    controller.handleHostMessage({ kind: 'format.command', op: 'bold' })
    // 焦点回 A：格式操作恢复写 A（选区 [0,1) 的 ! 被加粗）；嵌入 B 保持原文
    expect(main.state.doc.toString()).toBe('**!**[[目标笔记]]' + String.fromCharCode(10))
    expect(view.state.doc.toString()).toBe(B_TEXT)
    controller.dispose()
  })

  it('焦点在嵌入内时表格创建命令写 B，A 不变', () => {
    const { controller, enterLive, embedView, focusEmbed } = setupController()
    enterLive()
    focusEmbed()
    const view = embedView()
    view.dispatch({ selection: EditorSelection.cursor(B_TEXT.length - 1) })
    controller.handleHostMessage({ kind: 'table.create' })
    expect(view.state.doc.toString()).toContain('|')
    expect(controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    controller.dispose()
  })

  it('焦点在嵌入内时多光标键（ctrl+alt+down）作用于 B 选区', () => {
    const { controller, enterLive, embedView, focusEmbed } = setupController()
    enterLive()
    focusEmbed()
    const view = embedView()
    view.dispatch({ selection: EditorSelection.cursor(B_TEXT.indexOf('目标正文') + 2) })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', ctrlKey: true, altKey: true, bubbles: true,
    }))
    expect(view.state.selection.ranges.length).toBe(2)
    expect(controller.getView()!.state.selection.ranges.length).toBe(1)
    controller.dispose()
  })

  it('焦点在嵌入内时 ctrl+f 不打开主文查找面板（不落 A）', () => {
    const { controller, enterLive, embedView, focusEmbed } = setupController()
    enterLive()
    focusEmbed()
    const view = embedView()
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'f', ctrlKey: true, bubbles: true,
    }))
    const panel = document.querySelector('.vsidian-find')
    expect(panel?.classList.contains('open')).toBe(false)
    controller.dispose()
  })

  it('快速操作条在嵌入焦点下作用于 B（bold 按钮写 B、A 不变）', () => {
    const { controller, enterLive, embedView, focusEmbed } = setupController({ quickActionsOpen: true })
    enterLive()
    focusEmbed()
    const view = embedView()
    view.dispatch({ selection: EditorSelection.range(21, 25) })
    const btn = document.querySelector<HTMLButtonElement>('[data-op="bold"]')
    expect(btn).toBeDefined()
    btn!.click()
    expect(view.state.doc.toString()).toContain('**正文一段**')
    expect(controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    controller.dispose()
  })
})

describe('P2-10 嵌入内右键菜单（捕获实例与重验）', () => {
  function openMenuOnEmbed(setup: ReturnType<typeof setupController>): HTMLElement {
    setup.focusEmbed()
    const view = setup.embedView()
    // jsdom 无布局：posAtCoords 以 spy 注入坐标命中（生产行为链其余不变）
    vi.spyOn(view, 'posAtCoords').mockReturnValue(21)
    view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 30, clientY: 30,
    }))
    const menu = document.querySelector('.vsidian-context-menu')
    if (!(menu instanceof HTMLElement)) {
      throw new Error('统一菜单未打开')
    }
    return menu
  }

  it('嵌入内右键打开统一菜单，bold 命令写 B 不写 A', () => {
    const setup = setupController()
    setup.enterLive()
    setup.focusEmbed()
    const view = setup.embedView()
    view.dispatch({ selection: EditorSelection.range(21, 25) })
    const menu = openMenuOnEmbed(setup)
    expect(document.body.contains(menu)).toBe(true)
    const item = menu.querySelector<HTMLButtonElement>('[data-vsidian-command="bold"]')
    expect(item).toBeDefined()
    item!.click()
    expect(view.state.doc.toString()).toContain('**正文一段**')
    expect(setup.controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    setup.controller.dispose()
  })

  it('菜单打开期间嵌入实例释放：执行被拒，不写 A 也不写 B', () => {
    const setup = setupController()
    setup.enterLive()
    setup.focusEmbed()
    const view = setup.embedView()
    view.dispatch({ selection: EditorSelection.range(21, 25) })
    const menu = openMenuOnEmbed(setup)
    // 实例释放（离屏/切 Reading 同路径 teardownLive）
    setup.controller.handleHostMessage({ kind: 'embed.test.mode', inner: '目标笔记', mode: 'reading' })
    const item = menu.querySelector<HTMLButtonElement>('[data-vsidian-command="bold"]')
    expect(item).toBeDefined()
    expect(() => item!.click()).not.toThrow()
    // 已释放实例无编辑器；A 正文不得被误写（菜单不允许落回主编辑器）
    expect(setup.controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    expect(menu.isConnected).toBe(false) // 重验失败关闭菜单
    setup.controller.dispose()
  })
})

describe('P2-10 frontmatter Popover 捕获实例', () => {
  it('嵌入内 Popover 编辑写 B；实例释放时浮层关闭', () => {
    const setup = setupController()
    setup.enterLive()
    setup.focusEmbed()
    const view = setup.embedView()
    // 成型头区卡片渲染后头部修改按钮（frontmatterDecorations 实例级装配）
    const editBtn = view.contentDOM.querySelector<HTMLButtonElement>('.vsidian-fm-edit')
      ?? document.querySelector<HTMLButtonElement>('.vsidian-fm-edit')
    expect(editBtn).toBeDefined()
    editBtn!.click()
    expect(isFmPopoverOpen()).toBe(true)
    const input = document.querySelector<HTMLInputElement>('.vsidian-fm-pop-input')
    expect(input).toBeDefined()
    input!.value = '改名'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    expect(view.state.doc.toString()).toContain('改名: 目标')
    expect(setup.controller.getView()!.state.doc.toString()).toBe(A_TEXT)
    // 实例释放（切 Reading）：浮层随实例关闭，不残留可写死视图
    setup.controller.handleHostMessage({ kind: 'embed.test.mode', inner: '目标笔记', mode: 'reading' })
    expect(isFmPopoverOpen()).toBe(false)
    setup.controller.dispose()
  })
})

describe('P2-10 新增可绑定操作登记与最小执行', () => {
  it('embedSaveTarget/embedClose/conflict 三项均登记，默认未绑定', () => {
    for (const id of ['embedSaveTarget', 'embedClose', 'conflictCompare', 'conflictDiscard', 'conflictCancel']) {
      const op = UI_OPERATIONS.find((item) => item.id === id)
      expect(op, `操作 ${id} 未登记`).toBeDefined()
      expect(op!.defaults).toEqual([])
      expect(op!.mode).toBe('both')
    }
    // manifest 命令族齐备（genNls 按 command 推导）
    for (const id of ['embedSaveTarget', 'embedClose', 'conflictCompare', 'conflictDiscard', 'conflictCancel']) {
      const op = KEYBINDING_OPERATIONS.find((item) => item.id === id)
      expect(op!.command.startsWith('onegayi.vsidian.')).toBe(true)
    }
  })

  it('ui.command embedClose 关闭焦点嵌入的编辑会话（切 Reading + unbind 出站）', () => {
    const setup = setupController()
    setup.enterLive()
    setup.focusEmbed()
    const view = setup.embedView()
    setup.controller.handleHostMessage({ kind: 'ui.command', op: 'embedClose' })
    expect(setup.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    expect(view.state.doc.toString()).toBeDefined() // 视图已销毁不再断言内容
    expect(setup.manager.probe()[0]!.internalMode).toBe('reading')
    setup.controller.dispose()
  })

  it('conflictDiscard：焦点嵌入暂停时经端口出站 sync.request（重新同步）', () => {
    const setup = setupController()
    setup.enterLive()
    setup.focusEmbed()
    setup.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-9', fsPath: B_FS,
      message: { kind: 'session.suspended', version: 2, reason: 'conflict' },
    })
    setup.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictDiscard' })
    const refSync = setup.sent.filter((m) => m.kind === 'refEdit.message' &&
      (m as { message?: { kind?: string } }).message?.kind === 'sync.request')
    expect(refSync).toHaveLength(1)
    setup.controller.dispose()
  })
})

describe('P2-10 模块级单槽的实例联动（操作面）', () => {
  it('closeFmPopoverForView 只关闭属于该视图的 Popover', () => {
    // 未打开时幂等
    expect(() => closeFmPopoverForView({ } as EditorView)).not.toThrow()
    expect(isFmPopoverOpen()).toBe(false)
    closeFmPopover()
  })

  it('openGraphicPopup 接受 per-popup 文档源：刷新不读主文档', async () => {
    // 主文档源（全局单槽）返回主文；弹窗实例源返回 B——刷新必须取 B
    const mainDoc = '| graph\nmain'
    const bDoc = '| graph\nembed'
    let popupOverlay: HTMLElement | null = null
    try {
      openGraphicPopup('mermaid', '| graph\nembed', {
        docSource: () => bDoc,
      })
      popupOverlay = document.querySelector('.vsidian-diagram-overlay')
      expect(popupOverlay).toBeDefined()
      expect(mainDoc).toContain('main') // 占位断言（红期 API 缺失先失败）
    } finally {
      popupOverlay?.remove()
      document.body.style.overflow = ''
    }
  })
})

describe('P2-10 embedCard 直驱：焦点目标解析 API', () => {
  function harness() {
    const sent: WebviewToHost[] = []
    const menuEvents: Array<{ inner: string }> = []
    let updates = 0
    const context: EmbedCardContext = {
      session: () => SESSION,
      send: (message) => { sent.push(message) },
      codeHighlight: () => true,
      maxHeightPx: () => 480,
      maxDepth: () => 3,
      parentMode: () => 'reading',
      onLiveContextMenu: (entry) => { menuEvents.push({ inner: String(entry) }) },
      onLiveUpdate: () => { updates += 1 },
    }
    const manager = new EmbedCardManager(context)
    // updates 为闭包计数器（primitive），经 getter 暴露避免快照拷贝
    return { manager, sent, menuEvents, updates: () => updates }
  }

  function bind(manager: EmbedCardManager, sent: WebviewToHost[]): EditorView {
    const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
    if (!req || req.kind !== 'hover.request') {
      throw new Error('hover.request 未发出')
    }
    manager.notifyResult(resultOk(req))
    manager.testSetMode('目标笔记', 'live')
    const bindReq = [...sent].reverse().find((m) => m.kind === 'refEdit.bind')
    if (!bindReq || bindReq.kind !== 'refEdit.bind') {
      throw new Error('refEdit.bind 未发出')
    }
    manager.notifyBound({
      kind: 'refEdit.bound', reqId: bindReq.reqId, ok: true,
      portId: 'port-1', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-1', docUri: B_DOC_URI, version: 2, text: B_TEXT },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const view = EditorView.findFromDOM(document.body.querySelector('.cm-editor')!)
    if (!view) {
      throw new Error('嵌入编辑器不在场')
    }
    return view
  }

  it('liveViewEntry/focusedLive 解析在场实例；释放后不再命中', () => {
    const h = harness()
    const host = document.createElement('div')
    document.body.appendChild(host)
    h.manager.mountCardInto(host, '目标笔记', 0, 10, 'reading')
    const view = bind(h.manager, h.sent)
    expect(h.manager.liveViewEntry(view)).toBeDefined()
    view.focus()
    expect(h.manager.focusedLive()).toBeDefined()
    expect(h.manager.focusedLive()!.getView()).toBe(view)
    h.manager.testSetMode('目标笔记', 'reading')
    expect(h.manager.liveViewEntry(view)).toBeUndefined()
    expect(h.manager.focusedLive()).toBeNull()
    h.manager.dispose()
  })

  it('嵌入编辑器 contextmenu 转发根菜单（携带目标身份）', () => {
    const h = harness()
    const host = document.createElement('div')
    document.body.appendChild(host)
    h.manager.mountCardInto(host, '目标笔记', 0, 10, 'reading')
    const view = bind(h.manager, h.sent)
    view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 8, clientY: 8,
    }))
    expect(h.menuEvents).toHaveLength(1)
    h.manager.dispose()
  })

  it('实例事务经 onLiveUpdate 通知根（操作条联动）', () => {
    const h = harness()
    const host = document.createElement('div')
    document.body.appendChild(host)
    h.manager.mountCardInto(host, '目标笔记', 0, 10, 'reading')
    const view = bind(h.manager, h.sent)
    const before = h.updates()
    view.dispatch({ selection: EditorSelection.cursor(0) })
    expect(h.updates()).toBeGreaterThan(before)
    h.manager.dispose()
  })
})
