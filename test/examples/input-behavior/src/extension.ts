// #364 T15 输入样例——宿主入口（独立扩展的 extension.ts）。
//
// 消费面（全部经公开路径，不引用 Vsidian 内部代码）：
// - 清单声明 vsidianAddon（package.json）+ extensionDependencies；
// - registerAddon 两段生命周期：setup 注册设置定义与设置通信（普通停用
//   后仍可配置），enable 注册编辑器页入口与运行通道；
// - 页面产物 dist/editor.js（src/page-editor.ts 经 SDK 构建桥打成 IIFE）。
//
// 行为放行门控（默认值语义）：真实安装默认放行——页面装载即注册行为，
// 安装后自动生效；共享测试宿主（VSIDIAN_TEST_HOOKS=1 的集成会话）默认
// 惰性（行为链修饰全部真实键入，不门控会毒化整仓输入用例），经观测命令
// armBehaviors/disarmBehaviors 按需开启。门控本身走公开通道（页面装载时
// 经 input.allowed 询问）——与 test/fixtures/addon-v02 的 T09 夹具同模式。
import * as vscode from 'vscode'
import type {
  AddonDefinition,
  AddonSettingsContextApi,
} from '../../../../src/host/addons/addonRegistry'
import type { VsidianHostExports } from './host-api'
import { pickMessages, type ExampleMessages } from './i18n'

const SELF_ID = 'vsidian-example.input-behavior'
const HOST_ID = 'onegayi.vsidian'

/** 真实安装默认放行；测试宿主默认惰性（防共享会话毒化，见文件头注） */
const ARM_BY_DEFAULT = process.env.VSIDIAN_TEST_HOOKS !== '1'

interface InputStats {
  activateCount: number
  setupCount: number
  enableCount: number
  disposeCount: number
  eventCalls: number
  lastRegisterResult: { ok: boolean; reason?: string } | null
}

const stats: InputStats = {
  activateCount: 0,
  setupCount: 0,
  enableCount: 0,
  disposeCount: 0,
  eventCalls: 0,
  lastRegisterResult: null,
}

/** 页面上报的事件收件箱（collect 取走；集成/调试断言面） */
const events: Array<Record<string, unknown>> = []
let behaviorsAllowed = ARM_BY_DEFAULT
let settingsApi: AddonSettingsContextApi | null = null
let releaseHandle: { dispose?(): void } | null = null
let hostApi: VsidianHostExports | null = null

function buildDefinition(m: ExampleMessages): AddonDefinition {
  return {
    setup(setupCtx) {
      stats.setupCount++
      settingsApi = setupCtx.settings
      // 设置定义（T04 面）：可序列化、进 Vsidian 设置页基础设置区——
      // 组件自身的业务参数开关（与平台的逐项行为开关并存，粒度不同）
      setupCtx.settings.registerDefinitions([
        { key: 'smartSpace', title: m.settingSmartSpace, type: 'boolean', default: true },
        { key: 'smartParen', title: m.settingSmartParen, type: 'boolean', default: true },
        { key: 'fullwidthPunct', title: m.settingFullwidthPunct, type: 'boolean', default: true },
      ])
      // 设置通信（setup scope——普通停用后仍服务；页面与自身设置页共用）
      setupCtx.channel.handle('input.getSettings', () => settingsApi?.get() ?? null)
    },
    enable(enableCtx) {
      stats.enableCount++
      enableCtx.pages.registerEditor({ entry: 'dist/editor.js' })
      enableCtx.channel.handle('input.allowed', () => ({ allowed: behaviorsAllowed }))
      enableCtx.channel.handle('input.event', (payload) => {
        stats.eventCalls++
        events.push(payload as Record<string, unknown>)
        if (events.length > 128) {
          events.shift()
        }
        return 'ok'
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
  registerSelf(buildDefinition(m))
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SELF_ID}.stats`, () => ({
      ...stats,
      behaviorsAllowed,
      eventsDepth: events.length,
    })),
    vscode.commands.registerCommand(`${SELF_ID}.armBehaviors`, () => {
      behaviorsAllowed = true
      return { ok: true, allowed: behaviorsAllowed }
    }),
    vscode.commands.registerCommand(`${SELF_ID}.disarmBehaviors`, () => {
      behaviorsAllowed = false
      return { ok: true, allowed: behaviorsAllowed }
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

function deactivate(): void {}

// VSCode 扩展宿主契约：activate/deactivate 经 module.exports 公布。不用
// ESM export——esbuild CJS bundle 会把无 bundle 内消费者的入口导出消除为
// 死代码（0&&module.exports=...），显式赋值是可靠保留形态。
module.exports = { activate, deactivate }
