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
    expect(card.querySelector(`.${EMBED_CARD_CLASS_NAMES.open}`)).not.toBeNull()
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
  it('回收重挂：fm 展开与滚动位置恢复、装载缓存零重发请求', () => {
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
