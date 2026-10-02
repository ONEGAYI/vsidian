// #292 骨架屏浏览器探针夹具：生产控制器 + 生产 CSS + 宿主同源内联装配
// （样式/标记经 skeletonScreen 构造器注入，与 buildWebviewHtml 拼装形态
// 一致）。生产控制器直接驱动，不经 VSCode 宿主。
import '../../src/webview/main.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { buildSkeletonBodyHtml, buildSkeletonStyleHtml } from '../../src/host/skeletonScreen'
import { SKELETON_HOLD_GLOBAL, SKELETON_SHOWN_AT_GLOBAL } from '../../src/shared/skeletonTiming'

// 宿主 buildWebviewHtml 在 head 注入骨架内联样式（先于编辑器挂载生效）
document.head.insertAdjacentHTML('beforeend', buildSkeletonStyleHtml())

const sent: unknown[] = []
const controller = new WebviewSyncController({
  postMessage: (m) => {
    sent.push(m)
  },
  getState: () => undefined,
  setState: () => undefined,
})

const hooks = window as unknown as Record<string, unknown>

/** 空窗①观感：只放骨架标记（宿主 HTML 形态），编辑器尚未挂载 */
hooks['stageSkeleton'] = () => {
  document.getElementById('app')!.innerHTML = buildSkeletonBodyHtml()
}

/** 空窗②：挂载编辑器并下发 init 全文（hold/shownAgo 模拟宿主装配参数） */
hooks['initSkeletonProbe'] = (text: string, opts?: { hold?: boolean; shownAgoMs?: number }) => {
  if (opts?.hold === true) {
    ;(globalThis as unknown as Record<string, unknown>)[SKELETON_HOLD_GLOBAL] = true
  }
  ;(globalThis as unknown as Record<string, unknown>)[SKELETON_SHOWN_AT_GLOBAL] =
    performance.now() - (opts?.shownAgoMs ?? 10)
  controller.mount(document.getElementById('app')!)
  controller.handleHostMessage({
    kind: 'init',
    sessionId: 's1',
    docUri: 'file:///d%3A/notes/skeleton.md',
    version: 1,
    text,
  })
}

/** release：解除冻结并立即撤除（集成 _test.skeleton.release 的同款消息） */
hooks['releaseSkeleton'] = () => {
  controller.handleHostMessage({ kind: '_test.skeleton.release' })
}

hooks['skeletonSent'] = () => sent
