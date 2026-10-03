import { WebviewSyncController } from '../../src/webview/syncController'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS, sanitizeStoredSettings, PASTE_PRESERVE_FORMATTING_KEY, PASTE_ASK_BEFORE_KEY } from '../../src/shared/settings'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { ChangeSet, EditorSelection, Text } from '@codemirror/state'
import type { PasteStage, SerChange } from '../../src/shared/protocol'
import '../../src/webview/main.css'
import '../../src/webview/settingsPage.css'

bootLocaleFromDocument()
let values = sanitizeStoredSettings(PRODUCTION_SETTING_DEFINITIONS, {})
const sent: Array<{ kind: string; [key: string]: unknown }> = []
let failNextEdit = false
let hostText = '原文', hostVersion = 1
interface HistoryEntry { before: string; changes: SerChange[]; paste?: PasteStage }
const undoEntries: HistoryEntry[] = [], redoEntries: HistoryEntry[] = []
function changeSet(changes: SerChange[], text: string) { return ChangeSet.of(changes.map(c => ({ from: c.offset, to: c.offset + c.length, insert: c.text })), text.length) }
function ser(changes: ChangeSet) {
  const result: SerChange[] = []
  changes.iterChanges((from, to, _b, _e, inserted) => result.push({ offset: from, length: to - from, text: inserted.toString() }))
  return result
}
const c = new WebviewSyncController({
  postMessage(message: unknown) {
    const m = message as { kind: string; [key: string]: unknown }
    sent.push(m)
    if (m.kind === 'edit.request') setTimeout(() => {
      if (!failNextEdit) {
        const changes = m['changes'] as SerChange[], paste = m['paste'] as PasteStage | undefined
        undoEntries.push({ before: hostText, changes, ...(paste ? { paste } : {}) }); redoEntries.length = 0
        hostText = changeSet(changes, hostText).apply(Text.of(hostText.split('\n'))).toString(); hostVersion++
      }
      c.handleHostMessage(failNextEdit ? { kind: 'edit.ack', seq: Number(m['seq']), ok: false, reason: 'error', version: hostVersion } : { kind: 'edit.ack', seq: Number(m['seq']), ok: true, version: hostVersion })
      failNextEdit = false
    }, 10)
    if (m.kind === 'history.request') {
      const undo = m['op'] === 'undo', entry = (undo ? undoEntries : redoEntries).pop()
      if (entry) {
        const forward = changeSet(entry.changes, entry.before)
        const changes = undo ? ser(forward.invert(Text.of(entry.before.split('\n')))) : entry.changes
        hostText = changeSet(changes, hostText).apply(Text.of(hostText.split('\n'))).toString()
        ;(undo ? redoEntries : undoEntries).push(entry)
        c.handleHostMessage({ kind: 'doc.changed', origin: 'external', version: ++hostVersion, changes, reason: undo ? 'undo' : 'redo', ...(entry.paste ? { paste: { ...entry.paste, sessionId: 's' } } : {}) })
      }
    }
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
  replace(text: string) { hostText = text; undoEntries.length = redoEntries.length = 0; const view = c.getView()!; c.handleHostMessage({ kind: 'doc.resync', version: ++hostVersion, text }); view.dispatch({ selection: { anchor: 0, head: text.length } }); view.focus() },
  hostText: () => hostText,
  selection: () => c.getView()!.state.selection.toJSON(),
  selectRanges(ranges: { anchor: number; head: number }[]) { c.getView()!.dispatch({ selection: EditorSelection.create(ranges.map(r => EditorSelection.range(r.anchor, r.head))) }); c.getView()!.focus() },
  paint() { c.handleHostMessage({ kind: 'view.state.request' }); return [...sent].reverse().find(m => m.kind === 'view.state')!['paint'] },
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
