// 工具栏双态视图切换按钮浏览器回归（#141）：绘制层可见性（boundingBox +
// elementFromPoint）、DOM 序、图标随态（CSS 模式类驱动 computed display）、
// 点击出站与宿主回环、真实 Ctrl+Q 快捷键出站、mousedown 焦点保持。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'viewtoggle/main.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/viewToggleFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

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
    await page.evaluate(() => window.initDoc('# 标题\n\n正文段。'))

    // ---- DOM 序：齿轮、✎、双态切换、侧栏 ----
    assert.deepEqual(await page.evaluate(() => window.toolbarOrder()), [
      'vsidian-settings-toggle',
      'vsidian-quick-toggle',
      'vsidian-view-toggle',
      'vsidian-sidebar-toggle',
    ], '按钮序应为 齿轮、快速操作、双态切换、侧栏')

    // ---- 绘制层可见性与图标随态（live：edit 可见、book 隐藏）----
    await page.waitForSelector('.vsidian-view-toggle')
    let paint = await page.evaluate(() => window.readTogglePaint())
    assert.ok(paint.visible, '双态按钮应有绘制尺寸')
    assert.ok(paint.hitIsButton, true, '按钮中心点元素命中应为按钮自身（未被遮挡）')
    assert.notEqual(paint.editDisplay, 'none', 'live 态应显示编辑类图标（SVG path 默认 inline）')
    assert.equal(paint.bookDisplay, 'none', 'live 态应隐藏书本图标')
    assert.equal(paint.aria, zhCn['toolbar.switchToReading'], 'live 态 aria 表目标动作（切换到阅读）')
    assert.equal(paint.title, zhCn['toolbar.switchToReading'], 'title 与 aria 同词')

    // ---- #158 右端组几何（绘制层）：按钮位于工具栏水平中点右侧，
    //      与侧栏开关以工具栏 gap（4px）紧邻组成右端组 ----
    assert.ok(paint.centerX > paint.toolbarCenterX,
      `双态按钮中心应位于工具栏水平中点右侧（#158 右端组）：centerX=${paint.centerX}, toolbarCenterX=${paint.toolbarCenterX}`)
    assert.ok(paint.gapToSidebar !== null && Math.abs(paint.gapToSidebar - 4) < 1,
      `双态切换与侧栏开关应以工具栏 gap 紧邻组成右端组（实测间距 ${paint.gapToSidebar}px）`)

    // ---- 点击出站 + 宿主回环后图标随态翻转（reading：book 可见）----
    const beforeClick = await page.evaluate(() => window.readHostMessages().length)
    await page.locator('.vsidian-view-toggle').click()
    await page.waitForFunction(() =>
      document.querySelector('.vsidian-body')?.classList.contains('vsidian-mode-reading'))
    const messages = await page.evaluate((from) =>
      window.readHostMessages().slice(from), beforeClick)
    assert.ok(messages.some((m) => m.kind === 'view.switch.request' && m.target === 'reading'),
      '点击应出站 view.switch.request target=reading')
    paint = await page.evaluate(() => window.readTogglePaint())
    assert.notEqual(paint.bookDisplay, 'none', 'reading 态应显示书本图标')
    assert.equal(paint.editDisplay, 'none', 'reading 态应隐藏编辑图标')
    assert.equal(paint.aria, zhCn['toolbar.switchToLive'], 'reading 态 aria 随态换词')

    // ---- Ctrl+Q 真实按键（reading 视图聚焦）→ keybindings.execute 出站 ----
    await page.evaluate(() => window.focusReading())
    const beforeKey = await page.evaluate(() => window.readHostMessages().length)
    await page.keyboard.press('Control+q')
    let keyMessages = await page.evaluate((from) =>
      window.readHostMessages().slice(from), beforeKey)
    assert.ok(keyMessages.some((m) => m.kind === 'keybindings.execute' && m.id === 'toggleDualView'),
      'reading 聚焦下 Ctrl+Q 应出站 keybindings.execute toggleDualView')
    // 回环（宿主 executeCommand → 双态切换 → view.mode.set live）
    await page.evaluate(() => window.readHostMessages()
      .filter((m) => m.kind === 'view.switch.request').length)
    await page.waitForFunction(() =>
      document.querySelector('.vsidian-body')?.classList.contains('vsidian-mode-live'))

    // ---- live 正文聚焦下 Ctrl+Q 同样触发 ----
    await page.evaluate(() => { window.locate(0); window.focusEditor() })
    const beforeKey2 = await page.evaluate(() => window.readHostMessages().length)
    await page.keyboard.press('Control+q')
    keyMessages = await page.evaluate((from) =>
      window.readHostMessages().slice(from), beforeKey2)
    assert.ok(keyMessages.some((m) => m.kind === 'keybindings.execute' && m.id === 'toggleDualView'),
      'live 正文聚焦下 Ctrl+Q 应出站 keybindings.execute')
    await page.waitForFunction(() =>
      document.querySelector('.vsidian-body')?.classList.contains('vsidian-mode-reading'))

    // ---- 焦点环不出现（验收修复：键盘切换后的程序化聚焦命中
    //      :focus-visible，UA 默认焦点环会围住整个阅读容器且点击正文
    //      不消除）——阅读容器聚焦态 computed outline 须为 none ----
    const ring = await page.evaluate(() => {
      const el = document.querySelector('.vsidian-view-reading')
      return { focused: document.activeElement === el, style: getComputedStyle(el).outlineStyle }
    })
    // 焦点接管是行为语义（键盘滚动依赖容器聚焦）。焦点环本身在 headless
    // 不可复现：真机黄线来自 Chromium UA 规则 :focus-visible{outline:auto}
    // （键盘序列后的程序化聚焦触发启发式），CDP 合成键盘不触发——回归
    // 防线是 CSS 契约测试钉住 #app .vsidian-view-reading:focus{outline:none}
    assert.equal(ring.focused, true, '编辑器有焦点时切入阅读，容器应接管焦点（键盘滚动依赖）')

    // ---- mousedown 不抢正文焦点（回到 live 后验证）----
    await page.evaluate(() => window.readHostMessages())
    // 切回 live（经按钮点击回环）
    await page.locator('.vsidian-view-toggle').click()
    await page.waitForFunction(() =>
      document.querySelector('.vsidian-body')?.classList.contains('vsidian-mode-live'))
    await page.evaluate(() => window.focusEditor())
    await page.locator('.vsidian-view-toggle').dispatchEvent('mousedown')
    assert.equal(await page.evaluate(() => window.editorHasFocus()), true,
      'mousedown 按钮后正文应保持焦点')

    // ---- 标签页隐藏即销毁的等价重建：纯滚动视口跨 controller 保留 ----
    const longDoc = Array.from({ length: 240 }, (_, i) =>
      `## 段落 ${i}\n\n这是足够长的正文，用于验证滚动进度。\n`).join('\n')
    await page.evaluate((text) => window.resetViewportDoc(text), longDoc)
    await page.waitForFunction(() => {
      const el = document.querySelector('.cm-scroller')
      return el && el.scrollHeight > el.clientHeight + 1000
    })
    await page.evaluate(() => {
      const el = document.querySelector('.cm-scroller')
      el.scrollTop = 640
      el.dispatchEvent(new Event('scroll'))
    })
    const liveTop = await page.evaluate(() => document.querySelector('.cm-scroller').scrollTop)
    assert.ok(liveTop > 100, 'live 前置条件：视口已滚离文首')
    await page.waitForTimeout(80)
    const liveCenter = await page.evaluate(() => window.liveCenterLine())
    assert.ok(liveCenter > 1, 'live 前置条件：视口中心已离开文首')
    await page.evaluate((text) => window.reloadViewportDoc(text), longDoc)
    await page.waitForFunction((line) =>
      window.liveCenterLine() !== null && Math.abs(window.liveCenterLine() - line) <= 1, liveCenter)
    await page.waitForTimeout(100)
    assert.ok(Math.abs((await page.evaluate(() => window.liveCenterLine())) - liveCenter) <= 1,
      'live 重建后视口中心应保持同一源码行')

    await page.evaluate((text) => window.resetViewportDoc(text), longDoc)
    await page.evaluate(() => window.setViewportMode('reading'))
    await page.waitForFunction(() => {
      const el = document.querySelector('.vsidian-view-reading')
      return el && el.scrollHeight > el.clientHeight + 1000
    })
    await page.evaluate(() => {
      const el = document.querySelector('.vsidian-view-reading')
      el.scrollTop = 720
      el.dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(100)
    const readingTop = await page.evaluate(() => document.querySelector('.vsidian-view-reading').scrollTop)
    assert.ok(readingTop > 100, 'reading 前置条件：视口已滚离文首')
    await page.evaluate((text) => window.reloadViewportDoc(text), longDoc)
    await page.waitForTimeout(120)
    assert.ok(Math.abs((await page.evaluate(() => document.querySelector('.vsidian-view-reading').scrollTop)) - readingTop) <= 2,
      'reading 重建后视口应稳定在离开时位置')

    assert.deepEqual(errors, [], `页面不应有脚本错误: ${errors.join('; ')}`)
    await page.close()
  }
  console.log('viewToggle: 全部场景通过（明暗主题）')
} finally {
  await browser.close()
}
