// 悬停预览浮层生命周期契约（#218，模块级 jsdom 直驱）：开闭延迟、移入
// 保活、Esc 关闭、一次一个浮层、实例释放与迟到响应不重开、零抢焦点、
// 只读渲染（任务禁写）；#219 局部范围（scope/range 过滤）、普通链接入口
// 与锚点缺失分态。真实指针/IME/观感回归在 test/browser 与集成层。
// #220 扩展：B 身份资源管理器（sourceDocUri 载荷与结果路由）、浮层内
// 链接点击跳转、笔记属性区折叠状态机与代码高亮。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  closeHoverPopup,
  closeHoverPopupIfAnchorWithin,
  hoverPopupProbe,
  hoverPreviewAnchorEnter,
  hoverPreviewAnchorLeave,
  invalidateHoverPopupImages,
  isHoverPopupOpen,
  notifyHoverExternalSettings,
  notifyHoverImageInvalidate,
  notifyHoverImageResult,
  notifyHoverInvalidated,
  notifyHoverResult,
  openHoverPopupFor,
  openHoverPopupForKeyboard,
  setHoverPreviewContext,
  __resetHoverPopupForTest,
  HOVER_POPUP_CLOSE_DELAY_MS,
  HOVER_POPUP_OPEN_DELAY_MS,
} from '../../src/webview/hoverPopup'
import { untrustedFrameWindowCount } from '../../src/webview/untrustedFrame'

// 错误分态文案断言需要已装配语言包（生产经数据岛/locale.changed 装配；
// 单测直接注入 zh-cn 字典——与浏览器套件 buildZhLocaleIsland 同源）
installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vsidian-hover-popup-scroll') ? 400 : 0
  })
})

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
  vi.restoreAllMocks()
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

describe('悬停总开关门控（#298：hover.enabled 关闭时全域悬停不弹浮层）', () => {
  /** 上下文带总开关关闭的装配（其余与 makeHarness 同款） */
  function makeDisabledHarness() {
    const sent: WebviewToHost[] = []
    setHoverPreviewContext({
      session: () => SESSION,
      send: (message) => {
        sent.push(message)
      },
      codeHighlight: () => true,
      hoverPreviewEnabled: () => false,
    })
    const anchor = document.createElement('a')
    anchor.className = 'vsidian-wikilink'
    anchor.setAttribute('href', '目标笔记')
    document.body.appendChild(anchor)
    return { sent, anchor }
  }

  it('总开关关闭：进入链接不建待开计时——满开延迟后无浮层、无请求（前置拦截）', () => {
    vi.useFakeTimers()
    const h = makeDisabledHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS * 3)
    expect(isHoverPopupOpen()).toBe(false)
    expect(popupEl()).toBeNull()
    expect(h.sent).toEqual([])
  })

  it('总开关关闭：显式 spec 路径（Live 装饰/面板条目/补按 Ctrl 补触发共用入口）同样被拦', () => {
    vi.useFakeTimers()
    const h = makeDisabledHarness()
    // 「悬停中补按 Ctrl」补触发与面板/Live 入口都经显式 spec 调用本入口
    hoverPreviewAnchorEnter(h.anchor, {
      target: '目标笔记', sourceStart: 0, sourceEnd: 4,
      directFsPath: 'D:/notes/目标笔记.md',
    })
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS * 3)
    expect(isHoverPopupOpen()).toBe(false)
    expect(h.sent).toEqual([])
    // leave 路径安全（无计时无浮层可清理，不崩溃）
    hoverPreviewAnchorLeave(h.anchor)
    expect(isHoverPopupOpen()).toBe(false)
  })

  it('总开关关闭同拦键盘命令（#298 跟进扩权：命令执行但静默）；上下文未提供开关时缺省视为开', () => {
    vi.useFakeTimers()
    // #298 跟进（2026-10-02 用户裁定扩权）：「预览当前链接」键盘命令入口
    // 一并被拦——命令执行但静默不弹浮层（与「无目标静默不误开」同形态）
    const h = makeDisabledHarness()
    openHoverPopupForKeyboard(h.anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 4 })
    expect(isHoverPopupOpen(), '总开关关闭时键盘命令不得打开浮层').toBe(false)
    expect(popupEl()).toBeNull()
    expect(h.sent, '静默拦截零请求').toEqual([])
    // 缺省契约：上下文未提供 hoverPreviewEnabled（旧装配/测试 fixture）视为开
    const fallback = makeHarness()
    hoverPreviewAnchorEnter(fallback.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen(), '缺省视为开：悬停路径恢复').toBe(true)
  })

  it('总开关重新打开后恢复悬停路径（消失语义不变：门控只辖出现）', () => {
    vi.useFakeTimers()
    let enabled = false
    const sent: WebviewToHost[] = []
    setHoverPreviewContext({
      session: () => SESSION,
      send: (message) => {
        sent.push(message)
      },
      codeHighlight: () => true,
      hoverPreviewEnabled: () => enabled,
    })
    const anchor = document.createElement('a')
    anchor.className = 'vsidian-wikilink'
    anchor.setAttribute('href', '目标笔记')
    document.body.appendChild(anchor)
    hoverPreviewAnchorEnter(anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
    enabled = true
    hoverPreviewAnchorEnter(anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen(), '重开后同一悬停入口恢复打开').toBe(true)
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(1)
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

describe('窗口失焦与不可见释放', () => {
  // 验收反馈（2026-09-30 切窗失效）：Chromium 对未聚焦窗口不派发 mouseout
  //（electron#45246），切窗期间 mouseleave 缺失 → 关闭计时永不启动 → 浮层
  // 滞留后台遮挡正文（fixed 480×400 拦截 mouseover，悬停完全失效，点侧栏
  // /切页才恢复）。瞬态 UI 失焦即关——与宿主 hover 语义一致
  it('窗口失焦（blur）即刻关闭在场浮层并释放 DOM', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    notifyHoverResult({ kind: 'hover.result', reqId: requestOf(h).reqId, instanceId: requestOf(h).instanceId, ok: true, ...RESULT_OK })
    expect(isHoverPopupOpen()).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(isHoverPopupOpen(), '失焦即关（不待关闭延迟）').toBe(false)
    expect(popupEl()).toBeNull()
  })

  it('窗口失焦同时取消待开计时（开前切窗不留悬空浮层）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS * 2)
    expect(isHoverPopupOpen()).toBe(false)
    expect(h.sent).toEqual([])
  })

  it('文档不可见（最小化/后台标签）同样即刻关闭', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(true)
    // 实例属性遮蔽原型 hidden（jsdom 原型取值），finally 删除还原
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
    } finally {
      delete (document as { hidden?: boolean }).hidden
    }
    expect(isHoverPopupOpen(), '不可见即关').toBe(false)
    expect(popupEl()).toBeNull()
  })

  it('失焦关闭不影响后续正常开闭（切回后再悬停可重新触发）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    window.dispatchEvent(new Event('blur'))
    expect(isHoverPopupOpen()).toBe(false)
    window.dispatchEvent(new Event('focus'))
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    expect(isHoverPopupOpen(), '切回后可再开').toBe(true)
    const reqs = h.sent.filter((m) => m.kind === 'hover.request')
    expect(reqs).toHaveLength(2)
  })
})

describe('标题条与跳转入口（嵌入卡片同款 header）', () => {
  // 验收反馈（2026-09-30）：浮层加嵌入同款标题+跳转按钮 header——标题为
  // 目标显示名（spec.target 常驻，不随回包换），跳转按钮按 spec 形态分派
  // 到既有激活消息族（双链 wikilink.activate / 普通链接 link.activate /
  // 面板形态调用方经 openAction 闭包自带通道），点击即上下文切换关闭
  it('header 在场（loading 态即有）：标题为目标显示名，跳转按钮带图标与可访问名', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const el = popupEl()!
    const header = el.querySelector<HTMLElement>('.vsidian-hover-popup-header')
    expect(header, '标题条在场（浮层生命周期常驻）').not.toBeNull()
    const title = header!.querySelector<HTMLElement>('.vsidian-hover-popup-title')
    expect(title!.textContent).toBe('目标笔记')
    const open = header!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')
    expect(open, '跳转按钮在场').not.toBeNull()
    expect(open!.innerHTML).toContain('<svg')
    expect(open!.getAttribute('aria-label')).toBe(zhCn['embed.openTarget'])
  })

  it('双链形态点击跳转按钮：wikilink.activate 载荷（父文档身份解析）且浮层关闭', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const open = popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')!
    open.click()
    const msg = h.sent.find((m) => m.kind === 'wikilink.activate')
    expect(msg, '应发 wikilink.activate').toBeDefined()
    if (msg && msg.kind === 'wikilink.activate') {
      expect(msg.target).toBe('目标笔记')
      expect(msg.srcStart).toBe(10)
      expect(msg.srcEnd).toBe(30)
      expect(msg.sourceDocUri, 'header 跳转按父文档解析（不带来源文档）').toBeUndefined()
    }
    expect(isHoverPopupOpen(), '点击即上下文切换关闭').toBe(false)
    expect(popupEl()).toBeNull()
  })

  it('普通链接形态点击跳转按钮：link.activate 附 href 原文', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    h.anchor.classList.remove('vsidian-wikilink')
    hoverPreviewAnchorEnter(h.anchor, { target: '笔记.md', linkHref: '笔记.md', sourceStart: 10, sourceEnd: 30 })
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')!.click()
    const msg = h.sent.find((m) => m.kind === 'link.activate')
    expect(msg, '应发 link.activate').toBeDefined()
    if (msg && msg.kind === 'link.activate') {
      expect(msg.href).toBe('笔记.md')
    }
  })

  it('面板形态（openAction 闭包）：跳转走调用方通道，回调后同样关闭', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const opened: string[] = []
    hoverPreviewAnchorEnter(h.anchor, {
      target: '来源笔记',
      sourceStart: 0,
      sourceEnd: 0,
      openAction: () => opened.push('backlink'),
    })
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')!.click()
    expect(opened).toEqual(['backlink'])
    expect(h.sent.filter((m) => m.kind === 'wikilink.activate'),
      'openAction 形态不重复发默认通道').toHaveLength(0)
    expect(isHoverPopupOpen()).toBe(false)
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
  it('外层滚动区 loading 隐藏后切 content，同步挂载可见首屏', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('vsidian-hover-popup-scroll') && this.style.display !== 'none' ? 400 : 0
    })
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    const scrollEl = popupEl()!.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    expect(scrollEl.style.display).toBe('none')
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...RESULT_OK })
    expect(scrollEl.style.display).toBe('')
    expect(popupEl()!.querySelector('.vsidian-reading-heading-1')?.textContent ?? '').toContain('目标笔记')
  })

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
    // loading 不挂错误修饰类（验收反馈：错误文案与普通文字区分）
    const stateEl = popupEl()!.querySelector('.vsidian-hover-popup-state')
    expect(stateEl!.classList.contains('vsidian-hover-popup-state-error')).toBe(false)
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    const probe = hoverPopupProbe()
    expect(probe).toMatchObject({ open: true, state: 'error' })
    expect(popupEl()!.textContent).not.toBe('')
    // 错误分态挂错误修饰类（主题错误色的 DOM 载体）
    expect(stateEl!.classList.contains('vsidian-hover-popup-state-error')).toBe(true)
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

  it('P2-03 heading scope 成功结果：全文可达（锚点前后内容都在场），探针仍记录 heading', () => {
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
    expect(text, '锚点之前的顶部段同样在场（全文可达）').toContain('顶部段')
    expect(text, '锚点区间之后的下一章节同样在场').toContain('乙段')
    expect(text, '多行列表块整取（不截首行）').toContain('列表项一')
    const probe = hoverPopupProbe()
    expect(probe.scope).toBe('heading')
    // 全文可达后首屏挂载的块数不再小于全文块量级（原局部过滤时仅 3 块）
    expect(probe.blocks).toBeGreaterThanOrEqual(5)
  })

  it('P2-03 block scope 成功结果：全文在场，探针记录 block', () => {
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
    expect(text, '块外的顶部段在场（全文可达）').toContain('顶部段')
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

  it('P2-03 章节引用同样附带属性区（全文内容含 frontmatter）；无 frontmatter 不显示标题行（探针 fm=none）', () => {
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
    // P2-03（#280）：内容范围恒全文——属性区随全文在场（默认折叠）
    expect(el().querySelector('.vsidian-hover-fm')).not.toBeNull()
    expect(hoverPopupProbe().fm).toBe('collapsed')

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

// #221 全入口悬停：显式目标入口（Live 装饰 DOM / 面板条目无 href 属性，
// 目标形态由调用方组装——openHoverPopupFor）与键盘模态（手动打开、焦点
// 进入浮层、Esc 返还触发处、焦点在内不因鼠标离开销毁）；面板/切模式等
// 触发上下文失效的锚点域释放。
describe('#221 显式目标入口与键盘模态', () => {
  /** 非 <a> 锚元素（Live 装饰 span / 面板条目同构）：目标经 spec 显式给出 */
  function makeSpanHarness(): { sent: WebviewToHost[]; anchor: HTMLSpanElement } {
    const sent: WebviewToHost[] = []
    setHoverPreviewContext({
      session: () => SESSION,
      send: (message) => {
        sent.push(message)
      },
      codeHighlight: () => true,
    })
    const anchor = document.createElement('span')
    anchor.className = 'vsidian-wikilink'
    document.body.appendChild(anchor)
    return { sent, anchor }
  }

  it('openHoverPopupFor：非 <a> 锚元素按 spec 发请求（双链形态：target 原文 + 源区间）', () => {
    const h = makeSpanHarness()
    openHoverPopupFor(h.anchor, { target: '目标笔记', sourceStart: 12, sourceEnd: 24 })
    expect(isHoverPopupOpen()).toBe(true)
    const req = h.sent.find((m) => m.kind === 'hover.request')
    if (!req || req.kind !== 'hover.request') {
      throw new Error('hover.request 未发出')
    }
    expect(req.target).toBe('目标笔记')
    expect(req.sourceStart).toBe(12)
    expect(req.sourceEnd).toBe(24)
    expect(req.linkHref).toBeUndefined()
    expect(req.directTarget).toBeUndefined()
  })

  it('openHoverPopupFor：普通链接形态附 linkHref；面板直接目标附 directTarget（断链空串合法）', () => {
    const md = makeSpanHarness()
    openHoverPopupFor(md.anchor, { target: '目标笔记.md', linkHref: '目标笔记.md#章节', sourceStart: 0, sourceEnd: 5 })
    const mdReq = md.sent.find((m) => m.kind === 'hover.request')
    if (!mdReq || mdReq.kind !== 'hover.request') {
      throw new Error('md hover.request 未发出')
    }
    expect(mdReq.linkHref).toBe('目标笔记.md#章节')
    closeHoverPopup()

    const panel = makeSpanHarness()
    openHoverPopupFor(panel.anchor, {
      target: '出链显示名',
      sourceStart: 0,
      sourceEnd: 0,
      directFsPath: 'D:\notes\目标.md',
      directAnchor: '^blk1',
    })
    const req = panel.sent.find((m) => m.kind === 'hover.request')
    if (!req || req.kind !== 'hover.request') {
      throw new Error('panel hover.request 未发出')
    }
    expect(req.directTarget).toEqual({ fsPath: 'D:\notes\目标.md', anchor: '^blk1' })
    closeHoverPopup()

    // 断链出链条目：空串 fsPath 仍入队（宿主回 not-found 分态）
    const broken = makeSpanHarness()
    openHoverPopupFor(broken.anchor, { target: '断链名', sourceStart: 0, sourceEnd: 0, directFsPath: '' })
    const brokenReq = broken.sent.find((m) => m.kind === 'hover.request')
    if (!brokenReq || brokenReq.kind !== 'hover.request') {
      throw new Error('broken hover.request 未发出')
    }
    expect(brokenReq.directTarget).toEqual({ fsPath: '' })
  })

  it('错误分态文案取 spec.target（不依赖锚元素 href 属性）', async () => {
    const h = makeSpanHarness()
    openHoverPopupFor(h.anchor, { target: '显示名', sourceStart: 0, sourceEnd: 0, directFsPath: '' })
    const req = h.sent.find((m) => m.kind === 'hover.request')
    if (!req || req.kind !== 'hover.request') {
      throw new Error('hover.request 未发出')
    }
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    const el = popupEl()!
    const stateEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-state')!
    expect(stateEl.textContent).toContain('显示名')
  })

  it('键盘打开：焦点进入浮层（可 Tab 遍历）；Esc 关闭后返还触发处焦点', () => {
    vi.useFakeTimers()
    const h = makeSpanHarness()
    // 触发元素：面板条目同构 button（键盘命令的真实触发形态）
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)
    openHoverPopupForKeyboard(h.anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 8 })
    expect(isHoverPopupOpen()).toBe(true)
    const el = popupEl()!
    expect(document.activeElement, '焦点进入浮层').toBe(el)
    // Esc 关闭：焦点返还触发元素
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(isHoverPopupOpen()).toBe(false)
    expect(document.activeElement, 'Esc 后返还触发处').toBe(trigger)
    vi.useRealTimers()
  })

  it('键盘模态保活：焦点在浮层内时，离开链接（鼠标路径的延迟关闭源）不销毁现场', () => {
    vi.useFakeTimers()
    const h = makeSpanHarness()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    openHoverPopupForKeyboard(h.anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 8 })
    const el = popupEl()!
    // 鼠标离开链接与浮层（mouseleave → scheduleClose）：焦点在内不关闭
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 5)
    expect(isHoverPopupOpen(), '键盘模态焦点在内：鼠标离开不销毁').toBe(true)
    // 焦点离开浮层（Tab 出去）后：恢复常规鼠标关闭语义
    trigger.focus()
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen(), '焦点已不在浮层内：恢复延迟关闭').toBe(false)
    vi.useRealTimers()
  })

  it('鼠标路径不抢焦点的既有契约不变（openHoverPopupFor 无键盘标记）', () => {
    const h = makeSpanHarness()
    const before = document.activeElement
    openHoverPopupFor(h.anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 8 })
    expect(document.activeElement, '鼠标路径零抢焦点').toBe(before)
    expect(popupEl()!.tabIndex, '容器可编程聚焦但不进 Tab 序').toBe(-1)
    closeHoverPopup()
  })

  it('closeHoverPopupIfAnchorWithin：锚点在失效域内（面板重渲染/面板隐藏）释放；域外保留', () => {
    const h = makeSpanHarness()
    const panelScope = h.anchor.parentElement!
    openHoverPopupFor(h.anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 8 })
    expect(isHoverPopupOpen()).toBe(true)
    closeHoverPopupIfAnchorWithin(document.createElement('div'))
    expect(isHoverPopupOpen(), '域外不动在场浮层').toBe(true)
    closeHoverPopupIfAnchorWithin(panelScope)
    expect(isHoverPopupOpen(), '锚点所在域失效即释放').toBe(false)
  })
})

// ---- #224 引用视图同步：目标订阅、失效分态与版本仲裁 ----
// 订阅生命周期（成功装载登记 hover.watch、关闭配对 hover.unwatch）、
// hover.invalidated 三分态（changed 同实例静默重载 / deleted 撤内容显示
// 缺失态 / stale 读取失败分态）、目标内容版本仲裁（旧回包不冒充）与
// 刷新状态保持（fm 展开、滚动位置）。
describe('#224 引用视图同步：订阅、失效分态与版本仲裁', () => {
  interface Loaded {
    req: { reqId: number; instanceId: string }
  }

  function openAndLoad(h: Harness, opts?: { version?: number; text?: string }): Loaded {
    openHoverPopupFor(h.anchor, { target: '目标笔记', sourceStart: 10, sourceEnd: 30 })
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: true,
      ...RESULT_OK,
      version: opts?.version ?? RESULT_OK.version,
      ...(opts?.text !== undefined ? { text: opts.text, range: { start: 0, end: opts.text.length } } : {}),
    })
    return { req: { reqId: req.reqId, instanceId: req.instanceId } }
  }

  function pushInvalidation(fsPath: string, status: 'changed' | 'deleted' | 'stale', generation: number): void {
    notifyHoverInvalidated({ fsPath, status, generation })
  }

  it('成功装载登记订阅（hover.watch 携带目标与实例身份）；关闭配对释放', () => {
    const h = makeHarness()
    openAndLoad(h)
    const watch = h.sent.find((m) => m.kind === 'hover.watch')
    expect(watch).toMatchObject({
      sessionId: SESSION.sessionId,
      docUri: SESSION.docUri,
      fsPath: RESULT_OK.target.fsPath,
    })
    expect(watch && watch.kind === 'hover.watch' && watch.instanceId).toMatch(/^hover-/)
    closeHoverPopup()
    const unwatch = h.sent.find((m) => m.kind === 'hover.unwatch')
    expect(unwatch).toMatchObject({
      fsPath: RESULT_OK.target.fsPath,
      instanceId: watch && watch.kind === 'hover.watch' ? watch.instanceId : '',
    })
  })

  it('装载失败（not-found）不订阅；关闭零 unwatch', () => {
    const h = makeHarness()
    openHoverPopupFor(h.anchor, { target: '目标笔记', sourceStart: 10, sourceEnd: 30 })
    const req = requestOf(h)
    notifyHoverResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' })
    expect(h.sent.some((m) => m.kind === 'hover.watch')).toBe(false)
    closeHoverPopup()
    expect(h.sent.some((m) => m.kind === 'hover.unwatch')).toBe(false)
  })

  it('changed 推送：同实例新 reqId 静默重发（不闪 loading）；新内容到达刷新、fm 展开保持', () => {
    const h = makeHarness()
    // 带 frontmatter 的目标（fm 展开状态断言素材）
    const fmText = ['---', 'title: 目标笔记', '---', '', '# 目标笔记', '', '- [ ] 任务一', ''].join('\n')
    const { req } = openAndLoad(h, { text: fmText, version: 3 })
    // 展开 fm（默认折叠）
    const fmBtn = popupEl()!.querySelector<HTMLElement>('.vsidian-hover-fm-toggle')
    expect(fmBtn, '全文引用应带属性区').not.toBeNull()
    fmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const requestsBefore = h.sent.filter((m) => m.kind === 'hover.request').length
    pushInvalidation(RESULT_OK.target.fsPath, 'changed', 1)
    // 旧 reqId 迟到回包丢弃（新 reqId 已更新）
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      ...RESULT_OK, text: '# 旧内容\n', range: { start: 0, end: 6 },
    })
    expect(hoverPopupProbe().note).toBe('目标笔记.md') // 旧内容未覆盖
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    expect(requests.length).toBe(requestsBefore + 1)
    const refresh = requests.at(-1)!
    if (refresh.kind !== 'hover.request') {
      throw new Error('刷新请求未发出')
    }
    expect(refresh.instanceId).toBe(req.instanceId) // 同实例
    expect(refresh.reqId).toBeGreaterThan(req.reqId) // 新请求代次
    // P2-03 刷新宽容：已打开实例的重载不因锚点缺失切成错误页
    expect(refresh.anchorOptional).toBe(true)
    // 装载中保持内容态（不闪 loading）
    expect(hoverPopupProbe().state).toBe('content')
    // 新内容到达（带 frontmatter——刷新后属性区仍应在场）
    const fmText2 = ['---', 'title: 目标笔记', '---', '', '# 新内容', ''].join('\n')
    notifyHoverResult({
      kind: 'hover.result', reqId: refresh.reqId, instanceId: refresh.instanceId, ok: true,
      ...RESULT_OK, version: 4, text: fmText2, range: { start: 0, end: fmText2.length },
    })
    expect(hoverPopupProbe().state).toBe('content')
    expect(popupEl()!.textContent).toContain('新内容')
    // fm 展开保持（刷新不重置）
    expect(hoverPopupProbe().fm).toBe('expanded')
  })

  it('deleted 推送：撤下内容显示缺失态（不无限保留旧内容）；恢复 changed 重载', () => {
    const h = makeHarness()
    openAndLoad(h)
    pushInvalidation(RESULT_OK.target.fsPath, 'deleted', 1)
    const probe = hoverPopupProbe()
    expect(probe.state).toBe('error')
    expect(probe.note).toContain('目标笔记') // not-found 文案含目标原文
    expect(popupEl()!.textContent).not.toContain('任务一') // 旧内容已撤下
    // 恢复：changed 推送 → 重发请求 → 装载
    pushInvalidation(RESULT_OK.target.fsPath, 'changed', 2)
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    const refresh = requests.at(-1)!
    if (refresh.kind !== 'hover.request') {
      throw new Error('恢复重载请求未发出')
    }
    notifyHoverResult({
      kind: 'hover.result', reqId: refresh.reqId, instanceId: refresh.instanceId, ok: true,
      ...RESULT_OK, version: 5,
    })
    expect(hoverPopupProbe().state).toBe('content')
  })

  it('stale 推送：读取失败分态（不等同删除——恢复 changed 同链路）', () => {
    const h = makeHarness()
    openAndLoad(h)
    pushInvalidation(RESULT_OK.target.fsPath, 'stale', 1)
    expect(hoverPopupProbe().state).toBe('error')
    expect(hoverPopupProbe().fm).toBe('none') // 内容已撤（属性区随内容退场）
  })

  it('版本仲裁：同 reqId 重复投递的更旧版本回包丢弃（慢响应旧内容不冒充）', () => {
    const h = makeHarness()
    const { req } = openAndLoad(h, { version: 5 })
    // 同 reqId 的重复/迟到投递携带更旧版本：版本防线拒绝（changed 重发
    // 路径的谱系让位语义见「版本谱系断点自愈」两则——修 7）
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      ...RESULT_OK, version: 3, text: '# 旧版本\n', range: { start: 0, end: 6 },
    })
    expect(popupEl()!.textContent).not.toContain('旧版本')
    expect(hoverPopupProbe().state).toBe('content') // 已应用内容不被破坏
  })

  it('未订阅目标的推送零动作（他目标失效不影响在场浮层）', () => {
    const h = makeHarness()
    openAndLoad(h)
    pushInvalidation('D:\notes\其他.md', 'deleted', 1)
    expect(hoverPopupProbe().state).toBe('content')
    expect(h.sent.filter((m) => m.kind === 'hover.request')).toHaveLength(1)
  })

  it('刷新保持滚动位置（内容缩短合法钳制由浏览器承担，此处钉回写语义）', () => {
    const h = makeHarness()
    openAndLoad(h)
    const scrollEl = popupEl()!.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    scrollEl.scrollTop = 28
    pushInvalidation(RESULT_OK.target.fsPath, 'changed', 1)
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    const refresh = requests.at(-1)!
    if (refresh.kind !== 'hover.request') {
      throw new Error('刷新请求未发出')
    }
    notifyHoverResult({
      kind: 'hover.result', reqId: refresh.reqId, instanceId: refresh.instanceId, ok: true,
      ...RESULT_OK, version: 4, text: '# 变长的新内容\n\n更多段落\n', range: { start: 0, end: 16 },
    })
    expect(scrollEl.scrollTop).toBe(28) // 刷新后回写原滚动位置
  })

  it('版本谱系断点自愈：changed 重发后 version 变小的回包被应用（宿主释放重开重置 version）', () => {
    const h = makeHarness()
    openAndLoad(h, { version: 9 })
    pushInvalidation(RESULT_OK.target.fsPath, 'changed', 1)
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    const refresh = requests.at(-1)!
    if (refresh.kind !== 'hover.request') {
      throw new Error('刷新请求未发出')
    }
    // 宿主释放重开目标文档：version 从 9 重置为 2（谱系断点）——若版本
    // 防线不让位，此回包被恒拒且无重发通道，旧内容滞留
    notifyHoverResult({
      kind: 'hover.result', reqId: refresh.reqId, instanceId: refresh.instanceId, ok: true,
      ...RESULT_OK, version: 2, text: '# 重开后的新内容\n', range: { start: 0, end: 9 },
    })
    expect(hoverPopupProbe().state).toBe('content')
    expect(popupEl()!.textContent).toContain('重开后的新内容')
  })

  it('谱系让位期间迟到旧 reqId 回包仍被拒（instanceId+reqId 配对守卫兜底）', () => {
    const h = makeHarness()
    const { req } = openAndLoad(h, { version: 9 })
    pushInvalidation(RESULT_OK.target.fsPath, 'changed', 1) // reqId 前进 + 谱系让位
    // 迟到的旧 reqId 回包（重发前发起的慢响应）：配对失败丢弃
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      ...RESULT_OK, version: 1, text: '# 旧响应内容\n', range: { start: 0, end: 7 },
    })
    expect(popupEl()!.textContent).not.toContain('旧响应内容')
    expect(hoverPopupProbe().state).toBe('content') // 已应用内容不被破坏
  })
})

// ---- 修 6（review 第二轮 P3）：同锚点重复进入不重置开设计时 ----
// 嵌套行内标记链接（如 [**粗体**](x.md)）内跨子元素移动触发多次
// mouseover（联合域内移动的 mouseout 被调用方过滤，无对应 leave）：
// popup 未开时每次 enter 都 cancelPendingOpen 重建 300ms timer，
// 浮层被推迟到指针静止才开。守卫：同一 anchor 已有 pendingOpen 时
// 不重建（保留首次进入起算的计时）。
describe('嵌套行内标记内的重复进入（同锚点不重置开设计时）', () => {
  it('同一锚点 pendingOpen 期间的重复 enter 不重建计时器（按首次进入起算延迟打开）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS - 100)
    hoverPreviewAnchorEnter(h.anchor) // 子元素间移动的重复 mouseover
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(100) // 距首次进入满 300ms
    expect(isHoverPopupOpen()).toBe(true)
  })

  it('换锚点仍先取消旧 pending（不同目标不受同锚点守卫影响）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    const anchor2 = document.createElement('a')
    anchor2.className = 'vsidian-wikilink'
    anchor2.setAttribute('href', '另一个笔记')
    h.block.appendChild(anchor2)
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS - 100)
    hoverPreviewAnchorEnter(anchor2) // 换锚点：旧 pending 取消、新计时起算
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS - 100)
    expect(isHoverPopupOpen(), '旧锚点的 pending 已取消不打开').toBe(false)
    vi.advanceTimersByTime(100) // 新锚点满 300ms
    expect(isHoverPopupOpen()).toBe(true)
    expect(requestOf(h).target).toBe('另一个笔记')
  })
})

describe('#242 浮层挂载释放', () => {
  it('关闭后保留的旧打开按钮不能激活目标', () => {
    const h = makeHarness()
    openHoverPopupForKeyboard(h.anchor, { target: '目标笔记', sourceStart: 10, sourceEnd: 30 })
    const open = popupEl()!.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')!
    closeHoverPopup()
    const before = h.sent.length
    open.click()
    expect(h.sent.length).toBe(before)
  })
})

// #333（P3-01）类型化装载：hover.result 成功回包经 contentKind 分派——
// markdown（显式与缺省兼容）照常应用；kind 与载荷不匹配的回包（本票
// 防御路径：宿主/校验器已拦，此处钉住消费端不应用、不悬挂租约）。
describe('#333 类型化装载（contentKind 分派）', () => {
  it('显式 contentKind: markdown 照常应用内容（生产类型化出站形态）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      contentKind: 'markdown', ...RESULT_OK,
    })
    expect(hoverPopupProbe().state).toBe('content')
    expect(hoverPopupProbe().scope).toBe('full')
    expect(hoverPopupProbe().blocks).toBeGreaterThan(0)
    closeHoverPopup()
  })

  it('kind 与载荷不匹配（pdf + Markdown 载荷）：不应用内容、显示错误分态、释放来源租约', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      contentKind: 'pdf', sourceLeaseId: 'lease-1', ...RESULT_OK,
    })
    expect(hoverPopupProbe().state).toBe('error')
    expect(hoverPopupProbe().blocks).toBe(0)
    expect(h.sent).toContainEqual({
      kind: 'hover.source.release', sessionId: SESSION.sessionId, docUri: SESSION.docUri,
      sourceLeaseId: 'lease-1',
    })
    closeHoverPopup()
  })
})

// #336（P3-04）图片目标浮层：悬停图片双链/链接 → hover.result 的 image
// 载荷在浮层内渲染图片槽位（经 ImageResourceManager 装载——与普通图片同
// 一加载/重试/弹窗行为源）；图源请求按面板文档解析（非来源化 image.request
// ——与主视图图片同通道）；目标订阅与失效刷新沿用既有规则；纯 Reading 形
// 态（不接根会话——图片无内部模式切换语义）。
describe('#336 图片目标浮层：image 载荷渲染', () => {
  const IMAGE_RESULT_OK = {
    contentKind: 'image' as const,
    target: { fsPath: 'D:\notes\图.png', relPath: '图.png' },
    version: 1760000000123,
    imageSrc: 'assets/图.png',
    text: '',
    range: { start: 0, end: 0 },
    scope: { kind: 'plain' as const },
  }

  function imageHarness(): Harness {
    const h = makeHarness()
    h.anchor.setAttribute('href', 'assets/图.png')
    return h
  }

  function imageRequestOf(h: Harness) {
    const req = h.sent.find((m) => m.kind === 'image.request')
    if (!req || req.kind !== 'image.request') {
      throw new Error('image.request 未发出')
    }
    return req
  }

  it('image 载荷渲染图片槽位：img 携带图源身份，请求按面板文档解析（无 sourceDocUri）', () => {
    vi.useFakeTimers()
    const h = imageHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...IMAGE_RESULT_OK,
    })
    expect(hoverPopupProbe().state).toBe('content')
    const img = popupEl()?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.dataset['vsidianImgSrc']).toBe('assets/图.png')
    const imgReq = imageRequestOf(h)
    expect(imgReq.src).toBe('assets/图.png')
    expect('sourceDocUri' in imgReq, '图片目标浮层的图源按面板文档解析（非来源化）').toBe(false)
    expect(h.sent.some((m) => m.kind === 'hover.watch' && m.fsPath === 'D:\notes\图.png'), '登记目标订阅').toBe(true)
    closeHoverPopup()
  })

  it('image.result 路由驱动槽位装载（frame chrome 在场——查看大图入口）', () => {
    vi.useFakeTimers()
    const h = imageHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...IMAGE_RESULT_OK,
    })
    const imgReq = imageRequestOf(h)
    notifyHoverImageResult({ reqId: imgReq.reqId, ok: true, src: 'data:image/png;base64,xxx' })
    const img = popupEl()?.querySelector('img')
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,xxx')
    // jsdom 不触发 img load 事件——loaded 态由浏览器套件断言（绘制层）
    expect(img?.dataset['vsidianImgState']).toBe('loading')
    expect(popupEl()?.querySelector('.vsidian-graphic-frame'), '图片 frame chrome 在场（查看大图入口）').not.toBeNull()
    expect(hoverPopupProbe().imageSrcs).toContain('data:image/png;base64,xxx')
    closeHoverPopup()
  })

  it('图片目标不接根会话：模式/保存/关闭按钮隐藏（纯 Reading 形态——无内部模式切换）', () => {
    vi.useFakeTimers()
    const h = imageHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const el = popupEl()
    const modeBtn = el?.querySelector<HTMLElement>('.vsidian-hover-popup-mode')
    expect(modeBtn?.style.display, '图片目标无内部 Live 语义').toBe('none')
    const saveBtn = el?.querySelector<HTMLElement>('.vsidian-hover-popup-save')
    expect(saveBtn?.style.display).toBe('none')
    closeHoverPopup()
  })

  it('目标失效 changed → 静默重发 hover.request（刷新链路沿用既有规则）', () => {
    vi.useFakeTimers()
    const h = imageHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...IMAGE_RESULT_OK,
    })
    const requestsBefore = h.sent.filter((m) => m.kind === 'hover.request').length
    notifyHoverInvalidated({ fsPath: 'D:\notes\图.png', status: 'changed', generation: 1 })
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    expect(requests.length).toBe(requestsBefore + 1)
    expect(hoverPopupProbe().state, '刷新期间保留旧内容（不闪 loading）').toBe('content')
    closeHoverPopup()
  })

  it('关闭后撤下图片（槽位释放零残留）', () => {
    vi.useFakeTimers()
    const h = imageHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    const req = requestOf(h)
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true, ...IMAGE_RESULT_OK,
    })
    closeHoverPopup()
    expect(popupEl()).toBeNull()
    expect(document.querySelectorAll('img').length).toBe(0)
  })
})

// ---- #343（P3-11）外链原网页形态：page iframe 装配、退回与生命周期 ----
// ---- #343（P3-11）外链原网页形态：page iframe 装配、退回与生命周期 ----

describe('#343 外链原网页形态（page iframe 与退回）', () => {
  type WebPayload = {
    url: string; domain: string; title: string; description: string
    frame?: { embeddable: boolean; reason?: 'denied' | 'http' }
  }
  const respondWeb = (
    req: { reqId: number; instanceId: string },
    web: WebPayload,
  ): void => {
    notifyHoverResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      contentKind: 'web', web,
      target: { fsPath: '', relPath: '' }, version: 0, text: '',
      range: { start: 0, end: 0 }, scope: { kind: 'full' },
    })
  }
  const openWebPopup = (web: WebPayload): Harness => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    respondWeb(requestOf(h), web)
    return h
  }
  const iframeEl = (): HTMLIFrameElement | null =>
    document.querySelector<HTMLIFrameElement>('.vsidian-hover-web-frame')

  it('embeddable=true：挂沙箱 iframe——sandbox 仅 allow-scripts、referrer no-referrer、src=最终 URL；退回按钮与「无法确认」说明在场', () => {
    openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '摘要',
      frame: { embeddable: true },
    })
    const frame = iframeEl()
    expect(frame, 'iframe 在场').not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame!.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame!.getAttribute('src')).toBe('https://example.com/page')
    expect(frame!.getAttribute('allow')).toBeNull()
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')
    expect(btn, '退回卡片按钮在场').not.toBeNull()
    const note = document.querySelector<HTMLElement>('.vsidian-hover-web-note')
    expect(note?.textContent).toBe(zhCn['hover.webPageNote'])
    expect(hoverPopupProbe().state).toBe('content')
    closeHoverPopup()
  })

  it('已知拒绝（denied）：不挂 iframe，卡片 + 真实退回原因行', () => {
    openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '摘要',
      frame: { embeddable: false, reason: 'denied' },
    })
    expect(iframeEl()).toBeNull()
    expect(document.querySelector('.vsidian-hover-web-card')).not.toBeNull()
    const reason = document.querySelector<HTMLElement>('.vsidian-hover-web-reason')
    expect(reason?.textContent).toBe(zhCn['hover.webFrameDenied'])
    closeHoverPopup()
  })

  it('HTTP 混合内容（http）：卡片 + 混合内容原因行', () => {
    openWebPopup({
      url: 'http://example.com/page', domain: 'example.com', title: '', description: '',
      frame: { embeddable: false, reason: 'http' },
    })
    expect(iframeEl()).toBeNull()
    const reason = document.querySelector<HTMLElement>('.vsidian-hover-web-reason')
    expect(reason?.textContent).toBe(zhCn['hover.webFrameHttp'])
    closeHoverPopup()
  })

  it('防御：embeddable=true 但 URL 非 https 不挂 iframe（HTTP 无法安全内嵌的 webview 侧兜底）', () => {
    openWebPopup({
      url: 'http://example.com/page', domain: 'example.com', title: '', description: '',
      frame: { embeddable: true },
    })
    expect(iframeEl()).toBeNull()
    expect(document.querySelector('.vsidian-hover-web-card')).not.toBeNull()
    closeHoverPopup()
  })

  it('手动退回：点击按钮销毁 iframe 换卡片，不发任何设置写出站（不偷偷改形态设置）', () => {
    const h = openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '摘要',
      frame: { embeddable: true },
    })
    const before = h.sent.length
    document.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')!.click()
    expect(iframeEl()).toBeNull()
    const card = document.querySelector<HTMLElement>('.vsidian-hover-web-card')
    expect(card).not.toBeNull()
    expect(card!.querySelector('.vsidian-hover-web-title')!.textContent).toBe('示例站')
    // 退回不产生任何出站消息（含设置写）
    expect(h.sent.length).toBe(before)
    closeHoverPopup()
  })

  it('关闭浮层：iframe 移除且不可信窗口注册清空（消息桥隔离释放）', async () => {
    openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '', description: '',
      frame: { embeddable: true },
    })
    expect(iframeEl()).not.toBeNull()
    expect(untrustedFrameWindowCount()).toBe(1)
    closeHoverPopup()
    expect(iframeEl()).toBeNull()
    expect(untrustedFrameWindowCount()).toBe(0)
  })

  it('换目标重开：旧 iframe 销毁（一次一个浮层的既有语义连带 web 视图）', () => {
    openWebPopup({
      url: 'https://example.com/a', domain: 'example.com', title: '', description: '',
      frame: { embeddable: true },
    })
    const first = iframeEl()
    expect(first).not.toBeNull()
    // 换锚点悬停 → openPopup 先 closeHoverPopup（旧 iframe 随容器销毁）
    const block2 = document.createElement('div')
    const anchor2 = document.createElement('a')
    anchor2.className = 'vsidian-wikilink'
    anchor2.setAttribute('href', '另一目标')
    block2.appendChild(anchor2)
    document.body.appendChild(block2)
    hoverPreviewAnchorEnter(anchor2)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    // 重开过程旧 iframe 随容器销毁（在场元素计数归零）
    expect(untrustedFrameWindowCount()).toBe(0)
    closeHoverPopup()
  })

  describe('设置联动（notifyHoverExternalSettings）', () => {
    it('开关关闭：在场 iframe 销毁、卡片呈现', () => {
      openWebPopup({
        url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '',
        frame: { embeddable: true },
      })
      notifyHoverExternalSettings({ 'hover.externalEnabled': false })
      expect(iframeEl()).toBeNull()
      expect(document.querySelector('.vsidian-hover-web-card')).not.toBeNull()
      expect(untrustedFrameWindowCount()).toBe(0)
      closeHoverPopup()
    })

    it('形态切回 card：iframe 销毁、卡片呈现', () => {
      openWebPopup({
        url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '',
        frame: { embeddable: true },
      })
      notifyHoverExternalSettings({ 'hover.externalShape': 'card' })
      expect(iframeEl()).toBeNull()
      expect(document.querySelector('.vsidian-hover-web-card')).not.toBeNull()
      closeHoverPopup()
    })

    it('无关设置变更 / 开关仍开且形态仍 page：不动在场 iframe', () => {
      openWebPopup({
        url: 'https://example.com/page', domain: 'example.com', title: '', description: '',
        frame: { embeddable: true },
      })
      notifyHoverExternalSettings({ 'hover.externalEnabled': true, 'hover.externalShape': 'page', 'editor.other': 1 })
      expect(iframeEl()).not.toBeNull()
      closeHoverPopup()
    })
  })

  it('退回后的移出边界自愈：DOM 变异丢 mouseleave 时，域外首移按离开收尾关闭', () => {
    vi.useFakeTimers()
    openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '',
      frame: { embeddable: true },
    })
    document.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')!.click()
    expect(hoverPopupProbe().open).toBe(true)
    // Chromium 变异清链后无 mouseleave——模拟直移域外的 mousemove（document 捕获）
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false) // 域外首移触发延迟关闭
    outside.remove()
  })

  it('退回后的移出边界自愈：域内首移不关闭（hover 链重建后交还常规语义）', () => {
    vi.useFakeTimers()
    const h = openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '示例站', description: '',
      frame: { embeddable: true },
    })
    document.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')!.click()
    // 域内移动（目标仍在锚点联合域内）：不触发关闭
    h.anchor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS + 50)
    expect(isHoverPopupOpen()).toBe(true) // 域内首移不关闭
    closeHoverPopup()
  })

  it('装载中开关关闭：迟到的 page 载荷就地退卡片（抑制标记）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    hoverPreviewAnchorEnter(h.anchor)
    vi.advanceTimersByTime(HOVER_POPUP_OPEN_DELAY_MS)
    // loading 中翻转设置（webView 尚未装配）
    notifyHoverExternalSettings({ 'hover.externalEnabled': false })
    respondWeb(requestOf(h), {
      url: 'https://example.com/page', domain: 'example.com', title: '迟到样本', description: '',
      frame: { embeddable: true },
    })
    expect(iframeEl()).toBeNull()
    const card = document.querySelector<HTMLElement>('.vsidian-hover-web-card')
    expect(card?.querySelector('.vsidian-hover-web-title')?.textContent).toBe('迟到样本')
    expect(hoverPopupProbe().state).toBe('content')
    closeHoverPopup()
  })

  it('探针：web 视图观测面（page 形态、sandbox、src、按钮在场；退回后转 card）', () => {
    openWebPopup({
      url: 'https://example.com/page', domain: 'example.com', title: '', description: '',
      frame: { embeddable: true },
    })
    const probe = hoverPopupProbe() as { web?: { shape: string; frameMounted: boolean; sandbox: string; referrerPolicy: string; src: string; fallbackButton: boolean } }
    expect(probe.web).toMatchObject({
      shape: 'page', frameMounted: true, sandbox: 'allow-scripts',
      referrerPolicy: 'no-referrer', src: 'https://example.com/page', fallbackButton: true,
    })
    document.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')!.click()
    const after = hoverPopupProbe() as { web?: { shape: string; frameMounted: boolean } }
    expect(after.web?.shape).toBe('card')
    expect(after.web?.frameMounted).toBe(false)
    closeHoverPopup()
  })
})
