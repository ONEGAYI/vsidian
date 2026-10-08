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
// #296 渲染断裂修复合入列：blockquoteTablePaint（引用/列表/多层/无边界
// 表格的 grid 布局绘制断言——同行格同水平带、列序、竖条计算值；防
// elementFromPoint 存在性断言抓不住布局错位的盲区）紧随 tableCaret。
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
// P2-04 合并入列：embedLive（嵌入内部 Live——端口绑定/真实键入只写目标/
// Ctrl+S 焦点路由/撤销走 B 历史/模式继承与覆盖记忆/编辑器无泄漏，B 侧用
// 真实 DocumentSession 驱动）紧随 refCombination。
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
// P2-08 合入列：tableCellLive（表格格内嵌入的内部 Live——格内继承/真实
// 键盘隔离/列行移动不误伤实例与端口/删行拦截/变高联动/离屏重挂）紧随
// embedLiveMixed（同嵌入内部 Live 族）。
// P2-09 合入列：recursiveLive（递归引用直接父模式与逐层目标编辑——B 内
// 部 Live 编辑器挂孙卡〔独占行/混排/格内〕、孙卡独立端口、在 C 键入只写
// C、父根切换不覆写手动、循环截断与编辑器移交）紧随 tableCellLive。
// main 合入列（PR #314）：plainPaste/richPaste/richPasteUndo/
// richPasteCompatibility（富文本粘贴/分步撤销族）紧随 imagePaste。
// 三期 #343 合入列：webPageView（外链原网页形态——受控可嵌入站点真实
// iframe 内容可见与滚轮滚动、退回矩阵、恶意子页消息注入丢弃、设置联动
// 销毁）紧随 webLinkCard（同外链悬停族）。
const names = ['textHover', 'tableCaret', 'blockquoteTablePaint', 'quoteBarPaint', 'taskClick', 'frontmatterTable', 'listEditing', 'tabIndent', 'symbolInput', 'wordMotion', 'imagePaste', 'plainPaste', 'richPaste', 'richPasteUndo', 'richPasteCompatibility', 'outlineJump', 'outlineCollapse', 'outlineHover',
  'outlineSearch', 'outlineMenu', 'outlineDrag', 'outlineDragBoundary', 'settingsPage', 'settingsPageRestore',
  'skeletonProbe', 'tooltipCard',

  'languageSwitch', 'quickActions', 'cssSnippets', 'cssSnippetImports', 'cssHttpsImports', 'mermaidPaint', 'graphicPopup', 'keybindings', 'keybindingEditor', 'obsidianAlias', 'chromeContract', 'commentToggle', 'viewToggle', 'contextMenu', 'anchorFlash', 'readingWidthProbe', 'readingBottomReach', 'codeCardChrome', 'liveImageLayout', 'imageEmbedParity', 'imageRefresh', 'imagePopup', 'hoverPreview', 'webLinkCard', 'webPageView', 'hoverRecursive', 'readingEmbed', 'recursiveEmbed', 'liveEmbed', 'hoverEntry', 'hoverRefresh', 'targetTip', 'multicursor', 'multicursorWrite', 'findPanel', 'occurrence', 'hitReveal', 'findBarAnchor', 'mixedEmbed', 'liveEmbedMixed', 'tableEmbed', 'refCombination', 'embedLive', 'embedLiveActions', 'embedLiveMixed', 'hoverLive', 'tableCellLive', 'embedLiveResources', 'recursiveLive', 'embedLiveCloseout',
  // #337（P3-05）PDF 悬停首条闭环：紧随 hoverLive（同悬停族——真实 pdfjs 装配与 canvas 绘制层断言）
  'hoverPdf',
  // #341（P3-09）文本嵌入容器矩阵：紧随嵌入族（textHover 之后的嵌入侧消费）
  'textEmbed',
  // #338（P3-06）PDF 全文滚动与正文嵌入：容器矩阵 + 双 occurrence 共享 + 窗口回收
  'embedPdf',
  // #339（P3-07）PDF 适合宽度/缩放/文本选择/链接：紧随 hoverPdf/embedPdf（同 PDF 族
  // ——真实 TextLayer 对齐/选区/缩放重绘/链接矩阵与零写回）
  'pdfZoomCopyLinks',
  // #376（T01）双链文件联想候选：紧随 symbolInput（同输入族——真实键盘/IME
  // 驱动、宿主应答由夹具回灌、候选浮层与键位行为）
  'wikilinkSuggest',
  // V02（#349）附加组件页面 SDK：生产控制器 + 装载器原型（真实键盘/CDP
  // IME 驱动首键与组合、绘制层标记、卸载与迟回执拒收、未授权入口拒绝）
  'addonPageSdk',
  // #353（T04）附加组件基础设置区：生产设置页入口（真实键盘/点击驱动
  // 双标签作用范围、标量/数组/对象基础控件、清除覆盖与保存反馈；标签
  // 选中态与失败提示的绘制层断言）紧随 addonPageSdk（同附加组件族）
  'addonSettings',
  // #354 T05：侧栏三组与故障排障（绘制层断言）+ 开关热切换 IME 收尾
  // （CDP composition 驱动，复用 addonPageSdkFixture 生产链路）
  'addonSidebar',
  'addonHotSwitch',
  // T08（#357）：行为冲突管理（注册行为调序/逐项开关——真实键盘 + 绘制层）
  'addonT08BehaviorsManage',
  // #359 T10：组件命令/菜单/统一快捷键（生产命令注册表装配——真实键盘
  // 默认绑定/绑定/清空、真实右键组件簇菜单与点击执行、宿主转发路径、
  // 停用回收）紧随附加组件族
  'addonT10Commands',
  // #358 T09 渲染提供者自动接管：真实浏览器绘制层（接管/热切换/迟到结果/弹窗取图）
  'addonRendererTakeover',
  // #360 T11：组件按钮/面板与视图界面贡献（生产界面运行时装配——真实
  // 点击经 target 句柄提交、悬停提示与键位徽章、面板开闭与迟到结果、
  // 模式回收与卸载回收、内置工具栏不受影响）紧随附加组件族
  'addonT11Ui',
  // #413（#409 T02）标题折叠键位：注册表五操作默认键真实路由——美式
  // 布局 Ctrl+Shift+[ / ]（事件字符 { }，keyStep shift 上档符号映射的
  // 端到端验证）、Ctrl+K 弦族、零写回与阅读模式不接管（绘制层断言属
  // #414 T03 paint 探针）
  'headingFoldKeys']
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
