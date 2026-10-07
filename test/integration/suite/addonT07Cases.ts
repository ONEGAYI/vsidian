// #356 T07 可组合输入行为与逐项注册状态——真宿主生产路径用例。
//
// 生产消费链路：夹具组件 vsidian-test-fixture.addon-t07 经公开
// registerAddon 注册编辑器页入口，其页面产物（构建桥 t07Editor.ts）经
// 公开 SDK behaviors 面注册三个输入行为（bracket-close / dash-in-parens
// / space-in-parens——后两者同独占组 parens-fill，space 声明
// joinPrevious）；行为回调与 onChanged 观察事件经 t07.event 收件箱回宿主
// 断言。键入驱动经 _test.postToPanel 的 table.test.type（生产 CM6 事务，
// userEvent 'input.type'——与真实键盘同一路径进入链驱动检测）；撤销经
// table.test.history（生产转发入口）；链观测断言 view.state 探针的
// addonBehaviors 面（注册清单/宿主状态/轨迹/计数）。
//
// 覆盖票面验收：
// - 括号处理与空格整理两个测试行为共同运行；名称缺失拒绝（夹具
//   no-name 注册拒绝结果上报）而说明/例子缺失允许（bracket-close 带、
//   其余不带仍注册成功）。
// - 默认序（完整键字典序）下后续行为读取前序修饰后的快照；独占组
//   parens-fill 内按有效序首个适用者生效、其后同组不调回调（不恢复
//   统一先接管者生效——跨组 bracket 不受影响）；调序后结果可预期变化。
// - 单项关闭即时生效（宿主钩子写入→面板推送→链跳过）；重载面板后
//   顺序与开关恢复（globalState 持久）。
// - 撤销粒度与来源：atomic 修饰逐笔成撤回单位、joinPrevious 并入上次
//   原子操作一次撤回（Q29）；外来键入独立单位。
// - 通知分离：onChanged 观察事件到达，全部行为关闭时输入零修饰
//  （不是原操作的第二写入口）。
//
// 已知边界（如实声明）：真实 IME 键盘、表格格区与 Tab 键的情境保持由
// test/browser/addonT07Behaviors.mjs（独立桌面 CDP 真实键盘/IME）承载；
// 集成内以 table.test.type 模拟键入（同一 userEvent 路径）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t07'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

const KEY_BRACKET = `${ADDON_ID}#bracket-close`
const KEY_DASH = `${ADDON_ID}#dash-in-parens`
const KEY_SPACE = `${ADDON_ID}#space-in-parens`

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

interface BehaviorEvent extends Record<string, unknown> {
  kind?: string
  id?: string
  planned?: boolean
  snapshotText?: string
  inputText?: string
}

/** 事件收件箱（本地缓冲增量合并——collect 每次 splice 消费，轮询不丢） */
class EventInbox {
  private readonly buffer: BehaviorEvent[] = []

  /** 非阻塞拉取新增事件进缓冲，返回本次新增 */
  async pull(): Promise<BehaviorEvent[]> {
    const batch = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, 0)) as BehaviorEvent[] | undefined
    const fresh = batch ?? []
    this.buffer.push(...fresh)
    return fresh
  }

  /** 等待匹配事件出现（缓冲内查找；等待期间持续拉取） */
  async take(match: (e: BehaviorEvent) => boolean, timeoutMs = 20000): Promise<BehaviorEvent> {
    return poll('目标事件', async () => {
      await this.pull()
      const hit = this.buffer.find(match)
      return hit !== undefined ? hit : undefined
    }, timeoutMs)
  }

  /** 等待一个静默窗口后返回缓冲全量（调用方先以 docText 终态判定收口，
   *  此处只补齐事件流的到达延迟） */
  async settleAll(idleMs = 800): Promise<BehaviorEvent[]> {
    await new Promise((r) => setTimeout(r, idleMs))
    await this.pull()
    return this.buffer
  }
}

async function docText(name: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(wsUri(name))
  return doc.getText()
}

/** view.state 探针的 addonBehaviors 面（requestViewState 触发面板回报） */
async function behaviorStats(file: string): Promise<{
  registrations: Array<{ addonId: string; id: string; name: string; exclusiveGroup?: string; history?: string }>
  hostState: { order: string[]; disabled: string[] } | null
  counters: { drives: number; drivesSkippedWhileRunning: number; callbackErrors: number; submitsRejected: number }
  trace: Array<{ behaviorKey: string; opId: string; outcome: string }>
} | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | Record<string, unknown>
    | undefined
  return state?.['addonBehaviors'] as never
}

/** 确保组件注册并 enabled（自愈先序用例状态；对齐 T06 ensureEnabled 口径） */
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

/** 以基态重写盘面并打开（行为链用例的可重复基线；T06 同款时序收口） */
async function resetDocAndOpen(file: string, base: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((p) => p.ready) ? state : undefined
  })
  const edit = new vscode.WorkspaceEdit()
  edit.replace(wsUri(file), new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), base)
  await vscode.workspace.applyEdit(edit)
  await vscode.workspace.saveAll(false)
  await poll('基态落盘', async () => (await docText(file)) === base ? true : undefined)
}

/** 页面行为注册就绪探测（注册清单经 view.state 探针） */
async function probeRegistrations(file: string): Promise<void> {
  await poll('行为注册就绪', async () => {
    const stats = await behaviorStats(file)
    return stats && stats.registrations.length >= 3 ? stats : undefined
  })
}

/** 设置主选区光标并模拟键入（生产事务路径：userEvent 'input.type'） */
async function typeAt(file: string, cursor: number, text: string): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), {
    kind: 'table.test.crossSelect', anchor: cursor, head: cursor,
  })
  await new Promise((r) => setTimeout(r, 100))
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), {
    kind: 'table.test.type', text,
  })
}

async function undoOnce(file: string): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), {
    kind: 'table.test.history', op: 'undo',
  })
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 行为状态恢复默认（防跨用例污染；幂等） */
async function resetBehaviorState(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetOrder', { order: [] })
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_BRACKET, KEY_DASH, KEY_SPACE], disabled: false })
}

export const addonT07Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T07：公开注册与默认序链执行（共同运行/独占组/前序结果/原子撤回，#356）', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't07-chain.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 注册形状：名称缺失拒绝（no-name → invalid-registration）；
    // 说明/例子缺失允许（dash/space 无 description 仍注册成功）
    const inbox = new EventInbox()
    const registered = await inbox.take((e) => e['kind'] === 'registered')
    const results = registered['results'] as Array<{ id: string; result: { ok: boolean; reason?: string } }>
    const byId = new Map(results.map((r) => [r.id, r.result]))
    assert(byId.get('bracket-close')?.ok === true, `bracket-close 应注册成功：${JSON.stringify(results)}`)
    assert(byId.get('dash-in-parens')?.ok === true, 'dash（无说明/例子）应注册成功')
    assert(byId.get('space-in-parens')?.ok === true, 'space（无说明/例子）应注册成功')
    assert(byId.get('<invalid-no-name>')?.ok === false && byId.get('<invalid-no-name>')?.reason === 'invalid-registration',
      `名称缺失应拒绝：${JSON.stringify(results)}`)
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)

    // 默认序（字典序 bracket → dash → space）链执行：键入 ( 后
    // bracket 补 )，dash 见前序结果（快照含 )）插 -，space 同组被占不调
    const chainInbox = new EventInbox()
    await typeAt(file, 4, '(')
    await poll('默认序修饰落地', async () => ((await docText(file)) === 'word(-)\n' ? true : undefined))
    const events = await chainInbox.settleAll()
    const behaviorEvents = events.filter((e) => e['kind'] === 'behavior') as BehaviorEvent[]
    const ids = behaviorEvents.map((e) => e['id'])
    assert(ids.includes('bracket-close') && ids.includes('dash-in-parens'), `bracket 与 dash 应共同运行：${JSON.stringify(behaviorEvents)}`)
    assert(!ids.includes('space-in-parens'), `独占组内 dash 适用后 space 不应被调用：${JSON.stringify(ids)}`)
    const dashEvent = behaviorEvents.find((e) => e['id'] === 'dash-in-parens')
    assert(String(dashEvent?.['snapshotText'] ?? '').includes(')') === true,
      `dash 读到的快照应含 bracket 修饰结果（读取前序结果）：${JSON.stringify(dashEvent)}`)
    assert(events.some((e) => e['kind'] === 'changed'), 'onChanged 观察事件应到达（通知分离）')

    // 链观测：trace 两笔（bracket/dash 修饰提交），space 无
    const stats = await behaviorStats(file)
    const trace = stats?.trace ?? []
    assert(trace.length >= 2 && trace[trace.length - 2]!.behaviorKey === KEY_BRACKET && trace[trace.length - 1]!.behaviorKey === KEY_DASH,
      `轨迹应为 bracket→dash：${JSON.stringify(trace)}`)
    assert((stats?.counters.submitsRejected ?? 0) === 0 && (stats?.counters.callbackErrors ?? 0) === 0,
      `默认链不应有拒绝/回调异常：${JSON.stringify(stats?.counters)}`)

    // 撤回单位（atomic 逐笔）：dash → bracket → 键入，3 次回基态
    await undoOnce(file)
    await undoOnce(file)
    await undoOnce(file)
    await poll('三次撤销回基态', async () => ((await docText(file)) === 'word\n' ? true : undefined))
    await resetBehaviorState()
  }],

  ['附加组件 T07：调序与单项关闭即时生效、joinPrevious 并组撤回与重载恢复，#356', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't07-order.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 调序：space 提到最前（管理面等价入口写入 → 面板推送 → 即时生效）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetOrder', {
      order: [KEY_SPACE, KEY_BRACKET, KEY_DASH],
    })
    await poll('宿主状态推送到达', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.order?.[0] === KEY_SPACE ? stats : undefined
    })

    // 键入 (：bracket 补 )，space（组内先于 dash）插空格 → ( |)；dash 跳过
    const orderInbox = new EventInbox()
    await typeAt(file, 4, '(')
    await poll('调序后修饰落地', async () => ((await docText(file)) === 'word( )\n' ? true : undefined))
    const events = await orderInbox.settleAll()
    const ids = (events.filter((e) => e['kind'] === 'behavior') as BehaviorEvent[]).map((e) => e['id'])
    assert(ids.includes('space-in-parens') && !ids.includes('dash-in-parens'),
      `调序后 space 应生效、dash 应被组内跳过：${JSON.stringify(ids)}`)

    // joinPrevious 撤回粒度：space（非原子）并入 bracket（上次原子）一组
    // 一次撤回；再撤一次回退键入
    await undoOnce(file)
    await poll('joinPrevious 并组一次撤回', async () => ((await docText(file)) === 'word(\n' ? true : undefined))
    await undoOnce(file)
    await poll('撤回到键入前', async () => ((await docText(file)) === 'word\n' ? true : undefined))

    // 单项关闭：关 bracket-close 后键入 ( 无任何修饰
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_BRACKET], disabled: true })
    await poll('关闭推送到达', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.disabled?.includes(KEY_BRACKET) ? stats : undefined
    })
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    const disableInbox = new EventInbox()
    await typeAt(file, 4, '(')
    await poll('关闭后纯输入', async () => ((await docText(file)) === 'word(\n' ? true : undefined))
    const eventsAfterDisable = await disableInbox.settleAll()
    assert(!eventsAfterDisable.some((e) => e['kind'] === 'behavior' && e['id'] === 'bracket-close'),
      '关闭的行为不应被调用')
    await undoOnce(file)
    await poll('关闭场景回基态', async () => ((await docText(file)) === 'word\n' ? true : undefined))

    // 重载面板后状态恢复：顺序（space 前置）与开关（bracket 关闭）保持
    await closeAllEditors()
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)
    await poll('重载后宿主状态恢复', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.order?.[0] === KEY_SPACE && stats.hostState.disabled.includes(KEY_BRACKET) ? stats : undefined
    })
    await typeAt(file, 4, '(')
    await poll('重载后行为按恢复状态生效', async () => ((await docText(file)) === 'word(\n' ? true : undefined))
    await resetBehaviorState()
  }],

  ['附加组件 T07：通知分离（onChanged 非第二写入口）与逐项停用全关，#356', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't07-observe.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 全部关闭：输入仍达观察者（changed 事件），但零修饰零提交
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', {
      keys: [KEY_BRACKET, KEY_DASH, KEY_SPACE], disabled: true,
    })
    await poll('全关推送到达', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.disabled?.length === 3 ? stats : undefined
    })
    const drivesBefore = (await behaviorStats(file))?.counters.drives ?? 0
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    const observeInbox = new EventInbox()
    await typeAt(file, 4, 'x')
    await poll('纯输入落地', async () => ((await docText(file)) === 'wordx\n' ? true : undefined))
    const events = await observeInbox.settleAll()
    assert(events.some((e) => e['kind'] === 'changed' && e['inputText'] === 'x'),
      `onChanged 观察事件应到达：${JSON.stringify(events)}`)
    assert(!events.some((e) => e['kind'] === 'behavior'), `全部行为关闭时不应有行为回调：${JSON.stringify(events)}`)
    const statsAfter = await behaviorStats(file)
    assert((statsAfter?.counters.drives ?? 0) === drivesBefore + 1, '驱动计数应 +1（观察先行）')
    assert((statsAfter?.trace ?? []).length === 0, '零修饰提交（onChanged 不是第二写入口）')
    await undoOnce(file)
    await poll('回基态', async () => ((await docText(file)) === 'word\n' ? true : undefined))
    await resetBehaviorState()
  }],
]
