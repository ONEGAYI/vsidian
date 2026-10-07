import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// #94：harness 页面注入语言数据岛，boot 与生产首帧同路径（无岛取词回退键名）
bootLocaleFromDocument()
let saved: unknown
const sent: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    sent.push(message)
    // 生产宿主行为回环（commentToggleFixture 同口径）：快捷键出站
    // keybindings.execute → 宿主门控后回发 format.command 驱动同一实现；
    // fixture 无真实宿主，mock 为 format 类 id 直接回发（生产同驱动链）
    if ((message as { kind?: string }).kind === 'keybindings.execute') {
      const { id } = message as { id: string }
      queueMicrotask(() => {
        controller.handleHostMessage({ kind: 'format.command', op: id as never })
      })
    }
  },
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  controller,
  initQuick(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'quick', docUri: 'file:///quick.md', version: 1, text })
  },
  quickText() { return controller.getView()!.state.doc.toString() },
  quickSent() { return sent },
})
