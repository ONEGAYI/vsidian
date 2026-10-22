// #638 契约：跳转到行的输入解析与行首偏移换算（host/gotoLine）。
// 只收 1-based 正整数行号——空值/0/负数/小数/非数字/前后空白外字符一律拒绝，
// 越界由调用方按文档行数判定（本模块只管形状，不管文档范围）。
// 行首换算复用 addonDocNav.hostLineStart（#534 同一事实源），CRLF 经
// NewlineCoordinator 折算为 webview LF 坐标。
import { describe, expect, it } from 'vitest'
import { parseGotoLineInput, gotoLineLfOffset, isValidGotoLineInput } from '../../src/host/gotoLine'

describe('跳转到行输入解析（parseGotoLineInput）', () => {
  it('收正整数行号，两侧空白不敏感', () => {
    expect(parseGotoLineInput('1')).toBe(1)
    expect(parseGotoLineInput('42')).toBe(42)
    expect(parseGotoLineInput('  7  ')).toBe(7)
    expect(parseGotoLineInput('100000')).toBe(100000)
  })
  it('拒绝空值与纯空白（形状非法，由输入框统一给本地化反馈）', () => {
    expect(parseGotoLineInput('')).toBeNull()
    expect(parseGotoLineInput('   ')).toBeNull()
  })
  it('拒绝 0、负数与小数', () => {
    expect(parseGotoLineInput('0')).toBeNull()
    expect(parseGotoLineInput('-1')).toBeNull()
    expect(parseGotoLineInput('-0')).toBeNull()
    expect(parseGotoLineInput('1.0')).toBeNull()
    expect(parseGotoLineInput('3.5')).toBeNull()
  })
  it('拒绝非数字与数字夹杂文本', () => {
    expect(parseGotoLineInput('abc')).toBeNull()
    expect(parseGotoLineInput('12a')).toBeNull()
    expect(parseGotoLineInput('1e3')).toBeNull()
    expect(parseGotoLineInput('0x10')).toBeNull()
    expect(parseGotoLineInput('1 2')).toBeNull()
    expect(parseGotoLineInput('+5')).toBeNull()
  })
  it('拒绝超出安全整数范围的值', () => {
    expect(parseGotoLineInput('9007199254740993')).toBeNull()
    expect(parseGotoLineInput('1'.repeat(30))).toBeNull()
  })
})

describe('输入框校验（isValidGotoLineInput）', () => {
  // #638 验收：空值也必须给出本地化校验反馈，不能被当成"取消式空提交"
  // 放行后静默退出（取消由 showInputBox 返回 undefined 单独处理）。
  it('空值与纯空白判为未通过（同一非法文案反馈，输入框保持在场）', () => {
    expect(isValidGotoLineInput('', 10)).toBe(false)
    expect(isValidGotoLineInput('   ', 10)).toBe(false)
    expect(isValidGotoLineInput('\t\n', 10)).toBe(false)
  })
  it('形状非法与越界均判为未通过', () => {
    for (const raw of ['0', '-1', '1.5', 'abc', '12a', '1e3', '+5']) {
      expect(isValidGotoLineInput(raw, 10)).toBe(false)
    }
    expect(isValidGotoLineInput('11', 10)).toBe(false)
  })
  it('范围内正整数判为通过，边界首末行可用', () => {
    expect(isValidGotoLineInput('1', 10)).toBe(true)
    expect(isValidGotoLineInput('10', 10)).toBe(true)
    expect(isValidGotoLineInput('  3  ', 10)).toBe(true)
  })
})

describe('行号到 LF 行首偏移（gotoLineLfOffset）', () => {
  it('LF 文档：1-based 行号换算为行首偏移，末行与尾随换行末空行都可定位', () => {
    const doc = '第一行\n第二行\n第三行\n'
    expect(gotoLineLfOffset(doc, 1)).toBe(0)
    expect(gotoLineLfOffset(doc, 2)).toBe(4)
    expect(gotoLineLfOffset(doc, 3)).toBe(8)
    // 尾随换行后的末空行是合法定位行（与 VSCode lineCount 同口径）
    expect(gotoLineLfOffset(doc, 4)).toBe(12)
  })
  it('CRLF 文档：偏移按 LF 坐标折算（每个 CRLF 行尾贡献 -1）', () => {
    const doc = '第一行\r\n第二行\r\n第三行\r\n'
    expect(gotoLineLfOffset(doc, 1)).toBe(0)
    expect(gotoLineLfOffset(doc, 2)).toBe(4)
    expect(gotoLineLfOffset(doc, 3)).toBe(8)
    expect(gotoLineLfOffset(doc, 4)).toBe(12)
  })
  it('混合行尾文档：仅 CRLF 行尾参与折算', () => {
    const doc = 'a\r\nb\nc\r\n'
    expect(gotoLineLfOffset(doc, 1)).toBe(0)
    expect(gotoLineLfOffset(doc, 2)).toBe(2)
    expect(gotoLineLfOffset(doc, 3)).toBe(4)
  })
  it('越界行号返回 null（不钳制到末行）', () => {
    const doc = '只有一行\n'
    expect(gotoLineLfOffset(doc, 3)).toBeNull()
    expect(gotoLineLfOffset('', 2)).toBeNull()
  })
})
