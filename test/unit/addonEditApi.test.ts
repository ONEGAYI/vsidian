// T06（#355）统一视图编辑 API 共享形状与守卫的契约测试——接口冻结面：
// 句柄信息、快照修订标记、提交请求形状、可辨认拒绝类型枚举，以及
// editOrigin 数组形态（合并提交）的解析与归一化约束。
import { describe, expect, it } from 'vitest'
import {
  isAddonApplyEditsRequest,
  isAddonSelectionRange,
  isAddonViewInfo,
  type AddonViewInfo,
} from '../../src/shared/addonEditApi'
import {
  isEditOriginMeta,
  isValidMergedOriginList,
  parseEditOriginField,
  type EditOriginMeta,
} from '../../src/shared/editOrigin'

const origin = (undo: EditOriginMeta['undo'], opId = 'op-1', addonId = 'pub.addon'): EditOriginMeta =>
  ({ addonId, opId, undo })

describe('addonEditApi 形状守卫', () => {
  it('接受合法视图信息（三种视图类型与两种模式）', () => {
    const infos: AddonViewInfo[] = [
      { instanceId: 'main', targetDocUri: 'file:///a.md', mode: 'live', viewType: 'main', editable: true },
      { instanceId: 'main', targetDocUri: 'file:///a.md', mode: 'reading', viewType: 'main', editable: false },
      { instanceId: 'embed:occ-1', targetDocUri: 'file:///b.md', mode: 'live', viewType: 'embed', editable: true },
      { instanceId: 'hover:occ-2', targetDocUri: 'file:///c.md', mode: 'reading', viewType: 'hover', editable: false },
    ]
    for (const info of infos) {
      expect(isAddonViewInfo(info)).toBe(true)
    }
  })

  it('拒绝空实例 ID、空目标与未知枚举', () => {
    expect(isAddonViewInfo({ instanceId: '', targetDocUri: 'file:///a.md', mode: 'live', viewType: 'main', editable: true })).toBe(false)
    expect(isAddonViewInfo({ instanceId: 'main', targetDocUri: '', mode: 'live', viewType: 'main', editable: true })).toBe(false)
    expect(isAddonViewInfo({ instanceId: 'main', targetDocUri: 'file:///a.md', mode: 'source', viewType: 'main', editable: true })).toBe(false)
    expect(isAddonViewInfo({ instanceId: 'main', targetDocUri: 'file:///a.md', mode: 'live', viewType: 'sidebar', editable: true })).toBe(false)
    expect(isAddonViewInfo({ instanceId: 'main', targetDocUri: 'file:///a.md', mode: 'live', viewType: 'main', editable: 'yes' })).toBe(false)
  })

  it('选区范围要求非负整数 anchor/head', () => {
    expect(isAddonSelectionRange({ anchor: 0, head: 3 })).toBe(true)
    expect(isAddonSelectionRange({ anchor: -1, head: 3 })).toBe(false)
    expect(isAddonSelectionRange({ anchor: 1.5, head: 3 })).toBe(false)
    expect(isAddonSelectionRange({ anchor: 0 })).toBe(false)
  })

  it('提交请求守卫：revision 非负整数 + changes 逐段合法 + 枚举 history', () => {
    expect(isAddonApplyEditsRequest({ revision: 0, changes: [{ offset: 0, length: 0, text: 'x' }] })).toBe(true)
    expect(isAddonApplyEditsRequest({ revision: 3, changes: [], history: 'joinPrevious' })).toBe(true)
    expect(isAddonApplyEditsRequest({ revision: 3, changes: [], history: 'atomic', selection: { anchor: 1, head: 2 } })).toBe(true)
    // revision 非法
    expect(isAddonApplyEditsRequest({ revision: -1, changes: [] })).toBe(false)
    expect(isAddonApplyEditsRequest({ revision: 1.5, changes: [] })).toBe(false)
    expect(isAddonApplyEditsRequest({ changes: [] })).toBe(false)
    // changes 非法
    expect(isAddonApplyEditsRequest({ revision: 0, changes: [{ offset: -1, length: 0, text: '' }] })).toBe(false)
    expect(isAddonApplyEditsRequest({ revision: 0, changes: 'all' })).toBe(false)
    // selection / history 非法
    expect(isAddonApplyEditsRequest({ revision: 0, changes: [], selection: { anchor: -1, head: 0 } })).toBe(false)
    expect(isAddonApplyEditsRequest({ revision: 0, changes: [], history: 'mergeUp' })).toBe(false)
    expect(isAddonApplyEditsRequest(null)).toBe(false)
  })
})

describe('editOrigin 数组形态（T06 合并提交）', () => {
  it('isEditOriginMeta 基础形状不变（T03 契约）', () => {
    expect(isEditOriginMeta(origin('atomic'))).toBe(true)
    expect(isEditOriginMeta(origin('joinPrevious'))).toBe(true)
    expect(isEditOriginMeta({ addonId: '', opId: 'x', undo: 'atomic' })).toBe(false)
    expect(isEditOriginMeta({ addonId: 'a b', opId: 'x', undo: 'atomic' })).toBe(false)
    expect(isEditOriginMeta({ addonId: 'a', opId: 'x', undo: 'both' })).toBe(false)
    expect(isEditOriginMeta([origin('atomic')])).toBe(false)
  })

  it('parseEditOriginField：缺省 / 单值 / 数组 / 非法四分支', () => {
    expect(parseEditOriginField(undefined)).toEqual({ status: 'absent' })
    expect(parseEditOriginField(origin('atomic'))).toEqual({ status: 'ok', origins: [origin('atomic')] })
    const merged = [origin('atomic', 'op-a'), origin('joinPrevious', 'op-b')]
    expect(parseEditOriginField(merged)).toEqual({ status: 'ok', origins: merged })
    // 空数组 / 混杂 / 部分非法都是 invalid
    expect(parseEditOriginField([])).toEqual({ status: 'invalid' })
    expect(parseEditOriginField([origin('atomic'), { addonId: 'x', opId: 1, undo: 'joinPrevious' }])).toEqual({ status: 'invalid' })
    expect(parseEditOriginField('atomic')).toEqual({ status: 'invalid' })
    expect(parseEditOriginField({ undo: 'atomic' })).toEqual({ status: 'invalid' })
  })

  it('合并列表约束：首项 atomic、其余 joinPrevious、同组件', () => {
    expect(isValidMergedOriginList([origin('atomic', 'a'), origin('joinPrevious', 'b')])).toBe(true)
    expect(isValidMergedOriginList([origin('atomic', 'a'), origin('joinPrevious', 'b'), origin('joinPrevious', 'c')])).toBe(true)
    // 首项非 atomic：不是合法合并笔（组首必须建立独立撤销项）
    expect(isValidMergedOriginList([origin('joinPrevious', 'a'), origin('joinPrevious', 'b')])).toBe(false)
    // 追加项非 joinPrevious：两个 atomic 不得合成一笔（各自独立撤回单位）
    expect(isValidMergedOriginList([origin('atomic', 'a'), origin('atomic', 'b')])).toBe(false)
    // 跨组件合并：来源不可冒充，拒绝
    expect(isValidMergedOriginList([origin('atomic', 'a', 'pub.one'), origin('joinPrevious', 'b', 'pub.two')])).toBe(false)
    // 长度约束
    expect(isValidMergedOriginList([origin('atomic', 'a')])).toBe(false)
    expect(isValidMergedOriginList([])).toBe(false)
  })
})
