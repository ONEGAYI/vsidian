// #619（V01）PDF 导出探针 · 本机浏览器发现（Windows）。
// 三个发现通道，按优先级排列：
// 1. 注册表 App Paths（HKLM，chrome.exe / msedge.exe 的 (default) 即完整路径）；
// 2. 常见安装路径（Program Files / Program Files (x86) 的固定目录）；
// 3. PATH 环境变量扫描（where 语义，宿主内直接拆 PATH 检查，避免依赖 shell）。
// 版本号经 PowerShell VersionInfo 读取（Windows GUI 程序的 --version 不落
// 控制台）。本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

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

function regQueryAppPaths(name: string): Promise<string | null> {
  // reg.exe 每个键的 (default) 值经 /v /ve 查询；Git Bash 会吃掉 /ve，
  // 探针宿主进程直接 spawn 不经 shell，无此问题
  return execFileAsync('reg', ['query', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${name}`, '/ve'])
    .then(({ stdout }) => {
      const match = /REG_SZ\s+(.+)$/m.exec(stdout)
      return match ? match[1].trim() : null
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

function findInPathEnv(kind: DiscoveredBrowser['kind']): string | null {
  const exe = kind === 'chrome' ? 'chrome.exe' : 'msedge.exe'
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function readVersion(executablePath: string): Promise<string | null> {
  // GUI 程序 --version 不写 stdout；PowerShell VersionInfo 是可靠通道
  return execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-Item -LiteralPath '${executablePath.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
  ], { timeout: 15_000 })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null)
}

/** 逐通道发现 Chrome 与 Edge；两者都不存在时返回空数组（调用方决定错误形态）。 */
export async function discoverBrowsers(): Promise<DiscoveredBrowser[]> {
  const found: DiscoveredBrowser[] = []
  for (const kind of ['chrome', 'edge'] as const) {
    const exe = kind === 'chrome' ? 'chrome.exe' : 'msedge.exe'
    let executablePath = await regQueryAppPaths(exe)
    let via: DiscoveredBrowser['via'] = 'app-paths-registry'
    if (!executablePath || !existsSync(executablePath)) {
      executablePath = COMMON_PATHS[kind].find((p) => existsSync(p)) ?? null
      via = 'common-path'
    }
    if (!executablePath) {
      executablePath = findInPathEnv(kind)
      via = 'path-env'
    }
    if (!executablePath) continue
    found.push({ kind, executablePath, version: await readVersion(executablePath), via })
  }
  return found
}
