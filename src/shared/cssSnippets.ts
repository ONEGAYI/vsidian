// CSS 片段纯逻辑（#128）：持久化形态清洗、扫描合并与确定性排序的单一
// 事实源。宿主服务（host/cssSnippetService）、设置页分页
// （webview/cssSnippetSettings）与协议载荷（shared/protocol）共用，不依赖
// vscode / DOM。
//
// 语义依据 docs/specs/css-snippets.md「已确认行为」：
// - 用户级目录，环境内各项目共用；第一层 .css 是独立片段，新片段默认关闭。
// - 文件名确定加载顺序，同等层叠优先级后加载者优先（webview 按 DOM 顺序
//   装配 <link>，本模块只负责给出确定性顺序）。
// - 开关映射按文件名持久保存；文件暂时消失（编辑器原子保存的写临时文件
//   再替换）不清洗对应条目，避免误判为删除丢失用户选择。

/** 持久化形态：globalState 中的原始存储（storageKey 见 host 侧服务） */
export interface StoredCssSnippetState {
  /** 片段目录绝对路径（宿主平台 fsPath）；null = 未配置 */
  directory: string | null
  /** 文件名 → 显式开关。只记用户显式翻转过的项；未记录 = 默认关闭。
   *  文件暂时消失不清洗（原子保存保护）；目录更换时整体重置 */
  enabled: Record<string, boolean>
}

/** 单个片段条目（宿主权威状态的列表项） */
export interface CssSnippetEntry {
  name: string
  enabled: boolean
}

/** 宿主权威状态（webview 无关）：设置页显示与编辑器清单装配共用 */
export interface CssSnippetState {
  directory: string | null
  /** 最近一次目录读取失败（true 时 entries 为最近成功清单，编辑器保留样式） */
  readError: boolean
  /** 第一层 .css 文件条目（确定性文件名排序） */
  entries: readonly CssSnippetEntry[]
  /** 清单版本：每次成功重扫与开关/目录变更递增（webview URI 缓存击穿用） */
  version: number
}

/** 编辑器 webview 的装载清单（宿主按面板 asWebviewUri 转换后经协议下发） */
export interface SnippetLinkList {
  version: number
  snippets: Array<{ name: string; uri: string }>
}

/** 目录第一层文件是否算独立片段：扩展名 .css（大小写不敏感） */
export function isSnippetFileName(name: string): boolean {
  return name.length >= 4 && name.toLowerCase().endsWith('.css')
}

/**
 * 确定性文件名排序：UTF-16 code unit 逐位比较。不依赖 locale（localeCompare
 * 结果随系统 locale 漂移），保证同一目录在任何机器上产出同一加载顺序。
 */
export function compareSnippetNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 扫描合并：文件名列表 × 开关映射 → 排序条目。未出现在映射中的文件默认
 * 关闭；映射中的多余键（文件已删除）不产出条目——开关条目保留在持久层
 * （原子保存保护），但清单只列当前存在的文件。
 */
export function mergeScanEntries(
  names: readonly string[],
  enabled: Readonly<Record<string, boolean>>,
): CssSnippetEntry[] {
  return [...new Set(names)]
    .sort(compareSnippetNames)
    .map((name) => ({ name, enabled: enabled[name] === true }))
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 存量清洗：持久层读出的任意 JSON → 合法存储形态。
 * 规则：非对象整体视为默认（未配置目录）；directory 只接受非空字符串或
 * null；enabled 只保留非空字符串键与布尔值。永不抛错。
 */
export function sanitizeStoredCssSnippets(stored: unknown): StoredCssSnippetState {
  if (!isObject(stored)) {
    return { directory: null, enabled: {} }
  }
  const directory =
    typeof stored.directory === 'string' && stored.directory.length > 0
      ? stored.directory
      : null
  const enabled: Record<string, boolean> = {}
  if (isObject(stored.enabled)) {
    for (const [name, value] of Object.entries(stored.enabled)) {
      if (name.length > 0 && typeof value === 'boolean') {
        enabled[name] = value
      }
    }
  }
  return { directory, enabled }
}

/** 当前启用（且目录已配置）的片段文件名，按确定性顺序（自身保证排序，
 *  不依赖 entries 的传入顺序——加载顺序即层叠顺序，是公开承诺） */
export function enabledSnippetFiles(state: CssSnippetState): string[] {
  if (!state.directory) {
    return []
  }
  return state.entries
    .filter((entry) => entry.enabled)
    .map((entry) => entry.name)
    .sort(compareSnippetNames)
}
