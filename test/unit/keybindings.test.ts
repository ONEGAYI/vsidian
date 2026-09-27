import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  KEYBINDING_OPERATIONS, getEffectiveBindings, normalizeChord,
  findBindingConflicts, findConflictedOperationIds, operationMatchesFilter,
  applyBindingChange, resolveKeybinding,
  type KeybindingOverrides,
} from '../../src/shared/keybindings'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'

describe('快捷键契约', () => {
  it('登记全部用户命令并保留固定默认值', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(KEYBINDING_OPERATIONS.map((op) => op.command).sort()).toEqual(
      manifest.contributes.commands.map((item: { command: string }) => item.command).sort())
    expect(KEYBINDING_OPERATIONS.find((op) => op.id === 'bold')?.defaults).toEqual(['ctrl+b'])
    for (let n = 0; n <= 6; n++) {
      const id = n ? `heading${n}` : 'headingNone'
      expect(KEYBINDING_OPERATIONS.find((op) => op.id === id)?.defaults).toEqual([`ctrl+${n}`])
    }
    for (const id of ['inlineMath', 'blockMath', 'wikilink', 'highlight', 'horizontalRule']) {
      expect(getEffectiveBindings({}, id)).toEqual([])
    }
  })

  it('全部操作名持字典键：titleKey 在两语言包中都有词条', () => {
    for (const op of KEYBINDING_OPERATIONS) {
      expect(typeof en[op.titleKey], `${op.id} 的 titleKey 缺 en 词条`).toBe('string')
      expect(typeof zhCn[op.titleKey], `${op.id} 的 titleKey 缺 zh-cn 词条`).toBe('string')
    }
  })

  it('缺省、显式清空和覆盖是不同状态', () => {
    expect(getEffectiveBindings({}, 'bold')).toEqual(['ctrl+b'])
    expect(getEffectiveBindings({ bold: [] }, 'bold')).toEqual([])
    expect(getEffectiveBindings({ bold: ['ctrl+k ctrl+b', 'ctrl+shift+b'] }, 'bold'))
      .toEqual(['ctrl+k ctrl+b', 'ctrl+shift+b'])
    expect(resolveKeybinding({ italic: ['ctrl+b'] }, 'live', 'ctrl+b'))
      .toEqual({ kind: 'command', id: 'italic' })
  })

  it('规范化输入并排除修饰键独立绑定', () => {
    expect(normalizeChord(' Control + Shift + B ')).toBe('ctrl+shift+b')
    expect(normalizeChord('ctrl+k ctrl+b')).toBe('ctrl+k ctrl+b')
    expect(normalizeChord('ctrl')).toBeNull()
    expect(normalizeChord('ctrl+k ctrl+b ctrl+c')).toBeNull()
  })

  it('重叠范围下同键和单段前缀冲突，互斥范围不冲突', () => {
    const custom: KeybindingOverrides = { bold: ['ctrl+k ctrl+b'] }
    expect(findBindingConflicts(custom, 'italic', 'ctrl+k')).toContain('bold')
    expect(findBindingConflicts(custom, 'italic', 'ctrl+k ctrl+b')).toContain('bold')
    expect(findBindingConflicts({ toReading: ['ctrl+k'] }, 'toLive', 'ctrl+k')).toEqual([])
  })

  it('显式替换只移走冲突项并保留其余绑定', () => {
    const before: KeybindingOverrides = { bold: ['ctrl+b', 'ctrl+k ctrl+b'] }
    expect(applyBindingChange(before, 'italic', ['ctrl+b'], false).ok).toBe(false)
    const result = applyBindingChange(before, 'italic', ['ctrl+b'], true)
    expect(result).toMatchObject({ ok: true, overrides: { bold: ['ctrl+k ctrl+b'], italic: ['ctrl+b'] } })
  })

  it('首段等待、超时/取消和完整两段键解析', () => {
    const overrides: KeybindingOverrides = { bold: ['ctrl+k ctrl+b'] }
    expect(resolveKeybinding(overrides, 'live', 'ctrl+k')).toEqual({ kind: 'prefix' })
    expect(resolveKeybinding(overrides, 'live', 'ctrl+k ctrl+b')).toEqual({ kind: 'command', id: 'bold' })
    expect(resolveKeybinding(overrides, 'reading', 'ctrl+k')).toEqual({ kind: 'none' })
    expect(resolveKeybinding({}, 'live', 'ctrl+b', false)).toEqual({ kind: 'none' })
    expect(resolveKeybinding({}, 'reading', 'f3', false)).toEqual({ kind: 'command', id: 'findNext' })
  })
})

describe('快捷键筛选签（#155）', () => {
  it('冲突集合：生效模式可交叠且键位重叠的双方都计入；互斥模式与无绑定不计', () => {
    expect(findConflictedOperationIds({}).size).toBe(0)
    // find（both，默认 ctrl+f）改绑 ctrl+b 后与 bold（live，ctrl+b）互为冲突
    const ids = findConflictedOperationIds({ find: ['ctrl+b'] })
    expect(ids.has('find')).toBe(true)
    expect(ids.has('bold')).toBe(true)
    expect(ids.has('italic')).toBe(false)
    // toReading（reading）与 toLive（live）模式互斥，同键不冲突
    expect(findConflictedOperationIds({ toReading: ['ctrl+k'] }).has('toLive')).toBe(false)
  })

  it('筛选谓词：显式清空归未分配且算由我分配，默认绑定算已分配', () => {
    const overrides: KeybindingOverrides = { bold: [], italic: ['ctrl+b'] }
    expect(operationMatchesFilter(overrides, 'bold', 'all')).toBe(true)
    expect(operationMatchesFilter(overrides, 'bold', 'unassigned')).toBe(true)
    expect(operationMatchesFilter(overrides, 'bold', 'assigned')).toBe(false)
    expect(operationMatchesFilter(overrides, 'bold', 'userAssigned')).toBe(true)
    expect(operationMatchesFilter(overrides, 'italic', 'assigned')).toBe(true)
    expect(operationMatchesFilter(overrides, 'heading1', 'userAssigned')).toBe(false)
    // 默认键位生效即已分配（如 find 默认 ctrl+f）；默认未绑定的操作归未分配
    expect(operationMatchesFilter({}, 'find', 'assigned')).toBe(true)
    expect(operationMatchesFilter({}, 'toReading', 'unassigned')).toBe(true)
    expect(operationMatchesFilter({}, 'toReading', 'assigned')).toBe(false)
  })

  it('筛选谓词：冲突维度复用冲突集合判定', () => {
    const overrides: KeybindingOverrides = { find: ['ctrl+b'] }
    expect(operationMatchesFilter(overrides, 'bold', 'conflict')).toBe(true)
    expect(operationMatchesFilter(overrides, 'find', 'conflict')).toBe(true)
    expect(operationMatchesFilter(overrides, 'italic', 'conflict')).toBe(false)
  })
})
