// #356 T07 测试组件编辑器页源码：消费公开 SDK 的 behaviors 面注册可
// 组合输入行为——集成/键盘用例的「外部测试组件经公开 API 消费」载体。
//
// 行为族（票面验收的「括号处理与空格整理」）：
// - bracket-close：键入 ( 后在输入点补 )（光标留中间）——atomic，无组
// - dash-in-parens：完整括号对内侧（左邻 ( 且右邻 )）插入 -——独占组
//   parens-fill，atomic
// - space-in-parens：同位置条件插入空格——同独占组 parens-fill（组内
//   按有效序首个适用者生效；跨组行为不受影响），joinPrevious（演示
//   非原子修饰随上次原子操作撤回——Q29 撤销粒度验收载体）
//
// 默认序（完整键字典序）：bracket-close → dash-in-parens → space-in-parens。
// 键入 ( 的默认结果：( + ) + - → (-|)；调序（space 提前）后：( |)——
// 「调整顺序导致可预期结果」。
//
// 上报协议：每个行为回调被调用与 onChanged 观察事件经通道 't07.event'
  // fire-and-forget 上报宿主收件箱（用例经 t07.collect 断言链执行与顺序）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonBehaviorInputPlan, AddonInputContext } from '../../../../src/shared/addonBehaviors'

/** 本组件声明的扩展 ID（装载器按此核对入口身份） */
const ADDON_ID = 'vsidian-test-fixture.addon-t07'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const behaviors = sdk.behaviors
  if (!behaviors) {
    throw new Error('editor page SDK must expose behaviors facet')
  }

  /** 上报事件（fire-and-forget：webview 销毁时请求以 released 终结即可） */
  const report = (event: Record<string, unknown>): void => {
    void sdk.channel.request('t07.event', event).then(() => {}, () => {})
  }

  /** 光标位置（主选区 head） */
  const cursorOf = (ctx: AddonInputContext): number => ctx.snapshot.selections[0]?.head ?? 0

  /** bracket-close：键入 ( → 在输入点补 )（右邻已是 ) 时不重复） */
  const planBracketClose = (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
    if (ctx.inputText !== '(') {
      return null
    }
    const pos = cursorOf(ctx)
    const text = ctx.snapshot.text
    if (pos < 1 || text[pos - 1] !== '(' || text[pos] === ')') {
      return null
    }
    return {
      changes: [{ offset: pos, length: 0, text: ')' }],
      selection: { anchor: pos, head: pos },
    }
  }

  /** 完整括号对内侧判定（左邻 ( 且右邻 )） */
  const insideEmptyParens = (ctx: AddonInputContext): number | null => {
    const pos = cursorOf(ctx)
    const text = ctx.snapshot.text
    if (pos < 1 || pos >= text.length) {
      return null
    }
    if (text[pos - 1] !== '(' || text[pos] !== ')') {
      return null
    }
    return pos
  }

  const planDashInParens = (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
    const pos = insideEmptyParens(ctx)
    if (pos === null) {
      return null
    }
    return {
      changes: [{ offset: pos, length: 0, text: '-' }],
      selection: { anchor: pos + 1, head: pos + 1 },
    }
  }

  const planSpaceInParens = (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
    const pos = insideEmptyParens(ctx)
    if (pos === null) {
      return null
    }
    return {
      changes: [{ offset: pos, length: 0, text: ' ' }],
      selection: { anchor: pos + 1, head: pos + 1 },
    }
  }

  const wrapReporter = (id: string, plan: (ctx: AddonInputContext) => AddonBehaviorInputPlan | null) =>
    (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
      const result = plan(ctx)
      report({
        kind: 'behavior',
        id,
        userEvent: ctx.userEvent,
        inputText: ctx.inputText,
        snapshotText: ctx.snapshot.text,
        cursor: cursorOf(ctx),
        planned: result !== null,
      })
      return result
    }

  const registrations: Array<{ id: string; name: string; description?: string; examples?: string[]; exclusiveGroup?: string; history?: 'atomic' | 'joinPrevious'; plan: (ctx: AddonInputContext) => AddonBehaviorInputPlan | null }> = [
    { id: 'bracket-close', name: '括号补全', description: '键入 ( 后自动补出 )', examples: ['(|)'], plan: planBracketClose },
    {
      id: 'dash-in-parens', name: '括号内填充短划', exclusiveGroup: 'parens-fill',
      description: '空括号对内侧插入 -', plan: planDashInParens,
    },
    {
      id: 'space-in-parens', name: '括号内空格整理', exclusiveGroup: 'parens-fill', history: 'joinPrevious',
      description: '空括号对内侧插入空格', plan: planSpaceInParens,
    },
  ]

  const registerResults: Array<{ id: string; result: unknown }> = []
  for (const entry of registrations) {
    registerResults.push({
      id: entry.id,
      result: behaviors.register({
        id: entry.id,
        name: entry.name,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.examples !== undefined ? { examples: entry.examples } : {}),
        ...(entry.exclusiveGroup !== undefined ? { exclusiveGroup: entry.exclusiveGroup } : {}),
        ...(entry.history !== undefined ? { history: entry.history } : {}),
        onInput: wrapReporter(entry.id, entry.plan),
      }),
    })
  }

  // 通知分离面：onChanged 只观察（无修饰权）；上报供用例断言观察与修饰分离
  behaviors.onChanged((event) => {
    report({
      kind: 'changed',
      userEvent: event.userEvent,
      inputText: event.inputText,
      snapshotText: event.snapshot.text,
    })
  })

  // 注册拒绝路径对照（票面「名称缺失拒绝」）：缺名称的注册应被拒
  registerResults.push({
    id: '<invalid-no-name>',
    result: behaviors.register({ id: 'no-name', onInput: () => null } as never),
  })

  // 注册结局上报（宿主收件箱就绪前的事件由通道超时吸收；注册结果本身
  // 同步可得）
  report({ kind: 'registered', results: registerResults })

  sdk.onDispose(() => {
    // 释放语义由装载器驱动（unregisterAddon）；页面侧无需自清
  })
})
