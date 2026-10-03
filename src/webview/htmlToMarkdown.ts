import MarkdownIt from 'markdown-it'
import { clipboardPlainText } from './clipboardPaste'

const urlPolicy = new MarkdownIt()
export interface ConvertedHtml { markdown: string; hasFormatting: boolean }
const ignored = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'])
const blockTags = new Set(['P','DIV','UL','OL','LI','TABLE','TR','TH','TD','PRE','BLOCKQUOTE','H1','H2','H3','H4','H5','H6'])
// HTML 解析已经还原来源文字；只保护其中的字面实体前缀，避免 Markdown 再解码。
// 转换器后续生成的标点边界实体不经过此入口，代码原文也不做正文转义。
const escapeEntityPrefixes = (value: string) => value.replace(/&(?=(?:#(?:\d+|x[\da-f]+)|[a-z][\da-z]*);)/gi, '&amp;')
const escapeText = (text: string) => escapeEntityPrefixes(text).replace(/\\/g, '\\\\').replace(/([`*_~{}\[\]<>#])/g, '\\$1')
  .replace(/^(\s{0,3})([-+])(?=\s|[-+]{2})/gm, '$1\\$2').replace(/^(\s{0,3}\d+)([.)])(?=\s)/gm, '$1\\$2')
interface Marks { bold: boolean; italic: boolean; strike: boolean }
interface InlineRun extends Marks { text: string }
const unmarked: Marks = { bold:false, italic:false, strike:false }
const markKeys: Array<keyof Marks> = ['strike','italic','bold']

function effectiveMarks(el: Element, inherited: Marks): Marks {
  const style = (el as HTMLElement).style
  const weight = style?.fontWeight
  const fontStyle = style?.fontStyle
  const decoration = style?.textDecorationLine || style?.textDecoration
  return {
    bold: weight ? /^(bold|bolder|[6-9]00)$/.test(weight) : ['STRONG','B'].includes(el.tagName) || inherited.bold,
    italic: fontStyle ? /^(italic|oblique)$/.test(fontStyle) : ['EM','I'].includes(el.tagName) || inherited.italic,
    strike: (decoration ? decoration.includes('line-through') : ['DEL','S','STRIKE'].includes(el.tagName)) || inherited.strike,
  }
}

/** URL 使用现有 markdown-it 安全策略；控制字符不能拆开危险协议。 */
function safeUrl(value: string): string | null {
  const url = value.trim()
  if (!url || !urlPolicy.validateLink(url.replace(/[\u0000-\u0020\u007f]/g, ''))) return null
  return escapeEntityPrefixes(url).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** 脱离活动文档解析，不执行HTML或加载其资源；只输出Markdown支持的语义。 */
export function htmlToMarkdown(html: string): ConvertedHtml {
  if (html.length > 2_000_000) throw new Error('Clipboard HTML exceeds conversion budget')
  const template = document.createElement('template')
  template.innerHTML = html
  let hasFormatting = false
  const literalBlocks: string[] = []
  let visited = 0
  const blockContainers = new WeakMap<Element, boolean>()
  function isBlockContainer(el: Element): boolean {
    const cached = blockContainers.get(el)
    if (cached !== undefined) return cached
    const result = !ignored.has(el.tagName) && (blockTags.has(el.tagName) || Array.from(el.children).some(isBlockContainer))
    blockContainers.set(el, result)
    return result
  }
  function inline(node: Node, inherited: Marks, table: boolean): InlineRun[] {
    if (++visited > 100_000) throw new Error('Clipboard HTML exceeds node budget')
    if (node.nodeType === Node.TEXT_NODE) return [{...inherited,text:escapeText((node.textContent ?? '').replace(/\s+/g,' '))}]
    if (!(node instanceof Element) || ignored.has(node.tagName) || node.tagName === 'INPUT') return []
    const marks = effectiveMarks(node, inherited)
    const tag = node.tagName
    if (tag === 'BR') return [{...unmarked,text:table ? '<br>' : '  \n'}]
    if (node.matches('.katex,.MathJax,mjx-container,math')) return [{...marks,text:escapeText(node.querySelector('annotation')?.textContent ?? node.textContent ?? '')}]
    if (tag === 'IMG') {
      const alt=escapeText(node.getAttribute('alt') ?? '')
      const src=safeUrl(node.getAttribute('src') ?? '')
      if (src && /^https?:\/\//i.test(src)) {
        try {
          if (!/(?:^|\.)vscode-resource\.vscode-cdn\.net$|(?:^|\.)vscode-webview\.net$/i.test(new URL(src).hostname)) {
            hasFormatting=true;return [{...unmarked,text:`![${alt}](${src})`}]
          }
        } catch { /* 无效URL只保留替代文字 */ }
      }
      return [{...marks,text:alt}]
    }
    if (tag === 'CODE') {
      const text=node.textContent ?? ''
      if (!text) return []
      hasFormatting=true
      const fence='`'.repeat(Math.max(0,...Array.from(text.matchAll(/`+/g),match=>match[0].length))+1)
      const padding=/^`|`$/.test(text) || (/^ | $/.test(text) && text.trim()) ? ' ' : ''
      return [{...marks,text:`${fence}${padding}${text.replace(/\n/g,' ')}${padding}${fence}`}]
    }
    const runs=Array.from(node.childNodes).flatMap(child=>inline(child,marks,table))
    if (tag === 'A') {
      const href=safeUrl(node.getAttribute('href') ?? '')
      const label=serialize(runs)
      if (href && label.trim()) { hasFormatting=true;return [{...unmarked,text:`[${label}](${href})`}] }
    }
    return runs
  }
  function serialize(runs: InlineRun[]): string {
    const merged: InlineRun[]=[]
    for (const run of runs) {
      const last=merged.at(-1)
      if (last && last.bold===run.bold && last.italic===run.italic && last.strike===run.strike) last.text+=run.text
      else merged.push({...run})
    }
    // CommonMark 标点两侧的 delimiter flanking 会受邻接文字影响。
    // 仅把必要的邻接文字写成字符实体，呈现正文不增空格、不插 HTML 标签。
    const punctuation = /[\p{P}\p{S}]/u
    const literal = /[\p{L}\p{N}\p{M}]/u
    const entity = (character: string) => `&#${character.codePointAt(0)};`
    for (let index = 0; index < merged.length - 1; index++) {
      const before = merged[index]!, after = merged[index + 1]!
      const last = Array.from(before.text).at(-1) ?? '', first = Array.from(after.text)[0] ?? ''
      if (markKeys.some(key => before[key] && !after[key]) && punctuation.test(last) && literal.test(first)) {
        after.text = entity(first) + after.text.slice(first.length)
      }
      if (markKeys.some(key => !before[key] && after[key]) && literal.test(last) && punctuation.test(first)) {
        before.text = before.text.slice(0, -last.length) + entity(last)
      }
    }
    function encode(parts: InlineRun[], available: Array<keyof Marks>): string {
      if (!available.length || !parts.length) return parts.map(part=>part.text).join('')
      const common = available.find(key=>parts.every(part=>part[key]))
      const key = common ?? available.find(key=>parts.some(part=>part[key]))
      if (!key) return parts.map(part=>part.text).join('')
      const remaining=available.filter(candidate=>candidate!==key)
      const marker=key==='strike' ? '~~' : key==='bold' ? '**' : '*'
      if (common) return mark(encode(parts,remaining),marker)
      const groups:InlineRun[][]=[]
      for (const part of parts) {
        const last=groups.at(-1)
        if (last?.[0]?.[key]===part[key]) last.push(part)
        else groups.push([part])
      }
      return groups.map(group=>group[0]![key] ? mark(encode(group,remaining),marker) : encode(group,remaining)).join('')
    }
    return encode(merged,markKeys)
  }
  function children(el: Node, table = false, inherited: Marks = unmarked): string {
    const marks=el instanceof Element ? effectiveMarks(el,inherited) : inherited
    let result='',runs:InlineRun[]=[]
    for (const node of Array.from(el.childNodes)) {
      if (node instanceof Element && isBlockContainer(node)) {
        result+=serialize(runs)+render(node,table,marks);runs=[]
      } else runs.push(...inline(node,marks,table))
    }
    return result+serialize(runs)
  }
  function mark(text: string, marker: string): string {
    if (!text.trim()) return text
    hasFormatting = true
    const leading = text.match(/^\s*/)?.[0] ?? ''
    const trailing = text.match(/\s*$/)?.[0] ?? ''
    return leading + marker + text.trim() + marker + trailing
  }
  function render(node: Node, table = false, inherited: Marks = unmarked): string {
    if (++visited > 100_000) throw new Error('Clipboard HTML exceeds node budget')
    if (node.nodeType === Node.TEXT_NODE) return serialize(inline(node,inherited,table))
    if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return ''
    if (node instanceof DocumentFragment) return children(node, table, inherited)
    const tag = node.tagName
    if (ignored.has(tag)) return ''
    if (!blockTags.has(tag)) return isBlockContainer(node) ? children(node,table,inherited) : serialize(inline(node,inherited,table))
    if (tag === 'PRE') {
      const text = node.textContent ?? ''
      if (!text) return ''
      hasFormatting = true
      const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
      const fence = '`'.repeat(longest + 1)
      const lang = node.querySelector('code')?.className.match(/(?:^|\s)language-([a-zA-Z0-9_+-]+)/)?.[1] ?? ''
      const index = literalBlocks.push(`${fence}${lang}\n${text.replace(/\n$/, '')}\n${fence}`) - 1
      return `\n\n\u0000${index}\u0000\n\n`
    }
    if (tag === 'TABLE') {
      const rows = Array.from(node.querySelectorAll('tr'))
      const cells = rows.map((row) => Array.from(row.children).filter((cell) => cell.matches('th,td')))
      if (!cells.length || !cells[0]?.length || cells.some((row) => row.length !== cells[0]!.length) ||
          cells.flat().some((cell) => Number(cell.getAttribute('colspan') ?? 1) !== 1 || Number(cell.getAttribute('rowspan') ?? 1) !== 1)) {
        return clipboardPlainText({ html: node.outerHTML, images: [] }) + '\n\n'
      }
      hasFormatting = true
      const lines = cells.map((row) => '| ' + row.map((cell) => children(cell, true).trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>')).join(' | ') + ' |')
      const delimiter = '| ' + cells[0]!.map((cell) => {
        const align = (cell as HTMLElement).style.textAlign || cell.getAttribute('align')
        return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
      }).join(' | ') + ' |'
      lines.splice(1, 0, delimiter)
      return '\n\n' + lines.join('\n') + '\n\n'
    }
    if (tag === 'UL' || tag === 'OL') {
      const marks = effectiveMarks(node, inherited)
      const items = Array.from(node.children).filter((child) => child.tagName === 'LI')
      if (!items.length) return ''
      hasFormatting = true
      const start = Number(node.getAttribute('start') ?? 1) || 1
      const lines = items.map((li, index) => {
        const nested = Array.from(li.children).filter((el) => el.matches('ul,ol'))
        const clone = li.cloneNode(true) as Element
        Array.from(clone.children).filter((el) => el.matches('ul,ol')).forEach((el) => el.remove())
        const checkbox = clone.querySelector('input[type="checkbox"]') as HTMLInputElement | null
        const task = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : ''
        checkbox?.remove()
        const prefix = tag === 'OL' ? `${start + index}. ` : '- '
        const content = children(clone, table, marks).trim().replace(/\n{3,}/g, '\n\n')
        const line = prefix + task + content.replace(/\n/g, '\n' + ' '.repeat(prefix.length))
        return line + nested.map((el) => '\n' + render(el, table, effectiveMarks(li, marks)).trim().split('\n').map((part) => ' '.repeat(prefix.length) + part).join('\n')).join('')
      })
      return '\n\n' + lines.join('\n') + '\n\n'
    }
    const content = children(node, table, inherited)
    if (tag === 'BLOCKQUOTE') {
      if (content.trim()) hasFormatting = true
      return '\n\n' + content.trim().split('\n').map((line) => line ? '> ' + line : '>').join('\n') + '\n\n'
    }
    if (/^H[1-6]$/.test(tag)) {
      if (content.trim()) hasFormatting = true
      return '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + content.trim() + '\n\n'
    }
    if (tag === 'P' || tag === 'DIV') return content.trim() + '\n\n'
    return content
  }
  const paragraphs = template.content.querySelectorAll('p')
  if (paragraphs.length > 1) hasFormatting = true
  const markdown = render(template.content).replace(/\n{3,}/g, '\n\n').trim()
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => literalBlocks[Number(index)] ?? '')
  return { markdown, hasFormatting }
}
