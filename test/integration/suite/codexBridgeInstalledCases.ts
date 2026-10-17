// #535 T08 安装态组件对照与升级路径——真安装链用例。
//
// 与线 1 dev 用例（cases.ts「Codex 旧设置迁移」）的区别：被测对象是
// **安装链产物**——runInstalledCodexBridge.mjs 把 v1.1.0 旧主 VSIX（升级
// 前真实旧物）与本分支主 VSIX + bridge VSIX（ONEGAYI.vsidian-codex-bridge
// 0.1.0，组件版 Codex 主题）经 CLI --install-extension 装入隔离 profile，
// suite 以安装解压产物为 development path 运行。阶段矩阵（env
// VSIDIAN_T08_PHASE 选择本阶段用例，用例体内 phaseGuard 自跳过其余阶段
// 与非安装态会话）：
// - legacy（v1.1.0 旧主 VSIX）：旧枚举 codex 在旧版语义内合法可保存——
//   建立升级前状态真实成立的基线（宿主扩展是 v1.1.0，本分支新钩子不在
//   场，用例只用 v1.1.0 已有的 _test.setSettings/getSettings）；
// - upgraded（本分支主 VSIX --force 覆盖 + bridge 同装）：
//   1) 组件对照：bridge 经真实安装链被发现并注册 Codex 主题 → 选择生效
//     （渲染选路走组件，paint.renderers.containers 带 bridge provider 身份）
//     → 停用回落 default 且保留首选 → 恢复重新生效；
//   2) 升级迁移：旧键残留注入（1.82.3 测试宿主 storage 完全 in-memory，
//     legacy 会话写入无法跨会话携带——见 t08CodexBridge.mjs 头注释取舍）
//     → 迁移回落 default + 一次性引导恰一次 + 不覆盖已选组件主题。
//
// 断言面与 T07/T16 同源：宿主权威状态（_test.*）+ 绘制层
// （view.state.paint.renderers 容器 provider 身份）。
import * as vscode from 'vscode'
import { strict as assert } from 'node:assert'

const BRIDGE_ID = 'ONEGAYI.vsidian-codex-bridge'
const BRIDGE_THEME_REF = `${BRIDGE_ID}/codex`
const BRIDGE_PROVIDER = `${BRIDGE_ID}/codex-mermaid`
const VIEW_TYPE = 'onegayi.vsidian.editor'
const PREFIX = 'onegayi.vsidian._test.'
const PHASE = process.env['VSIDIAN_T08_PHASE'] ?? ''

/** phaseGuard：当前阶段不在允许清单时自跳过（含非安装态会话——CI dev
 *  分片下这些用例以零成本通过，安装态断言只在启动器阶段会话执行） */
function phaseMatch(...allowed: string[]): boolean {
  return allowed.includes(PHASE)
}

function skipNotice(caseName: string): void {
  console.log(`[T08] 用例「${caseName}」于阶段 ${PHASE || '非安装态'}跳过（phaseGuard）`)
}

async function wait<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

interface ThemeState {
  themes: Array<{ themeRef: string; available: boolean }>
  preferred: string
  preferredAvailable: boolean
  table: { languages: Array<{ language: string; effective: string }> }
}
interface RenderersPaint { containers: Array<{ provider: string; width: number }>; builtinSvg: number }

const themeState = () => vscode.commands.executeCommand<ThemeState>(`${PREFIX}addonThemes`)

async function renderersPaint(uri: vscode.Uri): Promise<RenderersPaint | undefined> {
  const view = await vscode.commands.executeCommand<{ paint?: { renderers?: RenderersPaint } }>(`${PREFIX}requestViewState`, uri.toString(), 0)
  return view?.paint?.renderers
}

export const codexBridgeInstalledCases: Array<[string, () => Promise<void>]> = [
  // ---- 阶段 legacy：v1.1.0 真实旧物内旧枚举合法（升级前基线） ----
  ['T08 安装态（旧版）：v1.1.0 旧 VSIX 内 codex 枚举合法可保存（#535）', async () => {
    if (!phaseMatch('legacy')) {
      skipNotice('T08 安装态（旧版）：v1.1.0 旧 VSIX 内 codex 枚举合法可保存（#535）')
      return
    }
    // 宿主扩展必须是 v1.1.0 旧物（阶段装配的前置；此处再钉一道防误配）
    const ext = vscode.extensions.getExtension('onegayi.vsidian')!
    assert.equal((ext.packageJSON as { version?: string }).version, '1.1.0', 'legacy 阶段宿主应为 v1.1.0 旧 VSIX')
    const previous = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
    try {
      // v1.1.0 语义：appearance.mermaidTheme 枚举含 codex，写入被接受
      const applied = await vscode.commands.executeCommand<{ ok: boolean; rejected?: string[] }>(`${PREFIX}setSettings`, { 'appearance.mermaidTheme': 'codex' })
      assert(applied.ok === true, `v1.1.0 内写 codex 应被接受（实际 ${JSON.stringify(applied)}）`)
      const current = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
      assert.equal(current!['appearance.mermaidTheme'], 'codex', 'v1.1.0 内保存后读回应为 codex')
    } finally {
      const restore = previous!['appearance.mermaidTheme']
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, {
        'appearance.mermaidTheme': typeof restore === 'string' ? restore : 'default',
      })
    }
  }],

  // ---- 阶段 upgraded：组件对照（B1 验收面） ----
  ['T08 安装态（组件对照）：bridge 真实安装后 Codex 主题登记、选路渲染与停用回落（#535）', async () => {
    if (!phaseMatch('upgraded')) {
      skipNotice('T08 安装态（组件对照）：bridge 真实安装后 Codex 主题登记、选路渲染与停用回落（#535）')
      return
    }
    const previous = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
    const root = vscode.workspace.workspaceFolders![0]!.uri
    const uri = vscode.Uri.joinPath(root, 'codex-bridge-theme.md')
    try {
      // 主题目录：bridge 经真实安装链被发现并注册（default 之外的组件 Codex 候选）
      await wait('bridge Codex 主题登记进目录', async () => {
        const current = await themeState()
        return current?.themes.some((theme) => theme.themeRef === BRIDGE_THEME_REF && theme.available) ? current : undefined
      })

      // 打开自写单图文档，基线为内置绘制
      const content = '# Codex Bridge\n\n```mermaid\ngraph TD; A-->B\n```\n\n结尾段落\n'
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content))
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
      await wait('面板初始文本落定', async () => {
        const view = await vscode.commands.executeCommand<{ text: string }>(`${PREFIX}requestViewState`, uri.toString(), 0)
        return view?.text === content ? true : undefined
      })
      await vscode.commands.executeCommand(`${PREFIX}postToPanel`, uri.toString(), { kind: 'view.locate', offset: content.indexOf('结尾段落') })
      await wait('未选主题时内置绘制', async () => ((await renderersPaint(uri))?.builtinSvg ?? 0) >= 1 ? true : undefined)

      // 选择生效：新键写组件身份，渲染选路走组件（provider 带 bridge 身份且真实绘制）
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, { 'appearance.theme': BRIDGE_THEME_REF })
      await wait('主题选中后渲染选路走组件', async () => {
        const state = await themeState()
        if (state?.table.languages.find((entry) => entry.language === 'mermaid')?.effective !== BRIDGE_PROVIDER) return undefined
        const paint = await renderersPaint(uri)
        return paint?.containers.some((item) => item.provider === BRIDGE_PROVIDER && item.width > 0) ? true : undefined
      })

      // 停用 bridge：回落 default 且保留主题首选
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: BRIDGE_ID, enabled: false })
      await wait('停用后回落 default 且保留首选', async () => {
        const current = await themeState()
        return current?.preferred === BRIDGE_THEME_REF && !current.preferredAvailable &&
          current.table.languages.find((entry) => entry.language === 'mermaid')?.effective === 'builtin' ? true : undefined
      })
      await wait('停用后每个容器实际回内置', async () => {
        const paint = await renderersPaint(uri)
        return (paint?.builtinSvg ?? 0) >= 1 && !(paint?.containers ?? []).some((item) => item.provider === BRIDGE_PROVIDER) ? true : undefined
      })

      // 恢复后按原首选显示
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: BRIDGE_ID, enabled: true })
      await wait('恢复后按原首选走组件渲染', async () => {
        const state = await themeState()
        if (state?.preferred !== BRIDGE_THEME_REF || !state.preferredAvailable) return undefined
        if (state.table.languages.find((entry) => entry.language === 'mermaid')?.effective !== BRIDGE_PROVIDER) return undefined
        const paint = await renderersPaint(uri)
        return paint?.containers.some((item) => item.provider === BRIDGE_PROVIDER && item.width > 0) ? true : undefined
      })
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: BRIDGE_ID, enabled: true })
      const restore = previous!['appearance.theme']
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, { 'appearance.theme': typeof restore === 'string' ? restore : 'default' })
    }
  }],

  // ---- 阶段 upgraded：升级迁移语义（B2 验收面；与线 1 dev 用例同构，
  // 跑在安装产物上；存量注入的取舍见文件头注释） ----
  ['T08 安装态（升级后）：旧键残留迁移 default、引导恰一次且不覆盖组件选择（#535）', async () => {
    if (!phaseMatch('upgraded')) {
      skipNotice('T08 安装态（升级后）：旧键残留迁移 default、引导恰一次且不覆盖组件选择（#535）')
      return
    }
    const previous = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
    interface MigrationState { marker: string | null; guideCount: number; overlayTheme: unknown; overlayMermaid: unknown }
    const readState = () => vscode.commands.executeCommand<MigrationState>(`${PREFIX}getCodexMigrationState`)
    try {
      // 档 1（升级用户主路径）：注入原始 overlay 旧键 codex（模拟 v1.1.0
      // 升级带来的磁盘残留）→ 迁移 → 双键回落 + 引导恰一次
      await vscode.commands.executeCommand(`${PREFIX}resetCodexMigration`)
      await vscode.commands.executeCommand(`${PREFIX}injectCodexLegacyOverlay`, { theme: null, mermaid: 'codex' })
      const first = await vscode.commands.executeCommand<{ action: string; guide: boolean }>(`${PREFIX}runCodexMigration`)
      assert(first!.action === 'migrate' && first.guide === true, `旧键 codex 应触发迁移与引导（实际 ${JSON.stringify(first)}）`)
      let state = await readState()
      assert(state!.overlayTheme === 'default' && state!.overlayMermaid === 'default', '迁移后原始 overlay 双键应回落 default')
      assert(state!.marker === (vscode.extensions.getExtension('onegayi.vsidian')!.packageJSON as { version: string }).version, '一次性标记应记录安装产物的扩展版本')
      assert(state!.guideCount === 1, '迁移应请求一次引导')
      // 重开/重启语义：标记在场时重跑（模拟再次激活）→ 无操作不重复引导
      const second = await vscode.commands.executeCommand<{ action: string; guide: boolean }>(`${PREFIX}runCodexMigration`)
      assert(second!.action === 'none' && second!.guide === false, '标记在场时重跑应无操作')
      state = await readState()
      assert(state!.guideCount === 1, '重跑不得再次请求引导')
      assert(state!.overlayTheme === 'default', '重跑不得改写已迁移的设置')
      // 档 2（不覆盖已选组件主题）：新键 bridge 组件身份 + 旧键 codex 残留
      // → 只清旧键，不覆盖用户新选
      await vscode.commands.executeCommand(`${PREFIX}resetCodexMigration`)
      await vscode.commands.executeCommand(`${PREFIX}injectCodexLegacyOverlay`, { theme: BRIDGE_THEME_REF, mermaid: 'codex' })
      const third = await vscode.commands.executeCommand<{ action: string; guide: boolean }>(`${PREFIX}runCodexMigration`)
      assert(third!.action === 'clean-legacy' && third!.guide === false, `已选组件主题只清旧键残留、不引导（实际 ${JSON.stringify(third)}）`)
      state = await readState()
      assert(state!.overlayTheme === BRIDGE_THEME_REF, '迁移不得覆盖已选组件主题')
      assert(state!.overlayMermaid === 'default', '旧键残留应清为 default')
      assert(state!.marker === null && state!.guideCount === 0, 'clean-legacy 不写标记不引导')
    } finally {
      await vscode.commands.executeCommand(`${PREFIX}resetCodexMigration`)
      await vscode.commands.executeCommand(`${PREFIX}injectCodexLegacyOverlay`, { theme: null, mermaid: null })
      const restore = previous!['appearance.theme']
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, { 'appearance.theme': typeof restore === 'string' ? restore : 'default' })
    }
  }],
]
