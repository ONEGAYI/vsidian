// 可读文本悬停的原生浏览器回归（#340 / P3-08）：真实布局（Chromium）下
// 真实指针驱动生产控制器——text 悬停浮层的载荷与 token 请求、绘制层着色
// （计算色断言——视觉层断言对象是用户看到的颜色而非 DOM 存在性）、行号
// 与语言级字体、#line 定位 / #range 硬窗口（2026-10-04 修正口径：正常组
// 合 #line=4;range=3-5、报错例 #line=10;range=3-5）、token 分层覆盖与版本
// 竞态（过期 token 不覆盖）、外观广播静默重载、准入错误分态与零写回。
// 宿主回包由脚本注入（fixture.respond → handleHostMessage 同入口）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const bundle = artifactPath(root, 'textHover/textHover.js')
await build({ entryPoints: [path.join(root, 'test/browser/textHoverFixture.ts')],
  bundle: true, outfile: bundle, format: 'iife',
  loader: { '.woff2': 'file', '.svg': 'file' }, assetNames: 'assets/[name]' })

const PARENT_DOC = [
  '# 父文档',
  '',
  '代码全文：[[code.ts]] 与定位 [[code.ts#line=2]]。',
  '',
  '窗口：[[code.ts#range=2-3]] 与组合 [[code.ts#line=2;range=2-3]]。',
  '',
  '报错锚点：[[code.ts#line=10;range=3-5]]、[[code.ts#line=0]]、[[code.ts#range=5-2]]。',
  '',
  '准入失败：[[bin.dat]] 与 [[plain.txt]]。',
  '',
  'Markdown 对照：[[note.md]]。',
  '',
].join('\n')

/** 目标文本（6 行；token 数据按此手算） */
const CODE_TEXT = ['const alpha = 1;', 'const bravo = 2;', 'const charlie = 3;', 'const delta = 4;', 'const echo = 5;', 'const foxtrot = 6'].join('\n')

const OPEN_WAIT = 700
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

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
  await page.evaluate((text) => window.initTextDoc(text), PARENT_DOC)
  await page.locator('a.vsidian-wikilink').first().waitFor()

  const hoverLinkWith = async (pattern) => {
    const link = page.locator('a.vsidian-wikilink').filter({ hasText: pattern }).first()
    await link.hover()
    await page.waitForTimeout(OPEN_WAIT)
  }
  const sentSince = async (from) =>
    (await page.evaluate(() => window.textSent())).slice(from)
  const textView = () => page.evaluate(() => window.readTextView())
  const editRequestCount = async () =>
    (await page.evaluate(() => window.textSent())).filter((m) => m.kind === 'edit.request').length

  /** text 成功回包注入（与 documentSession 出站形态一致） */
  const respondTextResult = (payload) => page.evaluate((args) => window.respond({
    kind: 'hover.result',
    reqId: args.reqId,
    instanceId: args.instanceId,
    ok: true,
    contentKind: 'text',
    target: { fsPath: 'D:\\notes\\code.ts', relPath: args.target ?? 'code.ts' },
    version: args.version ?? 3,
    text: args.text,
    range: { start: 0, end: args.text.length },
    scope: { kind: 'full' },
    textNav: {
      languageId: 'typescript', hasWindow: false, beginLine: 1, endLine: 6,
      locateLine: 1, jumpLine: 1, totalLines: 6,
      fontFamily: 'Consolas, monospace', fontSize: 15, lineNumbers: true,
      ...(args.nav ?? {}),
    },
  }), payload)

  const failResult = (reqId, instanceId, reason, anchor, anchorDetail) =>
    page.evaluate((args) => window.respond({
      kind: 'hover.result', reqId: args.reqId, instanceId: args.instanceId, ok: false,
      reason: args.reason, ...(args.anchor !== undefined ? { anchor: args.anchor } : {}),
      ...(args.anchorDetail !== undefined ? { anchorDetail: args.anchorDetail } : {}),
    }), { reqId, instanceId, reason, anchor, anchorDetail })

  const lastRequest = async (from) => {
    const msgs = await sentSince(from)
    return msgs.findLast((m) => m.kind === 'hover.request')
  }
  const lastTokenRequest = async (from) => {
    const msgs = await sentSince(from)
    return msgs.findLast((m) => m.kind === 'hover.tokens.request')
  }

  // ---- 场景 A：全文 text 悬停 → 载荷/视图/行号/字体/token 请求 ----
  {
    let mark = 0
    await hoverLinkWith(/^code\.ts$/)
    const req = await lastRequest(mark) 
    assert.ok(req, '应发出 hover.request')
    assert.equal(req.target, 'code.ts', 'target 为双链原文（| 前段）')
    await respondTextResult({ reqId: req.reqId, instanceId: req.instanceId, text: CODE_TEXT })
    let view = await textView()
    assert.equal(view.open, true, 'text 装载后浮层在场')
    assert.equal(view.lineCount, 6, '6 行全渲染（无 range 全文——行数在虚拟缓冲内）')
    assert.deepEqual(view.gutterNumbers.slice(0, 6), ['1', '2', '3', '4', '5', '6'], '行号 1-based 从 1 起')
    assert.ok(view.fontSize.includes('15px'), `语言级字号生效（computed=${view.fontSize}）`)
    assert.ok(view.fontFamily.toLowerCase().includes('consolas'), `语言级字体族生效（computed=${view.fontFamily}）`)
    // token 请求出站（窗口与版本配对）
    mark = (await page.evaluate(() => window.textSent())).length
    const tokenReq = await lastTokenRequest(0)
    assert.ok(tokenReq, '装载后应发出 hover.tokens.request')
    if (tokenReq?.kind === 'hover.tokens.request') {
      assert.equal(tokenReq.fsPath, 'D:\\notes\\code.ts')
      assert.equal(tokenReq.version, 3)
      assert.equal(tokenReq.beginLine, 1)
      assert.equal(tokenReq.endLine, 6)
    }
    passed++
    // token 注入：语法层着色（第 1 行 const → #569cd6 = rgb(86,156,214)）
    await page.evaluate((args) => window.respond({
      kind: 'hover.tokens', reqId: args.reqId, instanceId: args.instanceId, ok: true,
      fsPath: 'D:\\notes\\code.ts', version: 3, layer: 'textmate',
      colors: ['#569cd6', '#9cdcfe'], tokens: [0, 0, 5, 0, 0, 0, 6, 5, 1, 0],
    }), tokenReq)
    view = await textView()
    const kw = view.spans.find((s) => s.text === 'const')
    assert.ok(kw, 'const span 在场')
    assert.ok(kw.color.includes('86, 156, 214'), `语法层着色为真实计算色（得 ${kw.color}）`)
    assert.ok(kw.painted && kw.inViewport, '着色 span 绘制层可见')
    passed++
    // 语义层覆盖：alpha → #00ffaa（rgb(0,255,170)）
    await page.evaluate((args) => window.respond({
      kind: 'hover.tokens', reqId: args.reqId, instanceId: args.instanceId, ok: true,
      fsPath: 'D:\\notes\\code.ts', version: 3, layer: 'semantic',
      colors: ['#00ffaa'], tokens: [0, 6, 5, 0, 0],
    }), tokenReq)
    view = await textView()
    const ident = view.spans.find((s) => s.text === 'alpha')
    assert.ok(ident.color.includes('0, 255, 170'), `语义层覆盖为 #00ffaa（得 ${ident.color}）`)
    const kw2 = view.spans.find((s) => s.text === 'const')
    assert.ok(kw2.color.includes('86, 156, 214'), '语法层未被语义回包抹掉')
    passed++
    // 版本竞态：过期 token（version 2）到达不覆盖
    await page.evaluate((args) => window.respond({
      kind: 'hover.tokens', reqId: args.reqId, instanceId: args.instanceId, ok: true,
      fsPath: 'D:\\notes\\code.ts', version: 2, layer: 'semantic',
      colors: ['#ff0000'], tokens: [0, 6, 5, 0, 0],
    }), tokenReq)
    view = await textView()
    const ident2 = view.spans.find((s) => s.text === 'alpha')
    assert.ok(ident2.color.includes('0, 255, 170'), '过期 token 不覆盖新正文颜色')
    passed++
    void mark
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 B：#line=2 定位（无 range 全文可滚——长文撑出滚动域） ----
  {
    const LONG_TEXT = Array.from({ length: 60 }, (_, i) => `const field${i} = ${i};`).join('\n')
    await hoverLinkWith(/#line=2$/)
    const req = await lastRequest(0)
    assert.ok(req)
    await respondTextResult({
      reqId: req.reqId, instanceId: req.instanceId, text: LONG_TEXT,
      nav: { locateLine: 2, jumpLine: 2, endLine: 60, totalLines: 60 },
    })
    await page.waitForTimeout(120)
    const view = await textView()
    assert.ok(view.scrollTop > 0, `#line=2 首开定位滚动（scrollTop=${view.scrollTop}）`)
    assert.equal(view.scrollHeight > view.clientHeight, true, '全文可滚（内容超出视口）')
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 B2：长行横向滚动归浮层滚动区（2026-10-05 验收 5b 改版） ----
  // 横条贴浮窗视口底缘的结构前提：溢出计入浮层 scrollEl（scrollWidth 超出、
  // scrollLeft 可推进），code 区不再自持横滚（赋值回零），行号列 sticky 钉
  // 视口左缘（横滚后视觉位置不动）。滚动条本体 headless 不渲染（5b 实测
  // 盲区），断言落在滚动几何上——条贴视口底缘 ⟺ 滚动容器是 scrollEl。
  {
    const WIDE_TEXT = [
      'const alpha = 1;',
      `const bravo = 'x'.repeat(300); // ${'长'.repeat(200)}`,
      'const charlie = 3;',
      'const delta = 4;',
      'const echo = 5;',
      'const foxtrot = 6',
    ].join('\n')
    await hoverLinkWith(/^code\.ts$/)
    const req = await lastRequest(0)
    assert.ok(req)
    await respondTextResult({ reqId: req.reqId, instanceId: req.instanceId, text: WIDE_TEXT })
    await page.waitForTimeout(120)
    const geo = await page.evaluate(() => window.readTextHScroll())
    assert.equal(geo.present, true, '横滚几何探针要素在场（浮层 + code + gutter）')
    assert.ok(geo.scrollWidth > geo.clientWidth + 50,
      `长行溢出计入浮层滚动区（scrollWidth=${geo.scrollWidth} > clientWidth=${geo.clientWidth}）`)
    assert.equal(geo.codeSelfScroll, 0, 'code 区不自持横滚（赋 scrollLeft 回零——溢出走宿主滚动区）')
    assert.equal(geo.scrollLeftApplied, 80, `浮层滚动区横滚可推进（实测 ${geo.scrollLeftApplied}）`)
    assert.ok(geo.gutterAt80 < 1,
      `横滚后行号列钉视口左缘（视觉位置 ${geo.gutterAt80.toFixed(2)}px，未滚时 ${geo.gutterAt0.toFixed(2)}px——sticky 吸附）`)
    assert.ok(geo.gutterWidth > 0, '行号列在布局中占宽')
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 C：#range=2-3 硬窗口（范围外不渲染、不可滚达） ----
  {
    await hoverLinkWith(/#range=2-3$/)
    const req = await lastRequest(0) 
    assert.ok(req)
    await respondTextResult({
      reqId: req.reqId, instanceId: req.instanceId,
      text: 'const bravo = 2;\nconst charlie = 3;',
      nav: { hasWindow: true, beginLine: 2, endLine: 3, locateLine: 2, jumpLine: 2 },
    })
    const view = await textView()
    assert.deepEqual(view.gutterNumbers, ['2', '3'], '窗口内行号（绝对 2/3）')
    assert.equal(view.spans.filter((s) => s.text.includes('alpha') || s.text.includes('delta')).length, 0,
      '窗口外内容不渲染')
    // 硬窗口不可滚达：内容高度不超视口（2 行 × 22.5px ≈ 45px < 400px）
    assert.ok(view.scrollHeight < 400, `硬窗口不可滚达（scrollHeight=${view.scrollHeight}）`)
    // 组合窗口内定位（修正口径正常例在单测钉住；此处验证窗口载荷链路）
    const tokenReq = await lastTokenRequest(0)
    if (tokenReq?.kind === 'hover.tokens.request') {
      assert.equal(tokenReq.beginLine, 2, 'token 请求按窗口裁剪（begin=2）')
      assert.equal(tokenReq.endLine, 3)
    }
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 D：锚点非法分态（就地报错不静默回顶——修正口径显式报错例） ----
  {
    await hoverLinkWith(/#line=10;range=3-5$/)
    let req = await lastRequest(0) 
    assert.ok(req)
    await failResult(req.reqId, req.instanceId, 'anchor-invalid', 'line=10;range=3-5', 'line-outside-window')
    let view = await textView()
    assert.equal(view.stateVisible, true, '锚点非法呈就地错误态')
    assert.ok(view.stateText.includes('line 不在 range 窗口内') && view.stateText.includes('#line=10;range=3-5'),
      `报错文案分态（line 越窗：得 "${view.stateText}"）`)
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)

    await hoverLinkWith(/#line=0$/)
    req = await lastRequest(0) 
    await failResult(req.reqId, req.instanceId, 'anchor-invalid', 'line=0', 'format')
    view = await textView()
    assert.ok(view.stateText.includes('行号为正整数') && view.stateText.includes('#line=0'), '0 值锚点报 format 分态')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)

    await hoverLinkWith(/#range=5-2$/)
    req = await lastRequest(0) 
    await failResult(req.reqId, req.instanceId, 'anchor-invalid', 'range=5-2', 'range-order')
    view = await textView()
    assert.ok(view.stateText.includes('起始行不得大于结束行') && view.stateText.includes('#range=5-2'), 'B>E 报 range-order 分态')
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 E：准入错误分态（二进制/非法编码——不读完整内容） ----
  {
    await hoverLinkWith(/bin\.dat/)
    let req = await lastRequest(0) 
    await failResult(req.reqId, req.instanceId, 'binary-file')
    let view = await textView()
    assert.ok(view.stateText.includes('二进制文件'), '二进制分态文案')
    assert.ok(view.stateText.includes('bin.dat'), '错误文案携带目标原文')
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
    void req
  }

  // ---- 场景 F：原生无高亮（无 token 数据）纯文本呈现 + 外观广播重载 ----
  {
    await hoverLinkWith(/plain\.txt/)
    const req = await lastRequest(0) 
    assert.ok(req)
    await respondTextResult({
      reqId: req.reqId, instanceId: req.instanceId,
      text: 'plain text line one\nplain text line two',
      target: 'plain.txt',
      nav: { languageId: 'plaintext', totalLines: 2, endLine: 2 },
    })
    let view = await textView()
    assert.equal(view.lineCount, 2, '纯文本行渲染')
    assert.ok(view.spans.every((s) => s.painted), '纯文本 span 绘制可见')
    const plainColor = view.spans[0].color
    assert.ok(plainColor.length > 0, `纯文本前景色来自 CSS 变量（${plainColor}）`)
    passed++
    // 外观广播：appearance.changed → text 浮层静默重载（重发 hover.request）
    const before = (await page.evaluate(() => window.textSent())).length
    await page.evaluate(() => window.respond({ kind: 'appearance.changed', generation: 1 }))
    await page.waitForTimeout(120)
    const afterMsgs = await sentSince(before)
    assert.ok(afterMsgs.some((m) => m.kind === 'hover.request'), '外观广播触发 text 浮层静默重载')
    // 重载后注入新版本回包与新 token（版本配对链路完整走通）
    const req2 = afterMsgs.findLast((m) => m.kind === 'hover.request')
    if (req2?.kind === 'hover.request') {
      await respondTextResult({
        reqId: req2.reqId, instanceId: req2.instanceId,
        text: 'plain text line one\nplain text line two',
        target: 'plain.txt',
        version: 4,
        nav: { languageId: 'plaintext', totalLines: 2, endLine: 2 },
      })
      view = await textView()
      assert.equal(view.lineCount, 2, '重载后内容恢复')
    }
    passed++
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
  }

  // ---- 场景 G：Markdown 对照（既有 Reading 通道不受 text 通道影响） ----
  {
    await hoverLinkWith(/note\.md/)
    const req = await lastRequest(0) 
    assert.ok(req)
    await page.evaluate((args) => window.respond({
      kind: 'hover.result', reqId: args.reqId, instanceId: args.instanceId, ok: true,
      contentKind: 'markdown',
      target: { fsPath: 'D:\\notes\\note.md', relPath: 'note.md' },
      version: 1, text: '# 笔记标题\n\n正文段。', range: { start: 0, end: 16 }, scope: { kind: 'full' },
    }), req)
    const view = await textView()
    assert.equal(view.lineCount, 0, 'Markdown 装载不走文本视图（Reading 块渲染）')
    assert.equal(view.stateVisible !== true, true, 'Markdown 无错误态')
    passed++
    await page.keyboard.press('Escape')
  }

  // ---- 收尾：零写回（全程无 edit.request） ----
  assert.equal(await editRequestCount(), 0, 'text 悬停全程零写回（edit.request 为 0）')
  passed++
  assert.deepEqual(errors, [], '页面零未捕获异常')

  console.log(`textHover: ${passed} 项断言全部通过`)
} finally {
  await browser.close()
}
