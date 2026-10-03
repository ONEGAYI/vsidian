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
})
