// @vitest-environment jsdom
// webview 图片资源管理器契约（工单 #10）：
// 状态机：loading（占位）→ loaded（应用 src 且 img load 事件确认）/
// error（可点击重试的失败态）；离开视口 detach 释放（src 清空、条目回收）。
// 非直连图源经宿主 image.request/image.result 通道解析；https 直连不经宿主。
// 本层不写文档：任何路径都不得产生 edit.request（由使用方保证，本层只管
// 资源状态）。
import { describe, it, expect, vi } from 'vitest'
import { ImageResourceManager } from '../../src/webview/imageResource'
import { t } from '../../src/shared/i18n'

function makeManager() {
  const posted: Array<{ src: string; reqId: number }> = []
  const manager = new ImageResourceManager({
    isDirectSrc: (src) => /^https?:\/\//i.test(src),
    requestHost: (src, reqId) => posted.push({ src, reqId }),
  })
  return { manager, posted }
}

function img(): HTMLImageElement {
  return document.createElement('img')
}

function state(el: HTMLElement): string {
  return el.dataset['vsidianImgState'] ?? ''
}

describe('装载与占位状态', () => {
  it('attach 非直连图源：进入 loading 并经宿主通道请求（携带自增 reqId）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './assets/图 片.png')
    expect(state(el)).toBe('loading')
    expect(el.getAttribute('src')).toBeNull()
    expect(posted).toEqual([{ src: './assets/图 片.png', reqId: 1 }])
    expect(el.classList.contains('vsidian-image')).toBe(true)
    expect(el.dataset['vsidianImgSrc']).toBe('./assets/图 片.png')
  })

  it('https 直连图源不经宿主：立即应用原始 src', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, 'https://example.com/x.png')
    expect(posted).toEqual([])
    expect(el.getAttribute('src')).toBe('https://example.com/x.png')
    expect(state(el)).toBe('loading') // 等 img load 事件确认
  })

  it('同一 src 的并发槽位复用在途请求（不重复发请求）', () => {
    const { manager, posted } = makeManager()
    const a = img()
    const b = img()
    manager.attach(a, './same.png')
    manager.attach(b, './same.png')
    expect(posted.length).toBe(1)
  })
})

describe('结果应用与状态迁移', () => {
  it('image.result ok：应用 src，img load 事件后进入 loaded', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './ok.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/ok.png' })
    expect(el.getAttribute('src')).toBe('vscode-webview://res/ok.png')
    expect(state(el)).toBe('loading')
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
  })

  it('img error 事件（加载失败）进入 error 态并可点击重试', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './ok-but-broken.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/broken.png' })
    el.dispatchEvent(new Event('error'))
    expect(state(el)).toBe('error')
    expect(el.dataset['vsidianImgReason']).toBeDefined()
    // 重试：重新应用同一 src
    el.click()
    expect(state(el)).toBe('loading')
    expect(el.getAttribute('src')).toBe('vscode-webview://res/broken.png')
  })

  it('image.result 失败：进入 error 并带原因；点击重试发起新请求', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './missing.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(state(el)).toBe('error')
    expect(el.dataset['vsidianImgReason']).toBe('not-found')
    el.click()
    expect(state(el)).toBe('loading')
    expect(posted.length).toBe(2) // 新请求（新 reqId）
    expect(posted[1]!.reqId).toBeGreaterThan(posted[0]!.reqId)
    // 新结果到达后恢复
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/now.png' })
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
  })

  it('未知 reqId 的迟到结果被忽略', () => {
    const { manager } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    expect(() => manager.handleResult({ reqId: 999, ok: true, src: 'x' })).not.toThrow()
    expect(state(el)).toBe('loading')
  })

  it('错误态点击重试时阻断事件冒泡（不触发外层链接/容器点击）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './e.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    const outer = document.createElement('div')
    const onOuter = vi.fn()
    outer.addEventListener('click', onOuter)
    outer.appendChild(el)
    el.click()
    expect(onOuter).not.toHaveBeenCalled()
  })
})

describe('释放与回收', () => {
  it('detach 清空 src、解绑监听并回收条目：重新 attach 发起全新请求', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './r.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/r.png' })
    el.dispatchEvent(new Event('load'))
    manager.detach(el)
    expect(el.getAttribute('src')).toBeNull() // 释放解码位图
    expect(state(el)).toBe('') // 状态清空，不再是活动槽位
    // 旧监听已解绑：迟到 load 不再改状态
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('')
    // 条目已回收：同 src 重新 attach 是全新请求
    manager.attach(el, './r.png')
    expect(posted.length).toBe(2)
  })

  it('detachWithin 释放容器内全部图片槽位', () => {
    const { manager, posted } = makeManager()
    const root = document.createElement('div')
    for (const src of ['./1.png', './2.png']) {
      const el = img()
      root.appendChild(el)
      manager.attach(el, src)
    }
    const outside = img()
    manager.attach(outside, './3.png')
    expect(posted.length).toBe(3)
    manager.detachWithin(root)
    expect(root.querySelector('img')!.getAttribute('src')).toBeNull()
    expect(state(outside)).toBe('loading') // 容器外不受影响
  })

  it('sweep 清理已脱离文档的 live 槽位（CM6 widget 无销毁回调的兜底）', () => {
    const { manager, posted } = makeManager()
    const slot = document.createElement('span')
    document.body.appendChild(slot)
    manager.attach(slot, './s.png', (s, src) => {
      s.textContent = ''
      const image = document.createElement('img')
      image.src = src
      s.appendChild(image)
      return image
    })
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/s.png' })
    slot.remove() // 模拟 CM6 把 widget 移出视口
    manager.sweep()
    expect(manager.getStates().loaded).toBe(0)
    expect(slot.querySelector('img')!.getAttribute('src')).toBeNull()
    // 阅读槽位（无 render 回调）不受 sweep 影响：生命周期由挂载钩子管理
    const reading = img()
    manager.attach(reading, './keep.png')
    manager.sweep()
    expect(reading.dataset['vsidianImgState']).toBe('loading')
  })

  it('在途请求的最后一个槽位 detach 后：结果到达不复活任何槽位', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './ghost.png')
    manager.detach(el)
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/g.png' })
    expect(state(el)).toBe('')
    expect(el.getAttribute('src')).toBeNull()
  })
})

describe('观测（view.state 探针数据源）', () => {
  it('getStates 按 loading/loaded/error 计数活动槽位', () => {
    const { manager, posted } = makeManager()
    const loading = img()
    const failed = img()
    manager.attach(loading, './a.png')
    manager.attach(failed, './b.png')
    expect(manager.getStates()).toEqual({ loading: 2, loaded: 0, error: 0 })
    manager.handleResult({ reqId: posted[1]!.reqId, ok: false, reason: 'not-found' })
    expect(manager.getStates()).toEqual({ loading: 1, loaded: 0, error: 1 })
  })
})

describe('live 视图的自定义渲染回调', () => {
  it('render 回调构建 img 子元素并由其 load/error 驱动状态', () => {
    const { manager, posted } = makeManager()
    const slot = document.createElement('span')
    manager.attach(slot, './live.png', (s, src) => {
      s.textContent = ''
      const image = document.createElement('img')
      image.src = src
      s.appendChild(image)
      return image
    })
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/live.png' })
    const inner = slot.querySelector('img')
    expect(inner).not.toBeNull()
    expect(inner!.getAttribute('src')).toBe('vscode-webview://res/live.png')
    inner!.dispatchEvent(new Event('load'))
    expect(state(slot)).toBe('loaded')
    // detach 释放：内部 img 的 src 同样被清空
    manager.detach(slot)
    expect(inner!.getAttribute('src')).toBeNull()
  })
})

// ==== #201 图片定期刷新与删除态 ====

describe('失效通知（image.invalidate → 作废重发）', () => {
  it('invalidate 已挂载图源：作废条目、撤下旧图、槽位回 loading 并重发请求', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
    manager.invalidate(['./a.png'])
    expect(state(el)).toBe('loading')
    expect(el.getAttribute('src')).toBeNull() // 旧图撤下（解码位图释放）
    expect(posted.length).toBe(2)
    expect(posted[1]!.reqId).toBeGreaterThan(posted[0]!.reqId)
    // 新结果（新版本 URI）到达后应用
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=2' })
    el.dispatchEvent(new Event('load'))
    expect(el.getAttribute('src')).toBe('vscode-webview://res/a.png?v=2')
    expect(state(el)).toBe('loaded')
  })

  it('代次守卫：invalidate 后旧 reqId 的在途结果不复活旧图', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.invalidate(['./a.png']) // 首次请求仍在途，条目已作废重发
    expect(posted.length).toBe(2)
    // 旧 reqId 的迟到成功结果（旧版本 URI）必须被丢弃
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    expect(el.getAttribute('src')).toBeNull()
    expect(state(el)).toBe('loading')
    // 旧 reqId 的迟到失败结果同样不生效
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(state(el)).toBe('loading')
  })

  it('invalidate 后旧 img 的迟到 load/error 事件不覆盖新状态', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    manager.invalidate(['./a.png'])
    // 旧 img 已解绑（releaseImages）：迟到事件不改状态
    el.dispatchEvent(new Event('load'))
    el.dispatchEvent(new Event('error'))
    expect(state(el)).toBe('loading')
  })

  it('同一 src 多槽位一起刷新；同批多个 src 一次处理', () => {
    const { manager, posted } = makeManager()
    const a1 = img()
    const a2 = img()
    const b = img()
    manager.attach(a1, './a.png')
    manager.attach(a2, './a.png')
    manager.attach(b, './b.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    a1.dispatchEvent(new Event('load'))
    a2.dispatchEvent(new Event('load'))
    manager.invalidate(['./a.png', './b.png'])
    expect(state(a1)).toBe('loading')
    expect(state(a2)).toBe('loading')
    expect(state(b)).toBe('loading')
    expect(posted.length).toBe(4) // 初次 a(共享条目)+b 共 2 次 + a/b 各重发 1 次
  })

  it('未挂载的 src 与直连图源忽略（外链不纳入刷新；槽位离场条目已回收）', () => {
    const { manager, posted } = makeManager()
    const direct = img()
    manager.attach(direct, 'https://example.com/x.png')
    expect(() => manager.invalidate(['https://example.com/x.png', './none.png'])).not.toThrow()
    expect(posted.length).toBe(0)
    expect(direct.getAttribute('src')).toBe('https://example.com/x.png') // 直连不受影响
  })

  it('invalidate 匹配用 normalizeImgSrc 归一键（编码形态与原文同键）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './assets/图 片.png')
    manager.invalidate(['./assets/%E5%9B%BE%20%E7%89%87.png'])
    expect(posted.length).toBe(2)
  })

  it('error 态条目被 invalidate 刷新（文件恢复场景：重发请求）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './gone.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(state(el)).toBe('error')
    manager.invalidate(['./gone.png'])
    expect(state(el)).toBe('loading')
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/gone.png?v=2' })
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
    expect(el.classList.contains('vsidian-image-notfound')).toBe(false)
  })
})

describe('失败态细分（找不到 / 不可访问）', () => {
  it('not-found：error 基类 + notfound 修饰类 + 专属文案', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './missing.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(el.classList.contains('vsidian-image-error')).toBe(true)
    expect(el.classList.contains('vsidian-image-notfound')).toBe(true)
    expect(el.classList.contains('vsidian-image-unreachable')).toBe(false)
    expect(el.dataset['vsidianImgReason']).toBe('not-found')
  })

  it('inaccessible：error 基类 + unreachable 修饰类（不冒充找不到）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './remote.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'inaccessible' })
    expect(el.classList.contains('vsidian-image-error')).toBe(true)
    expect(el.classList.contains('vsidian-image-unreachable')).toBe(true)
    expect(el.classList.contains('vsidian-image-notfound')).toBe(false)
  })

  it('其他失败原因只有 error 基类（blocked/read-error/load-failed 维持现状）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './x.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'read-error' })
    expect(el.classList.contains('vsidian-image-error')).toBe(true)
    expect(el.classList.contains('vsidian-image-notfound')).toBe(false)
    expect(el.classList.contains('vsidian-image-unreachable')).toBe(false)
  })

  it('状态迁移清干净修饰类（loaded 后不再带 notfound/unreachable）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(el.classList.contains('vsidian-image-notfound')).toBe(true)
    manager.invalidate(['./a.png'])
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/a.png?v=2' })
    el.dispatchEvent(new Event('load'))
    expect(el.classList.contains('vsidian-image-notfound')).toBe(false)
    expect(el.classList.contains('vsidian-image-error')).toBe(false)
  })

  it('detach 清空修饰类', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'inaccessible' })
    manager.detach(el)
    expect(el.classList.contains('vsidian-image-unreachable')).toBe(false)
  })
})

describe('活跃图源上报（image.verify 数据源）', () => {
  it('activeEntries 列出条目级 src/状态/原因/已应用地址', () => {
    const { manager, posted } = makeManager()
    const loaded = img()
    const missing = img()
    manager.attach(loaded, './ok.png')
    manager.attach(missing, './miss.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/ok.png?v=1' })
    loaded.dispatchEvent(new Event('load'))
    manager.handleResult({ reqId: posted[1]!.reqId, ok: false, reason: 'not-found' })
    const entries = manager.activeEntries()
    expect(entries).toHaveLength(2)
    const okEntry = entries.find((e) => e.src === './ok.png')
    expect(okEntry).toMatchObject({ state: 'loaded', appliedSrc: 'vscode-webview://res/ok.png?v=1' })
    const missEntry = entries.find((e) => e.src === './miss.png')
    expect(missEntry).toMatchObject({ state: 'error', reason: 'not-found' })
  })

  it('直连图源不入上报（外链不纳入核验管线）', () => {
    const { manager } = makeManager()
    const direct = img()
    manager.attach(direct, 'https://example.com/x.png')
    expect(manager.activeEntries()).toEqual([])
  })
})

describe('活跃度回调（周期核验调度启停数据源）', () => {
  it('首条目建立触发 onBecomeActive；条目全回收触发 onBecomeIdle', () => {
    const active = vi.fn()
    const idle = vi.fn()
    const manager = new ImageResourceManager({
      isDirectSrc: (src) => /^https?:\/\//i.test(src),
      requestHost: () => {},
      onBecomeActive: active,
      onBecomeIdle: idle,
    })
    const a = img()
    const b = img()
    manager.attach(a, './a.png')
    expect(active).toHaveBeenCalledTimes(1)
    manager.attach(b, './b.png') // 已活跃，不重复触发
    expect(active).toHaveBeenCalledTimes(1)
    manager.detach(a)
    expect(idle).not.toHaveBeenCalled() // b 仍挂载
    manager.detach(b)
    expect(idle).toHaveBeenCalledTimes(1)
    // 回到活跃再回空闲：回调随状态翻转持续触发
    manager.attach(a, './a.png')
    expect(active).toHaveBeenCalledTimes(2)
    manager.detach(a)
    expect(idle).toHaveBeenCalledTimes(2)
  })

  it('直连图源不计入活跃度（外链不驱动周期核验）', () => {
    const active = vi.fn()
    const idle = vi.fn()
    const manager = new ImageResourceManager({
      isDirectSrc: (src) => /^https?:\/\//i.test(src),
      requestHost: () => {},
      onBecomeActive: active,
      onBecomeIdle: idle,
    })
    const direct = img()
    manager.attach(direct, 'https://example.com/x.png')
    expect(active).not.toHaveBeenCalled()
    manager.detach(direct)
    expect(idle).not.toHaveBeenCalled()
  })
})

describe('#208 全量失效重挂（手动刷新通道）', () => {
  it('invalidateAll 清条目并对活跃槽位重发解析（新 reqId），新结果换新 src', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: 1, ok: true, src: 'vscode-webview://res/a.png' })
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
    manager.invalidateAll()
    // 条目已清：同槽位重新走宿主解析（新 reqId），回 loading 占位
    expect(posted).toEqual([
      { src: './a.png', reqId: 1 },
      { src: './a.png', reqId: 2 },
    ])
    expect(el.getAttribute('src')).toBeNull()
    expect(state(el)).toBe('loading')
    // 宿主新解析（带新代次戳的 URI）到达后换新 src
    manager.handleResult({ reqId: 2, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    expect(el.getAttribute('src')).toBe('vscode-webview://res/a.png?v=1')
  })

  it('同 src 多槽位失效后复用同一新在途请求（不重复发请求）', () => {
    const { manager, posted } = makeManager()
    const a = img()
    const b = img()
    manager.attach(a, './same.png')
    manager.attach(b, './same.png')
    manager.handleResult({ reqId: 1, ok: true, src: 'vscode-webview://res/same.png' })
    manager.invalidateAll()
    // 失效后首个重挂发起新请求，第二个槽位复用在途条目
    expect(posted).toEqual([
      { src: './same.png', reqId: 1 },
      { src: './same.png', reqId: 2 },
    ])
    manager.handleResult({ reqId: 2, ok: true, src: 'vscode-webview://res/same.png?v=1' })
    expect(a.getAttribute('src')).toBe('vscode-webview://res/same.png?v=1')
    expect(b.getAttribute('src')).toBe('vscode-webview://res/same.png?v=1')
  })

  it('失效前的在途请求迟到结果被丢弃（条目已重建，未知 reqId 不路由）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './a.png') // reqId 1 在途
    manager.invalidateAll() // 重挂发 reqId 2
    expect(posted.map((p) => p.reqId)).toEqual([1, 2])
    // 旧 reqId 1 的迟到结果：不得应用（旧代次地址）
    manager.handleResult({ reqId: 1, ok: true, src: 'vscode-webview://res/old.png' })
    expect(el.getAttribute('src')).toBeNull()
    expect(state(el)).toBe('loading')
    // 新 reqId 2 的结果正常应用
    manager.handleResult({ reqId: 2, ok: true, src: 'vscode-webview://res/a.png?v=1' })
    expect(el.getAttribute('src')).toBe('vscode-webview://res/a.png?v=1')
  })

  it('直连图源失效后重新应用原始 src（不经宿主、无代次语义）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, 'https://example.com/x.png')
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
    manager.invalidateAll()
    expect(posted).toEqual([])
    expect(el.getAttribute('src')).toBe('https://example.com/x.png')
    expect(state(el)).toBe('loading')
  })

  it('live 视图 render 回调槽位失效后经同一回调重建内部 img', () => {
    const { manager, posted } = makeManager()
    const slot = document.createElement('span')
    const built: string[] = []
    manager.attach(slot, './live.png', (s, src) => {
      built.push(src)
      const image = document.createElement('img')
      image.setAttribute('src', src)
      s.appendChild(image)
      return image
    })
    manager.handleResult({ reqId: 1, ok: true, src: 'vscode-webview://res/live.png' })
    expect(built).toEqual(['vscode-webview://res/live.png'])
    manager.invalidateAll()
    expect(posted.map((p) => p.reqId)).toEqual([1, 2])
    manager.handleResult({ reqId: 2, ok: true, src: 'vscode-webview://res/live.png?v=1' })
    expect(built).toEqual(['vscode-webview://res/live.png', 'vscode-webview://res/live.png?v=1'])
  })
})

// ==== 失效提示文字（2026-10-05 验收：胶囊内直接显示提示信息）====
// error 胶囊此前信息只在悬停 tooltip（内容塌陷后呈几像素细条、不悬停
// 不可知）。改版：提示文案写入槽位 img 的 alt——无有效 src 的 img 按
// 规范以文本渲染 alt，提示落进既有胶囊样式内直接可见；原 alt 记忆并
// 在恢复时回写（用户写的 alt 不丢）。

describe('失效提示文字（error 胶囊内可见）', () => {
  it('解析失败进入 error：细分文案写入 alt（not-found 专属词条）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './missing.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(state(el)).toBe('error')
    expect(el.getAttribute('alt')).toBe(t('decor.imageNotFound'))
  })

  it('加载失败（img error 事件）写入通用失败文案（原因缺省为未知）', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './ok-but-broken.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/broken.png' })
    el.dispatchEvent(new Event('error'))
    expect(state(el)).toBe('error')
    expect(el.getAttribute('alt')).toBe(t('decor.imageError', { reason: t('decor.unknownReason') }))
    // src 一并清除：有 src 的加载失败在浏览器里呈坏图图标（alt 被截断），
    // 清 src 落到「无 src + alt 文本」形态——两条失败路径呈现统一
    expect(el.getAttribute('src')).toBeNull()
  })

  it('原 alt 记忆与回写：error 覆盖用户 alt，重试成功后回写原值', () => {
    const { manager, posted } = makeManager()
    const el = img()
    el.setAttribute('alt', '用户写的说明')
    manager.attach(el, './a.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'not-found' })
    expect(el.getAttribute('alt')).toBe(t('decor.imageNotFound'))
    el.click() // 重试
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/a.png' })
    el.dispatchEvent(new Event('load'))
    expect(state(el)).toBe('loaded')
    expect(el.getAttribute('alt')).toBe('用户写的说明')
  })

  it('live 槽位（render 回调）：error 文案写入内部 img 的 alt', () => {
    const { manager, posted } = makeManager()
    const slot = document.createElement('span')
    manager.attach(slot, './live.png', (s, src) => {
      s.textContent = ''
      const image = document.createElement('img')
      image.src = src
      s.appendChild(image)
      return image
    })
    manager.handleResult({ reqId: posted[0]!.reqId, ok: true, src: 'vscode-webview://res/live.png' })
    const inner = slot.querySelector('img')!
    inner.dispatchEvent(new Event('error'))
    expect(state(slot)).toBe('error')
    expect(inner.getAttribute('alt')).toBe(t('decor.imageError', { reason: t('decor.unknownReason') }))
  })

  it('原 alt 为空时恢复后不留 alt 属性', () => {
    const { manager, posted } = makeManager()
    const el = img()
    manager.attach(el, './b.png')
    manager.handleResult({ reqId: posted[0]!.reqId, ok: false, reason: 'inaccessible' })
    expect(el.getAttribute('alt')).toBe(t('decor.imageInaccessible'))
    el.click()
    manager.handleResult({ reqId: posted[1]!.reqId, ok: true, src: 'vscode-webview://res/b.png' })
    el.dispatchEvent(new Event('load'))
    expect(el.getAttribute('alt')).toBeNull()
  })
})
