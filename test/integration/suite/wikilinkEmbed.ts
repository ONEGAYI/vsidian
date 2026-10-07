// #381 T06 真宿主端到端：表格及引用内部 Live 的双链联想——B 内文件候选
// 以 B 为来源（同名文件目录区分）、确认只写 B（A 字节/appliedEdits 不变）、
// B 引 C 无 ID 块的补 ID 与尽力撤销各归其文档、Esc 先关候选、端口释放后
// 迟到回包拒收、候选绘制可见性（paint.wikilinkSuggest 的 elementFromPoint
// 口径）。规格锚点：docs/specs/wikilink-completion.md「首期编辑位置」
// 「消息、归属与迟到守卫」；票面 docs/specs/wikilink-completion-tickets/t06.md。
//
// 与生产的同源性：输入经 embed.test.domType（真实 DOM 输入，仅测试钩子
// VSIDIAN_TEST_HOOKS=1 时注册）；候选/确认/补写/撤回全部走生产链路（嵌入
// 实例联想会话 → refEdit.message 信封 → 宿主以 B 为来源执行 →
// refEdit.push 回包）；撤销经 embed.test.history（生产 history.request）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const CMD = {
  postToPanel: 'onegayi.vsidian._test.postToPanel',
  viewState: 'onegayi.vsidian._test.requestViewState',
  sessionState: 'onegayi.vsidian._test.getSessionState',
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

const A_FILE = 't06-a.md'
const B_FILE = 'sub/t06-b.md'
const C_SUB_FILE = 'sub/t06-c.md'
const B_INNER = 'sub/t06-b.md'

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

/** A 面板内嵌入卡就绪到内部 Live 绑定（端口在场 + 实例装载） */
async function waitEmbedLiveBound(): Promise<string> {
  return poll('嵌入 B 绑定内部 Live 端口', async () => {
    const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri(A_FILE).toString())) as
      | { readingEmbed?: Array<{ inner?: string; liveBound?: boolean; livePortId?: string | null }> }
      | undefined
    const entry = v?.readingEmbed?.find((c) => c.inner === B_INNER)
    return entry?.liveBound === true && typeof entry.livePortId === 'string' ? entry.livePortId : undefined
  })
}

const post = (message: Record<string, unknown>): Thenable<unknown> =>
  vscode.commands.executeCommand(CMD.postToPanel, wsUri(A_FILE).toString(), message)

async function suggestPaint(): Promise<SuggestPaint | undefined> {
  const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri(A_FILE).toString())) as
    | { paint?: { wikilinkSuggest?: SuggestPaint } }
    | undefined
  return v?.paint?.wikilinkSuggest
}

async function docOf(file: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(wsUri(file))
}

async function readDisk(file: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(wsUri(file))
  return Buffer.from(bytes).toString('utf8')
}

/** 用例收尾统一还原（缓冲回原字节，必要时落盘——probe375 同款语义） */
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

export const wikilinkEmbedCases: Array<[string, () => Promise<void>]> = [

  // ---- B 内文件联想：同名文件目录区分、确认只写 B（含格内转义竖线）、
  //      A 字节与 dirty 全程不变、候选绘制可见、Esc 先关 ----
  ['双链联想内部 Live：B 内同名文件候选、确认只写 B 与格内转义（#381 T06）', async () => {
    const aDoc = await docOf(A_FILE)
    const bDoc = await docOf(B_FILE)
    const A0 = await readDisk(A_FILE)
    const B0 = bDoc.getText()
    try {
      await openWithEditor(A_FILE)
      await waitSessionReady(A_FILE)
      await waitEmbedLiveBound()
      // 光标进 B 第三行表格格内的预置闭合围栏（[[]] 中间）
      const cellAt = B0.indexOf('| [[ ]] | t |') + 4
      await post({ kind: 'embed.test.focus', inner: B_INNER, pos: cellAt })
      // 真实 DOM 输入触发（成对补全已由预置 [[]] 承担，直接输前缀）
      await post({ kind: 'embed.test.domType', inner: B_INNER, text: 't06-c' })
      const suggest = await poll('B 内文件候选绘制可见', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 2 ? s : undefined
      })
      const names = suggest.names ?? []
      // 同名文件（sub/t06-c.md 与根 t06-c.md）全部展示（目录在候选行次级
      // 段标注——names 探针只取主名，两项同名即两条目录来源；插入路径的
      // 目录归属由下方确认断言钉住）
      assert(names.filter((n) => n.includes('t06-c.md')).length >= 2,
        `同名候选两项（实际 ${JSON.stringify(names)}）`)
      // Esc 先关候选：列表消失（浮层移除后 paint 缺省）、嵌入仍在内部 Live
      await post({ kind: 'embed.test.key', inner: B_INNER, key: 'escape' })
      await poll('Esc 关闭候选', async () => {
        const s = await suggestPaint()
        return !s || s.visible !== true ? true : undefined
      })
      const afterEsc = (await vscode.commands.executeCommand(CMD.viewState, wsUri(A_FILE).toString())) as
        | { readingEmbed?: Array<{ inner?: string; internalMode?: string }> }
        | undefined
      assert(afterEsc?.readingEmbed?.find((c) => c.inner === B_INNER)?.internalMode === 'live',
        'Esc 只关候选——嵌入仍在内部 Live')
      // 重开（目标区再输入触发——查询为光标左侧前缀）并确认：非空查询
      // 自动高亮首项，Enter 接受（'.' 仍在候选文件名前缀序列内）
      await post({ kind: 'embed.test.domType', inner: B_INNER, text: '.' })
      await poll('候选重开', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 2 && s.activeIndex === 0 ? s : undefined
      })
      await post({ kind: 'embed.test.key', inner: B_INNER, key: 'enter' })
      // B 权威正文收到确认链接（插入路径以 B 所在目录解析——sub 内裸名或
      // 根目录项为 ../t06-c.md；表格格内别名写转义竖线）
      const linked = await poll('B 确认链接写入', () => {
        const m = /\[\[((?:\.\.\/)?t06-c\.md)\\|t06-c\]\]/.exec(bDoc.getText())
        return m ? m[1]! : undefined
      })
      // 格内别名按表格转义（\| 两字符——网格不被裸管破坏）
      assert(bDoc.getText().includes(`[[${linked}\\|t06-c]]`),
        `格内确认写转义竖线（实际片段见链接 ${linked}）`)
      assert(bDoc.isDirty, 'B 接受后 dirty（不自动保存）')
      // A 全程零写回：字节与 dirty 不变
      assert(!aDoc.isDirty, 'A 面板全程干净（确认不写 A）')
      assert(await readDisk(A_FILE) === A0, 'A 磁盘字节不变')
      assert(await readDisk(B_FILE) === B0, 'B 磁盘不自动写入')
      console.log(`[T06] B 内确认链接 = [[${linked}\\|t06-c]]；A 字节/dirty 不变`)
    } finally {
      await restoreAll([
        { doc: aDoc, original: A0 },
        { doc: bDoc, original: B0 },
      ])
    }
  }],

  // ---- B 引 C 无 ID 块：B 来源插入、C 补 ID、B undo 尽力撤回——A 不被
  //      保存/撤销（各归其文档） ----
  ['双链联想内部 Live：B 引 C 无 ID 块补 ID 与撤销撤回各归其文档（#381 T06）', async () => {
    const aDoc = await docOf(A_FILE)
    const bDoc = await docOf(B_FILE)
    const cDoc = await docOf(C_SUB_FILE)
    const A0 = await readDisk(A_FILE)
    const B0 = bDoc.getText()
    const C0 = cDoc.getText()
    try {
      await openWithEditor(A_FILE)
      await waitSessionReady(A_FILE)
      await waitEmbedLiveBound()
      // 光标进 B 正文段末，真实输入块锚点前缀（#^ 为普通字符插入——
      // execCommand 不经 keymap，无转阶段按键语义）
      const anchor = B0.indexOf('目标乙正文与落点。') + '目标乙正文与落点。'.length
      await post({ kind: 'embed.test.focus', inner: B_INNER, pos: anchor })
      await post({ kind: 'embed.test.domType', inner: B_INNER, text: '[' })
      await post({ kind: 'embed.test.domType', inner: B_INNER, text: '[' })
      await post({ kind: 'embed.test.domType', inner: B_INNER, text: 't06-c.md#^' })
      const suggest = await poll('B 内块候选可见', async () => {
        const s = await suggestPaint()
        return s && s.visible === true && (s.itemCount ?? 0) >= 1 ? s : undefined
      })
      const names = suggest.names ?? []
      assert(names.some((n) => n.includes('t06 子目录无 id 段落行一')),
        `C 的无 ID 块在候选（实际 ${JSON.stringify(names)}）`)
      // 空查询无高亮：↓ 高亮首项（文档序第一块 = 无 ID 段落）
      await post({ kind: 'embed.test.key', inner: B_INNER, key: 'down' })
      await poll('↓ 高亮首项', async () => {
        const s = await suggestPaint()
        return s?.activeIndex === 0 ? s : undefined
      })
      // Enter：出站 accept（B 为来源）→ 宿主补写 C 的 ^id → 回包本地接受
      await post({ kind: 'embed.test.key', inner: B_INNER, key: 'enter' })
      const linked = await poll('B 写入块链接', () => {
        const m = /\[\[t06-c\.md#\^([a-z0-9]{6})\|t06-c\]\]/.exec(bDoc.getText())
        return m ? m[1]! : undefined
      })
      await poll('C 补写标记生效', () => (cDoc.getText().includes(`^${linked}`) ? true : undefined))
      assert(cDoc.isDirty, 'C 补 ID 后 dirty（不自动保存）')
      assert(await readDisk(C_SUB_FILE) === C0, 'C 磁盘不自动写入')
      assert(!aDoc.isDirty && await readDisk(A_FILE) === A0, 'A 全程不被触碰')
      // B undo：接受链接回退 + 协调器尽力撤回 C 的新增 ID（各归其文档）
      await post({ kind: 'embed.test.history', inner: B_INNER, op: 'undo' })
      await poll('B 撤销链接回退', () =>
        !/\[\[t06-c\.md#\^[a-z0-9]{6}/.test(bDoc.getText()) ? true : undefined)
      await poll('C 新增 ID 尽力撤回', () => (cDoc.getText() === C0 ? true : undefined))
      assert(!aDoc.isDirty, 'A 不随 B 撤销波及')
      console.log(`[T06] B→C 块链补 ID ${linked} 后撤销撤回完成；A 不被保存/撤销`)
    } finally {
      await restoreAll([
        { doc: aDoc, original: A0 },
        { doc: bDoc, original: B0 },
        { doc: cDoc, original: C0 },
      ])
    }
  }],

  // ---- 端口释放（切 Reading）后的迟到回包拒收：伪造旧端口 result 不产生
  //      任何候选/写入 ----
  ['双链联想内部 Live：端口释放后迟到回包拒收（#381 T06）', async () => {
    const bDoc = await docOf(B_FILE)
    const B0 = bDoc.getText()
    try {
      await openWithEditor(A_FILE)
      await waitSessionReady(A_FILE)
      const portId = await waitEmbedLiveBound()
      // 切 Reading：端口 teardown（unbind + 实例销毁）
      await post({ kind: 'embed.test.mode', inner: B_INNER, mode: 'reading' })
      await poll('端口释放', async () => {
        const stats = (await vscode.commands.executeCommand(CMD.refPortStats)) as { portIds: string[] }
        return stats.portIds.includes(portId) ? undefined : true
      })
      // 伪造迟到回包（宿主 → webview 注入旧端口信封）：实例已销毁——
      // notifyPush 查不到端口即丢弃，不写任何文档、不开候选
      await post({
        kind: 'refEdit.push', portId, fsPath: `${wsDir}\\sub\\t06-b.md`,
        message: {
          kind: 'wikilink.query.result', sessionId: portId,
          docUri: wsUri(B_FILE).toString(), reqId: 999, generation: 1,
          status: 'ready', updating: false, total: 1, catalogGen: 1,
          items: [{
            id: 'x', name: 'x.md', dir: '', relPath: 'x.md', insertPath: 'x.md',
            alias: 'x', mtimeMs: 1, score: 0, labelHighlights: [], dirHighlights: [],
          }],
        },
      })
      await new Promise((r) => setTimeout(r, 600))
      const s = await suggestPaint()
      assert(s?.visible !== true, '迟到回包不得打开候选')
      assert(bDoc.getText() === B0, '迟到回包不得写入 B')
      console.log('[T06] 端口释放后迟到回包拒收（无候选/无写入）')
    } finally {
      await restoreAll([{ doc: bDoc, original: B0 }])
    }
  }],
]
