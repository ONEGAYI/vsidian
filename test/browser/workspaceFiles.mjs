import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactPath, build, chromium } from './runtime.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = artifactPath(root, 'workspaceFiles/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/workspaceFilesFixture.ts')],
  bundle: true, outfile: output, format: 'iife', loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const folder = { id: 'folder', name: '资料', level: 1, kind: 'folder', expanded: false, manageable: true }
const file = { id: 'current', name: '随记.md', level: 1, kind: 'file', current: true, manageable: true, previewKind: 'markdown' }
const child = { id: 'child', name: '参考文献.md', level: 2, kind: 'file', manageable: true, previewKind: 'markdown' }
const entries = [{ id: 'root', name: '笔记工作区', level: 0, kind: 'root', expanded: true, manageable: true }, folder, file]
const tabs = [{ id: 'tab-current', name: '随记.md', current: true },
  { id: 'tab-other', name: '草稿.md', detail: '论文', current: false, previewKind: 'markdown' }]
const browser = await chromium.launch({ headless: true, channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 780 }, reducedMotion: 'reduce' })
  await page.setContent(`<style>
    body { --vscode-font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
      --vscode-editor-background: #1e1e1e; --vscode-editor-foreground: #dedede;
      --vscode-sideBar-background: #242424; --vscode-sideBar-foreground: #ddd;
      --vscode-panel-border: #393939; --vscode-list-activeSelectionBackground: #264f78;
      --vscode-list-activeSelectionForeground: #fff; --vscode-list-hoverBackground: #303030;
      --vscode-focusBorder: #007fd4; --vscode-descriptionForeground: #a5a5a5; }
    </style><div id="app"></div>`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const send = (message) => page.evaluate((value) => window.filesReceive(value), message)
  const state = (open, customEntries = entries, customTabs = tabs) => send({
    kind: 'workspaceFiles.snapshot', open, loading: false, canCreate: open,
    entries: open ? customEntries : [], tabs: open ? customTabs : [],
  })
  const lastMessage = () => page.evaluate(() => window.messages.filter(m => m.kind.startsWith('workspaceFiles.')).at(-1))
  const left = page.locator('.vsidian-file-sidebar')
  const leftToggle = page.locator('.vsidian-file-sidebar-toggle')
  const rightToggle = page.locator('.vsidian-sidebar-toggle')
  const main = page.locator('.vsidian-main')

  assert.equal(await leftToggle.count(), 1, '主顶栏左端必须有左侧栏开关')
  assert.equal(await leftToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await leftToggle.getAttribute('aria-label'), '展开左侧栏')
  assert.equal(await left.locator('button:visible').count(), 0, '收起的栏不能露出新建按钮')
  assert.equal((await main.boundingBox()).x, 0)
  const iconLine = (target) => target.locator('line').evaluate(el => ({
    x: Number(el.getAttribute('x1')), width: getComputedStyle(el).strokeWidth,
  }))
  assert.deepEqual(await iconLine(leftToggle), { x: 5, width: '1.5px' })
  assert.deepEqual(await iconLine(rightToggle), { x: 11, width: '1.5px' })
  assert.ok((await leftToggle.boundingBox()).x < (await page.locator('.vsidian-settings-toggle').boundingBox()).x)

  await leftToggle.click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.toggle' })
  await state(true)
  const header = left.locator('.vsidian-file-sidebar-header')
  const refresh = header.getByRole('button', { name: '刷新文件树' })
  const collapseAll = header.getByRole('button', { name: '折叠所有文件夹' })
  assert.deepEqual(await header.getByRole('button').evaluateAll(buttons => buttons.map(el => el.getAttribute('aria-label'))),
    ['新建文件', '新建文件夹', '刷新文件树', '折叠所有文件夹'], '栏头按钮顺序应与参考图一致')
  for (const button of [refresh, collapseAll]) {
    assert.equal(await button.evaluate(el => {
      const svg = el.querySelector('svg')
      const r = svg.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return r.width === 16 && el.contains(hit) && getComputedStyle(svg).stroke !== 'none'
    }), true, '两个动作复用可命中的 16px 栏头图标槽')
  }
  assert.equal(await leftToggle.getAttribute('aria-label'), '收起左侧栏')
  assert.deepEqual(await iconLine(leftToggle), { x: 5, width: '3px' })
  assert.equal(await left.getByText('文件', { exact: true }).isVisible(), true)
  assert.equal(await left.getByText('已打开', { exact: true }).isVisible(), true)
  const tree = left.locator('.vsidian-file-tree')
  const current = tree.getByRole('button', { name: '随记.md', exact: true })
  assert.equal(await current.getAttribute('aria-current'), 'page')
  assert.equal(await current.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(38, 79, 120)')
  assert.equal(await current.evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }), true, '当前文件行必须实际可见且能命中')
  const initialWidth = (await main.boundingBox()).width
  assert.ok(Math.abs((await main.boundingBox()).x - 280) < 1, '主区随左栏实际让位')
  assert.equal((await left.locator('.vsidian-file-sidebar-header').boundingBox()).height,
    (await page.locator('.vsidian-toolbar').boundingBox()).height)

  const dir = tree.getByRole('button', { name: '资料', exact: true })
  await dir.focus()
  await page.keyboard.press('Enter')
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.activate', id: 'folder' })
  await state(true, [entries[0], { ...folder, expanded: true }, child, file])
  assert.equal(await dir.getAttribute('aria-expanded'), 'true')
  assert.equal(await dir.evaluate(el => el === document.activeElement), true, '刷新不得打断键盘导航')
  await tree.getByRole('button', { name: '参考文献.md', exact: true }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.activate', id: 'child' })
  await left.getByRole('button', { name: /^草稿\.md/ }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.activate', id: 'tab-other' })
  await left.getByRole('button', { name: '新建文件', exact: true }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.create', entry: 'file' })
  await current.hover()
  await tree.getByRole('button', { name: '管理随记.md', exact: true }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.manage', id: 'current' })

  await rightToggle.click()
  await send({ kind: 'view.mode.set', mode: 'reading' })
  await page.locator('.vsidian-reading-block').first().waitFor({ state: 'visible' })
  assert.ok((await main.boundingBox()).width < initialWidth, '两栏应能同时打开')
  assert.deepEqual(await iconLine(rightToggle), { x: 11, width: '3px' })
  assert.equal(await current.isVisible(), true, '阅读模式同样能用左栏')
  await page.mouse.move(660, 240)
  await page.screenshot({ path: path.join(path.dirname(output), 'files-sidebar.png'),
    clip: { x: 0, y: 0, width: 1440, height: 420 } })
  await header.screenshot({ path: path.join(path.dirname(output), 'files-sidebar-actions.png') })
  await refresh.click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.refresh' })
  await state(true, [entries[0], { ...folder, expanded: true }, { ...child, name: '更新后的文件.md' }, file])
  const refreshedFile = tree.getByRole('button', { name: '更新后的文件.md', exact: true })
  assert.equal(await refreshedFile.isVisible(), true)
  await collapseAll.click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.collapseAll' })
  await state(true)
  assert.equal(await dir.getAttribute('aria-expanded'), 'false')
  assert.equal(await refreshedFile.count(), 0)
  assert.equal(await left.getByRole('button', { name: /^草稿\.md/ }).isVisible(), true)

  await page.setViewportSize({ width: 540, height: 780 })
  assert.ok(await left.getByText('文件', { exact: true }).isVisible())
  await leftToggle.click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.toggle' })
  await state(false)
  assert.equal(await leftToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await rightToggle.getAttribute('aria-expanded'), 'true', '关左栏不关右栏')

  await page.setViewportSize({ width: 1440, height: 780 })
  const longTree = [entries[0], ...Array.from({ length: 60 }, (_, i) => ({ ...child, level: 1,
    id: `note-${i}`, name: `笔记 ${i}.md` }))]
  longTree.splice(35, 0, file)
  // 固定外壳到开合动画中间态；首份数据到达时内层行宽不能随动画挤扁。
  await left.evaluate(el => { el.style.width = '18px' })
  await state(true, longTree)
  assert.ok((await left.locator('.vsidian-file-sidebar-header').boundingBox()).width > 270)
  await left.evaluate(el => { el.style.removeProperty('width') })
  const landed = () => current.evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  })
  assert.equal(await landed(), true, '长文件树打开时应滚到当前文件')
  await state(true, longTree, [...tabs, { id: 'tab-third', name: '参考.md' }])
  assert.equal(await landed(), true, '已打开分组增高不能遮住当前文件')
  assert.equal(await left.getByText('已打开', { exact: true }).isVisible(), true, '文件树滚动不带走已打开分组')
  await page.evaluate(() => document.body.style.setProperty('--vscode-list-activeSelectionBackground', '#bfdcff'))
  assert.equal(await current.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(191, 220, 255)')

  await send({ kind: 'workspaceFiles.snapshot', open: true, loading: false, canCreate: false, entries, tabs })
  assert.equal(await header.getByRole('button', { name: '新建文件', exact: true }).isDisabled(), true)
  assert.equal(await refresh.isEnabled(), true, '只读工作区仍可以刷新文件树')
  assert.equal(await collapseAll.isEnabled(), true, '只读工作区仍可以折叠文件夹')
  await state(true, [], [])
  assert.equal(await left.getByText('未打开工作区文件夹').isVisible(), true)
  assert.equal(await refresh.isDisabled(), true)
  assert.equal(await collapseAll.isDisabled(), true)
  console.log('[PASS] 镜像开关、双模式布局、绘制选中态与文件操作入口')

  await send({ kind: 'view.mode.set', mode: 'live' })
  const expanded = [entries[0], { ...folder, expanded: true }, child, file]
  const withUntitled = [...tabs, { id: 'untitled', name: '无标题-1' }]
  await state(true, expanded, withUntitled)
  await page.evaluate(() => document.body.style.removeProperty('--vscode-list-activeSelectionBackground'))
  const target = tree.getByRole('button', { name: '参考文献.md', exact: true })
  const popup = page.locator('.vsidian-hover-popup')
  const requests = () => page.evaluate(() => window.messages.filter(m => m.kind === 'hover.request'))
  const previews = await page.evaluate(() => window.messages.length)
  await page.mouse.move(650, 60)
  await target.hover({ position: { x: 60, y: 12 } })
  await page.waitForTimeout(450)
  assert.equal((await requests()).length, 0, '普通悬停只保留原有提示')
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  await popup.waitFor({ state: 'visible', timeout: 2500 }).catch(async error => {
    throw new Error(`文件树未打开预览；读请求 ${JSON.stringify(await requests())}`, { cause: error })
  })
  await page.keyboard.up(modifier)
  const respond = async (id, fsPath, title) => {
    const request = (await requests()).at(-1)
    assert.equal(request.workspaceFileId, id)
    assert.equal(request.linkHref ?? request.directTarget, undefined, '按宿主条目 ID 定位，不传路径')
    const text = `# ${title}\n\n- [ ] 只读待办\n\n${Array.from({length: 18}, (_, i) => `第 ${i + 1} 段内容。`).join('\n\n')}`
    await send({ kind: 'hover.result', reqId: request.reqId, instanceId: request.instanceId, ok: true,
      target: { fsPath, relPath: fsPath.split('/').at(-1) }, version: 7, text,
      range: { start: 0, end: text.length }, scope: { kind: 'full' } })
    await popup.getByText(title, { exact: true }).waitFor({ state: 'visible', timeout: 2500 })
  }
  await respond('child', '/notes/资料/参考文献.md', '文件树预览正文')
  const cardBox = await popup.boundingBox()
  const sidebarBox = await left.boundingBox()
  assert.ok(cardBox.x >= sidebarBox.x + sidebarBox.width, '宽窗口下浮窗不能挡住相邻文件行')
  assert.equal(await popup.getByRole('checkbox').first().isDisabled(), true, '即便父正文为 Live，任务也不可写')
  assert.equal(await popup.locator('.cm-editor').count(), 0, '条目浮窗不能挂载可编辑正文')
  assert.equal(await popup.evaluate(el => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 20))
  }), true, '卡片必须实际可命中')
  await page.screenshot({ path: path.join(path.dirname(output), 'files-hover-preview.png') })
  await popup.hover()
  await page.mouse.wheel(0, 140)
  await page.waitForTimeout(450)
  assert.equal(await popup.isVisible(), true, '松开 Ctrl、移入浮窗滚动后仍可阅读')
  const anchor = await target.elementHandle()
  await state(true, [entries[0], { ...folder, expanded: true }, { ...child, current: true }, { ...file, current: false }], withUntitled)
  assert.equal(await anchor.evaluate(el => el.isConnected), true)
  assert.equal(await popup.isVisible(), true, '刷新保留同一文件的锚点与内容')
  assert.equal((await requests()).length, 1)
  const inserted = Array.from({ length: 32 }, (_, i) => ({ ...file, id: `before-${i}`, name: `新增文件 ${i}.md`, current: false }))
  await state(true, [entries[0], { ...folder, expanded: true }, ...inserted, { ...child, current: true }], withUntitled)
  assert.ok(await tree.evaluate(el => el.parentElement.scrollTop > 0), '快照改变了树的滚动位置')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await popup.isVisible(), true, '刷新对齐可见的同一条目时，程序滚动也不能关闭卡片')
  await state(true, entries, withUntitled)
  await popup.waitFor({ state: 'detached', timeout: 2500 })
  await page.mouse.move(650, 60)

  await page.keyboard.down(modifier)
  for (const noPreview of [dir, tree.getByRole('button', { name: '管理随记.md', exact: true }),
    left.getByRole('button', { name: '无标题-1', exact: true })]) {
    await noPreview.hover()
    await page.waitForTimeout(370)
    assert.equal((await requests()).length, 1, '目录、管理按钮和未命名标签不触发预览')
  }
  await left.getByRole('button', { name: /^草稿\.md/ }).hover()
  await popup.waitFor({ state: 'visible', timeout: 2500 })
  await page.keyboard.up(modifier)
  await respond('tab-other', '/outside/草稿.md', '已打开标签预览正文')
  await page.keyboard.press('Escape')
  await popup.waitFor({ state: 'detached', timeout: 2500 })
  assert.deepEqual(await page.evaluate(start => window.messages.slice(start).filter(m =>
    m.kind === 'workspaceFiles.activate' || m.kind === 'refEdit.bind' || m.kind === 'edit.request'), previews), [])
  console.log('[PASS] 两类条目 Ctrl 悬停复用只读卡片，刷新保留、折叠与 Esc 关闭')
} finally {
  await browser.close()
}
