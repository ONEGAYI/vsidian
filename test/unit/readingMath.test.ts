// 阅读模式公式渲染契约测试（工单 #59）：markdown-it + @vscode/markdown-it-katex
// 集成（解析语义与 live 的 shared/math.ts 对齐）、$$ 块独立成块（挂载/锚点
// 语义）、KaTeX 输出过净化层、非法公式原文降级不外溢。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import {
  createReadingBlockElement,
  READING_CLASS_NAMES,
} from '../../src/webview/readingView'
import { sanitizeReadingDom } from '../../src/webview/readingMarkdown'

function renderBlocks(text: string) {
  return splitReadingBlocks(text).map((b) => createReadingBlockElement(b, text))
}

describe('阅读切块：公式块的独立成块与锚点', () => {
  it('行首 $$ 块独立为 math 块，锚点覆盖定界符', () => {
    const text = '前文\n\n$$\nE=mc^2\n$$\n\n尾文'
    const blocks = splitReadingBlocks(text)
    const math = blocks.filter((b) => b.kind === 'math')
    expect(math).toHaveLength(1)
    expect(math[0]!.start).toBe('前文\n\n'.length)
    expect(math[0]!.end).toBe(text.length - '\n\n尾文'.length)
    expect(text.slice(math[0]!.start, math[0]!.end)).toBe('$$\nE=mc^2\n$$')
  })

  it('行首单行 $$x$$ 与段内 $$…$$ 均渲染 display 数学', () => {
    for (const text of ['$$x^2$$\n', '前 $$a+b$$ 后\n']) {
      const el = renderBlocks(text).find((b) => b.innerHTML.includes('katex'))
      expect(el, text).toBeTruthy()
      expect(el!.innerHTML).toContain('katex-display')
    }
  })

  it('行内公式在段落块内渲染 KaTeX span', () => {
    const [para] = renderBlocks('价格 $x^2$ 元')
    expect(para!.innerHTML).toContain('class="katex"')
    expect(para!.innerHTML).not.toContain('katex-display')
  })

  it.each([
    ['__$x_1$__', 'strong'],
    ['_$x_1$_', 'em'],
    ['___$x_1$___', 'strong > em'],
    ['***文字 $x_1$***', 'strong > em'],
    ['***<span>$x_1$</span>***', 'strong > em'],
    ['___<span>$x_1$</span>___', 'strong > em'],
    ['***<span>&#36;x_1&#36;</span>***', 'strong > em'],
    ['_**$x_1$**_', 'em > strong'],
    ['***$x_1$** 文字*', 'em > strong'],
    ['*****$x_1$*****', 'em > strong > strong'],
    ['__文字 $x_1$__', 'strong'],
    ['_$x_1$ 文字_', 'em'],
  ])('强调标记 %s 不阻断行内公式，外层格式顺序正确', (source, selector) => {
    const [para] = renderBlocks(source)
    expect(para.querySelector(selector)?.querySelector('.vsidian-math annotation')?.textContent).toBe('x_1')
  })

  it.each(['***文字***', '***<code>$x$</code>***', '***<span title="$x$">文字</span>***'])(
    '不含可排版公式的三重强调保留既有阅读 DOM 顺序：%s', (source) => {
      const [para] = renderBlocks(source)
      expect(para.querySelector('em > strong')).not.toBeNull()
      expect(para.querySelector('.vsidian-math')).toBeNull()
    },
  )

  it.each([
    ['![_$qwert$_](image.png)', '$qwert$'],
    ['![![_$qwert$_](inner.png)](image.png)', '$qwert$'],
    ['![_$a&amp;b$_](image.png)', '$a&b$'],
    [String.raw`![_$q\_1$_](image.png)`, '$q_1$'],
    ['![_$a **b** c$_](image.png)', '$a b c$'],
  ])('公式识别不改变图片替代文字 %s', (source, alt) => {
    const [para] = renderBlocks(source)
    expect(para.querySelector('img')?.alt).toBe(alt)
  })

  it.each([
    ['![price _$12](image.png), currency $ here', 'img'],
    ['[price _$12](https://example.test), currency $ here', 'a'],
    ['[![price _$12](image.png)](https://example.test), currency $ here', 'a > img'],
    ['[price _$12](), currency $ here', 'a'],
    ['[price _$12][ref], currency $ here\n\n[ref]: https://example.test', 'a'],
    ['[price _$12], currency $ here\n\n[price _$12]: https://example.test', 'a'],
  ])('未闭合的下划线公式不能跨过链接或图片边界：%s', (source, selector) => {
    const [para] = renderBlocks(source)
    expect(para.querySelector(selector)).not.toBeNull()
    expect(para.querySelector('.vsidian-math, .vsidian-math-error')).toBeNull()
    expect(para.textContent).toContain(', currency $ here')
  })
  it.each([
    ['[label $ after](/ok) tail', 'a'],
    ['![label $ after](img.png) tail', 'img'],
    ['[label $ after][ref] tail\n\n[Ref]: /ok', 'a'],
    ['[label $ after] tail\n\n[label $ after]: /ok', 'a'],
  ])('从标签外开始的公式不吞掉有效链接或图片：%s', (target, selector) => {
    const [para] = renderBlocks('before _$ money ' + target)
    expect(para.querySelector(selector)).not.toBeNull()
    expect(para.querySelector('.vsidian-math, .vsidian-math-error')).toBeNull()
  })
  it.each([
    ['[price _$12][REF]', '[ref]: /ok', '12][REF], currency '],
    ['[price _$12][]', '[Price   _$12]: /ok', '12][], currency '],
  ])('未定义的完整或折叠引用不限制公式，定义后保留真实链接：%s', (label, definition, tex) => {
    const text = label + ', currency $ here'
    const [undefinedRef] = renderBlocks(text)
    expect(undefinedRef.querySelector('a')).toBeNull()
    expect(undefinedRef.querySelector('.vsidian-math annotation')?.textContent).toBe(tex)
    const [definedRef] = renderBlocks(text + '\n\n' + definition)
    expect(definedRef.querySelector('a')?.getAttribute('href')).toBe('/ok')
    expect(definedRef.querySelector('.vsidian-math, .vsidian-math-error')).toBeNull()
  })
  it('公式可完整包含形似链接的 TeX', () => {
    const [para] = renderBlocks('前 _$[x](url)$_ 后')
    expect(para.querySelector('.vsidian-math annotation')?.textContent).toBe('[x](url)')
  })

  it.each([
    ['_', 'x_1'],
    ['__', String.raw`\left[x,y\right)`],
    ['_', String.raw`\text{]}`],
  ])('链接标签内成对的下划线公式仍参与排版：%s %s', (fence, tex) => {
    const [para] = renderBlocks(`[${fence}$${tex}$${fence}](https://example.test)`)
    expect(para.querySelector('a .vsidian-math annotation')?.textContent).toBe(tex)
  })

  it('行内 HTML 内只排版文本节点中的公式，保留外壳、属性与其他 Markdown 字面内容', () => {
    const [para] = renderBlocks('前 <span style="color: purple" title="$t$">**字面** <em>$x_1$</em> 和 $a&lt;b$</span> 后')
    const span = para.querySelector<HTMLSpanElement>('span[title]')!
    expect(span.getAttribute('title')).toBe('$t$')
    expect(span.style.color).toBe('purple')
    expect(span.querySelector('strong')).toBeNull()
    expect(span.textContent).toContain('**字面**')
    expect(span.querySelector('em .vsidian-math annotation')?.textContent).toBe('x_1')
    expect(span.querySelector(':scope > .vsidian-math annotation')?.textContent).toBe('a<b')
    expect(para.textContent?.trimEnd()).toMatch(/^前 .* 后$/u)
  })

  it('行内 HTML 的代码、原生 MathML 和源码降级不重新排版', () => {
    const [para] = renderBlocks('前 <code>$x$</code> <math><mtext>$y$</mtext></math> <script>$z$</script> 后')
    expect(para.querySelector('.vsidian-math')).toBeNull()
    expect(para.querySelector('code')?.textContent).toBe('$x$')
    expect(para.querySelector('mtext')?.textContent).toBe('$y$')
    expect(para.querySelector('.vsidian-html-source-fallback')?.textContent).toBe('<script>$z$</script>')
  })

  it('行内 HTML 的建议项和输出控件保留原始值，邻近公式仍正常渲染', () => {
    const [para] = renderBlocks('前 <span><datalist id="choices"><option>$x$</option></datalist> <input list="choices"> <output>$y$</output> $z$</span> 后')
    expect(para.querySelector('option')?.value).toBe('$x$')
    expect(para.querySelector('output')?.value).toBe('$y$')
    expect([...para.querySelectorAll('.vsidian-math annotation')].map(node => node.textContent)).toEqual(['z'])
  })

  it('代码区内的 $ 不渲染公式', () => {
    const code = renderBlocks('`a $b$ c`\n\n```\n$x$\n```\n')
    for (const el of code) {
      expect(el.innerHTML).not.toContain('class="katex"')
    }
  })

  it('普通美元文本不渲染公式', () => {
    const [para] = renderBlocks('价格 $5，合计 $10 元')
    expect(para!.innerHTML).not.toContain('katex')
    expect(para!.textContent).toContain('$5')
  })

  it('相邻两个块级公式各自成块（互不吞并）', () => {
    const text = '$$\na\n$$\n$$\nb\n$$'
    const math = splitReadingBlocks(text).filter((b) => b.kind === 'math')
    expect(math).toHaveLength(2)
  })
})

describe('阅读渲染：KaTeX 输出与稳定类名', () => {
  it('math 块元素带稳定类名且 KaTeX HTML 过净化层存活', () => {
    const text = '$$\nE=mc^2\n$$'
    const [el] = renderBlocks(text)
    expect(el.classList.contains(READING_CLASS_NAMES.mathBlock)).toBe(true)
    // 净化已随 createReadingBlockElement 执行：KaTeX span/MathML/内联 style 存活
    expect(el.querySelector('.katex')).toBeTruthy()
    expect(el.querySelector('.katex-html')).toBeTruthy()
    expect(el.querySelector('math')).toBeTruthy()
    expect(el.querySelector('annotation')?.textContent).toBe('E=mc^2\n')
    const strut = el.querySelector('.strut')
    expect(strut?.getAttribute('style')).toContain('height:')
  })

  it('渲染产物带 vsidian-math 稳定入口类（live 与阅读共用探针）', () => {
    const [inline] = renderBlocks('$x$')
    expect(inline.querySelector('.vsidian-math')).toBeTruthy()
    const [block] = renderBlocks('$$x$$')
    expect(block.querySelector('.vsidian-math-block')).toBeTruthy()
  })

  it('净化层移除 KaTeX 产物中的危险注入但保留公式语义', () => {
    const text = '$$\nE=mc^2\n$$'
    const [el] = renderBlocks(text)
    // 直接构造含 script 的渲染产物验证净化不因公式内容而失效
    el.innerHTML += '<script>alert(1)</script><span onclick="x()">y</span>'
    sanitizeReadingDom(el)
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[onclick]')).toBeNull()
    expect(el.querySelector('.katex')).toBeTruthy()
  })
})

describe('阅读降级：非法公式显示可读原文', () => {
  it('未定义命令渲染为降级 span：含原文、带错误类、不吞邻近内容', () => {
    const [para] = renderBlocks('前文 $\\notdefined{x}$ 后文')
    const err = para.querySelector('.vsidian-math-error')
    expect(err).toBeTruthy()
    expect(err!.textContent).toBe('$\\notdefined{x}$')
    expect(para.textContent).toContain('前文')
    expect(para.textContent).toContain('后文')
  })

  it('块级非法公式同样降级且块内其余公式不受牵连', () => {
    const [bad] = renderBlocks('$$\n\\badcmd\n$$')
    expect(bad.querySelector('.vsidian-math-error')).toBeTruthy()
    expect(bad.textContent).toContain('$$')
  })

  it('一处降级不影响同段其他合法公式', () => {
    const [para] = renderBlocks('$好$ 与 $\\bad$ 与 $也好$')
    expect(para.querySelectorAll('.katex')).toHaveLength(2)
    expect(para.querySelectorAll('.vsidian-math-error')).toHaveLength(1)
  })

  it('降级原文经 HTML 转义（含尖括号的 tex 不产生标签）', () => {
    const [para] = renderBlocks('$a < b \\bad$')
    const err = para.querySelector('.vsidian-math-error')
    expect(err).toBeTruthy()
    expect(err!.innerHTML).not.toContain('<b>')
    expect(err!.textContent).toBe('$a < b \\bad$')
  })
})

describe('双视图语义一致性：阅读渲染与 shared/math.ts 对拍', () => {
  it('同一文本的公式出现数与渲染出的 KaTeX 数一致', async () => {
    const { scanMathRanges } = await import('../../src/shared/math')
    const samples = [
      '$a$ 与 $b$\n',
      '前 $$x$$ 后\n',
      '$$\nc\n$$\n$$\nd\n$$\n',
      '`$e$` 与 $f$\n',
      '\\$g$ 普通美元\n',
    ]
    for (const text of samples) {
      const occurrences = scanMathRanges(text.split('\n'), 0)
      const els = renderBlocks(text)
      const katexCount = els.reduce(
        (n, el) => n + el.querySelectorAll('.katex:not(.katex-error)').length,
        0,
      )
      expect(katexCount, JSON.stringify(text)).toBe(occurrences.length)
    }
  })

  it('段落内跨行 $…$：阅读渲染公式、live 显源码——已声明的已知差异钉子', async () => {
    // 已知差异（docs/perf/2026-09-math-rendering.md）：markdown-it 的段内
    // 联文本允许软换行跨行的 $…$（开闭定界符分行），live 行扫描以行为
    // 单位不识别。本用例钉住两侧各自正确的呈现，防止未来语义漂移无察觉：
    // 阅读渲染 KaTeX（段落级 inline 扫描），live 的 scanMathRanges 不产出。
    const text = '前 $x\ny$ 后' // 同一自然段（无空行）内的跨行行内公式
    const [para] = renderBlocks(text)
    expect(para.querySelectorAll('.katex')).toHaveLength(1)
    expect(para.textContent).toContain('前')
    expect(para.textContent).toContain('后')
    const { scanMathRanges } = await import('../../src/shared/math')
    expect(scanMathRanges(text.split('\n'), 0)).toHaveLength(0)
  })

  it('行内 $`1+1`$ 两侧同渲染（反引号剥离一致，C5）', () => {
    const [para] = renderBlocks('a $`1+1`$ b')
    expect(para.querySelectorAll('.katex')).toHaveLength(1)
    // 剥离后的 tex 进入渲染输入：annotation 为 1+1（不含反引号）
    expect(para.querySelector('annotation')?.textContent).toBe('1+1')
  })

  it('引用内块公式：两侧同例命中集一致（#674 T06 对拍）', async () => {
    // 引用内 $$ 行（markdown-it-katex 在 blockquote 内命中 math_block；
    // live 侧剥前缀识别）与容器断开形态（插件 src 级贪婪跨容器吃到闭合——
    // live 同口径延续）两侧数量一致；行内路径两侧本就同扫描
    const { scanMathRanges } = await import('../../src/shared/math')
    const samples = [
      '> $$\n> x = a^2\n> $$\n',
      '> > $$\n> > x\n> > $$\n',
      '> $$x^2$$\n',
      '> $$\nx\n> $$\n', // 容器断开：两侧都延续到闭合
      '> a $x$ b\n',
    ]
    for (const text of samples) {
      const occurrences = scanMathRanges(text.split('\n'), 0)
      const els = renderBlocks(text)
      const katexCount = els.reduce(
        (n, el) => n + el.querySelectorAll('.katex:not(.katex-error)').length,
        0,
      )
      expect(katexCount, JSON.stringify(text)).toBe(occurrences.length)
    }
  })

  it('引用内空内容块 $$ $$：阅读渲染空公式、live 降级——既有双端差异随前缀平移（#674 T06 如实钉住）', async () => {
    // 顶层 $$  $$ / $$$$ 的既有差异（live B-4 决策不产出、插件渲染空内容）
    // 在引用内同形态重现：live 显源码、阅读渲染空 KaTeX，降级方向安全
    const { scanMathRanges } = await import('../../src/shared/math')
    for (const text of ['> $$  $$\n', '> $$$$\n']) {
      expect(scanMathRanges(text.split('\n'), 0), text).toHaveLength(0)
      const els = renderBlocks(text)
      const katexCount = els.reduce((n, el) => n + el.querySelectorAll('.katex').length, 0)
      expect(katexCount, text).toBe(1)
    }
  })
})
