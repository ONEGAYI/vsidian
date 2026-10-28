// @vitest-environment jsdom
// 阅读 Callout 渲染契约（#653/T02）：markdown-it token 变换器发射真实
// `.callout` 容器家族（div.callout[data-callout] > div.callout-title
// (.callout-icon + .callout-title-inner) + div.callout-content——Obsidian
// 阅读侧 DOM 结构，T01 取证 obsidian-1144-callout-defaults.json）。识别
// 与 Live 侧共用 shared/calloutSyntax（不复制类型表/规则）；严格父子
// 容器选择器仅在阅读侧承诺（T01 §6.1 矩阵）。
// 源锚点契约：块 start/end 与 li/任务标记锚点不因变换漂移。
import { describe, it, expect } from 'vitest'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'

function renderBlock(doc: string): string {
  const blocks = splitReadingBlocks(doc)
  const quote = blocks.find((b) => b.kind === 'blockquote')
  expect(quote, `应存在 blockquote 块: ${JSON.stringify(blocks.map((b) => b.kind))}`).toBeDefined()
  return quote!.html
}

describe('阅读 callout：容器结构发射', () => {
  it('基本成型：div.callout[data-callout] > title(icon + inner) + content，正文在 content 内', () => {
    const html = renderBlock(['> [!note] 标题文字', '> 正文段落'].join('\n'))
    expect(html).toContain('<div class="callout" data-callout="note">')
    expect(html).toMatch(/<div class="callout-title">/)
    expect(html).toMatch(/<div class="callout-icon"><\/div>/)
    expect(html).toMatch(/<div class="callout-title-inner">标题文字<\/div>/)
    expect(html).toMatch(/<div class="callout-content">/)
    expect(html).toContain('<p>正文段落</p>')
    // content 之内才是正文（顺序：title 先于 content）
    expect(html.indexOf('callout-title-inner')).toBeLessThan(html.indexOf('callout-content'))
    expect(html.indexOf('正文段落')).toBeGreaterThan(html.indexOf('callout-content'))
  })

  it('块源锚点不因变换漂移（start/end 仍覆盖引用区间）', () => {
    const doc = ['> [!note] 标题文字', '> 正文段落', '', '后续段落'].join('\n')
    const blocks = splitReadingBlocks(doc)
    const quote = blocks.find((b) => b.kind === 'blockquote')!
    expect(doc.slice(quote.start, quote.end)).toBe('> [!note] 标题文字\n> 正文段落')
  })

  it('无显式标题：title-inner 呈现默认标题（源文派生，不写回源文）', () => {
    const html = renderBlock(['> [!note]', '> 正文'].join('\n'))
    expect(html).toMatch(/<div class="callout-title-inner">Note<\/div>/)
    const unknown = renderBlock(['> [!custom-x]'].join('\n'))
    expect(unknown).toMatch(/<div class="callout-title-inner">Custom x<\/div>/)
  })

  it('仅标题形态：content 仍发射（Obsidian 形态）但不含空段落', () => {
    const html = renderBlock(['> [!note] 提示一下'].join('\n'))
    expect(html).toContain('callout-content')
    expect(html).not.toContain('<p>')
  })

  it('标题行内格式经既有行内渲染（F26：行内代码）', () => {
    const html = renderBlock(['> [!note] 用 `code` 说明'].join('\n'))
    expect(html).toMatch(/<div class="callout-title-inner">用 <code>code<\/code> 说明<\/div>/)
  })

  it('fold 符号解析不进标题（本票不发射折叠箭头，T04 接入）', () => {
    const html = renderBlock(['> [!note]+ 可折叠', '> 正文'].join('\n'))
    expect(html).toContain('data-callout="note"')
    expect(html).toMatch(/<div class="callout-title-inner">可折叠<\/div>/)
    expect(html).not.toContain('callout-fold')
  })

  it('未知类型原标识进 data-callout（回落 note 外观由 CSS 承载）', () => {
    const html = renderBlock(['> [!Custom-Question] 自定义'].join('\n'))
    expect(html).toContain('data-callout="custom-question"')
  })

  it('lazy 续行并入正文（F01：无空行两行同段——标题行剩余进 content）', () => {
    const html = renderBlock(['> [!note] 标题', '> 正文行'].join('\n'))
    expect(html).toMatch(/<div class="callout-title-inner">标题<\/div>/)
    expect(html).toContain('<p>正文行</p>')
  })

  it('空行分段（F29）：标题行与正文分属两段，均在容器内', () => {
    const html = renderBlock(['> [!note] 标题', '>', '> 正文'].join('\n'))
    expect(html).toContain('<p>正文</p>')
    expect(html).not.toContain('<p>标题')
  })

  it('后续段落伪标记不升级（F11）：第二段的 [!tip] 按正文文字', () => {
    const html = renderBlock(['> [!note] 标题', '>', '> [!tip] 第二段的伪标记按正文'].join('\n'))
    expect(html).toContain('data-callout="note"')
    expect(html).not.toContain('data-callout="tip"')
    expect(html).toContain('[!tip] 第二段的伪标记按正文')
  })

  it('未成型矩阵：普通 blockquote 渲染（无 callout 结构、标记字面可见）', () => {
    for (const bad of [
      ['> [!] 空类型', '> 正文'].join('\n'),
      ['> [!note extra] 非法'].join('\n'),
      ['> [!note]-标题紧贴'].join('\n'),
      ['> 普通引用', '> [!note] 后段标记不升级'].join('\n'),
    ]) {
      const html = renderBlock(bad)
      expect(html, bad).not.toContain('class="callout"')
      expect(html, bad).toContain('<blockquote')
    }
    const escaped = renderBlock(['> \\[!note\\] 转义非 callout', '> 正文'].join('\n'))
    expect(escaped).toContain('<blockquote')
    expect(escaped).not.toContain('class="callout"')
  })

  it('代码内伪标记不识别：围栏内 [!tip] 字面保留（F25）', () => {
    const html = renderBlock(['> [!note] 标题', '> ```md', '> [!tip] 代码里的伪标记', '> ```'].join('\n'))
    expect(html).toContain('data-callout="note"')
    expect(html).toContain('[!tip] 代码里的伪标记')
  })

  it('嵌套 callout：外层 content 内含内层严格容器（.callout .callout 选择器可达）', () => {
    const html = renderBlock(['> [!note] 外层', '> > [!tip] 内层', '> > 内层正文', '> 外层正文'].join('\n'))
    expect(html).toContain('data-callout="note"')
    // 内层 div.callout[data-callout=tip] 在外层 content 内
    const outer = html.indexOf('data-callout="note"')
    const inner = html.indexOf('data-callout="tip"')
    expect(inner).toBeGreaterThan(outer)
    expect(html).toMatch(/<div class="callout" data-callout="tip">/)
  })

  it('callout 内普通引用保留 blockquote 标签与紫条语义（F19）', () => {
    const html = renderBlock(['> [!note] 标题', '> > 内层普通引用', '> 正文'].join('\n'))
    expect(html).toContain('data-callout="note"')
    expect(html).toContain('<blockquote')
    expect(html).toContain('内层普通引用')
  })

  it('callout 内任务列表：li 锚点与 checkbox 语义保留（源锚点不漂移）', () => {
    const doc = ['> [!note] 待办', '> - [ ] 未完成', '> - [x] 已完成'].join('\n')
    const html = renderBlock(doc)
    expect(html).toMatch(/<li data-vsidian-src-start="\d+" data-vsidian-src-end="\d+">/)
    // 任务转换（checkbox）由挂载层 convertTaskItems 处理——切块产物保留
    // `[ ] ` 文本供其定位
    expect(html).toContain('[ ] 未完成')
  })

  it('frontmatter 内伪标记不识别（F33）', () => {
    const doc = ['---', '[!note] frontmatter 伪标记', '---', '正文'].join('\n')
    const blocks = splitReadingBlocks(doc)
    expect(blocks[0]!.kind).toBe('frontmatter')
    expect(blocks.some((b) => b.html.includes('class="callout"'))).toBe(false)
  })

  it('普通引用（无声明）不受影响：仍为 blockquote', () => {
    const html = renderBlock(['> 普通引用一', '> 普通引用二'].join('\n'))
    expect(html).toContain('<blockquote')
    expect(html).not.toContain('callout')
  })
})
