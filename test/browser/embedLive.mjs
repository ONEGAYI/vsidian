// P2-04（#281）嵌入内部 Live 的原生浏览器回归：真实 Chromium 布局下经生产
// 控制器 + 真实 DocumentSession（B 侧纯逻辑在 fixture 内驱动）验证——
// 端口绑定与编辑器创建、真实键盘输入经 refEdit.message 只写 B、ack 收敛、
// 外部增量同步、Ctrl+S 焦点路由（嵌入内拦截 / 回 A 放行）、Ctrl+Z 走 B
// 历史、模式继承与覆盖记忆、dirty 圆点与保存入口、编辑器无泄漏。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'embedLive/embedLive.js')
await build({ entryPoints: [path.join(root, 'test/browser/embedLiveFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const EMBED_LINE = '![[目标笔记]]'
const PARENT_DOC = [
  '# 嵌入内部 Live 父文档',
  '',
  '开篇正文段。',
  '',
  EMBED_LINE,
  '',
  '中间段落。',
  '',
  '尾部段落。',
  '',
].join('\n')

const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

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

  const settle = (ms = 200) => page.waitForTimeout(ms)
  const cards = () => page.evaluate(() => window.embedLiveCards())
  const sentAfter = async (mark) => {
    const all = await page.evaluate(() => window.embedLiveSent())
    return all.slice(mark)
  }
  const mark = async () => (await page.evaluate(() => window.embedLiveSent())).length

  // ---- 场景 A：Live 父默认继承 → 装载后自动绑定端口并创建编辑器 ----
  await page.evaluate((text) => window.initEmbedLiveDoc(text), PARENT_DOC)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(300)
  const cardA = (await cards())[0]
  assert.equal(cardA.internalMode, 'live', '父 Live 下未覆盖嵌入继承内部 Live')
  assert.equal(cardA.liveBound, true, '装载完成后端口已绑定（伪宿主回 bound+init）')
  assert.ok(typeof cardA.livePortId === 'string' && cardA.livePortId.length > 0, 'portId 在场')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '卡片内恰一个嵌入编辑器')
  assert.equal(await page.evaluate(() => window.embedLiveEditorCount()), 2, '全文档恰两个 CM6 编辑器（主 + 嵌入）')
  const editorTextA = await page.evaluate(() => window.embedEditorText())
  assert.ok(editorTextA.includes('目标笔记标题'), '嵌入编辑器装载目标全文')
  // 绘制层：编辑器容器可见且内容视图让位
  const visible = await page.evaluate(() => {
    const live = document.querySelector('.vsidian-embed-card-live')
    const reading = document.querySelector('.vsidian-embed-card-scroll .vsidian-view-reading')
    return {
      liveVisible: !!live && getComputedStyle(live).display !== 'none',
      liveHeight: live?.getBoundingClientRect().height ?? 0,
      readingHidden: !!reading && getComputedStyle(reading).display === 'none',
      modeTooltip: document.querySelector('.vsidian-embed-card-mode')?.getAttribute('data-tooltip') ?? '',
    }
  })
  assert.equal(visible.liveVisible, true, '内部 Live 容器可见')
  assert.ok(visible.liveHeight > 40, `编辑器有真实高度（实际 ${visible.liveHeight}）`)
  assert.equal(visible.readingHidden, true, 'Reading 内容视图让位（隐藏）')
  assert.equal(visible.modeTooltip, zhCn['embed.modeToReading'], '模式按钮悬停词指向另一态')
  assert.equal(await page.evaluate(() => window.embedDirtyDotPresent()), false, '目标干净时无圆点')
  passed++
  console.log('[嵌入Live][PASS] A 父 Live 默认继承：自动绑定 + 编辑器创建与绘制层')

  // ---- 场景 B：真实键盘输入只写 B（refEdit.message 出站，A 零写回） ----
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, '焦点进嵌入编辑器')
  const markB = await mark()
  await page.keyboard.type('X')
  await settle(250)
  const outboundB = await sentAfter(markB)
  const editMsg = outboundB.find((m) => m.kind === 'refEdit.message' &&
    m.message.kind === 'edit.request')
  assert.ok(editMsg, '键入经 refEdit.message(edit.request) 出站')
  assert.equal(editMsg.message.changes[0].text, 'X', '出站载荷为键入文本')
  const modelB = await page.evaluate(() => window.embedTargetModel())
  assert.ok(modelB.text.includes('X目标笔记标题') || modelB.text.includes('X'),
    'B 模型收到修改（真实 DocumentSession applyChanges）')
  assert.equal(modelB.dirty, true, 'B 模型 dirty')
  const mainTextB = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainTextB, PARENT_DOC, 'A 主文档零写回')
  assert.equal(await page.evaluate(() => window.embedDirtyDotPresent()), true, 'dirty 推送后圆点在场')
  assert.equal(await page.evaluate(() => window.embedSaveBtnVisible()), true, '保存入口可见')
  passed++
  console.log('[嵌入Live][PASS] B 真实键入只写 B：refEdit.message + dirty 圆点')

  // ---- 场景 C：外部增量同步（B 其他视图修改 → 增量推送无回声） ----
  const markC = await mark()
  await page.evaluate(() => window.embedTargetExternalEdit(0, 0, '前缀 '))
  await settle(250)
  const editorTextC = await page.evaluate(() => window.embedEditorText())
  assert.ok(editorTextC.startsWith('前缀 '), '外部增量应用到嵌入编辑器')
  const outboundC = await sentAfter(markC)
  assert.equal(outboundC.some((m) => m.kind === 'refEdit.message'), false,
    '外部增量应用不回发（无回声）')
  passed++
  console.log('[嵌入Live][PASS] C 外部增量同步：应用且零回声')

  // ---- 场景 D：Ctrl+S 焦点路由（嵌入内拦截出站 save；回 A 放行） ----
  await page.evaluate(() => window.focusEmbedEditor())
  const markD = await mark()
  await page.keyboard.press('Control+s')
  await settle(200)
  let outboundD = await sentAfter(markD)
  assert.ok(outboundD.some((m) => m.kind === 'refEdit.save'),
    '焦点在嵌入内 Ctrl+S 出站 refEdit.save（只保存目标）')
  const modelD = await page.evaluate(() => window.embedTargetModel())
  assert.equal(modelD.saved, 1, '目标保存执行恰一次')
  assert.equal(modelD.dirty, false, '保存后目标干净')
  await settle(150)
  assert.equal(await page.evaluate(() => window.embedDirtyDotPresent()), false, '保存后圆点消失')
  // 焦点回 A：Ctrl+S 不再被嵌入路由拦截（无新 refEdit.save）
  const markD2 = await mark()
  assert.equal(await page.evaluate(() => window.focusMainEditor()), true, '焦点回 A 主编辑器')
  await page.keyboard.press('Control+s')
  await settle(150)
  outboundD = await sentAfter(markD2)
  assert.equal(outboundD.some((m) => m.kind === 'refEdit.save'), false,
    '焦点回 A 后 Ctrl+S 不出站 refEdit.save（宿主默认保存 A）')
  passed++
  console.log('[嵌入Live][PASS] D Ctrl+S 焦点路由：嵌入内保存目标、回 A 放行')

  // ---- 场景 E：嵌入内 Ctrl+Z 走 B 历史（键入回退，A 不动） ----
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, '焦点回嵌入编辑器')
  const markE = await mark()
  await page.keyboard.press('Control+z')
  await settle(300)
  const outboundE = await sentAfter(markE)
  assert.ok(outboundE.some((m) => m.kind === 'refEdit.message' &&
    m.message.kind === 'history.request'),
    '嵌入内 Ctrl+Z 经 refEdit.message(history.request) 走 B 历史')
  const editorTextE = await page.evaluate(() => window.embedEditorText())
  assert.ok(!editorTextE.includes('X目标笔记标题'), '撤销回退了 B 的键入（逆增量回流）')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC, 'A 主文档零波及')
  passed++
  console.log('[嵌入Live][PASS] E 嵌入内撤销走 B 历史、A 零波及')

  // ---- 场景 F：手动切回 Reading——端口释放、编辑器销毁、内容视图恢复 ----
  const markF = await mark()
  assert.equal(await page.evaluate(() => window.clickEmbedModeButton()), true, '点击模式切换按钮')
  await settle(250)
  const outboundF = await sentAfter(markF)
  assert.ok(outboundF.some((m) => m.kind === 'refEdit.unbind'), '切回 Reading 出站 refEdit.unbind')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 0, '卡片内编辑器销毁')
  assert.equal(await page.evaluate(() => window.embedLiveEditorCount()), 1, '全文档仅剩主编辑器（无泄漏）')
  const cardF = (await cards())[0]
  assert.equal(cardF.internalMode, 'reading', '手动覆盖为 Reading')
  const visibleF = await page.evaluate(() => {
    const reading = document.querySelector('.vsidian-embed-card-scroll .vsidian-view-reading')
    return { readingVisible: !!reading && getComputedStyle(reading).display !== 'none',
      text: (document.querySelector('.vsidian-embed-card-scroll')?.textContent ?? '') }
  })
  assert.equal(visibleF.readingVisible, true, 'Reading 内容视图恢复可见')
  assert.ok(visibleF.text.includes('目标笔记标题'), '内容视图呈现目标内容')
  passed++
  console.log('[嵌入Live][PASS] F 手动切回 Reading：unbind + 编辑器销毁 + 内容恢复')

  // ---- 场景 G：覆盖记忆——父切 Reading/Live 往返，手动 Reading 不被回滚 ----
  await page.evaluate(() => window.setEmbedLiveMode('reading'))
  await settle(200)
  let cardG = (await cards())[0]
  assert.equal(cardG.internalMode, 'reading', '父切 Reading：手动覆盖保持 Reading')
  await page.evaluate(() => window.setEmbedLiveMode('live'))
  await settle(200)
  cardG = (await cards())[0]
  assert.equal(cardG.internalMode, 'reading', '父切回 Live：手动覆盖仍保持 Reading（不被回滚）')
  assert.equal(await page.evaluate(() => window.embedLiveEditorCount()), 1, '覆盖 Reading 下无嵌入编辑器')
  // 手动切回 Live → 重新绑定（端口重建）
  const markG = await mark()
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(250)
  const outboundG = await sentAfter(markG)
  assert.ok(outboundG.some((m) => m.kind === 'refEdit.bind'), '手动切 Live 重新绑定端口')
  const cardG2 = (await cards())[0]
  assert.equal(cardG2.liveBound, true, '重绑后端口在场')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '编辑器重建')
  passed++
  console.log('[嵌入Live][PASS] G 覆盖记忆与重绑')

  // ---- 场景 H：默认继承反向——父 Reading 时新装载嵌入为 Reading（无端口） ----
  await page.evaluate(() => window.setEmbedLiveMode('reading'))
  await settle(200)
  const markH = await mark()
  // 手动切 Reading（清覆盖为跟随态的另一路径：先 Live 再 Reading 已覆盖 G；
  // 此处验证父 Reading + 当前覆盖 live 的条目切回后跟随 Reading）
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(250)
  const cardH = (await cards())[0]
  assert.equal(cardH.internalMode, 'reading', '父 Reading + 手动切回 → Reading')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 0, '无嵌入编辑器')
  assert.equal(errors.length, 0, `零页面错误（实际 ${JSON.stringify(errors)}）`)
  passed++
  console.log('[嵌入Live][PASS] H 父 Reading 跟随 + 零页面错误')

  console.log(`embedLive：${passed} 场景通过`)
} finally {
  await browser.close()
}
