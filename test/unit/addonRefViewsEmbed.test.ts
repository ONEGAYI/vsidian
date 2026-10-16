// T06（#545）附加组件只读引用嵌入挂载运行时契约（jsdom + 假端口直驱）：
// 容器归属（非本组件容器/脱树/内核引用内容内拒绝）、重复挂载仲裁（同容器
// 未释放前拒绝，释放后可重挂）、同目标双实例独立（occurrence 与子根独立）、
// 句柄释放/父根脱树/组件停用整组释放、装载结局兑现（content/error）与
// 释放后迟到结果不再兑现。卡片本体（请求/装载/watch）由 EmbedCardManager
// 既有测试与浏览器/集成层承载。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type {
  AddonRefEmbedCardInput,
  AddonRefViewsRuntimePorts,
} from '../../src/webview/addonRefViews'
import { AddonRefViewsRuntime } from '../../src/webview/addonRefViews'
import type { AddonRefEmbedRequest } from '../../src/shared/addonRefViews'

interface Harness {
  ports: AddonRefViewsRuntimePorts
  mounts: AddonRefEmbedCardInput[]
  released: HTMLElement[]
  setMounted: (ok: boolean) => void
}

function makeHarness(opts: { owned?: (addonId: string, el: HTMLElement) => boolean } = {}): Harness {
  const mounts: AddonRefEmbedCardInput[] = []
  const released: HTMLElement[] = []
  let mounted = true
  const ports: AddonRefViewsRuntimePorts = {
    resolveSource: (instanceId) =>
      instanceId === 'main' ? { viewType: 'main' }
        : instanceId === 'embed:b' ? { viewType: 'embed', fsPath: 'D:\\vault\\b.md' }
        : undefined,
    openPopup: () => null,
    currentPopupInstanceId: () => null,
    closePopup: () => {},
    ownsContainer: opts.owned ?? ((addonId, el) => el.dataset['owner'] === addonId),
    mountEmbedCard: (input) => {
      mounts.push(input)
      return mounted
    },
    releaseEmbedCard: (subRoot) => {
      released.push(subRoot)
    },
  }
  return { ports, mounts, released, setMounted: (ok) => { mounted = ok } }
}

function container(owner = 'addon.a'): HTMLElement {
  const el = document.createElement('div')
  el.dataset['owner'] = owner
  document.body.appendChild(el)
  return el
}

function request(over: Partial<AddonRefEmbedRequest> = {}): AddonRefEmbedRequest {
  return {
    source: 'main',
    target: { path: 'notes/b.md' },
    container: container(),
    ...over,
  }
}

/** 便捷：完成一次挂载并手动兑现内容结局（绕开真实卡片管线） */
async function mountContent(rt: AddonRefViewsRuntime, req: AddonRefEmbedRequest, h: Harness) {
  const pending = rt.mountEmbed('addon.a', 1, req)
  const input = h.mounts[h.mounts.length - 1]!
  input.onFirstOutcome({ ok: true })
  return pending
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('容器归属与请求形状', () => {
  it('合法请求：创建引用子根并经端口挂载（来源解析与目标合成透传）', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const target = container()
    const pending = rt.mountEmbed('addon.a', 1, request({ container: target, source: 'embed:b', target: { path: 'sibling.md' } } as Partial<AddonRefEmbedRequest>))
    h.mounts[0]!.onFirstOutcome({ ok: true })
    const outcome = await pending
    expect(outcome.ok).toBe(true)
    expect(h.mounts).toHaveLength(1)
    expect(h.mounts[0]!.targetText).toBe('sibling.md')
    expect(h.mounts[0]!.addonSource).toEqual({ instanceId: 'embed:b', sourceFsPath: 'D:\\vault\\b.md' })
    expect(h.mounts[0]!.sourceDocUri).toBe('D:\\vault\\b.md')
    expect(h.mounts[0]!.occurrence).toMatch(/^addon-ref-/)
    // 引用子根挂进容器（容器其余内容不被覆盖）
    const subRoot = h.mounts[0]!.subRoot
    expect(subRoot.isConnected).toBe(true)
    expect(subRoot.parentElement).toBe(target)
  })

  it('容器不属于本组件 → invalid-request，不建子根', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const outcome = await rt.mountEmbed('addon.a', 1, request({ container: container('addon.other') }))
    expect(outcome).toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.mounts).toHaveLength(0)
  })

  it('容器脱树 → invalid-request', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const detached = document.createElement('div')
    detached.dataset['owner'] = 'addon.a'
    const outcome = await rt.mountEmbed('addon.a', 1, request({ container: detached }))
    expect(outcome).toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.mounts).toHaveLength(0)
  })

  it('容器在内核引用子根内（引用内容不是组件容器空间）→ invalid-request', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const first = await mountContent(rt, request(), h)
    expect(first.ok).toBe(true)
    // 子根内的元素按归属口仍“属于面板根后代”，但落在平台管理的引用内容里
    const inside = document.createElement('div')
    h.mounts[0]!.subRoot.appendChild(inside)
    const outcome = await rt.mountEmbed('addon.a', 1, request({ container: inside }))
    expect(outcome).toEqual({ ok: false, reason: 'invalid-request' })
    expect(h.mounts).toHaveLength(1)
  })

  it('目标形状非法 → invalid-request；来源实例不在场 → view-disposed', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    expect(await rt.mountEmbed('addon.a', 1, request({ target: { path: '' } })))
      .toEqual({ ok: false, reason: 'invalid-request' })
    expect(await rt.mountEmbed('addon.a', 1, request({ source: 'embed:gone' })))
      .toEqual({ ok: false, reason: 'view-disposed' })
    expect(h.mounts).toHaveLength(0)
  })

  it('页面会话缺失（端口拒绝挂载）→ view-disposed，子根撤下不留半装配', async () => {
    const h = makeHarness()
    h.setMounted(false)
    const rt = new AddonRefViewsRuntime(h.ports)
    const target = container()
    const outcome = await rt.mountEmbed('addon.a', 1, request({ container: target }))
    expect(outcome).toEqual({ ok: false, reason: 'view-disposed' })
    expect(h.mounts[0]!.subRoot.isConnected).toBe(false)
    expect(target.childElementCount).toBe(0)
    // 会话缺失不占用容器：同容器可立即重试
    h.setMounted(true)
    const retry = await mountContent(rt, request({ container: target }), h)
    expect(retry.ok).toBe(true)
  })
})

describe('重复挂载与双实例', () => {
  it('同容器重复挂载（未释放）→ duplicate-mount；释放后可重挂', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const target = container()
    const first = await mountContent(rt, request({ container: target }), h)
    if (!first.ok) throw new Error('首挂载应成功')
    expect(await rt.mountEmbed('addon.a', 1, request({ container: target })))
      .toEqual({ ok: false, reason: 'duplicate-mount' })
    expect(first.handle.release()).toBe(true)
    const second = await mountContent(rt, request({ container: target }), h)
    expect(second.ok).toBe(true)
    expect(h.mounts).toHaveLength(2)
  })

  it('同目标双实例：occurrence 各自独立，子根与句柄互不干扰', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const a = await mountContent(rt, request({ target: { path: 'notes/b.md' } }), h)
    const b = await mountContent(rt, request({ target: { path: 'notes/b.md' } }), h)
    expect(a.ok && b.ok).toBe(true)
    expect(h.mounts[0]!.occurrence).not.toBe(h.mounts[1]!.occurrence)
    // 释放其一不影响另一处（共享读取数据不共享挂载）
    expect(a.ok && a.handle.release()).toBe(true)
    expect(b.ok && b.handle.isActive()).toBe(true)
    expect(h.released).toEqual([h.mounts[0]!.subRoot])
  })
})

describe('释放矩阵', () => {
  it('句柄释放：撤下子根 + 端口整组释放；重复调用幂等', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const outcome = await mountContent(rt, request(), h)
    if (!outcome.ok) throw new Error('应成功')
    const subRoot = h.mounts[0]!.subRoot
    expect(outcome.handle.isActive()).toBe(true)
    expect(outcome.handle.release()).toBe(true)
    expect(subRoot.isConnected).toBe(false)
    expect(h.released).toEqual([subRoot])
    expect(outcome.handle.release()).toBe(false)
    expect(outcome.handle.isActive()).toBe(false)
    expect(h.released).toHaveLength(1)
  })

  it('装载中释放：promise 以 view-disposed 终结，迟到结局不再兑现', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.mountEmbed('addon.a', 1, request())
    const later = pending.then((o) => o)
    // 未兑现前组件停用：pending 挂载整组释放
    rt.releaseAddon('addon.a', 1)
    expect(await later).toEqual({ ok: false, reason: 'view-disposed' })
    expect(h.released).toEqual([h.mounts[0]!.subRoot])
    // 迟到的首结局（旧异步读取回包）：不重挂、不再改变结果
    h.mounts[0]!.onFirstOutcome({ ok: true })
    expect(h.released).toHaveLength(1)
  })

  it('父根/容器脱树（DOM 变更观测）：整组释放', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const target = container()
    const outcome = await mountContent(rt, request({ container: target }), h)
    if (!outcome.ok) throw new Error('应成功')
    target.remove()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.released).toEqual([h.mounts[0]!.subRoot])
    expect(outcome.handle.isActive()).toBe(false)
  })

  it('组件停用（releaseAddon）整组释放：仅本组件本代次', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const a1 = await mountContent(rt, request(), h)
    const bPending = rt.mountEmbed('addon.b', 1, request({ container: container('addon.b') }))
    h.mounts[1]!.onFirstOutcome({ ok: true })
    const b = await bPending
    void b
    rt.releaseAddon('addon.b')
    expect(h.released).toEqual([h.mounts[1]!.subRoot])
    rt.releaseAddon('addon.a', 2) // 旧代次：不动
    expect(h.released).toHaveLength(1)
    rt.releaseAddon('addon.a', 1)
    expect(h.released).toEqual([h.mounts[1]!.subRoot, h.mounts[0]!.subRoot])
    expect(a1.ok && a1.handle.isActive()).toBe(false)
  })

  it('错误挂载仍归组件所有：停用后整组回收（错误分态不滞留）', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.mountEmbed('addon.a', 1, request())
    h.mounts[0]!.onFirstOutcome({ ok: false, reason: 'not-found' })
    const outcome = await pending
    expect(outcome).toEqual({ ok: false, reason: 'not-found' })
    // 错误视图留在场（组件未获句柄），停用后整组释放
    expect(h.mounts[0]!.subRoot.isConnected).toBe(true)
    rt.releaseAddon('addon.a')
    expect(h.released).toEqual([h.mounts[0]!.subRoot])
  })
})

describe('装载结局兑现', () => {
  it('错误结局透传真实原因（anchor-invalid / file-too-large / budget）', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    for (const reason of ['anchor-invalid', 'file-too-large', 'budget'] as const) {
      const pending = rt.mountEmbed('addon.a', 1, request({ target: { path: `${reason}.md` } }))
      h.mounts[h.mounts.length - 1]!.onFirstOutcome({ ok: false, reason })
      expect(await pending).toEqual({ ok: false, reason })
    }
  })

  it('迟到二次结局幂等（不改变已兑现结果）', async () => {
    const h = makeHarness()
    const rt = new AddonRefViewsRuntime(h.ports)
    const pending = rt.mountEmbed('addon.a', 1, request())
    const input = h.mounts[0]!
    input.onFirstOutcome({ ok: true })
    const outcome = await pending
    expect(outcome.ok).toBe(true)
    input.onFirstOutcome({ ok: false, reason: 'not-found' })
    input.onFirstOutcome({ ok: true })
    expect(outcome.ok && outcome.handle.isActive()).toBe(true)
  })
})

