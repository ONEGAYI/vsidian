// #556 T3 R8 探针结论接线：绝对路径资源目标的 webview 许可面推导（纯逻辑）。
//
// 探针证据（worktree notes/t3-csp-probe/evidence.json，1.82.3 win32 真宿主）：
// - webview 资源服务对每个请求做 localResourceRoots 包含性检查——根外
//   绝对路径目标 401 Unauthorized（fetch 与 <img> 同一资源端点同口径）；
// - 运行中扩根重赋 webview.options 会触发整页重载（加载计数器随重赋自增；
//   同值重赋无副作用）——重载会打断输入/IME 组合与滚动位置，不能作为
//   资源解析的自动路径（与 #351 附加组件授权根的 1.82.3 实测一致）。
//
// 因此接线口径：**只在面板装配点（webview.html 赋值前）一次性纳入**绝对
// 资源目标所在目录——数据源为引用索引的出链绝对身份（extractVaultEdges
// 已探测存在的目标，见 T2）。运行中新增的绝对目标（正文新写、嵌套嵌入的
// 外部文档内部图源）在面板下次重建前保持资源不可达（图片槽按既有错误态
// 呈现，不混报不存在），属已记录边界。
//
// 本模块不依赖 vscode（node 单测直驱；vscode 层负责 Uri.file 换算与装配）。
import * as path from 'node:path'
import { classifyVaultFileCategory } from '../shared/vaultFileCategory'

/** 需要 webview 资源服务的目标类型：图片（<img> 装载）与 PDF（PDF.js 按
 *  需 fetch 源字节）。Markdown/text 经 openTextDocument 正文通道，不消耗
 *  许可面——不纳入（许可面最小化）。 */
function needsResourceGrant(fsPath: string): boolean {
  const category = classifyVaultFileCategory(fsPath)
  return category === 'image' || category === 'pdf'
}

/**
 * 从出链绝对身份清单推导需追加的 localResourceRoots 目录（fsPath 形态）。
 *
 * - 只统计**越出既有授权根**的目标（根内目标已被现有根覆盖）；跨根目标
 *   （他工作区文件夹）与其他根/外部目标同口径纳入；
 * - 同目录去重（大小写按宿主语义折叠比较——Windows 宿主资源服务对路径
 *   的包含性检查不区分大小写）；输出为去斜杠归一的目录形态，顺序稳定
 *   （按目录字典序），供宿主层 `vscode.Uri.file` 换算后并入许可面。
 */
export function absoluteResourceGrantDirs(
  items: readonly { targetFsPath: string | null }[],
  existingRootFsPaths: readonly string[],
  isWindowsHost: boolean,
): string[] {
  const ops = isWindowsHost ? path.win32 : path.posix
  const fold = (p: string): string => (isWindowsHost ? p.toLowerCase() : p)
  const normalize = (p: string): string => ops.resolve(p).replace(/[\\/]+/g, '/')
  const existing = new Set(existingRootFsPaths.map((root) => fold(normalize(root))))
  const insideAnyRoot = (dir: string): boolean => {
    const key = fold(normalize(dir))
    for (const root of existing) {
      if (key === root || key.startsWith(`${root}/`)) {
        return true
      }
    }
    return false
  }
  const dirs = new Map<string, string>()
  for (const item of items) {
    const target = item.targetFsPath
    if (target === null || !ops.isAbsolute(target) || !needsResourceGrant(target)) {
      continue
    }
    const dir = normalize(ops.dirname(target))
    if (dir === '' || insideAnyRoot(dir)) {
      continue
    }
    const key = fold(dir)
    if (!dirs.has(key)) {
      dirs.set(key, dir)
    }
  }
  return [...dirs.values()].sort()
}
