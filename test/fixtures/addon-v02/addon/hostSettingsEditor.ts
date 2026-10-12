// #457 附加组件宿主设置读取面测试组件编辑器页源码：消费公开 SDK 的
// experimental.hostSettings 读白名单宿主设置当前值——浏览器用例的
// 「外部测试组件经公开 API 消费」载体。
//
// 驱动协议（短轮询，与 foldEditor 同款）：
// - 挂载即循环 sdk.channel.request('hostSettings.next')（立即返回：一条
//   待发指令或 null；无指令小睡后重试）；
// - 每条指令 {seq, op, args} 执行一个 SDK 调用，结局经
//   'hostSettings.result' 上报（宿主收件箱，用例断言）；
// - released/超时结束循环（webview 销毁随页面消亡）。
//
// 操作面（op）：
// - get {key}：读取指定键（key 由用例下发——白名单键与负向键都在用例侧
//   定义，夹具只透传，不自带键集）
// - facetMissing：负向对照（experimental.hostSettings 是否在场——老宿主
//   形态下组件自行降级的样板）
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-host-settings'

interface HostSettingsCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const hostSettings = sdk.experimental.hostSettings
  if (!hostSettings) {
    // 负向形态：宿主未提供该实验入口（未声明/版本不符被拒的组件本就
    // 不装载；此处覆盖「入口在场但内容缺省」的防御分支）——自行降级，
    // 指令回报 facet-missing
  }

  const runOp = (op: string, args: Record<string, unknown>): unknown => {
    switch (op) {
      case 'facetMissing':
        return { missing: hostSettings === undefined }
      case 'get': {
        const key = args['key']
        if (typeof key !== 'string') {
          return { ok: false, reason: 'bad-args:key-required' }
        }
        return hostSettings?.get(key as never) ?? { ok: false, reason: 'facet-missing' }
      }
      default:
        return { ok: false, reason: `unknown-op:${op}` }
    }
  }

  let stopped = false
  sdk.onDispose(() => {
    stopped = true
  })

  void (async () => {
    while (!stopped) {
      const reply = await sdk.channel.request('hostSettings.next', {}, { timeoutMs: 5_000 })
      if (reply.ok !== true) {
        return // released / timeout（宿主失联）：退出循环
      }
      const cmd = reply.result as HostSettingsCommand | null
      if (cmd === null) {
        await new Promise((r) => setTimeout(r, 150)) // 本轮无指令：小睡后重试
        continue
      }
      let outcome: unknown
      try {
        outcome = runOp(cmd.op, cmd.args ?? {})
      } catch (err) {
        outcome = { ok: false, reason: `op-error:${String(err)}` }
      }
      // 上报失败即退出：面板关闭后 webview 桥死（foldEditor 同因）
      const ack = await sdk.channel.request('hostSettings.result', { seq: cmd.seq, outcome })
      if (ack.ok !== true) {
        return
      }
    }
  })()
})
