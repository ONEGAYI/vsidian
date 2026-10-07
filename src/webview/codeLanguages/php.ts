// Use the official PHP Program parser for opener-free fences and its HTML-mixed
// Template parser for tagged snippets. Lexical nodes distinguish a real opener
// from examples inside PHP strings, heredocs or comments.
import { php } from '@codemirror/lang-php'
import { LRLanguage, type Language } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import { styleTags, tags } from '@lezer/highlight'

// @lezer/php 1.0.6 parses heredocs but omits their string highlight tag.
const heredocStyle = styleTags({ HeredocString: tags.string })
function withHeredocStyle(language: Language) {
  if (!(language instanceof LRLanguage)) throw new TypeError('The pinned PHP grammar must be an LRLanguage')
  return language.parser.configure({ props: [heredocStyle] })
}
export const phpPlainParser = withHeredocStyle(php({ plain: true, baseLanguage: null }).language)
const phpTemplateParser = withHeredocStyle(php().language)
const PHP_OPEN = /<\?(?:php(?=\s|$)|=)/gi
const HTML_START = /^\s*<(?:![A-Za-z-]|\/?[A-Za-z][\w:-]*(?:\s|\/?>))/

export function parsePhp(code: string): Tree {
  const openers = [...code.matchAll(PHP_OPEN)]
  if (!openers.length) return phpPlainParser.parse(code)
  if (HTML_START.test(code) || code.slice(0, openers[0]!.index).trim() === '') {
    return phpTemplateParser.parse(code)
  }
  const plain = phpPlainParser.parse(code)
  let firstError = code.length + 1
  plain.iterate({ enter(node) {
    if (node.type.isError) firstError = Math.min(firstError, node.from)
  } })
  let protectedThrough = 0
  for (const match of openers) {
    if (match.index! < protectedThrough) continue
    let node = plain.resolveInner(match.index!, 1)
    let literal = false
    for (;;) {
      if (/String|Comment/.test(node.name)) {
        // Program recovery may read prose apostrophes as PHP strings. Protect
        // only literals reached before an error and, for ordinary strings,
        // with an actual closing quote. Real tagged prose must use Template.
        const text = code.slice(node.from, node.to)
        const quote = /^[bB]?(["'])/.exec(text)?.[1]
        const closed = node.name !== 'String' || (quote !== undefined && text.endsWith(quote) &&
          !/(?:^|[^\\])(?:\\\\)*\\["']$/.test(text))
        literal = firstError > node.from && closed
        if (literal) protectedThrough = node.to
        break
      }
      if (!node.parent) break
      node = node.parent
    }
    if (!literal) return phpTemplateParser.parse(code)
  }
  return plain
}
