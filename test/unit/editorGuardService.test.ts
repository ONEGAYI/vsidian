// #322 默认编辑器守护——宿主服务单测（假端口注入，settingsService/
// jiebaResourceService 同模式）：两层时机模型（版本锁主动层 + 配置变更沿
// 被动层）、防骚扰语义（拒绝压制 / 版本绕过 / 每版本至多一次 / 超时不记
// 拒绝 / in-flight 防重弹）、修复链路（globalValue 基底写回 + 复查 +
// 降级引导）。被测模块 src/host/editorGuardService（不依赖 vscode）。
import { describe, expect, it } from 'vitest'
import {
  EDITOR_GUARD_STORAGE_KEY,
  EditorGuardService,
  type EditorGuardPorts,
} from '../../src/host/editorGuardService'
import { VSIDIAN_EDITOR_VIEW_TYPE } from '../../src/shared/editorGuard'

interface Harness {
  service: EditorGuardService
  state: {
    persistedRaw: unknown
    writes: unknown[]
    version: string
    associations: unknown
    globalAssociations: unknown
    updates: Array<Record<string, string>>
    updateError: unknown
    guardEnabled: boolean
    prompts: string[]
    promptAnswer: 'fix' | 'dismiss' | undefined
    promptGate: Promise<void> | null
    fixedNotices: number
    failedGuidances: number
    labels: Record<string, string>
  }
}

function makeHarness(
  opts?: { startupPromptDelayMs?: number; persistedRaw?: unknown },
): Harness {
  const state: Harness['state'] = {
    persistedRaw: opts?.persistedRaw,
    writes: [],
    version: '1.0.0',
    associations: undefined,
    globalAssociations: undefined,
    updates: [],
    updateError: null,
    guardEnabled: true,
    prompts: [],
    promptAnswer: undefined,
    promptGate: null,
    fixedNotices: 0,
    failedGuidances: 0,
    labels: {},
  }
  const ports: EditorGuardPorts = {
    readPersisted: () => state.persistedRaw,
    writePersisted: (value) => {
      state.writes.push(value)
      state.persistedRaw = value
      return Promise.resolve()
    },
    getExtensionVersion: () => state.version,
    getAssociations: () => state.associations,
    getGlobalAssociations: () => state.globalAssociations,
    updateGlobalAssociations: (value) => {
      if (state.updateError) {
        return Promise.reject(state.updateError)
      }
      state.updates.push(value)
      return Promise.resolve()
    },
    isGuardEnabled: () => state.guardEnabled,
    resolveTakerLabel: (viewType) =>
      viewType === 'default' ? '内置编辑器' : state.labels[viewType] ?? viewType,
    showTakeoverPrompt: async (label) => {
      state.prompts.push(label)
      if (state.promptGate) {
        await state.promptGate
      }
      return state.promptAnswer
    },
    showFixedNotice: () => {
      state.fixedNotices++
    },
    showFixFailedGuidance: () => {
      state.failedGuidances++
    },
  }
  const service = new EditorGuardService(ports, { startupPromptDelayMs: opts?.startupPromptDelayMs ?? 0 })
  return { service, state }
}

const TAKER = 'cweijan.vscode-office.editor'

describe('EditorGuardService 主动层（版本锁门控）', () => {
  it('存储键遵循 vsidian.<域> 命名习惯', () => {
    expect(EDITOR_GUARD_STORAGE_KEY).toBe('vsidian.editorGuard')
  })

  it('首装（锁空）且已接管：发起提示并写锁', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([TAKER])
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
  })

  it('首装但未接管：不提示，仍写锁', async () => {
    const { service, state } = makeHarness()
    await service.runStartupCheck()
    expect(state.prompts).toEqual([])
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
  })

  it('锁与当前版本相同：不提示也不写锁', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '1.0.0', rejections: [] } })
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([])
    expect(state.writes).toEqual([])
  })

  it('升级（锁旧版本）已接管：主动提示一次并写新锁', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '0.9.0', rejections: [] } })
    state.version = '1.0.0'
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([TAKER])
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
  })

  it('降级同样触发主动检测（规格：含降级）', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '2.0.0', rejections: [] } })
    state.version = '1.0.0'
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([TAKER])
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
  })

  it('写锁不依赖用户响应：提示挂起时锁已写入', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.promptGate = new Promise(() => {}) // 永不 resolve（用户未点按钮）
    await service.runStartupCheck()
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
  })

  it('主动层提示经约 1.5s 延迟出现（startupPromptDelayMs）', async () => {
    const { service, state } = makeHarness({ startupPromptDelayMs: 30 })
    state.associations = { '*.md': TAKER }
    const done = service.runStartupCheck()
    expect(state.prompts).toEqual([]) // 延迟内未弹
    await done
    await new Promise((r) => setTimeout(r, 40))
    expect(state.prompts).toEqual([TAKER]) // 延迟后出现
  })

  it('主动层提示可读名经 resolveTakerLabel（反查/内置特判在端口层）', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': 'default' }
    await service.runStartupCheck()
    expect(state.prompts).toEqual(['内置编辑器'])
  })
})

describe('EditorGuardService 被动层（沿触发）', () => {
  it('初始化（startup）后「未接管 → 接管」沿触发提示', async () => {
    const { service, state } = makeHarness()
    await service.runStartupCheck() // 基线：未接管
    state.associations = { '*.md': TAKER }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([TAKER])
  })

  it('沿为「接管 → 接管」（换抢占者）：状态不变化不重复弹', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck() // 基线：接管（主动层提示了一次——首装）
    state.associations = { '*.md': 'another.editor' }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([TAKER]) // 仅主动层那一次，无沿提示
  })

  it('沿为「接管 → 未接管」（用户改回）：不提示', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([TAKER]) // 仅主动层那一次
  })

  it('startup 未跑（基线未初始化）时配置变化不提示', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([])
  })
})

describe('EditorGuardService 拒绝记录语义', () => {
  it('用户点忽略：按抢占者 viewType 记入拒绝并持久化', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.promptAnswer = 'dismiss'
    await service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0)) // 等 prompt 链完成
    expect(state.writes.at(-1)).toEqual({ versionLock: '1.0.0', rejections: [TAKER] })
  })

  it('toast 自然超时（未点任何按钮）不记拒绝', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.promptAnswer = undefined
    await service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.writes.at(-1)).toEqual({ versionLock: '1.0.0', rejections: [] })
  })

  it('同抢占者：被动层沿提示被压制', async () => {
    // 预置拒绝记录与旧锁（版本相同 → 主动层不触发）
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '1.0.0', rejections: [TAKER] } })
    await service.runStartupCheck() // 基线初始化：接管但锁相同不提示
    expect(state.prompts).toEqual([])
    // 造一次「未接管 → 接管」沿（先改回我再被抢）
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.handleAssociationsChanged()
    state.associations = { '*.md': TAKER }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([]) // 同抢占者被压制
  })

  it('换抢占者：被动层沿重新具备提示资格', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '1.0.0', rejections: [TAKER] } })
    await service.runStartupCheck()
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.handleAssociationsChanged()
    state.associations = { '*.md': 'another.editor' }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual(['another.editor'])
  })

  it('版本变化触发的主动检测绕过拒绝记录一次', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '0.9.0', rejections: [TAKER] } })
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([TAKER]) // 绕过拒绝
    expect(state.writes.at(-1)).toEqual({ versionLock: '1.0.0', rejections: [TAKER] })
  })

  it('绕过每版本至多一次：锁写回后同版本不再主动提示', async () => {
    const { service, state } = makeHarness({ persistedRaw: { versionLock: '0.9.0', rejections: [TAKER] } })
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([TAKER])
    await service.runStartupCheck() // 第二次启动：锁已相同
    expect(state.prompts).toEqual([TAKER]) // 仍是那一次
  })
})

describe('EditorGuardService in-flight 防重弹', () => {
  it('提示在途时新沿不重复弹', async () => {
    const { service, state } = makeHarness()
    await service.runStartupCheck() // 基线：未接管
    state.associations = { '*.md': TAKER }
    state.promptGate = new Promise(() => {}) // 第一条提示永不完成
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([TAKER])
    // in-flight 期间再造一次沿（改回→再被抢）
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.handleAssociationsChanged()
    state.associations = { '*.md': 'another.editor' }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([TAKER]) // 无第二条
  })
})

describe('EditorGuardService 守护开关', () => {
  it('开关关闭：被动沿不提示，但版本锁照写（写锁不依赖开关）', async () => {
    const { service, state } = makeHarness()
    state.guardEnabled = false
    state.associations = { '*.md': TAKER }
    await service.runStartupCheck()
    expect(state.prompts).toEqual([])
    expect(state.writes).toEqual([{ versionLock: '1.0.0', rejections: [] }])
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.handleAssociationsChanged()
    state.associations = { '*.md': TAKER }
    await service.handleAssociationsChanged()
    expect(state.prompts).toEqual([])
  })

  it('开关不影响手动修复（fixNow 不受开关门控）', async () => {
    const { service, state } = makeHarness()
    state.guardEnabled = false
    // 生效值已是我（模拟 update 落地后 get() 的反映）；基底仍是他者
    state.associations = {
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    }
    state.globalAssociations = { '*.md': TAKER }
    const result = await service.fixNow()
    expect(result).toEqual({ ok: true })
    expect(state.updates).toEqual([{
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    }])
  })
})

describe('EditorGuardService 修复链路（fixNow）', () => {
  it('基于 inspect().globalValue 基底合并写回 global 层', async () => {
    const { service, state } = makeHarness()
    // 生效值模拟写回落地后（基础两键已是我、无关键保留）；基底仍是他者
    state.associations = {
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.ipynb': 'jupyter.notebook.ipynb',
    }
    state.globalAssociations = { '*.md': TAKER, '*.ipynb': 'jupyter.notebook.ipynb' }
    const result = await service.fixNow()
    expect(result).toEqual({ ok: true })
    // 写回值：基础键常写、无关键保留、不新增特异键
    expect(state.updates).toEqual([{
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.ipynb': 'jupyter.notebook.ipynb',
    }])
  })

  it('复查生效值已是我：成功确认通知', async () => {
    const { service, state } = makeHarness()
    // 动态生效值场景：fixNow 写回后复查读 get()——此处直接令生效值已是我
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE, '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE }
    state.globalAssociations = { '*.md': TAKER }
    const result = await service.fixNow()
    expect(result).toEqual({ ok: true })
    expect(state.fixedNotices).toBe(1)
    expect(state.failedGuidances).toBe(0)
  })

  it('复查生效值仍非我（workspace 层覆盖）：降级引导且不误报成功', async () => {
    const { service, state } = makeHarness()
    // global 层无基底（写回新建），但生效值被 workspace 层同 key 占住
    state.associations = { '*.md': TAKER }
    state.globalAssociations = undefined
    const result = await service.fixNow()
    expect(result).toEqual({ ok: false })
    expect(state.updates).toEqual([{
      '*.md': VSIDIAN_EDITOR_VIEW_TYPE,
      '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE,
    }])
    expect(state.failedGuidances).toBe(1)
    expect(state.fixedNotices).toBe(0)
  })

  it('update 写回抛异常：走降级引导并返回失败', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.updateError = new Error('write denied')
    const result = await service.fixNow()
    expect(result).toEqual({ ok: false })
    expect(state.failedGuidances).toBe(1)
  })

  it('提示点「改回」按钮：走同一修复链路', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.globalAssociations = { '*.md': TAKER }
    state.promptAnswer = 'fix'
    await service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.updates.length).toBe(1)
    expect(state.failedGuidances).toBe(1) // 复查时生效值仍是 TAKER（模拟未刷新）
  })

  it('修复成功路径：update 后生效值已是我 → 成功确认', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE, '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE }
    state.globalAssociations = { '*.md': TAKER }
    const result = await service.fixNow()
    expect(result).toEqual({ ok: true })
    expect(state.fixedNotices).toBe(1)
    expect(state.failedGuidances).toBe(0)
  })
})

describe('EditorGuardService 状态读取与重置', () => {
  it('getState 现算判定并暴露锁/拒绝/开关/in-flight', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.labels[TAKER] = 'Office Viewer'
    state.promptGate = new Promise(() => {})
    const probing = service.getState()
    expect(probing.takenOver).toBe(true)
    expect(probing.takerViewType).toBe(TAKER)
    expect(probing.takerLabel).toBe('Office Viewer')
    expect(probing.versionLock).toBeNull()
    expect(probing.rejections).toEqual([])
    expect(probing.guardEnabled).toBe(true)
    // 提示在途时 in-flight 可观测
    void service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0))
    expect(service.getState().promptInFlight).toBe(true)
    expect(probing.promptInFlight).toBe(false) // 快照不被后续变化污染
  })

  it('reset 清空持久化与拒绝并重建基线（测试钩子通道）', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.promptAnswer = 'dismiss'
    await service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0))
    expect(state.writes.at(-1)).toEqual({ versionLock: '1.0.0', rejections: [TAKER] })
    await service.reset()
    const snapshot = service.getState()
    expect(snapshot.versionLock).toBeNull()
    expect(snapshot.rejections).toEqual([])
    expect(state.persistedRaw).toEqual({ versionLock: null, rejections: [] })
  })
})

describe('EditorGuardService getDisplayState 设置页状态行载荷（#323）', () => {
  it('无记录 → none：viewType 与 label 均 null（展示文本由设置页组句）', () => {
    const { service, state } = makeHarness()
    state.associations = undefined
    expect(service.getDisplayState()).toEqual({ status: 'none', viewType: null, label: null })
  })
  it('全是我 → vsidian：判定现算（修复后无需重推也能读到新形态）', async () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE, '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE }
    expect(service.getDisplayState()).toEqual({ status: 'vsidian', viewType: null, label: null })
  })
  it('内置编辑器 → builtin：viewType 随行（"default"），label 为 null——展示文本走设置页语言包', () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': 'default' }
    expect(service.getDisplayState()).toEqual({ status: 'builtin', viewType: 'default', label: null })
  })
  it('其他扩展 → other：label 经 resolveTakerLabel 端口反查可读名', () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.labels[TAKER] = 'Office Viewer'
    expect(service.getDisplayState())
      .toEqual({ status: 'other', viewType: TAKER, label: 'Office Viewer' })
  })
  it('其他扩展反查失败 → label 回退关联值原文（本身即 viewType 字符串）', () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    expect(service.getDisplayState())
      .toEqual({ status: 'other', viewType: TAKER, label: TAKER })
  })
  it('守护开关关闭不影响状态行数据（关闭只停提示，规格守护模式决策）', () => {
    const { service, state } = makeHarness()
    state.associations = { '*.md': TAKER }
    state.guardEnabled = false
    expect(service.getDisplayState().status).toBe('other')
  })
})

describe('EditorGuardService onStateChanged 状态变化订阅（#323 设置页推送）', () => {
  it('配置变更（被动层）后通知监听者——包括判定不变的变更（推送现算幂等）', async () => {
    const { service, state } = makeHarness()
    const events: number[] = []
    const off = service.onStateChanged(() => events.push(events.length))
    // 先初始化基线（runStartupCheck 锁相同仅建基线，不通知）
    state.version = '1.0.0'
    state.persistedRaw = { versionLock: '1.0.0', rejections: [] }
    await service.runStartupCheck()
    expect(events).toHaveLength(0)
    state.associations = { '*.md': TAKER }
    await service.handleAssociationsChanged()
    expect(events).toHaveLength(1)
    // 判定不变（接管 → 接管）的变更沿同样通知：状态行以宿主现算为准
    state.associations = { '*.md': 'another.editor' }
    await service.handleAssociationsChanged()
    expect(events).toHaveLength(2)
    off()
    await service.handleAssociationsChanged()
    expect(events).toHaveLength(2)
  })
  it('fixNow 完成后通知监听者（手动改回 → 设置页状态行即时更新）', async () => {
    const { service, state } = makeHarness()
    const events: number[] = []
    service.onStateChanged(() => events.push(events.length))
    state.associations = { '*.md': VSIDIAN_EDITOR_VIEW_TYPE, '*.markdown': VSIDIAN_EDITOR_VIEW_TYPE }
    await service.fixNow()
    expect(events).toHaveLength(1)
  })
  it('提示在途不产生额外通知（拒绝记录与锁写不是状态行变化）', async () => {
    const { service, state } = makeHarness()
    const events: number[] = []
    service.onStateChanged(() => events.push(events.length))
    state.associations = { '*.md': TAKER }
    state.promptAnswer = 'dismiss'
    await service.runStartupCheck()
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toHaveLength(0)
  })
})
