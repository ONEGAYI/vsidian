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
// - 负向注册三例（同名/局部 ID 含点/Tab 默认绑定 + 菜单 iconKey 未登记）：
//   结局随 t10.register 挂载上报，用例断言「明确拒绝」。
//
// 驱动协议（与 T06 同款短轮询）：挂载即 t10.register 上报注册结局；
// 循环 t10.next 取指令（立即回执一条或 null，无指令小睡重试）；每条指令
// {seq, op, args} 执行后经 t10.result 上报。ops：greet（计数）/ stamp
// （文本提交）/ counters（执行计数快照）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

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

  const stampCommand = commands.register(
    { id: 'insertStamp', title: 'T10 Stamp', mode: 'live', writes: true },
    () => {
      counters.insertStamp++
      void insertText('T10-STAMP')
    },
  )
  outcomes['insertStamp'] = stampCommand.ok
    ? { ok: true, commandId: stampCommand.commandId }
    : { ok: false, reason: stampCommand.reason }
  if (stampCommand.ok) handles.push(stampCommand.dispose)

  const greetCommand = commands.register(
    { id: 'greet', title: 'T10 Greet', mode: 'both', writes: false, defaultBindings: ['ctrl+alt+g'] },
    () => {
      counters.greet++
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

  const tabCommand = commands.register(
    { id: 'tabbed', title: 'T10 Tabbed', mode: 'both', defaultBindings: ['ctrl+tab'] },
    () => {},
  )
  outcomes['tabCommand'] = tabCommand.ok ? { ok: true } : { ok: false, reason: tabCommand.reason }

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
        return { ...counters }
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
