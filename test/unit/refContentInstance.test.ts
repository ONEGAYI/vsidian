// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { RefContentInstance, getRefReadingBlockCacheStats, type RefLoadedContent } from '../../src/webview/refContentInstance'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'
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

it('重挂恢复后用户开始滚动，待执行的恢复帧不得拉回旧位置', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let seq = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.set(++seq, cb)
    return seq
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const a = fixture('restore-interrupt', 0, [], 'virtual')
  a.mount.render(loaded)
  a.instance.scrollTop = 100
  a.mount.restoreScroll(true)
  const first = frames.entries().next().value!
  frames.delete(first[0])
  first[1](0)
  expect(a.scrollEl.scrollTop).toBe(100)
  a.scrollEl.scrollTop = 240
  a.scrollEl.dispatchEvent(new Event('scroll'))
  let rounds = 0
  while (frames.size > 0 && rounds++ < 10) {
    const next = frames.entries().next().value!
    frames.delete(next[0])
    next[1](0)
  }
  expect(a.scrollEl.scrollTop).toBe(240)
  a.instance.dispose()
})

it('恢复帧执行前已有外层滚动，取消恢复并保存新的 occurrence 位置', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let seq = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { frames.set(++seq, cb); return seq })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const a = fixture('restore-before-frame', 0, [], 'virtual')
  a.mount.render(loaded)
  a.instance.scrollTop = 100
  a.mount.restoreScroll(true)
  a.scrollEl.scrollTop = 240
  a.scrollEl.dispatchEvent(new Event('scroll'))
  for (const [id, cb] of [...frames]) { frames.delete(id); cb(0) }
  expect(a.scrollEl.scrollTop).toBe(240)
  expect(a.instance.scrollTop).toBe(240)
  a.instance.dispose()
})

it('恢复帧前用户用滚轮回到顶部，零位也是新阅读意图', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let seq = 0
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { frames.set(++seq, cb); return seq })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  const a = fixture('restore-to-zero', 0, [], 'virtual')
  a.mount.render(loaded)
  a.instance.scrollTop = 100
  a.mount.restoreScroll(true)
  a.scrollEl.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 }))
  a.scrollEl.scrollTop = 0
  a.scrollEl.dispatchEvent(new Event('scroll'))
  for (const [id, cb] of [...frames]) { frames.delete(id); cb(0) }
  expect(a.scrollEl.scrollTop).toBe(0)
  expect(a.instance.scrollTop).toBe(0)
  a.instance.dispose()
})

it('长引用使用外层滚动区：首屏有界，滚到中段回收旧块，恢复位置后窗口同步', () => {
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  const a = fixture('long', 0, [], 'virtual')
  Object.defineProperty(a.scrollEl, 'clientHeight', { value: 400 })
  Object.defineProperty(a.contentEl, 'clientHeight', { value: 0 })
  const text = Array.from({ length: 1000 }, (_, i) => `段落 ${i}`).join('\n\n')
  const target = { ...loaded, text, range: { start: 0, end: text.length } }
  a.mount.render(target)
  expect(a.mount.getStats()?.virtualized).toBe(true)
  expect(a.mount.getStats()!.mountedBlocks).toBeLessThan(100)
  expect(a.contentEl.textContent).toContain('段落 0')
  a.scrollEl.scrollTop = 500 * 36
  a.scrollEl.dispatchEvent(new Event('scroll'))
  a.mount.updateNow()
  expect(a.contentEl.textContent).toContain('段落 500')
  expect(a.contentEl.textContent).not.toContain('段落 0\n')
  expect(a.mount.getStats()?.parseCount).toBe(1)
  a.instance.scrollTop = a.scrollEl.scrollTop
  a.mount.render(target)
  a.mount.restoreScroll(false)
  expect(a.contentEl.textContent).toContain('段落 500')
  a.instance.dispose()
  heightSpy.mockRestore()
})

it('同一目标重复引用共用全文块解析，但两个滚动窗口独立', () => {
  const before = getRefReadingBlockCacheStats()
  const first = fixture('cache-first', 0, [], 'virtual')
  const second = fixture('cache-second', 20, [], 'virtual')
  for (const { scrollEl } of [first, second]) Object.defineProperty(scrollEl, 'clientHeight', { value: 400 })
  const text = Array.from({ length: 1000 }, (_, i) => `共享段落 ${i}`).join('\n\n')
  const target = { ...loaded, fsPath: 'D:/notes/shared-243.md', text, range: { start: 0, end: text.length } }
  first.mount.render(target)
  second.mount.render(target)
  const after = getRefReadingBlockCacheStats()
  expect(after.parses - before.parses).toBe(1)
  expect(after.hits - before.hits).toBe(1)
  first.scrollEl.scrollTop = 500 * 36
  first.mount.updateNow()
  expect(first.contentEl.textContent).toContain('共享段落 500')
  expect(second.contentEl.textContent).toContain('共享段落 0')
  first.instance.dispose()
  expect(second.mount.getStats()!.mountedBlocks).toBeGreaterThan(0)
  second.instance.dispose()
})

it('滚动窗口回收图片槽位，迟到结果无效，回首屏重新请求', () => {
  const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  try {
    const sent: WebviewToHost[] = []
    const a = fixture('image-window', 0, sent, 'virtual')
    Object.defineProperty(a.scrollEl, 'clientHeight', { value: 400 })
    const text = ['![图](asset.png)', '', ...Array.from({ length: 500 }, (_, i) => `段落 ${i}\n`)].join('\n')
    a.mount.render({ ...loaded, fsPath: 'D:/notes/image-window-243.md', text,
      range: { start: 0, end: text.length } })
    const image = a.contentEl.querySelector<HTMLImageElement>('img')!
    const firstReq = sent.find((m) => m.kind === 'image.request')!
    expect(firstReq).toBeDefined()
    a.scrollEl.scrollTop = 400 * 36
    a.mount.updateNow()
    expect(a.contentEl.contains(image)).toBe(false)
    expect(image.dataset['vsidianImgState']).toBeUndefined()
    a.mount.notifyImageResult({ reqId: firstReq.reqId, ok: true, src: 'late.png' })
    expect(image.getAttribute('src')).toBeNull()
    a.scrollEl.scrollTop = 0
    a.mount.updateNow()
    const requests = sent.filter((m) => m.kind === 'image.request')
    expect(requests).toHaveLength(2)
    expect(requests[1]!.reqId).not.toBe(firstReq.reqId)
    a.instance.dispose()
  } finally {
    heightSpy.mockRestore()
  }
})

it('语言包切换后，同版本目标重新解析属性区文案', () => {
  const before = getRefReadingBlockCacheStats()
  const a = fixture('locale-zh', 0, [], 'full')
  const b = fixture('locale-en', 20, [], 'full')
  const target = { ...loaded, fsPath: 'D:/notes/locale-243.md', text: '---\ntitle: Example\n---\n\n正文', range: { start: 0, end: 38 } }
  a.mount.render(target)
  expect(a.contentEl.textContent).toContain('属性')
  installLocale('en', en)
  b.mount.render(target)
  expect(b.contentEl.textContent).toContain('Properties')
  expect(getRefReadingBlockCacheStats().parses - before.parses).toBe(2)
  a.instance.dispose()
  b.instance.dispose()
  installLocale('zh-cn', zhCn)
})

it('超大目标不进入常驻解析缓存，重复装载重新解析', () => {
  const before = getRefReadingBlockCacheStats()
  const a = fixture('oversize-a', 0, [], 'virtual')
  const b = fixture('oversize-b', 20, [], 'virtual')
  const text = 'x'.repeat(300_000)
  const target = { ...loaded, fsPath: 'D:/notes/oversize-243.md', text, range: { start: 0, end: text.length } }
  a.mount.render(target)
  b.mount.render(target)
  const after = getRefReadingBlockCacheStats()
  expect(after.parses - before.parses).toBe(2)
  expect(after.oversizeSkips - before.oversizeSkips).toBe(2)
  expect(after.bytes).toBeLessThanOrEqual(2 * 1024 * 1024)
  a.instance.dispose()
  b.instance.dispose()
})
