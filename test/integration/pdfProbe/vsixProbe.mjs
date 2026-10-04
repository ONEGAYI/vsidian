// #334（P3-02）VSIX 体积与包内容核算探针。
// 目的：验证「PDF.js 进生产装配」后的真实包体与 scripts/release.mjs 现有
// 红线（SIZE_LIMITS）的关系，产出数据供报告与 P3-05 决策；不修改任何
// 生产文件——资产注入是临时的，跑完即清理（脚本 --keep 可保留现场）。
//
// 步骤：
// 1. 基线打包：当前仓库状态 vsce package --no-dependencies -> 基线 VSIX；
// 2. 注入装配（生产候选布局，全部临时复制）：
//    - out/webview/pdfMain.js（pdfjs legacy 主库 minified，探针近似入口）
//    - out/webview/pdfWorker.js（worker 单文件 minified）
//    - media/pdfjs/{cmaps,standard_fonts,wasm(无 quickjs),iccs}
// 3. 再次打包 -> PDF 版 VSIX；
// 4. 两个包都走 release.mjs 的 inspectVsixEntries + SIZE_LIMITS 判定，
//    输出对比 JSON（.vscode-test/pdf-vsix-probe.json）与控制台摘要。
// 预期会撞两条已知登记线（out/ 白名单与 .ttf 禁止模式）——它们是本探针
// 要拿到的「生产接线需同步 release.mjs」的证据，不是要在本票修改。
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectVsixEntries, SIZE_LIMITS } from '../../../scripts/release.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const keep = process.argv.includes('--keep')

/** 递归列出目录全部文件的相对路径与大小。 */
function walk(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full, rel))
    else out.push({ name: rel, size: st.size })
  }
  return out
}

function runVsce(tag) {
  const out = spawnSync('npx', ['@vscode/vsce', 'package', '--no-dependencies', '--out', path.join(root, `.vscode-test/vsidian-probe-${tag}.vsix`)], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' })
  if (out.status !== 0) throw new Error(`vsce package（${tag}）失败：${out.stdout}\n${out.stderr}`)
  return path.join(root, '.vscode-test', `vsidian-probe-${tag}.vsix`)
}

function listZip(vsixPath) {
  // 与 release.mjs 同策略：优先 unzip，回退 PowerShell
  const unzip = spawnSync('unzip', ['-l', vsixPath], { encoding: 'utf8' })
  if (unzip.status === 0 && unzip.stdout) {
    const entries = []
    for (const line of unzip.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+(.+)$/)
      if (m) entries.push({ size: Number(m[1]), name: m[2].trim() })
    }
    return entries
  }
  if (process.platform === 'win32') {
    const ps = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      "foreach($e in $z.Entries){ Write-Output ($e.Length.ToString() + \"`t\" + $e.FullName) }",
      '$z.Dispose()',
    ].join('; ')
    const out2 = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out2.status !== 0) throw new Error(`无法读取 VSIX 内容：${out2.stderr}`)
    return out2.stdout.split(/\r?\n/).filter((l) => l.includes('\t')).map((l) => {
      const [size, ...rest] = l.split('\t')
      return { size: Number(size), name: rest.join('\t') }
    })
  }
  throw new Error('unzip 与 PowerShell 均不可用')
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const report = { startedAt: new Date().toISOString(), sizeLimits: SIZE_LIMITS }

// ---- 0. 前置：production 构建（vsce 打包输入）----
console.log('[vsixProbe] production 构建当前仓库产物…')
const build = spawnSync('node', ['esbuild.mjs', '--production'], { cwd: root, encoding: 'utf8' })
if (build.status !== 0) throw new Error(`esbuild --production 失败：${build.stdout}\n${build.stderr}`)

// ---- 1. 基线 VSIX ----
console.log('[vsixProbe] 打包基线 VSIX（当前状态）…')
const baselineVsix = runVsce('baseline')
const baselineEntries = listZip(baselineVsix)
report.baseline = inspectVsixEntries(baselineEntries, { iconPath: pkg.icon })
report.baselineVsixBytes = statSync(baselineVsix).size

// ---- 2. 注入 PDF 装配（生产候选布局）----
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist')
const injected = []
function injectCopy(src, dest) {
  const target = path.join(root, dest)
  mkdirSync(path.dirname(target), { recursive: true })
  cpSync(src, target, { recursive: true })
  injected.push(target)
}

// minify 构建 pdfMain 近似入口（生产 main bundle 只含 pdfjs + 挂载胶水），
// 与真实生产 bundle 的差异是探针消息循环若干 KB（报告中说明）
console.log('[vsixProbe] esbuild minify 生成 pdfMain/pdfWorker…')
const esbuild = await import('esbuild')
const banner = { js: 'if (typeof Promise.withResolvers !== "function") { Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; } }if (!ReadableStream.prototype[Symbol.asyncIterator]) { ReadableStream.prototype[Symbol.asyncIterator] = async function* () { const reader = this.getReader(); try { for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; } } finally { reader.releaseLock(); } }; }' }
const minEntry = path.join(root, '.vscode-test', 'pdf-probe-min-entry.ts')
mkdirSync(path.dirname(minEntry), { recursive: true })
writeFileSync(minEntry, '// 生产近似入口：仅引 pdfjs legacy 主库（探针消息循环不计入）\nimport * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"\nexport const lib = pdfjsLib\n', 'utf8')
await esbuild.build({
  entryPoints: [minEntry],
  outfile: path.join(root, 'out/webview/pdfMain.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome114',
  minify: true, logLevel: 'warning', banner,
})
injected.push(path.join(root, 'out/webview/pdfMain.js'))
await esbuild.build({
  entryPoints: [path.join(root, 'test/integration/pdfProbe/workerEntry.ts')],
  outfile: path.join(root, 'out/webview/pdfWorker.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome114',
  minify: true, logLevel: 'warning', banner,
})
injected.push(path.join(root, 'out/webview/pdfWorker.js'))

// 静态资产：cmaps 全量、standard_fonts 全量、wasm（生产候选裁剪：排除
// quickjs——PDF JS 执行引擎，规格拒绝执行 PDF JS；排除 *_nowasm_fallback.js
// ——无 wasm 环境的纯 JS 回退，宿主 Chromium 114 支持 wasm 用不到）、iccs
injectCopy(path.join(pdfjsDir, 'cmaps'), 'media/pdfjs/cmaps')
injectCopy(path.join(pdfjsDir, 'standard_fonts'), 'media/pdfjs/standard_fonts')
for (const f of readdirSync(path.join(pdfjsDir, 'wasm'))) {
  if (f.startsWith('quickjs') || f.includes('_nowasm_fallback')) continue
  injectCopy(path.join(pdfjsDir, 'wasm', f), `media/pdfjs/wasm/${f}`)
}
injectCopy(path.join(pdfjsDir, 'iccs'), 'media/pdfjs/iccs')

// 注入资产清单与字节统计
report.injectedAssets = injected.flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [{ name: path.relative(root, p).split(path.sep).join('/'), size: statSync(p).size }]))
report.injectedBytes = report.injectedAssets.reduce((s, e) => s + e.size, 0)

// ---- 3. PDF 版 VSIX ----
console.log('[vsixProbe] 打包 PDF 装配 VSIX…')
const pdfVsix = runVsce('pdf')
const pdfEntries = listZip(pdfVsix)
report.pdfAssembly = inspectVsixEntries(pdfEntries, { iconPath: pkg.icon })
report.pdfVsixBytes = statSync(pdfVsix).size
report.pdfAssetEntries = pdfEntries.filter((e) => /media\/pdfjs\//.test(e.name) || /pdf(Main|Worker)\.js/.test(e.name))

// ---- 4. 清理（临时注入不留在仓库；--keep 保留现场）----
if (!keep) {
  for (const p of injected) rmSync(p, { recursive: true, force: true })
  // 重建 production out/，恢复无注入状态
  const rebuild = spawnSync('node', ['esbuild.mjs', '--production'], { cwd: root, encoding: 'utf8' })
  if (rebuild.status !== 0) throw new Error(`恢复构建失败：${rebuild.stdout}\n${rebuild.stderr}`)
}

report.finishedAt = new Date().toISOString()
const reportPath = path.join(root, '.vscode-test', 'pdf-vsix-probe.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

const mb = (b) => (b / 1048576).toFixed(2)
console.log(`[vsixProbe] 基线：解压总量 ${mb(report.baseline.totalBytes)} MB，vsix 文件 ${mb(report.baselineVsixBytes)} MB，ok=${report.baseline.ok}`)
console.log(`[vsixProbe] PDF 装配：解压总量 ${mb(report.pdfAssembly.totalBytes)} MB，vsix 文件 ${mb(report.pdfVsixBytes)} MB，ok=${report.pdfAssembly.ok}`)
console.log(`[vsixProbe] 注入资产合计 ${mb(report.injectedBytes)} MB`)
console.log(`[vsixProbe] 红线：总量 warn/max ${mb(SIZE_LIMITS.totalWarnBytes)}/${mb(SIZE_LIMITS.totalMaxBytes)} MB，单文件 warn/max ${mb(SIZE_LIMITS.fileWarnBytes)}/${mb(SIZE_LIMITS.fileMaxBytes)} MB`)
if (report.pdfAssembly.errors.length) console.log(`[vsixProbe] PDF 版检查 errors（预期含 out/ 白名单与 .ttf 登记冲突，供生产接线）：\n  - ${report.pdfAssembly.errors.slice(0, 20).join('\n  - ')}`)
if (report.pdfAssembly.warnings.length) console.log(`[vsixProbe] PDF 版检查 warnings：\n  - ${report.pdfAssembly.warnings.join('\n  - ')}`)
console.log(`[vsixProbe] 明细已写入 ${reportPath}`)
