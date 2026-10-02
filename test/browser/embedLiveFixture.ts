// P2-04（#281）嵌入内部 Live 的原生浏览器回归装配（embedLive.mjs 配套）：
// 生产 WebviewSyncController + 伪造宿主桥——B 侧用极简会话模型（apply→
// ack、外部增量→广播、undo→逆增量广播、save→清 dirty）驱动绑定/编辑/
// 同步全链路（真实 DocumentSession 的会话语义由 jsdom 单测与 1.82.3 集成
// 层覆盖，浏览器层聚焦 webview 行为）。真实键盘（键入/Ctrl+S/Ctrl+Z）、
// 模式记忆与编辑器无泄漏在此验证。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'
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
  ver: 2,
  dirty: false,
  savedCount: 0,
  undoStack: [] as { changes: SerChange[]; before: string }[],
}

function applyTo(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

let boundPortId = ''
let bindReqSeq = 0

/** B 会话推送（编辑通道事件 → refEdit.push 信封回 webview） */
function bPush(message: WebviewToHost | import('../../src/shared/protocol').HostToWebview): void {
  controller.handleHostMessage({ kind: 'refEdit.push', portId: boundPortId, fsPath: B_FS, message })
}

/** 伪造宿主：hover.request 应答目标全文；refEdit.* 应答绑定/编辑/保存 */
async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
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
      boundPortId = `refport-test-${bindReqSeq}`
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId: boundPortId, fsPath: B_FS, docUri: B_DOC_URI,
        version: bModel.ver, dirty: bModel.dirty,
      })
      // ready 握手的 init 推送（会话全文本）
      bPush({ kind: 'init', sessionId: boundPortId, docUri: B_DOC_URI, version: bModel.ver, text: bModel.content })
      return
    }
    case 'refEdit.unbind': {
      boundPortId = ''
      return
    }
    case 'refEdit.message': {
      if (message.portId !== boundPortId) {
        return
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
        bPush({ kind: 'edit.ack', seq: inner.seq, ok: true, version: bModel.ver })
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
      if (message.portId !== boundPortId) {
        return
      }
      bModel.savedCount++
      bModel.dirty = false
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
      controller.handleHostMessage({ kind: 'refEdit.save.result', portId: boundPortId, fsPath: B_FS, ok: true })
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
})
