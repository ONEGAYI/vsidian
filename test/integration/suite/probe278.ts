// #278（P2-01）真宿主探针：目标历史、文档级丢弃、临时副本对比与父标签
// 关闭交接的公开 API 路线验证。规格锚点：docs/specs/hover-preview-embed.md
// 「二期正式规格」P2-A05/A09/A10/A11/A15；结论与技术边界见
// docs/research/vscode-1823-host-route-probes.md。
//
// 定位：研究工件——每条路线记录「真实 TextDocument 内容 / isDirty / 版本 /
// tab 与焦点」证据（[P2-01] 前缀日志行，落入 .vscode-test 报告），断言只钉
// 必须成立的硬边界（A 不被误伤、输入不丢）；候选路线需要切换活动标签/焦点
// 时，逐步记录实际可见变化，不默认获准该取舍。
//
// 本文件自带最小 helper（与 cases.ts 同构、零耦合）：探针不依赖生产用例的
// 模块内部状态，保证 VSIDIAN_TEST_CASES='P2-01' 定向复现的独立性。所有对
// B 的写入走 workspace.applyEdit——与产品 DocumentSession.applyChanges 同
// 一宿主写回原语；不以任何 executeCommand mock 代替可行性证据。
//
// 用例顺序即风险排序：低风险的保存/守卫/路由在前，含「关闭脏编辑器」等
// 未知宿主行为的高风险探针（recycle-b/untitled 释放）压轴，失败时保留前
// 序证据。每用例结束前把缓冲与磁盘还原为 fixture 字节（脏文档关闭会触发
// 宿主保存确认，拖垮整个宿主进程）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'

const wsDir = process.env['WORKSPACE_DIR'] ?? ''
if (!wsDir) {
  throw new Error('环境变量 WORKSPACE_DIR 未设置（应由 runTest.mjs 注入）')
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
  console.log(`[P2-01][${tag}] ${JSON.stringify(data)}`)
}

const ci = process.platform === 'win32' || process.platform === 'darwin'
const norm = (u: string): string => (ci ? u.toLowerCase() : u)

async function openWith(file: string, beside = false): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE, beside
    ? vscode.ViewColumn.Beside
    : undefined)
}

async function readDisk(file: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(wsUri(file))
  return Buffer.from(bytes).toString('utf8')
}

async function docOf(file: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(wsUri(file))
}

/** 与产品写回同原语：经 WorkspaceEdit 插入（offset 为文档当前文本坐标） */
async function insertAt(doc: vscode.TextDocument, offset: number, text: string): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, doc.positionAt(offset), text)
  return vscode.workspace.applyEdit(edit)
}

/** 跨资源原子编辑：一份 WorkspaceEdit 同时改多个文档 */
async function insertAcross(
  entries: Array<{ doc: vscode.TextDocument; offset: number; text: string }>,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit()
  for (const e of entries) {
    edit.insert(e.doc.uri, e.doc.positionAt(e.offset), e.text)
  }
  return vscode.workspace.applyEdit(edit)
}

type TabKind = 'custom' | 'text' | 'diff' | 'other'

function tabKindOf(tab: vscode.Tab | undefined): TabKind | undefined {
  const input = tab?.input
  if (input instanceof vscode.TabInputCustom) return 'custom'
  if (input instanceof vscode.TabInputText) return 'text'
  if (input instanceof vscode.TabInputTextDiff) return 'diff'
  return tab ? 'other' : undefined
}

function tabUrisOf(tab: vscode.Tab): string[] {
  const input = tab.input
  const uris: string[] = []
  if (input instanceof vscode.TabInputCustom) uris.push(input.uri.toString())
  else if (input instanceof vscode.TabInputText) uris.push(input.uri.toString())
  else if (input instanceof vscode.TabInputTextDiff) {
    uris.push(input.original.toString(), input.modified.toString())
  }
  return uris
}

/** 可见状态快照：活动 tab、活动文本编辑器与全部标签（票据要求记录候选
 *  路线的实际可见变化，不能只写结论） */
function visibleBrief(): {
  activeTab: { kind: TabKind; label: string } | null
  activeTextEditor: string | null
  tabs: Array<{ kind: TabKind; label: string }>
} {
  const group = vscode.window.tabGroups.activeTabGroup
  const active = group.activeTab
  return {
    activeTab: active ? { kind: tabKindOf(active) ?? 'other', label: active.label } : null,
    activeTextEditor: vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.document.uri.toString()
      : null,
    tabs: vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => ({
      kind: tabKindOf(t) ?? 'other',
      label: t.label,
    })),
  }
}

function tabsOfFile(file: string): Array<{ kind: TabKind; tab: vscode.Tab }> {
  const target = norm(wsUri(file).toString())
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => tabUrisOf(t).some((u) => norm(u) === target))
    .map((t) => ({ kind: tabKindOf(t) ?? 'other', tab: t }))
}

async function closeTabsOfFile(file: string, kind: TabKind): Promise<void> {
  const hits = tabsOfFile(file).filter((t) => t.kind === kind)
  for (const h of hits) {
    await vscode.window.tabGroups.close(h.tab)
  }
  await poll(`${file} 的 ${kind} 标签关闭`, () =>
    tabsOfFile(file).every((t) => t.kind !== kind) ? true : undefined)
}

async function waitActiveCustomTab(file: string): Promise<void> {
  const target = norm(wsUri(file).toString())
  await poll(`活动 tab 为 ${file} 的 custom editor`, () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (!tab) return undefined
    if (tabKindOf(tab) !== 'custom') return undefined
    return tabUrisOf(tab).some((u) => norm(u) === target) ? true : undefined
  })
}

async function waitActiveTextDoc(doc: vscode.TextDocument): Promise<vscode.TextEditor> {
  const target = norm(doc.uri.toString())
  return poll(`活动文本编辑器为 ${doc.uri.fsPath}`, () => {
    const ed = vscode.window.activeTextEditor
    return ed && norm(ed.document.uri.toString()) === target ? ed : undefined
  })
}

/** 还原缓冲到 fixture 字节（内容==磁盘 → 宿主清除 dirty） */
async function restoreBuffer(doc: vscode.TextDocument, original: string): Promise<void> {
  const current = doc.getText()
  if (current === original && !doc.isDirty) return
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(current.length)), original)
  assert(await vscode.workspace.applyEdit(edit), `${doc.uri.fsPath} 还原编辑应成功`)
}

/** 用例收尾统一还原：缓冲回原字节；若磁盘被保存改过则再落盘，保证干净 */
async function restoreAll(entries: Array<{ doc: vscode.TextDocument; original: string }>): Promise<void> {
  for (const e of entries) {
    await restoreBuffer(e.doc, e.original)
    if (e.doc.isDirty) {
      assert(await e.doc.save(), `${e.doc.uri.fsPath} 还原落盘应成功`)
    }
    await poll(`${e.doc.uri.fsPath} 干净`, () =>
      !e.doc.isDirty && e.doc.getText() === e.original ? true : undefined)
  }
}

/** A/B fixture 基线字节（与 fixtures.mjs 生成式一致） */
function baseText(name: string, role: 'a' | 'b'): string {
  return role === 'a'
    ? `# P2-01 ${name} 甲面板\n\n甲正文行\n`
    : `P2-01 ${name} 乙第一行\n乙第二行\n`
}

/** 免提示关闭当前活动编辑器：revertAndCloseActiveEditor 丢弃未保存内容并
 *  关闭（无宿主保存确认弹窗——模态弹窗会卡死无头宿主）；按目标 URI 的
 *  标签消失判定（关闭后活动标签可能切给其他标签，不能拿「无活动标签」
 *  当判据）。失败回退 tabGroups.close。返回实际生效通道（本身就是证据）。
 *  注意：revert 会丢弃活动编辑器的未保存内容——调用前须自行保存或还原
 *  需要保留的一侧。 */
async function closeActiveTabNoPrompt(uriString: string): Promise<'revert-and-close' | 'tab-close' | 'none'> {
  const target = norm(uriString)
  const tabsOfTarget = (): vscode.Tab[] =>
    vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
      tabUrisOf(t).some((u) => norm(u) === target))
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
  try {
    await poll('revertAndClose 关闭目标标签', () => (tabsOfTarget().length === 0 ? true : undefined), 2500)
    return 'revert-and-close'
  } catch {
    /* 回退 tabGroups.close */
  }
  for (const tab of tabsOfTarget()) {
    await vscode.window.tabGroups.close(tab)
  }
  try {
    await poll('tabGroups.close 关闭目标标签', () => (tabsOfTarget().length === 0 ? true : undefined), 2500)
    return 'tab-close'
  } catch {
    return 'none'
  }
}

const untitledDocs = (): vscode.TextDocument[] =>
  vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'untitled')

export const probe278Cases: Array<[string, () => Promise<void>]> = [

  ['P2-01 探针：A 活动时保存 B 经 TextDocument.save 只落 B 且不动 A', async () => {
    const aDoc = await docOf('p201-save-a.md')
    const bDoc = await docOf('p201-save-b.md')
    const A0 = baseText('save', 'a')
    const B0 = baseText('save', 'b')
    await openWith('p201-save-a.md')
    await waitActiveCustomTab('p201-save-a.md')
    // A、B 各有独立未保存修改；B 全程无标签
    assert(await insertAt(aDoc, 0, '甲未保存 '), 'A 编辑应成功')
    assert(await insertAt(bDoc, 0, '乙未保存 '), 'B 编辑应成功')
    logEv('save-pre', {
      aDirty: aDoc.isDirty, bDirty: bDoc.isDirty,
      aVer: aDoc.version, bVer: bDoc.version,
      bTabs: tabsOfFile('p201-save-b.md').length, ...visibleBrief(),
    })
    // 1.82 公开保存路线是 TextDocument.save()（无 workspace.save(uri) API）：
    // 无需激活或显示 B 编辑器即可保存
    const ok = await bDoc.save()
    await poll('B 保存落盘', async () =>
      (await readDisk('p201-save-b.md')) === `乙未保存 ${B0}` ? true : undefined)
    assert(ok === true, 'TextDocument.save() 应返回 true')
    assert(!bDoc.isDirty, '保存后 B 应干净')
    assert(bDoc.version > 0, 'B 版本号应可观测')
    assert(aDoc.isDirty, 'A 应保持未保存（保存 B 不顺带保存 A）')
    assert(aDoc.getText() === `甲未保存 ${A0}`, 'A 内容不被保存 B 波及')
    const stillA = tabsOfFile('p201-save-a.md').some((t) => t.kind === 'custom')
    assert(stillA, 'A 的 custom 标签应仍在')
    assert(visibleBrief().activeTab?.kind === 'custom', '活动标签仍为 A 的 custom editor')
    logEv('save-post', {
      aDirty: aDoc.isDirty, bDirty: bDoc.isDirty, diskB: await readDisk('p201-save-b.md'),
      ...visibleBrief(),
    })
    await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
  }],

  ['P2-01 探针：A 活动时全局 undo 命中 A 而不触碰 B（路由守卫必要性）', async () => {
    const aDoc = await docOf('p201-guard-a.md')
    const bDoc = await docOf('p201-guard-b.md')
    const A0 = baseText('guard', 'a')
    const B0 = baseText('guard', 'b')
    await openWith('p201-guard-a.md')
    await waitActiveCustomTab('p201-guard-a.md')
    assert(await insertAt(aDoc, 0, '甲编辑 '), 'A 编辑应成功')
    assert(await insertAt(bDoc, 0, '乙编辑 '), 'B 编辑应成功')
    // A 活动时执行全局 undo：撤销的是 A（活动 custom editor）的宿主历史，
    // B 的修改必须原样保留——证明「为 B 调全局 undo」必须先改变路由目标
    await vscode.commands.executeCommand('undo')
    await poll('A 的编辑被撤销', () => (aDoc.getText() === A0 ? true : undefined))
    assert(bDoc.getText() === `乙编辑 ${B0}`, 'B 内容不得被 A 活动时的全局 undo 波及')
    assert(bDoc.isDirty, 'B 应保持未保存')
    logEv('undo-guard', {
      aText: aDoc.getText(), aDirty: aDoc.isDirty,
      bDirty: bDoc.isDirty, bVer: bDoc.version, ...visibleBrief(),
    })
    await restoreAll([{ doc: bDoc, original: B0 }])
  }],

  ['P2-01 探针：临时激活 B 撤销重做后回 A（候选路由与可见代价）', async () => {
    const aDoc = await docOf('p201-route-a.md')
    const bDoc = await docOf('p201-route-b.md')
    const A0 = baseText('route', 'a')
    const B0 = baseText('route', 'b')
    const B1 = `乙一改 ${B0}`
    const B2 = `乙二改 ${B1}`
    await openWith('p201-route-a.md')
    await waitActiveCustomTab('p201-route-a.md')
    // 两笔独立历史（先 B1 后 B2，undo 栈序：B1 底 B2 顶）
    assert(await insertAt(bDoc, 0, '乙一改 '), 'B 第一笔编辑应成功')
    await poll('B 第一笔生效', () => (bDoc.getText() === B1 ? true : undefined))
    assert(await insertAt(bDoc, 0, '乙二改 '), 'B 第二笔编辑应成功')
    await poll('B 第二笔生效', () => (bDoc.getText() === B2 ? true : undefined))
    logEv('route-pre', {
      bVer: bDoc.version, bDirty: bDoc.isDirty,
      bTabs: tabsOfFile('p201-route-b.md').length, ...visibleBrief(),
    })
    // 候选路线：临时把 B 激活为普通文本编辑器（preview 标签）→ 全局 undo
    // → 重做断言 → 回 A → 收掉 B 预览标签。逐步记录可见变化。
    await vscode.window.showTextDocument(bDoc, { preview: true })
    await waitActiveTextDoc(bDoc)
    logEv('route-activated', {
      bTabs: tabsOfFile('p201-route-b.md').map((t) => t.kind), ...visibleBrief(),
    })
    await vscode.commands.executeCommand('undo')
    await poll('undo 撤销 B 最近一笔', () => (bDoc.getText() === B1 ? true : undefined))
    await vscode.commands.executeCommand('undo')
    await poll('undo 回到已保存内容', () => (bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined))
    await vscode.commands.executeCommand('redo')
    await poll('redo 恢复 B 最早一笔', () => (bDoc.getText() === B1 && bDoc.isDirty ? true : undefined))
    assert(aDoc.getText() === A0 && !aDoc.isDirty, 'A 全程不被 B 的撤销路由波及')
    // 还原 B 至干净再收标签——实测编程关闭脏标签是静默丢弃（见末尾专用
    // 探针），这里先把 B 撤回已保存内容，避免收标签路径踩到丢弃语义
    await vscode.commands.executeCommand('undo')
    await poll('B 回到已保存内容', () => (bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined))
    // 回 A：对已开面板 openWith 是重显（不新建面板）
    await openWith('p201-route-a.md')
    await waitActiveCustomTab('p201-route-a.md')
    logEv('route-back-to-a', { ...visibleBrief() })
    await closeTabsOfFile('p201-route-b.md', 'text')
    logEv('route-final', {
      bTabs: tabsOfFile('p201-route-b.md').length,
      aDirty: aDoc.isDirty, bDirty: bDoc.isDirty, ...visibleBrief(),
    })
  }],

  ['P2-01 探针：preserveFocus 激活 B 时全局 undo 的实际落点（变体否证）', async () => {
    const aDoc = await docOf('p201-pf-a.md')
    const bDoc = await docOf('p201-pf-b.md')
    const A0 = baseText('pf', 'a')
    const B0 = baseText('pf', 'b')
    await openWith('p201-pf-a.md')
    await waitActiveCustomTab('p201-pf-a.md')
    assert(await insertAt(aDoc, 0, '甲改 '), 'A 编辑应成功')
    assert(await insertAt(bDoc, 0, '乙改 '), 'B 编辑应成功')
    // preserveFocus: true 只显示 B 不夺取焦点——undo 命令按焦点/活动编辑器
    // 路由，预期落回 A。实际落点如实记录（A/B/none 三态都是证据）。
    await vscode.window.showTextDocument(bDoc, { preview: true, preserveFocus: true })
    await new Promise((r) => setTimeout(r, 500))
    logEv('pf-shown', { ...visibleBrief(), activeTextEditorIsB: visibleBrief().activeTextEditor === bDoc.uri.toString() })
    await vscode.commands.executeCommand('undo')
    let landed: 'A' | 'B' | 'none' = 'none'
    try {
      landed = await poll('undo 落点判定', () => {
        if (aDoc.getText() === A0) return 'A' as const
        if (bDoc.getText() === B0) return 'B' as const
        return undefined
      }, 3000)
    } catch {
      landed = 'none'
    }
    logEv('pf-undo-landed', { landed, aDirty: aDoc.isDirty, bDirty: bDoc.isDirty })
    await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    await closeTabsOfFile('p201-pf-b.md', 'text')
  }],

  ['P2-01 探针：B 两视图交错编辑共享宿主历史', async () => {
    const aDoc = await docOf('p201-share-a.md')
    const bDoc = await docOf('p201-share-b.md')
    const A0 = baseText('share', 'a')
    const B0 = baseText('share', 'b')
    const B1 = `乙视图一改 ${B0}`
    const B2 = `乙applyEdit改 ${B1}`
    const B3 = `乙视图二改 ${B2}`
    await openWith('p201-share-a.md')
    await waitActiveCustomTab('p201-share-a.md')
    // B 以两列两个文本视图打开（产品场景：引用编辑视图 + B 独立标签）
    const ed1 = await vscode.window.showTextDocument(bDoc, vscode.ViewColumn.One)
    const ed2 = await vscode.window.showTextDocument(bDoc, vscode.ViewColumn.Beside)
    assert(ed1 !== ed2, '同文档两列应得到两个编辑器实例')
    // 三笔交错：视图一 → applyEdit（产品写回原语）→ 视图二
    assert(await ed1.edit((eb) => eb.insert(bDoc.positionAt(0), '乙视图一改 ')), '视图一编辑应成功')
    await poll('视图一编辑生效', () => (bDoc.getText() === B1 ? true : undefined))
    assert(await insertAt(bDoc, 0, '乙applyEdit改 '), 'applyEdit 编辑应成功')
    await poll('applyEdit 编辑生效', () => (bDoc.getText() === B2 ? true : undefined))
    assert(await ed2.edit((eb) => eb.insert(bDoc.positionAt(0), '乙视图二改 ')), '视图二编辑应成功')
    await poll('视图二编辑生效', () => (bDoc.getText() === B3 ? true : undefined))
    logEv('share-three-edits', { bVer: bDoc.version, bDirty: bDoc.isDirty })
    // 活动编辑器为 B（视图二）：连续 undo 逆序撤销三笔（跨视图共享历史）
    await waitActiveTextDoc(bDoc)
    await vscode.commands.executeCommand('undo')
    await poll('undo 撤销视图二一笔', () => (bDoc.getText() === B2 ? true : undefined))
    await vscode.commands.executeCommand('undo')
    await poll('undo 撤销 applyEdit 一笔', () => (bDoc.getText() === B1 ? true : undefined))
    await vscode.commands.executeCommand('undo')
    await poll('undo 撤销视图一笔', () => (bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined))
    // 三笔 redo 逐笔恢复（栈序：视图一 → applyEdit → 视图二）
    await vscode.commands.executeCommand('redo')
    await poll('redo 恢复第一笔', () => (bDoc.getText() === B1 ? true : undefined))
    await vscode.commands.executeCommand('redo')
    await poll('redo 恢复第二笔', () => (bDoc.getText() === B2 ? true : undefined))
    await vscode.commands.executeCommand('redo')
    await poll('redo 恢复第三笔', () => (bDoc.getText() === B3 && bDoc.isDirty ? true : undefined))
    assert(aDoc.getText() === A0 && !aDoc.isDirty, 'A 全程不被波及')
    // 收尾：undo 回干净再收 B 标签
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('undo')
    await poll('B 回到已保存内容', () => (bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined))
    await closeTabsOfFile('p201-share-b.md', 'text')
    logEv('share-final', { bDirty: bDoc.isDirty, ...visibleBrief() })
  }],

  ['P2-01 探针：宿主合法跨资源原子撤销（单次 applyEdit 同改 A 与 B）', async () => {
    const aDoc = await docOf('p201-atomic-a.md')
    const bDoc = await docOf('p201-atomic-b.md')
    const A0 = baseText('atomic', 'a')
    const B0 = baseText('atomic', 'b')
    const A1 = `甲原子 ${A0}`
    const B1 = `乙原子 ${B0}`
    await openWith('p201-atomic-a.md')
    await waitActiveCustomTab('p201-atomic-a.md')
    // 一份 WorkspaceEdit 同时改 A 与 B：宿主记为单个跨资源原子历史元素
    assert(await insertAcross([
      { doc: aDoc, offset: 0, text: '甲原子 ' },
      { doc: bDoc, offset: 0, text: '乙原子 ' },
    ]), '跨资源编辑应成功')
    await poll('两文档均生效', () =>
      aDoc.getText() === A1 && bDoc.getText() === B1 ? true : undefined)
    assert(aDoc.isDirty && bDoc.isDirty, 'A、B 均应为未保存')
    // 激活 B 后单次 undo：跨资源元素整体回退（宿主合法语义，单独记录，
    // 不与「只操作 B」的单文档路由混同）
    await vscode.window.showTextDocument(bDoc, { preview: true })
    await waitActiveTextDoc(bDoc)
    await vscode.commands.executeCommand('undo')
    await poll('A 与 B 同时回退', () =>
      aDoc.getText() === A0 && bDoc.getText() === B0 ? true : undefined)
    assert(!aDoc.isDirty && !bDoc.isDirty, '整体回退后两文档均应干净')
    logEv('atomic-undo', { aDirty: aDoc.isDirty, bDirty: bDoc.isDirty, ...visibleBrief() })
    await closeTabsOfFile('p201-atomic-b.md', 'text')
  }],

  ['P2-01 探针：文档级丢弃的可用路线与 undo 翻回语义（revert）', async () => {
    const aDoc = await docOf('p201-revert-a.md')
    const bDoc = await docOf('p201-revert-b.md')
    const A0 = baseText('revert', 'a')
    const B0 = baseText('revert', 'b')
    await openWith('p201-revert-a.md')
    await waitActiveCustomTab('p201-revert-a.md')
    assert(await insertAt(aDoc, 0, '甲改 '), 'A 编辑应成功')
    assert(await insertAt(bDoc, 0, '乙一改 '), 'B 第一笔编辑应成功')
    assert(await insertAt(bDoc, 0, '乙二改 '), 'B 第二笔编辑应成功')
    const bVerBefore = bDoc.version
    // 尝试一：revert 带 URI 参数。首跑实测（1.82.3）：不按参数定位目标——
    // 活动编辑器 A 的未保存修改被误清、B 反被默认编辑器开成 custom 标签且
    // 未回退。三项副作用全部如实记录，不预设任一结果。
    await vscode.commands.executeCommand('workbench.action.files.revert', bDoc.uri)
    let uriArgRevertedB = false
    try {
      await poll('revert(uri) 生效', () =>
        bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined, 3000)
      uriArgRevertedB = true
    } catch {
      uriArgRevertedB = false
    }
    const misrouteHitA = aDoc.getText() === A0 && !aDoc.isDirty
    const strayCustomB = tabsOfFile('p201-revert-b.md').some((t) => t.kind === 'custom')
    logEv('revert-uri-arg', {
      uriArgRevertedB, misrouteHitA, strayCustomB,
      aDirty: aDoc.isDirty, bDirty: bDoc.isDirty, ...visibleBrief(),
    })
    // 尝试二（首跑已证为可用路线）：激活 B 为普通文本编辑器后无参 revert
    if (!uriArgRevertedB) {
      await vscode.window.showTextDocument(bDoc, { preview: true })
      await waitActiveTextDoc(bDoc)
      await vscode.commands.executeCommand('workbench.action.files.revert')
      await poll('激活后 revert 生效', () =>
        bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined)
    }
    assert(bDoc.getText() === B0 && !bDoc.isDirty, '丢弃应恢复整个 B 并清除 dirty')
    logEv('revert-active-route', {
      bVerBefore, bVerAfter: bDoc.version, ...visibleBrief(),
    })
    // 关键语义：revert 之后 undo 能否把已丢弃修改翻回来（首跑实测能）——
    // 记录为证据不断言方向；产品「丢弃」不得宣称历史已清除
    if (!uriArgRevertedB) {
      await waitActiveTextDoc(bDoc)
      await vscode.commands.executeCommand('undo')
      await new Promise((r) => setTimeout(r, 800))
      const undoRestoresDiscarded = bDoc.getText() !== B0 || bDoc.isDirty
      logEv('revert-undo-semantics', { undoRestoresDiscarded, bDirty: bDoc.isDirty, bText: bDoc.getText() })
      if (undoRestoresDiscarded) {
        // 把翻回的内容再丢弃掉，回到干净
        await vscode.commands.executeCommand('workbench.action.files.revert')
        await poll('再次丢弃生效', () =>
          bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined)
      }
    }
    await closeTabsOfFile('p201-revert-b.md', 'text')
    await closeTabsOfFile('p201-revert-b.md', 'custom')
    // A 收尾：误清则已干净，未误清则撤销自身编辑
    await openWith('p201-revert-a.md')
    await waitActiveCustomTab('p201-revert-a.md')
    if (!misrouteHitA) {
      await vscode.commands.executeCommand('undo')
    }
    await poll('A 回到基线干净', () =>
      aDoc.getText() === A0 && !aDoc.isDirty ? true : undefined)
  }],

  ['P2-01 探针：丢弃确认期间 B 再变化后 revert 丢弃全部最新修改', async () => {
    const bDoc = await docOf('p201-late-b.md')
    const B0 = baseText('late', 'b')
    assert(await insertAt(bDoc, 0, '乙确认前改 '), '确认期前编辑应成功')
    const verAtConfirm = bDoc.version
    // 模态确认期间 B 又被修改（版本前移）——丢弃必须覆盖最新状态。
    // revert 带 URI 参数已由上一用例证伪，直接走可用路线（激活后无参 revert）
    assert(await insertAt(bDoc, 0, '乙确认中再改 '), '确认期中编辑应成功')
    assert(bDoc.version > verAtConfirm, 'B 版本应前移')
    await vscode.window.showTextDocument(bDoc, { preview: true })
    await waitActiveTextDoc(bDoc)
    await vscode.commands.executeCommand('workbench.action.files.revert')
    await poll('丢弃包含确认期间修改', () =>
      bDoc.getText() === B0 && !bDoc.isDirty ? true : undefined)
    assert(bDoc.getText() === B0 && !bDoc.isDirty, '丢弃应包含确认期间的最新修改')
    logEv('late-revert', { verAtConfirm, verFinal: bDoc.version })
    await closeTabsOfFile('p201-late-b.md', 'text')
  }],

  ['P2-01 探针：保存失败（只读盘）不误清 dirty 不误丢弃', async () => {
    const bDoc = await docOf('p201-ro-b.md')
    const B0 = baseText('ro', 'b')
    const B1 = `乙改 ${B0}`
    assert(await insertAt(bDoc, 0, '乙改 '), 'B 编辑应成功')
    const fsPath = bDoc.uri.fsPath
    const { chmodSync } = await import('node:fs')
    let saveOutcome: unknown = 'resolved-true'
    try {
      chmodSync(fsPath, 0o444)
      const ok = await bDoc.save()
      saveOutcome = ok
      await new Promise((r) => setTimeout(r, 300))
      assert(bDoc.isDirty, '保存失败后 B 必须仍为未保存')
      assert(bDoc.getText() === B1, '保存失败不得改动 B 内容（不误丢弃）')
      assert((await readDisk('p201-ro-b.md')) === B0, '失败保存不得写脏磁盘')
    } finally {
      chmodSync(fsPath, 0o666)
    }
    logEv('ro-save-failed', { saveOutcome, bDirty: bDoc.isDirty, bText: bDoc.getText() })
    // 解除只读后保存应成功——失败不得留下坏状态
    const ok2 = await bDoc.save()
    assert(ok2 === true && !bDoc.isDirty, '恢复可写后保存应成功')
    await poll('落盘一致', async () =>
      (await readDisk('p201-ro-b.md')) === B1 ? true : undefined)
    logEv('ro-save-recovered', { bDirty: bDoc.isDirty })
    await restoreAll([{ doc: bDoc, original: B0 }])
  }],

  ['P2-01 探针：脏 B 无编辑器驻留（关闭交接的资源前提）', async () => {
    const aDoc = await docOf('p201-recycle-a.md')
    const bDoc = await docOf('p201-recycle-b.md')
    const A0 = baseText('recycle', 'a')
    const B0 = baseText('recycle', 'b')
    const B1 = `乙改 ${B0}`
    await openWith('p201-recycle-a.md')
    await waitActiveCustomTab('p201-recycle-a.md')
    assert(await insertAt(bDoc, 0, '乙改 '), 'B 编辑应成功')
    // B 从未拥有任何编辑器：脏 TextDocument 是否驻留 textDocuments
    await new Promise((r) => setTimeout(r, 1500))
    const dirtyDocAlive = vscode.workspace.textDocuments.some(
      (d) => d.uri.toString() === bDoc.uri.toString() && d.isDirty && d.getText() === B1)
    assert(dirtyDocAlive, '无编辑器的脏 B 文档必须驻留（Q14：dirty 模型不被一般回收）')
    logEv('recycle-dirty-alive', { dirtyDocAlive, bVer: bDoc.version })
    // 干净 B：短暂驻留后是否被回收。首跑实测：applyEdit 还原回与磁盘一致的
    // 内容后 isDirty 不清除（dirty 按保存版本判定，非内容相等；undo 回原文
    // 才清）——补落盘收敛，差异作为观察项记录
    await restoreBuffer(bDoc, B0)
    logEv('recycle-restore-quirk', {
      textIsBase: bDoc.getText() === B0, isDirtyAfterEditRestore: bDoc.isDirty,
    })
    if (bDoc.isDirty) {
      assert(await bDoc.save(), '还原后补落盘应成功')
    }
    await poll('B 干净', () => (!bDoc.isDirty ? true : undefined))
    await new Promise((r) => setTimeout(r, 1500))
    const cleanDocAlive = vscode.workspace.textDocuments.some(
      (d) => d.uri.toString() === bDoc.uri.toString())
    logEv('recycle-clean', { cleanDocAlive })
    await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
  }],

  ['P2-01 探针：A 关闭后 showTextDocument 交接 dirty B（preview:false 钉住）', async () => {
    const bDoc = await docOf('p201-hand-b.md')
    const cDoc = await docOf('p201-hand-c.md')
    const B0 = baseText('hand', 'b')
    const C0 = 'P2-01 hand 旁观丙\n'
    const B1 = `乙交接改 ${B0}`
    await openWith('p201-hand-a.md')
    await waitActiveCustomTab('p201-hand-a.md')
    assert(await insertAt(bDoc, 0, '乙交接改 '), 'B 编辑应成功')
    logEv('hand-pre', {
      aTabs: tabsOfFile('p201-hand-a.md').map((t) => t.kind),
      bTabs: tabsOfFile('p201-hand-b.md').length, bDirty: bDoc.isDirty,
    })
    // 普通 A 关闭（无公开可取消前置事件——closeActiveEditor 即用户关标签）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('A 标签关闭', () => (tabsOfFile('p201-hand-a.md').length === 0 ? true : undefined))
    // 交接：现有 TextDocument 打开普通文本标签，preview: false
    await vscode.window.showTextDocument(bDoc, { preview: false })
    await waitActiveTextDoc(bDoc)
    assert(bDoc.getText() === B1 && bDoc.isDirty, '交接应显示 dirty B 的当前内容')
    const bTextTabs = tabsOfFile('p201-hand-b.md').filter((t) => t.kind === 'text')
    assert(bTextTabs.length === 1, 'B 应恰好打开一个文本标签')
    // preview:false 行为学断言：后续 preview 打开丙不得替换掉 B（B 非预览）
    await vscode.window.showTextDocument(cDoc, { preview: true })
    await poll('丙预览打开', () =>
      tabsOfFile('p201-hand-c.md').some((t) => t.kind === 'text') ? true : undefined)
    assert(tabsOfFile('p201-hand-b.md').some((t) => t.kind === 'text'), 'B 标签不得被预览打开替换（非预览钉住）')
    logEv('hand-opened', {
      bTabs: tabsOfFile('p201-hand-b.md').map((t) => t.kind),
      cTabs: tabsOfFile('p201-hand-c.md').map((t) => t.kind),
      bDirty: bDoc.isDirty, ...visibleBrief(),
    })
    await closeTabsOfFile('p201-hand-c.md', 'text')
    await restoreAll([{ doc: bDoc, original: B0 }, { doc: cDoc, original: C0 }])
    await closeTabsOfFile('p201-hand-b.md', 'text')
  }],

  ['P2-01 探针：交接复用已有 B 标签不重复开', async () => {
    const bDoc = await docOf('p201-hand2-b.md')
    const B0 = baseText('hand2', 'b')
    const B1 = `乙去重改 ${B0}`
    // B 先以钉住文本标签存在（产品场景：用户已开过 B）
    await vscode.window.showTextDocument(bDoc, { preview: false })
    await waitActiveTextDoc(bDoc)
    await openWith('p201-hand2-a.md')
    await waitActiveCustomTab('p201-hand2-a.md')
    assert(await insertAt(bDoc, 0, '乙去重改 '), 'B 编辑应成功')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('A 标签关闭', () => (tabsOfFile('p201-hand2-a.md').length === 0 ? true : undefined))
    await vscode.window.showTextDocument(bDoc, { preview: false })
    await waitActiveTextDoc(bDoc)
    const bTextTabs = tabsOfFile('p201-hand2-b.md').filter((t) => t.kind === 'text')
    assert(bTextTabs.length === 1, `已有 B 标签应复用去重（实际 ${bTextTabs.length}）`)
    assert(bDoc.getText() === B1 && bDoc.isDirty, '复用标签应显示 dirty 内容')
    logEv('hand2-dedup', { bTabs: bTextTabs.length, bDirty: bDoc.isDirty })
    await restoreAll([{ doc: bDoc, original: B0 }])
    await closeTabsOfFile('p201-hand2-b.md', 'text')
  }],

  ['P2-01 探针：关闭 A 时在途写回完成后交接最新 dirty', async () => {
    const bDoc = await docOf('p201-inflight-b.md')
    const B0 = baseText('inflight', 'b')
    const B1 = `乙在途改 ${B0}`
    await openWith('p201-inflight-a.md')
    await waitActiveCustomTab('p201-inflight-a.md')
    // 在途写回：applyEdit 尚未 resolve 时即关闭 A——写回不得被取消
    const writeP = insertAt(bDoc, 0, '乙在途改 ')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('A 标签关闭', () => (tabsOfFile('p201-inflight-a.md').length === 0 ? true : undefined))
    assert(await writeP, '关闭 A 后在途写回应完成')
    await poll('写回生效且 dirty', () =>
      bDoc.getText() === B1 && bDoc.isDirty ? true : undefined)
    // 交接按最新 dirty（不是 dispose 发生前的旧状态）
    await vscode.window.showTextDocument(bDoc, { preview: false })
    await waitActiveTextDoc(bDoc)
    assert(bDoc.getText() === B1 && bDoc.isDirty, '交接应包含在途写回的最新修改')
    logEv('inflight-handover', { bVer: bDoc.version, bDirty: bDoc.isDirty, ...visibleBrief() })
    await restoreAll([{ doc: bDoc, original: B0 }])
    await closeTabsOfFile('p201-inflight-b.md', 'text')
  }],

  ['P2-01 探针：干净 B 不交接打开（交接仅限 dirty 目标）', async () => {
    const bDoc = await docOf('p201-clean-b.md')
    await openWith('p201-clean-a.md')
    await waitActiveCustomTab('p201-clean-a.md')
    assert(!bDoc.isDirty, '前置：B 干净')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('A 标签关闭', () => (tabsOfFile('p201-clean-a.md').length === 0 ? true : undefined))
    await new Promise((r) => setTimeout(r, 800))
    assert(tabsOfFile('p201-clean-b.md').length === 0, '干净 B 不应被自动打开')
    logEv('clean-no-open', { bTabs: tabsOfFile('p201-clean-b.md').length, bDirty: bDoc.isDirty })
  }],

  ['P2-01 探针：untitled 临时副本作 vscode.diff 左侧且不扰动 B', async () => {
    const bDoc = await docOf('p201-diff-b.md')
    const B0 = baseText('diff', 'b')
    const B1 = `乙冲突版本 ${B0}`
    assert(await insertAt(bDoc, 0, '乙冲突版本 '), 'B 编辑应成功')
    const tempText = '未提交输入第一行\n未提交输入第二行\n'
    const temp = await vscode.workspace.openTextDocument({ content: tempText, language: 'markdown' })
    assert(temp.uri.scheme === 'untitled', '临时副本应为 untitled 文档')
    logEv('diff-temp-created', { tempUri: temp.uri.toString(), bTabs: tabsOfFile('p201-diff-b.md').length })
    await vscode.commands.executeCommand('vscode.diff', temp.uri, bDoc.uri, '冲突对比（左临时右真实）', {
      override: true,
    })
    await poll('diff 标签就位', () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputTextDiff ? tab : undefined
    })
    const diffTab = vscode.window.tabGroups.activeTabGroup.activeTab
    const input = diffTab?.input as vscode.TabInputTextDiff
    assert(norm(input.original.toString()) === norm(temp.uri.toString()), 'diff 左侧应为临时副本')
    assert(norm(input.modified.toString()) === norm(bDoc.uri.toString()), 'diff 右侧应为真实 B')
    // 左右内容完整可读；B 的 dirty 与内容不被打开对比扰动
    assert(temp.getText() === tempText, '临时副本内容应完整')
    assert(bDoc.getText() === B1 && bDoc.isDirty, '打开对比不得改写或清洗 B')
    assert(tabsOfFile('p201-diff-b.md').every((t) => t.kind === 'diff'), '对比页应为 B 的唯一视图形态')
    logEv('diff-open', {
      leftLen: temp.getText().length, rightDirty: bDoc.isDirty,
      bTextTabs: tabsOfFile('p201-diff-b.md').filter((t) => t.kind === 'text').length,
      untitledCount: untitledDocs().length, ...visibleBrief(),
    })
    // 关闭对比页：untitled 左侧恒「未保存」，直接关可能触发宿主保存确认
    // （模态会卡死无头宿主）——先把需要保留的 B 右侧还原干净，再用
    // revertAndCloseActiveEditor 免提示丢弃临时副本并关闭；实际通道即证据
    const dirtyWhileDiffOpen = bDoc.isDirty && bDoc.getText() === B1
    await restoreAll([{ doc: bDoc, original: B0 }])
    const closeChannel = await closeActiveTabNoPrompt(bDoc.uri.toString())
    await new Promise((r) => setTimeout(r, 800))
    const tempStillOpen = untitledDocs().some((d) => d.uri.toString() === temp.uri.toString())
    logEv('diff-closed', {
      closeChannel, dirtyWhileDiffOpen, tempStillOpen,
      tempTextIntact: temp.getText() === tempText,
      bDirty: bDoc.isDirty, bText: bDoc.getText(),
    })
    assert(dirtyWhileDiffOpen, '对比页打开期间 B 的 dirty 内容应完好')
    assert(bDoc.getText() === B0, '关闭对比不得清除 B 内容')
    assert(closeChannel !== 'none', '对比页应可免提示关闭（通道记录在案）')
  }],

  ['P2-01 探针：对比打开失败不清除临时副本（失败保护）', async () => {
    const tempText = '失败保护输入行一\n失败保护输入行二\n'
    const temp = await vscode.workspace.openTextDocument({ content: tempText, language: 'markdown' })
    const badUri = vscode.Uri.parse('vscode-probe-unknown-scheme://nowhere/x.md')
    let failure: string | undefined
    try {
      await vscode.commands.executeCommand('vscode.diff', temp.uri, badUri, '预期失败的对比', {
        override: true,
      })
    } catch (err) {
      failure = String(err)
    }
    await new Promise((r) => setTimeout(r, 500))
    assert(temp.getText() === tempText, '打开失败不得清除临时副本（原输入保留）')
    logEv('diff-fail', {
      failure: failure ?? 'resolved', tempIntact: temp.getText() === tempText,
      activeTab: visibleBrief().activeTab,
    })
    // 失败后同一临时副本仍可成功打开对比（原输入未被消耗）
    const bDoc = await docOf('p201-diff-fail-b.md')
    const B0 = baseText('diff-fail', 'b')
    assert(await insertAt(bDoc, 0, '乙冲突版本 '), 'B 编辑应成功')
    await vscode.commands.executeCommand('vscode.diff', temp.uri, bDoc.uri, '失败后的成功对比', {
      override: true,
    })
    await poll('diff 标签就位', () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputTextDiff ? tab : undefined
    })
    const diffTab = vscode.window.tabGroups.activeTabGroup.activeTab
    const input = diffTab?.input as vscode.TabInputTextDiff
    assert(norm(input.original.toString()) === norm(temp.uri.toString()), '复开左侧应仍为原临时副本')
    assert(temp.getText() === tempText, '复开对比不得改写临时副本')
    await restoreAll([{ doc: bDoc, original: B0 }])
    const closeChannel = await closeActiveTabNoPrompt(bDoc.uri.toString())
    logEv('diff-fail-reopened-closed', { closeChannel, tempIntact: temp.getText() === tempText })
    assert(closeChannel !== 'none', '复开对比页应可免提示关闭')
  }],

  ['P2-01 探针：untitled 临时副本关闭后的资源释放', async () => {
    const tempText = '释放观测输入\n'
    const temp = await vscode.workspace.openTextDocument({ content: tempText, language: 'markdown' })
    await vscode.window.showTextDocument(temp, { preview: true })
    await waitActiveTextDoc(temp)
    assert(untitledDocs().some((d) => d.uri.toString() === temp.uri.toString()), '临时副本应驻留')
    // untitled 恒「未保存」：用 revertAndCloseActiveEditor 免提示丢弃并关闭
    const closeChannel = await closeActiveTabNoPrompt(temp.uri.toString())
    await poll('untitled 从 textDocuments 释放', () =>
      untitledDocs().some((d) => d.uri.toString() === temp.uri.toString()) ? undefined : true, 5000)
    logEv('untitled-released', { closeChannel, uri: temp.uri.toString() })
  }],

  ['P2-01 探针：编程关闭脏 B 最后编辑器是静默丢弃（Q14 边界修正）', async () => {
    const bDoc = await docOf('p201-recycle-b.md')
    const B0 = baseText('recycle', 'b')
    const B1 = `乙改 ${B0}`
    assert(await insertAt(bDoc, 0, '乙改 '), 'B 编辑应成功')
    await vscode.window.showTextDocument(bDoc, { preview: true })
    await waitActiveTextDoc(bDoc)
    // 首跑实测（1.82.3）：Tab API 关闭脏编辑器为「静默丢弃」——无确认弹窗、
    // 无挂起，未保存内容不驻留（Q14「dirty 模型不被一般回收」只对无编辑器
    // 或用户交互关闭成立，对编程关闭不成立）。据此断言钉住该语义。
    const tab = tabsOfFile('p201-recycle-b.md').find((t) => t.kind === 'text')
    assert(tab, 'B 应有文本标签')
    const closed = await vscode.window.tabGroups.close(tab!.tab)
    await new Promise((r) => setTimeout(r, 1200))
    const aliveAfterClose = vscode.workspace.textDocuments.some(
      (d) => d.uri.toString() === bDoc.uri.toString() && d.isDirty && d.getText() === B1)
    logEv('tab-close-dirty-semantics', {
      closed, aliveAfterClose, bDirtyAfterClose: bDoc.isDirty,
    })
    assert(closed === true, '编程关闭脏编辑器应不弹确认直接完成')
    assert(!aliveAfterClose, '静默丢弃：脏模型不得在编程关闭后驻留未保存内容')
    // 丢弃语义钉死：重开只剩磁盘内容，未保存内容不可复活
    const reopened = await vscode.workspace.openTextDocument(bDoc.uri)
    assert(reopened.getText() === B0 && !reopened.isDirty,
      '编程关闭丢弃后重开应只剩磁盘内容')
    logEv('tab-close-dirty-reopened', { text: reopened.getText() === B0, dirty: reopened.isDirty })
  }],

]
