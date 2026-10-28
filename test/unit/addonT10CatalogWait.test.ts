import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ text: '', catalogReads: 0 }))

vi.mock('vscode', () => ({
  Uri: { file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }) },
  workspace: {
    openTextDocument: async () => ({ isDirty: false, getText: () => state.text }),
    fs: { writeFile: async (_uri: unknown, bytes: Uint8Array) => { state.text = Buffer.from(bytes).toString('utf8') } },
  },
  commands: {
    executeCommand: async (name: string) => {
      switch (name) {
        case 'workbench.action.closeAllEditors':
        case 'vscode.openWith':
        case 'vsidian-test-fixture.addon-t10.reset':
          return undefined
        case 'onegayi.vsidian._test.addonRuntimeStatus':
          return { runState: 'enabled' }
        case 'onegayi.vsidian._test.getSessionState':
          return { found: true, panels: [{ ready: true }] }
        case 'vsidian-test-fixture.addon-t10.stats':
          return {
            setupCount: 1,
            registrations: {
              addonId: 'vsidian-test-fixture.addon-t10',
              outcomes: {
                insertStamp: { ok: true, commandId: 'vsidian-test-fixture.addon-t10.insertStamp' },
                greet: { ok: true, commandId: 'vsidian-test-fixture.addon-t10.greet' },
                menuEntry: { ok: true, id: 'vsidian-test-fixture.addon-t10.stampEntry' },
                dupCommand: { ok: false, reason: 'duplicate-command' },
                dottedCommand: { ok: false, reason: 'local-id:dot-forbidden' },
                bareTabCommand: { ok: false, reason: 'tab-forbidden' },
                modTabCommand: { ok: true },
                badIconMenu: { ok: false, reason: 'icon-key' },
              },
            },
          }
        case 'onegayi.vsidian._test.addonCommands': {
          state.catalogReads++
          const catalog = [
            { commandId: 'vsidian-test-fixture.addon-t10.insertStamp', addonId: 'vsidian-test-fixture.addon-t10', mode: 'live', writes: true, defaults: [] },
            { commandId: 'vsidian-test-fixture.addon-t10.greet', addonId: 'vsidian-test-fixture.addon-t10', mode: 'both', writes: false, defaults: ['ctrl+alt+g'] },
          ]
          if (state.catalogReads >= 2) {
            catalog.push({ commandId: 'vsidian-test-fixture.addon-t10.tabbed-mod', addonId: 'vsidian-test-fixture.addon-t10', mode: 'both', writes: false, defaults: ['ctrl+tab'] })
          }
          return { catalog }
        }
        default:
          throw new Error(`Unexpected command: ${name}`)
      }
    },
  },
}))

import { addonT10Cases } from '../integration/suite/addonT10Cases'

beforeEach(() => {
  state.text = ''
  state.catalogReads = 0
})

it('T10 注册验收等待完整宿主目录，不将前两条命令的快照误当最终表', async () => {
  const registrationCase = addonT10Cases.find(([name]) => name.includes('命令/菜单注册上报'))!
  await registrationCase[1]()
  expect(state.catalogReads).toBe(2)
})
