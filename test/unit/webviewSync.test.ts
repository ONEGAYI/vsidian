// @vitest-environment jsdom
// webview 同步控制器契约：CM6 EditorView 与宿主消息的桥接。
// - mount 后发 ready；init 后装载全文
// - 本地用户事务 → edit.request（seq 递增、baseVersion 为最近权威版本）
// - 外部 doc.changed → 单事务应用且不再回发 edit.request（防回环）
// - edit.ack ok 推进 baseVersion；fail 附全文时重置文档
// - seq 经 bridge.setState 持久化，webview 重载后继续编号（宿主按 seq 去重）
import { afterEach, describe, it, expect, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { StateField, type Extension } from '@codemirror/state'
import { __resetMermaidRenderStateForTest, mermaidDarkTheme } from '../../src/webview/mermaidRender'
import { DocumentSession, type HostDocumentPort } from '../../src/host/documentSession'
import type { HostToWebview, SerChange, WebviewToHost } from '../../src/shared/protocol'
import { closeHoverPopup, hoverPopupProbe, openHoverPopupForKeyboard } from '../../src/webview/hoverPopup'

const DOC_URI = 'file:///d%3A/notes/a.md'

// DOM 输入用例会经过 CM6 的异步测量；jsdom 没有布局，提供空测量结果。
if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeBridge() {
  const sent: WebviewToHost[] = []
  let state: Record<string, unknown> | undefined
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T,>() => state as T | undefined,
    setState: (s) => {
      state = s as Record<string, unknown>
    },
  }
  return { bridge, sent, getSavedState: () => state }
}

function mount(bridge: VsCodeBridge): WebviewSyncController {
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  return controller
}

function init(c: WebviewSyncController, text = '# 你好\n世界', version = 1, sessionId = 's1') {
  c.handleHostMessage({ kind: 'init', sessionId, docUri: DOC_URI, version, text })
}

describe('ready 握手与 init', () => {
  it('#272 观测须显式启用，关闭后 view.state 不携带日志且不重发业务消息', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    try {
      init(c)
      expect([...sent].reverse().find((m) => m.kind === 'view.state')).not.toHaveProperty('diagnostics')
      c.handleHostMessage({ kind: 'diagnostics.test.set', enabled: true })
      c.handleHostMessage({ kind: 'hover.invalidated', fsPath: '/B.md', status: 'changed', generation: 1 })
      c.handleHostMessage({ kind: 'view.state.request' })
      const active = [...sent].reverse().find((m) => m.kind === 'view.state') as Extract<WebviewToHost, { kind: 'view.state' }>
      expect(active.diagnostics?.events).toEqual([expect.objectContaining({
        stage: 'webview.receive.hover.invalidated', data: { fsPath: '/B.md', status: 'changed', generation: 1 },
      })])
      const before = sent.length
      c.handleHostMessage({ kind: 'diagnostics.test.set', enabled: false })
      expect(sent).toHaveLength(before)
      c.handleHostMessage({ kind: 'view.state.request' })
      expect(sent.at(-1)).not.toHaveProperty('diagnostics')
    } finally { c.dispose() }
  })
  it('mount 后发送 ready，此时不发送其他消息', () => {
    const { bridge, sent } = makeBridge()
    mount(bridge)
    expect(sent).toEqual([{ kind: 'ready' }])
  })

  it('init 后 CM6 装载全文（UTF-16 坐标，协议约定宿主发 LF 文本）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, '# 标题\n正文\n第三行')
    expect(c.getView()!.state.doc.toString()).toBe('# 标题\n正文\n第三行')
  })

  it('CM6 规范化 \\r\\n：即便宿主误发 CRLF 文本也不崩溃（防御行为记录）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'a\r\nb')
    // 已知限制：CM6 内部统一 \n；协议上宿主必须经换行协调发 LF（见 newline.test.ts）
    expect(c.getView()!.state.doc.toString()).toBe('a\nb')
  })
})

describe('本地编辑 → edit.request', () => {
  it('本地插入产生精确的 edit.request，seq 从 1 开始', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: '中文' } })
    expect(sent.at(-1)).toEqual({
      kind: 'edit.request',
      sessionId: 's1',
      docUri: DOC_URI,
      seq: 1,
      baseVersion: 3,
      changes: [{ offset: 3, length: 0, text: '中文' }],
    })
  })

  it('替换与删除都以 offset/length 描述', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 1, to: 3, insert: 'X' } })
    expect(sent.at(-1)!.kind).toBe('edit.request')
    const req = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.changes).toEqual([{ offset: 1, length: 2, text: 'X' }])

    view.dispatch({ changes: { from: 0, to: 1 } })
    const req2 = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req2.changes).toEqual([{ offset: 0, length: 1, text: '' }])
    expect(req2.seq).toBe(2)
  })

  it('一个事务包含多个变更时合并为一条消息', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '0123456789', 1)
    c.getView()!.dispatch({
      changes: [
        { from: 0, to: 1, insert: '甲' },
        { from: 5, to: 6, insert: '乙' },
      ],
    })
    // ready + init 主动回报 view.state（模式缓存数据源）+ init 后拉取设置
    // 快照的 settings.get（#33）/ 快捷键快照（#91）/ 片段清单（#128）/
    // 反链快照（#197）/ 出链快照（出链面板批次）/ 分词资源状态（#239）/
    // 查找选项（#236）
    // + 一条 edit.request
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    expect(sent.filter((m) => m.kind !== 'view.state')).toHaveLength(9)
    const req = sent.find((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')!
    expect(req.changes).toEqual([
      { offset: 0, length: 1, text: '甲' },
      { offset: 5, length: 1, text: '乙' },
    ])
  })

  it('ack 成功后 baseVersion 推进', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'x' } })
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    view.dispatch({ changes: { from: 3, insert: 'y' } })
    const req = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.baseVersion).toBe(2)
  })

  it('连续输入不等 ack：两条请求 baseVersion 相同、seq 递增', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: '一' } })
    view.dispatch({ changes: { from: 4, insert: '二' } })
    const reqs = sent.filter((m) => m.kind === 'edit.request')
    expect(reqs).toHaveLength(2)
    expect((reqs[0] as { seq: number }).seq).toBe(1)
    expect((reqs[1] as { seq: number }).seq).toBe(2)
    expect((reqs[1] as { baseVersion: number }).baseVersion).toBe(1)
  })
})

describe('外部变更与重同步', () => {
  it('doc.changed 单事务应用且不回发 edit.request（防回环）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [
        { offset: 0, length: 1, text: '首' },
        { offset: 5, length: 1, text: '尾' },
      ],
    })
    expect(c.getView()!.state.doc.toString()).toBe('首bcde尾')
    const requests = sent.filter((m) => m.kind === 'edit.request')
    expect(requests).toHaveLength(0)
  })

  it('doc.changed 后 baseVersion 更新，后续本地编辑携带新版本', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 5,
      origin: 'external',
      changes: [{ offset: 3, length: 0, text: 'd' }],
    })
    c.getView()!.dispatch({ changes: { from: 0, insert: 'x' } })
    const req = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.baseVersion).toBe(5)
  })

  it('ack 失败且本地有未确认输入时保留本地文本（#4：不覆盖）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '本地草稿', 1)
    c.getView()!.dispatch({ changes: { from: 4, insert: '更多' } })
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: false, reason: 'conflict', version: 9, text: '权威文本' })
    // 未确认输入保留，不被权威全文覆盖；进入暂停并上报
    expect(c.getView()!.state.doc.toString()).toBe('本地草稿更多')
    const report = sent.find((m) => m.kind === 'conflict.report')
    expect(report).toMatchObject({ text: '本地草稿更多' })
  })

  it('ack 失败且本地无未确认输入时以全文重置（干净恢复路径）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, '旧文本', 1)
    c.handleHostMessage({ kind: 'edit.ack', seq: 3, ok: false, reason: 'conflict', version: 9, text: '权威文本' })
    expect(c.getView()!.state.doc.toString()).toBe('权威文本')
  })

  it('非法宿主消息被忽略且不抛错', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    expect(() => {
      c.handleHostMessage('垃圾')
      c.handleHostMessage({ kind: '未知' })
      c.handleHostMessage(null)
    }).not.toThrow()
    expect(c.getView()!.state.doc.toString()).toBe('abc')
  })
})

describe('seq 持久化', () => {
  it('每次发送后通过 setState 保存 seq', () => {
    const { bridge, getSavedState } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    c.getView()!.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(getSavedState()).toMatchObject({ seq: 1 })
  })

  it('webview 重载后（同 state 恢复）seq 继续编号', () => {
    const { bridge, getSavedState } = makeBridge()
    const first = mount(bridge)
    init(first, 'abc', 1)
    first.getView()!.dispatch({ changes: { from: 0, insert: 'x' } })
    const saved = getSavedState()

    // 模拟重载：新 bridge 恢复同一 state
    const sent2: WebviewToHost[] = []
    let state2 = saved
    const bridge2: VsCodeBridge = {
      postMessage: (m) => sent2.push(m as WebviewToHost),
      getState: <T,>() => state2 as T | undefined,
      setState: (s) => {
        state2 = s as Record<string, unknown>
      },
    }
    const second = mount(bridge2)
    init(second, 'abc', 1)
    second.getView()!.dispatch({ changes: { from: 0, insert: 'y' } })
    const req = sent2.find((m) => m.kind === 'edit.request') as { seq: number }
    expect(req.seq).toBe(2)
  })
})

describe('view.state 诊断', () => {
  it('收到请求后回报文本与统计', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '# 标题\n正文', 1)
    c.handleHostMessage({ kind: 'view.state.request' })
    // init 主动回报在前，此处取请求触发的最新一条
    const msg = sent.filter((m): m is Extract<WebviewToHost, { kind: 'view.state' }> => m.kind === 'view.state').at(-1)!
    expect(msg.text).toBe('# 标题\n正文')
    expect(msg.docLength).toBe('# 标题\n正文'.length)
    expect(msg.lineCount).toBe(2)
    expect(Number.isInteger(msg.renderedLines)).toBe(true)
  })
})

describe('反链快照广播乱序（review-loops #16）', () => {
  const snapshotItem = (sourceRelPath: string) => ({
    sourceRelPath,
    sourceFsPath: `d:/notes/${sourceRelPath}`,
    kind: 'wikilink' as const,
    anchor: '',
    start: 0,
    end: 10,
    line: 1,
    snippet: 'x',
  })
  const backlinksOfView = (c: WebviewSyncController, sent: WebviewToHost[]) => {
    c.handleHostMessage({ kind: 'view.state.request' })
    const msg = sent.filter((m): m is Extract<WebviewToHost, { kind: 'view.state' }> => m.kind === 'view.state').at(-1)!
    return msg.backlinks!
  }

  it('乱序到达的降序快照被丢弃（面板保持最新序号内容）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c)
    // seq=2 先到（来源 newer.md），seq=1 迟到（来源 older.md）→ 丢弃
    c.handleHostMessage({ kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready', items: [snapshotItem('newer.md')], seq: 2 })
    c.handleHostMessage({ kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready', items: [snapshotItem('older.md')], seq: 1 })
    expect(backlinksOfView(c, sent).items.map((i) => i.sourceRelPath)).toEqual(['newer.md'])
  })

  it('同序号及以上快照照常应用，无序号帧不丢弃（兼容缺省）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c)
    c.handleHostMessage({ kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready', items: [snapshotItem('a.md')], seq: 1 })
    c.handleHostMessage({ kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready', items: [snapshotItem('b.md')], seq: 1 })
    expect(backlinksOfView(c, sent).items.map((i) => i.sourceRelPath)).toEqual(['b.md'])
    c.handleHostMessage({ kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready', items: [snapshotItem('c.md')] })
    expect(backlinksOfView(c, sent).items.map((i) => i.sourceRelPath)).toEqual(['c.md'])
  })
})

describe('排序菜单真实点击次序（验收反馈：外点收起吞掉菜单项 click）', () => {
  // 真实用户点击 = pointerdown（capture 层外点收起监听先派发）→ 面板重渲
  // → click 落点元素可能已被重建摘除。合成 item.click()（无 pointerdown
  // 前置）测不出该次序，须按真实事件序派发
  const mtimeItem = (sourceRelPath: string, sourceMtimeMs: number) => ({
    sourceRelPath,
    sourceFsPath: `d:/notes/${sourceRelPath}`,
    kind: 'wikilink' as const,
    anchor: '',
    start: 0,
    end: 10,
    line: 1,
    snippet: 'x',
    sourceMtimeMs,
  })
  const mountWithSortMenu = () => {
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    // 挂进 document：外点收起监听在 document 捕获层，游离树里 pointerdown
    // 冒泡到不了 document（首版回路假绿的根因）
    document.body.appendChild(parent)
    c.mount(parent)
    c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: '# 标题' })
    c.handleHostMessage({
      kind: 'backlinks.snapshot', docUri: DOC_URI, state: 'ready',
      items: [mtimeItem('a.md', 100), mtimeItem('b.md', 200)], seq: 1,
    })
    c.handleHostMessage({ kind: 'sidebar.test.click' })
    c.handleHostMessage({ kind: 'backlinks.test.click' })
    c.handleHostMessage({ kind: 'backlinks.test.toolbarClick', action: 'sort' })
    const panel = parent.querySelector<HTMLElement>('.vsidian-backlink-panel')!
    return { c, panel, parent }
  }
  const groupOrder = (panel: HTMLElement) =>
    [...panel.querySelectorAll<HTMLElement>('.vsidian-backlink-group-header')]
      .map((el) => el.dataset['vsidianSource'])

  it('pointerdown → click 选择排序项：改选生效、分组重排、菜单收起', () => {
    const { panel, parent } = mountWithSortMenu()
    try {
      expect(panel.querySelector('.vsidian-backlink-sort-menu'), '前置：菜单应开').not.toBeNull()
      expect(groupOrder(panel)).toEqual(['a.md', 'b.md'])
      const target = panel.querySelector<HTMLElement>('[data-vsidian-sort="mtime-desc"]')!
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      target.click()
      expect(panel.querySelector('.vsidian-backlink-sort-menu'), '选择后菜单应收起').toBeNull()
      expect(groupOrder(panel), '编辑时间降序应重排分组').toEqual(['b.md', 'a.md'])
    } finally {
      parent.remove()
    }
  })

  it('pointerdown → click 排序按钮（菜单开态）：应收起菜单而非保持开', () => {
    const { panel, parent } = mountWithSortMenu()
    try {
      const sortBtn = panel.querySelector<HTMLElement>('[data-action="sort"]')!
      sortBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      sortBtn.click()
      expect(panel.querySelector('.vsidian-backlink-sort-menu'), '开态点排序按钮应收起').toBeNull()
    } finally {
      parent.remove()
    }
  })
})

describe('排版一致性探针（#32：view.state 可选字段）', () => {
  // fixture 同时覆盖标题、正文、列表与引用（表格由集成层覆盖）；
  // jsdom 无样式表层叠，computed 值不反映 main.css——此处只契约
  // 字段结构与采集路径，两模式计算值一致性断言在真实宿主集成层。
  const TYPO_TEXT = '# 排版标题\n\n普通段落。\n\n- 列表项\n\n> 引用内容\n'

  type ViewStateMsg = Extract<WebviewToHost, { kind: 'view.state' }>

  function lastViewState(sent: WebviewToHost[]): ViewStateMsg {
    return sent.filter((m): m is ViewStateMsg => m.kind === 'view.state').at(-1)!
  }

  it('live 模式回报 typography 字段：live 样本结构完整，reading 样本缺挂载为 null', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, TYPO_TEXT, 1)
    c.handleHostMessage({ kind: 'view.state.request' })
    const t = lastViewState(sent).typography
    expect(t, 'view.state 应携带 typography 字段').toBeDefined()
    // live 侧元素常驻（CM6 视口渲染），样本应存在且四键齐全
    expect(t!.live).not.toBeNull()
    expect(Object.keys(t!.live!).sort()).toEqual(['fontFamily', 'fontSizePx', 'lineHeightPx', 'textInsetPx'])
    // jsdom 无 main.css 层叠，值只要求「null 或有限数」形态合法
    for (const v of [t!.live!.fontSizePx, t!.live!.lineHeightPx, t!.live!.textInsetPx]) {
      expect(v === null || Number.isFinite(v)).toBe(true)
    }
    // live 列表/引用行在视口内，装饰 DOM 存在，样本结构完整
    expect(t!.liveList).not.toBeNull()
    expect(Object.keys(t!.liveList!).sort()).toEqual(['fontFamily', 'fontSizePx'])
    expect(t!.liveQuote).not.toBeNull()
    // live 模式下阅读块未挂载（容器 display:none），reading 样本为 null
    expect(t!.reading).toBeNull()
    expect(t!.readingList).toBeNull()
  })

  it('切换 reading 后 reading 样本随挂载出现，live 样本仍可采集（继承链不受显隐影响）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, TYPO_TEXT, 1)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    c.handleHostMessage({ kind: 'view.state.request' })
    const t = lastViewState(sent).typography
    expect(t, 'view.state 应携带 typography 字段').toBeDefined()
    expect(t!.reading).not.toBeNull()
    expect(Object.keys(t!.reading!).sort()).toEqual(['fontFamily', 'fontSizePx', 'lineHeightPx', 'textInsetPx'])
    expect(t!.readingList).not.toBeNull()
    expect(t!.readingQuote).not.toBeNull()
    // live 侧 DOM 常驻（仅隐藏），computed 字体族/字号仍可读
    expect(t!.live).not.toBeNull()
    expect(t!.liveList).not.toBeNull()
  })
})

describe('出站与入站的未确认参考系（C-2）', () => {
  it('确认前的外部增量平移待确认事务，随后相邻替换仍落在正确位置', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 1, insert: 'X' } })
    view.dispatch({ changes: { from: 5, insert: 'Z' } })
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 0, length: 0, text: 'Y' }],
    })
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 3 })
    c.handleHostMessage({
      kind: 'doc.changed', version: 4, origin: 'external',
      changes: [{ offset: 1, length: 1, text: 'Q' }],
    })
    expect(view.state.doc.toString()).toBe('YQXbcdZef')
  })

  it('未确认期间连续输入：出站坐标逆穿未确认集回到 baseVersion 参考系', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } }) // A：本地 offset 0
    view.dispatch({ changes: { from: 5, insert: 'X' } }) // B：本地 'd' 前（base 系 offset 3）
    const reqs = sent.filter((m) => m.kind === 'edit.request') as Extract<
      WebviewToHost,
      { kind: 'edit.request' }
    >[]
    expect(reqs[1]!.baseVersion).toBe(1)
    // 出站坐标必须与 baseVersion 同参考系（宿主重定位语义）
    expect(reqs[1]!.changes).toEqual([{ offset: 3, length: 0, text: 'X' }])
  })

  it('部分确认后外部增量按正确参考系平移（实证场景转正）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } }) // A
    view.dispatch({ changes: { from: 4, insert: 'W' } }) // B：本地 c 前
    // 权威 v2 = 'ZZabcdef'（A 已应用、B 未确认）。第一笔 ack ok 到达但 B 在途
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    // 外部替换权威 v2 的 'd'（offset 5）为 'D'：期望 'ZZabWcDef'
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 3,
      origin: 'external',
      changes: [{ offset: 5, length: 1, text: 'D' }],
    })
    expect(c.getView()!.state.doc.toString()).toBe('ZZabWcDef')
  })

  it('部分确认后外部插入点恰在已确认内容端点：相邻不暂停且映射正确', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } }) // A
    view.dispatch({ changes: { from: 4, insert: 'W' } }) // B（在途）
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    // 外部在权威 v2 的 ZZ 内容之后（offset 2，端点相邻不重叠）插入 'D'：
    // 权威 v3 = 'ZZDabcdef'，期望本地同步为 'ZZDabWcdef'
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 3,
      origin: 'external',
      changes: [{ offset: 2, length: 0, text: 'D' }],
    })
    expect(c.getView()!.state.doc.toString()).toBe('ZZDabWcdef')
  })
})

/** 内联权威文档：applyChanges 即宿主写入路径（content 等价保存后回读文本） */
class InlineDoc implements HostDocumentPort {
  content: string
  ver = 1
  private listener: ((changes: SerChange[], version: number) => void) | undefined
  constructor(text: string, private readonly dirtyStateEvent = false) {
    this.content = text
  }
  onDocChanged(cb: (changes: SerChange[], version: number) => void): void {
    this.listener = cb
  }
  get version(): number {
    return this.ver
  }
  getText(): string {
    return this.content
  }
  async applyChanges(changes: SerChange[]): Promise<boolean> {
    let out = this.content
    let shift = 0
    for (const c of [...changes].sort((a, b) => a.offset - b.offset)) {
      out = out.slice(0, c.offset + shift) + c.text + out.slice(c.offset + shift + c.length)
      shift += c.text.length - c.length
    }
    this.content = out
    this.ver++
    this.listener?.(changes, this.ver)
    // VSCode 首次变脏会在内容事件后再发 contentChanges=[]、同版本的状态事件。
    if (this.dirtyStateEvent && this.ver === 2) this.listener?.([], this.ver)
    return true
  }
  async undo(): Promise<boolean> {
    return false
  }
  async redo(): Promise<boolean> {
    return false
  }
}

/** Controller ↔ DocumentSession 配对（C-2 与文档边角用例共用的端到端基建） */
function setupPair(text: string, dirtyStateEvent = false) {
  const doc = new InlineDoc(text, dirtyStateEvent)
  const toWebview: HostToWebview[] = []
  const session = new DocumentSession(doc, { docUri: DOC_URI })
  doc.onDocChanged((changes, version) => session.handleDocChanged(changes, version))
  const sessionId = session.attachPanel({ send: (m) => toWebview.push(m) })
  const bridge: VsCodeBridge = {
    postMessage: (m) => {
      void session.handleWebviewMessage(m, sessionId)
    },
    getState: <T,>() => undefined as T | undefined,
    setState: () => undefined,
  }
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  session.handleWebviewMessage({ kind: 'ready' }, sessionId)
  controller.handleHostMessage(toWebview.at(-1)!)
  toWebview.length = 0
  const settle = async () => {
    let idle = 0
    for (let i = 0; i < 20 && idle < 2; i++) {
      await new Promise((r) => setTimeout(r, 0))
      const messages = toWebview.splice(0)
      for (const message of messages) controller.handleHostMessage(message)
      idle = messages.length === 0 ? idle + 1 : 0
    }
  }
  return { doc, controller, session, sessionId, settle }
}

describe('C-2 端到端：未确认期间连续输入经宿主重定位后与本地一致', () => {
  it('空白表头 DOM 候选确认后保存中文', async () => {
    const { doc, controller, session, sessionId, settle } = setupPair('|  |  |\n| --- | --- |\n|  |  |', true)
    const view = controller.getView()!
    view.dispatch({ selection: { anchor: 2 } })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    for (const candidate of ['n', 'ni', 'nih', 'nihao', '你好']) {
      const node = view.contentDOM.querySelector('.vsidian-table-grid-cell')!
      node.textContent = ' ' + candidate + ' '
      view.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: candidate, isComposing: true }))
      await settle()
    }
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))
    await settle()
    expect(view.state.doc.toString()).toBe('| 你好 |  |\n| --- | --- |\n|  |  |')
    expect(doc.content).toBe(view.state.doc.toString())
    expect(session.getConflictState(sessionId)?.suspended).toBe(false)
    controller.dispose()
  })
  it.each([true, false])('真实 DOM 候选连续替换并确认中文后可以继续写回（逐候选 ack=%s）', async (ackEachCandidate) => {
    const { doc, controller, session, sessionId, settle } = setupPair('正文', true)
    const view = controller.getView()!
    view.dispatch({ selection: { anchor: 2 } })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    for (const candidate of ['n', 'ni', 'nih', 'nihao', '你好']) {
      const node = view.contentDOM.querySelector('.cm-line')!.firstChild!
      node.textContent = '正文' + candidate
      view.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: candidate, isComposing: true }))
      if (ackEachCandidate) await settle()
      else await new Promise((resolve) => setTimeout(resolve, 0))
    }
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }))
    await settle()
    expect(view.state.doc.toString()).toBe('正文你好')
    expect(doc.content).toBe('正文你好')
    expect(session.getConflictState(sessionId)?.suspended).toBe(false)
    view.dispatch({ changes: { from: 4, insert: '！' } })
    await settle()
    expect(doc.content).toBe('正文你好！')
    controller.dispose()
  })
  it('IME Esc 留下拼音：多轮组合和确认回流交错后继续写回', async () => {
    const { doc, controller, settle } = setupPair('正文')
    const view = controller.getView()!
    const content = view.contentDOM
    content.dispatchEvent(new CompositionEvent('compositionstart'))
    view.dispatch({ changes: { from: 2, insert: 'n' }, userEvent: 'input.type.compose' })
    view.dispatch({ changes: { from: 2, to: 3, insert: 'ni' }, userEvent: 'input.type.compose' })
    content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    content.dispatchEvent(new CompositionEvent('compositionend'))
    await settle()
    expect(view.state.doc.toString()).toBe('正文ni')
    expect(doc.content).toBe('正文ni')

    content.dispatchEvent(new CompositionEvent('compositionstart'))
    view.dispatch({ changes: { from: 4, insert: 'h' }, userEvent: 'input.type.compose' })
    view.dispatch({ changes: { from: 4, to: 5, insert: 'hao' }, userEvent: 'input.type.compose' })
    content.dispatchEvent(new CompositionEvent('compositionend'))
    await settle()
    expect(view.state.doc.toString()).toBe('正文nihao')
    expect(doc.content).toBe('正文nihao')
    view.dispatch({ changes: { from: 7, insert: '!' } })
    await settle()
    expect(doc.content).toBe('正文nihao!')
  })

  it('IME 拼音多次替换且 ack 可在任一轮返回：本地与宿主一致', async () => {
    const { doc, controller, settle } = setupPair('正文')
    const view = controller.getView()!
    let previous = ''
    for (let round = 0; round < 20; round++) {
      view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
      for (const candidate of ['n', 'ni', 'nih', 'niha', 'nihao']) {
        view.dispatch({
          changes: { from: 2, to: 2 + previous.length, insert: candidate },
          userEvent: 'input.type.compose',
        })
        previous = candidate
        if ((round + candidate.length) % 3 === 0) await settle()
      }
      view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
      await settle()
    }
    expect(view.state.doc.toString()).toBe('正文nihao')
    expect(doc.content).toBe('正文nihao')
  })

  it('IME 先删除选中文本再留下拼音：不得把自己的删除判为冲突', async () => {
    const { doc, controller, session, sessionId, settle } = setupPair('A文B')
    const view = controller.getView()!
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    view.dispatch({ changes: { from: 1, to: 2, insert: '' }, userEvent: 'input.type.compose' })
    view.dispatch({ changes: { from: 1, insert: 'ni' }, userEvent: 'input.type.compose' })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await settle()
    expect(view.state.doc.toString()).toBe('AniB')
    expect(doc.content).toBe('AniB')
    expect(session.getConflictState(sessionId)?.suspended).toBe(false)
    view.dispatch({ changes: { from: 4, insert: '!' } })
    await settle()
    expect(doc.content).toBe('AniB!')
  })

  it('IME 删除选区与真实外部编辑重叠：保留拼音并暂停', async () => {
    const { doc, controller, session, sessionId, settle } = setupPair('A文B')
    const view = controller.getView()!
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    view.dispatch({ changes: { from: 1, to: 2, insert: '' }, userEvent: 'input.type.compose' })
    view.dispatch({ changes: { from: 1, insert: 'ni' }, userEvent: 'input.type.compose' })
    // 另一编辑器在首笔本地请求确认前改同一范围。
    await doc.applyChanges([{ offset: 1, length: 1, text: '外' }])
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await settle()
    expect(view.state.doc.toString()).toBe('AniB')
    expect(doc.content).toBe('A外B')
    expect(session.getConflictState(sessionId)?.suspended).toBe(true)
  })
  it('两笔不等 ack 的连续输入：宿主权威文本与本地视图最终一致', async () => {
    const { doc, controller } = setupPair('abcdef')
    const view = controller.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } })
    view.dispatch({ changes: { from: 5, insert: 'X' } }) // 本地 'd' 前（base 系 offset 3）
    // edit.request 经 bridge 同步入队，宿主串行处理；等待队列清空
    await new Promise((r) => setTimeout(r, 10))
    // 出站坐标回 base 系 + 宿主重定位：两笔都落在 'd' 前，权威与本地一致
    expect(doc.content).toBe('ZZabcXdef')
    expect(view.state.doc.toString()).toBe('ZZabcXdef')
  })

  it.each([
    ['连续输入末尾', [{ from: 0, insert: 'ZZ' }, { from: 2, insert: 'X' }], 'ZZXabcdef'],
    ['插入内容内部', [{ from: 0, insert: 'ZZ' }, { from: 1, insert: 'X' }], 'ZXZabcdef'],
    ['插入内容内退格', [{ from: 0, insert: 'ZZ' }, { from: 1, to: 2, insert: '' }], 'Zabcdef'],
    ['插入内容内替换', [{ from: 0, insert: 'ZZ' }, { from: 1, to: 2, insert: 'X' }], 'ZXabcdef'],
    ['三笔连续输入', [{ from: 0, insert: 'h' }, { from: 1, insert: 'e' }, { from: 2, insert: 'l' }], 'helabcdef'],
    ['两笔已发送后暂缓第三笔', [
      { from: 0, insert: 'ZZ' }, { from: 5, insert: 'Q' }, { from: 2, insert: 'X' },
    ], 'ZZXabcQdef'],
  ] as const)('%s：全部确认后权威文本与本地一致', async (_name, edits, expected) => {
    const { doc, controller, settle } = setupPair('abcdef')
    const view = controller.getView()!
    for (const edit of edits) view.dispatch({ changes: edit })
    expect(view.state.doc.toString()).toBe(expected)
    await settle()
    expect(doc.content).toBe(expected)
    expect(view.state.doc.toString()).toBe(doc.content)
  })
})

describe('文档边角保真：末尾无换行与尾部空格（mvp.md 文档样例清单）', () => {
  it('单行无换行文档：末位置（=== 文档长度）编辑不越界，权威文本与本地一致（保存回读基准）', async () => {
    const { doc, controller, settle } = setupPair('abc') // 无 \n：单行，末位置 = 3
    const view = controller.getView()!
    view.dispatch({ changes: { from: 3, insert: '末' } })
    await settle()
    expect(doc.content).toBe('abc末')
    expect(view.state.doc.toString()).toBe('abc末')
  })

  it('行尾双空格（CommonMark 硬换行）与行尾单空格：装载保真、编辑后不被吞', async () => {
    const src = '第一行  \n第二行 ' // 行 1 尾双空格、行 2 尾单空格、文档末尾无换行
    const { doc, controller, settle } = setupPair(src)
    const view = controller.getView()!
    expect(view.state.doc.toString()).toBe(src) // CM6 装载不规范化尾部空格
    view.dispatch({ changes: { from: 10, insert: '!' } }) // 文档末位置（行尾单空格之后）
    await settle()
    expect(doc.content).toBe('第一行  \n第二行 !') // 宿主写回原样保留双空格与尾空格
  })
})

describe('待发编辑与冲突恢复', () => {
  it('前笔请求失败时保留待发输入并暂停，不发送队列内容', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } })
    view.dispatch({ changes: { from: 2, insert: 'X' } })
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: false, reason: 'conflict', version: 2, text: 'abcdef' })
    expect(view.state.doc.toString()).toBe('ZZXabcdef')
    expect(sent.find((m) => m.kind === 'conflict.report')).toMatchObject({ text: 'ZZXabcdef' })
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })

  it('待发编辑遇到主动全文重同步时保留本地输入并暂停', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } })
    view.dispatch({ changes: { from: 2, insert: 'X' } })
    c.handleHostMessage({ kind: 'doc.resync', version: 2, text: '权威全文' })
    expect(view.state.doc.toString()).toBe('ZZXabcdef')
    expect(sent.find((m) => m.kind === 'conflict.report')).toMatchObject({ text: 'ZZXabcdef' })
  })
})

describe('doc.changed 版本单调防线（C-4）', () => {
  it('空 changes 的 doc.changed 被丢弃且不占用版本号（#44 webview 侧第二道防线）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    // 宿主侧已过滤空 dirty 事件；若未知路径仍发出无内容变更广播，webview
    // 直接丢弃：不应用、不占用版本号
    c.handleHostMessage({ kind: 'doc.changed', version: 2, origin: 'external', changes: [] })
    expect(c.getView()!.state.doc.toString()).toBe('abcdef')
    expect(sent.filter((m) => m.kind === 'conflict.report')).toHaveLength(0)
    // 同版本的真实增量仍应正常应用（空事件不得让版本防线误吞它）
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: 6, length: 0, text: '!' }],
    })
    expect(c.getView()!.state.doc.toString()).toBe('abcdef!')
  })

  it('暂缓态收到空 changes 的 doc.changed 不得升级为暂停（#44 误暂停路径）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    // 第三笔与前两笔未确认区间重叠 → 进入暂缓（deferredLocal 非空），
    // 但未暂停（无 ack fail、无真冲突）
    view.dispatch({ changes: { from: 0, insert: 'ZZ' } })
    view.dispatch({ changes: { from: 5, insert: 'Q' } })
    view.dispatch({ changes: { from: 2, insert: 'X' } })
    const reportsBefore = sent.filter((m) => m.kind === 'conflict.report').length
    expect(reportsBefore).toBeGreaterThan(0)
    c.handleHostMessage({ kind: 'doc.changed', version: 3, origin: 'external', changes: [] })
    expect(sent.filter((m) => m.kind === 'conflict.report').length).toBe(reportsBefore)
    expect(view.state.doc.toString()).toBe('ZZXabcQdef')
    // 未暂停：同版本的真实外部增量才按既定保守语义触发暂停（快照再 +1）
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 3,
      origin: 'external',
      changes: [{ offset: 6, length: 0, text: '!' }],
    })
    expect(sent.filter((m) => m.kind === 'conflict.report').length).toBe(reportsBefore + 1)
  })

  it('同版本重复到达的增量被丢弃：仅应用一次', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: 0, length: 0, text: 'Z' }],
    })
    // 宿主兜底确认竞态下的同版本重复广播：不得重复应用（插入不幂等）
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: 0, length: 0, text: 'Z' }],
    })
    expect(c.getView()!.state.doc.toString()).toBe('Zabcdef')
  })

  it('组合缓冲排队路径同样受版本防线保护', async () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: 0, length: 0, text: 'Z' }],
    })
    // 同版本重复在组合中到达：排队阶段即被丢弃
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: 0, length: 0, text: 'Z' }],
    })
    c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    await new Promise((r) => setTimeout(r, 20))
    expect(c.getView()!.state.doc.toString()).toBe('Zabcdef')
  })
})

describe('标题装饰装配（#5 切片：jsdom 下验证 DOM 形态）', () => {
  const HEADING_DOC = '# 一级标题\n普通段落\n## 二级标题\n普通段落二\n'

  it('非活动标题行渲染为格式化标题（# 标记被隐藏，类名挂到行元素）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, HEADING_DOC)
    const view = c.getView()!
    const lines = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line'))
    expect(lines.length).toBeGreaterThanOrEqual(4)
    // 行 1（光标 0 所在，活动）：源码态，DOM 文本含 '#'
    expect(lines[0]!.classList.contains('vsidian-heading-line')).toBe(true)
    expect(lines[0]!.classList.contains('vsidian-heading-line-1')).toBe(true)
    expect(lines[0]!.textContent).toBe('# 一级标题')
    // 行 3（非活动）：标记被 replace 隐藏，DOM 文本只剩标题内容
    expect(lines[2]!.classList.contains('vsidian-heading-line-2')).toBe(true)
    expect(lines[2]!.textContent).toBe('二级标题')
  })

  it('视口内标题行获得间接装饰类（inview），活动标题行带源码态提示', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, HEADING_DOC)
    const lines = Array.from(c.getView()!.dom.querySelectorAll<HTMLElement>('.cm-line'))
    // jsdom 无布局，全部行都在初始视口内（间接装饰应覆盖）
    expect(lines[0]!.classList.contains('vsidian-heading-inview')).toBe(true)
    expect(lines[0]!.classList.contains('vsidian-heading-active')).toBe(true)
    expect(lines[2]!.classList.contains('vsidian-heading-inview')).toBe(true)
    expect(lines[2]!.classList.contains('vsidian-heading-active')).toBe(false)
  })

  it('选区进出标题行：源码态跟随选区切换（增量，无需重新 init）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, HEADING_DOC)
    const view = c.getView()!
    const textOf = (i: number) =>
      view.dom.querySelectorAll<HTMLElement>('.cm-line')[i]!.textContent
    // 选区移到行 4：行 1 变非活动 → 标记隐藏
    view.dispatch({ selection: { anchor: view.state.doc.line(4).from } })
    expect(textOf(0)).toBe('一级标题')
    // 选区回到行 1：源码恢复
    view.dispatch({ selection: { anchor: 0 } })
    expect(textOf(0)).toBe('# 一级标题')
  })

  it('外部增量把普通行改成标题：装饰随文本更新（doc.changed 路径）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, HEADING_DOC)
    const view = c.getView()!
    const headingLinesBefore = view.dom.querySelectorAll('.vsidian-heading-line').length
    // 行 2（普通段落）改为三级标题
    const line2 = view.state.doc.line(2)
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 2,
      origin: 'external',
      changes: [{ offset: line2.from, length: line2.to - line2.from, text: '### 新标题' }],
    })
    const lines = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line'))
    expect(view.dom.querySelectorAll('.vsidian-heading-line').length).toBe(headingLinesBefore + 1)
    expect(lines[1]!.classList.contains('vsidian-heading-line-3')).toBe(true)
    expect(lines[1]!.textContent).toBe('新标题') // 非活动 → 标记隐藏
  })
})

describe('宿主明暗主题初始装配（#110）', () => {
  // MutationObserver 只在 class 变化时触发；暗色环境从打开即是 vscode-dark，
  // 构造/mount 必须主动播种 mermaidRender 的明暗态，否则首渲染按浅色主题
  // 出图（截图实测：浅色墨水叠暗底，连线/文字不可见）。
  afterEach(() => {
    document.body.classList.remove('vscode-dark')
    __resetMermaidRenderStateForTest()
  })

  it('暗色环境 mount：mermaid 主题立即为暗色（不等 class 变化事件）', () => {
    document.body.classList.add('vscode-dark')
    const { bridge } = makeBridge()
    mount(bridge)
    expect(mermaidDarkTheme()).toBe(true)
  })

  it('亮色环境 mount：保持浅色', () => {
    const { bridge } = makeBridge()
    mount(bridge)
    expect(mermaidDarkTheme()).toBe(false)
  })

  it('运行中 class 变化：联动照常热切换（回归保护）', async () => {
    const { bridge } = makeBridge()
    mount(bridge)
    expect(mermaidDarkTheme()).toBe(false)
    document.body.classList.add('vscode-dark')
    for (let i = 0; i < 4; i++) {
      await Promise.resolve()
    }
    expect(mermaidDarkTheme()).toBe(true)
    document.body.classList.remove('vscode-dark')
    for (let i = 0; i < 4; i++) {
      await Promise.resolve()
    }
    expect(mermaidDarkTheme()).toBe(false)
  })
})

// #242 来源租约经过生产分派链：未命中的消费者不得提前释放其他容器的回包。
it('#242 源租约先交到实际容器；双方均未命中的迟到回包只释放一次', () => {
  const { bridge, sent } = makeBridge()
  const c = mount(bridge)
  init(c, '![[B]]\n\n正文\n')
  c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  const req = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> => m.kind === 'hover.request')!
  expect(req.retainSource).toBe(true)
  const result: HostToWebview = { kind: 'hover.result', instanceId: req.instanceId, reqId: req.reqId,
    ok: true, sourceLeaseId: 'embed-lease', target: { fsPath: 'D:/notes/b.md', relPath: 'b.md' },
    version: 1, text: '# B\n', range: { start: 0, end: 4 }, scope: { kind: 'full' } }
  c.handleHostMessage(result)
  const transfer = sent.filter((m) => (m.kind === 'hover.watch' || m.kind === 'hover.source.release') && m.sourceLeaseId === 'embed-lease')
  expect(transfer[0]?.kind).toBe('hover.watch')
  c.handleHostMessage({ kind: 'hover.invalidated', fsPath: 'D:/notes/b.md', status: 'changed', generation: 1 })
  const refreshReq = [...sent].reverse().find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> => m.kind === 'hover.request')!
  c.handleHostMessage({ ...result, reqId: refreshReq.reqId, instanceId: refreshReq.instanceId,
    version: 2, sourceLeaseId: 'same-target-refresh' })
  const refreshed = sent.filter((m) => (m.kind === 'hover.watch' || m.kind === 'hover.source.release') && m.sourceLeaseId === 'same-target-refresh')
  // #244 同 fsPath 的新版本须续交来源关系，后续子引用才可验证新的 B 快照。
  expect(refreshed.map((m) => m.kind)).toEqual(['hover.watch'])
  const anchor = document.createElement('a')
  document.body.appendChild(anchor)
  openHoverPopupForKeyboard(anchor, { target: 'B', sourceStart: 0, sourceEnd: 1 })
  const hoverReq = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
    m.kind === 'hover.request' && m.instanceId.startsWith('hover-'))!
  expect(hoverReq.retainSource).toBe(true)
  const hoverResult = { ...result, instanceId: hoverReq.instanceId, reqId: hoverReq.reqId, sourceLeaseId: 'hover-lease' }
  c.handleHostMessage(hoverResult)
  const hoverTransfer = sent.filter((m) => (m.kind === 'hover.watch' || m.kind === 'hover.source.release') && m.sourceLeaseId === 'hover-lease')
  expect(hoverTransfer[0]?.kind).toBe('hover.watch')
  closeHoverPopup()
  const before = sent.length
  c.handleHostMessage({ ...result, reqId: req.reqId + 100, sourceLeaseId: 'late-lease' })
  expect(sent.slice(before).filter((m) => m.kind === 'hover.source.release')).toEqual([
    { kind: 'hover.source.release', sessionId: 's1', docUri: DOC_URI, sourceLeaseId: 'late-lease' },
  ])
  const cancelled = sent.length
  c.handleHostMessage({ ...hoverResult, sourceLeaseId: 'closed-hover-lease' })
  expect(sent.slice(cancelled).filter((m) => m.kind === 'hover.source.release')).toHaveLength(1)
  anchor.remove()
  c.dispose()
})

it('#245 悬停 B 内独占 C 递归请求沿 B 来源且仍只有一个浮窗', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vsidian-hover-popup-scroll') ? 400 : 0
  })
  const { bridge, sent } = makeBridge()
  const c = mount(bridge)
  init(c, '[[B]]\n')
  const anchor = document.createElement('a')
  document.body.appendChild(anchor)
  try {
    openHoverPopupForKeyboard(anchor, { target: 'B', sourceStart: 0, sourceEnd: 5 })
    const root = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target === 'B')!
    // P2-06（#283）起浮窗根请求的 occurrenceId = 引用位置语义键（与
    // hover.watch 身份、refEdit.bind occurrence 同源——宿主来源租约按
    // occurrence 转交固定）；instanceId 仍为请求配对身份（hover-N）
    expect(root.occurrenceId).toBe('hover@0::B')
    c.handleHostMessage({ kind: 'hover.result', instanceId: root.instanceId, reqId: root.reqId,
      ok: true, sourceLeaseId: 'popup-b-lease', target: { fsPath: 'D:/notes/B.md', relPath: 'B.md' },
      version: 1, text: '![[C]]\n', range: { start: 0, end: 7 }, scope: { kind: 'full' },
      depth: 1, expansionPath: ['A', 'B'] })
    const child = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target === 'C')
    expect(child).toMatchObject({ docUri: DOC_URI, sourceStart: 0, sourceEnd: 6,
      source: { parentInstanceId: root.occurrenceId, sourceDocUri: 'D:/notes/B.md' } })
    const watchIndex = sent.findIndex((m) => m.kind === 'hover.watch' && m.sourceLeaseId === 'popup-b-lease')
    const childIndex = sent.indexOf(child!)
    expect(watchIndex).toBeGreaterThan(-1)
    expect(watchIndex).toBeLessThan(childIndex)
    expect(document.querySelectorAll('.vsidian-hover-popup')).toHaveLength(1)
  } finally {
    closeHoverPopup()
    c.dispose()
    anchor.remove()
    height.mockRestore()
  }
})

it('#245 悬停根目标解析超树预算时挂载前拒绝并释放来源租约', () => {
  const { bridge, sent } = makeBridge()
  const c = mount(bridge)
  init(c, '[[Huge]]\n')
  const anchor = document.createElement('a')
  document.body.appendChild(anchor)
  try {
    openHoverPopupForKeyboard(anchor, { target: 'Huge', sourceStart: 0, sourceEnd: 8 })
    const root = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target === 'Huge')!
    const huge = 'x'.repeat(600 * 1024)
    c.handleHostMessage({ kind: 'hover.result', instanceId: root.instanceId, reqId: root.reqId,
      ok: true, sourceLeaseId: 'huge-popup-lease',
      target: { fsPath: 'D:/notes/Huge.md', relPath: 'Huge.md' }, version: 1,
      text: huge, range: { start: 0, end: huge.length }, scope: { kind: 'full' }, depth: 1 })
    expect(hoverPopupProbe()).toMatchObject({ open: true, state: 'error' })
    expect(sent.filter((m) => m.kind === 'hover.watch' && m.fsPath === 'D:/notes/Huge.md')).toHaveLength(0)
    expect(sent.filter((m) => m.kind === 'hover.source.release' &&
      m.sourceLeaseId === 'huge-popup-lease')).toHaveLength(1)
  } finally {
    closeHoverPopup()
    c.dispose()
    anchor.remove()
  }
})

it('#245 悬停 B→C→D 递归并在关闭时退订整树，迟到叶回包只释放一次', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vsidian-hover-popup-scroll') ||
      this.classList.contains('vsidian-embed-card-scroll') ? 400 : 0
  })
  const { bridge, sent } = makeBridge()
  const c = mount(bridge)
  init(c, '[[B]]\n')
  const anchor = document.createElement('a')
  document.body.appendChild(anchor)
  try {
    openHoverPopupForKeyboard(anchor, { target: 'B', sourceStart: 0, sourceEnd: 5 })
    const request = (target: string) => sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target === target)!
    const respond = (target: string, text: string, depth: number) => {
      const req = request(target)
      c.handleHostMessage({ kind: 'hover.result', instanceId: req.instanceId, reqId: req.reqId,
        ok: true, sourceLeaseId: `lease-${target}`,
        target: { fsPath: `D:/notes/${target}.md`, relPath: `${target}.md` },
        version: 1, text, range: { start: 0, end: text.length }, scope: { kind: 'full' }, depth })
    }
    respond('B', '![[C]]\n', 1)
    expect(request('C').source).toEqual({ parentInstanceId: request('B').occurrenceId,
      sourceDocUri: 'D:/notes/B.md' })
    respond('C', '![[D]]\n', 2)
    expect(request('D').source).toEqual({ parentInstanceId: request('C').occurrenceId,
      sourceDocUri: 'D:/notes/C.md' })
    respond('D', '![[E]]\n', 3)
    expect(sent.some((m) => m.kind === 'hover.request' && m.target === 'E')).toBe(false)
    expect(document.querySelectorAll('.vsidian-hover-popup')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-embed-card')).toHaveLength(3)
    closeHoverPopup()
    expect(document.querySelectorAll('.vsidian-hover-popup, .vsidian-embed-card')).toHaveLength(0)
    expect(sent.filter((m) => m.kind === 'hover.unwatch').map((m) => m.fsPath).sort())
      .toEqual(['D:/notes/B.md', 'D:/notes/C.md', 'D:/notes/D.md'])
    const beforeLate = sent.length
    const stale = request('D')
    c.handleHostMessage({ kind: 'hover.result', instanceId: stale.instanceId, reqId: stale.reqId,
      ok: true, sourceLeaseId: 'late-d', target: { fsPath: 'D:/notes/D.md', relPath: 'D.md' },
      version: 2, text: '# Late', range: { start: 0, end: 6 }, scope: { kind: 'full' } })
    expect(sent.slice(beforeLate).filter((m) => m.kind === 'hover.source.release' &&
      m.sourceLeaseId === 'late-d')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-hover-popup')).toHaveLength(0)
  } finally {
    closeHoverPopup()
    c.dispose()
    anchor.remove()
    height.mockRestore()
  }
})

it.each(['heading', 'block'] as const)('#245/P2-03 悬停 B 的 %s 引用全文可达：范围内外的 C/D 都挂载，来源坐标仍为全文系', (scope) => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vsidian-hover-popup-scroll') ? 400 : 0
  })
  const { bridge, sent } = makeBridge()
  const c = mount(bridge)
  init(c, '[[B]]\n')
  const anchor = document.createElement('a')
  document.body.appendChild(anchor)
  try {
    openHoverPopupForKeyboard(anchor, { target: 'B', sourceStart: 0, sourceEnd: 5 })
    const root = sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target === 'B')!
    const text = '# One\n\n![[C]]\n\n# Two\n\n![[D]]\n'
    const start = text.indexOf('![[C]]')
    const dStart = text.indexOf('![[D]]')
    c.handleHostMessage({ kind: 'hover.result', instanceId: root.instanceId, reqId: root.reqId,
      ok: true, sourceLeaseId: `scope-${scope}`,
      target: { fsPath: 'D:/notes/B.md', relPath: 'B.md' },
      version: 1, text, range: scope === 'heading'
        ? { start: 0, end: text.indexOf('# Two') }
        : { start, end: start + 6 },
      scope: scope === 'heading' ? { kind: 'heading', anchor: 'One' }
        : { kind: 'block', anchor: 'one-block' }, depth: 1 })
    const children = sent.filter((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
      m.kind === 'hover.request' && m.target !== 'B')
    // P2-03（#280）：内容范围恒全文——初始锚点区间外的 D 同样挂载展开
    expect(children.map((m) => m.target)).toEqual(['C', 'D'])
    expect(children[0]).toMatchObject({ sourceStart: start, sourceEnd: start + 6,
      source: { parentInstanceId: root.occurrenceId, sourceDocUri: 'D:/notes/B.md' } })
    expect(children[1]).toMatchObject({ sourceStart: dStart, sourceEnd: dStart + 6,
      source: { parentInstanceId: root.occurrenceId, sourceDocUri: 'D:/notes/B.md' } })
  } finally {
    closeHoverPopup()
    c.dispose()
    anchor.remove()
    height.mockRestore()
  }
})


// ---- #354 T05：附加组件扩展热切换安全收尾 ----
// IME 组合或编辑提交未完成（本地输入在途）时不立即重配组件扩展——
// 暂存最新意图，输入落定（onLocalInputSettled）后冲刷执行。

describe('附加组件扩展热切换安全收尾（T05）', () => {
  /** 观测扩展是否已装配：StateField 在场 = 扩展槽含该扩展 */
  const markerField = StateField.define<number>({ create: () => 0, update: (value) => value })
  const markerExtension: Extension[] = [markerField]

  it('编辑提交未完成时挂起重配，ack 落定后冲刷执行（组合输入与提交不丢）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    // 本地输入产生未 ack 的 edit.request（编辑提交未完成）
    view.dispatch({ changes: { from: 3, insert: '中文' } })
    expect(sent.at(-1)).toMatchObject({ kind: 'edit.request', seq: 1 })
    // 切换到达：挂起（不立即重配——组合/提交中的 reconfigure 会打断输入）
    c.reconfigureAddonExtensions(markerExtension)
    expect(view.state.field(markerField, false)).toBeUndefined()
    // 落定前文档与在途请求不受影响
    expect(view.state.doc.toString()).toBe('abc中文def')
    // 宿主 ack：输入落定 → 挂起意图冲刷，扩展生效
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 4 })
    expect(view.state.field(markerField, false)).toBe(0)
    expect(view.state.doc.toString()).toBe('abc中文def')
    c.dispose()
  })

  it('挂起期间多次切换只保留最新意图（null 摘除也落定后执行）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'x' } })
    // 第一次切换（装配）随后被第二次（摘除）覆盖——只执行最新
    c.reconfigureAddonExtensions(markerExtension)
    c.reconfigureAddonExtensions(null)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 4 })
    expect(view.state.field(markerField, false)).toBeUndefined()
    c.dispose()
  })

  it('IME 组合链端到端：组合中挂起，组合结束落定后装配（浏览器场景同型）', async () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    const content = view.contentDOM
    // 组合开始（DOM compositionstart——liveInstance 组合态跟踪入口）
    content.dispatchEvent(new CompositionEvent('compositionstart'))
    // 组合中装载（开关启用）：挂起
    c.reconfigureAddonExtensions(markerExtension)
    expect(view.state.field(markerField, false)).toBeUndefined()
    // 组合中的本地事务（暂缓累积——不发 edit.request）
    view.dispatch({ changes: { from: 3, insert: '组' }, userEvent: 'input.type.composition' })
    // 组合结束
    content.dispatchEvent(new CompositionEvent('compositionend', { data: '组' }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // 落定链：flush 定时器把暂缓集发出（inFlight）→ 宿主 ack → 冲刷
    const sent = (bridge.postMessage as unknown as (m: unknown) => void) && undefined
    void sent
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 4 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(view.state.field(markerField, false)).toBe(0)
    expect(view.state.doc.toString()).toBe('abc组def')
    c.dispose()
  })

  it('无在途输入时立即重配（无谓挂起不引入延迟）', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    c.reconfigureAddonExtensions(markerExtension)
    expect(view.state.field(markerField, false)).toBe(0)
    c.dispose()
  })

  it('挂起意图作用于最新请求：落定后再次切换不残留旧意图', () => {
    const { bridge } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 3)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'x' } })
    c.reconfigureAddonExtensions(markerExtension)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 4 })
    expect(view.state.field(markerField, false)).toBe(0)
    // 落定后的切换走直通路径（不再挂起）
    c.reconfigureAddonExtensions(null)
    expect(view.state.field(markerField, false)).toBeUndefined()
    c.dispose()
  })
})
