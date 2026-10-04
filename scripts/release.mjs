// 发布脚本：CHANGELOG 最新段落提取 → VSIX 打包 → 包内容与体积检查 →
// （--upload）创建 GitHub Release 并附带 VSIX。
//
//   node scripts/release.mjs            # 打包 + 检查（日常本地可跑）
//   node scripts/release.mjs --upload   # 以上 + gh release create 附带 VSIX
//
// 约定见项目技能 release（.agents/skills/release/SKILL.md）：VSIX 体积严格控制，检查器是发布前的
// 最后一道闸（.vscodeignore 挡打包输入，这里挡最终产物），失败即非零退出。
// 纯函数（extractLatestChangelog / parseUnzipListing / inspectVsixEntries）
// 由 test/release/release.test.mjs 以 node --test 契约测试钉住。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SIZE_LIMITS = {
  // 解压总体积：#59 KaTeX 后基线约 1.05 MB，#60 加入 mermaid.js 独立产物
  // （约 2.60 MB）后基线约 4.1 MB，#78-85 代码块高亮（Lezer 语言表）后
  // 基线约 4.45 MB（首次上调），v0.5.0（样式参考 HTML/JSON 入包 + 设置页
  // 刷新）后基线约 5.44 MB——距警告线 5.5 MB 仅约 66 KB，两条线各上调
  // 1 MB；v0.8.0 批次（查找引擎、悬停预览、文档嵌入与中文分词）后基线
  // 约 6.54 MB，距警告线 6.5 MB 仅约 109 KB，用户决策两条线各上调 2 MB；
  // #337（P3-05）PDF 引擎随包（pdfjs-dist 6.4.299 双产物 + cmaps/字体/
  // wasm/icc 资产，#334 探针核算注入约 4.0 MB）后基线约 10.8 MB，超原
  // 失败线 9.5 MB 约 1.28 MB——2026-10-04 用户裁决：依赖资产本地随包并
  // 上调阈值（失败线 9.5→11.5 MB、警告线 8.5→11.0 MB，单文件不动——
  // pdfWorker.js minified 约 1.23 MB 距 3 MB 警告线余量充足）；防"意外
  // 塞进大文件"的语义不变。
  totalWarnBytes: 11.0 * 1024 * 1024,
  totalMaxBytes: 11.5 * 1024 * 1024,
  // 一般单文件：mermaid.js（刻意 vendored 的独立产物，minify 后实测
  // 2,727,077 B ≈ 2.60 MB）是最大单项，警告线 3 MB 在其上留小余量、
  // 失败线 4 MB 拦截意外超大文件（如误升 mermaid 12.x 的 5.3 MB 产物）。
  // 主 bundle（main.js，含 CM6 + KaTeX 与 Lezer 语言表，v0.5.0 实测约
  // 1.65 MB，v0.8.0 加入查找引擎、悬停预览、嵌入与分词后约 1.94 MB）
  // 不触发单文件警告——其增长由总量线约束，属已接受取舍。
  fileWarnBytes: 3 * 1024 * 1024,
  fileMaxBytes: 4 * 1024 * 1024,
  // 图标专项：Marketplace 展示只需 256×256，35 KB 已足够，百 KB 级即异常。
  iconMaxBytes: 100 * 1024,
}

// 必需清单：VSIX 根结构文件 + extension/ 下运行时资产。README / LICENSE /
// CHANGELOG 由 vsce 自动打入且大小写形态随版本变化（实测 readme.md 小写），
// 统一按小写 basename 匹配。
const REQUIRED_ROOT = ['extension.vsixmanifest', '[content_types].xml']
const REQUIRED_EXTENSION = [
  'package.json',
  'package.nls.json',
  'package.nls.zh-cn.json',
  'readme.md',
  'changelog.md',
  'license', // 实测形态为 LICENSE.txt，前缀匹配兜底
  'out/extension.js',
  // #340（P3-08）oniguruma WASM（vscode-textmate 引擎的运行时二进制资产，
  // esbuild 复制到 out/；缺失时文本悬停语法层降级纯文本呈现）
  'out/onig.wasm',
  'out/webview/main.js',
  'out/webview/main.css',
  'out/webview/settings.js',
  'out/webview/settings.css',
  // #60 Mermaid 独立产物（按需懒加载的渲染器；缺失时图表降级为错误态）
  'out/webview/mermaid.js',
  // #337 PDF 双产物（pdfjs-dist@6.4.299 legacy 主库 + worker；缺失时 PDF
  // 悬停预览如实分态 load-failed，不静默空白）
  'out/webview/pdfmain.js',
  'out/webview/pdfworker.js',
  'media/css-contract-probe.css',
  // #145 契约 JSON（AI 可读的机器清单，与 HTML/数据模块同源生成）：
  // 设置页「导出 JSON」与命令面板导出的即此文件字节——缺失时导出报
  // 「安装不完整」。（同目录的 style-reference.html 自 2026-09 起不再
  // 随包：无运行时加载方，设置页走 settings.js 内置数据模块，仓库产物
  // 继续生成供契约检查器 guide-consistency 校验。）
  'media/style-reference/style-reference.json',
]

// #59 KaTeX 字体（仅 woff2，esbuild assetNames 稳定命名无 hash）：缺失任一
// 都会导致公式回落系统字体，逐文件登记精确拦截。
const KATEX_FONT_FAMILIES = [
  'KaTeX_AMS-Regular',
  'KaTeX_Caligraphic-Bold',
  'KaTeX_Caligraphic-Regular',
  'KaTeX_Fraktur-Bold',
  'KaTeX_Fraktur-Regular',
  'KaTeX_Main-Bold',
  'KaTeX_Main-BoldItalic',
  'KaTeX_Main-Italic',
  'KaTeX_Main-Regular',
  'KaTeX_Math-BoldItalic',
  'KaTeX_Math-Italic',
  'KaTeX_SansSerif-Bold',
  'KaTeX_SansSerif-Italic',
  'KaTeX_SansSerif-Regular',
  'KaTeX_Script-Regular',
  'KaTeX_Size1-Regular',
  'KaTeX_Size2-Regular',
  'KaTeX_Size3-Regular',
  'KaTeX_Size4-Regular',
  'KaTeX_Typewriter-Regular',
]
const REQUIRED_KATEX_FONTS = KATEX_FONT_FAMILIES.map(
  (family) => `out/webview/assets/${family}.woff2`,
)
// 快速操作条与查找面板 CSS 引用的明暗主题 SVG，经 esbuild file loader
// 从 media/quick-actions 制作源搬入 out/webview/assets；全部是运行必需项。
// #105/#106 起新增 highlight 与 horizontalRule 两键。
const QUICK_ACTION_ICON_KEYS = [
  'bold', 'italic', 'strikethrough', 'inlineCode', 'heading',
  'bulletList', 'orderedList', 'taskList', 'quote', 'codeBlock',
  'link', 'clearInline', 'table', 'inlineMath', 'blockMath',
  'highlight', 'horizontalRule',
  // #185 右键菜单图标接入同一图标集（部分复用上列既有键，此处为新增键）
  'normalText', 'textFormat', 'paragraphStyle', 'comment',
  'externalLink', 'cut', 'copy', 'paste', 'selectAll', 'insertPlus',
  // #305–#308 粘贴纯文本（右键菜单剪贴板簇）
  'pastePlain',
  // #236 查找面板六键（0.7.0 后未发布批次引入，此前发布检查未跑过）
  'findPrev', 'findNext', 'findClose', 'replaceOne', 'replaceAll', 'findInSelection',
  // 2026-10 查找面板替换栏切换 chevron（Pen 直绘）
  'chevronRight',
  // #337 顺带补登记（#334 探针报告 6.2 节记录的 main 既有缺口：引用视图
  // 设置组的跳转目标提示两枚生图资产未同步 REQUIRED——上次发布后新增批
  // 次的资产漏登记，非本票新增）
  'pointerLink', 'dbLink',
  // #265 设置页二级标题组的两枚生图资产
  'typewriter', 'wordSegment',
]
const REQUIRED_QUICK_ACTION_SVGS = ['light', 'dark'].flatMap((theme) =>
  QUICK_ACTION_ICON_KEYS.map((key) => `out/webview/assets/${theme}-${key}.svg`),
)
const REQUIRED_RUNTIME_FILES = [
  ...REQUIRED_EXTENSION,
  ...REQUIRED_KATEX_FONTS,
  ...REQUIRED_QUICK_ACTION_SVGS,
]

// #337（P3-05）PDF 资产目录前缀白名单：cmaps/standard_fonts/wasm/iccs
// 共数百文件（PDF.js 内建文件名，逐文件登记不可维护），按目录前缀放行。
// 例外范围之外（pdfjs/ 根下散置文件、其他 out/ 未登记产物）仍按白名单
// 拒绝——新增 PDF.js 资产目录须同步此处
const ALLOWED_OUT_PREFIXES = [
  'extension/out/webview/pdfjs/cmaps/',
  'extension/out/webview/pdfjs/standard_fonts/',
  'extension/out/webview/pdfjs/wasm/',
  'extension/out/webview/pdfjs/iccs/',
]

// 禁止模式：仓库管理与开发文件一律不得进入 VSIX（大小写不敏感）。
const FORBIDDEN_PATTERNS = [
  [/^extension\/\.github\//, 'GitHub 平台配置'],
  [/\/\.git(\/|$)/, '.git 目录'],
  [/node_modules/, 'node_modules'],
  [/^extension\/src\//, 'TypeScript 源码'],
  [/^extension\/test\//, '测试'],
  [/^extension\/docs\//, '项目文档'],
  [/^extension\/scripts\//, '构建脚本'],
  [/^extension\/media\/quick-actions\//, '快速操作图标制作源'],
  [/\.map$/, 'sourcemap'],
  [/\.tsx?$/, 'TypeScript 源文件'],
  [/package-lock\.json$/, 'npm lockfile'],
  [/readme\.en\.md$/, '英文 README（仅 GitHub 展示）'],
  [/\.vsix$/, 'VSIX 嵌套'],
  // 评审 C7：webview 目标 chrome118 只需 woff2——出现 woff/ttf 即字体
  // 裁剪失效（如 katex 升级改动 CSS src 格式使裁剪正则失配），体积闸
  // 只给警告不可靠，硬错误拦截。
  [/\.woff$/, '非 woff2 字体（字体裁剪失效，webview 仅需 woff2）'],
  [/\.ttf$/, 'TTF 字体（字体裁剪失效，webview 仅需 woff2）'],
]

/** #337 禁止模式例外：PDF.js standard_fonts 内建 4 个 LiberationSans .ttf
 *  （PDF.js 按文件名引用，禁止改名或转格式；.ttf 禁止模式的语义是
 *  「KaTeX 字体裁剪失效信号」，与 pdfjs 字体是两回事——#334 探针结论）。
 *  例外仅作用于 pdfjs 资产目录内的文件，KaTeX 侧 ttf 回潮照拦 */
function isPdfjsAssetException(lowerName) {
  return lowerName.startsWith('extension/out/webview/pdfjs/standard_fonts/') ||
    lowerName.startsWith('extension/out/webview/pdfjs/cmaps/') ||
    lowerName.startsWith('extension/out/webview/pdfjs/wasm/') ||
    lowerName.startsWith('extension/out/webview/pdfjs/iccs/')
}

/** 解析 `unzip -l` 输出为条目列表（name 含 `extension/` 前缀）。 */
export function parseUnzipListing(text) {
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+(.+)$/)
    if (m) entries.push({ size: Number(m[1]), name: m[2].trim() })
  }
  return entries
}

/** 列出 zip 内容；优先 unzip（CI Linux / Git Bash），Windows 回退 PowerShell。 */
function listZipEntries(vsixPath) {
  const unzip = spawnSync('unzip', ['-l', vsixPath], { encoding: 'utf8' })
  if (unzip.status === 0 && unzip.stdout) return parseUnzipListing(unzip.stdout)
  if (process.platform === 'win32') {
    const ps = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      "$z=[System.IO.Compression.ZipFile]::OpenRead($args[0])",
      "foreach($e in $z.Entries){ Write-Output ($e.Length.ToString() + \"`t\" + $e.FullName) }",
      '$z.Dispose()',
    ].join('; ')
    const out = spawnSync('powershell', ['-NoProfile', '-Command', ps, vsixPath], { encoding: 'utf8' })
    if (out.status !== 0) throw new Error(`无法读取 VSIX 内容：${out.stderr || 'unzip 与 PowerShell 均失败'}`)
    return out.stdout.split(/\r?\n/).filter((l) => l.includes('\t')).map((l) => {
      const [size, ...rest] = l.split('\t')
      return { size: Number(size), name: rest.join('\t') }
    })
  }
  throw new Error(`无法读取 VSIX 内容：${unzip.stderr || 'unzip 不可用'}`)
}

/**
 * 合并段内软换行：CHANGELOG 源文件的条目折行原样进入 GitHub Release
 * 说明后，渲染时断成锯齿短行并在中文行间并入空格——发布说明的消费方
 * 是网页。空行、列表项、标题、引用与编号列表等结构边界保留换行；其余
 * 行拼接到上一行，拼接双方都是 ASCII 字母/数字时补一个空格，CJK 相接
 * 直接拼接。HTML 注释块（CHANGELOG 尾部的变更链接区）整体原样保留。
 */
export function mergeSoftWraps(body) {
  const out = []
  let inComment = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (inComment) {
      out.push(line)
      if (line.includes('-->')) inComment = false
      continue
    }
    if (line.includes('<!--') && !line.includes('-->')) {
      inComment = true
      out.push(line)
      continue
    }
    if (line === '' || /^([-*+]|\d+[.)])\s/.test(line) || /^#{1,6}\s/.test(line) || /^>/.test(line)) {
      out.push(line)
      continue
    }
    const prev = out[out.length - 1]
    if (prev === undefined || prev === '') {
      out.push(line)
    } else {
      // 拼接点补空格的判据：ASCII 词界与中英混排边界（两个方向）都留
      // 一个空格；CJK 相接与任一侧标点直接拼接。
      const ascii = /[A-Za-z0-9]/
      const cjk = /[\u3400-\u4dbf\u4e00-\u9fff]/
      const prevEnd = prev[prev.length - 1]
      const firstChar = line[0]
      const needSpace =
        (ascii.test(prevEnd) && ascii.test(firstChar)) ||
        (cjk.test(prevEnd) && ascii.test(firstChar)) ||
        (ascii.test(prevEnd) && cjk.test(firstChar))
      out[out.length - 1] = needSpace ? `${prev} ${line}` : prev + line
    }
  }
  return out.join('\n')
}

/**
 * 提取 CHANGELOG.md 最新版本段落。
 * 顶部常驻的 `## Unreleased` 开发段跳过（只认 `## x.y.z` 版本段）——发版
 * 提交可同时完成「Unreleased 转正 + 重建空 Unreleased」，发布说明不再混入
 * 开发中内容，与 styleContractCheck.parseChangelogReleases 同一跳过语义。
 * @throws 最新版本段落与 expectedVersion 不符、或找不到版本段落时抛错。
 */
export function extractLatestChangelog(content, expectedVersion) {
  const lines = content.split(/\r?\n/)
  let start = -1
  let version = null
  let date = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (\[?[^\s\]]+\]?)\s*(?:-\s*(.*))?$/)
    if (!m) continue
    const token = m[1].replace(/^\[|\]$/g, '')
    if (!/^\d+\.\d+\.\d+$/.test(token)) continue
    start = i
    version = token
    date = (m[2] || '').trim() || null
    break
  }
  if (start < 0) throw new Error('CHANGELOG.md 中未找到任何 `## <版本>` 段落')
  if (version !== expectedVersion) {
    throw new Error(`CHANGELOG 最新段落为 ${version}，与 package.json 的 ${expectedVersion} 不一致`)
  }
  const bodyEnd = lines.findIndex((l, i) => i > start && /^## /.test(l))
  const body = lines.slice(start + 1, bodyEnd < 0 ? lines.length : bodyEnd).join('\n').trim()
  return { version, date, body: mergeSoftWraps(body) }
}

/**
 * 检查 VSIX 条目：必需项齐全、无禁止文件、体积在阈值内。
 * @param {{size:number,name:string}[]} entries VSIX 内全部条目
 * @param {{iconPath?:string}} options package.json 的 icon 相对路径
 * @returns {{ok:boolean,errors:string[],warnings:string[],totalBytes:number}}
 */
export function inspectVsixEntries(entries, options = {}) {
  const errors = []
  const warnings = []
  const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)
  const lowerNames = entries.map((e) => e.name.toLowerCase())

  for (const root of REQUIRED_ROOT) {
    if (!lowerNames.includes(root)) errors.push(`缺少结构文件 ${root}`)
  }
  for (const rel of REQUIRED_RUNTIME_FILES) {
    if (rel === 'license') {
      const hit = lowerNames.some((n) => /^extension\/license(\.txt)?$/.test(n))
      if (!hit) errors.push('缺少 LICENSE（打包后应为 extension/LICENSE*）')
    } else if (!lowerNames.includes(`extension/${rel.toLowerCase()}`)) {
      errors.push(`缺少运行时资产 extension/${rel}`)
    }
  }

  // out/ 白名单（评审 C1）：上面只拦「缺」，这里拦「多」——out/ 下任何
  // 未登记文件（调试遗留、构建实验产物、裁剪失效的重复字体）一律拒绝，
  // 避免「REQUIRED 不含即静默混入包内」（v0.1.0 后曾实测发生 out/ 杂物
  // 混入打包输入且旧检查不拦）。新增运行时产物须同步登记 REQUIRED_EXTENSION；
  // #337 PDF 资产目录（pdfjs/ 下数百内建文件名）按前缀放行。
  const allowedOut = new Set(REQUIRED_RUNTIME_FILES.map((rel) => `extension/${rel.toLowerCase()}`))
  for (const e of entries) {
    const lower = e.name.toLowerCase()
    if (lower.startsWith('extension/out/') && !allowedOut.has(lower) &&
      !ALLOWED_OUT_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      errors.push(`out/ 未登记产物 ${e.name}（新资产须登记 REQUIRED_EXTENSION）`)
    }
  }

  // 顶层白名单（2026-10 实证 .zcode、.codex-remote-attachments 与历史发布
  // 日志混入包内且黑名单模式拦不住——git 忽略不等于 vsce 排除）：extension/
  // 下只允许已知顶层目录与文件，未知顶层条目一律拒绝。新增根级运行时资产
  // 须同步登记此处；本地工具产物应进 .vscodeignore 排除而非白名单。
  const allowedTop = new Set([
    'out',
    'media',
    'package.json',
    'package.nls.json',
    'package.nls.zh-cn.json',
    'readme.md',
    'changelog.md',
    'license.txt',
    'license',
  ])
  for (const e of entries) {
    if (!/^extension\//i.test(e.name)) continue // 结构文件（vsixmanifest / Content_Types）由 REQUIRED_ROOT 把关
    const rel = e.name.slice('extension/'.length).toLowerCase()
    if (!rel) continue
    const top = rel.split('/')[0]
    if (!allowedTop.has(top)) {
      errors.push(`未知顶层条目 ${e.name}（新根级资产须登记白名单；本地工具/日志应进 .vscodeignore 排除）`)
    }
  }

  for (const e of entries) {
    // #337：PDF.js 资产目录内的文件不跑禁止模式（standard_fonts 的内建
    // .ttf、wasm 目录的 .wasm 等均系 PDF.js 按文件名引用的必要资产——
    // 见 isPdfjsAssetException 注释）；KaTeX 侧 ttf 回潮仍照拦
    if (isPdfjsAssetException(e.name.toLowerCase())) {
      continue
    }
    for (const [pattern, label] of FORBIDDEN_PATTERNS) {
      if (pattern.test(e.name.toLowerCase())) errors.push(`禁止文件 ${e.name}（${label}）`)
    }
  }

  if (options.iconPath) {
    const icon = entries.find((e) => e.name.toLowerCase() === `extension/${options.iconPath.toLowerCase()}`)
    if (!icon) errors.push(`缺少图标 extension/${options.iconPath}`)
    else if (icon.size > SIZE_LIMITS.iconMaxBytes) {
      errors.push(`图标 ${icon.name} 为 ${icon.size} 字节，超过 ${SIZE_LIMITS.iconMaxBytes}（应 ≤256×256）`)
    }
  }

  if (totalBytes > SIZE_LIMITS.totalMaxBytes) errors.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过上限 ${SIZE_LIMITS.totalMaxBytes / 1048576} MB`)
  else if (totalBytes > SIZE_LIMITS.totalWarnBytes) warnings.push(`解压总体积 ${(totalBytes / 1048576).toFixed(2)} MB 超过警告线 ${SIZE_LIMITS.totalWarnBytes / 1048576} MB`)

  for (const e of entries) {
    if (options.iconPath && e.name.toLowerCase() === `extension/${options.iconPath.toLowerCase()}`) continue
    if (e.size > SIZE_LIMITS.fileMaxBytes) errors.push(`单文件 ${e.name} 为 ${(e.size / 1048576).toFixed(2)} MB，超过上限`)
    else if (e.size > SIZE_LIMITS.fileWarnBytes) warnings.push(`单文件 ${e.name} 为 ${(e.size / 1024).toFixed(0)} KB，超过警告线`)
  }

  return { ok: errors.length === 0, errors, warnings, totalBytes }
}

function git(args) {
  const out = spawnSync('git', args, { encoding: 'utf8' })
  if (out.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${out.stderr}`)
  return out.stdout.trim()
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const upload = process.argv.includes('--upload')
  const allowDirty = process.argv.includes('--allow-dirty')

  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const { version } = pkg

  if (!allowDirty && git(['status', '--porcelain']) !== '') {
    console.error('工作树不干净：先提交或 stash，或用 --allow-dirty 明确跳过（打包内容可能与提交不符）')
    process.exitCode = 1
    return
  }

  let notes
  try {
    notes = extractLatestChangelog(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version)
  } catch (err) {
    console.error(String(err.message))
    process.exitCode = 1
    return
  }
  console.log(`CHANGELOG ${notes.version}${notes.date ? `（${notes.date}）` : ''} 段落提取成功，${notes.body.length} 字符`)

  console.log('打包 VSIX（vsce --no-dependencies，含 vscode:prepublish 生产构建）…')
  // Windows 上 npx/gh 是 .cmd，必须经 shell；参数拼接为整条命令避免 DEP0190（args+shell 组合）
  const vsce = spawnSync(`npx @vscode/vsce package --no-dependencies`, { cwd: root, encoding: 'utf8', shell: true })
  if (vsce.status !== 0) {
    console.error(vsce.stdout)
    console.error(vsce.stderr)
    process.exitCode = 1
    return
  }

  const vsixName = `${pkg.name}-${version}.vsix`
  const vsixPath = path.join(root, vsixName)
  if (!existsSync(vsixPath)) {
    console.error(`打包完成但未找到 ${vsixPath}`)
    process.exitCode = 1
    return
  }

  const entries = listZipEntries(vsixPath)
  const result = inspectVsixEntries(entries, { iconPath: pkg.icon })
  console.log(`VSIX 共 ${entries.length} 个文件，解压 ${(result.totalBytes / 1024).toFixed(0)} KB（${vsixName}）`)
  for (const w of result.warnings) console.warn(`警告：${w}`)
  if (!result.ok) {
    for (const e of result.errors) console.error(`检查失败：${e}`)
    process.exitCode = 1
    return
  }
  console.log('包内容检查通过（必需清单 / 禁止模式 / 体积阈值）')

  if (!upload) {
    console.log('如需创建 GitHub Release：node scripts/release.mjs --upload')
    return
  }

  const tag = `v${version}`
  const headTag = git(['describe', '--tags', '--exact-match', 'HEAD']).split('\n')[0]
  if (headTag !== tag) {
    console.error(`HEAD 未打 ${tag} 标签（当前 ${headTag || '无'}）。先 git tag ${tag} 再上传`)
    process.exitCode = 1
    return
  }
  const head = git(['rev-parse', 'HEAD'])
  const notesFile = path.join(mkdtempSync(path.join(tmpdir(), 'vsidian-release-')), 'notes.md')
  writeFileSync(notesFile, notes.body + '\n', 'utf8')

  console.log(`创建 GitHub Release ${tag} 并上传 ${vsixName}…`)
  const gh = spawnSync(`gh release create ${tag} "${vsixPath}" --target ${head} --title ${tag} --notes-file "${notesFile}"`, { cwd: root, encoding: 'utf8', shell: true })
  rmSync(path.dirname(notesFile), { recursive: true, force: true })
  if (gh.status !== 0) {
    console.error(gh.stdout)
    console.error(gh.stderr)
    process.exitCode = 1
    return
  }
  console.log(`Release ${tag} 创建完成：https://github.com/${git(['config', '--get', 'remote.origin.url']).replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')}/releases/tag/${tag}`)
}

// 仅在直接执行（node scripts/release.mjs）时跑主流程；契约测试 import 纯函数不触发
if (process.argv[1] && path.resolve(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
