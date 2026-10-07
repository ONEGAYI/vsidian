// 样例自身 i18n 惯例：独立扩展用自己的简单字典（zh/en 按宿主语言取值）。
const zh = {
  settingTimestampFormat: '时间戳格式',
  settingAutoOpenPanel: '挂载后自动打开统计面板',
  settingPanel: '统计面板',
  settingPanelTitle: '面板标题',
  settingPanelShowLines: '显示行数',
  settingSummarizeIgnore: '统计忽略字符',
  commandInsertTimestamp: '插入时间戳',
  commandSummarize: '文档统计',
  menuInsertTimestamp: '插入时间戳',
  buttonTimestamp: '插入时间戳',
  buttonSummarize: '文档统计',
  panelDocStats: '文档统计',
  panelChars: '字符数',
  panelLines: '行数',
  panelMode: '模式',
  noHost: '当前扩展宿主中未找到 Vsidian（onegayi.vsidian）',
  settingsPageTitle: '界面样例设置',
  settingsScopeUser: '用户默认',
  settingsScopeWorkspace: '工作区覆盖',
  settingsSave: '保存',
  settingsSaved: '已保存',
  settingsSaveFailed: '保存失败',
}

const en = {
  settingTimestampFormat: 'Timestamp format',
  settingAutoOpenPanel: 'Open stats panel on mount',
  settingPanel: 'Stats panel',
  settingPanelTitle: 'Panel title',
  settingPanelShowLines: 'Show line count',
  settingSummarizeIgnore: 'Characters ignored by summarize',
  commandInsertTimestamp: 'Insert timestamp',
  commandSummarize: 'Summarize document',
  menuInsertTimestamp: 'Insert timestamp',
  buttonTimestamp: 'Insert timestamp',
  buttonSummarize: 'Summarize',
  panelDocStats: 'Document stats',
  panelChars: 'Characters',
  panelLines: 'Lines',
  panelMode: 'Mode',
  noHost: 'Vsidian (onegayi.vsidian) not found in this extension host',
  settingsPageTitle: 'UI example settings',
  settingsScopeUser: 'User default',
  settingsScopeWorkspace: 'Workspace override',
  settingsSave: 'Save',
  settingsSaved: 'Saved',
  settingsSaveFailed: 'Save failed',
}

export type ExampleMessages = typeof zh

/** 按语言标签取字典（zh* 取中文，其余取英文） */
export function pickMessages(language: string): ExampleMessages {
  return language.toLowerCase().startsWith('zh') ? zh : en
}
