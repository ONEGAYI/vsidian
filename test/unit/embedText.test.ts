// 可读文本嵌入契约（#341 / P3-09，jsdom 直驱 EmbedCardManager）：text
// 载荷在嵌入卡片的装载渲染（视图/行号/窗口/预算）、只读边界（零编辑端口、
// 模式按钮隐藏）、卸载在途缓存与回收、changed 失效静默重载、appearance
// 广播重载、token 请求/配对/版本竞态、同目标多实例滚动独立。真实指针/
// 观感/视口回收回归在 test/browser（textEmbed 套件）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { TEXT_VIEW_CLASS_NAMES } from '../../src/webview/textRefView'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'

installLocale('zh-cn', zhCn)

// jsdom 无布局：给卡片滚动区一个可见高度（与 embedCard.test.ts 同款口径），
// 使虚拟化窗口的计算有真实视口可依。
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

const CODE_TEXT = 'const alpha = 1;\nconst bravo = 2;\nconst charlie = 3'

function makeContext(sent: WebviewToHost[]): EmbedCardContext {
  return {
    session: () => SESSION,
    send: (message) => {
      sent.push(message)
    },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
  }
}

function mountEmbedBlock(manager: EmbedCardManager, text: string): HTMLElement {
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

type TextNavOverrides = Record<string, unknown>

/** text 成功回包（与宿主 textEditorProvider 出站形态一致） */
function textResultOk(
  req: { reqId: number; instanceId: string },
  text: string,
  nav: TextNavOverrides = {},
): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    contentKind: 'text',
    target: { fsPath: 'D:\\notes\\a.txt', relPath: 'a.txt' },
    version: 5,
    text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' },
    textNav: {
      languageId: 'typescript', hasWindow: false, beginLine: 1, endLine: 3,
      locateLine: 1, jumpLine: 1, totalLines: 3, lineNumbers: true,
      ...nav,
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('嵌入卡片：text 装载与视图', () => {
  it('text 载荷渲染：文本视图在场（行号绝对行）、content 态、标题为目标路径', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    expect(card.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    const gutters = card.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.gutterLine}`)
    expect([...gutters].map((g) => g.textContent)).toEqual(['1', '2', '3'])
    expect(card.querySelector(`.${EMBED_CARD_CLASS_NAMES.title}`)?.textContent).toContain('a.txt')
    const stateEl = card.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)!
    expect(stateEl.style.display).toBe('none')
    // 装载成功登记订阅（版本同步生命周期同 markdown 通道）
    const watch = sent.find((m) => m.kind === 'hover.watch')
    expect(watch).toBeDefined()
    manager.dispose()
  })

  it('range 硬窗口：行号从 beginLine 起算，窗口外不产生 DOM', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt#range=10-11]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), 'bravo line\ncharlie line', {
      hasWindow: true, beginLine: 10, endLine: 11, locateLine: 10, totalLines: 40,
    }))
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    const gutters = card.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.gutterLine}`)
    expect([...gutters].map((g) => g.textContent)).toEqual(['10', '11'])
    expect(card.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line}`).length).toBe(2)
    manager.dispose()
  })

  it('长文 DOM 常驻受视口约束（探针 textStats：渲染行数远小于总行数）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[a.txt]]\n')
    const longText = Array.from({ length: 400 }, (_, i) => `const field${i} = ${i};`).join('\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), longText, { endLine: 400, totalLines: 400 }))
    const probe = manager.probe().find((p) => p.inner.includes('a.txt'))
    expect(probe?.state).toBe('content')
    expect(probe?.textStats).not.toBeNull()
    expect(probe!.textStats!.totalLines).toBe(400)
    expect(probe!.textStats!.renderedLines).toBeLessThan(60)
    expect(probe!.textStats!.renderedLines).toBeGreaterThan(0)
    manager.dispose()
  })
})

describe('嵌入卡片：text 只读边界', () => {
  it('text 装载不建编辑端口：零 refEdit.bind、模式按钮隐藏、内部模式恒 reading', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    expect(sent.some((m) => m.kind === 'refEdit.bind')).toBe(false)
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    const modeBtn = card.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.mode}`)!
    expect(modeBtn.style.display).toBe('none')
    const probe = manager.probe().find((p) => p.inner.includes('a.txt'))
    expect(probe?.internalMode).toBe('reading')
    expect(probe?.liveBound).toBe(false)
    manager.dispose()
  })

  it('父面板切 Live 不给 text 卡建端口（跟随模式被只读边界拦截）', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager({
      ...makeContext(sent),
      parentMode: () => 'live',
    })
    mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    manager.notifyParentModeChanged()
    expect(sent.some((m) => m.kind === 'refEdit.bind')).toBe(false)
    const probe = manager.probe().find((p) => p.inner.includes('a.txt'))
    expect(probe?.internalMode).toBe('reading')
    manager.dispose()
  })
})

describe('嵌入卡片：text 失效与外观广播', () => {
  it('deleted 撤旧、恢复 changed 重载：stale 不冒充删除、内容不复活旧版本', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    // 删除：撤下内容、就地错误分态（不无限保留旧正文）
    manager.notifyInvalidated({ fsPath: 'D:\\notes\\a.txt', status: 'deleted', generation: 1 })
    const stateEl = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)!
    expect(stateEl.style.display).toBe('')
    expect(stateEl.textContent).toContain('目标不存在')
    expect(stateEl.textContent).toContain('a.txt')
    expect(el.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).toBeNull()
    const probeAfterDelete = manager.probe().find((p) => p.inner.includes('a.txt'))
    expect(probeAfterDelete?.state).toBe('error')
    // 恢复（changed 推送）：静默重发，回包重建内容态
    const before = sent.length
    manager.notifyInvalidated({ fsPath: 'D:\\notes\\a.txt', status: 'changed', generation: 2 })
    const reload = [...sent.slice(before)].reverse().find((m) => m.kind === 'hover.request')
    expect(reload).toBeDefined()
    if (reload?.kind === 'hover.request') {
      manager.notifyResult(textResultOk(reload, 'const restored = 1;', { endLine: 1, totalLines: 1 }))
    }
    expect(el.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    expect(el.querySelector(`.${TEXT_VIEW_CLASS_NAMES.line}`)?.textContent).toContain('restored')
    manager.dispose()
  })

  it('changed 失效：静默重发（anchorOptional + retainSource），旧内容在场不闪 loading', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    const before = sent.length
    manager.notifyInvalidated({ fsPath: 'D:\\notes\\a.txt', status: 'changed', generation: 1 })
    const reload = [...sent.slice(before)].reverse().find((m) => m.kind === 'hover.request')
    expect(reload).toBeDefined()
    if (reload?.kind === 'hover.request') {
      expect(reload.anchorOptional).toBe(true)
      expect(reload.retainSource).toBe(true)
    }
    const stateEl = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.state}`)!
    expect(stateEl.style.display).toBe('none') // 不闪 loading
    const card = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    expect(card.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull() // 旧内容保留
    manager.dispose()
  })

  it('appearance.changed：在场 text 卡静默重载；markdown 卡不受影响', () => {    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const textEl = mountEmbedBlock(manager, '![[a.txt]]\n')
    const textReq = hoverRequestOf(sent)
    manager.notifyResult(textResultOk(textReq, CODE_TEXT))
    // 同面板再挂一张 markdown 卡（对照：不消费外观广播）
    const mdEl = mountEmbedBlock(manager, '![[b.md]]\n')
    const mdReq = hoverRequestOf(sent)
    manager.notifyResult({
      kind: 'hover.result', reqId: mdReq.reqId, instanceId: mdReq.instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\b.md', relPath: 'b.md' }, version: 2,
      text: '# B 标题\n', range: { start: 0, end: 8 }, scope: { kind: 'full' },
    })
    const before = sent.length
    manager.notifyAppearanceChanged()
    const reloads = sent.slice(before).filter((m) => m.kind === 'hover.request')
    expect(reloads.length).toBe(1) // 仅 text 卡重发
    if (reloads[0]?.kind === 'hover.request') {
      expect(reloads[0].target).toBe('a.txt')
      expect(reloads[0].anchorOptional).toBe(true)
    }
    expect(mdEl.querySelector('.vsidian-reading-heading-1')).not.toBeNull()
    expect(textEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    manager.dispose()
  })
})

describe('嵌入卡片：text token 管线', () => {
  it('装载后 token 请求出站（hostId 身份 + 窗口配对），notifyTokens 应用着色', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[a.txt]]\n')
    const req = hoverRequestOf(sent)
    manager.notifyResult(textResultOk(req, 'const alpha = 1;', { endLine: 1 }))
    const tokenReq = [...sent].reverse().find((m) => m.kind === 'hover.tokens.request')
    expect(tokenReq).toBeDefined()
    if (tokenReq?.kind === 'hover.tokens.request') {
      // instanceId = 稳定宿主身份（hostId——与 hover.request 的 occurrenceId 同源）
      expect(tokenReq.instanceId).toBe(req.occurrenceId)
      expect(tokenReq.fsPath).toBe('D:\\notes\\a.txt')
      expect(tokenReq.version).toBe(5)
      expect(tokenReq.beginLine).toBe(1)
      expect(tokenReq.endLine).toBe(1)
      // 着色应用（内联计算色）
      expect(manager.notifyTokens({
        instanceId: tokenReq.instanceId, reqId: tokenReq.reqId, ok: true,
        layer: 'textmate', version: 5, colors: ['#569cd6', '#9cdcfe'],
        tokens: [0, 0, 5, 0, 0, 0, 6, 5, 1, 0],
      })).toBe(true)
      const span = document.querySelector<HTMLElement>(`.${TEXT_VIEW_CLASS_NAMES.line} span`)
      expect(span?.textContent).toBe('const')
      expect(span?.style.color).toContain('86, 156, 214')
    }
    manager.dispose()
  })

  it('过期 token 不覆盖（版本仲裁）；异实例不消费', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    mountEmbedBlock(manager, '![[a.txt]]\n')
    const req = hoverRequestOf(sent)
    manager.notifyResult(textResultOk(req, 'const alpha = 1;', { endLine: 1 }))
    // 版本 4 < 装载 5：配对成功但不应用（迟到/过期 token 不覆盖新正文）
    expect(manager.notifyTokens({
      instanceId: req.occurrenceId!, reqId: 1, ok: true,
      layer: 'textmate', version: 4, colors: ['#ff0000'], tokens: [0, 0, 5, 0, 0],
    })).toBe(true)
    const span = document.querySelector<HTMLElement>(`.${TEXT_VIEW_CLASS_NAMES.line} span`)
    expect(span?.style.color ?? '').toBe('') // 版本 4 < 装载 5：不覆盖
    expect(manager.notifyTokens({
      instanceId: 'embed-occ-unknown', reqId: 2, ok: true,
      layer: 'textmate', version: 5, colors: ['#ff0000'], tokens: [0, 0, 5, 0, 0],
    })).toBe(false) // 异实例整体不消费
    manager.dispose()
  })
})

describe('嵌入卡片：text 回收与缓存', () => {
  it('卸载在途回包写入缓存：重挂零新请求直接渲染 text', () => {    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    const req = hoverRequestOf(sent)
    manager.unmountBlock(el)
    const before = sent.length
    manager.notifyResult(textResultOk(req, CODE_TEXT)) // 卸载后在途回包
    // 缓存写入登记目标订阅（#222 既有生命周期：装载即 watch，缓存态下
    // 失效推送仍可达——重挂不复活陈旧快照）；除此之外零新出站
    const afterInFlight = sent.slice(before)
    expect(afterInFlight.map((m) => m.kind)).toEqual(['hover.watch'])
    // 重挂：装载缓存直接渲染——零新 hover.request（内容读取走缓存）；
    // 仅一次 hover.tokens.request（新视图实例重取着色，token 非正文副本
    // ——#341「不为各容器复制高亮」的 token 侧表达：重挂重取、不共享 span）
    const again = mountEmbedBlock(manager, '![[a.txt]]\n')
    const afterRemount = sent.slice(before + 1)
    expect(afterRemount.map((m) => m.kind)).toEqual(['hover.tokens.request'])
    expect(again.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    manager.dispose()
  })

  it('卸载回收：卡片 DOM 与文本视图撤下', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[a.txt]]\n')
    manager.notifyResult(textResultOk(hoverRequestOf(sent), CODE_TEXT))
    expect(el.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    manager.unmountBlock(el)
    expect(el.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).toBeNull()
    expect(el.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`)).toBeNull()
    expect(manager.probe().length).toBe(0)
    manager.dispose()
  })

  it('同目标两实例滚动独立：卸载重挂各自恢复，互不串用', async () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const longText = Array.from({ length: 120 }, (_, i) => `const field${i} = ${i};`).join('\n')
    const nav = { endLine: 120, totalLines: 120 }
    const first = mountEmbedBlock(manager, '一号位\n\n![[a.txt]]\n')
    const firstReq = hoverRequestOf(sent)
    const second = mountEmbedBlock(manager, '另一处更远的二号位段落\n\n![[a.txt]]\n')
    const secondReq = hoverRequestOf(sent)
    expect(secondReq.reqId).not.toBe(firstReq.reqId)
    manager.notifyResult(textResultOk(firstReq, longText, nav))
    manager.notifyResult(textResultOk(secondReq, longText, nav))
    const scrollA = first.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    const scrollB = second.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    scrollA.scrollTop = 400
    scrollB.scrollTop = 80
    // 卸载两卡（occurrence 滚动状态保存）；重挂后各自恢复
    manager.unmountBlock(first)
    manager.unmountBlock(second)
    const againA = mountEmbedBlock(manager, '一号位\n\n![[a.txt]]\n')
    const againB = mountEmbedBlock(manager, '另一处更远的二号位段落\n\n![[a.txt]]\n')
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const againScrollA = againA.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    const againScrollB = againB.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`)!
    expect(againScrollA.scrollTop).toBe(400)
    expect(againScrollB.scrollTop).toBe(80)
    manager.dispose()
  })
})

describe('嵌入卡片：text 容器矩阵（混排与递归引用）', () => {
  /** 混排宿主挂载（列表/引用块内占位提升——#246 通道，text 目标同路径） */
  function mountMixedBlock(manager: EmbedCardManager, text: string, kind: 'list' | 'blockquote'): HTMLElement {
    const blocks = splitReadingBlocks(text)
    const block = blocks.find((b) => b.kind === kind)
    if (!block) {
      throw new Error(`文本未产生 ${kind} 块`)
    }
    const el = createReadingBlockElement(block, text)
    document.body.appendChild(el)
    manager.mountBlock(el)
    return el
  }

  it('列表/引用混排 text 嵌入：占位提升为卡片宿主，同一文本视图渲染', () => {
    for (const text of ['- 项 ![[a.txt]] 余', '> 引 ![[a.txt]] 文']) {
      const sent: WebviewToHost[] = []
      const manager = new EmbedCardManager({
        ...makeContext(sent),
        sourceText: () => text,
      })
      const kind = text.startsWith('-') ? 'list' : 'blockquote'
      const el = mountMixedBlock(manager, text, kind as 'list' | 'blockquote')
      const host = el.querySelector<HTMLElement>('.vsidian-reading-embed-mixed')!
      expect(host, text).not.toBeNull()
      expect(host.querySelector(`.${EMBED_CARD_CLASS_NAMES.card}`), text).not.toBeNull()
      const req = hoverRequestOf(sent)
      expect(req.target, text).toBe('a.txt')
      manager.notifyResult(textResultOk(req, CODE_TEXT))
      expect(host.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`), text).not.toBeNull()
      const gutters = host.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.gutterLine}`)
      expect([...gutters].map((g) => g.textContent), text).toEqual(['1', '2', '3'])
      manager.dispose()
      document.body.innerHTML = ''
    }
  })

  it('递归引用：markdown B 内 text 嵌入按子来源请求，text 视图嵌套渲染', () => {
    const sent: WebviewToHost[] = []
    const manager = new EmbedCardManager(makeContext(sent))
    const el = mountEmbedBlock(manager, '![[b.md]]\n')
    const bReq = hoverRequestOf(sent)
    expect(bReq.occurrenceId).toBeDefined()
    // B 为 markdown（内含 text 嵌入）——子块挂载触发子来源请求
    const bText = '# B 标题\n\n![[a.txt]]\n\nB 正文。\n'
    manager.notifyResult({
      kind: 'hover.result', reqId: bReq.reqId, instanceId: bReq.instanceId, ok: true,
      target: { fsPath: 'D:\\notes\\b.md', relPath: 'b.md' }, version: 2,
      text: bText, range: { start: 0, end: bText.length }, scope: { kind: 'full' },
      sourceLeaseId: 'lease-b', depth: 1, expansionPath: ['A', 'B'],
    })
    const childReq = [...sent].reverse().find((m) => m.kind === 'hover.request')!
    expect(childReq.target).toBe('a.txt')
    expect(childReq.source).toEqual({
      parentInstanceId: bReq.occurrenceId,
      sourceDocUri: 'D:\\notes\\b.md',
    })
    manager.notifyResult(textResultOk(childReq as { reqId: number; instanceId: string }, CODE_TEXT))
    // 子 text 卡嵌套在 B 卡内，文本视图渲染（不为容器复制正文副本——同一
    // TextRefView 渲染管线）
    const parentCard = el.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.card}`)!
    const childCards = parentCard.querySelectorAll(`.${EMBED_CARD_CLASS_NAMES.card}`)
    expect(childCards.length).toBe(1)
    expect(parentCard.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).not.toBeNull()
    const probe = manager.probe().find((p) => p.inner === 'a.txt')
    expect(probe?.textStats).toMatchObject({ renderedLines: 3, totalLines: 3 })
    manager.dispose()
  })
})

