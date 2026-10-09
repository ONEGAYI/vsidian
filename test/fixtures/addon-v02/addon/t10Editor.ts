// #359 T10 测试组件编辑器页源码：消费公开 SDK 的 commands/menus 面完成
// 命令注册（含真实业务——经 views 面提交文本）、菜单新增与负向注册对照
// ——浏览器与集成用例的「外部组件经公开 API 消费」载体。
//
// 注册面（挂载即执行）：
// - insertStamp（live、writes、默认未绑定）：光标处插入「T10-STAMP」
//   文本——经 views.applyEdits 真实提交（默认原子修饰，宿主撤销一笔回退）；
// - greet（both、只读、默认 ctrl+alt+g）：计一次执行（真实键盘场景的
//   默认绑定路由载体）；
// - stampEntry 菜单项（挂接 insertStamp；iconKey=link 复用既有资产）；
// - 负向注册（同名/局部 ID 含点/保留 Tab 默认绑定 + 菜单 iconKey 未登记）
//   与 #427 正向样例（ctrl+tab 修饰 Tab 放行）：结局随 t10.register 挂载
//   上报，用例分别断言「明确拒绝」与「注册成功」。
//
// 驱动协议（与 T06 同款短轮询）：挂载即 t10.register 上报注册结局；
// 循环 t10.next 取指令（立即回执一条或 null，无指令小睡重试）；每条指令
// {seq, op, args} 执行后经 t10.result 上报。ops：greet（计数）/ stamp
// （文本提交）/ counters（执行计数快照）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonViewHandle } from '../../../../src/shared/addonEditApi'

/** 本组件声明的扩展 ID（装载器按此核对入口身份；宿主夹具 addon-t10 配对） */
const ADDON_ID = 'vsidian-test-fixture.addon-t10'

interface T10Command {
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
  const menus = sdk.menus
  if (!commands || !menus) {
    throw new Error('editor page SDK must expose commands/menus facets (T10)')
  }

  const counters: Record<string, number> = { greet: 0, insertStamp: 0 }
  const outcomes: Record<string, unknown> = {}
  const handles: Array<() => void> = []
  /** #427：最近一次命令回调收到的目标视图句柄信息（观察面） */
  let lastTarget: { instanceId: string; mode: string } | null = null

  // ---- 正向注册：真实业务命令（文本提交经公开 views 面） ----
  const insertText = async (text: string): Promise<unknown> => {
    const listed = views.list().filter((info) => info.viewType === 'main')
    const main = listed[0]
    if (!main) {
      return { ok: false, reason: 'no-main-view' }
    }
    const handle = views.get(main.instanceId)
    if (!handle) {
      return { ok: false, reason: 'view-disposed' }
    }
    const snapshot = await handle.editor.getSnapshot()
    if (!snapshot.ok) {
      return snapshot
    }
    return handle.editor.applyEdits({
      revision: snapshot.snapshot.revision,
      changes: [{ offset: snapshot.snapshot.selections[0]?.head ?? 0, length: 0, text }],
    })
  }

  /** #427：经回调收到的目标句柄提交（null = 无活动视图——防御性回报） */
  const insertTextVia = async (target: AddonViewHandle | null, text: string): Promise<unknown> => {
    if (!target) {
      return { ok: false, reason: 'no-target-view' }
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
    { id: 'insertStamp', title: 'T10 Stamp', mode: 'live', writes: true },
    // #427：回调携带命令激活时刻的活动视图句柄——直接向 target 提交，
    // 不再经 views.list 推定主正文（组件侧防御链拆除的正向样板）
    (target) => {
      counters.insertStamp++
      lastTarget = target ? { instanceId: target.info.instanceId, mode: target.info.mode } : null
      void insertTextVia(target, 'T10-STAMP')
    },
  )
  outcomes['insertStamp'] = stampCommand.ok
    ? { ok: true, commandId: stampCommand.commandId }
    : { ok: false, reason: stampCommand.reason }
  if (stampCommand.ok) handles.push(stampCommand.dispose)

  const greetCommand = commands.register(
    { id: 'greet', title: 'T10 Greet', mode: 'both', writes: false, defaultBindings: ['ctrl+alt+g'] },
    // #427：观察面——记录回调收到的目标视图句柄（counters 快照带出）
    (target) => {
      counters.greet++
      lastTarget = target ? { instanceId: target.info.instanceId, mode: target.info.mode } : null
    },
  )
  outcomes['greet'] = greetCommand.ok
    ? { ok: true, commandId: greetCommand.commandId }
    : { ok: false, reason: greetCommand.reason }
  if (greetCommand.ok) handles.push(greetCommand.dispose)

  // ---- 负向注册（票面验收：明确拒绝的三类尝试 + 菜单 iconKey） ----
  const dupCommand = commands.register(
    { id: 'insertStamp', title: 'T10 Stamp (dup)', mode: 'live', writes: true },
    () => {},
  )
  outcomes['dupCommand'] = dupCommand.ok ? { ok: true } : { ok: false, reason: dupCommand.reason }

  const dottedCommand = commands.register(
    { id: 'other.addon.evil', title: 'T10 Forged', mode: 'both' },
    () => {},
  )
  outcomes['dottedCommand'] = dottedCommand.ok ? { ok: true } : { ok: false, reason: dottedCommand.reason }

  // #427 起：裸 Tab / Shift+Tab 仍拒（#125 三段链），ctrl/alt/meta+Tab 放行
  const bareTabCommand = commands.register(
    { id: 'tabbed', title: 'T10 Tabbed', mode: 'both', defaultBindings: ['shift+tab'] },
    () => {},
  )
  outcomes['bareTabCommand'] = bareTabCommand.ok ? { ok: true } : { ok: false, reason: bareTabCommand.reason }

  const modTabCommand = commands.register(
    { id: 'tabbed-mod', title: 'T10 Mod Tabbed', mode: 'both', defaultBindings: ['ctrl+tab'] },
    () => {},
  )
  outcomes['modTabCommand'] = modTabCommand.ok ? { ok: true } : { ok: false, reason: modTabCommand.reason }

  // ---- 菜单注册：挂接命令（执行键 = 命名空间命令 ID） ----
  const menuOutcome = menus.registerItem({
    id: 'stampEntry',
    label: 'T10 Stamp Entry',
    iconKey: 'link',
    command: 'insertStamp',
  })
  outcomes['menuEntry'] = menuOutcome.ok
    ? { ok: true, id: menuOutcome.id }
    : { ok: false, reason: menuOutcome.reason }
  if (menuOutcome.ok) handles.push(menuOutcome.dispose)

  const badIconMenu = menus.registerItem({ id: 'badIcon', label: 'T10 Bad Icon', iconKey: 'not-in-table' })
  outcomes['badIconMenu'] = badIconMenu.ok ? { ok: true } : { ok: false, reason: badIconMenu.reason }

  // ---- 驱动协议（短轮询；宿主夹具 t10.next/t10.result/t10.register 配对） ----
  const runOp = async (op: string): Promise<unknown> => {
    switch (op) {
      case 'greet':
        counters.greet++
        return { greeted: counters.greet }
      case 'stamp':
        return insertText('T10-STAMP')
      case 'counters':
        return { ...counters, lastTarget }
      default:
        return { ok: false, reason: `unknown-op:${op}` }
    }
  }

  let stopped = false
  sdk.onDispose(() => {
    stopped = true
    // 自主清理（平台整组件回收之外的句柄路径；重复释放无害）
    for (const dispose of handles.splice(0)) {
      try {
        dispose()
      } catch {
        // 已释放句柄的迟到 dispose 无害
      }
    }
  })

  // 挂载即上报注册结局（宿主收件箱——负向拒绝与正向 ID 的断言面）
  void sdk.channel.request('t10.register', { addonId: ADDON_ID, outcomes })

  void (async () => {
    while (!stopped) {
      const outcome = await sdk.channel.request('t10.next', null, { timeoutMs: 4000 })
      if (!outcome.ok) {
        if (outcome.reason === 'released') {
          return
        }
        // timeout：无指令，小睡重试
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      const command = outcome.result as T10Command | null
      if (command === null || command === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      const result = await runOp(command.op)
      void sdk.channel.request('t10.result', { seq: command.seq, outcome: result })
    }
  })()
})
