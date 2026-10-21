// T04（#624）批量导出清单纯逻辑单元测试：收集/去重/排序/相对结构映射/
// 重名三策略（跳过/覆盖/自动更名）/自动更名规则/汇总聚合。
// 规格语义：docs/specs/pdf-export.md §2.2——批量保留所选目录相对结构、
// 多根同名与已有目标进冲突处理、不静默覆盖、不无说明丢文件。
import { describe, expect, it } from 'vitest'
import {
  addBatchFiles,
  addToBatchFromDir,
  moveBatchItem,
  nextAvailableTargetPath,
  planBatchMapping,
  removeBatchItem,
  summarizeBatchResults,
  type PdfBatchItem,
} from '../../src/shared/pdfExportBatch'

/** 宿主同口径 Markdown 判定（textEditorProvider.isMarkdownFile：
 *  path.extname 大小写敏感，.md / .markdown） */
const isMarkdown = (fsPath: string): boolean => {
  const dot = fsPath.lastIndexOf('.')
  const ext = dot < 0 ? '' : fsPath.slice(dot)
  return ext === '.md' || ext === '.markdown'
}

let seq = 0
const nextId = (): string => `t${++seq}`

describe('批量清单：目录收集与去重', () => {
  it('目录递归收集仅保留 Markdown 并计算相对结构', () => {
    const { items, added } = addToBatchFromDir([], 'D:/vault/dir1', [
      'D:/vault/dir1/a.md',
      'D:/vault/dir1/sub/b.md',
      'D:/vault/dir1/sub/c.png',
      'D:/vault/dir1/d.markdown',
      'D:/vault/dir1/e.txt',
    ], isMarkdown, nextId)
    expect(added).toBe(3)
    expect(items.map((i) => i.relPath)).toEqual(['a.md', 'sub/b.md', 'd.markdown'])
    expect(items.map((i) => i.rootFsPath)).toEqual(['D:/vault/dir1', 'D:/vault/dir1', 'D:/vault/dir1'])
    expect(items[0].fsPath).toBe('D:/vault/dir1/a.md')
  })

  it('重复文件不二次入清单（按 fsPath 去重，先入为主）', () => {
    const first = addToBatchFromDir([], 'D:/vault/dir1', ['D:/vault/dir1/a.md'], isMarkdown, nextId)
    const second = addToBatchFromDir(first.items, 'D:/vault/dir2', [
      'D:/vault/dir2/a.md',       // 不同文件（同名异目录）——应入列
      'D:/vault/dir1/a.md',       // 同一文件（前缀外的重复回灌，防御）——去重
    ], isMarkdown, nextId)
    expect(second.added).toBe(1)
    expect(second.items).toHaveLength(2)
    expect(second.items[1].relPath).toBe('a.md')
    expect(second.items[1].rootFsPath).toBe('D:/vault/dir2')
  })

  it('单文件添加：root 为所在目录、relPath 为文件名、非 Markdown 拒绝', () => {
    const ok = addBatchFiles([], ['D:/vault/notes/x.md'], isMarkdown, nextId)
    expect(ok.added).toBe(1)
    expect(ok.items[0]).toMatchObject({ rootFsPath: 'D:/vault/notes', relPath: 'x.md' })
    const rejected = addBatchFiles(ok.items, ['D:/vault/notes/y.png'], isMarkdown, nextId)
    expect(rejected.added).toBe(0)
    expect(rejected.items).toHaveLength(1)
  })
})

describe('批量清单：增删与调序', () => {
  const base = (): PdfBatchItem[] => [
    { id: 'a', fsPath: 'D:/v/1.md', rootFsPath: 'D:/v', relPath: '1.md' },
    { id: 'b', fsPath: 'D:/v/2.md', rootFsPath: 'D:/v', relPath: '2.md' },
    { id: 'c', fsPath: 'D:/v/3.md', rootFsPath: 'D:/v', relPath: '3.md' },
  ]

  it('删除移除指定条目，未知 id 无操作', () => {
    expect(removeBatchItem(base(), 'b').map((i) => i.id)).toEqual(['a', 'c'])
    expect(removeBatchItem(base(), 'zzz').map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('上移/下移真实改变顺序（首尾边界无操作）', () => {
    expect(moveBatchItem(base(), 'b', 'up').map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(moveBatchItem(base(), 'b', 'down').map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(moveBatchItem(base(), 'a', 'up').map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(moveBatchItem(base(), 'c', 'down').map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(moveBatchItem(base(), 'zzz', 'up').map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('输出映射与重名三策略', () => {
  const items = (): PdfBatchItem[] => [
    // 根 1：a.md + sub/b.md；根 2：a.md（与根 1 同名映射）
    { id: 'r1a', fsPath: 'D:/vault/dir1/a.md', rootFsPath: 'D:/vault/dir1', relPath: 'a.md' },
    { id: 'r1b', fsPath: 'D:/vault/dir1/sub/b.md', rootFsPath: 'D:/vault/dir1', relPath: 'sub/b.md' },
    { id: 'r2a', fsPath: 'D:/vault/dir2/a.md', rootFsPath: 'D:/vault/dir2', relPath: 'a.md' },
  ]
  const target = 'D:/out'

  it('保留所选目录相对结构（含嵌套子目录）', () => {
    const two = items().slice(0, 2) // 无同名干扰的纯结构断言
    const plan = planBatchMapping(two, target, 'rename', new Set())
    expect(plan[0].targetPath).toBe('D:/out/a.pdf')
    expect(plan[1].targetPath).toBe('D:/out/sub/b.pdf')
    expect(plan.every((e) => e.conflict === 'none' && e.action === 'export')).toBe(true)
  })

  it('多根同名：跳过策略保留首个并显式跳过后到者（两方均标注 duplicate）', () => {
    const plan = planBatchMapping(items(), target, 'skip', new Set())
    expect(plan[0]).toMatchObject({ action: 'export', conflict: 'duplicate' })
    expect(plan[2]).toMatchObject({ action: 'skip', skipReason: 'duplicate', conflict: 'duplicate' })
    // 拟输出路径仍给出（预览表展示被跳过项映射到哪）
    expect(plan[2].targetPath).toBe('D:/out/a.pdf')
  })

  it('多根同名：覆盖策略两者都导出到同一路径（按清单顺序后写者生效）', () => {
    const plan = planBatchMapping(items(), target, 'overwrite', new Set())
    expect(plan[0]).toMatchObject({ action: 'export', targetPath: 'D:/out/a.pdf', conflict: 'duplicate' })
    expect(plan[2]).toMatchObject({ action: 'export', targetPath: 'D:/out/a.pdf', conflict: 'duplicate' })
  })

  it('多根同名：自动更名策略给后到者编号路径', () => {
    const plan = planBatchMapping(items(), target, 'rename', new Set())
    expect(plan[0].targetPath).toBe('D:/out/a.pdf')
    expect(plan[2]).toMatchObject({ targetPath: 'D:/out/a (2).pdf', action: 'export', renamed: true, conflict: 'duplicate' })
    expect(plan[2].conflict).toBe('duplicate')
  })

  it('目标已有文件（exists）：三策略分别跳过/覆盖/更名（无批内同名干扰）', () => {
    const two = items().slice(0, 2)
    const exists = new Set(['d:/out/a.pdf'])
    const skip = planBatchMapping(two, target, 'skip', exists)
    expect(skip[0]).toMatchObject({ action: 'skip', skipReason: 'exists', conflict: 'exists' })
    const overwrite = planBatchMapping(two, target, 'overwrite', exists)
    expect(overwrite[0]).toMatchObject({ action: 'export', targetPath: 'D:/out/a.pdf', conflict: 'exists' })
    const rename = planBatchMapping(two, target, 'rename', exists)
    expect(rename[0]).toMatchObject({ targetPath: 'D:/out/a (2).pdf', renamed: true, conflict: 'exists' })
  })

  it('批内同名 + 目标已有同时发生（both）：rename 后到者取次号（两方均标注 both）', () => {
    // a.pdf 已存在 + 根 2 a.md 同名：根 1 → a (2).pdf（避开磁盘），根 2 → a (3).pdf
    const exists = new Set(['d:/out/a.pdf'])
    const plan = planBatchMapping(items(), target, 'rename', exists)
    expect(plan[0].targetPath).toBe('D:/out/a (2).pdf')
    expect(plan[2].targetPath).toBe('D:/out/a (3).pdf')
    expect(plan[0].conflict).toBe('both')
    expect(plan[2].conflict).toBe('both')
  })

  it('批内同名 + 目标已有（both）：skip 策略逐条显式说明', () => {
    const exists = new Set(['d:/out/a.pdf'])
    const plan = planBatchMapping(items(), target, 'skip', exists)
    // 首个同名条目只因磁盘已有跳过；后到者报 duplicate
    expect(plan[0]).toMatchObject({ action: 'skip', skipReason: 'exists', conflict: 'both' })
    expect(plan[2]).toMatchObject({ action: 'skip', skipReason: 'duplicate', conflict: 'both' })
  })

  it('冲突判定大小写不敏感（Windows 宿主文件系统语义）', () => {
    const mixed: PdfBatchItem[] = [
      { id: 'x', fsPath: 'D:/v/A.md', rootFsPath: 'D:/v', relPath: 'A.md' },
      { id: 'y', fsPath: 'D:/v2/a.md', rootFsPath: 'D:/v2', relPath: 'a.md' },
    ]
    const plan = planBatchMapping(mixed, target, 'skip', new Set())
    expect(plan[1]).toMatchObject({ action: 'skip', skipReason: 'duplicate' })
  })

  it('markdown 扩展名换 pdf 扩展名', () => {
    const md: PdfBatchItem[] = [
      { id: 'm', fsPath: 'D:/v/note.markdown', rootFsPath: 'D:/v', relPath: 'note.markdown' },
    ]
    expect(planBatchMapping(md, target, 'rename', new Set())[0].targetPath).toBe('D:/out/note.pdf')
  })
})

describe('自动更名规则', () => {
  it('调用即更名：name.pdf → name (2).pdf → name (3).pdf 取最小可用编号（无冲突不动名由调用方判定）', () => {
    expect(nextAvailableTargetPath('D:/out/name.pdf', new Set())).toBe('D:/out/name (2).pdf')
    expect(nextAvailableTargetPath('D:/out/name.pdf', new Set(['d:/out/name (2).pdf']))).toBe('D:/out/name (3).pdf')
    expect(nextAvailableTargetPath('D:/out/sub/name.pdf', new Set(['d:/out/sub/name (2).pdf', 'd:/out/sub/name (3).pdf']))).toBe('D:/out/sub/name (4).pdf')
  })

  it('更名候选大小写不敏感参与占用判定（保留原 basename 大小写）', () => {
    expect(nextAvailableTargetPath('D:/out/Name.pdf', new Set(['d:/out/name (2).PDF']))).toBe('D:/out/Name (3).pdf')
  })
})

describe('结果汇总聚合', () => {
  it('按状态计数聚合', () => {
    const summary = summarizeBatchResults([
      { id: '1', fsPath: 'D:/v/1.md', docName: '1.md', status: 'success', targetPath: 'D:/o/1.pdf' },
      { id: '2', fsPath: 'D:/v/2.md', docName: '2.md', status: 'failed', failReason: 'print-failed' },
      { id: '3', fsPath: 'D:/v/3.md', docName: '3.md', status: 'skipped', skipReason: 'exists' },
      { id: '4', fsPath: 'D:/v/4.md', docName: '4.md', status: 'cancelled' },
      { id: '5', fsPath: 'D:/v/5.md', docName: '5.md', status: 'success', targetPath: 'D:/o/5.pdf' },
    ])
    expect(summary).toEqual({ total: 5, success: 2, failed: 1, skipped: 1, cancelled: 1 })
  })
})
