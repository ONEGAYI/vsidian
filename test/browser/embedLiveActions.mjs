// P2-10（#287）引用完整 Live 操作与实例焦点分派的原生浏览器回归：真实
// Chromium 键盘/指针驱动生产控制器——格式快捷键、右键统一菜单、多光标、
// 表格命令、查找入口吞掉、显式关闭与冲突放弃（sync.request → resync 恢复）
// 在嵌入内部 Live 中指向实际目标 B；焦点回 A 后恢复 A 操作；A 主文能力
// 不被嵌入接线破坏（主文 ctrl+b 仍写 A）。
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
  '# 完整 Live 操作父文档',
  '',
  '开篇正文段。',
  '',
  EMBED_LINE,
  '',
  '尾部段落。',
  '',
].join('\n')

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

  const settle = (ms = 200) => page.waitForTimeout(ms)
  const sent = () => page.evaluate(() => window.embedLiveSent())

  // 装载：Live 父 → 嵌入继承内部 Live 并绑定端口
  await page.evaluate((text) => window.initEmbedLiveDoc(text), PARENT_DOC)
  await page.locator('.vsidian-embed-card').first().waitFor({ timeout: 5000 })
  await settle(300)
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '嵌入编辑器在场')
  assert.equal(await page.evaluate(() => window.focusEmbedEditor()), true, '焦点进嵌入编辑器')

  // ---- 场景 A：嵌入内真实 Ctrl+B（格式快捷键落 B，A 不变） ----
  // 目标文本首段「目标笔记第 1 段正文。」的「目标笔记第 1」段（标题后）
  const textA = await page.evaluate(() => window.embedEditorText())
  const wordA = '目标笔记第 1'
  const fromA = textA.indexOf(wordA)
  assert.ok(fromA > 0, '目标文本含待加粗片段')
  assert.equal(await page.evaluate(([f, t]) => window.selectEmbedRange(f, t), [fromA, fromA + wordA.length]), true)
  await page.keyboard.press('Control+b')
  await settle(250)
  const afterA = await page.evaluate(() => window.embedEditorText())
  assert.ok(afterA.includes(`**${wordA}**`), 'B 文本被加粗（格式快捷键落 B）')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC, 'A 主文零写回')
  const outboundA = (await sent()).filter((m) => m.kind === 'refEdit.message')
  assert.ok(outboundA.some((m) => m.message.kind === 'edit.request' &&
    m.message.changes.some((c) => c.text.includes(`**${wordA}**`))), '加粗经 refEdit.message(edit.request) 出站')
  passed++
  console.log('[嵌入Live操作][PASS] A 嵌入内 Ctrl+B：格式快捷键写 B、A 零写回')

  // ---- 场景 B：嵌入内真实右键 → 统一菜单 → bold 命令落 B ----
  const textB = await page.evaluate(() => window.embedEditorText())
  const wordB = '段正文。'
  const fromB = textB.indexOf(wordB)
  assert.equal(await page.evaluate(([f, t]) => window.selectEmbedRange(f, t), [fromB, fromB + wordB.length]), true)
  await page.locator('.vsidian-embed-card .cm-content').first().click({ button: 'right' })
  await page.locator('.vsidian-context-menu').waitFor({ timeout: 3000 })
  assert.equal(await page.locator('.vsidian-context-menu').count(), 1, '统一菜单在场（全局唯一）')
  const menuVisible = await page.evaluate(() => {
    const menu = document.querySelector('.vsidian-context-menu')
    return menu instanceof HTMLElement && menu.offsetHeight > 20
  })
  assert.equal(menuVisible, true, '菜单真实绘制（可见高度）')
  // bold 在「文本格式」子菜单：先 hover 父项展开（与既有 contextMenu 套件
  // 同款交互——子菜单 :hover 显隐是 CSS 主通道）
  await page.locator('.vsidian-context-menu button[data-vsidian-command="textFormat"]').hover()
  await settle(80)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="bold"]').click()
  await settle(250)
  const afterB = await page.evaluate(() => window.embedEditorText())
  assert.ok(afterB.includes(`**${wordB}**`), '菜单 bold 命令写 B')
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC, '菜单命令不落 A')
  assert.equal(await page.locator('.vsidian-context-menu').count(), 0, '执行后菜单关闭')
  passed++
  console.log('[嵌入Live操作][PASS] B 嵌入内右键统一菜单：bold 落 B 不落 A')

  // ---- 场景 C：菜单打开期间实例释放 → 执行被拒（不落 A） ----
  const textC = await page.evaluate(() => window.embedEditorText())
  const wordC = '段正文。'
  const fromC = textC.indexOf(wordC)
  await page.evaluate(([f, t]) => window.selectEmbedRange(f, t), [fromC, fromC + wordC.length])
  await page.locator('.vsidian-embed-card .cm-content').first().click({ button: 'right' })
  await page.locator('.vsidian-context-menu').waitFor({ timeout: 3000 })
  // 释放实例（切 Reading → teardown）：菜单仍开，命令执行须被重验拒绝
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(200)
  // 实例已释放：菜单若仍开（子菜单 display:none 无坐标可点），经 DOM
  // click 驱动同一处理器链（用户点击回调）
  await page.evaluate(() => {
    document.querySelector('.vsidian-context-menu button[data-vsidian-command="bold"]')?.click()
  })
  await settle(150)
  assert.equal(await page.evaluate(() => window.mainEditorText()), PARENT_DOC, '实例释放后菜单执行不写 A')
  assert.equal(await page.locator('.vsidian-context-menu').count(), 0, '重验失败菜单关闭')
  // 回到内部 Live 继续后续场景
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(300)
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '切回 Live 编辑器重建')
  passed++
  console.log('[嵌入Live操作][PASS] C 菜单打开期间实例释放：执行被拒、不落 A')

  // ---- 场景 D：嵌入内 Ctrl+Alt+Down（多光标键落 B） ----
  await page.evaluate(() => window.focusEmbedEditor())
  const selInfoD0 = await page.evaluate(() => window.embedSelectionInfo())
  assert.equal(selInfoD0.ranges, 1, '起点单选区')
  await page.keyboard.press('Control+Alt+ArrowDown')
  await settle(150)
  const selInfoD1 = await page.evaluate(() => window.embedSelectionInfo())
  assert.equal(selInfoD1.ranges, 2, '嵌入内加光标作用于 B（两个选区）')
  // 焦点归属：activeElement 仍在嵌入卡片域（主编辑器 contentDOM 承载 Live
  // widget 卡片——不能用「主编辑器 contains」判定，卡片是其后代）
  const focusInEmbedD = await page.evaluate(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest('.vsidian-embed-card') !== null)
  assert.equal(focusInEmbedD, true, '焦点仍在嵌入（A 不被牵动）')
  await page.keyboard.press('Escape') // 收敛多选区（不产生写回）
  passed++
  console.log('[嵌入Live操作][PASS] D 嵌入内 Ctrl+Alt+Down：多光标作用于 B')

  // ---- 场景 E：嵌入内 Ctrl+F 不打开主文查找面板（不落 A） ----
  await page.keyboard.press('Control+f')
  await settle(200)
  const findOpenE = await page.evaluate(() => {
    const panel = document.querySelector('.vsidian-find')
    return panel instanceof HTMLElement && panel.classList.contains('open')
  })
  assert.equal(findOpenE, false, '嵌入焦点下查找面板不打开（键位吞掉不落 A）')
  passed++
  console.log('[嵌入Live操作][PASS] E 嵌入内 Ctrl+F：查找面板不打开')

  // ---- 场景 F：焦点回 A 后 Ctrl+B 恢复写 A（B 不变） ----
  assert.equal(await page.evaluate(() => window.focusMainEditor()), true, '焦点回主编辑器')
  const mainBeforeF = await page.evaluate(() => window.mainEditorText())
  const embedBeforeF = await page.evaluate(() => window.embedEditorText())
  const selF = '尾部段落。'
  const fromF = mainBeforeF.indexOf(selF)
  assert.equal(await page.evaluate(([f, t]) => window.selectMainRange(f, t), [fromF, fromF + selF.length]), true)
  await page.keyboard.press('Control+b')
  await settle(250)
  const mainAfterF = await page.evaluate(() => window.mainEditorText())
  assert.ok(mainAfterF.includes(`**${selF}**`), '焦点回 A 后格式操作写 A')
  assert.equal(await page.evaluate(() => window.embedEditorText()), embedBeforeF, 'B 保持不变')
  passed++
  console.log('[嵌入Live操作][PASS] F 焦点回 A：Ctrl+B 恢复写 A、B 不变')

  // ---- 场景 G：显式关闭（embedClose，统一 P2-05 确认链路）释放编辑会话；重进后编辑能力恢复 ----
  await page.evaluate(() => window.focusEmbedEditor())
  await page.evaluate(() => window.embedUiCommand('embedClose'))
  await settle(250)
  // 统一链路：B 有未保存修改（场景 A 写入）→ 先弹三项模态，确认后才退出
  assert.equal(await page.evaluate(() => window.embedDialogClick('save')), true, 'dirty 目标先弹三项模态，点保存并关闭')
  await settle(250)
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 0, '显式关闭销毁嵌入编辑器')
  const unbindG = (await sent()).some((m) => m.kind === 'refEdit.unbind')
  assert.equal(unbindG, true, '端口释放出站 unbind')
  // 模式记忆为 Reading：再次 ui 切换（头部按钮）回 Live 重建端口
  await page.evaluate(() => window.clickEmbedModeButton())
  await settle(300)
  assert.equal(await page.evaluate(() => window.embedCardEditorCount()), 1, '重新进入 Live 编辑器重建')
  passed++
  console.log('[嵌入Live操作][PASS] G 显式关闭：dirty 模态确认后释放、重进恢复')

  // ---- 场景 H：冲突放弃（conflictDiscard）经端口出站 sync.request → resync 恢复 ----
  await page.evaluate(() => window.focusEmbedEditor())
  await settle(200)
  const markH = (await sent()).length
  await page.evaluate(() => window.embedSuspendPort())
  await settle(150)
  await page.evaluate(() => window.embedUiCommand('conflictDiscard'))
  await settle(250)
  const outboundH = (await sent()).slice(markH)
  assert.ok(outboundH.some((m) => m.kind === 'refEdit.message' && m.message.kind === 'sync.request'),
    'conflictDiscard 经端口出站 sync.request')
  // 伪宿主应答 doc.resync：编辑器解除暂停（可继续输入）——经生产探针观测
  // （状态行 textContent 在隐藏态可能残留旧文案，以 liveSuspended 为准）
  const cardsH = await page.evaluate(() => window.embedLiveCards())
  assert.equal(cardsH[0]?.liveSuspended, false, 'resync 后暂停解除')
  await page.keyboard.type('Z')
  await settle(250)
  const afterH = await page.evaluate(() => window.embedEditorText())
  assert.ok(afterH.includes('Z'), '恢复后可继续输入（写 B）')
  assert.equal(await page.evaluate(() => window.mainEditorText()), mainAfterF, 'A 不变')
  passed++
  console.log('[嵌入Live操作][PASS] H 冲突放弃：sync.request 出站并 resync 恢复')

  // ---- 场景 I（P2-12/#289）：冲突暂停现场三项选择——真实绘制 + compare
  // 出站全文快照（含未提交输入）→ ok 转交（sync.request → resync 解除）；
  // cancel 收起/重新选择；失败保留现场可重试 ----
  // I-1 暂停现场：三项真实绘制（非 display:none/零尺寸），compare hover 逐字
  await page.evaluate(() => window.focusEmbedEditor())
  await settle(150)
  await page.evaluate(() => window.embedSuspendPort())
  await settle(150)
  const choiceI1 = await page.evaluate(() => window.embedConflictChoiceState())
  assert.equal(choiceI1.present, true, '暂停现场选择条在场')
  assert.deepEqual(choiceI1.buttons, ['compare', 'discard', 'cancel'], '三项按钮齐全')
  assert.equal(choiceI1.buttonsPainted, true, '三项按钮真实绘制（可见占位）')
  assert.equal(choiceI1.compareTooltip, '在临时副本和冲突版本的对比视图中处理冲突',
    'compare hover 为用户指定原文逐字')

  // I-2 暂停后继续输入（本地保留）→ 真实点击 compare → 出站全文快照
  await page.keyboard.type('未提交输入')
  await settle(200)
  const embedTextI = await page.evaluate(() => window.embedEditorText())
  const sentBeforeCompare = (await sent()).length
  await page.locator('.vsidian-embed-card .vsidian-embed-card-conflict-compare').click()
  await settle(300)
  const compareReqs = await page.evaluate(() => window.embedConflictCompareRequests())
  assert.equal(compareReqs.length, 1, 'compare 出站 refEdit.conflictCompare')
  assert.equal(compareReqs[0]?.text, embedTextI, '临时副本内容 = 实例当前全文（含未提交输入）')
  // 伪宿主应答 ok + 直驱恢复（doc.resync 推送）：暂停解除、编辑器重置
  //（生产恢复由宿主 resumePanel 直驱——对比页激活会隐藏来源 webview，
  // 不依赖 webview 再出站请求；此处断言增量零 sync.request 出站）
  const syncOutI = (await sent()).slice(sentBeforeCompare)
    .filter((m) => m.kind === 'refEdit.message' && m.message.kind === 'sync.request')
  assert.equal(syncOutI.length, 0, 'compare ok 后 webview 不出站 sync.request（宿主直驱恢复）')
  const cardsI2 = await page.evaluate(() => window.embedLiveCards())
  assert.equal(cardsI2[0]?.liveSuspended, false, '转交后暂停解除（宿主直驱 doc.resync）')
  assert.equal((await page.evaluate(() => window.embedEditorText())).includes('未提交输入'), false,
    '旧未提交输入不重放（编辑器装载权威全文）')

  // I-3 cancel 收起（保持暂停与输入）→ 重新选择展开
  await page.evaluate(() => window.embedSuspendPort())
  await settle(150)
  await page.locator('.vsidian-embed-card .vsidian-embed-card-conflict-cancel').click()
  await settle(150)
  const choiceI3 = await page.evaluate(() => window.embedConflictChoiceState())
  assert.deepEqual(choiceI3.buttons, ['reopen'], '取消后仅剩重新选择入口')
  await page.locator('.vsidian-embed-card .vsidian-embed-card-conflict-reopen').click()
  await settle(150)
  const choiceI3b = await page.evaluate(() => window.embedConflictChoiceState())
  assert.deepEqual(choiceI3b.buttons, ['compare', 'discard', 'cancel'], '重新选择展开三项')

  // I-4 失败分径：伪宿主应答 fail → 选择保留 + 失败提示绘制（警示左边条），
  // 不出站 sync.request；配置回 ok 重试成功（宿主直驱恢复）
  await page.evaluate(() => window.embedSetConflictCompareOk(false))
  await page.locator('.vsidian-embed-card .vsidian-embed-card-conflict-compare').click()
  await settle(300)
  const choiceI4 = await page.evaluate(() => window.embedConflictChoiceState())
  assert.deepEqual(choiceI4.buttons, ['compare', 'discard', 'cancel'], '失败后选择现场保留')
  assert.equal(choiceI4.noticePainted, true, '失败提示真实绘制（警示左边条）')
  const cardsI4 = await page.evaluate(() => window.embedLiveCards())
  assert.equal(cardsI4[0]?.liveSuspended, true, '失败后保持暂停（输入不丢）')
  await page.evaluate(() => window.embedSetConflictCompareOk(true))
  await page.locator('.vsidian-embed-card .vsidian-embed-card-conflict-compare').click()
  await settle(300)
  const cardsI5 = await page.evaluate(() => window.embedLiveCards())
  assert.equal(cardsI5[0]?.liveSuspended, false, '重试成功后暂停解除（宿主直驱恢复）')
  assert.equal(await page.evaluate(() => window.mainEditorText()), mainAfterF, 'A 不变')
  passed++
  console.log('[嵌入Live操作][PASS] I 冲突三项：绘制/hover 逐字、compare 快照转交、cancel 收起、失败保留可重试')

  assert.deepEqual(errors, [], '页面零未捕获异常')
  console.log(`[嵌入Live操作] 全部 ${passed} 场景通过`)
} finally {
  await browser.close()
}
