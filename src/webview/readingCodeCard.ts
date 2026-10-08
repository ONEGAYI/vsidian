// 阅读视图代码块卡片（工单 #84，规格 docs/specs/code-block-card.md）：
// 挂载钩子内把朴素 `<pre><code class="language-x">` 增强为与 Live 相同的
// 卡片契约——头部横带（徽标 + 语言标签 + 折叠 + 复制）、tok-* 语法着色
// （与 Live 共用 codeHighlight 引擎与色板）。与阅读虚拟化协同：块卸载随
// DOM 丢弃，重挂载从 data 属性的源码原文重新增强（幂等）。
//
// 形态矩阵（与设置开关对齐）：
// - card + highlight：卡片 + token 着色
// - card 仅：卡片（不着色）
// - highlight 仅：朴素 pre/code 内直接注入 token span（无卡片结构）
// - 两者皆关：不触碰（朴素 markdown-it 产物）
// 卡内行号 2026-10 起阅读侧不再发射（codeblock.lineNumbers 仅 Live 生效，
// 与引用内容先例统一——行号/悬挂缩进/sticky 列一并退场）。
// 折叠（card 开启时）：块级类切换隐藏 pre（视图态由调用方持有集合）。
import { resolveCodeLanguage } from '../shared/codeLangs'
import { HIGHLIGHT_CACHE_LIMIT, HIGHLIGHT_MAX_LINES, hasHighlightEngine, highlightCodeRanges, splitRangeAtLineBreaks, type CodeTokenRange } from './codeHighlight'
import type { ReadingBlock, ReadingCodeFence } from './readingBlocks'
import {
  CODE_CARD_CLASS_NAMES,
  appendLanguageBadge,
  buildCopyButton,
  buildFoldButton,
  buildWrapButton,
} from './liveCodeCard'
import type { CodeCardConfig } from './liveCodeCard'

// DOM bindings are weak: unmounted chunks never keep their document alive.
// Only bounds are copied per chunk. Keep at most 64 complete fence bodies, shared
// across mounts, so later chunks neither parse in isolation nor copy full bodies.
const codeContexts = new WeakMap<HTMLElement, { text: string; slice: NonNullable<ReadingBlock['codeContext']> }>()
const fenceSources = new Map<ReadingCodeFence, string>()

/** Both main reading and Markdown references use createReadingBlockElement. */
export function bindReadingCodeContext(block: HTMLElement, text: string, slice: ReadingBlock['codeContext']): void {
  if (slice) codeContexts.set(block, { text, slice })
}

function readingTokenRanges(block: HTMLElement, languageId: string, code: string): readonly CodeTokenRange[] {
  const context = codeContexts.get(block)
  if (!context) return highlightCodeRanges(languageId, code)
  const { text, slice } = context
  const { fence } = slice
  // Check the complete fence before allocating its body, including later-first mounts.
  if (fence.totalLines > HIGHLIGHT_MAX_LINES) return []
  let source = fenceSources.get(fence)
  if (source === undefined) source = text.slice(fence.from, fence.to)
  fenceSources.delete(fence)
  fenceSources.set(fence, source)
  while (fenceSources.size > HIGHLIGHT_CACHE_LIMIT) {
    fenceSources.delete(fenceSources.keys().next().value!)
  }
  const offset = slice.from - fence.from
  const end = offset + code.length
  return highlightCodeRanges(languageId, source)
    .filter((token) => token.to > offset && token.from < end)
    .map((token) => ({ from: Math.max(token.from, offset) - offset, to: Math.min(token.to, end) - offset, cls: token.cls }))
}

/** 首次增强时记录源码原文与 info string（重增强从 data 属性取，避免读
 *  被 token span 改写后的 DOM） */
const CODE_SRC_ATTR = 'data-vsidian-code-src'
const CODE_INFO_ATTR = 'data-vsidian-code-info'

/** 阅读卡片块级类（选择器映射表登记：vsidian-reading-code-block 的卡片化外壳） */
export const READING_CODE_CARD_CLASS = 'vsidian-reading-code-card'
/** 阅读卡片收起态块级修饰（pre 隐藏；头部保留） */
export const READING_CODE_CARD_FOLDED_CLASS = 'vsidian-code-card-folded'
/** 阅读代码行（文本，卡片形态的行结构） */
export const READING_CODE_LINE_CLASS = 'vsidian-reading-code-line'
/** #191 阅读关闭折行的容器级状态类（挂在阅读容器上，仅关闭时添加；
 *  内部交互态类，不入公开样式契约——门控 pre 横向滚动） */
export const READING_CODE_NOWRAP_CLASS = 'vsidian-reading-nowrap'

export interface ReadingCodeCardOptions {
  config: Pick<CodeCardConfig, 'card' | 'copyButton' | 'highlight'>
  folded: boolean
  onCopy: (code: string) => void
  onFoldToggle: () => void
  /** #191 当前折行态（默认 true 折行）；仅影响折行钮呈现（-off 修饰与
   *  文案），pre 滚动行为由容器级 READING_CODE_NOWRAP_CLASS 承担 */
  wrap?: boolean
  /** #191 折行开关回调（提供即装配折行钮；点击由调用方翻转全局状态并
   *  联动重建全文头部——按钮仅是入口，不持有状态） */
  onWrapToggle?: () => void
}

/** 块是否为可增强的围栏代码块（mermaid 走独立块类，天然不命中） */
export function isReadingCodeBlock(block: HTMLElement): boolean {
  return block.classList.contains('vsidian-reading-code-block') && block.querySelector('pre > code') !== null
}

/**
 * 增强单个阅读代码块（幂等：重复调用先清旧结构再按当前配置重建）。
 * 纯 DOM 操作 + 回调，node/jsdom 单测直驱；不依赖 CM6。
 */
export function decorateReadingCodeCard(block: HTMLElement, opts: ReadingCodeCardOptions): void {
  const codeEl = block.querySelector<HTMLElement>('pre > code')
  if (!codeEl) {
    return
  }
  if (!codeEl.hasAttribute(CODE_SRC_ATTR)) {
    // markdown-it 的 fence token.content 恒含一个尾随换行（CommonMark 语
    // 义）；剥掉以对齐 Live 侧 FenceSpan.code 的代码体口径（复制逐字节一致）
    codeEl.setAttribute(CODE_SRC_ATTR, (codeEl.textContent ?? '').replace(/\n$/, ''))
    const match = /language-([\w#+.-]+)/.exec(codeEl.className)
    codeEl.setAttribute(CODE_INFO_ATTR, match?.[1] ?? '')
  }
  const code = codeEl.getAttribute(CODE_SRC_ATTR) ?? ''
  const info = codeEl.getAttribute(CODE_INFO_ATTR) ?? ''
  const lang = resolveCodeLanguage(info)
  const trimmed = info.trim()
  const label = lang?.displayName ?? (trimmed === '' ? 'Plain text' : trimmed)
  const tokens = opts.config.highlight && lang && hasHighlightEngine(lang.id)
    ? readingTokenRanges(block, lang.id, code)
    : []

  // 清旧结构（重增强幂等）
  block.querySelector(`:scope > .${CODE_CARD_CLASS_NAMES.header}`)?.remove()
  block.classList.remove(READING_CODE_CARD_CLASS, READING_CODE_CARD_FOLDED_CLASS)

  if (!opts.config.card) {
    // 朴素形态：仅高亮（token span 直接注入 code，不做行结构）
    rebuildCodeText(codeEl, tokens, code)
    return
  }

  // 卡片形态：头部 + 行结构（token；卡内行号已随 2026-10 阅读侧退场移除）
  block.classList.add(READING_CODE_CARD_CLASS)
  if (opts.folded) {
    block.classList.add(READING_CODE_CARD_FOLDED_CLASS)
  }
  const header = document.createElement('div')
  header.className = CODE_CARD_CLASS_NAMES.header
  header.setAttribute('data-vsidian-code-lang', lang?.id ?? '')
  const labelEl = document.createElement('span')
  labelEl.className = CODE_CARD_CLASS_NAMES.headerLabel
  appendLanguageBadge(labelEl, lang?.id ?? null)
  labelEl.appendChild(document.createTextNode(label))
  const actions = document.createElement('span')
  actions.className = CODE_CARD_CLASS_NAMES.headerActions
  // #190 按钮区折叠钮固定最右（收起/展开位置恒定）；#191 折行钮插在复制
  // 钮左侧：[折行] [复制] [折叠]。收起态不发射折行钮与复制钮（与 Live 的
  // copy = config.copyButton && !isFolded 同口径，仅留折叠钮）
  if (!opts.folded && opts.onWrapToggle) {
    actions.appendChild(buildWrapButton(opts.wrap !== false, opts.onWrapToggle))
  }
  if (opts.config.copyButton && !opts.folded) {
    actions.appendChild(buildCopyButton(code, opts.onCopy))
  }
  actions.appendChild(buildFoldButton(opts.folded, opts.onFoldToggle))
  // #190 整条折叠热区：头部横带整体可点击切换折叠，排除按钮本身（按钮
  // click 已 stopPropagation，不会走到这里）；阅读侧无 CM6，无需拦 mousedown
  header.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button') !== null) {
      return
    }
    opts.onFoldToggle()
  })
  header.append(labelEl, actions)
  block.insertBefore(header, block.firstChild)

  codeEl.textContent = ''
  if (opts.folded) {
    // 收起态：代码体不产出行结构（与 Live 的整块收起同语义——行从 DOM
    // 消失而非 CSS 隐藏，探针计数与视觉一致）；展开时从源码快照重建
    return
  }
  const lines = code === '' ? [] : code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const row = document.createElement('span')
    // 行类与 Live 同名（paint 探针 cardLineCount 跨视图同口径）
    row.className = `${READING_CODE_LINE_CLASS} ${CODE_CARD_CLASS_NAMES.line}`
    const text = document.createElement('span')
    appendTokenizedText(text, tokens, lineOffsets(lines, i), line)
    row.appendChild(text)
    codeEl.appendChild(row)
  }
}

/** 各行在 code 中的 [from, to) 区间（首行 0 起，含换行归属前一行之后） */
function lineOffsets(lines: readonly string[], index: number): { from: number; to: number } {
  let from = 0
  for (let i = 0; i < index; i++) {
    from += lines[i]!.length + 1
  }
  return { from, to: from + lines[index]!.length }
}

/** 按行区间裁剪 token 并以 span + 文本节点填充（XSS 安全：textContent） */
function appendTokenizedText(
  target: HTMLElement,
  tokens: readonly { from: number; to: number; cls: string }[],
  line: { from: number; to: number },
  lineText: string,
): void {
  const pieces: Array<{ text: string; cls: string | null }> = []
  let cursor = line.from
  for (const token of tokens) {
    if (token.to <= line.from || token.from >= line.to) {
      continue
    }
    const from = Math.max(token.from, line.from)
    const to = Math.min(token.to, line.to)
    if (from > cursor) {
      pieces.push({ text: lineText.slice(cursor - line.from, from - line.from), cls: null })
    }
    pieces.push({ text: lineText.slice(from - line.from, to - line.from), cls: token.cls })
    cursor = to
  }
  if (cursor < line.to) {
    pieces.push({ text: lineText.slice(cursor - line.from), cls: null })
  }
  for (const piece of pieces) {
    if (piece.cls === null || piece.text === '') {
      if (piece.text !== '') {
        target.appendChild(document.createTextNode(piece.text))
      }
      continue
    }
    const span = document.createElement('span')
    span.className = piece.cls
    span.textContent = piece.text
    target.appendChild(span)
  }
}

/** 朴素形态的 token 注入（不分行；跨行 token 逐行切段拼接保持文本逐字节一致） */
function rebuildCodeText(
  codeEl: HTMLElement,
  tokens: readonly { from: number; to: number; cls: string }[],
  code: string,
): void {
  codeEl.textContent = ''
  const pieces: Array<{ text: string; cls: string | null }> = []
  let cursor = 0
  for (const token of tokens) {
    for (const seg of splitRangeAtLineBreaks(code, token.from, token.to)) {
      if (seg.from > cursor) {
        pieces.push({ text: code.slice(cursor, seg.from), cls: null })
      }
      pieces.push({ text: code.slice(seg.from, seg.to), cls: token.cls })
      cursor = seg.to
    }
  }
  if (cursor < code.length) {
    pieces.push({ text: code.slice(cursor), cls: null })
  }
  for (const piece of pieces) {
    if (piece.cls === null) {
      codeEl.appendChild(document.createTextNode(piece.text))
      continue
    }
    const span = document.createElement('span')
    span.className = piece.cls
    span.textContent = piece.text
    codeEl.appendChild(span)
  }
}
