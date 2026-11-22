import { describe, expect, it } from 'vitest'
import { PRODUCTION_SETTING_DEFINITIONS, sanitizeStoredSettings, isSettingEnabled } from '../../src/shared/settings'
import { SettingsService } from '../../src/host/settingsService'

describe('富文本粘贴偏好', () => {
  it('总开关和询问默认开；关闭总开关灰化询问但保留值', () => {
    const values = sanitizeStoredSettings(PRODUCTION_SETTING_DEFINITIONS, {})
    expect(values['editor.pastePreserveFormatting']).toBe(true)
    expect(values['editor.pasteAskBefore']).toBe(true)
    expect(values['editor.pasteSplitUndo']).toBe(true)
    const def = PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === 'editor.pasteAskBefore')!
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, { ...values, 'editor.pastePreserveFormatting': false }, def)).toBe(false)
    const split = PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === 'editor.pasteSplitUndo')!
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, { ...values, 'editor.pastePreserveFormatting': false }, split)).toBe(false)
  })
  it('记忆选择原子持久化并在重新构造服务后回显，失败不广播', async () => {
    let stored: unknown
    const storage = { get: <T>() => stored as T, update: async (_key: string, value: unknown) => { stored = value } }
    const service = new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS)
    expect((await service.apply({ 'editor.pastePreserveFormatting': false, 'editor.pasteAskBefore': false })).ok).toBe(true)
    expect(new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS).getSnapshot()).toMatchObject({ 'editor.pastePreserveFormatting': false, 'editor.pasteAskBefore': false })
  })
  it('格式边界默认用实体，另一档可持久化；关闭保留格式只禁用控件', async () => {
    let stored: unknown
    const storage = { get: <T>() => stored as T, update: async (_key: string, value: unknown) => { stored = value } }
    const def = PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === 'editor.pasteEmphasisBoundary')!
    const service = new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS)
    expect(service.getSnapshot()['editor.pasteEmphasisBoundary']).toBe('entity')
    expect(def).toMatchObject({ type: 'string', enum: ['entity', 'space'] })
    expect((await service.apply({ 'editor.pasteEmphasisBoundary': 'space', 'editor.pastePreserveFormatting': false })).ok).toBe(true)
    const values = new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS).getSnapshot()
    expect(values['editor.pasteEmphasisBoundary']).toBe('space')
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, values, def)).toBe(false)
  })
})
