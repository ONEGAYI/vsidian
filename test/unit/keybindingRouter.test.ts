// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { KeybindingRouter, keyStep } from '../../src/webview/keybindingRouter'

function key(key: string, ctrlKey = true): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
}

describe('编辑器按键路由', () => {
  it('默认键仅在作用域中截断冒泡并执行，清空后释放旧键', () => {
    const hit = vi.fn()
    const router = new KeybindingRouter({}, hit)
    const out = key('b')
    expect(router.handle(out, 'live', false)).toBe(false)
    expect(out.defaultPrevented).toBe(false)
    const inside = key('b')
    expect(router.handle(inside, 'live', true)).toBe(true)
    expect(inside.defaultPrevented).toBe(true)
    expect(hit).toHaveBeenCalledWith('bold')
    router.update({ bold: [] })
    expect(router.handle(key('b'), 'live', true)).toBe(false)
  })

  it('两段键首段等待，Escape 与模式变化取消', () => {
    const hit = vi.fn()
    const router = new KeybindingRouter({ bold: ['ctrl+k ctrl+b'] }, hit)
    expect(router.handle(key('k'), 'live', true)).toBe(true)
    expect(router.handle(key('Escape', false), 'live', true)).toBe(true)
    expect(router.handle(key('b'), 'live', true)).toBe(false)
    expect(router.handle(key('k'), 'live', true)).toBe(true)
    expect(router.handle(key('b'), 'reading', true)).toBe(false)
    expect(hit).not.toHaveBeenCalled()
    expect(router.handle(key('k'), 'live', true)).toBe(true)
    expect(router.handle(key('b'), 'live', true)).toBe(true)
    expect(hit).toHaveBeenCalledWith('bold')
  })
})

// 键位捕获的词汇归一（验收报障回归钉：主键盘 = 此前被拒——aliases 有
// '+'→equal 却漏裸 '='，Alt+= 在设置页捕获框无反应；小键盘 Add/Subtract
// 文字形态同缺口。红证据：修复前 bundle 探针 keyStep({key:'='}) → null。
describe('keyStep 按键词汇归一', () => {
  const plainKey = (name: string, alt = false): KeyboardEvent =>
    new KeyboardEvent('keydown', { key: name, altKey: alt, bubbles: true, cancelable: true })

  it('等号族三形态归一 equal：裸 = / + / 小键盘 Add', () => {
    expect(keyStep(plainKey('=', true))).toBe('alt+equal')
    expect(keyStep(plainKey('+', true))).toBe('alt+equal')
    expect(keyStep(plainKey('Add', true))).toBe('alt+equal')
  })

  it('减号族双形态归一 minus：裸 - / 小键盘 Subtract', () => {
    expect(keyStep(plainKey('-', true))).toBe('alt+minus')
    expect(keyStep(plainKey('Subtract', true))).toBe('alt+minus')
  })

  it('组合输入与修饰键自身不产出词汇', () => {
    expect(keyStep(plainKey('Process', true))).toBeNull()
    expect(keyStep(plainKey('Dead'))).toBeNull()
    expect(keyStep(plainKey('Alt', true))).toBeNull()
  })
})
