// 中文分词词级移动命令（#239）：Ctrl+Left/Right 与 Shift 变体对连续
// CJK 段按分词结果逐词切分；拉丁/数字/空白/ASCII 标点路径**逐字节沿用**
// CM6 cursorGroupLeft/Right 既有语义（见命令实现：无 CJK 细化时直接委托
// 原生命令；混合场景的组装路径与 @codemirror/commands 的
// moveSel/extendSel 同构——回归断言钉住）。
//
// 装配层（PR 说明钉住）：快捷键经 keybindingRouter 的 document 捕获层
// 本地分支同步执行（注册表操作 mode live + writes true——批次文档 §3
// 「Live 编辑能力 writes=true 类」：router 的 allowWrites 门控据此只在
// Live 正文焦点命中，find 输入框等非正文焦点不劫持）；命令面板经
// ui.command 回流。不选 CM6 keymap 派生：路由层已有注册表改绑/清空/
// 恢复默认全链路，且表格裸方向键共存由「注册表只登记带修饰键方向键」
// 天然保证（tableEditing 只绑裸 ArrowLeft/Right）。
//
// 原子范围（skipAtoms）论证：仓库唯一的 atomicRanges 是表格格内 `<br>`
// 四字符（liveDecorations），属 ASCII 域——不在 CJK 分词域内，细化目标
// 不会落入原子区间，无需复刻 view.moveByGroup 的原子跳跃；原生路径的
// 原子跳跃由委托的原生命令保留。
//
// 引擎（注册表化）：builtin = Intl.Segmenter（granularity 'word'，零体积
// 默认）；jieba = jieba-wasm 按需加载（宿主下载校验后的 globalStorage
// 资源经 wordSegment.state 推送 webview 资源 URI，本模块动态 import +
// init(wasmUrl)——wasm 经 fetch 装载，CSP connect-src 已放行自有资源
// 域）。jieba 加载完成前命令同步回退 builtin（不能等待）；加载失败回报
// 宿主通知用户（wordSegment.loadResult）。
import { cursorGroupLeft, cursorGroupRight, selectGroupLeft, selectGroupRight } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import { Direction, type Command } from '@codemirror/view'
import {
  boundariesFromTokens,
  createIntlWordBoundaries,
  normalizeWordBoundaries,
  planCjkWordTarget,
  type WordBoundaryFn,
} from '../shared/wordSegment'

/** jieba-wasm 浏览器产物的模块面（动态 import 的资源 URI 产物）。
 *  init 传对象形式（2.4.0 起字符串参数打 deprecation 警告）；实测
 *  cut 输出中文标点为独立 token——与 boundariesFromTokens 边界模型吻合 */
interface JiebaModule {
  default: (options: { module_or_path: string }) => Promise<unknown>
  cut: (text: string, hmm?: boolean) => string[]
}

export interface JiebaResources {
  js: string
  wasm: string
}

export type WordSegmentEngineSetting = 'builtin' | 'jieba'

let engineSetting: WordSegmentEngineSetting = 'builtin'
let jiebaResources: JiebaResources | null = null
let jiebaBoundaries: WordBoundaryFn | null = null
let jiebaLoadState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let reportLoadResult: ((ok: boolean, detail?: string) => void) | undefined
const intlBoundaries = createIntlWordBoundaries()

/** 无 Intl.Segmenter 环境的退化引擎（理论不可达：chrome118 webview 确定
 *  available）：分词域段只有段首尾边界（等同原生整段跳过） */
const degradedBoundaries: WordBoundaryFn = (text) => normalizeWordBoundaries(text, [])

/** 当前命令使用的边界函数：引擎选 jieba 且已就绪用 jieba，否则 builtin */
export function activeWordBoundaries(): WordBoundaryFn {
  if (engineSetting === 'jieba' && jiebaLoadState === 'ready' && jiebaBoundaries) {
    return jiebaBoundaries
  }
  return intlBoundaries ?? degradedBoundaries
}

/** 当前生效引擎观测（测试与探针） */
export function activeWordSegmentEngine(): 'builtin' | 'jieba' {
  return engineSetting === 'jieba' && jiebaLoadState === 'ready' && jiebaBoundaries ? 'jieba' : 'builtin'
}

/**
 * 配置入口（syncController 消费 settings 快照与 wordSegment.state 时
 * 调用）：引擎选择与 jieba 资源 URI（installed 时携带）。engine=jieba 且
 * 资源在场时按需加载（已在途/已就绪/已终态失败不重复发起——资源 URI
 * 变化（重下）时重置状态重新加载）；切换回 builtin 即时生效（已加载
 * 的模块保留，切回不再重复 init）。
 */
export function configureWordSegment(options: {
  engine: WordSegmentEngineSetting
  resources: JiebaResources | null
  onReportLoadResult?: (ok: boolean, detail?: string) => void
}): void {
  engineSetting = options.engine
  reportLoadResult = options.onReportLoadResult
  const next = options.resources
  if (next?.js !== jiebaResources?.js || next?.wasm !== jiebaResources?.wasm) {
    // 资源身份变化（首次到达/删除/重下）：清空既有加载态（失败终态随之
    // 解除，可重新加载）
    jiebaResources = next
    jiebaBoundaries = null
    jiebaLoadState = 'idle'
  }
  if (engineSetting === 'jieba' && jiebaResources && jiebaLoadState !== 'ready') {
    void ensureJieba(jiebaResources)
  }
}

async function ensureJieba(resources: JiebaResources): Promise<void> {
  if (jiebaLoadState === 'loading' || jiebaLoadState === 'ready') return
  jiebaLoadState = 'loading'
  try {
    const mod = (await import(resources.js)) as JiebaModule
    await mod.default({ module_or_path: resources.wasm })
    jiebaBoundaries = (text: string): readonly number[] => {
      try {
        return boundariesFromTokens(text, mod.cut(text)) ?? normalizeWordBoundaries(text, [])
      } catch {
        // 单次 cut 异常（wasm 内存等）不击穿命令：退化为段首尾边界
        return normalizeWordBoundaries(text, [])
      }
    }
    jiebaLoadState = 'ready'
    reportLoadResult?.(true)
  } catch (error) {
    jiebaLoadState = 'failed'
    jiebaBoundaries = null
    reportLoadResult?.(false, error instanceof Error ? error.message : String(error))
  }
}

/** 测试钩子：直接注入 jieba 边界函数（绕过动态 import——jsdom 无真实
 *  资源），并置就绪态 */
export function __setJiebaBoundariesForTest(boundaries: WordBoundaryFn | null): void {
  jiebaBoundaries = boundaries
  jiebaLoadState = boundaries ? 'ready' : 'idle'
}

// ---- 命令（复刻 @codemirror/commands 的 moveSel/extendSel 装配路径）----

/**
 * 词级移动命令工厂。forward = 文档序前向；extend = Shift 扩选变体。
 * 逐 range：原生目标由 view.moveByGroup 计算（与 cursorByGroup/
 * selectByGroup 同式）；head 邻近分词域字符时以分词目标替换。全部
 * range 无细化时委托原生命令（cursorGroupLeft/Right 与 select 变体，
 * 零组装差异——拉丁行为逐字节不变的最终保证）。
 */
export function wordMotionCommand(forward: boolean, extend: boolean): Command {
  return (view) => {
    if (view.compositionStarted) return false
    const boundaries = activeWordBoundaries()
    const state = view.state
    let anyRefined = false
    const ranges = state.selection.ranges.map((range) => {
      // undirectional 翻转（extendSel 同款）：双向选区在反向扩展时交换
      // 端点——how(range) 随后以翻转后 range 的 head 为移动起点
      let source = range
      if (extend && range.undirectional && (range.head >= range.anchor) !== forward) {
        source = EditorSelection.range(range.head, range.anchor)
      }
      if (!extend && !source.empty) {
        // cursorByGroup 的 rangeEnd 语义：非空选区跳到行进方向的前沿
        return EditorSelection.cursor(forward ? source.to : source.from)
      }
      const native = view.moveByGroup(source, forward)
      const line = state.doc.lineAt(source.head)
      const refined = planCjkWordTarget(line.text, source.head - line.from, forward, boundaries)
      if (refined === null) {
        return extend
          ? EditorSelection.range(source.anchor, native.head, native.goalColumn, native.bidiLevel || undefined, native.assoc)
          : native
      }
      anyRefined = true
      const target = line.from + refined
      const cursor = EditorSelection.cursor(target, forward ? -1 : 1)
      return extend
        ? EditorSelection.range(source.anchor, cursor.head, cursor.goalColumn, cursor.bidiLevel || undefined, cursor.assoc)
        : cursor
    })
    if (!anyRefined) {
      // 无 CJK 细化：整笔交原生命令（moveSel/extendSel 的原生装配，
      // 含原生目标的 goalColumn/assoc/bidiLevel 细节）
      const nativeCommand = extend
        ? forward ? selectGroupRight : selectGroupLeft
        : forward ? cursorGroupRight : cursorGroupLeft
      return nativeCommand(view)
    }
    const selection = EditorSelection.create(ranges, state.selection.mainIndex)
    if (selection.eq(state.selection, true)) return false
    view.dispatch({ selection, scrollIntoView: true, userEvent: 'select' })
    return true
  }
}

/** 左移（LTR 文本为 backward；与 cursorGroupLeft 的方向推导同式） */
export const cursorWordLeft: Command = (view) =>
  wordMotionCommand(view.textDirectionAt(view.state.selection.main.head) !== Direction.LTR, false)(view)
/** 右移 */
export const cursorWordRight: Command = (view) =>
  wordMotionCommand(view.textDirectionAt(view.state.selection.main.head) === Direction.LTR, false)(view)
/** Shift 左扩选 */
export const selectWordLeft: Command = (view) =>
  wordMotionCommand(view.textDirectionAt(view.state.selection.main.head) !== Direction.LTR, true)(view)
/** Shift 右扩选 */
export const selectWordRight: Command = (view) =>
  wordMotionCommand(view.textDirectionAt(view.state.selection.main.head) === Direction.LTR, true)(view)
