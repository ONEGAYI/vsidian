// #358 T09 代码块自动接管、多提供者与内置恢复——真宿主生产路径用例。
//
// 链路：夹具组件 vsidian-test-fixture.addon-t09 经公开 registerAddon 注册
// 编辑器页入口，其页面产物（构建桥 t09Renderer.ts）经 SDK renderers 面
// 登记四提供者候选（mermaid-alt/draw-alpha/draw-beta/aa-reading-only）；
// 候选上报 → 宿主 AddonRendererService（批次/首选/确定性选择）→ 生效表
// 广播 → webview 渲染桥热切换。绘制层断言经 view.state.paint.renderers
//（容器 provider 标记 + 组件渲染内容计算色/几何 + 内置 SVG 在场数——
// 「实际选中内容」的断言面）。
//
// 覆盖票面验收：
// - 安装无额外选择即接管：内置 Mermaid 与普通语言（t09draw）替换显示；
// - 同批多候选确定性默认序（draw-beta 末位生效）+ 用户调整（改 alpha、
//   清除回默认、mermaid 改回内置）；
// - Q30 三态：正常停用/整组件故障停用 → 内置接管（t09draw 回普通代码
//   块）、恢复 → 按原选择显示（首选保留）；仍运行渲染 bug（mount 抛错
//   由浏览器套件覆盖，此处故障注入走可归因通道异常 → 整组件停用）；
// - 重启/升级不覆盖首选：批次幂等（_test.addonRendererStore 的批次在
//   重复上报后不变、首选持久保留）——真重启由单测「同 store 新实例」
//   钉住（与 T02 停用持久化同口径的已知边界）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-t09'
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

/** 某文档面板的绘制层渲染探针（live 或 reading 均取当前 paint） */
async function paintRenderers(file: string): Promise<PaintRenderers | undefined> {
  const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as
    | { paint?: { renderers?: PaintRenderers } } | undefined
  return state?.paint?.renderers
}

/** 等待文档面板出现指定提供者的容器（绘制层：provider + 组件内容非零几何） */
async function waitForProviderPaint(file: string, provider: string, language: string): Promise<void> {
  await poll(`绘制层出现 ${provider} 的 ${language} 容器`, async () => {
    const probe = await paintRenderers(file)
    const hit = probe?.containers.find(
      (c) => c.provider === provider && c.language === language && c.width > 0 && c.state === 'rendered',
    )
    return hit ? true : undefined
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

/** 夹具页面装载并完成候选上报（面板桥 loaded + 生效表出现该组件候选） */
async function waitForAddonTakeoverReady(): Promise<void> {
  await poll('t09 夹具注册并启用', async () => {
    const stats = (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as { setupCount: number; enableCount: number } | undefined
    return stats && stats.setupCount >= 1 && stats.enableCount >= 1 ? true : undefined
  })
  await poll('面板装载 t09 页面', async () => {
    const events = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as Array<{ kind: string; addonId: string; ok?: boolean }>
    return events.some((e) => e.addonId === ADDON_ID && e.kind === 'outbound.loaded' && e.ok === true) ? true : undefined
  })
  await poll('生效表出现 t09 候选', async () => {
    const table = await rendererTable()
    return table.languages.some((row) => row.effective.startsWith(`${ADDON_ID}/`)) ? true : undefined
  })
}

async function closePanel(file: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  void file
}

export const addonT09Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T09：安装无额外选择即接管内置 Mermaid 与普通语言（绘制层，#358）', async () => {
    await openEditorPanel('t09-render.md')
    await waitForAddonTakeoverReady()
    // 生效表：新安装批次默认序——mermaid-alt 接管内置 mermaid、同批
    // draw-beta 末位生效（确定性默认序）
    const table = await poll('生效表 mermaid-alt/draw-beta', async () => {
      const t = await rendererTable()
      const mermaid = t.languages.find((row) => row.language === 'mermaid')
      const draw = t.languages.find((row) => row.language === 't09draw')
      return mermaid?.effective === `${ADDON_ID}/mermaid-alt` && draw?.effective === `${ADDON_ID}/draw-beta` ? t : undefined
    })
    assert(table.languages.find((row) => row.language === 't09draw')?.source === 'auto', '默认序来源 auto')
    // 绘制层：组件容器实际选中内容（provider 标记 + 非零几何 + rendered 态）
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-beta`, 't09draw')
    const probe = await paintRenderers('t09-render.md')
    assert((probe?.builtinSvg ?? 0) === 0, '内置 mermaid SVG 应被组件接管替换')
    console.log('[#358] 安装自动接管通过（内置 Mermaid 与普通语言、绘制层断言）')
    await closePanel('t09-render.md')
  }],

  ['附加组件 T09：同批确定性默认序与用户调整（改 alpha/回默认/改回内置，#358）', async () => {
    await openEditorPanel('t09-render.md')
    await waitForAddonTakeoverReady()
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-beta`, 't09draw')
    // 用户首选 alpha：热切换（绘制层换提供者）
    assert((await prefer('t09draw', `${ADDON_ID}/draw-alpha`)).result === 'ok', '首选 alpha 应被接受')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-alpha`, 't09draw')
    let table = await rendererTable()
    assert(table.languages.find((row) => row.language === 't09draw')?.source === 'user', '首选来源 user')
    // 清除首选：回确定性默认序（beta）
    assert((await prefer('t09draw', null)).result === 'ok', '清除首选应被接受')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-beta`, 't09draw')
    table = await rendererTable()
    assert(table.languages.find((row) => row.language === 't09draw')?.source === 'auto', '清除后回默认序')
    // mermaid 改回内置：内置 SVG 恢复在场、组件容器退场
    assert((await prefer('mermaid', 'builtin')).result === 'ok', '改回内置应被接受')
    await poll('内置 SVG 恢复在场', async () => {
      const probe = await paintRenderers('t09-render.md')
      return probe && probe.builtinSvg >= 1 && !probe.containers.some((c) => c.language === 'mermaid' && c.provider !== 'builtin') ? true : undefined
    })
    // 恢复首选（回组件）——改回内置后再次选择组件（按需调整双向）
    assert((await prefer('mermaid', `${ADDON_ID}/mermaid-alt`)).result === 'ok', '再次选择组件应被接受')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    // 清理：mermaid 首选清除（不残留到后续用例）
    await prefer('mermaid', null)
    console.log('[#358] 同批确定性默认序与用户调整通过（含改回内置）')
    await closePanel('t09-render.md')
  }],

  ['附加组件 T09：Q30 正常停用内置接管与恢复按原选择（首选保留，#358）', async () => {
    await openEditorPanel('t09-render.md')
    await waitForAddonTakeoverReady()
    // 建立用户首选：mermaid-alt（恢复后应按原选择显示）
    assert((await prefer('mermaid', `${ADDON_ID}/mermaid-alt`)).result === 'ok', '首选 mermaid-alt')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    // 正常停用（用户功能开关）：候选不可用 → 内置接管；t09draw 无图形
    // 内置 → 普通代码块（renderers 容器清空）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用后内置接管', async () => {
      const probe = await paintRenderers('t09-render.md')
      return probe && probe.builtinSvg >= 1 && probe.containers.every((c) => c.provider === 'builtin') && !probe.containers.some((c) => c.language === 't09draw') ? true : undefined
    })
    // 首选保留（store 不清除——Q30 恢复语义）
    const storeDown = await rendererStore()
    assert(storeDown.preferred['mermaid'] === `${ADDON_ID}/mermaid-alt`, '停用不清除首选')
    // 重新启用：按原选择恢复（source=user 生效 mermaid-alt）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-beta`, 't09draw')
    const table = await rendererTable()
    assert(table.languages.find((row) => row.language === 'mermaid')?.source === 'user', '恢复后按原选择（user 来源）')
    console.log('[#358] Q30 正常停用与恢复通过（内置接管、首选保留、原选择恢复）')
    await closePanel('t09-render.md')
  }],

  ['附加组件 T09：Q30 整组件故障停用内置接管与手动恢复（#358）', async () => {
    await openEditorPanel('t09-render.md')
    await waitForAddonTakeoverReady()
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    // 故障注入：可归因通道回调异常 → 全组件故障暂停（T02 同款机制）
    await vscode.commands.executeCommand(`${ADDON_ID}.armCrash`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: ADDON_ID, topic: 't09.echo', payload: null })
    await poll('组件进入故障暂停', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string; faultReason?: string } | null
      return status?.runState === 'faulted' ? status : undefined
    })
    // 整组件降级停用 → 候选不可用 → 内置接管（t09draw 回普通代码块）
    await poll('故障后内置接管', async () => {
      const probe = await paintRenderers('t09-render.md')
      return probe && probe.builtinSvg >= 1 && !probe.containers.some((c) => c.provider !== 'builtin') ? true : undefined
    })
    // 手动重试（T05 入口：先释放旧代次再唤醒；激活失败过的 activate 假成功
    // → 如实呈现等待注册）+ 组件侧重新接入（T01 实证约束：重试不走自动
    // 路径，T02 夹具同款 releaseAndReRegister 配合）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })
    await poll('组件侧重新接入', async () => {
      const reRegister = (await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)) as { ok: boolean } | undefined
      return reRegister?.ok === true ? true : undefined
    })
    await poll('重试后组件回到启用态', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return status?.runState === 'enabled' ? status : undefined
    })
    await poll('恢复后组件重新接管（页面装载 + 生效表）', async () => {
      const table = await rendererTable()
      return table.languages.some((row) => row.language === 'mermaid' && row.effective === `${ADDON_ID}/mermaid-alt`) ? true : undefined
    })
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/mermaid-alt`, 'mermaid')
    console.log('[#358] Q30 整组件故障停用与手动恢复通过')
    await closePanel('t09-render.md')
  }],

  ['附加组件 T09：重复上报批次幂等与首选持久（重启/升级语义的宿主侧证据，#358）', async () => {
    await openEditorPanel('t09-render.md')
    await waitForAddonTakeoverReady()
    await waitForProviderPaint('t09-render.md', `${ADDON_ID}/draw-beta`, 't09draw')
    const storeBefore = await rendererStore()
    const batch = storeBefore.batches[ADDON_ID]
    assert(typeof batch === 'number' && batch >= 1, '新安装组件应有已记录批次')
    // 建立首选后重复触发装载代次（面板重开 = 页面重新上报同一组件候选）
    await prefer('t09draw', `${ADDON_ID}/draw-alpha`)
    await closePanel('t09-render.md')
    await openEditorPanel('t09-render.md')
    await poll('重开后组件重新接管（同批次）', async () => {
      const probe = await paintRenderers('t09-render.md')
      return probe?.containers.some((c) => c.provider === `${ADDON_ID}/draw-alpha` && c.language === 't09draw') ? true : undefined
    })
    const storeAfter = await rendererStore()
    assert(storeAfter.batches[ADDON_ID] === batch, '重复上报（升级/重启同组件）不改写批次')
    assert(storeAfter.preferred['t09draw'] === `${ADDON_ID}/draw-alpha`, '首选持久保留（不被自动接管覆盖）')
    // 清理：清除本用例建立的首选
    await prefer('t09draw', null)
    console.log('[#358] 批次幂等与首选持久通过')
    await closePanel('t09-render.md')
  }],
]
