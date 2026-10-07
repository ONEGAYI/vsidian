import { describe, expect, it } from 'vitest'
import { highlightCodeRanges } from '../../src/webview/codeHighlight'

function classesAt(id: string, code: string, word: string): string[] {
  const from = code.indexOf(word)
  expect(from).toBeGreaterThanOrEqual(0)
  return highlightCodeRanges(id, code).filter((r) => r.from <= from && r.to >= from + word.length).flatMap((r) => r.cls.split(' '))
}

describe('SPICE lexical boundaries (#390)', () => {
  it('keeps control variables, netlist comments and quoted paths distinct', () => {
    const code = '.CONTROL\nwrite $inputdir/out.raw v(out)\nlet x = $&gain * 2\n.endc\nR2 in out 10k $ resistor\n.include "models;//$.lib"\n; semicolon\n// double slash'
    for (const variable of ['$inputdir', '$&gain']) expect(classesAt('spice', code, variable)).toContain('tok-variableName')
    for (const comment of ['$ resistor', '; semicolon', '// double slash']) expect(classesAt('spice', code, comment)).toContain('tok-comment')
    expect(classesAt('spice', code, '"models;//$.lib"')).toContain('tok-string')
    expect(classesAt('spice', code, '* 2')).not.toContain('tok-comment')
  })
  it('does not assume a fenced first line is a title and recovers an unterminated quote', () => {
    const code = 'R1 in out 10k\n.param x="unfinished\nC1 out 0 1u\n.model NM NMOS (VTO=.7)\n.subckt amp in out\n.ends amp'
    for (const word of ['R1', 'C1']) expect(classesAt('spice', code, word)).toContain('tok-definition')
    for (const word of ['.model', '.subckt', '.ends']) expect(classesAt('spice', code, word)).toContain('tok-keyword')
    expect(classesAt('spice', code, '.7')).toContain('tok-number')
  })
})


describe('GNU Makefile lexical boundaries (#390)', () => {
  it('does not turn assignment semicolons into recipes or suppress make comments', () => {
    const code = 'CMD = echo one; echo "a# make comment"\nall: main.o; @echo "# recipe string" # recipe comment\nall: MODE = one; two "b# target variable comment"'
    expect(classesAt('makefile', code, '# make comment"')).toContain('tok-comment')
    expect(classesAt('makefile', code, '# target variable comment"')).toContain('tok-comment')
    expect(classesAt('makefile', code, '# recipe string')).toContain('tok-string')
    expect(classesAt('makefile', code, '# recipe comment')).toContain('tok-comment')
  })

  it('distinguishes all common assignment forms from rules, and directive names used as values', () => {
    const code = ['A = one', 'B := two', 'C ::= three', 'D :::= four', 'E ?= five', 'F += six', 'G != command', 'FLAGS = include', 'override export MODE := release'].join('\n')
    for (const name of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'FLAGS', 'MODE']) {
      expect(classesAt('makefile', code, name), name).toContain('tok-variableName')
      expect(classesAt('makefile', code, name)).not.toContain('tok-definition')
    }
    expect(classesAt('makefile', code, 'include')).not.toContain('tok-keyword')
    for (const word of ['override', 'export']) expect(classesAt('makefile', code, word)).toContain('tok-keyword')
  })

  it('keeps hash inside references, escaped hashes and recipe quotes out of comments', () => {
    const code = 'HASH = \\#value # make comment\nNESTED = ${outer$(inner#name)}\nall:\n\t@echo "# quoted" plain#word # shell comment\n\tprintf \'%s\' $$HOME'
    expect(classesAt('makefile', code, '#value')).not.toContain('tok-comment')
    expect(classesAt('makefile', code, '# make comment')).toContain('tok-comment')
    expect(classesAt('makefile', code, '${outer$(inner#name)}')).toContain('tok-variableName')
    expect(classesAt('makefile', code, '# quoted')).toContain('tok-string')
    expect(classesAt('makefile', code, '#word')).not.toContain('tok-comment')
    expect(classesAt('makefile', code, '# shell comment')).toContain('tok-comment')
    expect(classesAt('makefile', code, '$$')).toContain('tok-variableName')
  })
  it('continues escaped make comments and nested references across lines', () => {
    const code = '# comment \\\ncontinued\nVALUE = $(call outer,\\\n ${INNER#literal})\ninclude config.mk\nall: ; @echo "# inline recipe" # shell'
    expect(classesAt('makefile', code, 'continued')).toContain('tok-comment')
    expect(classesAt('makefile', code, '${INNER#literal})')).toContain('tok-variableName')
    expect(classesAt('makefile', code, 'include')).toContain('tok-keyword')
    expect(classesAt('makefile', code, '# inline recipe')).toContain('tok-string')
    expect(classesAt('makefile', code, '# shell')).toContain('tok-comment')
  })
})


describe('GraphQL lexical boundaries (#390)', () => {
  it('handles escaped triple quotes and comment delimiters in block descriptions', () => {
    const code = '"""description\n# string, not comment\nembedded \\""" triple\nstill text\n"""\ntype Chip { voltage: Float }\n# real comment'
    for (const word of ['# string, not comment', 'still text']) expect(classesAt('graphql', code, word)).toContain('tok-string')
    expect(classesAt('graphql', code, 'type')).toContain('tok-keyword')
    expect(classesAt('graphql', code, '# real comment')).toContain('tok-comment')
  })
  it('covers operations, SDL, escaped strings and signed exponent numbers', () => {
    const code = 'mutation Set { set(value: -1.2e+3, name: "a \\"quote\\" # text") }\nsubscription Changed { chip { id } }\ninterface Node { id: ID! }\nenum Status { READY }\nunion Result = Chip | Error\nextend type Chip { active: Boolean }\ndirective @auth on FIELD_DEFINITION\nschema { query: Query }'
    for (const word of ['mutation', 'subscription', 'interface', 'enum', 'union', 'extend', 'directive', 'schema']) expect(classesAt('graphql', code, word)).toContain('tok-keyword')
    expect(classesAt('graphql', code, '-1.2e+3')).toContain('tok-number')
    expect(classesAt('graphql', code, '# text')).toContain('tok-string')
  })
  it('recovers ordinary unterminated strings at newline, but retains unfinished block strings', () => {
    expect(classesAt('graphql', '"unfinished\nquery Next { id }', 'query')).toContain('tok-keyword')
    expect(classesAt('graphql', '"""unfinished\n# inside', '# inside')).toContain('tok-string')
  })
})


describe('PHP tagged/plain selection (#390)', () => {
  it('parses tagged PHP, short echo and mixed HTML with the template parser', () => {
    const code = '<section class="chip"><?php $name = "chip"; echo $name; ?><b><?= $name ?></b></section>'
    expect(classesAt('php', code, 'section')).toContain('tok-typeName')
    expect(classesAt('php', code, 'class')).toContain('tok-propertyName')
    expect(classesAt('php', code, '$name')).toContain('tok-variableName')
    expect(classesAt('php', code, 'echo')).toContain('tok-keyword')
    expect(classesAt('php', '<?php echo 2; ?>', 'echo')).toContain('tok-keyword')
    expect(classesAt('php', '<?= $name ?>', '$name')).toContain('tok-variableName')
    expect(classesAt('php', '<a href="<?= $url ?>">link</a>', '$url')).toContain('tok-variableName')
  })
  it('does not mistake PHP-open text in plain strings/comments for a template', () => {
    const code = '$tag = "<?php"; /* <?= */\necho $tag; # plain comment'
    expect(classesAt('php', code, '<?php')).toContain('tok-string')
    expect(classesAt('php', code, '<?=')).toContain('tok-comment')
    expect(classesAt('php', code, 'echo')).toContain('tok-keyword')
    expect(classesAt('php', code, '# plain comment')).toContain('tok-comment')
  })
  it('keeps heredoc and multiline comments lexical without evaluating code', () => {
    const code = '$text = <<<LABEL\n# text\nLABEL;\nfunction run() { return 1; }\n/* multiline\n<?php $x */'
    expect(classesAt('php', code, '# text')).toContain('tok-string')
    expect(classesAt('php', code, 'function')).toContain('tok-keyword')
    expect(classesAt('php', code, '<?php')).toContain('tok-comment')
  })
})


describe('special-language bounded malformed input (#390)', () => {
  it.each(['spice', 'makefile', 'graphql', 'php'])('%s preserves valid token ranges and terminates on hostile-looking text', (id) => {
    const code = '"unterminated\n/* broken\n$(${$(nested#\n"""\n<?php\n<script>globalThis.evaluated = true</script>\n' + 'x'.repeat(20000)
    const ranges = highlightCodeRanges(id, code)
    let previousEnd = 0
    for (const range of ranges) {
      expect(range.from).toBeGreaterThanOrEqual(previousEnd)
      expect(range.to).toBeGreaterThan(range.from)
      expect(range.to).toBeLessThanOrEqual(code.length)
      previousEnd = range.to
    }
    expect(highlightCodeRanges(id, code)).toEqual(ranges)
  })
})

describe('malformed numeric atom cost (#390)', () => {
  it.each(['spice', 'graphql'])('%s consumes a long invalid numeric atom without rescanning every digit', (id) => {
    const code = '1'.repeat(32000) + '_'
    const started = performance.now()
    const ranges = highlightCodeRanges(id, code)
    const elapsed = performance.now() - started
    expect(ranges.some((range) => range.cls.split(' ').includes('tok-number'))).toBe(false)
    // Generous main-thread ceiling, not a language-wide timing benchmark. The
    // former suffix-by-suffix rejection takes seconds for this single line.
    expect(elapsed).toBeLessThan(1000)
  }, 10000)
})

describe('PHP prose before real tags (#390)', () => {
  it.each(["I'm here <?php echo 42; ?>", "I'm here <?php echo 42; ?> it's great"])(
    'does not let error-recovered prose quotes conceal PHP tokens: %s', (code) => {
      expect(classesAt('php', code, 'echo')).toContain('tok-keyword')
      expect(classesAt('php', code, '42')).toContain('tok-number')
    },
  )
})

describe('PHP literal opener scan cost (#390)', () => {
  it('checks a protected literal once even when it contains many opener examples', () => {
    const code = '$text = "' + '<?php '.repeat(64000) + '"; echo $text;'
    const started = performance.now()
    const ranges = highlightCodeRanges('php', code)
    const elapsed = performance.now() - started
    const opener = code.indexOf('<?php')
    expect(ranges.some((range) => range.from <= opener && range.to >= code.lastIndexOf('<?php') + 5 && range.cls === 'tok-string')).toBe(true)
    expect(ranges.some((range) => code.slice(range.from, range.to) === 'echo' && range.cls === 'tok-keyword')).toBe(true)
    expect(elapsed).toBeLessThan(1000)
  }, 10000)
})
