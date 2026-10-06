// #350 T01 附加组件身份声明契约：私有顶层字段 vsidianAddon 的解析与
// 校验、API 范围兼容判定（首个候选版本 1.0.0 语义）、官方清单归属。
// 规则事实源：docs/design/vsidian-addon-api.md 第 2 节（草案形状，
// 不冒充已发布稳定 API）。
import { describe, expect, it } from 'vitest'
import {
  ADDON_API_VERSION,
  ADDON_IDENTITY_MANIFEST_VERSION,
  ADDON_MANIFEST_FIELD,
  OFFICIAL_ADDON_EXTENSION_IDS,
  checkAddonCompatibility,
  isOfficialAddon,
  parseAddonDeclaration,
  satisfiesSemverRange,
} from '../../src/shared/addonIdentity'

describe('附加组件身份声明解析', () => {
  it('无 vsidianAddon 字段的普通扩展解析为 none（不入组件列表）', () => {
    expect(parseAddonDeclaration(undefined)).toEqual({ kind: 'none' })
    expect(parseAddonDeclaration(null)).toEqual({ kind: 'none' })
    expect(parseAddonDeclaration({ name: 'x' })).toEqual({ kind: 'none' })
    expect(parseAddonDeclaration({ vsidianAddon: undefined })).toEqual({ kind: 'none' })
  })

  it('合法声明（manifestVersion 1 + api 范围）解析成功', () => {
    const result = parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0' },
    })
    expect(result).toEqual({
      kind: 'ok',
      declaration: { manifestVersion: 1, api: '^1.0.0' },
    })
  })

  it('experimental 声明随声明保留（确有使用时才声明）', () => {
    const result = parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^0.1.0' } },
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.declaration.experimental).toEqual({ cm6: '^0.1.0' })
    }
  })

  it('字段非对象 / manifestVersion 不支持 / api 非法各有明确拒绝原因', () => {
    expect(parseAddonDeclaration({ vsidianAddon: 'vsidian' })).toEqual({
      kind: 'invalid', reason: 'field-not-object',
    })
    expect(parseAddonDeclaration({ vsidianAddon: [] })).toEqual({
      kind: 'invalid', reason: 'field-not-object',
    })
    expect(parseAddonDeclaration({ vsidianAddon: { manifestVersion: 2, api: '^1.0.0' } })).toEqual({
      kind: 'invalid', reason: 'manifest-version-unsupported',
    })
    expect(parseAddonDeclaration({ vsidianAddon: { manifestVersion: 1 } })).toEqual({
      kind: 'invalid', reason: 'api-invalid',
    })
    expect(parseAddonDeclaration({ vsidianAddon: { manifestVersion: 1, api: 'not a range!!' } })).toEqual({
      kind: 'invalid', reason: 'api-invalid',
    })
    expect(parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: 'cm6' },
    })).toEqual({ kind: 'invalid', reason: 'experimental-invalid' })
    expect(parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: 42 } },
    })).toEqual({ kind: 'invalid', reason: 'experimental-invalid' })
  })

  it('常量：字段名与首个候选 API 版本（^1.0.0 语义基准）', () => {
    expect(ADDON_MANIFEST_FIELD).toBe('vsidianAddon')
    expect(ADDON_IDENTITY_MANIFEST_VERSION).toBe(1)
    // 首个候选稳定 API 版本为 1.0.0（草案，尚未发布——不能冒充已发布契约）
    expect(ADDON_API_VERSION).toBe('1.0.0')
    // 官方组件清单：主仓库维护的明确扩展 ID 清单，初版为空（占位结构）
    expect(OFFICIAL_ADDON_EXTENSION_IDS).toEqual([])
    expect(isOfficialAddon('anything.else')).toBe(false)
  })
})

describe('semver 范围子集求值', () => {
  it.each([
    ['^1.0.0', '1.0.0', true],
    ['^1.0.0', '1.9.9', true],
    ['^1.0.0', '2.0.0', false],
    ['^1.0.0', '0.9.0', false],
    ['^1.2.3', '1.2.3', true],
    ['^1.2.3', '1.3.0', true],
    ['^1.2.3', '1.2.2', false],
    ['~1.2.3', '1.2.9', true],
    ['~1.2.3', '1.3.0', false],
    ['1.0.0', '1.0.0', true],
    ['=1.0.0', '1.0.0', true],
    ['1.0.0', '1.0.1', false],
    ['>=1.0.0', '1.0.0', true],
    ['>=1.0.0', '2.0.0', true],
    ['>1.0.0', '1.0.0', false],
    ['>1.0.0', '1.0.1', true],
    ['<=1.5.0', '1.5.0', true],
    ['<=1.5.0', '1.5.1', false],
    ['<2.0.0', '1.9.9', true],
    ['<2.0.0', '2.0.0', false],
    ['*', '0.0.1', true],
    ['*', '99.0.0', true],
    // 空格分隔的 AND 组合
    ['>=1.0.0 <2.0.0', '1.5.0', true],
    ['>=1.0.0 <2.0.0', '2.0.0', false],
    // 宽松版本段（缺段补 0）
    ['^1', '1.4.0', true],
    ['^1', '2.0.0', false],
    // 非法输入一律 false（不抛出）
    ['', '1.0.0', false],
    ['not a range!!', '1.0.0', false],
    ['^1.0.0', 'banana', false],
    ['^1.0.0', '', false],
  ])('satisfiesSemverRange(%j, %j) === %s', (range, version, expected) => {
    expect(satisfiesSemverRange(range, version)).toBe(expected)
  })
})

describe('兼容判定', () => {
  const host = { apiVersion: ADDON_API_VERSION, experimental: {} }

  it('声明范围含宿主 API 版本即兼容', () => {
    const parsed = parseAddonDeclaration({ vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } })
    expect(parsed.kind).toBe('ok')
    if (parsed.kind === 'ok') {
      expect(checkAddonCompatibility(parsed.declaration, host)).toEqual({ compatible: true })
    }
  })

  it('合法声明但范围不含宿主版本判不兼容（api-range）', () => {
    const parsed = parseAddonDeclaration({ vsidianAddon: { manifestVersion: 1, api: '^2.0.0' } })
    expect(parsed.kind).toBe('ok')
    if (parsed.kind === 'ok') {
      expect(checkAddonCompatibility(parsed.declaration, host)).toEqual({
        compatible: false, reason: 'api-range',
      })
    }
  })

  it('宿主未发布的实验入口：声明 experimental 一律拒绝（experimental-unsupported）', () => {
    const parsed = parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^0.1.0' } },
    })
    expect(parsed.kind).toBe('ok')
    if (parsed.kind === 'ok') {
      expect(checkAddonCompatibility(parsed.declaration, host)).toEqual({
        compatible: false, reason: 'experimental-unsupported', entry: 'cm6',
      })
    }
  })

  it('宿主支持的实验入口版本不满足时拒绝（experimental-incompatible）', () => {
    const parsed = parseAddonDeclaration({
      vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^9.0.0' } },
    })
    expect(parsed.kind).toBe('ok')
    if (parsed.kind === 'ok') {
      expect(
        checkAddonCompatibility(parsed.declaration, { apiVersion: ADDON_API_VERSION, experimental: { cm6: '^0.1.0' } }),
      ).toEqual({ compatible: false, reason: 'experimental-incompatible', entry: 'cm6' })
    }
  })
})
