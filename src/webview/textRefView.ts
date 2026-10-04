// 可读文本只读视图（#340 / P3-08）：悬停浮层（及后续 #341 嵌入卡片）的
// text 内容渲染器——行号列、分层 token 着色（语法层先到先染、语义层后到
// 按字符区间覆盖——原生同构叠加）、语言级字体、定高虚拟化（窗口内可见
// 行挂载，全文模型与 DOM 常驻分开）。
//
// 只读边界：不创建任何输入端口（无 textarea/contenteditable），选择/复制
// 走浏览器原生文本选择；本类不监听键盘、不冒泡写意图。
//
// 呈现对齐口径（#335 验证路线）：字体/字号/连字用语言级生效值（载荷携带，
// 缺省回落 webview CSS 变量族——与工作台同源）；token 颜色全部来自宿主
// 外观服务的计算值（内联 color，不硬编码配色）；无 token 数据时纯文本
// 呈现（= editor.foreground，与原生无高亮文件一致，不算降级）。
import { decodeTextTokenRuns, type TextTokenRun } from '../shared/refText'

/** 文本视图稳定类名（样式契约登记于 main.css 的 text-hover 段） */
export const TEXT_VIEW_CLASS_NAMES = {
  view: 'vsidian-text-view',
  gutter: 'vsidian-text-gutter',
  gutterWindow: 'vsidian-text-gutter-window',
  code: 'vsidian-text-code',
  lines: 'vsidian-text-lines',
  window: 'vsidian-text-window',
  line: 'vsidian-text-line',
  gutterLine: 'vsidian-text-gutter-line',
} as const

/** 视图装载载荷（refLoadedContentOfResult 的 text 形态投影） */
export interface TextRefViewDocument {
  /** 窗口内 LF 正文 */
  text: string
  languageId: string
  hasWindow: boolean
  beginLine: number
  endLine: number
  locateLine: number
  font: { family?: string; size?: number; ligatures?: boolean }
  lineNumbers: boolean
}

/** 虚拟化缓冲（可见区上下各多渲染的行数——滚动时减少闪白） */
const VISIBLE_BUFFER_LINES = 8

/** 行高倍数（原生编辑器默认 lineHeight 0 会解析为 1.5 倍字号——探针
 *  webview 渲染同款 1.5） */
const LINE_HEIGHT_FACTOR = 1.5

export class TextRefView {
  private readonly viewEl: HTMLElement
  private readonly gutterEl: HTMLElement
  private readonly gutterWindowEl: HTMLElement
  private readonly codeEl: HTMLElement
  private readonly linesEl: HTMLElement
  private readonly windowEl: HTMLElement
  private lines: string[] = []
  private doc: TextRefViewDocument | null = null
  private lineHeight = 21
  private firstRendered = 0
  private lastRendered = -1
  private tmColors: readonly string[] = []
  private tmRunsByLine = new Map<number, TextTokenRun[]>()
  private semColors: readonly string[] = []
  private semRunsByLine = new Map<number, TextTokenRun[]>()
  private disposed = false

  constructor(
    private readonly contentEl: HTMLElement,
    private readonly scrollEl: HTMLElement,
  ) {
    this.viewEl = document.createElement('div')
    this.viewEl.className = TEXT_VIEW_CLASS_NAMES.view
    this.gutterEl = document.createElement('div')
    this.gutterEl.className = TEXT_VIEW_CLASS_NAMES.gutter
    this.gutterWindowEl = document.createElement('div')
    this.gutterWindowEl.className = TEXT_VIEW_CLASS_NAMES.gutterWindow
    this.gutterEl.appendChild(this.gutterWindowEl)
    this.codeEl = document.createElement('div')
    this.codeEl.className = TEXT_VIEW_CLASS_NAMES.code
    this.linesEl = document.createElement('div')
    this.linesEl.className = TEXT_VIEW_CLASS_NAMES.lines
    this.windowEl = document.createElement('div')
    this.windowEl.className = TEXT_VIEW_CLASS_NAMES.window
    this.linesEl.appendChild(this.windowEl)
    this.codeEl.appendChild(this.linesEl)
    this.viewEl.appendChild(this.gutterEl)
    this.viewEl.appendChild(this.codeEl)
    this.contentEl.appendChild(this.viewEl)
  }

  /** 装载文档：字体/行号/虚拟化重置；不定位（定位由挂载方调度） */
  setDocument(doc: TextRefViewDocument): void {
    if (this.disposed) {
      return
    }
    this.doc = doc
    this.lines = doc.text === '' ? [''] : doc.text.split('\n')
    this.tmColors = []
    this.tmRunsByLine = new Map()
    this.semColors = []
    this.semRunsByLine = new Map()
    const fontSize = doc.font.size ?? 14
    this.lineHeight = Math.round(fontSize * LINE_HEIGHT_FACTOR * 100) / 100
    // 语言级字体生效值；缺席回落工作台 CSS 变量（与编辑器默认同源）
    this.viewEl.style.fontSize = `${fontSize}px`
    if (doc.font.family !== undefined && doc.font.family !== '') {
      this.viewEl.style.fontFamily = doc.font.family
    }
    this.viewEl.style.fontVariantLigatures = doc.font.ligatures === true ? 'contextual' : 'none'
    this.gutterEl.style.display = doc.lineNumbers ? '' : 'none'
    this.linesEl.style.height = `${this.lines.length * this.lineHeight}px`
    this.gutterEl.style.height = `${this.lines.length * this.lineHeight}px`
    this.renderWindow()
  }

  /** 应用 token 分层（textmate 先染；semantic 按字符区间覆盖）后重渲染 */
  applyTokens(layer: 'textmate' | 'semantic', colors: readonly string[], data: readonly number[]): void {
    if (this.disposed || this.doc === null) {
      return
    }
    const byLine = new Map<number, TextTokenRun[]>()
    for (const run of decodeTextTokenRuns(data)) {
      const list = byLine.get(run.line)
      if (list) {
        list.push(run)
      } else {
        byLine.set(run.line, [run])
      }
    }
    if (layer === 'textmate') {
      this.tmColors = colors
      this.tmRunsByLine = byLine
    } else {
      this.semColors = colors
      this.semRunsByLine = byLine
    }
    this.renderWindow()
  }

  /** 重算虚拟窗口（滚动/尺寸变化后调用；幂等） */
  updateNow(): void {
    this.renderWindow()
  }

  /** 初始定位：滚动到 locateLine 行首（挂载方在首开且无保存位置时调用） */
  locateToLine(locateLine: number): void {
    if (this.disposed || this.doc === null) {
      return
    }
    const target = Math.max(0, (locateLine - this.doc.beginLine) * this.lineHeight)
    this.scrollEl.scrollTop = target
    this.renderWindow()
  }

  getStats(): { renderedLines: number; totalLines: number; lineHeight: number } | null {
    if (this.doc === null) {
      return null
    }
    return {
      renderedLines: this.lastRendered - this.firstRendered + 1,
      totalLines: this.lines.length,
      lineHeight: this.lineHeight,
    }
  }

  clear(): void {
    this.windowEl.textContent = ''
    this.gutterWindowEl.textContent = ''
    this.lines = []
    this.doc = null
    this.firstRendered = 0
    this.lastRendered = -1
    this.tmColors = []
    this.tmRunsByLine = new Map()
    this.semColors = []
    this.semRunsByLine = new Map()
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.clear()
    this.viewEl.remove()
  }

  /** 虚拟窗口渲染：只挂载可见 ±buffer 行（gutter 与 code 同步） */
  private renderWindow(): void {
    if (this.doc === null) {
      return
    }
    const scrollTop = this.scrollEl.scrollTop
    const viewport = Math.max(this.scrollEl.clientHeight, this.contentEl.clientHeight, 200)
    const first = Math.max(0, Math.floor(scrollTop / this.lineHeight) - VISIBLE_BUFFER_LINES)
    const last = Math.min(this.lines.length - 1, Math.ceil((scrollTop + viewport) / this.lineHeight) + VISIBLE_BUFFER_LINES)
    this.firstRendered = first
    this.lastRendered = last
    this.windowEl.style.transform = `translateY(${first * this.lineHeight}px)`
    this.gutterWindowEl.style.transform = `translateY(${first * this.lineHeight}px)`
    this.windowEl.textContent = ''
    this.gutterWindowEl.textContent = ''
    for (let i = first; i <= last; i++) {
      const lineText = this.lines[i] ?? ''
      const row = document.createElement('div')
      row.className = TEXT_VIEW_CLASS_NAMES.line
      row.style.height = `${this.lineHeight}px`
      this.appendLineSpans(row, i, lineText)
      this.windowEl.appendChild(row)
      if (this.doc.lineNumbers) {
        const gutterRow = document.createElement('div')
        gutterRow.className = TEXT_VIEW_CLASS_NAMES.gutterLine
        gutterRow.style.height = `${this.lineHeight}px`
        gutterRow.textContent = String(this.doc.beginLine + i)
        this.gutterWindowEl.appendChild(gutterRow)
      }
    }
  }

  /** 单行 span 装配：语法层切分基底 + 语义层区间覆盖（原生同构叠加） */
  private appendLineSpans(row: HTMLElement, lineIndex: number, lineText: string): void {
    const tmRuns = this.tmRunsByLine.get(lineIndex)
    const semRuns = this.semRunsByLine.get(lineIndex)
    if (tmRuns === undefined && semRuns === undefined) {
      // 无 token：整行单 span（颜色回落 CSS 前景变量——原生无高亮文件同款）
      const span = document.createElement('span')
      span.textContent = lineText
      row.appendChild(span)
      return
    }
    // 区间覆盖图：基底切分（TM runs，未覆盖区无样式）→ 语义 runs 覆盖
    type Segment = { start: number; end: number; color?: string; fontStyleBits: number }
    const segments: Segment[] = []
    let cursor = 0
    const pushSegment = (start: number, end: number, color: string | undefined, bits: number): void => {
      if (end <= start) {
        return
      }
      segments.push({ start, end, color, fontStyleBits: bits })
    }
    const overlay = (start: number, end: number, color: string | undefined, bits: number): void => {
      const next: Segment[] = []
      for (const seg of segments) {
        if (seg.end <= start || seg.start >= end) {
          next.push(seg)
          continue
        }
        if (seg.start < start) {
          next.push({ ...seg, end: start })
        }
        next.push({
          start: Math.max(seg.start, start),
          end: Math.min(seg.end, end),
          color: color ?? seg.color,
          fontStyleBits: bits !== 0 ? bits : seg.fontStyleBits,
        })
        if (seg.end > end) {
          next.push({ ...seg, start: end })
        }
      }
      segments.length = 0
      segments.push(...next)
    }
    for (const run of tmRuns ?? []) {
      if (cursor < run.start) {
        pushSegment(cursor, run.start, undefined, 0)
      }
      pushSegment(run.start, run.start + run.length, this.tmColors[run.colorIdx], run.fontStyleBits)
      cursor = Math.max(cursor, run.start + run.length)
    }
    if (cursor < lineText.length) {
      pushSegment(cursor, lineText.length, undefined, 0)
    }
    for (const run of semRuns ?? []) {
      overlay(run.start, run.start + run.length, this.semColors[run.colorIdx], 0)
    }
    for (const seg of segments) {
      const text = lineText.slice(seg.start, seg.end)
      if (seg.color === undefined && seg.fontStyleBits === 0) {
        row.appendChild(document.createTextNode(text))
        continue
      }
      const span = document.createElement('span')
      span.textContent = text
      if (seg.color !== undefined) {
        span.style.color = seg.color
      }
      if ((seg.fontStyleBits & 1) !== 0) {
        span.style.fontStyle = 'italic'
      }
      if ((seg.fontStyleBits & 2) !== 0) {
        span.style.fontWeight = 'bold'
      }
      if ((seg.fontStyleBits & 4) !== 0) {
        span.style.textDecoration = 'underline'
      }
      if ((seg.fontStyleBits & 8) !== 0) {
        span.style.textDecoration = `${span.style.textDecoration ? `${span.style.textDecoration} ` : ''}line-through`
      }
      row.appendChild(span)
    }
  }
}
