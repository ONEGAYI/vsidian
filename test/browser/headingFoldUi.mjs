// 使用真实鼠标回归 #414（#409 T03）标题折叠 UI：gutter 箭头（悬停显现/
// 折叠态常显/两态定位）与省略号占位的绘制层断言——悬停事件驱动显现与
// 移开消失、箭头显隐零布局位移（.cm-content 左缘不变）、点击折叠/展开、
// 折叠后隐藏区不可见而标题行与省略号可见（view.state.paint.headingFold
// 探针口径）、行号开/关两态、明暗主题抽查与双实例独立折叠态。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/headingFoldUi.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/headingFoldUiFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]', plugins: [katexFontStrip, katexMinJs] })

// 文档：T1/T2 可折叠（嵌套）；Empty 与 Blank 相邻（Empty 节仅空白）不可折叠
const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# Empty\n# Blank\n\ntail\n'
const T1 = 0
const T2 = DOC.indexOf('## T2')

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
const total = 8

async function openPage() {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<!doctype html><html><body><div id="app"></div><div id="app2"></div></body></html>')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  // 模拟宿主主题变量注入（裸测试页无 --vscode-* 变量族，fallback 恒定
  // 无法断言主题跟随；body.vscode-dark 覆盖亮色注入）
  await page.addStyleTag({ content:
    'body { --vscode-editorLineNumber-foreground: #5a5a5a; }' +
    'body.vscode-dark { --vscode-editorLineNumber-foreground: #c6c6c6; }' })
  await page.addScriptTag({ path: bundle })
  await page.setViewportSize({ width: 900, height: 700 })
  await page.evaluate((text) => { window.initDoc(text) }, DOC)
  await page.evaluate(() => document.body.style.setProperty('margin', '0'))
  return { page, errors }
}

async function check(errors, label) {
  assert.deepEqual(errors, [], `${label} 页面错误`)
  passed++
  console.log(`[标题折叠 UI][PASS] ${label}`)
}

try {
  // ---- 场景 1：悬停显现 / 移开消失 / 零布局位移 ----
  {
    const { page, errors } = await openPage()
    const before = await page.evaluate(() => window.contentBox())
    // 悬停前：未折叠箭头隐藏，探针未武装
    let probe = await page.evaluate(() => window.probe())
    assert.equal(probe.hoverArmed, false, '初始未武装')
    assert.equal(probe.foldableArrowCount, 3, '可折叠标题 T1/T2/tail 节三枚箭头（空节排除）')
    let boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.filter((b) => b.visibility === 'visible').length, 0,
      '未悬停时箭头应全部隐藏（VSCode alwaysShowFoldControls 关策略）')
    // 真实指针移动到正文文本左缘以左（行号区）→ 武装显现
    const left = await page.evaluate(() => window.contentBox().left)
    await page.mouse.move(left - 30, 120)
    probe = await page.evaluate(() => window.probe())
    assert.equal(probe.hoverArmed, true, '指针在左缘应武装')
    boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.filter((b) => b.visibility === 'visible').length, 3,
      '武装后三枚箭头全部显现')
    const during = await page.evaluate(() => window.contentBox())
    assert.equal(during.left, before.left, '悬停显隐不得推动正文列（零布局位移）')
    // 移到箭头自身区（padding 留白带内）：武装保持（箭头可达可点）
    const ab = boxes[1]
    await page.mouse.click(ab.x + ab.w / 2, ab.y + ab.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2],
      '移到箭头上武装保持，点击可折叠（留白带计入武装区）')
    await page.evaluate(() => window.locate(0))
    // 移开（正文文本区）→ 消失
    await page.mouse.move(await page.evaluate(() => window.contentBox().left) + 200, 300)
    probe = await page.evaluate(() => window.probe())
    assert.equal(probe.hoverArmed, false, '移开应解除武装')
    boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.filter((b) => b.visibility === 'visible').length, 1,
      '移开后仅折叠态常显箭头在场')
    const after = await page.evaluate(() => window.contentBox())
    assert.equal(after.left, before.left, '消失后正文列位置不变')
    await page.close()
    await check(errors, '悬停显现/移开消失、箭头可达与零布局位移')
  }

  // ---- 场景 2：真实点击箭头折叠（绘制层断言 + 光标迁移/焦点不夺） ----
  {
    const { page, errors } = await openPage()
    const left = await page.evaluate(() => window.contentBox().left)
    // 光标先落在 T2 节正文内（beta）——审查轮 F1/F2 断言面：折叠方向须把
    // 光标迁到标题行行尾，且点击不得把焦点夺给箭头按钮
    await page.evaluate((offset) => window.locate(offset), DOC.indexOf('beta'))
    // 武装后点击 T2 行箭头（文档序第二枚：T1、T2、Blank）
    await page.mouse.move(left - 30, 100)
    const boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.length, 3, '三枚箭头在场')
    assert.equal(boxes[1].tooltip, '折叠此节', '未折叠态悬停词正确')
    assert.equal(boxes[1].expanded, 'true', '未折叠态 aria-expanded=true')
    await page.mouse.click(boxes[1].x + boxes[1].w / 2, boxes[1].y + boxes[1].h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '点击箭头应折叠 T2')
    assert.equal(await page.evaluate(() => window.selHead()), T2 + 5, '光标在节内点击箭头：迁移到标题行行尾（F1）')
    assert.equal(await page.evaluate(() => {
      const active = document.activeElement
      return !(active instanceof HTMLElement && active.closest('.vsidian-fold-arrow'))
    }), true, '点击后焦点未被箭头按钮夺走（F2：Space/Enter 不再意外翻转）')
    const probe = await page.evaluate(() => window.probe())
    assert.equal(probe.foldCount, 1, '折叠区间数 1')
    assert.equal(probe.arrowCollapsed, true, '首箭头应为折叠态（常显右向）')
    assert.equal(probe.arrowVisible, true, '折叠态箭头常显（绘制层命中）')
    assert.equal(probe.ellipsisVisible, true, '省略号占位可见（绘制层命中）')
    assert.equal(probe.ellipsisText, '⋯', '省略号文字')
    assert.equal(probe.hiddenLinePainted, false, '折叠区隐藏行文本不得被绘制（beta 不可见）')
    assert.equal(await page.evaluate(() => window.headingVisible('T2')), true, '标题行保持可见')
    assert.equal(await page.evaluate(() => window.editRequestCount()), 0, '折叠零写回')
    await page.close()
    await check(errors, '点击箭头折叠：隐藏区不可见/标题与省略号可见/常显箭头/光标迁移/焦点不夺')
  }

  // ---- 场景 3：点击省略号展开 + 滚动无错乱 ----
  {
    const { page, errors } = await openPage()
    const left = await page.evaluate(() => window.contentBox().left)
    await page.evaluate(() => window.locate(0))
    await page.mouse.move(left - 30, 100)
    let boxes = await page.evaluate(() => window.arrowBoxes())
    const t2Box = boxes[1]
    await page.mouse.click(t2Box.x + t2Box.w / 2, t2Box.y + t2Box.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '场景 3 前置：点击箭头折叠 T2')
    const scrollTop = await page.evaluate(() => window.contentBox().scrollTop)
    const ellipsis = await page.evaluate(() => window.ellipsisBox())
    assert.ok(ellipsis && ellipsis.w > 0, '省略号占位有面积')
    await page.mouse.click(ellipsis.x + ellipsis.w / 2, ellipsis.y + ellipsis.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], '点击省略号应展开')
    const probe = await page.evaluate(() => window.probe())
    assert.equal(probe.foldCount, 0, '展开后无折叠区间')
    assert.equal(await page.evaluate(() => window.headingVisible('T2')), true, '标题行可见')
    assert.equal(await page.evaluate(() => window.headingVisible('beta') === false, true), true)
    // 隐藏区文本恢复：beta 所在行经 view 定位后 elementFromPoint 命中
    await page.evaluate((offset) => window.locate(offset), DOC.indexOf('beta'))
    await page.waitForTimeout(50)
    assert.equal(await page.evaluate(() => {
      const el = document.querySelector('.cm-line')
      return el !== null && document.elementFromPoint(
        el.getBoundingClientRect().x + 40, el.getBoundingClientRect().y + 4) !== null
    }), true, '展开后正文可命中')
    assert.equal(await page.evaluate(() => window.contentBox().scrollTop), scrollTop,
      '展开后滚动位置无错乱（视口内折叠不触发滚动）')
    await page.close()
    await check(errors, '点击省略号展开与滚动无错乱')
  }

  // ---- 场景 4：点击折叠态箭头展开（常显，无需悬停武装） ----
  {
    const { page, errors } = await openPage()
    const left = await page.evaluate(() => window.contentBox().left)
    await page.evaluate(() => window.locate(0))
    await page.mouse.move(left - 30, 100)
    let boxes = await page.evaluate(() => window.arrowBoxes())
    await page.mouse.click(boxes[1].x + boxes[1].w / 2, boxes[1].y + boxes[1].h / 2)
    // 移开左缘（解除武装）后折叠态箭头仍常显可点
    await page.mouse.move(left + 200, 300)
    let probe = await page.evaluate(() => window.probe())
    assert.equal(probe.hoverArmed, false, '已解除武装')
    assert.equal(probe.arrowVisible, true, '折叠态箭头常显（不依赖悬停）')
    boxes = await page.evaluate(() => window.arrowBoxes())
    const collapsed = boxes.find((b) => b.collapsed)
    assert.ok(collapsed, '折叠态箭头在场')
    assert.equal(collapsed.tooltip, '展开此节', '折叠态悬停词为展开')
    assert.equal(collapsed.expanded, 'false', '折叠态 aria-expanded=false')
    await page.mouse.click(collapsed.x + collapsed.w / 2, collapsed.y + collapsed.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], '点击常显箭头应展开')
    await page.close()
    await check(errors, '点击折叠态箭头展开（常显不依赖悬停）')
  }

  // ---- 场景 5：行号开/关两态箭头定位正确 ----
  {
    const { page, errors } = await openPage()
    // 箭头以 right:100% 伸入行号列与正文间的 ln-gap 间距区：不遮行号
    // 数字、不侵入正文列（两态同判）
    await page.evaluate(() => window.setSettings({ 'editor.lineNumbers': true }))
    await page.evaluate(() => window.locate(0))
    const left = await page.evaluate(() => window.contentBox().left)
    await page.mouse.move(left - 30, 100)
    let boxes = await page.evaluate(() => window.arrowBoxes())
    let lnRight = await page.evaluate(() => window.lineNumberColumnRight())
    assert.ok(lnRight !== null, '行号列在场')
    for (const b of boxes) {
      assert.ok(b.x >= lnRight - 0.5, `箭头不得遮行号（x=${b.x} ≥ 列右缘 ${lnRight}）`)
      assert.ok(b.x + b.w <= left + 0.5, `箭头不得侵入正文列（右缘 ${b.x + b.w} ≤ 正文左缘 ${left}）`)
    }
    // 行号关：列卸载、正文回基线，箭头仍呈现且仍在正文左侧留白带
    const leftWithLn = left
    await page.evaluate(() => window.setSettings({ 'editor.lineNumbers': false }))
    await page.waitForTimeout(80)
    lnRight = await page.evaluate(() => window.lineNumberColumnRight())
    assert.equal(lnRight, null, '行号列已卸载')
    const leftNoLn = await page.evaluate(() => window.contentBox().left)
    assert.ok(leftNoLn < leftWithLn, '行号关闭后正文左缘左移（回 padding 基线）')
    // 行号关态左缘更贴视口边（x≈24）：move 目标留在视口内（箭头带 [8,24] 区）
    await page.mouse.move(Math.max(2, leftNoLn - 10), 100)
    boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.filter((b) => b.visibility === 'visible').length, 3, '行号关态箭头仍呈现')
    for (const b of boxes) {
      assert.ok(b.x >= 0, '箭头在编辑器内')
      assert.ok(b.x + b.w <= leftNoLn + 0.5, `行号关态箭头不得侵入正文列（右缘 ${b.x + b.w} ≤ ${leftNoLn}）`)
    }
    // 点击仍可用（行号关态折叠）
    await page.mouse.click(boxes[0].x + boxes[0].w / 2, boxes[0].y + boxes[0].h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T1], '行号关态点击箭头可折叠')
    await page.close()
    await check(errors, '行号开/关两态箭头定位与可用')
  }

  // ---- 场景 6：明暗主题抽查（箭头颜色随主题） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate(() => window.locate(0))
    const left = await page.evaluate(() => window.contentBox().left)
    await page.mouse.move(left - 30, 100)
    // 折叠一枚让常显箭头在场，随主题读计算色
    let boxes = await page.evaluate(() => window.arrowBoxes())
    await page.mouse.click(boxes[1].x + boxes[1].w / 2, boxes[1].y + boxes[1].h / 2)
    await page.mouse.move(left + 200, 300)
    await page.evaluate(() => window.setBodyDark(false))
    await page.waitForTimeout(80)
    const lightColor = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.vsidian-fold-arrow')).color)
    await page.evaluate(() => window.setBodyDark(true))
    await page.waitForTimeout(80)
    const darkColor = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.vsidian-fold-arrow')).color)
    assert.notEqual(lightColor, darkColor, '箭头计算色应随明暗主题变化')
    const probe = await page.evaluate(() => window.probe())
    assert.equal(probe.arrowVisible, true, '暗色主题下常显箭头仍可见')
    await page.evaluate(() => window.setBodyDark(false))
    await page.close()
    await check(errors, '明暗主题抽查（箭头颜色跟随）')
  }

  // ---- 场景 7：双实例独立折叠态（嵌入/悬停卡内 Live 的机制面） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((text) => { window.initDoc2(text) }, DOC)
    await page.evaluate(() => window.locate(0))
    const left = await page.evaluate(() => window.contentBox().left)
    await page.mouse.move(left - 30, 100)
    const boxes = await page.evaluate(() => window.arrowBoxes())
    await page.mouse.click(boxes[1].x + boxes[1].w / 2, boxes[1].y + boxes[1].h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '主实例折叠 T2')
    assert.deepEqual(await page.evaluate(() => window.foldKeys2()), [], '第二实例折叠态独立（不受主实例影响）')
    // 第二实例同样呈现箭头（同一 liveInstance 扩展装配）
    const count2 = await page.evaluate(() =>
      document.querySelectorAll('#app2 .vsidian-fold-gutter .vsidian-fold-arrow').length)
    assert.equal(count2, 3, '第二实例同样呈现三枚箭头')
    await page.close()
    await check(errors, '双实例独立折叠态与同装配呈现')
  }

  // ---- 场景 8：空节/纯空白节不显示箭头（可折叠判定驱动） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate(() => window.locate(0))
    const probe = await page.evaluate(() => window.probe())
    // T1（含 alpha+T2）、T2（含 beta）、Blank（含 tail）三枚；Empty 节仅
    // 一个换行——不可折叠，无箭头
    assert.equal(probe.foldableArrowCount, 3, '空节 Empty 不产生箭头')
    const boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.length, 3, 'DOM 箭头数与判定一致')
    // 折叠全部（键位族走 T02 已回归，此处箭头断言为目标）
    await page.close()
    await check(errors, '空节/纯空白节不显示箭头')
  }
} finally {
  await browser.close()
}
console.log(`[标题折叠 UI] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
