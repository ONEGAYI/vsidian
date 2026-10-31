// T04（#672）：CM6 原生 BlockWrapper 承载 Live callout 容器——结构层。
// 探针报告（docs/research/callout-blockwrapper-probe.md）勘误后口径：
// - 区间直接消费解析器节点区间（识别单一事实源 liveDecorations 的
//   calloutOfBlockquote）：from 对齐标题行行首（内层 node.from 落在第二个
//   `>` 上，直接使用会使内层标题行逃出内层盒——探针 S1 实证）、to 取节点
//   尾行行尾。懒延续行（含带较少 `>` 前缀的外层行与无前缀行）留在内层
//   容器——与 Reading 双端一致（calloutParity F17/F38/F44；BlockWrapper 按
//   行/块**起点**归属，from ≤ 行首 < to 即整行入盒）。
// - rank 外层大内层小（数值小者嵌内层）：60 − 10 × 引用深度，三层内验证。
// - 硬约束：wrapper 禁垂直 margin（探针 S1b/S1c——margin 不入 posAtCoords
//   记账产生确定性错行；间距一律 padding 表达）。
// - 本票只做结构（内部类名），公开类名/容器视觉迁移归 T05（#673）。
// - 边界：列表内 callout（Blockquote 位于 ListItem 容器内）与引用嵌入实例
//   不接 wrapper（维持行级形态 / 根正文独有装配）；wrapper 全量重推导随
//   文档事务，成本为容器节点剪枝遍历（callout 数量级），10 万行档位性能
//   未测（报告 §6）。
import { type EditorState, type Extension, RangeSet, StateField } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import { BlockWrapper, EditorView } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { docInput, FM_SCAN_LIMIT, frontmatterRange, markdownTreeParser } from '../shared/markdownDoc'
import { calloutOfBlockquote, calloutWrapFacet, liveDecorationsField } from './liveDecorations'

/** wrapper 区间派生产物（纯数据——单测与浏览器断言共用口径） */
export interface CalloutWrapRange {
  /** 标题行行首（行对齐起点） */
  from: number
  /** 尾行行尾 */
  to: number
  /** 引用嵌套深度（1 起）——rank 与 data-callout-depth 的派生源 */
  depth: number
  /** callout 类型标识（识别源 calloutOfBlockquote；公开承接归 T05） */
  type: string
}

/** 引用深度 → wrapper rank（外层大内层小：数值小者嵌内层，0-100 语义） */
export function calloutWrapRank(depth: number): number {
  return 60 - depth * 10
}

/** 块级剪枝遍历白名单（与 liveDecorations.CALLOUT_CONTAINER_NAMES 同集） */
const WRAP_DESCEND_NAMES = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/**
 * 全量派生 callout wrapper 区间（纯函数）：沿容器块剪枝下探枚举 Blockquote，
 * 命中 callout 声明即产区间；fmEnd 之前（frontmatter 区域）不产。列表内
 * callout（v1 边界）跳过但继续下探（其嵌套亦在列表内，同界排除）。
 */
export function collectCalloutWrappers(tree: Tree, doc: Text, fmEnd = 0): CalloutWrapRange[] {
  const out: CalloutWrapRange[] = []
  const descend = (node: SyntaxNode, quoteDepth: number, inList: boolean): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'Blockquote') {
        const info = calloutOfBlockquote(doc, child)
        if (info && !inList && doc.line(info.titleLineNo).from >= fmEnd) {
          out.push({
            from: doc.line(info.titleLineNo).from,
            to: doc.line(info.lastLineNo).to,
            depth: quoteDepth + 1,
            type: info.decl.type,
          })
        }
        descend(child, quoteDepth + 1, inList)
      } else if (WRAP_DESCEND_NAMES.has(child.name)) {
        descend(child, quoteDepth, inList || child.name !== 'Blockquote')
      }
    }
  }
  descend(tree.topNode, 0, false)
  return out
}

/** 派生并构建 wrapper RangeSet；树优先复用 liveDecorationsField 的增量
 *  解析结果（本字段在其后注册，tr.state 槽位惰性求值可读新值），缺席
 *  （裸装配场景）回退全量解析 */
function buildWrappers(state: EditorState): RangeSet<BlockWrapper> {
  const deco = state.field(liveDecorationsField, false)
  const tree = deco ? deco.tree : markdownTreeParser.parse(docInput(state.doc))
  const fmEnd = deco?.fm?.end ??
    frontmatterRange(state.doc.sliceString(0, Math.min(state.doc.length, FM_SCAN_LIMIT)))?.end ?? 0
  const wraps = collectCalloutWrappers(tree, state.doc, fmEnd)
  if (wraps.length === 0) {
    return BlockWrapper.set([])
  }
  return BlockWrapper.set(
    wraps.map((w) => BlockWrapper.create({
      tagName: 'div',
      // T05（#673）公开契约承接：.callout 主类与 data-callout 类型属性迁
      // wrapper（与阅读容器同款入口）；vsidian-callout-wrap 是 Live 承载层
      // 内部标记（CSS 作用域）；data-callout-depth 公开分层样式入口
      // （嵌套 wrapper DOM 天然承载 .callout .callout 后代选择器——
      // V01 §4.2 data-callout-lN 提案由此免新增属性族）
      attributes: {
        class: 'vsidian-callout-wrap callout',
        'data-callout': w.type,
        'data-callout-depth': String(w.depth),
      },
      rank: calloutWrapRank(w.depth),
    }).range(w.from, w.to)),
    true,
  )
}

/** callout 容器 wrapper 区间源（StateField：块级结构禁止经插件发射，CM6
 *  约束；区间只依赖文档与解析树，纯选区/facet 事务不重建） */
export const liveCalloutWrappersField = StateField.define<RangeSet<BlockWrapper>>({
  create: buildWrappers,
  update(value, tr) {
    return tr.docChanged ? buildWrappers(tr.state) : value
  },
  provide: (field) => EditorView.blockWrappers.from(field),
})

/** T04/T05 装配单元：根正文 Live（syncController.rootOwnedViewExtensions
 *  注入；引用嵌入实例不装配——行级形态保留）。facet 开关同时驱动
 *  liveDecorations 发射侧行级让位（wrapper 在场才让位，见 calloutWrapFacet） */
export const liveCalloutWrap: Extension = [calloutWrapFacet.of(true), liveCalloutWrappersField]
