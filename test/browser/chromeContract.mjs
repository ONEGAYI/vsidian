// 界面域公开样式契约浏览器回归（#133）：真实 Chromium 布局 + 生产控制器 +
// 产物 CSS + probe.css（chrome 探针规则按 vsidian 稳定类名书写）。覆盖：
// - chrome 探针双视图命中（live 作用域 + 大纲侧栏常驻；reading 作用域在
//   阅读模式采集）与 live↔reading 往返重挂载后复验；
// - 明暗主题（body.vscode-dark / vscode-light 切换）探针保持命中；
// - 片段注入（webview 内 <style>，真实片段等效）驱动 chrome 可见颜色
//   （公式 KaTeX / 卡片标签 / tok token / 大纲层级色——用户片段实际
//   改变目标可见属性的浏览器侧证据）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const output = artifactPath(root, 'chrome-contract/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/chromeContractFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const tableOut = artifactPath(root, 'chrome-contract/contract.mjs')
await build({ entryPoints: [path.join(root, 'src/shared/chromeContract.ts')],
  bundle: true, outfile: tableOut, format: 'esm', platform: 'node' })
const { CHROME_CONTRACT_PROBES } = await import(pathToFileURL(tableOut).href)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 620 } })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  // 探针规则（按 vsidian 稳定类名书写）整份注入——与宿主 <link> 加载同形
  await page.addStyleTag({ content: readFileSync(path.join(root, 'media/css-contract-probe.css'), 'utf8') })
  await page.addScriptTag({ path: output })

  const DOC = [
    // frontmatter 成型头区（#140 探针：card-line/row/cell/add-entry）
    '---', 'title: 界面契约', 'tags:', '  - 契约', '---', '',
    '# 界面契约一级标题', '',
    '## 二级标题与 **加粗透传**', '',
    '行内公式 $E = mc^2$ 与块级公式：', '',
    '$$\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}$$', '',
    '错误公式 $\\fauxcmd{x}$ 原文降级。', '',
    '```js', 'const keyword = true', '```', '',
    '```python', 'import sys', 'sys.path.insert(0, "src/llm")', 'load_encoded_csv("data", 12)', '# comment', '```', '',
    '结尾段落。', '',
  ].join('\n')
  await page.evaluate((text) => window.initChromeContract(text), DOC)
  await page.evaluate((table) => { window.__chromeProbeTable = table }, CHROME_CONTRACT_PROBES)

  const liveProbes = CHROME_CONTRACT_PROBES.filter((p) => p.selector.includes('.vsidian-view-live'))
  const readingProbes = CHROME_CONTRACT_PROBES.filter((p) => p.selector.includes('.vsidian-view-reading'))
  const alwaysProbes = CHROME_CONTRACT_PROBES.filter(
    (p) => !p.selector.includes('.vsidian-view-live') && !p.selector.includes('.vsidian-view-reading'),
  )
  // 浏览器 fixture 文档不含 mermaid 围栏（mermaid 渲染与按钮组/弹窗的
  // 浏览器路径由 mermaidPaint.mjs / graphicPopup.mjs 的 CSP 复刻页覆盖；
  // 集成用例在真实宿主断言其 chrome 探针）——此处排除 mermaid 依赖探针
  const notMermaid = (p) => !p.id.includes('mermaid') && p.id !== 'graphic-chrome'

  const checkProbes = async (probes, label) => {
    const bad = await page.evaluate((scope) => {
      const probe = window.chromeProbe()
      const bad = []
      const wanted = new Set(scope.map((s) => s.id))
      for (const item of window.__chromeProbeTable ?? []) {
        if (!wanted.has(item.id)) continue
        const actual = probe?.chromeSelectors?.[item.id]
        if (actual !== item.expected) bad.push(item.id + ': ' + String(actual) + ' != ' + item.expected)
      }
      return bad
    }, probes.map((p) => ({ id: p.id })))
    assert.deepEqual(bad, [], `${label}：chrome 探针应全命中（挂错节点即失败）`)
  }
  const pythonNameColors = (mode) => page.evaluate((root) => [
    getComputedStyle(document.querySelector(`${root} .tok-propertyName:not(.tok-function)`)).color,
    getComputedStyle(document.querySelector(`${root} .tok-propertyName.tok-function`)).color,
    getComputedStyle(document.querySelector(`${root} .tok-variableName.tok-function`)).color,
  ], `.vsidian-view-${mode}`)

  // live 视图（默认）：live 作用域 + 常驻探针
  await page.waitForTimeout(150)
  await checkProbes([...liveProbes, ...alwaysProbes].filter(notMermaid), '初始 live')
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  assert.equal(await page.evaluate(() => window.chromeProbe()?.chromePaint?.tokKeywordColor),
    'rgb(175, 0, 219)', 'live 浅色主题的代码关键词应绘制为共享色板颜色')
  assert.deepEqual(await page.evaluate(() => [
    getComputedStyle(document.querySelector('.vsidian-view-live .tok-string')).color,
    getComputedStyle(document.querySelector('.vsidian-view-live .tok-comment')).color,
  ]), ['rgb(10, 48, 105)', 'rgb(110, 119, 129)'], 'live Python 字符串与注释应绘制为浅色组颜色')
  assert.deepEqual(await pythonNameColors('live'), ['rgb(31, 35, 40)', 'rgb(128, 96, 0)', 'rgb(128, 96, 0)'],
    'live Python 普通属性保持正文色，方法与函数调用呈现浅色暖黄')
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })
  assert.equal(await page.evaluate(() => window.chromeProbe()?.chromePaint?.tokKeywordColor),
    'rgb(197, 134, 192)', 'live 深色主题的代码关键词应绘制为共享色板颜色')
  assert.deepEqual(await page.evaluate(() => [
    getComputedStyle(document.querySelector('.vsidian-view-live .tok-string')).color,
    getComputedStyle(document.querySelector('.vsidian-view-live .tok-comment')).color,
  ]), ['rgb(165, 214, 255)', 'rgb(139, 148, 158)'], 'live Python 字符串与注释应绘制为深色组颜色')
  assert.deepEqual(await pythonNameColors('live'), ['rgb(201, 209, 217)', 'rgb(220, 220, 170)', 'rgb(220, 220, 170)'],
    'live Python 深色组应区分普通属性与黄色函数调用')
  await page.evaluate(() => { document.body.classList.add('vscode-high-contrast'); document.body.classList.remove('vscode-dark') })
  assert.equal((await pythonNameColors('live'))[1], 'rgb(220, 220, 170)',
    '深色高对比主题的函数色须保持可读的淡黄')
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-high-contrast') })

  // reading 视图：reading 作用域 + 常驻探针
  await page.evaluate(() => window.setChromeContractMode('reading'))
  await page.waitForTimeout(150)
  await checkProbes([...readingProbes, ...alwaysProbes].filter(notMermaid), '切阅读')

  // 明暗主题：body.vscode-light 切换后探针保持命中（chrome 域样式不随
  // 主题类漂移；探针规则无主题条件）
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  await checkProbes([...readingProbes, ...alwaysProbes].filter(notMermaid), '浅色主题')
  assert.equal(await page.evaluate(() => window.chromeProbe()?.chromePaint?.tokKeywordColor),
    'rgb(175, 0, 219)', '浅色主题的代码关键词应绘制为共享色板颜色')
  assert.deepEqual(await page.evaluate(() => [
    getComputedStyle(document.querySelector('.vsidian-view-reading .tok-string')).color,
    getComputedStyle(document.querySelector('.vsidian-view-reading .tok-comment')).color,
  ]), ['rgb(10, 48, 105)', 'rgb(110, 119, 129)'], '阅读侧 Python 字符串与注释应绘制为浅色组颜色')
  assert.deepEqual(await pythonNameColors('reading'), ['rgb(31, 35, 40)', 'rgb(128, 96, 0)', 'rgb(128, 96, 0)'],
    '阅读侧 Python 普通属性保持正文色，方法与函数调用呈现浅色暖黄')
  await page.evaluate(() => { document.body.classList.add('vscode-dark'); document.body.classList.remove('vscode-light') })
  await checkProbes([...readingProbes, ...alwaysProbes].filter(notMermaid), '回深色主题')
  assert.equal(await page.evaluate(() => window.chromeProbe()?.chromePaint?.tokKeywordColor),
    'rgb(197, 134, 192)', '深色主题的代码关键词应绘制为共享色板颜色')
  assert.deepEqual(await page.evaluate(() => [
    getComputedStyle(document.querySelector('.vsidian-view-reading .tok-string')).color,
    getComputedStyle(document.querySelector('.vsidian-view-reading .tok-comment')).color,
  ]), ['rgb(165, 214, 255)', 'rgb(139, 148, 158)'], '阅读侧 Python 字符串与注释应绘制为深色组颜色')
  assert.deepEqual(await pythonNameColors('reading'), ['rgb(201, 209, 217)', 'rgb(220, 220, 170)', 'rgb(220, 220, 170)'],
    '阅读侧 Python 深色组应区分普通属性与黄色函数调用')

  // 片段注入（真实片段等效——webview 内 <style> 注入）驱动 chrome 可见颜色：
  // 阅读侧四个区域（公式 KaTeX / 卡片标签 / tok token / 大纲层级色）
  const paintedReading = await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = [
      '.vsidian-math .katex { color: rgb(61, 62, 63); }',
      '.vsidian-code-card-header-label { color: rgb(64, 65, 66); }',
      '.tok-keyword { color: rgb(67, 68, 69); }',
      '.vsidian-outline-level-1 { color: rgb(73, 74, 75); }',
    ].join('\n')
    document.head.append(style)
    const probe = window.chromeProbe()
    style.remove()
    return probe?.chromePaint ?? null
  })
  assert.equal(paintedReading?.mathKatexColor, 'rgb(61, 62, 63)',
    `片段应驱动阅读公式 KaTeX 可见色，实际 ${JSON.stringify(paintedReading)}`)
  assert.equal(paintedReading?.codeCardLabelColor, 'rgb(64, 65, 66)', '片段应驱动卡片标签可见色')
  assert.equal(paintedReading?.tokKeywordColor, 'rgb(67, 68, 69)', '片段应驱动 tok token 可见色')
  assert.equal(paintedReading?.outlineLevel1Color, 'rgb(73, 74, 75)', '片段应驱动大纲层级色')

  // 重挂载：live↔reading 往返（阅读块销毁重建、卡片/公式挂载钩子重增强）
  await page.evaluate(() => window.setChromeContractMode('live'))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.setChromeContractMode('reading'))
  await page.waitForTimeout(150)
  await checkProbes([...readingProbes, ...alwaysProbes].filter(notMermaid), '重挂载后')

  // 弹窗不在场观测（浏览器侧弹窗全路径由 graphicPopup.mjs 覆盖；此处钉
  // 默认无浮层 DOM——在场性语义与集成用例对拍）
  const popupIdle = await page.evaluate(() => window.chromeProbe()?.chromePopup ?? null)
  assert.equal(popupIdle, null, '未打开图表弹窗时 chromePopup 应为 null（无浮层 DOM）')

  console.log('chromeContract: 全部断言通过（双视图 × 明暗主题 × 重挂载 + 片段可见色）')
} finally {
  await browser.close()
}
