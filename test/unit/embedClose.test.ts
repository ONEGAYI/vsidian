// P2-05（#282）脏目标显式关闭确认与输入保护契约（模块级 jsdom 直驱）：
// - 退出意图三径（头部关闭按钮 / 嵌入内 Esc / 删除活跃引用行）统一检查
//   目标 B 最新状态：dirty 时三项自绘模态（保存并关闭/丢弃修改并关闭/取消），
//   默认焦点取消；确认文字含 B 文件名与文档级丢弃影响说明
// - 取消保留现场；保存失败保留现场；干净目标关闭不弹模态直接完成
// - 对话框期间版本变化触发重新确认（stale 提示 + 新基线出站）
// - IME 组合中 / 写入未 ack 时意图挂起，settle 后重新检查最新 dirty
// - 冲突暂停沿用输入保留：退出意图不弹三项模态
// - 删除活跃引用：覆盖引用区间的 A 事务被拦截（不先写入 A），取消保留
//   原引用，确认（保存/丢弃）后才完成该删除
// - 两 occurrence 指向同一 B：首次丢弃后第二次关闭因 dirty=false 直接
//   关闭，discard 只执行一次
// - 普通离屏卸载与内部模式切换不弹模态不出站 query
// 真实键盘/指针/绘制层在 test/browser（embedLive.mjs）；真宿主保存/revert
// 路由在集成层（P2-05 用例）。
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
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'

installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')
const A_DOC = ['# 父文档', '', '![[目标笔记]]', '', '尾部段落。', ''].join('\n')

/** 关闭模态稳定类名（样式契约 ref-close-dialog 条目同源） */
const DIALOG = {
  backdrop: 'vsidian-ref-close-backdrop',
  box: 'vsidian-ref-close-dialog',
  message: 'vsidian-ref-close-message',
  notice: 'vsidian-ref-close-notice',
  actions: 'vsidian-ref-close-actions',
  save: 'vsidian-ref-close-save',
  discard: 'vsidian-ref-close-discard',
  cancel: 'vsidian-ref-close-cancel',
}

function harness(): {
  manager: EmbedCardManager
  sent: WebviewToHost[]
  mainView: EditorView
} {
  const sent: WebviewToHost[] = []
  let parentMode: 'reading' | 'live' = 'reading'
  let mainViewRef: EditorView | null = null
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => parentMode,
    mainEditorView: () => mainViewRef,
  }
  const manager = new EmbedCardManager(context)
  // 主编辑器（A 的 Live 视图）：装配删除拦截守卫（生产由 syncController
  // 装配同一扩展——rootOwnedViewExtensions）
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: A_DOC,
      extensions: [manager.mainDocChangeFilter()],
    }),
  })
  mainViewRef = view
  return { manager, sent, mainView: view }
}

/** 挂载全部 embed 块（readingBlocks 产物同构） */
function mountEmbedBlocks(manager: EmbedCardManager, text: string): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const block of splitReadingBlocks(text)) {
    if (block.kind !== 'embed') {
      continue
    }
    const el = createReadingBlockElement(block, text)
    document.body.appendChild(el)
    manager.mountBlock(el)
    out.push(el)
  }
  return out
}

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function resultOk(
  req: { reqId: number; instanceId: string },
  text = TARGET_TEXT,
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

/** 装载 + 手动切 Live + bind 闭环；返回 { els, portId } */
function setupLive(h: { manager: EmbedCardManager; sent: WebviewToHost[] }): {
  els: HTMLElement[]
  portId: string
} {
  const els = mountEmbedBlocks(h.manager, A_DOC)
  h.manager.notifyResult(resultOk(hoverRequestOf(h.sent)))
  els[0]!.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
  const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  h.manager.notifyBound({
    kind: 'refEdit.bound', reqId: req.reqId, ok: true,
    portId: 'port-1', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
  })
  h.manager.notifyPush({
    kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
    message: { kind: 'init', sessionId: 'port-1', docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
  })
  return { els, portId: 'port-1' }
}

/** 输入一笔（经真实事务管线）并驱动 ack 收敛 + dirty=true（输入落定——
 *  关闭意图不进入输入保护挂起态） */
function typeAndDirty(h: { manager: EmbedCardManager; sent: WebviewToHost[] }): void {
  h.manager.typeInEmbed('目标笔记', TARGET_TEXT.length, '【改】')
  const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.message')
  if (req && req.kind === 'refEdit.message' && req.message.kind === 'edit.request') {
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'edit.ack', seq: req.message.seq, ok: true, version: 3 },
    })
  }
  h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
}

function lastQueryOf(sent: WebviewToHost[]) {
  return [...sent].reverse().find((m) => m.kind === 'refEdit.close.query')
}

function lastExecuteOf(sent: WebviewToHost[]) {
  return [...sent].reverse().find((m) => m.kind === 'refEdit.close.execute')
}

function dialogBox(): HTMLElement | null {
  return document.querySelector(`.${DIALOG.box}`)
}

function noticeText(): string {
  return document.querySelector(`.${DIALOG.notice}`)?.textContent ?? ''
}

/** 点模态按钮（jsdom click 走真实监听链路） */
function clickDialog(kind: 'save' | 'discard' | 'cancel'): void {
  const btn = document.querySelector<HTMLButtonElement>(`.${DIALOG[kind]}`)
  if (!btn) {
    throw new Error(`模态按钮 ${kind} 不在场`)
  }
  btn.click()
}

describe('P2-05 显式关闭确认模态', () => {
  it('dirty 时关闭意图出站 close.query，模态呈现三项与文件名，默认焦点取消', () => {
    const h = harness()
    const { els } = setupLive(h)
    typeAndDirty(h)
    // 头部关闭按钮（真实点击链路）
    const btn = els[0]!.querySelector<HTMLButtonElement>('.vsidian-embed-card-close')
    expect(btn).toBeTruthy()
    btn!.click()
    const query = lastQueryOf(h.sent)
    expect(query && query.kind === 'refEdit.close.query').toBe(true)
    if (query && query.kind === 'refEdit.close.query') {
      expect(query.portId).toBe('port-1')
      expect(query.intent).toBe('close')
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    const box = dialogBox()
    expect(box).toBeTruthy()
    const text = box!.textContent ?? ''
    expect(text).toContain('目标笔记.md')
    expect(text).toContain(zhCn['embed.closeSave'])
    expect(text).toContain(zhCn['embed.closeDiscard'])
    expect(text).toContain(zhCn['embed.closeCancel'])
    expect(text).toContain(zhCn['embed.closeDialogDiscardScope'])
    const cancel = box!.querySelector<HTMLButtonElement>(`.${DIALOG.cancel}`)
    expect(document.activeElement).toBe(cancel)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('取消保留现场：模态关闭、端口在场、无 execute 出站', () => {
    const h = harness()
    const { els, portId } = setupLive(h)
    typeAndDirty(h)
    h.manager.testClose('目标笔记', 'close')
    const query = lastQueryOf(h.sent)
    if (query && query.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('cancel')
    expect(dialogBox()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.close.execute')).toBe(false)
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveBound).toBe(true)
    expect(probe.internalMode).toBe('live')
    expect(probe.closeDialog).toBe('none')
    void portId
    void els
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('保存并关闭：execute(save) → closed 后端口释放、模式记忆 Reading', () => {
    const h = harness()
    setupLive(h)
    typeAndDirty(h)
    h.manager.testClose('目标笔记', 'close')
    const query = lastQueryOf(h.sent)
    if (query && query.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('save')
    const exec = lastExecuteOf(h.sent)
    expect(exec && exec.kind === 'refEdit.close.execute').toBe(true)
    if (exec && exec.kind === 'refEdit.close.execute') {
      expect(exec.action).toBe('save')
      expect(exec.confirmedVersion).toBe(3)
      h.manager.notifyCloseResult({
        kind: 'refEdit.close.result', reqId: exec.reqId, fsPath: B_FS, outcome: 'closed',
      })
    }
    expect(dialogBox()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveBound).toBe(false)
    expect(probe.internalMode).toBe('reading')
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('保存失败保留现场：save-failed 后模态在场并显示失败提示', () => {
    const h = harness()
    setupLive(h)
    typeAndDirty(h)
    h.manager.testClose('目标笔记', 'close')
    const query = lastQueryOf(h.sent)
    if (query && query.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('save')
    const exec = lastExecuteOf(h.sent)
    if (exec && exec.kind === 'refEdit.close.execute') {
      h.manager.notifyCloseResult({
        kind: 'refEdit.close.result', reqId: exec.reqId, fsPath: B_FS, outcome: 'save-failed',
      })
    }
    expect(dialogBox()).toBeTruthy()
    expect(noticeText()).toContain('保存失败')
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveBound).toBe(true)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('对话框期间版本变化触发重新确认：stale 提示在场，execute 携带新基线', () => {
    const h = harness()
    setupLive(h)
    typeAndDirty(h)
    h.manager.testClose('目标笔记', 'close')
    const query = lastQueryOf(h.sent)
    if (query && query.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    // 确认期间 B 其他视图修改（外部增量 + dirty 保持）
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: {
        kind: 'doc.changed', version: 4, origin: 'external',
        changes: [{ offset: TARGET_TEXT.length, length: 0, text: '外部新增' }],
      },
    })
    expect(noticeText()).toContain('重新确认')
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.closeDialog).toBe('stale')
    clickDialog('discard')
    const exec = lastExecuteOf(h.sent)
    if (exec && exec.kind === 'refEdit.close.execute') {
      expect(exec.action).toBe('discard')
      expect(exec.confirmedVersion).toBe(4)
    } else {
      expect.unreachable('execute 未出站')
    }
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('干净目标关闭不弹模态：query 回 dirty=false 直接完成关闭', () => {
    const h = harness()
    setupLive(h)
    h.manager.testClose('目标笔记', 'close')
    const query = lastQueryOf(h.sent)
    expect(query && query.kind === 'refEdit.close.query').toBe(true)
    if (query && query.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: false, version: 2, relPath: '目标笔记.md',
      })
    }
    expect(dialogBox()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.close.execute')).toBe(false)
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveBound).toBe(false)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('冲突暂停（suspended）时退出意图不弹三项模态', () => {
    const h = harness()
    setupLive(h)
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'session.suspended', version: 3, reason: 'conflict' },
    })
    h.manager.testClose('目标笔记', 'close')
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    expect(dialogBox()).toBeNull()
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('写入未 ack 时意图挂起，ack 收敛后重新检查再出站 query', () => {
    const h = harness()
    setupLive(h)
    // 输入在途（edit.request 已出站、未回 ack）
    h.manager.typeInEmbed('目标笔记', TARGET_TEXT.length, '【改】')
    expect(h.sent.some((m) => m.kind === 'refEdit.message')).toBe(true)
    h.manager.testClose('目标笔记', 'close')
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    // ack 到达（写入落定）→ 意图重入 → query 出站
    const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.message')
    if (req && req.kind === 'refEdit.message' && req.message.kind === 'edit.request') {
      h.manager.notifyPush({
        kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
        message: { kind: 'edit.ack', seq: req.message.seq, ok: true, version: 3 },
      })
    }
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(true)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('IME 组合中意图挂起（不吞输入、不误报已保存）', () => {
    const h = harness()
    const { els } = setupLive(h)
    const editorEl = els[0]!.querySelector('.vsidian-embed-card-live .cm-content') as HTMLElement | null
    expect(editorEl).toBeTruthy()
    editorEl!.dispatchEvent(new CompositionEvent('compositionstart'))
    h.manager.testClose('目标笔记', 'close')
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('Esc 空选区触发关闭意图；非空选区先收选区不触发', () => {
    const h = harness()
    const { els } = setupLive(h)
    typeAndDirty(h)
    const embedEditorEl = els[0]!.querySelector('.vsidian-embed-card-live .cm-content') as HTMLElement | null
    expect(embedEditorEl).toBeTruthy()
    // 非空选区路径：直接向嵌入编辑器选一段再按 Esc
    h.manager.testSetSelection('目标笔记', 0, 4)
    embedEditorEl!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    // 空选区路径：Esc 触发关闭意图
    h.manager.testSetSelection('目标笔记', 2, 2)
    embedEditorEl!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(true)
    h.manager.dispose()
    h.mainView.destroy()
  })

  it('两 occurrence 指向同一 B：首次丢弃后第二次关闭因 dirty=false 直接关闭，discard 仅一次', () => {
    const h = harness()
    const a2 = ['# 父文档', '', '![[目标笔记]]', '', '![[目标笔记]]', ''].join('\n')
    const els = mountEmbedBlocks(h.manager, a2)
    // 两块各发一条 hover.request：逐条回包（重复回包按 lastReq 配对守卫丢弃）
    const reqIds = new Set<number>()
    for (const m of h.sent) {
      if (m.kind === 'hover.request') {
        reqIds.add(m.reqId)
      }
    }
    for (const reqId of reqIds) {
      const req = h.sent.find((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> =>
        m.kind === 'hover.request' && m.reqId === reqId)!
      h.manager.notifyResult(resultOk({ reqId: req.reqId, instanceId: req.instanceId }))
    }
    for (const el of els) {
      el.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    }
    // 两次 bind（occurrence 0/1 各一端口）
    const binds = h.sent.filter((m) => m.kind === 'refEdit.bind')
    expect(binds).toHaveLength(2)
    for (const [i, b] of binds.entries()) {
      if (b.kind !== 'refEdit.bind') {
        continue
      }
      h.manager.notifyBound({
        kind: 'refEdit.bound', reqId: b.reqId, ok: true,
        portId: `port-${i}`, fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
      })
      h.manager.notifyPush({
        kind: 'refEdit.push', portId: `port-${i}`, fsPath: B_FS,
        message: { kind: 'init', sessionId: `port-${i}`, docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
      })
    }
    h.manager.typeInEmbed('目标笔记', TARGET_TEXT.length, '【改】', 0)
    // 输入落定（ack 收敛——occurrence 0 的端口）
    const typed = [...h.sent].reverse().find((m) => m.kind === 'refEdit.message')
    if (typed && typed.kind === 'refEdit.message' && typed.message.kind === 'edit.request') {
      h.manager.notifyPush({
        kind: 'refEdit.push', portId: 'port-0', fsPath: B_FS,
        message: { kind: 'edit.ack', seq: typed.message.seq, ok: true, version: 3 },
      })
    }
    h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
    // occurrence 0 显式关闭 → 模态 → 丢弃并关闭
    h.manager.testClose('目标笔记', 'close', 0)
    const q1 = lastQueryOf(h.sent)
    if (q1 && q1.kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: q1.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('discard')
    const e1 = lastExecuteOf(h.sent)
    if (e1 && e1.kind === 'refEdit.close.execute') {
      h.manager.notifyCloseResult({
        kind: 'refEdit.close.result', reqId: e1.reqId, fsPath: B_FS, outcome: 'closed',
      })
    }
    expect(h.sent.filter((m) => m.kind === 'refEdit.close.execute' && m.action === 'discard')).toHaveLength(1)
    // occurrence 1 关闭：目标已被整体回滚（宿主 dirty=false）→ 无模态直接关闭
    h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
    h.manager.testClose('目标笔记', 'close', 1)
    const q2 = [...h.sent].filter((m) => m.kind === 'refEdit.close.query')
    expect(q2).toHaveLength(2)
    if (q2[1] && q2[1].kind === 'refEdit.close.query') {
      h.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: q2[1].reqId, fsPath: B_FS,
        dirty: false, version: 4, relPath: '目标笔记.md',
      })
    }
    expect(dialogBox()).toBeNull()
    // 全程 discard 仅一次（不重复回滚）
    expect(h.sent.filter((m) => m.kind === 'refEdit.close.execute' && m.action === 'discard')).toHaveLength(1)
    h.manager.dispose()
    h.mainView.destroy()
  })
})

describe('P2-05 删除活跃引用拦截', () => {
  /** 装载 + Live + dirty（活跃编辑中） */
  function setupDirty(): { manager: EmbedCardManager; sent: WebviewToHost[]; mainView: EditorView; els: HTMLElement[] } {
    const h = harness()
    const s = setupLive(h)
    typeAndDirty(h)
    return { ...h, els: s.els }
  }

  it('覆盖引用区间的删除事务被拦截：A 文档不变、模态在场', () => {
    const ctx = setupDirty()
    // 删除嵌入行（整行含换行——用户删除引用行的真实事务形态）
    const line = ctx.mainView.state.doc.line(3)
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    expect(ctx.mainView.state.doc.toString()).toBe(A_DOC)
    const query = lastQueryOf(ctx.sent)
    expect(query && query.kind === 'refEdit.close.query' && query.intent === 'delete').toBe(true)
    if (query && query.kind === 'refEdit.close.query') {
      ctx.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    const box = dialogBox()
    expect(box).toBeTruthy()
    const probe = ctx.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.closeIntent).toBe('delete')
    ctx.manager.dispose()
    ctx.mainView.destroy()
  })

  it('取消删除：A 原引用保留（重放不发生）', () => {
    const ctx = setupDirty()
    const line = ctx.mainView.state.doc.line(3)
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    const query = lastQueryOf(ctx.sent)
    if (query && query.kind === 'refEdit.close.query') {
      ctx.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('cancel')
    expect(ctx.mainView.state.doc.toString()).toBe(A_DOC)
    expect(dialogBox()).toBeNull()
    ctx.manager.dispose()
    ctx.mainView.destroy()
  })

  it('确认（保存并关闭）：A 中该删除在确认后完成', () => {
    const ctx = setupDirty()
    const line = ctx.mainView.state.doc.line(3)
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    const query = lastQueryOf(ctx.sent)
    if (query && query.kind === 'refEdit.close.query') {
      ctx.manager.notifyCloseState({
        kind: 'refEdit.close.state', reqId: query.reqId, fsPath: B_FS,
        dirty: true, version: 3, relPath: '目标笔记.md',
      })
    }
    clickDialog('save')
    const exec = lastExecuteOf(ctx.sent)
    if (exec && exec.kind === 'refEdit.close.execute') {
      ctx.manager.notifyCloseResult({
        kind: 'refEdit.close.result', reqId: exec.reqId, fsPath: B_FS, outcome: 'closed',
      })
    }
    expect(ctx.mainView.state.doc.toString()).not.toContain('![[目标笔记]]')
    ctx.manager.dispose()
    ctx.mainView.destroy()
  })

  it('不相关编辑不受拦截影响', () => {
    const ctx = setupDirty()
    const line = ctx.mainView.state.doc.line(5) // 尾部段落行
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.from + 1 } })
    expect(ctx.mainView.state.doc.toString()).not.toBe(A_DOC)
    expect(dialogBox()).toBeNull()
    ctx.manager.dispose()
    ctx.mainView.destroy()
  })

  it('suspended 态的删除拦截不滞留：冲突恢复后再次删除可正常确认（泄漏回归）', () => {
    const ctx = setupDirty()
    // 冲突暂停：删除拦截命中后 requestClose 沿 suspended 早退（无确认链发起）
    ctx.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'session.suspended', version: 4, reason: 'conflict' },
    })
    const line = ctx.mainView.state.doc.line(3)
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    expect(ctx.mainView.state.doc.toString()).toBe(A_DOC) // 事务被吞（拦截语义）
    expect(lastQueryOf(ctx.sent)).toBeUndefined() // suspended 早退：无 query 出站
    // 冲突恢复（doc.resync 全文重置 + 清暂停）
    ctx.manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-1', fsPath: B_FS,
      message: { kind: 'doc.resync', version: 5, text: TARGET_TEXT },
    })
    expect(ctx.manager.probe().find((p) => p.inner === '目标笔记')!.liveSuspended).toBe(false)
    // 恢复后再次删除：应重新走确认链。若 closePendingDelete 因早退滞留，
    // 此处事务被 2570 守卫静默吞掉（无 query、无模态、A 不变）——主编辑器
    // 删除功能失效直至该 entry 离屏回收
    ctx.mainView.dispatch({ changes: { from: line.from, to: line.to + 1 } })
    expect(ctx.mainView.state.doc.toString()).toBe(A_DOC)
    const query = lastQueryOf(ctx.sent)
    expect(query && query.kind === 'refEdit.close.query' && query.intent === 'delete').toBe(true)
    ctx.manager.dispose()
    ctx.mainView.destroy()
  })
})

describe('P2-05 非退出路径不弹窗', () => {
  it('普通离屏卸载与内部模式切换不产生模态与 query', () => {
    const h = harness()
    const { els } = setupLive(h)
    typeAndDirty(h)
    // 内部模式切换（Live → Reading）：不弹窗
    els[0]!.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    expect(dialogBox()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    // 重新切回 Live（再次绑定）后离屏卸载：不弹窗
    els[0]!.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!.click()
    const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.bind')
    if (req && req.kind === 'refEdit.bind') {
      h.manager.notifyBound({
        kind: 'refEdit.bound', reqId: req.reqId, ok: true,
        portId: 'port-2', fsPath: B_FS, docUri: B_DOC_URI, version: 3, dirty: true,
      })
    }
    h.manager.unmountBlock(els[0]!)
    expect(dialogBox()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.close.query')).toBe(false)
    h.manager.dispose()
    h.mainView.destroy()
  })
})

/** 宿主出站消息形态（类型层冒烟：回包消息可被路由层消费） */
describe('P2-05 协议形态', () => {
  it('close.query / close.execute / close.state / close.result 均为合法消息', async () => {
    const protocol = await import('../../src/shared/protocol')
    const { isHostToWebview, isWebviewToHost } = protocol
    expect(isWebviewToHost({
      kind: 'refEdit.close.query', panelSessionId: 's', panelDocUri: 'u',
      portId: 'p', fsPath: 'f', intent: 'close', reqId: 1,
    } as never)).toBe(true)
    expect(isWebviewToHost({
      kind: 'refEdit.close.execute', panelSessionId: 's', panelDocUri: 'u',
      portId: 'p', fsPath: 'f', action: 'discard', confirmedVersion: 3, reqId: 2,
    } as never)).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.close.state', reqId: 1, fsPath: 'f', dirty: true, version: 3, relPath: 'r.md',
    } as never)).toBe(true)
    expect(isHostToWebview({
      kind: 'refEdit.close.result', reqId: 2, fsPath: 'f', outcome: 'stale',
    } as never)).toBe(true)
  })
})
