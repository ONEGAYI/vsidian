// 跳转目标高亮原生浏览器回归（#163 验收反馈）：view.locate（双链/普通
// 链接锚点跳转通道）后目标标题/段落整体覆盖半透黄——绘制层断言
// （computed background 真实非透明）、整块覆盖（多行段落逐行）、消失
// 交互（真实滚轮滚动后清除；定位自身的程序滚动不误清）与阅读侧块级
// 高亮。真实 wheel 事件驱动消失监听。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'anchorFlash/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/anchorFlashFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)

const DOC = '前置段落\n\n# 目标标题\n\n目标段落甲\n目标段落乙\n\n后文段落\n'

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`${islandHtml}<div id="app"></div>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initAnchorFlash(text), DOC)
  await page.locator('.cm-line').first().waitFor()
  await page.waitForTimeout(120)

  // ---- 场景 A：定位到多行段落 → 整块逐行半透黄（绘制层） ----
  await page.evaluate(() => window.post({ kind: 'view.locate', offset: 0 })) // 先定位前置（暖身 ack 通道）
  await page.evaluate((offset) => window.post({ kind: 'view.locate', offset }), DOC.indexOf('目标段落甲'))
  await page.waitForTimeout(60)
  let paint = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(paint.liveCount, 2, `多行段落应整块高亮（实际 ${paint.liveCount} 行）`)
  assert.ok(paint.liveTexts.some((t) => t.includes('目标段落甲')), '首行覆盖')
  assert.ok(paint.liveTexts.some((t) => t.includes('目标段落乙')), '末行覆盖')
  assert.ok(paint.liveBackground && paint.liveBackground !== 'rgba(0, 0, 0, 0)',
    `高亮行背景应真实绘制（实际 ${paint.liveBackground}）`)
  const ack = await page.evaluate(() => window.sent().findLast((m) => m.kind === 'view.locate.ack'))
  assert.equal(ack?.offset, DOC.indexOf('目标段落甲'), '定位送达确认照常回发')
  passed++
  console.log('[跳转高亮回归][PASS] live 整块半透黄绘制 + ack 通道')

  // ---- 场景 B：真实滚轮滚动 → 高亮消失（程序滚动时间窗已过） ----
  await page.waitForTimeout(400) // 越过定位滚动时间窗（300ms）
  await page.mouse.move(450, 260)
  await page.mouse.wheel(0, 120)
  await page.waitForTimeout(80)
  paint = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(paint.liveCount, 0, `用户滚动后高亮应消失（实际 ${paint.liveCount} 行）`)
  passed++
  console.log('[跳转高亮回归][PASS] 真实滚轮滚动后消失')

  // ---- 场景 C：定位到标题 → 标题行整行高亮；CSS 变量接口可覆盖 ----
  await page.evaluate((offset) => window.post({ kind: 'view.locate', offset }), DOC.indexOf('# 目标标题'))
  await page.waitForTimeout(60)
  paint = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(paint.liveCount, 1, '标题行单行高亮')
  assert.ok(paint.liveTexts[0]?.includes('目标标题'), '标题行覆盖')
  // 变量接口：用户覆盖 --vsidian-anchor-flash-background 后背景跟随
  await page.addStyleTag({ content: '#app { --vsidian-anchor-flash-background: rgba(1, 2, 3, 0.5); }' })
  const repainted = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(repainted.liveBackground, 'rgba(1, 2, 3, 0.5)',
    `背景应经变量暴露可覆盖（实际 ${repainted.liveBackground}）`)
  passed++
  console.log('[跳转高亮回归][PASS] 标题整行 + CSS 变量接口可覆盖')

  // ---- 场景 D：阅读侧块级高亮 + 点击阅读区消失 ----
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'reading' }))
  await page.waitForTimeout(120)
  await page.evaluate((offset) => window.post({ kind: 'view.locate', offset }), DOC.indexOf('目标段落甲'))
  await page.waitForTimeout(80)
  paint = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(paint.readingCount, 1, `阅读目标段落块应有高亮（实际 ${paint.readingCount}）`)
  assert.ok(paint.readingTexts[0]?.includes('目标段落甲'), '阅读目标块覆盖')
  assert.ok(paint.readingBackground && paint.readingBackground !== 'rgba(0, 0, 0, 0)',
    `阅读高亮背景应真实绘制（实际 ${paint.readingBackground}）`)
  await page.locator('.vsidian-reading-paragraph').first().click()
  await page.waitForTimeout(60)
  paint = await page.evaluate(() => window.readAnchorFlash())
  assert.equal(paint.readingCount, 0, '点击阅读区后高亮应消失')
  passed++
  console.log('[跳转高亮回归][PASS] 阅读块级高亮 + 点击消失')

  assert.deepEqual(errors, [], '页面无未捕获异常')
} finally {
  await browser.close()
}
console.log(`[跳转高亮回归] 全部通过：${passed} 场景`)
