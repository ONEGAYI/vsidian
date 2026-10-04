// P2-09（#286）生产控制器 + Chromium 布局：递归引用的直接父模式与逐层
// 目标编辑——B 内部 Live 编辑器挂孙卡（独占行/混排/表格格内）、C 跟随
// 绑定独立端口、在 C 真实键入只写 C、父根切换不覆写手动选择、循环截断
// 可见、父切模式编辑器移交不丢现场；#321：B 内删除孙卡引用行对齐 A 层
// 确认拦截（dirty 孙卡三项模态、取消保留、确认后 B 中删除完成）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'recursiveLive/recursiveLive.js')
await build({ entryPoints: [path.join(root, 'test/browser/recursiveLiveFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 980, height: 700 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  return page
}

const errors = []
const B_TEXT = [
  '# 父级B标题',
  '',
  '![[孙级C]]',
  '',
  '前文混排 ![[孙级C|混排位]] 后文混排。',
  '',
  '| 格内头 | 普通头 |',
  '| --- | --- |',
  '| ![[孙级C\\|格内位]] | 普通格 |',
  '',
  'B 尾部段落。',
  '',
].join('\n')
const C_TEXT = ['# 孙级C标题', '', '孙级C正文一段。', '', '孙级C正文二段。', ''].join('\n')

/** 轮询直到谓词为真（探针等待——bind/init 异步往返） */
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

try {
  // ---- 场景 1：A Reading、B 手动 Live → 孙卡跟随 + 逐层目标编辑 ----
  const page1 = await newPage()
  await page1.evaluate((b) => window.setupRecursiveTargets(b, '# 孙级C标题\n\n孙级C正文一段。\n'), B_TEXT)
  await page1.evaluate(() => window.initRecursiveDoc('![[父级B]]\n', 'reading'))
  await waitUntil(page1, () => window.recursiveCardPaint('父级B.md').present, 'B 卡装载')
  assert.equal(await page1.evaluate(() => window.clickRecursiveMode('父级B.md')), true, 'B 模式按钮可点')
  await waitUntil(page1, () => window.recursiveCardPaint('父级B.md').hasEditor, 'B 内部 Live 编辑器在场')
  // B 的编辑器中孙卡真实可见：三个孙位（独占行/混排/表格格内）挂载且嵌套在 B 编辑器内。
  // 孙卡探针按 inner 去重——同 entry 双容器（B 的 Reading 容器隐藏但未销毁）各出一条
  await waitUntil(page1, () => {
    const inners = new Set(window.recursiveCards()
      .filter((c) => String(c.inner ?? '').includes('孙级C') && c.state === 'content')
      .map((c) => String(c.inner)))
    return inners.size === 3 ? [...inners] : null
  }, '三个孙位挂载（独占行/混排/格内）')
  const grandPaint = await page1.evaluate(() => window.recursiveCardPaint('孙级C.md'))
  assert.equal(grandPaint.present, true, '孙卡在场')
  assert.equal(grandPaint.visible, true, '孙卡真实可见（非零尺寸）')
  assert.equal(grandPaint.insideParentEditor, true, '孙卡嵌套在 B 的内部 Live 编辑器内')
  assert.equal(grandPaint.modeBtnVisible, true, '孙卡模式按钮可见（可独立切换）')
  // 孙卡 C 跟随直接父 B（Live）：三个孙位各自独立端口（fsPath=C，端口身份 ≠ B）
  const portByInner = await waitUntil(page1, () => {
    const byInner = new Map()
    for (const c of window.recursiveCards()) {
      if (String(c.inner ?? '').includes('孙级C') && c.liveBound === true && (c.liveTextLen ?? -1) >= 0) {
        byInner.set(String(c.inner), c.livePortId)
      }
    }
    return byInner.size === 3 ? Object.fromEntries(byInner) : null
  }, '三个孙位全部绑定端口并装载全文')
  const bPort = await page1.evaluate(() => window.recursiveCardOf('父级B')?.livePortId)
  for (const [inner, port] of Object.entries(portByInner)) {
    assert.ok(port && port !== bPort, `孙卡 ${inner} 端口独立于 B（${port} vs ${bPort}）`)
  }
  // 在孙卡（文档序第一个）真实键入：只写 C——A 面板与 B 权威文本零改
  const cInsertAt = '# 孙级C标题\n\n'.length
  assert.equal(await page1.evaluate((p) => window.focusRecursiveEditor('孙级C.md', p), cInsertAt), true,
    '孙卡编辑器可聚焦')
  await page1.keyboard.type('【孙编辑】')
  const cModel = await waitUntil(page1, () => {
    const model = window.recursiveModel('孙级C')
    return model?.text.includes('【孙编辑】') ? model : null
  }, 'C 权威模型收到孙卡编辑')
  assert.ok(cModel.dirty, '孙卡编辑后 C dirty')
  const bModelAfter = await page1.evaluate(() => window.recursiveModel('父级B'))
  assert.equal(bModelAfter.text, B_TEXT, 'B 权威文本零改（孙卡编辑不落 B）')
  assert.equal(await page1.evaluate(() => window.recursiveMainText()), '![[父级B]]\n',
    'A 面板文本零改（孙卡编辑不落 A——源文保持初始）')
  const editRequests = await page1.evaluate(() => window.recursiveSent()
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'edit.request'))
  assert.ok(editRequests.length > 0, '孙卡输入经目标端口出站')
  // Ctrl+S 焦点路由：只保存 C
  await page1.keyboard.press('Control+s')
  const cSaved = await waitUntil(page1, () => {
    const model = window.recursiveModel('孙级C')
    return model?.saved === 1 && !model.dirty ? model : null
  }, 'Ctrl+S 保存孙卡目标 C')
  assert.equal(cSaved.saved, 1, '保存次数 = 1')
  const bSaved = await page1.evaluate(() => window.recursiveModel('父级B'))
  assert.equal(bSaved.saved, 0, 'B 未被连带保存')

  // ---- 场景 1b：B 切回 Reading → 无覆盖孙卡跟随回落（端口/编辑器回收）；再切 Live 恢复 ----
  await page1.evaluate(() => window.clickRecursiveMode('父级B.md'))
  await waitUntil(page1, () => window.recursiveCardOf('父级B')?.internalMode === 'reading', 'B 切回 Reading')
  await waitUntil(page1, () => {
    const byInner = new Map()
    for (const c of window.recursiveCards()) {
      if (String(c.inner ?? '').includes('孙级C')) {
        const reading = byInner.get(String(c.inner)) === 'reading' || c.internalMode === 'reading'
        const unbound = byInner.get(String(c.inner)) === undefined || c.liveBound === false
        byInner.set(String(c.inner), reading && unbound ? 'reading' : 'live')
      }
    }
    return byInner.size === 3 && [...byInner.values()].every((m) => m === 'reading') ? byInner : null
  }, '无覆盖孙卡跟随直接父回落 Reading（写端口回收）')
  const recycledCount = await page1.evaluate(() => window.recursiveEditorCount())
  assert.equal(recycledCount, 1, `回收后仅剩 A 主编辑器（实际 ${recycledCount}）——孙卡编辑器与 B 编辑器全部销毁`)
  // C 未保存修改不因跟随回落丢失：权威模型保留【孙编辑】（已保存）且回 B 再回 A 状态可见
  const cKept = await page1.evaluate(() => window.recursiveModel('孙级C'))
  assert.ok(cKept.text.includes('【孙编辑】'), '跟随回落不丢已写入目标的内容')
  // B 再切 Live：孙位跟随恢复绑定（编辑器按需重建）
  await page1.evaluate(() => window.clickRecursiveMode('父级B.md'))
  await waitUntil(page1, () => {
    const byInner = new Map()
    for (const c of window.recursiveCards()) {
      if (String(c.inner ?? '').includes('孙级C') && c.liveBound === true) {
        byInner.set(String(c.inner), true)
      }
    }
    return byInner.size === 3 ? byInner : null
  }, 'B 再切 Live 孙位跟随恢复绑定')
  await page1.close()

  // ---- 场景 2：A Live、B 手动 Reading → C 默认 Reading；C 手动 Live；A 切换不覆写 ----
  const page2 = await newPage()
  await page2.evaluate((b) => window.setupRecursiveTargets(b, '# 孙级C标题\n\n孙级C正文一段。\n'), B_TEXT)
  await page2.evaluate(() => window.initRecursiveDoc('![[父级B]]\n', 'live'))
  await waitUntil(page2, () => window.recursiveCardPaint('父级B.md').hasEditor, 'A Live 下 B 跟随建编辑器')
  await waitUntil(page2, () => {
    const byInner = new Map()
    for (const c of window.recursiveCards()) {
      if (String(c.inner ?? '').includes('孙级C') && c.liveBound === true) {
        byInner.set(String(c.inner), true)
      }
    }
    return byInner.size === 3 ? byInner : null
  }, 'A Live 全链继承：孙位随 B 绑定')
  // B 手动切 Reading：B 编辑器销毁，孙卡随直接父回落 Reading（端口释放）
  await page2.evaluate(() => window.clickRecursiveMode('父级B.md'))
  await waitUntil(page2, () => window.recursiveCardOf('父级B')?.internalMode === 'reading', 'B 手动 Reading')
  await waitUntil(page2, () => {
    const byInner = new Map()
    for (const c of window.recursiveCards()) {
      if (String(c.inner ?? '').includes('孙级C')) {
        const bound = byInner.get(String(c.inner)) === true || c.liveBound === true
        byInner.set(String(c.inner), bound)
      }
    }
    return byInner.size === 3 && [...byInner.values()].every((bound) => bound === false) ? byInner : null
  }, '孙卡默认跟随直接父 Reading（无写端口）')
  // C 手动切 Live（文档序第一个孙位）：独立记忆
  await page2.evaluate(() => window.clickRecursiveMode('孙级C.md'))
  await waitUntil(page2, () => window.recursiveCardPaint('孙级C.md').hasEditor, 'C 手动 Live 建编辑器')
  // A 切回 Reading：B/C 手动态均保持
  await page2.evaluate(() => window.setRecursiveMode('reading'))
  await page2.waitForTimeout(250)
  const afterSwitch = await page2.evaluate(() => ({
    b: window.recursiveCardOf('父级B'),
    c: window.recursiveCardOf('孙级C'),
  }))
  assert.equal(afterSwitch.b?.internalMode, 'reading', 'B 保持手动 Reading（A 切换不覆写）')
  assert.equal(afterSwitch.c?.internalMode, 'live', 'C 保持手动 Live（A 切换不覆写）')
  assert.equal(afterSwitch.c?.liveBound, true, 'C 端口在场（手动 Live 不被回收）')
  await page2.close()

  // ---- 场景 3：链上回环（C 内 ![[parent]] 回指 A）循环截断可见 ----
  const page3 = await newPage()
  const cLoop = '# 孙级C标题\n\n![[parent]]\n\n孙级C正文一段。\n'
  const bSole = '# 父级B标题\n\n![[孙级C]]\n\nB 尾部段落。\n'
  await page3.evaluate(([b, c]) => window.setupRecursiveTargets(b, c), [bSole, cLoop])
  await page3.evaluate(() => window.initRecursiveDoc('![[父级B]]\n', 'reading'))
  await waitUntil(page3, () => window.recursiveCardPaint('父级B.md').present, 'B 卡装载')
  await page3.evaluate(() => window.clickRecursiveMode('父级B.md'))
  await waitUntil(page3, () => window.recursiveCardPaint('父级B.md').hasEditor, 'B 编辑器在场')
  // 孙卡 C 跟随装载（回环目标 parent 的请求被伪宿主按 cycle 拒绝）
  await waitUntil(page3, () => window.recursiveCardPaint('孙级C.md').hasEditor === true, '孙卡 C Live 在场')
  const loopState = await waitUntil(page3, () => {
    const card = window.recursiveCards().find((c) => String(c.inner ?? '') === 'parent')
    return card && card.state === 'error' ? card.note : null
  }, '回环位显示错误分态')
  assert.ok(loopState.includes(zhCn['hover.errorCycle']),
    `回环错误文案在场（实际 ${JSON.stringify(loopState)}）`)
  await page3.close()

  // ---- 场景 4（#321）：B 内删除孙卡引用行——dirty 孙卡弹三项确认（对齐 A 层） ----
  const page4 = await newPage()
  const b4 = '# 父级B标题\n\n![[孙级C]]\n\nB 尾部段落。\n'
  const c4 = '# 孙级C标题\n\n孙级C正文一段。\n'
  await page4.evaluate(([b, c]) => window.setupRecursiveTargets(b, c), [b4, c4])
  await page4.evaluate(() => window.initRecursiveDoc('![[父级B]]\n', 'reading'))
  await waitUntil(page4, () => window.recursiveCardPaint('父级B.md').present, 'B 卡装载')
  await page4.evaluate(() => window.clickRecursiveMode('父级B.md'))
  await waitUntil(page4, () => window.recursiveCardPaint('父级B.md').hasEditor, 'B 编辑器在场')
  await waitUntil(page4, () => window.recursiveCardPaint('孙级C.md').hasEditor === true, '孙卡 C Live 在场')
  // 孙卡内真实键盘输入（dirty——未保存修改在场）
  assert.equal(await page4.evaluate(() => window.focusRecursiveEditor('孙级C.md', '# 孙级C标题\n\n'.length)), true,
    '孙卡编辑器可聚焦')
  await page4.keyboard.type('【孙未存】')
  await waitUntil(page4, () => window.recursiveModel('孙级C')?.dirty === true, '孙卡 dirty（未保存输入在场）')
  const bTextBefore4 = await page4.evaluate(() => window.recursiveEditorText('父级B.md'))
  // B 编辑器内删除孙卡引用行：事务被拦（B 不先写入）+ 三项模态在场（目标 = 孙卡）
  assert.equal(await page4.evaluate(() => window.recursiveDeleteGrandchildLine()), true, 'B 内删除事务发出')
  await waitUntil(page4, () => window.recursiveCloseDialogState().open, '孙卡删除触发三项模态')
  assert.equal(await page4.evaluate(() => window.recursiveEditorText('父级B.md')), bTextBefore4,
    '删除被拦截：B 原文未变（不把未确认删除先写入 B）')
  const dialog4 = await page4.evaluate(() => window.recursiveCloseDialogState())
  assert.ok(dialog4.text.includes(zhCn['embed.closeDialogTitle']), '模态标题在场（复用既有文案）')
  assert.ok(dialog4.text.includes('孙级C.md'), '模态指明孙卡目标文件名')
  // 取消：B 原引用保留、孙卡现场保持
  assert.equal(await page4.evaluate(() => window.recursiveDialogClick('cancel')), true)
  await waitUntil(page4, () => !window.recursiveCloseDialogState().open, '模态关闭（取消）')
  assert.equal(await page4.evaluate(() => window.recursiveEditorText('父级B.md')), bTextBefore4,
    '取消后 B 原引用保留')
  assert.equal((await page4.evaluate(() => window.recursiveCardOf('孙级C')))?.liveBound, true,
    '取消后孙卡现场保持')
  // 再次删除 → 保存并关闭：B 中删除完成（重放落地）+ 孙卡保存
  assert.equal(await page4.evaluate(() => window.recursiveDeleteGrandchildLine()), true)
  await waitUntil(page4, () => window.recursiveCloseDialogState().open, '再次删除触发模态')
  assert.equal(await page4.evaluate(() => window.recursiveDialogClick('save')), true)
  await waitUntil(page4, () => !window.recursiveCloseDialogState().open, '保存确认后模态关闭')
  await waitUntil(page4, () => {
    const text = window.recursiveEditorText('父级B.md')
    return !text.includes('![[孙级C]]') ? text : null
  }, '确认后 B 中孙卡引用行删除完成（重放落地）')
  const cModel4 = await waitUntil(page4, () => {
    const model = window.recursiveModel('孙级C')
    return model?.dirty === false ? model : null
  }, '孙卡目标已保存')
  assert.ok((cModel4?.text ?? '').includes('【孙未存】'), '孙卡编辑随保存落盘')
  // 重放经 B 编辑端口出站：B 权威模型收到该删除（孙引用行消失）
  await waitUntil(page4, () => !window.recursiveModel('父级B')?.text.includes('![[孙级C]]'),
    'B 权威文本同步删除')
  assert.equal(await page4.evaluate(() => window.recursiveMainText()), '![[父级B]]\n',
    'A 面板零改（B 层删除不触 A）')
  await page4.close()

  assert.deepEqual(errors, [], '无浏览器运行时错误')
  console.log('[递归Live][PASS] 直接父跟随/父Live编辑器挂孙卡（独占行/混排/格内）/逐层目标编辑与保存隔离/手动独立与父切换保持/循环截断/跟随回落回收与恢复/孙卡删除对齐A层确认拦截（#321）')
} finally {
  await browser.close()
}
