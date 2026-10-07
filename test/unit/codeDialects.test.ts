// Public highlighting seams for #391. Literal expectations come from the SQL
// dialects and JSON5 specification, not parser internals.
import { describe, expect, it } from 'vitest'
import { resolveCodeLanguage } from '../../src/shared/codeLangs'
import { getHighlightStats, highlightCodeRanges } from '../../src/webview/codeHighlight'

function classAt(language: string, code: string, word: string): string | undefined {
  const from = code.indexOf(word)
  expect(from).toBeGreaterThanOrEqual(0)
  return highlightCodeRanges(language, code).find((range) =>
    range.from <= from && range.to >= from + word.length)?.cls
}

describe('SQL dialect routing (#391)', () => {
  it('preserves StandardSQL and uses separate PostgreSQL, MySQL and SQLite grammars', () => {
    for (const alias of ['pgsql', 'postgres', 'postgresql']) {
      expect(resolveCodeLanguage(` ${alias.toUpperCase()} title=query `)).toEqual({ id: 'postgresql', displayName: 'PostgreSQL' })
    }
    expect(resolveCodeLanguage('sql')).toEqual({ id: 'sql', displayName: 'SQL' })
    expect(resolveCodeLanguage('mysql')).toEqual({ id: 'mysql', displayName: 'MySQL' })
    expect(resolveCodeLanguage('sqlite')).toEqual({ id: 'sqlite', displayName: 'SQLite' })
    const pg = 'SELECT $body$inside -- string$body$, "Field"::jsonb;'
    expect(classAt('postgresql', pg, '$body$inside -- string$body$')).toBe('tok-string')
    expect(classAt('postgresql', pg, '"Field"')).toBe('tok-string2')
    expect(classAt('sql', pg, '$body$inside -- string$body$')).not.toBe('tok-string')
    const mysql = 'SELECT `odd name`; # mysql note'
    expect(classAt('mysql', mysql, '`odd name`')).toBe('tok-string2')
    expect(classAt('mysql', mysql, '# mysql note')).toBe('tok-comment')
    expect(classAt('sql', mysql, '# mysql note')).not.toBe('tok-comment')
    const sqlite = 'SELECT [odd name] FROM records;'
    expect(classAt('sqlite', sqlite, '[odd name]')).toBe('tok-string2')
    expect(classAt('sqlite', sqlite, 'FROM')).toBe('tok-keyword')
    expect(classAt('sqlite', 'SELECT `other name`, "double name";', '`other name`')).toBe('tok-string2')
    expect(classAt('sqlite', 'SELECT `other name`, "double name";', '"double name"')).toBe('tok-string2')
    expect(classAt('sql', sqlite, '[odd name]')).not.toBe('tok-string2')
    const code = 'SELECT 391 /* isolated cache keys */'
    const before = getHighlightStats()
    for (const language of ['sql', 'postgresql', 'mysql', 'sqlite']) highlightCodeRanges(language, code)
    expect(getHighlightStats().parserCalls - before.parserCalls).toBe(4)
    for (const language of ['sql', 'postgresql', 'mysql', 'sqlite']) highlightCodeRanges(language, code)
    expect(getHighlightStats().cacheHits - before.cacheHits).toBe(4)
  })
})

describe('JSONC lexical context (#391)', () => {
  it('highlights comments, quoted properties, nested values and trailing commas separately from strict JSON', () => {
    expect(resolveCodeLanguage('JSONC title=settings')).toEqual({ id: 'jsonc', displayName: 'JSONC' })
    const code = '{\n// settings\n"key" /* before colon */ : [true, null, {"url":"https://example.test/*literal*/",},],\n"n": -1.25e+2, /* two\nlines */\n}'
    for (const word of ['// settings', '/* before colon */', 'lines */']) {
      expect(classAt('jsonc', code, word)).toBe('tok-comment')
    }
    for (const word of ['"key"', '"url"', '"n"']) expect(classAt('jsonc', code, word)).toBe('tok-propertyName')
    expect(classAt('jsonc', code, '"https://example.test/*literal*/"')).toBe('tok-string')
    expect(classAt('jsonc', code, 'true')).toBe('tok-bool')
    expect(classAt('jsonc', code, 'null')).toBe('tok-keyword')
    expect(classAt('jsonc', code, '-1.25e+2')).toBe('tok-number')
    expect(classAt('json', code, '// settings')).not.toBe('tok-comment')
    expect(classAt('json', code, '/* before colon */')).not.toBe('tok-comment')
    expect(classAt('json', '{"strict": 3}', '"strict"')).toBe('tok-propertyName')
  })
})

describe('JSON5 extensions (#391)', () => {
  it('adds IdentifierName keys, single quotes, continuations and extended numbers without accepting them as JSONC', () => {
    expect(resolveCodeLanguage('JSON5')).toEqual({ id: 'json5', displayName: 'JSON5' })
    const code = "{unquoted: 'value', hex: -0XCAFE, fraction: +.5, tail: 5., inf: -Infinity, nan: +NaN, continued: 'first\\\nsecond', true: false,}"
    for (const key of ['unquoted', 'hex', 'fraction', 'tail', 'inf', 'nan', 'continued', 'true']) {
      expect(classAt('json5', code, key)).toBe('tok-propertyName')
      expect(classAt('jsonc', code, key)).not.toBe('tok-propertyName')
    }
    for (const value of ['-0XCAFE', '+.5', '5.', '-Infinity', '+NaN']) {
      expect(classAt('json5', code, value)).toBe('tok-number')
      expect(classAt('jsonc', code, value)).not.toBe('tok-number')
    }
    for (const value of ["'value'", 'first', 'second']) {
      expect(classAt('json5', code, value)).toBe('tok-string')
      expect(classAt('jsonc', code, value)).not.toBe('tok-string')
    }
    expect(classAt('json5', code, 'false')).toBe('tok-bool')
    expect(classAt('json', code, "'value'")).not.toBe('tok-string')
  })
})

describe('JSON dialect lexical boundaries (#391)', () => {
  it('keeps Unicode and escaped IdentifierName keys contextual, including reserved words', () => {
    const code = String.raw`{π: 1, 中文: 2, á: 3, a‌b: 4, $x: 5, _: 6, \u0061: 7, a\u0030: 8, null: 9, value: missing, nested: [{"inner": "text"},], after: true}`
    for (const key of ['π', '中文', 'á', 'a‌b', '$x', '_', String.raw`\u0061`, String.raw`a\u0030`, 'null', 'nested', 'after']) {
      expect(classAt('json5', code, key)).toBe('tok-propertyName')
      expect(classAt('jsonc', code, key)).not.toBe('tok-propertyName')
    }
    expect(classAt('json5', code, 'missing')).toBeUndefined()
    expect(classAt('json5', code, '"inner"')).toBe('tok-propertyName')
    expect(classAt('json5', code, '"text"')).toBe('tok-string')
    for (const key of ['123key', 'a-b', String.raw`\u0030bad`, String.raw`\uZZZZ`, String.raw`\u{61}`]) {
      expect(classAt('json5', `{${key}: 1}`, key)).toBeUndefined()
    }
  })

  it('consumes malformed atoms whole instead of highlighting valid number prefixes', () => {
    for (const language of ['jsonc', 'json5']) {
      for (const value of ['01', '0x', '0xGG', '0b10', '0o10', '1_000', '1n', '1e', '1e+', '1.2.3', '1+2', 'InfinitySuffix', 'undefined', 'new Date()']) {
        const code = `{"bad": ${value}, "next": 2}`
        const from = code.indexOf(value)
        const ranges = highlightCodeRanges(language, code)
        expect(ranges.filter((range) => range.from < from + value.length && range.to > from)
          .some((range) => /tok-(number|string|propertyName|keyword|bool)/.test(range.cls)), `${language}: ${value}`).toBe(false)
        expect(classAt(language, code, '"next"')).toBe('tok-propertyName')
      }
    }
    for (const value of ['0xFF', '-0xFF', '+1', '.5', '5.', 'Infinity', 'NaN']) {
      expect(classAt('jsonc', `{"n": ${value}}`, value)).toBeUndefined()
      expect(classAt('json5', `{"n": ${value}}`, value)).toBe('tok-number')
    }
  })

  it('distinguishes JSON string escapes from JSON5 character escapes and malformed escapes', () => {
    for (const language of ['jsonc', 'json5']) {
      const valid = String.raw`{"key\u0061": "quote\" slash\\ newline\n emoji\uD83D\uDE00"}`
      expect(classAt(language, valid, String.raw`"key\u0061"`)).toBe('tok-propertyName')
      expect(classAt(language, valid, String.raw`"quote\" slash\\ newline\n emoji\uD83D\uDE00"`)).toBe('tok-string')
      for (const value of [String.raw`"\uZZZZ"`, String.raw`"\xQ0"`, String.raw`"\1"`, String.raw`"\08"`]) {
        expect(classAt(language, `{"v": ${value}}`, value)).toBeUndefined()
      }
    }
    for (const value of [String.raw`'single\'quote'`, String.raw`"\x41\v\0\A"`]) {
      expect(classAt('json5', `{"v": ${value}}`, value)).toBe('tok-string')
      expect(classAt('jsonc', `{"v": ${value}}`, value)).toBeUndefined()
    }
  })

  it('carries only escaped JSON5 lines; comments, CRLF and Unicode separators preserve context', () => {
    for (const ending of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
      const code = `{"continued": "start\\${ending}finish", "after": 2}`
      expect(classAt('json5', code, 'finish')).toBe('tok-string')
      expect(classAt('json5', code, '"after"')).toBe('tok-propertyName')
      expect(classAt('jsonc', code, 'finish')).not.toBe('tok-string')
    }
    for (const language of ['jsonc', 'json5']) {
      const broken = '{"v": "no continuation\n// real comment\n, "after": 3}'
      expect(classAt(language, broken, '// real comment')).toBe('tok-comment')
      expect(classAt(language, broken, '"after"')).toBe('tok-propertyName')
      const comments = '{ /* open\n\ncontinued */ "key" // before colon\n: "value",}'
      expect(classAt(language, comments, 'continued */')).toBe('tok-comment')
      expect(classAt(language, comments, '"key"')).toBe('tok-propertyName')
      expect(classAt(language, comments, '"value"')).toBe('tok-string')
    }
    const separator = '{key: 1, // note\u2028after: 2}'
    expect(classAt('json5', separator, '// note')).toBe('tok-comment')
    expect(classAt('json5', separator, 'after')).toBe('tok-propertyName')
    const blank = "{key: 'start\\\n\n// comment after broken continuation\n}"
    expect(classAt('json5', blank, '// comment after broken continuation')).toBe('tok-comment')
  })

  it('terminates on unclosed input, deep contexts and long hostile-looking text without executing it', () => {
    const samples = ['/', '/* unclosed', '{"v": "unclosed', "{v: 'continued\\", '}'.repeat(5000), '['.repeat(3000) + '0' + ']'.repeat(3000), `{"html": "<script>globalThis.bad = true</script>${'x'.repeat(8000)}"}`]
    for (const language of ['jsonc', 'json5']) {
      for (const code of samples) {
        const ranges = highlightCodeRanges(language, code)
        for (const range of ranges) {
          expect(range.from).toBeLessThan(range.to)
          expect(range.from).toBeGreaterThanOrEqual(0)
          expect(range.to).toBeLessThanOrEqual(code.length)
        }
      }
    }
  })
})
