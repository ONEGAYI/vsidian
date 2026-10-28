// T08（#659）引用实例 Callout 折叠的 Live↔Reading 模式往返契约（模块级
// jsdom 直驱 EmbedCardManager）：实例会话内的折叠选择随模式往返保持——
// Reading 手动展开 → 切 Live（StateField 灌入同一 overrides）→ Live 内
// 翻转（视图态零写回）→ 切回 Reading（teardown 导出回实例 + 重装饰）。
// 折叠状态源：RefContentInstance.calloutFoldOverrides（实例持有）；Live
// 在场时经 calloutFoldField 承载（calloutFold.ts 单一状态机）。真实键盘
// 输入与浮层观感在 test/browser。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { calloutFoldField, calloutFoldSet } from '../../src/webview/calloutFold'
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
const TARGET_TEXT = [
  '# 目标笔记',
  '',
  '> [!note]- 默认收起',
  '> 隐藏正文段。',
  '',
].join('\n')

function harness(): { manager: EmbedCardManager; sent: WebviewToHost[] } {
  const sent: WebviewToHost[] = []
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => 'reading',
  }
  return { manager: new EmbedCardManager(context), sent }
}

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

function resultOk(req: { reqId: number; instanceId: string }, text = TARGET_TEXT): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: B_FS, relPath: '目标笔记.md' },
    version: 2, text, range: { start: 0, end: text.length },
    scope: { kind: 'full' }, depth: 1, expansionPath: [],
    sourceLeaseId: 'panel-1:source-1',
  }
}

function bindReqIdOf(sent: WebviewToHost[]): number {
  const req = [...sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req.reqId
}

function bindPort(h: { manager: EmbedCardManager; sent: WebviewToHost[] }, portId = 'panel-9'): string {
  h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h.sent), ok: true, portId, fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false })
  h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: 2, text: TARGET_TEXT } })
  return portId
}

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

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('T08 引用实例 callout 折叠的模式往返', () => {
  it('Reading 手动展开 → 切 Live：StateField 灌入同一 overrides（is-collapsed 不复活）', () => {
    const h = harness()
    const el = mountEmbedBlock(h.manager, '![[目标笔记]]\n')
    h.manager.notifyResult(resultOk(hoverRequestOf(h.sent)))
    // Reading：`-` 默认收起 → 点击箭头手动展开
    const readingNote = cardOf(el).querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    expect(readingNote.classList.contains('is-collapsed')).toBe(true)
    ;(readingNote.querySelector('.callout-fold') as HTMLElement).click()
    expect(readingNote.classList.contains('is-collapsed')).toBe(false)
    // 切 Live（clickModeButton 触发 bind → bound + init 创建实例并灌入）
    clickModeButton(el)
    bindPort(h)
    const view = h.manager['active'].values().next().value!.entry.live!.instance!.getView()!
    const overrides = view.state.field(calloutFoldField, false)!
    const key = Number(readingNote.getAttribute('data-vsidian-src-start'))
    expect(overrides.get(key)).toMatchObject({ folded: false, declFold: '-' })
  })

  it('Live 内翻转 → 切回 Reading：导出回实例，重装饰反映 Live 翻转结果', () => {
    const h = harness()
    const el = mountEmbedBlock(h.manager, '![[目标笔记]]\n')
    h.manager.notifyResult(resultOk(hoverRequestOf(h.sent)))
    const readingNote = cardOf(el).querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    ;(readingNote.querySelector('.callout-fold') as HTMLElement).click() // 手动展开
    clickModeButton(el) // → Live（触发 bind）
    bindPort(h)
    const live = h.manager['active'].values().next().value!.entry.live!
    const view = live.instance!.getView()!
    const key = Number(readingNote.getAttribute('data-vsidian-src-start'))
    // Live 内再收起（effect 直驱——视图态零写回）
    const before = view.state.field(calloutFoldField, false)!
    const next = new Map(before)
    next.set(key, { folded: true, declFold: '-' })
    view.dispatch({ effects: calloutFoldSet.of(next) })
    // 切回 Reading：teardown 导出 → 重装饰为收起
    clickModeButton(el)
    const noteAfter = cardOf(el).querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    expect(noteAfter.classList.contains('is-collapsed')).toBe(true)
  })
})
