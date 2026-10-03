// P2-06（#283）悬停浮窗根引用内部 Live 的原生浏览器回归：真实布局
// （Chromium）下以生产 hover.test.pointer 钩子注入悬停、真实键盘（键入/
// Ctrl+S/Esc/选区）驱动浮窗根 B 的完整链路——继承父模式绑定端口、编辑器
// 绘制层可见、真实输入只写 B（A 零写回）、dirty 圆点绘制层在场、dirty
// 移出/失焦保活与保存后恢复常规关闭、干净 Live 普通关闭、Esc 分层（选区
// 收敛 → 空选区显式退出 → Reading 态关浮窗）、手动模式按引用位置跨开合
// 记忆。宿主回包由脚本注入伪造通道（与真实 handleHostMessage 同入口）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'hoverLive/hoverLive.js')
await build({ entryPoints: [path.join(root, 'test/browser/hoverLiveFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '指向 [[目标笔记]] 的双链，以及第二条 [[目标笔记|同名链接]]。',
  '',
].join('\n')

const OPEN_WAIT = 700 // 开延迟 300ms + 装载/binding 余量
const CLOSE_WAIT = 800 // 关延迟 350ms + 余量

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await page.evaluate((text) => window.initHoverLiveDoc(text, 'live'), PARENT_DOC)
  await page.evaluate(() => window.applyHoverLiveSettings({ 'hover.liveDirect': true }))
  await page.locator('.cm-content .vsidian-wikilink').first().waitFor()

  const sent = () => page.evaluate(() => window.hoverLiveSent())
  const probe = () => page.evaluate(() => window.hoverLiveProbe())
  const popupDom = () => page.evaluate(() => window.readHoverLivePopup())
  const bModel = () => page.evaluate(() => window.hoverLiveBModel())
  const editorText = () => page.evaluate(() => window.hoverEditorText())
  const hoverPtr = (link, action, index = 0) =>
    page.evaluate(({ link, action, index }) => window.hoverPtr(link, action, index), { link, action, index })
  /** 模拟指针离开联合域：先真实移出（Chromium 在指针下 DOM 变更后会
   *  重发边界事件——布局翻转（Live↔Reading 显隐）期间真实指针滞留浮层
   *  内会再触发 mouseenter 抵消离场），再显式派发 mouseleave（与生产
   *  监听同一链路） */
  const mouseLeavePopup = async () => {
    await page.mouse.move(8, 630)
    return page.evaluate(() => {
      const el = document.querySelector('.vsidian-hover-popup')
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      }
      return el !== null
    })
  }
  const waitFor = async (desc, fn, check, timeout = 4000) => {
    const start = Date.now()
    for (;;) {
      const v = await fn()
      if (check(v)) {
        return v
      }
      if (Date.now() - start > timeout) {
        throw new Error(`等待超时：${desc}（实际 ${JSON.stringify(v)}）`)
      }
      await page.waitForTimeout(60)
    }
  }

  // ---- L1 继承父模式：装载 → 端口绑定 → 编辑器绘制层在场 ----
  await hoverPtr('live-wikilink', 'enter', 0)
  const bound = await waitFor('浮窗根装载并绑定 Live 端口', probe,
    (v) => v.open === true && v.liveBound === true && v.state === 'content')
  assert.equal(bound.internalMode, 'live', '父 Live 下浮窗根继承内部 Live')
  const dom1 = await waitFor('编辑器挂载并进入绘制', popupDom,
    (v) => v.editorPresent === true && v.editorVisible === true)
  assert.notEqual(dom1.liveDisplay, 'none', 'live 容器在场显示')
  assert.equal(dom1.contentDisplay, 'none', 'Reading 容器随内部 Live 隐藏')
  assert.equal(dom1.modeBtnVisible, true, '模式切换入口可见')
  assert.equal(dom1.saveBtnVisible, false, '干净目标保存入口不在场')
  assert.equal(dom1.closeBtnVisible, true, '端口在场时关闭入口可见')
  const editorBody = await editorText()
  assert.ok(editorBody.includes('目标笔记第 8 段正文。'), '编辑器装载目标全文')
  // bind occurrence = 引用位置语义键（跨开合记忆与来源固定身份）
  const bindMsg = (await sent()).filter((m) => m.kind === 'refEdit.bind').at(-1)
  assert.match(bindMsg.occurrence, /^hover@\d+::目标笔记$/,
    `bind occurrence 应为引用位置语义键（实际 ${bindMsg.occurrence}）`)
  // 浮窗根不进嵌入探针（有自己的 hoverPreview 探针）
  const embeds = await page.evaluate(() => window.hoverLiveEmbeds())
  assert.equal(embeds.length, 0, '浮窗根不污染嵌入卡片探针')
  // 浮窗高度随内部 Live 编辑器内容自适应（视觉验收回归：切 Live 后浮窗
  // 不得停留在 Reading 期测量高度把编辑器裁掉一截——编辑器高度也不得
  // 溢出 live 容器〔max-height:100% 对 auto 父无效的坑，inherit 承接〕）
  const liveGeom = () => page.evaluate(() => {
    const popup = document.querySelector('.vsidian-hover-popup')
    const liveEl = popup ? popup.querySelector('.vsidian-hover-popup-live') : null
    const ed = liveEl ? liveEl.querySelector('.cm-editor') : null
    if (!popup || !liveEl || !ed) return null
    const h = (el) => Math.round(el.getBoundingClientRect().height)
    return { popupH: h(popup), liveH: h(liveEl), edH: h(ed) }
  })
  let geom = null
  {
    const start = Date.now()
    for (;;) {
      geom = await liveGeom()
      if (geom && geom.edH > 0 && geom.edH <= geom.liveH + 2) break
      if (Date.now() - start > 4000) break
      await page.waitForTimeout(60)
    }
  }
  assert.ok(geom, '浮窗 Live 几何可测')
  assert.ok(geom.edH <= geom.liveH + 2,
    `Live 编辑器不得溢出 live 容器被裁（ed ${geom ? geom.edH : '?'} vs live ${geom ? geom.liveH : '?'}）`)
  assert.ok(geom.popupH >= 240 && geom.popupH <= 400,
    `浮窗高度应随 Live 内容自适应（实测 ${geom ? geom.popupH : '?'}，冻结在 Reading 期约 181 即缺陷）`)
  passed++
  console.log('[L1] 浮窗高度随内部 Live 自适应（无裁切、不冻结）通过')

  // ---- L2 真实键盘输入只写 B；dirty 圆点绘制层在场 ----
  await page.click('.vsidian-hover-popup-live .cm-content')
  await page.keyboard.press('End')
  await page.keyboard.type('【浮窗编辑】')
  await waitFor('dirty 推送到达', probe, (v) => v.liveDirty === true)
  const bAfter = await bModel()
  assert.ok(bAfter.content.includes('【浮窗编辑】'), '输入落入 B 权威文本')
  assert.ok(bAfter.dirty, 'B dirty')
  const dom2 = await popupDom()
  assert.equal(dom2.dotPresent, true, '未保存圆点在场')
  assert.equal(dom2.dotText, '·', '圆点为精确字符 ·')
  assert.equal(dom2.dotVisible, true, '圆点绘制层可见（非零盒）')
  assert.ok(typeof dom2.dotColor === 'string' && dom2.dotColor !== '',
    '圆点有计算色（警示色随主题变量）')
  assert.equal(dom2.saveBtnVisible, true, 'dirty 时保存入口在场')
  passed++
  console.log('[L2] 真实输入只写 B + 圆点绘制层通过')

  // ---- L3 dirty 保活：移出/失焦不销毁；保存后再离开正确重算关闭 ----
  await mouseLeavePopup()
  await page.waitForTimeout(CLOSE_WAIT)
  assert.equal((await probe()).open, true, 'dirty Live 移出后保活（Q18）')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForTimeout(120)
  assert.equal((await probe()).open, true, 'dirty Live 失焦后保活（切应用仍在）')
  // 保存（头部入口真实点击；与 Ctrl+S 焦点路由同一出站）
  await page.click('.vsidian-hover-popup .vsidian-hover-popup-save')
  await waitFor('保存落定 dirty 清零', probe, (v) => v.liveDirty !== true)
  const bSaved = await bModel()
  assert.ok(bSaved.savedCount >= 1, '保存出站到达宿主')
  assert.ok(bSaved.content.includes('【浮窗编辑】'), '保存保留编辑内容')
  const dom3 = await popupDom()
  assert.equal(dom3.dotPresent, false, '圆点随 dirty 清零消失')
  // 先输入后保存再离开：干净态恢复常规关闭（P2-A08 重算）
  await mouseLeavePopup()
  await waitFor('保存并离开后浮窗按常规关闭', probe, (v) => v.open !== true, CLOSE_WAIT + 600)
  passed++
  console.log('[L3] dirty 移出/失焦保活 + 保存后恢复常规关闭通过')

  // ---- L4 干净 Live：移出延迟关闭（与 Reading 同规）----
  await hoverPtr('live-wikilink', 'enter', 0)
  await waitFor('干净 Live 重开并绑定', probe, (v) => v.open === true && v.liveBound === true)
  await mouseLeavePopup()
  await page.waitForTimeout(CLOSE_WAIT)
  assert.equal((await probe()).open, false, '干净 Live 移出后按常规关闭（P2-U18）')
  passed++
  console.log('[L4] 干净 Live 普通关闭通过')

  // ---- L5 手动模式切换按引用位置跨开合记忆（第二条链接独立）----
  await hoverPtr('live-wikilink', 'enter', 1)
  await waitFor('第二条链接浮窗打开（默认继承 Live）', probe,
    (v) => v.open === true && v.state === 'content')
  // 切回 Reading（手动覆盖）：浮窗回内容视图、端口销毁
  await page.click('.vsidian-hover-popup .vsidian-hover-popup-mode')
  await waitFor('手动切回 Reading', probe, (v) => v.internalMode === 'reading' && v.liveBound !== true)
  const domR = await popupDom()
  assert.equal(domR.editorPresent, false, 'Reading 态无编辑器')
  assert.notEqual(domR.contentDisplay, 'none', 'Reading 容器显示')
  await mouseLeavePopup()
  await page.waitForTimeout(CLOSE_WAIT)
  assert.equal((await probe()).open, false, 'Reading 态按常规关闭')
  // 重开同链接：覆盖记忆生效（父 Live 但该位置手动 Reading）
  await hoverPtr('live-wikilink', 'enter', 1)
  const reopened = await waitFor('重开恢复手动 Reading', probe,
    (v) => v.open === true && v.state === 'content')
  assert.equal(reopened.internalMode, 'reading', '手动覆盖跨开合记忆（不随父级联回）')
  passed++
  console.log('[L5] 手动模式按引用位置跨开合记忆通过')

  // ---- L6 Esc 分层：选区收敛 → 空选区显式退出（干净）→ Reading 态关闭 ----
  // 第一条链接无手动覆盖（L3 保存路径不写覆盖），父 Live 继承
  await hoverPtr('live-wikilink', 'enter', 0)
  await waitFor('第一条链接 Live 绑定', probe, (v) => v.liveBound === true)
  await page.click('.vsidian-hover-popup-live .cm-content')
  await page.keyboard.press('End')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Home')
  await page.keyboard.up('Shift')
  await page.keyboard.press('Escape') // 非空选区：先收敛
  await page.waitForTimeout(150)
  assert.equal((await probe()).open, true, '收选区 Esc 不关浮窗')
  assert.equal((await popupDom()).editorPresent, true, '收选区 Esc 不退出编辑')
  await page.keyboard.press('Escape') // 空选区：显式退出（干净 → 直接完成）
  await waitFor('干净显式退出完成', popupDom, (v) => v.editorPresent === false)
  assert.equal((await probe()).open, true, 'keymap 径退出编辑后浮窗保留（回 Reading）')
  const domAfterEsc = await popupDom()
  assert.notEqual(domAfterEsc.contentDisplay, 'none', '退出编辑后 Reading 内容显示')
  await page.keyboard.press('Escape') // Reading 态：常规关闭浮窗
  await waitFor('Reading 态 Esc 关闭浮窗', probe, (v) => v.open !== true, 1500)
  passed++
  console.log('[L6] Esc 分层（选区收敛/空选区退出/Reading 关闭）通过')

  // ---- 收尾断言：无页面错误、无编辑器泄漏 ----
  assert.deepEqual(errors, [], '页面无未捕获错误')
  const editorCount = await page.evaluate(() => window.hoverLiveEditorCount())
  assert.equal(editorCount, 1, `浮窗关闭后仅剩主编辑器（实际 ${editorCount}）`)
  console.log(`hoverLive 全部通过（${passed} 组）`)
} finally {
  await browser.close()
}
