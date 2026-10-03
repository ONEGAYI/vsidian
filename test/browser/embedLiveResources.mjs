// P2-11（#288）嵌入内部 Live 的目标资源接线——原生 Chromium 回归：真实
// 布局下经生产控制器 + 伪造资源宿主验证：B 身份图片解析（信封请求与定向
// 回包）、渲染态链接/双链点击经端口信封、图片粘贴按 B 身份出站并只在 B
// 插入（释放后迟到结果不写）、工具栏刷新经端口换新 URI 重载、图片弹窗按
// 实例上下文装载与导出（sourceDocUri）。粘贴落盘磁盘位置与真宿主 B 会话
// 语义在集成层（1.82.3）覆盖。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'embedLiveResources/embedLiveResources.js')
await build({ entryPoints: [path.join(root, 'test/browser/embedLiveResourcesFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const EMBED_LINE = '![[目标笔记]]'
const PARENT_DOC = [
  '# 嵌入资源父文档',
  '',
  '开篇正文段。',
  '',
  EMBED_LINE,
  '',
  '尾部段落。',
  '',
].join('\n')

const PASTE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const { islandHtml } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })

  const settle = (ms = 250) => page.waitForTimeout(ms)
  const cards = () => page.evaluate(() => window.embedLiveCards())
  const mark = async () => (await page.evaluate(() => window.embedLiveSent())).length
  const sentAfter = async (mark) => {
    const all = await page.evaluate(() => window.embedLiveSent())
    return all.slice(mark)
  }
  const resourceLog = () => page.evaluate(() => window.embedResourceLog())

  await page.evaluate((text) => window.initEmbedLiveDoc(text), PARENT_DOC)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(300)
  const cardA = (await cards())[0]
  assert.equal(cardA.internalMode, 'live', '父 Live 下嵌入继承内部 Live')
  assert.equal(cardA.liveBound, true, '端口已绑定')
  const portId = cardA.livePortId
  assert.ok(typeof portId === 'string' && portId.length > 0)

  // ---- 场景 A：B 身份图片解析——信封请求 + 定向回包 + 绘制层 loaded ----
  await page.evaluate(() => window.focusEmbedAtEnd())
  await page.locator('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img').first().waitFor({ timeout: 5000 })
  await settle(200)
  const slotsA = await page.evaluate(() => window.embedImageSlots())
  const imageSlot = slotsA.find((s) => s.src === 'only-in-b.png')
  assert.ok(imageSlot, `嵌入内图片槽位在场（实际 ${JSON.stringify(slotsA)}）`)
  assert.equal(imageSlot.state, 'loaded', 'B 图经宿主回包装载完成（绘制层状态）')
  const sentA = await page.evaluate(() => window.embedLiveSent())
  const imageEnv = sentA.find((m) => m.kind === 'refEdit.message' && m.message.kind === 'image.request')
  assert.ok(imageEnv, 'image.request 经 refEdit.message 信封出站')
  assert.equal(imageEnv.message.docUri.includes('%E7%9B%AE%E6%A0%87'), true,
    '信封内 docUri 为 B 的规范 URI（宿主 B 会话按自身守卫）')
  passed++
  console.log('[嵌入资源][PASS] A B 身份图片解析：信封请求 + 定向回包 + loaded 绘制')

  // ---- 场景 B：渲染态链接与双链 Ctrl+点击 → 端口信封（B 解析语境） ----
  await page.evaluate(() => window.focusEmbedAtEnd())
  const linkBox = await page.locator('.vsidian-embed-card [data-vsidian-rendered-link="true"]').first().boundingBox()
  assert.ok(linkBox, '渲染态链接在场')
  await page.mouse.move(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2)
  await page.mouse.down({ ctrlKey: true })
  await page.mouse.up({ ctrlKey: true })
  await settle(150)
  let log = await resourceLog()
  const linkEntry = log.find((r) => r.kind === 'link.activate')
  assert.ok(linkEntry, '宿主收到链接意图（经端口）')
  assert.equal(linkEntry.detail.href, 'inner-target.md', '链接 href 原文')
  assert.equal(linkEntry.detail.docUri.includes('%E7%9B%AE%E6%A0%87'), true, '链接意图携带 B 身份 docUri')

  const wikilinkBox = await page.locator('.vsidian-embed-card [data-vsidian-rendered-wikilink="true"]').first().boundingBox()
  assert.ok(wikilinkBox, '渲染态双链在场')
  await page.mouse.move(wikilinkBox.x + wikilinkBox.width / 2, wikilinkBox.y + wikilinkBox.height / 2)
  await page.mouse.down({ ctrlKey: true })
  await page.mouse.up({ ctrlKey: true })
  await settle(150)
  log = await resourceLog()
  const wikilinkEntry = log.find((r) => r.kind === 'wikilink.activate')
  assert.ok(wikilinkEntry, '宿主收到双链意图（经端口）')
  assert.equal(wikilinkEntry.detail.target, 'B内双链', '双链 target 原文（| 之前）')
  passed++
  console.log('[嵌入资源][PASS] B 渲染态链接/双链 Ctrl+点击：经端口信封携带 B 身份')

  // ---- 场景 C：图片粘贴按 B 身份出站，结果只在 B 插入 ----
  await page.evaluate(() => window.focusEmbedAtEnd())
  const markC = await mark()
  await page.evaluate(([mime, data]) => window.embedTestPasteImage(mime, data),
    ['image/png', PASTE_PNG_BASE64])
  await settle(400)
  const outboundC = await sentAfter(markC)
  const pasteEnv = outboundC.find((m) => m.kind === 'refEdit.message' && m.message.kind === 'image.paste')
  assert.ok(pasteEnv, '粘贴经 refEdit.message 信封出站')
  assert.equal(pasteEnv.message.mime, 'image/png', '粘贴载荷 mime')
  assert.equal(pasteEnv.message.docUri.includes('%E7%9B%AE%E6%A0%87'), true, '粘贴携带 B 身份 docUri（落盘按 B）')
  // 落盘结果回包 → 编辑器插入 markdown（经标准 edit.request → B 模型）
  const editorC = await page.evaluate(() => window.embedEditorText())
  assert.ok(editorC.includes('assets/pasted-b.png'), '插入文本在嵌入编辑器（B）')
  const modelC = await page.evaluate(() => window.embedTargetModel())
  assert.ok(modelC.text.includes('assets/pasted-b.png'), 'B 权威模型收到插入')
  assert.equal(modelC.dirty, true, 'B 模型 dirty')
  const mainC = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainC, PARENT_DOC, 'A 主文档零写回')
  passed++
  console.log('[嵌入资源][PASS] C 图片粘贴：B 身份出站 + 只在 B 插入 + A 零写回')

  // ---- 场景 D：释放后的迟到粘贴结果不写任何实例 ----
  await page.evaluate(() => window.embedSetPasteReply({ drop: true, ok: true }))
  await page.evaluate(() => window.focusEmbedAtEnd())
  await page.evaluate(([mime, data]) => window.embedTestPasteImage(mime, data),
    ['image/png', PASTE_PNG_BASE64])
  await settle(150)
  // 宿主侧记录了这次粘贴（reqId 在途），但不回包（drop）；发起方随即释放
  // 端口（切 Reading → unbind）——随后模拟「宿主已在途」的迟到回包
  const pasteLogD = (await resourceLog()).filter((r) => r.kind === 'image.paste')
  const lastPaste = pasteLogD[pasteLogD.length - 1]
  assert.ok(lastPaste, '释放前的粘贴已到达宿主（reqId 在途）')
  const staleReqId = lastPaste.detail.reqId
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(300)
  const cardsD = (await cards())[0]
  assert.equal(cardsD.internalMode, 'reading', '切回 Reading（端口释放）')
  const afterD = await page.evaluate(() => window.embedEditorText())
  assert.equal(afterD, '', 'Reading 态无编辑器（实例销毁）')
  // 迟到结果直推（同 portId + 真实在途 reqId）：不写任何目标（无编辑器可
  // 插、不写 A）
  await page.evaluate(({ port, reqId, markdown }) =>
    window.respondEmbedLiveResourcePush(port, reqId, markdown),
  { port: portId, reqId: staleReqId, markdown: '![stale](stale.png)' })
  await settle(200)
  const mainD = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainD, PARENT_DOC, '迟到结果不写 A')
  await page.evaluate(() => window.embedSetPasteReply({ drop: false, ok: true, markdown: '![image](assets/pasted-b.png)' }))
  passed++
  console.log('[嵌入资源][PASS] D 释放后迟到粘贴结果零写入')

  // ---- 场景 E：工具栏刷新经端口广播——B 图换新 URI 实际重载 ----
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(400)
  await page.locator('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img').first().waitFor({ timeout: 5000 })
  const srcBefore = await page.evaluate(() =>
    document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img')?.getAttribute('src') ?? '')
  const markE = await mark()
  await page.evaluate(() => window.clickToolbarRefresh())
  await settle(500)
  const outboundE = await sentAfter(markE)
  const refreshEnv = outboundE.find((m) => m.kind === 'refEdit.message' && m.message.kind === 'refresh.request')
  assert.ok(refreshEnv, '工具栏刷新经端口广播 refresh.request（B 会话清缓存推进代次）')
  await page.locator('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img').first().waitFor({ timeout: 5000 })
  await settle(250)
  const srcAfter = await page.evaluate(() =>
    document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img')?.getAttribute('src') ?? '')
  assert.notEqual(srcAfter, srcBefore, `刷新后 B 图换新代次 URI（前 ${srcBefore} 后 ${srcAfter}）`)
  const slotsE = await page.evaluate(() => window.embedImageSlots())
  assert.equal(slotsE.find((s) => s.src === 'only-in-b.png')?.state, 'loaded', '刷新后回到 loaded')
  passed++
  console.log('[嵌入资源][PASS] E 工具栏刷新：经端口广播换新 URI 实际重载')

  // ---- 场景 F：图片弹窗按实例上下文装载，导出携带 B 来源 ----
  await page.evaluate(() => window.focusEmbedAtEnd())
  await page.locator('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img').first().waitFor({ timeout: 5000 })
  assert.equal(await page.evaluate(() => window.clickEmbedImagePopupButton()), true, '嵌入内图片弹窗按钮点击')
  await page.locator('.vsidian-diagram-overlay img').first().waitFor({ timeout: 5000 })
  await settle(250)
  const popupF = await page.evaluate(() => window.embedImagePopupState())
  assert.equal(popupF.open, true, '图片弹窗打开（互斥单例）')
  // 弹窗装载 B 管理器已解析的地址（与 Live 槽位同一资源状态机——data URL
  // 即 B 侧宿主解析产物；按 A 解析的管理器不持有该地址）
  const liveSrcF = await page.evaluate(() =>
    document.querySelector('.vsidian-embed-card .vsidian-embed-card-live .vsidian-image img')?.getAttribute('src') ?? '')
  assert.ok(popupF.src.startsWith('data:image/svg+xml') && popupF.src === liveSrcF,
    `弹窗装载 B 解析地址且与 Live 槽位同源（弹窗 ${popupF.src.slice(0, 40)}… / 槽位 ${liveSrcF.slice(0, 40)}…）`)
  assert.equal(popupF.state, 'loaded', '弹窗内 B 图 loaded')
  const logBeforeF = (await resourceLog()).length
  assert.equal(await page.evaluate(() => window.clickImagePopupExport()), true, '弹窗导出钮点击')
  await settle(200)
  const logF = (await resourceLog()).slice(logBeforeF)
  const exportEntry = logF.find((r) => r.kind === 'image.export')
  assert.ok(exportEntry, '导出经 A 面板通道出站')
  assert.equal(exportEntry.detail.sourceDocUri, 'D:\\notes\\目标笔记.md', '导出携带 B 来源（宿主按 B 目录定位文件）')
  await page.keyboard.press('Escape')
  await settle(150)
  assert.equal((await page.evaluate(() => window.embedImagePopupState())).open, false, 'Esc 关闭弹窗')
  passed++
  console.log('[嵌入资源][PASS] F 图片弹窗实例上下文：B 地址装载 + B 来源导出')

  assert.deepEqual(errors, [], '页面零未捕获异常')
  console.log(`[嵌入资源] 全部 ${passed} 场景通过`)
} finally {
  await browser.close()
}
