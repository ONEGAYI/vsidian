// Original lexical mode for ngspice/common HSPICE netlists. It never evaluates
// expressions, executes control commands or resolves include paths. Sources and
// deliberate dialect limits: docs/specs/code-language-sources.md.
import type { StreamParser } from '@codemirror/language'

interface SpiceState { control: boolean; first: boolean }
const CONTROL_COMMANDS = new Set('alter altermod destroy display echo foreach end if else let linearize meas plot print quit reset run set setplot shell source stop tran unset while write'.split(' '))

export const spice: StreamParser<SpiceState> = {
  name: 'spice',
  startState: () => ({ control: false, first: true }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (stream.sol()) state.first = true
    if (stream.eatSpace()) return null
    if ((state.first && stream.peek() === '*') || stream.match(/^(?:;|\/\/)/) || (!state.control && stream.peek() === '$')) {
      stream.skipToEnd()
      return 'comment'
    }
    const first = state.first
    state.first = false
    const directive = first && stream.match(/^\.[a-z][\w]*/i)
    if (directive) {
      const word = stream.current().toLowerCase()
      if (word === '.control') state.control = true
      else if (word === '.endc') state.control = false
      return 'keyword'
    }
    if (state.control && stream.match(/^\$(?:&|\?)*[\w.]+/)) return 'variableName'
    const quote = stream.peek()
    if (quote === '"' || quote === "'") {
      stream.next()
      while (!stream.eol()) {
        const ch = stream.next()
        if (ch === '\\') stream.next()
        else if (ch === quote) break
      }
      return 'string'
    }
    // Read a numeric-looking atom once, even when invalid. Retrying a failing
    // number regexp at every digit makes a long malformed line quadratic.
    if (stream.match(/^[+-]?(?:\d|\.\d)(?:[eE][+-]|[\w.])*/)) {
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmunpf])?[a-z]*$/i.test(stream.current()) ? 'number' : null
    }
    if (stream.match(/^[a-z_][\w.$]*/i)) {
      const word = stream.current()
      if (state.control && CONTROL_COMMANDS.has(word.toLowerCase())) return 'keyword'
      if (first && !state.control) return 'variableName.definition'
      return 'variableName'
    }
    stream.next()
    return null
  },
}
