// #364 T15 渲染样例——宿主入口（独立扩展的 extension.ts）。
//
// 消费面（全部经公开路径）：清单声明 + registerAddon 两段生命周期。
// - setup：设置定义（渲染样式参数）与设置通信（普通停用后仍可配置）；
// - enable：编辑器页入口 + 运行通道（放行门控、故障注入、事件收件箱）。
//
// 故障注入通道（renderer.echo）：armCrash 后下一次调用抛错——可归因通道
// 回调异常触发全组件故障暂停（T12 面：候选不可用 → 内置接管，设置页
// 呈现原因并提供手动重试）。手动重试路径的组件侧配合：releaseAndReRegister
// （dispose 旧句柄 + 同一 definition 再注册——1.82.3 激活失败过的
// activate() 假成功，重试不走自动路径）。
import * as vscode from 'vscode'
import type {
  AddonDefinition,
  AddonSettingsContextApi,
} from '../../../../src/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'
import { pickMessages, type ExampleMessages } from './i18n'

const SELF_ID = 'vsidian-example.renderer'
const HOST_ID = 'onegayi.vsidian'

/** 真实安装默认放行（安装后自动接管所支持语言的显示——票面验收路径）；
 *  测试宿主默认惰性：接管内置 mermaid 会毒化共享会话的其他用例 */
const ARM_BY_DEFAULT = process.env.VSIDIAN_TEST_HOOKS !== '1'

interface RendererStats {
  activateCount: number
  setupCount: number
  enableCount: number
  disposeCount: number
  echoCalls: number
  eventCalls: number
  lastRegisterResult: { ok: boolean; reason?: string } | null
}

const stats: RendererStats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  echoCalls: 0,
  eventCalls: 0,
  lastRegisterResult: null,
}

const events: Array<Record<string, unknown>> = []
let providersAllowed = ARM_BY_DEFAULT
let armCrash = false
let settingsApi: AddonSettingsContextApi | null = null
let releaseHandle: { dispose?(): void } | null = null
let hostApi: VsidianHostExports | null = null

function buildDefinition(m: ExampleMessages): AddonDefinition {
  return {
    setup(setupCtx) {
      stats.setupCount++
      settingsApi = setupCtx.settings
      setupCtx.settings.registerDefinitions([
        { key: 'theme', title: m.settingTheme, type: 'string', enum: ['plain', 'boxed'], default: 'boxed' },
        { key: 'showSource', title: m.settingShowSource, type: 'boolean', default: true },
      ])
      setupCtx.channel.handle('renderer.getSettings', () => settingsApi?.get() ?? null)
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({
        entry: 'dist/editor.js',
        css: ['dist/editor.css'],
      })
      enableCtx.channel.handle('renderer.allowed', () => ({ allowed: providersAllowed }))
      enableCtx.channel.handle('renderer.event', (payload) => {
        stats.eventCalls++
        events.push(payload as Record<string, unknown>)
        if (events.length > 64) {
          events.shift()
        }
        return 'ok'
      })
      // 故障注入通道（armCrash 后下一次抛错——可归因异常 → 全组件暂停）
      enableCtx.channel.handle('renderer.echo', () => {
        stats.echoCalls++
        if (armCrash) {
          armCrash = false
          throw new Error('renderer example: injected echo crash')
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

async function activate(context: vscode.ExtensionContext): Promise<void> {
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
      providersAllowed,
      armCrash,
      eventsDepth: events.length,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.armProviders`, () => {
      providersAllowed = true
      return { ok: true, allowed: providersAllowed }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.disarmProviders`, () => {
      providersAllowed = false
      return { ok: true, allowed: providersAllowed }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.armCrash`, () => {
      armCrash = true
      return { ok: true }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.releaseAndReRegister`, () => {
      // 手动重试的组件侧配合（T01 实证约束：重试不走自动路径）
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
    {
      dispose() {
        releaseHandle?.dispose?.()
        releaseHandle = null
      },
    },
  )
}

function deactivate(): void {}

// VSCode 扩展宿主契约：activate/deactivate 经 module.exports 公布。不用
// ESM export——esbuild CJS bundle 会把无 bundle 内消费者的入口导出消除为
// 死代码（0&&module.exports=...），显式赋值是可靠保留形态。
module.exports = { activate, deactivate }
