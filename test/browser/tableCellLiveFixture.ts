// P2-08（#285）表格格内嵌入的内部 Live 浏览器回归装配（tableCellLive.mjs
// 配套）：生产 WebviewSyncController + 伪造宿主桥——embedLiveFixture 的
// 多端口伪宿主扩展为**多目标**（目标笔记/乙笔记按 target 解码语义路由，
// 含转义别名与 #标题/#^块 链接形态），驱动表格格内嵌入的绑定/编辑/同步/
// 关闭全链路；表格网格几何与格内编辑器观测探针配套。
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

/** 多目标 B 模型注册表：目标名（`|` 前的路径段）→ {fsPath/docUri/全文} */
interface FakeTarget {
  fsPath: string
  docUri: string
  relPath: string
  content: string
}
const TARGETS = new Map<string, FakeTarget>([
  ['目标笔记', {
    fsPath: 'D:\\notes\\目标笔记.md',
    docUri: 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md',
    relPath: '目标笔记.md',
    content: [
      '# 目标笔记标题', '',
      ...Array.from({ length: 8 }, (_, i) => `目标笔记第 ${i + 1} 段正文。`),
      '', '## 小节', '', '小节正文一段。', '', '块锚正文 ^blk', '',
    ].join('\n'),
  }],
  ['乙笔记', {
    fsPath: 'D:\\notes\\乙笔记.md',
    docUri: 'file:///d%3A/notes/%E4%B9%99%E7%AC%94%E8%AE%B0.md',
    relPath: '乙笔记.md',
    content: ['# 乙笔记标题', '', '乙笔记正文一段。', ''].join('\n'),
  }],
])
/** B 权威文本模型（每目标一份；宿主 TextDocument 的行为近似） */
const bModels = new Map<string, {
  content: string
  savedContent: string
  ver: number
  dirty: boolean
  undoStack: Array<{ changes: SerChange[]; before: string }>
}>([...TARGETS.entries()].map(([name, t]) => [name, {
  content: t.content, savedContent: t.content, ver: 2, dirty: false, undoStack: [],
}]))

function applyTo(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

/** 链接形态拆解：`目标笔记|别名` / `目标笔记#小节` / `目标笔记#^blk`
 *  → 目标名 + 锚点 scope（full/heading/block；range 为初始定位点） */
function resolveTarget(raw: string): { name: string; scope: 'full' | 'heading' | 'block'; anchor: string } | null {
  const path = raw.split('|')[0]!
  const hashAt = path.indexOf('#')
  const name = hashAt >= 0 ? path.slice(0, hashAt) : path
  if (!TARGETS.has(name)) {
    return null
  }
  if (hashAt < 0) {
    return { name, scope: 'full', anchor: '' }
  }
  const anchor = path.slice(hashAt + 1)
  return anchor.startsWith('^')
    ? { name, scope: 'block', anchor: anchor.slice(1) }
    : { name, scope: 'heading', anchor }
}

/** scope 定位点（初始锚点区间——P2-03 语义在 Live 侧的落位断言面） */
function anchorRangeOf(t: FakeTarget, scope: 'full' | 'heading' | 'block', anchor: string) {
  if (scope === 'heading') {
    const at = t.content.indexOf(`## ${anchor}`)
    return { start: at >= 0 ? at : 0, end: t.content.length }
  }
  if (scope === 'block') {
    const at = t.content.indexOf(`^${anchor}`)
    return { start: at >= 0 ? at : 0, end: t.content.length }
  }
  return { start: 0, end: t.content.length }
}

/** 多端口：同目标多 occurrence 各自绑定独立端口——B 权威模型单份（宿主
 *  文档级），端口集合受理按 portId 配对；广播推送发往全部在场端口。 */
const boundPorts = new Set<string>()
let bindReqSeq = 0

function bPushTo(portId: string, fsPath: string, message: WebviewToHost | import('../../src/shared/protocol').HostToWebview): void {
  controller.handleHostMessage({ kind: 'refEdit.push', portId, fsPath, message })
}

function bPush(fsPath: string, message: WebviewToHost | import('../../src/shared/protocol').HostToWebview): void {
  for (const portId of boundPorts) {
    bPushTo(portId, fsPath, message)
  }
}

const portKnown = (portId: string): boolean => boundPorts.has(portId)

/** 目标名 → 权威模型（fsPath 反查；端口消息按 fsPath 配对） */
function modelOfFs(fsPath: string) {
  for (const [name, t] of TARGETS.entries()) {
    if (t.fsPath === fsPath) {
      return { name, t, model: bModels.get(name)! }
    }
  }
  return null
}

/** 伪造宿主：hover.request 按解码 target 路由多目标；refEdit.* 应答绑定/
 *  编辑/保存/关闭（embedLiveFixture 同款会话语义，模型按目标分立） */
async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
    case 'keybindings.execute': {
      if (isFormatOperationId(message.id)) {
        controller.handleHostMessage({ kind: 'format.command', op: message.id })
      }
      return
    }
    case 'hover.request': {
      const resolved = resolveTarget(message.target)
      if (!resolved) {
        controller.handleHostMessage({
          kind: 'hover.result', reqId: message.reqId, instanceId: message.instanceId,
          ok: false, reason: 'not-found',
        })
        return
      }
      const t = TARGETS.get(resolved.name)!
      const model = bModels.get(resolved.name)!
      controller.handleHostMessage({
        kind: 'hover.result',
        reqId: message.reqId,
        instanceId: message.instanceId,
        ok: true,
        target: { fsPath: t.fsPath, relPath: t.relPath },
        version: model.ver,
        text: model.content,
        range: anchorRangeOf(t, resolved.scope, resolved.anchor),
        scope: resolved.scope === 'heading'
          ? { kind: 'heading', anchor: resolved.anchor }
          : resolved.scope === 'block'
            ? { kind: 'block', anchor: resolved.anchor }
            : { kind: 'full' },
        depth: 1,
        expansionPath: [],
        sourceLeaseId: `panel-1:source-${++bindReqSeq}`,
      })
      return
    }
    case 'refEdit.bind': {
      const hit = modelOfFs(message.fsPath)
      if (!hit) {
        return
      }
      const portId = `refport-test-${++bindReqSeq}`
      boundPorts.add(portId)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: message.fsPath, docUri: hit.t.docUri,
        version: hit.model.ver, dirty: hit.model.dirty,
      })
      bPushTo(portId, message.fsPath, {
        kind: 'init', sessionId: portId, docUri: hit.t.docUri,
        version: hit.model.ver, text: hit.model.content,
      })
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
      const hit = modelOfFs(message.fsPath)
      if (!hit) {
        return
      }
      const { model } = hit
      const inner = message.message
      if (inner.kind === 'edit.request') {
        model.undoStack.push({ changes: inner.changes, before: model.content })
        model.content = applyTo(model.content, inner.changes)
        model.ver++
        if (!model.dirty) {
          model.dirty = true
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: message.fsPath, dirty: true })
        }
        bPushTo(message.portId, message.fsPath, { kind: 'edit.ack', seq: inner.seq, ok: true, version: model.ver })
        return
      }
      if (inner.kind === 'sync.request') {
        bPush(message.fsPath, { kind: 'doc.resync', version: model.ver, text: model.content })
        return
      }
      if (inner.kind === 'history.request' && inner.op === 'undo') {
        const top = model.undoStack.pop()
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
        model.content = top.before
        model.ver++
        if (!model.dirty) {
          model.dirty = true
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: message.fsPath, dirty: true })
        }
        bPush(message.fsPath, { kind: 'doc.changed', version: model.ver, changes: inverse, origin: 'external' })
      }
      return
    }
    case 'refEdit.save': {
      if (!portKnown(message.portId)) {
        return
      }
      const hit = modelOfFs(message.fsPath)
      if (!hit) {
        return
      }
      hit.model.savedContent = hit.model.content
      hit.model.dirty = false
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: message.fsPath, dirty: false })
      controller.handleHostMessage({ kind: 'refEdit.save.result', portId: message.portId, fsPath: message.fsPath, ok: true })
      return
    }
    case 'refEdit.close.query': {
      const hit = modelOfFs(message.fsPath)
      if (!hit) {
        return
      }
      controller.handleHostMessage({
        kind: 'refEdit.close.state', reqId: message.reqId, fsPath: message.fsPath,
        dirty: hit.model.dirty, version: hit.model.ver, relPath: hit.t.relPath,
      })
      return
    }
    case 'refEdit.close.execute': {
      if (!portKnown(message.portId)) {
        return
      }
      const hit = modelOfFs(message.fsPath)
      if (!hit) {
        return
      }
      const reply = (outcome: 'closed' | 'save-failed' | 'discard-failed' | 'stale'): void => {
        controller.handleHostMessage({
          kind: 'refEdit.close.result', reqId: message.reqId, fsPath: message.fsPath, outcome,
        })
      }
      if (hit.model.ver !== message.confirmedVersion) {
        reply('stale')
        return
      }
      if (message.action === 'save') {
        hit.model.savedContent = hit.model.content
        hit.model.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: message.fsPath, dirty: false })
        reply('closed')
        return
      }
      if (hit.model.dirty) {
        const before = hit.model.content
        hit.model.content = hit.model.savedContent
        hit.model.ver++
        hit.model.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: message.fsPath, dirty: false })
        bPush(message.fsPath, {
          kind: 'doc.changed', version: hit.model.ver, origin: 'external',
          changes: [{ offset: 0, length: before.length, text: hit.model.savedContent }],
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

function embedEditorAt(i: number): EditorView | null {
  const editors = document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
  return editors[i] ? EditorView.findFromDOM(editors[i]!) : null
}

Object.assign(window, {
  /** 注入宿主消息（settings.snapshot 等与真实 handleHostMessage 同入口） */
  respondTableCell(message: import('../../src/shared/protocol').HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 装配父文档（Live 起步——内部模式继承验证的默认父态） */
  initTableCellDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'table-cell-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切父正文模式 */
  setTableCellMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 已出站消息快照 */
  tableCellSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 全部嵌入卡探针（view.state.readingEmbed 经生产通道） */
  tableCellCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  /** 主编辑器（A）文本 */
  tableCellMainText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  /** 主编辑器（A）选区快照 */
  tableCellMainSelection(): { anchor: number; head: number } {
    const sel = mainView()?.state.selection.main
    return { anchor: sel?.anchor ?? -1, head: sel?.head ?? -1 }
  },
  /** 焦点进主编辑器 A（可选光标位） */
  tableCellFocusMainAt(pos: number): boolean {
    const view = mainView()
    if (!view || pos > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-view-live')
  },
  /** A 内选区设置（不夺焦点——格区拖选/Delete 的输入前提） */
  tableCellSelectMain(from: number, to: number): boolean {
    const view = mainView()
    if (!view || to > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: from, head: to } })
    return true
  },
  /** 第 i 个嵌入编辑器聚焦（可选光标位） */
  tableCellFocusEditorAt(i: number, pos?: number): boolean {
    const view = embedEditorAt(i)
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
  tableCellEditorTextAt(i: number): string {
    return embedEditorAt(i)?.state.doc.toString() ?? ''
  },
  /** 第 i 个嵌入编辑器选区 */
  tableCellEditorSelectionAt(i: number): { anchor: number; head: number } {
    const sel = embedEditorAt(i)?.state.selection.main
    return { anchor: sel?.anchor ?? -1, head: sel?.head ?? -1 }
  },
  /** 卡片内 CM6 编辑器计数 */
  tableCellCardEditorCount(): number {
    return document.querySelectorAll('.vsidian-embed-card .cm-editor').length
  },
  /** 伪造 B 模型状态（按目标名） */
  tableCellTargetModel(name: string): { text: string; version: number; dirty: boolean } {
    const model = bModels.get(name)!
    return { text: model.content, version: model.ver, dirty: model.dirty }
  },
  /** 外部编辑注入（B 其他视图修改 → 广播 doc.changed 增量） */
  tableCellExternalEdit(name: string, offset: number, length: number, text: string) {
    const model = bModels.get(name)!
    const t = TARGETS.get(name)!
    model.content = applyTo(model.content, [{ offset, length, text }])
    model.ver++
    if (!model.dirty) {
      model.dirty = true
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: t.fsPath, dirty: true })
    }
    bPush(t.fsPath, { kind: 'doc.changed', version: model.ver, changes: [{ offset, length, text }], origin: 'external' })
  },
  /** 嵌入表逐枚显隐（B 选区隔离断言面） */
  tableCellRevealStates(): Array<{ inner: string; from: number; to: number; revealed: boolean }> {
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
  /** 格内编辑器绘制观测：第 i 编辑器是否在网格格内、高度封顶与邻格可见 */
  tableCellEditorGeometryAt(i: number): {
    present: boolean
    inGridCell: boolean
    editorHeight: number
    capped: boolean
    neighborPainted: boolean
  } {
    const editors = document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    const ed = editors[i]
    if (!ed) {
      return { present: false, inGridCell: false, editorHeight: 0, capped: false, neighborPainted: false }
    }
    const cell = ed.closest<HTMLElement>('.vsidian-table-grid-cell')
    const live = ed.closest<HTMLElement>('.vsidian-embed-card-live')
    const rect = ed.getBoundingClientRect()
    const cappedAt = Number.parseInt(live?.style.maxHeight ?? '0', 10) || 480
    // 邻格可见：同网格行内存在有文字且绘制的其它格
    const row = cell?.closest<HTMLElement>('.vsidian-table-grid-row')
    let neighborPainted = false
    if (row && cell) {
      for (const other of Array.from(row.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell'))) {
        if (other === cell) {
          continue
        }
        const walker = document.createTreeWalker(other, NodeFilter.SHOW_TEXT)
        let node: Node | null = null
        while ((node = walker.nextNode()) !== null) {
          if (!node.textContent?.trim()) {
            continue
          }
          const range = document.createRange()
          range.selectNodeContents(node)
          if (range.getClientRects().length > 0) {
            neighborPainted = true
            break
          }
        }
        if (neighborPainted) {
          break
        }
      }
    }
    return {
      present: true,
      inGridCell: cell !== null,
      editorHeight: rect.height,
      capped: rect.height <= cappedAt + 2,
      neighborPainted,
    }
  },
  /** 指定文本节点首个矩形 top（行高联动断言面） */
  tableCellTextTopOf(needle: string): number {
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
  /** 关闭确认模态观测（embedLiveFixture 同款） */
  tableCellCloseDialogOpen(): boolean {
    return document.querySelector('.vsidian-ref-close-dialog') !== null
  },
  tableCellDialogClick(action: 'save' | 'discard' | 'cancel'): boolean {
    const btn = document.querySelector<HTMLButtonElement>(`.vsidian-ref-close-${action}`)
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
})
