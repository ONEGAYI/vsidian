// Original lexical modes for JSONC and JSON5. These supply highlighting,
// not schema validation; strict JSON remains on @codemirror/lang-json.
// Sources: https://spec.json5.org/ and
// https://code.visualstudio.com/docs/languages/json#_json-with-comments
// Original implementation; no imported JavaScript grammar or code execution.
import type { StreamParser, StringStream } from '@codemirror/language'

type Position = 'key' | 'colon' | 'value' | 'after'
interface Context { kind: 'root' | 'object' | 'array'; next: Position }
interface JsonState {
  contexts: Context[]
  blockComment: boolean
  continuedString: { quote: string; style: string | null } | null
}

// ECMAScript IdentifierName Unicode categories plus $/_, ZWNJ and ZWJ;
// reserved words are allowed as property names, never arbitrary value names.
const IDENTIFIER = /^[\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$\u200c\u200d]*$/u
const JSON5_NUMBER = /^[+-]?(?:0[xX][\da-fA-F]+|(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|Infinity|NaN)$/
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function context(state: JsonState): Context {
  return state.contexts[state.contexts.length - 1]!
}

function consumeValue(state: JsonState): Position {
  const current = context(state)
  const position = current.next
  current.next = position === 'key' ? 'colon' : 'after'
  return position
}

function comment(stream: StringStream, state: JsonState): string {
  while (!stream.eol()) {
    if (stream.match('*/')) {
      state.blockComment = false
      break
    }
    stream.next()
  }
  return 'comment'
}

function quoted(stream: StringStream, state: JsonState, quote: string, style: string | null, extended: boolean): string | null {
  let valid = quote === '"' || extended
  state.continuedString = null
  while (!stream.eol()) {
    const ch = stream.next()!
    if (ch === quote) return valid ? style : null
    if (ch === '\r' || (!extended && ch.charCodeAt(0) < 32)) valid = false
    if (ch !== '\\') continue
    const escaped = stream.next()
    if (extended && (escaped === undefined || (escaped === '\r' && stream.eol()))) {
      // Only an escaped physical line ending carries string state onward.
      if (valid) state.continuedString = { quote, style }
      return valid ? style : null
    }
    if (escaped === 'u' || (extended && escaped === 'x')) {
      if (!stream.match(escaped === 'u' ? /^[0-9a-fA-F]{4}/ : /^[0-9a-fA-F]{2}/)) valid = false
    } else if (!escaped || (extended ? /[1-9]/.test(escaped) || (escaped === '0' && /\d/.test(stream.peek() ?? ''))
      : !'"\\/bfnrt'.includes(escaped))) {
      valid = false
    }
  }
  return null
}

function jsonDialect(extended: boolean): StreamParser<JsonState> {
  return {
    name: extended ? 'json5' : 'jsonc',
    startState: () => ({ contexts: [{ kind: 'root', next: 'value' }], blockComment: false, continuedString: null }),
    copyState: (state) => ({ ...state, contexts: state.contexts.map((entry) => ({ ...entry })),
      continuedString: state.continuedString ? { ...state.continuedString } : null }),
    blankLine(state) { state.continuedString = null },
    token(stream, state) {
      if (state.blockComment) return comment(stream, state)
      if (state.continuedString) {
        const { quote, style } = state.continuedString
        return quoted(stream, state, quote, style, extended)
      }
      if (stream.eatSpace()) return null
      if (stream.match('//')) {
        stream.eatWhile(extended ? /[^\r\u2028\u2029]/ : /[^\r]/)
        return 'comment'
      }
      if (stream.match('/*')) {
        state.blockComment = true
        return comment(stream, state)
      }
      const ch = stream.peek()!
      if (ch === '"' || ch === "'") {
        stream.next()
        const position = consumeValue(state)
        const style = position === 'key' ? 'propertyName' : position === 'value' ? 'string' : null
        return quoted(stream, state, ch, style, extended)
      }
      if (ch === '{' || ch === '[') {
        stream.next()
        consumeValue(state)
        state.contexts.push({ kind: ch === '{' ? 'object' : 'array', next: ch === '{' ? 'key' : 'value' })
        return 'bracket'
      }
      if (ch === '}' || ch === ']') {
        stream.next()
        if (context(state).kind === (ch === '}' ? 'object' : 'array')) state.contexts.pop()
        return 'bracket'
      }
      if (ch === ':') {
        stream.next()
        if (context(state).next === 'colon') context(state).next = 'value'
        return 'punctuation'
      }
      if (ch === ',') {
        stream.next()
        const current = context(state)
        current.next = current.kind === 'object' ? 'key' : 'value'
        return 'punctuation'
      }
      // Consume an entire atom before testing its grammar, so 0xFF, +1 and
      // 1broken never inherit a valid JSON numeric prefix's class.
      const atom = stream.match(/^[^\s{}\[\],:"'/]+/)
      if (atom) {
        const position = consumeValue(state)
        const value = stream.current()
        if (extended && position === 'key') {
          const decoded = value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
          return IDENTIFIER.test(decoded) ? 'propertyName' : null
        }
        if (position !== 'value') return null
        return (extended ? JSON5_NUMBER : JSON_NUMBER).test(value) ? 'number' : /^(true|false)$/.test(value) ? 'bool' : value === 'null' ? 'null' : null
      }
      stream.next()
      return null
    },
  }
}

export const jsonc = jsonDialect(false)
export const json5 = jsonDialect(true)
