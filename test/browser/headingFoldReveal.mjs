// 使用浏览器原生键盘与宿主消息通道回归 #415（#409 T04）：落点展开
// （reveal 族统一机制）——任何把选区/滚动定位到折叠隐藏区内的链路先
// 展开（嵌套全展开，effect 直驱）再定位。六个场景：
// 1. view.locate 落点在嵌套折叠隐藏区 → 全展开并定位（锚点跳转/搜索
//    结果/双链/链接跳转/大纲点击的共同汇聚实现 locateOffset 的端到端）；
// 2. view.locate 落点在可见区 → 折叠保持（不误展开）；
// 3. 查找面板真实键盘（Ctrl+F 输入）命中折叠区 → 自动展开并选区落位；
// 4. 双模式往返折叠存续（实例内存驻留，StateField 不销毁）；
// 5. modeAnchor 落隐藏区（阅读期间定位）→ 回切 Live 走落点展开；
// 6. 落点仅在外层隐藏区 → 只展开外层，无关折叠保持；
// 全程零写回（无出站 edit.request）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/headingFoldReveal.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/headingFoldRevealFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// 跨级辖域：T2（##）是 T1（#）的子节；T3（#）与 T1 同级截断
const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n'
const T1 = 0
const T2 = DOC.indexOf('## T2')
const T3 = DOC.indexOf('# T3')
const ALPHA = DOC.indexOf('alpha')
const BETA = DOC.indexOf('beta')
const GAMMA = DOC.indexOf('gamma')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 6

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
  console.log(`[标题折叠落点展开][PASS] ${label}`)
}

try {
  // ---- 场景 1：view.locate 落点在嵌套折叠隐藏区 → 全展开并定位 ----
  {
    const { page, errors } = await openPage(DOC, BETA)
    await page.keyboard.press('Control+Shift+BracketLeft') // 折 T2
    await page.keyboard.press('Control+Shift+BracketLeft') // 外扩折 T1
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1, T2], '前置：T1+T2 嵌套折叠')
    // view.locate（锚点跳转/搜索结果/双链/链接跳转/大纲点击共用通道）进折叠区
    await page.evaluate((offset) => window.locate(offset), BETA)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [],
      '落点同时在 T1 与 T2 隐藏区 → 嵌套全展开')
    const st = await page.evaluate(() => window.readEditor())
    assert.equal(st.from, BETA, `定位选区应落在 beta: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, 'view.locate 落点展开（嵌套全展开 + 定位落位）')
  }

  // ---- 场景 2：view.locate 落点在可见区 → 折叠保持（不误展开） ----
  {
    const { page, errors } = await openPage(DOC, BETA)
    await page.keyboard.press('Control+Shift+BracketLeft')
    await page.keyboard.press('Control+Shift+BracketLeft')
    // gamma 在未折叠的 T3 节内：T1+T2 折叠原样保持
    await page.evaluate((offset) => window.locate(offset), GAMMA)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1, T2],
      '可见落点不得误展开折叠')
    await page.close()
    await check(errors, 'view.locate 可见落点折叠保持')
  }

  // ---- 场景 3：查找命中折叠区自动展开（真实键盘 Ctrl+F 输入） ----
  {
    const { page, errors } = await openPage(DOC, GAMMA)
    await page.evaluate((offset) => window.locate(offset), BETA)
    await page.keyboard.press('Control+Shift+BracketLeft') // 折 T2（beta 落隐藏区）
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '前置：T2 折叠')
    await page.keyboard.press('Control+f') // 打开查找面板（注册表默认键位）
    await page.keyboard.type('beta') // 输入即定位：命中落在折叠隐藏区
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [],
      '查找命中折叠区 → 该节自动展开')
    const st = await page.evaluate(() => window.readEditor())
    assert.equal(st.from, BETA, `查找定位选区应落在 beta 匹配: ${JSON.stringify(st)}`)
    assert.equal(st.to, BETA + 4, `查找选区应覆盖匹配区间: ${JSON.stringify(st)}`)
    await page.close()
    await check(errors, '查找命中折叠区自动展开定位（真实键盘）')
  }

  // ---- 场景 4：双模式往返折叠存续（实例内存驻留） ----
  {
    const { page, errors } = await openPage(DOC, BETA)
    await page.keyboard.press('Control+Shift+BracketLeft') // 折 T2
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '前置：T2 折叠')
    await page.evaluate(() => window.setMode('reading'))
    await page.waitForSelector('.vsidian-reading-block', { timeout: 5000 })
    // 阅读看全文（折叠不带入阅读呈现）；折叠态不因模式切换丢失
    await page.evaluate(() => window.setMode('live'))
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2],
      'Live 折叠 → 阅读 → Live：折叠原样（StateField 驻留）')
    await page.close()
    await check(errors, '双模式往返折叠存续')
  }

  // ---- 场景 5：modeAnchor 落隐藏区 → 回切 Live 走落点展开 + 全程零写回 ----
  {
    const { page, errors } = await openPage(DOC, BETA)
    const editsBefore = await page.evaluate(() => window.editRequestCount())
    await page.keyboard.press('Control+Shift+BracketLeft')
    await page.keyboard.press('Control+Shift+BracketLeft') // T1+T2 折叠
    await page.evaluate(() => window.setMode('reading'))
    await page.waitForSelector('.vsidian-reading-block', { timeout: 5000 })
    // 阅读定位到 beta（阅读分支不展开折叠——阅读无折叠呈现）：modeAnchor
    // 落到折叠隐藏区内的源位置
    await page.evaluate((offset) => window.locate(offset), BETA)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1, T2],
      '阅读模式定位不得展开折叠（阅读不开放折叠）')
    await page.evaluate(() => window.setMode('live'))
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [],
      'modeAnchor 落隐藏区 → 回切 Live 落点展开（嵌套全展开）')
    const st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, BETA, `回切光标应落在 beta: ${JSON.stringify(st)}`)
    // 折叠与落点展开全程零写回
    assert.equal(await page.evaluate(() => window.editRequestCount()), editsBefore,
      '落点展开与模式往返不得产生出站编辑消息')
    await page.close()
    await check(errors, 'modeAnchor 落隐藏区回切展开 + 零写回')
  }

  // ---- 场景 6：落点仅在外层隐藏区（内层子节外）→ 只展开外层，无关折叠保持 ----
  {
    const { page, errors } = await openPage(DOC, GAMMA)
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+0') // 全部折叠 T1+T2+T3
    await page.evaluate((offset) => window.locate(offset), ALPHA)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2, T3],
      '落点仅在外层隐藏区 → 只展开外层 T1，无关折叠保持')
    await page.close()
    await check(errors, '外层展开与无关折叠保持')
  }
} finally {
  await browser.close()
}
console.log(`[标题折叠落点展开] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
