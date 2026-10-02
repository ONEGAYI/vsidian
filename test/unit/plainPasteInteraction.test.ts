// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebviewSyncController } from '../../src/webview/syncController'
import { KEYBINDING_OPERATIONS, getEffectiveBindings } from '../../src/shared/keybindings'
import type { WebviewToHost } from '../../src/shared/protocol'
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
let controller: WebviewSyncController | undefined
afterEach(() => { controller?.dispose(); document.body.replaceChildren(); vi.unstubAllGlobals() })
function mount(text = '旧文本') {
  installLocale('zh-cn', zhCn)
  const sent: WebviewToHost[] = []
  controller = new WebviewSyncController({ postMessage: (m) => sent.push(m as WebviewToHost), getState: () => undefined, setState: () => {} })
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app)
  controller.mount(app)
  controller.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'file:///d/a.md', version: 1, text })
  const view = EditorView.findFromDOM(app.querySelector('.cm-editor')!)!
  view.focus()
  return { sent, app, view, controller }
}
function clipboard(text?: string, image = false) {
  const types = [...(text === undefined ? [] : ['text/plain']), ...(image ? ['image/png'] : [])]
  vi.stubGlobal('navigator', { clipboard: { read: async () => [{ types, getType: async (type: string) => type === 'text/plain' ? new Blob([text!]) : new Blob(['image'], { type }) }] } })
}
function key(view: EditorView, value: string, shift = false) {
  const event = new KeyboardEvent('keydown', { key: value, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true })
  view.contentDOM.dispatchEvent(event)
  return event
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('纯文本粘贴纵向入口', () => {
  it('两操作统一注册，默认键可清空', () => {
    expect(KEYBINDING_OPERATIONS.find((op) => op.id === 'pastePlain')).toMatchObject({ mode: 'live', writes: true, defaults: ['ctrl+shift+v', 'meta+shift+v'] })
    expect(getEffectiveBindings({}, 'paste')).toEqual(['ctrl+v', 'meta+v'])
    expect(getEffectiveBindings({ paste: [] }, 'paste')).toEqual([])
  })
  it('Ctrl+Shift+V 图片加文字只插入文本，提示引导、不投递宿主通知或图片', async () => {
    clipboard('**原文**', true)
    const { view, app, sent } = mount()
    view.dispatch({ selection: { anchor: 0, head: 3 } })
    expect(key(view, 'V', true).defaultPrevented).toBe(true)
    await settle()
    expect(view.state.doc.toString()).toBe('**原文**')
    expect(app.querySelector('.vsidian-toast')?.getAttribute('data-severity')).toBe('warning')
    expect(sent.some((m) => m.kind === 'image.paste')).toBe(false)
  })
  it('图片无文本：无编辑；普通粘贴改绑后提示用新键位，清空则仅操作名', async () => {
    clipboard(undefined, true)
    const { view, app, sent, controller: c } = mount()
    c.handleHostMessage({ kind: 'keybindings.changed', overrides: { paste: ['ctrl+alt+v'] } })
    key(view, 'V', true); await settle()
    expect(view.state.doc.toString()).toBe('旧文本')
    expect(app.querySelector('.vsidian-toast')?.textContent).toContain('Ctrl+Alt+V')
    expect(sent.some((m) => m.kind === 'edit.request')).toBe(false)
  })
  it('读取迟到遇文档变化时丢弃，不插到新的选区', async () => {
    let resolve!: (value: never[]) => void
    vi.stubGlobal('navigator', { clipboard: { read: () => new Promise((r) => { resolve = r }) } })
    const { view } = mount()
    key(view, 'V', true)
    view.dispatch({ changes: { from: 0, insert: '修改' } })
    resolve([]); await settle()
    expect(view.state.doc.toString()).toBe('修改旧文本')
  })
  it('多选区替换使用原生粘贴语义，不只写主选区', async () => {
    clipboard('X')
    const { view } = mount('aa bb')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(3, 5)]) })
    key(view, 'V', true); await settle()
    expect(view.state.doc.toString()).toBe('X X')
  })
  it('阅读、设置输入框与清空绑定均不接管CtrlShiftV', () => {
    clipboard('文本')
    const { view, controller: c, app } = mount()
    c.handleHostMessage({ kind: 'keybindings.changed', overrides: { pastePlain: [] } })
    expect(key(view, 'V', true).defaultPrevented).toBe(false)
    c.handleHostMessage({ kind: 'keybindings.changed', overrides: {} })
    const input = document.createElement('input'); app.append(input); input.focus()
    const event = new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(key(view, 'V', true).defaultPrevented).toBe(false)
  })
  it('权限拒绝回退宿主text/plain，回包不伪报图片，重复回包不重贴', async () => {
    vi.stubGlobal('navigator', { clipboard: { read: async () => { throw new Error('denied') } } })
    const { view, sent, controller: c, app } = mount()
    key(view, 'V', true); await settle()
    const req = sent.find((m) => m.kind === 'clipboard.read')!
    if (req.kind !== 'clipboard.read') throw new Error('缺剪贴板读请求')
    const result = { kind: 'clipboard.read.result' as const, reqId: req.reqId, ok: true as const, text: '回退' }
    c.handleHostMessage(result)
    expect(view.state.doc.toString()).toBe('回退旧文本')
    c.handleHostMessage(result)
    expect(view.state.doc.toString()).toBe('回退旧文本')
    expect(app.querySelector('.vsidian-toast')).toBeNull()
  })
})
