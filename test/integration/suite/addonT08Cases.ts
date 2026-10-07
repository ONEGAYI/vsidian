// T08（#357）行为冲突管理——真宿主生产路径用例。
//
// 生产消费链路：夹具组件 vsidian-test-fixture.addon-t07 的编辑器页注册
// 三个输入行为（dash-fill / space-fill / tilde-fill）；页面 runtime 在注册
// 后经 addon.behaviors.report 全量对账上报宿主，宿主目录服务（runState
// 门控）构建行为冲突管理目录；设置页经 addons.behaviorsGet 拉取载荷，
// 写入经 addons.behaviorsSetDisabled/SetOrder（本用例经生产设置页面板
// 的消息注入通道注入——与设置页 UI 同一宿主处理入口，非 _test 等价旁
// 路）；写入成功即推送全部活跃编辑器面板（热生效），键入驱动经
// _test.postToPanel 的 table.test.type（生产 CM6 事务）验证真实输入效果。
//
// 覆盖票面验收：
// - 调序与只关某项能通过真实输入展示结果，其余适用行为继续运行。
// - 整体停用与单项关闭互相区分：停用整组件回收目录但存储配置保留
//（重启用后单项关闭仍生效）；故障/停用状态由 addons.state 合成呈现
//（呈现面在浏览器用例钉住，此处钉宿主权威状态与恢复语义）。
// - 重开（面板重载近似重启——T07 同限制：跨宿主真重启不可集成内重放，
//   globalState 持久化语义由服务单测承载）后顺序与开关恢复。
//
// 已知边界（如实声明）：设置页 DOM 呈现、键盘可操作性与绘制层断言由
// test/browser/addonT08BehaviorsManage.mjs 承载（真实键盘）；本文件钉
// 宿主通道、目录对账、热生效与恢复语义。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t07'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

const KEY_DASH = `${ADDON_ID}#dash-fill`
const KEY_SPACE = `${ADDON_ID}#space-fill`
const KEY_TILDE = `${ADDON_ID}#tilde-fill`

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

async function docText(name: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(wsUri(name))
  return doc.getText()
}

/** view.state 探针的 addonBehaviors 面（requestViewState 触发面板回报） */
async function behaviorStats(file: string): Promise<{
  registrations: Array<{ addonId: string; id: string; name: string }>
  hostState: { order: string[]; disabled: string[] } | null
} | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | Record<string, unknown>
    | undefined
  return state?.['addonBehaviors'] as never
}

/** 宿主行为注册目录快照（_test.addonBehaviorCatalog——上报对账的断言面） */
async function behaviorCatalog(): Promise<Array<{ addonId: string; id: string; name: string }>> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as never
}

async function behaviorState(): Promise<{ order: string[]; disabled: string[] }> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState')) as never
}

/** 确保组件注册并 enabled（自愈先序用例状态；对齐 T07 ensureEnabled 口径） */
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

/** 以基态重写盘面并打开（行为链用例的可重复基线；T07 resetDocAndOpen 同款） */
async function resetDocAndOpen(file: string, base: string): Promise<void> {
  await closeAllEditors()
  try {
    const existing = await vscode.workspace.openTextDocument(wsUri(file))
    if (existing.isDirty) {
      await existing.save()
    }
  } catch {
    // 文件不存在：下方 writeFile 首建
  }
  await vscode.workspace.fs.writeFile(wsUri(file), Buffer.from(base, 'utf8'))
  await poll('盘面重写生效（watcher 广播完成）', async () => {
    const d = await vscode.workspace.openTextDocument(wsUri(file))
    return d.getText() === base ? d : undefined
  })
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((p) => p.ready) ? state : undefined
  })
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
    kind: 'table.test.domType', text,
  })
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 行为状态恢复默认（防跨用例污染；幂等） */
async function resetBehaviorState(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetOrder', { order: [] })
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_DASH, KEY_SPACE, KEY_TILDE], disabled: false })
}

/** 打开真实设置页并等待 ready（消息注入须在面板在场时进行）。
 * 面板移到侧组：编辑器面板保持可见——编辑器 webview 不开
 * retainContextWhenHidden，同组切换会卸载它，热生效断言就无从在活跃
 * 面板上进行（置侧组后编辑器 tab 常显，推送与探针即时可达）。 */
async function openSettingsPageBeside(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
  await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup')
  await poll('设置页 ready', async () => {
    const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
      | { open: boolean; ready: boolean }
    return info.open && info.ready ? info : undefined
  })
}

/** 关闭设置页并把焦点还给编辑器组（侧组被移走后编辑器组常显） */
async function closeSettingsPage(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.closeSettingsPage')
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup')
  await new Promise((r) => setTimeout(r, 200))
}

/** 等待盘面到达预期文本；超时抛出带诊断的错误（text/stats/catalog） */
async function waitForDocText(file: string, expected: string, label: string): Promise<void> {
  try {
    await poll(label, async () => ((await docText(file)) === expected ? true : undefined))
  } catch (err) {
    const text = await docText(file)
    const stats = await behaviorStats(file)
    const catalog = await behaviorCatalog()
    throw new Error(`${(err as Error).message}；诊断：text=${JSON.stringify(text)} stats=${JSON.stringify(stats)} catalog=${JSON.stringify(catalog)}`)
  }
}

/** 经生产设置页面板通道注入 webview → 宿主消息（与设置页 UI 同一入口） */
async function injectSettingsMessage(message: Record<string, unknown>): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.injectSettingsPageMessage', message)
}

export const addonT08Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T08：行为目录上报对账与真实设置页通道的单项关闭热生效，#357', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't08-manage.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 注册上报对账：宿主目录含三个行为（名称为注册面元数据）
    const catalog = await poll('目录上报到达', async () => {
      const list = await behaviorCatalog()
      return list.filter((entry) => entry.addonId === ADDON_ID).length === 3 ? list : undefined
    })
    const names = catalog.filter((entry) => entry.addonId === ADDON_ID).map((entry) => entry.name)
    assert(names.every((name) => typeof name === 'string' && name.length > 0), `目录应含必填名称：${JSON.stringify(catalog)}`)

    // 真实设置页面板通道写入单项关闭（生产路由：settingsPage.handleMessage
    // → addons wiring → behaviorStateService → 推送活跃编辑器面板）
    await openSettingsPageBeside()
    await injectSettingsMessage({ kind: 'addons.behaviorsSetDisabled', keys: [KEY_SPACE], disabled: true })
    await poll('关闭推送到达编辑器面板', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.disabled?.includes(KEY_SPACE) ? stats : undefined
    })

    // 真实输入：关闭项不修饰，其余适用行为继续运行（默认序 dash<space<tilde，
    // fill 组内首个适用者换为 tilde 插 ~ → word^-~）
    await typeAt(file, 4, '^')
    await waitForDocText(file, 'word^-~\n', '关闭 space 后 dash 与 tilde 继续运行')
    const stateAfterDisable = await behaviorState()
    assert(stateAfterDisable.disabled.includes(KEY_SPACE), '单项关闭应落库')

    // 重开面板（近似重启——T07 同限制）后单项关闭恢复；再次键入结果一致
    await closeAllEditors()
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)
    await poll('重开后关闭状态恢复', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.disabled?.includes(KEY_SPACE) ? stats : undefined
    })
    await typeAt(file, 4, '^')
    await waitForDocText(file, 'word^-~\n', '重开后输入结果一致')
    await closeSettingsPage()
    await resetBehaviorState()
  }],

  ['附加组件 T08：真实设置页通道调序的可预期输入结果与重开恢复，#357', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't08-order.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 调序：tilde 组内前置（fill 组内首个适用者从 space 换为 tilde）
    await openSettingsPageBeside()
    await injectSettingsMessage({ kind: 'addons.behaviorsSetOrder', order: [KEY_TILDE, KEY_DASH, KEY_SPACE] })
    await poll('调序推送到达', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.order?.[0] === KEY_TILDE ? stats : undefined
    })

    // 真实输入：word^~-（tilde 先适用占组，dash 组外再修饰，space 组内被占跳过）
    await typeAt(file, 4, '^')
    await waitForDocText(file, 'word^~-\n', '调序后修饰落地')

    // 重开面板后顺序恢复
    await closeAllEditors()
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)
    await poll('重开后顺序恢复', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.order?.[0] === KEY_TILDE ? stats : undefined
    })
    await closeSettingsPage()
    await resetBehaviorState()
  }],

  ['附加组件 T08：整体停用与单项关闭互相区分、目录回收与配置保留，#357', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    await closeAllEditors()
    const file = 't08-disable.md'
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)

    // 先落一项单项关闭（用户配置；关闭 space——dash/tilde 继续运行的正例载体）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_SPACE], disabled: true })
    await poll('关闭推送到达', async () => {
      const stats = await behaviorStats(file)
      return stats?.hostState?.disabled?.includes(KEY_SPACE) ? stats : undefined
    })

    // 整体停用（用户功能开关）：目录回收该组件（reconcile），存储配置保留
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用后目录回收', async () => {
      const list = await behaviorCatalog()
      return list.every((entry) => entry.addonId !== ADDON_ID) ? list : undefined
    })
    const stateWhileDisabled = await behaviorState()
    assert(stateWhileDisabled.disabled.includes(KEY_SPACE), '整体停用不丢单项关闭配置（区分语义）')

    // 重新启用 + 重开面板：注册恢复，单项关闭仍生效（配置不丢的恢复面）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await poll('启用后运行态恢复', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return status?.runState === 'enabled' ? status : undefined
    })
    await closeAllEditors()
    await resetDocAndOpen(file, 'word\n')
    await probeRegistrations(file)
    await poll('重开后目录与关闭配置恢复', async () => {
      const list = await behaviorCatalog()
      const stats = await behaviorStats(file)
      return list.filter((entry) => entry.addonId === ADDON_ID).length === 3 &&
        stats?.hostState?.disabled?.includes(KEY_SPACE) ? list : undefined
    })
    await typeAt(file, 4, '^')
    await waitForDocText(file, 'word^-~\n', '恢复后单项关闭仍生效')
    await resetBehaviorState()
  }],
]
