// #356 T07 测试组件编辑器页源码：消费公开 SDK 的 behaviors 面注册可
// 组合输入行为——集成/键盘用例的「外部测试组件经公开 API 消费」载体。
//
// 行为族（票面验收的「共同运行与空格整理」示意，脱字符 ^ 族——内核
// #123 注册表无登记、Markdown 无节点语义，行为修饰真实发生）：
// - dash-fill：键入 ^ 后在光标处插入 - ——atomic，无组
// - space-fill：键入 ^ 后在光标处插入空格 ——独占组 fill，joinPrevious
//  （演示非原子修饰随上次原子操作撤回——Q29 撤销粒度验收载体）
// - tilde-fill：键入 ^ 后在光标处插入 ~ ——同独占组 fill，atomic
// - locale-name：多语言 name 形态（#464）——恒不修饰（返回 null 且不经
//   wrapReporter 上报），仅钉住多语言行为名在目录/设置页的端到端呈现；
//   不干扰既有链断言（默认序/独占组/全关零回调）
// - bracket-conv（#595）：IME 定稿 '【' 替换选区时半角化改写（'w[ord]'）
//   ——SelectKey 类同步行为示意：单字符 inputText + replaced 作改写目标
//   （#401 语义）。让位验证载体：行为链驱动（M1）先改写区间，内置 #124
//   包裹 attempt（M3）形态校验发现区间被改写即中止——判定只认
//   inputText '【' 且 replaced 非空，不干扰 '^' 族与无选区场景
//
// 判定只依赖本次输入文本（健壮：不受前序修饰与光标映射语义影响）；
// 默认序（完整键字典序）bracket-conv → dash → locale-name → space →
// tilde（locale-name 恒不修饰，等效于 bracket-conv → dash → space →
// tilde 的链结果）：键入 ^ 的默认结果
// word^- (dash 先插 -，space 组内先于 tilde 适用再插空格)；调序
// （tilde 前置）后 word^~-（tilde 先占组、space 跳过）——「调整顺序
// 导致可预期结果」；组外 dash 两种顺序都运行（不恢复先接管者生效）。
//
// 上报协议：每个行为回调被调用与 onChanged 观察事件经通道 't07.event'
  // fire-and-forget 上报宿主收件箱（用例经 t07.collect 断言链执行与顺序）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonBehaviorInputPlan, AddonBehaviorName, AddonInputContext } from '../../../../src/shared/addonBehaviors'

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

  /** #595 半角化计划：IME 定稿 '【' 替换选区时，把已落地的定稿字符改写为
   *  半角括号包裹被替换文本（SelectKey 类同步行为示意）。replaced 坐标系
   *  是事务前文档，选区替换式定稿的字符恰落在 replaced.from——以快照
   *  核对定稿字符在场后才计划，位置语义自证 */
  const planBracketConv = (ctx: AddonInputContext): AddonBehaviorInputPlan | null => {
    if (ctx.inputText !== '【' || ctx.replaced === null) {
      return null
    }
    const at = ctx.replaced.from
    if (ctx.snapshot.text.slice(at, at + ctx.inputText.length) !== ctx.inputText) {
      return null
    }
    const text = `[${ctx.replaced.text}]`
    return {
      changes: [{ offset: at, length: ctx.inputText.length, text }],
      selection: { anchor: at + text.length, head: at + text.length },
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
        replaced: ctx.replaced,
        docUri: ctx.docUri,
        snapshotText: ctx.snapshot.text,
        cursor: cursorOf(ctx),
        planned: result !== null,
      })
      return result
    }

  const registrations: Array<{ id: string; name: AddonBehaviorName; description?: string; examples?: string[]; exclusiveGroup?: string; history?: 'atomic' | 'joinPrevious'; plan: (ctx: AddonInputContext) => AddonBehaviorInputPlan | null; report?: boolean }> = [
    {
      id: 'bracket-conv', name: '全角括号半角化', description: 'IME 定稿【时半角化包裹',
      examples: ['ord→[ord]'], plan: planBracketConv,
    },
    { id: 'dash-fill', name: '短划填充', description: '键入 ^ 后插入短划', examples: ['^-^'], plan: planFill('-') },
    {
      id: 'space-fill', name: '空格整理', exclusiveGroup: 'fill', history: 'joinPrevious',
      description: '键入 ^ 后插入空格', plan: planFill(' '),
    },
    {
      id: 'tilde-fill', name: '波浪填充', exclusiveGroup: 'fill',
      description: '键入 ^ 后插入波浪号', plan: planFill('~'),
    },
    // #464 多语言 name 端到端载体：恒不修饰（plan 恒 null）且不上报回调
    // 事件（report: false——T07「全关零回调」断言不受扰动），仅钉住映射
    // 名在目录与设置页的呈现
    {
      id: 'locale-name', name: { en: 'Localized name demo', 'zh-cn': '多语言名称示例' },
      plan: () => null, report: false,
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
        onInput: entry.report === false ? entry.plan : wrapReporter(entry.id, entry.plan),
      }),
    })
  }

  // 通知分离面：onChanged 只观察（无修饰权）；上报供用例断言观察与修饰分离
  behaviors.onChanged((event) => {
    report({
      kind: 'changed',
      replaced: event.replaced,
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
