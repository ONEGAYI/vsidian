// #197 索引覆盖层纯逻辑测试：未保存文档的内存覆盖层（版本淘汰仲裁 +
// 反链查询合成）。事实源约定（#194 规格）：未保存内容只作内存覆盖层，
// 不污染磁盘基线；变更版本递增，旧扫描/旧请求不得覆盖新版本。
import { describe, expect, it } from 'vitest'
import { VaultIndexOverlay, queryBacklinks } from '../../src/host/vaultIndexOverlay'
import { buildBacklinkIndex, type VaultEdge, type VaultIndexModel } from '../../src/shared/vaultIndexSnapshot'

function edge(source: string, target: string, resolved: string | null, start = 0): VaultEdge {
  return { source, target, resolvedTarget: resolved, kind: 'wikilink', anchor: '', start, end: start + 1 }
}

function modelOf(files: string[], edges: VaultEdge[]): VaultIndexModel {
  return {
    files: new Map(files.map((f) => [f, { path: f, kind: 'markdown' as const, mtimeMs: 0, size: 0, contentVersion: 1 }])),
    edges,
  }
}

describe('VaultIndexOverlay：版本淘汰', () => {
  it('版本递增采纳：同版本或更旧版本的结果被丢弃（旧扫描不覆盖新内容）', () => {
    const overlay = new VaultIndexOverlay()
    expect(overlay.apply('a.md', 5, [edge('a.md', 'b', 'b.md')])).toBe(true)
    // 旧扫描结果（版本 5 途中文档已推进到 6）到达：丢弃
    expect(overlay.apply('a.md', 5, [edge('a.md', '旧', null)])).toBe(false)
    expect(overlay.apply('a.md', 4, [edge('a.md', '更旧', null)])).toBe(false)
    expect(overlay.get('a.md')?.edges).toEqual([edge('a.md', 'b', 'b.md')])
    expect(overlay.apply('a.md', 7, [edge('a.md', '新', null)])).toBe(true)
    expect(overlay.get('a.md')?.contentVersion).toBe(7)
  })

  it('clear 退役覆盖层（保存后回到磁盘基线），未登记路径幂等', () => {
    const overlay = new VaultIndexOverlay()
    overlay.apply('a.md', 3, [edge('a.md', 'b', 'b.md')])
    overlay.clear('a.md')
    expect(overlay.get('a.md')).toBeUndefined()
    expect(() => overlay.clear('a.md')).not.toThrow()
  })
})

describe('queryBacklinks：基线 × 覆盖层合成查询', () => {
  it('基线反链 + 覆盖层文档的边合成；覆盖层文档的基线边被其覆盖替代', () => {
    const base = modelOf(['a.md', 'b.md', 'c.md'], [
      edge('a.md', '目标', '目标.md', 10),
      edge('b.md', '目标', '目标.md', 20),
      edge('c.md', '目标', '目标.md', 30),
    ])
    const overlay = new VaultIndexOverlay()
    // b.md 未保存：编辑后不再引用目标（边清空）——基线中 b.md 的边必须消失
    overlay.apply('b.md', 9, [])
    const edges = queryBacklinks(base, buildBacklinkIndex(base.edges), overlay, '目标.md')
    expect(edges.map((e) => e.source)).toEqual(['a.md', 'c.md'])
  })

  it('覆盖层新增引用即时可见（未保存的 a.md 引用 目标.md）', () => {
    const base = modelOf(['a.md'], [])
    const overlay = new VaultIndexOverlay()
    overlay.apply('a.md', 2, [edge('a.md', '目标', '目标.md', 42)])
    const edges = queryBacklinks(base, buildBacklinkIndex(base.edges), overlay, '目标.md')
    expect(edges).toEqual([edge('a.md', '目标', '目标.md', 42)])
  })

  it('结果按来源路径/位置稳定排序；断链目标按原文聚合（resolved=null 回退 target）', () => {
    const base = modelOf(['a.md', 'b.md'], [
      edge('b.md', '缺失', null, 5),
      edge('a.md', '缺失', null, 9),
    ])
    const edges = queryBacklinks(base, buildBacklinkIndex(base.edges), new VaultIndexOverlay(), '缺失')
    expect(edges.map((e) => [e.source, e.start])).toEqual([['a.md', 9], ['b.md', 5]])
  })

  it('无反链时返回空数组；overlay=null 时纯基线查询（向后兼容）', () => {
    const base = modelOf(['a.md'], [edge('a.md', 'x', 'x.md')])
    expect(queryBacklinks(base, buildBacklinkIndex(base.edges), new VaultIndexOverlay(), '不存在.md')).toEqual([])
    expect(queryBacklinks(base, buildBacklinkIndex(base.edges), null, 'x.md')).toEqual([edge('a.md', 'x', 'x.md')])
  })
})
