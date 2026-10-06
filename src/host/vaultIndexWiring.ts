// 引用索引 vscode 层装配（工单 #197）：VaultIndexService 的扫描 / 存储 /
// 监听端口实现（findFiles + node fs + createFileSystemWatcher）。服务本体
// 不依赖 vscode，本模块是它唯一的 vscode 壳（cssSnippetWiring 先例形态）。
//
// 存储路径约定：服务与快照模块内部用 `/` 拼接的抽象路径（baseDir =
// <context.storageUri>/vsidian-index/<rootKey>），端口实现统一转换为宿主
// 平台真实路径（node:fs 作用于扩展宿主所在机器——远程 SSH 时天然落远端，
// 不写入笔记目录，ADR-0008）。
import * as vscode from 'vscode'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import { VaultIndexService, normalizeSeparators, type VaultIndexScanPort, type VaultIndexStoragePort, type VaultRootRef } from './vaultIndexService'
import { isFileNotFound } from '../shared/imageRefresh'

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
    async listAllFiles(rootFsPath: string, opts?: { skipDir?: (fsPath: string) => boolean }) {
      // #377 T02 全文件清单：workspace.fs 递归列举（Remote SSH 走远端语义，
      // 不经 findFiles 的默认排除/结果上限——清单排除语义单一事实源在服务
      // 侧）。每层让出一次（大库不饿死）；skipDir 为服务注入的剪枝判定
      // （.git/node_modules 等整树排除不进入列举）；目录读取失败记
      // failedDirs（不可访问不冒充其下文件删除）
      // #385 V7：目录符号链接不跟随——VSCode readDirectory 在 Windows 对
      // junction 实测报 Directory（跟随展开），type 位不足以判定；本机以
      // node lstat 识别 reparse/symlink 后整树跳过（防环、防跨根、防同一
      // 文件双路径身份）。lstat 不可达（远程工作区的本机路径必然失败等）
      // 保守维持跟随——远程边界见 wikilink-completion.md「已知边界」
      const files: string[] = []
      const failedDirs: string[] = []
      const isLinkDir = async (fsPath: string): Promise<boolean> => {
        try {
          const st = await lstat(fsPath)
          return st.isSymbolicLink()
        } catch {
          return false
        }
      }
      const walk = async (dir: vscode.Uri): Promise<void> => {
        let entries: [string, vscode.FileType][]
        try {
          entries = await vscode.workspace.fs.readDirectory(dir)
        } catch {
          failedDirs.push(dir.fsPath)
          return
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
        for (const [name, type] of entries) {
          const child = vscode.Uri.joinPath(dir, name)
          if ((type & vscode.FileType.Directory) !== 0) {
            if (opts?.skipDir?.(child.fsPath)) {
              continue
            }
            if (await isLinkDir(child.fsPath)) {
              continue // 链接目录整树不列举（归属只认真实路径）
            }
            await walk(child)
          } else if ((type & vscode.FileType.File) !== 0) {
            files.push(child.fsPath)
          }
          // 符号链接文件等其余类型不入清单（不解析目标身份）
        }
      }
      await walk(vscode.Uri.file(rootFsPath))
      return { files, failedDirs }
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
        // birthtimeMs：FileStat.ctime 为创建时间（毫秒）；POSIX 宿主语义
        // 弱（常为 0 或 mtime 回填）——0/缺省不写键，面板排序沉底。
        // type：#377 T02 清单事件维护的目录判定（目录不入清单）
        return {
          mtimeMs: st.mtime,
          size: st.size,
          ...(st.ctime > 0 ? { birthtimeMs: st.ctime } : {}),
          ...(st.type === vscode.FileType.Directory ? { type: 'dir' as const } : { type: 'file' as const }),
        }
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
        return isFileNotFound(err)
          ? ('missing' as const)
          : ('inaccessible' as const)
      }
    },
    watchRoot(rootFsPath, onEvent) {
      // 递归监听根内全部文件（#377 T02 起全文件域：md 事件走服务侧既有增量
      // 重扫管道，非 md 事件只维护全文件清单；cssSnippetWiring 同形态——
      // 目录暂不存在时 watcher 保持注册，监听其重建）；事件只带 URI，
      // 经端口转发给服务分流
      const pattern = new vscode.RelativePattern(vscode.Uri.file(rootFsPath), '**/*')
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
    // 快照存储目录列举（storageUri/vsidian-index 下，非 vault 清单——
    // vault 目录符号链接口径在上方 listAllFiles 的 isLinkDir）
    async listDirs(baseDir: string) {
      try {
        const entries = await readdir(realPathOf(baseDir), { withFileTypes: true })
        return entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        return []
      }
    },
    async listFiles(baseDir: string) {
      try {
        const entries = await readdir(realPathOf(baseDir), { withFileTypes: true })
        return entries.filter((e) => e.isFile()).map((e) => e.name)
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
 * 当前工作区根引用列表（activate 初始化与 onDidChangeWorkspaceFolders 增删
 * 共用）：语法异构同指向的 URI 去重（normalizeRootUri 同源归则——嵌套根
 * 保留，由服务按最具体根划分）。
 */
export function currentRootRefs(): VaultRootRef[] {
  if (!vscode.workspace.workspaceFolders) {
    return []
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
  return roots
}

/**
 * 组装索引服务（activate 装配入口）：存储根 = context.storageUri（工作区
 * 私有、Remote SSH 落宿主侧）；根列表取 currentRootRefs；excludePatterns
 * 为 activate 读入的持久化排除模式（#198，缺省不排除——生产装配传入
 * initialExcludePatterns(store)）。无工作区时不建服务（返回 undefined——
 * 无工作区编辑不因索引不可用而阻塞）。
 */
export function createVaultIndexService(
  context: vscode.ExtensionContext,
  excludePatterns?: readonly string[],
): VaultIndexService | undefined {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return undefined
  }
  const service = new VaultIndexService(createScanPort(), createStoragePort(), {
    storageRoot: context.storageUri ? context.storageUri.fsPath : path.join(context.globalStorageUri.fsPath, 'ws-fallback'),
    isWindowsHost: process.platform === 'win32',
    excludePatterns,
    // 文档在场探测（#256 关闭残渣兜底）：rescanFile 时文档已不在
    // textDocuments → 其覆盖层/未保存暂存必为残渣（onDidCloseTextDocument
    // 漏触发的兜底退役）。比较为无条件大小写折叠+分隔符归一（保守方向：
    // 大小写漂移只会误判在场而漏兜底——盘=暂存收敛路径仍可退役，不会
    // 误判不在场而误退役真实打开文档的覆盖层）
    isDocOpen: (fsPath) => {
      const fold = normalizeSeparators(fsPath).toLowerCase()
      return vscode.workspace.textDocuments.some(
        (d) => normalizeSeparators(d.uri.fsPath).toLowerCase() === fold,
      )
    },
  })
  return service
}

/** provider 接线用：文档变更进入索引覆盖层（.md 域过滤在 provider 侧统一） */
export { isMarkdownDoc }
