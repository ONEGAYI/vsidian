// 反链面板分组纯逻辑测试（形态改版批次）：分组聚合、四种排序键 × 方向、
// 未知时间沉底、搜索过滤（文件名/片段、大小写不敏感、空结果）、折叠标记
// 派生。纯函数直驱（groupBacklinks / backlinkGroupKeysOf / allGroupsCollapsed）。
import { describe, expect, it } from 'vitest'
import {
  allGroupsCollapsed,
  backlinkGroupKeysOf,
  groupBacklinks,
  type BacklinkSortMode,
} from '../../src/webview/backlinkGrouping'
import type { BacklinkItemPayload } from '../../src/shared/protocol'

function itemOf(overrides: Partial<BacklinkItemPayload> = {}): BacklinkItemPayload {
  return {
    sourceRelPath: 'a.md',
    sourceFsPath: 'C:/vault/a.md',
    kind: 'wikilink',
    anchor: '',
    start: 10,
    end: 18,
    line: 2,
    snippet: 'snippet-a',
    sourceMtimeMs: 100,
    sourceBirthtimeMs: 10,
    ...overrides,
  }
}

/** 三来源 fixture：名称序 alpha < beta < gamma；时间故意错序 */
const items: BacklinkItemPayload[] = [
  itemOf({ sourceRelPath: 'gamma.md', sourceMtimeMs: 300, sourceBirthtimeMs: 0, snippet: '最早创建未知' }),
  itemOf({ sourceRelPath: 'alpha.md', sourceMtimeMs: 200, sourceBirthtimeMs: 100, snippet: 'Alpha 引用', start: 30, end: 40 }),
  itemOf({ sourceRelPath: 'beta.md', sourceMtimeMs: 100, sourceBirthtimeMs: 200, snippet: 'beta 引用' }),
  itemOf({ sourceRelPath: 'alpha.md', sourceMtimeMs: 200, sourceBirthtimeMs: 100, snippet: '第二处', start: 50, end: 60 }),
]

const labels = (mode: BacklinkSortMode, query = ''): string[] =>
  groupBacklinks(items, { sortMode: mode, query }).groups.map((g) => g.label)

describe('groupBacklinks：分组聚合', () => {
  it('按来源聚合；组内条目保持宿主稳定序（区间升序）', () => {
    const result = groupBacklinks(items, { sortMode: 'name-asc', query: '' })
    expect(result.groups).toHaveLength(3)
    const alpha = result.groups.find((g) => g.key === 'alpha.md')!
    expect(alpha.items.map((i) => i.start)).toEqual([30, 50])
    expect(alpha.label).toBe('alpha')
    expect(alpha.mtimeMs).toBe(200)
    expect(result.totalCount).toBe(4)
    expect(result.matchedCount).toBe(4)
  })

  it('排序切换不改变组内条目序（固定稳定序：路径→区间起点）', () => {
    for (const mode of ['name-desc', 'mtime-asc', 'birth-desc'] as const) {
      const alpha = groupBacklinks(items, { sortMode: mode, query: '' }).groups.find((g) => g.key === 'alpha.md')!
      expect(alpha.items.map((i) => i.start)).toEqual([30, 50])
    }
  })
})

describe('groupBacklinks：排序六项', () => {
  it('文件名码位升/降', () => {
    expect(labels('name-asc')).toEqual(['alpha', 'beta', 'gamma'])
    expect(labels('name-desc')).toEqual(['gamma', 'beta', 'alpha'])
  })

  it('编辑时间：从新到旧 / 从旧到新', () => {
    // mtime：gamma 300 > alpha 200 > beta 100
    expect(labels('mtime-desc')).toEqual(['gamma', 'alpha', 'beta'])
    expect(labels('mtime-asc')).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('创建时间：从新到旧 / 从旧到新；未知（0）沉底且与方向无关', () => {
    // birth：beta 200 > alpha 100 > gamma 0（未知）
    expect(labels('birth-desc')).toEqual(['beta', 'alpha', 'gamma'])
    expect(labels('birth-asc')).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('未知时间沉底保持稳定序：全部未知时回落码位序', () => {
    const unknown: BacklinkItemPayload[] = [
      itemOf({ sourceRelPath: 'b.md', sourceBirthtimeMs: 0, sourceMtimeMs: 0 }),
      itemOf({ sourceRelPath: 'a.md', sourceBirthtimeMs: 0, sourceMtimeMs: 0 }),
    ]
    const result = groupBacklinks(unknown, { sortMode: 'birth-desc', query: '' })
    expect(result.groups.map((g) => g.label)).toEqual(['a', 'b'])
  })
})

describe('groupBacklinks：搜索过滤', () => {
  it('匹配来源文件名与片段文本，不区分大小写', () => {
    expect(groupBacklinks(items, { sortMode: 'name-asc', query: 'ALPHA' }).matchedCount).toBe(2)
    expect(groupBacklinks(items, { sortMode: 'name-asc', query: 'beta 引用' }).matchedCount).toBe(1)
    // gamma 的 snippet「最早创建未知」
    expect(groupBacklinks(items, { sortMode: 'name-asc', query: '未知' }).matchedCount).toBe(1)
  })

  it('长片段文本也参与匹配（「更多上下文」开态的过滤语义）', () => {
    const withLong = [itemOf({ snippet: '短', snippetLong: 'long-context-xyz' })]
    expect(groupBacklinks(withLong, { sortMode: 'name-asc', query: 'xyz' }).matchedCount).toBe(1)
  })

  it('空词不过滤；空白词等价空词', () => {
    expect(groupBacklinks(items, { sortMode: 'name-asc', query: '   ' }).matchedCount).toBe(4)
  })

  it('无匹配：groups 空数组 + matchedCount 0（渲染层呈「无匹配」占位）', () => {
    const result = groupBacklinks(items, { sortMode: 'name-asc', query: 'zzz不存在' })
    expect(result.groups).toEqual([])
    expect(result.matchedCount).toBe(0)
    expect(result.totalCount).toBe(4)
  })
})

describe('折叠标记派生', () => {
  it('backlinkGroupKeysOf：快照序去重', () => {
    expect(backlinkGroupKeysOf(items)).toEqual(['gamma.md', 'alpha.md', 'beta.md'])
  })

  it('allGroupsCollapsed：全部组入集合才 true；无组为 false', () => {
    const keys = backlinkGroupKeysOf(items)
    const partial = new Set(keys.slice(0, 2))
    expect(allGroupsCollapsed(items, partial)).toBe(false)
    expect(allGroupsCollapsed(items, new Set(keys))).toBe(true)
    expect(allGroupsCollapsed([], new Set())).toBe(false)
  })
})
