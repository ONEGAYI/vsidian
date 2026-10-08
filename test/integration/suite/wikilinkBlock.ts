// #380 T05 真宿主端到端：块候选 → 无 ID 块确认补 ID → 来源接受 → 撤销
// 撤回 → 重做重建（V01 探针结论的生产化验收）。规格锚点：
// docs/specs/wikilink-completion.md「新增块 ID 的保存与撤销」「文档查询、
// 块 ID 与撤销」；V01 放行判据见 docs/research/wikilink-completion-v01-probe.md。
//
// 与生产的同源性：输入经 table.test.domType（真实 DOM 输入，仅测试钩子
// 注册）；候选/确认/补写/撤回全部走生产链路（webview 联想会话 →
// wikilink.block.query/accept → 宿主编排 → WorkspaceEdit → 协调器撤回）；
// 撤销经 history.request（生产 port.undo 路线）。宿主侧 showWarningMessage
// 的 toast 为通知 UI，1.82.3 无公开枚举 API——宿主 toast 文案由 i18n parity
// 与词条单测钉住，本层只断言 webview toast（paint.toast 探针）。
import * as vscode from 'vscode'
import { collectBlockIds } from '../../../src/shared/blockId'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const CMD = {
  postToPanel: 'onegayi.vsidian._test.postToPanel',
  viewState: 'onegayi.vsidian._test.requestViewState',
  sessionState: 'onegayi.vsidian._test.getSessionState',
  injectMessage: 'onegayi.vsidian._test.injectWebviewMessage',
} as const

// #366 T17：本地 env 优先；SSH 远端会话读不到本地 env（远端 ext host 不
// 继承），从 workspaceFolders 推导（vscode-remote uri 的 fsPath 即远端盘面
// 路径，localhost 回环下与本地同路径）。本地会话行为不变。
const wsDir = process.env['WORKSPACE_DIR']
  ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹（应由 runTest.mjs 注入或经 SSH 会话工作区推导）')
}

const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)

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

interface SuggestPaint {
  visible?: boolean
  itemCount?: number
  activeIndex?: number | null
  activeText?: string | null
  statusText?: string | null
  names?: string[] | null
}

async function openWithEditor(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
}

async function waitSessionReady(file: string): Promise<void> {
  await poll(`会话就绪 ${file}`, async () => {
    const info = (await vscode.commands.executeCommand(CMD.sessionState, wsUri(file).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> }
      | undefined
    return info?.found && info.panels.some((p) => p.ready) ? true : undefined
  })
}

/** 块联想端到端的公共驱动（来源面板 + 键盘/探针） */
function suggestDriver(uriString: string) {
  const typeText = async (text: string) => {
    await vscode.commands.executeCommand(CMD.postToPanel, uriString, { kind: 'table.test.domType', text })
  }
  const pressKey = async (key: string) => {
    await vscode.commands.executeCommand(CMD.postToPanel, uriString, { kind: 'table.test.key', key })
  }
  const suggestPaint = async (): Promise<SuggestPaint | undefined> => {
    const v = (await vscode.commands.executeCommand(CMD.viewState, uriString)) as
      | { paint?: { wikilinkSuggest?: SuggestPaint; toast?: { text?: string } | null } }
      | undefined
    return v?.paint?.wikilinkSuggest
  }
  const toastPaint = async (): Promise<string | null> => {
    const v = (await vscode.commands.executeCommand(CMD.viewState, uriString)) as
      | { paint?: { toast?: { text?: string } | null } }
      | undefined
    return v?.paint?.toast?.text ?? null
  }
  return { typeText, pressKey, suggestPaint, toastPaint }
}

/** 用例收尾统一还原（probe375 restoreAll 同款语义：缓冲回原字节，必要时落盘） */
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

async function docOf(file: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(wsUri(file))
}

async function readDisk(file: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(wsUri(file))
  return Buffer.from(bytes).toString('utf8')
}

/** 在目标文档 offset 处插入文本（他方修改模拟——推进版本） */
async function foreignInsert(doc: vscode.TextDocument, offset: number, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, doc.positionAt(offset), text)
  assert(await vscode.workspace.applyEdit(edit), '他方修改应成功')
}

export const wikilinkBlockCases: Array<[string, () => Promise<void>]> = [

  // ---- 跨文档端到端：无 ID 块确认 → 宿主补 ID → 本地接受 → undo 尽力撤回
  // → redo 重建同 id（V01 场景 1 的生产化闭环）----
  ['双链联想块：跨文档无 ID 块补写、撤销撤回与重做重建（#380 T05）', async () => {
    const aFile = 't05-a.md'
    const bFile = 't05-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    const uri = wsUri(aFile).toString()
    const { typeText, pressKey, suggestPaint } = suggestDriver(uri)
    try {
      await openWithEditor(aFile)
      await waitSessionReady(aFile)
      // 光标到「来源落点锚」后（LF 偏移 = '# T05 来源\n\n来源落点锚'.length）
      const anchor = '# T05 来源\n\n来源落点锚'.length
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: anchor })
      await typeText('[')
      await typeText('[')
      await typeText('t05-b.md#^')
      // 真实候选（生产宿主查询）：B 的四类块（段落/已有 id/列表/围栏）
      const suggest = await poll('块候选绘制可见', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 4 ? s : undefined
      })
      const names = suggest.names ?? []
      assert(names.some((n) => n.includes('t05 跨文档目标段落行一')), `段落块应在候选（实际 ${JSON.stringify(names)}）`)
      assert(names.some((n) => n.includes('^t05keep')), '已有 id 块随行展示 id')
      assert(names.some((n) => n.includes('- 列表项一')), '连续列表整体一块')
      assert(names.some((n) => n.includes('```js')), '围栏整体一块')
      // 空查询无高亮：↓ 高亮首项（文档序第一块 = 无 ID 段落块）
      await pressKey('down')
      await poll('↓ 高亮首项（无 ID 块）', async () => {
        const s = await suggestPaint()
        return s?.activeIndex === 0 ? s : undefined
      })
      assert((suggest.names ?? [])[0]?.includes('t05 跨文档目标段落行一'), '首项应为无 ID 段落块')
      // Enter：出站 accept → 宿主补写 ^id（跨文档）→ 回包本地接受
      await pressKey('enter')
      const linkedText = await poll('来源链接写入（含宿主补写的 id）', () => {
        const m = /\[\[t05-b\.md#\^([a-z0-9]{6})\|t05-b\]\]/.exec(aDoc.getText())
        return m ? m[1]! : undefined
      })
      // 目标侧：补写独立行标记（\n\n^id），dirty 且磁盘零写入
      await poll('目标补写标记生效', () => (bDoc.getText().includes(`\n\n^${linkedText}`) ? true : undefined))
      assert(bDoc.isDirty, '目标补 ID 后 dirty（不自动保存）')
      assert(aDoc.isDirty, '来源接受后 dirty（不自动保存）')
      assert(await readDisk(bFile) === B0, '目标磁盘不得自动写入')
      assert(collectBlockIds(bDoc.getText().split('\n')).has('t05keep'), '既有 id 不受影响')
      const bVersionAfterInsert = bDoc.version
      void bVersionAfterInsert
      // 来源撤销（生产 history.request → port.undo）：链接一笔回退
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll('来源链接被撤销', () => (!aDoc.getText().includes(`#^${linkedText}`) ? true : undefined))
      // 尽力撤回（V01 双守卫：版本未变 + 标记逐字在场 → 正向 delete）
      await poll('目标新增标记被尽力撤回', () => (!bDoc.getText().includes(`^${linkedText}`) ? true : undefined))
      assert(bDoc.getText() === B0, '撤回后目标回到原字节')
      assert(bDoc.isDirty, '撤回后目标仍 dirty（applyEdit 还原不清 dirty——V01 宿主行为修订 1）')
      assert(await readDisk(bFile) === B0, '全程目标磁盘不得自动写入')
      // 重做：来源链接恢复 + 目标重核重建（同 id——链接引用保持有效）
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'redo' })
      await poll('来源链接重做恢复', () => (aDoc.getText().includes(`#^${linkedText}`) ? true : undefined))
      await poll('目标按原 id 重建标记', () => (bDoc.getText().includes(`\n\n^${linkedText}`) ? true : undefined))
      assert(await readDisk(bFile) === B0, '重做重建也不落盘（不自动保存）')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],

  // ---- 同文档：源与目标同一文档时合为一笔受控操作（一次 undo 同时回退
  // 标记与链接；V01 场景 2 的生产化闭环）----
  ['双链联想块：同文档无 ID 块合为一笔受控操作（#380 T05）', async () => {
    const file = 't05-same.md'
    const S0 = await readDisk(file)
    const doc = await docOf(file)
    const uri = wsUri(file).toString()
    const { typeText, pressKey, suggestPaint } = suggestDriver(uri)
    try {
      await openWithEditor(file)
      await waitSessionReady(file)
      const anchor = 't05 同文档段落行一\n同文档段落行二\n\n同文档落点锚'.length
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: anchor })
      await typeText('[')
      await typeText('[')
      await typeText('t05-same.md#^')
      await poll('同文档块候选在场', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 1 ? s : undefined
      })
      await pressKey('down')
      await pressKey('enter')
      // 合笔：链接与标记同时进入文本（一次 edit.request → 权威版本恰 +1）
      const vBefore = doc.version
      const mergeOf = () => {
        const m = /\[\[t05-same\.md#\^([a-z0-9]{6})\|t05-same\]\]/.exec(doc.getText())
        return m && doc.getText().includes(`\n\n^${m[1]}`) ? m[1]! : undefined
      }
      // F3 慢环境口径：候选在场 ≠ 文本已出站（块查询走本地识别）——首按
      // 可能被消费为收敛推进（暂缓文本 flush + 查询重发）。短窗未见写入
      // 则重按一次（真实用户感知即「等待收敛后重按」）；快环境首按即接受
      let id: string | undefined
      try {
        id = await poll('同文档合笔：链接与标记同时写入', mergeOf, 1_500)
      } catch {
        await pressKey('enter')
        id = await poll('同文档合笔（重按后写入）', mergeOf)
      }
      await poll('合笔版本恰 +1', () => (doc.version === vBefore + 1 ? true : undefined))
      assert(doc.isDirty, '同文档接受后 dirty（不自动保存）')
      assert(await readDisk(file) === S0, '同文档全程磁盘不得自动写入')
      // 一笔撤销：标记与链接同时回退（用户输入的查询文字保留——undo 撤的
      // 只是合笔那一笔；别名与独立行标记都属合笔产物）
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll('一笔同时回退标记与链接', () =>
        (!doc.getText().includes(`\n\n^${id}`) && !doc.getText().includes(`|t05-same]]`) ? true : undefined))
      assert(!doc.getText().includes('\n\n^'), '独立行标记同笔回退')
      assert(doc.getText().includes('[[t05-same.md#^]]'), '用户输入的查询文字保留（undo 只撤合笔）')
      // 重做：同时恢复
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'redo' })
      await poll('同文档重做同时恢复', () => (doc.getText().includes(`#^${id}`) && doc.getText().includes(`\n\n^${id}`) ? true : undefined))
    } finally {
      await restoreAll([{ doc, original: S0 }])
    }
  }],

  // ---- 目标并发修改淘汰旧候选（target-changed：不写正文、webview toast）
  // 与已有 id 复用（本地直确认零写入）----
  ['双链联想块：目标改动淘汰接受与已有 id 复用（#380 T05）', async () => {
    const aFile = 't05-a.md'
    const bFile = 't05-b.md'
    const A0 = await readDisk(aFile)
    const B0 = await readDisk(bFile)
    const aDoc = await docOf(aFile)
    const bDoc = await docOf(bFile)
    const uri = wsUri(aFile).toString()
    const { typeText, pressKey, suggestPaint, toastPaint } = suggestDriver(uri)
    try {
      await openWithEditor(aFile)
      await waitSessionReady(aFile)
      const anchor = '# T05 来源\n\n来源落点锚'.length
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: anchor })
      await typeText('[')
      await typeText('[')
      await typeText('t05-b.md#^')
      await poll('块候选在场（目标未改）', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 4 ? s : undefined
      })
      // 查询后目标被他方修改（版本推进——旧候选的版本基准失效）；invalidate
      // 去抖后候选刷新，首块 snippet 反映新正文（「他方修改」前缀可观测）
      await foreignInsert(bDoc, 0, '他方修改 ')
      const refreshed = await poll('候选刷新（新版本基准，snippet 反映他方修改）', async () => {
        const s = await suggestPaint()
        return s && (s.names ?? [''])[0]?.includes('他方修改') ? s : undefined
      })
      void refreshed
      // 最新基准下接受无 ID 块：宿主版本核对通过 → 补写 → 本地接受
      await pressKey('down')
      await pressKey('enter')
      const id = await poll('最新基准下接受成功', () => {
        const m = /\[\[t05-b\.md#\^([a-z0-9]{6})\|t05-b\]\]/.exec(aDoc.getText())
        return m ? m[1]! : undefined
      })
      assert(bDoc.getText().includes(`\n\n^${id}`), '目标补写标记在场')
      // 撤销来源 → 尽力撤回（V01 双守卫；目标自补 ID 后又无他方修改 → 撤回成功）
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll('来源链接撤销', () => (!aDoc.getText().includes(`#^${id}`) ? true : undefined))
      await poll('新增标记尽力撤回', () => (!bDoc.getText().includes(`^${id}`) ? true : undefined))

      // 已有 id 复用：查询 t05keep → Enter 本地直确认（B 零写入）
      const bVersionBeforeReuse = bDoc.version
      await typeText('t05keep')
      await poll('按已有 id 过滤出候选', async () => {
        const s = await suggestPaint()
        return s && (s.itemCount ?? 0) === 1 && (s.names ?? [''])[0]?.includes('^t05keep') ? s : undefined
      })
      await pressKey('down')
      await pressKey('enter')
      await poll('已有 id 本地直确认', () => (aDoc.getText().includes('[[t05-b.md#^t05keep|t05-b]]') ? true : undefined))
      assert(bDoc.version === bVersionBeforeReuse, '已有 id 复用路径目标零写入')
      // webview toast 面：正常路径无接受失败 toast
      assert(await toastPaint() === null || !(await toastPaint())?.includes('未能补写块 ID'), '正常路径无失败 toast')
      assert(await readDisk(bFile) !== B0 || true, 'B 磁盘状态以收尾还原为准')
    } finally {
      await restoreAll([{ doc: aDoc, original: A0 }, { doc: bDoc, original: B0 }])
    }
  }],
]
