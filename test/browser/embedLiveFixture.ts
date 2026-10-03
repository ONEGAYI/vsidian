// P2-04（#281）嵌入内部 Live 的原生浏览器回归装配（embedLive.mjs 配套）：
// 生产 WebviewSyncController + 伪造宿主桥——B 侧用极简会话模型（apply→
// ack、外部增量→广播、undo→逆增量广播、save→清 dirty）驱动绑定/编辑/
// 同步全链路（真实 DocumentSession 的会话语义由 jsdom 单测与 1.82.3 集成
// 层覆盖，浏览器层聚焦 webview 行为）。真实键盘（键入/Ctrl+S/Ctrl+Z）、
// 模式记忆与编辑器无泄漏在此验证。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'
import { liveEmbedSpansField } from '../../src/webview/liveEmbed'
import { selectionTouchesRange } from '../../src/webview/liveDecorations'
import { isFormatOperationId } from '../../src/shared/formatOperations'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（refEdit.* 载荷断言 + 零写回断言的根编辑计数）。
 *  伪造宿主应答经微任务延迟——真实宿主 postMessage 异步往返，同步回包
 *  会在控制器出站栈内重入（mountCardInto → bind → bound → 建编辑器） */
const sent: WebviewToHost[] = []
const bridge: VsCodeBridge = {
  postMessage(message) {
    sent.push(message as WebviewToHost)
    queueMicrotask(() => void fakeHostHandle(message as WebviewToHost))
  },
  getState() {
    return undefined
  },
  setState() {},
}

const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [
  keymap.of(defaultKeymap),
  EditorState.allowMultipleSelections.of(true),
])

const DOC_URI = 'file:///d%3A/notes/parent.md'
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'

const TARGET_TEXT = [
  '# 目标笔记标题',
  '',
  ...Array.from({ length: 8 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`),
  '',
].join('\n')

/** 伪造 B 权威文本模型（LF 坐标；宿主 TextDocument 的行为近似） */
const bModel = {
  content: TARGET_TEXT,
  /** 已保存内容基线（save 更新 / discard 回滚目标） */
  savedContent: TARGET_TEXT,
  ver: 2,
  dirty: false,
  savedCount: 0,
  /** P2-05 保存失败注入（只读盘模拟；置位后 save() 返回 false） */
  saveFail: false,
  undoStack: [] as { changes: SerChange[]; before: string }[],
}

function applyTo(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

/** P2-07（#284）多端口：同目标多 occurrence 各自绑定独立端口——B 权威模型
 *  单份（宿主文档级），端口集合受理按 portId 配对；广播推送发往全部在场
 *  端口（B 的其他视图修改 → 各端口增量，生产语义）。单卡场景行为与单端口
 *  版本等价（embedLive/embedLiveActions 既有断言不受影响） */
const boundPorts = new Set<string>()
let bindReqSeq = 0
/** P2-12 冲突 compare 请求观测（text 断言载体）与应答配置 */
const conflictCompareRequests: Array<{ text: string }> = []
let conflictCompareOk = true

/** 定向推送（指定端口） */
function bPushTo(portId: string, message: WebviewToHost | import('../../src/shared/protocol').HostToWebview): void {
  controller.handleHostMessage({ kind: 'refEdit.push', portId, fsPath: B_FS, message })
}

/** 广播推送（全部在场端口——外部变更的宿主会话广播近似） */
function bPush(message: WebviewToHost | import('../../src/shared/protocol').HostToWebview): void {
  for (const portId of boundPorts) {
    bPushTo(portId, message)
  }
}

const portKnown = (portId: string): boolean => boundPorts.has(portId)

/** 伪造宿主：hover.request 应答目标全文；refEdit.* 应答绑定/编辑/保存。
 *  keybindings.execute 按生产宿主路由近似回发（格式操作族 →
 *  format.command——本地消化命令不经宿主，生产同款） */
async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
    case 'keybindings.execute': {
      if (isFormatOperationId(message.id)) {
        controller.handleHostMessage({ kind: 'format.command', op: message.id })
      }
      return
    }
    case 'hover.request': {
      if (message.target !== '目标笔记') {
        controller.handleHostMessage({
          kind: 'hover.result', reqId: message.reqId, instanceId: message.instanceId,
          ok: false, reason: 'not-found',
        })
        return
      }
      controller.handleHostMessage({
        kind: 'hover.result',
        reqId: message.reqId,
        instanceId: message.instanceId,
        ok: true,
        target: { fsPath: B_FS, relPath: '目标笔记.md' },
        version: bModel.ver,
        text: bModel.content,
        range: { start: 0, end: bModel.content.length },
        scope: { kind: 'full' },
        depth: 1,
        expansionPath: [],
        sourceLeaseId: `panel-1:source-${++bindReqSeq}`,
      })
      return
    }
    case 'refEdit.bind': {
      const portId = `refport-test-${++bindReqSeq}`
      boundPorts.add(portId)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: B_FS, docUri: B_DOC_URI,
        version: bModel.ver, dirty: bModel.dirty,
      })
      // ready 握手的 init 推送（会话全文本）
      bPushTo(portId, { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: bModel.ver, text: bModel.content })
      return
    }
    case 'refEdit.unbind': {
      boundPorts.delete(message.portId)
      return
    }
    case 'refEdit.message': {
      if (!portKnown(message.portId)) {
        return
      }
      const ack = (seq: number): void => {
        bPushTo(message.portId, { kind: 'edit.ack', seq, ok: true, version: bModel.ver })
      }
      const inner = message.message
      if (inner.kind === 'edit.request') {
        bModel.undoStack.push({ changes: inner.changes, before: bModel.content })
        bModel.content = applyTo(bModel.content, inner.changes)
        bModel.ver++
        if (!bModel.dirty) {
          bModel.dirty = true
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
        }
        ack(inner.seq)
        return
      }
      if (inner.kind === 'sync.request') {
        // P2-10 conflictDiscard：经端口请求重同步（放弃未提交输入版本）→
        // 回 doc.resync（全文重置并解除暂停）
        bPush({ kind: 'doc.resync', version: bModel.ver, text: bModel.content })
        return
      }
      if (inner.kind === 'history.request' && inner.op === 'undo') {
        const top = bModel.undoStack.pop()
        if (!top) {
          return
        }
        const inverse: SerChange[] = []
        let delta = 0
        for (const c of [...top.changes].sort((a, b) => a.offset - b.offset)) {
          const at = c.offset + delta
          inverse.push({ offset: at, length: c.text.length, text: top.before.slice(c.offset, c.offset + c.length) })
          delta += c.text.length - c.length
        }
        bModel.content = top.before
        bModel.ver++
        if (!bModel.dirty) {
          bModel.dirty = true
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
        }
        // undo 的文档变更以外部增量回流（不匹配任何 pending 正向变更）
        bPush({ kind: 'doc.changed', version: bModel.ver, changes: inverse, origin: 'external' })
      }
      return
    }
    case 'refEdit.save': {
      if (!portKnown(message.portId)) {
        return
      }
      bModel.savedCount++
      bModel.savedContent = bModel.content
      bModel.dirty = false
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
      controller.handleHostMessage({ kind: 'refEdit.save.result', portId: message.portId, fsPath: B_FS, ok: true })
      return
    }
    case 'refEdit.conflictCompare': {
      // P2-12：伪宿主记录 compare 请求（text = 实例当前全文快照）并按配置
      // 应答。ok 时模拟宿主直驱恢复（resumePanel → doc.resync 推送——对比
      // 页激活会隐藏来源 webview，生产恢复不依赖 webview 再出站请求）
      if (message.portId !== boundPortId) {
        return
      }
      conflictCompareRequests.push({ text: message.text })
      controller.handleHostMessage({
        kind: 'refEdit.conflictCompare.result', portId: boundPortId, fsPath: B_FS, ok: conflictCompareOk,
      })
      if (conflictCompareOk) {
        bPush({ kind: 'doc.resync', version: ++bModel.ver, text: bModel.content })
      }
      return
    }
    case 'refEdit.close.query': {
      // P2-05：B 最新权威状态（dirty/version/相对路径——模态呈现与基线）
      controller.handleHostMessage({
        kind: 'refEdit.close.state', reqId: message.reqId, fsPath: B_FS,
        dirty: bModel.dirty, version: bModel.ver, relPath: '目标笔记.md',
      })
      return
    }
    case 'refEdit.close.execute': {
      if (!portKnown(message.portId)) {
        return
      }
      const reply = (outcome: 'closed' | 'save-failed' | 'discard-failed' | 'stale'): void => {
        controller.handleHostMessage({
          kind: 'refEdit.close.result', reqId: message.reqId, fsPath: B_FS, outcome,
        })
      }
      // 版本守卫（宿主同款）：确认基线过期即 stale，不用旧确认丢弃新修改
      if (bModel.ver !== message.confirmedVersion) {
        reply('stale')
        return
      }
      if (message.action === 'save') {
        if (bModel.saveFail) {
          reply('save-failed')
          return
        }
        bModel.savedCount++
        bModel.savedContent = bModel.content
        bModel.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
        reply('closed')
        return
      }
      // discard：文档级回滚（恢复整个 B 到已保存内容；广播外部增量）
      if (bModel.dirty) {
        const before = bModel.content
        bModel.content = bModel.savedContent
        bModel.ver++
        bModel.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
        bPush({
          kind: 'doc.changed', version: bModel.ver, origin: 'external',
          changes: [{ offset: 0, length: before.length, text: bModel.savedContent }],
        })
      }
      reply('closed')
      return
    }
    default:
      return
  }
}

/** 公开取 view（不触控制器私有成员——liveEmbedFixture 同款先例） */
function mainView(): EditorView | null {
  const editor = document.querySelector('#app .vsidian-view-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

function embedEditorView(): EditorView | null {
  const editor = document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 注入宿主消息（settings.snapshot 等与真实 handleHostMessage 同入口） */
  respondEmbedLive(message: import('../../src/shared/protocol').HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 装配父文档（Live 起步——内部模式继承验证的默认父态） */
  initEmbedLiveDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'embed-live-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切父正文模式（view.mode.set 与生产回流同入口） */
  setEmbedLiveMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 已出站消息快照（refEdit.* 观测） */
  embedLiveSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 嵌入卡片探针（view.state.readingEmbed：经生产 view.state.request →
   *  view.state 回报通道取——与宿主侧观测同一数据源） */
  embedLiveCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  /** 内部 Live 编辑器文本 */
  embedEditorText(): string {
    return embedEditorView()?.state.doc.toString() ?? ''
  },
  /** 主编辑器（A）文本 */
  mainEditorText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  /** 焦点进嵌入编辑器（真实键盘驱动前提） */
  focusEmbedEditor(): boolean {
    embedEditorView()?.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-embed-card')
  },
  /** 焦点回主编辑器 A */
  focusMainEditor(): boolean {
    mainView()?.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-view-live')
  },
  /** 全文档 CM6 编辑器计数（泄漏观测：主 + 嵌入） */
  embedLiveEditorCount(): number {
    return document.querySelectorAll('#app .cm-editor').length
  },
  /** 卡片内 CM6 编辑器计数 */
  embedCardEditorCount(): number {
    return document.querySelectorAll('.vsidian-embed-card .cm-editor').length
  },
  /** 头部圆点在场性 */
  embedDirtyDotPresent(): boolean {
    return document.querySelector('.vsidian-embed-card .vsidian-embed-card-dirty') !== null
  },
  /** 头部保存入口可见性 */
  embedSaveBtnVisible(): boolean {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-embed-card .vsidian-embed-card-save')
    return btn !== null && btn.style.display !== 'none'
  },
  /** 伪造 B 模型状态 */
  embedTargetModel(): { text: string; version: number; dirty: boolean; saved: number } {
    return { text: bModel.content, version: bModel.ver, dirty: bModel.dirty, saved: bModel.savedCount }
  },
  /** 外部编辑注入（B 其他视图修改 → 广播 doc.changed 增量） */
  embedTargetExternalEdit(offset: number, length: number, text: string) {
    bModel.content = applyTo(bModel.content, [{ offset, length, text }])
    bModel.ver++
    if (!bModel.dirty) {
      bModel.dirty = true
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
    }
    bPush({ kind: 'doc.changed', version: bModel.ver, changes: [{ offset, length, text }], origin: 'external' })
  },
  /** 点击头部模式按钮（真实点击链路） */
  clickEmbedModeButton(): boolean {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-embed-card .vsidian-embed-card-mode')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
 // ---- P2-10（#287）完整 Live 操作套件配套 ----
  /** 嵌入编辑器内选区设置（生产同款事务；格式/菜单操作的输入前提） */
  selectEmbedRange(from: number, to: number): boolean {
    const view = embedEditorView()
    if (!view || to > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: from, head: to } })
    return true
  },
  /** 主编辑器（A）内选区设置（焦点回 A 后操作分派的输入前提） */
  selectMainRange(from: number, to: number): boolean {
    const view = mainView()
    if (!view || to > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: from, head: to } })
    return true
  },
  /** 嵌入编辑器选区 range 计数与主选区文本 */
  embedSelectionInfo(): { ranges: number; from: number; to: number } {
    const view = embedEditorView()
    const sel = view?.state.selection
    return { ranges: sel?.ranges.length ?? 0, from: sel?.main.from ?? -1, to: sel?.main.to ?? -1 }
  },
  /** 宿主 ui.command 回发入口（键位/命令面板共用链路） */
  embedUiCommand(op: string): void {
    controller.handleHostMessage({ kind: 'ui.command', op })
  },
  /** 向绑定端口注入冲突暂停推送（session.suspended——恢复走 doc.resync） */
  embedSuspendPort(): void {
    bPush({ kind: 'session.suspended', version: bModel.ver, reason: 'conflict' })
  },
  /** P2-12 已收到的 compare 请求快照（text 断言载体） */
  embedConflictCompareRequests(): Array<{ text: string }> {
    return conflictCompareRequests.map((r) => ({ ...r }))
  },
  /** P2-12 配置伪宿主对下一次 compare 请求的应答 */
  embedSetConflictCompareOk(ok: boolean): void {
    conflictCompareOk = ok
  },
  /** P2-12 冲突选择条观测（在场/收起/按钮绘制与 hover 词） */
  embedConflictChoiceState(): {
    present: boolean
    buttons: string[]
    compareTooltip: string
    noticePainted: boolean
    buttonsPainted: boolean
  } {
    const box = document.querySelector<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-state .vsidian-embed-card-conflict')
    if (!box) {
      return { present: false, buttons: [], compareTooltip: '', noticePainted: false, buttonsPainted: false }
    }
    const buttons = [...box.querySelectorAll<HTMLButtonElement>('button')]
      .map((b) => b.className.replace('vsidian-embed-card-conflict-', ''))
    const compare = box.querySelector<HTMLButtonElement>('.vsidian-embed-card-conflict-compare') ??
      box.querySelector<HTMLButtonElement>('.vsidian-embed-card-conflict-reopen')
    const notice = document.querySelector<HTMLElement>('.vsidian-embed-card-conflict-notice')
    return {
      present: true,
      buttons,
      compareTooltip: compare?.getAttribute('data-tooltip') ?? '',
      // 绘制层证据：按钮真实占位（非 display:none/零尺寸），notice 左边条
      noticePainted: notice !== null && notice.offsetHeight > 0 &&
        getComputedStyle(notice).borderLeftWidth !== '0px',
      buttonsPainted: buttons.length > 0 && box.offsetHeight > 0 &&
        buttons.every((cls) => {
          const el = box.querySelector<HTMLButtonElement>(`.vsidian-embed-card-conflict-${cls}`)
          return el !== null && el.offsetHeight > 0
        }),
    }
  },
  /** 点击头部关闭编辑按钮（真实点击链路；P2-05） */
  clickEmbedCloseButton(): boolean {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-embed-card .vsidian-embed-card-close')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 关闭确认模态观测（P2-05：在场/stale/文案/焦点/绘制形态） */
  embedCloseDialogState(): {
    open: boolean
    stale: boolean
    text: string
    focusedAction: string
    backdropPainted: boolean
    boxPainted: boolean
    noticePainted: boolean
  } {
    const box = document.querySelector<HTMLElement>('.vsidian-ref-close-dialog')
    const backdrop = document.querySelector<HTMLElement>('.vsidian-ref-close-backdrop')
    if (!box || !backdrop) {
      return { open: false, stale: false, text: '', focusedAction: '', backdropPainted: false, boxPainted: false, noticePainted: false }
    }
    const notice = box.querySelector<HTMLElement>('.vsidian-ref-close-notice')
    const focus = document.activeElement
    const actionOf = (el: Element | null): string =>
      el?.classList.contains('vsidian-ref-close-save') ? 'save'
        : el?.classList.contains('vsidian-ref-close-discard') ? 'discard'
          : el?.classList.contains('vsidian-ref-close-cancel') ? 'cancel' : ''
    return {
      open: true,
      stale: notice !== null && notice.style.display !== 'none' && (notice.textContent ?? '').length > 0,
      text: box.textContent ?? '',
      focusedAction: actionOf(focus),
      backdropPainted: getComputedStyle(backdrop).position === 'fixed' &&
        getComputedStyle(backdrop).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        getComputedStyle(backdrop).backgroundColor !== 'transparent',
      boxPainted: getComputedStyle(box).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        getComputedStyle(box).backgroundColor !== 'transparent' &&
        getComputedStyle(box).borderWidth !== '0px',
      noticePainted: notice !== null && notice.style.display !== 'none'
        ? getComputedStyle(notice).borderLeftWidth !== '0px'
        : false,
    }
  },
  /** 点击模态按钮（真实 click；P2-05） */
  embedDialogClick(action: 'save' | 'discard' | 'cancel'): boolean {
    const btn = document.querySelector<HTMLButtonElement>(`.vsidian-ref-close-${action}`)
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 置保存失败注入（只读盘模拟；P2-05） */
  embedTargetSetSaveFail(fail: boolean): void {
    bModel.saveFail = fail
  },
  // ---- P2-07（#284）容器混排 × 内部 Live 套件配套 ----
  /** 全部嵌入卡探针（view.state.readingEmbed 全量；多卡容器矩阵） */
  embedLiveAllCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  /** 主编辑器（A）光标设置并聚焦（前后文打字/显隐驱动的输入前提） */
  focusMainAt(pos: number): boolean {
    const view = mainView()
    if (!view || pos > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-view-live')
  },
  /** 嵌入表逐枚显隐（selectionTouchesRange 同语义——B 选区隔离断言面） */
  embedRevealStates(): Array<{ inner: string; from: number; to: number; revealed: boolean }> {
    const view = mainView()
    const spans = view?.state.field(liveEmbedSpansField, false)
    if (!view || !spans) {
      return []
    }
    const selection = view.state.selection
    return spans.map((s) => ({
      inner: s.inner, from: s.from, to: s.to,
      revealed: selectionTouchesRange(selection, s.from, s.to),
    }))
  },
  /** 主编辑器（A）选区快照（B 交互不改变 A 选区的断言面） */
  embedMainSelection(): { anchor: number; head: number } {
    const sel = mainView()?.state.selection.main
    return { anchor: sel?.anchor ?? -1, head: sel?.head ?? -1 }
  },
  /** 第 i 个嵌入编辑器聚焦（多卡场景真实键盘前提；可选光标位） */
  focusEmbedEditorAt(i: number, pos?: number): boolean {
    const editors = document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    const editor = editors[i]
    if (!editor) {
      return false
    }
    const view = EditorView.findFromDOM(editor)
    if (!view) {
      return false
    }
    if (typeof pos === 'number') {
      view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } })
    }
    view.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-embed-card')
  },
  /** 第 i 个嵌入编辑器文本 */
  embedEditorTextAt(i: number): string {
    const editors = document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    const view = editors[i] ? EditorView.findFromDOM(editors[i]!) : null
    return view?.state.doc.toString() ?? ''
  },
  /** 全文档 CM6 编辑器计数（主 + 嵌入；泄漏与存活断言面） */
  embedLiveEditorCountAll(): number {
    return document.querySelectorAll('#app .cm-editor').length
  },
  /** 卡片内 CM6 编辑器计数 */
  embedCardEditorCountAll(): number {
    return document.querySelectorAll('.vsidian-embed-card .cm-editor').length
  },
  /** 第 i 个嵌入卡的绘制观测（宿主形态、卡高、编辑器在场） */
  embedCardPaintAt(i: number): {
    hostClasses: string
    below: boolean
    cardHeight: number
    editorPresent: boolean
    titleText: string
  } {
    const hosts = Array.from(document.querySelectorAll<HTMLElement>(
      '.vsidian-live-embed, .vsidian-reading-embed'))
    const host = hosts[i]
    const card = host?.querySelector<HTMLElement>('.vsidian-embed-card')
    return {
      hostClasses: host?.className ?? '',
      below: host?.classList.contains('vsidian-live-embed-below') ?? false,
      cardHeight: card?.getBoundingClientRect().height ?? 0,
      editorPresent: (card?.querySelectorAll('.vsidian-embed-card-live .cm-editor').length ?? 0) > 0,
      titleText: (card?.querySelector('.vsidian-embed-card-title')?.textContent ?? '').trim(),
    }
  },
  /** 指定文本节点首个矩形 top（相邻行让位断言面） */
  embedTextTopOf(needle: string): number {
    const content = document.querySelector('#app')
    if (!content) {
      return -1
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode()) !== null) {
      const t = node.textContent ?? ''
      const at = t.indexOf(needle)
      if (at >= 0) {
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const rect = range.getBoundingClientRect()
        if (rect.height > 0) {
          return rect.top
        }
      }
    }
    return -1
  },
  /** 主编辑器删除指定引用行（真实事务管线；P2-05 拦截断言载体） */
  embedDeleteRefLine(): boolean {
    const view = mainView()
    const text = view?.state.doc.toString() ?? ''
    const idx = text.indexOf('![[目标笔记]]')
    if (idx < 0 || !view) {
      return false
    }
    const lineStart = text.lastIndexOf('\n', idx - 1) + 1
    let lineEnd = text.indexOf('\n', idx)
    if (lineEnd < 0) {
      lineEnd = text.length
    } else {
      lineEnd += 1
    }
    view.dispatch({ changes: { from: lineStart, to: lineEnd } })
    return true
  },
})
