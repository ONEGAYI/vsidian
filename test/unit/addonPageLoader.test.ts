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
import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { AddonBehaviorRuntime } from '../../src/webview/addonBehaviors'
import { AddonCommandsRuntime } from '../../src/webview/addonCommands'
import { AddonUiRuntime } from '../../src/webview/addonUi'
import { installAddonRenderersBridge } from '../../src/webview/addonRenderers'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderEnv,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { AddonRendererRegistration } from '../../src/shared/addonRenderers'
import type {
  AddonCm6Runtime,
  AddonLoadManifest,
  AddonPageKind,
  AddonPageOutbound,
  AddonPageRegistration,
  VsidianAddonPageSdk,
} from '../../src/shared/addonPage'

/** 测试用共享 CM6 运行时：直接引用页面 bundle 内同一份模块命名空间
 *  （单元测试进程内 import 即「本页运行时」） */
const cm6: AddonCm6Runtime = {
  state: await import('@codemirror/state'),
  view: await import('@codemirror/view'),
  language: { syntaxTree, ensureSyntaxTree, syntaxTreeAvailable },
}

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

  it('#406 cm6.language 语法树子集：工厂收到与页面注入同一批函数且可调用', async () => {
    const h = harness()
    let received: VsidianAddonPageSdk | undefined
    registerFactory(h, (sdk) => {
      received = sdk
    })
    await h.handle.load(manifest())
    const lang = received?.experimental.cm6?.language
    expect(lang?.syntaxTree).toBe(syntaxTree)
    expect(lang?.ensureSyntaxTree).toBe(ensureSyntaxTree)
    expect(lang?.syntaxTreeAvailable).toBe(syntaxTreeAvailable)
    // 无语言配置的状态上同步读取不抛错（证明函数身份真实可执行）
    expect(typeof lang?.syntaxTree?.(EditorState.create())).toBe('object')
    expect(lang?.syntaxTreeAvailable?.(EditorState.create())).toBe(false)
  })

  it('同一接入代次重复装载 → already-loaded（对齐设计的 AlreadyRegistered 语义）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest())
    const second = await h.handle.load(manifest())
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

describe('评审：装载器 history 留痕上限', () => {
  it('history 终结留痕有环形上限：反复装载失败不无界增长（评审 R8）', async () => {
    const h = harness()
    // 不登记任何工厂：每次 load 直接失败留痕（no-factory-registered）
    for (let i = 0; i < 205; i++) {
      await h.handle.load(manifest({ generation: i + 1 }))
    }
    const history = h.handle.stats().history
    expect(history.length).toBe(200)
    expect(history.at(-1)).toMatchObject({ ended: 'load-failed', reason: 'no-factory-registered', generation: 205 })
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

describe('#395 P3 装载并发串行化（按 addonId 在途链）', () => {
  const CSS_URI = 'https://page.test/addon.css'
  const headLinks = (uri: string) => document.head.querySelectorAll(`link[href="${uri}"]`)

  it('gen1 在途时 unload(gen1)+load(gen2) 按宿主指令序生效：后代次落 active、前代次资源回收', async () => {
    let loadScriptImpl: (uri: string) => Promise<{ ok: true }> = async () => ({ ok: true })
    const h = harness({ loadCss: undefined, loadScript: (uri) => loadScriptImpl(uri) })
    let releaseGen1!: () => void
    const gen1Gate = new Promise<void>((r) => { releaseGen1 = r })
    let call = 0
    loadScriptImpl = async () => {
      const index = call++
      if (index === 0) await gen1Gate
      registerFactory(h, () => {})
      return { ok: true }
    }
    const p1 = h.handle.load(manifest({ generation: 1, cssUris: [CSS_URI] }))
    const pUnload = h.handle.unload(ADDON_ID, 1)
    const p2 = h.handle.load(manifest({ generation: 2 }))
    await vi.waitFor(() => {
      if (headLinks(CSS_URI).length === 0) throw new Error('link 未入 head')
    })
    headLinks(CSS_URI).forEach((link) => link.dispatchEvent(new window.Event('load')))
    releaseGen1()
    const outcome1 = await p1
    const unloadOutcome = await pUnload
    const outcome2 = await p2
    expect(outcome1.ok).toBe(true)
    // unload 排在 gen1 落地之后执行：真实释放 gen1（现状并发下先到即返回 not-loaded）
    expect(unloadOutcome).toMatchObject({ ok: true })
    expect(outcome2.ok).toBe(true)
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
    // gen1 的授权样式随释放撤下——无孤儿 link
    expect(headLinks(CSS_URI).length).toBe(0)
  })

  it('并发双 load（宿主未发 unload）：终态唯一——后到新代次换代生效、先到代次完整释放、无孤儿样式', async () => {
    let loadScriptImpl: (uri: string) => Promise<{ ok: true }> = async () => ({ ok: true })
    const h = harness({ loadCss: undefined, loadScript: (uri) => loadScriptImpl(uri) })
    let releaseGen1!: () => void
    const gen1Gate = new Promise<void>((r) => { releaseGen1 = r })
    let call = 0
    loadScriptImpl = async () => {
      const index = call++
      if (index === 0) await gen1Gate
      registerFactory(h, () => {})
      return { ok: true }
    }
    const p1 = h.handle.load(manifest({ generation: 1, cssUris: [CSS_URI] }))
    const p2 = h.handle.load(manifest({ generation: 2, cssUris: [CSS_URI] }))
    await settle()
    headLinks(CSS_URI).forEach((link) => link.dispatchEvent(new window.Event('load')))
    await settle()
    releaseGen1()
    await settle()
    // g1 落地后被 g2 换代释放（link 撤下），g2 挂上新 link——派发其 onload
    headLinks(CSS_URI).forEach((link) => link.dispatchEvent(new window.Event('load')))
    const outcome1 = await p1
    const outcome2 = await p2
    expect(outcome1.ok).toBe(true)
    // 后到新代次是换代指令（#395 回归修订：宿主恢复连推 g1→g2 实证）——
    // 串行链上 g1 落地后 g2 释放旧代次再装载，终态 g2
    expect(outcome2.ok).toBe(true)
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
    expect(h.handle.stats().history.some((e) => e.generation === 1 && e.ended === 'released')).toBe(true)
    // gen1 的 link 随换代释放撤下，gen2 装载重挂：head 只留一条（终态无孤儿）
    expect(headLinks(CSS_URI).length).toBe(1)
  })
})

describe('#395 P3 registerExtension 守卫按记录身份（旧代次句柄拒绝）', () => {
  it('已释放代次的迟到 registerExtension 返回 false，不重发聚合；新代次句柄照常 true', async () => {
    const h = harness()
    const sdks: VsidianAddonPageSdk[] = []
    registerFactory(h, (sdk) => { sdks.push(sdk) })
    await h.handle.load(manifest({ generation: 1 }))
    await h.handle.unload(ADDON_ID, 1)
    registerFactory(h, (sdk) => { sdks.push(sdk) })
    await h.handle.load(manifest({ generation: 2 }))
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
    const attachedCount = h.attached.length
    // gen1 已释放、gen2 在场：旧句柄调用不得因 active.has(addonId) 误放行
    expect(sdks[0]!.registerExtension(StateField.define<never>({ create: () => null as never, update: (value) => value }))).toBe(false)
    expect(h.attached.length).toBe(attachedCount)
    expect(sdks[1]!.registerExtension(StateField.define<never>({ create: () => null as never, update: (value) => value }))).toBe(true)
    expect(h.attached.length).toBe(attachedCount + 1)
  })
})

describe('#395 P3 追加：SDK 守卫记录身份统一收紧（旧代次句柄全面拒绝）', () => {
  /** 双代次装配：装载 gen1 存句柄 → 释放 → 装载 gen2 存句柄。旧句柄的
   *  迟到调用在同组件新代次在场时不得因 addonId 在场而放行（记录身份
   *  比对——项 6 registerExtension 的同款契约扩展到全部 SDK 面） */
  async function twoGenerations(opts: { page?: AddonPageKind; overrides?: Partial<AddonPageLoaderEnv> } = {}) {
    const page = opts.page ?? 'editor'
    const h = harness({ page, ...opts.overrides })
    const sdks: VsidianAddonPageSdk[] = []
    const onFactory = (sdk: VsidianAddonPageSdk) => {
      sdks.push(sdk)
      if (page === 'settings') sdk.mountRoot()
    }
    registerFactory(h, onFactory)
    await h.handle.load(manifest({ generation: 1, page }))
    await h.handle.unload(ADDON_ID, 1)
    registerFactory(h, onFactory)
    await h.handle.load(manifest({ generation: 2, page }))
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
    return { h, oldSdk: sdks[0]!, newSdk: sdks[1]! }
  }

  const rendererSpec = (rendererId: string): AddonRendererRegistration => ({
    rendererId,
    label: `提供者 ${rendererId}`,
    languages: ['mermaid'],
    modes: ['live', 'reading'],
    exportFormats: [],
    mount: () => {},
  })

  it('重点穿越·commands：旧代次注册不进下游注册表（真 runtime），新代次照常可执行', async () => {
    const commands = new AddonCommandsRuntime({ report: () => {} })
    const { oldSdk, newSdk } = await twoGenerations({ overrides: { addonCommands: commands } })
    const late = oldSdk.commands!.register({ id: 'late', title: '迟到命令', mode: 'live' }, () => {})
    expect(late).toMatchObject({ ok: false, reason: 'released' })
    // 下游注册表无迟到命令（不可执行）——穿越不得作用于新代次
    expect(commands.execute(`${ADDON_ID}.late`)).toBe('unknown')
    const fresh = newSdk.commands!.register({ id: 'fresh', title: '新代次命令', mode: 'live' }, () => {})
    expect(fresh.ok).toBe(true)
    expect(commands.execute(`${ADDON_ID}.fresh`)).toBe('executed')
  })

  it('重点穿越·renderers：旧代次注册不覆盖新代次候选（真桥下游）', async () => {
    const bridge = installAddonRenderersBridge(() => {})
    const { oldSdk, newSdk } = await twoGenerations({ overrides: { addonRenderers: bridge } })
    newSdk.renderers!.register(rendererSpec('fresh-r'))
    const late = oldSdk.renderers!.register(rendererSpec('late-r'))
    expect(late.dispose).toBeTypeOf('function')
    // 旧代次迟到注册不得顶掉当前代次候选（现状 generationEntry 会整体覆盖）
    expect(bridge.localProvidersOf(ADDON_ID).map((p) => p.rendererId)).toEqual(['fresh-r'])
  })

  it('其余面·behaviors/menus/ui/channel：旧代次调用被拒且下游无副作用，新代次照常', async () => {
    const behaviors = new AddonBehaviorRuntime({
      snapshotOf: () => ({ ok: false, reason: 'view-disposed' }),
      applyEdit: async () => ({ ok: false, reason: 'view-disposed' }),
      log: () => {},
      docUriOf: () => 'file:///vault/note.md',
    })
    const ui = new AddonUiRuntime({
      toolbarSlot: document.createElement('div'),
      panelDock: document.createElement('div'),
      currentMode: () => 'live',
      activeInstanceId: () => 'main',
      executeCommand: () => true,
      bindingHints: () => [],
      panelCloseLabel: () => '关闭',
    })
    // menus 面与 commands 同源装配（env.addonCommands 在场才有 sdk.menus）
    const commands = new AddonCommandsRuntime({ report: () => {} })
    const { h, oldSdk, newSdk } = await twoGenerations({
      overrides: { addonBehaviors: behaviors, addonUi: ui, addonCommands: commands },
    })
    // behaviors：迟到注册被拒、下游注册表无条目
    expect(oldSdk.behaviors!.register({ id: 'late', name: '迟到行为', onInput: () => null }))
      .toEqual({ ok: false, reason: 'released' })
    expect(behaviors.stats().registrations).toHaveLength(0)
    expect(newSdk.behaviors!.register({ id: 'fresh', name: '新行为', onInput: () => null }).ok).toBe(true)
    expect(behaviors.stats().registrations).toHaveLength(1)
    // menus：迟到注册被拒
    expect(oldSdk.menus!.registerItem({ id: 'late-menu', label: '迟到' }).ok).toBe(false)
    expect(newSdk.menus!.registerItem({ id: 'fresh-menu', label: '新代次' }).ok).toBe(true)
    // ui：按钮与面板迟到注册被拒
    expect(oldSdk.ui!.registerButton({ id: 'late-btn', label: '迟到' }, () => {}).ok).toBe(false)
    expect(oldSdk.ui!.registerPanel({ id: 'late-panel', title: '迟到', mount: () => {} }).ok).toBe(false)
    expect(newSdk.ui!.registerButton({ id: 'fresh-btn', label: '新代次' }, () => {}).ok).toBe(true)
    // channel：迟到请求以 released 终结且不发出请求消息
    const sentBefore = h.sent.length
    await expect(oldSdk.channel.request('late.topic', {})).resolves.toEqual({ ok: false, reason: 'released' })
    expect(h.sent.length).toBe(sentBefore)
    // 新代次请求照常发出（结局经 30s 超时/回执——既有用例覆盖，此处只钉发出）
    const sentWithLate = h.sent.length
    void newSdk.channel.request('fresh.topic', {})
    expect(h.sent.length).toBe(sentWithLate + 1)
    expect(h.sent.at(-1)).toMatchObject({ type: 'addon.channel.request', topic: 'fresh.topic' })
  })

  it('其余面·onDispose：旧代次迟到登记立即执行清理（不滞留已脱离 active 的记录）', async () => {
    const { h, oldSdk, newSdk } = await twoGenerations()
    let lateDisposed = false
    oldSdk.onDispose(() => { lateDisposed = true })
    expect(lateDisposed).toBe(true)
    let freshDisposed = false
    newSdk.onDispose(() => { freshDisposed = true })
    expect(freshDisposed).toBe(false)
    await h.handle.unload(ADDON_ID, 2)
    expect(freshDisposed).toBe(true)
  })

  it('设置页：旧代次 mountRoot 不再挂载新根，新代次照常', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    try {
      const { oldSdk } = await twoGenerations({ page: 'settings', overrides: { mountContainer: container } })
      expect(oldSdk.mountRoot()).toBeNull()
      // 容器内只有 gen2 factory 挂载的 1 个根（现状旧句柄会再挂第 2 个）
      expect(container.childElementCount).toBe(1)
    } finally {
      container.remove()
    }
  })
})

describe('#395 回归钉住：换代 load 指令按最新代次落地（宿主恢复连推 g1/g2）', () => {
  /** 场景还原（T09 集成实证）：宿主恢复（setEnabled→notify 先推旧代次
   *  load，enable 完成递增代次后再推新代次 load）会产生 g1→g2 连推。
   *  串行链按到达序执行后 g1 落地、g2 撞 already-loaded——页面停在旧
   *  代次，宿主权威代次失配、候选上报全被拒收，恢复失效。页面侧正确
   *  语义：不同代次的 load 是换代指令——先释放在场旧代次再装载新代次
   *  （宿主最新代次为准）；同代次重复 load 维持 already-loaded 幂等。 */
  it('unload(g1) → load(g1) → load(g2)：g1 释放留痕、g2 装载成功', async () => {
    const h = harness()
    const factories: number[] = []
    const onFactory = () => factories.push(factories.length)
    registerFactory(h, onFactory)
    await h.handle.load(manifest({ generation: 1 }))
    await h.handle.unload(ADDON_ID, 1)
    registerFactory(h, onFactory)
    const first = await h.handle.load(manifest({ generation: 1 }))
    expect(first.ok).toBe(true)
    registerFactory(h, onFactory)
    const second = await h.handle.load(manifest({ generation: 2 }))
    expect(second.ok).toBe(true)
    expect(factories).toHaveLength(3)
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 2 }])
    const history = h.handle.stats().history
    expect(history.some((e) => e.generation === 1 && e.ended === 'released')).toBe(true)
  })

  it('同代次重复 load 仍 already-loaded（幂等语义不变）', async () => {
    const h = harness()
    registerFactory(h, () => {})
    await h.handle.load(manifest({ generation: 1 }))
    const dup = await h.handle.load(manifest({ generation: 1 }))
    expect(dup).toMatchObject({ ok: false, reason: 'already-loaded' })
    expect(h.handle.stats().active).toEqual([{ addonId: ADDON_ID, generation: 1 }])
  })
})
