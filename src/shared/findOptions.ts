// 查找选项单一事实源（#236）：
// - 三开关（matchCase/wholeWord/regexp）是查找面板与「选下一处相同词」
//   （#238）共享的匹配选项状态——本模块是其类型与纯函数的唯一权威，
//   消费方（webview 面板/引擎、宿主持久化）都从这里取类型
// - 默认档对齐 VSCode：三开关全关（大小写不敏感、非全字、字面量字符串）
// - 持久化：workspace 级记忆（宿主 workspaceState，见 host/findOptionsStore）
//   ——跨会话保留开关状态，与 VSCode storageService WORKSPACE 级口径一致

/** 查找选项（三开关统称「查找选项」；值为 true 表示该约束开启） */
export interface FindOptions {
  /** 区分大小写（VSCode Aa） */
  matchCase: boolean
  /** 全字匹配（VSCode ab） */
  wholeWord: boolean
  /** 正则模式（VSCode .*） */
  regexp: boolean
}

/** 默认值：三开关全关（对齐 VSCode 查找部件默认档） */
export const FIND_OPTIONS_DEFAULT: FindOptions = {
  matchCase: false,
  wholeWord: false,
  regexp: false,
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

/** 清洗未知来源的选项对象（协议消息 / 持久化存储）：字段缺省或类型非法回默认 */
export function sanitizeFindOptions(v: unknown): FindOptions {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    return { ...FIND_OPTIONS_DEFAULT }
  }
  const raw = v as Record<string, unknown>
  return {
    matchCase: isBoolean(raw['matchCase']) ? raw['matchCase'] : FIND_OPTIONS_DEFAULT.matchCase,
    wholeWord: isBoolean(raw['wholeWord']) ? raw['wholeWord'] : FIND_OPTIONS_DEFAULT.wholeWord,
    regexp: isBoolean(raw['regexp']) ? raw['regexp'] : FIND_OPTIONS_DEFAULT.regexp,
  }
}

/** 逐字段相等比较（广播去重 / 测试断言用） */
export function findOptionsEqual(a: FindOptions, b: FindOptions): boolean {
  return a.matchCase === b.matchCase && a.wholeWord === b.wholeWord && a.regexp === b.regexp
}

/** workspaceState 持久化键（工作区维度——各工作区独立记忆） */
export const FIND_OPTIONS_STORAGE_KEY = 'vsidian.findOptions'
