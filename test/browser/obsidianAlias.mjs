// Obsidian 原名别名桥浏览器回归（#132）：真实 Chromium 布局 + 生产控制器 +
// 产物 CSS + probe.css（探针规则按 Obsidian 原名书写）。覆盖：
// - live / reading 双视图全部别名探针命中（期望值从探针表单一事实源读取）；
// - 明暗主题（body.vscode-dark / vscode-light 切换）探针保持命中，且
//   变量桥的浅色分支（--vsidian-highlight-background）随主题切换取值变化；
// - 变量桥：注入 Obsidian 原名变量（真实片段等效）驱动标题可见颜色；
// - 阅读重挂载：live↔reading 往返（阅读块全部重建）后别名类随块带回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// 两份构建：页面 fixture（iife）与探针表模块（esm，脚本侧 import 后注入页面）
const output = artifactPath(root, 'alias/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/obsidianAliasFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
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
    '**粗体** 与 *斜体* 与 `行内代码` 与 ==高亮==。', '',
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

  console.log('obsidianAlias: 全部断言通过（双视图 × 明暗主题 × 重挂载 + 变量桥）')
} finally {
  await browser.close()
}
