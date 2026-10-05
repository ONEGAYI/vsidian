// 设置页会话内恢复（真实浏览器）：uiState 上报、真滚动上送与重载后
// focusSection{scroll} 恢复。webview 半在真实布局下验证——宿主半（记忆
// 与握手补发）由 settingsPageHost 单测与集成用例钉住，此处以假宿主按
// 同一协议回放恢复消息。
// 布局层断言取 main 区 scrollTop 实际值（内容可滚动性与恢复值一致性）。
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from './runtime.mjs'
import { buildZhLocaleIsland } from './localeIsland.mjs'
import { buildSettingsMain } from './settingsBundle.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = await buildSettingsMain(root)
const { islandHtml, zhCnMessages: zhCn } = await buildZhLocaleIsland(root)

const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  /** 装载设置页生产包（= 面板打开 / 隐藏重载后的 webview 重建）；
   *  hostReplies 为假宿主对 settings.get 的恢复回放（宿主半补发形态）。
   *  产物 CSS 与 VSCode 变量必须加载：主区独立滚动（overflow）由样式
   *  提供，缺样式时 scrollTop 恒 0，滚动链路无从验证 */
  async function loadSettingsPage(hostReplies = []) {
    await page.setContent(`<html lang="zh-CN"><body class="vscode-dark">${islandHtml}<div id="app"></div></body></html>`)
    await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#1e1e1e; --vscode-editor-foreground:#dddddd; --vscode-sideBar-background:#252526; --vscode-descriptionForeground:#aaaaaa; --vscode-list-activeSelectionBackground:#373d49; --vscode-list-activeSelectionForeground:#ffffff; --vscode-input-background:#313136; --vscode-input-foreground:#dddddd; --vscode-panel-border:#474750; --vscode-focusBorder:#2687d4; } .vsidian-settings-main { height: 420px !important; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.evaluate((replies) => {
      window.savedSettings = {}
      window.sentMessages = []
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.sentMessages.push(message)
        setTimeout(() => {
          if (message.kind === 'settings.get') {
            // source: window 走允许清单身份层（#344 起设置页消息桥同款守卫）
            window.dispatchEvent(new MessageEvent('message', { source: window, data: { kind: 'settings.snapshot', values: window.savedSettings } }))
            for (const reply of replies) {
              window.dispatchEvent(new MessageEvent('message', { source: window, data: reply }))
            }
          }
          // settings.uiState 为通知型消息，宿主不回执（同真实宿主语义）
        }, 0)
      } })
    }, hostReplies)
    await page.addScriptTag({ path: output })
  }

  const uiStates = () => page.evaluate(() =>
    window.sentMessages.filter((m) => m.kind === 'settings.uiState'))
  const mainEl = () => page.locator('.vsidian-settings-main')

  // ---- 首次打开：切到「编辑器」分页 → 真实滚动 → uiState 上报 ----
  // （选编辑器分页：六组设置行在 720px 视口下内容足够长，滚动可复位可恢复）
  await loadSettingsPage()
  await page.locator('.vsidian-settings-nav-item').first().waitFor()
  await page.getByRole('button', { name: zhCn['settings.editorCategory'], exact: true }).click()
  await page.waitForFunction(() =>
    window.sentMessages.some((m) => m.kind === 'settings.uiState' && m.section === 'editor'))
  assert.equal((await uiStates()).at(-1).scrollTop, 0, '切页后应上报复位后的滚动 0')
  // 真实布局滚动：设置后读回实际值（内容不足时被钳制），断言上报与实际一致
  const scrolled = await page.evaluate(() => {
    const main = document.querySelector('.vsidian-settings-main')
    main.scrollTop = 300
    return main.scrollTop
  })
  assert.ok(scrolled > 0, '编辑器分页内容应可滚动（否则恢复断言无意义）')
  await page.waitForFunction(() =>
    window.sentMessages.some((m) => m.kind === 'settings.uiState' && m.section === 'editor' && m.scrollTop > 0))
  // 上报值经 Math.round 取整（协议守卫只收非负整数），与原始 readback 的
  // 比对须在取整后进行——分数缩放环境下 readback 可为小数，精确比对原值
  // 会 flake
  assert.equal((await uiStates()).at(-1).scrollTop, Math.round(scrolled), '滚动事件应上报取整后的滚动位置')

  // ---- 重载（= 面板关闭重开/隐藏释放后的 webview 重建）：假宿主按记忆
  // 补发恢复定位（与宿主实现同形态：settings.get 应答后 focusSection 带 scroll）----
  await loadSettingsPage([{ kind: 'settings.focusSection', section: 'editor', scroll: scrolled }])
  await page.locator('.vsidian-settings-nav-item').first().waitFor()
  // 恢复布局层断言：渲染「编辑器」分页且主区滚动回到记忆值（回放值=应用
  // 值=读回值，链路自洽，不经取整）
  await page.getByRole('heading', { name: zhCn['settings.editorCategory'] }).waitFor()
  await page.waitForFunction((expected) =>
    document.querySelector('.vsidian-settings-main').scrollTop === expected, scrolled)
  assert.equal(await mainEl().evaluate((el) => el.scrollTop), scrolled, '重载后滚动应恢复到记忆位置')
  // 恢复应用后的上报闭环：切页（render）与滚动恢复（scroll 事件）均上报，
  // 宿主记忆收敛到 {editor, 恢复值}（上报侧取整后比对，理由同上）
  await page.waitForFunction((expected) => {
    const states = window.sentMessages.filter((m) => m.kind === 'settings.uiState')
    const last = states.at(-1)
    return last && last.section === 'editor' && last.scrollTop === expected
  }, Math.round(scrolled))
  assert.equal(await mainEl().evaluate((el) => el.scrollTop), scrolled, '重载后滚动应恢复到记忆位置')

  // ---- 快捷键分页输入态恢复（PR #346 方案 A：state 载荷）----
  // 快捷键页此前是会话内恢复的漏网之鱼：分页 id 与主区滚动经 uiState 恢复
  // 了，但搜索词/筛选签/键位过滤模式丢失（webview 销毁即失）。用例覆盖
  // 重载路径的三态恢复：搜索词、筛选签（userAssigned）与滚动位。
  // 可滚性保障：主区高度在装载注入中压到 420px（loadSettingsPage 固定
  // 样式，重载同样生效），overrides 覆盖表格族七操作——userAssigned 筛选
  // 下七行（标题均含「表格」），内容超出可视高，滚动恢复断言才有意义
  // （选 editor 分页的同款理由）
  const kbOverrides = {}
  const tableOpIds = ['tableCreate', 'insertRowAbove', 'insertRowBelow', 'deleteRow',
    'insertColumnLeft', 'insertColumnRight', 'deleteColumn']
  for (const [index, id] of tableOpIds.entries()) {
    kbOverrides[id] = [`ctrl+alt+${index}`] // 唯一键位（互不冲突，也不撞默认绑定）
  }
  kbOverrides.bold = []
  const kbSnapshot = { kind: 'keybindings.snapshot', overrides: kbOverrides }
  await loadSettingsPage([kbSnapshot])
  await page.locator('.vsidian-settings-nav-item').first().waitFor()
  await page.getByRole('button', { name: zhCn['keybindingSettings.title'], exact: true }).click()
  await page.waitForFunction(() =>
    window.sentMessages.some((m) => m.kind === 'settings.uiState' && m.section === 'keybindings'))
  const kbSearch = page.locator('.vsidian-keybindings-search')
  await kbSearch.fill('表格')
  await page.locator('.vsidian-keybindings-filter[data-filter="userAssigned"]').click()
  // 输入态变化即时报：uiState 携带 state 载荷（captureState 四项）
  await page.waitForFunction(() => {
    const last = window.sentMessages.filter((m) => m.kind === 'settings.uiState').at(-1)
    return last?.state?.filter === 'userAssigned' && last?.state?.query === '表格'
  })
  const kbScrolled = await page.evaluate(() => {
    const main = document.querySelector('.vsidian-settings-main')
    main.scrollTop = 260
    return main.scrollTop
  })
  assert.ok(kbScrolled > 0, '快捷键页筛选后内容应可滚动（否则恢复断言无意义）')
  // 滚动上报到达后再取消息（scroll 事件在赋值后异步派发）
  await page.waitForFunction((expected) => {
    const last = window.sentMessages.filter((m) => m.kind === 'settings.uiState').at(-1)
    return last?.section === 'keybindings' && last.scrollTop === expected
  }, Math.round(kbScrolled))
  // 滚动上报不重报 state（输入态未变省载荷）：带 state 的最近一条仍是输入
  // 态变化时的上报，其后纯滚动消息不带 state 字段
  const kbStates = await uiStates()
  const kbState = kbStates.filter((m) => m.state).at(-1).state
  assert.deepEqual(kbState, { query: '表格', keyQuery: '', searchMode: 'text', filter: 'userAssigned' })
  const kbScrollReport = kbStates.at(-1)
  assert.equal(kbScrollReport.scrollTop, Math.round(kbScrolled), '滚动上报应携带取整后的滚动位置')
  assert.ok(!('state' in kbScrollReport), '纯滚动上报不得携带 state 载荷（省载荷契约）')

  // 重载（假宿主按记忆回放完整握手序列：keybindings.snapshot →
  // focusSection{scroll, state} → locale.changed——换包重渲染不破坏恢复态）
  await loadSettingsPage([
    kbSnapshot,
    { kind: 'settings.focusSection', section: 'keybindings', scroll: kbScrolled, state: kbState },
    { kind: 'locale.changed', lang: 'zh-cn', messages: zhCn },
  ])
  await page.locator('.vsidian-keybindings-search').waitFor()
  // 三态恢复断言：搜索词、筛选签、滚动位
  assert.equal(await page.locator('.vsidian-keybindings-search').inputValue(), '表格', '重载后搜索词应恢复')
  assert.equal(
    await page.locator('.vsidian-keybindings-filter[data-filter="userAssigned"]').getAttribute('aria-pressed'),
    'true', '重载后筛选签应恢复为 userAssigned')
  const kbRowCount = await page.locator('.vsidian-keybindings-row').count()
  assert.equal(kbRowCount, 7, '恢复的搜索词+筛选签应过滤出表格族七行')
  await page.waitForFunction((expected) =>
    document.querySelector('.vsidian-settings-main').scrollTop === expected, kbScrolled)
  assert.equal(await mainEl().evaluate((el) => el.scrollTop), kbScrolled, '重载后快捷键页滚动应恢复到记忆位置')
  assert.deepEqual(errors, [], '页面不得有未捕获错误')
} finally {
  await browser.close()
}
console.log('settingsPageRestore: ok')
