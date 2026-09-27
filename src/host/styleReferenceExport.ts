// 宿主侧样式契约 JSON 导出壳（#145）：读扩展内 media/style-reference/
// style-reference.json（与 VSIX 分发的机器可读清单同一字节，由
// scripts/genStyleGuide.mjs 生成入库）→ 另存为对话框 → 落盘 → 通知。
// 设置页「样式参考」分页的「导出 JSON」按钮（styleRef.export 消息）与
// 命令面板 onegayi.vsidian.exportStyleReference 共用 runStyleReferenceExport。
// 纯规划逻辑（文件名与默认目录回退链）在 ./styleReferenceExportPlan.ts，
// 单测在 test/unit/styleReferenceExport.test.ts；本壳由编译与集成路径覆盖
// （diagramExportHost 同模式）。默认目录记忆走 context.globalState——
// 下次导出回落上次目录，未导出过时按「Downloads 存在则用，否则家目录」。
import * as vscode from 'vscode'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { t } from '../shared/i18n'
import {
  STYLE_REFERENCE_JSON_RELATIVE,
  resolveStyleReferenceExportDefaultDir,
  styleReferenceExportFileName,
} from './styleReferenceExportPlan'

/**
 * 执行导出。取消不弹提示（VSCode 惯例）；资产缺失与写盘失败弹宿主错误
 * 通知（i18n）；成功弹信息通知（含落盘路径）。
 */
export async function runStyleReferenceExport(context: vscode.ExtensionContext): Promise<void> {
  const version: string = context.extension.packageJSON?.version ?? 'unknown'
  const assetPath = context.asAbsolutePath(STYLE_REFERENCE_JSON_RELATIVE)
  let bytes: Uint8Array
  try {
    bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(assetPath))
  } catch {
    void vscode.window.showErrorMessage(
      t('host.styleRefExportFailed', { reason: t('host.styleRefExportReasonMissingAsset') }),
    )
    return
  }
  const lastDir: string | undefined = context.globalState.get('vsidian.styleRefExport.dir')
  const home = homedir()
  const defaultDir = resolveStyleReferenceExportDefaultDir(
    lastDir,
    home,
    path.join(home, 'Downloads'),
    existsSync(path.join(home, 'Downloads')),
  )
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(defaultDir), styleReferenceExportFileName(version)),
    filters: { JSON: ['json'] },
  })
  if (!target) return
  try {
    await vscode.workspace.fs.writeFile(target, bytes)
    await context.globalState.update('vsidian.styleRefExport.dir', path.dirname(target.fsPath))
    void vscode.window.showInformationMessage(t('host.styleRefExported', { path: target.fsPath }))
  } catch {
    void vscode.window.showErrorMessage(
      t('host.styleRefExportFailed', { reason: t('host.styleRefExportReasonWriteFailed') }),
    )
  }
}
