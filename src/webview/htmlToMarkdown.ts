import MarkdownIt from 'markdown-it'
import { clipboardPlainText } from './clipboardPaste'
import {
  ADDON_PASTE_RULES_EVAL_STEP_BUDGET,
  ADDON_PASTE_RULES_REGEX_INPUT_LIMIT,
  orderAddonPasteRules,
  parseAddonPasteTemplate,
  type AddonPasteConditionNode,
  type AddonPasteNestedRule,
  type AddonPasteRegex,
  type AddonPasteRule,
  type AddonPasteTemplatePart,
} from '../shared/addonPasteRules'

const urlPolicy = new MarkdownIt()
export interface ConvertedHtml { markdown: string; hasFormatting: boolean }
/** 转换选项：addonPasteRules 为本次粘贴开始时捕获的有效规则序（快照） */
export interface HtmlToMarkdownOptions {
  addonPasteRules?: readonly AddonPasteRule[]
}
const ignored = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'])
const HTML_NODE_BUDGET = 100_000
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

// ---- #541 T01 / #542 T02 附加组件粘贴规则求值（声明与切分同源 shared/addonPasteRules） ----

/** 求值步预算耗尽哨兵（同步抛出/捕获；单次 RegExp 执行本身不可中断） */
const ADDON_PASTE_RULES_BUDGET_EXHAUSTED = { sentinel: 'addon-paste-rules-eval-budget' }

interface AddonPasteRuleEvaluationDeps {
  templateCache: Map<string, readonly AddonPasteTemplatePart[]>
  /** 正则编译缓存（本次粘贴结束即释放；编译失败缓存 null——单条失败回退） */
  regexCache: Map<string, RegExp | null>
  /** 计一步（规则尝试/条件节点/正则执行各一步）；超预算抛预算哨兵 */
  spendStep(): void
  /** children 槽取值：子内容按内置转换（已转换片段，不再二次转义）；
   * nestedRules 提供时先按子规则集转换（#542 T02），否则纯内置（T01） */
  convertChildren(el: Element, nestedRules?: readonly AddonPasteNestedRule[]): string
}

/** 正则执行（单步计费；编译失败按单条规则失败缓存并返回 null） */
function runAddonPasteRegex(regex: AddonPasteRegex, input: string, deps: AddonPasteRuleEvaluationDeps): RegExpExecArray | null {
  deps.spendStep()
  const key = `${regex.flags ?? ''}\u0000${regex.pattern}`
  let compiled = deps.regexCache.get(key)
  if (compiled === undefined) {
    try {
      compiled = new RegExp(regex.pattern, regex.flags ?? '')
    } catch {
      compiled = null
    }
    deps.regexCache.set(key, compiled)
  }
  return compiled === null ? null : compiled.exec(input)
}

/**
 * 条件树三值求值（#542 T02；PR #564 评审改为三值）：命中 true / 不匹配
 * false / 求值失败 'fail'，每节点计一步（已花费的步不因失败退回）。
 * - attribute：存在性/值相等（与 T01 match.attributes 同语义）；
 * - 正则谓词：属性缺失是「不匹配」（false，空串仍执行正则）；输入超过
 *   ADDON_PASTE_RULES_REGEX_INPUT_LIMIT 是「求值失败」（fail）——失败与
 *   不匹配不同：fail 在 not/all/any 中立即向上传播（整树不再继续求值，
 *   不能被 not 反转成命中），顶层收到 fail 时本条规则失败跳过，与槽取值
 *   的「必需取值缺失」同边界（进入下一条规则，不截断不改写）；
 * - 组合节点短路求值（all 遇 false 短路、any 遇 true 短路、遇 fail 立即
 *   传播）。
 */
type AddonPasteConditionEval = boolean | 'fail'

function evaluateAddonPasteCondition(node: AddonPasteConditionNode, el: Element, deps: AddonPasteRuleEvaluationDeps): AddonPasteConditionEval {
  deps.spendStep()
  if ('kind' in node) {
    if (node.kind === 'attribute') {
      return node.value === undefined ? el.hasAttribute(node.name) : el.getAttribute(node.name) === node.value
    }
    if (node.kind === 'attribute-regex') {
      const value = el.getAttribute(node.name)
      if (value === null) return false
      if (value.length > ADDON_PASTE_RULES_REGEX_INPUT_LIMIT) return 'fail'
      return runAddonPasteRegex(node.regex, value, deps) !== null
    }
    const text = el.textContent ?? ''
    if (text.length > ADDON_PASTE_RULES_REGEX_INPUT_LIMIT) return 'fail'
    return runAddonPasteRegex(node.regex, text, deps) !== null
  }
  if ('all' in node) {
    for (const child of node.all) {
      const result = evaluateAddonPasteCondition(child, el, deps)
      if (result === 'fail') return 'fail'
      if (result === false) return false
    }
    return true
  }
  if ('any' in node) {
    for (const child of node.any) {
      const result = evaluateAddonPasteCondition(child, el, deps)
      if (result === 'fail') return 'fail'
      if (result === true) return true
    }
    return false
  }
  const inner = evaluateAddonPasteCondition(node.not, el, deps)
  return inner === 'fail' ? 'fail' : !inner
}

/**
 * 单条规则求值：成功返回产出（discard 为空串）；不匹配、条件不满足、
 * 必需取值缺失（含正则不匹配/捕获组未参与/输入超上限）、URL 拒绝或
 * 产出为空（模板非显式丢弃）返回 null（进入下一条规则）。
 * 模板字面是作者声明的静态 Markdown 结构不转义；文本/属性/捕获组槽按
 * 内置 escapeText 转义；URL 槽经既有 safeUrl 策略；children 槽（含
 * 嵌套子规则集产物）按已转换片段拼接，不二次转义。
 */
function evaluateAddonPasteRule(rule: AddonPasteRule | AddonPasteNestedRule, el: Element, deps: AddonPasteRuleEvaluationDeps): string | null {
  if (el.tagName !== rule.match.tag) return null
  for (const condition of rule.match.attributes ?? []) {
    if (condition.value === undefined) {
      if (!el.hasAttribute(condition.name)) return null
    } else if (el.getAttribute(condition.name) !== condition.value) {
      return null
    }
  }
  // 条件不满足（false）或条件树求值失败（fail：正则输入超限等）都让本条
  // 规则让位——前者是不匹配、后者是规则失败，边界效果一致（进入下一条）。
  if (rule.match.condition !== undefined && evaluateAddonPasteCondition(rule.match.condition, el, deps) !== true) return null
  if (rule.output.kind === 'discard') return ''
  let parts = deps.templateCache.get(rule.output.template)
  if (parts === undefined) {
    const parsed = parseAddonPasteTemplate(rule.output.template)
    if (parsed === null) return null
    deps.templateCache.set(rule.output.template, parsed)
    parts = parsed
  }
  let output = ''
  for (const part of parts) {
    if ('literal' in part) {
      output += part.literal
      continue
    }
    const slot = rule.output.slots[part.slot]
    if (!slot) return null
    // 取值：属性缺失（null）、文本/子内容为空串、正则不匹配、捕获组
    // 未参与与捕获空串、正则输入超上限，都是必需取值缺失——本规则失败
    let raw: string | null
    if (slot.source.kind === 'text') {
      raw = el.textContent ?? ''
      if (raw === '') raw = null
    } else if (slot.source.kind === 'attribute') {
      raw = el.getAttribute(slot.source.name)
    } else if (slot.source.kind === 'children') {
      raw = deps.convertChildren(el, slot.source.rules)
      if (raw === '') raw = null
    } else {
      const input = slot.source.kind === 'text-regex'
        ? el.textContent ?? ''
        : el.getAttribute(slot.source.name)
      if (input === null || input === '' || input.length > ADDON_PASTE_RULES_REGEX_INPUT_LIMIT) {
        raw = null
      } else {
        const matched = runAddonPasteRegex(slot.source.regex, input, deps)
        if (matched === null) {
          raw = null
        } else {
          const captured = typeof slot.source.group === 'number'
            ? (slot.source.group < matched.length ? matched[slot.source.group] : undefined)
            : matched.groups?.[slot.source.group]
          raw = captured === undefined || captured === '' ? null : captured
        }
      }
    }
    if (raw === null) return null
    if (slot.url === true) {
      const safe = safeUrl(raw)
      if (safe === null) return null
      output += safe
    } else if (slot.source.kind === 'children') {
      output += raw
    } else {
      output += escapeText(raw)
    }
  }
  if (output === '') return null
  return output
}

/** 脱离活动文档解析，不执行HTML或加载其资源；只输出Markdown支持的语义。 */
export function htmlToMarkdown(html: string, options?: HtmlToMarkdownOptions): ConvertedHtml {
  if (html.length > 2_000_000) throw new Error('Clipboard HTML exceeds conversion budget')
  const template = document.createElement('template')
  template.innerHTML = html
  let hasFormatting = false
  const literalBlocks: string[] = []
  let visited = 0
  // #541 T01 / #542 T02 附加组件粘贴规则：本次粘贴使用开始时捕获的有效
  // 快照（调用方传入），转换中不拼接两个注册代次；入口统一应用确定性排
  // 序与嵌套子规则集递归规整（顺序不取决于页面装载先后）；求值步数预算
  // 超限停用规则（内置转换继续），单条失败进入下一条，全部未成功回内置。
  // 嵌套求值期间活动规则集切换为 children 槽声明的子规则集（外层规则集
  // 不串入——不按规则 ID 回跳或再次转换自身，只沿子节点下降）。
  const addonRules = orderAddonPasteRules(options?.addonPasteRules ?? [])
  // 本次粘贴结束即释放，旧注册/代次的模板与正则不驻留到后续粘贴。
  const templateCache = new Map<string, readonly AddonPasteTemplatePart[]>()
  const regexCache = new Map<string, RegExp | null>()
  let addonRuleSteps = 0
  let addonRulesExhausted = false
  let activeRules: readonly (AddonPasteRule | AddonPasteNestedRule)[] = addonRules
  const spendAddonRuleStep = () => {
    addonRuleSteps += 1
    if (addonRuleSteps > ADDON_PASTE_RULES_EVAL_STEP_BUDGET) throw ADDON_PASTE_RULES_BUDGET_EXHAUSTED
  }
  function addonRuleOutput(el: Element, table: boolean, inherited: Marks): InlineRun | null {
    if (activeRules.length === 0 || addonRulesExhausted) return null
    for (const rule of activeRules) {
      try {
        spendAddonRuleStep()
        const output = evaluateAddonPasteRule(rule, el, {
          templateCache,
          regexCache,
          spendStep: spendAddonRuleStep,
          convertChildren: (target, nestedRules) => {
            const previous = activeRules
            activeRules = nestedRules ?? []
            try {
              return children(target, table, inherited)
            } finally {
              activeRules = previous
            }
          },
        })
        if (output !== null) {
          // children 槽（含嵌套子规则集产物）已由子转换编码当前/继承
          // 格式；其余模板沿用行内 run 的格式合并，避免规则命中的文字
          // 脱离父层粗体等标记。
          const convertedChildren = rule.output.kind === 'template' && Object.values(rule.output.slots)
            .some(slot => slot.source.kind === 'children')
          return { ...(convertedChildren ? unmarked : effectiveMarks(el, inherited)), text: output }
        }
      } catch (error) {
        // 求值步预算耗尽：停用全部组件规则（本元素回内置，后续元素跳过）
        if (error === ADDON_PASTE_RULES_BUDGET_EXHAUSTED) {
          addonRulesExhausted = true
          return null
        }
        // 全局转换预算耗尽必须终止整次粘贴，不能降成单条规则失败。
        if (visited > HTML_NODE_BUDGET) throw error
        // 规则求值异常进入下一规则（规格 §4.3）
      }
    }
    return null
  }
  const blockContainers = new WeakMap<Element, boolean>()
  function isBlockContainer(el: Element): boolean {
    const cached = blockContainers.get(el)
    if (cached !== undefined) return cached
    const result = !ignored.has(el.tagName) && (blockTags.has(el.tagName) || Array.from(el.children).some(isBlockContainer))
    blockContainers.set(el, result)
    return result
  }
  function inline(node: Node, inherited: Marks, table: boolean): InlineRun[] {
    if (++visited > HTML_NODE_BUDGET) throw new Error('Clipboard HTML exceeds node budget')
    if (node.nodeType === Node.TEXT_NODE) return [{...inherited,text:escapeText((node.textContent ?? '').replace(/\s+/g,' '))}]
    if (!(node instanceof Element) || ignored.has(node.tagName) || node.tagName === 'INPUT') return []
    const addonOutput = addonRuleOutput(node, table, inherited)
    if (addonOutput !== null) {
      hasFormatting = true
      return [addonOutput]
    }
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
    if (++visited > HTML_NODE_BUDGET) throw new Error('Clipboard HTML exceeds node budget')
    if (node.nodeType === Node.TEXT_NODE) return serialize(inline(node,inherited,table))
    if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return ''
    if (node instanceof DocumentFragment) return children(node, table, inherited)
    const tag = node.tagName
    if (ignored.has(tag)) return ''
    if (blockTags.has(tag) || isBlockContainer(node)) {
      const addonOutput = addonRuleOutput(node, table, inherited)
      if (addonOutput !== null) {
        hasFormatting = true
        return serialize([addonOutput])
      }
    }
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
