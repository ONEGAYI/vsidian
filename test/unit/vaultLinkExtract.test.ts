// #197 出链抽取契约测试：从 Markdown 全文抽取双链 / 普通内联链接 / 图片 /
// 引用式链接定义为边（VaultEdge 形态，source 由调用方注入），排除代码
// 字面量与 frontmatter——抽取规则与 live 装饰（liveLinks）同源：树驱动走
// markdownTreeParser 同一解析器，行扫描走 shared/wikilink 与 shared/looseLink
// 同一形态学。差异（引用式使用形态不单独产边等）在对应用例注释钉住。
//
// #556 T2 起 resolvedTarget 为**规范绝对身份**（磁盘真实形态、`/` 分隔）
// ——断言全按绝对形态书写；短名补查与显式绝对路径目标的抽取契约在文末
// 两 describe（补查域形态学复用 vaultLink 的单一事实源，不在本文件复制）。
import { describe, expect, it, vi } from 'vitest'
import * as path from 'node:path'
import { extractVaultEdges, shortnameDepKeyOf } from '../../src/host/vaultLinkExtract'
import type { VaultLinkPathContext } from '../../src/shared/vaultLink'

/** 根内文件集合（相对路径 / 分隔，真实大小写形态）→ resolver：绝对 fsPath
 *  先转根内相对（宿主平台语义）再查集合，命中返回**规范绝对身份**，未命中
 *  null（与宿主服务的存在性端口同型——#556 T2 起端口返回绝对身份） */
function resolverOf(files: readonly string[], ctx: VaultLinkPathContext): (abs: string) => string | null {
  const ops = ctx.isWindowsHost ? path.win32 : path.posix
  const norm = (p: string): string => ops.relative(ops.resolve(ctx.rootDir), ops.resolve(p)).replace(/\\/g, '/')
  const identity = (rel: string): string => ops.resolve(ops.resolve(ctx.rootDir), ...rel.split('/')).replace(/\\/g, '/')
  const insensitive = ctx.isWindowsHost
  const set = new Map<string, string>()
  for (const f of files) {
    const key = insensitive ? f.toLowerCase() : f
    set.set(key, f)
  }
  return (abs) => {
    const rel = norm(abs)
    if (rel.startsWith('..')) {
      return null
    }
    const hit = set.get(insensitive ? rel.toLowerCase() : rel)
    return hit !== undefined ? identity(hit) : null
  }
}

const CTX: VaultLinkPathContext = {
  docDir: 'C:/vault/notes',
  rootDir: 'C:/vault',
  isWindowsHost: true,
}

/** 断言用规范绝对身份形态（rootDir + rel，/ 分隔） */
const ABS = (rel: string): string => `C:/vault/${rel}`

/** Windows 宿主形态的文件集合（正斜杠书写，与 CTX 分隔符一致） */
const FILES = [
  'notes/设计.md',
  'notes/项目甲/设计.md',
  'notes/目标笔记.md',
  'notes/assets/图片 一.png',
  'notes/文档.pdf',
]

describe('extractVaultEdges：双链', () => {
  it('同目录短名、显式子路径、别名与标题/块锚均产边（resolvedTarget 为规范绝对身份）', () => {
    const text = '见 [[设计]] 与 [[项目甲/设计|别名]] 与 [[目标笔记#深处标题]] 与 [[目标笔记#^blk-1]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['wikilink', '设计', ABS('notes/设计.md'), ''],
      ['wikilink', '项目甲/设计', ABS('notes/项目甲/设计.md'), ''],
      ['wikilink', '目标笔记', ABS('notes/目标笔记.md'), '深处标题'],
      ['wikilink', '目标笔记', ABS('notes/目标笔记.md'), '^blk-1'],
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

  it('本文件锚点（path 空）产自引用边（resolvedTarget=来源自身绝对身份）', () => {
    const text = '页内 [[#本节标题]] 引用。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'wikilink', resolvedTarget: ABS('notes/源.md'), anchor: '本节标题' })
  })

  it('降级形态不产边（嵌入产边语义 #222 起迁移——详见嵌入 describe；此处只钉降级）', () => {
    const text = '降级 [[坏#]] 与空 [[]] 与嵌入残缺 ![[坏#]]。\n'
    expect(extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })
})

describe('extractVaultEdges：普通内联链接与图片', () => {
  it('内联链接产 mdlink 边：路径解析、%20 容错解码、fragment 入 anchor', () => {
    const text = '[文内](./设计.md) 与 [编码](./%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md) 与 [锚点](./设计.md#结论)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['mdlink', './设计.md', ABS('notes/设计.md'), ''],
      ['mdlink', './%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md', ABS('notes/目标笔记.md'), ''],
      ['mdlink', './设计.md#结论', ABS('notes/设计.md'), '结论'],
    ])
  })

  it('无扩展名文档链接补 .md 候选；显式扩展名不补（无 .pdf.md 形态）', () => {
    const text = '[省略](./目标笔记) 与 [显式](./文档.pdf)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.target, e.resolvedTarget])).toEqual([
      ['./目标笔记', ABS('notes/目标笔记.md')],
      ['./文档.pdf', ABS('notes/文档.pdf')],
    ])
  })

  it('外链 https 保留为边（resolvedTarget=null）；本文件锚点链接产自引用边', () => {
    const text = '[外](https://example.com/a#b) 与 [锚](#本节)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.target, e.resolvedTarget, e.anchor])).toEqual([
      ['https://example.com/a#b', null, ''],
      ['#本节', ABS('notes/源.md'), '本节'],
    ])
  })

  it('图片产 image 边（显式扩展名单候选，不补 .md）', () => {
    const text = '![好图](./assets/图片%20一.png) 与 ![断图](./assets/缺失.png)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget])).toEqual([
      ['image', './assets/图片%20一.png', ABS('notes/assets/图片 一.png')],
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
      ['refdef', './设计.md', ABS('notes/设计.md')],
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
      ['mdlink', './设计 备份.md', ABS('notes/设计 备份.md')],
      ['image', './assets/图 片.png', ABS('notes/assets/图 片.png')],
    ])
  })

  it('标准可解析目标不被宽松层接管（%20 形态走树驱动路径，无双计）', () => {
    const text = '[编码空格](./assets/%E5%9B%BE%E7%89%87%20%E4%B8%80.png)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'mdlink', resolvedTarget: ABS('notes/assets/图片 一.png') })
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
    expect(edges.map((e) => e.resolvedTarget)).toEqual(['/vault/notes/设计.md', '/vault/notes/a.md'])
    const edgesCase = extractVaultEdges('notes/源.md', '[[设计.MD]]。\n', posixCtx, resolve)
    expect(edgesCase[0]!.resolvedTarget).toBeNull()
  })
})

describe('extractVaultEdges：嵌入（#222 独立扫描器接入）', () => {
  it('独占行嵌入产 embed 边：区间含 !、anchor 拆列、目标解析与双链同源', () => {
    const text = '看嵌入：\n\n![[设计]]\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const embed = edges.find((e) => e.kind === 'embed')
    expect(embed).toBeDefined()
    expect(embed).toMatchObject({
      source: 'notes/源.md',
      target: '设计',
      resolvedTarget: ABS('notes/设计.md'),
      anchor: '',
      start: text.indexOf('![[设计]]'),
      end: text.indexOf('![[设计]]') + '![[设计]]'.length,
    })
    // 双链扫描器不重复计边（同一处只有一个 embed 边，无 wikilink 边）
    expect(edges.filter((e) => e.start === embed!.start)).toHaveLength(1)
  })

  it('嵌入章节/块锚点拆列（与 wikilink 边同口径：target 为路径部分）', () => {
    const text = '![[设计#章节甲]] 与 ![[目标笔记#^b1]]\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed').map((e) => [e.target, e.anchor])).toEqual([
      ['设计', '章节甲'],
      ['目标笔记', '^b1'],
    ])
  })

  it('混排嵌入同样产边（索引不设行独占限制——行独占只属挂载适配）', () => {
    const text = '前缀 ![[设计]] 后缀\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed')).toHaveLength(1)
  })

  it('嵌入显式图片扩展目标解析到该文件（引用关系对附件成立）', () => {
    const text = '![[assets/图片 一.png]]\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed').map((e) => e.resolvedTarget))
      .toEqual([ABS('notes/assets/图片 一.png')])
  })

  it('断链/越界/本文件锚点嵌入：断链保留边、本文件锚点自引用', () => {
    const text = '![[不存在的目标]] 与 ![[../设计]] 与 ![[#本文件锚]]\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed').map((e) => [e.target, e.anchor, e.resolvedTarget])).toEqual([
      // 本文件锚点与双链同构：path 空串 + anchor 拆列，resolved 自引用
      ['不存在的目标', '', null],
      ['../设计', '', null], // 越出所属根（notes/../设计 落根外解析失败为断链形态）
      ['', '本文件锚', ABS('notes/源.md')],
    ])
  })

  it('围栏/行内代码内的嵌入不产边（代码上下文排除与双链同源）', () => {
    const text = [
      '```text',
      '![[设计]]',
      '```',
      '',
      '`![[设计]]` 行内代码。',
      '',
    ].join('\n')
    expect(extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })

  it('嵌入与双链/普通链接并存：排序与互斥（![[x]] 不产 wikilink 边）', () => {
    const text = '[[设计]] ![[目标笔记]] [链](./设计.md)\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target])).toEqual([
      ['wikilink', '设计'],
      ['embed', '目标笔记'],
      ['mdlink', './设计.md'],
    ])
  })
})

describe('#246 混排嵌入边与注释排除（呈现同源核对）', () => {
  it('混排/列表/引用/任务内的嵌入照常产边（区间为嵌入原文精确边界）', () => {
    const text = '前文 ![[设计]] 后文\n- 项 ![[目标笔记]] 余\n> 引 ![[项目甲/设计]] 文\n- [ ] 任务 ![[设计]] 毕\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => [e.kind, e.target, e.resolvedTarget])).toEqual([
      ['embed', '设计', ABS('notes/设计.md')],
      ['embed', '目标笔记', ABS('notes/目标笔记.md')],
      ['embed', '项目甲/设计', ABS('notes/项目甲/设计.md')],
      ['embed', '设计', ABS('notes/设计.md')],
    ])
    for (const e of edges) {
      expect(text.slice(e.start, e.end)).toBe(`![[${e.target}]]`)
    }
  })

  it('同段多个嵌入按源顺序各产边（occurrence 各有区间）', () => {
    const text = '起 ![[设计]] 中 ![[目标笔记]] 末 ![[设计]] 收\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.map((e) => e.target)).toEqual(['设计', '目标笔记', '设计'])
    expect(edges[0]!.start).toBeLessThan(edges[1]!.start)
    expect(edges[1]!.start).toBeLessThan(edges[2]!.start)
    expect(edges[0]!.start).not.toBe(edges[2]!.start)
  })

  it('HTML 注释内的双链/嵌入不产边（与阅读呈现的注释剥离同源——行内与跨行注释）', () => {
    const text = [
      '前 <!-- ![[设计]] 与 [[目标笔记]] --> 可见 ![[设计]] 后',
      '<!--',
      '![[目标笔记]]',
      '-->',
    ].join('\n')
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ kind: 'embed', target: '设计' })
    expect(text.slice(edges[0]!.start, edges[0]!.end)).toBe('![[设计]]')
  })
})

describe('#248 表格格内嵌入边（转义映射保真）', () => {
  it('格内 \\| 别名形态产 embed 边：target 为解码路径、区间为源文、别名不进目标', () => {
    const text = '| a | ![[设计\\|别名]] |\n| --- | --- |\n| b | c |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const embed = edges.find((e) => e.kind === 'embed')
    expect(embed).toBeDefined()
    expect(embed!.target).toBe('设计')
    expect(embed!.resolvedTarget).toBe(ABS('notes/设计.md'))
    expect(embed!.anchor).toBe('')
    // 区间 slice 回源文恰为嵌入原文（含 \\|）
    expect(text.slice(embed!.start, embed!.end)).toBe('![[设计\\|别名]]')
  })

  it('格内锚点 + 别名组合：anchor 与解码路径拆列正确', () => {
    const text = '| ![[设计#章节甲\\|显]] | b |\n| --- | --- |\n| c | d |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed').map((e) => [e.target, e.anchor])).toEqual([
      ['设计', '章节甲'],
    ])
  })

  it('表头格与数据格同产边；同格多引用按源顺序', () => {
    const text = '| ![[设计]] ![[目标笔记\\|n]] | b |\n| --- | --- |\n| c | d |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'embed').map((e) => e.target)).toEqual(['设计', '目标笔记'])
  })

  it('格内行内代码中的嵌入字面量不产边；跨格伪形态不产边', () => {
    const codeCell = '| `![[设计]]` | b |\n| --- | --- |\n| c | d |'
    expect(extractVaultEdges('notes/源.md', codeCell, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
    const pseudo = '| a ![[x | y]] b |\n| --- | --- |\n| c | d |'
    expect(extractVaultEdges('notes/源.md', pseudo, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })

  it('普通段落行的 \\| 嵌入仍按原文字面产边（既有语义不扩散）', () => {
    const text = '段 ![[设计\\|x]] 段\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const embed = edges.find((e) => e.kind === 'embed')
    expect(embed).toBeDefined()
    // 非表格行不进入格内解码语义：path 按原文（含 \\）——目标字面与格内
    // 解码边（'设计'）不同；resolved 的路径规范化容错命中属既有行为
    expect(embed!.target).toBe('设计\\')
    expect(embed!.target).not.toBe('设计')
  })
})

describe('#248 P1-1 消费者一致性：`]]` 紧贴转义管道的嵌入边端点', () => {
  it('边区间 slice 严格等于嵌入原文（rename 改写不触达转义反斜杠）', () => {
    const text = '| ![[设计]]\\|尾 | y |\n| --- | --- |\n| a | b |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const embed = edges.find((e) => e.kind === 'embed')
    expect(embed).toBeDefined()
    expect(embed!.target).toBe('设计')
    expect(text.slice(embed!.start, embed!.end)).toBe('![[设计]]')
    expect(text[embed!.end]).toBe('\\')
  })
})

describe('#556 T2：短名补查（端口注入时纯文件名 Markdown 目标接通）', () => {
  /** 补查端口工厂：basename → 候选绝对形态（磁盘真实形态语义） */
  const lookupOf = (byName: Record<string, string[]>, complete = true) => {
    const spy = vi.fn((basename: string) => ({ candidates: byName[basename] ?? [], complete }))
    return spy
  }

  it('相对候选全未命中且根内唯一同名 Markdown：命中该目标（端口给定的绝对形态）', () => {
    const lookup = lookupOf({ '目标.md': [ABS('资料/目标.md')] })
    const text = '见 [[目标]]。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目',
      rootDir: 'C:/vault',
      isWindowsHost: true,
    }, resolverOf(['项目/来源.md'], CTX), { lookupShortname: lookup })
    expect(edges.map((e) => [e.target, e.resolvedTarget])).toEqual([['目标', ABS('资料/目标.md')]])
    expect(lookup).toHaveBeenCalledWith('目标.md')
  })

  it('多个候选不归任一：resolvedTarget=null（与断链共用 null，不猜目标）', () => {
    const lookup = lookupOf({ '目标.md': [ABS('资料/目标.md'), ABS('归档/目标.md')] })
    const text = '见 [[目标]]。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目', rootDir: 'C:/vault', isWindowsHost: true,
    }, resolverOf(['项目/来源.md'], CTX), { lookupShortname: lookup })
    expect(edges[0]!.resolvedTarget).toBeNull()
  })

  it('唯一候选但清单不完整（pending 语义）：不声明唯一，边为 null', () => {
    const lookup = lookupOf({ '目标.md': [ABS('资料/目标.md')] }, false)
    const text = '见 [[目标]]。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目', rootDir: 'C:/vault', isWindowsHost: true,
    }, resolverOf(['项目/来源.md'], CTX), { lookupShortname: lookup })
    expect(edges[0]!.resolvedTarget).toBeNull()
  })

  it('相对优先：同目录候选命中时不触发补查（端口不被调用）', () => {
    const lookup = lookupOf({ '设计.md': [ABS('notes/设计.md')] })
    const text = '见 [[设计]]。\n'
    extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX), { lookupShortname: lookup })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('含分隔符的明确相对路径不补查（./ ../ 与子路径——端口不被调用）', () => {
    const lookup = lookupOf({ '目标.md': [ABS('资料/目标.md')] })
    const text = '见 [[./目标]] 与 [[资料/目标]]。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目', rootDir: 'C:/vault', isWindowsHost: true,
    }, resolverOf(['项目/来源.md'], CTX), { lookupShortname: lookup })
    expect(lookup).not.toHaveBeenCalled()
    // ./目标 与 资料/目标 都按来源目录解析（C:/vault/项目/目标(.md) 与
    // C:/vault/项目/资料/目标(.md)）——两者都不在磁盘上，断链保留
    expect(edges.map((e) => e.resolvedTarget)).toEqual([null, null])
  })

  it('显式 .md 短名查询键原样；mdlink 纯文件名同口径补查；image 不补查', () => {
    const lookup = lookupOf({ '目标.md': [ABS('资料/目标.md')] })
    const text = '见 [[目标.md]] 与 [链](目标) 与 ![图](目标)。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目', rootDir: 'C:/vault', isWindowsHost: true,
    }, resolverOf(['项目/来源.md'], CTX), { lookupShortname: lookup })
    expect(edges.map((e) => [e.kind, e.resolvedTarget])).toEqual([
      ['wikilink', ABS('资料/目标.md')],
      ['mdlink', ABS('资料/目标.md')],
      ['image', null], // 非 Markdown 不跨目录补查（implicitMd=false）
    ])
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('端口不注入时纯文件名目标维持断链（上游兼容——与现状一致）', () => {
    const text = '见 [[目标]]。\n'
    const edges = extractVaultEdges('项目/来源.md', text, {
      docDir: 'C:/vault/项目', rootDir: 'C:/vault', isWindowsHost: true,
    }, resolverOf(['项目/来源.md', '资料/目标.md'], CTX))
    expect(edges[0]!.resolvedTarget).toBeNull()
  })
})

describe('#556 T2：显式绝对路径目标（跨根/工作区外经 resolveAbsolute 端口）', () => {
  /** 绝对端口：根内文件与外部文件统一命中（返回磁盘真实绝对形态） */
  const absolutePortOf = (extra: readonly string[] = []) => (abs: string): string | null => {
    const identity = path.win32.resolve(abs).replace(/\\/g, '/')
    const all = [...FILES.map((f) => ABS(f)), ...extra]
    const hit = all.find((f) => f.toLowerCase() === identity.toLowerCase())
    return hit ?? null
  }

  it('盘符绝对 wikilink 命中根内目标（不受 docDir/rootDir 边界）', () => {
    const text = '见 [[C:/vault/notes/设计.md]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX), {
      resolveAbsolute: absolutePortOf(),
    })
    expect(edges.map((e) => [e.target, e.resolvedTarget])).toEqual([
      ['C:/vault/notes/设计.md', ABS('notes/设计.md')],
    ])
  })

  it('绝对目标无扩展名补 .md 候选（与 inside 同规则）', () => {
    const text = '见 [[C:/vault/notes/设计]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX), {
      resolveAbsolute: absolutePortOf(),
    })
    expect(edges[0]!.resolvedTarget).toBe(ABS('notes/设计.md'))
  })

  it('工作区外目标经绝对端口命中（登记语义在服务侧，抽取只产边）', () => {
    const text = '见 [[D:/outside/目标.md]] 与 [链](D:/outside/目标.md) 与 ![图](D:/outside/图.png)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX), {
      resolveAbsolute: absolutePortOf(['D:/outside/目标.md', 'D:/outside/图.png']),
    })
    expect(edges.map((e) => [e.kind, e.resolvedTarget])).toEqual([
      ['wikilink', 'D:/outside/目标.md'],
      ['mdlink', 'D:/outside/目标.md'],
      ['image', 'D:/outside/图.png'],
    ])
  })

  it('mdlink 绝对目标带锚点：anchor 拆列保留', () => {
    const text = '见 [链](D:/outside/目标.md#结论)。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX), {
      resolveAbsolute: absolutePortOf(['D:/outside/目标.md']),
    })
    expect(edges[0]).toMatchObject({ kind: 'mdlink', resolvedTarget: 'D:/outside/目标.md', anchor: '结论' })
  })

  it('resolveAbsolute 缺省回落主端口：外部目标恒 miss（断链保留）', () => {
    const text = '见 [[D:/outside/目标.md]]。\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges[0]!.resolvedTarget).toBeNull()
  })
})

describe('#556 T2：shortnameDepKeyOf（文件集合变化重判的反查键）', () => {
  it('纯文件名 Markdown 目标返回补查键（无扩展名补 .md）', () => {
    expect(shortnameDepKeyOf({ target: '目标', kind: 'wikilink' }, CTX)).toBe('目标.md')
    expect(shortnameDepKeyOf({ target: '目标.md', kind: 'embed' }, CTX)).toBe('目标.md')
    expect(shortnameDepKeyOf({ target: '目标', kind: 'mdlink' }, CTX)).toBe('目标.md')
  })

  it('mdlink/refdef 剥 fragment 与编码后判定（与解析同形态）', () => {
    expect(shortnameDepKeyOf({ target: '目标#章节', kind: 'mdlink' }, CTX)).toBe('目标.md')
    expect(shortnameDepKeyOf({ target: './目标', kind: 'refdef' }, CTX)).toBeNull()
  })

  it('含分隔符、非 Markdown 扩展与 image 边不在重判域', () => {
    expect(shortnameDepKeyOf({ target: '资料/目标', kind: 'wikilink' }, CTX)).toBeNull()
    expect(shortnameDepKeyOf({ target: '目标.pdf', kind: 'wikilink' }, CTX)).toBeNull()
    expect(shortnameDepKeyOf({ target: '图.png', kind: 'image' }, CTX)).toBeNull()
    expect(shortnameDepKeyOf({ target: '', kind: 'wikilink' }, CTX)).toBeNull()
  })
})

describe('#607 表格格内双链边（转义映射保真）', () => {
  it('格内 \\| 别名双链产 wikilink 边：target 为解码路径、区间为源文、别名不进目标', () => {
    const text = '| a | [[设计\\|别名]] |\n| --- | --- |\n| b | c |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const wl = edges.find((e) => e.kind === 'wikilink')
    expect(wl).toBeDefined()
    expect(wl!.target).toBe('设计')
    expect(wl!.resolvedTarget).toBe(ABS('notes/设计.md'))
    expect(wl!.anchor).toBe('')
    expect(text.slice(wl!.start, wl!.end)).toBe('[[设计\\|别名]]')
  })

  it('格内锚点 + 别名组合：anchor 与解码路径拆列正确', () => {
    const text = '| [[设计#章节甲\\|显]] | b |\n| --- | --- |\n| c | d |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'wikilink').map((e) => [e.target, e.anchor])).toEqual([
      ['设计', '章节甲'],
    ])
  })

  it('表头格与数据格同产边；格内行内代码与跨格伪形态不产边', () => {
    const text = '| [[设计]] [[目标笔记\\|n]] | b |\n| --- | --- |\n| c | d |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    expect(edges.filter((e) => e.kind === 'wikilink').map((e) => e.target)).toEqual(['设计', '目标笔记'])
    const codeCell = '| `[[设计]]` | b |\n| --- | --- |\n| c | d |'
    expect(extractVaultEdges('notes/源.md', codeCell, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
    const pseudo = '| a [[x | y]] b |\n| --- | --- |\n| c | d |'
    expect(extractVaultEdges('notes/源.md', pseudo, CTX, resolverOf(FILES, CTX))).toHaveLength(0)
  })

  it('普通段落行的 \\| 双链仍按原文字面产边（既有语义不扩散）', () => {
    const text = '段 [[设计\\|x]] 段\n'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const wl = edges.find((e) => e.kind === 'wikilink')
    expect(wl).toBeDefined()
    expect(wl!.target).toBe('设计\\')
  })

  it(']] 紧贴转义管道的双链端点：区间不含尾随反斜杠（rename 改写不触达）', () => {
    const text = '| [[设计]]\\|尾 | y |\n| --- | --- |\n| a | b |'
    const edges = extractVaultEdges('notes/源.md', text, CTX, resolverOf(FILES, CTX))
    const wl = edges.find((e) => e.kind === 'wikilink')
    expect(wl).toBeDefined()
    expect(wl!.target).toBe('设计')
    expect(text.slice(wl!.start, wl!.end)).toBe('[[设计]]')
    expect(text[wl!.end]).toBe('\\')
  })
})
