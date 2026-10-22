// #638 跳转到行：输入解析（宿主侧纯逻辑）。
//
// 只接受 1-based 正整数源码行号——宿主 workbench.action.gotoLine 在自定义
// 编辑器下没有可寻址的文本编辑器目标，本操作以 Vsidian 自有输入框替代。
// 本模块分两层判定：parseGotoLineInput 只判「形状」——空值、0、负数、小数、
// 非数字、夹杂文本与超安全整数一律 null；isValidGotoLineInput 在其上叠加
// 文档范围（lineCount）。分开才能在输入期间文档变化时按最新行数给越界反馈。
//
// 不提供列号、百分比、字符偏移或 `:line:col` 语法——#638 票面明确不扩展。
import { NewlineCoordinator } from '../shared/newline'
import { hostLineStart } from './addonDocNav'

/** 解析输入框文本为行号；非法形状返回 null（调用方按本地化提示反馈）。 */
export function parseGotoLineInput(raw: string): number | null {
  const text = raw.trim()
  // 纯十进制正整数：无正负号、无小数点、无指数/十六进制、无内部空白
  if (!/^\d+$/.test(text)) {
    return null
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1) {
    return null
  }
  return value
}

/**
 * 输入框校验（showInputBox 的 validateInput 唯一判定）：空值、形状非法与
 * 越界一律未通过——空值同样是「需要本地化反馈」的非法输入，不得提前放行
 * 后静默退出（#638：取消由 showInputBox 返回 undefined 单独处理，与空提交
 * 不是同一条路）。
 */
export function isValidGotoLineInput(raw: string, lineCount: number): boolean {
  const line = parseGotoLineInput(raw)
  return line !== null && line <= lineCount
}

/**
 * 1-based 行号 → webview LF 行首偏移；行不存在返回 null（调用方按最新行数
 * 反馈越界）。宿主行首偏移复用 addonDocNav 的 hostLineStart（#534 行号落位
 * 同一事实源，不建第二套行扫描），CRLF 折算由 NewlineCoordinator 收口。
 */
export function gotoLineLfOffset(hostText: string, line: number): number | null {
  const hostOffset = hostLineStart(hostText, line)
  if (hostOffset === null) {
    return null
  }
  return new NewlineCoordinator(hostText).hostOffsetToLf(hostOffset)
}
