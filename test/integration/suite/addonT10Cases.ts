// #359 T10 附加组件命令、菜单与统一快捷键——真宿主生产路径用例。
//
// 与浏览器回归（test/browser/addonT10Commands.mjs——真实键盘与真实右键）
// 分工：本组走真宿主链路——夹具组件 vsidian-test-fixture.addon-t10 经公开
// registerAddon 注册编辑器页，页面产物（构建桥 t10Editor.ts）经 SDK
// commands/menus 注册命令与菜单；断言面：
// - _test.addonCommands（宿主命令目录：命令表上报/回收的宿主权威）；
// - 夹具 stats.registrations（t10.register 收件——负向拒绝 reason 码）；
// - 宿主 VSCode 命令执行（命令面板入口 → addonCommand.execute → 页面回调
//   → views.applyEdits 真实文本提交）；
// - view.state.paint.contextMenu（绘制层探针：组件菜单项在场/回收 +
//   menuClick 点击执行——宿主测试无法派发真实鼠标，注入通道与 #183 同款）；
// - _test.getKeybindings / setKeybindings（键位统一管理：绑定/清空/恢复
//   默认沿宿主权威存储；冲突拒绝不落存储）。
//
// 已知边界（如实声明）：真实键盘按键由浏览器回归承载（CDP 原生键盘）；
// 宿主真重启（reloadWindow 终止测试进程）不可集成内重放——「重启保留」
// 的存储语义由单测承载（keybindings sanitize 保留命名空间键 + KeybindingService
// 同 store 新实例既有契约），本组钉住停用回收不清用户键位（再启用沿用）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t10'
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

/** JSON 深比较断言（快照数组/对象） */
function assertSameJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`断言失败：${message}（实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`)
  }
}

interface FixtureStats {
  setupCount: number
  enableCount: number
  registerCalls: number
  nextCalls: number
  registrations: { addonId: string; outcomes: Record<string, { ok: boolean; reason?: string; commandId?: string; id?: string }> } | null
}

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 宿主命令目录（_test.addonCommands） */
async function commandCatalog(): Promise<Array<{ commandId: string; addonId: string; mode: string; writes: boolean; defaults: string[] }>> {
  const result = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonCommands')) as
    | { catalog: Array<{ commandId: string; addonId: string; mode: string; writes: boolean; defaults: string[] }> }
  return result.catalog ?? []
}

/** 确保组件注册并 enabled（自愈先序用例状态；对齐 T06 ensureEnabled 口径） */
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

/** 以基态重写盘面并打开（T06 同款时序坑收口：hot-exit backup 与 watcher 延迟） */
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

/** 等页面产物就绪（t10.register 收件——装载成功即上报）。fresh=true 先清
 *  夹具收件箱（上一用例的旧收件会立即可读，无法证明本面板装载完成） */
async function waitRegistrations(fresh = false): Promise<FixtureStats['registrations']> {
  if (fresh) {
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
  }
  try {
    return await poll('页面注册结局收件（t10.register）', async () => {
      const stats = await fixtureStats()
      return stats.registrations ?? undefined
    })
  } catch (err) {
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<Record<string, unknown>>
    const runtime = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { runState: string } | null
    const stats = await fixtureStats()
    throw new Error(`${(err as Error).message}；诊断：runtime=${JSON.stringify(runtime)} fixture=${JSON.stringify({ enableCount: stats.enableCount, registerCalls: stats.registerCalls, nextCalls: stats.nextCalls })} events=${JSON.stringify(events.slice(-12))}`)
  }
}

/** 绘制层探针里的菜单观测（开菜单后读 paint.contextMenu；menuPos 为文档偏移） */
async function openMenuAndProbe(file: string, pos: number): Promise<{ visible: boolean; separatorCount: number; addonCommands: string[] }> {
  const uri = wsUri(file).toString()
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', uri, { kind: 'contextMenu.test.contextMenu', pos })
  return poll('菜单绘制探针', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri)) as
      | { paint?: { contextMenu?: { visible: boolean; separatorCount: number; addonCommands?: string[] } } }
    const menu = state?.paint?.contextMenu
    return menu && menu.visible ? { visible: menu.visible, separatorCount: menu.separatorCount, addonCommands: menu.addonCommands ?? [] } : undefined
  })
}

export const addonT10Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T10：命令/菜单注册上报与同名/伪造身份/Tab/iconKey 明确拒绝（#359）', async () => {
    await ensureEnabled()
    await resetDocAndOpen('t10-register.md', '正文一段\n')
    const registrations = await waitRegistrations()
    assert(registrations !== null, '注册结局应上报')
    const outcomes = registrations!.outcomes

    // 正向：命名空间 ID + 默认绑定归一化
    assert(outcomes['insertStamp']?.ok === true, `insertStamp 注册应成功（${JSON.stringify(outcomes['insertStamp'])}）`)
    assert(outcomes['insertStamp']!.commandId === `${ADDON_ID}.insertStamp`, '命令 ID 应为组件命名空间')
    assert(outcomes['greet']?.ok === true && outcomes['greet']!.commandId === `${ADDON_ID}.greet`, 'greet 注册应成功')
    assert(outcomes['menuEntry']?.ok === true && outcomes['menuEntry']!.id === `${ADDON_ID}.stampEntry`, '菜单项注册应成功')

    // 负向：同名注册间接替换、局部 ID 含点（伪造跨组件/内置身份）、Tab
    // 通道、菜单 iconKey 未登记——均明确拒绝（普通 API 拒绝，组件不故障）
    assert(outcomes['dupCommand']?.ok === false && outcomes['dupCommand']!.reason === 'duplicate-command',
      `同名注册应明确拒绝（${JSON.stringify(outcomes['dupCommand'])}）`)
    assert(outcomes['dottedCommand']?.ok === false && String(outcomes['dottedCommand']!.reason).includes('dot'),
      `含点局部 ID 应明确拒绝（${JSON.stringify(outcomes['dottedCommand'])}）`)
    // #427：保留 Tab 段（裸 Tab/Shift+Tab）仍拒，ctrl+tab 修饰形态放行
    assert(outcomes['bareTabCommand']?.ok === false && String(outcomes['bareTabCommand']!.reason).includes('tab-forbidden'),
      `保留 Tab 默认绑定应明确拒绝（${JSON.stringify(outcomes['bareTabCommand'])}）`)
    assert(outcomes['modTabCommand']?.ok === true, `修饰 Tab（ctrl+tab）默认绑定应放行（${JSON.stringify(outcomes['modTabCommand'])}）`)
    assert(outcomes['badIconMenu']?.ok === false && String(outcomes['badIconMenu']!.reason).includes('icon-key'),
      `未登记 iconKey 应明确拒绝（${JSON.stringify(outcomes['badIconMenu'])}）`)

    // 宿主命令目录：两条命令（上报门控接受——enabled 态）
    const catalog = await poll('宿主命令目录含组件命令', async () => {
      const list = await commandCatalog()
      return list.some((entry) => entry.commandId === `${ADDON_ID}.insertStamp`) ? list : undefined
    })
    const greet = catalog.find((entry) => entry.commandId === `${ADDON_ID}.greet`)
    assert(greet !== undefined, 'greet 应在宿主命令目录')
    assert(greet!.mode === 'both' && greet!.writes === false && greet!.defaults.includes('ctrl+alt+g'),
      `目录载荷应保真（${JSON.stringify(greet)}）`)

    // 负向拒绝不进目录（被拒的 tabbed/dotted/dup 无条目；放行的 tabbed-mod 在场）
    assert(!catalog.some((entry) => entry.commandId.endsWith('.tabbed') || entry.commandId.includes('evil')),
      '被拒注册不得进宿主命令目录')
    assert(catalog.some((entry) => entry.commandId === `${ADDON_ID}.tabbed-mod`), '放行的修饰 Tab 命令应进目录')
    await closeAllEditors()
    console.log('[#359] 命令/菜单注册上报与负向拒绝通过')
  }],

  ['附加组件 T10：命令面板执行真实业务、菜单绘制与点击执行、模式门控（#359）', async () => {
    await ensureEnabled()
    const file = 't10-execute.md'
    const BASE = '正文一段\n'
    // 清夹具收件箱须在装载**之前**：新面板装载即上报 t10.register，收件到达
    // 即证明本面板组件装载完成（装载后清会把新收件一并清掉）
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await resetDocAndOpen(file, BASE)
    await waitRegistrations()

    // 1) 命令面板入口：宿主 VSCode 命令（addonCommandService 注册）→ 活动面板
    //    转发 → 页面回调 → views.applyEdits 真实提交
    const executed = (await vscode.commands.executeCommand(`${ADDON_ID}.insertStamp`)) as boolean
    assert(executed === true, '宿主命令执行应投递到活动面板')
    await poll('文本提交落盘（dirty）', async () => {
      const after = await docText(file)
      return after.text.includes('T10-STAMP') && after.dirty ? after : undefined
    })
    await (await vscode.workspace.openTextDocument(wsUri(file))).save()

    // 2) 菜单绘制层：组件簇在场（组件命令出现在统一菜单）+ 内置三簇不受影响
    const menu = await openMenuAndProbe(file, BASE.indexOf('正文'))
    assert(menu.addonCommands.includes(`${ADDON_ID}.insertStamp`),
      `组件菜单项应出现在绘制层探针（实际 ${JSON.stringify(menu.addonCommands)}）`)
    assert(menu.separatorCount >= 3, `组件簇应追加分隔线（实际 ${menu.separatorCount} 条，内置 2 + 组件 1）`)

    // 3) 菜单点击执行（注入通道与用户点击同一处理器）：再次真实提交
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(),
      { kind: 'contextMenu.test.menuClick', command: `${ADDON_ID}.insertStamp` })
    await poll('菜单点击的文本提交', async () => {
      const after = await docText(file)
      return after.text.split('T10-STAMP').length - 1 >= 2 ? after : undefined
    })
    await (await vscode.workspace.openTextDocument(wsUri(file))).save()

    // 4) 模式门控：阅读态下 live 写命令不执行（webview 按声明模式复核）；
    //    切换走宿主三态命令（与用户命令面板同一入口）
    const uri = wsUri(file).toString()
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri(file))
    await poll('切换阅读态', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri, 0)) as
        | { viewMode?: string } | undefined
      return state?.viewMode === 'reading' ? true : undefined
    }).catch(async (err: Error) => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri, 0)) as
        | Record<string, unknown> | undefined
      throw new Error(`${err.message}；诊断 viewState=${JSON.stringify(state).slice(0, 500)}`)
    })
    const beforeReading = await docText(file)
    await vscode.commands.executeCommand(`${ADDON_ID}.insertStamp`)
    await new Promise((r) => setTimeout(r, 600))
    const afterReading = await docText(file)
    assert(afterReading.text === beforeReading.text, '阅读态下 live 写命令不得执行（模式门控）')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri(file))
    await poll('切回 live', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri, 0)) as
        | { viewMode?: string } | undefined
      return state?.viewMode === 'live' ? true : undefined
    })
    await closeAllEditors()
    console.log('[#359] 命令面板执行、菜单绘制与点击、模式门控通过')
  }],

  ['附加组件 T10：统一快捷键管理——绑定/清空/恢复默认沿宿主权威存储、冲突拒绝（#359）', async () => {
    await ensureEnabled()
    const file = 't10-keybindings.md'
    await resetDocAndOpen(file, '正文\n')
    await waitRegistrations()
    // 基态：清空本用例涉及的键（防跨用例污染）
    await vscode.commands.executeCommand('onegayi.vsidian._test.resetKeybindings')

    // 1) 绑定：组件命令进同一键位存储（keybindings.set 沿设置页服务链路）
    const setOk = (await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings',
      `${ADDON_ID}.insertStamp`, ['ctrl+alt+f7'], false)) as { ok: boolean }
    assert(setOk.ok === true, `组件命令绑定应成功（${JSON.stringify(setOk)}）`)
    let snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot[`${ADDON_ID}.insertStamp`], ['ctrl+alt+f7'], '绑定应落宿主权威存储')

    // 2) 冲突拒绝：绑内置粗体占用键（ctrl+b，live 模式重叠）不带
    //    replaceConflicts → 拒绝且存储不变
    const conflict = (await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings',
      `${ADDON_ID}.insertStamp`, ['ctrl+b'], false)) as { ok: boolean; reason?: string; conflicts?: string[] }
    assert(conflict.ok === false && conflict.reason === 'conflict', `冲突应明确拒绝（${JSON.stringify(conflict)}）`)
    assert((conflict.conflicts ?? []).includes('bold'), '冲突对象应含内置粗体（跨内置/组件两族的冲突检查）')
    snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot[`${ADDON_ID}.insertStamp`], ['ctrl+alt+f7'], '冲突拒绝不得改写存储')

    // 3) 显式清空：空数组落存储（不因组件回收/再启用自动恢复）
    await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings', `${ADDON_ID}.insertStamp`, [], false)
    snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot[`${ADDON_ID}.insertStamp`], [], '显式清空应存空数组（语义=明确禁用）')

    // 4) 恢复默认：单键 reset 语义经 set(默认绑定) 表达（宿主侧等价链），
    //    恢复后生效绑定回到 greet 的 ctrl+alt+g——注意 insertStamp 默认未绑定，
    //    此处改用 greet 验证「恢复默认」路径
    await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings', `${ADDON_ID}.greet`, [], false)
    snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot[`${ADDON_ID}.greet`], [], 'greet 显式清空落存储')
    // 恢复默认 = 移除覆盖键（缺省跟随注册默认——keybindings.reset 单键语义）
    await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings', `${ADDON_ID}.insertStamp`, [], true)
    await vscode.commands.executeCommand('onegayi.vsidian._test.resetKeybindings')
    snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot, {}, '全部恢复默认应清空用户覆盖（含组件命令键）')
    await closeAllEditors()
    console.log('[#359] 统一快捷键管理（绑定/冲突/清空/恢复）通过')
  }],

  ['附加组件 T10：停用回收自己的命令与菜单、键位保留、再启用恢复、内置不受影响（#359）', async () => {
    await ensureEnabled()
    const file = 't10-recycle.md'
    await resetDocAndOpen(file, '正文一段\n')
    await waitRegistrations()
    // 预置用户键位（回收不清——停用后再启用沿用、重启保留的存储语义）
    await vscode.commands.executeCommand('onegayi.vsidian._test.setKeybindings', `${ADDON_ID}.insertStamp`, ['ctrl+alt+f7'], false)

    // 1) 普通关闭：撤下自己的命令与菜单
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用后宿主命令目录清空', async () => {
      const catalog = await commandCatalog()
      return catalog.every((entry) => entry.addonId !== ADDON_ID) ? catalog : undefined
    })
    // 宿主 VSCode 命令已注销：executeCommand 拒绝（command not found）
    let unregistered = false
    try {
      await vscode.commands.executeCommand(`${ADDON_ID}.insertStamp`)
    } catch {
      unregistered = true
    }
    assert(unregistered, '停用后宿主命令应注销（命令面板不再可达）')
    // 菜单：组件项撤下、内置三簇原样
    const menu = await openMenuAndProbe(file, '正文一段'.indexOf('正'))
    assert(!menu.addonCommands.some((command) => command.startsWith(`${ADDON_ID}.`)),
      `停用后组件菜单项应撤下（实际 ${JSON.stringify(menu.addonCommands)}）`)
    assert(menu.separatorCount >= 2, `内置簇分隔线应保留（实际 ${menu.separatorCount}）`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), { kind: 'contextMenu.test.menuClose' })
    // 键位保留（停用回收不清用户绑定）
    const snapshot = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshot[`${ADDON_ID}.insertStamp`], ['ctrl+alt+f7'], '停用回收不得清用户键位（重启/再启用保留）')

    // 2) 再启用：命令目录与菜单恢复（面板重装载组件页面产物重新注册）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    await poll('再启用后命令恢复', async () => {
      const catalog = await commandCatalog()
      return catalog.some((entry) => entry.commandId === `${ADDON_ID}.insertStamp`) ? catalog : undefined
    })
    // 键位沿用（预置绑定仍在）
    const snapshotAfter = (await vscode.commands.executeCommand('onegayi.vsidian._test.getKeybindings')) as Record<string, string[]>
    assertSameJson(snapshotAfter[`${ADDON_ID}.insertStamp`], ['ctrl+alt+f7'], '再启用后用户键位应沿用')

    // 3) 收尾：清键位防跨用例污染
    await vscode.commands.executeCommand('onegayi.vsidian._test.resetKeybindings')
    await closeAllEditors()
    console.log('[#359] 停用回收（命令/菜单撤下、键位保留、再启用恢复）通过')
  }],
]
