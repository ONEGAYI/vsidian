import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactPath, build, chromium } from './runtime.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = artifactPath(root, 'workspaceFiles/main.js')
await build({ entryPoints: [path.join(root, 'test/browser/workspaceFilesFixture.ts')],
  bundle: true, outfile: output, format: 'iife', loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const createActions = ['createFile', 'createFolder']
const fileActions = ['rename', 'trash']
const rootMove = { scope: 'file://', directory: 'root' }
const folderMove = { ...rootMove, directory: 'folder' }
const folder = { id: 'folder', name: '资料', level: 1, kind: 'folder', expanded: false, actions: [...createActions, ...fileActions], move: folderMove }
const file = { id: 'current', name: '随记.md', level: 1, kind: 'file', current: true, actions: fileActions, previewKind: 'markdown', move: rootMove }
const child = { id: 'child', name: '参考文献.md', level: 2, kind: 'file', actions: fileActions, previewKind: 'markdown', move: folderMove }
const entries = [{ id: 'root', name: '笔记工作区', level: 0, kind: 'root', expanded: true, actions: createActions, move: rootMove }, folder, file]
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
      --vscode-list-dropBackground: #314963;
      --vscode-focusBorder: #007fd4; --vscode-descriptionForeground: #a5a5a5;
      --vscode-menu-background: #2e3033; --vscode-errorForeground: #f48771; }
    </style><div id="app"></div>`)
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })
  const send = (message) => page.evaluate((value) => window.filesReceive(value), message)
  const state = (open, customEntries = entries, customTabs = tabs) => send({
    kind: 'workspaceFiles.snapshot', open, loading: false, canCreate: open,
    entries: open ? customEntries : [], tabs: open ? customTabs : [],
  })
  const lastMessage = () => page.evaluate(() => window.messages.filter(m => m.kind.startsWith('workspaceFiles.')).at(-1))
  const waitMessage = message => page.waitForFunction(expected => {
    const last = window.messages.filter(m => m.kind.startsWith('workspaceFiles.')).at(-1)
    return JSON.stringify(last) === JSON.stringify(expected)
  }, message, { timeout: 2000 })
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
  await waitMessage({ kind: 'workspaceFiles.activate', id: 'child', mode: 'preview' })
  await left.getByRole('button', { name: /^草稿\.md/ }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.activate', id: 'tab-other' })
  await left.getByRole('button', { name: '新建文件', exact: true }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.create', entry: 'file' })
  await current.hover()
  await tree.getByRole('button', { name: '管理随记.md', exact: true }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.manage', id: 'current' })

  const clickAt = await current.boundingBox()
  const menuX = Math.round(clickAt.x + 34), menuY = Math.round(clickAt.y + clickAt.height / 2)
  await page.mouse.click(menuX, menuY, { button: 'right' })
  const fileMenu = page.getByRole('menu', { name: '管理随记.md' })
  await fileMenu.waitFor({ state: 'visible', timeout: 1500 })
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.manage', id: 'current' }, '右键只开菜单，不激活文件')
  assert.deepEqual(await fileMenu.getByRole('menuitem').allTextContents(), ['打开', '重命名', '移到回收站'])
  assert.deepEqual(await fileMenu.evaluate(menu => {
    const box = menu.getBoundingClientRect()
    const item = menu.querySelector('[data-vsidian-command="activate"]')
    const first = item.getBoundingClientRect()
    const hit = item.contains(document.elementFromPoint(first.x + first.width / 2, first.y + first.height / 2))
    return { x: box.x, y: box.y, hit, radius: getComputedStyle(menu).borderRadius, bg: getComputedStyle(menu).backgroundColor,
      danger: getComputedStyle(menu.querySelector('[data-vsidian-command="trash"]')).color }
  }), { x: menuX, y: menuY, hit: true, radius: '5px', bg: 'rgb(46, 48, 51)', danger: 'rgb(244, 135, 113)' })
  await page.screenshot({ path: path.join(path.dirname(output), 'files-context-menu.png'),
    clip: { x: 0, y: 0, width: 850, height: 390 } })
  await page.keyboard.press('ArrowDown')
  assert.equal(await fileMenu.getByRole('menuitem', { name: '打开' }).evaluate(el => el === document.activeElement), true)
  await page.keyboard.press('Escape')
  assert.equal(await fileMenu.count(), 0)
  assert.equal(await current.evaluate(el => el === document.activeElement), true, 'Esc 把焦点还给触发文件')
  await send({ kind: 'keybindings.changed', overrides: { workspaceFilesToggle: ['shift+f10'] } })
  await page.keyboard.press('Shift+F10')
  await fileMenu.getByRole('menuitem', { name: '重命名' }).click({ timeout: 1500 })
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.action', id: 'current', action: 'rename' })
  assert.equal(await fileMenu.count(), 0)
  await page.locator('.cm-content').focus()
  await page.keyboard.press('Shift+F10')
  assert.equal(await page.evaluate(() => window.messages.some(m => m.kind === 'keybindings.execute' && m.id === 'workspaceFilesToggle')), true,
    '正文仍执行用户为 Shift+F10 绑定的操作')
  await send({ kind: 'keybindings.changed', overrides: {} })

  await dir.click({ button: 'right' })
  const dirMenu = page.getByRole('menu', { name: '管理资料', exact: true })
  assert.deepEqual(await dirMenu.getByRole('menuitem').allTextContents(), ['折叠文件夹', '新建文件', '新建文件夹', '重命名', '移到回收站'])
  await dirMenu.getByRole('menuitem', { name: '折叠文件夹' }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.activate', id: 'folder', expanded: false })
  await dir.click({ button: 'right' })
  await dirMenu.getByRole('menuitem', { name: '新建文件夹' }).click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.action', id: 'folder', action: 'createFolder' })
  await tree.getByRole('button', { name: '笔记工作区', exact: true }).click({ button: 'right' })
  const rootMenu = page.getByRole('menu', { name: '管理笔记工作区' })
  assert.deepEqual(await rootMenu.getByRole('menuitem').allTextContents(), ['折叠文件夹', '新建文件', '新建文件夹'])
  await page.mouse.click(600, 160)
  assert.equal(await rootMenu.count(), 0, '外点关闭菜单')

  const withChild = [entries[0], { ...folder, expanded: true }, child, file]
  await current.click({ button: 'right' })
  await state(true, withChild)
  assert.equal(await fileMenu.isVisible(), true, '未变化的条目刷新保留菜单')
  await state(true, [...withChild.slice(0, -1), { ...file, actions: ['rename'] }])
  assert.equal(await fileMenu.count(), 0, '过期操作快照关闭菜单')
  await current.click({ button: 'right' })
  assert.deepEqual(await fileMenu.getByRole('menuitem').allTextContents(), ['打开', '重命名'], '不支持回收站时无该项')
  await state(true, withChild.slice(0, -1))
  assert.equal(await fileMenu.count(), 0, '目标删除后没有可执行菜单')
  await state(true, withChild)
  console.log('[PASS] 文件树右键菜单：定位与主题绘制、键盘还焦、权限和目标变化')

  await rightToggle.click()
  await send({ kind: 'view.mode.set', mode: 'reading' })
  await page.locator('.vsidian-reading-block').first().waitFor({ state: 'visible' })
  assert.ok((await main.boundingBox()).width < initialWidth, '两栏应能同时打开')
  assert.deepEqual(await iconLine(rightToggle), { x: 11, width: '3px' })
  assert.equal(await current.isVisible(), true, '阅读模式同样能用左栏')
  await current.click({ button: 'right' })
  assert.equal(await fileMenu.isVisible(), true, '阅读模式只接管左侧文件树本身的右键')
  await page.keyboard.press('Escape')
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

  await page.setViewportSize({ width: 540, height: 230 })
  assert.ok(await left.getByText('文件', { exact: true }).isVisible())
  await current.click({ button: 'right', position: { x: 110, y: 12 }, timeout: 3000 })
  assert.equal(await fileMenu.evaluate(menu => {
    const box = menu.getBoundingClientRect()
    const action = menu.querySelector('[data-vsidian-command="activate"]')
    const hit = document.elementFromPoint(box.x + 16, action.getBoundingClientRect().y + 12)
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && action.contains(hit)
  }), true, '窄窗口边缘菜单仍可实际命中')
  await leftToggle.click()
  assert.deepEqual(await lastMessage(), { kind: 'workspaceFiles.toggle' })
  await state(false)
  assert.equal(await fileMenu.count(), 0, '收起左栏后不留过期菜单')
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
  await target.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menu', { name: '管理参考文献.md' }).waitFor({ state: 'visible', timeout: 1500 })
  await page.keyboard.press('Escape')
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
  await state(true, expanded, withUntitled)
  await state(true, [entries[0], { ...folder, expanded: true }, child, ...inserted, file], withUntitled)
  assert.equal(await anchor.evaluate(el => {
    const scroller = el.closest('.vsidian-file-sidebar-scroll')
    return el.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
  }), true, '刷新为当前文件滚动，但非当前预览锚点仍在树中')
  await page.waitForTimeout(400)
  assert.equal(await popup.isVisible(), true, '锚点因快照调整而滚出视口时保留卡片')
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

  const picture = { id: 'picture', name: '原图 #.png', kind: 'file', level: 1, previewKind: 'image', actions: [] }
  const display = 'https://local-resource.example/preview.png?v=1'
  await page.route('https://local-resource.example/preview.png*', route => {
    const contentType = 'image/png'
    return route.request().url() === display
      ? route.fulfill({ contentType, path: path.join(root, 'media', 'vsidian-icon.png') })
      : route.fulfill({ contentType, body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') })
  })
  await state(true, [...entries, picture], withUntitled)
  await page.keyboard.down(modifier)
  await tree.getByRole('button', { name: picture.name, exact: true }).hover({ position: { x: 60, y: 12 } })
  await popup.waitFor({ state: 'visible', timeout: 2500 })
  await page.keyboard.up(modifier)
  const { reqId, instanceId, workspaceFileId } = (await requests()).at(-1)
  assert.equal(workspaceFileId, picture.id)
  await send({ kind: 'hover.result', reqId, instanceId, ok: true, contentKind: 'image', imageSrc: display,
    target: { fsPath: '/notes/原图 #.png', relPath: picture.name }, text: '', version: 1,
    range: { start: 0, end: 0 }, scope: { kind: 'plain' } })
  await popup.locator('img[data-vsidian-img-state="loaded"]').waitFor({ state: 'visible', timeout: 2500 })
  await popup.locator('.vsidian-graphic-frame').hover({ position: { x: 30, y: 30 }, timeout: 2500 })
  await popup.locator('.vsidian-graphic-chrome-popup').click({ timeout: 2500 })
  await page.waitForFunction(() => document.querySelector('.vsidian-diagram-media img')?.naturalWidth > 1, undefined, { timeout: 2000 })
  await page.locator('.vsidian-diagram-refresh').click()
  await page.waitForFunction(src => {
    const el = document.querySelector('.vsidian-diagram-media img')
    return el?.src !== src && el?.naturalWidth === 1
  }, display, { timeout: 2000 })
  const exportOriginal = page.locator('.vsidian-diagram-export-image')
  assert.equal(await exportOriginal.isEnabled(), true, '本地图片的显示别名不能禁用另存')
  await exportOriginal.click()
  const exportRequest = await page.evaluate(() => window.messages.find(m => m.kind === 'image.export'))
  assert.equal(exportRequest.workspaceFileId, picture.id)
  assert.equal(exportRequest.fileName, picture.name)
  await page.keyboard.press('Escape')
  console.log('[PASS] 侧栏本地图复用放大与另存，并以条目身份发起导出')

  const layout = (width = 280, openedHeight = null) => send({ kind: 'workspaceFiles.layout', layout: { width, openedHeight } })
  const center = async locator => {
    const box = await locator.boundingBox({ timeout: 2000 })
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const widthHandle = left.getByRole('separator', { name: '调整文件侧栏宽度' })
  const heightHandle = left.getByRole('separator', { name: '调整已打开列表高度' })
  const opened = left.getByRole('list', { name: '已打开', exact: true })
  const manyTabs = [...tabs, ...Array.from({ length: 22 }, (_, i) => ({ id: `tab-${i}`, name: `临时笔记 ${i}.md` }))]
  await state(true, [...entries, ...inserted], manyTabs)
  await layout()
  const oldHeight = (await opened.boundingBox()).height
  const widthAt = await center(widthHandle)
  await page.mouse.move(widthAt.x, widthAt.y)
  assert.deepEqual(await widthHandle.evaluate(el => {
    const r = el.getBoundingClientRect()
    return [el === document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      getComputedStyle(el).cursor, getComputedStyle(el, '::before').backgroundColor]
  }), [true, 'col-resize', 'rgb(0, 127, 212)'])
  await page.mouse.down()
  await page.mouse.move(widthAt.x + 88, widthAt.y, { steps: 5 })
  assert.ok(Math.abs((await left.boundingBox()).width - 368) < 1, '拖动时正文立即让位')
  await page.mouse.up()
  await waitMessage({ kind: 'workspaceFiles.resize', dimension: 'width', value: 368 })
  assert.equal((await opened.boundingBox()).height, oldHeight)

  const treeScroller = tree.locator('..')
  const treeHeight = (await treeScroller.boundingBox()).height
  const heightAt = await center(heightHandle)
  await page.mouse.move(heightAt.x, heightAt.y)
  assert.equal(await heightHandle.evaluate(el => getComputedStyle(el).cursor), 'row-resize')
  await page.mouse.down()
  await page.mouse.move(heightAt.x, heightAt.y + 60, { steps: 5 })
  assert.equal((await opened.boundingBox()).height, oldHeight + 60)
  assert.equal((await treeScroller.boundingBox()).height, treeHeight - 60)
  await page.mouse.up()
  await waitMessage({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: oldHeight + 60 })
  await opened.evaluate(el => { el.scrollTop = 60 })
  assert.equal(await opened.evaluate(el => el.scrollTop), 60)
  assert.equal(await treeScroller.evaluate(el => el.scrollTop), 0, '两个列表仍独立滚动')
  await page.screenshot({ path: path.join(path.dirname(output), 'files-resized.png') })

  const resizeCount = () => page.evaluate(() => window.messages.filter(message => message.kind === 'workspaceFiles.resize').length)
  for (const { handle, pane, dimension, dx, dy, first } of [
    { handle: widthHandle, pane: left, dimension: 'width', dx: 35, dy: 0, first: 'left' },
    { handle: heightHandle, pane: opened, dimension: 'height', dx: 0, dy: 35, first: 'right' },
  ]) {
    const before = (await pane.boundingBox())[dimension]
    const sent = await resizeCount()
    const { x, y } = await center(handle)
    await page.mouse.move(x, y)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(x + dx, y + dy)
    assert.equal((await pane.boundingBox())[dimension], before + 35, '左键仍可实时调整')
    await page.mouse.down({ button: 'right' })
    assert.equal((await pane.boundingBox())[dimension], before, '拖动中按下右键，立即恢复拖动前尺寸')
    await page.mouse.up({ button: first })
    await page.mouse.move(x + dx * 2, y + dy * 2)
    await page.mouse.up({ button: first === 'left' ? 'right' : 'left' })
    assert.equal(await resizeCount(), sent, '混按后两种松键顺序都不能提交尺寸')
    assert.equal((await pane.boundingBox())[dimension], before)
  }

  await heightHandle.focus()
  await page.keyboard.press('ArrowUp')
  await waitMessage({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: oldHeight + 52 })
  const start = await center(heightHandle)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x, start.y + 35)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal((await opened.boundingBox()).height, oldHeight + 52, 'Esc 回到拖动前且不提交')
  await widthHandle.dblclick()
  await waitMessage({ kind: 'workspaceFiles.resize', dimension: 'width', value: 280 })
  await heightHandle.dblclick()
  await waitMessage({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: null })
  assert.equal((await opened.boundingBox()).height, oldHeight)
  await page.setViewportSize({ width: 760, height: 360 })
  await layout(720, 480)
  assert.equal((await left.boundingBox()).width, 356, '两栏同开时，拖宽不能挤走正文和右栏')
  assert.ok((await main.boundingBox()).width >= 224)
  assert.ok((await treeScroller.boundingBox()).height >= 96, '较矮窗口为文件树留出位置')
  await page.setViewportSize({ width: 360, height: 380 })
  assert.equal((await left.boundingBox()).width, 306, '窄窗覆盖层的宽度上限随视口调整')
  await page.setViewportSize({ width: 1440, height: 780 })
  assert.equal((await left.boundingBox()).width, 720, '窗口变大后恢复实际记忆的宽度')
  await layout()
  await state(true, entries, [])
  assert.equal(await heightHandle.isVisible(), false, '没有已打开文件时，不留不能调整的分隔条')
  console.log('[PASS] 两个分隔条命中、拖动、键盘、取消和恢复默认；列表各自滚动')

  const foreign = { ...entries[0], id: 'foreign', name: '另一个文件系统', move: { scope: 'file://another-server', directory: 'remote-root' } }
  const nestedRoot = { ...entries[0], id: 'nested-root', name: '资料（另一工作区根）', move: folderMove }
  await state(true, [entries[0], { ...folder, expanded: true }, child, file, foreign, nestedRoot])
  const rootRow = tree.getByRole('button', { name: '笔记工作区', exact: true })
  const foreignRow = tree.getByRole('button', { name: foreign.name, exact: true })
  const nestedRootRow = tree.getByRole('button', { name: nestedRoot.name, exact: true })
  const childRow = tree.getByRole('button', { name: child.name, exact: true })
  const moveRequests = () => page.evaluate(() => window.messages.filter(m => m.kind === 'workspaceFiles.move'))
  const drag = async (source, destination) => {
    const from = await center(source), to = await center(destination)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 12, from.y, { steps: 4 })
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.move(to.x + 1, to.y)
  }
  await drag(current, dir)
  await dir.evaluate(el => el.scrollIntoView({ block: 'nearest' }))
  await page.waitForFunction(() => {
    const target = document.querySelector('.vsidian-file-tree .vsidian-file-entry.vsidian-file-drop-target')
    return target && getComputedStyle(target).backgroundColor === 'rgb(49, 73, 99)'
  }, undefined, { timeout: 2000 })
  assert.equal(await dir.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(49, 73, 99)')
  await page.screenshot({ path: path.join(path.dirname(output), 'files-drag-move.png'),
    clip: { x: 0, y: 0, width: 860, height: 410 } })
  await page.mouse.up()
  await waitMessage({ kind: 'workspaceFiles.move', id: file.id, directoryId: folder.id })
  assert.equal(await tree.locator('.vsidian-file-drop-target').count(), 0)
  await drag(childRow, rootRow)
  await page.mouse.up()
  await waitMessage({ kind: 'workspaceFiles.move', id: child.id, directoryId: entries[0].id })
  for (const dest of [current, dir, foreignRow, nestedRootRow]) {
    await drag(childRow, dest)
    assert.equal(await tree.locator('.vsidian-file-drop-target').count(), 0)
    await page.mouse.up()
  }
  await drag(current, dir)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const outsideDrag = await page.evaluateHandle(() => new DataTransfer())
  await dir.dispatchEvent('dragover', { dataTransfer: outsideDrag })
  await dir.dispatchEvent('drop', { dataTransfer: outsideDrag })
  assert.equal((await moveRequests()).length, 2, '不移动到原目录、文件，或响应外部拖放与取消手势')
  assert.equal(await tree.locator('.vsidian-file-drop-target').count(), 0)
  console.log('[PASS] 鼠标拖文件到子目录或根；落点着色，取消和无效目标不提交')

  await state(true, entries, [tabs[0], { ...tabs[1], isPreview: true }])
  const previewTab = opened.getByRole('button', { name: /^草稿\.md/ })
  const closeTab = opened.getByRole('button', { name: '关闭草稿.md', exact: true })
  await page.mouse.move(650, 55)
  assert.equal(await previewTab.locator('.vsidian-file-name').evaluate(el => getComputedStyle(el).fontStyle), 'italic')
  assert.equal(await opened.getByText('随记.md').evaluate(el => getComputedStyle(el).fontStyle), 'normal')
  assert.equal(await closeTab.evaluate(el => getComputedStyle(el).opacity), '0')
  await previewTab.hover()
  assert.equal(await closeTab.evaluate(el => {
    const r = el.getBoundingClientRect(), row = el.parentElement.getBoundingClientRect()
    return getComputedStyle(el).opacity === '1' && row.right - r.right <= 2 &&
      el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }), true, '只在悬停行展示可命中的右对齐关闭按钮')
  await page.screenshot({ path: path.join(path.dirname(output), 'files-open-editors.png'),
    clip: { x: 0, y: 0, width: 720, height: 260 } })
  const beforeClose = await page.evaluate(() => window.messages.length)
  await previewTab.click({ button: 'middle' })
  await waitMessage({ kind: 'workspaceFiles.closeTab', id: 'tab-other' })
  await closeTab.click()
  assert.deepEqual(await page.evaluate(start => window.messages.slice(start).filter(m => m.kind.startsWith('workspaceFiles.')), beforeClose), [
    { kind: 'workspaceFiles.closeTab', id: 'tab-other' }, { kind: 'workspaceFiles.closeTab', id: 'tab-other' },
  ])
  await previewTab.dblclick({ delay: 70 })
  await waitMessage({ kind: 'workspaceFiles.activate', id: 'tab-other', mode: 'keep' })
  await state(true, [entries[0], { ...folder, expanded: true }, child, file])
  const beforeCurrent = await page.evaluate(() => window.messages.length)
  await current.dblclick()
  assert.deepEqual(await page.evaluate(start => window.messages.slice(start).filter(m => m.kind === 'workspaceFiles.activate'), beforeCurrent), [
    { kind: 'workspaceFiles.activate', id: file.id, mode: 'keep' },
  ], '当前文件首击不走查盘，避免忙碌守卫吞掉紧随其后的保留')
  const beforeDoubleClick = await page.evaluate(() => window.messages.length)
  const doubleAt = await center(childRow)
  await page.mouse.click(doubleAt.x, doubleAt.y)
  await page.waitForTimeout(425) // 本机系统识别的双击间隔；此时临时打开会让原行随 webview 换出。
  assert.equal(await page.evaluate(start => window.messages.slice(start).filter(m => m.kind === 'workspaceFiles.activate').length, beforeDoubleClick), 0)
  await page.mouse.down({ clickCount: 2 })
  await page.mouse.up({ clickCount: 2 })
  await waitMessage({ kind: 'workspaceFiles.activate', id: child.id, mode: 'keep' })
  await dir.click()
  assert.deepEqual(await page.evaluate(start => window.messages.slice(start).filter(m => m.kind === 'workspaceFiles.activate'), beforeDoubleClick), [
    { kind: 'workspaceFiles.activate', id: child.id, mode: 'keep' },
    { kind: 'workspaceFiles.activate', id: folder.id },
  ], '双击只发一次保留请求，不先打开临时标签再切面板')
  console.log('[PASS] 临时标签斜体、右对齐关闭按钮、中键关闭和双击保留')
} finally {
  await browser.close()
}
