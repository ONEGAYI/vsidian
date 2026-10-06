// #350 T01 附加组件宿主装配（vscode 层）：注册表 + 发现协调 + 公开
// registerAddon 入口 + 设置页面板接线 + 测试钩子。
//
// 装配职责（ADR-0012 Q25/Q26、设计文档第 2 节）：
// - Vsidian activate() 返回导出 API（apiVersion + registerAddon）——原生
//   激活完成后 VSCode 公布 exports，组件经
//   extensions.getExtension('onegayi.vsidian').exports 访问（同宿主）。
// - 发现协调 start() 在 activate 内 fire-and-forget 启动（先订阅
//   onDidChange 再扫描；不被自身 activate 等待——协调器内部先等自身
//   API 公布）。
// - 注册入口核对当前宿主身份、API 范围、实验兼容与重复接入（实现在
//   addonRegistry 纯逻辑）。
// - 设置页「附加组件」分页：addons.get 拉取 / addons.state 推送；市场
//   搜索与 VSCode 扩展管理入口经宿主命令执行（安装、卸载与整扩展禁用
//   继续由 VSCode 管理——本插件不建内部安装器）。
// - 日常安装态日志写入 VSCode 输出通道（标明组件 ID、阶段与原因）。
import * as vscode from 'vscode'
import {
  ADDON_API_VERSION,
  type AddonRegistrationResult,
  type AddonStatusEntry,
} from '../../shared/addonIdentity'
import { AddonCoordinator, type AddonExtensionLike } from './addonCoordinator'
import { AddonRegistry, createDefaultRegistryPorts, type AddonDefinition } from './addonRegistry'
import { t } from '../../shared/i18n'

/** 本扩展自身 ID（附加组件建议声明对它的原生依赖） */
export const VSIDIAN_EXTENSION_ID = 'onegayi.vsidian'

/** 公开导出 API（T01 轻量形状；apiVersion 1.0.0 为首个候选版本——草案，
 *  未发布，不冒充已发布稳定契约） */
export interface VsidianAddonExports {
  /** 宿主当前提供的稳定 API 版本 */
  readonly apiVersion: string
  /**
   * 附加组件接入注册入口。owner 为调用者的原生 Extension 身份（读取
   * id）；组件尚在自身激活过程中即可调用。同一接入代次重复注册返回
   * already-registered（不重跑 setup）；手动重试先释放旧代次（T02+ 的
   * 重试入口）再注册。
   */
  registerAddon(owner: { id: string }, definition?: AddonDefinition): AddonRegistrationResult
}

/** 设置页面板接线（settingsPage 消息分支消费） */
export interface AddonPageWiring {
  /** addons.state 消息载荷（宿主权威状态现算） */
  getState(): { kind: 'addons.state' } & { apiVersion: string; draft: true; addons: readonly AddonStatusEntry[] }
  /** 市场搜索（关键词仅搜索辅助：vsidian-addon） */
  openSearch(): void
  /** VSCode 扩展管理视图 */
  openExtensionsView(): void
  /** 某组件的 VSCode 扩展详情页 */
  openExtension(extensionId: string): void
}

export interface AddonWiring {
  /** 原生激活完成后经 activate() 返回值公布的导出 API */
  exports: VsidianAddonExports
  /** 设置页面板接线 */
  page: AddonPageWiring
  /** 启动发现协调（activate 内调用；内部 fire-and-forget 不阻塞） */
  start(): void
  /** 状态变化订阅（extension.ts 接 settingsPage.notifyAddonsChanged） */
  onStateChanged(listener: () => void): () => void
  /** 停用收尾（context.subscriptions 驱动） */
  dispose(): void
}

/** 扩展展示名：displayName 缺失或非字符串时回退 Extension.id */
function extensionLabel(packageJSON: unknown, id: string): string {
  const displayName = (packageJSON as { displayName?: unknown } | undefined)?.displayName
  return typeof displayName === 'string' && displayName.length > 0 ? displayName : id
}

export function createAddonWiring(context: vscode.ExtensionContext): AddonWiring {
  const channel = vscode.window.createOutputChannel(t('host.addonsChannelName'))
  const log = (message: string): void => {
    channel.appendLine(`[${new Date().toISOString()}] ${message}`)
  }

  // 注册表：findExtension 核对「当前扩展宿主注册表中的记录」（查不到 =
  // 当前宿主不可用——不等于未安装或装错侧）；兼容参数取默认端口（实验
  // 入口表当前为空——如实反映未发布）
  const registry = new AddonRegistry(
    createDefaultRegistryPorts((id) => vscode.extensions.getExtension(id)),
  )

  const toExtensionLike = (extension: vscode.Extension<unknown>): AddonExtensionLike => ({
    id: extension.id,
    label: extensionLabel(extension.packageJSON, extension.id),
    packageJSON: extension.packageJSON,
    isActive: extension.isActive,
    // 1.82.3 的 Extension.activate 返回 Thenable——统一为 Promise（协调器
    // 内按 ID 合并与异常捕获）
    activate: async () => extension.activate(),
  })

  // 发现协调端口：ensureSelfApiPublished 等自身原生激活完成（activate()
  // 幂等——start() 未被自身 activate 等待，此处 await 不构成互等）
  const selfExtension = vscode.extensions.getExtension(VSIDIAN_EXTENSION_ID)
  const coordinator = new AddonCoordinator(
    {
      selfExtensionId: VSIDIAN_EXTENSION_ID,
      ensureSelfApiPublished: async () => {
        if (selfExtension) {
          await selfExtension.activate()
        }
      },
      getAllExtensions: () => vscode.extensions.all.map(toExtensionLike),
      onExtensionsChanged: (listener) => vscode.extensions.onDidChange(listener),
    },
    registry,
  )

  // 协调状态进入失败态时留日志（组件 ID + 阶段 + 原因）；正常轮换不打扰
  coordinator.onStateChanged(() => {
    for (const entry of coordinator.stateEntries()) {
      if (entry.status === 'activation-failed') {
        log(`addon ${entry.id} activation failed: ${entry.detail ?? 'unknown error'}`)
      }
    }
  })

  const exports: VsidianAddonExports = {
    apiVersion: ADDON_API_VERSION,
    registerAddon: (owner, definition) => {
      const result = registry.register(owner, definition ?? {})
      if (!result.ok) {
        log(`addon ${owner.id} register rejected: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`)
      }
      return result
    },
  }

  const getState = () => ({
    kind: 'addons.state' as const,
    apiVersion: ADDON_API_VERSION,
    draft: true as const,
    addons: [...coordinator.stateEntries()],
  })

  const page: AddonPageWiring = {
    getState,
    openSearch: () => {
      // 关键词仅帮助市场寻找（vsidian-addon）；不代表接入协议或官方身份
      void vscode.commands.executeCommand('workbench.extensions.search', '@keyword:"vsidian-addon"')
    },
    openExtensionsView: () => {
      void vscode.commands.executeCommand('workbench.view.extensions')
    },
    openExtension: (extensionId) => {
      void vscode.commands.executeCommand('extension.open', extensionId)
    },
  }

  // ---- 测试钩子命令：仅集成测试经 runTest.mjs 注入 VSIDIAN_TEST_HOOKS=1
  // 时注册（判据与 textEditorProvider / editorGuardWiring 门控块一致），
  // 生产 VSIX 与常规 F5 开发不暴露 ----
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    context.subscriptions.push(
      vscode.commands.registerCommand('onegayi.vsidian._test.getAddonsState', () => getState()),
      // 清单刷新/重复扫描入口（真宿主验证协调幂等：重复请求不重复注册）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonsRescan', () => coordinator.rescan()),
    )
  }

  context.subscriptions.push(channel)

  return {
    exports,
    page,
    start: () => coordinator.start(),
    onStateChanged: (listener) => coordinator.onStateChanged(listener),
    dispose: () => coordinator.dispose(),
  }
}
