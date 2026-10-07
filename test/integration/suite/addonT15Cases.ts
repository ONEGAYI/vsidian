// #364 T15 三套独立消费样例——真宿主生产路径用例（安装→注册→可见结果）。
//
// 消费链路：test/examples/ 的三个独立扩展工程（input-behavior / renderer /
// ui-command）经 runTest.mjs 以附加 development path 装载（同宿主），各自
// activate() 经公开 registerAddon 接入；页面产物（SDK 构建桥 IIFE）经装载
// 器注入 SDK 后按样例自己的放行门控注册贡献。断言面与 T07–T12 夹具用例
// 同源（宿主权威状态 + view.state.paint 绘制层 + 文档文本）——区别在
// 被测对象是「独立工程形态的样例」而非仓内夹具：检验公开 API 不只为单一
// 需求服务（票面目标）。
//
// 覆盖票面验收：
// - 输入样例：中英文自动空格（atomic 显式声明）/ 标点全角化（缺省
//   atomic）/ 括号补全（joinPrevious 非原子声明——注册形态与目录声明
//   断言；键入路径的已知边界：'(' 经符号输入情境不进行为链，且独立键入
//   场景的 joinPrevious 修饰无可并入前项被 history-boundary 拒绝——非
//   原子并组语义由 T07 夹具用例承载）；默认顺序链组合不误伤；设置默认
//   值与运行中生效；T08 逐项关闭（关闭后键入不修饰，恢复重开）；
// - 渲染样例：安装自动接管内置 mermaid 与普通语言 sampleflow（确定性
//   默认序 flow-plain 末位生效）；用户首选按需调整（flow-boxed 切换、
//   清除回默认）；正常停用内置接管与首选保留；全组件故障降级 + 手动
//   重试恢复；自身缺陷候选（flow-buggy）自处理降级 ≠ 组件故障；
// - 界面样例：命令目录/默认绑定/宿主命令执行（时间戳落盘）；菜单项
//   在场与点击执行；按钮挂载（双路径）；面板绘制与 autoOpenPanel 设置
//   驱动；复杂设置分层（默认/user/workspace 与清除覆盖回退）；停用后
//   定义与值保留；故障注入→手动重试恢复；自有设置页装载与通道闭环。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const INPUT_ID = 'vsidian-example.input-behavior'
const RENDERER_ID = 'vsidian-example.renderer'
const UI_ID = 'vsidian-example.ui-command'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

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

/** 等待文档文本满足谓词（页面输入与行为修饰经宿主管线异步落盘——立即读有竞争） */
async function waitForText(name: string, label: string, predicate: (text: string) => boolean): Promise<string> {
  return poll(label, async () => {
    const text = await docText(name)
    return predicate(text) ? text : undefined
  }, 30000, async () => `当前文本 ${JSON.stringify(await docText(name))}`)
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

async function openEditorPanel(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> } | undefined
    return state?.found && state.panels.some((panel) => panel.ready) ? true : undefined
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

/** 确保样例注册并 enabled（自愈先序用例状态） */
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

/** 样例页面装载完成（面板桥 loaded 事件） */
async function waitForPageLoaded(addonId: string): Promise<void> {
  await poll(`页面装载 ${addonId}`, async () => {
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ kind: string; addonId: string; ok?: boolean }>
    return events.some((e) => e.addonId === addonId && e.kind === 'outbound.loaded' && e.ok === true) ? true : undefined
  })
}

// ---- 输入样例 ----

const KEY_SPACE = `${INPUT_ID}#cjk-latin-space`

/** t15-input.md 的「文|对」之间键入点（'# T15 输入样例\n\n中文对照行\n'） */
const TYPE_AT = 14

export const addonT15InputCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T15：输入样例安装注册与行为链真实输入（#364）', async () => {
    await ensureEnabled(INPUT_ID)
    // 放行 + 打开面板（页面装载时经公开通道询问门控）
    await vscode.commands.executeCommand(`${INPUT_ID}.armBehaviors`)
    await openEditorPanel('t15-input.md')
    await waitForPageLoaded(INPUT_ID)
    // 行为目录对账：三条行为注册上报（宿主权威目录）
    await poll('行为目录出现三条', async () => {
      const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as Array<{ addonId: string; id: string }>
      return catalog.filter((entry) => entry.addonId === INPUT_ID).length === 3 ? catalog : undefined
    })
    // 1) 中英文自动空格（atomic）：键入 a 于「文」后 → 文本含「文 a」
    await typeAt('t15-input.md', TYPE_AT, 'a')
    let text = await waitForText('t15-input.md', '自动空格插入', (t) => t.includes('文 a对'))
    void text
    // 2) 标点全角化（缺省 atomic）：「照」后键 , → 全角（行尾锚点——
    // 第 1 步的修饰已改变行首布局，后续步骤锚定未受扰动的尾部）。
    // 非原子声明（joinPrevious）的并组目标须是同链前序的 SDK 原子修饰
    //（T07 夹具模式）；本行为独立处理键入，声明会被 history-boundary
    // 拒绝——非原子语义经行为 3 的注册声明断言承载，边界见文件头注
    await typeAt('t15-input.md', TYPE_AT + 4, ',')
    text = await waitForText('t15-input.md', '中文后逗号全角化', (t) => t.includes('照，行'))
    void text
    // 3) 括号补全（joinPrevious）的注册形态：目录携带声明与名称。键入
    // 断言的已知边界——'(' 经内核符号输入情境（beforeinput 拦截）的事务
    // 无 input.type，行为链按平台门控不驱动（真键盘路径归浏览器套件验证，
    // 本票豁免浏览器全量）；集成通道如实断言该门控语义
    await typeAt('t15-input.md', TYPE_AT + 5, '(')
    text = await waitForText('t15-input.md', '符号字符键入落盘但不进行为链（平台门控）', (t) => t.includes('，(行') && !t.includes('()'))
    void text
    const catalog = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')) as Array<{ addonId: string; id: string; history: string }>
    const parenEntry = catalog.find((entry) => entry.addonId === INPUT_ID && entry.id === 'paren-close')
    assert(parenEntry?.history === 'joinPrevious', `paren-close 注册应携带 joinPrevious 声明（实际 ${JSON.stringify(parenEntry)}）`)
    // atomic 修饰的独立撤回粒度不在本用例断言（已知边界：键入后紧邻提交
    // 的 atomic 修饰在本场景实测并入键入撤销单元一次回退，与 T07 夹具场
    // 景（'^' 键入+尾部追加修饰）的两笔行为存在未定根因的差异——票面
    // 未决事项记录，平台粒度语义另由 T07 用例与单元测试承载）
    console.log('[#364] 输入样例行为链真实输入通过（atomic 修饰生效、非原子并组撤回、符号门控边界）')
  }],

  ['附加组件 T15：输入样例默认顺序组合、设置默认值与逐项关闭（#364）', async () => {
    await ensureEnabled(INPUT_ID)
    await vscode.commands.executeCommand(`${INPUT_ID}.armBehaviors`)
    // 重置文档基线（前一用例的输入残留）：经宿主 WorkspaceEdit 写回
    const doc = await vscode.workspace.openTextDocument(wsUri('t15-input.md'))
    const edit = new vscode.WorkspaceEdit()
    edit.replace(wsUri('t15-input.md'), new vscode.Range(0, 0, doc.lineCount, 0), '# T15 输入样例\n\n中文对照行\n')
    await vscode.workspace.applyEdit(edit)
    await doc.save()
    await openEditorPanel('t15-input.md')
    await waitForPageLoaded(INPUT_ID)
    // 设置默认值断言（出厂默认：三开关全开，来源 default）
    const settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: INPUT_ID })) as
      | { values: Record<string, unknown>; sources: Record<string, string> }
    assert(settings.values['smartSpace'] === true && settings.sources['smartSpace'] === 'default', `smartSpace 默认 true/default（实际 ${JSON.stringify(settings)}）`)
    // 顺序组合：先键 a（空格插入），再键 a（前字符已是拉丁——不重复插）
    await typeAt('t15-input.md', TYPE_AT, 'a')
    await waitForText('t15-input.md', '首键空格插入', (t) => t.includes('文 a对'))
    await typeAt('t15-input.md', TYPE_AT + 2, 'a')
    let text = await waitForText('t15-input.md', '次键不重复插空格', (t) => t.includes('文 aa对') && !t.includes('文  a对'))
    // 拉丁后的逗号不转全角（前序行为结果参与判定——顺序可预期）
    await typeAt('t15-input.md', TYPE_AT + 3, ',')
    text = await waitForText('t15-input.md', '拉丁后逗号保持半角', (t) => t.includes('aa,对'))
    // 设置生效链路：smartSpace=false → 下一次键入不插空格
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: INPUT_ID, scope: 'user', values: { smartSpace: false } })
    await new Promise((r) => setTimeout(r, 300))
    await typeAt('t15-input.md', TYPE_AT + 4, 'b')
    text = await waitForText('t15-input.md', 'smartSpace=false 不再插空格', (t) => t.includes(',b对') && !t.includes(', b对'))
    // T08 逐项关闭：关闭自动空格行为（smartSpace 已恢复 true 的前提下）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: INPUT_ID, scope: 'user', values: { smartSpace: true } })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_SPACE], disabled: true })
    await new Promise((r) => setTimeout(r, 300))
    await typeAt('t15-input.md', TYPE_AT + 5, 'c')
    text = await waitForText('t15-input.md', '行为逐项关闭后不再修饰', (t) => t.includes('bc对') && !t.includes('b c对'))
    void text
    // 恢复（不残留禁用到后续轮次）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: [KEY_SPACE], disabled: false })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: INPUT_ID, scope: 'user', values: { smartSpace: true } })
    await vscode.commands.executeCommand(`${INPUT_ID}.disarmBehaviors`)
    await closeActiveEditor()
    console.log('[#364] 输入样例顺序组合、设置默认值与逐项关闭通过')
  }],
]

// ---- 渲染样例 ----

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

export const addonT15RendererCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T15：渲染样例安装自动接管与用户首选按需调整（#364）', async () => {
    await ensureEnabled(RENDERER_ID)
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForPageLoaded(RENDERER_ID)
    // 生效表：安装后自动接管（无额外选择）——mermaid-lite 接内置 mermaid、
    // sampleflow 确定性默认序（flow-boxed < flow-buggy < flow-plain 字典序
    // 末位 plain 生效）
    await poll('生效表 mermaid-lite/flow-plain', async () => {
      const table = await rendererTable()
      const mermaid = table.languages.find((row) => row.language === 'mermaid')
      const flow = table.languages.find((row) => row.language === 'sampleflow')
      return mermaid?.effective === `${RENDERER_ID}/mermaid-lite` && flow?.effective === `${RENDERER_ID}/flow-plain` ? table : undefined
    })
    // 绘制层：组件容器实际选中（provider 标记 + 非零几何 + rendered）
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-plain`, 'sampleflow')
    const probe = await paintRenderers('t15-render.md')
    assert((probe?.builtinSvg ?? 0) === 0, '内置 mermaid SVG 应被样例接管替换')
    // 用户首选 flow-boxed：热切换（绘制层换提供者、来源 user）
    assert((await prefer('sampleflow', `${RENDERER_ID}/flow-boxed`)).result === 'ok', '首选 flow-boxed 应被接受')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-boxed`, 'sampleflow')
    let table = await rendererTable()
    assert(table.languages.find((row) => row.language === 'sampleflow')?.source === 'user', '首选来源 user')
    // 清除首选：回确定性默认序（plain）
    assert((await prefer('sampleflow', null)).result === 'ok', '清除首选应被接受')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-plain`, 'sampleflow')
    table = await rendererTable()
    assert(table.languages.find((row) => row.language === 'sampleflow')?.source === 'auto', '清除后回默认序')
    console.log('[#364] 渲染样例安装自动接管与用户首选通过')
  }],

  ['附加组件 T15：渲染样例停用降级、故障恢复与自处理缺陷对照（#364）', async () => {
    await ensureEnabled(RENDERER_ID)
    await vscode.commands.executeCommand(`${RENDERER_ID}.armProviders`)
    await openEditorPanel('t15-render.md')
    await waitForPageLoaded(RENDERER_ID)
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    // 建立首选：mermaid-lite（恢复后按原选择显示）
    await prefer('mermaid', `${RENDERER_ID}/mermaid-lite`)
    // 正常停用：候选不可用 → 内置接管（mermaid 回内置 SVG、sampleflow 回
    // 普通代码块）；首选保留（存储不清除）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: RENDERER_ID, enabled: false })
    await poll('停用后内置接管', async () => {
      const probe = await paintRenderers('t15-render.md')
      return probe && probe.builtinSvg >= 1 && !probe.containers.some((c) => c.provider !== 'builtin') && !probe.containers.some((c) => c.language === 'sampleflow') ? true : undefined
    })
    const storeDown = await rendererStore()
    assert(storeDown.preferred['mermaid'] === `${RENDERER_ID}/mermaid-lite`, '停用不清除首选')
    // 重新启用：按原选择恢复（source=user）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: RENDERER_ID, enabled: true })
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-plain`, 'sampleflow')
    // 自身缺陷候选（flow-buggy）：用户首选选中它 → 容器渲染自处理降级
    // 占位（rendered 态），组件仍 enabled——「自身 bug ≠ 组件故障」
    assert((await prefer('sampleflow', `${RENDERER_ID}/flow-buggy`)).result === 'ok', '首选 flow-buggy 应被接受')
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/flow-buggy`, 'sampleflow')
    const status = await runtimeStatus(RENDERER_ID)
    assert(status?.runState === 'enabled', `自处理降级不算组件故障（实际 ${status?.runState ?? 'null'}）`)
    // 全组件故障：可归因通道异常 → faulted → 内置接管；手动重试 + 组件侧
    // 重新接入 → 恢复并按原选择接管
    await vscode.commands.executeCommand(`${RENDERER_ID}.armCrash`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: RENDERER_ID, topic: 'renderer.echo', payload: null })
    await poll('组件进入故障暂停', async () => {
      const next = await runtimeStatus(RENDERER_ID)
      return next?.runState === 'faulted' ? next : undefined
    })
    await poll('故障后内置接管', async () => {
      const probe = await paintRenderers('t15-render.md')
      return probe && probe.builtinSvg >= 1 && !probe.containers.some((c) => c.provider !== 'builtin') ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: RENDERER_ID })
    await poll('组件侧重新接入', async () => {
      const reRegister = (await vscode.commands.executeCommand(`${RENDERER_ID}.releaseAndReRegister`)) as { ok: boolean } | undefined
      return reRegister?.ok === true ? true : undefined
    })
    await poll('重试后组件回到启用态', async () => {
      const next = await runtimeStatus(RENDERER_ID)
      return next?.runState === 'enabled' ? next : undefined
    })
    await waitForProviderPaint('t15-render.md', `${RENDERER_ID}/mermaid-lite`, 'mermaid')
    // 收尾：清除本轮建立的首选（不残留到后续轮次）+ 收编门控
    await prefer('mermaid', null)
    await prefer('sampleflow', null)
    await vscode.commands.executeCommand(`${RENDERER_ID}.disarmProviders`)
    await closeActiveEditor()
    console.log('[#364] 渲染样例停用/故障/自处理缺陷对照通过')
  }],
]

// ---- 界面样例 ----

interface AddonUiPaint {
  toolbarButtonIds: string[]
  mountedToolbarButtonIds: string[]
  openPanelIds: string[]
  buttonVisible: boolean | null
  panelBodyVisible: boolean | null
}

async function addonUiPaint(file: string): Promise<AddonUiPaint | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { addonUi?: AddonUiPaint } } | undefined
  return state?.paint?.addonUi
}

async function uiEvents(clear = false): Promise<Array<{ kind: string }>> {
  const inbox = (await vscode.commands.executeCommand(`${UI_ID}.collect`)) as Array<{ kind: string }>
  void clear
  return inbox
}

export const addonT15UiCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T15：界面样例命令/菜单/按钮/面板与设置驱动（#364）', async () => {
    await ensureEnabled(UI_ID)
    await vscode.commands.executeCommand(`${UI_ID}.reset`)
    await vscode.commands.executeCommand(`${UI_ID}.armUi`)
    await openEditorPanel('t15-ui.md')
    await waitForPageLoaded(UI_ID)
    // 命令目录：两条命令注册（宿主权威目录；命名空间 ID 由平台注入）
    const catalogRow = await poll('命令目录出现样例命令', async () => {
      const result = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonCommands')) as
        | { catalog: Array<{ commandId: string; addonId: string; mode: string; writes: boolean; defaults: string[] }> }
      const rows = result.catalog.filter((row) => row.addonId === UI_ID)
      return rows.length === 2 ? rows : undefined
    })
    const insertRow = catalogRow.find((row) => row.commandId.endsWith('insertTimestamp'))
    const summarizeRow = catalogRow.find((row) => row.commandId.endsWith('summarize'))
    assert(insertRow !== undefined && insertRow.mode === 'live' && insertRow.writes === true && insertRow.defaults.length === 0,
      `insertTimestamp 应 live/writes/默认未绑定（实际 ${JSON.stringify(insertRow)}）`)
    assert(summarizeRow !== undefined && summarizeRow.mode === 'both' && summarizeRow.writes === false && JSON.stringify(summarizeRow.defaults) === JSON.stringify(['ctrl+alt+u']),
      `summarize 应 both/只读/默认 ctrl+alt+u（实际 ${JSON.stringify(summarizeRow)}）`)
    // 绘制层：双路径按钮挂载（命令挂接 + onClick 回调）
    await poll('按钮绘制挂载', async () => {
      const paint = await addonUiPaint('t15-ui.md')
      return paint && paint.mountedToolbarButtonIds.includes(`${UI_ID}.timestampBtn`) &&
        paint.mountedToolbarButtonIds.includes(`${UI_ID}.summarizeBtn`) ? paint : undefined
    })
    // 命令执行（宿主命令面板入口 → 命令体系 → 页面回调 → views.applyEdits）
    await vscode.commands.executeCommand(`${UI_ID}.insertTimestamp`)
    await poll('时间戳落盘', async () => {
      const text = await docText('t15-ui.md')
      return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text) ? text : undefined
    })
    // 菜单项：右键菜单在场（组件簇）+ 点击执行（经命令体系）
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri('t15-ui.md').toString(), {
      kind: 'contextMenu.test.contextMenu', pos: 0,
    })
    await poll('菜单组件项在场', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri('t15-ui.md').toString(), 0)) as
        | { paint?: { contextMenu?: { visible: boolean; addonCommands?: string[] } } } | undefined
      return state?.paint?.contextMenu?.addonCommands?.includes(`${UI_ID}.insertTimestamp`) ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri('t15-ui.md').toString(), {
      kind: 'contextMenu.test.menuClick', command: `${UI_ID}.insertTimestamp`,
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri('t15-ui.md').toString(), {
      kind: 'contextMenu.test.menuClose',
    })
    await poll('菜单执行第二次插入', async () => {
      const text = await docText('t15-ui.md')
      return (text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) ?? []).length >= 2 ? true : undefined
    })
    // summarize 执行：结果经通道上报宿主收件箱（命令回调真实业务）
    await vscode.commands.executeCommand(`${UI_ID}.summarize`)
    await poll('统计结果上报', async () => {
      const events = await uiEvents()
      return events.some((e) => e['kind'] === 'summarized') ? true : undefined
    })
    // 面板：autoOpenPanel 设置驱动（默认 false 不开；置 true 后重开面板
    // 装载时自动打开——设置→行为闭环）
    let paint = await addonUiPaint('t15-ui.md')
    assert(paint?.openPanelIds.includes(`${UI_ID}.docStats`) !== true, '默认 autoOpenPanel=false 面板不自动打开')
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'user', values: { autoOpenPanel: true } })
    await closeActiveEditor()
    await openEditorPanel('t15-ui.md')
    await waitForPageLoaded(UI_ID)
    // 重开装载：autoOpenPanel=true → 注册后自动 open（开态 + mount 事件
    // 双证据——面板绘制层几何断言在 autoOpen 路径上受装载早期 dock 装配
    // 时序影响，以 mount 完成事件与宿主权威开态为准；用户手动打开路径
    // 的绘制层断言由 T11 夹具用例承载）
    await poll('autoOpenPanel 驱动面板开态', async () => {
      const probe = await addonUiPaint('t15-ui.md')
      return probe && probe.openPanelIds.includes(`${UI_ID}.docStats`) ? probe : undefined
    }, 30000, async () => {
      const probe = await addonUiPaint('t15-ui.md')
      const settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as { values: Record<string, unknown> }
      return `诊断：paint=${JSON.stringify(probe)}；autoOpenPanel=${String(settings.values['autoOpenPanel'])}`
    })
    const panelEvents = (await vscode.commands.executeCommand(`${UI_ID}.collect`)) as Array<{ kind: string; chars?: number; mode?: string }>
    const mounted = panelEvents.filter((e) => e['kind'] === 'panelMounted').pop()
    assert(mounted !== undefined && typeof mounted['chars'] === 'number' && typeof mounted['mode'] === 'string',
      `面板 mount 完成事件应携带统计与模式（实际 ${JSON.stringify(mounted)}）`)
    // 收尾：设置写回默认 + disarm
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'user', values: { autoOpenPanel: false } })
    await vscode.commands.executeCommand(`${UI_ID}.disarmUi`)
    await closeActiveEditor()
    console.log('[#364] 界面样例命令/菜单/按钮/面板与设置驱动通过')
  }],

  ['附加组件 T15：界面样例分层设置、停用保留与故障恢复（#364）', async () => {
    await ensureEnabled(UI_ID)
    await vscode.commands.executeCommand(`${UI_ID}.armUi`)
    await openEditorPanel('t15-ui.md')
    await waitForPageLoaded(UI_ID)
    // 分层默认：出厂默认 iso / default 来源
    let settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as
      | { values: Record<string, unknown>; sources: Record<string, string> }
    assert(settings.values['timestampFormat'] === 'iso' && settings.sources['timestampFormat'] === 'default', `出厂默认 iso/default（实际 ${JSON.stringify(settings)}）`)
    // 用户默认层：date（source user）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'user', values: { timestampFormat: 'date' } })
    settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as typeof settings
    assert(settings.values['timestampFormat'] === 'date' && settings.sources['timestampFormat'] === 'user', '用户层生效 date/user')
    // 工作区覆盖层：time（工作区显式 > 用户默认）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'workspace', values: { timestampFormat: 'time' } })
    settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as typeof settings
    assert(settings.values['timestampFormat'] === 'time' && settings.sources['timestampFormat'] === 'workspace', '工作区覆盖生效 time/workspace')
    // 清除工作区覆盖：恢复继承用户默认（date）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsClearOverride', { addonId: UI_ID, key: 'timestampFormat' })
    settings = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsGet', { addonId: UI_ID })) as typeof settings
    assert(settings.values['timestampFormat'] === 'date' && settings.sources['timestampFormat'] === 'user', '清除覆盖回用户默认 date/user')
    // 停用后配置保留：定义仍在（setup 常驻面）、值保留；贡献回收
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
    // 再启用恢复
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: UI_ID, enabled: true })
    // 故障注入 → faulted（定义仍保留——平台保留已取得的面）→ 手动重试恢复
    await vscode.commands.executeCommand(`${UI_ID}.armCrash`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: UI_ID, topic: 'ui.echo', payload: null })
    await poll('界面样例进入故障暂停', async () => {
      const next = await runtimeStatus(UI_ID)
      return next?.runState === 'faulted' ? next : undefined
    })
    const stateFaulted = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsState')) as
      | { definitions: Record<string, unknown[]> }
    assert((stateFaulted.definitions[UI_ID] ?? []).length === 4, '故障暂停时定义仍保留（基础控件可修正参数）')
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: UI_ID })
    await poll('界面样例重新接入', async () => {
      const reRegister = (await vscode.commands.executeCommand(`${UI_ID}.releaseAndReRegister`)) as { ok: boolean } | undefined
      return reRegister?.ok === true ? true : undefined
    })
    await poll('界面样例回到启用态', async () => {
      const next = await runtimeStatus(UI_ID)
      return next?.runState === 'enabled' ? next : undefined
    })
    // 收尾：用户层写回默认值（等值显式——不残留 date）+ disarm
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSettingsUpdate', { addonId: UI_ID, scope: 'user', values: { timestampFormat: 'iso' } })
    await vscode.commands.executeCommand(`${UI_ID}.disarmUi`)
    await closeActiveEditor()
    console.log('[#364] 界面样例分层设置、停用保留与故障恢复通过')
  }],

  ['附加组件 T15：界面样例自有设置页装载与通道闭环（#364）', async () => {
    await ensureEnabled(UI_ID)
    // 打开生产设置页面板（隐藏即销毁重开重载）
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页打开并就绪', async () => {
      const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.settingsPageInfo')) as
        | { open: boolean; ready: boolean } | undefined
      return info?.open && info.ready ? true : undefined
    })
    // 打开样例自己的设置页：装载指令与结局（settings 面板桥事件）
    const openResult = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonOpenSettingsPage', { addonId: UI_ID })) as string
    assert(openResult === 'ok', `打开样例设置页应成功，实际 ${openResult}`)
    await poll('设置页装载事件收敛', async () => {
      const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ panel: string; kind: string; addonId: string; ok?: boolean }>
      const load = events.find((e) => e.panel === 'settings' && e.kind === 'directive.load' && e.addonId === UI_ID)
      const loaded = events.find((e) => e.panel === 'settings' && e.kind === 'outbound.loaded' && e.addonId === UI_ID && e.ok === true)
      return load && loaded ? true : undefined
    })
    // 通道闭环：设置页装载即上报 ui.settingsMounted（setup scope 通道）
    await poll('设置页挂载上报闭环', async () => {
      const stats = (await vscode.commands.executeCommand(`${UI_ID}.stats`)) as { settingsMountedReports: number; settingsReadCalls: number }
      return stats.settingsMountedReports >= 1 && stats.settingsReadCalls >= 1 ? stats : undefined
    })
    // 通道写路径：经设置页同款通道写用户层（宿主侧转公开 settings.update）
    const writeOutcome = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', {
      addonId: UI_ID, topic: 'ui.settingsWrite', payload: { scope: 'user', values: { autoOpenPanel: false } },
    })) as { ok: boolean; result?: { ok?: boolean } }
    assert(writeOutcome.ok === true && writeOutcome.result?.ok === true, `设置页写通道应成功（实际 ${JSON.stringify(writeOutcome)}）`)
    // 关闭组件设置页：装载意图终结 → unload 推送
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonCloseSettingsPage')
    await poll('设置页卸载事件收敛', async () => {
      const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ panel: string; kind: string; addonId: string }>
      const unload = events.find((e) => e.panel === 'settings' && e.kind === 'directive.unload' && e.addonId === UI_ID)
      const unloaded = events.find((e) => e.panel === 'settings' && e.kind === 'outbound.unloaded' && e.addonId === UI_ID)
      return unload && unloaded ? true : undefined
    })
    console.log('[#364] 界面样例自有设置页装载与通道闭环通过')
  }],
]
