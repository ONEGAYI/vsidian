// #457 附加组件宿主设置读取面——白名单与值解析纯函数的契约测试。
// 验收口径（票面三条中的默认值与一致性两条在此钉住）：
// - 默认值：快照未达/缺键回定义表默认值（与 syncController 的
//   applyReadingBreaksSetting 缺键回默认同口径，宿主初始渲染同语义）
// - 与宿主一致：值来自宿主设置快照投影（SettingsPayload），无独立合成层
// - 收敛：白名单外 key 一律 invalid-key 拒绝，不静默 undefined
import { describe, expect, it } from 'vitest'
import { READING_BREAKS_DEFAULT, READING_BREAKS_KEY } from '../../src/shared/settings'
import {
  ADDON_HOST_SETTING_KEYS,
  addonHostSettingGet,
  isAddonHostSettingKey,
  resolveAddonHostSettingValue,
} from '../../src/shared/addonHostSettingsApi'

describe('白名单（isAddonHostSettingKey / ADDON_HOST_SETTING_KEYS）', () => {
  it('首版白名单仅含 editor.readingBreaks，且与宿主键常量同源（不复制字面量）', () => {
    expect([...ADDON_HOST_SETTING_KEYS]).toEqual([READING_BREAKS_KEY])
  })

  it('白名单内键放行；白名单外键、空串拒绝', () => {
    expect(isAddonHostSettingKey(READING_BREAKS_KEY)).toBe(true)
    expect(isAddonHostSettingKey('editor.fontSize')).toBe(false)
    expect(isAddonHostSettingKey('editor')).toBe(false)
    expect(isAddonHostSettingKey('')).toBe(false)
  })
})

describe('值解析（resolveAddonHostSettingValue）', () => {
  it('快照携带 true / false 时原样返回布尔值', () => {
    expect(resolveAddonHostSettingValue({ [READING_BREAKS_KEY]: true }, READING_BREAKS_KEY)).toBe(true)
    expect(resolveAddonHostSettingValue({ [READING_BREAKS_KEY]: false }, READING_BREAKS_KEY)).toBe(false)
  })

  it('快照未达（undefined）与缺键回定义表默认值（与宿主渲染缺键口径一致）', () => {
    expect(resolveAddonHostSettingValue(undefined, READING_BREAKS_KEY)).toBe(READING_BREAKS_DEFAULT)
    expect(resolveAddonHostSettingValue({}, READING_BREAKS_KEY)).toBe(READING_BREAKS_DEFAULT)
    expect(READING_BREAKS_DEFAULT).toBe(false)
  })

  it('非 true 真值一律归一为 false（防御位：仅显式 true 开启）', () => {
    // SettingsPayloadValue 宽联合在存储层防御位上可能出现非布尔残留，
    // 与 applyReadingBreaksSetting 的 raw === true 归一化同口径
    expect(resolveAddonHostSettingValue({ [READING_BREAKS_KEY]: 'true' as never }, READING_BREAKS_KEY)).toBe(false)
    expect(resolveAddonHostSettingValue({ [READING_BREAKS_KEY]: 1 as never }, READING_BREAKS_KEY)).toBe(false)
  })
})

describe('读取组合（addonHostSettingGet）', () => {
  it('白名单内键：返回快照值', () => {
    expect(addonHostSettingGet({ [READING_BREAKS_KEY]: true }, READING_BREAKS_KEY)).toEqual({
      ok: true,
      value: true,
    })
    expect(addonHostSettingGet(undefined, READING_BREAKS_KEY)).toEqual({ ok: true, value: false })
  })

  it('白名单外键：invalid-key 拒绝，不静默 undefined（读取范围收敛）', () => {
    expect(addonHostSettingGet({ [READING_BREAKS_KEY]: true }, 'editor.lineNumbers')).toEqual({
      ok: false,
      reason: 'invalid-key',
    })
    expect(addonHostSettingGet(undefined, '')).toEqual({ ok: false, reason: 'invalid-key' })
  })
})
