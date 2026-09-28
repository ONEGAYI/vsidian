// 跳转目标高亮原生浏览器回归夹具（#163 验收反馈）：装配生产 webview
// 控制器，view.locate 通道驱动高亮，断言绘制层背景（computed background
// 非透明——样式注入失效时 DOM 在场但背景透明）。与 blockMenuFixture
// 同装配模式。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// #94：harness 页面注入语言数据岛，boot 与生产首帧同路径
bootLocaleFromDocument()

const controller = new WebviewSyncController({
  postMessage(msg: unknown) {
    sent.push(msg as { kind: string })
  },
  getState() {
    return undefined
  },
  setState() {},
})
const sent: Array<{ kind: string; [k: string]: unknown }> = []
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** 高亮绘制观测：live 高亮行的 computed background 与 reading 高亮块的
 *  背景（断言用户看到的东西——半透黄真实绘制） */
function readAnchorFlash() {
  const lines = Array.from(document.querySelectorAll<HTMLElement>(
    '.cm-line.vsidian-anchor-flash'))
  const blocks = Array.from(document.querySelectorAll<HTMLElement>(
    '.vsidian-view-reading .vsidian-anchor-flash'))
  return {
    liveCount: lines.length,
    liveTexts: lines.map((el) => el.textContent ?? ''),
    liveBackground: lines[0] ? getComputedStyle(lines[0]).backgroundColor : null,
    readingCount: blocks.length,
    readingTexts: blocks.map((el) => (el.textContent ?? '').slice(0, 24)),
    readingBackground: blocks[0] ? getComputedStyle(blocks[0]).backgroundColor : null,
    text: controller.getView()!.state.doc.toString(),
  }
}

Object.assign(window, {
  initAnchorFlash(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'anchor-flash', docUri: 'file:///d%3A/notes/flash.md',
      version: 1, text,
    })
  },
  controller,
  readAnchorFlash,
  post(msg: Record<string, unknown>) {
    controller.handleHostMessage(msg)
  },
  sent: () => sent,
})
