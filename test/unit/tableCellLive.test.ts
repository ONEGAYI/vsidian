// P2-08（#285）表格格内嵌入的内部 Live 与父表格输入隔离契约（jsdom 直驱
// 真实 CM6 + EmbedCardManager + liveEmbed 装饰——与生产同构）：
// - 格内继承：表头/数据格（含转义别名）的嵌入自动继承内部 Live，inner 为
//   解码语义、源码区间为原始源文坐标（不混解码偏移）
// - 结构编辑不误伤（核心契约）：父表格行列结构编辑（列移动/行移动/格区
//   粘贴重建）的重写事务**完整覆盖嵌入源区间但逐字保留源文**——放行不弹
//   删除确认，且实例键迁移到新位置（端口/装载缓存保持，零 bind/unbind/
//   重载风暴）；变更计划取生产规划器（planTableColumnMove / planTableRowMove
//   / planTableRegionPaste——真实变更形态）
// - 真删除拦截保持：删嵌入所在行/列、改写嵌入本身（源文不存活）照常拦截
//   确认；取消保留引用与端口
// - 平移迁移（既有 mapPos 路径在表格上下文）：同格邻文打字、插列（纯插入
//   不覆盖区间）实例随坐标平移
// - 转义保真：`![[B\|别名]]` 的 A 源文在结构编辑往返中逐字节保留
// 真实键盘/拖拽/布局在 test/browser（tableCellLive.mjs）；真宿主在集成层。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  liveEmbed,
  liveEmbedCardsHostMark,
  setLiveEmbedCards,
} from '../../src/webview/liveEmbed'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { mermaidFencesField } from '../../src/webview/liveMermaid'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import {
  planTableColumnMove,
  planTableEdit,
  planTableRowMove,
} from '../../src/webview/tableStructure'
import { tableRowsAt } from '../../src/webview/tableEditing'
import { planTableRegionPaste } from '../../src/webview/tableRegion'
import { RELOCATION_SCAN_LIMITS } from '../../src/shared/relocationScan'

installLocale('zh-cn', zhCn)

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', ''].join('\n')

/** 父文档：三列表格——表头格转义别名嵌入 + 数据格混排嵌入 + 次行乙笔记嵌入 */
const TABLE_DOC = [
  '# 表格嵌入', '',
  '| ![[目标笔记\\|头别名]] | 头B | 头C |',
  '| --- | --- | --- |',
  '| 甲 ![[目标笔记\\|别名]] 乙 | 普一格 | 普二格 |',
  '| 数据行二 | ![[乙笔记\\|e]] | 普四格 |',
  '',
].join('\n')

function resultOk(
  req: { reqId: number; instanceId: string },
  target: string,
): Extract<HoverPreviewResult, { ok: true }> {
  const isYi = target === '乙笔记|e'
  return {
    kind: 'hover.result',
    reqId: req.reqId, instanceId: req.instanceId, ok: true,
    target: { fsPath: isYi ? 'D:\\notes\\乙笔记.md' : B_FS, relPath: isYi ? '乙笔记.md' : '目标笔记.md' },
    version: 2, text: TARGET_TEXT,
    range: { start: 0, end: TARGET_TEXT.length },
    scope: { kind: 'full' }, depth: 1, expansionPath: [],
    sourceLeaseId: 'panel-1:source-1',
  }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  setLiveEmbedCards(null)
})

/** 完整装配：manager + 真实 CM6 view（liveEmbed 装饰 + 宿主标记 + 键迁移
 *  appendTransaction + 删除拦截 changeFilter——与 syncController
 *  rootOwnedViewExtensions 同款） */
function setup(opts: { parentMode?: 'reading' | 'live' } = {}) {
  const sent: WebviewToHost[] = []
  let parentMode = opts.parentMode ?? 'live'
  let mainView: EditorView | null = null
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => parentMode,
    mainEditorView: () => mainView,
  }
  const manager = new EmbedCardManager(context)
  setLiveEmbedCards(manager)
  const mountView = (doc: string): EditorView => {
    mainView = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          liveDecorationsField, mermaidFencesField, liveEmbedCardsHostMark, liveEmbed,
          manager.mainDocChangeFilter(),
          EditorState.transactionExtender.of((tr) => {
            if (tr.docChanged) manager.remapSources(tr.changes, tr.startState.doc)
            return null
          }),
        ],
      }),
      parent: document.body,
    })
    return mainView
  }
  return {
    manager, sent, mountView,
    setParentMode(mode: 'reading' | 'live') {
      parentMode = mode
      manager.notifyParentModeChanged()
    },
  }
}

/** 装载 + 内部 Live 绑定闭环（逐笔应答全部在途 hover.request 与 refEdit.bind） */
async function driveLoaded(h: ReturnType<typeof setup>, live: boolean): Promise<void> {
  const answeredReq = new Set<number>()
  for (;;) {
    const pending = h.sent.filter((m) => m.kind === 'hover.request' &&
      !answeredReq.has(m.reqId)) as Array<Extract<WebviewToHost, { kind: 'hover.request' }>>
    if (pending.length === 0) break
    for (const req of pending) {
      answeredReq.add(req.reqId)
      if (!h.manager.notifyResult(resultOk(req, req.target))) {
        throw new Error('hover.result 未配对在途请求')
      }
    }
  }
  if (answeredReq.size === 0) {
    throw new Error('hover.request 未发出（表格行可能未被识别为 TableRow）')
  }
  if (!live) return
  const answeredBind = new Set<number>()
  for (;;) {
    const pending = h.sent.filter((m) => m.kind === 'refEdit.bind' &&
      !answeredBind.has(m.reqId)) as Array<Extract<WebviewToHost, { kind: 'refEdit.bind' }>>
    if (pending.length === 0) break
    for (const bind of pending) {
      answeredBind.add(bind.reqId)
      h.manager.notifyBound({
        kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
        portId: `port-${bind.reqId}`, fsPath: bind.fsPath, docUri: B_DOC_URI, version: 2, dirty: false,
      })
      h.manager.notifyPush({
        kind: 'refEdit.push', portId: `port-${bind.reqId}`, fsPath: bind.fsPath,
        message: { kind: 'init', sessionId: `port-${bind.reqId}`, docUri: B_DOC_URI, version: 2, text: TARGET_TEXT },
      })
    }
  }
}

function counts(h: ReturnType<typeof setup>): { req: number; bind: number; unbind: number; closeQuery: number } {
  return {
    req: h.sent.filter((m) => m.kind === 'hover.request').length,
    bind: h.sent.filter((m) => m.kind === 'refEdit.bind').length,
    unbind: h.sent.filter((m) => m.kind === 'refEdit.unbind').length,
    closeQuery: h.sent.filter((m) => m.kind === 'refEdit.close.query').length,
  }
}

function embedEditors(): number {
  return document.querySelectorAll('.vsidian-embed-card .vsidian-embed-card-live .cm-editor').length
}

/** 表格行结构（生产口径：lezer 树 + tableRowsAt） */
function rowsAt(view: EditorView, needle: string) {
  const at = view.state.doc.toString().indexOf(needle)
  return tableRowsAt(view.state, at, view.state.field(liveDecorationsField).tree)
}

describe('P2-08 表格格内嵌入继承内部 Live', () => {
  it('表头/数据格（转义别名）自动继承：解码 inner、源码区间保真、独立端口与编辑器', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const probes = h.manager.probe()
    expect(probes.length).toBe(3)
    for (const p of probes) {
      expect(p.host).toBe('live')
      expect(p.internalMode, `${p.inner} 继承内部 Live`).toBe('live')
      expect(p.liveBound, `${p.inner} 端口绑定`).toBe(true)
      expect(p.liveTextLen).toBe(TARGET_TEXT.length)
    }
    // 解码语义：inner 不含反斜杠（\| → |）
    expect(probes.map((p) => p.inner).sort()).toEqual(['乙笔记|e', '目标笔记|别名', '目标笔记|头别名'])
    // 请求区间 slice 回源文恰为嵌入原文（含 \|）——源码坐标不混解码偏移
    const reqs = h.sent.filter((m) => m.kind === 'hover.request') as Array<
      Extract<WebviewToHost, { kind: 'hover.request' }>
    >
    const aliasReq = reqs.find((r) => r.target === '目标笔记|别名')!
    expect(view.state.doc.sliceString(aliasReq.sourceStart, aliasReq.sourceEnd))
      .toBe('![[目标笔记\\|别名]]')
    expect(embedEditors()).toBe(3)
    view.destroy()
    h.manager.dispose()
  })

  it('B 输入只写 B；同格邻文打字实例平移零风暴（表格上下文的 mapPos 路径）', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    // B 输入（数据格别名位）：edit.request 出站、A 文本不动
    const a0 = view.state.doc.toString()
    expect(h.manager.typeInEmbed('目标笔记|别名', 6, '!')).toBe(true)
    expect(h.sent.some((m) => m.kind === 'refEdit.message')).toBe(true)
    expect(view.state.doc.toString()).toBe(a0)
    // A 同格「甲」后打字：嵌入区间右移——零重载零重绑零拦截（P2-07 平移路径）
    const at = a0.indexOf('甲 ')
    const c0 = counts(h)
    view.dispatch({ changes: { from: at + 1, to: at + 1, insert: '丙' } })
    expect(counts(h)).toEqual(c0)
    expect(embedEditors()).toBe(3)
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-08 父表格结构编辑不误伤嵌入实例与端口（保文本重定位）', () => {
  it('列移动（嵌入列 → 列 2 槽）：放行不弹确认、实例键迁移、端口与 B 现场保持', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    h.manager.testSetSelection('目标笔记|别名', 4, 9)
    const ports0 = h.manager.probe().map((p) => p.livePortId).sort()
    const c0 = counts(h)
    // 生产规划器：列 1（表头嵌入列 + 数据格嵌入列）移到列 2 槽位
    const rows = rowsAt(view, '头B')!
    expect(rows.length).toBeGreaterThanOrEqual(4)
    const plan = planTableColumnMove(view.state.doc.toString(), rows, 0, 2,
      view.state.selection.main.head)
    expect(plan).toBeTruthy()
    view.dispatch({
      changes: plan!.changes,
      ...(plan!.selection !== undefined ? { selection: { anchor: plan!.selection } } : {}),
    })
    const after = view.state.doc.toString()
    // 结构编辑完成（不被拦截吞掉）：嵌入列移到列 2、转义管道逐字保留
    expect(after.split('\n')[2]).toBe('| 头B | ![[目标笔记\\|头别名]] | 头C |')
    expect(after.split('\n')[4]).toBe('| 普一格 | 甲 ![[目标笔记\\|别名]] 乙 | 普二格 |')
    // 零弹窗、零端口重建、零重载（键迁移命中重定位）
    expect(counts(h)).toEqual(c0)
    expect(embedEditors()).toBe(3)
    // 端口身份不变（三枚全存活）
    expect(h.manager.probe().map((p) => p.livePortId).sort()).toEqual(ports0)
    view.destroy()
    h.manager.dispose()
  })

  it('行移动（嵌入数据行升表头）：放行、迁移、同款零风暴', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const ports0 = h.manager.probe().map((p) => p.livePortId).sort()
    const c0 = counts(h)
    // 生产规划器：数据行 1（含嵌入）升表头（拖排行形态）
    const rows = rowsAt(view, '头B')!
    const content = [rows[0]!, ...rows.slice(2)]
    const source = content.findIndex((r) =>
      view.state.doc.sliceString(r.lineFrom, r.lineTo).includes('目标笔记\\|别名'))
    expect(source).toBe(1)
    const plan = planTableRowMove(view.state.doc.toString(), rows, source, 0,
      view.state.selection.main.head)
    expect(plan).toBeTruthy()
    view.dispatch({ changes: plan!.changes })
    const after = view.state.doc.toString()
    expect(after.split('\n')[2]).toContain('甲 ![[目标笔记\\|别名]] 乙')
    expect(counts(h)).toEqual(c0)
    expect(embedEditors()).toBe(3)
    expect(h.manager.probe().map((p) => p.livePortId).sort()).toEqual([...ports0])
    view.destroy()
    h.manager.dispose()
  })

  it('格区粘贴整块重建（未选格逐字保留）：放行且实例迁移', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const c0 = counts(h)
    // 生产粘贴计划：1×1 矩阵落「数据行二」首格——整块重建但嵌入两行原文
    // 逐字保留（valueFor 未选格取原 doc 切片）
    const rows = rowsAt(view, '数据行二')!
    const plan = planTableRegionPaste(view.state.doc.toString(), rows, {
      tableFrom: rows[0]!.lineFrom, rowFrom: 2, rowTo: 2, columnFrom: 0, columnTo: 0,
    }, [['粘贴格']])
    expect(plan).toBeTruthy()
    view.dispatch({ changes: plan!.changes, selection: { anchor: plan!.selection } })
    const after = view.state.doc.toString()
    expect(after).toContain('粘贴格')
    expect(after).toContain('甲 ![[目标笔记\\|别名]] 乙')
    expect(after).toContain('![[目标笔记\\|头别名]]')
    expect(counts(h)).toEqual(c0)
    expect(embedEditors()).toBe(3)
    view.destroy()
    h.manager.dispose()
  })

  it('插列（纯插入不覆盖区间）：实例随坐标平移（既有 mapPos 路径不回归）', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const ports0 = h.manager.probe().map((p) => p.livePortId).sort()
    const c0 = counts(h)
    // 列 3 右插列（插列计划形态：各行「 |」/「 --- |」纯插入，嵌入区间右移但不被覆盖）
    const rows = rowsAt(view, '头B')!
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (const row of rows) {
      changes.push({
        from: row.lineTo, to: row.lineTo,
        insert: row.kind === 'delimiter' ? ' --- |' : ' |',
      })
    }
    view.dispatch({ changes })
    expect(view.state.doc.toString().split('\n')[4])
      .toBe('| 甲 ![[目标笔记\\|别名]] 乙 | 普一格 | 普二格 | |')
    expect(counts(h)).toEqual(c0)
    expect(h.manager.probe().map((p) => p.livePortId).sort()).toEqual(ports0)
    view.destroy()
    h.manager.dispose()
  })
})

describe('P2-08 真删除拦截保持（源文不存活的覆盖变更）', () => {
  it('删嵌入所在行：拦截确认、取消保留；保存并关闭后 A 行删除', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const doc0 = view.state.doc.toString()
    const c0 = counts(h)
    const line = doc0.split('\n')[4]!
    const lineFrom = doc0.split('\n').slice(0, 4).join('\n').length + 1
    // 删除数据行 1（含嵌入）——整行覆盖删除，源文不存活 → 拦截
    view.dispatch({ changes: { from: lineFrom, to: lineFrom + line.length + 1 } })
    expect(view.state.doc.toString()).toBe(doc0)
    expect(counts(h).closeQuery).toBe(c0.closeQuery + 1)
    // 宿主回包 dirty（真实宿主语义）→ 模态开 → 取消：引用保留、端口仍在
    const q1 = lastCloseQuery(h)
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: q1.reqId, fsPath: B_FS, dirty: true, version: 2, relPath: '目标笔记.md',
    })
    expect(h.manager.testDialogAction('cancel')).toBe(true)
    expect(view.state.doc.toString()).toBe(doc0)
    expect(embedEditors()).toBe(3)
    // 再删 → 确认保存并关闭：execute → result closed → 重放被拦删除 → A 行删除
    view.dispatch({ changes: { from: lineFrom, to: lineFrom + line.length + 1 } })
    expect(counts(h).closeQuery).toBe(c0.closeQuery + 2)
    const q2 = lastCloseQuery(h)
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: q2.reqId, fsPath: B_FS, dirty: true, version: 2, relPath: '目标笔记.md',
    })
    expect(h.manager.testDialogAction('save')).toBe(true)
    const exec = h.sent.find((m) => m.kind === 'refEdit.close.execute') as
      Extract<WebviewToHost, { kind: 'refEdit.close.execute' }>
    expect(exec).toBeTruthy()
    h.manager.notifyCloseResult({
      kind: 'refEdit.close.result', reqId: exec.reqId, fsPath: B_FS, outcome: 'closed',
    })
    const after = view.state.doc.toString()
    expect(after).not.toContain('目标笔记\\|别名')
    expect(after).toContain('数据行二')
    view.destroy()
    h.manager.dispose()
  })

  it('删嵌入所在列（源文移除）：拦截确认保持', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const doc0 = view.state.doc.toString()
    const c0 = counts(h)
    // 删列 1（表头嵌入列 + 数据格嵌入列）——生产 deleteColumn 计划（格切分转义感知）
    const rows = rowsAt(view, '头B')!
    const plan = planTableEdit(doc0, rows, doc0.indexOf('目标笔记\\|头别名'), 'deleteColumn')
    expect(plan).toBeTruthy()
    view.dispatch({ changes: plan!.changes, ...(plan!.selection !== undefined ? { selection: { anchor: plan!.selection } } : {}) })
    expect(view.state.doc.toString()).toBe(doc0)
    expect(counts(h).closeQuery).toBe(c0.closeQuery + 1)
    h.manager.testDialogAction('cancel')
    expect(view.state.doc.toString()).toBe(doc0)
    view.destroy()
    h.manager.dispose()
  })

  it('改写嵌入本身（覆盖区间但源文不逐字保留）：拦截——保守确认', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const doc0 = view.state.doc.toString()
    const c0 = counts(h)
    // 整行重写：嵌入别名改成不同文字（覆盖区间、源文不存活）→ 拦截
    const lines = doc0.split('\n')
    const from = lines.slice(0, 4).join('\n').length + 1
    const rewritten = '| 甲 ![[目标笔记\\|新别名]] 乙 | 普一格 | 普二格 |'
    view.dispatch({ changes: { from, to: from + lines[4]!.length, insert: rewritten } })
    expect(view.state.doc.toString()).toBe(doc0)
    expect(counts(h).closeQuery).toBe(c0.closeQuery + 1)
    h.manager.testDialogAction('cancel')
    expect(view.state.doc.toString()).toBe(doc0)
    view.destroy()
    h.manager.dispose()
  })
})

describe('#320 重定位扫描预算（巨量文本超限：filter 放行 + remap 冻结）', () => {
  /** 巨量填充文本（确保超过单枚变更插入文本预算） */
  function bigFiller(extra = 128): string {
    const unit = '巨量填充行。\n'
    return unit.repeat(Math.ceil((RELOCATION_SCAN_LIMITS.insertTextLength + extra) / unit.length))
  }

  it('巨量全选替换（源文不在插入文本中）：超限放行不弹确认，实例冻结原位（回填缓存命中）', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const c0 = counts(h)
    const big = `# 全新文档\n${bigFiller()}`
    expect(big.length).toBeGreaterThan(RELOCATION_SCAN_LIMITS.insertTextLength)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: big } })
    // 超限是「无法判定存活」而非「判定已删」：不命中删除拦截——事务
    // 应用成功、零确认弹窗（预算内源文不存活的覆盖变更照常拦截，见上组）
    expect(view.state.doc.toString()).toBe(big)
    expect(counts(h).closeQuery).toBe(c0.closeQuery)
    // remap 侧超限与未命中同待遇：死键冻结在原坐标——原位回填（0 处插回
    // 原文）装载缓存命中（零重发，undo/删表回填同款恢复形态）
    view.dispatch({ changes: { from: 0, to: 0, insert: TABLE_DOC } })
    expect(counts(h).req).toBe(c0.req)
    view.destroy()
    h.manager.dispose()
  })

  it('巨量全选替换（源文逐字在插入文本中）：放行但超限不重定位——新坐标重挂按新实例装载', async () => {
    const h = setup({ parentMode: 'live' })
    const view = h.mountView(TABLE_DOC)
    await driveLoaded(h, true)
    const c0 = counts(h)
    // 表格段（含全部嵌入源文）逐字拼在新文档头部 + 巨量填充垫后：保文本
    // 形态成立，但单枚插入文本超预算——存活无法在预算内判定。头部短前缀
    // 与原文前缀长度不同（迁移坐标不撞原键，不触撞键防御冻结）
    const tableStart = TABLE_DOC.indexOf('| ![[')
    const big = `# 新\n\n${TABLE_DOC.slice(tableStart)}${bigFiller()}`
    expect(big.length).toBeGreaterThan(RELOCATION_SCAN_LIMITS.insertTextLength)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: big } })
    expect(view.state.doc.toString()).toBe(big)
    expect(counts(h).closeQuery).toBe(c0.closeQuery)
    // 冻结而非重定位：键冻结在原坐标，新坐标 occurrence 重挂不命中 →
    // 重新装载（req 重发）；若误走重定位则端口保持零重发
    expect(counts(h).req).toBeGreaterThan(c0.req)
    view.destroy()
    h.manager.dispose()
  })

  it('超长嵌入源文（raw 超预算）的覆盖重写：放行但超限不重定位——新实例装载', async () => {
    const h = setup({ parentMode: 'live' })
    const longAlias = '长'.repeat(RELOCATION_SCAN_LIMITS.sourceTextLength + 64)
    const doc = `# 超长嵌入\n\n前缀 ![[目标笔记|${longAlias}]] 后缀\n`
    const view = h.mountView(doc)
    await driveLoaded(h, true)
    const c0 = counts(h)
    // 整文档重写（嵌入严格在覆盖区间内部——坍缩候选成立，与列/行移动的
    // 保文本形态同构）且逐字保留源文：raw 超预算 → 存活无法判定
    const rewritten = `# 超长嵌入改\n\n前缀 ![[目标笔记|${longAlias}]] 后缀`
    view.dispatch({ changes: { from: 0, to: doc.length - 1, insert: rewritten } })
    expect(view.state.doc.toString()).toBe(`${rewritten}\n`)
    expect(counts(h).closeQuery).toBe(c0.closeQuery)
    // 预算内同形态（列/行移动用例）走重定位迁移零重发；raw 超预算 → 冻结
    // 原位（标题偏移已变）→ 新位置重挂不命中 → 重新装载
    expect(counts(h).req).toBe(c0.req + 1)
    view.destroy()
    h.manager.dispose()
  })

  /** 多枚变更场景文档：长标题行 + 行内嵌入行（嵌入严格在行内、非行首） */
  function manyChangesDoc(): string {
    return `#${'x'.repeat(200)}\n\n前缀 ![[目标笔记]] 后缀\n`
  }

  it('多枚变更耗尽命中扫描预算（64 枚 miss + 第 65 枚含源文）：预算耗尽枚按超限放行冻结，不误判真删除', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = manyChangesDoc()
    const view = h.mountView(doc)
    await driveLoaded(h, true)
    const c0 = counts(h)
    const lineFrom = doc.indexOf('前缀')
    // 65 枚变更按文档序：标题行内 64 枚单字符替换（插入文本不含源文——
    // miss 扫描各消耗 1 次预算；多枚形态与 planTableColumnMove 每行一枚
    // 同构，65 行表格列移动、嵌入行最后即此分布）+ 嵌入行重写（源文逐字
    // 在场、偏移已变）。预算耗尽后**确实未被检视**的第 65 枚必须按
    // 「无法判定存活」（'over-budget'）处理，不得返回 null 冒充真删除
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let i = 0; i < 64; i++) {
      changes.push({ from: 1 + i * 3, to: 2 + i * 3, insert: 'y' })
    }
    const rewritten = '前缀改 ![[目标笔记]] 后缀改'
    changes.push({ from: lineFrom, to: doc.length - 1, insert: rewritten })
    view.dispatch({ changes })
    // 超限放行：事务应用成功（64 处标题替换 + 嵌入行重写完成）、零确认弹窗
    const expectedTitle = `#${'yxx'.repeat(64)}${'x'.repeat(8)}`
    expect(view.state.doc.toString()).toBe(`${expectedTitle}\n\n${rewritten}\n`)
    expect(counts(h).closeQuery).toBe(c0.closeQuery)
    // remap 侧同因超限冻结：源文偏移已变，新位置重挂不命中冻结键 →
    // 重新装载（req 重发）
    expect(counts(h).req).toBe(c0.req + 1)
    view.destroy()
    h.manager.dispose()
  })

  it('对照：全部枚完整检视的 miss（63 枚替换 + 末枚不含源文重写、预算恰好用满）仍是真删除——照常拦截不误放行', async () => {
    const h = setup({ parentMode: 'live' })
    const doc = manyChangesDoc()
    const view = h.mountView(doc)
    await driveLoaded(h, true)
    const doc0 = view.state.doc.toString()
    const c0 = counts(h)
    const lineFrom = doc.indexOf('前缀')
    // 64 枚变更全部 miss：63 枚标题替换 + 第 64 枚嵌入行改写为不含源文
    // 文本——第 64 枚扫描时预算余 1，**完整检视**（无「未检视的变更」），
    // 结果是 null（真删除）：预算守卫不得把完整检视的 miss 升为超限放行
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let i = 0; i < 63; i++) {
      changes.push({ from: 1 + i * 3, to: 2 + i * 3, insert: 'y' })
    }
    changes.push({ from: lineFrom, to: doc.length - 1, insert: '整行改写，嵌入没了' })
    view.dispatch({ changes })
    expect(view.state.doc.toString()).toBe(doc0)
    expect(counts(h).closeQuery).toBe(c0.closeQuery + 1)
    h.manager.testDialogAction('cancel')
    expect(view.state.doc.toString()).toBe(doc0)
    view.destroy()
    h.manager.dispose()
  })
})

function lastCloseQuery(h: ReturnType<typeof setup>): Extract<WebviewToHost, { kind: 'refEdit.close.query' }> {
  const q = h.sent.filter((m) => m.kind === 'refEdit.close.query').at(-1) as
    Extract<WebviewToHost, { kind: 'refEdit.close.query' }>
  if (!q) throw new Error('close.query 未发出')
  return q
}
