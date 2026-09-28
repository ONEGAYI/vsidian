// 正文右键菜单（复制块链接）原生浏览器回归（#162）：装配生产 webview 控制器，
// 真实右键、真实键盘（Ctrl+Shift+C）与真实布局验证——jsdom 无布局测不了的
// 菜单浮层 fixed 定位（点击点起位、视口 clamp、真实绘制尺寸）与快捷键
// 出站链路在此落地。与 outlineMenuFixture 同装配模式。
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

/** 菜单观测（断言用户看到的东西：浮层几何与绘制、命令集、文本对拍）。
 *  返回值经 Playwright evaluate 跨边界序列化——只含标量与可克隆结构 */
function readMenu() {
  const menu = document.querySelector<HTMLElement>('.vsidian-block-menu')
  const style = menu ? getComputedStyle(menu) : null
  return {
    menuExists: !!menu,
    menuRect: menu ? menu.getBoundingClientRect() : null,
    /** 绘制层证据：背景非透明 + 边框存在（样式注入失效时仍可测出 DOM） */
    menuBackground: style ? style.backgroundColor : null,
    menuBorderWidth: style ? style.borderWidth : null,
    menuPosition: style ? style.position : null,
    commands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button[data-vsidian-command]'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    itemTexts: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).map((b) => b.textContent ?? '')
      : [],
    /** 视图当前文本（写回对拍）与光标 */
    text: controller.getView()!.state.doc.toString(),
    cursor: controller.getView()!.state.selection.main.head,
  }
}

/** 块 id 标记淡化绘制观测（#163 验收反馈）：双形态标记 span 的 computed
 *  color 与 display（样式注入失效时 DOM 在场但 color 不淡化——断言用户
 *  看到的对比度差异） */
function readBlockIdPaint() {
  return Array.from(document.querySelectorAll<HTMLElement>('.vsidian-block-id')).map((el) => ({
    text: el.textContent ?? '',
    color: getComputedStyle(el).color,
    display: getComputedStyle(el).display,
  }))
}

Object.assign(window, {
  initBlockMenu(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'block-menu', docUri: 'file:///d%3A/notes/block.md',
      version: 1, text,
    })
  },
  controller,
  readMenu,
  readBlockIdPaint,
  /** 宿主消息通道（测试钩子与真实点击同一处理器） */
  post(msg: Record<string, unknown>) {
    controller.handleHostMessage(msg)
  },
  /** 出站消息观测（剪贴板桥与 keybindings.execute） */
  sent: () => sent,
  /** 清空出站消息缓冲 */
  clearSent() {
    sent.length = 0
  },
  /** 光标落位（blockLink.copy 命令的目标推导输入） */
  setCursor(pos: number) {
    controller.getView()!.dispatch({ selection: { anchor: pos, head: pos } })
  },
  /** 阅读容器文本（阅读隐藏断言：块 id 标记不进阅读渲染） */
  readingText() {
    const container = document.querySelector('.vsidian-view-reading')
    return container ? container.textContent ?? '' : ''
  },
})
