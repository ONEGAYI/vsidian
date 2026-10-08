// V02 验证票（#349）：测试附加组件页面源码（模拟组件作者的 TypeScript 模块）。
// 经构建桥（sdk/sdkBridge.mjs + buildAddon.mjs）打成独立 IIFE——作者不手写
// 全局变量；CM6 只经 SDK 的 experimental.cm6 取得（值导入 @codemirror/* 会被
// 构建桥拒绝）。
//
// 编辑器页行为（真实 CM6 扩展，非测试节点玩具）：
// - StateField 记录文档长度（create 读装载时刻的 doc——首笔输入是否对组件
//   可见以此取证）；
// - ViewPlugin + Decoration.mark 给首字符加 `.vsa2-mark` 标记（绘制层断言
//   的锚点，样式来自组件自己的 page.css）；
// - 每次文档变化经通道上报 addon.state（宿主/夹具侧断言组件扩展确实看到
//   生产视图的事务流）；
// - document 级探针监听 + onDispose 自清（释放后监听不再生效的取证）。
// 设置页行为：挂载根内构建标题/授权图片，经通道取「宿主下发的越界图 URI」
// 做拒绝对照，图片结局随 addon.report 上报。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { Extension } from '@codemirror/state'
import type { DecorationSet, EditorView as EditorViewOf } from '@codemirror/view'
// #351 T02 起类型与生产契约同源（src/shared/addonPage）；V02 夹具原型
// loader/types.ts 仅存档供 addonV02Probe 历史探针复跑
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'onegayi.vsidian-test-addon'

defineAddonPage(ADDON_ID, (sdk) => {
  if (sdk.addon.page === 'settings') {
    buildSettingsPage(sdk)
    return
  }
  buildEditorExtension(sdk)
})

/** 图片装载结局监听：**先挂监听再设 src**（src 先设会导致 load 事件在
 *  监听挂上前触发、承诺永不结算——真宿主首跑实证的竞态）。注意：无 src
 *  属性的 img 其 complete 恒为 true（HTML「不可用」态），快捷路径只在
 *  src 已存在时启用 */
function watchImage(image: HTMLImageElement): Promise<boolean> {
  if (image.getAttribute('src') && image.complete) {
    return Promise.resolve(image.naturalWidth > 0)
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    image.addEventListener('load', () => finish(true))
    image.addEventListener('error', () => finish(false))
  })
}

function buildEditorExtension(sdk: VsidianAddonPageSdk): void {
  const cm6 = sdk.experimental.cm6
  if (!cm6) {
    throw new Error('编辑器页 SDK 缺少 experimental.cm6 共享运行时')
  }
  const { StateField } = cm6.state
  const { ViewPlugin, Decoration, EditorView } = cm6.view

  // 文档长度 field：create 读取挂载时刻全文（首笔输入可见性证据）
  const docLength = StateField.define<number>({
    create: (state) => state.doc.length,
    update: (value, transaction) => (transaction.docChanged ? transaction.state.doc.length : value),
  })

  const markFirstChar = (view: EditorViewOf): DecorationSet => {
    if (view.state.doc.length === 0) {
      return Decoration.none
    }
    return Decoration.set([Decoration.mark({ class: 'vsa2-mark' }).range(0, 1)])
  }

  let lastReported = -1
  const report = (view: EditorViewOf): void => {
    const length = view.state.field(docLength, false) ?? -1
    if (length === lastReported) return
    lastReported = length
    void sdk.channel.request('addon.state', {
      page: 'editor',
      docLength: length,
      markText: length > 0 ? view.state.doc.sliceString(0, 1) : '',
      hasCm6: true,
    })
  }

  // 真实 ViewPlugin：随事务重建标记装饰并上报状态
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

  // 挂载即上报一次（首键可见性取的是 field create 值）
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor') ?? document.body)
  if (view) {
    report(view)
  }

  // 探针事件监听：释放后不再生效（onDispose 移除；触发即经通道上报）
  const onProbeEvent = (): void => {
    void sdk.channel.request('addon.ping', { source: 'vsa2-probe-event' })
  }
  document.addEventListener('vsa2-probe', onProbeEvent)
  sdk.onDispose(() => {
    document.removeEventListener('vsa2-probe', onProbeEvent)
  })
}

function buildSettingsPage(sdk: VsidianAddonPageSdk): void {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  root.className = 'vsa2-settings-root'
  const title = document.createElement('h3')
  title.className = 'vsa2-title'
  title.textContent = 'V02 test addon'
  root.append(title)

  // 监听先于 src 装配（见 watchImage 注释）
  const logo = document.createElement('img')
  logo.className = 'vsa2-logo'
  logo.alt = 'logo'
  const deniedImage = document.createElement('img')
  deniedImage.alt = 'denied'
  const logoDone = watchImage(logo)
  const deniedDone = watchImage(deniedImage)
  const logoSrc = sdk.resourceUri('logo.png')
  if (logoSrc) {
    logo.src = logoSrc
    root.append(logo)
  }
  root.append(deniedImage)

  // 越界图对照：URI 由宿主经通道下发（编辑器面板铸造的跨页地址或资源服务
  // 拒绝路径）；宿主不回执时按超时收场（浏览器套件无宿主，deniedImage 跳过）
  void sdk.channel
    .request('probe.deniedImage', {}, { timeoutMs: 3_000 })
    .then((outcome) => {
      if (outcome.ok && typeof outcome.result === 'object' && outcome.result !== null &&
        typeof (outcome.result as { uri?: unknown }).uri === 'string') {
        deniedImage.src = (outcome.result as { uri: string }).uri
      }
      return Promise.all([logoSrc ? logoDone : Promise.resolve(false), deniedImage.src ? deniedDone : Promise.resolve(false)]) as Promise<[boolean, boolean]>
    })
    .then(([logoLoaded, deniedLoaded]) =>
      sdk.channel.request('addon.report', {
        page: 'settings',
        logoLoaded,
        deniedLoaded,
        deniedSrcSet: deniedImage.src !== '',
      }))
    .catch(() => {
      // 通道释放等异常不上报（装载器侧已有计数）
    })
}
