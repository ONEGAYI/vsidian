import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { WebviewSyncController } from '../../src/webview/syncController'
import '../../src/webview/main.css'

installLocale('zh-cn', zhCn)
const messages: unknown[] = []
let saved: unknown
const controller = new WebviewSyncController({
  postMessage: (message) => messages.push(message),
  getState: <T,>() => saved as T | undefined,
  setState: (state) => { saved = state },
})
controller.mount(document.getElementById('app')!)
controller.handleHostMessage({
  kind: 'init', sessionId: 'files', docUri: 'file:///notes/随记.md', version: 1,
  text: '# 随记\n\n这是编辑区域。左侧浏览文件，右侧查看本篇笔记的大纲。\n\n## 写作材料\n\n正文在两侧栏之间重新排版。',
})
Object.assign(window, {
  messages,
  filesReceive: (message: unknown) => controller.handleHostMessage(message),
})
