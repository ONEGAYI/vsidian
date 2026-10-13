// #353 T04 附加组件基础设置控件（webview 纯 DOM 构造）：标量三型、数组
// 重复项控件与对象字段控件的构造器。只负责控件与值形态，不含作用范围
// 编排（AddonSettingsAreaSection 持有标签状态与草稿，本模块按定义 + 当前值构造）。
//
// 控件口径（技术方案 5.5）：
// - boolean → 复选开关；number → number input（min/max，step any——手改
//   存量允许任意范围内值，与内置滑块的步进口径一致）；string enum →
//   select（enum 顺序即选项顺序，#473 起档位文案可经 enumLabels 本地化，
//   缺失标签回退枚举值本身）；string 自由文本 → text input（maxLength），
//   #475 起定义可声明 multiline 渲染 textarea（换行参与持久化值）。
// - 数组用重复项控件：每行一个 item 控件 + 移除；添加/移除/输入更新草稿，
//   保存按钮整批上送。
// - 对象用字段控件：每字段一行（字段名 + 控件），保存按钮整批上送。
//
// data 属性契约（浏览器/单测断言面）：
// - 标量控件 data-addon-setting="<key>"；功能开关 data-addon-setting="__enabled__"
// - 数组项 input data-addon-array-item="<key>"
// - 对象字段 input data-addon-field="<key>.<field>"
import { currentLocaleLang } from '../shared/i18n'
import { resolveLocalizedText } from '../shared/localizedText'
import type { AddonLocalizedText, AddonScalarItemSpec, AddonSettingDefinition } from '../shared/addonSettings'

/** string 定义的呈现形态声明（#473/#475，仅定义级——数组项与对象字段不提供） */
export interface ScalarControlPresentation {
  /** 枚举档位显示标签：键 = enum 值；缺失键回退枚举值本身 */
  readonly enumLabels?: Readonly<Record<string, AddonLocalizedText>>
  /** 多行形态：true 渲染 textarea */
  readonly multiline?: boolean
}

/**
 * 标量项控件（数组项与对象字段共用；值变化经 onValue 回调上送草稿）。
 * event：草稿场景用 'input'（输入即时更新草稿）；标量定义行的即时上送
 * 用 'change'（失焦/回车上送——与内置设置控件的保存语义一致；textarea
 * 的回车是换行不触发，同样失焦上送）。presentation 仅定义级控件传入。
 */
export function createScalarItemControl(
  spec: AddonScalarItemSpec,
  value: unknown,
  attrs: Record<string, string>,
  onValue: (value: boolean | number | string) => void,
  event: 'change' | 'input' = 'change',
  presentation?: ScalarControlPresentation,
): HTMLElement {
  if (spec.kind === 'boolean') {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = value === true
    for (const [key, attr] of Object.entries(attrs)) box.setAttribute(key, attr)
    box.addEventListener('change', () => onValue(box.checked))
    return box
  }
  if (spec.kind === 'number') {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(typeof value === 'number' ? value : 0)
    if (spec.min !== undefined) input.min = String(spec.min)
    if (spec.max !== undefined) input.max = String(spec.max)
    input.step = 'any'
    for (const [key, attr] of Object.entries(attrs)) input.setAttribute(key, attr)
    input.addEventListener(event, () => {
      const parsed = Number(input.value)
      if (Number.isFinite(parsed)) onValue(parsed)
    })
    return input
  }
  if (spec.enum !== undefined) {
    const select = document.createElement('select')
    const current = typeof value === 'string' ? value : spec.enum[0]!
    const labels = presentation?.enumLabels
    for (const option of spec.enum) {
      const el = document.createElement('option')
      el.value = option
      // #473 档位标签仅呈现层：option.value 恒为枚举原值，缺失标签回退原值
      //（hasOwn 不走原型链——枚举值恰为 toString 等原型属性名时不误取）
      el.textContent = labels !== undefined && Object.hasOwn(labels, option)
        ? resolveLocalizedText(labels[option]!, currentLocaleLang())
        : option
      if (option === current) el.selected = true
      select.append(el)
    }
    for (const [key, attr] of Object.entries(attrs)) select.setAttribute(key, attr)
    select.addEventListener('change', () => onValue(select.value))
    return select
  }
  if (presentation?.multiline === true) {
    // #475 多行形态：textarea 的 API 值换行规范为 LF，持久化原样保留
    const area = document.createElement('textarea')
    area.rows = 4
    area.value = typeof value === 'string' ? value : ''
    if (spec.maxLength !== undefined) area.maxLength = spec.maxLength
    for (const [key, attr] of Object.entries(attrs)) area.setAttribute(key, attr)
    area.addEventListener(event, () => onValue(area.value))
    return area
  }
  const input = document.createElement('input')
  input.type = 'text'
  input.value = typeof value === 'string' ? value : ''
  if (spec.maxLength !== undefined) input.maxLength = spec.maxLength
  for (const [key, attr] of Object.entries(attrs)) input.setAttribute(key, attr)
  input.addEventListener(event, () => onValue(input.value))
  return input
}

/** 标量定义控件（boolean/number/string 定义行用） */
export function createScalarDefinitionControl(def: AddonSettingDefinition, value: unknown, onValue: (value: boolean | number | string) => void): HTMLElement {
  const attrs: Record<string, string> = { 'data-addon-setting': def.key }
  if (def.type === 'boolean') {
    return createScalarItemControl({ kind: 'boolean' }, value, attrs, onValue)
  }
  if (def.type === 'number') {
    return createScalarItemControl({ kind: 'number', min: def.min, max: def.max }, value, attrs, onValue)
  }
  if (def.type === 'string') {
    return createScalarItemControl({ kind: 'string', maxLength: def.maxLength, enum: def.enum }, value, attrs, onValue, 'change', {
      ...(def.enumLabels !== undefined ? { enumLabels: def.enumLabels } : {}),
      ...(def.multiline !== undefined ? { multiline: def.multiline } : {}),
    })
  }
  // 数组/对象定义不经本函数（走重复项/字段控件）；兜底只读文本占位
  const placeholder = document.createElement('span')
  placeholder.textContent = String(value)
  for (const [key, attr] of Object.entries(attrs)) placeholder.setAttribute(key, attr)
  return placeholder
}

/** 标量默认值（undefined 安全取值——数组项新行与对象字段初始） */
export function scalarItemFallback(spec: AddonScalarItemSpec): boolean | number | string {
  if (spec.kind === 'boolean') return false
  if (spec.kind === 'number') return 0
  return ''
}
