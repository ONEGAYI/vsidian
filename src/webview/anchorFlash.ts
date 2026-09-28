// 跳转目标高亮 live 装饰（#163 验收反馈）：双链/普通链接锚点跳转
// （view.locate 通道）后目标标题/段落整体覆盖半透黄（类
// vsidian-anchor-flash，颜色经 --vsidian-anchor-flash-background 变量
// 暴露——见 main.css 与 styleContract 条目 anchor-flash），用户任意操作
// （点击、滚动、按键、切走页面）后由 syncController 的消失监听清除
// （anchorFlashClear effect）。
//
// 目标整体区间 = 标题行整行（ATX 单行即标题整体）或定位行所属整块
// （blockRangeOfLine 同源口径——与 findBlockOffset 跳转落位逐字节一致；
// 围栏块 id 跳转时整围栏高亮）。行级 line decoration 逐行发射。
import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { atxHeadingOf, blockRangeOfLine } from '../shared/blockId'

/** 高亮目标区间（LF 坐标，闭区间按文档偏移）；null = 清除 */
export interface AnchorFlashRange {
  from: number
  to: number
}

const flashLineDeco = Decoration.line({ class: 'vsidian-anchor-flash' })

/** 设置高亮（null 清除）——syncController 定位事务并入发射 */
export const anchorFlashSet = StateEffect.define<AnchorFlashRange | null>()

/** 清除高亮（消失监听触发）——语义同 set(null)，意图自明 */
export const anchorFlashClear = StateEffect.define<null>()

/** 定位行 → 高亮整体区间：标题行整行 / 行所属整块（空行防御性单行回退） */
export function anchorFlashRangeOf(doc: Text, pos: number): AnchorFlashRange {
  const line = doc.lineAt(pos)
  if (atxHeadingOf(line.text) !== null) {
    return { from: line.from, to: line.to }
  }
  const lines = doc.toString().split('\n')
  const range = blockRangeOfLine(lines, line.number - 1)
  if (range === null) {
    return { from: line.from, to: line.to }
  }
  return { from: doc.line(range.start + 1).from, to: doc.line(range.end + 1).to }
}

function flashDecorations(range: AnchorFlashRange | null, doc: Text): DecorationSet {
  if (range === null) {
    return Decoration.none
  }
  const decos: ReturnType<typeof flashLineDeco.range>[] = []
  const fromLine = doc.lineAt(Math.max(0, Math.min(range.from, doc.length)))
  const toLine = doc.lineAt(Math.max(0, Math.min(range.to, doc.length)))
  for (let n = fromLine.number; n <= toLine.number; n++) {
    decos.push(flashLineDeco.range(doc.line(n).from))
  }
  return Decoration.set(decos, true)
}

/** 高亮行装饰表（effect 驱动，随定位事务更新） */
export const anchorFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    // 编辑 = 用户操作：高亮即失效（「任意操作后消失」语义；同时免去区间
    // 随变更映射的复杂性）
    if (tr.docChanged) {
      return Decoration.none
    }
    for (const e of tr.effects) {
      if (e.is(anchorFlashSet)) {
        value = flashDecorations(e.value, tr.state.doc)
      } else if (e.is(anchorFlashClear)) {
        value = Decoration.none
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 跳转目标高亮扩展（syncController 装配） */
export const anchorFlash: Extension = [anchorFlashField]
