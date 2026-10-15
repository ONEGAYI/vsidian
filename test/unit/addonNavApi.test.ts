// #543 T03 附加组件文档打开与定位 API——共享形状与守卫单测。
//
// 覆盖（票面 TDD 清单的「非法组合」段）：
// - 定位描述互斥三形态的合法/非法判别（行号正整数、标题/块 ID 非空、
//   不接受 `^` 前缀块 ID——非法形状不进入打开管线）；
// - 请求形状：sourceInstanceId 非空、target 字符串（空串=同文件锚点）、
//   locate 可缺省；
// - 协议消息守卫（addonDocNav.request / addonDocNav.result 的合法与
//   非法形态——消息桥内层校验的单一事实源）。
import { describe, expect, it } from 'vitest'
import {
  isAddonDocNavLocate,
  isAddonDocNavRequest,
  type AddonDocNavLocate,
  type AddonDocNavRequest,
} from '../../src/shared/addonNavApi'
import { isHostToWebview, isWebviewToHost } from '../../src/shared/protocol'

describe('addonNavApi 守卫：定位描述', () => {
  it('接受三形态合法值', () => {
    expect(isAddonDocNavLocate({ kind: 'line', line: 1 })).toBe(true)
    expect(isAddonDocNavLocate({ kind: 'line', line: 103 })).toBe(true)
    expect(isAddonDocNavLocate({ kind: 'heading', heading: '第二章' })).toBe(true)
    expect(isAddonDocNavLocate({ kind: 'block', blockId: 'abc123' })).toBe(true)
  })

  it('拒绝非法行号：0、负数、非整数、非数字', () => {
    expect(isAddonDocNavLocate({ kind: 'line', line: 0 })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'line', line: -3 })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'line', line: 1.5 })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'line', line: Number.NaN })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'line', line: '20' })).toBe(false)
  })

  it('拒绝空标题与空块 ID；块 ID 不带 ^ 前缀（与 [[#^id]] 解析后形态一致）', () => {
    expect(isAddonDocNavLocate({ kind: 'heading', heading: '' })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'heading', heading: '   ' })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'block', blockId: '' })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'block', blockId: '^abc' })).toBe(false)
  })

  it('拒绝未知 kind 与非对象形态', () => {
    expect(isAddonDocNavLocate(null)).toBe(false)
    expect(isAddonDocNavLocate(42)).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'range', from: 1, to: 2 })).toBe(false)
    expect(isAddonDocNavLocate({})).toBe(false)
  })

  it('行号与其他字段混入即整条非法（互斥结构面：序列化载荷不接受多余定位字段）', () => {
    expect(isAddonDocNavLocate({ kind: 'line', line: 3, heading: 'x' })).toBe(false)
    expect(isAddonDocNavLocate({ kind: 'heading', heading: 'x', blockId: 'y' })).toBe(false)
  })
})

describe('addonNavApi 守卫：请求形状', () => {
  it('接受最小请求（无 locate）与完整请求', () => {
    expect(isAddonDocNavRequest({ sourceInstanceId: 'main', target: 'notes/a.md' })).toBe(true)
    const full: AddonDocNavRequest = {
      sourceInstanceId: 'embed:h1',
      target: '../b.md',
      locate: { kind: 'line', line: 20 },
    }
    expect(isAddonDocNavRequest(full)).toBe(true)
  })

  it('空 target 合法（同文件锚点——沿双链 [[#锚点]] 语义）', () => {
    expect(isAddonDocNavRequest({ sourceInstanceId: 'main', target: '', locate: { kind: 'heading', heading: '标题' } })).toBe(true)
  })

  it('拒绝缺来源实例、空实例 ID、非字符串 target 与非法 locate', () => {
    expect(isAddonDocNavRequest({ target: 'a.md' })).toBe(false)
    expect(isAddonDocNavRequest({ sourceInstanceId: '', target: 'a.md' })).toBe(false)
    expect(isAddonDocNavRequest({ sourceInstanceId: 'main', target: 42 })).toBe(false)
    expect(isAddonDocNavRequest({ sourceInstanceId: 'main', target: 'a.md', locate: { kind: 'line', line: 0 } })).toBe(false)
    expect(isAddonDocNavRequest(null)).toBe(false)
  })

  it('locate 类型可编译消费（公开面组合）', () => {
    const locate: AddonDocNavLocate = { kind: 'block', blockId: 'z1' }
    expect(locate.kind).toBe('block')
  })
})

describe('addonNavApi 协议消息守卫', () => {
  const baseRequest = {
    kind: 'addonDocNav.request',
    sessionId: 's1',
    docUri: 'file:///d%3A/ws/a.md',
    reqId: 7,
    addonId: 'test.addon',
    generation: 2,
    sourceDocUri: 'file:///d%3A/ws/b.md',
    sourceInstanceId: 'main',
    target: 'c.md',
  }

  it('addonDocNav.request：合法（无 locate 与有 locate）', () => {
    expect(isWebviewToHost(baseRequest)).toBe(true)
    expect(isWebviewToHost({ ...baseRequest, locate: { kind: 'line', line: 4 } })).toBe(true)
    expect(isWebviewToHost({ ...baseRequest, locate: { kind: 'heading', heading: 'T' } })).toBe(true)
    expect(isWebviewToHost({ ...baseRequest, locate: { kind: 'block', blockId: 'id9' } })).toBe(true)
  })

  it('addonDocNav.request：非法形态拒绝', () => {
    expect(isWebviewToHost({ ...baseRequest, reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, reqId: 1.5 })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, addonId: '' })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, generation: '2' })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, sourceDocUri: '' })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, target: 5 })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, locate: { kind: 'line', line: -1 } })).toBe(false)
    expect(isWebviewToHost({ ...baseRequest, kind: 'addonDocNav.requestx' })).toBe(false)
  })

  it('addonDocNav.result：合法与非法', () => {
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 7, addonId: 'test.addon', generation: 2,
      result: { ok: true, opened: true, located: true },
    })).toBe(true)
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 7, addonId: 'test.addon', generation: 2,
      result: { ok: false, reason: 'not-found', opened: false },
    })).toBe(true)
    // 非法结果形态：reason 越界、opened 缺失、ok 成功分支缺 located
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 7, addonId: 'test.addon', generation: 2,
      result: { ok: false, reason: 'made-up', opened: false },
    })).toBe(false)
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 7, addonId: 'test.addon', generation: 2,
      result: { ok: false, reason: 'not-found' },
    })).toBe(false)
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 7, addonId: 'test.addon', generation: 2,
      result: { ok: true, opened: true },
    })).toBe(false)
    expect(isHostToWebview({
      kind: 'addonDocNav.result', reqId: 0, addonId: 'test.addon', generation: 2,
      result: { ok: true, opened: true, located: false },
    })).toBe(false)
  })
})
