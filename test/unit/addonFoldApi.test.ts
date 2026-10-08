// #410 附加组件标题折叠 API——纯守卫契约测试（shared 形状单一事实源）。
// 行为链路（查询/命令经 SDK → 装载器 → 注册表 → Live 实例）由
// addonHeadingFoldApi.test.ts 钉住；此处只测请求形状守卫矩阵。
import { describe, expect, it } from 'vitest'
import { isAddonHeadingFoldApplyOptions } from '../../src/shared/addonFoldApi'

describe('isAddonHeadingFoldApplyOptions（apply 可选参数守卫）', () => {
  it('合法形态：缺省对象、{ upToLevel } 1–6 整数', () => {
    expect(isAddonHeadingFoldApplyOptions({})).toBe(true)
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: 1 })).toBe(true)
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: 6 })).toBe(true)
  })

  it('非法形态：upToLevel 越界（0/7）、非整数、非数值、数组与原始值', () => {
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: 0 })).toBe(false)
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: 7 })).toBe(false)
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: 2.5 })).toBe(false)
    expect(isAddonHeadingFoldApplyOptions({ upToLevel: '2' })).toBe(false)
    expect(isAddonHeadingFoldApplyOptions(null)).toBe(false)
    expect(isAddonHeadingFoldApplyOptions(undefined)).toBe(false)
    expect(isAddonHeadingFoldApplyOptions([1])).toBe(false)
  })
})
