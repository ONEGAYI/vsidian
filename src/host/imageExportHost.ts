// 宿主侧图片导出执行壳（工单 #212，规格 docs/specs/image-popup.md）：
// 载荷校验 → classifyImageTarget 定位工作区文件 → 读字节 → 另存为对话框
// → 落盘 → 回报。字节级拷贝、保持原格式（不经 canvas 光栅化，与图表导出
// 的序列化产物语义相区分）；失败弹宿主错误通知（i18n）。纯逻辑（文件名
// 清洗、载荷校验、保存过滤器）与 vscode API 解耦，node 单测直驱；执行壳
// 由集成路径覆盖（先例 diagramExportHost / diagramExportValidate 分工）。
import * as vscode from 'vscode'

import { t } from '../shared/i18n'
import { IMAGE_PASTE_LIMITS, type ImageExportFailReason, type ImageExportPayload } from '../shared/protocol'
import { classifyImageTarget, type LinkContext } from './linkTarget'

export interface ImageExportOutcome {
  ok: boolean
  reason?: ImageExportFailReason
}

/** 图片导出载荷上限（单一事实源；fileName 与粘贴 fileNameHint 同限，
 *  上限值直接引用粘贴通道常量，两处不再各写一份） */
export const IMAGE_EXPORT_LIMITS = {
  fileNameMaxChars: IMAGE_PASTE_LIMITS.fileNameHintMaxChars,
  /** 字节数上限（与 diagram.export PNG 档同量级的防御上限） */
  fileMaxBytes: 64 * 1024 * 1024,
} as const

/** 剥离路径成分与控制字符；空/超长回退默认名（保留原扩展名，无扩展名
 *  补 .png——建议名只是对话框预填，用户可任意改名） */
export function sanitizeImageExportFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
  if (cleaned === '' || cleaned === '.') {
    return 'image.png'
  }
  if (cleaned.length > IMAGE_EXPORT_LIMITS.fileNameMaxChars) {
    return 'image.png'
  }
  return cleaned
}

/** 载荷校验：src 非空、fileName 非空且限长（协议层同口径，宿主侧再校验
 *  ——消息可能来自旧 webview 或测试注入） */
export function validateImageExportPayload(payload: ImageExportPayload): boolean {
  return (
    typeof payload.src === 'string' &&
    payload.src.length > 0 &&
    typeof payload.fileName === 'string' &&
    payload.fileName.length > 0 &&
    payload.fileName.length <= IMAGE_EXPORT_LIMITS.fileNameMaxChars
  )
}

/** 图源归一（webview 侧 normalizeImgSrc 的宿主对偶：容错 decode 一次）——
 *  image.request 的 src 即此形态，classifyImageTarget 沿用同一输入口径 */
export function normalizeImageExportSrc(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** 已知图片扩展名 → 保存对话框过滤器；其余扩展名不限定类型（VSCode 自带
 *  All Files 兜底，建议名已带原扩展名——保持原格式的最小干预） */
export function imageExportFilters(fileName: string): Record<string, string[]> {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  const known: Record<string, Record<string, string[]>> = {
    png: { [t('graphic.exportPngFilter')]: ['png'] },
    svg: { [t('graphic.exportSvgFilter')]: ['svg'] },
  }
  return known[ext] ?? {}
}

/**
 * 校验并执行导出。report 恒被调用一次（取消/校验失败/不可寻址/读失败/
 * 写失败/成功）；非取消失败时弹宿主错误通知。字节拷贝保持原格式——
 * webview 侧外链图按钮已禁用，此处 external/blocked 分类按 invalid 回报
 * （防御旧 webview 或异常注入）。
 */
export async function runImageExport(
  payload: ImageExportPayload,
  linkCtx: LinkContext,
  docUriStr: string,
  report: (outcome: ImageExportOutcome) => void,
): Promise<void> {
  const finish = (outcome: ImageExportOutcome): void => {
    if (!outcome.ok && outcome.reason && outcome.reason !== 'cancelled') {
      void vscode.window.showErrorMessage(t('graphic.imageExportFailed'))
    }
    report(outcome)
  }
  if (!validateImageExportPayload(payload)) {
    finish({ ok: false, reason: 'invalid' })
    return
  }
  const target = classifyImageTarget(normalizeImageExportSrc(payload.src), linkCtx)
  if (target.kind !== 'workspace') {
    // 外链/逃逸/空目标：webview 侧已禁用外链按钮，到达即异常载荷
    finish({ ok: false, reason: 'invalid' })
    return
  }
  const source = vscode.Uri.file(target.fsPath)
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(source)
  } catch {
    finish({ ok: false, reason: 'not-found' })
    return
  }
  if ((stat.type & vscode.FileType.File) === 0 || stat.size > IMAGE_EXPORT_LIMITS.fileMaxBytes) {
    finish({ ok: false, reason: 'not-found' })
    return
  }
  let data: Uint8Array
  try {
    data = await vscode.workspace.fs.readFile(source)
  } catch {
    // stat 已成功而字节读取失败（并发删除/权限/IO）——与目标不存在区分，
    // 兑现协议 read-failed 枚举的承诺
    finish({ ok: false, reason: 'read-failed' })
    return
  }
  const fileName = sanitizeImageExportFileName(payload.fileName)
  const docUri = vscode.Uri.parse(docUriStr)
  const dir = documentDirPath(docUri.path)
  const defaultUri =
    dir !== null
      ? vscode.Uri.joinPath(docUri.with({ path: dir }), fileName)
      : vscode.Uri.file(fileName)
  const target2 = await vscode.window.showSaveDialog({
    defaultUri,
    filters: imageExportFilters(fileName),
  })
  if (!target2) {
    finish({ ok: false, reason: 'cancelled' })
    return
  }
  try {
    await vscode.workspace.fs.writeFile(target2, data)
    finish({ ok: true })
  } catch {
    finish({ ok: false, reason: 'writeFailed' })
  }
}

/** 文档 URI path → 所在目录 path（与 diagramExportValidate 同款内核；
 *  另存为默认目录落文档所在处） */
function documentDirPath(docPath: string): string | null {
  const idx = docPath.lastIndexOf('/')
  return idx > 0 ? docPath.slice(0, idx) : null
}
