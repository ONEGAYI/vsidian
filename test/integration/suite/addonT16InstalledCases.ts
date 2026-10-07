// #365 T16 附加组件双 VSIX 安装态、重启与升级回归——真安装链用例。
//
// 与 T15（dev path 装载的公开接入端到端）的区别：被测对象是**安装链**——
// runInstalledAddons.mjs 把主 Vsidian VSIX + 三套样例 VSIX（+ 两枚负向
// 夹具 VSIX）经 CLI --install-extension 装入隔离 profile，suite 以安装解压
// 产物为 development path 运行。阶段矩阵（同一 profile 多次启动承载
// 重启/升级；env VSIDIAN_T16_PHASE 选择本阶段用例，用例体内 phaseGuard
// 自跳过其余阶段与非安装态会话）：
// - A 依赖缺失：仅装组件 VSIX（主缺席）——样例激活因缺依赖失败；
// - B 补装主 VSIX：发现注册、包内容/资源随包、默认功能（渲染自动接管、
//   输入行为、界面命令）、已开文档热接入、重复注册幂等、T12 故障全暂停
//   与手动恢复、建立跨重启持久状态（行为单项关闭 + 渲染首选 + 用户层设置）；
// - C 发行态（宿主不设 VSIDIAN_TEST_HOOKS）：_test.* 钩子缺席、公开命令
//   在场、样例默认放行（发行态无 arm 门控）与面板装载；
// - D 重启保留：B 建立的关闭选择与首选跨重启仍在且行为级生效；
// - E 升级：--force 同版本覆盖 + 0.2.0 版本升级后状态保留、无重复注册
//   （extensions 目录每 id 唯一）。
//
// 断言面与 T07-T15 同源：宿主权威状态（_test.*，仅测试阶段）+ 绘制层
// （view.state.paint）+ 文档文本 + vscode.extensions/commands 公开面
// （阶段 A/C 无钩子可用面的主体）。
import * as vscode from 'vscode'
import { existsSync, readdirSync } from 'node:fs'
import nodePath from 'node:path'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const INPUT_ID = 'vsidian-example.input-behavior'
const RENDERER_ID = 'vsidian-example.renderer'
const UI_ID = 'vsidian-example.ui-command'
const FIXTURE_INCOMPATIBLE = 'vsidian-test-fixture.addon-incompatible'
const FIXTURE_FAIL = 'vsidian-test-fixture.addon-fail'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''
const extensionsDirEnv = process.env['VSIDIAN_T16_EXTENSIONS_DIR'] ?? ''
const PHASE = process.env['VSIDIAN_T16_PHASE'] ?? ''

/** phaseGuard：当前阶段不在允许清单时自跳过（含非安装态会话——CI dev
 *  分片下这些用例以零成本通过，安装态断言只在启动器阶段会话执行） */
function phaseMatch(...allowed: string[]): boolean {
  return allowed.includes(PHASE)
}

function skipNotice(caseName: string): void {
  console.log(`[T16] 用例「${caseName}」于阶段 ${PHASE || '非安装态'}跳过（phaseGuard）`)
}

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000, diagnose?: () => Promise<string>): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      const detail = diagnose ? await diagnose().catch(() => '诊断失败') : ''
      throw new Error(`等待超时：${label}${detail ? `；${detail}` : ''}`)
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

async function waitForText(name: string, label: string, predicate: (text: string) => boolean): Promise<string> {
  return poll(label, async () => {
    const text = await docText(name)
    return predicate(text) ? text : undefined
  }, 30000, async () => `当前文本 ${JSON.stringify(await docText(name))}`)
}

/** 设置主选区光标并模拟键入（生产事务路径；仅测试钩子阶段可用） */
async function typeAt(file: string, cursor: number, text: string): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), {
    kind: 'table.test.crossSelect', anchor: cursor, head: cursor,
  })
  await new Promise((r) => setTimeout(r, 100))
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(file).toString(), {
    kind: 'table.test.domType', text,
  })
}

async function openEditorPanel(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> } | undefined
    return state?.found && state.panels.some((panel) => panel.ready) ? true : undefined
  })
}

/** 发行态（无钩子）面板打开证据：公开 tabGroups 面 Custom 标签页出现 */
async function openEditorPanelPublic(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器标签页出现（公开面）', async () => {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    return tabs.some((t) => t.input instanceof vscode.TabInputCustom) ? true : undefined
  })
}

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await new Promise((r) => setTimeout(r, 250))
}

interface RuntimeStatus {
  enabled: boolean
  runState: 'idle' | 'enabled' | 'disabled' | 'faulted'
  faultReason?: string
}

async function runtimeStatus(addonId: string): Promise<RuntimeStatus | null> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId })) as RuntimeStatus | null
}

/** 确保样例注册并 enabled（自愈先序用例状态；仅测试钩子阶段） */
async function ensureEnabled(addonId: string): Promise<void> {
  await poll('样例组件激活', async () => {
    const stats = (await vscode.commands.executeCommand(`${addonId}.stats`)) as { setupCount: number } | undefined
    return stats && stats.setupCount >= 1 ? stats : undefined
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    const status = await runtimeStatus(addonId)
    if (status?.runState === 'enabled') {
      return
    }
    if (status?.runState === 'faulted') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId })
      await vscode.commands.executeCommand(`${addonId}.releaseAndReRegister`)
    } else {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId, enabled: true })
    }
    await poll('运行态收敛 enabled', async () => {
      const next = await runtimeStatus(addonId)
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  const final = await runtimeStatus(addonId)
  assert(final?.runState === 'enabled', `样例 ${addonId} 未收敛到 enabled（${final?.runState ?? 'null'}）`)
}

/** 样例页面装载完成（面板桥 loaded 事件；仅测试钩子阶段） */
async function waitForPageLoaded(addonId: string): Promise<void> {
  await poll(`页面装载 ${addonId}`, async () => {
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ kind: string; addonId: string; ok?: boolean }>
    return events.some((e) => e.addonId === addonId && e.kind === 'outbound.loaded' && e.ok === true) ? true : undefined
  })
}

// ---- 渲染观测（测试钩子阶段） ----

interface RendererTable {
  version: number
  languages: Array<{ language: string; effective: string; source: 'user' | 'auto' }>
}

interface PaintRenderers {
  containers: Array<{ language: string; provider: string; mode: string; state: string | null; color: string | null; width: number }>
  builtinSvg: number
}

async function rendererTable(): Promise<RendererTable> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererTable')) as RendererTable
}

async function prefer(language: string, provider: string | null): Promise<{ result: string }> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererPrefer', { language, provider })) as { result: string }
}

async function rendererStore(): Promise<{ batches: Record<string, number>; preferred: Record<string, string> }> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRendererStore')) as { batches: Record<string, number>; preferred: Record<string, string> }
}

async function paintRenderers(file: string): Promise<PaintRenderers | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { renderers?: PaintRenderers } } | undefined
  return state?.paint?.renderers
}

async function waitForProviderPaint(file: string, provider: string, language: string): Promise<void> {
  await poll(`绘制层出现 ${provider} 的 ${language} 容器`, async () => {
    const probe = await paintRenderers(file)
    const hit = probe?.containers.find(
      (c) => c.provider === provider && c.language === language && c.width > 0 && c.state === 'rendered',
    )
    return hit ? true : undefined
  })
}

async function builtinTakeover(file: string): Promise<void> {
  await poll('内置接管（组件容器撤、内置 SVG 在）', async () => {
    const probe = await paintRenderers(file)
    return probe && probe.builtinSvg >= 1 && !probe.containers.some((c) => c.provider !== 'builtin') ? true : undefined
  })
}

interface AddonUiPaint {
  mountedToolbarButtonIds: string[]
  openPanelIds: string[]
}

async function addonUiPaint(file: string): Promise<AddonUiPaint | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { addonUi?: AddonUiPaint } } | undefined
  return state?.paint?.addonUi
}

// t15-input.md「文|对」键入点（'# T15 输入样例\n\n中文对照行\n'）
const TYPE_AT = 14
const KEY_SPACE = `${INPUT_ID}#cjk-latin-space`

/** 安装目录内相对文件在场性（资源随包断言；经 vscode.extensions 公开面） */
function assertInstalledFiles(addonId: string, files: string[]): void {
  const ext = vscode.extensions.getExtension(addonId)
  assert(ext !== undefined, `${addonId} 应已安装`)
  for (const file of files) {
    assert(existsSync(nodePath.join(ext.extensionPath, file)), `${addonId} 安装目录应含 ${file}（资源随包）`)
  }
}

/** extensions 目录内某扩展 id 的解压目录数（升级不重复注册的文件层证据） */
function installedDirCount(extensionId: string): number {
  assert(extensionsDirEnv !== '', 'VSIDIAN_T16_EXTENSIONS_DIR 未传入（启动器装配缺失）')
  const prefix = `${extensionId.toLowerCase()}-`
  return readdirSync(extensionsDirEnv).filter((d) => d.toLowerCase().startsWith(prefix)).length
}

export const addonT16InstalledCases: Array<[string, () => Promise<void>]> = [
  // ---- 阶段 A：依赖缺失 ----
  ['附加组件 T16：依赖缺失——仅装组件时样例不激活（#365）', async () => {
    const name = '附加组件 T16：依赖缺失——仅装组件时样例不激活（#365）'
    if (!phaseMatch('A')) {
      return skipNotice(name)
    }
    // 本阶段只有组件 VSIX 在隔离 profile 中：主扩展缺席（依赖缺失矩阵）
    assert(vscode.extensions.getExtension('onegayi.vsidian') === undefined, '主扩展应缺席（本阶段刻意未安装）')
    for (const id of [INPUT_ID, RENDERER_ID, UI_ID]) {
      const ext = vscode.extensions.getExtension(id)
      assert(ext !== undefined, `${id} 应已安装（组件 VSIX 已装入）`)
      assert(ext.isActive === false, `${id} 不应被激活`)
      // 主动激活：依赖缺失使组件 activate 拒绝（错误语义留痕——样例侧
      // getExtension(host) 为空即 throw，或宿主依赖检查先行，两者都属
      // 「依赖缺失不可用」）
      try {
        await ext.activate()
        assert(false, `${id} activate 应因缺依赖失败（实际成功）`)
      } catch (err) {
        console.log(`[T16] ${id} 依赖缺失激活错误：${String((err as Error)?.message ?? err).slice(0, 200)}`)
      }
      assert(ext.exports === undefined, `${id} 失败激活不得暴露导出`)
    }
    console.log('[#365] 阶段 A：依赖缺失——样例不激活通过')
  }],

  // ---- 阶段 B：补装主 VSIX 后的全矩阵 ----
  ['附加组件 T16：安装态发现注册与包内容资源完整（#365）', async () => {
    const name = '附加组件 T16：安装态发现注册与包内容资源完整（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    // 协调器扫描安装清单：三样例 registered、声明不兼容、激活失败三态齐备
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as {
      apiVersion: string
      addons: Array<{ id: string; status: string }>
    }
    const byId = new Map(state.addons.map((entry) => [entry.id, entry.status]))
    assert(byId.get(INPUT_ID) === 'registered', `输入样例应 registered（实际 ${byId.get(INPUT_ID) ?? 'absent'}）`)
    assert(byId.get(RENDERER_ID) === 'registered', `渲染样例应 registered（实际 ${byId.get(RENDERER_ID) ?? 'absent'}）`)
    assert(byId.get(UI_ID) === 'registered', `界面样例应 registered（实际 ${byId.get(UI_ID) ?? 'absent'}）`)
    assert(byId.get(FIXTURE_INCOMPATIBLE) === 'incompatible', `不兼容夹具应 incompatible（实际 ${byId.get(FIXTURE_INCOMPATIBLE) ?? 'absent'}）`)
    assert(byId.get(FIXTURE_FAIL) === 'activation-failed', `激活失败夹具应 activation-failed（实际 ${byId.get(FIXTURE_FAIL) ?? 'absent'}）`)
    // 主包排除面（安装解压目录的顶层形态）：无 src/test/docs/.agents/examples
    const mainExt = vscode.extensions.getExtension('onegayi.vsidian')
    assert(mainExt !== undefined, '主扩展应已安装')
    const top = readdirSync(mainExt.extensionPath)
    for (const forbidden of ['src', 'test', 'docs', '.agents', 'examples']) {
      assert(!top.includes(forbidden), `主扩展安装目录不得含 ${forbidden}/（VSIX 排除面，实际 ${JSON.stringify(top)}）`)
    }
    assert(existsSync(nodePath.join(mainExt.extensionPath, 'out', 'extension.js')), '主扩展安装目录应含 out/extension.js')
    // 组件资源完整（宿主/页面/样式真实随包）
    assertInstalledFiles(INPUT_ID, ['dist/extension.js', 'dist/editor.js'])
    assertInstalledFiles(RENDERER_ID, ['dist/extension.js', 'dist/editor.js', 'dist/editor.css'])
    assertInstalledFiles(UI_ID, ['dist/extension.js', 'dist/editor.js', 'dist/settings.js'])
    console.log('[#365] 阶段 B：安装态发现注册与包内容资源完整通过')
  }],

  ['附加组件 T16：安装态渲染自动接管与绘制层（#365）', async () => {
    const name = '附加组件 T16：安装态渲染自动接管与绘制层（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    // 真实新安装渲染自动替换：安装后无任何选择动作，mermaid-lite 接内置
    // mermaid、sampleflow 走确定性默认序（flow-plain 末位生效）
    await ensureEnabled(RENDERER_ID)
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForPageLoaded(RENDERER_ID)
    await poll('生效表 mermaid-lite/flow-plain', async () => {
      const table = await rendererTable()
      const mermaid = table.languages.find((row) => row.language === 'mermaid')
      const flow = table.languages.find((row) => row.language === 'sampleflow')
      return mermaid?.effective === `${RENDERER_ID}/mermaid-lite` && flow?.effective === `${RENDERER_ID}/flow-plain` ? table : undefined
    })
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-plain`, 'sampleflow')
    const probe = await paintRenderers('t15-render.md')
    assert((probe?.builtinSvg ?? 0) === 0, '内置 mermaid SVG 应被安装态样例接管替换')
    await vscode.commands.executeCommand(`${RENDERER_ID}.disarmProviders`)
    await closeActiveEditor()
    console.log('[#365] 阶段 B：安装态渲染自动接管与绘制层通过')
  }],

  ['附加组件 T16：安装态输入行为与界面命令（#365）', async () => {
    const name = '附加组件 T16：安装态输入行为与界面命令（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    // 输入样例：安装态行为链真实输入（atomic 空格修饰）
    await ensureEnabled(INPUT_ID)
    await vscode.commands.executeCommand(`${INPUT_ID}.armBehaviors`)
    await openEditorPanel('t15-input.md')
    await waitForPageLoaded(INPUT_ID)
    await poll('行为目录出现三条', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as Array<{ addonId: string; id: string }>
      return catalog.filter((entry) => entry.addonId === INPUT_ID).length === 3 ? catalog : undefined
    })
    await typeAt('t15-input.md', TYPE_AT, 'a')
    await waitForText('t15-input.md', '安装态自动空格插入', (t) => t.includes('文 a对'))
    await closeActiveEditor()
    // 界面样例：安装态命令执行落盘（宿主命令面板入口 → 页面回调 → views.applyEdits）
    await ensureEnabled(UI_ID)
    await vscode.commands.executeCommand(`${UI_ID}.reset`)
    await vscode.commands.executeCommand(`${UI_ID}.armUi`)
    await vscode.commands.executeCommand(`${UI_ID}.insertTimestamp`)
    await poll('安装态时间戳落盘', async () => {
      const text = await docText('t15-ui.md')
      return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text) ? true : undefined
    })
    await vscode.commands.executeCommand(`${UI_ID}.disarmUi`)
    console.log('[#365] 阶段 B：安装态输入行为与界面命令通过')
  }],

  ['附加组件 T16：已开文档热接入与停用后配置保留（#365）', async () => {
    const name = '附加组件 T16：已开文档热接入与停用后配置保留（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    await ensureEnabled(UI_ID)
    await vscode.commands.executeCommand(`${UI_ID}.armUi`)
    // 停用态打开文档：面板就绪但无组件贡献（按钮不挂载）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: UI_ID, enabled: false })
    await poll('停用收敛 disabled', async () => {
      const next = await runtimeStatus(UI_ID)
      return next?.runState === 'disabled' ? next : undefined
    })
    await openEditorPanel('t15-ui.md')
    let paint = await addonUiPaint('t15-ui.md')
    assert(paint?.mountedToolbarButtonIds.includes(`${UI_ID}.timestampBtn`) !== true, '停用态已开文档不应有组件按钮')
    // 已开文档热接入：enable 后不重开面板——wiring 推送装载指令 diff，
    // 同一页面上组件按钮热挂载（pushEditorDirectives 的 desired 对账）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: UI_ID, enabled: true })
    await poll('已开文档热接入按钮挂载', async () => {
      const next = await addonUiPaint('t15-ui.md')
      return next?.mountedToolbarButtonIds.includes(`${UI_ID}.timestampBtn`) &&
        next?.mountedToolbarButtonIds.includes(`${UI_ID}.summarizeBtn`) ? next : undefined
    }, 30000, async () => `诊断：paint=${JSON.stringify(await addonUiPaint('t15-ui.md'))}；status=${JSON.stringify(await runtimeStatus(UI_ID))}`)
    // 停用后配置保留（T04/T15 语义安装态复验）：定义与用户层值保留
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'user', values: { timestampFormat: 'date' } })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: UI_ID, enabled: false })
    await poll('停用后命令目录回收', async () => {
      const result = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonCommands')) as
        | { catalog: Array<{ addonId: string }> }
      return result.catalog.every((row) => row.addonId !== UI_ID) ? true : undefined
    })
    const stateDown = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsState')) as
      | { definitions: Record<string, unknown[]>; userValues: Record<string, Record<string, unknown>> }
    assert((stateDown.definitions[UI_ID] ?? []).length === 4, `停用后定义保留（实际 ${JSON.stringify(stateDown.definitions[UI_ID]?.length)}）`)
    assert(stateDown.userValues[UI_ID]?.['timestampFormat'] === 'date', '停用后用户层值保留')
    // 恢复（后续用例与阶段依赖 enabled 基线）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: UI_ID, enabled: true })
    await vscode.commands.executeCommand(`${UI_ID}.disarmUi`)
    await closeActiveEditor()
    console.log('[#365] 阶段 B：已开文档热接入与停用后配置保留通过')
  }],

  ['附加组件 T16：重复注册幂等与故障暂停恢复链（#365）', async () => {
    const name = '附加组件 T16：重复注册幂等与故障暂停恢复链（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    await ensureEnabled(RENDERER_ID)
    // 重复注册（组件侧 releaseAndReRegister 先 release 旧代次再建新代次；
    // 同代次重复注册的 already-registered 语义由 T01 用例钉住，此处验证
    // 安装态下代次重建收敛：状态唯一、setup 恰好推进一次）
    const before = (await vscode.commands.executeCommand(`${RENDERER_ID}.stats`)) as { setupCount: number }
    const reRegister = (await vscode.commands.executeCommand(`${RENDERER_ID}.releaseAndReRegister`)) as { ok: boolean }
    assert(reRegister?.ok === true, `安装态重注册应成功（实际 ${JSON.stringify(reRegister)}）`)
    await poll('重注册后回到 enabled', async () => {
      const next = await runtimeStatus(RENDERER_ID)
      return next?.runState === 'enabled' ? next : undefined
    })
    const after = (await vscode.commands.executeCommand(`${RENDERER_ID}.stats`)) as { setupCount: number }
    assert(after.setupCount === before.setupCount + 1, `代次重建 setup 恰好推进一次（${before.setupCount} -> ${after.setupCount}）`)
    // T12 链（安装态）：故障全暂停（贡献撤、内置接管）→ 暂停期编辑可保存
    // → 手动重试 + 组件侧重新接入 → 恢复
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await vscode.commands.executeCommand(`${RENDERER_ID}.armCrash`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: RENDERER_ID, topic: 'renderer.echo', payload: null })
    await poll('组件进入故障暂停', async () => {
      const next = await runtimeStatus(RENDERER_ID)
      return next?.runState === 'faulted' ? next : undefined
    })
    await builtinTakeover('t15-render.md')
    // 故障暂停期编辑链路保持（保存真实落盘——T12「暂停不丢工作区」语义）
    const doc = await vscode.workspace.openTextDocument(wsUri('t15-render.md'))
    const edit = new vscode.WorkspaceEdit()
    edit.insert(wsUri('t15-render.md'), new vscode.Position(doc.lineCount, 0), '故障暂停期追加行\n')
    await vscode.workspace.applyEdit(edit)
    await doc.save()
    const savedText = await docText('t15-render.md')
    assert(savedText.includes('故障暂停期追加行'), '故障暂停期编辑应可保存落盘')
    // 手动恢复：addonRetry + 组件侧重新接入
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: RENDERER_ID })
    await poll('组件侧重新接入', async () => {
      const again = (await vscode.commands.executeCommand(`${RENDERER_ID}.releaseAndReRegister`)) as { ok: boolean } | undefined
      return again?.ok === true ? true : undefined
    })
    await poll('重试后组件回到启用态', async () => {
      const next = await runtimeStatus(RENDERER_ID)
      return next?.runState === 'enabled' ? next : undefined
    })
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await vscode.commands.executeCommand(`${RENDERER_ID}.disarmProviders`)
    await closeActiveEditor()
    console.log('[#365] 阶段 B：重复注册幂等与故障暂停恢复链通过')
  }],

  ['附加组件 T16：建立跨重启持久状态（#365）', async () => {
    const name = '附加组件 T16：建立跨重启持久状态（#365）'
    if (!phaseMatch('B')) {
      return skipNotice(name)
    }
    // T08 行为单项开关：关闭输入样例的自动空格（跨重启/升级不重置的载体）
    await ensureEnabled(INPUT_ID)
    const setResult = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_SPACE], disabled: true })) as { ok?: boolean }
    assert(setResult?.ok === true, `行为单项关闭写入应成功（实际 ${JSON.stringify(setResult)}）`)
    // T09 渲染首选：sampleflow 显式选 flow-boxed（非默认 plain——重启后
    // 生效来源应为 user，绘制层为 flow-boxed）
    await ensureEnabled(RENDERER_ID)
    assert((await prefer('sampleflow', `${RENDERER_ID}/flow-boxed`)).result === 'ok', '首选 flow-boxed 写入应被接受')
    const store = await rendererStore()
    assert(store.preferred['sampleflow'] === `${RENDERER_ID}/flow-boxed`, `首选应已持久（实际 ${JSON.stringify(store.preferred)}）`)
    // UI 样例用户层设置（timestampFormat=date——B4 已写，此处读回钉住）
    const settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as
      | { values: Record<string, unknown>; sources: Record<string, string> }
    assert(settings.values['timestampFormat'] === 'date' && settings.sources['timestampFormat'] === 'user',
      `用户层 date/user 应在场（实际 ${JSON.stringify(settings)}）`)
    console.log('[#365] 阶段 B：跨重启持久状态已建立（单项关闭 + 渲染首选 + 用户层设置）')
  }],

  // ---- 阶段 C：发行态（宿主不设 VSIDIAN_TEST_HOOKS） ----
  ['附加组件 T16：发行态钩子缺席与公开命令在场（#365）', async () => {
    const name = '附加组件 T16：发行态钩子缺席与公开命令在场（#365）'
    if (!phaseMatch('C')) {
      return skipNotice(name)
    }
    const commands = await vscode.commands.getCommands(true)
    const testHooks = commands.filter((cmd) => cmd.startsWith('onegayi.vsidian._test.'))
    assert(testHooks.length === 0, `发行态不得注册 _test.* 钩子（实际 ${testHooks.length} 枚：${testHooks.slice(0, 5).join(', ')}…）`)
    assert(commands.includes('onegayi.vsidian.openSettings'), '发行态公开命令 openSettings 应在场')
    const main = vscode.extensions.getExtension('onegayi.vsidian')
    assert(main !== undefined && main.isActive, '发行态主扩展应激活')
    console.log('[#365] 阶段 C：发行态钩子缺席与公开命令在场通过')
  }],

  ['附加组件 T16：发行态样例默认生效与面板装载（#365）', async () => {
    const name = '附加组件 T16：发行态样例默认生效与面板装载（#365）'
    if (!phaseMatch('C')) {
      return skipNotice(name)
    }
    // 发行态样例默认放行（无 arm 门控——ARM_BY_DEFAULT 语义随
    // VSIDIAN_TEST_HOOKS 缺席而为 true）+ 激活注册真实发生
    const inputStats = await poll('输入样例发行态激活', async () => {
      const stats = (await vscode.commands.executeCommand(`${INPUT_ID}.stats`)) as
        | { activateCount: number; setupCount: number; behaviorsAllowed: boolean; lastRegisterResult: { ok: boolean } | null } | undefined
      return stats && stats.setupCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
    })
    assert(inputStats.behaviorsAllowed === true, '发行态输入样例应默认放行（真实安装即生效）')
    const rendererStats = await poll('渲染样例发行态激活', async () => {
      const stats = (await vscode.commands.executeCommand(`${RENDERER_ID}.stats`)) as
        | { setupCount: number; providersAllowed: boolean; lastRegisterResult: { ok: boolean } | null } | undefined
      return stats && stats.setupCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
    })
    assert(rendererStats.providersAllowed === true, '发行态渲染样例应默认放行（安装后自动接管）')
    const uiStats = await poll('界面样例发行态激活', async () => {
      const stats = (await vscode.commands.executeCommand(`${UI_ID}.stats`)) as
        | { setupCount: number; lastRegisterResult: { ok: boolean } | null } | undefined
      return stats && stats.setupCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
    })
    void uiStats
    // 发行态面板装载（公开面）：Custom 标签页出现（webview 真实装载）
    await openEditorPanelPublic('t15-render.md')
    await closeActiveEditor()
    console.log('[#365] 阶段 C：发行态样例默认生效与面板装载通过')
  }],

  // ---- 阶段 D：重启保留 ----
  ['附加组件 T16：重启不重置——单项关闭与首选保留（#365）', async () => {
    const name = '附加组件 T16：重启不重置——单项关闭与首选保留（#365）'
    if (!phaseMatch('D')) {
      return skipNotice(name)
    }
    // 行为单项关闭跨重启：持久层读回 + 键入不修饰（行为级证据）
    const persisted = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState')) as { order: string[]; disabled: string[] }
    assert(persisted.disabled.includes(KEY_SPACE), `重启后单项关闭仍在校（实际 ${JSON.stringify(persisted)}）`)
    await ensureEnabled(INPUT_ID)
    await vscode.commands.executeCommand(`${INPUT_ID}.armBehaviors`)
    await openEditorPanel('t15-input.md')
    await waitForPageLoaded(INPUT_ID)
    await typeAt('t15-input.md', TYPE_AT, 'a')
    await waitForText('t15-input.md', '重启后单项关闭仍生效（不插空格）', (t) => t.includes('文a对') && !t.includes('文 a对'))
    // 渲染首选跨重启：持久首选在场 + 生效来源 user + 绘制层 flow-boxed
    await ensureEnabled(RENDERER_ID)
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-boxed`, 'sampleflow')
    const table = await rendererTable()
    const flow = table.languages.find((row) => row.language === 'sampleflow')
    assert(flow?.effective === `${RENDERER_ID}/flow-boxed` && flow?.source === 'user', `重启后首选生效（实际 ${JSON.stringify(flow)}）`)
    const store = await rendererStore()
    assert(store.preferred['sampleflow'] === `${RENDERER_ID}/flow-boxed`, '重启后持久首选仍在校')
    // 用户层设置跨重启
    const settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as
      | { values: Record<string, unknown>; sources: Record<string, string> }
    assert(settings.values['timestampFormat'] === 'date' && settings.sources['timestampFormat'] === 'user', '重启后用户层设置保留')
    await closeActiveEditor()
    console.log('[#365] 阶段 D：重启不重置——单项关闭与首选保留通过')
  }],

  // ---- 阶段 E：升级（--force 同版本覆盖 + 0.2.0 版本升级） ----
  ['附加组件 T16：升级覆盖与版本升级后保留无重复（#365）', async () => {
    const name = '附加组件 T16：升级覆盖与版本升级后保留无重复（#365）'
    if (!phaseMatch('E')) {
      return skipNotice(name)
    }
    // 版本差异化升级落地：三样例当前版本为 0.2.0（升级口径：先装 0.1.0，
    // --force 同版本覆盖一次，再装 0.2.0——启动器阶段间执行）
    for (const id of [INPUT_ID, RENDERER_ID, UI_ID]) {
      const ext = vscode.extensions.getExtension(id)
      assert(ext !== undefined, `${id} 升级后应在场`)
      assert(ext.packageJSON['version'] === '0.2.0', `${id} 升级后版本应为 0.2.0（实际 ${JSON.stringify(ext.packageJSON['version'])}）`)
    }
    // 无重复注册（文件层）：extensions 目录每 id 恰一个解压目录
    for (const id of [INPUT_ID, RENDERER_ID, UI_ID, 'onegayi.vsidian']) {
      const count = installedDirCount(id)
      assert(count === 1, `${id} 的解压目录应唯一（实际 ${count}）`)
    }
    // 升级不重置：行为单项关闭与渲染首选仍在（存储跨升级保留）
    const persisted = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState')) as { order: string[]; disabled: string[] }
    assert(persisted.disabled.includes(KEY_SPACE), `升级后单项关闭仍在校（实际 ${JSON.stringify(persisted)}）`)
    const store = await rendererStore()
    assert(store.preferred['sampleflow'] === `${RENDERER_ID}/flow-boxed`, '升级后渲染首选仍在校')
    // 升级后新安装渲染自动替换仍生效（接管链路健康）
    await ensureEnabled(RENDERER_ID)
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-boxed`, 'sampleflow')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await closeActiveEditor()
    console.log('[#365] 阶段 E：升级覆盖与版本升级后保留无重复通过')
  }],
]
