// #199 引用改写计划纯逻辑契约测试：rename/move 的相对路径重算、别名/锚点/
// URL 编码保留、显式扩展名语义、跨根跳过、区间漂移检测、同文档合并与
// 批量映射（#200 接口就绪）。被测模块不依赖 vscode/DOM（node 直驱）。
import { describe, expect, it } from 'vitest'
import {
  lfOffsetToLineCol,
  planVaultRenameRewrites,
  type RenameDocInput,
  type RenameMoveEntry,
  type RenamePlanContext,
} from '../../src/shared/vaultRename'
import type { VaultEdge } from '../../src/shared/vaultIndexModel'

/** 构造一条索引边（区间由用例文本手工定位——与抽取器同语义即可） */
function edge(o: {
  target: string
  resolved: string | null
  kind: VaultEdge['kind']
  start: number
  end: number
  anchor?: string
}): VaultEdge {
  return {
    source: 'ref.md',
    target: o.target,
    resolvedTarget: o.resolved,
    kind: o.kind,
    anchor: o.anchor ?? '',
    start: o.start,
    end: o.end,
  }
}

/** 应用计划到文本（断言辅助——与 vscode 层的区间替换同一偏移语义） */
function applyEdits(text: string, edits: readonly { start: number; end: number; replacement: string }[]): string {
  let out = text
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }
  return out
}

const WIN_ROOT = 'C:/vault'

function winCtx(moves: readonly RenameMoveEntry[], roots: readonly string[] = [WIN_ROOT]): RenamePlanContext {
  return { rootFsPaths: roots, isWindowsHost: true, moves }
}

/** 单文档输入 helper（引用者文档：边根 = 引用者所属根） */
function refDoc(fsPath: string, text: string, edges: readonly VaultEdge[], edgeRoot = WIN_ROOT): RenameDocInput {
  return { fsPath, text, edges, edgeRootFsPath: edgeRoot }
}

describe('vaultRename：指向被移动目标的引用重算', () => {
  it('同目录 rename：双链省略扩展名维持省略，mdlink 显式 .md 保持扩展名', () => {
    const text = '见 [[target]] 与 [x](target.md)。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: text.indexOf('[[target]]'), end: text.indexOf('[[target]]') + '[[target]]'.length }),
      edge({ target: 'target.md', resolved: 'target.md', kind: 'mdlink', start: text.indexOf('[x](target.md)'), end: text.indexOf('[x](target.md)') + '[x](target.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(result.docs).toHaveLength(1)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]] 与 [x](renamed.md)。\n')
  })

  it('双链显式 .md 形态保持显式扩展名', () => {
    const text = '见 [[target.md]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target.md', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target.md]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed.md]]。\n')
  })

  it('锚点与别名原样保留（标题锚、块 id 锚、mdlink fragment 与 query）', () => {
    const text = 'A [[target#标题|别名]] B [[target#^blk1]] C [x](target.md#frag) D [y](target.md?v=1#f)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = (needle: string): { start: number; end: number } => {
      const start = text.indexOf(needle)
      return { start, end: start + needle.length }
    }
    const r1 = at('[[target#标题|别名]]')
    const r2 = at('[[target#^blk1]]')
    const r3 = at('[x](target.md#frag)')
    const r4 = at('[y](target.md?v=1#f)')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', anchor: '标题', ...r1 }),
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', anchor: '^blk1', ...r2 }),
      edge({ target: 'target.md#frag', resolved: 'target.md', kind: 'mdlink', anchor: 'frag', ...r3 }),
      edge({ target: 'target.md?v=1#f', resolved: 'target.md', kind: 'mdlink', ...r4 }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits))
      .toBe('A [[renamed#标题|别名]] B [[renamed#^blk1]] C [x](renamed.md#frag) D [y](renamed.md?v=1#f)\n')
  })

  it('引用者在子目录：按引用者目录重算（上行 ../ 与下行段）', () => {
    // 引用者 C:/vault/notes/ref.md；目标从根移到 notes/renamed.md（下行）
    const text = '见 [[../target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/notes/ref.md`, text, [
      edge({ target: '../target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[../target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]]。\n')

    // 反向：目标从 notes 移到根（引用者需上行）
    const text2 = '见 [[note]]。\n'
    const moves2 = [{ oldFsPath: `${WIN_ROOT}/notes/note.md`, newFsPath: `${WIN_ROOT}/moved.md` }]
    const docs2 = [refDoc(`${WIN_ROOT}/notes/ref.md`, text2, [
      edge({ target: 'note', resolved: 'notes/note.md', kind: 'wikilink', start: 2, end: 2 + '[[note]]'.length }),
    ])]
    const result2 = planVaultRenameRewrites(winCtx(moves2), docs2)
    expect(applyEdits(text2, result2.docs[0]!.edits)).toBe('见 [[../moved]]。\n')
  })

  it('附件目标（图片/pdf）：显式扩展名原样保持，不补 .md', () => {
    const text = '![a](assets/pic.png) 与 [p](docs/手册.pdf)\n'
    const moves = [
      { oldFsPath: `${WIN_ROOT}/assets/pic.png`, newFsPath: `${WIN_ROOT}/assets/图标.png` },
      { oldFsPath: `${WIN_ROOT}/docs/手册.pdf`, newFsPath: `${WIN_ROOT}/docs/handbook.pdf` },
    ]
    const p1 = text.indexOf('![a](assets/pic.png)')
    const p2 = text.indexOf('[p](docs/手册.pdf)')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'assets/pic.png', resolved: 'assets/pic.png', kind: 'image', start: p1, end: p1 + '![a](assets/pic.png)'.length }),
      edge({ target: 'docs/手册.pdf', resolved: 'docs/手册.pdf', kind: 'mdlink', start: p2, end: p2 + '[p](docs/手册.pdf)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('![a](assets/图标.png) 与 [p](docs/handbook.pdf)\n')
  })

  it('引用式链接定义（refdef）同样改写且保留标题', () => {
    const text = '[ref]: target.md "显示标题"\n\n见 [x][ref]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const p = text.indexOf('[ref]: target.md')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target.md', resolved: 'target.md', kind: 'refdef', start: p, end: p + '[ref]: target.md "显示标题"'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[ref]: renamed.md "显示标题"\n\n见 [x][ref]。\n')
  })
})

describe('vaultRename：URL 编码与字面形态跟随', () => {
  it('原目标为 percent-encode 形态时新路径按同风格编码', () => {
    const text = '[x](%E7%AC%94%E8%AE%B0.md)\n' // 笔记.md
    const moves = [{ oldFsPath: `${WIN_ROOT}/笔记.md`, newFsPath: `${WIN_ROOT}/新名.md` }]
    const p = 0
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: '%E7%AC%94%E8%AE%B0.md', resolved: '笔记.md', kind: 'mdlink', start: p, end: p + '[x](%E7%AC%94%E8%AE%B0.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[x](%E6%96%B0%E5%90%8D.md)\n')
  })

  it('原目标为字面中文时不编码，新路径保持字面', () => {
    const text = '[x](笔记.md)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/笔记.md`, newFsPath: `${WIN_ROOT}/新名.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: '笔记.md', resolved: '笔记.md', kind: 'mdlink', start: 0, end: '[x](笔记.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[x](新名.md)\n')
  })

  it('宽松链接（字面空格目标）改写后保持字面空格形态', () => {
    const text = '见 [文档](my note.md) 正文。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/my note.md`, newFsPath: `${WIN_ROOT}/your note.md` }]
    const p = text.indexOf('[文档](my note.md)')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'my note.md', resolved: 'my note.md', kind: 'mdlink', start: p, end: p + '[文档](my note.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [文档](your note.md) 正文。\n')
  })

  it('尖括号包裹形态替换整个包裹段（无空格新路径不再需要包裹）', () => {
    const text = '[x](<a b.md>)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/a b.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'a b.md', resolved: 'a b.md', kind: 'mdlink', start: 0, end: '[x](<a b.md>)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[x](renamed.md)\n')
  })

  it('编码风格新路径含空格时保持 <> 包裹（可解析形态）', () => {
    const text = '[x](%E7%AC%94%E8%AE%B0.md)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/笔记.md`, newFsPath: `${WIN_ROOT}/新 名.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: '%E7%AC%94%E8%AE%B0.md', resolved: '笔记.md', kind: 'mdlink', start: 0, end: '[x](%E7%AC%94%E8%AE%B0.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    // 编码风格：空格 %20，无需 <>
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[x](%E6%96%B0%20%E5%90%8D.md)\n')
  })

  it('wikilink 路径段带首尾空白：整段替换并吃掉空白（语义不变）', () => {
    const text = '见 [[ target ]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const p = text.indexOf('[[ target ]]')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: p, end: p + '[[ target ]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]]。\n')
  })
})

describe('vaultRename：被移动文档自身的出链重算', () => {
  it('移入子目录后按新目录重算上行与下行出链', () => {
    const text = '见 [[other]] 与 [y](sub/note.md)。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/sub/deep/renamed.md` }]
    const p1 = text.indexOf('[[other]]')
    const p2 = text.indexOf('[y](sub/note.md)')
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/sub/deep/renamed.md`, // 应用目标 = 新路径
      text,
      edges: [
        edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: p1, end: p1 + '[[other]]'.length }),
        edge({ target: 'sub/note.md', resolved: 'sub/note.md', kind: 'mdlink', start: p2, end: p2 + '[y](sub/note.md)'.length }),
      ],
      edgeRootFsPath: WIN_ROOT, // 边的 resolvedTarget 仍基于旧根（= 本根）
    }]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[../../other]] 与 [y](../note.md)。\n')
  })

  it('自引用（本文件锚点）不改写路径（target 为空串）', () => {
    const text = '见 [[#标题]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/sub/renamed.md` }]
    const p = text.indexOf('[[#标题]]')
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/sub/renamed.md`,
      text,
      edges: [edge({ target: '', resolved: 'target.md', kind: 'wikilink', anchor: '标题', start: p, end: p + '[[#标题]]'.length })],
      edgeRootFsPath: WIN_ROOT,
    }]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]?.edits ?? [])).toBe('见 [[#标题]]。\n')
  })

  it('指向同批被移动目标的出链按映射表统一改（#200 批量接口就绪）', () => {
    // a.md 与 b.md 同批移动；a 引用 b，c 引用 a
    const textA = '见 [[b]]。\n'
    const textC = '见 [[a]]。\n'
    const moves = [
      { oldFsPath: `${WIN_ROOT}/a.md`, newFsPath: `${WIN_ROOT}/x/a2.md` },
      { oldFsPath: `${WIN_ROOT}/b.md`, newFsPath: `${WIN_ROOT}/y/b2.md` },
    ]
    const docs: RenameDocInput[] = [
      { fsPath: `${WIN_ROOT}/x/a2.md`, text: textA, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: 'b', resolved: 'b.md', kind: 'wikilink', start: 2, end: 2 + '[[b]]'.length }),
      ] },
      refDoc(`${WIN_ROOT}/c.md`, textC, [
        edge({ target: 'a', resolved: 'a.md', kind: 'wikilink', start: 2, end: 2 + '[[a]]'.length }),
      ]),
    ]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(textA, result.docs[0]!.edits)).toBe('见 [[../y/b2]]。\n')
    expect(applyEdits(textC, result.docs[1]!.edits)).toBe('见 [[x/a2]]。\n')
  })
})

describe('vaultRename：跳过项与保护', () => {
  it('跨根移动：不生成跨根相对引用，引用者与出链均跳过并报告', () => {
    const textRef = '见 [[target]]。\n'
    const textMoved = '见 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'C:/other-root/target.md' }]
    const docs = [
      refDoc(`${WIN_ROOT}/ref.md`, textRef, [
        edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
      ]),
      // 被移动文档自身移出根（无根空间）：其出链无法保持根内引用
      { fsPath: 'C:/other-root/target.md', text: textMoved, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: 2, end: 2 + '[[other]]'.length }),
      ] },
    ]
    const result = planVaultRenameRewrites(winCtx(moves, [WIN_ROOT, 'C:/other-root']), docs)
    expect(result.docs).toEqual([])
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped.every((s) => s.reason === 'cross-root')).toBe(true)
    // 原文未变（计划为空即无改写）
    expect(applyEdits(textRef, [])).toBe(textRef)
  })

  it('移出全部根（工作区外）：出链全部跳过', () => {
    const text = '见 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'D:/outside/target.md' }]
    const docs: RenameDocInput[] = [{
      fsPath: 'D:/outside/target.md',
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: 2, end: 2 + '[[other]]'.length })],
    }]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toEqual([])
    expect(result.skipped[0]!.reason).toBe('cross-root')
  })

  it('区间漂移：当前文本与索引基线不一致时整文档跳过（edge-stale）', () => {
    // 索引边区间仍指旧位置，但文档在链接前插入了一行——区间文本不再是该链接
    const baseline = '见 [[target]]。\n'
    const current = '新插入的一行\n见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, current, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toEqual([])
    expect(result.skipped[0]!.reason).toBe('edge-stale')
    expect(result.skipped[0]!.fsPath).toBe(`${WIN_ROOT}/ref.md`)
    expect(baseline).toContain('[[target]]')
  })

  it('区间文本恰为其他链接（目标不符）也按 stale 跳过', () => {
    // 区间 slice 出的是指向别处的链接——基线与当前文本不一致的另一种形态
    const current = '见 [[another]] [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, current, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 5, end: 5 + '[[another]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toEqual([])
    expect(result.skipped[0]!.reason).toBe('edge-stale')
  })

  it('断链边与外链边（resolvedTarget=null）不改写', () => {
    const text = '断链 [[gone]] 与外链 [x](https://e.com/a)。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const p1 = text.indexOf('[[gone]]')
    const p2 = text.indexOf('[x](https://e.com/a)')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'gone', resolved: null, kind: 'wikilink', start: p1, end: p1 + '[[gone]]'.length }),
      edge({ target: 'https://e.com/a', resolved: null, kind: 'mdlink', start: p2, end: p2 + '[x](https://e.com/a)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('同一文档多处命中合并为单一计划（edits 按区间升序不重叠）', () => {
    const text = '一 [[target]] 二 [[target]] 三 [x](target.md)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const p1 = text.indexOf('[[target]]')
    const p2 = text.indexOf('[[target]]', p1 + 1)
    const p3 = text.indexOf('[x](target.md)')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target.md', resolved: 'target.md', kind: 'mdlink', start: p3, end: p3 + '[x](target.md)'.length }),
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: p2, end: p2 + '[[target]]'.length }),
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: p1, end: p1 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toHaveLength(1)
    const edits = result.docs[0]!.edits
    expect(edits).toHaveLength(3)
    for (let i = 1; i < edits.length; i++) {
      expect(edits[i]!.start).toBeGreaterThanOrEqual(edits[i - 1]!.end)
    }
    expect(applyEdits(text, edits)).toBe('一 [[renamed]] 二 [[renamed]] 三 [x](renamed.md)\n')
  })

  it('引用者与被移动文档同时改写时各自成计划（fsPath 分别为原路径与新路径）', () => {
    const textRef = '见 [[target]]。\n'
    const textMoved = '出链 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/sub/renamed.md` }]
    const docs = [
      refDoc(`${WIN_ROOT}/ref.md`, textRef, [
        edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
      ]),
      { fsPath: `${WIN_ROOT}/sub/renamed.md`, text: textMoved, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: 3, end: 3 + '[[other]]'.length }),
      ] },
    ]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs.map((d) => d.fsPath)).toEqual([`${WIN_ROOT}/ref.md`, `${WIN_ROOT}/sub/renamed.md`])
    expect(applyEdits(textRef, result.docs[0]!.edits)).toBe('见 [[sub/renamed]]。\n')
    expect(applyEdits(textMoved, result.docs[1]!.edits)).toBe('出链 [[../other]]。\n')
  })
})

describe('vaultRename：平台语义', () => {
  it('Windows：反斜杠路径与大小写折叠匹配（NTFS 语义）', () => {
    const text = '见 [[target]]。\n'
    // moves 用反斜杠 + 大小写异形（C:/VAULT vs C:\vault）
    const moves = [{ oldFsPath: 'C:\\VAULT\\Target.MD', newFsPath: 'C:\\vault\\renamed.md' }]
    const docs = [refDoc('C:\\vault\\ref.md', text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]]。\n')
  })

  it('POSIX：大小写敏感、反斜杠是普通字符', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: '/vault/target.md', newFsPath: '/vault/renamed.md' }]
    const docs = [refDoc('/vault/ref.md', text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ], '/vault')]
    const result = planVaultRenameRewrites({ rootFsPaths: ['/vault'], isWindowsHost: false, moves }, docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]]。\n')

    // 大小写不折叠：Target.MD 不命中 target.md
    const movesCase = [{ oldFsPath: '/vault/Target.MD', newFsPath: '/vault/renamed.md' }]
    const resultCase = planVaultRenameRewrites({ rootFsPaths: ['/vault'], isWindowsHost: false, moves: movesCase }, docs)
    expect(resultCase.docs).toEqual([])
  })
})

describe('vaultRename：LF 偏移 → 宿主行/列换算（vscode 层坐标桥）', () => {
  it('LF 文本（无 \r）：行/列与直接按 LF 拆分一致', () => {
    const host = 'aa\nbb\nccc\n'
    expect(lfOffsetToLineCol(host, 0)).toEqual({ line: 0, character: 0 })
    expect(lfOffsetToLineCol(host, 3)).toEqual({ line: 1, character: 0 })
    expect(lfOffsetToLineCol(host, 5)).toEqual({ line: 1, character: 2 })
    expect(lfOffsetToLineCol(host, 6)).toEqual({ line: 2, character: 0 })
    expect(lfOffsetToLineCol(host, 9)).toEqual({ line: 2, character: 3 })
  })

  it('CRLF 宿主文本：\r 不计入列，LF 偏移跨行界推进', () => {
    const host = 'aa\r\nbb\r\nccc\r\n'
    expect(lfOffsetToLineCol(host, 0)).toEqual({ line: 0, character: 0 })
    expect(lfOffsetToLineCol(host, 2)).toEqual({ line: 0, character: 2 })
    expect(lfOffsetToLineCol(host, 3)).toEqual({ line: 1, character: 0 }) // LF 行 1 首（跨过 \r\n）
    expect(lfOffsetToLineCol(host, 5)).toEqual({ line: 1, character: 2 })
    expect(lfOffsetToLineCol(host, 6)).toEqual({ line: 2, character: 0 })
  })

  it('混合行尾与越界防御（钳到文末）', () => {
    const host = 'a\r\nb\nc'
    expect(lfOffsetToLineCol(host, 2)).toEqual({ line: 1, character: 0 })
    expect(lfOffsetToLineCol(host, 4)).toEqual({ line: 2, character: 0 })
    expect(lfOffsetToLineCol(host, 99)).toEqual({ line: 2, character: 1 })
  })
})
