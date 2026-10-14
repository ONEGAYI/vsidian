// Mermaid 暗色主题装配契约（工单 #110）：themeVariables 映射纯函数——
// VSCode 色板（--vscode-* 计算值）→ mermaid 暗色取值；空色板回退到与
// Dark Modern 量级一致的暗色兜底；关键墨水色对画布底满足 WCAG AA。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  MERMAID_DARK_FALLBACK_PALETTE,
  buildDarkMermaidThemeVariables,
  buildCodexMermaidConfig,
  resolveVscodeMermaidPalette,
  type VscodeMermaidPalette,
} from '../../src/webview/mermaidTheme'

describe('Codex Mermaid 截图参考配色', () => {
  it.each(['sequence', 'class', 'classDiagram', 'state', 'stateDiagram', 'er', 'gantt', 'pie'])(
    '%s 暗色模式按参考图使用深蓝节点、白字与深灰画布',
    (type) => {
      const config = buildCodexMermaidConfig(type, true)!
      expect(config).toMatchObject({
        theme: 'base',
        themeVariables: {
          darkMode: true, background: '#181818',
          primaryColor: '#1a283d', primaryBorderColor: '#1f4e94',
          primaryTextColor: '#ffffff', lineColor: '#8b8b8b',
        },
      })
      expect(config.themeCSS).toContain('& { background-color:#181818; }')
      expect(config).not.toHaveProperty('layout')
    },
  )

  it('暗色 ER 表格的两种行底色都保持白字可读，饼图保留深色六色盘', () => {
    const config = buildCodexMermaidConfig('er', true)!
    const tv = config.themeVariables as Record<string, string>
    expect(tv.rowOdd).toBe('#1a283d')
    expect(tv.rowEven).toBe('#22344f')
    for (const background of [tv.primaryColor!, tv.attributeBackgroundColorOdd!, tv.attributeBackgroundColorEven!, tv.rowOdd!, tv.rowEven!]) {
      expect(contrast(tv.primaryTextColor!, background)).toBeGreaterThanOrEqual(4.5)
    }
    expect(buildCodexMermaidConfig('pie', true)).toMatchObject({
      themeVariables: { pie1: '#1f4e94', pie2: '#3a843f', pieSectionTextColor: '#ffffff', pieStrokeColor: '#181818' },
    })
  })

  it.each(['sequence', 'class', 'classDiagram', 'state', 'stateDiagram', 'er', 'gantt', 'pie'])(
    '%s 使用六张参考图的浅蓝边框与深灰文字，不沿用流程图 ELK 布局',
    (type) => {
      const config = buildCodexMermaidConfig(type)
      expect(config).toMatchObject({
        theme: 'base',
        themeVariables: {
          primaryColor: '#e0edfe',
          primaryBorderColor: '#539af8',
          primaryTextColor: '#1a1c1f',
          lineColor: '#8e8f90',
        },
      })
      expect(config).not.toHaveProperty('layout')
      expect(config).not.toHaveProperty('elk')
    },
  )

  it('甘特分区按原生 0.2 透明度叠加成参考中的深灰条带', () => {
    expect(buildCodexMermaidConfig('gantt', true)).toMatchObject({
      themeVariables: { sectionBkgColor: '#222222', sectionBkgColor2: '#18273b', altSectionBkgColor: '#ffffff' },
    })
  })

  it('保留既有流程图预设，未采集参考的图类型不套用预设', () => {
    expect(buildCodexMermaidConfig('flowchart-v2')).toMatchObject({
      layout: 'elk', themeVariables: {
        primaryColor: '#e5f3ff', primaryTextColor: '#004f99',
        primaryBorderColor: '#b8b9ba', lineColor: '#b8b9ba',
      },
    })
    expect(buildCodexMermaidConfig('mindmap')).toBeUndefined()
  })

  it('流程图的固定蓝色文字配白色画布，弹窗与导出保持同一背景', () => {
    const config = buildCodexMermaidConfig('flowchart-v2')!
    expect(config.themeCSS).toContain('& { background-color:#ffffff; }')
    expect(contrast('#004f99', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('流程图暗色使用深蓝节点和白字，保留 ELK 布局与指定辅助灰', () => {
    const config = buildCodexMermaidConfig('flowchart-v2', true)!
    expect(config).toMatchObject({
      layout: 'elk', themeVariables: {
        darkMode: true, primaryColor: '#1a283d', primaryTextColor: '#ffffff',
        primaryBorderColor: '#b8b9ba', lineColor: '#b8b9ba', clusterBorder: '#b8b9ba',
      },
    })
    expect(config.themeCSS).toContain('& { background-color:#181818; }')
    expect(contrast('#ffffff', '#1a283d')).toBeGreaterThanOrEqual(4.5)
  })
})

/** 相对亮度（WCAG）：sRGB → 线性 → L */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) {
    throw new Error(`非 6 位十六进制色值: ${hex}`)
  }
  const n = parseInt(m[1]!, 16)
  const chan = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe('buildDarkMermaidThemeVariables', () => {
  it('空色板（变量未注入/测试环境）：全部键有非空兜底值', () => {
    const tv = buildDarkMermaidThemeVariables({})
    for (const key of [
      'primaryColor',
      'primaryTextColor',
      'primaryBorderColor',
      'lineColor',
      'signalColor',
      'signalTextColor',
      'textColor',
      'edgeLabelBackground',
    ]) {
      expect(typeof tv[key], `${key} 应为字符串`).toBe('string')
      expect((tv[key] as string).length, `${key} 不为空`).toBeGreaterThan(0)
    }
  })

  it('提供的色板值优先于兜底（--vscode-* 计算值直通）', () => {
    const palette: VscodeMermaidPalette = {
      foreground: '#d4d4d4',
      background: '#1a1b1c',
      widgetBackground: '#303031',
      widgetBorder: '#454545',
    }
    const tv = buildDarkMermaidThemeVariables(palette)
    expect(tv['primaryTextColor']).toBe('#d4d4d4')
    expect(tv['lineColor']).toBe('#d4d4d4')
    expect(tv['signalColor']).toBe('#d4d4d4')
    expect(tv['signalTextColor']).toBe('#d4d4d4')
    expect(tv['textColor']).toBe('#d4d4d4')
    expect(tv['primaryColor']).toBe('#303031')
    expect(tv['primaryBorderColor']).toBe('#454545')
    expect(tv['edgeLabelBackground']).toBe('#1a1b1c')
  })

  it('兜底取值满足可读性：连线/文字对画布底 ≥ 4.5:1，节点文字对节点底 ≥ 4.5:1', () => {
    const tv = buildDarkMermaidThemeVariables({})
    expect(contrast(tv['lineColor']!, MERMAID_DARK_FALLBACK_PALETTE.background!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tv['signalTextColor']!, MERMAID_DARK_FALLBACK_PALETTE.background!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tv['primaryTextColor']!, tv['primaryColor']!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('resolveVscodeMermaidPalette（取值链路，#110）', () => {
  it('读取注入元素的 --vscode-* 计算值并 trim；缺失键不出现（走兜底）', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.style.setProperty('--vscode-editor-foreground', ' #cccccc ')
    root.style.setProperty('--vscode-editor-background', '#1f1f1f')
    const palette = resolveVscodeMermaidPalette(root)
    expect(palette.foreground).toBe('#cccccc')
    expect(palette.background).toBe('#1f1f1f')
    expect(palette.widgetBackground).toBeUndefined()
    expect(palette.widgetBorder).toBeUndefined()
    root.remove()
  })
})
