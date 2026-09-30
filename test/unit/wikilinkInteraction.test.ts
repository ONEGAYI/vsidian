// @vitest-environment jsdom
// 双链显示与跳转意图的 webview 契约（工单 #11）：
// - live 视图：光标在双链范围外以显示文字 widget 替换 `[[…]]`，进入范围
//   才显示源码（vsidian-wikilink 稳定类名）；代码上下文不装饰
// - live 渲染态单击或 Ctrl/Cmd+单击 = wikilink.activate 上报；
//   源码态普通单击编辑，嵌入/块引用形态不上报
// - 阅读视图：合法双链渲染为 a.vsidian-wikilink（href=原文 target，显示别名
//   或链接名）；单击上报意图；嵌入与块引用按原文显示
// - 全程零写回（显示与跳转意图不改文档）
// - 新增协议消息（wikilink.activate）与探针字段的结构校验
import { describe, it, expect, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import {
  WIKILINK_CLASS_NAMES,
  LiveWikilinkWidget,
  activateEmbedAtPos,
  activateWikilinkAtPos,
  buildWikilinkDecorationRanges,
  makeLinkMouseDownHandler,
} from '../../src/webview/liveLinks'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { isWebviewToHost, type WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/wikilinks.md'

const WIKILINK_DOC = [
  '# 双链样例',
  '',
  '正文含 [[目标笔记]] 与 [[子 目录/目标 二|别名]] 与 [[目标笔记#深处的标题]]。',
  '',
  '降级形态：![[嵌入目标]] 与 [[目标笔记^块]] 与 [[坏#]]。',
  '',
  '`行内代码 [[不装饰]]` 之后的正文。',
  '',
  '```text',
  '[[围栏内不装饰]]',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

interface Harness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): Harness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

let host: HTMLElement

function mount(h: Harness, text = WIKILINK_DOC): WebviewSyncController {
  host = document.createElement('div')
  const c = new WebviewSyncController(h.bridge)
  c.mount(host)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  return c
}

function sentOf<T extends WebviewToHost['kind']>(h: Harness, kind: T) {
  return h.sent.filter((m) => m.kind === kind)
}

type WikilinkActivate = Extract<WebviewToHost, { kind: 'wikilink.activate' }>

function viewState(c: WebviewSyncController, h: Harness) {
  const before = h.sent.length
  c.handleHostMessage({ kind: 'view.state.request' })
  const msg = h.sent.slice(before).find((m) => m.kind === 'view.state')
  if (!msg) {
    throw new Error('view.state 未回报')
  }
  return msg as Extract<WebviewToHost, { kind: 'view.state' }>
}

function readingContainer(): HTMLElement {
  return host.querySelector<HTMLElement>('.vsidian-view-reading')!
}

describe('实时预览：双链间接装饰（视口内按各自范围切换）', () => {
  function liveRanges(text: string, selection?: { anchor: number }) {
    const state = EditorState.create({
      doc: text,
      selection,
      extensions: [liveDecorationsField],
    })
    return buildWikilinkDecorationRanges(
      state.doc,
      state.field(liveDecorationsField).tree,
      state.selection,
      [{ from: 0, to: state.doc.length }],
      state.field(liveDecorationsField).fm,
    )
  }

  it('光标在双链范围外：`[[…]]` 整体替换为显示文字 widget', () => {
    const ranges = liveRanges(WIKILINK_DOC)
    const widgets = ranges.filter((r) => r.value.spec.widget instanceof LiveWikilinkWidget)
    // 合法双链 3 处（目标笔记 / 别名形态 / 标题形态）；降级与代码内不装饰
    expect(widgets.length).toBe(3)
    const displays = widgets.map(
      (r) => (r.value.spec.widget as LiveWikilinkWidget).displayText,
    )
    expect(displays).toContain('目标笔记')
    expect(displays).toContain('别名')
    expect(displays).toContain('目标笔记#深处的标题')
    // 区间覆盖含括号的完整 `[[…]]` 出现
    const first = widgets.find(
      (r) => (r.value.spec.widget as LiveWikilinkWidget).displayText === '目标笔记',
    )!
    expect(WIKILINK_DOC.slice(first.from, first.to)).toBe('[[目标笔记]]')
  })

  it('光标进入双链范围：不替换（源码可编辑），mark 类标记整个出现', () => {
    const pos = WIKILINK_DOC.indexOf('[[目标笔记]]') + 3
    const ranges = liveRanges(WIKILINK_DOC, { anchor: pos })
    const inLine = ranges.filter((r) => r.from <= pos && r.to >= WIKILINK_DOC.indexOf('[[目标笔记]]'))
    // #132 别名桥后类串为「vsidian-wikilink cm-hmd-internal-link」，按 token 包含
    const marks = inLine.filter((r) =>
      String(r.value.spec['class'] ?? '').split(' ').includes(WIKILINK_CLASS_NAMES.wikilink),
    )
    expect(marks.length).toBe(1)
    expect(WIKILINK_DOC.slice(marks[0]!.from, marks[0]!.to)).toBe('[[目标笔记]]')
    // 同一行不再有替换 widget
    const widgets = inLine.filter((r) => r.value.spec.widget !== undefined)
    expect(widgets.length).toBe(0)
  })

  it('同一行双链按各自范围切换源码与 widget', () => {
    const doc = '前 [[甲]] 中 [[乙|别名]] 后'
    const first = doc.indexOf('[[甲]]')
    const second = doc.indexOf('[[乙|别名]]')
    const widgets = (anchor: number) =>
      liveRanges(doc, { anchor })
        .filter((r) => r.value.spec.widget instanceof LiveWikilinkWidget)
        .map((r) => r.from)
    expect(widgets(doc.indexOf('中'))).toEqual([first, second])
    expect(widgets(doc.indexOf('甲'))).toEqual([second])
    expect(widgets(second + 1)).toEqual([first])
  })

  it('降级形态不装饰：块引用 ^、空标题；代码上下文不装饰', () => {
    const ranges = liveRanges(WIKILINK_DOC)
    for (const r of ranges) {
      const text = WIKILINK_DOC.slice(r.from, r.to)
      expect(text).not.toContain('目标笔记^块')
      expect(text).not.toContain('坏#')
      expect(text).not.toContain('不装饰')
    }
  })

  it('嵌入 ![[…]] 恢复链接装饰（#217 验收反馈）：混排常驻 mark、完整区间、代码上下文抑制', () => {
    // 混排嵌入 liveEmbed 永不接管，mark 常驻（源文常驻即有链接色）
    const ranges = liveRanges(WIKILINK_DOC)
    const marks = ranges.filter((r) =>
      String(r.value.spec['class'] ?? '').split(' ').includes(WIKILINK_CLASS_NAMES.wikilink) &&
      WIKILINK_DOC.slice(r.from, r.to).includes('嵌入目标'),
    )
    expect(marks.length).toBe(1)
    expect(WIKILINK_DOC.slice(marks[0]!.from, marks[0]!.to)).toBe('![[嵌入目标]]')
    // 无替换 widget 发射（嵌入呈现归 liveEmbed；渲染态替换文字属双链语义）
    expect(ranges.some((r) =>
      r.value.spec.widget instanceof LiveWikilinkWidget &&
      WIKILINK_DOC.slice(r.from, r.to).includes('嵌入目标'),
    )).toBe(false)
    // 围栏内嵌入字面文本不装饰（代码上下文抑制与双链同款）
    const fenced = liveRanges('```text\n![[围栏嵌入]]\n```\n')
    expect(fenced.some((r) =>
      String(r.value.spec['class'] ?? '').split(' ').includes(WIKILINK_CLASS_NAMES.wikilink),
    )).toBe(false)
  })

  it('独占行嵌入的 mark 发射跟随显隐（接管行归接管方）', () => {
    // 未触及（隐形态）：liveEmbed 整行 replace 接管，此处零发射——mark 与
    // 整行 replace 重叠会同帧渲染出被替换的源文（浏览器实测）
    const doc = '段落\n\n![[嵌入目标]]\n\n结尾'
    const at = doc.indexOf('![[嵌入目标]]')
    const hidden = liveRanges(doc)
    expect(hidden.some((r) =>
      String(r.value.spec['class'] ?? '').split(' ').includes(WIKILINK_CLASS_NAMES.wikilink) &&
      doc.slice(r.from, r.to).includes('嵌入目标'),
    )).toBe(false)
    // 触及（显形态）：liveEmbed 撤 replace、源文在场，mark 发射保有链接色
    const revealed = liveRanges(doc, { anchor: at + 4 })
    expect(revealed.some((r) =>
      String(r.value.spec['class'] ?? '').split(' ').includes(WIKILINK_CLASS_NAMES.wikilink) &&
      doc.slice(r.from, r.to) === '![[嵌入目标]]',
    )).toBe(true)
  })
})

describe('实时预览：渲染态双链单击跳转，源码态普通单击编辑', () => {
  it('非活动行渲染的双链普通单击也执行跳转', () => {
    const h = makeBridge()
    const c = mount(h, '普通行\n\n[[目标笔记]]\n')
    const view = c.getView()!
    const widget = host.querySelector<HTMLElement>('.vsidian-wikilink')!
    expect(widget).not.toBeNull()
    const pos = view.state.doc.toString().indexOf('目标笔记')
    const hit = vi.spyOn(view, 'posAtCoords').mockReturnValue(pos)
    try {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
      widget.dispatchEvent(event)
      expect(sentOf(h, 'wikilink.activate')).toHaveLength(0)
      view.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      expect(sentOf(h, 'wikilink.activate')).toHaveLength(1)
    } finally {
      hit.mockRestore()
      c.dispose()
    }
  })

  it('渲染双链上开始拖选时不跳转', () => {
    const h = makeBridge()
    const c = mount(h, '普通行\n\n[[目标笔记]]\n')
    const view = c.getView()!
    const widget = host.querySelector<HTMLElement>('.vsidian-wikilink')!
    const pos = view.state.doc.toString().indexOf('目标笔记')
    const hit = vi.spyOn(view, 'posAtCoords').mockReturnValue(pos)
    try {
      widget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      view.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 40, clientY: 10 }))
      expect(sentOf(h, 'wikilink.activate')).toHaveLength(0)
    } finally {
      hit.mockRestore()
      c.dispose()
    }
  })

  it('活动行源码态的普通 mousedown 不触发跳转', () => {
    const h = makeBridge()
    const c = mount(h, '普通行\n\n[[目标笔记]]\n')
    const view = c.getView()!
    const pos = view.state.doc.toString().indexOf('目标笔记')
    view.dispatch({ selection: { anchor: pos } })
    const mark = host.querySelector<HTMLElement>('.vsidian-wikilink')!
    expect(mark).not.toBeNull()
    const hit = vi.spyOn(view, 'posAtCoords').mockReturnValue(pos)
    try {
      mark.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(sentOf(h, 'wikilink.activate')).toHaveLength(0)
    } finally {
      hit.mockRestore()
      c.dispose()
    }
  })

  it('非活动行真实 widget 的 Ctrl+mousedown 经编辑器事件路由上报双链', () => {
    const h = makeBridge()
    const c = mount(h, '普通行\n\n[[目标笔记]]\n')
    const view = c.getView()!
    const widget = host.querySelector<HTMLElement>('.vsidian-wikilink')!
    expect(widget).not.toBeNull()
    const pos = view.state.doc.toString().indexOf('目标笔记')
    const hit = vi.spyOn(view, 'posAtCoords').mockReturnValue(pos)
    try {
      widget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true }))
      expect(sentOf(h, 'wikilink.activate')).toHaveLength(1)
    } finally {
      hit.mockRestore()
      c.dispose()
    }
  })

  function liveWithDoc(): { view: EditorView; parent: HTMLElement } {
    const state = EditorState.create({ doc: WIKILINK_DOC, extensions: [liveDecorationsField] })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({ state, parent })
    return { view, parent }
  }

  it('activateWikilinkAtPos：区间内位置上报原始 target（| 之前原文）与完整源区间', () => {
    const { view, parent } = liveWithDoc()
    try {
      const posted: Array<{ target: string; from: number; to: number }> = []
      const at = WIKILINK_DOC.indexOf('[[子 目录/目标 二|别名]]')
      const pos = at + 5
      expect(
        activateWikilinkAtPos(view, pos, (target, from, to) => posted.push({ target, from, to })),
      ).toBe(true)
      expect(posted).toEqual([{ target: '子 目录/目标 二', from: at, to: at + '[[子 目录/目标 二|别名]]'.length }])
    } finally {
      view.destroy()
      parent.remove()
    }
  })

  it('降级形态与普通文本位置不上报', () => {
    const { view, parent } = liveWithDoc()
    try {
      const posted: string[] = []
      const cb = (target: string) => posted.push(target)
      expect(activateWikilinkAtPos(view, WIKILINK_DOC.indexOf('目标笔记^块'), cb)).toBe(false)
      expect(activateWikilinkAtPos(view, WIKILINK_DOC.indexOf('围栏内不装饰'), cb)).toBe(false)
      expect(activateWikilinkAtPos(view, WIKILINK_DOC.indexOf('双链样例'), cb)).toBe(false)
      expect(posted).toEqual([])
    } finally {
      view.destroy()
      parent.remove()
    }
  })

  it('嵌入位置 Ctrl+点击上报（#217 验收反馈）：activateEmbedAtPos 分层——跳转路径命中、悬停判定族不命中', () => {
    const { view, parent } = liveWithDoc()
    try {
      // 跳转路径（activateEmbedAtPos，makeLinkMouseDownHandler 串联消费）
      const posted: Array<{ target: string; from: number; to: number }> = []
      const at = WIKILINK_DOC.indexOf('![[嵌入目标]]')
      expect(
        activateEmbedAtPos(view, at + 4, (target, from, to) => posted.push({ target, from, to })),
      ).toBe(true)
      expect(posted).toEqual([{ target: '嵌入目标', from: at, to: at + '![[嵌入目标]]'.length }])
      // 悬停判定族守卫（activateWikilinkAtPos 不含嵌入——嵌入已有常驻
      // 卡片不弹浮层；liveLinkSpecAt 消费双链版）
      expect(activateWikilinkAtPos(view, at + 4, () => {})).toBe(false)
      // Ctrl+mousedown 处理器路径：嵌入位置经 wikilink 分支串联命中
      const handler = makeLinkMouseDownHandler(() => {}, (target) => posted.push({ target, from: 0, to: 0 }))
      const hitView = { posAtCoords: () => at + 4, state: view.state } as unknown as EditorView
      expect(handler(new MouseEvent('mousedown', { ctrlKey: true, bubbles: true, cancelable: true }), hitView)).toBe(true)
    } finally {
      view.destroy()
      parent.remove()
    }
  })

  it('mousedown 处理器：Ctrl+单击命中双链上报并 preventDefault；普通单击不上报', () => {
    const { view, parent } = liveWithDoc()
    try {
      const posted: string[] = []
      const handler = makeLinkMouseDownHandler(
        () => {},
        (target) => posted.push(target),
      )
      const pos = WIKILINK_DOC.indexOf('目标笔记') // 首个合法双链内容位置
      const hitView = { posAtCoords: () => pos, state: view.state } as unknown as EditorView
      expect(handler(new MouseEvent('mousedown', { bubbles: true, cancelable: true }), hitView)).toBe(false)
      const evCtrl = new MouseEvent('mousedown', { ctrlKey: true, bubbles: true, cancelable: true })
      expect(handler(evCtrl, hitView)).toBe(true)
      expect(evCtrl.defaultPrevented).toBe(true)
      expect(posted).toEqual(['目标笔记'])
    } finally {
      view.destroy()
      parent.remove()
    }
  })
})

describe('阅读视图：双链渲染为 a.vsidian-wikilink 与单击上报', () => {
  it('合法双链渲染为可点击 a：href 为原文 target、显示别名或链接名；数量正确', () => {
    const h = makeBridge()
    const c = mount(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const anchors = Array.from(
      readingContainer().querySelectorAll<HTMLAnchorElement>(`a.${WIKILINK_CLASS_NAMES.wikilink}`),
    )
    expect(anchors.length).toBe(3)
    const hrefs = anchors.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('目标笔记')
    expect(hrefs).toContain('子 目录/目标 二')
    expect(hrefs).toContain('目标笔记#深处的标题')
    const texts = anchors.map((a) => a.textContent)
    expect(texts).toContain('别名')
    expect(texts).toContain('目标笔记#深处的标题')
  })

  it('降级形态按原文显示（源码保真）：嵌入与块引用不是可点击链接', () => {
    const h = makeBridge()
    const c = mount(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const text = readingContainer().textContent ?? ''
    expect(text).toContain('![[嵌入目标]]')
    expect(text).toContain('[[目标笔记^块]]')
    expect(text).toContain('[[坏#]]')
    expect(text).toContain('[[围栏内不装饰]]')
    // 行内代码内容按 <code> 呈现（反引号是标记被消费），双链不解析
    expect(text).toContain('行内代码 [[不装饰]]')
    // 全部 a 元素只有 3 个合法双链
    expect(readingContainer().querySelectorAll('a').length).toBe(3)
  })

  it('单击双链：上报 wikilink.activate（原始 target + 所在块源锚点），零写回', () => {
    const h = makeBridge()
    const c = mount(h)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const anchor = Array.from(
      readingContainer().querySelectorAll<HTMLAnchorElement>(`a.${WIKILINK_CLASS_NAMES.wikilink}`),
    ).find((a) => a.getAttribute('href') === '目标笔记#深处的标题')!
    anchor.click()
    const intents = sentOf(h, 'wikilink.activate') as WikilinkActivate[]
    expect(intents.length).toBe(1)
    expect(intents[0]!.target).toBe('目标笔记#深处的标题')
    expect(intents[0]!.sessionId).toBe('s1')
    expect(intents[0]!.docUri).toBe(DOC_URI)
    // 源位置：包含该双链的段落块锚点
    expect(intents[0]!.srcStart).toBe(WIKILINK_DOC.indexOf('正文含'))
    expect(intents[0]!.srcEnd).toBeGreaterThan(intents[0]!.srcStart)
    expect(sentOf(h, 'edit.request').length).toBe(0)
  })

  it('view.state 观测：liveWikilinkCount / readingWikilinkCount；文本逐字节不变', () => {
    const h = makeBridge()
    const c = mount(h)
    const live = viewState(c, h)
    // 3 处合法双链（widget/mark）+ 1 处混排嵌入 mark（#217 验收反馈起
    // 嵌入挂双链类恢复链接色，DOM 级计数随之计入；被整行 replace 吞没的
    // 独占行嵌入无 DOM 文本不命中）
    expect(live.liveWikilinkCount).toBe(4)
    expect(live.liveLinkCount ?? 0).toBe(0) // 样例不含普通链接
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const reading = viewState(c, h)
    expect(reading.readingWikilinkCount).toBe(3)
    expect(reading.text).toBe(WIKILINK_DOC)
    expect(sentOf(h, 'edit.request').length).toBe(0)
  })
})

describe('本文件锚点形态：[[#标题]] 与 [[#^块id]] 装饰与点击（#159）', () => {
  // 独立文档：不影响上方共享 WIKILINK_DOC 的计数断言。块 id 仅拉丁字母/
  // 数字/连字符（Obsidian 约束），中文 id 是非法形态
  const ANCHOR_DOC = [
    '# 当前笔记',
    '',
    '页内跳转 [[#当前笔记]] 与 [[#^target-blk|显示别名]] 两种形态。',
    '',
    '降级形态：[[#]] 与 [[#^]] 与 [[#坏#形态]]。',
    '',
    '目标块正文。',
    '目标块末行 ^target-blk',
    '',
  ].join('\n')

  it('live 装饰：display 默认锚点原文、别名优先；降级形态不装饰', () => {
    const h = makeBridge()
    const c = mount(h, ANCHOR_DOC)
    const state = c.getView()!.state
    const ranges = buildWikilinkDecorationRanges(
      state.doc,
      state.field(liveDecorationsField).tree,
      state.selection,
      [{ from: 0, to: state.doc.length }],
      state.field(liveDecorationsField).fm,
    )
    const widgets = ranges
      .filter((r) => r.value.spec.widget instanceof LiveWikilinkWidget)
      .map((r) => (r.value.spec.widget as LiveWikilinkWidget).displayText)
    expect(widgets).toEqual(['#当前笔记', '显示别名'])
    c.dispose()
  })

  it('阅读渲染：a.vsidian-wikilink 的 href 为 | 之前原文、text 为 display；降级按原文显示', () => {
    const h = makeBridge()
    const c = mount(h, ANCHOR_DOC)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const anchors = Array.from(
      readingContainer().querySelectorAll<HTMLAnchorElement>(`a.${WIKILINK_CLASS_NAMES.wikilink}`),
    )
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['#当前笔记', '#^target-blk'])
    expect(anchors.map((a) => a.textContent)).toEqual(['#当前笔记', '显示别名'])
    const text = readingContainer().textContent ?? ''
    expect(text).toContain('[[#]]')
    expect(text).toContain('[[#^]]')
    expect(text).toContain('[[#坏#形态]]')
    c.dispose()
  })

  it('阅读侧单击上报原始 target（含 # 前缀），零写回', () => {
    const h = makeBridge()
    const c = mount(h, ANCHOR_DOC)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    const anchor = readingContainer().querySelector<HTMLAnchorElement>(
      `a.${WIKILINK_CLASS_NAMES.wikilink}`,
    )!
    anchor.click()
    const intents = sentOf(h, 'wikilink.activate') as WikilinkActivate[]
    expect(intents).toHaveLength(1)
    expect(intents[0]!.target).toBe('#当前笔记')
    expect(sentOf(h, 'edit.request').length).toBe(0)
    c.dispose()
  })
})

describe('新增协议消息结构校验（#11）', () => {
  it('wikilink.activate：合法通过；缺字段/类型错误拒绝', () => {
    const base = {
      kind: 'wikilink.activate',
      sessionId: 's1',
      docUri: DOC_URI,
      target: '目录/笔记#标题',
      srcStart: 3,
      srcEnd: 20,
    }
    expect(isWebviewToHost(base)).toBe(true)
    expect(isWebviewToHost({ ...base, target: 1 })).toBe(false)
    expect(isWebviewToHost({ ...base, target: '' })).toBe(true) // 空 target 合法（宿主给反馈）
    expect(isWebviewToHost({ ...base, srcStart: -1 })).toBe(false)
    expect(isWebviewToHost({ ...base, srcEnd: 'x' })).toBe(false)
    expect(isWebviewToHost({ kind: 'wikilink.activate', sessionId: 's1', docUri: DOC_URI, target: 'x' })).toBe(false)
  })

  it('view.state 双链观测字段：合法数值通过；类型错误拒绝', () => {
    const base = {
      kind: 'view.state',
      text: '[[x]]',
      docLength: 5,
      lineCount: 1,
      renderedLines: 10,
    }
    expect(isWebviewToHost({ ...base, liveWikilinkCount: 1, readingWikilinkCount: 0 })).toBe(true)
    expect(isWebviewToHost({ ...base, liveWikilinkCount: 'x' })).toBe(false)
    expect(isWebviewToHost({ ...base, readingWikilinkCount: -1 })).toBe(false)
    expect(isWebviewToHost({ ...base, liveWikilinkCount: 1.5 })).toBe(false)
  })
})
