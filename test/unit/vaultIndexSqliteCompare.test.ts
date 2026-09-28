// SQLite 对照引擎与分片快照引擎的对照契约测试（工单 #195）。
//
// 两个候选引擎喂同一 VaultIndexModel，断言往返等价与查询同口径：
// 选型比较的性能数字必须建立在「两路径索引的是同一份关系数据」之上。
// sql.js 为 devDependency（WASM），仅测试与基准消费，不进扩展 bundle。
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createSqliteIndex,
  loadSqlJs,
  openSqliteIndex,
  type SqliteIndexHandle,
  type SqlJsModule,
} from '../../test/perf/vaultIndexSqliteEngine.mjs'
import { buildBacklinkIndex, sortEdges, type VaultEdge, type VaultIndexModel } from '../../src/shared/vaultIndexModel'

let SQL: SqlJsModule

beforeAll(async () => {
  SQL = await loadSqlJs()
})

function file(path: string, kind: 'markdown' | 'asset' = 'markdown') {
  return { path, kind, mtimeMs: 1_700_000_000_000, size: 100, contentVersion: 1 }
}

function edge(source: string, target: string, start: number, kind: VaultEdge['kind'] = 'wikilink', resolvedTarget: string | null = target): VaultEdge {
  return { source, target, resolvedTarget, kind, anchor: '', start, end: start + target.length + 4 }
}

function sampleModel(): VaultIndexModel {
  const files = new Map([
    ['a/x.md', { ...file('a/x.md'), size: 300 }],
    ['a/设计.md', { ...file('a/设计.md'), size: 250, contentVersion: 3 }],
    ['attachments/图 乙.png', { ...file('attachments/图 乙.png', 'asset'), size: 88 }],
  ])
  const edges: VaultEdge[] = [
    edge('a/x.md', '设计', 0, 'wikilink', 'a/设计.md'),
    edge('a/x.md', 'a/设计', 20, 'wikilink', 'a/设计.md'),
    edge('a/x.md', '../b/y.md', 40, 'mdlink', 'b/y.md'),
    edge('a/x.md', '图 乙.png', 60, 'image', 'attachments/图 乙.png'),
    edge('a/x.md', '缺失 页面', 80, 'wikilink', null),
    edge('a/设计.md', 'x', 10, 'wikilink', 'a/x.md'),
  ]
  return { files, edges }
}

function createAndBuild(model: VaultIndexModel): SqliteIndexHandle {
  const handle = createSqliteIndex(SQL)
  handle.bulkBuild(model)
  return handle
}

describe('SQLite 对照引擎往返等价', () => {
  it('bulkBuild → readModel 与原模型等价（文件字段与边全字段）', () => {
    const model = sampleModel()
    const back = createAndBuild(model).readModel()
    expect([...back.files.entries()].sort()).toEqual([...model.files.entries()].sort())
    expect(back.edges).toEqual(sortEdges(model.edges))
  })

  it('export → 冷加载（openSqliteIndex）→ readModel 等价', () => {
    const model = sampleModel()
    const bytes = createAndBuild(model).export()
    const back = openSqliteIndex(SQL, bytes).readModel()
    expect(back.edges).toEqual(sortEdges(model.edges))
    expect(back.files.get('a/设计.md')).toEqual(model.files.get('a/设计.md'))
    expect(back.files.get('attachments/图 乙.png')).toEqual(model.files.get('attachments/图 乙.png'))
  })

  it('pointUpdate：单文件元数据与出链整组重写，其余不受影响', () => {
    const model = sampleModel()
    const handle = createAndBuild(model)
    const entry = { ...file('a/x.md'), size: 999, contentVersion: 2 }
    const newEdges = [edge('a/x.md', 'a/设计', 5, 'mdlink', 'a/设计.md')]
    handle.pointUpdate(entry, newEdges)
    const back = handle.readModel()
    expect(back.files.get('a/x.md')!.size).toBe(999)
    expect(back.files.get('a/x.md')!.contentVersion).toBe(2)
    expect(back.edges.filter((e) => e.source === 'a/x.md')).toEqual(sortEdges(newEdges))
    // 其他来源的边保持原样
    expect(back.edges.filter((e) => e.source === 'a/设计.md')).toEqual(sortEdges(model.edges.filter((e) => e.source === 'a/设计.md')))
  })

  it('batchUpdate：多文件单事务批量重写', () => {
    const model = sampleModel()
    const handle = createAndBuild(model)
    handle.batchUpdate([
      { entry: { ...file('a/x.md'), contentVersion: 2 }, edges: [edge('a/x.md', '设计', 1, 'wikilink', 'a/设计.md')] },
      { entry: { ...file('a/设计.md'), contentVersion: 4 }, edges: [] },
    ])
    const back = handle.readModel()
    expect(back.files.get('a/x.md')!.contentVersion).toBe(2)
    expect(back.files.get('a/设计.md')!.contentVersion).toBe(4)
    expect(back.edges.filter((e) => e.source === 'a/设计.md')).toHaveLength(0)
  })
})

describe('SQLite 反链查询与 buildBacklinkIndex 同口径', () => {
  it('同一解析目标的反链列表（source/start/end 序）一致', () => {
    const model = sampleModel()
    const handle = createAndBuild(model)
    const expected = buildBacklinkIndex(model.edges).get('a/设计.md')!
    expect(expected).toHaveLength(2)
    const rows = handle.backlinks('a/设计.md')
    expect(rows.map((r) => [r.source, r.start, r.end])).toEqual(expected.map((e) => [e.source, e.start, e.end]))
  })

  it('断链不进任何 resolved_target 查询结果', () => {
    const handle = createAndBuild(sampleModel())
    expect(handle.backlinks('缺失 页面')).toHaveLength(0)
  })
})
