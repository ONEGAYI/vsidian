// 双链联想候选浏览器回归（#376 T01 + #378 T03 + #379 T04）：装配生产
// webview 控制器（联想会话随主实例扩展进入，键位于 fenceEscape 之前），
// 按键只由浏览器键盘/CDP IME 发起。宿主侧由夹具扮演：读取出站的
// wikilink.query / wikilink.heading.query 并回灌对应 result（reqId/
// generation 原样回显，与真实宿主应答同构）。光标定位经 view.locate
// 消息走生产链路。与 symbolInputFixture 同口径。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorSelection } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import type { WebviewToHost, WikilinkBlockItem, WikilinkCandidateItem, WikilinkHeadingItem } from '../../src/shared/protocol'
import '../../src/webview/main.css'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'

bootLocaleFromDocument()

const hostMessages: unknown[] = []
/** 宿主 ack 扮演开关（F3 场景模拟「前一笔 ack 往返慢」的暂缓窗口） */
let autoAck = true
/** 已确认的 edit.request seq（自动 ack 与补发 ack 共享去重） */
const ackedSeqs = new Set<number>()
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
    // 宿主扮演：edit.request 即时 ack（F3——生产宿主应用编辑后立即确认，
    // unconfirmed 推进、暂缓链收敛；fixture 缺省不 ack 会让连续键入全部
    // 暂缓且永不清空，无 ID 块接受的未出站核对恒触发）
    const req = message as Extract<WebviewToHost, { kind: 'edit.request' }>
    if ((message as { kind?: string }).kind === 'edit.request' && controller && autoAck) {
      ackedSeqs.add(req.seq)
      ackVersion += 1
      queueMicrotask(() => {
        controller.handleHostMessage({
          kind: 'edit.ack', seq: req.seq, ok: true, version: ackVersion,
        } as Parameters<typeof controller.handleHostMessage>[0])
      })
    }
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** ack 扮演的版本计数（init 后每笔编辑 +1——与生产宿主节奏同构） */
let ackVersion = 1

const POPUP = '.vsidian-wikilink-suggest'
const ITEM = '.vsidian-wikilink-suggest-item'
const ITEM_ACTIVE = '.vsidian-wikilink-suggest-item-active'
const STATUS = '.vsidian-wikilink-suggest-status'

const lastQuery = (): Extract<WebviewToHost, { kind: 'wikilink.query' }> | undefined =>
  [...hostMessages].reverse().find((m) => (m as { kind?: string }).kind === 'wikilink.query') as
    Extract<WebviewToHost, { kind: 'wikilink.query' }> | undefined

/** #379 T04：最新标题查询出站 */
const lastHeadingQuery = (): Extract<WebviewToHost, { kind: 'wikilink.heading.query' }> | undefined =>
  [...hostMessages].reverse().find((m) => (m as { kind?: string }).kind === 'wikilink.heading.query') as
    Extract<WebviewToHost, { kind: 'wikilink.heading.query' }> | undefined

/** #380 T05：最新块查询出站 */
const lastBlockQueryRef = (): Extract<WebviewToHost, { kind: 'wikilink.block.query' }> | undefined =>
  [...hostMessages].reverse().find((m) => (m as { kind?: string }).kind === 'wikilink.block.query') as
    Extract<WebviewToHost, { kind: 'wikilink.block.query' }> | undefined

/** #380 T05：最新无 ID 块接受出站 */
const lastBlockAcceptRef = (): Extract<WebviewToHost, { kind: 'wikilink.block.accept' }> | undefined =>
  [...hostMessages].reverse().find((m) => (m as { kind?: string }).kind === 'wikilink.block.accept') as
    Extract<WebviewToHost, { kind: 'wikilink.block.accept' }> | undefined

Object.assign(window, {
  /** 宿主 ack 扮演开关（F3 场景：关闭以模拟「前一笔 ack 往返慢」——
   *  连续键入的后续笔进入暂缓集（宿主收不到），构成未出站窗口） */
  setAutoAck(enabled: boolean) {
    autoAck = enabled
  },
  /** 补发窗口内积压的 edit.request 确认（F3 场景：模拟 ack 往返完成。
   *  暂缓集出站产生的新请求由 autoAck 兜底——恢复 true 后链式收敛） */
  ackPendingEdits() {
    for (const m of [...hostMessages]) {
      const req = m as Extract<WebviewToHost, { kind: 'edit.request' }>
      if ((m as { kind?: string }).kind !== 'edit.request' || ackedSeqs.has(req.seq)) {
        continue
      }
      ackedSeqs.add(req.seq)
      ackVersion += 1
      controller.handleHostMessage({
        kind: 'edit.ack', seq: req.seq, ok: true, version: ackVersion,
      } as Parameters<typeof controller.handleHostMessage>[0])
    }
  },
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'wikilink-suggest',
      docUri: 'file:///vault/%E9%A1%B9%E7%9B%AE/%E8%AE%B0%E5%BD%95.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  lastQuery,
  lastHeadingQuery,
  queryCount() {
    return hostMessages.filter((m) => (m as { kind?: string }).kind === 'wikilink.query').length
  },
  headingQueryCount() {
    return hostMessages.filter((m) => (m as { kind?: string }).kind === 'wikilink.heading.query').length
  },
  /** 以最新出站标题查询回灌应答（宿主扮演，#379 T04） */
  respondHeadingQuery(items: WikilinkHeadingItem[]) {
    const q = lastHeadingQuery()
    if (!q) throw new Error('缺少待应答的 wikilink.heading.query')
    controller.handleHostMessage({
      kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'ready',
      targetVersion: 1, items,
    })
  },
  respondHeadingUnavailable(reason: 'no-workspace' | 'target-not-found' | 'target-not-md' | 'read-error') {
    const q = lastHeadingQuery()
    if (!q) throw new Error('缺少待应答的 wikilink.heading.query')
    controller.handleHostMessage({
      kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'unavailable', reason,
    })
  },
  /** 读取 toast 面当前可见文本与严重级（#379 T04 重名提示断言） */
  readToast() {
    const el = document.querySelector<HTMLElement>('.vsidian-toast')
    return el ? { text: el.textContent ?? '', severity: el.dataset['severity'] ?? '' } : null
  },
  /** 以最新出站查询的 reqId/generation 回灌应答（宿主扮演）。#377 T02 起
   *  opts 可指定 total（命中总数——分页 more 状态）与 catalogGen（清单
   *  代次——跨代次追加页守卫） */
  respondQuery(
    items: WikilinkCandidateItem[],
    opts: { updating?: boolean; total?: number; catalogGen?: number } = {},
  ) {
    const q = lastQuery()
    if (!q) throw new Error('缺少待应答的 wikilink.query')
    controller.handleHostMessage({
      kind: 'wikilink.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'ready',
      updating: opts.updating === true, total: opts.total ?? items.length, items,
      ...(opts.catalogGen !== undefined ? { catalogGen: opts.catalogGen } : {}),
    })
  },
  respondUnavailable(reason: 'no-workspace' | 'not-ready') {
    const q = lastQuery()
    if (!q) throw new Error('缺少待应答的 wikilink.query')
    controller.handleHostMessage({
      kind: 'wikilink.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'unavailable', reason,
    })
  },
  /** 伪造迟到帧（任意 reqId/generation）：验证守卫拒收 */
  respondStale(reqId: number, generation: number, items: WikilinkCandidateItem[]) {
    const q = lastQuery()
    if (!q) throw new Error('缺少待应答的 wikilink.query')
    controller.handleHostMessage({
      kind: 'wikilink.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId, generation, status: 'ready', updating: false, total: items.length, items,
    })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from,
      to: main.to,
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })) }
  },
  readPopup() {
    const el = document.querySelector<HTMLElement>(POPUP)
    if (!el) {
      return { open: false }
    }
    const items = [...el.querySelectorAll<HTMLElement>(ITEM)]
    const active = el.querySelector<HTMLElement>(ITEM_ACTIVE)
    const status = el.querySelector<HTMLElement>(STATUS)
    return {
      open: el.style.display !== 'none',
      itemCount: items.length,
      activeIndex: active ? items.indexOf(active) : null,
      activeText: active?.textContent ?? null,
      statusText: status?.textContent ?? null,
      names: items.map((i) => i.querySelector('.vsidian-wikilink-suggest-name')?.textContent ?? ''),
      dirs: items.map((i) => i.querySelector('.vsidian-wikilink-suggest-dir')?.textContent ?? null),
    }
  },
  /** #380 T05：最新块查询出站 */
  lastBlockQuery: lastBlockQueryRef,
  /** 最新无 ID 块接受出站（#380 T05） */
  lastBlockAccept: lastBlockAcceptRef,
  /** 以最新出站块查询回灌应答（宿主扮演，#380 T05） */
  respondBlockQuery(items: WikilinkBlockItem[], targetVersion = 3) {
    const q = lastBlockQueryRef()
    if (!q) throw new Error('缺少待应答的 wikilink.block.query')
    controller.handleHostMessage({
      kind: 'wikilink.block.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'ready',
      targetVersion, items,
    })
  },
  /** 以最新出站 accept 回灌结果（宿主扮演，#380 T05） */
  respondBlockAccept(payload:
    | { ok: true; blockId: string; alias?: string; sameDoc?: boolean; markerLfOffset?: number; markerText?: string }
    | { ok: false; reason: string }) {
    const q = lastBlockAcceptRef()
    if (!q) throw new Error('缺少待应答的 wikilink.block.accept')
    controller.handleHostMessage({
      kind: 'wikilink.block.accept.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, ...payload,
    } as Parameters<typeof controller.handleHostMessage>[0])
  },
  /** 出站消息清单（cancel/linked 断言用，#380 T05） */
  hostMessages(): Array<{ kind: string; reqId?: number }> {
    return hostMessages.map((m) => ({ kind: (m as { kind: string }).kind, reqId: (m as { reqId?: number }).reqId }))
  },
  /** 注入候选失效信号（#377 T02 wikilink.invalidate——宿主索引/清单变更广播） */
  sendInvalidate() {
    controller.handleHostMessage({ kind: 'wikilink.invalidate' })
  },
  /** 多光标形态（两个折叠 range）：验证多 range 不接管 */
  setTwoCursors(a: number, b: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(a), EditorSelection.cursor(b)]) })
  },
})
