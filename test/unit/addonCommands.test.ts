// #359 T10 附加组件命令、菜单与统一快捷键——共享层契约测试。
//
// 票面验收映射（docs/specs/vsidian-addons-tickets/t10.md）：
// - 命名空间/归属/绑定契约（负向：同名注册、内置/跨组件覆盖尝试、Tab
//   通道均明确拒绝）；
// - 组件命令进入统一快捷键管理（冲突检查跨内置/组件两族、显式清空与
//   默认跟随语义、存储保留——组件不在场时用户绑定不丢）；
// - 组件菜单项：label 自由文本、独立簇、图标 key 表校验、内置项不被
//   覆写（localId 自动命名空间——结构上免疫同名间接替换）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  addonLocalIdProblem,
  addonDefaultBindingsProblem,
  addonMenuItemProblem,
  buildAddonCommandReport,
  namespacedAddonId,
  ADDON_MENU_ITEM_ID_PATTERN,
  ADDON_DISPLAY_TEXT_MAX,
} from '../../src/shared/addonCommands'
import {
  setRuntimeOperations,
  runtimeOperations,
  allKeybindingOperations,
  getEffectiveBindings,
  findConflictedOperationIds,
  resolveKeybinding,
  sanitizeStoredOverrides,
  chordContainsTab,
  __resetRuntimeOperationsForTest,
} from '../../src/shared/keybindings'
import {
  CONTEXT_MENU_ITEMS,
  __resetContextMenuRegistryForTest,
  registerContextMenuItem,
  contextMenuRegistrySnapshot,
  buildContextMenuModel,
  contextMenuKeybindingHints,
} from '../../src/shared/contextMenu'

const PLAIN_CTX = {
  zone: 'normal' as const,
  hasSelection: false,
  blockTarget: null,
  line: { headingLevel: null, listKind: null, quoted: false, hasText: true },
}

describe('T10 命名空间与局部 ID 校验', () => {
  it('合法 localId 构造 namespaced ID（组件 ID + 点 + 局部 ID）', () => {
    expect(namespacedAddonId('vsidian-test-fixture.addon-t10', 'insertStamp'))
      .toBe('vsidian-test-fixture.addon-t10.insertStamp')
  })

  it('localId 含点被拒——点号是命名空间分隔符，组件不得伪造跨组件/内置身份', () => {
    // 企图覆写内置菜单 id（bold 是内置格式操作）或冒充另一组件的命名空间
    expect(addonLocalIdProblem('bold.x')).toBe('dot')
    expect(addonLocalIdProblem('other.addon.stamp')).toBe('dot')
  })

  it('localId 空/非法字符被拒', () => {
    expect(addonLocalIdProblem('')).toBe('empty')
    expect(addonLocalIdProblem('stamp!')).toBe('invalid-chars')
    expect(addonLocalIdProblem('a'.repeat(65))).toBe('too-long')
    expect(addonLocalIdProblem('insert-stamp_1')).toBeNull()
  })

  it('菜单项 local ID 前缀不撞任何内置菜单 id——同名注册间接替换内置在结构上不可表达', () => {
    const builtinIds = new Set<string>()
    const walk = (defs: readonly { id: string; children?: readonly { id: string; children?: readonly object[] }[] }[]): void => {
      for (const def of defs) {
        builtinIds.add(def.id)
        if (def.children) walk(def.children as never)
      }
    }
    walk(CONTEXT_MENU_ITEMS)
    const namespaced = namespacedAddonId('publisher.addon', 'bold')
    expect(builtinIds.has(namespaced)).toBe(false)
    expect(ADDON_MENU_ITEM_ID_PATTERN.test(namespaced)).toBe(true)
  })
})

describe('T10 默认绑定校验', () => {
  it('Tab 通道被拒（含单段 Tab 与 chord 段 Tab）——#125 三段优先级铁律', () => {
    expect(addonDefaultBindingsProblem(['tab'])).toBe('tab-forbidden')
    expect(addonDefaultBindingsProblem(['ctrl+tab'])).toBe('tab-forbidden')
    expect(addonDefaultBindingsProblem(['ctrl+k', 'tab'])).toBe('tab-forbidden')
  })

  it('非法 chord 被拒；合法绑定（含默认未绑定 = 空数组）通过', () => {
    expect(addonDefaultBindingsProblem(['not-a-key'])).toBe('invalid-chord')
    expect(addonDefaultBindingsProblem([])).toBeNull()
    expect(addonDefaultBindingsProblem(['ctrl+alt+s', 'ctrl+k ctrl+j'])).toBeNull()
  })

  it('chordContainsTab 识别 Tab 本体（修饰键组合中的 tab 键）', () => {
    expect(chordContainsTab('tab')).toBe(true)
    expect(chordContainsTab('ctrl+tab')).toBe(true)
    expect(chordContainsTab('ctrl+k tab')).toBe(true)
    expect(chordContainsTab('ctrl+k')).toBe(false)
    expect(chordContainsTab('ctrl+shift+t')).toBe(false)
  })
})

describe('T10 统一快捷键管理：运行期操作层', () => {
  beforeEach(() => {
    __resetRuntimeOperationsForTest()
  })
  afterEach(() => {
    __resetRuntimeOperationsForTest()
  })

  it('运行期操作进入合并表：生效绑定、路由与默认未绑定', () => {
    setRuntimeOperations([{
      id: 'publisher.addon.stamp', command: 'publisher.addon.stamp',
      titleKey: 'command.find.title', titleOverride: '盖时间戳', addonId: 'publisher.addon',
      mode: 'live', writes: true, defaults: ['ctrl+alt+f9'],
    }, {
      id: 'publisher.addon.clean', command: 'publisher.addon.clean',
      titleKey: 'command.find.title', titleOverride: '清理标记', addonId: 'publisher.addon',
      mode: 'both', writes: false, defaults: [],
    }])
    expect(allKeybindingOperations().some((op) => op.id === 'publisher.addon.stamp')).toBe(true)
    expect(getEffectiveBindings({}, 'publisher.addon.stamp')).toEqual(['ctrl+alt+f9'])
    expect(getEffectiveBindings({}, 'publisher.addon.clean')).toEqual([])
    // 路由：live 命中、reading 被 mode 过滤
    expect(resolveKeybinding({}, 'live', 'ctrl+alt+f9', true)).toEqual({ kind: 'command', id: 'publisher.addon.stamp' })
    expect(resolveKeybinding({}, 'reading', 'ctrl+alt+f9', true).kind).toBe('none')
    // 写门控：非正文焦点（allowWrites=false）不劫持写类操作
    expect(resolveKeybinding({}, 'live', 'ctrl+alt+f9', false).kind).toBe('none')
  })

  it('冲突检查跨内置/组件两族（键位与生效模式均重叠才计冲突）', () => {
    setRuntimeOperations([{
      id: 'publisher.addon.bold2', command: 'publisher.addon.bold2',
      titleKey: 'command.find.title', titleOverride: '加粗二号', addonId: 'publisher.addon',
      mode: 'live', writes: true, defaults: ['ctrl+b'], // 与内置粗体（live, ctrl+b）冲突
    }])
    const conflicted = findConflictedOperationIds({})
    expect(conflicted.has('bold')).toBe(true)
    expect(conflicted.has('publisher.addon.bold2')).toBe(true)
    // 模式互斥可复用：reading 命令 + live 默认键不冲突
    setRuntimeOperations([{
      id: 'publisher.addon.readOnly', command: 'publisher.addon.readOnly',
      titleKey: 'command.find.title', titleOverride: '只读', addonId: 'publisher.addon',
      mode: 'reading', writes: false, defaults: ['ctrl+b'],
    }])
    expect(findConflictedOperationIds({}).has('publisher.addon.readOnly')).toBe(false)
  })

  it('显式覆盖与清空语义沿既有契约（覆盖优先于默认；清空 = 显式空数组）', () => {
    setRuntimeOperations([{
      id: 'publisher.addon.stamp', command: 'publisher.addon.stamp',
      titleKey: 'command.find.title', titleOverride: '盖时间戳', addonId: 'publisher.addon',
      mode: 'live', writes: true, defaults: ['ctrl+alt+f9'],
    }])
    expect(getEffectiveBindings({ 'publisher.addon.stamp': ['ctrl+f8'] }, 'publisher.addon.stamp'))
      .toEqual(['ctrl+f8'])
    expect(getEffectiveBindings({ 'publisher.addon.stamp': [] }, 'publisher.addon.stamp')).toEqual([])
  })

  it('存储净化保留命名空间键——组件不在场时用户绑定与显式清空不丢', () => {
    const stored = {
      bold: ['ctrl+alt+b'],
      'publisher.addon.stamp': ['ctrl+f8'],
      'publisher.addon.clean': [],
      'garbage-id': ['ctrl+g'],
    }
    const sanitized = sanitizeStoredOverrides(stored)
    expect(sanitized['publisher.addon.stamp']).toEqual(['ctrl+f8'])
    expect(sanitized['publisher.addon.clean']).toEqual([])
    expect(sanitized['bold']).toEqual(['ctrl+alt+b'])
    expect(sanitized['garbage-id']).toBeUndefined()
  })

  it('运行期表全量替换（幂等对账）：撤下后操作不再路由', () => {
    setRuntimeOperations([{
      id: 'publisher.addon.stamp', command: 'publisher.addon.stamp',
      titleKey: 'command.find.title', titleOverride: '盖时间戳', addonId: 'publisher.addon',
      mode: 'live', writes: true, defaults: ['ctrl+alt+f9'],
    }])
    expect(resolveKeybinding({}, 'live', 'ctrl+alt+f9', true).kind).toBe('command')
    setRuntimeOperations([])
    expect(runtimeOperations()).toEqual([])
    expect(resolveKeybinding({}, 'live', 'ctrl+alt+f9', true).kind).toBe('none')
  })
})

describe('T10 菜单注册形状校验', () => {
  it('合法形状通过；label 空与未登记 iconKey 被拒', () => {
    expect(addonMenuItemProblem({ id: 'stamp', label: '盖时间戳', iconKey: 'link' })).toBeNull()
    expect(addonMenuItemProblem({ id: 'stamp', label: '' })).toBe('label-empty')
    expect(addonMenuItemProblem({ id: 'stamp', label: 'x', iconKey: 'not-in-table' })).toBe('icon-key')
    expect(addonMenuItemProblem({ id: 'bad.id', label: 'x' })).toBe('dot')
  })
})

describe('#395 P3 展示字段封顶（名称类 256，超限整批拒绝不截断）', () => {
  it('命令 title：边界 256 通过、257 拒绝（buildAddonCommandReport 整体返回 null）', () => {
    const base = { id: 'stamp', mode: 'live' as const }
    expect(buildAddonCommandReport('publisher.addon', { ...base, title: 'a'.repeat(ADDON_DISPLAY_TEXT_MAX) })).not.toBeNull()
    expect(buildAddonCommandReport('publisher.addon', { ...base, title: 'a'.repeat(ADDON_DISPLAY_TEXT_MAX + 1) })).toBeNull()
  })

  it('菜单 label：边界 256 通过、超限以 label-too-long 拒绝', () => {
    expect(addonMenuItemProblem({ id: 'stamp', label: 'a'.repeat(ADDON_DISPLAY_TEXT_MAX) })).toBeNull()
    expect(addonMenuItemProblem({ id: 'stamp', label: 'a'.repeat(ADDON_DISPLAY_TEXT_MAX + 1) })).toBe('label-too-long')
  })
})

describe('T10 菜单运行期接入（contextMenu 内核）', () => {
  beforeEach(() => {
    __resetContextMenuRegistryForTest()
    __resetRuntimeOperationsForTest()
  })
  afterEach(() => {
    __resetContextMenuRegistryForTest()
    __resetRuntimeOperationsForTest()
  })

  it('组件菜单项：label 自由文本、独立簇追加在内置簇之后、可执行 handler', () => {
    const cleanup = registerContextMenuItem({
      id: namespacedAddonId('publisher.addon', 'stamp'),
      group: 'addon.publisher.addon',
      order: 0,
      labelKey: 'contextMenu.copy',
      label: '盖时间戳',
      command: 'publisher.addon.stamp',
    })
    const snapshot = contextMenuRegistrySnapshot()
    expect(snapshot.some((def) => def.id === 'publisher.addon.stamp' && def.label === '盖时间戳')).toBe(true)
    const groups = buildContextMenuModel(PLAIN_CTX)
    // 组件簇排在内置三簇（link/blockFormat/clipboard）之后
    expect(groups.map((g) => g.id)).toEqual(['link', 'blockFormat', 'clipboard', 'addon.publisher.addon'])
    const addonGroup = groups[3]
    expect(addonGroup?.items[0]?.label).toBe('盖时间戳')
    cleanup()
    expect(contextMenuRegistrySnapshot().some((def) => def.id === 'publisher.addon.stamp')).toBe(false)
  })

  it('停用回收不影响内置菜单（回收后内置三簇原样）', () => {
    const cleanup = registerContextMenuItem({
      id: namespacedAddonId('publisher.addon', 'stamp'),
      group: 'addon.publisher.addon',
      order: 0,
      labelKey: 'contextMenu.copy',
      label: '盖时间戳',
      command: 'publisher.addon.stamp',
    })
    cleanup()
    const groups = buildContextMenuModel(PLAIN_CTX)
    expect(groups.map((g) => g.id)).toEqual(['link', 'blockFormat', 'clipboard'])
  })

  it('提示列派生覆盖运行期命令（组件命令的生效绑定显示在组件菜单项上）', () => {
    registerContextMenuItem({
      id: namespacedAddonId('publisher.addon', 'stamp'),
      group: 'addon.publisher.addon',
      order: 0,
      labelKey: 'contextMenu.copy',
      label: '盖时间戳',
      command: 'publisher.addon.stamp',
    })
    setRuntimeOperations([{
      id: 'publisher.addon.stamp', command: 'publisher.addon.stamp',
      titleKey: 'command.find.title', titleOverride: '盖时间戳', addonId: 'publisher.addon',
      mode: 'live', writes: true, defaults: ['ctrl+alt+f9'],
    }])
    const hints = contextMenuKeybindingHints({})
    expect(hints['publisher.addon.stamp']).toBe('Ctrl+Alt+F9')
    // 用户覆盖跟随
    expect(contextMenuKeybindingHints({ 'publisher.addon.stamp': ['ctrl+f8'] })['publisher.addon.stamp']).toBe('Ctrl+F8')
  })
})
