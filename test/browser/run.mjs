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
// #161 合并入列：imagePaste（ClipboardEvent 剪贴板注入的图片粘贴拦截回归）。
// #162 blockMenu 已随 #183 退役，场景并入 contextMenu。
// #201 合并入列：imageRefresh（失效重发像素替换、删除/不可访问可见态、代次守卫、
// 唤醒核验与尺寸变化的视口稳定）。
// #174/#175 合并入列：readingWidthProbe（可读行宽双模式铺满/限宽居中/
// 行号列随列/侧栏避让/片段优先序/宽块钳制——bug 修复回归本体）。
// #259 合并入列：readingBottomReach（长文档滚轮滚动到底——漂移重估不
// 覆写已实测块、末尾意图保持，恒差修复回归本体）紧随 readingWidthProbe。
// #189/#190/#191 合并入列：codeCardChrome（代码块卡片绘制层——围栏
// 真实对齐、head 按钮换位与整卡恒显、折行开关与续行悬挂缩进）。
// live SVG 塌缩修复入列：liveImageLayout（独立成行图片布局——viewBox-only
// 百分比宽 SVG 铺满正文列、固有尺寸不拉伸、限宽联动、阅读非回归）。
// #212 合并入列：imagePopup（图片弹窗与防误触——悬停按钮组、吞点击、
// 弹窗缩放平移/刷新/导出消息、阅读单钮与排除项）紧随 imageRefresh。
// #223 合并入列：liveEmbed（父文档 Live 嵌入——光标驱动源码显隐、IME
// 修改引用、未闭合撤卡恢复、内部选区隔离与绘制断言）紧随 readingEmbed。
// #224 合并入列：hoverRefresh（引用视图同步——目标失效推送驱动嵌入/浮层
// 刷新、fm/滚动保持、快速更新无旧冒充、删除恢复分态与订阅生命周期）。
// #239 合并入列：wordMotion（中文分词词级移动——Ctrl+方向真实键盘、
// 拉丁回归、Intl 动态边界步进、jieba 注入、表格格导航共存）。
// #237 合并入列：multicursor（多光标基础设施——Alt+点击三场景、
// Ctrl+Alt+方向键、Esc 收敛、键位所有权与设置开关的绘制层证据）。
// #236 合并入列：findPanel（查找面板——真实键盘 Ctrl+F/Ctrl+H/Enter/Esc，
// 三开关语义与点亮、非法正则红边、替换写回单笔/整批一笔、阅读替换栏不展开）。
// #238 合并入列：occurrence（选下一处相同词——真实键盘 Ctrl+D 连按与
// wrap、Ctrl+K Ctrl+D 两段弦、Ctrl+Shift+L 全选与多光标编辑回流、
// 选项条点击切换重建会话与 Esc 两段层级，非模态与绘制层证据）。
// #251 合并入列：hitReveal（命中显形——真实键盘搜索/Ctrl+D 命中落在
// grid 行与分隔行回源、关面板恢复与停驻、块级公式回源、编辑选区硬边界）
// 紧随 occurrence（同查找/选词族）。
// #245 合并入列：hoverRecursive（悬停根与内层来源、独立滚轮、异步定位、
// 键盘焦点和面板 openAction 的原生 Chromium 回归）。
// 2026-10 合并入列：findBarAnchor（浮层锚点跟随——查找面板与选词选项条
// 右缘动态咬合正文列右缘：限宽/铺满/侧栏开合/模式切换/窗口缩放几何），
// 紧随 hitReveal（同查找/选词族）。
const names = ['tableCaret', 'quoteBarPaint', 'taskClick', 'frontmatterTable', 'listEditing', 'tabIndent', 'symbolInput', 'wordMotion', 'imagePaste', 'outlineJump', 'outlineCollapse', 'outlineHover',
  'outlineSearch', 'outlineMenu', 'outlineDrag', 'outlineDragBoundary', 'settingsPage',
  'skeletonProbe',
  'languageSwitch', 'quickActions', 'cssSnippets', 'cssSnippetImports', 'cssHttpsImports', 'mermaidPaint', 'graphicPopup', 'keybindings', 'keybindingEditor', 'obsidianAlias', 'chromeContract', 'commentToggle', 'viewToggle', 'contextMenu', 'anchorFlash', 'readingWidthProbe', 'readingBottomReach', 'codeCardChrome', 'liveImageLayout', 'imageRefresh', 'imagePopup', 'hoverPreview', 'hoverRecursive', 'readingEmbed', 'recursiveEmbed', 'liveEmbed', 'hoverEntry', 'hoverRefresh', 'multicursor', 'multicursorWrite', 'findPanel', 'occurrence', 'hitReveal', 'findBarAnchor', 'mixedEmbed', 'liveEmbedMixed', 'tableEmbed', 'refCombination']
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
