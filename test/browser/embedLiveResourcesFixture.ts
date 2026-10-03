// P2-11（#288）嵌入内部 Live 的目标资源接线回归装配（embedLiveResources.mjs
// 配套）：生产 WebviewSyncController + 伪造宿主桥——资源管线按本票协议应答
//（refEdit.message 信封内的 image.request / image.paste / refresh.request /
// link.activate / wikilink.activate），真实 Chromium 布局下验证 B 身份解析、
// 粘贴插入与弹窗实例上下文。B 侧其余会话语义沿用 embedLiveFixture 的极简
// 模型（编辑/undo/save 不在本套件重点，宿主真身在集成层）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

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

/** B 全文：独立成行图片（chrome 弹窗按钮形态）+ 链接 + 双链（渲染态点击面） */
const TARGET_TEXT = [
  '# 目标笔记标题',
  '',
  '![B 图](only-in-b.png)',
  '',
  '[B 链接](inner-target.md) 与 [[B内双链]]',
  '',
].join('\n')

const bModel = { content: TARGET_TEXT, ver: 2, dirty: false }

const boundPorts = new Set<string>()
let portSeq = 0

/** 资源观测日志（伪宿主收到的 B 身份资源消息——断言载体） */
const resourceLog: Array<{ kind: string; portId: string; detail: Record<string, unknown> }> = []
/** 图片解析地址（data URL 浏览器可真实 load——绘制层 loaded 断言的前提；
 *  每代次换内容（fill 变化）——手动刷新换新 URI 重载的断言载体，data URL
 *  不能附 query（会破坏载荷），代次直接编进 SVG 内容） */
const picOf = (gen: number): string => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="${gen % 2 === 0 ? '#4a7d6a' : '#7d4a6a'}">g${gen}</rect></svg>`)
let imageGeneration = 1
let refreshGeneration = 0
/** 下一次粘贴应答配置（ok/markdown/丢弃） */
let pasteReply: { drop: boolean; ok: boolean; markdown?: string } = { drop: false, ok: true, markdown: '![image](assets/pasted-b.png)' }

function bPushTo(portId: string, message: import('../../src/shared/protocol').HostToWebview): void {
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
        sourceLeaseId: `panel-1:source-${++portSeq}`,
      })
      return
    }
    case 'image.request': {
      // A 面板直发（Reading 容器的 B 内容管理器，#220 sourceDocUri 形态——
      // 双容器并存的既有合法路径）：伪宿主同样应答（两通道都真实走通）
      if (message.src !== 'only-in-b.png') {
        controller.handleHostMessage({ kind: 'image.result', reqId: message.reqId, ok: false, reason: 'not-found' })
      } else {
        controller.handleHostMessage({ kind: 'image.result', reqId: message.reqId, ok: true, src: picOf(imageGeneration) })
      }
      return
    }
    case 'refEdit.bind': {
      const portId = `refport-res-${++portSeq}`
      boundPorts.add(portId)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: B_FS, docUri: B_DOC_URI,
        version: bModel.ver, dirty: bModel.dirty,
      })
      bPushTo(portId, { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: bModel.ver, text: bModel.content })
      return
    }
    case 'refEdit.unbind': {
      boundPorts.delete(message.portId)
      return
    }
    case 'refEdit.message': {
      if (!boundPorts.has(message.portId)) {
        return
      }
      const inner = message.message
      switch (inner.kind) {
        case 'image.request': {
          // B 会话解析：伪宿主只认 B 内图源（only-in-b.png），其余 not-found
          //（按 B 目录解析的语义近似——目标文件只存在于 B 目录）
          if (inner.src !== 'only-in-b.png') {
            bPushTo(message.portId, { kind: 'image.result', reqId: inner.reqId, ok: false, reason: 'not-found' })
          } else {
            bPushTo(message.portId, { kind: 'image.result', reqId: inner.reqId, ok: true, src: picOf(imageGeneration) })
          }
          return
        }
        case 'image.paste': {
          resourceLog.push({ kind: 'image.paste', portId: message.portId, detail: { reqId: inner.reqId, mime: inner.mime, docUri: inner.docUri } })
          if (pasteReply.drop) {
            return // 丢弃（迟到结果场景：宿主不回包）
          }
          if (pasteReply.ok) {
            bPushTo(message.portId, { kind: 'image.paste.result', reqId: inner.reqId, ok: true, markdown: pasteReply.markdown! })
          } else {
            bPushTo(message.portId, { kind: 'image.paste.result', reqId: inner.reqId, ok: false, reason: 'write-failed' })
          }
          return
        }
        case 'refresh.request': {
          refreshGeneration++
          imageGeneration++
          bPushTo(message.portId, { kind: 'refresh.invalidated', reqId: inner.reqId, generation: refreshGeneration })
          return
        }
        case 'link.activate': {
          resourceLog.push({ kind: 'link.activate', portId: message.portId, detail: { href: inner.href, docUri: inner.docUri } })
          return
        }
        case 'wikilink.activate': {
          resourceLog.push({ kind: 'wikilink.activate', portId: message.portId, detail: { target: inner.target, docUri: inner.docUri } })
          return
        }
        case 'edit.request': {
          bModel.content = applyTo(bModel.content, inner.changes)
          bModel.ver++
          if (!bModel.dirty) {
            bModel.dirty = true
            controller.handleHostMessage({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
          }
          bPushTo(message.portId, { kind: 'edit.ack', seq: inner.seq, ok: true, version: bModel.ver })
          return
        }
        default:
          return
      }
    }
    case 'image.export': {
      // A 面板通道直发（弹窗导出）：记录（sourceDocUri 断言载体）
      resourceLog.push({
        kind: 'image.export',
        portId: '',
        detail: { src: message.src, sourceDocUri: message.sourceDocUri ?? null, sessionId: message.sessionId },
      })
      controller.handleHostMessage({ kind: 'image.export.result', reqId: message.reqId, ok: true })
      return
    }
    case 'refresh.request': {
      // A 面板自身的刷新应答（面板级 reqId 配对）
      controller.handleHostMessage({ kind: 'refresh.invalidated', reqId: message.reqId, generation: ++refreshGeneration })
      return
    }
    default:
      return
  }
}

function applyTo(text: string, changes: Array<{ offset: number; length: number; text: string }>): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

function mainView(): EditorView | null {
  const editor = document.querySelector('#app .vsidian-view-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

function embedEditorView(): EditorView | null {
  const editor = document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

Object.assign(window, {
  /** 宿主消息注入（与真实 handleHostMessage 同入口） */
  respondEmbedLive(message: import('../../src/shared/protocol').HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 定向注入迟到的粘贴回包（释放后迟到场景：webview 侧丢弃的行为断言） */
  respondEmbedLiveResourcePush(portId: string, reqId: number, markdown: string): void {
    controller.handleHostMessage({
      kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'image.paste.result', reqId, ok: true, markdown },
    })
  },
  initEmbedLiveDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'embed-res-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  embedLiveSent(): WebviewToHost[] {
    return [...sent]
  },
  embedLiveCards(): Array<Record<string, unknown>> {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = [...sent].reverse().find((m) => m.kind === 'view.state') as
      | { readingEmbed?: Array<Record<string, unknown>> }
      | undefined
    return state?.readingEmbed ?? []
  },
  embedEditorText(): string {
    return embedEditorView()?.state.doc.toString() ?? ''
  },
  mainEditorText(): string {
    return mainView()?.state.doc.toString() ?? ''
  },
  focusEmbedEditor(): boolean {
    embedEditorView()?.focus()
    return document.activeElement instanceof HTMLElement &&
      !!document.activeElement.closest('.vsidian-embed-card')
  },
  /** 光标落 B 全文末尾（渲染态图片/链接/双链的显隐前提）并聚焦 */
  focusEmbedAtEnd(): boolean {
    const view = embedEditorView()
    if (!view) {
      return false
    }
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
    return true
  },
  /** 宿主收到的资源消息日志 */
  embedResourceLog(): Array<{ kind: string; portId: string; detail: Record<string, unknown> }> {
    return resourceLog.map((r) => ({ ...r, detail: { ...r.detail } }))
  },
  /** 内部 Live 编辑器内已应用图片的槽位观测（限定 .vsidian-embed-card-live
   *  容器——Reading 容器是另一管理器（直发路径），两者并存不混观测） */
  embedImageSlots(): Array<{ src: string; state: string }> {
    const out: Array<{ src: string; state: string }> = []
    for (const slot of document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image')) {
      out.push({ src: slot.dataset['vsidianImgSrc'] ?? '', state: slot.dataset['vsidianImgState'] ?? '' })
    }
    return out
  },
  /** 图片弹窗观测（在场/img src/装载状态） */
  embedImagePopupState(): { open: boolean; src: string; state: string } {
    const overlay = document.querySelector<HTMLElement>('.vsidian-diagram-overlay')
    const img = overlay?.querySelector('img') ?? null
    return {
      open: overlay !== null,
      src: img?.getAttribute('src') ?? '',
      state: img?.closest('.vsidian-image')?.classList.contains('vsidian-image-loaded') ? 'loaded' : 'other',
    }
  },
  /** 点击嵌入内图片的弹窗按钮（真实点击 chrome 按钮组） */
  clickEmbedImagePopupButton(): boolean {
    const card = document.querySelector<HTMLElement>('.vsidian-embed-card')
    const btn = card?.querySelector<HTMLElement>('.vsidian-embed-card-live .vsidian-graphic-frame.vsidian-image .vsidian-graphic-chrome-popup')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 点击弹窗内导出钮（真实点击） */
  clickImagePopupExport(): boolean {
    const btn = document.querySelector<HTMLElement>('.vsidian-diagram-overlay .vsidian-diagram-export-image')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 测试钩子注入粘贴载荷（与真实 paste 拦截同一实例管线） */
  embedTestPasteImage(mime: string, dataBase64: string): boolean {
    controller.handleHostMessage({
      kind: 'embed.test.pasteImage',
      inner: '目标笔记',
      mime,
      dataBase64,
    })
    return true
  },
  /** 配置伪宿主下一次粘贴应答（drop = 不回包——迟到结果场景） */
  embedSetPasteReply(next: { drop: boolean; ok: boolean; markdown?: string }): void {
    pasteReply = next
  },
  /** 工具栏刷新按钮（真实点击） */
  clickToolbarRefresh(): boolean {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 内部模式切回 Reading（释放端口——迟到结果断言前提） */
  clickEmbedModeButton(): boolean {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-embed-card .vsidian-embed-card-mode')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  embedTargetModel(): { text: string; dirty: boolean } {
    return { text: bModel.content, dirty: bModel.dirty }
  },
})
