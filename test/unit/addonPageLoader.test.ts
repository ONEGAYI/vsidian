// @vitest-environment jsdom
// #351 T02 生产页面装载器的释放矩阵与代次拒收单元测试（断言形状自 V02
// 验证件 #349 移植——装载器已并入生产 src/webview/addonPageLoader，本文件
// 改为消费生产实现；fixtures 内的原型仅供 addonV02Probe 历史探针复跑）。
// 覆盖票面验收「重复接入、关闭、故障、恢复和迟到消息矩阵可重放」中
// 可在纯逻辑层钉住的部分；授权/拒绝的资源服务对照与真实键盘/IME 属
// 集成与浏览器套件（研究记录留证）。
// 脚本/样式装载与时钟全部注入——DOM <script>/<link> 默认路径在真宿主
// 与 Chromium 内验证（jsdom 不取资源，onload/onerror 不可靠）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Compartment, EditorState, StateField, type Extension, type StateField as StateFieldType } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderEnv,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type {
  AddonCm6Runtime,
  AddonLoadManifest,
  AddonPageOutbound,
  AddonPageRegistration,
  VsidianAddonPageSdk,
} from '../../src/shared/addonPage'

/** 测试用共享 CM6 运行时：直接引用页面 bundle 内同一份模块命名空间
 *  （单元测试进程内 import 即「本页运行时」） */
const cm6: AddonCm6Runtime = { state: await import('@codemirror/state'), view: await import('@codemirror/view') }

const ADDON_ID = 'onegayi.vsidian-test-addon'

interface Harness {
  handle: AddonPageLoaderHandle
  sent: AddonPageOutbound[]
  registrations: AddonPageRegistration[]
  attached: Array<Extension[] | null>
  advance: (ms: number) => void
  scripts: Map<string, { ok: boolean; error?: string }>
  css: Map<string, 'authorized' | 'denied'>
  now: () => number
}

/** 装配测试台：注入脚本/样式表与时钟，登记表直推（模拟 IIFE 执行）。
 *  登记数组必须在装载器安装前落到全局——装载器安装时捕获数组引用 */
function harness(overrides: Partial<AddonPageLoaderEnv> = {}): Harness {
  const sent: AddonPageOutbound[] = []
  const registrations: AddonPageRegistration[] = []
  const attached: Array<Extension[] | null> = []
  const timers: Array<{ deadline: number; fire: () => void; cancel: () => void }> = []
  let clock = 1_000
  const now = () => clock
  const advance = (ms: number) => {
    clock += ms
    for (const timer of [...timers]) {
      if (timer.deadline <= clock) timer.fire()
    }
  }
  const scripts = new Map<string, { ok: true } | { ok: false; error: string }>([
    ['https://page.test/addon.js', { ok: true }],
  ])
  const css = new Map<string, 'authorized' | 'denied'>([['https://page.test/addon.css', 'authorized']])
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
  const handle = installAddonPageLoader({
    page: 'editor',
    cm6,
    attachExtensions: (extension) => attached.push(extension),
    send: (message) => sent.push(message),
    loadScript: (uri) => Promise.resolve(scripts.get(uri) ?? { ok: false, error: `no script fixture: ${uri}` }),
    loadCss: (uri) => Promise.resolve(css.get(uri) ?? 'denied'),
    now,
    scheduleTimeout: (callback, ms) => {
      const timer = {
        deadline: clock + ms,
        fire: () => {
          timer.cancel()
          callback()
        },
        cancel: () => {
          const index = timers.indexOf(timer)
          if (index >= 0) timers.splice(index, 1)
        },
      }
      timers.push(timer)
      return { cancel: timer.cancel }
    },
    ...overrides,
  })
  return { handle, sent, registrations, attached, advance, scripts, css, now }
}

/** 模拟组件 IIFE 执行：向登记表追加工厂 */
const registerFactory = (h: Harness, factory: AddonPageRegistration['factory'], addonId = ADDON_ID, at?: number) => {
  h.registrations.push({ addonId, factory, registeredAt: at ?? h.now() })
}

const manifest = (overrides: Partial<AddonLoadManifest> = {}): AddonLoadManifest => ({
  addonId: ADDON_ID,
  generation: 1,
  page: 'editor',
  scriptUri: 'https://page.test/addon.js',
  ...overrides,
})

/** 等待微任务排空（通道 promise 的结算传播） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = []
})

describe('T02 生产装载器：装载与身份', () => {
  it('授权脚本 + 身份相符 → 工厂收到 SDK（cm6 为页面注入的同一运行时）', async () => {
    const h = harness()
    let received = false
    registerFactory(h, (sdk) => {
      received = true
      expect(sdk.addon).toEqual({ id: ADDON_ID, generation: 1, page: 'editor' })
      expect(sdk.experimental.cm6).toBe(cm6)
    })
    const outcome = await h.handle.load(manifest())
    expect(outcome).toEqual({ ok: true, css: [] })
    expect(received).toBe(true)
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 1 }])
    expect(h.handle.stats().cm6Shared).toBe(true)
    expect(h.sent.at(-1)).toMatchObject({ type: 'addon.loaded', outcome: { ok: true } })
  })

  it('同一组件重复装载 → already-loaded（对齐设计的 AlreadyRegistered 语义）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    const second = await h.handle.load(manifest({ generation: 2 }))
    expect(second).toEqual({ ok: false, reason: 'already-loaded' })
    expect(h.handle.stats().active[0].generation).toBe(1)
  })

  it('登记身份与入口身份不符 → identity-mismatch 拒绝', async () => {
    const h = harness()
    registerFactory(h, () => {}, 'someone.else-addon')
    const outcome = await h.handle.load(manifest())
    expect(outcome).toEqual({ ok: false, reason: 'identity-mismatch', detail: 'registered=someone.else-addon' })
    expect(h.handle.stats().active).toEqual([])
  })

  it('脚本执行但未登记工厂 → no-factory-registered', async () => {
    const h = harness()
    const outcome = await h.handle.load(manifest())
    expect(outcome).toEqual({ ok: false, reason: 'no-factory-registered' })
  })

  it('未授权脚本（资源服务拒绝）→ script-load-failed', async () => {
    const h = harness()
    h.scripts.set('https://page.test/denied.js', { ok: false, error: 'script onerror: denied' })
    const outcome = await h.handle.load(manifest({ scriptUri: 'https://page.test/denied.js' }))
    expect(outcome).toEqual({ ok: false, reason: 'script-load-failed', detail: 'script onerror: denied' })
    expect(h.handle.stats().active).toEqual([])
  })

  it('样式表 DOM 路径：授权 link 真实入 document，卸载随 release 撤下（评审补漏）', async () => {
    // 不注入 loadCss 桩——走 domLoadCssLink 分支（jsdom 不取资源，手动
    // 派发 load 事件完成授权结算；释放路径的 link.remove 因此真实执行）
    const h = harness({ loadCss: undefined })
    registerFactory(h, () => {})
    const uri = 'https://page.test/addon.css'
    const pending = h.handle.load(manifest({ cssUris: [uri] }))
    const link = await vi.waitFor(() => {
      const el = document.head.querySelector(`link[href="${uri}"]`)
      if (!el) throw new Error('link 未入 head')
      return el as HTMLLinkElement
    })
    link.dispatchEvent(new window.Event('load'))
    const outcome = await pending
    expect(outcome.ok).toBe(true)
    expect(document.head.querySelector(`link[href="${uri}"]`)).not.toBeNull()
    await h.handle.unload(ADDON_ID, 1)
    expect(document.head.querySelector(`link[href="${uri}"]`)).toBeNull()
  })

  it('样式逐条独立：授权与拒绝并存时整体装载仍成功且结局逐条记录', async () => {
    const h = harness()
    h.css.set('https://page.test/denied.css', 'denied')
    registerFactory(h, () => {})
    const outcome = await h.handle.load(
      manifest({ cssUris: ['https://page.test/addon.css', 'https://page.test/denied.css'] }),
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.css).toEqual([
        { uri: 'https://page.test/addon.css', status: 'authorized' },
        { uri: 'https://page.test/denied.css', status: 'denied' },
      ])
    }
  })

  it('工厂抛出可归因异常 → factory-error 且按故障完整释放', async () => {
    const h = harness()
    registerFactory(h, () => {
      throw new Error('boom')
    })
    const outcome = await h.handle.load(manifest())
    expect(outcome).toEqual({ ok: false, reason: 'factory-error', detail: 'Error: boom' })
    expect(h.handle.stats().active).toEqual([])
    expect(h.handle.stats().history.at(-1)).toMatchObject({ ended: 'faulted', reason: 'factory-error: Error: boom' })
    expect(h.sent.some((message) => message.type === 'addon.faulted')).toBe(true)
  })
})

describe('T12 运行期故障上报：reportRuntimeFault（上报与回收分离）', () => {
  it('活跃装载上报 faulted（stage 与 detail 拼进 reason）且保持在场（本页回收等宿主指令）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    const reported = h.handle.reportRuntimeFault(ADDON_ID, 'renderer-mount', 'r1#graph: Error: boom')
    expect(reported).toBe(true)
    // 上报消息形态：宿主 handleOutbound 的 faulted 路由直接消费
    const faulted = h.sent.find((message) => message.type === 'addon.faulted')
    expect(faulted).toMatchObject({
      type: 'addon.faulted',
      addonId: ADDON_ID,
      generation: 1,
      reason: 'renderer-mount: r1#graph: Error: boom',
    })
    // 保持在场：装载器不做本页同步回收（宿主 faultRecord 后经 unload
    // 指令对账——避免组件回调栈内同步触发渲染热切换重入 CM6）
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 1 }])
  })

  it('同代次上报去重：已上报后的重复异常丢弃（不重复打扰宿主）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'behavior-onInput', 'a: Error: 1st')).toBe(true)
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'command-handler', 'b: Error: 2nd')).toBe(false)
    const faults = h.sent.filter((message) => message.type === 'addon.faulted')
    expect(faults).toHaveLength(1)
    expect(faults[0]).toMatchObject({ reason: 'behavior-onInput: a: Error: 1st' })
  })

  it('不在场的上报返回 false（未装载或已卸载——无处归因）', async () => {
    const h = harness()
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'behavior-onInput', 'x')).toBe(false)
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    await h.handle.unload(ADDON_ID, 1)
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'behavior-onInput', 'x')).toBe(false)
  })

  it('上报后宿主 unload 指令照常回收：完整释放路径（history released）', async () => {
    const h = harness()
    const disposals: string[] = []
    registerFactory(h, (sdk) => {
      sdk.onDispose(() => disposals.push('cb'))
    })
    await h.handle.load(manifest())
    h.handle.reportRuntimeFault(ADDON_ID, 'ui-button-onClick', 'btn: Error: boom')
    const outcome = await h.handle.unload(ADDON_ID, 1)
    expect(outcome).toEqual({ ok: true })
    expect(h.handle.stats().active).toEqual([])
    expect(h.handle.stats().history.at(-1)).toMatchObject({ ended: 'released' })
    expect(disposals).toEqual(['cb'])
    // 卸载后上报通道关闭（返回 false——代次已终结）
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'behavior-onInput', 'late')).toBe(false)
  })

  it('新代次重新装载后可再次上报（去重不跨代次）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest({ generation: 1 }))
    h.handle.reportRuntimeFault(ADDON_ID, 'behavior-onInput', 'a: Error: 1st')
    await h.handle.unload(ADDON_ID, 1)
    registerFactory(h, () => {}, ADDON_ID, h.now() + 1)
    await h.handle.load(manifest({ generation: 2 }))
    expect(h.handle.reportRuntimeFault(ADDON_ID, 'command-handler', 'b: Error: 2nd')).toBe(true)
    expect(h.sent.filter((message) => message.type === 'addon.faulted')).toHaveLength(2)
  })
})

describe('T02 生产装载器：代次硬边界', () => {
  it('旧代次卸载指令不生效：装载保持原状且计数拒绝', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest({ generation: 5 }))
    const outcome = await h.handle.unload(ADDON_ID, 4)
    expect(outcome).toEqual({ ok: false, reason: 'stale-generation' })
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 5 }])
    expect(h.handle.stats().counters.staleUnloadRejected).toBe(1)
  })

  it('旧代次工厂注册不接入新代次：装载开始前的遗留登记被丢弃', async () => {
    const h = harness()
    registerFactory(h, () => {
      throw new Error('旧代次工厂不得执行')
    }, ADDON_ID, 500)
    h.advance(10_000)
    const outcome = await h.handle.load(manifest({ generation: 2 }))
    expect(outcome).toEqual({ ok: false, reason: 'no-factory-registered' })
    expect(h.handle.stats().counters.lateRegistrationsDropped).toBe(1)
  })

  it('同批多余登记只接入首个（一次装载一个工厂）', async () => {
    const h = harness()
    let runs = 0
    registerFactory(h, () => {
      runs++
    })
    registerFactory(h, () => {
      runs++
    })
    await h.handle.load(manifest())
    expect(runs).toBe(1)
    expect(h.handle.stats().counters.unsolicitedRegistrationsDropped).toBe(1)
  })

  it('迟到通道回执不回挂：已终结请求的回执被丢弃计数', async () => {
    const h = harness()
    const results: Array<unknown> = []
    registerFactory(h, (sdk) => {
      void sdk.channel.request('probe.slow', {}, { timeoutMs: 100 }).then((outcome) => results.push(outcome))
    })
    await h.handle.load(manifest())
    const outbound = h.sent.find((message) => message.type === 'addon.channel.request')
    expect(outbound?.type).toBe('addon.channel.request')
    h.advance(200)
    await settle()
    expect(results).toEqual([{ ok: false, reason: 'timeout' }])
    h.handle.handleDirective({
      type: 'addon.channel.reply',
      addonId: ADDON_ID,
      generation: 1,
      requestId: (outbound as { requestId: string }).requestId,
      outcome: { ok: true, result: 'late' },
    })
    expect(h.handle.stats().counters.lateChannelRepliesDropped).toBe(1)
    expect(results).toEqual([{ ok: false, reason: 'timeout' }])
  })

  it('旧代次回执不得接入新代次：代次不符即丢弃', async () => {
    const h = harness()
    const results: Array<unknown> = []
    registerFactory(h, (sdk) => {
      void sdk.channel.request('probe.ping', {}).then((outcome) => results.push(outcome))
    })
    await h.handle.load(manifest({ generation: 1 }))
    const outbound = h.sent.find((message) => message.type === 'addon.channel.request')
    expect(outbound?.type).toBe('addon.channel.request')
    h.handle.handleDirective({
      type: 'addon.channel.reply',
      addonId: ADDON_ID,
      generation: 9,
      requestId: (outbound as { requestId: string }).requestId,
      outcome: { ok: true, result: 'wrong-generation' },
    })
    expect(results).toEqual([])
    expect(h.handle.stats().counters.lateChannelRepliesDropped).toBe(1)
  })
})

describe('T02 生产装载器：真实 CM6 扩展接入与释放', () => {
  it('registerExtension 经装配槽挂载真实 StateField；卸载后摘除且文档不变', async () => {
    const sent: AddonPageOutbound[] = []
    const registrations: AddonPageRegistration[] = []
    ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
    const slot = new Compartment()
    const view = new EditorView({
      state: EditorState.create({ doc: 'hello', extensions: [slot.of([])] }),
      parent: document.body,
    })
    const myField: StateFieldType<number> = StateField.define<number>({ create: () => 7, update: (value) => value })
    const results: Array<unknown> = []
    const disposals: string[] = []
    const handle = installAddonPageLoader({
      page: 'editor',
      cm6,
      attachExtensions: (extension) => view.dispatch({ effects: slot.reconfigure(extension ?? []) }),
      send: (message) => sent.push(message),
      // 脚本执行发生在装载期间：注入的 loadScript 内推登记（时间序与真实
      // IIFE 一致——registeredAt 不早于 loadStartedAt）
      loadScript: () => {
        registrations.push({
          addonId: ADDON_ID,
          registeredAt: Date.now(),
          factory: (sdk) => {
            expect(sdk.registerExtension([myField])).toBe(true)
            void sdk.channel.request('probe.hold', {}).then((outcome) => results.push(outcome))
            sdk.onDispose(() => disposals.push('cleanup'))
          },
        })
        return Promise.resolve({ ok: true })
      },
      loadCss: () => Promise.resolve('authorized'),
      now: () => Date.now(),
      scheduleTimeout: () => ({ cancel: () => {} }),
    })
    expect(await handle.load(manifest())).toEqual({ ok: true, css: [] })
    // 真实扩展接入：生产 EditorView 上 field 可读，文档保持
    expect(view.state.field(myField, false)).toBe(7)
    expect(view.state.doc.toString()).toBe('hello')

    const outcome = await handle.unload(ADDON_ID, 1)
    expect(outcome).toEqual({ ok: true })
    expect(disposals).toEqual(['cleanup'])
    // 扩展已摘除（field 不可读）且文档未被释放扰动
    expect(view.state.field(myField, false)).toBeUndefined()
    expect(view.state.doc.toString()).toBe('hello')
    // 挂起请求以 released 终结
    await settle()
    expect(results).toEqual([{ ok: false, reason: 'released' }])
    view.destroy()
  })
})

describe('评审：多组件扩展槽聚合与独立释放', () => {
  it('两个组件 registerExtension 并存；单个释放只摘自身段、全部释放清空', async () => {
    const h = harness()
    const markerA: StateFieldType<number> = StateField.define<number>({ create: () => 1, update: (v) => v })
    const markerB: StateFieldType<number> = StateField.define<number>({ create: () => 2, update: (v) => v })
    // 时序对齐生产：登记随各自 load 的脚本装载发生（一次装载只接入一个
    // 工厂、同批多余登记丢弃——B 的登记必须在 A 装载落定后才入桶）
    registerFactory(
      h,
      (sdk) => {
        expect(sdk.registerExtension([markerA])).toBe(true)
      },
      'addon.a',
    )
    await h.handle.load(manifest({ addonId: 'addon.a', generation: 1 }))
    registerFactory(
      h,
      (sdk) => {
        expect(sdk.registerExtension([markerB])).toBe(true)
      },
      'addon.b',
    )
    await h.handle.load(manifest({ addonId: 'addon.b', generation: 1 }))
    // 聚合下发：后注册组件触发的是全部活跃装载的拼接，不覆盖先注册者
    expect(h.attached.length).toBe(2)
    expect(h.attached[0]).toHaveLength(1)
    expect(h.attached[1]).toHaveLength(2)
    // 释放 B 只摘 B 段：重发聚合只剩 A 的扩展
    await h.handle.unload('addon.b', 1)
    expect(h.attached.at(-1)).toHaveLength(1)
    // 再释放 A：聚合为空（不再以 null 清掉其余组件的扩展）
    await h.handle.unload('addon.a', 1)
    expect(h.attached.at(-1)).toHaveLength(0)
  })
})

describe('T02 生产装载器：释放矩阵其余路径', () => {
  it('故障指令释放：回调执行、历史记为 faulted、扩展槽摘除、旧请求 released', async () => {
    const h = harness()
    const disposals: string[] = []
    const results: Array<unknown> = []
    registerFactory(h, (sdk) => {
      expect(sdk.registerExtension([])).toBe(true)
      void sdk.channel.request('probe.hold', {}).then((outcome) => results.push(outcome))
      sdk.onDispose(() => disposals.push('cleanup'))
    })
    await h.handle.load(manifest())
    h.handle.handleDirective({ type: 'addon.fault', addonId: ADDON_ID, generation: 1, reason: 'attributable' })
    expect(disposals).toEqual(['cleanup'])
    await settle()
    expect(results).toEqual([{ ok: false, reason: 'released' }])
    expect(h.handle.stats().history.at(-1)).toMatchObject({ ended: 'faulted', reason: 'attributable', disposals: 1 })
    // 聚合语义：释放重发剩余活跃装载（此处无其余组件 = 空数组），不再发 null
    expect(h.attached.at(-1)).toEqual([])
    expect(h.sent.some((message) => message.type === 'addon.faulted')).toBe(true)
  })

  it('旧代次故障指令不生效：装载保持原状', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest({ generation: 3 }))
    h.handle.handleDirective({ type: 'addon.fault', addonId: ADDON_ID, generation: 2 })
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 3 }])
  })

  it('手动恢复：卸载后新代次重新装载同一入口成功（工厂重新执行）', async () => {
    const h = harness()
    let runs = 0
    registerFactory(h, () => {
      runs++
    })
    await h.handle.load(manifest({ generation: 1 }))
    await h.handle.unload(ADDON_ID, 1)
    registerFactory(h, () => {
      runs++
    })
    const outcome = await h.handle.load(manifest({ generation: 2 }))
    expect(outcome.ok).toBe(true)
    expect(runs).toBe(2)
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
  })

  it('已释放代次的迟到 onDispose 立即执行（重复释放无害），能力面退化为拒绝', async () => {
    const h = harness()
    let captured: VsidianAddonPageSdk | undefined
    registerFactory(h, (sdk) => {
      captured = sdk
    })
    await h.handle.load(manifest())
    await h.handle.unload(ADDON_ID, 1)
    const ran: string[] = []
    captured!.onDispose(() => ran.push('late'))
    expect(ran).toEqual(['late'])
    expect(await captured!.channel.request('any', {})).toEqual({ ok: false, reason: 'released' })
    expect(captured!.mountRoot()).toBeNull()
    expect(captured!.registerExtension([])).toBe(false)
    expect(h.handle.stats().counters.releasedChannelRequests).toBe(1)
  })

  it('重复卸载同一代次 → not-loaded（幂等无害）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    expect(await h.handle.unload(ADDON_ID, 1)).toEqual({ ok: true })
    expect(await h.handle.unload(ADDON_ID, 1)).toEqual({ ok: false, reason: 'not-loaded' })
  })
})

describe('T02 生产装载器：设置页与资源地址', () => {
  it('设置页：mountRoot 在容器内创建、卸载后从 DOM 移除、cm6 不注入', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = harness({ page: 'settings', mountContainer: container, cm6: undefined, attachExtensions: undefined })
    let root: HTMLElement | null | undefined
    registerFactory(h, (sdk) => {
      expect(sdk.experimental.cm6).toBeUndefined()
      root = sdk.mountRoot()
    })
    await h.handle.load(manifest({ page: 'settings' }))
    expect(root).toBeTruthy()
    expect(container.contains(root!)).toBe(true)
    expect((root as HTMLElement).dataset.addonId).toBe(ADDON_ID)
    await h.handle.unload(ADDON_ID, 1)
    expect(container.contains(root!)).toBe(false)
    expect(h.handle.stats().cm6Shared).toBe(false)
  })

  it('编辑器页 mountRoot 为 null', async () => {
    const h = harness()
    let root: HTMLElement | null | undefined
    registerFactory(h, (sdk) => {
      root = sdk.mountRoot()
    })
    await h.handle.load(manifest())
    expect(root).toBeNull()
  })

  it('resourceUri：基址拼接 + 越界/协议/绝对路径拒绝 + 无基址为 null', async () => {
    const h = harness()
    let uri: string | null | undefined
    let bad: Array<string | null> = []
    registerFactory(h, (sdk) => {
      uri = sdk.resourceUri('assets/logo.png')
      bad = [
        sdk.resourceUri('../secret.txt'),
        sdk.resourceUri('/etc/passwd'),
        sdk.resourceUri('https://evil.test/x.js'),
        sdk.resourceUri(''),
      ]
    })
    await h.handle.load(manifest({ resourceBase: 'https://page.test/addon-dist' }))
    expect(uri).toBe('https://page.test/addon-dist/assets/logo.png')
    expect(bad).toEqual([null, null, null, null])
  })

  it('resourceUri 无基址 → null', async () => {
    const h = harness()
    let none: string | null | undefined
    registerFactory(h, (sdk) => {
      none = sdk.resourceUri('a.png')
    })
    await h.handle.load(manifest())
    expect(none).toBeNull()
  })

  it('通道回执正常送达请求发起方', async () => {
    const h = harness()
    const results: Array<unknown> = []
    registerFactory(h, (sdk) => {
      void sdk.channel.request('addon.ready', { page: 'editor' }).then((outcome) => results.push(outcome))
    })
    await h.handle.load(manifest())
    const outbound = h.sent.find((message) => message.type === 'addon.channel.request')
    expect(outbound?.type).toBe('addon.channel.request')
    h.handle.handleDirective({
      type: 'addon.channel.reply',
      addonId: ADDON_ID,
      generation: 1,
      requestId: (outbound as { requestId: string }).requestId,
      outcome: { ok: true, result: { echoed: true } },
    })
    await settle()
    expect(results).toEqual([{ ok: true, result: { echoed: true } }])
  })
})
