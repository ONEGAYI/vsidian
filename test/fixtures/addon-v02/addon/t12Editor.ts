// #361 T12 测试组件编辑器页源码：诊断与全组件故障暂停的公开路径载体。
// 覆盖四态区分（票面验收第 4 条）：
// - 正常态：行为（^ → -T12-）、命令（insertStamp 插 T12-CMD）、按钮
//   （boomBtn 插 T12-BTN）与渲染器（t12graph → t12-box）全部正常工作；
// - 全组件停用：arm 命中时对应回调抛未捕获异常（behavior/command/
//   button/render-mount/enable——enable 在宿主侧抛）；
// - 自处理渲染失败：arm = render-self-handled 时 mount 内部 catch 自己
//   的异常画降级内容（T12-DEGRADED）——不上报、不停用（Q30 负向对照）；
// - API 合理拒绝与业务失败：宿主侧通道（businessFail 返回错误对象）与
//   重复注册拒绝——不触发故障（负向对照，宿主侧断言）。
//
// 防毒化（T09 同款）：集成/浏览器宿主是共享会话——贡献注册会改变 '^'
// 键入行为与渲染型语言集（t12graph），未经宿主 setContrib 放行时本页
// 保持惰性（零贡献，等价 T02/T06 夹具）。放行后异步补注册（SDK 句柄
// 在本次装载代次内存活——装载器对工厂的同步调用正常完成）。
//
// arm 视图：宿主侧模块变量经 t12.next 应答持续下发；页面确认经
// t12.armAck 回执（测试的确定性同步点）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonViewHandle } from '../../../../src/shared/addonEditApi'

/** 本组件声明的扩展 ID（装载器按此核对入口身份；宿主夹具 addon-t12 配对） */
const ADDON_ID = 'vsidian-test-fixture.addon-t12'

interface T12Command {
  seq: number
  op: string
  args?: Record<string, unknown>
}

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const views = sdk.views
  const behaviors = sdk.behaviors
  const commands = sdk.commands
  const ui = sdk.ui
  const renderers = sdk.renderers
  if (!views || !behaviors || !commands || !ui || !renderers) {
    throw new Error('editor page SDK must expose views/behaviors/commands/ui/renderers facets (T12)')
  }

  /** 宿主下发的 arm 视图（故障注入选择；null = 无注入） */
  let armView: string | null = null
  const outcomes: Record<string, unknown> = {}
  const handles: Array<() => void> = []
  let stopped = false

  /** 经目标句柄在光标处插入文本（命令与按钮的正常业务——T11 同款） */
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

  /** 贡献注册（许可放行后执行；outcomes 随 t12.register 上报断言） */
  const registerContributions = (): void => {
    // 输入行为：^ → 插 -T12-（arm=behavior 时抛未捕获异常）
    const behavior = behaviors.register({
      id: 'inject-mark',
      name: 'T12 插标',
      description: '输入 ^ 时插入 -T12-（T12 故障注入载体）',
      onInput: (ctx) => {
        if (armView === 'behavior') {
          throw new Error('T12 behavior boom (armed)')
        }
        if (ctx.inputText !== '^') {
          return null
        }
        return { changes: [{ offset: ctx.snapshot.selections[0]?.head ?? 0, length: 0, text: '-T12-' }] }
      },
    })
    outcomes['behavior'] = behavior.ok
      ? { ok: true, key: behavior.key }
      : { ok: false, reason: behavior.reason }

    // 命令：插 T12-CMD（arm=command 时抛未捕获异常）。命令回调无 target
    // 入参（T10 面）——经 views.get 解析当前主正文句柄
    const command = commands.register(
      { id: 'insertStamp', title: 'T12 Stamp', mode: 'live', writes: true },
      () => {
        if (armView === 'command') {
          throw new Error('T12 command boom (armed)')
        }
        const target = views.get('main')
        void insertText('T12-CMD', target).catch(() => {})
      },
    )
    outcomes['command'] = command.ok
      ? { ok: true, commandId: command.commandId }
      : { ok: false, reason: command.reason }
    if (command.ok) handles.push(command.dispose)

    // 按钮：onClick 插 T12-BTN（arm=button 时抛未捕获异常）
    const button = ui.registerButton({ id: 'boomBtn', label: 'T12 Button', iconText: 'T12' }, (target) => {
      if (armView === 'button') {
        throw new Error('T12 button boom (armed)')
      }
      void insertText('T12-BTN', target).catch(() => {})
    })
    outcomes['button'] = button.ok ? { ok: true, id: button.id } : { ok: false, reason: button.reason }
    if (button.ok) handles.push(button.dispose)

    // 渲染器：t12graph（arm=render-mount 抛 / render-self-handled 自处理降级）
    const renderer = renderers.register({
      rendererId: 'graph',
      label: 'T12 Graph',
      languages: ['t12graph'],
      modes: ['live', 'reading'],
      exportFormats: ['svg'],
      mount: (container: HTMLElement, code: string) => {
        if (armView === 'render-mount') {
          throw new Error('T12 render boom (armed)')
        }
        container.textContent = ''
        const box = document.createElement('div')
        box.className = 't12-box'
        if (armView === 'render-self-handled') {
          // 自处理渲染失败：组件捕获自己的异常画降级内容（负向对照——
          // 平台不感知、不停用、内置不接管）
          try {
            throw new Error('T12 self-handled render failure')
          } catch {
            box.textContent = `T12-DEGRADED:${code}`
            container.appendChild(box)
            return
          }
        }
        box.setAttribute('data-t12-code', code)
        box.textContent = `T12-GRAPH-CONTENT:${code}`
        container.appendChild(box)
      },
      exportSvg: async (code: string) => `<svg data-t12="${code}"></svg>`,
    })
    outcomes['renderer'] = { ok: true }
    handles.push(() => renderer.dispose())

    void sdk.channel.request('t12.register', { addonId: ADDON_ID, outcomes })
  }

  /** 页面侧指令（queue/collect 配对） */
  const runOp = async (op: string): Promise<unknown> => {
    switch (op) {
      case 'armView':
        return { armView }
      case 'ping':
        return { pong: true }
      default:
        return { ok: false, reason: `unknown-op:${op}` }
    }
  }

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

  void (async () => {
    // 许可协商（防毒化门控——未放行时零贡献）
    const permission = await sdk.channel.request('t12.contributionsAllowed', null, { timeoutMs: 5000 })
    if (stopped || !permission.ok) {
      return
    }
    const result = permission.result as { allowed?: boolean; arm?: string | null } | null
    armView = result?.arm ?? null
    if (result?.allowed === true) {
      registerContributions()
    }
    void sdk.channel.request('t12.armAck', { arm: armView })
    // 短轮询（T06/T10/T11 同款）：next 应答携带 arm 视图，变更即回执确认
    while (!stopped) {
      const outcome = await sdk.channel.request('t12.next', null, { timeoutMs: 4000 })
      if (!outcome.ok) {
        if (outcome.reason === 'released') {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      const answer = outcome.result as { command: T12Command | null; arm: string | null } | null
      if (!answer) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      if (answer.arm !== armView) {
        armView = answer.arm
        void sdk.channel.request('t12.armAck', { arm: armView })
      }
      if (answer.command) {
        const result = await runOp(answer.command.op)
        void sdk.channel.request('t12.result', { seq: answer.command.seq, outcome: result })
      }
    }
  })()
})
