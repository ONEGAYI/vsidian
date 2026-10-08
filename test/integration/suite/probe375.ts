// #375（V01）真宿主探针：补写块 ID 与尽力撤销的「目标补 ID＋来源接受」
// 协调路径验证。规格锚点：docs/specs/wikilink-completion.md「文档查询、块
// ID 与撤销」与「失败、容量与交付口径」节；票面 docs/specs/
// wikilink-completion-tickets/v01.md；结论与放行判断见
// docs/research/wikilink-completion-v01-probe.md。
//
// 定位：研究工件——不实现候选 UI，只在 1.82.3 真宿主中验证现有文档与历史
// 管线能否协调 T05 将实现的序列：「无 ID 块选定 → 目标文档补写 ^id → 来源
// 接受链接 → 来源撤销时尽力撤回新增 ID → 重做重核」，并给出可实施的安全
// 判据与失败收尾结论。
//
// 与生产的同源性（不新造镜像 mock 管线）：
// - 块边界 / ID 双形态 / 查重 / 插入计划：src/shared/blockId.ts（生产单一
//   事实源，与 syncController.copyBlockLinkOf 同一套判定）
// - 补写后定位核对：src/host/wikilinkTarget.findBlockOffset（现有跳转口径）
// - 目标侧写入原语：WorkspaceEdit（与 DocumentSession 的
//   HostDocumentPort.applyChanges 同一宿主原语；B 无面板时 TextDocument
//   经 openTextDocument 装载后仍可写）
// - 来源侧接受：edit.request 经 _test.injectWebviewMessage 注入生产
//   DocumentSession（真实 applyChanges / ack / 广播链路）
// - 来源撤销：活动 custom editor 上的全局 undo（生产 port.undo 路线）；
//   临时激活 B 的 undo 路线（P2-01 已验证）只做反证演示
// - 尽力撤回（本探针验证的核心假设）：正向 WorkspaceEdit delete ＋「补 ID
//   后版本未变」＋「标记逐字在场」双守卫——undo 路线无法保证只撤回新增
//   标记（case 3 反证其会吃掉 B 的无关输入）
//
// 证据行前缀 [V01]，落入 .vscode-test/integration-dev.log（定向复现：
// VSIDIAN_TEST_CASES='V01'）。断言只钉硬边界：B 的无关输入永不回退、既有
// ID 永不清理、磁盘永不自动写入、A/B 撤销互不波及、TextDocumentChangeReason
// 与版本变化可观测。每用例收尾把缓冲与磁盘还原回 fixture 字节（脏文档关闭
// 会触发宿主保存确认，拖垮无头宿主——probe278 同款教训）。
import * as vscode from 'vscode'
import {
  blockIdOfLine,
  blockRangeOfLine,
  collectBlockIds,
  generateBlockId,
  planBlockIdInsertion,
  standaloneBlockIdAfterBlock,
  standaloneBlockIdOf,
} from '../../../src/shared/blockId'
import { findBlockOffset } from '../../../src/host/wikilinkTarget'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const CMD = {
  sessionState: 'onegayi.vsidian._test.getSessionState',
  injectMessage: 'onegayi.vsidian._test.injectWebviewMessage',
  viewState: 'onegayi.vsidian._test.requestViewState',
  conflictState: 'onegayi.vsidian._test.getConflictState',
  refPortStats: 'onegayi.vsidian._test.refPortStats',
} as const

// #366 T17：本地 env 优先；SSH 远端会话读不到本地 env（远端 ext host 不
// 继承），从 workspaceFolders 推导（vscode-remote uri 的 fsPath 即远端盘面
// 路径，localhost 回环下与本地同路径）。本地会话行为不变。
const wsDir = process.env['WORKSPACE_DIR']
  ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹（应由 runTest.mjs 注入或经 SSH 会话工作区推导）')
}

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

async function poll<T>(
  label: string,
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 20000,
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时：${label}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
}

/** 证据行：写入宿主 stdout（runTest.mjs 落盘 .vscode-test/integration-dev.log） */
function logEv(tag: string, data: Record<string, unknown>): void {
  console.log(`[V01][${tag}] ${JSON.stringify(data)}`)
}

const ci = process.platform === 'win32' || process.platform === 'darwin'
const norm = (u: string): string => (ci ? u.toLowerCase() : u)

async function openWith(file: string, beside = false): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE, beside
    ? vscode.ViewColumn.Beside
    : undefined)
}

async function docOf(file: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(wsUri(file))
}

async function readDisk(file: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(wsUri(file))
  return Buffer.from(bytes).toString('utf8')
}

interface SessionInfo {
  found: boolean
  panels: Array<{ sessionId: string; ready: boolean }>
  version: number
  appliedEdits: number
}

async function sessionInfo(file: string): Promise<SessionInfo> {
  return (await vscode.commands.executeCommand(CMD.sessionState, wsUri(file).toString())) as SessionInfo
}

async function waitSessionReady(file: string): Promise<SessionInfo> {
  return poll(`会话就绪 ${file}`, async () => {
    const info = await sessionInfo(file)
    return info.found && info.panels.some((p) => p.ready) ? info : undefined
  })
}

async function waitActiveCustomTab(file: string): Promise<void> {
  const target = norm(wsUri(file).toString())
  await poll(`活动 tab 为 ${file} 的 custom editor`, () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (!tab || !(tab.input instanceof vscode.TabInputCustom)) return undefined
    return norm(tab.input.uri.toString()) === target ? true : undefined
  })
}

/** webview 视图文本同步等待（accept 广播 / undo 回流的既有管线证据）。
 *  panelIndex 须选**旁观面板**：注入的 edit.request 以面板 0 为请求方，
 *  产线设计请求方收 edit.ack 而非 doc.changed 回声（既有 undo 用例同样
 *  只对非请求面板断言视图同步） */
async function waitViewText(file: string, match: (text: string) => boolean, label: string, panelIndex: number): Promise<void> {
  await poll(label, async () => {
    const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri(file).toString(), panelIndex)) as
      | { text?: string }
      | undefined
    return v?.text !== undefined && match(v.text) ? true : undefined
  })
}

// ---- 文档行工具（宿主文本坐标；\r 计入行宽——与 wikilinkTarget 的
// lineStarts 同口径。fixture 全 LF，CRLF 目标的行尾适配留给 T05） ----

function strippedLines(text: string): string[] {
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

/** 行首 offset（宿主文本坐标） */
function lineStartsOf(text: string): number[] {
  const starts: number[] = []
  let offset = 0
  for (const rawLine of text.split('\n')) {
    starts.push(offset)
    offset += rawLine.length + 1
  }
  return starts
}

/** 行尾 offset（宿主文本坐标；剥 \r 后正文的末尾——标记插在 \r 之前会破坏
 *  CRLF 文档，本探针 fixture 全 LF，CRLF 适配属 T05 实施事项） */
function lineEndOffset(text: string, lineIndex: number): number {
  const starts = lineStartsOf(text)
  const rawLine = text.split('\n')[lineIndex]!
  return starts[lineIndex]! + (rawLine.endsWith('\r') ? rawLine.length - 1 : rawLine.length)
}

/** 按内容定位行索引（探针跨步骤寻块——插入会让行号漂移，内容锚稳定） */
function lineOfContent(text: string, needle: string): number {
  const lines = strippedLines(text)
  const idx = lines.findIndex((l) => l.includes(needle))
  if (idx < 0) {
    throw new Error(`fixture 缺少锚点行：${needle}`)
  }
  return idx
}

// ---- 变更原因与版本观测（票面要求核对 TextDocumentChangeReason／版本变化） ----

interface ReasonEvent {
  version: number
  reason: number | undefined
}

function trackReasons(uriString: string): { events: ReasonEvent[]; dispose(): void } {
  const events: ReasonEvent[] = []
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (norm(e.document.uri.toString()) === norm(uriString)) {
      // 1.82.3 的 reason：Undo=2 / Redo=1 / 其余（含 WorkspaceEdit 正向编辑）= undefined
      events.push({ version: e.document.version, reason: e.reason })
    }
  })
  return { events, dispose: () => sub.dispose() }
}

// ---- T05 协调序列的探针侧实现（给 T05 的可实施判据载体） ----

/** 确定性随机（探针报告可复现；生产为 Math.random 缺省） */
let randomSeed = 20261006
const probeRandom = (): number => {
  randomSeed = (randomSeed * 1664525 + 1013904223) % 4294967296
  return randomSeed / 4294967296
}

interface TargetIdPlan {
  kind: 'reused' | 'planned'
  id: string
  /** planned 专有：插入文本（'\n\n^id'）与插入点（宿主文本坐标，块尾行行尾） */
  insertText?: string
  insertOffset?: number
}

/** 目标块补写计划（生产口径）：块边界与既有 id 三落点判定与
 *  syncController.copyBlockLinkOf 同源（shared/blockId 单一事实源） */
function planTargetBlockId(text: string, targetLine: number): TargetIdPlan | null {
  const lines = strippedLines(text)
  const block = blockRangeOfLine(lines, targetLine)
  if (!block) {
    return null
  }
  const lastLine = lines[block.end] ?? ''
  // 已有 id 三落点：块尾行行尾形态、块尾行自身（紧贴独立行被块区间吞并）、
  // 块尾之后跨空行首个非空行（空行隔开的独立行）
  const existing =
    blockIdOfLine(lastLine) ?? standaloneBlockIdOf(lastLine) ?? standaloneBlockIdAfterBlock(lines, block)
  if (existing !== null) {
    return { kind: 'reused', id: existing }
  }
  const id = generateBlockId(collectBlockIds(lines), probeRandom)
  return {
    kind: 'planned',
    id,
    insertText: planBlockIdInsertion(id),
    insertOffset: lineEndOffset(text, block.end),
  }
}

/** 与产品写回同原语：经 WorkspaceEdit 插入（offset 为文档当前文本坐标） */
async function insertAt(doc: vscode.TextDocument, offset: number, text: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, doc.positionAt(offset), text)
  return vscode.workspace.applyEdit(edit)
}

/** 本次新增 id 的撤回记录（只记录本次新增与来源接受之间的因果关系） */
interface AddedIdRecord {
  id: string
  marker: string
  offset: number
  /** 补 ID 生效后的目标版本（撤回守卫的核对基准） */
  versionAfterInsert: number
}

type WithdrawOutcome = {
  kept: boolean
  reason: 'withdrawn' | 'version-changed' | 'marker-changed' | 'apply-failed' | 'origin-closed'
}

/** 尽力撤回守卫（V01 核心假设，给 T05 的可实施判据）：
 *  1. 目标版本自补 ID 后未变（挡住一切并发修改——含用户输入与 undo/redo）；
 *  2. 标记在记录 offset 逐字在场（防御纵深：版本不变时标记必然原样，
 *     不符即跳过）；
 *  3. 两关全过才正向 delete 精确移除标记文本——绝不调用 undo（undo 撤销
 *     的是目标最近一笔编辑，无法保证是本次新增标记，case 3 反证）。
 *  任何不符：保留 ID 并返回结构化结果（toast 的判定数据源）。 */
async function withdrawAddedId(doc: vscode.TextDocument, record: AddedIdRecord): Promise<WithdrawOutcome> {
  if (doc.version !== record.versionAfterInsert) {
    return { kept: true, reason: 'version-changed' }
  }
  if (doc.getText().slice(record.offset, record.offset + record.marker.length) !== record.marker) {
    return { kept: true, reason: 'marker-changed' }
  }
  const edit = new vscode.WorkspaceEdit()
  edit.delete(
    doc.uri,
    new vscode.Range(doc.positionAt(record.offset), doc.positionAt(record.offset + record.marker.length)),
  )
  const ok = await vscode.workspace.applyEdit(edit)
  return ok ? { kept: false, reason: 'withdrawn' } : { kept: true, reason: 'apply-failed' }
}

/** 补 ID 全步（plan → insert → 记录），失败即抛 */
async function addBlockIdTo(doc: vscode.TextDocument, targetLine: number): Promise<AddedIdRecord & { plan: TargetIdPlan }> {
  const plan = planTargetBlockId(doc.getText(), targetLine)
  assert(plan?.kind === 'planned' && plan.insertText !== undefined && plan.insertOffset !== undefined,
    `目标块应可计划补写（实际 ${JSON.stringify(plan)}）`)
  assert(await insertAt(doc, plan.insertOffset, plan.insertText), '目标补 ID 的 WorkspaceEdit 应成功')
  await poll('目标补 ID 生效', () => (doc.getText().includes(plan.insertText!) ? true : undefined))
  return { id: plan.id, marker: plan.insertText, offset: plan.insertOffset, versionAfterInsert: doc.version, plan }
}

/** 来源侧接受（生产 DocumentSession 链路）：edit.request 注入后由调用方
 *  poll 权威文本；seq 全局递增避免 ackCache 撞号。会话已退役时不在此
 *  拦截——继续注入由测试钩子抛原生「无可用会话面板」（迟到拒收的证据面） */
let acceptSeq = 0
async function acceptLinkViaSession(file: string, changes: Array<{ offset: number; length: number; text: string }>, baseVersionOverride?: number): Promise<void> {
  const info = await sessionInfo(file)
  acceptSeq += 1
  await vscode.commands.executeCommand(CMD.injectMessage, wsUri(file).toString(), {
    kind: 'edit.request',
    sessionId: '',
    docUri: wsUri(file).toString(),
    seq: acceptSeq,
    baseVersion: baseVersionOverride ?? (info.found ? info.version : 0),
    changes,
  })
}

/** 用例收尾统一还原：缓冲回原字节；若磁盘被保存改过则再落盘，保证干净 */
async function restoreAll(entries: Array<{ doc: vscode.TextDocument; original: string }>): Promise<void> {
  for (const e of entries) {
    const current = e.doc.getText()
    if (current === e.original && !e.doc.isDirty) continue
    const edit = new vscode.WorkspaceEdit()
    edit.replace(e.doc.uri, new vscode.Range(e.doc.positionAt(0), e.doc.positionAt(current.length)), e.original)
    assert(await vscode.workspace.applyEdit(edit), `${e.doc.uri.fsPath} 还原编辑应成功`)
    if (e.doc.isDirty) {
      assert(await e.doc.save(), `${e.doc.uri.fsPath} 还原落盘应成功`)
    }
    await poll(`${e.doc.uri.fsPath} 干净`, () =>
      !e.doc.isDirty && e.doc.getText() === e.original ? true : undefined)
  }
}

/** 关闭指定文件的普通文本标签（case 3 临时激活演示的收口） */
async function closeTextTabsOfFile(file: string): Promise<void> {
  const target = norm(wsUri(file).toString())
  const hits = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
    t.input instanceof vscode.TabInputText && norm(t.input.uri.toString()) === target)
  for (const h of hits) {
    await vscode.window.tabGroups.close(h)
  }
}

export const probe375Cases: Array<[string, () => Promise<void>]> = [

  // ---- 验收标准 1：普通可写、版本未变的跨文档案例——尝试撤回新增 ID，
  // 来源链接按现有历史撤销；重做重核恢复或重建映射 ----
  ['V01 跨文档：补 ID＋来源接受，一笔撤销撤回新增 ID，重做重建（#375）', async () => {
    const aFile = 'v01-cross-a.md'
    const bFile = 'v01-cross-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    const aReasons = trackReasons(aDoc.uri.toString())
    const bReasons = trackReasons(bDoc.uri.toString())
    try {
      // 双面板：面板 0 为接受请求方，面板 1 为旁观面板（视图同步断言落点）
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await openWith(aFile, true)
      await poll('A 双面板就绪', async () => {
        const info = await sessionInfo(aFile)
        return info.found && info.panels.filter((p) => p.ready).length >= 2 ? info : undefined
      })
      const bVer0 = bDoc.version

      // 1. 目标补 ID（普通可写、版本未变路径）
      const added = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), '跨文档目标段落行一'))
      // 补写后现有跳转口径立即可定位（wikilinkTarget 同源）
      const located = findBlockOffset(bDoc.getText(), added.id)
      assert(located !== null && located.offset === 0, `补写后 findBlockOffset 应定位块首（实际 ${JSON.stringify(located)}）`)
      logEv('cross-id-added', {
        id: added.id, bVer: `${bVer0}→${bDoc.version}`, bDirty: bDoc.isDirty,
        bReasons: bReasons.events, diskUntouched: (await readDisk(bFile)) === B0,
      })

      // 2. 来源接受（生产 DocumentSession：edit.request → applyChanges）；
      // 视图同步断言落在旁观面板 1（请求方面板 0 收 edit.ack 不回声——产线
      // 设计，见 waitViewText 注释）
      const link = `[[v01-cross-b.md#^${added.id}|跨目标]]`
      const linkOffset = A0.indexOf('落点锚') + '落点锚'.length
      await acceptLinkViaSession(aFile, [{ offset: linkOffset, length: 0, text: link }])
      await poll('A 接受链接写入权威文本', () => (aDoc.getText().includes(link) ? true : undefined))
      await waitViewText(aFile, (t) => t === aDoc.getText(), 'A 旁观面板同步链接', 1)
      assert(aDoc.isDirty, '来源接受后 A dirty（不自动保存）')
      assert(bDoc.getText().includes(added.marker), 'B 的新增标记不受来源接受影响')

      // 3. 来源撤销：全局 undo（A 活动 custom editor——生产 port.undo 路线）
      await vscode.commands.executeCommand('undo')
      await poll('A 链接被一笔撤销', () => (!aDoc.getText().includes(link) ? true : undefined))
      await waitViewText(aFile, (t) => t === aDoc.getText(), 'A 旁观面板同步撤销回退', 1)
      const aUndoReason = aReasons.events.find((e) => e.reason === vscode.TextDocumentChangeReason.Undo)
      assert(aUndoReason !== undefined, 'A 撤销的 reason 应可观测为 TextDocumentChangeReason.Undo')
      // A 的撤销不波及 B（跨文档硬边界）
      assert(bDoc.getText().includes(added.marker), 'A 的 undo 不得波及 B')
      assert(bReasons.events.every((e) => e.reason !== vscode.TextDocumentChangeReason.Undo), 'B 不得出现 undo 原因的变更')
      logEv('cross-undo', {
        aVer: aDoc.version, aDirty: aDoc.isDirty, aReasons: aReasons.events, bVer: bDoc.version,
      })

      // 4. 尽力撤回 B 的新增 ID（正向 delete + 双守卫）
      const outcome = await withdrawAddedId(bDoc, added)
      logEv('cross-withdraw', { ...outcome, bVer: bDoc.version })
      assert(!outcome.kept && outcome.reason === 'withdrawn', `版本未变时应撤回（实际 ${JSON.stringify(outcome)}）`)
      assert(bDoc.getText() === B0, 'B 应回到原字节')
      assert(bDoc.isDirty, '撤回后 B 不自动保存（仍 dirty）')
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')

      // 5. 重做：来源链接恢复 + 目标重核（标记已安全移除 → 重建映射）
      await vscode.commands.executeCommand('redo')
      await poll('A 重做恢复链接', () => (aDoc.getText().includes(link) ? true : undefined))
      await waitViewText(aFile, (t) => t === aDoc.getText(), 'A 旁观面板同步重做恢复', 1)
      const aRedoReason = aReasons.events.find((e) => e.reason === vscode.TextDocumentChangeReason.Redo)
      assert(aRedoReason !== undefined, 'A 重做的 reason 应可观测为 TextDocumentChangeReason.Redo')
      const recheck = planTargetBlockId(bDoc.getText(), lineOfContent(bDoc.getText(), '跨文档目标段落行一'))
      assert(recheck?.kind === 'planned', '重做重核：标记已安全移除 → 应重新计划')
      assert(await insertAt(bDoc, recheck.insertOffset!, recheck.insertText!), '重做重建标记应成功')
      await poll('B 重建标记生效', () => (bDoc.getText().includes(recheck.insertText!) ? true : undefined))
      assert(findBlockOffset(bDoc.getText(), recheck.id) !== null, '重建标记后定位应有效')
      logEv('cross-redo-rebuild', { id: recheck.id, bVer: bDoc.version, bReasons: bReasons.events })
      assert(await readDisk(bFile) === B0, '全程 B 磁盘不得自动写入')
    } finally {
      aReasons.dispose()
      bReasons.dispose()
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],

  // ---- 验收标准 2 前半：同文档引用——补 ID 与链接插入合为该文档内一笔
  // 受控操作（一份 edit.request / 一个版本步进 / undo 一次同时回退） ----
  ['V01 同文档：补 ID 与链接插入合为一笔受控操作（#375）', async () => {
    const aFile = 'v01-same-a.md'
    const A0 = await readDisk(aFile)
    const aDoc = await docOf(aFile)
    const reasons = trackReasons(aDoc.uri.toString())
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await waitSessionReady(aFile)
      const plan = planTargetBlockId(aDoc.getText(), lineOfContent(aDoc.getText(), '同文档段落行一'))
      assert(plan?.kind === 'planned' && plan.insertText !== undefined && plan.insertOffset !== undefined,
        `同文档目标块应可计划补写（实际 ${JSON.stringify(plan)}）`)
      const link = `[[v01-same-a.md#^${plan.id}|自身]]`
      const linkOffset = A0.indexOf('落点锚') + '落点锚'.length
      const vBefore = aDoc.version

      // 一笔受控操作：同一 edit.request 携带两段插入（两 offset 均以请求时
      // 文档为基准——生产 edit.request 的 SerChange 语义；LF fixture 下
      // webview LF 坐标与宿主坐标一致）
      await acceptLinkViaSession(aFile, [
        { offset: plan.insertOffset, length: 0, text: plan.insertText },
        { offset: linkOffset, length: 0, text: link },
      ])
      await poll('同文档补 ID 与链接同时生效', () =>
        aDoc.getText().includes(plan.insertText!) && aDoc.getText().includes(link) ? true : undefined)
      assert(aDoc.version === vBefore + 1, `一次接受应恰一个版本步进（${vBefore} → ${aDoc.version}）`)
      assert(aDoc.isDirty, '同文档接受后 dirty（不自动保存）')
      assert(findBlockOffset(aDoc.getText(), plan.id) !== null, '同文档补写后定位应有效')
      logEv('same-accepted', { id: plan.id, aVer: `${vBefore}→${aDoc.version}`, reasons: reasons.events })

      // 一笔撤销：两者同时回退（合笔的直接证据）
      await vscode.commands.executeCommand('undo')
      await poll('同文档一笔撤销同时回退补 ID 与链接', () => (aDoc.getText() === A0 ? true : undefined))
      assert(reasons.events.some((e) => e.reason === vscode.TextDocumentChangeReason.Undo), '撤销 reason 可观测')
      logEv('same-undo', { aVer: aDoc.version, aDirty: aDoc.isDirty, reasons: reasons.events })

      // 重做恢复两段
      await vscode.commands.executeCommand('redo')
      await poll('同文档重做恢复两段', () =>
        aDoc.getText().includes(plan.insertText!) && aDoc.getText().includes(link) ? true : undefined)
      assert(await readDisk(aFile) === A0, '全程磁盘不得自动写入')
    } finally {
      reasons.dispose()
      await restoreAll([{ doc: aDoc, original: A0 }])
    }
  }],

  // ---- B 未保存：dirty 目标上的守卫撤回 + undo 路线反证（不得撤销 B 的
  // 无关输入——undo 撤的是「最近一笔」，与本轮新增标记无对应关系） ----
  ['V01 B 未保存：dirty 目标的撤回守卫与 undo 路线反证（#375）', async () => {
    const aFile = 'v01-dirty-a.md'
    const bFile = 'v01-dirty-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    const bReasons = trackReasons(bDoc.uri.toString())
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await waitSessionReady(aFile)

      // B 先有用户未保存输入（dirty，无标签），再补 ID（版本未变路径）
      const userInput = '用户先行输入 '
      assert(await insertAt(bDoc, 0, userInput), 'B 用户输入应成功')
      await poll('B 用户输入生效', () => (bDoc.getText() === `${userInput}${B0}` ? true : undefined))
      assert(bDoc.isDirty, 'B 用户输入后 dirty')
      const added = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), 'dirty 目标段行一'))

      // 来源接受 + 撤销（A 侧），随后守卫撤回（版本自补 ID 后未变 → 允许）
      const link = `[[v01-dirty-b.md#^${added.id}|dirty目标]]`
      await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }])
      await poll('A 接受链接', () => (aDoc.getText().includes(link) ? true : undefined))
      await vscode.commands.executeCommand('undo')
      await poll('A 链接被撤销', () => (!aDoc.getText().includes(link) ? true : undefined))
      const outcome = await withdrawAddedId(bDoc, added)
      logEv('dirty-withdraw', { ...outcome, bVer: bDoc.version })
      assert(!outcome.kept && outcome.reason === 'withdrawn', `dirty+版本未变应撤回（实际 ${JSON.stringify(outcome)}）`)
      // 硬边界：B 的用户输入不被波及、不自动保存
      assert(bDoc.getText() === `${userInput}${B0}`, 'B 的用户输入必须原样保留')
      assert(bDoc.isDirty, 'B 仍 dirty（不自动保存）')
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')

      // ---- undo 路线反证：补 ID 后 B 又有新输入 → 临时激活 B 撤销时，
      // 宿主撤销的是「最近一笔」（用户输入），不是本轮新增标记 ----
      const readded = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), 'dirty 目标段行一'))
      const userInput2 = '用户后行输入 '
      assert(await insertAt(bDoc, 0, userInput2), 'B 第二笔用户输入应成功')
      await poll('B 第二笔输入生效', () => (bDoc.getText().startsWith(userInput2) ? true : undefined))
      const textBeforeDemo = bDoc.getText()
      // P2-01 已验证的临时激活路线（唯一公开路线）：showTextDocument 恒开
      // 文本编辑器 → 全局 undo
      await vscode.window.showTextDocument(bDoc, { preview: true })
      await vscode.commands.executeCommand('undo')
      await poll('undo 撤销 B 最近一笔（用户输入被吃掉）', () =>
        (!bDoc.getText().startsWith(userInput2) && bDoc.getText().includes(readded.marker) ? true : undefined))
      logEv('dirty-undo-route-hazard', {
        undone: '用户后行输入（非本轮标记）', markerStillThere: bDoc.getText().includes(readded.marker),
        bReasons: bReasons.events,
      })
      // 复原演示现场：redo 恢复用户输入
      await vscode.commands.executeCommand('redo')
      await poll('redo 恢复用户输入', () => (bDoc.getText() === textBeforeDemo ? true : undefined))
      // 回 A（B 预览标签可能顶替了 A 的位置——openWith 对已开面板是重显）
      await openWith(aFile)
      await waitActiveCustomTab(aFile)

      // 此后守卫撤回：版本自补 ID 后已变（用户第二笔输入）→ 必须保留 + 结构化结果
      const outcome2 = await withdrawAddedId(bDoc, readded)
      logEv('dirty-withdraw-guarded', { ...outcome2, bVer: bDoc.version })
      assert(outcome2.kept && outcome2.reason === 'version-changed', `版本已变必须保留（实际 ${JSON.stringify(outcome2)}）`)
      assert(bDoc.getText() === textBeforeDemo, '守卫拒收时 B 内容零变化（既不撤标记也不动用户输入）')
    } finally {
      bReasons.dispose()
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
      // B 临时文本标签的收口须在缓冲干净之后（脏标签关闭触发宿主保存确认，
      // 拖垮无头宿主——probe278 同款教训）
      await closeTextTabsOfFile(bFile)
    }
  }],

  // ---- 验收标准 2 后半：已有 ID 复用（三落点）＋块形态矩阵（段落/列表/
  // 围栏的插入计划与定位核对）；已有 ID 永不被清理 ----
  ['V01 块形态矩阵：段落/列表/围栏插入与已有 ID 三落点复用（#375）', async () => {
    const aFile = 'v01-morph-a.md'
    const bFile = 'v01-morph-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await waitSessionReady(aFile)
      const vBefore = bDoc.version

      // 已有 id 三落点：行尾形态 / 跨空行独立行 / 紧贴独立行（块区间吞并）
      const reuseExpect: Array<[string, string]> = [
        ['已有行尾 id 段落', 'keep01'],
        ['独立行 id 上方段落', 'stand01'],
        ['紧贴独立行段落', 'tight01'],
      ]
      for (const [needle, wantId] of reuseExpect) {
        const line = lineOfContent(bDoc.getText(), needle)
        const plan = planTargetBlockId(bDoc.getText(), line)
        assert(plan?.kind === 'reused' && plan.id === wantId,
          `已有 id 应按 ${wantId} 复用（${needle}，实际 ${JSON.stringify(plan)}）`)
      }
      assert(bDoc.version === vBefore && bDoc.getText() === B0, '复用路径零写入')
      logEv('morph-reuse', { points: reuseExpect.map(([, id]) => id), bVer: bDoc.version })

      // 新增矩阵：段落块 / 无空行连续列表块（整体一块）/ 围栏块（闭围栏行后）
      for (const [needle, blockFirstNeedle] of [
        ['形态学段落行二', 'v01 形态学段落一'],
        ['形态列表项二', '- 形态列表项一'],
        ['const fence = 1', '```js'],
      ] as const) {
        const line = lineOfContent(bDoc.getText(), needle)
        const added = await addBlockIdTo(bDoc, line)
        // 定位核对：补写后 findBlockOffset 命中该块块首（现有跳转口径认可）
        const starts = lineStartsOf(bDoc.getText())
        const firstLine = lineOfContent(bDoc.getText(), blockFirstNeedle)
        const located = findBlockOffset(bDoc.getText(), added.id)
        assert(located !== null && located.offset === starts[firstLine],
          `${needle} 补写后定位应命中块首行（期望 offset ${starts[firstLine]}，实际 ${JSON.stringify(located)}）`)
        assert(collectBlockIds(strippedLines(bDoc.getText())).has(added.id), `全文 id 集合应含 ${added.id}`)
        logEv('morph-insert', { block: needle, id: added.id, bVer: bDoc.version })
      }

      // 来源接受用「已有 id」（复用路径无撤回记录）→ 来源撤销后既有 id 原样
      const idsBefore = [...collectBlockIds(strippedLines(bDoc.getText()))].sort()
      const link = '[[v01-morph-b.md#^keep01|形态]]'
      await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }])
      await poll('A 接受已有 id 链接', () => (aDoc.getText().includes(link) ? true : undefined))
      await vscode.commands.executeCommand('undo')
      await poll('A 链接被撤销', () => (!aDoc.getText().includes(link) ? true : undefined))
      const idsAfter = [...collectBlockIds(strippedLines(bDoc.getText()))].sort()
      assert(JSON.stringify(idsAfter) === JSON.stringify(idsBefore),
        `来源撤销不得清理任何既有 id（前 ${JSON.stringify(idsBefore)} 后 ${JSON.stringify(idsAfter)}）`)
      logEv('morph-after-undo', { ids: idsAfter, bVer: bDoc.version })
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],

  // ---- 验收标准 3：目标版本／标记变化——保留 ID 的安全分支与明确结果，
  // 来源撤销继续完成；重做重核不复活被改写的标记 ----
  ['V01 目标被修改：版本/标记变化保留 ID，来源撤销继续，重做不复活（#375）', async () => {
    const aFile = 'v01-mod-a.md'
    const bFile = 'v01-mod-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await waitSessionReady(aFile)
      const added = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), '修改目标段行一'))
      const link = `[[v01-mod-b.md#^${added.id}|修改目标]]`
      await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }])
      await poll('A 接受链接', () => (aDoc.getText().includes(link) ? true : undefined))

      // 撤回前目标被他方修改（别处输入，版本推进）
      const foreignEdit = '他方修改 '
      assert(await insertAt(bDoc, 0, foreignEdit), 'B 他方修改应成功')
      await poll('B 他方修改生效', () => (bDoc.getText().startsWith(foreignEdit) ? true : undefined))

      // 来源撤销继续完成（不因撤回失败阻塞）
      await vscode.commands.executeCommand('undo')
      await poll('来源撤销继续完成', () => (!aDoc.getText().includes(link) ? true : undefined))
      // 守卫：版本变化 → 保留 ID + 结构化结果（toast 判定数据源）
      const outcome = await withdrawAddedId(bDoc, added)
      logEv('mod-version-changed', { ...outcome, bVer: bDoc.version })
      assert(outcome.kept && outcome.reason === 'version-changed', `版本变化必须保留（实际 ${JSON.stringify(outcome)}）`)
      assert(bDoc.getText().startsWith(foreignEdit) && bDoc.getText().includes(added.marker),
        '保留分支：他方修改与新增标记均原样')

      // 重做：来源链接恢复 + 目标重核——标记仍在（版本变化但标记未被改写）
      // → 复用，不重复补写
      await vscode.commands.executeCommand('redo')
      await poll('重做恢复来源链接', () => (aDoc.getText().includes(link) ? true : undefined))
      const recheck = planTargetBlockId(bDoc.getText(), lineOfContent(bDoc.getText(), '修改目标段行一'))
      assert(recheck?.kind === 'reused' && recheck.id === added.id,
        `标记仍在应复用（实际 ${JSON.stringify(recheck)}）`)
      assert(bDoc.getText().split(`^${added.id}`).length - 1 === 1, '复用不得重复补写标记')
      logEv('mod-redo-reuse', { reused: recheck.id, bVer: bDoc.version })

      // ---- 变体：标记本身被用户改写 → 守卫拒收 + 重做不得复活旧标记 ----
      const b2File = 'v01-mod2-b.md'
      const B20 = await readDisk(b2File)
      const b2Doc = await docOf(b2File)
      try {
        const added2 = await addBlockIdTo(b2Doc, lineOfContent(b2Doc.getText(), '修改目标段行一'))
        const mutated = `^mutate${added2.id.slice(0, 2)}x`
        const markerAt = b2Doc.getText().indexOf(added2.marker)
        const edit = new vscode.WorkspaceEdit()
        edit.replace(
          b2Doc.uri,
          new vscode.Range(
            b2Doc.positionAt(markerAt),
            b2Doc.positionAt(markerAt + added2.marker.length),
          ),
          `\n\n${mutated}`,
        )
        assert(await vscode.workspace.applyEdit(edit), '改写标记应成功')
        await poll('改写标记生效', () => (b2Doc.getText().includes(mutated) ? true : undefined))
        const outcome2 = await withdrawAddedId(b2Doc, added2)
        logEv('mod-marker-mutated', { ...outcome2, bVer: b2Doc.version, mutated })
        assert(outcome2.kept, '标记被改写必须保留（不删用户的新标记）')
        // 重做重核：旧 id 不再逐字在场 → 不复活、不重建（悬空留待用户处置）
        const recheck2 = planTargetBlockId(b2Doc.getText(), lineOfContent(b2Doc.getText(), '修改目标段行一'))
        assert(recheck2?.kind === 'reused' && recheck2.id === mutated.slice(1),
          `改写后重核应认用户新标记（实际 ${JSON.stringify(recheck2)}）`)
        assert(!b2Doc.getText().includes(added2.marker), '不得复活/重建旧标记')
        logEv('mod-marker-no-resurrect', { oldId: added2.id, nowId: recheck2.id })
        assert(await readDisk(b2File) === B20, 'B2 磁盘不得自动写入')
      } finally {
        await restoreAll([{ doc: b2Doc, original: B20 }])
      }
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],

  // ---- 验收标准 4 前半：初次接受失败（迟到请求拒收）后的补 ID 收尾——
  // 尽力撤回并给出明确结果 ----
  ['V01 来源接受失败：迟到请求拒收后补 ID 的尽力收尾（#375）', async () => {
    const aFile = 'v01-fail-a.md'
    const bFile = 'v01-fail-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      const session = await waitSessionReady(aFile)

      const added = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), '失败目标段行一'))
      const link = `[[v01-fail-b.md#^${added.id}|失败目标]]`

      // 初次接受失败注入：baseVersion 超前（迟到异常——生产管线的
      // 「webview 版本超前按不可安全应用处理」分支）→ 暂停 + edit.ack fail
      const aheadBase = session.version + 3
      await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }], aheadBase)
      const conflict = (await poll('接受失败进入暂停（可观测警示路径）', async () => {
        const state = (await vscode.commands.executeCommand(CMD.conflictState, wsUri(aFile).toString())) as
          | { found: boolean; suspended?: boolean }
          | undefined
        return state?.found && state.suspended === true ? state : undefined
      })) as { found: boolean; suspended?: boolean }
      assert(!aDoc.getText().includes(link), '接受失败：链接不得进入权威文本')
      logEv('fail-accept-rejected', { aheadBase, sessionVer: session.version, conflict })

      // 收尾：来源未接受 → 新增 ID 尽力撤回（版本核对通过）→ 明确结果
      const outcome = await withdrawAddedId(bDoc, added)
      logEv('fail-withdraw', { ...outcome, bVer: bDoc.version })
      assert(!outcome.kept && outcome.reason === 'withdrawn', `接受失败应收尾撤回（实际 ${JSON.stringify(outcome)}）`)
      assert(bDoc.getText() === B0, '收尾后 B 回到原字节')
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],

  // ---- 验收标准 4 后半：来源/目标关闭与迟到协调——来源面板关闭后迟到
  // 接受注入被钩子拒收（无会话面板）；协调层撤回按「来源已关闭」保留；
  // 目标侧会话从未在场也可写可还原；后台引用端口面保持干净 ----
  ['V01 来源/目标关闭：迟到协调拒收与端口观测（#375）', async () => {
    const aFile = 'v01-close-a.md'
    const bFile = 'v01-close-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    try {
      await openWith(aFile)
      await waitActiveCustomTab(aFile)
      await waitSessionReady(aFile)
      const added = await addBlockIdTo(bDoc, lineOfContent(bDoc.getText(), '关闭目标段行一'))
      const link = `[[v01-close-b.md#^${added.id}|关闭目标]]`
      await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }])
      await poll('A 接受链接', () => (aDoc.getText().includes(link) ? true : undefined))

      const portsBefore = (await vscode.commands.executeCommand(CMD.refPortStats)) as { size: number; portIds: string[] }
      logEv('close-ports-before', portsBefore)

      // 还原 A 缓冲到干净再关标签（脏 custom editor 关闭会触发宿主保存确认，
      // 拖垮无头宿主——probe278 教训）。注意：applyEdit 还原到与磁盘同内容
      // 后 isDirty 不自动清除（宿主 dirty 按 buffer 版本判定，不按内容相等
      // ——restoreAll 同因需 save 落盘），故显式 save（内容未变，落盘幂等）
      const edit = new vscode.WorkspaceEdit()
      edit.replace(aDoc.uri, new vscode.Range(aDoc.positionAt(0), aDoc.positionAt(aDoc.getText().length)), A0)
      assert(await vscode.workspace.applyEdit(edit), '还原 A 缓冲应成功')
      if (aDoc.isDirty) {
        assert(await aDoc.save(), '还原 A 后落盘应成功（内容幂等）')
      }
      await poll('A 干净', () => (!aDoc.isDirty && aDoc.getText() === A0 ? true : undefined))
      // 关闭来源面板（custom tab）
      const aUriString = wsUri(aFile).toString()
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
        t.input instanceof vscode.TabInputCustom &&
        t.input.viewType === VIEW_TYPE && norm(t.input.uri.toString()) === norm(aUriString))
      assert(tabs.length > 0, '应存在来源 custom 标签')
      for (const tab of tabs) {
        await vscode.window.tabGroups.close(tab)
      }
      await poll('来源会话退役', async () => ((await sessionInfo(aFile)).found ? undefined : true))

      // 迟到接受：注入无会话面板 → 钩子拒收（可观测、不波及 B）
      let lateAcceptRejected = false
      let lateAcceptError = ''
      try {
        await acceptLinkViaSession(aFile, [{ offset: A0.indexOf('落点锚') + '落点锚'.length, length: 0, text: link }])
      } catch (err) {
        lateAcceptRejected = true
        lateAcceptError = String((err as Error).message)
      }
      assert(lateAcceptRejected, '来源关闭后的迟到接受注入应被拒收')
      assert(!aDoc.getText().includes(link), '迟到接受不得写入来源权威文本')
      assert(bDoc.getText().includes(added.marker), '迟到接受不得波及 B')

      // 迟到撤回：协调层先核来源在场（因果记录的归属会话）——来源已关闭的
      // 迟到请求一律拒收并保留标记（不抛异常、不动 B）；这是「释放后迟到
      // 结果拒收」在补 ID 协调上的对应面
      const originStillThere = (await sessionInfo(aFile)).found
      assert(!originStillThere, '来源会话应已退役')
      const lateOutcome: WithdrawOutcome = originStillThere
        ? await withdrawAddedId(bDoc, added)
        : { kept: true, reason: 'origin-closed' }
      logEv('close-late', { lateAcceptRejected, lateAcceptError, withdraw: lateOutcome, bVer: bDoc.version })
      assert(lateOutcome.kept && lateOutcome.reason === 'origin-closed',
        `来源关闭的迟到撤回应拒收并保留（实际 ${JSON.stringify(lateOutcome)}）`)
      assert(bDoc.getText().includes(added.marker), '迟到撤回拒收：B 的新增标记保持原样')

      // 目标侧：B 从未以 custom editor 打开（无会话）——TextDocument 仍可
      // 写可还原（本用例收尾即证据）；端口面全程干净
      const bInfo = await sessionInfo(bFile)
      const portsAfter = (await vscode.commands.executeCommand(CMD.refPortStats)) as { size: number; portIds: string[] }
      logEv('close-target-and-ports', { bSessionFound: bInfo.found, portsAfter })
      assert(portsAfter.size === 0, `无嵌入场景端口面应干净（实际 ${JSON.stringify(portsAfter)}）`)
      assert(await readDisk(bFile) === B0, 'B 磁盘不得自动写入')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],
]
