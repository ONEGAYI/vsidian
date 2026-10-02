// 悬停提示浏览器回归的装配夹具（#300）：生产 installTooltipCard + 预置
// 提示目标（普通/带键位/态变空提示），经 window.tooltipProbe 暴露给
// Playwright 脚本驱动。--vscode-* 宿主变量在 headless 无注入，主题跟随
// 断言由脚本侧以 body 主题类 + 变量定义仿真宿主注入行为。
import { installTooltipCard, TOOLTIP_ATTR, TOOLTIP_KEYS_ATTR, TOOLTIP_KEYS_SEPARATOR } from '../../src/webview/tooltipCard'

installTooltipCard()

function makeButton(label: string, hoverText: string, keys?: string[]): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute(TOOLTIP_ATTR, hoverText)
  if (keys?.length) button.setAttribute(TOOLTIP_KEYS_ATTR, keys.join(TOOLTIP_KEYS_SEPARATOR))
  document.body.appendChild(button)
  return button
}

declare global {
  interface Window {
    tooltipProbe: {
      makeButton: (label: string, hoverText: string, keys?: string[]) => HTMLButtonElement
      setHoverText: (button: HTMLButtonElement, value: string) => void
    }
  }
}

window.tooltipProbe = {
  makeButton,
  setHoverText: (button, value) => {
    // 态变清空语义（find.invalid 迁移形态）：空值移除属性而非留空串
    if (value === '') button.removeAttribute(TOOLTIP_ATTR)
    else button.setAttribute(TOOLTIP_ATTR, value)
  },
}

export {}
