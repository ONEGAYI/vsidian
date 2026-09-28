// 引用索引 vscode 层装配（工单 #197）：VaultIndexService 的扫描 / 存储 /
// 监听端口实现（findFiles + node fs + createFileSystemWatcher）。服务本体
// 不依赖 vscode，本模块是它唯一的 vscode 壳（cssSnippetWiring 先例形态）。
//
// 存储路径约定：服务与快照模块内部用 `/` 拼接的抽象路径（baseDir =
// <context.storageUri>/vsidian-index/<rootKey>），端口实现统一转换为宿主
// 平台真实路径（node:fs 作用于扩展宿主所在机器——远程 SSH 时天然落远端，
// 不写入笔记目录，ADR-0008）。
import * as vscode from 'vscode'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { VaultIndexService, type VaultIndexScanPort, type VaultIndexStoragePort, type VaultRootRef } from './vaultIndexService'

/** 抽象路径（`/` 拼接）→ 宿主平台真实路径 */
function realPathOf(abstractPath: string): string {
  const normalized = path.normalize(abstractPath.replace(/\//g, path.sep))
  return normalized
}

/** Markdown 判定（索引域文档；无扩展名语义不适用扫描层——findFiles 按真名列举） */
function isMarkdownDoc(uri: vscode.Uri): boolean {
  return uri.scheme === 'file' && /\.md$/i.test(uri.path)
}

/** 扫描端口：findFiles 列举（排除过滤在服务侧统一执行——语义单一事实源
 *  在 shared/vaultIndexExclude，端口只列举不筛） */
function createScanPort(): VaultIndexScanPort {
  return {
    async listMarkdownFiles(rootFsPath: string) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(rootFsPath), '**/*.md')
      const uris = await vscode.workspace.findFiles(pattern, undefined)
      return uris.filter((u) => u.scheme === 'file').map((u) => u.fsPath)
    },
    async readFileText(fsPath: string) {
      try {
        const buffer = await readFile(fsPath)
        // BOM 剥离；非法字节按替换字符容错（索引抽取只关心文本形态）
        const text = buffer.toString('utf8')
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
      } catch {
        return null
      }
    },
    async statFile(fsPath: string) {
      try {
        const st = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
        return { mtimeMs: st.mtime, size: st.size }
      } catch {
        return null
      }
    },
    async accessOf(fsPath: string) {
      // 可访问性三态（#198）：FileNotFound=明确不存在；其余失败
      // （NoPermissions/Unavailable——SSH 断连等）=不可访问，不得等同删除
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
        return 'ok' as const
      } catch (err) {
        const code = (err as { code?: string }).code
        return code === 'FileNotFound' || code === 'ENOENT'
          ? ('missing' as const)
          : ('inaccessible' as const)
      }
    },
    watchRoot(rootFsPath, onEvent) {
      // 递归监听根内 *.md（cssSnippetWiring 同形态：目录暂不存在时 watcher
      // 保持注册，监听其重建）；事件只带 URI，经端口转发给服务分流
      const pattern = new vscode.RelativePattern(vscode.Uri.file(rootFsPath), '**/*.md')
      const watcher = vscode.workspace.createFileSystemWatcher(pattern)
      const forward = (uri: vscode.Uri | undefined): void => onEvent(uri?.fsPath ?? null)
      const changeSub = watcher.onDidChange(forward)
      const createSub = watcher.onDidCreate(forward)
      const deleteSub = watcher.onDidDelete(forward)
      return () => {
        changeSub.dispose()
        createSub.dispose()
        deleteSub.dispose()
        watcher.dispose()
      }
    },
    yieldToEventLoop() {
      return new Promise<void>((resolve) => setImmediate(resolve))
    },
  }
}

/** 存储端口：node fs 实现（原子写 = 临时文件 + rename，ADR-0008 三要素之一） */
function createStoragePort(): VaultIndexStoragePort {
  return {
    async listDirs(baseDir: string) {
      try {
        const entries = await readdir(realPathOf(baseDir), { withFileTypes: true })
        return entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        return []
      }
    },
    async readFile(path: string) {
      return readFile(realPathOf(path), 'utf8')
    },
    async writeFile(filePath: string, content: string) {
      const target = realPathOf(filePath)
      const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`
      await writeFile(tmp, content, 'utf8')
      await rename(tmp, target)
    },
    async removeDir(dir: string) {
      await rm(realPathOf(dir), { recursive: true, force: true })
    },
    async ensureDir(dir: string) {
      await mkdir(realPathOf(dir), { recursive: true })
    },
  }
}

/**
 * 组装索引服务（activate 装配入口）：存储根 = context.storageUri（工作区
 * 私有、Remote SSH 落宿主侧）；根列表取 workspaceFolders（语法异构同指向
 * 的 URI 按 normalizeRootUri 去重——嵌套根保留，由服务按最具体根划分）。
 * 无工作区时不建服务（返回 undefined——无工作区编辑不因索引不可用而阻塞）。
 */
export function createVaultIndexService(context: vscode.ExtensionContext): VaultIndexService | undefined {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return undefined
  }
  const seen = new Set<string>()
  const roots: VaultRootRef[] = []
  for (const folder of vscode.workspace.workspaceFolders) {
    const uriStr = folder.uri.toString()
    // 去重键与 rootKeyOf 同源归一（语法层；平台大小写由 vscode 语义保证一致）
    const dedupeKey = `${folder.uri.scheme}:${folder.uri.authority}${folder.uri.path}`.replace(/\/+$/, '')
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    roots.push({ fsPath: folder.uri.fsPath, uri: uriStr })
  }
  const service = new VaultIndexService(createScanPort(), createStoragePort(), {
    storageRoot: context.storageUri ? context.storageUri.fsPath : path.join(context.globalStorageUri.fsPath, 'ws-fallback'),
    isWindowsHost: process.platform === 'win32',
  })
  return service
}

/** provider 接线用：文档变更进入索引覆盖层（.md 域过滤在 provider 侧统一） */
export { isMarkdownDoc }
