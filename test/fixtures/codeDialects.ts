// Independent SQL/JSON examples for #391, shared by public rendering seams.
import type { ReadyCodeLanguageFixture } from './readyCodeLanguages'

export const DIALECT_CODE_FIXTURES: ReadyCodeLanguageFixture[] = [
  {
    id: 'postgresql', label: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'pgsql'], extensions: ['pgsql'], badge: 'PG',
    code: 'SELECT $tag$quoted -- text$tag$, "Field"::jsonb;',
    tokens: [['SELECT', 'tok-keyword'], ['$tag$quoted -- text$tag$', 'tok-string'], ['"Field"', 'tok-string2']],
  },
  {
    id: 'mysql', label: 'MySQL', aliases: ['mysql'], extensions: [], badge: 'My',
    code: 'SELECT `odd name`; # database note',
    tokens: [['SELECT', 'tok-keyword'], ['`odd name`', 'tok-string2'], ['# database note', 'tok-comment']],
  },
  {
    id: 'sqlite', label: 'SQLite', aliases: ['sqlite'], extensions: [], badge: 'Lite',
    code: 'SELECT [odd name] FROM records;',
    tokens: [['SELECT', 'tok-keyword'], ['[odd name]', 'tok-string2'], ['FROM', 'tok-keyword']],
  },
  {
    id: 'jsonc', label: 'JSONC', aliases: ['jsonc'], extensions: ['jsonc'], badge: '{c}',
    code: '{"key" /* note */: [true, "value",],}',
    tokens: [['"key"', 'tok-propertyName'], ['/* note */', 'tok-comment'], ['true', 'tok-bool'], ['"value"', 'tok-string']],
  },
  {
    id: 'json5', label: 'JSON5', aliases: ['json5'], extensions: ['json5'], badge: '{5}',
    code: "{unquoted: 'value', hex: -0XCAFE, fraction: +.5, inf: Infinity,}",
    tokens: [['unquoted', 'tok-propertyName'], ["'value'", 'tok-string'], ['-0XCAFE', 'tok-number'], ['+.5', 'tok-number'], ['Infinity', 'tok-number']],
  },
]
