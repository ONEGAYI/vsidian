import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { parseBrowserRunOptions, runSuites } from './runner.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// 保留原 test:browser 的全部脚本；长套件优先启动。
// #121 合并入列：listEditing（29 场景）与 tabIndent（22 场景）按长度
// 插在 taskClick 之后、outline 系列之前。
// #123 合并入列：symbolInput 按长度插在 tabIndent 之后；#124/#125 把该
// 套件扩至 50 场景（选区包裹与围栏内 Tab 越界，场景数以套件输出为准）。
// #129 合并入列：cssSnippetImports（依赖导入/相对资源/循环/缓存实验）紧随
// cssSnippets。
// #130 合并入列：cssHttpsImports（HTTPS 导入/联网字体/受控 https 服务）。
// #133 合并入列：chromeContract（界面域样式契约探针）紧随 obsidianAlias。
// #143 合并入列：quoteBarPaint（引用竖条双视图 × 明暗主题绘制层）紧随
// tableCaret（同批次 C 组渲染与样式侧套件）。
// #140 合并入列：frontmatterTable（真实键鼠输入回流与结构按钮）紧随 taskClick。
// #139 合并入列：commentToggle（HTML 注释 Ctrl+/ 两态、淡化绘制与阅读隐藏）。
// #141 合并入列：viewToggle（工具栏双态切换按钮与 Ctrl+Q 快捷键入口）。
const names = ['tableCaret', 'quoteBarPaint', 'taskClick', 'frontmatterTable', 'listEditing', 'tabIndent', 'symbolInput', 'outlineJump', 'outlineCollapse', 'outlineHover',
  'outlineSearch', 'outlineMenu', 'outlineDrag', 'outlineDragBoundary', 'settingsPage',
  'languageSwitch', 'quickActions', 'cssSnippets', 'cssSnippetImports', 'cssHttpsImports', 'mermaidPaint', 'graphicPopup', 'keybindings', 'keybindingEditor', 'obsidianAlias', 'chromeContract', 'commentToggle', 'viewToggle']
const { workers, reuseBuilds, selected } = parseBrowserRunOptions(process.argv.slice(2), names)
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
