// T07（#356）可组合输入行为——共享层契约测试：注册形状守卫、默认序与
// 持久覆盖合并、逐项开关、存储格式解析。事实源 src/shared/addonBehaviors.ts。
//
// 契约口径（票面 + ADR-0012 Q27 修订 + 技术方案 §5.2/§7）：
// - 名称必填：缺失/空白拒绝；说明与例子缺失允许。
// - 行为完整键 = 组件 ID + 局部 ID（存储定位用，不以显示名为键）。
// - 默认序按稳定 ID（完整键字典序）；用户覆盖只重排已列出项，未列出的
//   注册项按默认序追加在尾部（新项加入不破坏已有相对次序）。
// - 关闭集合以完整 ID 定位：不在关闭集合 = 开启（新注册项默认开启，
//   不重新开启用户已关闭的项——关闭记录跨重启保留）。
// - 存储未知项保留（注册清单里没有的键不从存储剔除——展示状态而非
//   丢配置）；坏形态回空不写回。
//
// T08（#357）追加：管理 UI 的展示全序（关闭项保位呈现）、调序落库的
// 未知项保留合并（整组件停用期间的调序不丢该组件行为的位置配置）与
// 上报载荷的序列化形态守卫（addonBehaviorInfoOf 产物经 webview → 宿主
// 通道回灌时的信任边界）。
import { describe, expect, it } from 'vitest'
import {
  BEHAVIOR_LOCAL_ID_LIMIT,
  BEHAVIOR_NAME_LOCALES_LIMIT,
  addonBehaviorFullKey,
  addonBehaviorInfoOf,
  isAddonBehaviorRegistration,
  mergeBehaviorOrderPreservingUnknown,
  orderedAddonBehaviorKeys,
  isAddonBehaviorInfo,
  parseAddonBehaviorStateStore,
  resolveAddonBehaviorName,
  resolveAddonBehaviorOrder,
} from '../../src/shared/addonBehaviors'

function validRegistration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bracket-close',
    name: '括号补全',
    onInput: () => null,
    ...overrides,
  }
}

describe('T07 行为注册形状守卫', () => {
  it('接受最小注册（仅 id/name/onInput）——说明与例子缺失允许', () => {
    expect(isAddonBehaviorRegistration(validRegistration())).toBe(true)
  })

  it('接受完整注册（说明、例子、独占组、撤回声明）', () => {
    expect(isAddonBehaviorRegistration(validRegistration({
      description: '输入 ( 后补全 )',
      examples: ['(|)'],
      exclusiveGroup: 'space-fill',
      history: 'joinPrevious',
    }))).toBe(true)
  })

  it('名称缺失、非字符串或空白拒绝（票面：必填名称）', () => {
    for (const name of [undefined, '', '   ', 42, null]) {
      expect(isAddonBehaviorRegistration(validRegistration({ name }))).toBe(false)
    }
  })

  it('局部 ID 非法拒绝：空白字符、非法字符、空、超限', () => {
    for (const id of ['', 'has space', '中文id', 'a#b', 'a/b', 'x'.repeat(BEHAVIOR_LOCAL_ID_LIMIT + 1)]) {
      expect(isAddonBehaviorRegistration(validRegistration({ id }))).toBe(false)
    }
  })

  it('onInput 非函数拒绝；history 非法值拒绝', () => {
    expect(isAddonBehaviorRegistration(validRegistration({ onInput: undefined }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ onInput: 'noop' }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ history: 'merge' }))).toBe(false)
  })

  it('examples 形状非法拒绝：非数组、非字符串项、项数超限', () => {
    expect(isAddonBehaviorRegistration(validRegistration({ examples: 'x' }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ examples: ['a', 1] }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ examples: Array.from({ length: 9 }, () => 'x') }))).toBe(false)
  })

  it('exclusiveGroup 与 description 非法拒绝', () => {
    expect(isAddonBehaviorRegistration(validRegistration({ exclusiveGroup: '' }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ exclusiveGroup: 'g 1' }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ description: 7 }))).toBe(false)
  })
})

describe('T07 行为完整键', () => {
  it('组件 ID 与局部 ID 以 # 连接（addonId 形态 publisher.name 无 #，无歧义）', () => {
    expect(addonBehaviorFullKey('pub.addon-a', 'bracket-close')).toBe('pub.addon-a#bracket-close')
  })
})

describe('T07 默认序与持久覆盖合并', () => {
  const keys = (suffixes: string[]) => suffixes.map((s) => `pub.a#${s}`)

  it('无用户覆盖：全部注册项按完整键字典序（默认序）且全部开启', () => {
    const registered = keys(['space-tidy', 'bracket-close', 'dash-fill'])
    expect(resolveAddonBehaviorOrder(registered, null)).toEqual(
      keys(['bracket-close', 'dash-fill', 'space-tidy']),
    )
  })

  it('用户序只重排已列出项，保持其相对次序；未列出项按默认序追加尾部', () => {
    const registered = keys(['space-tidy', 'bracket-close', 'dash-fill'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: keys(['space-tidy', 'bracket-close']), disabled: [],
    })!
    // 已知两项保用户相对序（space-tidy 在前），新项 dash-fill 追加尾部
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(
      keys(['space-tidy', 'bracket-close', 'dash-fill']),
    )
  })

  it('用户序中的未知项（已卸载）被忽略但不出现在有效序；存储本身不动', () => {
    const registered = keys(['a', 'b'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: ['pub.a#gone', ...keys(['b'])], disabled: [],
    })!
    // 用户序只列出 b：b 先（用户相对序），a 为未列出项按默认序追加
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(keys(['b', 'a']))
    expect(stored.order).toContain('pub.a#gone')
  })

  it('关闭项从有效序剔除；未关闭的新注册项默认开启', () => {
    const registered = keys(['a', 'b', 'c'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: [], disabled: keys(['b']),
    })!
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(keys(['a', 'c']))
    // 新项 d 加入：不因历史关闭记录受影响（b 仍关、d 开）
    expect(resolveAddonBehaviorOrder([...registered, ...keys(['d'])], stored)).toEqual(keys(['a', 'c', 'd']))
  })

  it('跨组件注册项同表参与全局序（组件前缀字典序即默认跨组件次序）', () => {
    const registered = ['pub.b#x', 'pub.a#z', 'pub.a#y']
    expect(resolveAddonBehaviorOrder(registered, null)).toEqual(['pub.a#y', 'pub.a#z', 'pub.b#x'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: ['pub.b#x', 'pub.a#y'], disabled: [],
    })!
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(['pub.b#x', 'pub.a#y', 'pub.a#z'])
  })
})

describe('T07 行为状态存储解析', () => {
  it('version 1 合法形态往返；order/disabled 去重', () => {
    const store = parseAddonBehaviorStateStore({
      version: 1, order: ['a#b', 'a#b'], disabled: ['c#d'],
    })!
    expect(store.order).toEqual(['a#b'])
    expect(store.disabled).toEqual(['c#d'])
  })

  it('坏形态回空：非对象、version 不符、字段类型错误', () => {
    for (const bad of [
      null, undefined, 'x', 1, [], {},
      { version: 2, order: [], disabled: [] },
      { version: 1, order: 'a#b', disabled: [] },
      { version: 1, order: [], disabled: [1] },
      { version: 1, order: [1], disabled: [] },
    ]) {
      expect(parseAddonBehaviorStateStore(bad)).toBeNull()
    }
  })

  it('字段缺省容忍（老版本升级路径：空对象按空覆盖）', () => {
    const store = parseAddonBehaviorStateStore({ version: 1 })
    expect(store).not.toBeNull()
    expect(store!.order).toEqual([])
    expect(store!.disabled).toEqual([])
  })
})

describe('T08 展示全序（关闭项保位呈现）', () => {
  const keys = (suffixes: string[]) => suffixes.map((s) => `pub.a#${s}`)

  it('关闭项保留在原位（管理列表要展示它，勾选态另呈），有效序仍剔除', () => {
    const registered = keys(['a', 'b', 'c'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: keys(['c', 'a', 'b']), disabled: keys(['a']),
    })!
    expect(orderedAddonBehaviorKeys(registered, stored)).toEqual(keys(['c', 'a', 'b']))
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(keys(['c', 'b']))
  })

  it('未列入用户序的注册项按默认序追加尾部（与有效序同口径）', () => {
    const registered = keys(['x', 'y', 'z'])
    const stored = parseAddonBehaviorStateStore({
      version: 1, order: keys(['z']), disabled: [],
    })!
    expect(orderedAddonBehaviorKeys(registered, stored)).toEqual(keys(['z', 'x', 'y']))
    expect(orderedAddonBehaviorKeys(registered, null)).toEqual(keys(['x', 'y', 'z']))
  })
})

describe('T08 调序落库的未知项保留合并', () => {
  it('可见项按新序写入；不可见键（组件停用/无面板）锚定到前一个可见键之后', () => {
    const previous = ['pub.a#x', 'pub.gone#b', 'pub.a#y', 'pub.gone#c', 'pub.a#z']
    const next = ['pub.a#y', 'pub.a#x', 'pub.a#z']
    // gone#b 原锚在 a#x 后、gone#c 原锚在 a#z 前（即 a#y 后）——新序中随锚移动
    expect(mergeBehaviorOrderPreservingUnknown(next, previous)).toEqual(
      ['pub.a#y', 'pub.gone#c', 'pub.a#x', 'pub.gone#b', 'pub.a#z'],
    )
  })

  it('首可见键之前的历史键保留在序列头部（原位在前缀）', () => {
    const previous = ['pub.gone#head', 'pub.a#x']
    expect(mergeBehaviorOrderPreservingUnknown(['pub.a#x'], previous))
      .toEqual(['pub.gone#head', 'pub.a#x'])
  })

  it('新序重复键去重；历史为空数组时原样返回；不可见键在历史中重复只保留一次', () => {
    expect(mergeBehaviorOrderPreservingUnknown(['a#x', 'a#x'], [])).toEqual(['a#x'])
    expect(mergeBehaviorOrderPreservingUnknown(['a#x', 'a#y'], ['a#y', 'a#y'])).toEqual(['a#x', 'a#y'])
    expect(mergeBehaviorOrderPreservingUnknown(['a#x'], ['g#k', 'g#k'])).toEqual(['g#k', 'a#x'])
  })

  it('组件停用期间调序不丢其位置：重新注册后回到锚定的相对位置', () => {
    // 初始用户序：a#x、gone#b（锚 a#x 后）、a#y
    const previous = ['pub.a#x', 'pub.gone#b', 'pub.a#y']
    // gone 停用后管理列表只剩 a#x/a#y，用户把 a#y 提到最前
    const merged = mergeBehaviorOrderPreservingUnknown(['pub.a#y', 'pub.a#x'], previous)
    expect(merged).toEqual(['pub.a#y', 'pub.a#x', 'pub.gone#b'])
    // gone 重新注册：resolveAddonBehaviorOrder 用户序含 gone#b（尾部追加段）
    const registered = ['pub.gone#b', 'pub.a#x', 'pub.a#y']
    const stored = parseAddonBehaviorStateStore({ version: 1, order: merged, disabled: [] })!
    expect(resolveAddonBehaviorOrder(registered, stored)).toEqual(['pub.a#y', 'pub.a#x', 'pub.gone#b'])
  })
})

describe('T08 行为信息序列化守卫（上报载荷信任边界）', () => {
  const info = {
    addonId: 'pub.a',
    id: 'bracket-close',
    name: '括号补全',
    history: 'atomic' as const,
  }

  it('接受最小信息与完整信息（addonBehaviorInfoOf 产物往返）', () => {
    expect(isAddonBehaviorInfo(info)).toBe(true)
    expect(isAddonBehaviorInfo({
      ...info,
      description: '输入 ( 后补全 )',
      examples: ['(|)'],
      exclusiveGroup: 'fill',
    })).toBe(true)
  })

  it('addonId/id/name 缺失或类型错误拒绝；history 非法值拒绝', () => {
    for (const bad of [
      { ...info, addonId: '' }, { ...info, id: 1 }, { ...info, name: '' },
      { ...info, history: 'merge' as never }, { ...info, name: null as never },
    ]) {
      expect(isAddonBehaviorInfo(bad)).toBe(false)
    }
    expect(isAddonBehaviorInfo(null)).toBe(false)
    expect(isAddonBehaviorInfo('x')).toBe(false)
  })

  it('说明/例子/独占组字段非法拒绝（与注册守卫同口径）', () => {
    expect(isAddonBehaviorInfo({ ...info, description: 7 })).toBe(false)
    expect(isAddonBehaviorInfo({ ...info, examples: 'x' })).toBe(false)
    expect(isAddonBehaviorInfo({ ...info, examples: ['a', 1] })).toBe(false)
    expect(isAddonBehaviorInfo({ ...info, exclusiveGroup: 'g 1' })).toBe(false)
  })
})

describe('#464 行为名多语言形态：守卫矩阵', () => {
  it('合法映射 name 注册通过（含键两侧空白与边界条数）；string 形态仍通过（历史兼容）', () => {
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { en: 'Auto pairs', 'zh-cn': '括号补全' },
    }))).toBe(true)
    // 键两侧空白合法（规整 trim 后非空即可）；单键映射合法
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { ' zh-cn ': '括号补全' },
    }))).toBe(true)
    // 条数上限边界：恰好 32 项通过
    const full = Object.fromEntries(
      Array.from({ length: BEHAVIOR_NAME_LOCALES_LIMIT }, (_, i) => [`l${i}`, `名${i}`]),
    )
    expect(isAddonBehaviorRegistration(validRegistration({ name: full }))).toBe(true)
    // string 形态不受影响
    expect(isAddonBehaviorRegistration(validRegistration({ name: '括号补全' }))).toBe(true)
  })

  it('空对象与非对象形态拒绝（数组、数字、null 都不是合法映射）', () => {
    for (const name of [{}, [], 42, null, 'x'.repeat(0)]) {
      if (name === '') {
        continue // 空串走 string 口径（既有用例覆盖）
      }
      expect(isAddonBehaviorRegistration(validRegistration({ name }))).toBe(false)
    }
  })

  it('映射条目超限拒绝（33 项 > 上限 32）', () => {
    const over = Object.fromEntries(
      Array.from({ length: BEHAVIOR_NAME_LOCALES_LIMIT + 1 }, (_, i) => [`l${i}`, `名${i}`]),
    )
    expect(isAddonBehaviorRegistration(validRegistration({ name: over }))).toBe(false)
  })

  it('键非法拒绝：trim 后空、规整后超 64 字符（64 恰好通过）', () => {
    expect(isAddonBehaviorRegistration(validRegistration({ name: { '  ': '名' } }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { ['k'.repeat(65)]: '名' },
    }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { ['k'.repeat(64)]: '名' },
    }))).toBe(true)
  })

  it('值非法拒绝（同单语言口径：非字符串、空白、超 256）', () => {
    expect(isAddonBehaviorRegistration(validRegistration({ name: { en: 42 } }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({ name: { en: '   ' } }))).toBe(false)
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { en: 'x'.repeat(257) },
    }))).toBe(false)
    // 值 256 恰好通过（与单语言同界）
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { en: 'x'.repeat(256) },
    }))).toBe(true)
  })

  it('规整后键重复拒绝（zh 与 ZH 共存产生选值歧义）', () => {
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { zh: '中', ZH: '复' },
    }))).toBe(false)
    // trim 后重复同样拒绝（'zh' 与 ' zh ' 规整同键）
    expect(isAddonBehaviorRegistration(validRegistration({
      name: { zh: '中', ' zh ': '复' },
    }))).toBe(false)
  })

  it('上报信息面同口径：合法映射通过、非法映射拒绝（protocol 两处复用本守卫）', () => {
    expect(isAddonBehaviorInfo({
      addonId: 'pub.a',
      id: 'bracket-close',
      name: { en: 'Auto pairs', 'zh-cn': '括号补全' },
      history: 'atomic',
    })).toBe(true)
    for (const badName of [{}, { zh: '中', ZH: '复' }, { '': '名' }, []]) {
      expect(isAddonBehaviorInfo({
        addonId: 'pub.a',
        id: 'bracket-close',
        name: badName,
        history: 'atomic',
      })).toBe(false)
    }
  })

  it('映射全链路透传：addonBehaviorInfoOf 不预解析（语言切换后已注册名仍可跟随）', () => {
    const name = { en: 'Auto pairs', 'zh-cn': '括号补全' }
    const info = addonBehaviorInfoOf('pub.a', {
      id: 'bracket-close',
      name,
      onInput: () => null,
    })
    expect(info.name).toEqual(name)
  })
})

describe('#464 行为名选值回落矩阵（resolveAddonBehaviorName）', () => {
  it('精确 zh-cn 命中；zh 系页面语言先试 zh-cn 再 zh 再 en', () => {
    expect(resolveAddonBehaviorName({ 'zh-cn': '中', en: '英' }, 'zh-cn')).toBe('中')
    // zh-cn 键缺失回落 zh 键
    expect(resolveAddonBehaviorName({ zh: '中', en: '英' }, 'zh-cn')).toBe('中')
    // localeLang 为 zh（zh 系）：先试 zh-cn 命中
    expect(resolveAddonBehaviorName({ 'zh-cn': '中', zh: '别', en: '英' }, 'zh')).toBe('中')
    // zh-cn/zh 都缺失回落 en
    expect(resolveAddonBehaviorName({ en: '英' }, 'zh-tw')).toBe('英')
  })

  it('非 zh 系页面语言只试 en（其余键不参与匹配——候选链是固定清单）', () => {
    expect(resolveAddonBehaviorName({ en: '英', fr: '法' }, 'en')).toBe('英')
    expect(resolveAddonBehaviorName({ en: '英', fr: '法' }, 'fr')).toBe('英')
    // 大写页面语言规整后判定（ZH 开头折 zh 系）
    expect(resolveAddonBehaviorName({ 'zh-cn': '中', en: '英' }, 'ZH-CN')).toBe('中')
  })

  it('全部候选缺失：取规整后字典序最小的键的值（非空呈现、确定性）', () => {
    expect(resolveAddonBehaviorName({ fr: '法', de: '德' }, 'zh-cn')).toBe('德')
    expect(resolveAddonBehaviorName({ fr: '法', de: '德' }, 'en')).toBe('德')
    // 规整参与排序：' DE ' 规整为 de，字典序仍小于 fr
    expect(resolveAddonBehaviorName({ fr: '法', ' DE ': '德' }, 'en')).toBe('德')
  })

  it('映射键规整命中：ZH-CN 大写键命中 zh-cn 候选；键两侧空白同样规整', () => {
    expect(resolveAddonBehaviorName({ 'ZH-CN': '中', en: '英' }, 'zh-cn')).toBe('中')
    expect(resolveAddonBehaviorName({ ' zh-cn ': '中', en: '英' }, 'zh-cn')).toBe('中')
    // 候选 zh 命中 ZH 大写键
    expect(resolveAddonBehaviorName({ ZH: '中', en: '英' }, 'zh-tw')).toBe('中')
  })

  it('纯字符串透传（单语言形态不随语言切换——历史兼容边界）', () => {
    expect(resolveAddonBehaviorName('括号补全', 'en')).toBe('括号补全')
    expect(resolveAddonBehaviorName('Auto pairs', 'zh-cn')).toBe('Auto pairs')
  })

  it('空映射返回空串（守卫外输入的防御早退——不非空断言传播 undefined）', () => {
    expect(resolveAddonBehaviorName({}, 'zh-cn')).toBe('')
    expect(resolveAddonBehaviorName({}, 'en')).toBe('')
  })

  it('空 localeLang 非 zh 系只试 en（空串不命中 zh 前缀判定）', () => {
    expect(resolveAddonBehaviorName({ 'zh-cn': '中', en: 'E' }, '')).toBe('E')
  })

  it('单键映射走兜底路径（字典序最小键即唯一键）', () => {
    expect(resolveAddonBehaviorName({ fr: '法' }, 'en')).toBe('法')
  })
})
