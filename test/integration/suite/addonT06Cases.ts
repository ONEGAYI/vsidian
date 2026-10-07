// #355 T06 统一视图编辑 API 与原子修饰历史——真宿主生产路径用例。
//
// 与 V01 探针（addonHistoryCases，探针状态机路径）不同：本组走**生产消费
// 链路**——夹具组件 vsidian-test-fixture.addon-t06 经公开 registerAddon
// 注册编辑器页入口，其页面产物（构建桥 t06Editor.ts）长轮询消费 SDK 的
// views 面（list/snapshot/applyEdits/setSelection/reveal），执行结局经
// t06.result 收件箱回宿主断言；历史协调（分组撤回/重做）断言生产
// _test.addonHistory.t06State。
//
// 覆盖票面验收：
// - 外部组件经公开 API 完成真实文本/选区读取与多范围修饰；宿主 dirty/
//   save、LF/CRLF 与提交凭据（version 与 edit.ack 同源）准确。
// - atomic A / 非原子 B / atomic C / 非原子 D 按 AB/CD 组撤销与重做，
//   逐次来源不丢（协调器条目流）。
// - 拒绝矩阵：joinPrevious 无前项（history-boundary）、旧快照
//   （stale-snapshot）、伪来源（来源由 SDK 注入——条目归属对位）。
// - 引用 B（嵌入内部 Live）：B 上的修饰经 embed 句柄提交、组撤回沿
//   临时激活路由，A 全程不动（父子隔离）。
//
// 已知边界（如实声明，不以集成冒充）：真实 IME 键盘与悬停浮层的只读
// 句柄属浏览器/交互套件；「webview 输入管线 origin 透传」由既有浏览器
// 全量回归钉住（本票不改输入行为，仅新增透传）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t06'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

interface T06Result {
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

async function queue(op: string, args?: Record<string, unknown>): Promise<number> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.queue`, op, args)) as number
}

async function collectOne(seq: number, timeoutMs = 20000): Promise<Record<string, unknown>> {
  const results = await poll(`指令 ${seq} 结局`, async () => {
    const all = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, timeoutMs)) as T06Result[]
    const hit = all.find((r) => r.seq === seq)
    return hit ? [hit] : (all.length > 0 ? all : undefined)
  }, timeoutMs + 5000)
  const hit = results.find((r) => r.seq === seq)
  if (!hit) {
    throw new Error(`指令 ${seq} 无结局（收到 ${JSON.stringify(results)}）`)
  }
  return hit.outcome
}

async function docText(name: string): Promise<{ text: string; version: number; dirty: boolean }> {
  const doc = await vscode.workspace.openTextDocument(wsUri(name))
  return { text: doc.getText(), version: doc.version, dirty: doc.isDirty }
}

async function t06State(name: string): Promise<{
  lost: boolean
  applied: number
  entries: Array<{ version: number; owner: string; groupId?: string; atomic?: boolean; joinedOpIds?: string[] }>
} | undefined> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.t06State', wsUri(name).toString())) as never
}

/** 确保组件注册并 enabled（自愈先序用例状态；对齐 T02 ensureEnabled 口径） */
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

/** 打开编辑器并等真实 webview 面板就绪（组件长轮询随之装载） */
async function openEditorAndWait(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
  })
}

/** 页面产物就绪探测：queue 一条 list 指令并等待结局（装载滞后的指令会在
 *  页面装载后被执行——broadcast 语义保证；比计数增量判定确定） */
async function probePageReady(file: string): Promise<void> {
  const seq = await queue('list')
  try {
    await poll(`页面产物就绪（${file}）`, () => collectOne(seq, 25000).then(() => true, () => undefined), 30000)
  } catch (err) {
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<Record<string, unknown>>
    const t06Events = events.filter((e) => JSON.stringify(e).includes('add-t06'))
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] } | undefined
    throw new Error(`${(err as Error).message}；诊断：t06Events=${JSON.stringify(t06Events.slice(-8))} session=${JSON.stringify(state)}`)
  }
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 以基态重写盘面并打开（组历史用例的可重复基线） */
async function resetDocAndOpen(file: string, content: string): Promise<void> {
  await closeAllEditors()
  await vscode.workspace.fs.writeFile(wsUri(file), Buffer.from(content, 'utf8'))
  await new Promise((r) => setTimeout(r, 200))
  await openEditorAndWait(file)
  await probePageReady(file)
}

export const addonT06Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T06：公开 API 读取与多范围修饰（LF/CRLF、凭据、dirty/save，#355）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await openEditorAndWait('lf.md')
    await probePageReady('lf.md')

    // views.list：主正文句柄（live、可编辑、目标 = 本面板文档）
    const listSeq = await queue('list')
    const list = (await collectOne(listSeq)) as { views: Array<Record<string, unknown>> }
    const main = list.views.find((v) => v['viewType'] === 'main')
    assert(main !== undefined, `views.list 应含主正文句柄，实际 ${JSON.stringify(list.views)}`)
    assert(main!['editable'] === true && main!['mode'] === 'live', '主正文句柄应 live 可编辑')

    // 快照：文本/版本/修订标记/选区
    const snapSeq = await queue('snapshot', { instanceId: 'main' })
    const snap = (await collectOne(snapSeq)) as {
      ok: boolean
      snapshot: { text: string; selections: unknown[]; version: number; revision: number }
    }
    assert(snap.ok === true, '主正文快照应成功')
    assert(snap.snapshot.text.length > 0 && snap.snapshot.revision > 0, '快照应含文本与修订标记')

    // 多范围原子修饰（一笔 = 一条宿主历史项）+ 提交后选区
    const ranges = [
      { offset: 0, length: 2, text: '公开' },
      { offset: snap.snapshot.text.length - 2, length: 2, text: '收笔' },
    ]
    const applySeq = await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap.snapshot.revision, changes: ranges, selection: { anchor: 2, head: 2 } },
    })
    const applied = (await collectOne(applySeq)) as {
      ok: boolean
      credential?: { opId: string; version: number }
      reason?: string
    }
    assert(applied.ok === true, `原子修饰应成功，实际 ${JSON.stringify(applied)}`)
    const after = await docText('lf.md')
    assert(after.version === applied.credential!.version, `凭据 version 应与权威版本对位（${applied.credential!.version} vs ${after.version}）`)
    assert(after.text.startsWith('公开') && after.text.includes('收笔'), `多范围修饰应落盘（首尾替换），实际 ${JSON.stringify(after.text.slice(0, 6))}…`)
    assert(after.dirty === true, '修饰后宿主应 dirty')

    // 保存收敛 clean（宿主文本管线）
    await (await vscode.workspace.openTextDocument(wsUri('lf.md'))).save()
    const saved = await docText('lf.md')
    assert(saved.dirty === false, '保存后应 clean')

    // 选区与定位：零文本变更（版本不动、不造撤销项）
    const selSeq = await queue('setSelection', { instanceId: 'main', ranges: [{ anchor: 1, head: 3 }] })
    const sel = (await collectOne(selSeq)) as { accepted: boolean }
    assert(sel.accepted === true, 'setSelection 应接受')
    const revSeq = await queue('reveal', { instanceId: 'main', offset: 4 })
    const revealed = (await collectOne(revSeq)) as { accepted: boolean }
    assert(revealed.accepted === true, 'reveal 应接受')
    const settled = await docText('lf.md')
    assert(settled.version === saved.version, `选区/定位不得推进权威版本（${settled.version} vs ${saved.version}）`)

    // CRLF 文档：公开 LF 坐标经宿主适配器正确转换（行尾字节保持）
    await closeAllEditors()
    await openEditorAndWait('crlf.md')
    await probePageReady('crlf.md')
    const crlfSnapSeq = await queue('snapshot', { instanceId: 'main' })
    const crlfSnap = (await collectOne(crlfSnapSeq)) as { ok: boolean; snapshot: { text: string; revision: number } }
    assert(crlfSnap.ok === true && !crlfSnap.snapshot.text.includes('\r'), 'CRLF 文档快照应为 LF 形态（公开坐标）')
    const crlfApplySeq = await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: crlfSnap.snapshot.revision, changes: [{ offset: 0, length: 3, text: '改题' }] },
    })
    const crlfApplied = (await collectOne(crlfApplySeq)) as { ok: boolean; reason?: string }
    assert(crlfApplied.ok === true, `CRLF 修饰应成功，实际 ${JSON.stringify(crlfApplied)}`)
    const crlfDoc = await docText('crlf.md')
    assert(crlfDoc.text.startsWith('改题一\r\n'), `CRLF 文档行尾应保持（写入后实际 ${JSON.stringify(crlfDoc.text.slice(0, 8))}）`)
    await closeAllEditors()
    console.log('[#355] 公开 API 读取与多范围修饰通过（LF/CRLF、凭据对位、dirty/save、零文本操作不造历史）')
  }],

  ['附加组件 T06：ABCD 组撤销重做与逐次来源（原子默认 + joinPrevious 并组，#355）', async () => {
    await ensureEnabled()
    const file = 'lf.md'
    const baseline = 'T06 组历史基态\n第二行\n'
    await resetDocAndOpen(file, baseline)

    // A 原子 → B 非原子（并组）→ C 原子 → D 非原子（并组）：四次独立提交
    const submit = async (mark: string, history: 'atomic' | 'joinPrevious'): Promise<void> => {
      const snapSeq = await queue('snapshot', { instanceId: 'main' })
      const snap = (await collectOne(snapSeq)) as { ok: boolean; snapshot: { text: string; revision: number } }
      assert(snap.ok === true, '快照应成功')
      const applySeq = await queue('applyEdits', {
        instanceId: 'main',
        request: { revision: snap.snapshot.revision, changes: [{ offset: 0, length: 0, text: mark }], history },
      })
      const outcome = (await collectOne(applySeq)) as { ok: boolean; credential?: { opId: string }; reason?: string }
      assert(outcome.ok === true, `修饰 ${mark}（${history}）应成功，实际 ${JSON.stringify(outcome)}`)
      assert(typeof outcome.credential!.opId === 'string' && outcome.credential!.opId.length > 0, '凭据应携带 opId')
    }
    await submit('A', 'atomic')
    await submit('B', 'joinPrevious')
    await submit('C', 'atomic')
    await submit('D', 'joinPrevious')
    const abcd = await docText(file)
    assert(abcd.text === 'DCBA' + baseline, `四次修饰应按提交序落盘，实际 ${JSON.stringify(abcd.text.slice(0, 8))}`)
    assert(abcd.dirty === true, '修饰后应 dirty')

    // 生产协调器条目流：4 条目、组归属 AB 同组 CD 同组、逐次来源不丢
    const state = await poll('协调器条目流收敛', async () => {
      const s = await t06State(file)
      return s && s.entries.length === 4 ? s : undefined
    })
    const [e1, e2, e3, e4] = state.entries
    assert(e1!.owner === 'addon' && e1!.atomic === true, `A 应为组首原子条目，实际 ${JSON.stringify(e1)}`)
    assert(e1!.groupId !== undefined && e2!.groupId === e1!.groupId && e2!.atomic !== true, 'B 应并入 A 组（同组非组首）')
    assert(e3!.groupId !== undefined && e3!.groupId !== e1!.groupId && e3!.atomic === true, 'C 应开新组')
    assert(e4!.groupId === e3!.groupId, 'D 应并入 C 组')

    // 原生入口撤销 ×2（活动 tab 为本面板 custom editor）：AB/CD 整组回退
    await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('undo')
    const afterUndo1 = await poll('CD 组整组撤回', async () => {
      const d = await docText(file)
      return d.text === 'AB' + baseline ? d : undefined
    })
    await vscode.commands.executeCommand('undo')
    const afterUndo2 = await poll('AB 组整组撤回（回基态）', async () => {
      const d = await docText(file)
      return d.text === baseline ? d : undefined
    })
    assert(afterUndo1.text === 'AB' + baseline, '一次撤销应撤 CD 两笔（组单位）')
    assert(afterUndo2.text === baseline, '二次撤销应撤 AB 两笔（组单位）')

    // 重做 ×2：整组恢复
    await vscode.commands.executeCommand('redo')
    await poll('AB 组整组重做', async () => {
      const d = await docText(file)
      return d.text === 'AB' + baseline ? d : undefined
    })
    await vscode.commands.executeCommand('redo')
    await poll('CD 组整组重做', async () => {
      const d = await docText(file)
      return d.text === 'DCBA' + baseline ? d : undefined
    })
    const finalState = await t06State(file)
    assert(finalState && !finalState.lost && finalState.applied === 4, `重做后指针应归顶且不 lost，实际 ${JSON.stringify(finalState?.applied)}`)
    await closeAllEditors()
    console.log('[#355] ABCD 组撤销重做通过（AB/CD 组单位、逐次来源在条目流）')
  }],

  ['附加组件 T06：拒绝矩阵（无前项/旧快照/伪来源/分支截断，#355）', async () => {
    await ensureEnabled()
    const file = 'lf.md'
    const baseline = 'T06 拒绝矩阵基态\n'
    await resetDocAndOpen(file, baseline)

    // joinPrevious 无可确认前项（空日志）：明确拒绝 history-boundary，不写回
    const snap1 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const rejected = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap1.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'X' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(rejected.ok === false && rejected.reason === 'history-boundary',
      `空日志 joinPrevious 应拒绝 history-boundary，实际 ${JSON.stringify(rejected)}`)
    const unchanged = await docText(file)
    assert(unchanged.text === baseline, `被拒提交不得写回，实际 ${JSON.stringify(unchanged.text)}`)
    const state1 = await t06State(file)
    assert(state1 !== undefined && state1.entries.length === 0, '被拒提交不留条目')

    // 原子提交建立前项后 joinPrevious 放行（可确认前项）
    const snap2 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const acceptedA = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap2.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'A' }] },
    }))) as { ok: boolean; reason?: string }
    assert(acceptedA.ok === true, `原子提交应成功，实际 ${JSON.stringify(acceptedA)}`)
    const snap3 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const acceptedB = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap3.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'B' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(acceptedB.ok === true, `有前项 joinPrevious 应放行，实际 ${JSON.stringify(acceptedB)}`)

    // 外来写入打断组顶后 joinPrevious 拒绝（组顶被打断形态）
    const foreign = new vscode.WorkspaceEdit()
    foreign.insert(wsUri(file), new vscode.Position(0, 0), '外')
    assert(await vscode.workspace.applyEdit(foreign), '外来写入应成功')
    await new Promise((r) => setTimeout(r, 400))
    const snap4 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const rejected2 = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap4.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'Y' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(rejected2.ok === false && rejected2.reason === 'history-boundary',
      `组顶被打断后 joinPrevious 应拒绝，实际 ${JSON.stringify(rejected2)}`)

    // 旧快照拒绝 stale-snapshot（快照修订失配；宿主版本无关——不自动重试）
    const staleRev = snap4.snapshot.revision
    const bump = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: staleRev, changes: [{ offset: 0, length: 0, text: 'Z' }] },
    }))) as { ok: boolean }
    assert(bump.ok === true, '前序修饰应成功')
    const stale = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: staleRev, changes: [{ offset: 0, length: 0, text: 'W' }] },
    }))) as { ok: boolean; reason?: string }
    assert(stale.ok === false && stale.reason === 'stale-snapshot',
      `旧快照应拒绝 stale-snapshot，实际 ${JSON.stringify(stale)}`)

    // 伪来源：组件请求结构上不携带身份（凭据 opId 由 SDK 注入）——协调器
    // 条目的组身份应是 SDK 生成的 opId（g<代次>-op<N>），非组件自报值
    const state2 = await t06State(file)
    const addonEntries = state2!.entries.filter((e) => e.owner === 'addon')
    assert(addonEntries.length >= 2, '应有 addon 条目（A/B/Z）')
    assert(addonEntries.every((e) => /^g\d+-op\d+$/.test(e.groupId ?? '')),
      `条目组身份应为 SDK 注入的 opId，实际 ${JSON.stringify(addonEntries.map((e) => e.groupId))}`)

    // 分支截断：撤销后新写入使 redo 分支失效（重做无效果）
    await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('undo')
    await poll('撤销一步落地', async () => {
      const d = await docText(file)
      return d.text === '外BAlf'.slice(0, 0) + d.text && !d.text.startsWith('Z') ? d : undefined
    })
    const afterUndo = await docText(file)
    const branchWrite = new vscode.WorkspaceEdit()
    branchWrite.insert(wsUri(file), new vscode.Position(0, 0), '新')
    assert(await vscode.workspace.applyEdit(branchWrite), '分支新写入应成功')
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('redo')
    await new Promise((r) => setTimeout(r, 600))
    const afterRedoAttempt = await docText(file)
    assert(!afterRedoAttempt.text.includes('Z'), `分支截断后重做不得恢复被截断内容（实际 ${JSON.stringify(afterRedoAttempt.text.slice(0, 8))}）`)
    void afterUndo
    await closeAllEditors()
    console.log('[#355] 拒绝矩阵通过（无前项/打断/旧快照/伪来源注入/分支截断）')
  }],

  ['附加组件 T06：引用 B 修饰经 embed 句柄与整组撤回（父子隔离，#355）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    // p204 fixture：父文档两处嵌入同一目标，父 Live 继承内部 Live
    await openEditorAndWait('p204-编辑嵌入.md')
    const parentUri = wsUri('p204-编辑嵌入.md').toString()
    // 等两枚 occurrence 的内部 Live 绑定（端口就绪 → embed 句柄注册）
    await poll('内部 Live 绑定', async () => {
      const view = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', parentUri, 0)) as
        | { readingEmbed?: Array<{ inner: string; liveBound?: boolean; livePortId?: string }> } | undefined
      const cards = view?.readingEmbed?.filter((c) => c.inner === 'p204-编辑目标') ?? []
      return cards.length >= 1 && cards.every((c) => c.liveBound === true) ? cards : undefined
    })
    await probePageReady('p204-编辑嵌入.md')

    const parentBefore = (await docText('p204-编辑嵌入.md')).text
    const targetBefore = (await docText('p204-编辑目标.md')).text

    // views.list 含 embed 句柄（目标 = B 文档；与主正文句柄并存）
    const list = (await collectOne(await queue('list'))) as { views: Array<Record<string, unknown>> }
    const embeds = list.views.filter((v) => v['viewType'] === 'embed')
    assert(embeds.length >= 1, `应列出 embed 句柄，实际 ${JSON.stringify(list.views)}`)
    const embedId = embeds[0]!['instanceId'] as string
    assert(String(embeds[0]!['targetDocUri']).includes('p204-编辑目标'), `embed 句柄目标应为 B 文档，实际 ${embeds[0]!['targetDocUri']}`)

    // B 上的修饰：A 原子 + B' 非原子并组（经 refEdit 端口写 B 会话）
    const snap1 = (await collectOne(await queue('snapshot', { instanceId: embedId }))) as
      { ok: boolean; snapshot: { text: string; revision: number } }
    assert(snap1.ok === true && snap1.snapshot.text === targetBefore.replace(/\r\n/g, '\n'),
      `embed 快照应为 B 的 LF 全文，实际 ${JSON.stringify(snap1.snapshot.text.slice(0, 20))}`)
    const applyA = (await collectOne(await queue('applyEdits', {
      instanceId: embedId,
      request: { revision: snap1.snapshot.revision, changes: [{ offset: snap1.snapshot.text.length, length: 0, text: '【B1】' }] },
    }))) as { ok: boolean; reason?: string }
    assert(applyA.ok === true, `B 原子修饰应成功，实际 ${JSON.stringify(applyA)}`)
    const snap2 = (await collectOne(await queue('snapshot', { instanceId: embedId }))) as
      { ok: boolean; snapshot: { revision: number } }
    const applyB = (await collectOne(await queue('applyEdits', {
      instanceId: embedId,
      request: { revision: snap2.snapshot.revision, changes: [{ offset: 0, length: 0, text: '【B2】' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(applyB.ok === true, `B 非原子修饰应成功（同组），实际 ${JSON.stringify(applyB)}`)

    // 父子隔离：B 落盘、A 文本与版本不动
    const targetAfter = await poll('B 权威文档收到修饰', async () => {
      const d = await docText('p204-编辑目标.md')
      return d.text.startsWith('【B2】') && d.text.includes('【B1】') ? d : undefined
    })
    const parentAfter = await docText('p204-编辑嵌入.md')
    assert(parentAfter.text === parentBefore, '父文档 A 文本不得被 B 修改改动')
    const targetState = await t06State('p204-编辑目标.md')
    assert(targetState !== undefined && targetState.entries.length === 1, 'B 协调器应记 1 条合并/组条目')

    // B 整组撤回：嵌入内 Ctrl+Z（embed.test.history → B 会话 → 临时激活
    // 路由单步 + 协调器补完 = 一次按键撤整组）
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', parentUri, {
      kind: 'embed.test.history', inner: 'p204-编辑目标', op: 'undo',
    })
    const targetRestored = await poll('B 整组撤回到基态', async () => {
      const d = await docText('p204-编辑目标.md')
      return d.text === targetAfter.text.replace('【B2】', '').replace('【B1】', '') ? d : undefined
    })
    assert(targetRestored.text === targetBefore, `B 撤回应回基态，实际 ${JSON.stringify(targetRestored.text.slice(0, 20))}`)
    const parentFinal = await docText('p204-编辑嵌入.md')
    assert(parentFinal.text === parentBefore, 'B 撤回全程父文档 A 不得变化')
    await closeAllEditors()
    console.log('[#355] 引用 B 修饰与整组撤回通过（embed 句柄、临时激活路由、父子隔离）')
  }],
]
