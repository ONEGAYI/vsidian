// T08（#659）引用实例 Callout 的原生浏览器回归装配（calloutRefEmbed.mjs
// 配套）：生产 WebviewSyncController + 伪造宿主桥（embedLiveFixture 同款
// 模式的精简版）——Reading 嵌入卡内消费同一 callout 管线（呈现/折叠/
// 图标注入/实例独立/Live↔Reading 往返）。真实宿主 B 会话在集成层；此处
// 聚焦 webview 行为与绘制层断言。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { docScopeKeyOf } from '../../src/shared/docStyle'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView } from '@codemirror/view'
import { keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { calloutFoldField } from '../../src/webview/calloutFold'
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

/** B 权威文本模型（LF 坐标；宿主 TextDocument 行为近似） */
const bModel = { content: '', ver: 2 }
let bindSeq = 0
const boundPorts = new Set<string>()

async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
    case 'hover.request': {
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
      const portId = `refport-callout-${++bindSeq}`
      boundPorts.add(portId)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: B_FS, docUri: B_DOC_URI,
        version: bModel.ver, dirty: false,
      })
      controller.handleHostMessage({
        kind: 'refEdit.push', portId, fsPath: B_FS,
        message: { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: bModel.ver, text: bModel.content },
      })
      return
    }
    case 'refEdit.unbind': {
      boundPorts.delete(message.portId)
      return
    }
    default:
      return
  }
}

function cardAt(index: number): HTMLElement | null {
  // 双容器并存（Reading 容器 + Live widget 容器同 entry 两 handle）：
  // 只取可见卡（隐藏容器 offsetParent 为 null——浏览器布局判定）
  const cards = [...document.querySelectorAll<HTMLElement>('.vsidian-embed-card')]
    .filter((el) => el.offsetParent !== null)
  return cards[index] ?? null
}

Object.assign(window, {
  /** 装配父文档并切 Reading（嵌入卡 Reading 呈现起步） */
  initCalloutRefEmbed(mainText: string, bText: string) {
    bModel.content = bText
    controller.handleHostMessage({
      kind: 'init', sessionId: 'callout-ref-itest', docUri: DOC_URI,
      version: 1, text: mainText,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  /** 卡内指定类型 callout 的可观察状态（绘制层：contentDisplay / 图标尺寸） */
  refCalloutInfo(cardIndex: number, type: string): {
    present: boolean
    collapsed: boolean
    collapsible: boolean
    contentDisplay: string | null
    arrowCount: number
    iconInjected: boolean
    iconSvg: boolean
    iconPainted: boolean
    titleText: string
  } {
    const card = cardAt(cardIndex)
    const dom = card?.querySelector<HTMLElement>(`div.callout[data-callout="${type}"]`) ?? null
    const content = dom?.querySelector<HTMLElement>('.callout-content') ?? null
    const icon = dom?.querySelector<HTMLElement>('.callout-icon') ?? null
    const iconRect = icon?.getBoundingClientRect()
    return {
      present: dom !== null,
      collapsed: dom?.classList.contains('is-collapsed') ?? false,
      collapsible: dom?.classList.contains('is-collapsible') ?? false,
      contentDisplay: content ? getComputedStyle(content).display : null,
      arrowCount: dom?.querySelectorAll('.callout-fold').length ?? 0,
      iconInjected: icon?.classList.contains('vsidian-callout-icon-custom') ?? false,
      iconSvg: icon?.querySelector('svg') !== null,
      iconPainted: iconRect !== undefined && iconRect.width > 0 && iconRect.height > 0,
      titleText: dom?.querySelector('.callout-title-inner')?.textContent ?? '',
    }
  },
  /** 真实点击卡内指定 callout 的箭头 */
  refClickArrow(cardIndex: number, type: string): boolean {
    const card = cardAt(cardIndex)
    const arrow = card?.querySelector<HTMLElement>(`div.callout[data-callout="${type}"] .callout-fold`) ?? null
    if (!arrow) {
      return false
    }
    arrow.click()
    return true
  },
  /** 点击卡头部模式按钮（Reading ↔ Live） */
  refToggleCardMode(cardIndex: number): boolean {
    const card = cardAt(cardIndex)
    const btn = card?.querySelector<HTMLButtonElement>('.vsidian-embed-card-mode') ?? null
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  /** 卡内部 Live 的 callout 折叠 StateField 快照（键 → {folded, declFold}） */
  refEmbedFoldField(): Array<{ key: number; folded: boolean; declFold: string }> {
    const editor = document.querySelector<HTMLElement>('.vsidian-embed-card .vsidian-embed-card-live .cm-editor')
    const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
    const field = view?.state.field(calloutFoldField, false)
    if (!field) {
      return []
    }
    return [...field.entries()].map(([key, v]) => ({ key, folded: v.folded, declFold: v.declFold }))
  },
  /** 页面注入片段样式（--callout-icon 定制等） */
  refInjectSnippet(css: string): void {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
  },
  /** 卡内 CM6 编辑器计数（Live 资源回收观测） */
  refEmbedEditorCount(): number {
    return document.querySelectorAll('.vsidian-embed-card .cm-editor').length
  },
  /** 已出站消息快照（零写回断言的计数基线） */
  refSent(): WebviewToHost[] {
    return [...sent]
  },
  /** B 目标的文档样式身份键（docScopeKeyOf 派生——预览探针断言的期望值） */
  refBDocScope(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return docScopeKeyOf(B_FS)
  },
  /** 卡内指定 callout 标题行位置派发 contextmenu（真实监听链路——嵌入
   *  contentDOM 转发 → onEmbedLiveContextMenu → openContextMenu）。
   *  行元素限定在 live 容器内查（卡根下隐藏的 Reading 容器 DOM 同在，
   *  其 div.callout 非 .cm-line 会误命中） */
  refContextMenuAtCallout(cardIndex: number, type: string): boolean {
    const card = cardAt(cardIndex)
    const live = card?.querySelector<HTMLElement>('.vsidian-embed-card-live') ?? null
    const line = live?.querySelector<HTMLElement>(`[data-callout="${type}"]`)?.closest('.cm-line') ?? null
    if (!live || !line || !line.closest('.cm-content')) {
      return false
    }
    const rect = line.getBoundingClientRect()
    line.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.x + Math.min(rect.width / 2, 120), clientY: rect.y + rect.height / 2,
    }))
    return true
  },
  /** 菜单预览探针的文档样式身份（无探针返回 null） */
  refMenuProbeDocScope(): string | null {
    const probe = document.querySelector<HTMLElement>('.vsidian-callout-menu-probe')
    return probe?.getAttribute('data-vsidian-doc-scope') ?? null
  },
})
