// P2-04（#281）嵌入卡片内部模式与目标编辑端口契约（模块级 jsdom 直驱）：
// - 内部模式状态机：默认跟随父（根条目取 context.parentMode）、手动覆盖按
//   occurrence 记忆且父切换后保留
// - 可见且内部 Live 才绑定端口（refEdit.bind）并创建 EditorView；Reading 无
//   写端口；切回 Reading / 卸载释放端口（refEdit.unbind）且不留 EditorView
// - 普通输入经 refEdit.message 出站（目标身份 = 端口 B，不串根面板）；ack /
//   外部增量推送正确驱动实例；迟到端口推送被丢弃
// - dirty 推送驱动头部圆点；bind 失败回退 Reading
// 真实键盘/指针/布局与 Ctrl+S 焦点路由在 test/browser（embedLive.mjs）；
// 真宿主 B 会话（保存/撤销路由/dirty）在集成层。
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

installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')

function harness(): { manager: EmbedCardManager; sent: WebviewToHost[]; setParentMode(m: 'reading' | 'live'): void } {
  const sent: WebviewToHost[] = []
  let parentMode: 'reading' | 'live' = 'reading'
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => parentMode,
  }
  const manager = new EmbedCardManager(context)
  return {
    manager,
    sent,
    setParentMode(mode) {
      parentMode = mode
      manager.notifyParentModeChanged()
    },
  }
}

/** 挂载一个父文档 embed 块（readingBlocks 产物同构） */
function mountEmbedBlock(manager: EmbedCardManager, text: string): HTMLElement {
  const blocks = splitReadingBlocks(text)
  const embed = blocks.find((b) => b.kind === 'embed')
  if (!embed) {
    throw new Error('文本未产生 embed 块')
  }
  const el = createReadingBlockElement(embed, text)
  document.body.appendChild(el)
  manager.mountBlock(el)
  return el
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

/** 完成一次「挂载 → 装载 → watch」流程（Live 前置：pin 在场） */
function loadCard(h: { manager: EmbedCardManager; sent: WebviewToHost[] }, docText = '![[目标笔记]]\n'): HTMLElement {
  const el = mountEmbedBlock(h.manager, docText)
  h.manager.notifyResult(resultOk(hoverRequestOf(h.sent), TARGET_TEXT))
  return el
}

function bindReqIdOf(h: { sent: WebviewToHost[] }): number {
  const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req.reqId
}

/** 驱动宿主侧 bind 闭环：bound 回执 + init 推送；返回 portId */
function bindPort(h: { manager: EmbedCardManager; sent: WebviewToHost[] }, portId = 'panel-9', version = 2): string {
  h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h), ok: true, portId, fsPath: B_FS, docUri: B_DOC_URI, version, dirty: false })
  h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version, text: TARGET_TEXT } })
  return portId
}

/** 点击头部模式切换按钮（jsdom click 走真实监听链路） */
function clickModeButton(el: HTMLElement): void {
  const btn = el.querySelector<HTMLButtonElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)
  if (!btn) {
    throw new Error('模式切换按钮不在场')
  }
  btn.click()
}

function cardOf(el: HTMLElement): HTMLElement {
  return el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`) as HTMLElement
}

function editorOf(el: HTMLElement): HTMLElement | null {
  return cardOf(el).querySelector('.cm-editor')
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('P2-04 内部模式状态机', () => {
  it('默认 Reading：装载成功后无 refEdit.bind 出站（无写端口）', () => {
    const h = harness()
    loadCard(h)
    expect(h.sent.some((m) => m.kind.startsWith('refEdit.'))).toBe(false)
    h.manager.dispose()
  })

  it('父切 Live 时跟随条目自动绑定端口（默认继承）', () => {
    const h = harness()
    loadCard(h)
    h.setParentMode('live')
    expect(h.sent.some((m) => m.kind === 'refEdit.bind')).toBe(true)
    h.manager.dispose()
  })

  it('手动切 Live 发 bind；父切回 Reading 后保留手动 Live（覆盖记忆）', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el) // reading → live（手动）
    expect(h.sent.filter((m) => m.kind === 'refEdit.bind')).toHaveLength(1)
    h.setParentMode('reading')
    // 手动覆盖不被父切换回滚：仍 Live、无 unbind
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(false)
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.internalMode).toBe('live')
    h.manager.dispose()
  })

  it('手动切回 Reading 卸载端口；父再切 Live 不复活（覆盖记忆双向）', () => {
    const h = harness()
    const el = loadCard(h)
    h.setParentMode('live')
    bindPort(h)
    clickModeButton(el) // live → reading（手动）
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    h.setParentMode('reading')
    h.setParentMode('live')
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.internalMode).toBe('reading')
    h.manager.dispose()
  })
})

describe('P2-04 端口生命周期与编辑链路', () => {
  it('bound + init 推送创建 EditorView 并装载目标全文', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    const editor = editorOf(el)
    expect(editor).toBeTruthy()
    expect(editor!.querySelector('.cm-content')!.textContent).toContain('目标正文一段。')
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.internalMode).toBe('live')
    expect(probe.liveBound).toBe(true)
    expect(probe.livePortId).toBe(portId)
    h.manager.dispose()
  })

  it('普通输入经 refEdit.message 出站，目标身份为 B 端口而非根面板', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    h.manager.typeInEmbed('目标笔记', 6, '!')
    const outbound = h.sent.filter((m) => m.kind === 'refEdit.message')
    expect(outbound).toHaveLength(1)
    const msg = outbound[0] as Extract<WebviewToHost, { kind: 'refEdit.message' }>
    expect(msg.portId).toBe(portId)
    expect(msg.message.kind).toBe('edit.request')
    if (msg.message.kind === 'edit.request') {
      expect(msg.message.sessionId).toBe(portId)
      expect(msg.message.docUri).toBe(B_DOC_URI)
      expect(msg.message.changes).toEqual([{ offset: 6, length: 0, text: '!' }])
    }
    h.manager.dispose()
  })

  it('edit.ack 推送确认后无重复出站', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    h.manager.typeInEmbed('目标笔记', 6, '!')
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'edit.ack', seq: 1, ok: true, version: 3 } })
    expect(h.sent.filter((m) => m.kind === 'refEdit.message')).toHaveLength(1)
    h.manager.dispose()
  })

  it('外部增量推送应用到嵌入编辑器且不回发（无回声）', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'doc.changed', version: 3, origin: 'external',
        changes: [{ offset: 0, length: 0, text: '前缀 ' }] } })
    expect(editorOf(el)!.querySelector('.cm-content')!.textContent).toContain('前缀 # 目标笔记')
    expect(h.sent.filter((m) => m.kind === 'refEdit.message')).toHaveLength(0)
    h.manager.dispose()
  })

  it('doc.resync 推送全文重装载', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    const next = '# 新全文\n\n重同步内容\n'
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'doc.resync', version: 5, text: next } })
    expect(editorOf(el)!.querySelector('.cm-content')!.textContent).toContain('重同步内容')
    h.manager.dispose()
  })

  it('session.suspended 推送进入暂停态（探针可见，不抛错）', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'session.suspended', version: 4, reason: 'conflict' } })
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.liveSuspended).toBe(true)
    h.manager.dispose()
  })

  it('切回 Reading：unbind 出站、EditorView 销毁、迟到端口推送零副作用', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    const portId = bindPort(h)
    clickModeButton(el) // live → reading
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    expect(editorOf(el)).toBeNull()
    // 迟到推送（释放后写入防线的行为侧）：不重建编辑器、不抛错
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'doc.changed', version: 4, origin: 'external',
        changes: [{ offset: 0, length: 0, text: '迟到' }] } })
    expect(editorOf(el)).toBeNull()
    h.manager.dispose()
  })

  it('宿主块卸载（离屏）释放端口与 EditorView；重挂按会话记忆恢复 Live', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    bindPort(h)
    expect(editorOf(el)).toBeTruthy()
    h.manager.unmountBlock(el)
    expect(document.querySelector('.cm-editor')).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)
    // 重挂：手动覆盖仍在（occurrence 记忆），装载缓存命中后重新绑定
    const el2 = mountEmbedBlock(h.manager, '![[目标笔记]]\n')
    void el2
    const binds = h.sent.filter((m) => m.kind === 'refEdit.bind')
    expect(binds.length).toBe(2)
    h.manager.dispose()
  })

  it('bind 失败（source）回退 Reading 呈现且无 EditorView', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h), ok: false, reason: 'source' })
    expect(editorOf(el)).toBeNull()
    const probe = h.manager.probe().find((p) => p.inner === '目标笔记')!
    expect(probe.internalMode).toBe('reading')
    expect(probe.liveBound).toBe(false)
    h.manager.dispose()
  })

  it('Live 在场时目标失效不触发 Reading 重载；切回 Reading 后补一次静默重载', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    bindPort(h)
    const requestsBefore = h.sent.filter((m) => m.kind === 'hover.request').length
    h.manager.notifyInvalidated({ fsPath: B_FS, status: 'changed', generation: 1 })
    expect(h.sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore)
    clickModeButton(el) // → reading
    expect(h.sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore + 1)
    h.manager.dispose()
  })
})

describe('P2-04 多 occurrence 与 dirty', () => {
  function loadTwoCards(h: { manager: EmbedCardManager; sent: WebviewToHost[] }): [HTMLElement, HTMLElement] {
    const doc = '![[目标笔记]]\n\n中间段。\n\n![[目标笔记]]\n'
    const blocks = splitReadingBlocks(doc)
    const embeds = blocks.filter((b) => b.kind === 'embed')
    const el1 = createReadingBlockElement(embeds[0]!, doc)
    document.body.appendChild(el1)
    h.manager.mountBlock(el1)
    const el2 = createReadingBlockElement(embeds[1]!, doc)
    document.body.appendChild(el2)
    h.manager.mountBlock(el2)
    // 依次回包（reqId 顺序与挂载顺序一致）
    const reqs = h.sent.filter((m) => m.kind === 'hover.request') as Array<{ reqId: number; instanceId: string }>
    h.manager.notifyResult(resultOk(reqs[0]!))
    h.manager.notifyResult(resultOk(reqs[1]!))
    return [el1, el2]
  }

  it('同目标两个 occurrence 各自绑定独立端口，输入互不串扰', () => {
    const h = harness()
    const [el1, el2] = loadTwoCards(h)
    clickModeButton(el1)
    const port1 = bindPort(h, 'panel-9')
    clickModeButton(el2)
    const port2 = bindPort(h, 'panel-10')
    expect(port1).not.toBe(port2)
    // occurrence 1 输入：只有其端口的 edit.request
    h.manager.typeInEmbed('目标笔记', 6, '一', 0)
    const outbound = h.sent.filter((m) => m.kind === 'refEdit.message') as Array<Extract<WebviewToHost, { kind: 'refEdit.message' }>>
    expect(outbound).toHaveLength(1)
    expect(outbound[0]!.portId).toBe(port1)
    // occurrence 2 的编辑器文本不受影响
    expect(editorOf(el2)!.querySelector('.cm-content')!.textContent).not.toContain('一!')
    h.manager.dispose()
  })

  it('dirty 推送驱动头部圆点；保存失败回执不误清', () => {
    const h = harness()
    const el = loadCard(h)
    clickModeButton(el)
    bindPort(h)
    const dot = () => cardOf(el).querySelector(`.${EMBED_CARD_CLASS_NAMES.dirty}`)
    expect(dot()).toBeNull()
    h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
    expect(dot()).toBeTruthy()
    h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: false })
    expect(dot()).toBeNull()
    // 再脏 + 保存失败回执：圆点保留（保存失败不误清）
    h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty: true })
    h.manager.notifySaveResult({ kind: 'refEdit.save.result', portId: 'panel-9', fsPath: B_FS, ok: false })
    expect(dot()).toBeTruthy()
    h.manager.dispose()
  })
})
