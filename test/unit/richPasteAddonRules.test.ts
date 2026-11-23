// @vitest-environment jsdom
// #541 T01 附加组件粘贴规则——控制器级消费链契约测试（生产控制器接缝）。
// 钉住票面验收：
// - 宿主广播快照被缓存（addonPasteRules.snapshot）；旧版本迟到快照不
//   回退已撤回的规则代次；
// - 富文本粘贴经规则转换（双载荷：HTML 载荷命中规则、plain 载荷参与
//   等值/撤销判定）；分步撤销的两笔编辑请求携带既有 text/format 阶段；
// - 转换结果等于 plain 时走既有一次撤销路径（规则不另建历史）；
// - 纯文本粘贴（总开关关闭/代码上下文）不经过规则。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { WebviewSyncController } from '../../src/webview/syncController'
import { mathBlocksField } from '../../src/webview/liveMath'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { WebviewToHost } from '../../src/shared/protocol'
import type { SettingsPayload } from '../../src/shared/settings'
import * as conversion from '../../src/webview/htmlToMarkdown'
import { prepareRichPaste } from '../../src/webview/richPastePlan'
import { docInput, markdownTreeParser } from '../../src/shared/markdownDoc'

if (!Range.prototype.getClientRects) { Range.prototype.getClientRects = () => [] as unknown as DOMRectList; Range.prototype.getBoundingClientRect = () => new DOMRect() }
let c: WebviewSyncController
afterEach(() => { c?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })
function mount(text = '旧内容', values: SettingsPayload = {}) {
  installLocale('zh-cn', zhCn)
  const sent: WebviewToHost[] = []
  c = new WebviewSyncController({ postMessage: (m) => sent.push(m as WebviewToHost), getState: () => undefined, setState: () => {} })
  const app = document.createElement('div'); app.id = 'app'; document.body.append(app)
  c.mount(app); c.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'file:///d/a.md', version: 1, text })
  c.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.pasteAskBefore': false, ...values } })
  const view = EditorView.findFromDOM(app.querySelector('.cm-editor')!)!
  view.focus(); view.dispatch({ selection: { anchor: 0, head: text.length } })
  return { app, view, sent }
}
function paste(view: EditorView, html: string, text?: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items: [], types: text === undefined ? ['text/html'] : ['text/html', 'text/plain'], getData: (type: string) => type === 'text/html' ? html : text ?? '' } })
  view.contentDOM.dispatchEvent(event)
  return event
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))
/** 应答在途编辑（宿主确认后暂缓的第二阶段才出站） */
function ack(sent: WebviewToHost[]) {
  const edit = [...sent].reverse().find((m) => m.kind === 'edit.request')
  if (edit?.kind !== 'edit.request') throw new Error('缺少编辑请求')
  c.handleHostMessage({ kind: 'edit.ack', seq: edit.seq, ok: true, version: 2 })
}

/** 来源特化形态规则（data-prompt-link-url span → Markdown 链接） */
const PROMPT_LINK_SNAPSHOT = (version: number) => ({
  version,
  rules: [{
    addonId: 'fixture.demo',
    id: 'prompt-link',
    priority: 0,
    match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
    output: {
      kind: 'template' as const,
      template: '[{{label}}]({{url}})',
      slots: {
        label: { source: { kind: 'text' as const } },
        url: { source: { kind: 'attribute' as const, name: 'data-prompt-link-url' }, url: true },
      },
    },
  }],
})

function pasteMath(view: EditorView, tex: string, plain: string, htmlPrefix = '', htmlSuffix = '') {
  const [link] = PROMPT_LINK_SNAPSHOT(1).rules
  c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: {
    version: 1, rules: [{ ...link!, match: { tag: 'SPAN' }, output: {
      kind: 'template', template: '{{tex}}', slots: { tex: { source: { kind: 'text' }, inlineMath: true } },
    } }],
  } })
  paste(view, `${htmlPrefix}<span><math><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>${htmlSuffix}`, plain)
}

function readingTexOf(source: string): (string | null)[] {
  return splitReadingBlocks(source).flatMap(block =>
    Array.from(createReadingBlockElement(block, source).querySelectorAll('annotation'), node => node.textContent?.trim() ?? null),
  )
}

function pasteDisplayMath(view: EditorView, tex: string, plain: string, prefix = '', suffix = '') {
  c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: { version: 1, rules: [{
    addonId: 'fixture.demo', id: 'display-math', priority: 0, match: { tag: 'SPAN' },
    output: { kind: 'template', template: '{{tex}}', slots: { tex: { source: { kind: 'text' }, blockMath: true } } },
  }] } })
  paste(view, prefix + `<span class="katex-display"><math display="block"><semantics><mi>q</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` + suffix, plain)
}

describe('粘贴规则控制器消费链', () => {
  it.each(['', '$$\n未闭合\n'])('段中粘贴块公式不破坏前后正文或未闭合块：%j', async (prefix) => {
    const { view, sent } = mount(prefix + '前文后文')
    const at = prefix.length + 2
    view.dispatch({ selection: { anchor: at } })
    const tex = String.raw`q = \underbrace{x}_{\text{空间}}`
    pasteDisplayMath(view, tex, 'q = x')
    await settle()
    const source = view.state.doc.toString()
    expect(source).toBe(prefix ? prefix + '前文q = x后文' : '前文\n\n$$\n' + tex + '\n$$\n\n后文')
    if (!prefix) expect(readingTexOf(source)).toEqual([tex])
    const first = sent.find(m => m.kind === 'edit.request')
    expect(first?.kind === 'edit.request' && first.changes).toEqual([{ offset: at, length: 0, text: 'q = x' }])
  })
  it('块公式落点在已保留的 YAML 头块内时，规划只用纯文本', () => {
    const source = '---\ntitle: sample\n---\n\nbody'
    const at = source.indexOf('sample') + 2
    const state = EditorState.create({ doc: source, selection: { anchor: at } })
    const markdown = '$$\nx\n$$'
    expect(prepareRichPaste(state, { markdown, hasFormatting: true, blockMath: [{ from: 0, to: markdown.length }] }, []))
      .toBeNull()
  })
  it('在现有列表条目中间粘贴块公式不拆分条目，改用原纯文本', async () => {
    const { view, sent } = mount('- 前后\n- 次项')
    view.dispatch({ selection: { anchor: 3 } })
    pasteDisplayMath(view, 'x', 'X')
    await settle()
    expect(view.state.doc.toString()).toBe('- 前X后\n- 次项')
    expect(sent.filter(m => m.kind === 'edit.request')).toHaveLength(1)
  })
  it.each([true, false])('可在完整列表外侧粘贴独立公式（前侧：%s）', async (before) => {
    const list = '- 甲\n- 乙'
    const { view } = mount(list)
    view.dispatch({ selection: { anchor: before ? 0 : list.length } })
    pasteDisplayMath(view, 'x', 'X')
    await settle()
    const source = view.state.doc.toString()
    const formula = '$$\nx\n$$'
    expect(source).toBe((before ? [formula, list] : [list, formula]).join('\n\n'))
    expect(readingTexOf(source)).toEqual(['x'])
    expect(splitReadingBlocks(source).map(b => createReadingBlockElement(b, source))
      .flatMap(block => [...block.querySelectorAll('ul > li')]).map(li => li.textContent?.trim()))
      .toEqual(['甲', '乙'])
  })
  it('引用内的列表起点不是独立落点，只插入原纯文本', async () => {
    const { view, sent } = mount('> - 甲\n> - 乙')
    view.dispatch({ selection: { anchor: 2 } })
    pasteDisplayMath(view, 'x', 'X ')
    await settle()
    expect(view.state.doc.toString()).toBe('> X - 甲\n> - 乙')
    expect(sent.filter(m => m.kind === 'edit.request')).toHaveLength(1)
  })
  it('在远离旧块的长文档末尾保留公式，不复制全文为字符串', () => {
    const doc = Text.of(['$$', 'old', '$$', '', ...'段落\n\n'.repeat(20_000).split('\n')])
    const state = EditorState.create({ doc, selection: { anchor: doc.length } })
    const source = { doc, tree: markdownTreeParser.parse(docInput(doc)), fm: null }
    const copies = vi.spyOn(Text.prototype, 'toString')
    const markdown = '$$\nx\n$$'
    expect(prepareRichPaste(state, { markdown, hasFormatting: true, blockMath: [{ from: 0, to: markdown.length }] }, [], source))
      .toMatchObject({ insertions: [markdown] })
    expect(copies.mock.contexts.some(value => (value as Text).length >= doc.length)).toBe(false)
  })
  it('草稿需要重新解析超长的旧段落时使用纯文本，不在粘贴中重解析整段', () => {
    const doc = Text.of(Array.from({ length: 1024 }, () => '旧'.repeat(512)))
    const state = EditorState.create({ doc, selection: { anchor: doc.length } })
    const source = { doc, tree: markdownTreeParser.parse(docInput(doc)), fm: null }
    const markdown = '$$\nx\n$$'
    expect(prepareRichPaste(state, { markdown, hasFormatting: true, blockMath: [{ from: 0, to: markdown.length }] }, [], source))
      .toBeNull()
  })
  it('远处的未闭合块仍不能吞入新公式的开符', () => {
    const doc = '$$\n' + '段落\n\n'.repeat(600)
    const state = EditorState.create({ doc, selection: { anchor: doc.length } })
    const markdown = '$$\nx\n$$'
    expect(prepareRichPaste(state, { markdown, hasFormatting: true, blockMath: [{ from: 0, to: markdown.length }] }, []))
      .toBeNull()
  })
  it('注释中的公式落点不产生不可见的格式编辑', async () => {
    const { view } = mount('<!--\ncomment\n-->\n\nafter')
    view.dispatch({ selection: { anchor: 5 } })
    pasteDisplayMath(view, 'x', 'X')
    await settle()
    expect(view.state.doc.toString()).toBe('<!--\nXcomment\n-->\n\nafter')
  })
  it.each([
    ['<ol><li>', '</li><li>后项</li></ol>', '1.\n   $$\n   x\n   $$\n2. 后项', 'ol'],
    ['<ul><li>', '</li><li>后项</li></ul>', '-\n  $$\n  x\n  $$\n- 后项', 'ul'],
    ['<li>', '</li><li>后项</li>', '-\n  $$\n  x\n  $$\n- 后项', 'ul'],
  ])('公式可作为列表条目的第一块：%s', async (prefix, suffix, expected, tag) => {
    const { view } = mount('')
    pasteDisplayMath(view, 'x', 'x\n后项', prefix, suffix)
    await settle()
    const source = view.state.doc.toString()
    expect(source).toBe(expected)
    expect(readingTexOf(source)).toEqual(['x'])
    expect(splitReadingBlocks(source).map(b => createReadingBlockElement(b, source))
      .flatMap(block => Array.from(block.querySelectorAll(tag + ' > li')))).toHaveLength(2)
  })
  it('嵌套列表的首块为公式时，外层条目正文不会变成标题', async () => {
    const { view } = mount('')
    pasteDisplayMath(view, 'x', '甲\nx', '<ol><li>甲<ul><li>', '</li></ul></li></ol>')
    await settle()
    const source = view.state.doc.toString()
    const reading = splitReadingBlocks(source).map(b => createReadingBlockElement(b, source))
    expect(reading.flatMap(block => [...block.querySelectorAll('ol > li > ul > li annotation')]).map(n => n.textContent?.trim()))
      .toEqual(['x'])
    expect(reading.flatMap(block => [...block.querySelectorAll('h2')])).toHaveLength(0)
  })
  it.each([
    ['<ul>', '</ul>', 'ul', '-', '  '],
    ['<ol start="12">', '</ol>', 'ol', '12.', '    '],
  ])('列表首块是引用时，两种视图都保留引用和多行公式：%s', async (open, close, tag, marker, indent) => {
    const { view } = mount('')
    const tex = 'x+1\n+y'
    pasteDisplayMath(view, tex, 'x+1\n+y\n后项', open + '<li><blockquote>', '</blockquote></li><li>后项</li>' + close)
    await settle()
    const source = view.state.doc.toString()
    const frame = ['$$', ...tex.split('\n'), '$$'].map(line => indent + '> ' + line)
    expect(source).toBe([marker, ...frame, (tag === 'ul' ? '-' : '13.') + ' 后项'].join('\n'))
    expect(readingTexOf(source)).toEqual([tex])
    const reading = splitReadingBlocks(source).map(b => createReadingBlockElement(b, source))
    expect(reading.flatMap(block => [...block.querySelectorAll(tag + ' > li > blockquote annotation')])
      .map(node => node.textContent?.trim())).toEqual([tex])
    expect(view.state.field(mathBlocksField).map(hit => hit.tex.trim())).toEqual([tex])
  })
  it('重新打开时仍识别列表内引用中的公式，缩进代码里的同形标记不抢占定界符', () => {
    const code = '    > $$\n    > 字面内容'
    const list = '-\n  > $$\n  > x+1\n  > $$'
    const { view } = mount(code + '\n\n' + list)
    expect(view.state.field(mathBlocksField).map(hit => hit.tex.trim())).toEqual(['x+1'])
  })
  it('整段替换带引用公式的列表后，不保留旧公式区间', () => {
    const original = '-\n  > $$\n  > x+1\n  > $$\n- 后项'
    const { view } = mount(original)
    expect(view.state.field(mathBlocksField)).toHaveLength(1)
    view.dispatch({ changes: { from: 0, to: original.length, insert: '新正文' }, selection: { anchor: 0 } })
    expect(view.state.doc.toString()).toBe('新正文')
    expect(view.state.field(mathBlocksField)).toEqual([])
  })
  it.each([false, true])('只有块公式的任务条目保留勾选状态：%s', async (checked) => {
    const { view } = mount('')
    pasteDisplayMath(view, 'x', 'x', `<ul><li><input type="checkbox"${checked ? ' checked' : ''}>`, '</li></ul>')
    await settle()
    const source = view.state.doc.toString()
    const reading = splitReadingBlocks(source).map(b => createReadingBlockElement(b, source))
    const box = reading.flatMap(block => [...block.querySelectorAll<HTMLInputElement>('li input[type=checkbox]')])
    expect(box.map(input => input.checked)).toEqual([checked])
    expect(readingTexOf(source)).toEqual(['x'])
  })
  it('Live 展示实体解码文本，光标进入只显形当前实体，代码保持字面', () => {
    const source = '开头&#30528; &amp; &#x1F642; &missing; `&#30528;`\n结尾'
    const { view } = mount(source)
    view.dispatch({ selection: { anchor: source.length } })
    const firstLine = view.contentDOM.querySelector('.cm-line')!
    expect(firstLine.textContent).toBe('开头着 & 🙂 &missing; &#30528;')
    view.dispatch({ selection: { anchor: source.indexOf('&#30528;') + 2 } })
    expect(firstLine.textContent).toBe('开头&#30528; & 🙂 &missing; &#30528;')
    view.dispatch({ selection: { anchor: source.length } })
    expect(firstLine.textContent).toBe('开头着 & 🙂 &missing; &#30528;')
    expect(view.state.doc.toString()).toBe(source)
  })
  it('编辑公式或行内 HTML 的源码时，实体不接管其中的内容', () => {
    const source = '段落 $a &amp; b$ 和 <span>&amp;</span>。\n\n$$\na &amp; b\n$$'
    const { view } = mount(source)
    view.dispatch({ selection: EditorSelection.create([
      EditorSelection.cursor(source.indexOf('$a') + 1),
      EditorSelection.cursor(source.indexOf('<span>') + 1),
      EditorSelection.cursor(source.lastIndexOf('a &amp; b')),
    ]) })
    expect(view.contentDOM.querySelectorAll('.vsidian-inline-entity')).toHaveLength(0)
    expect(view.contentDOM.textContent?.match(/&amp;/g)).toHaveLength(3)
  })

  it('补空格档保留无外层的两个条目，仍恢复公式，纯文本阶段不补空格', async () => {
    const { view, sent } = mount('原文', { 'editor.pasteEmphasisBoundary': 'space' })
    const plain = '意味着“重点” x\n第二项'
    pasteMath(view, 'x', plain, '<li>意味着<strong>“重点”</strong> ', '</li>\n<li>第二项</li>')
    await settle()
    expect(view.state.doc.toString()).toBe('- 意味着 **“重点”** $x$\n- 第二项')
    expect(readingTexOf(view.state.doc.toString())).toEqual(['x'])
    const first = sent.find((m) => m.kind === 'edit.request')
    expect(first?.kind === 'edit.request' && first.changes[0]?.text).toBe(plain)
  })

  it.each([false, true])('段中粘贴独立列表时保留前后段界（带公式：%s）', async (math) => {
    const { view, sent } = mount('前文后文')
    view.dispatch({ selection: { anchor: 2 } })
    const plain = math ? '甲 x\n乙' : '甲\n乙'
    if (math) pasteMath(view, 'x', plain, '<li>甲 ', '</li><li>乙</li>')
    else paste(view, '<li>甲</li><li>乙</li>', plain)
    await settle()
    const source = view.state.doc.toString()
    expect(source).toBe(`前文\n\n- 甲${math ? ' $x$' : ''}\n- 乙\n\n后文`)
    const reading = splitReadingBlocks(source).map(block => createReadingBlockElement(block, source))
    expect(reading.flatMap(block => [...block.querySelectorAll('li')])).toHaveLength(2)
    expect(reading.flatMap(block => [...block.querySelectorAll('p')]).map(p => p.textContent)).toEqual(['前文', '后文'])
    expect(readingTexOf(source)).toEqual(math ? ['x'] : [])
    const first = sent.find(m => m.kind === 'edit.request')
    expect(first?.kind === 'edit.request' && first.changes).toEqual([{ offset: 2, length: 0, text: plain }])
  })

  it('独立条目按行分给相接的选区时只生成一处分隔，纯文本段仍逐行分派', async () => {
    const { view, sent } = mount('!?')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(1, 2)]) })
    paste(view, '<li>甲</li><li>乙</li>', '甲\n乙')
    await settle()
    expect(view.state.doc.toString()).toBe('- 甲\n\n- 乙')
    const first = sent.find(m => m.kind === 'edit.request')
    expect(first?.kind === 'edit.request' && first.changes).toEqual([{ offset: 0, length: 2, text: '甲乙' }])
  })

  it.each([
    ['<ul><li>one</li><li>two</li></ul>', 'one\ntwo', '\n\n- one\n- two\n\n', 'ul', ['one', 'two']],
    ['<ol><li>one</li><li>two</li></ol>', 'one\ntwo', '\n\n1. one\n2. two\n\n', 'ol', ['one', 'two']],
    ['<blockquote>quote</blockquote>', 'quote', '\n\n> quote\n\n', 'blockquote', []],
    ['<li>one</li><blockquote>quote</blockquote>', 'one\nquote', '\n\n- one\n\n> quote\n\n', 'blockquote', ['one']],
  ] as const)('真实 Markdown 列表和引用保住段中粘贴的边界：%s', async (html, plain, middle, tag, items) => {
    const { view, sent } = mount('beforeAfter')
    view.dispatch({ selection: { anchor: 6 } })
    paste(view, html, plain)
    await settle()
    const source = view.state.doc.toString()
    expect(source).toBe('before' + middle + 'After')
    const rendered = splitReadingBlocks(source).map(block => createReadingBlockElement(block, source))
    expect(rendered.flatMap(block => [...block.querySelectorAll(tag)])).toHaveLength(1)
    expect(rendered.flatMap(block => [...block.querySelectorAll('li')]).map(li => li.textContent)).toEqual(items)
    expect(rendered[0]?.textContent?.trim()).toBe('before')
    expect(rendered.at(-1)?.textContent?.trim()).toBe('After')
    const first = sent.find(message => message.kind === 'edit.request')
    expect(first?.kind === 'edit.request' && first.changes).toEqual([{ offset: 6, length: 0, text: plain }])
  })

  it.each([
    ['$ab+cd$ tail', 3, 'abx+cd'],
    ['$$\na+b\n$$\nend', 5, 'a+xb'],
  ] as const)('含粗体的普通富文本落在旧公式里面时只编辑 TeX 原文：%s', async (source, at, tex) => {
    const { view, sent } = mount(source)
    view.dispatch({ selection: { anchor: at } })
    paste(view, '<strong>x</strong>', 'x')
    await settle()
    const result = view.state.doc.toString()
    expect(result).toBe(source.slice(0, at) + 'x' + source.slice(at))
    expect(readingTexOf(result)).toEqual([tex])
    ack(sent); await settle()
    const edits = sent.filter(message => message.kind === 'edit.request')
    expect(edits.map(edit => edit.changes)).toEqual([[{ offset: at, length: 0, text: 'x' }]])
  })

  it('普通富文本仍可在旧公式之外恢复粗体', async () => {
    const source = '$abc$ tail'
    const { view } = mount(source)
    view.dispatch({ selection: { anchor: source.length } })
    paste(view, ' <strong>x</strong>', 'x')
    await settle()
    expect(view.state.doc.toString()).toBe('$abc$ tail**x**')
    expect(readingTexOf(view.state.doc.toString())).toEqual(['abc'])
  })

  it('有效引用链接两侧的美元符不是公式，不阻止富文本粘贴', async () => {
    const source = '[price _$12][ref], currency $ here\n\n[ref]: /ok'
    const at = source.indexOf('currency')
    const { view } = mount(source)
    view.dispatch({ selection: { anchor: at } })
    paste(view, '<strong>x</strong>', 'x')
    await settle()
    expect(view.state.doc.toString()).toBe(source.slice(0, at) + '**x**' + source.slice(at))
  })

  it.each([
    ['<blockquote><li>甲</li><li>乙</li></blockquote>', '> - 甲\n> - 乙'],
    ['<blockquote><p>引文</p><blockquote><li>甲</li><li>乙</li></blockquote></blockquote>',
      '> > - 甲\n> > - 乙'],
  ])('段中粘贴时保住包裹独立条目的引用和段界：%s', async (html, quotedList) => {
    const { view } = mount('前后')
    view.dispatch({ selection: { anchor: 1 } })
    paste(view, html, '甲\n乙')
    await settle()
    const source = view.state.doc.toString()
    expect(source.startsWith('前\n\n> ')).toBe(true)
    expect(source.endsWith(quotedList + '\n\n后')).toBe(true)
    const reading = splitReadingBlocks(source).map(block => createReadingBlockElement(block, source))
    expect(reading.flatMap(block => [...block.querySelectorAll('blockquote li')]).map(li => li.textContent))
      .toEqual(['甲', '乙'])
  })

  it.each([
    ['$abc$ tail', 3, 'abxc'],
    ['$$\na+b\n$$\nend', 5, 'a+xb'],
  ] as const)('旧公式内粘贴无公式的列表时仍按纯文本编辑：%s', async (source, at, tex) => {
    const { view, sent } = mount(source)
    view.dispatch({ selection: { anchor: at } })
    paste(view, '<li>x</li>', 'x')
    await settle()
    const result = view.state.doc.toString()
    expect(result).toBe(source.slice(0, at) + 'x' + source.slice(at))
    expect(readingTexOf(result)).toEqual([tex])
    const edits = sent.filter(m => m.kind === 'edit.request')
    expect(edits.map(edit => edit.changes)).toEqual([[{ offset: at, length: 0, text: 'x' }]])
  })

  it('公式贴到选区两端的英文旁时仅在富文本阶段插入分隔', async () => {
    const { view, sent } = mount('foo…bar')
    view.dispatch({ selection: { anchor: 3, head: 4 } })
    pasteMath(view, 'x', 'x')
    await settle()
    expect(view.state.doc.toString()).toBe('foo $x$ bar')
    const edit = sent.find((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')!
    expect(edit.changes).toEqual([{ offset: 3, length: 1, text: 'x' }])
  })

  it('相接选区的实际插入公式只补一枚分隔空格', async () => {
    const { view } = mount('!?')
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(1, 2)]) })
    expect(view.state.selection.ranges).toHaveLength(2)
    pasteMath(view, String.raw`\frac{a}{b}`, 'a/b')
    await settle()
    expect(view.state.doc.toString()).toBe(String.raw`$\frac{a}{b}$ $\frac{a}{b}$`)
  })

  it.each([
    { doc: '$a$ end', at: 0, plain: 'x USD', prefix: '', suffix: ' USD', formatted: '$x$ USD $a$ end', tex: ['x', 'a'] },
    { doc: 'start $a$', at: 9, plain: 'USD x', prefix: 'USD ', suffix: '', formatted: 'start $a$ USD $x$', tex: ['a', 'x'] },
  ])('恢复新公式时保留选区外的旧公式：$doc', async ({ doc, at, plain, prefix, suffix, formatted, tex }) => {
    const { view, sent } = mount(doc)
    view.dispatch({ selection: { anchor: at } })
    pasteMath(view, 'x', plain, prefix, suffix)
    await settle()

    const finalSource = view.state.doc.toString()
    expect(readingTexOf(finalSource)).toEqual(tex)
    expect(finalSource).toBe(formatted)
    ack(sent); await settle()
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits.map(edit => edit.paste?.stage)).toEqual(['text', 'format'])
    expect(edits[0]!.changes).toEqual([{ offset: at, length: 0, text: plain }])
  })

  it.each(['$$\na+b\n$$\n\nend', '  $$\na+b\n$$\n\nend'])('不能保留未选中的跨行公式时回退原纯文本：%s', async (doc) => {
    const { view, sent } = mount(doc)
    view.dispatch({ selection: { anchor: 0 } })
    const plain = 'x USD\n\n'
    pasteMath(view, 'x', plain, '', ' USD')
    await settle()
    const finalSource = view.state.doc.toString()
    expect(view.state.field(mathBlocksField).map(hit => hit.tex.trim())).toEqual(['a+b'])
    expect(readingTexOf(finalSource)).toEqual(['a+b'])
    expect(finalSource).toBe(plain + doc)
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits.map(edit => edit.changes)).toEqual([[{ offset: 0, length: 0, text: plain }]])
  })

  it.each([
    { prefix: 'USD ', suffix: '', plain: '\n\nUSD x', visible: 'USD x' },
    { prefix: '<p>USD</p><p>', suffix: '</p>', plain: '\n\nUSD\n\nx', visible: 'USD' },
  ])('阅读视图会吞掉块公式结束行上的新文字时回退原纯文本：$prefix', async ({ prefix, suffix, plain, visible }) => {
    const doc = 'start\n\n$$\na+b\n$$'
    const { view, sent } = mount(doc)
    view.dispatch({ selection: { anchor: doc.length } })
    pasteMath(view, 'x', plain, prefix, suffix)
    await settle()
    const finalSource = view.state.doc.toString()
    const readingText = splitReadingBlocks(finalSource)
      .map(block => createReadingBlockElement(block, finalSource).textContent).join('\n')
    expect(readingText).toContain(visible)
    expect(readingTexOf(finalSource)).toEqual(['a+b'])
    expect(view.state.field(mathBlocksField).map(hit => hit.tex.trim())).toEqual(['a+b'])
    expect(finalSource).toBe(doc + plain)
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits.map(edit => edit.changes)).toEqual([[{ offset: doc.length, length: 0, text: plain }]])
  })

  it('在块公式之后独立成段时保留富文本中的新公式', async () => {
    const doc = 'start\n\n$$\na+b\n$$\n\n'
    const { view } = mount(doc)
    view.dispatch({ selection: { anchor: doc.length } })
    pasteMath(view, 'x', 'USD x', 'USD ')
    await settle()
    const finalSource = view.state.doc.toString()
    expect(finalSource).toBe(doc + 'USD $x$')
    expect(readingTexOf(finalSource)).toEqual(['a+b', 'x'])
  })

  it('旧块公式边界不变时仍可富文本粘贴行内公式', async () => {
    const doc = '前文\n\n$$\na+b\n$$\n\n尾'
    const { view } = mount(doc)
    view.dispatch({ selection: { anchor: 2 } })
    pasteMath(view, 'x', 'x USD', '', ' USD')
    await settle()
    const finalSource = view.state.doc.toString()
    expect(finalSource).toBe('前文$x$ USD' + doc.slice(2))
    expect(view.state.field(mathBlocksField).map(hit => hit.tex.trim())).toEqual(['a+b'])
    expect(readingTexOf(finalSource)).toEqual(['x', 'a+b'])
  })

  it('已有不配对的美元不能抢占从剪贴板恢复的公式定界符', async () => {
    const { view } = mount('cash $5 … end')
    view.dispatch({ selection: { anchor: 8, head: 9 } })
    pasteMath(view, String.raw`\frac{a}{b}`, 'a/b')
    await settle()
    expect(view.state.doc.toString()).toBe('cash $5 a/b end')
  })

  it('双载荷文本等值但落点仍需要分隔时保留富文本阶段', async () => {
    const { view } = mount('foo…bar')
    view.dispatch({ selection: { anchor: 3, head: 4 } })
    pasteMath(view, 'x', '$x$')
    await settle()
    expect(view.state.doc.toString()).toBe('foo $x$ bar')
  })

  it('保留含美元链接的原地址与邻接公式，不回纯文本', async () => {
    const { view } = mount()
    pasteMath(view, String.raw`\frac{a}{b}`, 'source a/b', '<a href="https://example.com/$x">source</a> ')
    await settle()
    expect(view.state.doc.toString()).toBe(String.raw`[source](https://example.com/$x) $\frac{a}{b}$`)
  })

  it.each(['Formula: $a + b$ end', 'Formula:\n$$\na + b\n$$\nend'])('编辑既有公式内部时使用纯文本 %s', async (doc) => {
    const { view } = mount(doc)
    const at = doc.indexOf('b')
    view.dispatch({ selection: { anchor: at, head: at + 1 } })
    pasteMath(view, 'x', 'x')
    await settle()
    expect(view.state.doc.toString()).toBe(doc.replace('b', 'x'))
  })

  it('完整选中已有公式仍可恢复新的公式', async () => {
    const { view } = mount('Formula: $a$ end')
    view.dispatch({ selection: { anchor: 9, head: 12 } })
    pasteMath(view, 'x', 'x')
    await settle()
    expect(view.state.doc.toString()).toBe('Formula: $x$ end')
  })
  it('命中规则的双载荷粘贴：链接恢复、分步撤销两阶段携带 text/format', async () => {
    const { view, sent } = mount()
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    expect(view.state.doc.toString()).toBe('[查看](https://e.com/a)')
    ack(sent); await settle()
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits).toHaveLength(2)
    expect(edits[0]!.paste?.stage).toBe('text')
    expect(edits[1]!.paste?.stage).toBe('format')
  })

  it('迟到旧版本快照不回退：撤回（空快照 v2）后 v1 不复活规则', async () => {
    const { view } = mount()
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: { version: 2, rules: [] } })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    // 无规则 → 内置转换：span 无格式 → 与 plain 等值 → 纯文本路径
    expect(view.state.doc.toString()).toBe('查看')
  })

  it('转换结果等于 plain 时只有一笔编辑（规则不另建历史）', async () => {
    const { view, sent } = mount()
    c.handleHostMessage({
      kind: 'addonPasteRules.snapshot',
      snapshot: {
        version: 1,
        rules: [{
          addonId: 'fixture.demo',
          id: 'plain-wrap',
          priority: 0,
          match: { tag: 'SPAN', attributes: [{ name: 'data-x' }] },
          output: { kind: 'template', template: '{{t}}', slots: { t: { source: { kind: 'text' } } } },
        }],
      },
    })
    paste(view, '<p><span data-x>纯文字</span></p>', '纯文字')
    await settle()
    expect(view.state.doc.toString()).toBe('纯文字')
    const edits = sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
    expect(edits).toHaveLength(1)
  })

  it('纯文本粘贴不经过规则：总开关关闭走纯文本链', async () => {
    const spy = vi.spyOn(conversion, 'htmlToMarkdown')
    const { view } = mount('旧内容', { 'editor.pastePreserveFormatting': false })
    c.handleHostMessage({ kind: 'addonPasteRules.snapshot', snapshot: PROMPT_LINK_SNAPSHOT(1) })
    paste(view, '<p><span data-prompt-link-url="https://e.com/a">查看</span></p>', '查看')
    await settle()
    expect(view.state.doc.toString()).toBe('查看')
    expect(spy).not.toHaveBeenCalled()
  })
})
