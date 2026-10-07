// #351 T02 附加组件页面入口登记校验（宿主侧，纯逻辑；自 V02 验证件
// #349 的 registry 原型收敛）。对应设计 §4.1（docs/design/vsidian-addon-api.md）：
// - 组件只登记安装目录内的相对入口及资源子目录，平台拒绝越出该目录的
//   路径——asWebviewUri 只构造 URL，读取许可由 localResourceRoots 包含性
//   检查决定（三层防线实测见 V02 报告「资源授权方案」）；
// - 本模块是「平台拒绝越界」的宿主侧第一层（词法包含性）；资源服务侧的
//   第二层（localResourceRoots 实际拒绝）与页面装载器的 resourceUri
//   第三层由集成/单元测试钉住。
// - 符号链接逃逸的 realpath 校验属 T05 安装侧实施，不在本票范围。
import path from 'node:path'

/** 组件登记的页面入口（setup 的 settings.registerPage / enable 的
 *  pages.registerEditor 输入）：全部为**安装目录内相对路径** */
export interface AddonPageEntryInput {
  /** 入口脚本相对路径（如 dist/page.js） */
  entry: string
  /** 样式表相对路径列表（如 ['dist/page.css']） */
  css?: readonly string[]
  /** 资源子目录相对路径列表（如 ['dist/assets']；首个作为 resourceUri 基址） */
  resources?: readonly string[]
}

export type AddonPageEntryResolution =
  | {
      ok: true
      entryFsPath: string
      cssFsPaths: string[]
      /** resourceUri 解析锚（无资源子目录时为 null——resourceUri 恒 null） */
      resourceBaseFsPath: string | null
    }
  | { ok: false; reason: 'escape-entry' | 'escape-css' | 'escape-resource'; detail?: string }

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

/** 解析后的 fsPath 是否仍位于基准目录内（规范化后的前缀包含判断）。
 *  #354 T05 起导出：realpath 守卫（addonRealpathGuard）对真实路径复用
 *  同一包含性口径——词法层与真实路径层不各造判断。 */
export function isWithin(baseFsPath: string, candidateFsPath: string): boolean {
  const base = path.resolve(baseFsPath) + path.sep
  const candidate = path.resolve(candidateFsPath)
  return candidate === path.resolve(baseFsPath) || candidate.startsWith(base)
}

/**
 * 校验并解析页面入口登记：入口、每条样式与每个资源子目录都必须词法
 * 包含且规范化后仍位于安装目录内；任一越界即整体拒绝（不留半登记状态）。
 */
export function resolveAddonPageEntry(installDir: string, input: AddonPageEntryInput): AddonPageEntryResolution {
  if (!isContainedRelative(input.entry)) {
    return { ok: false, reason: 'escape-entry', detail: input.entry }
  }
  const entryFsPath = path.resolve(installDir, input.entry)
  if (!isWithin(installDir, entryFsPath)) {
    return { ok: false, reason: 'escape-entry', detail: input.entry }
  }
  const cssFsPaths: string[] = []
  for (const cssPath of input.css ?? []) {
    if (!isContainedRelative(cssPath)) {
      return { ok: false, reason: 'escape-css', detail: cssPath }
    }
    const fsPath = path.resolve(installDir, cssPath)
    if (!isWithin(installDir, fsPath)) {
      return { ok: false, reason: 'escape-css', detail: cssPath }
    }
    cssFsPaths.push(fsPath)
  }
  const resourceFsPaths: string[] = []
  for (const dir of input.resources ?? []) {
    if (!isContainedRelative(dir)) {
      return { ok: false, reason: 'escape-resource', detail: dir }
    }
    const fsPath = path.resolve(installDir, dir)
    if (!isWithin(installDir, fsPath)) {
      return { ok: false, reason: 'escape-resource', detail: dir }
    }
    resourceFsPaths.push(fsPath)
  }
  return {
    ok: true,
    entryFsPath,
    cssFsPaths,
    resourceBaseFsPath: resourceFsPaths[0] ?? null,
  }
}
