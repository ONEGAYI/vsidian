// #541：以公开宿主生命周期登记来源特化规则；没有页面入口或内核专用分支。
const vscode = require('vscode')
const SELF_ID = 'vsidian-test-fixture.addon-paste-rules'
const stats = { enableCount: 0, disposeCount: 0, lastRegistration: null }

async function activate(context) {
  const host = await vscode.extensions.getExtension('onegayi.vsidian').activate()
  const registration = host.registerAddon({ id: SELF_ID }, {
    enable(ctx) {
      stats.enableCount++
      const result = ctx.paste.registerRules([{
        id: 'source-link',
        match: { tag: 'span', attributes: [{ name: 'data-vsidian-paste-fixture' }] },
        output: {
          kind: 'template', template: '[{{label}}]({{url}})',
          slots: {
            label: { source: { kind: 'text' } },
            url: { source: { kind: 'attribute', name: 'data-vsidian-paste-fixture' }, url: true },
          },
        },
      }])
      stats.lastRegistration = { ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) }
      ctx.onDispose(() => { stats.disposeCount++ })
    },
  })
  if (!registration.ok) throw new Error(`Paste fixture registration rejected: ${registration.reason}`)
  context.subscriptions.push(vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({ ...stats })))
}

module.exports = { activate }
