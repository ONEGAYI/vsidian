// 符号自动补全浏览器回归（#123）：真实键盘/剪贴板/CDP IME 驱动生产控制器，
// 断言最终文本与光标。覆盖：括号引号补全与光标居中、闭合越过（零插入）、
// 星号三连硬契约（| → *|* → **| → ***|）、自动空对退格同删两侧、非自动
// 来源不接管、粘贴保持原文、中文 composition 候选不干预与提交补全/完整对
// 不补、代码块内括号照补与强调抑制、转义与撇号防误触、设置开关即时生效。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/symbolInput.js')
// 与 tableCaret.mjs 同口径：katex 裸导入重定向官方 UMD；css 裁掉 woff/ttf
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
await build({ entryPoints: [path.join(root, 'test/browser/symbolInputFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

const TABLE_DOC = '| a | b |\n| --- | --- |\n| 1 | 2 |\npara'
const CODE_DOC = '```js\n\n```'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
let total = 0

// 粘贴场景专用：localhost origin 才有 navigator.clipboard（安全上下文），
// 授权后经真实 Control+v 触发 input.paste 事务
const clipboardServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<div id="app"></div>')
})
await new Promise((resolve) => clipboardServer.listen(0, '127.0.0.1', resolve))
const clipboardOrigin = `http://127.0.0.1:${clipboardServer.address().port}`

/** 单场景执行器：打开页面、初始化文档、定位光标、执行步骤、断言终态 */
async function scenario(name, { doc, cursor, grantClipboard }, run) {
  total++
  const page = await browser.newPage()
  if (grantClipboard) {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: clipboardOrigin })
    await page.goto(clipboardOrigin)
  } else {
    await page.setContent('<div id="app"></div>')
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: bundle })
    await page.evaluate((text) => window.initDoc(text), doc)
    // 先点击聚焦（光标会落到点击处），再经生产 view.locate 链路精确定位
    await page.click('.cm-content')
    if (cursor !== undefined) {
      await page.evaluate((offset) => window.locate(offset), cursor)
    }
    await run(page)
    assert.deepEqual(errors, [], `${name} 页面错误`)
    passed++
    console.log(`[符号输入][PASS] ${name}`)
  } catch (error) {
    console.log(`[符号输入][FAIL] ${name}: ${error.message}`)
    throw error
  } finally {
    await page.close()
  }
}

const read = (page) => page.evaluate(() => window.readEditor())
const check = async (page, text, head, name) => {
  const after = await read(page)
  assert.equal(after.text, text, `${name}: ${JSON.stringify(after)}`)
  if (head !== undefined) {
    assert.equal(after.head, head, `${name} head: ${JSON.stringify(after)}`)
  }
}

try {
  // ---- 补全与光标居中（真实键盘；全角符号经 insertText 走真实 input 事件）----
  for (const [ch, pair] of [['(', '()'], ['[', '[]'], ['{', '{}']]) {
    await scenario(`英文括号补全 ${ch}`, { doc: '', cursor: 0 }, async (page) => {
      await page.keyboard.type(ch)
      await check(page, pair, 1, '补全')
    })
  }
  for (const [ch, pair] of [
    ['（', '（）'], ['【', '【】'], ['《', '《》'], ['「', '「」'], ['『', '『』'],
    ['“', '“”'], ['‘', '‘’'],
  ]) {
    await scenario(`全角括号引号补全 ${ch}`, { doc: '', cursor: 0 }, async (page) => {
      await page.keyboard.insertText(ch)
      await check(page, pair, 1, '补全')
    })
  }
  await scenario('英文双引号自反补全', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('"')
    await check(page, '""', 1, '补全')
  })

  // ---- 闭合越过：零插入、光标跳过、后续输入落在闭合符号之后 ----
  await scenario('括号越过与后续输入', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('(')
    await page.keyboard.type(')')
    await check(page, '()', 2, '越过')
    await page.keyboard.type('x')
    await check(page, '()x', 3, '越过后输入')
  })
  await scenario('越过只认自动补出的闭合符号（手打相邻照常插入）', { doc: '()', cursor: 1 }, async (page) => {
    await page.keyboard.type(')')
    await check(page, '())', 2, '普通插入')
  })

  // ---- 星号三连硬契约：| → *|* → **| → ***| ----
  await scenario('星号三连硬契约', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('*')
    await check(page, '**', 1, '第一键 *|*')
    await page.keyboard.type('*')
    await check(page, '**', 2, '第二键 **|（越过，无 **|**）')
    await page.keyboard.type('*')
    await check(page, '***', 3, '第三键 ***|（不补对）')
  })

  // ---- 自动空对退格 ----
  await scenario('自动空对退格同删两侧', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('（')
    await check(page, '（）', 1, '补全')
    await page.keyboard.press('Backspace')
    await check(page, '', 0, '两侧同删')
  })
  await scenario('非自动来源空对退格只删起始符号', { doc: '（）', cursor: 1 }, async (page) => {
    await page.keyboard.press('Backspace')
    await check(page, '）', 0, '交默认删除')
  })
  await scenario('对内有内容后退格只删内容', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('(')
    await page.keyboard.type('好')
    await check(page, '(好)', 2, '对内输入')
    await page.keyboard.press('Backspace')
    await check(page, '()', 1, '只删内容')
  })

  // ---- 粘贴保持原文 ----
  await scenario('粘贴（  不触发补全', { doc: '', cursor: 0, grantClipboard: true }, async (page) => {
    await page.evaluate(() => navigator.clipboard.writeText('(('))
    await page.keyboard.press('Control+v')
    await check(page, '((', 2, '粘贴原文')
  })

  // ---- 中文 composition：候选不干预、提交补全、完整对不补 ----
  await scenario('IME 候选期间不干预、提交单个起始符号补全', { doc: '', cursor: 0 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await check(page, '（', 1, '候选期无补全')
    await cdp.send('Input.insertText', { text: '（' })
    await check(page, '（）', 1, '提交补全')
  })
  await scenario('IME 提交完整符号对不重复补全', { doc: '', cursor: 0 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '（）', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '（）' })
    await check(page, '（）', 2, '完整对不补')
  })

  // ---- 代码上下文 ----
  await scenario('代码块内括号照补、Markdown 强调抑制', { doc: CODE_DOC, cursor: 6 }, async (page) => {
    await page.keyboard.type('(')
    await check(page, '```js\n()\n```', 7, '括号补全')
    await page.keyboard.type('*')
    await check(page, '```js\n(*)\n```', 8, '强调抑制')
  })

  // ---- 防误触 ----
  await scenario('反斜杠转义后的星号按普通文字处理', { doc: 'a \\', cursor: 3 }, async (page) => {
    await page.keyboard.type('*')
    await check(page, 'a \\*', 4, '不补对')
  })
  await scenario('英文撇号词中不配对', { doc: 'don', cursor: 3 }, async (page) => {
    await page.keyboard.type("'")
    await check(page, "don'", 4, '不配对')
  })

  // ---- 表格格内补全（格内允许括号；格区语义另有集成覆盖）----
  await scenario('表格格内键入括号照常补全', { doc: TABLE_DOC, cursor: TABLE_DOC.indexOf('1') + 1 }, async (page) => {
    await page.keyboard.type('(')
    const after = await read(page)
    assert.equal(after.text, TABLE_DOC.replace('1', '1()'), `格内补全: ${JSON.stringify(after)}`)
  })

  // ---- 设置开关即时生效 ----
  await scenario('设置关闭后不补全、重开后恢复', { doc: '', cursor: 0 }, async (page) => {
    await page.evaluate(() => window.setSymbolAutocomplete(false))
    await page.keyboard.type('(')
    await check(page, '(', 1, '关闭后原样插入')
    await page.evaluate(() => window.setSymbolAutocomplete(true))
    await page.keyboard.type('[')
    await check(page, '([]', 2, '重开后补全')
  })
} finally {
  await browser.close()
  await new Promise((resolve) => clipboardServer.close(resolve))
}
console.log(`[符号输入] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
