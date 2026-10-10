// 使用真实鼠标回归 #419 阅读模式标题折叠（翻案 #416 定案 1）：阅读视图
// 消费 Live 折叠状态集——Live 折叠切阅读仍折叠、阅读态折叠/展开切回 Live
// 同步呈现（双向同步），标题 hover 显现箭头（点击折叠）、折叠态常显 +
// 省略号占位（点击展开），隐藏内容不可见（readingFold 探针绘制层断言：
// hiddenTextInDom / hiddenLinePainted / ellipsisVisible / arrowVisible），
// 全程零写回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = path.join(root, 'out/test/browser/headingFoldReading.js')
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
await build({ entryPoints: [path.join(root, 'test/browser/headingFoldReadingFixture.ts')],
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
const total = 7

async function openPage() {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.setViewportSize({ width: 900, height: 700 })
  await page.evaluate((text) => { window.initDoc(text) }, DOC)
  await page.evaluate(() => document.body.style.setProperty('margin', '0'))
  return { page, errors }
}

async function check(errors, label) {
  assert.deepEqual(errors, [], `${label} 页面错误`)
  passed++
  console.log(`[阅读折叠][PASS] ${label}`)
}

/** 等待两个 rAF：覆盖阅读窗口重算与 RO 节拍 */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))
  }))
}

/** 在 Live 态折叠 T2（gutter 箭头真实点击，同 #414 套件路径） */
async function foldT2InLive(page) {
  await page.evaluate(() => window.setMode('live'))
  const left = await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    return el ? el.getBoundingClientRect().left : 0
  })
  await page.mouse.move(left - 30, 100)
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('.vsidian-fold-gutter .vsidian-fold-arrow')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
      }))
  const t2Box = boxes[1] // 文档序第二枚（T1/T2/T3 三节均可折叠）
  await page.mouse.click(t2Box.x + t2Box.w / 2, t2Box.y + t2Box.h / 2)
}

try {
  // ---- 场景 1：Live 折叠 → 切阅读：隐藏内容不可见、标题与省略号可见 ----
  {
    const { page, errors } = await openPage()
    await foldT2InLive(page)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '前置：Live 折叠 T2')
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    const probe = await page.evaluate(() => window.readingProbe())
    assert.equal(probe.foldCount, 1, '阅读态消费同一折叠集：折叠区间数 1')
    assert.equal(probe.hiddenTextInDom, false, '被折叠正文块不得在阅读容器 DOM')
    assert.equal(probe.hiddenLinePainted, false, '被折叠正文不得被绘制（elementFromPoint 口径）')
    assert.equal(probe.ellipsisVisible, true, '折叠标题行尾省略号可见（绘制层命中）')
    assert.equal(probe.ellipsisText, '⋯', '省略号文字')
    assert.equal(probe.arrowVisible, true, '折叠态箭头常显（绘制层命中）')
    assert.equal(probe.arrowCollapsed, true, '首折叠标题箭头为折叠态')
    assert.equal(probe.foldableArrowCount, 3, '可折叠标题箭头计数（三节）')
    assert.equal(await page.evaluate((s) => window.headingVisibleByStart(s), T2), true, '折叠标题块保持可见')
    const text = await page.evaluate(() => window.readingText())
    assert.equal(text.includes('beta'), false, 'beta 不得在阅读文本')
    assert.equal(text.includes('gamma'), true, 'T3 节区外内容保持可见')
    await page.close()
    await check(errors, 'Live 折叠切阅读：隐藏不可见/标题省略号可见')
  }

  // ---- 场景 2：阅读态悬停显现箭头 → 真实点击折叠 ----
  {
    const { page, errors } = await openPage()
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    // 未折叠：默认隐藏，悬停标题块显现
    let boxes = await page.evaluate(() => window.arrowBoxes())
    assert.equal(boxes.length, 3, '三枚箭头在场')
    assert.equal(boxes.every((b) => b.visibility === 'hidden'), true, '未悬停全部隐藏')
    const t2Heading = await page.evaluate((s) => {
      const el = document.querySelector(`.vsidian-view-reading .vsidian-reading-block[data-vsidian-src-start="${s}"]`)
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    }, T2)
    await page.mouse.move(t2Heading.x + t2Heading.w / 2, t2Heading.y + t2Heading.h / 2)
    boxes = await page.evaluate(() => window.arrowBoxes())
    const t2Arrow = boxes.find((b) => b.srcStart === String(T2))
    assert.equal(t2Arrow.visibility, 'visible', '悬停标题显现箭头')
    assert.equal(t2Arrow.tooltip, '折叠此节', '未折叠态悬停词')
    // 箭头在正文列左缘之左（留白带内，零侵入）
    const contentLeft = await page.evaluate(() => window.readingContentLeft())
    assert.ok(t2Arrow.x + t2Arrow.w <= contentLeft + 0.5, '箭头不得侵入正文列')
    // 命中桥回归（评审 B1）：从标题左缘内侧以 ~1.2px/步连续移向箭头中心，
    // 路径必穿过箭头盒右缘 4px margin 视觉间隙——无桥时块在此失 :hover、
    // 箭头回 hidden（不可再命中），慢速移动永远点不到；桥在场则全程可命中
    await page.mouse.move(t2Heading.x + 2, t2Arrow.y + t2Arrow.h / 2)
    await page.mouse.move(t2Arrow.x + t2Arrow.w / 2, t2Arrow.y + t2Arrow.h / 2, { steps: 12 })
    boxes = await page.evaluate(() => window.arrowBoxes())
    const armedAcrossGap = boxes.find((b) => b.srcStart === String(T2))
    assert.equal(armedAcrossGap.visibility, 'visible', '连续移动穿越间隙后箭头仍可见（命中桥）')
    await page.mouse.click(t2Arrow.x + t2Arrow.w / 2, t2Arrow.y + t2Arrow.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '点击箭头翻转 Live StateField（共享状态集）')
    await settle(page)
    const probe = await page.evaluate(() => window.readingProbe())
    assert.equal(probe.foldCount, 1, '阅读态即时折叠呈现')
    assert.equal(probe.hiddenTextInDom, false, 'beta 块移出可见序列')
    // 移开鼠标：折叠态箭头仍常显
    await page.mouse.move(60, 400)
    boxes = await page.evaluate(() => window.arrowBoxes())
    const collapsed = boxes.find((b) => b.collapsed)
    assert.ok(collapsed, '折叠态箭头在场')
    assert.equal(collapsed.visibility, 'visible', '折叠态箭头常显（不依赖悬停）')
    assert.equal(collapsed.tooltip, '展开此节', '折叠态悬停词为展开')
    await page.close()
    await check(errors, '阅读态悬停显现箭头与点击折叠')
  }

  // ---- 场景 3：阅读态点击省略号展开 ----
  {
    const { page, errors } = await openPage()
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    let boxes = await page.evaluate(() => window.arrowBoxes())
    const t2Arrow = boxes.find((b) => b.srcStart === String(T2))
    // 悬停标题显现后点击折叠
    const t2Heading = await page.evaluate((s) => {
      const el = document.querySelector(`.vsidian-view-reading .vsidian-reading-block[data-vsidian-src-start="${s}"]`)
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    }, T2)
    await page.mouse.move(t2Heading.x + t2Heading.w / 2, t2Heading.y + t2Heading.h / 2)
    boxes = await page.evaluate(() => window.arrowBoxes())
    const armed = boxes.find((b) => b.srcStart === String(T2))
    await page.mouse.click(armed.x + armed.w / 2, armed.y + armed.h / 2)
    await settle(page)
    const ellipsis = await page.evaluate(() => window.ellipsisBox())
    assert.ok(ellipsis && ellipsis.w > 0, '省略号占位有面积')
    await page.mouse.click(ellipsis.x + ellipsis.w / 2, ellipsis.y + ellipsis.h / 2)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [], '点击省略号展开')
    await settle(page)
    const text = await page.evaluate(() => window.readingText())
    assert.equal(text.includes('beta'), true, '展开后 beta 回到阅读文本')
    await page.close()
    await check(errors, '阅读态点击省略号展开')
  }

  // ---- 场景 4：双向同步（阅读折叠 → Live 呈现 → Live 展开 → 阅读恢复） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    // 阅读态折叠 T2（悬停显现后点击）
    const t2Heading = await page.evaluate((s) => {
      const el = document.querySelector(`.vsidian-view-reading .vsidian-reading-block[data-vsidian-src-start="${s}"]`)
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    }, T2)
    await page.mouse.move(t2Heading.x + t2Heading.w / 2, t2Heading.y + t2Heading.h / 2)
    let boxes = await page.evaluate(() => window.arrowBoxes())
    const armed = boxes.find((b) => b.srcStart === String(T2))
    await page.mouse.click(armed.x + armed.w / 2, armed.y + armed.h / 2)
    await settle(page)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '阅读态折叠 T2')
    // 切回 Live：折叠同步呈现（#414 headingFold 探针）
    await page.evaluate(() => window.setMode('live'))
    await settle(page)
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '切回 Live 折叠键存续')
    // 切回 Live：折叠同步呈现（beta 行不可见——无 DOM、rect 退化或命中
    // 失败均算隐藏）
    const betaHiddenInLive = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('.cm-line')]
      const line = lines.find((el) => (el.textContent ?? '').includes('beta'))
      if (!line) return true // 折叠后无 DOM = 隐藏
      const rect = line.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return true
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return !(!!hit && (hit === line || line.contains(hit)))
    })
    assert.equal(betaHiddenInLive, true, 'Live 态呈现折叠（beta 行不可见）')
    // Live 态点省略号展开 → 切阅读恢复全文
    const ellipsisLive = await page.evaluate(() => {
      const el = document.querySelector('.cm-content .vsidian-fold-ellipsis')
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    })
    assert.ok(ellipsisLive, 'Live 态省略号在场')
    await page.mouse.click(ellipsisLive.x + ellipsisLive.w / 2, ellipsisLive.y + ellipsisLive.h / 2)
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    const probe = await page.evaluate(() => window.readingProbe())
    assert.equal(probe.foldCount, 0, 'Live 展开后阅读恢复全文')
    const text = await page.evaluate(() => window.readingText())
    assert.equal(text.includes('beta'), true, 'beta 回到阅读文本')
    await page.close()
    await check(errors, '双向同步：阅读折叠→Live 呈现→Live 展开→阅读恢复')
  }

  // ---- 场景 5：折叠态切回 Live 再切阅读：折叠保持（状态共享的存续面） ----
  {
    const { page, errors } = await openPage()
    await foldT2InLive(page)
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    await page.evaluate(() => window.setMode('live'))
    await settle(page)
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    const probe = await page.evaluate(() => window.readingProbe())
    assert.equal(probe.foldCount, 1, '多次往返后阅读仍消费同一折叠集')
    assert.equal(await page.evaluate((s) => window.headingVisibleByStart(s), T3), true, 'T3 标题块可见')
    await page.close()
    await check(errors, '模式多次往返折叠保持')
  }

  // ---- 场景 6：全程零写回 ----
  {
    const { page, errors } = await openPage()
    await foldT2InLive(page)
    await page.evaluate(() => window.setMode('reading'))
    await settle(page)
    const t1Heading = await page.evaluate((s) => {
      const el = document.querySelector(`.vsidian-view-reading .vsidian-reading-block[data-vsidian-src-start="${s}"]`)
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    }, T1)
    await page.mouse.move(t1Heading.x + t1Heading.w / 2, t1Heading.y + t1Heading.h / 2)
    const boxes = await page.evaluate(() => window.arrowBoxes())
    const t1Arrow = boxes.find((b) => b.srcStart === String(T1))
    await page.mouse.click(t1Arrow.x + t1Arrow.w / 2, t1Arrow.y + t1Arrow.h / 2)
    await settle(page)
    await page.evaluate(() => window.setMode('live'))
    await settle(page)
    assert.equal(await page.evaluate(() => window.editRequestCount()), 0, '折叠与模式往返全程零写回')
    await page.close()
    await check(errors, '零写回')
  }
  // ---- 场景 7：阅读态查找命中折叠区自动展开（落点展开，与 Live 同款） ----
  {
    const { page, errors } = await openPage()
    const editsBefore = await page.evaluate(() => window.editRequestCount())
    await foldT2InLive(page) // Live 折 T2（beta 落隐藏区）
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [T2], '前置：T2 折叠')
    await page.evaluate(() => window.setMode('reading'))
    await page.waitForSelector('.vsidian-reading-block', { timeout: 5000 })
    // 阅读态查找：键路由要求焦点在阅读容器内（findPanel 套件同款前置）
    await page.evaluate(() => {
      const container = document.querySelector('.vsidian-view-reading')
      if (container instanceof HTMLElement) container.focus()
    })
    await page.keyboard.press('Control+f')
    await page.click('.vsidian-find-input')
    await page.keyboard.type('beta') // 输入即定位：命中落在折叠隐藏区
    // findLocate 阅读分支落点展开（与 locateOffset 阅读分支同款
    // unfoldAround，规格第六节「阅读态查找……自动展开直达」承诺句）
    assert.deepEqual(await page.evaluate(() => window.foldKeys()), [],
      '阅读态查找命中折叠区 → 该节自动展开')
    await settle(page)
    const text = await page.evaluate(() => window.readingText())
    assert.equal(text.includes('beta'), true, '展开后 beta 进入可见序列')
    // 查找定位与落点展开全程零写回
    assert.equal(await page.evaluate(() => window.editRequestCount()), editsBefore,
      '阅读态查找落点展开零写回')
    await page.close()
    await check(errors, '阅读态查找命中折叠区自动展开')
  }
} finally {
  await browser.close()
}
console.log(`[阅读折叠] ${passed}/${total} 通过`)
if (passed !== total) process.exit(1)
