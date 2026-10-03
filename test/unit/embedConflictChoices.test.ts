// P2-12（#289）写入冲突三项选择契约（jsdom 直驱生产控制器）：
// - 冲突暂停现场（session.suspended 推送）状态行就地呈现「对比并解决 /
//   放弃当前版本 / 取消」三项按钮，文案与 hover（compare hover 逐字为
//   「在临时副本和冲突版本的对比视图中处理冲突」）经 i18n
// - 对比并解决：出站 refEdit.conflictCompare（text = 实例当前全文快照）；
//   在途防重入；恢复由宿主直驱（resumePanel → doc.resync 解除暂停，旧输入
//   不重放——对比页激活会隐藏来源 webview，恢复不依赖 webview 存活）；
//   失败保留选择现场并就地提示，可重试
// - 放弃当前版本：经端口出站 sync.request（宿主侧恢复语义由
//   documentSession 契约钉住——suspend 面板的 sync.request 走 resumePanel）
// - 取消：收起选择（保持暂停与当前输入），「重新选择」入口可再展开
// 真实键盘/指针观感在 test/browser（embedLiveActions.mjs）；untitled/diff
// 真宿主链路在集成层。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EMBED_CARD_CLASS_NAMES, EmbedCardManager } from '../../src/webview/embedCard'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView } from '@codemirror/view'

installLocale('zh-cn', zhCn)

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const B_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')
const A_TEXT = '![[目标笔记]]\n'

function resultOk(
  req: { reqId: number; instanceId: string },
  text = B_TEXT,
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

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function bindReqIdOf(sent: WebviewToHost[]): number {
  const req = [...sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req.reqId
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function setupController() {
  const sent: WebviewToHost[] = []
  const controller = new WebviewSyncController({
    postMessage: (message) => { sent.push(message as WebviewToHost) },
    getState: () => undefined,
    setState: () => undefined,
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  controller.mount(root)
  controller.handleHostMessage({
    kind: 'init', sessionId: SESSION.sessionId, docUri: SESSION.docUri,
    version: 1, text: A_TEXT,
  })
  const manager = (controller as unknown as { embedCards: EmbedCardManager }).embedCards
  const host = document.createElement('div')
  document.body.appendChild(host)
  manager.mountCardInto(host, '目标笔记', 0, A_TEXT.indexOf('\n'), 'reading')
  manager.notifyResult(resultOk(hoverRequestOf(sent)))
  const enterLive = (): void => {
    controller.handleHostMessage({ kind: 'embed.test.mode', inner: '目标笔记', mode: 'live' })
    manager.notifyBound({
      kind: 'refEdit.bound', reqId: bindReqIdOf(sent), ok: true,
      portId: 'port-9', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false,
    })
    manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-9', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'port-9', docUri: B_DOC_URI, version: 2, text: B_TEXT },
    })
  }
  /** 注入冲突暂停推送（session.suspended —— 与真实冲突同驱动路径） */
  const suspendPort = (): void => {
    manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-9', fsPath: B_FS,
      message: { kind: 'session.suspended', version: 2, reason: 'conflict' },
    })
  }
  /** 宿主回 compare 结果 */
  const replyCompare = (ok: boolean): void => {
    controller.handleHostMessage({
      kind: 'refEdit.conflictCompare.result', portId: 'port-9', fsPath: B_FS, ok,
    })
  }
  /** 宿主回 doc.resync（sync.request 的应答——解除暂停） */
  const replyResync = (text = B_TEXT): void => {
    manager.notifyPush({
      kind: 'refEdit.push', portId: 'port-9', fsPath: B_FS,
      message: { kind: 'doc.resync', version: 3, text },
    })
  }
  const embedView = (): EditorView | null => {
    // 聚焦嵌入编辑器后取实例视图（focusedLive 按真实 activeElement 判定）
    controller.handleHostMessage({ kind: 'embed.test.focus', inner: '目标笔记' })
    const instance = manager.focusedLive()
    return instance?.getView() ?? null
  }
  const stateEl = (): HTMLElement => {
    const el = document.querySelector(`.${EMBED_CARD_CLASS_NAMES.state}`)
    if (!(el instanceof HTMLElement)) {
      throw new Error('状态行不在场')
    }
    return el
  }
  const btn = (suffix: string): HTMLButtonElement | null =>
    stateEl().querySelector<HTMLButtonElement>(`.vsidian-embed-card-conflict-${suffix}`)
  return {
    controller, manager, sent, host, enterLive, suspendPort, replyCompare, replyResync,
    embedView, stateEl, btn,
  }
}

describe('P2-12 冲突暂停现场的三项选择', () => {
  it('suspended 推送后状态行呈现三项按钮：文案与 hover（compare hover 逐字）', () => {
    const s = setupController()
    s.enterLive()
    // 暂停前无选择条
    expect(document.querySelector('.vsidian-embed-card-conflict')).toBeNull()
    s.suspendPort()
    expect(s.stateEl().textContent).toContain('编辑已暂停')
    expect(s.btn('compare')).not.toBeNull()
    expect(s.btn('discard')).not.toBeNull()
    expect(s.btn('cancel')).not.toBeNull()
    expect(s.btn('compare')!.textContent).toBe('对比并解决')
    expect(s.btn('discard')!.textContent).toBe('放弃当前版本')
    expect(s.btn('cancel')!.textContent).toBe('取消')
    // hover 精确匹配（用户指定原文逐字）
    expect(s.btn('compare')!.getAttribute('data-tooltip'))
      .toBe('在临时副本和冲突版本的对比视图中处理冲突')
    expect(s.btn('discard')!.getAttribute('data-tooltip')).toContain('放弃')
    expect(s.btn('cancel')!.getAttribute('data-tooltip')).toContain('保持')
    expect(s.manager.probe()[0]!.conflictChoice).toBe('open')
    s.controller.dispose()
  })

  it('非暂停（正常态）不出现选择条；解除暂停后选择条移除', () => {
    const s = setupController()
    s.enterLive()
    expect(s.manager.probe()[0]!.conflictChoice).toBe('none')
    s.suspendPort()
    expect(s.manager.probe()[0]!.conflictChoice).toBe('open')
    s.replyResync()
    expect(s.manager.probe()[0]!.conflictChoice).toBe('none')
    expect(document.querySelector('.vsidian-embed-card-conflict')).toBeNull()
    s.controller.dispose()
  })
})

describe('P2-12 对比并解决（refEdit.conflictCompare 出站与结果路由）', () => {
  it('点击 compare 出站实例当前全文快照（含未提交输入）', () => {
    const s = setupController()
    s.enterLive()
    s.suspendPort()
    // 冲突后用户继续输入（本地保留——未提交输入）
    const view = s.embedView()!
    view.dispatch({ changes: { from: view.state.doc.length, insert: '未提交输入' } })
    s.btn('compare')!.click()
    const compare = s.sent.find((m) => m.kind === 'refEdit.conflictCompare')
    expect(compare && compare.kind === 'refEdit.conflictCompare').toBe(true)
    if (compare && compare.kind === 'refEdit.conflictCompare') {
      expect(compare.text).toBe(`${B_TEXT}未提交输入`)
      expect(compare.portId).toBe('port-9')
      expect(compare.fsPath).toBe(B_FS)
    }
    s.controller.dispose()
  })

  it('在途防重入：结果未回期间再次点击零出站；按钮 disabled', () => {
    const s = setupController()
    s.enterLive()
    s.suspendPort()
    s.btn('compare')!.click()
    expect(s.manager.probe()[0]!.conflictComparePending).toBe(true)
    expect(s.btn('compare')!.disabled).toBe(true)
    s.btn('compare')!.click()
    expect(s.sent.filter((m) => m.kind === 'refEdit.conflictCompare')).toHaveLength(1)
    s.controller.dispose()
  })

  it('结果 ok：恢复由宿主直驱（webview 不出站 sync.request）；doc.resync 到达后解除暂停且旧输入不重放', () => {
    const s = setupController()
    s.enterLive()
    s.suspendPort()
    const view = s.embedView()!
    view.dispatch({ changes: { from: view.state.doc.length, insert: '未提交输入' } })
    s.btn('compare')!.click()
    s.replyCompare(true)
    // 对比页激活会隐藏来源 webview——恢复不能依赖 webview 再出站请求：
    // ok 后零出站（宿主 resumePanel 直驱）
    expect(s.sent.some((m) => m.kind === 'refEdit.message' &&
      (m as { message?: { kind?: string } }).message?.kind === 'sync.request')).toBe(false)
    // 宿主直驱恢复的 doc.resync 推送：暂停解除、选择条移除、实例装载权威
    // 全文（旧输入不重放）
    s.replyResync()
    expect(s.manager.probe()[0]!.liveSuspended).toBe(false)
    expect(s.manager.probe()[0]!.conflictChoice).toBe('none')
    expect(view.state.doc.toString()).toBe(B_TEXT)
    s.controller.dispose()
  })

  it('结果失败：选择现场保留 + 就地失败提示，可重试；不出站 sync.request', () => {
    const s = setupController()
    s.enterLive()
    s.suspendPort()
    s.btn('compare')!.click()
    s.replyCompare(false)
    expect(s.manager.probe()[0]!.liveSuspended).toBe(true)
    expect(s.manager.probe()[0]!.conflictChoice).toBe('open')
    expect(s.manager.probe()[0]!.conflictComparePending).toBe(false)
    const notice = s.stateEl().querySelector('.vsidian-embed-card-conflict-notice')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain('对比')
    expect(s.sent.some((m) => m.kind === 'refEdit.message' &&
      (m as { message?: { kind?: string } }).message?.kind === 'sync.request')).toBe(false)
    // 重试可再出站（pending 已清）
    s.btn('compare')!.click()
    expect(s.sent.filter((m) => m.kind === 'refEdit.conflictCompare')).toHaveLength(2)
    s.controller.dispose()
  })
})

describe('P2-12 取消与重新选择', () => {
  it('取消收起选择（保持暂停与当前输入）；重新选择入口再展开', () => {
    const s = setupController()
    s.enterLive()
    s.suspendPort()
    const view = s.embedView()!
    view.dispatch({ changes: { from: view.state.doc.length, insert: '未提交输入' } })
    s.btn('cancel')!.click()
    expect(s.manager.probe()[0]!.conflictChoice).toBe('collapsed')
    expect(s.manager.probe()[0]!.liveSuspended).toBe(true)
    // 输入保持（取消不替换本地输入）
    expect(view.state.doc.toString()).toBe(`${B_TEXT}未提交输入`)
    // 三项收起，重新选择入口在场
    expect(s.btn('compare')).toBeNull()
    expect(s.btn('discard')).toBeNull()
    expect(s.btn('cancel')).toBeNull()
    const reopen = s.stateEl().querySelector<HTMLButtonElement>('.vsidian-embed-card-conflict-reopen')
    expect(reopen).not.toBeNull()
    reopen!.click()
    expect(s.manager.probe()[0]!.conflictChoice).toBe('open')
    expect(s.btn('compare')).not.toBeNull()
    s.controller.dispose()
  })
})

describe('P2-12 键位/命令面板入口（P2-10 登记操作接真实执行）', () => {
  it('ui.command conflictCompare 在焦点嵌入暂停时执行出站；无焦点零操作', () => {
    const s = setupController()
    s.enterLive()
    // 无焦点（焦点不在嵌入编辑器内）：零操作
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictCompare' })
    expect(s.sent.some((m) => m.kind === 'refEdit.conflictCompare')).toBe(false)
    // 焦点进嵌入 + 暂停 → 执行
    s.controller.handleHostMessage({ kind: 'embed.test.focus', inner: '目标笔记' })
    s.suspendPort()
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictCompare' })
    expect(s.sent.filter((m) => m.kind === 'refEdit.conflictCompare')).toHaveLength(1)
    s.controller.dispose()
  })

  it('ui.command conflictCancel 收起焦点暂停嵌入的选择', () => {
    const s = setupController()
    s.enterLive()
    s.controller.handleHostMessage({ kind: 'embed.test.focus', inner: '目标笔记' })
    s.suspendPort()
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictCancel' })
    expect(s.manager.probe()[0]!.conflictChoice).toBe('collapsed')
    s.controller.dispose()
  })

  it('暂停外（正常编辑态）conflict 三项均为零操作', () => {
    const s = setupController()
    s.enterLive()
    s.controller.handleHostMessage({ kind: 'embed.test.focus', inner: '目标笔记' })
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictCompare' })
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictCancel' })
    s.controller.handleHostMessage({ kind: 'ui.command', op: 'conflictDiscard' })
    expect(s.sent.filter((m) => m.kind === 'refEdit.conflictCompare')).toHaveLength(0)
    expect(s.sent.some((m) => m.kind === 'refEdit.message' &&
      (m as { message?: { kind?: string } }).message?.kind === 'sync.request')).toBe(false)
    expect(s.manager.probe()[0]!.conflictChoice).toBe('none')
    s.controller.dispose()
  })
})
