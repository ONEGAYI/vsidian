// T07（#356）行为顺序与逐项开关——宿主侧持久化服务契约测试。
// 事实源 src/host/addons/addonBehaviorStateService.ts。
//
// 契约口径（票面 + 技术方案 §7）：
// - 构造从持久层装配；坏形态 fail-safe 回空不写回。
// - 逐项开关：关闭/开启/批量写；关闭记录跨写保留（未提及项不动）。
// - 排序读写：整表写（管理 UI 的排序结果落库）。
// - 未知项（未注册/已卸载的行为键）保留存储不剔除。
// - 写序串行化（读改写不交错）；落盘失败不虚报成功、内存回滚、不发事件。
// - 变化事件只在持久化成功后发出。
import { describe, expect, it } from 'vitest'
import { AddonBehaviorStateService, type AddonBehaviorStatePersistencePort } from '../../src/host/addons/addonBehaviorStateService'

function createPort(initial: unknown = undefined): AddonBehaviorStatePersistencePort & {
  stored: unknown
  failNext: () => void
  writes: number
} {
  const port = {
    stored: initial,
    writes: 0,
    failNextFlag: false,
    read() {
      return port.stored
    },
    async write(value: unknown) {
      if (port.failNextFlag) {
        port.failNextFlag = false
        return false
      }
      port.stored = value
      port.writes += 1
      return true
    },
    failNext() {
      port.failNextFlag = true
    },
  }
  return port
}

describe('T07 行为状态服务：装配与读取', () => {
  it('无持久值：空快照（order/disabled 为空）', () => {
    const service = new AddonBehaviorStateService(createPort())
    expect(service.snapshot()).toEqual({ order: [], disabled: [] })
  })

  it('合法持久值装配；坏形态 fail-safe 回空不写回', () => {
    const okPort = createPort({ version: 1, order: ['a#x'], disabled: ['a#y'] })
    expect(new AddonBehaviorStateService(okPort).snapshot()).toEqual({ order: ['a#x'], disabled: ['a#y'] })
    expect(okPort.writes).toBe(0)
    const badPort = createPort({ version: 2, order: [], disabled: [] })
    expect(new AddonBehaviorStateService(badPort).snapshot()).toEqual({ order: [], disabled: [] })
    expect(badPort.writes).toBe(0)
  })
})

describe('T07 行为状态服务：逐项开关', () => {
  it('关闭单项：持久值含该键；再开启：从关闭集移除', async () => {
    const service = new AddonBehaviorStateService(createPort())
    await service.setDisabled(['pub.a#space'], true)
    expect(service.snapshot().disabled).toEqual(['pub.a#space'])
    await service.setDisabled(['pub.a#bracket'], true)
    expect(service.snapshot().disabled).toEqual(['pub.a#space', 'pub.a#bracket'])
    await service.setDisabled(['pub.a#space'], false)
    expect(service.snapshot().disabled).toEqual(['pub.a#bracket'])
  })

  it('批量写只动提及项（未提及项保留）', async () => {
    const service = new AddonBehaviorStateService(createPort({ version: 1, order: [], disabled: ['a#1', 'a#2'] }))
    await service.setDisabled(['a#3'], true)
    expect(service.snapshot().disabled).toEqual(['a#1', 'a#2', 'a#3'])
  })

  it('幂等：重复关闭同项不产生第二条记录', async () => {
    const service = new AddonBehaviorStateService(createPort())
    await service.setDisabled(['a#1'], true)
    await service.setDisabled(['a#1'], true)
    expect(service.snapshot().disabled).toEqual(['a#1'])
  })
})

describe('T07 行为状态服务：排序读写', () => {
  it('整表写序（管理 UI 排序结果落库）；重复键去重', async () => {
    const service = new AddonBehaviorStateService(createPort())
    await service.setOrder(['pub.b#x', 'pub.a#y', 'pub.b#x'])
    expect(service.snapshot().order).toEqual(['pub.b#x', 'pub.a#y'])
  })

  it('排序写入不影响关闭集（两个维度独立）', async () => {
    const service = new AddonBehaviorStateService(createPort())
    await service.setDisabled(['a#1'], true)
    await service.setOrder(['b#2', 'a#1'])
    expect(service.snapshot()).toEqual({ order: ['b#2', 'a#1'], disabled: ['a#1'] })
  })
})

describe('T07 行为状态服务：持久化与事件边界', () => {
  it('落盘失败不虚报成功：内存回滚、事件不发', async () => {
    const port = createPort()
    const service = new AddonBehaviorStateService(port)
    const events: string[] = []
    service.onChanged(() => events.push('changed'))
    port.failNext()
    const result = await service.setDisabled(['a#1'], true)
    expect(result).toEqual({ ok: false, reason: 'store-write-failed' })
    expect(service.snapshot().disabled).toEqual([])
    expect(events).toEqual([])
  })

  it('变化事件只在持久化成功后发出（成功路径）', async () => {
    const service = new AddonBehaviorStateService(createPort())
    const events: string[] = []
    service.onChanged(() => events.push('changed'))
    await service.setDisabled(['a#1'], true)
    await service.setOrder(['a#1'])
    expect(events).toEqual(['changed', 'changed'])
  })

  it('写序串行化：并发读改写不丢键', async () => {
    const service = new AddonBehaviorStateService(createPort())
    await Promise.all([
      service.setDisabled(['a#1'], true),
      service.setDisabled(['a#2'], true),
      service.setDisabled(['a#3'], true),
    ])
    expect([...service.snapshot().disabled].sort()).toEqual(['a#1', 'a#2', 'a#3'])
  })

  it('refreshFromPersistence 重新装配（跨窗口对账入口）', async () => {
    const port = createPort()
    const service = new AddonBehaviorStateService(port)
    await service.setDisabled(['a#1'], true)
    // 模拟另一窗口写入
    port.stored = { version: 1, order: [], disabled: ['a#2'] }
    service.refreshFromPersistence()
    expect(service.snapshot().disabled).toEqual(['a#2'])
  })
})
