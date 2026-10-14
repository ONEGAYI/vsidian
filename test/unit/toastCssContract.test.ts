import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STYLE_CONTRACT_ENTRIES } from '../../src/shared/styleContract'
import { STYLE_CONTRACT_EN_OVERRIDES } from '../../src/shared/styleContractEn'

const css = readFileSync('src/webview/toast.css', 'utf8')
describe('轻提示公开样式入口', () => {
  it('公开容器、卡片和严重性规则保持零特异性，允许裸类片段覆盖', () => {
    for (const selector of [
      '#app', '.vscode-dark #app', '.vscode-high-contrast #app',
      '.vscode-high-contrast-light #app', '.vsidian-toast-container',
      '.vsidian-toast', '.vsidian-toast[data-severity="warning"]',
      '.vsidian-toast[data-severity="error"]', '.vsidian-toast--leaving',
    ]) expect(css).toContain(`:where(${selector})`)
  })
  it('所有 token 定义于 #app，实际被规则或控制器消费，并提供英文说明', () => {
    const controller = readFileSync('src/webview/toast.ts', 'utf8')
    const entries = STYLE_CONTRACT_ENTRIES.filter((entry) => entry.category === 'toast')
    const variables = entries.filter((entry) => entry.kind === 'variable')
    expect(variables).toHaveLength(23)
    for (const entry of entries) expect(STYLE_CONTRACT_EN_OVERRIDES[entry.id]?.purpose).toBeTruthy()
    for (const variable of variables) {
      expect(css.slice(0, css.indexOf('}\n')).includes(`${variable.target}:`)).toBe(true)
      if (!variable.target.endsWith('-duration') || variable.target.includes('-enter-') || variable.target.includes('-exit-')) {
        expect(css.includes(`var(${variable.target})`)).toBe(true)
      } else expect(controller).toContain('duration')
    }
  })
  it('定位不受正文滚动影响，提示不拦截输入，层级低于模态并支持减少动画', () => {
    expect(css).toContain('position: absolute')
    expect(css).toContain('z-index: 9000')
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain(':where(.vscode-dark #app)')
    expect(css).toContain('overflow-wrap: anywhere')
  })
  it('倒计时条右端锚定向左收缩，悬停/聚焦暂停，减少动画时静态满格', () => {
    expect(css).toContain(':where(.vsidian-toast-timer)')
    expect(css).toContain('right: 0')
    expect(css).toContain('height: 2px')
    expect(css).toContain('@keyframes vsidian-toast-timer-shrink')
    expect(css).toContain('from { width: 100%; }')
    expect(css).toContain('to { width: 0; }')
    expect(css).toContain(':where(.vsidian-toast:hover) :where(.vsidian-toast-timer)')
    expect(css).toContain(':where(.vsidian-toast:focus-within) :where(.vsidian-toast-timer)')
    expect(css).toContain('animation-play-state: paused')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain(':where(.vsidian-toast-timer)')
  })
  it('撤销按钮为次级形态（secondary 变量族 + 6px 圆角）；pointer-events 只对带按钮气泡放开（评审 F2）', () => {
    expect(css).toContain(':where(.vsidian-toast-action)')
    expect(css).toContain('--vscode-button-secondaryBackground')
    expect(css).toContain('--vscode-button-secondaryForeground')
    expect(css).toContain('--vscode-button-secondaryHoverBackground')
    expect(css).toContain('border-radius: 6px')
    // 无按钮气泡保持穿透（编辑器侧纯文字提示不拦截鼠标）；仅 :has(action)
    // 气泡放开——按钮可点、悬停/聚焦可暂停；容器恒 none（CRLF 行尾不进断言）
    expect(css).toContain(':where(.vsidian-toast:has(.vsidian-toast-action))')
    expect(css).toContain('pointer-events: auto')
    expect(css).toContain('pointer-events: none')
  })
})
