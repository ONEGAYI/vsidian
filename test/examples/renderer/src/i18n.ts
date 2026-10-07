// 样例自身 i18n 惯例：独立扩展用自己的简单字典（zh/en 按宿主语言取值）。
const zh = {
  settingTheme: '渲染样式',
  settingShowSource: '显示源码行',
  providerMermaidLite: 'Mermaid Lite（样例）',
  providerFlowPlain: '流程图·朴素（样例）',
  providerFlowBoxed: '流程图·卡片（样例）',
  providerFlowBuggy: '流程图·带缺陷（样例）',
  noHost: '当前扩展宿主中未找到 Vsidian（onegayi.vsidian）',
}

const en = {
  settingTheme: 'Render style',
  settingShowSource: 'Show source line',
  providerMermaidLite: 'Mermaid Lite (example)',
  providerFlowPlain: 'Flow · plain (example)',
  providerFlowBoxed: 'Flow · boxed (example)',
  providerFlowBuggy: 'Flow · buggy (example)',
  noHost: 'Vsidian (onegayi.vsidian) not found in this extension host',
}

export type ExampleMessages = typeof zh

/** 按语言标签取字典（zh* 取中文，其余取英文） */
export function pickMessages(language: string): ExampleMessages {
  return language.toLowerCase().startsWith('zh') ? zh : en
}
