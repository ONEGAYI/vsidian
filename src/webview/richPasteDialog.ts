import { t } from '../shared/i18n'
import './richPasteDialog.css'

export interface PasteChoice { decision: 'keep' | 'plain' | 'cancel'; remember: boolean }
/** 粘贴会话模态，仅局部 Tab/Enter/Esc 交互，无全局命令或编辑历史。 */
export class RichPasteDialog {
  private overlay: HTMLElement | undefined
  private resolve: ((choice: PasteChoice) => void) | undefined
  private oldFocus: HTMLElement | null = null
  private readonly keydown = (event: KeyboardEvent) => {
    if (!this.overlay) return
    if (event.key === 'Escape') { event.preventDefault(); this.finish('cancel'); }
    if (event.key === 'Tab') {
      event.preventDefault()
      const controls = Array.from(this.overlay.querySelectorAll<HTMLElement>('button,input'))
      const index = controls.indexOf(document.activeElement as HTMLElement)
      controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus()
    }
    event.stopPropagation()
  }

  constructor(private readonly app: HTMLElement) {}
  isOpen(): boolean { return !!this.overlay }

  open(): Promise<PasteChoice> {
    this.cancel(false)
    this.oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overlay = document.createElement('div')
    overlay.className = 'vsidian-paste-dialog-overlay'
    const dialog = document.createElement('div')
    dialog.className = 'vsidian-paste-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', t('paste.dialog.question'))
    const question = document.createElement('p')
    question.textContent = t('paste.dialog.question')
    const label = document.createElement('label')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset['pasteRemember'] = ''
    label.append(checkbox, document.createTextNode(t('paste.dialog.remember')))
    const actions = document.createElement('div')
    actions.className = 'vsidian-paste-dialog-actions'
    for (const decision of ['keep', 'plain', 'cancel'] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset['pasteChoice'] = decision
      button.textContent = t(`paste.dialog.${decision}`)
      button.addEventListener('click', () => this.finish(decision))
      actions.append(button)
    }
    dialog.append(question, label, actions)
    overlay.append(dialog)
    this.app.append(overlay)
    this.overlay = overlay
    document.addEventListener('keydown', this.keydown, true)
    const promise = new Promise<PasteChoice>((resolve) => { this.resolve = resolve })
    actions.querySelector('button')!.focus()
    return promise
  }

  private finish(decision: PasteChoice['decision'], restoreFocus = true): void {
    const remember = decision !== 'cancel' && !!this.overlay?.querySelector<HTMLInputElement>('input')?.checked
    this.overlay?.remove()
    this.overlay = undefined
    document.removeEventListener('keydown', this.keydown, true)
    if (restoreFocus && this.oldFocus?.isConnected) this.oldFocus.focus()
    this.oldFocus = null
    const resolve = this.resolve
    this.resolve = undefined
    resolve?.({ decision, remember })
  }
  cancel(restoreFocus = true): void { this.finish('cancel', restoreFocus) }
  dispose(): void { this.cancel(false) }
}
