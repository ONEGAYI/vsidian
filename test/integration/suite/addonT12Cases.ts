// #361 T12 诊断、全组件故障暂停与手动恢复——真宿主生产路径用例。
//
// 与浏览器回归（test/browser/addonT12FaultPause.mjs——真实键盘驱动的输入
// 回调故障路径）分工：本组走真宿主链路——夹具组件 vsidian-test-fixture.
// addon-t12 经公开 registerAddon 注册编辑器页，页面产物（构建桥
// t12Editor.ts）经 SDK 注册行为/命令/按钮/渲染器四通道贡献；断言面：
// - runState / faultReason（宿主 runtime 权威状态——诊断归因）；
// - _test.addonBehaviorCatalog / _test.addonCommands / _test.addonRendererTable
//   （三目录全撤与恢复——全组件暂停的贡献面）；
// - view.state.paint.renderers（绘制层：t12-box 接管、降级与内置回落）；
// - _test.addonPageEvents（装载/卸载指令与 faulted 上报留痕）；
// - 夹具 stats（armAck 确认、注册结局、通道计数）。
//
// 四态区分（票面验收第 4 条）在本组与浏览器组共同钉住：
// API 合理拒绝（重复注册）vs 业务失败（businessFail 通道返回错误对象）
// vs 自处理渲染失败（render-self-handled 画降级内容）vs 全组件停用
// （render-mount/enable 抛未捕获异常）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t12'
const T02_ID = 'vsidian-test-fixture.addon-t02'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

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

interface RuntimeStatus {
  enabled: boolean
  runState: 'idle' | 'enabled' | 'disabled' | 'faulted'
  faultReason?: string
  hasSettingsPage: boolean
}

async function runtimeStatus(addonId: string): Promise<RuntimeStatus | null> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId })) as RuntimeStatus | null
}

interface FixtureStats {
  setupCount: number
  enableCount: number
  registerCalls: number
  armAckCalls: number
  lastAckArm: string | null
  arm: string | null
  contribAllowed: boolean
  registrations: { addonId: string; outcomes: Record<string, { ok: boolean; reason?: string; commandId?: string; id?: string; key?: string }> } | null
}

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 等 arm 视图被页面确认（t12.armAck——触发故障前的确定性同步点） */
async function waitArmAck(arm: string | null): Promise<void> {
  await poll(`页面确认 arm=${arm}`, async () => {
    const stats = await fixtureStats()
    return stats.lastAckArm === arm ? true : undefined
  })
}

interface RendererTable {
  languages: Array<{ language: string; effective: string; source: string }>
}

async function rendererTable(): Promise<RendererTable> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererTable')) as RendererTable
}

interface PaintRenderers {
  containers: Array<{ provider: string; language: string; width: number; state: string }>
  builtinSvg: number
  tableVersion?: number | null
  dynamicLanguages?: string[]
}

async function paintRenderers(file: string): Promise<PaintRenderers | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { renderers?: PaintRenderers } } | undefined
  return state?.paint?.renderers
}

async function pageEvents(clear = false): Promise<Array<{ kind: string; addonId: string; ok?: boolean; reason?: string }>> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents', clear ? { clear: true } : undefined)) as Array<{ kind: string; addonId: string; ok?: boolean; reason?: string }>
}

/** 打开编辑器面板并等就绪（页面装载与面板 ready） */
async function openEditorPanel(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> } | undefined
    return state?.found && state.panels.some((panel) => panel.ready) ? true : undefined
  })
}

/**
 * 确保夹具组件 enabled 且贡献放行（setContrib 后重装载生效——防毒化
 * 门控的放行路径：release 代次 + 组件重接入 + 面板重开刷新装载）。
 */
async function ensureContribEnabled(): Promise<void> {
  await vscode.commands.executeCommand(`${ADDON_ID}.setContrib`, true)
  await vscode.commands.executeCommand(`${ADDON_ID}.clearArm`)
  let status = await runtimeStatus(ADDON_ID)
  if (status?.runState === 'faulted') {
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })
  }
  if (status?.runState !== 'enabled') {
    await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
  }
  await poll('夹具组件 enabled', async () => {
    const next = await runtimeStatus(ADDON_ID)
    return next?.runState === 'enabled' ? next : undefined
  })
}

/** 夹具组件基态恢复（用例间隔离：清 arm、退出故障、重回 enabled） */
async function recoverFixture(): Promise<void> {
  await vscode.commands.executeCommand(`${ADDON_ID}.clearArm`)
  const status = await runtimeStatus(ADDON_ID)
  if (status?.runState === 'faulted') {
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })
    await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    await poll('故障恢复 enabled', async () => {
      const next = await runtimeStatus(ADDON_ID)
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 打开 t12-fault.md 并等四通道贡献就绪（注册结局 + 生效表 + 绘制命中） */
async function openWithContributions(): Promise<void> {
  await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
  await openEditorPanel('t12-fault.md')
  await poll('页面注册结局上报', async () => {
    const stats = await fixtureStats()
    return stats.registrations !== null ? stats : undefined
  })
  await poll('生效表 t12 接管', async () => {
    const table = await rendererTable()
    return table.languages.find((row) => row.language === 't12graph' && row.effective === `${ADDON_ID}/graph`) ? true : undefined
  })
  await poll('t12-box 绘制命中', async () => {
    const probe = await paintRenderers('t12-fault.md')
    const hit = probe?.containers.find((c) => c.provider === `${ADDON_ID}/graph` && c.language === 't12graph' && c.width > 0 && c.state === 'rendered')
    return hit ? true : undefined
  }, 30000).catch(async (err) => {
    const probe = await paintRenderers('t12-fault.md')
    throw new Error(`${err.message}；诊断：containers=${JSON.stringify(probe?.containers ?? null)} tableVersion=${JSON.stringify(probe?.tableVersion ?? undefined)} dynamicLanguages=${JSON.stringify(probe?.dynamicLanguages ?? undefined)}`)
  })
}

/**
 * 重新触发 t12graph 围栏渲染（经 WorkspaceEdit 全文替换——TextDocument
 * 权威编辑经 session 写回链推送 webview，围栏区间变化驱动 widget 换新与
 * mount 重跑；fs 直写只落盘不触发 webview 重挂载——T11 先例的 fs 写均
 * 伴随面板重开，本组面板保持在场，须走编辑链）
 */
async function rewriteFenceSource(code: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(wsUri('t12-fault.md'))
  const next = doc.getText().replace('t12-source', code)
  const edit = new vscode.WorkspaceEdit()
  edit.replace(wsUri('t12-fault.md'), new vscode.Range(0, 0, doc.lineCount, 0), next)
  const applied = await vscode.workspace.applyEdit(edit)
  assert(applied, 'WorkspaceEdit 应被接受')
  await poll('盘面改写生效', async () => {
    const d = await vscode.workspace.openTextDocument(wsUri('t12-fault.md'))
    return d.getText() === next ? d : undefined
  })
}

/** 面板重开（装载代次刷新——arm 视图与贡献注册随新装载重建） */
async function reopenPanel(): Promise<void> {
  await closeAllEditors()
  await openEditorPanel('t12-fault.md')
  await poll('面板就绪并装载', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri('t12-fault.md').toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> } | undefined
    return state?.found && state.panels.some((panel) => panel.ready) ? true : undefined
  })
}

export const addonT12Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T12：四通道贡献注册与正常态（arm 视图确认机制，#361）', async () => {
    await recoverFixture()
    await ensureContribEnabled()
    await openWithContributions()

    // 注册结局：四通道全部成功（公开路径消费）
    const stats = await fixtureStats()
    const outcomes = stats.registrations!.outcomes
    assert(outcomes['behavior']?.ok === true, `行为注册应成功（${JSON.stringify(outcomes['behavior'])}）`)
    assert(outcomes['command']?.ok === true && outcomes['command']!.commandId === `${ADDON_ID}.insertStamp`, '命令注册应成功')
    assert(outcomes['button']?.ok === true && outcomes['button']!.id === `${ADDON_ID}.boomBtn`, '按钮注册应成功')
    assert(outcomes['renderer']?.ok === true, '渲染器注册应成功')

    // arm 视图机制：设置 arm → 页面经 next 应答刷新并回执确认
    await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, 'render-self-handled')
    await waitArmAck('render-self-handled')
    const acked = await fixtureStats()
    assert(acked.lastAckArm === 'render-self-handled' && acked.armAckCalls >= 1, 'armAck 确认应到达宿主')
    await vscode.commands.executeCommand(`${ADDON_ID}.clearArm`)
    await waitArmAck(null)

    // 运行态保持 enabled（arm 切换不是故障）
    const status = await runtimeStatus(ADDON_ID)
    assert(status?.runState === 'enabled', `arm 切换不应触发故障（实际 ${JSON.stringify(status)}）`)
    await closeAllEditors()
    console.log('[#361] 四通道贡献注册与 arm 视图确认机制通过')
  }],

  ['附加组件 T12：负向对照——API 拒绝、业务失败与自处理渲染失败均不触发全组件停用（#361）', async () => {
    await recoverFixture()
    await ensureContribEnabled()
    await openWithContributions()
    void pageEvents(true)

    // 1) API 合理拒绝：重复注册通道 topic（普通拒绝，不算故障）
    const dupRegister = await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: ADDON_ID, topic: 't12.next', payload: null })
    assert(dupRegister !== undefined, '通道请求应正常路由')
    void dupRegister

    // 2) 业务失败：businessFail 返回错误对象（组件错误日志形态——不是异常）
    const business = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: ADDON_ID, topic: 't12.businessFail', payload: { probe: 1 } })) as { ok: boolean; result?: unknown }
    assert(business.ok === true && (business.result as { reason?: string })?.reason === 'business-error',
      `业务失败应返回错误对象而非异常（${JSON.stringify(business)}）`)
    let status = await runtimeStatus(ADDON_ID)
    assert(status?.runState === 'enabled', `业务失败不得触发故障（实际 ${JSON.stringify(status)}）`)

    // 3) 自处理渲染失败：mount 内部 catch 自己的异常画降级内容——不停用、
    //    内置不接管（Q30：仍运行的渲染 bug 不伪造停用状态）
    await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, 'render-self-handled')
    await waitArmAck('render-self-handled')
    await rewriteFenceSource('degraded-source')
    await poll('降级内容绘制命中（自处理失败仍由组件渲染）', async () => {
      const probe = await paintRenderers('t12-fault.md')
      const hit = probe?.containers.find((c) => c.provider === `${ADDON_ID}/graph` && c.language === 't12graph' && c.width > 0)
      return hit ? true : undefined
    })
    status = await runtimeStatus(ADDON_ID)
    assert(status?.runState === 'enabled', `自处理渲染失败不得触发故障（实际 ${JSON.stringify(status)}）`)
    const table = await rendererTable()
    assert(table.languages.find((row) => row.language === 't12graph')?.effective === `${ADDON_ID}/graph`,
      '自处理失败期间生效表保持组件提供者（内置不接管）')
    const events = await pageEvents()
    assert(!events.some((e) => e.addonId === ADDON_ID && e.kind === 'outbound.faulted'), '负向对照期间不得出现 faulted 上报')

    await vscode.commands.executeCommand(`${ADDON_ID}.clearArm`)
    await closeAllEditors()
    console.log('[#361] 负向对照通过（API 拒绝/业务失败/自处理渲染失败均不停用）')
  }],

  ['附加组件 T12：渲染回调故障 → 全组件暂停，其他组件与内置不受影响（#361）', async () => {
    await recoverFixture()
    await ensureContribEnabled()
    await openWithContributions()
    // 首选钉在组件提供者（恢复场景的「原首选」基线）
    const preferResult = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererPrefer', { language: 't12graph', provider: `${ADDON_ID}/graph` })) as { result: string }
    assert(preferResult.result === 'ok', '首选组件提供者应被接受')
    await poll('首选生效', async () => {
      const table = await rendererTable()
      return table.languages.find((row) => row.language === 't12graph')?.source === 'user' ? true : undefined
    })
    void pageEvents(true)

    // 注入渲染挂载故障并触发（改写围栏源码 → 新容器 mount → 未捕获异常）
    await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, 'render-mount')
    await waitArmAck('render-mount')
    await rewriteFenceSource('boom-source')

    // 全组件暂停：宿主归因（组件 + 阶段 + 提供者 + 原因）
    const faulted = await poll('故障暂停可观察', async () => {
      const status = await runtimeStatus(ADDON_ID)
      return status?.runState === 'faulted' ? status : undefined
    })
    assert(faulted.faultReason !== undefined && faulted.faultReason.includes('renderer-mount') && faulted.faultReason.includes('graph'),
      `故障原因应归因渲染挂载（实际 ${JSON.stringify(faulted)}）`)
    assert(faulted.enabled === true, '启用偏好不被改写（用户开关保持）')

    // 贡献面全撤：行为目录、命令目录、渲染生效表
    await poll('行为目录全撤', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as Array<{ addonId: string }>
      return !catalog.some((entry) => entry.addonId === ADDON_ID) ? true : undefined
    })
    await poll('命令目录全撤', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonCommands')) as { catalog: Array<{ addonId: string }> }
      return !catalog.catalog.some((entry) => entry.addonId === ADDON_ID) ? true : undefined
    })
    await poll('生效表回内置（无候选）', async () => {
      const table = await rendererTable()
      const row = table.languages.find((r) => r.language === 't12graph')
      return row === undefined || row.effective !== `${ADDON_ID}/graph` ? true : undefined
    })
    // 绘制层：组件容器退场（t12graph 无内置管线 → 回落普通代码块）
    await poll('组件容器退场', async () => {
      const probe = await paintRenderers('t12-fault.md')
      return !probe?.containers.some((c) => c.provider === `${ADDON_ID}/graph`) ? true : undefined
    })
    // 装载器卸载指令留痕（宿主 faultRecord → 面板桥 unload 对账）
    const events = await pageEvents()
    assert(events.some((e) => e.addonId === ADDON_ID && e.kind === 'outbound.faulted'), 'faulted 上报应留痕')
    assert(events.some((e) => e.addonId === ADDON_ID && e.kind === 'directive.unload'), '卸载指令应下发本页回收')

    // 其他组件不受影响：t02 保持 enabled，内置渲染（mermaid）原样可用
    const t02 = await runtimeStatus(T02_ID)
    assert(t02 === null || t02.runState === 'enabled' || t02.runState === 'idle', `t02 不受牵连（实际 ${JSON.stringify(t02)}）`)
    const tableNow = await rendererTable()
    assert(tableNow.languages.find((row) => row.language === 'mermaid')?.effective === 'builtin', '内置 mermaid 原样生效')

    // 故障期间滞留通道请求被拒（setup/run 通道已注销——旧消息不回挂）
    const stale = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: ADDON_ID, topic: 't12.next', payload: null })) as { ok: boolean; reason?: string }
    assert(stale.ok === false, '故障期间的通道请求应被拒绝')
    await closeAllEditors()
    console.log('[#361] 渲染回调故障全组件暂停通过（贡献全撤/其他组件不受影响/旧消息拒绝）')
  }],

  ['附加组件 T12：设置排障数据面与重试失败留故障（#361）', async () => {
    await recoverFixture()
    await ensureContribEnabled()
    // 注入 enable 故障（宿主侧 arm——重试后 enable 抛）
    await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, 'enable')
    const retry1 = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })) as string
    assert(retry1 === 'ok', `重试应受理（实际 ${retry1}）`)
    await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    const failed = await poll('重试失败留故障', async () => {
      const status = await runtimeStatus(ADDON_ID)
      return status?.runState === 'faulted' ? status : undefined
    })
    assert(failed.faultReason !== undefined && failed.faultReason.includes('enable'), `重试失败原因应归因 enable（实际 ${JSON.stringify(failed)}）`)

    // 设置排障数据面：已有定义时基础设置区可打开（平台基础配置不被坏页面挡住）
    const area = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsArea', { addonId: ADDON_ID })) as { open: string; settingsAreaOpen: string | null }
    assert(area.open === 'ok', `基础设置区应可打开（实际 ${JSON.stringify(area)}）`)
    const settingsState = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsState')) as { definitions: Record<string, unknown[]> }
    assert((settingsState.definitions[ADDON_ID] ?? []).length >= 1, '故障期间设置定义保留（平台基础控件可用）')
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsCloseArea')

    // 状态列表数据面：故障原因进入 addons.state（设置页分组与排障块的数据源）
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as { addons: Array<{ id: string; enabled?: boolean; fault?: { reason: string } }> }
    const entry = state.addons.find((a) => a.id === ADDON_ID)
    assert(entry?.fault?.reason !== undefined && entry!.fault!.reason.includes('enable'), `addons.state 应带故障原因（实际 ${JSON.stringify(entry)}）`)
    assert(entry?.enabled === true, '故障组件的启用偏好保持 true（不自动改写）')

    // 偏好持久层不被改写
    const preferences = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPreferences')) as { user: Record<string, boolean> }
    assert(preferences.user[ADDON_ID] === undefined || preferences.user[ADDON_ID] === true, '启用偏好层不得被故障改写')
    await closeAllEditors()
    console.log('[#361] 设置排障数据面与重试失败留故障通过')
  }],

  ['附加组件 T12：手动重试成功恢复原首选、行为开关与贡献（旧回调不回挂，#361）', async () => {
    await recoverFixture()
    await ensureContribEnabled()
    // 预置：行为单项关闭（T08 store——恢复时保留的用户配置）
    const behaviorKey = `${ADDON_ID}#inject-mark`
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [behaviorKey], disabled: true })
    await poll('行为单项关闭落库', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState')) as { disabled: string[] }
      return state.disabled.includes(behaviorKey) ? true : undefined
    })

    await openWithContributions()
    // 首选组件提供者（原首选基线）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererPrefer', { language: 't12graph', provider: `${ADDON_ID}/graph` })

    // 注入渲染故障 → 全组件暂停
    await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, 'render-mount')
    await waitArmAck('render-mount')
    await rewriteFenceSource('boom-again')
    await poll('故障暂停', async () => {
      const status = await runtimeStatus(ADDON_ID)
      return status?.runState === 'faulted' ? status : undefined
    })
    // 首选持久层保留（store 不因故障清空）
    const storeMid = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererStore')) as { preferred: Record<string, string> }
    assert(storeMid.preferred['t12graph'] === `${ADDON_ID}/graph`, '故障期间渲染首选应保留在存储')

    // 手动重试成功路径：清 arm → retry → 组件重接入 → 贡献恢复
    await vscode.commands.executeCommand(`${ADDON_ID}.clearArm`)
    const retry = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })) as string
    assert(retry === 'ok', `重试应受理（实际 ${retry}）`)
    await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    await poll('重试后恢复 enabled', async () => {
      const status = await runtimeStatus(ADDON_ID)
      return status?.runState === 'enabled' ? status : undefined
    })
    // 面板重开刷新装载（新代次贡献重建）
    await reopenPanel()
    await poll('生效表恢复原首选', async () => {
      const table = await rendererTable()
      const row = table.languages.find((r) => r.language === 't12graph')
      return row?.effective === `${ADDON_ID}/graph` && row.source === 'user' ? true : undefined
    })
    await poll('t12-box 绘制恢复', async () => {
      const probe = await paintRenderers('t12-fault.md')
      const hit = probe?.containers.find((c) => c.provider === `${ADDON_ID}/graph` && c.language === 't12graph' && c.width > 0 && c.state === 'rendered')
      return hit ? true : undefined
    })
    // 行为目录恢复且单项开关保留（T08 存储不被故障改写）
    await poll('行为目录恢复', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as Array<{ addonId: string; id: string }>
      return catalog.some((entry) => entry.addonId === ADDON_ID && entry.id === 'inject-mark') ? true : undefined
    })
    const behaviorState = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState')) as { disabled: string[] }
    assert(behaviorState.disabled.includes(behaviorKey), '行为单项关闭应跨故障保留')

    // 清理：恢复行为默认与渲染首选（不残留到后续用例）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [behaviorKey], disabled: false })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererPrefer', { language: 't12graph', provider: null })
    await closeAllEditors()
    console.log('[#361] 手动重试成功恢复通过（原首选/行为开关/贡献恢复）')
  }],
]
