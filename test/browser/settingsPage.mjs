// 设置页生产入口的真实浏览器集成：原生输入、绘制属性、主题与窄屏。
// #95 i18n：页面注入 zh-cn 数据岛首帧装配语言包，文案断言与字典同源
// （不再复制字面量）。#96 起导航默认选中「常规」分组。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'settings/main.js')
await build({ entryPoints: [path.join(root, 'src/webview/settingsMain.ts')], bundle: true, outfile: output, format: 'iife' })
const artifacts = artifactPath(root, 'screenshots/settingsPage')
await mkdir(artifacts, { recursive: true })
// 数据岛与宿主生成点同源；zhCn 为断言取词别名
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } })
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
    const palette = theme === 'light' ? ['#ffffff','#30343b','#f5f6f8','#59616d','#e0e4eb','#26313e','#ffffff','#d7dce3'] : ['#1e1e1e','#dddddd','#252526','#aaaaaa','#373d49','#ffffff','#313136','#474750']
    await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:${palette[0]}; --vscode-editor-foreground:${palette[1]}; --vscode-sideBar-background:${palette[2]}; --vscode-descriptionForeground:${palette[3]}; --vscode-list-activeSelectionBackground:${palette[4]}; --vscode-list-activeSelectionForeground:${palette[5]}; --vscode-input-background:${palette[6]}; --vscode-input-foreground:${palette[1]}; --vscode-panel-border:${palette[7]}; --vscode-focusBorder:#2687d4; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.evaluate(() => {
      window.savedSettings = { 'editor.lineNumbers': true }
      window.sentMessages = []
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.sentMessages.push(message)
        setTimeout(() => {
          if (message.kind === 'settings.set') Object.assign(window.savedSettings, message.values)
          window.dispatchEvent(new MessageEvent('message', { data: { kind: message.kind === 'settings.set' ? 'settings.changed' : 'settings.snapshot', values: window.savedSettings } }))
        }, 0)
      } })
    })
    await page.addScriptTag({ path: output })
    // #96 默认选中分组为「常规」（首个分类）——选中态绘制断言取第一个
    // 导航按钮；「编辑器」按钮仍存在（下一行 exact 匹配保证）
    const nav = page.locator('.vsidian-settings-nav-item').first()
    await nav.waitFor()
    await page.getByRole('button', { name: zhCn['settings.editorCategory'], exact: true }).waitFor()
    const paint = await nav.evaluate(el => {
      const cs = getComputedStyle(el)
      const svg = getComputedStyle(el.querySelector('svg'))
      return { bg: cs.backgroundColor, fg: cs.color, radius: cs.borderRadius, display: cs.display, iconStroke: svg.stroke, iconFill: svg.fill }
    })
    assert.equal(paint.bg, theme === 'light' ? 'rgb(224, 228, 235)' : 'rgb(55, 61, 73)')
    assert.notEqual(paint.fg, paint.bg)
    assert.equal(paint.radius, '9px')
    assert.equal(paint.display, 'flex')
    assert.notEqual(paint.iconStroke, 'none')
    assert.equal(paint.iconFill, 'none')
    await page.screenshot({ path: path.join(artifacts, `settings-${theme}.png`) })
    const search = page.getByRole('searchbox', { name: zhCn['settings.searchAriaLabel'] })
    await search.focus()
    await page.keyboard.type('not found')
    assert.match(await page.locator('.vsidian-settings-list').innerText(), new RegExp(escapeRegExp(zhCn['settings.searchEmpty'].slice(0, 5))))
    await page.keyboard.press('Escape')
    await page.keyboard.insertText('留白带')
    const result = page.locator('.vsidian-settings-result')
    assert.equal(await result.count(), 1)
    assert.match(await result.innerText(), new RegExp(escapeRegExp(zhCn['settings.editorCategory'])))
    await result.click()
    const box = page.getByRole('checkbox', { name: zhCn['setting.editorLineNumbers.title'], exact: true })
    assert.equal(await box.evaluate(el => document.activeElement === el), true)
    // #155 拨动开关（绘制层）：appearance none 纯 CSS 自绘，选中态为强调色
    const switchPaint = await box.evaluate(el => {
      const cs = getComputedStyle(el)
      return { appearance: cs.appearance, radius: cs.borderRadius, width: cs.width,
        checkedBg: cs.backgroundColor }
    })
    assert.equal(switchPaint.appearance, 'none')
    assert.equal(switchPaint.radius, '999px')
    assert.equal(switchPaint.width, '36px')
    assert.equal(switchPaint.checkedBg, 'rgb(38, 135, 212)', '开态轨道应为主题强调色')
    await page.keyboard.press('Space')
    await page.getByRole('status').filter({ hasText: zhCn['settings.saveDone'] }).waitFor()
    assert.equal(await box.isChecked(), false)
    // #155 跟进（真实点击路径）：依赖灰化——关掉「代码块卡片」后子项
    // 「卡内行号」「复制按钮」就地禁用并降不透明度，独立项「语法高亮」不受
    // 影响；重新开卡后子项自动解灰且值未被清除（注册表 dependsOn 驱动）。
    // #163 二轮还原：分类收敛为编辑器页内小节——codeblock.* 控件在
    // 「编辑器」分组页的「代码块」小节内，先进组再取控件
    await page.getByRole('button', { name: zhCn['settings.editorCategory'], exact: true }).click()
    const cardBox = page.getByRole('checkbox', { name: zhCn['setting.codeblockCard.title'], exact: true })
    const lineNumbersBox = page.getByRole('checkbox', { name: zhCn['setting.codeblockLineNumbers.title'], exact: true })
    const copyButtonBox = page.getByRole('checkbox', { name: zhCn['setting.codeblockCopyButton.title'], exact: true })
    const highlightBox = page.getByRole('checkbox', { name: zhCn['setting.codeblockHighlight.title'], exact: true })
    assert.equal(await lineNumbersBox.isDisabled(), false, '卡片开（默认）时卡内行号应可用')
    await cardBox.click()
    await page.getByRole('status').filter({ hasText: zhCn['settings.saveDone'] }).waitFor()
    assert.equal(await lineNumbersBox.isDisabled(), true, '卡片关闭后卡内行号应禁用')
    assert.equal(await copyButtonBox.isDisabled(), true, '卡片关闭后复制按钮应禁用')
    assert.equal(await highlightBox.isDisabled(), false, '语法高亮独立于卡片，不应受影响')
    const dimPaint = await lineNumbersBox.evaluate(el => {
      const label = el.closest('.vsidian-settings-item')?.querySelector('.vsidian-settings-item-label')
      return { opacity: getComputedStyle(label).opacity, disabled: el.disabled }
    })
    assert.equal(dimPaint.opacity, '0.55', '依赖禁用条目应降不透明度（灰化可见）')
    await page.screenshot({ path: path.join(artifacts, `settings-${theme}-deps-disabled.png`) })
    await cardBox.click()
    await page.getByRole('status').filter({ hasText: zhCn['settings.saveDone'] }).waitFor()
    assert.equal(await lineNumbersBox.isDisabled(), false, '重新开卡后子项自动解灰')
    assert.equal(await lineNumbersBox.isChecked(), true, '依赖关闭期间子项值不被清除')
    const restorePaint = await lineNumbersBox.evaluate(el =>
      getComputedStyle(el.closest('.vsidian-settings-item')?.querySelector('.vsidian-settings-item-label')).opacity)
    assert.equal(restorePaint, '1', '解灰后不透明度恢复')
    // #155 独立滚动骨架（绘制层，编辑器分组内容超一屏）：主区滚动时侧栏静止；
    // 切过分页后主区滚动复位、根元素不整体滚动。#163 二轮还原后编辑器页
    // 内置四小节（生产注册表 11 项）天然超一屏，直接承载本探针
    const scrollProbe = await page.evaluate(() => {
      const main = document.querySelector('.vsidian-settings-main')
      const sidebar = document.querySelector('.vsidian-settings-sidebar')
      const heading = document.querySelector('.vsidian-settings-heading')
      const sidebarTop = sidebar.getBoundingClientRect().top
      const headingTop = heading.getBoundingClientRect().top
      main.scrollTop = main.scrollHeight
      const probe = {
        mainOverflow: getComputedStyle(main).overflowY,
        sidebarOverflow: getComputedStyle(sidebar).overflowY,
        mainScrollable: main.scrollHeight > main.clientHeight,
        scrolled: main.scrollTop > 0,
        sidebarStatic: sidebar.getBoundingClientRect().top === sidebarTop,
        headingMovedUp: heading.getBoundingClientRect().top < headingTop,
        sidebarNotScrollable: sidebar.scrollHeight <= sidebar.clientHeight,
        docNotScrollable: document.documentElement.scrollHeight <= innerHeight,
      }
      main.scrollTop = 0
      return probe
    })
    assert.equal(scrollProbe.mainOverflow, 'auto')
    assert.equal(scrollProbe.sidebarOverflow, 'auto')
    assert.equal(scrollProbe.mainScrollable, true, '编辑器条目应超出主区视口高度（可滚）')
    assert.equal(scrollProbe.scrolled, true)
    assert.equal(scrollProbe.sidebarStatic, true, '主区滚动时侧栏应保持静止（独立滚动容器）')
    assert.equal(scrollProbe.headingMovedUp, true, '主区内容应随滚动移动')
    assert.equal(scrollProbe.sidebarNotScrollable, true, '侧栏内容不超一屏时应无滚动')
    assert.equal(scrollProbe.docNotScrollable, true, '页面根不应再整体滚动')
    // #155 分组容器色差（绘制层）：容器底色 = 前景 4% 叠加正文背景，
    // 且与正文底色确有色差（色值序列化随内核以页面内同公式探针比对）。
    // #163 二轮还原后正停在「编辑器」分组——首个容器即「显示」小节
    const groupPaint = await page.evaluate(() => {
      const group = document.querySelector('.vsidian-settings-group')
      const probe = document.createElement('div')
      probe.style.background = 'color-mix(in srgb, var(--vscode-editor-foreground) 4%, var(--vscode-editor-background))'
      document.body.append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      const cs = getComputedStyle(group)
      return { bg: cs.backgroundColor, expected, radius: cs.borderRadius,
        borderWidth: cs.borderWidth, bodyBg: getComputedStyle(document.body).backgroundColor }
    })
    assert.equal(groupPaint.bg, groupPaint.expected, '容器底色应为前景 4% 叠加正文背景')
    assert.notEqual(groupPaint.bg, groupPaint.bodyBg, '容器与正文应有可辨色差')
    assert.equal(groupPaint.radius, '10px')
    assert.equal(groupPaint.borderWidth, '1px')
    await search.focus()
    await page.keyboard.press('Control+b')
    assert.equal(await page.evaluate(() => window.sentMessages.filter(m =>
      m.kind !== 'settings.get' && m.kind !== 'settings.set' &&
      m.kind !== 'keybindings.get' && m.kind !== 'snippets.get').length), 0)
    const focus = await search.evaluate(el => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }))
    assert.equal(focus.style, 'solid')
    assert.equal(focus.width, '2px')
    // #145 样式参考分页：#155 小改起为总分页签——默认「样式参考」总表，
    // 点「详细查询」进小类分栏（类目 + 分页 + 跨类目聚合搜索 + 导出）
    await page.getByRole('button', { name: zhCn['styleRef.title'], exact: true }).click()
    const refTabs = page.locator('.vsidian-style-ref-tab')
    await refTabs.first().waitFor()
    assert.equal(await refTabs.count(), 2)
    assert.equal(await refTabs.nth(0).textContent(), zhCn['styleRef.tabOverview'])
    assert.equal(await refTabs.nth(1).textContent(), zhCn['styleRef.tabDetail'])
    // 默认总表可见、详细查询隐藏；页签 pill 形态、激活态为主题选中色（绘制层）
    assert.equal(await page.locator('.vsidian-style-ref-overview').isVisible(), true)
    assert.equal(await page.locator('.vsidian-style-ref-detail').isVisible(), false)
    const tabPaint = await refTabs.nth(0).evaluate(el => ({ radius: getComputedStyle(el).borderRadius }))
    assert.equal(tabPaint.radius, '999px')
    await refTabs.nth(1).click()
    assert.equal(await refTabs.nth(1).getAttribute('aria-selected'), 'true')
    assert.equal(await refTabs.nth(0).getAttribute('aria-selected'), 'false')
    assert.equal(await page.locator('.vsidian-style-ref-overview').isVisible(), false)
    const activeTabPaint = await refTabs.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)
    assert.equal(activeTabPaint, theme === 'light' ? 'rgb(224, 228, 235)' : 'rgb(55, 61, 73)')
    // #155 跟进（绘制层）：详细查询页签下主区收起滚动，类目栏与条目列表各自
    // 独立 overflow；过滤/搜索/导出工具行固定在列表滚动区之外
    const refScrollProbe = await page.evaluate(() => {
      const mainEl = document.querySelector('.vsidian-settings-main')
      const cats = document.querySelector('.vsidian-style-ref-cats')
      const list = document.querySelector('.vsidian-style-ref-list')
      const bar = document.querySelector('.vsidian-style-ref-bar')
      return {
        mainOverflow: getComputedStyle(mainEl).overflowY,
        catsOverflow: getComputedStyle(cats).overflowY,
        listOverflow: getComputedStyle(list).overflowY,
        barAboveList: bar.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 1,
      }
    })
    assert.equal(refScrollProbe.mainOverflow, 'hidden', '详细查询页签下主区应收起滚动')
    assert.equal(refScrollProbe.catsOverflow, 'auto')
    assert.equal(refScrollProbe.listOverflow, 'auto')
    assert.equal(refScrollProbe.barAboveList, true, '工具行应固定在列表滚动区之外')
    // 页签往返：切回总表主区恢复整块滚动，再进详细查询恢复内部滚动
    await refTabs.nth(0).click()
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vsidian-settings-main')).overflowY), 'auto')
    assert.equal(await page.locator('.vsidian-style-ref-overview').isVisible(), true)
    await refTabs.nth(1).click()
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vsidian-settings-main')).overflowY), 'hidden')
    const catsNav = page.locator('.vsidian-style-ref-cats')
    await catsNav.waitFor()
    await page.locator('.vsidian-style-ref-cats-domain').first().waitFor()
    // 类目栏可见且带计数（大纲面板 19 条）；默认选中首个类目（绘制层断言）
    const outlineCat = page.locator('.vsidian-style-ref-cat[data-category="outline"]')
    assert.match(await outlineCat.textContent(), /19/)
    const activeCat = page.locator('.vsidian-style-ref-cat[aria-current="true"]')
    assert.equal(await activeCat.count(), 1)
    const catPaint = await activeCat.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }))
    assert.equal(catPaint.bg, theme === 'light' ? 'rgb(224, 228, 235)' : 'rgb(55, 61, 73)')
    assert.notEqual(catPaint.fg, catPaint.bg)
    // 类目切换 + 分页：大纲 19 条 → 2 页，翻页后内容与页码变化
    await outlineCat.click()
    const pagerIndicator = page.locator('.vsidian-style-ref-page-indicator')
    await pagerIndicator.waitFor()
    // 切到大类目后列表内容超出视口：滚动发生在列表内部（独立 overflow 的可见效果）
    assert.equal(await page.evaluate(() => {
      const list = document.querySelector('.vsidian-style-ref-list')
      return list.scrollHeight > list.clientHeight
    }), true, '大纲类目应超出列表视口（列表独立可滚）')
    assert.equal(await pagerIndicator.textContent(), zhCn['styleRef.pageIndicator'].replace('{page}', '1').replace('{pages}', '2'))
    const firstPageIds = await page.locator('.vsidian-style-ref-entry').evaluateAll(els => els.map(el => el.dataset.entry))
    assert.equal(firstPageIds.length, 15)
    await page.getByRole('button', { name: zhCn['styleRef.nextPage'] }).click()
    assert.equal(await pagerIndicator.textContent(), zhCn['styleRef.pageIndicator'].replace('{page}', '2').replace('{pages}', '2'))
    const secondPageIds = await page.locator('.vsidian-style-ref-entry').evaluateAll(els => els.map(el => el.dataset.entry))
    assert.equal(secondPageIds.length, 4)
    assert.notDeepEqual(secondPageIds, firstPageIds)
    // 跨类目聚合搜索：命中计数 + 来源类目标注可见
    const refSearch = page.locator('.vsidian-style-ref-search')
    await refSearch.fill('wikilink')
    const chip = page.locator('[data-entry="live-wikilink"] .vsidian-style-ref-cat-chip')
    await chip.waitFor()
    assert.equal(await chip.textContent(), zhCn['styleRef.category.linkImageWikilink'])
    assert.ok(await page.locator('[data-entry="reading-wikilink"]').isVisible())
    // 导出按钮：点击经消息桥请求宿主（真实按钮路径）
    await page.getByRole('button', { name: zhCn['styleRef.exportJson'], exact: true }).click()
    assert.equal(await page.evaluate(() => window.sentMessages.some(m => m.kind === 'styleRef.export')), true)
    await page.screenshot({ path: path.join(artifacts, `settings-${theme}-style-ref.png`) })
    // #155 小改：CSS 片段远程缓存说明为 callout 形态（左强调条 + 圆角色底，绘制层）
    await page.getByRole('button', { name: zhCn['cssSnippets.title'], exact: true }).click()
    const remoteNote = page.locator('.vsidian-css-snippets-remote-note')
    await remoteNote.waitFor()
    const calloutPaint = await remoteNote.evaluate(el => {
      const cs = getComputedStyle(el)
      return { borderLeftWidth: cs.borderLeftWidth, radius: cs.borderRadius, bg: cs.backgroundColor }
    })
    assert.equal(calloutPaint.borderLeftWidth, '3px')
    assert.equal(calloutPaint.radius, '8px')
    assert.notEqual(calloutPaint.bg, 'rgba(0, 0, 0, 0)', 'callout 应有可辨色底')
    await page.screenshot({ path: path.join(artifacts, `settings-${theme}-css-snippets.png`) })
    // 切回编辑器分组再走窄屏断言（分页切换会卸载前一分组内容）
    await page.getByRole('button', { name: zhCn['settings.editorCategory'], exact: true }).click()
    await page.setViewportSize({ width: 360, height: 740 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await box.isVisible(), true)
    // #155 跟进（窄屏退化契约）：侧栏恢复整页滚动（不再独立 overflow）；
    // 详细查询页签在窄屏下不做内部双列滚动，主区回到整块滚动
    assert.deepEqual(await page.evaluate(() => ({
      sidebar: getComputedStyle(document.querySelector('.vsidian-settings-sidebar')).overflowY,
      main: getComputedStyle(document.querySelector('.vsidian-settings-main')).overflowY,
    })), { sidebar: 'visible', main: 'auto' })
    await page.getByRole('button', { name: zhCn['styleRef.title'], exact: true }).click()
    await page.locator('.vsidian-style-ref-tab').nth(1).click()
    assert.equal(await page.evaluate(() =>
      getComputedStyle(document.querySelector('.vsidian-settings-main')).overflowY), 'auto',
    '窄屏下详细查询页签应恢复整页滚动')
    await page.screenshot({ path: path.join(artifacts, `settings-${theme}-narrow.png`) })
    assert.deepEqual(errors, [])
    console.log(`[设置页][PASS] ${theme}：主题绘制、图标、原生搜索、定位、保存、焦点与 360px 窄屏`)
    await page.close()
  }
} finally { await browser.close() }

/** 断言用的最简正则转义（词条含（）等全角标点，仅 () 需转义） */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
