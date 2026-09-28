// 符号自动补全浏览器回归（#123）：真实键盘/剪贴板/CDP IME 驱动生产控制器，
// 断言最终文本与光标。覆盖：括号引号补全与光标居中、闭合越过（零插入）、
// 星号三连硬契约（| → *|* → **| → ***|）、自动空对退格同删两侧、非自动
// 来源不接管、粘贴保持原文、中文 composition 候选不干预与提交补全/完整对
// 不补、选区经 IME 提交单个起始符号的包裹重建（叠加/弯引号/完整对不补）、
// 代码块内括号照补与强调抑制、转义与撇号防误触、右邻抑制生态口径
// （#151：词字符/标点前不越界补全，空白/闭合类照补、双链骨架两键成型、
// IME 提交同口径）、设置开关即时生效。
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

  // ---- #151 右邻抑制（生态口径对齐）：真实键盘与 IME 提交两路径同口径 ----
  await scenario('右邻正文词字符不越界补全：word 前键 [ 原样插入', { doc: 'a word', cursor: 2 }, async (page) => {
    await page.keyboard.type('[')
    await check(page, 'a [word', 3, '不补闭合')
  })
  await scenario('右邻普通标点不越界补全：逗号前键（ 原样插入', { doc: 'a, b', cursor: 1 }, async (page) => {
    await page.keyboard.type('(')
    await check(page, 'a(, b', 2, '不补闭合')
  })
  await scenario('右邻空白照常补全（对照）', { doc: 'a word', cursor: 1 }, async (page) => {
    await page.keyboard.type('[')
    await check(page, 'a[] word', 2, '照常补全')
  })
  await scenario('右邻闭合类照常补全（对照）：) 前键 [ 得 [])b', { doc: 'a )b', cursor: 2 }, async (page) => {
    await page.keyboard.type('[')
    await check(page, 'a [])b', 3, '闭合类放行')
  })
  await scenario('双链骨架两键成型：[|] 内再键 [ 得 [[|]]（右邻 ] 属闭合类，照补保留）', { doc: '', cursor: 0 }, async (page) => {
    await page.keyboard.type('[')
    await check(page, '[]', 1, '第一键补对')
    await page.keyboard.type('[')
    await check(page, '[[]]', 2, '第二键照补（[[|]] 骨架）')
  })
  await scenario('IME 提交路径同口径：右邻词字符提交全角括号不补', { doc: 'word', cursor: 0 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    await check(page, '（word', 1, 'IME 提交不补')
  })

  // ---- 表格格内补全（格内允许括号；格区语义另有集成覆盖）----
  await scenario('表格格内键入括号照常补全', { doc: TABLE_DOC, cursor: TABLE_DOC.indexOf('1') + 1 }, async (page) => {
    await page.keyboard.type('(')
    const after = await read(page)
    assert.equal(after.text, TABLE_DOC.replace('1', '1()'), `格内补全: ${JSON.stringify(after)}`)
  })

  // ---- #124 选区包裹：真实键盘选择（Shift+方向键）→ 键入符号 ----
  const selectRight = async (page, times) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press('Shift+ArrowRight')
    }
  }
  const checkRanges = async (page, text, expectedRanges, name) => {
    const after = await read(page)
    assert.equal(after.text, text, `${name}: ${JSON.stringify(after)}`)
    assert.deepEqual(after.ranges, expectedRanges, `${name} ranges: ${JSON.stringify(after)}`)
  }
  await scenario('选区包裹并保持原文选中：真实键盘选择后键入星号', { doc: 'hello text', cursor: 6 }, async (page) => {
    await selectRight(page, 4)
    await page.keyboard.type('*')
    await checkRanges(page, 'hello *text*', [{ from: 7, to: 11 }], '单段包裹')
  })
  await scenario('连续包裹叠加成粗体（不是切换取消）', { doc: 'hello text', cursor: 6 }, async (page) => {
    await selectRight(page, 4)
    await page.keyboard.type('*')
    await page.keyboard.type('*')
    await checkRanges(page, 'hello **text**', [{ from: 8, to: 12 }], '连续包裹')
  })
  for (const route of ['keyboard', 'ime']) {
    await scenario(`包裹撤销后再次包裹：${route}`, { doc: 'hello text', cursor: 6 }, async (page) => {
      const cdp = route === 'ime' ? await page.context().newCDPSession(page) : null
      const open = route === 'ime' ? '（' : '*'
      const close = route === 'ime' ? '）' : '*'
      await selectRight(page, 4)
      for (let cycle = 0; cycle < 2; cycle++) {
        if (cdp) {
          await cdp.send('Input.imeSetComposition', { text: open, selectionStart: 1, selectionEnd: 1 })
          await cdp.send('Input.insertText', { text: open })
        } else {
          await page.keyboard.type(open)
        }
        await checkRanges(page, `hello ${open}text${close}`, [{ from: 7, to: 11 }], `第 ${cycle + 1} 次包裹`)
        await page.waitForFunction((count) => window.readHostMessages().filter((message) => message.kind === 'edit.request').length >= count,
          cycle + 1)
        await page.keyboard.press('Control+z')
        // #148 竞态守卫：包裹编辑在途未确认时撤销意图暂存，确认后才出站
        // ——宿主可见顺序恒为 edit.request 先于 history.request
        assert.equal(await page.evaluate(() => window.readHostMessages().filter((message) => message.kind === 'history.request').length),
          cycle, '#148 守卫：在途包裹请求未确认时 Ctrl+Z 意图应暂存不出站')
        const undoChanges = cdp
          ? [{ offset: 6, length: 6, text: 'text' }]
          : [{ offset: 6, length: 1, text: '' }, { offset: 11, length: 1, text: '' }]
        await page.evaluate(({ changes, version }) => window.ackAndExternalUndo(changes, version),
          { changes: undoChanges, version: 2 + cycle * 2 })
        assert.equal(await page.evaluate(() => window.readHostMessages().filter((message) => message.kind === 'history.request').length),
          cycle + 1, '确认后撤销意图应按序发往宿主')
        await checkRanges(page, 'hello text', [{ from: 6, to: 10 }], `第 ${cycle + 1} 次撤销`)
      }
    })
  }
  await scenario('反向选区（从右往左选）同样包裹', { doc: 'hello text', cursor: 10 }, async (page) => {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+ArrowLeft')
    }
    await page.keyboard.type('*')
    await checkRanges(page, 'hello *text*', [{ from: 7, to: 11 }], '反向选区包裹')
  })
  await scenario('方括号两键形成 [[wikilink]] 类结构', { doc: 'a word b', cursor: 2 }, async (page) => {
    await selectRight(page, 4)
    await page.keyboard.type('[')
    await page.keyboard.type('[')
    await checkRanges(page, 'a [[word]] b', [{ from: 4, to: 8 }], '双链类结构')
  })
  await scenario('跨段包裹：空行保留、各段原文多 range 保持、第二键不包标记', { doc: '甲段\n\n乙段', cursor: 0 }, async (page) => {
    await selectRight(page, 6)
    await page.keyboard.type('*')
    await checkRanges(page, '*甲段*\n\n*乙段*', [
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ], '跨段第一键')
    await page.keyboard.type('*')
    await checkRanges(page, '**甲段**\n\n**乙段**', [
      { from: 2, to: 4 },
      { from: 10, to: 12 },
    ], '跨段第二键（多 range 真实键盘经 CM6 replaceSelection）')
  })
  await scenario('代码块内 Markdown 强调不包裹、括号照常包裹', { doc: '```js\nconst a\n```', cursor: 6 }, async (page) => {
    await selectRight(page, 5)
    await page.keyboard.type('*')
    await check(page, '```js\n* a\n```', 7, '强调不包裹（普通替换，仅 const 被替换）')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.type('(')
    await checkRanges(page, '```js\n(*) a\n```', [{ from: 7, to: 8 }], '代码内括号包裹')
  })
  await scenario('表格格内局部文本选区照常包裹', { doc: TABLE_DOC, cursor: TABLE_DOC.indexOf('1') }, async (page) => {
    await selectRight(page, 1)
    await page.keyboard.type('*')
    const after = await read(page)
    assert.equal(after.text, TABLE_DOC.replace('1', '*1*'), `格内选区包裹: ${JSON.stringify(after)}`)
  })
  await scenario('粘贴替换选区不包裹', { doc: 'hello text', cursor: 6, grantClipboard: true }, async (page) => {
    await selectRight(page, 4)
    await page.evaluate(() => navigator.clipboard.writeText('**'))
    await page.keyboard.press('Control+v')
    await check(page, 'hello **', 8, '粘贴按普通替换语义')
  })
  await scenario('选中文字经 IME 提交单个起始符号：包裹重建并保持原文选中', { doc: 'hello text', cursor: 6 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await selectRight(page, 4)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    // 组合开始时快照选区，定稿提交单个起始符号 → 重建 open+原文+close
    await checkRanges(page, 'hello （text）', [{ from: 7, to: 11 }], 'IME 提交包裹')
  })
  await scenario('IME 包裹后再次 IME 提交继续叠加（（text））', { doc: 'hello text', cursor: 6 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await selectRight(page, 4)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    await checkRanges(page, 'hello （（text））', [{ from: 8, to: 12 }], 'IME 连续叠加')
  })
  await scenario('跨段选区经 IME 提交：各段包裹且空行保留', { doc: '甲段\n\n乙段', cursor: 0 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await selectRight(page, 6)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    await checkRanges(page, '（甲段）\n\n（乙段）', [
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ], '跨段 IME 包裹')
    // 出站合并是异步 flush：先等至少一笔到位，再严格断言恰一笔（双写回仍会被抓住）
    await page.waitForFunction(() => window.readHostMessages().filter((message) => message.kind === 'edit.request').length >= 1)
    const requests = await page.evaluate(() => window.readHostMessages().filter((message) => message.kind === 'edit.request'))
    assert.equal(requests.length, 1, `跨段 IME 单笔写回: ${JSON.stringify(requests)}`)
    await cdp.send('Input.imeSetComposition', { text: '（', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '（' })
    await checkRanges(page, '（（甲段））\n\n（（乙段））', [
      { from: 2, to: 4 },
      { from: 10, to: 12 },
    ], '跨段 IME 连续叠加')
  })
  await scenario('IME 提交弯引号“：得“text”', { doc: 'hello text', cursor: 6 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await selectRight(page, 4)
    await cdp.send('Input.imeSetComposition', { text: '“', selectionStart: 1, selectionEnd: 1 })
    await cdp.send('Input.insertText', { text: '“' })
    await checkRanges(page, 'hello “text”', [{ from: 7, to: 11 }], 'IME 弯引号对')
  })
  await scenario('IME 提交完整符号对（）不包裹不补全', { doc: 'hello text', cursor: 6 }, async (page) => {
    const cdp = await page.context().newCDPSession(page)
    await selectRight(page, 4)
    await cdp.send('Input.imeSetComposition', { text: '（）', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '（）' })
    await check(page, 'hello （）', 8, '完整对普通替换语义')
  })
  await scenario('选区包裹设置关闭后停用、重开后恢复', { doc: 'a word b', cursor: 2 }, async (page) => {
    await page.evaluate(() => window.setSymbolSelectionWrap(false))
    await selectRight(page, 4)
    await page.keyboard.type('*')
    await check(page, 'a * b', 3, '关闭后普通替换（word 被键入字符替换）')
    await page.evaluate(() => window.setSymbolSelectionWrap(true))
    await page.evaluate(() => window.locate(0))
    await selectRight(page, 2)
    await page.keyboard.type('(')
    await checkRanges(page, '(a )* b', [{ from: 1, to: 3 }], '重开后包裹恢复')
  })
  await scenario('多光标双 range 表内键入竖线：逐光标转义、不丢字（评审 P2-8 实证）', { doc: TABLE_DOC, cursor: TABLE_DOC.indexOf('a') + 1 }, async (page) => {
    // allowMultipleSelections 随 #124 包裹组装配的伴生行为：CM6 默认添加
    // 光标手势为 Ctrl+click（Windows/Linux；macOS Cmd+click——journal-124
    // 决策 7 与评审 P2-8 记的 Alt+click 系手势误记，CM6 源码
    // addsSelectionRange 默认 browser.mac ? metaKey : ctrlKey）。实测纠正
    // 评审预判：多 range 键入 | 不经评审引用的单 range filter 门控，而是
    // keymap 命令 tablePipeKeyHandler 在 keydown 阶段逐 range 转义为 \|
    // （任一 range 无需转义才整体交默认，避免多光标语义分裂）——表格
    // 结构不被裸竖线破坏。断言：双光标建立、两处各自 \|、其余文本逐字
    // 保持、键入后仍双光标（选区贴插入点左侧）
    const second = TABLE_DOC.indexOf('1') + 1
    const at = await page.evaluate((offset) => window.posCoords(offset), second)
    // 真实手势：按住 Ctrl（键盘修饰键）点击；坐标取边界 +1px 落进右侧
    // 字符左半段，posAtCoords 就近取目标边界（钉住第二光标在 '1' 后，
    // 与字体渲染宽度解耦）。page.mouse.click 是低层 API 无 modifiers 参数
    await page.keyboard.down('Control')
    await page.mouse.click(at.x + 1, at.y)
    await page.keyboard.up('Control')
    const two = await read(page)
    assert.equal(two.ranges.length, 2, `双光标建立: ${JSON.stringify(two)}`)
    await page.keyboard.type('|')
    const after = await read(page)
    assert.equal(after.text, '| a\\| | b |\n| --- | --- |\n| 1\\| | 2 |\npara', `多光标键入: ${JSON.stringify(after)}`)
    assert.deepEqual(after.ranges, [{ from: 3, to: 3 }, { from: 29, to: 29 }], `键入后光标: ${JSON.stringify(after)}`)
  })

  // ---- #125 围栏内两步 Tab 越界：真实 Tab 键驱动生产 keymap 链 ----
  // 优先级「越界 → 表格导航 → 缩进」在此实证（生产控制器装配，非注释推断）
  const tab = (page) => page.keyboard.press('Tab')
  await scenario('粗体两步越界：闭合左边界 → 越过整个闭合标记（不停在 ** 中间）', { doc: '**something**', cursor: 6 }, async (page) => {
    await tab(page)
    await check(page, '**something**', 11, '首按到 ** 左边界')
    await tab(page)
    await check(page, '**something**', 13, '再按越过整个 **（零写回）')
  })
  await scenario('目标是闭合边界而非词尾：**some| thing** 首按落在空格后', { doc: '**some thing**', cursor: 6 }, async (page) => {
    await tab(page)
    await check(page, '**some thing**', 12, '闭合左边界，不是词尾')
  })
  await scenario('斜体/行内代码/高亮/删除线（树围栏全类型）两步越界', { doc: '*斜体正文*', cursor: 3 }, async (page) => {
    await tab(page)
    await check(page, '*斜体正文*', 5, 'Emphasis 闭合左边界')
    await tab(page)
    await check(page, '*斜体正文*', 6, '越出')
  })
  await scenario('行内代码两步越出反引号', { doc: 'a `code` b', cursor: 5 }, async (page) => {
    await tab(page)
    await check(page, 'a `code` b', 7, '闭 ` 左边界')
    await tab(page)
    await check(page, 'a `code` b', 8, '越出')
  })
  await scenario('高亮两步越界', { doc: 'a ==高亮== b', cursor: 5 }, async (page) => {
    await tab(page)
    await check(page, 'a ==高亮== b', 6, 'Highlight 闭合左边界')
    await tab(page)
    await check(page, 'a ==高亮== b', 8, '越出 ==')
  })
  await scenario('删除线两步越界', { doc: 'a ~~删除~~ b', cursor: 5 }, async (page) => {
    await tab(page)
    await check(page, 'a ~~删除~~ b', 6, 'Strikethrough 闭合左边界')
    await tab(page)
    await check(page, 'a ~~删除~~ b', 8, '越出 ~~')
  })
  await scenario('全角括号（行内匹配路径）两步越界', { doc: '（全角括号）', cursor: 3 }, async (page) => {
    await tab(page)
    await check(page, '（全角括号）', 5, '）左边界')
    await tab(page)
    await check(page, '（全角括号）', 6, '越出）')
  })
  await scenario('英文引号交替配对两步越界', { doc: 'say "quoted" ok', cursor: 8 }, async (page) => {
    await tab(page)
    await check(page, 'say "quoted" ok', 11, '闭引号左边界')
    await tab(page)
    await check(page, 'say "quoted" ok', 12, '越出闭引号')
  })
  await scenario('嵌套逐层退出（规格样例四步链）', { doc: '(a **bc** d)', cursor: 6 }, async (page) => {
    await tab(page)
    await check(page, '(a **bc** d)', 7, '**bc|**')
    await tab(page)
    await check(page, '(a **bc** d)', 9, '**bc**|')
    await tab(page)
    await check(page, '(a **bc** d)', 11, '(a **bc** d|')
    await tab(page)
    await check(page, '(a **bc** d)', 12, '(a **bc** d)|')
  })
  const TAB_FENCE_DOC = '| a | **bc** |\n| --- | --- |\n| 1 | 2 |'
  const ROW2 = TAB_FENCE_DOC.indexOf('**bc**')
  await scenario('表格格内先两步越界、越出后切格（全程零写回）', { doc: TAB_FENCE_DOC, cursor: ROW2 + 3 }, async (page) => {
    await tab(page)
    await check(page, TAB_FENCE_DOC, ROW2 + 4, '**bc|**')
    await tab(page)
    await check(page, TAB_FENCE_DOC, ROW2 + 6, '**bc**|（仍在格内）')
    await tab(page)
    await check(page, TAB_FENCE_DOC, TAB_FENCE_DOC.indexOf('1'), '越出围栏后切格（跳过分隔行）')
  })
  await scenario('格内无围栏直接切格', { doc: TAB_FENCE_DOC, cursor: TAB_FENCE_DOC.indexOf('a') + 1 }, async (page) => {
    await tab(page)
    await check(page, TAB_FENCE_DOC, ROW2, '下一格内容首')
  })
  await scenario('围栏外不向右搜索：正文沿用既有整行缩进', { doc: 'something **next**', cursor: 2 }, async (page) => {
    await tab(page)
    await check(page, '  something **next**', 4, '缩进回落')
  })
  await scenario('代码块内 Tab 继续缩进不越界', { doc: '```js\n(ab)\n```', cursor: 6 }, async (page) => {
    await tab(page)
    await check(page, '```js\n  (ab)\n```', 8, '缩进不越界')
  })
  await scenario('Shift+Tab 不新增反向越界：围栏内仍是反向缩进', { doc: '  **bold** rest', cursor: 7 }, async (page) => {
    await page.keyboard.press('Shift+Tab')
    await check(page, '**bold** rest', 5, '反向缩进原行为')
  })
  await scenario('Tab 越界设置关闭回落、重开恢复（即时生效）', { doc: '**something**', cursor: 6 }, async (page) => {
    await page.evaluate(() => window.setSymbolTabEscape(false))
    await tab(page)
    await check(page, '  **something**', 8, '关闭后围栏内 Tab 变整行缩进')
    await page.evaluate(() => window.setSymbolTabEscape(true))
    await page.evaluate(() => window.locate(8))
    await tab(page)
    await check(page, '  **something**', 13, '重开后越界恢复（新文本 ** 左边界 13）')
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
