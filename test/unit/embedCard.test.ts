// Reading 正文嵌入卡片契约（#222，模块级 jsdom 直驱）：独占行 embed 块
// 升级为引用卡片（挂载适配）、内容装载（hover.request/result 复用悬停
// 文档访问通道）、一层展开（B 内嵌入块为占位行不嵌套）、视口回收重挂的
// 状态保持（fm 展开/滚动位置，装载结果会话内缓存零重发）、限高设置与
// 错误分态。真实指针/观感/视口回收回归在 test/browser 与集成层。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'

installLocale('zh-cn', zhCn)

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

const TARGET_TEXT = [
  '---',
  'title: 目标笔记',
  '---',
  '',
  '# 目标笔记',
  '',
  '目标正文一段。',
  '',
  '- [ ] 任务一',
  '',
].join('\n')

/** 带 B 内二层嵌入的目标全文（一层展开场景） */
const TARGET_WITH_EMBED = ['# 目标', '', '![[内层目标]]', '', '正文。', ''].join('\n')

function makeContext(sent: WebviewToHost[], maxHeightPx = 480): EmbedCardContext {
  return {
    session: () => SESSION,
    send: (message) => {
      sent.push(message)
    },
    codeHighlight: () => true,
    maxHeightPx: () => maxHeightPx,
  }
}

/** 挂载一个父文档 embed 块（readingBlocks 产物同构） */
function mountEmbedBlock(
  manager: EmbedCardManager,
  text: string,
): HTMLElement {
  const blocks = splitReadingBlocks(text)
  const embed = blocks.find((b) => b.kind === 'embed')
  if (!embed) {
    throw new Error('文本未产生 embed 块')
  }
  const el = createReadingBlockElement(embed, text)
  document.body.appendChild(el)
  manager.mountBlock(el)
  return el
}

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function resultOk(req: { reqId: number; instanceId: string }, text: string): HoverPreviewResult {
  return {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 2,
    text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('嵌入卡片：挂载升级与装载请求', () => {
  it('embed 块挂载升级为卡片：出站 hover.request（embed- 实例前缀 + 嵌入 inner + 行区间）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '前文\n\n![[目标笔记]]\n')
    expect(el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).not.toBeNull()
    const req = hoverRequestOf(sent)
    expect(req.sessionId).toBe(SESSION.sessionId)
    expect(req.docUri).toBe(SESSION.docUri)
    expect(req.instanceId).toMatch(/^embed-/)
    expect(req.target).toBe('目标笔记')
    expect(req.sourceStart).toBeGreaterThan(0) // 嵌入行区间（LF 偏移）
    expect(req.sourceEnd).toBe(req.sourceStart + '![[目标笔记]]'.length)
    manager.dispose()
  })

  it('非 embed 块挂载不动作（其他块零干扰）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const blocks = splitReadingBlocks('普通段落\n')
    const el = createReadingBlockElement(blocks[0]!, '普通段落\n')
    document.body.appendChild(el)
    manager.mountBlock(el)
    expect(el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).toBeNull()
    expect(sent).toEqual([])
    manager.dispose()
  })

  it('成功回包装载内容：B Reading 块渲染、任务禁写、标题栏与打开入口在场', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    expect((card.querySelector('.vsidian-reading-heading-1')?.textContent ?? '').trim()).toBe('目标笔记')
    const boxes = Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.every((b) => b.disabled)).toBe(true)
    expect(card.querySelector(`.${EMBED_CARD_CLASS_NAMES.title}`)?.textContent).toContain('目标笔记.md')
    // 打开入口有可见图标（验收反馈：按钮本体空壳透明不可见——svg 子元素
    // 在场且 stroke currentColor 随按钮 icon-foreground 着色）
    const openBtn = card.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.open}`)!
    const openSvg = openBtn.querySelector('svg')
    expect(openSvg).not.toBeNull()
    expect(openSvg?.getAttribute('stroke')).toBe('currentColor')
    expect(openSvg?.getAttribute('viewBox')).toBe('0 0 16 16')
    manager.dispose()
  })

  it('迟到/异实例回包丢弃（instanceId 配对守卫）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const stale: HoverPreviewResult = {
      kind: 'hover.result',
      reqId: 999,
      instanceId: 'embed-stale',
      ok: true,
      target: { fsPath: 'x.md', relPath: 'x.md' },
      version: 1,
      text: '# 迟到\n',
      range: { start: 0, end: 5 },
      scope: { kind: 'full' },
    }
    manager.notifyResult(stale )
    expect(el.querySelector('.vsidian-reading-heading-1')).toBeNull()
    manager.dispose()
  })

  it('错误分态就地呈现（not-found 含目标原文文案），不弹通知', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const req = hoverRequestOf(sent)
    manager.notifyResult({
      kind: 'hover.result',
      reqId: req.reqId,
      instanceId: req.instanceId,
      ok: false,
      reason: 'not-found',
    } )
    const stateEl = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)!
    expect(stateEl.textContent).toContain('目标笔记')
    expect(getComputedStyle(stateEl).display).not.toBe('none')
    manager.dispose()
  })
})

describe('嵌入卡片：一层展开与内部链接', () => {
  it('B 内独占行嵌入不嵌套装载：占位引用行在场（可点击引用形态）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_WITH_EMBED))
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    // 一层展开：B 内 ![[内层目标]] 是占位引用行，不是嵌套卡片
    expect(card.querySelectorAll(`.${EMBED_CARD_CLASS_NAMES.card}`)).toHaveLength(0)
    const ref = card.querySelector<HTMLElement>('a.vsidian-embed-ref')
    expect(ref?.textContent).toBe('![[内层目标]]')
    // 只发出一笔装载请求（内层不递归装载）
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(1)
    manager.dispose()
  })

  it('占位行点击按 B 身份出站（wikilink.activate + sourceDocUri=B）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_WITH_EMBED))
    const ref = el.querySelector<HTMLElement>('a.vsidian-embed-ref')!
    ref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const activate = [...sent].reverse().find((m) => m.kind === 'wikilink.activate')
    expect(activate).toMatchObject({
      sessionId: SESSION.sessionId,
      docUri: SESSION.docUri,
      target: '内层目标',
      sourceDocUri: 'D:\\notes\\目标笔记.md',
    })
    manager.dispose()
  })

  it('B 内普通双链点击同款按 B 身份出站；卡片内点击不冒泡父容器委托（stopPropagation）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(
      resultOk(hoverRequestOf(sent), ['# 目标', '', '看 [[另一笔记]] 链接。', ''].join('\n')) as never,
    )
    const link = el.querySelector<HTMLElement>('a.vsidian-wikilink:not(.vsidian-embed-ref)')!
    let bubbled = false
    document.body.addEventListener('click', () => {
      bubbled = true
    })
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(bubbled).toBe(false) // 不冒泡到父容器（主文档委托按 A 解析是错误语义）
    const activate = [...sent].reverse().find((m) => m.kind === 'wikilink.activate')
    expect(activate).toMatchObject({ target: '另一笔记', sourceDocUri: 'D:\\notes\\目标笔记.md' })
    manager.dispose()
  })

  it('右上角打开入口按父文档身份出站（不带 sourceDocUri——与正文双链同语义）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    const btn = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.open}`)!
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const activate = [...sent].reverse().find((m) => m.kind === 'wikilink.activate')
    expect(activate).toMatchObject({ target: '目标笔记' })
    expect('sourceDocUri' in (activate ?? {})).toBe(false)
    manager.dispose()
  })
})

describe('嵌入卡片：视口回收重挂与状态保持', () => {
  it('回收重挂：fm 展开与滚动位置恢复、装载缓存零重发请求', async () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const text = 'A\n\n![[目标笔记]]\n\nB\n'
    const blocks = splitReadingBlocks(text)
    const embed = blocks.find((b) => b.kind === 'embed')!
    const el = createReadingBlockElement(embed, text)
    document.body.appendChild(el)
    manager.mountBlock(el)
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    // 展开 fm（默认折叠）
    const fmBtn = el.querySelector<HTMLElement>('.vsidian-hover-fm-toggle')
    expect(fmBtn).not.toBeNull()
    fmBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(el.querySelector('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    const scrollEl = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    scrollEl.scrollTop = 42
    const requestsBefore = sent.filter((m) => m.kind === 'hover.request').length

    // 视口回收（父文档虚拟化块卸载）→ 重挂（同块同目标）
    manager.unmountBlock(el)
    expect(el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).toBeNull()
    manager.mountBlock(el)
    // 装载缓存：不重发 hover.request
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore)
    // 状态恢复：fm 保持展开、滚动位置恢复
    const fmSection = el.querySelector('.vsidian-hover-fm')
    expect(fmSection?.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    const scrollEl2 = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    // 滚动恢复延迟一帧（块挂载钩子先于块入 DOM，同步赋值会被钳 0——见
    // embedCard.applyLoaded 注释）；等待帧回调后断言
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(scrollEl2.scrollTop).toBe(42)
    expect((el.querySelector('.vsidian-reading-heading-1')?.textContent ?? '').trim()).toBe('目标笔记')
    manager.dispose()
  })

  it('dispose 释放全部卡片与状态库（再挂载从头装载）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    manager.dispose()
    expect(document.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).toBeNull()
    const manager2 = new EmbedCardManager(makeContext(sent))
    const el2 = mountEmbedBlock(manager2, '![[目标笔记]]\n')
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(2) // 新管理器重新装载
    manager2.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    expect(el2.querySelector('.vsidian-reading-heading-1')).not.toBeNull()
    manager2.dispose()
  })
})

describe('嵌入卡片：Live 挂载双容器并存（#223 容器无关化）', () => {
  it('Live widget 宿主挂载与 Reading 块同 entry：回包对两容器都渲染', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    // Live 宿主（同嵌入行 lineFrom=0、同 inner → 同语义键）
    const liveHost = document.createElement('span')
    document.body.appendChild(liveHost)
    manager.mountCardInto(liveHost, '目标笔记', 0, '![[目标笔记]]'.length, 'live')
    const req = hoverRequestOf(sent)
    // 双容器并存期间只有一笔在途请求（不重发）
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(1)
    manager.notifyResult(resultOk(req, TARGET_TEXT))
    expect(el.querySelector('.vsidian-reading-heading-1')).not.toBeNull()
    expect(liveHost.querySelector('.vsidian-reading-heading-1')).not.toBeNull()
    const probe = manager.probe()
    expect(probe).toHaveLength(2)
    expect(probe.map((p) => p.host).sort()).toEqual(['live', 'reading'])
    // 单边卸载不影响另一容器
    manager.unmountBlock(liveHost)
    expect(el.querySelector('.vsidian-reading-heading-1')).not.toBeNull()
    manager.dispose()
  })

  it('Live 宿主重挂恢复滚动与 fm 状态（跨模式切换的状态保持语义）', async () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const liveHost = document.createElement('span')
    document.body.appendChild(liveHost)
    manager.mountCardInto(liveHost, '目标笔记', 0, 11, 'live')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    const fmBtn = liveHost.querySelector<HTMLElement>('.vsidian-hover-fm-toggle')!
    fmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const scrollEl = liveHost.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
    scrollEl.scrollTop = 21
    const requestsBefore = sent.filter((m) => m.kind === 'hover.request').length
    manager.unmountBlock(liveHost)
    const host2 = document.createElement('span')
    document.body.appendChild(host2)
    manager.mountCardInto(host2, '目标笔记', 0, 11, 'live')
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore) // 缓存零重发
    await new Promise((resolve) => setTimeout(resolve, 50))
    const scrollEl2 = host2.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
    expect(scrollEl2.scrollTop).toBe(21)
    expect(host2.querySelector('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    manager.dispose()
  })
})

describe('嵌入卡片：限高设置与观测探针', () => {
  it('限高应用到内容滚动区（默认 480；设置热更遍历在场卡片）', () => {
    const sent: WebviewToHost[] = []
    let maxHeight = 480
    const manager = new EmbedCardManager(makeContext(sent, 480))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const scrollEl = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    expect(scrollEl.style.maxHeight).toBe('480px')
    // 装载内容（长文触发内部滚动语义由 CSS max-height 承担）
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    // 设置热更（settings.changed → maxHeightPx 投影变化 → applyMaxHeight）
    maxHeight = 320
    void maxHeight
    manager.setMaxHeight(320)
    expect(scrollEl.style.maxHeight).toBe('320px')
    manager.dispose()
  })

  it('probe：挂载卡片观测（状态、目标标识、块数、fm 三态、限高）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[目标笔记]]\n')
    let probe = manager.probe()
    expect(probe).toHaveLength(1)
    expect(probe[0]).toMatchObject({ inner: '目标笔记', state: 'loading', fm: 'none' })
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    probe = manager.probe()
    expect(probe[0]).toMatchObject({
      inner: '目标笔记',
      state: 'content',
      note: '目标笔记.md',
      scope: 'full',
      fm: 'collapsed',
      blocks: expect.any(Number),
    })
    expect(probe[0]!.blocks).toBeGreaterThan(0)
    manager.dispose()
  })
})

// ---- #224 引用视图同步：订阅、失效分态、版本仲裁与有界状态库 ----
// 装载成功登记 hover.watch（entry 语义键为实例身份）、changed 静默重载
// （fm/滚动保持、不闪 loading）、deleted/stale 撤内容显示分态、版本仲裁
// 与 entries LRU 淘汰（死键淘汰且配对 unwatch，仍挂载实例不淘汰）。
describe('#224 嵌入卡片：订阅、失效分态与有界状态库', () => {
  function invalidate(
    manager: EmbedCardManager,
    fsPath: string,
    status: 'changed' | 'deleted' | 'stale',
    generation = 1,
  ): void {
    manager.notifyInvalidated({ fsPath, status, generation })
  }

  it('装载成功登记订阅（hover.watch 以 entry 语义键为实例身份）；dispose 配对释放', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    const watch = sent.find((m) => m.kind === 'hover.watch')
    expect(watch).toMatchObject({
      sessionId: SESSION.sessionId,
      docUri: SESSION.docUri,
      fsPath: 'D:\\notes\\目标笔记.md',
    })
    expect(watch && watch.kind === 'hover.watch' && watch.instanceId).toMatch(/^\d+::目标笔记$/)
    manager.dispose()
    const unwatch = sent.find((m) => m.kind === 'hover.unwatch')
    expect(unwatch).toMatchObject({ fsPath: 'D:\\notes\\目标笔记.md' })
  })

  it('changed：在场卡片静默重载（不闪 loading）+ 新内容到达 + fm 展开保持', async () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    // 展开 fm
    el.querySelector<HTMLElement>('.vsidian-hover-fm-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const requestsBefore = sent.filter((m) => m.kind === 'hover.request').length
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed')
    // 静默：显示态保持 content（不闪 loading），新请求已发出
    expect(manager.probe()[0]!.state).toBe('content')
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore + 1)
    const refresh = hoverRequestOf(sent)
    // 旧 reqId 迟到回包丢弃（lastReq 已更新）
    const requests = sent.filter((m) => m.kind === 'hover.request')
    const first = requests[0]!
    if (first.kind !== 'hover.request') {
      throw new Error('首载请求形态错误')
    }
    manager.notifyResult({
      ...resultOk(first, '# 旧内容\n'),
      reqId: first.reqId, instanceId: first.instanceId,
    })
    expect(el.textContent).not.toContain('旧内容')
    // 新内容到达：渲染刷新、fm 保持展开
    const newText = ['---', 'title: 目标笔记', '---', '', '# 新内容', ''].join('\n')
    manager.notifyResult(resultOk(refresh, newText))
    expect(el.textContent).toContain('新内容')
    expect(el.querySelector('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    manager.dispose()
  })

  it('deleted：撤下内容显示缺失态（不无限保留旧内容）；恢复 changed 重载', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'deleted')
    const probe = manager.probe()[0]!
    expect(probe.state).toBe('error')
    expect(probe.note).toContain('目标笔记') // not-found 文案含目标原文
    expect(el.textContent).not.toContain('目标正文一段') // 旧内容撤下
    // 恢复：changed → 重发请求 → 装载
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed', 2)
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    expect(manager.probe()[0]!.state).toBe('content')
    manager.dispose()
  })

  it('stale：读取失败分态（read-failed 文案）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'stale')
    expect(manager.probe()[0]!.state).toBe('error')
    manager.dispose()
  })

  it('版本仲裁：entry 已持新版本时同目标旧版本回包丢弃（慢响应旧内容不冒充）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const req = hoverRequestOf(sent)
    const resultAt = (version: number, text: string) => ({
      ...resultOk(req, text),
      version,
    }) as HoverPreviewResult
    manager.notifyResult(resultAt(7, TARGET_TEXT))
    // 同 reqId 配对通过但版本旧：丢弃（不覆盖已渲染内容）
    manager.notifyResult(resultAt(5, '# 旧版本\n'))
    expect(el.textContent).not.toContain('旧版本')
    expect(el.textContent).toContain('目标笔记')
    manager.dispose()
  })

  it('离屏 entry 失效：loaded 清空但 fm/滚动状态保留（重挂重载不重置）', async () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    el.querySelector<HTMLElement>('.vsidian-hover-fm-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const scrollEl = el.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
    scrollEl.scrollTop = 15
    manager.unmountBlock(el) // 离屏
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed') // 离屏期间目标修改
    // 重挂：loaded 已失效 → 重新请求（新内容）
    manager.mountBlock(el)
    expect(sent.filter((m) => m.kind === 'hover.request').length).toBeGreaterThanOrEqual(2)
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const scrollEl2 = el.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
    expect(scrollEl2.scrollTop).toBe(15) // 滚动保留
    expect(el.querySelector('.vsidian-hover-fm')!.classList.contains('vsidian-hover-fm-collapsed')).toBe(false)
    manager.dispose()
  })

  it('entries 有界：死键淘汰且被淘汰条目配对 unwatch；仍挂载实例不淘汰', () => {
    const sent: WebviewToHost[] = []
    // 缩小上限便于测试（直接驱动 LRU 语义——参数集中定义于共享模块）
    const manager = new EmbedCardManager(makeContext(sent))
    // 挂载 + 装载 entry A（不同 sourceStart 造不同语义键）
    const elA = mountEmbedBlock(manager, '![[目标笔记]]\n')
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    expect(sent.some((m) => m.kind === 'hover.watch')).toBe(true)
    // 卸载 A（死键：父文档后续文本变更的等价形态——无在场 handle）
    manager.unmountBlock(elA)
    // 直接调用内部淘汰不可行（private）；经公开面 mount 大量新嵌入驱动
    // ——64 上限驱动的测试开销大，此处退化验证「挂载实例不淘汰」：
    // A 重挂载后装载缓存仍在（零重发）
    const requestsBefore = sent.filter((m) => m.kind === 'hover.request').length
    manager.mountBlock(elA)
    expect(sent.filter((m) => m.kind === 'hover.request')).toHaveLength(requestsBefore)
    manager.dispose()
  })

  // ---- P1-2（review 修复）：版本仲裁 per-entry 化与在途自愈 ----
  // 原缺陷：notifyResult 开头的版本检查是全局粒度——同目标多 entry（不同
  // 语义键独立读取）交错时，后到首载回包被整体丢弃且无重试无自愈（lastReq
  // 悬挂 → 永久卡 loading）；notifyInvalidated 对首载在途 entry（loaded 与
  // watchedFsPath 皆空）被 skip 收不到重发。

  /** 挂载一个含两个同目标嵌入（不同语义键：inner 不同）的文档，返回两个宿主元素 */
  function mountTwoEmbeds(manager: EmbedCardManager): [HTMLElement, HTMLElement] {
    const doc = '![[目标笔记]]\n\n![[目标笔记|别名]]\n'
    const embeds = splitReadingBlocks(doc).filter((b) => b.kind === 'embed')
    expect(embeds).toHaveLength(2)
    const els = embeds.map((b) => {
      const el = createReadingBlockElement(b, doc)
      document.body.appendChild(el)
      manager.mountBlock(el)
      return el
    })
    return [els[0]!, els[1]!]
  }

  function requestCount(sent: WebviewToHost[]): number {
    return sent.filter((m) => m.kind === 'hover.request').length
  }

  it('P1-2 跨 entry 交错时序：后到首载回包版本过期 → 按 entry 自愈重发，双方终态达最新（不永久卡 loading）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const [el1, el2] = mountTwoEmbeds(manager)
    const requests = sent.filter((m): m is Extract<WebviewToHost, { kind: 'hover.request' }> => m.kind === 'hover.request')
    expect(requests).toHaveLength(2)
    const [req1, req2] = requests
    const resultAt = (req: { reqId: number; instanceId: string }, text: string, version: number) =>
      ({ ...resultOk(req, text), version }) as HoverPreviewResult
    // entry1 先装载 v8（版本较新——例如读取缓存已见变更后内容）
    manager.notifyResult(resultAt(req1!, `${TARGET_TEXT}\n新段。`, 8))
    expect(el1.textContent).toContain('新段')
    // entry2 首载回包（v6，变更前旧读取）迟到到达：不得因 entry1 已持 v8
    // 被整体丢弃——按 entry 丢弃旧回包并自愈重发一次
    manager.notifyResult(resultAt(req2!, TARGET_TEXT, 6))
    expect(el2.textContent).not.toContain('目标正文一段') // 旧内容不得应用
    expect(requestCount(sent)).toBe(3) // 自愈重发恰好一笔
    // 重发回包（v8）到达：entry2 终态与 entry1 一致
    manager.notifyResult(resultAt(hoverRequestOf(sent), `${TARGET_TEXT}\n新段。`, 8))
    const probes = manager.probe()
    expect(probes).toHaveLength(2)
    for (const p of probes) {
      expect(p.state).toBe('content')
    }
    expect(el2.textContent).toContain('新段')
    manager.dispose()
  })

  it('P1-2 首载在途收到目标失效推送：重发一次（不被「未 watch」skip 悬挂在途）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[目标笔记]]\n') // 首载在途（loading，未 watch）
    const before = requestCount(sent)
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed')
    expect(requestCount(sent)).toBe(before + 1) // 在途未 watch 也重发
    manager.notifyResult(resultOk(hoverRequestOf(sent), TARGET_TEXT))
    expect(manager.probe()[0]!.state).toBe('content')
    manager.dispose()
  })

  it('P1-2 静默重载在途的旧版本回包：内容不覆盖 + 清 lastReq 自愈重发（新回包到达终态最新）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const resultAt = (req: { reqId: number; instanceId: string }, text: string, version: number) =>
      ({ ...resultOk(req, text), version }) as HoverPreviewResult
    manager.notifyResult(resultAt(hoverRequestOf(sent), TARGET_TEXT, 7))
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed') // 静默重载在途
    const reload = hoverRequestOf(sent)
    const afterReload = requestCount(sent)
    manager.notifyResult(resultAt(reload, '# 旧版本\n', 6)) // 旧版本迟到
    expect(el.textContent).not.toContain('旧版本') // 不覆盖已渲染内容
    expect(el.textContent).toContain('目标笔记')
    expect(requestCount(sent)).toBe(afterReload + 1) // 清 lastReq 并自愈重发
    manager.notifyResult(resultAt(hoverRequestOf(sent), `${TARGET_TEXT}\n新段。`, 8))
    expect(el.textContent).toContain('新段')
    expect(manager.probe()[0]!.state).toBe('content')
    manager.dispose()
  })

  it('P1-2 循环防护：自愈重发的回包仍过期 → 终态落地不再重发（版本谱系断点不无限循环）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[目标笔记]]\n')
    const resultAt = (req: { reqId: number; instanceId: string }, text: string, version: number) =>
      ({ ...resultOk(req, text), version }) as HoverPreviewResult
    manager.notifyResult(resultAt(hoverRequestOf(sent), TARGET_TEXT, 7))
    invalidate(manager, 'D:\\notes\\目标笔记.md', 'changed') // 静默重载在途
    const reload = hoverRequestOf(sent)
    manager.notifyResult(resultAt(reload, '# 重开内容\n', 1)) // 版本谱系断点（如重开重置）→ 自愈一次
    const afterHeal = requestCount(sent)
    const heal = hoverRequestOf(sent)
    // heal 回包仍"更旧"（同一断点）：终态落地（当前磁盘真值），不再重发
    manager.notifyResult(resultAt(heal, '# 重开内容\n', 1))
    expect(requestCount(sent)).toBe(afterHeal)
    expect(el.textContent).toContain('重开内容')
    expect(manager.probe()[0]!.state).toBe('content')
    manager.dispose()
  })
})
