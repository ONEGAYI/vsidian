// T05（#544）附加组件只读引用浮窗——真宿主生产路径用例。
//
// 与浏览器回归（test/browser/addonRefViews.mjs——真实指针/键盘与绘制层）
// 分工：本组走真宿主链路——夹具组件 vsidian-test-fixture.addon-refviews 经
// 公开 registerAddon 注册编辑器页，页面产物（构建桥 refViewsEditor.ts）经
// SDK refViews 面请求只读引用浮窗；断言面：
// - 夹具通道结局（request/close 的 ok 与真实拒绝原因码）；
// - view.state 的 hoverPreview 探针（开态/内容态/块数/错误分态）与
//   paint.hoverPopup 绘制层（elementFromPoint 命中 + computed 背景/边框
//   ——hover-popup 历史样式命中证据，样式注入失效时任一失守）；
// - 宿主 _test.hoverWatchStats（租约回收：订阅计数随浮窗开闭回落）；
// - 目标更新/失效沿既有 hover.invalidated 通道；
// - 组件停用与页面关闭的整组回收。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ADDON_ID = 'vsidian-test-fixture.addon-refviews'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时：${label}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
}

interface FixtureStats {
  setupCount: number
  enableCount: number
}

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

/** 确保组件注册并 enabled（T11 ensureEnabled 同款口径） */
async function ensureEnabled(): Promise<void> {
  await poll('夹具组件激活', async () => {
    const stats = await fixtureStats()
    return stats && stats.setupCount >= 1 ? stats : undefined
  })
  for (let attempt = 0; attempt < 3; attempt++) {
    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | { runState: string } | null
    if (status?.runState === 'enabled') {
      return
    }
    if (status?.runState === 'faulted') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId: ADDON_ID })
      await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    } else {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    }
    await poll('运行态收敛 enabled', async () => {
      const next = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return next?.runState === 'enabled' ? next : undefined
    })
  }
  throw new Error('运行态未能恢复 enabled')
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await new Promise((r) => setTimeout(r, 300))
}

/** 写盘面（自动建父目录）并等待 watcher 生效 */
async function writeDoc(name: string, content: string): Promise<void> {
  const uri = wsUri(name)
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'))
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'))
  await poll(`盘面写入生效（${name}）`, async () => {
    const doc = await vscode.workspace.openTextDocument(uri)
    return doc.getText() === content ? doc : undefined
  })
}

async function openDoc(name: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(name), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(name).toString())) as
      | { found: boolean; panels: { ready: boolean }[] }
    return state.found && state.panels.some((panel) => panel.ready) ? state : undefined
  })
  await runOp('openPanel')
}

/** 夹具指令（queue + collect 单条配对） */
async function runOp<T>(op: string, args?: Record<string, unknown>): Promise<T | undefined> {
  await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
  await vscode.commands.executeCommand(`${ADDON_ID}.queue`, op, args)
  const results = (await vscode.commands.executeCommand(`${ADDON_ID}.collect`, 15000)) as Array<{ seq: number; outcome: T }>
  return results[0]?.outcome
}

/** view.state 探针（hoverPreview + paint.hoverPopup） */
async function viewProbe(file: string): Promise<{
  hoverPreview?: { open: boolean; state: string; blocks: number; note: string; scope: string; internalMode: string; liveBound: boolean; viewStats?: { totalBlocks: number } | null }
  paint?: { hoverPopup?: { hit: boolean; background: string | null; borderWidth: string | null; errorState: boolean } }
} | undefined> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(file).toString(), 0)) as never
}

async function hoverWatchStats(): Promise<{ targets: number; subscriptions: number }> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.hoverWatchStats')) as { targets: number; subscriptions: number }
}

/** 打开浮窗并等待内容装载（绘制层就绪） */
async function openPopupAndWait(file: string, args: Record<string, unknown>): Promise<void> {
  const outcome = await runOp<{ ok: boolean; reason?: string }>('request', args)
  assert(outcome !== undefined && outcome.ok === true, `请求应成功（${JSON.stringify(outcome)}）`)
  await poll('浮窗内容装载（绘制层）', async () => {
    const probe = await viewProbe(file)
    if (!probe?.hoverPreview?.open || probe.hoverPreview.state !== 'content') {
      return undefined
    }
    return probe.paint?.hoverPopup?.hit === true ? probe : undefined
  })
}

export const addonRefViewsCases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T05：引用浮窗请求绘制层证据与真实错误分态（#544）', async () => {
    await ensureEnabled()
    await writeDoc('rv-target.md', '# 目标文档标题\n\n目标第一段。\n\n目标第二段。\n')
    await writeDoc('rv-host.md', '正文一段。\n')
    await closeAllEditors()
    await openDoc('rv-host.md')

    // 正向：请求成功 → 浮窗内容态 + 绘制层命中 + 历史样式（背景/边框）
    await openPopupAndWait('rv-host.md', { id: 'r1', path: 'rv-target.md' })
    const probe = (await viewProbe('rv-host.md'))!
    assert(probe.hoverPreview!.state === 'content', `浮窗应为内容态（实际 ${probe.hoverPreview!.state}）`)
    assert(probe.hoverPreview!.blocks >= 3, `浮窗应渲染目标块（实际 ${probe.hoverPreview!.blocks}）`)
    assert(probe.hoverPreview!.note.includes('rv-target.md'), `标题应为目标显示名（实际 ${probe.hoverPreview!.note}）`)
    assert(probe.hoverPreview!.internalMode === 'reading' && !probe.hoverPreview!.liveBound,
      'API 浮窗在 Live 父视图中保持只读且没有目标写端口')
    const paint = probe.paint!.hoverPopup!
    assert(paint.hit, '绘制层命中（elementFromPoint 落浮窗内）')
    assert(paint.background !== null && paint.background !== 'rgba(0, 0, 0, 0)', `浮窗背景实底（实际 ${paint.background}）`)
    assert(paint.borderWidth !== null && paint.borderWidth !== '0px', `浮窗边框在场（实际 ${paint.borderWidth}）`)
    assert(paint.errorState === false, '内容态无错误修饰')

    // 负向：目标缺失 → 真实错误原因 + 浮窗就地错误分态（不折叠为通用失败）
    const missing = await runOp<{ ok: boolean; reason: string }>('request', { id: 'r2', path: 'rv-missing.md' })
    assert(missing !== undefined && missing.ok === false && missing.reason === 'not-found',
      `目标缺失应回 not-found（实际 ${JSON.stringify(missing)}）`)
    await poll('错误分态绘制', async () => {
      const p = await viewProbe('rv-host.md')
      return p?.paint?.hoverPopup?.errorState === true ? p : undefined
    })
    await runOp('close', { id: 'r2' })
    await closeAllEditors()
    console.log('[#544] 引用浮窗绘制层证据与真实错误分态通过')
  }],

  ['附加组件 T05：来源 B 解析语境与锚点语义（R-U02/R-U03，#544）', async () => {
    await ensureEnabled()
    // 目录矩阵：sub/ 下有 b.md 与 c.md；根下有同名 c.md 干扰项——误用父
    // 文档 A 目录时 note 为 'rv-c.md'，正确按 B 目录解析为 'sub/rv-c.md'
    await writeDoc('sub/rv-b.md', '# B 文档\n\nB 正文一段。\n')
    await writeDoc('sub/rv-c.md', '# C（B 目录）\n\nsub 目录下的目标。\n')
    await writeDoc('rv-c.md', '# C（根目录）\n\n根目录下的干扰项。\n')
    await writeDoc('sub/rv-anchor.md', '# 有锚点的目标\n\n正文。\n\n## 第二章\n\n第二章内容。\n')
    await writeDoc('sub/rv-code.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
    await writeDoc('rv-embed-host.md', '嵌入开场\n\n![[sub/rv-b.md]]\n\n结尾正文。\n')
    await closeAllEditors()
    await openDoc('rv-embed-host.md')
    // 嵌入内容装载后注册 embed 视图（targetFsPath = sub/rv-b.md）
    const embed = await poll('embed 实例注册', async () => {
      const views = await runOp<Array<{ instanceId: string; viewType: string }>>('views')
      return views?.find((v) => v.viewType === 'embed')
    })
    assert(embed !== undefined, '嵌入应注册 embed 视图实例')

    // R-U02：embed B 内请求 → 相对路径按 B 目录解析
    await openPopupAndWait('rv-embed-host.md', { id: 'r1', source: embed.instanceId, path: 'rv-c.md' })
    const probe = (await viewProbe('rv-embed-host.md'))!
    assert(probe.hoverPreview!.note.replace(/\\/g, '/').endsWith('sub/rv-c.md'),
      `来源 B 的相对路径应按 B 目录解析（实际 ${probe.hoverPreview!.note}）`)
    const beforeBlocks = probe.hoverPreview!.viewStats?.totalBlocks ?? probe.hoverPreview!.blocks
    await writeDoc('sub/rv-c.md', '# C 更新\n\nB 目录内容。\n\n## 新小节\n\n新段落。\n')
    await poll('来源 B 的刷新仍使用 B 目录', async () => {
      const p = await viewProbe('rv-embed-host.md')
      return p?.hoverPreview?.state === 'content' && p.hoverPreview.note.replace(/\\/g, '/').endsWith('sub/rv-c.md') &&
        (p.hoverPreview.viewStats?.totalBlocks ?? 0) > beforeBlocks ? p : undefined
    })
    await runOp('close', { id: 'r1' })

    // R-U03：合法标题锚点定位 + 非法锚点真实失败（anchor-missing）
    await openPopupAndWait('rv-embed-host.md', { id: 'r2', source: embed.instanceId, path: 'rv-anchor.md', anchor: { kind: 'heading', heading: '第二章' } })
    const anchored = (await viewProbe('rv-embed-host.md'))!
    assert(anchored.hoverPreview!.scope === 'heading', `标题锚点应按章节选择器装载（实际 ${anchored.hoverPreview!.scope}）`)
    await runOp('close', { id: 'r2' })
    const badAnchor = await runOp<{ ok: boolean; reason: string }>('request', { id: 'r3', source: embed.instanceId, path: 'rv-anchor.md', anchor: { kind: 'heading', heading: '不存在的章节' } })
    assert(badAnchor !== undefined && badAnchor.ok === false && badAnchor.reason === 'anchor-missing',
      `非法锚点应回 anchor-missing（实际 ${JSON.stringify(badAnchor)}）`)
    await runOp('close', { id: 'r3' })

    await openPopupAndWait('rv-embed-host.md', { id: 'text', source: embed.instanceId, path: 'rv-code.ts', anchor: { kind: 'line', line: 3 } })
    const badLine = await runOp<{ ok: boolean; reason: string }>('request', { id: 'line-error', source: embed.instanceId, path: 'rv-code.ts', anchor: { kind: 'line', line: 999 } })
    assert(badLine?.ok === false && badLine.reason === 'anchor-invalid', `初次超界行号应沿既有规则拒绝（${JSON.stringify(badLine)}）`)

    // 无效来源：不存在的实例 → view-disposed（普通拒绝，不建浮窗）
    const badSource = await runOp<{ ok: boolean; reason: string }>('request', { id: 'r4', source: 'embed:gone', path: 'rv-c.md' })
    assert(badSource !== undefined && badSource.ok === false && badSource.reason === 'view-disposed',
      `无效来源应回 view-disposed（实际 ${JSON.stringify(badSource)}）`)
    await closeAllEditors()
    console.log('[#544] 来源 B 解析语境与锚点语义通过')
  }],

  ['附加组件 T05：目标更新刷新与失效分态（沿既有失效通道，#544）', async () => {
    await ensureEnabled()
    const v1 = ['# 目标 v1', '', 'v1 正文段落。', ''].join('\n')
    // v2 用异构块结构（标题/段落/列表/二级标题）——块模型数必然增长
    const v2 = ['# 目标 v2', '', 'v2 正文段落。', '', '- 列表一', '- 列表二', '- 列表三', '', '## 小节', '', '小节正文。', ''].join('\n')
    await writeDoc('rv-watch.md', v1)
    await writeDoc('rv-watch-host.md', '正文一段。\n')
    await closeAllEditors()
    await openDoc('rv-watch-host.md')
    // API 浮窗恒只读，Live 父视图也沿 invalidated 直接刷新内容。
    await openPopupAndWait('rv-watch-host.md', { id: 'r1', path: 'rv-watch.md' })
    const before = (await viewProbe('rv-watch-host.md'))!
    const totalBefore = before.hoverPreview!.viewStats?.totalBlocks ?? before.hoverPreview!.blocks
    assert(totalBefore >= 2, `v1 块模型数（实际 ${totalBefore}）`)

    // 外部修改 → hover.invalidated changed → 同实例重载（块模型数增长——
    // DOM 挂载受视口钳制，用与 DOM 无关的块模型计数观测刷新）
    await writeDoc('rv-watch.md', v2)
    await poll('目标更新刷新', async () => {
      const p = await viewProbe('rv-watch-host.md')
      const total = p?.hoverPreview?.viewStats?.totalBlocks ?? 0
      return p?.hoverPreview?.open === true && total > totalBefore ? p : undefined
    })

    // 删除 → deleted → 撤下内容显示缺失态（不无限保留旧内容）
    await vscode.workspace.fs.delete(wsUri('rv-watch.md'))
    await poll('目标失效分态', async () => {
      const p = await viewProbe('rv-watch-host.md')
      return p?.hoverPreview?.state === 'error' ? p : undefined
    })
    await runOp('close', { id: 'r1' })
    await closeAllEditors()
    console.log('[#544] 目标更新刷新与失效分态通过')
  }],

  ['附加组件 T05：句柄关闭、页面关闭与租约回收、组件停用（R-U05/R-U07，#544）', async () => {
    await ensureEnabled()
    await writeDoc('rv-lease.md', '# 租约目标\n\n正文。\n')
    await writeDoc('rv-lease-host.md', '正文一段。\n')
    await closeAllEditors()
    await openDoc('rv-lease-host.md')

    // 浮窗打开 → 宿主 watch 订阅 +1
    const base = await hoverWatchStats()
    await openPopupAndWait('rv-lease-host.md', { id: 'r1', path: 'rv-lease.md' })
    const watching = await hoverWatchStats()
    assert(watching.subscriptions > base.subscriptions, `浮窗打开应登记目标订阅（${base.subscriptions} → ${watching.subscriptions}）`)

    // 句柄关闭 → 浮窗离场 + 订阅回落（租约回收）
    const closed = await runOp<boolean>('close', { id: 'r1' })
    assert(closed === true, '本请求句柄应能关闭浮窗')
    await poll('浮窗关闭', async () => {
      const p = await viewProbe('rv-lease-host.md')
      return p?.hoverPreview?.open === false ? p : undefined
    })
    await poll('订阅回落（句柄关闭回收租约）', async () => {
      const stats = await hoverWatchStats()
      return stats.subscriptions <= base.subscriptions ? stats : undefined
    })

    // 再次打开 → 页面关闭（closeAllEditors）→ 整组释放（面板销毁通道）
    await openPopupAndWait('rv-lease-host.md', { id: 'r2', path: 'rv-lease.md' })
    await closeAllEditors()
    await poll('页面关闭后订阅整组回落', async () => {
      const stats = await hoverWatchStats()
      return stats.subscriptions <= base.subscriptions ? stats : undefined
    })
    const sessionState = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri('rv-lease-host.md').toString())) as
      | { found: boolean }
    assert(sessionState.found === false, '面板关闭后会话应已释放')

    // 组件停用：浮窗在场时停用 → 浮窗关闭（装载器 releaseAddon 整组件回收）
    await openDoc('rv-lease-host.md')
    await openPopupAndWait('rv-lease-host.md', { id: 'r3', path: 'rv-lease.md' })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('组件停用后浮窗回收', async () => {
      const p = await viewProbe('rv-lease-host.md')
      return p?.hoverPreview?.open === false ? p : undefined
    })
    await poll('停用后订阅回落', async () => {
      const stats = await hoverWatchStats()
      return stats.subscriptions <= base.subscriptions ? stats : undefined
    })
    // 恢复启用（后续用例不毒化）
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await poll('组件恢复 enabled', async () => {
      const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
        | { runState: string } | null
      return status?.runState === 'enabled' ? status : undefined
    })
    await runOp('request', { id: 'error', path: 'rv-no-such-target.md' })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: false })
    await poll('停用回收错误浮窗', async () => {
      const p = await viewProbe('rv-lease-host.md')
      return p?.hoverPreview?.open === false ? p : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    await closeAllEditors()
    console.log('[#544] 句柄关闭、页面关闭与租约回收、组件停用通过')
  }],
]
