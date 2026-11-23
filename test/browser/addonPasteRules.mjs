// #541 T01 / #542 T02 附加组件粘贴规则——浏览器契约套件（生产控制器 + 真实键盘）。
// 钉住票面验收：
// - 双载荷样本：来源特化链接恢复，旁边 strong/code/pre 保持原格式；
// - 纯文本操作（Ctrl+Shift+V）不经过规则；
// - 首次撤销只撤格式、第二次撤文字（宿主分步历史不变）；转换结果等于
//   plain 时只有一次撤销；
// - 停用撤回（空快照）与迟到旧版本快照不复活旧代次规则。
// T02 追加：正则捕获组与条件组合命中（含嵌套规则集回放嵌套 HTML——
// 子规则先于内置、外层规则不串味；既有格式与分步撤销保持）。
// PR #564 评审修复追加：16 层条件组合（合法最大深度）快照穿过协议守卫
// 并被生产控制器接纳（注册与守卫深度口径统一）。
// 规则载荷只模拟来源 HTML 形态（来源特化样例），不把专属规则写入
// 生产内核——消费样例经生产快照通道注入。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'addonPasteRules/addonPasteRules.js')
await build({ entryPoints: [path.join(root,'test/browser/addonPasteRulesFixture.ts')], bundle:true, outfile:bundle, format:'iife',
  loader:{'.svg':'file','.woff2':'file','.woff':'file','.ttf':'file'}, assetNames:'assets/[name]' })
const { islandHtml } = await buildZhLocaleIsland(root)
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

/** 来源特化规则快照（v1：特化链接 + 复制按钮丢弃） */
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
    if (/\.(svg|woff2?|ttf)$/.test(name)) return route.fulfill({ path: artifactPath(root, 'addonPasteRules/assets', name) })
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

  // ---- PR #564 评审：16 层条件组合（合法最大深度）注册口径快照必被生产控制器接纳 ----
  // 16 层 not 链（偶数次否定 → 等价要求 data-deep 存在）：修复前协议守卫拒收
  // 第 16 层，全量快照被弃、页面规则整体失效；修复后穿过守卫并参与转换。
  let deepCondition = { kind: 'attribute', name: 'data-deep' }
  for (let i = 0; i < 16; i++) deepCondition = { not: deepCondition }
  const snapshotDeep = { version: 6, rules: [{
    addonId: 'fixture.paste-demo',
    id: 'deep-condition',
    priority: 0,
    match: { tag: 'SPAN', condition: deepCondition },
    output: { kind: 'template', template: '[D16]', slots: {} },
  }] }
  await page.evaluate(snapshot=>window.pasteRules(snapshot), snapshotDeep)
  await write('深条件', '<p><span data-deep>深条件</span></p>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('[D16]')
  console.log('[PASS] 16 层条件组合快照穿过协议守卫并被生产控制器接纳')

  // 反重力实际剪贴板双载荷，HTML 仅去掉 Windows CF_HTML 外壳。
  const antiGravityPlain = "一个诊断问题实例（DPI）由五元组 \n(\n𝑆\n𝐷\n，\n𝐶\n𝑂\n𝑀\n𝑃\n𝑆\n，\n𝑂\n𝐵\n𝑆\n，\n𝑃\n，\n𝑁\n)\n(SD，COMPS，OBS，P，N) 构成"
  const antiGravityHtml = [
    "一个<strong>诊断问题实例（DPI）</strong>由五元组 <span>",
    "<span class=\"katex\">",
    "<span class=\"katex-mathml\">",
    "<math xmlns=\"http://www.w3.org/1998/Math/MathML\">",
    "<semantics>",
    "<mrow>",
    "<mo stretchy=\"false\">(</mo>",
    "<mi>S</mi>",
    "<mi>D</mi>",
    "<mo separator=\"true\">，</mo>",
    "<mi>C</mi>",
    "<mi>O</mi>",
    "<mi>M</mi>",
    "<mi>P</mi>",
    "<mi>S</mi>",
    "<mo separator=\"true\">，</mo>",
    "<mi>O</mi>",
    "<mi>B</mi>",
    "<mi>S</mi>",
    "<mo separator=\"true\">，</mo>",
    "<mi>P</mi>",
    "<mo separator=\"true\">，</mo>",
    "<mi>N</mi>",
    "<mo stretchy=\"false\">)</mo>",
    "</mrow>",
    "<annotation encoding=\"application/x-tex\">(SD, COMPS, OBS, P, N)</annotation>",
    "</semantics>",
    "</math>",
    "</span>",
    "<span class=\"katex-html\" aria-hidden=\"true\">",
    "<span class=\"katex-base\">",
    "<span class=\"katex-strut\" style=\"height: 1em; vertical-align: -0.25em;\">",
    "</span>",
    "<span class=\"mopen\">(</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0576em;\">S</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0278em;\">D</span>",
    "<span class=\"mpunct\">，</span>",
    "<span class=\"mspace\" style=\"margin-right: 0.1667em;\">",
    "</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0715em;\">C</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0278em;\">O</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.109em;\">M</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.1389em;\">P</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0576em;\">S</span>",
    "<span class=\"mpunct\">，</span>",
    "<span class=\"mspace\" style=\"margin-right: 0.1667em;\">",
    "</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0278em;\">O</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0502em;\">B</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.0576em;\">S</span>",
    "<span class=\"mpunct\">，</span>",
    "<span class=\"mspace\" style=\"margin-right: 0.1667em;\">",
    "</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.1389em;\">P</span>",
    "<span class=\"mpunct\">，</span>",
    "<span class=\"mspace\" style=\"margin-right: 0.1667em;\">",
    "</span>",
    "<span class=\"mord mathnormal\" style=\"margin-right: 0.109em;\">N</span>",
    "<span class=\"mclose\">)</span>",
    "</span>",
    "</span>",
    "</span>",
    "</span> 构成",
  ].join('')
  const formulaRules = [{
    addonId: 'ONEGAYI.vsidian-codex-bridge',
    id: 'katex-inline-math',
    priority: 0,
    match: { tag: 'SPAN', condition: { kind: 'attribute-regex', name: 'class', regex: { pattern: '(?:^|\\s)katex(?:\\s|$)' } } },
    output: { kind: 'template', template: '{{tex}}', slots: { tex: { source: { kind: 'text' }, inlineMath: true } } },
  }]
  await page.evaluate(snapshot => window.pasteRules(snapshot), { version: 7, rules: formulaRules })
  await write(antiGravityPlain, antiGravityHtml)
  await selectAll(); await page.keyboard.press('Control+V')
  // “）”紧贴粗体结束符，宿主已有序列化规则把相邻的“由”写成等价字符实体。
  await waitBoth('一个**诊断问题实例（DPI）**&#30001;五元组 $(SD, COMPS, OBS, P, N)$ 构成')
  assert.strictEqual(await editor.locator('.cm-strong').first().textContent(), '诊断问题实例（DPI）')
  const renderedMath = editor.locator('.vsidian-math .katex-html')
  await renderedMath.waitFor({ state: 'visible' })
  assert.strictEqual(await renderedMath.count(), 1)

  const katexSpan = tex => `<span class="katex"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>`
  await page.evaluate(() => {
    window.replace('wordSuffix')
    window.selectRanges([{ anchor: 4, head: 4 }])
  })
  await write('$x$', katexSpan('x'))
  await page.keyboard.press('Control+V'); await waitBoth('word $x$ Suffix')
  await renderedMath.waitFor({ state: 'visible' })
  await page.keyboard.press('Control+Z'); await waitBoth('word$x$Suffix')
  console.log('[PASS] 即使两个载荷等值，公式也只在富文本阶段隔开已有英文')

  const withTicks = '\\texttt{`A|B`}'
  await write('例\nP(A|B)\nA|B', `<table><tr><th>例</th></tr><tr><td>${katexSpan('P(A|B)')}</td></tr><tr><td>${katexSpan(withTicks)}</td></tr></table>`)
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('| 例 |\n| --- |\n| $P(A\\|B)$ |\n| $' + withTicks.replace('|', '\\|') + '$ |')
  await renderedMath.first().waitFor({ state: 'visible' })
  await renderedMath.nth(1).waitFor({ state: 'visible' })
  assert.deepEqual(await editor.locator('.vsidian-math annotation').allTextContents(), ['P(A|B)', withTicks])
  console.log('[PASS] HTML 表格中的公式：源码保护格边界，Live 实际渲染仍使用原 TeX')

  await page.evaluate(() => window.replace('原文'))
  const url = 'https://example.com/$x'
  await write('source y 尾', `<a href="${url}">source</a> ${katexSpan('y')} 尾`)
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth(`[source](${url}) $y$ 尾`)
  await renderedMath.waitFor({ state: 'visible' })
  await editor.locator('[data-vsidian-rendered-link="true"]').click()
  await page.waitForFunction(url => window.sent().some(m => m.kind === 'link.activate' && m.href === url), url)
  console.log('[PASS] 含美元的链接目标不参与公式配对，点击时发出原地址')

  await page.evaluate(() => {
    window.replace('$a$ end')
    window.selectRanges([{ anchor: 0, head: 0 }])
  })
  await write('x USD', katexSpan('x') + ' USD')
  await page.keyboard.press('Control+V')
  const adjacent = '$x$ USD $a$ end'
  await waitBoth(adjacent)
  await page.evaluate(end => window.selectRanges([{ anchor: end, head: end }]), adjacent.length)
  await renderedMath.nth(1).waitFor({ state: 'visible' })
  assert.deepEqual(await editor.locator('.vsidian-math annotation').allTextContents(), ['x', 'a'])
  await page.keyboard.press('Control+Z'); await waitBoth('x USD$a$ end')
  console.log('[PASS] 新公式和尾随英文不破坏旧公式；撤销格式仍恢复原剪贴板纯文本')

  await page.evaluate(() => window.pasteRules({ version: 8, rules: [] }))
  await page.evaluate(() => window.replace('原文'))
  await write(antiGravityPlain, antiGravityHtml)
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('一个**诊断问题实例（DPI）**&#30001;五元组 (SD, COMPS, OBS, P, N) 构成')
  console.log('[PASS] 反重力双载荷：粗体与单个可见行内公式保留；撤回规则后按旧链路粘贴')

  await page.evaluate(snapshot => window.pasteRules(snapshot), { version: 9, rules: formulaRules })
  const listHtml = '<li><span>意味着</span><strong>“重点”</strong> ' + katexSpan('n') +
    '。</li>\n  <li>其次 ' + katexSpan('2^n') + '。</li>'
  const listPlain = '意味着“重点” n。\n其次 2ⁿ。'
  const withEntity = '- 意味&#30528;**“重点”** $n$。\n- 其次 $2^n$。'
  await write(listPlain, listHtml)
  await selectAll(); await page.keyboard.press('Control+V'); await waitBoth(withEntity)
  const entity = editor.locator('.vsidian-inline-entity')
  await entity.waitFor({ state: 'visible' })
  assert.equal(await entity.textContent(), '着')
  assert.equal(await editor.locator('.vsidian-list-bullet').count(), 2)
  await renderedMath.nth(1).waitFor({ state: 'visible' })
  assert.deepEqual(await editor.locator('.vsidian-math annotation').allTextContents(), ['n', '2^n'])
  assert.equal(await editor.locator('.vsidian-math .katex-mathml').first().evaluate(el => getComputedStyle(el).position), 'absolute')
  assert.equal(await editor.locator('.cm-strong').first().textContent(), '“重点”')
  await editor.screenshot({ path: artifactPath(root, 'addonPasteRules/paste-list-entity.png') })
  await entity.click()
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('&#30528;'))
  assert.equal(await page.evaluate(() => window.text()), withEntity)
  await page.keyboard.press('Control+End')
  await entity.waitFor({ state: 'visible' })

  await page.evaluate(() => { window.openSettings() })
  const boundaryMode = page.locator('select[data-setting-key="editor.pasteEmphasisBoundary"]')
  await boundaryMode.waitFor({ state: 'visible' })
  assert.deepEqual(await boundaryMode.locator('option').allTextContents(), ['使用字符实体（不插空格）', '按需补空格'])
  assert.equal(await boundaryMode.inputValue(), 'entity')
  await boundaryMode.locator('..').screenshot({ path: artifactPath(root, 'addonPasteRules/paste-boundary-setting.png') })
  await boundaryMode.selectOption('space')
  await page.evaluate(() => { window.closeSettings(); window.openSettings() })
  assert.equal(await boundaryMode.inputValue(), 'space')
  await page.evaluate(() => window.closeSettings())
  await write(listPlain, listHtml)
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('- 意味着 **“重点”** $n$。\n- 其次 $2^n$。')
  assert.equal(await entity.count(), 0)
  assert.equal(await editor.locator('.cm-strong').first().textContent(), '“重点”')
  await page.keyboard.press('Control+Z'); await waitBoth(listPlain)
  console.log('[PASS] 裸列表项、实体触界显形与设置页二选一；换档仅改变富文本阶段')

  await page.evaluate(() => {
    window.replace('前文后文')
    window.selectRanges([{ anchor: 2, head: 2 }])
  })
  await write(listPlain, listHtml)
  await page.keyboard.press('Control+V')
  await waitBoth('前文\n\n- 意味着 **“重点”** $n$。\n- 其次 $2^n$。\n\n后文')
  assert.equal(await editor.locator('.vsidian-list-bullet').count(), 2)
  await page.keyboard.press('Control+Z')
  await waitBoth('前文' + listPlain + '后文')
  console.log('[PASS] 段中粘贴仅富文本阶段保留列表的前后段界')

  await page.evaluate(() => {
    window.replace('前文后文')
    window.selectRanges([{ anchor: 2, head: 2 }])
  })
  await write('甲\n乙\n引文', '<ul><li>甲</li><li>乙</li></ul><blockquote>引文</blockquote>')
  await page.keyboard.press('Control+V')
  await waitBoth('前文\n\n- 甲\n- 乙\n\n> 引文\n\n后文')
  assert.equal(await editor.locator('.vsidian-list-bullet').count(), 2)
  await page.keyboard.press('Control+Z'); await waitBoth('前文甲\n乙\n引文后文')
  await page.keyboard.press('Control+Z'); await waitBoth('前文后文')
  console.log('[PASS] 外层列表和尾部引用各保住段界；两次撤销分别恢复纯文本和原文')

  const spacedPlain = '段落\n续行\n\n说明\n\n条目 n'
  await write(spacedPlain, '<p><strong>段落</strong><br>续行</p>\n  <section>\n<!--a-->\n<!--b-->\n<!--c-->\n' +
    '<span>说明</span><ul><li>条目 ' +
    katexSpan('n') + '</li></ul>\n  </section>')
  await selectAll(); await page.keyboard.press('Control+V')
  await waitBoth('**段落**  \n续行\n\n说明\n\n- 条目 $n$')
  await page.keyboard.press('Control+Home')
  await renderedMath.waitFor({ state: 'visible' })
  assert.equal(await editor.locator('.cm-line').count(), 6)
  await editor.getByText('说明', { exact: true }).waitFor({ state: 'visible' })
  await page.keyboard.press('Control+Z'); await waitBoth(spacedPlain)
  console.log('[PASS] HTML 块间缩进不制造额外空行；硬换行、公式和原纯文本阶段保留')

  const newlineEntitySource = 'A&NewLine;B\nA&#10;B\n普通行'
  await page.evaluate(source => {
    window.replace(source)
    window.selectRanges([{ anchor: source.length, head: source.length }])
  }, newlineEntitySource)
  await entity.nth(1).waitFor({ state: 'attached' })
  const rowHeights = await editor.locator('.cm-line').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
  assert.deepEqual(rowHeights.slice(0, 2), [rowHeights[2], rowHeights[2]], '命名和数值换行实体都不抬高源码行')
  assert.equal(await page.evaluate(() => window.text()), newlineEntitySource)
  console.log('[PASS] 命名与数值换行实体不引入额外视觉行')

  await page.evaluate(() => {
    window.replace('$abc$ tail')
    window.selectRanges([{ anchor: 3, head: 3 }])
  })
  await write('x', '<li>x</li>')
  await page.keyboard.press('Control+V')
  await waitBoth('$abxc$ tail')
  await page.keyboard.press('Control+End')
  await renderedMath.waitFor({ state: 'visible' })
  assert.deepEqual(await editor.locator('.vsidian-math annotation').allTextContents(), ['abxc'])
  console.log('[PASS] 恢复独立列表时不会把正在编辑的旧公式拆成多个段落')

  await page.evaluate(() => window.selectRanges([{ anchor: 4, head: 4 }]))
  await write('y', '<strong>y</strong>')
  await page.keyboard.press('Control+V')
  await waitBoth('$abxyc$ tail')
  await page.keyboard.press('Control+End')
  await renderedMath.waitFor({ state: 'visible' })
  assert.deepEqual(await editor.locator('.vsidian-math annotation').allTextContents(), ['abxyc'])
  await page.keyboard.press('Control+Z'); await waitBoth('$abxc$ tail')
  console.log('[PASS] 普通粗体粘贴到旧行内公式时只写入 TeX 原文，一次撤销恢复')

  const blockSource = '$$\na+b\n$$\n\nend'
  await page.evaluate(source => {
    window.replace(source)
    window.selectRanges([{ anchor: 0, head: 0 }])
  }, blockSource)
  await write('x USD\n\n', katexSpan('x') + ' USD')
  await page.keyboard.press('Control+V')
  const preservedBlock = 'x USD\n\n' + blockSource
  await waitBoth(preservedBlock)
  await page.evaluate(end => window.selectRanges([{ anchor: end, head: end }]), preservedBlock.length)
  await renderedMath.waitFor({ state: 'visible' })
  assert.deepEqual((await editor.locator('.vsidian-math annotation').allTextContents()).map(tex => tex.trim()), ['a+b'])
  console.log('[PASS] 富文本会破坏旧块公式时，用原剪贴板纯文本保留换行')

  const blockEnd = preservedBlock.lastIndexOf('$$') + 2
  await page.evaluate(at => window.selectRanges([{ anchor: at, head: at }]), blockEnd)
  const closingPlain = '\n\nUSD x'
  await write(closingPlain, 'USD ' + katexSpan('x'))
  await page.keyboard.press('Control+V')
  await waitBoth(preservedBlock.slice(0, blockEnd) + closingPlain + preservedBlock.slice(blockEnd))
  assert.deepEqual((await editor.locator('.vsidian-math annotation').allTextContents()).map(tex => tex.trim()), ['a+b'])
  console.log('[PASS] 块公式闭合行后的新内容保持独立段落，不被闭合行吞掉')
} finally { await browser.close() }
