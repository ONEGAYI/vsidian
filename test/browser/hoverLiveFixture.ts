// P2-06（#283）悬停浮窗根引用内部 Live 的原生浏览器回归装配
// （hoverLive.mjs 配套）：生产 WebviewSyncController + 伪造宿主桥——
// B 侧极简会话模型与 embedLiveFixture 同源（apply→ack、外部增量→广播、
// save→清 dirty、close.query→state、close.execute→版本守卫），叠加
// hover.request 应答；悬停经生产 hover.test.pointer 测试钩子注入真实
// 指针语义事件（与用户悬停同一处理器链路）。真实键盘（键入/Esc/Ctrl+S）、
// 真实指针移出、绘制层可见性与 dirty 保活在 hoverLive.mjs 验证。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（refEdit.* 载荷断言）。伪造宿主应答经微任务延迟——真实
 *  宿主 postMessage 异步往返，同步回包会在控制器出站栈内重入 */
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
  savedContent: TARGET_TEXT,
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

let bindSeq = 0
const ports = new Map<string, boolean>()

function bPush(portId: string, message: Parameters<typeof controller.handleHostMessage>[0]): void {
  controller.handleHostMessage({ kind: 'refEdit.push', portId, fsPath: B_FS, message })
}

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
        sourceLeaseId: `panel-1:source-${++bindSeq}`,
      })
      return
    }
    case 'refEdit.bind': {
      const portId = `refport-hover-${++bindSeq}`
      ports.set(portId, true)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: B_FS, docUri: B_DOC_URI,
        version: bModel.ver, dirty: bModel.dirty,
      })
      bPush(portId, { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: bModel.ver, text: bModel.content })
      return
    }
    case 'refEdit.unbind': {
      ports.delete(message.portId)
      return
    }
    case 'refEdit.message': {
      if (!ports.get(message.portId)) {
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
        bPush(message.portId, { kind: 'edit.ack', seq: inner.seq, ok: true, version: bModel.ver })
        return
      }
      if (inner.kind === 'sync.request') {
        bPush(message.portId, { kind: 'doc.resync', version: bModel.ver, text: bModel.content })
        return
      }
      return
    }
    case 'refEdit.save': {
      if (!ports.get(message.portId)) {
        return
      }
      bModel.savedCount++
      bModel.savedContent = bModel.content
      bModel.dirty = false
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
      controller.handleHostMessage({ kind: 'refEdit.save.result', portId: message.portId, fsPath: B_FS, ok: true })
      return
    }
    case 'refEdit.close.query': {
      controller.handleHostMessage({
        kind: 'refEdit.close.state', reqId: message.reqId, fsPath: B_FS,
        dirty: bModel.dirty, version: bModel.ver, relPath: '目标笔记.md',
      })
      return
    }
    case 'refEdit.close.execute': {
      if (!ports.get(message.portId)) {
        return
      }
      const reply = (outcome: 'closed' | 'save-failed' | 'discard-failed' | 'stale'): void => {
        controller.handleHostMessage({
          kind: 'refEdit.close.result', reqId: message.reqId, fsPath: B_FS, outcome,
        })
      }
      if (bModel.ver !== message.confirmedVersion) {
        reply('stale')
        return
      }
      if (message.action === 'save') {
        bModel.savedCount++
        bModel.savedContent = bModel.content
        bModel.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
        reply('closed')
        return
      }
      if (message.action === 'discard') {
        if (bModel.dirty) {
          const before = bModel.content
          bModel.content = bModel.savedContent
          bModel.ver++
          bModel.dirty = false
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
          if (ports.get(message.portId)) {
            bPush(message.portId, {
              kind: 'doc.changed', version: bModel.ver, origin: 'external',
              changes: [{ offset: 0, length: before.length, text: bModel.savedContent }],
            })
          }
        }
        reply('closed')
        return
      }
      reply('closed')
      return
    }
    default:
      return
  }
}

function mainView(): EditorView | null {
  const editor = document.querySelector('#app .vsidian-view-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 装配父文档并切模式（Live 起步——内部模式继承验证的默认父态） */
  initHoverLiveDoc(text: string, mode: 'live' | 'reading') {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'hover-live-itest', docUri: DOC_URI, version: 1, text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（hover.liveDirect 开关：Live 正文直接悬停） */
  applyHoverLiveSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 悬停指针事件（生产 hover.test.pointer 钩子——真实 DOM 事件派发） */
  hoverPtr(link: 'wikilink' | 'live-wikilink', action: 'enter' | 'leave', index = 0) {
    controller.handleHostMessage({ kind: 'hover.test.pointer', action, link, index })
  },
  /** 已出站消息快照 */
  hoverLiveSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 悬停浮层探针（view.state.hoverPreview：经生产回报通道） */
  hoverLiveProbe(): Record<string, unknown> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { hoverPreview?: Record<string, unknown> }
      | undefined
    return state?.hoverPreview ?? {}
  },
  /** 嵌入卡片探针（浮窗内子卡的范围锁观测——P2-09 前保持 Reading） */
  hoverLiveEmbeds(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  /** 浮窗 DOM 观测（绘制层）：编辑器/圆点/头部动作的可见性 */
  readHoverLivePopup(): Record<string, unknown> {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false }
    }
    const liveEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-live')
    const contentEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-scroll .vsidian-view-reading')
    const dot = el.querySelector<HTMLElement>('.vsidian-hover-popup-dirty')
    const editor = liveEl?.querySelector<HTMLElement>('.cm-editor') ?? null
    const dotStyle = dot ? getComputedStyle(dot) : null
    const dotRect = dot?.getBoundingClientRect()
    return {
      open: true,
      liveDisplay: liveEl ? getComputedStyle(liveEl).display : 'none',
      contentDisplay: contentEl ? getComputedStyle(contentEl).display : 'none',
      editorPresent: editor !== null,
      editorVisible: editor !== null && getComputedStyle(editor).display !== 'none',
      editorTextLen: editor?.querySelector('.cm-content')?.textContent?.length ?? -1,
      dotPresent: dot !== null,
      dotText: dot?.textContent ?? '',
      dotColor: dotStyle?.color ?? '',
      dotVisible: dotRect !== undefined && dotRect !== null && dotRect.width > 0 && dotRect.height > 0,
      dotHit: dot ? document.elementFromPoint(
        dotRect!.left + dotRect!.width / 2, dotRect!.top + dotRect!.height / 2) : null,
      modeBtnVisible: getComputedStyle(el.querySelector('.vsidian-hover-popup-mode')!).display !== 'none',
      saveBtnVisible: getComputedStyle(el.querySelector('.vsidian-hover-popup-save')!).display !== 'none',
      closeBtnVisible: getComputedStyle(el.querySelector('.vsidian-hover-popup-close')!).display !== 'none',
      focusInEditor: editor !== null && editor.contains(document.activeElement),
      focusInPopup: el.contains(document.activeElement),
    }
  },
  /** 浮窗内编辑器文本 */
  hoverEditorText(): string {
    const editor = document.querySelector<HTMLElement>('.vsidian-hover-popup-live .cm-editor')
    const view = editor ? EditorView.findFromDOM(editor) : null
    return view?.state.doc.toString() ?? ''
  },
  /** 浮窗内编辑器视图公开取（真实键盘聚焦前提） */
  hoverEditorView(): unknown {
    const editor = document.querySelector<HTMLElement>('.vsidian-hover-popup-live .cm-editor')
    return editor ? EditorView.findFromDOM(editor) : null
  },
  /** 焦点回主编辑器 A */
  focusMainEditor(): boolean {
    mainView()?.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-view-live')
  },
  /** 全文档 CM6 编辑器计数（泄漏观测） */
  hoverLiveEditorCount(): number {
    return document.querySelectorAll('#app .cm-editor').length
  },
  /** B 模型观测（保存次数/权威文本） */
  hoverLiveBModel(): { dirty: boolean; savedCount: number; content: string } {
    return { dirty: bModel.dirty, savedCount: bModel.savedCount, content: bModel.content }
  },
  controller,
})
