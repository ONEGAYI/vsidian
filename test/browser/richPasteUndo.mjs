import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'richPaste/richPaste.js')
await build({ entryPoints: [path.join(root,'test/browser/richPasteFixture.ts')], bundle:true, outfile:bundle, format:'iife', loader:{'.svg':'file'}, assetNames:'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const context = await browser.newContext({ permissions:['clipboard-read','clipboard-write'], viewport:{width:900,height:560} })
  const page = await context.newPage()
  await page.route('http://localhost/**', async route => {
    const name=path.basename(new URL(route.request().url()).pathname)
    if(name.endsWith('.svg')) return route.fulfill({path:artifactPath(root,'richPaste/assets',name),contentType:'image/svg+xml'})
    return route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><head><meta charset="utf-8"></head><body style="--vscode-editor-background:#fff;--vscode-editor-foreground:#222;--vscode-editorWidget-background:#f8f8f8;--vscode-editorWidget-foreground:#222">${islandHtml}<div id="app"></div></body></html>`})
  })
  await page.goto('http://localhost/')
  await page.addStyleTag({path:bundle.replace(/\.js$/,'.css')})
  await page.addScriptTag({path:bundle})
  const editor=page.locator('.cm-content'), dialog=page.locator('[role=dialog]')
  async function write(text,html) {
    await page.evaluate(async ({text,html})=>{
      const data={}
      if(text!==undefined)data['text/plain']=new Blob([text],{type:'text/plain'})
      if(html!==undefined)data['text/html']=new Blob([html],{type:'text/html'})
      await navigator.clipboard.write([new ClipboardItem(data)])
    },{text,html})
  }
  async function selectAll() { await editor.click(); await page.keyboard.press('Control+A') }
  async function waitText(text) { await page.waitForFunction(text=>window.text()===text,text) }
  await page.evaluate(()=>window.settings({'editor.pasteAskBefore':false}))
  async function waitBoth(text) { await page.waitForFunction(text=>window.text()===text && window.hostText()===text,text) }
  await write('new','<b>new</b>');await selectAll();await page.keyboard.press('Control+V');await waitBoth('**new**')
  await page.keyboard.press('Control+Z');await waitBoth('new')
  await page.waitForFunction(()=>{const p=window.paint().toast;return p.visible&&p.text.includes('再撤销一次')})
  let paint=await page.evaluate(()=>window.paint());assert.equal(paint.toast.visible,true);assert.equal(paint.toast.severity,'neutral');assert.match(paint.toast.text,/再撤销一次/)
  await page.screenshot({path:artifactPath(root,'richPaste/undo-format-light.png')})
  await page.keyboard.press('Control+Z');await waitBoth('原文')
  paint=await page.evaluate(()=>window.paint());assert.equal(paint.toast.visible,false)
  const selection=await page.evaluate(()=>window.selection());assert.deepEqual(selection.ranges,[{anchor:0,head:2}])
  await page.keyboard.press('Control+Y');await waitBoth('new');await page.keyboard.press('Control+Y');await waitBoth('**new**')
  console.log('[PASS] 生产控制器按真实reason/stage处理A/B/C、选区恢复、首次撤格式neutral绘制')
  await page.keyboard.press('Control+Z');await page.keyboard.press('Control+Z');await waitBoth('原文');assert.equal((await page.evaluate(()=>window.paint())).toast.visible,false)
  await page.keyboard.press('Control+Y');await page.keyboard.press('Control+Y');await waitBoth('**new**')
  await page.keyboard.press('Control+Z');await waitBoth('new');await page.keyboard.type('!');await waitBoth('new!')
  assert.equal((await page.evaluate(()=>window.paint())).toast.visible,false)
  console.log('[PASS] 快速双Undo/Redo与后续输入立即清掉过期引导')
  await page.evaluate(()=>window.replace('aa bb'))
  await page.evaluate(()=>window.selectRanges([{anchor:0,head:2},{anchor:3,head:5}]))
  await write('甲\n乙','<p><b>甲</b></p><p>乙</p>');await editor.focus();await page.keyboard.press('Control+V');await waitBoth('甲 乙')
  await page.waitForFunction(()=>{const p=window.paint().toast;return p.visible&&p.severity==='error'})
  paint=await page.evaluate(()=>window.paint());assert.equal(paint.toast.visible,true);assert.equal(paint.toast.severity,'error');assert.match(paint.toast.text,/已粘贴为纯文本/)
  assert.notEqual(paint.toast.background,'rgba(0, 0, 0, 0)');assert.equal(await editor.evaluate(el=>document.activeElement===el),true)
  await page.keyboard.press('Control+Z');await waitBoth('aa bb')
  await page.evaluate(()=>window.selectRanges([{anchor:0,head:2},{anchor:3,head:5}]))
  await page.keyboard.press('Control+Shift+V');await waitBoth('甲 乙')
  console.log('[PASS] 多选区行数不对齐回退纯文本、淡红绘制、单次撤销，与显式纯文本分发一致')
  await page.evaluate(()=>window.replace('aa bb'));await page.evaluate(()=>window.selectRanges([{anchor:0,head:2},{anchor:3,head:5}]))
  await write('X','<b>X</b>');await editor.focus();await page.keyboard.press('Control+V');await waitBoth('**X** **X**')
  await page.keyboard.press('Control+Z');await waitBoth('X X');await page.keyboard.press('Control+Z');await waitBoth('aa bb')
  console.log('[PASS] 分发一致的多选区保留格式，两个阶段均无丢字')
  await page.evaluate(()=>window.openSettings())
  const total=page.locator('[data-setting-key="editor.pastePreserveFormatting"]'),split=page.locator('[data-setting-key="editor.pasteSplitUndo"]')
  await split.waitFor();assert.equal(await split.isChecked(),true);assert.equal(await split.isDisabled(),false)
  await total.uncheck();assert.equal(await split.isDisabled(),true);assert.equal(await split.isChecked(),true)
  await page.evaluate(()=>window.openSettings());assert.equal(await split.isDisabled(),true);assert.equal(await split.isChecked(),true)
  await total.check();await split.uncheck();await page.evaluate(()=>window.openSettings());assert.equal(await split.isChecked(),false)
  await page.evaluate(()=>window.closeSettings())
  await page.evaluate(()=>window.replace('原文'));await write('single','<b>single</b>');await selectAll();await page.keyboard.press('Control+V');await waitBoth('**single**')
  await page.keyboard.press('Control+Z');await waitBoth('原文')
  console.log('[PASS] 分步默认开、灰化保值、持久化重新打开回显与关闭后单次撤销')
} finally { await browser.close() }
