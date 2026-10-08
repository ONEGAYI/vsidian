// #356 T07 测试组件编辑器页源码：消费公开 SDK 的 behaviors 面注册可
// 组合输入行为——集成/键盘用例的「外部测试组件经公开 API 消费」载体。
//
// 行为族（票面验收的「共同运行与空格整理」示意，脱字符 ^ 族——内核
// #123 注册表无登记、Markdown 无节点语义，行为修饰真实发生）：
// - dash-fill：键入 ^ 后在光标处插入 - ——atomic，无组
// - space-fill：键入 ^ 后在光标处插入空格 ——独占组 fill，joinPrevious
//  （演示非原子修饰随上次原子操作撤回——Q29 撤销粒度验收载体）
// - tilde-fill：键入 ^ 后在光标处插入 ~ ——同独占组 fill，atomic
//
// 判定只依赖本次输入文本（健壮：不受前序修饰与光标映射语义影响）；
// 默认序（完整键字典序）dash → space → tilde：键入 ^ 的默认结果
// word^- (dash 先插 -，space 组内先于 tilde 适用再插空格)；调序
// （tilde 前置）后 word^~-（tilde 先占组、space 跳过）——「调整顺序
// 导致可预期结果」；组外 dash 两种顺序都运行（不恢复先接管者生效）。
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

  /** fill 计划工厂：键入 ^ 后在当前光标处插入指定填充字符（判定只依赖
   *  本次输入文本——不受前序修饰与光标贴前/贴后语义影响，三种行为
   *  在任意顺序下的适用性与产物都确定，顺序效果由「组内首个适用者」
   *  与插入位置叠加体现） */
  const planFill = (fill: string) => (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
    if (ctx.inputText !== '^') {
      return null
    }
    const pos = cursorOf(ctx)
    return {
      changes: [{ offset: pos, length: 0, text: fill }],
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
        docUri: ctx.docUri,
        snapshotText: ctx.snapshot.text,
        cursor: cursorOf(ctx),
        planned: result !== null,
      })
      return result
    }

  const registrations: Array<{ id: string; name: string; description?: string; examples?: string[]; exclusiveGroup?: string; history?: 'atomic' | 'joinPrevious'; plan: (ctx: AddonInputContext) => AddonBehaviorInputPlan | null }> = [
    { id: 'dash-fill', name: '短划填充', description: '键入 ^ 后插入短划', examples: ['^-^'], plan: planFill('-') },
    {
      id: 'space-fill', name: '空格整理', exclusiveGroup: 'fill', history: 'joinPrevious',
      description: '键入 ^ 后插入空格', plan: planFill(' '),
    },
    {
      id: 'tilde-fill', name: '波浪填充', exclusiveGroup: 'fill',
      description: '键入 ^ 后插入波浪号', plan: planFill('~'),
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
      docUri: event.docUri,
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
