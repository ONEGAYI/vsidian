// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
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
  c.handleHostMessage({ kind: 'settings.snapshot', values })
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
function choose(value: string, remember = false) {
  const checkbox = document.querySelector<HTMLInputElement>('[data-paste-remember]')!
  checkbox.checked = remember
  document.querySelector<HTMLButtonElement>(`[data-paste-choice="${value}"]`)!.click()
}
function ack(sent: WebviewToHost[], ok = true) {
  const edit = [...sent].reverse().find((m) => m.kind === 'edit.request')!
  if (edit.kind !== 'edit.request') throw new Error('缺少编辑请求')
  c.handleHostMessage(ok ? { kind: 'edit.ack', seq: edit.seq, ok: true, version: 2 } : { kind: 'edit.ack', seq: edit.seq, ok: false, reason: 'error', version: 1 })
}
describe('富文本粘贴交互', () => {
  it('默认模态先询问，保留格式为一笔编辑；宿主确认前无成功提示', async () => {
    const { view, sent, app } = mount()
    expect(paste(view, '<b>新内容</b>', '新内容').defaultPrevented).toBe(true)
    expect(app.querySelector('[role="dialog"]')).toBeTruthy()
    expect(view.state.doc.toString()).toBe('旧内容')
    choose('keep'); await settle()
    expect(view.state.doc.toString()).toBe('**新内容**')
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    ack(sent)
    expect(app.querySelector('.vsidian-toast')?.textContent).toBe('已保留粘贴内容中的格式')
  })
  it('纯文本选择、取消/勾选与Esc不制造伪历史，记忆只写两偏好', async () => {
    const { view, sent, app } = mount()
    paste(view, '<b>新</b>', '新'); choose('cancel', true); await settle()
    expect(view.state.doc.toString()).toBe('旧内容')
    expect(sent.some((m) => m.kind === 'edit.request' || m.kind === 'paste.preferences.set')).toBe(false)
    paste(view, '<b>新</b>', '新'); choose('plain', true); await settle()
    expect(view.state.doc.toString()).toBe('新')
    expect(sent.find((m) => m.kind === 'paste.preferences.set')).toMatchObject({ preserveFormatting: false })
    expect(app.querySelector('.vsidian-toast')).toBeNull()
  })
  it('普通包装、颜色字号、星号转义不单独触发询问', async () => {
    const { view, app } = mount()
    paste(view, '<p><span style="color:red">*原始Markdown*</span></p>', '*原始Markdown*'); await settle()
    expect(view.state.doc.toString()).toBe('*原始Markdown*')
    expect(app.querySelector('[role="dialog"]')).toBeNull()
  })
  it('关闭总开关直接纯文本，代码/表格上下文不转换', async () => {
    const { view, app } = mount('```js\ncode\n```', { 'editor.pasteAskBefore': false })
    view.dispatch({ selection: { anchor: 6, head: 10 } })
    paste(view, '<b>text</b>', 'text'); await settle()
    expect(view.state.doc.toString()).toBe('```js\ntext\n```')
    expect(app.querySelector('[role="dialog"]')).toBeNull()
  })
  it('转换失败安全回退，error提示等到实际编辑确认；写失败不报成功', async () => {
    vi.spyOn(conversion, 'htmlToMarkdown').mockImplementation(() => { throw new Error('failed') })
    const { view, sent, app } = mount()
    paste(view, '<b>文本</b>', '文本'); await settle()
    expect(view.state.doc.toString()).toBe('文本')
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    ack(sent)
    expect(app.querySelector<HTMLElement>('.vsidian-toast')?.dataset['severity']).toBe('error')
    expect(app.querySelector('.vsidian-toast')?.textContent).toContain('已粘贴为纯文本')
  })
  it('模态期间切模式使目标失效；多选区保留格式不丢内容', async () => {
    const { view, app } = mount('aa bb')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]) })
    paste(view, '<b>X</b>', 'X'); choose('keep'); await settle()
    expect(view.state.doc.toString()).toBe('**X** **X**')
    paste(view, '<b>Y</b>', 'Y')
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }); await settle()
    expect(app.querySelector('[role="dialog"]')).toBeNull()
    expect(view.state.doc.toString()).toBe('**X** **X**')
  })
  it('格式编辑写回失败不显示成功，关闭总开关原样粘贴且不询问', async () => {
    const { view, sent, app } = mount('旧内容', { 'editor.pasteAskBefore': false })
    paste(view, '<b>新</b>', '新'); await settle()
    ack(sent, false)
    expect(app.querySelector('.vsidian-toast')).toBeNull()
    c.dispose(); document.body.replaceChildren()
    const next = mount('旧内容', { 'editor.pastePreserveFormatting': false })
    paste(next.view, '<b>纯文本</b>', '纯文本'); await settle()
    expect(next.view.state.doc.toString()).toBe('纯文本')
    expect(next.app.querySelector('[role="dialog"]')).toBeNull()
  })
  it('转换失败且没有可用文本，只显示error，不修改文档和历史', async () => {
    vi.spyOn(conversion, 'htmlToMarkdown').mockImplementation(() => { throw new Error('failed') })
    const { view, sent, app } = mount()
    paste(view, '<script>bad()</script>'); await settle()
    expect(view.state.doc.toString()).toBe('旧内容')
    expect(sent.some((m) => m.kind === 'edit.request')).toBe(false)
    expect(app.querySelector<HTMLElement>('.vsidian-toast')?.dataset['severity']).toBe('error')
  })
})
