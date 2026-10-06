// V01（#348）附加组件历史分组——真宿主集成用例。
//
// 验证面（票面状态矩阵的宿主侧）：
// - 原子 A / 非原子 B / 原子 C / 非原子 D 的分组撤回单位（ABCD→AB→空→
//   AB→ABCD），全部经真实 edit.request/ack/history.request 管线驱动
//   （探针虚拟面板 + DocumentSession 队列 + WorkspaceEdit 写回）。
// - 合并提交（同组未提交合成一笔）、多范围原子（一笔一撤）、连续非原子、
//   空历史拒绝、无前项拒绝（HistoryBoundaryUnavailable）、Undo 后新写截断
//   Redo、在途 ack、外部写入与历史命令交错、重复撤销连按按组边界。
// - 外部原生编辑器单步撤销触发组完成；映射失配 / 重启重建时明确拒绝且
//   不动文档、不撤销其他文档；宿主实际保留历史与协调器保守拒绝的对应。
// - 引用 B：整组一次临时激活撤回、结束后恢复来源 A、父子目标隔离。
// - webview 重载（B-2）后宿主侧映射与分组继续对应。
// 探针实现与边界：src/host/addonHistoryProbe.ts；纯逻辑契约：
// test/unit/addonHistoryGrouping.test.ts。文本状态固定互不重复（fixture
// 初始各异 + 末尾追加唯一标记），边界对账 = 文本全等 + 版本推进。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

interface SessionState { found: boolean; panels: { ready: boolean }[]; version: number }

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

const AH = {
  attach: 'onegayi.vsidian._test.addonHistory.attach',
  state: 'onegayi.vsidian._test.addonHistory.state',
  submit: 'onegayi.vsidian._test.addonHistory.submit',
  history: 'onegayi.vsidian._test.addonHistory.history',
  externalWrite: 'onegayi.vsidian._test.addonHistory.externalWrite',
  nativeHistory: 'onegayi.vsidian._test.addonHistory.nativeHistory',
  snapshot: 'onegayi.vsidian._test.addonHistory.snapshot',
  restore: 'onegayi.vsidian._test.addonHistory.restore',
  reset: 'onegayi.vsidian._test.addonHistory.reset',
  rebuild: 'onegayi.vsidian._test.addonHistory.rebuild',
  sessionState: 'onegayi.vsidian._test.getSessionState',
  // T03（#352）生产接入点观测：直通提交 / 归属记录 / 组历史
  t03Submit: 'onegayi.vsidian._test.addonHistory.t03Submit',
  t03Attributions: 'onegayi.vsidian._test.addonHistory.t03Attributions',
  t03GroupHistory: 'onegayi.vsidian._test.addonHistory.t03GroupHistory',
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
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

async function openWithEditor(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
}

async function waitSessionReady(file: string): Promise<SessionState> {
  return poll(`会话就绪 ${file}`, async () => {
    const state = (await vscode.commands.executeCommand(AH.sessionState, wsUri(file).toString())) as SessionState | undefined
    if (state?.found && state.panels.some((p) => p.ready)) {
      return state
    }
    return undefined
  })
}

interface ProbeEntry { seq: number; owner: string; opId: string | null; groupId: string | null; atomic: boolean | null; versionBefore: number; versionAfter: number; textBefore: string; textAfter: string }
interface ProbeState { lost: boolean; appliedCount: number; lastRejection: string | null; entries: ProbeEntry[]; version: number; text: string }

async function probeState(uri: string): Promise<ProbeState> {
  return (await vscode.commands.executeCommand(AH.state, uri)) as ProbeState
}

async function setup(file: string): Promise<{ uri: string; doc: vscode.TextDocument }> {
  await openWithEditor(file)
  await waitSessionReady(file)
  const uri = wsUri(file).toString()
  await vscode.commands.executeCommand(AH.attach, uri)
  const doc = await vscode.workspace.openTextDocument(wsUri(file))
  return { uri, doc }
}

/** 末尾追加一笔（LF 坐标） */
function append(text: string, mark: string): Array<{ offset: number; length: number; text: string }> {
  return [{ offset: text.length, length: 0, text: mark }]
}

interface SubmitResult { ok: boolean; opId?: string; groupId?: string; ackVersion?: number; entrySeq?: number; reason?: string }

async function submit(uri: string, doc: vscode.TextDocument, opId: string, atomic: boolean, mark: string, refOriginUri?: string): Promise<SubmitResult> {
  const result = (await vscode.commands.executeCommand(AH.submit, uri, {
    opId, atomic, changes: append(doc.getText(), mark), ...(refOriginUri !== undefined ? { refOriginUri } : {}),
  })) as SubmitResult
  return result
}

interface HistoryReport { executedSteps?: number; rejected?: string; aborted?: string; finalVersion?: number; finalText?: string }

async function history(uri: string, op: 'undo' | 'redo', refOriginUri?: string): Promise<HistoryReport> {
  return (await vscode.commands.executeCommand(AH.history, uri, op, refOriginUri)) as HistoryReport
}

export const addonHistoryCases: Array<[string, () => Promise<void>]> = [
  ['V01 历史分组：ABCD 原子/非原子单位撤回与重做走真实版本/ack 管线', async () => {
    const T0 = 'V01基\n'
    const { uri, doc } = await setup('v01-abcd.md')
    assert(doc.getText() === T0, `初始文本应为 ${JSON.stringify(T0)}，实际 ${JSON.stringify(doc.getText())}`)
    const baseVersion = doc.version

    // A 原子、B 非原子（并入 g1）、C 原子、D 非原子（并入 g2）
    for (const [opId, atomic, mark] of [['A', true, 'aA'], ['B', false, 'bB'], ['C', true, 'cC'], ['D', false, 'dD']] as const) {
      const result = await submit(uri, doc, opId, atomic, mark)
      assert(result.ok, `修饰 ${opId} 提交应成功：${JSON.stringify(result)}`)
    }
    let state = await probeState(uri)
    assert(state.entries.length === 4, `应有 4 条来源记录，实际 ${state.entries.length}`)
    const groups = state.entries.map((e) => e.groupId)
    assert(groups[0] === groups[1] && groups[2] === groups[3] && groups[0] !== groups[2], `A+B 与 C+D 应各自同组：${JSON.stringify(groups)}`)
    assert(state.entries.map((e) => e.opId).join(',') === 'A,B,C,D', `来源应逐次跟踪 A,B,C,D：${JSON.stringify(state.entries.map((e) => e.opId))}`)
    assert(state.entries[0].atomic === true && state.entries[1].atomic === false, 'A 原子/B 非原子标志应保留')
    // ack 版本逐条递进（真实 edit.ack 链路对位）
    assert(state.entries.map((e) => e.versionAfter).join(',') === [2, 3, 4, 5].map((v) => baseVersion + v - 1).join(','), `ack 版本应逐条递进：${JSON.stringify(state.entries.map((e) => e.versionAfter))}`)

    // ABCD → AB → 空 → AB → ABCD
    let r = await history(uri, 'undo')
    assert(r.executedSteps === 2 && !r.rejected, `第一撤应执行 C+D 两步：${JSON.stringify(r)}`)
    assert(doc.getText() === 'V01基\naAbB', `撤 C+D 后应为 AB：${JSON.stringify(doc.getText())}`)
    assert(doc.version === baseVersion + 6, `两步撤回应推进版本 +2：${doc.version}`)
    r = await history(uri, 'undo')
    assert(r.executedSteps === 2, `第二撤应执行 A+B 两步：${JSON.stringify(r)}`)
    assert(doc.getText() === T0, `撤 A+B 后应为空基态：${JSON.stringify(doc.getText())}`)
    r = await history(uri, 'undo')
    assert(r.rejected === 'empty', `空历史撤回应明确拒绝：${JSON.stringify(r)}`)
    assert(doc.getText() === T0 && doc.version === baseVersion + 8, '空历史拒绝不得动文档')
    r = await history(uri, 'redo')
    assert(r.executedSteps === 2, `重做应恢复 A+B 两步：${JSON.stringify(r)}`)
    assert(doc.getText() === 'V01基\naAbB', `重做后应为 AB：${JSON.stringify(doc.getText())}`)
    r = await history(uri, 'redo')
    assert(r.executedSteps === 2, `重做应恢复 C+D 两步：${JSON.stringify(r)}`)
    assert(doc.getText() === 'V01基\naAbBcCdD', `重做后应为 ABCD：${JSON.stringify(doc.getText())}`)
    r = await history(uri, 'redo')
    assert(r.rejected === 'empty', `无可重做时应明确拒绝：${JSON.stringify(r)}`)

    // 重复连按（并发三次 undo）：两组恰好撤完 + 第三次空拒绝，不多撤
    const first = doc.version
    const [u1, u2, u3] = await Promise.all([history(uri, 'undo'), history(uri, 'undo'), history(uri, 'undo')])
    assert(u1.executedSteps === 2 && u2.executedSteps === 2, `连按两次应各撤一组：${JSON.stringify([u1, u2])}`)
    assert(u3.rejected === 'empty', `第三次应空拒绝：${JSON.stringify(u3)}`)
    assert(doc.getText() === T0, `连按后应回基态：${JSON.stringify(doc.getText())}`)
    assert(doc.version === first + 4, `连按总版本推进应为 4（4 步）：${doc.version}`)
    state = await probeState(uri)
    assert(!state.lost, '连按不应导致映射失配')
  }],

  ['V01 历史分组：合并提交单笔历史、多范围原子一笔一撤与连续非原子', async () => {
    const T0 = 'V01合并基\n'
    const { uri, doc } = await setup('v01-merge.md')
    assert(doc.getText() === T0, '初始基态')

    // 同组未提交合并：原子 A + 非原子 B 合成一笔 edit.request（两个范围）→
    // 一条宿主历史项，一次撤销同时撤掉
    const merged = (await vscode.commands.executeCommand(AH.submit, uri, {
      opId: 'AB-merged', atomic: true,
      changes: [{ offset: doc.getText().length, length: 0, text: 'aA' }, { offset: doc.getText().length + 2, length: 0, text: 'bB' }],
    })) as SubmitResult
    assert(merged.ok, `合并提交应成功：${JSON.stringify(merged)}`)
    assert(doc.getText() === 'V01合并基\naAbB', `合并后文本：${JSON.stringify(doc.getText())}`)
    let state = await probeState(uri)
    assert(state.entries.length === 1, `合并提交应只产生一条宿主历史项，实际 ${state.entries.length}`)
    let r = await history(uri, 'undo')
    assert(r.executedSteps === 1, `合并条目一步撤回：${JSON.stringify(r)}`)
    assert(doc.getText() === T0, `一步应同时撤掉 A 与 B：${JSON.stringify(doc.getText())}`)
    r = await history(uri, 'redo')
    assert(r.executedSteps === 1 && doc.getText() === 'V01合并基\naAbB', '一步重做恢复合并条目')

    // 多范围原子：两个不相连范围一笔提交 = 一条历史项一步撤
    const text = doc.getText()
    const multi = (await vscode.commands.executeCommand(AH.submit, uri, {
      opId: 'multi-range', atomic: true,
      changes: [{ offset: 0, length: 0, text: '[' }, { offset: text.length, length: 0, text: ']' }],
    })) as SubmitResult
    assert(multi.ok && doc.getText() === '[V01合并基\naAbB]', '多范围原子应同时生效')
    state = await probeState(uri)
    assert(state.entries.length === 2, `多范围原子应是一条新历史项：${state.entries.length}`)
    r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === 'V01合并基\naAbB', '多范围一步同撤')

    // 连续非原子：A 原子 + B1/B2/B3 非原子同组 → 一次撤回 4 步
    for (const [opId, atomic, mark] of [['A', true, 'x1'], ['B1', false, 'y2'], ['B2', false, 'z3'], ['B3', false, 'w4']] as const) {
      const result = await submit(uri, doc, opId, atomic, mark)
      assert(result.ok, `${opId} 提交应成功`)
    }
    assert(doc.getText() === 'V01合并基\naAbBx1y2z3w4', '连续提交文本')
    state = await probeState(uri)
    const tail = state.entries.slice(-4).map((e) => e.groupId)
    assert(new Set(tail).size === 1, `连续非原子应同组：${JSON.stringify(tail)}`)
    r = await history(uri, 'undo')
    assert(r.executedSteps === 4, `连续非原子整组 4 步撤回：${JSON.stringify(r)}`)
    assert(doc.getText() === 'V01合并基\naAbB', `整组撤回后文本：${JSON.stringify(doc.getText())}`)
  }],

  ['V01 历史分组：无前项拒绝与 Undo 后新写截断 Redo', async () => {
    const T0 = 'V01截断基\n'
    const { uri, doc } = await setup('v01-truncate.md')
    assert(doc.getText() === T0, '初始基态')

    // 无前项：非原子首提交 → HistoryBoundaryUnavailable，不产生历史项、不动文档
    const before = doc.version
    const rejected = await submit(uri, doc, 'B0', false, 'b0')
    assert(!rejected.ok && rejected.reason === 'boundary-unavailable', `无前项非原子应拒绝：${JSON.stringify(rejected)}`)
    assert(doc.getText() === T0 && doc.version === before, '拒绝提交不得动文档')
    let state = await probeState(uri)
    assert(state.entries.length === 0, '拒绝不留来源记录')

    // 组顶被外来写入打断后非原子同样拒绝
    assert((await submit(uri, doc, 'A', true, 'aA')).ok, '原子 A 应成功')
    await vscode.commands.executeCommand(AH.externalWrite, uri, 'V01截断基\naA外部F')
    assert(doc.getText() === 'V01截断基\naA外部F', '外部写入生效')
    const rejected2 = await submit(uri, doc, 'B', false, 'bB')
    assert(!rejected2.ok && rejected2.reason === 'boundary-unavailable', `组顶被打断后非原子应拒绝：${JSON.stringify(rejected2)}`)

    // 截断 Redo：撤到基态后新原子写入，redo 拒绝
    const written = doc.getText()
    let r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === 'V01截断基\naA', `先撤外来写入：${JSON.stringify(r)}`)
    r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === T0, '再撤原子 A')
    assert((await submit(uri, doc, 'E', true, 'eE')).ok, '新原子 E 应成功')
    assert(doc.getText() === 'V01截断基\neE', `新写入文本：${JSON.stringify(doc.getText())}`)
    r = await history(uri, 'redo')
    assert(r.rejected === 'empty', `Redo 分支被新写截断应拒绝：${JSON.stringify(r)}`)
    assert(doc.getText() === 'V01截断基\neE', '截断拒绝不动文档')
    state = await probeState(uri)
    assert(state.entries.every((e) => e.textAfter !== written), '被截断的外来条目不得残留在可重做区')
    r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === T0, '撤 E 一步回基态')
  }],

  ['V01 历史分组：在途 ack 与外部写入交错下按单位撤回', async () => {
    const T0 = 'V01交错基\n'
    const { uri, doc } = await setup('v01-interleave.md')
    assert(doc.getText() === T0, '初始基态')
    const baseVersion = doc.version

    // 在途 ack：提交与撤销并发发出——会话队列串行保证撤销的是已应用编辑
    const [submitResult, undoResult] = await Promise.all([
      submit(uri, doc, 'A', true, 'aA'),
      history(uri, 'undo'),
    ])
    assert(submitResult.ok, `在途提交应成功：${JSON.stringify(submitResult)}`)
    assert(undoResult.executedSteps === 1, `在途撤销应撤已应用的 A：${JSON.stringify(undoResult)}`)
    assert(doc.getText() === T0, `撤后回基态：${JSON.stringify(doc.getText())}`)
    assert(doc.version === baseVersion + 2, '应用 +1、撤销 +1')
    let state = await probeState(uri)
    assert(state.entries.length === 1 && state.entries[0].opId === 'A' && state.appliedCount === 0, '在途场景下来源与指针正确')

    // 外部写入与历史命令交错：外来条目是独立单步，先于修饰组被撤
    assert((await submit(uri, doc, 'C', true, 'cC')).ok, '原子 C 应成功')
    await vscode.commands.executeCommand(AH.externalWrite, uri, 'V01交错基\ncC外部X')
    state = await probeState(uri)
    assert(state.entries.length === 2 && state.entries[1].owner === 'foreign', `外来写入应记 foreign 条目：${JSON.stringify(state.entries)}`)
    let r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === 'V01交错基\ncC', `外来条目一步先撤：${JSON.stringify(r)}`)
    r = await history(uri, 'undo')
    assert(r.executedSteps === 1 && doc.getText() === T0, '再撤原子 C')
    r = await history(uri, 'redo')
    assert(r.executedSteps === 1 && doc.getText() === 'V01交错基\ncC', '重做恢复 C')
  }],

  ['V01 历史分组：外部原生撤销触发组完成与映射失配明确拒绝', async () => {
    const T0 = 'V01外部基\n'
    const { uri, doc } = await setup('v01-external.md')
    assert(doc.getText() === T0, '初始基态')

    for (const [opId, atomic, mark] of [['A', true, 'aA'], ['B', false, 'bB'], ['C', true, 'cC'], ['D', false, 'dD']] as const) {
      assert((await submit(uri, doc, opId, atomic, mark)).ok, `${opId} 提交应成功`)
    }
    const atAbcd = doc.version

    // 原生文本编辑器单步撤销（外部入口）：撤掉 D 后协调器自动补完组内 C
    const native1 = (await vscode.commands.executeCommand(AH.nativeHistory, uri, 'undo')) as { version: number; text: string }
    assert(native1.text === 'V01外部基\naAbB', `外部一步 + 组完成应把 C+D 整组撤回：${JSON.stringify(native1.text)}`)
    let state = await probeState(uri)
    assert(!state.lost && state.appliedCount === 2, `组完成后指针应停在 A+B：applied=${state.appliedCount}`)
    // 外部重做（原生入口）：补完组内剩余
    const native2 = (await vscode.commands.executeCommand(AH.nativeHistory, uri, 'redo')) as { version: number; text: string }
    assert(native2.text === 'V01外部基\naAbBcCdD', `外部重做一步 + 组完成应恢复 C+D：${JSON.stringify(native2.text)}`)
    assert(doc.version === atAbcd + 4, `外部两轮各 2 步：${doc.version}`)

    // 映射失配拒绝：丢弃映射后恢复过期快照（当前文本对不上边界）→ 明确
    // 拒绝且不动文档
    const stale = (await vscode.commands.executeCommand(AH.snapshot, uri)) as unknown
    assert((await submit(uri, doc, 'E', true, 'eE')).ok, '新原子 E')
    await vscode.commands.executeCommand(AH.reset, uri)
    await vscode.commands.executeCommand(AH.restore, uri, stale)
    state = await probeState(uri)
    assert(state.lost, '过期快照对不上宿主实际状态应 lost')
    const beforeReject = { version: doc.version, text: doc.getText() }
    const r = await history(uri, 'undo')
    assert(r.rejected === 'mapping-lost', `失配应明确拒绝：${JSON.stringify(r)}`)
    assert(doc.version === beforeReject.version && doc.getText() === beforeReject.text, '失配拒绝不得动文档')

    // 重启重建（无快照）：分组协调保守拒绝，但宿主实际保留的历史仍可单步
    // 原生撤销——证明拒绝源于映射不可验证而非历史为空
    await vscode.commands.executeCommand(AH.rebuild, uri)
    const r2 = await history(uri, 'undo')
    assert(r2.rejected === 'mapping-lost', `重建无快照应保守拒绝：${JSON.stringify(r2)}`)
    const native3 = (await vscode.commands.executeCommand(AH.nativeHistory, uri, 'undo')) as { version: number; text: string }
    assert(native3.text === 'V01外部基\naAbBcCdD', `宿主仍保留历史（撤掉 E）：${JSON.stringify(native3.text)}`)
  }],

  ['V01 历史分组：引用 B 整组一次激活撤回、恢复来源 A 与父子隔离', async () => {
    const A_T0 = '# V01 引用 A\n\n![[v01-ref-b]]\n'
    const B_T0 = 'V01引用B基\n'
    await openWithEditor('v01-ref-a.md')
    await waitSessionReady('v01-ref-a.md')
    const aUri = wsUri('v01-ref-a.md').toString()
    const bUri = wsUri('v01-ref-b.md').toString()
    const aDoc = await vscode.workspace.openTextDocument(wsUri('v01-ref-a.md'))
    await vscode.commands.executeCommand(AH.attach, bUri)
    const bDoc = await vscode.workspace.openTextDocument(wsUri('v01-ref-b.md'))
    assert(bDoc.getText() === B_T0, 'B 初始基态')
    const aVersionBefore = aDoc.version

    // B 上提交原子 X + 非原子 Y（refOrigin = A，走引用编辑端口语义）
    assert((await submit(bUri, bDoc, 'X', true, 'xX', aUri)).ok, 'B 原子 X 应成功')
    assert((await submit(bUri, bDoc, 'Y', false, 'yY', aUri)).ok, 'B 非原子 Y 应成功')
    assert(bDoc.getText() === 'V01引用B基\nxXyY', 'B 修饰生效')
    assert(aDoc.getText() === A_T0 && aDoc.version === aVersionBefore, 'B 的编辑不得触碰父文档 A')

    // 整组撤回：一次临时激活执行两步，结束后恢复来源 A
    const r = await history(bUri, 'undo', aUri)
    assert(r.executedSteps === 2, `B 整组两步撤回：${JSON.stringify(r)}`)
    assert(bDoc.getText() === B_T0, `B 回基态：${JSON.stringify(bDoc.getText())}`)
    assert(aDoc.getText() === A_T0 && aDoc.version === aVersionBefore, '撤 B 不得撤销 A 的任何内容')
    // 恢复来源 A：活动文本编辑器不应是 B（A custom editor 激活时无活动文本编辑器）
    assert(vscode.window.activeTextEditor === undefined ||
      vscode.window.activeTextEditor.document.uri.toString() !== bUri, '整组完成后应恢复来源 A 而非停留在 B')
    // B 临时文本标签已收（差分收口）
    const bTextTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
      t.input instanceof vscode.TabInputText && t.input.uri.toString() === bUri)
    assert(bTextTabs.length === 0, `B 临时标签应收口，剩余 ${bTextTabs.length}`)

    // 重做恢复整组；A 仍不动
    const r2 = await history(bUri, 'redo', aUri)
    assert(r2.executedSteps === 2 && bDoc.getText() === 'V01引用B基\nxXyY', `B 整组重做：${JSON.stringify(r2)}`)
    assert(aDoc.version === aVersionBefore, '重做 B 仍不得动 A')

    // 原生源码编辑器入口：在 B 的原生编辑器单步撤销 → 协调器补完整组
    const native = (await vscode.commands.executeCommand(AH.nativeHistory, bUri, 'undo')) as { text: string }
    assert(native.text === B_T0, `原生入口一步 + 组完成撤回整组：${JSON.stringify(native.text)}`)
    assert(aDoc.version === aVersionBefore, '原生入口补完仍不得动 A')
    // 收尾恢复 A 面板激活
    await vscode.commands.executeCommand('vscode.openWith', wsUri('v01-ref-a.md'), VIEW_TYPE)
  }],

  ['V01 历史分组：webview 重载后宿主侧映射与分组继续对应', async () => {
    const T0 = 'V01重载基\n'
    const { uri, doc } = await setup('v01-reload.md')
    assert(doc.getText() === T0, '初始基态')

    for (const [opId, atomic, mark] of [['A', true, 'aA'], ['B', false, 'bB'], ['C', true, 'cC'], ['D', false, 'dD']] as const) {
      assert((await submit(uri, doc, opId, atomic, mark)).ok, `${opId} 提交应成功`)
    }
    // webview 面板重载（B-2：同面板重复 ready）——宿主侧协调器与会话不动，
    // 分组映射应与宿主实际保留的历史继续对应
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    await waitSessionReady('v01-reload.md')
    const r = await history(uri, 'undo')
    assert(r.executedSteps === 2 && doc.getText() === 'V01重载基\naAbB', `重载后整组撤回仍正确：${JSON.stringify(r)}`)
    // 精确快照恢复：撤到 AB 后快照 → 丢映射 → 恢复 → 重做继续分组
    const snap = (await vscode.commands.executeCommand(AH.snapshot, uri)) as unknown
    await history(uri, 'undo')
    assert(doc.getText() === T0, '撤到基态')
    await vscode.commands.executeCommand(AH.reset, uri)
    const stateAfterRestore = (await vscode.commands.executeCommand(AH.restore, uri, snap)) as ProbeState
    assert(!stateAfterRestore.lost, `边界态恢复应对上宿主实际状态：${JSON.stringify(stateAfterRestore.lastRejection)}`)
    const r2 = await history(uri, 'redo')
    assert(r2.executedSteps === 2 && doc.getText() === 'V01重载基\naAbB', `恢复后重做整组：${JSON.stringify(r2)}`)
  }],

  // ---- T03（#352）编辑来源与宿主历史接入点：生产管线验证——origin 元数据
  //  经真实 edit.request/写回/回流归属（onEditAttributed 按 ack version 对位，
  //  替代探针文本全等对账）、纯选区不造历史项、跨会话隔离、组历史窄适配点
  //  （会话队列串行 + 每步版本核对）与引用 B 临时激活整组路由 + F1 脏态
  //  收口禁丢。生产语义断言不依赖探针分组状态机（submitViaPanel 直通）。 ----
  ['T03 来源元数据：真实写回归属对位、纯选区不造历史项与跨会话隔离', async () => {
    const T0 = 'T03来源基\n'
    const { uri, doc } = await setup('v01-t03-origin.md')
    assert(doc.getText() === T0, '初始基态')
    const ORIGIN = { addonId: 'onegayi.t03-fixture', opId: 't03-a', undo: 'atomic' } as const
    const baseVersion = doc.version

    // 单笔 origin 提交：归属恰一条，version 与 ack 对位
    const r1 = (await vscode.commands.executeCommand(AH.t03Submit, uri, {
      changes: append(doc.getText(), 'oX'),
      origin: ORIGIN,
    })) as { ok: boolean; version?: number }
    assert(r1.ok && r1.version === baseVersion + 1, `origin 提交应成功且版本 +1：${JSON.stringify(r1)}`)
    let attr = (await vscode.commands.executeCommand(AH.t03Attributions, uri)) as Array<{ seq: number; version: number; origin: { addonId: string; opId: string; undo: string }; changes: unknown[] }>
    assert(attr.length === 1, `归属应恰一条，实际 ${attr.length}`)
    assert(attr[0]!.version === baseVersion + 1 && attr[0]!.origin.opId === 't03-a' &&
      attr[0]!.origin.addonId === 'onegayi.t03-fixture' && attr[0]!.origin.undo === 'atomic',
      `归属 version 应与 ack 对位且 origin 完整：${JSON.stringify(attr[0])}`)

    // 多范围一笔：一条归属、多段完整
    const text = doc.getText()
    const r2 = (await vscode.commands.executeCommand(AH.t03Submit, uri, {
      changes: [{ offset: 0, length: 0, text: '[' }, { offset: text.length, length: 0, text: ']' }],
      origin: { ...ORIGIN, opId: 't03-multi' },
    })) as { ok: boolean }
    assert(r2.ok, '多范围 origin 提交应成功')
    attr = (await vscode.commands.executeCommand(AH.t03Attributions, uri)) as typeof attr
    assert(attr.length === 2 && attr[1]!.origin.opId === 't03-multi' && attr[1]!.changes.length === 2,
      `多范围应一条归属（两段变更）：${JSON.stringify(attr[1])}`)

    // 纯选区（origin + 无净文本变更）：ack 成功、不写回、不归属
    const versionBefore = doc.version
    const textBefore = doc.getText()
    const r3 = (await vscode.commands.executeCommand(AH.t03Submit, uri, {
      changes: [],
      origin: { ...ORIGIN, opId: 't03-selection-only' },
    })) as { ok: boolean; version?: number }
    assert(r3.ok && r3.version === versionBefore, `纯选区应 ack 成功且版本不动：${JSON.stringify(r3)}`)
    assert(doc.version === versionBefore && doc.getText() === textBefore, '纯选区不得写回权威文档')
    attr = (await vscode.commands.executeCommand(AH.t03Attributions, uri)) as typeof attr
    assert(attr.length === 2, `纯选区不得产生归属记录，实际 ${attr.length}`)

    // 跨会话隔离：另一目标的 origin 归属不并入本文档记录
    const { uri: isoUri, doc: isoDoc } = await setup('v01-t03-iso.md')
    const r4 = (await vscode.commands.executeCommand(AH.t03Submit, isoUri, {
      changes: append(isoDoc.getText(), 'iZ'),
      origin: { ...ORIGIN, opId: 't03-iso' },
    })) as { ok: boolean }
    assert(r4.ok, '隔离目标提交应成功')
    const isoAttr = (await vscode.commands.executeCommand(AH.t03Attributions, isoUri)) as typeof attr
    assert(isoAttr.length === 1 && isoAttr[0]!.origin.opId === 't03-iso', `隔离目标应恰一条归属：${JSON.stringify(isoAttr)}`)
    attr = (await vscode.commands.executeCommand(AH.t03Attributions, uri)) as typeof attr
    assert(attr.length === 2, `跨目标元数据不得合并到父文档历史（本文档仍 2 条，实际 ${attr.length}）`)
  }],

  ['T03 组历史：root 活动场景整组执行、每步版本核对与超量中止', async () => {
    const T0 = 'T03组基\n'
    const { uri, doc } = await setup('v01-t03-group.md')
    assert(doc.getText() === T0, '初始基态')
    const ORIGIN = { addonId: 'onegayi.t03-fixture', opId: '', undo: 'atomic' }
    for (const mark of ['g1', 'g2', 'g3']) {
      const r = (await vscode.commands.executeCommand(AH.t03Submit, uri, {
        changes: append(doc.getText(), mark),
        origin: { ...ORIGIN, opId: `t03-${mark}` },
      })) as { ok: boolean }
      assert(r.ok, `${mark} 提交应成功`)
    }
    assert(doc.getText() === 'T03组基\ng1g2g3', `三笔修饰生效：${JSON.stringify(doc.getText())}`)
    const afterEdits = doc.version

    // 整组撤回（root 活动 custom editor 场景，经会话队列串行）
    const undo = (await vscode.commands.executeCommand(AH.t03GroupHistory, uri, 'undo', 3)) as { executedSteps: number; aborted?: string }
    assert(undo.executedSteps === 3 && undo.aborted === undefined, `整组撤回应执行 3 步：${JSON.stringify(undo)}`)
    assert(doc.getText() === T0 && doc.version === afterEdits + 3, `整组撤回后回基态且版本 +3：${doc.version}`)

    // 整组重做
    const redo = (await vscode.commands.executeCommand(AH.t03GroupHistory, uri, 'redo', 3)) as { executedSteps: number; aborted?: string }
    assert(redo.executedSteps === 3 && doc.getText() === 'T03组基\ng1g2g3', `整组重做恢复：${JSON.stringify(redo)}`)

    // 超量请求：栈仅 3 步，第 4 步版本不动 → 失配中止（不撤其他、不多撤）
    const over = (await vscode.commands.executeCommand(AH.t03GroupHistory, uri, 'undo', 99)) as { executedSteps: number; aborted?: string }
    assert(over.executedSteps === 3 && over.aborted === 'version-mismatch',
      `超量应在第 4 步失配中止（执行 3 步）：${JSON.stringify(over)}`)
    assert(doc.getText() === T0, '超量中止后停在基态（不多撤）')
    const settled = doc.version
    await new Promise((r) => setTimeout(r, 300))
    assert(doc.version === settled && doc.getText() === T0, '中止后文档稳定（无残留步骤）')
  }],

  ['T03 引用 B 组历史：临时激活整组执行与 F1 脏态收口不丢未保存修改', async () => {
    const A_T0 = '# T03 引用 A\n\n![[v01-t03-ref-b]]\n'
    const B_T0 = 'T03引用B基\n'
    await openWithEditor('v01-t03-ref-a.md')
    await waitSessionReady('v01-t03-ref-a.md')
    const aUri = wsUri('v01-t03-ref-a.md').toString()
    const bUri = wsUri('v01-t03-ref-b.md').toString()
    const aDoc = await vscode.workspace.openTextDocument(wsUri('v01-t03-ref-a.md'))
    // 嵌入内部 Live 真实 bind（生产端口绑定在场 = refOrigin 路由前置）
    await poll('嵌入卡片绑定目标编辑端口', async () => {
      const stats = (await vscode.commands.executeCommand('onegayi.vsidian._test.refPortStats')) as { size: number }
      return stats.size >= 1 ? true : undefined
    })
    await vscode.commands.executeCommand(AH.attach, bUri)
    const bDoc = await vscode.workspace.openTextDocument(wsUri('v01-t03-ref-b.md'))
    assert(bDoc.getText() === B_T0, 'B 初始基态')
    const aVersionBefore = aDoc.version
    const bTextTabs = (): number =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
        t.input instanceof vscode.TabInputText && t.input.uri.toString() === bUri).length
    const ORIGIN = { addonId: 'onegayi.t03-fixture', opId: 't03-ref', undo: 'atomic' }
    const submitB = async (mark: string, opId: string): Promise<void> => {
      const r = (await vscode.commands.executeCommand(AH.t03Submit, bUri, {
        changes: append(bDoc.getText(), mark), origin: { ...ORIGIN, opId },
      })) as { ok: boolean }
      assert(r.ok, `B 提交 ${opId} 应成功`)
    }

    // 场景一（clean 收口）：提交 → 撤回回盘面基态 → 收口关闭临时标签
    await submitB('b1', 't03-ref-b1')
    assert(bDoc.getText() === 'T03引用B基\nb1' && bDoc.isDirty, 'B 提交后 dirty')
    const undo1 = (await vscode.commands.executeCommand(AH.t03GroupHistory, bUri, 'undo', 1, aUri)) as { executedSteps: number; aborted?: string }
    assert(undo1.executedSteps === 1 && undo1.aborted === undefined, `引用 B 组撤回一步：${JSON.stringify(undo1)}`)
    assert(bDoc.getText() === B_T0 && !bDoc.isDirty, '撤回回盘面基态（clean）')
    await poll('clean 收口关闭 B 临时标签', () => (bTextTabs() === 0 ? true : undefined))
    assert(aDoc.getText() === A_T0 && aDoc.version === aVersionBefore, 'B 的组历史不得触碰父文档 A')

    // 场景二（F1 脏态收口）：提交 → 保存（盘面前移）→ 撤回 ≠ 盘面 → dirty
    // → 收口必须保留临时标签（关闭会静默丢弃修改，V01 F1 实测）
    await submitB('b2', 't03-ref-b2')
    assert(await bDoc.save(), '保存 B（盘面 = 基态+b2）')
    assert(!bDoc.isDirty, '保存后 clean')
    const undo2 = (await vscode.commands.executeCommand(AH.t03GroupHistory, bUri, 'undo', 1, aUri)) as { executedSteps: number; aborted?: string }
    assert(undo2.executedSteps === 1, `脏态前组撤回一步：${JSON.stringify(undo2)}`)
    assert(bDoc.getText() === B_T0 && bDoc.isDirty, `撤回后 B 文本=基态 ≠ 盘面（dirty）：${JSON.stringify(bDoc.getText())}`)
    // F1 核心：临时标签保留且内容稳定（关闭脏标签会版本 +1 回滚盘面）
    await poll('F1 脏态保留 B 临时标签', () => (bTextTabs() >= 1 ? true : undefined))
    const dirtyVersion = bDoc.version
    await new Promise((r) => setTimeout(r, 400))
    assert(bDoc.version === dirtyVersion && bDoc.getText() === B_T0,
      `脏态 B 不得被收口丢弃（版本应稳定 ${dirtyVersion}，实际 ${bDoc.version}；文本 ${JSON.stringify(bDoc.getText())}）`)
    assert(aDoc.version === aVersionBefore, 'F1 场景 A 仍不动')
    // 收尾：恢复 A 面板激活
    await vscode.commands.executeCommand('vscode.openWith', wsUri('v01-t03-ref-a.md'), VIEW_TYPE)
  }],
]
