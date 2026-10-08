// Original lexical GraphQL mode based on the September 2025 specification.
// Query/SDL tokens only: no schema validation, completion or language service.
import type { StreamParser, StringStream } from '@codemirror/language'

interface GraphqlState { blockString: boolean }
const KEYWORDS = new Set('query mutation subscription fragment on schema scalar type interface union enum input extend directive implements repeatable'.split(' '))

function blockString(stream: StringStream, state: GraphqlState): string {
  while (!stream.eol()) {
    if (stream.match('\\"""')) continue
    if (stream.match('"""')) { state.blockString = false; break }
    stream.next()
  }
  return 'string'
}

export const graphql: StreamParser<GraphqlState> = {
  name: 'graphql',
  startState: () => ({ blockString: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.blockString) return blockString(stream, state)
    if (stream.eatSpace()) return null
    if (stream.peek() === '#') { stream.skipToEnd(); return 'comment' }
    if (stream.match('"""')) { state.blockString = true; return blockString(stream, state) }
    if (stream.eat('"')) {
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') stream.next()
        else if (ch === '"') break
      }
      return 'string'
    }
    if (stream.match(/^\$[_A-Za-z][_0-9A-Za-z]*/)) return 'variableName'
    if (stream.match(/^@[_A-Za-z][_0-9A-Za-z]*/)) return 'meta'
    // Read a numeric-looking atom once, even when invalid. Retrying a failing
    // number regexp at every digit makes a long malformed line quadratic.
    if (stream.match(/^-?(?:\d|\.\d)(?:[eE][+-]|[\w.])*/)) {
      return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(stream.current()) ? 'number' : null
    }
    if (stream.match(/^[_A-Za-z][_0-9A-Za-z]*/)) {
      const word = stream.current()
      if (KEYWORDS.has(word)) return 'keyword'
      if (word === 'true' || word === 'false' || word === 'null') return 'atom'
      return /^[A-Z]/.test(word) ? 'typeName' : 'propertyName'
    }
    stream.next()
    return null
  },
}
