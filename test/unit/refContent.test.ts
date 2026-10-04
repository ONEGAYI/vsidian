// 引用内容类型分派共享内核契约（#333 / P3-01）：目标类型分类学（kind
// 集合与本地文件分类——宿主读取分派与 webview 内容装载按同一 kind）、
// Markdown 载荷类型与导航选择器结构留位（PDF #page、文本 #line/#range
// ——本票不实现非 Markdown 锚点解析，仅结构与字段位，P3-05/P3-08 接入）。
import { describe, expect, it } from 'vitest'
import {
  REF_CONTENT_KINDS,
  classifyLocalRefContentKind,
  isRefContentKind,
  type RefContentKind,
  type RefMarkdownContent,
  type RefNavSelector,
} from '../../src/shared/refContent'

describe('引用内容类型集合（#333 三期五类）', () => {
  it('kind 集合：markdown / pdf / image / text / web', () => {
    expect([...REF_CONTENT_KINDS]).toEqual(['markdown', 'pdf', 'image', 'text', 'web'])
  })

  it('isRefContentKind：已知类型放行；未知类型与非字符串拒绝', () => {
    for (const kind of REF_CONTENT_KINDS) {
      expect(isRefContentKind(kind), `kind=${kind} 应放行`).toBe(true)
    }
    expect(isRefContentKind('video'), '未知类型拒绝').toBe(false)
    expect(isRefContentKind('')).toBe(false)
    expect(isRefContentKind(3)).toBe(false)
    expect(isRefContentKind(null)).toBe(false)
    expect(isRefContentKind(undefined)).toBe(false)
  })
})

describe('本地目标类型分类（classifyLocalRefContentKind）', () => {
  it('.md → markdown（大小写不敏感）', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\目标.md')).toBe('markdown')
    expect(classifyLocalRefContentKind('D:\\notes\\NOTE.MD')).toBe('markdown')
  })

  it('.pdf → pdf', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\资料.pdf')).toBe('pdf')
    expect(classifyLocalRefContentKind('D:\\notes\\资料.PDF')).toBe('pdf')
  })

  it('图片扩展名 → image（与图片管线 IMAGE_WATCH_GLOB_SEGMENTS 同源）', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']) {
      expect(classifyLocalRefContentKind(`D:\\notes\\图.${ext}`), `.${ext} 应归 image`).toBe('image')
    }
  })

  it('其余本地文件（代码/配置/无扩展名）→ text', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\src\\main.ts')).toBe('text')
    expect(classifyLocalRefContentKind('D:\\notes\\.vscode\\settings.json')).toBe('text')
    expect(classifyLocalRefContentKind('D:\\notes\\LICENSE')).toBe('text')
  })
})

describe('Markdown 载荷与导航选择器结构（类型留位）', () => {
  it('RefMarkdownContent：kind 标记 + TextDocument 权威版本 + LF 全文 + 定位区间 + Markdown 选择器', () => {
    const content: RefMarkdownContent = {
      kind: 'markdown',
      version: 7,
      lfText: '# 目标\n\n正文',
      range: { start: 0, end: 8 },
      selector: { kind: 'full' },
    }
    expect(content.kind).toBe('markdown')
    expect(content.version).toBe(7)
    expect(content.lfText).toBe('# 目标\n\n正文')
    expect(content.range).toEqual({ start: 0, end: 8 })
    expect(content.selector).toEqual({ kind: 'full' })
  })

  it('导航选择器留位：PDF page / 文本 line+range 字段位与 Markdown 选择器同一联合（本票不解析）', () => {
    const selectors: RefNavSelector[] = [
      { kind: 'full' },
      { kind: 'heading', anchor: '章节' },
      { kind: 'block', anchor: '^blk1' },
      { kind: 'pdf', page: 3 },
      { kind: 'text', line: 10 },
      { kind: 'text', range: { begin: 10, end: 20 } },
      { kind: 'text', line: 12, range: { begin: 10, end: 20 } },
      { kind: 'plain' },
    ]
    expect(selectors.map((s) => s.kind)).toEqual([
      'full', 'heading', 'block', 'pdf', 'text', 'text', 'text', 'plain',
    ])
  })

  it('kind 联合覆盖五类（编译期完备性——pdf/image/text/web 由后续票登记载荷形态）', () => {
    const kinds: RefContentKind[] = ['markdown', 'pdf', 'image', 'text', 'web']
    expect(kinds).toHaveLength(REF_CONTENT_KINDS.length)
  })
})
