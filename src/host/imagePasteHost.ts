// 宿主图片粘贴执行壳（#161）：目录解析 → 递归建目录 → 文件名策略 →
// 写盘 → 计算插入文本回发。documentSession 的端口注入点在
// textEditorProvider（pasteImage）。失败时弹宿主错误通知（i18n，禁止
// webview 侧 window.alert）；纯逻辑在 imagePastePlan（单测覆盖），本壳由
// 集成路径覆盖（真实落盘断言，#161 集成用例）。
import * as vscode from 'vscode'
import { posix } from 'node:path'

import { t } from '../shared/i18n'
import type { ImagePasteFailReason, ImagePastePayload } from '../shared/protocol'
import {
  IMAGE_PASTE_LINK_FORMAT_DEFAULT,
  IMAGE_PASTE_LINK_FORMAT_KEY,
  IMAGE_PASTE_LINK_FORMAT_MODES,
  IMAGE_PASTE_LOCATION_DEFAULT,
  IMAGE_PASTE_LOCATION_KEY,
  IMAGE_PASTE_LOCATION_MODES,
  IMAGE_PASTE_SUBPATH_DEFAULT,
  IMAGE_PASTE_SUBPATH_KEY,
  type ImagePasteLinkFormatMode,
  type ImagePasteLocationMode,
} from '../shared/settings'
import type { SettingsPayload } from '../shared/settings'
import {
  buildImagePasteInsertText,
  candidateImageFileNames,
  decodeFileNameHint,
  imageExtensionForMime,
  isSyntheticClipboardImageName,
  pastedImageStem,
  relativePosixImagePath,
  resolveImagePasteDir,
  sanitizeImageFileName,
  sanitizeWikilinkImageStem,
} from './imagePastePlan'

/** 重名探测上限：原图名到 -99 仍全部存在即按写盘失败处理（正常用户
 *  粘贴不会耗尽；防御同名风暴） */
const NAME_CANDIDATE_LIMIT = 100

export interface ImagePasteOutcome {
  ok: boolean
  markdown?: string
  reason?: ImagePasteFailReason
}

export interface ImagePasteHostOptions {
  /** 当前生效设置快照（形态已由 SettingsService 清洗；此处仍防御类型） */
  settings: SettingsPayload
  /** 来源文档 URI（目录解析与相对路径基准） */
  docUri: vscode.Uri
  /** 工作区第一文件夹根 URI path；无工作区为 null（URI path 空间） */
  workspaceRootPath: string | null
}

/**
 * 校验并执行图片粘贴落盘。report 恒被调用一次；失败时弹宿主错误/警告
 * 通知（i18n）。设置非法形态回默认值（与快照清洗同口径）。
 */
export async function runImagePaste(
  payload: ImagePastePayload,
  opts: ImagePasteHostOptions,
  report: (outcome: ImagePasteOutcome) => void,
): Promise<void> {
  // 防御：协议层已校验 mime/base64 形态，宿主侧再拦一层（端口注入路径
  // 的异常装配不承诺上游已校验）
  if (!payload.mime.startsWith('image/') || payload.dataBase64.length === 0) {
    report({ ok: false, reason: 'invalid' })
    return
  }
  const rawMode = opts.settings[IMAGE_PASTE_LOCATION_KEY]
  const mode: ImagePasteLocationMode =
    typeof rawMode === 'string' && (IMAGE_PASTE_LOCATION_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as ImagePasteLocationMode)
      : IMAGE_PASTE_LOCATION_DEFAULT
  const rawSubpath = opts.settings[IMAGE_PASTE_SUBPATH_KEY]
  const subpath = typeof rawSubpath === 'string' ? rawSubpath : IMAGE_PASTE_SUBPATH_DEFAULT
  const rawFormat = opts.settings[IMAGE_PASTE_LINK_FORMAT_KEY]
  const format: ImagePasteLinkFormatMode =
    typeof rawFormat === 'string' && (IMAGE_PASTE_LINK_FORMAT_MODES as readonly string[]).includes(rawFormat)
      ? (rawFormat as ImagePasteLinkFormatMode)
      : IMAGE_PASTE_LINK_FORMAT_DEFAULT

  const dir = resolveImagePasteDir({
    mode,
    subpath,
    docPath: opts.docUri.path,
    workspaceRootPath: opts.workspaceRootPath,
  })
  if (!dir.ok) {
    void vscode.window.showErrorMessage(t('host.imagePasteInvalidLocation', { subpath }))
    report({ ok: false, reason: 'invalid-location' })
    return
  }
  if (dir.fellBack) {
    void vscode.window.showWarningMessage(t('host.imagePasteNoWorkspaceFallback'))
  }

  const ext = imageExtensionForMime(payload.mime)
  const hint = payload.fileNameHint
  let stem: string
  if (hint !== undefined && !isSyntheticClipboardImageName(hint)) {
    // 复制文件对象：先解 percent-encode 形态（#163 验收反馈修复——部分
    // 剪贴板来源给编码名），再清洗非法字符沿用基名；扩展名统一按实际
    // 字节（mime）重建——原扩展段剥除（同名异扩展的历史文件不产生误导
    // 性扩展名）
    const cleaned = sanitizeImageFileName(decodeFileNameHint(hint))
    stem = cleaned.replace(/\.[^.]+$/, '')
  } else {
    // 截图（无文件名或 Chromium 合成名）：时间戳名（Obsidian 默认风格）
    stem = pastedImageStem(new Date())
  }
  // 全非法字符清洗为空 / 原名仅剩扩展段 → 回退时间戳（#161 规格）
  if (stem === '') {
    stem = pastedImageStem(new Date())
  }
  // 双链档：stem 追加清洗双链不可表达字符（`[]#^`——`![[…]]` 无法无损
  // 表达，Obsidian 文件名限制同源）；清洗为空同样回退时间戳。直链档不做
  // 此清洗（percent-encode 与 alt 转义已消化，落盘名保持现状行为）。
  if (format === 'wikilink') {
    stem = sanitizeWikilinkImageStem(stem)
    if (stem === '') {
      stem = pastedImageStem(new Date())
    }
  }

  const dirUri = opts.docUri.with({ path: dir.dirPath })
  try {
    // 目录不存在时递归创建（含各级父目录；已存在幂等）
    await vscode.workspace.fs.createDirectory(dirUri)
    // 重名 -1/-2 递增：逐候选探测存在性，取首个不存在的名字
    const candidates = candidateImageFileNames(stem, ext, NAME_CANDIDATE_LIMIT)
    let fileName: string | undefined
    for (const name of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(dirUri, name))
      } catch {
        fileName = name
        break
      }
    }
    if (fileName === undefined) {
      void vscode.window.showErrorMessage(t('host.imagePasteWriteFailed'))
      report({ ok: false, reason: 'write-failed' })
      return
    }
    const target = vscode.Uri.joinPath(dirUri, fileName)
    await vscode.workspace.fs.writeFile(target, Buffer.from(payload.dataBase64, 'base64'))
    const rel = relativePosixImagePath(posix.dirname(opts.docUri.path), dir.dirPath, fileName)
    // 按格式档位组装（wikilink 档路径不可无损表达时回退直链，纯逻辑内判定）
    report({ ok: true, markdown: buildImagePasteInsertText(fileName, rel, format) })
  } catch {
    void vscode.window.showErrorMessage(t('host.imagePasteWriteFailed'))
    report({ ok: false, reason: 'write-failed' })
  }
}
