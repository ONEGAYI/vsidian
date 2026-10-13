// #474 行为管理积木式筛选——共享层契约测试：查询树形状守卫、求值语义、
// 块数上限、行状态合成与列表分页。事实源 src/shared/behaviorFilterQuery.ts。
//
// 契约口径（规格 docs/specs/behavior-manage-pagination.md 设计树 D4–D9/D11）：
// - 三族积木：字段（圆角矩形内嵌文本）、逻辑（AND/OR 双缺口、NOT 单缺口，
//   缺口 = null 槽，可嵌任意积木）、状态（四态下拉，与行徽章一一对应）。
// - 匹配语义（D5）：大小写不敏感子串；行为显示名按「当前语言解析名」匹配
//   （调用方现算注入，切语言后查询含义随之变化）；组件显示名/行为ID（局部）/
//   组件ID 各对齐行上对应字段。
// - 求值（D7）：顶层并列积木隐式 AND；空文本字段积木恒真（占位待填）；
//   **含空槽（null 槽）的逻辑积木整体恒真**——半构造不参与过滤，与空文本
//   同精神（规格未钉空槽语义，实施期按「占位待填」推广补全，此处钉住）；
//   无积木 = 全集；命中只过滤不排序（序由调用方展示全序保持）。
// - 上限（D9）：积木总数（全部节点，空槽不计）≤ 16；超限序列化整条拒绝
//   （构造器侧另有加号禁用，持久层防御在此）。
// - 行状态四态（D6）与分节行徽章同源合成：用户关闭 > 组件停用 > 故障暂停
//   > 启用（优先序对齐 addonBehaviorManageSection 徽章三分支现状）。
// - 分页（D1/D11）：20 行/页；页码越界（含恢复时注册集变化）静默回落第 1 页。
import { describe, expect, it } from 'vitest'
import {
  BEHAVIOR_LIST_PAGE_SIZE,
  BEHAVIOR_QUERY_BLOCKS_LIMIT,
  countBehaviorQueryBlocks,
  evaluateBehaviorQuery,
  evaluateBehaviorQueryBlock,
  paginateBehaviorList,
  parseBehaviorQueryFilter,
  resolveBehaviorRowStatus,
  type BehaviorQueryBlock,
  type BehaviorQueryRowContext,
} from '../../src/shared/behaviorFilterQuery'

function rowContext(overrides: Partial<BehaviorQueryRowContext> = {}): BehaviorQueryRowContext {
  return {
    behaviorName: '括号补全',
    addonName: '示例组件',
    behaviorId: 'bracket-close',
    addonId: 'onegayi.demo',
    status: 'enabled',
    ...overrides,
  }
}

describe('#474 行状态四态合成（与行徽章同源）', () => {
  it('全无覆盖 → 启用', () => {
    expect(resolveBehaviorRowStatus(false, true, undefined)).toBe('enabled')
  })

  it('用户单项关闭最优先（组件同时停用/故障仍报已关闭）', () => {
    expect(resolveBehaviorRowStatus(true, false, { reason: 'boom' })).toBe('disabled')
  })

  it('组件停用次优先（含故障）', () => {
    expect(resolveBehaviorRowStatus(false, false, { reason: 'boom' })).toBe('addonDisabled')
  })

  it('故障暂停再次（组件启用态下）', () => {
    expect(resolveBehaviorRowStatus(false, true, { reason: 'crashed' })).toBe('errorPaused')
  })

  it('组件条目缺失（enabled/fault 均未知）不算停用也不算故障', () => {
    expect(resolveBehaviorRowStatus(false, undefined, undefined)).toBe('enabled')
  })
})

describe('#474 字段积木求值（大小写不敏感子串，D5）', () => {
  it('行为显示名子串命中；大小写不敏感', () => {
    const ctx = rowContext({ behaviorName: 'Bracket Close' })
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorName', text: 'acket' }, ctx)).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorName', text: 'BRACKET' }, ctx)).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorName', text: 'open' }, ctx)).toBe(false)
  })

  it('空文本与纯空白文本恒真（占位待填，D7）', () => {
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorName', text: '' }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'addonName', text: '   ' }, rowContext())).toBe(true)
  })

  it('输入文本 trim 后参与匹配（目标值原样）', () => {
    const ctx = rowContext({ behaviorName: 'foo bar' })
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorName', text: ' foo ' }, ctx)).toBe(true)
  })

  it('组件显示名 / 行为局部 ID / 组件 ID 三字段各对齐行上字段', () => {
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'addonName', text: '组件' }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorId', text: 'bracket' }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'addonId', text: 'demo' }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'field', field: 'behaviorId', text: 'onegayi' }, rowContext())).toBe(false)
  })
})

describe('#474 逻辑积木求值（D7）', () => {
  const yes: BehaviorQueryBlock = { kind: 'status', status: 'enabled' }
  const no: BehaviorQueryBlock = { kind: 'status', status: 'disabled' }

  it('AND 全真才真；任一假即假', () => {
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'and', children: [yes, yes] }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'and', children: [yes, no] }, rowContext())).toBe(false)
  })

  it('OR 任一真即真；全假才假', () => {
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'or', children: [no, yes] }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'or', children: [no, no] }, rowContext())).toBe(false)
  })

  it('NOT 取反唯一子块', () => {
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'not', children: [no] }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'not', children: [yes] }, rowContext())).toBe(false)
  })

  it('含空槽的逻辑积木整体恒真（半构造不参与过滤——空槽语义实施期钉住）', () => {
    // AND{假块, 空槽} = true：半构造期间不过滤，用户填完才生效
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'and', children: [no, null] }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'or', children: [no, null] }, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock({ kind: 'logic', op: 'not', children: [null] }, rowContext())).toBe(true)
  })

  it('嵌套任意深度：AND(OR, NOT) 组合', () => {
    const tree: BehaviorQueryBlock = {
      kind: 'logic', op: 'and',
      children: [
        { kind: 'logic', op: 'or', children: [
          { kind: 'field', field: 'behaviorName', text: '不存在' },
          { kind: 'field', field: 'addonName', text: '组件' },
        ] },
        { kind: 'logic', op: 'not', children: [
          { kind: 'status', status: 'disabled' },
        ] },
      ],
    }
    expect(evaluateBehaviorQueryBlock(tree, rowContext())).toBe(true)
    expect(evaluateBehaviorQueryBlock(tree, rowContext({ status: 'disabled' }))).toBe(false)
  })
})

describe('#474 状态积木求值（D6：四态与行徽章一一对应）', () => {
  for (const status of ['enabled', 'disabled', 'addonDisabled', 'errorPaused'] as const) {
    it(`状态 ${status} 等值命中`, () => {
      expect(evaluateBehaviorQueryBlock({ kind: 'status', status }, rowContext({ status }))).toBe(true)
      expect(evaluateBehaviorQueryBlock({ kind: 'status', status }, rowContext({ status: 'enabled' })))
        .toBe(status === 'enabled')
    })
  }
})

describe('#474 整树求值（顶层隐式 AND，D7）', () => {
  it('null 与空 blocks 恒真（无积木 = 全集）', () => {
    expect(evaluateBehaviorQuery(null, rowContext())).toBe(true)
    expect(evaluateBehaviorQuery({ version: 1, blocks: [] }, rowContext())).toBe(true)
  })

  it('顶层并列隐式 AND', () => {
    const filter = {
      version: 1 as const,
      blocks: [
        { kind: 'field' as const, field: 'behaviorName' as const, text: '括号' },
        { kind: 'status' as const, status: 'enabled' as const },
      ],
    }
    expect(evaluateBehaviorQuery(filter, rowContext())).toBe(true)
    expect(evaluateBehaviorQuery(filter, rowContext({ status: 'disabled' }))).toBe(false)
  })

  it('完整组合场景：((行为名含 x) OR (组件名含 y)) AND NOT(已关闭)', () => {
    const filter = {
      version: 1 as const,
      blocks: [{
        kind: 'logic' as const, op: 'and' as const,
        children: [
          { kind: 'logic' as const, op: 'or' as const, children: [
            { kind: 'field' as const, field: 'behaviorName' as const, text: 'X' },
            { kind: 'field' as const, field: 'addonName' as const, text: 'Y' },
          ] },
          { kind: 'logic' as const, op: 'not' as const, children: [
            { kind: 'status' as const, status: 'disabled' as const },
          ] },
        ],
      }],
    }
    expect(evaluateBehaviorQuery(filter, rowContext({ behaviorName: 'xx', addonName: 'zz' }))).toBe(true)
    expect(evaluateBehaviorQuery(filter, rowContext({ behaviorName: 'zz', addonName: 'yy' }))).toBe(true)
    expect(evaluateBehaviorQuery(filter, rowContext({ behaviorName: 'zz', addonName: 'zz' }))).toBe(false)
    expect(evaluateBehaviorQuery(filter, rowContext({ behaviorName: 'xx', status: 'disabled' }))).toBe(false)
  })
})

describe('#474 积木总数上限（D9：≤16）', () => {
  it('计数含全部嵌套节点；空槽不计', () => {
    const filter = {
      version: 1 as const,
      blocks: [
        { kind: 'field' as const, field: 'behaviorName' as const, text: 'a' },
        { kind: 'logic' as const, op: 'and' as const, children: [
          { kind: 'status' as const, status: 'enabled' as const },
          null,
        ] },
      ],
    }
    expect(countBehaviorQueryBlocks(filter)).toBe(3)
  })

  it('恰 16 块序列化合法；17 块整条拒绝', () => {
    const blocksOf = (n: number) => Array.from({ length: n }, () =>
      ({ kind: 'status', status: 'enabled' }) as BehaviorQueryBlock)
    expect(parseBehaviorQueryFilter({ version: 1, blocks: blocksOf(16) })).not.toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: blocksOf(17) })).toBeNull()
    expect(BEHAVIOR_QUERY_BLOCKS_LIMIT).toBe(16)
  })
})

describe('#474 查询树序列化守卫（fail-safe：坏形态整条回 null）', () => {
  it('合法完整形态解析成功（值透传）', () => {
    const raw = {
      version: 1,
      blocks: [
        { kind: 'field', field: 'behaviorName', text: '括号' },
        { kind: 'logic', op: 'not', children: [{ kind: 'status', status: 'errorPaused' }] },
        { kind: 'logic', op: 'or', children: [null, { kind: 'field', field: 'addonId', text: 'demo' }] },
      ],
    }
    expect(parseBehaviorQueryFilter(raw)).toEqual(raw)
  })

  it('空槽跨持久化往返保留（半构造状态可恢复）', () => {
    const raw = { version: 1, blocks: [{ kind: 'logic', op: 'and', children: [null, null] }] }
    expect(parseBehaviorQueryFilter(raw)).toEqual(raw)
  })

  it('非对象 / version 不符 / blocks 非数组拒绝', () => {
    expect(parseBehaviorQueryFilter(null)).toBeNull()
    expect(parseBehaviorQueryFilter(undefined)).toBeNull()
    expect(parseBehaviorQueryFilter('x')).toBeNull()
    expect(parseBehaviorQueryFilter([])).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 2, blocks: [] })).toBeNull()
    expect(parseBehaviorQueryFilter({ blocks: [] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: {} })).toBeNull()
  })

  it('块形态非法拒绝：kind 未知 / 字段族未知 / 状态族未知 / 算子未知', () => {
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'text', text: 'x' }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'field', field: 'nickname', text: 'x' }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'status', status: 'paused' }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'logic', op: 'xor', children: [null, null] }] })).toBeNull()
  })

  it('字段积木：text 非字符串或超长拒绝（防滥用上限）', () => {
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'field', field: 'behaviorName', text: 42 }] })).toBeNull()
    expect(parseBehaviorQueryFilter({
      version: 1, blocks: [{ kind: 'field', field: 'behaviorName', text: 'x'.repeat(257) }],
    })).toBeNull()
  })

  it('逻辑积木：children 非数组 / 槽数不符（AND/OR 两槽、NOT 一槽）拒绝', () => {
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'logic', op: 'and', children: 'x' }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'logic', op: 'and', children: [null] }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'logic', op: 'or', children: [null, null, null] }] })).toBeNull()
    expect(parseBehaviorQueryFilter({ version: 1, blocks: [{ kind: 'logic', op: 'not', children: [null, null] }] })).toBeNull()
  })

  it('嵌套非法传播整条拒绝', () => {
    expect(parseBehaviorQueryFilter({
      version: 1,
      blocks: [{ kind: 'logic', op: 'and', children: [{ kind: 'field', field: 'bad', text: '' }, null] }],
    })).toBeNull()
  })
})

describe('#474 行为列表分页（D1：20 行/页；D11：越界静默回落第 1 页）', () => {
  it('页容量固定 20；空表 0 页但页码回落 1', () => {
    expect(BEHAVIOR_LIST_PAGE_SIZE).toBe(20)
    const empty = paginateBehaviorList([], 1)
    expect(empty.pageCount).toBe(0)
    expect(empty.page).toBe(1)
    expect(empty.pageItems).toEqual([])
  })

  it('不満一页单页呈现；跨页切片正确', () => {
    const items = Array.from({ length: 45 }, (_, i) => `k${i}`)
    expect(paginateBehaviorList(items.slice(0, 20), 1).pageCount).toBe(1)
    expect(paginateBehaviorList(items, 1).pageItems).toEqual(items.slice(0, 20))
    expect(paginateBehaviorList(items, 2).pageItems).toEqual(items.slice(20, 40))
    expect(paginateBehaviorList(items, 3).pageItems).toEqual(items.slice(40, 45))
    expect(paginateBehaviorList(items, 3).pageCount).toBe(3)
  })

  it('页码越界（0 / 负 / 非整数 / 超总页数）回落第 1 页', () => {
    const items = Array.from({ length: 25 }, (_, i) => `k${i}`)
    for (const bad of [0, -1, 2.5, Number.NaN, 99]) {
      const result = paginateBehaviorList(items, bad)
      expect(result.page).toBe(1)
      expect(result.pageItems).toEqual(items.slice(0, 20))
    }
  })

  it('命中集合保持输入序（分页只切片不排序——全序由调用方保持）', () => {
    const items = ['b#2', 'a#1', 'c#3']
    expect(paginateBehaviorList(items, 1).pageItems).toEqual(items)
  })
})
