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

describe('三态切换命令标题句式（#232）', () => {
  it('操作名与 manifest title 拆键：注册表持无前缀操作名键（原文案），manifest title 键句式化', () => {
    const titleKeyOf = (id: string) =>
      KEYBINDING_OPERATIONS.find((op) => op.id === id)!.titleKey
    // 快捷键注册表换指新增的无前缀操作名键：设置页操作名不带品牌名
    expect(titleKeyOf('toReading')).toBe('operation.toReading')
    expect(titleKeyOf('toSource')).toBe('operation.toSource')
    expect(titleKeyOf('toLive')).toBe('operation.toLive')
    expect(en['operation.toReading']).toBe('Switch to reading view')
    expect(en['operation.toSource']).toBe('Switch to the source editor')
    expect(en['operation.toLive']).toBe('Switch to live preview')
    expect(zhCn['operation.toReading']).toBe('切换到阅读模式')
    expect(zhCn['operation.toSource']).toBe('切换到源码编辑器')
    expect(zhCn['operation.toLive']).toBe('切换到实时预览')
    // manifest title 键（genNls 生成源）改写为归属明确的句式文案
    expect(en['command.mode.toReading.title']).toBe('Switch Vsidian to reading view')
    expect(en['command.mode.toSource.title']).toBe('Switch Vsidian to the source editor')
    expect(en['command.mode.toLive.title']).toBe('Switch Vsidian to live preview')
    expect(zhCn['command.mode.toReading.title']).toBe('将 Vsidian 切换到阅读模式')
    expect(zhCn['command.mode.toSource.title']).toBe('将 Vsidian 切换到源码编辑器')
    expect(zhCn['command.mode.toLive.title']).toBe('将 Vsidian 切换到实时预览')
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

describe('HTML 注释快捷键（#139）', () => {
  it('默认 ctrl+slash（ctrl+/ 物理键）仅 Live 生效；可改绑清空恢复', () => {
    expect(getEffectiveBindings({}, 'htmlComment')).toEqual(['ctrl+slash'])
    expect(resolveKeybinding({}, 'live', 'ctrl+slash')).toEqual({ kind: 'command', id: 'htmlComment' })
    // 阅读模式无写操作：none（源码模式与设置页不经编辑器路由，天然不接管）
    expect(resolveKeybinding({}, 'reading', 'ctrl+slash')).toEqual({ kind: 'none' })
    // 显式清空后不拦截（宿主行注释回归宿主处理）
    expect(resolveKeybinding({ htmlComment: [] }, 'live', 'ctrl+slash')).toEqual({ kind: 'none' })
    // #162 起 ctrl+shift+c 有默认占用（复制块链接）：改绑到该键按冲突拒绝，
    // 改绑到空闲键正常生效
    expect(applyBindingChange({}, 'htmlComment', ['ctrl+shift+c'], false))
      .toMatchObject({ ok: false, reason: 'conflict' })
    expect(applyBindingChange({}, 'htmlComment', ['ctrl+alt+h'], false))
      .toMatchObject({ ok: true })
    expect(getEffectiveBindings({ htmlComment: ['ctrl+alt+h'] }, 'htmlComment'))
      .toEqual(['ctrl+alt+h'])
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

describe('复制块链接快捷键（#162）', () => {
  it('默认 ctrl+shift+c 仅 Live 生效（写操作）；manifest 命令已登记', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const op = KEYBINDING_OPERATIONS.find((item) => item.id === 'blockCopyLink')
    expect(op).toMatchObject({ mode: 'live', writes: true, command: 'onegayi.vsidian.block.copyLink' })
    expect(getEffectiveBindings({}, 'blockCopyLink')).toEqual(['ctrl+shift+c'])
    expect(resolveKeybinding({}, 'live', 'ctrl+shift+c')).toEqual({ kind: 'command', id: 'blockCopyLink' })
    // 阅读只读不接管；源码模式与设置页输入不经编辑器路由，天然不接管
    expect(resolveKeybinding({}, 'reading', 'ctrl+shift+c')).toEqual({ kind: 'none' })
    // 阅读态查表不可达（mode 门）；写门（allowWrites=false）同样不拦截
    expect(resolveKeybinding({}, 'live', 'ctrl+shift+c', false)).toEqual({ kind: 'none' })
    expect(manifest.contributes.commands.some(
      (item: { command: string }) => item.command === 'onegayi.vsidian.block.copyLink')).toBe(true)
    // 显式清空后回落 none（键位归还宿主）；改绑生效
    expect(resolveKeybinding({ blockCopyLink: [] }, 'live', 'ctrl+shift+c')).toEqual({ kind: 'none' })
    expect(applyBindingChange({}, 'blockCopyLink', ['ctrl+alt+b'], false)).toMatchObject({ ok: true })
  })

  it('与全部既有默认键位零冲突（冲突核对 2026-09-28 结论的钉住）', () => {
    expect(findBindingConflicts({}, 'blockCopyLink', 'ctrl+shift+c')).toEqual([])
    expect([...findConflictedOperationIds({})]).toEqual([])
  })
})
