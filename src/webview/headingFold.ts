// Live 正文标题折叠本体（#412 T01，规格 docs/specs/heading-fold.md）：
// StateField 承载折叠键集合 + effect 驱动 + 消费点增量树直查的区间派生
// + 隐藏装饰 + 光标迁移 + 五操作执行体（#413 T02：键位与命令面板双入口
// 共用）+ gutter 折叠箭头与省略号占位 UI（#414 T03）。落点展开联动由
// T04 在其上生长，#410 API 只消费派生视图。
//
// 折叠语义（规格「二、折叠本体与坐标生命周期」）：
// - 折叠是**视图态**：零写回、不 dirty、不进撤销栈、不跨会话持久化
//   （形态对齐 codeCardFoldField——值按「已折叠标题行行首位置」标识，
//   docChanged 时随 ChangeSet 映射 mapPos(pos, 1)）。
// - update 只做位置映射、不做修剪：脱靶键（删除标题行/拆行后落在非标题
//   行首的残留）经派生视图过滤，天然无行为——原始键集不对外（含 API 面）。
// - 全文替换（init / doc.resync 的「覆盖全文档的变更」）显式清空——重开
//   等价语义，不依赖映射落点的隐式失效。
// - 撤销恢复被删标题回到未折叠：撤销栈归宿主文本管线，webview 侧收到
//   的是回流增量（externalSync 事务），键已在删除时脱靶——既定架构边界，
//   不为此引入本地撤销栈。
//
// 标题表派生选**路线 2**（票面保留的两路线之一）：消费点经增量树直查
// （extractOutline 双入口形态——liveDecorationsField 维护的树传入复用，
// 省略时全量解析），不建 mermaidFencesField 式增量标题表。理由：
// - 标题口径单一事实源是语法树节点（headingLevelOf + frontmatter 排除），
//   增量树已由 liveDecorationsField 随每笔事务增量维护，直查不重复解析、
//   无「每次 docChanged 全文档重扫」；
// - 折叠集为空的常规编辑：装饰重建先判键集空即返回；箭头插件的
//   foldable 派生走 (doc, tree) 共享缓存（同一 doc 版本内四处消费共享
//   一次计算），rangeHasNonSpace 正文行首行早退、均摊 ~O(1) 行/标题
//   ——空白行密集的骨架稿是已知最坏面（#417 评审轮档位实测：空白行
//   密集文档的箭头派生耗时随空白行占比线性增长，常规文档不可感知）；
// - 块级剪枝遍历（只下降容器块节点）把直查成本压到 O(块节点数)，与
//   extractOutline 的语义等价由对拍单测钉住（含容器白名单完整性）。
//
// effect 驱动纪律（规格「八、附加组件开放面预留」）：折叠/展开一律
// StateEffect + dispatch，无 DOM-only 路径——API 编程触发与用户触发同链路。
// 查询一律 (field, doc) 纯函数派生，不依赖控制器/UI 在场。
import { EditorSelection, RangeSet, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { liveDecorationsField } from './liveDecorations'
import { t } from '../shared/i18n'
import { TOOLTIP_KEYS_SEPARATOR } from './tooltipCard'
import type { HeadingFoldPaintProbe } from '../shared/protocol'
import {
  FM_SCAN_LIMIT,
  docInput,
  frontmatterRange,
  headingLevelOf,
  markdownTreeParser,
} from '../shared/markdownDoc'

/** 能包含标题的容器块节点名（块级剪枝遍历的下降白名单：其余块节点——
 *  段落/围栏/表格/水平线等——不产标题节点，不下降；白名单完整性由与
 *  extractOutline 的对拍单测钉住） */
const HEADING_CONTAINER_NAMES = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

/** 标题表条目：折叠派生消费的最小形态（extractOutline 的轻量子集） */
export interface HeadingInfo {
  /** 折叠键：标题起始行行首 offset（ATX = `#` 行行首；Setext = 内容首行行首） */
  key: number
  /** 标题级别（ATX 1–6 / Setext 1–2，headingLevelOf 单一事实源） */
  level: number
  /** 标题块行尾（ATX = 标题行行尾；Setext = 下划线行行尾）——隐藏区间起点 */
  visibleTo: number
}

/** 有效折叠区间（派生视图产出；纯 (keys, headings, doc) 函数） */
export interface HeadingFoldSpan {
  /** 折叠键（标题起始行行首） */
  key: number
  /** 标题级别 */
  level: number
  /** 隐藏区间起点：标题块行尾（标题行保持可见） */
  hideFrom: number
  /** 隐藏区间终点：下一级别 ≤ level 的标题行行首，或文档末尾 */
  hideTo: number
}

// ---- 标题提取（消费点直查，路线 2） ----

/**
 * 标题序列提取（extractOutline 双入口形态）：tree 传入时直接取用
 * （liveDecorationsField 维护的增量树，与 doc 须同一 state），省略时
 * 全量解析。标题口径 = headingLevelOf + frontmatter 头块排除（与大纲
 * 提取同判定）；代码围栏内不产标题节点，天然排除。块级剪枝遍历：只
 * 下降容器块（引用/列表），标题节点与叶子块不进入——遍历成本 O(块级
 * 节点数)，不随行内标记数量增长。
 */
export function collectHeadings(doc: Text, tree?: Tree): HeadingInfo[] {
  const parsed: Tree = tree ?? markdownTreeParser.parse(docInput(doc))
  const fm = frontmatterRange(doc.sliceString(0, Math.min(doc.length, FM_SCAN_LIMIT)))
  const fmEnd = fm ? fm.end : 0
  const out: HeadingInfo[] = []
  const descend = (node: SyntaxNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= fmEnd) {
        continue // 完全在头块内：不产条目（头块按源码呈现）
      }
      const level = headingLevelOf(child.name)
      if (level !== null) {
        if (child.from >= fmEnd) {
          out.push({
            key: doc.lineAt(child.from).from,
            level,
            // 标题块行尾：ATX 节点 to 在标题行内、Setext 在下划线行内，
            // 取所在行行尾即标题块可见末尾（extractOutline headingTo 同口径）
            visibleTo: doc.lineAt(child.to).to,
          })
        }
        continue // 标题节点的子节点（HeaderMark/Inline）不产标题
      }
      if (HEADING_CONTAINER_NAMES.has(child.name) || child.from < fmEnd) {
        descend(child) // 容器块，或与头块相交（内部仍可能有头块后内容）
      }
    }
  }
  descend(parsed.topNode)
  return out
}

// ---- 区间派生（纯函数） ----

/**
 * 全部标题的节区间 join（不判可折叠）：spans[i] 与 headings[i] 对齐，
 * 按文档序产出。节末 = 右侧第一个级别 ≤ 自身的标题行首（单调栈自后向
 * 前一趟），文档内无此类标题则到文档末尾——跨级辖域与大纲父子结构
 * outlineCollapseFacts 同构（正文折叠不消费大纲索引）。
 */
function headingSpansOf(headings: readonly HeadingInfo[], docLength: number): HeadingFoldSpan[] {
  const spans: HeadingFoldSpan[] = new Array(headings.length)
  const stack: number[] = [] // 索引栈，自底向顶级别递增（右侧「更浅候选」）
  for (let i = headings.length - 1; i >= 0; i--) {
    const h = headings[i]!
    while (stack.length > 0 && headings[stack[stack.length - 1]!]!.level > h.level) {
      stack.pop()
    }
    const next = stack.length > 0 ? headings[stack[stack.length - 1]!]! : null
    spans[i] = {
      key: h.key,
      level: h.level,
      hideFrom: h.visibleTo,
      hideTo: next ? next.key : docLength,
    }
    stack.push(i)
  }
  return spans
}

/** [from, to) 内存在至少一个非空白字符（可折叠判定核心；逐行扫避免大区间整段复制） */
function rangeHasNonSpace(doc: Text, from: number, to: number): boolean {
  let pos = from
  while (pos < to) {
    const line = doc.lineAt(pos)
    if (doc.sliceString(Math.max(line.from, pos), Math.min(line.to, to)).trim() !== '') {
      return true
    }
    pos = line.to + 1
  }
  return false
}

/**
 * 全部可折叠标题区间（foldAll 的目标全集；纯派生）：隐藏区间内存在至少
 * 一个非空白字符才可折叠——相邻标题（区间为空或仅空白）不可折叠。
 */
export function foldableHeadingSpans(headings: readonly HeadingInfo[], doc: Text): HeadingFoldSpan[] {
  return headingSpansOf(headings, doc.length).filter((s) => rangeHasNonSpace(doc, s.hideFrom, s.hideTo))
}

/** 可折叠集共享缓存：同一 doc 版本（Text 对象身份——每笔编辑即新对象，
 *  天然失效）与同一增量树引用下，箭头插件重建、foldAll 执行、箭头点击
 *  命中判定与 #410 foldable 查询共享一次 foldable 派生（审查轮 F3：
 *  消除同一事务内的重复逐 span 扫描）。装饰侧只在键集非空时按键计算、
 *  不走本缓存。成本口径：rangeHasNonSpace 逐行扫描、正文行首行命中即
 *  早退（均摊 ~O(1) 行/标题）；空白行密集的骨架稿是已知最坏面（#417
 *  评审轮以空白行密集档实测确认量级，可按同构造文档复测）。 */
const foldableCache = new WeakMap<Text, { tree: Tree | undefined; spans: HeadingFoldSpan[] }>()

/** (doc, tree) → 可折叠集（共享缓存派生；树引用变化时重算） */
export function foldableSpansCached(doc: Text, tree: Tree | undefined): HeadingFoldSpan[] {
  const hit = foldableCache.get(doc)
  if (hit && hit.tree === tree) {
    return hit.spans
  }
  const spans = foldableHeadingSpans(collectHeadings(doc, tree), doc)
  foldableCache.set(doc, { tree, spans })
  return spans
}

/**
 * 有效折叠派生视图（#410 API 面唯一查询口径）：折叠键 ∩ 可折叠标题键，
 * 逐键 join 结构区间。原始键集不对外——脱靶键（不在可折叠标题行行首的
 * 残留）经此过滤天然无行为。
 */
export function effectiveHeadingFolds(
  foldKeys: ReadonlySet<number>,
  headings: readonly HeadingInfo[],
  doc: Text,
): HeadingFoldSpan[] {
  const out: HeadingFoldSpan[] = []
  for (const span of headingSpansOf(headings, doc.length)) {
    if (foldKeys.has(span.key) && rangeHasNonSpace(doc, span.hideFrom, span.hideTo)) {
      out.push(span)
    }
  }
  return out
}

/**
 * 区间 [from, to) 是否被任一有效折叠隐藏（#419 阅读侧块过滤的唯一判定
 * 入口——区间语义单一事实源，阅读侧不复制派生逻辑）：块区间与隐藏区
 * (hideFrom, hideTo) 开区间相交即隐藏。标题块 end 恰为 hideFrom、下一
 * 标题块 start 恰为 hideTo，均不落在开区间内，天然保持可见；部分相交
 * 的块同样隐藏（与 Live 侧 Decoration.replace 覆盖语义一致）。
 */
export function rangeFoldHidden(
  folds: readonly HeadingFoldSpan[],
  from: number,
  to: number,
): boolean {
  for (const f of folds) {
    if (from < f.hideTo && to > f.hideFrom) {
      return true
    }
  }
  return false
}

// ---- 折叠目标解析（辖域标题，规格「三、折叠与光标/选区」） ----

/** 辖域标题：光标所在行是标题行 → 该标题；否则向上最近标题（任意级别）。
 *  统一公式 = 最后一个 key ≤ pos 的标题（标题行内命中自身、正文区命中
 *  上方最近）。首个标题之前返回 null。 */
export function enclosingHeading(headings: readonly HeadingInfo[], pos: number): HeadingInfo | null {
  const idx = enclosingHeadingIdx(headings, pos)
  return idx >= 0 ? headings[idx]! : null
}

/** enclosingHeading 的索引形态（解析函数内部复用；-1 无辖域） */
function enclosingHeadingIdx(headings: readonly HeadingInfo[], pos: number): number {
  let lo = 0
  let hi = headings.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (headings[mid]!.key <= pos) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * 折叠目标解析：从 startIdx（辖域）沿祖先链自近及远，找第一个「可折叠
 * 且未折叠」的标题——辖域未折叠即辖域自身；已折叠则逐层外扩（VSCode
 * 语义）。无 → null（静默 no-op）。祖先链 = 前方级别严格更浅的标题
 * （跨级自然辖域化，链上级别单调递减）。
 */
function nearestFoldableUnfolded(
  spans: readonly HeadingFoldSpan[],
  foldKeys: ReadonlySet<number>,
  doc: Text,
  startIdx: number,
): number | null {
  let minLevel = Infinity
  for (let i = startIdx; i >= 0; i--) {
    const s = spans[i]!
    if (s.level >= minLevel) {
      continue // 非祖先链上的（同级或更深）
    }
    minLevel = s.level
    if (!foldKeys.has(s.key) && rangeHasNonSpace(doc, s.hideFrom, s.hideTo)) {
      return s.key
    }
  }
  return null
}

/** 逐 selection range 解析并集去重（非空选区/多光标口径：折叠无破坏性，
 *  不收敛主选区）；解析无目标的 range 不贡献键。回调经闭包捕获折叠集 */
function resolveTargets(
  headings: readonly HeadingInfo[],
  doc: Text,
  selection: EditorSelection,
  resolveRange: (idx: number, spans: readonly HeadingFoldSpan[], head: number) => number | null,
): number[] {
  const spans = headingSpansOf(headings, doc.length)
  const targets = new Set<number>()
  for (const range of selection.ranges) {
    const idx = enclosingHeadingIdx(headings, range.head)
    if (idx < 0) {
      continue
    }
    const hit = resolveRange(idx, spans, range.head)
    if (hit !== null) {
      targets.add(hit)
    }
  }
  return [...targets]
}

/** 折叠操作目标键集：辖域可折叠且未折叠 → 折之；已折叠 → 上溯最近未折叠
 *  祖先折叠（连续折叠逐层外扩）；无目标 → 空集（静默 no-op） */
export function resolveHeadingFoldTargets(
  headings: readonly HeadingInfo[],
  foldKeys: ReadonlySet<number>,
  doc: Text,
  selection: EditorSelection,
): number[] {
  return resolveTargets(headings, doc, selection, (idx, spans) =>
    nearestFoldableUnfolded(spans, foldKeys, doc, idx))
}

/** 展开操作目标键集：辖域标题已折叠（有效折叠）→ 展之；否则展开包含
 *  光标的最深已折叠区间；再无 → 空集 */
export function resolveHeadingUnfoldTargets(
  headings: readonly HeadingInfo[],
  foldKeys: ReadonlySet<number>,
  doc: Text,
  selection: EditorSelection,
): number[] {
  return resolveTargets(headings, doc, selection, (idx, spans, head) => {
    const self = spans[idx]!
    if (foldKeys.has(self.key) && rangeHasNonSpace(doc, self.hideFrom, self.hideTo)) {
      return self.key
    }
    let best: HeadingFoldSpan | null = null
    for (const s of spans) {
      if (!foldKeys.has(s.key) || rangeHasNonSpace(doc, s.hideFrom, s.hideTo) === false) {
        continue
      }
      // 包含光标（隐藏区开区间：标题行行尾到节末）
      if (head < s.hideFrom || head >= s.hideTo) {
        continue
      }
      if (!best || s.hideTo - s.hideFrom < best.hideTo - best.hideFrom) {
        best = s
      }
    }
    return best ? best.key : null
  })
}

/** 切换操作目标键集：辖域标题两态取反（不外扩；调用方按目标键当前在否
 *  翻转）。辖域不可折叠 → 无目标 */
export function resolveHeadingToggleTargets(
  headings: readonly HeadingInfo[],
  doc: Text,
  selection: EditorSelection,
): number[] {
  const targets = new Set<number>()
  const spans = headingSpansOf(headings, doc.length)
  for (const range of selection.ranges) {
    const idx = enclosingHeadingIdx(headings, range.head)
    if (idx < 0) {
      continue
    }
    const self = spans[idx]!
    if (rangeHasNonSpace(doc, self.hideFrom, self.hideTo)) {
      targets.add(self.key)
    }
  }
  return [...targets]
}

// ---- 光标迁移（折叠瞬间） ----

/**
 * 折叠事务的选区迁移计算（纯函数）：任一 range 与被隐藏区间相交（标题
 * 行本身不算——hideFrom 已是标题块行尾）时迁移到该区间标题行行尾
 * （collapse 为空选区）；其余 range 保留。多区间嵌套时取包含该 range 的
 * 最深区间（离光标最近的可见锚点）。返回 null 表示无需迁移。
 */
export function migrateSelectionForFold(
  selection: EditorSelection,
  folds: readonly HeadingFoldSpan[],
): EditorSelection | null {
  let ranges: ReturnType<typeof EditorSelection.cursor>[] | null = null
  for (let i = 0; i < selection.ranges.length; i++) {
    const r = selection.ranges[i]!
    let hit: HeadingFoldSpan | null = null
    for (const f of folds) {
      if (r.to > f.hideFrom && r.from < f.hideTo) {
        if (!hit || f.hideTo - f.hideFrom < hit.hideTo - hit.hideFrom) {
          hit = f
        }
      }
    }
    if (hit) {
      ;(ranges ??= selection.ranges.slice())[i] = EditorSelection.cursor(hit.hideFrom)
    }
  }
  return ranges ? EditorSelection.create(ranges, selection.mainIndex) : null
}

// ---- StateField：折叠键集合 ----

/** 折叠集整体设置 effect（全部折叠操作的唯一生效通道——箭头/toggleFold
 *  的单键翻转经 toggleHeadingFoldAt 组合出下一集后同样走本 effect；
 *  #418 移除了曾并存的 headingFoldToggle 裸翻转 effect：生产无派发方
 *  （测试直驱除外），双通道只会分叉行为——「先应用后映射」语义也由
 *  本 effect 单通道承载） */
export const headingFoldSet = StateEffect.define<ReadonlySet<number>>()

const EMPTY_FOLD: ReadonlySet<number> = new Set<number>()

/**
 * 折叠状态（#412 T01）：已折叠标题的标题行行首位置集合。视图态（零写回、
 * 不 dirty、不进撤销栈、不跨会话持久化）。docChanged 时键随 ChangeSet
 * 映射（mapPos(pos, 1)，assoc=1 对齐 codeCardFoldField）；effect 键按
 * dispatch 时（startState）坐标解释，先应用后映射；覆盖全文档的变更
 * （init / doc.resync）显式清空——重开等价语义。
 */
export const headingFoldField = StateField.define<ReadonlySet<number>>({
  create: () => EMPTY_FOLD,
  update(value, tr) {
    if (tr.docChanged) {
      const oldLength = tr.startState.doc.length
      let fullReplace = false
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA === 0 && toA === oldLength) {
          fullReplace = true
        }
      })
      if (fullReplace) {
        return EMPTY_FOLD
      }
    }
    let next = value
    let changed = false
    for (const eff of tr.effects) {
      if (eff.is(headingFoldSet)) {
        next = eff.value
        changed = true
      }
    }
    if (tr.docChanged) {
      if (next.size === 0) {
        // 空集无映射必要：返回共享引用，避免每笔键入分配新 Set 使
        // foldChanged 引用比较恒真（箭头/装饰重建门槛保持真实判定）
        return EMPTY_FOLD
      }
      const mapped = new Set<number>()
      for (const pos of next) {
        mapped.add(tr.changes.mapPos(pos, 1))
      }
      next = mapped
      changed = true
    }
    return changed ? next : value
  },
})

// ---- 隐藏装饰（T03 起带省略号占位 widget） ----

/**
 * 折叠控件按钮 DOM 工厂（Live gutter 箭头 marker、Live 省略号 widget 与
 * #419 阅读态标题装饰共用）：可访问形态（aria-label + aria-expanded +
 * data-tooltip 悬停词 + data-tooltip-keys 结构化键位徽章）、防夺焦
 * mousedown（#190/#414 同口径）与 SVG 笔画一致；click 回调可选——Live
 * gutter 箭头的点击由 gutter domEventHandlers 统一处理（不绑 click，
 * 防冒泡双触发），阅读态与省略号形态自带 click。类名族由调用方给定
 * （Live 的 vsidian-fold-* 与阅读的 vsidian-reading-fold-* 各自契约登记）。
 */
export function createHeadingFoldControlButton(spec: {
  /** 折叠中 = true（aria-expanded false、悬停词「展开」、箭头右向） */
  folded: boolean
  /** 省略号占位形态（'⋯' 行内常驻提示）；false = 箭头 chevron 形态 */
  ellipsis: boolean
  /** 完整类名（含折叠修饰，由调用方拼装） */
  className: string
  /** click 回调；省略 = 不绑定（Live gutter 路径） */
  onToggle?: () => void
}): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = spec.className
  const word = spec.folded || spec.ellipsis ? 'headingfold.unfold' : 'headingfold.fold'
  btn.setAttribute('aria-label', t(word))
  // aria-expanded 反映当前内容态（对齐 buildFoldButton：折叠中 = false）
  btn.setAttribute('aria-expanded', spec.folded || spec.ellipsis ? 'false' : 'true')
  btn.setAttribute('data-tooltip', t(word))
  applyFoldBindingHint(btn, spec.folded || spec.ellipsis ? 'headingUnfold' : 'headingFold')
  if (spec.ellipsis) {
    btn.textContent = '⋯'
  } else {
    // 图标与代码卡 chevron 同款笔画；折叠态转向由 CSS 修饰类旋转（右向）
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"></path></svg>'
  }
  // #190/#414 同口径：防 CM6 落选区（replace widget 行内场景）与点击夺焦
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  if (spec.onToggle) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      spec.onToggle!()
    })
  }
  return btn
}

/**
 * 折叠态省略号占位 widget（#414 T03，规格「交互入口」节补充形态）：
 * 隐藏区间的常驻「此处有被折叠内容」提示（VSCode 折叠 `...` 预览标记、
 * Obsidian 折叠标题 `⋯` 同款），点击即展开该节。与 gutter 常显箭头分工：
 * 箭头在 gutter（结构操作心智），省略号在行内（内容提示心智）。
 * 可访问形态对齐代码卡 buildFoldButton 先例：aria-label + aria-expanded +
 * data-tooltip 悬停词 + data-tooltip-keys 结构化键位徽章。eq 按 key 判等
 * （装饰重建产新实例时同 key 复用既有 DOM）。
 */
export class HeadingFoldEllipsisWidget extends WidgetType {
  constructor(readonly key: number) {
    super()
  }

  override eq(other: HeadingFoldEllipsisWidget): boolean {
    return other instanceof HeadingFoldEllipsisWidget && other.key === this.key
  }

  override toDOM(view: EditorView): HTMLElement {
    return createHeadingFoldControlButton({
      folded: true,
      ellipsis: true,
      className: 'vsidian-fold-ellipsis',
      onToggle: () => toggleHeadingFoldAt(view, this.key),
    })
  }

  /** 吞事件（liveEmbed 宿主同先例）：widget 内交互自处理，CM6 不当正文点击 */
  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * 折叠隐藏装饰构建（纯 (state) 派生）：键集为空零成本直返；非空时经
 * 消费点增量树直查派生有效折叠区间，逐区间发射多行 Decoration.replace
 * 带省略号占位 widget（标题块保持可见，隐藏区间 = 标题块行尾到节末，
 * 含中间空行）。被隐藏区间内的其他装饰（表格、代码卡、Mermaid 等）随
 * replace 覆盖一并不可见。树来源 liveDecorationsField（未装配时全量解析
 * 防御）。
 */
function buildHeadingFoldDecos(state: import('@codemirror/state').EditorState): DecorationSet {
  const keys = state.field(headingFoldField, false)
  if (!keys || keys.size === 0) {
    return RangeSet.empty
  }
  const tree = state.field(liveDecorationsField, false)?.tree
  const folds = effectiveHeadingFolds(keys, collectHeadings(state.doc, tree), state.doc)
  if (folds.length === 0) {
    return RangeSet.empty
  }
  return RangeSet.of(
    folds.map((f) => Decoration.replace({ widget: new HeadingFoldEllipsisWidget(f.key) }).range(f.hideFrom, f.hideTo)),
    true,
  )
}

/**
 * 折叠隐藏装饰（StateField）：CM6 硬约束——跨行块 replace 必须来自
 * StateField 而非插件装饰集（#59/liveMermaid 同款先例）。重建触发 =
 * 折叠集变化或 docChanged（结构重派生）；选区/视口变化零成本（折叠
 * 呈现不随光标显隐——与代码卡「光标进入显源码」语义不同，折叠只认
 * 折叠集）。
 */
export const headingFoldDecorations = StateField.define<DecorationSet>({
  create: buildHeadingFoldDecos,
  update(value, tr) {
    const foldChanged =
      tr.startState.field(headingFoldField, false) !== tr.state.field(headingFoldField, false)
    if (!tr.docChanged && !foldChanged) {
      return value
    }
    return buildHeadingFoldDecos(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 标题折叠扩展装配（liveInstance 扩展组消费；T03 起含箭头与悬停显现，
 *  总装配见文件末尾——箭头扩展定义于 T03 节） */

/**
 * 折叠集应用入口（effect 直驱 + 光标迁移；键位/箭头/API 编程触发共用）：
 * 以 startState 坐标解释键集，dispatch 单笔零写回事务；新集生效后的有效
 * 折叠区间若与选区相交，同笔事务内迁移（迁移到标题块行尾 collapse 空选
 * 区）。迁移后集合不再含任何 range 所在节时（如纯展开操作）无迁移发生。
 */
export function setHeadingFolds(view: EditorView, next: ReadonlySet<number>): void {
  const spec: import('@codemirror/state').TransactionSpec = {
    effects: headingFoldSet.of(next),
  }
  if (next.size > 0) {
    const tree = view.state.field(liveDecorationsField, false)?.tree
    const folds = effectiveHeadingFolds(next, collectHeadings(view.state.doc, tree), view.state.doc)
    const migrated = migrateSelectionForFold(view.state.selection, folds)
    if (migrated) {
      spec.selection = migrated
    }
  }
  view.dispatch(spec)
}

/** 箭头/省略号点击的统一翻转入口（审查轮 F1 修复）：与键位、命令面板、
 *  API 编程触发同走 setHeadingFolds——折叠方向含光标迁移，两入口行为
 *  不分叉；翻转语义 = 键在集内删除、不在集内加入。 */
export function toggleHeadingFoldAt(view: EditorView, key: number): void {
  const current = view.state.field(headingFoldField, false) ?? EMPTY_FOLD
  const next = new Set(current)
  if (!next.delete(key)) {
    next.add(key)
  }
  setHeadingFolds(view, next)
}

// ---- T02（#413）：五操作执行体（键位本地分支与 ui.command 共用） ----

/** 标题折叠操作 id（#413 五操作；与 keybindings.ts UI_OPERATIONS 的
 *  heading* 条目同一词表——命令面板经 ui.command 回发 op，键位路由
 *  execute(id)，两入口都汇到本执行体） */
export type HeadingFoldOperationId =
  | 'headingFold' | 'headingUnfold' | 'headingToggleFold' | 'headingFoldAll' | 'headingUnfoldAll'

/**
 * 五操作执行体（规格「三、折叠与光标/选区」的操作语义）：目标解析 →
 * 与当前键集合并 → effect 直驱（setHeadingFolds，含光标迁移）。无目标
 * 静默 no-op（不 dispatch）。全程零写回——折叠是视图态，执行域的目标
 * 可用性门控（Live 实例在场/可编辑）由调用方（syncController）经焦点
 * 分派解析后保证，本函数只认传入的 view。
 */
export function applyHeadingFoldOperation(view: EditorView, op: HeadingFoldOperationId): void {
  const state = view.state
  const keys = state.field(headingFoldField, false)
  if (!keys) {
    return
  }
  const tree = state.field(liveDecorationsField, false)?.tree
  const headings = collectHeadings(state.doc, tree)
  switch (op) {
    case 'headingFold': {
      // 辖域可折叠且未折叠 → 折之；已折叠 → 上溯最近未折叠祖先（逐层外扩）
      const targets = resolveHeadingFoldTargets(headings, keys, state.doc, state.selection)
      if (!targets.length) return
      const next = new Set(keys)
      for (const key of targets) next.add(key)
      setHeadingFolds(view, next)
      return
    }
    case 'headingUnfold': {
      // 辖域已折叠 → 展之；否则展开包含光标的最深已折叠区间；再无 → 静默
      const targets = resolveHeadingUnfoldTargets(headings, keys, state.doc, state.selection)
      if (!targets.length) return
      const next = new Set(keys)
      for (const key of targets) next.delete(key)
      setHeadingFolds(view, next)
      return
    }
    case 'headingToggleFold': {
      // 辖域标题两态取反（不外扩）；辖域不可折叠 → 无目标
      const targets = resolveHeadingToggleTargets(headings, state.doc, state.selection)
      if (!targets.length) return
      const next = new Set(keys)
      for (const key of targets) {
        if (!next.delete(key)) next.add(key)
      }
      setHeadingFolds(view, next)
      return
    }
    case 'headingFoldAll': {
      // 全部可折叠标题（空节/纯空白节排除；共享缓存路径）
      const spans = foldableSpansCached(state.doc, tree)
      if (!spans.length) return
      const next = new Set(keys)
      for (const span of spans) next.add(span.key)
      setHeadingFolds(view, next)
      return
    }
    case 'headingUnfoldAll': {
      // 清空折叠集（无折叠零事务）
      if (keys.size === 0) return
      setHeadingFolds(view, EMPTY_FOLD)
      return
    }
  }
}

// ---- T03（#414）：gutter 折叠箭头与悬停显现 ----
// 规格「四、交互入口」推荐定案：悬停编辑器左缘时可折叠标题行 gutter 位
// 置显示向下箭头（点击折叠）；已折叠标题箭头常显且指向右侧（点击展开）。
// 悬停显现 + 折叠态常显 = VSCode 默认策略（alwaysShowFoldControls 关）。
//
// 零布局位移实现（硬约束）：箭头是自定义 gutter 列（`gutter()` API）内
// **绝对定位脱流**的 marker 元素——不参与 .cm-gutters 流内宽度分配（列
// 宽恒 0），不推动正文列；可读行宽档 [.cm-gutters + 间距 + .cm-content]
// 整组居中契约不受影响（viewport-width.md「实施落档」）。marker 伸出到
// 行号列与正文列之间的既有间距区（ln-gap + content padding），行号列
// 开/关两态均落在同一间距区，定位一致。

/** 编辑器武装修饰类（悬停左缘时挂 .cm-editor，驱动未折叠箭头显现） */
export const HEADING_FOLD_HOVER_CLASS = 'vsidian-fold-hover'

/**
 * 悬停显现判定（纯函数）：指针在正文列左缘以左（行号列 + 间距区 +
 * 箭头带——箭头以 right:100% 伸入列右缘左侧，全带在正文左缘之左）即
 * 武装，覆盖行号开/关两态。恰在左缘不武装（正文文本区不触发）。鼠标
 * 停在已显现的箭头上天然保持武装（箭头带整体属武装区）。
 */
export function foldHoverArmed(clientX: number, contentLeft: number): boolean {
  return clientX < contentLeft
}

/**
 * 箭头态集合（纯 (headings, foldKeys, doc) 函数）：全部可折叠标题行 →
 * 折叠态标记。不可折叠标题（空节/纯空白节，可折叠判定驱动）不产生箭头；
 * 已折叠键必属可折叠集（派生视图过滤语义），folded 即常显右向箭头。
 */
export function headingFoldArrowStates(
  headings: readonly HeadingInfo[],
  foldKeys: ReadonlySet<number>,
  doc: Text,
): Array<{ lineFrom: number; folded: boolean }> {
  return arrowStatesFromSpans(foldableHeadingSpans(headings, doc), foldKeys)
}

/** 可折叠集 → 箭头态（共享缓存路径的消费形态） */
function arrowStatesFromSpans(
  spans: readonly HeadingFoldSpan[],
  foldKeys: ReadonlySet<number>,
): Array<{ lineFrom: number; folded: boolean }> {
  return spans.map((span) => ({
    lineFrom: span.key,
    folded: foldKeys.has(span.key),
  }))
}

/** 键位徽章数据源（syncController 经宿主 keybindings 快照注入；缺省空 = 无徽章） */
let foldBindingHints: (op: 'headingFold' | 'headingUnfold') => readonly string[] = () => []

/** 注入折叠/展开操作的生效绑定（data-tooltip-keys 徽章数据——与快速
 *  操作条 quickBindingHints 同源：宿主 keybindings.snapshot/changed 下发） */
export function setHeadingFoldBindingHints(
  resolve: (op: 'headingFold' | 'headingUnfold') => readonly string[],
): void {
  foldBindingHints = resolve
}

/** 悬停词 + 结构化键位徽章（tooltip.md「接管机制」节：不做文字缀尾） */
function applyFoldBindingHint(btn: HTMLElement, op: 'headingFold' | 'headingUnfold'): void {
  const bindings = foldBindingHints(op)
  if (bindings.length > 0) {
    btn.setAttribute('data-tooltip-keys', bindings.join(TOOLTIP_KEYS_SEPARATOR))
  }
}

/** 箭头 marker（官方 FoldMarker 同形态，两态双实例共享；DOM 形态经
 *  createHeadingFoldControlButton 工厂——点击由 gutter domEventHandlers
 *  统一处理，此处不绑 click） */
class HeadingFoldArrowMarker extends GutterMarker {
  constructor(readonly folded: boolean) {
    super()
  }

  override eq(other: HeadingFoldArrowMarker): boolean {
    return other instanceof HeadingFoldArrowMarker && other.folded === this.folded
  }

  override toDOM(): HTMLElement {
    return createHeadingFoldControlButton({
      folded: this.folded,
      ellipsis: false,
      className: this.folded
        ? 'vsidian-fold-arrow vsidian-fold-arrow-collapsed'
        : 'vsidian-fold-arrow',
    })
  }
}

const FOLD_ARROW_UNFOLDED = new HeadingFoldArrowMarker(false)
const FOLD_ARROW_FOLDED = new HeadingFoldArrowMarker(true)

/** 箭头 marker 工厂（测试与探针观测面；态集合 → RangeSet 的桥） */
export function buildHeadingFoldArrowMarker(folded: boolean): GutterMarker {
  return folded ? FOLD_ARROW_FOLDED : FOLD_ARROW_UNFOLDED
}

/** 箭头 markers 维护（官方 foldGutter 的 markers ViewPlugin 同形态）：
 *  全文档可折叠标题集（滚动零重算——RangeSet 由 gutter 按视口自行渲染）；
 *  重建触发 = docChanged / 折叠集变化 / 增量树变化。 */
const headingFoldArrowsPlugin = ViewPlugin.fromClass(
  class {
    markers: RangeSet<GutterMarker>

    constructor(view: EditorView) {
      this.markers = this.build(view.state)
    }

    update(update: import('@codemirror/view').ViewUpdate): void {
      const foldChanged =
        update.startState.field(headingFoldField, false) !== update.state.field(headingFoldField, false)
      const treeChanged =
        update.startState.field(liveDecorationsField, false)?.tree !==
        update.state.field(liveDecorationsField, false)?.tree
      if (!update.docChanged && !foldChanged && !treeChanged) {
        return
      }
      this.markers = this.build(update.state)
    }

    build(state: import('@codemirror/state').EditorState): RangeSet<GutterMarker> {
      const keys = state.field(headingFoldField, false) ?? new Set<number>()
      const tree = state.field(liveDecorationsField, false)?.tree
      // 共享缓存路径（审查轮 F3）：同一 doc 版本内与 foldAll/点击命中/
      // API foldable 查询共享一次 foldable 派生
      const states = arrowStatesFromSpans(foldableSpansCached(state.doc, tree), keys)
      if (states.length === 0) {
        return RangeSet.empty as RangeSet<GutterMarker>
      }
      return RangeSet.of(
        states.map((s) => buildHeadingFoldArrowMarker(s.folded).range(s.lineFrom)),
        true,
      ) as RangeSet<GutterMarker>
    }
  },
)

/** 悬停显现插件：指针位于正文列左缘以左 → 编辑器容器挂武装修饰类（CSS
 *  驱动未折叠箭头 visibility；折叠态常显不依赖本类）。移出编辑器即解除。
 *  事件自绑于 view.dom（.cm-editor 整域，含行号列与间距区）——CM6
 *  ViewPlugin 的 eventHandlers 通道注册在 contentDOM 上，不覆盖 gutter
 *  区的指针移动，武装判定反而收不到事件，故不走该通道。 */
const headingFoldHoverPlugin = ViewPlugin.fromClass(
  class {
    armed = false

    private readonly onPointerMove = (event: PointerEvent): void => {
      try {
        this.setArmed(this.view, foldHoverArmed(event.clientX, this.view.contentDOM.getBoundingClientRect().left))
      } catch {
        // jsdom 无布局：保持现态
      }
    }

    private readonly onPointerLeave = (): void => {
      this.setArmed(this.view, false)
    }

    constructor(private readonly view: EditorView) {
      view.dom.addEventListener('pointermove', this.onPointerMove)
      view.dom.addEventListener('pointerleave', this.onPointerLeave)
    }

    setArmed(view: EditorView, armed: boolean): void {
      if (this.armed === armed) {
        return
      }
      this.armed = armed
      view.dom.classList.toggle(HEADING_FOLD_HOVER_CLASS, armed)
    }

    destroy(): void {
      this.view.dom.removeEventListener('pointermove', this.onPointerMove)
      this.view.dom.removeEventListener('pointerleave', this.onPointerLeave)
      this.view.dom.classList.remove(HEADING_FOLD_HOVER_CLASS)
    }
  },
)

/** 箭头 gutter（零宽列 + 绝对定位 marker；点击经坐标语义按行解析）：
 *  0 宽列收不到点击，命中只能落在可见箭头按钮上（未悬停的 hidden 按钮
 *  不可点击）——天然满足「未悬停不误触发」。 */
const headingFoldGutter = gutter({
  class: 'vsidian-fold-gutter',
  markers(view) {
    return view.plugin(headingFoldArrowsPlugin)?.markers ?? (RangeSet.empty as RangeSet<GutterMarker>)
  },
  domEventHandlers: {
    click: (view, line, event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.vsidian-fold-arrow')) {
        return false
      }
      const from = line.from
      const keys = view.state.field(headingFoldField, false) ?? new Set<number>()
      const tree = view.state.field(liveDecorationsField, false)?.tree
      const hit = arrowStatesFromSpans(foldableSpansCached(view.state.doc, tree), keys)
        .some((s) => s.lineFrom === from)
      if (!hit) {
        return false
      }
      // 统一入口（审查轮 F1 修复）：与键位/API 编程触发同链路 setHeadingFolds
      // ——折叠方向含光标迁移，与 toggle 裸 effect 的行为不再分叉
      toggleHeadingFoldAt(view, from)
      return true
    },
  },
})

/** 箭头与悬停扩展（headingFoldExtension 并入，全部 Live 实例含嵌入共享） */
export const headingFoldGutterExtension: Extension = [
  headingFoldArrowsPlugin,
  headingFoldHoverPlugin,
  headingFoldGutter,
]

// ---- T03（#414）：paint 探针折叠观测 ----

/** 元素中心点 elementFromPoint 命中自身（paintedWithVisibleBackground /
 *  paintedLineNumbers 同口径；jsdom 无布局恒 false，只作真宿主断言依据）。
 *  #419 起导出：阅读态折叠探针（readingVirtualView）同口径复用。 */
export function hitPainted(el: HTMLElement): boolean {
  try {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return false
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  } catch {
    return false
  }
}

/**
 * 标题折叠 UI 绘制观测（view.state.paint 探针族的 headingFold 字段采集
 * 体，协议 PaintProbe.headingFold）：折叠区间数、省略号/常显箭头绘制态、
 * 可折叠行箭头计数与悬停武装态。jsdom 无布局（rect 恒 0），visible 类
 * 字段恒 false，只作真宿主/浏览器断言依据；结构性字段（计数/文字/类
 * 判定）jsdom 可断言。
 */
export function collectHeadingFoldPaint(view: EditorView): HeadingFoldPaintProbe {
  const state = view.state
  const keys = state.field(headingFoldField, false) ?? new Set<number>()
  const tree = state.field(liveDecorationsField, false)?.tree
  // #418：走 foldableSpansCached 共享缓存（同一 doc 版本内与箭头插件/
  // foldAll/点击命中共享一次派生）——有效折叠 = 可折叠集 ∩ 折叠键集
  // （与 effectiveHeadingFolds 的键集∩可折叠语义等价，均纯派生）
  const foldables = foldableSpansCached(state.doc, tree)
  const folds = foldables.filter((s) => keys.has(s.key))
  const arrowStates = arrowStatesFromSpans(foldables, keys)

  // 票面口径：箭头绘制态取**首折叠区间**的箭头（折叠态常显右向）——
  // DOM 首箭头未必属折叠区间；无折叠时两字段缺省（false / null）
  const firstFoldedArrow = view.dom.querySelector<HTMLElement>(
    '.vsidian-fold-gutter .vsidian-fold-arrow.vsidian-fold-arrow-collapsed',
  )
  const ellipsisEl = view.contentDOM.querySelector<HTMLElement>('.vsidian-fold-ellipsis')

  // 隐藏区首个非空行文本是否仍被绘制（「折叠内容不可见」断言面：折叠后
  // 该行无 DOM，coordsAtPos 落点命中省略号而非隐藏文本）
  let hiddenLinePainted: boolean | null = null
  if (folds.length > 0) {
    const f = folds[0]!
    let pos = f.hideFrom + 1
    while (pos < f.hideTo) {
      const line = state.doc.lineAt(pos)
      if (line.text.trim() !== '') {
        try {
          const coords = view.coordsAtPos(Math.min(line.from + 1, line.to))
          if (coords) {
            const hit = document.elementFromPoint((coords.left + coords.right) / 2, (coords.top + coords.bottom) / 2)
            hiddenLinePainted =
              !!hit && hit.textContent != null && hit.textContent.includes(line.text.trim())
          } else {
            hiddenLinePainted = false
          }
        } catch {
          hiddenLinePainted = false
        }
        break
      }
      pos = line.to + 1
    }
    if (hiddenLinePainted === null) {
      hiddenLinePainted = false // 隐藏区全空白：无文本行可证，记不可见
    }
  }

  return {
    foldCount: folds.length,
    ellipsisVisible: !!ellipsisEl && hitPainted(ellipsisEl),
    ellipsisText: ellipsisEl ? ellipsisEl.textContent : null,
    arrowVisible: !!firstFoldedArrow && hitPainted(firstFoldedArrow),
    arrowCollapsed: firstFoldedArrow != null,
    foldableArrowCount: arrowStates.length,
    hoverArmed: view.dom.classList.contains(HEADING_FOLD_HOVER_CLASS),
    hiddenLinePainted,
  }
}

/** 标题折叠扩展总装配（liveInstance 扩展组消费；T03 起含箭头与悬停显现） */
export const headingFoldExtension: Extension = [
  headingFoldField,
  headingFoldDecorations,
  headingFoldGutterExtension,
]

// ---- T04（#415）：落点展开（reveal 族统一机制）与外部同步光标钳制 ----
// 规格「七、落点展开」：任何把选区/滚动定位到折叠隐藏区内的链路，先展开
// 包含落点的全部已折叠区间（effect 派发）再执行定位。展开是**永久展开**
// ——不做临时折叠窥视（peek 需折叠态快照与超时恢复，列为后续可选）。
// 接线点：findLocate（查找命中/替换定位）、locateOffset（view.locate 通道
// ——锚点跳转/搜索结果/双链/链接跳转/大纲点击的共同汇聚）、setViewMode
// reading→live 回切（modeAnchor 落点）。

/**
 * 落点展开键集派生（纯函数）：移除「包含 [from, to] 区间内任一端点的
 * 全部有效折叠」后的新键集——嵌套折叠（外层与内层都罩住落点）一并
 * 展开。无包含折叠返回 null（无需事务）。端点在隐藏区判定 = 开区间
 * (hideFrom, hideTo)：标题块行尾与节末下一标题行首均属可见锚点，不算
 * 隐藏区。脱靶键原样保留（update 只做映射不修剪纪律）。
 */
export function unfoldAroundKeys(
  foldKeys: ReadonlySet<number>,
  headings: readonly HeadingInfo[],
  doc: Text,
  from: number,
  to?: number,
): ReadonlySet<number> | null {
  const folds = effectiveHeadingFolds(foldKeys, headings, doc)
  if (folds.length === 0) {
    return null
  }
  const toPos = to ?? from
  let hit = false
  const next = new Set(foldKeys)
  for (const f of folds) {
    const inside =
      (from > f.hideFrom && from < f.hideTo) || (toPos > f.hideFrom && toPos < f.hideTo)
    if (inside) {
      next.delete(f.key)
      hit = true
    }
  }
  return hit ? next : null
}

/**
 * 落点展开（规格「七、落点展开」）：展开包含落点 [from, to] 的全部有效
 * 折叠区间（嵌套全展开），effect 直驱（headingFoldSet，键位/箭头/API
 * 编程触发同链路）。返回是否发生了展开；无包含折叠/未装配折叠域时零
 * 事务返回 false。定位事务由接线点随后派发（先展开再定位）。
 */
export function unfoldAround(view: EditorView, from: number, to?: number): boolean {
  const keys = view.state.field(headingFoldField, false)
  if (!keys || keys.size === 0) {
    return false
  }
  const tree = view.state.field(liveDecorationsField, false)?.tree
  const next = unfoldAroundKeys(keys, collectHeadings(view.state.doc, tree), view.state.doc, from, to)
  if (!next) {
    return false
  }
  view.dispatch({ effects: headingFoldSet.of(next) })
  return true
}

/**
 * 外部同步光标钳制（规格「三、折叠与光标/选区」「折叠后进入」）：pos
 * 落入任一有效折叠隐藏区间 → 钳到该区间辖域标题块行尾（hideFrom）；
 * 可见区返回 null。嵌套取包含 pos 的最深区间（最近可见锚点，与
 * migrateSelectionForFold 同口径）。clampExternalCursor（表格网格）的
 * 同款防御思想——折叠侧判定函数。
 */
export function clampFoldHiddenCursor(folds: readonly HeadingFoldSpan[], pos: number): number | null {
  let hit: HeadingFoldSpan | null = null
  for (const f of folds) {
    if (pos > f.hideFrom && pos < f.hideTo) {
      if (!hit || f.hideTo - f.hideFrom < hit.hideTo - hit.hideFrom) {
        hit = f
      }
    }
  }
  return hit ? hit.hideFrom : null
}

/**
 * 外部同步事务后的选区钳制（T04 接线面）：逐 range 判定光标是否被外部
 * 增量映射进折叠隐藏区，命中则钳到辖域标题行行尾；返回补事务用的完整
 * 选区，无需钳制（无折叠域/全可见）返回 null。liveInstance 的外部同步
 * 光标恢复路径（dispatchExternalChanges）在表格钳制后接入。
 */
export function clampSelectionOutOfFolds(view: EditorView): EditorSelection | null {
  const keys = view.state.field(headingFoldField, false)
  if (!keys || keys.size === 0) {
    return null
  }
  const tree = view.state.field(liveDecorationsField, false)?.tree
  const folds = effectiveHeadingFolds(keys, collectHeadings(view.state.doc, tree), view.state.doc)
  if (folds.length === 0) {
    return null
  }
  const sel = view.state.selection
  let ranges: ReturnType<typeof EditorSelection.cursor>[] | null = null
  for (let i = 0; i < sel.ranges.length; i++) {
    const clamped = clampFoldHiddenCursor(folds, sel.ranges[i]!.head)
    if (clamped === null) {
      continue
    }
    if (!ranges) {
      ranges = sel.ranges.slice()
    }
    ranges[i] = EditorSelection.cursor(clamped)
  }
  return ranges ? EditorSelection.create(ranges, sel.mainIndex) : null
}
