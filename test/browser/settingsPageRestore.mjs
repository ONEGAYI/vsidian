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
    await page.addStyleTag({ content: `:root { --vscode-font-family: "Segoe UI", "Microsoft YaHei", sans-serif; --vscode-editor-background:#1e1e1e; --vscode-editor-foreground:#dddddd; --vscode-sideBar-background:#252526; --vscode-descriptionForeground:#aaaaaa; --vscode-list-activeSelectionBackground:#373d49; --vscode-list-activeSelectionForeground:#ffffff; --vscode-input-background:#313136; --vscode-input-foreground:#dddddd; --vscode-panel-border:#474750; --vscode-focusBorder:#2687d4; }` })
    await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
    await page.evaluate((replies) => {
      window.savedSettings = {}
      window.sentMessages = []
      window.acquireVsCodeApi = () => ({ postMessage(message) {
        window.sentMessages.push(message)
        setTimeout(() => {
          if (message.kind === 'settings.get') {
            window.dispatchEvent(new MessageEvent('message', { data: { kind: 'settings.snapshot', values: window.savedSettings } }))
            for (const reply of replies) {
              window.dispatchEvent(new MessageEvent('message', { data: reply }))
            }
          }
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
  assert.deepEqual(errors, [], '页面不得有未捕获错误')
} finally {
  await browser.close()
}
console.log('settingsPageRestore: ok')
