// @vitest-environment jsdom
// 悬停提示委托控制器的行为契约（#300）：显隐时序、保活、焦点触发、
// Esc 还焦、键位徽章结构化、竞态与生命周期。断言口径为用户可观察行为
// （可见类、渲染文本、焦点落点），不探内部状态。
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  installTooltipCard,
  TOOLTIP_ATTR,
  TOOLTIP_KEYS_ATTR,
  TOOLTIP_KEYS_SEPARATOR,
  TOOLTIP_CLASS_NAMES,
} from '../../src/webview/tooltipCard'

function makeAnchor(text: string, keys?: string[]): HTMLElement {
  const el = document.createElement('button')
  el.setAttribute(TOOLTIP_ATTR, text)
  if (keys?.length) el.setAttribute(TOOLTIP_KEYS_ATTR, keys.join(TOOLTIP_KEYS_SEPARATOR))
  document.body.appendChild(el)
  return el
}

function mouseover(el: Element, relatedTarget?: Element): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget }))
}
function mouseout(el: Element, relatedTarget?: Element): void {
  el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }))
}
function container(): HTMLElement {
  return document.querySelector<HTMLElement>(`.${TOOLTIP_CLASS_NAMES.card}`)!
}

describe('悬停提示委托控制器（#300）', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('悬停经延迟显示：延迟内不出现，到点呈现文案', async () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 300 })
    const anchor = makeAnchor('加粗')
    mouseover(anchor)
    vi.advanceTimersByTime(299)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(true)
    expect(container().querySelector(`.${TOOLTIP_CLASS_NAMES.text}`)!.textContent).toBe('加粗')
    void anchor
  })

  it('焦点进入即时显示（无延迟）', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 300 })
    const anchor = makeAnchor('刷新')
    anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(true)
    expect(container().querySelector(`.${TOOLTIP_CLASS_NAMES.text}`)!.textContent).toBe('刷新')
  })

  it('键位徽章：多段键位各一枚，无键位不渲染键区', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 0 })
    const withKeys = makeAnchor('选下一处相同词', ['Ctrl+D'])
    mouseover(withKeys)
    vi.advanceTimersByTime(0)
    const keyEls = [...container().querySelectorAll(`.${TOOLTIP_CLASS_NAMES.key}`)]
    expect(keyEls.map((el) => el.textContent)).toEqual(['Ctrl+D'])

    const plain = makeAnchor('加粗')
    mouseover(plain)
    vi.advanceTimersByTime(0)
    expect(container().querySelectorAll(`.${TOOLTIP_CLASS_NAMES.key}`)).toHaveLength(0)
  })

  it('移入提示本体保活：mouseout 到容器不收起，移出联合区域即收', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 0 })
    const anchor = makeAnchor('复制')
    mouseover(anchor)
    vi.advanceTimersByTime(0)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(true)
    // 触发元素 → 容器本体：联合区域内移动，保持
    mouseout(anchor, container())
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(true)
    // 容器 → 无关区域：收起
    mouseout(container(), document.body)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(false)
    expect(container().querySelector(`.${TOOLTIP_CLASS_NAMES.text}`)!.textContent).toBe('')
  })

  it('延迟窗口内移出：计时取消，到点不出现', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 300 })
    const anchor = makeAnchor('加粗')
    mouseover(anchor)
    mouseout(anchor, document.body)
    vi.advanceTimersByTime(1000)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(false)
  })

  it('悬停目标切换：前序计时取消，到点只显示新目标', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 100 })
    const a = makeAnchor('甲')
    const b = makeAnchor('乙')
    mouseover(a)
    mouseover(b)
    vi.advanceTimersByTime(100)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(true)
    expect(container().querySelector(`.${TOOLTIP_CLASS_NAMES.text}`)!.textContent).toBe('乙')
  })

  it('空提示属性不显示（态变清空语义）', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 0 })
    const anchor = makeAnchor('')
    mouseover(anchor)
    vi.advanceTimersByTime(0)
    expect(container().classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(false)
  })

  it('提示持有焦点时 Esc 收起并还焦触发元素', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 0 })
    const anchor = makeAnchor('导出')
    mouseover(anchor)
    vi.advanceTimersByTime(0)
    const card = container()
    card.focus()
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(card.classList.contains(TOOLTIP_CLASS_NAMES.shown)).toBe(false)
    expect(document.activeElement).toBe(anchor)
  })

  it('定位落盘：显示后写入坐标样式（几何装配冒烟）', () => {
    vi.useFakeTimers()
    installTooltipCard({ showDelayMs: 0 })
    const anchor = makeAnchor('缩放')
    mouseover(anchor)
    vi.advanceTimersByTime(0)
    const card = container()
    expect(card.style.top).not.toBe('')
    expect(card.style.left).not.toBe('')
  })

  it('dispose 后不再响应且容器移除', () => {
    vi.useFakeTimers()
    const dispose = installTooltipCard({ showDelayMs: 0 })
    const anchor = makeAnchor('加粗')
    dispose()
    mouseover(anchor)
    vi.advanceTimersByTime(0)
    expect(document.querySelector(`.${TOOLTIP_CLASS_NAMES.card}`)).toBeNull()
  })
})
