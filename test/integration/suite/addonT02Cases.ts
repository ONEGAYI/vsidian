// #351 T02 附加组件页面 SDK 与两生命周期——真宿主生产路径用例。
//
// 与 V02 探针（addonV02Probe，自带双面板验证件）不同：本组走**生产装配**
// ——真实 CustomTextEditorProvider 打开 .md（生产 main.js 装载器 + 生产
// Compartment 槽）与生产设置页面板（生产 settingsMain 装载器）；夹具组件
// vsidian-test-fixture.addon-t02 以附加 development path 装载（宿主 CJS 与
// 浏览器产物分开装配），其页面产物由 runTest.mjs 经 V02 构建桥生成后拷入
// 夹具安装目录（资源授权锚）。
//
// 断言面：
// - view.state.addonPage 探针（生产 webview 装载器观测：活跃代次/授权
//   样式表/释放历史/拒收计数——宿主经 _test.requestViewState 拉取）；
// - _test.addonPageEvents 面板桥事件（指令推送与出站结局留痕）；
// - 夹具 stats（setup/enable/通道计数）与 runtime 状态命令；
// - 绘制层证据：组件 ViewPlugin 在真宿主 Chromium 内读自己标记的计算
//   背景色（getComputedStyle）经通道上报——「用户看到的颜色」级断言。
//
// 用例边界（如实声明，不以集成冒充）：
// - 真实键盘/IME 输入不丢格由浏览器套件钉住（test:browser）；
// - 「重启后停用保持」的重启语义由单元测试「同 store 新实例」钉住
//   （addonRuntime.test.ts），此处钉住「偏好写入持久层」。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t02'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

interface FixtureStats {
  activateCount: number
  setupCount: number
  enableCount: number
  disposeCount: number
  echoCalls: number
  settingsEchoCalls: number
  reportCalls: number
  docStateCalls: number
  lastReport: { topic?: string; ok?: boolean; echoed?: unknown; docLength?: number; markColor?: string; logoLoaded?: boolean } | null
  reportsLog: Array<{ topic?: string; ok?: boolean; echoed?: unknown; logoLoaded?: boolean }>
  lastDocState: { docLength?: number; markColor?: string } | null
  lastRegisterResult: { ok: boolean; reason?: string } | null
}

interface AddonPageProbe {
  cm6Shared: boolean
  active: Array<{ addonId: string; generation: number }>
  cssLinksActive: number
  history: Array<{ addonId: string; generation: number; ended: string; reason?: string; disposals?: number }>
  counters: Record<string, number>
}

interface BridgeEvent {
  panel: 'editor' | 'settings'
  kind: string
  addonId: string
  generation?: number
  ok?: boolean
  reason?: string
  topic?: string
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

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 超时诊断快照：夹具计数 + 面板桥事件 + 运行态（定位「卡在哪个环节」） */
async function diagnose(): Promise<string> {
  const [stats, events, status] = await Promise.all([
    fixtureStats(),
    bridgeEvents(),
    vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID }) as Promise<unknown>,
  ])
  return JSON.stringify({
    stats: {
      setupCount: stats.setupCount, enableCount: stats.enableCount, disposeCount: stats.disposeCount,
      echoCalls: stats.echoCalls, settingsEchoCalls: stats.settingsEchoCalls, reportCalls: stats.reportCalls,
      docStateCalls: stats.docStateCalls, lastReport: stats.lastReport, lastDocState: stats.lastDocState,
    },
    runtime: status,
    events: events.filter((e) => e.addonId === ADDON_ID).slice(-12),
  })
}

/** poll 包装：超时错误附带诊断快照 */
async function pollDiag<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  try {
    return await poll(label, fn, timeoutMs)
  } catch (err) {
    throw new Error(`${(err as Error).message}；诊断：${await diagnose()}`)
  }
}

/** 组件激活与注册收敛（协调器异步唤醒——用例不假定先序用例已激活） */
async function ensureRegistered(): Promise<void> {
  await poll('夹具组件激活并注册', async () => {
    const stats = await fixtureStats()
    return stats.setupCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
  })
}

/** 确保运行态为 enabled（自愈先序用例留下的停用/故障态；faulted 须经
 *  手动重新接入恢复——本函数按需驱动） */
async function ensureEnabled(): Promise<void> {
  await ensureRegistered()
  for (let attempt = 0; attempt < 3; attempt++) {
    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { runState: string; enabled: boolean } | null
    if (status === null) {
      throw new Error('runtime 状态缺失（组件未注册）')
    }
    if (status.runState === 'enabled') {
      return
    }
    if (status.runState === 'faulted') {
      // 手动重新接入：release 旧代次 + 组件重新注册（故障不自动重试）
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId: ADDON_ID })
      await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    } else {
      // idle（停用偏好残留）或 disabled：打开用户开关
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    }
    await poll('运行态收敛为 enabled', async () => {
      const next = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  throw new Error('运行态未能恢复 enabled（三次自愈尝试后）')
}

async function bridgeEvents(): Promise<BridgeEvent[]> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as BridgeEvent[]
}

async function clearBridgeEvents(): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents', { clear: true })
}

/** 生产编辑器面板的装载器探针（view.state.addonPage；面板未开时 undefined） */
async function editorProbe(file: string): Promise<AddonPageProbe | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { addonPage?: AddonPageProbe } | undefined
  return state?.addonPage
}

/** 打开生产编辑器并等待装载器观测到组件活跃装载 */
async function openEditorAndWaitLoad(file: string): Promise<{ generation: number; probe: AddonPageProbe }> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
  })
  const probe = await poll('装载器观测组件活跃装载', async () => {
    const next = await editorProbe(file)
    const active = next?.active.find((entry) => entry.addonId === ADDON_ID)
    return active ? { generation: active.generation, probe: next! } : undefined
  })
  return probe
}

async function closeEditor(file: string): Promise<void> {
  // 循环关闭该文档的全部编辑器 tab（跨用例面板残留清场——closeActiveEditor
  // 只关当前活动 tab；多面板残留会让装载指令对账跨面板不确定）
  for (let i = 0; i < 5; i++) {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean }
    if (!state.found) {
      return
    }
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await new Promise((r) => setTimeout(r, 150))
  }
}

export const addonT02Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T02：两生命周期注册与编辑器页生产装载（#351）', async () => {
    await ensureEnabled()
    const stats = await fixtureStats()
    assert(stats.setupCount >= 1 && stats.enableCount >= 1,
      `默认启用下 setup 与 enable 均应执行（setup ${stats.setupCount} / enable ${stats.enableCount}）`)
    // 实验能力声明兼容：夹具声明 experimental.cm6 ^1.0.0 且注册成功
    assert(stats.lastRegisterResult?.ok === true, '声明 cm6 实验入口的兼容组件注册应成功')

    await clearBridgeEvents()
    const { probe } = await openEditorAndWaitLoad('lf.md')
    // 装载器观测：cm6 共享运行时注入 + 授权样式表在场（组件自己的 CSS）
    assert(probe.cm6Shared === true, '编辑器页装载器应注入共享 CM6 运行时')
    assert(probe.cssLinksActive >= 1, `授权样式表应至少 1 条在场，实际 ${probe.cssLinksActive}`)

    // 面板桥事件：装载指令已推送且出站结局 ok（真实 webview 装载完成）
    await pollDiag('装载事件收敛', async () => {
      const events = await bridgeEvents()
      const load = events.find((e) => e.panel === 'editor' && e.kind === 'directive.load' && e.addonId === ADDON_ID)
      const loaded = events.find((e) => e.panel === 'editor' && e.kind === 'outbound.loaded' && e.addonId === ADDON_ID && e.ok === true)
      return load && loaded ? { load, loaded } : undefined
    })

    // 通道闭环：组件挂载即发 t02.echo（run scope）→ 宿主 handler 应答 →
    // 组件把回执结局经 t02.report 上报（宿主侧全链路可数）
    const echoReport = await pollDiag('run scope 通道回执确认上报', async () => {
      const s = await fixtureStats()
      const hit = s.reportsLog.find((r) => r.topic === 'echo' && r.ok === true)
      return s.echoCalls >= 1 && hit ? hit : undefined
    })
    const echoed = echoReport.echoed as { echoed?: { phase?: string }; scope?: string } | null
    assert(echoed?.scope === 'run' && echoed?.echoed?.phase === 'mounted',
      `回执应来自 run scope handler 且载荷往返完整，实际 ${JSON.stringify(echoed)}`)

    // 绘制层证据：组件标记的计算背景色（真宿主 Chromium 内组件授权样式
    // 实际生效——「用户看到的颜色」级断言，非 DOM 存在性）。组件在装饰
    // 绘制后的下一帧读计算色经 t02.docState 上报（夹具收件箱可数）
    const docState = await pollDiag('绘制层计算色上报', async () => {
      const s = await fixtureStats()
      return s.lastDocState?.markColor === 'rgb(0, 200, 120)' ? s.lastDocState : undefined
    })
    assert((docState?.docLength ?? 0) > 0, `docState 应携带装载时刻文档长度，实际 ${JSON.stringify(docState)}`)
    console.log('[#351] 两生命周期注册与编辑器页生产装载通过（通道闭环 + 绘制层计算色）')
  }],

  ['附加组件 T02：手动停用释放运行贡献、设置能力保留（#351）', async () => {
    await ensureEnabled()
    // 清场：销毁先序用例留下的编辑器 tab（宿主侧路由随 onDidDispose 回收，
    // 面板装载器随 webview 消亡）——本用例开全新面板保证对账确定性
    await closeEditor('lf.md')
    await openEditorAndWaitLoad('lf.md')
    const before = await fixtureStats()
    await clearBridgeEvents()

    // 用户关闭功能开关：运行贡献释放（desired 清空 → unload 推送）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    // 事件面先行采样（#367 修复：共享会话多组件并存成为常态——T06–T11
    // 夹具与 T15 样例的通道短轮询会持续刷新 addonPageEvents 环形缓冲
    //（最近 200 条），迟到采样可能把 t02 的 unload/unloaded 记录挤出；
    // 停用后立即轮询，采到即固化到局部变量，后续断言不再依赖缓冲留存）
    const events = await pollDiag('卸载事件收敛', async () => {
      const all = await bridgeEvents()
      const unload = all.find((e) => e.panel === 'editor' && e.kind === 'directive.unload' && e.addonId === ADDON_ID)
      const unloaded = all.find((e) => e.panel === 'editor' && e.kind === 'outbound.unloaded' && e.addonId === ADDON_ID && e.ok === true)
      return unload && unloaded ? all : undefined
    })
    // 装载面清空（#367 修复：多组件常态下 cssLinksActive 汇总其他活跃
    // 组件的授权样式表、不再归零——断言收敛为按组件观测：t02 退出
    // active 且 history 留有 released 终结记录；样式表随 release 撤下
    // 由装载器释放路径承担（addonPageLoader 单测钉住））
    await pollDiag('停用后装载面清空', async () => {
      const probe = await editorProbe('lf.md')
      const released = probe?.history.some((h) => h.addonId === ADDON_ID && h.ended === 'released')
      return probe && !probe.active.some((entry) => entry.addonId === ADDON_ID) && released ? probe : undefined
    })
    assert(events.some((e) => e.panel === 'editor' && e.kind === 'directive.unload'), '停用应推送 unload 指令')

    // 清理回调执行（enable 作用域释放证据）；setup 贡献保留（不重跑）
    await pollDiag('enable 作用域清理回调执行', async () => {
      const s = await fixtureStats()
      return s.disposeCount === before.disposeCount + 1 ? s : undefined
    })
    const disabled = await fixtureStats()
    assert(disabled.setupCount === before.setupCount, '停用不得重跑 setup（设置生命周期独立）')

    // 设置能力保留：状态可观察 + setup scope 通道仍服务 + 设置页可打开
    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { enabled: boolean; runState: string; hasSettingsPage: boolean }
    assert(status?.enabled === false && status?.runState === 'disabled', `停用态应可观察，实际 ${JSON.stringify(status)}`)
    assert(status?.hasSettingsPage === true, '停用后设置页入口应保留')
    const outcome = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', {
      addonId: ADDON_ID, topic: 't02.settingsEcho', payload: { phase: 'probe' },
    })) as { ok: boolean; result?: { scope?: string } }
    assert(outcome.ok === true && outcome.result?.scope === 'setup', `停用后 setup 通道应仍服务，实际 ${JSON.stringify(outcome)}`)

    // 重新启用：enable 重跑、代次递增（新代次装载）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    const reloaded = await pollDiag('重新启用后新代次装载', async () => {
      const probe = await editorProbe('lf.md')
      const active = probe?.active.find((entry) => entry.addonId === ADDON_ID)
      return active ? { generation: active.generation, history: probe!.history } : undefined
    })
    const after = await fixtureStats()
    assert(after.enableCount === before.enableCount + 1, `重新启用应重跑 enable，实际 ${after.enableCount}（前 ${before.enableCount}）`)
    assert(reloaded.history.some((h) => h.addonId === ADDON_ID && h.ended === 'released'), '释放历史应留痕 released')
    console.log('[#351] 手动停用释放运行贡献、设置能力保留通过（新代次重新装载）')
  }],

  ['附加组件 T02：可归因回调异常暂停全部贡献与手动重新接入（#351）', async () => {
    await ensureEnabled()
    // 面板装载在场（故障后的 unload 与装载面清空断言需要活跃面板）
    await closeEditor('lf.md')
    await openEditorAndWaitLoad('lf.md')
    const before = await fixtureStats()
    await clearBridgeEvents()

    // 故障注入：通道 handler 抛错 → 可归因回调异常 → 全组件故障暂停
    await vscode.commands.executeCommand(`${ADDON_ID}.armEchoCrash`)
    const outcome = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', {
      addonId: ADDON_ID, topic: 't02.echo', payload: { phase: 'crash' },
    })) as { ok: boolean; reason?: string }
    assert(outcome.ok === false && outcome.reason === 'rejected', '失败请求不得虚报成功')

    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { runState: string; enabled: boolean; faultReason?: string } | null
    assert(status?.runState === 'faulted', `回调异常应触发故障暂停，实际 ${JSON.stringify(status)}`)
    assert((status?.faultReason ?? '').includes('armed crash'), `故障原因应可观察（含异常原文），实际 ${JSON.stringify(status?.faultReason)}`)
    assert(status?.enabled === true, '故障暂停不改写用户启用偏好')

    // 全部注册贡献暂停：运行装载面清空 + enable 作用域清理回调执行 +
    // setup 通道不可服务 + 设置页不可打开（页面代码撤下）
    await pollDiag('故障后装载面清空', async () => {
      const probe = await editorProbe('lf.md')
      return probe && !probe.active.some((entry) => entry.addonId === ADDON_ID) ? probe : undefined
    })
    await pollDiag('enable 作用域清理回调执行', async () => {
      const s = await fixtureStats()
      return s.disposeCount === before.disposeCount + 1 ? s : undefined
    })
    const setupOutcome = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', {
      addonId: ADDON_ID, topic: 't02.settingsEcho', payload: {},
    })) as { ok: boolean }
    assert(setupOutcome.ok === false, '故障暂停后 setup 通道不得继续服务')
    const openResult = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonOpenSettingsPage', { addonId: ADDON_ID })) as string
    assert(openResult === 'faulted', `故障暂停时设置页应不可打开，实际 ${openResult}`)

    // addons.state 呈现：故障原因随载荷可观察（基础原因状态）
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as {
      addons: Array<{ id: string; fault?: { reason: string } }>
    }
    const entry = state.addons.find((item) => item.id === ADDON_ID)
    assert(entry?.fault?.reason !== undefined && entry.fault.reason.includes('armed crash'),
      `addons.state 应携带故障原因，实际 ${JSON.stringify(entry)}`)

    // 手动重新接入（故障不自动重试）：释放旧代次 + 组件重新注册 → 恢复
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId: ADDON_ID })
    const reRegister = (await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)) as { ok: boolean }
    assert(reRegister.ok === true, '手动重新注册应成功')
    await poll('重新接入后恢复 enabled', async () => {
      const next = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return next?.runState === 'enabled' ? next : undefined
    })
    // 重新注册后 setup 重跑（新代次）且编辑器装载面恢复（若面板在场）
    const after = await fixtureStats()
    assert(after.setupCount === before.setupCount + 1, '手动重新接入应重跑 setup（新代次）')
    console.log('[#351] 可归因回调异常暂停全部贡献与手动重新接入通过')
  }],

  ['附加组件 T02：组件设置页装载、JSON 通信与关闭释放（#351）', async () => {
    await ensureEnabled()
    await clearBridgeEvents()

    // 打开生产设置页面板（隐藏即销毁重开重载——装载器随面板重生）
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页打开并就绪', async () => {
      const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
        | { open: boolean; ready: boolean } | undefined
      return info?.open && info.ready ? true : undefined
    })

    // 打开组件自己的设置页：设置页面板装载组件页面产物（每页自己的 URI）
    const openResult = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonOpenSettingsPage', { addonId: ADDON_ID })) as string
    assert(openResult === 'ok', `打开组件设置页应成功，实际 ${openResult}`)
    await pollDiag('设置页装载指令与结局收敛', async () => {
      const events = await bridgeEvents()
      const load = events.find((e) => e.panel === 'settings' && e.kind === 'directive.load' && e.addonId === ADDON_ID)
      const loaded = events.find((e) => e.panel === 'settings' && e.kind === 'outbound.loaded' && e.addonId === ADDON_ID && e.ok === true)
      return load && loaded ? events : undefined
    })

    // 设置页通道闭环：组件装载即发 t02.settingsEcho（setup scope）→ 宿主
    // handler 应答 → 回执结局经 t02.report 上报；授权图片装载结局随上报
    // 回执确认在 reportsLog 中查（lastReport 单值会被并发的 settingsLogo
    // 上报覆盖——图片 load 完成晚于通道回执是正常时序）
    await pollDiag('设置页通道回执确认上报', async () => {
      const s = await fixtureStats()
      return s.settingsEchoCalls >= 1 && s.reportsLog.some((r) => r.topic === 'settingsEcho' && r.ok === true) ? s : undefined
    })
    await pollDiag('授权资源（logo.png）装载结局上报', async () => {
      const s = await fixtureStats()
      return s.reportsLog.some((r) => r.topic === 'settingsLogo' && r.logoLoaded === true) ? s : undefined
    })

    // addons.state 呈现当前打开的组件设置页（设置页分页挂载区依据）
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as {
      openAddonSettingsPage?: string | null
    }
    assert(state.openAddonSettingsPage === ADDON_ID, `载荷应携带当前打开的组件设置页，实际 ${JSON.stringify(state.openAddonSettingsPage)}`)

    // 关闭组件设置页：装载意图终结 → unload 推送 → 装载器释放
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonCloseSettingsPage')
    await pollDiag('设置页卸载事件收敛', async () => {
      const events = await bridgeEvents()
      const unload = events.find((e) => e.panel === 'settings' && e.kind === 'directive.unload' && e.addonId === ADDON_ID)
      const unloaded = events.find((e) => e.panel === 'settings' && e.kind === 'outbound.unloaded' && e.addonId === ADDON_ID && e.ok === true)
      return unload && unloaded ? true : undefined
    })
    const closed = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as {
      openAddonSettingsPage?: string | null
    }
    assert(closed.openAddonSettingsPage === null || closed.openAddonSettingsPage === undefined,
      `关闭后载荷不应再携带打开项，实际 ${JSON.stringify(closed.openAddonSettingsPage)}`)

    await vscode.commands.executeCommand('onegayi.vsidian._test.closeSettingsPage')
    console.log('[#351] 组件设置页装载、JSON 通信与关闭释放通过')
  }],

  ['附加组件 T02：停用偏好持久层写入（重启语义由单测钉住）（#351）', async () => {
    await ensureEnabled()
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用生效', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { enabled: boolean } | null
      return status?.enabled === false ? status : undefined
    })
    // 偏好写入用户默认层（globalState）——「用户关闭选择持久保留」的落盘面；
    // 重启后新 runtime 读同层不再 enable 的语义由 addonRuntime.test.ts 的
    // 「同 store 新实例」用例钉住（真重启不在集成用例能力内，如实声明）
    const preferences = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPreferences')) as
      | { user: Record<string, boolean>; workspace: Record<string, boolean> | null }
    assert(preferences.user[ADDON_ID] === false, `停用偏好应写入用户默认层，实际 ${JSON.stringify(preferences)}`)

    // 恢复启用（不留污染给后续用例）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await poll('恢复启用', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return status?.runState === 'enabled' ? status : undefined
    })
    await closeEditor('lf.md')
    console.log('[#351] 停用偏好持久层写入通过（重启语义见 addonRuntime.test.ts）')
  }],
]
