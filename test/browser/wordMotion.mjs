// 使用浏览器原生键盘回归 #239 中文分词词级移动：Ctrl+Left/Right 与
// Shift 变体。拉丁路径断言已知 CM6 group 语义落点（回归钉住「拉丁行为
// 不变」）；中文路径按 page 上下文真实 Intl.Segmenter 边界动态断言
//（具体切分随 ICU 漂移不硬编码）；jieba 路径注入确定性词表（真实下载
// 链路属集成域）；表格场景钉住「裸方向键格导航与 Ctrl 词移动共存」
//（tableEditing 只绑裸方向键，注册表只登记带修饰键方向键）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/wordMotion.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/wordMotionFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

const CJK_DOC = '中文测试文档'
const MIXED_DOC = 'abc中文def更多'
const TABLE_DOC = '| aaaa | b |\n| --- | --- |\n| 1 | 2 |\npara'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 9

/** 打开一页并装载文档，聚焦正文后按 offset 定位（生产 view.locate 链路） */
async function openPage(doc, cursor) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => { window.initDoc(text) }, doc)
  await page.click('.cm-content')
  await page.evaluate((offset) => window.locate(offset), cursor)
  return { page, errors }
}

async function check(errors, label) {
  assert.deepEqual(errors, [], `${label} 页面错误`)
  passed++
  console.log(`[词级移动][PASS] ${label}`)
}

try {
  // ---- 拉丁路径：CM6 group 语义已知落点（回归钉住）----
  {
    const { page, errors } = await openPage('hello world', 0)
    await page.keyboard.press('Control+ArrowRight')
    let st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, 5, `latin-right head: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+ArrowRight')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, 11, `latin-right-2 head: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+ArrowLeft')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, 6, `latin-left head: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '拉丁路径与 CM6 group 语义逐字节一致')
  }
  {
    const { page, errors } = await openPage('hello world', 0)
    await page.keyboard.press('Control+Shift+ArrowRight')
    let st = await page.evaluate(() => window.readEditor())
    assert.equal(st.from, 0, `latin-shift from: ${JSON.stringify(st)}`)
    assert.equal(st.to, 5, `latin-shift to: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+Shift+ArrowRight')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.to, 11, `latin-shift-2 to: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '拉丁 Shift 变体扩选与原生一致')
  }

  // ---- 中文路径：builtin Intl.Segmenter，边界动态断言 ----
  {
    const { page, errors } = await openPage(CJK_DOC, 0)
    const engine = await page.evaluate(() => window.activeEngine())
    assert.equal(engine, 'builtin', '默认引擎应为 builtin')
    const boundaries = await page.evaluate((text) => window.intlWordBoundaries(text), CJK_DOC)
    assert.ok(boundaries.length > 2, `Intl 应对连续中文给出词级边界: ${JSON.stringify(boundaries)}`)
    // 光标 0 起逐次 Ctrl+Right：每步落点 = 边界序列中下一个 > 当前位置的值
    let head = 0
    for (const boundary of boundaries.slice(1)) {
      await page.keyboard.press('Control+ArrowRight')
      const st = await page.evaluate(() => window.readEditor())
      assert.equal(st.head, boundary,
        `cjk-intl-right 步进（期望沿 ${JSON.stringify(boundaries)}）: ${JSON.stringify(st)}`)
      head = boundary
    }
    assert.equal(head, CJK_DOC.length, '最终应到段尾')
    // 反向：逐次 Ctrl+Left 沿边界回退
    for (const boundary of [...boundaries].reverse().slice(1)) {
      await page.keyboard.press('Control+ArrowLeft')
      const st = await page.evaluate(() => window.readEditor())
      assert.equal(st.head, boundary,
        `cjk-intl-left 步进（期望沿 ${JSON.stringify(boundaries)}）: ${JSON.stringify(st)}`)
    }
    await page.close()
    await check(errors, '中文逐词移动（builtin Intl，真实边界步进）')
  }
  {
    const { page, errors } = await openPage(CJK_DOC, 0)
    const boundaries = await page.evaluate((text) => window.intlWordBoundaries(text), CJK_DOC)
    await page.keyboard.press('Control+Shift+ArrowRight')
    let st = await page.evaluate(() => window.readEditor())
    assert.equal(st.from, 0, `cjk-shift from: ${JSON.stringify(st)}`)
    assert.equal(st.to, boundaries[1], `cjk-shift to: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+Shift+ArrowRight')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.from, 0, `cjk-shift-2 from: ${JSON.stringify(st)}`)
    assert.equal(st.to, boundaries[2], `cjk-shift-2 to: ${JSON.stringify(st)}`)
    // Shift+Left 回缩一个词
    await page.keyboard.press('Control+Shift+ArrowLeft')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.to, boundaries[1], `cjk-shift-back to: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '中文 Shift 逐词扩选/回缩')
  }
  {
    // 混排：cursor 3 在中文段内 → Ctrl+Right 落点 = 3 + 段内第一个 >0 边界
    const { page, errors } = await openPage(MIXED_DOC, 3)
    const segBoundaries = await page.evaluate(
      (text) => window.intlWordBoundaries(text), MIXED_DOC.slice(3, 5))
    await page.keyboard.press('Control+ArrowRight')
    const st = await page.evaluate(() => window.readEditor())
    const expected = 3 + (segBoundaries[1] ?? 2)
    assert.equal(st.head, expected,
      `mixed 中文段细化落点（段边界 ${JSON.stringify(segBoundaries)}）: ${JSON.stringify(st)}`)
    // 落点 5 右侧 'd' 拉丁域且 'def' 与 '更多' 粘连：Ctrl+Right 一步停在
    // 交界 8（#241 验收修订——不再把 'def更多' 当同一 Word 整块跳过），
    // 再一步落 '更多' 段尾 10（段内词整段）
    await page.keyboard.press('Control+ArrowRight')
    let st2 = await page.evaluate(() => window.readEditor())
    assert.equal(st2.head, 8,
      `mixed 拉丁词与 CJK 粘连停在交界: ${JSON.stringify(st2)}`)
    await page.keyboard.press('Control+ArrowRight')
    st2 = await page.evaluate(() => window.readEditor())
    assert.equal(st2.head, MIXED_DOC.length,
      `mixed 交界后再进中文段尾: ${JSON.stringify(st2)}`)
    await page.close()
    await check(errors, '中英混排：中文段细化、拉丁粘连停在交界')
  }

  // ---- jieba 注入路径：真实键盘 + 确定性词表 ----
  {
    const { page, errors } = await openPage(CJK_DOC, 0)
    await page.evaluate(() => window.setJiebaWords(['中文', '测试', '文档']))
    const engine = await page.evaluate(() => window.activeEngine())
    assert.equal(engine, 'jieba', '注入后生效引擎应为 jieba')
    for (const expected of [2, 4, 6]) {
      await page.keyboard.press('Control+ArrowRight')
      const st = await page.evaluate(() => window.readEditor())
      assert.equal(st.head, expected, `jieba 右移 →${expected}: ${JSON.stringify(st)}`)
    }
    for (const expected of [4, 2, 0]) {
      await page.keyboard.press('Control+ArrowLeft')
      const st = await page.evaluate(() => window.readEditor())
      assert.equal(st.head, expected, `jieba 左移 →${expected}: ${JSON.stringify(st)}`)
    }
    await page.evaluate(() => window.resetEngine())
    const engineAfter = await page.evaluate(() => window.activeEngine())
    assert.equal(engineAfter, 'builtin', '恢复后引擎应为 builtin')
    await page.close()
    await check(errors, 'jieba 词表注入路径（真实键盘逐词 + 引擎切换）')
  }

  // ---- 表格共存：注册表只登记带修饰键方向，裸方向键/Tab 仍走格导航与
  //      字符移动管线（tableEditing 只绑裸方向键，两管线互不拦截）----
  {
    // Tab 格导航优先不受 wordMotion 接线影响（tabIndent 同款断言形态）
    const { page, errors } = await openPage(TABLE_DOC, TABLE_DOC.indexOf('1') + 1)
    await page.keyboard.press('Tab')
    const st = await page.evaluate(() => window.readEditor())
    assert.equal(st.text, TABLE_DOC, 'Tab 不得改文本（格导航）')
    assert.equal(st.head, TABLE_DOC.indexOf('2'), `Tab 格导航跳下一格: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '表格 Tab 格导航不受词移动接线影响')
  }
  {
    // '| aaaa | b |'：cursor 3 在 'aaaa' 词中——裸 ArrowRight 逐字符
    //（非 wordMotion 管线），Ctrl+ArrowRight 词尾（wordMotion 生效）
    const { page, errors } = await openPage(TABLE_DOC, 3)
    await page.keyboard.press('ArrowRight')
    let st = await page.evaluate(() => window.readEditor())
    assert.equal(st.text, TABLE_DOC, '表格按键不得改文本')
    assert.equal(st.head, 4, `裸 ArrowRight 逐字符（不被词移动接管）: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+ArrowRight')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, 6, `格内 Ctrl+Right 词尾（格导航只绑裸键不拦截修饰键）: ${JSON.stringify(st)}`)
    await page.keyboard.press('Control+ArrowLeft')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, 2, `格内 Ctrl+Left 词首: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '表格内裸键逐字符与 Ctrl 词移动共存')
  }

  // ---- 中文标点独立边界（builtin Intl，动态断言标点两侧有界）----
  {
    const DOC = '好的，继续'
    const { page, errors } = await openPage(DOC, 0)
    const boundaries = await page.evaluate((text) => window.intlWordBoundaries(text), DOC)
    const comma = DOC.indexOf('，')
    assert.ok(boundaries.includes(comma) && boundaries.includes(comma + 1),
      `中文标点应产出独立边界: ${JSON.stringify(boundaries)}`)
    for (const boundary of boundaries.slice(1)) {
      await page.keyboard.press('Control+ArrowRight')
      const st = await page.evaluate(() => window.readEditor())
      assert.equal(st.head, boundary,
        `标点独立边界步进（沿 ${JSON.stringify(boundaries)}）: ${JSON.stringify(st)}`)
    }
    await page.close()
    await check(errors, '中文标点独立边界（builtin Intl）')
  }
} finally {
  await browser.close()
}
console.log(`[词级移动] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
