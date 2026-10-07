// #358 T09 webview 渲染桥契约：SDK 注册→上报、生效表解析（模式过滤/
// 未装载回内置）、epoch 热切换递增、代次释放撤销、装载器 renderers 面
// 的接受/拒绝/迟到 no-op。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  installAddonRenderersBridge,
  type AddonRenderersOutboundMessage,
} from '../../src/webview/addonRenderers'
import { installAddonPageLoader } from '../../src/webview/addonPageLoader'
import type { AddonRendererRegistration } from '../../src/shared/addonRenderers'
import type { AddonLoadManifest, AddonPageOutbound } from '../../src/shared/addonPage'

function specOf(rendererId: string, languages: string[], opts: Partial<AddonRendererRegistration> = {}): AddonRendererRegistration {
  return {
    rendererId,
    label: `${rendererId} label`,
    languages,
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
    mount: () => {},
    exportSvg: async () => '<svg></svg>',
    ...opts,
  }
}

function tableOf(languages: Array<{ language: string; effective: string; source?: 'user' | 'auto' }>, providers: Array<{ addonId: string; rendererId: string; languages: string[] }> = [], version = 1) {
  return {
    version,
    providers: providers.map((p) => ({
      addonId: p.addonId,
      rendererId: p.rendererId,
      providerId: `${p.addonId}/${p.rendererId}`,
      label: `${p.rendererId} label`,
      languages: p.languages,
      modes: ['live' as const, 'reading' as const],
      exportFormats: ['svg' as const],
    })),
    languages: languages.map((l) => ({ language: l.language, effective: l.effective, source: l.source ?? 'auto' })),
  }
}

describe('注册与上报', () => {
  it('SDK 注册成功即上报可序列化声明（回调不上桥）；dispose 撤销再上报', () => {
    const outbox: AddonRenderersOutboundMessage[] = []
    const bridge = installAddonRenderersBridge((m) => outbox.push(m))
    const calls: string[] = []
    expect(bridge.register('pub.a', 3, { ...specOf('r1', ['mermaid']), mount: () => calls.push('mount') })).toBe(true)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]!.payload.addonId).toBe('pub.a')
    expect(outbox[0]!.payload.providers[0]).toMatchObject({ rendererId: 'r1', label: 'r1 label', languages: ['mermaid'] })
    expect(JSON.stringify(outbox[0]!.payload.providers[0])).not.toContain('mount')
    expect(bridge.localProvidersOf('pub.a')).toHaveLength(1)
    bridge.disposeRenderer('pub.a', 3, 'r1')
    expect(bridge.localProvidersOf('pub.a')).toHaveLength(0)
    expect(outbox[1]!.payload.providers).toHaveLength(0)
    expect(calls).toEqual([])
  })

  it('非法声明拒绝（缺名称/空语言/声明 svg 但无 exportSvg）；同代次同 ID 重复拒绝', () => {
    const bridge = installAddonRenderersBridge(() => {})
    expect(bridge.register('pub.a', 1, { ...specOf('r1', ['x']), label: '' })).toBe(false)
    expect(bridge.register('pub.a', 1, { ...specOf('r1', [] as string[]) })).toBe(false)
    expect(bridge.register('pub.a', 1, { ...specOf('r1', ['x']), exportSvg: undefined })).toBe(false)
    expect(bridge.register('pub.a', 1, specOf('r1', ['x']))).toBe(true)
    expect(bridge.register('pub.a', 1, specOf('r1', ['x']))).toBe(false)
  })

  it('代次释放撤销该组件全部候选并上报空集；旧代次操作不生效', () => {
    const outbox: AddonRenderersOutboundMessage[] = []
    const bridge = installAddonRenderersBridge((m) => outbox.push(m))
    bridge.register('pub.a', 1, specOf('r1', ['x']))
    bridge.releaseGeneration('pub.a', 1)
    expect(outbox.at(-1)!.payload.providers).toHaveLength(0)
    // 旧代次迟到 dispose/release：不复活不上报
    const before = outbox.length
    bridge.disposeRenderer('pub.a', 1, 'r1')
    bridge.releaseGeneration('pub.a', 1)
    expect(outbox).toHaveLength(before)
  })
})

describe('生效表解析', () => {
  it('表未到/无表项 → builtin 口径；none → none（普通代码块）', () => {
    const bridge = installAddonRenderersBridge(() => {})
    expect(bridge.resolve('mermaid', 'live')).toEqual({ kind: 'builtin' })
    expect(bridge.applyTable(tableOf([{ language: 'draw', effective: 'none' }]))).toBe(true)
    expect(bridge.resolve('draw', 'live')).toEqual({ kind: 'none' })
    expect(bridge.resolve('mermaid', 'live')).toEqual({ kind: 'builtin' })
  })

  it('生效提供者已本地装载 → addon；未装载（页面在途）→ builtin', () => {
    const bridge = installAddonRenderersBridge(() => {})
    bridge.register('pub.a', 1, specOf('r1', ['mermaid', 'draw']))
    bridge.applyTable(tableOf(
      [{ language: 'mermaid', effective: 'pub.a/r1' }, { language: 'draw', effective: 'pub.a/r1' }],
      [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid', 'draw'] }],
    ))
    expect(bridge.resolve('mermaid', 'live')).toMatchObject({ kind: 'addon', providerId: 'pub.a/r1' })
    // 另一组件生效但本页未装载（单 webview 视角）：回 builtin
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'pub.b/r9' }], [], 2))
    expect(bridge.resolve('mermaid', 'live')).toEqual({ kind: 'builtin' })
  })

  it('模式过滤：未支持的模式不调用其入口（回 builtin）', () => {
    const bridge = installAddonRenderersBridge(() => {})
    bridge.register('pub.a', 1, { ...specOf('r1', ['mermaid']), modes: ['live'] })
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    expect(bridge.resolve('mermaid', 'live')).toMatchObject({ kind: 'addon' })
    expect(bridge.resolve('mermaid', 'reading')).toEqual({ kind: 'builtin' })
  })

  it('用户显式选内置 → builtin（改回内置路径）', () => {
    const bridge = installAddonRenderersBridge(() => {})
    bridge.register('pub.a', 1, specOf('r1', ['mermaid']))
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'builtin', source: 'user' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    expect(bridge.resolve('mermaid', 'live')).toEqual({ kind: 'builtin' })
  })
})

describe('生效代次（epoch）与热切换通知', () => {
  it('语言生效者变化才递增 epoch；等值表（同 version）跳过；无关语言不动', () => {
    const bridge = installAddonRenderersBridge(() => {})
    expect(bridge.applyTable(tableOf([{ language: 'a', effective: 'pub.a/r1' }, { language: 'b', effective: 'none' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['a'] }]))).toBe(true)
    expect(bridge.epochOf('a')).toBe(1)
    // 首表 none/builtin 行与空表默认态（普通代码块/内置管线）零显示差异
    //——不递增（否则每个新面板装载都多一次无意义热切换）
    expect(bridge.epochOf('b')).toBe(0)
    // 同 version 重放：跳过
    expect(bridge.applyTable(tableOf([{ language: 'a', effective: 'pub.a/r1' }, { language: 'b', effective: 'none' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['a'] }]))).toBe(false)
    expect(bridge.epochOf('a')).toBe(1)
    // 只换 b 的生效者：a 的 epoch 不动
    bridge.applyTable(tableOf([{ language: 'a', effective: 'pub.a/r1' }, { language: 'b', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['a', 'b'] }], 2))
    expect(bridge.epochOf('a')).toBe(1)
    // b：none（首表零递增）→ 组件，一次真变化 = 1
    expect(bridge.epochOf('b')).toBe(1)
    // a 消失（语言撤下）：递增
    bridge.applyTable(tableOf([{ language: 'b', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['b'] }], 3))
    expect(bridge.epochOf('a')).toBe(2)
  })

  it('onTableChanged 携带变化语言清单；恢复（内置→组件）同样通知', () => {
    const bridge = installAddonRenderersBridge(() => {})
    const changes: string[][] = []
    bridge.onTableChanged((change) => changes.push([...change.changedLanguages]))
    // 首表 builtin 行 = 空表默认态零差异：通知载荷空清单（消费方
    // syncController 以空清单 + 动态集未变拦截，不触发重渲染）
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'builtin' }]))
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }], 2))
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'builtin' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }], 3))
    expect(changes).toEqual([[], ['mermaid'], ['mermaid']])
  })

  it('渲染型围栏语言集：内置 ∪ 可用组件语言；none 不计入；标签取生效声明', () => {
    const bridge = installAddonRenderersBridge(() => {})
    expect([...bridge.renderedFenceLanguages()]).toEqual(['mermaid'])
    bridge.register('pub.a', 1, specOf('r1', ['draw', 'mermaid']))
    bridge.applyTable(tableOf(
      [{ language: 'draw', effective: 'pub.a/r1' }, { language: 'gone', effective: 'none' }, { language: 'mermaid', effective: 'pub.a/r1' }],
      [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw', 'mermaid', 'gone'] }],
    ))
    const languages = bridge.renderedFenceLanguages()
    expect(languages.has('draw')).toBe(true)
    expect(languages.has('mermaid')).toBe(true)
    expect(languages.has('gone')).toBe(false)
    expect(bridge.renderedFenceLabel('draw')).toBe('r1 label')
    expect(bridge.renderedFenceLabel('mermaid')).toBe('r1 label')
    // 内置生效回内置标签
    bridge.applyTable(tableOf([{ language: 'mermaid', effective: 'builtin' }], [], 2))
    expect(bridge.renderedFenceLabel('mermaid')).toBe('Mermaid')
  })
})

describe('装载器 renderers 面（SDK 公开路径）', () => {
  function loaderHarness(renderers: { register: (addonId: string, generation: number, spec: AddonRendererRegistration) => boolean; disposeRenderer: (addonId: string, generation: number, rendererId: string) => void; releaseGeneration: (addonId: string, generation: number) => void }) {
    const outbound: AddonPageOutbound[] = []
    const loadScript = async () => {
      // 构建桥全局登记表（装载器安装时已持有数组引用——不能整组替换）：
      // 每次装载先清空遗留未消费条目再追加本次工厂，隔离同文件多装载器
      // 用例的时间界歧义（真实桥只追加不清空，但真实页面每个 webview 一份
      // 全局表，不存在跨装载器共享）
      const holder = globalThis as unknown as { __vsidianAddonPages?: Array<{ addonId: string; factory: (sdk: unknown) => void; registeredAt: number }> }
      const bucket = (holder.__vsidianAddonPages ??= [])
      bucket.length = 0
      bucket.push({
        addonId: 'pub.a',
        factory: (sdk) => {
          harness.sdk = sdk as { renderers?: { register(spec: AddonRendererRegistration): { dispose(): void } } }
        },
        registeredAt: Date.now(),
      })
      return { ok: true as const }
    }
    const harness: { sdk?: { renderers?: { register(spec: AddonRendererRegistration): { dispose(): void } } } } = {}
    const handle = installAddonPageLoader({
      page: 'editor',
      loadScript,
      loadCss: async () => 'authorized',
      send: (message) => outbound.push(message),
      addonRenderers: renderers,
    })
    return { handle, outbound, harness, manifest: { addonId: 'pub.a', generation: 1, page: 'editor', scriptUri: 'https://x/page.js' } as AddonLoadManifest }
  }

  it('编辑器页 SDK 提供 renderers 面：register 经桥接受，unload 后迟到注册为 no-op', async () => {
    const registered: Array<{ addonId: string; generation: number; rendererId: string }> = []
    const disposed: string[] = []
    const { handle, harness, manifest } = loaderHarness({
      register: (addonId, generation, spec) => {
        registered.push({ addonId, generation, rendererId: spec.rendererId })
        return true
      },
      disposeRenderer: (_a, _g, rendererId) => disposed.push(rendererId),
      releaseGeneration: () => {},
    })
    await handle.load(manifest)
    expect(typeof harness.sdk?.renderers?.register).toBe('function')
    const reg = harness.sdk!.renderers!.register(specOf('r1', ['mermaid']))
    expect(registered).toEqual([{ addonId: 'pub.a', generation: 1, rendererId: 'r1' }])
    reg.dispose()
    expect(disposed).toEqual(['r1'])
    await handle.unload('pub.a', 1)
    // 迟到注册（已终结代次）：no-op 句柄、不进桥
    const before = registered.length
    const late = harness.sdk!.renderers!.register(specOf('r2', ['mermaid']))
    late.dispose()
    expect(registered).toHaveLength(before)
  })

  it('桥拒绝非法声明 → SDK 返回 no-op 句柄（dispose 不再报撤销）', async () => {
    const calls: string[] = []
    const real = installAddonRenderersBridge(() => {})
    const { handle, harness, manifest } = loaderHarness({
      register: (addonId, generation, spec) => real.register(addonId, generation, spec),
      disposeRenderer: (a, g, id) => real.disposeRenderer(a, g, id),
      releaseGeneration: (a, g) => real.releaseGeneration(a, g),
    })
    await handle.load(manifest)
    harness.sdk!.renderers!.register({ ...specOf('bad', ['x']), label: '' })
    const reg = harness.sdk!.renderers!.register(specOf('ok', ['x']))
    expect(real.localProvidersOf('pub.a')).toHaveLength(1)
    reg.dispose()
    expect(real.localProvidersOf('pub.a')).toHaveLength(0)
    expect(calls).toEqual([])
  })

  it('释放路径调用 releaseGeneration（候选随代次回收）', async () => {
    const released: Array<{ addonId: string; generation: number }> = []
    const { handle, manifest } = loaderHarness({
      register: () => true,
      disposeRenderer: () => {},
      releaseGeneration: (addonId, generation) => released.push({ addonId, generation }),
    })
    await handle.load(manifest)
    await handle.unload('pub.a', 1)
    expect(released).toEqual([{ addonId: 'pub.a', generation: 1 }])
  })
})
