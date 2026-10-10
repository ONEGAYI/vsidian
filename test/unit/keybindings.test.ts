import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  KEYBINDING_OPERATIONS, getEffectiveBindings, normalizeChord,
  findBindingConflicts, findConflictedOperationIds, operationMatchesFilter,
  applyBindingChange, resolveKeybinding, formatBindingLabel,
  setKeybindingLabelPlatform, __resetKeybindingLabelPlatformForTest,
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

describe('预览当前链接快捷键（#221）', () => {
  it('UI 操作登记：默认未绑定、双模式生效、非写操作；manifest 命令已登记', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const op = KEYBINDING_OPERATIONS.find((item) => item.id === 'hoverPreviewLink')
    expect(op).toMatchObject({
      mode: 'both',
      writes: false,
      command: 'onegayi.vsidian.ui.hoverPreviewLink',
      titleKey: 'command.ui.hoverPreviewLink.title',
    })
    // 默认未绑定：键位留给用户按需绑定（目标判定依赖光标/聚焦上下文）
    expect(getEffectiveBindings({}, 'hoverPreviewLink')).toEqual([])
    expect(manifest.contributes.commands.some(
      (item: { command: string }) => item.command === 'onegayi.vsidian.ui.hoverPreviewLink')).toBe(true)
    // 用户可绑定：绑定后在两模式均解析命中（只读操作不受写门影响）
    expect(resolveKeybinding({ hoverPreviewLink: ['ctrl+alt+p'] }, 'live', 'ctrl+alt+p'))
      .toEqual({ kind: 'command', id: 'hoverPreviewLink' })
    expect(resolveKeybinding({ hoverPreviewLink: ['ctrl+alt+p'] }, 'reading', 'ctrl+alt+p'))
      .toEqual({ kind: 'command', id: 'hoverPreviewLink' })
    expect(resolveKeybinding({ hoverPreviewLink: ['ctrl+alt+p'] }, 'live', 'ctrl+alt+p', false))
      .toEqual({ kind: 'command', id: 'hoverPreviewLink' })
    // 显式清空 = 禁用（清空不因升级恢复——存储语义由 overrides 承担）
    expect(resolveKeybinding({ hoverPreviewLink: [] }, 'live', 'ctrl+alt+p')).toEqual({ kind: 'none' })
  })

  it('默认零键位与既有操作零冲突（冲突核对钉住）', () => {
    expect(findBindingConflicts({}, 'hoverPreviewLink', 'ctrl+alt+p')).toEqual([])
    expect([...findConflictedOperationIds({})]).toEqual([])
  })
})

describe('查找替换快捷键（#236）', () => {
  it('findReplace 默认 ctrl+h 仅 Live 非写（2026-10 阅读整体禁用替换）；替换操作默认未绑定仅 Live', () => {
    const replace = KEYBINDING_OPERATIONS.find((op) => op.id === 'findReplace')
    expect(replace).toMatchObject({ mode: 'live', writes: false })
    expect(getEffectiveBindings({}, 'findReplace')).toEqual(['ctrl+h'])
    // 生效模式收窄到 Live：阅读模式键路由不消费 ctrl+h（替换是 Live 编辑
    // 能力——面板不开、替换栏 toggle disabled，live 展开记忆不被触碰）
    expect(resolveKeybinding({}, 'live', 'ctrl+h')).toEqual({ kind: 'command', id: 'findReplace' })
    expect(resolveKeybinding({}, 'reading', 'ctrl+h')).toEqual({ kind: 'none' })
    const next = KEYBINDING_OPERATIONS.find((op) => op.id === 'findReplaceNext')
    expect(next).toMatchObject({ mode: 'live' })
    expect(getEffectiveBindings({}, 'findReplaceNext')).toEqual([])
    const all = KEYBINDING_OPERATIONS.find((op) => op.id === 'findReplaceAll')
    expect(all).toMatchObject({ mode: 'live' })
    expect(getEffectiveBindings({}, 'findReplaceAll')).toEqual([])
  })

  it('与全部既有默认键位零冲突（ctrl+h 冲突核对 2026-09-30）', () => {
    const conflicted = findConflictedOperationIds({})
    expect(conflicted.has('findReplace')).toBe(false)
    expect(conflicted.has('findReplaceNext')).toBe(false)
    expect(conflicted.has('findReplaceAll')).toBe(false)
  })

  it('manifest 命令已登记（三面同源）', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const commands = manifest.contributes.commands.map((item: { command: string }) => item.command)
    expect(commands).toContain('onegayi.vsidian.find.replace')
    expect(commands).toContain('onegayi.vsidian.find.replaceNext')
    expect(commands).toContain('onegayi.vsidian.find.replaceAll')
  })
})

describe('标题折叠快捷键（#413，#409 T02）', () => {
  const foldOps = [
    { id: 'headingFold', command: 'onegayi.vsidian.heading.fold', titleKey: 'command.heading.fold.title',
      defaults: ['ctrl+shift+bracketleft', 'alt+meta+bracketleft'] },
    { id: 'headingUnfold', command: 'onegayi.vsidian.heading.unfold', titleKey: 'command.heading.unfold.title',
      defaults: ['ctrl+shift+bracketright', 'alt+meta+bracketright'] },
    { id: 'headingToggleFold', command: 'onegayi.vsidian.heading.toggleFold', titleKey: 'command.heading.toggleFold.title',
      defaults: ['ctrl+k ctrl+l', 'meta+k meta+l'] },
    { id: 'headingFoldAll', command: 'onegayi.vsidian.heading.foldAll', titleKey: 'command.heading.foldAll.title',
      defaults: ['ctrl+k ctrl+0', 'meta+k meta+0'] },
    { id: 'headingUnfoldAll', command: 'onegayi.vsidian.heading.unfoldAll', titleKey: 'command.heading.unfoldAll.title',
      defaults: ['ctrl+k ctrl+j', 'meta+k meta+j'] },
  ] as const

  it('五操作登记：Live 生效、非写（视图态零写回）、默认键对齐 VSCode 惯例（含 mac 形态）', () => {
    for (const expected of foldOps) {
      const op = KEYBINDING_OPERATIONS.find((item) => item.id === expected.id)
      expect(op, expected.id).toBeDefined()
      expect(op, expected.id).toMatchObject({
        mode: 'live', writes: false, command: expected.command, titleKey: expected.titleKey,
      })
      expect(getEffectiveBindings({}, expected.id), expected.id).toEqual([...expected.defaults])
    }
  })

  it('生效模式 = Live：阅读模式键路由不消费（折叠是 Live 编辑器视图态）', () => {
    expect(resolveKeybinding({}, 'live', 'ctrl+shift+bracketleft')).toEqual({ kind: 'command', id: 'headingFold' })
    expect(resolveKeybinding({}, 'reading', 'ctrl+shift+bracketleft')).toEqual({ kind: 'none' })
    for (const chord of ['ctrl+k ctrl+l', 'ctrl+k ctrl+0', 'ctrl+k ctrl+j']) {
      expect(resolveKeybinding({}, 'reading', chord)).toEqual({ kind: 'none' })
    }
  })

  it('物理键名规范化：bracketleft/bracketright 在白名单内可改绑；修饰键序按规范形态', () => {
    expect(normalizeChord('ctrl+shift+bracketleft')).toBe('ctrl+shift+bracketleft')
    // 存储默认不再次归一：mac 默认按规范序 ctrl→alt→shift→meta 书写
    //（非规范序永不匹配 keyStep 派生的事件串——resolveKeybinding 整串比较）
    expect(normalizeChord('meta+alt+bracketright')).toBe('alt+meta+bracketright')
    expect(applyBindingChange({}, 'headingFold', ['ctrl+alt+bracketleft'], false).ok).toBe(true)
  })

  it('与全部既有默认键位零冲突（#240 收口形态复核，2026-10-09）', () => {
    // Ctrl+Shift+[ / ] 与全部注册表默认零占用；Ctrl+K 弦与既有唯一弦
    // ctrl+k ctrl+d 首段重叠但整串精确匹配不冲突（chordOverlap 按整弦）
    for (const expected of foldOps) {
      for (const chord of expected.defaults) {
        expect(findBindingConflicts({}, expected.id, chord), `${expected.id} ${chord}`).toEqual([])
      }
    }
    expect([...findConflictedOperationIds({})]).toEqual([])
  })

  it('manifest 命令已登记（三面同源）', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const commands = manifest.contributes.commands.map((item: { command: string }) => item.command)
    for (const expected of foldOps) {
      expect(commands, expected.command).toContain(expected.command)
    }
  })

  it('键位展示：符号物理键名渲染为字符（设置页标签不出现 BRACKETLEFT 大写名）', () => {
    expect(formatBindingLabel('ctrl+shift+bracketleft')).toBe('Ctrl+Shift+[')
    expect(formatBindingLabel('ctrl+shift+bracketright')).toBe('Ctrl+Shift+]')
    expect(formatBindingLabel('ctrl+k ctrl+l')).toBe('Ctrl+K Ctrl+L')
  })
})

describe('默认键位规范序契约（#417：pastePlain mac 默认键序永不命中修复）', () => {
  it('pastePlain 的 mac 默认在真实按键事件派生序下命中（Cmd+Shift+V → shift+meta+v）', () => {
    // keyStep（keybindingRouter.ts）按 ctrl→alt→shift→meta 序拼事件串再归一，
    // mac 真实按下 Cmd+Shift+V 派生 shift+meta+v；resolveKeybinding 与存储
    // 默认整串字面比较，存储串必须按同一规范序书写才可命中
    expect(resolveKeybinding({}, 'live', 'shift+meta+v')).toEqual({ kind: 'command', id: 'pastePlain' })
    expect(resolveKeybinding({}, 'live', 'ctrl+shift+v')).toEqual({ kind: 'command', id: 'pastePlain' })
  })

  it('全部默认绑定均按修饰键规范序书写（存储默认不再次归一，非规范序永不匹配）', () => {
    // 同批排查结论的钉住断言：非规范序书写（如 meta 在 shift 前）在
    // normalizeChord 下会改变形态，自归一等值即规范序书写
    for (const op of KEYBINDING_OPERATIONS) {
      for (const chord of op.defaults) {
        expect(normalizeChord(chord), `${op.id}: ${chord}`).toBe(chord)
      }
    }
  })

  it('每个默认绑定在其生效模式下经真实按键归一化序可命中所属操作', () => {
    for (const op of KEYBINDING_OPERATIONS) {
      for (const chord of op.defaults) {
        const mode = op.mode === 'reading' ? 'reading' : 'live'
        expect(resolveKeybinding({}, mode, chord), `${op.id}: ${chord}`)
          .toEqual({ kind: 'command', id: op.id })
      }
    }
  })
})

describe('键位标签平台渲染（#444：meta 不再固定 Win）', () => {
  afterEach(() => __resetKeybindingLabelPlatformForTest())

  it('mac 平台 meta 渲染为 Cmd（设置页 pastePlain 显示 Cmd+Shift+V，与用户视角描述一致）', () => {
    setKeybindingLabelPlatform('mac')
    expect(formatBindingLabel('shift+meta+v')).toBe('Cmd+Shift+V')
    expect(formatBindingLabel('meta+f')).toBe('Cmd+F')
    expect(formatBindingLabel('alt+meta+bracketleft')).toBe('Cmd+Alt+[')
    expect(formatBindingLabel('meta+k meta+l')).toBe('Cmd+K Cmd+L')
  })

  it('Windows 平台 meta 渲染为 Win（既有形态不变）', () => {
    setKeybindingLabelPlatform('windows')
    expect(formatBindingLabel('shift+meta+v')).toBe('Shift+Win+V')
    expect(formatBindingLabel('meta+f')).toBe('Win+F')
  })

  it('Linux 平台 meta 渲染为 Super（对齐宿主 VSCode 惯例）', () => {
    setKeybindingLabelPlatform('linux')
    expect(formatBindingLabel('shift+meta+v')).toBe('Shift+Super+V')
    expect(formatBindingLabel('meta+f')).toBe('Super+F')
  })

  it('平台只影响 meta 标签：非 meta 键位与符号渲染不随平台变化（跨端一致）', () => {
    for (const platform of ['mac', 'windows', 'linux'] as const) {
      setKeybindingLabelPlatform(platform)
      expect(formatBindingLabel('ctrl+shift+bracketleft'), platform).toBe('Ctrl+Shift+[')
      expect(formatBindingLabel('ctrl+k ctrl+l'), platform).toBe('Ctrl+K Ctrl+L')
    }
  })

  it('UA 探测分支：三平台映射与首访缓存语义（webview 默认路径的护栏）', () => {
    const original = navigator.userAgent
    const setUa = (value: string) =>
      Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
    try {
      setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36')
      __resetKeybindingLabelPlatformForTest()
      expect(formatBindingLabel('shift+meta+v')).toBe('Cmd+Shift+V')
      setUa('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Safari/537.36')
      __resetKeybindingLabelPlatformForTest()
      expect(formatBindingLabel('meta+f')).toBe('Super+F')
      setUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Safari/537.36')
      __resetKeybindingLabelPlatformForTest()
      expect(formatBindingLabel('shift+meta+v')).toBe('Shift+Win+V')
      // 首访探测并缓存：缓存生效后再改 UA 不影响渲染
      setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Safari/537.36')
      expect(formatBindingLabel('meta+f')).toBe('Win+F')
    } finally {
      setUa(original)
      __resetKeybindingLabelPlatformForTest()
    }
  })
})
