// 悬停预览浮层生命周期契约（#218，模块级 jsdom 直驱）：开闭延迟、移入
// 保活、Esc 关闭、一次一个浮层、实例释放与迟到响应不重开、零抢焦点、
// 只读渲染（任务禁写）；#219 局部范围（scope/range 过滤）、普通链接入口
// 与锚点缺失分态。真实指针/IME/观感回归在 test/browser 与集成层。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  closeHoverPopup,
  hoverPopupProbe,
  hoverPreviewAnchorEnter,
  hoverPreviewAnchorLeave,
  isHoverPopupOpen,
  notifyHoverResult,
  setHoverPreviewContext,
  __resetHoverPopupForTest,
  HOVER_POPUP_CLOSE_DELAY_MS,
  HOVER_POPUP_OPEN_DELAY_MS,
} from '../../src/webview/hoverPopup'

// 错误分态文案断言需要已装配语言包（生产经数据岛/locale.changed 装配；
// 单测直接注入 zh-cn 字典——与浏览器套件 buildZhLocaleIsland 同源）
installLocale('zh-cn', zhCn)

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

interface Harness {
  sent: WebviewToHost[]
  anchor: HTMLAnchorElement
  block: HTMLElement
}

/** 装配：注入出站上下文 + 造一个带源锚点块的双链 a */
function makeHarness(): Harness {
  const sent: WebviewToHost[] = []
  setHoverPreviewContext({
    session: () => SESSION,
    send: (message) => {
      sent.push(message)
    },
    images: undefined,
  })
  const block = document.createElement('div')
  block.dataset['vsidianSrcStart'] = '10'
  block.dataset['vsidianSrcEnd'] = '30'
  const anchor = document.createElement('a')
  anchor.className = 'vsidian-wikilink'
  anchor.setAttribute('href', '目标笔记')
  block.appendChild(anchor)
  document.body.appendChild(block)
  return { sent, anchor, block }
}

function popupEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.vsidian-hover-popup')
}

function requestOf(h: Harness) {
  const req = h.sent.find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

const RESULT_OK = {
  target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
  version: 3,
  text: ['# 目标笔记', '', '- [ ] 任务一', '- [x] 任务二', ''].join('\n'),
  range: { start: 0, end: 40 },
  scope: { kind: 'full' as const },
}

afterEach(() => {
  __resetHoverPopupForTest()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('悬停开闭时序与请求载荷', () => {
  it('进入链接不立即开浮层；开闭延迟为正的工程初值', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    expect(isHoverPopupOpen()).toBe(false)
    expect(h.sent).toEqual([])
    expect(HOVER_POPUP_OPEN_DELAY_MS).toBeGreaterThan(0)
    expect(HOVER_POPUP_CLOSE_DELAY_MS).toBeGreaterThan(0)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(true)
    const req = requestOf(h)
    // 请求身份契约：会话守卫 + reqId 配对 + 实例标识 + 父引用区间 + 目标原文
    expect(req.sessionId).toBe(SESSION.sessionId)
    expect(req.docUri).toBe(SESSION.docUri)
    expect(req.reqId).toBeGreaterThan(0)
    expect(req.instanceId).toMatch(/^hover-/)
    expect(req.sourceStart).toBe(10)
    expect(req.sourceEnd).toBe(30)
    expect(req.target).toBe('目标笔记')
  })

  it('开前离开链接取消待开（无请求无浮层）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    hoverPreviewAnchorLeave(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS * 2)
    expect(isHoverPopupOpen()).toBe(false)
    expect(h.sent).toEqual([])
  })

  it('离开链接后延迟关闭；关闭即释放实例（迟到成功结果不得重开）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    hoverPreviewAnchorLeave(h.anchor)
    expect(isHoverPopupOpen(), '延迟窗口内仍在场').toBe(true)
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
    expect(popupEl()).toBeNull()
    // 已关闭实例的迟到响应：既不重开也不留下任何 DOM
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...RESULT_OK })
    expect(isHoverPopupOpen()).toBe(false)
    expect(popupEl()).toBeNull()
    expect(hoverPopupProbe().open).toBe(false)
  })
})

describe('保活与单例', () => {
  it('移入浮层取消延迟关闭（可停留滚动/选择）；再离开才计时关闭', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    notifyHoverResult({ kind: 'hover.result', reqId: requestOf(h).reqId, instanceId: requestOf(h).instanceId, ok: true, ...RESULT_OK })
    hoverPreviewAnchorLeave(h.anchor)
    const el = popupEl()!
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 3)
    expect(isHoverPopupOpen(), '移入保活').toBe(true)
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
  })

  it('重入同一链接（未离开浮层域的往返）不重开不重发；换链接先关旧再开新', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const reqs = h.sent.filter((m) => m.kind === 'hover.request')
    expect(reqs, '同一锚点重入不重发请求').toHaveLength(1)

    const block2 = document.createElement('div')
    block2.dataset['vsidianSrcStart'] = '40'
    block2.dataset['vsidianSrcEnd'] = '60'
    const anchor2 = document.createElement('a')
    anchor2.className = 'vsidian-wikilink'
    anchor2.setAttribute('href', '另一笔记')
    block2.appendChild(anchor2)
    document.body.appendChild(block2)
    hoverPreviewAnchorEnter(anchor2)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req2 = h.sent.filter((m) => m.kind === 'hover.request')
    expect(req2).toHaveLength(2)
    const second = req2[1] as Extract<WebviewToHost, { kind: 'hover.request' }>
    expect(second.instanceId, '新实例身份与旧实例不同').not.toBe(
      (reqs[0] as Extract<WebviewToHost, { kind: 'hover.request' }>).instanceId,
    )
    expect(document.querySelectorAll('.vsidian-hover-popup')).toHaveLength(1)
  })
})

describe('Esc 与焦点', () => {
  it('Esc 关闭浮层（捕获阶段拦截，不外溢）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const el = popupEl()!
    const before = document.activeElement
    const keydown = new KeyboardEvent('keydown', { key: 'Escape' })
    const outerSeen: string[] = []
    document.body.addEventListener('keydown', () => outerSeen.push('body'))
    el.dispatchEvent(keydown)
    expect(isHoverPopupOpen()).toBe(false)
    expect(outerSeen).toEqual([])
    // 零抢焦点：打开全程未动 activeElement
    expect(document.activeElement).toBe(before)
  })
})

describe('内容渲染与只读契约', () => {
  it('成功结果以 Reading 块渲染目标全文；任务 checkbox 禁用（无写回能力）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...RESULT_OK })
    const el = popupEl()!
    const blocks = el.querySelectorAll('.vsidian-reading-block')
    expect(blocks.length).toBeGreaterThan(0)
    expect(el.querySelector('.vsidian-reading-heading-1')?.textContent).toContain('目标笔记')
    const boxes = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes.length).toBe(2)
    expect(boxes.every((b) => b.disabled), '任务框一律禁用').toBe(true)
    const probe = hoverPopupProbe()
    expect(probe).toMatchObject({ open: true, state: 'content', scope: 'full' })
    expect(probe.blocks).toBe(blocks.length)
    expect(probe.note).toBe('目标笔记.md')
  })

  it('打开即呈 loading 就地状态；错误分态就地呈现（不弹宿主通知）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(hoverPopupProbe()).toMatchObject({ open: true, state: 'loading' })
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    const probe = hoverPopupProbe()
    expect(probe).toMatchObject({ open: true, state: 'error' })
    expect(popupEl()!.textContent).not.toBe('')
  })

  it('陈旧回包（instanceId 或 reqId 不匹配）不覆盖当前内容', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    // 旧实例的迟到成功回包：既定错误态不被翻新
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: 'hover-ghost', ok: true, ...RESULT_OK })
    expect(hoverPopupProbe().state).toBe('error')
    // 同实例但 reqId 不匹配（未来重发场景）同样丢弃
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId + 100, instanceId: req.instanceId, ok: true, ...RESULT_OK })
    expect(hoverPopupProbe().state).toBe('error')
  })
})

describe('显式释放', () => {
  it('closeHoverPopup 幂等且清空模块状态（上下文卸载路径）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    closeHoverPopup()
    closeHoverPopup()
    expect(isHoverPopupOpen()).toBe(false)
    expect(popupEl()).toBeNull()
    // 关闭后再注入结果不重开（实例已释放）
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...RESULT_OK })
    expect(isHoverPopupOpen()).toBe(false)
  })
})

// #219 局部范围与普通链接入口：双链按 scope/range 收窄渲染（切块后过滤，
// 不截字符串）、普通本地 Markdown 链接走 linkHref 形态、外部网页预滤不开
// 浮层、锚点缺失分态带锚点原文。
describe('局部范围与普通链接入口（#219）', () => {
  /** 章节目标：三段结构，章节甲内含列表多行块 */
  const SECTION_TARGET = [
    '# 目标全文标题',
    '',
    '顶部段。',
    '',
    '## 章节甲',
    '',
    '甲段一。',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '## 章节乙',
    '',
    '乙段。',
    '',
  ].join('\n')

  /** 章节甲的块表对拍范围（标题块行首 → 章节乙标题块前的最后内容块行尾） */
  function sectionRange(): { start: number; end: number } {
    const titleStart = SECTION_TARGET.indexOf('## 章节甲')
    const listEnd = SECTION_TARGET.indexOf('- 列表项二') + '- 列表项二'.length
    return { start: titleStart, end: listEnd }
  }

  it('heading scope 成功结果：只渲染章节内块（切块后按 range 过滤，非截字符串）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: true,
      target: { fsPath: 'D:\notes\目标笔记.md', relPath: '目标笔记.md' },
      version: 2,
      text: SECTION_TARGET,
      range: sectionRange(),
      scope: { kind: 'heading', anchor: '章节甲' },
    })
    const el = popupEl()!
    const text = el.textContent ?? ''
    expect(text).toContain('章节甲')
    expect(text).toContain('列表项二')
    expect(text, '章节外的顶部段不得出现').not.toContain('顶部段')
    expect(text, '下一章节不得出现').not.toContain('乙段')
    expect(text, '多行列表块整取（不截首行）').toContain('列表项一')
    const probe = hoverPopupProbe()
    expect(probe.scope).toBe('heading')
    expect(probe.blocks, '只渲染章节内块').toBeLessThan(
      el ? SECTION_TARGET.split('\n').filter((l) => l.trim() !== '').length : Infinity,
    )
  })

  it('block scope 成功结果：探针记录 block 且范围生效', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    const blockStart = SECTION_TARGET.indexOf('- 列表项一')
    // 块首行为引导段（列表上方紧贴的段落属同一块——宿主 blockRangeOfLine
    // 语义；此处直接用块表区间口径构造）
    const headStart = SECTION_TARGET.indexOf('甲段一。')
    notifyHoverResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: true,
      target: { fsPath: 'D:\notes\目标笔记.md', relPath: '目标笔记.md' },
      version: 2,
      text: SECTION_TARGET,
      range: { start: headStart, end: SECTION_TARGET.indexOf('- 列表项二') + '- 列表项二'.length },
      scope: { kind: 'block', anchor: '^blk1' },
    })
    const text = popupEl()!.textContent ?? ''
    expect(text).toContain('列表项一')
    expect(text, '块外内容不得出现').not.toContain('顶部段')
    expect(hoverPopupProbe().scope).toBe('block')
    expect(blockStart).toBeGreaterThan(0)
  })

  it('anchor-missing 错误分态：文案与语言包同源并含锚点原文', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: false,
      reason: 'anchor-missing',
      anchor: '不存在的标题',
    })
    const probe = hoverPopupProbe()
    expect(probe).toMatchObject({ open: true, state: 'error' })
    expect(probe.note).toContain('不存在的标题')
  })

  it('普通链接锚点（非双链类）：请求携带 linkHref；target 同为 href 原文', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const mdAnchor = document.createElement('a')
    mdAnchor.setAttribute('href', 'relative.md#章节甲')
    h.block.appendChild(mdAnchor)
    hoverPreviewAnchorEnter(mdAnchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    expect(req.linkHref).toBe('relative.md#章节甲')
    expect(req.target).toBe('relative.md#章节甲')
    expect(isHoverPopupOpen()).toBe(true)
  })

  it('外部网页锚点（http/协议相对/空 href）不开浮层、不发请求', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    for (const href of ['https://example.com/x', 'http://example.com', '//example.com/x', 'mailto:a@b.c', '']) {
      const a = document.createElement('a')
      a.setAttribute('href', href)
      h.block.appendChild(a)
      hoverPreviewAnchorEnter(a)
      vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS * 2)
      expect(isHoverPopupOpen(), `${href} 不得开浮层`).toBe(false)
      a.remove()
    }
    expect(h.sent.filter((m) => m.kind === 'hover.request')).toHaveLength(0)
  })

  it('双链锚点不携带 linkHref（缺省双链形态回归）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    expect(req.linkHref).toBeUndefined()
  })
})
