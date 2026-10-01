// 查找面板浏览器回归（#236）：真实键盘路径（Ctrl+F 打开、键入、Enter/
// Shift+Enter 导航、Ctrl+H 展开替换栏、Esc 关闭）驱动生产控制器验证：
// 三开关语义（matchCase/wholeWord/regexp 计数变化 + 点亮态 + findOptions.set
// 出站）、非法正则红边不崩、替换写回（单笔 edit.request / 全部替换整批一笔）、
// 阅读模式替换栏不展开。明暗主题各跑一遍。
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
    await page.keyboard.type('foo')
    panel = await waitPanel(page, (p) => p.count === '第 1 项，共 4 项', '默认档键入计数 第1项共4项')
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

    // ---- 场景 8：阅读模式 Ctrl+H：面板开但替换栏不展开（只读）----
    await page.evaluate(() => window.setViewMode('reading'))
    // 键路由要求焦点在阅读容器内（readingFocused 判定）
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      if (container instanceof HTMLElement) container.focus()
    })
    await page.keyboard.press('Control+h')
    panel = await waitPanel(page, (p) => p.open && !p.replaceOpen, '阅读模式替换栏不展开')
    await page.keyboard.press('Escape')
    await waitPanel(page, (p) => !p.open, '阅读模式 Esc 关闭')
    assert.deepEqual(errors, [], '全程不得有页面错误')
    await page.close()
  }
  console.log('findPanel: 全部场景通过（light/dark）')
} finally {
  await browser.close()
}
