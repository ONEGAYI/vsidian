// 统一右键菜单内核纯函数契约（shared/contextMenu.ts，#183）：描述符表
// （id 唯一/组存在/图标 key 或徽标/内置最深两级）、覆写层语义（后注册胜/
// 隐藏不删/来源记录）、定位纯函数（视口 clamp + 子菜单左右翻转矩阵）、
// 安全降级矩阵（逐区域 enable/when）、键位提示派生（剪贴板四项固定 + 键位
// 注册表派生）。命中判定（contextMenuBlockTargetAt）自 blockMenu.test.ts
// 迁移（断言语义不变）。DOM 装配契约在 contextMenuDom.test.ts。
// #184 追加：段落设置勾选矩阵（menuLineStructureOf + checked 谓词）、图标
// 资产两表同步（描述符 iconKey ↔ 资产文件与 CSS 接线规则）、命令分派契约
// （每个内置叶命令都有执行路径）。
import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CONTEXT_MENU_GROUP_ORDER,
  CONTEXT_MENU_ICON_KEYS,
  CONTEXT_MENU_ITEMS,
  PLAIN_MENU_LINE,
  buildContextMenuModel,
  buildMenuModel,
  contextMenuBlockTargetAt,
  contextMenuHandlerForCommand,
  contextMenuItemSources,
  contextMenuKeybindingHints,
  contextMenuRegistrySnapshot,
  contextMenuZoneAt,
  contextMenuClickWithinSelection,
  hideContextMenuItem,
  menuLineStructureOf,
  menuViewportPosition,
  overrideContextMenuItem,
  registerContextMenuItem,
  submenuSide,
  __resetContextMenuRegistryForTest,
  type MenuContextSnapshot,
  type MenuItemDescriptor,
} from '../../src/shared/contextMenu'
import { isFormatOperationId } from '../../src/shared/formatOperations'
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
  line: PLAIN_MENU_LINE,
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

  it('group 与 labelKey 契约：顶级 group 已登记（簇序受控）；子项 group 非空（子组按首现序排后）；双包 parity 抽查', () => {
    for (const def of CONTEXT_MENU_ITEMS) {
      expect(CONTEXT_MENU_GROUP_ORDER.includes(def.group as (typeof CONTEXT_MENU_GROUP_ORDER)[number]),
        `顶级 ${def.id} 的 group ${def.group} 未登记`).toBe(true)
    }
    for (const def of all) {
      expect(def.group.length > 0, `${def.id} 的 group 为空`).toBe(true)
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
    for (const command of ['cut', 'copy', 'paste', 'pastePlain', 'selectAll', 'copyHeadingLink', 'copyBlockLink', 'insertTable']) {
      expect(commands.has(command), `${command} 应在内置命令集`).toBe(true)
    }
  })
})

describe('覆写层语义（运行期注册表，内置 = 第一个注册者）', () => {
  it('内置全量经运行期层渲染，无第二套代码路径', () => {
    const registryIds = contextMenuRegistrySnapshot().map((def) => def.id).sort()
    const builtinIds = flattenItems(CONTEXT_MENU_ITEMS).map((def) => def.id).sort()
    expect(registryIds).toEqual(builtinIds)
    // 渲染走 registry：标题行上下文（when 谓词全放行的顶级项——#438 起
    // graphicOps 四项按 zone 过滤，期望集对谓词求值感知）能拿到全部顶级
    // 项，且子项不因扁平注册表被提升为顶级项
    const headingCtx = normalCtx({
      blockTarget: { block: { start: 4, end: 4 }, heading: { level: 1, text: '标题' } },
    })
    const expectedTopIds = CONTEXT_MENU_ITEMS
      .filter((def: MenuItemDescriptor) => def.when === undefined || def.when(headingCtx))
      .map((def) => def.id).sort()
    expect(modelIds(headingCtx).sort()).toEqual(expectedTopIds)
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

  it('register→override→cleanup：先注册者的 cleanup 不回滚更晚的覆写（review-loops 修复）', () => {
    const cleanup = registerContextMenuItem({
      id: 'selectAll', group: 'clipboard', order: 3,
      command: 'selectAll', labelKey: 'contextMenu.copy',
    }, 'ext-b')
    expect(overrideContextMenuItem('selectAll', { hidden: true }, 'ext-c')).toBe(true)
    cleanup()
    // ext-c 的覆写仍在（来源与隐藏都保留），不被 ext-b 的卸载清掉
    expect(contextMenuItemSources()['selectAll']).toBe('ext-c')
    expect(modelIds(normalCtx())).not.toContain('selectAll')
  })

  it('register 新增项→override→cleanup：条目与覆写都保留（后注册者胜对 override 链成立）', () => {
    const cleanup = registerContextMenuItem({
      id: 'customKeep', group: 'link', order: 97,
      command: 'customKeep', labelKey: 'contextMenu.selectAll',
    })
    expect(overrideContextMenuItem('customKeep', { labelKey: 'contextMenu.copy' })).toBe(true)
    cleanup()
    const item = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'customKeep')!
    expect(item.labelKey).toBe('contextMenu.copy')
  })
})

describe('环防护（registerContextMenuItem 拒绝循环嵌套）', () => {
  it('子树引用自身 id 抛错（防渲染递归栈溢出；注册被整体拒绝不留痕）', () => {
    expect(() => registerContextMenuItem({
      id: 'loopSelf', group: 'link', order: 96,
      command: 'loopSelf', labelKey: 'contextMenu.selectAll',
      children: [
        { id: 'loopSelf', group: 'link', order: 0, command: 'loopSelf', labelKey: 'contextMenu.copy' },
      ],
    })).toThrow('循环嵌套')
    expect(contextMenuItemSources()['loopSelf']).toBeUndefined()
  })

  it('跨条目环在闭合注册时暴露（B 子树含 C、C 子树含 B）', () => {
    registerContextMenuItem({
      id: 'loopB', group: 'link', order: 95,
      command: 'loopB', labelKey: 'contextMenu.selectAll',
      children: [
        { id: 'loopC', group: 'link', order: 0, command: 'loopC', labelKey: 'contextMenu.copy' },
      ],
    })
    expect(() => registerContextMenuItem({
      id: 'loopC', group: 'link', order: 94,
      command: 'loopC', labelKey: 'contextMenu.copy',
      children: [
        { id: 'loopB', group: 'link', order: 0, command: 'loopB', labelKey: 'contextMenu.selectAll' },
      ],
    })).toThrow('循环嵌套')
  })

  it('override children 同样受环防护（review-loops 二轮 P3-1：register 侧检测不可被覆写绕过）', () => {
    // 单条目：合法注册后 override children 引入自环 → 抛错且不留痕
    registerContextMenuItem({
      id: 'ovSelf', group: 'link', order: 92,
      command: 'ovSelf', labelKey: 'contextMenu.selectAll',
    })
    expect(() => overrideContextMenuItem('ovSelf', {
      children: [
        { id: 'ovSelf', group: 'link', order: 0, command: 'ovSelf', labelKey: 'contextMenu.copy' },
      ],
    })).toThrow('循环嵌套')
    const item = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'ovSelf')!
    expect(item.children, '拒绝的覆写不留痕（原条目无子级）').toBeUndefined()
    // 跨条目：两个已注册条目 override children 互引 → 闭合侧抛错
    const cleanupA = registerContextMenuItem({
      id: 'ovA', group: 'link', order: 91, command: 'ovA', labelKey: 'contextMenu.selectAll',
    })
    const cleanupB = registerContextMenuItem({
      id: 'ovB', group: 'link', order: 90, command: 'ovB', labelKey: 'contextMenu.copy',
    })
    expect(overrideContextMenuItem('ovA', {
      children: [{ id: 'ovB', group: 'link', order: 0, command: 'ovB', labelKey: 'contextMenu.copy' }],
    })).toBe(true)
    expect(() => overrideContextMenuItem('ovB', {
      children: [{ id: 'ovA', group: 'link', order: 0, command: 'ovA', labelKey: 'contextMenu.selectAll' }],
    })).toThrow('循环嵌套')
    cleanupA()
    cleanupB()
  })
})

describe('handler 承载（覆写语义：可换执行体；分派先查运行期 handler）', () => {
  it('内置表保持纯数据：全部条目无 handler 字段', () => {
    for (const def of contextMenuRegistrySnapshot()) {
      expect(def.handler, `${def.id}：内置 as const 表不写 handler（执行体在分派器）`).toBeUndefined()
    }
    expect(contextMenuHandlerForCommand('bold')).toBeUndefined()
    expect(contextMenuHandlerForCommand('selectAll')).toBeUndefined()
  })

  it('register 带 handler 的新命令：按 command 命中且可执行；cleanup 后回落', () => {
    let calls = 0
    const cleanup = registerContextMenuItem({
      id: 'customRun', group: 'link', order: 99,
      command: 'customRun', labelKey: 'contextMenu.selectAll',
      handler: () => { calls++ },
    }, 'test-extension')
    const handler = contextMenuHandlerForCommand('customRun')
    expect(typeof handler).toBe('function')
    handler!()
    expect(calls).toBe(1)
    cleanup()
    expect(contextMenuHandlerForCommand('customRun'), 'cleanup 后回落无 handler').toBeUndefined()
  })

  it('override 内置 id 带 handler：替换执行体（原 command 通道让位）', () => {
    let calls = 0
    expect(overrideContextMenuItem('bold', { handler: () => { calls++ } }, 'ext-a')).toBe(true)
    const handler = contextMenuHandlerForCommand('bold')
    handler!()
    expect(calls, '覆写 handler 替换内置执行体').toBe(1)
    __resetContextMenuRegistryForTest()
    expect(contextMenuHandlerForCommand('bold'), '还原后回内置（无 handler）').toBeUndefined()
  })

  it('handler 查找按 command 字段跨条目（id 与 command 不同名的注册项同样命中）', () => {
    let calls = 0
    registerContextMenuItem({
      id: 'myTool', group: 'link', order: 98,
      command: 'tool.command', labelKey: 'contextMenu.copy',
      handler: () => { calls++ },
    })
    contextMenuHandlerForCommand('tool.command')!()
    expect(calls).toBe(1)
    expect(contextMenuHandlerForCommand('myTool'), '查找键是 command 不是 id').toBeUndefined()
  })
})

describe('子菜单分组（#183 验收反馈：组聚排 + 组边界分隔线的数据面）', () => {
  it('段落设置子项分三组且组聚排：正文+标题｜列表｜引用（组内序稳定）', () => {
    const para = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'paragraphStyle')!
    expect(para.children!.map((c) => c.id)).toEqual([
      'headingNone', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
      'bulletList', 'orderedList', 'taskList',
      'quote',
    ])
    const groups = [...new Set(para.children!.map((c) => c.group))]
    expect(groups).toEqual(['paragraphHeading', 'paragraphList', 'paragraphQuote'])
  })

  it('子组未登记 CONTEXT_MENU_GROUP_ORDER：按首现顺序排后（数据序即呈现序）', () => {
    // 内置 paragraphChildren 原始序已是目标呈现序；乱序注册的运行期子项同样聚排
    const cleanup = registerContextMenuItem({
      id: 'mixed', group: 'link', order: 89,
      command: 'mixed', labelKey: 'contextMenu.selectAll',
      children: [
        { id: 'mB', group: 'subB', order: 0, command: 'mB', labelKey: 'contextMenu.copy' },
        { id: 'mA', group: 'subA', order: 0, command: 'mA', labelKey: 'contextMenu.copy' },
        { id: 'mB2', group: 'subB', order: 1, command: 'mB2', labelKey: 'contextMenu.copy' },
      ],
    })
    const mixed = buildContextMenuModel(normalCtx())
      .flatMap((g) => g.items).find((i) => i.id === 'mixed')!
    // subB 首现在前，subA 排后；组内按 order（mB 先于 mB2）
    expect(mixed.children!.map((c) => c.id)).toEqual(['mB', 'mB2', 'mA'])
    cleanup()
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
      'cut', 'copy', 'paste', 'pastePlain', 'selectAll'])
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

describe('场景命中负载与场景簇组预登记（#436 基建）', () => {
  it('组序预登记 tableOps / graphicOps：位于链接簇后、块与格式簇前', () => {
    expect([...CONTEXT_MENU_GROUP_ORDER]).toEqual([
      'link', 'tableOps', 'graphicOps', 'blockFormat', 'clipboard',
    ])
  })

  it('场景组无项时零产出（预登记不产生空组/空分隔线——场景票落项前菜单不变）', () => {
    const groups = buildContextMenuModel(normalCtx())
    expect(groups.map((g) => g.id)).toEqual(['link', 'blockFormat', 'clipboard'])
  })

  it('负载字段在场不改变安全降级矩阵（谓词只读 zone 等既有面）', () => {
    const tableCtx = normalCtx({
      zone: 'table',
      table: {
        rowIndex: 1, columnIndex: 0, inHeader: false, rowCount: 2, columnCount: 2,
        lines: { start: 0, end: 2 }, pos: 10,
        quoteUniform: true, quoteDepth: 0, hitQuoteDepth: 0,
      },
    })
    const groups = buildContextMenuModel(tableCtx)
    expect(groups.find((g) => g.id === 'link')!.items
      .find((i) => i.id === 'insertWikilink')!.enabled).toBe(false)
    expect(groups.find((g) => g.id === 'blockFormat')!.items
      .every((i) => !i.enabled)).toBe(true)
    // graphic 同理：svg 能力字段不解锁结构敏感区
    const graphicCtx = normalCtx({
      zone: 'graphic',
      graphic: { lines: { start: 0, end: 2 }, language: 'mermaid', code: 'graph TD', svgExport: true },
    })
    const graphicGroups = buildContextMenuModel(graphicCtx)
    expect(graphicGroups.find((g) => g.id === 'blockFormat')!.items
      .every((i) => !i.enabled)).toBe(true)
  })
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

  it('运行期新增条目同样按 command 派生提示（遍历源是注册表快照——review-loops 修复）', () => {
    registerContextMenuItem({
      id: 'myBold', group: 'link', order: 93,
      command: 'bold', labelKey: 'contextMenu.selectAll',
    })
    expect(contextMenuKeybindingHints({})['myBold']).toBe('Ctrl+B')
    expect(contextMenuKeybindingHints({ bold: [] })['myBold']).toBeUndefined()
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

  it('短分隔行表格（|-|-|，GFM 单连字符）判为 table——与 tableCells 口径对齐（review-loops 修复）', () => {
    const short = ['|-|-|', '|a|b|']
    expect(contextMenuZoneAt(short, 0, -1)).toBe('table')
    expect(contextMenuZoneAt(short, 1, -1)).toBe('table')
  })

  it('块内表格判定为 table：分隔行剥容器前缀（#296 三轮右键识别修复）', () => {
    // 引用块内表格：分隔行 `> |---|---|` 的 `> ` 前缀不参与形态判定——
    // 修复前引用表不判为 table，格式/段落/插入簇置灰的降级矩阵失效
    const quote = ['> | a | b |', '> |---|---|', '> | 1 | 2 |']
    expect(contextMenuZoneAt(quote, 0, -1)).toBe('table')
    expect(contextMenuZoneAt(quote, 1, -1)).toBe('table')
    expect(contextMenuZoneAt(quote, 2, -1)).toBe('table')
    // 引用内列表组合容器（quote-list）
    const quotedList = ['> - | a | b |', '>   |---|---|', '>   | 1 | 2 |']
    expect(contextMenuZoneAt(quotedList, 0, -1)).toBe('table')
    expect(contextMenuZoneAt(quotedList, 2, -1)).toBe('table')
    // 引用内完好表格不会误伤普通引用文本（无分隔行仍是 normal）
    expect(contextMenuZoneAt(['> 引用文本 | 带管道'], 0, -1)).toBe('normal')
  })

  it('右键保选区判定：点击落在选区内（含端点）才保持选区（#186 bug 1）', () => {
    const ranges = [{ from: 4, to: 10 }, { from: 20, to: 25 }]
    // 区间内与两端点：保持
    expect(contextMenuClickWithinSelection(ranges, 5)).toBe(true)
    expect(contextMenuClickWithinSelection(ranges, 4)).toBe(true)
    expect(contextMenuClickWithinSelection(ranges, 10)).toBe(true)
    expect(contextMenuClickWithinSelection(ranges, 22)).toBe(true)
    // 区间外（含缝隙）：放行默认（右键折叠光标到点击处）
    expect(contextMenuClickWithinSelection(ranges, 3)).toBe(false)
    expect(contextMenuClickWithinSelection(ranges, 15)).toBe(false)
    // 折叠选区（from === to）只有精确命中才保持
    expect(contextMenuClickWithinSelection([{ from: 7, to: 7 }], 7)).toBe(true)
    expect(contextMenuClickWithinSelection([{ from: 7, to: 7 }], 8)).toBe(false)
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

// ---- #184：段落设置勾选矩阵（menuLineStructureOf 形态学 + checked 谓词）----

/** 行文本 → 段落设置子项勾选映射（模型级断言：谓词真实求值） */
const paragraphCheckedOf = (line: string): Record<string, boolean> => {
  const ctx = normalCtx({ line: menuLineStructureOf(line) })
  const style = buildContextMenuModel(ctx).flatMap((g) => g.items).find((i) => i.id === 'paragraphStyle')!
  return Object.fromEntries((style.children ?? []).map((child) => [child.id, child.checked]))
}

describe('行结构形态学（menuLineStructureOf，#184）', () => {
  it('普通段落：仅 hasText；空行全中性（不点亮任何勾选）', () => {
    expect(menuLineStructureOf('普通段落一行'))
      .toEqual({ headingLevel: null, listKind: null, quoted: false, hasText: true })
    expect(menuLineStructureOf('   '))
      .toEqual({ headingLevel: null, listKind: null, quoted: false, hasText: false })
    expect(menuLineStructureOf(''))
      .toEqual({ headingLevel: null, listKind: null, quoted: false, hasText: false })
  })

  it('ATX 标题：级别入快照（# - 伪列表 是标题文本不是列表）', () => {
    expect(menuLineStructureOf('## 标题').headingLevel).toBe(2)
    expect(menuLineStructureOf('###### 六级').headingLevel).toBe(6)
    const pseudo = menuLineStructureOf('# - 伪列表')
    expect(pseudo.headingLevel).toBe(1)
    expect(pseudo.listKind).toBeNull()
  })

  it('列表族：无序/有序/任务（任务标记优先归 task）；伪标记不算列表', () => {
    expect(menuLineStructureOf('- 项目').listKind).toBe('bullet')
    expect(menuLineStructureOf('* 星号项').listKind).toBe('bullet')
    expect(menuLineStructureOf('1. 有序').listKind).toBe('ordered')
    expect(menuLineStructureOf('01) 括号有序').listKind).toBe('ordered')
    expect(menuLineStructureOf('- [ ] 待办').listKind).toBe('task')
    expect(menuLineStructureOf('- [x] 完成').listKind).toBe('task')
    expect(menuLineStructureOf('-紧贴伪标记 item').listKind).toBeNull()
    expect(menuLineStructureOf('-').listKind).toBe('bullet') // 空项裸标记
  })

  it('引用层：纯引用与引用内列表都置 quoted', () => {
    expect(menuLineStructureOf('> 引用').quoted).toBe(true)
    expect(menuLineStructureOf('>> 双层').quoted).toBe(true)
    expect(menuLineStructureOf('> - 引用内列表').quoted).toBe(true)
    expect(menuLineStructureOf('> - [ ] 引用内任务').quoted).toBe(true)
    expect(menuLineStructureOf('普通 > 文本中部').quoted).toBe(false)
  })
})

describe('段落设置勾选矩阵（checked 谓词按当前行结构点亮，#184）', () => {
  type CheckedMap = Record<string, boolean>
  /** 场景矩阵：行文本 → 非默认（true）的勾选子项（其余全 false） */
  const matrix: Array<[string, CheckedMap]> = [
    ['普通段落一行', { headingNone: true }],
    ['## 用 **重点** 说明', { heading2: true }],
    ['# 一级', { heading1: true }],
    ['- 无序项', { bulletList: true }],
    ['3. 有序项', { orderedList: true }],
    ['- [ ] 待办任务', { taskList: true }],
    ['- [x] 已完成任务', { taskList: true }],
    ['> 引用文字', { quote: true }],
    // 引用内列表：结构如实双勾（引用层 + 列表族并存）
    ['> - 引用内列表项', { quote: true, bulletList: true }],
    ['> 1. 引用内有序', { quote: true, orderedList: true }],
    // 空行与中性态：不点亮任何项
    ['', {}],
    ['   ', {}],
  ]

  for (const [line, expectedTrue] of matrix) {
    it(`${JSON.stringify(line)} → 勾选 ${JSON.stringify(expectedTrue)}`, () => {
      const checked = paragraphCheckedOf(line)
      const paragraphIds = Object.keys(checked)
      expect(paragraphIds.sort()).toEqual(['bulletList', 'heading1', 'heading2', 'heading3', 'heading4',
        'heading5', 'heading6', 'headingNone', 'orderedList', 'quote', 'taskList'])
      for (const id of paragraphIds) {
        expect(checked[id], `${JSON.stringify(line)} 的 ${id} 勾选态错误`).toBe(expectedTrue[id] === true)
      }
    })
  }

  it('任务行不点亮无序列表（任务标记优先归 task——族互斥）', () => {
    const checked = paragraphCheckedOf('- [ ] 待办')
    expect(checked['taskList']).toBe(true)
    expect(checked['bulletList']).toBe(false)
  })

  it('中性态快照（结构敏感区采集约定）：不点亮任何勾选', () => {
    const checked = paragraphCheckedOf('## 不该勾') // 行本身是标题——
    const neutral = buildContextMenuModel(normalCtx({ line: PLAIN_MENU_LINE }))
      .flatMap((g) => g.items).find((i) => i.id === 'paragraphStyle')!
    expect((neutral.children ?? []).every((child) => !child.checked)).toBe(true)
    expect(checked['heading2']).toBe(true) // 对照组：真实结构照常点亮
  })

  it('文本格式类不显示勾选（切换语义下勾选意义模糊——#183 既定边界）', () => {
    const ctx = normalCtx({ line: menuLineStructureOf('**粗体** 文字') })
    const format = buildContextMenuModel(ctx).flatMap((g) => g.items).find((i) => i.id === 'textFormat')!
    expect((format.children ?? []).every((child) => !child.checked)).toBe(true)
  })
})

// ---- #184：图标资产两表同步（描述符 iconKey ↔ 资产文件与 CSS 接线规则）----

/** #438 资产缺口豁口：新登记的图形簇 icon key（popupPreview/exportSvg/
 *  exportPng）资产生成与 CSS 接线归图标票 #441 承接——豁口期内资产断言
 *  跳过这些 key（渲染层留空降级是规格口径）；#441 合入后此清单应清空 */
const ICON_KEYS_PENDING_ASSETS: readonly string[] = ['popupPreview', 'exportSvg', 'exportPng']

describe('图标资产两表同步（#184：规格「扩展约定」两表同步的机器钉法）', () => {
  const referenced = new Set(
    flattenItems(CONTEXT_MENU_ITEMS).flatMap((def) => (def.iconKey ? [def.iconKey] : [])),
  )
  const root = path.resolve(process.cwd())

  it('被描述符引用的图标 key 恰 30 枚（#438 图形簇接入 popupPreview/exportSvg/exportPng/copy）', () => {
    expect(referenced.size).toBe(30)
  })

  it('每个被引用 key 都有明暗两套 SVG 资产文件（#441 资产缺口 key 豁免）', () => {
    for (const key of referenced) {
      if (ICON_KEYS_PENDING_ASSETS.includes(key)) {
        continue
      }
      expect(existsSync(path.join(root, 'media/quick-actions/light', `light-${key}.svg`)),
        `${key} 缺 light SVG 资产`).toBe(true)
      expect(existsSync(path.join(root, 'media/quick-actions/dark', `dark-${key}.svg`)),
        `${key} 缺 dark SVG 资产`).toBe(true)
    }
  })

  it('备用 3 key（media/footnote/callout）不被任何描述符引用（显式记账）', () => {
    for (const key of ['media', 'footnote', 'callout']) {
      expect(referenced.has(key), `备用 key ${key} 不应被描述符引用`).toBe(false)
      // 资产在表登记（KEYS 同步）：备用资产文件同样在场
      expect(existsSync(path.join(root, 'media/quick-actions/light', `light-${key}.svg`)),
        `备用 key ${key} 的资产应在场（记账）`).toBe(true)
    }
  })

  it('main.css 为每个被引用 key 提供明暗两套 [data-icon] 接线规则（#441 豁免同上）', () => {
    const css = readFileSync(path.join(root, 'src/webview/main.css'), 'utf8')
    for (const key of referenced) {
      if (ICON_KEYS_PENDING_ASSETS.includes(key)) {
        continue
      }
      const lightRule = new RegExp(
        `\\.vsidian-context-menu \\[data-icon='${key}'\\]\\s*\\{[^}]*light-${key}\\.svg`)
      const darkRule = new RegExp(
        `body\\.vscode-dark[^{]*\\.vsidian-context-menu \\[data-icon='${key}'\\][^}]*dark-${key}\\.svg`)
      expect(lightRule.test(css), `${key} 缺 light 接线规则（--vsidian-context-icon → light SVG）`).toBe(true)
      expect(darkRule.test(css), `${key} 缺 dark 接线规则（vscode-dark/high-contrast → dark SVG）`).toBe(true)
    }
  })
})

// ---- #184：命令分派契约（每个内置叶命令在 runContextMenuCommand 有执行路径）----

describe('命令分派契约（三簇叶命令可执行；显式分支另有面板行为用例逐项钉住）', () => {
  it('叶命令 ∈ formatOperations id ∪ 显式分派分支集；父项（有 children）无叶命令豁免', () => {
    // runContextMenuCommand（syncController）的显式分支集合——行为级用例在
    // contextMenuPanel.test.ts 逐项覆盖（cut/copy/paste/selectAll/
    // copyHeadingLink/copyBlockLink/insertTable + bold 代表 formatOperations
    // 同路径）；本契约防「新增描述符忘接分派」的回归。
    const explicit = new Set(['cut', 'copy', 'paste', 'pastePlain', 'selectAll', 'copyHeadingLink', 'copyBlockLink', 'insertTable',
      'graphicPopup', 'graphicExportSvg', 'graphicExportPng', 'graphicCopySource'])
    for (const def of flattenItems(CONTEXT_MENU_ITEMS)) {
      if (def.children && def.children.length > 0) {
        continue // 父项点击只展开不执行（无叶命令）
      }
      expect(
        isFormatOperationId(def.command) || explicit.has(def.command),
        `${def.id} 的命令 ${def.command} 无执行路径（formatOperations 与显式分支均未覆盖）`,
      ).toBe(true)
    }
  })
})

// ---- #438 图形专属簇（graphicOps）：谓词矩阵与组位 ----

describe('图形专属簇（#438：弹窗/导出/复制的谓词矩阵与簇位）', () => {
  const graphicCtx = (over: Partial<NonNullable<MenuContextSnapshot['graphic']>> = {}): MenuContextSnapshot =>
    normalCtx({
      zone: 'graphic',
      graphic: {
        lines: { start: 0, end: 2 },
        language: 'mermaid',
        code: 'graph TD\nA-->B',
        svgExport: true,
        rendered: true,
        ...over,
      },
    })
  /** graphicOps 簇 → command → enable 映射（不在场 = undefined） */
  const graphicStates = (ctx: MenuContextSnapshot): Record<string, boolean | undefined> => {
    const group = buildContextMenuModel(ctx).find((g) => g.id === 'graphicOps')
    if (!group) {
      return {}
    }
    return Object.fromEntries(group.items.map((item) => [item.command, item.enabled]))
  }

  it('簇位与组序：仅 zone=graphic 出簇，位于链接簇后、块与格式簇前', () => {
    const groups = buildContextMenuModel(graphicCtx()).map((g) => g.id)
    expect(groups).toEqual(['link', 'graphicOps', 'blockFormat', 'clipboard'])
    // 普通正文与普通围栏（zone=fence）不出簇
    expect(buildContextMenuModel(normalCtx()).map((g) => g.id)).toEqual(['link', 'blockFormat', 'clipboard'])
    const fenceCtx = normalCtx({ zone: 'fence' })
    expect(buildContextMenuModel(fenceCtx).find((g) => g.id === 'graphicOps')).toBeUndefined()
  })

  it('渲染成功 + svg 能力在场：四项全亮（平铺四项，组内序即呈现序）', () => {
    const states = graphicStates(graphicCtx())
    expect(Object.keys(states)).toEqual([
      'graphicPopup', 'graphicExportSvg', 'graphicExportPng', 'graphicCopySource',
    ])
    expect(Object.values(states).every((enabled) => enabled === true)).toBe(true)
  })

  it('错误降级（rendered=false）：弹窗/导出三项置灰、复制源码仍亮——置灰不隐藏', () => {
    const states = graphicStates(graphicCtx({ rendered: false }))
    expect(states['graphicPopup']).toBe(false)
    expect(states['graphicExportSvg']).toBe(false)
    expect(states['graphicExportPng']).toBe(false)
    expect(states['graphicCopySource'], '错误块取源码恰是高价值操作').toBe(true)
  })

  it('附加组件渲染器无 svg 能力（svgExport=false）：三项置灰、复制源码亮（gate 与按钮同口径）', () => {
    const states = graphicStates(graphicCtx({ svgExport: false, rendered: undefined }))
    expect(states['graphicPopup']).toBe(false)
    expect(states['graphicExportSvg']).toBe(false)
    expect(states['graphicExportPng']).toBe(false)
    expect(states['graphicCopySource']).toBe(true)
  })

  it('渲染态缺省（探针不可得，rendered 未采集）：按成功放行（执行路径兜底）', () => {
    const states = graphicStates(graphicCtx({ rendered: undefined }))
    expect(states['graphicPopup']).toBe(true)
    expect(states['graphicExportSvg']).toBe(true)
  })

  it('负载缺省（zone=graphic 但负载不在场，防御路径）：三项置灰', () => {
    const states = graphicStates(normalCtx({ zone: 'graphic' }))
    expect(states['graphicPopup']).toBe(false)
    expect(states['graphicExportSvg']).toBe(false)
  })
})
