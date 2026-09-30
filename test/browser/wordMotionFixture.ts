// 原生浏览器键盘回归（#239 中文分词词级移动）：装配生产 webview 控制器
//（wordMotion 命令经 keybindingRouter 的 document 捕获层本地分支生效，
// UI_OPERATIONS 默认键位 ctrl+方向在此接线），按键只由浏览器键盘发起。
// 光标定位经 view.locate 消息走生产链路（与 tabIndentFixture 同口径）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import {
  __setJiebaBoundariesForTest,
  activeWordSegmentEngine,
  configureWordSegment,
} from '../../src/webview/wordMotion'
import { boundariesFromTokens } from '../../src/shared/wordSegment'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const controller = new WebviewSyncController({
  postMessage(message) {
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'word-motion',
      docUri: 'file:///word-motion.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from,
      to: main.to }
  },
  /** page 上下文的真实 Intl.Segmenter 词边界（与生产 builtin 引擎同源同
   *  版本——断言按此动态计算，不硬编码随 ICU 漂移的具体切分） */
  intlWordBoundaries(text: string): number[] {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    const boundaries: number[] = []
    let acc = 0
    for (const { segment } of segmenter.segment(text)) {
      boundaries.push(acc)
      acc += segment.length
    }
    boundaries.push(acc)
    return [...new Set(boundaries)].sort((a, b) => a - b)
  },
  /** 注入确定性 jieba 词表（单测 __setJiebaBoundariesForTest 同款；browser
   *  侧验证「真实键盘 + jieba 边界」的组合，资源下载链路属集成域） */
  setJiebaWords(tokens: string[]) {
    __setJiebaBoundariesForTest((text: string) =>
      boundariesFromTokens(text, tokens) ?? [0, text.length])
    configureWordSegment({ engine: 'jieba', resources: null })
  },
  /** 恢复 builtin 引擎（场景隔离） */
  resetEngine() {
    __setJiebaBoundariesForTest(null)
    configureWordSegment({ engine: 'builtin', resources: null })
  },
  activeEngine(): string {
    return activeWordSegmentEngine()
  },
})
