// 悬停预览浮层生命周期契约（#218，模块级 jsdom 直驱）：开闭延迟、移入
// 保活、Esc 关闭、一次一个浮层、实例释放与迟到响应不重开、零抢焦点、
// 只读渲染（任务禁写）；#219 局部范围（scope/range 过滤）、普通链接入口
// 与锚点缺失分态。真实指针/IME/观感回归在 test/browser 与集成层。
// #220 扩展：B 身份资源管理器（sourceDocUri 载荷与结果路由）、浮层内
// 链接点击跳转、笔记属性区折叠状态机与代码高亮。
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
  invalidateHoverPopupImages,
  isHoverPopupOpen,
  notifyHoverImageInvalidate,
  notifyHoverImageResult,
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
    codeHighlight: () => true,
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

// ---- #220：来源资源、浮层内链接与笔记属性区 ----
// B 文档内容以 B 为来源解析（图片经 sourceDocUri 走宿主 B 身份通道）、
// 浮层内链接点击经既有 open 通道（附 sourceDocUri）、全文引用的属性区
// 折叠状态机（默认折叠/热区按钮/刷新保留/重开复位）与代码高亮。
describe('#220 来源资源与浮层内容（B 身份）', () => {
  const B_FS_PATH = 'D:\\notes\\sub\\b.md'
  /** 成型 frontmatter + 图片 + 双链/普通链接 + 代码块的 B 文档 */
  const B_DOC = [
    '---',
    'title: B 笔记',
    'count: 3',
    '---',
    '',
    '# B 标题',
    '',
    '![B 图](./img.png)',
    '',
    '引用 [[C 笔记]] 与 [普通链接](c.md)。',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
  ].join('\n')

  /** 降级 frontmatter（嵌套映射值不受支持 → 转义源码块）的 B 文档 */
  const B_DOC_DEGRADED_FM = [
    '---',
    'title: B 笔记',
    'nested:',
    '  key: value',
    '---',
    '',
    '# B 标题',
    '',
  ].join('\n')

  const resultOk = (text: string, scope: { kind: 'full' } | { kind: 'heading'; anchor: string } = { kind: 'full' }) => ({
    target: { fsPath: B_FS_PATH, relPath: 'sub/b.md' },
    version: 2,
    text,
    range: { start: 0, end: text.length },
    scope,
  })

  interface Opened {
    req: Extract<WebviewToHost, { kind: 'hover.request' }>
    el: HTMLElement
  }

  /** 打开浮层并注入成功回包（默认 B_DOC 全文） */
  function openWithResult(h: Harness, text = B_DOC, scope?: { kind: 'heading'; anchor: string }): Opened {
    vi.useFakeTimers()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: true,
      ...resultOk(text, scope),
    })
    const el = popupEl()
    if (!el) {
      throw new Error('浮层未在场')
    }
    return { req, el }
  }

  it('B 内图片以 B 为来源：image.request 附 sourceDocUri（会话守卫字段仍是面板自身）', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const img = el.querySelector<HTMLImageElement>('img')
    expect(img, 'B 文档图片已挂载').toBeTruthy()
    expect(img!.getAttribute('src'), '相对路径的 src 已剥离待宿主解析').toBe(null)
    const imgReq = h.sent.find((m) => m.kind === 'image.request')
    expect(imgReq).toBeTruthy()
    if (imgReq && imgReq.kind === 'image.request') {
      expect(imgReq.sourceDocUri).toBe(B_FS_PATH)
      expect(imgReq.docUri).toBe(SESSION.docUri)
      expect(imgReq.sessionId).toBe(SESSION.sessionId)
      expect(imgReq.src).toBe('./img.png')
    }
  })

  it('image.result 路由回浮层 B 管理器：src 应用到图片', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const imgReq = h.sent.find((m) => m.kind === 'image.request')
    if (!imgReq || imgReq.kind !== 'image.request') {
      throw new Error('image.request 未发出')
    }
    notifyHoverImageResult({ reqId: imgReq.reqId, ok: true, src: 'vscode-webview://res/sub/img.png' })
    const img = el.querySelector<HTMLImageElement>('img')
    expect(img!.getAttribute('src')).toBe('vscode-webview://res/sub/img.png')
  })

  it('https 直连图源不经宿主：src 直接应用（无对应 image.request）', () => {
    const h = makeHarness()
    const doc = ['# B', '', '![外链](https://example.com/x.png)', ''].join('\n')
    const { el } = openWithResult(h, doc)
    const img = el.querySelector<HTMLImageElement>('img')
    expect(img!.getAttribute('src')).toBe('https://example.com/x.png')
    expect(h.sent.filter((m) => m.kind === 'image.request')).toHaveLength(0)
  })

  it('浮层内双链点击：wikilink.activate 附 sourceDocUri、零 edit.request、浮层关闭', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const link = el.querySelector<HTMLAnchorElement>('a.vsidian-wikilink')
    expect(link, 'B 内双链渲染为真实 a').toBeTruthy()
    link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const activate = h.sent.find((m) => m.kind === 'wikilink.activate')
    expect(activate).toBeTruthy()
    if (activate && activate.kind === 'wikilink.activate') {
      expect(activate.target).toBe('C 笔记')
      expect(activate.sourceDocUri).toBe(B_FS_PATH)
      expect(activate.docUri).toBe(SESSION.docUri)
    }
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    expect(isHoverPopupOpen(), '跳转即上下文切换，浮层关闭').toBe(false)
  })

  it('浮层内普通链接/外部链接点击：link.activate 附 sourceDocUri（外链经宿主分类处理）', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const md = el.querySelector<HTMLAnchorElement>('a[href="c.md"]')
    expect(md).toBeTruthy()
    md!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const activate = h.sent.find((m) => m.kind === 'link.activate')
    if (!activate || activate.kind !== 'link.activate') {
      throw new Error('link.activate 未发出')
    }
    expect(activate.href).toBe('c.md')
    expect(activate.sourceDocUri).toBe(B_FS_PATH)
    expect(isHoverPopupOpen()).toBe(false)
  })

  it('全文引用属性区：默认折叠（行隐藏类 + aria-expanded=false），标题行挂按钮', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const section = el.querySelector<HTMLElement>('.vsidian-hover-fm')
    expect(section, '成型 frontmatter 块挂属性区修饰类').toBeTruthy()
    expect(section!.classList.contains('vsidian-hover-fm-collapsed'), '默认折叠').toBe(true)
    const btn = section!.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')
    expect(btn, '标题栏内挂展开/折叠按钮').toBeTruthy()
    expect(btn!.getAttribute('aria-expanded')).toBe('false')
    expect(section!.querySelectorAll('.vsidian-fm-row').length).toBeGreaterThan(0)
    expect(hoverPopupProbe().fm).toBe('collapsed')
  })

  it('点击按钮切换展开；再点收回；按钮文案随状态换词', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const btn = el.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!
    btn.click()
    const section = el.querySelector<HTMLElement>('.vsidian-hover-fm')!
    expect(section.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(hoverPopupProbe().fm).toBe('expanded')
    const expandedLabel = btn.getAttribute('aria-label')
    btn.click()
    expect(el.querySelector<HTMLElement>('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(true)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).not.toBe(expandedLabel)
  })

  it('按钮为真实 focusable button（type=button）：键盘 Enter/Space 经浏览器原生激活走同一 click 处理器（真实键序在浏览器套件验证）', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const btn = el.querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.type).toBe('button')
    btn.focus()
    expect(document.activeElement).toBe(btn)
    btn.click()
    expect(hoverPopupProbe().fm).toBe('expanded')
  })

  it('刷新（同实例结果重放）保留展开状态；重新打开恢复折叠', () => {
    const h = makeHarness()
    const { req } = openWithResult(h)
    el().querySelector<HTMLButtonElement>('.vsidian-hover-fm-toggle')!.click()
    expect(hoverPopupProbe().fm).toBe('expanded')
    // 目标内容变化引发的重建（同实例重放成功结果——#224 接入推送前以同
    // instanceId+reqId 重放为刷新载体）：属性展开状态保持
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...resultOk(B_DOC) })
    expect(hoverPopupProbe().fm, '刷新不重置展开状态').toBe('expanded')
    expect(el().querySelector<HTMLElement>('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    // 关闭重开：恢复默认折叠
    closeHoverPopup()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req2 = h.sent.filter((m) => m.kind === 'hover.request').at(-1)
    if (!req2 || req2.kind !== 'hover.request') {
      throw new Error('第二次 hover.request 未发出')
    }
    notifyHoverResult({ kind: 'hover.result', reqId: req2.reqId, instanceId: req2.instanceId, ok: true, ...resultOk(B_DOC) })
    expect(hoverPopupProbe().fm, '重开恢复折叠').toBe('collapsed')
  })

  it('章节引用不附带属性区；无 frontmatter 不显示标题行（探针 fm=none）', () => {
    const h = makeHarness()
    const headingStart = B_DOC.indexOf('# B 标题')
    vi.useFakeTimers()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: B_FS_PATH, relPath: 'sub/b.md' },
      version: 2,
      text: B_DOC,
      range: { start: headingStart, end: B_DOC.length },
      scope: { kind: 'heading', anchor: 'B 标题' },
    })
    expect(el().querySelector('.vsidian-hover-fm')).toBeNull()
    expect(hoverPopupProbe().fm).toBe('none')

    // 无 frontmatter 文档
    closeHoverPopup()
    const noFm = ['# 只有标题', '', '正文。', ''].join('\n')
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req2 = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req2.reqId, instanceId: req2.instanceId, ok: true, ...resultOk(noFm) })
    expect(el().querySelector('.vsidian-hover-fm')).toBeNull()
    expect(el().querySelector('.vsidian-fm-header')).toBeNull()
    expect(hoverPopupProbe().fm).toBe('none')
  })

  it('降级 frontmatter：合成标题行（同构类名）+ 默认折叠（不静默丢弃原文）', () => {
    const h = makeHarness()
    const { el: popup } = openWithResult(h, B_DOC_DEGRADED_FM)
    const section = popup.querySelector<HTMLElement>('.vsidian-hover-fm')
    expect(section).toBeTruthy()
    expect(section!.querySelector('.vsidian-fm-header'), '降级态合成同构标题栏').toBeTruthy()
    expect(section!.querySelector('pre'), '源码原文保留在场').toBeTruthy()
    expect(section!.classList.contains('vsidian-hover-fm-collapsed')).toBe(true)
    expect(hoverPopupProbe().fm).toBe('collapsed')
  })

  it('代码块沿用现有高亮引擎：tok 词表 span 注入，卡片工具条不进入浮层', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const code = el.querySelector<HTMLElement>('pre code')
    expect(code, 'B 文档代码块渲染').toBeTruthy()
    expect(code!.querySelector('span[class^="tok-"]'), '朴素高亮形态（token span）').toBeTruthy()
    expect(el.querySelector('.vsidian-code-card-header'), '卡片头部不进入浮层').toBeNull()
  })

  it('codeHighlight 上下文关闭时不注入 token（设置跟随面板配置）', () => {
    const h = makeHarness()
    setHoverPreviewContext({
      session: () => SESSION,
      send: (message) => {
        h.sent.push(message)
      },
      codeHighlight: () => false,
    })
    const { el } = openWithResult(h)
    const code = el.querySelector<HTMLElement>('pre code')
    expect(code!.querySelector('span[class^="tok-"]')).toBeNull()
    expect(code!.textContent).toContain('const x = 1')
  })

  it('失效通知路由到 B 管理器：命中条目重发新请求（新 reqId）', () => {
    const h = makeHarness()
    openWithResult(h)
    const before = h.sent.filter((m) => m.kind === 'image.request')
    expect(before).toHaveLength(1)
    notifyHoverImageInvalidate(['./img.png'])
    const after = h.sent.filter((m) => m.kind === 'image.request')
    expect(after.length).toBe(2)
    if (after[1]!.kind === 'image.request') {
      expect(after[1]!.reqId, '新 reqId 重发').not.toBe((before[0] as { reqId: number }).reqId)
      expect(after[1]!.sourceDocUri).toBe(B_FS_PATH)
    }
  })

  it('手动刷新失效路由到 B 管理器：全量重挂重发（新 reqId）', () => {
    const h = makeHarness()
    openWithResult(h)
    expect(h.sent.filter((m) => m.kind === 'image.request')).toHaveLength(1)
    invalidateHoverPopupImages()
    expect(h.sent.filter((m) => m.kind === 'image.request')).toHaveLength(2)
  })

  it('关闭浮层释放 B 管理器：迟到的 image.result 不再应用任何 DOM', () => {
    const h = makeHarness()
    const { el } = openWithResult(h)
    const imgReq = h.sent.find((m) => m.kind === 'image.request')
    if (!imgReq || imgReq.kind !== 'image.request') {
      throw new Error('image.request 未发出')
    }
    closeHoverPopup()
    expect(popupEl()).toBeNull()
    notifyHoverImageResult({ reqId: imgReq.reqId, ok: true, src: 'vscode-webview://res/late.png' })
    expect(el.isConnected).toBe(false)
    expect(popupEl()).toBeNull()
  })

  function el(): HTMLElement {
    const found = popupEl()
    if (!found) {
      throw new Error('浮层未在场')
    }
    return found
  }
})
