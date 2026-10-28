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

describe('阅读 callout：T03 全类型/别名/富标题/嵌套组合', () => {
  it('13 规范类型逐类型发射 data-callout（全量矩阵）', () => {
    for (const type of [
      'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote',
    ]) {
      const html = renderBlock(`> [!${type}] 标题\n> 正文`)
      expect(html, type).toContain(`data-callout="${type}"`)
    }
  })

  it('14 别名照常成型，data-callout 保留原标识（别名不改写源文）', () => {
    for (const alias of [
      'summary', 'tldr', 'hint', 'important', 'check', 'done', 'help',
      'faq', 'caution', 'attention', 'fail', 'missing', 'error', 'cite',
    ]) {
      const html = renderBlock(`> [!${alias}] 标题\n> 正文`)
      expect(html, alias).toContain(`data-callout="${alias}"`)
    }
    expect(renderBlock('> [!IMPORTANT] 大写\n> 正文')).toContain('data-callout="important"')
  })

  it('富标题：粗体/斜体/高亮/删除线/行内代码经既有行内渲染（复用净化链）', () => {
    const html = renderBlock('> [!tip] **粗** 与 *斜* 与 ==高== 与 ~~删~~ 与 `码`')
    expect(html).toMatch(/<strong>粗<\/strong>/)
    expect(html).toMatch(/<em>斜<\/em>/)
    expect(html).toMatch(/<mark[^>]*>高<\/mark>/)
    expect(html).toMatch(/<s>删<\/s>/)
    expect(html).toMatch(/<code>码<\/code>/)
  })

  it('富标题链接经既有行内渲染（href 进 title-inner；点击语义归挂载层既有规则）', () => {
    const html = renderBlock('> [!info] 见 [文档](https://example.com) 说明')
    expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*>文档<\/a>/)
  })

  it('富标题净化：行内 HTML 经既有净化链（危险属性剥除，不新增放行面）', () => {
    const html = renderBlock('> [!warning] 标题 <img src=x onerror=alert(1)>')
    // 标题行内 HTML 走既有净化（#568 行内混排管线）：事件属性被剥、元素
    // 保留——callout 标题不另开字面通道也不放宽净化
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('alert(1)')
    expect(html).toContain('src="x"')
  })

  it('无显式标题：别名与全类型默认标题按原标识派生', () => {
    expect(renderBlock('> [!tldr]')).toMatch(/<div class="callout-title-inner">Tldr<\/div>/)
    expect(renderBlock('> [!faq]')).toMatch(/<div class="callout-title-inner">Faq<\/div>/)
    expect(renderBlock('> [!important]')).toMatch(/<div class="callout-title-inner">Important<\/div>/)
    for (const type of ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote']) {
      expect(renderBlock(`> [!${type}]`)).toMatch(new RegExp(`<div class="callout-title-inner">${type.charAt(0).toUpperCase() + type.slice(1)}</div>`))
    }
  })

  it('三层嵌套：内层严格容器嵌于外层 content（.callout .callout .callout 可达）', () => {
    const html = renderBlock(['> [!note] 外层', '> > [!tip] 中层', '> > > [!warning] 内层', '> > > 内层正文', '> > 中层正文', '> 外层正文'].join('\n'))
    expect(html).toContain('data-callout="note"')
    expect(html).toContain('data-callout="tip"')
    expect(html).toContain('data-callout="warning"')
    // 深度嵌套顺序：note 容器开标签最先、warning 最内
    const i1 = html.indexOf('data-callout="note"')
    const i2 = html.indexOf('data-callout="tip"')
    const i3 = html.indexOf('data-callout="warning"')
    expect(i1).toBeLessThan(i2)
    expect(i2).toBeLessThan(i3)
  })

  it('普通引用内 callout（F39）：外层保持 blockquote、内层成 callout', () => {
    const html = renderBlock(['> 外层普通引用首段', '> > [!bug] 内层 callout', '> > 内层正文'].join('\n'))
    expect(html).toContain('<blockquote')
    expect(html).toContain('data-callout="bug"')
    // 内层 callout 位于外层 blockquote 之内
    expect(html.indexOf('<blockquote')).toBeLessThan(html.indexOf('data-callout="bug"'))
  })

  it('列表内 callout（F40）：列表结构保留、callout 容器在列表项内', () => {
    const doc = ['- 前置条目', '- > [!info] 列表内标题', '  > 列表内正文', '- 后置条目'].join('\n')
    const blocks = splitReadingBlocks(doc)
    const list = blocks.find((b) => b.kind === 'list')
    expect(list, '列表块在场').toBeDefined()
    expect(list!.html).toContain('data-callout="info"')
    expect(list!.html).toContain('>前置条目</li>')
    expect(list!.html).toContain('>后置条目</li>')
  })

  it('callout 内表格：GFM 表格原管线渲染（网格不放宽降级规则）', () => {
    const html = renderBlock(['> [!success] 表格', '> | a | b |', '> | - | - |', '> | 1 | 2 |'].join('\n'))
    expect(html).toContain('data-callout="success"')
    expect(html).toMatch(/<table>/)
    expect(html).toContain('<th>a</th>')
    // 表格前缀残缺仍降级（既有契约不因 callout 放宽）
    const broken = renderBlock(['> [!success] 残表', '> | a | b |', '> 缺分隔行'].join('\n'))
    expect(broken).not.toMatch(/<table>/)
  })

  it('callout 内代码块：围栏卡片管线照常（代码内伪标记字面）', () => {
    const html = renderBlock(['> [!example] 示例', '> ```js', '> const x = 1', '> ```'].join('\n'))
    expect(html).toContain('data-callout="example"')
    expect(html).toMatch(/<pre><code[^>]*>|<div class="[^"]*code/)
    const pseudo = renderBlock(['> [!note] 标题', '> ```md', '> [!tip] 伪标记', '> ```'].join('\n'))
    expect(pseudo).toContain('[!tip] 伪标记')
  })

  it('嵌套普通引用保持紫条语义（callout 内引用仍为 blockquote，不叠 callout）', () => {
    const html = renderBlock(['> [!quote] 引用型', '> > 内层普通引用'].join('\n'))
    expect(html).toContain('data-callout="quote"')
    expect(html).toContain('<blockquote')
  })
})
