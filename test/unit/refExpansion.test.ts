import { describe, expect, it } from 'vitest'
import {
  REF_EXPANSION_LIMITS,
  RefExpansionBudget,
  canonicalRefTargetKey,
  inExpansionPath,
  validChildSource,
} from '../../src/shared/refExpansion'

describe('#244 引用展开路径身份', () => {
  it('Windows 根 A 与回指 A 的目标路径同一身份；POSIX 保留大小写语义', () => {
    const full = { kind: 'full' as const }
    expect(canonicalRefTargetKey('D:\\Notes\\A.md', full, true))
      .toBe(canonicalRefTargetKey('d:/notes/a.md', full, true))
    expect(canonicalRefTargetKey('/Notes/A.md', full, false))
      .not.toBe(canonicalRefTargetKey('/notes/a.md', full, false))
  })

  it('同文件 full、章节与块是不同语义节点；循环只查当前路径', () => {
    const full = canonicalRefTargetKey('/notes/a.md', { kind: 'full' }, false)
    const heading = canonicalRefTargetKey('/notes/a.md', { kind: 'heading', anchor: '第一章' }, false)
    const block = canonicalRefTargetKey('/notes/a.md', { kind: 'block', anchor: '^x' }, false)
    expect(new Set([full, heading, block]).size).toBe(3)
    expect(inExpansionPath([full, heading], full)).toBe(true)
    expect(inExpansionPath([full, heading], block)).toBe(false)
    expect(inExpansionPath([full], heading)).toBe(false)
    expect(inExpansionPath([full], full)).toBe(true)
    expect(canonicalRefTargetKey('/notes/a.md', { kind: 'heading', anchor: 'Foo  Bar' }, false))
      .toBe(canonicalRefTargetKey('/notes/a.md', { kind: 'heading', anchor: ' foo bar ' }, false))
    expect(canonicalRefTargetKey('/notes/a.md', { kind: 'block', anchor: '^Foo' }, false))
      .not.toBe(canonicalRefTargetKey('/notes/a.md', { kind: 'block', anchor: '^foo' }, false))
  })
})

describe('#244 直接父来源', () => {
  const parent = { version: 7, range: { start: 4, end: 25 } }
  const text = 'xxx\n![[C]]\nother text\n'
  it('父版本、可见范围和原文必须同时匹配，未保存版本前移即失效', () => {
    expect(validChildSource(parent, { version: 7, text }, 4, 10, 'C')).toBe(true)
    expect(validChildSource(parent, { version: 8, text }, 4, 10, 'C')).toBe(false)
    expect(validChildSource(parent, { version: 7, text }, 0, 3, 'C')).toBe(false)
    expect(validChildSource(parent, { version: 7, text }, 4, 10, 'Other')).toBe(false)
    expect(validChildSource(parent, { version: 7, text }, 4, 11, 'C')).toBe(false)
  })
  it('围栏、frontmatter、HTML 注释里的独占字面量没有子卡片来源资格', () => {
    for (const text of ['```md\n![[C]]\n```', '---\n![[C]]\n---\nbody', '<!--\n![[C]]\n-->']) {
      const at = text.indexOf('![[C]]')
      const valid = validChildSource({ version: 1, range: { start: 0, end: text.length } },
        { version: 1, text }, at, at + 6, 'C')
      expect(valid, text).toBe(false)
    }
  })
})

describe('#244 引用树与面板预算', () => {
  it('深度默认 3，1 可恢复一层；异常值与工程上界被归一', () => {
    expect(REF_EXPANSION_LIMITS.defaultDepth).toBe(3)
    const budget = new RefExpansionBudget()
    expect(budget.reserve('tree-a', 'b', 1)).toBe('ok')
    expect(budget.reserve('tree-a', 'c', 2)).toBe('ok')
    expect(budget.reserve('tree-a', 'd', 3)).toBe('ok')
    expect(budget.reserve('tree-a', 'e', 4)).toBe('depth')
    budget.setDepthLimit(1)
    expect(budget.reserve('tree-b', 'c2', 2)).toBe('depth')
    budget.setDepthLimit(999)
    expect(budget.depthLimit).toBe(REF_EXPANSION_LIMITS.maxDepth)
    budget.setDepthLimit(Number.NaN)
    expect(budget.depthLimit).toBe(3)
  })

  it('实例逐位置计数；同一全文数据按树与面板各自去重计字节', () => {
    const budget = new RefExpansionBudget({ treeInstances: 2, panelInstances: 3, treeBytes: 100, panelBytes: 150 })
    expect(budget.reserve('one', 'a', 1)).toBe('ok')
    expect(budget.reserve('one', 'b', 2)).toBe('ok')
    expect(budget.reserve('one', 'c', 3)).toBe('instances')
    expect(budget.reserve('two', 'c', 1)).toBe('ok')
    expect(budget.reserve('two', 'd', 2)).toBe('instances')
    expect(budget.attachContent('a', 'shared', 80)).toBe('ok')
    expect(budget.attachContent('b', 'shared', 80)).toBe('ok')
    expect(budget.snapshot()).toMatchObject({ panelInstances: 3, panelBytes: 80, treeBytes: { one: 80 } })
    expect(budget.attachContent('c', 'shared', 80)).toBe('ok')
    expect(budget.snapshot().treeBytes.two).toBe(80)
    budget.release('a')
    expect(budget.snapshot().panelBytes).toBe(80)
    budget.release('b')
    expect(budget.snapshot().panelBytes).toBe(80)
    budget.release('c')
    expect(budget.snapshot()).toMatchObject({ panelInstances: 0, panelBytes: 0 })
  })

  it('全文驻留字节与在途读取达到上限即拒绝，释放后可重试', () => {
    const budget = new RefExpansionBudget({ treeInstances: 4, panelInstances: 4,
      treeBytes: 100, panelBytes: 120, concurrentReads: 1 })
    expect(budget.reserve('one', 'a', 1)).toBe('ok')
    expect(budget.reserve('one', 'b', 2)).toBe('ok')
    expect(budget.beginRead('a')).toBe('ok')
    expect(budget.beginRead('b')).toBe('concurrency')
    budget.finishRead('a')
    expect(budget.beginRead('b')).toBe('ok')
    expect(budget.attachContent('a', 'whole-a', 80)).toBe('ok')
    expect(budget.attachContent('b', 'whole-b', 30)).toBe('bytes')
    expect(budget.snapshot().panelBytes).toBe(80)
    budget.release('a')
    expect(budget.attachContent('b', 'whole-b', 30)).toBe('ok')
    budget.finishRead('b')
    expect(budget.snapshot()).toMatchObject({ inFlight: 0, panelBytes: 30 })
  })

  it('读取并发拒绝时回滚新实例槽，保留原有已挂载实例', () => {
    const budget = new RefExpansionBudget({ concurrentReads: 1 })
    expect(budget.admitRead('tree', 'in-flight', 1)).toBe('ok')
    expect(budget.admitRead('tree', 'rejected', 2)).toBe('concurrency')
    expect(budget.snapshot()).toMatchObject({ panelInstances: 1, inFlight: 1 })
    budget.finishRead('in-flight')
    expect(budget.admitRead('tree', 'rejected', 2)).toBe('ok')
    budget.finishRead('rejected')
    expect(budget.attachContent('rejected', 'held', 10)).toBe('ok')
    expect(budget.admitRead('tree', 'in-flight', 1)).toBe('ok')
    expect(budget.admitRead('tree', 'rejected', 2)).toBe('concurrency')
    expect(budget.snapshot()).toMatchObject({ panelInstances: 2, panelBytes: 10, inFlight: 1 })
  })

  it('同 occurrence 的每笔请求分别占并发槽，旧回包与释放只结算对应 token', () => {
    const budget = new RefExpansionBudget({ concurrentReads: 8 })
    expect(budget.reserve('tree', 'same', 1)).toBe('ok')
    for (let i = 0; i < 8; i++) expect(budget.beginRead('same', `request-${i}`)).toBe('ok')
    for (let i = 8; i < 12; i++) expect(budget.beginRead('same', `request-${i}`)).toBe('concurrency')
    expect(budget.snapshot().inFlight).toBe(8)
    budget.finishRead('same', 'request-0')
    expect(budget.snapshot().inFlight).toBe(7)
    expect(budget.beginRead('same', 'request-8')).toBe('ok')
    budget.finishRead('same', 'request-0')
    expect(budget.snapshot().inFlight).toBe(8)
    budget.release('same')
    expect(budget.snapshot()).toMatchObject({ panelInstances: 0, inFlight: 8 })
    expect(budget.reserve('tree', 'same', 1)).toBe('ok')
    expect(budget.beginRead('same', 'new-request')).toBe('concurrency')
    for (let i = 1; i <= 8; i++) budget.finishRead('same', `request-${i}`)
    expect(budget.beginRead('same', 'new-request')).toBe('ok')
    budget.finishRead('same', 'new-request')
    expect(budget.snapshot().inFlight).toBe(0)
  })
})
