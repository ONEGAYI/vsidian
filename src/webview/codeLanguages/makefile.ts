// Original GNU make lexical subset, never an evaluator or recipe executor.
// Custom .RECIPEPREFIX and deep shell parsing are intentionally out of scope.
import type { StreamParser, StringStream } from '@codemirror/language'

interface MakeState {
  references: string[]
  continued: boolean
  comment: boolean
  recipe: boolean
  targets: boolean
  rule: boolean
  directive: boolean
  quote: string
}
const DIRECTIVES = new Set('define endef undefine ifdef ifndef ifeq ifneq else endif include -include sinclude override export unexport private vpath'.split(' '))
const ASSIGNMENT = /^(?::{1,3}=|\?=|\+=|!=|=)/
const ASSIGNMENT_AHEAD = new RegExp('^\\s*' + ASSIGNMENT.source.slice(1))
const endsInContinuation = (line: string) => /(?:^|[^\\])(?:\\\\)*\\$/.test(line)

function reference(stream: StringStream, state: MakeState): string {
  while (!stream.eol() && state.references.length) {
    if (stream.match('$(')) state.references.push(')')
    else if (stream.match('${')) state.references.push('}')
    else {
      const ch = stream.next()
      const close = state.references.at(-1)
      if (ch === (close === ')' ? '(' : '{')) state.references.push(close!)
      else if (ch === close) state.references.pop()
      else if (ch === '\\') stream.next()
    }
  }
  return 'variableName'
}

export const makefile: StreamParser<MakeState> = {
  name: 'makefile',
  startState: () => ({ references: [], continued: false, comment: false, recipe: false, targets: false, rule: false, directive: true, quote: '' }),
  copyState: (state) => ({ ...state, references: [...state.references] }),
  blankLine(state) {
    state.continued = false
    state.comment = false
    state.references = []
    state.quote = ''
  },
  token(stream, state) {
    if (stream.sol()) {
      if (!state.continued) {
        state.references = []
        state.comment = false
        state.quote = ''
        state.recipe = stream.peek() === '\t'
        state.directive = !state.recipe
        state.targets = !state.recipe && /^[^#=]*:(?![:=])/.test(stream.string)
        state.rule = state.targets
      }
      state.continued = endsInContinuation(stream.string)
    }
    if (state.comment) {
      stream.skipToEnd()
      return 'comment'
    }
    if (state.references.length) return reference(stream, state)
    if (state.quote) {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\' && state.quote === '"') stream.next()
        else if (ch === state.quote) { state.quote = ''; break }
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    if (stream.peek() === '#' && (!state.recipe || stream.pos === 0 || /[\s;|&()]/.test(stream.string[stream.pos - 1]!))) {
      state.comment = !state.recipe && state.continued
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('$(') || stream.match('${')) {
      state.references.push(stream.current() === '$(' ? ')' : '}')
      return reference(stream, state)
    }
    if (stream.match(/^\$[^({]/)) return 'variableName'
    if (state.recipe && (stream.peek() === '"' || stream.peek() === "'")) {
      state.quote = stream.next()!
      // Consume the opening quote with its body, keeping a single string token.
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\' && state.quote === '"') stream.next()
        else if (ch === state.quote) { state.quote = ''; break }
      }
      return 'string'
    }
    if (stream.match(ASSIGNMENT)) { state.targets = false; state.rule = false; return null }
    if (stream.peek() === ':') { stream.next(); state.targets = false; return null }
    if (stream.peek() === ';') { stream.next(); if (state.rule) state.recipe = true; return null }
    if (stream.peek() === '\\') { stream.next(); stream.next(); return null }
    if (stream.match(/^[^\s$#:=?!+;\\"']+/)) {
      const directive = state.directive && DIRECTIVES.has(stream.current())
      state.directive = directive && /^(override|export|unexport|private)$/.test(stream.current())
      if (directive) return 'keyword'
      if (state.targets) return 'variableName.definition'
      if (!state.recipe && stream.match(ASSIGNMENT_AHEAD, false)) return 'variableName'
      return null
    }
    stream.next()
    return null
  },
}
