const vscode = require('vscode')
const ID = 'vsidian-test-fixture.addon-theme'
const reports = []
let allowed = false
let registration
let api
let themeRegistration
let restoreTheme

function register() {
  registration = api.registerAddon({ id: ID }, {
    setup() {},
    enable(ctx) {
      restoreTheme = () => {
        themeRegistration = ctx.themes.register([{
          themeId: 'aqua', label: { 'zh-cn': '水青', en: 'Aqua' },
          rendererId: 'aqua-renderer', languages: ['mermaid'],
        }])
        if (!themeRegistration.ok) throw new Error(themeRegistration.reason)
      }
      restoreTheme()
      ctx.pages.registerEditor({ entry: 'dist/editor.js' })
      ctx.channel.handle('theme.providersAllowed', () => ({ allowed }))
      ctx.channel.handle('theme.environment', (payload) => { reports.push(payload); return null })
      ctx.channel.handle('theme.crash', () => { throw new Error('theme fixture: injected channel crash') })
    },
  })
  if (!registration.ok) throw new Error(registration.reason)
}

async function activate(context) {
  api = await vscode.extensions.getExtension('onegayi.vsidian').activate()
  register()
  context.subscriptions.push({ dispose: () => registration.dispose() })
  context.subscriptions.push(vscode.commands.registerCommand(`${ID}.arm`, (enabled) => {
    allowed = enabled
    registration.dispose()
    register()
  }))
  context.subscriptions.push(vscode.commands.registerCommand(`${ID}.reports`, () => [...reports]))
  context.subscriptions.push(vscode.commands.registerCommand(`${ID}.withdrawTheme`, () => themeRegistration.dispose()))
  context.subscriptions.push(vscode.commands.registerCommand(`${ID}.restoreTheme`, () => restoreTheme()))
}
module.exports = { activate }
