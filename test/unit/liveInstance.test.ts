// @vitest-environment jsdom
// P2-02（#279）Live 实例上下文契约：主正文提炼出的最小可复用入口。
// - 两个实例并存：选区、滚动、编辑派发目标与释放互不影响；销毁一个
//   不释放另一份编辑器（票据验收第 2 条）。
// - 实例依赖经构造注入（出站 / 持久化时机 / 资源来源 / 模式门控），
//   不默认读取 this.view 或唯一全局编辑器/桥状态（验收第 4 条的失败
//   契约：改造前不存在该入口，本文件导入即红）。
// - 主正文走新入口后：根面板只创建一套 chrome 与单份编辑器，一次输入
//   只派发一笔 edit.request（不重复注册监听/双重消费，验收第 3 条）。
import { afterEach, describe, expect, it } from 'vitest'
import { LiveEditorInstance, type LiveEditorInstanceDeps } from '../../src/webview/liveInstance'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { ImageResourceManager } from '../../src/webview/imageResource'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeDeps(sent: WebviewToHost[], persistCount: { n: number } = { n: 0 }): LiveEditorInstanceDeps {
  return {
    send: (message) => sent.push(message),
    persistState: () => {
      persistCount.n += 1
    },
    images: new ImageResourceManager({
      isDirectSrc: () => false,
      requestHost: () => {},
    }),
    isLiveActive: () => true,
    initialDark: false,
  }
}

/** 挂一个实例到独立容器并完成会话绑定 + 全文装载（init 等价路径） */
function mountInstance(
  sent: WebviewToHost[],
  sessionId: string,
  text: string,
  persistCount?: { n: number },
): { instance: LiveEditorInstance; host: HTMLElement } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const instance = new LiveEditorInstance(host, makeDeps(sent, persistCount))
  instance.setSession(sessionId, `file:///${sessionId}.md`)
  instance.handleFullSync(1, text, {})
  return { instance, host }
}

function editRequests(sent: readonly WebviewToHost[]) {
  return sent.filter((m) => m.kind === 'edit.request') as Extract<WebviewToHost, { kind: 'edit.request' }>[]
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Live 实例上下文：两实例并存互不影响（#279 验收 2）', () => {
  it('编辑意图只派发给所属实例的目标会话，另一实例文本不动', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const persistA = { n: 0 }
    const a = mountInstance(sentA, 'sess-a', 'alpha', persistA).instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    a.view!.dispatch({ changes: { from: 5, insert: 'X' } })

    const reqs = editRequests(sentA)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.sessionId).toBe('sess-a')
    expect(reqs[0]!.changes).toEqual([{ offset: 5, length: 0, text: 'X' }])
    expect(editRequests(sentB)).toHaveLength(0)
    expect(b.view!.state.doc.toString()).toBe('beta')
    // 实例不落全局桥状态：seq 推进经 deps.persistState 透出时机
    expect(persistA.n).toBeGreaterThan(0)
  })

  it('外部增量只应用到所属实例文档', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha').instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    b.handleDocChanged({ kind: 'doc.changed', version: 2, origin: 'external', changes: [{ offset: 4, length: 0, text: '!' }] })

    expect(b.view!.state.doc.toString()).toBe('beta!')
    expect(a.view!.state.doc.toString()).toBe('alpha')
    // 外部同步零回发：不因应用增量产生新的 edit.request
    expect(editRequests(sentA)).toHaveLength(0)
    expect(editRequests(sentB)).toHaveLength(0)
  })

  it('选区与滚动互不影响', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha').instance
    const b = mountInstance(sentB, 'sess-b', 'beta').instance

    a.view!.dispatch({ selection: { anchor: 3 } })
    a.view!.scrollDOM.scrollTop = 42

    expect(a.view!.state.selection.main.head).toBe(3)
    expect(b.view!.state.selection.main.head).toBe(0)
    expect(b.view!.scrollDOM.scrollTop).toBe(0)
  })

  it('销毁一个实例不释放另一份编辑器', () => {
    const sentA: WebviewToHost[] = []
    const sentB: WebviewToHost[] = []
    const a = mountInstance(sentA, 'sess-a', 'alpha')
    const b = mountInstance(sentB, 'sess-b', 'beta')

    a.instance.destroy()

    expect(a.host.querySelector('.cm-editor')).toBeNull()
    expect(b.host.querySelector('.cm-editor')).not.toBeNull()
    // 幸存实例的编辑链路完整：dispatch → 出站仍按其会话派发
    b.instance.view!.dispatch({ changes: { from: 4, insert: 'Y' } })
    const reqs = editRequests(sentB)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.sessionId).toBe('sess-b')
  })
})

describe('主正文走新入口：根 chrome 单份、输入不双重消费（#279 验收 1/3）', () => {
  it('控制器挂载后单套 chrome 与单份编辑器，一次输入只出一笔 edit.request', () => {
    const sent: WebviewToHost[] = []
    const bridge: VsCodeBridge = {
      postMessage: (m) => sent.push(m as WebviewToHost),
      getState: () => undefined,
      setState: () => {},
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const c = new WebviewSyncController(bridge)
    c.mount(host)
    c.handleHostMessage({
      kind: 'init', sessionId: 's1', docUri: 'file:///main.md', version: 1, text: '正文内容',
    })

    expect(document.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-body')).toHaveLength(1)
    expect(document.querySelectorAll('.vsidian-toolbar')).toHaveLength(1)

    const before = sent.length
    c.getView()!.dispatch({ changes: { from: 2, insert: '字' } })
    const reqs = editRequests(sent.slice(before))
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.changes).toEqual([{ offset: 2, length: 0, text: '字' }])
    c.dispose()
  })
})
