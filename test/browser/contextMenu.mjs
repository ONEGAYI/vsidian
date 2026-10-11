// 统一右键菜单（#183/#184）的原生浏览器回归：真实布局（Chromium）下用真实右键、
// 真实键盘（Ctrl+Shift+C/Escape）与真实 hover 验证——Live 正文全域接管（空行
// 接管、头区不接管）、菜单浮层真实绘制与 fixed 定位、三簇分组线、安全降级
// 矩阵（表格/围栏区写操作置灰）、子菜单 hover 展开与右缘翻转、提示列小字
// 渲染、图标资产接线（#184：明暗两套真实加载 + mask 绘制 + 暗色主题切换）、
// 段落设置勾选（#184：按行结构点亮）、剪贴板四项桥链路（cut/copy/paste/
// selectAll）、块链接两项（自 blockMenu.mjs 迁移：标题链接/自动补写/既有
// id 复用）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'contextMenu/contextMenu.js')
await build({ entryPoints: [path.join(root, 'test/browser/contextMenuFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
// #438 图形簇需要真实渲染成功态：mermaid 独立产物自建（入口与配置同
// esbuild.mjs 的 mermaid target——CI browser job 不跑 npm run compile，
// 引用 out/webview/mermaid.js 会因产物缺失而 404，套件须自包含）
const mermaidArtifact = artifactPath(root, 'mermaid.js')
await build({
  entryPoints: [path.join(root, 'src/webview/mermaidEntry.ts')],
  outfile: mermaidArtifact, bundle: true, platform: 'browser', format: 'iife',
  target: 'chrome118', minify: true, sourcemap: false, logLevel: 'silent',
})

// 行号（0 基）：0 `---` 1 头区行 2 `---` 3 空行 4 H1 5 空行 6 段落 7 空行
// 8 表格三行 11 空行 12 ```js 13 代码 14 ``` 15 空行 16 mermaid 三行
// 19 空行 20 已有 id 段（行尾 ^keep1——场景 N 块 id 双形态断言的在场形态）
const DOC = [
  '---',
  'title: 头区',
  '---',
  '',
  '# 标题甲',
  '',
  '普通段落一行',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
  '已有 id 的段落 ^keep1',
].join('\n')

// #94：菜单文案经 t() 取词（无岛回退键名会改变菜单测宽）——注入岛
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // #184 图标接线：CSS 内资产 url 经 base href 走 route（esbuild 产物
  // assets/ 目录 fulfill）——统计真实加载并保证可解析
  const iconRequests = []
  await page.route('http://ctx.test/assets/*.svg', async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname)
    iconRequests.push(name)
    await route.fulfill({ path: artifactPath(root, 'contextMenu/assets', name),
      contentType: 'image/svg+xml' })
  })
  // #438 mermaid 产物路由（懒加载 script.src → __vsidianMermaidUri 指向此处）
  await page.route('http://ctx.test/mermaid.js', async (route) => {
    await route.fulfill({ path: mermaidArtifact, contentType: 'text/javascript' })
  })
  await page.setContent(
    `<html><head><base href="http://ctx.test/"></head><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initContextMenu(text), DOC)
  await page.locator('.cm-line').first().waitFor()
  await page.waitForTimeout(120)
  const line = (n) => page.locator('.cm-line').nth(n)

  // ---- 场景 A：真实右键普通段弹出统一菜单（绘制 + 三簇 + 分组线 + 取词） ----
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  let state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuRect && state.menuRect.width > 100, '右键后菜单应有布局盒（真实绘制）')
  assert.equal(state.menuPosition, 'fixed', '菜单应为视口系 fixed 定位')
  assert.notEqual(state.menuBackground, 'rgba(0, 0, 0, 0)', '菜单背景应真实绘制')
  assert.equal(state.separatorCount, 2, `三簇应恰两条分组线（实际 ${state.separatorCount}）`)
  assert.deepEqual(state.topCommands, [
    'wikilink', 'link', 'copyBlockLink',
    'textFormat', 'paragraphStyle', 'insert',
    'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
  ], `普通段顶级命令序列（实际 ${JSON.stringify(state.topCommands)}）`)
  assert.ok(state.topTexts.includes('复制块链接') && state.topTexts.includes('粘贴'),
    `菜单文案应取 zh 语言包（实际 ${JSON.stringify(state.topTexts)}）`)
  passed++
  console.log('[统一菜单回归][PASS] 真实右键普通段：绘制、三簇、分组线与取词')

  // ---- 场景 B：分组线真实绘制（computed 非零厚度）+ 提示列渲染 ----
  const sepPainted = await page.evaluate(() => {
    const sep = document.querySelector('.vsidian-context-menu-separator')
    if (!sep) return false
    const style = getComputedStyle(sep)
    return style.borderTopWidth !== '0px' && style.display !== 'none'
  })
  assert.ok(sepPainted, '分组线应真实绘制（边框厚度非零）')
  const hintState = await page.evaluate(() => ({
    cut: window.readMenu().hintOf('cut'),
    selectAll: window.readMenu().hintOf('selectAll'),
    wikilink: window.readMenu().hintOf('wikilink'),
    hintRight: (() => {
      // 取剪贴板簇顶级项（可见）的提示列——子菜单默认 display:none 几何为 0
      const hint = document.querySelector('button[data-vsidian-command="cut"] .vsidian-context-menu-hint')
      if (!hint) return null
      const item = hint.closest('button').getBoundingClientRect()
      const hintRect = hint.getBoundingClientRect()
      return hintRect.right > item.left + (item.right - item.left) / 2
    })(),
    hintSmall: (() => {
      const hint = document.querySelector('button[data-vsidian-command="cut"] .vsidian-context-menu-hint')
      const label = hint ? hint.closest('button').querySelector('.vsidian-context-menu-label') : null
      if (!hint || !label) return null
      return Number.parseFloat(getComputedStyle(hint).fontSize) <
        Number.parseFloat(getComputedStyle(label).fontSize)
    })(),
    hintDim: (() => {
      // 用户明确要求的「浅一点」：降低不透明度（review-loops 补断言——此前
      // opacity 只活在 CSS，删改规则无测试失败）
      const hint = document.querySelector('button[data-vsidian-command="cut"] .vsidian-context-menu-hint')
      if (!hint) return null
      return Number.parseFloat(getComputedStyle(hint).opacity) < 1
    })(),
  }))
  assert.equal(hintState.cut, 'Ctrl+X', '剪切提示列固定显示 Ctrl+X')
  assert.equal(hintState.selectAll, 'Ctrl+A', '全选提示列固定显示 Ctrl+A')
  assert.equal(hintState.wikilink, null, '未绑定项提示列不占位')
  assert.ok(hintState.hintRight, '提示列应右对齐（位于项右半区）')
  assert.ok(hintState.hintSmall, '提示列字号应小于菜单项文字（不抢戏）')
  assert.ok(hintState.hintDim, '提示列应降低不透明度（弱化不抢戏，用户明确要求）')
  passed++
  console.log('[统一菜单回归][PASS] 分组线绘制 + 提示列右对齐小字 + 未绑定不占位')

  // ---- 场景 C：图标资产接线（#184：27 枚 mask 有 url + 真实加载 + 真实绘制 + H1 徽标） ----
  const iconState = await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.vsidian-context-menu [data-icon]')]
    return {
      keys: icons.map((el) => el.dataset['icon']),
      noUrl: icons.filter((el) => !getComputedStyle(el).maskImage.includes('url(')).map((el) => el.dataset['icon']),
      notLight: icons.filter((el) => !getComputedStyle(el).maskImage.includes('light-')).map((el) => el.dataset['icon']),
      badge: window.readMenu().badgeOf('heading1'),
    }
  })
  assert.equal(new Set(iconState.keys).size, 27, `菜单应引用 27 枚接线图标（实际 ${JSON.stringify([...new Set(iconState.keys)])}）`)
  assert.deepEqual(iconState.noUrl, [], `全部图标位 mask 应有资产 url（缺 ${JSON.stringify(iconState.noUrl)}）`)
  assert.deepEqual(iconState.notLight, [], `默认亮色页面应指向 light 资产（偏 ${JSON.stringify(iconState.notLight)}）`)
  assert.equal(iconState.badge, 'H1', '段落设置 H1 档用文字徽标（不经生图）')
  await page.waitForFunction(() =>
    performance.getEntriesByType('resource').filter((entry) =>
      entry.name.endsWith('.svg') && entry.name.includes('/light-')).length >= 27)
  assert.ok(iconRequests.filter((name) => name.startsWith('light-')).length >= 27,
    `亮色图标资产应真实网络加载（实际 ${iconRequests.length} 次）`)
  // 顶级项图标真实绘制（mask 遮罩后非纯背景——照 quickActions 像素分析先例）
  const iconPaint = async (key) => {
    const png = await page.locator(`.vsidian-context-menu [data-icon='${key}']`).screenshot()
    return page.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      const colors = new Set()
      const base = [...data.slice(0, 3)]
      let paintedPixels = 0
      for (let at = 0; at < data.length; at += 4) {
        const color = [data[at], data[at + 1], data[at + 2]]
        colors.add(color.join(','))
        if (color.some((channel, index) => Math.abs(channel - base[index]) > 30)) {
          paintedPixels++
        }
      }
      return { colors: colors.size, paintedPixels }
    }, png.toString('base64'))
  }
  const brush = await iconPaint('textFormat')
  assert.ok(brush.colors > 2 && brush.paintedPixels > 4, `textFormat 笔刷图标应真实绘制（${JSON.stringify(brush)}）`)
  const clipboard = await iconPaint('paste')
  assert.ok(clipboard.colors > 2 && clipboard.paintedPixels > 4, `paste 图标应真实绘制（${JSON.stringify(clipboard)}）`)
  passed++
  console.log('[统一菜单回归][PASS] 图标接线：27 枚 mask 资产、真实加载与绘制、H1 徽标')

  // ---- 场景 C2：暗色主题图标切换（body.vscode-dark → dark 资产加载） ----
  const darkPage = await browser.newPage({ viewport: { width: 900, height: 560 } })
  const darkErrors = []
  darkPage.on('pageerror', (error) => darkErrors.push(error.message))
  const darkRequests = []
  await darkPage.route('http://ctx.test/assets/*.svg', async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname)
    darkRequests.push(name)
    await route.fulfill({ path: artifactPath(root, 'contextMenu/assets', name),
      contentType: 'image/svg+xml' })
  })
  await darkPage.setContent(
    `<html><head><base href="http://ctx.test/"></head><body class="vscode-dark">${islandHtml}<div id="app"></div></body></html>`)
  await darkPage.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await darkPage.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await darkPage.addScriptTag({ path: bundle })
  await darkPage.evaluate((text) => window.initContextMenu(text), DOC)
  await darkPage.locator('.cm-line').first().waitFor()
  await darkPage.waitForTimeout(120)
  await darkPage.locator('.cm-line').nth(6).click({ button: 'right', position: { x: 60, y: 6 } })
  const darkState = await darkPage.evaluate(() => {
    const icons = [...document.querySelectorAll('.vsidian-context-menu [data-icon]')]
    return {
      uniqueKeys: new Set(icons.map((el) => el.dataset['icon'])).size,
      notDark: icons.filter((el) => !getComputedStyle(el).maskImage.includes('dark-')).map((el) => el.dataset['icon']),
    }
  })
  assert.equal(darkState.uniqueKeys, 27, '暗色页应同样引用 27 枚接线图标')
  assert.deepEqual(darkState.notDark, [], `暗色主题应指向 dark 资产（偏 ${JSON.stringify(darkState.notDark)}）`)
  await darkPage.waitForFunction(() =>
    performance.getEntriesByType('resource').filter((entry) =>
      entry.name.endsWith('.svg') && entry.name.includes('/dark-')).length >= 27)
  assert.ok(darkRequests.filter((name) => name.startsWith('dark-')).length >= 27,
    `暗色图标资产应真实网络加载（实际 ${darkRequests.length} 次）`)
  assert.deepEqual(darkErrors, [], '暗色页无未捕获异常')
  await darkPage.close()
  passed++
  console.log('[统一菜单回归][PASS] 暗色主题：图标切换 dark 资产并真实加载')

  // ---- 场景 D：子菜单 hover 展开 + 翻转（视口右缘右键）----
  const submenu = page.locator('.vsidian-context-menu-host', { has: page.locator('button[data-vsidian-command="textFormat"]') })
  await submenu.hover()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  let opened = state.submenus.find((s) => s.display === 'block')
  assert.ok(opened, 'hover 父项宿主应展开子菜单（:hover 主通道）')
  // 右缘翻转发判定在装配期——菜单打开于 x=60 右侧空间充足，应向右不翻转
  assert.ok(!opened.flipped, '右侧空间充足时子菜单不翻转')
  passed++
  console.log('[统一菜单回归][PASS] 子菜单 hover 展开（右侧空间充足不翻转）')

  // 关菜单 → 视口右缘真实右键（绝对坐标 mouse API——行盒窄于视口，元素内
  // position 到不了右缘）：子菜单应装配期翻左
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.mouse.move(400, 300) // 挪走指针，解除上一场景的 hover 悬停态
  const lineBox = await line(6).boundingBox()
  await page.mouse.click(870, (lineBox?.y ?? 100) + 6, { button: 'right' })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '前置：视口右缘菜单已打开')
  assert.ok(state.menuRect && state.menuRect.x + state.menuRect.width <= 900 + 1,
    `菜单右缘 clamp 不越出视口（实际 ${state.menuRect && state.menuRect.x + state.menuRect.width}）`)
  const flipped = state.submenus.filter((s) => s.flipped)
  assert.ok(flipped.length === state.submenus.length && flipped.length > 0,
    `视口右缘打开时全部子菜单应装配期翻左（实际 ${state.submenus.map((s) => s.flipped)}）`)
  // 翻转后子菜单真实展开（hover 父项宿主）不溢出视口左缘
  await page.locator('.vsidian-context-menu button[data-vsidian-command="textFormat"]').hover()
  await page.waitForTimeout(80)
  state = await page.evaluate(() => window.readMenu())
  const textFmtSub = state.submenus[0]
  assert.ok(textFmtSub.display === 'block', '翻转态子菜单仍可 hover 展开')
  assert.ok(textFmtSub.rect.left >= -1, `翻转后子菜单不得溢出视口左缘（实际 left=${textFmtSub.rect.left}）`)
  await page.mouse.move(400, 300)
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 视口右缘：子菜单装配期左翻（不溢出屏幕）')

  // ---- 场景 E：子菜单叶命令真实点击（bold 写回一笔） ----
  // 选区经钩子开菜单保持（真实右键的 mousedown 会扰动既有选区——选区内
  // 右键保留选区是浏览器行为，测试以钩子通道隔离该变量；真实右键路径由
  // 场景 A/D/F/G/H 覆盖）
  await page.evaluate(({ from, to, pos }) => {
    window.setSelection(from, to)
    window.post({ kind: 'contextMenu.test.contextMenu', pos })
  }, { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2, pos: DOC.indexOf('普通') + 1 })
  // 子菜单默认 display:none：先 hover 父项展开（子菜单在宿主内，hover 保持）
  await page.locator('.vsidian-context-menu button[data-vsidian-command="textFormat"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="bold"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '叶命令执行后菜单应关闭')
  assert.ok(state.text.includes('**普通**'), `子菜单 bold 应真实写回（实际片段 ${state.text.slice(20, 40)}）`)
  const sentAfterBold = await page.evaluate(() => window.sent())
  assert.equal(sentAfterBold.filter((m) => m.kind === 'edit.request').length, 1,
    'bold 走标准出站一笔')
  passed++
  console.log('[统一菜单回归][PASS] 子菜单叶命令真实点击：写回一笔')

  // ---- 场景 F：空行接管 + 头区不接管 ----
  await page.evaluate(() => window.clearSent())
  await line(3).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '空行右键应接管（全域接管验收线）')
  assert.ok(!state.topCommands.includes('copyBlockLink'), '空行无块目标：复制块链接隐藏')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await line(1).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'frontmatter 头区右键不接管（原生菜单照常）')
  passed++
  console.log('[统一菜单回归][PASS] 空行接管 + 头区不接管')

  // ---- 场景 G：安全降级矩阵（表格网格/围栏卡片/图形块上真实右键——
  // 各区的呈现层元素：grid 行、代码卡片行、mermaid 渲染容器） ----
  await page.locator('.vsidian-table-grid-row').first().click({ button: 'right', position: { x: 30, y: 8 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('wikilink'), '表格行：新增链接（wikilink）置灰')
  assert.ok(state.disabledCommands.includes('link'), '表格行：新增外部链接置灰')
  assert.ok(state.disabledCommands.includes('textFormat'), '表格行：簇 2 父项置灰')
  assert.ok(state.disabledCommands.includes('bold'), '表格行：簇 2 子项置灰')
  assert.ok(!state.disabledCommands.includes('copyBlockLink'), '表格行：块链接可用（整块）')
  assert.ok(!state.disabledCommands.includes('selectAll'), '表格行：剪贴板可用')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.locator('.vsidian-code-card-line').first().click({ button: 'right', position: { x: 30, y: 8 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('textFormat'), '围栏代码区：簇 2 整簇置灰')
  assert.ok(!state.disabledCommands.includes('copyBlockLink'), '围栏区：块链接可用（整块）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.locator('.vsidian-mermaid').first().click({ button: 'right', position: { x: 40, y: 40 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.disabledCommands.includes('textFormat'), '图形块（mermaid）：簇 2 整簇置灰')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 安全降级矩阵：表格/围栏/图形块逐区域置灰')

  // ---- 场景 G2：图形专属簇（#438——真实右键图形块、簇呈现、弹窗与错误降级）----
  // 前置：注入 mermaid 产物 URI 并重装载文档——本套件页面默认无 mermaid
  // （容器落 error 态），重装载触发新 widget 真实渲染（state=rendered 是
  // 渲染成功 gate 的 DOM 探针输入）
  await page.evaluate(() => {
    window.__vsidianMermaidUri = 'http://ctx.test/mermaid.js'
  })
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'rendered',
    undefined, { timeout: 30000 })
  await page.locator('.vsidian-mermaid').first().click({ button: 'right', position: { x: 40, y: 40 } })
  state = await page.evaluate(() => window.readMenu())
  // 簇位：链接簇后、块与格式簇前；四项平铺全亮（渲染成功 + svg 能力在场）
  assert.deepEqual(state.topCommands.slice(0, 7), [
    'wikilink', 'link', 'copyBlockLink',
    'graphicPopup', 'graphicExportSvg', 'graphicExportPng', 'graphicCopySource',
  ], `图形块顶级命令序列（实际 ${JSON.stringify(state.topCommands)}）`)
  for (const command of ['graphicPopup', 'graphicExportSvg', 'graphicExportPng', 'graphicCopySource']) {
    assert.ok(!state.disabledCommands.includes(command), `${command} 渲染成功态应可用`)
  }
  // 图标降级（#441 资产未接入前）：新 key 的图标位留空不报错（mask 无资产
  // url 是合法降级态，资产后补即生效——不钉住空态本身，只钉不抛错已渲染）
  assert.ok(state.topCommands.includes('graphicPopup'), '图形簇条目真实渲染在菜单中')
  // 弹窗预览：真实点击打开（快照语义与 popup 按钮同一 openGraphicPopup）
  await page.locator('.vsidian-context-menu button[data-vsidian-command="graphicPopup"]').click()
  const overlay = page.locator('.vsidian-diagram-overlay')
  await overlay.waitFor({ state: 'visible' })
  assert.equal(await overlay.getAttribute('role'), 'dialog', '弹窗应为模态对话框')
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-diagram-media svg') !== null, undefined, { timeout: 10000 })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '弹窗命令执行后菜单应关闭')
  // Esc 关闭弹窗（弹窗内键盘局部生效，焦点在 stage）
  await page.keyboard.press('Escape')
  await overlay.waitFor({ state: 'detached' })
  // 复制源码：真实点击 → 桥写围栏源码（零写回）
  await page.evaluate(() => window.clearSent())
  await page.locator('.vsidian-mermaid').first().click({ button: 'right', position: { x: 40, y: 40 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="graphicCopySource"]').click()
  let graphicSent = await page.evaluate(() => window.sent())
  assert.ok(graphicSent.some((m) => m.kind === 'clipboard.write' && m.text === 'graph TD; A-->B;'),
    `复制源码应经桥写围栏源码（实际 ${JSON.stringify(graphicSent.filter((m) => m.kind === 'clipboard.write'))}）`)
  state = await page.evaluate(() => window.readMenu())
  assert.equal(state.text, DOC, '复制源码零写回')
  // 错误降级块：渲染失败 → 弹窗/导出三项置灰、复制源码仍亮（置灰不隐藏）
  // （无效源码文本沿用集成 fixture 已证伪语法——mermaid 对部分自由文本
  // 仍能解析成图，须用确定失败形态）
  const BAD_MERMAID = '```mermaid\nthis is not valid mermaid syntax\n```\n'
  await page.evaluate((t) => {
    // 光标挪文末：围栏在行 0，初始光标（文档首）触及围栏会源码显形不发射
    // widget——呈现态容器无从谈起
    window.initContextMenu(t)
    window.setSelection(t.length, t.length)
  }, BAD_MERMAID)
  await page.waitForFunction(() =>
    document.querySelector('.vsidian-mermaid')?.getAttribute('data-vsidian-mermaid-state') === 'error',
    undefined, { timeout: 30000 })
  await page.locator('.vsidian-mermaid').first().click({ button: 'right', position: { x: 40, y: 20 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.topCommands.includes('graphicPopup'), '错误降级块：图形簇仍呈现（置灰不隐藏）')
  assert.ok(state.disabledCommands.includes('graphicPopup'), '错误降级块：弹窗预览置灰')
  assert.ok(state.disabledCommands.includes('graphicExportSvg'), '错误降级块：导出 SVG 置灰')
  assert.ok(state.disabledCommands.includes('graphicExportPng'), '错误降级块：导出 PNG 置灰')
  assert.ok(!state.disabledCommands.includes('graphicCopySource'), '错误降级块：复制源码仍可用（取源码恰是高价值操作）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  // 还原主 DOC 供后续场景
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForTimeout(120)
  passed++
  console.log('[统一菜单回归][PASS] 图形专属簇：真实右键呈现、弹窗开合、复制源码与错误降级置灰')

  // ---- 场景 H：剪贴板四项（cut/copy/paste/selectAll 真实点击）----
  // 场景 E 的 bold 已改写文档——重装载原始 DOC，后续偏移按 DOC 对拍
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForTimeout(80)
  // 选区内右键保留选区（浏览器行为）：右键点击点落在选区文字上
  await page.evaluate(() => window.clearSent())
  await page.evaluate(({ from, to }) => window.setSelection(from, to),
    { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2 })
  await line(6).click({ button: 'right', position: { x: 12, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.disabledCommands.includes('cut'), '有选区：剪切点亮')
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copy"]').click()
  let sent = await page.evaluate(() => window.sent())
  assert.ok(sent.some((m) => m.kind === 'clipboard.write' && m.text === '普通'),
    `复制应经桥写选区文本（实际 ${JSON.stringify(sent.filter((m) => m.kind === 'clipboard.write'))}）`)
  state = await page.evaluate(() => window.readMenu())
  assert.equal(state.text, DOC, '复制零写回')
  // 剪切：桥写 + 单笔删除
  await page.evaluate(({ from, to }) => window.setSelection(from, to),
    { from: DOC.indexOf('普通'), to: DOC.indexOf('普通') + 2 })
  await line(6).click({ button: 'right', position: { x: 12, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="cut"]').click()
  sent = await page.evaluate(() => window.sent())
  assert.ok(sent.some((m) => m.kind === 'clipboard.write' && m.text === '普通'),
    '剪切应先桥写选区文本')
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('段落一行') && !state.text.includes('普通'),
    `剪切应删除选区（实际片段 ${state.text.slice(18, 30)}）`)
  // 全选：纯选区事务
  await line(6).click({ button: 'right', position: { x: 40, y: 6 } })
  const beforeSelectAll = (await page.evaluate(() => window.readMenu())).text
  await page.locator('.vsidian-context-menu button[data-vsidian-command="selectAll"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.selection.empty && state.selection.from === 0 && state.selection.to === state.text.length,
    `全选应为纯选区事务选全文（实际 ${JSON.stringify(state.selection)}）`)
  assert.equal(state.text, beforeSelectAll, '全选零写回')
  // 粘贴：桥往返（模拟宿主回包——与真实宿主同一消息通道）
  await page.evaluate(() => window.clearSent())
  await line(6).click({ button: 'right', position: { x: 40, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="paste"]').click()
  sent = await page.evaluate(() => window.sent())
  const readMsg = sent.findLast((m) => m.kind === 'clipboard.read')
  assert.ok(readMsg, '粘贴应经宿主剪贴板读桥出站 clipboard.read')
  await page.evaluate((reqId) => window.post(
    { kind: 'clipboard.read.result', reqId, ok: true, text: '桥回文本' }), readMsg.reqId)
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.text.includes('桥回文本'), `宿主回包后应光标处插入（实际片段 ${state.text.slice(18, 34)}）`)
  await page.waitForTimeout(900) // 撤销分段停顿（500ms）+ 出站去抖（250ms）收敛后再计笔数
  sent = await page.evaluate(() => window.sent())
  assert.equal(sent.filter((m) => m.kind === 'edit.request').length, 1,
    '粘贴插入走标准出站一笔')
  passed++
  console.log('[统一菜单回归][PASS] 剪贴板四项：桥写/桥读往返/纯选区事务/单笔删除')

  // ---- 场景 I：块链接两项（自 blockMenu.mjs 迁移，断言语义不变）----
  await page.evaluate(() => window.clearSent())
  // 场景 H 的 cut/paste 已改写文档——重装载原始 DOC（标题行/块链接偏移对拍）
  await page.evaluate((text) => window.initContextMenu(text), DOC)
  await page.waitForTimeout(80)
  // 标题行：复制标题链接 → linkHeading 出站、零写回
  await line(4).click({ button: 'right', position: { x: 40, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.topCommands.includes('copyHeadingLink'), '标题行：复制标题链接在场')
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copyHeadingLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '命令执行后菜单应关闭')
  assert.equal(state.text, DOC, '复制标题链接零写回')
  let headingMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkHeading' in m))
  assert.deepEqual(headingMsg?.linkHeading,
    { docUri: 'file:///d%3A/notes/ctx.md', heading: '标题甲' },
    `linkHeading 应携标题字面文本（实际 ${JSON.stringify(headingMsg)}）`)
  // 无 id 段：自动补写独立行 ^id + linkBlock
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copyBlockLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.match(state.text, /普通段落一行\n\n\^[a-z0-9]{6}\n/,
    `块尾行后应空一行写独立行 id（实际片段 ${JSON.stringify(state.text.split('\n').slice(6, 9))}）`)
  const blockMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'clipboard.write' && 'linkBlock' in m))
  assert.match(blockMsg.linkBlock.blockId, /^[a-z0-9]{6}$/, 'linkBlock 携 6 位随机 id')
  passed++
  console.log('[统一菜单回归][PASS] 块链接迁移：标题链接 linkHeading + 自动补写 linkBlock')

  // ---- 场景 J：快捷键入口（Ctrl+Shift+C）与 Esc 真实键盘关闭 ----
  await page.evaluate(() => window.clearSent())
  await line(6).click({ position: { x: 10, y: 6 } }) // 左键聚焦 + 光标入普通段
  await page.keyboard.press('Control+Shift+c')
  const execMsg = await page.evaluate(() => window.sent().findLast(
    (m) => m.kind === 'keybindings.execute'))
  assert.equal((execMsg).id, 'blockCopyLink', 'ctrl+shift+c 应出站 blockCopyLink')
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  state = await page.evaluate(() => window.readMenu())
  assert.ok(state.menuExists, '前置：菜单已打开')
  await page.keyboard.press('Escape')
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, 'Esc 后菜单应关闭')
  assert.deepEqual(errors, [], '页面无未捕获异常')
  passed++
  console.log('[统一菜单回归][PASS] 快捷键入口 + Esc 真实键盘关闭')

  // ---- 场景 K：菜单键盘可达（打开即聚焦容器（导航起点）+ button 原生可聚焦）----
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  const focusState = await page.evaluate(() => {
    // 打开即聚焦菜单容器（focusMenuDom，tabindex=-1 不进 Tab 序列）——
    // 方向键导航的事件起点；键盘可达的本质仍是 button 元素（Tab/Enter/Space）
    const menu = document.querySelector('.vsidian-context-menu')
    const btn = document.querySelector('.vsidian-context-menu button')
    if (!menu || !btn) return { containerFocused: false, tabindex: null, btnFocusable: false }
    const containerFocused = document.activeElement === menu
    const tabindex = menu.getAttribute('tabindex')
    btn.focus()
    return { containerFocused, tabindex, btnFocusable: document.activeElement === btn }
  })
  assert.ok(focusState.containerFocused, '打开菜单应聚焦容器（键盘导航起点）')
  assert.equal(focusState.tabindex, '-1', '容器 tabindex=-1（不进 Tab 序列）')
  assert.ok(focusState.btnFocusable, '菜单项应可聚焦（button 键盘可达）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 打开即聚焦容器（tabindex=-1）+ 菜单项键盘可达')

  // ---- 场景 L：段落设置勾选（#184 真实右键按行结构点亮，hover 展开子菜单） ----
  const hoverParagraphStyle = async () => {
    await page.locator('.vsidian-context-menu button[data-vsidian-command="paragraphStyle"]').hover()
    await page.waitForTimeout(80)
  }
  // 标题行（真实右键）：H1 勾选、H2 不勾、勾选项 role=menuitemcheckbox
  await line(4).click({ button: 'right', position: { x: 40, y: 6 } })
  await hoverParagraphStyle()
  let checkState = await page.evaluate(() => ({
    h1: window.readMenu().checkedOf('heading1'),
    h2: window.readMenu().checkedOf('heading2'),
    h1Role: document.querySelector('button[data-vsidian-command="heading1"]')?.getAttribute('role') ?? null,
    h2Role: document.querySelector('button[data-vsidian-command="heading2"]')?.getAttribute('role') ?? null,
    // 子菜单分组线（#183 验收反馈）：正文+标题｜列表｜引用——两条真实绘制
    //（computed 非零厚度），且菜单容器无焦点圈（outline:none 修复接线）
    submenuSeps: (() => {
      const btn = document.querySelector('button[data-vsidian-command="paragraphStyle"]')
      const submenu = btn?.closest('.vsidian-context-menu-host')
        ?.querySelector('.vsidian-context-menu-submenu') ?? null
      if (!submenu) return null
      const seps = [...submenu.querySelectorAll(':scope > .vsidian-context-menu-separator')]
      return {
        count: seps.length,
        painted: seps.every((s) => {
          const style = getComputedStyle(s)
          return style.borderTopWidth !== '0px' && style.display !== 'none'
        }),
      }
    })(),
    menuOutline: (() => {
      const menu = document.querySelector('.vsidian-context-menu')
      return menu ? getComputedStyle(menu).outlineStyle : null
    })(),
  }))
  assert.equal(checkState.h1, 'true', '标题行右键：H1 应勾选')
  assert.equal(checkState.h2, null, 'H2 不应勾选')
  assert.equal(checkState.h1Role, 'menuitemcheckbox', '勾选项 role 应为 menuitemcheckbox')
  assert.equal(checkState.h2Role, 'menuitem', '未勾选项回落 menuitem')
  assert.ok(checkState.submenuSeps, '段落设置子菜单应在场')
  assert.equal(checkState.submenuSeps.count, 2, '子菜单应两条分组线（正文+标题｜列表｜引用）')
  assert.ok(checkState.submenuSeps.painted, '子菜单分组线应真实绘制（边框厚度非零）')
  assert.equal(checkState.menuOutline, 'none', '菜单容器不应画焦点圈（焦点圈修复）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  // 任务行（真实右键）：taskList 勾选、bulletList 不勾（族互斥）
  const TASK_DOC = '正文一段\n\n- [ ] 待办任务\n'
  await page.evaluate((t) => window.initContextMenu(t), TASK_DOC)
  await page.waitForTimeout(80)
  await page.locator('.cm-line').nth(2).click({ button: 'right', position: { x: 90, y: 6 } })
  await hoverParagraphStyle()
  checkState = await page.evaluate(() => ({
    task: window.readMenu().checkedOf('taskList'),
    bullet: window.readMenu().checkedOf('bulletList'),
  }))
  assert.equal(checkState.task, 'true', '任务行右键：taskList 应勾选')
  assert.equal(checkState.bullet, null, '任务行：bulletList 不勾（任务标记优先归 task）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  // 普通段（真实右键）：正文（headingNone）勾选
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForTimeout(80)
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await hoverParagraphStyle()
  checkState = await page.evaluate(() => ({
    none: window.readMenu().checkedOf('headingNone'),
    quote: window.readMenu().checkedOf('quote'),
  }))
  assert.equal(checkState.none, 'true', '普通段右键：正文应勾选')
  assert.equal(checkState.quote, null, '普通段：引用不勾')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 段落设置勾选：标题/任务/正文按行结构点亮')

  // ---- 场景 M：键盘方向键导航（规格交互契约：Up/Down 移动、Right 进子级、
  // Left 退出；真实 page.keyboard——ArrowRight 进子级后子菜单须真实可见） ----
  const focusedCommand = () => page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    if (el.tagName === 'BUTTON') return el.dataset['vsidianCommand'] ?? null
    return el.classList?.contains('vsidian-context-menu') ? '<container>' : null
  })
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  // Up/Down 在顶级面移动（真实键盘，事件经焦点元素冒泡到菜单容器）
  await page.keyboard.press('ArrowDown')
  assert.equal(await focusedCommand(), 'wikilink', 'ArrowDown 从容器聚焦首项')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  assert.equal(await focusedCommand(), 'textFormat', 'ArrowDown 连击到簇 2 父项')
  // ArrowRight 进子级：焦点落子菜单首项 + 子菜单真实展开（:focus-within 协同）
  await page.keyboard.press('ArrowRight')
  assert.equal(await focusedCommand(), 'bold', 'ArrowRight 应聚焦子菜单首项')
  let navState = await page.evaluate(() => window.readMenu())
  const navSub = navState.submenus[0]
  assert.equal(navSub.display, 'block', 'ArrowRight 进子级后子菜单应真实可见')
  assert.equal(navSub.parentExpanded, 'true', '父项 aria-expanded 应镜像展开')
  // 子菜单面内 Down 移动；Left 退回父项
  await page.keyboard.press('ArrowDown')
  assert.equal(await focusedCommand(), 'italic', '子菜单面内 ArrowDown 移动')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await focusedCommand(), 'textFormat', 'ArrowLeft 应退回父项')
  await page.keyboard.press('ArrowUp')
  assert.equal(await focusedCommand(), 'copyBlockLink', 'ArrowUp 反向移动')
  // Esc 关整个菜单 + 焦点还回编辑器（打开聚焦容器的对称收尾）
  await page.keyboard.press('Escape')
  navState = await page.evaluate(() => window.readMenu())
  assert.ok(!navState.menuExists, 'Esc 应关闭整个菜单')
  const editorFocused = await page.evaluate(() =>
    document.activeElement?.classList.contains('cm-content') === true)
  assert.ok(editorFocused, '关闭菜单后焦点应还回编辑器（Esc 后继续打字不失效）')
  // Enter 原生 button 承担：ArrowUp 从容器落末项 selectAll → Enter 全选
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.keyboard.press('ArrowUp')
  assert.equal(await focusedCommand(), 'selectAll', 'ArrowUp 从容器聚焦末项')
  await page.keyboard.press('Enter')
  navState = await page.evaluate(() => window.readMenu())
  assert.ok(!navState.menuExists, 'Enter 执行后菜单应关闭')
  assert.ok(!navState.selection.empty && navState.selection.from === 0
    && navState.selection.to === navState.text.length,
    `Enter 应原生激活 button 执行全选（实际 ${JSON.stringify(navState.selection)}）`)
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[统一菜单回归][PASS] 键盘方向键导航：面内移动、进子级真实展开、退回、Enter 执行')

  // ---- 场景 N：块 id 标记淡化绘制（#163 验收线，双形态 computed——自
  // blockMenu.mjs 场景 I 迁回：右键菜单套件承载块 id 绘制证据） ----
  await page.evaluate((t) => window.initContextMenu(t), DOC)
  await page.waitForTimeout(80)
  // 经统一菜单真实链路补写独立行 id（DOC 自带行尾 ^keep1——补写后双形态在场）
  await line(6).click({ button: 'right', position: { x: 60, y: 6 } })
  await page.locator('.vsidian-context-menu button[data-vsidian-command="copyBlockLink"]').click()
  state = await page.evaluate(() => window.readMenu())
  assert.ok(!state.menuExists, '前置：copyBlockLink 执行后菜单关闭')
  const paints = await page.evaluate(() => window.readBlockIdPaint())
  assert.ok(paints.length >= 2, `行尾与独立行双形态标记应各有淡化 span（实际 ${paints.length}）`)
  const hasTail = paints.some((p) => /keep1/.test(p.text))
  const hasStandalone = paints.some((p) => /^ \^[a-z0-9]{6}$|^\^[a-z0-9]{6}$/.test(p.text))
  assert.ok(hasTail, `行尾形态标记应淡化（实际 ${JSON.stringify(paints.map((p) => p.text))}）`)
  assert.ok(hasStandalone, `独立行形态标记应淡化（实际 ${JSON.stringify(paints.map((p) => p.text))}）`)
  const alphaOf = (color) => {
    const rgba = /rgba?\(([^)]+)\)/.exec(color)
    if (rgba) {
      const parts = rgba[1].split(',').map((p) => p.trim())
      return parts.length > 3 ? Number(parts[3]) : 1
    }
    const css = /color\(srgb[^/]*\/\s*([\d.]+)\)/.exec(color)
    return css ? Number(css[1]) : 1
  }
  const bodyColor = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cm-line')).color)
  for (const p of paints) {
    assert.equal(p.display, 'inline', `淡化不得隐藏（${p.text}）`)
    assert.ok(alphaOf(p.color) < alphaOf(bodyColor),
      `标记色 alpha 应低于正文（${p.text}: ${p.color} vs ${bodyColor}）`)
  }
  // 自定义字体色适配：改动正文前景变量后标记色跟随（相对变换而非锚定固定色）
  const beforeFg = paints[0].color
  await page.addStyleTag({ content: ':root { --vscode-editor-foreground: #c01c1c; }' })
  const repaints = await page.evaluate(() => window.readBlockIdPaint())
  assert.notEqual(repaints[0].color, beforeFg,
    `标记色应跟随正文前景变化（适配自定义字体色：${beforeFg} → ${repaints[0].color}）`)
  // 阅读侧隐藏：标记不进阅读渲染（剥离在 markdown-it 解析前）
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'reading' }))
  await page.waitForTimeout(60)
  const readingText = await page.evaluate(() => window.readingText())
  assert.ok(readingText.includes('已有 id 的段落'), '阅读侧正文保留')
  assert.ok(!readingText.includes('keep1') && !readingText.includes('^'),
    `阅读侧不应出现块 id 标记（实际片段 ${JSON.stringify(readingText.slice(-80))}）`)
  passed++
  console.log('[统一菜单回归][PASS] 块 id 双形态淡化 + 自定义字体色适配 + 阅读隐藏（迁移回归）')
} finally {
  await browser.close()
}
console.log(`[统一菜单回归] 全部通过：${passed} 场景`)
