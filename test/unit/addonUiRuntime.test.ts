// @vitest-environment jsdom
// #360 T11 webview 附加组件界面运行时契约测试（jsdom 纯 DOM 面——不含
// CM6 控制器）。覆盖票面验收的运行期语义：
// - 挂载归属：按钮只进平台槽容器、面板只进平台 dock（data-addon-button/
//   data-addon-panel 命名空间 ID 定位）；
// - 回调携当前目标：onClick/面板 target() 经平台注入的活动句柄（引用 B
//   聚焦时归 B 不误改父 A 的目标路由前提）；
// - 回收矩阵：dispose/模式切换（按钮撤挂、面板强制关闭）/整组件释放
//  （停用/故障路径）；
// - 迟到结果：面板关闭后内容根已脱挂——组件迟到的 DOM 写入不可见；
// - 拒绝面：同名注册/槽位白名单外/动作二选一冲突或缺席——普通 API 拒绝
//   不算故障（回调异常本地吞掉留痕，不外溢）。
import { describe, it, expect, beforeEach } from 'vitest'
import { AddonUiRuntime } from '../../src/webview/addonUi'
import type { AddonUiRuntimeEnv } from '../../src/webview/addonUi'
import type { AddonViewHandle } from '../../src/shared/addonEditApi'

const ADDON = 'vsidian-test-fixture.addon-t11'

function makeHandle(id: string): AddonViewHandle {
  return {
    info: {
      instanceId: id,
      targetDocUri: `file:///d%3A/notes/${id}.md`,
      mode: 'live',
      viewType: id === 'main' ? 'main' : 'embed',
      editable: true,
    },
    editor: {
      getSnapshot: () => ({ ok: true, snapshot: { text: '', selections: [], version: 1, revision: 1 } }),
      applyEdits: () => Promise.resolve({ ok: true, credential: { opId: 'g1-op1', version: 2 } }),
      setSelection: () => true,
      reveal: () => true,
    },
  }
}

function makeEnv() {
  const toolbarSlot = document.createElement('div')
  toolbarSlot.className = 'vsidian-addon-toolbar-slot'
  const panelDock = document.createElement('div')
  panelDock.className = 'vsidian-addon-panel-dock'
  document.body.append(toolbarSlot, panelDock)
  const state = {
    mode: 'live' as 'live' | 'reading',
    activeId: 'main' as string | null,
    executed: [] as string[],
    hints: {} as Record<string, string[]>,
  }
  const env: AddonUiRuntimeEnv = {
    toolbarSlot,
    panelDock,
    currentMode: () => state.mode,
    activeInstanceId: () => state.activeId,
    executeCommand: (commandId) => {
      state.executed.push(commandId)
      return true
    },
    bindingHints: (commandId) => state.hints[commandId] ?? [],
    panelCloseLabel: () => '关闭面板',
    log: () => {},
  }
  const runtime = new AddonUiRuntime(env)
  runtime.bindHandleFactory((_addonId, instanceId) =>
    state.activeId === instanceId ? makeHandle(instanceId) : null)
  return { runtime, toolbarSlot, panelDock, state }
}

describe('T11 webview 界面运行时：按钮', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('注册挂载：槽内 button、命名空间 data 属性、aria/tooltip 承载、点击回调携当前目标句柄', () => {
    const { runtime, toolbarSlot, state } = makeEnv()
    const seen: string[] = []
    const outcome = runtime.registerButton(ADDON, 1, { id: 'stampBtn', label: 'Stamp', iconText: 'T11' }, (target) => {
      seen.push(target?.info.instanceId ?? 'null')
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.id).toBe(`${ADDON}.stampBtn`)
    const btn = toolbarSlot.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn!.dataset['addonButton']).toBe(`${ADDON}.stampBtn`)
    expect(btn!.getAttribute('aria-label')).toBe('Stamp')
    expect(btn!.getAttribute('data-tooltip')).toBe('Stamp')
    expect(btn!.textContent).toBe('T11')
    // 点击：目标经平台注入（activeId=main → 主句柄）
    btn!.click()
    expect(seen).toEqual(['main'])
    // 焦点切到嵌入 B：按钮操作归 B（T06 句柄语义——不误改父 A）
    state.activeId = 'embed:h1'
    btn!.click()
    expect(seen).toEqual(['main', 'embed:h1'])
    // 视图不在场：回调收 null（不造句柄）
    state.activeId = null
    btn!.click()
    expect(seen).toEqual(['main', 'embed:h1', 'null'])
  })

  it('命令按钮：点击经命令体系执行（executeCommand 收命名空间命令 ID）、键位徽章来自生效绑定', () => {
    const { runtime, toolbarSlot, state } = makeEnv()
    state.hints[`${ADDON}.insertStamp`] = ['ctrl+alt+g']
    runtime.registerButton(ADDON, 1, { id: 'cmdBtn', label: 'Cmd', command: 'insertStamp' })
    const btn = toolbarSlot.querySelector('button')!
    expect(btn.dataset['addonButton']).toBe(`${ADDON}.cmdBtn`)
    expect(btn.getAttribute('data-tooltip-keys')).toBe('ctrl+alt+g')
    btn.click()
    expect(state.executed).toEqual([`${ADDON}.insertStamp`])
  })

  it('槽内排序：order 升序稳定排序（缺省 0，同序按注册序）', () => {
    const { runtime, toolbarSlot } = makeEnv()
    runtime.registerButton(ADDON, 1, { id: 'b2', label: 'B2', order: 2 }, () => {})
    runtime.registerButton(ADDON, 1, { id: 'a0', label: 'A0' }, () => {})
    runtime.registerButton(ADDON, 1, { id: 'c1', label: 'C1', order: 1 }, () => {})
    const ids = [...toolbarSlot.querySelectorAll('button')].map((el) => el.dataset['addonButton'])
    expect(ids).toEqual([`${ADDON}.a0`, `${ADDON}.c1`, `${ADDON}.b2`])
  })

  it('拒绝面：同名注册/槽位白名单外/动作冲突或缺席——首个继续服务', () => {
    const { runtime, toolbarSlot } = makeEnv()
    const first = runtime.registerButton(ADDON, 1, { id: 'dup', label: 'A' }, () => {})
    expect(first.ok).toBe(true)
    const second = runtime.registerButton(ADDON, 1, { id: 'dup', label: 'B' }, () => {})
    expect(!second.ok && second.reason).toBe('duplicate-button')
    const slotBad = runtime.registerButton(ADDON, 1, { id: 'sb', label: 'x', slot: 'sidebar' as never }, () => {})
    expect(!slotBad.ok && slotBad.reason).toContain('slot')
    const conflict = runtime.registerButton(ADDON, 1, { id: 'cf', label: 'x', command: 'c' }, () => {})
    expect(!conflict.ok && conflict.reason).toContain('action-conflict')
    const missing = runtime.registerButton(ADDON, 1, { id: 'ms', label: 'x' }, undefined)
    expect(!missing.ok && missing.reason).toContain('action-missing')
    // 首个继续服务（label 未被替换）
    expect(toolbarSlot.querySelector('button')!.getAttribute('aria-label')).toBe('A')
  })

  it('dispose 单条撤销：按钮从槽内移除', () => {
    const { runtime, toolbarSlot } = makeEnv()
    const outcome = runtime.registerButton(ADDON, 1, { id: 'one', label: '1' }, () => {})
    outcome.dispose()
    expect(toolbarSlot.querySelector('button')).toBeNull()
    // 重复 dispose 无害
    outcome.dispose()
  })

  it('onClick 异常不外溢（吞掉留痕，不影响后续点击与其他组件）', () => {
    const { runtime, toolbarSlot } = makeEnv()
    runtime.registerButton(ADDON, 1, { id: 'boom', label: 'x' }, () => { throw new Error('addon code bug') })
    runtime.registerButton(ADDON, 1, { id: 'ok', label: 'y' }, () => {})
    const buttons = toolbarSlot.querySelectorAll('button')
    expect(() => buttons[0]!.click()).not.toThrow()
    expect(() => buttons[1]!.click()).not.toThrow()
  })

  it('句柄工厂未绑定（装载器未安装）：目标回 null，不造句柄', () => {
    document.body.innerHTML = ''
    const toolbarSlot = document.createElement('div')
    const panelDock = document.createElement('div')
    document.body.append(toolbarSlot, panelDock)
    const runtime = new AddonUiRuntime({
      toolbarSlot,
      panelDock,
      currentMode: () => 'live',
      activeInstanceId: () => 'main',
      executeCommand: () => true,
      bindingHints: () => [],
      panelCloseLabel: () => '关闭面板',
    })
    const seen: unknown[] = []
    runtime.registerButton(ADDON, 1, { id: 'x', label: 'X' }, (target) => seen.push(target))
    toolbarSlot.querySelector('button')!.click()
    expect(seen).toEqual([null])
  })

  it('声明模式：注册时模式不符不挂载；applyMode 撤挂与重挂', () => {
    const { runtime, toolbarSlot } = makeEnv()
    // live 运行态注册 reading 按钮：不挂载
    runtime.registerButton(ADDON, 1, { id: 'ro', label: 'RO', mode: 'reading' }, () => {})
    expect(toolbarSlot.querySelector('button')).toBeNull()
    // 切 reading：挂载
    runtime.applyMode('reading')
    expect(toolbarSlot.querySelector('button')!.dataset['addonButton']).toBe(`${ADDON}.ro`)
    // 切回 live：撤下（回收挂载与监听——元素移除即监听回收）
    runtime.applyMode('live')
    expect(toolbarSlot.querySelector('button')).toBeNull()
    // both 常驻：live 态只有 bo 在场（ro 已撤）
    runtime.registerButton(ADDON, 1, { id: 'bo', label: 'BO', mode: 'both' }, () => {})
    runtime.applyMode('live')
    expect(toolbarSlot.querySelectorAll('button')).toHaveLength(1)
    expect(toolbarSlot.querySelector('button')!.dataset['addonButton']).toBe(`${ADDON}.bo`)
    // reading 态：ro 重挂 + bo 常驻（2 个）
    runtime.applyMode('reading')
    expect(toolbarSlot.querySelectorAll('button')).toHaveLength(2)
  })
})

describe('T11 webview 界面运行时：面板', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('open/close 生命周期：mount 收内容根与目标获取器、close 调 unmount 且根脱挂、isOpen 翻转', () => {
    const { runtime, panelDock, state } = makeEnv()
    const mounted: string[] = []
    const unmounted: string[] = []
    let gotRoot: HTMLElement | null = null
    const outcome = runtime.registerPanel(ADDON, 1, {
      id: 'notes', title: 'Notes',
      mount: (root, target) => {
        gotRoot = root as HTMLElement
        mounted.push(target()?.info.instanceId ?? 'null')
        ;(root as HTMLElement).textContent = 'PANEL-CONTENT'
      },
      unmount: (root) => unmounted.push((root as HTMLElement).textContent ?? ''),
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.isOpen()).toBe(false)
    // 打开：dock 内面板容器（平台 chrome：标题栏 + 内容根）
    expect(outcome.open()).toBe(true)
    expect(outcome.isOpen()).toBe(true)
    const panel = panelDock.querySelector('.vsidian-addon-panel')!
    expect(panel).not.toBeNull()
    expect(panel.querySelector('.vsidian-addon-panel-title')!.textContent).toBe('Notes')
    expect(panel.querySelector('.vsidian-addon-panel-body')!.contains(gotRoot)).toBe(true)
    expect(mounted).toEqual(['main'])
    // 目标获取器动态解析：焦点切到嵌入 B 后归 B
    state.activeId = 'embed:h1'
    // 关闭：unmount 调用、容器移除、根脱挂
    expect(outcome.close()).toBe(true)
    expect(outcome.isOpen()).toBe(false)
    expect(unmounted).toEqual(['PANEL-CONTENT'])
    expect(panelDock.querySelector('.vsidian-addon-panel')).toBeNull()
    expect(gotRoot!.isConnected).toBe(false)
    // 迟到结果：组件再往已脱挂的根写内容——dock 内不可见
    gotRoot!.textContent = 'LATE-RESULT'
    expect(panelDock.textContent).not.toContain('LATE-RESULT')
  })

  it('面板 close 按钮与 Esc：平台 chrome 行为（用户关闭路径）', () => {
    const { runtime, panelDock } = makeEnv()
    let unmountCount = 0
    const outcome = runtime.registerPanel(ADDON, 1, {
      id: 'p', title: 'P', mount: () => {}, unmount: () => { unmountCount++ },
    })
    outcome.open()
    const closeBtn = panelDock.querySelector<HTMLButtonElement>('.vsidian-addon-panel-close')!
    expect(closeBtn.getAttribute('aria-label')).toBe('关闭面板')
    closeBtn.click()
    expect(outcome.isOpen()).toBe(false)
    expect(unmountCount).toBe(1)
  })

  it('mount 异常：面板回收不留半装配（close + 注册移除），异常吞掉留痕', () => {
    const { runtime, panelDock } = makeEnv()
    const outcome = runtime.registerPanel(ADDON, 1, {
      id: 'bad', title: 'Bad',
      mount: () => { throw new Error('mount bug') },
    })
    expect(() => outcome.open()).not.toThrow()
    expect(outcome.isOpen()).toBe(false)
    expect(panelDock.querySelector('.vsidian-addon-panel')).toBeNull()
    // 注册已移除：再 open 拒绝（面板已失效——半初始化不留）
    expect(outcome.open()).toBe(false)
  })

  it('模式切换：声明模式不含新模式的面板强制关闭并回收；注册保留', () => {
    const { runtime, panelDock } = makeEnv()
    const unmounted: boolean[] = []
    const outcome = runtime.registerPanel(ADDON, 1, {
      id: 'liveOnly', title: 'L', mode: 'live',
      mount: () => {}, unmount: () => { unmounted.push(true) },
    })
    outcome.open()
    runtime.applyMode('reading')
    expect(outcome.isOpen()).toBe(false)
    expect(unmounted).toEqual([true])
    expect(panelDock.querySelector('.vsidian-addon-panel')).toBeNull()
    // 注册保留：切回 live 可再开
    runtime.applyMode('live')
    expect(outcome.open()).toBe(true)
    expect(outcome.isOpen()).toBe(true)
  })

  it('同名面板注册拒绝；dispose 关闭面板并移除注册', () => {
    const { runtime, panelDock } = makeEnv()
    const first = runtime.registerPanel(ADDON, 1, { id: 'dup', title: 'A', mount: () => {} })
    expect(first.ok).toBe(true)
    const second = runtime.registerPanel(ADDON, 1, { id: 'dup', title: 'B', mount: () => {} })
    expect(!second.ok && second.reason).toBe('duplicate-panel')
    first.open()
    first.dispose()
    expect(first.isOpen()).toBe(false)
    expect(panelDock.querySelector('.vsidian-addon-panel')).toBeNull()
    // dispose 后 open 拒绝（注册已移除）
    expect(first.open()).toBe(false)
  })
})

describe('T11 webview 界面运行时：整组件回收与观测', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('releaseAddon：撤全部按钮、关闭全部面板、注册清空；重复调用无害', () => {
    const { runtime, toolbarSlot, panelDock } = makeEnv()
    runtime.registerButton(ADDON, 1, { id: 'b1', label: '1' }, () => {})
    runtime.registerButton(ADDON, 1, { id: 'b2', label: '2' }, () => {})
    const panel = runtime.registerPanel(ADDON, 1, { id: 'p1', title: 'P', mount: () => {} })
    panel.open()
    // 另一组件不受影响
    const other = 'vsidian-test-fixture.addon-other'
    const otherBtn = runtime.registerButton(other, 1, { id: 'b1', label: 'O' }, () => {})
    expect(otherBtn.ok).toBe(true)
    runtime.releaseAddon(ADDON)
    expect(toolbarSlot.querySelectorAll('button')).toHaveLength(1)
    expect(toolbarSlot.querySelector('button')!.dataset['addonButton']).toBe(`${other}.b1`)
    expect(panelDock.querySelector('.vsidian-addon-panel')).toBeNull()
    expect(panel.isOpen()).toBe(false)
    // 释放后旧句柄 open 拒绝
    expect(panel.open()).toBe(false)
    // 同 localId 可被新代次重用（旧代次已回收）
    const re = runtime.registerButton(ADDON, 2, { id: 'b1', label: 'new' }, () => {})
    expect(re.ok).toBe(true)
    // 重复 release 无害
    runtime.releaseAddon(ADDON)
  })

  it('stats 观测面：按钮/面板的在场与开态（paint 探针的数据源）', () => {
    const { runtime } = makeEnv()
    runtime.registerButton(ADDON, 1, { id: 'b1', label: '1' }, () => {})
    runtime.registerButton(ADDON, 1, { id: 'ro', label: 'R', mode: 'reading' }, () => {})
    const panel = runtime.registerPanel(ADDON, 1, { id: 'p1', title: 'P', mount: () => {} })
    panel.open()
    const stats = runtime.stats()
    expect(stats.buttons.map((b) => b.id)).toEqual([`${ADDON}.b1`, `${ADDON}.ro`])
    expect(stats.buttons[0]!.mounted).toBe(true)
    expect(stats.buttons[1]!.mounted).toBe(false)
    expect(stats.panels).toEqual([{ id: `${ADDON}.p1`, addonId: ADDON, open: true }])
  })
})
