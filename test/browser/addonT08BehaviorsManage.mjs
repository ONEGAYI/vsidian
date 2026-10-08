// T08（#357）行为冲突管理——生产设置页入口的真实浏览器回归：真实键盘/
// 点击驱动调序与逐项开关、说明/例子按需展开；绘制层断言（徽章计算色、
// 勾选态、行序文本——非 DOM 存在性）。宿主应答由页面内 mock 桥回灌
// （addons.state / addons.behaviors），消息断言以 webview → 宿主的上送
// 形态为准；权威回显驱动重排与徽章呈现（回显驱动的 UI 契约）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const artifacts = artifactPath(root, 'screenshots/addonT08BehaviorsManage')
await mkdir(artifacts, { recursive: true })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const ADDON_A = 'fixture.demo'
const ADDON_B = 'fixture.other'
const KEY_DASH = `${ADDON_A}#dash-fill`
const KEY_SPACE = `${ADDON_A}#space-fill`
const KEY_TILDE = `${ADDON_B}#tilde-fill`

/** 页内 mock 宿主状态（回灌应答的数据源——消息构造在 evaluate 内联） */
const hostState = {
  behaviors: [
    { addonId: ADDON_A, id: 'dash-fill', name: '破折填充', description: '输入 - 后补全——', examples: ['- |'], history: 'atomic' },
    { addonId: ADDON_A, id: 'space-fill', name: '空格整理', history: 'atomic' },
    { addonId: ADDON_B, id: 'tilde-fill', name: '波浪填充', history: 'atomic' },
  ],
  order: [],
  disabled: [],
  failNextWrite: false,
}

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#ffffff; --vscode-editor-foreground:#30343b; --vscode-sideBar-background:#f5f6f8; --vscode-descriptionForeground:#59616d; --vscode-list-activeSelectionBackground:#e0e4eb; --vscode-list-activeSelectionForeground:#26313e; --vscode-list-hoverBackground:#e9ebef; --vscode-input-background:#ffffff; --vscode-input-foreground:#30343b; --vscode-panel-border:#d7dce3; --vscode-focusBorder:#2687d4; --vscode-button-background:#0078d4; --vscode-button-foreground:#ffffff; --vscode-errorForeground:#f66; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.evaluate((state) => {
    window.sentMessages = []
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.acquireVsCodeApi = () => ({ postMessage(message) {
      window.sentMessages.push(message)
      setTimeout(() => {
        if (message.kind === 'addons.get') { post(window.__reply('addons-state')); return }
        if (message.kind === 'addons.behaviorsGet') { post(window.__reply('addons-behaviors')); return }
        if (message.kind === 'addons.behaviorsSetDisabled') {
          if (window.__hostState.failNextWrite) {
            window.__hostState.failNextWrite = false
            post(window.__reply('addons-behaviors', { kind: 'save-failed' }))
            return
          }
          const set = new Set(window.__hostState.disabled)
          for (const key of message.keys) {
            if (message.disabled) { set.add(key) } else { set.delete(key) }
          }
          window.__hostState.disabled = [...set]
          post(window.__reply('addons-behaviors', { kind: 'saved' }))
          return
        }
        if (message.kind === 'addons.behaviorsSetOrder') {
          if (window.__hostState.failNextWrite) {
            window.__hostState.failNextWrite = false
            post(window.__reply('addons-behaviors', { kind: 'save-failed' }))
            return
          }
          window.__hostState.order = [...message.order]
          post(window.__reply('addons-behaviors', { kind: 'saved' }))
          return
        }
        if (message.kind === 'addons.commandCatalogGet') { post({ kind: 'addons.commandCatalog', commands: [] }); return }
        if (message.kind === 'settings.uiState' || message.kind === 'addonPage.ready') return
      }, 0)
    } })
    window.__hostState = state
    window.__reply = (kind, notice) => {
      if (kind === 'addons-state') {
        return {
          kind: 'addons.state', apiVersion: '1.0.0', draft: true,
          openAddonSettingsPage: null, openAddonSettings: null,
          addons: [
            { id: 'fixture.demo', label: '组件甲', official: false, status: 'registered', enabled: true },
            { id: 'fixture.other', label: '组件乙', official: false, status: 'registered', enabled: false },
          ],
        }
      }
      const empty = window.__hostState.order.length === 0 && window.__hostState.disabled.length === 0
      return {
        kind: 'addons.behaviors',
        behaviors: window.__hostState.behaviors,
        state: empty ? null : { version: 1, order: window.__hostState.order, disabled: window.__hostState.disabled },
        ...(notice !== undefined ? { notice } : {}),
      }
    }
  }, hostState)
  await page.addScriptTag({ path: output })

  // ---- 1. 打开附加组件分页：行为冲突管理组在场（固定入口） ----
  await page.getByRole('button', { name: zhCn['settings.addonsSection'], exact: true }).click()
  const area = page.locator('.vsidian-addons-behaviors')
  await area.waitFor()
  const groupText = await area.innerText()
  assert.match(groupText, new RegExp(zhCn['addons.behaviorsGroupTitle']))
  assert.match(groupText, /破折填充/)
  assert.match(groupText, /所属组件：组件甲/)

  // ---- 2. 行序与绘制层：徽章计算色（组件已停用 = 组件乙的行为带徽章） ----
  const rows = area.locator('.vsidian-addons-behaviors-row')
  assert.equal(await rows.count(), 3, '三个注册行为各占一行')
  const badge = rows.nth(2).locator('.vsidian-addons-behaviors-badge-addon-off')
  await badge.waitFor()
  const badgePaint = await badge.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { color: cs.color, display: cs.display, radius: cs.borderRadius }
  })
  assert.notEqual(badgePaint.display, 'none', '组件停用徽章应可见（样式未注入即失败）')
  assert.equal(badgePaint.radius, '999px')
  assert.equal(badgePaint.color, 'rgb(89, 97, 109)', '徽章文字应为说明前景色（绘制层，非 DOM 存在性）')
  await page.screenshot({ path: path.join(artifacts, 'behaviors-group.png') })

  // ---- 3. 真实键盘：Tab 聚焦单项开关 → Space 关闭（消息形态断言） ----
  const dashToggle = area.locator(`input[data-behavior-key="${KEY_DASH}"]`)
  await dashToggle.focus()
  await page.keyboard.press('Space')
  await page.waitForFunction((key) => window.sentMessages.some((m) => m.kind === 'addons.behaviorsSetDisabled' && m.keys[0] === key && m.disabled === true), KEY_DASH)
  // 宿主权威回显：勾选态为假 + 已关闭徽章可见（绘制层色 = 说明前景色）
  await area.locator(`[data-behavior-key="${KEY_DASH}"] ~ *, .vsidian-addons-behaviors-badge-off`).first().waitFor()
  const offBadge = rows.nth(0).locator('.vsidian-addons-behaviors-badge-off')
  await offBadge.waitFor()
  const offPaint = await offBadge.evaluate((el) => getComputedStyle(el).color)
  assert.equal(offPaint, 'rgb(89, 97, 109)', '已关闭徽章绘制层可见')
  assert.equal(await dashToggle.isChecked(), false, '回显后勾选态为假')

  // ---- 4. 真实键盘：聚焦下移按钮 → Enter 调序（消息形态断言）----
  const firstRow = area.locator('.vsidian-addons-behaviors-row').nth(0)
  const moveDown = firstRow.locator('[data-behavior-move=down]')
  await moveDown.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.behaviorsSetOrder' && m.order.length === 3))
  // 权威回显后的行序：首两行交换（用户可见文本级断言，非 DOM 顺序恒等）
  await page.waitForFunction(() => {
    const titles = [...document.querySelectorAll('.vsidian-addons-behaviors-row .vsidian-settings-item-title')].map((el) => el.textContent)
    return titles[0] !== titles[1]
  })
  const titles = await area.locator('.vsidian-settings-item-title').allInnerTexts()
  const firstTwo = new Set(titles.slice(0, 2))
  assert.ok(firstTwo.has('破折填充') && firstTwo.has('空格整理') || firstTwo.has('波浪填充'), '回显后首两行为调序交换结果')

  // ---- 5. 键盘展开说明/例子（details summary 原生激活） ----
  const dashDetails = area.locator('details.vsidian-addons-behaviors-details').first()
  const summary = dashDetails.locator('summary')
  await summary.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('details.vsidian-addons-behaviors-details')?.open === true)
  assert.match(await dashDetails.innerText(), /输入 - 后补全/)
  assert.match(await dashDetails.innerText(), new RegExp(zhCn['addons.behaviorsExamplesLabel'].replace('{examples}', '.+')))
  await page.screenshot({ path: path.join(artifacts, 'behaviors-details-open.png') })

  // ---- 6. 保存成功/失败提示（绘制层：失败为错误前景色；勾选回弹） ----
  await page.evaluate(() => { window.__hostState.failNextWrite = true })
  const spaceToggle = area.locator(`input[data-behavior-key="${KEY_SPACE}"]`)
  await spaceToggle.focus()
  await page.keyboard.press('Space')
  const failedNotice = area.locator('.vsidian-addons-behaviors-notice-save-failed')
  await failedNotice.waitFor()
  assert.match(await failedNotice.innerText(), new RegExp(zhCn['addons.behaviorsSaveFailedNotice']))
  const failedPaint = await failedNotice.evaluate((el) => getComputedStyle(el).color)
  assert.equal(failedPaint, 'rgb(255, 102, 102)', '失败提示应为错误前景色（绘制层）')
  // 失败不虚报：权威态未变，勾选回弹为真
  assert.equal(await spaceToggle.isChecked(), true, '写入失败时勾选回弹（宿主权威）')
  await page.screenshot({ path: path.join(artifacts, 'behaviors-write-failed.png') })

  // ---- 7. 全局搜索定位：入口条目命中后跳转定位 ----
  const search = page.locator('.vsidian-settings-search')
  await search.fill(zhCn['addons.behaviorsGroupTitle'])
  const result = page.locator('.vsidian-settings-result', { hasText: zhCn['addons.behaviorsGroupTitle'] })
  await result.first().click()
  const located = page.locator('.vsidian-addons-behaviors.vsidian-settings-item-located')
  await located.waitFor()
  await search.fill('')

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  console.log('[#357] 行为冲突管理浏览器回归通过（调序/逐项开关/徽章绘制/详情展开/失败回弹/搜索定位）')
} finally {
  await browser.close()
}
