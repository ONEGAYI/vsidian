// #199 引用改写计划纯逻辑契约测试：rename/move 的相对路径重算、别名/锚点/
// URL 编码保留、显式扩展名语义、跨根跳过、区间漂移检测、同文档合并与
// 批量映射（#200 接口就绪）。
// #200 目录/批量移动：映射展开（目录 → 逐文件）与恒等替换滤除契约。
// 被测模块不依赖 vscode/DOM（node 直驱）。
import { describe, expect, it } from 'vitest'
import {
  expandRenameMoves,
  lfOffsetToLineCol,
  planRenameExistsProbes,
  planVaultRenameRewrites,
  renameNoticeKeyOf,
  type RenameDocInput,
  type RenameExpandPort,
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
  it('跨根移动：短名原文改写为明确绝对路径（不再跳过，省略扩展名维持省略）', () => {
    // #556 T4：目标越出来源根 → 明确绝对路径保留身份（替代 cross-root 跳过）
    const textRef = '见 [[target]]。\n'
    const textMoved = '见 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'C:/other-root/target.md' }]
    const docs = [
      refDoc(`${WIN_ROOT}/ref.md`, textRef, [
        edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
      ]),
      // 被移动文档自身移出根（新根空间）：其出链对旧根目标的相对路径越界 → 绝对
      { fsPath: 'C:/other-root/target.md', text: textMoved, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: 2, end: 2 + '[[other]]'.length }),
      ] },
    ]
    const result = planVaultRenameRewrites(winCtx(moves, [WIN_ROOT, 'C:/other-root']), docs)
    expect(result.skipped).toEqual([]) // 跨根不再跳过
    expect(applyEdits(textRef, result.docs[0]!.edits)).toBe('见 [[C:/other-root/target]]。\n')
    expect(applyEdits(textMoved, result.docs[1]!.edits)).toBe('见 [[C:/vault/other]]。\n')
  })

  it('移出全部根（工作区外）：出链同样改写为绝对路径（无根不等于无解）', () => {
    const text = '见 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'D:/outside/target.md' }]
    const docs: RenameDocInput[] = [{
      fsPath: 'D:/outside/target.md',
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [edge({ target: 'other', resolved: 'other.md', kind: 'wikilink', start: 2, end: 2 + '[[other]]'.length })],
    }]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[C:/vault/other]]。\n')
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

// ---- #200 目录/批量移动映射展开 ----

/** 展开端口 fake：dirs 显式目录集合；filesUnder = listFilesUnder 返回；
 *  indexed = 索引清单（null = 根未就绪；缺省该前缀无登记）；scope 缺省
 *  全域内（域外行为由 spy 端口用例专门钉） */
function expandPort(o: {
  dirs?: readonly string[]
  filesUnder?: Record<string, string[]>
  indexed?: Record<string, string[] | null>
}): RenameExpandPort {
  const dirs = new Set((o.dirs ?? []).map((d) => d.toLowerCase()))
  return {
    async isDirectory(fsPath: string) {
      return dirs.has(fsPath.toLowerCase())
    },
    async listFilesUnder(dirFsPath: string) {
      return o.filesUnder?.[dirFsPath] ?? []
    },
    indexedFilesUnder(dirFsPath: string) {
      const value = o.indexed?.[dirFsPath]
      return value === undefined ? [] : value
    },
    isIndexedScope() {
      return true
    },
  }
}

/** moves 集合断言辅助（顺序无关；展开按目录列举序、断言按排序对齐） */
function movesOf(moves: readonly RenameMoveEntry[]): Array<[string, string]> {
  return moves.map((m) => [m.oldFsPath.replace(/\\/g, '/'), m.newFsPath.replace(/\\/g, '/')] as [string, string])
    .sort((a, b) => a[0]!.localeCompare(b[0]!))
}

describe('vaultRename：#200 目录移动映射展开（expandRenameMoves）', () => {
  it('目录 rename：展开为目录下全部受影响文件的逐文件映射（嵌套多层 + 索引 asset + fs 遗漏 md 兜底）', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/dir-old`],
      // fs 递归列举：.md 全列（含索引遗漏的 new.md）；非 md 也列出但不应入映射
      filesUnder: { [`${WIN_ROOT}/dir-old`]: [
        `${WIN_ROOT}/dir-old/a.md`,
        `${WIN_ROOT}/dir-old/deep/b.md`,
        `${WIN_ROOT}/dir-old/new-not-indexed.md`,
        `${WIN_ROOT}/dir-old/unreferenced.bin`,
      ] },
      // 索引清单：.md 与被引用 asset（pic.png 被 dir-ref 引用而登记）
      indexed: { [`${WIN_ROOT}/dir-old`]: [
        `${WIN_ROOT}/dir-old/a.md`,
        `${WIN_ROOT}/dir-old/deep/b.md`,
        `${WIN_ROOT}/dir-old/pic.png`,
      ] },
    })
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old`, newFsPath: `${WIN_ROOT}/dir-new` },
    ], port)
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/dir-old/a.md`, `${WIN_ROOT}/dir-new/a.md`],
      [`${WIN_ROOT}/dir-old/deep/b.md`, `${WIN_ROOT}/dir-new/deep/b.md`],
      [`${WIN_ROOT}/dir-old/new-not-indexed.md`, `${WIN_ROOT}/dir-new/new-not-indexed.md`],
      [`${WIN_ROOT}/dir-old/pic.png`, `${WIN_ROOT}/dir-new/pic.png`],
    ])
  })

  it('review-loops #12：父子目录同批移动时最具体（子）目录先展开，父展开不吞并子映射', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/a`, `${WIN_ROOT}/a/b`],
      filesUnder: {
        [`${WIN_ROOT}/a`]: [`${WIN_ROOT}/a/x.md`, `${WIN_ROOT}/a/b/y.md`],
        [`${WIN_ROOT}/a/b`]: [`${WIN_ROOT}/a/b/y.md`],
      },
      indexed: {},
    })
    // 同批嵌套对：a → x，a/b → x/y（宿主通常只给顶级映射；此为防御形态）
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/a`, newFsPath: `${WIN_ROOT}/x` },
      { oldFsPath: `${WIN_ROOT}/a/b`, newFsPath: `${WIN_ROOT}/x/y` },
    ], port)
    // 子目录 b 的文件按自身映射去 x/y（而非被父展开吞到 x/b）
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/a/b/y.md`, `${WIN_ROOT}/x/y/y.md`],
      [`${WIN_ROOT}/a/x.md`, `${WIN_ROOT}/x/x.md`],
    ])
  })

  it('文件条目原样保留：目录与文件混合批（多选移动）', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/dir-old`],
      filesUnder: { [`${WIN_ROOT}/dir-old`]: [`${WIN_ROOT}/dir-old/a.md`] },
    })
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old`, newFsPath: `${WIN_ROOT}/dir-new` },
      { oldFsPath: `${WIN_ROOT}/single.md`, newFsPath: `${WIN_ROOT}/single2.md` },
    ], port)
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/dir-old/a.md`, `${WIN_ROOT}/dir-new/a.md`],
      [`${WIN_ROOT}/single.md`, `${WIN_ROOT}/single2.md`],
    ])
  })

  it('同 old 重复映射去重（Windows 大小写折叠；显式文件条目优先于展开）', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/DIR-OLD`],
      filesUnder: { [`${WIN_ROOT}/DIR-OLD`]: [`${WIN_ROOT}/DIR-OLD/a.md`] },
    })
    // 同批既有目录条目又有其子文件条目（防御形态）：同 old 折叠后保留先到者
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old/a.md`, newFsPath: `${WIN_ROOT}/explicit.md` },
      { oldFsPath: `${WIN_ROOT}/DIR-OLD`, newFsPath: `${WIN_ROOT}/dir-new` },
    ], port)
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/dir-old/a.md`, `${WIN_ROOT}/explicit.md`],
    ])
  })

  it('索引未就绪（null）：目录整体放弃并入计数（不静默部分更新）', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/dir-old`],
      filesUnder: { [`${WIN_ROOT}/dir-old`]: [
        `${WIN_ROOT}/dir-old/a.md`,
        `${WIN_ROOT}/dir-old/pic.png`,
      ] },
      indexed: { [`${WIN_ROOT}/dir-old`]: null },
    })
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old`, newFsPath: `${WIN_ROOT}/dir-new` },
    ], port)
    // not-ready 根的候选边查询与批量刷新同样无效——fs 清单也不采（避免
    // 只刷新不改写的半吊子部分更新）
    expect(result.moves).toEqual([])
    expect(result.notReadyMoves).toBe(1)
  })

  it('did 保底：旧路径已不存在（isDirectory 旧 false）但新路径是目录 → 按索引清单展开', async () => {
    // did 阶段旧目录已消失：listFilesUnder 返回空；索引仍是旧形态（watcher
    // 对目录 rename 无逐文件事件，#198 实测边界）
    const port = expandPort({
      dirs: [`${WIN_ROOT}/dir-new`],
      filesUnder: {},
      indexed: { [`${WIN_ROOT}/dir-old`]: [
        `${WIN_ROOT}/dir-old/a.md`,
        `${WIN_ROOT}/dir-old/deep/b.md`,
        `${WIN_ROOT}/dir-old/pic.png`,
      ] },
    })
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old`, newFsPath: `${WIN_ROOT}/dir-new` },
    ], port)
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/dir-old/a.md`, `${WIN_ROOT}/dir-new/a.md`],
      [`${WIN_ROOT}/dir-old/deep/b.md`, `${WIN_ROOT}/dir-new/deep/b.md`],
      [`${WIN_ROOT}/dir-old/pic.png`, `${WIN_ROOT}/dir-new/pic.png`],
    ])
  })

  it('跨根目录移动同样按前缀展开（新绝对路径在另一根下）', async () => {
    const port = expandPort({
      dirs: [`${WIN_ROOT}/dir-old`],
      filesUnder: { [`${WIN_ROOT}/dir-old`]: [`${WIN_ROOT}/dir-old/a.md`] },
      indexed: { [`${WIN_ROOT}/dir-old`]: [`${WIN_ROOT}/dir-old/a.md`] },
    })
    const result = await expandRenameMoves(true, [
      { oldFsPath: `${WIN_ROOT}/dir-old`, newFsPath: 'D:/other-root/dir-new' },
    ], port)
    expect(movesOf(result.moves)).toEqual([
      [`${WIN_ROOT}/dir-old/a.md`, 'D:/other-root/dir-new/a.md'],
    ])
  })

  it('三审 P2：外部目录（索引域外）不做 fs 递归列举——登记身份前缀仍映射', async () => {
    // #556 冻结规格「外部只登记明确引用目标，不扫描目录」：域外目录跳过
    // listFilesUnder（isDirectory 定点 stat 允许），映射只来自已登记身份
    const listCalls: string[] = []
    const port: RenameExpandPort = {
      async isDirectory(fsPath: string) {
        return fsPath.replaceAll('\\', '/') === 'E:/ext/old'
      },
      async listFilesUnder(dirFsPath: string) {
        listCalls.push(dirFsPath)
        return []
      },
      indexedFilesUnder(dirFsPath: string) {
        return dirFsPath.replaceAll('\\', '/') === 'E:/ext/old'
          ? ['E:/ext/old/target.md', 'E:/ext/old/nested/other.png']
          : []
      },
      isIndexedScope(fsPath: string) {
        return !fsPath.replaceAll('\\', '/').startsWith('E:/')
      },
    }
    const result = await expandRenameMoves(true, [{ oldFsPath: 'E:\\ext\\old', newFsPath: 'E:\\ext\\new' }], port)
    expect(listCalls).toEqual([]) // 不调用外部目录扫描
    expect(result.notReadyMoves).toBe(0)
    expect(result.moves.map((m) => [m.oldFsPath, m.newFsPath].map((p) => p.replaceAll('\\', '/')) as [string, string])
      .sort((a, b) => a[0]!.localeCompare(b[0]!))).toEqual([
      ['E:/ext/old/nested/other.png', 'E:/ext/new/nested/other.png'],
      ['E:/ext/old/target.md', 'E:/ext/new/target.md'],
    ])
  })

  it('三审 P2：索引域内目录照常 fs 递归列举（域内外合批互不干扰）', async () => {
    const listCalls: string[] = []
    const port: RenameExpandPort = {
      async isDirectory() {
        return true
      },
      async listFilesUnder(dirFsPath: string) {
        listCalls.push(dirFsPath)
        return dirFsPath === '/vault/dir' ? ['/vault/dir/fs-only.md'] : []
      },
      indexedFilesUnder(dirFsPath: string) {
        if (dirFsPath === '/vault/dir') {
          return ['/vault/dir/referenced.png']
        }
        return dirFsPath === '/external/old' ? ['/external/old/x.md'] : []
      },
      isIndexedScope(fsPath: string) {
        return fsPath.startsWith('/vault')
      },
    }
    const result = await expandRenameMoves(false, [
      { oldFsPath: '/vault/dir', newFsPath: '/vault/moved' },
      { oldFsPath: '/external/old', newFsPath: '/external/new' },
    ], port)
    expect(listCalls).toEqual(['/vault/dir']) // 仅域内目录列举
    expect(result.moves.map((m) => [m.oldFsPath, m.newFsPath].join('=>')).sort()).toEqual([
      '/external/old/x.md=>/external/new/x.md',
      '/vault/dir/fs-only.md=>/vault/moved/fs-only.md',
      '/vault/dir/referenced.png=>/vault/moved/referenced.png',
    ])
  })
})

describe('vaultRename：三审 P2 存在性预取计划（外部不扫描，定点 stat）', () => {
  const inVault = (p: string): boolean => p.replaceAll('\\', '/').toLowerCase().startsWith('c:/vault/')

  it('域内目录整列举；域外目录不列举、其 move 用有界定点（本体 + 去 .md 变体）', () => {
    const plan = planRenameExistsProbes(
      true,
      ['C:/vault'],
      [
        { oldFsPath: 'C:\\vault\\data\\old.md', newFsPath: 'C:\\vault\\data\\renamed.md' },
        { oldFsPath: 'E:\\ext\\old\\target.md', newFsPath: 'E:\\ext\\new\\target.md' },
        { oldFsPath: 'E:\\ext\\pic.png', newFsPath: 'E:\\ext\\pic2.png' },
      ],
      [{ fsPath: 'C:\\vault\\notes\\source.md', edgeRootFsPath: 'C:/vault', edges: [] }],
      inVault,
    )
    expect(plan.listDirs.map((d) => d.replaceAll('\\', '/')).sort()).toEqual([
      'C:/vault/data',
      'C:/vault/notes',
    ])
    // 外部 move 定点：本体 + .md 去 tail 变体（回验候选序落点）；非 .md 无变体
    expect(plan.statFiles.map((p) => p.replaceAll('\\', '/')).sort()).toEqual([
      'E:/ext/new/target', // 去 .md 变体（无扩展遮蔽物探测；字典序前缀短者在前）
      'E:/ext/new/target.md',
      'E:/ext/pic2.png',
    ])
  })

  it('域外 doc 目录不列举（无根文档决策恒绝对）；去重稳定', () => {
    const plan = planRenameExistsProbes(
      false,
      ['/vault'],
      [
        { oldFsPath: '/vault/a.md', newFsPath: '/vault/b.md' },
        { oldFsPath: '/vault/x.md', newFsPath: '/vault/sub/x.md' },
      ],
      [
        { fsPath: '/external/docs/moved.md', edgeRootFsPath: '/vault', edges: [] },
        { fsPath: '/vault/ref.md', edgeRootFsPath: '/vault', edges: [] },
      ],
      (p: string) => p.startsWith('/vault'),
    )
    expect([...plan.listDirs].sort()).toEqual(['/vault', '/vault/sub'])
    expect(plan.statFiles).toEqual([]) // 域内 move：readDirectory ∪ moves 覆盖，无定点
  })
})

describe('vaultRename：四审 P2-2 预取候选覆盖待规划边（未移动目标遮蔽探测）', () => {
  it('来源单独移出根、目标未动：目标目录的裸名/显式候选进定点集（目录集覆盖不到）', () => {
    const plan = planRenameExistsProbes(
      false,
      ['/vault'],
      [{ oldFsPath: '/vault/notes/source.md', newFsPath: '/external/source.md' }],
      [{
        fsPath: '/external/source.md',
        edgeRootFsPath: '/vault',
        edges: [edge({ target: 'target', resolved: '/vault/data/target.md', kind: 'wikilink', start: 0, end: 11 })],
      }],
      (p: string) => p.startsWith('/vault'),
    )
    // move 域外、doc（新来源）域外 → 无目录列举
    expect(plan.listDirs).toEqual([])
    const stats = plan.statFiles.map((p) => p)
    // 未移动目标的遮蔽候选（评审反例：目标目录被排除的无扩展遮蔽物——
    // catalog 域外，目录集也覆盖不到，只能定点 stat）
    expect(stats).toContain('/vault/data/target')
    expect(stats).toContain('/vault/data/target.md')
    // 域外 move 定点（本体 + 去 .md 变体）
    expect(stats).toContain('/external/source')
    expect(stats).toContain('/external/source.md')
    // 无根 selfMove 的绝对文本候选（新 basename 同目录落点）
    expect(stats).toContain('/external/target')
    expect(stats).toContain('/external/target.md')
  })

  it('来源移到另一根：目标未动的去 .md 绝对文本被遮蔽 → 终审降级显式 .md 绝对', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: 'C:/vault/notes/source.md', newFsPath: 'D:/other/source.md' }]
    const docs = [{
      fsPath: 'D:/other/source.md',
      text,
      edgeRootFsPath: 'C:/vault',
      edges: [edge({ target: 'target', resolved: 'C:/vault/data/target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length })],
    }]
    // 存在集模拟接线端口（定点 stat 可见被排除遮蔽物 C:/vault/data/target）
    const ctx = (shadow: boolean): RenamePlanContext => ({
      rootFsPaths: ['C:/vault', 'D:/other'],
      isWindowsHost: true,
      moves,
      shortnameLookup: () => ({ candidates: [], complete: true }),
      targetExists: (p: string) => {
        const norm = p.replaceAll('\\', '/').toLowerCase()
        if (norm === 'c:/vault/data/target.md') {
          return true
        }
        return shadow && norm === 'c:/vault/data/target'
      },
    })
    // 控制例（无遮蔽）：去 .md 绝对文本候选序直击目标 → 裸绝对形态
    const bare = planVaultRenameRewrites(ctx(false), docs)
    expect(applyEdits(text, bare.docs[0]!.edits)).toBe('见 [[C:/vault/data/target]]。\n')
    // 反例（遮蔽在场，catalog 域外）：裸绝对命中遮蔽物 → 显式 .md 绝对
    const explicit = planVaultRenameRewrites(ctx(true), docs)
    expect(applyEdits(text, explicit.docs[0]!.edits)).toBe('见 [[C:/vault/data/target.md]]。\n')
  })
})

describe('vaultRename：四审 P2-3 无根文档不保留短名/相对（消费层 no-workspace）', () => {
  it('来源目标同批移出根：短名改写为明确绝对路径（同目录命中不构成可解析）', () => {
    const text = '见 [[target]]。\n'
    const moves = [
      { oldFsPath: 'C:/vault/notes/source.md', newFsPath: 'E:/ext/source.md' },
      { oldFsPath: 'C:/vault/data/target.md', newFsPath: 'E:/ext/target.md' },
    ]
    const docs = [{
      fsPath: 'E:/ext/source.md',
      text,
      edgeRootFsPath: 'C:/vault',
      edges: [edge({ target: 'target', resolved: 'C:/vault/data/target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length })],
    }]
    // did 时刻存在集：新路径已落盘（含 moves 新路径）；无遮蔽
    const noShadow = planVaultRenameRewrites({
      rootFsPaths: ['C:/vault'], isWindowsHost: true, moves,
      targetExists: (p) => p.replaceAll('\\', '/').toLowerCase() === 'e:/ext/target.md',
    }, docs)
    // 无根文档：短名不可保留 → 绝对形态；原文省略扩展 → 裸绝对（候选序
    // [.md 变体] 命中目标，消费层绝对形态无根也独立解析）
    expect(applyEdits(text, noShadow.docs[0]!.edits)).toBe('见 [[E:/ext/target]]。\n')
    // 反例：新目录有无扩展遮蔽物 → 显式 .md 绝对（裸候选被抢占）
    const shadowed = planVaultRenameRewrites({
      rootFsPaths: ['C:/vault'], isWindowsHost: true, moves,
      targetExists: (p) => {
        const norm = p.replaceAll('\\', '/').toLowerCase()
        return norm === 'e:/ext/target.md' || norm === 'e:/ext/target'
      },
    }, docs)
    expect(applyEdits(text, shadowed.docs[0]!.edits)).toBe('见 [[E:/ext/target.md]]。\n')
  })

  it('无根文档的相对原文同样改写为绝对（不进入相对重算）', () => {
    const text = '上行 [[../c-out]]。\n'
    const moves = [{ oldFsPath: 'C:/vault/notes/source.md', newFsPath: 'E:/ext/source.md' }]
    const docs = [{
      fsPath: 'E:/ext/source.md',
      text,
      edgeRootFsPath: 'C:/vault',
      edges: [edge({ target: '../c-out', resolved: 'C:/vault/c-out.md', kind: 'wikilink', start: 3, end: 3 + '[[../c-out]]'.length })],
    }]
    const result = planVaultRenameRewrites({
      rootFsPaths: ['C:/vault'], isWindowsHost: true, moves,
      targetExists: (p) => p.replaceAll('\\', '/').toLowerCase() === 'c:/vault/c-out.md',
    }, docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('上行 [[C:/vault/c-out]]。\n')
  })

  it('控制例：文档仍在根内时短名/相对域照常（无根守卫不误伤）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: 'C:/vault/notes/target.md', newFsPath: 'C:/vault/data/target.md' }]
    const docs = [{
      fsPath: 'C:/vault/notes/source.md',
      text,
      edgeRootFsPath: 'C:/vault',
      edges: [edge({ target: 'target', resolved: 'notes/target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length })],
    }]
    // 同根纯移动 + 短名补查唯一 → 保留短名（零编辑）
    const result = planVaultRenameRewrites({
      rootFsPaths: ['C:/vault'], isWindowsHost: true, moves,
      shortnameLookup: (_src: string, basename: string) =>
        basename === 'target.md' ? { candidates: ['C:/vault/data/target.md'], complete: true } : { candidates: [], complete: true },
      targetExists: (p) => p.replaceAll('\\', '/').toLowerCase() === 'c:/vault/data/target.md',
    }, docs)
    expect(result.docs).toEqual([])
  })
})

describe('vaultRename：#200 恒等替换滤除', () => {
  it('目录整体平移：同目录互链的相对路径不变 → 不产生编辑（不重复替换）', () => {
    // dir-old → dir-new（a 与 b 同批移动——目录展开后的映射形态）：a 与 b
    // 同目录，a 的 [[b]] 经映射重算后仍为 b（相对关系保持）→ 恒等滤除。
    // 反例（只移 a 不移 b）不是恒等：b 留在 dir-old，a 的 [[b]] 须改
    // ../dir-old/b——该语义由「指向同批被移动目标的出链」既有用例族覆盖
    const textA = '见 [[b]]。\n'
    const moves = [
      { oldFsPath: `${WIN_ROOT}/dir-old/a.md`, newFsPath: `${WIN_ROOT}/dir-new/a.md` },
      { oldFsPath: `${WIN_ROOT}/dir-old/b.md`, newFsPath: `${WIN_ROOT}/dir-new/b.md` },
    ]
    const docs: RenameDocInput[] = [
      { fsPath: `${WIN_ROOT}/dir-new/a.md`, text: textA, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: 'b', resolved: 'dir-old/b.md', kind: 'wikilink', start: 2, end: 2 + '[[b]]'.length }),
      ] },
    ]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toEqual([]) // 恒等替换滤除：无编辑即无计划文档
    expect(result.skipped).toEqual([])
  })

  it('目录跨深度移动后相对路径确有变化时照常改写（滤除不影响真替换）', () => {
    // dir-old → sub/dir-old：a 的上行出链 [[../c]] 须变 [[../../c]]
    const textA = '上行 [[../c]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/dir-old/a.md`, newFsPath: `${WIN_ROOT}/sub/dir-old/a.md` }]
    const docs: RenameDocInput[] = [
      { fsPath: `${WIN_ROOT}/sub/dir-old/a.md`, text: textA, edgeRootFsPath: WIN_ROOT, edges: [
        edge({ target: '../c', resolved: 'c.md', kind: 'wikilink', start: 3, end: 3 + '[[../c]]'.length }),
      ] },
    ]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(textA, result.docs[0]!.edits)).toBe('上行 [[../../c]]。\n')
  })
})

describe('renameNoticeKeyOf 通知文案键决策（review-loops #1）', () => {
  const log = (plannedEdits: number, skipped: number, indexNotReady: number) => ({
    plannedEdits,
    skipped: Array.from({ length: skipped }, () => ({})),
    indexNotReady,
  })
  it('纯索引未就绪（无编辑、无跳过）归因 host.renameRefsIndexNotReady', () => {
    expect(renameNoticeKeyOf(log(0, 0, 2))).toBe('host.renameRefsIndexNotReady')
  })
  it('混合未更新（跳过与未就绪并存）沿用 host.renameRefsSkippedAll（部分更新语义不变）', () => {
    expect(renameNoticeKeyOf(log(0, 1, 1))).toBe('host.renameRefsSkippedAll')
    expect(renameNoticeKeyOf(log(0, 2, 0))).toBe('host.renameRefsSkippedAll')
  })
  it('已更新 / 部分更新 / 静默三分支保持既有语义', () => {
    expect(renameNoticeKeyOf(log(3, 0, 0))).toBe('host.renameRefsUpdated')
    expect(renameNoticeKeyOf(log(3, 1, 0))).toBe('host.renameRefsPartiallyUpdated')
    expect(renameNoticeKeyOf(log(3, 0, 1))).toBe('host.renameRefsPartiallyUpdated')
    expect(renameNoticeKeyOf(log(0, 0, 0))).toBeNull()
  })
})

describe('vaultRename：#222 嵌入边改写（![[…]] 与 wikilink 同构）', () => {
  it('嵌入路径段替换（![[ 后、#/| 之前），别名与锚点原样保留', () => {
    const text = 'A ![[target]] B ![[target#标题|显示]] C ![[target#^blk1]]\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = (needle: string): { start: number; end: number } => {
      const start = text.indexOf(needle)
      return { start, end: start + needle.length }
    }
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', ...at('![[target]]') }),
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', anchor: '标题', ...at('![[target#标题|显示]]') }),
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', anchor: '^blk1', ...at('![[target#^blk1]]') }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits))
      .toBe('A ![[renamed]] B ![[renamed#标题|显示]] C ![[renamed#^blk1]]\n')
  })

  it('嵌入显式 .md 保持扩展名、引用者子目录重算相对段（与 wikilink 同语义）', () => {
    const text = '见 ![[../target.md]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/notes/ref.md`, text, [
      edge({ target: '../target.md', resolved: 'target.md', kind: 'embed', start: text.indexOf('![[../target.md]]'), end: text.indexOf('![[../target.md]]') + '![[../target.md]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 ![[renamed.md]]。\n')
  })

  it('嵌入区间漂移（形态不符）走文档级 edge-stale 跳过（过期不硬改）', () => {
    const text = '已被改写的不相关正文。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', start: 0, end: 12 }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs).toHaveLength(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]).toMatchObject({ reason: 'edge-stale' })
  })
})

describe('#248 表格格内嵌入边的改写（转义管道保真）', () => {
  it('格内 \\| 别名嵌入：只替换路径段，\\| 别名与列结构保留', () => {
    const text = '| a | ![[target\\|别名]] |\n| --- | --- |\n| b | c |'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = text.indexOf('![[target\\|别名]]')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      // 索引边 target 为解码路径（vaultLinkExtract #248 解码语义）
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', start: at, end: at + '![[target\\|别名]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(result.docs[0]!.edits).toHaveLength(1)
    const edited = applyEdits(text, result.docs[0]!.edits)
    expect(edited).toBe('| a | ![[renamed\\|别名]] |\n| --- | --- |\n| b | c |')
    // 列数不变（转义管道仍在——不因改写裸化）
    expect(edited.split('\n')[0]).toContain('\\|')
  })

  it('格内锚点 + 别名组合：锚点保留在路径段之后', () => {
    const text = '| ![[target#标题\\|显]] | b |\n| --- | --- |\n| c | d |'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = text.indexOf('![[target#标题\\|显]]')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'embed', start: at, end: at + '![[target#标题\\|显]]'.length, anchor: '标题' }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('| ![[renamed#标题\\|显]] | b |\n| --- | --- |\n| c | d |')
  })

  it('普通段落的 \\| 形态边（target 含 \\ 的原文字面）不受转义尝试影响', () => {
    // 非表格行索引边按原文字面：target 为 `target\\`——现有首个 | 分割命中
    const text = '段 ![[target\\|x]] 段\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = text.indexOf('![[target\\|x]]')
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target\\', resolved: null, kind: 'embed', start: at, end: at + '![[target\\|x]]'.length }),
    ])]
    // resolved=null 不构成 rename 映射命中：无编辑（断链边按原文保留）
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.docs[0]?.edits ?? []).toHaveLength(0)
  })
})

// ---- #556 T4：短名保留决策与三类链接形态更新 ----

/** 短名唯一性查询端口 fake（host 侧 = vaultIndex.shortnameLookup）：
 *  byBasename 为旧世界（will 时刻）catalog 快照——完整 basename → 绝对身份
 *  候选；notReady=true 模拟索引未就绪（null） */
function shortnamePort(o: {
  byBasename?: Record<string, string[]>
  complete?: boolean
  notReady?: boolean
}): NonNullable<RenamePlanContext['shortnameLookup']> {
  return (_sourceFsPath, basename) => {
    if (o.notReady) {
      return null
    }
    return { candidates: o.byBasename?.[basename] ?? [], complete: o.complete ?? true }
  }
}

describe('vaultRename：#556 T4 短名保留与三形态决策', () => {
  it('纯移动（不改名）：原短名在新状态仍唯一命中同一目标 → 保留不改', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    // will 时刻旧世界 catalog：target.md 仍在根（端口返回旧路径，规划器按映射校正）
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`] } }) },
      docs,
    )
    expect(result.docs).toEqual([]) // 短名保留：零编辑、零跳过
    expect(result.skipped).toEqual([])
  })

  it('纯移动（did 新世界视角）：端口直接返回新路径同样保留（校正 no-op）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/notes/target.md`] } }) },
      docs,
    )
    expect(result.docs).toEqual([])
  })

  it('改名后新短名唯一 → 更新短名（省略与显式 .md 两形态各自保持）', () => {
    const text = '见 [[target]] 与 [[target.md]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: text.indexOf('[[target]]'), end: text.indexOf('[[target]]') + '[[target]]'.length }),
      edge({ target: 'target.md', resolved: 'target.md', kind: 'wikilink', start: text.indexOf('[[target.md]]'), end: text.indexOf('[[target.md]]') + '[[target.md]]'.length }),
    ])]
    // 旧世界：target.md 在根（B2 校正后同名集为空——改名退出）；renamed 尚不存在
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`] } }) },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[renamed]] 与 [[renamed.md]]。\n')
  })

  it('新短名与根内既有同名冲突 → 降级为明确相对路径', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/dup.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    // 旧世界已有 other/dup.md：新短名 dup 二候选 → 不唯一 → 相对路径
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`], 'dup.md': [`${WIN_ROOT}/other/dup.md`] } }) },
      docs,
    )
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[notes/dup]]。\n')
  })

  it('同批移入同名文件使短名失唯一（selfMove 出链视角）→ 相对降级', () => {
    // ref 移入 sub/ 的同批还把外部 dup.md 移进 notes/：ref 的 [[dup]] 原先
    // 唯一命中根内 dup.md，新状态二候选 → 无法安全保留 → 相对路径
    const text = '见 [[dup]]。\n'
    const moves = [
      { oldFsPath: `${WIN_ROOT}/ref.md`, newFsPath: `${WIN_ROOT}/sub/ref.md` },
      { oldFsPath: 'C:/external/dup.md', newFsPath: `${WIN_ROOT}/notes/dup.md` },
    ]
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/sub/ref.md`,
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [edge({ target: 'dup', resolved: `${WIN_ROOT}/dup.md`, kind: 'wikilink', start: 2, end: 2 + '[[dup]]'.length })],
    }]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'dup.md': [`${WIN_ROOT}/dup.md`] } }) },
      docs,
    )
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[../dup]]。\n')
  })

  it('跨根移动：短名无法保留（同名集被移出根域剔除）→ 明确绝对路径', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'C:/other-root/target.md' }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves, [WIN_ROOT, 'C:/other-root']), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`] } }) },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[C:/other-root/target]]。\n')
  })

  it('清单不完整（complete=false）：唯一候选不声明唯一 → 相对降级', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`] }, complete: false }) },
      docs,
    )
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[notes/target]]。\n')
  })

  it('端口未就绪（null）：不注入短名语义 → 退相对路径（不猜目标）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ notReady: true }) },
      docs,
    )
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[notes/target]]。\n')
  })

  it('不注入端口：短名边走相对重算（上游兼容，行为与既有语义一致）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: 'target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[notes/target]]。\n')
  })

  it('目标移入引用者同目录：同目录相对候选直击 → 保留（不依赖端口）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/notes/target.md`, newFsPath: `${WIN_ROOT}/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: `${WIN_ROOT}/notes/target.md`, kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs) // 无端口
    expect(result.docs).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('评审 S1：同目录裸名文件遮蔽候选序时短名不保留（第一个存在文件优先，不偷换目标）', () => {
    // old/note.md 与 old/source.md 同批移至 new/；new/note（无扩展）已存在。
    // 同批移动的引用者走 did 出链通道（selfMove，docDir = 新目录）
    const text = '见 [[note]]。\n'
    const moves = [
      { oldFsPath: `${WIN_ROOT}/old/note.md`, newFsPath: `${WIN_ROOT}/new/note.md` },
      { oldFsPath: `${WIN_ROOT}/old/source.md`, newFsPath: `${WIN_ROOT}/new/source.md` },
    ]
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/new/source.md`,
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [edge({ target: 'note', resolved: `${WIN_ROOT}/old/note.md`, kind: 'wikilink', start: 2, end: 2 + '[[note]]'.length })],
    }]
    // 同目录候选序 [new/note, new/note.md]：解析器「第一个存在文件优先」
    // 命中 new/note（非目标）——保留短名会把目标偷换成另一文件
    const exists: Record<string, true> = {
      [`${WIN_ROOT}/new/note`.toLowerCase()]: true,
      [`${WIN_ROOT}/new/note.md`.toLowerCase()]: true,
    }
    const result = planVaultRenameRewrites(
      {
        ...winCtx(moves),
        shortnameLookup: shortnamePort({ byBasename: { 'note.md': [`${WIN_ROOT}/old/note.md`] } }),
        targetExists: (p) => exists[p.replaceAll('\\', '/').toLowerCase()] === true,
      },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[note.md]]。\n')
  })

  it('复审 S1：降级相对路径剥 .md 后被异目录无扩展文件遮蔽 → 回验失败退显式扩展形态', () => {
    // 目标移入 notes/，新短名与根内既有 other/target.md 冲突（c 不唯一）→
    // 降级相对剥 .md 生成 notes/target；解析器候选序 [notes/target, notes/target.md]
    // 第一个存在者是目录下既有的无扩展遮蔽文件——终审回验拦截，退显式
    // notes/target.md（单候选直击目标身份）
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/notes/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const exists: Record<string, true> = {
      [`${WIN_ROOT}/notes/target`.toLowerCase()]: true,   // 无扩展遮蔽物（未引用、不在 catalog）
      [`${WIN_ROOT}/notes/target.md`.toLowerCase()]: true, // 目标新路径（moves）
      [`${WIN_ROOT}/other/target.md`.toLowerCase()]: true, // 根内既有同名（使新短名不唯一）
    }
    const result = planVaultRenameRewrites(
      {
        ...winCtx(moves),
        shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`, `${WIN_ROOT}/other/target.md`] } }),
        targetExists: (p) => exists[p.replaceAll('\\', '/').toLowerCase()] === true,
      },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[notes/target.md]]。\n')
  })

  it('复审 S1：越根绝对形态剥 .md 后被新目录无扩展文件遮蔽 → 回验失败退显式绝对路径', () => {
    // 跨根移动且新目录已有同名无扩展文件：绝对兜底剥 .md 的 C:/other-root/target
    // 候选序 [target（遮蔽）, target.md]——终审回验拦截，退不剥形态
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: 'C:/other-root/target.md' }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'target', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ])]
    const exists: Record<string, true> = {
      ['c:/other-root/target']: true,
      ['c:/other-root/target.md']: true,
    }
    const result = planVaultRenameRewrites(
      {
        ...winCtx(moves, [WIN_ROOT, 'C:/other-root']),
        shortnameLookup: shortnamePort({ byBasename: { 'target.md': [`${WIN_ROOT}/target.md`] } }),
        targetExists: (p) => exists[p.replaceAll('\\', '/').toLowerCase()] === true,
      },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[C:/other-root/target.md]]。\n')
  })

  it('评审 F5：目标移入嵌套工作区根后不再几何保留相对（最具体根归属变更 → 绝对路径）', () => {
    // 父根来源的相对引用目标移入已登记的嵌套根：补查域随归属转移到嵌套根，
    // 父根补查为 []/complete——保留的相对形态经解析器已 not-found
    const text = '见 [x](../data/target.md)。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/data/target.md`, newFsPath: `${WIN_ROOT}/nested/target.md` }]
    const docs = [refDoc(`${WIN_ROOT}/project/source.md`, text, [
      edge({ target: '../data/target.md', resolved: `${WIN_ROOT}/data/target.md`, kind: 'mdlink', start: text.indexOf('[x](../data/target.md)'), end: text.indexOf('[x](../data/target.md)') + '[x](../data/target.md)'.length }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves, [WIN_ROOT, `${WIN_ROOT}/nested`]), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [x](C:/vault/nested/target.md)。\n')
  })

  it('selfMove 出链短名保留：文档移动后其未动目标的短名出链不再批量转相对', () => {
    const text = '见 [[other]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/sub/renamed.md` }]
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/sub/renamed.md`,
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [edge({ target: 'other', resolved: `${WIN_ROOT}/other.md`, kind: 'wikilink', start: 2, end: 2 + '[[other]]'.length })],
    }]
    const keep = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'other.md': [`${WIN_ROOT}/other.md`] } }) },
      docs,
    )
    expect(keep.docs).toEqual([]) // 注入端口：短名保留（对照下方无端口行为）

    const legacy = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, legacy.docs[0]!.edits)).toBe('见 [[../other]]。\n') // 无端口：现状相对重算
  })

  it('绝对路径原文随目标更名更新绝对形态（省略/显式扩展名各自保持）', () => {
    const text = '见 [[C:/vault/target]] 与 [[C:/vault/target.md]]。\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/renamed.md` }]
    const at = (needle: string): { start: number; end: number } => {
      const start = text.indexOf(needle)
      return { start, end: start + needle.length }
    }
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'C:/vault/target', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', ...at('[[C:/vault/target]]') }),
      edge({ target: 'C:/vault/target.md', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', ...at('[[C:/vault/target.md]]') }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[C:/vault/renamed]] 与 [[C:/vault/renamed.md]]。\n')
  })

  it('mdlink 绝对路径改写：字面风格直写、含空格时保持 <> 包裹', () => {
    const text = '[x](<C:/vault/my note.md>)\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/my note.md`, newFsPath: `${WIN_ROOT}/your note.md` }]
    const docs = [refDoc(`${WIN_ROOT}/ref.md`, text, [
      edge({ target: 'C:/vault/my note.md', resolved: `${WIN_ROOT}/my note.md`, kind: 'mdlink', start: 0, end: text.length - 1 }),
    ])]
    const result = planVaultRenameRewrites(winCtx(moves), docs)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('[x](<C:/vault/your note.md>)\n')
  })

  it('POSIX：跨根绝对形态原样（无盘符转换）', () => {
    const text = '见 [[target]]。\n'
    const moves = [{ oldFsPath: '/vault/target.md', newFsPath: '/other/target.md' }]
    const docs = [refDoc('/vault/ref.md', text, [
      edge({ target: 'target', resolved: '/vault/target.md', kind: 'wikilink', start: 2, end: 2 + '[[target]]'.length }),
    ], '/vault')]
    const result = planVaultRenameRewrites(
      { rootFsPaths: ['/vault', '/other'], isWindowsHost: false, moves },
      docs,
    )
    expect(applyEdits(text, result.docs[0]!.edits)).toBe('见 [[/other/target]]。\n')
  })

  it('混合形态批次：同一文档内短名保留（零编辑）与相对、绝对改写并存', () => {
    // 三条边：[[keep]]（未动目标，selfMove 出链短名，保留）、[rel](target.md)
    // （明确相对路径仍有效 → 保持相对并按新目录重算）、绝对路径随更名
    const text = 'A [[keep]] B [rel](target.md) C [[C:/vault/target.md]]\n'
    const moves = [{ oldFsPath: `${WIN_ROOT}/target.md`, newFsPath: `${WIN_ROOT}/moved/target.md` }]
    const at = (needle: string): { start: number; end: number } => {
      const start = text.indexOf(needle)
      return { start, end: start + needle.length }
    }
    const docs: RenameDocInput[] = [{
      fsPath: `${WIN_ROOT}/moved/renamed-self.md`, // selfMove：全部出链参与决策
      text,
      edgeRootFsPath: WIN_ROOT,
      edges: [
        edge({ target: 'keep', resolved: `${WIN_ROOT}/keep.md`, kind: 'wikilink', ...at('[[keep]]') }),
        edge({ target: 'target.md', resolved: `${WIN_ROOT}/target.md`, kind: 'mdlink', ...at('[rel](target.md)') }),
        edge({ target: 'C:/vault/target.md', resolved: `${WIN_ROOT}/target.md`, kind: 'wikilink', ...at('[[C:/vault/target.md]]') }),
      ],
    }]
    const result = planVaultRenameRewrites(
      { ...winCtx(moves), shortnameLookup: shortnamePort({ byBasename: { 'keep.md': [`${WIN_ROOT}/keep.md`] } }) },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(applyEdits(text, result.docs[0]!.edits))
      .toBe('A [[keep]] B [rel](target.md) C [[C:/vault/moved/target.md]]\n')
  })
})

// ---- 真实宿主形态契约（集成 #556 T4 跨根用例失败的根因钉住）----
// 真实宿主下三域形态混布：引用者 fsPath / 根 / moves 为宿主反斜杠形态，
// 索引边表 resolvedTarget 为规范绝对身份（`/` 分隔——T2 契约）。既有用例
// 全程 `/` 形态自洽，掩盖了混布形态的匹配断裂。

describe('vaultRename：真实宿主形态（反斜杠 fsPath × 正斜杠身份）', () => {
  const WS = 'c:\\ws'
  const SECOND = 'c:\\ws-rename-second'
  const TARGET_ID = 'c:/ws/改名目标.md'

  it('跨根移动：引用者短名/mdlink/带锚边改写为明确绝对路径（省略/显式扩展名各自保持）', () => {
    const text = [
      '# 改名引用甲',
      '',
      '见 [[改名目标]] 与 [同目标](./改名目标.md)。',
      '',
      '带锚 [[改名目标#深处小节|别名]]。',
      '',
    ].join('\n')
    const at = (needle: string): { start: number; end: number } => {
      const start = text.indexOf(needle)
      return { start, end: start + needle.length }
    }
    const moves = [{ oldFsPath: `${WS}\\改名目标.md`, newFsPath: `${SECOND}\\改名目标.md` }]
    const docs = [refDoc(`${WS}\\rename-ref-a.md`, text, [
      edge({ target: '改名目标', resolved: TARGET_ID, kind: 'wikilink', ...at('[[改名目标]]') }),
      edge({ target: './改名目标.md', resolved: TARGET_ID, kind: 'mdlink', ...at('[同目标](./改名目标.md)') }),
      edge({ target: '改名目标', resolved: TARGET_ID, kind: 'wikilink', anchor: '深处小节', ...at('[[改名目标#深处小节|别名]]') }),
    ], WS)]
    const result = planVaultRenameRewrites(
      {
        rootFsPaths: [WS, SECOND],
        isWindowsHost: true,
        moves,
        // 旧世界 catalog 身份（/ 形态）——与 vaultIndex.shortnameLookup 同域
        shortnameLookup: shortnamePort({ byBasename: { '改名目标.md': [TARGET_ID] } }),
      },
      docs,
    )
    expect(result.skipped).toEqual([])
    expect(result.docs).toHaveLength(1)
    expect(applyEdits(text, result.docs[0]!.edits)).toBe([
      '# 改名引用甲',
      '',
      `见 [[c:/ws-rename-second/改名目标]] 与 [同目标](c:/ws-rename-second/改名目标.md)。`,
      '',
      `带锚 [[c:/ws-rename-second/改名目标#深处小节|别名]]。`,
      '',
    ].join('\n'))
  })
})
