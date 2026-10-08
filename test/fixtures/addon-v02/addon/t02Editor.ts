// #351 T02 测试组件编辑器页源码（模拟组件作者用公开 SDK 注册 CM6 扩展
// 并与宿主通信）。经 V02 构建桥（sdk/sdkBridge.mjs）打成独立 IIFE：
// - CM6 只经 sdk.experimental.cm6 取得（构建桥拒绝 @codemirror/* 值导入）；
// - StateField 记录文档长度（create 读装载时刻全文——首键可见性证据）；
// - ViewPlugin + Decoration.mark 给首字符加 `.t02-mark`（绘制层断言锚点，
//   样式来自组件自己的 dist/editor.css——计算色 rgb(0, 200, 120)）；
// - 挂载即发 t02.echo（run scope 通道——回执由宿主夹具 handler 应答），
//   结局经 t02.report 上报（宿主侧可数，断言不依赖 webview DOM 探针）；
// - 文档变化经 t02.docState 上报（组件扩展确实看到生产视图事务流）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { Extension } from '@codemirror/state'
import type { DecorationSet, EditorView as EditorViewOf } from '@codemirror/view'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-t02'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const cm6 = sdk.experimental.cm6
  if (!cm6) {
    throw new Error('编辑器页 SDK 缺少 experimental.cm6 共享运行时')
  }
  const { StateField } = cm6.state
  const { ViewPlugin, Decoration, EditorView } = cm6.view

  const docLength = StateField.define<number>({
    create: (state) => state.doc.length,
    update: (value, transaction) => (transaction.docChanged ? transaction.state.doc.length : value),
  })

  const markFirstChar = (view: EditorViewOf): DecorationSet => {
    if (view.state.doc.length === 0) {
      return Decoration.none
    }
    return Decoration.set([Decoration.mark({ class: 't02-mark' }).range(0, 1)])
  }

  let lastReported = -1
  // 标记的计算背景色（绘制层证据：组件自己的授权样式表在真宿主
  // Chromium 内实际生效——getComputedStyle 读「用户看到的颜色」）
  const markColor = (view: EditorViewOf): string => {
    const el = view.dom.querySelector('.t02-mark')
    return el ? getComputedStyle(el).backgroundColor : ''
  }
  const report = (view: EditorViewOf): void => {
    const length = view.state.field(docLength, false) ?? -1
    if (length === lastReported) return
    lastReported = length
    // #406 language 子集消费证据：函数源文本前缀（同一性证据，见 V02 组件同款注释）
    void sdk.channel.request('t02.docState', {
      docLength: length,
      markColor: markColor(view),
      syntaxTreeFn: String(cm6.language.syntaxTree).slice(0, 48),
    })
  }
  // 装饰 DOM 在装载器 reconfigure 后的下一帧才绘制——挂载即读计算色
  // 可能为空；rAF 轮询直到读到非空色再补一报（有界 60 帧）
  let disposed = false
  sdk.onDispose(() => { disposed = true })
  const pollMarkColor = (framesLeft: number): void => {
    if (disposed || framesLeft <= 0) return
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor') ?? document.body)
    if (view) {
      const color = markColor(view)
      if (color !== '') {
        void sdk.channel.request('t02.docState', {
          docLength: view.state.field(docLength, false) ?? -1,
          markColor: color,
        })
        return
      }
    }
    requestAnimationFrame(() => pollMarkColor(framesLeft - 1))
  }
  requestAnimationFrame(() => pollMarkColor(60))

  const markPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorViewOf) {
        this.decorations = markFirstChar(view)
      }
      update(view: EditorViewOf) {
        this.decorations = markFirstChar(view)
        report(view)
      }
    },
    { decorations: (instance: { decorations: DecorationSet }) => instance.decorations },
  )

  if (!sdk.registerExtension([docLength, markPlugin] as Extension[])) {
    throw new Error('扩展登记被拒绝（编辑器装配槽不可用）')
  }

  // 挂载即发一次 run scope 通道请求，回执结局经 t02.report 上报（集成
  // 断言面：宿主夹具 handler 计数 + 组件确认回执到达）
  void sdk.channel
    .request('t02.echo', { phase: 'mounted', generation: sdk.addon.generation })
    .then((outcome) =>
      sdk.channel.request('t02.report', {
        topic: 'echo',
        ok: outcome.ok,
        echoed: outcome.ok ? outcome.result : null,
      }))
    .catch(() => {
      // 释放等异常不上报（装载器侧已有计数）
    })

  const view = EditorView.findFromDOM(document.querySelector('.cm-editor') ?? document.body)
  if (view) {
    report(view)
  }
})
