// 使用浏览器原生键盘回归 #413（#409 T02）标题折叠五操作：注册表默认键位
// 真实路由——美式布局 Ctrl+Shift+[ / ]（事件字符 { }，端到端验证 keyStep
// shift 上档符号映射）、Ctrl+K Ctrl+L / 0 / J 两段弦。断言操作命中
// （headingFoldField 键集）、光标迁移、文档零写回（无出站 edit.request）
// 与阅读模式不接管。折叠内容的绘制层可见性断言留给 #414（T03 paint 探针）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/headingFoldKeys.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/headingFoldKeysFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// 跨级辖域：T2（##）是 T1（#）的子节；T3（#）与 T1 同级截断
const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n'
const T1 = 0
const T2 = DOC.indexOf('## T2')
const T3 = DOC.indexOf('# T3')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 5

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
  console.log(`[标题折叠键位][PASS] ${label}`)
}

try {
  // ---- 场景 1：美式布局 Ctrl+Shift+[（事件字符 `{`）折叠辖域 + 再按外扩 ----
  {
    const { page, errors } = await openPage(DOC, DOC.indexOf('beta'))
    await page.keyboard.press('Control+Shift+BracketLeft')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2],
      'Ctrl+Shift+[ 应折叠辖域 T2')
    // 光标迁移：beta 在 T2 隐藏区 → 迁到 T2 标题行行尾
    let st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, T2 + 5, `折叠后光标应迁到 T2 标题行行尾: ${JSON.stringify(st)}`)
    // 再按：T2 已折叠 → 上溯外扩折 T1（嵌套独立性：T2 折叠保持）
    await page.keyboard.press('Control+Shift+BracketLeft')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1, T2],
      '已折叠时再按 Ctrl+Shift+[ 应外扩折 T1')
    st = await page.evaluate(() => window.readEditor())
    assert.equal(st.head, T1 + 4, `外扩折叠后光标应迁到 T1 标题行行尾: ${JSON.stringify(st)}`)
    // 文档零写回
    assert.equal(st.text, DOC, '折叠不得改文档')
    await page.close()
    await check(errors, 'Ctrl+Shift+[ 折叠辖域与逐层外扩（shift 上档符号路由）')
  }

  // ---- 场景 2：Ctrl+Shift+]（事件字符 `}`）展开辖域 ----
  {
    const { page, errors } = await openPage(DOC, DOC.indexOf('beta'))
    await page.keyboard.press('Control+Shift+BracketLeft')
    await page.keyboard.press('Control+Shift+BracketLeft')
    // 光标已迁到 T1 标题行 → 辖域 T1 已折叠 → 展 T1（内层 T2 保持）
    await page.keyboard.press('Control+Shift+BracketRight')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2],
      'Ctrl+Shift+] 应展开辖域 T1（内层 T2 折叠保持）')
    await page.close()
    await check(errors, 'Ctrl+Shift+] 展开辖域（嵌套内层保持）')
  }

  // ---- 场景 3：Ctrl+K Ctrl+L 两段弦切换 ----
  {
    const { page, errors } = await openPage(DOC, DOC.indexOf('beta'))
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+l')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], 'Ctrl+K Ctrl+L 应切换折 T2')
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+l')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], '再按 Ctrl+K Ctrl+L 应切换展开')
    await page.close()
    await check(errors, 'Ctrl+K Ctrl+L 弦两态切换')
  }

  // ---- 场景 4：Ctrl+K Ctrl+0 全部折叠 / Ctrl+K Ctrl+J 全部展开 ----
  {
    const { page, errors } = await openPage(DOC, DOC.indexOf('beta'))
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+0')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1, T2, T3],
      'Ctrl+K Ctrl+0 应折叠全部可折叠标题')
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+j')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], 'Ctrl+K Ctrl+J 应清空折叠集')
    await page.close()
    await check(errors, 'Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J 全量折叠/展开')
  }

  // ---- 场景 5：零写回 + 阅读模式不接管 ----
  {
    const { page, errors } = await openPage(DOC, DOC.indexOf('beta'))
    await page.keyboard.press('Control+Shift+BracketLeft')
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+0')
    await page.keyboard.press('Control+k')
    await page.keyboard.press('Control+j')
    assert.equal(await page.evaluate(() => window.editRequestCount()), 0,
      '折叠操作全程不得产生出站编辑消息（零写回零 dirty）')
    // 切阅读：Live-only 操作不接管（键位冒泡宿主），再切回折叠键位恢复
    // 可用（此刻光标在外扩折叠迁移时落 T1 标题行——辖域 = T1）
    await page.evaluate(() => window.setMode('reading'))
    await page.keyboard.press('Control+Shift+BracketLeft')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [],
      '阅读模式按键不得触发折叠（Live-only 生效模式）')
    await page.evaluate(() => window.setMode('live'))
    await page.keyboard.press('Control+Shift+BracketLeft')
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1],
      '切回 Live 后折叠键位恢复可用（辖域 T1）')
    await page.close()
    await check(errors, '零写回与阅读模式不接管（跨模式实例驻留）')
  }
} finally {
  await browser.close()
}
console.log(`[标题折叠键位] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
