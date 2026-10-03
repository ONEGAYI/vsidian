// P2-14（#291）二期组合收口：跨票真实场景组合验证——浮窗内递归（P2-06×
// P2-09）、表格格内递归三层（P2-08×P2-09）、孙卡 C 资源归属（P2-11×P2-09）、
// 模式覆盖后显式关闭（P2-05×P2-09）、空白表格组合规划（P2-10 移交验证——
// P2-11 isLiveActive 接真后自然恢复）、表格网格化钉住（P2-09 移交评估：
// 当前树全层级工作）与代码卡复制信封（P2-14 接线）。生产控制器 + 真实
// 键盘/CDP IME 组合；会话校验与真实剪贴板由集成层覆盖。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'embedLiveCloseout/embedLiveCloseout.js')
await build({ entryPoints: [path.join(root, 'test/browser/embedLiveCloseoutFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const errors = []

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 980, height: 700 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  return page
}

async function waitUntil(page, fn, label, timeout = 6000) {
  const started = Date.now()
  for (;;) {
    const value = await page.evaluate(fn)
    if (value) {
      return value
    }
    if (Date.now() - started > timeout) {
      throw new Error(`等待超时：${label}`)
    }
    await page.waitForTimeout(120)
  }
}

let passed = 0

try {
  // ---- S1 浮窗内递归（P2-06 浮窗根 Live × P2-09 孙卡解锁）----
  const page1 = await newPage()
  const B1 = ['# 父级B标题', '', '![[孙级C]]', '', 'B 尾部段落。', ''].join('\n')
  const C1 = ['# 孙级C标题', '', '孙级C正文一段。', '', '孙级C正文二段。', ''].join('\n')
  await page1.evaluate(([b, c]) => window.setupCloseoutTargets(b, c), [B1, C1])
  await page1.evaluate(() => {
    window.initCloseoutDoc('打开 [[父级B]] 查看。\n', 'live')
    window.applyCloseoutSettings({ 'hover.liveDirect': true })
  })
  await page1.locator('.cm-content .vsidian-wikilink').first().waitFor()
  await page1.evaluate(() => window.closeoutHoverPtr('live-wikilink', 'enter', 0))
  await waitUntil(page1, () => window.readCloseoutPopup().open === true, '浮窗打开')
  await waitUntil(page1, () => window.readCloseoutPopup().editorPresent === true, '浮窗根 B 继承 Live 编辑器')
  // 浮窗内 B 的编辑器中孙卡 C 跟随装载（P2-09 解锁浮窗根后代）
  await waitUntil(page1, () => {
    const paint = window.closeoutCardPaint('孙级C.md')
    return paint.present && paint.hasEditor ? paint : null
  }, '浮窗内孙卡 C 跟随 Live 装载')
  const s1Inside = await page1.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.vsidian-embed-card'))
    const c = cards.find((el) =>
      (el.querySelector(':scope > .vsidian-embed-card-header .vsidian-embed-card-title')?.textContent ?? '')
        .includes('孙级C') && el.getBoundingClientRect().height > 0)
    return c ? c.closest('.vsidian-hover-popup') !== null : false
  })
  assert.equal(s1Inside, true, '孙卡嵌套在浮窗内（浮窗根后代解锁）')
  // 在浮窗内孙卡 C 真实键入：只写 C
  assert.equal(await page1.evaluate(() => window.focusCloseoutEditor('孙级C.md', '# 孙级C标题\n\n'.length)), true,
    '孙卡编辑器可聚焦')
  await page1.keyboard.type('【浮窗孙】')
  const s1c = await waitUntil(page1, () => {
    const model = window.closeoutModel('孙级C')
    return model?.text.includes('【浮窗孙】') ? model : null
  }, 'C 权威模型收到浮窗内孙卡编辑')
  assert.ok(s1c.dirty, '孙卡编辑后 C dirty')
  assert.equal((await page1.evaluate(() => window.closeoutModel('父级B'))).text, B1, 'B 权威文本零改')
  assert.equal(await page1.evaluate(() => window.closeoutMainText()), '打开 [[父级B]] 查看。\n', 'A 正文零改')
  // Ctrl+S 只保存 C
  await page1.keyboard.press('Control+s')
  await waitUntil(page1, () => window.closeoutModel('孙级C')?.saved === 1, 'Ctrl+S 只保存孙卡目标 C')
  assert.equal((await page1.evaluate(() => window.closeoutModel('父级B'))).saved, 0, 'B 未被连带保存')
  const s1Editors = await page1.evaluate(() => window.closeoutEditorCount())
  // 关闭浮窗（指针离场）：浮窗根与孙卡编辑器全部回收
  await page1.evaluate(() => window.closeoutHoverPtr('live-wikilink', 'leave', 0))
  await waitUntil(page1, () => window.closeoutEditorCount() === 1, '浮窗关闭后仅剩主编辑器（B/孙卡全回收）')
  await page1.close()
  passed++
  console.log(`[S1][PASS] 浮窗内递归：浮窗根 Live→孙卡跟随装载→C 输入/保存归 C→关闭全回收（${s1Editors}→1）`)

  // ---- S2/S6/S7(B) 表格格内递归三层 + 网格化钉住 + 代码卡复制信封 ----
  const page2 = await newPage()
  const B2 = [
    '# 父级B标题',
    '',
    '![[孙级C]]',
    '',
    '| B表头 | B表头2 |',
    '| --- | --- |',
    '| B格1 | B格2 |',
    '',
    '```js',
    'const b = 1',
    '```',
    '',
    'B 尾部段落。',
    '',
  ].join('\n')
  const C2 = [
    '# 孙级C标题',
    '',
    '| C表头 | C表头2 |',
    '| --- | --- |',
    '| C格1 | C格2 |',
    '',
  ].join('\n')
  await page2.evaluate(([b, c]) => window.setupCloseoutTargets(b, c), [B2, C2])
  await page2.evaluate(() => window.initCloseoutDoc(
    '| A头 | A头2 |\n| --- | --- |\n| ![[父级B\\|格内位]] | 普通格 |\n', 'live'))
  await waitUntil(page2, () => window.closeoutCardPaint('父级B.md').hasEditor === true, 'A 表格格内 B 继承 Live')
  await waitUntil(page2, () => window.closeoutCardPaint('孙级C.md').hasEditor === true, 'B 内孙卡 C 跟随 Live（三层）')
  // S2：三层输入归属——在 C 键入只写 C，B/A 零改
  assert.equal(await page2.evaluate(() => window.focusCloseoutEditor('孙级C.md', '# 孙级C标题\n\n| C表头 | C表头2 |\n| --- | --- |\n| '.length)), true,
    'C 表格行内可聚焦')
  await page2.keyboard.type('【格内孙】')
  await waitUntil(page2, () => {
    const model = window.closeoutModel('孙级C')
    return model?.text.includes('【格内孙】') ? model : null
  }, 'C 权威模型收到三层格内孙卡编辑')
  assert.equal((await page2.evaluate(() => window.closeoutModel('父级B'))).text, B2, 'B 权威文本零改（三层）')
  // S6：表格网格化钉住（B 与 C 编辑器内 display:grid——P2-09 移交评估证据）
  const gridB = await page2.evaluate(() => window.closeoutGridInfo('父级B.md'))
  const gridC = await page2.evaluate(() => window.closeoutGridInfo('孙级C.md'))
  assert.ok(gridB.gridRows >= 2, `B 编辑器内表格网格行在场（实际 ${gridB.gridRows}）`)
  assert.equal(gridB.firstDisplay, 'grid', 'B 编辑器网格行实际按 grid 绘制')
  assert.ok(gridC.gridRows >= 2, `孙卡 C 编辑器内表格网格行在场（实际 ${gridC.gridRows}）`)
  assert.equal(gridC.firstDisplay, 'grid', '孙卡 C 编辑器网格行实际按 grid 绘制')
  // S7(B)：B 编辑器内代码卡复制按钮 → codeblock.copy 信封（B 身份）
  const s7before = await page2.evaluate(() => window.closeoutSent().length)
  await page2.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.vsidian-embed-card'))
    const b = cards.find((el) =>
      (el.querySelector(':scope > .vsidian-embed-card-header .vsidian-embed-card-title')?.textContent ?? '')
        .includes('父级B') && el.getBoundingClientRect().height > 0)
    const btn = b?.querySelector('.vsidian-embed-card-live .vsidian-code-card-copy')
    if (btn instanceof HTMLButtonElement) {
      btn.click()
    }
  })
  await page2.waitForTimeout(150)
  const s7envelopes = await page2.evaluate((from) => window.closeoutSent()
    .slice(from)
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'codeblock.copy'), s7before)
  assert.equal(s7envelopes.length, 1, 'B 内代码卡复制恰一枚信封出站')
  assert.equal(s7envelopes[0].fsPath, 'D:\\notes\\父级B.md', '复制信封按 B 身份出站')
  assert.equal(s7envelopes[0].message.text, 'const b = 1', '复制文本为代码体原文')
  await page2.close()
  passed++
  console.log('[S2/S6/S7][PASS] 表格格内递归三层输入归 C + B/C 网格化 grid 绘制 + 代码卡复制信封（B 身份）')

  // ---- S3 C 资源归属（P2-11×P2-09：孙卡资源按 C 解析语境）----
  const page3 = await newPage()
  const B3 = ['# 父级B标题', '', '![[孙级C]]', '', 'B 尾部。', ''].join('\n')
  const C3 = [
    '# 孙级C标题', '',
    '![孙图](res.png)', '',
    '[孙链](inner-target.md) 与 [[双链目标]]', '',
    '```js', 'const c = 2', '```', '',
  ].join('\n')
  await page3.evaluate(([b, c]) => window.setupCloseoutTargets(b, c), [B3, C3])
  await page3.evaluate(() => window.initCloseoutDoc('![[父级B]]\n', 'reading'))
  await waitUntil(page3, () => window.closeoutCardPaint('父级B.md').present === true, 'B 卡装载')
  await page3.evaluate(() => window.clickCloseoutMode('父级B.md'))
  await waitUntil(page3, () => window.closeoutCardPaint('父级B.md').hasEditor === true, 'B 手动 Live')
  await waitUntil(page3, () => window.closeoutCardPaint('孙级C.md').hasEditor === true, '孙卡 C 跟随装载')
  // C 内图片自动解析请求 → image.request 信封 fsPath=C（C 解析语境）
  await waitUntil(page3, () => window.closeoutSent()
    .some((m) => m.kind === 'refEdit.message' && m.message.kind === 'image.request' &&
      m.fsPath === 'D:\\notes\\孙级C.md'), 'C 图片解析信封按 C 身份出站')
  const s3imgWrong = await page3.evaluate(() => window.closeoutSent()
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'image.request' &&
      m.fsPath !== 'D:\\notes\\孙级C.md'))
  assert.deepEqual(s3imgWrong, [], '无按 B/A 身份出站的 C 图片请求')
  // C 内双链 Ctrl+mousedown → wikilink.activate 信封 fsPath=C（与既有资源套件同驱动方式）
  assert.equal(await page3.evaluate(() => window.focusCloseoutEditor('孙级C.md')), true, 'C 编辑器聚焦')
  const wikilinkBox = await page3.locator(
    '.vsidian-embed-card .vsidian-embed-card-live [data-vsidian-rendered-wikilink="true"]').first().boundingBox()
  assert.ok(wikilinkBox, 'C 内渲染态双链在场')
  await page3.mouse.move(wikilinkBox.x + wikilinkBox.width / 2, wikilinkBox.y + wikilinkBox.height / 2)
  await page3.mouse.down({ ctrlKey: true })
  await page3.mouse.up({ ctrlKey: true })
  await page3.waitForTimeout(250)
  const s3wiki = await page3.evaluate(() => window.closeoutSent()
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'wikilink.activate').at(-1))
  assert.ok(s3wiki, '双链点击出站 wikilink.activate 信封')
  assert.equal(s3wiki.fsPath, 'D:\\notes\\孙级C.md', '双链信封按 C 身份出站（C 解析语境）')
  // S7(C)：孙卡内代码卡复制 → 信封 fsPath=C
  const s3before = await page3.evaluate(() => window.closeoutSent().length)
  await page3.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.vsidian-embed-card'))
    const c = cards.filter((el) =>
      (el.querySelector(':scope > .vsidian-embed-card-header .vsidian-embed-card-title')?.textContent ?? '')
        .includes('孙级C') && el.getBoundingClientRect().height > 0).pop()
    const btn = c?.querySelector('.vsidian-embed-card-live .vsidian-code-card-copy')
    if (btn instanceof HTMLButtonElement) {
      btn.click()
    }
  })
  await page3.waitForTimeout(150)
  const s3copy = await page3.evaluate((from) => window.closeoutSent()
    .slice(from)
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'codeblock.copy'), s3before)
  assert.equal(s3copy.length, 1, '孙卡代码卡复制恰一枚信封')
  assert.equal(s3copy[0].fsPath, 'D:\\notes\\孙级C.md', '孙卡复制信封按 C 身份出站')
  await page3.close()
  passed++
  console.log('[S3][PASS] C 资源归属：图片/双链/代码卡复制信封全部按 C 身份出站')

  // ---- S4 模式覆盖后显式关闭（P2-05×P2-09）----
  const page4 = await newPage()
  const B4 = ['# 父级B标题', '', '![[孙级C]]', '', 'B 尾部。', ''].join('\n')
  const C4 = ['# 孙级C标题', '', '孙级C正文。', ''].join('\n')
  await page4.evaluate(([b, c]) => window.setupCloseoutTargets(b, c), [B4, C4])
  await page4.evaluate(() => window.initCloseoutDoc('![[父级B]]\n', 'live'))
  await waitUntil(page4, () => window.closeoutCardPaint('父级B.md').hasEditor === true, 'B 跟随 Live')
  await waitUntil(page4, () => window.closeoutCardPaint('孙级C.md').hasEditor === true, 'C 跟随 Live')
  // C 手动切 Reading（覆盖）；A 切 Reading（B 回落）；C 保持手动 Reading
  await page4.evaluate(() => window.clickCloseoutMode('孙级C.md'))
  await waitUntil(page4, () => window.closeoutCardOf('孙级C|')?.internalMode === 'reading' ||
    window.closeoutCardOf('孙级C')?.internalMode === 'reading', 'C 手动 Reading')
  await page4.evaluate(() => window.setCloseoutMode('reading'))
  await waitUntil(page4, () => window.closeoutCardOf('父级B')?.internalMode === 'reading', 'A 切 Reading 后 B 回落')
  // C 手动切回 Live（直接父 B 为 Reading，孙卡独立覆盖；编辑器迁移到 B 的
  // Reading 容器内孙位卡壳需要布局稳定时间）
  await page4.evaluate(() => window.clickCloseoutMode('孙级C.md'))
  await page4.waitForTimeout(600)
  await waitUntil(page4, () => window.closeoutCardPaint('孙级C.md').hasEditor === true, 'C 手动 Live（覆盖保持）')
  const s4b = await page4.evaluate(() => window.closeoutCardOf('父级B'))
  assert.equal(s4b.internalMode, 'reading', '覆盖期间 B 保持 Reading（孙卡不覆写父）')
  // C 键入 dirty → Esc → 三项模态 → 保存并关闭只保存 C
  assert.equal(await page4.evaluate(() => window.focusCloseoutEditor('孙级C.md', '# 孙级C标题\n\n'.length)), true,
    '覆盖态 C 编辑器聚焦')
  await page4.keyboard.type('【覆盖态】')
  await waitUntil(page4, () => window.closeoutModel('孙级C')?.text.includes('【覆盖态】'), '覆盖态 C 编辑落库')
  await page4.keyboard.press('Escape')
  await waitUntil(page4, () => window.closeoutDialogState().open === true, '孙卡 Esc 触发三项关闭模态')
  const s4dialog = await page4.evaluate(() => window.closeoutDialogState())
  assert.ok(s4dialog.text.includes('孙级C.md'), `模态文字指明 C 文件名（实际 ${s4dialog.text.slice(0, 60)}）`)
  assert.equal(await page4.evaluate(() => window.clickCloseoutDialogAction('save')), true, '点「保存并关闭」')
  await waitUntil(page4, () => window.closeoutModel('孙级C')?.saved === 1, '保存并关闭只保存 C')
  await waitUntil(page4, () => window.closeoutDialogState().open === false, '模态退出')
  assert.equal((await page4.evaluate(() => window.closeoutModel('父级B'))).saved, 0, 'B 未被连带保存')
  await waitUntil(page4, () => window.closeoutCardPaint('孙级C.md').hasEditor === false, '孙卡退出编辑态（端口释放）')
  assert.equal(await page4.evaluate(() => window.closeoutMainText()), '![[父级B]]\n', 'A 零改')
  await page4.close()
  passed++
  console.log('[S4][PASS] 模式覆盖后关闭：孙卡覆盖态 Esc 三项模态→保存并关闭归 C→模态退端口释')

  // ---- S5 空白表格组合规划（P2-10 移交 × P2-11 接真后的组合验证）----
  const page5 = await newPage()
  const B5 = [
    '# 父级B标题', '',
    '| B表头 | B表头2 |', '| --- | --- |', '| B格1 |  |', '',
  ].join('\n')
  await page5.evaluate((b) => window.setupCloseoutTargets(b, '# 孙级C标题\n\n孙级C正文。\n'), B5)
  await page5.evaluate(() => window.initCloseoutDoc('![[父级B]]\n', 'live'))
  await waitUntil(page5, () => window.closeoutCardPaint('父级B.md').hasEditor === true, 'B 跟随 Live')
  // 光标进 B 表格空白格（第 1 数据行第 2 列），CDP 组合输入含管道符
  const blankAt = B5.indexOf('| B格1 |  |') + '| B格1 | '.length
  assert.equal(await page5.evaluate((p) => window.focusCloseoutEditor('父级B.md', p), blankAt), true,
    'B 表格空白格聚焦')
  const cdp = await page5.context().newCDPSession(page5)
  const s5before = await page5.evaluate(() => window.closeoutSent().length)
  // CDP imeSetComposition 的文本以已提交形态落 DOM（无真实 preedit）——
  // 再 insertText 会双份；组合流 = imeSetComposition（compositionstart/
  // update + 文本进 DOM）+ 合成 compositionend（真实 IME 提交必有，CDP
  // 不产生；按 imagePasteFixture 先例补合成事件驱动同一监听链）
  await cdp.send('Input.imeSetComposition', { text: '笔|记', selectionStart: 3, selectionEnd: 3 })
  await page5.waitForTimeout(120)
  await page5.evaluate(() => {
    const el = document.activeElement?.closest('.cm-content') ?? document.activeElement
    el?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '笔|记' }))
  })
  await page5.waitForTimeout(300)
  void s5before
  const s5model = await page5.evaluate(() => window.closeoutModel('父级B'))
  assert.ok(s5model.text.includes('| B格1 | 笔\\|记 |'),
    `组合净输入经表格规划转义落格（实际 ${s5model.text.split('\n')[4] ?? ''}）`)
  assert.equal(s5model.text.split('\n').length, B5.split('\n').length, '组合规划不增行（格内单行语义）')
  await cdp.detach()
  await page5.close()
  passed++
  console.log('[S5][PASS] 空白表格组合规划：B 内空白格 CDP IME 组合「笔|记」→ 规划转义落格「笔\\|记」')

  assert.deepEqual(errors, [], '无浏览器运行时错误')
  console.log(`embedLiveCloseout：${passed} 组场景全部通过`)
} finally {
  await browser.close()
}
