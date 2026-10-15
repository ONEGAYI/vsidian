// T05（#544）测试组件编辑器页源码：消费公开 SDK 的 refViews 面（只读引用
// 浮窗请求）与 ui 面（面板承载触发控件）——浏览器与集成用例的「外部组件
// 经公开 API 消费」载体。
//
// 结构：注册一个平台面板（T11 ui 面），mount 时在内容根创建触发按钮
// （组件自有控件 = 浮窗请求的触发位置载体）；经 refViews.requestPopup
// 发起请求并把结局上报。驱动协议（短轮询，与 T06/T10/T11 同款）：
// - rv.register：挂载即上报（面板与 facet 在场性）；
// - rv.next：取指令 {seq, op, args}；
// - rv.result：逐条上报执行结局。
// ops：request（requestPopup：source/target/keyboard；结局 {ok, reason}）/
// close（句柄 close → boolean）/ active（句柄 isActive → boolean）/
// closePanel + openPanel（面板开闭 → 触发控件脱树/回场，来源消失载体）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonRefAnchor, AddonRefPopupHandle } from '../../../../src/shared/addonRefViews'

const ADDON_ID = 'vsidian-test-fixture.addon-refviews'

interface RvCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const refViews = sdk.refViews
  const ui = sdk.ui
  if (!refViews || !ui) {
    throw new Error('editor page SDK must expose refViews/ui facets (T05 #544)')
  }

  /** 请求句柄簿记（id → handle——close/active 指令的寻址面） */
  const handles = new Map<string, AddonRefPopupHandle>()
  let active = true
  sdk.onDispose(() => { active = false })
  /** 触发控件（面板 mount 时创建；closePanel 后脱挂） */
  let triggerEl: HTMLElement | null = null

  const panel = ui.registerPanel({ id: 'refpanel', title: '引用面板', mount(root) {
    const host = root as HTMLElement
    host.innerHTML = ''
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'rv-trigger'
    btn.textContent = '预览引用'
    host.appendChild(btn)
    triggerEl = btn
  }, unmount() {
    triggerEl = null
  } })
  panel.open()

  const request = async (args: Record<string, unknown>): Promise<unknown> => {
    const id = String(args['id'] ?? 'r0')
    const anchor = args['anchor'] as AddonRefAnchor | undefined
    const outcome = await refViews.requestPopup({
      source: String(args['source'] ?? 'main'),
      target: { path: String(args['path'] ?? ''), ...(anchor !== undefined ? { anchor } : {}) },
      trigger: triggerEl ?? document.body,
      ...(args['keyboard'] === true ? { keyboard: true } : {}),
    })
    if (outcome.ok) {
      handles.set(id, outcome.handle)
      return { ok: true }
    }
    return { ok: false, reason: outcome.reason }
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  void (async () => {
    await sdk.channel.request('rv.register', {
      refViews: true,
      panel: panel.isOpen(),
    })
    while (active) {
      const outcome = await sdk.channel.request('rv.next', null, { timeoutMs: 60_000 })
      if (!active) return
      if (!outcome.ok || outcome.result === null || outcome.result === undefined) {
        await sleep(120)
        continue
      }
      const command = outcome.result as RvCommand
      let result: unknown
      try {
        switch (command.op) {
          case 'request':
            result = await request(command.args ?? {})
            break
          case 'close': {
            const handle = handles.get(String(command.args?.['id'] ?? ''))
            result = handle !== undefined ? handle.close() : false
            break
          }
          case 'active': {
            const handle = handles.get(String(command.args?.['id'] ?? ''))
            result = handle !== undefined ? handle.isActive() : false
            break
          }
          case 'closePanel':
            result = panel.close()
            break
          case 'openPanel':
            result = panel.open()
            break
          case 'views':
            result = sdk.views ? sdk.views.list() : null
            break
          default:
            result = { ok: false, reason: `unknown-op:${command.op}` }
        }
      } catch (err) {
        result = { ok: false, reason: String(err) }
      }
      await sdk.channel.request('rv.result', { seq: command.seq, outcome: result })
    }
  })()
})
