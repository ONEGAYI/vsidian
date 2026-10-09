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

// #413（#409 T02）shift 上档符号 → 物理键名归一：美式布局下 Shift 把
// 符号键换成上档字符（Ctrl+Shift+[ 的实际事件字符是 `{`），validKey 白名
// 名单只有物理键名——keyStep 需把上档字符折回物理键（修饰键已由
// event.shiftKey 携带，归一结果带 shift 前缀）。设置页键位捕获同用
// keyStep，同源受益；路由与捕获共用同一张表，此处钉住全集。
describe('keyStep shift 上档符号映射（#413）', () => {
  const shiftKey = (name: string, ctrl = false): KeyboardEvent =>
    new KeyboardEvent('keydown', { key: name, ctrlKey: ctrl, shiftKey: true, bubbles: true, cancelable: true })

  it('白名单符号键的上档字符逐一归一（美式布局盘点全集；+ 既有词条）', () => {
    expect(keyStep(shiftKey('{', true))).toBe('ctrl+shift+bracketleft')
    expect(keyStep(shiftKey('}', true))).toBe('ctrl+shift+bracketright')
    expect(keyStep(shiftKey('_', true))).toBe('ctrl+shift+minus')
    expect(keyStep(shiftKey('<', true))).toBe('ctrl+shift+comma')
    expect(keyStep(shiftKey('>', true))).toBe('ctrl+shift+period')
    expect(keyStep(shiftKey('?', true))).toBe('ctrl+shift+slash')
    expect(keyStep(shiftKey('|', true))).toBe('ctrl+shift+backslash')
    expect(keyStep(shiftKey(':', true))).toBe('ctrl+shift+semicolon')
    expect(keyStep(shiftKey('"', true))).toBe('ctrl+shift+quote')
    // 既有词条不回归：+ → equal（#236 验收报障钉住的先例）
    expect(keyStep(shiftKey('+', true))).toBe('ctrl+shift+equal')
  })

  it('数字键上档字符（!@#$% 等）不归一——白名单口径是符号键，数字族留待实需增量', () => {
    expect(keyStep(shiftKey('!'))).toBeNull()
    expect(keyStep(shiftKey('@'))).toBeNull()
    expect(keyStep(shiftKey('('))).toBeNull()
  })

  it('注册表默认键位真实路由：Ctrl+Shift+[ / ] 命中折叠/展开，Ctrl+K 弦命中切换与全量', () => {
    const hits: string[] = []
    const router = new KeybindingRouter({}, (id) => hits.push(id))
    const down = (key: string, init: KeyboardEventInit): boolean =>
      router.handle(new KeyboardEvent('keydown', { key, ...init, bubbles: true, cancelable: true }), 'live', true)
    expect(down('{', { ctrlKey: true, shiftKey: true })).toBe(true)
    expect(down('}', { ctrlKey: true, shiftKey: true })).toBe(true)
    expect(down('k', { ctrlKey: true })).toBe(true)
    expect(down('l', { ctrlKey: true })).toBe(true)
    expect(down('k', { ctrlKey: true })).toBe(true)
    expect(down('0', { ctrlKey: true })).toBe(true)
    expect(down('k', { ctrlKey: true })).toBe(true)
    expect(down('j', { ctrlKey: true })).toBe(true)
    expect(hits).toEqual(['headingFold', 'headingUnfold', 'headingToggleFold', 'headingFoldAll', 'headingUnfoldAll'])
  })
})
