// T05（#544）附加组件只读引用浮窗请求运行时契约（jsdom + 假端口直驱）：
// 来源 B 解析（main/embed/hover）、无效来源与脱树触发位置的普通拒绝、
// 请求替换仲裁（旧请求终结、旧句柄不误关后来的浮窗）、迟到结局幂等、
// 错误原因透传、组件代次释放与句柄活性。浮窗本体（几何/Esc/保活）由
// hoverPopup 既有测试与浏览器回归承载。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { AddonRefPopupSettle, AddonRefViewsRuntimePorts } from '../../src/webview/addonRefViews'
import { AddonRefViewsRuntime } from '../../src/webview/addonRefViews'
import type { AddonRefPopupRequest } from '../../src/shared/addonRefViews'

interface OpenCall {
  trigger: HTMLElement
  spec: { target: string; sourceStart: number; sourceEnd: number }
  keyboard: boolean
  addonSource: { instanceId: string; sourceFsPath: string }
  onSettled: (settle: AddonRefPopupSettle) => void
}

function makePorts(sources: Record<string, { viewType: 'main' } | { viewType: 'embed' | 'hover'; fsPath: string } | undefined>) {
  const calls: OpenCall[] = []
  let popupInstance: string | null = null
  let closeCalls = 0
  const ports: AddonRefViewsRuntimePorts = {
    resolveSource: (instanceId) => sources[instanceId],
    openPopup: (input) => {
      calls.push(input)
      popupInstance = `hover-${calls.length}`
      return popupInstance
    },
    currentPopupInstanceId: () => popupInstance,
    closePopup: () => {
      closeCalls++
      // 关闭语义：当前浮窗离场（生产 closeHoverPopup 同步触发 loading 态
      // settle ——由调用方在测试里手动模拟 settle('closed')）
      popupInstance = null
    },
  }
  return { ports, calls, get closeCalls() { return closeCalls }, setPopup: (id: string | null) => { popupInstance = id } }
}

function trigger(): HTMLElement {
  const el = document.createElement('button')
  el.getBoundingClientRect = () => new DOMRect(20, 30, 60, 24)
  document.body.appendChild(el)
  return el
}

function request(over: Partial<AddonRefPopupRequest> = {}): AddonRefPopupRequest {
  return {
    source: 'main',
    target: { path: 'notes/b.md' },
    trigger: trigger(),
    ...over,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('来源解析与请求载荷', () => {
  it('main 来源：addonSource.sourceFsPath 为空串（宿主按面板文档解析）', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request())
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]!.addonSource).toEqual({ instanceId: 'main', sourceFsPath: '' })
    expect(h.calls[0]!.spec.target).toBe('notes/b.md')
    expect(h.calls[0]!.keyboard).toBe(false)
    h.calls[0]!.onSettled({ phase: 'content' })
    const outcome = await pending
    expect(outcome.ok).toBe(true)
  })

  it('embed 来源 B：sourceFsPath 为 B 的目标 fsPath（R-U02）', async () => {
    const h = makePorts({ 'embed:h1': { viewType: 'embed', fsPath: 'D:\\vault\\b\\b.md' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request({
      source: 'embed:h1',
      target: { path: 'sibling.md' },
      trigger: trigger(),
    }))
    expect(h.calls[0]!.addonSource).toEqual({ instanceId: 'embed:h1', sourceFsPath: 'D:\\vault\\b\\b.md' })
    h.calls[0]!.onSettled({ phase: 'content' })
    expect((await pending).ok).toBe(true)
  })

  it('锚点合成进目标原文（heading/block/line/range）', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    void rt.requestPopup('addon.a', 1, request({ target: { path: 'b.md', anchor: { kind: 'heading', heading: '第二章' } } }))
    void rt.requestPopup('addon.a', 1, request({ target: { path: 'b.md', anchor: { kind: 'block', blockId: 'blk-1' } } }))
    void rt.requestPopup('addon.a', 1, request({ target: { path: 'a.ts', anchor: { kind: 'line', line: 20 } } }))
    void rt.requestPopup('addon.a', 1, request({ target: { path: 'a.ts', anchor: { kind: 'range', startLine: 3, endLine: 8 } } }))
    expect(h.calls.map((c) => c.spec.target)).toEqual([
      'b.md#第二章', 'b.md#^blk-1', 'a.ts#line=20', 'a.ts#range=3-8',
    ])
  })

  it('keyboard 请求透传（键盘路径）', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    void rt.requestPopup('addon.a', 1, request({ keyboard: true }))
    expect(h.calls[0]!.keyboard).toBe(true)
  })
})

describe('普通拒绝（不创建浮窗）', () => {
  it('来源实例不在场 → view-disposed，零浮窗请求', async () => {
    const h = makePorts({})
    const rt = new AddonRefViewsRuntime(h.ports)
    const outcome = await rt.requestPopup('addon.a', 1, request({ source: 'embed:gone' }))
    expect(outcome).toEqual({ ok: false, reason: 'view-disposed' })
    expect(h.calls).toHaveLength(0)
  })

  it('触发位置脱树 → invalid-request，不猜测另一处位置', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const detached = document.createElement('button') // 未 append
    const outcome = await rt.requestPopup('addon.a', 1, request({ trigger: detached }))
    expect(outcome).toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.calls).toHaveLength(0)
  })

  it('触发位置没有可用绘制区域 → invalid-request，不创建原点浮窗', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const hidden = trigger()
    hidden.getBoundingClientRect = () => new DOMRect()
    expect(await rt.requestPopup('addon.a', 1, request({ trigger: hidden })))
      .toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.calls).toHaveLength(0)
  })

  it('目标形状非法（空 path 无锚点 / 行范围倒置）→ invalid-request', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    expect(await rt.requestPopup('addon.a', 1, request({ target: { path: '' } }))).toEqual({ ok: false, reason: 'invalid-request' })
    expect(await rt.requestPopup('addon.a', 1, request({ target: { path: 'a.ts', anchor: { kind: 'range', startLine: 9, endLine: 5 } } })))
      .toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.calls).toHaveLength(0)
  })

  it('页面会话缺失（openPopup 拒绝）→ view-disposed', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rejectPorts: AddonRefViewsRuntimePorts = { ...h.ports, openPopup: () => null }
    const rt = new AddonRefViewsRuntime(rejectPorts)
    expect(await rt.requestPopup('addon.a', 1, request())).toEqual({ ok: false, reason: 'view-disposed' })
  })
})

describe('单浮窗仲裁、句柄与迟到结局', () => {
  it('新请求替换旧请求：旧请求以 view-disposed 终结', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const first = rt.requestPopup('addon.a', 1, request())
    const second = rt.requestPopup('addon.b', 1, request({ target: { path: 'other.md' } }))
    // 替换：旧浮窗在装载中被关闭（onSettled closed 由浮窗模块同步触发）
    h.calls[0]!.onSettled({ phase: 'closed' })
    h.calls[1]!.onSettled({ phase: 'content' })
    expect(await first).toEqual({ ok: false, reason: 'view-disposed' })
    const outcome = await second
    expect(outcome.ok).toBe(true)
  })

  it('旧句柄关闭不误关后来的浮窗（另一组件）', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const first = rt.requestPopup('addon.a', 1, request())
    h.calls[0]!.onSettled({ phase: 'content' })
    const firstOutcome = await first
    if (!firstOutcome.ok) throw new Error('首请求应成功')
    const second = rt.requestPopup('addon.b', 1, request())
    h.calls[1]!.onSettled({ phase: 'content' })
    const secondOutcome = await second
    expect(secondOutcome.ok).toBe(true)
    expect(firstOutcome.handle.close()).toBe(false)
    expect(firstOutcome.handle.isActive()).toBe(false)
    expect(secondOutcome.ok && secondOutcome.handle.isActive()).toBe(true)
    expect(h.closeCalls).toBe(0)
  })

  it('本请求句柄 close 只关自己的浮窗；重复调用幂等', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request())
    h.calls[0]!.onSettled({ phase: 'content' })
    const outcome = await pending
    if (!outcome.ok) throw new Error('应成功')
    expect(outcome.handle.isActive()).toBe(true)
    expect(outcome.handle.close()).toBe(true)
    expect(h.closeCalls).toBe(1)
    // 关闭后：浮窗离场（closePopup 置 null）——isActive 翻 false，重复 close 无效
    expect(outcome.handle.isActive()).toBe(false)
    expect(outcome.handle.close()).toBe(false)
    expect(h.closeCalls).toBe(1)
  })

  it('装载中（pending）句柄行为：close 关闭装载中浮窗；错误结局兑现失败原因', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request())
    const settled = pending.then((o) => o)
    h.calls[0]!.onSettled({ phase: 'error', reason: 'not-found' })
    expect(await settled).toEqual({ ok: false, reason: 'not-found' })
    // 迟到二次结局（迟到回包/重复回调）幂等——不改变已兑现结果
    h.calls[0]!.onSettled({ phase: 'content' })
    h.calls[0]!.onSettled({ phase: 'closed' })
  })

  it('错误原因透传（anchor-invalid / file-too-large）', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const a = rt.requestPopup('addon.a', 1, request())
    h.calls[0]!.onSettled({ phase: 'error', reason: 'anchor-invalid' })
    expect(await a).toEqual({ ok: false, reason: 'anchor-invalid' })
    const b = rt.requestPopup('addon.a', 1, request())
    h.calls[1]!.onSettled({ phase: 'error', reason: 'file-too-large' })
    expect(await b).toEqual({ ok: false, reason: 'file-too-large' })
    const c = rt.requestPopup('addon.a', 1, request())
    h.calls[2]!.onSettled({ phase: 'error', reason: 'budget' })
    expect(await c).toEqual({ ok: false, reason: 'budget' })
  })
})

describe('组件代次释放', () => {
  it('旧代次的释放不关闭同组件新代次浮窗', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 2, request())
    h.calls[0]!.onSettled({ phase: 'content' })
    await pending
    rt.releaseAddon('addon.a', 1)
    expect(h.closeCalls).toBe(0)
    rt.releaseAddon('addon.a', 2)
    expect(h.closeCalls).toBe(1)
  })
  it('错误浮窗仍归组件所有：停用后关闭错误视图', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request())
    h.calls[0]!.onSettled({ phase: 'error', reason: 'not-found' })
    expect(await pending).toEqual({ ok: false, reason: 'not-found' })
    rt.releaseAddon('addon.a')
    expect(h.closeCalls).toBe(1)
  })

  it('来源实例销毁后关闭对应浮窗，其他来源不受影响', async () => {
    const h = makePorts({ 'embed:b': { viewType: 'embed', fsPath: 'D:/notes/b.md' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request({ source: 'embed:b' }))
    h.calls[0]!.onSettled({ phase: 'content' })
    expect((await pending).ok).toBe(true)
    rt.releaseSource('embed:other')
    expect(h.closeCalls).toBe(0)
    rt.releaseSource('embed:b')
    expect(h.closeCalls).toBe(1)
  })

  it('releaseAddon 关闭该组件拥有的浮窗，pending 请求以 view-disposed 终结', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.requestPopup('addon.a', 1, request())
    rt.releaseAddon('addon.b') // 别的组件：不动
    expect(h.closeCalls).toBe(0)
    rt.releaseAddon('addon.a')
    expect(h.closeCalls).toBe(1)
    h.calls[0]!.onSettled({ phase: 'closed' }) // closeHoverPopup 同步触发
    expect(await pending).toEqual({ ok: false, reason: 'view-disposed' })
  })

  it('浮窗已换主（非本组件）时 releaseAddon 不误关', async () => {
    const h = makePorts({ main: { viewType: 'main' } })
    const rt = new AddonRefViewsRuntime(h.ports)
    const first = rt.requestPopup('addon.a', 1, request())
    const second = rt.requestPopup('addon.b', 1, request())
    h.calls[0]!.onSettled({ phase: 'closed' })
    h.calls[1]!.onSettled({ phase: 'content' })
    await first
    await second
    rt.releaseAddon('addon.a') // 旧组件释放：当前浮窗属 addon.b
    expect(h.closeCalls).toBe(0)
  })
})
