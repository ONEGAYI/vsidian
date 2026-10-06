// 全文件清单的常用资源分类（工单 #377 T02，ADR-0013）：空查询资格按
// 路径后缀**零 IO** 派生——不为判定打开/读取任何文件；未知/编译类型
// （.pyc、.so、.exe…）与无扩展名/点号起头文件名显式落 other（仅记名、
// mtime 未知沉底），不进空查询但可被有查询命中。
//
// 分类声明的复用口径（规格「常用资源分类复用现有资源及文本语言分类的
// 声明和后缀，集中维护」）：
// - image：与图片管线扩展清单同源（IMAGE_WATCH_GLOB_SEGMENTS——一处
//   声明多处生效，不建第二份图片扩展表）；
// - text：集中后缀清单 = 通用文本/配置后缀 + 代码语言注册表的 id 与别名
//   （CODE_LANGUAGES / PLAIN_TEXT_LANGUAGE——文本语言分类的既有声明）；
// - audio/video：本模块新声明的集中清单（仓库此前无音视频扩展声明）；
// - markdown/pdf：单扩展名直判。
//
// 本模块不依赖 vscode / DOM / node 专属 API（node 单测直驱；宿主与
// webview 双产物共用）。
import { IMAGE_WATCH_GLOB_SEGMENTS } from './imageRefresh'
import { CODE_LANGUAGES, PLAIN_TEXT_LANGUAGE } from './codeLangs'

/** 文件分类（类型提示；other = 仅记名的未知/编译类型） */
export type VaultFileCategory = 'markdown' | 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'other'

/** 快照码表（vaultFileCatalog 序列化共用；顺序即分类稳定编号 */
export const VAULT_FILE_CATEGORY_CODE: readonly VaultFileCategory[] = [
  'markdown', 'image', 'pdf', 'audio', 'video', 'text', 'other',
]

/** 音频扩展（小写；集中声明——仓库此前无音视频清单） */
export const AUDIO_FILE_EXTENSIONS: readonly string[] = [
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'aiff',
]

/** 视频扩展（小写；集中声明——webm 按视频归类） */
export const VIDEO_FILE_EXTENSIONS: readonly string[] = [
  'mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'm4v', 'mpg', 'mpeg', 'flv',
]

/** 通用文本/配置后缀（代码语言注册表之外的基础清单） */
const GENERIC_TEXT_EXTENSIONS: readonly string[] = [
  'txt', 'csv', 'log', 'toml', 'ini', 'xml', 'rst', 'adoc',
]

/** 可读文本扩展集合：通用清单 ∪ 代码语言注册表 id/别名（现有声明同源） */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...GENERIC_TEXT_EXTENSIONS,
  ...PLAIN_TEXT_LANGUAGE.aliases, // plaintext、txt
  ...CODE_LANGUAGES.flatMap((lang) => [lang.id, ...lang.aliases]),
])

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(IMAGE_WATCH_GLOB_SEGMENTS)
const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(AUDIO_FILE_EXTENSIONS)
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(VIDEO_FILE_EXTENSIONS)

/** basename 的扩展名段（小写）；无有效扩展名（含点号起头 .gitignore 类——
 *  lastIndexOf('.') 为 0 不是分隔）返回 null */
function extensionOf(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) {
    return null // 无扩展名或 .gitignore 形态（dot===0）
  }
  return base.slice(dot + 1).toLowerCase()
}

/**
 * 按路径派生文件分类（零 IO）：取 basename 扩展名（大小写不敏感），
 * 依次判 markdown → image → pdf → audio → video → text，未命中落 other。
 */
export function classifyVaultFileCategory(path: string): VaultFileCategory {
  const ext = extensionOf(path)
  if (ext === null) {
    return 'other'
  }
  if (ext === 'md') {
    return 'markdown'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return 'audio'
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return 'video'
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text'
  }
  return 'other'
}

/** 空查询资格：常用资源（markdown/图片/PDF/音视频/可读文本）为 true，
 *  other（未知/编译类型——仅记名）为 false */
export function isCommonVaultFileCategory(category: VaultFileCategory): boolean {
  return category !== 'other'
}
