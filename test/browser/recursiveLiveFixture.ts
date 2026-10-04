// P2-09（#286）递归引用的直接父模式与逐层目标编辑浏览器回归装配
// （recursiveLive.mjs 配套）：生产 WebviewSyncController + 伪造宿主桥——
// 多目标极简会话模型（A 面板 + 目标 B + 孙目标 C 各一份权威文本模型），
// 驱动「B 内部 Live 编辑器挂孙卡 → C 跟随绑定独立端口 → 在 C 真实键入
// 只写 C」全链路（真实 DocumentSession 的会话语义与宿主来源校验由 jsdom
// 单测与 1.82.3 集成层覆盖，浏览器层聚焦 webview 行为与绘制）。真实键盘
// （键入/Tab/Ctrl+S）、模式继承与容器归属在此验证。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { liveEmbedSpansField } from '../../src/webview/liveEmbed'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测。伪造宿主应答经微任务延迟——真实宿主 postMessage 异步
 *  往返，同步回包会在控制器出站栈内重入 */
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
const B_FS = 'D:\\notes\\父级B.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%88%B6%E7%BA%A7B.md'
const C_FS = 'D:\\notes\\孙级C.md'
const C_DOC_URI = 'file:///d%3A/notes/%E5%AD%99%E7%BA%A7C.md'
/** A 的正文（回环目标——循环截断场景） */
const A_FS = 'D:\\notes\\parent.md'

/** 伪造权威文本模型（每目标一份；宿主 TextDocument 的行为近似） */
interface TargetModel {
  fsPath: string
  docUri: string
  relPath: string
  content: string
  savedContent: string
  ver: number
  dirty: boolean
  savedCount: number
}

const targets = new Map<string, TargetModel>()
function defineTarget(name: string, fsPath: string, docUri: string, relPath: string, content: string): void {
  targets.set(name, { fsPath, docUri, relPath, content, savedContent: content, ver: 2, dirty: false, savedCount: 0 })
}


function applyTo(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

const boundPorts = new Map<string, TargetModel>()
let reqSeq = 0

function fail(msg: { reqId: number; instanceId: string }, reason: string): void {
  controller.handleHostMessage({
    kind: 'hover.result', reqId: msg.reqId, instanceId: msg.instanceId, ok: false,
    reason: reason as never,
  })
}

/** 伪造宿主：hover.request 按目标名应答全文（带来源的子请求沿链放行——
 *  宿主侧来源校验/循环判定由集成层钉住）；refEdit.* 按端口应答编辑链路 */
async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
    case 'hover.request': {
      // 目标名按 wikilink 语义取 `|` 之前（alias 不参与解析——生产宿主同款）
      const model = targets.get(message.target.split('|')[0])
      if (!model) {
        fail(message, 'not-found')
        return
      }
      // 回环（目标 = 根面板 A 且带来源链）：宿主循环判定近似——按 ADR-0011
      // 链上回指按文档身份截断
      if (message.source !== undefined && model.fsPath === A_FS) {
        fail(message, 'cycle')
        return
      }
      controller.handleHostMessage({
        kind: 'hover.result',
        reqId: message.reqId,
        instanceId: message.instanceId,
        ok: true,
        target: { fsPath: model.fsPath, relPath: model.relPath },
        version: model.ver,
        text: model.content,
        range: { start: 0, end: model.content.length },
        scope: { kind: 'full' },
        depth: message.source !== undefined ? 2 : 1,
        expansionPath: [],
        sourceLeaseId: `panel-1:source-${++reqSeq}`,
      })
      return
    }
    case 'refEdit.bind': {
      const model = [...targets.values()].find((t) => t.fsPath === message.fsPath)
      if (!model) {
        controller.handleHostMessage({
          kind: 'refEdit.bound', reqId: message.reqId, ok: false, reason: 'source',
        })
        return
      }
      const portId = `refport-${++reqSeq}`
      boundPorts.set(portId, model)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: model.fsPath, docUri: model.docUri,
        version: model.ver, dirty: model.dirty,
      })
      controller.handleHostMessage({
        kind: 'refEdit.push', portId, fsPath: model.fsPath,
        message: { kind: 'init', sessionId: portId, docUri: model.docUri, version: model.ver, text: model.content },
      })
      return
    }
    case 'refEdit.unbind': {
      boundPorts.delete(message.portId)
      return
    }
    case 'refEdit.message': {
      const model = boundPorts.get(message.portId)
      if (!model) {
        return
      }
      const inner = message.message
      if (inner.kind === 'edit.request') {
        model.content = applyTo(model.content, inner.changes)
        model.ver++
        if (!model.dirty) {
          model.dirty = true
          controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: model.fsPath, dirty: true })
        }
        controller.handleHostMessage({
          kind: 'refEdit.push', portId: message.portId, fsPath: model.fsPath,
          message: { kind: 'edit.ack', seq: inner.seq, ok: true, version: model.ver },
        })
        return
      }
      if (inner.kind === 'sync.request') {
        controller.handleHostMessage({
          kind: 'refEdit.push', portId: message.portId, fsPath: model.fsPath,
          message: { kind: 'doc.resync', version: model.ver, text: model.content },
        })
      }
      return
    }
    case 'refEdit.save': {
      const model = boundPorts.get(message.portId)
      if (!model) {
        return
      }
      model.savedContent = model.content
      model.dirty = false
      model.savedCount++
      controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: model.fsPath, dirty: false })
      controller.handleHostMessage({
        kind: 'refEdit.save.result', portId: message.portId, fsPath: model.fsPath, ok: true,
      })
      return
    }
    case 'refEdit.close.query': {
      const model = boundPorts.get(message.portId)
      if (!model) {
        return
      }
      controller.handleHostMessage({
        kind: 'refEdit.close.state', reqId: message.reqId, fsPath: model.fsPath,
        dirty: model.dirty, version: model.ver, relPath: model.relPath,
      })
      return
    }
    case 'refEdit.close.execute': {
      const model = boundPorts.get(message.portId)
      if (!model) {
        return
      }
      if (message.action === 'save') {
        model.savedContent = model.content
        model.dirty = false
        model.savedCount++
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: model.fsPath, dirty: false })
      } else if (model.dirty) {
        const before = model.content
        model.content = model.savedContent
        model.dirty = false
        controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: model.fsPath, dirty: false })
        controller.handleHostMessage({
          kind: 'refEdit.push', portId: message.portId, fsPath: model.fsPath,
          message: {
            kind: 'doc.changed', version: ++model.ver, origin: 'external',
            changes: [{ offset: 0, length: before.length, text: model.content }],
          },
        })
      }
      controller.handleHostMessage({
        kind: 'refEdit.close.result', reqId: message.reqId, fsPath: model.fsPath, outcome: 'closed',
      })
      return
    }
    default:
      return
  }
}

/** 指定卡编辑器的嵌入表观测（孙位发射——from/to/inner/sole） */
function spansOf(card: HTMLElement | null): Array<Record<string, unknown>> {
  const editor = card?.querySelector('.vsidian-embed-card-live .cm-editor')
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
  if (!view) {
    return []
  }
  return view.state.field(liveEmbedSpansField, false)?.map((s) => ({
    from: s.from, to: s.to, inner: s.inner, sole: s.sole,
  })) ?? [{ missing: true }]
}

function mainView(): EditorView | null {
  const editor = document.querySelector('#app .vsidian-view-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

/** 全部嵌入卡壳（含嵌套孙卡；文档序 = DOM 序） */
function cardEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.vsidian-embed-card'))
}

/** 按 title 文本取卡壳（B/C 各唯一；同 entry 双容器并存〔模式切换过渡〕
 *  时优先取可见卡——隐藏容器卡壳不承载观测） */
function cardOfTitle(title: string): HTMLElement | null {
  const matches = cardEls().filter((c) =>
    (c.querySelector(':scope > .vsidian-embed-card-header .vsidian-embed-card-title')?.textContent ?? '')
      .includes(title))
  return matches.find((c) => c.getBoundingClientRect().height > 0) ?? matches[0] ?? null
}

function editorIn(card: HTMLElement | null): EditorView | null {
  const editor = card?.querySelector('.vsidian-embed-card-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 配置伪宿主目标模型（B/C 文本可定制——深度/循环场景） */
  setupRecursiveTargets(bText: string, cText: string) {
    targets.clear()
    boundPorts.clear()
    defineTarget('父级B', B_FS, B_DOC_URI, '父级B.md', bText)
    defineTarget('孙级C', C_FS, C_DOC_URI, '孙级C.md', cText)
    defineTarget('parent', A_FS, DOC_URI, 'parent.md', '')
  },
  initRecursiveDoc(text: string, mode: 'reading' | 'live' = 'reading') {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'recursive-itest', docUri: DOC_URI, version: 1, text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  respondRecursive(message: import('../../src/shared/protocol').HostToWebview) {
    controller.handleHostMessage(message)
  },
  setRecursiveMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  recursiveSpansOf(title: string): Array<Record<string, unknown>> {
    return spansOf(cardOfTitle(title))
  },
  recursiveSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 嵌入卡探针（view.state.readingEmbed 全量——含孙卡的 internalMode/
   *  liveBound/livePortId/liveTextLen） */
  recursiveCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  recursiveCardOf(title: string): Record<string, unknown> | undefined {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed?.find((c) => String(c.inner ?? '').includes(title))
  },
  /** 卡壳绘制观测（标题/可见性/编辑器在场与容器嵌套） */
  recursiveCardPaint(title: string): {
    present: boolean
    visible: boolean
    hasEditor: boolean
    editorInsideCard: boolean
    insideParentEditor: boolean
    modeBtnVisible: boolean
  } {
    const card = cardOfTitle(title)
    if (!card) {
      return { present: false, visible: false, hasEditor: false, editorInsideCard: false, insideParentEditor: false, modeBtnVisible: false }
    }
    const editor = card.querySelector('.vsidian-embed-card-live .cm-editor')
    const modeBtn = card.querySelector<HTMLButtonElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-mode')
    const rect = card.getBoundingClientRect()
    return {
      present: true,
      visible: rect.height > 0 && getComputedStyle(card).display !== 'none',
      hasEditor: editor !== null,
      editorInsideCard: editor !== null && card.contains(editor),
      // 孙卡是否嵌套在某个内部 Live 编辑器（B 的编辑器）的 content 内
      insideParentEditor: card.closest('.vsidian-embed-card-live .cm-content') !== null,
      modeBtnVisible: modeBtn !== null && modeBtn.style.display !== 'none',
    }
  },
  /** 点击卡壳头部模式按钮（真实 click 链路） */
  clickRecursiveMode(title: string): boolean {
    const btn = cardOfTitle(title)?.querySelector<HTMLButtonElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-mode')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 聚焦指定卡的内部编辑器并设置光标（真实键盘前提） */
  focusRecursiveEditor(title: string, pos?: number): boolean {
    const view = editorIn(cardOfTitle(title))
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
  /** 指定卡的编辑器文本 */
  recursiveEditorText(title: string): string {
    return editorIn(cardOfTitle(title))?.state.doc.toString() ?? ''
  },
  /** 主编辑器（A）文本 */
  recursiveMainText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  /** 伪宿主目标模型状态 */
  recursiveModel(name: string): { text: string; version: number; dirty: boolean; saved: number } | null {
    const model = targets.get(name)
    return model ? { text: model.content, version: model.ver, dirty: model.dirty, saved: model.savedCount } : null
  },
  /** 全文档 CM6 编辑器计数（主 + 各级嵌入——泄漏/回收观测） */
  recursiveEditorCount(): number {
    return document.querySelectorAll('#app .cm-editor').length
  },
  /** B 编辑器删除孙卡引用行（真实事务管线；#321 B 侧拦截断言载体——
   *  与 embedLiveFixture.embedDeleteRefLine 同形态，宿主换 B 内部编辑器） */
  recursiveDeleteGrandchildLine(): boolean {
    const view = editorIn(cardOfTitle('父级B.md'))
    const text = view?.state.doc.toString() ?? ''
    const idx = text.indexOf('![[孙级C]]')
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
  /** 关闭确认模态观测（P2-05 同款简化面；#321 B 侧场景） */
  recursiveCloseDialogState(): { open: boolean; text: string } {
    const box = document.querySelector<HTMLElement>('.vsidian-ref-close-dialog')
    return box ? { open: true, text: box.textContent ?? '' } : { open: false, text: '' }
  },
  /** 点击关闭模态按钮（真实 click；#321 B 侧场景） */
  recursiveDialogClick(action: 'save' | 'discard' | 'cancel'): boolean {
    const btn = document.querySelector<HTMLButtonElement>(`.vsidian-ref-close-${action}`)
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
})
