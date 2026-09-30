// 查找选项单一事实源契约（#236）：
// - 三开关（matchCase/wholeWord/regexp）状态模块化承载——查找面板与
//   「选下一处相同词」（#238）同源消费，接口即本测试锁定的导出面
// - 默认值对齐 VSCode：三开关全关（大小写不敏感、非全字、字面量）
// - sanitize：部分字段缺省回默认、非法类型丢弃回默认、非对象回默认
// - 宿主持久化（workspaceState，工作区级记忆）：无存储回默认、保存后
//   读取回放、损坏存储回默认（键常量公开供接线与测试观测）
// - 协议校验：findOptions.get/set 与 findOptions.snapshot 消息形态
import { describe, it, expect } from 'vitest'
import {
  FIND_OPTIONS_DEFAULT,
  FIND_OPTIONS_STORAGE_KEY,
  findOptionsEqual,
  sanitizeFindOptions,
  type FindOptions,
} from '../../src/shared/findOptions'
import { createFindOptionsStore } from '../../src/host/findOptionsStore'
import {
  isHostToWebview,
  isWebviewToHost,
  type WebviewToHost,
  type HostToWebview,
} from '../../src/shared/protocol'

describe('findOptions 纯函数', () => {
  it('默认值：三开关全关（对齐 VSCode 默认档）', () => {
    expect(FIND_OPTIONS_DEFAULT).toEqual({ matchCase: false, wholeWord: false, regexp: false })
  })

  it('sanitize：合法对象原样通过', () => {
    const options: FindOptions = { matchCase: true, wholeWord: true, regexp: false }
    expect(sanitizeFindOptions(options)).toEqual(options)
  })

  it('sanitize：缺省字段回默认、非布尔字段回默认', () => {
    expect(sanitizeFindOptions({})).toEqual(FIND_OPTIONS_DEFAULT)
    expect(sanitizeFindOptions({ matchCase: 1, wholeWord: 'yes', regexp: null }))
      .toEqual(FIND_OPTIONS_DEFAULT)
    expect(sanitizeFindOptions({ matchCase: true })).toEqual({ matchCase: true, wholeWord: false, regexp: false })
  })

  it('sanitize：非对象（null/数组/字符串）回默认', () => {
    expect(sanitizeFindOptions(null)).toEqual(FIND_OPTIONS_DEFAULT)
    expect(sanitizeFindOptions([])).toEqual(FIND_OPTIONS_DEFAULT)
    expect(sanitizeFindOptions('matchCase')).toEqual(FIND_OPTIONS_DEFAULT)
  })

  it('findOptionsEqual：字段逐项比较', () => {
    expect(findOptionsEqual(FIND_OPTIONS_DEFAULT, { matchCase: false, wholeWord: false, regexp: false })).toBe(true)
    expect(findOptionsEqual(FIND_OPTIONS_DEFAULT, { matchCase: true, wholeWord: false, regexp: false })).toBe(false)
  })
})

describe('findOptions 宿主持久化（workspaceState 工作区级记忆）', () => {
  function memoryStore(initial?: Record<string, unknown>) {
    const data = new Map<string, unknown>(initial ? Object.entries(initial) : [])
    return {
      get<T>(key: string): T | undefined {
        return data.get(key) as T | undefined
      },
      update(key: string, value: unknown) {
        data.set(key, value)
        return Promise.resolve()
      },
      raw: () => data,
    }
  }

  it('无存储回默认；保存后读取回放；损坏存储回默认', async () => {
    const fresh = createFindOptionsStore(memoryStore())
    expect(fresh.load()).toBeNull()
    expect(fresh.initial()).toEqual(FIND_OPTIONS_DEFAULT)

    const stored = createFindOptionsStore(memoryStore())
    await stored.save({ matchCase: true, wholeWord: false, regexp: true })
    expect(stored.load()).toEqual({ matchCase: true, wholeWord: false, regexp: true })

    const corrupted = createFindOptionsStore(memoryStore({
      [FIND_OPTIONS_STORAGE_KEY]: { matchCase: 'yes' },
    }))
    expect(corrupted.load()).toEqual({ matchCase: false, wholeWord: false, regexp: false })
  })

  it('存储键为工作区级命名空间键', () => {
    expect(FIND_OPTIONS_STORAGE_KEY).toBe('vsidian.findOptions')
  })
})

describe('findOptions 协议校验', () => {
  it('findOptions.get / findOptions.set 通过 isWebviewToHost', () => {
    const get: WebviewToHost = { kind: 'findOptions.get' }
    const set: WebviewToHost = { kind: 'findOptions.set', options: { matchCase: true, wholeWord: false, regexp: false } }
    expect(isWebviewToHost(get)).toBe(true)
    expect(isWebviewToHost(set)).toBe(true)
  })

  it('findOptions.set 非法 options 被丢弃', () => {
    expect(isWebviewToHost({ kind: 'findOptions.set', options: { matchCase: 1 } })).toBe(false)
    expect(isWebviewToHost({ kind: 'findOptions.set' })).toBe(false)
  })

  it('findOptions.snapshot 通过 isHostToWebview；非法 options 被丢弃', () => {
    const snapshot: HostToWebview = {
      kind: 'findOptions.snapshot',
      options: { matchCase: false, wholeWord: true, regexp: false },
    }
    expect(isHostToWebview(snapshot)).toBe(true)
    expect(isHostToWebview({ kind: 'findOptions.snapshot', options: 'x' })).toBe(false)
    expect(isHostToWebview({ kind: 'findOptions.snapshot' })).toBe(false)
  })
})
