// P2-07（#284）混排、列表与引用块嵌入的内部 Live 编辑契约（模块级 jsdom
// 直驱真实 CM6 + EmbedCardManager 装配——liveEmbed 装饰 + 挂卡宿主标记，
// 与生产同构）：
// - 实例平移稳定（核心契约）：A 在混排行前后文/列表标记后/引用前缀内打字，
//   嵌入区间坐标平移时 occurrence 实例保持——卡片装载缓存、内部 Live 端口、
//   选区会话记忆不反复蒸发（零 hover.request 重发、零 bind/unbind 风暴）
// - 容器矩阵：段落混排/无序/有序/任务列表/引用块（含嵌套引用）的嵌入继承
//   父模式与手动覆盖按同一状态机；同段双嵌入互不串
// - 交互隔离：B 输入只写 B（edit.request 出站、A 文本不动）；B 选区不触发
//   A 的嵌入源码显形
// - 删除与坍缩：删除活跃引用被拦截（filter 拒绝的事务不做键迁移）；嵌入
//   本身被改写（坍缩）后旧实例退役、新挂载按新实例装载
// - 跨模式共享：平移后 Live↔Reading 切换仍共享同一实例状态（key 口径）
// 真实键盘/指针/布局在 test/browser（embedLiveMixed.mjs）；真宿主在集成层。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  liveEmbed,
  liveEmbedCardsHostMark,
  liveEmbedSpansField,
  setLiveEmbedCards,
} from '../../src/webview/liveEmbed'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { mermaidFencesField } from '../../src/webview/liveMermaid'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'

installLocale('zh-cn', zhCn)

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')

function resultOk(
  req: { reqId: number; instanceId: string },
  text = TARGET_TEXT,
  version = 2,
): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result',
    reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: B_FS, relPath: '目标笔记.md' },
    version, text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' }, depth: 1, expansionPath: [],
    sourceLeaseId: 'panel-1:source-1',
  }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  setLiveEmbedCards(null)
})

/** 完整装配：manager + 真实 CM6 view（liveEmbed 装饰 + 宿主标记 + 键迁移
 *  appendTransaction——与 syncController rootOwnedViewExtensions 同款） */
function setup(opts: { parentMode?: 'reading' | 'live'; remap?: boolean } = {}) {
  const sent: WebviewToHost[] = []
  let parentMode = opts.parentMode ?? 'reading'
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => parentMode,
  }
  const manager = new EmbedCardManager(context)
  setLiveEmbedCards(manager)
  // 与生产 syncController 的 rootOwnedViewExtensions 同款（transactionExtender
  //  在 docView 更新前执行；被 changeFilter 拒绝的事务不产生 state，不触发）
  const remapExtension = opts.remap === false ? [] : [EditorState.transactionExtender.of((tr) => {
    if (tr.docChanged) manager.remapSources(tr.changes)
    return null
  })]
  const mountView = (doc: string): EditorView => new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        liveDecorationsField, mermaidFencesField, liveEmbedCardsHostMark, liveEmbed,
        ...remapExtension,
      ],
    }),
    parent: document.body,
  })
  return {
    manager, sent,
    mountView,
    setParentMode(mode: 'reading' | 'live') {
      parentMode = mode
      manager.notifyParentModeChanged()
    },
  }
}

/** 装载 + （可选）内部 Live 绑定闭环；返回观测量 */
async function driveLoaded(h: ReturnType<typeof setup>, view: EditorView, live: boolean): Promise<void> {
  void view // 视图由调用侧持有（装饰驱动挂载在此之后自然发生）
  // 装饰挂载后卡片发 hover.request —— 同步应答（jsdom 直驱 notifyResult）
  const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  h.manager.notifyResult(resultOk(req))
  if (!live) {
    return
  }
  const bind = h.sent.find((m) => m.kind === 'refEdit.bind')
  if (!bind || bind.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  h.manager.notifyBound({
    kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
    portId: 'port-1', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
  })
  h.manager.notifyPush({
    kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
    message: { kind: 'init', sessionId: 'port-1', docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
  })
  // 微任务：装载后 ensureLivePort 的 bind 在 applyLoaded 同步路径，此处仅
  // 冗余排空（真实宿主异步，jsdom 直驱已同步闭环）
}

function counts(h: ReturnType<typeof setup>): { req: number; bind: number; unbind: number } {
  return {
    req: h.sent.filter((m) => m.kind === 'hover.request').length,
    bind: h.sent.filter((m) => m.kind === 'refEdit.bind').length,
    unbind: h.sent.filter((m) => m.kind === 'refEdit.unbind').length,
  }
}

function embedEditor(): HTMLElement | null {
  return document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
}

describe('P2-07 实例平移稳定（容器内嵌入的编辑现场不随 A 打字蒸发）', () => {
  it('混排行前后文逐字打字：零重载、零端口重建、编辑器与选区保持', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文混排 ![[目标笔记]] 后文混排。\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    // B 内设置选区（会话现场）
    h.manager.testSetSelection('目标笔记', 4, 9)
    const c0 = counts(h)
    expect(c0, '前置：首载恰一笔').toEqual({ req: 1, bind: 1, unbind: 0 })
    expect(embedEditor(), '前置：编辑器在场').toBeTruthy()

    // A 在「前文混排 」后逐字打 3 个字（嵌入区间整体右移）
    view.dispatch({ changes: { from: 5, to: 5, insert: '一' } })
    view.dispatch({ changes: { from: 6, to: 6, insert: '二' } })
    view.dispatch({ changes: { from: 7, to: 7, insert: '三' } })

    const c1 = counts(h)
    expect(c1, '打字期间零 hover.request 重发 / 零 bind/unbind 风暴').toEqual({ req: 1, bind: 1, unbind: 0 })
    expect(embedEditor(), '编辑器存活（DOM 移交新宿主）').toBeTruthy()
    // A 文本保真（打字结果在前文，嵌入原文与后文不动）
    expect(view.state.doc.toString()).toBe('前文混排 一二三![[目标笔记]] 后文混排。\n')
    // B 选区会话记忆保持（liveSelection 未被销毁路径吞掉）
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveBound).toBe(true)
    expect(probe.livePortId).toBe('port-1')
    view.destroy()
    h.manager.dispose()
  })

  it('列表项标记后打字与引用前缀内打字同款稳定', async () => {
    for (const doc of ['- 列表项 ![[目标笔记]] 列表余文\n', '> 引用文 ![[目标笔记]] 引用余文\n']) {
      document.body.innerHTML = ''
      const h = setup({ parentMode: 'live' })
      const view = h.mountView(doc)
      await driveLoaded(h, view, true)
      const base = counts(h)
      expect(base).toEqual({ req: 1, bind: 1, unbind: 0 })
      // 在容器标记与首个文字之间打字（嵌入区间右移）
      view.dispatch({ changes: { from: 3, to: 3, insert: 'x' } })
      expect(counts(h), `容器 ${doc.slice(0, 2)} 打字零风暴`).toEqual({ req: 1, bind: 1, unbind: 0 })
      expect(embedEditor()).toBeTruthy()
      view.destroy()
      h.manager.dispose()
    }
  })

  it('撤销往返（打字 + undo）：实例仍复用（req 恒 1）', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    view.dispatch({ changes: { from: 2, to: 2, insert: '甲' }, annotations: undefined })
    expect(counts(h)).toEqual({ req: 1, bind: 1, unbind: 0 })
    view.dispatch({ changes: { from: 2, to: 3 } }) // undo 近似（删除插入字）
    expect(counts(h), 'undo 路径同样零重载').toEqual({ req: 1, bind: 1, unbind: 0 })
    expect(embedEditor()).toBeTruthy()
    view.destroy()
    h.manager.dispose()
  })

  it('Enter 拆行把嵌入行从中间断开：inner 完整存活的嵌入实例保持', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    const at = doc.indexOf('![[')
    view.dispatch({ changes: { from: at, to: at, insert: '\n' } })
    expect(counts(h), '拆行（嵌入完整移到新行）零重载').toEqual({ req: 1, bind: 1, unbind: 0 })
    expect(view.state.doc.toString()).toBe('前文 \n![[目标笔记]] 后文\n')
    expect(embedEditor()).toBeTruthy()
    view.destroy()
    h.manager.dispose()
  })

  it('同段双嵌入各自平移互不串（两目标独立实例）', async () => {
    const h = setup({ parentMode: 'reading' })
    const doc = '起 ![[目标笔记]] 与 ![[目标笔记]] 末。\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, false)
    const c0 = counts(h)
    expect(c0.req, '两 occurrence 各一笔').toBe(2)
    view.dispatch({ changes: { from: 1, to: 1, insert: '前缀' } })
    // 平移后 widget 重建命中迁移实例：零重发
    expect(counts(h).req, '双嵌入打字零重发').toBe(2)
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-07 容器矩阵与交互隔离', () => {
  it('段落混排/无序/有序/任务/引用/嵌套引用的嵌入全部可进入内部 Live（live host 自动继承）', async () => {
    const docs = [
      '前文 ![[目标笔记]] 后文\n',
      '- 无序 ![[目标笔记]] 项\n',
      '1. 有序 ![[目标笔记]] 项\n',
      '- [ ] 任务 ![[目标笔记]] 项\n',
      '> 引用 ![[目标笔记]] 文\n',
      '> > 嵌套引用 ![[目标笔记]] 文\n',
    ]
    for (const doc of docs) {
      document.body.innerHTML = ''
      const h = setup({ parentMode: 'live' })
      const view = h.mountView(doc)
      await driveLoaded(h, view, true)
      const probe = h.manager.probe().find((p) => p.inner === '目标笔记')
      expect(probe, `${doc} 应挂卡`).toBeTruthy()
      expect(probe!.internalMode, `${doc} 跟随父 Live`).toBe('live')
      expect(probe!.liveBound, `${doc} 端口绑定`).toBe(true)
      expect(probe!.livePortId).toBe('port-1')
      view.destroy()
      h.manager.dispose()
    }
  })

  it('Reading 父 + 容器嵌入手动切 Live：bind 与编辑器在场（reading 父可单独进入目标 Live）', async () => {
    const h = setup({ parentMode: 'reading' })
    const doc = '- [ ] 任务项 ![[目标笔记]] 任务余文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, false)
    expect(counts(h).bind).toBe(0)
    // jsdom 下 widget 宿主在视口内：点击头部模式按钮（手动覆盖）
    const modeBtn = document.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
    expect(modeBtn).toBeTruthy()
    modeBtn!.click()
    const bind = h.sent.find((m) => m.kind === 'refEdit.bind')
    expect(bind, '手动切 Live 发 bind').toBeTruthy()
    if (!bind || bind.kind !== 'refEdit.bind') throw new Error('unreachable')
    h.manager.notifyBound({
      kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
      portId: 'port-1', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-1', docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
    })
    expect(embedEditor()).toBeTruthy()
    // 输入只写 B：typeInEmbed → edit.request 出站，A 文本不动
    const aBefore = view.state.doc.toString()
    h.manager.typeInEmbed('目标笔记', 6, '!')
    const msg = h.sent.filter((m) => m.kind === 'refEdit.message') as Array<Extract<WebviewToHost, { kind: 'refEdit.message' }>>
    expect(msg).toHaveLength(1)
    expect(msg[0]!.portId).toBe('port-1')
    expect(view.state.doc.toString()).toBe(aBefore)
    view.destroy()
    h.manager.dispose()
  })

  it('B 选区不触发 A 的嵌入源码显形（显隐谓词仍按 A 选区）', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    // A 光标在嵌入之外
    view.dispatch({ selection: EditorSelection.single(1) })
    // B 内建立选区（焦点在 B 编辑器）
    h.manager.testSetSelection('目标笔记', 2, 12)
    h.manager.focusEmbed('目标笔记')
    const below = document.querySelectorAll('.vsidian-live-embed-below')
    expect(below.length, 'B 选区不显 A 源（保持隐形态）').toBe(0)
    // A 光标触及区间 → 该嵌入显形（显隐谓词不受 B 干扰）
    const at = doc.indexOf('![[')
    view.dispatch({ selection: EditorSelection.single(at + 3) })
    expect(document.querySelectorAll('.vsidian-live-embed-below').length).toBe(1)
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-07 删除与坍缩', () => {
  it('删除活跃引用被拦截：被拒事务不做键迁移（entry 坐标不变）', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    // 主编辑器删除拦截装配（changeFilter 与 remap appendTransaction 并存）
    const host = document.querySelector('.vsidian-live-embed') as HTMLElement
    expect(host).toBeTruthy()
    const aView = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          h.manager.mainDocChangeFilter(),
          EditorState.transactionExtender.of((tr) => {
            if (tr.docChanged) h.manager.remapSources(tr.changes)
            return null
          }),
        ],
      }),
      parent: document.body,
    })
    aView.dispatch({ changes: { from: 0, to: doc.length } })
    // 拦截：A 不写入 + delete 意图出站
    expect(aView.state.doc.toString()).toBe(doc)
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(true)
    // 取消：保留引用
    h.manager.testDialogAction('cancel')
    expect(view.state.doc.toString()).toBe(doc)
    // 嵌入实例仍在场（坐标未漂移、端口未销毁）
    expect(counts(h)).toEqual({ req: 1, bind: 1, unbind: 0 })
    expect(embedEditor()).toBeTruthy()
    aView.destroy()
    view.destroy()
    h.manager.dispose()
  })

  it('改写嵌入本身（坍缩为残缺形态）：旧实例退役，恢复闭合缓存命中并重建端口', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    const from = doc.indexOf('![[目标笔记]]')
    // 删掉尾 ]（嵌入长 9：![[ + 目标笔记 + ]]）—— 嵌入残缺（坍缩，非完整
    // 删除不拦截）
    view.dispatch({ changes: { from: from + 8, to: from + 9 } })
    // 坍缩后嵌入 occurrence 从嵌入表消失（DOM 撤卡的绘制层验证在 browser
    // 套件 liveEmbedMixed「未闭合撤卡」既有场景）；端口随宿主卸载销毁
    const spansAfterCollapse = view.state.field(liveEmbedSpansField)
    expect(spansAfterCollapse.length, '嵌入表坍缩清空').toBe(0)
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind'), '坍缩撤卡释放端口').toBe(true)
    // 整段删除（区间被完全覆盖钳成零宽）同样坍缩冻结：键不被平移，原位
    // 回填（undo/删表恢复）命中缓存。在干净文档上单独驱动（复用当前 view
    // ——先回滚到初始形态）
    const fullNow = view.state.doc.toString()
    view.dispatch({ changes: { from: 0, to: fullNow.length } })
    const spansGone = view.state.field(liveEmbedSpansField)
    expect(spansGone.length, '整段删除后嵌入表清空').toBe(0)
    // 原位回填（外部恢复同形：删除点插回原文）——键命中缓存
    view.dispatch({ changes: { from: 0, to: 0, insert: doc } })
    expect(counts(h).req, '原位回填缓存命中（死键冻结在原坐标）').toBe(1)
    // 恢复闭合（undo 近似）：同 inner 的 occurrence 键回到原位——装载缓存
    // 命中（零重发，「重挂优先用装载缓存」语义的坍缩恢复延伸）；端口随重挂重建
    view.dispatch({ changes: { from: from + 8, to: from + 8, insert: ']' } })
    const reqs = h.sent.filter((m) => m.kind === 'hover.request')
    expect(reqs.length, '恢复闭合装载缓存命中（零重发）').toBe(1)
    const binds = h.sent.filter((m) => m.kind === 'refEdit.bind')
    expect(binds.length, '端口随重挂重新绑定').toBe(2)
    // 闭环第二笔 bind（bound + init）→ 编辑器重建（真实宿主自动应答）
    const second = binds[1]
    if (!second || second.kind !== 'refEdit.bind') throw new Error('第二笔 bind 不在场')
    h.manager.notifyBound({
      kind: 'refEdit.bound', reqId: second.reqId, ok: true,
      portId: 'port-2', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-2', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-2', docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
    })
    expect(document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .cm-editor'),
      '恢复闭合后编辑器重建').toBeTruthy()
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-07 模式往返的编辑器容器归属', () => {
  it('手动 Live 覆盖下父 Live→Reading→Live 往返：编辑器 DOM 随可见容器（不滞留隐藏容器）', async () => {
    const h = setup({ parentMode: 'reading' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, false)
    // 手动切 Live（覆盖——父切换不回滚，编辑器跨父模式存活）
    const modeBtn = document.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
    modeBtn!.click()
    const bind = h.sent.find((m) => m.kind === 'refEdit.bind')
    if (!bind || bind.kind !== 'refEdit.bind') throw new Error('bind 未发出')
    h.manager.notifyBound({
      kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
      portId: 'port-1', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-1', docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
    })
    // 父切 Live：Live 容器挂载 widget 卡（同 entry 双容器并存）
    h.setParentMode('live')
    const liveHost = document.querySelector('.vsidian-live-embed') as HTMLElement
    expect(liveHost, 'Live 容器 widget 宿主在场').toBeTruthy()
    expect(liveHost!.querySelector('.vsidian-embed-card-live .cm-editor'),
      'Live 父下编辑器在 Live 容器（最近挂载/可见侧）').toBeTruthy()
    // 父切回 Reading：Reading 提升宿主重挂——编辑器移到 Reading 容器
    h.setParentMode('reading')
    const start = doc.indexOf('![[目标笔记]]')
    const readingHost = document.createElement('div')
    document.body.appendChild(readingHost)
    h.manager.mountCardInto(readingHost, '目标笔记', start, start + 9, 'reading')
    expect(readingHost.querySelector('.vsidian-embed-card-live .cm-editor'),
      'Reading 父下编辑器在 Reading 容器（手动覆盖不被父切换销毁）').toBeTruthy()
    expect(liveHost!.querySelector('.vsidian-embed-card-live .cm-editor')).toBeNull()
    // 再切回父 Live：既有编辑器经归属校正回到 Live 容器（不滞留隐藏容器）
    h.setParentMode('live')
    expect(liveHost!.querySelector('.vsidian-embed-card-live .cm-editor'),
      'Live 父下编辑器回到 Live 容器（归属校正）').toBeTruthy()
    expect(readingHost.querySelector('.vsidian-embed-card-live .cm-editor')).toBeNull()
    // 端口零重建（往返零 bind/unbind 风暴）
    expect(counts(h)).toEqual({ req: 1, bind: 1, unbind: 0 })
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-07 跨模式状态共享（平移后 key 口径不破坏）', () => {
  it('A 打字平移后 Live↔Reading 重挂共享实例（零重发）', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = '前文 ![[目标笔记]] 后文\n'
    const view = h.mountView(doc)
    await driveLoaded(h, view, true)
    view.dispatch({ changes: { from: 2, to: 2, insert: '字' } })
    expect(counts(h)).toEqual({ req: 1, bind: 1, unbind: 0 })
    // 切父 Reading：卡片宿主随 Live 装饰退场（隐形态仍在？reading 模式下
    // live 容器隐藏）——用手动 Reading 提升路径模拟 Reading 块挂载
    h.setParentMode('reading')
    const doc2 = view.state.doc.toString()
    const start = doc2.indexOf('![[目标笔记]]')
    const readingHost = document.createElement('div')
    document.body.appendChild(readingHost)
    h.manager.mountCardInto(readingHost, '目标笔记', start, start + 9, 'reading')
    expect(counts(h).req, 'Reading 侧同坐标挂载命中迁移实例（零重发）').toBe(1)
    view.destroy()
    h.manager.dispose()
  })
})
