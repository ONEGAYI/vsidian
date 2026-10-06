// 全文件清单快照纯逻辑单测（#377 T02）：单文件原子持久化（catalog.json）
// 的序列化/解析契约——紧凑行式 JSON、损坏返回 null 走重建、未知 mtime/size
// 显式保留 0（不伪装为当前时间）、complete 标志随快照往返。
import { describe, expect, it } from 'vitest'
import {
  CATALOG_FORMAT_VERSION,
  diffVaultCatalog,
  parseVaultCatalog,
  serializeVaultCatalog,
  type VaultCatalogEntry,
} from '../../src/shared/vaultFileCatalog'

const entry = (relPath: string, category: VaultCatalogEntry['category'], mtimeMs = 0, size = 0): VaultCatalogEntry =>
  ({ relPath, category, mtimeMs, size })

describe('serializeVaultCatalog / parseVaultCatalog（往返契约）', () => {
  it('全字段往返：relPath/category/mtimeMs/size 与 complete 标志逐项还原', () => {
    const entries = [
      entry('笔记.md', 'markdown', 1_700_000_000_001, 120),
      entry('素材/配图.png', 'image', 1_700_000_000_002, 4096),
      entry('手册.pdf', 'pdf', 1_700_000_000_003, 999_999),
      entry('音乐.mp3', 'audio', 0, 0),
      entry('片段.mp4', 'video', 1_700_000_000_004, 8192),
      entry('配置.json', 'text', 1_700_000_000_005, 64),
      entry('缓存.pyc', 'other', 0, 0),
    ]
    const content = serializeVaultCatalog(entries, true)
    const parsed = parseVaultCatalog(content)
    expect(parsed?.complete).toBe(true)
    expect(parsed?.entries).toEqual(entries)
  })

  it('未知 mtime/size 序列化为 0 且解析仍为 0（不伪装为当前时间）', () => {
    const content = serializeVaultCatalog([entry('缓存.pyc', 'other'), entry('无统计图.png', 'image')], true)
    const parsed = parseVaultCatalog(content)
    expect(parsed?.entries.every((e) => e.mtimeMs === 0 && e.size === 0)).toBe(true)
  })

  it('文件名含特殊字符（空格/中文/引号/反斜杠）往返不损', () => {
    const weird = '深 层/「引号」文件\\反斜杠.png'
    const parsed = parseVaultCatalog(serializeVaultCatalog([entry(weird, 'image', 5, 6)], true))
    expect(parsed?.entries[0]?.relPath).toBe(weird)
  })

  it('空清单往返（complete=true）', () => {
    const parsed = parseVaultCatalog(serializeVaultCatalog([], true))
    expect(parsed?.complete).toBe(true)
    expect(parsed?.entries).toEqual([])
  })
})

describe('parseVaultCatalog（损坏与容错）', () => {
  it('非 JSON / 缺字段 / 版本不符 / 类型不对 → null（调用方走重建）', () => {
    expect(parseVaultCatalog('not json')).toBeNull()
    expect(parseVaultCatalog('{"v":99,"complete":true,"entries":[]}')).toBeNull()
    expect(parseVaultCatalog('{"complete":true,"entries":[]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"entries":[]}')).toBeNull() // 缺 complete
    expect(parseVaultCatalog('{"v":1,"complete":true}')).toBeNull() // 缺 entries
    expect(parseVaultCatalog('{"v":1,"complete":"yes","entries":[]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":"nope"}')).toBeNull()
  })

  it('行结构不对（长度/类型/未知分类码/负值）→ null', () => {
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":[["a.md"]]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":[[1,0,0,0]]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":[["a.md",99,0,0]]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":[["a.md",0,-1,0]]}')).toBeNull()
    expect(parseVaultCatalog('{"v":1,"complete":true,"entries":[["",0,0,0]]}')).toBeNull()
  })

  it('重复 relPath 取末次出现（幂等收敛，不判损坏）', () => {
    const parsed = parseVaultCatalog(
      '{"v":1,"complete":true,"entries":[["a.md",0,1,1],["a.md",0,2,2]]}',
    )
    expect(parsed?.entries).toEqual([entry('a.md', 'markdown', 2, 2)])
  })
})

describe('diffVaultCatalog（清单核验的纯 diff）', () => {
  it('added/changed/removed 三分：mtime 或 size 变化即 changed', () => {
    const known = new Map([
      ['a.md', { mtimeMs: 1, size: 10 }],
      ['b.png', { mtimeMs: 2, size: 20 }],
      ['c.pyc', { mtimeMs: 0, size: 0 }],
    ])
    const current = [
      { path: 'a.md', mtimeMs: 1, size: 10 }, // 不变
      { path: 'b.png', mtimeMs: 3, size: 20 }, // mtime 变
      { path: 'd.txt', mtimeMs: 4, size: 40 }, // 新增
    ]
    expect(diffVaultCatalog(known, current)).toEqual({
      added: ['d.txt'],
      changed: ['b.png'],
      removed: ['c.pyc'],
    })
  })

  it('仅记名条目（未知元数据）与缺失 stat 的列举项不误报 changed', () => {
    const known = new Map([['c.pyc', { mtimeMs: 0, size: 0 }]])
    const current = [{ path: 'c.pyc', mtimeMs: 0, size: 0 }]
    expect(diffVaultCatalog(known, current)).toEqual({ added: [], changed: [], removed: [] })
  })
})

describe('CATALOG_FORMAT_VERSION', () => {
  it('版本号为正整数（格式演进时递增触发旧缓存重建）', () => {
    expect(CATALOG_FORMAT_VERSION).toBeGreaterThan(0)
  })
})
