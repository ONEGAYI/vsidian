// @vitest-environment jsdom
// 阅读视图 markdown-it 渲染契约（工单 #8）：
// - 安全配置：html:false（Markdown 原文不作可执行 HTML），linkify/typographer
//   关闭；javascript: 协议链接不产生可点击 href（markdown-it validateLink 默认拦截）
// - 列表项源锚点：list_item_open 自定义渲染规则写入 data-vsidian-src-start/end
//   （#9 任务写回与块内定位的依据）
// - DOM 净化：markdown-it 输出进入 DOM 后的防御性二次清洗（script/iframe/
//   行内事件属性/javascript: 链接）——规格安全边界的纵深防御层
// - 任务项转换：li 首文本 `[ ] `/`[x] ` → disabled checkbox + marker 区间锚点
//   （#8 只做显示，#9 实现勾选写回）
import { describe, it, expect } from 'vitest'
import { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { docInput, markdownTreeParser } from '../../src/shared/markdownDoc'
import {
  convertTaskItems,
  buildLineBounds,
  createMarkdownRenderer,
  renderTokenHtml,
  sanitizeReadingDom,
} from '../../src/webview/readingMarkdown'

function renderToDom(md: ReturnType<typeof createMarkdownRenderer>, src: string): HTMLElement {
  const env = buildLineBounds(src)
  const tokens = md.parse(src, env as unknown as Parameters<ReturnType<typeof createMarkdownRenderer>['parse']>[1])
  const host = document.createElement('div')
  host.innerHTML = renderTokenHtml(md, tokens, env)
  return host
}

describe('createMarkdownRenderer：安全配置', () => {
  it('html:false——源文中的 HTML 标签按纯文本转义，不产生元素', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '<script>alert(1)</script>\n\n<b>加粗</b>\n')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script>')
    expect(host.textContent).toContain('<b>加粗</b>')
  })

  it('javascript: 协议链接不产生可执行 href（validateLink 默认拦截）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '[点击](javascript:alert(1))\n')
    const anchor = host.querySelector('a')
    expect(anchor).toBeNull() // 拦截后按普通文本呈现
  })

  it('基础语义渲染：粗体/斜体/行内代码/标题/引用/围栏', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(
      md,
      '# 标题\n\n**粗** 与 *斜* 和 `码`\n\n> 引用\n\n```\ncode\n```\n',
    )
    expect(host.querySelector('h1')?.textContent).toBe('标题')
    expect(host.querySelector('strong')?.textContent).toBe('粗')
    expect(host.querySelector('em')?.textContent).toBe('斜')
    expect(host.querySelector('code')?.textContent).toBe('码')
    expect(host.querySelector('blockquote')?.textContent).toContain('引用')
    expect(host.querySelector('pre code')?.textContent).toContain('code')
  })
})

describe('宽松换行设置（#423 breaks 选项）', () => {
  // 矩阵：默认（breaks:false）单换行是 CommonMark 软换行（拼回同段不产
  // <br>）；breaks:true 时段内单换行渲染为 <br>（对齐 VSCode
  // markdown.preview.breaks / Obsidian 非 strictLineBreaks 的宽松形态）。
  // 安全边界不随设置放宽：breaks 只影响换行呈现语义，html/linkify/
  // typographer 锁定不变（攻击面论证见 createMarkdownRenderer 注释）。
  it('默认（false）单换行不产生 <br>（既有严格语义钉住）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '第一行\n第二行\n')
    expect(host.querySelector('p')!.innerHTML).not.toContain('<br')
    expect(host.querySelector('p')!.textContent).toContain('第一行')
  })

  it('breaks:true 段内单换行渲染为 <br>（每个换行一处）', () => {
    const md = createMarkdownRenderer({ breaks: true })
    const host = renderToDom(md, '第一行\n第二行\n第三行\n')
    expect(host.querySelectorAll('p br')).toHaveLength(2)
  })

  it('行尾双空格硬换行两种形态都产生 <br>（显式标记优先级不随设置变化）', () => {
    const strict = renderToDom(createMarkdownRenderer(), '第一行  \n第二行\n')
    expect(strict.querySelector('p')!.innerHTML).toContain('<br')
    const loose = renderToDom(createMarkdownRenderer({ breaks: true }), '第一行  \n第二行\n')
    expect(loose.querySelectorAll('p br')).toHaveLength(1)
  })

  it('breaks:true 不进代码区：行内代码换行按 CommonMark 规范为空格、围栏保持字面', () => {
    const md = createMarkdownRenderer({ breaks: true })
    const host = renderToDom(md, '`行内\n码`\n\n```\n围栏一\n围栏二\n```\n')
    // code span 内换行 → 空格是 CommonMark 标准规范化，与 breaks 无关
    expect(host.querySelector('p code')?.textContent).toBe('行内 码')
    expect(host.querySelector('pre code')?.textContent).toContain('围栏一\n围栏二')
    expect(host.querySelectorAll('p br')).toHaveLength(0)
  })

  it('breaks:true 不引入 HTML 面：标签仍转义、javascript: 仍拦截（安全锁定不受设置影响）', () => {
    const md = createMarkdownRenderer({ breaks: true })
    const host = renderToDom(md, '<script>alert(1)</script>\n[点](javascript:alert(1))\n')
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('a')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script>')
  })

  it('段落块边界不因 breaks 变化（空行分段语义恒定）', () => {
    const src = '段一甲\n段一乙\n\n段二甲\n'
    const strictBlocks = createMarkdownRenderer().parse(src, {} as never)
    const looseBlocks = createMarkdownRenderer({ breaks: true }).parse(src, {} as never)
    expect(strictBlocks.filter((t) => t.type === 'paragraph_open')).toHaveLength(2)
    expect(looseBlocks.filter((t) => t.type === 'paragraph_open')).toHaveLength(2)
  })
})

describe('行尾双空格与末尾无换行（mvp.md 文档样例清单）', () => {
  it('行尾双空格渲染为硬换行 <br>（CommonMark 语义），行尾单空格不产生', () => {
    const md = createMarkdownRenderer()
    const hard = renderToDom(md, '第一行  \n第二行\n')
    expect(hard.querySelector('p')!.innerHTML).toContain('<br')
    const soft = renderToDom(md, '第一行 \n第二行\n')
    expect(soft.querySelector('p')!.innerHTML).not.toContain('<br')
  })

  it('单行无换行文档渲染不崩、文本保真；渲染层吞块尾空格是 CommonMark 标准（保真责任在编辑路径）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, 'abc')
    sanitizeReadingDom(host) // 净化层同时跑通
    expect(host.textContent!.trim()).toBe('abc') // 块级 HTML 尾随 \n 不计入
    const tail = renderToDom(md, 'a  \nb ') // 段内双空格硬换行保留，块尾单空格按标准剥离
    sanitizeReadingDom(tail)
    expect(tail.querySelector('br')).not.toBeNull()
    expect(tail.textContent!.trim()).toBe('a\nb')
  })
})

describe('列表项源锚点（list_item_open 自定义规则）', () => {
  it('每个 li 携带其首行起止 offset（含嵌套项）', () => {
    const md = createMarkdownRenderer()
    const src = '- 甲项\n- 乙项\n  - 嵌套项\n'
    const host = renderToDom(md, src)
    const items = Array.from(host.querySelectorAll('li'))
    expect(items).toHaveLength(3)
    const starts = items.map((li) => Number(li.dataset['vsidianSrcStart']))
    const ends = items.map((li) => Number(li.dataset['vsidianSrcEnd']))
    expect(src.slice(starts[0]!, ends[0]!)).toBe('- 甲项')
    // 外层 li 的源区间覆盖其嵌套列表（DOM 上嵌套 ul 在该 li 内，区间语义一致）
    expect(src.slice(starts[1]!, ends[1]!)).toBe('- 乙项\n  - 嵌套项')
    expect(src.slice(starts[2]!, ends[2]!)).toBe('  - 嵌套项')
  })
})

describe('高亮 ==text== 行内规则（#105）', () => {
  it('成对 == 渲染为 mark 语义元素（html:false 下输出语义标签）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '正文 ==高亮== 文本\n')
    const marks = host.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]!.textContent).toBe('高亮')
    expect(host.textContent).toContain('正文 高亮 文本')
  })

  it('同行多个高亮各自配对；嵌套行内标记照常渲染', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '==甲== 与 ==**粗亮**==\n')
    expect([...host.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['甲', '粗亮'])
    expect(host.querySelector('mark strong')?.textContent).toBe('粗亮')
  })

  it('残缺与空格紧贴形态按普通文本降级（源文保真）', () => {
    const md = createMarkdownRenderer()
    for (const src of ['a == b == c\n', '==未闭合\n', '空 == 内容 == 间隔\n']) {
      const host = renderToDom(md, src)
      expect(host.querySelectorAll('mark')).toHaveLength(0)
      expect(host.textContent).toContain('==')
    }
  })

  it('行内代码内的 == 不转换（代码内容字面呈现）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '`==x==`\n')
    expect(host.querySelectorAll('mark')).toHaveLength(0)
    expect(host.querySelector('code')?.textContent).toBe('==x==')
  })

  it('段内跨行可配对（与 lezer 侧同判）', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '==首行\n次行==\n')
    expect(host.querySelectorAll('mark')).toHaveLength(1)
    expect(host.querySelector('mark')?.textContent).toBe('首行\n次行')
  })

  it('close 扫描跳过行内代码：code span 内 == 不被误配（与 lezer 侧同判）', () => {
    const md = createMarkdownRenderer()
    const src = '==use `a==b` now==\n'
    const host = renderToDom(md, src)
    // mark 覆盖整段高亮，code span 完整落在 mark 内、内容字面呈现
    const mark = host.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('use a==b now')
    expect(mark?.querySelector('code')?.textContent).toBe('a==b')
    // lezer 侧对拍：InlineCode 消费 `a==b`，Highlight 的 close 定界符在
    // code span 之外——两侧内容区间一致，不因裸搜索把 close 切进 code span
    const tree = markdownTreeParser.parse(docInput(Text.of(src.trimEnd().split('\n'))))
    const findHighlight = (node: SyntaxNode): SyntaxNode | null => {
      if (node.name === 'Highlight') return node
      for (let c = node.firstChild; c; c = c.nextSibling) {
        const hit = findHighlight(c)
        if (hit) return hit
      }
      return null
    }
    const highlight = findHighlight(tree.topNode)
    expect(highlight).not.toBeNull()
    const inner: SyntaxNode[] = []
    for (let c = highlight!.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'HighlightMark') inner.push(c)
    }
    expect(inner.map((n) => n.name)).toEqual(['InlineCode'])
  })

  it('==== 空内容形态不产空 mark（源码降级，与 live 侧口径一致）', () => {
    for (const src of ['====\n', '====x\n', 'a ====\n']) {
      const host = renderToDom(createMarkdownRenderer(), src)
      expect(host.querySelectorAll('mark')).toHaveLength(0)
      expect(host.textContent).toContain('====')
    }
  })

  it('未配对反引号按普通文本：其后的 == 照常闭合', () => {
    const md = createMarkdownRenderer()
    const host = renderToDom(md, '==a`b== c\n')
    expect(host.querySelector('mark')?.textContent).toBe('a`b')
  })
})

describe('嵌套行内围栏 flanking 双视图同源（#149 宽松基准）', () => {
  const md = createMarkdownRenderer()

  /** 树中首个 Highlight 节点 */
  function findHighlight(node: SyntaxNode): SyntaxNode | null {
    if (node.name === 'Highlight') {
      return node
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      const hit = findHighlight(c)
      if (hit) {
        return hit
      }
    }
    return null
  }

  /** Highlight 首末 HighlightMark 之间的内容源文（lezer 侧内容区间） */
  function lezerHighlightInner(src: string): string | null {
    const tree = markdownTreeParser.parse(docInput(Text.of(src.trimEnd().split('\n'))))
    const hit = findHighlight(tree.topNode)
    if (!hit) {
      return null
    }
    let first: SyntaxNode | null = null
    let last: SyntaxNode | null = null
    for (let c = hit.firstChild; c; c = c.nextSibling) {
      if (c.name === 'HighlightMark') {
        if (!first) {
          first = c
        }
        last = c
      }
    }
    return first && last ? src.slice(first.to, last.from) : null
  }

  /** 组合矩阵：外层 == × 内层标记 × {汉字紧贴、字母紧贴、空白外边界、标点外边界} */
  const matrix: Array<{ label: string; src: string; inner: string; plain: string; nested: string }> = [
    { label: '票内样例：汉字外贴+星号内贴', src: '跨格==**建立**==选区后\n', inner: '**建立**', plain: '建立', nested: 'strong' },
    { label: '汉字外贴+单星内层', src: '看==*词*==的\n', inner: '*词*', plain: '词', nested: 'em' },
    { label: '汉字外贴+下划线粗体内层', src: '看==__词__==的\n', inner: '__词__', plain: '词', nested: 'strong' },
    { label: '汉字外贴+删除线内层（外层同源；strike 呈现分野是既有契约）', src: '看==~~词~~==的\n', inner: '~~词~~', plain: '词', nested: 's' },
    { label: '汉字外贴+行内代码内层', src: '看==`词`==的\n', inner: '`词`', plain: '词', nested: 'code' },
    { label: '字母外贴', src: 'word==**bold**==end\n', inner: '**bold**', plain: 'bold', nested: 'strong' },
    { label: '空白外边界', src: '空 ==**词**== 界\n', inner: '**词**', plain: '词', nested: 'strong' },
    { label: '标点外边界', src: '（==**词**==）\n', inner: '**词**', plain: '词', nested: 'strong' },
  ]

  it('组合矩阵对拍：阅读渲染与 lezer 树外层高亮均配对、内容区间同源', () => {
    for (const { label, src, inner, plain, nested } of matrix) {
      // 阅读侧：mark 语义元素 + 嵌套标记照常渲染
      const host = renderToDom(md, src)
      const mark = host.querySelector('mark')
      expect(mark, label).not.toBeNull()
      expect(mark!.textContent, label).toBe(plain)
      expect(mark!.querySelector(nested)?.textContent, label).toBe(plain)
      // lezer 侧对拍：Highlight 配对且首末 mark 间内容与源文一致
      expect(lezerHighlightInner(src), label).toBe(inner)
    }
  })

  it('内侧空格紧贴仍拒绝：宽松基准不放宽空白边界（两视图一致降级）', () => {
    for (const src of ['a == **b** == c\n', 'x== **y** ==z\n']) {
      const host = renderToDom(md, src)
      expect(host.querySelectorAll('mark'), src).toHaveLength(0)
      expect(host.textContent, src).toContain('==')
      expect(lezerHighlightInner(src), src).toBeNull()
    }
  })

  it('* 系外层（**==词==**）双视图一致按 CommonMark 现状裸外层：内层高亮照常渲染（Obsidian 对照留人工验收）', () => {
    const src = '看**==词==**的\n'
    const host = renderToDom(md, src)
    expect(host.querySelector('strong')).toBeNull()
    expect(host.textContent).toContain('**')
    expect(host.querySelector('mark')?.textContent).toBe('词')
    // lezer 侧对拍：内层 Highlight 照常配对、外层 StrongEmphasis 不存在
    expect(lezerHighlightInner(src)).toBe('词')
    const tree = markdownTreeParser.parse(docInput(Text.of(src.trimEnd().split('\n'))))
    let strongCount = 0
    const walk = (node: SyntaxNode): void => {
      if (node.name === 'StrongEmphasis') strongCount++
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c)
    }
    walk(tree.topNode)
    expect(strongCount).toBe(0)
  })
})

describe('宽松内联链接/图片行内规则（#152：目标含未编码空格，Obsidian 兼容）', () => {
  const md = createMarkdownRenderer()

  it('含空格目标渲染为链接：href 为 normalizeLink 编码形态，解码后与字面源文一致', () => {
    const host = renderToDom(md, '见 [目标 文档](./子 目录/目标 文档.md)。\n')
    const anchor = host.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.textContent).toBe('目标 文档')
    expect(decodeURIComponent(anchor!.getAttribute('href') ?? '')).toBe('./子 目录/目标 文档.md')
  })

  it('含空格图源渲染为图片：src 编码形态，alt 取标签内容', () => {
    const host = renderToDom(md, '![图片 说明](./assets/图 片.png)\n')
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(decodeURIComponent(img!.getAttribute('src') ?? '')).toBe('./assets/图 片.png')
    expect(img!.getAttribute('alt')).toBe('图片 说明')
  })

  it('标签内嵌套行内标记照常渲染（与标准链接同构）', () => {
    const host = renderToDom(md, '[**粗体** 与 `码`](a b.md)\n')
    const anchor = host.querySelector('a')
    expect(anchor!.querySelector('strong')?.textContent).toBe('粗体')
    expect(anchor!.querySelector('code')?.textContent).toBe('码')
  })

  it('标准层职责形态不受影响：%20、尖括号、合法标题、无空格目标', () => {
    for (const src of [
      '[t](./目标%20文档.md)\n',
      '[t](<a b.md>)\n',
      '[t](a.md "标题 内容")\n',
      '[t](a.md)\n',
    ]) {
      const host = renderToDom(md, src)
      const anchor = host.querySelector('a')
      expect(anchor, src).not.toBeNull()
      expect(anchor!.textContent, src).toBe('t')
    }
  })

  it('标题组合形态整条渲染为一条链接（目标是括号内整段字面文本）', () => {
    const host = renderToDom(md, '[t](a b "标题")\n')
    const anchors = host.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(decodeURIComponent(anchors[0]!.getAttribute('href') ?? '')).toBe('a b "标题"')
  })

  it('降级形态按原文呈现：反斜杠、未闭合、转义前缀、危险协议', () => {
    for (const src of [
      '[t](a\\ b)\n',
      '[t](a b\n',
      '\\![t](a b.md)\n',
    ]) {
      const host = renderToDom(md, src)
      expect(host.querySelector('a'), src).toBeNull()
      expect(host.textContent, src).toContain('[t]')
    }
    // 危险协议（validateLink 与标准层同判：不产生可点击 href）
    const danger = renderToDom(md, '[点](javascript:ale rt(1))\n')
    expect(danger.querySelector('a')).toBeNull()
    expect(danger.textContent).toContain('[点](javascript:ale rt(1))')
  })

  it('行内代码与双链形态不被宽松规则干扰', () => {
    const host = renderToDom(md, '`[t](a b.md)`\n')
    expect(host.querySelector('a')).toBeNull()
    expect(host.querySelector('code')?.textContent).toBe('[t](a b.md)')
    const wikilink = renderToDom(md, '[[含空格 笔记]]\n')
    expect(wikilink.querySelector('a')?.className).toContain('vsidian-wikilink')
  })
})

describe('sanitizeReadingDom：DOM 纵深净化', () => {
  it('移除 script/iframe/style 元素、行内事件属性与 javascript: 链接', () => {
    const host = document.createElement('div')
    // 模拟"渲染器被绕过"的极端输入（html:false 下不应出现；此为防御层验证）
    host.innerHTML =
      '<p onclick="evil()">文</p><script>bad()</script><iframe src="x"></iframe>' +
      '<style>body{}</style><a href="javascript:evil()">链</a><a href="https://ok">好</a>'
    sanitizeReadingDom(host)
    expect(host.querySelector('script')).toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('style')).toBeNull()
    expect(host.querySelector('p')!.getAttribute('onclick')).toBeNull()
    const links = Array.from(host.querySelectorAll('a'))
    expect(links).toHaveLength(2)
    expect(links[0]!.getAttribute('href')).toBeNull() // 危险链接摘除 href 后保留惰性元素
    expect(links[1]!.getAttribute('href')).toBe('https://ok')
  })
})

describe('convertTaskItems：任务项 checkbox（#9：启用可交互）', () => {
  it('li 首文本 [ ]/[x]/[X] → 启用的 checkbox，锚点恰为标记三字符区间', () => {
    const md = createMarkdownRenderer()
    const src = '- [ ] 未完成\n- [x] 已完成\n- [X] 大写完成\n- 普通项\n'
    const host = renderToDom(md, src)
    convertTaskItems(host, src)
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    expect(boxes).toHaveLength(3)
    expect(boxes.every((b) => !b.disabled)).toBe(true) // #9：启用（点击写回）
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true])
    // 渲染态锚点（data-vsidian-checked）：点击意图的确定性来源
    expect(boxes.map((b) => b.dataset['vsidianChecked'])).toEqual(['false', 'true', 'true'])
    // 锚点：源文 [ ]/[x]/[X] 区间
    expect(src.slice(Number(boxes[0]!.dataset['vsidianSrcStart']), Number(boxes[0]!.dataset['vsidianSrcEnd']))).toBe('[ ]')
    expect(src.slice(Number(boxes[1]!.dataset['vsidianSrcStart']), Number(boxes[1]!.dataset['vsidianSrcEnd']))).toBe('[x]')
    expect(src.slice(Number(boxes[2]!.dataset['vsidianSrcStart']), Number(boxes[2]!.dataset['vsidianSrcEnd']))).toBe('[X]')
    // 任务项 li 带任务语义类（#9 勾选定位入口）
    expect(host.querySelectorAll('li.vsidian-reading-task')).toHaveLength(3)
    // 普通项不受影响
    const last = Array.from(host.querySelectorAll('li')).pop()!
    expect(last.textContent).toBe('普通项')
    expect(last.classList.contains('vsidian-reading-task')).toBe(false)
  })

  it('嵌套缩进的任务项锚点取自其自身首行', () => {
    const md = createMarkdownRenderer()
    const src = '- 外层\n  - [x] 嵌套任务\n'
    const host = renderToDom(md, src)
    convertTaskItems(host, src)
    const box = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(box).not.toBeNull()
    const s = Number(box.dataset['vsidianSrcStart'])
    expect(src.slice(s, s + 3)).toBe('[x]')
  })
})

describe('#248 表格格内嵌入占位（转义管道解码重解析）', () => {
  it('格内 \\| 别名形态产占位：data-vsidian-embed-inner 为解码语义（B|别名）', () => {
    const md = createMarkdownRenderer()
    const src = '| a | ![[B\\|别名]] |\n| --- | --- |\n| c | d |'
    const host = renderToDom(md, src)
    const slot = host.querySelector('span[data-vsidian-embed-inner]')
    expect(slot).not.toBeNull()
    expect(slot!.getAttribute('data-vsidian-embed-inner')).toBe('B|别名')
  })

  it('格内无管道形态照常产占位（回归）', () => {
    const md = createMarkdownRenderer()
    const src = '| ![[甲]] | b |\n| --- | --- |\n| c | d |'
    const host = renderToDom(md, src)
    expect(host.querySelector('span[data-vsidian-embed-inner]')!.getAttribute('data-vsidian-embed-inner')).toBe('甲')
  })

  it('格内锚点 + 转义别名组合形态产占位', () => {
    const md = createMarkdownRenderer()
    const src = '| ![[B#标题\\|别名]] | b |\n| --- | --- |\n| c | d |'
    const host = renderToDom(md, src)
    expect(host.querySelector('span[data-vsidian-embed-inner]')!.getAttribute('data-vsidian-embed-inner')).toBe('B#标题|别名')
  })

  it('格内行内代码中的嵌入字面量不产占位；code span 渲染按既有 tokenizer 语义（\\| 已解码为 |）', () => {
    const md = createMarkdownRenderer()
    const src = '| `![[B]]` | `a\\|b` |\n| --- | --- |\n| c | d |'
    const host = renderToDom(md, src)
    expect(host.querySelector('span[data-vsidian-embed-inner]')).toBeNull()
    // markdown-it 表格 tokenizer 切格时无差别解码 \\|（不感知 code span），
    // code span 内容按渲染文字呈现 `a|b`——既有行为，本票不改变
    expect(host.textContent).toContain('a|b')
  })

  it('格内多引用按源顺序产占位（混排 + 转义别名并存）', () => {
    const md = createMarkdownRenderer()
    const src = '| 一 ![[甲]] 二 ![[乙\\|e]] |\n| --- |\n| c |'
    const host = renderToDom(md, src)
    const slots = host.querySelectorAll('span[data-vsidian-embed-inner]')
    expect(Array.from(slots).map((s) => s.getAttribute('data-vsidian-embed-inner'))).toEqual(['甲', '乙|e'])
  })

  it('跨格伪形态不产占位（开闭标记跨 cell 边界）', () => {
    const md = createMarkdownRenderer()
    const src = '| a ![[x | y]] b |\n| --- | --- |\n| c | d |'
    const host = renderToDom(md, src)
    expect(host.querySelector('span[data-vsidian-embed-inner]')).toBeNull()
  })
})

// #336（P3-04）图片嵌入渲染：`![[图.png]]` 在 Reading 侧按 `![](图.png)`
// 同源呈现——inline 规则对图片目标直接产出 <img>（src = 目标原文、alt =
// 别名），不产嵌入占位 span。后续管线（prepareReadingImages 剥离 src 绑
// 定资源管理器、decorateImageChromeBlock 包 frame 挂按钮）与普通图片完
// 全同路径，两侧呈现由构造保证一致。
describe('#336 图片嵌入：inline 规则产出 img（与普通 Markdown 图片同源）', () => {
  const md = createMarkdownRenderer()

  it('图片目标嵌入渲染为 img：src 为目标原文（未编码），不产占位 span', () => {
    const host = renderToDom(md, '前文 ![[assets/图 片.png]] 后文\n')
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('assets/图 片.png')
    expect(img!.getAttribute('alt')).toBe('')
    expect(host.querySelector('span[data-vsidian-embed-inner]')).toBeNull()
  })

  it('别名即 alt：![[图.png|说明文字]] 的 alt 取别名', () => {
    const host = renderToDom(md, '![[图.png|一段 说明]]\n')
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('图.png')
    expect(img!.getAttribute('alt')).toBe('一段 说明')
  })

  it('锚点形态的图片目标同样渲染为 img（图片无锚点语义，与宿主分派一致）', () => {
    const host = renderToDom(md, '![[图.png#任意锚]]\n')
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('图.png')
  })

  it('属性值经 HTML 转义（src/alt 注入安全）', () => {
    const host = renderToDom(md, '![[a"&b.png|标<签>]]\n')
    const img = host.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('a"&b.png')
    expect(img!.getAttribute('alt')).toBe('标<签>')
  })

  it('markdown 嵌入不受影响：![[笔记]] 仍产占位 span（卡片路径）', () => {
    const host = renderToDom(md, '![[目标笔记]]\n')
    expect(host.querySelector('img')).toBeNull()
    const slot = host.querySelector<HTMLElement>('span[data-vsidian-embed-inner]')
    expect(slot?.dataset['vsidianEmbedInner']).toBe('目标笔记')
  })

  it('未受支持扩展名（tif/heic/md/无扩展名）仍走嵌入占位路径', () => {
    for (const inner of ['照片.tif', '照片.heic', '笔记.md', '笔记']) {
      const host = renderToDom(md, `![[${inner}]]\n`)
      expect(host.querySelector('img'), inner).toBeNull()
      expect(host.querySelector('span[data-vsidian-embed-inner]'), inner).not.toBeNull()
    }
  })
})
