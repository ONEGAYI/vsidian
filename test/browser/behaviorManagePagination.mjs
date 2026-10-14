// #474 行为管理分页与积木筛选——生产设置页入口的真实浏览器回归：分页控件
// 绘制层（禁用发灰/指示色/几何）、积木构造器真实键盘构建链路（Enter 拾取 →
// 方向键选缺口 → Enter 放下，D8）、发光选中态计算、逻辑积木菱形 clip-path、
// 筛选实时过滤、toast 形态演进（倒计时条几何 + 悬停暂停 + 撤销按钮）与视图
// 持久跨重载往返（页码 + 查询树经 addons.behaviorsViewSet / ViewGet）。
// 宿主应答由页面内 mock 桥回灌（含 behaviorsView 状态机），消息断言以
// webview → 宿主上送形态为准。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const artifacts = artifactPath(root, 'screenshots/behaviorManagePagination')
await mkdir(artifacts, { recursive: true })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const ADDON = 'fixture.demo'
const BEHAVIORS = Array.from({ length: 45 }, (_, i) => ({
  addonId: ADDON,
  id: `behavior-${String(i).padStart(2, '0')}`,
  name: `行为${String(i).padStart(2, '0')}`,
  history: 'atomic',
}))
// 两条已关闭行为（状态积木「已关闭」筛选用）
const DISABLED = [`${ADDON}#behavior-00`, `${ADDON}#behavior-01`]

/** 页面装配（持久重载往返复用：viewStore 携带跨装配的视图持久值） */
async function loadPage(browser, viewStore) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#ffffff; --vscode-editor-foreground:#30343b; --vscode-descriptionForeground:#59616d; --vscode-list-hoverBackground:#e9ebef; --vscode-input-background:#ffffff; --vscode-input-foreground:#30343b; --vscode-panel-border:#d7dce3; --vscode-focusBorder:#2687d4; --vscode-button-border:#d7dce3; --vscode-errorForeground:#f66; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.evaluate((state) => {
    window.sentMessages = []
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.acquireVsCodeApi = () => ({ postMessage(message) {
      window.sentMessages.push(message)
      setTimeout(() => {
        if (message.kind === 'addons.get') {
          post({
            kind: 'addons.state', apiVersion: '1.0.0', draft: true,
            openAddonSettingsPage: null, openAddonSettings: null,
            addons: [{ id: 'fixture.demo', label: '组件甲', official: false, status: 'registered', enabled: true }],
          })
          return
        }
        if (message.kind === 'addons.behaviorsGet') {
          post({
            kind: 'addons.behaviors',
            behaviors: window.__behaviors,
            state: { version: 1, order: [], disabled: window.__disabled },
          })
          return
        }
        // #474 视图持久：拉取应答当前存储值；写入更新存储（真实宿主落
        // globalState，此处内存等价——往返语义一致）
        if (message.kind === 'addons.behaviorsViewGet') {
          post({ kind: 'addons.behaviorsView', view: window.__viewStore })
          return
        }
        if (message.kind === 'addons.behaviorsViewSet') {
          window.__viewStore = message.view
          return
        }
        if (message.kind === 'addons.commandCatalogGet') { post({ kind: 'addons.commandCatalog', commands: [] }); return }
        if (message.kind === 'settings.uiState' || message.kind === 'addonPage.ready') return
      }, 0)
    } })
    window.__behaviors = state.behaviors
    window.__disabled = state.disabled
    window.__viewStore = state.viewStore
    window.__post = post
  }, { behaviors: BEHAVIORS, disabled: DISABLED, viewStore: viewStore.value })
  await page.addScriptTag({ path: output })
  await page.getByRole('button', { name: zhCn['settings.addonsBehaviorsSection'], exact: true }).click()
  await page.locator('.vsidian-addons-behaviors').waitFor()
  return { page, errors, flushViewStore: () => page.evaluate(() => window.__viewStore) }
}

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const viewStore = { value: null }
try {
  const { page, errors } = await loadPage(browser, viewStore)

  // ---- 1. 分页五件套（D1–D3）：45 行 3 页、首末页按钮禁用发灰（绘制层） ----
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 20, '第 1 页应呈现 20 行（页容量）')
  const pager = page.locator('.vsidian-addons-behaviors-pager')
  await pager.waitFor()
  const firstPageButton = pager.getByRole('button', { name: zhCn['addons.behaviorsPageFirst'] })
  const prevButton = pager.getByRole('button', { name: zhCn['addons.behaviorsPagePrev'] })
  const nextButton = pager.getByRole('button', { name: zhCn['addons.behaviorsPageNext'] })
  const lastPageButton = pager.getByRole('button', { name: zhCn['addons.behaviorsPageLast'] })
  const indicator = pager.locator('.vsidian-addons-behaviors-pager-indicator')
  assert.equal(await indicator.innerText(), '第 1 / 3 页')
  assert.equal(await firstPageButton.getAttribute('aria-label'), zhCn['addons.behaviorsPageFirst'])
  // 禁用发灰是绘制层属性（opacity 0.5）——仅 disabled 属性不构成视觉发灰
  const prevPaint = await prevButton.evaluate((el) => getComputedStyle(el).opacity)
  assert.equal(prevPaint, '0.5', '到头按钮应发灰（opacity 0.5）')
  assert.equal(await nextButton.isEnabled(), true)
  const indicatorPaint = await indicator.evaluate((el) => getComputedStyle(el))
  assert.equal(indicatorPaint.color, 'rgb(89, 97, 109)', '指示文本应为说明色（样式未注入即失败）')
  assert.equal(indicatorPaint.fontSize, '12px')

  // ---- 2. 翻页与持久上送（D11）：下一页 → 第 2 页；视图整表写 ----
  await nextButton.click()
  await page.locator('.vsidian-addons-behaviors-pager-indicator').getByText('第 2 / 3 页').waitFor()
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 20)
  const setViewMessages = await page.evaluate(() =>
    window.sentMessages.filter((m) => m.kind === 'addons.behaviorsViewSet'))
  assert.deepEqual(setViewMessages, [{ kind: 'addons.behaviorsViewSet', view: { page: 2, query: null } }],
    '翻页应上送视图持久（页码整表写）')
  await lastPageButton.click()
  await page.locator('.vsidian-addons-behaviors-pager-indicator').getByText('第 3 / 3 页').waitFor()
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 5, '末页应呈现余量 5 行')
  // 回第 1 页（后续筛选断言从第 1 页起）
  await firstPageButton.click()
  await page.locator('.vsidian-addons-behaviors-pager-indicator').getByText('第 1 / 3 页').waitFor()

  // ---- 3. 积木构造器：加号下拉（三组）→ 状态积木（键盘激活菜单项） ----
  const add = page.locator('.vsidian-behavior-query-add')
  assert.equal(await add.getAttribute('aria-label'), zhCn['addons.behaviorQueryAddTooltip'])
  await add.focus()
  await page.keyboard.press('Enter') // 键盘打开（真实键，可聚焦可激活）
  const menu = page.locator('.vsidian-bq-menu')
  await menu.waitFor()
  const groupTexts = await menu.locator('.vsidian-bq-menu-group').allInnerTexts()
  assert.deepEqual(groupTexts, [
    zhCn['addons.behaviorQueryGroup.field'],
    zhCn['addons.behaviorQueryGroup.logic'],
    zhCn['addons.behaviorQueryGroup.status'],
  ], '加号下拉应呈现三组（D4）')
  // 菜单项键盘激活（focus + Enter，不经鼠标）：状态组件
  await menu.locator('button', { hasText: zhCn['addons.behaviorQueryStatusBlockLabel'] }).focus()
  await page.keyboard.press('Enter')
  const statusBlock = page.locator('.vsidian-bq-block--status')
  await statusBlock.waitFor()
  // 状态积木形态（绘制层）：6px 矩形（按钮档圆角）
  const statusPaint = await statusBlock.evaluate((el) => getComputedStyle(el).borderRadius)
  assert.equal(statusPaint, '6px', '状态积木应为 6px 矩形档')

  // ---- 3a. 字段积木连续输入不丢焦点（评审 C1：查询编辑只重渲染列表，
  //      构造器 DOM 不动——每键丢焦会让筛选词只能打一个字符） ----
  await add.click()
  await menu.locator('button', { hasText: zhCn['addons.behaviorQueryField.behaviorName'] }).focus()
  await page.keyboard.press('Enter')
  const fieldInput = page.locator('.vsidian-bq-field-input')
  await fieldInput.waitFor()
  await fieldInput.click()
  for (const key of ['行', '为', '4']) {
    // insertText 模拟 IME 提交后的文本插入（中文输入路径）
    await page.keyboard.insertText(key)
    // 每键后焦点仍在输入框（activeElement 不回 body）
    const focused = await page.evaluate(() => document.activeElement?.className ?? 'BODY')
    assert.equal(focused, 'vsidian-bq-field-input', `输入 ${key} 后焦点应保持在字段输入框`)
  }
  assert.equal(await fieldInput.inputValue(), '行为4', '连续输入应完整落值')
  // 输入过程实时过滤生效（此刻树 = 状态(已启用) AND 行为显示名含「行为4」：
  // 40-44 均启用 → 5 行）
  await page.locator('.vsidian-addons-behaviors-row').first().waitFor()
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 5, '字段筛选应实时过滤（AND 状态积木下 5 行）')
  // 清理：键盘删掉该字段积木（focus + Delete——焦点块即删除目标），回到
  // 状态积木单块供段 4 断言
  await page.locator('.vsidian-bq-block--field').focus()
  await page.keyboard.press('Delete')
  await page.locator('.vsidian-bq-block--field').waitFor({ state: 'detached' })
  await page.waitForTimeout(30)

  // ---- 4. 状态筛选（D6）：下拉选「已关闭」→ 实时过滤为 2 行 ----
  await statusBlock.locator('select').selectOption('disabled')
  await page.locator('.vsidian-addons-behaviors-row').first().waitFor()
  const rowsAfterStatus = await page.locator('.vsidian-addons-behaviors-row').allInnerTexts()
  assert.equal(rowsAfterStatus.length, 2, '「已关闭」筛选应命中 2 条预置关闭行为')
  assert.match(rowsAfterStatus.join('|'), /行为00/)
  assert.match(rowsAfterStatus.join('|'), /行为01/)
  // 筛选后单页呈现：翻页控件退场（D3 自然阈值）
  assert.equal(await page.locator('.vsidian-addons-behaviors-pager').count(), 0, '命中不満一页不渲染翻页控件')

  // ---- 5. 键盘嵌套构建（D8 核心链路）：加 AND → 拾取状态积木 → 放入缺口 ----
  await add.click()
  await menu.locator('button', { hasText: 'AND' }).focus()
  await page.keyboard.press('Enter')
  const logicBlock = page.locator('.vsidian-bq-block--logic')
  await logicBlock.waitFor()
  // 逻辑积木菱形形态（绘制层）：clip-path 随形（非 none）
  const logicPaint = await logicBlock.evaluate((el) => getComputedStyle(el).clipPath)
  assert.notEqual(logicPaint, 'none', '逻辑积木应为 clip-path 菱形（随形档）')
  // 真实键盘链路：状态积木拾取（Enter）→ 缺口高亮移动（ArrowRight）→ 放下（Enter）
  await statusBlock.focus()
  await page.keyboard.press('Enter')
  const carrying = await statusBlock.evaluate((el) => el.classList.contains('vsidian-bq-carrying'))
  assert.equal(carrying, true, 'Enter 拾取后积木应带浅色高亮类')
  const targetSlot = logicBlock.locator('.vsidian-bq-slot--empty').nth(1)
  await page.keyboard.press('ArrowRight')
  const slotTargeted = await targetSlot.evaluate((el) => el.classList.contains('vsidian-bq-slot--target'))
  assert.equal(slotTargeted, true, '方向键移动后目标缺口应带深色高亮类')
  await page.keyboard.press('Enter')
  // 放下后：状态积木位于 AND 第二缺口内（DOM 嵌套结构）
  const nested = await logicBlock.locator('.vsidian-bq-slot .vsidian-bq-block--status').count()
  assert.equal(nested, 1, 'Enter 放下后状态积木应嵌套进 AND 缺口')

  // ---- 6. 发光选中态（D8）：点击 AND → 整体（含嵌套）发光（计算值） ----
  await logicBlock.click()
  const glow = await logicBlock.evaluate((el) => getComputedStyle(el).boxShadow)
  assert.ok(glow.includes('rgb(38, 135, 212)', ), `选中积木应发光（focusBorder 外圈）——实测 ${glow}`)
  const nestedStatus = logicBlock.locator('.vsidian-bq-block--status')
  const nestedGlow = await nestedStatus.evaluate((el) => getComputedStyle(el).boxShadow)
  assert.ok(nestedGlow.includes('rgb(38, 135, 212)'), '嵌套积木应同幅发光（删除范围整体明示）')

  // ---- 7. 垃圾桶清空 + toast 形态演进（D14/D15 撤销机制） ----
  // 取消选中（点击构造器空白）后单击垃圾桶 = 清空整个查询（D4 三用法）
  await page.locator('.vsidian-behavior-query').click({ position: { x: 4, y: 4 } })
  await page.locator('.vsidian-behavior-query-trash').click()
  const toast = page.locator('.vsidian-toast')
  await toast.waitFor()
  assert.match(await toast.innerText(), new RegExp(zhCn['addons.behaviorsQueryCleared']))
  // 倒计时条几何（右端锚定顶部）与动画运行
  const timerPaint = await toast.locator('.vsidian-toast-timer').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { position: cs.position, top: cs.top, right: cs.right, height: cs.height, playState: cs.animationPlayState }
  })
  assert.equal(timerPaint.position, 'absolute')
  assert.equal(timerPaint.top, '0px')
  assert.equal(timerPaint.right, '0px')
  assert.equal(timerPaint.height, '2px', '倒计时条应为 2px 高')
  assert.equal(timerPaint.playState, 'running', '常态倒计时动画运行')
  // 悬停暂停（形态演进关键行为：CSS 与 JS 计时同步暂停）
  await toast.hover()
  const pausedPaint = await toast.locator('.vsidian-toast-timer').evaluate((el) => getComputedStyle(el).animationPlayState)
  assert.equal(pausedPaint, 'paused', '悬停气泡时倒计时条应暂停')
  // 气泡内撤销按钮：点击恢复清空前的查询树。恢复的是 AND(空槽, 状态) 半
  // 构造树——含空槽的逻辑积木恒真（D7 占位待填），过滤效果回到全集呈现
  const undoButton = toast.locator('.vsidian-toast-action')
  assert.equal(await undoButton.innerText(), zhCn['addons.behaviorsQueryUndo'])
  await undoButton.click()
  await page.locator('.vsidian-bq-block--logic').waitFor()
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 20, '撤销应恢复半构造查询树（空槽恒真 → 全集第 1 页）')

  // ---- 8. 非法定位 toast（D13）：page:99 越界 → 回落默认渲染 + 轻提示 ----
  await page.evaluate((entry) => {
    window.__post({ kind: 'settings.focusSection', section: 'addons-behaviors', entry })
  }, 'page:99')
  await page.locator('.vsidian-toast', { hasText: zhCn['addons.behaviorsFocusInvalid'] }).waitFor()
  assert.equal(await page.locator('.vsidian-addons-behaviors-row').count(), 20, '非法定位回落默认渲染（半构造查询恒真 → 全集第 1 页）')
  await page.waitForTimeout(20)

  // ---- 9. 视图持久跨重载往返（D11）：重开设置页恢复页码与查询树 ----
  const savedView = await page.evaluate(() => window.__viewStore)
  assert.ok(savedView !== null && savedView.query !== null, '查询树应已持久（blocks 非空 → query 非 null）')
  viewStore.value = savedView
  const reloaded = await loadPage(browser, viewStore)
  try {
    // 恢复的 AND(空槽, 状态) 半构造树恒真 → 全集第 1 页；嵌套结构完整恢复
    const rows = await reloaded.page.locator('.vsidian-addons-behaviors-row').allInnerTexts()
    assert.equal(rows.length, 20, '跨重载应恢复半构造查询树（空槽恒真 → 全集第 1 页）')
    await reloaded.page.locator('.vsidian-bq-block--logic').waitFor()
    const restoredNested = await reloaded.page.locator('.vsidian-bq-block--logic .vsidian-bq-slot .vsidian-bq-block--status').count()
    assert.equal(restoredNested, 1, '嵌套结构应完整恢复（半构造/嵌套状态跨重启不丢）')
    assert.equal(await reloaded.errors.length, 0, `页面不应有未捕获异常：${reloaded.errors.join('; ')}`)
  } finally {
    await reloaded.page.close()
  }

  assert.equal(errors.length, 0, `页面不应有未捕获异常：${errors.join('; ')}`)
  await page.screenshot({ path: path.join(artifacts, 'behavior-manage-pagination.png'), fullPage: true })
} finally {
  await browser.close()
}
console.log('behaviorManagePagination: all assertions passed')
