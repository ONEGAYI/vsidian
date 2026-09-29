// 引用索引快照存储契约测试（工单 #195，TDD 先行）。
// 被测模块 src/shared/vaultIndexSnapshot.ts 是「紧凑分片快照 + 内存关系表」
// 选型的纯逻辑核心：规划提交（写什么、按什么顺序写）与恢复（从目录
// 状态重建模型）。fs 访问经端口注入，本测试用内存 Map 模拟。
import { describe, expect, it } from 'vitest'
import {
  buildBacklinkIndex,
  loadSnapshot,
  planCleanupDirs,
  planSnapshotCommit,
  planSnapshotCommitChunked,
  rootKeyOf,
  stableHash,
  normalizeRootUri,
  shardIdForPath,
  SNAPSHOT_FORMAT_VERSION,
  type VaultEdge,
  type VaultIndexFsPort,
  type VaultIndexModel,
} from '../../src/shared/vaultIndexSnapshot'
import { sortEdges } from '../../src/shared/vaultIndexModel'

function file(path: string, size = 100, contentVersion = 1, kind: 'markdown' | 'asset' = 'markdown') {
  return { path, kind, mtimeMs: 1_700_000_000_000, size, contentVersion }
}

function edge(source: string, target: string, start: number, kind: VaultEdge['kind'] = 'wikilink', resolvedTarget: string | null = target): VaultEdge {
  return { source, target, resolvedTarget, kind, anchor: '', start, end: start + target.length + 4 }
}

function modelOf(filePaths: string[], edgeCount = 2): VaultIndexModel {
  const files = new Map(filePaths.map((p) => [p, file(p)]))
  const edges: VaultEdge[] = []
  for (const p of filePaths) {
    for (let i = 0; i < edgeCount; i++) {
      edges.push(edge(p, filePaths[(filePaths.indexOf(p) + i + 1) % filePaths.length], i * 20))
    }
  }
  return { files, edges }
}

/** 内存 fs 端口：目录/文件扁平存 Map，listDirs 按路径前缀模拟。 */
function makePort(initial: Record<string, string> = {}): VaultIndexFsPort & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  return {
    files,
    async listDirs(baseDir: string) {
      const names = new Set<string>()
      for (const key of files.keys()) {
        if (!key.startsWith(baseDir + '/')) continue
        const rest = key.slice(baseDir.length + 1)
        if (rest.includes('/')) names.add(rest.split('/')[0])
      }
      return [...names].sort()
    },
    async readFile(path: string) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
    },
  }
}

/** 把 plan 的写入应用到内存端口（按 plan 顺序）。 */
async function applyWrites(port: VaultIndexFsPort & { files: Map<string, string> }, plan: ReturnType<typeof planSnapshotCommit>) {
  for (const w of plan.writes) port.files.set(w.path, w.content)
  return plan
}

/** 全新提交到端口并返回代目录名。 */
async function commitTo(port: VaultIndexFsPort & { files: Map<string, string> }, model: VaultIndexModel) {
  const plan = await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 2 }))
  return plan.writes[plan.writes.length - 1].content.trim()
}

/** 以指定代为上一代做增量提交（从端口读回其片校验和作 prev）。 */
async function commitWithPrev(port: VaultIndexFsPort & { files: Map<string, string> }, model: VaultIndexModel, prevDir: string) {
  const shardChecksums = new Map<number, string>()
  for (const [k, v] of port.files) {
    const m = k.match(new RegExp(`^${BASE}/${prevDir}/shard-(\\d+)\\.json$`))
    if (m) shardChecksums.set(Number(m[1]), stableHash(v))
  }
  const prevGen = Number(prevDir.match(/^gen-(\d+)/)![1])
  const plan = await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 2, prev: { generation: prevGen, dirName: prevDir, shardChecksums } }))
  return plan.writes[plan.writes.length - 1].content.trim()
}

const BASE = 'storage:///idx/root-a'

describe('shardIdForPath', () => {
  it('稳定且随路径分散', () => {
    expect(shardIdForPath('a/b.md', 16)).toBe(shardIdForPath('a/b.md', 16))
    const ids = new Set<string>()
    for (let i = 0; i < 64; i++) ids.add(String(shardIdForPath(`dir${i}/note${i}.md`, 16)))
    expect(ids.size).toBeGreaterThan(8)
  })
  it('同一文件更新前后落同一片', () => {
    expect(shardIdForPath('x.md', 8)).toBe(shardIdForPath('x.md', 8))
  })
})

describe('buildBacklinkIndex', () => {
  it('按目标聚合来源并保留断链', () => {
    const idx = buildBacklinkIndex([
      edge('a.md', 'missing/b.md', 0),
      edge('c.md', 'a.md', 5),
      edge('d.md', 'a.md', 9),
    ])
    expect(idx.get('a.md')?.map((e) => e.source)).toEqual(['c.md', 'd.md'])
    expect(idx.get('missing/b.md')?.map((e) => e.source)).toEqual(['a.md'])
  })
  it('查询结果不受插入顺序影响（稳定排序）', () => {
    const e1 = edge('z.md', 't.md', 30)
    const e2 = edge('a.md', 't.md', 10)
    expect(buildBacklinkIndex([e1, e2]).get('t.md')).toEqual(buildBacklinkIndex([e2, e1]).get('t.md'))
  })
  it('聚合键用解析后目标：短名双链与路径双链指向同一文件时合并', () => {
    // [[设计]]（同目录短名，resolvedTarget 为规范路径）与 [[a/设计]]（路径形式）都解析到 a/设计.md
    const idx = buildBacklinkIndex([
      edge('a/x.md', '设计', 0, 'wikilink', 'a/设计.md'),
      edge('b/y.md', 'a/设计', 8, 'wikilink', 'a/设计.md'),
    ])
    expect(idx.get('a/设计.md')?.map((e) => e.source)).toEqual(['a/x.md', 'b/y.md'])
  })
  it('断链（resolvedTarget=null）按原始目标聚合，不与任何解析目标合并', () => {
    const idx = buildBacklinkIndex([
      edge('a.md', '设计', 0, 'wikilink', null),
      edge('b.md', 'a/设计', 8, 'wikilink', 'a/设计.md'),
    ])
    expect(idx.get('设计')?.map((e) => e.source)).toEqual(['a.md'])
    expect(idx.get('a/设计.md')?.map((e) => e.source)).toEqual(['b.md'])
  })
})

describe('rootKeyOf 根分区键', () => {
  it('语法等价 URI 得同 key：scheme 大小写与路径尾斜杠不敏感', () => {
    expect(rootKeyOf('file:///d%3A/Docs/Vault/')).toBe(rootKeyOf('FILE:///d%3A/Docs/Vault'))
    expect(rootKeyOf('vscode-remote://ssh-remote+host/home/u/vault')).toBe(rootKeyOf('vscode-remote://ssh-remote+host/home/u/vault/'))
  })
  it('不同根不同 key；query/fragment 不影响分区（workspace folder URI 不带）', () => {
    expect(rootKeyOf('file:///d%3A/A')).not.toBe(rootKeyOf('file:///d%3A/B'))
    expect(rootKeyOf('file:///d%3A/A?x=1#f')).toBe(rootKeyOf('file:///d%3A/A'))
  })
  it('key 为文件系统安全字符（仅小写字母数字与连字符）', () => {
    expect(rootKeyOf('file:///d%3A/Docs/中文 库')).toMatch(/^[a-z0-9-]+$/)
  })
  it('normalizeRootUri 保持可见可预测：scheme 小写、去尾斜杠（单根斜杠保留）、去 query/fragment', () => {
    expect(normalizeRootUri('FILE:///a/b/')).toBe('file:///a/b')
    expect(normalizeRootUri('file:///')).toBe('file:///')
    expect(normalizeRootUri('file:///a?x=1#f')).toBe('file:///a')
  })
})

describe('planSnapshotCommit 全新提交', () => {
  it('往返等价：写入应用后可加载出相同模型', async () => {
    const model = modelOf(['a.md', 'b/c.md', 'b/d.md'], 3)
    const plan = planSnapshotCommit(model, { baseDir: BASE, shardCount: 4 })
    expect(plan.writes.length).toBeGreaterThan(0)
    const port = makePort()
    await applyWrites(port, plan)
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).not.toBeNull()
    expect([...loaded!.model.files.keys()].sort()).toEqual([...model.files.keys()].sort())
    expect(loaded!.model.edges).toEqual(model.edges)
  })

  it('提交顺序：片 → manifest → CURRENT（CURRENT 最后写）', () => {
    const plan = planSnapshotCommit(modelOf(['a.md', 'b.md']), { baseDir: BASE, shardCount: 2 })
    const paths = plan.writes.map((w) => w.path)
    const currentIdx = paths.findIndex((p) => p.endsWith('/CURRENT'))
    const manifestIdx = paths.findIndex((p) => p.endsWith('manifest.json'))
    const lastShardIdx = paths.map((p) => /shard-\d+\.json$/.test(p)).lastIndexOf(true)
    expect(currentIdx).toBe(paths.length - 1)
    expect(manifestIdx).toBeGreaterThan(lastShardIdx)
    expect(manifestIdx).toBeLessThan(currentIdx)
    expect(plan.writes.every((w) => w.atomic)).toBe(true)
  })

  it('CURRENT 内容指向本次代目录，manifest 记录统计与片清单', async () => {
    const model = modelOf(['a.md', 'b.md', 'c.md'], 2)
    const plan = planSnapshotCommit(model, { baseDir: BASE, shardCount: 2 })
    const current = plan.writes[plan.writes.length - 1]
    const shardPath = plan.writes.find((w) => /shard-\d+\.json$/.test(w.path))!.path
    const dirName = shardPath.split('/').slice(-2, -1)[0]
    expect(current.content.trim()).toBe(dirName)
    expect(plan.stats.fileCount).toBe(3)
    expect(plan.stats.edgeCount).toBe(6)
    const manifest = JSON.parse(plan.writes.find((w) => w.path.endsWith('manifest.json'))!.content)
    expect(manifest.generation).toBe(plan.generation)
    expect(manifest.shards.length).toBeGreaterThan(0)
  })

  it('空模型也可提交（空库是合法状态）', async () => {
    const plan = planSnapshotCommit({ files: new Map(), edges: [] }, { baseDir: BASE, shardCount: 2 })
    const port = makePort()
    await applyWrites(port, plan)
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded!.model.files.size).toBe(0)
  })
})

describe('planSnapshotCommit 增量提交（片继承）', () => {
  it('单文件更新只重写受影响片，其余片继承上一代', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `dir${i % 5}/note${i}.md`)
    const model = modelOf(paths, 2)
    const port = makePort()
    const first = await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 4 }))
    const firstShards = first.writes.filter((w) => /shard-\d+\.json$/.test(w.path))

    // 更新一个文件 + 一条边
    model.files.get('dir0/note0.md')!.size = 999
    model.files.get('dir0/note0.md')!.contentVersion = 2
    const prev = { generation: first.generation, dirName: first.writes[first.writes.length - 1].content.trim(), shardChecksums: new Map(firstShards.map((w) => {
      const idx = Number(w.path.match(/shard-(\d+)\.json$/)![1])
      return [idx, stableHash(w.content)] as const
    })) }
    const second = planSnapshotCommit(model, { baseDir: BASE, shardCount: 4, prev })
    const secondShards = second.writes.filter((w) => /shard-\d+\.json$/.test(w.path))
    expect(secondShards.length).toBeLessThan(firstShards.length)

    // 加载（两代文件都在端口里）应拼出完整模型
    await applyWrites(port, second)
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded!.model.files.get('dir0/note0.md')!.size).toBe(999)
    expect(loaded!.model.files.size).toBe(40)
    expect(loaded!.model.edges).toEqual(sortEdges(model.edges))
  })

  it('无变化的提交不写任何片（纯 CURRENT/manifest 也无需换新）', () => {
    const model = modelOf(['a.md', 'b.md'], 2)
    const first = planSnapshotCommit(model, { baseDir: BASE, shardCount: 2 })
    const firstShards = first.writes.filter((w) => /shard-\d+\.json$/.test(w.path))
    const prev = {
      generation: first.generation,
      dirName: first.writes[first.writes.length - 1].content.trim(),
      shardChecksums: new Map(firstShards.map((w) => {
        const idx = Number(w.path.match(/shard-(\d+)\.json$/)![1])
        return [idx, stableHash(w.content)] as const
      })),
    }
    const second = planSnapshotCommit(model, { baseDir: BASE, shardCount: 2, prev })
    expect(second.writes.filter((w) => /shard-\d+\.json$/.test(w.path))).toHaveLength(0)
  })
})

describe('loadSnapshot 损坏与回退', () => {
  it('CURRENT 指向的代 JSON 损坏 → 回退上一完整代', async () => {
    const port = makePort()
    const gen1 = await commitTo(port, modelOf(['a.md', 'b.md'], 2))
    // 增量提交第二代（带 prev，代号推进）
    const model2 = modelOf(['a.md', 'b.md', 'c.md'], 2)
    model2.files.get('a.md')!.size = 555
    const gen2 = await commitWithPrev(port, model2, gen1)
    expect(gen2).not.toBe(gen1)
    // 打碎当前代的一个片（模拟半截写入）
    for (const [k, v] of port.files) {
      if (k.startsWith(`${BASE}/${gen2}/`) && /shard-\d+\.json$/.test(k)) {
        port.files.set(k, v.slice(0, Math.floor(v.length / 2)))
        break
      }
    }
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).not.toBeNull()
    expect(loaded!.usedFallback).toBe(true)
    // 回退到 gen1：没有 c.md，a.md 仍是旧 size
    expect(loaded!.model.files.has('c.md')).toBe(false)
    expect(loaded!.model.files.get('a.md')!.size).toBe(100)
  })

  it('所有代损坏 → 返回 null 交由上层全量重建', async () => {
    const port = makePort()
    const gen1 = await commitTo(port, modelOf(['a.md'], 1))
    const model2 = modelOf(['a.md', 'b.md'], 1)
    model2.files.get('a.md')!.contentVersion = 2
    const gen2 = await commitTo(port, model2)
    port.files.set(`${BASE}/${gen1}/manifest.json`, '{{{')
    port.files.set(`${BASE}/${gen2}/manifest.json`, '{{{')
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).toBeNull()
  })

  it('CURRENT 指向不存在的代 → 回退扫描真实存在的旧代', async () => {
    const port = makePort()
    await commitTo(port, modelOf(['a.md'], 1))
    // 人为把 CURRENT 指向不存在的代
    port.files.set(`${BASE}/CURRENT`, 'gen-000099-abcd')
    const loaded = await loadSnapshot(port, BASE)
    // 回退扫描能找到真实存在的旧代
    expect(loaded).not.toBeNull()
    expect(loaded!.usedFallback).toBe(true)
  })

  it('继承链断裂（源代目录被回收）→ 该代不可用', async () => {
    const port = makePort()
    const model1 = modelOf(['a.md', 'b.md'], 2)
    const plan1 = await applyWrites(port, planSnapshotCommit(model1, { baseDir: BASE, shardCount: 2 }))
    const dir1 = plan1.writes[plan1.writes.length - 1].content.trim()
    const shards1 = plan1.writes.filter((w) => /shard-\d+\.json$/.test(w.path))
    // 增量提交：改动落片，其余继承 gen1
    const model2 = modelOf(['a.md', 'b.md'], 2)
    model2.files.get('a.md')!.size = 777
    const plan2 = planSnapshotCommit(model2, {
      baseDir: BASE,
      shardCount: 2,
      prev: {
        generation: plan1.generation,
        dirName: dir1,
        shardChecksums: new Map(shards1.map((w) => {
          const idx = Number(w.path.match(/shard-(\d+)\.json$/)![1])
          return [idx, stableHash(w.content)] as const
        })),
      },
    })
    await applyWrites(port, plan2)
    // 模拟过早回收：把继承源目录删除
    for (const key of [...port.files.keys()]) {
      if (key.startsWith(`${BASE}/${dir1}/`)) port.files.delete(key)
    }
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).toBeNull()
  })

  it('无任何快照 → null', async () => {
    expect(await loadSnapshot(makePort(), BASE)).toBeNull()
  })
})

describe('planSnapshotCommitChunked 分批提交（ADR-0008 片间让出接线，#197）', () => {
  it('产物与同步版逐字段一致（一致性钉住——同一实现路径，仅片间插入让出）', async () => {
    const model = modelOf(['a.md', 'b.md', 'c.md', 'd.md'], 3)
    const opts = { baseDir: BASE, shardCount: 3, existingDirs: ['gen-000001-old'] }
    const sync = planSnapshotCommit(model, opts)
    const chunked = await planSnapshotCommitChunked(model, opts, async () => {})
    expect(chunked).toEqual(sync)
  })

  it('每片序列化后让出事件循环（yield 次数 = 实写片数；继承片不重算不计数）', async () => {
    const model = modelOf(['a.md', 'b.md'], 1)
    const opts = { baseDir: BASE, shardCount: 2 }
    const plan = await planSnapshotCommitChunked(model, opts, async () => {})
    expect(plan.stats.writtenShards).toBe(2)
    let yields = 0
    await planSnapshotCommitChunked(model, opts, async () => {
      yields += 1
    })
    expect(yields).toBe(2)
    // 增量：未变片继承，只对变化片让出
    const port = makePort()
    await applyWrites(port, plan)
    const changed = modelOf(['a.md', 'b.md', 'c.md'], 1)
    const checksums = new Map<number, string>()
    for (const [k, v] of port.files) {
      const m = k.match(new RegExp(`^${BASE}/${plan.dirName}/shard-(\\d+)\\.json$`))
      if (m) checksums.set(Number(m[1]), stableHash(v))
    }
    let incYields = 0
    await planSnapshotCommitChunked(changed, {
      baseDir: BASE, shardCount: 2,
      prev: { generation: plan.generation, dirName: plan.dirName, shardChecksums: checksums },
    }, async () => {
      incYields += 1
    })
    expect(incYields).toBeGreaterThanOrEqual(1)
    expect(incYields).toBeLessThan(3)
  })

  it('写回端口后可正常恢复（与同步版同一崩溃安全契约）', async () => {
    const port = makePort()
    const model = modelOf(['a.md', 'b.md'], 2)
    const plan = await planSnapshotCommitChunked(model, { baseDir: BASE, shardCount: 2 }, async () => {})
    for (const w of plan.writes) port.files.set(w.path, w.content)
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).not.toBeNull()
    expect(loaded!.meta.generation).toBe(plan.generation)
    expect(loaded!.model.files.size).toBe(2)
  })
})

describe('代际回收计划', () => {
  it('提交成功后列出可回收目录：旧代、同代号孤儿目录与 tmp- 残留', async () => {
    const port = makePort()
    const plan1 = await applyWrites(port, planSnapshotCommit(modelOf(['a.md']), { baseDir: BASE, shardCount: 2 }))
    const dir1 = plan1.writes[plan1.writes.length - 1].content.trim()
    // 模拟残留：更旧代 + 同代号孤儿 + 临时目录
    port.files.set(`${BASE}/gen-000001-old7/shard-0.json`, 'x')
    port.files.set(`${BASE}/tmp-write-1234/shard-0.json`, 'x')
    const gen1Num = Number(dir1.match(/^gen-(\d+)/)![1])
    port.files.set(`${BASE}/gen-${String(gen1Num).padStart(6, '0')}-orphan/shard-0.json`, 'x')

    const model2 = modelOf(['a.md', 'b.md'], 1)
    const orphanName = `gen-${String(gen1Num).padStart(6, '0')}-orphan`
    const plan2 = planSnapshotCommit(model2, {
      baseDir: BASE,
      shardCount: 2,
      prev: { generation: plan1.generation, dirName: dir1, shardChecksums: new Map() },
      existingDirs: ['gen-000001-old7', 'tmp-write-1234', orphanName, dir1],
    })
    const names = plan2.obsoleteDirs
    expect(names).toContain('gen-000001-old7')
    expect(names).toContain('tmp-write-1234')
    expect(names.some((n) => n.startsWith('gen-') && n.endsWith('-orphan'))).toBe(true)
    // 当前新代与上一代（继承源）不在回收清单
    expect(names).not.toContain(dir1)
  })
})

describe('缓存清理计划（#198 清理当前工作区缓存）', () => {
  it('保留 CURRENT 代、其继承源与更高代际（可能是并发窗口在途提交），回收更旧代与 tmp- 残留', () => {
    const names = planCleanupDirs({
      currentDirName: 'gen-000003-w1',
      inheritSources: ['gen-000002-w0'],
      existingDirs: [
        'gen-000001-w0',   // 更旧代：回收
        'gen-000002-w0',   // 继承源：保留
        'gen-000003-w1',   // CURRENT：保留
        'gen-000004-w2',   // 更高代（并发在途）：保留
        'tmp-write-9',     // 临时残留：回收
        'not-a-gen-dir',   // 非法目录名残留：回收
      ],
    })
    expect(names).toEqual(['gen-000001-w0', 'tmp-write-9', 'not-a-gen-dir'])
  })

  it('无 CURRENT（无快照）时保留最高代目录（在途提交保守），其余 gen 与 tmp- 回收', () => {
    const names = planCleanupDirs({
      currentDirName: null,
      inheritSources: [],
      existingDirs: ['gen-000001-a', 'gen-000007-b', 'tmp-x'],
    })
    expect(names.sort()).toEqual(['gen-000001-a', 'tmp-x'])
  })

  it('同代异写者目录（并发窗口完整旧代）保守保留，仅严格更旧代回收', () => {
    const names = planCleanupDirs({
      currentDirName: 'gen-000005-a',
      inheritSources: [],
      existingDirs: ['gen-000005-b', 'gen-000004-a'],
    })
    expect(names).toEqual(['gen-000004-a'])
  })
})

describe('快照格式健壮性', () => {
  it('formatVersion 不符的代视为损坏并回退', async () => {
    const port = makePort()
    const gen1 = await commitTo(port, modelOf(['a.md'], 1))
    const model2 = modelOf(['a.md', 'b.md'], 1)
    const plan2 = planSnapshotCommit(model2, { baseDir: BASE, shardCount: 2, prev: { generation: 1, dirName: gen1, shardChecksums: new Map() } })
    await applyWrites(port, plan2)
    const dir2 = plan2.writes[plan2.writes.length - 1].content.trim()
    const m = JSON.parse(port.files.get(`${BASE}/${dir2}/manifest.json`)!)
    m.formatVersion = 999
    port.files.set(`${BASE}/${dir2}/manifest.json`, JSON.stringify(m))
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded!.usedFallback).toBe(true)
  })

  it('边与文件条目字段完整往返（kind/mtime/size/contentVersion/resolvedTarget/anchor/kind/区间）', async () => {
    const model: VaultIndexModel = {
      files: new Map([
        ['笔记 甲.md', { path: '笔记 甲.md', kind: 'markdown', mtimeMs: 1_712_345_678_901, size: 4321, contentVersion: 7 }],
        ['attachments/图 乙.png', { path: 'attachments/图 乙.png', kind: 'asset', mtimeMs: 1_712_345_600_000, size: 88, contentVersion: 1 }],
      ]),
      edges: [
        {
          source: '笔记 甲.md',
          target: '子/设计.md#标题 一',
          resolvedTarget: '子/设计.md',
          kind: 'mdlink',
          anchor: '标题 一',
          start: 12,
          end: 48,
        },
        {
          source: '笔记 甲.md',
          target: '图 乙.png',
          resolvedTarget: 'attachments/图 乙.png',
          kind: 'image',
          anchor: '',
          start: 50,
          end: 80,
        },
        {
          source: '笔记 甲.md',
          target: '缺失 页面',
          resolvedTarget: null,
          kind: 'wikilink',
          anchor: '',
          start: 82,
          end: 96,
        },
      ],
    }
    const port = makePort()
    await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 1 }))
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded!.model.files.get('笔记 甲.md')).toEqual(model.files.get('笔记 甲.md'))
    expect(loaded!.model.files.get('attachments/图 乙.png')).toEqual(model.files.get('attachments/图 乙.png'))
    expect(loaded!.model.edges).toEqual(sortEdges(model.edges))
  })

  it('v1 旧格式（无 kind/resolvedTarget 列）拒读并回退，格式版本常量为 2', async () => {
    expect(SNAPSHOT_FORMAT_VERSION).toBe(2)
    const port = makePort()
    // 手工伪造一个 v1 代：文件行 4 列、边行 6 列（旧格式）
    port.files.set(`${BASE}/CURRENT`, 'gen-000001-w000')
    port.files.set(`${BASE}/gen-000001-w000/manifest.json`, JSON.stringify({
      formatVersion: 1,
      generation: 1,
      shardCount: 1,
      shards: [{ i: 0, bytes: 10, checksum: 'x', inheritedFrom: null }],
      stats: { fileCount: 1, edgeCount: 0 },
    }))
    port.files.set(`${BASE}/gen-000001-w000/shard-000.json`, JSON.stringify({
      v: 1, names: ['a.md'], files: [[0, 1, 2, 3]], edges: [],
    }))
    expect(await loadSnapshot(port, BASE)).toBeNull()
  })
})

describe('review-loops 修复：增量继承链跨代与回收保留集合', () => {
  /** 增量提交（从端口读回上一代 manifest——与生产 commitSnapshot 同源：
   *  片校验和 + 片实体位置，继承沿用上游实体位置而非恒记 prev 目录名） */
  async function commitInc(port: VaultIndexFsPort & { files: Map<string, string> }, model: VaultIndexModel, prevDir: string) {
    const manifest = JSON.parse(port.files.get(`${BASE}/${prevDir}/manifest.json`)!) as {
      generation: number
      shards: Array<{ i: number; checksum: string; inheritedFrom: string | null }>
    }
    const prev = {
      generation: manifest.generation,
      dirName: prevDir,
      shardChecksums: new Map(manifest.shards.map((s) => [s.i, s.checksum])),
      shardLocations: new Map(manifest.shards.map((s) => [s.i, s.inheritedFrom ?? prevDir])),
    }
    const plan = await applyWrites(port, planSnapshotCommit(model, {
      baseDir: BASE, shardCount: 2, prev,
      existingDirs: await port.listDirs(BASE),
    }))
    return plan
  }

  /** 应用回收清单（模拟生产提交成功后的 removeDir） */
  async function applyObsolete(port: VaultIndexFsPort & { files: Map<string, string> }, plan: ReturnType<typeof planSnapshotCommit>) {
    for (const name of plan.obsoleteDirs) {
      for (const key of [...port.files.keys()]) {
        if (key === `${BASE}/${name}` || key.startsWith(`${BASE}/${name}/`)) port.files.delete(key)
      }
    }
  }

  /** 按片分组选路径：返回 shardId===want 的前 n 个（保证改动只落单一片，
   *  其余片两代不变——制造跨代继承片的稳定构造） */
  function pickShard(paths: string[], want: number, shardCount: number, n: number): string[] {
    return paths.filter((p) => shardIdForPath(p, shardCount) === want).slice(0, n)
  }

  it('三连代增量提交后 CURRENT 代可加载且内容完整，gen1 实体目录仍被保留', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `dir${i % 8}/note${i}.md`)
    const port = makePort()
    const model1 = modelOf(paths, 2)
    const plan1 = await applyWrites(port, planSnapshotCommit(model1, { baseDir: BASE, shardCount: 2 }))
    const gen1 = plan1.dirName
    // gen2：只改片 0 的文件（片 1 继承 gen1，实体留在 gen1）
    const shard0 = pickShard(paths, 0, 2, 2)
    expect(shard0.length).toBe(2)
    const model2 = modelOf(paths, 2)
    for (const p of shard0) model2.files.get(p)!.size = 555
    const plan2 = await commitInc(port, model2, gen1)
    const gen2 = plan2.dirName
    // gen3：再改片 0 的其他属性（片 1 两代未变——继承自 gen2 的继承片，
    // 实体仍在 gen1；恒记 prev 目录名的旧实现在此断裂）
    const model3 = modelOf(paths, 2)
    for (const p of shard0) model3.files.get(p)!.contentVersion = 9
    const plan3 = await commitInc(port, model3, gen2)
    const gen3 = plan3.dirName
    await applyObsolete(port, plan3)
    // gen1 实体目录仍在（gen3 的片 1 继承链指向它的实体）
    expect(port.files.get(`${BASE}/${gen1}/shard-001.json`)).toBeDefined()
    // CURRENT 代（gen3）直接可加载且内容完整（不回退到 gen2 旧内容）
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded).not.toBeNull()
    expect(loaded!.usedFallback).toBe(false)
    expect(loaded!.meta.dirName).toBe(gen3)
    for (const p of paths) {
      expect(loaded!.model.files.get(p)).toEqual(model3.files.get(p))
    }
  })

  it('gen3 提交的回收清单不含其继承片实体目录（gen1 与 gen2 都保留）', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `dir${i % 8}/note${i}.md`)
    const port = makePort()
    const model1 = modelOf(paths, 2)
    const plan1 = await applyWrites(port, planSnapshotCommit(model1, { baseDir: BASE, shardCount: 2 }))
    const gen1 = plan1.dirName
    const shard0 = pickShard(paths, 0, 2, 2)
    const model2 = modelOf(paths, 2)
    for (const p of shard0) model2.files.get(p)!.size = 555
    const plan2 = await commitInc(port, model2, gen1)
    const model3 = modelOf(paths, 2)
    for (const p of shard0) model3.files.get(p)!.contentVersion = 9
    const plan3 = await commitInc(port, model3, plan2.dirName)
    expect(plan3.obsoleteDirs).not.toContain(gen1)
    expect(plan3.obsoleteDirs).not.toContain(plan2.dirName)
  })

  it('gen2 提交后回收：gen1 仍被 gen2 引用时保留（继承源语义回归钉住）', async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `dir${i % 8}/note${i}.md`)
    const port = makePort()
    const model1 = modelOf(paths, 2)
    const plan1 = await applyWrites(port, planSnapshotCommit(model1, { baseDir: BASE, shardCount: 2 }))
    const shard0 = pickShard(paths, 0, 2, 2)
    const model2 = modelOf(paths, 2)
    for (const p of shard0) model2.files.get(p)!.size = 555
    const plan2 = await commitInc(port, model2, plan1.dirName)
    expect(plan2.obsoleteDirs).not.toContain(plan1.dirName)
  })
})

describe('review-loops 修复：清理计划的 CURRENT 缺失保守与 tmp 文件回收', () => {
  it('无 CURRENT（无快照或已整体损坏）时保留最高代号 gen 目录（在途提交保守策略）', () => {
    const names = planCleanupDirs({
      currentDirName: null,
      inheritSources: [],
      existingDirs: ['gen-000001-a', 'gen-000007-b', 'gen-000003-c', 'tmp-x'],
    })
    // 最高代 gen-000007-b 可能是并发窗口的在途提交：保守保留
    expect(names).not.toContain('gen-000007-b')
    expect(names.sort()).toEqual(['gen-000001-a', 'gen-000003-c', 'tmp-x'])
  })

  it('无 CURRENT 时同最高代号多写者目录全部保守保留', () => {
    const names = planCleanupDirs({
      currentDirName: null,
      inheritSources: [],
      existingDirs: ['gen-000004-a', 'gen-000004-b', 'gen-000002-c'],
    })
    expect(names).toEqual(['gen-000002-c'])
  })

  it('提交回收与清理计划均回收 baseDir 直下的原子写 tmp 文件（*.json.tmp-<hex>）', () => {
    const plan = planSnapshotCommit(modelOf(['a.md'], 1), {
      baseDir: BASE, shardCount: 1,
      existingDirs: [],
      existingFiles: ['shard-000.json.tmp-deadbeef', 'manifest.json.tmp-0102030a', 'CURRENT'],
    })
    expect(plan.obsoleteDirs).toContain('shard-000.json.tmp-deadbeef')
    expect(plan.obsoleteDirs).toContain('manifest.json.tmp-0102030a')
    expect(plan.obsoleteDirs).not.toContain('CURRENT')
    // 清理计划同域
    const names = planCleanupDirs({
      currentDirName: null,
      inheritSources: [],
      existingDirs: [],
      existingFiles: ['shard-000.json.tmp-deadbeef', 'CURRENT.tmp-abcd1234'],
    })
    expect(names).toEqual(['shard-000.json.tmp-deadbeef'])
  })
})

describe('review-loops 修复：代目录名白名单（载荷构造防路径穿越）', () => {
  /** 解析 `..` 的 readFile 端口（贴近真 fs 语义：路径穿越会被文件系统解析） */
  function makeNormalizingPort(initial: Record<string, string> = {}): VaultIndexFsPort & { files: Map<string, string> } {
    const port = makePort(initial)
    const resolve = (p: string): string => {
      const out: string[] = []
      for (const seg of p.split('/')) {
        if (seg === '..') out.pop()
        else if (seg !== '.') out.push(seg)
      }
      return out.join('/')
    }
    return {
      files: port.files,
      listDirs: port.listDirs,
      async readFile(path: string) {
        const content = port.files.get(resolve(path))
        if (content === undefined) throw new Error(`ENOENT: ${path}`)
        return content
      },
    }
  }

  it('CURRENT 内容为非法代目录名（路径穿越形态）时按缺失处理，不读取逃逸路径', async () => {
    const port = makeNormalizingPort()
    const model = modelOf(['a.md'], 1)
    const plan = await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 1 }))
    // 攻击载荷：CURRENT 指向 baseDir 外的伪造代（真实 fs 下 `..` 会被解析）
    const escapeDir = plan.dirName + '/../../evil'
    // 逃逸目标：`${BASE}/../evil/`（穿越出 baseDir 一层）
    const baseParent = BASE.slice(0, BASE.lastIndexOf('/'))
    port.files.set(`${baseParent}/evil/manifest.json`, port.files.get(`${BASE}/${plan.dirName}/manifest.json`)!)
    port.files.set(`${baseParent}/evil/shard-000.json`, port.files.get(`${BASE}/${plan.dirName}/shard-000.json`)!)
    port.files.set(`${BASE}/CURRENT`, escapeDir)
    const loaded = await loadSnapshot(port, BASE)
    // 白名单拒绝穿越形态 → 回退扫描真实存在的合法代（而非逃逸目录）
    expect(loaded).not.toBeNull()
    expect(loaded!.usedFallback).toBe(true)
    expect(loaded!.meta.dirName).toBe(plan.dirName)
  })

  it('manifest 的 inheritedFrom 为非法目录名时该代判损坏（不拼接读取）', async () => {
    const port = makeNormalizingPort()
    const paths = Array.from({ length: 40 }, (_, i) => `dir${i % 8}/note${i}.md`)
    const model1 = modelOf(paths, 2)
    const plan1 = await applyWrites(port, planSnapshotCommit(model1, { baseDir: BASE, shardCount: 2 }))
    // 只改片 0 的文件：片 1 继承（制造带继承片的 gen2）
    const shard0 = paths.filter((p) => shardIdForPath(p, 2) === 0).slice(0, 2)
    const model2 = modelOf(paths, 2)
    for (const p of shard0) model2.files.get(p)!.size = 999
    const shardChecksums = new Map<number, string>()
    for (const [k, v] of port.files) {
      const m = k.match(new RegExp(`^${BASE}/${plan1.dirName}/shard-(\\d+)\\.json$`))
      if (m) shardChecksums.set(Number(m[1]), stableHash(v))
    }
    const plan2 = planSnapshotCommit(model2, {
      baseDir: BASE, shardCount: 2,
      prev: { generation: plan1.generation, dirName: plan1.dirName, shardChecksums },
    })
    await applyWrites(port, plan2)
    // 篡改 manifest：继承片来源指向逃逸路径，并在逃逸处预置同名片
    //（不加白名单时 normalizing fs 会解析 `..` 读到该文件——加载"成功"）
    const manifest = JSON.parse(port.files.get(`${BASE}/${plan2.dirName}/manifest.json`)!) as {
      shards: Array<{ i: number; inheritedFrom: string | null }>
    }
    const inherited = manifest.shards.find((s) => s.inheritedFrom !== null)!
    const escapeDir = `${BASE.slice(0, BASE.lastIndexOf('/'))}/evil`
    port.files.set(`${escapeDir}/shard-${String(inherited.i).padStart(3, '0')}.json`,
      port.files.get(`${BASE}/${plan1.dirName}/shard-${String(inherited.i).padStart(3, '0')}.json`)!)
    inherited.inheritedFrom = plan2.dirName + '/../../evil'
    port.files.set(`${BASE}/${plan2.dirName}/manifest.json`, JSON.stringify(manifest))
    const loaded = await loadSnapshot(port, BASE)
    // gen2 判损坏 → 回退 gen1（而不是沿逃逸路径找片伪装加载成功）
    expect(loaded!.usedFallback).toBe(true)
    expect(loaded!.model.files.get(shard0[0])!.size).toBe(100)
  })

  it('回退扫描对 listDirs 结果同样收紧为完整白名单形态', async () => {
    const port = makePort()
    const model = modelOf(['a.md'], 1)
    const plan = await applyWrites(port, planSnapshotCommit(model, { baseDir: BASE, shardCount: 1 }))
    // 伪造一个名字不符合白名单（含特殊字符）但内容完整可加载的更高代目录：
    // 不收紧时回退扫描会按 genNumOf 优先选中它
    const evilDir = 'gen-000009-x!evil'
    port.files.set(`${BASE}/${evilDir}/manifest.json`, port.files.get(`${BASE}/${plan.dirName}/manifest.json`)!)
    port.files.set(`${BASE}/${evilDir}/shard-000.json`, port.files.get(`${BASE}/${plan.dirName}/shard-000.json`)!)
    port.files.set(`${BASE}/CURRENT`, 'gone')
    const loaded = await loadSnapshot(port, BASE)
    expect(loaded!.meta.dirName).toBe(plan.dirName)
  })
})

