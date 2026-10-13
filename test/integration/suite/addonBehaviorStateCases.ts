// #476 附加组件行为禁用态只读可见面（sdk.behaviorState）——真宿主生产
// 路径用例。
//
// 生产消费链路：夹具组件 vsidian-test-fixture.addon-bstate 经公开
// registerAddon 注册编辑器页与自身设置页两个入口，页面产物（构建桥
// bstateEditor.ts / bstateSettings.ts）消费公开 SDK behaviorState 面：
// 装载即上报 enabledState() 初值（initial——广播先于装载指令的时序
// 证据），onEnabledChange 每次分发上报新快照（change）。事件经 setup
// scope 通道 bstate.event 进宿主收件箱（停用后仍服务——设置页不卸载
// 场景的关键链路）。
//
// 覆盖票面验收（规格 docs/specs/addon-behavior-disabled-state.md）：
// - 快照口径（D3）：addonRunState 两态 + 本组件行为局部 id 集（完整键
//   过滤后剥离——demo-rule 在编辑器页注册，宿主禁用完整键后页面收到
//   的是局部 id）；
// - 订阅时机（D5）：单项禁用/恢复落库后即时到达（behaviorStateService
//   onChanged → 两页广播 → 页面回调）；
// - 设置页挂面（D1）：设置页面板装载组件设置页，SDK behaviorState
//   可用（initial 事件到达即证）；
// - 停用后仍可查询（已定边界）：addonSetEnabled(false) 后设置页不卸载，
//   change 事件上报 user-disabled（灰态消费场景 easy-typing#50 的平台侧
//   验证形态）；恢复 enabled 同链路可达。
//
// 写入驱动：_test.addonBehaviorSetDisabled（宿主侧直驱 behaviorState
// Service——生产写入路由 addons.behaviorsSetDisabled 经设置页面板的
// 端到端已由 T08 用例覆盖，本文件聚焦禁用态可见性链路）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-bstate'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

const KEY_DEMO = `${ADDON_ID}#demo-rule`

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

interface BstateEvent extends Record<string, unknown> {
  topic?: string
  page?: string
  generation?: number
  state?: { addonRunState?: string; disabled?: string[] } | null
}

/** 事件收件箱（collect 每次 splice 消费，轮询不丢） */
class EventInbox {
  private readonly buffer: BstateEvent[] = []

  async pull(): Promise<BstateEvent[]> {
    const batch = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, 0)) as BstateEvent[] | undefined
    const fresh = batch ?? []
    this.buffer.push(...fresh)
    return fresh
  }

  /** 缓冲内是否存在匹配事件（负向断言用——如面缺失的 missing 上报） */
  has(match: (e: BstateEvent) => boolean): boolean {
    return this.buffer.some(match)
  }

  /** 等待匹配事件出现（缓冲内查找；等待期间持续拉取） */
  async take(match: (e: BstateEvent) => boolean, timeoutMs = 20000): Promise<BstateEvent> {
    return poll('目标事件', async () => {
      await this.pull()
      const hit = this.buffer.find(match)
      return hit !== undefined ? hit : undefined
    }, timeoutMs)
  }
}

/** 确保组件注册并 enabled（对齐 T07/T08 ensureEnabled 口径） */
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
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await poll('运行态收敛 enabled', async () => {
      const next = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  throw new Error('运行态未能恢复 enabled')
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 以基态重写盘面并用编辑器打开（编辑器面板 ready → 组件装载） */
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

/** 行为状态恢复默认（防跨用例污染；幂等） */
async function resetBehaviorState(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetOrder', { order: [] })
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_DEMO], disabled: false })
}

/** 打开真实设置页面板并等待 ready（编辑器侧组保持——消息注入与组件
 * 设置页挂载都须面板在场） */
async function openSettingsPageBeside(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
  await vscode.commands.executeCommand('workbench.action.moveEditorToNextGroup')
  await poll('设置页 ready', async () => {
    const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
      | { open: boolean; ready: boolean }
    return info.open && info.ready ? info : undefined
  })
}

async function closeSettingsPage(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.closeSettingsPage')
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup')
  await new Promise((r) => setTimeout(r, 200))
}

export const addonBehaviorStateCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 #476：编辑器页行为禁用态快照与订阅（单项禁用落库后即时），#476', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    // 收件箱清空先于装载动作（装载链的 initial 上报必然产生于装载之后，
    // 清箱晚于装载会在快机上把已到达的 initial 清掉——假阴性竞态）
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await resetDocAndOpen('bstate-editor.md', 'word\n')

    // 装载即上报初值：编辑器页 SDK behaviorState 可用的证据（快照形态
    // 正确；权威值的时序到达由下方 change 事件的字段值承担——reset 后
    // 的默认态与广播未到回落态在此不可区分，不作时序断言）
    const inbox = new EventInbox()
    const initial = await inbox.take((e) => e.topic === 'initial' && e.page === 'editor')
    assert(initial.state?.addonRunState === 'enabled', `初值 addonRunState 应为 enabled：${JSON.stringify(initial)}`)
    assert(Array.isArray(initial.state?.disabled) && initial.state!.disabled!.length === 0,
      `初值 disabled 应为空：${JSON.stringify(initial)}`)

    // 面未装配的负向可见性：missing 事件出现即失败（夹具只在面缺失时上报）
    await inbox.pull()
    assert(!inbox.has((e) => e.topic === 'missing'), 'behaviorState 面应在编辑器页提供（未收到 missing 上报）')

    // 键载体行为注册在目录（demo-rule 经编辑器页 behaviors.register）
    await poll('键载体行为注册对账', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as
        Array<{ addonId: string; id: string }>
      return catalog.some((entry) => entry.addonId === ADDON_ID && entry.id === 'demo-rule') ? catalog : undefined
    })

    // 单项禁用落库 → 广播即时到达：页面收到本组件局部 id（完整键已剥离）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_DEMO], disabled: true })
    const disabledEvent = await inbox.take((e) => e.topic === 'change' && e.page === 'editor' &&
      Array.isArray(e.state?.disabled) && e.state.disabled.includes('demo-rule'))
    assert(disabledEvent.state?.addonRunState === 'enabled', `单项禁用时组件运行态应保持 enabled：${JSON.stringify(disabledEvent)}`)
    assert(!disabledEvent.state!.disabled!.some((id) => id.includes('#') || id.includes(ADDON_ID)),
      `disabled 应为本组件局部 id（不含完整键）：${JSON.stringify(disabledEvent.state)}`)

    // 恢复开启 → 消息即时到达（disabled 回空；谓词即断言，超时即失败）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_DEMO], disabled: false })
    await inbox.take((e) => e.topic === 'change' && e.page === 'editor' &&
      e.state?.addonRunState === 'enabled' && Array.isArray(e.state?.disabled) && e.state.disabled.length === 0)

    await resetBehaviorState()
    await closeAllEditors()
  }],

  ['附加组件 #476：设置页挂面与停用后仍可查询（灰态场景），#476', async () => {
    await ensureEnabled()
    await resetBehaviorState()
    // 组件设置页装载前先打开 Vsidian 设置页面板（挂载容器在场）；收件箱
    // 清空先于装载动作（initial 上报必然产生于装载之后——清箱晚于装载
    // 会在快机上把已到达的 initial 清掉）
    await openSettingsPageBeside()
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonOpenSettingsPage', { addonId: ADDON_ID })

    // 设置页挂面：装载即上报初值（initial 事件经 setup scope 通道回宿主）
    const inbox = new EventInbox()
    const initial = await inbox.take((e) => e.topic === 'initial' && e.page === 'settings')
    assert(initial.state?.addonRunState === 'enabled', `设置页初值 addonRunState 应为 enabled：${JSON.stringify(initial)}`)
    assert(Array.isArray(initial.state?.disabled) && initial.state!.disabled!.length === 0,
      `设置页初值 disabled 应为空：${JSON.stringify(initial)}`)

    // 停用组件：设置页不卸载（desiredSettingsLoad 只挡 faulted），页面
    // 收到 user-disabled 的即时通知——停用灰态事实对组件页可见（事件
    // 携带完整快照：disabled 为数组即 enabledState 同源形态——停用后仍
    // 可由订阅路径读到查询同源的值）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    const disabled = await inbox.take((e) => e.topic === 'change' && e.page === 'settings' && e.state?.addonRunState === 'user-disabled')
    assert(Array.isArray(disabled.state?.disabled), `停用 change 事件快照应含 disabled 数组：${JSON.stringify(disabled)}`)

    // 设置页面板仍在场（不随停用卸载）
    const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as { open: boolean }
    assert(info.open, '停用后设置页面板应保持打开（不卸载）')

    // 恢复启用 → 即时通知回到 enabled（谓词即断言，超时即失败）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await inbox.take((e) => e.topic === 'change' && e.page === 'settings' && e.state?.addonRunState === 'enabled')

    // 停用状态下**新装载**的设置页：工厂初值即读到 user-disabled（广播
    // 先于装载指令到达——停用灰态对首帧就成立，不等下一次状态变化）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonCloseSettingsPage')
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonOpenSettingsPage', { addonId: ADDON_ID })
    const reopened = await inbox.take((e) => e.topic === 'initial' && e.page === 'settings' && e.state?.addonRunState === 'user-disabled')
    assert(Array.isArray(reopened.state?.disabled), `停用态新装载初值快照应含 disabled 数组：${JSON.stringify(reopened)}`)

    // 收尾恢复：停用偏好与组件设置页关闭（防跨用例污染）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonCloseSettingsPage')
    await closeSettingsPage()
    await resetBehaviorState()
    await closeAllEditors()
  }],
]
