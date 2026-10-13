// #354 T05 附加组件侧栏三组与故障排障——生产设置页入口的真实浏览器回归：
// 真实点击驱动侧栏大组/子组/组件条目路由与故障排障块；绘制层断言（大组
// 分隔线可见描边、故障徽章错误底色——非 DOM 存在性）。宿主应答由页面内
// mock 桥回灌（addons.state / addons.settingsState），消息断言以 webview →
// 宿主的上送形态为准。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { artifactPath, chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const artifacts = artifactPath(root, 'screenshots/addonSidebar')
await mkdir(artifacts, { recursive: true })
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

/** 页内 mock 宿主状态（回灌应答的数据源） */
const hostState = {
  addons: [],
  open: null,
  faultedOpen: false,
}

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.setContent(`<html lang="zh-CN"><body>${islandHtml}<div id="app"></div></body></html>`)
  await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#ffffff; --vscode-editor-foreground:#30343b; --vscode-sideBar-background:#f5f6f8; --vscode-descriptionForeground:#59616d; --vscode-list-activeSelectionBackground:#e0e4eb; --vscode-list-activeSelectionForeground:#26313e; --vscode-input-background:#ffffff; --vscode-input-foreground:#30343b; --vscode-panel-border:#d7dce3; --vscode-focusBorder:#2687d4; --vscode-button-background:#0078d4; --vscode-button-foreground:#ffffff; --vscode-errorForeground:#f66; --vscode-statusBarItem-errorBackground:#b8111b; --vscode-statusBarItem-errorForeground:#ffffff; }` })
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.evaluate((state) => {
    window.sentMessages = []
    const post = (message) => window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.acquireVsCodeApi = () => ({ postMessage(message) {
      window.sentMessages.push(message)
      setTimeout(() => {
        if (message.kind === 'addons.get' || message.kind === 'addons.settingsGet') {
          post(window.__addonsState())
          post(window.__settingsState())
          return
        }
        if (message.kind === 'addons.settingsOpen') {
          window.__hostState.open = message.addonId
          post(window.__addonsState())
          post(window.__settingsState())
          return
        }
        if (message.kind === 'addons.settingsClose') {
          window.__hostState.open = null
          post(window.__settingsState())
          return
        }
        if (message.kind === 'settings.uiState') return
      }, 0)
    } })
    window.__hostState = state
    window.__pushState = () => {
      post(window.__addonsState())
      post(window.__settingsState())
    }
    window.__addonsState = () => ({
      kind: 'addons.state', apiVersion: '1.0.0', draft: true,
      openAddonSettingsPage: null, openAddonSettings: window.__hostState.open,
      addons: window.__hostState.addons,
    })
    window.__settingsState = () => ({
      kind: 'addons.settingsState', apiVersion: '1.0.0', draft: true,
      open: window.__hostState.open, hasWorkspace: false,
      addon: window.__hostState.open === null ? null : {
        addonId: window.__hostState.open,
        label: window.__hostState.addons.find((a) => a.id === window.__hostState.open)?.label ?? window.__hostState.open,
        faulted: window.__hostState.faultedOpen,
        ...(window.__hostState.faultedOpen ? { faultReason: 'enable 异常：demo crash' } : {}),
        hasCustomPage: false,
        enabled: { effective: true, userExplicit: true, workspaceExplicit: null, source: 'user' },
        definitions: [],
        values: {},
      },
      openAddonSettingsPage: null,
    })
  }, hostState)
  await page.addScriptTag({ path: output })

  // 初始空清单 → 空态（两大组结构在场）
  await page.evaluate(() => {
    window.__hostState.addons = [
      // 官方：一启用（含故障暂停）一停用
      { id: 'onegayi.core', label: 'Core A', official: true, status: 'registered', enabled: true, fault: { reason: 'enable 异常：demo crash' }, hasSettingsDefinitions: true },
      { id: 'onegayi.core-off', label: 'Core B', official: true, status: 'registered', enabled: false },
      // 第三方：一启用一停用；未注册（不兼容）不进侧栏分组
      { id: 'a.third-on', label: 'Third On', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      { id: 'a.third-off', label: 'Third Off', official: false, status: 'registered', enabled: false },
      { id: 'a.future', label: 'Future', official: false, status: 'incompatible', apiRange: '^2.0.0' },
    ]
  })
  // 触发一次 addons.state 回灌（侧栏大组重建）
  await page.evaluate(() => window.__pushState())

  // ---- 1. 三组结构与子组归属（用户可见文本） ----
  const nav = page.locator('.vsidian-settings-nav')
  const groupLabels = nav.locator('.vsidian-settings-nav-group-label')
  assert.deepEqual(await groupLabels.allInnerTexts(), [zhCn['settings.sidebarOptions'], zhCn['addons.sidebarCoreAddons'], zhCn['addons.sidebarThirdPartyAddons']], '侧栏三大组标题按约定呈现')

  // 官方组：已启用（Core A 带故障徽章）/已停用（Core B）
  const coreGroup = nav.locator('.vsidian-settings-nav-section').nth(1)
  const coreSubgroups = coreGroup.locator('.vsidian-settings-nav-subgroup')
  assert.match(await coreSubgroups.first().innerText(), new RegExp(zhCn['addons.sidebarEnabledGroup']))
  assert.ok((await coreSubgroups.first().innerText()).includes('Core A'), '故障暂停者留在已启用组')
  assert.ok((await coreSubgroups.first().innerText()).includes(zhCn['addons.sidebarFaultBadge']), '故障暂停条目带标注')
  assert.ok((await coreSubgroups.nth(1).innerText()).includes('Core B'), '开关停用者归已停用子组')
  const navText = await nav.innerText()
  assert.ok(!navText.includes('Future'), '未注册组件不进侧栏分组')

  // ---- 2. 大组分隔绘制层：divider 有可见描边（非 display:none） ----
  const dividerPaint = await nav.locator('.vsidian-settings-nav-divider').first().evaluate((el) => {
    const cs = getComputedStyle(el)
    return { display: cs.display, borderTop: cs.borderTopWidth + ' ' + cs.borderTopStyle }
  })
  assert.equal(dividerPaint.display, 'block')
  assert.match(dividerPaint.borderTop, /^1px solid/, '大组间分隔线应有可见描边（样式未注入即失败）')

  // 故障徽章绘制层：错误底色
  const badgePaint = await coreGroup.locator('.vsidian-settings-nav-item-badge').first().evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.equal(badgePaint, 'rgb(184, 17, 27)', '故障徽章应为错误底色（绘制层）')

  // ---- 3. 侧栏组件条目点击：可配置组件直达「组件设置」分页（#465）；
  //      纯运行组件回附加组件页定位列表行 ----
  await nav.getByRole('button', { name: /Third On/ }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'a.third-on'))
  // #465 通道堵死：可配置组件条目导航到「组件设置」分页，附加组件页不
  // 承载任何组件设置内容
  const detail = page.locator('.vsidian-addons-settings')
  await detail.waitFor()
  assert.match(await detail.innerText(), new RegExp(zhCn['addons.settingsAreaTitle'].replace('{label}', 'Third On')))
  assert.equal(await page.locator('.vsidian-addons-list').count(), 0, '组件设置分页不混装管理列表（#465 通道堵死）')
  // 「返回组件列表」回本页组件清单（hub 形态）
  await page.getByRole('button', { name: zhCn['addons.closeSettingsArea'], exact: true }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsClose'))
  await page.locator('.vsidian-addons-settings-hub').waitFor()
  // 纯运行组件条目（Third Off——无定义无设置页）：回附加组件页只定位列表行
  await nav.getByRole('button', { name: /Third Off/ }).click()
  const located = page.locator('.vsidian-addons-list .vsidian-settings-item-located')
  await located.waitFor()
  assert.match(await located.first().innerText(), /Third Off/, '点击条目定位组件状态行')
  // #462 绘制层：条目行定位描边真实绘制（focusBorder 1px + offset 8px），
  // 列表容器不再套区块级描边（容器级与条目级互斥，消三层叠加）
  const locatedPaint = await page.evaluate(() => {
    const list = document.querySelector('.vsidian-addons-list')
    const row = list?.querySelector('.vsidian-settings-item-located')
    if (!list || !row) return null
    const rowCs = getComputedStyle(row)
    const listCs = getComputedStyle(list)
    return {
      rowOutline: `${rowCs.outlineWidth} ${rowCs.outlineStyle} ${rowCs.outlineColor}`,
      rowOffset: rowCs.outlineOffset,
      rowRadius: rowCs.borderRadius,
      listOutlineStyle: listCs.outlineStyle,
      listLocated: list.classList.contains('vsidian-settings-item-located'),
    }
  })
  assert.ok(locatedPaint, '定位条目行应在场')
  assert.equal(locatedPaint.rowOutline, '1px solid rgb(38, 135, 212)', '条目行定位描边应绘制（focusBorder 1px）')
  assert.equal(locatedPaint.rowOffset, '8px', '条目行定位描边外扩 8px（跳转落点档位）')
  assert.equal(locatedPaint.rowRadius, '3px', '定位高亮圆角 3px（跳转落点档位）')
  assert.equal(locatedPaint.listOutlineStyle, 'none', '列表容器不得再套区块级描边（层级互斥）')
  assert.equal(locatedPaint.listLocated, false, '列表容器不带定位高亮类')
  // #462 一次性退场：约 1.5s 后高亮摘除（跳转落点是一次性导航反馈）
  await page.waitForTimeout(1700)
  assert.equal(
    await page.locator('.vsidian-addons-list .vsidian-settings-item-located').count()
      + (await page.locator('.vsidian-addons-list.vsidian-settings-item-located').count()),
    0,
    '定位高亮应在约 1.5s 后一次性退场',
  )

  // ---- 4. 故障组件设置区排障块（状态 + 日志入口 + 重试入口） ----
  await nav.getByRole('button', { name: /Core A/ }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'onegayi.core'))
  await page.evaluate(() => { window.__hostState.faultedOpen = true; window.__pushState() })
  const troubleshoot = page.locator('.vsidian-addons-fault-troubleshoot')
  await troubleshoot.waitFor()
  assert.match(await troubleshoot.innerText(), new RegExp(zhCn['addons.faultTroubleshootTitle']))
  assert.ok((await troubleshoot.innerText()).includes('enable 异常：demo crash'), '故障原因原文可见')
  await troubleshoot.getByRole('button', { name: zhCn['addons.openLogs'] }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.openLogs'))
  await troubleshoot.getByRole('button', { name: zhCn['addons.retryFaulted'] }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.retry' && m.addonId === 'onegayi.core'))
  await page.screenshot({ path: path.join(artifacts, 'sidebar-groups.png') })

  // ---- 5. 空清单空态：结构不消失 ----
  await page.evaluate(() => { window.__hostState.addons = []; window.__pushState() })
  await page.locator('.vsidian-settings-nav-empty').first().waitFor()
  assert.equal(await page.locator('.vsidian-settings-nav-group-label').count(), 3, '空清单时三大组结构仍在场')
  assert.match(await page.locator('.vsidian-settings-nav-empty').first().innerText(), new RegExp(zhCn['addons.sidebarEmptyGroup']))

  assert.deepEqual(errors, [], '页面不得有未捕获异常')
  console.log('[#354] 附加组件侧栏三组与故障排障浏览器回归通过（三组结构/子组归属/分隔绘制/条目路由/排障块/空态）')
  console.log('[#465] 通道堵死与组件设置分页浏览器契约通过（可配置条目直达设置分页/返回 hub/纯运行组件定位行）')
} finally {
  await browser.close()
}
