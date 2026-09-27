// HTML 注释浏览器回归（#139）：真实键盘 Ctrl+/ 驱动生产控制器验证两态
// 三路径（空插落光标/包裹/取消）、Live 淡化绘制可见性（computed color 与
// elementFromPoint）、阅读侧隐藏、代码上下文不接管。明暗主题各跑一遍。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'comment/main.js')
// 与 symbolInput.mjs 同口径：katex css 裁掉 woff/ttf 字体引用
const katexFontStrip = {
  name: 'katex-font-fallback-strip',
  setup(b) {
    b.onLoad({ filter: /katex\.min\.css$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(
        /,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\((["']?)(?:woff|truetype)\1\)/g, ''),
      loader: 'css',
    }))
  },
}
await build({ entryPoints: [path.join(root, 'test/browser/commentToggleFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent(`<html lang="zh-CN"><body class="vscode-${theme}">${islandHtml}<div id="app"></div></body></html>`)
    await page.addStyleTag({ content: `:root { --vscode-font-family: sans-serif; --vscode-editor-background: ${theme === 'light' ? '#ffffff' : '#1e1e1e'}; --vscode-editor-foreground: ${theme === 'light' ? '#222222' : '#dddddd'}; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })

    // ---- 场景 1：空插两态（真实 Ctrl+/）----
    await page.evaluate(() => window.initDoc('正文'))
    await page.evaluate(() => window.locate(1))
    await page.evaluate(() => window.focusEditor()) // 聚焦不动物标（click 会把光标点到点击处）
    await page.keyboard.press('Control+/')
    let editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, '正<!-- -->文', '空插应生成带空格的注释空对')
    assert.equal(editor.head, 5, '光标应落在开围栏内侧（from+4）')
    await page.keyboard.press('Control+/')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, '正文', '光标在空对内再按应取消整对（不留空格）')

    // ---- 场景 2：选区包裹与取消 ----
    await page.evaluate(() => window.selectRange(0, 2))
    await page.keyboard.press('Control+/')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, '<!--正文-->', '选区应被注释定界符包裹')
    assert.deepEqual([editor.from, editor.to], [4, 6], '原文保持选中')
    await page.evaluate(() => window.ackLastEdit(2))
    await page.evaluate(() => window.selectRange(4, 4))
    await page.keyboard.press('Control+/')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, '正文', '光标在注释内再按应剥定界符保留内容')

    // ---- 场景 3：Live 淡化绘制可见性（computed + elementFromPoint）----
    await page.evaluate(() => window.initDoc('普通正文一段。\n\n前 <!-- 这是一段注释文字 --> 后\n\n尾段。'))
    await page.evaluate(() => window.locate(0))
    await page.evaluate(() => window.focusEditor())
    await page.waitForSelector('.vsidian-html-comment')
    const paint = await page.evaluate(() => window.readCommentPaint())
    assert.ok(paint, '注释淡化 span 应在场')
    assert.equal(paint.display, 'inline', '淡化不得隐藏内容')
    assert.ok(paint.visible, '注释文字应有绘制尺寸（仍可读）')
    assert.equal(paint.hitInsideComment, true, '注释文字应被元素命中（未被遮挡/折叠）')
    // 淡化对比：computed color 的 alpha 应低于正文（color-mix 45% + transparent）
    const bodyPaint = await page.evaluate(() => {
      const line = document.querySelector('.cm-line')
      return line ? getComputedStyle(line).color : ''
    })
    // Chromium 对 color-mix 的 computed 值给 color(srgb r g b / a) 形态
    const alphaOf = (color) => {
      const rgba = /rgba?\(([^)]+)\)/.exec(color)
      if (rgba) {
        const parts = rgba[1].split(',').map((p) => p.trim())
        return parts.length > 3 ? Number(parts[3]) : 1
      }
      const css = /color\(srgb[^/]*\/\s*([\d.]+)\)/.exec(color)
      return css ? Number(css[1]) : 1
    }
    assert.ok(alphaOf(paint.color) < alphaOf(bodyPaint),
      `注释色 alpha（${paint.color}）应低于正文（${bodyPaint}）`)

    // ---- 场景 4：阅读侧隐藏（含跨行块级）----
    await page.evaluate(() => window.initDoc('段一\n<!-- 块级注释\n跨行内容 -->\n段二\n\n说明 `<!-- 码 -->` 完'))
    await page.evaluate(() => window.setViewMode('reading'))
    const readingText = await page.evaluate(() => window.readingText())
    assert.ok(readingText.includes('段一') && readingText.includes('段二'), '两侧正文保留')
    assert.ok(!readingText.includes('块级注释'), '跨行块级注释应隐藏')
    assert.ok(!readingText.includes('跨行内容'), '注释第二行也应隐藏')
    assert.ok(readingText.includes('<!-- 码 -->'), '行内代码内字面注释应保留')
    await page.evaluate(() => window.setViewMode('live'))

    // ---- 场景 5：代码上下文不接管（围栏内 Ctrl+/ 不改写）----
    await page.evaluate(() => window.initDoc('```\ncode line\n```\n\n尾段'))
    await page.evaluate(() => window.locate(8)) // 围栏内容行内
    await page.evaluate(() => window.focusEditor())
    const before = await page.evaluate(() => window.readEditor())
    await page.keyboard.press('Control+/')
    const after = await page.evaluate(() => window.readEditor())
    assert.equal(after.text, before.text, '围栏代码内 Ctrl+/ 不得插入注释')

    assert.deepEqual(errors, [], `页面不应有脚本错误: ${errors.join('; ')}`)
    await page.close()
  }
  console.log('commentToggle: 全部场景通过（明暗主题）')
} finally {
  await browser.close()
}
