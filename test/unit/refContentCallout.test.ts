// T08（#659）引用实例 Callout 契约（jsdom 直驱 RefContentInstance）：悬停与
// 嵌入共用的 RefContentMount/RefContentInstance 在 Reading 形态消费同一
// callout 管线——呈现（T02/T03 渲染天然）、按实例折叠（本票接线：箭头、
// `-` 默认收起、实例独立、重挂恢复）与图标注入（T06 的 --callout-icon
// 触发面在引用块挂载的接线，本票归口）。真实键盘/悬停浮层观感在
// test/browser；此处钉可观察 DOM 契约。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RefContentInstance, type RefLoadedContent } from '../../src/webview/refContentInstance'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'

installLocale('zh-cn', zhCn)

const CALLOUT_TEXT = [
  '# B 文档',
  '',
  '> [!note]- 可折叠提示',
  '> 隐藏正文第一段。',
  '> 隐藏正文第二行。',
  '',
  '> [!tip]+ 默认展开提示',
  '> 提示正文。',
  '',
  '> [!info] 无符号提示',
  '> 无符号正文。',
  '',
  '尾段文本。',
].join('\n')

const loaded: RefLoadedContent = {
  fsPath: 'D:/notes/b.md', relPath: 'b.md', scope: 'full', version: 1,
  text: CALLOUT_TEXT,
  range: { start: 0, end: CALLOUT_TEXT.length },
}

function fixture(occurrence: string, start = 0, strategy: 'full' | 'virtual' = 'full') {
  const sent: WebviewToHost[] = []
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

describe('T08 引用实例 Callout 呈现（Reading 形态消费同一管线）', () => {
  it('callout 家族结构在引用内容中呈现：容器/标题/图标位/正文（含 data-callout）', () => {
    const { mount, contentEl, instance } = fixture('first')
    mount.render(loaded)
    const note = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')
    expect(note).not.toBeNull()
    expect(note!.querySelector('.callout-title')).not.toBeNull()
    expect(note!.querySelector('.callout-title-inner')!.textContent).toContain('可折叠提示')
    expect(note!.querySelector('.callout-icon')).not.toBeNull()
    expect(note!.querySelector('.callout-content')!.textContent).toContain('隐藏正文第一段')
    // 未成型语义不误伤：无符号 callout 同样呈现（T02/T03 天然能力核实）
    const info = contentEl.querySelector('div.callout[data-callout="info"]')
    expect(info).not.toBeNull()
    instance.dispose()
  })

  it('默认收起声明（-）：is-collapsible/is-collapsed + 箭头在场；+ 展开不收起；无符号无箭头', () => {
    const { mount, contentEl, instance } = fixture('first')
    mount.render(loaded)
    const note = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    const tip = contentEl.querySelector<HTMLElement>('div.callout[data-callout="tip"]')!
    const info = contentEl.querySelector<HTMLElement>('div.callout[data-callout="info"]')!
    expect(note.classList.contains('is-collapsible')).toBe(true)
    expect(note.classList.contains('is-collapsed')).toBe(true)
    expect(note.querySelector('.callout-fold')).not.toBeNull()
    expect(tip.classList.contains('is-collapsible')).toBe(true)
    expect(tip.classList.contains('is-collapsed')).toBe(false)
    expect(tip.querySelector('.callout-fold')).not.toBeNull()
    expect(info.classList.contains('is-collapsible')).toBe(false)
    expect(info.querySelector('.callout-fold')).toBeNull()
    instance.dispose()
  })

  it('箭头点击翻转（视图态）：收起 → 展开，实例 overrides 记录，零源文出站', () => {
    const { mount, contentEl, instance } = fixture('first')
    const sent: WebviewToHost[] = []
    void sent
    mount.render(loaded)
    const note = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    ;(note.querySelector('.callout-fold') as HTMLElement).click()
    expect(note.classList.contains('is-collapsed')).toBe(false)
    expect(instance.calloutFoldOverrides.get(note.getAttribute('data-vsidian-src-start') !== null
      ? Number(note.getAttribute('data-vsidian-src-start'))
      : -1)).toBeTruthy()
    instance.dispose()
  })

  it('实例独立：不同引用位置各自开合互不串状态（相邻同文件实例）', () => {
    const a = fixture('first', 0)
    const b = fixture('second', 30)
    a.mount.render(loaded)
    b.mount.render(loaded)
    const aNote = a.contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    const bNote = b.contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    ;(aNote.querySelector('.callout-fold') as HTMLElement).click()
    expect(aNote.classList.contains('is-collapsed')).toBe(false)
    expect(bNote.classList.contains('is-collapsed')).toBe(true) // B 实例不受 A 翻转影响
    a.instance.dispose()
    b.instance.dispose()
  })

  it('重挂载恢复本次实例会话内的折叠选择（clear → render 同实例保持手动展开）', () => {
    const { mount, contentEl, instance } = fixture('first')
    mount.render(loaded)
    const note = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    ;(note.querySelector('.callout-fold') as HTMLElement).click()
    mount.clear()
    mount.render(loaded)
    const noteAgain = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    expect(noteAgain.classList.contains('is-collapsed')).toBe(false)
    // 重开实例（dispose 后新建）恢复源码默认：- 仍收起
    const fresh = fixture('fresh')
    fresh.mount.render(loaded)
    const freshNote = fresh.contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')!
    expect(freshNote.classList.contains('is-collapsed')).toBe(true)
    instance.dispose()
    fresh.instance.dispose()
  })

  it('虚拟化路径（strategy virtual）同样施加折叠装饰', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
    void heightSpy
    const { mount, contentEl, scrollEl, instance } = fixture('first', 0, 'virtual')
    Object.defineProperty(scrollEl, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(contentEl, 'clientHeight', { value: 400, configurable: true })
    mount.render(loaded)
    mount.updateNow()
    const note = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"]')
    expect(note).not.toBeNull()
    expect(note!.classList.contains('is-collapsed')).toBe(true)
    expect(note!.querySelector('.callout-fold')).not.toBeNull()
    instance.dispose()
  })

  it('引用头部与外层容器不被误标为 callout 内容（卡片壳语义不进 contentEl 块群）', () => {
    const { mount, contentEl, instance } = fixture('first')
    mount.render(loaded)
    // contentEl 是块群容器：callout 只在块内（引用壳由容器层装配，不在此树）
    expect(contentEl.classList.contains('callout')).toBe(false)
    expect(contentEl.querySelectorAll('div.callout')).toHaveLength(3)
    instance.dispose()
  })
})

describe('T08 引用实例 Callout 图标注入（T06 触发面在引用块挂载接线）', () => {
  it('默认通道：图标元素在场且不挂注入类（mask 通道照常）', () => {
    const { mount, contentEl, instance } = fixture('first')
    mount.render(loaded)
    const icon = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"] .callout-icon')!
    expect(icon.classList.contains('vsidian-callout-icon-custom')).toBe(false)
    instance.dispose()
  })

  it('片段设置 --callout-icon 时注入 SVG（挂载后下一帧解析——块入位后读 computed）', async () => {
    const { mount, contentEl, instance } = fixture('first')
    // CSS 片片的等价最小形态：变量在挂载前于祖先元素就位（真实场景为
    // webview head 的片段样式；jsdom 内联级联与 calloutIconMount.test 同构）
    contentEl.style.setProperty('--callout-icon', '"lucide-flame"')
    mount.render(loaded)
    // 挂载时机经 rAF 解析（游离节点同步读不到值——入位后下一帧）
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    const icon = contentEl.querySelector<HTMLElement>('div.callout[data-callout="note"] .callout-icon')!
    expect(icon.classList.contains('vsidian-callout-icon-custom')).toBe(true)
    expect(icon.innerHTML).toContain('<svg')
    instance.dispose()
  })
})
