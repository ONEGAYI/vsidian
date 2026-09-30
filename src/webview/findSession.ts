// 编辑区查找：匹配计算与 Live 侧装饰（工单 #14；#236 起匹配引擎换
// @codemirror/search 的 SearchQuery，外部驱动装配见 syncController）。
//
// 架构（依据 ADR-0005 / mvp.md「查找与跳转必须定位屏外内容」）：
// - 匹配基于 webview 全文文本模型（CM6 doc 的字符串形态）计算——纯数据，
//   与 DOM 无关；屏外（未挂载块 / CM6 视口外）内容同样命中
// - 不为查找常驻全文 DOM：匹配数是数据不是 DOM；渲染高亮只做视口内——
//   当前匹配为直接装饰（StateField，保证滚动后始终可见），全部匹配为
//   间接装饰（ViewPlugin 按 visibleRanges 过滤，与 liveDecorations 同构）
// - 引擎（#236）：SearchQuery 承载三开关（caseSensitive=matchCase /
//   wholeWord / regexp）+ literal 字面量口径（\n 不转义，对齐 VSCode）；
//   官方面板不装配（外部驱动），高亮经下方双轨自绘——search() 扩展的
//   高亮仅在官方面板存在时渲染，不与其叠加
// - 码点语义（引擎之上包裹层）：匹配起止不得落在代理对中间（emoji 安全）；
//   坐标为 LF 全文 UTF-16 code unit offset（与协议 SerChange / CM6 同构）
// - 成型头区排除（#236 批次边界）：搜索不进入 frontmatter 成型头区——
//   excludeEnd 之前的匹配不进结果（成型判定在调用方，见 syncController）
// - 查找是纯只读操作：会话不 dispatch 文本变更、不发出站消息（#14 契约，
//   #236 修订：替换为显式写操作，由 syncController 经标准出站链路执行，
//   不在本模块）
import { RangeSet, StateEffect, StateField, Text, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { SearchQuery } from '@codemirror/search'
import type { FindOptions } from '../shared/findOptions'

/** 一个匹配：全文 UTF-16 code unit 的 [from, to) 区间 */
export interface FindMatch {
  from: number
  to: number
}

/** 查找稳定类名（ADR-0004 稳定样式入口；`vsidian-` 前缀；契约登记见
 *  shared/styleContract 的 chrome-find 类目） */
export const FIND_CLASS_NAMES = {
  /** 浮动查找面板容器（webview 内，非 VSCode 原生 find） */
  panel: 'vsidian-find',
  open: 'vsidian-find-open',
  /** 主行（查找输入 + 计数 + 三开关 + 导航）：面板 column 布局的行容器 */
  row: 'vsidian-find-row',
  /** 替换栏展开/收起切换按钮（面板左缘 v 形） */
  toggle: 'vsidian-find-toggle',
  /** 替换行容器（open 类控制显隐） */
  replace: 'vsidian-find-replace',
  replaceOpen: 'vsidian-find-replace-open',
  replaceInput: 'vsidian-find-replace-input',
  replaceNext: 'vsidian-find-replace-next',
  replaceAll: 'vsidian-find-replace-all',
  input: 'vsidian-find-input',
  /** 非法正则反馈（输入框红边；计数区同时显示空态） */
  inputInvalid: 'vsidian-find-input-invalid',
  count: 'vsidian-find-count',
  countEmpty: 'vsidian-find-count-empty',
  /** 三开关：点亮（*-active）= 该选项开启 */
  caseToggle: 'vsidian-find-case',
  caseActive: 'vsidian-find-case-active',
  wordToggle: 'vsidian-find-word',
  wordActive: 'vsidian-find-word-active',
  regexpToggle: 'vsidian-find-regexp',
  regexpActive: 'vsidian-find-regexp-active',
  prev: 'vsidian-find-prev',
  next: 'vsidian-find-next',
  close: 'vsidian-find-close',
  /** 三开关闪烁态（#238：主面板打开时 Ctrl+D 的会话生效档与面板显示
   *  脱节的提示——VSCode highlightFindOptions 语义，CSS 动画短促在场） */
  flash: 'vsidian-find-flash',
  /** Live 全部匹配装饰（视口内间接装饰） */
  match: 'vsidian-find-match',
  /** Live 当前匹配装饰（直接装饰） */
  matchCurrent: 'vsidian-find-match-current',
  /** 阅读视图当前匹配所在块的高亮（块级） */
  readingHit: 'vsidian-reading-find-hit',
} as const

// ---- 码点边界工具（引擎输出之上的包裹层过滤） ----

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** 位置 p 是否是码点边界（p 处不会紧跟在高位代理之后劈开代理对） */
function isCodePointBoundary(text: string, p: number): boolean {
  if (p <= 0 || p >= text.length) {
    return true
  }
  return !(isHighSurrogate(text.charCodeAt(p - 1)) && isLowSurrogate(text.charCodeAt(p)))
}

/** 由三开关构造引擎查询（literal=true：字符串模式按字面量处理，\n 不
 *  转义——VSCode 口径，转义开关不对用户面暴露）；replace 由调用方补充 */
export function buildSearchQuery(
  search: string,
  options: Pick<FindOptions, 'matchCase' | 'wholeWord' | 'regexp'>,
  replace = '',
): SearchQuery {
  return new SearchQuery({
    search,
    replace,
    caseSensitive: options.matchCase,
    wholeWord: options.wholeWord,
    regexp: options.regexp,
    literal: true,
  })
}

/** 查询有效性（空查询与非法正则都无效：无匹配、命令不执行） */
export function isFindQueryValid(search: string, options: Pick<FindOptions, 'regexp'>): boolean {
  if (search === '') {
    return false
  }
  if (!options.regexp) {
    return true
  }
  try {
    // 构造成功即合法（test('') 对 '.' 等模式返回 false，不能作判据）
    void new RegExp(search)
    return true
  } catch {
    return false
  }
}

/**
 * 全文匹配计算（纯函数，引擎 = @codemirror/search 的 SearchQuery）：
 * - 空查询 / 非法正则 / 无命中返回 []
 * - 从左到右、非重叠（引擎 next 语义）
 * - 匹配起止必须在码点边界上：引擎命中劈开代理对时丢弃（防御层——
 *   引擎的字符串与 u-flag 正则路径自身码点安全，此过滤兜底自定义
 *   pattern 的边缘形态；行为由测试锁定）
 * - excludeEnd（#236 成型头区排除）：起点 < excludeEnd 的命中不进结果
 */
export function computeFindMatches(
  text: string,
  query: string,
  options: FindOptions,
  excludeEnd = 0,
): FindMatch[] {
  if (query === '' || query.length > text.length || !isFindQueryValid(query, options)) {
    return []
  }
  const engine = buildSearchQuery(query, options)
  if (!engine.valid) {
    return []
  }
  const doc = Text.of(text.split('\n'))
  const out: FindMatch[] = []
  const cursor = engine.getCursor(doc)
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    const { from, to } = step.value
    if (from < excludeEnd) {
      continue
    }
    if (isCodePointBoundary(text, from) && isCodePointBoundary(text, to)) {
      out.push({ from, to })
    }
  }
  return out
}

/**
 * 参考位置起的当前匹配序号（0 基；无匹配为 -1 语义由调用方处理）：
 * 取首个 from >= ref 的匹配；ref 之后无匹配时回绕到首个（循环导航语义）。
 */
export function matchIndexFrom(matches: readonly FindMatch[], ref: number): number {
  if (matches.length === 0) {
    return 0
  }
  for (let i = 0; i < matches.length; i++) {
    if (matches[i]!.from >= ref) {
      return i
    }
  }
  return 0
}

// ---- Live 侧装饰 ----

/** 查找状态（CM6 StateField）：匹配集 + 当前序号 + 当前匹配直接装饰。
 *  匹配坐标随计算时的文档快照固定；文档变化后由控制器重算并整组替换
 *  （版本失效策略：重算时机 = 任何查找交互前的 freshness 校验）。 */
export interface FindDecoState {
  matches: readonly FindMatch[]
  index: number
  /** 当前匹配 mark（update 时按 tr.state.doc 构建，facet 直接供给） */
  decos: DecorationSet
}

/** 匹配集替换效应（整组替换；空集即清空装饰） */
export const setFindMatches = StateEffect.define<{ matches: readonly FindMatch[]; index: number }>()

const currentMatchDeco = Decoration.mark({ class: FIND_CLASS_NAMES.matchCurrent })
const allMatchDeco = Decoration.mark({ class: FIND_CLASS_NAMES.match })

/** 当前匹配 mark（跨行匹配不可能出现：查询不含换行；防御性截到行尾） */
function currentMatchRanges(
  doc: { lineAt(p: number): { from: number; to: number } },
  s: { matches: readonly FindMatch[]; index: number },
): Array<Range<Decoration>> {
  const m = s.matches[s.index]
  if (!m) {
    return []
  }
  const line = doc.lineAt(m.from)
  const to = Math.min(m.to, line.to)
  if (to <= m.from) {
    return []
  }
  return [currentMatchDeco.range(m.from, to)]
}

const emptyDecos = RangeSet.of([] as Array<Range<Decoration>>, true)

export const findStateField = StateField.define<FindDecoState>({
  create: () => ({ matches: [], index: 0, decos: emptyDecos }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFindMatches)) {
        return {
          matches: e.value.matches,
          index: e.value.index,
          decos: RangeSet.of(currentMatchRanges(tr.state.doc, e.value), true),
        }
      }
    }
    if (tr.docChanged) {
      // 文档变更兜底映射：控制器的匹配重算在微任务中整组替换（权威），
      // 此处先把既有装饰随 tr.changes 平移——消除「重算前一帧用旧坐标
      // 渲染」的时序窗口，装饰结构不依赖微任务时序闭合
      return { ...value, decos: value.decos.map(tr.changes) }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decos),
})

/** 全部匹配间接装饰：仅视口内的匹配生成 mark（不为查找常驻全文 DOM） */
function viewportMatchRanges(
  doc: { length: number; lineAt(p: number): { from: number; to: number } },
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  matches: readonly FindMatch[],
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  for (const range of visibleRanges) {
    for (const m of matches) {
      if (m.to <= range.from) {
        continue
      }
      if (m.from >= range.to) {
        break // matches 有序，其后全在区间外
      }
      const line = doc.lineAt(m.from)
      const to = Math.min(m.to, line.to)
      if (to > m.from) {
        out.push(allMatchDeco.range(m.from, to))
      }
    }
  }
  return out
}

const findViewportPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = RangeSet.of(
        viewportMatchRanges(view.state.doc, view.visibleRanges, view.state.field(findStateField).matches),
        true,
      )
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setFindMatches)))
      ) {
        this.decorations = RangeSet.of(
          viewportMatchRanges(
            update.state.doc,
            update.view.visibleRanges,
            update.state.field(findStateField).matches,
          ),
          true,
        )
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** 查找装饰装配：当前匹配（直接，StateField 供给）+ 全部匹配（视口内间接） */
export const findDecorations: Extension = [findStateField, findViewportPlugin]
