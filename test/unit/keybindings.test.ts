import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  KEYBINDING_OPERATIONS, getEffectiveBindings, normalizeChord,
  findBindingConflicts, applyBindingChange, resolveKeybinding,
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

describe('HTML 注释快捷键（#139）', () => {
  it('默认 ctrl+slash（ctrl+/ 物理键）仅 Live 生效；可改绑清空恢复', () => {
    expect(getEffectiveBindings({}, 'htmlComment')).toEqual(['ctrl+slash'])
    expect(resolveKeybinding({}, 'live', 'ctrl+slash')).toEqual({ kind: 'command', id: 'htmlComment' })
    // 阅读模式无写操作：none（源码模式与设置页不经编辑器路由，天然不接管）
    expect(resolveKeybinding({}, 'reading', 'ctrl+slash')).toEqual({ kind: 'none' })
    // 显式清空后不拦截（宿主行注释回归宿主处理）
    expect(resolveKeybinding({ htmlComment: [] }, 'live', 'ctrl+slash')).toEqual({ kind: 'none' })
    // 改绑到 ctrl+shift+c 生效
    expect(applyBindingChange({}, 'htmlComment', ['ctrl+shift+c'], false))
      .toMatchObject({ ok: true })
    expect(getEffectiveBindings({ htmlComment: ['ctrl+shift+c'] }, 'htmlComment'))
      .toEqual(['ctrl+shift+c'])
  })

  it('slash 键名规范化：词名大小写归一（裸 / 字符不另设别名，与 minus 等符号口径一致）', () => {
    expect(normalizeChord('Ctrl+Slash')).toBe('ctrl+slash')
    expect(normalizeChord('ctrl+slash')).toBe('ctrl+slash')
  })
})

describe('双态视图切换快捷键（#141 增补）', () => {
  it('默认 ctrl+q 双模式生效；manifest 命令已登记', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(getEffectiveBindings({}, 'toggleDualView')).toEqual(['ctrl+q'])
    expect(resolveKeybinding({}, 'live', 'ctrl+q')).toEqual({ kind: 'command', id: 'toggleDualView' })
    expect(resolveKeybinding({}, 'reading', 'ctrl+q')).toEqual({ kind: 'command', id: 'toggleDualView' })
    expect(manifest.contributes.commands.some(
      (item: { command: string }) => item.command === 'onegayi.vsidian.mode.toggleDualView')).toBe(true)
    // 显式清空后回落 none（宿主键位归还宿主）；改绑生效
    expect(resolveKeybinding({ toggleDualView: [] }, 'live', 'ctrl+q')).toEqual({ kind: 'none' })
    expect(applyBindingChange({}, 'toggleDualView', ['ctrl+alt+r'], false)).toMatchObject({ ok: true })
  })

  it('与三态切换语义并存：toggleViewMode 仍无默认键，键位互不冲突', () => {
    const conflicts = findBindingConflicts({}, 'toggleDualView', 'ctrl+q')
    expect(conflicts).toEqual([])
  })
})
