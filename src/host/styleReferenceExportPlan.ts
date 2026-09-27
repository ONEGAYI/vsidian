// 样式契约 JSON 导出的纯规划逻辑（#145）：导出文件名与另存为默认目录的
// 回退链。vscode 壳（对话框/读写/通知）在 ./styleReferenceExport.ts，
// 本模块不依赖 vscode（可单测；diagramExportValidate 同分工模式）。
import path from 'node:path'

/** 契约 JSON 在扩展内的相对路径（生成产物，随 VSIX 分发） */
export const STYLE_REFERENCE_JSON_RELATIVE = path.join('media', 'style-reference', 'style-reference.json')

/** 导出文件名：vsidian-style-reference-<版本>.json */
export function styleReferenceExportFileName(version: string): string {
  return `vsidian-style-reference-${version}.json`
}

/**
 * 另存为对话框的默认目录：上次导出目录 > Downloads（存在时）> 家目录。
 * 纯函数（downloadsExists 由调用方探测注入）。
 */
export function resolveStyleReferenceExportDefaultDir(
  lastDir: string | undefined,
  homeDir: string,
  downloadsDir: string,
  downloadsExists: boolean,
): string {
  if (lastDir && lastDir.length > 0) return lastDir
  if (downloadsExists) return downloadsDir
  return homeDir
}
