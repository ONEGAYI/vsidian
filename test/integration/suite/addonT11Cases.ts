// #360 T11 附加组件按钮、面板与视图界面贡献——真宿主生产路径用例。
//
// 与浏览器回归（test/browser/addonT11Ui.mjs——真实点击与绘制层）分工：
// 本组走真宿主链路——夹具组件 vsidian-test-fixture.addon-t11 经公开
// registerAddon 注册编辑器页，页面产物（构建桥 t11Editor.ts）经 SDK ui
// 面注册按钮与面板；断言面：
// - 夹具 stats.registrations（t11.register 收件——负向拒绝 reason 码）；
// - view.state.paint.addonUi（绘制层探针：按钮/面板的注册态、挂载态与
//   elementFromPoint 绘制命中——样式注入失效时 DOM 在场但命中失败）；
// - _test.postToPanel 的 addonUi.test.buttonClick / panelClose 注入通道
//   （宿主测试无法派发真实鼠标——与用户点击同一处理器）；
// - 夹具 ops（openPanel/panelState/lateWrite——回收矩阵与迟到结果）。
//
// 已知边界（如实声明）：真实鼠标点击与嵌入 B 焦点路由由浏览器回归承载
// （Playwright 真实点击/焦点）；本组验证真宿主内的注册、绘制、执行转发
// 与全部退出路径回收。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t11'
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

interface FixtureStats {
  setupCount: number
  enableCount: number
  registerCalls: number
  registrations: { addonId: string; outcomes: Record<string, { ok: boolean; reason?: string; commandId?: string; id?: string }> } | null
}

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 绘制层探针里的组件界面观测（view.state.paint.addonUi） */
async function addonUiPaint(file: string): Promise<{
  toolbarButtonIds: string[]
  mountedToolbarButtonIds: string[]
  openPanelIds: string[]
  buttonVisible: boolean | null
  panelBodyVisible: boolean | null
} | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { addonUi?: { toolbarButtonIds: string[]; mountedToolbarButtonIds: string[]; openPanelIds: string[]; buttonVisible: boolean | null; panelBodyVisible: boolean | null } } } | undefined
  return state?.paint?.addonUi
}

async function postToPanel(file: string, message: unknown): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), message)
}

/** 夹具指令（queue + collect 单条配对） */
async function runFixtureOp<T>(op: string): Promise<T | undefined> {
  await vscode.commands.executeCommand(`${ADDON_ID}.queue`, op)
  const results = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, 15000)) as Array<{ seq: number; outcome: T }>
  return results[0]?.outcome
}

/** 确保组件注册并 enabled（对齐 T10 ensureEnabled 口径） */
async function ensureEnabled(): Promise<void> {
  await poll('夹具组件激活', async () => {
    const stats = await fixtureStats()
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

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 以基态重写盘面并打开（T10 同款时序坑收口：hot-exit backup 与 watcher 延迟） */
async function resetDocAndOpen(file: string, content: string): Promise<void> {
  await closeAllEditors()
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
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
  })
}

async function docText(file: string): Promise<{ text: string; dirty: boolean }> {
  const doc = await vscode.workspace.openTextDocument(wsUri(file))
  return { text: doc.getText(), dirty: doc.isDirty }
}

/** 等页面产物就绪（t11.register 收件——装载成功即上报；fresh 先清收件箱） */
async function waitRegistrations(fresh = false): Promise<FixtureStats['registrations']> {
  if (fresh) {
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
  }
  return poll('页面注册结局收件（t11.register）', async () => {
    const stats = await fixtureStats()
    return stats.registrations ?? undefined
  })
}

export const addonT11Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T11：按钮/面板注册上报与负向拒绝、绘制层挂载可见（#360）', async () => {
    await ensureEnabled()
    await resetDocAndOpen('t11-register.md', '正文一段\n')
    const registrations = await waitRegistrations()
    assert(registrations !== null, '注册结局应上报')
    const outcomes = registrations!.outcomes

    // 正向：命名空间 ID（平台注入形态）
    assert(outcomes['stampBtn']?.ok === true && outcomes['stampBtn']!.id === `${ADDON_ID}.stampBtn`,
      `stampBtn 注册应成功（${JSON.stringify(outcomes['stampBtn'])}）`)
    assert(outcomes['cmdBtn']?.ok === true, 'cmdBtn（挂接命令）注册应成功')
    assert(outcomes['liveOnlyBtn']?.ok === true, 'liveOnlyBtn（声明模式）注册应成功')
    assert(outcomes['notesPanel']?.ok === true && outcomes['notesPanel']!.id === `${ADDON_ID}.notes`, '面板注册应成功')
    assert(outcomes['livePanel']?.ok === true, 'live-only 面板注册应成功')

    // 负向：同名按钮/槽位白名单外（不能挂内置界面）/动作二选一冲突/同名面板
    assert(outcomes['dupButton']?.ok === false && String(outcomes['dupButton']!.reason).includes('duplicate-button'),
      `同名按钮应明确拒绝（${JSON.stringify(outcomes['dupButton'])}）`)
    assert(outcomes['slotButton']?.ok === false && String(outcomes['slotButton']!.reason).includes('slot'),
      `槽位白名单外应明确拒绝（${JSON.stringify(outcomes['slotButton'])}）`)
    assert(outcomes['conflictButton']?.ok === false && String(outcomes['conflictButton']!.reason).includes('action-conflict'),
      `command 与 onClick 并给应明确拒绝（${JSON.stringify(outcomes['conflictButton'])}）`)
    assert(outcomes['dupPanel']?.ok === false && String(outcomes['dupPanel']!.reason).includes('duplicate-panel'),
      `同名面板应明确拒绝（${JSON.stringify(outcomes['dupPanel'])}）`)

    // 绘制层：三按钮挂载且绘制命中（样式注入失效时 buttonVisible 为 false）
    const paint = await poll('组件按钮绘制命中', async () => {
      const probe = await addonUiPaint('t11-register.md')
      return probe && probe.mountedToolbarButtonIds.includes(`${ADDON_ID}.stampBtn`) &&
        probe.buttonVisible === true ? probe : undefined
    })
    assert(paint.mountedToolbarButtonIds.includes(`${ADDON_ID}.cmdBtn`), `命令按钮应挂载（实际 ${JSON.stringify(paint.mountedToolbarButtonIds)}）`)
    assert(paint.mountedToolbarButtonIds.includes(`${ADDON_ID}.liveOnlyBtn`), 'live 态下 live-only 按钮应挂载')
    assert(paint.openPanelIds.length === 0, '面板默认关闭（无打开面板）')
    await closeAllEditors()
    console.log('[#360] 注册上报、负向拒绝与绘制层挂载通过')
  }],

  ['附加组件 T11：按钮执行真实业务、面板开闭生命周期与迟到结果不可见（#360）', async () => {
    await ensureEnabled()
    const file = 't11-execute.md'
    const BASE = '正文一段\n'
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await resetDocAndOpen(file, BASE)
    await waitRegistrations()

    // 1) 按钮点击（注入通道与用户点击同一处理器）：onClick 回调经 target
    //    句柄提交文本——作用于正确目标文档（主正文）
    await postToPanel(file, { kind: 'addonUi.test.buttonClick', buttonId: `${ADDON_ID}.stampBtn` })
    await poll('按钮文本提交落盘（dirty）', async () => {
      const after = await docText(file)
      return after.text.includes('T11-BTN') && after.dirty ? after : undefined
    })
    await (await vscode.workspace.openTextDocument(wsUri(file))).save()

    // 2) 面板打开：mount 收 target（主正文句柄）、内容绘制命中
    const opened = await runFixtureOp<{ opened: boolean }>('openPanel')
    assert(opened?.opened === true, `面板应打开（${JSON.stringify(opened)}）`)
    const paintOpen = await poll('面板内容绘制命中', async () => {
      const probe = await addonUiPaint(file)
      return probe && probe.openPanelIds.includes(`${ADDON_ID}.notes`) &&
        probe.panelBodyVisible === true ? probe : undefined
    })
    assert(paintOpen.openPanelIds.length === 1, `仅 notes 面板打开（实际 ${JSON.stringify(paintOpen.openPanelIds)}）`)
    const state1 = await runFixtureOp<{ open: boolean; targetSeen: Array<string | null> }>('panelState')
    assert(state1?.open === true && state1.targetSeen.at(-1) === 'main',
      `mount 的 target 应解析主正文（${JSON.stringify(state1)}）`)

    // 3) 用户关闭路径（面板 chrome 关闭按钮注入）：容器移除、开态翻转
    await postToPanel(file, { kind: 'addonUi.test.panelClose', panelId: `${ADDON_ID}.notes` })
    await poll('面板关闭后开态清空', async () => {
      const probe = await addonUiPaint(file)
      return probe && !probe.openPanelIds.includes(`${ADDON_ID}.notes`) ? probe : undefined
    })

    // 4) 迟到结果：close 后组件往保留的根引用写入——dock 内不可见
    const late = await runFixtureOp<{ ok: boolean; connected: boolean }>('lateWrite')
    assert(late?.ok === true && late.connected === false,
      `迟到写入应落在已脱挂的根（${JSON.stringify(late)}——结构上不可见）`)
    await poll('面板标题不在 DOM（迟到内容不可见）', async () => {
      const probe = await addonUiPaint(file)
      return probe && probe.openPanelIds.length === 0 ? probe : undefined
    })
    await closeAllEditors()
    console.log('[#360] 按钮执行、面板生命周期与迟到结果不可见通过')
  }],

  ['附加组件 T11：模式切换回收矩阵——不符按钮撤挂、不符面板强制关闭、切回恢复（#360）', async () => {
    await ensureEnabled()
    const file = 't11-mode.md'
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await resetDocAndOpen(file, '正文\n')
    await waitRegistrations()
    const uri = wsUri(file).toString()

    // live 态打开 live-only 面板
    const opened = await runFixtureOp<{ opened: boolean }>('openLivePanel')
    assert(opened?.opened === true, 'live 态 live-only 面板应可打开')

    // 切阅读：live-only 按钮撤挂（注册保留）、live-only 面板强制关闭
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri(file))
    await poll('切换阅读态', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri, 0)) as
        | { viewMode?: string } | undefined
      return state?.viewMode === 'reading' ? true : undefined
    })
    const readingPaint = await poll('阅读态撤挂与关面板', async () => {
      const probe = await addonUiPaint(file)
      return probe && !probe.mountedToolbarButtonIds.includes(`${ADDON_ID}.liveOnlyBtn`) &&
        !probe.openPanelIds.includes(`${ADDON_ID}.livePanel`) ? probe : undefined
    })
    // both 声明的按钮仍在场（不受模式影响）
    assert(readingPaint.mountedToolbarButtonIds.includes(`${ADDON_ID}.stampBtn`),
      `both 按钮应常驻（实际 ${JSON.stringify(readingPaint.mountedToolbarButtonIds)}）`)
    assert(readingPaint.toolbarButtonIds.includes(`${ADDON_ID}.liveOnlyBtn`), '注册保留（撤挂≠注销）')

    // 面板 target 语义：阅读态（主正文 reading、无嵌入）动态解析返回只读
    // 主句柄——mount 不可用（面板已关），此处验证面板 state 收口即可
    const readingState = await runFixtureOp<{ open: boolean; livePanelOpen: boolean }>('panelState')
    assert(readingState?.livePanelOpen === false, 'live-only 面板应保持关闭')

    // 切回 live：live-only 按钮重挂、面板保持关闭（不自动复活）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri(file))
    await poll('切回 live', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri, 0)) as
        | { viewMode?: string } | undefined
      return state?.viewMode === 'live' ? true : undefined
    })
    await poll('live-only 按钮重挂', async () => {
      const probe = await addonUiPaint(file)
      return probe && probe.mountedToolbarButtonIds.includes(`${ADDON_ID}.liveOnlyBtn`) ? probe : undefined
    })
    const liveState = await runFixtureOp<{ livePanelOpen: boolean }>('panelState')
    assert(liveState?.livePanelOpen === false, '切回后面板不得自动复活（需组件显式再开）')
    await closeAllEditors()
    console.log('[#360] 模式切换回收矩阵通过')
  }],

  ['附加组件 T11：嵌入 B 焦点路由——按钮与面板 target 操作归 B 不误改父 A（#360）', async () => {
    await ensureEnabled()
    await closeAllEditors()
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    // p204 fixture：父文档嵌入 p204-编辑目标（内部 Live 随父 live 继承）
    await vscode.commands.executeCommand('vscode.openWith', wsUri('p204-编辑嵌入.md'), VIEW_TYPE)
    await poll('编辑器面板就绪', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri('p204-编辑嵌入.md').toString())) as
        | { found: boolean; panels: { ready: boolean }[] }
      return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
    })
    // 页面产物就绪（counters 幂等探测——面板装载即组件在场）
    await poll('页面产物就绪', () => runFixtureOp('counters').then((r) => r !== undefined ? true : undefined, () => undefined))
    // 等嵌入内部 Live 绑定（端口就绪 → embed 句柄注册）
    await poll('内部 Live 绑定', async () => {
      const view = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri('p204-编辑嵌入.md').toString(), 0)) as
        | { readingEmbed?: Array<{ inner: string; liveBound?: boolean }> } | undefined
      const cards = view?.readingEmbed?.filter((c) => c.inner === 'p204-编辑目标') ?? []
      return cards.length >= 1 && cards.every((c) => c.liveBound === true) ? cards : undefined
    })
    const parentUri = wsUri('p204-编辑嵌入.md').toString()
    const parentBefore = (await docText('p204-编辑嵌入.md')).text

    // 1) 聚焦嵌入 B（embed.test.focus——真实焦点落 B 的内部 Live）
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', parentUri, {
      kind: 'embed.test.focus', inner: 'p204-编辑目标',
    })
    await new Promise((r) => setTimeout(r, 200))

    // 2) 按钮点击（onClick 目标路由）：T11-BTN 落 B、父 A 全程不变
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', parentUri, {
      kind: 'addonUi.test.buttonClick', buttonId: `${ADDON_ID}.stampBtn`,
    })
    const targetAfter = await poll('B 收到按钮提交', async () => {
      const d = await docText('p204-编辑目标.md')
      return d.text.includes('T11-BTN') ? d : undefined
    })
    const parentAfter = await docText('p204-编辑嵌入.md')
    assert(parentAfter.text === parentBefore, '按钮在嵌入 B 中操作不得改动父文档 A')

    // 3) 面板 target()（动态解析）：焦点仍在 B 时经面板句柄提交 T11-TARGET
    const opened = await runFixtureOp<{ opened: boolean }>('openPanel')
    assert(opened?.opened === true, `面板应打开（${JSON.stringify(opened)}）`)
    const state = await runFixtureOp<{ open: boolean; targetSeen: Array<string | null> }>('panelState')
    assert(state?.open === true && state.targetSeen.at(-1)?.startsWith('embed:'),
      `面板 target 在嵌入焦点下应解析 embed 句柄（${JSON.stringify(state)}）`)
    await runFixtureOp('insertViaTarget')
    await poll('B 收到面板 target 提交', async () => {
      const d = await docText('p204-编辑目标.md')
      return d.text.includes('T11-TARGET') ? d : undefined
    })
    const parentFinal = await docText('p204-编辑嵌入.md')
    assert(parentFinal.text === parentBefore, '面板操作归 B——父文档 A 全程不变')

    // 收尾：B 的写入不回滚（fixtures.mjs 每轮重写盘面；writeFile 与 VSCode
    // 持有的文档句柄冲突 EBUSY——本轮集成实测）
    await closeAllEditors()
    assert(targetAfter.text.includes('T11-BTN'), 'B 文本断言（保留证据）')
    console.log('[#360] 嵌入 B 焦点路由（按钮/面板 target 归 B、父 A 不变）通过')
  }],

  ['附加组件 T11：停用回收全部挂载、再启用恢复、内置界面不受影响（#360）', async () => {
    await ensureEnabled()
    const file = 't11-recycle.md'
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await resetDocAndOpen(file, '正文一段\n')
    await waitRegistrations()
    // 预置打开面板（停用回收须连面板一起收）
    await runFixtureOp('openPanel')
    await poll('面板打开预置', async () => {
      const probe = await addonUiPaint(file)
      return probe && probe.openPanelIds.includes(`${ADDON_ID}.notes`) ? probe : undefined
    })

    // 1) 普通关闭：撤全部按钮与面板（本页闭环——不依赖宿主消息到达）。
    //    期望态本身是 paint.addonUi === undefined（零注册时探针缺省）——poll
    //    完成判据须映射为哨兵 true，不能直接返回探针值（undefined 会被 poll
    //    当作「未就绪」永远等待）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用后组件界面全撤', async () => {
      const probe = await addonUiPaint(file)
      const cleared = probe === undefined ||
        (probe.toolbarButtonIds.length === 0 && probe.openPanelIds.length === 0)
      return cleared ? true : undefined
    })
    // 内置工具栏不受影响（chrome 探针仍命中——工具栏容器与内置按钮原样）
    const chromeProbe = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
      | { cssProbe?: { chromeSelectors?: Record<string, string | null> } } | undefined
    assert(chromeProbe?.cssProbe?.chromeSelectors?.['toolbar'] === 'rgb(228, 0, 1)',
      `停用后内置工具栏探针应原样命中（实际 ${JSON.stringify(chromeProbe?.cssProbe?.chromeSelectors?.['toolbar'])}）`)

    // 2) 再启用：按钮恢复挂载（面板保持关闭——需组件显式再开）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await poll('再启用后按钮恢复', async () => {
      const probe = await addonUiPaint(file)
      return probe && probe.mountedToolbarButtonIds.includes(`${ADDON_ID}.stampBtn`) ? probe : undefined
    })
    await closeAllEditors()
    console.log('[#360] 停用回收（按钮/面板全撤、内置不受影响、再启用恢复）通过')
  }],
]
