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
  /** #131 全局暂停标志：true = 冻结全部片段下发（编辑器侧撤下、新面板
   *  不装），但逐片段开关保持原样（恢复按原配置立即生效）。与逐项停用
   *  语义正交：暂停不清 enabled，停用不动 paused。持久化以支持重启回显 */
  paused: boolean
}

/** 单个片段条目（宿主权威状态的列表项） */
export interface CssSnippetEntry {
  name: string
  enabled: boolean
}

/** #129 条目拒绝信息：越界/符号链接逃逸（清单装配排除；设置页提示） */
export interface CssSnippetRejection {
  /** path-escape：词法越界（../ 逃逸、根相对、file: 等非片段资源面引用）；
   *  symlink-escape：realpath 落在片段目录之外 */
  reason: 'path-escape' | 'symlink-escape'
  /** 逃逸目标路径（用户提示与诊断） */
  path: string
}

/** 宿主权威状态（webview 无关）：设置页显示与编辑器清单装配共用 */
export interface CssSnippetState {
  directory: string | null
  /** 最近一次目录读取失败（true 时 entries 为最近成功清单，编辑器保留样式） */
  readError: boolean
  /** #131 全局暂停（冻结下发；开关与清单照常维护） */
  paused: boolean
  /** 第一层 .css 文件条目（确定性文件名排序） */
  entries: readonly CssSnippetEntry[]
  /** 清单版本：每次成功重扫与开关/目录/暂停变更递增（列表级消息拍与
   *  webview URI 缓存击穿用；入口级 ?v= 击穿参数另经宿主 getLinkItems
   *  的 contentVersions 承载） */
  version: number
  /** #129 被拒条目（name → 拒绝信息）：引用逃出片段目录的启用条目，
   *  清单装配排除；编辑修复后自动清除。仅对启用条目分析 */
  rejections: Record<string, CssSnippetRejection>
}

/** 编辑器 webview 的装载清单（宿主按面板 asWebviewUri 转换后经协议下发） */
export interface SnippetLinkList {
  version: number
  /** v：入口级缓存击穿版本（#129 依赖归因——入口自身或其依赖闭包变更时
   *  推进；缺省回退列表版本，兼容仅列表级语义的旧装配方） */
  snippets: Array<{ name: string; uri: string; v?: number }>
}

/** 目录第一层文件是否算独立片段：扩展名 .css（大小写不敏感） */
export function isSnippetFileName(name: string): boolean {
  return name.length >= 4 && name.toLowerCase().endsWith('.css')
}

/**
 * 目录条目类型按位判定（vscode.FileSystemEntryType 是位掩码，vscode.d.ts
 * 明示 type 可能为组合值）：命中 mask 中任一置位即接受。目录扫描用
 * File|SymbolicLink 组合 mask——严格相等（===）会漏掉 File|SymbolicLink(65)
 * 组合位（部分平台的符号链接文件形态），使符号链接片段不入清单，与「含
 * 符号链接文件」的目录语义矛盾。
 * 已知取舍：Directory|SymbolicLink(66) 同样带 SymbolicLink 位会命中——
 * 名为 *.css 的目录符号链接会进候选，后续 readFileText 读目录失败归并为
 * 不可读（既有降级路径），不会误装载；反向漏掉真文件是清单缺项，代价更高。
 * mask 由 vscode 壳用 vscode.FileType 常量拼装传入，本函数不依赖 vscode。
 */
export function fileTypeMatches(type: number, mask: number): boolean {
  return (type & mask) !== 0
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
 * null；enabled 只保留非空字符串键与布尔值；paused 只接受布尔（缺省/
 * 非布尔归 false——#128 存量无此字段）。永不抛错。
 */
export function sanitizeStoredCssSnippets(stored: unknown): StoredCssSnippetState {
  if (!isObject(stored)) {
    return { directory: null, enabled: {}, paused: false }
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
  return { directory, enabled, paused: stored.paused === true }
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
