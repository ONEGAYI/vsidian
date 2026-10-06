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
import type { WebviewToHost, WikilinkCandidateItem } from '../../src/shared/protocol'

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

  it('锚点字段输入/删除重开占位会话（不读目标文档、不出站锚点查询）', () => {
    const { controller, sent, view } = setup('[[方案.md#]]')
    try {
      locate(controller, 8) // # 后
      typeAt(view, 8, '预')
      expect(view.state.doc.toString()).toBe('[[方案.md#预]]')
      const p = popupState()
      expect(p.open).toBe(true)
      expect(p.itemCount).toBe(0)
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.placeholder.heading'])
      expect(queries(sent)).toHaveLength(0)
    } finally {
      controller.dispose()
    }
  })

  it('块锚点字段重编辑显示块占位', () => {
    const { controller, sent, view } = setup('[[方案.md#^id]]')
    try {
      locate(controller, 10) // id 中部
      deleteAt(view, 10, 11)
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.placeholder.block'])
      expect(queries(sent)).toHaveLength(0)
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
  it('高亮文件后 #：补全文件转标题占位，光标在 # 后，不出站标题查询', () => {
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
      expect(p.statusText).toBe(zhCn['wikilinkSuggest.placeholder.heading'])
      expect(queries(sent).length).toBe(queryCount) // 转阶段不出站标题查询
    } finally {
      controller.dispose()
    }
  })

  it('无高亮按 #：不补文件名，保留原输入进入占位', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, []) // 无结果：无高亮
      press(view, '#')
      expect(view.state.doc.toString()).toBe('[[方案#]]')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.placeholder.heading'])
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

  it('标题占位阶段按 ^：不重复补 #，只补 ^ 转块占位', () => {
    const { controller, view } = setup('[[方案.md#]]')
    try {
      locate(controller, 8)
      typeAt(view, 8, 'x')
      deleteAt(view, 8, 9) // 输入删除后重开占位
      press(view, '^')
      expect(view.state.doc.toString()).toBe('[[方案.md#^]]')
      expect(view.state.selection.main.head).toBe('[[方案.md#^'.length)
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.placeholder.block'])
    } finally {
      controller.dispose()
    }
  })

  it('高亮文件后 ^：补全文件一次形成 #^', () => {
    const { controller, sent, view } = setup('[[方]]')
    try {
      locate(controller, 3)
      typeAt(view, 3, '案')
      respond(controller, sent, [FANGAN])
      press(view, '^')
      expect(view.state.doc.toString()).toBe('[[../资料/方案.md#^]]')
      expect(popupState().statusText).toBe(zhCn['wikilinkSuggest.placeholder.block'])
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
