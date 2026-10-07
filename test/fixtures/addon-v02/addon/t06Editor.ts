// #355 T06 测试组件编辑器页源码：消费公开 SDK 的 views 面完成真实视图/
// 快照/提交/选区操作——集成用例的「外部测试组件经公开 API 消费」载体。
//
// 驱动协议（长轮询，宿主夹具 addon-t06 配对）：
// - 挂载即循环 sdk.channel.request('t06.next')（长轮询取指令；宿主侧
//   handler 挂起至用例经 t06.queue 塞入指令）；
// - 每条指令 {seq, op, args} 执行一个 SDK 调用，结局经 't06.result' 上报
//   （宿主收件箱，用例经 t06.collect 断言）；
// - 释放/超时结束循环（released/timeout 由装载器本地终结）。
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
      const reply = await sdk.channel.request('t06.next', {}, { timeoutMs: 55_000 })
      if (reply.ok !== true) {
        return // released / timeout：退出循环
      }
      const cmd = reply.result as T06Command | null
      if (cmd === null) {
        continue // 本轮无指令（broadcast 空唤醒）：重新挂起长轮询
      }
      let outcome: unknown
      try {
        outcome = await runOp(cmd.op, cmd.args ?? {})
      } catch (err) {
        outcome = { ok: false, reason: `op-error:${String(err)}` }
      }
      void sdk.channel.request('t06.result', { seq: cmd.seq, outcome })
    }
  })()
})
