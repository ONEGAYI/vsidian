// #546 T07 宿主主题目录服务契约：登记校验与批内重复拒绝、按组件整组
// 替换与回收、目录版本稳定性（等值不递增）、主题提供者排除表导出
//（TDD 先立预期）。规则来源：docs/specs/addon-themes.md §3.1/§3.2。
import { describe, expect, it } from 'vitest'
import { AddonThemeService } from '../../src/host/addons/addonThemeService'
import { isAddonThemesStatePayload, themedProviderIdsOf, type AddonThemeDeclaration } from '../../src/shared/addonThemes'

function declaration(opts: Partial<AddonThemeDeclaration> = {}): AddonThemeDeclaration {
  return {
    themeId: 'aqua',
    label: { 'zh-cn': '水青', en: 'Aqua' },
    rendererId: 'aqua-renderer',
    languages: ['mermaid'],
    ...opts,
  }
}

describe('登记与校验（普通 API 结果）', () => {
  it('合法声明登记进目录', () => {
    const service = new AddonThemeService({ log: () => {} })
    const result = service.register('pub.pack', [declaration()])
    expect(result.ok).toBe(true)
    expect(service.catalog()).toEqual([
      expect.objectContaining({ addonId: 'pub.pack', themeRef: 'pub.pack/aqua', providerId: 'pub.pack/aqua-renderer' }),
    ])
  })

  it('任一条目形状非法：整批拒绝 invalid-theme，目录不变', () => {
    const service = new AddonThemeService({ log: () => {} })
    const result = service.register('pub.pack', [declaration(), { themeId: 'bad' }])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid-theme')
    expect(typeof result.dispose).toBe('function')
    expect(service.catalog()).toEqual([])
  })

  it('同批 themeId 重复拒绝；不同主题支持同一语言可登记', () => {
    const service = new AddonThemeService({ log: () => {} })
    const first = service.register('pub.pack', [declaration(), declaration({ rendererId: 'other' })])
    expect(first.ok).toBe(false)
    expect(first.ok === false && first.reason).toBe('duplicate-theme')
    const second = service.register('pub.pack', [
      declaration({ themeId: 'a', rendererId: 'ra' }),
      declaration({ themeId: 'b', rendererId: 'rb' }),
    ])
    expect(second.ok).toBe(true)
  })
})

describe('整组替换、回收与幂等', () => {
  it('未安装主题时空目录载荷仍可经消息桥回显内置首选', () => {
    const service = new AddonThemeService({ log: () => {} })
    expect(isAddonThemesStatePayload({ version: service.version(), themes: service.catalog(), preferred: 'codex', preferredAvailable: true })).toBe(true)
  })

  it('旧注册句柄释放不撤销随后替换的目录', () => {
    const service = new AddonThemeService({ log: () => {} })
    const old = service.register('pub.pack', [declaration()])
    service.register('pub.pack', [declaration({ themeId: 'solar' })])
    old.dispose()
    expect(service.catalog().map((theme) => theme.themeId)).toEqual(['solar'])
  })
  it('同组件重复注册整组替换（升级换主题集）；不同组件互不影响', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    service.register('pub.pack', [declaration({ themeId: 'solar', rendererId: 'solar-renderer', languages: ['plantuml'] })])
    service.register('pub.other', [declaration()])
    const refs = service.catalog().map((t) => t.themeRef).sort()
    expect(refs).toEqual(['pub.other/aqua', 'pub.pack/solar'])
  })

  it('releaseAddon 回收该组件目录；未注册组件回收无副作用', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.releaseAddon('pub.pack')
    service.releaseAddon('pub.pack')
    expect(service.catalog()).toEqual([])
    expect(changes).toBe(1)
  })

  it('等值重复注册不递增版本不通知；内容变化才递增', () => {
    const service = new AddonThemeService({ log: () => {} })
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.register('pub.pack', [declaration()])
    expect(service.version()).toBe(1)
    expect(changes).toBe(1)
    service.register('pub.pack', [declaration()])
    expect(service.version()).toBe(1)
    expect(changes).toBe(1)
    service.register('pub.pack', [declaration({ label: { en: 'Aqua 2' } })])
    expect(service.version()).toBe(2)
    expect(changes).toBe(2)
  })

  it('空数组注册 = 该组件目录整体撤销（等价回收，经通知）', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.register('pub.pack', [])
    expect(service.catalog()).toEqual([])
    expect(changes).toBe(1)
  })
})

describe('themedProviderIds（渲染选择排除表）', () => {
  it('撤销主题登记不会让页面残留提供者变成普通自动接管；组件代次结束再回收分类', () => {
    const service = new AddonThemeService({ log: () => {} })
    const handle = service.register('pub.pack', [declaration()])
    handle.dispose()
    expect(service.catalog()).toEqual([])
    expect([...service.themedProviderIds()]).toEqual(['pub.pack/aqua-renderer'])
    service.releaseAddon('pub.pack')
    expect([...service.themedProviderIds()]).toEqual([])
  })
  it('目录全集提供者 ID（多组件合并）', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.a', [declaration({ rendererId: 'ra' })])
    service.register('pub.b', [declaration({ themeId: 'solar', rendererId: 'rb' })])
    expect([...service.themedProviderIds()].sort()).toEqual(['pub.a/ra', 'pub.b/rb'])
    // 与纯逻辑同源
    expect([...service.themedProviderIds()].sort()).toEqual([...themedProviderIdsOf(service.catalog())].sort())
    service.releaseAddon('pub.a')
    expect([...service.themedProviderIds()].sort()).toEqual(['pub.b/rb'])
  })
})

describe('注册面句柄（enable 生命周期）', () => {
  it('register 返回 dispose：撤销单次注册的贡献（组件目录整体回收）', () => {
    const service = new AddonThemeService({ log: () => {} })
    const handle = service.register('pub.pack', [declaration()])
    expect(handle.ok).toBe(true)
    handle.dispose()
    expect(service.catalog()).toEqual([])
    // 重复 dispose 无害
    handle.dispose()
    expect(service.catalog()).toEqual([])
  })
})
