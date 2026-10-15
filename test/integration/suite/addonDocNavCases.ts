// #543 T03 附加组件文档打开与定位 API——真宿主生产路径用例。
//
// 走**生产消费链路**：夹具组件 vsidian-test-fixture.addon-docnav 经公开
// registerAddon 注册编辑器页入口，其页面产物（构建桥 docNavEditor.ts）
// 短轮询消费 SDK 的 views.openDocument，执行结局经 docnav.result 收件箱
// 回宿主断言；落点断言用 _test.requestViewState（selectionOffset /
// readingAnchorStart）与 vscode.window.activeTextEditor（原生编辑器行）。
//
// 结构性边界（retainContextWhenHidden 关闭——隐藏即销毁）：跨文档导航会
// 把来源面板切到后台，来源面板里的组件实例随 webview 销毁，其未回报的
// openDocument 结局随之终结（N-U12「请求被关闭或重载后迟到结果失效」的
// 真实形态；导航本身的打开与定位不受影响）。因此用例编排为：
// - 跨文档打开以**目标落点**为断言面（不 await 组件结局）；目标面板装载
//   新组件实例后，经同文件锚点（空 target）继续验证结局回报闭环；
// - 纯拒绝（not-found/escape/invalid，不执行打开）与同文件用例直接验证
//   组件结局；跨文档 out-of-bounds 的 opened 状态由目标面板在场与未钳末
//   行佐证（结果回报面由单测/浏览器承载——两者组件不随标签切换销毁）。
//
// 覆盖票面验收：
// - N-U01/N-U02：未开 Markdown 打开定位与已开面板重显（openWith 重显 +
//   view.locate 管线）；N-U03：text 目标原生编辑器行定位；
// - N-U04：来源为嵌入 B 时以 B 目录解析（sub/nav-deep.md 只在 sub/ 下，
//   从外层 A 解析必 not-found）；
// - N-U05：标题/块 ID/行号三锚点；N-U06：CRLF 行号 LF 换算落点与阅读态
//   块定位（mode.toReading 后锚点落阅读块）；
// - N-U07：not-found / escape / out-of-bounds（不钳末行）/ anchor-not-found
//   / invalid-request（非正整数行号、text+标题）失败矩阵；
// - N-U12 的宿主侧代次拒收与 webview 侧迟到回包/代次终结由
//   test/unit/addonDocNav.test.ts（执行体三点复核）+ test/unit/addonViews.test.ts
//   （在途表四径终结）+ test/browser/addonDocNav.mjs（生产路径旧回包不接入
//   新代次）承载——集成侧时序不可控，不以竞态用例冒充。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-docnav'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

interface DocNavResult {
  seq: number
  outcome: Record<string, unknown>
}

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
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

/** 结果形状对拍（序列化比较——与 expected 不符即失败并打印实际值） */
function assertNav(actual: unknown, expected: Record<string, unknown>, message: string): void {
  const norm = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  if (norm !== want) {
    throw new Error(`断言失败：${message}（期望 ${want}，实际 ${norm}）`)
  }
}

let sourceFile = 'nav-opener.md'
async function queue(op: string, args?: Record<string, unknown>): Promise<number> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.queue`, op, args, wsUri(sourceFile).toString())) as number
}

async function collectOne(seq: number, timeoutMs = 20000): Promise<Record<string, unknown>> {
  const results = await poll(`指令 ${seq} 结局`, async () => {
    const all = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, timeoutMs)) as DocNavResult[]
    const hit = all.find((r) => r.seq === seq)
    return hit ? [hit] : (all.length > 0 ? all : undefined)
  }, timeoutMs + 5000)
  const hit = results.find((r) => r.seq === seq)
  if (!hit) {
    throw new Error(`指令 ${seq} 无结局（收到 ${JSON.stringify(results)}）`)
  }
  return hit.outcome
}

/** 执行一条导航指令并等待结局（组件经公开 SDK 调用 → 宿主执行 → 回执） */
async function runNav(op: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return collectOne(await queue(op, args))
}

interface ViewState {
  viewMode?: 'live' | 'reading'
  selectionOffset?: number
  readingAnchorStart?: number
  addonPage?: { active: unknown[] }
  readingEmbed?: Array<{ inner: string; state: string; liveBound?: boolean }>
}

async function viewStateOf(file: string): Promise<ViewState | undefined> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | ViewState | undefined
}

/** 确保组件注册并 enabled（对齐 T06 ensureEnabled 口径） */
async function ensureEnabled(): Promise<void> {
  await poll('夹具组件激活', async () => {
    const stats = (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as { setupCount: number } | undefined
    return stats && stats.setupCount >= 1 ? stats : undefined
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { runState: string } | null
    if (status?.runState === 'enabled') {
      return
    }
    if (status?.runState === 'faulted') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId: ADDON_ID })
      await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    } else {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    }
    await poll('运行态收敛 enabled', async () => {
      const next = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  throw new Error('运行态未能恢复 enabled')
}

async function openEditorAndWait(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
  })
}

/** 页面产物就绪探测：queue 一条幂等指令并等待结局（死实例吞指令至多一条，
 *  超时换新 seq 重发收敛——T06 probePageReady 同口径） */
async function probePageReady(file: string): Promise<void> {
  sourceFile = file
  const seq = await queue('facetMissing')
  let result: Record<string, unknown>
  try { result = await collectOne(seq, 10000) } catch (error) {
    const stats = await vscode.commands.executeCommand(`${ADDON_ID}.stats`)
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ addonId?: string }>
    const state = await viewStateOf(file)
    throw new Error(`${String(error)}; stats=${JSON.stringify(stats)}; events=${JSON.stringify(events.filter((e) => e.addonId === ADDON_ID).slice(-8))}; loader=${JSON.stringify(state?.addonPage)}`)
  }
  assert(result.missing === false, `页面应提供 views（${file}）`)
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 目标文档 LF 偏移（fixture 为 LF 文件：宿主文本 = LF 文本，indexOf 即得） */
async function lfOffsetOf(file: string, needle: string): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(wsUri(file))
  return doc.getText().indexOf(needle)
}

/** 末行行首偏移（「不钳到末行」断言的对照值） */
async function lastLineStartOf(file: string): Promise<number> {
  const doc = await vscode.workspace.openTextDocument(wsUri(file))
  return doc.offsetAt(new vscode.Position(doc.lineCount - 1, 0))
}

export const addonDocNavCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T03：未开 Markdown 打开定位标题；已开面板经同文件锚点重显定位块（N-U01/N-U02/N-U05，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-opener.md')
    await probePageReady('nav-opener.md')
    // 未开目标：标题定位（跨文档——以目标落点为断言面；来源面板切后台其
    // 组件实例随 webview 销毁，openDocument 结局按 N-U12 形态终结）
    const headingOffset = await lfOffsetOf('nav-target.md', '## 深处标题')
    await queue('open', { target: 'nav-target.md', locateHeading: '深处标题' })
    const state = await poll('标题落点', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.selectionOffset === headingOffset ? v : undefined
    })
    assert(state.viewMode === 'live', '目标面板应为 live')
    // 目标面板装载新组件实例：经同文件块锚点（空 target）验证已开重显 +
    // 结局回报闭环（openWith 对已开面板是重显；不切标签——组件存活）
    await probePageReady('nav-target.md')
    const blockOffset = await lfOffsetOf('nav-target.md', '深处标题下正文。')
    assertNav(await runNav('open', { target: '', locateBlock: 'navblk' }),
      { ok: true, opened: true, located: true }, '已开 md 同文件块定位应成功（openWith 重显）')
    await poll('块落点', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.selectionOffset === blockOffset ? v : undefined
    })
  }],

  ['附加组件 T03：行号定位与 CRLF LF 换算落点（N-U05/N-U06，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-opener.md')
    await probePageReady('nav-opener.md')
    // LF 目标行 5（## 深处标题 行）——跨文档，断言落点
    const line5Offset = await lfOffsetOf('nav-target.md', '## 深处标题')
    await queue('open', { target: 'nav-target.md', locateLine: 5 })
    await poll('行 5 落点', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.selectionOffset === line5Offset ? v : undefined
    })
    await probePageReady('nav-target.md')
    // CRLF 目标行 3（CRLF丙行）：宿主偏移 16 → LF 偏移 14（webview 全程 LF）
    await queue('open', { target: 'nav-target-crlf.md', locateLine: 3 })
    await poll('CRLF 行 3 LF 落点', async () => {
      const v = await viewStateOf('nav-target-crlf.md')
      return v?.selectionOffset === 14 ? v : undefined
    })
    // crlf 面板组件就绪后，同文件行号验证结局回报
    await probePageReady('nav-target-crlf.md')
    assertNav(await runNav('open', { target: '', locateLine: 2 }),
      { ok: true, opened: true, located: true }, 'CRLF 同文件行号应成功')
    await poll('CRLF 行 2 LF 落点', async () => {
      const v = await viewStateOf('nav-target-crlf.md')
      return v?.selectionOffset === 7 ? v : undefined
    })
  }],

  ['附加组件 T03：text 目标原生编辑器行定位（N-U03，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-opener.md')
    await probePageReady('nav-opener.md')
    await queue('open', { target: 'nav-target.ts', locateLine: 2 })
    await poll('原生编辑器激活并落行', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.uri.fsPath !== wsUri('nav-target.ts').fsPath) {
        return undefined
      }
      return editor.selection.active.line === 1 ? editor : undefined
    })
    // 再开（重显）并断言行选区跟随（0-based 2 → 第三行 export const c）
    await openEditorAndWait('nav-opener.md')
    await probePageReady('nav-opener.md')
    await queue('open', { target: 'nav-target.ts', locateLine: 3 })
    await poll('原生编辑器重显落行', async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.uri.fsPath !== wsUri('nav-target.ts').fsPath) {
        return undefined
      }
      return editor.selection.active.line === 2 ? editor : undefined
    })
  }],

  ['附加组件 T03：来源为嵌入 B 时以 B 目录解析（N-U04，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-opener.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    await probePageReady('nav-opener.md')
    let sourceState: ViewState | undefined
    try {
      await poll('来源 Live 嵌入内容与端口就绪', async () => {
        sourceState = await viewStateOf('nav-opener.md')
        const card = sourceState?.readingEmbed?.find((entry) => entry.inner === 'sub/nav-b.md')
        return sourceState?.viewMode === 'live' && card?.state === 'content' && card.liveBound ? sourceState : undefined
      })
    } catch (error) {
      throw new Error(`${String(error)}; source=${JSON.stringify(sourceState)}; views=${JSON.stringify(await runNav('listViews'))}`)
    }
    // 嵌入 B（sub/nav-b.md）的 Live 实例进入 views 注册表
    await poll('嵌入视图在场', async () => {
      const views = (await runNav('listViews')) as unknown as Array<{ instanceId: string; viewType: string }>
      return views?.some((v) => v.viewType === 'embed') ? views : undefined
    })
    // 对照先行（组件存活期）：同一目标从外层 A（main）解析必 not-found
    // （ws 根下无 nav-deep.md——区分解析基准的负向证明）
    assertNav(await runNav('open', { target: 'nav-deep.md', locateHeading: '深层标题' }),
      { ok: false, reason: 'not-found', opened: false }, '外层 A 来源解析同路径应 not-found')
    // 从嵌入 B 解析 nav-deep.md → sub/nav-deep.md 命中；跨文档断言落点
    await queue('open', { target: 'nav-deep.md', locateHeading: '深层标题', sourceKind: 'embed' })
    const deepOffset = await lfOffsetOf('sub/nav-deep.md', '# 深层标题')
    await poll('深层标题落点', async () => {
      const v = await viewStateOf('sub/nav-deep.md')
      return v?.selectionOffset === deepOffset ? v : undefined
    })
  }],

  ['附加组件 T03：同文件锚点与阅读态块定位（N-U06，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-target.md')
    await probePageReady('nav-target.md')
    // 同文件锚点（空 target）：目标即来源文档，组件存活验证结局闭环
    const headingOffset = await lfOffsetOf('nav-target.md', '## 深处标题')
    assertNav(await runNav('open', { target: '', locateHeading: '深处标题' }),
      { ok: true, opened: true, located: true }, '同文件锚点应成功')
    await poll('同文件落点', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.selectionOffset === headingOffset ? v : undefined
    })
    // 阅读态：块锚点定位落阅读块（readingAnchorStart = 块首 LF 偏移）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
    await poll('阅读态生效', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.viewMode === 'reading' ? v : undefined
    })
    const blockOffset = await lfOffsetOf('nav-target.md', '深处标题下正文。')
    assertNav(await runNav('open', { target: '', locateBlock: 'navblk' }),
      { ok: true, opened: true, located: true }, '阅读态导航应成功')
    await poll('阅读块落点', async () => {
      const v = await viewStateOf('nav-target.md')
      return v?.viewMode === 'reading' && v.readingAnchorStart === blockOffset ? v : undefined
    })
  }],

  ['附加组件 T03：失败矩阵——not-found/escape/越界/锚点缺失/非法形状（N-U07，#543）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('nav-opener.md')
    await probePageReady('nav-opener.md')
    // not-found：候选（含补 .md）全未命中——不打开、组件存活验证结局
    assertNav(await runNav('open', { target: 'missing-file.md' }),
      { ok: false, reason: 'not-found', opened: false }, '缺失目标应 not-found')
    // escape：越出工作区根
    assertNav(await runNav('open', { target: '../../outside-nav.md' }),
      { ok: false, reason: 'escape', opened: false }, '越根目标应 escape')
    // invalid-request：非正整数行号（0）——不执行打开
    assertNav(await runNav('open', { target: 'nav-target-crlf.md', locateLine: 0 }),
      { ok: false, reason: 'invalid-request', opened: false }, '行号 0 应 invalid-request 不打开')
    // invalid-request：text 目标携带标题锚点
    assertNav(await runNav('open', { target: 'nav-target.ts', locateHeading: 'x' }),
      { ok: false, reason: 'invalid-request', opened: false }, 'text+标题应 invalid-request')
    // 同文件 out-of-bounds：不切标签（组件存活），验证 opened=true 且不钳末行
    assertNav(await runNav('open', { target: '', locateLine: 999 }),
      { ok: false, reason: 'out-of-bounds', opened: true }, '同文件行号越界应失败且报告已打开')
    const openerLast = await lastLineStartOf('nav-opener.md')
    const openerState = await viewStateOf('nav-opener.md')
    assert(openerState !== undefined, '越界后面板应有观测（已打开）')
    assert(openerState.selectionOffset !== openerLast,
      `不得钳到末行行首（末行起点 ${openerLast}，实际 ${openerState.selectionOffset}）`)
    // 同文件 anchor-not-found：目标（=来源）已打开但标题未命中
    assertNav(await runNav('open', { target: '', locateHeading: '不存在的标题' }),
      { ok: false, reason: 'anchor-not-found', opened: true }, '同文件锚点缺失应失败且报告已打开')
    // 跨文档 out-of-bounds（opened=true 结局随来源面板隐藏终结——N-U12 形态）：
    // 断言目标面板已开且未钳末行（新面板恢复锚点为顶部）
    await queue('open', { target: 'nav-target.md', locateLine: 99 })
    const targetLast = await lastLineStartOf('nav-target.md')
    await poll('越界目标面板打开', async () => {
      const v = await viewStateOf('nav-target.md')
      return v !== undefined ? v : undefined
    })
    const targetState = await viewStateOf('nav-target.md')
    assert(targetState !== undefined, '目标面板应已打开')
    assert(targetState.selectionOffset !== targetLast,
      `跨文档越界不得钳末行（末行起点 ${targetLast}，实际 ${targetState.selectionOffset}）`)
  }],
]
