// @vitest-environment jsdom
// 设置 schema string 自由文本类型契约（#161 图片粘贴）：
// - SettingDefinition 支持 type:'string' 无 enum 的自由文本（maxLength 有限
//   长度校验）；isSettingDefinition / valueMatchesType（经 sanitize/apply
//   间接验证）按 enum 有无分流；枚举语义不回归
// - 生产注册表：三个 image.* 设置项形态钉住（总开关布尔 / 存放模式枚举 /
//   子路径自由文本）
// - 设置页 text input 控件：渲染、当前值回显、变更上送、快照回显同步；
//   boolean/枚举控件不回归
import { describe, it, expect } from 'vitest'
import {
  applySettingsPatch,
  isSettingDefinition,
  PRODUCTION_SETTING_DEFINITIONS,
  sanitizeStoredSettings,
  settingsDefaults,
  IMAGE_PASTE_KEY,
  IMAGE_PASTE_LOCATION_KEY,
  IMAGE_PASTE_LOCATION_MODES,
  IMAGE_PASTE_LOCATION_DEFAULT,
  IMAGE_PASTE_SUBPATH_KEY,
  IMAGE_PASTE_SUBPATH_DEFAULT,
  type SettingDefinition,
} from '../../src/shared/settings'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

installLocale('zh-cn', zhCn)

const TEXT_DEFS: readonly SettingDefinition[] = [
  {
    key: 'image.pasteSubpath',
    type: 'string',
    default: 'assets',
    maxLength: 200,
    titleKey: 'setting.imagePasteSubpath.title',
  },
]

describe('isSettingDefinition（string 自由文本定义校验，#161）', () => {
  it('接受合法自由文本定义（default 为不超上限的字符串）', () => {
    expect(isSettingDefinition(TEXT_DEFS[0])).toBe(true)
  })

  it('maxLength 必须为正整数；default 超长拒绝', () => {
    expect(isSettingDefinition({ ...TEXT_DEFS[0], maxLength: 0 })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], maxLength: -1 })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], maxLength: 1.5 })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], maxLength: '200' })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], maxLength: undefined })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], default: 'a'.repeat(201) })).toBe(false)
  })

  it('default 类型不符拒绝；enum 与自由文本互斥形态', () => {
    expect(isSettingDefinition({ ...TEXT_DEFS[0], default: 1 })).toBe(false)
    expect(isSettingDefinition({ ...TEXT_DEFS[0], default: true })).toBe(false)
    // 枚举形态：enum 存在时走枚举校验（maxLength 不强制）
    expect(
      isSettingDefinition({
        key: 'x',
        type: 'string',
        default: 'a',
        enum: ['a', 'b'],
        titleKey: 't',
      }),
    ).toBe(true)
  })
})

describe('清洗与补丁（自由文本按 maxLength 校验，#161）', () => {
  it('settingsDefaults 产出字符串默认值', () => {
    expect(settingsDefaults(TEXT_DEFS)).toEqual({ 'image.pasteSubpath': 'assets' })
  })

  it('存量清洗：合法字符串保留，超长/类型不符恢复默认；空字符串合法', () => {
    expect(sanitizeStoredSettings(TEXT_DEFS, { 'image.pasteSubpath': 'img/sub' })).toEqual({
      'image.pasteSubpath': 'img/sub',
    })
    expect(sanitizeStoredSettings(TEXT_DEFS, { 'image.pasteSubpath': '' })).toEqual({
      'image.pasteSubpath': '',
    })
    expect(sanitizeStoredSettings(TEXT_DEFS, { 'image.pasteSubpath': 'a'.repeat(201) })).toEqual({
      'image.pasteSubpath': 'assets',
    })
    expect(sanitizeStoredSettings(TEXT_DEFS, { 'image.pasteSubpath': 3 })).toEqual({
      'image.pasteSubpath': 'assets',
    })
  })

  it('补丁应用：合法字符串通过，超长整批拒绝（原子性）', () => {
    const current = settingsDefaults(TEXT_DEFS)
    expect(applySettingsPatch(TEXT_DEFS, current, { 'image.pasteSubpath': 'pics' })).toEqual({
      ok: true,
      merged: { 'image.pasteSubpath': 'pics' },
    })
    expect(applySettingsPatch(TEXT_DEFS, current, { 'image.pasteSubpath': 'x'.repeat(500) }).ok).toBe(false)
    expect(applySettingsPatch(TEXT_DEFS, current, { 'image.pasteSubpath': null }).ok).toBe(false)
  })
})

describe('生产注册表 image.* 三设置项（#161）', () => {
  const byKey = new Map(PRODUCTION_SETTING_DEFINITIONS.map((d) => [d.key, d]))

  it('总开关：布尔、默认开', () => {
    const def = byKey.get(IMAGE_PASTE_KEY)
    expect(def).toBeDefined()
    if (!def) throw new Error('missing')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
  })

  it('存放模式：三值枚举、默认同目录', () => {
    const def = byKey.get(IMAGE_PASTE_LOCATION_KEY)
    expect(def).toBeDefined()
    if (!def) throw new Error('missing')
    expect(def.type).toBe('string')
    expect(def.default).toBe(IMAGE_PASTE_LOCATION_DEFAULT)
    expect(IMAGE_PASTE_LOCATION_DEFAULT).toBe('same-dir')
    expect(IMAGE_PASTE_LOCATION_MODES).toEqual(['same-dir', 'workspace-root', 'relative-to-file'])
    if (def.type === 'string' && 'enum' in def) {
      expect([...def.enum]).toEqual([...IMAGE_PASTE_LOCATION_MODES])
    }
  })

  it('子路径：自由文本、默认 assets', () => {
    const def = byKey.get(IMAGE_PASTE_SUBPATH_KEY)
    expect(def).toBeDefined()
    if (!def) throw new Error('missing')
    expect(def.type).toBe('string')
    expect(def.default).toBe(IMAGE_PASTE_SUBPATH_DEFAULT)
    expect(IMAGE_PASTE_SUBPATH_DEFAULT).toBe('assets')
    expect(isSettingDefinition(def)).toBe(true)
  })
})

describe('设置页 text input 控件（#161）', () => {
  const TEXT_AND_ENUM: readonly SettingDefinition[] = [
    TEXT_DEFS[0],
    {
      key: 'image.pasteLocation',
      type: 'string',
      default: 'same-dir',
      enum: IMAGE_PASTE_LOCATION_MODES,
      titleKey: 'setting.imagePasteLocation.title',
    },
  ]

  function mountView(values?: Record<string, unknown>): {
    view: SettingsPageView
    root: HTMLElement
  } {
    const bridge = { postMessage: () => {} }
    // #332 设置重组：image.* 键迁至「文件与链接」附加分页（defsGroups 承
    // 接）——注册该分页后它成为此 fixture 的首个分类（editor/general 均空），
    // image 行落在默认页，查询断言无需切页
    const view = new SettingsPageView(bridge, TEXT_AND_ENUM, [new IndexMaintenanceSection(bridge)])
    const root = document.createElement('div')
    document.body.append(root)
    view.mount(root)
    if (values) {
      view.handleHostMessage({ kind: 'settings.snapshot', values })
    }
    view.dispose()
    return { view, root }
  }

  it('自由文本渲染为 text input 并回显当前值；枚举仍渲染下拉', () => {
    const { root } = mountView({ 'image.pasteSubpath': 'pics/sub' })
    const input = root.querySelector<HTMLInputElement>(
      `input[type=text][data-setting-key="${IMAGE_PASTE_SUBPATH_KEY}"]`,
    )
    expect(input).not.toBeNull()
    expect(input!.value).toBe('pics/sub')
    const select = root.querySelector<HTMLSelectElement>(
      `select[data-setting-key="image.pasteLocation"]`,
    )
    expect(select).not.toBeNull()
    expect(select!.value).toBe('same-dir')
    root.remove()
  })

  it('缺省回显定义默认值', () => {
    const { root } = mountView({})
    const input = root.querySelector<HTMLInputElement>(
      `input[type=text][data-setting-key="${IMAGE_PASTE_SUBPATH_KEY}"]`,
    )
    expect(input!.value).toBe('assets')
    root.remove()
  })

  it('change 上送 settings.set；后续快照回显同步（checkbox 回显不回归）', () => {
    const sent: Array<{ kind?: string; values?: Record<string, unknown> }> = []
    const bridge = { postMessage: (m: unknown) => sent.push(m as { kind?: string; values?: Record<string, unknown> }) }
    const view = new SettingsPageView(bridge, TEXT_AND_ENUM, [new IndexMaintenanceSection(bridge)])
    const root = document.createElement('div')
    document.body.append(root)
    view.mount(root)
    view.handleHostMessage({ kind: 'settings.snapshot', values: {} })
    const input = root.querySelector<HTMLInputElement>(
      `input[type=text][data-setting-key="${IMAGE_PASTE_SUBPATH_KEY}"]`,
    )!
    input.value = 'media'
    input.dispatchEvent(new Event('change'))
    expect(sent.some((m) => m['kind'] === 'settings.set' && m['values']?.['image.pasteSubpath'] === 'media')).toBe(true)
    // 外部保存广播回显：输入框值同步为权威值
    view.handleHostMessage({ kind: 'settings.changed', values: { 'image.pasteSubpath': 'media2' } })
    expect(input.value).toBe('media2')
    view.dispose()
    root.remove()
  })
})
