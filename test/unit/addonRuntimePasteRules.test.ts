// #541 T01 附加组件粘贴规则——宿主注册服务与运行生命周期接入的契约测试。
// 钉住票面验收：
// - enable 生命周期登记可序列化规则（来源身份由平台注入，作者不能冒充
//   其他组件）；普通拒绝（非法/重复/超预算）返回可辨认原因，不算组件故障；
// - 停用、故障、单组释放与代次结束撤回相应规则，广播有效快照（版本
//   单调、内容等值不递增）；重新启用后新登记不受旧 ID 残留阻碍；
// - 迟到注册（已终结代次）拒绝 released；dispose 句柄只移除本批规则。
import { describe, expect, it } from 'vitest'
import { AddonRegistry } from '../../src/host/addons/addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from '../../src/host/addons/addonRuntime'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import { AddonStorageService } from '../../src/host/addons/addonStorageService'
import { AddonPasteRuleService } from '../../src/host/addons/addonPasteRuleService'
import { AddonThemeService } from '../../src/host/addons/addonThemeService'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'
import type { AddonEnableContext, AddonDefinition } from '../../src/host/addons/addonRegistry'

function memoryStore(initial: { user?: Record<string, boolean> } = {}): AddonPreferenceStore & { user: Record<string, boolean> } {
  const state = { user: { ...initial.user } }
  return {
    hasWorkspace: false,
    get user() { return state.user },
    read: () => ({ user: { ...state.user }, workspace: null }),
    write(_scope, values) {
      for (const [addonId, value] of Object.entries(values)) {
        if (value === undefined) delete state.user[addonId]
        else state.user[addonId] = value
      }
    },
  }
}

interface Harness {
  registry: AddonRegistry
  runtime: AddonRuntime
  pasteRules: AddonPasteRuleService
  store: ReturnType<typeof memoryStore>
  logs: string[]
  register(definition?: AddonDefinition, addonId?: string): unknown
}

function harness(options: { store?: ReturnType<typeof memoryStore> } = {}): Harness {
  const store = options.store ?? memoryStore()
  const logs: string[] = []
  const pasteRules = new AddonPasteRuleService({ log: (stage, detail) => logs.push(`${stage}:${detail}`) })
  const settingsPersistence: AddonSettingsPersistencePort = {
    hasWorkspace: false,
    read: () => undefined,
    write: async () => true,
  }
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences: store,
    settings: new AddonSettingsService(settingsPersistence),
    storage: new AddonStorageService({
      baseDir: '/test/addons',
      uriOf: (addonId) => `file:///test/addons/${addonId}`,
      fs: {
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        delete: async () => {},
        readDirectory: async () => [],
        createDirectory: async () => {},
      },
      createWatcher: () => ({ dispose: () => {} }),
    }),
    pasteRules,
    themes: new AddonThemeService({ log: () => {} }),
    installDirOf: (addonId) => (addonId === 'fixture.demo' ? (process.platform === 'win32' ? 'C:\\addons\\demo' : '/addons/demo') : undefined),
    log: (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`),
  })
  const extensions = [{ id: 'fixture.demo', packageJSON: { name: 'demo', publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } } }]
  const registry = new AddonRegistry(
    {
      apiVersion: ADDON_API_VERSION,
      experimental: {},
      officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
      findExtension: (id) => extensions.find((extension) => extension.id === id),
    },
    runtime.registryHooks(),
  )
  return {
    registry,
    runtime,
    pasteRules,
    store,
    logs,
    register: (definition, addonId = 'fixture.demo') => registry.register({ id: addonId }, definition ?? {}),
  }
}

/** Codex 形态规则声明（宿主组件代码形态的提交物） */
const promptLinkRule = () => ({
  id: 'prompt-link',
  match: { tag: 'span', attributes: [{ name: 'data-prompt-link-url' }] },
  output: {
    kind: 'template',
    template: '[{{label}}]({{url}})',
    slots: {
      label: { source: { kind: 'text' } },
      url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
    },
  },
})

/** enable 回调内登记规则并保留句柄（组件作者视角的消费样例形态） */
function registerFromEnable(definition: Partial<AddonDefinition> = {}): {
  harness: Harness
  results: import('../../src/shared/addonPasteRules').AddonPasteRulesRegisterResult[]
} {
  const h = harness()
  const results: import('../../src/shared/addonPasteRules').AddonPasteRulesRegisterResult[] = []
  h.register({
    ...definition,
    enable(context: AddonEnableContext) {
      results.push(context.paste.registerRules([promptLinkRule()]))
    },
  })
  return { harness: h, results }
}

describe('粘贴规则宿主注册服务', () => {
  it('登记成功：快照含注入的来源组件身份与确定性排序', () => {
    const h = harness()
    const ok = h.pasteRules.registerRules('b.addon', [promptLinkRule()])
    const ok2 = h.pasteRules.registerRules('a.addon', [{ ...promptLinkRule(), priority: 5 }])
    expect(ok.ok).toBe(true)
    expect(ok2.ok).toBe(true)
    const snapshot = h.pasteRules.effectiveSnapshot()
    expect(snapshot.rules.map((rule) => [rule.addonId, rule.id, rule.priority])).toEqual([
      ['a.addon', 'prompt-link', 5],
      ['b.addon', 'prompt-link', 0],
    ])
    expect(snapshot.version).toBeGreaterThan(0)
  })

  it('普通拒绝不算故障：非法声明/重复 ID/超预算返回可辨认原因', () => {
    const h = harness()
    expect(h.pasteRules.registerRules('a.addon', [{ ...promptLinkRule(), match: { tag: 'SP AN' } }]))
      .toMatchObject({ ok: false, reason: 'invalid-declaration' })
    expect(h.pasteRules.registerRules('a.addon', [promptLinkRule()]).ok).toBe(true)
    expect(h.pasteRules.registerRules('a.addon', [promptLinkRule()]))
      .toMatchObject({ ok: false, reason: 'duplicate-id' })
    expect(h.pasteRules.registerRules('a.addon', Array.from({ length: 257 }, (_, i) => ({ id: `r${i}`, match: { tag: 'SPAN' }, output: { kind: 'discard' } }))))
      .toMatchObject({ ok: false, reason: 'too-many' })
    // 拒绝后快照不受污染（不部分安装）
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(1)
  })

  it('内容等值不递增版本；变化才递增', () => {
    const h = harness()
    const empty = h.pasteRules.effectiveSnapshot()
    expect(empty.version).toBe(0)
    const handle = h.pasteRules.registerRules('a.addon', [promptLinkRule()])
    expect(handle.ok).toBe(true)
    const v1 = h.pasteRules.effectiveSnapshot().version
    expect(v1).toBe(1)
    // 再取一次等值快照：版本不变
    expect(h.pasteRules.effectiveSnapshot().version).toBe(v1)
    if (handle.ok) handle.dispose()
    expect(h.pasteRules.effectiveSnapshot().version).toBe(2)
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
  })

  it('dispose 句柄只移除本批规则，重复 dispose 无害', () => {
    const h = harness()
    const first = h.pasteRules.registerRules('a.addon', [promptLinkRule()])
    const second = h.pasteRules.registerRules('a.addon', [{ ...promptLinkRule(), id: 'another' }])
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    first.dispose()
    first.dispose()
    expect(h.pasteRules.effectiveSnapshot().rules.map((rule) => rule.id)).toEqual(['another'])
    second.dispose()
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
  })

  it('releaseAddon 撤回整组件规则并通知订阅者', () => {
    const h = harness()
    const events: number[] = []
    h.pasteRules.onChanged(() => events.push(h.pasteRules.effectiveSnapshot().version))
    h.pasteRules.registerRules('a.addon', [promptLinkRule()])
    h.pasteRules.releaseAddon('a.addon')
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
    expect(events.length).toBeGreaterThan(0)
    // 幂等：再次释放不递增版本
    const before = h.pasteRules.effectiveSnapshot().version
    h.pasteRules.releaseAddon('a.addon')
    expect(h.pasteRules.effectiveSnapshot().version).toBe(before)
  })
})

describe('粘贴规则运行生命周期（enable 面乙）', () => {
  it('enable 上下文提供 paste.registerRules；登记进入快照', () => {
    const { harness: h, results } = registerFromEnable()
    expect(results).toHaveLength(1)
    expect(results[0]!.ok).toBe(true)
    expect(h.pasteRules.effectiveSnapshot().rules.map((rule) => [rule.addonId, rule.id])).toEqual([['fixture.demo', 'prompt-link']])
  })

  it('停用撤回规则；重新启用后同 ID 可再登记（无旧代次残留）', () => {
    const h = harness()
    const handles: import('../../src/shared/addonPasteRules').AddonPasteRulesRegisterResult[] = []
    h.register({
      enable(context) { handles.push(context.paste.registerRules([promptLinkRule()])) },
    })
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(1)
    h.runtime.setUserEnabled('fixture.demo', false)
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
    h.runtime.setUserEnabled('fixture.demo', true)
    expect(handles[1]?.ok).toBe(true)
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(1)
    const version = h.pasteRules.effectiveSnapshot().version
    // 新代次已登记同 ID 后，旧句柄的迟到 dispose 不能撤掉新规则。
    const oldHandle = handles[0]!
    if (oldHandle.ok) oldHandle.dispose()
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(1)
    expect(h.pasteRules.effectiveSnapshot().version).toBe(version)
  })

  it('迟到注册（停用后）拒绝 released，不算故障', () => {
    const h = harness()
    let late: (() => void) | undefined
    h.register({
      enable(context) {
        late = () => { context.paste.registerRules([promptLinkRule()]) }
      },
    })
    h.runtime.setUserEnabled('fixture.demo', false)
    expect(late).toBeDefined()
    late!()
    // released 拒绝：快照为空且组件未被打成故障
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('disabled')
  })

  it('enable 异常（故障）回收本代次已登记规则', () => {
    const h = harness()
    h.register({
      enable(context) {
        context.paste.registerRules([promptLinkRule()])
        throw new Error('boom')
      },
    })
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
  })

  it('代次结束（registry.release）撤回规则', () => {
    const h = harness()
    h.register({
      enable(context) { context.paste.registerRules([promptLinkRule()]) },
    })
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(1)
    h.registry.release('fixture.demo')
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
    expect(h.runtime.runtimeStatus('fixture.demo')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// #542 T02：高级声明（正则/条件/嵌套）经同一登记面进入有效快照
// ---------------------------------------------------------------------------

describe('T02 高级声明登记', () => {
  it('正则/条件/嵌套声明经同一登记面校验并进入有效快照（JSON 可序列化）', () => {
    const h = harness()
    h.register({
      enable(context) {
        context.paste.registerRules([{
          id: 'advanced-card',
          match: {
            tag: 'div',
            condition: { all: [{ kind: 'attribute-regex', name: 'data-kind', regex: { pattern: '^(card|note)$' } }] },
          },
          output: {
            kind: 'template',
            template: '> {{body}}',
            slots: {
              body: { source: { kind: 'children', rules: [{
                id: 'inner-link',
                match: { tag: 'span', attributes: [{ name: 'data-inner-url' }] },
                output: {
                  kind: 'template',
                  template: '[{{t}}]({{u}})',
                  slots: {
                    t: { source: { kind: 'text-regex', regex: { pattern: '^(?<t>\S+)$' }, group: 't' } },
                    u: { source: { kind: 'attribute', name: 'data-inner-url' }, url: true },
                  },
                },
              }] } },
            },
          },
        }])
      },
    })
    const snapshot = h.pasteRules.effectiveSnapshot()
    expect(snapshot.rules).toHaveLength(1)
    // 快照是可序列化纯数据（广播与页面守卫的既有前提）
    expect(() => JSON.parse(JSON.stringify(snapshot))).not.toThrow()
    const parsed = JSON.parse(JSON.stringify(snapshot)) as { rules: Array<{ id: string; output: { slots: { body: { source: { rules: Array<{ id: string }> } } } } }> }
    expect(parsed.rules[0]!.output.slots.body!.source.rules![0]!.id).toBe('inner-link')
    // 停用撤回照旧生效（T01 生命周期不因高级形态改变）
    h.runtime.setUserEnabled('fixture.demo', false)
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
  })

  it('嵌套深度超限的高级声明整批拒绝（可辨认 invalid-declaration，不算故障）', () => {
    const h = harness()
    let result: import('../../src/shared/addonPasteRules').AddonPasteRulesRegisterResult | undefined
    const chain = (depth: number): unknown => depth === 0
      ? { id: 'leaf', match: { tag: 'span' }, output: { kind: 'discard' } }
      : { id: `level-${depth}`, match: { tag: 'div' }, output: { kind: 'template', template: '{{b}}', slots: { b: { source: { kind: 'children', rules: [chain(depth - 1)] } } } } }
    h.register({
      enable(context) { result = context.paste.registerRules([chain(17)]) },
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid-declaration' })
    expect(h.pasteRules.effectiveSnapshot().rules).toHaveLength(0)
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('enabled')
  })
})

// ---------------------------------------------------------------------------
// PR #564 评审 P2：每组件 256 条上限按「顶层 + 嵌套子规则合计」跨批计量
// ---------------------------------------------------------------------------

describe('跨批递归计数（256 条含嵌套合计）', () => {
  /** 一批声明：1 条顶层（children 槽携带 childCount 条平铺子规则） */
  const batchOf = (topId: string, childCount: number): unknown[] => [{
    id: topId,
    match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
    output: {
      kind: 'template',
      template: '{{body}}',
      slots: {
        body: {
          source: {
            kind: 'children',
            rules: Array.from({ length: childCount }, (_, i) => ({
              id: `${topId}-child-${i}`,
              match: { tag: 'SPAN' },
              output: { kind: 'discard' },
            })),
          },
        },
      },
    },
  }]

  it('分批登记不能绕过总量：首批 1 顶层 + 255 子规则成功，第二批再 2 条 too-many', () => {
    const h = harness()
    // 首批共 256 条（1 顶层 + 255 子规则）：恰好占满预算
    const first = h.pasteRules.registerRules('a.addon', batchOf('batch-1', 255))
    expect(first.ok).toBe(true)
    // 第二批 1 顶层 + 1 子规则 = 再添 2 条 → 越过 256 总量 → too-many
    //（修复前服务只数顶层 1 条，第二批被误放行 → 有效快照 258 条绕过上限）
    const second = h.pasteRules.registerRules('a.addon', batchOf('batch-2', 1))
    expect(second).toMatchObject({ ok: false, reason: 'too-many' })
    // 快照不被拒绝批次污染：仍是首批 1 条顶层规则（嵌套在槽内）
    expect(h.pasteRules.effectiveSnapshot().rules.map((rule) => rule.id)).toEqual(['batch-1'])
  })

  it('释放首批后计数回收：同组件第二批可重新登记', () => {
    const h = harness()
    const first = h.pasteRules.registerRules('a.addon', batchOf('batch-1', 255))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    first.dispose()
    // dispose 移除本批（含嵌套子规则）→ 递归计数归零 → 第二批可登记
    const second = h.pasteRules.registerRules('a.addon', batchOf('batch-2', 1))
    expect(second.ok).toBe(true)
    expect(h.pasteRules.effectiveSnapshot().rules.map((rule) => rule.id)).toEqual(['batch-2'])
  })

  it('平铺 256 条顶层后第 257 条 too-many 维持（收口不放宽平铺口径）', () => {
    const h = harness()
    const flat = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({
      id: `flat-${from + i}`,
      match: { tag: 'SPAN' },
      output: { kind: 'discard' },
    }))
    expect(h.pasteRules.registerRules('a.addon', flat(0, 256)).ok).toBe(true)
    expect(h.pasteRules.registerRules('a.addon', flat(256, 1)))
      .toMatchObject({ ok: false, reason: 'too-many' })
    // 混合口径：平铺 255 条 + 1 顶层带 1 子规则（合计 257）同样拒绝
    const h2 = harness()
    expect(h2.pasteRules.registerRules('a.addon', flat(0, 255)).ok).toBe(true)
    expect(h2.pasteRules.registerRules('a.addon', batchOf('batch-2', 1)))
      .toMatchObject({ ok: false, reason: 'too-many' })
  })
})
