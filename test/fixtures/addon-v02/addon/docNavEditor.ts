// #543 T03 附加组件文档导航测试组件编辑器页源码：消费公开 SDK 的
// views.openDocument（文档打开与定位请求）——浏览器/集成用例的「外部
// 测试组件经公开 API 消费」载体。
//
// 驱动协议（短轮询，与 hostSettingsEditor 同款）：
// - 挂载即循环 sdk.channel.request('docnav.next')（立即返回：一条待发
//   指令或 null；无指令小睡后重试）；
// - 每条指令 {seq, op, args} 执行 SDK 调用，结局经 'docnav.result' 上报。
//
// 操作面（op）：
// - open {target, locate?, sourceKind?}：sdk.views.openDocument——来源实例
//   按 sourceKind 解析（缺省 'main'；'embed' 取首个 embed 视图）；
// - folds {}：experimental.headingFold.folds('main')（折叠展开断言的
//   状态面）；
// - foldAll {}：experimental.headingFold.apply('main', 'foldAll')。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-docnav'

interface DocNavCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const views = sdk.views
  const headingFold = sdk.experimental.headingFold

  const sourceIdOf = (sourceKind: unknown): string | null => {
    if (!views) {
      return null
    }
    const list = views.list()
    if (sourceKind === 'embed') {
      return list.find((v) => v.viewType === 'embed')?.instanceId ?? null
    }
    return list.find((v) => v.viewType === 'main')?.instanceId ?? null
  }

  const runOp = (op: string, args: Record<string, unknown>): unknown => {
    switch (op) {
      case 'facetMissing':
        return { missing: views === undefined }
      case 'listViews':
        return (views?.list() ?? []).map((v) => ({
          instanceId: v.instanceId, viewType: v.viewType, mode: v.mode, editable: v.editable,
        }))
      case 'open': {
        if (!views) {
          return { ok: false, reason: 'facet-missing', opened: false }
        }
        const sourceInstanceId = sourceIdOf(args['sourceKind'])
        if (sourceInstanceId === null) {
          return { ok: false, reason: 'no-source-view', opened: false }
        }
        const request: {
          sourceInstanceId: string
          target: string
          locate?: { kind: 'line'; line: number } | { kind: 'heading'; heading: string } | { kind: 'block'; blockId: string }
        } = { sourceInstanceId, target: String(args['target'] ?? '') }
        if (args['locateLine'] !== undefined) {
          request.locate = { kind: 'line', line: Number(args['locateLine']) }
        } else if (args['locateHeading'] !== undefined) {
          request.locate = { kind: 'heading', heading: String(args['locateHeading']) }
        } else if (args['locateBlock'] !== undefined) {
          request.locate = { kind: 'block', blockId: String(args['locateBlock']) }
        }
        return views.openDocument(request)
      }
      case 'folds':
        return headingFold?.folds('main') ?? { ok: false, reason: 'facet-missing' }
      case 'foldAll':
        return headingFold?.apply('main', 'foldAll') ?? { ok: false, reason: 'facet-missing' }
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
      const sourceUri = views?.list().find((view) => view.viewType === 'main')?.targetDocUri
      if (!sourceUri) {
        await new Promise((r) => setTimeout(r, 150))
        continue
      }
      const reply = await sdk.channel.request('docnav.next', { sourceUri }, { timeoutMs: 5_000 })
      if (reply.ok !== true) {
        return // released / timeout（宿主失联）：退出循环
      }
      const cmd = reply.result as DocNavCommand | null
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
      // 上报失败即退出：面板关闭后 webview 桥死（hostSettingsEditor 同因）
      const ack = await sdk.channel.request('docnav.result', { seq: cmd.seq, outcome })
      if (ack.ok !== true) {
        return
      }
    }
  })()
})
