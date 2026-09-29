// #197 出链抽取契约测试：从 Markdown 全文抽取双链 / 普通内联链接 / 图片 /
// 引用式链接定义为边（VaultEdge 形态，source 由调用方注入），排除代码
// 字面量与 frontmatter——抽取规则与 live 装饰（liveLinks）同源：树驱动走
// markdownTreeParser 同一解析器，行扫描走 shared/wikilink 与 shared/looseLink
// 同一形态学。差异（引用式使用形态不单独产边等）在对应用例注释钉住。
import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import { extractVaultEdges } from '../../src/host/vaultLinkExtract'
import type { VaultLinkPathContext } from '../../src/shared/vaultLink'

/** 根内文件集合（相对路径 / 分隔，真实大小写形态）→ resolver：绝对 fsPath
 *  先转根内相对（宿主平台语义）再查集合，命中返回根内相对规范路径，未命中
 *  null（与宿主服务的存在性端口同型） */
function resolverOf(files: readonly string[], ctx: VaultLinkPathContext): (abs: string) => string | null {
  const ops = ctx.isWindowsHost ? path.win32 : path.posix
  const norm = (p: string): string => ops.relative(ops.resolve(ctx.rootDir), ops.resolve(p)).replace(/\\/g, '/')
  const insensitive = ctx.isWindowsHost
  const set = new Map<string, string>()
  for (const f of files) {
    const key = insensitive ? f.toLowerCase() : f
    set.set(key, f)
  }
  return (abs: string) => {
    const rel = norm(abs)
    if (rel.startsWith('..')) {
      return null
    }
    const hit = set.get(insensitive ? rel.toLowerCase() : rel)
    return hit ?? null
  }
}

const CTX: VaultLinkPathContext = {
  docDir: 'C:/vault/notes',
  rootDir: 'C:/vault',
  isWindowsHost: true,
}

/** Windows 宿主形态的文件集合（正斜杠书写，与 CTX 分隔符一致） */
const FILES = [
  'notes/设计.md',
  'notes/项目甲/设计.md',
  'notes/目标笔记.md',
  'notes/assets/图片 一.png',
  'notes/文档.pdf',
]

describe('extractVaultEdges：双链', () => {
  it('同目录短名、显式子路径、别名与标题/块锚均产边（resolvedTarget 为根内相对真实路径）', () => {
    const text = '见 [[设计]] 与 [[项目甲/设计|别名]] 与 [[目标笔记#深处标题]] 与 [[目标笔记#^blk-1]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['wikilink', '设计', 'notes/设计.md', ''],
      ['wikilink', '项目甲/设计', 'notes/项目甲/设计.md', ''],
      ['wikilink', '目标笔记', 'notes/目标笔记.md', '深处标题'],
      ['wikilink', '目标笔记', 'notes/目标笔记.md', '^blk-1'],
    ])
  })

  it('断链与越界目标保留为边（resolvedTarget=null，未命中不丢）', () => {
    const text = '断链 [[不存在]] 与上行越界 [[../../outside]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.target, e.resolvedTarget])).toEqual([
      ['不存在', null],
      ['../../outside', null],
    ])
  })

  it('本文件锚点（path 空）产自引用边（resolvedTarget=来源自身）', () => {
    const text = '页内 [[#本节标题]] 引用。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'wikilink', resolvedTarget: 'notes/源.md', anchor: '本节标题' })
  })

  it('嵌入 ![[…]] 与降级形态不产边（二期/降级语义，与呈现侧一致）', () => {
    const text = '嵌入 ![[设计]] 与降级 [[坏#]] 与空 [[]]。\n'
    expect(extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })
})

describe('extractVaultEdges：普通内联链接与图片', () => {
  it('内联链接产 mdlink 边：路径解析、%20 容错解码、fragment 入 anchor', () => {
    const text = '[文内](./设计.md) 与 [编码](./%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md) 与 [锚点](./设计.md#结论)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['mdlink', './设计.md', 'notes/设计.md', ''],
      ['mdlink', './%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md', 'notes/目标笔记.md', ''],
      ['mdlink', './设计.md#结论', 'notes/设计.md', '结论'],
    ])
  })

  it('无扩展名文档链接补 .md 候选；显式扩展名不补（无 .pdf.md 形态）', () => {
    const text = '[省略](./目标笔记) 与 [显式](./文档.pdf)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.target, e.resolvedTarget])).toEqual([
      ['./目标笔记', 'notes/目标笔记.md'],
      ['./文档.pdf', 'notes/文档.pdf'],
    ])
  })

  it('外链 https 保留为边（resolvedTarget=null）；本文件锚点链接产自引用边', () => {
    const text = '[外](https://example.com/a#b) 与 [锚](#本节)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['https://example.com/a#b', null, ''],
      ['#本节', 'notes/源.md', '本节'],
    ])
  })

  it('图片产 image 边（显式扩展名单候选，不补 .md）', () => {
    const text = '![好图](./assets/图片%20一.png) 与 ![断图](./assets/缺失.png)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget])).toEqual([
      ['image', './assets/图片%20一.png', 'notes/assets/图片 一.png'],
      ['image', './assets/缺失.png', null],
    ])
  })

  it('自动链接 <https://…> 产 mdlink 边（外部目标，resolved=null）', () => {
    const text = '自动 <https://autolink.example.com/x> 链接。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'mdlink', resolvedTarget: null })
  })
})

describe('extractVaultEdges：引用式定义与宽松链接', () => {
  it('引用式定义 [ref]: url 产 refdef 边（目标解析同 mdlink 口径）', () => {
    const text = '段落。\n\n[r1]: ./设计.md "标题"\n\n[r2]: https://example.com/x\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget])).toEqual([
      ['refdef', './设计.md', 'notes/设计.md'],
      ['refdef', 'https://example.com/x', null],
    ])
  })

  it('引用式使用 [文字][ref] 不单独产边（目标由定义处代表——首版差异，测试钉住）', () => {
    const text = '[文字][r1] 使用。\n\n[r1]: ./设计.md\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'mdlink')).toHaveLength(0)
    expect(edges.filter((e) => e.kind === 'refdef')).toHaveLength(1)
  })

  it('宽松链接（目标含空格）产边，与呈现侧 #152 形态学同源、归 mdlink/image', () => {
    const text = '[宽松](./设计 备份.md) 与 ![宽图](./assets/图 片.png)。\n'
    const files = [...FILES, 'notes/设计 备份.md', 'notes/assets/图 片.png']
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(files, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget])).toEqual([
      ['mdlink', './设计 备份.md', 'notes/设计 备份.md'],
      ['image', './assets/图 片.png', 'notes/assets/图 片.png'],
    ])
  })

  it('标准可解析目标不被宽松层接管（%20 形态走树驱动路径，无双计）', () => {
    const text = '[编码空格](./assets/%E5%9B%BE%E7%89%87%20%E4%B8%80.png)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'mdlink', resolvedTarget: 'notes/assets/图片 一.png' })
  })
})

describe('extractVaultEdges：代码字面量与 frontmatter 排除（与呈现侧同源）', () => {
  it('围栏代码、行内代码内的链接/双链不产边', () => {
    const text = [
      '```text',
      '[[围栏内]] 与 [链](./设计.md) 与 ![图](./assets/图片%20一.png)',
      '```',
      '',
      '`行内 [[不抽]] [也不抽](./设计.md)` 正文。',
      '',
    ].join('\n')
    expect(extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })

  it('frontmatter 内的链接不产边（头区不是 Markdown 语法域）', () => {
    const text = [
      '---',
      'title: "[[设计]] 与 [链接](./设计.md)"',
      '---',
      '',
      '正文 [[设计]]。',
      '',
    ].join('\n')
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'wikilink', start: text.indexOf('[[设计]]', 30) })
  })
})

describe('extractVaultEdges：区间与排序', () => {
  it('边区间为 LF 全文偏移（覆盖整段标记，含闭括号/闭中括号），结果按区间升序稳定', () => {
    const text = '先 ![图](./assets/图片%20一.png) 后 [[设计]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.start, e.end])).toEqual([
      ['image', text.indexOf('![图]'), text.indexOf(')') + 1],
      ['wikilink', text.indexOf('[[设计]]'), text.indexOf('[[设计]]') + '[[设计]]'.length],
    ])
    expect(edges.map((e) => e.source)).toEqual(['notes/源.md', 'notes/源.md'])
  })
})

describe('extractVaultEdges：POSIX 宿主语义', () => {
  it('POSIX 宿主反斜杠是普通文件名字符（不归一分隔符），大小写敏感', () => {
    const posixCtx: VaultLinkPathContext = { docDir: '/vault/notes', rootDir: '/vault', isWindowsHost: false }
    const files = ['notes/a.md', 'notes/设计.md']
    const resolve = resolverOf(files, posixCtx)
    // Windows 分隔符写法在 POSIX 宿主上不解析（与 #196 跳转链路同语义）
    const edges = extractVaultEdges('notes/源.md', '[[设计]] 与 [b](a.md)。\n', posixCtx, resolve)
    expect(edges.map((e) => e.resolvedTarget)).toEqual(['notes/设计.md', 'notes/a.md'])
    const edgesCase = extractVaultEdges('notes/源.md', '[[设计.MD]]。\n', posixCtx, resolve)
    expect(edgesCase[0]!.resolvedTarget).toBeNull()
  })
})
