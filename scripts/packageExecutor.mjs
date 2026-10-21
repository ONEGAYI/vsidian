// 执行端 VSIX 打包脚本（T08/#628）：把 out/pdfExecutor/extension.js 与
// src/pdfExecutor/package.json 模板组装到临时打包目录，注入主包同版版本
// 号与 NLS（%manifest.*% 引用——两份 nls 从字典单一事实源生成），复制主
// 包图标后经 vsce package --no-dependencies 产出双 VSIX 分发的第二个包。
//
//   node scripts/packageExecutor.mjs               # 产物 out/vsidian-pdf-executor-<version>.vsix
//   node scripts/packageExecutor.mjs --out <路径>   # 指定输出
//
// 前置：npm run compile（esbuild 产物线 + 类型检查）。执行端包静态资产
// （pdfExportPage/pdfjs/mermaid 等）不随包——运行时从本机安装的主扩展
// 目录读取（双 VSIX 是分发前提；缺席经 ping 如实报告）。
import { build as esbuildBuild } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'out', 'pdfExecutor-dist')

const outFlag = process.argv.indexOf('--out')
const outVsix = outFlag !== -1 && process.argv[outFlag + 1]
  ? path.resolve(process.argv[outFlag + 1])
  : process.argv.find((arg) => arg.startsWith('--out='))
    ? path.resolve(process.argv.find((arg) => arg.startsWith('--out=')).slice('--out='.length))
    : undefined

if (!existsSync(path.join(root, 'out', 'pdfExecutor', 'extension.js'))) {
  console.error('缺少 out/pdfExecutor/extension.js——先 npm run compile')
  process.exit(1)
}

/** 字典装载（genNls 同款：TS → ESM 内存产物，data URL import） */
async function loadDicts() {
  const result = await esbuildBuild({
    stdin: {
      contents: [
        'export { en } from "./src/shared/locales/en.ts"',
        'export { zhCn } from "./src/shared/locales/zh-cn.ts"',
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'executorNlsSources.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text, 'utf8').toString('base64')}`)
}

function nlsOf(dict, keys) {
  const out = {}
  for (const key of keys) {
    const value = dict[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`字典缺少执行端清单词条：${key}（先入 src/shared/locales 再打包）`)
    }
    out[key] = value
  }
  return out
}

const EXECUTOR_MANIFEST_KEYS = ['manifest.displayName', 'manifest.description']

async function main() {
  const { en, zhCn } = await loadDicts()
  const mainPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const template = JSON.parse(readFileSync(path.join(root, 'src', 'pdfExecutor', 'package.json'), 'utf8'))
  const pkg = { ...template, version: mainPkg.version }

  rmSync(dist, { recursive: true, force: true })
  mkdirSync(path.join(dist, 'out'), { recursive: true })
  mkdirSync(path.join(dist, 'media'), { recursive: true })
  writeFileSync(path.join(dist, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  writeFileSync(path.join(dist, 'package.nls.json'), `${JSON.stringify(nlsOf(en, EXECUTOR_MANIFEST_KEYS), null, 2)}\n`, 'utf8')
  writeFileSync(path.join(dist, 'package.nls.zh-cn.json'), `${JSON.stringify(nlsOf(zhCn, EXECUTOR_MANIFEST_KEYS), null, 2)}\n`, 'utf8')
  copyFileSync(path.join(root, 'out', 'pdfExecutor', 'extension.js'), path.join(dist, 'out', 'extension.js'))
  copyFileSync(path.join(root, 'media', 'vsidian-icon-256.png'), path.join(dist, 'media', 'vsidian-icon-256.png'))
  // vsce 会读 README/CHANGELOG（缺席即可；README 文案取字典双语拼装——
  // 面向用户的文字不硬编码）
  const readmeBody = (dict) => dict['executor.readme.body']
  writeFileSync(path.join(dist, 'README.md'), [
    '# Vsidian PDF Export Executor',
    '',
    readmeBody(en),
    '',
    readmeBody(zhCn),
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(dist, '.vscodeignore'), ['**/*.map', 'README.md'].join('\n'), 'utf8')

  // vsce 不在 devDependencies（release.mjs 同款：npx 按需拉取）；-o 经
  // shell 转发不可靠——统一产到 dist 再复制（Windows 路径引用由 copy 承担）
  const vsce = spawnSync('npx @vscode/vsce package --no-dependencies',
    { cwd: dist, encoding: 'utf8', timeout: 300_000, shell: true })
  if (vsce.status !== 0) {
    console.error(`vsce package 失败（${vsce.status}）：${vsce.stdout}\n${vsce.stderr}`)
    process.exit(1)
  }
  // vsce 产到 dist 内——复制到目标（默认 out/ 的版本化命名；--out 覆盖）
  const produced = readdirSync(dist).filter((name) => name.toLowerCase().endsWith('.vsix'))
  if (produced.length !== 1) {
    console.error(`打包产物定位失败：dist 内 .vsix 数量 ${produced.length}`)
    process.exit(1)
  }
  const versioned = outVsix ?? path.join(root, 'out', `vsidian-pdf-executor-${mainPkg.version}.vsix`)
  copyFileSync(path.join(dist, produced[0]), versioned)
  console.log(`执行端 VSIX 就绪：${versioned}`)
  console.log(vsce.stdout.trim())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
