// 统一右键菜单内核纯函数契约（shared/contextMenu.ts，#183）：描述符表
// （id 唯一/组存在/图标 key 或徽标/内置最深两级）、覆写层语义（后注册胜/
// 隐藏不删/来源记录）、定位纯函数（视口 clamp + 子菜单左右翻转矩阵）、
// 安全降级矩阵（逐区域 enable/when）、键位提示派生（剪贴板四项固定 + 键位
// 注册表派生）。命中判定（contextMenuBlockTargetAt）自 blockMenu.test.ts
// 迁移（断言语义不变）。DOM 装配契约在 contextMenuDom.test.ts。
import { describe, expect, it, afterEach } from 'vitest'
import {
  CONTEXT_MENU_GROUP_ORDER,
  CONTEXT_MENU_ICON_KEYS,
  CONTEXT_MENU_ITEMS,
  buildContextMenuModel,
  buildMenuModel,
  contextMenuBlockTargetAt,
  contextMenuItemSources,
  contextMenuKeybindingHints,
  contextMenuRegistrySnapshot,
  contextMenuZoneAt,
  hideContextMenuItem,
  menuViewportPosition,
  overrideContextMenuItem,
  registerContextMenuItem,
  submenuSide,
  __resetContextMenuRegistryForTest,
  type MenuContextSnapshot,
  type MenuItemDescriptor,
} from '../../src/shared/contextMenu'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'

afterEach(() => {
  __resetContextMenuRegistryForTest()
})

/** 全部内置描述符（含子菜单递归） */
function flattenItems(defs: readonly MenuItemDescriptor[]): MenuItemDescriptor[] {
  const out: MenuItemDescriptor[] = []
  for (const def of defs) {
    out.push(def)
    if (def.children) {
      out.push(...flattenItems(def.children))
    }
  }
  return out
}

const normalCtx = (over: Partial<MenuContextSnapshot> = {}): MenuContextSnapshot => ({
  zone: 'normal',
  hasSelection: false,
  blockTarget: { block: { start: 0, end: 0 }, heading: null },
  ...over,
})

const modelIds = (ctx: MenuContextSnapshot) =>
  buildContextMenuModel(ctx).flatMap((group) => group.items.map((item) => item.id))

describe('描述符表契约（CONTEXT_MENU_ITEMS）', () => {
  const all = flattenItems(CONTEXT_MENU_ITEMS)

  it('id 全局唯一（含子项）', () => {
    const ids = all.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每项 group 已登记且 labelKey 在两语言包中存在（双包 parity 抽查）', () => {
    for (const def of all) {
      expect(CONTEXT_MENU_GROUP_ORDER.includes(def.group as (typeof CONTEXT_MENU_GROUP_ORDER)[number]),
        `${def.id} 的 group ${def.group} 未登记`).toBe(true)
      expect(en[def.labelKey], `${def.id} 的 labelKey ${def.labelKey} 缺英文词条`).toBeDefined()
      expect(zhCn[def.labelKey], `${def.id} 的 labelKey ${def.labelKey} 缺中文词条`).toBeDefined()
    }
  })

  it('图标 key 在图标 key 表内；badge 与 iconKey 互斥使用', () => {
    for (const def of all) {
      if (def.iconKey !== undefined) {
        expect((CONTEXT_MENU_ICON_KEYS as readonly string[]).includes(def.iconKey),
          `${def.id} 的 iconKey ${def.iconKey} 未登记`).toBe(true)
      }
      if (def.badge !== undefined) {
        expect(def.iconKey, `${def.id} 徽标项不得同时携带图标位`).toBeUndefined()
      }
    }
  })

  it('内置菜单最深两级（根 → 子菜单）', () => {
    expect(CONTEXT_MENU_ITEMS.some((def) =>
      (def as MenuItemDescriptor).children?.some((child) => child.children?.length))).toBe(false)
  })

  it('三簇齐全：链接 / 块与格式 / 剪贴板（组序即簇序）', () => {
    const groups = buildContextMenuModel(normalCtx()).map((group) => group.id)
    expect(groups).toEqual(['link', 'blockFormat', 'clipboard'])
  })

  it('剪贴板四项与块链接命令在内置命令集中', () => {
    const commands = new Set(all.map((def) => def.command))
    for (const command of ['cut', 'copy', 'paste', 'selectAll', 'copyHeadingLink', 'copyBlockLink', 'insertTable']) {
      expect(commands.has(command), `${command} 应在内置命令集`).toBe(true)
    }
  })
})

describe('覆写层语义（运行期注册表，内置 = 第一个注册者）', () => {
  it('内置全量经运行期层渲染，无第二套代码路径', () => {
    const registryIds = contextMenuRegistrySnapshot().map((def) => def.id).sort()
    const builtinIds = flattenItems(CONTEXT_MENU_ITEMS).map((def) => def.id).sort()
    expect(registryIds).toEqual(builtinIds)
    // 渲染走 registry：标题行上下文（when 全放行）能拿到全部顶级项，且子项
    // 不因扁平注册表被提升为顶级项
    const headingCtx = normalCtx({
      blockTarget: { block: { start: 4, end: 4 }, heading: { level: 1, text: '标题' } },
    })
    expect(modelIds(headingCtx).sort()).toEqual(
      CONTEXT_MENU_ITEMS.map((def) => def.id).sort())
  })

  it('register 新增项：出现在模型中且来源记录为 runtime', () => {
    registerContextMenuItem({
      id: 'customHello', group: 'link', order: 99,
      command: 'customHello', labelKey: 'contextMenu.selectAll',
    }, 'test-extension')
    expect(modelIds(normalCtx())).toContain('customHello')
    expect(contextMenuItemSources()['customHello']).toBe('test-extension')
  })

  it('override 换文案键与 enable：生效且来源更新', () => {
    expect(overrideContextMenuItem('selectAll', { labelKey: 'contextMenu.copy' }, 'ext-a')).toBe(true)
    const item = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'selectAll')!
    expect(item.labelKey).toBe('contextMenu.copy')
    expect(contextMenuItemSources()['selectAll']).toBe('ext-a')
  })

  it('override enable=false：置灰但仍在场（可见性不变）', () => {
    overrideContextMenuItem('selectAll', { enable: () => false })
    const item = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'selectAll')!
    expect(item.enabled).toBe(false)
  })

  it('隐藏内置项：不渲染但不删（registry 条目仍在）；cleanup 恢复', () => {
    expect(hideContextMenuItem('selectAll')).toBe(true)
    expect(modelIds(normalCtx())).not.toContain('selectAll')
    expect(contextMenuRegistrySnapshot().map((d) => d.id)).toContain('selectAll')
    __resetContextMenuRegistryForTest()
    expect(modelIds(normalCtx())).toContain('selectAll')
  })

  it('同 id 后注册者胜（register 覆盖内置；cleanup 还原内置）', () => {
    const cleanup = registerContextMenuItem({
      id: 'selectAll', group: 'clipboard', order: 3,
      command: 'selectAll', labelKey: 'contextMenu.copy',
    }, 'ext-b')
    const item = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'selectAll')!
    expect(item.labelKey).toBe('contextMenu.copy')
    expect(contextMenuItemSources()['selectAll']).toBe('ext-b')
    cleanup()
    expect(contextMenuItemSources()['selectAll']).toBe('builtin')
    const restored = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'selectAll')!
    expect(restored.labelKey).toBe('contextMenu.selectAll')
  })

  it('override 不存在的 id 返回 false（内置项不可删、不可伪造父级覆写）', () => {
    expect(overrideContextMenuItem('nonexistent', { labelKey: 'contextMenu.copy' })).toBe(false)
    expect(hideContextMenuItem('nonexistent')).toBe(false)
  })
})

describe('空组收起（可见项为零时整组连同分隔线消失；置灰不触发收起）', () => {
  it('隐藏整组全部项：组从模型消失', () => {
    for (const def of flattenItems(CONTEXT_MENU_ITEMS).filter((d) => d.group === 'clipboard')) {
      hideContextMenuItem(def.id)
    }
    expect(buildContextMenuModel(normalCtx()).map((g) => g.id)).toEqual(['link', 'blockFormat'])
  })

  it('组内全部置灰：组不收起', () => {
    for (const def of flattenItems(CONTEXT_MENU_ITEMS).filter((d) => d.group === 'clipboard')) {
      overrideContextMenuItem(def.id, { enable: () => false })
    }
    const groups = buildContextMenuModel(normalCtx())
    expect(groups.map((g) => g.id)).toContain('clipboard')
    expect(groups.find((g) => g.id === 'clipboard')!.items.every((i) => !i.enabled)).toBe(true)
  })

  it('子项全部隐藏：父项随之隐藏（子菜单无叶不可留）', () => {
    for (const def of flattenItems(CONTEXT_MENU_ITEMS)) {
      if (def.group !== 'blockFormat' || !def.children) {
        continue
      }
      for (const child of def.children) {
        hideContextMenuItem(child.id)
      }
      hideContextMenuItem(def.id)
    }
    expect(modelIds(normalCtx())).toEqual(['insertWikilink', 'insertExternalLink', 'copyBlockLink',
      'cut', 'copy', 'paste', 'selectAll'])
  })
})

describe('安全降级矩阵（逐区域 when/enable）', () => {
  const paraCtx = normalCtx({ blockTarget: { block: { start: 4, end: 4 }, heading: null } })
  const headingCtx = normalCtx({ blockTarget: { block: { start: 4, end: 4 }, heading: { level: 1, text: '标题' } } })
  const blankCtx = normalCtx({ blockTarget: null })

  const itemOf = (ctx: MenuContextSnapshot, id: string) =>
    buildContextMenuModel(ctx).flatMap((g) => g.items).find((i) => i.id === id)

  it('普通正文（有选区）：三簇全亮；无选区时剪切/复制置灰', () => {
    const items = buildContextMenuModel({ ...paraCtx, hasSelection: true }).flatMap((g) => g.items)
    expect(items.every((i) => i.enabled)).toBe(true)
  })

  it('正文有选区：剪切/复制亮；无选区置灰', () => {
    expect(itemOf(normalCtx({ ...paraCtx, hasSelection: true }), 'cut')!.enabled).toBe(true)
    expect(itemOf(normalCtx({ ...paraCtx, hasSelection: true }), 'copy')!.enabled).toBe(true)
    expect(itemOf(paraCtx, 'cut')!.enabled).toBe(false)
    expect(itemOf(paraCtx, 'copy')!.enabled).toBe(false)
    expect(itemOf(paraCtx, 'paste')!.enabled).toBe(true)
    expect(itemOf(paraCtx, 'selectAll')!.enabled).toBe(true)
  })

  it('空行：接管菜单；块链接两项隐藏（无块目标）；其余可用', () => {
    const ids = modelIds(blankCtx)
    expect(ids).not.toContain('copyBlockLink')
    expect(ids).toContain('insertWikilink')
    expect(ids).toContain('cut')
  })

  it('标题行：复制标题链接在场', () => {
    expect(modelIds(headingCtx)).toContain('copyHeadingLink')
    expect(modelIds(paraCtx)).not.toContain('copyHeadingLink')
  })

  const sensitiveZones = ['table', 'fence', 'graphic'] as const
  for (const zone of sensitiveZones) {
    it(`${zone} 区：簇 1 新增两项置灰、簇 2 整簇置灰（父与子）、块链接亮、剪贴板可用`, () => {
      const ctx = normalCtx({
        zone,
        hasSelection: true,
        blockTarget: { block: { start: 0, end: 2 }, heading: null },
      })
      const groups = buildContextMenuModel(ctx)
      const link = groups.find((g) => g.id === 'link')!
      expect(link.items.find((i) => i.id === 'insertWikilink')!.enabled).toBe(false)
      expect(link.items.find((i) => i.id === 'insertExternalLink')!.enabled).toBe(false)
      expect(link.items.find((i) => i.id === 'copyBlockLink')!.enabled).toBe(true)
      const format = groups.find((g) => g.id === 'blockFormat')!
      expect(format.items.every((i) => !i.enabled), '簇 2 父项全置灰').toBe(true)
      const bold = format.items.flatMap((i) => i.children ?? []).find((c) => c.id === 'bold')!
      expect(bold.enabled, '簇 2 子项随父置灰').toBe(false)
      const clipboard = groups.find((g) => g.id === 'clipboard')!
      expect(clipboard.items.every((i) => i.enabled)).toBe(true)
    })
  }
})

describe('勾选态与提示列（内核字段承载）', () => {
  it('checked 谓词：渲染为勾选；未声明恒 false', () => {
    overrideContextMenuItem('selectAll', { checked: (ctx) => ctx.zone === 'normal' })
    const item = buildContextMenuModel(normalCtx({ zone: 'table' }))
      .flatMap((g) => g.items).find((i) => i.id === 'selectAll')!
    expect(item.checked).toBe(false)
  })

  it('hint 注入：按菜单项 id 透传；未提供不占位', () => {
    const groups = buildContextMenuModel(normalCtx(), { bold: 'Ctrl+B', selectAll: 'Ctrl+A' })
    const flat = groups.flatMap((g) => [...g.items, ...g.items.flatMap((i) => [...(i.children ?? [])])])
    const bold = flat.find((i) => i.id === 'bold')!
    expect(bold.hint).toBe('Ctrl+B')
    const italic = flat.find((i) => i.id === 'italic')!
    expect(italic.hint).toBeUndefined()
  })
})

describe('键位提示派生（contextMenuKeybindingHints）', () => {
  it('剪贴板四项固定提示；不新增键位注册表条目', () => {
    const hints = contextMenuKeybindingHints({})
    expect(hints['cut']).toBe('Ctrl+X')
    expect(hints['copy']).toBe('Ctrl+C')
    expect(hints['paste']).toBe('Ctrl+V')
    expect(hints['selectAll']).toBe('Ctrl+A')
  })

  it('格式项派生自键位注册表：默认绑定取显示形态，用户覆盖生效，未绑定不出现', () => {
    const defaults = contextMenuKeybindingHints({})
    expect(defaults['bold']).toBe('Ctrl+B')
    expect(defaults['italic']).toBe('Ctrl+I') // 注册表默认（extra 构造中的 ctrl+i 特例）
    const overridden = contextMenuKeybindingHints({ italic: ['ctrl+alt+i'] })
    expect(overridden['italic']).toBe('Ctrl+Alt+I')
    const cleared = contextMenuKeybindingHints({ bold: [] })
    expect(cleared['bold']).toBeUndefined()
  })
})

describe('命中判定（contextMenuBlockTargetAt，自 blockMenu 迁移）', () => {
  const DOC = [
    '---',
    'title: 头区行',
    '---',
    '',
    '# 标题一',
    '',
    '普通段落甲',
    '段落甲第二行',
    '',
    '```js',
    'const a = 1',
    '```',
  ]

  it('标题行：命中块 = 标题行自身，heading 非空（字面文本）', () => {
    expect(contextMenuBlockTargetAt(DOC, 4, 2)).toEqual({
      block: { start: 4, end: 4 },
      heading: { level: 1, text: '标题一' },
    })
  })

  it('普通块：命中块 = 空行分界的连续行组，heading 为 null', () => {
    expect(contextMenuBlockTargetAt(DOC, 6, 2)).toEqual({ block: { start: 6, end: 7 }, heading: null })
    expect(contextMenuBlockTargetAt(DOC, 7, 2)).toEqual({ block: { start: 6, end: 7 }, heading: null })
  })

  it('围栏块：点击围栏内部任一行 = 整个围栏块，且无标题语义', () => {
    for (const i of [9, 10, 11]) {
      expect(contextMenuBlockTargetAt(DOC, i, 2)).toEqual({ block: { start: 9, end: 11 }, heading: null })
    }
  })

  it('围栏内的 # 行不是标题（代码内容）', () => {
    const lines = ['```md', '# 伪标题', '```', '', '# 真标题']
    expect(contextMenuBlockTargetAt(lines, 1, -1)).toEqual({ block: { start: 0, end: 2 }, heading: null })
    expect(contextMenuBlockTargetAt(lines, 4, -1)).toEqual({
      block: { start: 4, end: 4 },
      heading: { level: 1, text: '真标题' },
    })
  })

  it('frontmatter 头区（含结束行）不接管；头区后的正文照常', () => {
    expect(contextMenuBlockTargetAt(DOC, 0, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, 1, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, 2, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, 3, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, 4, 2)).not.toBeNull()
  })

  it('空行与越界：无块目标', () => {
    expect(contextMenuBlockTargetAt(DOC, 3, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, -1, 2)).toBeNull()
    expect(contextMenuBlockTargetAt(DOC, DOC.length, 2)).toBeNull()
  })

  it('表格整块：无空行连续行为一块', () => {
    const lines = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '后文']
    expect(contextMenuBlockTargetAt(lines, 1, -1)).toEqual({ block: { start: 0, end: 2 }, heading: null })
  })

  it('标题行带行内标记：heading.text 保留标记字面（与宿主字面比较同源）', () => {
    const lines = ['', '## 用 **重点** 说明 ##']
    expect(contextMenuBlockTargetAt(lines, 1, -1)).toEqual({
      block: { start: 1, end: 1 },
      heading: { level: 2, text: '用 **重点** 说明' },
    })
  })
})

describe('区域判定（contextMenuZoneAt：全域接管的安全降级输入）', () => {
  const DOC = [
    '---',
    'title: 头区',
    '---',
    '',
    '普通段落',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```js',
    'const a = 1',
    '```',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
  ]

  it('头区（含结束行）与越界返回 null（不接管）', () => {
    expect(contextMenuZoneAt(DOC, 0, 2)).toBeNull()
    expect(contextMenuZoneAt(DOC, 2, 2)).toBeNull()
    expect(contextMenuZoneAt(DOC, -1, 2)).toBeNull()
    expect(contextMenuZoneAt(DOC, DOC.length, 2)).toBeNull()
  })

  it('普通行与空行都接管（zone normal——全域接管，空行不再透传原生菜单）', () => {
    expect(contextMenuZoneAt(DOC, 3, 2)).toBe('normal') // 空行
    expect(contextMenuZoneAt(DOC, 4, 2)).toBe('normal') // 普通段落
    expect(contextMenuZoneAt(DOC, 5, 2)).toBe('normal') // 段落后的空行
  })

  it('表格行（表头/分隔/数据行）判定为 table；围栏内 | 行不是表格', () => {
    expect(contextMenuZoneAt(DOC, 6, 2)).toBe('table')
    expect(contextMenuZoneAt(DOC, 7, 2)).toBe('table')
    expect(contextMenuZoneAt(DOC, 8, 2)).toBe('table')
    const fencePipe = ['```txt', 'a | b', '|---|', '```']
    expect(contextMenuZoneAt(fencePipe, 1, -1)).toBe('fence')
    expect(contextMenuZoneAt(fencePipe, 2, -1)).toBe('fence')
  })

  it('含 | 但无分隔行不是表格（普通段落）', () => {
    expect(contextMenuZoneAt(['a | b 普通段落'], 0, -1)).toBe('normal')
  })

  it('围栏代码区（含开闭围栏行）判定为 fence；mermaid 围栏判定为 graphic', () => {
    expect(contextMenuZoneAt(DOC, 10, 2)).toBe('fence')
    expect(contextMenuZoneAt(DOC, 11, 2)).toBe('fence')
    expect(contextMenuZoneAt(DOC, 12, 2)).toBe('fence')
    expect(contextMenuZoneAt(DOC, 14, 2)).toBe('graphic')
    expect(contextMenuZoneAt(DOC, 15, 2)).toBe('graphic')
    expect(contextMenuZoneAt(DOC, 16, 2)).toBe('graphic')
  })
})

describe('定位纯函数（视口 fixed + 子菜单翻转矩阵）', () => {
  it('menuViewportPosition：点击点起位；右缘 clamp；底部放不下翻上方（自 blockMenu 迁移）', () => {
    expect(menuViewportPosition({ x: 100, y: 200 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 100, top: 200 })
    expect(menuViewportPosition({ x: 1100, y: 200 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 1040, top: 200 })
    expect(menuViewportPosition({ x: 100, y: 780 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 100, top: 720 })
    expect(menuViewportPosition({ x: 100, y: 30 }, { w: 160, h: 60 }, { width: 1200, height: 80 }))
      .toEqual({ left: 100, top: 0 })
  })

  it('submenuSide 翻转矩阵：右放得下向右；右缘放不下翻左；两侧都放不下取空间大侧', () => {
    // 右侧放得下 → right
    expect(submenuSide({ left: 400, right: 500 }, 150, 900)).toBe('right')
    // 右缘放不下、左侧放得下 → left（大纲右置的修复载体）
    expect(submenuSide({ left: 780, right: 880 }, 150, 900)).toBe('left')
    // 两侧都放不下：剩余空间右侧更大（50 < 100） → right
    expect(submenuSide({ left: 50, right: 800 }, 150, 900)).toBe('right')
    // 两侧都放不下：左侧空间更大 → left
    expect(submenuSide({ left: 500, right: 880 }, 150, 900)).toBe('left')
    // 恰好放满（等号）：视为放得下
    expect(submenuSide({ left: 400, right: 500 }, 150, 650)).toBe('right')
  })
})

describe('通用模型构建（buildMenuModel：大纲等非注册表场景复用内核渲染）', () => {
  it('未登记组按首现顺序排在登记组之后；组内按 order 排序', () => {
    const defs: MenuItemDescriptor[] = [
      { id: 'b', group: 'outline', order: 1, command: 'b', labelKey: 'contextMenu.copy' },
      { id: 'a', group: 'outline', order: 0, command: 'a', labelKey: 'contextMenu.cut' },
      { id: 'z', group: 'clipboard', order: 0, command: 'z', labelKey: 'contextMenu.paste' },
    ]
    const groups = buildMenuModel(defs, normalCtx())
    expect(groups.map((g) => g.id)).toEqual(['clipboard', 'outline'])
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('danger 项透传渲染模型', () => {
    const defs: MenuItemDescriptor[] = [
      { id: 'del', group: 'outline', order: 0, command: 'del', labelKey: 'contextMenu.copy', danger: true },
    ]
    expect(buildMenuModel(defs, normalCtx())[0]!.items[0]!.danger).toBe(true)
  })
})
