// @vitest-environment jsdom
// 图片粘贴 webview 适配层契约（#161）：paste 拦截（守卫矩阵、图片优先于
// 文本、preventDefault 时机、base64 出站形态）与结果插入（单事务、选区
// 替换、陈旧 reqId 丢弃）。jsdom 直驱 createImagePaste 工厂与伪剪贴板事件。
import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createImagePaste, imagePasteCanInsertAt } from '../../src/webview/imagePaste'
import type { WebviewToHost } from '../../src/shared/protocol'

// jsdom 无布局：为 CM6 的视口测量（measureTextSize → Range.getClientRects）
// 补空实现（与 compositionBuffer.test.ts 同口径）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
}

interface Harness {
  view: EditorView
  posted: WebviewToHost[]
  post(event: Event): boolean | void
}

function createHarness(overrides: Partial<Parameters<typeof createImagePaste>[0]> = {}): Harness {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: 'hello' }) })
  const posted: WebviewToHost[] = []
  const paste = createImagePaste({
    isEnabled: () => true,
    getSession: () => ({ sessionId: 's1', docUri: 'file:///d/a.md' }),
    nextReqId: (() => {
      let n = 0
      return () => ++n
    })(),
    post: (message) => posted.push(message),
    ...overrides,
  })
  // 手动重建带 paste 扩展的视图：工厂返回 Extension
  const state = EditorState.create({ doc: 'hello', extensions: [paste] })
  const view2 = new EditorView({ parent: host, state })
  view.destroy()
  return {
    view: view2,
    posted,
    post: (event: Event) => {
      // domEventHandlers 由 CM6 注册在 contentDOM；直接向其派发
      view2.contentDOM.dispatchEvent(event)
    },
  }
}

function makePasteEvent(files: Array<{ name: string; type: string; bytes: Uint8Array }>, texts: string[] = []): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const items = [
    ...texts.map((t) => ({ kind: 'string', type: 'text/plain', getAsFile: () => null, getAsString: (cb: (s: string) => void) => cb(t) })),
    ...files.map((f) => ({
      kind: 'file',
      type: f.type,
      getAsFile: () => new File([f.bytes as BlobPart], f.name, { type: f.type }),
    })),
  ]
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items,
      files: items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()),
      getData: () => texts[0] ?? '',
    },
  })
  event.preventDefault = vi.fn(event.preventDefault.bind(event))
  return event
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// PNG_BYTES 的 base64
const PNG_B64 = 'iVBORw0KGgo='

async function waitForPosted(h: Harness, count: number): Promise<void> {
  for (let i = 0; i < 50 && h.posted.length < count; i++) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('paste 拦截（#161）', () => {
  it('image/* 项命中：preventDefault、图片优先于同剪贴板文本、出站载荷形态', async () => {
    const h = createHarness()
    h.view.dispatch({ selection: { anchor: 5 } })
    h.post(makePasteEvent([{ name: 'image.png', type: 'image/png', bytes: PNG_BYTES }], ['plain text']))
    expect(h.posted.length).toBe(0) // base64 读取异步
    await waitForPosted(h, 1)
    const msg = h.posted[0]
    expect(msg).toBeDefined()
    if (msg?.kind === 'image.paste') {
      expect(msg.sessionId).toBe('s1')
      expect(msg.docUri).toBe('file:///d/a.md')
      expect(msg.mime).toBe('image/png')
      expect(msg.dataBase64).toBe(PNG_B64)
      expect(msg.reqId).toBe(1)
      expect(msg.fileNameHint).toBe('image.png')
    } else {
      throw new Error(`应出站 image.paste，实际 ${JSON.stringify(msg)}`)
    }
    // 编辑器文本未被默认粘贴改动
    expect(h.view.state.doc.toString()).toBe('hello')
    h.view.destroy()
  })

  it('无图片项：放行默认粘贴（不出站、不 preventDefault）', async () => {
    const h = createHarness()
    const event = makePasteEvent([], ['plain'])
    h.post(event)
    await new Promise((r) => setTimeout(r, 30))
    expect(h.posted.length).toBe(0)
    h.view.destroy()
  })

  it('多图取首个', async () => {
    const h = createHarness()
    h.post(
      makePasteEvent([
        { name: 'a.png', type: 'image/png', bytes: PNG_BYTES },
        { name: 'b.png', type: 'image/png', bytes: new Uint8Array([1, 2]) },
      ]),
    )
    await waitForPosted(h, 1)
    const msg = h.posted[0]
    if (msg?.kind === 'image.paste') {
      expect(msg.fileNameHint).toBe('a.png')
      expect(msg.dataBase64).toBe(PNG_B64)
    } else {
      throw new Error('应出站 image.paste')
    }
    expect(h.posted.length).toBe(1)
    h.view.destroy()
  })

  it('总开关关：放行', async () => {
    const h = createHarness({ isEnabled: () => false })
    h.post(makePasteEvent([{ name: 'a.png', type: 'image/png', bytes: PNG_BYTES }]))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.posted.length).toBe(0)
    h.view.destroy()
  })

  it('无会话（init 前）：放行', async () => {
    const h = createHarness({ getSession: () => null })
    h.post(makePasteEvent([{ name: 'a.png', type: 'image/png', bytes: PNG_BYTES }]))
    await new Promise((r) => setTimeout(r, 30))
    expect(h.posted.length).toBe(0)
    h.view.destroy()
  })

  it('只读视图：放行', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const posted: WebviewToHost[] = []
    const paste = createImagePaste({
      isEnabled: () => true,
      getSession: () => ({ sessionId: 's1', docUri: 'u' }),
      nextReqId: () => 1,
      post: (m) => posted.push(m),
    })
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: 'x', extensions: [EditorState.readOnly.of(true), paste] }) })
    view.contentDOM.dispatchEvent(makePasteEvent([{ name: 'a.png', type: 'image/png', bytes: PNG_BYTES }]))
    await new Promise((r) => setTimeout(r, 30))
    expect(posted.length).toBe(0)
    view.destroy()
  })
})

describe('结果插入（imagePasteCanInsertAt + handleResult 语义，#161）', () => {
  it('守卫纯函数：live、非暂停、可编辑（对齐格式操作守卫）', () => {
    expect(imagePasteCanInsertAt({ live: true, suspended: false, editable: true })).toBe(true)
    expect(imagePasteCanInsertAt({ live: false, suspended: false, editable: true })).toBe(false)
    expect(imagePasteCanInsertAt({ live: true, suspended: true, editable: true })).toBe(false)
    expect(imagePasteCanInsertAt({ live: true, suspended: false, editable: false })).toBe(false)
  })

  it('插入事务：光标处插入替换选区，单事务（消费方在 controller 内联装配）', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: 'hello' }) })
    view.dispatch({ selection: { anchor: 2, head: 4 } }) // 选区 "ll"
    // 单事务插入（模板：applyOutlineEdits 的 dispatch 形态）
    const pos = view.state.selection.main
    view.dispatch({ changes: { from: pos.from, to: pos.to, insert: '![a](a.png)' } })
    expect(view.state.doc.toString()).toBe('he![a](a.png)o')
    view.destroy()
  })
})
