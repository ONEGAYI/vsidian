// jieba-wasm 按需下载的锁定清单与下载源构造（#239，用户决策钉住：
// 资源经公共 CDN 按需下载不进包体——GitHub Release 可达性差已否决）。
//
// 锁定与校验语义：版本与每个文件的 sha256 在本清单随扩展发布（VSIX 内
// 不含资源本体）；宿主下载后按清单校验，任一不符即失败清理（不留半成品
// 文件）。哈希对锁定版本 2.4.0 的真实 CDN 资产计算（jsdelivr 裸文件与
// npmmirror tarball 解包产物已实测逐字节一致，2026-09-30）。
//
// 下载源三档：jsdelivr（默认，逐文件直下）、npmmirror（tarball 单 URL +
// 解包提取，registry 的 /files/ 镜像对非白名单包 403 故走 tarball）、
// custom（用户自托管目录基址 + 文件名拼接）。custom 基址必须 https。
export const JIEBA_WASM_PACKAGE = 'jieba-wasm'
export const JIEBA_WASM_VERSION = '2.4.0'

export interface JiebaManifestFile {
  /** globalStorage 内的落盘文件名（也是 custom 源的拼接名与 webview 加载名） */
  name: string
  /** npm 包内路径（jsdelivr URL 用）与 tarball 内提取路径（pkg/ 前缀） */
  npmPath: string
  sha256: string
  size: number
}

/** 锁定版本的全部产物（浏览器 web 目标：ESM 入口 + 独立 wasm） */
export const JIEBA_MANIFEST_FILES: readonly JiebaManifestFile[] = [
  {
    name: 'jieba_rs_wasm.js',
    npmPath: 'pkg/web/jieba_rs_wasm.js',
    sha256: '321bf0b304305a3428b6f4cc6a147954b410f0efe9771f5bd063004b2dd6d213',
    size: 13893,
  },
  {
    name: 'jieba_rs_wasm_bg.wasm',
    npmPath: 'pkg/web/jieba_rs_wasm_bg.wasm',
    sha256: 'f285288e12b2fee4966e2f766cb30cc465637d8679af7006269dfa25871adbf5',
    size: 4015140,
  },
]

export const JIEBA_SOURCE_MODES = ['jsdelivr', 'npmmirror', 'custom'] as const
export type JiebaSourceMode = (typeof JIEBA_SOURCE_MODES)[number]

/** npmmirror 的 registry tarball 单 URL（解包提取 pkg/web/* 两文件） */
export function jiebaTarballUrl(mode: JiebaSourceMode): string | null {
  if (mode !== 'npmmirror') return null
  return `https://registry.npmmirror.com/${JIEBA_WASM_PACKAGE}/-/${JIEBA_WASM_PACKAGE}-${JIEBA_WASM_VERSION}.tgz`
}

/** custom 模式基址合法性：https 起头的目录 URL（http 明文拒绝） */
export function isValidCustomJiebaBase(baseUrl: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(baseUrl.trim())
}

export type JiebaDownloadPlan =
  | {
      ok: true
      /** npmmirror：先下 tarball（字节不做整体哈希——各 registry 重打包不
       *  保证逐字节一致），解包提取后按清单文件级 sha256 校验 */
      kind: 'files'
      files: readonly { file: JiebaManifestFile; url: string }[]
    }
  | { ok: true; kind: 'tarball'; tarballUrl: string }
  | { ok: false; reason: 'invalid-custom-url' }

/**
 * 解析下载源 → 下载计划。custom 源 URL 形态 = 基址（去尾斜杠）+ '/' +
 * 文件名（用户自托管目录内含两个同名文件；文案写明该约定）。
 */
export function planJiebaDownload(
  mode: JiebaSourceMode,
  customBaseUrl: string,
): JiebaDownloadPlan {
  if (mode === 'npmmirror') {
    return { ok: true, kind: 'tarball', tarballUrl: jiebaTarballUrl('npmmirror')! }
  }
  let resolveFile: (file: JiebaManifestFile) => string
  if (mode === 'jsdelivr') {
    resolveFile = (file) => `https://cdn.jsdelivr.net/npm/${JIEBA_WASM_PACKAGE}@${JIEBA_WASM_VERSION}/${file.npmPath}`
  } else {
    const base = customBaseUrl.trim()
    if (!isValidCustomJiebaBase(base)) {
      return { ok: false, reason: 'invalid-custom-url' }
    }
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
    resolveFile = (file) => `${trimmed}/${file.name}`
  }
  return {
    ok: true,
    kind: 'files',
    files: JIEBA_MANIFEST_FILES.map((file) => ({ file, url: resolveFile(file) })),
  }
}
