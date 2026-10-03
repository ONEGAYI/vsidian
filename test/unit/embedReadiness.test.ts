// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { EmbedCardManager } from '../../src/webview/embedCard'
import { isWebviewToHost, type WebviewToHost } from '../../src/shared/protocol'
import { liveEmbedReady, mixedEmbedReady, readingEmbedCard } from '../integration/suite/embedReadiness'

const mixedTargets = { parent: 'B 混排', child: '../two/C', descendant: '../three/D' }

it('#246：B/C 已装载但 D 子请求仍在途时，混排链不能提前完成等待', () => {
  const reading = document.createElement('div')
  reading.className = 'vsidian-view-reading'
  document.body.append(reading)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  const sent: WebviewToHost[] = []
  const manager = new EmbedCardManager({
    session: () => ({ sessionId: 'mixed', docUri: 'file:///parent.md' }),
    send: (message) => sent.push(message), maxHeightPx: () => 480, maxDepth: () => 3,
  })
  const reply = (inner: string, target: string, text: string) => {
    const request = sent.find((message) => message.kind === 'hover.request' && message.target === inner)
    expect(request?.kind).toBe('hover.request')
    if (request?.kind !== 'hover.request') throw new Error('递归子请求未生成')
    manager.notifyResult({ kind: 'hover.result', reqId: request.reqId, instanceId: request.instanceId,
      ok: true, target: { fsPath: `/${target}.md`, relPath: `${target}.md` }, version: 1,
      text, range: { start: 0, end: text.length }, scope: { kind: 'full' } })
  }
  try {
    const parent = document.createElement('div')
    reading.append(parent)
    manager.mountCardInto(parent, mixedTargets.parent, 0, 20, 'reading')
    reply(mixedTargets.parent, 'B', '# B\n\n前文 ![[../two/C]] 后文。')
    reply(mixedTargets.child, 'C', '# C\n\n![[../three/D]]')
    expect(manager.probe().map((card) => [card.inner, card.state])).toEqual([
      [mixedTargets.parent, 'content'], [mixedTargets.child, 'content'], [mixedTargets.descendant, 'loading'],
    ])
    expect(mixedEmbedReady({ viewMode: 'reading', readingEmbed: manager.probe() }, mixedTargets)).toBe(false)
    reply(mixedTargets.descendant, 'D', '# D\n\n实际递归正文')
    expect(mixedEmbedReady({ viewMode: 'reading', readingEmbed: manager.probe() }, mixedTargets)).toBe(true)
  } finally {
    manager.dispose()
    reading.remove()
    vi.restoreAllMocks()
  }
})

it('#246：只接受同一 Reading 根的完整链，C 的部分预算分态不放宽 D 的成功要求', () => {
  const card = (inner: string, state = 'content', rootHost = 'reading') =>
    ({ inner, state, rootHost, host: inner === mixedTargets.parent ? rootHost : 'reading', textLen: 10 })
  const parents = [card(mixedTargets.parent), card(mixedTargets.child)]
  const ready = (cards: ReturnType<typeof card>[], viewMode = 'reading') =>
    mixedEmbedReady({ viewMode, readingEmbed: cards }, mixedTargets)
  expect(ready(parents)).toBe(false)
  expect(ready([...parents, card(mixedTargets.descendant, 'loading')])).toBe(false)
  expect(ready([...parents, card(mixedTargets.descendant, 'error')])).toBe(false)
  expect(ready([...parents, card(mixedTargets.descendant)])).toBe(true)
  expect(ready([...parents, card(mixedTargets.descendant)], 'live')).toBe(false)
  expect(ready([...parents, card(mixedTargets.descendant, 'content', 'live')])).toBe(false)
  expect(ready([...parents, card(mixedTargets.descendant, 'content', 'hover')])).toBe(false)
  expect(ready([card(mixedTargets.parent), card(mixedTargets.child, 'error'), card(mixedTargets.descendant)])).toBe(false)
  expect(ready([...parents, card(mixedTargets.child, 'error'), card(mixedTargets.descendant)])).toBe(true)
})

it('#223：三个成功回包先到，缺失目标仍 loading 时不提前完成等待', () => {
  const sent: WebviewToHost[] = []
  const manager = new EmbedCardManager({
    session: () => ({ sessionId: 'test', docUri: 'file:///parent.md' }),
    send: (message) => sent.push(message), maxHeightPx: () => 480,
  })
  try {
    for (let i = 0; i < 4; i++) manager.mountCardInto(document.createElement('div'), `card${i}`, i * 20, i * 20 + 10, 'live')
    const requests = sent.filter((m) => m.kind === 'hover.request')
    for (const req of requests.slice(0, 3)) manager.notifyResult({
      kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `/card${req.reqId}.md`, relPath: 'card.md' }, version: 1,
      text: '# Content', range: { start: 0, end: 9 }, scope: { kind: 'full' },
    })
    expect(manager.probe().map((c) => c.state)).toEqual(['content', 'content', 'content', 'loading'])
    expect(liveEmbedReady({ viewMode: 'live', readingEmbed: manager.probe() })).toBe(false)
    const missing = requests[3]!
    manager.notifyResult({ kind: 'hover.result', reqId: missing.reqId, instanceId: missing.instanceId,
      ok: false, reason: 'not-found' })
    expect(liveEmbedReady({ viewMode: 'live', readingEmbed: manager.probe() })).toBe(true)
  } finally { manager.dispose() }
})

it('#272：悬停递归子卡与正文同目标并存时保留独立归属，不抢占 Reading 采样', () => {
  const popup = document.createElement('div')
  popup.className = 'vsidian-hover-popup'
  const reading = document.createElement('div')
  reading.className = 'vsidian-view-reading'
  document.body.append(popup, reading)
  const manager = new EmbedCardManager({
    session: () => ({ sessionId: 'test', docUri: 'file:///parent.md' }),
    send: () => {}, maxHeightPx: () => 480, maxDepth: () => 3,
  })
  const target = { fsPath: '/B.md', relPath: 'B.md', scope: 'full' as const,
    range: { start: 0, end: 6 }, version: 1, text: '![[C]]' }
  try {
    expect(manager.admitPopupRoot('hover-root', target, target.text.length * 2)).toBe(true)
    const child = document.createElement('div')
    child.dataset['vsidianEmbedInner'] = 'C'
    child.dataset['vsidianSrcStart'] = '0'
    child.dataset['vsidianSrcEnd'] = '6'
    popup.append(child)
    manager.mountPopupChild('hover-root', child, target)
    const main = document.createElement('div')
    reading.append(main)
    manager.mountCardInto(main, 'C', 0, 6, 'reading')
    const cards = manager.probe()
    expect(cards.map((card) => card.rootHost)).toEqual(['hover', 'reading'])
    expect(readingEmbedCard(cards, 'C')).toBe(cards[1])
    const snapshot = { kind: 'view.state', text: '', docLength: 0, lineCount: 1,
      renderedLines: 0, readingEmbed: cards }
    expect(isWebviewToHost(snapshot)).toBe(true)
    expect(isWebviewToHost({ ...snapshot,
      readingEmbed: [{ ...cards[0], rootHost: 'unknown' }] })).toBe(false)
  } finally {
    manager.dispose()
    popup.remove()
    reading.remove()
  }
})

it('#244：Live 根隐藏后，递归 Reading 子卡不能抢占活动 Reading 根的同目标采样', () => {
  const live = document.createElement('div')
  live.className = 'vsidian-view-live'
  const reading = document.createElement('div')
  reading.className = 'vsidian-view-reading'
  document.body.append(live, reading)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.closest('.vsidian-view-live') && live.style.display === 'none') return 0
    return this.classList.contains('vsidian-embed-card-scroll') ? 400 : 0
  })
  const sent: WebviewToHost[] = []
  const manager = new EmbedCardManager({
    session: () => ({ sessionId: 'test', docUri: 'file:///parent.md' }),
    send: (message) => sent.push(message), maxHeightPx: () => 480, maxDepth: () => 3,
  })
  const request = () => [...sent].reverse().find((m) => m.kind === 'hover.request') as Extract<WebviewToHost, { kind: 'hover.request' }>
  const reply = (target: string, text: string, version = 1) => {
    const req = request()
    manager.notifyResult({ kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: true,
      target: { fsPath: `/${target}.md`, relPath: `${target}.md` }, version,
      text, range: { start: 0, end: text.length }, scope: { kind: 'full' } })
  }
  try {
    const liveB = document.createElement('div')
    live.append(liveB)
    manager.mountCardInto(liveB, 'B', 0, 10, 'live')
    reply('B', '# B\n\n![[C]]')
    const readingB = document.createElement('div')
    reading.append(readingB)
    manager.mountCardInto(readingB, 'B', 0, 10, 'reading')
    live.style.display = 'none'
    reply('C', '# C\n\n原段落')
    manager.notifyInvalidated({ fsPath: '/C.md', status: 'changed', generation: 1 })
    reply('C', '# C\n\n原段落\n\n新增段落', 2)
    const cards = manager.probe()
    const duplicates = cards.filter((card) => card.inner === 'C')
    expect(duplicates.map((card) => card.viewStats?.mountedBlocks)).toEqual([0, 3])
    expect(readingEmbedCard(cards, 'C')?.viewStats?.mountedBlocks).toBe(3)
    expect(duplicates.map((card) => card.rootHost)).toEqual(['live', 'reading'])
    expect(cards.filter((card) => card.inner === 'B').map((card) => card.rootHost)).toEqual(['live', 'reading'])
  } finally {
    manager.dispose()
    live.remove()
    reading.remove()
    vi.restoreAllMocks()
  }
})
