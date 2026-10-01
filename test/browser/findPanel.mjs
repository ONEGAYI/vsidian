// 查找面板浏览器回归（#236）：真实键盘路径（Ctrl+F 打开、键入、Enter/
// Shift+Enter 导航、Ctrl+H 展开替换栏、Esc 关闭）驱动生产控制器验证：
// 三开关语义（matchCase/wholeWord/regexp 计数变化 + 点亮态 + findOptions.set
// 出站）、非法正则红边不崩、替换写回（单笔 edit.request / 全部替换整批一笔）、
// 阅读模式整体禁用替换（2026-10：Ctrl+H 不响应、toggle 禁用灰化、live 展开记忆
// 不被触碰）。明暗主题各跑一遍。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'find-panel/main.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/findPanelFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip] })
const { islandHtml } = await buildZhLocaleIsland(root)

/** 等待面板观测满足谓词（重算/渲染是异步 dispatch，轮询到落定） */
async function waitPanel(page, pred, label) {
  const deadline = Date.now() + 4000
  let last = null
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.readFindPanel())
    if (pred(last)) return last
    await page.waitForTimeout(50)
  }
  throw new Error(`等待查找面板状态超时：${label}，最后观测 ${JSON.stringify(last)}`)
}

function editRequests(page) {
  return page.evaluate(() => window.readHostMessages().filter((m) => m.kind === 'edit.request'))
}

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

    // 文本设计：'foo' 默认档 4 处（Foo/foo/food 内/foo）；matchCase 3 处；
    // matchCase+wholeWord 2 处（food 内的 foo 非全字）
    await page.evaluate(() => window.initDoc('Foo bar foo Bar\nfood foo\n'))
    await page.evaluate(() => window.focusEditor())

    // ---- 场景 1：真实 Ctrl+F 打开；焦点进输入框；键入查询计数 ----
    await page.keyboard.press('Control+f')
    let panel = await waitPanel(page, (p) => p.open && p.activeIsInput, 'Ctrl+F 打开聚焦')
    // 空查询未搜索：计数区收起（display:none，不预留「当前/总数」占位）
    assert.ok(panel.countHidden, '空查询计数应收起（count-hidden 类）')
    await page.keyboard.type('foo')
    panel = await waitPanel(page, (p) => p.count === '第 1 项，共 4 项', '默认档键入计数 第1项共4项')
    assert.ok(!panel.countHidden, '键入后计数应展开')
    assert.ok(panel.matchMarks >= 1, `全部匹配装饰应在场，实际 ${panel.matchMarks}`)
    assert.equal(panel.currentMarks, 1, '当前匹配装饰应恰 1 处')

    // ---- 场景 2：Enter/Shift+Enter 导航（序号推进与回退，选区跟随）----
    await page.keyboard.press('Enter')
    panel = await waitPanel(page, (p) => p.count === '第 2 项，共 4 项', 'Enter 下一处')
    await page.keyboard.press('Shift+Enter')
    panel = await waitPanel(page, (p) => p.count === '第 1 项，共 4 项', 'Shift+Enter 上一处')
    const editor0 = await page.evaluate(() => window.readEditor())
    assert.equal(editor0.from, 0, '当前匹配 Foo 应被选中（选区跟随）')

    // ---- 场景 3：三开关真实点击（点亮态 + 计数 + findOptions.set 出站）----
    await page.click('.vsidian-find-case')
    panel = await waitPanel(page, (p) => p.caseActive && p.count === '第 1 项，共 3 项', 'matchCase 开：3 处')
    let setCount = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'findOptions.set').length)
    assert.equal(setCount, 1, '切开关应出站 findOptions.set')
    await page.click('.vsidian-find-word')
    panel = await waitPanel(page, (p) => p.wordActive && p.count === '第 1 项，共 2 项', 'matchCase+wholeWord：2 处')
    // 开关持久化应答回环（snapshot 同值），面板状态不跳变
    await page.click('.vsidian-find-regexp')
    // 正则模式：'foo' 作为正则合法且等价字面量，计数仍 2
    panel = await waitPanel(page, (p) => p.regexpActive && p.count === '第 1 项，共 2 项', 'regexp 开：等价计数')
    setCount = await page.evaluate(() =>
      window.readHostMessages().filter((m) => m.kind === 'findOptions.set').length)
    assert.equal(setCount, 3, '三次切换应出站三笔 findOptions.set')

    // ---- 场景 4：非法正则红边反馈（不崩、无匹配、可见错误色）----
    // （点击开关后焦点在按钮上，先回输入框再全选键入）
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('[bad')
    panel = await waitPanel(page, (p) => p.invalid && p.count === '无结果', '非法正则无结果')
    assert.ok(panel.countEmpty, '零命中计数应为错误色类')
    const invalidBorder = await page.evaluate(() => {
      const input = document.querySelector('.vsidian-find-input.vsidian-find-input-invalid')
      return input ? getComputedStyle(input).borderColor : ''
    })
    assert.ok(/rgb\(2?\d+, \d+, \d+\)/.test(invalidBorder) && invalidBorder !== '', '红边 computed borderColor 应可读')
    assert.deepEqual(errors, [], '非法正则期间不得有页面错误')

    // ---- 场景 5：Ctrl+H 展开替换栏；替换输入 + 替换下一个（单笔写回）----
    // 此时三开关全开（matchCase+wholeWord+regexp）；查询 'f.o' 全字命中 2 处
    // （foo 8 与 foo 18；Foo 大写不匹配、food 内非全字）
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.replaceOpen && p.regexpActive, 'Ctrl+H 展开替换栏')
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('f.o')
    panel = await waitPanel(page, (p) => !p.invalid && p.count === '第 1 项，共 2 项', '合法正则恢复 2 处')
    const beforeEdits = (await editRequests(page)).length
    await page.click('.vsidian-find-replace-input')
    await page.keyboard.type('baz')
    await page.click('.vsidian-find-replace-next')
    await waitPanel(page, (p) => p.count === '第 1 项，共 1 项', '替换下一个后余 1 处')
    let edits = await editRequests(page)
    assert.equal(edits.length, beforeEdits + 1, '替换下一个应恰一笔 edit.request')
    let editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, 'Foo bar baz Bar\nfood foo\n', '首个全字 foo 应被替换为 baz')
    await page.evaluate(() => window.ackLastEdit(2))

    // ---- 场景 6：全部替换（整批一笔）----
    await page.click('.vsidian-find-replace-all')
    await waitPanel(page, (p) => p.count === '无结果', '全部替换后无结果')
    edits = await editRequests(page)
    assert.equal(edits.length, beforeEdits + 2, '全部替换应整批恰一笔 edit.request')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, 'Foo bar baz Bar\nfood baz\n', '全部全字 foo 应被替换（Foo/food 不动）')
    await page.evaluate(() => window.ackLastEdit(3))

    // ---- 场景 7：Esc 关闭；焦点归还编辑器 ----
    await page.keyboard.press('Escape')
    panel = await waitPanel(page, (p) => !p.open, 'Esc 关闭')
    const focusedEditor = await page.evaluate(() => {
      const view = document.querySelector('.cm-content')
      return !!view && document.activeElement !== null &&
        (view === document.activeElement || view.contains(document.activeElement))
    })
    assert.ok(focusedEditor, 'Esc 后焦点应归还编辑器')

    // ---- 场景 7.5：正则全部替换后高亮清空（#241 验收实测回归：替换后残余）----
    await page.evaluate(() => window.initDoc('a1 a22 a333\n'))
    await page.evaluate(() => window.focusEditor())
    await page.keyboard.press('Control+f')
    panel = await waitPanel(page, (p) => p.open && p.activeIsInput, '正则复现前置：Ctrl+F')
    // 正则未开则点开（沿上一场景开关档，init 不重置 findOptions）
    if (!(await page.evaluate(() =>
      document.querySelector('.vsidian-find-regexp')?.classList.contains('vsidian-find-regexp-active')))) {
      await page.click('.vsidian-find-regexp')
    }
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.replaceOpen, '正则复现：替换栏展开')
    // Ctrl+H 会从选区播种查询词（原生同款），展开后重输目标正则
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('a\\d+')
    panel = await waitPanel(page, (p) => p.regexpActive && p.count === '第 1 项，共 3 项', '正则 3 处命中')
    await page.click('.vsidian-find-replace-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('z')
    await page.click('.vsidian-find-replace-all')
    panel = await waitPanel(page, (p) => p.count === '无结果', '全部替换后应无结果')
    assert.equal(panel.matchMarks, 0, `全部替换后不得残余匹配装饰，实际 ${panel.matchMarks}`)
    assert.equal(panel.currentMarks, 0, `全部替换后不得残余当前匹配装饰，实际 ${panel.currentMarks}`)
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, 'z z z\n', '正则全部替换文本应正确')
    await page.evaluate(() => window.ackLastEdit(2))
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, '正则复现收尾：Esc 关闭')

    // ---- 场景 7.6：阅读模式查找块级高亮（#241 验收实测回归：阅读无搜索高亮）----
    await page.evaluate(() => window.initDoc('alpha 开头段。\n\n表格外的普通段落 beta。\n'))
    await page.evaluate(() => window.setViewMode('reading'))
    // 键路由要求焦点在阅读容器内（readingFocused 判定）
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      if (container instanceof HTMLElement) container.focus()
    })
    await page.keyboard.press('Control+f')
    panel = await waitPanel(page, (p) => p.open && p.activeIsInput, '阅读模式 Ctrl+F')
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('beta')
    panel = await waitPanel(page, (p) => p.count === '第 1 项，共 1 项', '阅读模式计数')
    const hitBlocks = await page.evaluate(() =>
      document.querySelectorAll('.vsidian-reading-find-hit').length)
    assert.ok(hitBlocks >= 1, `阅读模式查找应有命中块高亮，实际 ${hitBlocks}`)
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, '阅读模式 Esc 关闭')

    // 阅读字符高亮：callout/引用块只染命中文字，隐藏目标不误标可见文字。
    await page.evaluate(() => window.initDoc('alpha\n\n> [!note] beta\n> **beta** and beta.\n\n[link](beta.md) beta'))
    await page.evaluate(() => document.querySelector('.vsidian-view-reading').focus())
    await page.keyboard.press('Control+f')
    await page.locator('.vsidian-find-input').fill('beta')
    await waitPanel(page, p => /共 5 项$/.test(p.count), '阅读源码计数保留隐藏目标')
    const reading = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('.vsidian-view-reading .vsidian-find-match')]
      const current = document.querySelector('.vsidian-view-reading .vsidian-find-match-current')
      const block = document.querySelector('.vsidian-view-reading .vsidian-reading-find-hit')
      return {texts:marks.map(el => el.textContent), current:current?.textContent,
        currentColor:current && getComputedStyle(current).backgroundColor,
        otherColor:marks.find(el => el !== current) && getComputedStyle(marks.find(el => el !== current)).backgroundColor,
        blockColor:block && getComputedStyle(block).backgroundColor,
        blockShadow:block && getComputedStyle(block).boxShadow}
    })
    assert.deepEqual(reading.texts, ['beta','beta','beta','beta'])
    assert.equal(reading.current, 'beta')
    assert.equal(reading.currentColor, 'rgba(255, 141, 55, 0.65)')
    assert.equal(reading.otherColor, 'rgba(234, 179, 8, 0.28)')
    assert.equal(reading.blockColor, 'rgba(0, 0, 0, 0)')
    assert.equal(reading.blockShadow, 'none', 'callout 整块不画搜索边条')
    await page.screenshot({path:path.join(root, `.scratch/241-acceptance/reading-highlight-${theme}.png`)})
    // 旧变量仍能为旧选择器对应的命中块着色。
    await page.evaluate(() => document.getElementById('app').style.setProperty('--vsidian-find-hit-block-background', 'rgb(10,30,50)'))
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vsidian-reading-find-hit')).backgroundColor), 'rgb(10, 30, 50)')
    await page.evaluate(() => document.getElementById('app').style.removeProperty('--vsidian-find-hit-block-background'))
    await page.keyboard.press('Escape')
    await waitPanel(page, p => !p.open, '阅读字符高亮关闭')
    assert.equal(await page.locator('.vsidian-view-reading .vsidian-find-match').count(), 0)

    await page.evaluate(() => {
      window.setViewMode('live')
      window.initDoc(Array.from({length:150}, (_,i) => `beta paragraph ${i}`).join('\n\n'))
      window.locate(0)
      window.setViewMode('reading')
    })
    await page.evaluate(() => document.querySelector('.vsidian-view-reading').focus())
    await page.keyboard.press('Control+f')
    await page.locator('.vsidian-find-input').fill('beta')
    await waitPanel(page, p => /第 1 项，共 150 项$/.test(p.count), '阅读虚拟化初始命中')
    await page.keyboard.press('Shift+Enter')
    await waitPanel(page, p => /第 150 项，共 150 项$/.test(p.count), '阅读跳到末项')
    await page.waitForFunction(() => document.querySelector('.vsidian-view-reading .vsidian-find-match-current')?.dataset.vsidianFindIndex === '149')
    assert.ok(await page.locator('.vsidian-view-reading .vsidian-find-match').count() < 150, '只标记已挂载内容')
    await page.keyboard.press('Enter')
    await waitPanel(page, p => /第 1 项，共 150 项$/.test(p.count), '阅读回首项重挂载')
    await page.waitForFunction(() => document.querySelector('.vsidian-view-reading .vsidian-find-match-current')?.dataset.vsidianFindIndex === '0')
    await page.evaluate(() => window.setViewMode('live'))
    await page.evaluate(() => window.setViewMode('reading'))
    await page.waitForFunction(() => document.querySelector('.vsidian-view-reading .vsidian-find-match-current')?.textContent === 'beta')
    await page.keyboard.press('Escape')
    await waitPanel(page, p => !p.open, '阅读重挂载与切模式关闭')

    // Hidden-source feedback must not alter reading layout or editor text.
    const sourceDoc = '| name | state |\n| --- | --- |\n| build | ok |\n\nBelow the table.'
    await page.evaluate(text => {
      window.setViewMode('live'); window.initDoc(text); window.locate(0); window.setViewMode('reading')
      document.querySelector('.vsidian-view-reading').focus()
    }, sourceDoc)
    await page.keyboard.press('Control+f')
    if ((await page.evaluate(() => window.readFindPanel())).wordActive) await page.click('.vsidian-find-word')
    if ((await page.evaluate(() => window.readFindPanel())).regexpActive) await page.click('.vsidian-find-regexp')
    const sourceEdits = (await editRequests(page)).length
    const layout = () => page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      const paragraph = [...container.querySelectorAll('p')].find(el => el.textContent === 'Below the table.')
      return { tableHeight: container.querySelector('table').getBoundingClientRect().height,
        paragraphTop: paragraph.getBoundingClientRect().top, scrollHeight: container.scrollHeight }
    })
    await page.locator('.vsidian-find-input').fill('name')
    await waitPanel(page, p => /共 1 项$/.test(p.count), '阅读可见单元格命中')
    const beforeSource = await layout()
    assert.equal(await page.locator('.vsidian-reading-find-source').count(), 0)
    await page.locator('.vsidian-find-input').fill('|')
    await waitPanel(page, p => /第 1 项，共 9 项$/.test(p.count), '表格隐藏分隔符计数')
    const sourcePopup = page.locator('.vsidian-reading-find-source')
    await sourcePopup.waitFor({state:'visible'})
    const sourceSnippet = await page.addStyleTag({content:'.vsidian-reading-find-source { border-radius: 0px; }'})
    assert.equal(await sourcePopup.evaluate(el => getComputedStyle(el).borderRadius), '0px', '裸类用户片段必须可以覆盖新增浮层')
    await sourceSnippet.evaluate(el => el.remove())
    assert.equal(await sourcePopup.locator('code').textContent(), '| name | state |')
    assert.equal(await sourcePopup.locator('.vsidian-find-match-current').textContent(), '|')
    assert.equal(await page.locator('.vsidian-view-reading .vsidian-find-match-current').count(), 0)
    assert.deepEqual(await layout(), beforeSource, '浮层弹出不得移动下方段落或改变滚动高度')
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('vsidian-find-input')), true)
    await page.keyboard.press('Enter')
    assert.equal(await sourcePopup.locator('.vsidian-find-match-current').getAttribute('data-vsidian-find-index'), '1')
    await page.locator('.vsidian-find-input').fill('| ---')
    await waitPanel(page, p => /共 2 项$/.test(p.count), '完全隐藏的分隔行命中')
    assert.equal(await sourcePopup.locator('code').textContent(), '| --- | --- |')
    assert.equal(await sourcePopup.locator('.vsidian-find-match-current').textContent(), '| ---')
    await page.evaluate(() => {
      document.getElementById('app').style.setProperty('--vsidian-find-match-current-background', 'rgb(20,120,200)')
      document.getElementById('app').style.setProperty('--vsidian-find-match-background', 'rgb(250,220,100)')
    })
    await sourcePopup.waitFor({state:'visible'})
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const sourceClip = await sourcePopup.locator('.vsidian-find-match-current').evaluate(el => {
      const range = document.createRange(); range.setStart(el.firstChild, 1); range.setEnd(el.firstChild, 2)
      const rect = range.getBoundingClientRect()
      return {x:Math.floor((rect.left+rect.right)/2), y:Math.floor((rect.top+rect.bottom)/2), width:1, height:1}
    })
    assert.ok(sourceClip.x > 0 && sourceClip.y > 0, '像素采样必须在完成布局的浮层内')
    const sourcePng = await page.screenshot({clip:sourceClip})
    const sourcePixel = await page.evaluate(async base64 => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`; await img.decode()
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0,3)
    }, sourcePng.toString('base64'))
    await page.screenshot({path:path.join(root, `.scratch/241-acceptance/reading-source-${theme}.png`)})
    const sourcePaint = await sourcePopup.locator('.vsidian-find-match-current').evaluate((el, clip) => {
      const rect = el.getBoundingClientRect()
      const hit = document.elementFromPoint(clip.x, clip.y)
      return { color: getComputedStyle(el).backgroundColor, rect:rect.toJSON(), hit:hit?.className,
        popup:el.closest('aside').getBoundingClientRect().toJSON(), clip }
    }, sourceClip)
    assert.deepEqual(sourcePixel, [20,120,200], `浮层当前命中的截图像素须真正呈高亮色：${JSON.stringify(sourcePaint)}`)
    await page.locator('.vsidian-find-input').fill('name')
    await waitPanel(page, p => /共 1 项$/.test(p.count), '回到可见命中')
    assert.equal(await sourcePopup.count(), 0)
    assert.deepEqual(await layout(), beforeSource, '浮层收起不得移动下方段落或改变滚动高度')
    await page.locator('.vsidian-find-input').fill('|')
    await page.evaluate(() => window.setViewMode('live'))
    assert.equal(await sourcePopup.count(), 0, '切 Live 清理阅读源码浮层')
    await page.evaluate(() => window.setViewMode('reading'))
    await sourcePopup.waitFor({state:'visible'})
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Escape')
    assert.equal(await sourcePopup.count(), 0, '关闭查找释放源码浮层')
    assert.equal((await page.evaluate(() => window.readEditor())).text, sourceDoc)
    assert.equal((await editRequests(page)).length, sourceEdits, '源码反馈全程零写回')
    await page.evaluate(() => {
      document.getElementById('app').style.removeProperty('--vsidian-find-match-current-background')
      document.getElementById('app').style.removeProperty('--vsidian-find-match-background')
    })

    await page.setViewportSize({width:360, height:480})
    await page.evaluate(() => document.querySelector('.vsidian-view-reading').focus())
    await page.keyboard.press('Control+f')
    await page.locator('.vsidian-find-input').fill('|')
    await sourcePopup.waitFor({state:'visible'})
    const sourceBounds = await sourcePopup.boundingBox()
    assert.ok(sourceBounds.x >= 0 && sourceBounds.x + sourceBounds.width <= 360)
    assert.ok(sourceBounds.y >= 0 && sourceBounds.y + sourceBounds.height <= 480)
    await page.screenshot({path:path.join(root, `.scratch/241-acceptance/reading-source-mobile-${theme}.png`)})
    await page.keyboard.press('Escape')
    await page.setViewportSize({width:900, height:640})
    await page.evaluate(() => {
      window.setViewMode('live')
      window.initDoc(Array.from({length:100}, (_,i) => `| name | state |\n| --- | --- |\n| row${i} | ok |\n\nBelow ${i}.`).join('\n\n'))
      window.locate(0); window.setViewMode('reading')
      document.querySelector('.vsidian-view-reading').focus()
    })
    await page.keyboard.press('Control+f')
    await page.locator('.vsidian-find-input').fill('|')
    await waitPanel(page, p => /第 1 项，共 900 项$/.test(p.count), '隐藏源码虚拟挂载初始计数')
    await page.keyboard.press('Shift+Enter')
    await waitPanel(page, p => /第 900 项，共 900 项$/.test(p.count), '隐藏源码跳至屏外末项')
    await sourcePopup.waitFor({state:'visible'})
    assert.equal(await sourcePopup.locator('.vsidian-find-match-current').getAttribute('data-vsidian-find-index'), '899')
    assert.equal(await sourcePopup.locator('code').textContent(), '| row99 | ok |')
    assert.ok(await page.locator('.vsidian-reading-table').count() < 100)
    await page.keyboard.press('Enter')
    await waitPanel(page, p => /第 1 项，共 900 项$/.test(p.count), '隐藏源码回首项重挂载')
    await sourcePopup.waitFor({state:'visible'})
    assert.equal(await sourcePopup.locator('.vsidian-find-match-current').getAttribute('data-vsidian-find-index'), '0')
    assert.equal(await sourcePopup.count(), 1, '虚拟重挂载只保留一个源码浮层')
    await page.keyboard.press('Escape')

    // ---- 场景 7.7：在选定内容中查找（#241 资产接线：真实键盘选区 + ☰）----
    await page.evaluate(() => window.setViewMode('live'))
    await page.evaluate(() => window.initDoc('foo foo foo\nbar foo\n'))
    // initDoc 后定位到文档头（切 live 的锚点恢复不保证行位置）
    await page.evaluate(() => window.locate?.(0))
    await page.evaluate(() => window.focusEditor())
    // 光标落第一行行首，Shift+End 选中整行（三处 foo 的范围）
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Control+f')
    panel = await waitPanel(page, (p) => p.open && p.activeIsInput, '7.7 前置：选区后 Ctrl+F')
    assert.equal(panel.inSelectionDisabled, false, '有用户选区锚点时 ☰ 应可用')
    await page.click('.vsidian-find-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('foo')
    panel = await waitPanel(page, (p) => /共 4 项$/.test(p.count), '全量计数 4 处')
    await page.click('.vsidian-find-in-selection')
    panel = await waitPanel(page, (p) => p.inSelectionActive && /共 3 项$/.test(p.count), '限选区后 3 处')
    assert.ok(panel.selectionRangeMarks >= 1, '范围淡底装饰应在场')
    // 全部替换只动范围内（第一行三处；bar 行第四处不动）
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.replaceOpen, '7.7 替换栏展开')
    await page.click('.vsidian-find-replace-input')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('baz')
    await page.click('.vsidian-find-replace-all')
    panel = await waitPanel(page, (p) => p.count === '无结果', '范围内全部替换后无结果')
    editor = await page.evaluate(() => window.readEditor())
    assert.equal(editor.text, 'baz baz baz\nbar foo\n', '范围外命中不得被替换')
    await page.evaluate(() => window.ackLastEdit(2))
    // Esc 关闭后重开：复位（全量语义，范围装饰退场）
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, '7.7 Esc 关闭')
    const cleared = await page.evaluate(() =>
      document.querySelectorAll('.cm-content .vsidian-find-selection-range').length)
    assert.equal(cleared, 0, '关闭后范围淡底应退场')
    await page.keyboard.press('Control+f')
    panel = await waitPanel(page, (p) => p.open && !p.inSelectionActive, '重开面板复位')
    // 锚点跨面板开关保持（最近一次用户选区仍有效）：☰ 保持可用；点击
    // 正文落下光标（空选区事务）后锚点清空、☰ 转禁用
    assert.equal(panel.inSelectionDisabled, false, '用户选区锚点跨开关保持，☰ 应可用')
    await page.click('.cm-content', { position: { x: 10, y: 10 } })
    panel = await waitPanel(page, (p) => p.inSelectionDisabled === true, '空选区事务后 ☰ 禁用')

    // ---- 场景 8：阅读模式整体禁用替换（2026-10）——live Ctrl+H 展开 →
    // 阅读 toggle 禁用灰化、Ctrl+H 不响应 → 回 live 展开记忆原样恢复 ----
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.open && p.replaceOpen, 'live Ctrl+H 展开替换栏')
    await page.evaluate(() => window.setViewMode('reading'))
    panel = await waitPanel(page, (p) => p.open && !p.replaceOpen, '阅读模式替换行收起')
    panel = await waitPanel(page, (p) => p.toggleDisabled === true, '阅读模式 toggle 禁用')
    assert.ok(parseFloat(panel.toggleOpacity) < 1, `阅读模式 toggle 应灰化，实际 opacity=${panel.toggleOpacity}`)
    // 键路由要求焦点在阅读容器内（readingFocused 判定）
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      if (container instanceof HTMLElement) container.focus()
    })
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.open && !p.replaceOpen, '阅读模式 Ctrl+H 不展开')
    // 回 live：toggle 恢复可用，live 展开记忆原样恢复（阅读侧未触碰）
    await page.evaluate(() => window.setViewMode('live'))
    panel = await waitPanel(page, (p) => p.open && p.replaceOpen && p.toggleDisabled === false, '回 live 替换展开记忆恢复')

    // ---- 场景 8b：面板关闭后阅读模式 Ctrl+H 不开面板（替换命令整体禁用）----
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, 'Esc 关闭')
    await page.evaluate(() => window.setViewMode('reading'))
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      if (container instanceof HTMLElement) container.focus()
    })
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => !p.open, '阅读模式 Ctrl+H 不开面板')
    // 回 live：Ctrl+H 恢复正常开面板并展开（关闭已清记忆，走 live 展开路径）
    await page.evaluate(() => window.setViewMode('live'))
    await page.evaluate(() => window.focusEditor())
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.open && p.replaceOpen, 'live Ctrl+H 恢复开面板展开')
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, '收尾 Esc 关闭')
    assert.deepEqual(errors, [], '全程不得有页面错误')
    await page.close()
  }
  console.log('findPanel: 全部场景通过（light/dark）')
} finally {
  await browser.close()
}
