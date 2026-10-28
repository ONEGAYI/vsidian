// Callout 源文转换操作（#656/T05）的原生浏览器回归 fixture：生产控制器 +
// 产物 CSS，真实右键/键盘/命令三入口驱动三级类型菜单与键位操作，断言
// 规划器精确原文、单笔 edit.request（一步撤销的出站面）、选区落点与
// 自定义输入的宿主往返（request 出站 / result 回流的取消与写入两态）。
// 与 contextMenuFixture 同装配模式（edit.ack 即回的健康宿主模拟）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
const sent: Array<{ kind: string; [k: string]: unknown }> = []

const controller = new WebviewSyncController({
  postMessage(msg: unknown) {
    const message = msg as { kind: string; [k: string]: unknown }
    sent.push(message)
    if (message.kind === 'edit.request') {
      const req = message as unknown as { seq: number; baseVersion: number }
      setTimeout(() => {
        controller.handleHostMessage({
          kind: 'edit.ack', seq: req.seq, ok: true, version: req.baseVersion + 1,
        })
      }, 10)
    }
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** 菜单与文档观测（Playwright evaluate 跨边界：只含可克隆结构） */
function readMenu() {
  const menu = document.querySelector<HTMLElement>('.vsidian-context-menu')
  const view = controller.getView()
  const sel = view?.state.selection.main
  return {
    menuExists: !!menu,
    allCommands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    disabledCommands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button:disabled'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    checkedOf: (command: string) =>
      menu?.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${CSS.escape(command)}"]`)
        ?.getAttribute('aria-checked') ?? null,
    /** 三级子菜单（孙级）滚动可达面：maxHeight 与溢出量（低高度验收） */
    submenuOverflow: menu
      ? Array.from(menu.querySelectorAll<HTMLElement>('.vsidian-context-menu-submenu')).map((el) => ({
          display: getComputedStyle(el).display,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          maxHeight: getComputedStyle(el).maxHeight,
        }))
      : [],
    text: view ? view.state.doc.toString() : '',
    selection: sel ? { from: sel.from, to: sel.to } : null,
  }
}

Object.assign(window, {
  controller,
  readMenu,
  initCalloutPlan(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'callout-plan', docUri: 'file:///notes/callout-plan.md',
      version: 1, text,
    })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setSelection(anchor: number, head: number) {
    controller.getView()!.dispatch({ selection: { anchor, head } })
  },
  post(msg: Record<string, unknown>) {
    controller.handleHostMessage(msg)
  },
  sent: () => sent,
  clearSent() {
    sent.length = 0
  },
})
