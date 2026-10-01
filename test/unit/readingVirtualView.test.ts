// @vitest-environment jsdom
// 阅读视图按需挂载的 DOM 层契约（工单 #7）：
// - 布局可用时虚拟化：只挂载窗口内块，屏外块以上下 spacer 占位（布局信息
//   占位，非内容节点）；挂载是真实按需创建（不是整篇渲染后隐藏）
// - 滚动不重复解析：setDocument 一次全文切块，任意次滚动 parseCount 不增
// - 回收：离开窗口的块节点移除；保留块不重建（元素身份稳定）
// - 挂载后回填实测高度（占位估计 → 实测），回收块保留最后实测值
// - 源 offset 映射与滚动定位基于块模型（目标块可在屏外，不依赖其已挂载）
// - 无布局（jsdom 隐藏容器 clientHeight=0）回退全量渲染路径
//
// 布局桩：jsdom 无排版——offsetHeight 经原型 getter 桩为定值（两种档位：
// 与估计一致 36px / 大于估计 40px），clientHeight 经实例属性桩为 400。
// 视觉布局的真实行为（spacer 稳定性、图片尺寸变化）在集成宿主验证。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VirtualReadingView } from '../../src/webview/readingVirtualView'
import { createReadingContainer, READING_CLASS_NAMES } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { computeMountWindow } from '../../src/webview/readingViewport'

describe('阅读查找：源区间映射到可见文字', () => {
  it('隐藏的表格分隔符以只读源码行显形，当前命中精确标记，清除与销毁释放浮层', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      view.setDocument('| name | state |\n| --- | --- |\n| build | ok |\n\nbelow')
      view.highlightMatches([{ from: 0, to: 1 }, { from: 7, to: 8 }], 0)
      const popup = root.querySelector('.vsidian-reading-find-source')
      expect(popup).not.toBeNull()
      expect(popup?.querySelector('code')?.textContent).toBe('| name | state |')
      expect(popup?.querySelector('.vsidian-find-match-current')?.textContent).toBe('|')
      expect(container.contains(popup)).toBe(false)
      expect(popup?.querySelector('input, textarea, [contenteditable]')).toBeNull()
      view.highlightMatches([{ from: 0, to: 1 }, { from: 7, to: 8 }], 1)
      expect(root.querySelectorAll('.vsidian-reading-find-source')).toHaveLength(1)
      expect(root.querySelector('.vsidian-find-match-current')?.getAttribute('data-vsidian-find-index')).toBe('1')
      view.highlightMatches([], 0)
      expect(root.querySelector('.vsidian-reading-find-source')).toBeNull()
      view.highlightMatches([{ from: 0, to: 1 }], 0)
      view.dispose()
      expect(root.querySelector('.vsidian-reading-find-source')).toBeNull()
    } finally {
      view.dispose()
      root.remove()
    }
  })

  function setupFind(text: string, word: string, index = 0) {
    const container = createReadingContainer()
    const view = new VirtualReadingView(container)
    view.setDocument(text)
    const matches = Array.from(text.matchAll(new RegExp(word, 'g')), m => ({ from: m.index, to: m.index + m[0].length }))
    view.highlightMatches(matches, index)
    return { container, view, matches }
  }

  it('围栏语言名与正文相同时，隐藏 info 不得挪用可见代码作高亮', () => {
    const { container, view, matches } = setupFind('```js\njs\n```', 'js')
    expect(container.querySelector('.vsidian-find-match-current')).toBeNull()
    view.highlightMatches(matches, 1)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('js')
    view.dispose()
  })

  it('长代码块后续分片的字面围栏仍按代码正文高亮', () => {
    const text = '````js\n' + Array(59).fill('plain').join('\n') + '\n```\nhit\n````'
    const { container, view } = setupFind(text, '```', 1)
    expect(container.querySelector('pre[data-vsidian-code-start="59"] .vsidian-find-match-current')?.textContent).toBe('```')
    view.dispose()
  })

  it('降级 frontmatter 的可见源码参与精确高亮，成型头区仍不染合成文字', () => {
    const { container, view } = setupFind('---\nnested:\n  child: hit\n---\n\nvisible', 'hit')
    expect(container.querySelector('pre .vsidian-find-match-current')?.textContent).toBe('hit')
    view.dispose()
    const formed = setupFind('---\ntitle: hit\n---\n\nvisible', 'hit')
    expect(formed.container.querySelector('.vsidian-find-match')).toBeNull()
    formed.view.dispose()
  })

  it('未解析的引用式链接仍是可见原文，不得导致后续普通文字映射失败', () => {
    const { container, view } = setupFind('[foo][missing] hit', 'hit')
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
    view.dispose()
  })

  it('拒绝的引用定义按可见原文高亮，同名合法定义不能替它显形', () => {
    for (const text of ['[ref]: javascript:alert(hit)', '[ref]: note.md\n\n[ref]: javascript:alert(hit)']) {
      const { container, view } = setupFind(text, 'hit')
      expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
      view.dispose()
    }
  })

  it('同名已解析/未解析引用并存，全文定义与归一化不能靠 DOM 链接文字猜测', () => {
    const { container, view, matches } = setupFind('[foo][ref] [foo][missing] hit\n\n[REF]: note.md', 'foo')
    expect(container.querySelector('a .vsidian-find-match-current')?.textContent).toBe('foo')
    view.highlightMatches(matches, 1)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('foo')
    expect(container.querySelector('a .vsidian-find-match-current')).toBeNull()
    view.dispose()
    const collapsed = setupFind('[foo][] [foo] hit\n\n[FOO]: note.md', 'foo')
    expect(collapsed.container.querySelectorAll('a .vsidian-find-match')).toHaveLength(2)
    collapsed.view.dispose()
  })

  it('已解析 shortcut 引用的隐藏括号不得冒充后面的可见括号', () => {
    const { container, view, matches } = setupFind('[foo]] hit\n\n[foo]: hit.md', '\\]')
    expect(container.querySelector('.vsidian-find-match-current')).toBeNull()
    view.highlightMatches(matches, 1)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe(']')
    view.dispose()
  })

  it('部分隐藏的匹配显示完整源码；普通文字命中不保留浮层', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      view.setDocument('**hit** and tail')
      view.highlightMatches([{ from: 0, to: 7 }], 0)
      expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
      expect(root.querySelector('.vsidian-reading-find-source .vsidian-find-match-current')?.textContent).toBe('**hit**')
      view.highlightMatches([{ from: 2, to: 5 }], 0)
      expect(root.querySelector('.vsidian-reading-find-source')).toBeNull()
    } finally { view.dispose(); root.remove() }
  })

  it('转义后的可见表格竖线直接高亮，不把正文字符当成隐藏分隔符', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      const text = '| A | B |\n| --- | --- |\n| \\| | keep |'
      const from = text.indexOf('\\|') + 1
      view.setDocument(text)
      view.highlightMatches([{ from, to: from + 1 }], 0)
      expect(container.querySelector('td .vsidian-find-match-current')?.textContent).toBe('|')
      expect(root.querySelector('.vsidian-reading-find-source')).toBeNull()
    } finally { view.dispose(); root.remove() }
  })

  it('源码浮层仅写入文本，隐藏注释内的 HTML 不生成元素或可执行属性', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      const text = 'visible <!-- <img src=x onerror=alert(1)> hidden --> tail'
      const from = text.indexOf('hidden')
      view.setDocument(text)
      view.highlightMatches([{ from, to: from + 6 }], 0)
      const popup = root.querySelector('.vsidian-reading-find-source')
      expect(popup?.querySelector('code')?.textContent).toBe(text)
      expect(popup?.querySelector('img, script, [onerror]')).toBeNull()
      expect(popup?.querySelector('.vsidian-find-match-current')?.textContent).toBe('hidden')
    } finally { view.dispose(); root.remove() }
  })

  it('长源码行的反馈有界，emoji 不因截断变成半个代理对', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      const text = `visible <!-- ${'😀'.repeat(501)}hidden${'😀'.repeat(501)} --> tail`
      const from = text.indexOf('hidden')
      view.setDocument(text)
      view.highlightMatches([{ from, to: from + 6 }], 0)
      const code = root.querySelector('.vsidian-reading-find-source code')?.textContent ?? ''
      expect(code.length).toBeLessThanOrEqual(328)
      expect(code).toContain('hidden')
      expect(code).toMatch(/^\.\.\./)
      expect(code).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
    } finally { view.dispose(); root.remove() }
  })

  it('整篇只有隐藏注释时仍提供源码命中反馈，不依赖可见块存在', () => {
    const root = document.createElement('div')
    root.id = 'app'
    const container = createReadingContainer()
    root.append(container)
    document.body.append(root)
    const view = new VirtualReadingView(container)
    try {
      view.setDocument('<!-- hidden -->')
      view.highlightMatches([{ from: 5, to: 11 }], 0)
      expect(container.querySelector('.vsidian-reading-block')).toBeNull()
      expect(root.querySelector('.vsidian-reading-find-source code')?.textContent).toBe('<!-- hidden -->')
      expect(root.querySelector('.vsidian-reading-find-source .vsidian-find-match-current')?.textContent).toBe('hidden')
    } finally { view.dispose(); root.remove() }
  })

  it('callout 只标记命中文字，全部命中与当前命中区分；导航不嵌套包裹', () => {
    const { container, view, matches } = setupFind('> [!note] Title\n> alpha hit\n> **hit** beta', 'hit')
    expect(Array.from(container.querySelectorAll('.vsidian-find-match'), el => el.textContent)).toEqual(['hit', 'hit'])
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
    view.highlightMatches(matches, 1)
    expect(container.querySelector('strong .vsidian-find-match-current')?.textContent).toBe('hit')
    expect(container.querySelector('.vsidian-find-match .vsidian-find-match')).toBeNull()
    view.highlightMatches([], 0)
    expect(container.querySelector('.vsidian-find-match')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('hit')
    view.dispose()
  })

  it('隐藏的链接目标、双链目标、图片 alt 与公式不得误标相同的可见文字', () => {
    const text = '[link](hit.md) hit [[hit|alias]] hit ![hit](hit.png) $hit$ hit'
    const { container, view, matches } = setupFind(text, 'hit', 0)
    expect(Array.from(container.querySelectorAll('.vsidian-find-match'), el => el.textContent)).toEqual(['hit', 'hit', 'hit'])
    expect(container.querySelector('.vsidian-find-match-current')).toBeNull()
    view.highlightMatches(matches, 1)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
    expect(container.querySelector('a .vsidian-find-match')).toBeNull()
    expect(container.querySelector('.katex .vsidian-find-match')).toBeNull()
    view.dispose()
  })

  it('跨行内标记的源码匹配只包裹可见部分，保留链接与强调元素身份', () => {
    const text = 'left **hit** [alias](note.md) right'
    const { container, view } = setupFind(text, 'left \\*\\*hit\\*\\* \\[alias\\]')
    expect(Array.from(container.querySelectorAll('.vsidian-find-match'), el => el.textContent).join('')).toBe('left hit alias')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('note.md')
    view.dispose()
  })

  it('列表、表格与代码内命中精确落在正文，emoji 不拆分代理对', () => {
    const text = '- [x] hit\n\n| key | value |\n| --- | --- |\n| hit | `hit` |\n\n```js\nconst hit = "😀";\n```'
    const { container, view } = setupFind(text, 'hit')
    expect(container.querySelectorAll('.vsidian-find-match')).toHaveLength(4)
    expect(container.querySelector('input[type=checkbox]')).toBeTruthy()
    const from = text.indexOf('😀')
    view.highlightMatches([{ from, to: from + 2 }], 0)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('😀')
    view.dispose()
  })

  it('HTML 实体的源码区间指向解码后的字符，隐藏注释里的命中不串位', () => {
    const text = '&amp; <!-- hit --> hit'
    const { container, view } = setupFind(text, 'hit')
    expect(container.querySelectorAll('.vsidian-find-match')).toHaveLength(1)
    expect(container.querySelector('.vsidian-find-match-current')).toBeNull()
    view.highlightMatches([{ from: 0, to: 5 }], 0)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('&')
    view.dispose()
  })

  it('虚拟窗口重挂载后恢复文字高亮，导航与清除不重解析全文', () => {
    const text = Array.from({ length: 100 }, (_, i) => `hit ${i}`).join('\n\n')
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 100 })
    view.setDocument(text)
    const matches = Array.from(text.matchAll(/hit/g), m => ({ from: m.index, to: m.index + 3 }))
    view.highlightMatches(matches, 50)
    view.scrollToOffset(matches[50]!.from)
    expect(container.querySelector('.vsidian-find-match-current')?.textContent).toBe('hit')
    view.scrollToOffset(0)
    view.scrollToOffset(matches[50]!.from)
    expect(container.querySelectorAll('.vsidian-find-match-current')).toHaveLength(1)
    expect(view.getStats().parseCount).toBe(1)
    view.dispose()
  })
})

/** 生成 n 个单行段落块（空行分隔） */
function makeDoc(n: number): string {
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      lines.push('')
    }
    lines.push(`第 ${i} 段普通文本内容`)
  }
  return lines.join('\n') + '\n'
}

/** 把容器 clientHeight 桩为指定值（0 = 无布局回退） */
function stubClientHeight(container: HTMLElement, h: number): void {
  Object.defineProperty(container, 'clientHeight', { value: h, configurable: true })
}

function mountedStarts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`)).map(
    (el) => el.dataset['vsidianSrcStart'] ?? '',
  )
}

describe('VirtualReadingView：按需挂载与占位', () => {
  let heightSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  })
  afterEach(() => {
    heightSpy.mockRestore()
  })

  it('布局可用：只挂载窗口内块，上下 spacer 占位屏外高度', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const stats = view.getStats()
    expect(stats.virtualized).toBe(true)
    expect(stats.totalBlocks).toBe(100)
    // 窗口 [0,1000)，单行段落估计 24+12=36px → 块 0..27（28 块）
    expect(stats.mountedBlocks).toBe(28)
    // 容器结构：spacerTop + 窗口块 + spacerBottom（屏外块无内容节点）
    const children = Array.from(container.children)
    expect(children).toHaveLength(28 + 2)
    expect(children[0]!.classList.contains(READING_CLASS_NAMES.spacerTop)).toBe(true)
    expect(children[children.length - 1]!.classList.contains(READING_CLASS_NAMES.spacerBottom)).toBe(true)
    // 顶部 spacer 高度为 0；底部 spacer = 屏外总高估计（72 块 × 36px）
    expect((children[0]! as HTMLElement).style.height).toBe('0px')
    const bottomPx = Number.parseFloat((children[children.length - 1]! as HTMLElement).style.height)
    expect(bottomPx).toBe(72 * 36)
    // 挂载块带源锚点且按块序排列
    const blocks = splitReadingBlocks(text)
    expect(mountedStarts(container)).toEqual(
      blocks.slice(0, 28).map((b) => String(b.start)),
    )
  })

  it('挂载是真实按需创建：屏外块不出现在 DOM（非隐藏整篇）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    expect(container.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length).toBe(28)
    // 屏外块既无内容节点也无 display:none 的隐藏副本
    expect(container.children.length).toBe(30)
  })

  it('滚动后重挂窗口：旧窗口外块回收、新进入块创建，解析次数不增', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const firstElements = Array.from(
      container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`),
    )
    container.scrollTop = 2000
    view.updateNow()
    // 36px × 100 块：scrollTop 2000 → 窗口 [1400,3000) → 块 38..83（46 块）
    const blocks = splitReadingBlocks(text)
    const expected = computeMountWindow(Array.from({ length: 100 }, () => 36), 2000, 400, 600)!
    expect(mountedStarts(container)).toEqual(
      blocks.slice(expected.first, expected.last + 1).map((b) => String(b.start)),
    )
    // 旧窗口内仍在新窗口的块（38..24 无交集——本次窗口整体平移）……
    // 窗口 [0,24] 与 [38,83] 不相交：首屏元素应全部被回收
    for (const el of firstElements) {
      expect(container.contains(el)).toBe(false)
    }
    expect(container.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length).toBe(
      expected.last - expected.first + 1,
    )
    // 滚动不重复解析（解析与挂载分离的核心断言）
    expect(view.getStats().parseCount).toBe(1)
    container.scrollTop = 800
    view.updateNow()
    container.scrollTop = 3000
    view.updateNow()
    expect(view.getStats().parseCount).toBe(1)
  })

  it('窗口重叠平移：保留块元素身份稳定（不重建）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const before = Array.from(
      container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`),
    )
    container.scrollTop = 500 // 窗口 [0,1500) → 块 0..41：重叠扩展
    view.updateNow()
    const after = Array.from(
      container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`),
    )
    // 旧窗口块 0..24 全部保留（元素身份不变），新挂载块 25..41
    for (const el of before) {
      expect(after).toContain(el)
    }
    expect(after.length).toBe(42)
  })

  it('挂载后回填实测高度并重估未测块：spacer 按实测收敛（估计 36 → 实测 40）', () => {
    heightSpy.mockReturnValue(40)
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    // 窗口按估计 36 计算（块 0..27）；实测外高 40 → 标定行高 (40-12)/1=28
    // → 漂移 >2% 触发未测块重估（1×28+12=40）→ 底部 spacer = 72 块 × 40
    const children = Array.from(container.children)
    expect((children[children.length - 1]! as HTMLElement).style.height).toBe(`${72 * 40}px`)
    expect(view.getStats().mountedBlocks).toBe(28)
  })

  it('回收块保留最后实测高度（估计不再回退）', () => {
    heightSpy.mockReturnValue(40)
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    // 首屏块 0..27 实测 40；滚动到中部：已测块以 40 计入顶部 spacer，
    // 严格大于全估计（36）基线——实测回填在回收后仍保留
    container.scrollTop = 2000
    view.updateNow()
    const blocks = splitReadingBlocks(text)
    const spacerTop = container.querySelector<HTMLElement>(`.${READING_CLASS_NAMES.spacerTop}`)!
    const topPx = Number.parseFloat(spacerTop.style.height)
    const firstStart = mountedStarts(container)[0]!
    const firstIdx = blocks.findIndex((b) => String(b.start) === firstStart)
    expect(firstIdx).toBeGreaterThan(0)
    expect(topPx).toBeGreaterThan(firstIdx * 36)
  })

  it('无布局（clientHeight=0）：回退全量渲染，锚点语义与 #6 一致', () => {
    const text = makeDoc(50)
    const container = createReadingContainer()
    stubClientHeight(container, 0)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const stats = view.getStats()
    expect(stats.virtualized).toBe(false)
    expect(stats.mountedBlocks).toBe(50)
    expect(stats.parseCount).toBe(1)
    // 全量回退路径复用 #6 的 DOM 查询语义
    expect(view.anchorStartFor(text.length)).not.toBeNull()
    expect(view.currentAnchor()).toBe(Number(splitReadingBlocks(text)[0]!.start))
  })
})

describe('VirtualReadingView：源锚点定位（屏外目标）', () => {
  let heightSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  })
  afterEach(() => {
    heightSpy.mockRestore()
  })

  it('anchorStartFor 对屏外 offset 返回其块 start（基于块模型，不依赖 DOM）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    const far = blocks[90]!
    expect(view.anchorStartFor(far.start + 2)).toBe(far.start)
    // 缝隙 floor 语义
    expect(view.anchorStartFor(blocks[30]!.end + 1)).toBe(blocks[30]!.start)
  })

  it('scrollToSrcStart 滚动到屏外块估计位置并挂载该块', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    const target = blocks[90]!
    view.scrollToSrcStart(target.start)
    // 估计位置：36px/块 → scrollTop = 90×36
    expect(container.scrollTop).toBe(90 * 36)
    const starts = mountedStarts(container)
    expect(starts).toContain(String(target.start))
    // 目标块位于窗口内（可见 + 缓冲）
    const idx = starts.indexOf(String(target.start))
    expect(idx).toBeGreaterThan(0)
    expect(view.getStats().parseCount).toBe(1)
  })

  it('currentAnchor 返回视口顶相交块的源 start（模型版锚点）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    container.scrollTop = 36 * 10
    view.updateNow()
    expect(view.currentAnchor()).toBe(blocks[10]!.start)
  })

  it('scrollToOffset：offset → 锚点块 → 滚动（#10 查找跳转的定位链）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    view.scrollToOffset(blocks[70]!.start + 3)
    expect(view.currentAnchor()).toBe(blocks[70]!.start)
    expect(mountedStarts(container)).toContain(String(blocks[70]!.start))
  })
})

describe('VirtualReadingView：动态尺寸变化与生命周期', () => {
  let heightSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  })
  afterEach(() => {
    heightSpy.mockRestore()
  })

  it('图片尺寸变化：上方内容增高由滚动补偿，锚点块视觉位置稳定（#7 核心机制）', async () => {
    // offsetHeight 桩：含注入 img 的块按 img 高度叠加（模拟真实布局增长）
    heightSpy.mockImplementation(function (this: HTMLElement) {
      const img = this.querySelector?.('img') as HTMLElement | null
      const extra = img ? Number.parseFloat(img.style.height) || 0 : 0
      return 36 + extra
    })
    const text = makeDoc(400)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    const anchor = blocks[201]!
    view.scrollToSrcStart(anchor.start)
    const scrollTopBefore = container.scrollTop
    expect(view.currentAnchor()).toBe(anchor.start)
    // 图片注入到锚点上方 10 块：20px → 240px（延迟 20ms；jsdom 无 RO，
    // 由注入方调度的兜底 update 驱动实测与补偿）
    view.injectTestImage(blocks[191]!.start, 20, 240, 20)
    await new Promise((r) => setTimeout(r, 200)) // 尺寸变化 + rAF 窗口重算
    // 上方内容共增高 240px（初始 20 + 增长 220）：scrollTop 平移补偿同量，
    // 锚点块保持视口顶块——视觉位置不变（源位置锚点稳定的核心机制）
    expect(container.scrollTop).toBeCloseTo(scrollTopBefore + 240, 0)
    expect(view.currentAnchor()).toBe(anchor.start)
    expect(view.getStats().parseCount).toBe(1)
    view.dispose()
  })

  it('injectTestImage：向指定块注入空 src 图片元素（集成测试的尺寸变化载体）', () => {
    const text = makeDoc(100)
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(text)
    const blocks = splitReadingBlocks(text)
    view.injectTestImage(blocks[2]!.start, 20, 240, 60000)
    const img = container.querySelector<HTMLImageElement>(
      `.${READING_CLASS_NAMES.block} img`,
    )
    expect(img).not.toBeNull()
    expect(img!.style.height).toBe('20px')
    expect(img!.getAttribute('src')).toBe('') // 空 src：CSP 拦截加载，无网络请求
    expect(img!.style.display).toBe('block') // 块级替换元素：布局尺寸确定
    view.dispose()
  })

  it('setDocument 重入：文本变更后重建块模型（外部变更重建路径）', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(makeDoc(100))
    expect(view.getStats().parseCount).toBe(1)
    view.setDocument('新文本\n')
    expect(view.getStats().parseCount).toBe(2)
    expect(view.getStats().totalBlocks).toBe(1)
    expect(mountedStarts(container)).toHaveLength(1)
    view.dispose()
  })

  it('dispose 后容器清空且不再持有引用', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 400)
    const view = new VirtualReadingView(container, { bufferPx: 600 })
    view.setDocument(makeDoc(100))
    view.dispose()
    expect(container.children.length).toBe(0)
  })
})

describe('C-9：setDocument 重建时解除对旧挂载元素的观察', () => {
  it('清空挂载元素前逐个 unobserve，不留游离观察引用', () => {
    const observe = vi.fn()
    const unobserve = vi.fn()
    class StubObserver {
      observe = observe
      unobserve = unobserve
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', StubObserver)
    try {
      const heightSpy = vi
        .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
        .mockReturnValue(36)
      const container = createReadingContainer()
      stubClientHeight(container, 400)
      const view = new VirtualReadingView(container, { bufferPx: 600 })
      view.setDocument(makeDoc(100))
      const blockObservations = observe.mock.calls.filter(
        (args) => args[0] !== container,
      ).length
      expect(blockObservations).toBeGreaterThan(0)
      expect(unobserve.mock.calls.length).toBe(0)
      // 重建：旧挂载块元素必须先逐个解除观察（observer 对元素是强引用，
      // 直接丢弃会阻碍回收并可能触发对游离节点的回调）
      view.setDocument(makeDoc(50))
      expect(unobserve.mock.calls.length).toBe(blockObservations)
      heightSpy.mockRestore()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// #219 悬停局部预览：setDocument 的可选 range 过滤——切块在全文上做
// （保留全文解析上下文，不丢章节外引用式链接定义），范围选取在切块后按
// 块区间求交（跨界块整块保留，不孤立解析截取字符串）。range 为 LF 坐标
// （宿主 hoverDocAccess 经 NewlineCoordinator 换算后随载荷下发）。
describe('VirtualReadingView：局部范围装载（#219 悬停预览）', () => {
  const SECTION_TEXT = [
    '# 顶部标题',
    '',
    '顶部段。',
    '',
    '## 章节甲',
    '',
    '甲段一。',
    '',
    '- 列表项一',
    '- 列表项二',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '## 章节乙',
    '',
    '乙段。',
    '',
  ].join('\n')

  /** 块表对拍口径的章节范围：目标标题块行首 → 下一同级标题前最后一个
   *  内容块的行尾（与宿主 findHeadingSectionRange 的「末行行尾不含换行」
   *  同语义，测试不重算行界——直接消费块模型） */
  function sectionRangeOf(text: string, title: string): { start: number; end: number } {
    const blocks = splitReadingBlocks(text)
    const head = blocks.find((b) => b.kind === 'heading' && text.slice(b.start, b.end).includes(title))!
    const headIdx = blocks.indexOf(head)
    const nextIdx = blocks.findIndex(
      (b, i) => i > headIdx && b.kind === 'heading' && (b.level ?? 6) <= (head.level ?? 6),
    )
    const last = nextIdx > 0 ? blocks[nextIdx - 1]! : blocks[blocks.length - 1]!
    return { start: head.start, end: last.end }
  }

  it('无布局回退路径：range 过滤后只渲染章节内块（标题块起、下一同级标题块前）', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 0) // 无布局：全量渲染过滤后块
    const view = new VirtualReadingView(container)
    const range = sectionRangeOf(SECTION_TEXT, '章节甲')
    view.setDocument(SECTION_TEXT, { range })
    const blocks = splitReadingBlocks(SECTION_TEXT)
    const expected = blocks
      .slice(blocks.findIndex((b) => b.start === range.start), blocks.findIndex((b) => b.start > range.end))
      .map((b) => String(b.start))
    expect(expected.length).toBeGreaterThan(3)
    expect(mountedStarts(container)).toEqual(expected)
    expect(container.querySelector('.vsidian-reading-heading-2')?.textContent).toContain('章节甲')
    expect(container.textContent).not.toContain('顶部段')
    expect(container.textContent).not.toContain('乙段')
  })

  it('多行块整块保留：列表、表格、围栏不被截成首行', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 0)
    const view = new VirtualReadingView(container)
    const range = sectionRangeOf(SECTION_TEXT, '章节甲')
    view.setDocument(SECTION_TEXT, { range })
    const listEl = container.querySelector('.vsidian-reading-block ul, .vsidian-reading-block ol')
    expect(listEl?.querySelectorAll('li').length, '列表两项整取').toBe(2)
    const tableEl = container.querySelector('.vsidian-reading-block table')
    expect(tableEl?.querySelectorAll('tbody tr').length, '表格数据行整取').toBe(1)
    expect(tableEl?.querySelectorAll('thead th').length).toBe(2)
    const codeEl = container.querySelector('.vsidian-reading-block pre')
    expect(codeEl?.textContent, '围栏代码行整取（非仅首行）').toContain('const x = 1')
  })

  it('布局可用路径：虚拟化窗口基于过滤后块表（屏外 spacer 高度不含范围外块）', () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
    try {
      const container = createReadingContainer()
      stubClientHeight(container, 400)
      const view = new VirtualReadingView(container, { bufferPx: 100000 }) // 大缓冲挂全部窗口内块
      const range = sectionRangeOf(SECTION_TEXT, '章节甲')
      view.setDocument(SECTION_TEXT, { range })
      const stats = view.getStats()
      const blocks = splitReadingBlocks(SECTION_TEXT)
      const expectedCount = blocks.slice(
        blocks.findIndex((b) => b.start === range.start),
        blocks.findIndex((b) => b.start > range.end),
      ).length
      expect(stats.totalBlocks).toBe(expectedCount)
      expect(stats.virtualized).toBe(true)
      expect(mountedStarts(container).length).toBe(expectedCount)
    } finally {
      heightSpy.mockRestore()
    }
  })

  it('求交语义：与 range 部分交叠的块整块保留（不丢内容）', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 0)
    const view = new VirtualReadingView(container)
    const blocks = splitReadingBlocks(SECTION_TEXT)
    const listBlock = blocks.find((b) => b.kind === 'list')!
    // range 起点落在列表块内部（模拟宿主侧行界与 markdown-it 块界的
    // 罕见错位）：列表块与范围求交 → 整块保留
    const range = { start: listBlock.start + 3, end: listBlock.end }
    view.setDocument(SECTION_TEXT, { range })
    const starts = mountedStarts(container)
    expect(starts, '部分交叠的列表块整块保留').toContain(String(listBlock.start))
    expect(starts.length).toBe(1)
  })

  it('不带 range 的既有全文装载不受影响（缺省形态回归）', () => {
    const container = createReadingContainer()
    stubClientHeight(container, 0)
    const view = new VirtualReadingView(container)
    view.setDocument(SECTION_TEXT)
    expect(mountedStarts(container).length).toBe(splitReadingBlocks(SECTION_TEXT).length)
  })
})
