// 使用浏览器原生按键与组合输入，避免 dispatchEvent/execCommand 遗漏事件顺序。
// 默认使用 Playwright Chromium；可设 VSIDIAN_TEST_BROWSER_CHANNEL=msedge。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'tableCaret/tableCaret.js')
// #59 公式依赖（与 esbuild.mjs 生产构建同口径）：
// - 裸导入 `katex` 重定向到官方预压缩 UMD（dist/katex.min.js，约 272 KB），
//   与 esbuild 的 ESM 源打包相比省 500 KB+；
// - fixture 经 `import 'katex/dist/katex.min.css'` 引入 KaTeX 样式，本插件
//   裁掉 css 里的 woff/ttf 字体回退引用（只留 woff2，chrome/chromium 足够），
//   字体文件由 loader 产物化到本轮 tableCaret/assets/。
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
const katexMinJs = {
  name: 'katex-min-js',
  setup(b) {
    b.onResolve({ filter: /^katex$/ }, () => ({
      path: path.resolve(root, 'node_modules/katex/dist/katex.min.js'),
    }))
  },
}
await build({ entryPoints: [path.join(root, 'test/browser/tableCaretFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  for (const row of process.argv.includes('--navigation-only') ? [] : [0, 1]) for (const mode of ['english', 'ime']) {
    for (const deletion of ['backspace', 'delete', 'selection', 'empty-source']) {
      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        await page.setContent('<div id="app"></div>')
        await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
        await page.addScriptTag({ path: bundle })
        await page.evaluate((empty) => window.initTable(`| 带 |${empty ? '' : 'middle'}| 送 |\n| --- | --- | --- |\n| 左 |${empty ? '' : 'middle'}| 右 |\n`), deletion === 'empty-source')
        const cell = page.locator('.vsidian-table-grid-row').nth(row).locator('.vsidian-table-grid-cell').nth(1)
        await cell.click()
        if (deletion === 'selection') {
          await page.keyboard.press('Control+a')
          await page.keyboard.press('Backspace')
        } else if (deletion !== 'empty-source') {
          // 行首/行尾按键会跳出单元格，因此先按格内全选定位端点。
          await page.keyboard.press('Control+a')
          await page.keyboard.press(deletion === 'backspace' ? 'ArrowRight' : 'ArrowLeft')
          for (let i = 0; i < 10; i++) await page.keyboard.press(deletion === 'backspace' ? 'Backspace' : 'Delete')
        }
        async function snapshot() {
          return page.evaluate((row) => {
            const cells = document.querySelectorAll('.vsidian-table-grid-row')[row].querySelectorAll('.vsidian-table-grid-cell')
            const selection = getSelection()
            const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null
            const box = cells[1].getBoundingClientRect()
            const walker = document.createTreeWalker(cells[1], NodeFilter.SHOW_TEXT)
            let lastText = null
            while (walker.nextNode()) if (walker.currentNode.textContent.length) lastText = walker.currentNode
            let paddingWidth = 0
            if (lastText?.textContent.endsWith(' ')) {
              const padding = document.createRange()
              padding.setStart(lastText, lastText.textContent.length - 1)
              padding.setEnd(lastText, lastText.textContent.length)
              paddingWidth = padding.getBoundingClientRect().width
            }
            return { middle: cells[1].textContent, caretX: rect?.x,
              paddingWidth,
              left: cells[0].textContent.trim(), right: cells[2].textContent.trim(),
              caretInside: cells[1].contains(selection?.focusNode),
              caretPainted: !!rect && rect.height > 0 && rect.x >= box.left && rect.x < box.right }
          }, row)
        }
        async function check(value, step) {
          const state = await snapshot()
          assert.equal(state.middle.trim(), value, `${step}: ${JSON.stringify(state)}`)
          assert.equal(state.paddingWidth, 0, `${step} 填充空格不得占据可见宽度`)
          assert(state.caretInside && state.caretPainted, `${step} 光标必须在中格: ${JSON.stringify(state)}`)
          assert.equal(state.left, row === 0 ? '带' : '左')
          assert.equal(state.right, row === 0 ? '送' : '右')
        }
        if (deletion !== 'empty-source') {
          await check('', '删光后')
          const empty = await snapshot()
          for (let i = 0; i < 2; i++) {
            await page.evaluate(() => document.activeElement.blur())
            await cell.click()
            const refocused = await snapshot()
            assert.equal(refocused.middle, empty.middle, '失焦再聚焦不得修改填充空白')
            assert.equal(refocused.caretX, empty.caretX, '重新聚焦空格后光标不得越过填充空格')
          }
        }
        await page.keyboard.press('ArrowLeft')
        const leftFocused = await page.evaluate((row) => {
          const left = document.querySelectorAll('.vsidian-table-grid-row')[row].querySelectorAll('.vsidian-table-grid-cell')[0]
          return left.contains(getSelection()?.focusNode)
        }, row)
        assert(leftFocused, '中格格首左移应把真实光标移到左格')
        await page.keyboard.type('x')
        assert.equal((await snapshot()).left, row === 0 ? '带x' : '左x', '左移后文字须输入左格')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('ArrowRight')
        if (deletion !== 'empty-source') await check('', '从左格向右回到空中格')
        if (mode === 'english') {
          for (let i = 1; i <= 8; i++) {
            await page.keyboard.type('s')
            await check('s'.repeat(i), `英文第 ${i} 次输入`)
          }
        } else {
          const cdp = await page.context().newCDPSession(page)
          for (const text of ['s', 'sh', 'shi']) {
            await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
            await check(text, `IME 候选 ${text}`)
          }
          await cdp.send('Input.insertText', { text: '是' })
          await check('是', 'IME 确认')
        }
        await page.keyboard.press('ArrowLeft')
        await check(mode === 'english' ? 'ssssssss' : '是', '格内向左逐字移动')
        await page.keyboard.press('ArrowRight')
        await check(mode === 'english' ? 'ssssssss' : '是', '格内向右逐字移动')
        const beforeSpace = await snapshot()
        await page.keyboard.type(' ')
        const withSpace = await snapshot()
        assert(withSpace.caretX > beforeSpace.caretX, '用户自己键入的空格必须仍有可见宽度')
        await page.keyboard.press('Backspace')
        await check(mode === 'english' ? 'ssssssss' : '是', '删除用户输入的空格')
        await page.keyboard.press('ArrowRight')
        const rightFocused = await page.evaluate((row) => {
          const right = document.querySelectorAll('.vsidian-table-grid-row')[row].querySelectorAll('.vsidian-table-grid-cell')[2]
          return right.contains(getSelection()?.focusNode)
        }, row)
        assert(rightFocused, '中格格尾右移应把真实光标移到右格')
        await page.keyboard.type('x')
        assert.equal((await snapshot()).right, row === 0 ? 'x送' : 'x右', '右移后文字须输入右格')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('Backspace')
        await check(mode === 'english' ? 'sssssss' : '', '立即退格')
        assert.deepEqual(errors, [])
        passed++
        console.log(`[原生输入][PASS] ${row === 0 ? '表头' : '数据行'} ${deletion} → ${mode} → Backspace`)
      } finally { await page.close() }
    }
  }
  const navigationFailures = []
  for (const scenario of ['horizontal-wrap', 'horizontal-wrap-empty', 'vertical-inside', 'vertical-outside', 'vertical-empty', 'vertical-wrapped', 'enter-cell', 'enter-empty', 'enter-body', 'enter-middle', 'enter-repeat', 'enter-code', 'enter-code-start', 'enter-code-end', 'enter-ime', 'drag-row', 'drag-column', 'region-copy', 'region-exit-outside', 'region-drag-live-selection', 'region-drag-fulltable-mask', 'region-drag-caret-yield', 'region-drag-caret-yield-empty', 'region-type', 'region-paste', 'region-paste-grid', 'region-ime', 'region-zero-width', 'region-zero-width-ime', 'region-padded-drag', 'header-clear', 'empty-row-backspace', 'empty-row-realclick', 'empty-cell-padding', 'handle-row', 'handle-column', 'handle-cross-row', 'handle-cross-column', 'handle-hover', 'column-width', 'height-optimize', 'height-optimize-multi', 'height-optimize-wide', 'drag-table-outside']) {
    const page = await browser.newPage()
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
      await page.addScriptTag({ path: bundle })
      let source = 'BEFORE\n\n| H1 | H2 |\n| --- | --- |\n| B1 | B2 |\n| C1 | C2 |\n\nAFTER'
      if (scenario === 'horizontal-wrap-empty') source = source.replace('| B1 | B2 |', '| | |')
      if (scenario === 'vertical-empty') source = source.replace(' B2 ', ' ')
      if (scenario === 'vertical-wrapped') source = source.replace('H2', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')
      if (scenario === 'empty-row-backspace') source = source.replace('| B1 | B2 |', '|  |  |')
      if (scenario === 'empty-row-realclick') source = source.replace('| B1 | B2 |', '|  |  |')
      if (scenario === 'empty-cell-padding') source = source.replace('| B1 | B2 |', '|  | B2 |')
      if (scenario === 'header-clear') source = source.replace('| H1 | H2 |', '| H1 |  |')
      if (scenario === 'handle-column') source = source.replace('| --- | --- |', '| :--- | ---: |')
      if (scenario.startsWith('region-zero-width')) source = 'BEFORE\n\n|H1|H2|\n|---|---|\n||B2|\n|C1|C2|\n\nAFTER'
      if (scenario === 'region-padded-drag') source = 'BEFORE\n\n|H1|H2|\n|---|---|\n| |B2|\n|C1|C2|\n\nAFTER'
      if (scenario === 'region-drag-caret-yield-empty') source = 'BEFORE\n\n|H1|H2|\n|---|---|\n||B2|\n|C1|C2|\n\nAFTER'
      if (scenario === 'column-width') source = 'BEFORE\n\n| 短 | 这是一个内容比较长的表头列 |\n| --- | --- |\n| a | 这一列内容明显更长更长更长 |\n| b | 短 |\n\nAFTER'
      if (scenario === 'height-optimize') {
        source = 'BEFORE\n\n| 功能 | 说明 |\n| --- | --- |\n| 悬停文档预览 | Ctrl+悬停链接预览目标：笔记显示全文与章节或块引用，浮窗内可直接编辑保存；代码等文本文件按 VSCode 原生着色只读显示；PDF 分页浏览、文字可复制可缩放。 |\n| 跳转目标提示 | 悬停链接不弹预览浮层时，短暂停留显示目标路径与锚点的小浮标，双模式均可用。 |\n\nAFTER'
      }
      if (scenario === 'height-optimize-multi') {
        // #373 冻结三列样例：六字短标签列 + 说明/备注交替长段落 + 周期性全短行
        // （30 数据行，足以滚动出视口重挂）；基线把宽度过度分给长列，短标签
        // 列接近下限多行折行，优化后空间回填短标签列、全短行高度下降
        const labels = ['悬停文档预览', '跳转目标提示', '引用自动更新', '图片粘贴插入', '表格列宽分配', '大纲样式装饰']
        const rows = []
        for (let i = 0; i < 30; i++) {
          const label = labels[i % labels.length]
          if (i % 3 === 2) {
            rows.push(`| ${label} | 短说明${i} | 备${i} |`)
          } else if (i % 2 === 0) {
            rows.push(`| ${label} | ${label}承载较长说明文字：基线下该列被长内容占据大部分宽度，标签列被压窄而逐字折行，离开编辑后整表高度优化应把宽度回填标签列并压缩全表高度（第${i}段）。 | 备注第${i}条 |`)
          } else {
            rows.push(`| ${label} | 说明第${i}段 | ${label}的备注列承载较长内容：与说明列交替驱动行高，验证多列阈值贪心转移在两长列间平衡分配（第${i}条）。 |`)
          }
        }
        source = `BEFORE\n\n| 功能 | 说明 | 备注 |\n| --- | --- | --- |\n${rows.join('\n')}\n\nAFTER`
      }
      if (scenario === 'height-optimize-wide') {
        // #373 冻结六列样例：短标签 + 两长列 + 三短列，预算内（20 行 × 6 列）
        const labels = ['悬停预览', '跳转提示', '自动更新', '粘贴插入', '列宽分配', '样式装饰']
        const rows = []
        for (let i = 0; i < 20; i++) {
          const label = labels[i % labels.length]
          rows.push(i % 3 === 2
            ? `| ${label} | 短${i} | 备${i} | 序${i} | 号${i} | 短 |`
            : `| ${label} | 说明文字第${i}段承载较长内容驱动行高，优化后短标签列回填宽度减少折行。 | 备注内容第${i}条交替驱动行高，与说明列平衡分配可用宽度。 | ${i} | x${i} | 尾 |`)
        }
        source = `BEFORE\n\n| 功能 | 说明 | 备注 | 序号 | 标记 | 尾列 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nAFTER`
      }
      if (scenario.startsWith('handle-cross-')) source += '\n\n| X1 | X2 |\n| --- | --- |\n| Y1 | Y2 |'
      if (scenario === 'enter-empty') source = source.replace('H2', '')
      if (scenario.startsWith('enter-code')) source = source.replace('H2', '`H2`')
      if (scenario === 'region-copy') {
        source = 'BEFORE\n\n| 水果 | 数量 | 单价 |\n| --- | --- | --- |\n| 苹果 | 3 | 5.5 |\n| 香蕉 | 5 | 2.8 |\n| 樱桃 | 12 | 18.0 |\n\nAFTER'
        await page.addStyleTag({ content: ':root { color-scheme: dark; --vscode-editor-background: #1e2229; --vscode-editor-foreground: #d4d4d4; --vscode-panel-border: #4b525a; --vscode-focusBorder: #77b8da; } #app { background:#1e2229; color:#d4d4d4; font-family: sans-serif; font-size: 17px; }' })
      }
      await page.evaluate((text) => window.initTable(text), source)
      const cell = (r, c) => page.locator('.vsidian-table-grid-row').nth(r).locator('.vsidian-table-grid-cell').nth(c)
      const captureTable = async (name) => {
        const first = await page.locator('.vsidian-table-grid-row').first().boundingBox()
        const last = await page.locator('.vsidian-table-grid-row').last().boundingBox()
        await page.screenshot({ path: artifactPath(root, name), clip: {
          x: Math.max(0, first.x - 28), y: Math.max(0, first.y - 28),
          width: first.width + 58, height: last.y + last.height - first.y + 58,
        } })
      }
      async function checkCell(r, c) {
        const state = await page.evaluate(({ r, c }) => {
          const target = document.querySelectorAll('.vsidian-table-grid-row')[r].querySelectorAll('.vsidian-table-grid-cell')[c]
          const sel = getSelection()
          const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
          const box = target.getBoundingClientRect()
          return { ...window.readEditor(), inside: target.contains(sel?.focusNode), painted: !!rect && rect.height > 0 &&
            rect.x >= box.left && rect.x < box.right && rect.y >= box.top && rect.y < box.bottom }
        }, { r, c })
        assert(state.inside && state.painted, `${scenario} 光标应在 ${r}/${c}: ${JSON.stringify(state)}`)
        assert.equal(state.text, source, '方向键不得修改源文')
        await page.keyboard.type('x')
        const typed = await page.evaluate(() => window.readEditor())
        assert.equal(typed.text, source.slice(0, state.head) + 'x' + source.slice(state.head), '真实输入位置须与导航位置一致')
        await page.keyboard.press('Backspace')
      }
      if (scenario === 'region-padded-drag') {
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 4, a.y + a.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + 14, b.y + b.height / 2, { steps: 6 })
        await page.mouse.up()
        assert.equal(await page.locator('.vsidian-table-region-cell').count(), 4,
          '空白首格拖选到对角格仍须形成四格矩形')
      } else if (scenario.startsWith('region-zero-width')) {
        await page.locator('.vsidian-table-row-handle').nth(1).click()
        const selected = await page.evaluate(() => ({ ...window.readEditor(),
          region: document.querySelectorAll('.vsidian-table-region-cell').length,
          row: document.querySelectorAll('.vsidian-table-row-selected').length,
          focused: document.activeElement?.className }))
        assert.equal(selected.region, 2, `零宽行把手须选整行: ${JSON.stringify(selected)}`)
        await page.evaluate(() => window.controller.getView().focus())
        if (scenario === 'region-zero-width') await page.keyboard.type('X')
        else {
          const cdp = await page.context().newCDPSession(page)
          for (const text of ['ni', 'nihao']) await cdp.send('Input.imeSetComposition',
            { text, selectionStart: text.length, selectionEnd: text.length })
          await cdp.send('Input.insertText', { text: '你好' })
          await page.waitForTimeout(30)
        }
        const actual = (await page.evaluate(() => window.readEditor())).text
        assert(actual.includes(scenario === 'region-zero-width' ? '|X| |' : '|你好| |') && !actual.includes('B2'),
          `零宽首格整行区域输入须清邻格并保留列数: ${actual}`)
      } else if (['region-type', 'region-paste', 'region-ime'].includes(scenario)) {
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 14, a.y + a.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + 26, b.y + b.height / 2, { steps: 6 })
        await page.mouse.up()
        assert.equal(await page.locator('.vsidian-table-region-cell').count(), 4)
        if (scenario === 'region-type') await page.keyboard.type('X')
        else if (scenario === 'region-paste') await page.evaluate(() => {
          const data = new DataTransfer()
          data.setData('text/plain', '中|文\n第二行')
          document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',
            { clipboardData: data, bubbles: true, cancelable: true }))
        })
        else {
          const cdp = await page.context().newCDPSession(page)
          for (const text of ['ni', 'nihao']) await cdp.send('Input.imeSetComposition',
            { text, selectionStart: text.length, selectionEnd: text.length })
          await cdp.send('Input.insertText', { text: '你好' })
          await page.waitForTimeout(30)
        }
        const actual = (await page.evaluate(() => window.readEditor())).text
        assert(!actual.includes('B1') && !actual.includes('B2') && !actual.includes('C1') && !actual.includes('C2'),
          `${scenario} 须清除矩形所有旧格内容: ${actual}`)
        assert(actual.includes(scenario === 'region-type' ? '| X |  |'
          : scenario === 'region-paste' ? '| 中\\|文<br>第二行 |  |' : '| 你好 |  |'),
        `${scenario} 新内容应仅落左上格: ${actual}`)
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 3, '替换区域不得删除表格结构')
      } else if (scenario === 'handle-cross-row' || scenario === 'handle-cross-column') {
        const selector = scenario === 'handle-cross-row' ? '.vsidian-table-row-handle' : '.vsidian-table-column-handle'
        const from = await page.locator(selector).nth(scenario === 'handle-cross-row' ? 1 : 0).boundingBox()
        const to = await page.locator(selector).nth(scenario === 'handle-cross-row' ? 4 : 3).boundingBox()
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
        await page.mouse.up()
        assert.equal((await page.evaluate(() => window.readEditor())).text, source,
          '把手落到另一张表格时不得修改源表格')
      } else if (scenario === 'handle-row') {
        const from = await page.locator('.vsidian-table-row-handle').nth(2).boundingBox()
        const to = await page.locator('.vsidian-table-row-handle').nth(0).boundingBox()
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 8 })
        assert(await page.locator('.vsidian-table-drop-before').count() > 0, '沿左侧把手栏拖动须绘出插入线')
        await page.mouse.up()
        assert((await page.evaluate(() => window.readEditor())).text.includes('| C1 | C2 |\n| --- | --- |\n| H1 | H2 |'),
          '数据行移到顶部后须升为表头，原表头成为数据行')
      } else if (scenario === 'handle-column') {
        const from = await page.locator('.vsidian-table-column-handle').nth(1).boundingBox()
        const to = await page.locator('.vsidian-table-column-handle').nth(0).boundingBox()
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(to.x + 2, from.y + from.height / 2, { steps: 8 })
        assert(await page.locator('.vsidian-table-column-drop-before').count() > 0, '沿上方把手栏拖动须绘出列插入线')
        await page.mouse.up()
        const text = (await page.evaluate(() => window.readEditor())).text
        assert(text.includes('| H2 | H1 |\n| ---: | :--- |\n| B2 | B1 |'), `列拖排须连对齐信息一同移动: ${text}`)
      } else if (scenario === 'handle-hover') {
        const band = page.locator('.vsidian-table-insert-row')
        const rect = await cell(2, 0).boundingBox()
        const opacity = () => band.evaluate(e => getComputedStyle(e).opacity)
        assert.equal(await opacity(), '0', '新增行带平时不可见')
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 2)
        assert.equal(await opacity(), '1', '靠近表格底边新增行带出现')
        await captureTable('table-add-row-band.png')
        const bandRect = await band.boundingBox()
        await page.mouse.move(bandRect.x + bandRect.width / 2, bandRect.y + bandRect.height / 2)
        assert.equal(await opacity(), '1', '移入新增带不得闪退')
        await page.mouse.move(600, 400)
        assert.equal(await opacity(), '0', '离开表格后新增带隐藏')
        const right = await cell(1, 1).boundingBox()
        await page.mouse.move(right.x + right.width - 2, right.y + right.height / 2)
        const colBand = page.locator('.vsidian-table-insert-column')
        assert.equal(await colBand.evaluate(e => getComputedStyle(e).opacity), '1', '靠近右边新增列带出现')
        await captureTable('table-add-column-band.png')
        const header = await cell(0, 0).boundingBox()
        await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2)
        await captureTable('table-edge-handles.png')
      } else if (scenario === 'header-clear') {
        await cell(0, 0).click()
        await page.keyboard.press('Control+a')
        await page.keyboard.press('Backspace')
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 3, '清空唯一有字表头格仍须保留可编辑网格')
        await page.keyboard.type('新')
        assert((await page.evaluate(() => window.readEditor())).text.includes('新'), '全空表头后应能继续输入')
      } else if (scenario === 'empty-row-backspace') {
        await cell(1, 0).click()
        await page.evaluate(offset => {
          window.controller.handleHostMessage({ kind: 'view.locate', offset })
          window.controller.getView().focus()
        }, source.indexOf('|  |  |') + 3)
        await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text,
          source.replace('|  |  |\n', ''), '空行首格起点退格应删整行且保留正文')
      } else if (scenario === 'empty-row-realclick') {
        // 真实点击（不经 view.locate 精确定位）空行首格：光标落在格区间
        // 任意透明空白位（from 而非 contentFrom），退格仍须删整行。
        await cell(1, 0).click()
        const entered = await page.evaluate(() => window.readEditor())
        assert(entered.head >= source.indexOf('|  |  |') && entered.head <= source.indexOf('|  |  |') + 7,
          `点击空行首格光标应落在首格区间: ${JSON.stringify(entered)}`)
        await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text,
          source.replace('|  |  |\n', ''), '真实点击空行首格退格应删整行')
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 2, '删行后网格少一行')
      } else if (scenario === 'empty-cell-padding') {
        // 填充空格对用户透明：右移一步直接切到右格内容首（不逐位经过空格）；
        // 左移回到同一锚点；行非全空时退格不得删除填充空白。
        await cell(1, 0).click()
        const anchor = (await page.evaluate(() => window.readEditor())).head
        await page.keyboard.press('ArrowRight')
        const afterRight = await page.evaluate(() => window.readEditor())
        assert.equal(afterRight.head, source.indexOf('B2'),
          `空格右移一步应直接切到右格内容首: ${JSON.stringify({ anchor, afterRight })}`)
        await page.keyboard.press('ArrowLeft')
        const afterLeft = await page.evaluate(() => window.readEditor())
        assert.equal(afterLeft.head, anchor, `右格左移应回到空格同一锚点: ${JSON.stringify({ anchor, afterLeft })}`)
        await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text, source,
          '行非全空时退格不得删除填充空白')
        await cell(1, 1).click()
        // 点击落点在 B2 内容中间不确定：先格内全选收到内容首，再左移入空格
        await page.keyboard.press('Control+a')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text, source,
          '从右格左移入空格后退格同样不得删除填充空白')
      } else if (scenario === 'region-drag-live-selection') {
        // 拖选进行中（未松手）：跨格矩形建立后不得出现原生线性蓝选区——
        // 矩形边框与蒙版是唯一选区反馈（region=0 的首格内阶段仍属普通文本拖选）。
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 14, a.y + a.height / 2)
        await page.mouse.down()
        const frames = []
        for (let step = 1; step <= 6; step++) {
          await page.mouse.move(a.x + 14 + (b.x + 26 - a.x - 14) * step / 6,
            a.y + a.height / 2 + (b.y + b.height / 2 - a.y - a.height / 2) * step / 6)
          frames.push(await page.evaluate(() => ({
            from: window.readEditor().from, to: window.readEditor().to,
            native: getSelection()?.toString() ?? '',
            region: document.querySelectorAll('.vsidian-table-region-cell').length,
          })))
        }
        await page.mouse.up()
        assert(frames.some((frame) => frame.region > 0), `拖动过程中应已形成矩形选区: ${JSON.stringify(frames)}`)
        for (const frame of frames) {
          if (frame.region === 0) continue
          assert.equal(frame.from, frame.to, `跨格拖选中 CM6 选区必须折叠（无蓝色线性高亮）: ${JSON.stringify(frames)}`)
          assert.equal(frame.native, '', `跨格拖选中原生 selection 不得残留文字: ${JSON.stringify(frames)}`)
        }
        assert.equal(frames.at(-1).region, 4, '松手前 2×2 矩形已就位')
        const after = await page.evaluate(() => window.readEditor())
        assert.equal(after.from, after.to, '松手后光标保持折叠')
      } else if (scenario.startsWith('region-drag-caret-yield')) {
        // #252 格区在场时左上锚点格的光标让位：跨格接管的折叠单光标（防
        // pointerup 原生线性选区结算的既定形态）由 drawSelection 的
        // .cm-cursor 绘制、零宽锚点格点亮 ::after 假光标——与格区蒙版叠加
        // 即「左上格多一枚光标」的视觉残留。断言落在绘制层（computed
        // display）：蒙版呈现期（拖动中，region>0 即跨格接管已发生）与
        // 落定期（松手后）两态让位；零宽 fixture（||B2|）另断言假光标
        // 让位；单击清除格区后绘制光标恢复显示（不过度隐藏）。
        const caretState = () => page.evaluate(() => {
          const drawn = document.querySelector('.cm-cursorLayer .cm-cursor')
          const fake = document.querySelector('.vsidian-table-grid-empty-active')
          return {
            region: document.querySelectorAll('.vsidian-table-region-cell').length,
            drawn: drawn ? getComputedStyle(drawn).display : 'absent',
            fake: fake ? getComputedStyle(fake, '::after').display : 'absent',
          }
        })
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 14, a.y + a.height / 2)
        await page.mouse.down()
        let during = null
        for (let step = 1; step <= 6; step++) {
          await page.mouse.move(a.x + 14 + (b.x + 26 - a.x - 14) * step / 6,
            a.y + a.height / 2 + (b.y + b.height / 2 - a.y - a.height / 2) * step / 6)
          if (step === 4) during = await caretState()
        }
        await page.mouse.up()
        const settled = await caretState()
        assert(during && during.region > 0, `拖动中应已跨格接管: ${JSON.stringify(during)}`)
        assert.ok(during.drawn === 'none' || during.drawn === 'absent',
          `拖动中左上格绘制光标应让位（压制或不在场）: ${JSON.stringify(during)}`)
        assert.equal(settled.region, 4, `落定后 2×2 格区应就位: ${JSON.stringify(settled)}`)
        assert.ok(settled.drawn === 'none' || settled.drawn === 'absent',
          `落定后左上格绘制光标应让位（压制或不在场）: ${JSON.stringify(settled)}`)
        if (scenario === 'region-drag-caret-yield-empty') {
          assert.notEqual(settled.fake, 'absent', '零宽锚点格的假光标装饰应在场（active 仍发射）')
          assert.equal(settled.fake, 'none', `零宽锚点格的假光标应让位: ${JSON.stringify(settled)}`)
        }
        // 恢复：单击非锚点格清除格区（onDown 清场 + CM6 原生点击设选区），
        // 绘制光标回到可见。轮询等待到「格区消失且光标真实可见」为止——
        // click 后立即检查会撞上光标元素重挂的 rAF 窗口（瞬态 absent），
        // 立即断言可能空转通过；轮询把恢复显示钉成实锤
        await cell(2, 1).click()
        await page.waitForFunction(() => {
          if (document.querySelectorAll('.vsidian-table-region-cell').length !== 0) return false
          const drawn = document.querySelector('.cm-cursorLayer .cm-cursor')
          return drawn ? getComputedStyle(drawn).display !== 'none' : false
        }, undefined, { timeout: 5000, polling: 100 })
        if (scenario === 'region-drag-caret-yield') {
          // 多光标关闭形态：drawSelection 退出装配、折叠单光标回退原生
          // caret 呈现——格区在场时经 caret-color 透明让位（原生 caret 无
          // DOM，断言取计算值），cursorLayer 不在场
          await page.evaluate(() => window.controller.handleHostMessage(
            { kind: 'settings.changed', values: { 'editor.multicursor': false } }))
          await page.mouse.move(a.x + 14, a.y + a.height / 2)
          await page.mouse.down()
          await page.mouse.move(b.x + 26, b.y + b.height / 2, { steps: 6 })
          await page.mouse.up()
          const nativeCaret = await page.evaluate(() => ({
            caret: getComputedStyle(document.querySelector('.cm-content')).caretColor,
            layer: document.querySelector('.cm-cursorLayer') ? 'present' : 'absent',
            region: document.querySelectorAll('.vsidian-table-region-cell').length,
          }))
          assert.equal(nativeCaret.region, 4, `关闭多光标后格区拖选应照常: ${JSON.stringify(nativeCaret)}`)
          assert.equal(nativeCaret.layer, 'absent', '多光标关闭时绘制层不应在场')
          assert.equal(nativeCaret.caret, 'rgba(0, 0, 0, 0)',
            `格区在场时原生 caret 应透明让位: ${JSON.stringify(nativeCaret)}`)
        }
      } else if (scenario === 'region-paste-grid') {
        // 格对格粘贴（2026-09-28 决策）：格区复制产物（带表头包装的表格）
        // 粘回格区须逐格铺开替换，不再整段落左上格；表头包装剥掉、结构
        // 保持；源越界扩表容纳。普通文本粘贴仍走左上格（region-paste 场景）。
        const paste = async (text) => {
          await page.evaluate((payload) => {
            const data = new DataTransfer()
            data.setData('text/plain', payload)
            document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste',
              { clipboardData: data, bubbles: true, cancelable: true }))
          }, text)
        }
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 14, a.y + a.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + 26, b.y + b.height / 2, { steps: 6 })
        await page.mouse.up()
        assert.equal(await page.locator('.vsidian-table-region-cell').count(), 4, '粘贴前 2×2 蒙版就位')
        await paste('| 一 | 二 |\n| --- | --- |\n| 三 | 四 |')
        let text = (await page.evaluate(() => window.readEditor())).text
        assert(text.includes('| H1 | H2 |\n| --- | --- |\n| 一 | 二 |\n| 三 | 四 |\n\nAFTER'),
          `同尺寸 2×2 须格对格替换且表头结构不动: ${JSON.stringify(text)}`)
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 3, '同尺寸粘贴不得增删行列')
        assert.equal(await page.locator('.vsidian-table-region-cell').count(), 0, '粘贴后蒙版退场')
        // 源行数超表：末尾扩行容纳；表头与非选区行不动
        const c = await cell(1, 0).boundingBox()
        const d = await cell(2, 1).boundingBox()
        await page.mouse.move(c.x + 14, c.y + c.height / 2)
        await page.mouse.down()
        await page.mouse.move(d.x + 26, d.y + d.height / 2, { steps: 6 })
        await page.mouse.up()
        await paste('| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n| 戊 | 己 |')
        text = (await page.evaluate(() => window.readEditor())).text
        assert(text.includes('| H1 | H2 |\n| --- | --- |\n| 甲 | 乙 |\n| 丙 | 丁 |\n| 戊 | 己 |\n\nAFTER'),
          `源越界须向表尾扩行容纳: ${JSON.stringify(text)}`)
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 4, '扩行后网格多一行')
      } else if (scenario === 'region-drag-fulltable-mask') {
        // 拖选进行中蒙版不得断档：满列再横拉到整表的扩张路径上，外贴蒙版类
        // 曾与列把手高亮、CM6 mark 更新竞态互抹——第一列整列消失直到松手。
        // 断言逐帧蒙版数量单调不减，且未松手时整表六格蒙版就位（脱手恢复不算数）。
        const boxes = [await cell(0, 0).boundingBox(), await cell(1, 0).boundingBox(),
          await cell(2, 0).boundingBox(), await cell(2, 1).boundingBox()]
        const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
        const count = () => page.evaluate(() =>
          document.querySelectorAll('.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-region-cell').length)
        const start = center(boxes[0])
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        const frames = []
        let last = start
        for (const [index, box] of [boxes[1], boxes[2], boxes[3]].entries()) {
          const target = center(box)
          const steps = index === 2 ? 8 : 5
          for (let i = 1; i <= steps; i++) {
            await page.mouse.move(last.x + (target.x - last.x) * i / steps,
              last.y + (target.y - last.y) * i / steps)
            frames.push(await count())
          }
          last = target
        }
        const settled = await count()
        await page.mouse.up()
        const after = await count()
        assert.equal(settled, 6, `拖选中（未松手）整表蒙版须六格齐备: 逐帧 ${JSON.stringify(frames)} settled=${settled}`)
        assert.equal(after, 6, '松手后整表蒙版保持六格')
        // 扩张手势 region 只增不减：含 0 帧全程单调——瞬断（n→0→n）与
        // 部分回退（6→3）都是断裂形态，一并抓
        assert(frames.every((n, i) => i === 0 || n >= frames[i - 1]),
          `扩张拖选中蒙版数量不得回退（回退即断裂帧）: ${JSON.stringify(frames)}`)
      } else if (scenario.startsWith('enter-')) {
        const target = cell(scenario === 'enter-body' ? 1 : 0, 1)
        await target.click()
        if (scenario.startsWith('enter-code')) {
          const at = source.indexOf('H2') + (scenario.endsWith('start') ? 0 : scenario.endsWith('end') ? 2 : 1)
          await page.evaluate(offset => window.controller.handleHostMessage({ kind: 'view.locate', offset }), at)
        }
        if (scenario === 'enter-middle') {
          await page.keyboard.press('Control+a')
          await page.keyboard.press('ArrowLeft')
          await page.keyboard.press('ArrowRight')
        }
        const before = await target.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top)
        const breaks = scenario === 'enter-repeat' ? 2 : 1
        for (let i = 0; i < breaks; i++) await page.keyboard.press(scenario === 'enter-body' ? 'Shift+Enter' : 'Enter')
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.equal(await page.locator('.vsidian-table-grid-row').count(), 3, '回车不能拆散表格')
        assert.equal((await page.evaluate(() => window.readEditor())).text.split('\n').length, source.split('\n').length, '格内换行不能拆开 Markdown 表格源行')
        const after = await target.evaluate(e => ({text:e.innerText, state:window.readEditor(), y:getSelection().getRangeAt(0).getBoundingClientRect().top, inside:e.contains(getSelection().focusNode), html:e.innerHTML, focus:getSelection().focusNode?.nodeName, offset:getSelection().focusOffset}))
        assert(after.inside && after.y > before, `回车后原生光标必须在同格下一视觉行: ${JSON.stringify({before,after})}`)
        assert(!after.text.includes('<br>'), '换行标记不得显示成源码')
        const input = scenario === 'enter-ime' ? '你好' : 'next'
        if (scenario === 'enter-ime') {
          const cdp = await page.context().newCDPSession(page)
          for (const text of ['ni', 'nihao']) await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
          await cdp.send('Input.insertText', { text: input })
        } else await page.keyboard.type(input)
        assert((await target.innerText()).includes(input), '换行后输入仍在原格')
        if (scenario === 'enter-cell') {
          const secondLine = await target.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top)
          await page.keyboard.press('ArrowUp')
          const up = await target.evaluate(e => ({ inside:e.contains(getSelection().focusNode), y:getSelection().getRangeAt(0).getBoundingClientRect().top }))
          assert(up.inside && up.y < secondLine, '格内换行后上移应返回同格上一行')
          await page.keyboard.press('ArrowDown')
          const down = await target.evaluate(e => ({ inside:e.contains(getSelection().focusNode), y:getSelection().getRangeAt(0).getBoundingClientRect().top }))
          assert(down.inside && down.y > up.y, '下移应返回同格第二行')
          await page.screenshot({ path: artifactPath(root, 'table-enter-live.png') })
          const saved = (await page.evaluate(() => window.readEditor())).text
          const reopened = await browser.newPage()
          try {
            await reopened.setContent('<div id="app"></div>')
            await reopened.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
            await reopened.addScriptTag({ path: bundle })
            await reopened.evaluate(text => {
              window.initTable(text)
              window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
            }, saved)
            assert.equal(await reopened.locator('th').nth(1).locator('br').count(), 1, '重开阅读视图应保留格内换行')
            assert(!(await reopened.locator('th').nth(1).innerText()).includes('<br>'), '阅读视图不显示换行源码')
            await reopened.screenshot({ path: artifactPath(root, 'table-enter-reading.png') })
          } finally { await reopened.close() }
        }
        for (let i = 0; i < input.length + breaks; i++) await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text, source, '退格应一次删除格内换行并恢复源文')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Backspace')
        assert.equal((await page.evaluate(() => window.readEditor())).text, source, '直接回车再退格必须合回原行')
      } else if (scenario.startsWith('horizontal-wrap')) {
        await cell(0, 1).click({ position: { x: 200, y: 10 } })
        await page.keyboard.press('ArrowRight')
        await checkCell(1, 0)
        await page.keyboard.press('ArrowLeft')
        await checkCell(0, 1)
      } else if (scenario === 'vertical-inside' || scenario === 'vertical-empty') {
        await cell(0, 1).click()
        await page.keyboard.press('ArrowDown')
        await checkCell(1, 1)
        await page.keyboard.press('ArrowDown')
        await checkCell(2, 1)
        await page.keyboard.press('ArrowUp')
        await checkCell(1, 1)
        await page.keyboard.press('ArrowUp')
        await checkCell(0, 1)
        await page.keyboard.press('ArrowUp')
        assert.equal((await page.evaluate(() => window.readEditor())).line, 2, '表头上移退出到表格前一行')
        await cell(2, 0).click()
        await page.keyboard.press('ArrowDown')
        assert.equal((await page.evaluate(() => window.readEditor())).line, 7, '末行下移退出到表格后一行')
      } else if (scenario === 'vertical-wrapped') {
        await page.addStyleTag({ content: '#app .cm-editor .cm-scroller .vsidian-table-grid-row { width: 160px }' })
        await cell(0, 1).click({ position: { x: 12, y: 8 } })
        await page.keyboard.press('Control+a')
        await page.keyboard.press('ArrowLeft')
        const initial = await page.evaluate(() => window.readEditor())
        await page.keyboard.press('ArrowDown')
        await checkCell(0, 1)
        assert((await page.evaluate(() => window.readEditor())).head > initial.head, '软换行下移应在格内前进')
        await page.keyboard.press('ArrowUp')
        await checkCell(0, 1)
      } else if (scenario.startsWith('drag-') || scenario.startsWith('region-')) {
        // #57：真实鼠标拖选（page.mouse）建立跨格/整表选区，再以原生按键删除。
        const gridState = () => page.evaluate(() => ({
          ...window.readEditor(),
          rows: document.querySelectorAll('.vsidian-table-grid-row').length,
          delimiterHidden: getComputedStyle(document.querySelector('.vsidian-table-grid-delimiter') ?? document.body).display === 'none',
        }))
        const dragTo = async (from, to) => {
          await page.mouse.move(from.x, from.y)
          await page.mouse.down()
          await page.mouse.move(to.x, to.y, { steps: 6 })
          await page.mouse.up()
        }
        if (scenario === 'drag-row') {
          const a = await cell(1, 0).boundingBox()
          const b = await cell(1, 1).boundingBox()
          await dragTo({ x: a.x + 14, y: a.y + a.height / 2 },
            { x: b.x + 26, y: b.y + b.height / 2 })
          assert.equal(await page.locator('.vsidian-table-region-cell').count(), 2, '同行两格应整格高亮')
          await page.keyboard.press('Backspace')
          const after = await gridState()
          assert(!after.text.includes('B1') && !after.text.includes('B2'),
            `完整数据行选区应删除该行: ${JSON.stringify(after)}`)
          assert(after.rows === 2 && after.delimiterHidden, '删除完整行后网格与隐藏分隔行保持')
          assert(after.text.includes('H1') && after.text.includes('C1') && after.text.includes('C2'),
            '未选中的格不受影响')
        } else if (scenario === 'drag-column') {
          const a = await cell(1, 0).boundingBox()
          const b = await cell(2, 0).boundingBox()
          await dragTo({ x: a.x + 14, y: a.y + a.height / 2 },
            { x: b.x + 26, y: b.y + b.height / 2 })
          assert.equal(await page.locator('.vsidian-table-region-cell').count(), 2, '同列两格应整格高亮')
          await page.keyboard.press('Backspace')
          const after = await gridState()
          assert(!after.text.includes('B1') && !after.text.includes('C1'),
            `同列跨行删除应只清掉覆盖格: ${JSON.stringify(after)}`)
          assert(after.rows === 3 && after.delimiterHidden, '删除后网格与隐藏分隔行保持')
          assert(after.text.includes('H1') && after.text.includes('H2') && after.text.includes('B2') && after.text.includes('C2'),
            '未选中的格不受影响')
        } else if (scenario === 'region-copy') {
          const a = await cell(2, 1).boundingBox()
          const b = await cell(3, 2).boundingBox()
          await dragTo({ x: a.x + 14, y: a.y + a.height / 2 },
            { x: b.x + 26, y: b.y + b.height / 2 })
          const paint = await page.evaluate(() => {
            const selected = [...document.querySelectorAll('.vsidian-table-region-cell')]
            return selected.map(e => ({ background: getComputedStyle(e).backgroundColor,
              left: getComputedStyle(e).borderLeftColor, right: getComputedStyle(e).borderRightColor }))
          })
          assert.equal(paint.length, 4, `2×2 应高亮四格: ${JSON.stringify(paint)}`)
          assert(paint.every(p => p.background !== 'rgba(0, 0, 0, 0)'), `格区背景须实际绘出: ${JSON.stringify(paint)}`)
          assert.equal(await cell(2, 0).evaluate(e => e.classList.contains('vsidian-table-region-cell')), false,
            '矩形外的第一列不得高亮')
          assert.equal(await page.evaluate(() => getSelection()?.toString()), '', '跨格选区不得残留原生逐字蓝色选区')
          await captureTable('table-region-2x2.png')
          await page.evaluate(() => document.addEventListener('copy', event => {
            window.__copiedTable = event.clipboardData?.getData('text/plain')
          }))
          await page.keyboard.press('Control+c')
          assert.equal(await page.evaluate(() => window.__copiedTable),
            '| 5 | 2.8 |\n| --- | --- |\n| 12 | 18.0 |', '复制的纯文本必须是独立 Markdown 表格')
        } else if (scenario === 'region-exit-outside') {
          const a = await cell(1, 0).boundingBox()
          const b = await cell(2, 1).boundingBox()
          const outside = await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).boundingBox()
          await page.mouse.move(a.x + 14, a.y + a.height / 2)
          await page.mouse.down()
          await page.mouse.move(b.x + 26, b.y + b.height / 2, { steps: 4 })
          assert.equal(await page.locator('.vsidian-table-region-cell').count(), 4)
          await page.mouse.move(outside.x + 10, outside.y + outside.height / 2, { steps: 4 })
          await page.mouse.up()
          assert.equal(await page.locator('.vsidian-table-region-cell').count(), 0,
            '拖出表格进入正文须退出矩形选区')
          const sel = await gridState()
          assert(sel.to > sel.from && sel.to >= source.indexOf('AFTER'),
            `拖入正文后须恢复普通文本选区: ${JSON.stringify(sel)}`)
      } else if (scenario === 'column-width') {
        // #142 列宽内容比例分配（绘制层断言：真实布局宽度，非 DOM 存在性）：
        // 宽内容列宽于窄内容列；同表各行共享同一列宽计划（行是独立 grid，
        // 列边界逐列对齐）；内容变更即时重算（窄列变长后反超）
        const widths = () => page.evaluate(() =>
          [...document.querySelectorAll('.vsidian-table-grid-row')].map((row) =>
            [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')]
              .map((c) => c.getBoundingClientRect().width)))
        const before = await widths()
        assert.equal(before.length, 3, '三行网格（表头 + 两数据行）')
        for (const row of before) {
          assert(row[1] > row[0] + 40, `宽内容列必须明显宽于窄内容列: ${JSON.stringify(row)}`)
        }
        for (let c = 0; c < 2; c++) {
          for (const row of before) {
            assert(Math.abs(row[c] - before[0][c]) < 0.5,
              `各行第 ${c} 列宽度须一致（同表共享列宽计划）: ${JSON.stringify(before)}`)
          }
        }
        const plans = await page.evaluate(() =>
          [...document.querySelectorAll('.vsidian-table-grid-row')]
            .map((row) => row.style.getPropertyValue('--vsidian-table-col-widths')))
        assert(plans.every((p) => /^minmax\(min\(48px, 50%\), [\d.]+fr\) minmax\(min\(48px, 50%\), [\d.]+fr\)$/.test(p)),
          `行内联列宽计划应为 minmax 保底 + fr 占比形态: ${JSON.stringify(plans)}`)
        assert(new Set(plans).size === 1, '同表各行内联同一列宽计划')
        // computed 轨道（样式解析层）：内联 var 消费失效时 CSS 回退等分
        // repeat 形态（两轨道同值）——此处解析轨道应为两段不等宽 px 且
        // 宽列明显大于窄列，与几何断言同向、钉在 grid-template-columns 解析值
        const tracksOf = () => page.evaluate(() =>
          [...document.querySelectorAll('.vsidian-table-grid-row')]
            .map((row) => getComputedStyle(row).gridTemplateColumns))
        const tracks = await tracksOf()
        assert(tracks.length === 3 && tracks.every((tr) => /^[\d.]+px [\d.]+px$/.test(tr)),
          `computed 轨道应为两段 px 形态: ${JSON.stringify(tracks)}`)
        assert(new Set(tracks).size === 1, `同表各行 computed 轨道一致: ${JSON.stringify(tracks)}`)
        for (const tr of tracks) {
          const [narrow, wide] = tr.split(' ').map(Number.parseFloat)
          assert(wide > narrow + 40, `computed 轨道宽列须明显宽于窄列: ${tr}`)
        }
        // 内容变更重算：窄列表头输入 30 字符后该列反超宽列
        await cell(0, 0).click()
        for (let i = 0; i < 30; i++) await page.keyboard.type('w')
        const after = await widths()
        assert(after[0][0] > after[0][1], `窄列内容变长后列宽须反超宽列: ${JSON.stringify(after[0])}`)
        const tracksAfter = await tracksOf()
        const [narrowAfter, wideAfter] = tracksAfter[0].split(' ').map(Number.parseFloat)
        assert(narrowAfter > wideAfter, `重算后 computed 轨道窄列须反超: ${tracksAfter[0]}`)
        const typed = await page.evaluate(() => (window.readEditor().text.match(/w/g) ?? []).length)
        assert.equal(typed, 30, '输入须真实写回源文')
        await captureTable('table-column-width.png')
      } else if (scenario === 'height-optimize') {
        // #372 离开编辑后的整表高度优化：断言全部落在用户可见物——表格可见
        // 总高度（首末网格行 bbox 高差）、源文不变、出站编辑消息为零。表内
        // 键入/Tab/矩形拖选/IME 组合期间完整搜索次数为零；退出后恰好一次。
        const readHeights = () => page.evaluate(() => {
          const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
          if (!rows.length) return null
          const first = rows[0].getBoundingClientRect()
          const last = rows[rows.length - 1].getBoundingClientRect()
          return {
            height: last.bottom - first.top,
            rowCount: rows.length,
            plan: rows[0].style.getPropertyValue('--vsidian-table-col-widths'),
            labelWidth: rows[1].querySelector(':scope > .vsidian-table-grid-cell').getBoundingClientRect().width,
          }
        })
        // 度量就绪（availablePx 实测注入——确定性像素轨道的输入）
        await page.waitForFunction(() => window.tableMetricsReady().availablePx > 0, undefined, { timeout: 5000 })
        // 1) 进表 + 键入并保留：doc 变更使列宽回到轻量计划（表内轻量现状），
        //    且内容指纹区别于挂载/度量扫描（同版本去重才不会拦截退出触发）
        await cell(1, 0).click()
        const caret0 = await page.evaluate(() => window.readEditor().head)
        await page.keyboard.type('x')
        const mutated = source.slice(0, caret0) + 'x' + source.slice(caret0)
        const stats0 = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests }))
        // 2) 表内交互（Tab 切格 / 矩形拖选 / 真实 IME 组合）期间搜索为零
        await page.keyboard.press('Tab')
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 1).boundingBox()
        await page.mouse.move(a.x + 8, a.y + a.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 4 })
        await page.mouse.up()
        await cell(2, 0).click()
        const cdp = await page.context().newCDPSession(page)
        for (const text of ['ce', 'cesh']) await cdp.send('Input.imeSetComposition',
          { text, selectionStart: text.length, selectionEnd: text.length })
        await cdp.send('Input.insertText', { text: '测试' })
        await page.waitForTimeout(30)
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(60)
        const inTable = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests }))
        assert.equal(inTable.searches - stats0.searches, 0, '表内交互期间完整搜索必须为零')
        assert.equal(inTable.publishes - stats0.publishes, 0, '表内交互期间不得发布新计划')
        // 表内净编辑 = 仅键入的 'x'（组合输入与其退格相互抵消）
        const beforeLeave = await page.evaluate(() => window.readEditor())
        assert.equal(beforeLeave.text, mutated, '表内交互后源文应只含净编辑')
        const h0 = await readHeights()
        assert(h0.rowCount === 3, `两列表应有 3 行网格: ${h0.rowCount}`)
        // 3) 退出（点击表后正文）——恰好一次完整优化并发布
        await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).click()
        await page.waitForFunction((n) => window.tableOptimizeStats().searches === n, stats0.searches + 1,
          { timeout: 5000 })
        const afterLeave = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests, text: window.readEditor().text }))
        assert.equal(afterLeave.publishes - stats0.publishes, 1, '退出后恰好一次发布')
        assert.equal(afterLeave.editRequests, stats0.editRequests, '布局变更零写回（无 edit.request 出站）')
        assert.equal(afterLeave.text, mutated, '布局变更不得改源文')
        // 4) 可见总高度低于原比例机制（真实几何：首末行高差）
        const h1 = await readHeights()
        assert(h1.height < h0.height - 1,
          `优化后可见总高度必须低于轻量基线: ${h1.height.toFixed(1)} vs ${h0.height.toFixed(1)}`)
        assert(h1.plan !== h0.plan, '发布的列宽计划应与轻量基线不同')
        assert(h1.labelWidth >= 36, `短标签列宽不得低于 T01 下限附近: ${h1.labelWidth.toFixed(1)}`)
        // 5) 同版本去重：再进出一次（无内容变化）不重复搜索
        await cell(1, 0).click()
        await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).click()
        await page.waitForTimeout(80)
        const dedup = await page.evaluate(() => window.tableOptimizeStats())
        assert.equal(dedup.searches, stats0.searches + 1, '同版本再次进出不得重复搜索')
        await captureTable('table-height-optimize.png')
      } else if (scenario === 'height-optimize-multi' || scenario === 'height-optimize-wide') {
        // #373 多列高度优化（三列冻结样例 + 六列样例）：断言落在用户可见物
        // ——退出编辑后真实表格总高度下降、可见文字不裁切（scrollWidth 不越
        // 格盒）、同行格子同水平带、控件命中正确（checkCell painted 光标）、
        // 滚动离屏重挂后消费同一计划。表内交互（Tab/矩形拖选/IME）搜索为零。
        const readTable = () => page.evaluate(() => {
          const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
          if (!rows.length) return null
          const first = rows[0].getBoundingClientRect()
          const last = rows[rows.length - 1].getBoundingClientRect()
          return {
            height: last.bottom - first.top,
            rowCount: rows.length,
            plan: rows[0].style.getPropertyValue('--vsidian-table-col-widths'),
            tracks: getComputedStyle(rows[0]).gridTemplateColumns.split(' ').map(Number.parseFloat),
            tracksSum: getComputedStyle(rows[0]).gridTemplateColumns.split(' ').map(Number.parseFloat)
              .reduce((s, v) => s + v, 0),
            rowArea: rows[0].getBoundingClientRect().width,
            labelWidth: rows[1].querySelector(':scope > .vsidian-table-grid-cell').getBoundingClientRect().width,
            clipping: rows.some((row) => [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')]
              .some((c) => c.scrollWidth > c.clientWidth + 1)),
            bandOk: rows.every((row) => {
              const boxes = [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')]
                .map((c) => c.getBoundingClientRect())
              return boxes.every((b, i) => i === 0 || Math.abs(b.y - boxes[0].y) < 1)
            }),
          }
        })
        await page.waitForFunction(() => window.tableMetricsReady().availablePx > 0, undefined, { timeout: 5000 })
        // 进表 + 净编辑：内容指纹区别于挂载扫描（同版本去重不拦截退出触发）
        await cell(1, 0).click()
        const caret0 = await page.evaluate(() => window.readEditor().head)
        await page.keyboard.type('x')
        const mutated = source.slice(0, caret0) + 'x' + source.slice(caret0)
        const stats0 = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests }))
        // 表内交互（Tab 切格 / 矩形拖选 / 真实 IME 组合）期间完整搜索为零
        await page.keyboard.press('Tab')
        const a = await cell(1, 0).boundingBox()
        const b = await cell(2, 2).boundingBox()
        await page.mouse.move(a.x + 8, a.y + a.height / 2)
        await page.mouse.down()
        await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 4 })
        await page.mouse.up()
        await cell(2, 0).click()
        const cdp = await page.context().newCDPSession(page)
        for (const text of ['ce', 'cesh']) await cdp.send('Input.imeSetComposition',
          { text, selectionStart: text.length, selectionEnd: text.length })
        await cdp.send('Input.insertText', { text: '测试' })
        await page.waitForTimeout(30)
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(60)
        const inTable = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests }))
        assert.equal(inTable.searches - stats0.searches, 0, '多列表内交互期间完整搜索必须为零')
        assert.equal(inTable.publishes - stats0.publishes, 0, '多列表内交互期间不得发布新计划')
        assert.equal((await page.evaluate(() => window.readEditor())).text, mutated,
          '多列表内交互后源文应只含净编辑')
        const h0 = await readTable()
        assert(h0.rowCount === (scenario === 'height-optimize-multi' ? 31 : 21),
          `数据行网格行数: ${h0.rowCount}`)
        // 控件命中正确：点击第三列格后绘制光标落在该格内，真实键入位置一致
        const paintedIn = await cell(1, 2).evaluate((el) => {
          const sel = getSelection()
          const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
          const box = el.getBoundingClientRect()
          return { inside: el.contains(sel?.focusNode),
            painted: !!rect && rect.height > 0 && rect.x >= box.left && rect.x < box.right }
        })
        assert(paintedIn.inside && paintedIn.painted, `第三列格控件命中须绘制光标: ${JSON.stringify(paintedIn)}`)
        const typedAt = await page.evaluate(() => window.readEditor().head)
        await page.keyboard.type('y')
        const typedText = (await page.evaluate(() => window.readEditor())).text
        assert.equal(typedText, mutated.slice(0, typedAt) + 'y' + mutated.slice(typedAt), '真实键入须落在点击格内')
        await page.keyboard.press('Backspace')
        // 退出（点击表后正文）——恰好一次完整优化并发布
        await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).click()
        await page.waitForFunction((n) => window.tableOptimizeStats().searches === n,
          stats0.searches + 1, { timeout: 5000 })
        const afterLeave = await page.evaluate(() => ({ ...window.tableOptimizeStats(),
          editRequests: window.__editRequests }))
        assert.equal(afterLeave.publishes - stats0.publishes, 1, '多列表退出后恰好一次发布')
        assert.equal(afterLeave.editRequests, stats0.editRequests, '布局变更零写回（无 edit.request 出站）')
        const h1 = await readTable()
        assert(h1.height < h0.height - 1,
          `${scenario} 优化后可见总高度必须低于轻量基线: ${h1.height.toFixed(1)} vs ${h0.height.toFixed(1)}`)
        assert(h1.plan !== h0.plan, '发布的多列计划应与轻量基线不同')
        assert(h1.labelWidth >= 36, `短标签列宽不得低于 T01 下限附近: ${h1.labelWidth.toFixed(1)}`)
        assert(h1.tracksSum <= h1.rowArea + 1, `轨道总宽不超行区: ${h1.tracksSum.toFixed(1)} vs ${h1.rowArea.toFixed(1)}`)
        assert(h1.tracks.every((t) => Number.isFinite(t) && t > 0), `轨道宽须为正有限值: ${h1.tracks}`)
        assert(!h1.clipping, '优化后可见文字不得横向裁切（scrollWidth 越格盒）')
        assert(h1.bandOk, '同行格子必须同水平带')
        // 视口重挂行消费同一计划：滚出视口再滚回，计划与列宽逐字节一致
        await page.mouse.wheel(0, 1600)
        await page.waitForTimeout(120)
        await page.mouse.wheel(0, -1600)
        await page.waitForTimeout(120)
        const h2 = await readTable()
        assert(h2.plan === h1.plan, '滚动离屏重挂后必须消费同一列宽计划')
        assert(Math.abs(h2.height - h1.height) < 2, `重挂后表格总高度稳定: ${h2.height.toFixed(1)} vs ${h1.height.toFixed(1)}`)
        // 同版本去重：再进出一次（无内容变化）不重复搜索
        await cell(1, 0).click()
        await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).click()
        await page.waitForTimeout(80)
        const dedup = await page.evaluate(() => window.tableOptimizeStats())
        assert.equal(dedup.searches, stats0.searches + 1, '同版本再次进出不得重复搜索')
        await captureTable(`table-${scenario}.png`)
      } else {
        // drag-table-outside：表外文本发起、横跨整表拖选，一次 Delete 移除整表
        const beforeLine = page.locator('.cm-line').filter({ hasText: /^BEFORE$/ })
          const afterLine = page.locator('.cm-line').filter({ hasText: /^AFTER$/ })
          const a = await beforeLine.boundingBox()
          const b = await afterLine.boundingBox()
          await dragTo({ x: a.x + a.width - 6, y: a.y + a.height / 2 },
            { x: b.x + 4, y: b.y + b.height / 2 })
          const sel = await gridState()
          assert(sel.from <= source.indexOf('H1') && sel.to >= source.indexOf('C2'),
            `拖选应横跨整表: ${JSON.stringify(sel)}`)
          await page.keyboard.press('Delete')
          const state = await gridState()
          assert(!state.text.includes('|') && !state.text.includes('---'),
            `整表删除后不得残留表格源码: ${JSON.stringify(state)}`)
          assert(state.text.startsWith('BEFOR') && state.text.endsWith('FTER'),
            `表格前后正文按选区保留（选区端点所在字符按所见即所删）: ${JSON.stringify(state)}`)
          assert(state.rows === 0, '表格 DOM 应随整块删除消失')
        }
      } else if (scenario === 'height-optimize-multi' || scenario === 'height-optimize-wide') {
        // #373 多列样例网格行数多（31/21 行），基表「首末行方向键导航」断言
        // 不适用——本场景的全部断言已在专属分支完成，这里跳过基表导航
      } else {
        await page.locator('.cm-line').filter({ hasText: /^BEFORE$/ }).click({ position: { x: 5, y: 10 } })
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('ArrowDown')
        await checkCell(0, 0)
        await page.locator('.cm-line').filter({ hasText: /^AFTER$/ }).click({ position: { x: 5, y: 10 } })
        await page.keyboard.press('ArrowUp')
        await page.keyboard.press('ArrowUp')
        await checkCell(2, 0)
      }
      passed++
      console.log(`[原生输入][PASS] ${scenario}`)
    } catch (error) {
      navigationFailures.push(error)
      console.error(`[原生输入][FAIL] ${scenario}: ${error.message}`)
    } finally { await page.close() }
  }
  // ---- #150 表格格内 widget 网格回归：双链/图片/公式渲染保留且网格不错位 ----
  // 视觉层断言落在用户可见结果：渲染态 widget 真实绘制（rect 有面积）且
  // 位于格盒内；含 widget 的行两格同顶（「四」不被顶到多出的一行）。
  const cellWidgetFailures = []
  for (const scenario of ['wikilink', 'image', 'math']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
      await page.addScriptTag({ path: bundle })
      const cellText = scenario === 'wikilink' ? '三[[a b]]'
        : scenario === 'image' ? '三![alt 图](a.png)' : '三$x$'
      const source = `| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |\n| ${cellText} | 四 |`
      await page.evaluate((text) => window.initTable(text), source)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const selector = scenario === 'wikilink' ? '[data-vsidian-rendered-wikilink]'
        : scenario === 'image' ? '.vsidian-image' : '[data-vsidian-rendered-math]'
      const widgetRow = page.locator('.vsidian-table-grid-row').nth(2)
      const cell0 = widgetRow.locator('.vsidian-table-grid-cell').nth(0)
      const cell1 = widgetRow.locator('.vsidian-table-grid-cell').nth(1)
      // 渲染态在第一格内真实绘制（可见性：面积 > 0，且不越出格盒）
      const rendered = await cell0.locator(selector).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        const cellEl = el.closest('.vsidian-table-grid-cell')
        const box = cellEl ? cellEl.getBoundingClientRect() : null
        return {
          w: rect.width, h: rect.height,
          inside: !!box && rect.left >= box.left - 1 && rect.right <= box.right + 1 &&
            rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
        }
      })
      assert(rendered.w > 0 && rendered.h > 0, `${scenario} 渲染态必须真实绘制: ${JSON.stringify(rendered)}`)
      assert(rendered.inside, `${scenario} 渲染元素须落在格盒内: ${JSON.stringify(rendered)}`)
      // 对齐：同行两格同顶、第二格在右侧（widget 不多占格位、不产生多出的行）
      const a = await cell0.boundingBox()
      const b = await cell1.boundingBox()
      assert(Math.abs(a.y - b.y) < 1, `${scenario} 行两格必须同顶（不被 widget 顶到多出的行）: ${JSON.stringify({ a, b })}`)
      assert(b.x > a.x, `${scenario} 第二格必须在第一格右侧`)
      // 格区选区不回归：拖选该行两格形成行内矩形
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 })
      await page.mouse.up()
      assert.equal(await page.locator('.vsidian-table-region-cell').count(), 2,
        `${scenario} 行内拖选须形成两格矩形`)
      // Tab 切格不回归：进入第一格后 Tab 落到第二格内容
      await cell0.click()
      await page.keyboard.press('Tab')
      const after = await page.evaluate(() => window.readEditor())
      const four = source.indexOf('四')
      assert(after.head >= four - 1 && after.head <= four + 1,
        `${scenario} Tab 应切到第二格内容: ${JSON.stringify(after)}`)
      assert.equal(after.text, source, '格内 widget 场景交互不得改写源文')
      await page.screenshot({ path: artifactPath(root, `table-cell-widget-${scenario}.png`) })
      assert.deepEqual(errors, [], `页面异常: ${JSON.stringify(errors)}`)
      console.log(`[原生输入][PASS] cell-widget/${scenario}`)
    } catch (error) {
      cellWidgetFailures.push(error)
      console.error(`[原生输入][FAIL] cell-widget/${scenario}: ${error.message}`)
    } finally { await page.close() }
  }
  if (cellWidgetFailures.length) throw new AggregateError(cellWidgetFailures, '表格格内 widget 网格回归失败')
  // ---- #59 公式输入回归：进入/编辑/离开、IME、粘贴、删除、块级与普通美元 ----
  const mathFailures = []
  for (const scenario of ['render-toggle', 'inline-edit', 'inline-ime', 'inline-paste',
    'block-edit', 'dollar-plain', 'undo-redo-text', 'multi-math']) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
      await page.addScriptTag({ path: bundle })
      const source = '价格 $x^2$ 元\n\n$$\nE=mc^2\n$$\n\n花费 $5，合计 $10\n\n$a$ 与 $b$'
      await page.evaluate((text) => window.initTable(text), source)
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const mathState = () => page.evaluate(() => ({
        rendered: document.querySelectorAll('.cm-content .vsidian-math').length,
        renderedKatex: document.querySelectorAll('.cm-content .vsidian-math .katex').length,
        renderedBlock: document.querySelectorAll('.cm-content .vsidian-math-block').length,
        error: document.querySelectorAll('.cm-content .vsidian-math-error').length,
        source: document.querySelectorAll('.cm-content .vsidian-math-source').length,
        text: window.readEditor().text,
        head: window.readEditor().head,
      }))
      const locate = (offset) => page.evaluate(
        o => window.controller.handleHostMessage({ kind: 'view.locate', offset: o }), offset)
      // view.locate 只移动光标不给 contentDOM 焦点：键盘场景先点击行首聚焦
      //（x=5 落在行首文字前，不会定位进公式区间）
      const focusEditor = () => page.locator('.cm-line').first()
        .click({ position: { x: 5, y: 8 } }).then(() => locate(0))
      const inlineAt = source.indexOf('$x^2$')
      const blockAt = source.indexOf('$$')
      if (scenario === 'render-toggle') {
        // 初始（光标在文档首，不触及公式）：渲染态存在且真实绘制（有面积）
        const initial = await mathState()
        assert(initial.rendered >= 3, `渲染态公式数: ${JSON.stringify(initial)}`)
        assert(initial.renderedKatex === initial.rendered, '渲染态必须含 KaTeX 结构')
        assert.equal(initial.renderedBlock, 1, '块级公式单独计数')
        assert.equal(initial.error, 0, '合法公式无降级')
        const painted = await page.evaluate(() => {
          const el = document.querySelector('.cm-content .vsidian-math')
          const rect = el?.getBoundingClientRect()
          return rect ? rect.width > 0 && rect.height > 0 : false
        })
        assert(painted, '渲染态公式必须真实绘制（rect 有面积）')
        // 光标进入行内公式 → 源码显形；离开 → 恢复渲染
        await locate(inlineAt + 2)
        const editing = await mathState()
        assert(editing.source >= 1 && editing.rendered === editing.renderedKatex &&
          editing.rendered + editing.source === initial.rendered, `进入后: ${JSON.stringify(editing)}`)
        await locate(0)
        const left = await mathState()
        assert.equal(left.source, 0, '离开公式后不得残留源码态')
        assert.equal(left.rendered, initial.rendered, '离开后渲染态恢复')
        assert.equal(left.text, source, '切换显隐不得改写源文')
        // A9：真实鼠标点击渲染态公式元素 → 进入源码态（光标落在公式范围内、
        // 该公式渲染态消失），光标再离开恢复渲染——locate 移动光标之外补充
        // page.mouse 原生路径
        const renderedEl = page.locator('.cm-content .vsidian-math').first()
        await renderedEl.click()
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const clicked = await mathState()
        assert(clicked.source >= 1, `真实鼠标点击渲染态公式应显源码: ${JSON.stringify(clicked)}`)
        assert.equal(clicked.rendered + clicked.source, initial.rendered,
          `点击后公式总数不变（一显一隐切换）: ${JSON.stringify(clicked)}`)
        assert(clicked.head >= inlineAt && clicked.head <= inlineAt + '$x^2$'.length,
          `点击后光标应落在公式范围内: ${JSON.stringify(clicked)}`)
        await locate(0)
        const afterClick = await mathState()
        assert.equal(afterClick.source, 0, '鼠标进入的源码态同样随光标离开恢复')
        assert.equal(afterClick.text, source, '鼠标路径不得改写源文')
      } else if (scenario === 'inline-edit') {
        await focusEditor()
        await locate(inlineAt + 4) // 光标在 x^2 的 2 后
        await page.keyboard.type('+1')
        const typed = await mathState()
        assert.equal(typed.text, source.replace('$x^2$', '$x^2+1$'), '行内编辑写回源文')
        await locate(0)
        const restored = await mathState()
        assert(restored.rendered >= 1 && restored.error === 0, '编辑后合法公式仍渲染')
        // 删除恢复
        await locate(inlineAt + 6)
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Backspace')
        assert.equal((await mathState()).text, source, '退格删除恢复原文')
      } else if (scenario === 'inline-ime') {
        await focusEditor()
        await locate(inlineAt + 4)
        const cdp = await page.context().newCDPSession(page)
        for (const text of ['go', 'gong']) {
          await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
          const composing = await mathState()
          assert(composing.text.includes(`$x^2${text}$`), `IME 候选 ${text} 写入公式: ${composing.text}`)
          assert(composing.source >= 1, '组合期间保持源码态可编辑')
        }
        await cdp.send('Input.insertText', { text: '功' })
        const committed = await mathState()
        assert(committed.text.includes('$x^2功$'), 'IME 确认写入公式')
        assert.equal(committed.text, source.replace('$x^2$', '$x^2功$'), '未触碰文本不被规范化')
        await locate(0)
        const after = await mathState()
        assert(after.rendered >= 1 && after.error === 0, 'IME 提交后公式恢复渲染（中文在数学模式静默渲染）')
        // 退格删除中文输入恢复
        await locate(inlineAt + 5)
        await page.keyboard.press('Backspace')
        assert.equal((await mathState()).text, source, '删除 IME 输入恢复原文')
      } else if (scenario === 'inline-paste') {
        await focusEditor()
        await locate(inlineAt + 4)
        await page.keyboard.insertText('^2_3')
        const pasted = await mathState()
        assert(pasted.text.includes('$x^2^2_3$'), '粘贴文本进入公式')
        await locate(0)
        const r = await mathState()
        assert(r.rendered >= 1, '粘贴后其他公式仍渲染')
        // 粘贴造成非法公式（^ 重复）时该公式降级但不丢内容
        assert.equal((await mathState()).text, source.replace('$x^2$', '$x^2^2_3$'))
      } else if (scenario === 'block-edit') {
        await focusEditor()
        const eAt = blockAt + source.slice(blockAt).indexOf('E')
        await locate(eAt + 1) // 光标在 E 后
        const editing = await mathState()
        assert(editing.source >= 1, '光标进入块级公式显源码')
        await page.keyboard.type('2')
        const typed = await mathState()
        assert.equal(typed.text, source.replace('E=mc^2', 'E2=mc^2'), '块内输入精确写回')
        await page.keyboard.press('Backspace')
        await locate(0)
        const restored = await mathState()
        assert.equal(restored.text, source, '块内删除恢复原文')
        assert.equal(restored.renderedBlock, 1, '块级公式恢复渲染')
      } else if (scenario === 'dollar-plain') {
        // 普通美元与代码区不渲染、不影响公式
        const s = await mathState()
        const plainStart = source.indexOf('花费')
        for (const at of [plainStart + 3, plainStart + 10]) {
          await locate(at)
          const st = await mathState()
          assert.equal(st.source, 0, '普通美元区间不得显公式源码态')
        }
        await locate(0)
        assert((await mathState()).rendered >= 3, '公式渲染不受普通美元干扰')
        void s
      } else if (scenario === 'undo-redo-text') {
        await focusEditor()
        // 撤销/重做的权威栈在宿主（本装配无宿主）：此处钉「编辑序列后原文可
        // 由等量退格复原」——等价校验输入事务的可逆性不依赖宿主历史
        await locate(inlineAt + 4)
        await page.keyboard.type('abc')
        for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
        assert.equal((await mathState()).text, source, '逐字退格完全复原输入')
        await locate(0)
        assert((await mathState()).rendered >= 3, '复原后渲染态完整')
      } else if (scenario === 'multi-math') {
        // 相邻公式互不吞并：两个行内公式中间的文本可编辑
        const between = source.indexOf(' 与 ') + 1 // '与' 字符位
        await focusEditor()
        await locate(between)
        await page.keyboard.type('Z')
        const typed = await mathState()
        assert.equal(typed.text, source.replace(' 与 ', ' Z与 '), '相邻公式间输入只改目标位置')
        await page.keyboard.press('Backspace')
        assert.equal((await mathState()).text, source, '相邻公式间编辑可复原')
      }
      assert.deepEqual(errors, [])
      passed++
      console.log(`[原生输入][PASS] math/${scenario}`)
    } catch (error) {
      mathFailures.push(error)
      console.error(`[原生输入][FAIL] math/${scenario}: ${error.message}`)
    } finally { await page.close() }
  }
  if (mathFailures.length) throw new AggregateError(mathFailures, '公式输入回归失败')
  if (navigationFailures.length) throw new AggregateError(navigationFailures, '表格方向键导航回归失败')
  console.log(`[原生输入] ${passed} 项通过`)
} finally { await browser.close() }

// ---- #60 Mermaid 渲染回归（文件末尾追加段；独立浏览器实例 + 复刻 webview CSP 的页面）----
// 关键验证目标：mermaid 独立产物经懒加载链路（URI 注入 → 按需 <script>）在
// 与宿主 webview 同款的 CSP（无 unsafe-eval、script-src 'self'+nonce）下真实
// 渲染；live/阅读双模式、源码编辑重渲染、无效语法降级、同源多图 id 唯一、
// 图内链接不跳转、明暗主题重渲染。真实 mermaid 11.12.2，非 mock。
import http from 'node:http'

const mermaidArtifact = artifactPath(root, 'mermaid.js')
await build({
  // 生产同构：与 esbuild.mjs 的 mermaid target 同入口同配置（ESM 源打包，
  // 官方 UMD 的模块作用域全局自赋值会落空，见 mermaidEntry.ts 头注释）
  entryPoints: [path.join(root, 'src/webview/mermaidEntry.ts')],
  outfile: mermaidArtifact, bundle: true, platform: 'browser', format: 'iife',
  target: 'chrome118', minify: true, sourcemap: false, logLevel: 'silent',
})
const browserOutDir = artifactPath(root, 'tableCaret')
const serveOutFile = async (res, rel) => {
  const file = rel === 'mermaid.js' ? mermaidArtifact : path.join(browserOutDir, rel)
  try {
    const data = await readFile(file) // 文件顶部的 node:fs/promises 版本
    res.writeHead(200, {
      'content-type': rel.endsWith('.css') ? 'text/css'
        : rel.endsWith('.html') ? 'text/html'
          : 'text/javascript',
    })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}
// CSP 复刻（与 textEditorProvider.buildWebviewHtml 同形）：default-src 'none'、
// script-src 'self' + nonce（nonce 放行 URI 注入内联脚本——宿主同款机制）、
// style-src 'unsafe-inline'（CM6 与 mermaid SVG 内嵌样式）、无 unsafe-eval
const mermaidNonce = 'vsidian-mermaid-test-nonce'
const mermaidPageHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'nonce-${mermaidNonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'">
<link rel="stylesheet" href="/tableCaret.css">
</head><body><div id="app"></div>
<script nonce="${mermaidNonce}">window.__vsidianMermaidUri = "/mermaid.js";</script>
<script nonce="${mermaidNonce}" src="/tableCaret.js"></script>
</body></html>`
const mermaidServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(mermaidPageHtml)
    return
  }
  void serveOutFile(res, url.pathname.slice(1))
})
await new Promise((resolve) => mermaidServer.listen(0, '127.0.0.1', resolve))
const mermaidBase = `http://127.0.0.1:${mermaidServer.address().port}`

const mermaidBrowser = await chromium.launch({
  headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined,
})
const MERMAID_DOC = [
  '# 图表演例', '',
  '```mermaid', 'graph TD', 'A[开始]-->B[结束]', '```', '',
  '正文段落一。', '',
  '```mermaid', 'sequenceDiagram', 'Alice->>Bob: 你好', 'Bob-->>Alice: 很好', '```', '',
  '```mermaid', 'flowchart LR', 'X-->Y', '```', '',
  '```mermaid', 'flowchart LR', 'X-->Y', '```', '',
  '语法错误样例：', '',
  '```mermaid', '这不是合法图表语法', '```', '',
  '结尾段落保持可用。',
].join('\n')
const mermaidFailures = []
let mermaidPassed = 0
try {
  for (const scenario of ['live-render', 'edit-rerender', 'reading-mode', 'no-navigation', 'theme-rerender', 'card-in-out']) {
    const page = await mermaidBrowser.newPage()
    // 高视口：CM6 widget 只在可见区物化——图渲染后高度扩张会把后续围栏推出
    // 默认 720px 视口，widget 永不创建导致等待超时；拉高视口让全部图可见
    await page.setViewportSize({ width: 1280, height: 2600 })
    const errors = []
    const consoleErrors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (msg) => {
      const text = msg.text()
      // favicon 请求被 default-src 'none' 拦截属页面副作用，与渲染无关
      if (msg.type() === 'error' && !/favicon/i.test(text)) {
        consoleErrors.push(text)
      }
    })
    try {
      await page.goto(mermaidBase + '/')
      await page.waitForFunction(() => typeof window.initTable === 'function')
      await page.evaluate((text) => window.initTable(text), MERMAID_DOC)
      const states = () => page.evaluate(() => {
        const readingActive = document.querySelector('.vsidian-view-reading').style.display !== 'none'
        const scope = readingActive
          ? document.querySelector('.vsidian-view-reading')
          : document.querySelector('.cm-content')
        return {
          rendered: scope.querySelectorAll('.vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length,
          pending: scope.querySelectorAll('.vsidian-mermaid[data-vsidian-mermaid-state="rendering"], .vsidian-mermaid[data-vsidian-mermaid-state="pending"]').length,
          degraded: scope.querySelectorAll('.vsidian-mermaid[data-vsidian-mermaid-state="error"]').length,
          svg: scope.querySelectorAll('.vsidian-mermaid svg').length,
          text: window.readEditor().text,
        }
      })
      const locate = (offset) => page.evaluate(
        (o) => window.controller.handleHostMessage({ kind: 'view.locate', offset: o }), offset)
      if (scenario === 'live-render') {
        // 流程图 + 时序图 + 同源相邻多图：4 个 rendered，1 个语法降级
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        const st = await states()
        assert.equal(st.rendered, 4, `渲染数: ${JSON.stringify(st)}`)
        assert.equal(st.degraded, 1, `语法错误图降级: ${JSON.stringify(st)}`)
        assert.equal(st.svg, 4, '渲染态必须含真实 SVG')
        assert.equal(st.text, MERMAID_DOC, '渲染不得改写源文')
        // 真实绘制（rect 有面积）+ SVG 宽度受容器约束
        const painted = await page.evaluate(() => {
          const el = document.querySelector('.cm-content .vsidian-mermaid svg')
          if (!el) return false
          const rect = el.getBoundingClientRect()
          const container = el.closest('.vsidian-mermaid').getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && rect.width <= container.width + 1
        })
        assert(painted, '图形必须真实绘制（rect 有面积且不超出容器宽）')
        // 懒加载链路：mermaid.js 注入且仅注入一次；全局可用
        const loaded = await page.evaluate(() => ({
          scripts: document.querySelectorAll('script[src$="/mermaid.js"]').length,
          api: typeof globalThis.mermaid === 'object' && typeof globalThis.mermaid.render === 'function',
        }))
        assert.equal(loaded.scripts, 1, 'mermaid.js 按需注入一次')
        assert(loaded.api, '全局 mermaid API 可用（懒加载完成）')
        // 同源相邻两图：文档内无重复 id（缓存克隆改写）
        const uniqueIds = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('.vsidian-mermaid [id]')].map((el) => el.id)
          return { total: ids.length, unique: new Set(ids).size }
        })
        assert(uniqueIds.total > 0, '渲染产物应含内部 id')
        assert.equal(uniqueIds.unique, uniqueIds.total, '同源多图缓存复用不得产生重复 id')
        // 降级不吞后续块：结尾段落仍在
        const tail = await page.evaluate(() => {
          const lines = [...document.querySelectorAll('.cm-content .cm-line')]
          return lines.some((l) => l.textContent.includes('结尾段落保持可用'))
        })
        assert(tail, '语法错误图不吞掉后续正文块')
        // CSP 不得出现渲染被拦截的报错（无 unsafe-eval 下的真实渲染证明）
        assert.deepEqual(consoleErrors.filter((t) => /Content Security Policy/i.test(t)), [],
          `CSP 拦截了渲染资源: ${JSON.stringify(consoleErrors)}`)
      } else if (scenario === 'edit-rerender') {
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        await page.locator('.cm-line').first().click({ position: { x: 5, y: 8 } })
        const aAt = MERMAID_DOC.indexOf('A[开始]') + 1
        await locate(aAt)
        // 光标进入围栏：该图退场显源码，其余图不受影响
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid').length === 4)
        await page.keyboard.type('2')
        assert((await states()).text.includes('A2[开始]'), '围栏内输入精确写回')
        await locate(0)
        // 离开围栏：源码修改后的图重新渲染（缓存按新源文失效）
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        await locate(aAt + 1)
        await page.keyboard.press('Backspace')
        await locate(0)
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        assert.equal((await states()).text, MERMAID_DOC, '退格后围栏原文逐字节复原')
      } else if (scenario === 'reading-mode') {
        // 阅读模式：挂载块内渲染 + 模式切换一致性（切回 live 再渲染、零写回）
        await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' }))
        await page.waitForFunction(() =>
          document.querySelectorAll('.vsidian-view-reading .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        const reading = await page.evaluate(() => {
          const scope = document.querySelector('.vsidian-view-reading')
          const svg = scope.querySelector('.vsidian-mermaid svg')
          const rect = svg?.getBoundingClientRect()
          return {
            degraded: scope.querySelectorAll('.vsidian-mermaid[data-vsidian-mermaid-state="error"]').length,
            painted: !!rect && rect.width > 0 && rect.height > 0,
          }
        })
        assert.equal(reading.degraded, 1, '阅读模式同样降级语法错误图')
        assert(reading.painted, '阅读模式图形真实绘制')
        await page.evaluate(() => window.controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' }))
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        assert.equal((await states()).text, MERMAID_DOC, '模式切换不得改写文本')
      } else if (scenario === 'no-navigation') {
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        // 图内点击（节点区域）不产生导航；产物内无 javascript: 链接
        const urlBefore = page.url()
        await page.locator('.cm-content .vsidian-mermaid svg').first().click()
        await page.waitForTimeout(300)
        assert.equal(page.url(), urlBefore, '图内点击不得触发导航')
        const dangerous = await page.evaluate(() =>
          [...document.querySelectorAll('.vsidian-mermaid a[href]')]
            .filter((a) => (a.getAttribute('href') ?? '').trim().toLowerCase().startsWith('javascript:')).length)
        assert.equal(dangerous, 0, '渲染产物不得含 javascript: 链接')
      } else if (scenario === 'theme-rerender') {
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4,
          null, { timeout: 20000 })
        await page.evaluate(() => {
          window.__firstMermaidSvg = document.querySelector('.cm-content .vsidian-mermaid svg')
        })
        // 宿主主题 class 切换（webview 同款观察源）：dark 触发重渲染（新 SVG 实例）
        await page.evaluate(() => document.body.classList.add('vscode-dark'))
        await page.waitForFunction(() => {
          const svg = document.querySelector('.cm-content .vsidian-mermaid svg')
          return svg && svg !== window.__firstMermaidSvg
        }, null, { timeout: 20000 })
        // 切回亮色再次重渲染（第二次实例替换）
        await page.evaluate(() => {
          window.__secondMermaidSvg = document.querySelector('.cm-content .vsidian-mermaid svg')
          document.body.classList.remove('vscode-dark')
        })
        await page.waitForFunction(() => {
          const svg = document.querySelector('.cm-content .vsidian-mermaid svg')
          return svg && svg !== window.__firstMermaidSvg && svg !== window.__secondMermaidSvg
        }, null, { timeout: 20000 })
      } else if (scenario === 'card-in-out') {
        // #111 渲染型围栏与卡片的交界：点击图形本体不进入编辑（widget 吞
        // 事件），编辑入口收敛到 frame 右上角 edit 按钮（悬停显现后原生
        // 点击 → 光标落围栏起点 → 源码显形、Mermaid 标签卡片接管）；
        // 点击围栏外退出 → 卡片退场、SVG 恢复渲染
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid').length === 5, null, { timeout: 20000 })
        // 禁点击：SVG 上原生点击不落光标、图不退场
        await page.locator('.cm-content .vsidian-mermaid svg').first().click({ position: { x: 20, y: 6 } })
        await page.waitForTimeout(200)
        const afterImageClick = await page.evaluate(() => ({
          mermaid: document.querySelectorAll('.cm-content .vsidian-mermaid').length,
          cards: document.querySelectorAll('.cm-content .vsidian-code-card-header').length,
          anchor: window.readEditor ? window.readEditor().anchor : undefined,
        }))
        assert.equal(afterImageClick.mermaid, 5, '点击图形不得使图退场（#111 禁点击进编辑）')
        assert.equal(afterImageClick.cards, 0, '点击图形不得进入编辑态卡片')
        // edit 按钮：悬停 frame 显现后原生点击进入编辑
        await page.locator('.cm-content .vsidian-graphic-frame').first().hover()
        await page.locator('.cm-content .vsidian-graphic-chrome-edit').first().click()
        await page.waitForFunction(() => {
          const cards = document.querySelectorAll('.cm-content .vsidian-code-card-header')
          const mermaidCard = [...cards].some((h) =>
            (h.querySelector('.vsidian-code-card-header-label')?.lastChild?.textContent ?? '') === 'Mermaid')
          return document.querySelectorAll('.cm-content .vsidian-mermaid').length === 4 && mermaidCard
        }, null, { timeout: 20000 })
        assert.equal((await states()).text, MERMAID_DOC, 'edit 进入编辑态零写回')
        // 点击围栏外（文档首行）退出 → 卡片退场、SVG 恢复渲染
        await page.locator('.cm-line').first().click({ position: { x: 5, y: 8 } })
        await page.waitForFunction(() =>
          document.querySelectorAll('.cm-content .vsidian-mermaid[data-vsidian-mermaid-state="rendered"]').length === 4 &&
          document.querySelectorAll('.cm-content .vsidian-code-card-header').length === 0,
          null, { timeout: 20000 })
        assert.equal((await states()).text, MERMAID_DOC, '点击退出后零写回且图恢复')
      }
      assert.deepEqual(errors, [], `页面异常: ${JSON.stringify(errors)}`)
      mermaidPassed++
      console.log(`[原生输入][PASS] mermaid/${scenario}`)
    } catch (error) {
      mermaidFailures.push(error)
      console.error(`[原生输入][FAIL] mermaid/${scenario}: ${error.message}`)
    } finally {
      await page.close()
    }
  }
} finally {
  await mermaidBrowser.close()
  mermaidServer.close()
}
if (mermaidFailures.length) throw new AggregateError(mermaidFailures, 'Mermaid 渲染回归失败')
console.log(`[原生输入] mermaid ${mermaidPassed} 项通过`)

// ---- #79 代码块卡片：光标进出围栏的原生点击与键盘路径（独立浏览器实例） ----
{
  const cardBrowser = await chromium.launch({ headless: true,
    channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
  const cardFailures = []
  let cardPassed = 0
  try {
    const page = await cardBrowser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.setContent('<div id="app"></div>')
      await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
      await page.addScriptTag({ path: bundle })
      const CODE_DOC = ['前文', '', '```js', 'const a = 1;', '```', '', '后文', ''].join('\n')
      await page.evaluate((text) => window.initTable(text), CODE_DOC)
      const states = () => page.evaluate(() => ({
        text: window.readEditor().text,
        headers: [...document.querySelectorAll('.vsidian-code-card-header')].map((h) => h.textContent),
        fenceVisible: [...document.querySelectorAll('.cm-content .cm-line')]
          .some((l) => l.textContent.includes('```')),
        cardLines: document.querySelectorAll('.cm-line.vsidian-code-card-line').length,
      }))

      // 1) 呈现态（光标在围栏外）：头部横带 + 围栏文本从行内容清空、行槽保留
      await page.waitForFunction(() => document.querySelectorAll('.vsidian-code-card-header').length === 1)
      let s = await states()
      assert.equal(s.headers.length, 1, `应恰有一张卡片: ${JSON.stringify(s.headers)}`)
      assert(s.headers[0].includes('JavaScript'), `标签应为 JavaScript: ${s.headers[0]}`)
      assert(!s.fenceVisible, `呈现态围栏文本必须清空（DOM 行内不残留）: ${s.text}`)
      assert.equal(s.cardLines, 3, `卡片行类应覆盖开围栏/代码/闭围栏 3 行，实际 ${s.cardLines}`)
      // #80 卡内行号：单行代码块恰有一个行号 1（右对齐文本、不随输入漂移）
      const lnTexts = await page.evaluate(() =>
        [...document.querySelectorAll('.vsidian-code-card-linenumber')].map((el) => el.textContent))
      assert.deepEqual(lnTexts, ['1'], `卡内行号应为 ['1']，实际 ${JSON.stringify(lnTexts)}`)
      // #83 语法高亮：呈现态代码内容有 tok-* 着色 span
      const tokCount = await page.evaluate(() =>
        document.querySelectorAll('.cm-content [class*="tok-"]').length)
      assert(tokCount > 0, `呈现态代码应有着色 token，实际 ${tokCount}`)

      // 2) 原生点击代码行 → 编辑态：围栏显形、头部保留
      await page.locator('.cm-line.vsidian-code-card-line').nth(1).click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent.includes('```')))
      s = await states()
      assert.equal(s.headers.length, 1, '编辑态头部横带保留')

      // 3) 原生键盘：行尾键入 → 精确写回代码体
      await page.keyboard.press('End')
      await page.keyboard.type('x')
      s = await states()
      assert(s.text.includes('const a = 1;x'), `围栏内输入应精确写回: ${s.text}`)

      // 4) 点击开围栏行（呈现态被清空的行槽）→ 光标进入，围栏显形可编辑 info
      await page.locator('.cm-line.vsidian-code-card-line').nth(0).click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent.includes('```')))
      await page.keyboard.press('End')
      await page.keyboard.type('s')
      s = await states()
      assert(s.text.includes('```jss'), `围栏 info 应可编辑: ${s.text}`)
      await page.waitForFunction(() => {
        const h = document.querySelector('.vsidian-code-card-header')
        return h && h.textContent.includes('jss')
      }, null, { timeout: 5000 })
      await page.keyboard.press('Backspace')

      // 5) 鼠标离开（点击后文行）→ 恢复呈现态
      await page.locator('.cm-content .cm-line', { hasText: '后文' }).first().click()
      await page.waitForFunction(() =>
        ![...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent.includes('```')))
      s = await states()
      assert.equal(s.headers.length, 1, '离开围栏后头部保留')
      assert.equal(s.cardLines, 3, '离开围栏后卡片行类保留')
      const lnAfter = await page.evaluate(() =>
        [...document.querySelectorAll('.vsidian-code-card-linenumber')].map((el) => el.textContent))
      assert.deepEqual(lnAfter, ['1'], '离开围栏后行号保留')

      // 5b) 键盘离开：重新进入代码行，ArrowDown 逐行穿出围栏（代码行→空行→
      //     闭围栏行→后文）——穿越期间保持编辑态，越界后恢复呈现
      await page.locator('.cm-line.vsidian-code-card-line').nth(1).click()
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent.includes('```')))
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(60)
      }
      await page.waitForFunction(() =>
        ![...document.querySelectorAll('.cm-content .cm-line')].some((l) => l.textContent.includes('```')))
      s = await states()
      assert.equal(s.headers.length, 1, '键盘离开围栏后头部保留')

      // 5c) 复制按钮（#81）：悬停卡片显现 → 点击经宿主通道复制代码体（不含
      //     围栏与本次输入的 x 前改动？含 x：代码体即当前源文），✓ 反馈落类，
      //     点击不得把光标带进围栏（保持呈现态）
      const header = page.locator('.vsidian-code-card-header').first()
      await header.hover()
      const copyBtn = header.locator('.vsidian-code-card-copy')
      await copyBtn.click()
      await page.waitForFunction(() => {
        const m = window.__lastHostMessage
        return m && m.kind === 'codeblock.copy' && m.text === 'const a = 1;x'
      })
      const copyState = await page.evaluate(() => {
        const b = document.querySelector('.vsidian-code-card-copy')
        return {
          done: b?.classList.contains('vsidian-code-card-copy-done') ?? false,
          fenceVisible: [...document.querySelectorAll('.cm-content .cm-line')]
            .some((l) => l.textContent.includes('```')),
          head: window.readEditor().head,
        }
      })
      assert(copyState.done, '点击后按钮应带 ✓ 反馈类')
      assert(!copyState.fenceVisible, '点击复制不得把光标带进围栏（保持呈现态）')
      await page.waitForFunction(() => {
        const b = document.querySelector('.vsidian-code-card-copy')
        return b && !b.classList.contains('vsidian-code-card-copy-done')
      }, null, { timeout: 4000 })

      // 5d) 折叠（#82）：点击 chevron → 整块收起（行消失、头部保留、
      //     收起态 chevron 转向）；再点展开恢复
      const chevron = header.locator('.vsidian-code-card-fold')
      await chevron.click()
      await page.waitForFunction(() =>
        document.querySelectorAll('.cm-line.vsidian-code-card-line').length === 0)
      const collapsedState = await page.evaluate(() => ({
        headers: document.querySelectorAll('.vsidian-code-card-header').length,
        collapsed: document.querySelector('.vsidian-code-card-fold')?.classList.contains('vsidian-code-card-fold-collapsed'),
      }))
      assert.equal(collapsedState.headers, 1, '收起后头部横带保留')
      assert.equal(collapsedState.collapsed, true, '收起态 chevron 应带转向类')
      await chevron.click()
      await page.waitForFunction(() =>
        document.querySelectorAll('.cm-line.vsidian-code-card-line').length === 3)

      // 5e) 键盘进入已折叠块 → 临时展开；离开后恢复收起
      await chevron.click()
      await page.waitForFunction(() =>
        document.querySelectorAll('.cm-line.vsidian-code-card-line').length === 0)
      await page.locator('.cm-content .cm-line', { hasText: '前文' }).first().click()
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowDown')
      await page.waitForFunction(() =>
        document.querySelectorAll('.cm-line.vsidian-code-card-line').length === 3,
        null, { timeout: 5000 }).catch(() => undefined)
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
      await page.waitForFunction(() =>
        document.querySelectorAll('.cm-line.vsidian-code-card-line').length === 0,
        null, { timeout: 5000 })
      const finalFold = await states()
      assert.equal(finalFold.headers.length, 1, '折叠往返后头部保留')

      // 6) 最终文本与手工构造逐字节一致；无页面异常
      const expected = ['前文', '', '```js', 'const a = 1;x', '```', '', '后文', ''].join('\n')
      assert.equal((await states()).text, expected, '全部交互后文本必须逐字节一致')
      assert.deepEqual(errors, [], `页面异常: ${JSON.stringify(errors)}`)
      cardPassed++
      console.log('[原生输入][PASS] code-card/caret-in-out')
    } finally {
      await page.close()
    }
  } catch (error) {
    cardFailures.push(error)
    console.error(`[原生输入][FAIL] code-card/caret-in-out: ${error.message}`)
  } finally {
    await cardBrowser.close()
  }
  if (cardFailures.length) throw new AggregateError(cardFailures, '代码块卡片回归失败')
  console.log(`[原生输入] code-card ${cardPassed} 项通过`)
}
