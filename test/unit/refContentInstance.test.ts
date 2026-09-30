// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { RefContentInstance, type RefLoadedContent } from '../../src/webview/refContentInstance'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)
const loaded: RefLoadedContent = {
  fsPath: 'D:/notes/b.md', relPath: 'b.md', scope: 'full', version: 1,
  text: '---\ntitle: B\n---\n\n![图片](asset.png)\n\n![[C]]\n\n- [ ] task\n',
  range: { start: 0, end: 80 },
}
function fixture(occurrence: string, start: number, sent: WebviewToHost[], strategy: 'full' | 'virtual' = 'full') {
  const instance = new RefContentInstance({
    panelDocUri: 'file:///a.md', sourceDocUri: 'file:///a.md',
    range: { start, end: start + 6 }, occurrence,
  })
  const contentEl = document.createElement('div')
  const scrollEl = document.createElement('div')
  scrollEl.appendChild(contentEl)
  document.body.appendChild(scrollEl)
  const mount = instance.mount({ contentEl, scrollEl, strategy,
    session: () => ({ sessionId: 'panel', docUri: 'file:///a.md' }),
    send: (msg) => sent.push(msg), codeHighlight: () => true,
  })
  return { instance, mount, contentEl, scrollEl }
}
afterEach(() => { document.body.textContent = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('已卸载块的属性按钮不再改变 occurrence 状态', () => {
  const a = fixture('first', 0, [])
  a.mount.render(loaded)
  const button = a.contentEl.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!
  a.mount.clear()
  button.click()
  expect(a.instance.fmExpanded).toBe(false)
  a.instance.dispose()
})

it('同目标两个引用位置共享读取结果时 UI 与图片挂载独立，释放一方不撤另一方', () => {
  const sent: WebviewToHost[] = []
  const a = fixture('first', 0, sent)
  const b = fixture('second', 30, sent)
  a.mount.render(loaded)
  b.mount.render(loaded)
  a.contentEl.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!.click()
  a.scrollEl.scrollTop = 37
  expect(a.instance.fmExpanded).toBe(true)
  expect(b.instance.fmExpanded).toBe(false)
  expect(b.scrollEl.scrollTop).toBe(0)
  const requests = sent.filter((m) => m.kind === 'image.request')
  expect(requests).toHaveLength(2)
  expect(requests.every((r) => r.sourceDocUri === 'D:/notes/b.md' && r.docUri === 'file:///a.md')).toBe(true)
  expect(sent.some((m) => m.kind === 'hover.request' || m.kind === 'edit.request')).toBe(false)
  expect(b.contentEl.querySelector('.vsidian-embed-ref')).not.toBeNull()
  expect(b.contentEl.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
  a.instance.dispose()
  expect(a.instance.mountedCount).toBe(0)
  expect(a.instance.scrollTop).toBe(37)
  expect(b.instance.mountedCount).toBe(1)
  expect(b.contentEl.textContent).toContain('task')
  b.instance.dispose()
  expect(b.instance.mountedCount).toBe(0)
})

it('已释放挂载拒绝迟到内容、图片与监听器，并配对一次实例清理', () => {
  const sent: WebviewToHost[] = []
  const a = fixture('first', 0, sent)
  let releases = 0
  a.instance.onDispose(() => { releases++ })
  a.mount.render(loaded)
  const req = sent.find((m) => m.kind === 'image.request')!
  a.instance.dispose()
  a.instance.dispose()
  a.mount.render(loaded)
  a.mount.notifyImageResult({ reqId: req.reqId, ok: true, src: 'late.png' })
  expect(a.contentEl.childElementCount).toBe(0)
  expect(a.instance.mountedCount).toBe(0)
  expect(releases).toBe(1)
})

it('虚拟内容释放同时取消已排队的测量帧，不能再写入已卸载正文', () => {
  const frames = new Map<number, FrameRequestCallback>()
  const resizeCallbacks: ResizeObserverCallback[] = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
  let seq = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.set(++seq, cb)
    return seq
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const a = fixture('hover', 0, [], 'virtual')
  Object.defineProperty(a.contentEl, 'clientHeight', { value: 400 })
  a.mount.render(loaded)
  for (const callback of resizeCallbacks) callback([], {} as ResizeObserver)
  expect(frames.size).toBeGreaterThan(0)
  a.instance.dispose()
  expect(frames.size).toBe(0)
  expect(a.contentEl.childElementCount).toBe(0)
})
