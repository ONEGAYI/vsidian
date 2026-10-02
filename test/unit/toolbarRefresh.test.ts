// @vitest-environment jsdom
// #208 工具栏刷新按钮契约（jsdom 控制器层）：
// - 按钮存在于顶栏（齿轮、✎ 与双态切换之间），原生 button、内联 SVG 图标
// - tooltip/aria 经 localeDom 注册表随语言换包重刷（键 toolbar.refresh）
// - 点击出站 refresh.request（sessionId/docUri/reqId，reqId 逐次自增）
// - reqId 陈旧回执防护：刷新后又有新请求时，旧 refresh.invalidated 到达
//   被观测层丢弃（不触发失效重挂）；失效动作本身幂等，防护只挡误触发
// - mousedown preventDefault 防抢正文焦点（✎/双态切换同款策略）
// - 快捷键入口（ui.command op=refreshEditor，宿主 executeCommand 回发）与
//   按钮汇合于同一发送实现——见 keybindingUiCommands.test.ts；宿主侧编排
//   （documentSession 的 refresh.request 处理）唯一，见 documentSession.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'

installLocale('zh-cn', zhCn)

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  ;(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null
}

const DOC_URI = 'file:///d%3A/notes/refresh-button.md'

const mountedParents: HTMLElement[] = []

afterEach(() => {
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
})

function setup(text = '# 标题\n\n正文段。') {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  const c = new WebviewSyncController(bridge)
  const parent = document.createElement('div')
  // 挂进 document：localeDom 换包重刷按 isConnected 判存活——脱挂元素
  // 被当死项剪除（生产挂树在同步创建块内完成，测试须同样挂树）
  document.body.appendChild(parent)
  mountedParents.push(parent)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  return { c, parent, sent }
}

function refreshButton(parent: HTMLElement): HTMLButtonElement {
  return parent.querySelector<HTMLButtonElement>('.vsidian-refresh-toggle')!
}

function refreshRequests(sent: WebviewToHost[]): WebviewToHost[] {
  return sent.filter((m) => m.kind === 'refresh.request')
}

describe('#208 工具栏刷新按钮', () => {
  it('按钮存在于顶栏：原生 button、内联 SVG 图标（不引图标库）', () => {
    const { c, parent } = setup()
    const btn = refreshButton(parent)
    expect(btn).toBeTruthy()
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.type).toBe('button')
    expect(btn.querySelector('svg')).toBeTruthy()
    c.dispose()
  })

  it('tooltip 与 aria 同词（zh 包，键 toolbar.refresh，localeDom 注册表）', () => {
    const { c, parent } = setup()
    const btn = refreshButton(parent)
    expect(btn.getAttribute('aria-label')).toBe(zhCn['toolbar.refresh'])
    expect(btn.getAttribute('data-tooltip')).toBe(zhCn['toolbar.refresh'])
    c.dispose()
  })

  it('换包重刷：installLocale(en) 后 aria/title 随语言重算', () => {
    const { c, parent } = setup()
    const btn = refreshButton(parent)
    installLocale('en', en)
    expect(btn.getAttribute('aria-label')).toBe(en['toolbar.refresh'])
    expect(btn.getAttribute('data-tooltip')).toBe(en['toolbar.refresh'])
    installLocale('zh-cn', zhCn)
    expect(btn.getAttribute('aria-label')).toBe(zhCn['toolbar.refresh'])
    c.dispose()
  })

  it('点击出站 refresh.request（sessionId/docUri/reqId），再点 reqId 递增', () => {
    const { c, parent, sent } = setup()
    const btn = refreshButton(parent)
    const before = sent.length
    btn.click()
    expect(sent.slice(before)).toEqual([
      { kind: 'refresh.request', sessionId: 's1', docUri: DOC_URI, reqId: 1 },
    ])
    btn.click()
    expect(refreshRequests(sent).map((m) => (m as { reqId: number }).reqId)).toEqual([1, 2])
    c.dispose()
  })

  it('mousedown 只拦默认聚焦（不抢正文焦点），click 照常触发', () => {
    const { c, parent, sent } = setup()
    const btn = refreshButton(parent)
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    btn.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    const before = sent.length
    btn.click()
    expect(refreshRequests(sent.slice(before))).toHaveLength(1)
    c.dispose()
  })

  it('reqId 陈旧回执防护：新请求发出后旧 refresh.invalidated 到达不触发失效重挂', () => {
    // 带图文档 + 阅读模式（块挂载钩子同步触发首轮图片解析，与
    // refreshInvalidation.test.ts 同款观测面）
    const { c, parent, sent } = setup('![图](./a.png)\n')
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    // 首轮图片解析请求在场（reqId 序列与 refresh 独立）
    const imageRequests = () =>
      sent.filter((m) => m.kind === 'image.request') as Array<{ reqId: number }>
    expect(imageRequests()).toHaveLength(1)
    // 两次点击发出 refresh.request reqId=1、2（刷新后又有新请求）
    refreshButton(parent).click()
    refreshButton(parent).click()
    expect(refreshRequests(sent)).toHaveLength(2)
    // 旧回执（reqId=1，对应已被第二次请求取代的刷新）到达：观测层丢弃，
    // 不触发失效重挂——image.request 数量不变
    c.handleHostMessage({ kind: 'refresh.invalidated', reqId: 1, generation: 1 })
    expect(imageRequests()).toHaveLength(1)
    // 新回执（reqId=2，与最后发出的请求配对）到达：失效重挂生效
    c.handleHostMessage({ kind: 'refresh.invalidated', reqId: 2, generation: 2 })
    expect(imageRequests().map((m) => m.reqId)).toEqual([1, 2])
    c.dispose()
  })
})
