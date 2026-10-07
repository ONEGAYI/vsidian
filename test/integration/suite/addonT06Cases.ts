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
// - 外来写入与修饰组交错、快速连按 undo 按单位推进、在途并发收敛不
//   lost（V01 矩阵 7/8/9 生产版）。
// - webview 面板重载后协调器条目与组归属保留、整组撤回/重做照常
// （V01 矩阵 15 生产版）；会话退役重开为新协调器（空条目），新会话
//   SDK 链路照常。
//
// 已知边界（如实声明，不以集成冒充）：真实 IME 键盘与组合期行为由
// test:addon-t06-host（test/browser/addonT06EditHost.mjs——独立桌面
// CDP：真实键盘/IME 驱动生产控制器，修饰提交经本夹具组件的公开 SDK
// views.applyEdits，V01 矩阵 17-20/9 生产版）承载；扩展宿主真重启
// （reloadWindow 终止测试进程）不可集成内重放，协调器持久化快照恢复
// 与保守 lost 由单测 addonHistoryCoordinator.test.ts 覆盖（V01 同等
// 限制）；悬停浮层只读句柄拒绝矩阵由单测 addonViews.test.ts 覆盖。
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

/** 页面产物就绪探测：queue 一条 list 指令并等待结局。已关闭面板的组件
 *  实例可能仍持一条在途 t06.next 吞走指令且其 webview 桥已死（结局无法
 *  回收）——list 幂等，超时换新 seq 重发收敛（旧实例上报失败即退出循环，
 *  存量吞指令窗口至多每实例一条） */
async function probePageReady(file: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const seq = await queue('list')
    try {
      await poll(`页面产物就绪（${file}）`, () => collectOne(seq, 20000).then(() => true, () => undefined), 25000)
      return
    } catch (err) {
      if (attempt >= 3) {
        const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<Record<string, unknown>>
        const t06Events = events.filter((e) => JSON.stringify(e).includes('add-t06'))
        const editorEvents = events.filter((e) => e['kind'] === 'directive.load' || e['kind'] === 'directive.unload')
        const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
          | { found: boolean; panels: { ready: boolean }[] } | undefined
        const runtime = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
          | { runState: string } | null
        const fixtureStats = (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as { nextCalls?: number } | undefined
        throw new Error(`${(err as Error).message}；诊断：t06Events=${JSON.stringify(t06Events.slice(-8))} editorEvents=${JSON.stringify(editorEvents.slice(-12))} runtime=${JSON.stringify(runtime)} fixture=${JSON.stringify(fixtureStats)} session=${JSON.stringify(state)}`)
      }
    }
  }
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 以基态重写盘面并打开（组历史用例的可重复基线）。
 *  两个时序坑收口：
 *  1) 前序用例可能以 dirty 态关闭（hot-exit backup）——重开时 backup 恢复
 *     的 dirty 文本盖过盘面重写，先打开保存清掉 backup；
 *  2) writeFile 后文件 watcher 的广播有延迟，轮询 TextDocument 读到基态
 *     再开面板（否则 init 拿旧文本）。
 *  旧会话残留（webview dispose 事件延迟导致 entry 不退役）由产品侧
 *  openEntry 的 TextDocument 实例对账兜住：重开产生新实例即按退役口径
 *  重建会话（旧实例的 version/getText 冻结在关闭时刻，复用必失真） */
async function resetDocAndOpen(file: string, content: string): Promise<void> {
  await closeAllEditors()
  // 已存在的文档可能带 hot-exit backup（前序 dirty 关闭）——先保存清掉，
  // 否则重开时 backup 恢复的旧文本盖过盘面重写；首次创建的文档跳过
  try {
    const existing = await vscode.workspace.openTextDocument(wsUri(file))
    if (existing.isDirty) {
      await existing.save()
    }
  } catch {
    // 文件不存在：下方 writeFile 首建
  }
  await vscode.workspace.fs.writeFile(wsUri(file), Buffer.from(content, 'utf8'))
  await poll('盘面重写生效（watcher 广播完成）', async () => {
    const d = await vscode.workspace.openTextDocument(wsUri(file))
    return d.getText() === content ? d : undefined
  })
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
    assert(crlfDoc.text.startsWith('改题\r\n正文 A'), `CRLF 文档行尾应保持（LF 坐标替换「标题一」三字符），写入后实际 ${JSON.stringify(crlfDoc.text.slice(0, 8))}）`)
    await closeAllEditors()
    console.log('[#355] 公开 API 读取与多范围修饰通过（LF/CRLF、凭据对位、dirty/save、零文本操作不造历史）')
  }],

  ['附加组件 T06：ABCD 组撤销重做与逐次来源（原子默认 + joinPrevious 并组，#355）', async () => {
    await ensureEnabled()
    const file = 't06-group.md'
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
      if (outcome.ok !== true) {
        const session = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as unknown
        const doc = await docText(file)
        throw new Error(`修饰 ${mark}（${history}）应成功，实际 ${JSON.stringify(outcome)}；诊断 snap=${JSON.stringify(snap.snapshot)} session=${JSON.stringify(session)} doc=${JSON.stringify({ version: doc.version, text: doc.text.slice(0, 30) })}`)
      }
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
    let cdState: Awaited<ReturnType<typeof t06State>> | undefined
    try {
      await poll('CD 组整组撤回', async () => {
        const d = await docText(file)
        return d.text === 'BA' + baseline ? d : undefined
      })
    } catch (err) {
      cdState = await t06State(file)
      throw new Error(`${(err as Error).message}；诊断 state=${JSON.stringify(cdState)} text=${JSON.stringify((await docText(file)).text.slice(0, 10))}`)
    }
    await vscode.commands.executeCommand('undo')
    const afterUndo2 = await poll('AB 组整组撤回（回基态）', async () => {
      const d = await docText(file)
      return d.text === baseline ? d : undefined
    })
    assert(afterUndo2.text === baseline, '二次撤销应撤 AB 两笔（组单位）')

    // 重做 ×2：整组恢复
    await vscode.commands.executeCommand('redo')
    await poll('AB 组整组重做', async () => {
      const d = await docText(file)
      return d.text === 'BA' + baseline ? d : undefined
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
    const file = 't06-reject.md'
    const baseline = 'T06 拒绝矩阵基态\n'
    await resetDocAndOpen(file, baseline)

    // joinPrevious 无可确认前项（无可归属栈顶——会话延续时为外来条目
    // 打断形态）：明确拒绝 history-boundary，不写回
    const entriesBaseline = (await t06State(file))?.entries.length ?? 0
    const snap1 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const rejected = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snap1.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'X' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(rejected.ok === false && rejected.reason === 'history-boundary',
      `无可归属前项的 joinPrevious 应拒绝 history-boundary，实际 ${JSON.stringify(rejected)}`)
    const unchanged = await docText(file)
    assert(unchanged.text === baseline, `被拒提交不得写回，实际 ${JSON.stringify(unchanged.text)}`)
    const state1 = await t06State(file)
    assert(state1 !== undefined && state1.entries.length === entriesBaseline, `被拒提交不得新增条目，实际 ${JSON.stringify(state1?.entries.length)}（基线 ${entriesBaseline}）`)

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

    // 旧快照拒绝 stale-snapshot（快照修订失配；宿主版本无关——不自动
    // 重试）。注：被拒事务的本地回滚会推进修订（Y 的本地效果回滚也是
    // 本地事务），bump 前重取快照；随后的 Z 提交再推进修订，令 snap5
    // 过期即 stale 形态
    const snap5 = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const staleRev = snap5.snapshot.revision
    const bump = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: staleRev, changes: [{ offset: 0, length: 0, text: 'Z' }] },
    }))) as { ok: boolean; reason?: string }
    assert(bump.ok === true, `前序修饰应成功，实际 ${JSON.stringify(bump)}`)
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
    // 分支新写入使 redo 分支失效（undo 落定瞬间的文档事务窗口可能让
    // applyEdit 暂时 false——小间隔重试）
    let branchWritten = false
    for (let i = 0; i < 5 && !branchWritten; i++) {
      const branchWrite = new vscode.WorkspaceEdit()
      branchWrite.insert(wsUri(file), new vscode.Position(0, 0), '新')
      branchWritten = await vscode.workspace.applyEdit(branchWrite)
      if (!branchWritten) {
        await new Promise((r) => setTimeout(r, 300))
      }
    }
    assert(branchWritten, '分支新写入应成功')
    void afterUndo
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
    assert(decodeURIComponent(String(embeds[0]!['targetDocUri'])).includes('p204-编辑目标'), `embed 句柄目标应为 B 文档，实际 ${embeds[0]!['targetDocUri']}`)

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
    const bEntries = targetState?.entries ?? []
    assert(bEntries.length === 2 && bEntries.every((e) => e.owner === 'addon'),
      `B 协调器应记 A/B 两条 addon 条目（两次独立提交、同组），实际 ${JSON.stringify(bEntries)}`)
    assert(bEntries[0]!.groupId !== undefined && bEntries[1]!.groupId === bEntries[0]!.groupId, 'B 修饰应同组')

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

  ['附加组件 T06：外来交错与快速连按撤回、在途并发收敛（#355）', async () => {
    await ensureEnabled()
    const file = 't06-concurrent.md'
    const baseline = 'T06 并发基态\n'
    await resetDocAndOpen(file, baseline)

    // 外来写入 W（独立单步单位）先落地，随后 SDK 修饰组（V01 矩阵 8 生产版：
    // 外来与修饰组交错，各自独立撤回单位）
    const foreign = new vscode.WorkspaceEdit()
    foreign.insert(wsUri(file), new vscode.Position(0, 0), 'W')
    assert(await vscode.workspace.applyEdit(foreign), '外来写入应成功')
    await new Promise((r) => setTimeout(r, 400))
    const snapA = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { text: string; revision: number } }
    assert(snapA.ok === true && snapA.snapshot.text.startsWith('W'), `外来写入应入快照，实际 ${JSON.stringify(snapA.snapshot.text.slice(0, 6))}`)
    const applyA = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapA.snapshot.revision, changes: [{ offset: snapA.snapshot.text.length, length: 0, text: '甲A' }] },
    }))) as { ok: boolean; reason?: string }
    assert(applyA.ok === true, `SDK 甲A 应成功，实际 ${JSON.stringify(applyA)}`)
    const snapB = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const applyB = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapB.snapshot.revision, changes: [{ offset: 0, length: 0, text: '乙B' }], history: 'joinPrevious' },
    }))) as { ok: boolean; reason?: string }
    assert(applyB.ok === true, `SDK 乙B 并组应成功，实际 ${JSON.stringify(applyB)}`)
    const grouped = await docText(file)
    assert(grouped.text === '乙BW' + baseline + '甲A', `交错后文本应按序落盘，实际 ${JSON.stringify(grouped.text.slice(0, 8))}`)

    // 快速连按（V01 矩阵 9 生产版）：两次 undo 立即连续执行、不等中间收敛——
    // LIFO 第一撤 AB 组、第二撤外来 W，恰回基态不多撤
    await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('undo')
    await poll('连按两撤收敛回基态', async () => {
      const d = await docText(file)
      return d.text === baseline ? d : undefined
    })
    const stateAfterRapid = await t06State(file)
    assert(stateAfterRapid !== undefined && !stateAfterRapid.lost, '连按后协调器不得 lost')
    // 第三次 undo：本用例的两个撤回单位（修饰组 + 外来 W）已撤尽——不得
    // 再撤出本用例的任何残留（会话延续时更早的历史仍可被撤，属宿主栈
    // 既有内容，与协调器无关）
    await vscode.commands.executeCommand('undo')
    await new Promise((r) => setTimeout(r, 500))
    const afterThird = await docText(file)
    assert(!afterThird.text.includes('甲A') && !afterThird.text.includes('乙B') && !afterThird.text.includes('W'),
      `第三次 undo 不得恢复本用例内容，实际 ${JSON.stringify(afterThird.text.slice(0, 8))}`)

    // 在途并发（V01 矩阵 7 生产版）：修饰指令刚塞入（未收结局）立即 undo——
    // 撤销可能落在修饰落地前或后（F2 执行时点计算），终态必须收敛且不悬挂
    const snapX = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { text: string; revision: number } }
    const inFlightSeq = await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapX.snapshot.revision, changes: [{ offset: snapX.snapshot.text.length, length: 0, text: 'X' }] },
    })
    await vscode.commands.executeCommand('undo')
    const inFlightOutcome = await collectOne(inFlightSeq)
    assert(inFlightOutcome !== undefined && (inFlightOutcome['ok'] === true || inFlightOutcome['ok'] === false),
      `在途指令必须有终态结局（成功或可辨认拒绝），实际 ${JSON.stringify(inFlightOutcome)}`)
    // 收敛：修饰若已落地则再撤一步；至多两次 undo 内回基态
    for (let i = 0; i < 2 && (await docText(file)).text !== baseline; i++) {
      await vscode.commands.executeCommand('undo')
      await new Promise((r) => setTimeout(r, 400))
    }
    const converged = await docText(file)
    assert(converged.text === baseline, `在途并发应收敛回基态，实际 ${JSON.stringify(converged.text.slice(0, 8))}`)
    const stateAfterRace = await t06State(file)
    assert(stateAfterRace !== undefined && !stateAfterRace.lost, '在途并发后协调器不得 lost')
    await closeAllEditors()
    console.log('[#355] 外来交错、快速连按与在途并发通过（单位推进、收敛、不 lost）')
  }],

  ['附加组件 T06：webview 重载映射继续与会话退役重建（#355）', async () => {
    await ensureEnabled()
    const file = 't06-reload.md'
    const baseline = 'T06 重载基态\n'
    await resetDocAndOpen(file, baseline)

    // SDK 修饰组（A 原子 + B 并组）
    const snapA = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { text: string; revision: number } }
    const applyA = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapA.snapshot.revision, changes: [{ offset: snapA.snapshot.text.length, length: 0, text: 'A' }] },
    }))) as { ok: boolean; credential?: { opId: string }; reason?: string }
    assert(applyA.ok === true, `修饰 A 应成功，实际 ${JSON.stringify(applyA)}`)
    const snapB = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { revision: number } }
    const applyB = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapB.snapshot.revision, changes: [{ offset: 0, length: 0, text: 'B' }], history: 'joinPrevious' },
    }))) as { ok: boolean; credential?: { opId: string }; reason?: string }
    assert(applyB.ok === true, `修饰 B 并组应成功，实际 ${JSON.stringify(applyB)}`)
    // 组身份 = 组首（A 的原子操作）opId——joinPrevious 笔并入 A 组
    const groupOpId = applyA.credential!.opId

    // webview 面板重载（V01 矩阵 15 生产版：同面板重复 ready——宿主侧
    // 协调器与会话不动，页面与组件以新代次重建）
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    await poll('重载后面板就绪', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
        | { found: boolean; panels: { ready: boolean }[] }
      return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
    })
    await probePageReady(file)
    const stateAfterReload = await t06State(file)
    // 本用例的 A/B 两条目（按凭据 opId 对位——会话延续时更早用例的条目
    // 也在场，属合法状态）应保留且同组
    const ownEntries = stateAfterReload?.entries.filter((e) => e.groupId === groupOpId) ?? []
    assert(stateAfterReload !== undefined && !stateAfterReload.lost && ownEntries.length === 2,
      `重载后本用例组条目应保留，实际 ${JSON.stringify(stateAfterReload?.entries)}（opId ${groupOpId}）`)

    // 重载后整组撤回仍正确（映射继续）+ 重做恢复
    await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('undo')
    await poll('重载后整组撤回', async () => {
      const d = await docText(file)
      return d.text === baseline ? d : undefined
    })
    await vscode.commands.executeCommand('redo')
    await poll('重做恢复整组', async () => {
      const d = await docText(file)
      return d.text === 'B' + baseline + 'A' ? d : undefined
    })

    // 保存 → 关闭 → 重开：新面板上 SDK 链路照常（快照见权威文本、修饰/
    // 撤回正确）。协调器状态延续或重建（文档模型实例是否更换决定）皆
    // 合法——行为面为准（实例对账修复后旧实例冻结不再泄入）
    await (await vscode.workspace.openTextDocument(wsUri(file))).save()
    await closeAllEditors()
    await new Promise((r) => setTimeout(r, 300))
    await openEditorAndWait(file)
    await probePageReady(file)
    const snapNew = (await collectOne(await queue('snapshot', { instanceId: 'main' }))) as
      { ok: boolean; snapshot: { text: string; revision: number } }
    assert(snapNew.ok === true && snapNew.snapshot.text === 'B' + baseline + 'A', '重开快照应见保存后的权威文本')
    const applyNew = (await collectOne(await queue('applyEdits', {
      instanceId: 'main',
      request: { revision: snapNew.snapshot.revision, changes: [{ offset: snapNew.snapshot.text.length, length: 0, text: 'C' }] },
    }))) as { ok: boolean; reason?: string }
    assert(applyNew.ok === true, `重开后修饰应成功，实际 ${JSON.stringify(applyNew)}`)
    await vscode.commands.executeCommand('undo')
    await poll('重开后修饰撤回', async () => {
      const d = await docText(file)
      return d.text === 'B' + baseline + 'A' ? d : undefined
    })
    await closeAllEditors()
    console.log('[#355] webview 重载映射继续、关闭重开链路照常通过（组条目保留、快照/修饰/撤回正确）')
  }],
]
