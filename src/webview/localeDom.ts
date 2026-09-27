// 常驻控件文案的单点重刷注册表（#101）：常驻 DOM 文案的创建与换包重刷
// 收敛到同一登记点，消除「创建侧写词 ↔ 刷新侧回查对照枚举」的双写。
//
// 形态（探索笔记 101 §5.1）：
// - 键锚点 bindLocale(el, 目标, 键)：创建时按当前语言写入并登记，换包时重写；
// - 回调 bindLocaleFn(el, 目标, resolve)：覆盖动态键（FORMAT_OPERATIONS 的
//   titleKey）与复合/状态相关文案（侧栏开合的可访问名称）；
// - 双目标便捷形 bindLocaleAttrs / bindLocaleFnAttrs：图标按钮的通用口径
//   ——可访问名称（aria-label）与悬停提示（title）同词，一次调用登记两个
//   目标，收敛成对的两次单目标登记；
// - 目标是属性名（'aria-label' / 'title' / 'placeholder' / …）或特指
//   textContent 的 'text'。
//
// 元素引用策略（笔记 §5.3 二选一）：**WeakRef + isConnected 检查**——
// - 注册表不延长元素寿命（大纲条目/折叠箭头随数据全量重建，强引用会在
//   无 dispose 纪律的函数化模块里累积泄漏）；
// - 重刷时跳过已脱挂元素并剪除其登记项（三面板的常驻元素一旦脱挂即废弃：
//   renderOutlineItems 全量重建、控制器 dispose 整体卸载，不存在「暂时
//   脱挂后复用」的路径；创建到挂载之间是同步代码，不会插入换包）；
// - 换包通知由本模块在首次登记时订阅一次（懒订阅，模块导入零副作用）。
//
// 边界：本注册表只救「常驻 DOM」。CM6 widget 等按需控件的文案生命周期
// 归装饰系统，不在此登记（另一提交处理，见 syncController.applyEditorLocale）。
import { onLocaleChanged, t, type MessageParams } from '../shared/i18n'
import type { MessageKey } from '../shared/locales/en'

/** 写入目标：'text' 特指 textContent，其余为任意属性名 */
export type LocaleTarget = 'text' | (string & {})

interface LocaleBinding {
  ref: WeakRef<Element>
  write: (el: Element) => void
}

const bindings: LocaleBinding[] = []
let subscribed = false

/** 登记数超过该阈值时在 register 内顺带剪枝：死绑定只在换包时清理的话，
 *  大纲条目等高频重建场景（每次重建的 chevron/nomatch 占位都新增登记）
 *  在两次换包间会无界累积。512 取三面板常驻控件峰值（顶栏/操作条/查找/
 *  侧栏骨架/大纲条目）的充分余量——超限即剪，正常文档远达不到 */
const REGISTER_PRUNE_THRESHOLD = 512

function writeTo(el: Element, target: LocaleTarget, value: string): void {
  if (target === 'text') {
    el.textContent = value
  } else {
    el.setAttribute(target, value)
  }
}

/** 登记项入库（首次使用时订阅换包通知——懒订阅保持模块导入零副作用） */
function register(el: Element, write: (el: Element) => void): void {
  if (!subscribed) {
    subscribed = true
    onLocaleChanged(refreshLocaleDom)
  }
  bindings.push({ ref: new WeakRef(el), write })
  if (bindings.length > REGISTER_PRUNE_THRESHOLD) {
    pruneDetachedBindings()
  }
}

/** 剪除扫描：移除 deref 失败（已回收）或已脱挂的登记项——与换包重刷
 *  同款存活判定，但不重写存活项（此处非换包驱动，重写无意义） */
function pruneDetachedBindings(): void {
  let kept = 0
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!
    const el = binding.ref.deref()
    if (el && el.isConnected) {
      bindings[kept++] = binding
    }
  }
  bindings.length = kept
}

/** 键锚点登记：立即按当前语言写入目标，换包时按新语言重写 */
export function bindLocale(
  el: Element,
  target: LocaleTarget,
  key: MessageKey,
  params?: MessageParams,
): void {
  writeTo(el, target, t(key, params))
  register(el, (node) => writeTo(node, target, t(key, params)))
}

/** 回调登记：立即求值写入目标，换包时重新求值重写（动态键与复合文案） */
export function bindLocaleFn(el: Element, target: LocaleTarget, resolve: () => string): void {
  writeTo(el, target, resolve())
  register(el, (node) => writeTo(node, target, resolve()))
}

/** 双目标便捷形（键锚点）：aria-label 与 title 同键一次登记——图标按钮
 *  的通用无障碍口径（屏幕阅读器名称与鼠标悬停提示同词） */
export function bindLocaleAttrs(
  el: Element,
  key: MessageKey,
  params?: MessageParams,
): void {
  bindLocale(el, 'aria-label', key, params)
  bindLocale(el, 'title', key, params)
}

/** 双目标便捷形（回调）：aria-label 与 title 共用同一求值回调登记 */
export function bindLocaleFnAttrs(el: Element, resolve: () => string): void {
  bindLocaleFn(el, 'aria-label', resolve)
  bindLocaleFn(el, 'title', resolve)
}

/** 换包重刷：重写全部仍连线的登记项；已脱挂/已回收的登记项就地剪除 */
export function refreshLocaleDom(): void {
  let kept = 0
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!
    const el = binding.ref.deref()
    if (el && el.isConnected) {
      binding.write(el)
      bindings[kept++] = binding
    }
  }
  bindings.length = kept
}

/** 单元素重算：非换包驱动的状态变化（如侧栏开合改写可访问名称）后调用 */
export function refreshElementLocale(el: Element): void {
  for (const binding of bindings) {
    const node = binding.ref.deref()
    if (node === el) {
      binding.write(node)
    }
  }
}

/** 测试观测：当前登记项总数（有界性契约用例消费；生产不引） */
export function __localeDomBindingCountForTest(): number {
  return bindings.length
}
