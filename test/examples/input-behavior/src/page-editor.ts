// #364 T15 输入样例——编辑器页源码（经 SDK 构建桥打成 chrome114 IIFE）。
//
// 借鉴 Easy Typing 的三个明确场景（不承诺完整移植），经公开 behaviors 面
// 注册可组合输入行为：
// - cjk-latin-space：中英文之间自动空格（atomic——默认原子提交，显式
//   声明示范字段写法；撤销一笔只回退本次修饰）；
// - cjk-fullwidth-punct：中文后半角标点全角化（缺省 atomic——不写
//   history 字段即原子，示范缺省路径）；
// - paren-close：括号自动补全（joinPrevious——声明非原子，随键入 ( 的
//   原子操作一起撤回：Ctrl+Z 一次回退「()」整体，Q29 撤回边界展示）。
//
// 行为顺序（T08）：默认序按完整键字典序 fullwidth-punct → latin-space →
// paren-close 依次执行，后续行为读取前序修饰结果；用户可在 Vsidian 设置
// 页逐项关闭或调序（平台持久层，键 = 组件 ID + 局部 ID）。
//
// 设置联动：行为读组件自身设置（smartSpace/smartParen/fullwidthPunct，
// 经 setup 通道 input.getSettings），behabiors.onChanged（只读观察——每次
// 输入触发）顺带刷新缓存：设置页改开关后下一次输入即按新值判定。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonBehaviorInputPlan, AddonInputContext } from '../../../../src/shared/addonBehaviors'
import { pickMessages } from './i18n'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-example.input-behavior'

/** CJK 字符判定（汉字 + CJK 标点 + 全角形式；不含半角假名等） */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF01-\uFF60]/
/** 拉丁字母/数字（触发自动空格的右侧字符） */
const LATIN_CHAR = /^[A-Za-z0-9]$/
/** 半角标点 → 全角标点映射（中文语境转换表） */
const FULLWIDTH_MAP: Record<string, string> = {
  ',': '，',
  '.': '。',
  ';': '；',
  ':': '：',
  '!': '！',
  '?': '？',
}

/** 组件设置缓存（宿主不可达时回退默认值——行为不因通道故障失效加码） */
interface InputSettings {
  readonly smartSpace: boolean
  readonly smartParen: boolean
  readonly fullwidthPunct: boolean
}

const DEFAULT_SETTINGS: InputSettings = { smartSpace: true, smartParen: true, fullwidthPunct: true }

defineAddonPage(ADDON_ID, async (sdk: VsidianAddonPageSdk) => {
  const behaviors = sdk.behaviors
  if (!behaviors) {
    throw new Error('editor page SDK must expose behaviors facet')
  }
  const m = pickMessages(navigator.language)

  // 放行门控（宿主 VSIDIAN_TEST_HOOKS 判据的页面侧读取）：未放行时本页
  // 装载保持惰性（零行为注册——共享测试会话不毒化其他用例；arm 后新开
  // 面板装载时重新询问）
  const permission = await sdk.channel.request('input.allowed', null)
  const allowed = permission.ok === true &&
    (permission.result as { allowed?: unknown } | null)?.allowed === true
  if (!allowed) {
    return
  }

  /** 设置缓存与刷新（onChanged 每次输入时顺带拉取——设置页改开关下次输入生效） */
  let settings: InputSettings = DEFAULT_SETTINGS
  const refreshSettings = async (): Promise<void> => {
    const outcome = await sdk.channel.request('input.getSettings', null)
    if (outcome.ok !== true || typeof outcome.result !== 'object' || outcome.result === null) {
      return
    }
    const values = outcome.result as Record<string, unknown>
    settings = {
      smartSpace: values['smartSpace'] !== false,
      smartParen: values['smartParen'] !== false,
      fullwidthPunct: values['fullwidthPunct'] !== false,
    }
  }
  await refreshSettings()

  /** 上报事件（fire-and-forget：webview 销毁时请求以 released 终结即可） */
  const report = (event: Record<string, unknown>): void => {
    void sdk.channel.request('input.event', event).then(() => {}, () => {})
  }

  /** 主选区光标（快照 head） */
  const cursorOf = (ctx: AddonInputContext): number => ctx.snapshot.selections[0]?.head ?? 0

  // ---- 行为 1：中英文之间自动空格（atomic——显式声明） ----
  const smartSpace = behaviors.register({
    id: 'cjk-latin-space',
    name: m.behaviorSmartSpace,
    description: m.descSmartSpace,
    examples: ['中文a → 中文 a'],
    history: 'atomic',
    onInput: (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
      if (!settings.smartSpace || !LATIN_CHAR.test(ctx.inputText)) {
        return null
      }
      const head = cursorOf(ctx)
      if (head === 0) {
        return null
      }
      // 快照已含本次输入：…中a| → 在「中」与「a」之间插空格，光标随之后移
      if (!CJK_CHAR.test(ctx.snapshot.text[head - 1])) {
        return null
      }
      return {
        changes: [{ offset: head - 1, length: 0, text: ' ' }],
        selection: { anchor: head + 1, head: head + 1 },
      }
    },
  })

  // ---- 行为 2：中文后半角标点全角化（缺省 atomic——不写 history 字段） ----
  const fullwidthPunct = behaviors.register({
    id: 'cjk-fullwidth-punct',
    name: m.behaviorFullwidthPunct,
    description: m.descFullwidthPunct,
    examples: ['中文, → 中文，'],
    onInput: (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
      const fullwidth = FULLWIDTH_MAP[ctx.inputText]
      if (!settings.fullwidthPunct || fullwidth === undefined) {
        return null
      }
      const head = cursorOf(ctx)
      if (head === 0 || !CJK_CHAR.test(ctx.snapshot.text[head - 1])) {
        return null
      }
      // 替换刚输入的半角标点（长度 1 → 1），光标原位
      return {
        changes: [{ offset: head - 1, length: 1, text: fullwidth }],
        selection: { anchor: head, head },
      }
    },
  })

  // ---- 行为 3：括号自动补全（joinPrevious——声明非原子） ----
  const smartParen = behaviors.register({
    id: 'paren-close',
    name: m.behaviorSmartParen,
    description: m.descSmartParen,
    examples: ['( → () 光标居中'],
    history: 'joinPrevious',
    onInput: (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
      if (!settings.smartParen || ctx.inputText !== '(') {
        return null
      }
      const head = cursorOf(ctx)
      // 快照 …(|：光标后补出右括号，选区保持（光标停在括号中间）
      return {
        changes: [{ offset: head, length: 0, text: ')' }],
        selection: { anchor: head, head },
      }
    },
  })

  // 只读观察（通知分离面）：每次输入刷新设置缓存（设置页开关下次输入生效）
  behaviors.onChanged(() => {
    void refreshSettings()
  })

  report({
    kind: 'registered',
    results: {
      smartSpace: { ok: smartSpace.ok, ...(smartSpace.ok ? { key: smartSpace.key } : { reason: smartSpace.reason }) },
      fullwidthPunct: { ok: fullwidthPunct.ok, ...(fullwidthPunct.ok ? { key: fullwidthPunct.key } : { reason: fullwidthPunct.reason }) },
      smartParen: { ok: smartParen.ok, ...(smartParen.ok ? { key: smartParen.key } : { reason: smartParen.reason }) },
    },
  })

  sdk.onDispose(() => {
    // 释放语义由装载器驱动（unregisterAddon）；页面侧无需自清
  })
})
