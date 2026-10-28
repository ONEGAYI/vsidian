import * as vscode from 'vscode'

/** 旧宿主的 custom diff 在 Tab API 中是不透明 input，但会把左右角色透传到
 *  panel.options.customClasses（1.86.2：CustomEditorService.createDiffEditorInput
 *  → OverlayWebview.options → ExtHostWebviewPanel.options）。仅消费这两个
 *  确切标记，不按标签文字、文件名、resolve 顺序或焦点猜测左右资源。 */
export function createNativeDiffFallback(context: vscode.ExtensionContext): (
  document: vscode.TextDocument, panel: vscode.WebviewPanel,
) => boolean {
  type PanelEntry = { document: vscode.TextDocument; side: 'original' | 'modified'; initialized: boolean }
  const panels = new Map<vscode.WebviewPanel, PanelEntry>()
  const reopening = new Set<vscode.Tab>()
  const retained = new Map<vscode.Tab, readonly vscode.TextDocument[]>()

  const check = (): void => {
    for (const group of vscode.window.tabGroups.all) {
      const tab = group.activeTab
      if (!tab || reopening.has(tab) || tab.input instanceof vscode.TabInputTextDiff ||
        tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) {
        continue
      }
      const visible = [...panels].filter(([panel, entry]) =>
        entry.initialized && panel.visible && panel.viewColumn === group.viewColumn)
      // SCM 单击通常保留侧栏焦点，两侧面板均不 active；角色与可见性
      // 足以识别对比，不能把编辑器取得焦点作为转交前提。
      if (visible.length !== 2) continue
      const original = visible.find(([, entry]) => entry.side === 'original')?.[1].document
      const modified = visible.find(([, entry]) => entry.side === 'modified')?.[1].document
      if (!original || !modified) continue
      reopening.add(tab)
      void (async () => {
        await vscode.commands.executeCommand('vscode.diff', original.uri, modified.uri, tab.label, {
          override: true,
          viewColumn: group.viewColumn,
          preview: tab.isPreview,
          preserveFocus: !visible.some(([panel]) => panel.active),
        })
        // 1.86.2 关闭 dirty custom input 会 revert 文档。先展示文本 diff，
        // 脏文档的旧标签留到保存后再清理，沿用三态切换的内容保护边界。
        // preview 对比可能已被原生 preview 自动替换，无需再次关闭。
        if (!vscode.window.tabGroups.all.some((candidate) => candidate.tabs.includes(tab))) return
        if (original.isDirty || modified.isDirty) {
          retained.set(tab, [original, modified])
        } else {
          await vscode.window.tabGroups.close(tab, true)
        }
      })().catch((error: unknown) => console.error('[Vsidian native diff fallback]', error))
    }
  }

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.closed) {
        reopening.delete(tab)
        retained.delete(tab)
      }
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      for (const [tab, documents] of retained) {
        if (documents.some((document) => document.isDirty)) continue
        retained.delete(tab)
        void Promise.resolve(vscode.window.tabGroups.close(tab, true))
          .catch((error: unknown) => console.error('[Vsidian native diff cleanup]', error))
      }
    }),
  )

  return (document, panel): boolean => {
    const side = (panel.options as vscode.WebviewPanelOptions & { customClasses?: unknown }).customClasses
    if (side !== 'original' && side !== 'modified') return false
    const entry: PanelEntry = { document, side, initialized: false }
    panels.set(panel, entry)
    // 首份正文状态在 webview 初始化后回报，表明原打开管线已落地。
    // 比焦点事件更合适：既覆盖 SCM 保留焦点，也避免过早转交后原管线
    // 重新激活仍需保留的 dirty custom diff。
    const message = panel.webview.onDidReceiveMessage((value: { kind?: unknown } | null) => {
      if (value?.kind === 'view.state' && !entry.initialized) {
        entry.initialized = true
        queueMicrotask(check)
      }
    })
    // 一批视图状态逐面板送达；整批应用后再匹配，避免切页中间态串左右。
    const change = panel.onDidChangeViewState(() => queueMicrotask(check))
    const close = panel.onDidDispose(() => {
      panels.delete(panel)
      message.dispose()
      change.dispose()
      close.dispose()
    })
    queueMicrotask(check)
    return true
  }
}
