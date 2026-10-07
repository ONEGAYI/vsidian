// Independent lexical expectations for the four #390 language sources.
import type { ReadyCodeLanguageFixture } from './readyCodeLanguages'

export const SPECIAL_CODE_LANGUAGE_FIXTURES: ReadyCodeLanguageFixture[] = [
  {
    id: 'spice', label: 'SPICE', aliases: ['spice', 'sp', 'ngspice', 'hspice'], extensions: ['spice', 'sp', 'cir'], badge: 'SP',
    code: '* RC filter\n.param gain=2\nR1 in out 1Meg\nC1 out 0 10p\n+ tc=1e-3\nB1 out 0 V=\'gain*2\' $ tail',
    tokens: [['* RC filter', 'tok-comment'], ['.param', 'tok-keyword'], ['R1', 'tok-definition'], ['1Meg', 'tok-number'], ['10p', 'tok-number'], ['1e-3', 'tok-number'], ["'gain*2'", 'tok-string'], ['$ tail', 'tok-comment']],
  },
  {
    id: 'makefile', label: 'Makefile', aliases: ['makefile', 'make', 'mk'], extensions: ['mk', 'mak'], badge: 'MK',
    code: 'CC := cc\nOBJ = $(patsubst %.c,%.o,$(SRC))\n.PHONY: all\nifeq ($(MODE),debug)\nall: $(OBJ)\n\t$(CC) -o $@ $^ # recipe\nendif\n# make',
    tokens: [['CC', 'tok-variableName'], ['$(patsubst %.c,%.o,$(SRC))', 'tok-variableName'], ['.PHONY', 'tok-definition'], ['ifeq', 'tok-keyword'], ['$(CC)', 'tok-variableName'], ['$@', 'tok-variableName'], ['$^', 'tok-variableName'], ['# recipe', 'tok-comment'], ['# make', 'tok-comment']],
  },
  {
    id: 'graphql', label: 'GraphQL', aliases: ['graphql', 'gql'], extensions: ['graphql', 'gql'], badge: 'GQL',
    code: 'query GetChip($id: ID!) { chip(id: $id) @include(if: true) { ...ChipFields } }\nfragment ChipFields on Chip { name }\ntype Chip { name: String! size: Int }\ninput ChipInput { name: String }\n# schema',
    tokens: [['query', 'tok-keyword'], ['$id', 'tok-variableName'], ['@include', 'tok-meta'], ['true', 'tok-atom'], ['fragment', 'tok-keyword'], ['type', 'tok-keyword'], ['input', 'tok-keyword'], ['String', 'tok-typeName'], ['# schema', 'tok-comment']],
  },
  {
    id: 'php', label: 'PHP', aliases: ['php'], extensions: ['php', 'phtml'], badge: 'PHP',
    code: '$name = "chip"; $size = 4; echo $name; // plain',
    tokens: [['$name', 'tok-variableName'], ['"chip"', 'tok-string'], ['4', 'tok-number'], ['echo', 'tok-keyword'], ['// plain', 'tok-comment']],
  },
]

// Full contexts intentionally span the reading renderer's 60-line mount limit.
export const SPECIAL_CONTEXT_FIXTURES = [
  { id: 'spice', first: '.control', body: (i: number) => `write $inputdir/trace${i}.raw`, last: '.endc\nR9 in out 10k $ tail', marker: '$inputdir/trace58.raw', cls: 'tok-variableName', word: '$inputdir' },
  { id: 'makefile', first: 'VALUE = $(call outer,\\', body: (i: number) => ` ${'${'}INNER${i}#literal}\\`, last: ' done)\nall:\n\t@echo "done"', marker: '${INNER58#literal}', cls: 'tok-variableName', word: '${INNER58#literal}' },
  { id: 'graphql', first: '"""opening', body: (i: number) => `description ${i} # literal`, last: '"""\ntype Chip { id: ID! }', marker: 'description 58 # literal', cls: 'tok-string', word: 'description 58 # literal' },
  { id: 'php', first: '<?php /* opening', body: (i: number) => `php comment ${i}`, last: '*/ echo "done"; ?>', marker: 'php comment 58', cls: 'tok-comment', word: 'php comment 58' },
]
