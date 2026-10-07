// 阅读视图代码块卡片契约测试（工单 #84）：朴素 pre/code 增强为卡片
// （头部徽标+标签+折叠+复制）、卡内行号、tok-* 着色、形态矩阵（卡片/
// 高亮独立开关）、折叠收起、复制回调、幂等重装饰与源码保真。
// #191：折行开关（仅阅读侧头部按钮，[折行] [复制] [折叠]）与行内联
// --vsidian-code-indent 注入（悬挂缩进的列宽基准，与行号列宽同源）。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

// 文案经 t() 取词：装配生产中文包，断言与字典同源（与 liveCodeCard.test 同模式）
installLocale('zh-cn', zhCn)
import {
  READING_CODE_CARD_CLASS,
  READING_CODE_CARD_FOLDED_CLASS,
  READING_CODE_LINE_CLASS,
  decorateReadingCodeCard,
  isReadingCodeBlock,
} from '../../src/webview/readingCodeCard'
import { CODE_CARD_CLASS_NAMES } from '../../src/webview/liveCodeCard'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { mountRefContentBlock } from '../../src/webview/refReadingContent'
import { getHighlightStats } from '../../src/webview/codeHighlight'
import { READY_CODE_LANGUAGE_FIXTURES } from '../fixtures/readyCodeLanguages'
import { DIALECT_CODE_FIXTURES } from '../fixtures/codeDialects'
import { SPECIAL_CODE_LANGUAGE_FIXTURES, SPECIAL_CONTEXT_FIXTURES } from '../fixtures/specialCodeLanguages'

const CODE = 'const a = 1;\nfunction hi() {'

function makeBlock(
  info = 'js',
  code = CODE,
  chunk?: { start: number; total: number },
): HTMLElement {
  const block = document.createElement('div')
  block.className = 'vsidian-reading-block vsidian-reading-code-block'
  block.dataset['vsidianSrcStart'] = '0'
  const pre = document.createElement('pre')
  if (chunk) {
    // 大围栏分块（FENCE_CHUNK_LINES）片的跨片行号契约（readingBlocks 落位）
    pre.setAttribute('data-vsidian-code-start', String(chunk.start))
    pre.setAttribute('data-vsidian-code-total', String(chunk.total))
  }
  const codeEl = document.createElement('code')
  codeEl.className = info ? `language-${info}` : ''
  codeEl.textContent = code
  pre.appendChild(codeEl)
  block.appendChild(pre)
  return block
}

function decorate(block: HTMLElement, over: Partial<Parameters<typeof decorateReadingCodeCard>[1]> = {}) {
  decorateReadingCodeCard(block, {
    config: { card: true, lineNumbers: true, copyButton: true, highlight: true },
    folded: false,
    onCopy: () => {},
    onFoldToggle: () => {},
    ...over,
  })
}

describe('阅读代码块卡片（#84）', () => {
  it('卡片 + 高亮：头部（徽标/标签/折叠/复制）、行结构与行号、tok 着色齐备', () => {
    const block = makeBlock('js')
    decorate(block)
    expect(block.classList.contains(READING_CODE_CARD_CLASS)).toBe(true)
    const header = block.querySelector(`:scope > .${CODE_CARD_CLASS_NAMES.header}`)!
    expect(header).not.toBeNull()
    const label = header.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)!
    expect(label.querySelector(`.${CODE_CARD_CLASS_NAMES.headerIcon}`)?.textContent).toBe('JS')
    expect(label.textContent).toContain('JavaScript')
    expect(header.querySelector(`.${CODE_CARD_CLASS_NAMES.fold}`)).not.toBeNull()
    expect(header.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`)).not.toBeNull()
    const rows = block.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)
    expect(rows).toHaveLength(2)
    const numbers = block.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)
    expect([...numbers].map((n) => n.textContent)).toEqual(['1', '2'])
    expect(block.querySelectorAll('[class*="tok-"]').length).toBeGreaterThan(0)
    expect(block.querySelector('code')!.getAttribute('data-vsidian-code-src')).toBe(CODE)
  })

  it('行文本拼合与源码逐字节一致（token 化不改内容）', () => {
    const block = makeBlock('js')
    decorate(block)
    const rows = [...block.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)]
    const text = rows.map((r) => {
      const spans = [...r.children].filter((c) => !c.classList.contains(CODE_CARD_CLASS_NAMES.linenumber))
      return spans.map((s) => s.textContent).join('')
    }).join('\n')
    expect(text).toBe(CODE)
  })

  it('朴素形态（仅高亮）：无卡片结构，code 内直接注入 token span', () => {
    const block = makeBlock('js')
    decorate(block, { config: { card: false, lineNumbers: false, copyButton: false, highlight: true } })
    expect(block.querySelector(`.${CODE_CARD_CLASS_NAMES.header}`)).toBeNull()
    expect(block.classList.contains(READING_CODE_CARD_CLASS)).toBe(false)
    const codeEl = block.querySelector('code')!
    expect(codeEl.textContent).toBe(CODE)
    expect(codeEl.querySelectorAll('[class*="tok-"]').length).toBeGreaterThan(0)
  })

  it('两者皆关：不触碰（朴素 markdown-it 产物）', () => {
    const block = makeBlock('js')
    decorate(block, { config: { card: false, lineNumbers: false, copyButton: false, highlight: false } })
    expect(block.querySelector('code')!.textContent).toBe(CODE)
    expect(block.querySelector(`.${CODE_CARD_CLASS_NAMES.header}`)).toBeNull()
    expect(block.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
  })

  it('行号子开关关闭：行结构保留但无行号', () => {
    const block = makeBlock('js')
    decorate(block, { config: { card: true, lineNumbers: false, copyButton: true, highlight: true } })
    expect(block.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)).toHaveLength(2)
    expect(block.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)).toHaveLength(0)
  })

  it('折叠：块级收起类 + chevron 转向；展开无类', () => {
    const folded = makeBlock('js')
    decorate(folded, { folded: true })
    expect(folded.classList.contains(READING_CODE_CARD_FOLDED_CLASS)).toBe(true)
    expect(folded.querySelector(`.${CODE_CARD_CLASS_NAMES.fold}`)!.classList.contains(CODE_CARD_CLASS_NAMES.foldCollapsed)).toBe(true)
    const expanded = makeBlock('js')
    decorate(expanded, { folded: false })
    expect(expanded.classList.contains(READING_CODE_CARD_FOLDED_CLASS)).toBe(false)
  })

  it('折叠收起态头部无复制按钮、展开态有（与 Live 的收起态不发射口径一致）', () => {
    const folded = makeBlock('js')
    decorate(folded, { folded: true })
    expect(folded.querySelector(`.${CODE_CARD_CLASS_NAMES.fold}`)).not.toBeNull()
    expect(folded.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`)).toBeNull()
    const expanded = makeBlock('js')
    decorate(expanded, { folded: false })
    expect(expanded.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`)).not.toBeNull()
  })

  it('复制与折叠回调：点击按钮携带代码体/触发切换', () => {
    const block = makeBlock('js')
    let copied = ''
    let toggles = 0
    decorate(block, { onCopy: (code) => { copied = code }, onFoldToggle: () => { toggles += 1 } })
    ;(block.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`) as HTMLButtonElement).click()
    expect(copied).toBe(CODE)
    ;(block.querySelector(`.${CODE_CARD_CLASS_NAMES.fold}`) as HTMLButtonElement).click()
    expect(toggles).toBe(1)
  })

  it('幂等重装饰：结构重建不重复、源码取自首捕快照', () => {
    const block = makeBlock('js')
    decorate(block)
    decorate(block)
    expect(block.querySelectorAll(`:scope > .${CODE_CARD_CLASS_NAMES.header}`)).toHaveLength(1)
    expect(block.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)).toHaveLength(2)
    expect(block.querySelector('code')!.getAttribute('data-vsidian-code-src')).toBe(CODE)
  })

  it('语言映射：text → Plain text；未知语言回退原文且不着色', () => {
    const plain = makeBlock('text', 'hello')
    decorate(plain)
    expect(plain.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)!.textContent).toContain('Plain text')
    expect(plain.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
    const zzz = makeBlock('zzz', 'x')
    decorate(zzz)
    expect(zzz.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)!.textContent).toContain('zzz')
    expect(zzz.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
  })

  it('isReadingCodeBlock：代码块命中，mermaid 块与其他不命中', () => {
    expect(isReadingCodeBlock(makeBlock('js'))).toBe(true)
    const mermaid = document.createElement('div')
    mermaid.className = 'vsidian-reading-block vsidian-reading-mermaid'
    expect(isReadingCodeBlock(mermaid)).toBe(false)
    const para = document.createElement('div')
    para.className = 'vsidian-reading-block vsidian-reading-paragraph'
    expect(isReadingCodeBlock(para)).toBe(false)
  })

  it('大围栏分块行号连续：片携带 start/total → 行号 1..60 与 61..120、列宽一致按整块 3 位', () => {
    // 模拟 readingBlocks 60 行分块产物：120 行围栏切成两片，各 60 内容行
    const lines60 = Array.from({ length: 60 }, (_, i) => `line-${i}`).join('\n')
    const first = makeBlock('js', lines60, { start: 0, total: 120 })
    const second = makeBlock('js', lines60, { start: 60, total: 120 })
    decorate(first)
    decorate(second)
    const numsOf = (b: HTMLElement) =>
      [...b.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)].map((n) => n.textContent)
    expect(numsOf(first)).toEqual(Array.from({ length: 60 }, (_, i) => String(i + 1)))
    expect(numsOf(second)).toEqual(Array.from({ length: 60 }, (_, i) => String(61 + i)))
    // 两片列宽一致：按整块 total（120 → 3 位）而非片行数（60 → 2 位）
    const widths = [...first.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`), ...second.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)]
      .map((n) => (n as HTMLElement).style.width)
    expect(new Set(widths)).toEqual(new Set(['3ch']))
  })

  it('无分块 data 属性时回退现行为：每片独立从 1 编号、列宽按片行数（幂等兼容旧 DOM）', () => {
    const block = makeBlock('js', 'a\nb\nc')
    decorate(block)
    const nums = [...block.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)]
    expect(nums.map((n) => n.textContent)).toEqual(['1', '2', '3'])
    expect((nums[0] as HTMLElement).style.width).toBe('2ch')
  })

  it('c++ 片块类提取后命中 cpp（类名正则可提取 + 注册表别名路由一致）', () => {
    const block = makeBlock('c++', 'int main() {}')
    decorate(block)
    expect(block.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)!.textContent).toContain('C++')
  })
})

describe('按钮区顺序与整条折叠热区（#190）', () => {
  it('按钮区顺序 [复制] [折叠]：折叠钮固定最右（与 Live 同步换位）', () => {
    const block = makeBlock('js')
    decorate(block)
    const actions = block.querySelector(`.${CODE_CARD_CLASS_NAMES.headerActions}`)!
    const kids = [...actions.children]
    expect(kids[0]!.classList.contains(CODE_CARD_CLASS_NAMES.copy)).toBe(true)
    expect(kids[kids.length - 1]!.classList.contains(CODE_CARD_CLASS_NAMES.fold)).toBe(true)
    expect(kids).toHaveLength(2)
  })

  it('收起态仅渲染折叠钮且仍在最右', () => {
    const block = makeBlock('js')
    decorate(block, { folded: true })
    const actions = block.querySelector(`.${CODE_CARD_CLASS_NAMES.headerActions}`)!
    expect(actions.children).toHaveLength(1)
    expect(actions.children[0]!.classList.contains(CODE_CARD_CLASS_NAMES.fold)).toBe(true)
  })

  it('热区：点击 header 根与语言标签区触发 onFoldToggle 恰一次', () => {
    const block = makeBlock('js')
    let toggles = 0
    decorate(block, { onFoldToggle: () => { toggles += 1 } })
    const header = block.querySelector(`:scope > .${CODE_CARD_CLASS_NAMES.header}`)!
    header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    header.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(toggles).toBe(2)
  })

  it('点击复制/折叠按钮不触发热区（onFoldToggle 仅按钮自身各一次）', () => {
    const block = makeBlock('js')
    let toggles = 0
    let copied = ''
    decorate(block, { onFoldToggle: () => { toggles += 1 }, onCopy: (code) => { copied = code } })
    ;(block.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`) as HTMLButtonElement).click()
    expect(copied).toBe(CODE)
    expect(toggles).toBe(0)
    ;(block.querySelector(`.${CODE_CARD_CLASS_NAMES.fold}`) as HTMLButtonElement).click()
    expect(toggles).toBe(1)
  })
})

describe('折行开关与窜行修复（#191）', () => {
  it('按钮区顺序 [折行] [复制] [折叠]：折行钮插在复制钮左侧、折叠钮仍最右（提供 onWrapToggle 时）', () => {
    const block = makeBlock('js')
    decorate(block, { onWrapToggle: () => {} })
    const actions = block.querySelector(`.${CODE_CARD_CLASS_NAMES.headerActions}`)!
    const kids = [...actions.children]
    expect(kids).toHaveLength(3)
    expect(kids[0]!.classList.contains(CODE_CARD_CLASS_NAMES.wrap)).toBe(true)
    expect(kids[1]!.classList.contains(CODE_CARD_CLASS_NAMES.copy)).toBe(true)
    expect(kids[2]!.classList.contains(CODE_CARD_CLASS_NAMES.fold)).toBe(true)
  })

  it('收起态仅渲染折叠钮（折行钮与复制钮同口径不发射）', () => {
    const block = makeBlock('js')
    decorate(block, { folded: true, onWrapToggle: () => {} })
    const actions = block.querySelector(`.${CODE_CARD_CLASS_NAMES.headerActions}`)!
    expect(actions.children).toHaveLength(1)
    expect(actions.children[0]!.classList.contains(CODE_CARD_CLASS_NAMES.fold)).toBe(true)
    expect(block.querySelector(`.${CODE_CARD_CLASS_NAMES.wrap}`)).toBeNull()
  })

  it('折行钮回调：点击触发 onWrapToggle 恰一次且不触发热区折叠', () => {
    const block = makeBlock('js')
    let wraps = 0
    let folds = 0
    decorate(block, { onWrapToggle: () => { wraps += 1 }, onFoldToggle: () => { folds += 1 } })
    ;(block.querySelector(`.${CODE_CARD_CLASS_NAMES.wrap}`) as HTMLButtonElement).click()
    expect(wraps).toBe(1)
    expect(folds).toBe(0)
  })

  it('折行态修饰与文案：wrap=true 无 -off 类、title/aria-label 取将触发的动作（关闭自动折行）、aria-pressed=true；wrap=false 带类与开启文案', () => {
    const on = makeBlock('js')
    decorate(on, { onWrapToggle: () => {} })
    const onBtn = on.querySelector(`.${CODE_CARD_CLASS_NAMES.wrap}`)!
    expect(onBtn.classList.contains(CODE_CARD_CLASS_NAMES.wrapOff)).toBe(false)
    expect(onBtn.getAttribute('aria-label')).toBe(zhCn['codeblock.wrapDisable'])
    expect(onBtn.getAttribute('data-tooltip')).toBe(zhCn['codeblock.wrapDisable'])
    expect(onBtn.getAttribute('aria-pressed')).toBe('true')

    const off = makeBlock('js')
    decorate(off, { wrap: false, onWrapToggle: () => {} })
    const offBtn = off.querySelector(`.${CODE_CARD_CLASS_NAMES.wrap}`)!
    expect(offBtn.classList.contains(CODE_CARD_CLASS_NAMES.wrapOff)).toBe(true)
    expect(offBtn.getAttribute('aria-label')).toBe(zhCn['codeblock.wrapEnable'])
    expect(offBtn.getAttribute('data-tooltip')).toBe(zhCn['codeblock.wrapEnable'])
    expect(offBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('行内联 --vsidian-code-indent 与行号列宽同源：值 = calc(列宽ch + 24px)；行号关闭不注入（回落 CSS 缺省）', () => {
    const block = makeBlock('js')
    decorate(block)
    const rows = [...block.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)] as HTMLElement[]
    expect(rows).toHaveLength(2)
    // 2 行块 → 列宽 2ch → 缩进 calc(2ch + 24px)（与 ln.style.width 同处同源）
    expect(rows[0]!.style.getPropertyValue('--vsidian-code-indent')).toBe('calc(2ch + 24px)')
    expect(rows[1]!.style.getPropertyValue('--vsidian-code-indent')).toBe('calc(2ch + 24px)')

    const noLn = makeBlock('js')
    decorate(noLn, { config: { card: true, lineNumbers: false, copyButton: true, highlight: true } })
    const noLnRows = [...noLn.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)] as HTMLElement[]
    expect(noLnRows[0]!.style.getPropertyValue('--vsidian-code-indent')).toBe('')
  })

  it('朴素形态无折行钮（无头部可挂）', () => {
    const block = makeBlock('js')
    decorate(block, { config: { card: false, lineNumbers: false, copyButton: false, highlight: true }, onWrapToggle: () => {} })
    expect(block.querySelector(`.${CODE_CARD_CLASS_NAMES.wrap}`)).toBeNull()
  })
})

describe('complete-fence highlighting across reading chunks (#389)', () => {
  it('mounts a later chunk first with the same multiline-comment context, then remounts it', () => {
    const source = ['```js', '/* opening', ...Array.from({ length: 75 }, (_, i) => `comment ${i}`), '*/ const done = 1', '```'].join('\n')
    const blocks = splitReadingBlocks(source)
    expect(blocks).toHaveLength(2)
    for (let mount = 0; mount < 2; mount++) {
      const el = createReadingBlockElement(blocks[1]!, source)
      decorate(el)
      expect(el.querySelector('.tok-comment')?.textContent).toBe('comment 58')
      expect([...el.querySelectorAll('.tok-keyword')].map((n) => n.textContent)).toContain('const')
      expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.linenumber}`)?.textContent).toBe('60')
    }
  })
})


describe('complete-fence guards and reference reuse (#389)', () => {
  const mountReference = (el: HTMLElement) => mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null })

  it.each([4096, 4097])('%i full code lines use the same guard in reading and Markdown hover/embed', (count) => {
    const source = ['```js', ...Array.from({ length: count }, (_, i) => `const guard${count}_${i} = ${i}`), '```'].join('\n')
    const blocks = splitReadingBlocks(source)
    const before = getHighlightStats().parserCalls
    // Later-first and out-of-order mounting must not assume earlier chunks ran.
    for (const index of [blocks.length - 1, 1, 0]) {
      for (const mount of [decorate, mountReference]) {
        const el = createReadingBlockElement(blocks[index]!, source)
        mount(el)
        expect(el.querySelectorAll('.tok-keyword').length > 0).toBe(count === 4096)
      }
    }
    expect(getHighlightStats().parserCalls - before).toBe(count === 4096 ? 1 : 0)
  })

  it.each(['tcl', 'toml'])('%s multiline strings survive later-first reference mounts and edited refreshes', (language) => {
    const first = language === 'tcl' ? 'puts "opening' : 'name = """opening'
    const last = language === 'tcl' ? 'closing"' : 'closing"""'
    const code = [first, ...Array.from({ length: 75 }, (_, i) => `quoted ${i}`), last].join('\n')
    const source = `\`\`\`${language}\n${code}\n\`\`\``
    const blocks = splitReadingBlocks(source)
    const el = createReadingBlockElement(blocks[1]!, source)
    mountReference(el)
    expect(el.querySelector('.tok-string')?.textContent).toBe('quoted 58')
    expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.header}`)).toBeNull()
    // A new document snapshot owns fresh context; stale lexical state cannot leak.
    const updated = source.replace(first, '# opening')
    const refreshed = createReadingBlockElement(splitReadingBlocks(updated)[1]!, updated)
    mountReference(refreshed)
    expect(refreshed.querySelector('.tok-string')?.textContent).not.toBe('quoted 58')
  })

  it('preserves per-chunk copy and raw text while settings are toggled', () => {
    const source = ['```js', '/* opening', ...Array.from({ length: 75 }, (_, i) => `chunk ${i}`), '*/', '```'].join('\n')
    const el = createReadingBlockElement(splitReadingBlocks(source)[1]!, source)
    const expected = el.querySelector('code')!.textContent!.replace(/\n$/, '')
    let copied = ''
    decorate(el, { onCopy: (code) => { copied = code } })
    ;(el.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`) as HTMLButtonElement).click()
    expect(copied).toBe(expected)
    decorate(el, { config: { card: false, highlight: false, lineNumbers: false, copyButton: false } })
    expect(el.querySelector('code')!.textContent).toBe(expected)
    expect(el.querySelector('[class*="tok-"]')).toBeNull()
    decorate(el, { config: { card: false, highlight: true, lineNumbers: false, copyButton: false } })
    expect(el.querySelector('code')!.textContent).toBe(expected)
    expect(el.querySelector('.tok-comment')?.textContent).toBe('chunk 58')
  })
})

describe('ready-language reading and reference content (#389)', () => {
  it.each([...READY_CODE_LANGUAGE_FIXTURES, ...DIALECT_CODE_FIXTURES, ...SPECIAL_CODE_LANGUAGE_FIXTURES])('$id keeps real tokens in reading and the shared Markdown hover/embed path', (fixture) => {
    const source = `\`\`\`${fixture.aliases.at(-1)!.toUpperCase()} title=sample\n${fixture.code}\n\`\`\``
    const block = splitReadingBlocks(source)[0]!
    const el = createReadingBlockElement(block, source)
    decorate(el)
    expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)?.textContent).toBe(fixture.badge + fixture.label)
    expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.headerIcon}`)?.textContent).toBe(fixture.badge)
    const ref = createReadingBlockElement(block, source)
    mountRefContentBlock(ref, { images: null, codeHighlight: true, fm: null })
    expect(ref.querySelector(`.${CODE_CARD_CLASS_NAMES.header}`)).toBeNull()
    for (const target of [el, ref]) {
      for (const [word, cls] of fixture.tokens) {
        expect([...target.querySelectorAll(`.${cls}`)].some((node) => node.textContent === word), `${fixture.id}: ${word}`).toBe(true)
      }
    }
    expect(ref.querySelector('code')!.textContent).toBe(fixture.code)
  })
})

describe('unclosed complete-fence budget at EOF (#389)', () => {
  it('counts trailing empty lines before rendering trim for both reading cards and Markdown references', () => {
    const source = ['```js', ...Array(4096).fill('const eofOverflow = 1'), '', ''].join('\n')
    const blocks = splitReadingBlocks(source)
    const before = getHighlightStats().parserCalls
    for (const mount of [
      decorate,
      (el: HTMLElement) => mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null }),
    ]) {
      const el = createReadingBlockElement(blocks[1]!, source)
      mount(el)
      expect(el.querySelectorAll('[class*="tok-"]')).toHaveLength(0)
      expect(el.querySelector('code')!.textContent).toContain('const eofOverflow = 1')
    }
    expect(getHighlightStats().parserCalls).toBe(before)
  })
})

describe('dialect complete-fence context (#391)', () => {
  const cases = [
    { language: 'jsonc', first: '{ /* opening', fill: '', last: '*/ "after": 2}', cls: 'tok-comment' },
    { language: 'json5', first: '{key: "opening\\', fill: '\\', last: 'closing", after: 2}', cls: 'tok-string' },
    { language: 'postgresql', first: 'SELECT $tag$opening', fill: '', last: 'closing$tag$; SELECT 2;', cls: 'tok-string' },
  ]
  it.each(cases)('$language retains multiline state on later-first and repeat reading/reference mounts', (sample) => {
    const code = [sample.first, ...Array.from({ length: 75 }, (_, i) => `dialect line ${i}${sample.fill}`), sample.last].join('\n')
    const source = `\`\`\`${sample.language}\n${code}\n\`\`\``
    const blocks = splitReadingBlocks(source)
    for (let mount = 0; mount < 2; mount++) {
      for (const reference of [false, true]) {
        const el = createReadingBlockElement(blocks[1]!, source)
        const expected = el.querySelector('code')!.textContent!.replace(/\n$/, '')
        let copied = ''
        if (reference) mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null })
        else decorate(el, { onCopy: (text) => { copied = text } })
        expect(el.querySelector(`.${sample.cls}`)?.textContent).toContain('dialect line 58')
        if (reference) expect(el.querySelector('code')!.textContent).toBe(expected)
        else {
          expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.linenumber}`)?.textContent).toBe('60')
          ;(el.querySelector(`.${CODE_CARD_CLASS_NAMES.copy}`) as HTMLButtonElement).click()
          expect(copied).toBe(expected)
        }
      }
    }
  })

  it.each(['jsonc', 'json5', 'postgresql'])('%s honors the complete 4096/4097 budget on later reading/reference chunks', (language) => {
    for (const count of [4096, 4097]) {
      const code = ['/* budget', ...Array.from({ length: count - 2 }, (_, i) => `dialect budget ${i}`), '*/'].join('\n')
      const source = `\`\`\`${language}\n${code}\n\`\`\``
      const block = splitReadingBlocks(source)[1]!
      const before = getHighlightStats().parserCalls
      for (const reference of [false, true]) {
        const el = createReadingBlockElement(block, source)
        if (reference) mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null })
        else decorate(el)
        expect(el.querySelectorAll('.tok-comment').length > 0).toBe(count === 4096)
        expect(el.textContent).toContain('dialect budget 58')
      }
      expect(getHighlightStats().parserCalls - before).toBe(count === 4096 ? 1 : 0)
    }
  })
})

describe('special-language complete contexts (#390)', () => {
  it.each(SPECIAL_CONTEXT_FIXTURES)('$id retains lexical state in later-first chunks and reference remounts', (fixture) => {
    const code = [fixture.first, ...Array.from({ length: 75 }, (_, i) => fixture.body(i)), fixture.last].join('\n')
    const source = `\`\`\`${fixture.id}\n${code}\n\`\`\``
    const block = splitReadingBlocks(source)[1]!
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const mount of [decorate, (el: HTMLElement) => mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null })]) {
        const el = createReadingBlockElement(block, source)
        const raw = el.querySelector('code')!.textContent!.replace(/\n$/, '')
        mount(el)
        expect([...el.querySelectorAll(`.${fixture.cls}`)].some((node) => node.textContent!.includes(fixture.word))).toBe(true)
        const lines = [...el.querySelectorAll(`.${READING_CODE_LINE_CLASS}`)]
        if (lines.length) {
          expect(lines.map((line) => {
            const copy = line.cloneNode(true) as HTMLElement
            copy.querySelector(`.${CODE_CARD_CLASS_NAMES.linenumber}`)?.remove()
            return copy.textContent
          }).join('\n')).toBe(raw)
          expect(el.querySelector(`.${CODE_CARD_CLASS_NAMES.linenumber}`)?.textContent).toBe('60')
        } else expect(el.querySelector('code')!.textContent).toBe(raw)
      }
    }
  })
  it.each(SPECIAL_CODE_LANGUAGE_FIXTURES)('$id respects the full-fence 4096/4097 limit in both reading paths', (fixture) => {
    const sample = fixture.code.split('\n')[0]!
    for (const count of [4096, 4097]) {
      const source = ['```' + fixture.id, ...Array(count).fill(sample), '```'].join('\n')
      const block = splitReadingBlocks(source)[1]!
      for (const mount of [decorate, (el: HTMLElement) => mountRefContentBlock(el, { images: null, codeHighlight: true, fm: null })]) {
        const el = createReadingBlockElement(block, source)
        mount(el)
        expect(el.querySelectorAll('[class*="tok-"]').length > 0).toBe(count === 4096)
      }
    }
  })
})
