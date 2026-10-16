// @vitest-environment jsdom
// #577 大纲条目 Ctrl 悬停弹出标题引用浮窗：面板容器委托（mouseover/
// mouseout）+ directTarget 形态（fsPath=当前面板文档、anchor=条目标题
// 字面文本——与大纲 copyLink 同源口径）+「先悬停后按 Ctrl」补触发 +
// 松开/移出关闭时序 + 设置门控（hover.outlinePreview / hover.enabled）+
// 重渲染释放（条目 DOM replaceChildren 不派发 mouseout，靠域释放）+
// hover.test.pointer 注入钩子的 outline 档。
// 装配模式与断言口径对齐 outlinePanel.test.ts（jsdom 控制器）与
// hoverPopup.test.ts（fake timers + view.state 探针）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  closeHoverPopup,
  HOVER_POPUP_CLOSE_DELAY_MS,
  HOVER_POPUP_OPEN_DELAY_MS,
} from '../../src/webview/hoverPopup'

// #94 起面板文案经 t() 取词：装配生产中文包，断言与字典同源
installLocale('zh-cn', zhCn)

// jsdom 无布局：CM6 视口测量的零值 polyfill（与 outlinePanel.test.ts 同款）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/outline.md'
const DOC_FS_PATH = 'd:\\notes\\outline.md'

const DOC = [
  '# 文档主标题',
  '',
  '## 甲章节',
  '',
  '甲正文段落。',
  '',
  '### 深层标题',
  '',
  '## 乙章节',
  '',
  '乙正文段落。',
  '',
].join('\n')

interface BridgeHarness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): BridgeHarness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => {},
  }
  return { bridge, sent }
}

/** 装配：init 携带 fsPath（宿主权威身份——webview 不自行从 docUri 转换） */
function mountOutline(
  h: BridgeHarness,
  opts: { withFsPath?: boolean; settings?: Record<string, unknown> } = {},
): { c: WebviewSyncController; parent: HTMLElement } {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  c.mount(parent)
  c.handleHostMessage({
    kind: 'init',
    sessionId: 's1',
    docUri: DOC_URI,
    ...(opts.withFsPath === false ? {} : { fsPath: DOC_FS_PATH }),
    version: 1,
    text: DOC,
  })
  if (opts.settings) {
    c.handleHostMessage({ kind: 'settings.snapshot', values: opts.settings })
  }
  return { c, parent }
}

function openSidebar(c: WebviewSyncController): void {
  c.handleHostMessage({ kind: 'sidebar.test.click' })
}

function outlineItems(parent: HTMLElement): HTMLElement[] {
  return [...parent.querySelectorAll<HTMLElement>('.vsidian-outline-item')]
}

/** 面板容器委托链路的真实事件派发（与 hover.test.pointer 同形态） */
function hoverEvent(item: HTMLElement, enter: boolean, ctrl = false): void {
  const rect = item.getBoundingClientRect()
  item.dispatchEvent(new MouseEvent(enter ? 'mouseover' : 'mouseout', {
    bubbles: true,
    relatedTarget: enter ? document.body : null,
    ctrlKey: ctrl,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }))
}

function pressControl(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Control', ctrlKey: true, bubbles: true,
  }))
}

function releaseControl(): void {
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
}

/** view.state 探针读取（hoverPreview 观测面） */
function viewState(c: WebviewSyncController, h: BridgeHarness) {
  const before = h.sent.length
  c.handleHostMessage({ kind: 'view.state.request' })
  const msg = h.sent.slice(before).find((m) => m.kind === 'view.state')
  if (!msg || msg.kind !== 'view.state') {
    throw new Error('view.state 未回报')
  }
  return msg
}

function hoverRequests(h: BridgeHarness) {
  return h.sent.filter((m) => m.kind === 'hover.request')
}

/** 宿主成功回包（markdown 全文 + heading 锚点定位语义——scope.anchor
 * 与请求锚点同值；P2-03 全文可达，range 给全文区间） */
function makeResponder(c: WebviewSyncController, h: BridgeHarness) {
  return () => {
    const req = hoverRequests(h).at(-1)
    if (!req || req.kind !== 'hover.request') {
      throw new Error('无在途 hover.request 可回包')
    }
    const anchor = req.directTarget?.anchor ?? ''
    c.handleHostMessage({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: true,
      target: { fsPath: DOC_FS_PATH, relPath: 'outline.md' },
      version: 1,
      text: DOC,
      range: { start: 0, end: DOC.length },
      scope: { kind: 'heading', anchor },
    })
  }
}

// 每用例收尾关闭浮层与挂载 DOM（jsdom 环境跨用例共享 document）
afterEach(() => {
  closeHoverPopup()
  document.body.innerHTML = ''
})

describe('#577 大纲 Ctrl 悬停：浮窗打开与 directTarget 载荷', () => {
  it('按住 Ctrl 悬停条目：开浮窗并出站 directTarget（fsPath=当前文档、anchor=标题字面文本）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      expect(items.length).toBeGreaterThanOrEqual(4)

      // Ctrl+悬停第 2 个条目（## 甲章节）
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      const reqs = hoverRequests(h)
      expect(reqs, '应出站 hover.request').toHaveLength(1)
      const req = reqs[0]!
      if (req.kind !== 'hover.request') {
        throw new Error('unreachable')
      }
      expect(req.docUri).toBe(DOC_URI)
      expect(req.directTarget, '面板形态走直接目标').toBeDefined()
      expect(req.directTarget?.fsPath).toBe(DOC_FS_PATH)
      expect(req.directTarget?.anchor).toBe('甲章节')
      expect(req.target).toBe('甲章节')
      expect(req.sourceStart).toBe(0)
      expect(req.sourceEnd).toBe(0)

      // 回包 → 内容态浮窗（view.state 探针；jsdom 无布局——块渲染计数
      // 恒 0，全文块数证据落在 browser/integration 真实布局用例）
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      const state = viewState(c, h)
      expect(state.hoverPreview?.open).toBe(true)
      expect(state.hoverPreview?.state).toBe('content')
      expect(state.hoverPreview?.scope).toBe('heading')
    } finally {
      vi.useRealTimers()
    }
  })

  it('无 Ctrl 悬停：不开浮窗、不出跳转目标提示（targetTip 语义归正文，不进大纲）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 600)
      expect(hoverRequests(h), '无修饰位不得开浮窗').toHaveLength(0)
      expect(h.sent.filter((m) => m.kind === 'hover.target.resolve'),
        '修饰位不足不出跳转目标提示').toHaveLength(0)
      const state = viewState(c, h)
      expect(state.hoverPreview?.open).not.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#577 大纲 Ctrl 悬停：补触发与关闭时序', () => {
  it('先悬停后按 Ctrl：keydown Control 补触发开浮窗（真实 document 捕获链路）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[2]!, true) // 无修饰位进入：现场已记录
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 200)
      expect(hoverRequests(h)).toHaveLength(0)
      pressControl()
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      const reqs = hoverRequests(h)
      expect(reqs, '补触发应开浮窗').toHaveLength(1)
      expect(reqs[0]?.kind === 'hover.request' && reqs[0].directTarget?.anchor).toBe('深层标题')
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      expect(viewState(c, h).hoverPreview?.open).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('松开 Ctrl：按既有 350ms 时序关闭（票面「移出/松开」语义）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      expect(viewState(c, h).hoverPreview?.open).toBe(true)
      releaseControl()
      expect(viewState(c, h).hoverPreview?.open, '关延迟内仍在场（350ms 时序）').toBe(true)
      vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
      expect(viewState(c, h).hoverPreview?.open, '松开 Ctrl 后按关延迟关闭').toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('移出条目：350ms 时序关闭；Esc 即关（浮窗既有语义）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      // 移出（relatedTarget 在条目外）
      hoverEvent(items[1]!, false)
      expect(viewState(c, h).hoverPreview?.open).toBe(true)
      vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
      expect(viewState(c, h).hoverPreview?.open).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#577 大纲 Ctrl 悬停：设置门控', () => {
  it('hover.outlinePreview 关闭：Ctrl 悬停不开；广播热更开启后即时生效', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h, { settings: { 'hover.outlinePreview': false } })
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 200)
      expect(hoverRequests(h), '开关关闭时 Ctrl 悬停不弹').toHaveLength(0)
      // 保存广播热更（settings.changed 全量广播）
      hoverEvent(items[1]!, false)
      c.handleHostMessage({ kind: 'settings.changed', values: { 'hover.outlinePreview': true } })
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      expect(hoverRequests(h), '开启后即时生效').toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hover.enabled 总开关关闭：大纲入口被前置拦截（入口统一门控）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h, { settings: { 'hover.enabled': false } })
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 200)
      expect(hoverRequests(h)).toHaveLength(0)
      pressControl()
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 200)
      expect(hoverRequests(h), '补触发路径同样受总开关管辖').toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('init 缺 fsPath（旧宿主）：安全降级不弹浮窗（directTarget 身份缺失）', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h, { withFsPath: false })
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      pressControl()
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS + 200)
      expect(hoverRequests(h)).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#577 大纲 Ctrl 悬停：标题条打开按钮与重渲染释放', () => {
  it('openAction 执行大纲现有跳转（located 高亮落位）且浮窗关闭', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      // 悬停「## 乙章节」（index 3）
      hoverEvent(items[3]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      const openBtn = document.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')
      expect(openBtn, '浮窗标题条打开按钮在场').not.toBeNull()
      openBtn!.click()
      // 跳转落位：located 高亮移到乙章节（index 3）；浮窗即关
      const state = viewState(c, h)
      expect(state.hoverPreview?.open).toBe(false)
      expect(state.outline?.locatedItemIndex).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('编辑触发条目重建：在场浮窗经域释放，不悬挂', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c, parent } = mountOutline(h)
      openSidebar(c)
      const items = outlineItems(parent)
      hoverEvent(items[1]!, true, true)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      makeResponder(c, h)()
      vi.advanceTimersByTime(50)
      expect(viewState(c, h).hoverPreview?.open).toBe(true)
      // 编辑文档：序列变化触发 renderOutlineItems 全量重建（不派发 mouseout）
      const doc = c.getView()!.state.doc
      c.getView()!.dispatch({ changes: { from: doc.length, insert: '\n## 重建后标题\n' } })
      // view.state 校准路径即时重建（outlineEnsureFresh）
      viewState(c, h)
      const after = viewState(c, h)
      expect(after.hoverPreview?.open, '锚点随旧 DOM 脱树，浮窗应被释放').toBe(false)
      expect(after.outline?.items.map((i) => i.text)).toContain('重建后标题')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#577 大纲悬停：hover.test.pointer 注入钩子（真宿主测试通道）', () => {
  it("link='outline' 档：enter+ctrlKey 开浮窗、leave 关闭（与用户悬停同一委托处理器）", () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const h = makeBridge()
      const { c } = mountOutline(h)
      openSidebar(c)
      c.handleHostMessage({ kind: 'hover.test.pointer', action: 'enter', index: 1, link: 'outline', ctrlKey: true })
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
      const reqs = hoverRequests(h)
      expect(reqs).toHaveLength(1)
      expect(reqs[0]?.kind === 'hover.request' && reqs[0].directTarget?.anchor).toBe('甲章节')
      c.handleHostMessage({ kind: 'hover.test.pointer', action: 'leave', index: 1, link: 'outline' })
      vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
      expect(viewState(c, h).hoverPreview?.open).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
