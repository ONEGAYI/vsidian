// #353 T04 附加组件复杂设置——共享纯逻辑契约测试（定义形状校验矩阵、
// 值校验、作用范围解析、存储结构与迁移）。
//
// 钉住票面规则：
// - 定义可序列化：JSON 普通值、有限数、数组项和对象字段由定义说明，
//   不存在函数校验器形态；形状非法整批拒绝（矩阵）。
// - 一层结构：数组项与对象字段都是标量（boolean/number/string），
//   不允许嵌套数组/对象——内置标量类型不得靠断言伪装成复杂值
//  （独立类型命名空间，与内置 SettingDefinition 分离）。
// - 作用范围解析：工作区显式 > 用户默认显式 > 出厂默认；显式值非法
//  （定义升级后存量漂移）跳过该层继续下层，不从存储删除。
// - 存储结构冻结 version 1：未知 version/坏形态 fail-safe 回空（不写回、
//   不删除用户数据）；值形态守卫拒绝 undefined/函数/null。
import { describe, expect, it } from 'vitest'
import {
  ADDON_SETTINGS_STORE_VERSION,
  isAddonSettingDefinition,
  addonSettingValueMatches,
  resolveAddonSettingLayer,
  composeObjectDefault,
  parseAddonSettingsStore,
  serializeAddonSettingsStore,
  isAddonSettingStoredValue,
  type AddonSettingDefinition,
} from '../../src/shared/addonSettings'

// ---- 定义形状校验矩阵 ----

describe('T04 设置定义形状校验（isAddonSettingDefinition）', () => {
  it('标量三型合法：boolean / number(min,max) / string(enum|maxLength)', () => {
    expect(isAddonSettingDefinition({ key: 'flag', title: '开关', type: 'boolean', default: true })).toBe(true)
    expect(isAddonSettingDefinition({ key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 })).toBe(true)
    expect(isAddonSettingDefinition({ key: 'mode', title: '模式', type: 'string', enum: ['a', 'b'], default: 'a' })).toBe(true)
    expect(isAddonSettingDefinition({ key: 'label', title: '标签', type: 'string', maxLength: 30, default: 'demo' })).toBe(true)
    // number 无界（省略 min/max）：值仍须有限数
    expect(isAddonSettingDefinition({ key: 'ratio', title: '比例', type: 'number', default: 0.5 })).toBe(true)
  })

  it('数组与对象定义合法（重复项/字段控件的数据源）', () => {
    expect(isAddonSettingDefinition({
      key: 'replacements', title: '替换规则', type: 'array',
      items: { kind: 'string', maxLength: 40 }, default: ['旧→新'],
    })).toBe(true)
    expect(isAddonSettingDefinition({
      key: 'limits', title: '对象样例', type: 'object',
      fields: [
        { key: 'name', title: '名称', kind: 'string', maxLength: 20, default: 'demo' },
        { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
      ],
      default: { name: 'demo', count: 3 },
    })).toBe(true)
    // 对象 default 可省略：缺省按字段 default 组装
    expect(isAddonSettingDefinition({
      key: 'limits2', title: '对象样例二', type: 'object',
      fields: [{ key: 'name', title: '名称', kind: 'string', maxLength: 20, default: 'demo' }],
    })).toBe(true)
    // 数量约束（有限数、min ≤ max）
    expect(isAddonSettingDefinition({
      key: 'list', title: '列表', type: 'array', items: { kind: 'number' },
      default: [1, 2], minItems: 1, maxItems: 5,
    })).toBe(true)
  })

  it('基础字段非法：非对象、缺 key/title、空 key、缺 default、未知 type', () => {
    expect(isAddonSettingDefinition(null)).toBe(false)
    expect(isAddonSettingDefinition('flag')).toBe(false)
    expect(isAddonSettingDefinition({ type: 'boolean', default: true })).toBe(false)
    expect(isAddonSettingDefinition({ key: '', title: '空键', type: 'boolean', default: true })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: 123, type: 'boolean', default: true })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '无默认', type: 'boolean' })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '未知类型', type: 'color', default: '#fff' })).toBe(false)
  })

  it('default 与约束自洽：类型不符 / 超界 / enum 外 / 超长均拒绝', () => {
    expect(isAddonSettingDefinition({ key: 'x', title: '错型', type: 'boolean', default: 1 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '超下界', type: 'number', min: 1, max: 10, default: 0 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '超上界', type: 'number', min: 1, max: 10, default: 11 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: 'enum 外', type: 'string', enum: ['a', 'b'], default: 'c' })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '超长', type: 'string', maxLength: 3, default: 'abcd' })).toBe(false)
    // 约束自身非法：min > max、空 enum、重复 enum、maxLength 非正整数
    expect(isAddonSettingDefinition({ key: 'x', title: '倒置', type: 'number', min: 10, max: 1, default: 5 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '空枚举', type: 'string', enum: [], default: 'a' })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '重复枚举', type: 'string', enum: ['a', 'a'], default: 'a' })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '零上限', type: 'string', maxLength: 0, default: 'a' })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '负上限', type: 'string', maxLength: -3, default: 'a' })).toBe(false)
    // default 非有限数
    expect(isAddonSettingDefinition({ key: 'x', title: 'NaN', type: 'number', default: Number.NaN })).toBe(false)
  })

  it('数组定义非法矩阵：缺 items、default 非数组、项非法、长度越界', () => {
    expect(isAddonSettingDefinition({ key: 'x', title: '缺项约束', type: 'array', default: [] })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '默认非数组', type: 'array', items: { kind: 'number' }, default: 3 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '默认项超界', type: 'array', items: { kind: 'number', min: 0, max: 5 }, default: [1, 9] })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '默认长度越下界', type: 'array', items: { kind: 'number' }, default: [], minItems: 1 })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '默认长度越上界', type: 'array', items: { kind: 'number' }, default: [1, 2, 3], maxItems: 2 })).toBe(false)
    // items 不允许嵌套数组/对象（一层结构硬边界）
    expect(isAddonSettingDefinition({ key: 'x', title: '嵌套数组', type: 'array', items: { kind: 'array' as never }, default: [] })).toBe(false)
  })

  it('对象定义非法矩阵：缺 fields、空 fields、字段键重复、字段 default 非法、default 字段集不匹配', () => {
    expect(isAddonSettingDefinition({ key: 'x', title: '缺字段表', type: 'object', default: {} })).toBe(false)
    expect(isAddonSettingDefinition({ key: 'x', title: '空字段表', type: 'object', fields: [], default: {} })).toBe(false)
    expect(isAddonSettingDefinition({
      key: 'x', title: '重复字段', type: 'object',
      fields: [
        { key: 'a', title: '甲', kind: 'boolean', default: true },
        { key: 'a', title: '乙', kind: 'boolean', default: false },
      ],
    })).toBe(false)
    expect(isAddonSettingDefinition({
      key: 'x', title: '字段默认非法', type: 'object',
      fields: [{ key: 'a', title: '甲', kind: 'number', min: 0, max: 5, default: 9 }],
    })).toBe(false)
    // 显式对象 default 恰好覆盖字段集：多余/缺失均拒绝
    expect(isAddonSettingDefinition({
      key: 'x', title: '多余字段', type: 'object',
      fields: [{ key: 'a', title: '甲', kind: 'boolean', default: true }],
      default: { a: true, b: 1 },
    })).toBe(false)
    expect(isAddonSettingDefinition({
      key: 'x', title: '缺失字段', type: 'object',
      fields: [{ key: 'a', title: '甲', kind: 'boolean', default: true }],
      default: {},
    })).toBe(false)
    // 字段不允许嵌套结构（kind 只收标量三型）
    expect(isAddonSettingDefinition({
      key: 'x', title: '字段嵌套', type: 'object',
      fields: [{ key: 'a', title: '甲', kind: 'object' as never }],
    })).toBe(false)
  })
})

// ---- 值校验（按批校验的基础谓词） ----

describe('T04 设置值校验（addonSettingValueMatches）', () => {
  const defs: Record<string, AddonSettingDefinition> = {
    flag: { key: 'flag', title: '开关', type: 'boolean', default: true },
    threshold: { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
    mode: { key: 'mode', title: '模式', type: 'string', enum: ['a', 'b'], default: 'a' },
    replacements: { key: 'replacements', title: '替换', type: 'array', items: { kind: 'string', maxLength: 5 }, default: [], maxItems: 3 },
    limits: {
      key: 'limits', title: '对象', type: 'object',
      fields: [
        { key: 'name', title: '名称', kind: 'string', maxLength: 4, default: 'demo' },
        { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
      ],
    },
  }

  it('合法值逐型通过（含边界值）', () => {
    expect(addonSettingValueMatches(defs.flag!, false)).toBe(true)
    expect(addonSettingValueMatches(defs.threshold!, 1)).toBe(true)
    expect(addonSettingValueMatches(defs.threshold!, 100)).toBe(true)
    expect(addonSettingValueMatches(defs.mode!, 'b')).toBe(true)
    expect(addonSettingValueMatches(defs.replacements!, ['a', 'bc'])).toBe(true)
    expect(addonSettingValueMatches(defs.replacements!, [])).toBe(true)
    expect(addonSettingValueMatches(defs.limits!, { name: 'abcd', count: 0 })).toBe(true)
  })

  it('非法值逐型拒绝：类型不符 / 超界 / enum 外 / 超长 / null / undefined', () => {
    expect(addonSettingValueMatches(defs.flag!, 1)).toBe(false)
    expect(addonSettingValueMatches(defs.flag!, null)).toBe(false)
    expect(addonSettingValueMatches(defs.threshold!, 0)).toBe(false)
    expect(addonSettingValueMatches(defs.threshold!, 101)).toBe(false)
    expect(addonSettingValueMatches(defs.threshold!, Number.POSITIVE_INFINITY)).toBe(false)
    expect(addonSettingValueMatches(defs.threshold!, Number.NaN)).toBe(false)
    expect(addonSettingValueMatches(defs.mode!, 'c')).toBe(false)
    expect(addonSettingValueMatches(defs.replacements!, ['abcdef'])).toBe(false) // 项超长
    expect(addonSettingValueMatches(defs.replacements!, ['a', 1])).toBe(false) // 项类型不符
    expect(addonSettingValueMatches(defs.replacements!, ['a', 'b', 'c', 'd'])).toBe(false) // 超 maxItems
    expect(addonSettingValueMatches(defs.limits!, { name: 'a', count: 10 })).toBe(false) // 字段超界
    expect(addonSettingValueMatches(defs.limits!, { name: 'a' })).toBe(false) // 缺字段
    expect(addonSettingValueMatches(defs.limits!, { name: 'a', count: 1, extra: true })).toBe(false) // 多余字段
    expect(addonSettingValueMatches(defs.limits!, undefined)).toBe(false)
  })

  it('数组/对象不接受伪装：嵌套数组项与对象字段值（一层结构硬边界）', () => {
    // 数组项为数组/对象 → 非法（items 只描述标量）
    expect(addonSettingValueMatches(defs.replacements!, [['x']] as unknown)).toBe(false)
    expect(addonSettingValueMatches(defs.replacements!, [{ a: 'x' }] as unknown)).toBe(false)
    // 对象字段值为数组/对象/null → 非法
    expect(addonSettingValueMatches(defs.limits!, { name: ['x'], count: 1 } as unknown)).toBe(false)
    expect(addonSettingValueMatches(defs.limits!, { name: null, count: 1 } as unknown)).toBe(false)
  })
})

// ---- 作用范围解析 ----

describe('T04 作用范围解析（resolveAddonSettingLayer）', () => {
  const def: AddonSettingDefinition = { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 }

  it('三层优先序：工作区显式 > 用户默认显式 > 出厂默认', () => {
    expect(resolveAddonSettingLayer(def, undefined, undefined)).toEqual({ value: 20, source: 'default' })
    expect(resolveAddonSettingLayer(def, 50, undefined)).toEqual({ value: 50, source: 'user' })
    expect(resolveAddonSettingLayer(def, 50, 80)).toEqual({ value: 80, source: 'workspace' })
    expect(resolveAddonSettingLayer(def, undefined, 80)).toEqual({ value: 80, source: 'workspace' })
  })

  it('显式值非法（定义升级后存量漂移）：跳过该层继续下层，不从存储删除', () => {
    // user 层存量 500 超界（max 100）→ 视为未设置，回出厂默认
    expect(resolveAddonSettingLayer(def, 500, undefined)).toEqual({ value: 20, source: 'default' })
    // workspace 存量非法 → 落到 user 层
    expect(resolveAddonSettingLayer(def, 50, 500)).toEqual({ value: 50, source: 'user' })
    // 类型漂移同理
    expect(resolveAddonSettingLayer(def, 'bad' as unknown, undefined)).toEqual({ value: 20, source: 'default' })
  })

  it('composeObjectDefault：对象出厂值按字段 default 组装（缺省 default 的单一来源）', () => {
    const objectDef = {
      key: 'limits', title: '对象', type: 'object',
      fields: [
        { key: 'name', title: '名称', kind: 'string' as const, maxLength: 4, default: 'demo' },
        { key: 'count', title: '数量', kind: 'number' as const, min: 0, max: 9, default: 3 },
      ],
    } as const
    expect(composeObjectDefault(objectDef)).toEqual({ name: 'demo', count: 3 })
  })
})

// ---- 存储结构与迁移 ----

describe('T04 存储结构（version 1 冻结 + fail-safe 解析）', () => {
  it('序列化 round-trip：version 恒为 1，值形态保留', () => {
    const store = serializeAddonSettingsStore({
      'fixture.demo': { threshold: 30, replacements: ['a', 'b'], limits: { name: 'x', count: 1 } },
    })
    expect(store.version).toBe(ADDON_SETTINGS_STORE_VERSION)
    expect(parseAddonSettingsStore(store)).toEqual({
      'fixture.demo': { threshold: 30, replacements: ['a', 'b'], limits: { name: 'x', count: 1 } },
    })
  })

  it('未知 version / 坏形态 fail-safe 回 null（不猜测结构，宁回默认不破坏数据）', () => {
    expect(parseAddonSettingsStore(null)).toBeNull()
    expect(parseAddonSettingsStore('junk')).toBeNull()
    expect(parseAddonSettingsStore({ version: 2, values: {} })).toBeNull()
    expect(parseAddonSettingsStore({ version: 1 })).toBeNull()
    expect(parseAddonSettingsStore({ version: 1, values: 'junk' })).toBeNull()
    // values 内层形态不符（组件值为非对象）也整层拒绝
    expect(parseAddonSettingsStore({ version: 1, values: { 'a.b': 3 } })).toBeNull()
  })

  it('值形态守卫：存储值拒绝 undefined / 函数 / null / 嵌套结构 / 非有限数', () => {
    expect(isAddonSettingStoredValue(true)).toBe(true)
    expect(isAddonSettingStoredValue('x')).toBe(true)
    expect(isAddonSettingStoredValue(3.5)).toBe(true)
    expect(isAddonSettingStoredValue(['a', 1, false])).toBe(true)
    expect(isAddonSettingStoredValue({ a: 1, b: 'x' })).toBe(true)
    expect(isAddonSettingStoredValue(null)).toBe(false)
    expect(isAddonSettingStoredValue(undefined)).toBe(false)
    expect(isAddonSettingStoredValue(() => 1)).toBe(false)
    expect(isAddonSettingStoredValue(Number.NaN)).toBe(false)
    expect(isAddonSettingStoredValue(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isAddonSettingStoredValue([['nested']])).toBe(false)
    expect(isAddonSettingStoredValue({ a: { nested: true } })).toBe(false)
    expect(isAddonSettingStoredValue({ a: null })).toBe(false)
    expect(isAddonSettingStoredValue([undefined])).toBe(false)
  })

  it('解析对个别键的非法值形态整层拒绝（防半坏结构进入内存权威）', () => {
    const parsed = parseAddonSettingsStore({
      version: 1,
      values: { 'a.b': { ok: 1 }, 'c.d': { bad: null } },
    })
    expect(parsed).toBeNull()
  })
})
