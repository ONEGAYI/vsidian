// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { WebviewSyncController } from '../../src/webview/syncController'

describe('可绑定的大纲/侧栏操作', () => {
  it('命令入口与可见按钮共享状态，搜索会打开大纲并聚焦输入', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const controller = new WebviewSyncController({ postMessage() {}, getState() {}, setState() {} })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'ui-keys',
      docUri: 'file:///outline.md', version: 1, text: '# 标题\n\n## 子标题\n' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineSearch' })
    expect(root.querySelector('.vsidian-body')?.classList.contains('vsidian-sidebar-open')).toBe(true)
    expect(root.querySelector('.vsidian-sidebar')?.classList.contains('vsidian-outline-active')).toBe(true)
    expect(document.activeElement).toBe(root.querySelector('.vsidian-outline-search'))
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineCollapseAll' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineExpandAll' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'outlineReset' })
    controller.dispose()
    root.remove()
  })
})

describe('#208 刷新嵌入资源（refreshEditor）命令入口', () => {
  it('ui.command op=refreshEditor 与工具栏按钮汇合：同款出站、同一 reqId 序列续接', () => {
    const sent: unknown[] = []
    const root = document.createElement('div')
    document.body.append(root)
    const controller = new WebviewSyncController({
      postMessage: (m) => sent.push(m),
      getState: () => undefined,
      setState: () => undefined,
    })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'ui-refresh',
      docUri: 'file:///refresh.md', version: 1, text: '# 标题\n' })
    // 快捷键链路：keybindings.execute 出站 → 宿主 executeCommand →
    // UI_OPERATIONS 注册的命令回发 ui.command → webview 与按钮共用同一
    // 发送实现（宿主编排在 documentSession 的 refresh.request 处理唯一）
    controller.handleHostMessage({ kind: 'ui.command', op: 'refreshEditor' })
    expect(sent.filter((m) => (m as { kind?: string }).kind === 'refresh.request'))
      .toEqual([{ kind: 'refresh.request', sessionId: 'ui-refresh',
        docUri: 'file:///refresh.md', reqId: 1 }])
    // 与按钮点击共用同一 reqId 序列（命令先触发 → 1，按钮点击 → 2，命令再触发 → 3）
    root.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!.click()
    controller.handleHostMessage({ kind: 'ui.command', op: 'refreshEditor' })
    const reqs = sent.filter((m): m is { kind: string; reqId: number } =>
      (m as { kind?: string }).kind === 'refresh.request')
    expect(reqs.map((m) => m.reqId)).toEqual([1, 2, 3])
    controller.dispose()
    root.remove()
  })
})
