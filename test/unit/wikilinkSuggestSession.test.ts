// 双链联想会话层契约（工单 #378 T03，jsdom 生产控制器）：目标区重编辑
// 二次触发矩阵、#／^／| 转阶段按键仲裁、占位状态守卫与异步高亮保留——
// 经 WebviewSyncController 全量装配（keymap 优先级与生产一致），按键用
// 真实 keydown 分发。宿主侧由测试扮演：读出站 wikilink.query 并回灌
// wikilink.query.result。浏览器层（wikilinkSuggest.mjs）用真实键盘/IME
// 验证同一链路，本层覆盖矩阵广度。
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost, WikilinkBlockItem, WikilinkCandidateItem, WikilinkHeadingItem } from '../../src/shared/protocol'

if (Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
}
// jsdom 无 scrollIntoView（候选高亮滚动定位）；静默 polyfill
if (typeof Element !== 'undefined' && Element.prototype.scrollIntoView === undefined) {
  ;(Element.prototype as unknown as { scrollIntoView(): void }).scrollIntoView = () => {}
}

installLocale('zh-cn', zhCn)

function setup(text: string) {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (message) => sent.push(message as WebviewToHost),
    getState: () => undefined,
    setState: () => {},
  }
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'), [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 't03-session', docUri: 'file:///t03.md', version: 1, text })
  return { controller, sent, view: controller.getView()! }
}

const press = (view: ReturnType<typeof setup>['view'], key: string) => {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

const locate = (c: ReturnType<typeof setup>['controller'], offset: number) => {
  c.handleHostMessage({ kind: 'view.locate', offset })
}

/** 模拟用户键入（光标随插入后移，与真实 DOM 输入同构） */
const typeAt = (view: ReturnType<typeof setup>['view'], pos: number, text: string) => {
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: 'input.type',
  })
}

/** 模拟用户删除（光标落在删除区起点） */
const deleteAt = (view: ReturnType<typeof setup>['view'], from: number, to: number) => {
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: 'delete.backward',
  })
}

const queries = (sent: WebviewToHost[]) =>
  sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.query' }> => m.kind === 'wikilink.query')

const lastQuery = (sent: WebviewToHost[]) => queries(sent).at(-1)

/** #379 T04：标题查询出站记录 */
const headingQueries = (sent: WebviewToHost[]) =>
  sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.heading.query' }> =>
    m.kind === 'wikilink.heading.query')

const lastHeadingQuery = (sent: WebviewToHost[]) => headingQueries(sent).at(-1)

/** #380 T05：块查询出站记录 */
const blockQueries = (sent: WebviewToHost[]) =>
  sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.query' }> =>
    m.kind === 'wikilink.block.query')

const lastBlockQuery = (sent: WebviewToHost[]) => blockQueries(sent).at(-1)

/** 以最新出站标题查询回灌应答（宿主扮演；#379 T04） */
function respondHeading(
  c: ReturnType<typeof setup>['controller'],
  sent: WebviewToHost[],
  items: WikilinkHeadingItem[],
) {
  const q = lastHeadingQuery(sent)
  if (!q) {
    throw new Error('缺少待应答的 wikilink.heading.query')
  }
  c.handleHostMessage({
    kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
    reqId: q.reqId, generation: q.generation, status: 'ready',
    targetVersion: 1, items,
  })
}

/** 以最新出站标题查询回灌失败状态（宿主扮演；#379 T04） */
function respondHeadingUnavailable(
  c: ReturnType<typeof setup>['controller'],
  sent: WebviewToHost[],
  reason: 'no-workspace' | 'target-not-found' | 'target-not-md' | 'read-error',
) {
  const q = lastHeadingQuery(sent)
  if (!q) {
    throw new Error('缺少待应答的 wikilink.heading.query')
  }
  c.handleHostMessage({
    kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
    reqId: q.reqId, generation: q.generation, status: 'unavailable', reason,
  })
}

/** 以最新出站查询回灌候选（宿主扮演）；同 reqId/generation 再次回灌即
 *  模拟宿主「更新帧」（部分结果→完整结果的流式推送） */
function respond(
  c: ReturnType<typeof setup>['controller'],
  sent: WebviewToHost[],
  items: WikilinkCandidateItem[],
) {
  const q = lastQuery(sent)
  if (!q) {
    throw new Error('缺少待应答的 wikilink.query')
  }
  c.handleHostMessage({
    kind: 'wikilink.query.result', sessionId: q.sessionId, docUri: q.docUri,
    reqId: q.reqId, generation: q.generation, status: 'ready',
    updating: false, total: items.length, items,
  })
}

const FANGAN: WikilinkCandidateItem = {
  id: 'C:\\vault\\资料\\方案.md', name: '方案.md', dir: '资料', relPath: '资料/方案.md',
  insertPath: '../资料/方案.md', alias: '方案', mtimeMs: 1000, score: 0,
  labelHighlights: [], dirHighlights: [],
}
const TONGZHI: WikilinkCandidateItem = {
  id: 'C:\\vault\\通知.md', name: '通知.md', dir: '', relPath: '通知.md',
  insertPath: '../通知.md', alias: '通知', mtimeMs: 2000, score: 0,
  labelHighlights: [], dirHighlights: [],
}

const POPUP = '.vsidian-wikilink-suggest'
const ITEM = '.vsidian-wikilink-suggest-item'
const ACTIVE = '.vsidian-wikilink-suggest-item-active'
const STATUS = '.vsidian-wikilink-suggest-status'

function popupState() {
  const el = document.querySelector<HTMLElement>(POPUP)
  if (!el) {
    return { open: false, itemCount: 0, activeIndex: null as number | null, statusText: null as string | null }
  }
  const items = [...el.querySelectorAll<HTMLElement>(ITEM)]
  const active = el.querySelector<HTMLElement>(ACTIVE)
  // jsdom 无布局（coordsAtPos null → placePopup 静默隐藏）：open 判定取
  // 浮层挂载在场；绘制可见性归 browser/integration 层断言
  return {
    open: true,
    itemCount: items.length,
    activeIndex: active ? items.indexOf(active) : null,
    statusText: el.querySelector<HTMLElement>(STATUS)?.textContent ?? null,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('二次触发矩阵：Esc 后仅目标区输入/删除重开', () => {
  it('[[Aa|B]]：目标区输入查光标左侧；Esc 后纯移动不重开；编辑 B 不触发；返回目标区修改才重开', () => {
    const { controller, sent, view } = setup('[[Aa|B]]')
    try {
      // 目标区 A 与 a 之间输入 x：查询 = 左侧 A（含新输入）
      locate(controller, 3)
      typeAt(view, 3, 'x')
      expect(lastQuery(sent)?.query).toBe('Ax')
      respond(controller, sent, [FANGAN])
      expect(popupState().open).toBe(true)

      // Esc 关闭；光标在双链内移动（到字段各处）不出站、不重开
      press(view, 'Escape')
      expect(popupState().open).toBe(false)
      const count = queries(sent).length
      locate(controller, 4)
      locate(controller, 2)
      expect(queries(sent).length).toBe(count)

      // 显示文字 B 内输入：不触发（候选不重开、文本照常编辑）
      locate(controller, 6)
      typeAt(view, 6, 'y')
      expect(queries(sent).length).toBe(count)
      expect(view.state.doc.toString()).toBe('[[Axa|yB]]')

      // 返回目标区并删除才重开；查询仍为光标左侧
      locate(controller, 6) // a 之后（| 前）
      deleteAt(view, 5, 6)
      expect(lastQuery(sent)?.query).toBe('Axa')
      expect(queries(sent).length).toBe(count + 1)
    } finally {
      controller.dispose()
    }
  })

  it('目标区删除（Backspace 清空到空字段）触发空查询', () => {
    const { controller, sent, view } = setup('[[A]]')
    try {
      locate(controller, 3)
      deleteAt(view, 2, 3)
      expect(lastQuery(sent)?.query).toBe('')
      expect(view.state.doc.toString()).toBe('[[]]')
    } finally {
      controller.dispose()
    }
  })

  it('空目标锚点字段输入/删除重开占位会话（不猜默认文档、不出站标题查询）', () => {
    const { controller, sent, view } = setup('[[#]]')
    try {
      locate(controller, 3) // # 后
      typeAt(view, 3, '预')
      expect(view.state.doc.toString()).toBe('[[#预]]')
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.itemCount).toBe(0)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.placeholder.heading'])
      expect(queries(sent)).toHaveLength(0)
      expect(headingQueries(sent)).toHaveLength(0)
    } finally {
      controller.dispose()
    }
  })

  it('有目标锚点字段输入重开标题会话并出站标题查询（#379 T04）', () => {
    const { controller, sent, view } = setup('[[方案.md#]]')
    try {
      locate(controller, 8) // # 后
      typeAt(view, 8, '预')
      expect(view.state.doc.toString()).toBe('[[方案.md#预]]')
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.status.headingLoading'])
      const hq = lastHeadingQuery(sent)
      expect(hq).toBeDefined()
      expect(hq!.query).toBe('预')
      expect(hq!.target).toBe('方案.md')
      expect(queries(sent)).toHaveLength(0) // 文件查询不复发
    } finally {
      controller.dispose()
    }
  })

  it('块锚点字段重编辑：有明确目标出站块查询（#380 T05；空目标才占位）', () => {
    const { controller, sent, view } = setup('[[方案.md#^id]]')
    try {
      locate(controller, 10) // id 中部
      deleteAt(view, 10, 11)
      expect(view.state.doc.toString()).toBe('[[方案.md#^i]]')
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.status.blockLoading'])
      const bq = lastBlockQuery(sent)
      expect(bq).toBeDefined()
      expect(bq!.query).toBe('i')
      expect(bq!.target).toBe('方案.md')
      expect(queries(sent)).toHaveLength(0) // 文件查询不复发
      expect(headingQueries(sent)).toHaveLength(0) // 标题查询不复发
    } finally {
      controller.dispose()
    }
  })

  it('空目标块锚点保持占位不出站（T03 语义不动）', () => {
    const { controller, sent, view } = setup('[[#^id]]')
    try {
      locate(controller, 5) // id 中部
      deleteAt(view, 5, 6)
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.placeholder.block'])
      expect(blockQueries(sent)).toHaveLength(0)
    } finally {
      controller.dispose()
    }
  })

  it('外部同步不重开（外部正文变更关闭会话、不再出站）', () => {
    const { controller, sent, view } = setup('[[A]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, 'a')
      expect(queries(sent)).toHaveLength(1)
      respond(controller, sent, [FANGAN])
      expect(popupState().open).toBe(true)
      // 外部全文重置（resync 链路走 external 注解事务；本地 unconfirmed 在场
      // 时增量 doc.changed 会被暂缓映射，resync 为无歧义外部变更载体）
      controller.handleHostMessage({ kind: 'doc.resync', version: 3, text: '[[B]]' })
      expect(view.state.doc.toString()).toBe('[[B]]')
      expect(popupState().open).toBe(false)
      expect(queries(sent)).toHaveLength(1)
    } finally {
      controller.dispose()
    }
  })
})

describe('转阶段：# / ^ / |（真实 keydown，无需先 Enter）', () => {
  it('高亮文件后 #：补全文件转标题阶段并出站标题查询（#379 T04）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, [FANGAN])
      expect(popupState().activeIndex).toBe(0)
      const queryCount = queries(sent).length
      press(view, '#')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#'.length)
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.itemCount).toBe(0)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.status.headingLoading'])
      expect(queries(sent).length).toBe(queryCount) // 文件查询不复发
      const hq = lastHeadingQuery(sent)
      expect(hq).toBeDefined()
      expect(hq!.query).toBe('')
      expect(hq!.target).toBe('../资料/方案.md')
    } finally {
      controller.dispose()
    }
  })

  it('无高亮按 #：不补文件名，保留原输入并出站标题查询（目标=原输入）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, []) // 无结果：无高亮
      press(view, '#')
      expect(view.state.doc.toString()).toBe('[[方案#]]')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingLoading'])
      const hq = lastHeadingQuery(sent)
      expect(hq).toBeDefined()
      expect(hq!.target).toBe('方案')
    } finally {
      controller.dispose()
    }
  })

  it('空双链无高亮按 #：不补文件名，进入标题占位；关闭后 ^ 不接管', () => {
    const { controller, sent, view } = setup('[[]]')
    try {
      locate(controller, 2)
      typeAt(view, 2, '方')
      respond(controller, sent, [])
      deleteAt(view, 2, 3) // 清回空字段
      press(view, '#')
      expect(view.state.doc.toString()).toBe('[[#]]')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.placeholder.heading'])
      press(view, 'Escape')
      press(view, '^') // 会话已关：^ 落穿（jsdom 合成 keydown 无默认插入）
      expect(view.state.doc.toString()).toBe('[[#]]')
    } finally {
      controller.dispose()
    }
  })

  it('标题占位阶段按 ^：不重复补 #，只补 ^ 转块阶段（目标明确出站块查询）', () => {
    const { controller, sent, view } = setup('[[方案.md#]]')
    try {
      locate(controller, 8)
      typeAt(view, 8, 'x')
      deleteAt(view, 8, 9) // 输入删除后重开占位
      press(view, '^')
      expect(view.state.doc.toString()).toBe('[[方案.md#^]]')
      expect(view.state.selection.main.head).toBe('[[方案.md#^'.length)
      // #380 T05：目标明确即出站块查询（空目标才保持占位）
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.blockLoading'])
      expect(lastBlockQuery(sent)?.target).toBe('方案.md')
    } finally {
      controller.dispose()
    }
  })

  it('高亮文件后 ^：补全文件一次形成 #^（目标明确出站块查询）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, [FANGAN])
      press(view, '^')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^]]')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.blockLoading'])
      expect(lastBlockQuery(sent)?.target).toBe('../资料/方案.md')
    } finally {
      controller.dispose()
    }
  })

  it('高亮文件后 |：补全目标、显示文字留空、关闭候选，光标在 | 后', () => {
    const { controller, sent, view } = setup('[[方案.md]]')
    try {
      locate(controller, 7)
      typeAt(view, 7, 'x')
      deleteAt(view, 7, 8)
      respond(controller, sent, [FANGAN])
      press(view, '|')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md|]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md|'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('无高亮按 |：保留原输入关闭候选；已有 | 复用跳转（显示文字保留）', () => {
    const { controller, sent, view } = setup('[[Aa|B]]')
    try {
      locate(controller, 4) // | 左边界
      typeAt(view, 4, 'x')
      deleteAt(view, 4, 5)
      respond(controller, sent, [])
      press(view, '|')
      expect(view.state.doc.toString()).toBe('[[Aa|B]]') // 已有 | 零编辑
      expect(view.state.selection.main.head).toBe(5) // 光标跳到已有 | 后
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('块占位阶段按 |：保留锚点、| 落在锚点末并关闭', () => {
    const { controller, view } = setup('[[方案.md#^id]]')
    try {
      locate(controller, 10)
      typeAt(view, 10, 'x')
      deleteAt(view, 10, 11)
      press(view, '|')
      expect(view.state.doc.toString()).toBe('[[方案.md#^id|]]')
      expect(view.state.selection.main.head).toBe('[[方案.md#^id|'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })
})

describe('占位状态守卫：占位不可确认、光标移动与 Esc', () => {
  it('标题占位下 Tab 落穿围栏越界零写回；Enter 落穿默认换行破坏围栏后关闭', () => {
    const { controller, view } = setup('[[方案.md#]]')
    try {
      locate(controller, 8)
      typeAt(view, 8, 'x')
      deleteAt(view, 8, 9)
      // Tab 落穿围栏越界（#125）：纯选区移动零写回（光标移出锚点字段后关闭）
      press(view, 'Tab')
      expect(view.state.doc.toString()).toBe('[[方案.md#]]') // Tab 落穿不写文本
      expect(view.state.doc.toString().includes('../资料/方案.md')).toBe(false) // 占位不可确认
      // Enter 落穿默认换行（defaultKeymap）：围栏跨行破坏，候选随之关闭
      press(view, 'Enter')
      expect(view.state.doc.toString().includes('../资料/方案.md')).toBe(false)
      expect(view.state.doc.toString().includes('\n')).toBe(true)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('占位阶段 Esc 关闭；字段内移动保持、移出关闭', () => {
    const { controller, view } = setup('[[方案.md#预]]')
    try {
      locate(controller, 9)
      typeAt(view, 9, 'x')
      deleteAt(view, 9, 10)
      expect(popupState().open).toBe(true)
      // 字段内移动（预 中部）保持
      locate(controller, 8)
      expect(popupState().open).toBe(true)
      // 移出（围栏外）关闭
      locate(controller, '[[方案.md#预]]'.length)
      expect(popupState().open).toBe(false)
      // Esc 链路：重开后 Esc 关闭一次
      typeAt(view, 9, 'y')
      expect(popupState().open).toBe(true)
      press(view, 'Escape')
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('块占位阶段方向键落穿移动光标（无候选可高亮）', () => {
    const { controller, view } = setup('[[方案.md#^]]')
    try {
      locate(controller, 9)
      typeAt(view, 9, 'x')
      deleteAt(view, 9, 10)
      const head = view.state.selection.main.head
      press(view, 'ArrowLeft')
      expect(view.state.selection.main.head).toBe(head - 1) // 方向键落穿移动光标
    } finally {
      controller.dispose()
    }
  })
})

describe('确认与光标位置（文件字段整体替换）', () => {
  it('[[Aa|B]] Enter：替换完整 Aa、保留 B、光标在 | 前', () => {
    const { controller, sent, view } = setup('[[Aa|B]]')
    try {
      locate(controller, 4)
      typeAt(view, 4, 'x')
      deleteAt(view, 4, 5)
      respond(controller, sent, [FANGAN])
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md|B]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('[[A#H]] 目标侧 Enter：锚点保留、补默认别名、光标在锚点末', () => {
    const { controller, sent, view } = setup('[[A#H]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, 'x')
      deleteAt(view, 3, 4)
      respond(controller, sent, [FANGAN])
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#H|方案]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#H'.length)
    } finally {
      controller.dispose()
    }
  })
})

describe('异步列表更新按候选身份保留手动高亮', () => {
  it('同查询更新帧：手动高亮按 id 保留；身份消失时空查询回无高亮、非空取首项', () => {
    const { controller, sent, view } = setup('[[]]')
    try {
      // 非空查询：高亮第 2 项（通知），更新帧保留其身份
      locate(controller, 2)
      typeAt(view, 2, '方')
      respond(controller, sent, [FANGAN, TONGZHI])
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(1)
      // 同 reqId 更新帧（次序颠倒、身份俱在）：高亮跟身份走
      respond(controller, sent, [TONGZHI, FANGAN])
      expect(popupState().activeIndex).toBe(0)
      // 通知消失：非空查询取首项
      respond(controller, sent, [FANGAN])
      expect(popupState().activeIndex).toBe(0)

      // 空查询：手动高亮后身份消失回无高亮
      deleteAt(view, 2, 3)
      respond(controller, sent, [FANGAN, TONGZHI])
      expect(popupState().activeIndex).toBe(null) // 空查询初始无高亮
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(0)
      respond(controller, sent, [TONGZHI]) // 方案消失
      expect(popupState().activeIndex).toBe(null)
    } finally {
      controller.dispose()
    }
  })

  it('用户改查询执行初始高亮规则（非空首项）', () => {
    const { controller, sent, view } = setup('[[]]')
    try {
      locate(controller, 2)
      typeAt(view, 2, '方')
      respond(controller, sent, [FANGAN, TONGZHI])
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(1)
      typeAt(view, 3, '案')
      respond(controller, sent, [FANGAN])
      expect(popupState().activeIndex).toBe(0) // 新查询首帧回初始规则
    } finally {
      controller.dispose()
    }
  })
})

describe('输入仲裁：IME、多 range、非空选区、无会话不接管', () => {
  it('IME 组合期 #/^/| 不消费（组合期按键不接管选词）', async () => {
    const { controller, sent, view } = setup('[[]]')
    try {
      locate(controller, 2)
      typeAt(view, 2, '方')
      respond(controller, sent, [FANGAN])
      view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
      try {
        const before = view.state.doc.toString()
        press(view, '#')
        press(view, '^')
        press(view, '|')
        expect(view.state.doc.toString()).toBe(before) // 组合期不执行 #/^/| 转阶段
        expect(view.state.doc.toString().includes('../资料/方案.md')).toBe(false) // 不确认候选
        // 真实 IME 选词 Enter 不达 keymap（组合期无 beforeinput）；jsdom
        // 合成 keydown 的 defaultKeymap 换行属落穿层行为，不在本层钉
      } finally {
        view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
      }
      // CM6 组合定稿 flush（compositionend 后约 50ms 的 view.update([])）
      // 之后 keymap 恢复可达；等待其后 Esc 恢复可用
      await new Promise((resolve) => setTimeout(resolve, 120))
      press(view, 'Escape')
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('多 range 时 # 不接管（落穿普通输入语义）', () => {
    const { controller, sent, view } = setup('[[方]] [[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, 'x')
      deleteAt(view, 3, 4)
      respond(controller, sent, [FANGAN])
      // 多 range（两个折叠光标）
      const second = view.state.doc.toString().indexOf('[[方]]', 3)
      view.dispatch({
        selection: EditorSelection.create([
          EditorSelection.cursor(3), EditorSelection.cursor(second + 3),
        ]),
      })
      press(view, '#')
      expect(view.state.doc.toString()).toBe('[[方]] [[方]]') // 多 range 不接管（未写 # 编辑）
    } finally {
      controller.dispose()
    }
  })

  it('无会话（围栏外）按 # ^ | 不接管', () => {
    const { controller, sent } = setup('正文')
    try {
      controller.handleHostMessage({ kind: 'view.locate', offset: 1 })
      const view = controller.getView()!
      press(view, '#')
      press(view, '^')
      press(view, '|')
      expect(queries(sent)).toHaveLength(0)
      // keydown 未被吞时 jsdom 无默认字符插入——仅断言零查询零接管
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })
})

// ---- #379 T04：标题阶段会话（真实候选、键盘确认、重名 toast、守卫）----

const YUSUAN: WikilinkHeadingItem = {
  id: 'C:\\vault\\资料\\方案.md#3', heading: '预算', level: 2, line: 3,
  duplicate: true, alias: '方案',
}
const YUSUAN_DUP: WikilinkHeadingItem = {
  id: 'C:\\vault\\资料\\方案.md#5', heading: '预算', level: 1, line: 5,
  duplicate: true, alias: '方案',
}
const GAISHU: WikilinkHeadingItem = {
  id: 'C:\\vault\\资料\\方案.md#1', heading: '概述', level: 1, line: 1,
  duplicate: false, alias: '方案',
}

/** 标题候选行主文字序列 */
const headingNames = () =>
  [...document.querySelectorAll<HTMLElement>('.vsidian-wikilink-suggest-item')]
    .map((row) => row.querySelector('.vsidian-wikilink-suggest-name')?.textContent ?? '')

describe('标题阶段会话：候选、键盘与确认（#379 T04）', () => {
  it('# 转阶段后真实候选：空查询列出全部不高亮，方向键可选，Enter 确认默认别名', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, [FANGAN])
      press(view, '#')
      respondHeading(controller, sent, [GAISHU, YUSUAN, YUSUAN_DUP])
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.itemCount).toBe(3)
      expect(p.activeIndex).toBe(null) // 空查询初始无高亮
      expect(headingNames()).toEqual(['概述', '预算', '预算']) // 重复不合并
      // 方向键移动高亮（不移动正文光标）
      const headBefore = view.state.selection.main.head
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(0)
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(1)
      expect(view.state.selection.main.head).toBe(headBefore)
      // Enter 确认：替换锚点字段 + 文件名默认别名，关闭候选
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#预算|方案]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#预算'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('输入前缀自动查询并高亮首项；锚点中部确认替换整个字段不留残留', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#]]')
    try {
      locate(controller, 14) // # 后
      typeAt(view, 14, '预x')
      const q1 = lastHeadingQuery(sent)
      expect(q1!.query).toBe('预x')
      respondHeading(controller, sent, [YUSUAN])
      expect(popupState().activeIndex).toBe(0) // 非空查询自动高亮首项
      press(view, 'Enter')
      // 光标右侧 x 不残留：锚点字段整体替换
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#预算|方案]]')
    } finally {
      controller.dispose()
    }
  })

  it('已有别名保留不覆盖（无 | 才补默认别名）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#|手写]]')
    try {
      locate(controller, 14) // # 后、| 前
      typeAt(view, 14, '预')
      respondHeading(controller, sent, [YUSUAN])
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#预算|手写]]')
    } finally {
      controller.dispose()
    }
  })

  it('标题阶段 | 接受高亮：替换锚点字段、显示文字留空、关闭候选', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#x]]')
    try {
      locate(controller, 14) // 锚点起点（x 前）
      typeAt(view, 14, '预')
      respondHeading(controller, sent, [YUSUAN])
      press(view, '|')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#预算|]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#预算|'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('迟到/错位响应拒收：旧 reqId 与旧 generation 的回包不改状态', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#]]')
    try {
      locate(controller, 14)
      typeAt(view, 14, '预')
      const q = lastHeadingQuery(sent)!
      // 伪造迟到帧（reqId 不匹配）：状态保持加载
      controller.handleHostMessage({
        kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
        reqId: q.reqId + 100, generation: q.generation, status: 'ready',
        targetVersion: 1, items: [GAISHU],
      })
      expect(popupState().itemCount).toBe(0)
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingLoading'])
      controller.handleHostMessage({
        kind: 'wikilink.heading.query.result', sessionId: q.sessionId, docUri: q.docUri,
        reqId: q.reqId, generation: q.generation + 5, status: 'unavailable',
        reason: 'target-not-found',
      })
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingLoading'])
      // 正配对回包正常接受
      respondHeading(controller, sent, [YUSUAN])
      expect(popupState().itemCount).toBe(1)
      // 查询更新（新 generation）后旧回包再拒收
      typeAt(view, 15, '算')
      const stale = lastHeadingQuery(sent)!
      controller.handleHostMessage({
        kind: 'wikilink.heading.query.result', sessionId: stale.sessionId, docUri: stale.docUri,
        reqId: stale.reqId - 1, generation: stale.generation - 1, status: 'ready',
        targetVersion: 1, items: [GAISHU],
      })
      expect(popupState().itemCount).toBe(0) // 新查询在途（旧结果已随重开清空）
    } finally {
      controller.dispose()
    }
  })

  it('失败真实状态分态呈现：目标不可定位 / 非 Markdown / 读取失败 / 空结果', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#]]')
    try {
      locate(controller, 14)
      typeAt(view, 14, 'x')
      respondHeadingUnavailable(controller, sent, 'target-not-found')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingNotFound'])
      deleteAt(view, 14, 15) // 清回空锚点（重开新查询）
      typeAt(view, 14, 'y')
      respondHeadingUnavailable(controller, sent, 'target-not-md')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingNotMd'])
      deleteAt(view, 14, 15)
      typeAt(view, 14, 'z')
      respondHeadingUnavailable(controller, sent, 'read-error')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingReadError'])
      // ready + 空列表是空态（与失败分态不同，不冒充）
      deleteAt(view, 14, 15)
      respondHeading(controller, sent, [])
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.headingEmpty'])
    } finally {
      controller.dispose()
    }
  })

  it('invalidate 去抖后标题会话重查（目标改动淘汰旧候选）', async () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#]]')
    try {
      locate(controller, 14)
      typeAt(view, 14, '预')
      respondHeading(controller, sent, [YUSUAN])
      expect(popupState().itemCount).toBe(1)
      controller.handleHostMessage({ kind: 'wikilink.invalidate' })
      // 300ms 去抖后重发当前查询（同查询新 reqId）
      await new Promise((resolve) => setTimeout(resolve, 380))
      const after = headingQueries(sent)
      expect(after.length).toBe(2)
      expect(after.at(-1)!.query).toBe('预')
      expect(after.at(-1)!.target).toBe('../资料/方案.md')
    } finally {
      controller.dispose()
    }
  })
})

describe('标题阶段重名提示与 toast（#379 T04）', () => {
  /** 挂 body 的装配（toast 容器随 mount 的 parent 创建——需在 document 内
   *  才能被断言；与 setup 同构，仅 parent 连接文档） */
  function setupWithToast(text: string) {
    const sent: WebviewToHost[] = []
    const bridge: VsCodeBridge = {
      postMessage: (message) => sent.push(message as WebviewToHost),
      getState: () => undefined,
      setState: () => {},
    }
    const controller = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    controller.mount(parent, [keymap.of(defaultKeymap)])
    controller.handleHostMessage({ kind: 'init', sessionId: 't04-session', docUri: 'file:///t04.md', version: 1, text })
    return {
      controller, sent, view: controller.getView()!,
      cleanup: () => { controller.dispose(); parent.remove() },
    }
  }

  it('选中重复标题：toast 提示定位风险并继续接受（不合并、不改跳转语义）', () => {
    const { controller, sent, view, cleanup } = setupWithToast('[[../资料/方案.md#]]')
    try {
      locate(controller, 14)
      typeAt(view, 14, '预')
      // 宿主已按前缀过滤回灌（'概述' 不匹配 '预'）：同名两项独立候选
      respondHeading(controller, sent, [YUSUAN, YUSUAN_DUP])
      // 非空查询高亮首项；下移选中第二个「预算」（重复项）
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(1)
      press(view, 'Enter')
      // toast 在场且文案为重名风险提示
      const toast = document.querySelector<HTMLElement>('.vsidian-toast')
      expect(toast?.textContent).toBe(zhCn['wikilinkSuggest.toast.duplicateHeading'])
      expect(toast?.dataset['severity']).toBe('warning')
      // 继续接受：确认照常写入
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#预算|方案]]')
      expect(popupState().open).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('选中非重复标题不弹 toast', () => {
    const { controller, sent, view, cleanup } = setupWithToast('[[../资料/方案.md#]]')
    try {
      locate(controller, 14)
      typeAt(view, 14, '概')
      respondHeading(controller, sent, [GAISHU])
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#概述|方案]]')
      expect(document.querySelector('.vsidian-toast')).toBeNull()
    } finally {
      cleanup()
    }
  })
})

describe('块阶段会话：候选、确认与无 ID 补写（#380 T05）', () => {
  const BLOCK_HAS_ID: WikilinkBlockItem = {
    id: 'C:\vault\资料\方案.md#^2', blockId: 'keep01', snippet: '预算编制说明',
    line: 2, lineCount: 1, alias: '方案',
  }
  const BLOCK_NO_ID: WikilinkBlockItem = {
    id: 'C:\vault\资料\方案.md#^4', blockId: '', snippet: '会议记录',
    line: 4, lineCount: 2, alias: '方案',
  }

  /** 以最新出站块查询回灌应答（宿主扮演） */
  function respondBlock(
    c: ReturnType<typeof setup>['controller'],
    sent: WebviewToHost[],
    items: WikilinkBlockItem[],
    targetVersion = 3,
  ) {
    const q = lastBlockQuery(sent)
    if (!q) {
      throw new Error('缺少待应答的 wikilink.block.query')
    }
    c.handleHostMessage({
      kind: 'wikilink.block.query.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, status: 'ready', targetVersion, items,
    })
  }

  const accepts = (sent: WebviewToHost[]) =>
    sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.accept' }> =>
      m.kind === 'wikilink.block.accept')
  const lastAccept = (sent: WebviewToHost[]) => accepts(sent).at(-1)
  const cancels = (sent: WebviewToHost[]) =>
    sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.cancel' }> =>
      m.kind === 'wikilink.block.cancel')
  const linkeds = (sent: WebviewToHost[]) =>
    sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.linked' }> =>
      m.kind === 'wikilink.block.linked')

  /** 以最新出站 accept 回灌结果（宿主扮演） */
  function respondAccept(
    c: ReturnType<typeof setup>['controller'],
    sent: WebviewToHost[],
    payload: { ok: true; blockId: string; alias?: string; sameDoc?: boolean; markerLfOffset?: number; markerText?: string } |
      { ok: false; reason: 'no-workspace' | 'target-not-found' | 'target-not-md' | 'read-error' | 'target-changed' | 'apply-failed' },
  ) {
    const q = lastAccept(sent)
    if (!q) {
      throw new Error('缺少待应答的 wikilink.block.accept')
    }
    c.handleHostMessage({
      kind: 'wikilink.block.accept.result', sessionId: q.sessionId, docUri: q.docUri,
      reqId: q.reqId, generation: q.generation, ...payload,
    })
  }

  /** 块阶段会话开启（输入触发重开）并回灌候选 */
  function openBlockSession(
    controller: ReturnType<typeof setup>['controller'],
    sent: WebviewToHost[],
    view: ReturnType<typeof setup>['view'],
    caret: number,
    items: WikilinkBlockItem[],
    targetVersion = 3,
  ) {
    locate(controller, caret)
    typeAt(view, caret, 'x')
    respondBlock(controller, sent, items, targetVersion)
  }

  it('块候选渲染：snippet 主文字、行号/行数元信息、已有 id 随行展示', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_HAS_ID, BLOCK_NO_ID])
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.itemCount).toBe(2)
      expect(p.activeIndex).toBe(0) // 非空查询高亮首项
      const names = [...document.querySelectorAll('.vsidian-wikilink-suggest .vsidian-wikilink-suggest-name')]
        .map((n) => n.textContent)
      expect(names).toEqual(['预算编制说明 ^keep01', '会议记录'])
      const metas = [...document.querySelectorAll('.vsidian-wikilink-suggest .vsidian-wikilink-suggest-dir')]
        .map((n) => n.textContent)
      expect(metas).toEqual(['行 2 · 1 行', '行 4 · 2 行'])
    } finally {
      controller.dispose()
    }
  })

  it('已有 ID 块 Enter：本地直接确认（零宿主往返），产物 #^id + 默认别名', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_HAS_ID])
      press(view, 'Enter')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^keep01|方案]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#^keep01'.length)
      expect(popupState().open).toBe(false)
      expect(accepts(sent)).toHaveLength(0) // 已有 id 不走宿主补写
    } finally {
      controller.dispose()
    }
  })

  it('无 ID 块 Enter：先出站 accept（带行号与版本基准），回包后写入并回 linked', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID], 7)
      press(view, 'Enter')
      // 在途：浮层显示补写状态、无候选确认
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.blockAccepting'])
      const q = lastAccept(sent)
      expect(q).toBeDefined()
      expect(q!.line).toBe(4)
      expect(q!.targetVersion).toBe(7)
      expect(q!.target).toBe('../资料/方案.md')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^x]]') // 未写正文
      // 回包（跨文档：宿主已补写）→ 本地接受 + linked
      respondAccept(controller, sent, { ok: true, blockId: 'abc123', alias: '方案' })
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^abc123|方案]]')
      expect(popupState().open).toBe(false)
      expect(linkeds(sent)).toHaveLength(1)
      expect(linkeds(sent)[0]!.reqId).toBe(q!.reqId)
    } finally {
      controller.dispose()
    }
  })

  it('无 ID 块接受失败（apply-failed）：toast 提示并保留输入（候选原样、可重试）', () => {
    const sent: WebviewToHost[] = []
    const bridge: VsCodeBridge = {
      postMessage: (message) => sent.push(message as WebviewToHost),
      getState: () => undefined,
      setState: () => {},
    }
    const controller = new WebviewSyncController(bridge)
    const parent = document.createElement('div')
    document.body.appendChild(parent) // toast 容器随 mount parent 创建——需在文档内
    controller.mount(parent, [keymap.of(defaultKeymap)])
    controller.handleHostMessage({ kind: 'init', sessionId: 't05-session', docUri: 'file:///t05.md', version: 1, text: '[[../资料/方案.md#^]]' })
    const view = controller.getView()!
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID])
      press(view, 'Enter')
      respondAccept(controller, sent, { ok: false, reason: 'apply-failed' })
      const toast = document.querySelector<HTMLElement>('.vsidian-toast')
      expect(toast?.textContent).toBe(zhCn['wikilinkSuggest.toast.blockAcceptFailed'])
      expect(toast?.dataset['severity']).toBe('warning')
      // 输入与候选保留
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^x]]')
      expect(popupState().open).toBe(true)
      expect(popupState().itemCount).toBe(1)
      expect(linkeds(sent)).toHaveLength(0)
    } finally {
      controller.dispose()
      parent.remove()
    }
  })

  it('F4：target-changed 失败不 toast——重发当前阶段查询刷新版本基准，重试即成功', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID], 7)
      press(view, 'Enter')
      const firstAccept = lastAccept(sent)
      expect(firstAccept!.targetVersion).toBe(7)
      // IME 定稿落地晚于查询结果：版本守卫拒绝
      respondAccept(controller, sent, { ok: false, reason: 'target-changed' })
      const toast = document.querySelector<HTMLElement>('.vsidian-toast')
      expect(toast).toBeNull() // 不打扰——刷新即自愈路径
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^x]]') // 输入保留
      expect(popupState().open).toBe(true)
      // 重发块查询（同查询新 reqId；旧版本基准作废）
      const queries = sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.query' }> =>
        m.kind === 'wikilink.block.query')
      expect(queries.length).toBe(2)
      // 新结果到达（新 targetVersion=9）→ 重按 Enter 以新基准出站
      respondBlock(controller, sent, [BLOCK_NO_ID], 9)
      press(view, 'Enter')
      const retry = lastAccept(sent)
      expect(retry).toBeDefined()
      expect(retry!.targetVersion).toBe(9)
      respondAccept(controller, sent, { ok: true, blockId: 'abc123', alias: '方案' })
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^abc123|方案]]')
    } finally {
      controller.dispose()
    }
  })

  it('同文档无 ID 块：宿主未写入，标记插入并入同一笔确认事务（一笔受控操作）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID])
      press(view, 'Enter')
      respondAccept(controller, sent, {
        ok: true, blockId: 'same001', sameDoc: true, alias: '方案',
        markerLfOffset: 18, markerText: '\n\n^same001',
      })
      // 一笔事务同时写链接与标记（此处 CM6 文本直接验证两段都在）
      const text = view.state.doc.toString()
      expect(text).toContain('[[../资料/方案.md#^same001|方案]]')
      expect(text).toContain('\n\n^same001')
      expect(popupState().open).toBe(false)
      expect(linkeds(sent)).toHaveLength(1)
    } finally {
      controller.dispose()
    }
  })

  it('F8：sameDoc 合笔标记在字段上方——光标平移到锚点末（不落链接内部）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID])
      press(view, 'Enter')
      // 标记插在文档头（字段上方）：selection 坐标须按新文档语义平移
      respondAccept(controller, sent, {
        ok: true, blockId: 'same001', sameDoc: true, alias: '方案',
        markerLfOffset: 0, markerText: '\n\n^same001',
      })
      const text = view.state.doc.toString()
      expect(text.startsWith('\n\n^same001')).toBe(true)
      expect(text).toContain('[[../资料/方案.md#^same001|方案]]')
      // 光标 = 锚点末（| 之前）；未平移时会早 markerText.length 落链接内部
      expect(view.state.selection.main.head).toBe(text.indexOf('|方案'))
    } finally {
      controller.dispose()
    }
  })

  it('接受在途时继续输入：会话重建即出站 cancel（宿主守卫撤回）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID])
      press(view, 'Enter')
      expect(lastAccept(sent)).toBeDefined()
      // 用户继续输入：会话重建 → 在途接受作废
      typeAt(view, 18, 'y')
      expect(cancels(sent)).toHaveLength(1)
      // 旧回包拒收（reqId 已过）：不写正文
      respondAccept(controller, sent, { ok: true, blockId: 'abc123', alias: '方案' })
      expect(view.state.doc.toString()).not.toContain('#^abc123')
    } finally {
      controller.dispose()
    }
  })

  it('接受在途时 Esc：关闭候选并出站 cancel', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_NO_ID])
      press(view, 'Enter')
      press(view, 'Escape')
      expect(popupState().open).toBe(false)
      expect(cancels(sent)).toHaveLength(1)
    } finally {
      controller.dispose()
    }
  })

  it('块阶段 | 有高亮：接受块候选进显示文字（已有 ID 本地路径）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      openBlockSession(controller, sent, view, 15, [BLOCK_HAS_ID])
      press(view, '|')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^keep01|]]')
      expect(view.state.selection.main.head).toBe('[[../资料/方案.md#^keep01|'.length)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('块查询失败真实状态：目标不可定位显示状态行（不伪装空结果）', () => {
    const { controller, sent, view } = setup('[[../资料/方案.md#^]]')
    try {
      locate(controller, 15)
      typeAt(view, 15, 'x')
      const q = lastBlockQuery(sent)
      expect(q).toBeDefined()
      controller.handleHostMessage({
        kind: 'wikilink.block.query.result', sessionId: q!.sessionId, docUri: q!.docUri,
        reqId: q!.reqId, generation: q!.generation, status: 'unavailable', reason: 'target-not-found',
      })
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.blockNotFound'])
    } finally {
      controller.dispose()
    }
  })
})

// ---- #381 T06：表格格内联想（pipeEscape 端到端）与 focusout 关闭 ----

describe('表格格内联想：转义竖线识别、确认与键位优先级（#381 T06）', () => {
  // 行 1：| [[A\|B]] | c | —— 光标 5 = A 后（转义管前）；2 格 × 2 列合法表格
  const TABLE_DOC = '| [[A\\|B]] | c |\n| --- | --- |\n| x | y |'

  it('格内目标区输入触发查询；Tab 确认替换文件字段、已有转义别名原样保留（网格完整）', () => {
    const { controller, sent, view } = setup(TABLE_DOC)
    try {
      locate(controller, 5)
      typeAt(view, 5, 'x')
      expect(lastQuery(sent)?.query).toBe('Ax')
      respond(controller, sent, [FANGAN])
      expect(popupState().open).toBe(true)
      press(view, 'Tab')
      // 确认替换整个文件字段（Ax → ../资料/方案.md），已有转义别名 \|B
      // 复用保留、光标落转义管前——格边界裸管未被触碰（网格完整）
      expect(view.state.doc.line(1).text).toBe('| [[../资料/方案.md\\|B]] | c |')
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('格内无分隔符确认补默认别名写转义竖线（不写裸竖线破坏网格）', () => {
    const { controller, sent, view } = setup('| [[A]] | c |\n| --- | --- |\n| x | y |')
    try {
      locate(controller, 5)
      deleteAt(view, 4, 5) // A → 空字段，触发空查询
      respond(controller, sent, [FANGAN])
      press(view, 'ArrowDown') // 空查询无高亮——↓ 取首项
      press(view, 'Enter')
      expect(view.state.doc.line(1).text).toBe('| [[../资料/方案.md\\|方案]] | c |')
    } finally {
      controller.dispose()
    }
  })

  it('格内会话中按 | 插转义竖线（无高亮保留原输入、关闭候选）', () => {
    const { controller, sent, view } = setup('| [[A]] | c |\n| --- | --- |\n| x | y |')
    try {
      locate(controller, 5)
      typeAt(view, 5, 'x')
      respond(controller, sent, []) // 空结果：无高亮
      press(view, '|')
      expect(view.state.doc.line(1).text).toBe('| [[Ax\\|]] | c |')
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('无高亮 Tab 不被候选吞键：按 #125 两步越出围栏后落到表格切格', () => {
    const { controller, sent, view } = setup('| [[A]] | c |\n| --- | --- |\n| x | y |')
    try {
      locate(controller, 5)
      deleteAt(view, 4, 5)
      respond(controller, sent, []) // 无可确认项
      expect(view.state.doc.line(1).text).toBe('| [[]] | c |')
      // Tab1/Tab2：fenceEscape 围栏内两步越界（#125 既定优先级——候选
      // 落穿后先越界再切格）；Tab3：tableTabForward 切到下一格（c 内容区）
      press(view, 'Tab')
      expect(view.state.selection.main.head).toBe(5)
      press(view, 'Tab')
      expect(view.state.selection.main.head).toBe(6)
      press(view, 'Tab')
      const sel = view.state.selection.main
      expect(sel.head).toBe(9)
      expect(view.state.doc.line(1).text.slice(sel.head - 1, sel.head + 1)).toContain('c')
    } finally {
      controller.dispose()
    }
  })

  it('裸管切开的双链形态不跨格识别（窗口截断：格内无闭合围栏不触发）', () => {
    // 3 列合法表格：header 三格 = [[A / B]] / c——格 0 窗口 = `[[A `，
    // 右侧裸管截断后无 ]]: 识别不跨格
    const { controller, sent, view } = setup('| [[A | B]] | c |\n| --- | --- | --- |\n| x | y | z |')
    try {
      locate(controller, 5)
      typeAt(view, 5, 'x')
      expect(queries(sent)).toHaveLength(0)
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })

  it('候选中的 Esc 先关列表（不进入其他 Esc 链路）；显示文字字段（越过转义管）不触发', () => {
    const { controller, sent, view } = setup(TABLE_DOC)
    try {
      locate(controller, 5)
      typeAt(view, 5, 'x')
      respond(controller, sent, [FANGAN])
      press(view, 'Escape')
      expect(popupState().open).toBe(false)
      expect(view.state.doc.line(1).text).toContain('[[Ax\\|B]]') // 正文未被 Esc 改写
      const count = queries(sent).length
      // 显示文字字段（B 内）输入不触发
      locate(controller, 8)
      typeAt(view, 8, 'y')
      expect(queries(sent).length).toBe(count)
    } finally {
      controller.dispose()
    }
  })

  it('焦点离开编辑器关闭候选（多实例并存不残留浮层）', () => {
    const { controller, sent, view } = setup(TABLE_DOC)
    try {
      locate(controller, 5)
      typeAt(view, 5, 'x')
      respond(controller, sent, [FANGAN])
      expect(popupState().open).toBe(true)
      view.contentDOM.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
      )
      expect(popupState().open).toBe(false)
    } finally {
      controller.dispose()
    }
  })
})

// ---- code-review 修复批次：F6（webview 终态）/ F8 / F11 ----

describe('code-review 修复：webview 侧（F6 终态与去重 / F8 合笔光标 / F11 方向键）', () => {
  /** 开文件阶段会话（typeAt 触发出站查询，不回灌） */
  function openFileSession(
    c: ReturnType<typeof setup>['controller'],
    view: ReturnType<typeof setup>['view'],
    sent: WebviewToHost[],
  ) {
    locate(c, 2)
    typeAt(view, 2, '方')
    expect(lastQuery(sent)).toBeDefined()
  }

  it('F6：不满页即穷尽——高亮在末项按 ↓ 不再续页（total 虚高不触发追加）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      openFileSession(controller, view, sent)
      // 宿主回包 2 项但 total 5（病态占位虚高）：不满页 = 穷尽
      const q = lastQuery(sent)!
      controller.handleHostMessage({
        kind: 'wikilink.query.result', sessionId: q.sessionId, docUri: q.docUri,
        reqId: q.reqId, generation: q.generation, status: 'ready',
        updating: false, total: 5, items: [FANGAN, TONGZHI],
      })
      const queriesBefore = queries(sent).length
      press(view, 'ArrowDown') // 高亮首项 → 第二项
      expect(popupState().activeIndex).toBe(1)
      press(view, 'ArrowDown') // 末项触底：不满页不续页
      expect(queries(sent).length).toBe(queriesBefore) // 无追加请求
      expect(popupState().activeIndex).toBe(1) // 高亮不动
      expect(popupState().open).toBe(true) // 会话不销毁
    } finally {
      controller.dispose()
    }
  })

  it('F6：满页触底续页，追加页按候选 id 去重（跨页身份复现不产生重复行）', () => {
    const { controller, sent, view } = setup('[[f]]')
    try {
      openFileSession(controller, view, sent)
      const makeItems = (from: number, count: number): WikilinkCandidateItem[] =>
        Array.from({ length: count }, (_, i) => ({
          id: `C:\vault\f${from + i}.md`,
          name: `f${from + i}.md`, dir: '', relPath: `f${from + i}.md`,
          insertPath: `../f${from + i}.md`, alias: `f${from + i}`, mtimeMs: 1000, score: 0,
          labelHighlights: [], dirHighlights: [],
        }))
      const q1 = lastQuery(sent)!
      controller.handleHostMessage({
        kind: 'wikilink.query.result', sessionId: q1.sessionId, docUri: q1.docUri,
        reqId: q1.reqId, generation: q1.generation, status: 'ready',
        updating: false, total: 57, items: makeItems(0, 50),
      })
      // 高亮到末项触底 → 满页续页（offset = 已投递数 50）
      for (let i = 0; i < 50; i++) {
        press(view, 'ArrowDown')
      }
      const q2 = queries(sent).at(-1)!
      expect(q2.offset).toBe(50)
      // 追加页 10 项中 3 项与首页重复 id（防御场景）→ 只拼接 7 项新身份
      controller.handleHostMessage({
        kind: 'wikilink.query.result', sessionId: q2.sessionId, docUri: q2.docUri,
        reqId: q2.reqId, generation: q2.generation, status: 'ready',
        updating: false, total: 57,
        items: [...makeItems(0, 3), ...makeItems(50, 7)],
      })
      expect(popupState().itemCount).toBe(57)
      // 不满页追加（7 < 50）：穷尽，再触底不出站
      const queriesAfter = queries(sent).length
      press(view, 'ArrowDown')
      expect(queries(sent).length).toBe(queriesAfter)
    } finally {
      controller.dispose()
    }
  })

  it('F11：加载中方向键消费——光标不动、会话不销毁（在途结果不被弃）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      openFileSession(controller, view, sent)
      const headBefore = view.state.selection.main.head
      press(view, 'ArrowDown')
      expect(view.state.selection.main.head).toBe(headBefore) // 不落穿移动光标
      expect(popupState().open).toBe(true) // 会话在场（loading 态浮层）
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.loading'])
      // 结果到达后方向键恢复移动语义：首帧高亮首项，↓ 移到第二项
      respond(controller, sent, [FANGAN, TONGZHI])
      expect(popupState().activeIndex).toBe(0)
      press(view, 'ArrowDown')
      expect(popupState().activeIndex).toBe(1)
    } finally {
      controller.dispose()
    }
  })

  it('F11：零命中方向键消费不落穿（会话保留，候选重查可达）', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      openFileSession(controller, view, sent)
      respond(controller, sent, [])
      const headBefore = view.state.selection.main.head
      press(view, 'ArrowUp')
      press(view, 'ArrowDown')
      expect(view.state.selection.main.head).toBe(headBefore)
      expect(popupState().open).toBe(true)
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.status.empty'])
    } finally {
      controller.dispose()
    }
  })
})

describe('F3：无 ID 块接受前的未出站编辑核对（hasUnsentLocalEdits 桩）', () => {
  it('未出站编辑在场时 Enter 消费不出站 accept——推进 flush 并重发查询；落定后重按即接受', async () => {
    const { WikilinkSuggestController } = await import('../../src/webview/wikilinkSuggest')
    const { liveDecorationsField } = await import('../../src/webview/liveDecorations')
    const { EditorView } = await import('@codemirror/view')
    const { EditorState } = await import('@codemirror/state')
    const sent: WebviewToHost[] = []
    let unsent = true
    let flushes = 0
    const controller = new WikilinkSuggestController({
      send: (message) => sent.push(message),
      getSession: () => ({ sessionId: 'f3-session', docUri: 'file:///f3.md' }),
      isLiveActive: () => true,
      isSuspended: () => false,
      isExternal: () => false,
      hasUnsentLocalEdits: () => unsent,
      scheduleFlush: () => {
        flushes += 1
      },
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '[[../资料/方案.md#^]]',
        // liveDecorationsField 在场（空数据）让 inCodeContext 不落入
        // 「无装饰=防御性视为代码上下文」分支（生产装配恒有该字段）
        extensions: [controller.extension, liveDecorationsField],
      }),
    })
    controller.attach(view)
    const blockItem: WikilinkBlockItem = {
      id: 'C:\vault\资料\方案.md#^4', blockId: '', snippet: '会议记录',
      line: 4, lineCount: 2, alias: '方案',
    }
    const blockQueriesOf = () =>
      sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.query' }> =>
        m.kind === 'wikilink.block.query')
    const acceptsOf = () =>
      sent.filter((m): m is Extract<WebviewToHost, { kind: 'wikilink.block.accept' }> =>
        m.kind === 'wikilink.block.accept')
    try {
      // 开块会话：光标先进锚点（selection 事务），再模拟用户键入查询
      view.dispatch({ selection: { anchor: 15 }, userEvent: 'select' })
      view.dispatch({
        changes: { from: 15, insert: 'x' },
        selection: { anchor: 16 },
        userEvent: 'input.type',
      })
      const q1 = blockQueriesOf()[0]!
      expect(q1).toBeDefined()
      controller.handleBlockResult({
        kind: 'wikilink.block.query.result', sessionId: q1.sessionId, docUri: q1.docUri,
        reqId: q1.reqId, generation: q1.generation, status: 'ready',
        targetVersion: 3, items: [blockItem],
      })
      // Enter：未出站编辑在场 → 消费本次按键，不出站 accept
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
      expect(acceptsOf()).toHaveLength(0)
      expect(flushes).toBe(1)
      // 已推进 flush 并重发当前阶段查询（宿主 whenEditsSettled 后装载
      // 最新文本，targetVersion 随之刷新）
      expect(blockQueriesOf().length).toBe(2)
      const q2 = blockQueriesOf()[1]!
      controller.handleBlockResult({
        kind: 'wikilink.block.query.result', sessionId: q2.sessionId, docUri: q2.docUri,
        reqId: q2.reqId, generation: q2.generation, status: 'ready',
        targetVersion: 9, items: [blockItem],
      })
      // 暂缓编辑落定（IME 定稿出站完成）→ 重按 Enter 正常接受（新基准）
      unsent = false
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      )
      const accept = acceptsOf()[0]!
      expect(accept).toBeDefined()
      expect(accept.targetVersion).toBe(9)
    } finally {
      controller.destroy()
      view.destroy()
      parent.remove()
    }
  })
})
