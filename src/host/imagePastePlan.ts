// 图片粘贴纯逻辑（#161）：目录解析（三模式/越界拒绝/无工作区回退）、
// 子路径规范化、文件名策略（时间戳/原名清洗/合成名判定/重名序号）、
// 扩展名映射与插入文本编码。全部纯函数、平台无关——路径一律 URI path
// 空间（POSIX 风格字符串，Windows 盘符为 /c:/ 形态），执行壳
// （imagePasteHost.ts）负责 vscode.Uri ↔ fsPath 转换与 I/O。
// 单测在 test/unit/imagePastePlan.test.ts。
import { posix } from 'node:path'
import type { ImagePasteLocationMode } from '../shared/settings'

/** 子路径规范化：统一分隔符、去尾斜杠与冗余段；返回 null = 非法。
 *  非法判定：绝对路径（首部 `/`（POSIX 绝对特征）、Windows 盘符、UNC）
 *  与任何 `..` 段（保守拒绝，不解析其净效应）。空串合法（= 无子路径，
 *  直接用根）。 */
export function normalizeImageSubpath(raw: string): string | null {
  const isUnc = raw.startsWith('\\\\') || raw.startsWith('//')
  const unified = raw.replace(/\\/g, '/').trim()
  if (unified.length === 0) {
    return ''
  }
  // 绝对路径：POSIX 根（首 /，含纯 "/"）、Windows 盘符（转换前后两形态）、UNC
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified) || isUnc) {
    return null
  }
  const segments: string[] = []
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') {
      continue
    }
    if (seg === '..') {
      return null
    }
    segments.push(seg)
  }
  return segments.join('/')
}

/** 目录解析输入（全部 URI path 空间） */
export interface ImagePasteDirInput {
  mode: ImagePasteLocationMode
  /** 子路径原始值（设置项原文，本函数内部规范化） */
  subpath: string
  /** 当前文档 URI path */
  docPath: string
  /** 工作区第一文件夹根 URI path；无工作区为 null */
  workspaceRootPath: string | null
}

export type ImagePasteDirResult =
  | { ok: true; dirPath: string; /** workspace-root 模式无工作区回退同目录时为 true（调用方通知用户） */ fellBack: boolean }
  | { ok: false; reason: 'invalid-subpath' }

function dirnameOf(p: string): string {
  const dir = posix.dirname(p)
  return dir
}

/** 三模式目录解析（#161 规格）：same-dir=文档同目录；workspace-root=
 *  工作区根+子路径（无工作区回退同目录并标记）；relative-to-file=
 *  文档目录+子路径。子路径非法（绝对路径/..）任何模式拒绝。 */
export function resolveImagePasteDir(input: ImagePasteDirInput): ImagePasteDirResult {
  const sub = normalizeImageSubpath(input.subpath)
  if (sub === null) {
    return { ok: false, reason: 'invalid-subpath' }
  }
  const docDir = dirnameOf(input.docPath)
  if (input.mode === 'same-dir') {
    // 同目录模式子路径不生效（设置描述写明，不做模式依赖灰化）
    return { ok: true, dirPath: docDir, fellBack: false }
  }
  if (input.mode === 'relative-to-file') {
    return { ok: true, dirPath: sub ? posix.join(docDir, sub) : docDir, fellBack: false }
  }
  // workspace-root
  if (input.workspaceRootPath === null) {
    return { ok: true, dirPath: docDir, fellBack: true }
  }
  return {
    ok: true,
    dirPath: sub ? posix.join(input.workspaceRootPath, sub) : input.workspaceRootPath,
    fellBack: false,
  }
}

/**
 * 文件名清洗：去除 Windows 非法字符（`<>:"/\|?*`）与控制字符（保留中文
 * 与空格）、去首尾空格与点。清洗后为空（原名全是非法字符）返回空串——
 * 调用方回退时间戳名（#161 规格）。
 */
export function sanitizeImageFileName(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
}

/**
 * Chromium 对无源名剪贴板位图合成的默认文件名（image.png 等）：视为
 * 「截图、无文件名」——不沿用，宿主改用时间戳名。空名同判。
 */
const SYNTHETIC_CLIPBOARD_NAMES = new Set([
  'image.png',
  'image.jpg',
  'image.jpeg',
  'image.gif',
  'image.webp',
  'image.bmp',
])

export function isSyntheticClipboardImageName(name: string): boolean {
  return name.length === 0 || SYNTHETIC_CLIPBOARD_NAMES.has(name.toLowerCase())
}

/** 截图时间戳 stem：`Pasted image YYYYMMDDHHmmss`（Obsidian 默认风格，
 *  本地时间；扩展名由 mime 映射补） */
export function pastedImageStem(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `Pasted image ${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** 重名候选序列：原名 → `-1` → `-2` …（调用方逐个探测存在性，命中不
 *  存在者落盘；上限耗尽由执行壳按写盘失败处理） */
export function candidateImageFileNames(stem: string, ext: string, count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(i === 0 ? `${stem}${ext}` : `${stem}-${i}${ext}`)
  }
  return out
}

/** mime → 扩展名（#161 规格）：五种常见 mime 固定映射；其余 image/* 按
 *  subtype 清洗非字母数字字符兜底；不可用回退 .png */
export function imageExtensionForMime(mime: string): string {
  const fixed: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
  }
  const hit = fixed[mime.toLowerCase()]
  if (hit) {
    return hit
  }
  const subtype = mime.slice(mime.indexOf('/') + 1).replace(/[^a-zA-Z0-9-]/g, '')
  return subtype.length > 0 ? `.${subtype}` : '.png'
}

/**
 * 插入文本的单段 percent-encode：空格、非 ASCII 与 `!'()*#()<>` 等特殊
 * 字符编码（encodeURIComponent 不转 `!'()*`，此处补齐），安全字符
 * （字母数字 `~._-`）保留。与渲染端 imageResource 的 normalizeImgSrc
 * （decodeURIComponent 容错）互为对偶——合法编码必可无损解码。
 */
export function encodeImagePathComponent(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

/** Windows 盘符段大小写不敏感：统一小写消除 URI path 来源差异——宿主的
 *  workspace folder URI 与文档 URI 盘符大小写不保证一致（实测一为 /C:/、
 *  一为 /c:/），posix.relative 按字面比较会把同盘路径判为无公共前缀，
 *  产出逐级向上的逃逸相对路径 */
function normalizeDriveCase(p: string): string {
  return p.replace(/^(\/?)([A-Za-z]):(\/)/, (_full, slash: string, drive: string, sep: string) =>
    `${slash}${drive.toLowerCase()}${sep}`)
}

/** 从文档目录到目标文件的相对路径（POSIX 分隔符；目标在上级时自然产生
 *  `../` 前缀——CommonMark 链接目标允许，渲染端同路径解析） */
export function relativePosixImagePath(docDirPath: string, targetDirPath: string, fileName: string): string {
  return posix.relative(
    normalizeDriveCase(docDirPath),
    normalizeDriveCase(posix.join(targetDirPath, fileName)),
  )
}

/** alt 文本转义：`[` `]` 会使 markdown 语法歧义，反斜杠转义保字面 */
function escapeAltText(stem: string): string {
  return stem.replace(/([\[\]])/g, '\\$1')
}

/** 组装插入文本：`![stem](percent-encode 相对路径)`——stem 取文件名去
 *  扩展名（#161 规格） */
export function buildImageInsertMarkdown(fileName: string, relativePath: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const encoded = relativePath.split('/').map(encodeImagePathComponent).join('/')
  return `![${escapeAltText(stem)}](${encoded})`
}
