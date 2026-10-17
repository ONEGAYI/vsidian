// @vitest-environment jsdom
// #541 T01 附加组件粘贴规则——控制器级消费链契约测试（生产控制器接缝）。
// 钉住票面验收：
// - 宿主广播快照被缓存（addonPasteRules.snapshot）；旧版本迟到快照不
//   回退已撤回的规则代次；
// - 富文本粘贴经规则转换（双载荷：HTML 载荷命中规则、plain 载荷参与
//   等值/撤销判定）；分步撤销的两笔编辑请求携带既有 text/format 阶段；
// - 转换结果等于 plain 时走既有一次撤销路径（规则不另建历史）；
// - 纯文本粘贴（总开关关闭/代码上下文）不经过规则。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { WebviewSyncController } from '../../src/webview/syncController'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'
import * as conversion from '../../src/webview/htmlToMarkdown'

if (!Range.prototype.getClientRects) { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect() }
let c: WebviewSyncController
afterEach(() => { c?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })
function mount(text = '旧内容', values: Record<string, boolean> = {}) {
  installLocale('zh-cn', zhCn)
  const sent: WebviewToHost[] = []
  c = new WebviewSyncController({ postMessage: (m) => sent.push(m as WebviewToHost), getState: () => undefined, setState: () => {} })
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app)
  c.mount(app); c.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'file:///d/a.md', version: 1, text })
  c.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.pasteAskBefore': false, ...values } })
  const view = EditorView.findFromDOM(app.querySelector('.cm-editor')!)!
  view.focus(); view.dispatch({ selection: { anchor: 0, head: text.length } })
  return { app, view, sent }
}
function paste(view: EditorView, html: string, text?: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: [], types: text === undefined ? ['text/html'] : ['text/html', 'text/plain'], getData: (type: string) => type === 'text/html' ? html : text ?? '' } })
  view.contentDOM.dispatchEvent(event)
  return event
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
/** 应答在途编辑（宿主确认后暂缓的第二阶段才出站） */
function ack(sent: WebviewToHost[]) {
  const edit = [...sent].reverse().find((m) => m.kind === 'edit.request')
  if (edit?.kind !== 'edit.request') throw new Error('缺少编辑请求')
  c.handleHostMessage({ kind: 'edit.ack', seq: edit.seq, ok: true, version: 2 })
}

/** 来源特化形态规则（data-prompt-link-url span → Markdown 链接） */
const PROMPT_LINK_SNAPSHOT = (version: number) => ({
  version,
  rules: [{
    addonId: 'fixture.demo',
    id: 'prompt-link',
    priority: 0,
    match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
    output: {
      kind: 'template' as const,
      template: '[{{label}}]({{url}})',
      slots: {
        label: { source: { kind: 'text' as const } },
        url: { source: { kind: 'attribute' as const, name: 'data-prompt-link-url' }, url: true },
      },
    },
  }],
})

describe('粘贴规则控制器消费链', () => {
  it('命中规则的双载荷粘贴：链接恢复、分步撤销两阶段携带 text/format', async () => {
    const { view, sent } = mount()
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    expect(view.state.doc.toString()).toBe('[查看](https://e.com/a)')
    ack(sent); await settle()
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits).toHaveLength(2)
    expect(edits[0]!.paste?.stage).toBe('text')
    expect(edits[1]!.paste?.stage).toBe('format')
  })

  it('迟到旧版本快照不回退：撤回（空快照 v2）后 v1 不复活规则', async () => {
    const { view } = mount()
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: { version: 2, rules: [] } })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    // 无规则 → 内置转换：span 无格式 → 与 plain 等值 → 纯文本路径
    expect(view.state.doc.toString()).toBe('查看')
  })

  it('转换结果等于 plain 时只有一笔编辑（规则不另建历史）', async () => {
    const { view, sent } = mount()
    c.handleHostMessage({
      kind: 'addonPasteRules.snapshot',
      snapshot: {
        version: 1,
        rules: [{
          addonId: 'fixture.demo',
          id: 'plain-wrap',
          priority: 0,
          match: { tag: 'SPAN', attributes: [{ name: 'data-x' }] },
          output: { kind: 'template', template: '{{t}}', slots: { t: { source: { kind: 'text' } } } },
        }],
      },
    })
    paste(view, '<p><span data-x>纯文字</span></p>', '纯文字')
    await settle()
    expect(view.state.doc.toString()).toBe('纯文字')
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits).toHaveLength(1)
  })

  it('纯文本粘贴不经过规则：总开关关闭走纯文本链', async () => {
    const spy = vi.spyOn(conversion, 'htmlToMarkdown')
    const { view } = mount('旧内容', { 'editor.pastePreserveFormatting': false })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    expect(view.state.doc.toString()).toBe('查看')
    expect(spy).not.toHaveBeenCalled()
  })
})
