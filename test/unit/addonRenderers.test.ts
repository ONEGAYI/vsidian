// #358 T09 附加组件渲染提供者契约——候选选择/发现批次/存储的纯逻辑
// 单一事实源测试（TDD 先立预期再实现）。规则来源：
// - 技术方案 5.3（docs/design/vsidian-addon-api.md）：同批候选按稳定 ID
//   升序依次接管、最后一个可用候选生效，后续新增批次优先；内置实现作为
//   候选保留；重启/重复注册/普通升级不覆盖既有首选。
// - ADR-0012 Q28/Q30：新安装自动替换（含内置 Mermaid）；正常停用与整组件
//   故障降级停用后内置接管（首选保留）；仍运行渲染 bug 不自动接管。
import { describe, expect, it } from 'vitest'
import {
  ADDON_RENDERERS_STORE_VERSION,
  BUILTIN_RENDERER_PROVIDER_ID,
  assignDiscoveryBatches,
  isAddonRendererProviderInfo,
  normalizeRendererLanguage,
  parseAddonRendererStore,
  selectEffectiveRenderers,
  type AddonRendererCandidate,
} from '../../src/shared/addonRenderers'

function candidate(addonId: string, rendererId: string, languages: string[], opts: Partial<AddonRendererCandidate> = {}): AddonRendererCandidate {
  return {
    addonId,
    rendererId,
    providerId: `${addonId}/${rendererId}`,
    label: `${addonId} ${rendererId}`,
    languages,
    modes: ['live', 'reading'],
    exportFormats: ['svg', 'png'],
    ...opts,
  }
}

const alwaysAvailable = () => true
const neverAvailable = () => false

describe('语言规范化', () => {
  it('trim 后全等匹配（大小写敏感，与 RENDERED_FENCE_LABELS 同口径）', () => {
    expect(normalizeRendererLanguage('  mermaid ')).toBe('mermaid')
    expect(normalizeRendererLanguage('Mermaid')).toBe('Mermaid')
    expect(normalizeRendererLanguage('mermaid x')).toBe('mermaid x')
  })
})

describe('确定性默认序（无用户首选）', () => {
  it('无候选时内置语言生效内置、其余语言无生效提供者', () => {
    const table = selectEffectiveRenderers({
      candidates: [],
      isAvailable: alwaysAvailable,
      builtinLanguages: ['mermaid'],
      preferred: {},
      batches: {},
    })
    expect(table.languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: BUILTIN_RENDERER_PROVIDER_ID,
      source: 'auto',
    })
    // 未被任何候选声明的语言不进表
    expect(table.languages).toHaveLength(1)
  })

  it('新安装组件自动接管内置语言（含 Mermaid）与普通语言', () => {
    const c = candidate('pub.a', 'r1', ['mermaid', 'draw'])
    const table = selectEffectiveRenderers({
      candidates: [c],
      isAvailable: alwaysAvailable,
      builtinLanguages: ['mermaid'],
      preferred: {},
      batches: { 'pub.a': 1 },
    })
    expect(table.languages.find((e) => e.language === 'mermaid')?.effective).toBe('pub.a/r1')
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('pub.a/r1')
  })

  it('同批多候选：稳定 ID 升序依次接管、末位生效', () => {
    const alpha = candidate('pub.a', 'alpha', ['draw'])
    const beta = candidate('pub.a', 'beta', ['draw'])
    const table = selectEffectiveRenderers({
      candidates: [beta, alpha],
      isAvailable: alwaysAvailable,
      builtinLanguages: [],
      preferred: {},
      batches: { 'pub.a': 1 },
    })
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('pub.a/beta')
  })

  it('后续新增批次优先于旧批次（覆盖旧生效者）', () => {
    const older = candidate('pub.old', 'r', ['draw'])
    const newer = candidate('pub.new', 'r', ['draw'])
    const table = selectEffectiveRenderers({
      candidates: [older, newer],
      isAvailable: alwaysAvailable,
      builtinLanguages: [],
      preferred: {},
      batches: { 'pub.old': 1, 'pub.new': 2 },
    })
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('pub.new/r')
  })

  it('候选不可用（停用/故障）不参与接管：内置语言回内置、其余语言无提供者', () => {
    const c = candidate('pub.a', 'r1', ['mermaid', 'draw'])
    const table = selectEffectiveRenderers({
      candidates: [c],
      isAvailable: neverAvailable,
      builtinLanguages: ['mermaid'],
      preferred: {},
      batches: { 'pub.a': 1 },
    })
    expect(table.languages.find((e) => e.language === 'mermaid')?.effective).toBe(BUILTIN_RENDERER_PROVIDER_ID)
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('none')
  })

  it('同批部分候选不可用：在可用候选内取末位', () => {
    const alpha = candidate('pub.a', 'alpha', ['draw'])
    const beta = candidate('pub.b', 'beta', ['draw'])
    const table = selectEffectiveRenderers({
      candidates: [alpha, beta],
      isAvailable: (c) => c.providerId !== 'pub.b/beta',
      builtinLanguages: [],
      preferred: {},
      batches: { 'pub.a': 1, 'pub.b': 1 },
    })
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('pub.a/alpha')
  })
})

describe('用户首选与恢复', () => {
  it('用户首选可用时优先于默认序', () => {
    const alpha = candidate('pub.a', 'alpha', ['draw'])
    const beta = candidate('pub.b', 'beta', ['draw'])
    const table = selectEffectiveRenderers({
      candidates: [alpha, beta],
      isAvailable: alwaysAvailable,
      builtinLanguages: [],
      preferred: { draw: 'pub.a/alpha' },
      batches: { 'pub.a': 1, 'pub.b': 1 },
    })
    expect(table.languages.find((e) => e.language === 'draw')).toMatchObject({ effective: 'pub.a/alpha', source: 'user' })
  })

  it('用户改回内置：内置语言生效内置', () => {
    const c = candidate('pub.a', 'r1', ['mermaid'])
    const table = selectEffectiveRenderers({
      candidates: [c],
      isAvailable: alwaysAvailable,
      builtinLanguages: ['mermaid'],
      preferred: { mermaid: BUILTIN_RENDERER_PROVIDER_ID },
      batches: { 'pub.a': 1 },
    })
    expect(table.languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: BUILTIN_RENDERER_PROVIDER_ID,
      source: 'user',
    })
  })

  it('Q30：首选组件不可用时内置接管，但表不删除首选标记（恢复后按原选择）', () => {
    const c = candidate('pub.a', 'r1', ['mermaid'])
    const build = (available: boolean) =>
      selectEffectiveRenderers({
        candidates: [c],
        isAvailable: available ? alwaysAvailable : neverAvailable,
        builtinLanguages: ['mermaid'],
        preferred: { mermaid: 'pub.a/r1' },
        batches: { 'pub.a': 1 },
      })
    const down = build(false)
    expect(down.languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: BUILTIN_RENDERER_PROVIDER_ID,
      source: 'auto',
    })
    const back = build(true)
    expect(back.languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: 'pub.a/r1',
      source: 'user',
    })
  })

  it('首选指向未知提供者：按默认序回退（不因残留首选卡死）', () => {
    const c = candidate('pub.a', 'r1', ['draw'])
    const table = selectEffectiveRenderers({
      candidates: [c],
      isAvailable: alwaysAvailable,
      builtinLanguages: [],
      preferred: { draw: 'pub.gone/r9' },
      batches: { 'pub.a': 1 },
    })
    expect(table.languages.find((e) => e.language === 'draw')).toMatchObject({ effective: 'pub.a/r1', source: 'auto' })
  })
})

describe('发现批次存储', () => {
  it('新组件分配递增批次；已记录组件幂等不改写', () => {
    const store = parseAddonRendererStore(undefined)
    const first = assignDiscoveryBatches(store, ['pub.a'])
    expect(first.store.batches['pub.a']).toBe(1)
    expect(first.store.nextBatch).toBe(2)
    expect(first.changed).toBe(true)
    const again = assignDiscoveryBatches(first.store, ['pub.a', 'pub.b'])
    expect(again.store.batches['pub.a']).toBe(1)
    expect(again.store.batches['pub.b']).toBe(2)
    expect(again.changed).toBe(true)
    const idempotent = assignDiscoveryBatches(again.store, ['pub.a', 'pub.b'])
    expect(idempotent.changed).toBe(false)
    expect(idempotent.store).toBe(again.store)
  })

  it('重复注册/重启/升级（同一 addonId 再分配）不产生新批次', () => {
    let store = parseAddonRendererStore(undefined)
    store = assignDiscoveryBatches(store, ['pub.a']).store
    const before = store.batches['pub.a']
    // 升级后重新报告（另一会话同 store）
    store = assignDiscoveryBatches(store, ['pub.a']).store
    expect(store.batches['pub.a']).toBe(before)
  })

  it('非法持久化内容 fail-safe 回默认（不抛错）', () => {
    expect(parseAddonRendererStore(undefined).version).toBe(ADDON_RENDERERS_STORE_VERSION)
    expect(parseAddonRendererStore(null).batches).toEqual({})
    expect(parseAddonRendererStore({ version: 99 }).batches).toEqual({})
    expect(parseAddonRendererStore({ version: 1, batches: { a: 'x' }, nextBatch: 'bad', preferred: 3 }).batches).toEqual({})
  })

  it('合法载荷原样读出', () => {
    const data = {
      version: 1,
      batches: { 'pub.a': 2 },
      nextBatch: 3,
      preferred: { draw: 'pub.a/r1', mermaid: 'builtin' },
    }
    expect(parseAddonRendererStore(data)).toEqual(data)
  })
})

describe('#395 P3 提供者声明封顶（isAddonRendererProviderInfo）', () => {
  const base = {
    rendererId: 'r1',
    modes: ['live', 'reading'],
    exportFormats: ['svg'],
  }
  const legal = {
    ...base,
    label: 'a'.repeat(256),
    languages: Array.from({ length: 32 }, (_, i) => `lang${i}${'x'.repeat(58)}`),
  }

  it('合法边界通过：label 256、languages 32 项且单项不超过 64 字符', () => {
    expect(isAddonRendererProviderInfo(legal)).toBe(true)
  })

  it('label 超 256 拒绝（注册与宿主上报同走此守卫）', () => {
    expect(isAddonRendererProviderInfo({ ...legal, label: 'a'.repeat(257) })).toBe(false)
  })

  it('languages 超 32 项拒绝；单项超 64 字符拒绝', () => {
    expect(
      isAddonRendererProviderInfo({ ...legal, languages: Array.from({ length: 33 }, (_, i) => `lang${i}`) }),
    ).toBe(false)
    expect(isAddonRendererProviderInfo({ ...legal, languages: ['a'.repeat(65)] })).toBe(false)
  })
})
