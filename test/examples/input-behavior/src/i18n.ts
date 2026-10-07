// 样例自身 i18n 惯例：独立扩展用自己的简单字典（zh/en 按宿主语言取值；
// 主仓库「locales + t()」体系是 Vsidian 本体的约定，不约束样例）。宿主侧
// 传 vscode.env.language，页面侧传 navigator.language。
const zh = {
  settingSmartSpace: '中英文之间自动空格',
  settingSmartParen: '括号自动补全',
  settingFullwidthPunct: '中文后标点全角化',
  behaviorSmartSpace: '中英文自动空格',
  behaviorSmartParen: '括号补全',
  behaviorFullwidthPunct: '标点全角化',
  descSmartSpace: '在中文与刚输入的英文字母或数字之间自动插入空格（借鉴 Easy Typing）',
  descSmartParen: '输入半角左括号时自动补出右括号，光标停在括号中间；随键入一起撤回',
  descFullwidthPunct: '中文字符后输入半角标点时自动转为对应全角标点',
  noHost: '当前扩展宿主中未找到 Vsidian（onegayi.vsidian）',
}

const en = {
  settingSmartSpace: 'Auto space between CJK and Latin',
  settingSmartParen: 'Auto close parentheses',
  settingFullwidthPunct: 'Fullwidth punctuation after CJK',
  behaviorSmartSpace: 'CJK/Latin smart spacing',
  behaviorSmartParen: 'Paren completion',
  behaviorFullwidthPunct: 'Fullwidth punctuation',
  descSmartSpace: 'Insert a space between CJK text and the just-typed Latin letter or digit (inspired by Easy Typing)',
  descSmartParen: 'Type the closing paren automatically with the caret inside; undo together with the keystroke',
  descFullwidthPunct: 'Convert half-width punctuation to full-width when typed after a CJK character',
  noHost: 'Vsidian (onegayi.vsidian) not found in this extension host',
}

export type ExampleMessages = typeof zh

/** 按语言标签取字典（zh* 取中文，其余取英文） */
export function pickMessages(language: string): ExampleMessages {
  return language.toLowerCase().startsWith('zh') ? zh : en
}
