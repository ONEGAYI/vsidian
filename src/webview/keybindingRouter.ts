import { normalizeChord, resolveKeybinding, type KeybindingOverrides, type BindingScope } from '../shared/keybindings'

/** KeyboardEvent → 平台无关的键位文字；修饰键自身及组合输入不参与路由。 */
export function keyStep(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>): string | null {
  if (event.isComposing || event.key === 'Process' || event.key === 'Dead') return null
  const aliases: Record<string, string> = {
    ' ': 'space', Escape: 'escape', ArrowUp: 'up', ArrowDown: 'down',
    ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown',
    '+': 'equal', '=': 'equal', Add: 'equal',
    '-': 'minus', Subtract: 'minus',
    ',': 'comma', '.': 'period', '/': 'slash',
    '\\': 'backslash', ';': 'semicolon', "'": 'quote', '[': 'bracketleft', ']': 'bracketright',
    // #413（#409 T02）shift 上档符号 → 物理键名：美式布局下 Shift 把符号键
    // 换成上档字符（Ctrl+Shift+[ 的实际事件字符是 `{`），validKey 白名单
    // 只有物理键名——上档字符折回物理键，修饰键由 event.shiftKey 携带。
    // 盘点口径 = validKey 白名单的符号键逐个补全上档形态（`+`→equal 既有），
    // 数字键上档（!@#$%^&*()）不映射——数字族非「符号键」且无默认绑定消费，
    // 留待实需增量；非美式布局不做物理键换算（既有键位模型边界）。
    // 设置页键位捕获同用 keyStep，同源受益。
    '{': 'bracketleft', '}': 'bracketright', '_': 'minus', '<': 'comma',
    '>': 'period', '?': 'slash', '|': 'backslash', ':': 'semicolon', '"': 'quote',
  }
  const key = aliases[event.key] ?? event.key.toLowerCase()
  return normalizeChord(`${event.ctrlKey ? 'ctrl+' : ''}${event.altKey ? 'alt+' : ''}${event.shiftKey ? 'shift+' : ''}${event.metaKey ? 'meta+' : ''}${key}`)
}

export class KeybindingRouter {
  private prefix: { step: string; scope: BindingScope; context?: BindingScope } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private overrides: KeybindingOverrides, private readonly execute: (id: string) => void) {}

  update(overrides: KeybindingOverrides): void { this.overrides = overrides; this.cancel() }
  cancel(): void {
    this.prefix = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  handle(event: KeyboardEvent, mode: 'live' | 'reading', inEditor: boolean, allowWrites = true,
    { context, nativePaste = false }: { context?: Exclude<BindingScope, 'editor'>; nativePaste?: boolean } = {},
  ): boolean {
    if (this.prefix && (this.prefix.context !== context || (!inEditor && this.prefix.scope === 'editor'))) {
      this.cancel()
    }
    if (!inEditor && !context) return false
    if (event.key === 'Escape' && this.prefix) { this.cancel(); event.preventDefault(); event.stopPropagation(); return true }
    const step = keyStep(event)
    if (!step) return false

    const candidates: [BindingScope, string][] = []
    if (this.prefix) {
      // 首段选定的场景拥有该弦。第二段未完成时，才按单键重新路由。
      candidates.push([this.prefix.scope, `${this.prefix.step} ${step}`])
      this.cancel()
    }
    if (context) candidates.push([context, step])
    if (inEditor) candidates.push(['editor', step])
    for (const [scope, chord] of candidates) {
      const result = resolveKeybinding(this.overrides, mode, chord, allowWrites, scope)
      if (result.kind === 'none') continue
      // 截断 VS Code webview 预加载脚本在 window 冒泡阶段向工作台转发。
      event.stopPropagation()
      // 普通粘贴要保留原生 paste 事件（文件和多格式剪贴板）；仅对实际命中
      // 的单键普通粘贴放行，不覆盖浮层命令或两段键。
      if (nativePaste && result.kind === 'command' && result.id === 'paste' &&
          (chord === 'ctrl+v' || chord === 'meta+v')) return true
      event.preventDefault()
      if (result.kind === 'prefix') {
        this.prefix = { step, scope, context }
        this.timer = setTimeout(() => this.cancel(), 1200)
      } else {
        this.execute(result.id)
      }
      return true
    }
    return false
  }
}
