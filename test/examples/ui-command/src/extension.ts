// #364 T15 界面样例——宿主入口（独立扩展的 extension.ts）。
//
// 消费面（全部经公开路径）：
// - setup（T04/T05 复杂设置）：五条设置定义覆盖三形态（enum 标量 /
//   boolean / 对象字段表 / 字符串数组）+ registerPage 登记自己的设置页
//   （dist/settings.js——普通停用后仍可配置）+ 设置通信通道（设置页与
//   编辑器页共用读取，写入经公开 settings.update 按批校验）；
// - enable（T10/T11）：编辑器页入口（dist/editor.js——命令/菜单/按钮/
//   面板注册在页面侧）+ 运行通道（放行门控、事件收件箱、故障注入）。
//
// 故障注入通道（ui.echo）与 releaseAndReRegister 的语义同渲染样例：
// 可归因通道异常 → 全组件故障暂停（贡献回收、偏好保留）；手动重试 =
// 宿主 retry（释放旧代次）+ 组件侧重新接入。
import * as vscode from 'vscode'
import type {
  AddonDefinition,
  AddonSettingsContextApi,
} from '../../../../src/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'
import { pickMessages, type ExampleMessages } from './i18n'

const SELF_ID = 'vsidian-example.ui-command'
const HOST_ID = 'onegayi.vsidian'

/** 真实安装默认放行（命令/菜单/按钮/面板装载即注册）；测试宿主默认惰性
 *  （防共享会话毒化——命令目录与右键菜单断言面会被样例贡献扰动） */
const ARM_BY_DEFAULT = process.env.VSIDIAN_TEST_HOOKS !== '1'

interface UiStats {
  activateCount: number
  setupCount: number
  enableCount: number
  disposeCount: number
  eventCalls: number
  echoCalls: number
  settingsReadCalls: number
  settingsWriteCalls: number
  settingsMountedReports: number
  lastRegisterResult: { ok: boolean; reason?: string } | null
}

const stats: UiStats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  eventCalls: 0,
  echoCalls: 0,
  settingsReadCalls: 0,
  settingsWriteCalls: 0,
  settingsMountedReports: 0,
  lastRegisterResult: null,
}

const events: Array<Record<string, unknown>> = []
let uiAllowed = ARM_BY_DEFAULT
let armCrash = false
let settingsApi: AddonSettingsContextApi | null = null
let releaseHandle: { dispose?(): void } | null = null
let hostApi: VsidianHostExports | null = null

function buildDefinition(m: ExampleMessages): AddonDefinition {
  return {
    setup(setupCtx) {
      stats.setupCount++
      settingsApi = setupCtx.settings
      // 复杂设置（T04 三形态全覆盖）：
      // - enum 标量 + boolean（标量层）；
      // - panel 对象（字段表一层：两个标量字段）；
      // - summarizeIgnore 数组（重复项一层：字符串项）。
      // 分层语义（T05）：工作区显式 > 用户默认显式 > 出厂默认；两层读写
      // 经公开 update(scope, patch) / clearWorkspaceOverride(key)。
      setupCtx.settings.registerDefinitions([
        { key: 'timestampFormat', title: m.settingTimestampFormat, type: 'string', enum: ['iso', 'date', 'time'], default: 'iso' },
        { key: 'autoOpenPanel', title: m.settingAutoOpenPanel, type: 'boolean', default: false },
        {
          key: 'panel', title: m.settingPanel, type: 'object',
          fields: [
            { key: 'title', title: m.settingPanelTitle, kind: 'string', maxLength: 30, default: m.panelDocStats },
            { key: 'showLines', title: m.settingPanelShowLines, kind: 'boolean', default: true },
          ],
        },
        { key: 'summarizeIgnore', title: m.settingSummarizeIgnore, type: 'array', items: { kind: 'string', maxLength: 10 }, default: [] },
      ])
      // 自己的设置页（T02 面）：设置页面板装载本页产物，控件经通道读写
      setupCtx.settings.registerPage({ entry: 'dist/settings.js', css: ['dist/settings.css'] })
      setupCtx.channel.handle('ui.settingsRead', () => {
        stats.settingsReadCalls++
        return settingsApi?.get() ?? null
      })
      setupCtx.channel.handle('ui.settingsWrite', (payload) => {
        stats.settingsWriteCalls++
        const input = payload as { scope?: 'user' | 'workspace'; values?: Record<string, unknown> }
        if (input.scope !== 'user' && input.scope !== 'workspace') {
          return { ok: false, reason: 'invalid-scope' }
        }
        return settingsApi?.update(input.scope, input.values ?? {}) ?? { ok: false, reason: 'settings-unavailable' }
      })
      setupCtx.channel.handle('ui.settingsMounted', () => {
        stats.settingsMountedReports++
        return 'ok'
      })
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
        css: ['dist/editor.css'],
      })
      enableCtx.channel.handle('ui.allowed', () => ({ allowed: uiAllowed }))
      enableCtx.channel.handle('ui.event', (payload) => {
        stats.eventCalls++
        events.push(payload as Record<string, unknown>)
        if (events.length > 128) {
          events.shift()
        }
        return 'ok'
      })
      enableCtx.channel.handle('ui.echo', () => {
        stats.echoCalls++
        if (armCrash) {
          armCrash = false
          throw new Error('ui example: injected echo crash')
        }
        return { ok: true, echoCalls: stats.echoCalls }
      })
      enableCtx.onDispose(() => {
        stats.disposeCount++
      })
    },
  }
}

function registerSelf(definition: AddonDefinition): { ok: boolean; reason?: string } {
  if (!hostApi) {
    throw new Error(`${SELF_ID}: host API not resolved yet`)
  }
  const result = hostApi.registerAddon({ id: SELF_ID }, definition)
  stats.lastRegisterResult = { ok: result.ok, ...(result.ok ? {} : { reason: (result as { reason?: string }).reason }) }
  if (result.ok) {
    releaseHandle = result
  }
  return stats.lastRegisterResult
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  stats.activateCount++
  const m = pickMessages(vscode.env.language)
  const ext = vscode.extensions.getExtension(HOST_ID)
  if (!ext) {
    throw new Error(m.noHost)
  }
  hostApi = (await ext.activate()) as unknown as VsidianHostExports
  const definition = buildDefinition(m)
  registerSelf(definition)
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      uiAllowed,
      armCrash,
      eventsDepth: events.length,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.armUi`, () => {
      uiAllowed = true
      return { ok: true, allowed: uiAllowed }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.disarmUi`, () => {
      uiAllowed = false
      return { ok: true, allowed: uiAllowed }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.armCrash`, () => {
      armCrash = true
      return { ok: true }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.releaseAndReRegister`, () => {
      if (!hostApi) {
        return { ok: false, reason: 'host-api-missing' }
      }
      releaseHandle?.dispose?.()
      releaseHandle = null
      return registerSelf(definition)
    }),
    vscode.commands.registerCommand(`${SELF_ID}.collect`, async (timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs
      while (events.length === 0) {
        if (Date.now() > deadline) {
          return []
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return events.splice(0)
    }),
    vscode.commands.registerCommand(`${SELF_ID}.reset`, () => {
      events.length = 0
      return true
    }),
    {
      dispose() {
        releaseHandle?.dispose?.()
        releaseHandle = null
      },
    },
  )
}

export function deactivate(): void {}
