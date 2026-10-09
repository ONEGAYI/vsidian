// #410 标题折叠 API 测试组件编辑器页源码：消费公开 SDK 的
// experimental.headingFold 完成折叠区间查询与折叠/展开命令——浏览器/
// 集成用例的「外部测试组件经公开 API 消费」载体。
//
// 驱动协议（短轮询，与 t06Editor 同款）：
// - 挂载即循环 sdk.channel.request('fold.next')（立即返回：一条待发指令
//   或 null；无指令小睡后重试）；
// - 每条指令 {seq, op, args} 执行一个 SDK 调用，结局经 'fold.result' 上报
//   （宿主收件箱，用例断言）；
// - released/超时结束循环（webview 销毁随页面消亡）。
//
// 操作面（op）：
// - folds {instanceId} / foldable {instanceId}：两查询
// - apply {instanceId, operation, options?}：五操作（含 upToLevel 参数化）
// - foldAt {instanceId, keys} / unfoldAt {instanceId, keys}：按区间键
// - facetMissing：负向对照（experimental.headingFold 是否在场——老宿主
//   形态下组件自行降级的样板）
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-fold'

interface FoldCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const foldApi = sdk.experimental.headingFold
  if (!foldApi) {
    // 负向形态：宿主未提供该实验入口（未声明/版本不符被拒的组件本就
    // 不装载；此处覆盖「入口在场但内容缺省」的防御分支）——自行降级，
    // 指令回报 facet-missing
  }

  const runOp = (op: string, args: Record<string, unknown>): unknown => {
    const instanceId = typeof args['instanceId'] === 'string' ? args['instanceId'] : 'main'
    switch (op) {
      case 'facetMissing':
        return { missing: foldApi === undefined }
      case 'folds':
        return foldApi?.folds(instanceId) ?? { ok: false, reason: 'facet-missing' }
      case 'foldable':
        return foldApi?.foldable(instanceId) ?? { ok: false, reason: 'facet-missing' }
      case 'apply':
        return foldApi?.apply(
          instanceId,
          args['operation'] as never,
          args['options'] as never,
        ) ?? { ok: false, reason: 'facet-missing' }
      case 'foldAt':
        return foldApi?.foldAt(instanceId, args['keys'] as never) ?? { ok: false, reason: 'facet-missing' }
      case 'unfoldAt':
        return foldApi?.unfoldAt(instanceId, args['keys'] as never) ?? { ok: false, reason: 'facet-missing' }
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
      const reply = await sdk.channel.request('fold.next', {}, { timeoutMs: 5_000 })
      if (reply.ok !== true) {
        return // released / timeout（宿主失联）：退出循环
      }
      const cmd = reply.result as FoldCommand | null
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
      // 上报失败即退出：面板关闭后 webview 桥死（t06Editor 同因）
      const ack = await sdk.channel.request('fold.result', { seq: cmd.seq, outcome })
      if (ack.ok !== true) {
        return
      }
    }
  })()
})
