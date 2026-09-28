// 统一右键菜单（#183）原生浏览器回归 fixture：装配生产 webview 控制器，
// 真实右键、真实键盘与真实布局验证——jsdom 无布局测不了的菜单浮层 fixed
// 定位（点击点起位、视口 clamp）、分组线绘制、子菜单展开/翻转几何、提示列
// 与图标位的 computed 证据、剪贴板桥往返。与 outlineMenuFixture 同装配模式。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// #94：harness 页面注入语言数据岛，boot 与生产首帧同路径
bootLocaleFromDocument()

const controller = new WebviewSyncController({
  postMessage(msg: unknown) {
    const message = msg as { kind: string; [k: string]: unknown }
    sent.push(message)
    // 模拟健康宿主：edit.request 即回 ack（长场景序列中未 ack 的面板会暂缓
    // 后续编辑出站——与单测短流程不同，浏览器回归按真实往返驱动）
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
const sent: Array<{ kind: string; [k: string]: unknown }> = []
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** 菜单观测（断言用户看到的东西：浮层几何与绘制、命令集、降级态、提示列、
 *  子菜单几何与翻转）。返回值经 Playwright evaluate 跨边界序列化——只含
 *  标量与可克隆结构，不得携带 DOM 元素 */
function readMenu() {
  const menu = document.querySelector<HTMLElement>('.vsidian-context-menu')
  const style = menu ? getComputedStyle(menu) : null
  const item = (command: string) =>
    menu?.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${command}"]`) ?? null
  return {
    menuExists: !!menu,
    menuRect: menu ? menu.getBoundingClientRect() : null,
    menuPosition: style ? style.position : null,
    menuBackground: style ? style.backgroundColor : null,
    separatorCount: menu ? menu.querySelectorAll('.vsidian-context-menu-separator').length : 0,
    /** 顶级命令序列（分组容器 → 项宿主 → button 稳定层级） */
    topCommands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>(
          '.vsidian-context-menu-group > .vsidian-context-menu-host > button'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    /** 全部按钮（含子菜单叶命令，DOM 序） */
    allCommands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    /** 顶级按钮文案（取词对拍） */
    topTexts: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>(
          '.vsidian-context-menu-group > .vsidian-context-menu-host > button'))
          .map((b) => {
            const label = b.querySelector('.vsidian-context-menu-label')
            return label ? label.textContent ?? '' : ''
          })
      : [],
    disabledCommands: menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button:disabled'))
          .map((b) => b.dataset['vsidianCommand'] ?? '')
      : [],
    /** 指定命令的提示列文本（无提示列为 null） */
    hintOf: (command: string) => {
      const hint = item(command)?.querySelector<HTMLElement>('.vsidian-context-menu-hint')
      return hint ? hint.textContent : null
    },
    /** 图标位的 computed mask-image（资产缺失时为透明渐变回退——留空证据） */
    iconMaskOf: (command: string) => {
      const icon = item(command)?.querySelector<HTMLElement>('.vsidian-context-menu-icon')
      return icon ? getComputedStyle(icon).maskImage : null
    },
    /** 徽标文本（H1 档） */
    badgeOf: (command: string) => {
      const badge = item(command)?.querySelector<HTMLElement>('.vsidian-context-menu-badge')
      return badge ? badge.textContent : null
    },
    /** 勾选态（aria-checked；未勾选 null）——段落设置按行结构点亮（#184） */
    checkedOf: (command: string) => item(command)?.getAttribute('aria-checked') ?? null,
    /** 子菜单态：display（hover/兜底展开）、flip 类、首个子菜单几何 */
    submenus: menu
      ? Array.from(menu.querySelectorAll<HTMLElement>('.vsidian-context-menu-submenu')).map((el) => ({
          display: getComputedStyle(el).display,
          flipped: el.classList.contains('vsidian-menu-flip'),
          rect: el.getBoundingClientRect(),
          parentExpanded:
            el.parentElement?.querySelector('button')?.getAttribute('aria-expanded') ?? null,
        }))
      : [],
    /** 视图当前文本与选区（写回与纯选区事务对拍） */
    text: controller.getView()!.state.doc.toString(),
    selection: (() => {
      const sel = controller.getView()!.state.selection.main
      return { from: sel.from, to: sel.to, empty: sel.empty }
    })(),
  }
}

Object.assign(window, {
  initContextMenu(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'context-menu', docUri: 'file:///d%3A/notes/ctx.md',
      version: 1, text,
    })
  },
  controller,
  readMenu,
  /** 宿主消息通道（测试钩子、剪贴板回包与真实点击同一处理器） */
  post(msg: Record<string, unknown>) {
    controller.handleHostMessage(msg)
  },
  /** 出站消息观测（剪贴板桥与 keybindings.execute） */
  sent: () => sent,
  clearSent() {
    sent.length = 0
  },
  /** 选区设置（cut/copy 的 enable 与执行输入） */
  setSelection(anchor: number, head: number) {
    controller.getView()!.dispatch({ selection: { anchor, head } })
  },
})
