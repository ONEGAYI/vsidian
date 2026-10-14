// Mermaid 暗色主题装配（工单 #110）：暗色分支的 themeVariables 与 VSCode
// 注入色板（--vscode-* 计算值）对齐——墨水色组（连线、信号线、文字）取
// 编辑器前景色，节点组取编辑器部件底色与描边，边标签底取编辑器画布底。
// 变量缺失（测试环境、宿主未注入）回退到与 Dark Modern 量级一致的暗色
// 兜底；亮色分支不经过本模块（维持 #60 现状）。
//
// 只覆盖对齐正文所需的最小键集：其余变量由 mermaid dark 基底主题自行
// 派生（本身已是暗色友好取值），避免整套主题硬编码后随上游版本漂移。

/** VSCode 侧取值来源（webview 由 VSCode 自动注入，宿主不手动注入） */
export interface VscodeMermaidPalette {
  /** 墨水色：连线、信号线、各类文字（--vscode-editor-foreground） */
  foreground: string
  /** 画布底：边标签背景（--vscode-editor-background） */
  background: string
  /** 节点填充（--vscode-editorWidget-background） */
  widgetBackground: string
  /** 节点描边（--vscode-editorWidget-border） */
  widgetBorder: string
}

/** 兜底色板：jsdom 单测与变量未注入环境的确定性取值 */
export const MERMAID_DARK_FALLBACK_PALETTE: Readonly<VscodeMermaidPalette> = {
  foreground: '#cccccc',
  background: '#1f1f1f',
  widgetBackground: '#2d2d30',
  widgetBorder: '#3c3c3c',
}

/** Codex 截图的近似预设；流程图与其他六种图分别配色，保留源码覆写。 */
export function buildCodexMermaidConfig(type = 'flowchart'): Record<string, unknown> | undefined {
  if (!type.startsWith('flowchart')) {
    if (!['sequence', 'class', 'classDiagram', 'state', 'stateDiagram', 'er', 'gantt', 'pie'].includes(type)) {
      return undefined
    }
    return {
      theme: 'base', htmlLabels: false,
      fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      themeCSS: '& { background-color:#ffffff; }\n.grid .tick line { stroke:#8e8f90; }' +
        (type === 'state' || type === 'stateDiagram' ? '\nmarker path { fill:#8e8f90; stroke:#8e8f90; }' : ''),
      themeVariables: {
        darkMode: false, background: '#ffffff',
        primaryColor: '#e0edfe', primaryTextColor: '#1a1c1f', primaryBorderColor: '#539af8',
        secondaryColor: '#e0edfe', secondaryTextColor: '#1a1c1f',
        tertiaryColor: '#e0edfe', tertiaryTextColor: '#1a1c1f',
        lineColor: '#8e8f90', arrowheadColor: '#8e8f90', textColor: '#1a1c1f', titleColor: '#1a1c1f',
        fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
        edgeLabelBackground: '#eff6fe',
        actorLineColor: '#8e8f90', signalColor: '#8e8f90', signalTextColor: '#1a1c1f',
        labelBoxBkgColor: '#ffffff', labelBoxBorderColor: '#ededed',
        activationBkgColor: '#ffffff', activationBorderColor: '#ededed',
        noteBkgColor: '#ffffff', noteBorderColor: '#6bc67f', noteTextColor: '#1a1c1f',
        sequenceNumberColor: '#c6c7c7',
        compositeBackground: '#e0edfe', compositeTitleBackground: '#e0edfe',
        attributeBackgroundColorOdd: '#ffffff', attributeBackgroundColorEven: '#f9fbff',
        sectionBkgColor: '#ffffff', sectionBkgColor2: '#f9fbff', altSectionBkgColor: '#ffffff',
        gridColor: '#8e8f90',
        taskBkgColor: '#e0edfe', taskBorderColor: '#539af8',
        activeTaskBkgColor: '#e0edfe', activeTaskBorderColor: '#539af8',
        doneTaskBkgColor: '#ffffff', doneTaskBorderColor: '#ededed',
        critBkgColor: '#ffffff', critBorderColor: '#6bc67f',
        taskTextColor: '#1a1c1f', taskTextDarkColor: '#1a1c1f',
        taskTextLightColor: '#1a1c1f', taskTextOutsideColor: '#1a1c1f',
        pie1: '#539af8', pie2: '#6bc67f', pie3: '#ef8b57',
        pie4: '#f8d45d', pie5: '#b897f4', pie6: '#f68ebc',
        pieOpacity: '0.7', pieStrokeColor: '#ffffff', pieStrokeWidth: '2px',
        pieOuterStrokeWidth: '0px', pieSectionTextColor: '#1a1c1f',
        pieLegendTextColor: '#1a1c1f', pieTitleTextColor: '#1a1c1f',
      },
    }
  }
  return {
    theme: 'base', layout: 'elk', htmlLabels: false,
    themeVariables: {
      primaryColor: '#e5f3ff', primaryTextColor: '#004f99', primaryBorderColor: '#cedbe5',
      secondaryColor: '#f5faff', tertiaryColor: '#f5faff',
      lineColor: '#cedbe5', textColor: '#004f99', fontSize: '14px',
      fontFamily: 'system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      edgeLabelBackground: 'transparent', clusterBkg: '#f5faff', clusterBorder: '#cedbe5',
    },
    flowchart: { htmlLabels: false, useMaxWidth: false, padding: 16, wrappingWidth: 320, curve: 'linear', nodeSpacing: 40, rankSpacing: 40 },
    elk: { nodePlacementStrategy: 'LINEAR_SEGMENTS', mergeEdges: false, considerModelOrder: 'NODES_AND_EDGES', forceNodeModelOrder: true },
    themeCSS: '.node rect.label-container { rx:16px; ry:16px; stroke-width:1px; }\n' +
      '.node polygon.label-container { fill:#f5faff; }\n' +
      '.node .label, .edgeLabel { font-weight:600; }\n' +
      '.flowchart-link { stroke-linecap:round; stroke-linejoin:round; }',
  }
}

/** 解析宿主注入的 VSCode 色板；无 DOM 或变量缺失的键不出现（走兜底） */
export function resolveVscodeMermaidPalette(root?: HTMLElement): Partial<VscodeMermaidPalette> {
  if (typeof document === 'undefined') {
    return {}
  }
  const style = getComputedStyle(root ?? document.body)
  const read = (name: string): string | undefined => {
    const value = style.getPropertyValue(name).trim()
    return value === '' ? undefined : value
  }
  return {
    foreground: read('--vscode-editor-foreground'),
    background: read('--vscode-editor-background'),
    widgetBackground: read('--vscode-editorWidget-background'),
    widgetBorder: read('--vscode-editorWidget-border'),
  }
}

/** 色板 → mermaid 暗色 themeVariables（纯函数；键集见文件头注释） */
export function buildDarkMermaidThemeVariables(palette: Partial<VscodeMermaidPalette>): Record<string, string> {
  const foreground = palette.foreground ?? MERMAID_DARK_FALLBACK_PALETTE.foreground
  const background = palette.background ?? MERMAID_DARK_FALLBACK_PALETTE.background
  const widgetBackground = palette.widgetBackground ?? MERMAID_DARK_FALLBACK_PALETTE.widgetBackground
  const widgetBorder = palette.widgetBorder ?? MERMAID_DARK_FALLBACK_PALETTE.widgetBorder
  return {
    primaryColor: widgetBackground,
    primaryTextColor: foreground,
    primaryBorderColor: widgetBorder,
    // mermaid dark 基底会把 primaryColor 压暗约 35% 再派生 mainBkg（实测
    // #313131 → #1f2020，节点体块与画布近乎零色差）；直接覆写 mainBkg
    // 保住节点体块感，描边与文字仍由前景色承担辨识
    mainBkg: widgetBackground,
    lineColor: foreground,
    signalColor: foreground,
    signalTextColor: foreground,
    textColor: foreground,
    edgeLabelBackground: background,
  }
}
