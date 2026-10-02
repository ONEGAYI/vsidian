import { WebviewSyncController } from '../../src/webview/syncController'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS, sanitizeStoredSettings, PASTE_PRESERVE_FORMATTING_KEY, PASTE_ASK_BEFORE_KEY } from '../../src/shared/settings'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'
import '../../src/webview/settingsPage.css'

bootLocaleFromDocument()
let values = sanitizeStoredSettings(PRODUCTION_SETTING_DEFINITIONS, {})
const sent: Array<{ kind: string; [key: string]: unknown }> = []
let failNextEdit = false
const c = new WebviewSyncController({
  postMessage(message: unknown) {
    const m = message as { kind: string; [key: string]: unknown }
    sent.push(m)
    if (m.kind === 'edit.request') setTimeout(() => {
      c.handleHostMessage(failNextEdit ? { kind: 'edit.ack', seq: Number(m['seq']), ok: false, reason: 'error', version: 1 } : { kind: 'edit.ack', seq: Number(m['seq']), ok: true, version: Number(m['baseVersion']) + 1 })
      failNextEdit = false
    }, 10)
    if (m.kind === 'paste.preferences.set') {
      values = { ...values, [PASTE_PRESERVE_FORMATTING_KEY]: m['preserveFormatting'] === true, [PASTE_ASK_BEFORE_KEY]: false }
      localStorage.setItem('preferences', JSON.stringify(values))
      c.handleHostMessage({ kind: 'settings.changed', values })
      c.handleHostMessage({ kind: 'paste.preferences.result', reqId: Number(m['reqId']), ok: true })
    }
  }, getState: () => undefined, setState() {},
})
c.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
c.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'file:///d/a.md', version: 1, text: '原文' })
c.handleHostMessage({ kind: 'settings.snapshot', values })
let settings: SettingsPageView | undefined
let settingsParent: HTMLElement | undefined
Object.assign(window, {
  controller: c, sent: () => sent,
  text: () => c.getView()!.state.doc.toString(),
  replace(text: string) { const view = c.getView()!; c.handleHostMessage({ kind: 'doc.resync', version: 100, text }); view.dispatch({ selection: { anchor: 0, head: text.length } }); view.focus() },
  settings(valuesPatch: Record<string, boolean>) { values = { ...values, ...valuesPatch }; c.handleHostMessage({ kind: 'settings.changed', values }) },
  failNextEdit() { failNextEdit = true },
  openSettings() {
    settings?.dispose()
    settingsParent?.remove()
    const element = document.createElement('div')
    element.style.cssText = 'position:fixed;inset:0;z-index:12000;background:white'
    settingsParent = element
    document.body.append(element)
    settings = new SettingsPageView({ postMessage(message: unknown) {
      const m = message as { kind: string; values: Record<string, boolean> }
      if (m.kind === 'settings.set') {
        values = { ...values, ...m.values }; localStorage.setItem('preferences', JSON.stringify(values))
        settings?.handleHostMessage({ kind: 'settings.changed', values }); c.handleHostMessage({ kind: 'settings.changed', values })
      }
    } }, PRODUCTION_SETTING_DEFINITIONS)
    settings.mount(element)
    settings.handleHostMessage({ kind: 'settings.snapshot', values: JSON.parse(localStorage.getItem('preferences') ?? JSON.stringify(values)) })
    settings.selectSection('editor')
    return element
  },
  closeSettings() { settings?.dispose(); settingsParent?.remove() },
})
