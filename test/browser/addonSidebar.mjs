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
      kind: 'addons.state', apiVersion: '1.0.0', draft: false,
      openAddonSettingsPage: null, openAddonSettings: window.__hostState.open,
      addons: window.__hostState.addons,
    })
    window.__settingsState = () => ({
      kind: 'addons.settingsState', apiVersion: '1.0.0', draft: false,
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
      // 官方：一启用（含故障暂停）一停用（均有设置能力，侧栏可见）
      { id: 'onegayi.core', label: 'Core A', official: true, status: 'registered', enabled: true, fault: { reason: 'enable 异常：demo crash' }, hasSettingsDefinitions: true },
      { id: 'onegayi.core-off', label: 'Core B', official: true, status: 'registered', enabled: false, hasSettingsDefinitions: true },
      // 第三方：一启用一停用；未注册（不兼容）与无设置能力的纯运行组件不进侧栏分组
      { id: 'a.third-on', label: 'Third On', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      { id: 'a.third-off', label: 'Third Off', official: false, status: 'registered', enabled: false, hasSettingsPage: true },
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      { id: 'a.future', label: 'Future', official: false, status: 'incompatible', apiRange: '^2.0.0' },
    ]
  })
  // 触发一次 addons.state 回灌（侧栏大组重建）
  await page.evaluate(() => window.__pushState())

  // ---- 1. 三组结构与子组归属（用户可见文本） ----
  const nav = page.locator('.vsidian-settings-nav')
  assert.equal(await nav.getByRole('button', { name: zhCn['settings.addonSettingsSection'], exact: true }).count(), 0, '不重复提供组件设置总入口')
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
  assert.ok(!navText.includes('Plain'), '无设置能力的纯运行组件不进侧栏（只在附加组件页列表呈现）')

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
  //      无设置能力的纯运行组件不占侧栏条目 ----
  await nav.getByRole('button', { name: /Third On/ }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'a.third-on'))
  // #465 通道堵死：可配置组件条目导航到「组件设置」分页，附加组件页不
  // 承载任何组件设置内容
  const detail = page.locator('.vsidian-addons-settings')
  await detail.waitFor()
  assert.equal(await detail.isVisible(), true, '点击组件条目后直接显示该组件设置')
  const detailPaint = await detail.evaluate((el) => {
    const style = getComputedStyle(el)
    return { display: style.display, visibility: style.visibility, color: style.color, background: getComputedStyle(document.body).backgroundColor }
  })
  assert.notEqual(detailPaint.display, 'none')
  assert.equal(detailPaint.visibility, 'visible')
  assert.notEqual(detailPaint.color, detailPaint.background, '组件设置文字与背景应有可见色差')
  assert.match(await detail.innerText(), new RegExp(zhCn['addons.settingsAreaTitle'].replace('{label}', 'Third On')))
  assert.equal(await page.locator('.vsidian-addons-list').count(), 0, '组件设置分页不混装管理列表（#465 通道堵死）')

  // ---- 3a. #554 侧栏组件条目唯一选中（宿主 settingsState.open 权威驱动）：
  //      点击 Third On 应答到达后仅其条目 aria-current=page；跨组切到
  //      Core A 后 Third On 熄灭。绘制层断言（选中底色/未选中透明——非
  //      DOM 存在性）。鼠标移开再取样式，避免 hover 底色干扰 ----
  const pageItems = page.locator('.vsidian-settings-nav-item[aria-current="page"]')
  const navItemPaints = async () => {
    await page.mouse.move(2, 2)
    return page.evaluate(() => [...document.querySelectorAll('.vsidian-settings-nav-item')].map((el) => ({
      text: el.textContent ?? '',
      current: el.getAttribute('aria-current'),
      bg: getComputedStyle(el).backgroundColor,
    })))
  }
  await page.locator('.vsidian-settings-nav-item[aria-current="page"]', { hasText: 'Third On' }).waitFor()
  assert.equal(await pageItems.count(), 1, '#554 同一时刻仅一个导航条目 aria-current=page')
  let paints = await navItemPaints()
  assert.equal(paints.filter((p) => p.current === 'page').length, 1)
  assert.ok(paints.find((p) => p.current === 'page')?.text.includes('Third On'), '当前项是刚打开的组件')
  assert.equal(paints.find((p) => p.current === 'page')?.bg, 'rgb(224, 228, 235)', '选中条目应绘制主题选中底色（绘制层）')
  for (const p of paints.filter((x) => x.current === 'false' && x.text !== '')) {
    assert.equal(p.bg, 'rgba(0, 0, 0, 0)', `未选中条目「${p.text}」应保持透明底（不整组点亮）`)
  }
  // 跨核心/第三方分组切换：Core A（核心组）点亮、Third On（第三方组）熄灭
  await nav.getByRole('button', { name: /Core A/ }).click()
  await page.locator('.vsidian-settings-nav-item[aria-current="page"]', { hasText: 'Core A' }).waitFor()
  assert.equal(await pageItems.count(), 1, '切换后仍仅一个条目选中')
  paints = await navItemPaints()
  const selected = paints.find((p) => p.current === 'page')
  assert.ok(selected?.text.includes('Core A'), '切换后当前项落 Core A')
  assert.equal(selected?.bg, 'rgb(224, 228, 235)', '切换后选中条目绘制主题选中底色')
  const thirdAfter = paints.find((p) => p.text.includes('Third On'))
  assert.equal(thirdAfter?.current, 'false', '被切走的组件取消高亮')
  assert.equal(thirdAfter?.bg, 'rgba(0, 0, 0, 0)', '被切走的组件恢复透明底（无旧组件残留）')

  // 「返回组件列表」回本页组件清单（hub 形态）
  await page.getByRole('button', { name: zhCn['addons.closeSettingsArea'], exact: true }).click()
  await page.waitForFunction(() => window.sentMessages.some((m) => m.kind === 'addons.settingsClose'))
  await page.locator('.vsidian-addons-settings-hub').waitFor()
  // #554 关闭设置区（open=null 推送）：高亮摘除，无旧组件残留
  assert.equal(await pageItems.count(), 0, '关闭设置区后侧栏不得残留组件条目高亮')
  // 无设置能力的纯运行组件不占侧栏条目；状态列表仍呈现（2026-10-20 口径修订）
  assert.equal(await nav.getByRole('button', { name: /Plain/ }).count(), 0, '无设置能力的纯运行组件不进侧栏')
  await nav.getByRole('button', { name: zhCn['settings.addonsSection'], exact: true }).click()
  const addonsList = page.locator('.vsidian-addons-list')
  await addonsList.waitFor()
  assert.match(await addonsList.innerText(), /Plain/, '纯运行组件仍在「附加组件」页列表呈现')
  // #554 附加组件页：组件条目不整组点亮——「附加组件」选项按钮按当前页
  // 高亮（绘制层：选中底色），全部组件条目保持透明底
  assert.equal(await pageItems.count(), 1, '附加组件页唯一选中是「附加组件」选项按钮')
  paints = await navItemPaints()
  {
    const addonsOption = paints.find((p) => p.text === zhCn['settings.addonsSection'])
    assert.equal(addonsOption?.current, 'page', '「附加组件」选项按钮按当前页标记')
    assert.equal(addonsOption?.bg, 'rgb(224, 228, 235)', '「附加组件」选项按钮绘制主题选中底色（绘制层）')
  }
  for (const p of paints.filter((x) => x.current === 'false')) {
    if (/Core A|Core B|Third On|Third Off/.test(p.text)) {
      assert.equal(p.bg, 'rgba(0, 0, 0, 0)', `组件条目「${p.text}」不得整组点亮`)
    }
  }
  // 本段新增的 Core A 切换点击会遗留 settingsOpen 记录——清空后续段落
  // 的消息等待基准（第 4 段按「点击后新到达」等待 onegayi.core）
  await page.evaluate(() => { window.sentMessages = [] })

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
  console.log('[#465] 通道堵死与组件设置分页浏览器契约通过（可配置条目直达设置分页/返回 hub/纯运行组件不进侧栏）')
} finally {
  await browser.close()
}
