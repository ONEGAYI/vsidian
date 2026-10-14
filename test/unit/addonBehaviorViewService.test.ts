// #474 行为管理视图状态服务（AddonBehaviorViewService）——契约测试：构造
// 解析（fail-safe）、整表写、写失败静默与内存保持、持久层对账。事实源
// src/host/addons/addonBehaviorViewService.ts。
//
// 契约口径（docs/specs/behavior-manage-pagination.md D11）：
// - 存储形态 { version: 1, page, query }；page 正整数；query 为可解析查询树
//   或 null（无查询 = 全集）；坏形态整条回 null（无存储默认态）。
// - webview 自持权威：宿主只存储不推送；写失败静默返回 false（视图偏好
//   丢失非灾难，不涉行为生效语义）且内存不更新。
// - 读改写经 promise 链串行化；跨窗口不做实时对账（refreshFromPersistence
//   显式入口，最后落盘胜出）。
import { describe, expect, it } from 'vitest'
import {
  AddonBehaviorViewService,
  parseAddonBehaviorViewStore,
  type AddonBehaviorViewPersistencePort,
} from '../../src/host/addons/addonBehaviorViewService'

function makePort(initial: unknown = undefined, writeOk = true): {
  port: AddonBehaviorViewPersistencePort
  written: unknown[]
} {
  const written: unknown[] = []
  return {
    written,
    port: {
      read: () => initial,
      write: async (value) => {
        written.push(value)
        return writeOk
      },
    },
  }
}

const QUERY = { version: 1 as const, blocks: [{ kind: 'status' as const, status: 'enabled' as const }] }

describe('#474 视图状态存储解析（fail-safe）', () => {
  it('无存储（undefined/null）与非对象回 null；合法形态解析成功', () => {
    expect(parseAddonBehaviorViewStore(undefined)).toBeNull()
    expect(parseAddonBehaviorViewStore(null)).toBeNull()
    expect(parseAddonBehaviorViewStore('x')).toBeNull()
    expect(parseAddonBehaviorViewStore([])).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 2, page: 1, query: null })).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 1, query: null })).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 1, page: 0, query: null })).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 1, page: 1.5, query: null })).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 1, page: 1, query: { version: 9, blocks: [] } })).toBeNull()
    expect(parseAddonBehaviorViewStore({ version: 1, page: 3, query: QUERY })).toEqual({ version: 1, page: 3, query: QUERY })
    expect(parseAddonBehaviorViewStore({ version: 1, page: 3, query: null })).toEqual({ version: 1, page: 3, query: null })
  })
})

describe('#474 视图状态服务', () => {
  it('无存储构造 → snapshot null（无持久默认态，webview 据此区分）', () => {
    const { port } = makePort(undefined)
    expect(new AddonBehaviorViewService(port).snapshot()).toBeNull()
  })

  it('setView 整表写落盘成功后 snapshot 更新（null query = 无查询）', async () => {
    const { port, written } = makePort(undefined)
    const service = new AddonBehaviorViewService(port)
    await service.setView(2, QUERY)
    expect(written).toEqual([{ version: 1, page: 2, query: QUERY }])
    expect(service.snapshot()).toEqual({ page: 2, query: QUERY })
    await service.setView(1, null)
    expect(service.snapshot()).toEqual({ page: 1, query: null })
  })

  it('写失败静默返回 false 且内存不更新（视图偏好丢失非灾难）', async () => {
    const { port } = makePort(undefined, false)
    const service = new AddonBehaviorViewService(port)
    const ok = await service.setView(5, QUERY)
    expect(ok).toBe(false)
    expect(service.snapshot()).toBeNull()
  })

  it('refreshFromPersistence 从持久层重新装配（坏形态回默认 null）', () => {
    const good = makePort({ version: 1, page: 4, query: null })
    const service = new AddonBehaviorViewService(good.port)
    expect(service.snapshot()).toEqual({ page: 4, query: null })
    const bad = makePort({ version: 1, page: -3, query: null })
    const service2 = new AddonBehaviorViewService(bad.port)
    service2.refreshFromPersistence()
    expect(service2.snapshot()).toBeNull()
  })

  it('操作串行化：并发写不交错（按入队顺序落盘）', async () => {
    const { port, written } = makePort(undefined)
    const service = new AddonBehaviorViewService(port)
    await Promise.all([service.setView(1, null), service.setView(2, QUERY), service.setView(3, null)])
    expect(written.map((value) => (value as { page: number }).page)).toEqual([1, 2, 3])
    expect(service.snapshot()).toEqual({ page: 3, query: null })
  })

  it('写异常不断链（后续操作仍可执行）', async () => {
    const written: unknown[] = []
    let fail = true
    const port: AddonBehaviorViewPersistencePort = {
      read: () => undefined,
      write: async (value) => {
        if (fail) {
          throw new Error('boom')
        }
        written.push(value)
        return true
      },
    }
    const service = new AddonBehaviorViewService(port)
    await expect(service.setView(1, null)).rejects.toThrow('boom')
    fail = false
    await expect(service.setView(2, null)).resolves.toBe(true)
    expect(written).toHaveLength(1)
  })
})
