// #541 T01 附加组件粘贴规则——浏览器契约套件（生产控制器 + 真实键盘）。
// 钉住票面验收：
// - 双载荷样本：来源特化链接恢复，旁边 strong/code/pre 保持原格式；
// - 纯文本操作（Ctrl+Shift+V）不经过规则；
// - 首次撤销只撤格式、第二次撤文字（宿主分步历史不变）；转换结果等于
//   plain 时只有一次撤销；
// - 停用撤回（空快照）与迟到旧版本快照不复活旧代次规则。
// 规则载荷只模拟来源 HTML 形态（Codex 形态样例），不把专属规则写入
// 生产内核——消费样例经生产快照通道注入。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'addonPasteRules/addonPasteRules.js')
await build({ entryPoints: [path.join(root,'test/browser/addonPasteRulesFixture.ts')], bundle:true, outfile:bundle, format:'iife', loader:{'.svg':'file'}, assetNames:'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

/** Codex 形态规则快照（v1：来源特化链接 + 复制按钮丢弃） */
const snapshotV1 = {
  version: 1,
  rules: [
    {
      addonId: 'fixture.paste-demo',
      id: 'prompt-link',
      priority: 0,
      match: { tag: 'SPAN', attributes: [{ name: 'data-prompt-link-url' }] },
      output: {
        kind: 'template',
        template: '[{{label}}]({{url}})',
        slots: {
          label: { source: { kind: 'text' } },
          url: { source: { kind: 'attribute', name: 'data-prompt-link-url' }, url: true },
        },
      },
    },
    {
      addonId: 'fixture.paste-demo',
      id: 'drop-copy-button',
      priority: 0,
      match: { tag: 'SPAN', attributes: [{ name: 'data-copy-button' }] },
      output: { kind: 'discard' },
    },
  ],
}
const snapshotEmpty = { version: 2, rules: [] }

try {
  const context = await browser.newContext({ permissions:['clipboard-read','clipboard-write'], viewport:{width:900,height:560} })
  const page = await context.newPage()
  await page.route('http://localhost/**', async route => {
    const name=path.basename(new URL(route.request().url()).pathname)
    if(name.endsWith('.svg')) return route.fulfill({path:artifactPath(root,'addonPasteRules/assets',name),contentType:'image/svg+xml'})
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
  async function waitBoth(text) { await page.waitForFunction(text=>window.text()===text && window.hostText()===text,text) }
  await page.evaluate(()=>window.settings({'editor.pasteAskBefore':false}))

  // ---- 双载荷样本：来源特化链接恢复，strong/code/pre 保持 ----
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotV1)
  await write('文档链接 粗体 a`b\nconst a = 1', [
    '<p><span data-prompt-link-url="https://example.com/doc">文档链接</span> <strong>粗体</strong> <code>a`b</code></p>',
    '<pre><code class="language-js">const a = 1</code></pre>',
  ].join(''))
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('[文档链接](https://example.com/doc) **粗体** ``a`b``\n\n```js\nconst a = 1\n```')
  assert.equal(await dialog.count(), 0)
  console.log('[PASS] 双载荷命中规则：链接恢复、strong/code/pre 保持原格式')

  // ---- 分步撤销：第一次撤格式、第二次撤文字（宿主历史不变） ----
  await page.keyboard.press('Control+Z')
  await waitBoth('文档链接 粗体 a`b\nconst a = 1')
  await page.waitForFunction(()=>{const p=window.paint().toast;return p.visible&&p.text.includes('再撤销一次')})
  await page.keyboard.press('Control+Z'); await waitBoth('原文')
  const paint=await page.evaluate(()=>window.paint());assert.equal(paint.toast.visible,false)
  console.log('[PASS] 首次撤销只撤格式、第二次撤文字；分步历史不经规则另建')

  // ---- 来源特化链接位于粗体内：同层格式不能在规则边界断开 ----
  await write('前中后', '<p><strong>前<span data-prompt-link-url="https://example.com/inherited">中</span>后</strong></p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('**前[中](https://example.com/inherited)后**')
  await page.keyboard.press('Control+Z'); await waitBoth('前中后')
  await page.keyboard.press('Control+Z'); await waitBoth('原文')
  console.log('[PASS] 来源链接保留父级粗体，连续文本格式与分步撤销保持')

  // ---- 复制按钮丢弃：chrome 元素不进入结果 ----
  await write('正文', '<p>正文<span data-copy-button>复制</span></p>')
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth('正文')
  console.log('[PASS] 显式丢弃规则生效（复制按钮 chrome 不进入正文）')

  // ---- 纯文本操作不经规则（Ctrl+Shift+V 直插 plain） ----
  await write('纯文字', '<p><span data-prompt-link-url="https://example.com/x">纯文字</span></p>')
  await selectAll(); await page.keyboard.press('Control+Shift+V'); await waitBoth('纯文字')
  console.log('[PASS] 纯文本粘贴绕过规则')

  // ---- 转换结果等于 plain 时只有一次撤销 ----
  await page.evaluate(()=>window.replace('原文'))
  // 空丢弃元素不产生正文差：转换结果与 plain 等值 → 既有单次撤销路径
  await write('等值文本', '<p>等值文本<span data-copy-button></span></p>')
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth('等值文本')
  await page.keyboard.press('Control+Z'); await waitBoth('原文')
  console.log('[PASS] 转换结果等于 plain 时只有一次撤销')

  // ---- 停用撤回 + 迟到旧版本快照不复活 ----
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotEmpty)
  await write('回退文字', '<p><span data-prompt-link-url="https://example.com/z">回退文字</span></p>')
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth('回退文字')
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotV1)
  await write('再回退', '<p><span data-prompt-link-url="https://example.com/z">再回退</span></p>')
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth('再回退')
  console.log('[PASS] 停用撤回立即回内置；迟到旧版本快照不复活已撤回代次')

  // ---- 恢复规则后再命中（重新启用同代语义） ----
  await page.evaluate(({version, rules})=>window.pasteRules({ version, rules }), { version: 3, rules: snapshotV1.rules })
  await write('恢复链接', '<p><span data-prompt-link-url="https://example.com/r">恢复链接</span></p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('[恢复链接](https://example.com/r)')
  console.log('[PASS] 新快照版本恢复规则生效')
} finally { await browser.close() }
