// #140 frontmatter 只读表格 + Popover 编辑浏览器回归（Popover 改版）：
// 真实键鼠链路（Playwright 原生键盘/鼠标）。合成 keydown 测不到
// input.type 回流路径——Popover 输入框键入必须经真实键盘验证
// edit.request 出站与表格回流；光标引导（成型态不暴露源码）必须经真实
// 鼠标点击与方向键验证弹回。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'frontmatterTable/frontmatterTable.js')
await build({ entryPoints: [path.join(root, 'test/browser/frontmatterTableFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })
const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  async function openPage() {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setContent('<html><body><div id="app"></div></body></html>')
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.addScriptTag({ path: output })
    return { page, errors }
  }
  const editRequests = (page) => page.evaluate(() =>
    window.fmSent().filter((m) => m.kind === 'edit.request')
      .map(({ seq, baseVersion, changes }) => ({ seq, baseVersion, changes })))

  const FM_DOC = '---\ntitle: hello\ncount: 3\n---\n\n正文段落。\n'
  const ARRAY_DOC = '---\ntags:\n  - alpha\n  - beta\n---\n\n正文。\n'
  // 光标引导目标：闭合行之后（body 起点）
  const FM_BODY_START = FM_DOC.indexOf('---', 4) + 4
  const ARRAY_BODY_START = ARRAY_DOC.indexOf('---', 4) + 4

  // ---- live：成型只读卡片绘制层可见（格有面积、标题栏与修改按钮在场、
  //      格内编辑控件退役） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    const rows = page.locator('.vsidian-fm-row')
    assert.equal(await rows.count(), 2, '两个键值行应成型为网格行')
    const value = page.locator('.vsidian-fm-row .vsidian-fm-value').first()
    const box = await value.boundingBox()
    assert.ok(box && box.width > 10 && box.height > 8, '值格应有可见面积（绘制层呈现）')
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el ? el.closest('.vsidian-fm-table, .vsidian-fm-row, .cm-line')?.className ?? '' : ''
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    assert.ok(String(hit).includes('vsidian-fm'), '值格中心点应命中表格元素（非隐藏层）')
    // 标题栏 + 修改按钮可见（绘制层在场）
    const header = page.locator('.vsidian-fm-header')
    assert.equal(await header.count(), 1, '标题栏应在场')
    const title = header.locator('.vsidian-fm-header-title')
    assert.equal((await title.textContent()), '属性', '标题栏文字（i18n）')
    const editBtn = page.locator('button.vsidian-fm-edit')
    const editBox = await editBtn.boundingBox()
    assert.ok(editBox && editBox.width > 10 && editBox.height > 10, '修改按钮应有可见面积')
    // 格内编辑时代的控件全部退役
    assert.equal(await page.locator('.vsidian-fm-add-entry').count(), 0, '闭合行「添加属性」按钮应退役')
    assert.equal(await page.locator('.vsidian-fm-remove').count(), 0, '行内删除按钮应退役')
    assert.equal(await page.locator('.vsidian-fm-add-item').count(), 0, '行内加项按钮应退役')
    // 冒号分隔不占格位（display:none）
    const sepVisible = await page.locator('.vsidian-fm-sep').first().evaluate((el) =>
      getComputedStyle(el).display)
    assert.equal(sepVisible, 'none', '冒号分隔应在绘制层隐藏')
    // 卡片边框与键列观感（参考图：完整边框、键列常规字重）
    const keyStyle = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.vsidian-fm-row > .vsidian-fm-key'))
      return { weight: cs.fontWeight, color: cs.color }
    })
    assert.equal(keyStyle.weight, '400', `键列应为常规字重: ${JSON.stringify(keyStyle)}`)
    // 观感二轮（参考图对齐）：行级 grid 撑满（不限宽——限宽曾使行级背景
    // /边框与头部行错位，右侧形成编辑器底色空洞与断边）、行区透明（撞色
    // 边界感 = 边框 + 标题栏微亮条）、头部行高紧凑（buffer 隐藏，约 1.2
    // 倍正文行高）、键名弱化 + 标量 T 图标
    const geom = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('.cm-line.vsidian-fm-card-line')]
      const widths = lines.map((l) => l.getBoundingClientRect().width)
      const headerLine = document.querySelector('.cm-line.vsidian-fm-card-edge-top')
      const rowLine = document.querySelector('.cm-line.vsidian-fm-row')
      const key = document.querySelector('.vsidian-fm-row > .vsidian-fm-key')
      return {
        widthSpread: Math.max(...widths) - Math.min(...widths),
        cardBg: getComputedStyle(rowLine).backgroundColor,
        headerH: headerLine.getBoundingClientRect().height,
        rowH: rowLine.getBoundingClientRect().height,
        keyOpacity: getComputedStyle(key).opacity,
        keyIcon: getComputedStyle(key, '::before').content,
      }
    })
    assert.ok(geom.widthSpread < 2, `卡片各行行宽应一致（不限宽，防右侧空洞）: ${JSON.stringify(geom)}`)
    assert.equal(geom.cardBg, 'rgba(0, 0, 0, 0)', `行区应透明（不铺底色）: ${geom.cardBg}`)
    assert.ok(geom.headerH < geom.rowH * 2, `头部行高应紧凑（< 2 倍键值行高）: ${JSON.stringify(geom)}`)
    assert.equal(geom.keyOpacity, '0.7', `键名应弱化（参考图 key 浅）: ${geom.keyOpacity}`)
    assert.equal(geom.keyIcon, '"T"', `标量键名前应有 T 类型图标: ${geom.keyIcon}`)
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：数组宿主行列表形类型图标（观感二轮，参考图行首图标） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), ARRAY_DOC)
    const icon = await page.evaluate(() => {
      const host = document.querySelector('.vsidian-fm-row.vsidian-fm-list-row > .vsidian-fm-key')
      return host ? getComputedStyle(host, '::before').content : null
    })
    assert.equal(icon, '"≡"', `数组宿主行键名应为列表形图标: ${icon}`)
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：光标进入头区不显源码且被弹到闭合行后（真实鼠标 + 方向键，
  //      零写回） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    // 真实鼠标点击值格：光标被引导到 body 起点（不是值区间）
    await page.locator('.vsidian-fm-row .vsidian-fm-value').first().click()
    assert.equal(await page.evaluate(() => window.fmHead()), FM_BODY_START,
      '点击头区后光标应被弹到闭合行后（body 起点）')
    // 方向键向上尝试进头区：仍被弹回，文档字节不变
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    assert.equal(await page.evaluate(() => window.fmHead()), FM_BODY_START,
      '方向键进入头区应持续被弹回 body 起点')
    assert.equal(await page.evaluate(() => window.fmDoc()), FM_DOC, '光标引导零写回')
    assert.equal((await editRequests(page)).length, 0, '光标引导零 edit.request')
    // 卡片保持成型（不闪退源码）
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '引导后卡片保持')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：修改按钮开 Popover → 值输入真实键盘回流（即时写回） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('button.vsidian-fm-edit').click()
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), true, '点修改按钮应开浮层')
    // 焦点入浮层首个键输入框
    const focusedIsKey = await page.evaluate(() =>
      document.activeElement?.classList.contains('vsidian-fm-pop-key') ?? false)
    assert.ok(focusedIsKey, '打开后焦点应入首个键输入框')
    // 值输入框真实键入：即时写回
    await page.locator('.vsidian-fm-pop-value').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    assert.equal(await page.evaluate(() => window.fmDoc()),
      FM_DOC.replace('hello', 'hello!'), '浮层内真实键入应立即回流 CM6 文档')
    assert.ok((await editRequests(page)).length >= 1, '键入应经标准链路出站 edit.request')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '键入后表格保持')
    assert.equal(await page.locator('.vsidian-fm-value').first().textContent(), 'hello!',
      '值格内容应随键入更新')
    // Esc 关闭浮层 + 焦点返还修改按钮
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), false, 'Esc 应关闭浮层')
    const focusBack = await page.evaluate(() =>
      document.activeElement?.classList.contains('vsidian-fm-edit') ?? false)
    assert.ok(focusBack, '关闭后焦点应返还修改按钮')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：Popover「添加属性」与键名改写（真实鼠标 + 键盘） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('button.vsidian-fm-edit').click()
    await page.locator('.vsidian-fm-pop-add').click()
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('count: 3\nkey: value\n---'),
      '添加属性应插入模板行')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 3, '新行应成型入表格')
    // 新行键框聚焦全选，直接键入覆盖默认键名
    await page.keyboard.type('name')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('name: value'),
      '新键选中态直接键入应覆盖默认键名')
    // 浮层外点击关闭
    await page.mouse.click(320, 300)
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), false, '点击浮层外应关闭')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：数组项在 Popover 内编辑（项输入回流、删项、加项） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), ARRAY_DOC)
    await page.locator('button.vsidian-fm-edit').click()
    // 项输入真实键入
    await page.locator('.vsidian-fm-pop-item').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('- alpha!'),
      '数组项在浮层内键入应回流源文本')
    // 删除末项（第二个项删除按钮）：两段式二次确认——首次点击只进入
    // 确认态（垃圾桶换「确认删除」文字、错误色），文档不变；再次点击执行
    const delBtn = page.locator('.vsidian-fm-pop-remove').nth(2)
    await delBtn.click()
    assert.equal(await delBtn.evaluate((el) =>
      el.classList.contains('vsidian-fm-pop-remove-armed')), true,
      '首次点击删除按钮应进入确认态（不删除）')
    assert.equal(await delBtn.textContent(), '确认删除', '确认态按钮文字（i18n）')
    assert.equal(await page.evaluate(() => window.fmDoc()),
      '---\ntags:\n  - alpha!\n  - beta\n---\n\n正文。\n', '首次点击不得删除')
    await delBtn.click()
    assert.equal(await page.evaluate(() => window.fmDoc()),
      '---\ntags:\n  - alpha!\n---\n\n正文。\n', '删除末项应移除整项行')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '删除后宿主行 + 单项行')
    // 加项按钮：末项后加 item
    await page.locator('.vsidian-fm-pop-add-item').click()
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('  - alpha!\n  - item'),
      '加项按钮应在末项后插入缩进对齐的项')
    await page.keyboard.type('gamma')
    assert.ok((await page.evaluate(() => window.fmDoc())).includes('  - gamma'),
      '新项选中态直接键入覆盖默认项名')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：浮层打开期间外部改坏头区 → 浮层自动关闭；恢复后卡片回归 ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    await page.locator('button.vsidian-fm-edit').click()
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), true)
    // 外部变更改坏头区（模拟另一面板写入嵌套）→ 降级源码 + 浮层自动关
    await page.evaluate(() => window.fmExternal(0, 0, 'nested:\n  k: 1\n', 2))
    assert.equal(await page.locator('.vsidian-fm-row').count(), 0, '非法头区应降级（卡片消失）')
    assert.equal(await page.locator('.vsidian-fm-card-line').count(), 0, '降级后卡片行类消失')
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), false, '降级应自动关闭浮层')
    // 降级形态光标可入源码（可编辑）
    await page.locator('.cm-line').nth(2).click()
    const headInSource = await page.evaluate(() => window.fmHead())
    assert.ok(headInSource > 0 && headInSource < 40, '降级形态光标应可进入源码')
    await page.evaluate(() => window.fmExternal(0, 'nested:\n  k: 1\n'.length, '', 3))
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '恢复合法后卡片回归')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- reading：同款表格只读呈现 + 标题栏（无按钮） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), ARRAY_DOC)
    const rows = page.locator('.vsidian-reading-frontmatter .vsidian-fm-row')
    assert.equal(await rows.count(), 3, '阅读侧应有宿主行 + 两项行')
    assert.equal(await page.locator('.vsidian-reading-frontmatter .vsidian-fm-key').first()
      .textContent(), 'tags', '键列文本呈现')
    const itemTexts = await page.locator('.vsidian-reading-frontmatter .vsidian-fm-item-row .vsidian-fm-value')
      .allTextContents()
    assert.deepEqual(itemTexts, ['alpha', 'beta'], '项行文本呈现')
    const box = await rows.first().boundingBox()
    assert.ok(box && box.width > 50 && box.height > 8, '阅读侧行应有可见面积')
    // 标题栏在场（图标 + 标题），修改按钮不发射
    const header = page.locator('.vsidian-reading-frontmatter .vsidian-fm-header')
    assert.equal(await header.count(), 1, '阅读侧标题栏应在场')
    assert.equal(await header.locator('.vsidian-fm-header-title').textContent(), '属性',
      '阅读侧标题文字（i18n）')
    // live 视图此刻仅隐藏未卸载，按钮计数须限定阅读容器内
    assert.equal(await page.locator('.vsidian-reading-frontmatter button.vsidian-fm-edit').count(), 0,
      '阅读侧标题栏不发射修改按钮')
    const readingKeyWeight = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.vsidian-reading-frontmatter .vsidian-fm-key')).fontWeight)
    assert.equal(readingKeyWeight, '400', '阅读侧键列应为常规字重')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- reading：复杂形态降级为转义源码块 ----
  {
    const { page, errors } = await openPage()
    const degraded = '---\ntitle: 元\nouter:\n  inner: 1\n---\n\n正文\n'
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), degraded)
    assert.equal(await page.locator('.vsidian-reading-frontmatter .vsidian-fm-table').count(), 0,
      '复杂形态不产表格')
    assert.equal(await page.locator('.vsidian-reading-frontmatter-text').count(), 1,
      '降级为转义源码块')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- live：折叠与代码块同交互（chevron + 标题栏热区，真实鼠标，零写回） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'live'), FM_DOC)
    // 展开态：chevron 在场且未收起；修改按钮在场
    const foldBtn = page.locator('button.vsidian-fm-fold')
    assert.equal(await foldBtn.count(), 1, '折叠 chevron 应在场')
    assert.equal(await foldBtn.getAttribute('aria-expanded'), 'true', '展开态 aria-expanded')
    // 点 chevron 折叠：行从绘制层消失、修改按钮让位、收起态行类与转向在场
    await foldBtn.click()
    assert.equal(await page.locator('.vsidian-fm-row').count(), 0, '折叠后键值行应消失')
    assert.equal(await page.locator('button.vsidian-fm-edit').count(), 0, '收起态不发射修改按钮')
    assert.equal(await page.locator('.vsidian-fm-card-folded').count(), 1, '首行应携带收起类')
    const collapsed = page.locator('button.vsidian-fm-fold')
    assert.equal(await collapsed.getAttribute('aria-expanded'), 'false', '收起态 aria-expanded')
    assert.ok(await collapsed.evaluate((el) =>
      el.classList.contains('vsidian-fm-fold-collapsed')), '收起态 chevron 应带转向修饰')
    // 标题栏仍可见且有面积（折叠的承载面）
    const headerBox = await page.locator('.vsidian-fm-header').boundingBox()
    assert.ok(headerBox && headerBox.height > 8, '收起态标题栏应可见')
    assert.equal(await page.evaluate(() => window.fmDoc()), FM_DOC, '折叠零写回')
    assert.equal((await editRequests(page)).length, 0, '折叠零 edit.request')
    // 标题栏空白热区（标题文字）点击展开：整条标题栏同为切换入口
    await page.locator('.vsidian-fm-header-title').click()
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '热区点击应展开恢复键值行')
    assert.equal(await page.locator('.vsidian-fm-card-folded').count(), 0, '展开后收起类消失')
    assert.equal(await page.locator('button.vsidian-fm-edit').count(), 1, '展开后修改按钮回归')
    // 修改按钮点击只开浮层不折叠（按钮不冒泡触发热区）
    await page.locator('button.vsidian-fm-edit').click()
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), true, '修改按钮应开浮层')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 2, '开浮层不得折叠卡片')
    // 浮层打开期间折叠：浮层自动关闭（编辑对象已随表格隐藏）
    await page.locator('button.vsidian-fm-fold').click()
    assert.equal(await page.evaluate(() => window.fmPopoverOpen()), false, '折叠应关闭浮层')
    assert.equal(await page.locator('.vsidian-fm-row').count(), 0, '折叠后行消失')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

  // ---- reading：折叠（表格收起类 + 行隐藏）与热区展开（真实鼠标） ----
  {
    const { page, errors } = await openPage()
    await page.evaluate((t) => window.initFmDoc(t, 'reading'), ARRAY_DOC)
    const readingRows = page.locator('.vsidian-reading-frontmatter .vsidian-fm-row')
    assert.equal(await readingRows.count(), 3, '阅读侧折叠前行在场')
    const readingFold = page.locator('.vsidian-reading-frontmatter button.vsidian-fm-fold')
    assert.equal(await readingFold.count(), 1, '阅读侧折叠 chevron 应在场（挂载装饰）')
    await readingFold.click()
    const table = page.locator('.vsidian-reading-frontmatter .vsidian-fm-table')
    assert.ok(await table.evaluate((el) => el.classList.contains('vsidian-fm-folded')),
      '折叠后表格应携带收起类')
    assert.equal(await readingRows.count(), 3, '行元素保留（隐藏由 CSS 承担）')
    const rowDisplay = await readingRows.first().evaluate((el) => getComputedStyle(el).display)
    assert.equal(rowDisplay, 'none', '收起态行应在绘制层隐藏')
    // 表壳边框保留（收起态标题栏即卡片全部可见面）
    const tableBox = await table.boundingBox()
    assert.ok(tableBox && tableBox.height > 8, '收起态表壳应有可见面积')
    // 热区（标题文字）展开
    await page.locator('.vsidian-reading-frontmatter .vsidian-fm-header-title').click()
    assert.ok(!(await table.evaluate((el) => el.classList.contains('vsidian-fm-folded'))),
      '热区点击应展开')
    assert.equal(await readingRows.first().evaluate((el) => getComputedStyle(el).display),
      'grid', '展开后行恢复网格呈现')
    assert.deepEqual(errors, [], '页面不能有未捕获异常')
    await page.close()
  }

} finally {
  await browser.close()
}
console.log('frontmatterTable: 全部场景通过')
