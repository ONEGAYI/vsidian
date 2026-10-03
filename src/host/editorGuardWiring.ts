// #322 默认编辑器守护——vscode 层装配：配置读写端口（get()/inspect()/
// update Global）、抢占者可读名反查（extensions.all 的 contributes.
// customEditors，失败回退关联值原文）、宿主通知（t() 两语言包，多按钮
// 先例同 textEditorProvider 冲突处理）、被动层 onDidChangeConfiguration
// 订阅（常挂——守护关闭仅由服务停提示）与 _test 注入命令（VSIDIAN_
// TEST_HOOKS 门控，C-11 同判据）。服务纯逻辑在 host/editorGuardService
//（端口注入，单测覆盖）。#323 起暴露 stateFor/fixNow（设置页「默认编辑器」
// 委托组消费，settingsPage 消息分支接线）。
//
// 集成测试宿主的通知短路：VSIDIAN_TEST_HOOKS=1 时抢占提示按「自然超时」
// 语义直接返回 undefined（不记拒绝）、成功/降级通知与 openSettings 引导
// no-op——独立桌面测试宿主无法交互 toast，与 textEditorProvider 的对话框
// 短路（1857 起同判据）同一口径；写回与判定链路保持真实。
import * as vscode from 'vscode'
import {
  BUILTIN_EDITOR_ASSOCIATION_VALUE,
  type DefaultEditorDisplayState,
  type EditorGuardPersisted,
} from '../shared/editorGuard'
import {
  EDITOR_GUARD_STORAGE_KEY,
  EditorGuardService,
  type EditorGuardFixResult,
  type EditorGuardPorts,
  type EditorGuardRuntimeState,
} from './editorGuardService'
import { DEFAULT_EDITOR_GUARD_KEY } from '../shared/settings'
import type { SettingsService } from './settingsService'
import { t } from '../shared/i18n'

export interface EditorGuardWiring {
  service: EditorGuardService
  /** #323 defaultEditor.state 载荷（判定现算，不缓存；设置页状态行数据源） */
  stateFor(): DefaultEditorDisplayState
  /** #323 手动「设为默认」入口（service.fixNow 同一修复链路；设置页按钮
   *  与提示通知按钮、_test 钩子共用） */
  fixNow(): Promise<EditorGuardFixResult>
}

/** 抢占者可读名反查：扫 extensions.all 的 contributes.customEditors 匹配
 *  viewType 取扩展 displayName；查不到返回 undefined（调用方回退原值） */
function findCustomEditorDisplayName(viewType: string): string | undefined {
  for (const extension of vscode.extensions.all) {
    const packageJSON = extension.packageJSON as
      | { displayName?: unknown; contributes?: { customEditors?: unknown } }
      | undefined
    const editors = packageJSON?.contributes?.customEditors
    if (!Array.isArray(editors)) {
      continue
    }
    for (const editor of editors) {
      if ((editor as { viewType?: unknown } | null)?.viewType === viewType) {
        const displayName = packageJSON?.displayName
        return typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined
      }
    }
  }
  return undefined
}

export function createEditorGuardWiring(
  context: vscode.ExtensionContext,
  settingsService: SettingsService,
): EditorGuardWiring {
  // 集成测试宿主通知短路（见文件头注释；判据与 provider 对话框短路一致）
  const testHooks = process.env.VSIDIAN_TEST_HOOKS === '1'
  const workbenchConfig = () => vscode.workspace.getConfiguration('workbench')

  const ports: EditorGuardPorts = {
    readPersisted: () => context.globalState.get(EDITOR_GUARD_STORAGE_KEY),
    writePersisted: (value: EditorGuardPersisted) =>
      context.globalState.update(EDITOR_GUARD_STORAGE_KEY, value),
    getExtensionVersion: () => String(
      (context.extension.packageJSON as { version?: unknown }).version ?? ''),
    getAssociations: () => workbenchConfig().get('editorAssociations'),
    getGlobalAssociations: () =>
      workbenchConfig().inspect('editorAssociations')?.globalValue,
    updateGlobalAssociations: (value) =>
      workbenchConfig().update('editorAssociations', value, vscode.ConfigurationTarget.Global),
    isGuardEnabled: () => settingsService.getSnapshot()[DEFAULT_EDITOR_GUARD_KEY] === true,
    resolveTakerLabel: (viewType) => {
      // 值 "default"（内置文本编辑器）无扩展可反查，特判可读名
      if (viewType === BUILTIN_EDITOR_ASSOCIATION_VALUE) {
        return t('host.defaultEditorBuiltinName')
      }
      return findCustomEditorDisplayName(viewType) ?? viewType
    },
    async showTakeoverPrompt(label) {
      if (testHooks) {
        return undefined
      }
      const fixLabel = t('host.defaultEditorFixLabel')
      const dismissLabel = t('host.defaultEditorDismissLabel')
      const pick = await vscode.window.showInformationMessage(
        t('host.defaultEditorTakenOver', { name: label }),
        fixLabel,
        dismissLabel,
      )
      return pick === fixLabel ? 'fix' : pick === dismissLabel ? 'dismiss' : undefined
    },
    showFixedNotice: () => {
      if (testHooks) {
        return
      }
      void vscode.window.showInformationMessage(t('host.defaultEditorFixed'))
    },
    showFixFailedGuidance: () => {
      if (testHooks) {
        return
      }
      void vscode.window.showWarningMessage(t('host.defaultEditorFixFailed'))
      // 降级引导：定位到该设置键，让用户手动处理（规格修复路径第 3 步）
      void vscode.commands.executeCommand('workbench.action.openSettings', 'workbench.editorAssociations')
    },
  }
  const service = new EditorGuardService(ports)

  /** #323 defaultEditor.state 载荷（判定现算） */
  const stateFor = (): DefaultEditorDisplayState => service.getDisplayState()

  // 被动层常挂（守护关闭仅由服务停提示，监听不拆）；事件回调不 await
  //（沿检测与提示是后台链路）
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbench.editorAssociations')) {
        void service.handleAssociationsChanged()
      }
    }),
  )
  // 主动层：激活即检测（服务内含约 1.5s toast 延迟，不阻塞激活）
  void service.runStartupCheck()

  // ---- 测试钩子命令：仅集成测试经 runTest.mjs 注入 VSIDIAN_TEST_HOOKS=1
  // 时注册（C-11 判据与 textEditorProvider 门控块一致），生产 VSIX 与常规
  // F5 开发不暴露。守护 globalState（版本锁/拒绝记录）与设置同层，集成
  // runner 每用例前经 resetEditorGuardState 重置（suite/index.ts 重置面），
  // 否则「首装检测」自第二个用例起被前序写锁污染 ----
  if (testHooks) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.getEditorGuardState',
        (): EditorGuardRuntimeState => service.getState(),
      ),
      // #323 设置页状态行载荷观测（四形态判定的集成断言面）：与生产
      // defaultEditor.state 消息同源（stateFor 现算）
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.getDefaultEditorState',
        (): DefaultEditorDisplayState => stateFor(),
      ),
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.resetEditorGuardState',
        () => service.reset(),
      ),
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.runEditorGuardStartupCheck',
        () => service.runStartupCheck(),
      ),
      // 写回路径集成验证入口（真实 update Global + 复查闭环；通知已短路）
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.fixDefaultEditor',
        () => service.fixNow(),
      ),
    )
  }

  return {
    service,
    stateFor,
    fixNow: () => service.fixNow(),
  }
}
