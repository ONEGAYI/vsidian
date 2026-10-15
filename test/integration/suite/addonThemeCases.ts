// #546：公开宿主注册 + 页面 SDK 消费，真宿主验证无编辑器目录、多文档
// 主题切换、四态事件与组件停用；绘制断言消费生产 view.state.paint。
import * as vscode from 'vscode'
import { strict as assert } from 'node:assert'

const ID = 'vsidian-test-fixture.addon-theme'
const PREFIX = 'onegayi.vsidian._test.'
const REF = `${ID}/aqua`
interface ThemeState {
  themes: Array<{ themeRef: string; available: boolean }>
  preferred: string
  preferredAvailable: boolean
  table: { languages: Array<{ language: string; effective: string }> }
}
interface Paint { containers: Array<{ provider: string; color: string | null; width: number }>; builtinSvg: number }
const state = () => vscode.commands.executeCommand<ThemeState>(`${PREFIX}addonThemes`)

async function wait<T>(label: string, read: () => Promise<T | undefined>): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() - start > 30000) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function paint(uri: vscode.Uri): Promise<Paint | undefined> {
  const view = await vscode.commands.executeCommand<{ paint?: { renderers?: Paint } }>(`${PREFIX}requestViewState`, uri.toString(), 0)
  return view?.paint?.renderers
}

export const addonThemeCases: Array<[string, () => Promise<void>]> = [
  ['附加组件主题 T07：无编辑器目录、双文档单选、明暗四态与停用恢复（#546）', async () => {
    const previous = await vscode.commands.executeCommand<Record<string, unknown>>(`${PREFIX}getSettings`)
    const config = vscode.workspace.getConfiguration('workbench')
    const previousColor = config.inspect<string>('colorTheme')!.globalValue
    const root = vscode.workspace.workspaceFolders![0]!.uri
    const uris = ['theme-a.md', 'theme-b.md'].map((name) => vscode.Uri.joinPath(root, name))
    const setPreferred = (value: string) => vscode.commands.executeCommand(`${PREFIX}setSettings`, {
      'appearance.theme': value, 'appearance.mermaidTheme': value === 'codex' ? 'codex' : 'default',
    })
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      const directory = await wait('无编辑器时主题目录已登记', async () => {
        const current = await state()
        return current?.themes.some((theme) => theme.themeRef === REF && theme.available) ? current : undefined
      })
      assert(directory.themes.some((theme) => theme.themeRef === REF))
      await setPreferred('default')
      await vscode.commands.executeCommand(`${ID}.arm`, true)
      for (let index = 0; index < uris.length; index++) {
        const content = '# Theme\n\n```mermaid\ngraph TD; A-->B\n```\n\nEnding paragraph\n'
        await vscode.workspace.fs.writeFile(uris[index]!, Buffer.from(content))
        await vscode.commands.executeCommand('vscode.openWith', uris[index], 'onegayi.vsidian.editor', { viewColumn: index + 1 })
        await wait('面板初始文本落定', async () => {
          const view = await vscode.commands.executeCommand<{ text: string }>(`${PREFIX}requestViewState`, uris[index]!.toString(), 0)
          return view?.text === content ? true : undefined
        })
        await vscode.commands.executeCommand(`${PREFIX}postToPanel`, uris[index]!.toString(), { kind: 'view.locate', offset: content.indexOf('Ending') })
        await wait('未选主题时内置绘制', async () => (await paint(uris[index]!))?.builtinSvg === 1 ? true : undefined)
      }
      await setPreferred(REF)
      for (const uri of uris) {
        await wait('主题在每个文档生效', async () => (await paint(uri))?.containers.some((item) => item.provider === `${ID}/aqua-renderer` && item.width > 0) ? true : undefined)
      }

      const themes = vscode.extensions.getExtension('vscode.theme-defaults')!.packageJSON.contributes.themes as Array<{ id?: string; label: string; uiTheme: string }>
      for (const [uiTheme, dark, highContrast] of [['vs', false, false], ['vs-dark', true, false], ['hc-black', true, true], ['hc-light', false, true]] as const) {
        const theme = themes.find((entry) => entry.uiTheme === uiTheme)!
        await config.update('colorTheme', theme.id ?? theme.label, vscode.ConfigurationTarget.Global)
        await wait(`两个文档收到 ${uiTheme} 环境并实际重画`, async () => {
          const reports = await vscode.commands.executeCommand<Array<{ env: { dark: boolean; highContrast: boolean }; atRead: { dark: boolean; highContrast: boolean } }>>(`${ID}.reports`)
          const matching = reports!.filter((report) => report.env.dark === dark && report.env.highContrast === highContrast)
          if (matching.length < 2) return undefined
          for (const report of matching) assert.deepEqual(report.env, report.atRead, '回调读取已更新快照')
          for (const uri of uris) {
            const rendered = await paint(uri)
            if (!rendered?.containers.some((item) => item.provider === `${ID}/aqua-renderer` && item.color === (dark ? 'rgb(0, 70, 64)' : 'rgb(0, 138, 123)'))) return undefined
          }
          return true
        })
      }
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: ID, enabled: false })
      await wait('停用回落且保留主题首选', async () => {
        const current = await state()
        return current?.preferred === REF && !current.preferredAvailable && current.table.languages.find((entry) => entry.language === 'mermaid')?.effective === 'builtin' ? true : undefined
      })
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: ID, enabled: true })
      await wait('恢复继续原主题', async () => (await state())?.table.languages.find((entry) => entry.language === 'mermaid')?.effective === `${ID}/aqua-renderer` ? true : undefined)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(`${ID}.arm`, false)
      await vscode.commands.executeCommand(`${PREFIX}addonSetEnabled`, { addonId: ID, enabled: true })
      await vscode.commands.executeCommand(`${PREFIX}setSettings`, { 'appearance.theme': previous!['appearance.theme'], 'appearance.mermaidTheme': previous!['appearance.mermaidTheme'] })
      await config.update('colorTheme', previousColor, vscode.ConfigurationTarget.Global)
    }
  }],
]
