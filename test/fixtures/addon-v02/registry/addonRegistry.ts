// V02 验证票（#349）：宿主侧附加组件登记与路径包含性校验**原型**（纯逻辑）。
// 对应设计约束（docs/design/vsidian-addon-api.md §4.1）：
// - 组件只登记安装目录内的相对入口及资源子目录，平台拒绝越出该目录的
//   路径——asWebviewUri 只构造 URL，读取许可由 localResourceRoots 包含性
//   检查决定（vscode-addon-discovery.md 源码核查）；
// - 本模块是「平台拒绝越界」的宿主侧第一层（词法包含性）；浏览器/资源
//   服务侧的第二层（localResourceRoots 实际拒绝）由集成探针对照验证。
//   符号链接逃逸的 realpath 校验属 T05 安装侧实施，不在本票范围。
import path from 'node:path'

/** 组件登记输入：入口与资源子目录都是**安装目录内的相对路径** */
export interface AddonRegistrationInput {
  id: string
  /** 组件安装目录（VSCode 扩展安装目录下的组件根） */
  installDir: string
  /** 入口脚本相对路径（如 dist/page.js） */
  entry: string
  /** 资源子目录相对路径列表（如 ['dist/assets']） */
  resourceDirs?: string[]
}

export type AddonEntryResolution =
  | { ok: true; entryFsPath: string; resourceDirFsPaths: string[] }
  | { ok: false; reason: 'invalid-id' | 'escape-entry' | 'escape-resource'; detail?: string }

/** 相对路径词法包含性：非空、非绝对、不含 .. 段、不含协议形态 */
function isContainedRelative(input: string): boolean {
  if (typeof input !== 'string' || input === '' || input.startsWith('/') || input.startsWith('\\')) {
    return false
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
    return false
  }
  const segments = input.split(/[\\/]/)
  return !segments.includes('..')
}

/** 解析后的 fsPath 是否仍位于基准目录内（大小写不敏感平台由 path 自身
 *  语义决定；本函数做规范化后的前缀包含判断） */
function isWithin(baseFsPath: string, candidateFsPath: string): boolean {
  const base = path.resolve(baseFsPath) + path.sep
  const candidate = path.resolve(candidateFsPath)
  return candidate === path.resolve(baseFsPath) || candidate.startsWith(base)
}

/** 校验并解析组件登记：入口与每个资源子目录都必须词法包含且规范化后
 *  仍位于安装目录内；任一越界即整体拒绝（不留半登记状态） */
export function resolveAddonRegistration(input: AddonRegistrationInput): AddonEntryResolution {
  if (typeof input.id !== 'string' || input.id === '' || !/^[^\s]+$/.test(input.id)) {
    return { ok: false, reason: 'invalid-id', detail: String(input.id) }
  }
  if (!isContainedRelative(input.entry)) {
    return { ok: false, reason: 'escape-entry', detail: input.entry }
  }
  const entryFsPath = path.resolve(input.installDir, input.entry)
  if (!isWithin(input.installDir, entryFsPath)) {
    return { ok: false, reason: 'escape-entry', detail: input.entry }
  }
  const resourceDirFsPaths: string[] = []
  for (const dir of input.resourceDirs ?? []) {
    if (!isContainedRelative(dir)) {
      return { ok: false, reason: 'escape-resource', detail: dir }
    }
    const dirFsPath = path.resolve(input.installDir, dir)
    if (!isWithin(input.installDir, dirFsPath)) {
      return { ok: false, reason: 'escape-resource', detail: dir }
    }
    resourceDirFsPaths.push(dirFsPath)
  }
  return { ok: true, entryFsPath, resourceDirFsPaths }
}

/** 资源路径校验：组件代码请求的相对资源必须落在某个已登记资源子目录内
 *  （sdk.resourceUri 的宿主侧同构；页面侧装载器另有词法防线） */
export function resolveAddonResource(
  input: AddonRegistrationInput,
  relativeResource: string,
): { ok: true; fsPath: string } | { ok: false; reason: 'escape-resource'; detail?: string } {
  if (!isContainedRelative(relativeResource)) {
    return { ok: false, reason: 'escape-resource', detail: relativeResource }
  }
  const resolution = resolveAddonRegistration(input)
  if (!resolution.ok) {
    return { ok: false, reason: 'escape-resource', detail: relativeResource }
  }
  const fsPath = path.resolve(input.installDir, relativeResource)
  for (const dir of resolution.resourceDirFsPaths) {
    if (isWithin(dir, fsPath)) {
      return { ok: true, fsPath }
    }
  }
  return { ok: false, reason: 'escape-resource', detail: relativeResource }
}
