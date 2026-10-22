// PDF 导出本机浏览器发现（T01/#621）：三通道 + 显式路径覆盖。
// 自 #619（V01）探针 test/integration/pdfExportProbe/browserFind.ts 收编，
// 依赖注入化（deps 形参）供单元测试替换；发现语义不变（V01 §11）：
// 1. 注册表 App Paths（HKLM，chrome.exe / msedge.exe 的 (default) 即完整路径）；
// 2. 常见安装路径（Program Files / Program Files (x86) 的固定目录）；
// 3. PATH 环境变量扫描（宿主内直接拆 PATH 检查，不依赖 shell）。
// 版本号经 PowerShell VersionInfo 读取（GUI 程序 --version 不落控制台）。
//
// 边界（V01 §9.3 如实记录）：三通道是 Windows 语义；非 Windows 平台
// （macOS /Applications、Linux which）未实现未验证——discoverBrowsers 在
// 非 win32 返回空发现，错误呈现由任务层按平台分态，不冒充已发现。
// 显式配置路径（设置页 pdfExport.browserPath）存在即优先，路径不存在
// 回 configured-missing 分态（可区分「未安装」与「配置错」——V01 §8）。

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface DiscoveredBrowser {
  kind: 'chrome' | 'edge'
  executablePath: string
  /** 例 155.0.8059.85；读取失败为 null（不阻塞发现）。 */
  version: string | null
  /** 命中的发现通道。 */
  via: 'app-paths-registry' | 'common-path' | 'path-env'
}

/** 发现依赖面（生产默认 node 实现；单元测试注入替身）。 */
export interface BrowserFindDeps {
  execFileAsync(command: string, args: string[], options?: { timeout?: number }): Promise<{ stdout: string }>
  existsSync(path: string): boolean
  platform: NodeJS.Platform
  /** PATH 环境变量（缺省 process.env.PATH）。 */
  pathEnv: string | undefined
}

export const defaultBrowserFindDeps: BrowserFindDeps = {
  execFileAsync: execFileAsync as BrowserFindDeps['execFileAsync'],
  existsSync,
  platform: process.platform,
  pathEnv: process.env.PATH,
}

function regQueryAppPaths(deps: BrowserFindDeps, name: string): Promise<string | null> {
  // reg.exe 的 (default) 值经 /ve 查询；宿主进程直接 spawn 不经 shell，
  // 无 Git Bash 吃掉 /ve 的问题
  return deps.execFileAsync('reg', ['query', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`, '/ve'])
    .then(({ stdout }) => {
      const match = /REG_SZ\s+(.+)$/m.exec(stdout)
      return match ? match[1]!.trim() : null
    })
    .catch(() => null)
}

const COMMON_PATHS: Record<DiscoveredBrowser['kind'], string[]> = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
}

function findInPathEnv(deps: BrowserFindDeps, kind: DiscoveredBrowser['kind']): string | null {
  const exe = kind === 'chrome' ? 'chrome.exe' : 'msedge.exe'
  // PATH 的分隔与拼接必须跟随**被扫描平台**（deps.platform），不能用宿主
  // 进程的 path.delimiter/path.join：Windows 语义的 PATH 在 POSIX 测试机
  // 上会被 ':' 切坏、被 '/' 拼错（CI Linux runner 实测）。本函数只在
  // win32 分支被调用（discoverBrowsers 已在非 win32 提前返回），因此固定
  // 用 Windows 语义。
  for (const dir of (deps.pathEnv ?? '').split(';')) {
    if (!dir) continue
    const candidate = path.win32.join(dir, exe)
    if (deps.existsSync(candidate)) return candidate
  }
  return null
}

function readVersion(deps: BrowserFindDeps, executablePath: string): Promise<string | null> {
  // GUI 程序 --version 不写 stdout；PowerShell VersionInfo 是可靠通道
  return deps.execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath '${executablePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
  ], { timeout: 15_000 })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null)
}

/** 逐通道发现 Chrome 与 Edge；两者都不存在（或非 Windows 平台）时返回
 *  空数组（调用方决定错误形态）。 */
export async function discoverBrowsers(deps: BrowserFindDeps = defaultBrowserFindDeps): Promise<DiscoveredBrowser[]> {
  if (deps.platform !== 'win32') return []
  const found: DiscoveredBrowser[] = []
  for (const kind of ['chrome', 'edge'] as const) {
    const exe = kind === 'chrome' ? 'chrome.exe' : 'msedge.exe'
    let executablePath = await regQueryAppPaths(deps, exe)
    let via: DiscoveredBrowser['via'] = 'app-paths-registry'
    if (!executablePath || !deps.existsSync(executablePath)) {
      executablePath = COMMON_PATHS[kind].find((p) => deps.existsSync(p)) ?? null
      via = 'common-path'
    }
    if (!executablePath) {
      executablePath = findInPathEnv(deps, kind)
      via = 'path-env'
    }
    if (!executablePath) continue
    found.push({ kind, executablePath, version: await readVersion(deps, executablePath), via })
  }
  return found
}

export type ResolveBrowserResult =
  | { ok: true; browser: DiscoveredBrowser; fromConfiguredPath: boolean }
  /** 显式配置的路径不存在（区分「未安装」与「配置错」） */
  | { ok: false; reason: 'configured-path-missing'; configuredPath: string }
  /** 无可用浏览器（未安装 / 平台未支持） */
  | { ok: false; reason: 'no-browser' }
  /** T08/#628 远端会话专用：本机执行端扩展未安装/未激活（pdfRemoteAdapter
   *  产出；本模块自身不返回该分态——执行端缺失语义属于跨宿主通道层） */
  | { ok: false; reason: 'executor-missing' }
  /** T08/#628 远端会话专用：跨宿主命令超时/不可达（同上，通道层产出） */
  | { ok: false; reason: 'executor-unreachable' }

/** 解析本次导出使用的浏览器：显式配置路径优先（存在即用，不回退——
 *  用户点名路径失效时如实报错，不静默换浏览器），否则自动发现
 *  （Chrome 优先，其次 Edge）。 */
export async function resolveExportBrowser(
  configuredPath: string | undefined,
  deps: BrowserFindDeps = defaultBrowserFindDeps,
): Promise<ResolveBrowserResult> {
  const trimmed = configuredPath?.trim()
  if (trimmed) {
    if (deps.existsSync(trimmed)) {
      return {
        ok: true,
        fromConfiguredPath: true,
        browser: { kind: trimmed.toLowerCase().includes('msedge') ? 'edge' : 'chrome', executablePath: trimmed, version: null, via: 'app-paths-registry' },
      }
    }
    return { ok: false, reason: 'configured-path-missing', configuredPath: trimmed }
  }
  const found = await discoverBrowsers(deps)
  const browser = found.find((b) => b.kind === 'chrome') ?? found[0]
  if (!browser) return { ok: false, reason: 'no-browser' }
  return { ok: true, browser, fromConfiguredPath: false }
}
