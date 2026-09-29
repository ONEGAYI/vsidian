// 设置定义与读写纯逻辑契约（#33）：设置项定义（键/类型/默认值/校验内建于
// 类型）、默认快照、存量清洗（无效值恢复默认、未知键忽略）与补丁应用
// （有效值可保存回读、无效值整批拒绝）。#34 起生产注册表含首个实际设置项
// 「显示行号」；其余读写语义仍以 fixture 定义覆盖。
// #95 i18n 起定义文案键化（titleKey/descriptionKey 为消息键）：注册表断言
// 键名 + 经 zh-cn 字典同源取值（不再复制字面量）。
import { describe, it, expect } from 'vitest'
import {
  CODEBLOCK_CARD_DEFAULT,
  CODEBLOCK_CARD_KEY,
  CODEBLOCK_LINE_NUMBERS_KEY,
  PRODUCTION_SETTING_DEFINITIONS,
  READABLE_LINE_WIDTH_DEFAULT,
  READABLE_LINE_WIDTH_KEY,
  READABLE_LINE_WIDTH_MAX,
  READABLE_LINE_WIDTH_MIN,
  READABLE_LINE_WIDTH_STEP,
  SHOW_LINE_NUMBERS_DEFAULT,
  SHOW_LINE_NUMBERS_KEY,
  SYMBOL_AUTOCOMPLETE_DEFAULT,
  SYMBOL_AUTOCOMPLETE_KEY,
  SYMBOL_SELECTION_WRAP_DEFAULT,
  SYMBOL_SELECTION_WRAP_KEY,
  SYMBOL_TAB_ESCAPE_DEFAULT,
  SYMBOL_TAB_ESCAPE_KEY,
  applySettingsPatch,
  isSettingDefinition,
  isSettingEnabled,
  sanitizeStoredSettings,
  settingsDefaults,
  validateSettingDependencies,
  type SettingDefinition,
} from '../../src/shared/settings'
import { zhCn } from '../../src/shared/locales/zh-cn'

/** fixture 定义：契约测试专用的布尔设置项（titleKey 复用生产词条键） */
const FIXTURE_DEFS: readonly SettingDefinition[] = [
  { key: 'editor.lineNumbers', type: 'boolean', default: false, titleKey: 'setting.editorLineNumbers.title' },
  { key: 'editor.spellcheck', type: 'boolean', default: true, titleKey: 'setting.testFlag.title' },
]

describe('生产注册表（#34 起含实际设置项；#95 文案键化）', () => {
  // #96 起注册表追加 general.language（string 枚举）——按 key 查找断言，
  // 不依赖注册顺序（分组渲染见 settingsPageView 的 general.* 前缀规则）
  const byKey = (key: string): SettingDefinition =>
    PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === key)!

  it('注册「显示行号」：键 editor.lineNumbers、boolean、默认开启', () => {
    // #34：首个实际设置项接入，设置页不再是空状态（#33 设计的预期演进）
    const def = byKey('editor.lineNumbers')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.editorLineNumbers.title')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('显示行号')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「代码块卡片」：键 codeblock.card、boolean、默认开启（#79）', () => {
    const def = byKey('codeblock.card')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.codeblockCard.title')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('代码块卡片')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「卡内行号」：键 codeblock.lineNumbers、boolean、默认开启（#80）', () => {
    const def = byKey('codeblock.lineNumbers')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.codeblockLineNumbers.title')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('卡内行号')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「复制按钮」：键 codeblock.copyButton、boolean、默认开启（#81）', () => {
    const def = byKey('codeblock.copyButton')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.codeblockCopyButton.title')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('复制按钮')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「语法高亮」：键 codeblock.highlight、boolean、默认开启（#83）', () => {
    const def = byKey('codeblock.highlight')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.codeblockHighlight.title')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('语法高亮')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「符号自动补全」：键 editor.symbolAutocomplete、boolean、默认开启（#123）', () => {
    const def = byKey('editor.symbolAutocomplete')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.symbolAutocomplete.title')
    expect(def.descriptionKey).toBe('setting.symbolAutocomplete.description')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('符号自动补全')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「符号选区包裹」：键 editor.symbolSelectionWrap、boolean、默认开启（#124）', () => {
    const def = byKey('editor.symbolSelectionWrap')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.symbolSelectionWrap.title')
    expect(def.descriptionKey).toBe('setting.symbolSelectionWrap.description')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('选区符号包裹')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('注册「符号 Tab 越界」：键 editor.symbolTabEscape、boolean、默认开启（#125）', () => {
    const def = byKey('editor.symbolTabEscape')
    expect(def.type).toBe('boolean')
    expect(def.default).toBe(true)
    expect(def.titleKey).toBe('setting.symbolTabEscape.title')
    expect(def.descriptionKey).toBe('setting.symbolTabEscape.description')
    expect(zhCn[def.titleKey as keyof typeof zhCn]).toBe('符号 Tab 越界')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('键与消费方常量一致：符号 Tab 越界经 SYMBOL_TAB_ESCAPE_KEY 读同一键（#125）', () => {
    expect(SYMBOL_TAB_ESCAPE_KEY).toBe('editor.symbolTabEscape')
    expect(SYMBOL_TAB_ESCAPE_DEFAULT).toBe(true)
  })

  it('键与消费方常量一致：选区包裹经 SYMBOL_SELECTION_WRAP_KEY 读同一键（#124）', () => {
    expect(SYMBOL_SELECTION_WRAP_KEY).toBe('editor.symbolSelectionWrap')
    expect(SYMBOL_SELECTION_WRAP_DEFAULT).toBe(true)
  })

  it('键与消费方常量一致：符号自动补全经 SYMBOL_AUTOCOMPLETE_KEY 读同一键（#123）', () => {
    expect(SYMBOL_AUTOCOMPLETE_KEY).toBe('editor.symbolAutocomplete')
    expect(SYMBOL_AUTOCOMPLETE_DEFAULT).toBe(true)
  })

  it('注册「可读行宽」：键 editor.readableLineWidth、number、默认 0（铺满）（#175）', () => {
    const def = byKey('editor.readableLineWidth')
    expect(def.type).toBe('number')
    if (def.type === 'number') {
      expect(def.default).toBe(0)
      expect(def.min).toBe(0)
      expect(def.max).toBe(1600)
      expect(def.step).toBe(20)
    }
    expect(def.titleKey).toBe('setting.readableLineWidth.title')
    expect(def.descriptionKey).toBe('setting.readableLineWidth.description')
    expect(zhCn['setting.readableLineWidth.title']).toBe('可读行宽')
    expect(zhCn['setting.readableLineWidth.description']).toContain('铺满')
    // 0 档显示名（滑块值文本，非 0px）
    expect(zhCn['setting.readableLineWidthFill']).toBe('铺满')
    expect(isSettingDefinition(def)).toBe(true)
  })

  it('键与消费方常量一致：可读行宽经 READABLE_LINE_WIDTH_* 读同一键（#175）', () => {
    expect(READABLE_LINE_WIDTH_KEY).toBe('editor.readableLineWidth')
    expect(READABLE_LINE_WIDTH_DEFAULT).toBe(0)
    expect(READABLE_LINE_WIDTH_MIN).toBe(0)
    expect(READABLE_LINE_WIDTH_MAX).toBe(1600)
    expect(READABLE_LINE_WIDTH_STEP).toBe(20)
  })

  it('键与消费方常量一致：webview/宿主经 SHOW_LINE_NUMBERS_KEY 读同一键', () => {
    expect(SHOW_LINE_NUMBERS_KEY).toBe('editor.lineNumbers')
    expect(SHOW_LINE_NUMBERS_DEFAULT).toBe(true)
  })

  it('键与消费方常量一致：卡片总开关经 CODEBLOCK_CARD_KEY 读同一键（#79）', () => {
    expect(CODEBLOCK_CARD_KEY).toBe('codeblock.card')
    expect(CODEBLOCK_CARD_DEFAULT).toBe(true)
  })
})

describe('settingsDefaults', () => {
  it('按定义产出默认值快照', () => {
    expect(settingsDefaults(FIXTURE_DEFS)).toEqual({
      'editor.lineNumbers': false,
      'editor.spellcheck': true,
    })
  })

  it('空定义表产出空快照', () => {
    expect(settingsDefaults([])).toEqual({})
  })
})

describe('sanitizeStoredSettings（存量清洗：无效恢复默认、未知忽略、缺省回填）', () => {
  it('存量非对象（null/数组/字符串/数字）时全量回默认', () => {
    for (const stored of [null, undefined, [], 'x', 42]) {
      expect(sanitizeStoredSettings(FIXTURE_DEFS, stored)).toEqual({
        'editor.lineNumbers': false,
        'editor.spellcheck': true,
      })
    }
  })

  it('合法存量值保留', () => {
    expect(
      sanitizeStoredSettings(FIXTURE_DEFS, { 'editor.lineNumbers': true }),
    ).toEqual({
      'editor.lineNumbers': true,
      'editor.spellcheck': true,
    })
  })

  it('类型不符的存量值恢复默认（不抛错、不部分读取）', () => {
    expect(
      sanitizeStoredSettings(FIXTURE_DEFS, { 'editor.lineNumbers': 1, 'editor.spellcheck': 'on' }),
    ).toEqual({
      'editor.lineNumbers': false,
      'editor.spellcheck': true,
    })
  })

  it('未知键的存量被忽略（历史遗留设置不进入快照）', () => {
    expect(
      sanitizeStoredSettings(FIXTURE_DEFS, { 'legacy.removed': true, 'editor.spellcheck': false }),
    ).toEqual({
      'editor.lineNumbers': false,
      'editor.spellcheck': false,
    })
  })
})

describe('applySettingsPatch（补丁应用：有效保存回读、无效整批拒绝）', () => {
  const current = { 'editor.lineNumbers': false, 'editor.spellcheck': true }

  it('有效补丁产出合并后的新快照（未涉及键保持原值）', () => {
    const result = applySettingsPatch(FIXTURE_DEFS, current, { 'editor.lineNumbers': true })
    expect(result).toEqual({
      ok: true,
      merged: { 'editor.lineNumbers': true, 'editor.spellcheck': true },
    })
  })

  it('空补丁合法且幂等（merged 与 current 一致）', () => {
    expect(applySettingsPatch(FIXTURE_DEFS, current, {})).toEqual({
      ok: true,
      merged: current,
    })
  })

  it('未知键拒绝', () => {
    const result = applySettingsPatch(FIXTURE_DEFS, current, { 'unknown.key': true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejected).toContain('unknown.key')
    }
  })

  it('类型不符拒绝（boolean 定义不接受数字/字符串/null）', () => {
    for (const bad of [1, 'true', null, undefined]) {
      const result = applySettingsPatch(FIXTURE_DEFS, current, { 'editor.lineNumbers': bad as never })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.rejected).toContain('editor.lineNumbers')
      }
    }
  })

  it('补丁非对象拒绝', () => {
    for (const bad of [null, 'x', 42, [true]]) {
      const result = applySettingsPatch(FIXTURE_DEFS, current, bad as never)
      expect(result.ok).toBe(false)
    }
  })

  it('原子性：一批中任一键非法则整批拒绝（有效键不落地）', () => {
    const result = applySettingsPatch(FIXTURE_DEFS, current, {
      'editor.lineNumbers': true,
      'editor.spellcheck': 'yes' as never,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejected).toContain('editor.spellcheck')
      expect(result.rejected).not.toContain('editor.lineNumbers')
    }
  })
})

describe('isSettingDefinition（定义自校验：注册入口防线）', () => {
  it('接受合法定义', () => {
    expect(isSettingDefinition(FIXTURE_DEFS[0])).toBe(true)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k' })).toBe(true)
  })

  it('拒绝 key 非字符串或空串', () => {
    expect(isSettingDefinition({ key: 1, type: 'boolean', default: false, titleKey: 'k' })).toBe(false)
    expect(isSettingDefinition({ key: '', type: 'boolean', default: false, titleKey: 'k' })).toBe(false)
  })

  it('拒绝未知 type 与非布尔 default（number 为已知类型，见下文专述）', () => {
    expect(isSettingDefinition({ key: 'a', type: 'color', default: 1, titleKey: 'k' })).toBe(false)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: 1, titleKey: 'k' })).toBe(false)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: 'false', titleKey: 'k' })).toBe(false)
  })

  it('拒绝 titleKey 非字符串与整体非对象', () => {
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 1 })).toBe(false)
    expect(isSettingDefinition(null)).toBe(false)
    expect(isSettingDefinition('x')).toBe(false)
  })

  it('descriptionKey 可选：缺省合法，存在时须为字符串', () => {
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k', descriptionKey: 'kd' })).toBe(true)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k', descriptionKey: 1 })).toBe(false)
  })
})

describe('设置项依赖（#155 跟进：dependsOn 注册表驱动）', () => {
  /** fixture：卡片总开关 + 两个子项 + 一条传递链（孙依赖子、子依赖开关） */
  const DEP_DEFS: readonly SettingDefinition[] = [
    { key: 'parent', type: 'boolean', default: true, titleKey: 'k' },
    { key: 'child', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'parent' },
    { key: 'grandchild', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'child' },
    { key: 'independent', type: 'boolean', default: false, titleKey: 'k' },
  ]
  const defOf = (defs: readonly SettingDefinition[], key: string): SettingDefinition =>
    defs.find((d) => d.key === key)!

  it('isSettingEnabled：无依赖恒可用；依赖开启可用、关闭禁用；传递链逐级传导', () => {
    const enabled = (values: Record<string, boolean>, key: string) =>
      isSettingEnabled(DEP_DEFS, values, defOf(DEP_DEFS, key))
    expect(enabled({}, 'independent')).toBe(true)
    expect(enabled({ parent: true }, 'child')).toBe(true)
    expect(enabled({ parent: false }, 'child')).toBe(false)
    // 传递链：parent 关 → child 关 → grandchild 链上不可用
    expect(enabled({ parent: false }, 'grandchild')).toBe(false)
    expect(enabled({ parent: true }, 'grandchild')).toBe(true)
  })

  it('值缺失回退默认值：依赖项默认开启时，快照缺值不误判为禁用', () => {
    expect(isSettingEnabled(DEP_DEFS, {}, defOf(DEP_DEFS, 'child'))).toBe(true)
    const defaultOff: readonly SettingDefinition[] = [
      { key: 'p', type: 'boolean', default: false, titleKey: 'k' },
      { key: 'c', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'p' },
    ]
    expect(isSettingEnabled(defaultOff, {}, defOf(defaultOff, 'c'))).toBe(false)
  })

  it('非布尔依赖视为不可用（依赖语义只认布尔开关；枚举/异常值不开启）', () => {
    const defs: readonly SettingDefinition[] = [
      { key: 'p', type: 'boolean', default: true, titleKey: 'k' },
      { key: 'c', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'p' },
    ]
    expect(isSettingEnabled(defs, { p: 1 as unknown as boolean }, defOf(defs, 'c'))).toBe(false)
  })

  it('validateSettingDependencies：引用不存在 / 自环 / 传递环均报违规；合法表为空', () => {
    expect(validateSettingDependencies(DEP_DEFS)).toEqual([])
    const missing = [
      { key: 'c', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'ghost' },
    ] as const
    expect(validateSettingDependencies(missing as unknown as readonly SettingDefinition[]).join())
      .toContain('ghost')
    const selfDep = [
      { key: 's', type: 'boolean', default: true, titleKey: 'k', dependsOn: 's' },
    ] as const
    expect(validateSettingDependencies(selfDep as unknown as readonly SettingDefinition[]).join())
      .toContain('s')
    const cyclic: readonly SettingDefinition[] = [
      { key: 'a', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'b' },
      { key: 'b', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'a' },
    ]
    expect(validateSettingDependencies(cyclic).length).toBeGreaterThan(0)
  })

  it('环防御：isSettingEnabled 对成环表不死循环（视为可用，注册表校验另行拦截）', () => {
    const cyclic: readonly SettingDefinition[] = [
      { key: 'a', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'b' },
      { key: 'b', type: 'boolean', default: true, titleKey: 'k', dependsOn: 'a' },
    ]
    expect(isSettingEnabled(cyclic, {}, defOf(cyclic, 'a'))).toBe(true)
  })

  it('isSettingDefinition：dependsOn 缺省合法，存在时须为非空字符串', () => {
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k' })).toBe(true)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k', dependsOn: 'b' })).toBe(true)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k', dependsOn: 1 })).toBe(false)
    expect(isSettingDefinition({ key: 'a', type: 'boolean', default: false, titleKey: 'k', dependsOn: '' })).toBe(false)
  })

  it('生产注册表：依赖登记完整（引用存在、无环）且现有两条依赖指向代码块卡片', () => {
    expect(validateSettingDependencies(PRODUCTION_SETTING_DEFINITIONS)).toEqual([])
    const lineNumbers = defOf(PRODUCTION_SETTING_DEFINITIONS, CODEBLOCK_LINE_NUMBERS_KEY)
    const copyButton = defOf(PRODUCTION_SETTING_DEFINITIONS, 'codeblock.copyButton')
    expect(lineNumbers.dependsOn).toBe(CODEBLOCK_CARD_KEY)
    expect(copyButton.dependsOn).toBe(CODEBLOCK_CARD_KEY)
    // 卡片开（默认）可用；卡片关则两个子项禁用
    const defaults = settingsDefaults(PRODUCTION_SETTING_DEFINITIONS)
    expect(defaults[CODEBLOCK_CARD_KEY]).toBe(CODEBLOCK_CARD_DEFAULT)
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, defaults, lineNumbers)).toBe(true)
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, { ...defaults, [CODEBLOCK_CARD_KEY]: false }, lineNumbers)).toBe(false)
    expect(isSettingEnabled(PRODUCTION_SETTING_DEFINITIONS, { ...defaults, [CODEBLOCK_CARD_KEY]: false }, copyButton)).toBe(false)
  })
})

describe('枚举值依赖 dependsOnEnum（#163 验收反馈防呆）', () => {
  const defs = [
    { key: 'img.paste', type: 'boolean', default: true, titleKey: 'setting.imagePaste.title' },
    { key: 'img.location', type: 'string', default: 'same-dir', enum: ['same-dir', 'workspace-root', 'relative-to-file'], titleKey: 'setting.imagePasteLocation.title', dependsOn: 'img.paste' },
    { key: 'img.subpath', type: 'string', default: 'assets', maxLength: 64, titleKey: 'setting.imagePasteSubpath.title', dependsOnEnum: { key: 'img.location', values: ['workspace-root', 'relative-to-file'] } },
  ] as unknown as readonly SettingDefinition[]

  it('依赖项值 ∈ values 时可用；同目录（不在 values）灰化', () => {
    expect(isSettingEnabled(defs, { 'img.location': 'workspace-root' }, defs[2]!)).toBe(true)
    expect(isSettingEnabled(defs, { 'img.location': 'relative-to-file' }, defs[2]!)).toBe(true)
    expect(isSettingEnabled(defs, { 'img.location': 'same-dir' }, defs[2]!)).toBe(false)
    expect(isSettingEnabled(defs, {}, defs[2]!)).toBe(false) // 缺值回退默认 same-dir
  })
  it('依赖链传递：总开关关闭时（location 灰）子路径级联灰化', () => {
    expect(isSettingEnabled(defs, { 'img.paste': false, 'img.location': 'workspace-root' }, defs[2]!)).toBe(false)
  })
  it('注册校验：引用缺失 / 依赖项非枚举型 / values 越界为违规', () => {
    const bad = [
      { key: 'a', type: 'boolean', default: true, titleKey: 'setting.testFlag.title', dependsOnEnum: { key: 'missing', values: ['x'] } },
      { key: 'b', type: 'string', default: 's', maxLength: 8, titleKey: 'setting.testFlag.title', dependsOnEnum: { key: 'a', values: ['x'] } },
      { key: 'loc', type: 'string', default: 'same-dir', enum: ['same-dir', 'workspace-root'], titleKey: 'setting.testFlag.title' },
      { key: 'c', type: 'string', default: 's', maxLength: 8, titleKey: 'setting.testFlag.title', dependsOnEnum: { key: 'loc', values: ['nope'] } },
    ] as unknown as readonly SettingDefinition[]
    const violations = validateSettingDependencies(bad)
    expect(violations.some((v) => v.includes('未注册'))).toBe(true)
    expect(violations.some((v) => v.includes('非枚举'))).toBe(true)
    expect(violations.some((v) => v.includes('不在依赖项枚举'))).toBe(true)
    expect(validateSettingDependencies(defs)).toEqual([])
  })
})

describe('number 设置项（#175：范围与步进内建于类型，0 为普通值——铺满语义归消费方）', () => {
  type NumberDef = Extract<SettingDefinition, { type: 'number' }>
  const base: NumberDef = { key: 'n', type: 'number', default: 100, min: 0, max: 1600, step: 20, titleKey: 'k' }
  /** 覆盖字段构造定义；非法形态用 as 走非安全通道（被测方须拒绝） */
  const def = (over: Partial<NumberDef> | Record<string, unknown>): SettingDefinition =>
    ({ ...base, ...over }) as SettingDefinition

  it('isSettingDefinition 接受合法定义（默认在范围内、步进为正有限数）', () => {
    expect(isSettingDefinition(base)).toBe(true)
    expect(isSettingDefinition({ ...base, default: 0, min: 0 })).toBe(true)
    expect(isSettingDefinition({ ...base, default: 1600 })).toBe(true)
  })

  it('拒绝：default 非数字 / 超出范围 / 非有限数', () => {
    expect(isSettingDefinition(def({ default: '100' }))).toBe(false)
    expect(isSettingDefinition(def({ default: -20 }))).toBe(false)
    expect(isSettingDefinition(def({ default: 2000 }))).toBe(false)
    expect(isSettingDefinition(def({ default: Number.NaN }))).toBe(false)
    expect(isSettingDefinition(def({ default: Number.POSITIVE_INFINITY }))).toBe(false)
  })

  it('拒绝：min/max/step 缺失或非有限数', () => {
    expect(isSettingDefinition(def({ min: undefined }))).toBe(false)
    expect(isSettingDefinition(def({ max: undefined }))).toBe(false)
    expect(isSettingDefinition(def({ step: undefined }))).toBe(false)
    expect(isSettingDefinition(def({ min: Number.NaN }))).toBe(false)
    expect(isSettingDefinition(def({ max: Number.POSITIVE_INFINITY }))).toBe(false)
    expect(isSettingDefinition(def({ step: Number.NaN }))).toBe(false)
  })

  it('拒绝：min 大于 max、step 非正', () => {
    expect(isSettingDefinition(def({ min: 100, max: 50 }))).toBe(false)
    expect(isSettingDefinition(def({ step: 0 }))).toBe(false)
    expect(isSettingDefinition(def({ step: -20 }))).toBe(false)
  })

  it('sanitizeStoredSettings：范围内保留；超范围/非数字/非有限恢复默认', () => {
    const defs = [def({ key: 'n', default: 100 })]
    expect(sanitizeStoredSettings(defs, { n: 900 })).toEqual({ n: 900 })
    expect(sanitizeStoredSettings(defs, { n: 0 })).toEqual({ n: 0 })
    for (const bad of [-5, 9999, '900', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(sanitizeStoredSettings(defs, { n: bad as never })).toEqual({ n: 100 })
    }
  })

  it('applySettingsPatch：范围内接受；超范围/非数字拒绝且整批原子', () => {
    const current = { n: 100 }
    expect(applySettingsPatch([base], current, { n: 900 })).toEqual({ ok: true, merged: { n: 900 } })
    expect(applySettingsPatch([base], current, { n: 0 })).toEqual({ ok: true, merged: { n: 0 } })
    for (const bad of [-5, 9999, '900', Number.NaN]) {
      const result = applySettingsPatch([base], current, { n: bad as never })
      expect(result.ok).toBe(false)
    }
  })

  it('zeroLabelKey/unit 可选显示字段：缺省合法，存在时须为字符串', () => {
    expect(isSettingDefinition(def({ zeroLabelKey: 'setting.readableLineWidthFill', unit: 'px' }))).toBe(true)
    expect(isSettingDefinition(def({ zeroLabelKey: undefined, unit: undefined }))).toBe(true)
    expect(isSettingDefinition(def({ zeroLabelKey: 1 }))).toBe(false)
    expect(isSettingDefinition(def({ unit: 2 }))).toBe(false)
  })

  it('步进倍数不强制（手改存量 906 合法——校验只管范围与类型）', () => {
    expect(applySettingsPatch([base], { n: 100 }, { n: 906 })).toEqual({ ok: true, merged: { n: 906 } })
  })
})

describe('Live 直接悬停设置（#221）', () => {
  it('hover.liveDirect 注册为布尔项（默认 false = Ctrl+悬停）；定义恒合法', () => {
    const def = PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === 'hover.liveDirect')
    expect(def).toMatchObject({ type: 'boolean', default: false })
    expect(def?.titleKey).toBe('setting.hoverLiveDirect.title')
    expect(def?.descriptionKey).toBe('setting.hoverLiveDirect.description')
    // 注册表整体恒合法（依赖校验 + 定义自校验兜底）
    expect(validateSettingDependencies(PRODUCTION_SETTING_DEFINITIONS)).toEqual([])
    // 默认快照含新键；非法存量（类型不符）恢复默认
    expect(settingsDefaults(PRODUCTION_SETTING_DEFINITIONS)['hover.liveDirect']).toBe(false)
    expect(sanitizeStoredSettings(PRODUCTION_SETTING_DEFINITIONS, { 'hover.liveDirect': 'yes' })['hover.liveDirect'])
      .toBe(false)
    expect(sanitizeStoredSettings(PRODUCTION_SETTING_DEFINITIONS, { 'hover.liveDirect': true })['hover.liveDirect'])
      .toBe(true)
  })
})
