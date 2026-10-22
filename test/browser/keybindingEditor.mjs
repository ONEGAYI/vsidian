// 生产编辑器控制器在 Chromium 原生 keyboard 路径上的键位捕获与旧键释放。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'keybindingEditor/keybindingEditor.js')
await build({ entryPoints: [path.join(root, 'test/browser/keybindingEditorFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage()
  await page.setContent('<html><body><div id="app"></div></body></html>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate(() => window.initKeys('word'))
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+b')
  let state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, '**word**')
  assert.equal(state.forwarded, 0, '被 Vsidian 捕获的按键不应到达 window 冒泡转发层')
  await page.evaluate(() => { window.initKeys('word'); window.updateKeys({ bold: [] }) })
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+b')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, 'word', '显式清空后旧键不应执行格式操作')
  assert.equal(state.forwarded, 1, '清空后旧键应重新经过 window 层')
  await page.evaluate(() => window.updateKeys({ bold: ['ctrl+shift+b'] }))
  await page.keyboard.press('Control+Shift+b')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, '**word**')
  assert.equal(state.forwarded, 1)
  await page.evaluate(() => window.setMode('reading'))
  await page.keyboard.press('Control+b')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, '**word**', '阅读模式不执行写操作')
  await page.keyboard.press('Control+f')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.findOpen, true, '阅读模式保留只读查找键位')
  const forwardedBeforeStep = state.forwarded
  await page.keyboard.press('F3')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.forwarded, forwardedBeforeStep, '查找输入中 F3 被本地路由捕获')
  await page.evaluate(() => window.updateKeys({ findNext: [] }))
  await page.keyboard.press('F3')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.forwarded, forwardedBeforeStep + 1, '清空后 F3 释放到 window 层')
  await page.evaluate(() => window.setMode('live'))
  await page.evaluate(() => { window.initKeys('word'); window.updateKeys({ bold: ['ctrl+k ctrl+b'] }) })
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+k')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, 'word')
  await page.keyboard.press('Control+b')
  state = await page.evaluate(() => window.keyState())
  assert.equal(state.text, '**word**')
  assert.equal(state.forwarded, 3)

  const paragraph = '`type` 末尾的 `.1` 表示事件格式版本，不是第一次更新。`(aggregate_id, seq)` 有唯一约束；不同会话可以各自拥有 `seq = 11`。读取某个会话的持久化历史，应按该会话的 `seq` 排序。[事件表定义](opencode/packages/core/src/event/sql.ts)'
  for (const [op, key, binding, mark, className, property, expected] of [
    ['bold', 'Control+b', 'ctrl+b', '**', 'vsidian-strong', 'fontWeight', '700'],
    ['italic', 'Control+i', 'ctrl+i', '*', 'vsidian-emphasis', 'fontStyle', 'italic'],
    ['strikethrough', 'Control+Shift+s', 'ctrl+shift+s', '~~', 'vsidian-strikethrough', 'textDecorationLine', 'line-through'],
    ['highlight', 'Control+Shift+h', 'ctrl+shift+h', '==', 'vsidian-highlight', 'backgroundColor', 'rgb(255, 230, 0)'],
  ]) {
    await page.evaluate(({ paragraph, op, binding }) => {
      window.initKeys(paragraph)
      window.updateKeys({ [op]: [binding] })
      document.getElementById('app').style.setProperty('--vsidian-highlight-background', 'rgb(255, 230, 0)')
    }, { paragraph, op, binding })
    await page.locator('.cm-content').focus()
    await page.keyboard.press('Control+a')
    const editsBefore = (await page.evaluate(() => window.keyState())).messages
      .filter(message => message.kind === 'edit.request').length
    await page.keyboard.press(key)
    state = await page.evaluate(() => window.keyState())
    assert.equal(state.text, mark + paragraph + mark, `${op} 应包裹含行内代码和链接的整段选区`)
    assert.equal(state.messages.filter(message => message.kind === 'edit.request').length,
      editsBefore + 1, `${op} 应经单笔写回提交`)
    const paint = await page.locator(`.cm-content .${className}`).filter({ hasText: '末尾的' })
      .first().evaluate((node, property) => getComputedStyle(node)[property], property)
    assert.equal(paint, expected, `${op} 应在正文绘制层生效`)
    await page.keyboard.press(key)
    assert.equal((await page.evaluate(() => window.keyState())).text, paragraph,
      `${op} 再次切换应还原整段及代码、链接原文`)
  }
  for (const [op, mark] of [['bold', '**'], ['italic', '*'], ['strikethrough', '~~'], ['highlight', '=='], ['inlineCode', '`']]) {
    await page.evaluate((op) => {
      window.initKeys('> - ## 正文')
      window.updateKeys({ [op]: ['ctrl+i'] })
    }, op)
    await page.locator('.cm-content').focus()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Control+i')
    assert.equal((await page.evaluate(() => window.keyState())).text, '> - ## ' + mark + '正文' + mark,
      `${op} 快捷键应保留引用、列表和标题的组合前缀`)
    await page.keyboard.press('Control+i')
    assert.equal((await page.evaluate(() => window.keyState())).text, '> - ## 正文')
  }
  // #638 跳转到行：真实 Ctrl+G 被面板消费（不透传宿主），提交行号后落位行首；
  // 取消不移动；显式清空后旧键释放回 window 层
  const gotoDoc = '第一行\n第二行\n第三行\n'
  await page.evaluate((text) => {
    window.initKeys(text)
    window.updateKeys({})
    window.setGotoLineTarget(3)
  }, gotoDoc)
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Control+Home')
  const forwardedBeforeGoto = (await page.evaluate(() => window.keyState())).forwarded
  await page.keyboard.press('Control+g')
  let gotoState = await page.evaluate(() => window.keyState())
  assert.equal(gotoState.forwarded, forwardedBeforeGoto, 'Ctrl+G 被面板消费，不应到达 window 冒泡转发层')
  assert.deepEqual(gotoState.gotoLineExecutions, [3], 'Ctrl+G 应触发一次宿主输入框链路')
  assert.equal(gotoState.cursor, gotoDoc.indexOf('第三行'), '提交行号后光标应落在该行行首')
  assert.equal(gotoState.text, gotoDoc, '跳转到行不修改正文')
  await page.evaluate(() => window.setGotoLineTarget(null))
  await page.keyboard.press('Control+g')
  gotoState = await page.evaluate(() => window.keyState())
  assert.equal(gotoState.cursor, gotoDoc.indexOf('第三行'), '取消输入框不应移动位置')
  assert.deepEqual(gotoState.gotoLineExecutions, [3, 0], '取消仍触发宿主链路一次（由宿主判定放弃）')
  await page.evaluate(() => window.updateKeys({ gotoLine: [] }))
  await page.keyboard.press('Control+g')
  gotoState = await page.evaluate(() => window.keyState())
  assert.equal(gotoState.forwarded, forwardedBeforeGoto + 1, '显式清空后 Ctrl+G 应释放回 window 层')
  await page.close()
  console.log('[编辑器快捷键][PASS] 原生键盘默认/清空释放/改绑/两段键与 window 转发隔离；含行内代码的整段粗体/斜体/删除线/高亮往返与绘制；Ctrl+G 跳转到行的消费/落位/取消/清空释放')
} finally { await browser.close() }
