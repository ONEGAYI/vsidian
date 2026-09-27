import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { runSuites } from './runner.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 保留原 test:browser 的全部 16 个脚本；长套件优先启动。
// #121 合并入列：listEditing（29 场景）与 tabIndent（22 场景）按长度
// 插在 taskClick 之后、outline 系列之前。
// #129 合并入列：cssSnippetImports（依赖导入/相对资源/循环/缓存实验）紧随
// cssSnippets。
const names = ['tableCaret', 'taskClick', 'listEditing', 'tabIndent', 'outlineJump', 'outlineCollapse', 'outlineHover',
  'outlineSearch', 'outlineMenu', 'outlineDrag', 'outlineDragBoundary', 'settingsPage',
  'languageSwitch', 'quickActions', 'cssSnippets', 'cssSnippetImports', 'mermaidPaint', 'graphicPopup', 'keybindings', 'keybindingEditor', 'obsidianAlias']
let workers = 2, reuseBuilds = true, selected = names
for (const arg of process.argv.slice(2)) {
  if (/^--workers=\d+$/.test(arg)) workers = Number(arg.slice('--workers='.length))
  else if (arg === '--no-reuse') reuseBuilds = false
  else if (arg.startsWith('--suite=')) selected = arg.slice('--suite='.length).split(',')
  else throw new Error(`未知参数: ${arg}`)
}
if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('--workers 范围为 1..16')
if (new Set(selected).size !== selected.length || selected.some(name => !names.includes(name))) {
  throw new Error(`--suite 必须是不重复的套件名，可选: ${names.join(',')}`)
}
const parent = path.join(root, 'out/test/browser-runs')
await mkdir(parent, { recursive: true })
const reportDir = await mkdtemp(path.join(parent, 'run-'))
console.log(`浏览器报告: ${reportDir}`)
const abort = new AbortController()
const cancel = () => abort.abort()
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
const report = await runSuites({ root, workers, reuseBuilds, reportDir,
  signal: abort.signal,
  suites: selected.map(name => ({ name, script: path.join(root, 'test/browser', `${name}.mjs`) })) })
process.off('SIGINT', cancel)
process.off('SIGTERM', cancel)
for (const suite of report.suites) console.log(`[${suite.status}] ${suite.name}: ${(suite.durationMs / 1000).toFixed(2)}s`)
console.log(`总耗时 ${(report.durationMs / 1000).toFixed(2)}s；EXIT=${report.exitCode}`)
process.exitCode = report.exitCode
