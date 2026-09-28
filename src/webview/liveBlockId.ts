// 块 id 标记 live 淡化装饰（#163 验收反馈）：行尾 ` ^id` 与独立行 `^id`
// 双形态发射 mark 装饰（类 vsidian-block-id，正文前景低混入淡化——见
// main.css 与 styleContract 条目 block-id-mark）。识别同源于 shared/blockId
// （BLOCK_ID_LINE_RE / STANDALONE_BLOCK_ID_RE + 围栏状态机），围栏内部
// 是代码内容不命中；闭围栏行行尾标记是围栏块自身的 id，命中。
//
// 装饰为常显（无光标交互态——块 id 是结构标记，复制块链接入口在右键
// 菜单/快捷键，不经光标显形）。StateField 全量行扫描重建（docChanged）：
// 与 mermaidFencesField 同款形态（单 RE 逐行，10 万行档位成本可忽略），
// 不走 Lezer 树（标记是行级形态学，语法树不产节点）。
import { Range, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import {
  BLOCK_ID_LINE_RE,
  STANDALONE_BLOCK_ID_RE,
  fenceMarkerOf,
} from '../shared/blockId'

const blockIdMarkDeco = Decoration.mark({ class: 'vsidian-block-id' })

/** 全文块 id 标记区间扫描（LF 坐标）：行尾形态 = 前导空白到行尾（含尾随
 *  空白），独立行形态 = 整行；按文档序有序返回 */
export function buildBlockIdMarkRanges(doc: Text): Array<Range<{ class: string }>> {
  const out: Array<Range<{ class: string }>> = []
  let fenceChar: string | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const text = line.text
    const marker = fenceMarkerOf(text)
    if (fenceChar !== null) {
      if (marker === fenceChar) {
        fenceChar = null // 闭围栏行：行尾标记是围栏块自身的 id（下落检查）
      } else {
        continue // 围栏内部（非闭围栏行）：^id 是代码内容
      }
    } else if (marker !== null) {
      fenceChar = marker
      continue // 开围栏行的 ^ 属 info string
    }
    // 独立行整行淡化优先（行尾形态要求前置正文，两者互斥）
    if (STANDALONE_BLOCK_ID_RE.test(text)) {
      out.push(blockIdMarkDeco.range(line.from, line.to))
      continue
    }
    const m = BLOCK_ID_LINE_RE.exec(text)
    if (m !== null) {
      out.push(blockIdMarkDeco.range(line.from + m.index, line.to))
    }
  }
  return out
}

/** 块 id 标记装饰表（docChanged 全量重建） */
export const blockIdMarkField = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(buildBlockIdMarkRanges(state.doc))
  },
  update(value, tr) {
    if (!tr.docChanged) {
      return value
    }
    return Decoration.set(buildBlockIdMarkRanges(tr.state.doc))
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 块 id 标记淡化扩展（syncController 装配） */
export const liveBlockId: Extension = [blockIdMarkField]
