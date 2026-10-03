import { ChangeSet, Text } from '@codemirror/state'
import type { DocumentChangeReason, PasteHistory, SerChange } from '../shared/protocol'

interface Entry { forward: ChangeSet; inverse: ChangeSet; paste?: PasteHistory }

/** 只观察宿主事件并解释粘贴阶段。此表从不写文档，也不执行 undo/redo。
 *  普通事件参与次序对账；原生编辑器合并多笔输入时允许匹配无粘贴阶段的后缀。
 *  未知历史保守失去归属，不能用相等全文冒认某次粘贴。 */
export class PasteHistoryTracker {
  private current: Text
  private readonly undo: Entry[] = []
  private readonly redo: Entry[] = []

  constructor(text: string) { this.current = Text.of(text.split('\n')) }

  observe(changes: SerChange[], afterText: string, reason?: DocumentChangeReason, paste?: PasteHistory): PasteHistory | undefined {
    let actual: ChangeSet
    let after: Text
    try {
      actual = ChangeSet.of(changes.map(c => ({ from: c.offset, to: c.offset + c.length, insert: c.text })), this.current.length)
      after = actual.apply(this.current)
      if (after.toString() !== afterText) throw new Error('history event mismatch')
    } catch {
      this.undo.length = this.redo.length = 0
      this.current = Text.of(afterText.split('\n'))
      return undefined
    }
    if (after.eq(this.current)) return undefined
    const inverse = actual.invert(this.current)
    this.current = after
    if (!reason) {
      this.undo.push({ forward: actual, inverse, ...(paste ? { paste } : {}) })
      this.redo.length = 0
      return undefined
    }
    const source = reason === 'undo' ? this.undo : this.redo
    const target = reason === 'undo' ? this.redo : this.undo
    let composed: ChangeSet | undefined
    for (let i = source.length - 1; i >= 0; i--) {
      const entry = source[i]!
      // WorkspaceEdit 的阶段有独立历史边界，不跨过去猜普通编辑的合并组。
      if (i !== source.length - 1 && entry.paste) break
      const part = reason === 'undo' ? entry.inverse : entry.forward
      composed = composed ? composed.compose(part) : part
      if (JSON.stringify(composed.toJSON()) !== JSON.stringify(actual.toJSON())) continue
      const qualified = i === source.length - 1 ? entry.paste : undefined
      source.splice(i)
      target.push(reason === 'undo'
        ? { forward: inverse, inverse: actual, ...(qualified ? { paste: qualified } : {}) }
        : { forward: actual, inverse, ...(qualified ? { paste: qualified } : {}) })
      return qualified
    }
    this.undo.length = this.redo.length = 0
    return undefined
  }
}
