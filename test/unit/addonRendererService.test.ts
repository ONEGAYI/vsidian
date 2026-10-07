// #358 T09 宿主渲染服务契约：候选替换语义、批次幂等与持久化、首选校验、
// 生效表版本稳定性（等值不递增）。
import { describe, expect, it } from 'vitest'
import { AddonRendererService, type AddonRendererPersistencePort } from '../../src/host/addons/addonRendererService'
import { BUILTIN_RENDERER_PROVIDER_ID } from '../../src/shared/addonRenderers'

interface MemoryPort extends AddonRendererPersistencePort {
  data: unknown
  writes: number
}

function memoryPort(initial: unknown = undefined): MemoryPort {
  const port: MemoryPort = {
    data: initial,
    writes: 0,
    read() {
      return port.data
    },
    async write(value) {
      port.data = value
      port.writes += 1
      return true
    },
  }
  return port
}

const available = () => true
const unavailable = () => false

function info(rendererId: string, languages: string[], opts: Partial<{ label: string; modes: string[] }> = {}) {
  return {
    rendererId,
    label: opts.label ?? `${rendererId}-label`,
    languages,
    modes: (opts.modes ?? ['live', 'reading']) as ('live' | 'reading')[],
    exportFormats: ['svg' as const],
  }
}

describe('候选登记与替换', () => {
  it('上报候选 → 表内生效；同 addonId 重复上报等值不重算不通知', () => {
    const port = memoryPort()
    const service = new AddonRendererService({ persistence: port, log: () => {} })
    let notifications = 0
    service.onChanged(() => {
      notifications += 1
    })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    const table = service.effectiveTable(available)
    expect(table.languages.find((e) => e.language === 'mermaid')?.effective).toBe('pub.a/r1')
    expect(notifications).toBe(1)
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    expect(notifications).toBe(1)
    expect(service.effectiveTable(available).version).toBe(table.version)
  })

  it('空数组上报撤销候选（代次终结）；clearProviders 同效', () => {
    const service = new AddonRendererService({ persistence: memoryPort(), log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    service.registerProviders('pub.a', [])
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')?.effective).toBe(BUILTIN_RENDERER_PROVIDER_ID)
    service.registerProviders('pub.b', [info('r1', ['draw'])])
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'draw')?.effective).toBe('pub.b/r1')
    service.clearProviders('pub.b')
    // 候选整体消失：语言不再进表（webview 回默认内置注册表口径——'draw'
    // 非内置语言即普通代码块）
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'draw')).toBeUndefined()
  })

  it('升级（同 addonId 换声明）替换候选且批次不变', () => {
    const port = memoryPort()
    const service = new AddonRendererService({ persistence: port, log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    const batchBefore = (port.data as { batches: Record<string, number> }).batches['pub.a']
    service.registerProviders('pub.a', [info('r2', ['mermaid', 'draw'])])
    const store = port.data as { batches: Record<string, number> }
    expect(store.batches['pub.a']).toBe(batchBefore)
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')?.effective).toBe('pub.a/r2')
  })
})

describe('批次幂等与持久化', () => {
  it('新组件分配批次并写持久层；无批次变化不写', () => {
    const port = memoryPort()
    const service = new AddonRendererService({ persistence: port, log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['draw'])])
    expect(port.writes).toBe(1)
    service.registerProviders('pub.a', [info('r1', ['draw'])])
    expect(port.writes).toBe(1)
    service.registerProviders('pub.b', [info('r1', ['draw'])])
    expect(port.writes).toBe(2)
    const store = port.data as { batches: Record<string, number>; nextBatch: number }
    expect(store.batches).toEqual({ 'pub.a': 1, 'pub.b': 2 })
    expect(store.nextBatch).toBe(3)
  })

  it('重启恢复（同持久层数据新实例）：既有批次不改写、既有首选生效', () => {
    const port = memoryPort()
    let service = new AddonRendererService({ persistence: port, log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    service.setPreferred('mermaid', BUILTIN_RENDERER_PROVIDER_ID)
    // 新会话：同 store 新实例（重启/跨窗口）
    service = new AddonRendererService({ persistence: port, log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    const store = port.data as { batches: Record<string, number>; writes?: number }
    expect(port.writes).toBe(2) // 首选写一次；新会话批次命中不写
    expect(store.batches['pub.a']).toBe(1)
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: BUILTIN_RENDERER_PROVIDER_ID,
      source: 'user',
    })
  })

  it('候选不可用（停用/故障谓词）→ 内置接管；候选恢复 → 自动接管回来（首选保留场景）', () => {
    const service = new AddonRendererService({ persistence: memoryPort(), log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid', 'draw'])])
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')?.effective).toBe('pub.a/r1')
    const down = service.effectiveTable(unavailable)
    expect(down.languages.find((e) => e.language === 'mermaid')?.effective).toBe(BUILTIN_RENDERER_PROVIDER_ID)
    expect(down.languages.find((e) => e.language === 'draw')?.effective).toBe('none')
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')?.effective).toBe('pub.a/r1')
  })
})

describe('用户首选', () => {
  it('已知候选可设；未知提供者拒绝；内置仅对内置语言可选', () => {
    const service = new AddonRendererService({ persistence: memoryPort(), log: () => {} })
    service.registerProviders('pub.a', [info('alpha', ['draw']), info('beta', ['draw'])])
    expect(service.setPreferred('draw', 'pub.a/alpha')).toBe('ok')
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'draw')).toMatchObject({
      effective: 'pub.a/alpha',
      source: 'user',
    })
    expect(service.setPreferred('draw', 'pub.unknown/r9')).toBe('unknown-provider')
    // draw 非内置图形语言：选内置不可执行——拒绝
    expect(service.setPreferred('draw', BUILTIN_RENDERER_PROVIDER_ID)).toBe('unknown-provider')
    // mermaid 内置语言：候选接管后改回内置可选
    service.registerProviders('pub.a', [info('alpha', ['draw']), info('beta', ['draw']), info('mmd', ['mermaid'])])
    expect(service.setPreferred('mermaid', BUILTIN_RENDERER_PROVIDER_ID)).toBe('ok')
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'mermaid')).toMatchObject({
      effective: BUILTIN_RENDERER_PROVIDER_ID,
      source: 'user',
    })
  })

  it('首选不可用时表回默认序、store 首选保留；清除首选回默认序', () => {
    const service = new AddonRendererService({ persistence: memoryPort(), log: () => {} })
    service.registerProviders('pub.a', [info('alpha', ['draw']), info('beta', ['draw'])])
    service.setPreferred('draw', 'pub.a/alpha')
    expect(service.snapshot(available).store.preferred['draw']).toBe('pub.a/alpha')
    // alpha 所在组件整体不可用 → draw 非内置语言，无可用候选 → none
    const table = service.effectiveTable((addonId) => addonId !== 'pub.a')
    expect(table.languages.find((e) => e.language === 'draw')?.effective).toBe('none')
    expect(service.snapshot(available).store.preferred['draw']).toBe('pub.a/alpha')
    expect(service.setPreferred('draw', null)).toBe('ok')
    expect(service.effectiveTable(available).languages.find((e) => e.language === 'draw')).toMatchObject({
      effective: 'pub.a/beta',
      source: 'auto',
    })
  })
})

describe('生效表版本稳定', () => {
  it('同可用性重复求值：同版本同引用；可用性或内容变化递增版本', () => {
    const service = new AddonRendererService({ persistence: memoryPort(), log: () => {} })
    service.registerProviders('pub.a', [info('r1', ['mermaid'])])
    const t1 = service.effectiveTable(available)
    expect(service.effectiveTable(available)).toBe(t1)
    const t2 = service.effectiveTable(unavailable)
    expect(t2.version).toBe(t1.version + 1)
    const t3 = service.effectiveTable(unavailable)
    expect(t3).toBe(t2)
  })
})
