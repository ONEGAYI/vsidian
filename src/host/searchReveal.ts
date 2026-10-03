// #318 外部搜索导航定位恢复（显式命令路径的核心纯逻辑）。
// VSCode 公开 API 不向 custom editor 透传 selection（microsoft/vscode#289785；
// 1.82.3 实测扩展侧零信号），恢复路径是：搜索树保留被点击条目的选中态，
// 经内部命令 search.action.copyMatch 把「起始行列 + 匹配行全文」写入剪贴板
// 后回读，与目标文档行文本配对恢复定位意图，再经 view.locate 落位（LF
// 坐标换算由 wiring 层完成）。仅由用户显式触发（命令/自配键位）；面板
// 激活自动捕获已按 #318 票面停止条件移除（残留选中歧义误定位实证等三项
// 证据，见票内原型验证结论评论），官方 API 落地后的完整选区恢复路径见
// docs/specs/search-reveal.md。
// 已知边界（1.82.3 实测）：copyMatch 不提供文件路径与匹配结束位置——文件
// 身份靠激活文档行文本吻合确认（吻合失败即放弃，不误定位）；结束位置缺失
// 时只能单点定位（不选词）。

/** copyMatch 剪贴板输出（1.82.3 实测格式：`1-based行,1-based列: 匹配行全文`，
 *  行列口径为 workbench Range 的 1-based） */
export interface SearchMatchProbe {
  /** 匹配起始行（1-based） */
  line: number
  /** 匹配起始列（1-based） */
  col: number
  /** 匹配所在行全文（不含行尾符） */
  text: string
}

/** 解析 copyMatch 输出。非匹配级输出（无选中或文件级选中时命令 no-op 不写
 *  剪贴板，回读到的是恢复用哨兵或无关文本）、多行文本、0 基行列一律 null
 *  ——调用方以 null 安全放弃，不误定位。只剥行尾换行符不做整体 trim：
 *  空行匹配（正则 ^$）的输出 `N,1: ` 尾随空格是文本区的一部分 */
export function parseCopyMatch(raw: string): SearchMatchProbe | null {
  const match = /^([1-9]\d*),([1-9]\d*): ([^\n\r]*)$/.exec(raw.replace(/\r?\n$/, ''))
  if (!match) {
    return null
  }
  return { line: Number(match[1]), col: Number(match[2]), text: match[3] ?? '' }
}

/** 与文档文本配对：probe 行列在文档范围内且该行文本（剥除 \r）与预览吻合
 *  时，返回匹配起始的宿主系 offset（行尾 \r 原样计入）；行号越界或行文本
 *  不吻合返回 null。行文本吻合是文件身份的唯一校验——残留选中条目配对到
 *  其他文件（行号恰同、内容不同）时在此拦下 */
export function matchHostOffset(docText: string, probe: SearchMatchProbe): number | null {
  const lines = docText.split('\n')
  if (probe.line < 1 || probe.line > lines.length) {
    return null
  }
  const rawLine = lines[probe.line - 1] ?? ''
  const lineText = rawLine.replace(/\r$/, '')
  if (lineText !== probe.text) {
    return null
  }
  let offset = 0
  for (let i = 0; i < probe.line - 1; i++) {
    offset += (lines[i] ?? '').length + 1
  }
  return offset + Math.min(probe.col - 1, lineText.length)
}

/** #318 打开提示门控（纯逻辑，wiring 在面板激活分支调用）：会话内该
 *  文档未提示过且设置开关开启的合取。去重语义 = 每文档每会话最多一条
 *  （带按钮的宿主通知不自动消失，去重是噪音上限；内存 Set 会话级不
 *  持久化）。记账约定：仅判 true（实际弹出）后调用方才记入集合——
 *  设置关闭期间的激活不占用名额，重开设置后该文档仍可提示一次 */
export function shouldShowSearchRevealHint(
  shownUris: ReadonlySet<string>,
  uriString: string,
  hintEnabled: boolean,
): boolean {
  return hintEnabled && !shownUris.has(uriString)
}
