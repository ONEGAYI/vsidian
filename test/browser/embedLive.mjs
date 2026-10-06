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

  // ---- P2-05（#282）场景 I–N：显式关闭确认与输入保护（真实键盘与点击） ----
  // 父切回 Live + 手动覆盖切回 Live（H 后覆盖为 Reading——覆盖记忆不被父
  // 切换回滚，须手动切回），并制造 dirty（真实键入）
  await page.evaluate(() => window.setEmbedLiveMode('live'))
  await settle(250)
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(300)
  const preI = (await cards())[0]
  assert.equal(preI.internalMode, 'live', '场景 I 前置：手动切回内部 Live')
  assert.equal(preI.liveBound, true, '场景 I 前置：端口已绑定')
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, '焦点进嵌入编辑器')
  await page.keyboard.press('End')
  await page.keyboard.type('【关闭前】')
  await settle(300)
  assert.equal(await page.evaluate(() => window.embedDirtyDotPresent()), true, '场景 I 前置：目标 dirty（圆点在场）')

  // ---- 场景 I：真实 Esc 键触发关闭意图；模态绘制层与默认焦点取消 ----
  await page.keyboard.press('Escape')
  await settle(250)
  const dialogI = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogI.open, true, 'Esc 后三项模态在场')
  assert.ok(dialogI.text.includes('目标笔记.md'), '确认文字指明 B 文件名')
  assert.ok(dialogI.text.includes(zhCn['embed.closeSave']), '「保存并关闭」按钮文案在场')
  assert.ok(dialogI.text.includes(zhCn['embed.closeDiscard']), '「丢弃修改并关闭」按钮文案在场')
  assert.ok(dialogI.text.includes(zhCn['embed.closeDialogDiscardScope']), '文档级丢弃影响说明在场')
  assert.equal(dialogI.focusedAction, 'cancel', '默认焦点为取消')
  assert.equal(dialogI.backdropPainted, true, '遮罩绘制（fixed + 非透明背景）')
  assert.equal(dialogI.boxPainted, true, '对话框盒子绘制（背景 + 边框）')
  // 绘制层：保存/丢弃按钮真实可见（有背景色与尺寸）
  const btnPaint = await page.evaluate(() => {
    const save = document.querySelector('.vsidian-ref-close-save')
    const discard = document.querySelector('.vsidian-ref-close-discard')
    if (!(save instanceof HTMLElement) || !(discard instanceof HTMLElement)) {
      return null
    }
    return {
      saveVisible: save.getBoundingClientRect().height > 10 && getComputedStyle(save).backgroundColor !== 'rgba(0, 0, 0, 0)',
      discardVisible: discard.getBoundingClientRect().height > 10 && getComputedStyle(discard).backgroundColor !== 'rgba(0, 0, 0, 0)',
    }
  })
  assert.equal(btnPaint?.saveVisible, true, '保存按钮可见绘制')
  assert.equal(btnPaint?.discardVisible, true, '丢弃按钮可见绘制')

  // ---- 场景 J：模态期间外部修改 → stale 重新确认；丢弃携带新基线并回滚 ----
  const markJ = await mark()
  await page.evaluate(() => window.embedTargetExternalEdit(0, 0, '冲突外改 '))
  await settle(250)
  const dialogJ = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogJ.stale, true, '确认期间目标被修改 → stale 提示在场')
  assert.equal(dialogJ.noticePainted, true, 'stale 提示行绘制（警示左边条）')
  assert.ok(dialogJ.text.includes(zhCn['embed.closeStale']), 'stale 文案在场')
  assert.equal(await page.evaluate(() => window.embedDialogClick('discard')), true, '点击丢弃修改并关闭')
  await settle(300)
  const outboundJ = await sentAfter(markJ)
  const execJ = outboundJ.find((m) => m.kind === 'refEdit.close.execute')
  assert.ok(execJ && execJ.action === 'discard', '丢弃动作出站 execute(discard)')
  // 外改后的基线（外改 ver+1）——新基线不再 stale，回滚成功
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false, '关闭后模态不在场')
  const modelJ = await page.evaluate(() => window.embedTargetModel())
  assert.equal(modelJ.dirty, false, '丢弃后目标干净（整个 B 回滚）')
  assert.ok(!(modelJ.text).includes('冲突外改'), '外改内容随文档级丢弃回滚')
  assert.ok(!(modelJ.text).includes('【关闭前】'), '嵌入编辑内容随文档级丢弃回滚')
  // 卡片回 Reading（会话记忆）；编辑器销毁（泄漏观测）
  await settle(250)
  const cardJ = (await cards())[0]
  assert.equal(cardJ.internalMode, 'reading', '关闭后嵌入切回 Reading')
  assert.equal(cardJ.liveBound, false, '端口已释放')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 0, '嵌入编辑器已销毁')

  // ---- 场景 K：非空选区 Esc 先收选区不触发；再 Esc（空选区）才触发 ----
  await page.evaluate(() => window.clickEmbedModeButton()) // 切回 Live
  await settle(300)
  await page.evaluate(() => window.focusEmbedEditor())
  await page.keyboard.press('End')
  await page.keyboard.type('【K】')
  await settle(300)
  await page.keyboard.down('Shift')
  await page.keyboard.press('Home')
  await page.keyboard.up('Shift')
  const markK = await mark()
  await page.keyboard.press('Escape') // 非空选区：收选区
  await settle(200)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false,
    '非空选区 Esc 不触发关闭模态（先收选区）')
  await page.keyboard.press('Escape') // 空选区：触发
  await settle(250)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, true,
    '空选区 Esc 触发关闭模态')
  assert.equal(await page.evaluate(() => window.embedDialogClick('cancel')), true, '点击取消')
  await settle(200)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false, '取消后模态关闭')
  const cardK = (await cards())[0]
  assert.equal(cardK.internalMode, 'live', '取消保留现场（仍 Live 编辑）')
  assert.equal(cardK.liveBound, true, '取消保留端口')

  // ---- 场景 L：头部关闭按钮（真实点击）→ 保存并关闭（干净后无二次确认） ----
  const markL = await mark()
  assert.equal(await page.evaluate(() => window.clickEmbedCloseButton()), true, '点击头部关闭按钮')
  await settle(250)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, true, '按钮触发模态')
  assert.equal(await page.evaluate(() => window.embedDialogClick('save')), true, '点击保存并关闭')
  await settle(300)
  const outboundL = await sentAfter(markL)
  assert.ok(outboundL.some((m) => m.kind === 'refEdit.close.execute' && m.action === 'save'),
    '保存动作出站 execute(save)')
  const modelL = await page.evaluate(() => window.embedTargetModel())
  assert.equal(modelL.dirty, false, '保存并关闭后目标干净')
  assert.ok(modelL.text.includes('【K】'), '编辑内容已保存落盘（伪宿主模型）')
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false, '模态已关闭')
  const cardL = (await cards())[0]
  assert.equal(cardL.internalMode, 'reading', '关闭后回 Reading')

  // ---- 场景 M：保存失败保留现场（只读盘模拟 → save-failed 提示 + 模态在场） ----
  await page.evaluate(() => window.clickEmbedModeButton()) // 回 Live
  await settle(300)
  await page.evaluate(() => window.focusEmbedEditor())
  await page.keyboard.press('End')
  await page.keyboard.type('【M】')
  await settle(300)
  await page.evaluate(() => window.embedTargetSetSaveFail(true))
  await page.evaluate(() => window.clickEmbedCloseButton())
  await settle(250)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, true, '失败场景模态在场')
  await page.evaluate(() => window.embedDialogClick('save'))
  await settle(300)
  const dialogM = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogM.open, true, '保存失败保留现场（模态不关）')
  assert.ok(dialogM.text.includes(zhCn['embed.closeSaveFailed']), '保存失败提示行在场')
  const cardM = (await cards())[0]
  assert.equal(cardM.liveBound, true, '保存失败端口保留')
  // 恢复可写 → 保存并关闭成功
  await page.evaluate(() => window.embedTargetSetSaveFail(false))
  await page.evaluate(() => window.embedDialogClick('save'))
  await settle(300)
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false, '恢复后保存并关闭完成')
  const cardM2 = (await cards())[0]
  assert.equal(cardM2.internalMode, 'reading', '关闭后回 Reading')

  // ---- 场景 N：删除活跃引用拦截——A 不先写入、取消保留原引用、确认后完成 ----
  await page.evaluate(() => window.clickEmbedModeButton()) // 回 Live
  await settle(300)
  await page.evaluate(() => window.focusEmbedEditor())
  await page.keyboard.press('End')
  await page.keyboard.type('【N】')
  await settle(300)
  const textBeforeN = await page.evaluate(() => window.mainEditorText())
  await page.evaluate(() => window.embedDeleteRefLine())
  await settle(250)
  // 拦截：A 未变 + 模态在场（delete 意图）
  assert.equal(await page.evaluate(() => window.mainEditorText()), textBeforeN,
    '删除事务被拦截：A 原文未变（不把未确认删除先写入 A）')
  const dialogN = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogN.open, true, '删除意图触发模态')
  // 取消：A 原引用保留
  await page.evaluate(() => window.embedDialogClick('cancel'))
  await settle(200)
  assert.equal(await page.evaluate(() => window.mainEditorText()), textBeforeN, '取消后 A 原引用保留')
  // 再次删除 → 丢弃并关闭：A 中该删除完成 + B 回滚
  await page.evaluate(() => window.embedDeleteRefLine())
  await settle(250)
  await page.evaluate(() => window.embedDialogClick('discard'))
  await settle(400)
  const textAfterN = await page.evaluate(() => window.mainEditorText())
  assert.ok(!textAfterN.includes(EMBED_LINE), '确认后 A 中引用行删除完成')
  const modelN = await page.evaluate(() => window.embedTargetModel())
  assert.equal(modelN.dirty, false, '确认丢弃后 B 回滚干净')
  assert.ok(!(modelN.text).includes('【N】'), 'B 编辑内容随丢弃回滚')
  assert.equal(errors.length, 0, `P2-05 场景零页面错误（实际 ${JSON.stringify(errors)}）`)
  passed += 6
  console.log('[嵌入Live][PASS] I-N 显式关闭确认：Esc/按钮/删除拦截、stale 重确认、保存失败保留现场')

  // ---- #381 T06 场景组：内部 Live 双链联想（B 归属 / 同名文件 / Esc 优先级 /
  //      格内转义竖线 / 端口释放关闭）。重开干净页面（同文档重 init 的
  //      双容器 handle 残留属既有挂载机制，不进本组断言口径）----
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: 'html, body { margin: 0; height: 100%; } #app { height: 100vh; }' })
  await page.addStyleTag({ path: bundle.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: bundle })
  await settle(200)
  // 候选：两个同名文件按目录区分（伪宿主以来源目录计算相对路径——B 与 A
  // 同目录时同形态；B 内接受只写 B，A 字节不变）
  await page.evaluate((items) => window.embedSetWikilinkFiles(items), [
    { id: 'D:\\notes\\同名.md', name: '同名.md', dir: '', relPath: '同名.md',
      insertPath: '同名.md', alias: '同名', mtimeMs: 1000, score: 0, labelHighlights: [], dirHighlights: [] },
    { id: 'D:\\notes\\子目录\\同名.md', name: '同名.md', dir: '子目录', relPath: '子目录/同名.md',
      insertPath: '子目录/同名.md', alias: '同名', mtimeMs: 2000, score: 0, labelHighlights: [], dirHighlights: [] },
  ])
  const T06_PARENT = [
    '# T06 父文档',
    '',
    EMBED_LINE,
    '',
    '| 单元格 | 说明 |',
    '| --- | --- |',
    '| [[ ]] | t |',
    '',
  ].join('\n')
  await page.evaluate((text) => window.initEmbedLiveDoc(text), T06_PARENT)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(400)
  const t06Card = (await cards())[0]
  assert.equal(t06Card.internalMode, 'live', 'T06 父 Live：嵌入自动进入内部 Live')

  // O1：B 内真实键盘触发候选——出站经 B 端口信封、docUri/sessionId = B
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, '焦点进嵌入编辑器')
  const markO = await mark()
  await page.keyboard.press('End')
  await page.keyboard.type('[[t')
  await settle(350)
  const wikReqsO = await page.evaluate(() => window.embedWikilinkRequests())
  const lastQ = wikReqsO.at(-1)
  assert.ok(lastQ && lastQ.message.kind === 'wikilink.query', 'B 内输入触发双链查询出站')
  assert.ok(typeof lastQ.portId === 'string' && lastQ.portId.length > 0,
    '查询经 B 端口信封（refEdit.message）出站——portId 为目标端口')
  assert.equal(lastQ.message.docUri, 'file:///d%3A/notes/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md',
    '查询目标戳记 = B 规范 URI（不是 A）')
  assert.equal(lastQ.message.query, 't', '查询为光标左侧前缀')
  const suggestO = await page.evaluate(() => window.embedSuggestState())
  assert.equal(suggestO.open, true, '候选浮层实际可见（绘制层）')
  assert.equal(suggestO.itemCount, 2, '同名文件两项全部展示（目录区分）')
  // ↓ 选子目录项 → Enter 确认：B 写入、A 字节不变
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await settle(300)
  const modelO = await page.evaluate(() => window.embedTargetModel())
  assert.ok(modelO.text.includes('[[子目录/同名.md|同名]]'),
    'B 权威文本收到确认链接（insertPath 以 B 为来源）')
  const mainTextO = await page.evaluate(() => window.mainEditorText())
  assert.equal(mainTextO, T06_PARENT, 'A 主文档字节不变（接受不写 A）')
  const sentO = await sentAfter(markO)
  assert.ok(sentO.some((m) => m.kind === 'refEdit.message' && m.message.kind === 'edit.request'),
    '确认编辑经 B 端口出站 edit.request')
  passed++
  console.log('[嵌入Live][PASS] O1 B 内联想：端口信封出站 + 同名候选 + 确认只写 B')

  // O2：Esc 优先级——候选在场时第一次 Esc 只关列表（卡片不关、无模态），
  //     第二次 Esc 才进入嵌入关闭链（B dirty → 确认模态）
  await page.keyboard.press('End')
  await page.keyboard.type('[[')
  await settle(350)
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, true, '第二次会话候选在场')
  await page.keyboard.press('Escape')
  await settle(200)
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, false, 'Esc 先关候选列表')
  assert.equal((await page.evaluate(() => window.embedCloseDialogState())).open, false, '不直接触发关闭模态')
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '嵌入编辑器仍在（卡片未关）')
  await page.keyboard.press('Escape')
  await settle(250)
  const dialogO2 = await page.evaluate(() => window.embedCloseDialogState())
  assert.equal(dialogO2.open, true, '第二次 Esc 进入嵌入关闭链（B dirty 弹确认模态）')
  await page.evaluate(() => window.embedDialogClick('cancel'))
  await settle(200)
  passed++
  console.log('[嵌入Live][PASS] O2 Esc 优先级：候选先关、下一次 Esc 才走引用关闭链')

  // O3：B 内表格格内联想——别名竖线按 \\| 转义（网格完整）
  await page.evaluate(() => {
    // B 全文换成含表格的文本（外部增量：其他视图整文替换——生产语义）；
    // 第三格预置闭合空围栏 [[ ]]，光标进目标区输入触发
    const tableText = '| a | b |\n| --- | --- |\n| [[ ]] | y |'
    const model = window.embedTargetModel()
    window.embedTargetExternalEdit(0, model.text.length, tableText)
  })
  await settle(300)
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, 'O3 焦点进嵌入编辑器')
  await page.evaluate(() => {
    const editorText = window.embedEditorText()
    const at = editorText.indexOf('| [[ ]] | y |') + 4
    window.selectEmbedRange(at, at)
  })
  await page.keyboard.type('t')
  await settle(350)
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, true, 'B 表格格内候选打开')
  await page.keyboard.press('Enter')
  await settle(300)
  const editorO3 = await page.evaluate(() => window.embedEditorText())
  assert.ok(editorO3.includes('| [[同名.md\\|同名]] | y |'),
    '格内确认写转义竖线（\\| 两字符），网格不被裸管破坏')
  passed++
  console.log('[嵌入Live][PASS] O3 B 表格格内：转义竖线确认不破坏网格')

  // O4：A 主表格格内联想（主会话路径，非信封）+ 转义竖线
  await page.evaluate(() => window.embedSetWikilinkFiles([
    { id: 'D:\\notes\\同名.md', name: '同名.md', dir: '', relPath: '同名.md',
      insertPath: '同名.md', alias: '同名', mtimeMs: 1000, score: 0, labelHighlights: [], dirHighlights: [] },
  ]))
  assert.equal(await page.evaluate(() => window.focusMain()), true, '焦点回主编辑器 A')
  await page.evaluate(() => {
    const text = window.mainEditorText()
    const at = text.indexOf('| [[ ]] | t |') + 4
    window.mainLocate(at)
  })
  await page.keyboard.type('x')
  await settle(350)
  const wikReqsO4 = await page.evaluate(() => window.embedWikilinkRequests())
  const lastQ4 = wikReqsO4.at(-1)
  assert.ok(lastQ4 && lastQ4.message.kind === 'wikilink.query' && lastQ4.portId === '',
    'A 主表格格内查询走主会话（非端口信封）')
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, true, 'A 格内候选打开')
  await page.keyboard.press('Enter')
  await settle(300)
  const mainO4 = await page.evaluate(() => window.mainEditorText())
  assert.ok(mainO4.includes('| [[同名.md\\|同名]] | t |'),
    'A 表格格内确认同样写转义竖线')
  passed++
  console.log('[嵌入Live][PASS] O4 A 主表格格内：主会话路径 + 转义竖线')

  // O5：切 Reading 释放端口——实例销毁、候选浮层消失（释放后迟到拒收的
  //     行为面：实例不在场，notifyPush 查不到端口即丢弃）
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true)
  await page.evaluate(() => {
    // 光标进 B 第三行格 1（y 内）——干净格内输入触发（格 0 已有确认链接）
    const t = window.embedEditorText()
    const at = t.indexOf('| y |') + 3
    window.selectEmbedRange(at, at)
  })
  await page.keyboard.type('[[')
  await settle(350)
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, true, '释放前候选在场')
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(400)
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 0, '切 Reading 后嵌入实例销毁')
  assert.equal((await page.evaluate(() => window.embedSuggestState())).open, false, '端口释放后候选浮层消失')
  assert.equal((await cards())[0].liveBound, false, '端口已释放（teardown 出站 unbind）')
  assert.equal(errors.length, 0, `T06 场景零页面错误（实际 ${JSON.stringify(errors)}）`)
  passed++
  console.log('[嵌入Live][PASS] O5 切 Reading：端口释放、实例与候选浮层销毁')

  console.log(`embedLive：${passed} 场景通过`)
} finally {
  await browser.close()
}
