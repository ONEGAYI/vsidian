// #246 混排嵌入的识别配对与 DOM 提升（挂载适配层）：块内（段落/列表/
// 引用等任意容器）的行内嵌入占位（readingMarkdown 的 vsidian_embed_slot
// 规则产物）在块挂载后升级为块级卡片宿主，供 EmbedCardManager /
// RefContentMount 以与独占行 embed 块同一 dataset 通道挂载卡片。
//
// 分层契约（沿用 #222/#244 既有基建，不另起一套）：
// - **识别**：占位 span 由 markdown-it inline 规则按 shared/wikilink 的
//   embedAtPosition 产出（渲染语法权威——代码 span 等已被 markdown-it 先
//   消费，不产占位）；本模块的 occurrence 扫描（blockEmbedOccurrences）
//   用 lezer 树 + chainAt 排除代码/表格/注释/frontmatter（与
//   refExpansion.validChildSource、vaultLinkExtract 的 scanSuppressed 同源
//   边界）与**图片 alt 域排除**（终审 P1-1：markdown-it 把图片 alt 渲染为
//   属性不落 DOM，扫描侧经 imageAltRangesInLine 同集合剔除，否则序列不
//   等牵连整块降级），负责把占位定位回**原文 LF 精确区间**——inline token
//   无全文坐标（列表缩进剥离/懒续行使换算不可靠），以「占位文档序 ↔ 扫描
//   命中文档序按 inner 分组计数配对」锚定，配对失败整块降级（占位保持引用
//   行文本，不升级、不误挂）。
// - **提升**：占位在 p 内时拆段（前文 p + 宿主 + 后文 p——合法 DOM，不
//   在 p 内塞块级节点）；行内格式祖先（strong/em/mark/del 等）先拆壳，
//   横跨嵌入的粗体/斜体前后各成完整标签（可视语义保留）；列表项与引用
//   内直接落位（编号/缩进/边条容器不拆）；链接域（a 内）与表格（#248
//   接入前）不提升——占位保持行内文本形态。
// - 宿主与独占行 embed 块同构：div.vsidian-reading-embed（+ 混排修饰类
//   vsidian-reading-embed-mixed）+ data-vsidian-embed-inner / src 锚点，
//   EmbedCardManager.mountCardInto 与子卡 mountChildFrom 原样复用；卸载
//   以 data-vsidian-embed-promoted 查询配对（promotedHostsOf）。
import { imageAltRangesInLine, normalizeReferenceLabel, scanEmbedsInLine } from '../shared/wikilink'
import { scanEmbedsInTableRow } from './tableCellEmbed'
import { chainAt, frontmatterRange, markdownTreeParser } from './markdownDoc'
import { READING_CLASS_NAMES } from './readingView'
import { READING_MARKDOWN_CLASS_NAMES, createMarkdownRenderer } from './readingMarkdown'
import type { Tree } from '@lezer/common'
import type { Env } from 'markdown-it'

/** 混排嵌入占位的稳定类名（readingMarkdown 的 inline 规则同源常量；
 *  样式契约 content 域条目同源——占位与 vsidian-embed-ref 同形态但为
 *  span（可处于链接行内域而不产生嵌套 a 的非法 DOM） */
export const EMBED_SLOT_CLASS = READING_MARKDOWN_CLASS_NAMES.embedSlot

/** 混排宿主修饰类（叠加在 vsidian-reading-embed 上的公开样式入口） */
export const EMBED_MIXED_HOST_CLASS = READING_CLASS_NAMES.embedMixed

/** occurrence 扫描的语法排除上下文（lezer 节点名）：代码族对齐
 *  vaultLinkExtract 的 INLINE_SCAN_CODE_CONTEXTS；注释/frontmatter 与渲染
 *  侧剥离同源。#248 起 Table 退役——表格内容行（TableRow/TableHeader）的
 *  格内嵌入改走 scanEmbedsInTableRow 的格内解码扫描（inner 解码语义、
 *  区间源文），与 markdown-it 占位（格内重解析）配对同源 */
const OCCURRENCE_EXCLUDED = new Set([
  'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'CodeInfo', 'InlineCode',
  'HTMLBlock', 'Comment', 'CommentBlock',
])

/** 表格内容行节点名（#248：格内解码扫描的行分类） */
const TABLE_ROW_NODE_NAMES = new Set(['TableRow', 'TableHeader'])

/** 提升时需要拆壳的行内格式标签（占位提出到块级父直下；code 内不会有
 *  占位，列入仅防御） */
const INLINE_SPLIT_TAGS = new Set(['STRONG', 'EM', 'MARK', 'DEL', 'B', 'I', 'SPAN'])

/** 块区间内的嵌入出现（原文 LF 坐标；inner 未 trim——与扫描器一致） */
export interface EmbedSlotOccurrence {
  inner: string
  start: number
  end: number
}

/** 同一文档连续块挂载共用一棵 lezer 树（块级解析一次；文本变化即失效） */
let cachedTree: { text: string; tree: Tree } | null = null

function treeFor(text: string): Tree {
  if (cachedTree?.text === text) {
    return cachedTree.tree
  }
  const tree = markdownTreeParser.parse(text)
  cachedTree = { text, tree }
  return tree
}

/** 引用集提取专用渲染器（规则链一次装配；parse 是同步纯函数，实例复用） */
const refMd = createMarkdownRenderer()

/** 引用式图片 alt 排除所需的文档级 ref 定义集（markdown-it refmap 权威，
 *  与块数据 references 同源）：调用方未传时按全文惰性提取并缓存（同文本
 *  只 parse 一次；无 `]:` 定义形态特征时零 parse）。仅在行内出现引用式
 *  图片域时经回调触发（imageAltRangesInLine 惰性语义），频率极低 */
let cachedRefs: { text: string; refs: ReadonlySet<string> } | null = null

function referenceLabelsOf(text: string): ReadonlySet<string> {
  if (cachedRefs?.text === text) {
    return cachedRefs.refs
  }
  const refs = new Set<string>()
  if (text.includes(']:')) {
    const env: Env = {}
    refMd.parse(text, env)
    for (const key of Object.keys(env.references ?? {})) {
      refs.add(key)
    }
  }
  cachedRefs = { text, refs }
  return refs
}

/**
 * 块区间内的全部嵌入 occurrence（文档序）：逐行扫描命中后经 lezer 树语法
 * 上下文过滤（代码/注释/frontmatter 不命中——与 validChildSource、
 * vaultLinkExtract 同源排除）与**图片 alt 域排除**（终审 P1-1：markdown-it
 * 把图片 alt 渲染为属性、占位不落 DOM，occurrence 侧须同集合对齐——
 * imageAltRangesInLine 的宁窄勿宽口径见 shared/wikilink）。列表/引用前缀
 * 行照常命中（前缀字符不构成 `![[`，不影响扫描）；#248 起表格内容行
 * （TableRow/TableHeader）走 scanEmbedsInTableRow 的**格内解码扫描**——
 * 逐格切分（`\|` 不切列）后在解码视图识别，inner 为解码语义（`B|别名`）、
 * 区间为原始源文——与 markdown-it 格内重解析产出的占位（inner 同解码
 * 语义）按文档序配对。
 *
 * references 为文档级 ref 定义集（引用式图片 alt 排除用；块数据
 * block.references 同源可传）。缺省时按全文惰性提取缓存（markdown-it
 * refmap 权威）。
 */
export function blockEmbedOccurrences(
  text: string,
  blockStart: number,
  blockEnd: number,
  references?: ReadonlySet<string>,
): EmbedSlotOccurrence[] {
  if (blockStart < 0 || blockEnd > text.length || blockStart >= blockEnd) {
    return []
  }
  if (!text.slice(blockStart, blockEnd).includes('![[')) {
    return []
  }
  const tree = treeFor(text)
  const fm = frontmatterRange(text)
  const out: EmbedSlotOccurrence[] = []
  let base = blockStart
  for (const line of text.slice(blockStart, blockEnd).split('\n')) {
    if (line.includes('![[')) {
      const isTableRow = chainAt(tree, base).some((node) => TABLE_ROW_NODE_NAMES.has(node.name))
      const altRanges = imageAltRangesInLine(line, 0, (label) =>
        (references ?? referenceLabelsOf(text)).has(normalizeReferenceLabel(label)))
      const hits = isTableRow ? scanEmbedsInTableRow(line, 0) : scanEmbedsInLine(line, 0)
      for (const hit of hits) {
        if (fm !== null && base + hit.from < fm.end) {
          continue
        }
        if (chainAt(tree, base + hit.from).some((node) => OCCURRENCE_EXCLUDED.has(node.name))) {
          continue
        }
        if (altRanges.some((r) => hit.from >= r.from && hit.from < r.to)) {
          continue
        }
        out.push({ inner: hit.inner, start: base + hit.from, end: base + hit.to })
      }
    }
    base += line.length + 1
  }
  return out
}

/**
 * 块 DOM 内的直属占位（文档序），排除不可升级成员：
 * - 已升级卡片内部的嵌套占位（孙卡由其自身内容挂载流程处理，不重复升级）
 * - #248 起表格内占位**升级为真挂载**（原 table 祖先排除退役）——td/th 内
 *   占位由 promoteEmbedSlot 原位替换为卡片宿主，配对与其它容器同源
 */
export function directEmbedSlots(blockEl: HTMLElement): HTMLElement[] {
  return Array.from(blockEl.querySelectorAll<HTMLElement>(`span[data-vsidian-embed-inner]`))
    .filter((slot) => slot.closest('.vsidian-embed-card') === null)
}

/**
 * 占位与 occurrence 配对：两侧各按文档序，同 inner 分组计数一一对应
 * （第 k 个某 inner 的占位 ↔ 第 k 个该 inner 的扫描命中）。两侧集合由
 * 语法排除表结构性对齐（markdown-it 占位产出于渲染文本、occurrence 经
 * lezer 树过滤；表格占位在 directEmbedSlots 剔除、跨行注释在
 * OCCURRENCE_EXCLUDED 的 CommentBlock 剔除、图片 alt 域字面量在
 * imageAltRangesInLine 剔除——终审 P1-1）——正常路径两侧恒等长。
 * 数量不一致（未对齐的语法角落或宿主文档竞态）返回 null，调用方整块
 * 降级（占位保持文本形态，安全侧）。
 */
export function pairEmbedSlots(
  slots: readonly HTMLElement[],
  occurrences: readonly EmbedSlotOccurrence[],
): Array<{ slot: HTMLElement; occ: EmbedSlotOccurrence }> | null {
  if (slots.length !== occurrences.length) {
    return null
  }
  const seen = new Map<string, number>()
  const byInner = new Map<string, EmbedSlotOccurrence[]>()
  for (const occ of occurrences) {
    const list = byInner.get(occ.inner)
    if (list) list.push(occ)
    else byInner.set(occ.inner, [occ])
  }
  const out: Array<{ slot: HTMLElement; occ: EmbedSlotOccurrence }> = []
  for (const slot of slots) {
    const inner = slot.dataset['vsidianEmbedInner'] ?? ''
    const k = seen.get(inner) ?? 0
    seen.set(inner, k + 1)
    const occ = byInner.get(inner)?.[k]
    if (!occ) {
      return null
    }
    out.push({ slot, occ })
  }
  return out
}

/**
 * 单个占位提升为块级卡片宿主。链接域（a 内）不提升（返回 null，占位保持
 * 行内文本——块级卡片在行内链接域属非法 DOM，点击走外层链接）；#248 起
 * 表格格内（td/th）**提升为真挂载**（原 table 祖先拒绝退役）。其余按最近
 * 块级父容器落位：
 * - p 内：拆为 p(前文) + 宿主 + p(后文)，类与属性克隆保留，空半不产出
 * - 行内格式祖先：逐层拆壳（strong/em 等前后各成完整标签）
 * - li/blockquote/td/th 等流内容容器：占位原位替换（容器结构不拆——
 *   编号/缩进/边条/表格行列网格保持，宿主宽度跟随所属列）
 */
export function promoteEmbedSlot(slot: HTMLElement, occ: EmbedSlotOccurrence): HTMLElement | null {
  if (slot.closest('a') !== null) {
    return null
  }
  // 行内格式祖先拆壳：把占位提出到最近块级父直下
  for (;;) {
    const parent = slot.parentElement
    if (parent === null || !INLINE_SPLIT_TAGS.has(parent.tagName)) {
      break
    }
    const after = parent.cloneNode(false) as HTMLElement
    for (let node = slot.nextSibling; node !== null; ) {
      const next = node.nextSibling
      after.appendChild(node)
      node = next
    }
    if (after.childNodes.length > 0) {
      parent.parentNode!.insertBefore(after, parent.nextSibling)
    }
    parent.parentNode!.insertBefore(slot, parent.nextSibling)
    if (parent.childNodes.length === 0) {
      parent.remove()
    }
  }
  const blockParent = slot.parentElement
  if (blockParent === null) {
    return null
  }
  const host = document.createElement('div')
  host.className = `${READING_CLASS_NAMES.embedBlock} ${EMBED_MIXED_HOST_CLASS}`
  host.dataset['vsidianEmbedInner'] = occ.inner
  host.dataset['vsidianSrcStart'] = String(occ.start)
  host.dataset['vsidianSrcEnd'] = String(occ.end)
  host.dataset['vsidianEmbedPromoted'] = '1'
  if (blockParent.tagName === 'P') {
    const before = blockParent.cloneNode(false) as HTMLElement
    for (let node = blockParent.firstChild; node !== null && node !== slot; ) {
      const next = node.nextSibling
      before.appendChild(node)
      node = next
    }
    const after = blockParent.cloneNode(false) as HTMLElement
    for (let node = slot.nextSibling; node !== null; ) {
      const next = node.nextSibling
      after.appendChild(node)
      node = next
    }
    const fragment = document.createDocumentFragment()
    if (before.childNodes.length > 0) fragment.appendChild(before)
    fragment.appendChild(host)
    if (after.childNodes.length > 0) fragment.appendChild(after)
    blockParent.parentNode!.replaceChild(fragment, blockParent)
    return host
  }
  blockParent.replaceChild(host, slot)
  return host
}

/**
 * 块挂载后的批量提升：扫描直属占位 → occurrence 配对 → 逐个提升。
 * 配对失败（识别面分叉）时不动 DOM（占位保持引用行形态，安全降级）。
 */
export function promoteEmbedSlotsInBlock(
  blockEl: HTMLElement,
  text: string,
  blockStart: number,
  blockEnd: number,
  references?: ReadonlySet<string>,
): HTMLElement[] {
  const slots = directEmbedSlots(blockEl)
  if (slots.length === 0) {
    return []
  }
  const paired = pairEmbedSlots(slots, blockEmbedOccurrences(text, blockStart, blockEnd, references))
  if (paired === null) {
    return []
  }
  const hosts: HTMLElement[] = []
  for (const { slot, occ } of paired) {
    const host = promoteEmbedSlot(slot, occ)
    if (host !== null) {
      hosts.push(host)
    }
  }
  return hosts
}

/**
 * 块内的直属提升宿主（卸载配对查询；排除卡片内部的嵌套宿主——孙卡随
 * 其内容挂载的生命周期释放，不由本块重复卸载）。
 */
export function promotedHostsOf(blockEl: HTMLElement): HTMLElement[] {
  return Array.from(blockEl.querySelectorAll<HTMLElement>('[data-vsidian-embed-promoted]'))
    .filter((host) => host.closest('.vsidian-embed-card') === null)
}
