// 代码块卡片点击落点回归（2026-10-30 修复）：真实 Chromium + 生产控制器 +
// 真实鼠标事件。三类断言——
// 1. 行为（用户症状）：代码行行盒 85%（≈文字底缘）处 mousedown，anchor 应
//    落在本行而非下一行；正文对照行 95% 处同理。
// 2. 机制（根因）：块内行 |domTop − docTop − modelTop| < 1px——头部横带
//    间距改由挂载层 padding 承担后，CM6 高度记账与 DOM 行位一致。
// 3. 观感与反查：头部上缘与上一行底缘仍保持约 4px 间距、横带高度不变；
//    卡片行 hover 反查头部仍通（reveal 类挂载，复制按钮显现链路）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'codeCardClickOffset/codeCardClickOffset.js')
await build({ entryPoints: [path.join(root, 'test/browser/codeCardClickOffsetFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const CODE = Array.from({ length: 10 }, (_, i) => `const row${String(i + 1).padStart(2, '0')} = ${i};`)
const DOC = ['前言段落文字。', '', '```js', ...CODE, '```', '', '后记段落文字。'].join('\n')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initCode(text), DOC)
  await page.waitForSelector('.vsidian-code-card-line')

  const anchorAt = async (needle, f, reinit) => {
    if (reinit) {
      await page.evaluate((text) => window.initCode(text), DOC)
      await page.waitForSelector('.vsidian-code-card-line')
    }
    const geo = await page.evaluate((n) => window.lineProbe(n), needle)
    await page.mouse.move(geo.x, geo.boxTop + f * geo.boxH)
    await page.mouse.down()
    const sel = await page.evaluate(() => window.readSelection())
    await page.mouse.up()
    return sel.anchorLine
  }

  // —— 断言组 1：行为（呈现态第一击 + 编辑态，用户症状的直接钉子）——
  // 呈现态：每次 re-init 保持呈现态第一击语义（第一击即定位 anchor）
  for (const [needle, line] of [['row05', 8], ['row08', 11]]) {
    const got = await anchorAt(needle, 0.85, true)
    assert.equal(got, line, `呈现态代码行 ${needle}（L${line}）行盒 85% 处 mousedown 应落本行，实际 L${got}`)
  }
  // 编辑态：点进块后几何稳定，连续采样
  await page.evaluate((text) => window.initCode(text), DOC)
  await page.waitForSelector('.vsidian-code-card-line')
  {
    const geo = await page.evaluate(() => window.lineProbe('row01'))
    await page.mouse.move(geo.x, geo.boxTop + 0.2 * geo.boxH)
    await page.mouse.down(); await page.mouse.up()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.vsidian-code-card-edge-top')]
        .some((el) => el.textContent.includes('```')))
  }
  for (const [needle, line] of [['row05', 8], ['row08', 11]]) {
    const got = await anchorAt(needle, 0.85, false)
    assert.equal(got, line, `编辑态代码行 ${needle}（L${line}）行盒 85% 处 mousedown 应落本行，实际 L${got}`)
  }
  // 正文对照行：95% 处仍在本行（防全局性偏移回归）
  {
    const got = await anchorAt('后记段落文字', 0.95, false)
    assert.equal(got, 16, `正文行 95% 处 mousedown 应落本行 L16，实际 L${got}`)
  }

  // —— 断言组 2：机制（高度模型与 DOM 行位一致，根因钉子）——
  // 围栏行（块首行）的 lineBlock 合并了上方头部 widget 的高度（模型块起点
  // 是 widget 起点、非行 DOM 起点），属 CM6 表示法而非偏差——只对纯行块
  //（模型高 == DOM 行高）对拍；围栏行几何由断言组 1 的落点行为覆盖
  {
    // 装饰重建后的高度重测走 CM6 requestMeasure 异步——等一帧让模型落定
    await page.waitForTimeout(150)
    const report = await page.evaluate(() => window.modelReport())
    for (const row of report.rows) {
      if (row.domMinusModel === null || row.modelH !== row.domH) continue
      assert.ok(Math.abs(row.domMinusModel) < 1,
        `L${row.n}（${row.text.slice(0, 16)}）DOM 行位与 CM6 高度模型偏差应 < 1px，实际 ${row.domMinusModel}px`)
    }
  }

  // —— 断言组 3：观感与反查 ——
  {
    const look = await page.evaluate(() => {
      const header = document.querySelector('.vsidian-code-card-header')
      const prevLine = document.querySelector('.cm-line:nth-child(2)') // 块前空行 L2
      if (!header || !prevLine) return null
      const h = header.getBoundingClientRect()
      const p = prevLine.getBoundingClientRect()
      return { gapAbove: h.top - p.bottom, headerH: h.height }
    })
    assert.ok(look, '头部横带与前置行应在 DOM 中')
    assert.ok(Math.abs(look.gapAbove - 4) <= 1,
      `头部上缘与上一行底缘间距应保持约 4px（margin 观感等值迁移），实际 ${look.gapAbove}px`)
    assert.ok(look.headerH >= 30 && look.headerH <= 34,
      `头部横带高度应保持不变（约 32px），实际 ${look.headerH}px`)
  }
  {
    // hover 卡片行 → 反查头部挂 reveal 类（wrapper 化后反查链路仍通）
    const geo = await page.evaluate(() => window.lineProbe('row05'))
    await page.mouse.move(geo.x, geo.boxTop + 0.5 * geo.boxH)
    const revealed = await page.waitForFunction(() =>
      document.querySelector('.vsidian-code-card-header')?.classList
        .contains('vsidian-code-card-reveal') ?? false, { timeout: 3000 })
      .then(() => true).catch(() => false)
    assert.ok(revealed, 'hover 卡片行应经反查给头部挂 reveal 类（复制按钮显现链路）')
  }

  assert.deepEqual(errors, [], `页面不应有未处理异常: ${errors.join('; ')}`)
} finally {
  await browser.close()
}
