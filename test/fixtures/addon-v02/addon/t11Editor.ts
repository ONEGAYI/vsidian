// #360 T11 测试组件编辑器页源码：消费公开 SDK 的 ui 面完成按钮/面板
// 注册（含真实业务——按钮回调经 target 句柄提交文本）与负向注册对照
// ——浏览器与集成用例的「外部组件经公开 API 消费」载体。
//
// 注册面（挂载即执行）：
// - 命令 insertStamp（T10 面，live、writes、默认 ctrl+alt+t——按钮键位
//   徽章的数据源）；
// - 按钮 stampBtn（onClick 自带回调：经 target() 句柄在当前目标光标处
//   插入「T11-BTN」——目标路由验证载体：焦点在嵌入 B 内时写 B 不写 A）；
// - 按钮 cmdBtn（command: 'insertStamp'——挂接已注册命令的路径）；
// - 按钮 liveOnlyBtn（mode: 'live'——模式回收矩阵载体）；
// - 面板 notes（mount 写「T11-PANEL-CONTENT」并记录 target() 实例 ID；
//   根引用保留供迟到写入对照）；
// - 面板 livePanel（mode: 'live'——模式不符强制关闭载体）；
// - 负向注册四例（同名按钮/槽位白名单外/动作二选一冲突/同名面板）：
//   结局随 t11.register 挂载上报，用例断言「明确拒绝」。
//
// 驱动协议（与 T06/T10 同款短轮询）：挂载即 t11.register 上报注册结局；
// 循环 t11.next 取指令；每条指令 {seq, op, args} 执行后经 t11.result 上报。
// ops：openPanel/closePanel/panelState（开态与 mount 目标）/lateWrite
// （往已脱挂的根写迟到内容）/insertViaTarget（经 target() 提交文本）/
// counters（执行计数快照）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonViewHandle } from '../../../../src/shared/addonEditApi'

/** 本组件声明的扩展 ID（装载器按此核对入口身份；宿主夹具 addon-t11 配对） */
const ADDON_ID = 'vsidian-test-fixture.addon-t11'

interface T11Command {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const views = sdk.views
  if (!views) {
    throw new Error('editor page SDK must expose views facet')
  }
  const commands = sdk.commands
  const ui = sdk.ui
  if (!commands || !ui) {
    throw new Error('editor page SDK must expose commands/ui facets (T11)')
  }

  const counters: Record<string, number> = { stampBtn: 0, insertStamp: 0, panelMounts: 0 }
  const outcomes: Record<string, unknown> = {}
  const handles: Array<() => void> = []
  /** 面板根引用（close 后脱挂——迟到写入不可见的对照载体） */
  let panelRoot: HTMLElement | null = null
  /** 面板 target 获取器（mount 注入；insertViaTarget 的动态解析入口） */
  let panelTarget: (() => AddonViewHandle | null) | null = null
  /** mount 时刻与 target() 动态解析记录（目标路由断言面） */
  const targetSeen: Array<string | null> = []

  // ---- T10 命令（按钮挂接路径的动作源；默认绑定供键位徽章断言） ----
  const insertText = async (text: string, target: AddonViewHandle | null): Promise<unknown> => {
    if (!target) {
      return { ok: false, reason: 'no-active-target' }
    }
    const snapshot = await target.editor.getSnapshot()
    if (!snapshot.ok) {
      return snapshot
    }
    return target.editor.applyEdits({
      revision: snapshot.snapshot.revision,
      changes: [{ offset: snapshot.snapshot.selections[0]?.head ?? 0, length: 0, text }],
    })
  }

  const stampCommand = commands.register(
    { id: 'insertStamp', title: 'T11 Stamp', mode: 'live', writes: true, defaultBindings: ['ctrl+alt+t'] },
    () => {
      counters.insertStamp++
    },
  )
  outcomes['insertStamp'] = stampCommand.ok
    ? { ok: true, commandId: stampCommand.commandId }
    : { ok: false, reason: stampCommand.reason }
  if (stampCommand.ok) handles.push(stampCommand.dispose)

  // ---- 正向按钮：onClick 自带回调（目标路由载体） ----
  const stampBtn = ui.registerButton(
    { id: 'stampBtn', label: 'T11 Button', iconText: 'T11' },
    (target) => {
      counters.stampBtn++
      // 异步提交自主收尾（回调面是同步 void；异常由 promise 链自吞）
      void insertText('T11-BTN', target).catch(() => {})
    },
  )
  outcomes['stampBtn'] = stampBtn.ok ? { ok: true, id: stampBtn.id } : { ok: false, reason: stampBtn.reason }
  if (stampBtn.ok) handles.push(stampBtn.dispose)

  // ---- 正向按钮：挂接已注册命令（键位徽章数据源） ----
  const cmdBtn = ui.registerButton({ id: 'cmdBtn', label: 'T11 Cmd', command: 'insertStamp' })
  outcomes['cmdBtn'] = cmdBtn.ok ? { ok: true, id: cmdBtn.id } : { ok: false, reason: cmdBtn.reason }
  if (cmdBtn.ok) handles.push(cmdBtn.dispose)

  // ---- 正向按钮：声明模式（回收矩阵载体） ----
  const liveBtn = ui.registerButton(
    { id: 'liveOnlyBtn', label: 'T11 Live Only', mode: 'live' },
    () => { counters.stampBtn++ },
  )
  outcomes['liveOnlyBtn'] = liveBtn.ok ? { ok: true, id: liveBtn.id } : { ok: false, reason: liveBtn.reason }
  if (liveBtn.ok) handles.push(liveBtn.dispose)

  // ---- 正向面板：mount/unmount 生命周期与目标获取器 ----
  const notesPanel = ui.registerPanel({
    id: 'notes',
    title: 'T11 Notes',
    mount: (root, target) => {
      panelRoot = root as HTMLElement
      panelTarget = target
      counters.panelMounts++
      targetSeen.push(target()?.info.instanceId ?? 'null')
      ;(root as HTMLElement).textContent = 'T11-PANEL-CONTENT'
    },
    unmount: () => {
      panelTarget = null
    },
  })
  outcomes['notesPanel'] = notesPanel.ok ? { ok: true, id: notesPanel.id } : { ok: false, reason: notesPanel.reason }
  if (notesPanel.ok) handles.push(notesPanel.dispose)

  const livePanel = ui.registerPanel({
    id: 'livePanel',
    title: 'T11 Live Panel',
    mode: 'live',
    mount: () => { counters.panelMounts++ },
    unmount: () => {},
  })
  outcomes['livePanel'] = livePanel.ok ? { ok: true, id: livePanel.id } : { ok: false, reason: livePanel.reason }
  if (livePanel.ok) handles.push(livePanel.dispose)

  // ---- 负向注册（票面验收：明确拒绝的四类尝试） ----
  const dupButton = ui.registerButton({ id: 'stampBtn', label: 'T11 Dup' }, () => {})
  outcomes['dupButton'] = dupButton.ok ? { ok: true } : { ok: false, reason: dupButton.reason }

  const slotButton = ui.registerButton({ id: 'slotBtn', label: 'T11 Slot', slot: 'sidebar' as never }, () => {})
  outcomes['slotButton'] = slotButton.ok ? { ok: true } : { ok: false, reason: slotButton.reason }

  const conflictButton = ui.registerButton({ id: 'conflictBtn', label: 'T11 Conflict', command: 'insertStamp' }, () => {})
  outcomes['conflictButton'] = conflictButton.ok ? { ok: true } : { ok: false, reason: conflictButton.reason }

  const dupPanel = ui.registerPanel({ id: 'notes', title: 'T11 Dup Panel', mount: () => {} })
  outcomes['dupPanel'] = dupPanel.ok ? { ok: true } : { ok: false, reason: dupPanel.reason }

  // ---- 驱动协议（短轮询；宿主夹具 t11.next/t11.result/t11.register 配对） ----
  const runOp = async (op: string): Promise<unknown> => {
    switch (op) {
      case 'openPanel': {
        const opened = notesPanel.open()
        return { opened }
      }
      case 'openLivePanel': {
        const opened = livePanel.open()
        return { opened }
      }
      case 'closePanel': {
        const closed = notesPanel.close()
        return { closed }
      }
      case 'panelState': {
        return { open: notesPanel.isOpen(), livePanelOpen: livePanel.isOpen(), targetSeen: [...targetSeen] }
      }
      case 'lateWrite': {
        // 迟到结果对照：往 close 后保留的根引用写内容（平台保证——根已
        // 脱挂，dock 内不可见；panelRoot 为 null 时返回未挂载标记）
        if (panelRoot === null) {
          return { ok: false, reason: 'no-root' }
        }
        panelRoot.textContent = 'T11-LATE-RESULT'
        return { ok: true, connected: panelRoot.isConnected }
      }
      case 'insertViaTarget': {
        // 目标路由：经面板 target() 的当前活动句柄提交文本（嵌入 B 聚焦
        // 时写 B——与 views.get 无关的动态解析路径）
        if (!panelTarget) {
          return { ok: false, reason: 'panel-not-mounted' }
        }
        return insertText('T11-TARGET', panelTarget())
      }
      case 'counters':
        return { ...counters }
      default:
        return { ok: false, reason: `unknown-op:${op}` }
    }
  }

  let stopped = false
  sdk.onDispose(() => {
    stopped = true
    for (const dispose of handles.splice(0)) {
      try {
        dispose()
      } catch {
        // 已释放句柄的迟到 dispose 无害
      }
    }
  })

  void sdk.channel.request('t11.register', { addonId: ADDON_ID, outcomes })

  void (async () => {
    while (!stopped) {
      const outcome = await sdk.channel.request('t11.next', null, { timeoutMs: 4000 })
      if (!outcome.ok) {
        if (outcome.reason === 'released') {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      const command = outcome.result as T11Command | null
      if (command === null || command === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      const result = await runOp(command.op)
      void sdk.channel.request('t11.result', { seq: command.seq, outcome: result })
    }
  })()
})
