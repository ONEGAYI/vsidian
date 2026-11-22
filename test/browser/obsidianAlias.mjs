// Obsidian 原名别名桥浏览器回归（#132）：真实 Chromium 布局 + 生产控制器 +
// 产物 CSS + probe.css（探针规则按 Obsidian 原名书写）。覆盖：
// - live / reading 双视图全部别名探针命中（期望值从探针表单一事实源读取）；
// - 明暗主题（body.vscode-dark / vscode-light 切换）探针保持命中，且
//   变量桥的浅色分支（--vsidian-highlight-background）随主题切换取值变化；
// - 变量桥：注入 Obsidian 原名变量（真实片段等效）驱动标题可见颜色；
// - 阅读重挂载：live↔reading 往返（阅读块全部重建）后别名类随块带回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// 两份构建：页面 fixture（iife）与探针表模块（esm，脚本侧 import 后注入页面）
const output = artifactPath(root, 'alias/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/obsidianAliasFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' }, assetNames: 'assets/[name]' })
const tableOut = artifactPath(root, 'alias/contract.mjs')
await build({ entryPoints: [path.join(root, 'src/shared/obsidianAlias.ts')],
  bundle: true, outfile: tableOut, format: 'esm', platform: 'node' })
const { OBSIDIAN_ALIAS_PROBES } = await import(pathToFileURL(tableOut).href)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 560 } })
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  // 探针规则（按 Obsidian 原名书写）整份注入——与宿主 <link> 加载同形
  await page.addStyleTag({ content: readFileSync(path.join(root, 'media/css-contract-probe.css'), 'utf8') })
  await page.addScriptTag({ path: output })

  const DOC = [
    '---', 'title: t', '---', '',
    '# 样式契约标题', '',
    '**粗体** 与 *斜体* 与 `行内代码` 与 ==高亮== 与 ~~删除线~~。', '',
    '> 引用一行', '',
    '- 无序列表项', '- [ ] 未完成任务', '',
    '---', '',
    '```js', 'const fence = true', '```', '',
    '| 表头甲 | 表头乙 |', '| --- | --- |', '| 单元甲 | 单元乙 |', '',
    '[外部链接](https://example.com/alias) 与 [[双链目标|显示别名]]。', '',
  ].join('\n')
  await page.evaluate((text) => window.initAlias(text), DOC)
  // 探针表注入页面（期望值单一事实源）
  await page.evaluate((table) => { window.__aliasProbeTable = table }, OBSIDIAN_ALIAS_PROBES)

  const checkView = async (view, label) => {
    const bad = await page.evaluate((v) => {
      const probe = window.aliasProbe()
      const bad = []
      for (const item of window.__aliasProbeTable ?? []) {
        if (item.view !== v) continue
        const actual = probe?.obsidianAliases?.[item.id]
        if (actual !== item.expected) bad.push(item.id + ': ' + String(actual) + ' != ' + item.expected)
      }
      return bad
    }, view)
    assert.deepEqual(bad, [], `${label}：${view} 视图全部别名探针应命中（挂错节点即失败）`)
  }

  // live 视图（默认）
  await checkView('live', '初始')

  // #483 删除线绘制层：内容 span 真实画线（非仅类命中），Obsidian 原名类同元素
  {
    const strike = await page.evaluate(() => {
      const el = document.querySelector('.vsidian-strikethrough')
      if (!el) return null
      return { deco: getComputedStyle(el).textDecorationLine, alias: el.classList.contains('cm-strikethrough') }
    })
    assert.notEqual(strike, null, 'live 删除线内容 span 应在 DOM 中')
    assert.equal(strike?.deco, 'line-through', `删除线应画线，实际 ${String(strike?.deco)}`)
    assert.equal(strike?.alias, true, 'Obsidian 原名类 cm-strikethrough 应同元素命中')
  }

  // reading 视图
  await page.evaluate(() => window.setAliasMode('reading'))
  await page.waitForTimeout(150)
  await checkView('reading', '切阅读')

  // 明暗主题：探针保持命中 + 高亮变量浅色分支取值变化（变量桥双主题分支）
  const highlightBg = await page.evaluate(() => {
    const el = document.querySelector('.markdown-preview-view mark') ?? document.querySelector('.vsidian-highlight')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  await page.evaluate(() => { document.body.classList.add('vscode-light'); document.body.classList.remove('vscode-dark') })
  const highlightBgLight = await page.evaluate(() => {
    const el = document.querySelector('.markdown-preview-view mark') ?? document.querySelector('.vsidian-highlight')
    return el ? getComputedStyle(el).backgroundColor : null
  })
  assert.notEqual(highlightBg, null, '高亮元素应在 DOM 中（变量桥观测前提）')
  assert.notEqual(highlightBg, highlightBgLight,
    `明暗主题高亮底色应不同（深色 ${String(highlightBg)} vs 浅色 ${String(highlightBgLight)}）`)
  await checkView('reading', '浅色主题')

  // 变量桥：注入 Obsidian 原名变量（真实片段等效——webview 内 <style> 注入）
  const bridged = await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = ':root { --h1-color: rgb(66, 77, 88); }'
    document.head.append(style)
    const probe = window.aliasProbe()
    style.remove()
    return probe?.obsidianVarProbe ?? null
  })
  assert.equal(bridged?.readingHeadingColor, 'rgb(66, 77, 88)',
    `--h1-color 应经变量桥驱动阅读标题色，实际 ${JSON.stringify(bridged)}`)

  // 阅读重挂载：live↔reading 往返（阅读块销毁重建），别名类随块构建器带回
  await page.evaluate(() => window.setAliasMode('live'))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.setAliasMode('reading'))
  await page.waitForTimeout(150)
  await checkView('reading', '重挂载后')

  // Obsidian 1.15.1：阅读侧公式随外层强调走主题色；Live 排版独立于强调。
  const mathPage = await browser.newPage({ viewport: { width: 720, height: 560 } })
  const formulaDoc = [
    '普通 $2$', '**$2$**', '_$2$_', '==$2$==', '<span style="color: purple">$2$</span>',
    '***$2$***', '___$2$___', '***<span>$2$</span>***', '_**$2$**_', String.raw`**$\color{red}{2}$**`,
  ].join('\n\n')
  const mathHtml = path.join(path.dirname(output), 'math.html')
  writeFileSync(mathHtml, '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="main.css"><div id="app"></div><script src="main.js"></script>')
  await mathPage.goto(pathToFileURL(mathHtml).href)
  await mathPage.addStyleTag({ content: `
    :root { --vscode-editor-foreground: rgb(17, 18, 19); }
    #app { --vsidian-highlight-background: rgb(255, 228, 128); }
    .markdown-preview-view strong, .cm-strong { color: rgb(42, 83, 124); }
    .markdown-preview-view em, .cm-emphasis { color: rgb(131, 64, 86); }
  ` })
  await mathPage.evaluate((doc) => window.initAlias(doc), formulaDoc)
  const paint = (mode) => mathPage.locator(`.vsidian-view-${mode} .vsidian-math .katex-html .mord:not(:has(.mord))`)
    .evaluateAll((items) => items.map((el) => {
      const style = getComputedStyle(el)
      return [style.color, style.fontWeight, style.fontStyle]
    }))
  const plain = 'rgb(17, 18, 19)'
  const strong = 'rgb(42, 83, 124)'
  const emphasis = 'rgb(131, 64, 86)'
  const texRed = 'rgb(255, 0, 0)'
  const normalGlyph = (color) => [color, '400', 'normal']
  const livePaint = [plain, plain, plain, plain, plain, plain, plain, texRed].map(normalGlyph)
  assert.deepEqual(await paint('live'), livePaint, 'Live 公式渲染但不接管外层强调；行内 HTML 保持原有呈现')
  const openItalic = formulaDoc.indexOf('_$2$_') + 2
  await mathPage.evaluate((anchor) => window.controller.getView().dispatch({ selection: { anchor } }), openItalic)
  assert.equal(await mathPage.locator('.vsidian-math-source').textContent(), '$2$', '进入斜体中的公式能编辑原始 TeX')
  await mathPage.evaluate(() => window.controller.getView().dispatch({ selection: { anchor: 0 } }))

  await mathPage.evaluate(() => window.setAliasMode('reading'))
  await mathPage.locator('.markdown-preview-view span[style="color: purple"] .katex-html').waitFor()
  assert.deepEqual(await paint('reading'),
    [plain, strong, emphasis, plain, 'rgb(128, 0, 128)', emphasis, emphasis, emphasis, strong, texRed].map(normalGlyph),
    '阅读侧继承强调和 HTML 包裹颜色；三连优先斜体色、显式嵌套按内层、TeX 显式颜色优先')
  assert.equal(await mathPage.locator('.markdown-preview-view mark:has(.katex-html)')
    .evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 228, 128)', '阅读侧高亮覆盖公式')
  await mathPage.evaluate(() => window.setAliasMode('live'))
  await mathPage.locator('.vsidian-view-live .katex-html').first().waitFor()
  assert.deepEqual(await paint('live'), livePaint, '切回 Live 后恢复样式隔离')
  await mathPage.close()

  console.log('obsidianAlias: 全部断言通过（双视图 × 明暗主题 × 重挂载 + 变量桥）')
} finally {
  await browser.close()
}
