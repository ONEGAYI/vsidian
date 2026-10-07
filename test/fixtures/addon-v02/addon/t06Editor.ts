// #355 T06 测试组件编辑器页源码：消费公开 SDK 的 views 面完成真实视图/
// 快照/提交/选区操作——集成用例的「外部测试组件经公开 API 消费」载体。
//
// 驱动协议（短轮询，宿主夹具 addon-t06 配对）：
// - 挂载即循环 sdk.channel.request('t06.next')（立即返回：一条待发指令
//   或 null；无指令小睡后重试——不做挂起式长轮询，面板可销毁的场景下
//   挂起 resolver 会变成死 waiter 吞指令）；
// - 每条指令 {seq, op, args} 执行一个 SDK 调用，结局经 't06.result' 上报
//   （宿主收件箱，用例经 t06.collect 断言）；
// - released/超时结束循环（webview 销毁随页面消亡，无需显式退出）。
//
// 操作面（op）：
// - list / created / disposed：views.list 与变化订阅的采样
// - snapshot {instanceId} / applyEdits {instanceId, request} /
//   setSelection {instanceId, ranges} / reveal {instanceId, offset}
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-t06'

interface T06Command {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const views = sdk.views
  if (!views) {
    throw new Error('editor page SDK must expose views facet')
  }
  const createdEvents: unknown[] = []
  const disposedEvents: unknown[] = []
  views.onCreated((info) => {
    createdEvents.push(info)
  })
  views.onDisposed((info) => {
    disposedEvents.push(info)
  })

  let stopped = false
  sdk.onDispose(() => {
    stopped = true
  })

  const runOp = async (op: string, args: Record<string, unknown>): Promise<unknown> => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : ''
    const handle = instanceId !== '' ? views.get(instanceId) : null
    switch (op) {
      case 'list':
        return { views: views.list() }
      case 'created':
        return { events: createdEvents.splice(0) }
      case 'disposed':
        return { events: disposedEvents.splice(0) }
      case 'snapshot':
        if (!handle) {
          return { ok: false, reason: 'view-disposed' }
        }
        return handle.editor.getSnapshot()
      case 'applyEdits': {
        if (!handle) {
          return { ok: false, reason: 'view-disposed' }
        }
        const request = args['request'] as Parameters<typeof handle.editor.applyEdits>[0]
        return await handle.editor.applyEdits(request)
      }
      case 'setSelection': {
        if (!handle) {
          return { ok: false, reason: 'view-disposed' }
        }
        return { accepted: handle.editor.setSelection(args['ranges'] as never) }
      }
      case 'reveal': {
        if (!handle) {
          return { ok: false, reason: 'view-disposed' }
        }
        return { accepted: handle.editor.reveal(args['offset'] as number) }
      }
      default:
        return { ok: false, reason: `unknown-op:${op}` }
    }
  }

  void (async () => {
    while (!stopped) {
      const reply = await sdk.channel.request('t06.next', {}, { timeoutMs: 5_000 })
      if (reply.ok !== true) {
        return // released / timeout（宿主失联）：退出循环
      }
      const cmd = reply.result as T06Command | null
      if (cmd === null) {
        await new Promise((r) => setTimeout(r, 150)) // 本轮无指令：小睡后重试
        continue
      }
      let outcome: unknown
      try {
        outcome = await runOp(cmd.op, cmd.args ?? {})
      } catch (err) {
        outcome = { ok: false, reason: `op-error:${String(err)}` }
      }
      // 上报失败即退出：面板关闭后 webview 桥死（postMessage 黑洞或
      // released）——本实例继续轮询只会吞走新面板组件的指令且结局无法
      // 回收（集成实测：旧面板实例残留轮询导致新面板 probe 超时）
      const ack = await sdk.channel.request('t06.result', { seq: cmd.seq, outcome })
      if (ack.ok !== true) {
        return
      }
    }
  })()
})
