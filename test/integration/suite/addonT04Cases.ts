// #353 T04 附加组件复杂设置——真宿主生产路径用例。
//
// 消费样例：夹具 vsidian-test-fixture.addon-t04（不声明 enable——纯设置
// 组件）经**公开 registerAddon** 注册复杂定义（标量三型 + 替换规则数组 +
// 对象样例）并消费分层读写 API（settings.get/getSource/update/
// clearWorkspaceOverride/onChanged——技术方案 5.5 形状）。
//
// 断言面：
// - 宿主测试钩子（_test.addonSettingsState / addonSettingsGet /
//   addonSettingsUpdate / addonSettingsArea / addonSetEnabledScope——
//   与设置页 UI 消息同源的宿主侧等价入口）；
// - 夹具 stats（公开 API 计数 + onChanged 日志 + 最近 get() 快照）；
// - 生产设置页面板真实消息通道（openSettings → 注入 addons.settingsOpen
//   → 宿主设置区状态权威对齐）。
//
// 用例边界（如实声明，不以集成冒充）：
// - 基础控件编辑与范围切换的浏览器路径在 test:browser 的 addonSettings
//   套件钉住（真实键盘/点击/绘制层）；
// - 「重启后回显」的重启语义由单元测试「同 store 新实例」钉住
//  （addonSettingsService.test.ts），此处钉住「持久层写入 + 面板重开
//   拉取回显」的宿主侧链路。
import * as vscode from 'vscode'

const ADDON_ID = 'vsidian-test-fixture.addon-t04'

interface FixtureStats {
  activateCount: number
  setupCount: number
  updateCalls: number
  badPatchCalls: number
  clearCalls: number
  changedCount: number
  changedLog: Array<{ scope: string; keys: string[] }>
  lastGet: { values: Record<string, unknown>; sources: Record<string, string> } | null
  lastUpdateResult: { ok: boolean; reason?: string; invalidKeys?: string[] } | null
  lastBadPatchResult: { ok: boolean; reason?: string; invalidKeys?: string[] } | null
  lastClearResult: { ok: boolean; reason?: string } | null
  lastRegisterResult: { ok: boolean } | null
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
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

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 夹具激活注册收敛（协调器异步唤醒——不假定先序用例已激活） */
async function ensureRegistered(): Promise<FixtureStats> {
  return poll('夹具组件激活并注册', async () => {
    const stats = await fixtureStats()
    return stats.setupCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
  })
}

/** 夹具最近一次 get() 快照（公开 API 读数） */
async function addonGet(): Promise<{ values: Record<string, unknown>; sources: Record<string, string> }> {
  const snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: ADDON_ID })) as {
    values: Record<string, unknown>
    sources: Record<string, string>
  }
  return snapshot
}

export const addonT04Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T04：复杂定义注册与公开读取（默认值与来源）（#353）', async () => {
    await ensureRegistered()
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsState')) as {
      definitions: Record<string, unknown[]>
    }
    const defs = state.definitions[ADDON_ID] ?? []
    assert(defs.length === 6, `应注册 6 条定义（标量×4 + 数组 + 对象），实际 ${defs.length}`)
    // 公开读取（宿主侧等价入口与夹具 get() 同源）
    const snapshot = await addonGet()
    assert(snapshot.values['threshold'] === 20 && snapshot.sources['threshold'] === 'default', '标量默认值生效，来源 default')
    assert(JSON.stringify(snapshot.values['replacements']) === JSON.stringify(['旧词→新词']), `数组默认值生效，实际 ${JSON.stringify(snapshot.values['replacements'])}`)
    assert(JSON.stringify(snapshot.values['limits']) === JSON.stringify({ name: 'demo', count: 3 }), '对象出厂值按字段默认组装')
    // 夹具经公开 API 读到同一快照
    const stats = await fixtureStats()
    assert(stats.lastGet !== null && stats.lastGet.values['threshold'] === 20, '夹具 setup 后经公开 get() 读到默认值')
    console.log('[#353] 复杂定义注册与公开读取通过（标量/数组/对象默认值）')
  }],

  ['附加组件 T04：分层写入、生效切换与变化事件时序（#353）', async () => {
    await ensureRegistered()
    // 公开 API 写 user 层（夹具内调用——成功保存后 onChanged 触发）
    const before = await fixtureStats()
    const update = (await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'user', key: 'threshold', value: 33 })) as {
      result: { ok: boolean }
      get: { values: Record<string, unknown>; sources: Record<string, string> }
    }
    assert(update.result.ok === true, '合法补丁经公开 API 写入应成功')
    assert(update.get.values['threshold'] === 33 && update.get.sources['threshold'] === 'user', '写入后生效值与来源切换为 user')
    await poll('onChanged 事件到达夹具', async () => {
      const stats = await fixtureStats()
      return stats.changedCount === before.changedCount + 1 &&
        stats.changedLog[stats.changedLog.length - 1]?.scope === 'user' ? stats : undefined
    })

    // 工作区层覆盖：生效切换 workspace；user 层显式值保留
    await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'workspace', key: 'threshold', value: 77 })
    const afterWorkspace = await addonGet()
    assert(afterWorkspace.values['threshold'] === 77 && afterWorkspace.sources['threshold'] === 'workspace', '工作区覆盖生效')

    // 清除覆盖（公开 API）：恢复继承 user 层（33）——不是恢复出厂值（20）
    const clear = (await vscode.commands.executeCommand(`${ADDON_ID}.clearOverrideFromAddon`, { key: 'threshold' })) as {
      result: { ok: boolean }
      get: { values: Record<string, unknown>; sources: Record<string, string> }
    }
    assert(clear.result.ok === true, '清除工作区覆盖应成功')
    assert(clear.get.values['threshold'] === 33 && clear.get.sources['threshold'] === 'user', '清除后恢复继承用户默认（非出厂值）')
    console.log('[#353] 分层写入、生效切换与变化事件时序通过')
  }],

  ['附加组件 T04：非法补丁整批拒绝（值不变、不虚报、事件不发）（#353）', async () => {
    await ensureRegistered()
    const before = await fixtureStats()
    const bad = (await vscode.commands.executeCommand(`${ADDON_ID}.badPatch`)) as {
      result: { ok: boolean; reason?: string; invalidKeys?: string[] }
      get: { values: Record<string, unknown>; sources: Record<string, string> }
    }
    assert(bad.result.ok === false && bad.result.reason === 'invalid-value', `混批非法补丁应整批拒绝，实际 ${JSON.stringify(bad.result)}`)
    assert(JSON.stringify(bad.result.invalidKeys) === JSON.stringify(['threshold']), '被拒键应为超界的 threshold')
    // 合法键（label）不落地；值维持先前状态；onChanged 不触发
    assert(bad.get.values['label'] === 'demo', `合法键不得落地，实际 ${JSON.stringify(bad.get.values['label'])}`)
    const after = await fixtureStats()
    assert(after.changedCount === before.changedCount, `拒绝路径不得发变化事件（前 ${before.changedCount}，后 ${after.changedCount}）`)
    console.log('[#353] 非法补丁整批拒绝通过（不虚报、事件不发）')
  }],

  ['附加组件 T04：设置页面板通道与设置区状态权威（#353）', async () => {
    await ensureRegistered()
    // 打开生产设置页面板（隐藏即销毁重开重载——装载器随面板重生）
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页打开并就绪', async () => {
      const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
        | { open: boolean; ready: boolean } | undefined
      return info?.open && info.ready ? true : undefined
    })

    // 经设置页消息通道打开基础设置区（与 UI 按钮同款消息）
    const open = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsArea', { addonId: ADDON_ID })) as {
      open: string
      settingsAreaOpen: string | null
    }
    assert(open.open === 'ok', `打开设置区应成功，实际 ${JSON.stringify(open)}`)
    assert(open.settingsAreaOpen === ADDON_ID, '宿主设置区状态权威应记录当前打开组件')

    // 设置页消息通道的按批写入（与 UI 控件同款消息；面板在场）
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectSettingsPageMessage', {
      kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'workspace', values: { replacements: ['甲→乙', '丙→丁'], limits: { name: '真宿主', count: 5 } },
    })
    await poll('复杂值经面板通道落盘', async () => {
      const snapshot = await addonGet()
      return snapshot.sources['replacements'] === 'workspace' &&
        JSON.stringify(snapshot.values['limits']) === JSON.stringify({ name: '真宿主', count: 5 }) ? snapshot : undefined
    })

    // 关闭设置区与面板（不留状态污染）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsCloseArea')
    await vscode.commands.executeCommand('onegayi.vsidian._test.closeSettingsPage')
    console.log('[#353] 设置页面板通道与设置区状态权威通过（复杂值经生产消息链路落盘）')
  }],

  ['附加组件 T04：面板重开回显与持久层写入（重启语义见单测）（#353）', async () => {
    await ensureRegistered()
    // 先写入两层显式值（user 数组 + workspace 对象）
    await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'user', key: 'replacements', value: ['持久→层'] })
    await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'workspace', key: 'label', value: '重开回显' })
    const expected = await addonGet()

    // 关闭并重开设置页面板（retainContextWhenHidden 不开——重开即重载，
    // 回显每次以宿主权威为准）：设置区状态经 addons.settingsGet 重新拉取
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页重开并就绪', async () => {
      const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
        | { open: boolean; ready: boolean } | undefined
      return info?.open && info.ready ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectSettingsPageMessage', { kind: 'addons.settingsGet' })

    // 宿主侧权威不变（webview 回显以它为准）；两层显式值在持久层
    const reopened = await addonGet()
    assert(JSON.stringify(reopened.values['replacements']) === JSON.stringify(expected.values['replacements']), '重开后 user 层数组值保持')
    assert(reopened.values['label'] === '重开回显' && reopened.sources['label'] === 'workspace', '重开后工作区覆盖保持')
    const persisted = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsState')) as {
      userValues: Record<string, Record<string, unknown>>
      workspaceValues: Record<string, Record<string, unknown>> | null
    }
    assert(JSON.stringify(persisted.userValues[ADDON_ID]?.['replacements']) === JSON.stringify(['持久→层']), 'user 层持久值在 globalState')
    assert(persisted.workspaceValues?.[ADDON_ID]?.['label'] === '重开回显', 'workspace 层持久值在 workspaceState')

    await vscode.commands.executeCommand('onegayi.vsidian._test.closeSettingsPage')
    console.log('[#353] 面板重开回显与持久层写入通过（重启语义由单测同 store 新实例钉住）')
  }],

  ['附加组件 T04：功能开关两层与升级不重置（#353）', async () => {
    await ensureRegistered()
    // 功能开关写工作区层（覆盖默认启用）→ 生效停用；清除恢复默认启用
    const off = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabledScope', {
      addonId: ADDON_ID, scope: 'workspace', enabled: false,
    })) as { result: string; state: { addons: Array<{ id: string; enabled?: boolean }> } }
    assert(off.result === 'ok', '工作区层开关写入应成功（有工作区）')
    assert(off.state.addons.find((entry) => entry.id === ADDON_ID)?.enabled === false, '工作区覆盖后生效停用')
    const cleared = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonClearEnabledOverride', { addonId: ADDON_ID })) as {
      result: string
      state: { addons: Array<{ id: string; enabled?: boolean }> }
    }
    assert(cleared.result === 'ok' && cleared.state.addons.find((entry) => entry.id === ADDON_ID)?.enabled === true, '清除开关覆盖后恢复默认启用')

    // 升级不重置：重新注册（setup 重跑、定义替换）后存储值保持
    await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'user', key: 'threshold', value: 66 })
    await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    await poll('重新注册后 setup 重跑', async () => {
      const stats = await fixtureStats()
      return stats.setupCount >= 2 && stats.lastRegisterResult?.ok === true ? stats : undefined
    })
    const afterUpgrade = await addonGet()
    assert(afterUpgrade.values['threshold'] === 66 && afterUpgrade.sources['threshold'] === 'user', '普通升级（定义替换）不得重置存储值')
    // 恢复演示基线（不留跨用例污染）
    await vscode.commands.executeCommand(`${ADDON_ID}.updateFromAddon`, { scope: 'user', key: 'threshold', value: 20 })
    console.log('[#353] 功能开关两层与升级不重置通过')
  }],
]
