// #140 frontmatter 表格卡片浏览器回归：真实键鼠链路（Playwright 原生
// 键盘/鼠标）。合成 keydown 测不到 input.type 回流路径——值格内键入必须
// 经真实键盘验证 edit.request 出站与网格保持。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'frontmatterTable/frontmatterTable.js')
await build({ entryPoints: [path.join(root, 'test/browser/frontmatterTableFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  async function openPage() {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html><body><div id="app"></div></body></html>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    return { page, errors }
  }
  const editRequests = (page) => page.evaluate(() =>
    window.fmSent().filter((m) => m.kind === 'edit.request')
      .map(({ seq, baseVersion, changes }) => ({ seq, baseVersion, changes })))

  const FM_DOC = '---\ntitle: hello\ncount: 3\n---\n\n正文段落。\n'
  const ARRAY_DOC = '---\ntags:\n  - alpha\n  - beta\n---\n\n正文。\n'

  // ---- live：成型卡片绘制层可见（格有面积、命中点落在表格内） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    const rows = page.locator('.vsidian-fm-row')
    assert.equal(await rows.count(), 2, '两个键值行应成型为网格行')
    const value = page.locator('.vsidian-fm-row .vsidian-fm-value').first()
    const box = await value.boundingBox()
    assert.ok(box && box.width > 10 && box.height > 8, '值格应有可见面积（绘制层呈现）')
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? el.closest('.vsidian-fm-table, .vsidian-fm-row, .cm-line')?.className ?? '' : ''
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    assert.ok(String(hit).includes('vsidian-fm'), '值格中心点应命中表格元素（非隐藏层）')
    // 添加属性按钮常驻在场（呈现态）
    assert.equal(await page.locator('.vsidian-fm-add-entry').count(), 1)
    // 冒号分隔不占格位（display:none）
    const sepVisible = await page.locator('.vsidian-fm-sep').first().evaluate((el) =>
      getComputedStyle(el).display)
    assert.equal(sepVisible, 'none', '冒号分隔应在绘制层隐藏')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：值格真实键盘输入回流（点击落位 → 打字 → edit.request） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    const value = page.locator('.vsidian-fm-row .vsidian-fm-value').first()
    await value.click() // 真实鼠标点击落位光标进值格
    const headAfterClick = await page.evaluate(() => window.fmHead())
    assert.ok(headAfterClick >= FM_DOC.indexOf('hello') &&
      headAfterClick <= FM_DOC.indexOf('hello') + 5, '点击值格后光标应落在值区间')
    await page.keyboard.type('!')
    assert.equal(await page.evaluate(() => window.fmDoc()),
      FM_DOC.replace('hello', 'hello!'), '真实键入应立即进入 CM6 文档')
    assert.ok((await editRequests(page)).length >= 1, '键入应经标准链路出站 edit.request')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '键入后网格保持（不闪退源码）')
    assert.equal(await page.locator('.vsidian-fm-value').first().textContent(), 'hello!',
      '值格内容应随键入更新')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：Tab/Shift+Tab 真实键盘格导航（纯选区，零写回） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('.vsidian-fm-key').first().click()
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => window.fmHead()), FM_DOC.indexOf('hello'),
      'Tab 应从 key 格移到本行 value 格首')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => window.fmHead()), FM_DOC.indexOf('count'),
      'Tab 应从 value 格移到下行 key 格首')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate(() => window.fmHead()), FM_DOC.indexOf('hello'),
      'Shift+Tab 应反向回到上行 value 格首')
    assert.equal((await editRequests(page)).length, 0, 'Tab 导航零写回零 dirty')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：Enter 真实键盘末行加条目（写回 + 选中新键） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('.vsidian-fm-value').nth(1).click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const after = await page.evaluate(() => window.fmDoc())
    assert.ok(after.includes('count: 3\nkey: value\n---'), 'Enter 末值格应加键值对模板行')
    const sel = await page.evaluate(() => {
      const s = window.controller.getView().state.selection.main
      return { from: s.from, to: s.to }
    })
    assert.equal(after.slice(sel.from, sel.to), 'key', '新键文本应被选中（直接输入覆盖）')
    assert.ok((await editRequests(page)).length >= 1, '加行应出站一笔 edit.request')
    // 键选中态直接打字覆盖键名
    await page.keyboard.type('name')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('name: value'),
      '选中新键后直接键入应覆盖默认键名')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：数组项编辑与结构按钮真实鼠标 ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), ARRAY_DOC)
    // 项内键入回流
    await page.locator('.vsidian-fm-item-row .vsidian-fm-value').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('- alpha!'),
      '数组项内键入应回流源文本')
    // 项删除按钮（行 hover 显现后点击）：删除 beta 项
    const removeButtons = page.locator('.vsidian-fm-remove')
    assert.equal(await removeButtons.count(), 3, '宿主行 + 两项行各一个删除按钮')
    await removeButtons.nth(2).click()
    assert.equal(await page.evaluate(() => window.fmDoc()),
      '---\ntags:\n  - alpha!\n---\n\n正文。\n', '删除末项应移除整项行')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '删除后宿主行 + 单项行')
    // 加项按钮：末项后加 item
    await page.locator('.vsidian-fm-add-item').click()
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('  - alpha!\n  - item'),
      '加项按钮应在末项后插入缩进对齐的项')
    await page.keyboard.type('gamma')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('  - gamma'),
      '新项选中态直接键入覆盖默认项名')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：「添加属性」按钮 + 成型/降级实时切换（外部变更链路） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('.vsidian-fm-add-entry').click()
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('count: 3\nkey: value'),
      '添加属性应插入模板行')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 3, '新行应成型入网格')
    // 外部变更改坏头区（模拟另一面板写入嵌套）→ 降级源码
    await page.evaluate(() => window.fmExternal(0, 0, 'nested:\n  k: 1\n', 2))
    assert.equal(await page.locator('.vsidian-fm-row').count(), 0, '非法头区应降级（卡片消失）')
    assert.equal(await page.locator('.vsidian-fm-card-line').count(), 0, '降级后卡片行类消失')
    await page.evaluate(() => window.fmExternal(0, 'nested:\n  k: 1\n'.length, '', 3))
    assert.equal(await page.locator('.vsidian-fm-row').count(), 3, '恢复合法后卡片回归')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live/reading：键列对齐表格表头视觉（验收对齐：600 字重 + 表头
  //      底色，不灰字弱化——观感并入表格体系） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    const liveKey = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.vsidian-fm-row > .vsidian-fm-key'))
      return { weight: cs.fontWeight, bg: cs.backgroundColor }
    })
    assert.ok(Number.parseInt(liveKey.weight, 10) >= 600,
      `live 键列应为表头字重（≥600）: ${JSON.stringify(liveKey)}`)
    assert.notEqual(liveKey.bg, 'rgba(0, 0, 0, 0)',
      `live 键列应有表头底色: ${JSON.stringify(liveKey)}`)
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), FM_DOC)
    const readingKey = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.vsidian-reading-frontmatter .vsidian-fm-key'))
      return { weight: cs.fontWeight, bg: cs.backgroundColor }
    })
    assert.ok(Number.parseInt(readingKey.weight, 10) >= 600,
      `阅读键列应为表头字重（≥600）: ${JSON.stringify(readingKey)}`)
    assert.notEqual(readingKey.bg, 'rgba(0, 0, 0, 0)',
      `阅读键列应有表头底色: ${JSON.stringify(readingKey)}`)
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- reading：同款表格只读呈现 ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), ARRAY_DOC)
    const rows = page.locator('.vsidian-reading-frontmatter .vsidian-fm-row')
    assert.equal(await rows.count(), 3, '阅读侧应有宿主行 + 两项行')
    assert.equal(await page.locator('.vsidian-reading-frontmatter .vsidian-fm-key').first()
      .textContent(), 'tags', '键列文本呈现')
    const itemTexts = await page.locator('.vsidian-reading-frontmatter .vsidian-fm-item-row .vsidian-fm-value')
      .allTextContents()
    assert.deepEqual(itemTexts, ['alpha', 'beta'], '项行文本呈现')
    const box = await rows.first().boundingBox()
    assert.ok(box && box.width > 50 && box.height > 8, '阅读侧行应有可见面积')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- reading：复杂形态降级为转义源码块 ----
  {
    const { page, errors } = await openPage()
    const degraded = '---\ntitle: 元\nouter:\n  inner: 1\n---\n\n正文\n'
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), degraded)
    assert.equal(await page.locator('.vsidian-reading-frontmatter .vsidian-fm-table').count(), 0,
      '复杂形态不产表格')
    assert.equal(await page.locator('.vsidian-reading-frontmatter-text').count(), 1,
      '降级为转义源码块')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }
} finally {
  await browser.close()
}
console.log('frontmatterTable: 全部场景通过')
