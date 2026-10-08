// #364 T15 样例工程共享构建库：页面 IIFE（SDK 构建桥 + CM6 双红线）+
// 宿主 CJS（external vscode）+ 产物扫描（无内部路径导入 / 裸 require /
// CM6 运行时标记）。三个样例工程（input-behavior / renderer / ui-command）
// 的 build.mjs 都经此处构建——单一构建路径，独立仓库复制时随样例带走。
//
// 依赖可达性（不新增 npm 安装）：
// - esbuild 从仓库根 node_modules 相对解析（worktree 依赖经 junction 预置）；
// - SDK 构建桥与 CM6 标记表从 test/fixtures/addon-v02/sdk/ 导入——公开
//   SDK 开发路径的单一事实源（apiCatalog 的 page-bridge 条目签名源同处），
//   不在样例目录复制第二份（复制到独立仓库时的处置见 test/examples/README）。
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSdkBridgePlugin } from '../../fixtures/addon-v02/sdk/sdkBridge.mjs'
import { CM6_RUNTIME_MARKERS } from '../../fixtures/addon-v02/sdk/buildAddon.mjs'

const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 产物中不得出现的主仓库内部路径标记（type-only 导入被 esbuild 剥离；
 *  产物含任一即证明把内部代码打进了 bundle） */
export const INTERNAL_PATH_MARKERS = ['src/shared', 'src/host', 'test/fixtures', 'test/examples']

/**
 * 产物静态扫描（票面验收：产物无内部路径导入、裸 require 或重复 CM6）。
 * - page（浏览器 IIFE）：不得含任何 require( 调用（自包含）；
 * - host（扩展宿主 CJS）：仅允许 require('vscode')（engines 依赖，external）。
 * 两种产物都不得含 CM6 运行时标记与内部路径标记。
 */
export function scanArtifact(productPath, kind) {
  const text = readFileSync(productPath, 'utf8')
  for (const marker of CM6_RUNTIME_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`${productPath} 含 CM6 运行时标记「${marker}」——样例产物不得重打包 @codemirror/*`)
    }
  }
  for (const marker of INTERNAL_PATH_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`${productPath} 含主仓库内部路径标记「${marker}」——样例不得导入 Vsidian 内部代码`)
    }
  }
  const requires = [...text.matchAll(/require\(\s*(['"])([^'"]*)\1\s*\)/g)].map((m) => m[2])
  if (kind === 'page' && requires.length > 0) {
    throw new Error(`${productPath} 含 require 调用（${requires.join(', ')}）——页面产物须为自包含 IIFE`)
  }
  if (kind === 'host') {
    const bare = requires.filter((id) => id !== 'vscode')
    if (bare.length > 0) {
      throw new Error(`${productPath} 含 vscode 之外的裸 require（${bare.join(', ')}）——宿主产物仅允许依赖 vscode`)
    }
  }
}

/**
 * 构建一个样例工程。页面入口打成 chrome114 IIFE（对齐下界宿主
 * 1.82.3 = Electron 25 / Chromium 114，经 SDK 构建桥解析虚拟模块
 * vsidian-addon-sdk 并拒绝 @codemirror/* 值导入）；宿主入口打成 node18
 * CJS（external vscode）。src/ 下的 .css 随页面拷入 dist/。逐产物扫描。
 *
 * @param {object} input
 * @param {string} input.exampleDir 样例工程目录（含 package.json 与 src/）
 * @param {Array<{ entry: string, out: string }>} input.pages 页面入口（相对 exampleDir）
 * @param {string} input.host 宿主入口（相对 exampleDir，产物固定 dist/extension.js）
 * @param {(message: string) => void} [input.log]
 */
export async function buildExample({ exampleDir, pages, host, log = console.log }) {
  const distDir = path.join(exampleDir, 'dist')
  mkdirSync(distDir, { recursive: true })
  const sdkBridge = createSdkBridgePlugin()
  for (const page of pages) {
    const outfile = path.join(exampleDir, page.out)
    mkdirSync(path.dirname(outfile), { recursive: true })
    await build({
      entryPoints: [path.join(exampleDir, page.entry)],
      outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome114',
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
      plugins: [sdkBridge],
    })
    scanArtifact(outfile, 'page')
    const bytes = statSync(outfile).size
    log(`[buildExample] ${path.basename(exampleDir)} 页面 ${page.entry} -> ${page.out}（${bytes} B，扫描通过）`)
  }
  const hostOut = path.join(exampleDir, 'dist', 'extension.js')
  await build({
    entryPoints: [path.join(exampleDir, host)],
    outfile: hostOut,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    minify: true,
    sourcemap: false,
    logLevel: 'silent',
    external: ['vscode'],
  })
  scanArtifact(hostOut, 'host')
  log(`[buildExample] ${path.basename(exampleDir)} 宿主 ${host} -> dist/extension.js（${statSync(hostOut).size} B，扫描通过）`)
  // 样式随页面拷贝（src/*.css -> dist/，装载登记 css: ['dist/editor.css'] 等）
  for (const name of readdirSync(path.join(exampleDir, 'src'))) {
    if (name.endsWith('.css')) {
      cpSync(path.join(exampleDir, 'src', name), path.join(distDir, name))
      log(`[buildExample] ${path.basename(exampleDir)} 样式 ${name} -> dist/`)
    }
  }
  return { distDir }
}

/** 三工程清单（构建入口与集成装配共用） */
export const EXAMPLE_PROJECTS = ['input-behavior', 'renderer', 'ui-command']

/** 构建全部样例（聚合入口；单工程构建由各自 build.mjs 提供） */
export async function buildAllExamples({ log = console.log } = {}) {
  const layouts = {}
  for (const name of EXAMPLE_PROJECTS) {
    const exampleDir = path.join(examplesRoot, name)
    if (name === 'ui-command') {
      layouts[name] = await buildExample({
        exampleDir,
        pages: [
          { entry: 'src/page-editor.ts', out: 'dist/editor.js' },
          { entry: 'src/page-settings.ts', out: 'dist/settings.js' },
        ],
        host: 'src/extension.ts',
        log,
      })
    } else {
      layouts[name] = await buildExample({
        exampleDir,
        pages: [{ entry: 'src/page-editor.ts', out: 'dist/editor.js' }],
        host: 'src/extension.ts',
        log,
      })
    }
  }
  return layouts
}
