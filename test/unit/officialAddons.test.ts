// #354 T05 官方（核心）附加组件清单形态契约：清单是主仓库维护的结构化
// 登记表（可维护形态），官方归属判定只认该表——组件自称官方（keywords、
// 声明内自称、displayName 措辞）一律不生效。
import { describe, it, expect } from 'vitest'
import {
  OFFICIAL_ADDON_REGISTRY,
  OFFICIAL_ADDON_EXTENSION_IDS,
  type OfficialAddonEntry,
  isOfficialAddon,
} from '../../src/shared/addonIdentity'
import { parseAddonDeclaration } from '../../src/shared/addonIdentity'

describe('官方清单形态（可维护登记表）', () => {
  it('登记表条目形状完整：extensionId 非空且 publisher.name 形态', () => {
    for (const entry of OFFICIAL_ADDON_REGISTRY) {
      expect(typeof entry.extensionId).toBe('string')
      expect(entry.extensionId.length).toBeGreaterThan(0)
      expect(entry.extensionId).toMatch(/^[^.]+\.[^.]+$/)
    }
  })

  it('登记表无重复 extensionId（重复登记是维护事故）', () => {
    const ids = OFFICIAL_ADDON_EXTENSION_IDS
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('登记表已登记官方输入增强组件 vsidian-easy-typing（#463 首个登记）', () => {
    // extensionId 大小写须与 easy-typing 扩展 package.json 的 publisher.name
    // 声明完全一致（判定为严格相等，大小写敏感）
    expect(OFFICIAL_ADDON_EXTENSION_IDS).toContain('ONEGAYI.vsidian-easy-typing')
  })

  it('默认登记表判定：登记 ID 判官方（严格相等，大小写敏感）', () => {
    expect(isOfficialAddon('ONEGAYI.vsidian-easy-typing')).toBe(true)
    // 判定实现是 ===：大小写漂移的 ID 不判官方（登记形态即运行时形态）
    expect(isOfficialAddon('onegayi.vsidian-easy-typing')).toBe(false)
  })

  it('表内 ID 判官方、表外 ID 不判（判定唯一入口 isOfficialAddon）', () => {
    const registry: readonly OfficialAddonEntry[] = [
      { extensionId: 'onegayi.vsidian-official-demo' },
    ]
    expect(isOfficialAddon('onegayi.vsidian-official-demo', registry)).toBe(true)
    expect(isOfficialAddon('onegayi.vsidian', registry)).toBe(false)
    expect(isOfficialAddon('unknown.anything', registry)).toBe(false)
  })
})

describe('不信任自称官方', () => {
  it('声明字段里自称官方不产生官方归属（身份声明只含版本与 API 范围）', () => {
    const parsed = parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0' },
    })
    expect(parsed.kind).toBe('ok')
    // 声明形状中没有 official/core 一类字段——判官方只能查清单
    expect(Object.keys((parsed as { declaration: object }).declaration).sort())
      .toEqual(['api', 'manifestVersion'])
  })

  it('keywords 含官方措辞的扩展仍按清单判第三方', () => {
    const registry: readonly OfficialAddonEntry[] = []
    const extensionId = 'third-party.fancy-notes'
    expect(isOfficialAddon(extensionId, registry)).toBe(false)
    // keywords 只是市场搜索辅助（addonIdentity 头注口径），不参与归属判定
    const parsed = parseAddonDeclaration({
      displayName: 'Fancy Notes',
      keywords: ['vsidian-addon', 'official', 'core'],
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0' },
    })
    expect(parsed.kind).toBe('ok')
  })
})
