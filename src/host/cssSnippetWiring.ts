// CSS 片段 vscode 层装配（#128/#129）：CssSnippetService 的文件系统/监听
// 端口实现（workspace.fs + createFileSystemWatcher + node realpath）、目录
// 选择对话框与设置页接线（SnippetPageWiring）。CssSnippetService 本体不
// 依赖 vscode，本模块是它唯一的 vscode 壳。
import * as vscode from 'vscode'
import { realpath } from 'fs/promises'
import { CssSnippetService, type CssSnippetFsPort } from './cssSnippetService'
import { isSnippetFileName } from '../shared/cssSnippets'
import { t } from '../shared/i18n'
import type { SnippetPageWiring } from './settingsPage'

/** 目录读取端口：第一层 .css 文件（含符号链接文件——目录内容属用户自管，
 *  链接目标是否越界由服务的 realpath 分析判定）；任何读取异常归并为
 *  null（读取失败，服务保留最近成功清单） */
function listCssFiles(directory: string): Promise<string[] | null> {
  return Promise.resolve(vscode.workspace.fs.readDirectory(vscode.Uri.file(directory)))
    .then((entries) =>
      entries
        .filter(
          ([name, type]) =>
            (type === vscode.FileType.File || type === vscode.FileType.SymbolicLink) &&
            isSnippetFileName(name),
        )
        .map(([name]) => name),
    )
    .catch(() => null)
}

/** #129 读 CSS 文本：workspace.fs 读取 + utf-8 解码（BOM 由 TextDecoder
 *  剥离）；失败/不存在 → null。服务只依赖解码文本做 @import 形态学，
 *  非 utf-8 编码（如 UTF-16）解码失败按不可读处理——保留上一依赖图，
 *  条目仍入清单（装载成败由浏览器回报） */
async function readFileText(path: string): Promise<string | null> {
  try {
    const data = await vscode.workspace.fs.readFile(vscode.Uri.file(path))
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return null
  }
}

/** #129 符号链接解析：宿主是 Node 环境（远程 SSH 时宿主代码运行在远程，
 *  node fs 作用于远程文件系统——方向正确）。workspace.fs 无 realpath
 *  端点，直接用 node fs；失败/不存在 → null（悬空链接按缺失处理） */
async function realpathNode(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/** 监听端口：递归监听（列表只扫一层，但被嵌套引用的文件变化也要触发刷新，
 *  #129 的 @import 依赖归因——事件携带变更文件路径，服务按「第一层/子级」
 *  分流）。目录暂不存在时 watcher 保持注册（@parcel/watcher 对不存在基路径
 *  监听其重建），目录恢复后事件继续到达 */
function watchSnippetDirectory(
  directory: string,
  onEvent: (changedPath: string | null) => void,
): () => void {
  const pattern = new vscode.RelativePattern(vscode.Uri.file(directory), '**/*.css')
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
}

export function createSnippetFsPort(): CssSnippetFsPort {
  return {
    listCssFiles,
    watchDirectory: watchSnippetDirectory,
    readFileText,
    realpath: realpathNode,
  }
}

/** 设置页接线：目录选择对话框（钩子模式短路——集成测试不弹真实对话框，
 *  目录设置经 _test.setSnippetDirectory / snippets.setDirectory 消息注入），
 *  打开目录走 revealFileInOS（跨平台文件管理器），用户可见失败提示经 t() */
export function createSnippetPageWiring(service: CssSnippetService): SnippetPageWiring {
  return {
    getState: () => service.getState(),
    setDirectory: (directory) => service.setDirectory(directory),
    setEnabled: (name, enabled) => service.setEnabled(name, enabled),
    setPaused: (paused) => service.setPaused(paused),
    refresh: () => service.refresh(),
    chooseDirectory: async () => {
      if (process.env.VSIDIAN_TEST_HOOKS === '1') {
        return null
      }
      const picks = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: t('cssSnippets.chooseOpenLabel'),
      })
      const directory = picks?.[0]?.fsPath ?? null
      if (directory) {
        await service.setDirectory(directory)
      }
      return directory
    },
    openDirectory: () => {
      const directory = service.getState().directory
      if (directory) {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(directory))
      }
    },
  }
}
