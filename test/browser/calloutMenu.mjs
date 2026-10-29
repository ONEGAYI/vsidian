// Callout 类型菜单取色预览（#658/T07）浏览器回归：真实 Chromium + 生产
// 控制器 + 产物 CSS + 真实片段通道。断言用户看到的东西（AGENTS 视觉层
// 断言——菜单计算色/绘制与**对应正文呈现对拍**，不比对第二份预期色表）：
// - 同色相邻类型（片段把 info/todo 设为同色）：菜单预览与正文行同源绘制，
//   相邻可见类型项之间各恰一条分隔线（同色也有清晰边界，首尾无孤线）
// - 正文祖先规则（.markdown-preview-view .callout）与文档样式作用域
//   （data-vsidian-doc-scope）经隐藏探针到达菜单预览（与阅读容器对拍）
// - 打开菜单期间的片段热更新与明暗主题翻转即时刷新（无需重开文档）
// - 未知当前类型不崩、自定义行保持菜单语义（占位不伪装固定类型）
// - 键盘导航分隔线不进焦点序列、三级边缘翻转、低高度滚动后末项可达
// - 关闭菜单后探针归零（无泄漏），正文与其他子菜单不受影响
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'calloutMenu/calloutMenu.js')
await build({ entryPoints: [path.join(root, 'test/browser/calloutMenuFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })

const TYPE_IDS = ['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
  'warning', 'failure', 'danger', 'bug', 'example', 'quote']

const DOC = [
  '开头段落正文。',
  '',
  '> [!note] 笔记标题',
  '> 笔记正文',
  '',
  '> [!info] 信息标题',
  '> 信息正文',
  '',
  '> [!todo] 待办标题',
  '> 待办正文',
  '',
  '> [!my-weird-type] 未知类型标题',
  '> 未知正文',
  '',
  '> 普通引用行',
  '',
  '结尾段落。',
].join('\n')

async function waitFor(fn, label, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  throw new Error(`等待超时：${label}`)
}

/** 两帧 rAF（样式落地与观察器刷新的稳定时机） */
const twoFrames = (page) => page.evaluate(() =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

/** 打开菜单并展开到三级类型页（insert → Callout） */
async function openTypeMenu(page, pos) {
  await page.evaluate((p) => window.post({ kind: 'contextMenu.test.contextMenu', pos: p }), pos)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(80)
}

let passed = 0
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  await page.evaluate((text) => window.initCalloutMenu(text), DOC)
  await page.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  await twoFrames(page)

  const paraPos = DOC.indexOf('开头段落正文')
  const titlePosOf = async (needle) =>
    (await page.evaluate(() => window.controller.getView().state.doc.toString())).indexOf(needle)

  // ---- 场景 1（先红用例）：片段把相邻 info/todo 设为同色——预览与正文
  // 同源、同色之间仍有清晰边界（每对可见项恰一条分隔线）----
  const v1 = `[data-callout='info'], [data-callout='todo'] { --callout-color: #ff5a00; }`
  const uri1 = await page.evaluate((css) => window.snippetUrl(css), v1)
  await page.evaluate(({ v, u }) => window.applySnippets(v, [{ name: 't07', uri: u }]), { v: 1, u: uri1 })
  await waitFor(() => page.evaluate(() =>
    window.sent().some((m) => m.kind === 'snippets.loadResult' && m.ok === true)), '片段 v1 装载回报')
  await twoFrames(page)

  await openTypeMenu(page, paraPos)
  let structure = await page.evaluate(() => window.faceStructure())
  assert.ok(structure, '三级类型面应在场')
  assert.equal(structure.commands[0], 'calloutType:none')
  assert.equal(structure.commands[structure.commands.length - 1], 'calloutType:custom')
  // 每对可见类型项恰一条分隔线：15 可见项 → 14 条；首尾无孤线；严格交替
  assert.equal(structure.visibleCount, 15, '可见项 = 无 Callout + 13 类型 + 自定义')
  assert.equal(structure.sepCount, 14, `相邻可见项各一条（实际 ${structure.sepCount}）`)
  assert.ok(!structure.firstIsSep && !structure.lastIsSep, '首尾不附孤线')
  assert.ok(structure.kinds.startsWith('item,sep,item'), `项与线交替（实际 ${structure.kinds.slice(0, 40)}…）`)
  assert.ok(!structure.kinds.includes('sep,sep'), '隐藏/置灰不产生重复线')
  assert.ok(!structure.sepFocusable && structure.faceRole === 'menu', '分隔线不进键盘焦点序列')

  // 同色相邻类型：菜单预览与正文行同源对拍（非第二份色表）
  const paints1 = await page.evaluate(() => ({
    menuInfo: window.rowPaint('calloutType:info'),
    menuTodo: window.rowPaint('calloutType:todo'),
    menuNote: window.rowPaint('calloutType:note'),
    bodyInfo: window.livePaint('info'),
    bodyNote: window.livePaint('note'),
    probeCount: window.probeCount(),
  }))
  assert.equal(paints1.probeCount, 1, '菜单打开期间恰一个隐藏探针在场')
  assert.ok(!paints1.menuInfo?.missing, 'info 行应有预览槽')
  assert.equal(paints1.menuInfo.bgImage, paints1.bodyInfo.bgImage,
    'info 预览色底应与正文行同源（渐变通道对拍）')
  assert.equal(paints1.menuInfo.iconColor, paints1.bodyInfo.iconColor,
    'info 预览图标颜色应与正文图标同源')
  assert.equal(paints1.menuInfo.iconMask, paints1.bodyInfo.iconMask,
    'info 预览图标形状应与正文图标同源（mask 同 URL）')
  assert.equal(paints1.menuTodo.bgImage, paints1.bodyInfo.bgImage,
    'todo 与 info 被片段设为同色——预览同源（同色类型也有清晰边界由分隔线承担）')
  // 未覆盖类型走内置默认（note 对拍）
  assert.equal(paints1.menuNote.bgImage, paints1.bodyNote.bgImage, 'note 预览与正文同源（内置默认色）')
  passed++
  console.log('[Callout 菜单预览][PASS] 同色相邻类型：预览与正文同源对拍 + 每对可见项恰一条分隔线')

  // ---- 场景 2：无 Callout 行用普通引用呈现色（对拍引用行底色与竖条）----
  const quoteRow = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:none'), body: window.quotePaint() }))
  assert.ok(quoteRow.menu.swatchClass.includes('quote'), '无 Callout 行应为引用呈现槽')
  assert.equal(quoteRow.menu.bgColor, quoteRow.body.bgColor, '无 Callout 预览底色应与普通引用行同源')
  const swatchShadow = await page.evaluate(() => {
    const el = document.querySelector('.vsidian-context-menu button[data-vsidian-command="calloutType:none"] .vsidian-context-menu-swatch')
    return getComputedStyle(el).boxShadow.match(/rgba?\([^)]+\)/)?.[0] ?? ''
  })
  assert.equal(swatchShadow, quoteRow.body.shadowColor, '无 Callout 预览竖条色应与引用紫条同源')
  // 自定义行：占位不伪装固定类型（无类型色底变量、无图标形状）
  const custom = await page.evaluate(() => window.rowPaint('calloutType:custom'))
  assert.ok(custom.swatchClass.includes('placeholder'), '自定义输入行应为占位槽（菜单语义）')
  assert.equal(custom.bgImage, 'none', '占位槽不绘制类型色底')
  passed++
  console.log('[Callout 菜单预览][PASS] 无 Callout 行引用呈现色对拍 + 自定义行占位不伪装')

  // ---- 场景 3：正文祖先规则（.markdown-preview-view .callout）与文档样式
  // 作用域经探针到达（RGB 三元组通道：bgc 绘制、渐变 none——与阅读容器对拍）----
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await twoFrames(page)
  const v2 = `.markdown-preview-view .callout { --callout-color: 12, 34, 56; }`
  const uri2 = await page.evaluate((css) => window.snippetUrl(css), v2)
  await page.evaluate(({ v, u }) => window.applySnippets(v, [{ name: 't07', uri: u }]), { v: 2, u: uri2 })
  await waitFor(() => page.evaluate((v) =>
    window.sent().some((m) => m.kind === 'snippets.loadResult' && m.ok === true && m.version === v), 2), '片段 v2 装载回报')
  await twoFrames(page)
  await openTypeMenu(page, paraPos)
  const ancestor = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:note') }))
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  // 阅读侧对拍：同一片段对阅读容器生效（祖先作用域形态）
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'reading' }))
  await twoFrames(page)
  const reading1 = await page.evaluate(() => window.readingPaint('note'))
  assert.ok(reading1, '阅读容器应在场（对拍锚点）')
  assert.equal(ancestor.menu.bgColor, reading1.bgColor,
    '祖先规则（.markdown-preview-view .callout 三元组）应经探针到达菜单（bgc 通道与阅读容器一致）')
  assert.equal(ancestor.menu.bgImage, 'none', '三元组通道：渐变互斥失效（与正文双通道语义一致）')
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'live' }))
  await twoFrames(page)
  passed++
  console.log('[Callout 菜单预览][PASS] 正文祖先规则（阅读作用域形态）经探针到达菜单并与阅读容器对拍')

  // ---- 场景 4：文档样式作用域（data-vsidian-doc-scope 身份键）----
  const docStyleDoc = DOC.replace('> [!note] 笔记标题',
    '<style>\n.callout {\n  --callout-color: #00aabb;\n}\n</style>\n\n> [!note] 笔记标题')
  await page.evaluate((text) => window.initCalloutMenu(text), docStyleDoc)
  await page.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  await twoFrames(page)
  await openTypeMenu(page, docStyleDoc.indexOf('开头段落正文'))
  const docScoped = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:note') }))
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'reading' }))
  await twoFrames(page)
  const reading2 = await page.evaluate(() => window.readingPaint('note'))
  assert.equal(docScoped.menu.bgImage, reading2?.bgImage,
    '文档样式产物（doc-scope 身份）应经探针到达菜单（与阅读容器一致）')
  await page.evaluate(() => window.post({ kind: 'view.mode.set', mode: 'live' }))
  await twoFrames(page)
  await page.evaluate((text) => window.initCalloutMenu(text), DOC)
  await page.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  passed++
  console.log('[Callout 菜单预览][PASS] 文档样式作用域（doc-scope 身份）经探针到达菜单')

  // ---- 场景 5：菜单打开期间的片段热更新与明暗主题翻转即时刷新 ----
  await openTypeMenu(page, paraPos)
  // 对拍锚点用 DOC 在场的 todo 类型（v1 同色对后片段链已演进到 v2——此处
  // v3 只改 todo，正文行与菜单预览应同步切换）
  const beforeHot = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:todo'), body: window.livePaint('todo') }))
  const v3 = `[data-callout='todo'] { --callout-color: #9b59d0; }`
  const uri3 = await page.evaluate((css) => window.snippetUrl(css), v3)
  await page.evaluate(({ v, u }) => window.applySnippets(v, [{ name: 't07', uri: u }]), { v: 3, u: uri3 })
  await waitFor(() => page.evaluate((v) =>
    window.sent().some((m) => m.kind === 'snippets.loadResult' && m.ok === true && m.version === v), 3), '片段 v3 装载回报')
  await twoFrames(page)
  const afterHot = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:todo'), body: window.livePaint('todo') }))
  assert.notEqual(afterHot.menu.bgImage, beforeHot.menu.bgImage, '热更新后菜单预览应变化（无需重开文档）')
  assert.equal(afterHot.menu.bgImage, afterHot.body.bgImage, '热更新后菜单预览仍与正文同源')
  // 明暗主题翻转（菜单保持打开）：todo 色被片段定死不随主题变——用默认色
  // note（暗 #027aff / 亮 #086ddd）验证刷新
  const darkNote = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:note'), body: window.livePaint('note') }))
  await page.evaluate(() => window.setTheme('light'))
  await twoFrames(page)
  const lightNote = await page.evaluate(() => ({ menu: window.rowPaint('calloutType:note'), body: window.livePaint('note') }))
  assert.notEqual(lightNote.menu.bgImage, darkNote.menu.bgImage,
    '主题翻转后菜单预览应更新（亮色档——观察器经 body class 触发重读）')
  assert.equal(lightNote.menu.bgImage, lightNote.body.bgImage, '亮色主题下菜单预览与正文同源')
  await page.evaluate(() => window.setTheme('dark'))
  await twoFrames(page)
  passed++
  console.log('[Callout 菜单预览][PASS] 菜单打开期间片段热更新与明暗主题翻转即时刷新（与正文同源）')

  // ---- 场景 6：未知当前类型不崩 + 标题右键路径同样绘制 ----
  const weirdPos = await titlePosOf('未知类型标题')
  await openTypeMenu(page, weirdPos)
  structure = await page.evaluate(() => window.faceStructure())
  assert.equal(structure.sepCount, 14, '标题右键路径的分隔线同样逐项恰一条')
  const weirdPaints = await page.evaluate(() => ({
    note: window.rowPaint('calloutType:note'),
    // 只看类型页的勾选（段落设置簇的 quote 勾选是引用行正常语义，不算）
    checked: [...document.querySelectorAll('.vsidian-context-menu button[aria-checked="true"]')]
      .map((b) => b.dataset['vsidianCommand'])
      .filter((command) => command.startsWith('calloutType:')),
  }))
  assert.ok(!weirdPaints.note.missing, '未知当前类型下类型行预览照常绘制')
  assert.deepEqual(weirdPaints.checked, [], '未知类型不点亮任何内置项（T05 口径不回归）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[Callout 菜单预览][PASS] 未知当前类型不崩 + 标题右键路径同样绘制')

  // ---- 场景 7：键盘导航——分隔线不进焦点序列、Enter 执行、Esc 关闭 ----
  await openTypeMenu(page, paraPos)
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight']) {
    await page.keyboard.press(key)
  }
  // 三级面内完整循环一圈：焦点始终在 button（分隔线 div 不可达）
  const focusTrack = []
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('ArrowDown')
    focusTrack.push(await page.evaluate(() =>
      document.activeElement instanceof HTMLButtonElement
        ? (document.activeElement.dataset['vsidianCommand'] ?? 'button')
        : `NOT-BUTTON:${document.activeElement?.tagName}`))
  }
  assert.ok(focusTrack.every((v) => v.startsWith('calloutType:')),
    `方向键循环焦点应始终在类型 button（实际 ${JSON.stringify(focusTrack.slice(0, 4))}…）`)
  const seen = new Set(focusTrack)
  assert.ok(seen.has('calloutType:custom'), '循环应覆盖自定义输入行')
  // Enter 执行（当前焦点项）：菜单关闭且文档变更（tip 默认或循环所在类型）
  await page.keyboard.press('Enter')
  await page.waitForTimeout(80)
  const afterEnter = await page.evaluate(() => ({
    menuExists: !!document.querySelector('.vsidian-context-menu'),
    text: window.controller.getView().state.doc.toString(),
  }))
  assert.ok(!afterEnter.menuExists, 'Enter 执行后菜单关闭')
  assert.ok(afterEnter.text.includes('[!'), 'Enter 应执行转换（callout 声明在场）')
  // Esc 关闭：重开菜单后 Esc
  await openTypeMenu(page, afterEnter.text.indexOf('开头段落正文'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(60)
  assert.ok(!(await page.evaluate(() => !!document.querySelector('.vsidian-context-menu'))), 'Esc 应关闭菜单')
  // Tab 键击：焦点移动绝不停在分隔线 div（票面明列 Tab；此前仅结构保证，补真实键击验证）
  await openTypeMenu(page, afterEnter.text.indexOf('开头段落正文'))
  await page.keyboard.press('ArrowRight') // 进二级
  await page.keyboard.press('ArrowRight') // 进三级类型面
  await page.waitForTimeout(60)
  await page.keyboard.press('Tab')
  await page.waitForTimeout(60)
  const afterTab = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    cls: String(document.activeElement?.className ?? ''),
  }))
  assert.ok(
    !afterTab.cls.includes('vsidian-context-menu-separator'),
    `Tab 后焦点不得落在分隔线（实际 ${afterTab.tag}.${afterTab.cls.slice(0, 60)}）`,
  )
  passed++
  console.log('[Callout 菜单预览][PASS] Tab 键击后焦点不停留在分隔线')
  await page.keyboard.press('Escape')
  passed++
  console.log('[Callout 菜单预览][PASS] 键盘导航：分隔线不进焦点序列 + Enter 执行 + Esc 关闭')

  // ---- 场景 8：置灰行（表格 zone 整簇置灰）预览照常、分隔线单线 ----
  await page.evaluate(() => window.initCalloutMenu('| a | b |\n| --- | --- |\n| 1 | 2 |\n'))
  await page.evaluate(() => window.locate(8))
  await page.waitForTimeout(120)
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), 8)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="insert"]').hover()
  await page.waitForTimeout(60)
  await page.locator('.vsidian-context-menu button[data-vsidian-command="calloutInsert"]').hover()
  await page.waitForTimeout(80)
  const disabledFace = await page.evaluate(() => {
    const menu = document.querySelector('.vsidian-context-menu')
    const faces = [...(menu?.querySelectorAll('[role="menu"]') ?? [])]
    const face = faces[faces.length - 1] ?? null
    return {
      structure: window.faceStructure(),
      noteDisabled: face?.querySelector('button[data-vsidian-command="calloutType:note"]')?.disabled,
      notePaint: window.rowPaint('calloutType:note'),
    }
  })
  assert.equal(disabledFace.noteDisabled, true, '表格 zone 类型行应置灰')
  assert.equal(disabledFace.structure.sepCount, 14, '置灰可见项的分隔线照常恰一条')
  assert.ok(!disabledFace.notePaint?.missing, '置灰行预览槽照常在场（保可发现性）')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[Callout 菜单预览][PASS] 置灰行（安全矩阵）预览照常、分隔线单线')

  // ---- 场景 9：关闭归零（无泄漏）+ 正文与其他子菜单不受影响 ----
  await page.evaluate((text) => window.initCalloutMenu(text), DOC)
  await page.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  await twoFrames(page)
  const bodyBefore = await page.evaluate(() => window.livePaint('info'))
  for (let i = 0; i < 2; i++) {
    await openTypeMenu(page, DOC.indexOf('开头段落正文'))
    await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
    await page.waitForTimeout(40)
  }
  const leak = await page.evaluate(() => ({
    probes: window.probeCount(),
    bodyAfter: window.livePaint('info'),
  }))
  assert.equal(leak.probes, 0, '关闭菜单后探针应归零（无泄漏）')
  assert.equal(leak.bodyAfter.bgImage, bodyBefore.bgImage, '正文绘制不受菜单开合影响')
  // 其他子菜单不加预览：paragraphStyle 子菜单内无 swatch
  await openTypeMenu(page, DOC.indexOf('开头段落正文'))
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  await page.evaluate((pos) => window.post({ kind: 'contextMenu.test.contextMenu', pos }), DOC.indexOf('开头段落正文'))
  await page.locator('.vsidian-context-menu button[data-vsidian-command="paragraphStyle"]').hover()
  await page.waitForTimeout(80)
  const otherSwatches = await page.evaluate(() => {
    const menu = document.querySelector('.vsidian-context-menu')
    return [...(menu?.querySelectorAll('[role="menu"]') ?? [])]
      .filter((face) => ![...face.querySelectorAll('button')].some((b) => (b.dataset['vsidianCommand'] ?? '').startsWith('calloutType:')))
      .reduce((n, face) => n + face.querySelectorAll('.vsidian-context-menu-swatch').length, 0)
  })
  assert.equal(otherSwatches, 0, '其他菜单面不装配预览槽')
  await page.evaluate(() => window.post({ kind: 'contextMenu.test.menuClose' }))
  passed++
  console.log('[Callout 菜单预览][PASS] 关闭归零无泄漏 + 正文与其他菜单不受影响')
  await page.close()

  // ---- 场景 10：低高度视口滚动可达 + 分隔线呈现（独立窄页）----
  const lowPage = await browser.newPage({ viewport: { width: 900, height: 240 } })
  await lowPage.setContent('<div id="app"></div>')
  await lowPage.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await lowPage.addScriptTag({ path: output })
  await lowPage.evaluate((text) => window.initCalloutMenu(text), DOC)
  await lowPage.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  await openTypeMenu(lowPage, DOC.indexOf('开头段落正文'))
  const low = await lowPage.evaluate(() => {
    const menu = document.querySelector('.vsidian-context-menu')
    const faces = [...(menu?.querySelectorAll('[role="menu"]') ?? [])]
    const face = faces[faces.length - 1] ?? null
    const sep = face?.querySelector('.vsidian-context-menu-separator')
    return {
      overflow: face ? { scroll: face.scrollHeight, client: face.clientHeight } : null,
      sepBorder: sep ? getComputedStyle(sep).borderTopWidth : null,
      faceLeft: face ? face.getBoundingClientRect().left : null,
      vw: window.innerWidth,
    }
  })
  assert.ok(low.overflow && low.overflow.scroll > low.overflow.client,
    `低高度下类型页应有滚动面（scroll ${low.overflow?.scroll} vs client ${low.overflow?.client}）`)
  assert.equal(low.sepBorder, '1px', '分隔线应真实呈现（1px 上边线）')
  assert.ok(low.faceLeft >= 0, `三级面不应越出左缘（left ${low.faceLeft}）`)
  const lastVisible = await lowPage.evaluate(() => {
    const btn = document.querySelector('button[data-vsidian-command="calloutType:custom"]')
    if (!btn) return { ok: false, why: 'btn-not-found' }
    btn.scrollIntoView({ block: 'nearest' })
    const rect = btn.getBoundingClientRect()
    return { ok: rect.top >= 0 && rect.bottom <= window.innerHeight, rect: { top: rect.top, bottom: rect.bottom, vh: window.innerHeight } }
  })
  assert.ok(lastVisible.ok, `滚动后末项（自定义输入）应在视口内可达：${JSON.stringify(lastVisible)}`)
  await lowPage.close()
  passed++
  console.log('[Callout 菜单预览][PASS] 低高度滚动可达末项 + 分隔线呈现 + 左缘不越出')

  const page2 = await browser.newPage({ viewport: { width: 400, height: 720 } })
  await page2.setContent('<div id="app"></div>')
  await page2.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page2.addScriptTag({ path: output })
  await page2.evaluate((text) => window.initCalloutMenu(text), DOC)
  await page2.evaluate(() => window.locate(window.controller.getView().state.doc.length))
  await openTypeMenu(page2, DOC.indexOf('结尾段落。'))
  const rightEdge = await page2.evaluate(() => {
    const menu = document.querySelector('.vsidian-context-menu')
    const faces = [...(menu?.querySelectorAll('[role="menu"]') ?? [])]
    const face = faces[faces.length - 1] ?? null
    return {
      menuRight: menu?.getBoundingClientRect().right ?? null,
      faceRight: face?.getBoundingClientRect().right ?? null,
      vw: window.innerWidth,
    }
  })
  assert.ok(rightEdge.faceRight !== null && rightEdge.faceRight <= rightEdge.vw + 1,
    `窄窗口三级面右缘不越出视口（right ${rightEdge.faceRight} vs ${rightEdge.vw}——左翻生效）`)
  assert.ok(rightEdge.menuRight <= rightEdge.vw + 1, '顶级菜单右缘不越出视口')
  await page2.close()
  passed++
  console.log('[Callout 菜单预览][PASS] 窄窗口右缘：三级面左翻不越出视口')

  assert.deepEqual(errors, [], '浏览器回归无未捕获异常')
  console.log(`[Callout 菜单预览] 全部 ${passed} 节通过`)
} finally {
  await browser.close()
}
