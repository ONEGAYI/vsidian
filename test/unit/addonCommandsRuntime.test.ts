// #359 T10 webview 命令/菜单注册表契约测试（jsdom 控制器外纯逻辑面）。
// 覆盖：注册校验拒绝（同名/localId 含点伪造身份/Tab 通道）、运行期表
// 同步、执行链、菜单注册与回收、整组件释放闭环（命令+菜单+空表上报）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AddonCommandsRuntime } from '../../src/webview/addonCommands'
import type { AddonCommandReport } from '../../src/shared/addonCommands'
import {
  getEffectiveBindings,
  resolveKeybinding,
  __resetRuntimeOperationsForTest,
} from '../../src/shared/keybindings'
import {
  contextMenuRegistrySnapshot,
  contextMenuHandlerForCommand,
  buildContextMenuModel,
  __resetContextMenuRegistryForTest,
} from '../../src/shared/contextMenu'

const ADDON = 'vsidian-test-fixture.addon-t10'

interface ReportCall {
  addonId: string
  generation: number
  commands: readonly AddonCommandReport[]
}

function makeRuntime() {
  const reports: ReportCall[] = []
  const logs: string[] = []
  const runtime = new AddonCommandsRuntime({
    report: (payload) => reports.push({ ...payload, commands: [...payload.commands] }),
    log: (detail) => logs.push(detail),
  })
  return { runtime, reports, logs }
}

describe('T10 webview 命令注册表', () => {
  beforeEach(() => {
    __resetRuntimeOperationsForTest()
    __resetContextMenuRegistryForTest()
  })
  afterEach(() => {
    __resetRuntimeOperationsForTest()
    __resetContextMenuRegistryForTest()
  })

  it('注册成功：命名空间 ID、运行期表同步、上报载荷、执行回调', () => {
    const { runtime, reports } = makeRuntime()
    let called = 0
    const outcome = runtime.registerCommand(ADDON, 1, {
      id: 'insertStamp', title: '盖时间戳', mode: 'live', writes: true,
      defaultBindings: ['ctrl+alt+f9'],
    }, () => { called++ })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.commandId).toBe(`${ADDON}.insertStamp`)
    // 运行期表同步：生效绑定与路由可用
    expect(getEffectiveBindings({}, `${ADDON}.insertStamp`)).toEqual(['ctrl+alt+f9'])
    expect(resolveKeybinding({}, 'live', 'ctrl+alt+f9', true)).toEqual({ kind: 'command', id: `${ADDON}.insertStamp` })
    // 上报：全表一条
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ addonId: ADDON, generation: 1 })
    expect(reports[0].commands[0]).toMatchObject({ commandId: `${ADDON}.insertStamp`, title: '盖时间戳', mode: 'live', writes: true })
    // 执行
    expect(runtime.execute(`${ADDON}.insertStamp`)).toBe('executed')
    expect(called).toBe(1)
  })

  it('同名注册拒绝：同组件同 localId 二次注册明确拒绝，首个继续服务', () => {
    const { runtime, reports, logs } = makeRuntime()
    const first = runtime.registerCommand(ADDON, 1, { id: 'stamp', title: 'A', mode: 'both' }, () => {})
    expect(first.ok).toBe(true)
    const second = runtime.registerCommand(ADDON, 1, { id: 'stamp', title: 'B', mode: 'both' }, () => {})
    expect(second.ok).toBe(false)
    expect(!second.ok && second.reason).toBe('duplicate-command')
    expect(logs.some((line) => line.includes('duplicate-command'))).toBe(true)
    // 首个继续服务（标题未被替换——同名间接替换被拒）
    expect(reports.at(-1)!.commands).toHaveLength(1)
    expect(reports.at(-1)!.commands[0]!.title).toBe('A')
  })

  it('localId 含点拒绝（伪造内置/跨组件身份）；Tab 默认绑定拒绝', () => {
    const { runtime } = makeRuntime()
    const r1 = runtime.registerCommand(ADDON, 1, { id: 'bold.x', title: 'x', mode: 'both' }, () => {}); expect(!r1.ok && r1.reason).toBe('local-id:dot')
    const r2 = runtime.registerCommand(ADDON, 1, { id: 'other.addon.cmd', title: 'x', mode: 'both' }, () => {}); expect(!r2.ok && r2.reason).toBe('local-id:dot')
    const r3 = runtime.registerCommand(ADDON, 1, { id: 'tabbed', title: 'x', mode: 'both', defaultBindings: ['ctrl+tab'] }, () => {}); expect(!r3.ok && r3.reason)
      .toBe('default-bindings:tab-forbidden')
  })

  it('dispose 单条撤销：运行期表移除、空表上报', () => {
    const { runtime, reports } = makeRuntime()
    const outcome = runtime.registerCommand(ADDON, 1, { id: 'one', title: 'one', mode: 'both' }, () => {})
    outcome.dispose()
    expect(getEffectiveBindings({}, `${ADDON}.one`)).toEqual([])
    expect(reports.at(-1)!.commands).toHaveLength(0)
    expect(runtime.execute(`${ADDON}.one`)).toBe('unknown')
  })

  it('回调异常不外溢：execute 仍报 executed', () => {
    const { runtime, logs } = makeRuntime()
    runtime.registerCommand(ADDON, 1, { id: 'boom', title: 'boom', mode: 'both' }, () => { throw new Error('x') })
    expect(runtime.execute(`${ADDON}.boom`)).toBe('executed')
    expect(logs.some((line) => line.includes('handler error'))).toBe(true)
  })
})

describe('T10 webview 菜单注册表', () => {
  beforeEach(() => {
    __resetRuntimeOperationsForTest()
    __resetContextMenuRegistryForTest()
  })
  afterEach(() => {
    __resetRuntimeOperationsForTest()
    __resetContextMenuRegistryForTest()
  })

  it('菜单注册：命名空间 ID、组件簇、点击执行挂接命令', () => {
    const { runtime } = makeRuntime()
    let executed = 0
    runtime.registerCommand(ADDON, 1, { id: 'stamp', title: '盖时间戳', mode: 'live' }, () => { executed++ })
    const menu = runtime.registerMenuItem(ADDON, { id: 'stampEntry', label: '盖时间戳', iconKey: 'link', command: 'stamp' }, (commandId) => {
      runtime.execute(commandId)
    })
    expect(menu.ok).toBe(true)
    expect(menu.id).toBe(`${ADDON}.stampEntry`)
    // 注册表在案且带自由文本 label
    const entry = contextMenuRegistrySnapshot().find((def) => def.id === `${ADDON}.stampEntry`)
    expect(entry?.label).toBe('盖时间戳')
    // 组件簇存在（渲染管线未登记组排后）
    const groups = buildContextMenuModel({ zone: 'normal', hasSelection: false, blockTarget: null, line: { headingLevel: null, listKind: null, quoted: false, hasText: true } })
    expect(groups.map((g) => g.id)).toContain(`addon.${ADDON}`)
    // 执行链：菜单 handler 优先分派路径
    const handler = contextMenuHandlerForCommand(`${ADDON}.stamp`)
    expect(handler).toBeTypeOf('function')
    handler!()
    expect(executed).toBe(1)
  })

  it('菜单负向：label 空、iconKey 未登记、localId 含点均拒绝', () => {
    const { runtime, logs } = makeRuntime()
    expect(runtime.registerMenuItem(ADDON, { id: 'x', label: '' }, () => {}).reason).toBe('menu-item:label-empty')
    expect(runtime.registerMenuItem(ADDON, { id: 'x', label: 'x', iconKey: 'nope' }, () => {}).reason).toBe('menu-item:icon-key')
    expect(runtime.registerMenuItem(ADDON, { id: 'a.b', label: 'x' }, () => {}).reason).toBe('menu-item:dot')
    expect(logs.length).toBe(3)
  })

  it('内置菜单不可被组件覆写：namespaced id 与内置 id 集合无交集（负向对照）', () => {
    const { runtime } = makeRuntime()
    // localId 取内置名（bold）——命名空间化后是新增项而非覆写内置
    const outcome = runtime.registerMenuItem(ADDON, { id: 'bold', label: '组件加粗' }, () => {})
    expect(outcome.ok).toBe(true)
    const snapshot = contextMenuRegistrySnapshot()
    // 内置 bold 原样在案（label 未变——未被覆写）
    const builtinBold = snapshot.find((def) => def.id === 'bold')
    expect(builtinBold?.label).toBeUndefined()
    expect(builtinBold?.labelKey).toBe('format.bold')
    // 组件项是独立条目
    expect(snapshot.find((def) => def.id === `${ADDON}.bold`)?.label).toBe('组件加粗')
  })

  it('整组件回收：命令+菜单全撤、运行期表清空、空表上报、内置不受影响', () => {
    const { runtime, reports } = makeRuntime()
    runtime.registerCommand(ADDON, 1, { id: 'stamp', title: '盖时间戳', mode: 'live' }, () => {})
    runtime.registerMenuItem(ADDON, { id: 'entry', label: '盖时间戳' }, () => {})
    runtime.releaseAddon(ADDON)
    expect(reports.at(-1)!.commands).toHaveLength(0)
    expect(contextMenuRegistrySnapshot().some((def) => def.id === `${ADDON}.entry`)).toBe(false)
    expect(runtime.execute(`${ADDON}.stamp`)).toBe('unknown')
    // 内置三簇原样
    const groups = buildContextMenuModel({ zone: 'normal', hasSelection: false, blockTarget: null, line: { headingLevel: null, listKind: null, quoted: false, hasText: true } })
    expect(groups.map((g) => g.id)).toEqual(['link', 'blockFormat', 'clipboard'])
  })
})
