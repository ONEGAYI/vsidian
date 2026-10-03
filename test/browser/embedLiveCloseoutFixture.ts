// P2-14（#291）二期组合收口装配（embedLiveCloseout.mjs 配套）：生产
// WebviewSyncController + 多目标伪造宿主桥（B/C 各一份权威文本模型与
// 端口路由），叠加悬停浮窗与关闭模态探针——覆盖跨票组合场景：
// 浮窗内递归（P2-06×P2-09）、表格格内递归三层（P2-08×P2-09）、孙卡 C
// 资源归属（P2-11×P2-09）、模式覆盖后显式关闭（P2-05×P2-09）、空白表格
// 组合规划（P2-10 移交由 P2-11 接真后的验证）、表格网格化钉住（P2-09
// 移交评估）与代码卡复制信封（P2-14 接线）。真实 IME（CDP composition）
// 由套件侧驱动；会话来源校验与真实剪贴板由集成层覆盖。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
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
      const model = targets.get(message.target.split('|')[0])
      if (!model) {
        fail(message, 'not-found')
        return
      }
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
      const model = boundPorts.get(message.portId) ?? [...targets.values()].find((t) => t.fsPath === message.fsPath)
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
      const model = boundPorts.get(message.portId) ?? [...targets.values()].find((t) => t.fsPath === message.fsPath)
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
        if (boundPorts.get(message.portId)) {
          controller.handleHostMessage({
            kind: 'refEdit.push', portId: message.portId, fsPath: model.fsPath,
            message: {
              kind: 'doc.changed', version: ++model.ver, origin: 'external',
              changes: [{ offset: 0, length: before.length, text: model.content }],
            },
          })
        }
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

function mainView(): EditorView | null {
  const editor = document.querySelector('#app .vsidian-view-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

/** 全部嵌入卡壳（含嵌套孙卡与浮窗内卡；文档序 = DOM 序） */
function cardEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.vsidian-embed-card'))
}

/** 按 title 文本取卡壳（同 entry 双容器并存时优先可见卡） */
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
  /** 配置伪宿主目标模型（B/C 文本可定制） */
  setupCloseoutTargets(bText: string, cText: string) {
    targets.clear()
    boundPorts.clear()
    defineTarget('父级B', B_FS, B_DOC_URI, '父级B.md', bText)
    defineTarget('孙级C', C_FS, C_DOC_URI, '孙级C.md', cText)
    defineTarget('parent', A_FS, DOC_URI, 'parent.md', '')
  },
  initCloseoutDoc(text: string, mode: 'reading' | 'live' = 'reading') {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'closeout-itest', docUri: DOC_URI, version: 1, text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  setCloseoutMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  applyCloseoutSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 悬停指针事件（生产 hover.test.pointer 钩子——真实 DOM 事件派发） */
  closeoutHoverPtr(link: 'wikilink' | 'live-wikilink', action: 'enter' | 'leave', index = 0) {
    controller.handleHostMessage({ kind: 'hover.test.pointer', action, link, index })
  },
  closeoutSent(): WebviewToHost[] {
    return [...sent]
  },
  closeoutCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  closeoutCardOf(title: string): Record<string, unknown> | undefined {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed?.find((c) => String(c.inner ?? '').includes(title))
  },
  closeoutCardPaint(title: string): {
    present: boolean
    visible: boolean
    hasEditor: boolean
    insideParentEditor: boolean
    modeBtnVisible: boolean
  } {
    const card = cardOfTitle(title)
    if (!card) {
      return { present: false, visible: false, hasEditor: false, insideParentEditor: false, modeBtnVisible: false }
    }
    const editor = card.querySelector('.vsidian-embed-card-live .cm-editor')
    const modeBtn = card.querySelector<HTMLButtonElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-mode')
    const rect = card.getBoundingClientRect()
    return {
      present: true,
      visible: rect.height > 0 && getComputedStyle(card).display !== 'none',
      hasEditor: editor !== null,
      insideParentEditor: card.closest('.vsidian-embed-card-live .cm-content') !== null,
      modeBtnVisible: modeBtn !== null && modeBtn.style.display !== 'none',
    }
  },
  clickCloseoutMode(title: string): boolean {
    const btn = cardOfTitle(title)?.querySelector<HTMLButtonElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-mode')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  focusCloseoutEditor(title: string, pos?: number): boolean {
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
  /** 指定卡编辑器文本 */
  closeoutEditorText(title: string): string {
    return editorIn(cardOfTitle(title))?.state.doc.toString() ?? ''
  },
  /** 指定卡编辑器内表格网格观测（P2-09 移交钉住：display:grid 绘制层） */
  closeoutGridInfo(title: string): { gridRows: number; firstDisplay: string | null; insidePopup: boolean } {
    const card = cardOfTitle(title)
    const editor = card?.querySelector('.vsidian-embed-card-live .cm-editor') ?? null
    const rows = editor ? editor.querySelectorAll('.vsidian-table-grid-row') : []
    const first = rows[0]
    return {
      gridRows: rows.length,
      firstDisplay: first ? getComputedStyle(first).display : null,
      insidePopup: card?.closest('.vsidian-hover-popup') !== null,
    }
  },
  /** 悬停浮层 DOM 观测（绘制层） */
  readCloseoutPopup(): Record<string, unknown> {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false }
    }
    const liveEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-live')
    const editor = liveEl?.querySelector<HTMLElement>('.cm-editor') ?? null
    return {
      open: true,
      editorPresent: editor !== null,
      editorVisible: editor !== null && getComputedStyle(editor).display !== 'none',
    }
  },
  /** 关闭模态观测（embedLive 场景 I 同款口径） */
  closeoutDialogState(): { open: boolean; text: string; focusedAction: string } {
    const box = document.querySelector<HTMLElement>('.vsidian-ref-close-dialog')
    if (!box) {
      return { open: false, text: '', focusedAction: '' }
    }
    const focus = document.activeElement
    const actionOf = (target: Element | null): string =>
      target?.classList.contains('vsidian-ref-close-save') ? 'save'
        : target?.classList.contains('vsidian-ref-close-discard') ? 'discard'
          : target?.classList.contains('vsidian-ref-close-cancel') ? 'cancel' : ''
    return { open: true, text: box.textContent ?? '', focusedAction: actionOf(focus) }
  },
  clickCloseoutDialogAction(action: 'save' | 'discard' | 'cancel'): boolean {
    const btn = document.querySelector<HTMLButtonElement>(`.vsidian-ref-close-${action}`)
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  closeoutModel(name: string): { text: string; version: number; dirty: boolean; saved: number } | null {
    const model = targets.get(name)
    return model ? { text: model.content, version: model.ver, dirty: model.dirty, saved: model.savedCount } : null
  },
  closeoutEditorCount(): number {
    return document.querySelectorAll('#app .cm-editor').length
  },
  closeoutMainText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  /** P2-14 性能实测：批量目标（宽分支/重复引用场景——同名目标多次登记
   *  会相互覆盖，重复引用场景用同一名字装同文本即可，装载按 occurrence） */
  setupCloseoutBulk(entries: Array<[name: string, text: string]>) {
    targets.clear()
    boundPorts.clear()
    for (const [name, text] of entries) {
      const docUri = `file:///d%3A/notes/${encodeURIComponent(`${name}.md`)}`
      defineTarget(name, `D:\\notes\\${name}.md`, docUri, `${name}.md`, text)
    }
    defineTarget('parent', A_FS, DOC_URI, 'parent.md', '')
  },
  /** P2-14 性能实测：面板级销毁（回收基线观测） */
  closeoutDispose(): void {
    controller.dispose()
  },
  /** P2-14 性能实测：出站计数（hover.request / bind / unbind / edit.request） */
  closeoutRequestStats(): Record<string, number> {
    let hover = 0
    let bind = 0
    let unbind = 0
    let edits = 0
    for (const m of sent) {
      if (m.kind === 'hover.request') hover++
      else if (m.kind === 'refEdit.bind') bind++
      else if (m.kind === 'refEdit.unbind') unbind++
      else if (m.kind === 'refEdit.message' && m.message.kind === 'edit.request') edits++
    }
    return { hoverRequests: hover, binds: bind, unbinds: unbind, editRequests: edits }
  },
  /** P2-14 性能实测：进入内部 Live 且装载完成的卡数（等待谓词——浏览器
   *  内自包含，Node 侧直接作为 evaluate 谓词；经 view.state 生产探针通道） */
  closeoutLiveCount(minCount: number): number | null {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    const cards = (state?.readingEmbed ?? []).filter((c) =>
      c.internalMode === 'live' && c.liveBound === true && Number(c.liveTextLen ?? -1) >= 0)
    return cards.length >= minCount ? cards.length : null
  },
  /** P2-14 性能实测：父文档滚动（Reading 容器与 Live scrollDOM 双写） */
  closeoutScrollTo(top: number): boolean {
    const reading = document.querySelector<HTMLElement>('#app .vsidian-view-reading')
    if (reading) {
      const scroller = reading.querySelector<HTMLElement>('.vsidian-reading-scroll') ?? reading
      scroller.scrollTop = top
    }
    const liveScroller = document.querySelector<HTMLElement>('#app .vsidian-view-live .cm-scroller')
    if (liveScroller) {
      liveScroller.scrollTop = top
    }
    return true
  },
  controller,
})
