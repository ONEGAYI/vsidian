// #619（V01）PDF 导出探针 · 路线 A 依赖准备（独立目录，不动仓库清单）。
// puppeteer-core@24.43.1（engines node>=18 的最后一个主版本；25.x 要
// node>=22.12 与宿主 Node 18 冲突）装入 .vscode-test/routeA-deps/ 的独立
// node_modules：
// - 该目录不在仓库 node_modules junction 的作用范围（junction 只挂在工作树
//   根 node_modules），npm --prefix 不会写穿共享缓存；
// - 不修改 package.json / package-lock.json（研究票不改生产清单）；
// - 幂等：目录已含目标版本时直接复用。
// 同时用 esbuild 把 puppeteer-core bundle 成 node18/cjs 单文件产物，
// 供宿主内验证「能否被 esbuild bundle 进 CJS 产物」。
import { build } from 'esbuild'
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const ROUTE_A_VERSION = '24.43.1'
export const routeADepsDir = path.join(root, '.vscode-test', 'routeA-deps')
export const routeABundlePath = path.join(root, '.vscode-test', 'pdf-export-probe-artifacts', 'routeA-puppeteer-bundle.cjs')

/** 已就绪判定：node_modules 内目标版本存在。 */
export function routeAReady() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(routeADepsDir, 'node_modules', 'puppeteer-core', 'package.json'), 'utf8'))
    return pkg.version === ROUTE_A_VERSION
  } catch {
    return false
  }
}

export function prepareRouteA(log = console.log) {
  if (routeAReady()) {
    log(`[routeA] 依赖已就绪，复用 ${routeADepsDir}（puppeteer-core@${ROUTE_A_VERSION}）`)
  } else {
    mkdirSync(routeADepsDir, { recursive: true })
    const pkgPath = path.join(routeADepsDir, 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'vsidian-route-a-probe-deps', private: true }, null, 2), 'utf8')
    log(`[routeA] npm install puppeteer-core@${ROUTE_A_VERSION}（--prefix 独立目录，--ignore-scripts，不动仓库清单）`)
    const result = spawnSync('npm', ['install', '--prefix', routeADepsDir, '--no-save', '--no-package-lock',
      '--ignore-scripts', '--no-audit', '--no-fund', `puppeteer-core@${ROUTE_A_VERSION}`], { stdio: 'inherit', shell: true })
    if (result.status !== 0) throw new Error(`routeA 依赖安装失败（退出码 ${result.status}）`)
    if (!routeAReady()) throw new Error('routeA 安装后仍未检测到目标版本')
  }
  // bundle 实测：node18/cjs/platform=node 单文件（幂等重建，尺寸进报告）
  const entryPath = path.join(routeADepsDir, 'entry.mjs')
  writeFileSync(entryPath, "import puppeteer from 'puppeteer-core'\nexport default puppeteer\n", 'utf8')
  const built = build({
    entryPoints: [entryPath],
    outfile: routeABundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    logLevel: 'silent',
  })
  const size = existsSync(routeABundlePath) ? statSync(routeABundlePath).size : 0
  return { bundle: built, bundleBytes: size }
}
