// #569（T04）全文文档样式装载的原生浏览器回归装配（docStyle.mjs 配套）：
// 生产 WebviewSyncController + 伪造宿主桥（A/B/C 三文档极简权威模型——
// hover.request 应答全文、refEdit 族应答绑定/编辑回包），在真实布局
// （Chromium）验证 b2 隔离装载：多处 style 块层叠、Markdown 标签 Reading
// 直中、工具栏/源码层排除、A→B→C 嵌套隔离与多 B 实例共享、虚拟化与
// 滚动稳定、Live 编辑/撤销/重做同步产物。宿主回包经微任务延迟（真实
// postMessage 异步往返，同步回包会在出站栈内重入）。
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

/** 编辑历史（fixture 层逆操作栈——宿主 undo 管线的近似） */
const editHistory: Array<{ offset: number; newText: string; oldText: string }> = []
const redoStack: Array<{ offset: number; newText: string; oldText: string }> = []
let docVersion = 1

const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [
  keymap.of(defaultKeymap),
  EditorState.allowMultipleSelections.of(true),
])

const DOC_URI = 'file:///d%3A/notes/main-a.md'
const B_FS = 'D:\\notes\\目标B.md'
const B_TARGET = '目标B'
const C_FS = 'D:\\notes\\孙级C.md'
const C_TARGET = '孙级C'

/** 三文档权威模型（fsPath → 全文）；B/C 内容由测试注入 */
const targets = new Map<string, { fsPath: string; text: string; version: number }>()

/** refEdit 端口簿（B 卡 Live 绑定链的最小应答） */
const boundPorts = new Map<string, string>() // portId → target

function liveView(): EditorView | null {
  const editor = document.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

async function fakeHostHandle(message: WebviewToHost): Promise<void> {
  switch (message.kind) {
    case 'hover.request': {
      const target = targets.get(message.target)
      if (!target) {
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
        target: { fsPath: target.fsPath, relPath: `${message.target}.md` },
        version: target.version,
        text: target.text,
        range: { start: 0, end: target.text.length },
        scope: { kind: 'full' },
        depth: 1,
        expansionPath: [],
        sourceLeaseId: `docstyle-src-${message.reqId}`,
      })
      return
    }
    case 'refEdit.bind': {
      const target = [...targets.values()].find((t) => t.fsPath === message.fsPath) ??
        targets.get(message.occurrence ?? '')
      if (!target) {
        return
      }
      const portId = `port-${message.reqId}`
      boundPorts.set(portId, target.fsPath)
      controller.handleHostMessage({
        kind: 'refEdit.bound', reqId: message.reqId, ok: true,
        portId, fsPath: target.fsPath,
        docUri: `file:///d%3A/notes/${encodeURIComponent(target.fsPath.split(/[\\/]/).pop() ?? 'b')}`,
        version: target.version, dirty: false,
      })
      // ready 握手的 init 推送（会话全文本——生产宿主同款）
      controller.handleHostMessage({
        kind: 'refEdit.push', portId, fsPath: target.fsPath,
        message: {
          kind: 'init', sessionId: portId,
          docUri: `file:///d%3A/notes/${encodeURIComponent(target.fsPath.split(/[\\/]/).pop() ?? 'b')}`,
          version: target.version, text: target.text,
        } as never,
      })
      return
    }
    default:
      // docStyle 测试不消费其余宿主面（编辑回包/保存等）——静默
      return
  }
}

Object.assign(window, {
  /** 注入 B/C 目标内容 + 装载主文档（Live 起步） */
  initDocStyleDoc(text: string, bText: string, cText: string) {
    targets.set(B_TARGET, { fsPath: B_FS, text: bText, version: 3 })
    targets.set(C_TARGET, { fsPath: C_FS, text: cText, version: 2 })
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'doc-style-itest',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式（reading 附带滚回顶部——模式锚点可能把视口留在深处，
   *  前部块不在挂载窗口；读值断言以前部块为对象） */
  setDocStyleMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
    if (mode === 'reading') {
      const scroller = document.querySelector('.vsidian-main > .vsidian-view-reading')
      if (scroller instanceof HTMLElement) {
        scroller.scrollTop = 0
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
      }
    }
  },
  /** 主文编辑：dispatch 真实事务（替换区间文本——style 块内容编辑链）；
   *  逆操作入栈（undo 模拟宿主文本管线的外部增量回流） */
  docStyleReplace(from: number, to: number, text: string) {
    const view = liveView()
    if (!view) return
    const before = view.state.doc.sliceString(from, to)
    editHistory.push({ offset: from, newText: text, oldText: before })
    view.dispatch({ changes: { from, to, insert: text } })
    docVersion += 1 // 本地编辑乐观推进（控制器版本模型同款）
  },
  /** 主文撤销（宿主 undo 的近似：全文重同步回流——本扩展不用 CM6
   *  history，撤销栈归宿主文本管线；resync 与增量同为真实宿主通道） */
  docStyleUndo(): boolean {
    const last = editHistory.pop()
    if (!last) return false
    redoStack.push(last)
    const view = liveView()
    if (!view) return false
    const text = view.state.doc.toString()
    const restored = text.slice(0, last.offset) + last.oldText + text.slice(last.offset + last.newText.length)
    controller.handleHostMessage({ kind: 'doc.resync', version: ++docVersion, text: restored })
    return true
  },
  docStyleRedo(): boolean {
    const next = redoStack.pop()
    if (!next) return false
    editHistory.push(next)
    const view = liveView()
    if (!view) return false
    const text = view.state.doc.toString()
    const restored = text.slice(0, next.offset) + next.newText + text.slice(next.offset + next.oldText.length)
    controller.handleHostMessage({ kind: 'doc.resync', version: ++docVersion, text: restored })
    return true
  },
  /** 主文全文（编辑后区间计算源） */
  docStyleDocText(): string {
    return liveView()?.state.doc.toString() ?? ''
  },
  /** head 内文档样式产物元素（键集 + 规则数 + 文本） */
  docStyleHeadInfo() {
    const els = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-vsidian-doc-style]'))
    return els.map((el) => ({
      scope: el.getAttribute('data-vsidian-doc-style') ?? '',
      rules: el.sheet ? el.sheet.cssRules.length : -1,
      text: el.textContent ?? '',
      /** 决策点 2 判据：产物之后不得再出现片段 <link>（文档后置于片段链；
       *  CM6 style-mod 等系统 style 可能动态追加其后，不参与判定） */
      snippetLinkAfter: Array.from(document.head.querySelectorAll('[data-vsidian-snippet]'))
        .some((link) => link.compareDocumentPosition(el) === Node.DOCUMENT_POSITION_PRECEDING),
    }))
  },
  /** 绘制读值：主文 Markdown 标题/段落、html 块变量位、工具栏、源码行
   *  （主容器限定 .vsidian-main > .vsidian-view-reading——B 卡的隐藏
   *  Reading 容器在 liveWrapper 内、文档序在前，不限定会读错对象） */
  readDocStylePaint() {
    const read = (el: Element | null, prop: string): string =>
      el ? getComputedStyle(el).getPropertyValue(prop).trim() : ''
    const main = document.querySelector('.vsidian-main > .vsidian-view-reading')
    // 直接子块限定：视口窗口中 B 卡的段落可能先于 A 的段落（挂载窗口
    // 与文档序无关），主文读值只看主容器直接子块（嵌入块内的卡不计）
    const firstReading = (sel: string): Element | null =>
      main?.querySelector(`:scope > ${sel}`) ?? null
    return {
      aH1Color: read(firstReading('.vsidian-reading-heading-1 h1'), 'color'),
      aH1FontSize: read(firstReading('.vsidian-reading-heading-1 h1'), 'font-size'),
      aPColor: read(firstReading('.vsidian-reading-paragraph p'), 'color'),
      aVarColor: read(firstReading('.vsidian-reading-html .mark-a'), 'color'),
      aMarkBg: read(firstReading('.vsidian-reading-html .mark-a'), 'background-color'),
      toolbarColor: read(document.querySelector('.vsidian-toolbar'), 'color'),
      cmLineColor: read(document.querySelector('.cm-content .cm-line'), 'color'),
      /** 主容器**直接子块**（A 的内容块——B 卡内块挂 B 键不计入） */
      readingBlockCount: main?.querySelectorAll(':scope > .vsidian-reading-block').length ?? 0,
      scopedBlockCount: main?.querySelectorAll(':scope > .vsidian-reading-block[data-vsidian-doc-scope="doc"]').length ?? 0,
      styleBlockVisible: document.querySelector('.vsidian-reading-html')?.textContent?.includes('{') ?? false,
    }
  },
  /** 嵌入卡观测：主阅读容器内各卡内容读值（限定主容器——B 的隐藏
   *  Reading 容器内的卡壳不参与）；nested = 卡内卡（B 内容中的 C 孙卡） */
  readDocStyleEmbeds() {
    const main = document.querySelector('.vsidian-main > .vsidian-view-reading')
    return Array.from(main?.querySelectorAll<HTMLElement>(':scope .vsidian-embed-card') ?? []).map((card) => {
      const p = card.querySelector('.vsidian-reading-paragraph p')
      const h1 = card.querySelector('.vsidian-reading-heading-1 h1')
      const scope = card.querySelector('[data-vsidian-doc-scope]')
      return {
        nested: card.parentElement?.closest('.vsidian-embed-card') != null,
        pColor: p ? getComputedStyle(p).color : '',
        h1Color: h1 ? getComputedStyle(h1).color : '',
        scopeValue: scope?.getAttribute('data-vsidian-doc-scope') ?? null,
        scopeAttr: scope?.getAttributeNames().filter((n) => n.startsWith('data-vsidian-doc')) ?? [],
      }
    })
  },
  /** Reading 滚动容器滚到指定比例（真实 scroll 事件驱动虚拟化窗口） */
  docStyleScrollRatio(ratio: number) {
    const scroller = document.querySelector('.vsidian-main > .vsidian-view-reading')
    if (scroller instanceof HTMLElement) {
      scroller.scrollTop = scroller.scrollHeight * ratio
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
  },
  controller,
})
