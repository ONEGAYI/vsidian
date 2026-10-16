// #541 T01 / #542 T02 附加组件粘贴规则——浏览器契约套件（生产控制器 + 真实键盘）。
// 钉住票面验收：
// - 双载荷样本：来源特化链接恢复，旁边 strong/code/pre 保持原格式；
// - 纯文本操作（Ctrl+Shift+V）不经过规则；
// - 首次撤销只撤格式、第二次撤文字（宿主分步历史不变）；转换结果等于
//   plain 时只有一次撤销；
// - 停用撤回（空快照）与迟到旧版本快照不复活旧代次规则。
// T02 追加：正则捕获组与条件组合命中（含嵌套规则集回放嵌套 HTML——
// 子规则先于内置、外层规则不串味；既有格式与分步撤销保持）。
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
/** T02 段末停用用（版本须高于此前一切快照——迟到旧版本不回退） */
const snapshotEmptyAfterT02 = { version: 5, rules: [] }

/** #542 T02 形态规则快照（v4）：正则捕获组 + 条件组合 + 嵌套子规则集 */
const snapshotT02 = {
  version: 4,
  rules: [
    {
      // 正则 + 条件：data-ref="refs/12" 形态 → 「§12」（命名组捕获，条件
      // 同时要求属性正则与文本非空）
      addonId: 'fixture.paste-demo',
      id: 'ref-regex',
      priority: 1,
      match: {
        tag: 'SPAN',
        condition: { all: [
          { kind: 'attribute-regex', name: 'data-ref', regex: { pattern: '^refs/' } },
          { not: { kind: 'text-regex', regex: { pattern: '^\\s*$' } } },
        ] },
      },
      output: {
        kind: 'template',
        template: '§{{no}}',
        slots: {
          no: { source: { kind: 'attribute-regex', name: 'data-ref', regex: { pattern: '^refs/(?<no>\\d+)$' }, group: 'no' } },
        },
      },
    },
    {
      // 嵌套：data-card 容器 → 引用块；子规则集恢复容器内特化 span，
      // 其余子元素走内置（粗体/行内代码保持）
      addonId: 'fixture.paste-demo',
      id: 'card-nested',
      priority: 0,
      match: { tag: 'DIV', attributes: [{ name: 'data-card' }] },
      output: {
        kind: 'template',
        template: '> {{body}}',
        slots: {
          body: { source: { kind: 'children', rules: [
            {
              id: 'inner-link',
              priority: 0,
              match: { tag: 'SPAN', attributes: [{ name: 'data-inner-url' }] },
              output: {
                kind: 'template',
                template: '[{{t}}]({{u}})',
                slots: {
                  t: { source: { kind: 'text' } },
                  u: { source: { kind: 'attribute', name: 'data-inner-url' }, url: true },
                },
              },
            },
            {
              id: 'drop-chrome',
              priority: 0,
              match: { tag: 'SPAN', condition: { all: [{ kind: 'attribute', name: 'data-chrome' }] } },
              output: { kind: 'discard' },
            },
          ] } },
        },
      },
    },
  ],
}

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

  // ---- #542 T02：正则捕获组与条件组合（真实键盘回放） ----
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotT02)
  await write('参考 7', '<p><span data-ref="refs/7">参考 7</span> 尾注</p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('§7 尾注')
  // 条件不满足（data-ref 缺失）回内置纯文本
  await write('普通词', '<p><span>普通词</span></p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('普通词')
  // 条件满足但正则不匹配（refs/ 后非数字）→ 取值缺失回内置
  await write('参考 x', '<p><span data-ref="refs/x">参考 x</span></p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('参考 x')
  console.log('[PASS] T02 正则捕获组与条件组合命中/不命中回退')

  // ---- #542 T02：嵌套 HTML 回放（子规则集先于内置，外层规则不串味） ----
  // 重置文档与历史：本用例的撤销二应回到前置的「原文」
  await page.evaluate(()=>window.replace('原文'))
  await write('内链 粗词复制', [
    '<div data-card><p>',
    '<span data-inner-url="https://example.com/deep">内链</span>',
    ' <strong>粗词</strong>',
    '<span data-chrome>复制</span>',
    '</p></div>',
  ].join(''))
  await selectAll(); await page.keyboard.press('Control+V')
  // 子规则集恢复内链（URL 槽）、丢弃 chrome；strong 走内置；容器模板成引用块
  await waitBoth('> [内链](https://example.com/deep) **粗词**')
  assert.equal(await dialog.count(), 0)
  console.log('[PASS] T02 嵌套子规则集命中且其余子元素按内置转换')

  // ---- T02 嵌套转换的分步撤销：首撤格式、次撤文字（宿主历史不变） ----
  await page.keyboard.press('Control+Z')
  await waitBoth('内链 粗词复制')
  await page.keyboard.press('Control+Z'); await waitBoth('原文')
  console.log('[PASS] T02 嵌套转换沿用既有分步撤销')

  // ---- T02 停用撤回：嵌套与正则规则一并失效 ----
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotEmptyAfterT02)
  // builtin 转换无格式 → 走 plain 等值路径（载荷对齐 builtin 文本，同 T01「回退文字」形态）
  await write('内链', '<div data-card><p><span data-inner-url="https://example.com/z">内链</span></p></div>')
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth('内链')
  console.log('[PASS] T02 停用后嵌套链路整体回内置')
} finally { await browser.close() }
