// 修饰键激活态类维护契约（#217 验收反馈：Ctrl+悬停链接的可发现性）：
// syncController 的 document 级 keydown/keyup 以 getModifierState 维护
// body.vsidian-mod-link（左右修饰键同按/交替精确），窗口 blur 强制回落
// （keyup 可能丢失），dispose 清理。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { LINK_MOD_CLASS } from '../../src/webview/liveLinks'
import type { WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/mod.md'

function mountController(): WebviewSyncController {
  const bridge: VsCodeBridge = {
    postMessage: (_m: WebviewToHost) => {},
    getState: () => undefined,
    setState: () => {},
  }
  const controller = new WebviewSyncController(bridge)
  const host = document.createElement('div')
  document.body.appendChild(host)
  controller.mount(host)
  controller.handleHostMessage({
    kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: '正文\n',
  })
  return controller
}

function dispatchKey(type: 'keydown' | 'keyup', init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent(type, { bubbles: true, ...init }))
}

afterEach(() => {
  document.body.classList.remove(LINK_MOD_CLASS)
  document.body.textContent = ''
})

describe('修饰键激活态类（body.vsidian-mod-link）', () => {
  it('Ctrl 按下挂类、抬起摘类', () => {
    const c = mountController()
    try {
      dispatchKey('keydown', { key: 'Control', ctrlKey: true })
      expect(document.body.classList.contains(LINK_MOD_CLASS), 'Ctrl 按下挂类').toBe(true)
      dispatchKey('keyup', { key: 'Control', ctrlKey: false })
      expect(document.body.classList.contains(LINK_MOD_CLASS), 'Ctrl 抬起摘类').toBe(false)
    } finally {
      c.dispose()
    }
  })

  it('Cmd（Meta）同样维护（macOS 方向）；非修饰键不触发', () => {
    const c = mountController()
    try {
      dispatchKey('keydown', { key: 'Meta', metaKey: true })
      expect(document.body.classList.contains(LINK_MOD_CLASS)).toBe(true)
      dispatchKey('keyup', { key: 'Meta' })
      expect(document.body.classList.contains(LINK_MOD_CLASS)).toBe(false)
      dispatchKey('keydown', { key: 'a' })
      expect(document.body.classList.contains(LINK_MOD_CLASS), '普通键不影响').toBe(false)
    } finally {
      c.dispose()
    }
  })

  it('左右 Ctrl 交替按住不闪烁（getModifierState 口径：单个 keyup 时另一侧仍按住则保持）', () => {
    const c = mountController()
    try {
      dispatchKey('keydown', { key: 'Control', ctrlKey: true, code: 'ControlLeft' })
      dispatchKey('keydown', { key: 'Control', ctrlKey: true, code: 'ControlRight' })
      dispatchKey('keyup', { key: 'Control', ctrlKey: true, code: 'ControlLeft' })
      expect(document.body.classList.contains(LINK_MOD_CLASS), '左侧抬起、右侧仍按住 → 保持').toBe(true)
      dispatchKey('keyup', { key: 'Control', ctrlKey: false, code: 'ControlRight' })
      expect(document.body.classList.contains(LINK_MOD_CLASS), '全部抬起 → 摘类').toBe(false)
    } finally {
      c.dispose()
    }
  })

  it('窗口 blur 强制回落（keyup 可能丢失）；dispose 清理', () => {
    const c = mountController()
    dispatchKey('keydown', { key: 'Control', ctrlKey: true })
    expect(document.body.classList.contains(LINK_MOD_CLASS)).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(document.body.classList.contains(LINK_MOD_CLASS), 'blur 回落').toBe(false)
    dispatchKey('keydown', { key: 'Control', ctrlKey: true })
    c.dispose()
    expect(document.body.classList.contains(LINK_MOD_CLASS), 'dispose 清理').toBe(false)
  })
})
