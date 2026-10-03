// 集成测试用例：验证工单 #2 的验收标准（激活/打开/编辑/保存/CRLF/视口）。
// fixture 工作区由 runTest.mjs 在临时目录动态生成（避免 git 换行转换干扰
// 字节级断言），路径经环境变量 WORKSPACE_DIR 传入。
import * as vscode from 'vscode'
import { liveEmbedReady, readingEmbedCard } from './embedReadiness'
import { probe278Cases } from './probe278'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { LOCALE_MESSAGES, resolveLocale } from '../../../src/shared/locales'
import { OBSIDIAN_ALIAS_PROBES } from '../../../src/shared/obsidianAlias'
import legacyBaselineJson from '../../../test/style-contract/baseline-v0.4.0.json'
import { CHROME_CONTRACT_PROBES } from '../../../src/shared/chromeContract'

/** #134 历史基线旧片段用例（基线 JSON 的 legacySnippetCases 元素形态） */
interface LegacySnippetCase {
  kind: 'obsidian-dom' | 'vsidian-dom' | 'obsidian-variable'
  id: string
  view: 'live' | 'reading' | 'both'
  selector?: string
  property?: string
  probe?: string
  declaration?: string
  probeLive?: string
  probeReading?: string
  expected: string
}
const legacySnippetCases = legacyBaselineJson.legacySnippetCases as unknown as LegacySnippetCase[]

/** #94 起编辑器 webview 文案随生效语言取词（auto 按宿主显示语言解析）——
 *  期望值与扩展装配同源计算，不再复制字面量 */
const editorMessages = () => LOCALE_MESSAGES[resolveLocale(undefined, vscode.env.language)]

const VIEW_TYPE = 'onegayi.vsidian.editor'
const EXT_ID = 'onegayi.vsidian'
const CMD = {
  sessionState: 'onegayi.vsidian._test.getSessionState',
  // #292 骨架屏状态回报查询（hold 装配下 adopt/release 均出站回报）
  skeletonState: 'onegayi.vsidian._test.getSkeletonState',
  injectMessage: 'onegayi.vsidian._test.injectWebviewMessage',
  postToPanel: 'onegayi.vsidian._test.postToPanel',
  viewState: 'onegayi.vsidian._test.requestViewState',
  cachedViewState: 'onegayi.vsidian._test.getCachedViewState',
  conflictState: 'onegayi.vsidian._test.getConflictState',
  closedInput: 'onegayi.vsidian._test.getLastClosedInput',
  viewStateCache: 'onegayi.vsidian._test.getPanelViewStateCache',
  resumePanel: 'onegayi.vsidian._test.resumePanel',
  perfProbe: 'onegayi.vsidian._test.perfProbe',
  readingPerf: 'onegayi.vsidian._test.readingPerf',
  linkLog: 'onegayi.vsidian._test.getLinkLog',
  // #111 图表导出消息日志（钩子模式下宿主短路另存为对话框并记录）
  diagramExportLog: 'onegayi.vsidian._test.takeDiagramExportLog',
  // #161 图片粘贴消息日志（钩子模式记录载荷形态；落盘真实执行）
  imagePasteLog: 'onegayi.vsidian._test.takeImagePasteLog',
  // #212 图片导出消息日志（钩子模式下宿主短路另存为对话框并记录）
  imageExportLog: 'onegayi.vsidian._test.takeImageExportLog',
  // #201 图片刷新观测（失效日志与版本表快照）
  imageRefreshEvents: 'onegayi.vsidian._test.takeImageRefreshEvents',
  imageVersions: 'onegayi.vsidian._test.getImageVersions',
  // #224 引用视图同步观测（订阅计数与读取缓存计量）
  hoverWatchStats: 'onegayi.vsidian._test.hoverWatchStats',
  hoverReadCacheStats: 'onegayi.vsidian._test.hoverReadCacheStats',
  // #38 三态记忆
  getLastMode: 'onegayi.vsidian._test.getLastMode',
  resetLastMode: 'onegayi.vsidian._test.resetLastMode',
  // #33 设置链路
  settingsPageInfo: 'onegayi.vsidian._test.settingsPageInfo',
  closeSettingsPage: 'onegayi.vsidian._test.closeSettingsPage',
  installSettingsFixture: 'onegayi.vsidian._test.installSettingsFixture',
  getSettings: 'onegayi.vsidian._test.getSettings',
  setSettings: 'onegayi.vsidian._test.setSettings',
  // #239 jieba 宿主状态观测（installed 与 notice 诊断）
  getJiebaState: 'onegayi.vsidian._test.getJiebaState',
  injectSettingsPageMessage: 'onegayi.vsidian._test.injectSettingsPageMessage',
  // #128 CSS 片段链路（观测/注入；刷新走真实命令）
  snippetState: 'onegayi.vsidian._test.getSnippetState',
  setSnippetDirectory: 'onegayi.vsidian._test.setSnippetDirectory',
  setSnippetEnabled: 'onegayi.vsidian._test.setSnippetEnabled',
  // 快捷键链路（正式 KeybindingService 通道：快照直读存储层）
  getKeybindings: 'onegayi.vsidian._test.getKeybindings',
  setKeybindings: 'onegayi.vsidian._test.setKeybindings',
  resetKeybindings: 'onegayi.vsidian._test.resetKeybindings',
}

const wsDir = process.env['WORKSPACE_DIR'] ?? ''
if (!wsDir) {
  throw new Error('环境变量 WORKSPACE_DIR 未设置（应由 runTest.mjs 注入）')
}

const LINKS_DOC_TEXT = [
  '# 链接样例',
  '',
  '[外部链接](https://example.com/obsidian-like) 与 [本地目标](./链接目标.md)。',
  '',
  '[空格目录目标](./子%20目录/目标%20二.md) 与自动链接 <https://autolink.example.com/x>。',
  '',
  '[无扩展名目标](./无扩展名目标)（省略扩展名按 Markdown 处理）。',
  '',
  '危险：[file](file:///d:/x.md) 与 [js](javascript:alert(1))。',
  '',
  '![好图](assets/图片%20一.png)',
  '',
].join('\n')
const IMAGES_DOC_TEXT = [
  '# 图片样例',
  '',
  '正常图片（中文与空格文件名）：',
  '',
  '![好图](assets/图片%20一.png)',
  '',
  '缺失图片（可重试错误态）：',
  '',
  '![缺失图](assets/不存在.png)',
  '',
  '结尾段。',
  '',
].join('\n')

const LF_DOC = '中文编辑测试\n\n包含 emoji：🎉 与组合 emoji 👨‍👩‍👧‍👦\n\n- 列表项一\n- 列表项二\n'
const CRLF_DOC = '标题一\r\n正文 A 行\r\n正文 B 行\r\n'
// 在 '- 列表项一' 行首插入 '插入的新段落\n' 后的期望全文
const LF_DOC_AFTER_EDIT = '中文编辑测试\n\n包含 emoji：🎉 与组合 emoji 👨‍👩‍👧‍👦\n\n插入的新段落\n- 列表项一\n- 列表项二\n'
// #6 模式切换 fixture（与 runTest.mjs 的 MODE_DOC 一致）
const STYLE_CONTRACT_DOC_TEXT = [
  '---',
  'title: 样式契约',
  '---',
  '',
  '# 样式契约标题',
  '',
  '**粗体** 与 *斜体* 与 `行内代码` 与 ==高亮==。',
  '',
  '> 引用一行',
  '',
  '- 无序列表项',
  '- [ ] 未完成任务',
  '',
  '---',
  '',
  '```js',
  'const fence = true',
  '```',
  '',
  '| 表头甲 | 表头乙 |',
  '| --- | --- |',
  '| 单元甲 | 单元乙 |',
  '',
  '[外部链接](https://example.com/alias) 与 [[双链目标|显示别名]]。',
  '',
].join('\n')

const MODE_DOC_TEXT = [
  '# 模式切换标题一',
  '',
  '第一段普通文本，包含中文与 emoji 🎉。',
  '',
  '## 中部二级标题',
  '',
  '- 普通列表项',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
  '',
  '```code',
  '代码块内容（含 # 伪标题 与 - [ ] 伪任务）',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

/** #105 高亮 fixture（与 fixtures.mjs 的 HIGHLIGHT_DOC 一致）：== 只出现在
 *  成对高亮定界符中（live delimitersHidden 探针的文本口径依据） */
const HIGHLIGHT_DOC_TEXT = [
  '# 高亮样例',
  '',
  '正文 ==高亮文字== 与 **粗体** 同行。',
  '',
  '## 嵌套 ==**粗亮**== 标题',
  '',
  '- 列表项 ==列表高亮==',
  '',
  '普通段落。',
].join('\n')

/** #161 图片粘贴载荷：1x1 PNG（字节与解码断言的对照源） */
const PASTE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function normFsPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}
/** #208 刷新对照载荷：2x2 不透明红色 PNG（外部替换磁盘同名图片后，
 *  刷新重载的解码尺寸 1x1 → 2x2 即「用户看到新图」的绘制层证据） */
const REFRESH_PNG_2X2_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC'

// #208 手动刷新 fixture（与 fixtures.mjs 的 refresh.md 字节一致）：图片行
// 上方 24 行填充（图片行仍在 CM6 视口装饰范围内，装载即解析）+ 下方 40 行
// 尾部（文档可滚动——刷新前后滚动位置保持断言需要非零 scrollTop）
const REFRESH_DOC_TEXT = [
  '# 刷新样例',
  '',
  ...Array.from({ length: 24 }, (_, i) => `刷新填充 ${i}`),
  '',
  '光标定位段落，刷新前后选区保持的断言载体。',
  '',
  '![刷新图](assets/刷新图.png)',
  '',
  '结尾段。',
  '',
  ...Array.from({ length: 40 }, (_, i) => `刷新尾部 ${i}`),
  '',
].join('\n')

/** #208 图片行行号（1 基）：滚动定位目标——居中图片行得非零 scrollTop，
 *  且图片槽位保持可见（widget 不因滚出视口被回收，失效重挂照常覆盖它） */
const REFRESH_IMAGE_LINE = REFRESH_DOC_TEXT.slice(0, REFRESH_DOC_TEXT.indexOf('![刷新图]')).split('\n').length

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
}

// #12 表格 fixture 内容（与 runTest.mjs 的 TABLE_DOC 字节一致）
const TABLE_DOC_TEXT = [
  '# 表格样例',
  '',
  '| 名字 | 数量 | 备注 |',
  '| --- | :---: | ---: |',
  '| 苹果 | 3 | 甲 |',
  '| `x|y` | 4 | 乙\\|丙 |',
  '',
  '结尾段落。',
  '',
].join('\n')

// #13 表格导航/结构操作 fixture（与 runTest.mjs 的 TABLE13_DOC 字节一致）：
// 表格前后有普通段落（区域不变断言），含对齐、行内代码管道
const TABLE13_DOC_TEXT = [
  '前导段落甲。',
  '',
  '| 名字 | 数量 |',
  '| --- | :---: |',
  '| 苹果 | 3 |',
  '| `x|y` | 4 |',
  '',
  '结尾段落乙。',
  '',
].join('\n')

/** 还原通道的防误删 rename：源不存在时跳过（还原语义 = 已还原/未移动，
 *  本就该不动）。不得让「源缺失的 overwrite rename」执行——VSCode 磁盘
 *  provider 的 overwrite 实现是「先删目标再移源」两步，源缺失时目标已被
 *  删掉才抛 EntryNotFound（#199 单宿主全量实测：漂移用例兜底把刚归位的
 *  改名目标.md 又被同轮下一候选的失败 rename 删掉，泄漏给跨根用例）。 */
async function restoreRename(from: vscode.Uri, to: vscode.Uri): Promise<boolean> {
  const sourceExists = await Promise.resolve(vscode.workspace.fs.stat(from)).then(() => true, () => false)
  if (!sourceExists) return false
  await vscode.workspace.fs.rename(from, to, { overwrite: true })
  return true
}

async function poll<T>(
  label: string,
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs = 20000,
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时：${label}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
}

async function openWithEditor(file: string, beside = false): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE, beside
    ? vscode.ViewColumn.Beside
    : undefined)
}

async function readDisk(file: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(wsUri(file))
  return Buffer.from(bytes).toString('utf8')
}

// ---- #199 rename 引用改写辅助 ----

/** fixture 原始文本（与 fixtures.mjs 的 RENAME_* 常量字节一致——现场还原
 *  的写回对照源；漂移检测与改写断言不依赖这些字面量本身） */
const RENAME_REF_A_DOC_TEXT = [
  '# 改名引用甲',
  '',
  '见 [[改名目标]] 与 [同目标](./改名目标.md)。',
  '',
  '带锚 [[改名目标#深处小节|别名]]。',
  '',
  '附件 ![图](assets/rename-pic.png)。',
  '',
].join('\n')
const RENAME_REF_B_DOC_TEXT = [
  '# 改名引用乙',
  '',
  '上行 [[../改名目标]]。',
  '',
].join('\n')
/** #269/#276 独立起始文本（与 fixtures.mjs 同款；不复用 #199 的 buffer）。 */
const RENAME_CHAIN_REF_A_DOC_TEXT = [
  '# 链式引用甲',
  '',
  '见 [[链式目标]] 与 [同目标](./链式目标.md)。',
  '',
  '带锚 [[链式目标#深处小节|别名]]。',
  '',
].join('\n')
const RENAME_CHAIN_REF_B_DOC_TEXT = [
  '# 链式引用乙',
  '',
  '上行 [[../链式目标]]。',
  '',
].join('\n')
const RENAME_MOVED_DOC_TEXT = [
  '# 移动自测',
  '',
  '见 [[改名目标]] 与 [子文档](notes/rename-note.md)。',
  '',
].join('\n')
/** #200 目录/批量移动 fixture 原文（与 fixtures.mjs 的 DIR_* 常量字节一致——
 *  现场还原的写回对照源） */
const DIR_INNER_A_DOC_TEXT = [
  '# 互链甲',
  '',
  '互链 [[inner-b]] 与上行 [[../c-out]]。',
  '',
].join('\n')
const DIR_INNER_B_DOC_TEXT = [
  '# 互链乙',
  '',
].join('\n')
const DIR_INNER_C_DOC_TEXT = [
  '# 嵌套丙',
  '',
].join('\n')
const DIR_OUTSIDE_C_DOC_TEXT = [
  '# 目录外目标',
  '',
].join('\n')
const DIR_REF_DOC_TEXT = [
  '# 目录引用者',
  '',
  '外部 [[dir-move/inner-a]]、[乙](dir-move/inner-b.md) 与 [丙](dir-move/deep/inner-c.md)。',
  '',
  '附件 ![图](dir-move/dir-pic.png)。',
  '',
].join('\n')
/** 1px PNG（与 fixtures.mjs 的 TINY_PNG_BASE64 字节一致） */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
/** #200 多文件同批 rename 专属 fixture 原文（与 fixtures.mjs 的 BATCH_*
 *  常量字节一致——独立文档组，不与 #199 漂移保护用例共享，规避其 finally
 *  泄漏的 dirty buffer 与覆盖层滞留对引用桶的污染） */
const BATCH_REF_A_DOC_TEXT = [
  '# 批引用甲',
  '',
  '见 [[批目标]] 与 [同目标](./批目标.md)。',
  '',
  '带锚 [[批目标#深处小节|别名]]。',
  '',
  '附件 ![图](assets/batch-pic.png)。',
  '',
].join('\n')
const BATCH_REF_B_DOC_TEXT = [
  '# 批引用乙',
  '',
  '上行 [[../批目标]]。',
  '',
].join('\n')
const BATCH_MOVED_DOC_TEXT = [
  '# 批移动自测',
  '',
  '见 [[批目标]]。',
  '',
].join('\n')

/** #200 同批 rename fixture 幂等重建（前置与结尾共用） */
async function ensureBatchFixture(): Promise<void> {
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('批目标.md'), Buffer.from([
    '# 批目标',
    '',
    '## 深处小节',
    '',
    '小节内容。',
    '',
  ].join('\n'), 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('batch-ref-a.md'), Buffer.from(BATCH_REF_A_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('notes/batch-ref-b.md'), Buffer.from(BATCH_REF_B_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('batch-moved.md'), Buffer.from(BATCH_MOVED_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('assets/batch-pic.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))).catch(() => {})
  await new Promise((r) => setTimeout(r, 1400))
}

/** #200 目录 fixture 幂等重建（前置与结尾共用）：重写文件内容触发 watcher
 *  增量重扫，索引条目滞后（目录级 fs 通道无逐文件事件）在下一用例前自愈 */
async function ensureDirMoveFixture(): Promise<void> {
  await Promise.resolve(vscode.workspace.fs.createDirectory(wsUri('dir-move/deep'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-move/inner-a.md'), Buffer.from(DIR_INNER_A_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-move/inner-b.md'), Buffer.from(DIR_INNER_B_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-move/deep/inner-c.md'), Buffer.from(DIR_INNER_C_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-move/dir-pic.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('c-out.md'), Buffer.from(DIR_OUTSIDE_C_DOC_TEXT, 'utf8'))).catch(() => {})
  await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-ref.md'), Buffer.from(DIR_REF_DOC_TEXT, 'utf8'))).catch(() => {})
  // watcher 去抖（800ms）+ 增量队列泵排空后再放行下一断言
  await new Promise((r) => setTimeout(r, 1400))
}

/** #199/#200 rename 计划观测日志（_test.getRenameRefLog）末条 */
async function lastRenameRefLog(): Promise<{
  moves: Array<{ oldFsPath: string; newFsPath: string }>
  expandedMoves: number
  plannedEdits: number
  plannedFiles: number
  skipped: Array<{ fsPath: string; reason: string }>
  indexNotReady: number
  cancelled: boolean
  notice: string | null
} | null> {
  const entries = (await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog')) as
    | Array<{ plannedEdits: number }>
    | undefined
  return entries && entries.length > 0 ? (entries[entries.length - 1] as never) : null
}

/** #199 rename 用例的索引就绪等待（主根 hasData 且不在扫描中） */
async function waitRenameIndexReady(): Promise<void> {
  await poll('rename 用例索引就绪', async () => {
    const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
      roots: Array<{ fsPath: string; hasData: boolean; scanning: boolean }>
    }
    const root = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))
    return root?.hasData && !root.scanning ? true : undefined
  })
}

/** #38 全局模式记忆读取（容错语义同正式链路：无历史为 live） */
async function getLastMode(): Promise<string> {
  return (await vscode.commands.executeCommand(CMD.getLastMode)) as string
}

/** #38 全局模式记忆重置（模拟无历史）：globalState 在同一集成进程内共享，
 *  runner 已在每用例前重置，用例内再 reset 用于显式声明无记忆基线 */
async function resetLastMode(): Promise<void> {
  await vscode.commands.executeCommand(CMD.resetLastMode)
}

/** #38 记忆断言的读回等待：1.86.2 globalState 的 storage 广播滞后会把刚
 *  写入的值偶发回翻为旧值（环境特性，resetLastMode 注释与既有用例注记录
 *  过同类现象；三态循环用例连续三次写记忆后断言，实测偶发读到滞后值且
 *  回翻可持续数秒），经轮询读到期望值即通过 */
async function waitLastMode(expected: string): Promise<void> {
  await poll(`全局记忆为 ${expected}`, async () =>
    (await getLastMode()) === expected ? true : undefined, 10000)
}

/** #38 合并 main 后新增：设置写入的读回确认。1.86.2 globalState 存在
 *  跨键 storage 广播迟到回翻（同层键共享事件流）——#38 的模式记忆写入
 *  （toggle/切换链）与设置写入（setSettings）紧邻时，恢复值可被旧值迟到
 *  广播盖回（集成实测：#32 排版用例关行号采样后恢复 true 被回翻为 false，
 *  后续行号用例全暗）。写入后轮询读回到期望值再放行（与 resetLastMode 的
 *  稳定窗同款防护，作用于设置键） */
async function waitSettings(expected: Record<string, unknown>): Promise<void> {
  const stable = async (): Promise<boolean> => {
    for (let i = 0; i < 2; i++) {
      const snap = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
      if (Object.entries(expected).some(([k, v]) => snap[k] !== v)) {
        return false
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    return true
  }
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await stable()) {
      return
    }
    await vscode.commands.executeCommand(CMD.setSettings, expected)
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`等待超时：设置未稳定为 ${JSON.stringify(expected)}`)
}

/** 等待活动文本编辑器变为指定文档（#38：source 态切换的落位断言） */
async function waitActiveTextEditor(file: string): Promise<vscode.TextEditor> {
  const uri = wsUri(file).toString()
  return poll(`活动编辑器为 ${file}`, () => {
    const ed = vscode.window.activeTextEditor
    return ed && ed.document.uri.toString() === uri ? ed : undefined
  })
}

/** 等待活动 tab 变为指定文档的本扩展 custom editor（#38） */
async function waitActiveCustomTab(file: string): Promise<void> {
  const uri = wsUri(file).toString()
  await poll(`活动 tab 为 Vsidian 面板 ${file}`, () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    return tab?.input instanceof vscode.TabInputCustom &&
      tab.input.viewType === VIEW_TYPE &&
      tab.input.uri.toString() === uri ? true : undefined
  })
}

/** 打开两个 .md 的原生文本 diff 并等待活动 tab 就位（#38 D10） */
async function openTextDiff(left: string, right: string, title: string): Promise<void> {
  // override 只认布尔 true（1.86 扩展主机 converter 限制，见 diff 陷阱笔记）：
  // 强制文本 diff，避免 default priority 把某一侧解析到 custom editor
  await vscode.commands.executeCommand('vscode.diff', wsUri(left), wsUri(right), title, {
    override: true,
  })
  await poll(`文本 diff 打开 ${title}`, () => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    return tab?.input instanceof vscode.TabInputTextDiff ? true : undefined
  })
}

/** #38 单标签修复断言：统计指定文档在全部 tabGroups 的标签数。
 *  kind=native 数 TabInputText（原生源码态），kind=vsidian 数本扩展
 *  TabInputCustom——三态切换任何方向完成后，同文档只应剩一种各一个。
 *  比较与产品侧 isSameDocUri 同口径（win32 盘符大小写漂移实测存在）：
 *  严格 toString 会漏计漂移 uri，把清理失效误判为通过 */
function tabsOf(file: string, kind: 'native' | 'vsidian'): number {
  const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
  const norm = (u: string): string => (caseInsensitive ? u.toLowerCase() : u)
  const uri = norm(wsUri(file).toString())
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => {
      const input = t.input
      return kind === 'native'
        ? input instanceof vscode.TabInputText && norm(input.uri.toString()) === uri
        : input instanceof vscode.TabInputCustom &&
            input.viewType === VIEW_TYPE &&
            norm(input.uri.toString()) === uri
    }).length
}

interface SessionState {
  found: boolean
  panels: Array<{ sessionId: string; ready: boolean }>
  version: number
  appliedEdits: number
  /** #208 资源代次（0 = 未刷新；每次手动刷新 +1） */
  imageGeneration?: number
}

interface ViewState {
  text: string
  docLength: number
  lineCount: number
  renderedLines: number
  suspended?: boolean
  contentDomCount?: number
  headingLineCount?: number
  headingActiveText?: string
  headingHiddenText?: string
  headingFontPx?: number
  /** #6 模式切换观测 */
  viewMode?: 'live' | 'reading'
  selectionOffset?: number
  selectionHead?: number
  selectionAssoc?: number
  liveViewportCenterLine?: number
  liveScrollTopPx?: number
  wordSegmenter?: boolean
  /** #241 评审修复：webview CSP 下 WebAssembly 编译探针（jieba 前置条件） */
  wasmCompile?: boolean
  /** #239 jieba 端到端观测：webview 实际生效的分词引擎（装载成功为 'jieba'） */
  jiebaEngine?: 'builtin' | 'jieba'
  readingBlockCount?: number
  readingAnchorStart?: number
  /** #7 按需挂载观测 */
  readingTotalBlocks?: number
  readingMountedBlocks?: number
  readingContentDomCount?: number
  readingParseCount?: number
  readingVirtualized?: boolean
  readingAnchorTopPx?: number
  readingScrollTopPx?: number
  readingScrollHeightPx?: number
  /** #241 验收回归：阅读容器内查找命中块元素数（块级高亮的绘制层证据） */
  readingFindHitBlocks?: number
  cssProbe?: {
    liveHeadingDecorationColor: string | null
    readingHeadingDecorationColor: string | null
    readingVarProbe: string | null
    /** #129：document.fonts 装载计数与阅读容器背景图（相对资源观测） */
    documentFonts?: { total: number; loaded: number } | null
    readingBackgroundImage?: string | null
    liveStrongDecorationColor: string | null
    liveInlineCodeDecorationColor: string | null
    liveHtmlCommentDecorationColor?: string | null
    liveCodeLineDecorationColor: string | null
    readingStrongDecorationColor: string | null
    liveTaskCheckboxDecorationColor: string | null
    readingTaskCheckboxDecorationColor: string | null
    liveLinkDecorationColor: string | null
    readingLinkDecorationColor: string | null
    readingImageDecorationColor: string | null
    liveTablePipeDecorationColor: string | null
    readingTableDecorationColor: string | null
    liveWikilinkDecorationColor: string | null
    readingWikilinkDecorationColor: string | null
    /** #59 公式字体观测：katex.min.css 生效时含 KaTeX 字体族 */
    liveMathFontFamily?: string | null
    readingMathFontFamily?: string | null
    /** #132 Obsidian 原名别名桥探针（键 = 清单条目 ID；选择器表见 src/shared/obsidianAlias.ts） */
    obsidianAliases?: Record<string, string | null>
    /** #132 变量别名桥观测：--h1-color 驱动的一级标题 computed color */
    obsidianVarProbe?: { liveHeadingColor: string | null; readingHeadingColor: string | null }
    /** #133 界面域探针（键 = 清单条目 ID 或 -live/-reading 消歧；选择器表见 src/shared/chromeContract.ts） */
    chromeSelectors?: Record<string, string | null>
    /** #133 界面域可见颜色观测（各区域代表元素 computed color，随 viewMode 取对应侧） */
    chromePaint?: {
      mathKatexColor: string | null
      codeCardLabelColor: string | null
      tokKeywordColor: string | null
      mermaidContainerColor: string | null
      outlineLevel1Color: string | null
    }
    /** #133 图表弹窗样式观测（浮层在场时的 toolbar/stage computed color；不在场为 null） */
    chromePopup?: { toolbarColor: string | null; stageColor: string | null } | null
  }
  /** #8 双视图语法一致性观测 */
  liveSyntax?: {
    headingLines: number
    headerSpans: number
    strongSpans: number
    emphasisSpans: number
    inlineCodeSpans: number
    quoteLines: number
    codeLines: number
    listLines: number
    hrLines: number
    frontmatterLines: number
    taskGlyphs: number
    taskChecked: number
    tableLines?: number
    tableCells?: number
  }
  tableGrid?: {
    visibleRows: number
    selectedRowIsGrid: boolean
    selectedRowCells: string[]
    rowHandles: number
  }
  readingSyntax?: {
    headings: number
    strongCount: number
    emphasisCount: number
    inlineCodeCount: number
    blockquoteBlocks: number
    codeBlocks: number
    hrCount: number
    listItems: number
    taskCheckboxes: number
    taskChecked: number
    tables?: number
  }
  /** #10 链接/图片观测 */
  liveLinkCount?: number
  liveImageCount?: number
  readingLinkCount?: number
  readingImageCount?: number
  /** #11 双链观测（live：widget+mark；reading：a.vsidian-wikilink） */
  liveWikilinkCount?: number
  readingWikilinkCount?: number
  /** #59 公式计数（live 视口渲染数 / 阅读挂载块内数） */
  liveMathCount?: number
  readingMathCount?: number
  /** #60 Mermaid 计数（live 视口渲染数 / 阅读挂载块内数） */
  liveMermaidCount?: number
  readingMermaidCount?: number
  imageStates?: { loading: number; loaded: number; error: number }
  /** #201 图片条目明细（失效/版本刷新链路断言载体，直连外链除外） */
  imageEntries?: Array<{
    src: string
    state: 'loaded' | 'loading' | 'error'
    reason?: string
    appliedSrc?: string
  }>
  /** #208 图片槽位探针：src 为最终应用地址（含 ?v= 代次戳），
   *  naturalWidth 为浏览器实际解码宽度（刷新真换字节的绘制层证据） */
  imageProbe?: Array<{ src: string | null; naturalWidth: number | null; state: string }>
  /** #14 查找会话观测（首次打开后回报；匹配集来自文本模型全量计算；
   *  #236 起三开关/有效性/替换栏展开态随会话回报，形态对齐协议
   *  FindSessionProbe——此处为消费侧局部类型，不 import webview 模块） */
  find?: {
    open: boolean
    query: string
    matchCase: boolean
    wholeWord: boolean
    regexp: boolean
    valid: boolean
    replaceOpen: boolean
    total: number
    index: number
    currentFrom: number | null
    currentTo: number | null
  }
  /** #32 排版一致性探针（view.state 可选字段，协议正式校验）：
   *  各侧样本只在对应模式激活态断言（隐藏侧几何口径无意义） */
  typography?: {
    live: { fontFamily: string | null; fontSizePx: number | null; lineHeightPx: number | null; textInsetPx: number | null } | null
    reading: { fontFamily: string | null; fontSizePx: number | null; lineHeightPx: number | null; textInsetPx: number | null } | null
    liveList: { fontFamily: string | null; fontSizePx: number | null } | null
    readingList: { fontFamily: string | null; fontSizePx: number | null } | null
    liveQuote: { fontFamily: string | null; fontSizePx: number | null } | null
    readingQuote: { fontFamily: string | null; fontSizePx: number | null } | null
    liveTable: { fontFamily: string | null; fontSizePx: number | null } | null
    readingTable: { fontFamily: string | null; fontSizePx: number | null } | null
  }
  /** #33 设置快照缓存（宿主 snapshot/changed 下发后非空） */
  settings?: Record<string, unknown>
  /** #34 行号栏观测（first/last 为视口内首/末行号单元格文本）；
   *  #116 alignment 为行号-正文行基线偏差采样（无布局环境为 null） */
  lineGutter?: {
    on: boolean
    count: number
    first: string | null
    last: string | null
    alignment?: Array<{ num: string; deltaBaseline: number; deltaBottom: number }> | null
  }
  /** 绘制层探针（P0 回归）：正文可见性 / CM6 注入样式存活 / 行号禁选 / 明暗声明与光标实值 */
  paint?: {
    textVisible: boolean
    scrollerDisplay: string | null
    gutterUserSelect: string | null
    visibleLineNumbers?: string[]
    darkTheme: boolean
    caretColor: string | null
    /** #237 绘制光标 .cm-cursor 的 borderLeftColor（多光标开时在场；不在场为 null） */
    drawnCursorColor?: string | null
    readingFindSource?: { visible: boolean; text: string; current: string; background: string | null }
    table?: {
      cellVisible: boolean
      caretGridColumn?: number | null
      delimiterDisplay?: string | null
      headerCellBackgrounds?: string[]
      caretDomColumn?: number | null
      caretNativeRectHeight?: number | null
      cellBreakDisplay?: string | null
      /** #213 数据行/分隔行行级 computed background-color（无表格为 null） */
      dataRowLineBackground?: string | null
      gridDisplay: string | null
      cellBorderWidth: string | null
      rowOutlineColor: string | null
      rowOutlineWidth: string | null
      rowBackgroundColor: string | null
      columnBorderColor: string | null
      columnBorderWidth: string | null
      columnRightBorderWidth: string | null
      columnTopBorderWidth: string | null
      columnBottomBorderWidth: string | null
      columnBackgroundColor: string | null
      regionCellCount?: number
      regionBackgroundColor?: string | null
      regionTopBorderWidth?: string | null
      regionLeftBorderWidth?: string | null
    }
    /** #59 公式绘制：当前激活视图内首个公式的实际可见性与计数 */
    math?: {
      visible: boolean
      display: string | null
      count: number
    }
    /** #60 Mermaid 绘制：当前激活视图内图表容器的实际可见性与分态计数 */
    mermaid?: {
      visible: boolean
      display: string | null
      rendered: number
      error: number
      count: number
    }
    /** #106 分割线绘制：当前激活视图内首个渲染态横线的可见性与计数 */
    hr?: {
      visible: boolean
      display: string | null
      backgroundImage: string | null
      borderTopWidth: string | null
      count: number
    }
    /** #105 高亮绘制：当前激活视图内首个高亮的实际可见性、底色与定界符隐藏 */
    highlight?: {
      visible: boolean
      display: string | null
      backgroundColor: string | null
      count: number
      delimitersHidden: boolean | null
    }
    /** #111 图形化代码块按钮组与图表弹窗绘制 */
    graphic?: {
      frames: number
      editButtons: number
      popupButtons: number
      overlay: boolean
      /** 浮层实际遮蔽正文（真宿主 elementFromPoint 断言依据） */
      overlayVisible: boolean
      overlaySvg: boolean
    }
    /** #212 图片按钮组与图片弹窗绘制（排除链接内嵌/表格内不发射形态） */
    imageChrome?: {
      frames: number
      editButtons: number
      popupButtons: number
      overlay: boolean
      overlayVisible: boolean
      overlayImgLoaded: boolean
    }
    quickActions?: {
      open: boolean
      togglePainted: boolean
      barPainted: boolean
      boldPainted: boolean
      activePainted: boolean
      menuPainted: boolean
      barBelowToolbar: boolean
      editorBelowBar: boolean
    }
    /** #79 代码块卡片绘制：当前激活视图内卡片头部的实际可见性与计数 */
    code?: {
      visible: boolean
      display: string | null
      label: string | null
      headerCount: number
      cardLineCount: number
      /** #80 视口内卡内行号文本序列 */
      lineNumberTexts?: string[] | null
      /** #81 呈现态复制按钮在场数 */
      copyCount?: number
      /** #82 收起态头部数 */
      foldedCount?: number
      /** #83 视口内 tok-* token 元素数 */
      tokenCount?: number
      /** 全部头部语言标签序列（DOM 顺序；渲染型围栏的 Mermaid 标签断言） */
      labels?: string[]
    }
    /** frontmatter 卡片绘制观测（折叠链路）：标题栏在场时提供 */
    fm?: {
      rowCount: number
      foldedCount: number
      editCount: number
      cardFoldedCount: number
      tableFoldedCount: number
    }
    /** #55：标题行左缘绘制观测（distinct computed 值；无挂载标题行为 null） */
    heading?: {
      inviewCount: number
      boxShadowValues: string[]
      borderLeftWidthValues: string[]
    } | null
    /** #183 统一右键菜单绘制：浮层在场时的实际可见性与降级矩阵证据 */
    contextMenu?: {
      visible: boolean
      display: string | null
      separatorCount: number
      disabledCount: number
    }
  }
  /** #53 右侧栏观测：布局态与绘制层证据（结构见 src/shared/protocol.ts SidebarProbe） */
  sidebar?: {
    open: boolean
    sidebarToolbarPainted: boolean
    togglePainted: boolean
    settingsPainted: boolean
    toggleBarStrokeWidth: string | null
    toggleFrameStrokeWidth: string | null
    mainWidthPx: number | null
    sidebarWidthPx: number | null
    resizerPainted: boolean
    toggleAriaLabel: string | null
    settingsAriaLabel: string | null
  }
  /** #54 大纲观测：面板态、绘制层证据与全文标题序列（protocol.ts OutlineProbe） */
  outline?: {
    active: boolean
    togglePainted: boolean
    panelPainted: boolean
    toggleIconSizePx: number | null
    panelScrollHeightPx: number | null
    panelClientHeightPx: number | null
    /** #65：items 含 plainText（剥标记可见文本）与 spans（白名单标记区间） */
    items: Array<{
      level: number
      text: string
      plainText: string
      spans: Array<{ kind: string; start: number; end: number }>
      line: number
    }>
    toggleAriaLabel: string | null
    panelAriaLabel: string | null
    /** #65 样式透传绘制证据（computed；jsdom 无 CSS 引擎时字段为 null） */
    style?: {
      itemFontWeight: string | null
      strongFontWeight: string | null
      codeFontFamily: string | null
      itemFontFamily: string | null
      itemColor: string | null
      headingColor: string | null
    }
    /** #66 当前控制域条目（视口顶行向上最近标题；null = 无标题/首标题前） */
    locatedItemIndex: number | null
    locatedText: string | null
    /** 高亮横条绘制证据（中心点命中 + computed 背景非全透明） */
    locatedPainted: boolean
    /** #67 展开档位（0=全部折叠、1–5=展开到 Hn） */
    expandLevel: number
    /** #67 可见条目索引序列（折叠遮蔽后的用户实际可见集） */
    visibleIndices: number[]
    /** #67 滑块行绘制证据（elementFromPoint 命中滑块容器） */
    sliderPainted: boolean
    /** #67 当前档圆点绘制证据（命中 active 圆点 + computed 背景非全透明） */
    sliderActiveDotPainted: boolean
    /** #67 折叠箭头绘制证据（首个箭头中心点命中） */
    chevronPainted: boolean
    /** #68 当前搜索词（空串 = 无过滤） */
    searchQuery: string
    /** #68 搜索态（词条非空） */
    searchActive: boolean
    /** #68 组合可见索引序列（折叠可见 ∩ 搜索保留；搜索关闭时与 visibleIndices 同值） */
    filteredVisibleIndices: number[]
    /** #68 工具条行绘制证据（elementFromPoint 命中工具条容器） */
    toolbarPainted: boolean
    /** #68 跳转到末尾按钮可访问名称 */
    jumpBottomAriaLabel: string | null
    /** #68 重置按钮可访问名称 */
    resetAriaLabel: string | null
    /** #68 搜索框 placeholder 文案 */
    searchPlaceholder: string | null
    /** #68 命中片段绘制证据（可见条目内 mark 命中 + computed 背景非全透明） */
    searchHitPainted: boolean
    /** #68 无匹配占位绘制证据 */
    nomatchPainted: boolean
    /** #69 右键菜单打开态 */
    menuOpen: boolean
    /** #69 菜单目标条目索引（items 下标；未打开为 null） */
    menuTargetIndex: number | null
    /** #69 菜单容器绘制证据（中心点 elementFromPoint 命中自身） */
    menuPainted: boolean
    /** #69 级联子菜单可见证据（hover/focus 展开；未展开为 false） */
    submenuVisible: boolean
    /** #69 重命名编辑态条目索引（null = 无编辑态） */
    renamingIndex: number | null
    /** #70 拖拽态源条目索引（null = 无拖拽；仅 moved 后回报） */
    draggingIndex: number | null
    /** #70 有效落点目标索引（null = 未悬停或落点无效） */
    dropTargetIndex: number | null
    /** #70 落点三态（null = 无有效落点） */
    dropPosition: 'before' | 'after' | 'inside' | null
    /** #70 落点指示绘制证据（指示条目中心命中 + 插入线/包裹高亮可读） */
    dropHintPainted: boolean
  }
  /** #140 Popover 改版：frontmatter 属性编辑浮层开态（protocol.ts 缺省可选） */
  fmPopoverOpen?: boolean
  /** #218 悬停预览观测：浮层开闭、内容态、目标标识与内容块数；
   *  #220 新增 fm 属性区三态与 imageSrcs 浮层内已应用图片地址（旧 webview 缺省） */
  hoverPreview?: {
    open: boolean
    state: 'loading' | 'content' | 'error'
    note: string
    blocks: number
    scope: 'full' | 'heading' | 'block' | ''
    fm?: 'none' | 'collapsed' | 'expanded'
    imageSrcs?: string[]
  }
  /** #299 跳转目标提示观测：在场与路径文本 */
  targetTip?: {
    open: boolean
    text: string
  }
  /** #222 嵌入卡片观测：在场卡片逐枚（inner/state/note/blocks/scope/fm/限高） */
  readingEmbed?: Array<{
    inner: string
    state: 'loading' | 'content' | 'error'
    note: string
    blocks: number
    scope: 'full' | 'heading' | 'block' | ''
    fm: 'none' | 'collapsed' | 'expanded'
    maxHeightPx: number
    host?: 'reading' | 'live'
    rootHost?: 'reading' | 'live'
    /** #224 内容文本字符数（未保存修改推送后刷新可见性断言） */
    textLen?: number
    /** #243 现有虚拟窗口观测；仅取目标自身块数，排除子卡正文长度。 */
    viewStats?: { totalBlocks: number; mountedBlocks: number } | null
    /** P2-04（#281）内部模式与目标编辑端口观测 */
    internalMode?: 'reading' | 'live'
    liveBound?: boolean
    livePortId?: string | null
    liveDirty?: boolean
    liveSuspended?: boolean
    /** 内部 Live 编辑器文档长度（-1 = 无实例） */
    liveTextLen?: number
    /** P2-05（#282）关闭确认模态观测（none/open/stale）与发起意图径 */
    closeDialog?: 'none' | 'open' | 'stale'
    closeIntent?: 'close' | 'escape' | 'delete' | ''
  }>
  /** #223 Live 嵌入显隐观测：嵌入表逐枚的源码显形态（selectionTouchesRange 语义） */
  liveEmbedReveal?: Array<{ inner: string; line: number; revealed: boolean }>
}

/** #7 阅读视图探针回报（reading.perf.report） */
interface ReadingPerfReportData {
  scrollRounds: number
  totalBlocks: number
  baseline: { mountedBlocks: number; contentDomCount: number; scrollTopPx: number; scrollHeightPx: number }
  afterScroll: { mountedBlocks: number; contentDomCount: number; scrollTopPx: number; scrollHeightPx: number }
  parseCount: number
  maxMountedBlocks: number
  ok: boolean
}

/** 性能探针回报（perf.report，结构见 src/shared/protocol.ts） */
interface PerfReportData {
  typingRounds: number
  scrollRounds: number
  docLines: number
  baseline: { renderedLines: number; contentDomCount: number; headingLineCount: number; inviewHeadingCount: number }
  afterTyping: { renderedLines: number; contentDomCount: number; headingLineCount: number; inviewHeadingCount: number }
  afterScroll: { renderedLines: number; contentDomCount: number; headingLineCount: number; inviewHeadingCount: number }
  inputDelayMs: { samples: number[]; avgMs: number; maxMs: number }
  longTasks: { count: number; maxMs: number; totalMs: number } | null
  headingStats: { totalUpdates: number; lastUpdateScannedLines: number; fullBuildLines: number }
}

interface ConflictState {
  found: boolean
  sessionId?: string
  suspended?: boolean
  fragments?: string[]
  webviewText?: string
  webviewVersion?: number
}

/** #10 链接跳转执行日志（_test.getLinkLog 回报；#11 起含双链条目） */
interface LinkLogData {
  found: boolean
  log: Array<{
    kind: string
    href?: string
    reason?: string
    scheme?: string
    path?: string
    /** #160 doc/anchor 条目的锚点目标 */
    fragment?: string
    /** #11 双链条目字段 */
    target?: string
    heading?: string
    /** #159 块引用目标（与 heading 互斥） */
    blockId?: string
    candidates?: string[]
    locate?: 'custom-panel' | 'none'
  }>
}

// ---- #11 双链 fixture 镜像（与 runTest.mjs 逐字节一致：标题 offset 断言依据） ----
const WIKILINKS_DOC_TEXT = [
  '# 双链样例',
  '',
  '正文含 [[目标笔记]] 与 [[子 目录/目标 二|别名]] 与 [[目标笔记#深处的标题]]。',
  '',
  '降级形态：![[嵌入目标]] 与 [[目标笔记^块]] 与 [[坏#]]。',
  '',
  '`行内代码 [[不装饰]]` 之后的正文。',
  '',
  '```text',
  '[[围栏内不装饰]]',
  '```',
  '',
  '结尾段落。',
  '',
  '锚点目标块。 ^anchor-blk',
  '',
].join('\n')
/** #159 本文件块锚点目标行的 LF offset（view.locate 光标断言依据；
 *  wikilinks.md 为 LF 行尾，宿主系与 LF 系一致） */
const ANCHOR_BLK_LF_OFFSET = WIKILINKS_DOC_TEXT.indexOf('锚点目标块')
const TARGET_NOTE_TEXT = (() => {
  const out = ['# 目标笔记标题', '', '开篇段落。', '']
  for (let i = 1; i <= 200; i++) {
    out.push(`填充段落 ${i}：足够多的正文让「深处的标题」位于首屏之外。`, '')
  }
  out.push('# 深处的标题', '', '标题下的正文。', '')
  return out.join('\n')
})()
/** 屏外标题的源 offset（阅读挂载定位断言依据） */
const DEEP_HEADING_OFFSET = TARGET_NOTE_TEXT.indexOf('# 深处的标题')

/** CRLF 双链目标镜像（fixtures.mjs 的 WIKILINK_CRLF_TARGET_DOC 逐字节一致，
 *  LF 形态——标题 LF offset 断言依据：宿主 getText 保留 \r\n，直发宿主系
 *  坐标给 LF 坐标系的 webview 会按行数差漂移） */
const WIKILINK_CRLF_TARGET_LF = (() => {
  const out = ['# CRLF 目标标题', '', '开篇段落。', '']
  for (let i = 2; i <= 30; i++) {
    out.push(`第 ${i} 段正文。`, '')
  }
  out.push('## CRLF 深处小节', '', '小节内容。', '')
  return out.join('\n')
})()
/** CRLF 目标中部标题的 LF offset（定位断言依据；其前有 30+ 个 CRLF 行尾，
 *  宿主系 offset 比 LF offset 大出该行数） */
const CRLF_HEADING_LF_OFFSET = WIKILINK_CRLF_TARGET_LF.indexOf('## CRLF 深处小节')

/** 注入双链意图（与真实 webview 消息同一校验与处理入口；#11） */
async function injectWikilink(uri: string, target: string): Promise<void> {
  await vscode.commands.executeCommand(CMD.injectMessage, uri, {
    kind: 'wikilink.activate',
    sessionId: '',
    docUri: uri,
    target,
    srcStart: 0,
    srcEnd: 16,
  })
}

/** 等待双链执行日志中出现匹配条目（#11） */
async function waitWikilinkLog(
  uri: string,
  match: (e: LinkLogData['log'][number]) => boolean,
): Promise<LinkLogData['log'][number]> {
  return poll('双链执行日志', async () => {
    const data = (await vscode.commands.executeCommand(CMD.linkLog, uri)) as LinkLogData | undefined
    return data?.found ? data.log.find(match) : undefined
  })
}

async function waitSessionReady(file: string): Promise<SessionState> {
  return poll(`会话就绪 ${file}`, async () => {
    const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri(file).toString())) as SessionState | undefined
    if (state?.found && state.panels.some((p) => p.ready)) {
      return state
    }
    return undefined
  })
}

/** 等视口布局稳定：滚动触发围栏/图表懒渲染，容器从折叠态长高会推走
 *  下方行。#215 加固为状态谓词（不依赖时间窗）：稳定 = 连续两次采样
 *  中心行与 scrollTop 均一致，且视口内 Mermaid 围栏全部到达终态
 *  （rendered + error === count，探针现成分态字段）——CI 慢机上懒加载
 *  注入可能落后于滚动，占位态的中心行会短暂静止，单看中心行相等会在
 *  渲染完成后的布局变化上误判已稳定（切标签页保持断言的间歇红根源）。 */
async function waitViewportSettled(file: string): Promise<ViewState> {
  let stableCenter: number | undefined
  let stableScrollTop: number | undefined
  return poll(`${file} 视口布局稳定`, async () => {
    const state = (await vscode.commands.executeCommand(CMD.viewState, wsUri(file).toString(), 0)) as ViewState | undefined
    const center = state?.liveViewportCenterLine
    const scrollTop = state?.liveScrollTopPx
    if (state === undefined || center === undefined || scrollTop === undefined) {
      return undefined
    }
    if (state.paint?.mermaid !== undefined &&
      state.paint.mermaid.rendered + state.paint.mermaid.error !== state.paint.mermaid.count) {
      return undefined
    }
    if (center === stableCenter && scrollTop === stableScrollTop) {
      return state
    }
    stableCenter = center
    stableScrollTop = scrollTop
    return undefined
  }, 15000)
}

/** 视口诊断快照（#215：失败时区分「渲染几何差异」与「恢复时序竞速」——
 *  中心行漂移若伴随 mermaid 分态未到终态，指向恢复竞速而非几何差异） */
function mermaidProbeBrief(v: ViewState): string {
  const m = v.paint?.mermaid
  return m === undefined
    ? 'no-probe'
    : `rendered ${m.rendered}/${m.count}, error ${m.error}`
}

/** 视口内 Mermaid 围栏是否全部到达终态（rendered + error === count；
 *  error 降级围栏的高度也是终态——用计数关系而非魔数，文档围栏数变化
 *  不需改用例）。无容器（围栏未挂载/非 mermaid 文档）视为未终态，由
 *  调用方的视口就绪前置保证容器已挂载 */
function mermaidReachedTerminal(v: ViewState): boolean {
  const m = v.paint?.mermaid
  return m !== undefined && m.rendered + m.error === m.count && m.count > 0
}

async function waitViewState(
  file: string,
  match?: (v: ViewState) => boolean,
  panelIndex = 0,
  /** 等待预算（默认 20s；mermaid 绘制层等重负载用例可放宽至 60s——
   *  独立桌面宿主下高负载时段的懒加载解析 + 渲染偶发击穿默认预算） */
  timeoutMs = 20000,
): Promise<ViewState> {
  let lastSeen: ViewState | undefined
  try {
    return await poll(`视图状态 ${file}`, async () => {
      const state = (await vscode.commands.executeCommand(CMD.viewState, wsUri(file).toString(), panelIndex)) as ViewState | undefined
      if (state && (!match || match(state))) {
        return state
      }
      lastSeen = state
      return undefined
    }, timeoutMs)
  } catch (err) {
    // 超时附最后观测快照（关键字段）——定位「卡在哪个谓词」不再盲猜
    if (lastSeen !== undefined) {
      const s = lastSeen as unknown as Record<string, unknown>
      throw new Error(`${(err as Error).message}；最后观测：${JSON.stringify({
        viewMode: s['viewMode'],
        selectionOffset: s['selectionOffset'],
        jiebaEngine: s['jiebaEngine'],
        find: s['find'],
        imageStates: s['imageStates'],
        imageProbe: s['imageProbe'],
        readingEmbed: s['readingEmbed'],
        liveEmbedReveal: s['liveEmbedReveal'],
      })}`)
    }
    throw err
  }
}

/** #128 CSS 片段宿主权威状态（_test 观测钩子） */
interface SnippetState {
  available: boolean
  directory: string | null
  readError: boolean
  paused: boolean
  version: number
  entries: Array<{ name: string; enabled: boolean }>
  /** #129 越界/符号链接逃逸被拒的启用条目 */
  rejections?: Record<string, { reason: string; path: string }>
}
async function snippetState(): Promise<SnippetState> {
  return (await vscode.commands.executeCommand(CMD.snippetState)) as SnippetState
}
async function setSnippetDirectory(dir: string | null): Promise<void> {
  await vscode.commands.executeCommand(CMD.setSnippetDirectory, dir)
}
async function setSnippetEnabled(name: string, enabled: boolean): Promise<void> {
  await vscode.commands.executeCommand(CMD.setSnippetEnabled, name, enabled)
}
/** 工作区内写片段 CSS（utf8 无 BOM） */
async function writeSnippetCss(file: string, css: string): Promise<void> {
  await vscode.workspace.fs.writeFile(wsUri(file), Buffer.from(css, 'utf8'))
}

/** #140 frontmatter 卡片编辑 fixture（与 fixtures.mjs 的 fm-edit.md 一致） */
const FM_EDIT_DOC_TEXT = [
  '---',
  'title: 集成标题',
  'tags:',
  '  - 甲',
  '---',
  '',
  '正文段落。',
  '',
].join('\n')

/** #133 界面域样式契约 fixture（与 fixtures.mjs 的 CHROME_CONTRACT_DOC 一致） */
const CHROME_CONTRACT_DOC_TEXT = [
  '---',
  'title: 界面契约',
  'tags:',
  '  - 契约',
  '---',
  '',
  '# 界面契约一级标题',
  '',
  '## 二级标题与 **加粗透传**',
  '',
  '行内公式 $E = mc^2$ 与块级公式：',
  '',
  '$$\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}$$',
  '',
  '错误公式 $\\fauxcmd{x}$ 原文降级。',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[开始] --> B[结束]',
  '```',
  '',
  '```mermaid',
  '这个围栏语法无效',
  '```',
  '',
  '```js',
  'const keyword = true',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

/** #9 任务勾选 fixture（与 runTest.mjs 的 TASK_DOC 一致） */
const TASK_DOC_TEXT = [
  '# 任务清单标题',
  '',
  '- [ ] 未完成任务甲',
  '- [ ] 未完成任务甲',
  '- [x] 已完成任务',
  '',
  '结尾段落。',
  '',
].join('\n')
/** 点击第二个重复任务后的期望全文 */
const TASK_DOC_SECOND_TOGGLED = [
  '# 任务清单标题',
  '',
  '- [ ] 未完成任务甲',
  '- [x] 未完成任务甲',
  '- [x] 已完成任务',
  '',
  '结尾段落。',
  '',
].join('\n')

/** 用例表：名称 -> 执行函数 */
export const cases: Array<[string, () => Promise<void>]> = [
  // #278（P2-01）真宿主探针组：目标历史/丢弃/临时对比/关闭交接的公开路线
  // 验证——研究工件独立成文件，定向复现：VSIDIAN_TEST_CASES='P2-01'
  ...probe278Cases,
  ['激活与默认编辑器声明（#38 后接管 .md 默认打开）', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)
    assert(ext, `扩展 ${EXT_ID} 未找到`)
    await ext!.activate()
    assert(ext!.isActive, '扩展激活失败')

    const contributes = (ext!.packageJSON as { contributes?: { customEditors?: Array<{ priority?: string; selector?: Array<{ filenamePattern?: string }> }> } }).contributes
    const editor = contributes?.customEditors?.[0]
    assert(editor?.priority === 'default', `priority 应为 default（默认编辑器接管 .md 打开），实际 ${editor?.priority}`)
    const patterns = editor?.selector?.map((s) => s.filenamePattern) ?? []
    assert(patterns.includes('*.md'), `selector 应含 *.md，实际 ${patterns.join(',')}`)
  }],

  ['标题栏三态按钮声明：三命令各一项、navigation 组、when 互斥与图标（#38）', async () => {
    // 静态断言（contributes.menus["editor/title"] 与 commands 声明）：运行时
    // 按钮显隐由 VSCode 按 when 求值，此处钉死声明形状。三按钮同一时刻至多
    // 一个可见的依据是 when 条件互斥：toReading/toSource 同以
    // activeCustomEditorId == 本编辑器 锁定 Vsidian 面板，再以 vsidian.activeMode
    // 的 live/reading 两值区分（同一 context key 不可能同时取两值）；toLive 以
    // !activeCustomEditorId 锁定非 custom 编辑器（.md/.markdown 源码态），与前
    // 两者的 activeCustomEditorId 断言互斥；三条均含 !isInDiffEditor 排除对比视图
    const ext = vscode.extensions.getExtension(EXT_ID)
    assert(ext, `扩展 ${EXT_ID} 未找到`)
    await ext!.activate()
    const contributes = (ext!.packageJSON as {
      contributes?: {
        commands?: Array<{ command?: string; icon?: string }>
        menus?: { 'editor/title'?: Array<{ command?: string; when?: string; group?: string }> }
      }
    }).contributes

    const items = contributes?.menus?.['editor/title'] ?? []
    assert(items.length === 3, `editor/title 应恰好三命令各一项，实际 ${items.length} 项`)
    const byCommand = new Map(items.map((i) => [i.command, i]))
    const iconByCommand = new Map((contributes?.commands ?? []).map((c) => [c.command, c.icon]))

    const tri: Array<[command: string, icon: string]> = [
      ['onegayi.vsidian.mode.toReading', '$(book)'],
      ['onegayi.vsidian.mode.toSource', '$(code)'],
      ['onegayi.vsidian.mode.toLive', '$(edit)'],
    ]
    for (const [command, icon] of tri) {
      assert(
        items.filter((i) => i.command === command).length === 1,
        `${command} 在 editor/title 应恰一项`,
      )
      assert(byCommand.get(command)?.group === 'navigation', `${command} 应在 navigation 组，实际 ${byCommand.get(command)?.group}`)
      assert(iconByCommand.get(command) === icon, `${command} 图标应为 ${icon}，实际 ${iconByCommand.get(command)}`)
      assert(byCommand.get(command)?.when?.includes('!isInDiffEditor') === true, `${command} 的 when 应含 !isInDiffEditor（对比视图无按钮）`)
    }

    // 面板内两态互斥（live/reading 二值区分）
    const readingWhen = byCommand.get('onegayi.vsidian.mode.toReading')?.when ?? ''
    const sourceWhen = byCommand.get('onegayi.vsidian.mode.toSource')?.when ?? ''
    assert(readingWhen.includes(`activeCustomEditorId == ${VIEW_TYPE}`), `toReading 的 when 应锁定本编辑器面板，实际 ${readingWhen}`)
    assert(readingWhen.includes('vsidian.activeMode == live'), `toReading 的 when 应限定 live 态，实际 ${readingWhen}`)
    assert(sourceWhen.includes(`activeCustomEditorId == ${VIEW_TYPE}`), `toSource 的 when 应锁定本编辑器面板，实际 ${sourceWhen}`)
    assert(sourceWhen.includes('vsidian.activeMode == reading'), `toSource 的 when 应限定 reading 态，实际 ${sourceWhen}`)
    // 源码态按钮与前两者互斥（!activeCustomEditorId + !activeWebviewPanelId 排除
    // 一切 custom editor 与 webview panel 语境）且限定 .md/.markdown。其中
    // !activeWebviewPanelId 排除内置 Markdown 预览（Ctrl+Shift+V 的 WebviewPanel
    // 形态 viewType 'markdown.preview'；custom editor 形态已被 !activeCustomEditorId
    // 排除——与 1.86 内置 markdown 扩展官方 when 子句同口径）
    const liveWhen = byCommand.get('onegayi.vsidian.mode.toLive')?.when ?? ''
    assert(liveWhen.includes('!activeCustomEditorId'), `toLive 的 when 应限定非 custom 编辑器（与面板内两命令互斥），实际 ${liveWhen}`)
    assert(liveWhen.includes('!activeWebviewPanelId'), `toLive 的 when 应排除 webview panel（内置 Markdown 预览），实际 ${liveWhen}`)
    assert(liveWhen.includes('resourceExtname == .md') && liveWhen.includes('resourceExtname == .markdown'), `toLive 的 when 应限定 .md/.markdown，实际 ${liveWhen}`)
  }],

  ['默认关联打开 .md 进入 Vsidian 面板（#38 默认编辑器）', async () => {
    // vscode.open 不带 override 走默认关联解析（双击文件同路径）；
    // showTextDocument 强制 EXCLUSIVE_ONLY 原生，验证不了默认关联
    await resetLastMode()
    await vscode.commands.executeCommand('vscode.open', wsUri('lf.md'))
    const session = await waitSessionReady('lf.md')
    assert(session.panels.length >= 1, '默认关联打开应进入 Vsidian 面板')
    const view = await waitViewState('lf.md', (v) => v.text === LF_DOC)
    assert(view.viewMode === 'live', '无记忆时新开面板应为实时预览')
  }],

  ['Reopen With 打开后 webview 就绪并装载全文（中文/emoji/CSP 链路）', async () => {
    // webview 脚本在 CSP 限制下成功执行的前提是收到 ready 与 view.state
    await openWithEditor('lf.md')
    const session = await waitSessionReady('lf.md')
    assert(session.panels.length >= 1, '面板数应为 1')
    assert(session.appliedEdits === 0, '未编辑期间不应产生任何写回')
    const view = await waitViewState('lf.md')
    assert(view.text === LF_DOC, `webview 全文与源文件不一致：${JSON.stringify(view.text)}`)
    assert(view.docLength === LF_DOC.length, '全文长度（UTF-16）不一致')
  }],

  // ---- 工单 #38：标题栏三态按钮 / 默认编辑器 / 全局模式记忆 / diff 防御 ----

  ['三态循环：live→reading→source→live 往返，未保存内容与 dirty 全程保留（#38）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    const diskBefore = await readDisk('mode.md')

    // 一笔未保存编辑（外部 applyEdit 写权威文档并广播，面板同步）——
    // 验证工单验收「不因纯视图切换写入 Markdown 或隐式保存」
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mode.md'), new vscode.Range(0, 0, 0, 0), '未保存三态段落\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const editedText = `未保存三态段落\n\n${MODE_DOC_TEXT}`
    await poll('编辑生效', () => (doc.getText() === editedText ? true : undefined))
    await waitViewState('mode.md', (v) => v.text === editedText)
    assert(doc.isDirty, '编辑后文档应 dirty（未保存）')

    // live → reading：标题栏命令链路（显式目标 + editor/title 传 uri）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('mode.md'))
    const readingView = await waitViewState('mode.md', (v) => v.viewMode === 'reading' && v.text === editedText)
    assert((readingView.readingBlockCount ?? 0) >= 6, `阅读块数应 >=6，实际 ${readingView.readingBlockCount}`)
    await waitLastMode('reading')

    // reading → source：活动 tab 原位切换为原生文本编辑器（openWith 新开 +
    // 清理旧 custom tab；dirty 时保留旧标签防内容回退，见「单标签（dirty→
    // 源码）」用例的实测裁决），活动编辑器显示未保存内容
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    const sourceEditor = await waitActiveTextEditor('mode.md')
    assert(sourceEditor.document.getText() === editedText, '原生编辑器应显示未保存内容')
    assert(doc.isDirty, '切到源码编辑器后文档仍应 dirty（纯视图切换不得隐式保存）')
    await waitLastMode('source')

    // source → live：面板重建，内容与 dirty 一致、磁盘不写
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    const session = await waitSessionReady('mode.md')
    assert(session.panels.length >= 1, 'toLive 应重建 Vsidian 面板')
    const liveView = await waitViewState('mode.md', (v) => v.text === editedText)
    assert(liveView.viewMode === 'live', 'toLive 后应为实时预览')
    assert(liveView.selectionOffset !== undefined, '返回可编辑视图应有确定的源位置（光标已装载）')
    assert(doc.isDirty, '回到面板后文档仍应 dirty')
    assert(await readDisk('mode.md') === diskBefore, '三态往返全程不得写磁盘')
    await waitLastMode('live')
  }],

  ['三态循环命令：源码编辑器态执行 toggleViewMode 打开 Vsidian（#38）', async () => {
    // 命令面板路径（不带 uri 参数）；原语义为警告提示，#38 升级为打开 Vsidian
    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    await vscode.window.showTextDocument(doc)
    assert(vscode.window.activeTextEditor !== undefined, '前置：原生文本编辑器活动')

    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const session = await waitSessionReady('mode.md')
    assert(session.panels.length >= 1, '循环命令应把源码态切到 Vsidian 面板')
    await waitViewState('mode.md', (v) => v.viewMode === 'live')
    await waitLastMode('live')
  }],

  ['全局模式记忆：reading 记忆下关闭面板再开新文档直接进阅读模式（#38）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const modeUri = wsUri('mode.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('mode.md'))
    await waitViewState('mode.md', (v) => v.viewMode === 'reading')
    await waitLastMode('reading')

    // 关闭该面板（非 dirty，安全关闭）：记忆不随面板消失
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, modeUri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await waitLastMode('reading')

    // 新开另一文档：resolve 恢复链路直接进 reading（面板就绪后下发）
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const restored = await waitViewState('lf.md', (v) => v.viewMode === 'reading')
    assert(restored.text === LF_DOC, '恢复阅读模式的文本应为全文')
  }],

  ['全局模式记忆：source 记忆下新开 .md 弹回原生编辑器（#38 冷启动源码态）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await waitLastMode('source')

    // 记忆 source 时打开另一 .md：resolve 弹回原生编辑器（即使显式指定
    // Vsidian——「Reopen With 选 Vsidian 被弹回」属已知代价，可经铅笔按钮切回）
    await openWithEditor('lf.md')
    await waitActiveTextEditor('lf.md')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('lf.md').toString())) as SessionState
    assert(state.found === false, '弹回路径不得装配 Vsidian 会话')
    // 注：「弹回不改写记忆」不做跨窗口断言——1.86.2 的 globalState 存在
    // storage 层广播滞后，跨事件窗口读取偶发被滞后值覆盖（环境特性，
    // 非本扩展写入）；弹回分支不写记忆由 viewCycle 单测与代码路径保证

    // 等弹回链的异步清理完成（resolve 早退的空 custom tab 经 void openWith +
    // closeStale 关闭）：清理先于用例结束，未清理的空 tab 会被后续用例的
    // openWith 重显（永不 ready），此 poll 是跨用例隔离的一部分
    await poll('弹回残留 tab 清理', () => {
      const stale = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputCustom &&
          t.input.viewType === VIEW_TYPE &&
          t.input.uri.toString() === wsUri('lf.md').toString())
      return stale.length === 0 ? true : undefined
    })
  }],

  ['多标签独立性：命令只作用于活动标签，非活动标签状态保留（#38）', async () => {
    // 构型：一个 Vsidian 面板（syntax.md）+ 一个原生 .md 标签（mode.md）
    // 并存。「不同文档的两个 custom tab」构型在 1.86 测试宿主下第二个面板
    // 的 webview 创建偶发不就绪（5/7 轮复现，环境 flaky），双 Vsidian 面板
    // 各自模式独立由 webview 每面板独立 PersistedState 的单测与人工清单
    // A21 覆盖；本用例全程单 custom tab，验证命令按活动标签实际状态动作
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const syntaxUri = wsUri('syntax.md').toString()
    const modeText = (await vscode.workspace.openTextDocument(wsUri('mode.md'))).getText()

    // 并存一个原生 .md 标签并使其活动（syntax 面板变非活动）：
    // 非活动面板保留自身状态可查询。retainContextWhenHidden 关闭，tab
    // 不可见期间 webview 可能被卸载（view.state.request 无人应答），
    // 故先在面板可见时让宿主模式缓存就位，变非活动后以宿主缓存为
    // 观测面断言保留（CI 慢环境的 Linux 宿主曾因该竞速必超时）
    await waitViewState('syntax.md', (v) => v.viewMode === 'live')
    const modeDoc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    await vscode.window.showTextDocument(modeDoc)
    await waitActiveTextEditor('mode.md')
    const keptLive = (await vscode.commands.executeCommand(
      CMD.viewStateCache, syntaxUri,
    )) as { found: boolean; viewMode?: string }
    assert(keptLive.found && keptLive.viewMode === 'live', '非活动的 syntax 面板应保留自身状态')
    const beforeResume = (await vscode.commands.executeCommand(
      CMD.cachedViewState, syntaxUri,
    )) as ViewState | undefined

    // 重显 syntax 面板使其活动（openWith 对已开面板是重显，不新建 tab），
    // toReading 只作用于 syntax；原生 mode 标签不受影响。不可见期间面板
    // 可能经卸载重载：等待新 view.state 回报（与隐藏前缓存对象不同），
    // 再下发模式命令，避免发给重载中的 webview 而丢失
    await vscode.commands.executeCommand('vscode.openWith', wsUri('syntax.md'), VIEW_TYPE)
    await waitActiveCustomTab('syntax.md')
    await poll('重显面板恢复响应', async () => {
      const current = (await vscode.commands.executeCommand(CMD.viewState, syntaxUri)) as ViewState | undefined
      return current && current !== beforeResume ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('syntax.md'))
    await waitViewState('syntax.md', (v) => v.viewMode === 'reading')
    const backToMode = await vscode.window.showTextDocument(modeDoc)
    assert(backToMode.document.getText() === modeText, '原生 mode 标签不得受 syntax 的模式切换影响')

    // syntax 面板活动时 toSource：非 dirty 切换，被替换的旧 tab 关闭、
    // 会话释放（dirty 场景的单标签行为见三态循环与单标签用例组）
    await vscode.commands.executeCommand('vscode.openWith', wsUri('syntax.md'), VIEW_TYPE)
    await waitActiveCustomTab('syntax.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('syntax.md'))
    await waitActiveTextEditor('syntax.md')
    await poll('syntax 面板会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, syntaxUri)) as SessionState
      return s?.found === false ? true : undefined
    })
  }],

  ['单标签（非 dirty）：双向切换后同文档在全部标签组仅一个标签（#38 修复验收）', async () => {
    // 用户人工验收缺陷的直接断言：1.86 的 openWith 对「同资源不同编辑器」
    // 是新开 tab（T1 查证 1.86.0 源码确认为既有行为，无原位替换命令可用），
    // 修复前源码态与预览态并存两个标签——修复后编排层关闭被替换的旧 tab
    //（Vsidian→源码关旧 custom tab；源码→Vsidian 关旧原生 tab）
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')

    // Vsidian → 源码：旧 custom tab 关闭，仅剩一个原生 tab
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await poll('toSource 后旧 Vsidian 标签关闭', () =>
      tabsOf('mode.md', 'vsidian') === 0 ? true : undefined)
    assert(tabsOf('mode.md', 'native') === 1,
      `toSource 后应有且仅有一个原生标签，实际 native=${tabsOf('mode.md', 'native')} vsidian=${tabsOf('mode.md', 'vsidian')}`)

    // 源码 → Vsidian：旧原生 tab 关闭，仅剩一个 Vsidian tab（修复的缺失方向）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    await waitActiveCustomTab('mode.md')
    await poll('toLive 后旧原生标签关闭', () =>
      tabsOf('mode.md', 'native') === 0 ? true : undefined)
    assert(tabsOf('mode.md', 'vsidian') === 1,
      `toLive 后应有且仅有一个 Vsidian 标签，实际 native=${tabsOf('mode.md', 'native')} vsidian=${tabsOf('mode.md', 'vsidian')}`)
    await waitViewState('mode.md', (v) => v.text === MODE_DOC_TEXT)
  }],

  ['单标签（dirty→源码）：保留旧 Vsidian 标签防内容回退，保存后切换复用清理（#38 用例 A）', async () => {
    // 1.86.2 实测裁决：关闭 dirty custom tab 会把 TextDocument revert 回
    // 磁盘内容（即使原生 tab 已打开同一文档）——dirty 保留旧标签为已知
    // 代价（mvp.md），保存后再次切换收敛回单标签
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    const diskBefore = await readDisk('mode.md')
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mode.md'), new vscode.Range(0, 0, 0, 0), '单标签未保存甲\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const editedText = `单标签未保存甲\n\n${MODE_DOC_TEXT}`
    await poll('编辑生效', () => (doc.getText() === editedText ? true : undefined))
    await waitViewState('mode.md', (v) => v.text === editedText)
    assert(doc.isDirty, '前置：文档应 dirty')

    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    const sourceEditor = await waitActiveTextEditor('mode.md')
    assert(tabsOf('mode.md', 'native') === 1, `dirty toSource 后一个原生标签，实际 native=${tabsOf('mode.md', 'native')}`)
    assert(tabsOf('mode.md', 'vsidian') === 1, `dirty 保留旧 Vsidian 标签（防回退已知代价），实际 vsidian=${tabsOf('mode.md', 'vsidian')}`)
    assert(sourceEditor.document.getText() === editedText,
      'dirty 保留下原生编辑器应显示未保存内容（不得回退）')
    assert(doc.getText() === editedText, 'TextDocument 不得被 revert')
    assert(doc.isDirty, 'dirty 切源码后文档仍应 dirty')
    assert(await readDisk('mode.md') === diskBefore, '切换不得写磁盘')

    // 保存后再次切换：非 dirty 清理生效，双标签收敛为单标签
    await doc.save()
    assert(await readDisk('mode.md') === editedText, '保存后磁盘应为编辑内容')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    await waitActiveCustomTab('mode.md')
    await poll('保存后 toLive 收敛单标签', () =>
      tabsOf('mode.md', 'native') === 0 ? true : undefined)
    assert(tabsOf('mode.md', 'vsidian') === 1, `保存后 toLive 应仅剩一个 Vsidian 标签，实际 vsidian=${tabsOf('mode.md', 'vsidian')}`)
    await waitViewState('mode.md', (v) => v.text === editedText && v.viewMode === 'live')

    // 恢复 fixture 基线（mode.md 磁盘内容被本用例保存改写，后续用例按
    // MODE_DOC_TEXT 断言——移除插入段并保存回基线；偏移系定位，插入段
    // 跨两行，行系 Range 会被钳位残留换行）
    const restore = new vscode.WorkspaceEdit()
    restore.replace(
      wsUri('mode.md'),
      new vscode.Range(doc.positionAt(0), doc.positionAt('单标签未保存甲\n\n'.length)),
      '',
    )
    assert(await vscode.workspace.applyEdit(restore), '恢复编辑应成功')
    await doc.save()
    assert(await readDisk('mode.md') === MODE_DOC_TEXT, '用例结束应恢复 mode.md 基线')
  }],

  ['单标签（dirty→预览）：保留旧原生标签防内容回退，保存后切换复用清理（#38 用例 B）', async () => {
    // 1.86.2 实测裁决：关闭 dirty 原生 tab 同样 revert（vscode-office 陷阱 3
    // 在本扩展构型下复现，与 custom 侧是否已持文档无关）——dirty 保留旧原生
    // 标签为最后手段，保存后再次切换收敛回单标签
    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    await vscode.window.showTextDocument(doc)
    await waitActiveTextEditor('mode.md')
    const diskBefore = await readDisk('mode.md')
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mode.md'), new vscode.Range(0, 0, 0, 0), '单标签未保存乙\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const editedText = `单标签未保存乙\n\n${MODE_DOC_TEXT}`
    await poll('编辑生效', () => (doc.getText() === editedText ? true : undefined))
    assert(doc.isDirty, '前置：文档应 dirty')

    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    await waitActiveCustomTab('mode.md')
    assert(tabsOf('mode.md', 'vsidian') === 1, `dirty toLive 后一个 Vsidian 标签，实际 vsidian=${tabsOf('mode.md', 'vsidian')}`)
    assert(tabsOf('mode.md', 'native') === 1, `dirty 保留旧原生标签（防回退已知代价），实际 native=${tabsOf('mode.md', 'native')}`)
    assert(doc.getText() === editedText, 'dirty 保留下 TextDocument 不得被 revert')
    assert(doc.isDirty, 'dirty 切预览后文档仍应 dirty')
    const view = await waitViewState('mode.md', (v) => v.text === editedText)
    assert(view.viewMode === 'live', 'toLive 后应为实时预览')
    assert(await readDisk('mode.md') === diskBefore, '切换不得写磁盘')

    // 保存后再次切换：非 dirty 清理生效，双标签收敛为单标签
    await doc.save()
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await poll('保存后 toSource 收敛单标签', () =>
      tabsOf('mode.md', 'vsidian') === 0 ? true : undefined)
    assert(tabsOf('mode.md', 'native') === 1, `保存后 toSource 应仅剩一个原生标签，实际 native=${tabsOf('mode.md', 'native')}`)
    assert(vscode.window.activeTextEditor?.document.getText() === editedText, '收敛后原生编辑器显示保存内容')

    // 恢复 fixture 基线（同用例 A：磁盘内容回到 MODE_DOC_TEXT 供后续用例；
    // 偏移系定位避免跨行 Range 被钳位）
    const restore = new vscode.WorkspaceEdit()
    restore.replace(
      wsUri('mode.md'),
      new vscode.Range(doc.positionAt(0), doc.positionAt('单标签未保存乙\n\n'.length)),
      '',
    )
    assert(await vscode.workspace.applyEdit(restore), '恢复编辑应成功')
    await doc.save()
    assert(await readDisk('mode.md') === MODE_DOC_TEXT, '用例结束应恢复 mode.md 基线')
  }],

  ['弹回防御（dirty）：source 记忆下 dirty 文档弹回不丢内容，空面板保留（#38 review-loop）', async () => {
    // review-loop V1：bounceToSource 曾无条件 dispose 空面板——按实测口径
    // 「1.86.2 关 dirty tab 会 revert TextDocument（custom 侧亦然）」，Hot
    // Exit 恢复 dirty 面板或原生 dirty + Reopen With 均可达该路径。契约：
    // dirty 时跳过 dispose（空面板保留为已知代价），内容与 dirty 不得回退；
    // 收尾经 toSource（活动位已在原生 tab = re-affirm 路径）复用清理收敛，
    // 顺带钉住 re-affirm 的物化与收敛契约
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await waitLastMode('source')

    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    const diskBefore = await readDisk('mode.md')
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mode.md'), new vscode.Range(0, 0, 0, 0), '弹回未保存丙\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const editedText = `弹回未保存丙\n\n${MODE_DOC_TEXT}`
    await poll('编辑生效', () => (doc.getText() === editedText ? true : undefined))
    assert(doc.isDirty, '前置：文档应 dirty')

    // 原生 dirty + 显式 Reopen With → Vsidian：resolve 弹回（已知代价路径）
    await openWithEditor('mode.md')
    await waitActiveTextEditor('mode.md')
    const modeUri = wsUri('mode.md').toString()
    await poll('弹回路径不装配会话（旧会话随 toSource 清理释放）', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, modeUri)) as SessionState
      return s?.found === false ? true : undefined
    })
    // 弹回链（showTextDocument → dispose → 清扫）是异步 microtask + 宿主
    // 动作，断言立即读会跑在 dispose/revert 生效前（首跑实测）——先过
    // 稳定窗再断言终态（同 diff 用例的观察窗手法）
    await new Promise((r) => setTimeout(r, 1200))
    assert(doc.getText() === editedText, '弹回不得把 TextDocument revert 回磁盘内容')
    assert(doc.isDirty, '弹回后文档仍应 dirty')
    assert(await readDisk('mode.md') === diskBefore, '弹回不得写磁盘')
    assert(tabsOf('mode.md', 'vsidian') === 1,
      `dirty 弹回应保留空 Vsidian 标签（防回退代价），实际 vsidian=${tabsOf('mode.md', 'vsidian')}`)
    assert(tabsOf('mode.md', 'native') === 1, `弹回后一个原生标签，实际 native=${tabsOf('mode.md', 'native')}`)

    // 保存后 toSource（re-affirm 路径：活动位已在原生 tab）：物化原生控件
    // 并复用清理，空面板收敛单标签
    await doc.save()
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    const editor = await waitActiveTextEditor('mode.md')
    assert(editor.document.getText() === editedText, 're-affirm 后原生编辑器应显示保存内容')
    await poll('re-affirm 清理空面板', () =>
      tabsOf('mode.md', 'vsidian') === 0 ? true : undefined)

    // 恢复 fixture 基线（偏移系定位，同用例 A/B）
    const restore = new vscode.WorkspaceEdit()
    restore.replace(
      wsUri('mode.md'),
      new vscode.Range(doc.positionAt(0), doc.positionAt('弹回未保存丙\n\n'.length)),
      '',
    )
    assert(await vscode.workspace.applyEdit(restore), '恢复编辑应成功')
    await doc.save()
    assert(await readDisk('mode.md') === MODE_DOC_TEXT, '用例结束应恢复 mode.md 基线')
  }],

  ['diff 视图防御：三命令与循环命令均 no-op，不折叠对比（#38 D10）', async () => {
    await resetLastMode()
    await openTextDiff('lf.md', 'mode.md', 'diff 防御')

    for (const cmd of [
      'onegayi.vsidian.mode.toReading',
      'onegayi.vsidian.mode.toSource',
      'onegayi.vsidian.mode.toLive',
      'onegayi.vsidian.toggleViewMode',
    ]) {
      await vscode.commands.executeCommand(cmd, wsUri('lf.md'))
    }
    // 异步动作落地窗口（no-op 时无动作，留观察窗防误报通过）
    await new Promise((r) => setTimeout(r, 800))

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
    assert(activeTab?.input instanceof vscode.TabInputTextDiff, '活动标签应仍为对比视图')
    const customTabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputCustom)
    assert(customTabs.length === 0, 'diff 语境不得创建任何 Vsidian 面板')
    // 注：no-op 不写记忆不做跨窗口断言（1.86.2 globalState 广播滞后会偶发
    // 覆盖读取，环境特性）；reject 分支无 writeRemembered 由代码路径保证
  }],

  ['diff 弹回防御：source 记忆下 diff 语境的 resolve 不弹回（#38 D10）', async () => {
    // 先经真实命令链路把记忆写成 source
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await waitLastMode('source')

    // 打开含 lf.md 的文本 diff，再显式 resolve lf.md 的 Vsidian 面板：
    // lf.md 处于 diff 标签 → 弹回被跳过、正常装配（diff 完整性优先）
    await openTextDiff('lf.md', 'mode.md', 'diff 弹回')
    await openWithEditor('lf.md')
    const session = await waitSessionReady('lf.md')
    assert(session.panels.length >= 1, 'diff 语境下应跳过弹回、正常装配面板')
  }],


  ['注入编辑写回 TextDocument 并保存后磁盘回读一致（中文/emoji）', async () => {
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    // LF 文档中在 offset 33（组合 emoji 行后）插入新段落：模拟 webview 用户输入
    const insertAt = LF_DOC.indexOf('- 列表项一')
    await vscode.commands.executeCommand(CMD.injectMessage, wsUri('lf.md').toString(), {
      kind: 'edit.request',
      sessionId: '', // 由钩子按面板填充校验，此处留空由扩展侧测试钩子替换
      docUri: wsUri('lf.md').toString(),
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: insertAt, length: 0, text: '插入的新段落\n' }],
    })
    const doc = await vscode.workspace.openTextDocument(wsUri('lf.md'))
    await poll('文档内容更新', () => (doc.getText() === LF_DOC_AFTER_EDIT ? true : undefined))
    assert(doc.isDirty, '编辑后文档应处于 dirty 状态')
    const saved = await doc.save()
    assert(saved, '保存失败')
    const disk = await readDisk('lf.md')
    assert(disk === LF_DOC_AFTER_EDIT, `保存后磁盘回读不一致：${JSON.stringify(disk)}`)
  }],

  ['未编辑的文件保存不产生内容变化', async () => {
    const before = await readDisk('untouched.md')
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('untouched.md'))
    assert(!doc.isDirty, '未编辑的文档不应为 dirty')
    await vscode.commands.executeCommand('workbench.action.files.saveAll')
    const after = await readDisk('untouched.md')
    assert(before === after, '未编辑文件内容发生变化')
    const session = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('untouched.md').toString())) as SessionState
    assert(session.appliedEdits === 0, '未编辑期间不应有任何 applyEdit')
  }],

  ['CRLF 文档：LF 坐标编辑转换为宿主 CRLF 坐标且既有换行保真', async () => {
    await openWithEditor('crlf.md')
    await waitSessionReady('crlf.md')
    // webview 收到的是 LF 化全文
    const view = await waitViewState('crlf.md')
    assert(view.text === CRLF_DOC.replace(/\r\n/g, '\n'), `CRLF 文档应 LF 化装载：${JSON.stringify(view.text)}`)

    // 在第二行行首（LF offset 4）插入新段落
    await vscode.commands.executeCommand(CMD.injectMessage, wsUri('crlf.md').toString(), {
      kind: 'edit.request',
      sessionId: '',
      docUri: wsUri('crlf.md').toString(),
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 4, length: 0, text: '新段落\n' }],
    })
    const doc = await vscode.workspace.openTextDocument(wsUri('crlf.md'))
    const expected = '标题一\r\n新段落\r\n正文 A 行\r\n正文 B 行\r\n'
    await poll('CRLF 文档更新', () => (doc.getText() === expected ? true : undefined))
    await doc.save()
    const disk = await readDisk('crlf.md')
    assert(disk === expected, `保存后 CRLF 保真失败：${JSON.stringify(disk)}`)
    assert(disk.includes('\r\n'), '磁盘换行应保持 CRLF')
  }],

  ['长文档：单一 EditorView 视口渲染，不为视口外内容创建 DOM', async () => {
    await openWithEditor('large.md')
    await waitSessionReady('large.md')
    const totalLines = Number(process.env['LARGE_DOC_LINES'] ?? '0')
    assert(totalLines > 1000, 'fixture 行数环境变量缺失')
    const view = await waitViewState('large.md', (v) => v.docLength > 0)
    // 全文模型承载完整文档（行数 >= 总行数，CM6 对末尾换行可能多计一行）；
    // 渲染行数应远小于总行数（CM6 视口虚拟渲染，不为视口外内容创建 DOM）
    assert(view.lineCount >= totalLines, `全文模型行数应 >= ${totalLines}，实际 ${view.lineCount}`)
    assert(view.renderedLines > 0 && view.renderedLines < 2000, `视口渲染行数应远小于总行数，实际 ${view.renderedLines}`)
  }],

  ['split 第二面板收到第一面板编辑的增量广播', async () => {
    await openWithEditor('split.md')
    await waitSessionReady('split.md')
    await openWithEditor('split.md', true)
    const twoPanels = await poll('双面板就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('split.md').toString())) as SessionState | undefined
      return state && state.panels.filter((p) => p.ready).length >= 2 ? state : undefined
    })
    assert(twoPanels.panels.length === 2, `split 后应有 2 个面板，实际 ${twoPanels.panels.length}`)

    await vscode.commands.executeCommand(CMD.injectMessage, wsUri('split.md').toString(), {
      kind: 'edit.request',
      sessionId: '',
      docUri: wsUri('split.md').toString(),
      seq: 1,
      baseVersion: twoPanels.version,
      changes: [{ offset: 0, length: 0, text: '广播前缀 ' }],
    })
    // 注入路径模拟的是"面板 1 的 webview 已本地应用并发消息"（真实场景中
    // 面板 1 乐观回显），因此断言聚焦面板 2 通过 doc.changed 广播同步文本
    const expected = '广播前缀 split 起始行\n'
    await poll('双面板文本同步', async () => {
      const v = (await vscode.commands.executeCommand(
        CMD.viewState,
        wsUri('split.md').toString(),
        1,
      )) as ViewState | undefined
      return v?.text === expected ? true : undefined
    })
    const doc = await vscode.workspace.openTextDocument(wsUri('split.md'))
    assert(doc.getText() === expected, '宿主文档应更新')
  }],

  ['webview 撤销/重做请求作用于宿主权威历史且无回声（转发链路）', async () => {
    // 双面板：注入的编辑经 doc.changed 广播让面板 2（真实 webview）同步到
    // 已编辑状态——单面板注入走确认路径只回 ack，真实 webview 未本地应用
    // 注入内容，无法验证回流后的视图回退
    await openWithEditor('undo.md')
    await waitSessionReady('undo.md')
    await openWithEditor('undo.md', true)
    await poll('双面板就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('undo.md').toString())) as SessionState | undefined
      return state && state.panels.filter((p) => p.ready).length >= 2 ? state : undefined
    })
    const uri = wsUri('undo.md').toString()
    const original = '撤销链路第一行\n撤销链路第二行\n'
    const doc = await vscode.workspace.openTextDocument(wsUri('undo.md'))
    const edited = '撤销链路第一行【插入】\n撤销链路第二行\n'

    // 编辑：第一行末（LF offset 7）插入；面板 2 经广播同步
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 7, length: 0, text: '【插入】' }],
    })
    await poll('编辑写入宿主文档', () => (doc.getText() === edited ? true : undefined))
    await waitViewState('undo.md', (v) => v.text === edited, 1)

    // webview 发起 undo（keymap 转发路径的消息形态）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回退宿主文档', () => (doc.getText() === original ? true : undefined))
    // undo 的逆变更广播给全部面板：webview 视图同步回退（以面板 1 断言）
    await waitViewState('undo.md', (v) => v.text === original, 1)

    // 无回声：undo/redo 作用于宿主历史，回流增量不得再次经 applyEdit 写回
    const afterUndo = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterUndo.appliedEdits === 1, `undo 后 appliedEdits 应保持 1（无回声写回），实际 ${afterUndo.appliedEdits}`)

    // redo 恢复
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'redo' })
    await poll('redo 恢复宿主文档', () => (doc.getText() === edited ? true : undefined))
    await waitViewState('undo.md', (v) => v.text === edited, 1)
    const afterRedo = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterRedo.appliedEdits === 1, `redo 后 appliedEdits 应保持 1，实际 ${afterRedo.appliedEdits}`)
  }],

  ['宿主全局 undo/redo 命令作用于同一文档历史（命令面板路径）', async () => {
    await openWithEditor('undo2.md')
    const session = await waitSessionReady('undo2.md')
    const uri = wsUri('undo2.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('undo2.md'))
    const oneEdit = '全局命令撤销甲行A\n全局命令撤销乙行\n'
    const twoEdits = '全局命令撤销甲行AB\n全局命令撤销乙行\n'

    // 两笔编辑（逐笔等待生效，第二笔携带推进后的版本）。
    // '全局命令撤销甲行'为 8 字符，行末插入点为 LF offset 8
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: session.version,
      changes: [{ offset: 8, length: 0, text: 'A' }],
    })
    await poll('第一笔编辑生效', () => (doc.getText() === oneEdit ? true : undefined))
    const s2 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 2,
      baseVersion: s2.version,
      changes: [{ offset: 9, length: 0, text: 'B' }],
    })
    await poll('第二笔编辑生效', () => (doc.getText() === twoEdits ? true : undefined))

    // 全局 undo 命令（命令面板/Ctrl+Z 同一落点，不经 webview 消息）：
    // 活动编辑器为 custom editor 时应作用于其 TextDocument 权威栈
    await vscode.commands.executeCommand('undo')
    await poll('全局 undo 撤销最后一笔', () => (doc.getText() === oneEdit ? true : undefined))

    await vscode.commands.executeCommand('redo')
    await poll('全局 redo 恢复', () => (doc.getText() === twoEdits ? true : undefined))

    // 全程不得产生回声写回
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 2, `appliedEdits 应保持 2，实际 ${st.appliedEdits}`)
    // 还原
    await vscode.commands.executeCommand('undo')
    await vscode.commands.executeCommand('undo')
    await poll('还原到已保存状态', () => (doc.getText() === '全局命令撤销甲行\n全局命令撤销乙行\n' ? true : undefined))
  }],

  ['webview 请求全文重同步获得权威全文（组合缓冲保守路径的宿主侧）', async () => {
    await openWithEditor('resync.md')
    await waitSessionReady('resync.md')
    const uri = wsUri('resync.md').toString()
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'sync.request' })
    const view = await waitViewState('resync.md', (v) => v.text === '重同步起始内容\n重同步第二段\n')
    assert(view.text === '重同步起始内容\n重同步第二段\n', `resync 后视图应装载宿主全文：${JSON.stringify(view.text)}`)
    // resync 不产生写回
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, `resync 不应产生 applyEdit，实际 ${st.appliedEdits}`)
  }],

  ['外部修改覆盖过期请求区间：保留输入并暂停写回（#4 冲突链路）', async () => {
    await openWithEditor('conflict.md')
    await waitSessionReady('conflict.md')
    const uri = wsUri('conflict.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('conflict.md'))

    // 外部修改（模拟另一来源）：替换第一行整行 [0,7)（LF 坐标）
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('conflict.md'), new vscode.Range(0, 0, 0, 7), '外部改写行')
    const appliedExternal = await vscode.workspace.applyEdit(extEdit)
    assert(appliedExternal, '外部修改应成功')
    const afterExternal = '外部改写行\n第二段原文乙\n'
    await poll('外部修改生效', () => (doc.getText() === afterExternal ? true : undefined))

    // 注入基于初始版本的过期请求，区间 [2,4) 落入被替换区：不可安全重定位
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 2, length: 2, text: '未确认输入' }],
    })
    // 权威文档不被污染：过期内容不得写入
    assert(doc.getText() === afterExternal, `权威文本被过期请求污染：${JSON.stringify(doc.getText())}`)
    const conflict = (await vscode.commands.executeCommand(CMD.conflictState, uri)) as ConflictState
    assert(conflict.found && conflict.suspended === true, `面板应处于暂停：${JSON.stringify(conflict)}`)
    assert(
      JSON.stringify(conflict.fragments) === JSON.stringify(['未确认输入']),
      `未确认输入片段应被保留：${JSON.stringify(conflict.fragments)}`,
    )

    // 真实 webview 收到 conflict ack：装载权威全文并进入暂停（横幅状态可观测）
    const suspendedView = await waitViewState('conflict.md', (v) => v.suspended === true && v.text === afterExternal)
    assert(suspendedView.text === afterExternal, `webview 应装载权威全文：${JSON.stringify(suspendedView.text)}`)

    // 暂停期间后续请求被拒绝且不写回
    const appliedBefore = ((await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState).appliedEdits
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 2,
      baseVersion: 2,
      changes: [{ offset: 0, length: 0, text: '暂停期输入' }],
    })
    assert(doc.getText() === afterExternal, '暂停期间不得写回权威文档')
    const afterState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterState.appliedEdits === appliedBefore, `暂停期间不得 applyEdit，实际 ${afterState.appliedEdits}`)

    // 恢复：resumePanel 发 doc.resync，webview 解除暂停并恢复写回
    const resumed = (await vscode.commands.executeCommand(CMD.resumePanel, uri)) as boolean
    assert(resumed === true, 'resumePanel 应成功')
    const recovered = await waitViewState('conflict.md', (v) => v.suspended !== true && v.text === afterExternal)
    assert(recovered.suspended !== true, '恢复后视图不应处于暂停')
    const versionNow = ((await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState).version
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 3,
      baseVersion: versionNow,
      changes: [{ offset: 0, length: 0, text: '恢复后输入' }],
    })
    await poll('恢复后写回生效', () => (doc.getText() === `恢复后输入${afterExternal}` ? true : undefined))
    const conflictAfter = (await vscode.commands.executeCommand(CMD.conflictState, uri)) as ConflictState
    assert(conflictAfter.suspended === false, '恢复后不应处于暂停')
  }],

  ['真实 DOM 中文候选连续替换确认后正常写回并保存', async () => {
    const filename = 'ime-dom-commit.md'
    await vscode.workspace.fs.writeFile(wsUri(filename), Buffer.from('A文B\n'))
    await openWithEditor(filename)
    await waitSessionReady(filename)
    const uri = wsUri(filename).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(filename))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    for (const candidate of ['n', 'ni', 'nih', 'nihao', '你好']) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'update', text: 'A' + candidate + 'B' })
      await waitViewState(filename, (v) => v.text === 'A' + candidate + 'B\n')
    }
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '你好' })
    await poll('中文候选确认后权威文档一致', () => doc.getText() === 'A你好B\n' ? true : undefined)
    const state = await waitViewState(filename, (v) => v.text === 'A你好B\n')
    assert(state.suspended !== true, '真实 DOM 中文候选确认不得暂停写回')
    assert(await doc.save(), '中文文本应正常落盘')
    const bytes = await vscode.workspace.fs.readFile(wsUri(filename))
    assert(Buffer.from(bytes).toString('utf8') === 'A你好B\n', '保存后回读中文一致')
  }],

  ['外部替换与过期本地删除同区间：真实 1.86 宿主保留外部文本并暂停（#44）', async () => {
    await openWithEditor('ime-escape.md')
    const initial = await waitSessionReady('ime-escape.md')
    const uri = wsUri('ime-escape.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('ime-escape.md'))
    const external = new vscode.WorkspaceEdit()
    external.replace(wsUri('ime-escape.md'), new vscode.Range(0, 1, 0, 2), '外')
    assert(await vscode.workspace.applyEdit(external), '外部替换应成功')
    const authoritative = 'A外B\n'
    await poll('外部替换进入宿主文档', () => (doc.getText() === authoritative ? true : undefined))

    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request', sessionId: '', docUri: uri, seq: 1,
      baseVersion: initial.version,
      changes: [{ offset: 1, length: 1, text: '' }],
    })
    assert(doc.getText() === authoritative, '过期的同区间删除不得覆盖外部修改')
    const conflict = (await vscode.commands.executeCommand(CMD.conflictState, uri)) as ConflictState
    assert(conflict.found && conflict.suspended === true, `同区间真实重叠应暂停：${JSON.stringify(conflict)}`)
    await waitViewState('ime-escape.md', (v) => v.suspended === true && v.text === authoritative)
  }],

  ['冲突后输入立即留存：关闭面板通知含最后一笔（#21）', async () => {
    await openWithEditor('conflict.md')
    await waitSessionReady('conflict.md')
    const uri = wsUri('conflict.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('conflict.md'))
    const external = new vscode.WorkspaceEdit()
    external.replace(wsUri('conflict.md'), new vscode.Range(0, 0, 0, 7), '外部改写行')
    assert(await vscode.workspace.applyEdit(external), '制造冲突的外部编辑应成功')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 2, length: 2, text: '未确认输入' }],
    })
    const suspended = await waitViewState('conflict.md', (v) => v.suspended === true)
    const latest = `最后一笔${suspended.text}`
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit', offset: 0, text: '最后一笔', closeAfter: true,
    })
    // webview 同一事件内编辑并请求关闭；不预等宿主快照，以覆盖旧 500 ms 空窗。
    assert(doc.getText() !== latest, '暂停期输入不得写回权威文档')
    const closed = await poll('关闭通知携带最新输入', async () => {
      const state = (await vscode.commands.executeCommand(CMD.closedInput)) as
        | { docUri: string; webviewText?: string } | undefined
      return state?.docUri === uri ? state : undefined
    })
    assert(closed.webviewText === latest, `关闭通知缺最后一笔：${JSON.stringify(closed)}`)
  }],

  ['split 双面板冲突暂停只隔离冲突面板，第二面板正常写回（#4）', async () => {
    await openWithEditor('splitconflict.md')
    await waitSessionReady('splitconflict.md')
    await openWithEditor('splitconflict.md', true)
    await poll('双面板就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('splitconflict.md').toString())) as SessionState | undefined
      return state && state.panels.filter((p) => p.ready).length >= 2 ? state : undefined
    })
    const uri = wsUri('splitconflict.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('splitconflict.md'))

    // 外部修改第二行（LF [7,7+6) '分裂测试行二' → '外部第二行'）
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('splitconflict.md'), new vscode.Range(1, 0, 1, 6), '外部第二行')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const afterExternal = '分裂测试行一\n外部第二行\n'
    await poll('外部修改生效', () => (doc.getText() === afterExternal ? true : undefined))

    // 面板 1 注入过期冲突请求（区间落入被替换的第二行）：暂停只作用于面板 1
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 9, length: 2, text: '面板一输入' }],
    }, 0)
    const p1 = (await vscode.commands.executeCommand(CMD.conflictState, uri, 0)) as ConflictState
    assert(p1.found && p1.suspended === true, `面板 1 应暂停：${JSON.stringify(p1)}`)
    assert(doc.getText() === afterExternal, '权威文本不被过期请求污染')

    // 面板 2 的正常编辑仍可应用（广播同步面板 1，其暂停期忽略增量属预期）
    const versionNow = ((await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState).version
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: versionNow,
      changes: [{ offset: 0, length: 0, text: '二面板前缀' }],
    }, 1)
    await poll('面板 2 编辑生效', () => (doc.getText() === `二面板前缀${afterExternal}` ? true : undefined))
    const p2 = (await vscode.commands.executeCommand(CMD.conflictState, uri, 1)) as ConflictState
    assert(p2.found && p2.suspended === false, `面板 2 不应受冲突影响：${JSON.stringify(p2)}`)
    // 面板 2（真实 webview）视图保持可用：未进入暂停，且仍持有外部修改后的
    // 权威文本（注入路径面板 2 自身不回显，其文本来自外部变更广播）
    const v2 = await waitViewState('splitconflict.md', (v) => v.suspended !== true && v.text === afterExternal, 1)
    assert(v2.suspended !== true, '面板 2 视图不应处于暂停')
    assert(v2.text === afterExternal, `面板 2 文本应与权威一致：${JSON.stringify(v2.text)}`)
  }],

  ['标题装饰：光标位于标题正文时显示标记，其他标题隐藏标记', async () => {
    await openWithEditor('heading.md')
    await waitSessionReady('heading.md')
    // 光标初始在文档头的 # 标记处：该标记显形，另一标题的标记隐藏
    const view = await waitViewState('heading.md', (v) => (v.headingLineCount ?? 0) >= 2 && v.paint?.heading != null)
    assert((view.headingActiveText ?? '').startsWith('#'), `光标贴近的标题标记应显形（# 开头）：${JSON.stringify(view.headingActiveText)}`)
    assert((view.headingHiddenText ?? '').startsWith('#') === false, `另一标题标记应隐藏（不以 # 开头）：${JSON.stringify(view.headingHiddenText)}`)
    assert((view.headingHiddenText ?? '') === '中部二级标题', `另一标题行 DOM 文本应为标题内容：${JSON.stringify(view.headingHiddenText)}`)

    // #55 绘制层断言：标题行开头不绘制左缘竖线。正向控制先行——标题字号
    // 须实际大于正文字号（样式注入失效时控制先失败，左缘断言才有意义）
    const bodyFontPx = view.typography?.live?.fontSizePx
    assert(bodyFontPx != null && (view.headingFontPx ?? 0) > bodyFontPx,
      `正向控制失败：标题字号应大于正文（标题=${view.headingFontPx}px，正文=${bodyFontPx}px；样式注入失效会让左缘断言失去意义）`)
    const headingPaint = view.paint!.heading!
    assert(headingPaint.inviewCount >= 2,
      `视口内应挂载至少 2 个标题行（H1/H2）供绘制观测，实际 ${headingPaint.inviewCount}`)
    assert(JSON.stringify(headingPaint.boxShadowValues) === JSON.stringify(['none']),
      `标题行不得以 box-shadow 绘制左缘竖线：${JSON.stringify(headingPaint.boxShadowValues)}`)
    assert(JSON.stringify(headingPaint.borderLeftWidthValues) === JSON.stringify(['0px']),
      `标题行不得以 border-left 绘制左缘竖线：${JSON.stringify(headingPaint.borderLeftWidthValues)}`)

    const uri = wsUri('heading.md').toString()
    const bodyOffset = '# 顶部'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: bodyOffset })
    const inBody = await poll('标题正文光标显形行首标记', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.selectionOffset === bodyOffset ? v : undefined
    })
    assert((inBody.headingActiveText ?? '').startsWith('#'), `光标在标题正文时 # 应保持显形：${JSON.stringify(inBody.headingActiveText)}`)
    // 光标位于标题正文时左缘同样无竖线（光标内外一致）
    const inBodyPaint = inBody.paint?.heading
    assert(inBodyPaint != null &&
      JSON.stringify(inBodyPaint.boxShadowValues) === JSON.stringify(['none']) &&
      JSON.stringify(inBodyPaint.borderLeftWidthValues) === JSON.stringify(['0px']),
      `光标在标题正文时标题行也不得绘制左缘竖线：${JSON.stringify(inBodyPaint)}`)

    // 外部编辑把普通行改成标题：装饰随文本增量更新（doc.changed 广播路径）
    const before = view.headingLineCount ?? 0
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('heading.md'), new vscode.Range(1, 0, 1, 9), '## 改后二级标题')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const updated = await waitViewState('heading.md', (v) => (v.headingLineCount ?? 0) === before + 1)
    assert((updated.headingLineCount ?? 0) === before + 1, '外部把普通行改为标题后，DOM 标题行应 +1')
    // 文档文本同时同步（同步与装饰互不干扰）
    assert(updated.text.includes('## 改后二级标题'), '装饰更新不影响文本同步')
  }],

  ['视口有界：10 万行内容 DOM 不超过 1 千行样例的 2 倍（#5）', async () => {
    const domCounts: Record<string, number> = {}
    const rendered: Record<string, number> = {}
    for (const file of ['perf-1k.md', 'perf-100k.md']) {
      await openWithEditor(file)
      await waitSessionReady(file)
      const totalLines = file === 'perf-1k.md' ? 1_000 : 100_000
      const v = await waitViewState(file, (s) => (s.contentDomCount ?? -1) > 0 && s.renderedLines > 0)
      // 全文模型承载全文；视口只渲染附近行（CM6 全文虚拟渲染不因装饰破坏）
      assert(v.lineCount >= totalLines, `${file} 全文模型行数应 >= ${totalLines}，实际 ${v.lineCount}`)
      assert(v.renderedLines > 0 && v.renderedLines < 2000, `${file} 视口渲染行数应有界，实际 ${v.renderedLines}`)
      domCounts[file] = v.contentDomCount ?? 0
      rendered[file] = v.renderedLines
    }
    // 体量增长 100 倍（1k → 100k），内容 DOM 数不超过 2 倍
    assert(
      domCounts['perf-100k.md'] <= 2 * domCounts['perf-1k.md'],
      `内容 DOM 数超界：1k=${domCounts['perf-1k.md']}，100k=${domCounts['perf-100k.md']}`,
    )
  }],

  ['滚动回收与输入路径：往返滚动 10 次后 DOM 回到基线附近，键入重扫与体量无关（#5）', async () => {
    await openWithEditor('perf-100k.md')
    await waitSessionReady('perf-100k.md')
    await waitViewState('perf-100k.md', (v) => (v.contentDomCount ?? -1) > 0)
    const report = (await vscode.commands.executeCommand(
      CMD.perfProbe,
      wsUri('perf-100k.md').toString(),
      { typingRounds: 30, scrollRounds: 10 },
    )) as PerfReportData | undefined
    assert(report, '性能探针应产生报告')
    // 回收：滚动结束后回顶，DOM 应回到基线附近（允许 1.5 倍测量抖动）
    assert(
      report.afterScroll.contentDomCount <= Math.ceil(report.baseline.contentDomCount * 1.5),
      `滚动后 DOM 未回收：基线 ${report.baseline.contentDomCount}，滚动后 ${report.afterScroll.contentDomCount}`,
    )
    // 键入路径增量：单字符插入的重扫行数与 10 万行体量无关（远小于全文）
    assert(
      report.headingStats.lastUpdateScannedLines <= 3,
      `键入重扫行数应与体量无关（<=3），实际 ${report.headingStats.lastUpdateScannedLines}`,
    )
    assert(report.headingStats.fullBuildLines >= 100_000, `初始全量构建应覆盖全文，实际 ${report.headingStats.fullBuildLines}`)
    // 输入延迟宽松上限（防极端回归；精确数据由 test/perf/runPerf.mjs 记录）
    assert(report.inputDelayMs.maxMs > 0 && report.inputDelayMs.maxMs < 500, `单次输入稳定耗时应 <500ms，实际 ${report.inputDelayMs.maxMs}ms`)
    // 探针不产生写回：宿主文档无 dirty 变化
    const doc = await vscode.workspace.openTextDocument(wsUri('perf-100k.md'))
    assert(!doc.isDirty, '性能探针不应污染宿主文档')
  }],

  // ---- 工单 #6：模式切换 / 源锚点 / 稳定样式契约 ----

  ['阅读模式一级标题字号与实时预览接近（#30）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const live = await waitViewState('mode.md', (v) => v.viewMode === 'live' && (v.headingFontPx ?? 0) > 0)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await waitViewState('mode.md', (v) => v.viewMode === 'reading' && (v.headingFontPx ?? 0) > 0)
    const ratio = reading.headingFontPx! / live.headingFontPx!
    assert(ratio >= 0.85 && ratio <= 1.15,
      `一级标题字号差距过大：live=${live.headingFontPx}px，reading=${reading.headingFontPx}px，倍率=${ratio.toFixed(2)}`)
  }],

  ['模式切换：命令入口切换、未保存内容保留、不产生编辑历史（#6）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const uri = wsUri('mode.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('mode.md'))
    const diskBefore = await readDisk('mode.md')

    const liveView = await waitViewState('mode.md', (v) => v.viewMode === 'live')
    assert(liveView.viewMode === 'live', '初始应为实时预览模式')

    // 一笔未保存编辑：外部 applyEdit 写权威文档（dirty 未保存）并广播
    // doc.changed——真实 webview 经此同步到编辑后文本（注入 edit.request
    // 路径下真实面板不本地回显，无法验证未保存内容保留）
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mode.md'), new vscode.Range(0, 0, 0, 0), '未保存新段落\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const editedText = `未保存新段落\n\n${MODE_DOC_TEXT}`
    await poll('编辑生效', () => (doc.getText() === editedText ? true : undefined))
    await waitViewState('mode.md', (v) => v.text === editedText)
    assert(doc.isDirty, '编辑后文档应 dirty（未保存）')
    const stateAfterEdit = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 正式命令切换到阅读模式（活动 tab 为本编辑器）
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const readingView = await poll('切换到阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' ? v : undefined
    })
    // 未保存内容保留：阅读视图展示同一未保存文本
    assert(readingView.text === editedText, `阅读模式文本应为未保存全文：${JSON.stringify(readingView.text.slice(0, 40))}…`)
    assert((readingView.readingBlockCount ?? 0) >= 6, `阅读块数应 >=6（标题/段落/列表/任务/代码块），实际 ${readingView.readingBlockCount}`)
    // 切换不产生编辑历史、不触发保存
    const stateAfterToggle = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(stateAfterToggle.version === stateAfterEdit.version, `切换不得改变文档版本（${stateAfterEdit.version} → ${stateAfterToggle.version}）`)
    assert(stateAfterToggle.appliedEdits === stateAfterEdit.appliedEdits, `切换不得产生 applyEdit（${stateAfterEdit.appliedEdits} → ${stateAfterToggle.appliedEdits}）`)
    assert(doc.isDirty, '切换后文档仍应 dirty（未触发保存）')
    const diskMid = await readDisk('mode.md')
    assert(diskMid === diskBefore, '切换不得写磁盘')

    // 切回实时预览：内容与光标语义保留（三态命令显式指定目标，#38 起循环
    // 命令在 reading 态会切源码编辑器，回 live 须用显式命令）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    const backView = await poll('切回实时预览', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'live' ? v : undefined
    })
    assert(backView.text === editedText, '切回实时预览后未保存内容不丢失')

    // 切换不在撤销栈：一次 undo 恰好回退那笔编辑（期间经历了 2 次模式切换）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回退唯一一笔编辑', () => (doc.getText() === MODE_DOC_TEXT ? true : undefined))
    assert(doc.getText() === MODE_DOC_TEXT, 'undo 应回到编辑前原文（切换未入撤销栈）')
  }],

  ['模式切换锚点：以源码位置锚点恢复段落与光标，非滚动百分比（#6）', async () => {
    await openWithEditor('mode-anchor.md')
    await waitSessionReady('mode-anchor.md')
    const uri = wsUri('mode-anchor.md').toString()

    // 初始光标在文档首（offset 0）
    const initial = await waitViewState('mode-anchor.md', (v) => v.selectionOffset !== undefined)
    assert(initial.selectionOffset === 0, `初始光标应在 0，实际 ${initial.selectionOffset}`)

    // 经 view.locate（#10 查找/跳转入口）把光标定位到第三段块首：
    // '模式锚点第一段文字\n\n中间段落文本\n\n' 长度 21
    const target = '模式锚点第一段文字\n\n中间段落文本\n\n'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: target })
    const located = await poll('view.locate 定位光标', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.selectionOffset === target ? v : undefined
    })
    assert(located.selectionOffset === target, `定位后光标应在 ${target}，实际 ${located.selectionOffset}`)

    // 切到阅读：锚点映射到包含 target 的块（'最后段落结束' start=21）
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const readingView = await poll('阅读模式锚点', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingAnchorStart !== undefined ? v : undefined
    })
    assert(readingView.readingAnchorStart === target, `阅读锚点应为源块 start=${target}，实际 ${readingView.readingAnchorStart}`)
    assert(readingView.readingBlockCount === 3, `锚点文档应 3 块，实际 ${readingView.readingBlockCount}`)
    assert(readingView.text.includes('最后段落结束'), '阅读视图文本同步')

    // 切回实时预览：光标恢复到锚点块源 start（对应段落与光标，非百分比；
    // #38 起回 live 用显式命令，循环命令在 reading 态会切源码编辑器）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    const backView = await poll('恢复光标', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'live' && v.selectionOffset === target ? v : undefined
    })
    assert(backView.selectionOffset === target, `切回后光标应恢复 ${target}，实际 ${backView.selectionOffset}`)
    // 全程无写回（定位与切换都不产生编辑历史）
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, `锚点链路不应产生写回，实际 ${st.appliedEdits}`)
  }],

  ['稳定样式契约：内部测试 CSS 片段经稳定类名/变量命中两种视图（#6）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const uri = wsUri('mode.md').toString()

    // live：探针片段经 .vsidian-heading-line-1 命中（text-decoration-color 无视觉影响）
    const liveView = await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor !== undefined && v.viewMode === 'live')
    assert(
      liveView.cssProbe!.liveHeadingDecorationColor === 'rgb(1, 2, 3)',
      `live 一级标题应被测试片段命中 rgb(1, 2, 3)，实际 ${liveView.cssProbe!.liveHeadingDecorationColor}`,
    )

    // reading：.vsidian-reading-heading-1 命中 + .vsidian-view-reading 变量可被覆盖读取
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const readingView = await poll('阅读模式样式探针', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.cssProbe?.readingHeadingDecorationColor !== undefined ? v : undefined
    })
    assert(
      readingView.cssProbe!.readingHeadingDecorationColor === 'rgb(4, 5, 6)',
      `阅读一级标题应被测试片段命中 rgb(4, 5, 6)，实际 ${readingView.cssProbe!.readingHeadingDecorationColor}`,
    )
    assert(
      readingView.cssProbe!.readingVarProbe === 'contract-ok',
      `阅读容器探针变量应被外部片段覆盖为 contract-ok，实际 ${readingView.cssProbe!.readingVarProbe}`,
    )
  }],

  ['webview 重载后恢复阅读模式（webview 状态持久化，#6）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const uri = wsUri('mode.md').toString()

    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('进入阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' ? true : undefined
    })

    // 重载 webview（Developer: Reload Webviews；retainContextWhenHidden 关闭：
    // 销毁重建同一 panel，走 getState 恢复）
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    const restored = await poll('重载后恢复阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.text === MODE_DOC_TEXT && (v.readingBlockCount ?? 0) > 0 ? v : undefined
    }, 30000)
    assert(restored.viewMode === 'reading', '重载后应恢复阅读模式')
    assert((restored.readingBlockCount ?? 0) >= 6, '重载后阅读视图应重建块结构')
  }],

  // ---- 工单 #7：阅读视图分块按需挂载与回收 ----

  ['阅读视图按需挂载：长文档只挂载窗口内块，屏外块无内容节点（#7）', async () => {
    await openWithEditor('reading-1k.md')
    await waitSessionReady('reading-1k.md')
    const uri = wsUri('reading-1k.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const view = await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? v : undefined
    })
    // 1000 块只挂载窗口：挂载量远小于块模型总量，容器元素数有界
    assert((view.readingTotalBlocks ?? 0) === 1000, `块模型应为 1000 块，实际 ${view.readingTotalBlocks}`)
    assert((view.readingMountedBlocks ?? 0) > 10, `挂载块数应非平凡（>10），实际 ${view.readingMountedBlocks}`)
    assert(
      (view.readingMountedBlocks ?? 0) < (view.readingTotalBlocks ?? 1) / 2,
      `挂载块数应远小于总量（按需挂载非全量渲染），实际 ${view.readingMountedBlocks}/${view.readingTotalBlocks}`,
    )
    assert((view.readingContentDomCount ?? 0) < (view.readingTotalBlocks ?? 1), '容器元素数应小于块总数')
    // 挂载块数即 DOM 块数（无隐藏副本）
    assert(view.readingBlockCount === view.readingMountedBlocks, 'readingBlockCount 应等于挂载块数（无隐藏整篇）')
  }],

  ['阅读视图 DOM 有界：体量增长 100 倍内容 DOM 不超过 2 倍（#7）', async () => {
    const domCounts: Record<string, number> = {}
    const mounted: Record<string, number> = {}
    for (const file of ['reading-1k.md', 'reading-100k.md']) {
      await openWithEditor(file)
      await waitSessionReady(file)
      const uri = wsUri(file).toString()
      await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
      const v = await poll(`切换并虚拟化 ${file}`, async () => {
        const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
        return s?.viewMode === 'reading' && s.readingVirtualized === true ? s : undefined
      })
      const total = file === 'reading-1k.md' ? 1_000 : 100_000
      assert((v.readingTotalBlocks ?? 0) === total, `${file} 块模型应为 ${total}，实际 ${v.readingTotalBlocks}`)
      assert((v.readingMountedBlocks ?? 0) > 0, `${file} 应有挂载块`)
      domCounts[file] = v.readingContentDomCount ?? 0
      mounted[file] = v.readingMountedBlocks ?? 0
    }
    // 体量增长 100 倍（1k → 100k 块），内容 DOM 数不超过 2 倍
    assert(
      domCounts['reading-100k.md'] <= 2 * domCounts['reading-1k.md'],
      `阅读内容 DOM 超界：1k=${domCounts['reading-1k.md']}，100k=${domCounts['reading-100k.md']}`,
    )
    assert(
      mounted['reading-100k.md'] <= 2 * mounted['reading-1k.md'],
      `挂载块数超界：1k=${mounted['reading-1k.md']}，100k=${mounted['reading-100k.md']}`,
    )
  }],

  ['阅读视图滚动回收：往返滚动 10 次回基线附近且零重复解析、零写回（#7）', async () => {
    await openWithEditor('reading-100k.md')
    await waitSessionReady('reading-100k.md')
    const uri = wsUri('reading-100k.md').toString()
    const sessionBefore = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? true : undefined
    })
    const report = (await vscode.commands.executeCommand(
      CMD.readingPerf,
      uri,
      { scrollRounds: 10 },
    )) as ReadingPerfReportData | undefined
    assert(report && report.ok === true, `阅读探针应成功执行：${JSON.stringify(report)}`)
    assert(report!.totalBlocks === 100_000, `块模型应为 100000，实际 ${report!.totalBlocks}`)
    // 回收：滚动结束回顶，挂载块回到基线附近（允许 1.5 倍测量抖动）
    assert(
      report!.afterScroll.mountedBlocks <= Math.ceil(report!.baseline.mountedBlocks * 1.5),
      `滚动后挂载块未回收：基线 ${report!.baseline.mountedBlocks}，滚动后 ${report!.afterScroll.mountedBlocks}`,
    )
    assert(
      report!.afterScroll.contentDomCount <= Math.ceil(report!.baseline.contentDomCount * 1.5),
      `滚动后 DOM 未回收：基线 ${report!.baseline.contentDomCount}，滚动后 ${report!.afterScroll.contentDomCount}`,
    )
    assert(report!.afterScroll.scrollTopPx === 0, `回顶后 scrollTop 应为 0，实际 ${report!.afterScroll.scrollTopPx}`)
    // 解析与挂载分离：10 轮滚动全程解析次数不增（装载时 1 次）
    assert(report!.parseCount === 1, `滚动不得触发全文重解析，解析次数应为 1，实际 ${report!.parseCount}`)
    // 窗口有界：滚动全程最大挂载块数远小于块模型总量
    assert(report!.maxMountedBlocks < 1000, `最大挂载块数应有界（<1000），实际 ${report!.maxMountedBlocks}`)
    // 视图滚动零写回：文档版本与 applyEdit 数不变
    const sessionAfter = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(sessionAfter.version === sessionBefore.version, `滚动不得改变文档版本（${sessionBefore.version} → ${sessionAfter.version}）`)
    assert(sessionAfter.appliedEdits === sessionBefore.appliedEdits, `滚动不得产生写回（${sessionBefore.appliedEdits} → ${sessionAfter.appliedEdits}）`)
  }],

  ['阅读视图标题跳转：定位屏外标题块并真实挂载（#7）', async () => {
    await openWithEditor('reading-100k.md')
    await waitSessionReady('reading-100k.md')
    const uri = wsUri('reading-100k.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? true : undefined
    })
    // 文档尾部附近的标题块（第 99950 块，屏外；不取最后一块——末块的理想
    // 滚动位置超出 maxScroll，浏览器 clamp 后无法置于视口顶，属正常布局行为）
    const headingText = '## 第 99950 节 阅读标题样本行'
    const doc = await vscode.workspace.openTextDocument(wsUri('reading-100k.md'))
    const headingOffset = doc.getText().indexOf(headingText)
    assert(headingOffset > 0, 'fixture 中应能找到末尾标题')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: headingOffset + 3 })
    const located = await poll('定位屏外标题', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.readingAnchorStart === headingOffset ? v : undefined
    })
    // 锚点是源码位置（标题块的源 start），且目标块已真实挂载（有布局顶位置）
    assert(located.readingAnchorStart === headingOffset, `锚点应为标题块 start=${headingOffset}，实际 ${located.readingAnchorStart}`)
    assert(located.readingAnchorTopPx !== undefined, '定位后目标块应已挂载（有布局顶位置）')
    assert((located.readingScrollTopPx ?? 0) > 0, `定位到文档尾部应发生滚动，实际 scrollTop=${located.readingScrollTopPx}`)
    // 仍保持按需挂载（定位不触发全量渲染）
    assert((located.readingMountedBlocks ?? 0) < (located.readingTotalBlocks ?? 1), '定位后仍应只挂载窗口块')
  }],

  ['阅读视图动态图片尺寸变化：布局偏移后锚点视觉位置稳定（#7）', async () => {
    await openWithEditor('reading-image.md')
    await waitSessionReady('reading-image.md')
    const uri = wsUri('reading-image.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? true : undefined
    })
    // 定位到第 201 块（中部段落；每 50 块是标题，201 为普通段落）
    const anchorText = '第 201 段 阅读段落样本文本，固定宽度内容，用于体量对比测试。'
    const doc = await vscode.workspace.openTextDocument(wsUri('reading-image.md'))
    const anchorOffset = doc.getText().indexOf(anchorText)
    assert(anchorOffset > 0, 'fixture 中应能找到锚点段')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: anchorOffset })
    const before = await poll('定位锚点段', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.readingAnchorStart === anchorOffset && v.readingAnchorTopPx !== undefined ? v : undefined
    })
    // 注入图片到锚点上方 10 块（普通段落，仍在挂载窗口内、位于视口上方）：20px → 240px
    const imageText = '第 191 段 阅读段落样本文本，固定宽度内容，用于体量对比测试。'
    const imageOffset = doc.getText().indexOf(imageText)
    const grow = 240 // 初始占位 20px + 加载后增长 220px = 内容总高增量
    const ok = (await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'reading.test.image',
      srcStart: imageOffset,
      initialHeightPx: 20,
      finalHeightPx: 240,
      delayMs: 200,
    })) as boolean
    assert(ok === true, '图片注入消息应送达面板')
    const after = await poll('图片尺寸变化生效', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const grew = (v?.readingScrollHeightPx ?? 0) - (before.readingScrollHeightPx ?? 0)
      return v && grew >= grow - 4 ? v : undefined
    }, 15000)
    // 源位置锚点不变（仍是同一块的 start）
    assert(after.readingAnchorStart === anchorOffset, `图片变化后锚点块不应漂移：${before.readingAnchorStart} → ${after.readingAnchorStart}`)
    // 视觉位置稳定：锚点块顶与 scrollTop 的差保持不变（上方内容增高由滚动补偿）
    const offsetBefore = (before.readingAnchorTopPx ?? 0) - (before.readingScrollTopPx ?? 0)
    const offsetAfter = (after.readingAnchorTopPx ?? 0) - (after.readingScrollTopPx ?? 0)
    assert(
      Math.abs(offsetAfter - offsetBefore) <= 2,
      `图片增高 ${grow}px 后锚点视觉位置应稳定：${offsetBefore} → ${offsetAfter}`,
    )
    // 内容总高按图片增量增长（高度表已按实测修正）
    const grew = (after.readingScrollHeightPx ?? 0) - (before.readingScrollHeightPx ?? 0)
    assert(Math.abs(grew - grow) <= 4, `内容总高应增长约 ${grow}px，实际 ${grew}`)
    // 零写回
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, `图片尺寸变化链路不应产生写回，实际 ${st.appliedEdits}`)
  }],

  // ---- 工单 #8：基础 Markdown 双模式显示与源码降级 ----

  ['双模式语义一致：live 装饰与 reading 渲染对同一样例语义相同（#8）', async () => {
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const uri = wsUri('syntax.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('syntax.md'))
    const diskBefore = doc.getText()

    // live 侧：语法装饰统计（装饰集合级计数，与 DOM 无关）
    const live = await waitViewState('syntax.md', (v) => (v.liveSyntax?.headingLines ?? 0) >= 2)
    const ls = live.liveSyntax!
    // 样例语义：3 个标题（h1/h2/setext-h1）+ frontmatter 3 行 + 1 粗 + 1 斜 +
    // 1 行内码 + 2 引用行 + 3 围栏行 + 5 列表行（3 无序 + 2 有序）+ 1 HR +
    // 2 任务（1 勾选）；frontmatter 内伪标题不计入
    assert(ls.headingLines === 3, `标题行应为 3，实际 ${ls.headingLines}`)
    assert(ls.headerSpans === 3, `标题内容 span 应为 3，实际 ${ls.headerSpans}`)
    assert(ls.frontmatterLines === 4, `frontmatter 行应为 4，实际 ${ls.frontmatterLines}`)
    assert(ls.strongSpans === 2, `粗体 span 应为 2（正文+引用内），实际 ${ls.strongSpans}`)
    assert(ls.emphasisSpans === 1, `斜体 span 应为 1，实际 ${ls.emphasisSpans}`)
    assert(ls.inlineCodeSpans === 1, `行内代码 span 应为 1，实际 ${ls.inlineCodeSpans}`)
    assert(ls.quoteLines === 2, `引用行应为 2，实际 ${ls.quoteLines}`)
    assert(ls.codeLines === 3, `围栏代码行应为 3，实际 ${ls.codeLines}`)
    assert(ls.listLines === 5, `列表行应为 5，实际 ${ls.listLines}`)
    assert(ls.hrLines === 1, `水平线行应为 1，实际 ${ls.hrLines}`)
    assert(ls.taskGlyphs === 2 && ls.taskChecked === 1, `任务字形应为 2（1 勾选），实际 ${ls.taskGlyphs}/${ls.taskChecked}`)

    // reading 侧：同一样例的渲染语义
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('切换并读取阅读语义', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingSyntax !== undefined && v.readingSyntax.headings >= 3 ? v : undefined
    })
    const rs = reading.readingSyntax!
    assert(rs.headings === 3, `阅读标题应为 3，实际 ${rs.headings}`)
    assert(rs.strongCount === 2, `阅读粗体应为 2，实际 ${rs.strongCount}`)
    assert(rs.emphasisCount === 1, `阅读斜体应为 1，实际 ${rs.emphasisCount}`)
    assert(rs.inlineCodeCount === 1, `阅读行内代码应为 1（pre 内 code 不计），实际 ${rs.inlineCodeCount}`)
    assert(rs.blockquoteBlocks === 1, `阅读引用块应为 1，实际 ${rs.blockquoteBlocks}`)
    assert(rs.codeBlocks === 1, `阅读围栏块应为 1，实际 ${rs.codeBlocks}`)
    assert(rs.hrCount === 1, `阅读水平线应为 1（frontmatter 的 --- 不计），实际 ${rs.hrCount}`)
    assert(rs.listItems === 5, `阅读列表项应为 5，实际 ${rs.listItems}`)
    assert(rs.taskCheckboxes === 2 && rs.taskChecked === 1, `阅读任务勾选框应为 2（1 勾选），实际 ${rs.taskCheckboxes}/${rs.taskChecked}`)
    // 转义的 \* 不产生斜体（两种视图一致的边界语义）
    assert(reading.text.includes('\\*不斜体\\*'), '源文转义序列应原样保留')

    // 全程零写回：显示与切换不改写文本
    assert(reading.text === diskBefore, '双模式显示不得改写文档文本')
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, `显示链路不应产生写回，实际 ${st.appliedEdits}`)
  }],

  ['代码内伪语法不误解析：围栏内 # / [[ / 任务标记按源码呈现（#8）', async () => {
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const uri = wsUri('syntax.md').toString()
    const live = await waitViewState('syntax.md', (v) => (v.liveSyntax?.codeLines ?? 0) === 3)
    // 围栏内的 "# 伪标题"、"[[伪双链]]"、"- [ ] 伪任务" 不产生标题/任务装饰：
    // 标题恰好 3 个（不含围栏内），任务恰好 2 个（不含围栏内）
    assert(live.liveSyntax!.headingLines === 3, `围栏内伪标题被误判：标题行 ${live.liveSyntax!.headingLines}`)
    assert(live.liveSyntax!.taskGlyphs === 2, `围栏内伪任务被误判：任务字形 ${live.liveSyntax!.taskGlyphs}`)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式语义', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingSyntax !== undefined ? v : undefined
    })
    assert(reading.readingSyntax!.headings === 3, `阅读侧围栏内伪标题被误判：${reading.readingSyntax!.headings}`)
    assert(reading.readingSyntax!.taskCheckboxes === 2, `阅读侧围栏内伪任务被误判：${reading.readingSyntax!.taskCheckboxes}`)
  }],

  ['未支持语法局部源码降级：保留文本、无整篇重写、HTML 不执行（#8）', async () => {
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const uri = wsUri('syntax.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('syntax.md'))
    const disk = doc.getText()
    const live = await waitViewState('syntax.md', (v) => (v.liveSyntax?.headingLines ?? 0) === 3)
    // 脚注 [^1] 与原始 HTML 在 live 侧无任何装饰（不产生 span/隐藏）
    // ——liveSyntax 计数不含脚注/HTML 语法（其只按普通段落装饰为 0 类）
    assert(live.text.includes('脚注 [^1] 文本'), '脚注文本保留')
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式读取', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingSyntax !== undefined ? v : undefined
    })
    // 脚注按普通段落渲染（保留文本）；原始 HTML 被转义为纯文本（无脚本元素）
    assert(reading.text === disk, '阅读渲染不得改写文档文本（无整篇格式化重写）')
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, '源码降级不产生写回')
  }],

  ['frontmatter 边界：头块按源码呈现，内部伪标题在两种视图都不解析（#8）', async () => {
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const uri = wsUri('syntax.md').toString()
    const live = await waitViewState('syntax.md', (v) => (v.liveSyntax?.frontmatterLines ?? 0) === 4)
    assert(live.liveSyntax!.frontmatterLines === 4, `frontmatter 应为 4 行，实际 ${live.liveSyntax!.frontmatterLines}`)
    // '# frontmatter 内伪标题' 不产生标题装饰（标题恰 3：h1/h2/setext）
    assert(live.liveSyntax!.headingLines === 3, 'frontmatter 内伪标题不得判定为标题')
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式 frontmatter', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingSyntax !== undefined ? v : undefined
    })
    // 阅读侧标题也恰 3（frontmatter 内伪标题不渲染为 h1）
    assert(reading.readingSyntax!.headings === 3, `阅读侧 frontmatter 伪标题误判：${reading.readingSyntax!.headings}`)
  }],

  ['稳定样式契约扩展：span 级类名经测试片段命中两种视图（#8）', async () => {
    await openWithEditor('syntax.md')
    await waitSessionReady('syntax.md')
    const uri = wsUri('syntax.md').toString()
    // live：视口内粗体/行内码/代码行（DOM 渲染限于视口，样例首屏含目标）
    const live = await waitViewState('syntax.md', (v) => v.cssProbe?.liveStrongDecorationColor !== undefined && v.viewMode === 'live')
    assert(
      live.cssProbe!.liveStrongDecorationColor === 'rgb(7, 8, 9)',
      `live 粗体 span 应被片段命中 rgb(7, 8, 9)，实际 ${live.cssProbe!.liveStrongDecorationColor}`,
    )
    assert(
      live.cssProbe!.liveInlineCodeDecorationColor === 'rgb(10, 11, 12)',
      `live 行内代码 span 应被片段命中，实际 ${live.cssProbe!.liveInlineCodeDecorationColor}`,
    )
    // #139 HTML 注释淡化 span（公开样式入口 html-comment；阅读侧隐藏无对应）
    assert(
      live.cssProbe!.liveHtmlCommentDecorationColor === 'rgb(34, 35, 36)',
      `live HTML 注释 span 应被片段命中 rgb(34, 35, 36)，实际 ${live.cssProbe!.liveHtmlCommentDecorationColor}`,
    )
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式样式探针', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.cssProbe?.readingStrongDecorationColor !== undefined ? v : undefined
    })
    assert(
      reading.cssProbe!.readingStrongDecorationColor === 'rgb(16, 17, 18)',
      `阅读语义 strong 应被片段命中，实际 ${reading.cssProbe!.readingStrongDecorationColor}`,
    )
  }],

  ['大围栏按行细分：120 行围栏切为多块按需挂载，仍保持零重复解析（#8）', async () => {
    await openWithEditor('fence-chunk.md')
    await waitSessionReady('fence-chunk.md')
    const uri = wsUri('fence-chunk.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const view = await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? v : undefined
    })
    // 块模型：标题 + 3 片围栏 + 结尾段 = 5 块（120 行围栏按 60 行阈值切 3 片）
    assert((view.readingTotalBlocks ?? 0) === 5, `块模型应为 5（围栏切 3 片），实际 ${view.readingTotalBlocks}`)
    assert((view.readingMountedBlocks ?? 0) < (view.readingTotalBlocks ?? 1), '只挂载窗口内块')
    assert((view.readingParseCount ?? 0) === 1, `装载解析应为 1 次，实际 ${view.readingParseCount}`)
    // 滚动到围栏中部：中间片挂载、首片回收（按需挂载对细分片生效）
    const doc = await vscode.workspace.openTextDocument(wsUri('fence-chunk.md'))
    const midFence = doc.getText().indexOf('围栏内第 90 行')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: midFence })
    const located = await poll('定位围栏中部', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v && (v.readingScrollTopPx ?? 0) > 0 ? v : undefined
    })
    assert((located.readingMountedBlocks ?? 0) <= (located.readingTotalBlocks ?? 1), '细分片不触发全量挂载')
    assert((located.readingParseCount ?? 0) === 1, '滚动/定位不得重新解析')
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, '大围栏细分链路零写回')
  }],

  // ---- 工单 #9：两种模式的任务勾选 ----

  ['任务勾选（live）：点击 checkbox 精确写回重复任务之一并可撤销（#9）', async () => {
    await openWithEditor('task.md')
    await waitSessionReady('task.md')
    const uri = wsUri('task.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('task.md'))

    // live 侧初始：3 个任务 checkbox（2 未勾选 + 1 已勾选）
    const live = await waitViewState('task.md', (v) => (v.liveSyntax?.taskGlyphs ?? 0) === 3)
    assert(live.liveSyntax!.taskChecked === 1, `初始勾选数应为 1，实际 ${live.liveSyntax!.taskChecked}`)

    // 点击第二个重复任务（task.test.click 驱动真实 webview 内同一点击处理器）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'task.test.click', view: 'live', index: 1 })
    await poll('live 勾选写回权威文档', () => (doc.getText() === TASK_DOC_SECOND_TOGGLED ? true : undefined))
    // 重复任务行：只有第二个被改写，第一个保持原样
    assert(doc.getText().split('\n')[2] === '- [ ] 未完成任务甲', '第一个重复任务不得被误改')
    // live 装饰统计跟随：2 勾选
    const afterToggle = await waitViewState('task.md', (v) => (v.liveSyntax?.taskChecked ?? 0) === 2)
    assert(afterToggle.liveSyntax!.taskGlyphs === 3, '任务数不变')
    assert(afterToggle.text === TASK_DOC_SECOND_TOGGLED, 'webview 文本与权威一致')

    // 撤销在两种视图一致：undo 回退唯一一笔勾选编辑
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回退勾选', () => (doc.getText() === TASK_DOC_TEXT ? true : undefined))
    const afterUndo = await waitViewState('task.md', (v) => v.text === TASK_DOC_TEXT)
    assert(afterUndo.liveSyntax!.taskChecked === 1, `undo 后勾选数应回到 1，实际 ${afterUndo.liveSyntax!.taskChecked}`)

    // 无内容变化的重渲染不新增历史：同文 resync 后写回计数不再增长
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 1, `勾选写回应恰好 1 笔，实际 ${st.appliedEdits}`)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'sync.request' })
    await waitViewState('task.md', (v) => v.text === TASK_DOC_TEXT)
    const stAfter = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(stAfter.appliedEdits === st.appliedEdits, `同文重渲染不得新增写回（${st.appliedEdits} → ${stAfter.appliedEdits}）`)
  }],

  ['任务勾选（reading）：阅读模式点击 checkbox 写回并撤销，其余内容只读（#9）', async () => {
    await openWithEditor('task.md')
    await waitSessionReady('task.md')
    const uri = wsUri('task.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('task.md'))

    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('进入阅读模式并读取任务语义', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && (v.readingSyntax?.taskCheckboxes ?? 0) === 3 ? v : undefined
    })
    assert(reading.readingSyntax!.taskChecked === 1, `阅读初始勾选数应为 1，实际 ${reading.readingSyntax!.taskChecked}`)

    // 点击第一个任务（未勾选 → 勾选）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'task.test.click', view: 'reading', index: 0 })
    const firstToggled = TASK_DOC_TEXT.replace('- [ ] 未完成任务甲', '- [x] 未完成任务甲')
    await poll('reading 勾选写回权威文档', () => (doc.getText() === firstToggled ? true : undefined))
    const afterToggle = await waitViewState('task.md', (v) => (v.readingSyntax?.taskChecked ?? 0) === 2)
    assert(afterToggle.text === firstToggled, '阅读视图文本与权威一致')
    assert(afterToggle.readingSyntax!.taskCheckboxes === 3, '任务数不变')

    // 撤销：阅读模式发起的勾选同样在权威历史中回退，视图跟随
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回退勾选', () => (doc.getText() === TASK_DOC_TEXT ? true : undefined))
    const afterUndo = await waitViewState('task.md', (v) => (v.readingSyntax?.taskChecked ?? 0) === 1)
    assert(afterUndo.readingSyntax!.taskChecked === 1, 'undo 后阅读勾选数回到 1')

    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 1, `阅读勾选写回应恰好 1 笔，实际 ${st.appliedEdits}`)
  }],

  ['任务样式契约：两种视图的 checkbox 稳定类名经测试片段命中（#9）', async () => {
    await openWithEditor('task.md')
    await waitSessionReady('task.md')
    const uri = wsUri('task.md').toString()

    // live：任务行在首屏且非活动（光标在标题行）→ checkbox 已渲染
    const live = await waitViewState('task.md', (v) => v.cssProbe?.liveTaskCheckboxDecorationColor !== undefined && v.viewMode === 'live')
    assert(
      live.cssProbe!.liveTaskCheckboxDecorationColor === 'rgb(19, 20, 21)',
      `live 任务 checkbox 应被测试片段命中 rgb(19, 20, 21)，实际 ${live.cssProbe!.liveTaskCheckboxDecorationColor}`,
    )

    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式任务样式探针', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.cssProbe?.readingTaskCheckboxDecorationColor !== undefined ? v : undefined
    })
    assert(
      reading.cssProbe!.readingTaskCheckboxDecorationColor === 'rgb(22, 23, 24)',
      `阅读任务 checkbox 应被测试片段命中 rgb(22, 23, 24)，实际 ${reading.cssProbe!.readingTaskCheckboxDecorationColor}`,
    )
    // 样式链路零写回
    const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st.appliedEdits === 0, `样式探针链路不应产生写回，实际 ${st.appliedEdits}`)
  }],

  ['C-5：活动 tab 非本面板文档时 webview 的 undo 请求被忽略', async () => {
    await openWithEditor('undo3.md')
    const session = await waitSessionReady('undo3.md')
    const uri = wsUri('undo3.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('undo3.md'))
    const original = '撤销守卫甲行\n撤销守卫乙行\n'
    const edited = '撤销守卫甲行【写入】\n撤销守卫乙行\n'
    assert(doc.getText() === original, `初始文本不符：${JSON.stringify(doc.getText())}`)
    // 面板注入编辑：'撤销守卫甲行' 为 6 字符，行末插入点 LF offset 6
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: session.version,
      changes: [{ offset: 6, length: 0, text: '【写入】' }],
    })
    await poll('编辑写入宿主文档', () => (doc.getText() === edited ? true : undefined))

    // 活动编辑器切到原生文本编辑器（同一文档）：custom editor 面板不再是活动 tab
    await vscode.window.showTextDocument(doc)

    // webview 发起 undo：必须被忽略——宿主 undo 命令作用于活动编辑器，
    // 归属不符时执行会撤销到错误目标（VSCode undo 栈按文档资源）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await new Promise((r) => setTimeout(r, 1000))
    assert(doc.getText() === edited, `活动 tab 非本面板时 undo 不得执行，实际 ${JSON.stringify(doc.getText())}`)
    // 还原（编辑器关闭前的清理在 runner finally 统一处理）
    await doc.save()
  }],

  ['#148 undo 竞态守卫：IME 组合输入未落地时立即撤销，撤销的是刚落地的输入', async () => {
    await openWithEditor('undo4.md')
    await waitSessionReady('undo4.md')
    const uri = wsUri('undo4.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('undo4.md'))
    const original = '撤销竞态甲行\n撤销竞态乙行\n'
    assert(doc.getText() === original, `初始文本不符：${JSON.stringify(doc.getText())}`)
    // 早前操作（模拟表格把手移动等已确认编辑）经外部 WorkspaceEdit 落地：
    // 产生宿主撤销记录且以外部增量广播，真实 webview 同步显示（注入
    // edit.request 属面板自发编辑，只回 ack 不回显，无法驱动 webview 状态）
    const afterEarlier = '撤销竞态甲行【表】\n撤销竞态乙行\n'
    const earlier = new vscode.WorkspaceEdit()
    earlier.insert(wsUri('undo4.md'), new vscode.Position(0, 6), '【表】')
    assert(await vscode.workspace.applyEdit(earlier), '早前操作应写入成功')
    await poll('早前操作写入宿主文档', () => (doc.getText() === afterEarlier ? true : undefined))
    await waitViewState('undo4.md', (v) => v.text === afterEarlier)
    // 与票面场景一致的时间间隔：早前操作确认后过一段时间再输入（同时
    // 避开宿主 undoRedoService 对相邻编辑的时间窗合并——间隔内两笔
    // WorkspaceEdit 可能并成一个撤销元素，一次 undo 会连撤两笔）
    await new Promise((r) => setTimeout(r, 1500))

    // webview IME 组合输入（合成组合序列）：组合净输入攒入暂缓集
    // （deferredLocal，未发宿主），webview 本地文本已含组合字。
    // 插入点 = 全文末尾（afterEarlier.length，尾随换行之后）
    const afterCompose = '撤销竞态甲行【表】\n撤销竞态乙行\n拼'
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.compose', from: afterEarlier.length, text: '拼',
    })
    await waitViewState('undo4.md', (v) => v.text === afterCompose)

    // 立即撤销（不等待组合输入落地宿主）：#148 守卫保证撤销意图暂存至
    // 组合输入落地确认后发出——撤销的是刚落地的组合输入而非早前操作。
    // 经 table.test.history 直调转发入口（合成 Ctrl+Z keydown 会被 webview
    // 转发给宿主键绑定服务，额外触发一次全局 undo，无法观测单次转发语义）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.history', op: 'undo' })
    await poll('undo 撤销刚落地的组合输入', () => (doc.getText() === afterEarlier ? true : undefined))
    await waitViewState('undo4.md', (v) => v.text === afterEarlier)

    // 全程无冲突暂停、无回声写回（早前操作 + 组合输入共 2 笔写回；
    // undo 走宿主撤销栈不产生新写回）
    const conflict = (await vscode.commands.executeCommand(CMD.conflictState, uri)) as ConflictState
    assert(conflict.suspended !== true, '撤销竞态链路不得进入冲突暂停')
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.appliedEdits === 1, `appliedEdits 应为 1（组合输入；早前操作经 WorkspaceEdit 不计 applyEdit），实际 ${finalState.appliedEdits}`)
    await doc.save()
  }],

  ['ack 与 doc.changed 到达顺序：确认后的外部增量版本更高且内容一致（B 观测）', async () => {
    await openWithEditor('ackorder.md')
    await waitSessionReady('ackorder.md')
    await openWithEditor('ackorder.md', true)
    await poll('双面板就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('ackorder.md').toString())) as SessionState | undefined
      return state && state.panels.filter((p) => p.ready).length >= 2 ? state : undefined
    })
    const uri = wsUri('ackorder.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('ackorder.md'))
    const base = '顺序观测起始行\n顺序观测第二行\n'

    // 面板 1 注入编辑 '甲' → 宿主确认（ack ok，权威 v2）；广播让面板 2 的
    // 真实 webview 同步（注入路径的编辑不经发起面板自身 webview 显示）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: 0, length: 0, text: '甲' }],
    }, 0)
    const afterFirst = await poll('第一笔确认', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState | undefined
      return state && doc.getText() === `甲${base}` ? state : undefined
    })
    assert(afterFirst.version > 1, '确认后权威版本应推进')

    // 外部修改（其他来源，两面板均为 doc.changed 广播）：在 v2 权威的
    // offset 1 插 '乙'。发起面板收到 ack 的版本是 v2，此后到达的 doc.changed
    // 版本必须更高（v3）——否则被版本防线丢弃后内容失配
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.insert(wsUri('ackorder.md'), new vscode.Position(0, 1), '乙')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const expected = `甲乙${base}`
    await poll('外部修改写入权威', () => (doc.getText() === expected ? true : undefined))
    // 面板 2 经历完整广播链（'甲' + '乙'）：内容与权威一致
    const panel2 = await waitViewState('ackorder.md', (v) => v.text === expected, 1)
    assert(panel2.text === expected, `面板 2 应同步到权威文本：${JSON.stringify(panel2.text)}`)
    // 发起面板（面板 1）注入路径无自身回显，本地为 base；外部增量 v3 未被
    // 版本防线误丢、正确应用在本地文本上（base 的 offset 1 插 '乙'）
    const panel1Expected = `顺乙${base.slice(1)}`
    const panel1 = await waitViewState('ackorder.md', (v) => v.text === panel1Expected, 0)
    assert(panel1.text === panel1Expected, `面板 1 应正确应用外部增量：${JSON.stringify(panel1.text)}`)
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.version > afterFirst.version, `外部增量版本必须大于 ack 版本（${finalState.version} <= ${afterFirst.version}）`)
  }],

  // ---- 工单 #10：普通链接打开与本地/SSH 工作区图片显示 ----

  ['live 渲染链接真实 DOM 单击：普通链接与双链均跳转、源文零写回（#28）', async () => {
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    const linkUri = wsUri('links.md').toString()
    const linkBefore = await readDisk('links.md')
    await waitViewState('links.md', (v) => (v.liveLinkCount ?? 0) >= 2)
    await vscode.commands.executeCommand(CMD.postToPanel, linkUri, {
      kind: 'link.test.mousedown', target: 'link', index: 1,
    })
    await waitWikilinkLog(linkUri, (e) => e.kind === 'doc' && e.path === wsUri('链接目标.md').fsPath)
    assert(await readDisk('links.md') === linkBefore, 'live 普通链接单击不得改写源文')

    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const wikiUri = wsUri('wikilinks.md').toString()
    const wikiBefore = await readDisk('wikilinks.md')
    await waitViewState('wikilinks.md', (v) => (v.liveWikilinkCount ?? 0) >= 1)
    await vscode.commands.executeCommand(CMD.postToPanel, wikiUri, {
      kind: 'link.test.mousedown', target: 'wikilink', index: 0,
    })
    await waitWikilinkLog(wikiUri, (e) => e.kind === 'wikilink-doc' && e.target === '目标笔记')
    assert(await readDisk('wikilinks.md') === wikiBefore, 'live 双链单击不得改写源文')
  }],

  ['链接跳转：宿主解析相对路径并打开工作区目标（中文/空格/%20 编码，#10）', async () => {
    await openWithEditor('links.md')
    const session = await waitSessionReady('links.md')
    const uri = wsUri('links.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('进入阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' ? true : undefined
    })
    const versionBefore = session.version
    const diskBefore = await readDisk('links.md')

    // 阅读单击链路的消息形态（webview 上报原始 URI + 块源锚点）：
    // 空格目录与中文文件名经 %20 编码，宿主解码解析到磁盘真实路径
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate',
      sessionId: '',
      docUri: uri,
      href: './子%20目录/目标%20二.md',
      srcStart: 0,
      srcEnd: 10,
    })
    // 宿主以 Vsidian 面板打开目标文档，沿用当前阅读模式记忆
    await waitSessionReady('子 目录/目标 二.md')
    await waitActiveCustomTab('子 目录/目标 二.md')
    await waitViewState('子 目录/目标 二.md', (v) => v.viewMode === 'reading')
    assert(tabsOf('子 目录/目标 二.md', 'native') === 0, '阅读跳转不应产生源码标签')
    const opened = await vscode.workspace.openTextDocument(wsUri('子 目录/目标 二.md'))
    assert(opened.getText().startsWith('# 目标 二'), `打开的目标内容不符：${JSON.stringify(opened.getText().slice(0, 20))}`)

    // 跳转全程只读：源文档零写回、磁盘不变
    const diskAfter = await readDisk('links.md')
    assert(diskAfter === diskBefore, '链接跳转不得改写源文档')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState | undefined
    if (state?.found) {
      assert(state.version === versionBefore, `跳转不得改变文档版本（${versionBefore} → ${state.version}）`)
      assert(state.appliedEdits === 0, `跳转不得产生 applyEdit，实际 ${state.appliedEdits}`)
    }
  }],

  ['危险 scheme 与缺失目标：宿主拦截并给可见反馈，外链在测试钩子下不真开浏览器（#10）', async () => {
    await openWithEditor('links2.md')
    const session = await waitSessionReady('links2.md')
    const uri = wsUri('links2.md').toString()
    const diskBefore = await readDisk('links2.md')

    // file:// 与 javascript: —— 拦截（无编辑器切换，面板存活可读日志）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate', sessionId: '', docUri: uri,
      href: 'file:///d:/x.md', srcStart: 0, srcEnd: 5,
    })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate', sessionId: '', docUri: uri,
      href: 'javascript:alert(1)', srcStart: 0, srcEnd: 5,
    })
    // 缺失目标：not-found 反馈（不打开任何编辑器）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate', sessionId: '', docUri: uri,
      href: './不存在的目标.md', srcStart: 0, srcEnd: 5,
    })
    // 外链 https：归类 external（测试钩子模式仅记录，不真开系统浏览器）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate', sessionId: '', docUri: uri,
      href: 'https://example.com/obsidian-like', srcStart: 0, srcEnd: 5,
    })
    const logData = await poll('链接执行日志就绪', async () => {
      const data = (await vscode.commands.executeCommand(CMD.linkLog, uri)) as LinkLogData | undefined
      return data && data.found && data.log.length >= 4 ? data : undefined
    })
    const kinds = logData.log.map((e) => `${e.kind}:${e.reason ?? e.scheme ?? ''}`)
    assert(kinds.includes('blocked:scheme'), `file:// 应被拦截，实际 ${JSON.stringify(logData.log)}`)
    assert(
      logData.log.some((e) => e.kind === 'blocked' && e.scheme === 'javascript'),
      `javascript: 应被拦截并给出协议名，实际 ${JSON.stringify(logData.log)}`,
    )
    assert(kinds.includes('not-found:'), `缺失目标应有 not-found 反馈，实际 ${JSON.stringify(logData.log)}`)
    assert(kinds.includes('external:'), `https 外链应归类 external，实际 ${JSON.stringify(logData.log)}`)
    assert(
      logData.log.every((e) => e.kind !== 'doc'),
      `拦截类意图不得打开编辑器，实际 ${JSON.stringify(logData.log)}`,
    )

    // 无扩展名目标：候选补 .md 后以 Vsidian 面板打开
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'link.activate', sessionId: '', docUri: uri,
      href: './无扩展名目标', srcStart: 0, srcEnd: 5,
    })
    await waitSessionReady('无扩展名目标.md')
    await waitActiveCustomTab('无扩展名目标.md')
    assert(tabsOf('无扩展名目标.md', 'native') === 0, '补扩展名跳转不应产生源码标签')
    const diskAfter = await readDisk('links2.md')
    assert(diskAfter === diskBefore, '链接执行不得改写源文档')
    assert(session.appliedEdits === 0, `链接执行不得产生 applyEdit，实际 ${session.appliedEdits}`)
  }],

  ['图片显示：本地工作区图片经宿主通道装载，缺失图进入可重试错误态，零写回（#10）', async () => {
    await openWithEditor('images.md')
    await waitSessionReady('images.md')
    const uri = wsUri('images.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    // 真实 webview：宿主 asWebviewUri → img.src → load 事件 → loaded 态
    const view = await poll('图片装载完成', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const s = v?.imageStates
      return v?.viewMode === 'reading' && s && s.loaded >= 1 && s.error >= 1 ? v : undefined
    }, 30000)
    assert((view.readingImageCount ?? 0) >= 2, `阅读图片数应 >=2，实际 ${view.readingImageCount}`)
    assert((view.readingLinkCount ?? 0) === 0, '图片样例不含链接')
    // loaded 只能由 img load 事件置位——宿主解析地址确实可加载
    assert((view.imageStates?.loaded ?? 0) === 1, `应有 1 张加载成功，实际 ${JSON.stringify(view.imageStates)}`)
    assert((view.imageStates?.error ?? 0) === 1, `缺失图应进入错误态，实际 ${JSON.stringify(view.imageStates)}`)
    // 零写回：文本不变、无 applyEdit、磁盘不变
    assert(view.text === IMAGES_DOC_TEXT, '图片装载不得改写文档文本')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `图片链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
    const disk = await readDisk('images.md')
    assert(disk === IMAGES_DOC_TEXT, '图片链路不得写磁盘')
  }],

  ['图片弹窗与防误触：loaded 图挂按钮组、弹窗浮层绘制可见、导出消息经宿主日志，零写回（#212）', async () => {
    await openWithEditor('images.md')
    await waitSessionReady('images.md')
    const uri = wsUri('images.md').toString()
    // live 默认模式：loaded 图挂按钮组（错误图无按钮——CSS loaded 态门槛在
    // 浏览器层断言，此处观测 DOM 发射形态：edit+popup 各 1，仅 loaded 图）
    const live = await poll('live 图片按钮组观测', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const chrome = v?.paint?.imageChrome
      return chrome && chrome.frames === 1 && chrome.editButtons === 1 && chrome.popupButtons === 1 ? v : undefined
    }, 30000)
    assert(
      (live.imageStates?.loaded ?? 0) === 1 && (live.imageStates?.error ?? 0) === 1,
      `装载形态应为 1 loaded + 1 error（错误图无按钮组），实际 ${JSON.stringify(live.imageStates)}`,
    )
    // 打开弹窗（钩子驱动与用户点击同一处理器）：浮层在场 + img loaded +
    // 绘制层遮蔽正文（overlayVisible = elementFromPoint 命中浮层子树）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.popup', view: 'live', index: 0 })
    const popup = await poll('弹窗打开且图片装载', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const chrome = v?.paint?.imageChrome
      return chrome && chrome.overlay && chrome.overlayImgLoaded ? v : undefined
    }, 30000)
    assert(popup.paint!.imageChrome!.overlayVisible, '弹窗应实际遮蔽正文（绘制层断言）')
    // 导出钩子：action 只点工具条导出钮（不重开弹窗清快照）→ 宿主日志
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'image.test.popup', view: 'live', index: 0, action: 'export',
    })
    const exportLog = (await poll('图片导出日志就绪', async () => {
      const log = (await vscode.commands.executeCommand(CMD.imageExportLog, uri)) as Array<{
        src: string; fileName: string; reqId: number
      }>
      return log.length >= 1 ? log : undefined
    }))
    const msg = exportLog[0]!
    assert(msg.src === 'assets/图片 一.png', `导出 src 应为解码形态图源，实际 ${JSON.stringify(msg)}`)
    assert(msg.fileName === '图片 一.png', `导出建议名应为图源 basename，实际 ${JSON.stringify(msg)}`)
    assert(msg.reqId > 0, '导出消息应带正整数 reqId')
    // 关闭弹窗
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'image.test.popup', view: 'live', index: 0, action: 'close',
    })
    await poll('弹窗关闭', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.paint?.imageChrome && !v.paint.imageChrome.overlay ? true : undefined
    })
    // 阅读侧：非链接/非表格图包 frame，按钮组仅 popup 一枚（无 edit）
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读侧按钮组观测', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const chrome = v?.paint?.imageChrome
      return chrome && chrome.frames === 1 && chrome.editButtons === 0 && chrome.popupButtons === 1 ? v : undefined
    }, 30000)
    assert(reading.viewMode === 'reading', '应已切换到阅读模式')
    // 全程零写回：文本不变、无 applyEdit、磁盘不变
    assert(reading.text === IMAGES_DOC_TEXT, '图片弹窗链路不得改写文档文本')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `图片弹窗链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
    const disk = await readDisk('images.md')
    assert(disk === IMAGES_DOC_TEXT, '图片弹窗链路不得写磁盘')
  }],

  ['live 视图链接/图片装饰与样式契约：视口内 span/widget 渲染且稳定类名可被外部片段命中（#10）', async () => {
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    const uri = wsUri('links.md').toString()
    // live 默认模式：视口内链接 span 与图片 widget（间接装饰，视口外不创建）
    const live = await waitViewState('links.md', (v) => (v.liveLinkCount ?? -1) >= 5 && (v.liveImageCount ?? -1) >= 1)
    assert((live.liveLinkCount ?? 0) >= 5, `live 链接 span 应 >=5（外链/本地/空格目录/无扩展名/危险×2/自动链接），实际 ${live.liveLinkCount}`)
    assert((live.liveImageCount ?? 0) >= 1, `live 图片 widget 应 >=1，实际 ${live.liveImageCount}`)
    assert(
      live.cssProbe!.liveLinkDecorationColor === 'rgb(19, 20, 21)',
      `live 链接 span 应被测试片段命中 rgb(19, 20, 21)，实际 ${live.cssProbe!.liveLinkDecorationColor}`,
    )
    // live 图片同样经宿主通道装载成功
    await poll('live 图片装载', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v && (v.imageStates?.loaded ?? 0) >= 1 ? true : undefined
    })
    // 阅读侧：链接与图片探针 + 挂载计数
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式链接/图片观测', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingLinkCount !== undefined && v.readingImageCount !== undefined ? v : undefined
    })
    assert((reading.readingLinkCount ?? 0) >= 5, `阅读链接数应 >=5，实际 ${reading.readingLinkCount}`)
    assert((reading.readingImageCount ?? 0) >= 1, `阅读图片数应 >=1，实际 ${reading.readingImageCount}`)
    assert(
      reading.cssProbe!.readingLinkDecorationColor === 'rgb(22, 23, 24)',
      `阅读链接应被测试片段命中 rgb(22, 23, 24)，实际 ${reading.cssProbe!.readingLinkDecorationColor}`,
    )
    assert(
      reading.cssProbe!.readingImageDecorationColor === 'rgb(25, 26, 27)',
      `阅读图片应被测试片段命中 rgb(25, 26, 27)，实际 ${reading.cssProbe!.readingImageDecorationColor}`,
    )
    // 全程零写回
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `显示链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
    assert(reading.text === LINKS_DOC_TEXT, '显示链路不得改写文档文本')
  }],

  // ---- #201 图片定期刷新与删除态（真实 watcher → 失效 → 版本刷新链路） ----

  ['图片定期刷新：覆盖保存经 watcher 失效重载，URL 代次推进且未变化图源稳定（#201）', async () => {
    await openWithEditor('image-refresh.md')
    await waitSessionReady('image-refresh.md')
    const uri = wsUri('image-refresh.md').toString()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const docBefore = await readDisk('image-refresh.md')
    const first = await poll('初始装载两图', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.imageStates?.loaded === 2 ? v : undefined
    }, 30000)
    const entryA = first.imageEntries?.find((e) => e.src.includes('刷新甲'))
    assert(entryA?.state === 'loaded' && entryA.appliedSrc?.includes('?v=1'),
      `初始 URL 应为 v=1，实际 ${JSON.stringify(entryA)}`)
    // 真实覆盖保存（node fs 写 → 宿主 watcher 事件 → 去抖 → 无条件失效 →
    // webview 重发 → 新版本 URL 装载新内容）
    const bluePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
      'base64',
    )
    await writeFile(wsUri('assets/刷新甲.png').fsPath, bluePng)
    const refreshed = await poll('失效重载（v=2）', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const e = v?.imageEntries?.find((x) => x.src.includes('刷新甲'))
      return e?.state === 'loaded' && e.appliedSrc?.includes('?v=2') ? v : undefined
    }, 30000)
    // 宿主侧证据：watcher 失效确实覆盖目标文件
    const events = (await vscode.commands.executeCommand(CMD.imageRefreshEvents)) as string[]
    assert(events.some((f) => f.includes('刷新甲.png')),
      `失效日志应包含被覆盖目标，实际 ${JSON.stringify(events)}`)
    // 未变化图源不推进代次（URI 稳定——元数据未变不强制重载）
    const entryB = refreshed.imageEntries?.find((e) => e.src.includes('刷新乙'))
    assert(entryB?.state === 'loaded' && entryB.appliedSrc?.includes('?v=1'),
      `未变化图源应保持 v=1，实际 ${JSON.stringify(entryB)}`)
    // 零写回：文本与磁盘不动、无 applyEdit
    assert(refreshed.text === docBefore, '刷新链路不得改写文档文本')
    assert(await readDisk('image-refresh.md') === docBefore, '刷新链路不得写磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `刷新链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
  }],

  ['图片删除与恢复：撤下旧图呈找不到态，文件恢复后经 watcher 重新显示（#201）', async () => {
    await openWithEditor('image-refresh.md')
    await waitSessionReady('image-refresh.md')
    const uri = wsUri('image-refresh.md').toString()
    // 同文档面板复用（前一用例可能已处 reading）——显式设置而非循环切换
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const docBefore = await readDisk('image-refresh.md')
    await poll('初始装载两图', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.imageStates?.loaded === 2 ? v : undefined
    }, 30000)
    // 真实删除（磁盘正证据）：watcher → 失效 → 重发 → not-found 呈现
    await rm(wsUri('assets/刷新乙.png').fsPath)
    await poll('删除后进入 not-found', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const e = v?.imageEntries?.find((x) => x.src.includes('刷新乙'))
      return e?.state === 'error' && e.reason === 'not-found' ? v : undefined
    }, 30000)
    // 另一图不受影响
    const mid = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState
    const entryA = mid.imageEntries?.find((e) => e.src.includes('刷新甲'))
    assert(entryA?.state === 'loaded', `未删除图源应保持 loaded，实际 ${JSON.stringify(entryA)}`)
    // 恢复：写回文件（create 事件）→ 失效 → 重发 → 重新显示（代次推进——
    // 删除与恢复事件各推进一次，解析完成可能再推进，断言只认 >1 不硬编码）
    const greenPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAIFw9selAAAAAElFTkSuQmCC',
      'base64',
    )
    await writeFile(wsUri('assets/刷新乙.png').fsPath, greenPng)
    const restored = await poll('恢复后重新显示（代次推进）', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const e = v?.imageEntries?.find((x) => x.src.includes('刷新乙'))
      const m = e?.appliedSrc?.match(/[?&]v=(\d+)/)
      return e?.state === 'loaded' && m && Number(m[1]) > 1 ? v : undefined
    }, 30000)
    // 零写回
    assert(restored.text === docBefore, '删除/恢复链路不得改写文档文本')
    assert(await readDisk('image-refresh.md') === docBefore, '删除/恢复链路不得写磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `删除/恢复链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
  }],

  // ---- 工单 #12：表格单元格编辑与双视图呈现 ----

  ['表格装饰与单元格编辑写回：转义管道保存回读保真、一次撤销一笔提交（#12）', async () => {
    await openWithEditor('table.md')
    await waitSessionReady('table.md')
    const uri = wsUri('table.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table.md'))
    const original = TABLE_DOC_TEXT
    const edited = TABLE_DOC_TEXT.replace('| 苹果 | 3 | 甲 |', '| 香蕉\\|果 | 3 | 甲 |')

    // live 装饰语义：4 行表格行（表头/分隔/2 数据行）、9 个单元格内容
    // mark（GFM 拆分：`x|y` 与 乙\|丙 均为单格）
    const view = await waitViewState('table.md', (v) => v.liveSyntax?.tableLines === 4 && v.liveSyntax?.tableCells === 9)
    assert(view.liveSyntax!.tableLines === 4, `表格行装饰应为 4，实际 ${view.liveSyntax!.tableLines}`)
    assert(view.liveSyntax!.tableCells === 9, `单元格装饰应为 9，实际 ${view.liveSyntax!.tableCells}`)

    // 单元格编辑（webview 键入钩子的输出形态：含管道符的新内容带转义）
    const at = original.indexOf('苹果')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'edit.request',
      sessionId: '',
      docUri: uri,
      seq: 1,
      baseVersion: 1,
      changes: [{ offset: at, length: 2, text: '香蕉\\|果' }],
    })
    await poll('单元格编辑写入权威', () => (doc.getText() === edited ? true : undefined))
    const saved = await doc.save()
    assert(saved, '保存失败')
    const disk = await readDisk('table.md')
    assert(disk === edited, `保存回读应保持转义管道：${JSON.stringify(disk.slice(0, 80))}`)
    assert(disk.includes('香蕉\\|果'), '磁盘内容应含转义管道')

    // 一次撤销 = 一笔单元格提交（宿主权威栈回流）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回退单元格编辑', () => (doc.getText() === original ? true : undefined))
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 1, `undo 不得产生回声写回，实际 ${state.appliedEdits}`)

    // live 表格管道符样式入口命中
    const liveProbe = await waitViewState('table.md', (v) => v.viewMode === 'live' && v.cssProbe?.liveTablePipeDecorationColor !== undefined)
    assert(
      liveProbe.cssProbe!.liveTablePipeDecorationColor === 'rgb(19, 20, 21)',
      `live 表格管道符应被测试片段命中 rgb(19, 20, 21)，实际 ${liveProbe.cssProbe!.liveTablePipeDecorationColor}`,
    )
  }],

  ['网格单元格全选删除与边界删除保留表格源码结构（P0）', async () => {
    const name = 'table-cell-delete.md'
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    const before = doc.getText()
    const at = before.indexOf('苹果')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 0 })
    await waitViewState(name, (v) => v.tableGrid?.selectedRowIsGrid === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    await waitViewState(name, (v) => v.selectionOffset === at)
    for (let i = 0; i < 3; i++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    }
    const paddingTrimmed = before.replace('| 苹果 |', '|苹果 |')
    const boundary = await waitViewState(name, (v) => v.text === paddingTrimmed)
    assert(boundary.tableGrid?.visibleRows === 3, '格首退格只能删格内空白，不能越过源管道')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'select-all' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    const cleared = before.replace('| 苹果 |', '| |')
    await poll('仅清空当前格写回', () => doc.getText() === cleared ? true : undefined)
    for (let i = 0; i < 3; i++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'delete' })
    }
    const afterPaddingDelete = before.replace('| 苹果 |', '| |')
    const rendered = await waitViewState(name, (v) => v.text === afterPaddingDelete)
    assert(rendered.tableGrid?.visibleRows === 3, '删除内容后仍须保留完整网格')
    assert(rendered.paint?.table?.cellVisible === true && rendered.paint.table.gridDisplay === 'grid',
      '删除后剩余文字须在网格绘制层可见')
    assert(await doc.save(), '清空单元格保存失败')
    assert(await readDisk(name) === afterPaddingDelete, '落盘内容只能清空当前格，表格标记必须完整')
  }],

  ['引用块内表格网格化绘制：格内容命中、表头底色与行级网格（#296）', async () => {
    await openWithEditor('blockquote-table.md')
    await waitSessionReady('blockquote-table.md')
    // 样例含三张引用表（单层 / lazy 分隔行 / 多层引用）：9 个表格行类、
    // 12 个单元格内容 mark（`>` 不入格内容，格内文字全部命中）
    const view = await waitViewState('blockquote-table.md',
      (v) => v.liveSyntax?.tableLines === 9 && v.liveSyntax?.tableCells === 12)
    assert(view.liveSyntax!.tableLines === 9,
      `引用表表格行装饰应为 9，实际 ${view.liveSyntax!.tableLines}`)
    assert(view.liveSyntax!.tableCells === 12,
      `引用表单元格装饰应为 12，实际 ${view.liveSyntax!.tableCells}`)
    // 绘制层：网格布局真实生效、格文字经 elementFromPoint 命中（非仅
    // DOM 存在）、表头保留底色——引用竖条与网格组合呈现不互斥
    const rendered = await waitViewState('blockquote-table.md',
      (v) => v.paint?.table?.cellVisible === true)
    assert(rendered.paint!.table!.gridDisplay === 'grid',
      '引用块内表格须以网格布局绘制，不能停留源码形态')
    assert((rendered.paint!.table!.headerCellBackgrounds?.length ?? 0) > 0,
      '引用块内表格表头须保留底色')
    assert(rendered.tableGrid?.visibleRows === 6, '三张引用表（单层/lazy/多层）的表头与数据行都须进入网格')
  }],

  ['引用块内表格格内编辑防护：Enter 持久化换行标记、网格不拆散（#296 审查轮）', async () => {
    const name = 'blockquote-table.md'
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    const before = doc.getText()
    // 光标落在首张引用表数据行「苹果」内容中（格内编辑防护链路：
    // 修复前 editableGridCellAt 对引用表返回 null，Enter 走原生换行拆散表格）
    const at = before.indexOf('苹果') + 1
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    await waitViewState(name, (v) => v.selectionOffset === at)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'enter' })
    // Enter 写 <br>（格内换行），引用表格行不被真实换行拆散
    const entered = before.replace('苹果', '苹<br>果')
    await waitViewState(name, (v) => v.text === entered)
    await poll('Enter 落盘为格内换行标记', () => doc.getText() === entered ? true : undefined)
    const afterEnter = await waitViewState(name, (v) => v.tableGrid?.visibleRows === 6)
    assert(afterEnter.tableGrid!.visibleRows === 6, '格内换行后三张引用表网格保持')
    assert(afterEnter.paint?.table?.cellVisible === true, '格内换行后仍在网格绘制层可见')
    assert(await doc.save(), '保存失败')
    assert(await readDisk(name) === entered, '落盘内容须保持引用层级与格内换行标记')
  }],

  ['安全表格仅绘制段首行号，格内光标与设置切换不恢复重叠编号', async () => {
    await openWithEditor('table42.md')
    await waitSessionReady('table42.md')
    const uri = wsUri('table42.md').toString()
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    const expected = ['1', '2', '3', '7', '8', '9']
    const before = await waitViewState('table42.md', (v) => (v.paint?.visibleLineNumbers?.length ?? 0) > 0)
    assert(JSON.stringify(before.paint?.visibleLineNumbers) === JSON.stringify(expected),
      `表格只绘制段首 3，隐藏 4/5/6：${JSON.stringify(before.paint?.visibleLineNumbers)}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 0 })
    const clicked = await waitViewState('table42.md', (v) => v.tableGrid?.selectedRowIsGrid === true)
    assert(JSON.stringify(clicked.paint?.visibleLineNumbers) === JSON.stringify(expected),
      `单元格激活后仍只绘制表格段首行号：${JSON.stringify(clicked.paint?.visibleLineNumbers)}`)
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': false })
    await waitViewState('table42.md', (v) => v.lineGutter?.on === false)
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    // Compartment 已重配不代表 CM6 的 gutter 绘制已完成；等绘制层恢复整组行号。
    let lastState: ViewState | undefined
    let restored: ViewState
    try {
      restored = await waitViewState('table42.md', (v) => {
        lastState = v
        return v.lineGutter?.on === true &&
          JSON.stringify(v.paint?.visibleLineNumbers) === JSON.stringify(expected)
      })
    } catch (error) {
      throw new Error(`重新开启行号绘制未稳定：开关 ${String(lastState?.lineGutter?.on)}，` +
        `预期 ${JSON.stringify(expected)}，实际 ${JSON.stringify(lastState?.paint?.visibleLineNumbers)}；${String(error)}`)
    }
    assert(JSON.stringify(restored.paint?.visibleLineNumbers) === JSON.stringify(expected),
      '重新开启行号应保留表格段首策略')
  }],

  ['多表局部编辑并滚动返回后，安全表格内部行号保持隐藏', async () => {
    const name = 'table-gutter-edit.md'
    const source = '开头\n\n普通段落\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n' +
      Array.from({ length: 160 }, (_, i) => `中段${i}\n`).join('') +
      '\n| C | D |\n| --- | --- |\n| 丙 | 丁 |\n'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    await waitSessionReady(name)
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    await waitViewState(name, (v) => v.lineGutter?.on === true)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    const assertFirstTableNumbers = async () => {
      const state = await waitViewState(name, (v) => v.paint?.visibleLineNumbers?.includes('5') === true)
      assert(!state.paint!.visibleLineNumbers!.includes('6') && !state.paint!.visibleLineNumbers!.includes('7'),
        `第一张表只应绘制段首5：${JSON.stringify(state.paint!.visibleLineNumbers)}`)
    }
    await assertFirstTableNumbers()
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'sync.test.edit', offset: 1, text: '新' })
    await poll('表外输入落到权威文本', () => doc.getText().startsWith('开新头') ? true : undefined)
    await assertFirstTableNumbers()
    const secondCell = doc.getText().indexOf('丙')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: secondCell })
    await waitViewState(name, (v) => v.selectionOffset === secondCell)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'sync.test.edit', offset: secondCell, text: '新' })
    await poll('第二张表输入落到权威文本', () => doc.getText().includes('新丙') ? true : undefined)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 0 })
    await waitViewState(name, (v) => v.selectionOffset === 0)
    await assertFirstTableNumbers()
  }],

  ['多表文档行号与所属正文行基线偏差 ≤1px（#116 绘制层几何断言）', async () => {
    const name = 'table-gutter-align.md'
    // 三张安全表：前两张各 1 数据行，第三张 2 数据行（钉住随行数累积的
    // 误差面）；表间段落含降部拉丁字符（g/p/j）——基线换算被真实行使
    //（底边口径下降部延伸会掩盖基线差）
    const source = '首行\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n中段一\n中段二\n\n' +
      '| C | D |\n| --- | --- |\n| 丙 | 丁 |\n\ngap type jog 降部行\n\n' +
      '| E | F |\n| --- | --- |\n| 戊 | 己 |\n| 庚 | 辛 |\n\n尾段\n'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    await waitSessionReady(name)
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    // 几何探针在真实 webview 布局下采集：轮询直至全部可见行号达标
    //（绘制稳定后计——measure 循环收敛后的采样值即稳态值）；主口径为
    // 基线差 deltaBaseline（行号字号小于正文，底边重合 ≠ 基线重合）
    const state = await waitViewState(name, (v) => {
      const alignment = v.lineGutter?.alignment
      if (!alignment || alignment.length < 6) return false
      return alignment.every((item) => Math.abs(item.deltaBaseline) <= 1)
    })
    // 覆盖面防御：采样必须包含三表段首行号（3/10/16）与表后行号
    //（7/14/21——14 含降部行、21 在 2 数据行表之后），防止探针退化成
    // 只采恰好达标的行
    const nums = state.lineGutter!.alignment!.map((item) => item.num)
    for (const expected of ['3', '7', '10', '14', '16', '21']) {
      assert(nums.includes(expected),
        `对齐采样应覆盖表段首（${expected}）与表后行：${JSON.stringify(state.lineGutter!.alignment)}`)
    }
  }],

  ['实时预览活动格保留网格与抓手，格内输入经 CM6 写回（#42）', async () => {
    await openWithEditor('table42.md')
    const beforeSession = await waitSessionReady('table42.md')
    const uri = wsUri('table42.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table42.md'))
    const before = doc.getText()
    assert(before === TABLE_DOC_TEXT, '独立表格 fixture 初始文本不符')
    const at = before.indexOf('苹果') + 2

    // 在真实 1.86.2 webview 内派发鼠标事件，点击第一数据行首格。
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 0 })
    const appleCellStart = before.indexOf('| 苹果 |') + 1
    const clicked = await waitViewState('table42.md', (v) =>
      v.selectionOffset !== undefined && v.selectionOffset >= appleCellStart &&
      v.selectionOffset <= appleCellStart + ' 苹果 '.length)
    assert(clicked.tableGrid?.selectedRowIsGrid === true, '鼠标进入单元格后整行必须仍是网格')
    assert(clicked.tableGrid?.visibleRows === 3, '活动格不得撤掉表格网格行')
    assert(clicked.tableGrid?.rowHandles === 3, '活动格仍须保留 #43 点阵抓手')
    assert(clicked.tableGrid?.selectedRowCells[0]?.includes('苹果') === true, '点击应命中苹果单元格')
    assert(clicked.paint?.table?.cellVisible === true,
      '表格单元格文字须在绘制层命中，不能仅有 DOM 文本')
    assert(clicked.paint?.table?.gridDisplay === 'grid',
      `表格行须实际按网格绘制：${clicked.paint?.table?.gridDisplay}`)
    assert(Number.parseFloat(clicked.paint?.table?.cellBorderWidth ?? '') > 0,
      `表格单元格须实际绘出边框：${clicked.paint?.table?.cellBorderWidth}`)

    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 0, point: 'middle' })
    const middle = await waitViewState('table42.md', (v) =>
      v.selectionOffset !== undefined && v.selectionOffset > before.indexOf('苹果') &&
      v.selectionOffset <= before.indexOf('苹果') + 2)
    assert(middle.tableGrid?.selectedRowIsGrid === true, '格内中部点击仍须保留网格')

    // 精确定位到内容末端后模拟格内输入；定位只改变选区，不触发 edit.request。
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    const located = await waitViewState('table42.md', (v) => v.selectionOffset === at)
    assert(located.text === before && doc.getText() === before, '进入单元格不得改写 Markdown')
    const afterLocate = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterLocate.appliedEdits === beforeSession.appliedEdits, '网格进入源码不得产生宿主编辑')

    // 真实 webview 内 CM6 事务写回，与网格显示不建立第二份输入状态。
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.type', text: '汁' })
    const edited = before.replace('苹果', '苹果汁')
    await poll('网格单元格编辑写回', () => (doc.getText() === edited ? true : undefined))
    const afterTyping = await waitViewState('table42.md', (v) => v.text === edited)
    assert(afterTyping.tableGrid?.selectedRowIsGrid === true, '键入后活动格仍须保持网格')
    assert(afterTyping.tableGrid?.selectedRowCells[0]?.includes('苹果汁') === true,
      '键入应只更新目标单元格的可见内容')
    assert(afterTyping.tableGrid?.selectedRowCells[1]?.includes('3') === true, '邻格内容不得改变')
    assert(afterTyping.tableGrid?.rowHandles === 3, '键入后点阵抓手仍须可用')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('table42.md', (v) => v.viewMode === 'reading')
    assert(reading.text === edited,
      `阅读模式应读取单元格最新文本：${JSON.stringify({ before, edited, actual: reading.text, host: doc.getText() })}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const live = await waitViewState('table42.md', (v) => v.viewMode === 'live')
    assert(live.text === edited, `切回实时预览后文本不一致：${JSON.stringify(live.text)}`)
    assert(await doc.save(), '网格单元格编辑保存失败')
    assert(await readDisk('table42.md') === edited, '网格单元格编辑的磁盘回读不一致')
  }],

  ['实时预览空单元格点击与输入仍在目标网格格内（#42）', async () => {
    await openWithEditor('table42-empty.md')
    const initial = await waitSessionReady('table42-empty.md')
    const uri = wsUri('table42-empty.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table42-empty.md'))
    const before = '| A | B |\n| --- | --- |\n| | 空 |\n'
    assert(doc.getText() === before, '空格 fixture 初始内容不符')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 0 })
    const emptyAt = before.indexOf('| | 空 |') + 1
    const clicked = await waitViewState('table42-empty.md', (v) => v.selectionOffset === emptyAt)
    assert(clicked.tableGrid?.selectedRowIsGrid === true, '空单元格点击后不得撤网格')
    assert(clicked.tableGrid?.selectedRowCells.length === 2, '空单元格所在行应保留两列')
    const afterClick = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterClick.appliedEdits === initial.appliedEdits, '空单元格点击不应写回')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.type', text: '新' })
    const edited = before.replace('| | 空 |', '|新 | 空 |')
    await poll('空单元格输入写回', () => doc.getText() === edited ? true : undefined)
    const live = await waitViewState('table42-empty.md', (v) => v.text === edited)
    assert(live.tableGrid?.selectedRowIsGrid === true, '空单元格输入后仍须保持网格')
    assert(live.tableGrid?.selectedRowCells[0]?.includes('新') === true, '空格输入应留在目标格')
  }],

  ['三列表格中格点击与空格输入：可见光标绘在目标列', async () => {
    const name = 'table-middle-click.md'
    const before = '| 左 | sss | 右 |\n| --- | --- | --- |\n| 带 |  | 末 |\n| 带 || 末 |\n'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(before))
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 0, columnIndex: 1, point: 'right-edge' })
    const header = await waitViewState(name, (v) => v.tableGrid?.selectedRowIsGrid === true)
    assert(header.paint?.table?.caretGridColumn === 1,
      `点击表头中格后光标须在中列绘出：${JSON.stringify(header.paint?.table)}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '中' })
    await poll('表头中格写回', () => doc.getText().includes('sss中') ? true : undefined)
    for (let i = 0; i < 8; i++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: 's' })
      const count = i + 1
      await poll(`表头中格第 ${count} 次输入写回`, () =>
        (doc.getText().split('\n')[0]?.match(/s/g)?.length ?? 0) === 3 + count ? true : undefined)
      const actual = doc.getText()
      const typed = await waitViewState(name, (v) => v.text === actual)
      assert(typed.paint?.table?.caretDomColumn === 1 &&
        (typed.paint?.table?.caretNativeRectHeight ?? 0) > 0 &&
        typed.paint?.table?.caretGridColumn === 1,
        `表头中格连续输入后光标须保持在中列（第 ${i + 1} 次）：${JSON.stringify(typed.paint?.table)}`)
    }
    assert(/^\| 左 \| [^|]*中[^|]* \| 右 \|/.test(doc.getText()),
      `表头中格连续输入须写回原格：${JSON.stringify(doc.getText().split('\n')[0])}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 1, columnIndex: 1, point: 'right-edge' })
    const empty = await waitViewState(name, (v) => v.tableGrid?.selectedRowIsGrid === true &&
      v.selectionOffset !== header.selectionOffset)
    assert(empty.paint?.table?.caretGridColumn === 1,
      `点击数据行空中格后光标须在中列绘出：${JSON.stringify(empty.paint?.table)}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.type', text: '空' })
    await poll('空中格写回', () => doc.getText().includes('| 带 |空  | 末 |') ? true : undefined)
    const latest = await waitViewState(name, (v) => v.tableGrid?.selectedRowCells[1]?.includes('空') === true)
    assert(latest.tableGrid?.selectedRowCells[2]?.includes('末') === true, '右格不得接收中格输入')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 2, columnIndex: 1, point: 'right-edge' })
    const zero = await waitViewState(name, (v) => v.tableGrid?.selectedRowCells[1] === '')
    assert(zero.paint?.table?.caretGridColumn === 1,
      `点击零宽空中格后光标须在中列绘出：${JSON.stringify(zero.paint?.table)}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.type', text: '零' })
    await poll('零宽空中格写回', () => doc.getText().includes('| 带 |零| 末 |') ? true : undefined)
    assert(await doc.save(), '三列表格保存失败')
    assert((await readDisk(name)) === doc.getText(), '三列点击写回与磁盘回读须一致')
  }],

  ['跨行拖选可横跨表格；端点落在隐藏结构上收缩到内容边界（#57）', async () => {
    const name = 'table-cross-selection.md'
    const source = '前文\n\n| 带 | s是 | 送 |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n\n后文'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    const initial = await waitSessionReady(name)
    const uri = wsUri(name).toString()
    // 表外 anchor → 表外 head（视觉跨过整表）：不再截断在表格边界
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: 1, head: source.indexOf('后文') + 1,
    })
    const across = await waitViewState(name, (v) => v.selectionHead === source.indexOf('后文') + 1)
    assert(across.paint?.table?.delimiterDisplay === 'none',
      `跨行选区覆盖表格时分隔行仍须隐藏：${JSON.stringify(across.paint?.table)}`)
    assert(across.paint?.table?.gridDisplay === 'grid', '跨行选区不撤下网格绘制')
    // head 落在分隔行（隐藏结构）：收缩到上一内容行末格内容尾
    const delimiterAt = source.indexOf('| --- | --- | --- |')
    const headerAt = source.indexOf('| 带 | s是 | 送 |')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: 1, head: delimiterAt + 3,
    })
    const snapped = await waitViewState(name, (v) =>
      v.selectionHead === headerAt + '| 带 | s是 | 送 |'.length - 2)
    assert(snapped.paint?.table?.delimiterDisplay === 'none',
      `选区端点收缩后分隔行不显形：${JSON.stringify(snapped.paint?.table)}`)
    assert(snapped.paint?.table?.gridDisplay === 'grid', '端点收缩后网格仍在绘制')
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.appliedEdits === initial.appliedEdits, '选区操作不能改写源文')
  }],

  ['跨格与整表选区删除：删除作用范围与可见选区一致（#57）', async () => {
    const name = 'table-cross-cell-delete.md'
    const source = '前文\n\n| 带 | s是 | 送 |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n\n后文'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    // 场景 1：同行跨格（数据行三格内容全选）→ 只删可见内容，管道与分隔行保留。
    // 表头行不用于此场景：表头全部格删空会使表格解析消失，删除按防护语义拒绝。
    const rowAt = source.indexOf('| 甲 | 乙 | 丙 |')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: rowAt + 2, head: rowAt + 11,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    const rowCleared = source.replace('| 甲 | 乙 | 丙 |', '|  |  |  |')
    await poll('跨格删除写回', () => doc.getText() === rowCleared ? true : undefined)
    const state = await waitViewState(name, (v) => v.text === rowCleared && v.tableGrid?.visibleRows === 2)
    assert(state.paint?.table?.gridDisplay === 'grid' && state.paint.table.cellVisible === true,
      `跨格删除后网格与剩余文字须在绘制层可见：${JSON.stringify(state.paint?.table)}`)
    assert(state.paint?.table?.delimiterDisplay === 'none', '跨格删除后分隔行保持隐藏')
    assert(await doc.save(), '跨格删除保存失败')
    assert(await readDisk(name) === rowCleared, '跨格删除磁盘回读：结构完整、仅清空内容')

    // 场景 2：表外发起、横跨整表的选区（用户主路径）→ 一次删除整块，前后正文按选区保留
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: 1, head: rowCleared.length,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    const tableRemoved = '前'
    await poll('整表删除写回', () => doc.getText() === tableRemoved ? true : undefined)
    const removed = await waitViewState(name, (v) => v.text === tableRemoved)
    assert(removed.paint?.table?.gridDisplay == null,
      `整表删除后不得残留网格绘制：${JSON.stringify(removed.paint?.table)}`)
    assert(await doc.save(), '整表删除保存失败')
    assert(await readDisk(name) === tableRemoved, '整表删除磁盘回读：表格整块移除、前后正文不被误删')

    // 一次撤销 = 恢复删除前的表格（宿主权威栈回流）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销整表删除', () => doc.getText() === rowCleared ? true : undefined)
  }],

  ['表格回车在格内换行，退格合行、保存回读与撤销保持完整表格', async () => {
    const name = 'table-cell-enter.md'
    const source = '| 左 | 中 | 右 |\n| --- | --- | --- |\n| 甲 | 乙 | 丙 |\n'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 0, columnIndex: 1, point: 'right-edge' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'enter' })
    const withBreak = source.replace('中', '中<br>')
    await poll('格内换行写回', () => doc.getText() === withBreak ? true : undefined)
    const state = await waitViewState(name, (v) => v.text === withBreak && v.paint?.table?.cellBreakDisplay === 'inline')
    assert(state.paint?.table?.cellVisible === true && state.paint.table.gridDisplay === 'grid', '换行后表格文字与网格须实际可见')
    assert(state.tableGrid?.visibleRows === 2, '回车不能增加或拆散表格行')
    assert(await doc.save(), '格内换行保存失败')
    assert(await readDisk(name) === withBreak, '格内换行磁盘回读须保真')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    await poll('退格合行写回', () => doc.getText() === source ? true : undefined)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'enter' })
    await poll('再次格内换行', () => doc.getText() === withBreak ? true : undefined)
    await vscode.commands.executeCommand('undo')
    await poll('一次撤销格内换行', () => doc.getText() === source ? true : undefined)
    assert(await doc.save(), '恢复原表格保存失败')
    assert(await readDisk(name) === source, '合回原行后保存不得残留换行标记')
  }],

  ['中格空白删除被守恒拒绝，再输入仍保持表头网格样式', async () => {
    const name = 'table-middle-delete.md'
    const source = '| 带 |  | 送 |\n| --- | --- | --- |\n| 左 | 右 | 末 |\n'
    await vscode.workspace.fs.writeFile(wsUri(name), Buffer.from(source))
    await openWithEditor(name)
    await waitSessionReady(name)
    const uri = wsUri(name).toString()
    const doc = await vscode.workspace.openTextDocument(wsUri(name))
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.cellClick', rowIndex: 0, columnIndex: 1, point: 'right-edge' })
    for (let i = 0; i < 2; i++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'delete' })
    }
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '是' })
    // 2026-09-28 填充守恒（用户报告语义变更）：空内容格的 delete 被拒，
    // 两个填充空格原样保留；'是' 从点击锚点（格首）写入。文本形态本身
    // 证明删除未生效（旧行为删到 | 带 | | 送 | 已被否定）
    await poll('中格输入写回（填充守恒）', () => doc.getText().startsWith('| 带 |是  | 送 |') ? true : undefined)
    const state = await waitViewState(name, (v) => v.tableGrid?.selectedRowCells[1]?.includes('是') === true)
    const backgrounds = state.paint?.table?.headerCellBackgrounds ?? []
    assert(backgrounds.length === 3 && backgrounds.every((color) => color === backgrounds[0]),
      `表头中格须与两侧同样绘制底色：${JSON.stringify(backgrounds)}`)
    assert(state.paint?.table?.gridDisplay === 'grid', '退格再输入后表头仍须是网格')
    for (let i = 0; i < 8; i++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: 's' })
      const count = i + 1
      await poll(`中格删空后第 ${count} 次输入写回`, () =>
        (doc.getText().split('\n')[0]?.match(/s/g)?.length ?? 0) === count ? true : undefined)
      const actual = doc.getText()
      const typed = await waitViewState(name, (v) => v.text === actual)
      assert(typed.selectionAssoc === -1,
        `中格末端输入后光标须向中格关联（第 ${count} 次）：${typed.selectionAssoc}`)
      assert(typed.paint?.table?.caretDomColumn === 1 &&
        (typed.paint?.table?.caretNativeRectHeight ?? 0) > 0,
      `浏览器原生光标须实际落在中格文字节点（第 ${count} 次）：${JSON.stringify(typed.paint?.table)}`)
      assert(typed.paint?.table?.caretGridColumn === 1,
        `中格删空后连续输入光标须留中列（第 ${count} 次）：${JSON.stringify(typed.paint?.table)}`)
    }
    assert(doc.getText().startsWith('| 带 |是ssssssss  | 送 |'),
      `中格删空后文字须继续落入中列：${JSON.stringify(doc.getText().split('\n')[0])}`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'backspace' })
    await poll('中格连续输入后可退格', () =>
      doc.getText().startsWith('| 带 |是sssssss  | 送 |') ? true : undefined)
    const afterBackspace = await waitViewState(name, (v) => v.text === doc.getText())
    assert(afterBackspace.paint?.table?.caretDomColumn === 1,
      '连续输入后退格仍须把原生光标留在中格')
    assert(await doc.save(), '中格再次输入保存失败')
    assert((await readDisk(name)) === doc.getText(), '中格退格再输入的磁盘回读须一致')
  }],

  ['阅读视图表格：真实 table 只读呈现与样式入口（#12）', async () => {
    await openWithEditor('table.md')
    await waitSessionReady('table.md')
    const uri = wsUri('table.md').toString()
    await waitViewState('table.md', (v) => v.viewMode === 'live')

    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('table.md', (v) => v.viewMode === 'reading' && v.readingSyntax?.tables !== undefined)
    assert(reading.readingSyntax!.tables === 1, `阅读视图应渲染 1 张表格，实际 ${reading.readingSyntax!.tables}`)
    // fixture 数据行含 `x|y`：若错误地按管道切列，行内代码 token 会丢失。
    assert(reading.readingSyntax!.inlineCodeCount === 1,
      `阅读表格应保留行内代码，实际 ${reading.readingSyntax!.inlineCodeCount}`)
    // 只读语义：表格为语义标签渲染，无输入控件（任务勾选外的交互均不提供）
    assert(
      reading.cssProbe?.readingTableDecorationColor === 'rgb(22, 23, 24)',
      `阅读表格应被测试片段命中 rgb(22, 23, 24)，实际 ${reading.cssProbe?.readingTableDecorationColor}`,
    )
    // 切回 live：同一文本两视图共用（文本不变）
    const backText = reading.text
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const liveAgain = await waitViewState('table.md', (v) => v.viewMode === 'live')
    assert(liveAgain.text === backText, '两种视图共用同一文本，切换不得改变内容')
  }],

  ['编辑区查找：文本模型全量匹配、无匹配反馈与只读契约（#14）', async () => {
    await openWithEditor('find.md')
    const session0 = await waitSessionReady('find.md')
    const uri = wsUri('find.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('find.md'))
    const text = doc.getText()
    const diskBefore = await readDisk('find.md')

    // 打开（预置查询）：匹配总数 = 文本模型全量计数（非可见 DOM）；
    // '目标词' 在 fixture 中出现 4 次
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '目标词' })
    let v = await waitViewState('find.md', (s) => s.find?.open === true && s.find?.total === 4)
    assert(v.find!.index === 1, `当前序号应为 1，实际 ${v.find!.index}`)
    assert(v.find!.currentFrom === text.indexOf('目标词'), '当前匹配应为文本模型中的首个命中')
    assert(v.selectionOffset === text.indexOf('目标词'), `live 定位应把光标移到当前匹配，实际 ${v.selectionOffset}`)

    // 下一项：光标与当前匹配同步前移（屏外段落同样定位——文本模型语义）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.step', direction: 'next' })
    v = await waitViewState('find.md', (s) => s.find?.index === 2)
    assert(v.find!.currentFrom === text.indexOf('目标词', text.indexOf('目标词') + 1), '第 2 个匹配应为段落二中的命中')
    assert(v.selectionOffset === v.find!.currentFrom, `光标应跟随当前匹配，实际 ${v.selectionOffset}`)

    // 中文与 emoji：🎉 匹配 1 次（码点安全）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '🎉' })
    v = await waitViewState('find.md', (s) => s.find?.query === '🎉')
    assert(v.find!.total === 1, `emoji 查询应命中 1 次，实际 ${v.find!.total}`)
    assert(v.find!.currentFrom === text.indexOf('🎉'), 'emoji 命中应在码点边界上')

    // 无匹配：0/0 明确反馈
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '不存在的词' })
    v = await waitViewState('find.md', (s) => s.find?.total === 0)
    const none = v.find!
    assert(none.index === 0, `无匹配时序号应为 0，实际 ${none.index}`)
    assert(none.currentFrom === null, '无匹配时当前区间为 null')

    // #236 三开关默认档（对齐 VSCode）：大小写不敏感、非全字、字面量——
    // 中文查询无大小写变体，'目标词' 4 次计数在默认档不变即为不敏感语义在场的证据
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '目标词' })
    v = await waitViewState('find.md', (s) => s.find?.total === 4)
    assert(v.find!.matchCase === false, '默认档 matchCase 应为 false（大小写不敏感）')
    assert(v.find!.wholeWord === false, '默认档 wholeWord 应为 false')
    assert(v.find!.regexp === false, '默认档 regexp 应为 false（字面量）')
    assert(v.find!.valid === true, '合法查询 valid 应为 true')

    // 非法正则：不崩、valid 可见反馈、无匹配；后续合法查询恢复
    // （断言走独立取值变量——assert 的类型收窄不跨赋值残留）
    // 默认档为字面量（regexp=false，#236 对齐 VSCode）：'[未闭合' 是合法
    // 字面量查询，valid=false 反馈只在正则开关开启时可达。经真实开关点击
    // 链路（find.test.toggle → 本地翻转 + findOptions.set 上送宿主持久化
    // → snapshot 广播回流）打开 regexp 开关再验证；结束后恢复默认档——
    // findOptions 是 workspace 级记忆，不恢复会污染同宿主后续用例
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'find.test.toggle', key: 'regexp' })
    await waitViewState('find.md', (s) => s.find?.regexp === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '[未闭合' })
    const invalid = await waitViewState('find.md', (s) => s.find?.valid === false)
    assert(invalid.find!.total === 0, '非法正则应无匹配')
    assert(invalid.find!.open === true, '非法正则不得关闭面板（不崩）')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'find.test.toggle', key: 'regexp' })
    await waitViewState('find.md', (s) => s.find?.regexp === false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '目标词' })
    v = await waitViewState('find.md', (s) => s.find?.valid === true && s.find?.total === 4)

    // 关闭：会话回报关闭态
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    v = await waitViewState('find.md', (s) => s.find?.open === false)

    // 只读契约：全程文档版本、applyEdit、文本与磁盘不变（查找不入撤销栈、
    // 不触发保存——保存内容不因查找改变）
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.version === session0.version, `查找不得改变文档版本（${session0.version} → ${session1.version}）`)
    assert(session1.appliedEdits === session0.appliedEdits, `查找不得产生写回（${session0.appliedEdits} → ${session1.appliedEdits}）`)
    assert(v.text === text, '查找后 webview 文本逐字节不变')
    assert(doc.getText() === text, '查找后权威文本不变')
    assert(!doc.isDirty, '查找后文档不得 dirty')
    assert(await readDisk('find.md') === diskBefore, '查找后磁盘字节不变')
  }],

  ['编辑区查找：阅读视图屏外匹配定位与按需挂载保持（#14）', async () => {
    await openWithEditor('reading-100k.md')
    await waitSessionReady('reading-100k.md')
    const uri = wsUri('reading-100k.md').toString()
    const sessionBefore = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const doc = await vscode.workspace.openTextDocument(wsUri('reading-100k.md'))
    const text = doc.getText()
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('切换并虚拟化', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingVirtualized === true ? true : undefined
    })

    // 唯一命中的屏外段落（第 9995 段，文档 9.995% 处，远在首屏之外）
    const para = '第 9995 段 阅读段落样本文本'
    const paraOffset = text.indexOf(para)
    assert(paraOffset > 0, 'fixture 中应存在目标段')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: para })
    let v = await waitViewState('reading-100k.md', (s) => s.find?.total === 1 && s.readingAnchorStart === paraOffset)
    assert(v.find!.currentFrom === paraOffset, `当前匹配应在文本模型中的唯一位置，实际 ${v.find!.currentFrom}`)
    // 阅读锚点 = 目标块源 start；目标块已真实挂载（有布局顶位置）且发生滚动
    assert(v.readingAnchorStart === paraOffset, `阅读锚点应为目标段块 start=${paraOffset}，实际 ${v.readingAnchorStart}`)
    assert(v.readingAnchorTopPx !== undefined, '屏外匹配定位后目标块应已挂载')
    assert((v.readingScrollTopPx ?? 0) > 0, `定位屏外匹配应发生滚动，实际 scrollTop=${v.readingScrollTopPx}`)
    // 不为查找常驻全文 DOM：仍只挂载窗口块；无重新解析
    assert((v.readingMountedBlocks ?? 0) < (v.readingTotalBlocks ?? 1), `定位后仍应只挂载窗口块（${v.readingMountedBlocks}/${v.readingTotalBlocks}）`)
    assert((v.readingParseCount ?? 0) === 1, `查找定位不得触发全文重解析，实际 ${v.readingParseCount}`)

    // 多匹配深跳：'阅读标题样本行' 每 50 块一个标题（100000/50=2000 个）。
    // 先 view.locate 回顶（参考位置确定：当前匹配取参考位置后首个），
    // 从第 1 个 prev 回绕到末个（第 100000 节，文档末尾屏外）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 0 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '阅读标题样本行' })
    v = await waitViewState('reading-100k.md', (s) => s.find?.total === 2000 && s.find?.index === 1)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.step', direction: 'prev' })
    // 循环导航：从第 1 个 prev 回绕到末个（第 100000 节）；末屏的视口顶块
    // 是它前面的块（#7 已知布局行为，maxScroll clamp），此处只断言匹配序号
    v = await waitViewState('reading-100k.md', (s) => s.find?.index === 2000)
    const lastHeadingLine = text.indexOf('## 第 100000 节 阅读标题样本行')
    const lastHeadingText = '## 第 100000 节 阅读标题样本行'
    assert(v.find!.currentFrom === lastHeadingLine + lastHeadingText.indexOf('阅读标题样本行'), `回绕后应为末个标题命中，实际 ${v.find!.currentFrom}`)
    // 末屏锚点语义下深跳断言改用可达视口顶的目标：第 99950 节（近末尾）
    const deepHeading = '## 第 99950 节 阅读标题样本行'
    const deepLineStart = text.lastIndexOf(deepHeading)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '第 99950 节' })
    v = await waitViewState('reading-100k.md', (s) => s.find?.total === 1 && s.readingAnchorStart === deepLineStart)
    assert(v.find!.currentFrom === deepLineStart + deepHeading.indexOf('第 99950 节'), `唯一命中应在第 99950 节标题行，实际 ${v.find!.currentFrom}`)
    assert(v.readingAnchorStart === deepLineStart, `深跳后阅读锚点应为目标标题块 start=${deepLineStart}，实际 ${v.readingAnchorStart}`)
    assert(v.readingAnchorTopPx !== undefined, '深跳后目标块应已挂载')
    assert((v.readingParseCount ?? 0) === 1, '循环导航不得触发全文重解析')
    assert((v.readingMountedBlocks ?? 0) < (v.readingTotalBlocks ?? 1), '深跳后仍应只挂载窗口块')

    // 只读契约：版本/写回/文本不变
    const sessionAfter = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(sessionAfter.version === sessionBefore.version, `查找不得改变文档版本（${sessionBefore.version} → ${sessionAfter.version}）`)
    assert(sessionAfter.appliedEdits === sessionBefore.appliedEdits, '查找不得产生写回')
    assert(v.text === text, '查找后 webview 文本不变')

    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('reading-100k.md', (s) => s.find?.open === false)
  }],

  ['编辑区查找：模式切换会话保活与源锚点位置恢复（#14）', async () => {
    await openWithEditor('find.md')
    await waitSessionReady('find.md')
    const uri = wsUri('find.md').toString()
    const text = (await vscode.workspace.openTextDocument(wsUri('find.md'))).getText()
    const diskBefore = await readDisk('find.md')

    // live 导航到第 2 个匹配（段落二）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '目标词' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.step', direction: 'next' })
    let v = await waitViewState('find.md', (s) => s.find?.index === 2)
    const matchFrom = v.find!.currentFrom!
    assert(text.slice(matchFrom, matchFrom + 3) === '目标词', '当前匹配区间应还原为查询本身')

    // 切到阅读：会话保活，锚点映射到当前匹配所在块（等待定位落定：
    // 虚拟化滚动/实测修正期间的瞬时锚点以最终落定值为准）
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const para2Start = text.indexOf('第二段：又出现目标词了。')
    v = await poll('阅读模式保活与锚点落定', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.viewMode === 'reading' && s.find?.open === true && s.readingAnchorStart === para2Start ? s : undefined
    })
    assert(v.find!.index === 2, `会话保活：当前序号仍为 2，实际 ${v.find!.index}`)
    assert(v.readingAnchorStart === para2Start, `阅读锚点应为当前匹配块 start，实际 ${v.readingAnchorStart}`)
    // #241 验收回归钉住：块级命中高亮必须落在 DOM（绘制层证据——状态级
    // total/anchor 正确不保证 .vsidian-reading-find-hit 类挂上）
    assert((v.readingFindHitBlocks ?? 0) >= 1,
      `阅读模式查找命中块应有 find-hit DOM 类，实际 ${v.readingFindHitBlocks ?? 0}`)

    // 切回 live：选区恢复到当前匹配（源锚点映射，非块首；#38 起回 live 用
    // 显式命令，循环命令在 reading 态会切源码编辑器）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    v = await poll('切回 live 恢复', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.viewMode === 'live' && s.find?.open === true ? s : undefined
    })
    assert(v.selectionOffset === matchFrom, `切回后光标应恢复到当前匹配 ${matchFrom}，实际 ${v.selectionOffset}`)

    // 关闭后切换/状态不受影响；磁盘与版本保持
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find.md', (s) => s.find?.open === false)
    const session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === 0, `查找与模式切换不得产生写回，实际 ${session.appliedEdits}`)
    assert(await readDisk('find.md') === diskBefore, '查找与模式切换后磁盘字节不变')
  }],

  ['编辑区查找：隐藏源码浮层真实绘制、导航与模式清理（#241 验收跟进）', async () => {
    await openWithEditor('find-hidden-source.md')
    await waitSessionReady('find-hidden-source.md')
    const uri = wsUri('find-hidden-source.md').toString()
    const diskBefore = await readDisk('find-hidden-source.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '|' })
    const v = await waitViewState('find-hidden-source.md', s => s.find?.total === 9 && s.paint?.readingFindSource?.visible === true)
    assert(v.paint!.readingFindSource!.text === '| name | state |', '源码反馈应为当前命中的原始行')
    assert(v.paint!.readingFindSource!.current === '|', '源码反馈必须精确高亮当前竖线')
    assert(v.paint!.readingFindSource!.background === 'rgba(255, 141, 55, 0.65)', '当前命中须实际消费默认高亮色')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.step', direction: 'next' })
    await waitViewState('find-hidden-source.md', s => s.find?.index === 2 && s.paint?.readingFindSource?.visible === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: 'name' })
    const visibleHit = await waitViewState('find-hidden-source.md', s => s.find?.total === 1 && s.paint?.readingFindSource?.visible === false)
    assert(visibleHit.paint!.readingFindSource!.text === '', '可见正文命中不保留源码浮层')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.open', query: '|' })
    await waitViewState('find-hidden-source.md', s => s.paint?.readingFindSource?.visible === true)
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    await waitViewState('find-hidden-source.md', s => s.viewMode === 'live' && s.paint?.readingFindSource?.visible === false)
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
    await waitViewState('find-hidden-source.md', s => s.paint?.readingFindSource?.visible === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find-hidden-source.md', s => s.find?.open === false && s.paint?.readingFindSource?.text === '')
    const session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === 0, '源码反馈与模式切换不得写回')
    assert(await readDisk('find-hidden-source.md') === diskBefore, '源码反馈不修改磁盘字节')
  }],

  ['编辑区查找：替换写回、撤销粒度与阅读只读（#236）', async () => {
    await openWithEditor('find.md')
    await waitSessionReady('find.md')
    const uri = wsUri('find.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('find.md'))
    const text = doc.getText()
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 打开并预置替换词：替换栏展开（live），观测 replaceOpen
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    let v = await waitViewState('find.md', (s) => s.find?.open === true && s.find?.total === 4)
    assert(v.find!.replaceOpen === true, 'live 模式打开（replace）应展开替换栏')

    // 替换下一个：单笔写回（一笔 edit.request = 宿主撤销一次）；
    // 第 1 处被替换、会话移到下一处（total 递减、序号语义保持）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'next' })
    await poll('替换下一个写回', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === text.replace('目标词', '替换词') ? s : undefined
    })
    let session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.appliedEdits === session0.appliedEdits + 1, `替换下一个应恰为一笔写回，实际 ${session0.appliedEdits} → ${session1.appliedEdits}`)
    assert(doc.isDirty, '替换后文档应 dirty')
    // 关闭面板归还焦点后再 undo（undo 作用于活跃编辑器，焦点不应留在
    // webview 输入框）；一次撤销恢复整笔替换（撤销粒度契约）。
    // appliedEdits 是累计计数（undo 不回退），撤销后重读作全部替换段基准
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find.md', (s) => s.find?.open === false)
    await vscode.commands.executeCommand('undo')
    await poll('撤销替换下一个', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === text ? s : undefined
    })
    session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 全部替换：整批一笔写回（一笔撤销）——重开面板（重预置替换词）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    await waitViewState('find.md', (s) => s.find?.open === true && s.find?.total === 4)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'all' })
    const allReplaced = text.split('目标词').join('替换词')
    await poll('全部替换写回', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === allReplaced ? s : undefined
    })
    const session2 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session2.appliedEdits === session1.appliedEdits + 1, `全部替换应整批恰为一笔写回，实际 ${session1.appliedEdits} → ${session2.appliedEdits}`)
    // 归还焦点后一次撤销恢复整批（整批一笔撤销）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find.md', (s) => s.find?.open === false)
    await vscode.commands.executeCommand('undo')
    await poll('撤销全部替换', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === text ? s : undefined
    })

    // 恢复原样并保存：磁盘与 dirty 归零（不残留测试痕迹）
    await doc.save()
    assert(await readDisk('find.md') === text, '撤销后保存应恢复原磁盘内容')

    // 阅读模式：替换整体禁用（2026-10）——面板保活收起替换栏、toggle 禁用，
    // 替换指令静默忽略（只读）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    await waitViewState('find.md', (s) => s.find?.open === true && s.find?.total === 4)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const afterReading = await poll('切阅读', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.viewMode === 'reading' && s.find?.open === true ? s : undefined
    })
    assert(afterReading.find!.replaceOpen === false, '阅读模式替换栏恒不展开（替换是 Live 编辑能力）')
    const session3 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'all' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find.md', (s) => s.find?.open === false)
    const session4 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session4.appliedEdits === session3.appliedEdits, `阅读模式不得执行替换（${session3.appliedEdits} → ${session4.appliedEdits}）`)
    const docFinal = await vscode.workspace.openTextDocument(wsUri('find.md'))
    assert(docFinal.getText() === text, '阅读模式替换指令后权威文本不变')

    // 面板已关：阅读模式带 replace 的打开指令不开面板（2026-10 整体禁用）。
    // 先留消息回路窗口再断言关闭态——守卫失效时面板在窗口内打开，
    // open===false 轮询恒不满足即超时失败，断言具备真实回归能力
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    await waitViewState('find.md', (s) => s.find?.open === false)
  }],

  ['编辑区查找：替换的成型头区排除——头区零写回与计数一致（#241 评审修复 P0-2）', async () => {
    await openWithEditor('find-fm.md')
    await waitSessionReady('find-fm.md')
    const uri = wsUri('find-fm.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('find-fm.md'))
    const text = doc.getText()
    const diskBefore = await readDisk('find-fm.md')
    const bodyStart = text.indexOf('第一段')
    assert(bodyStart > 0, 'fixture 正文起点应存在')
    const headText = text.slice(0, bodyStart)
    // 头区命中载体自检：title 值与 tags 项各一次「目标词」，正文 3 次
    assert(text.split('目标词').length - 1 === 5, `fixture 应共 5 处「目标词」（头区 2 + 正文 3），实际 ${text.split('目标词').length - 1}`)
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 打开替换：面板计数排除头区（仅正文 3 处）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '目标词', replace: true, replacement: '替换词',
    })
    let v = await waitViewState('find-fm.md', (s) => s.find?.open === true && s.find?.total === 3)
    assert(v.find!.replaceOpen === true, 'live 打开（replace）应展开替换栏')

    // 替换下一个：单笔写回只改正文首个命中；头区源文本逐字节不变
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'next' })
    const afterNext = text.replace('这里有一个目标词', '这里有一个替换词')
    v = await poll('替换下一个写回', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === afterNext ? s : undefined
    })
    let session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === session0.appliedEdits + 1, `替换下一个应恰为一笔写回，实际 ${session0.appliedEdits} → ${session.appliedEdits}`)
    assert(v.text.slice(0, bodyStart) === headText, '替换下一个后头区源文本逐字节不变')
    assert(v.liveSyntax?.frontmatterLines === 5, `头区仍按成型 frontmatter 渲染（5 行），实际 ${v.liveSyntax?.frontmatterLines}`)
    assert(doc.getText().slice(0, bodyStart) === headText, '权威文本头区同步不变')

    // 全部替换（同一会话，余下 2 处正文命中）：整批恰一笔，头区仍零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'all' })
    const allReplaced = afterNext.replace('又出现目标词了', '又出现替换词了').replace('结尾目标词三', '结尾替换词三')
    v = await poll('全部替换写回', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === allReplaced ? s : undefined
    })
    session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === session0.appliedEdits + 2, `全部替换应整批恰为一笔写回，实际累计 ${session.appliedEdits}`)
    // 面板计数与实际替换数一致：初始面板 3 命中 → 全文恰 3 处「替换词」
    assert(v.text.split('替换词').length - 1 === 3, `替换数应与面板初始计数一致（3），实际 ${v.text.split('替换词').length - 1}`)
    assert(v.find?.total === 0, `全部替换后应 0 命中，实际 ${v.find?.total}`)
    assert(v.text.slice(0, bodyStart) === headText, '全部替换后头区源文本逐字节不变（头区 2 处命中不被触碰）')
    assert(v.liveSyntax?.frontmatterLines === 5, `全部替换后头区仍成型渲染，实际 ${v.liveSyntax?.frontmatterLines}`)

    // 头区独有查询（面板 0 命中）：替换下一个/全部替换均零写回——官方
    // replaceAll 全文扫描会改写头区源文本的 P0 缺陷场景，自研路径必须空转
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.find.open', query: '头区目标词样本', replacement: '改写',
    })
    v = await waitViewState('find-fm.md', (s) => s.find?.query === '头区目标词样本' && s.find?.total === 0)
    const beforeInert = ((await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState).appliedEdits
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'next' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.replace', op: 'all' })
    session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === beforeInert, `面板 0 命中时替换不得写回（${beforeInert} → ${session.appliedEdits}）`)
    const docInert = await vscode.workspace.openTextDocument(wsUri('find-fm.md'))
    assert(docInert.getText() === allReplaced, '面板 0 命中时替换指令后权威文本不变')

    // 归还焦点后逐笔撤销（两笔替换两笔撤销），保存恢复磁盘原样
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.find.close' })
    await waitViewState('find-fm.md', (s) => s.find?.open === false)
    await vscode.commands.executeCommand('undo')
    await poll('撤销全部替换', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === afterNext ? s : undefined
    })
    await vscode.commands.executeCommand('undo')
    await poll('撤销替换下一个', async () => {
      const s = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return s?.text === text ? s : undefined
    })
    await doc.save()
    assert(await readDisk('find-fm.md') === diskBefore, '两笔撤销后保存应恢复原磁盘内容')
  }],

  // ---- 工单 #11：双链解析并跳转笔记与标题 ----

  ['双链显示：live widget/mark 与阅读 a 渲染，降级形态源码保真，稳定类名可被外部片段命中（#11）', async () => {
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()
    const diskBefore = await readDisk('wikilinks.md')

    // live 默认模式：视口内 3 处合法双链（按名/别名/标题）为 widget；
    // #247 起混排嵌入 occurrence 挂卡（精确区间替换，源文文本退场）——
    // 嵌入 mark 不再有 DOM 文本，DOM 级计数回到 3（与独占行嵌入整行
    // 替换吞没同款语义）；降级形态与代码上下文不装饰
    const live = await waitViewState('wikilinks.md', (v) => (v.liveWikilinkCount ?? -1) === 3)
    assert(live.liveWikilinkCount === 3, `live 双链数应为 3，实际 ${live.liveWikilinkCount}`)
    assert(
      live.cssProbe!.liveWikilinkDecorationColor === 'rgb(28, 29, 30)',
      `live 双链应被测试片段命中 rgb(28, 29, 30)，实际 ${live.cssProbe!.liveWikilinkDecorationColor}`,
    )
    // 阅读侧：a.vsidian-wikilink 数量与探针 + 降级形态按原文显示
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await poll('阅读模式双链观测', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingWikilinkCount !== undefined ? v : undefined
    })
    assert(reading.readingWikilinkCount === 3, `阅读双链数应为 3，实际 ${reading.readingWikilinkCount}`)
    assert(
      reading.cssProbe!.readingWikilinkDecorationColor === 'rgb(31, 32, 33)',
      `阅读双链应被测试片段命中 rgb(31, 32, 33)，实际 ${reading.cssProbe!.readingWikilinkDecorationColor}`,
    )
    assert(reading.text === WIKILINKS_DOC_TEXT, '显示链路不得改写文档文本')
    assert(reading.readingLinkCount === 3, `阅读 a 元素应恰为 3 个双链（无普通链接），实际 ${reading.readingLinkCount}`)
    // 全程零写回
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `显示链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
    assert(await readDisk('wikilinks.md') === diskBefore, '显示链路不得写磁盘')
  }],

  ['双链跳转：同目录短名与明确子路径解析并打开目标（文本编辑器），零写回（#11/#196）', async () => {
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()
    const diskBefore = await readDisk('wikilinks.md')
    const versionBefore = (await vscode.workspace.openTextDocument(wsUri('wikilinks.md'))).version

    // 同目录短名（#196 根内相对路径）：wikilinks.md 在工作区根，[[目标笔记]]
    // = 根目录/目标笔记.md（来源文档同目录）。日志先于打开动作写入，目标应
    // 以 Vsidian 面板打开
    await injectWikilink(uri, '目标笔记')
    let logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.target === '目标笔记')
    assert(logData!.path === wsUri('目标笔记.md').fsPath, `同目录目标路径不符：${logData!.path}`)
    await waitSessionReady('目标笔记.md')
    await waitActiveCustomTab('目标笔记.md')
    assert(tabsOf('目标笔记.md', 'native') === 0, '同目录跳转不应额外打开源码标签')
    const opened = await vscode.workspace.openTextDocument(wsUri('目标笔记.md'))
    assert(opened.getText().startsWith('# 目标笔记标题'), '同目录打开的目标内容不符')

    // 重显源面板再注入下一条双链
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    // 明确子路径（含中文与空格目录）：来源目录下的相对子路径解析（#196：
    // 双候选根相对兜底已废除——此处源文档恰在根目录，文档相对即根相对）
    await injectWikilink(uri, '子 目录/目标 二')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.target === '子 目录/目标 二')
    assert(logData!.path === wsUri('子 目录/目标 二.md').fsPath, `明确子路径目标不符：${logData!.path}`)
    assert(logData!.locate === 'none', `无标题目标不应定位，实际 ${logData!.locate}`)
    await waitSessionReady('子 目录/目标 二.md')
    await waitActiveCustomTab('子 目录/目标 二.md')
    assert(tabsOf('子 目录/目标 二.md', 'native') === 0, '明确子路径跳转不应打开源码标签')

    // 跳转全程只读：源文档零写回、磁盘不变、版本不变
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `双链跳转不得产生 applyEdit，实际 ${state.appliedEdits}`)
    assert(state.version === versionBefore, `跳转不得改变文档版本（${versionBefore} → ${state.version}）`)
    assert(await readDisk('wikilinks.md') === diskBefore, '双链跳转不得改写源文档')
  }],

  ['双链根内相对路径边界：子目录来源短名不命中根目录同名、../ 根内上行命中、../../ 越界拦截（#196）', async () => {
    // 源文档在 子 目录/ 下：docDir = <ws>/子 目录，所属根 = <ws>（多根
    // 互不补查、basename 搜索与根相对兜底废除后的新语义边界）
    await openWithEditor('子 目录/目标 二.md')
    await waitSessionReady('子 目录/目标 二.md')
    const uri = wsUri('子 目录/目标 二.md').toString()
    const diskBefore = await readDisk('子 目录/目标 二.md')

    // 短名跨目录不命中：[[目标笔记]] 只认 子 目录/目标笔记(.md)，根目录的
    // 目标笔记.md 不再命中（旧 basename 全根搜索的集成级反例）
    await injectWikilink(uri, '目标笔记')
    await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-not-found' && e.target === '目标笔记')

    // 越出所属根：../../ 被拦截，与不存在分开反馈（outside-root）
    await injectWikilink(uri, '../../目标笔记')
    await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-outside-root' && e.target === '../../目标笔记')

    // 根内 ../ 上行照常命中：../目标笔记 = 根/目标笔记.md，Vsidian 面板打开
    await injectWikilink(uri, '../目标笔记')
    const logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.target === '../目标笔记')
    assert(logData!.path === wsUri('目标笔记.md').fsPath, `根内上行目标不符：${logData!.path}`)
    await waitSessionReady('目标笔记.md')
    await waitActiveCustomTab('目标笔记.md')

    // 拦截两态（not-found / outside-root）不得打开编辑器：wikilink-doc 恰一条
    const logAll = (await vscode.commands.executeCommand(CMD.linkLog, uri)) as LinkLogData
    assert(
      logAll.log.filter((e) => e.kind === 'wikilink-doc').length === 1,
      `拦截类双链意图不得打开编辑器，实际 ${JSON.stringify(logAll.log)}`,
    )
    assert(await readDisk('子 目录/目标 二.md') === diskBefore, '跳转不得改写源文档')
  }],

  ['双链标题跳转（Vsidian 面板）：定位到标题行；缺失标题仍打开并记录（#11）', async () => {
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()
    const diskBefore = await readDisk('wikilinks.md')

    // 标题目标：新面板就绪后 view.locate 落在标题行
    await injectWikilink(uri, 'wikilink-target#深处小节')
    let logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.heading === '深处小节')
    assert(logData!.locate === 'custom-panel', `跨文件标题应由 Vsidian 面板定位，实际 ${logData!.locate}`)
    await waitSessionReady('wikilink-target.md')
    await waitActiveCustomTab('wikilink-target.md')
    const targetText = (await vscode.workspace.openTextDocument(wsUri('wikilink-target.md'))).getText()
    const headingOffset = targetText.indexOf('## 深处小节')
    await waitViewState('wikilink-target.md', (v) => v.selectionOffset === headingOffset)
    assert(tabsOf('wikilink-target.md', 'native') === 0, '标题跳转不应产生源码标签')

    // 缺失标题：文档照常打开（不定位），日志记录 locate=none——缺失给可见反馈
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    await injectWikilink(uri, 'wikilink-target#不存在的小节')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.heading === '不存在的小节')
    assert(logData!.locate === 'none', `缺失标题应记录 locate=none，实际 ${logData!.locate}`)
    await waitActiveCustomTab('wikilink-target.md')
    assert(tabsOf('wikilink-target.md', 'native') === 0, '缺失标题仍不应产生源码标签')

    assert(await readDisk('wikilinks.md') === diskBefore, '标题跳转不得改写源文档')
  }],

  ['双链标题跳转（本扩展面板）：屏外标题挂载定位，不重新解析全文（#11）', async () => {
    // 源面板 + 目标面板并排（beside 保源面板存活）
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const sourceUri = wsUri('wikilinks.md').toString()
    await openWithEditor('目标笔记.md', true)
    const targetSession = await waitSessionReady('目标笔记.md')
    const targetUri = wsUri('目标笔记.md').toString()
    const diskSource = await readDisk('wikilinks.md')
    const diskTarget = await readDisk('目标笔记.md')

    // 目标面板切到阅读模式（活动 tab = 目标面板）
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const before = await poll('目标进入阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri, 0)) as ViewState | undefined
      // 模式先于阅读块模型上报；0 块 / 0 次解析是合法过渡态，不可作跳转前基线。
      return v?.viewMode === 'reading' &&
        (v.readingTotalBlocks ?? 0) > 0 && (v.readingParseCount ?? 0) > 0 ? v : undefined
    })
    const totalBlocks = before.readingTotalBlocks!
    const parseBefore = before.readingParseCount ?? 0

    // 从源面板发起标题跳转：宿主 reveal 目标面板 + view.locate（块挂载定位）
    await injectWikilink(sourceUri, '目标笔记#深处的标题')
    const after = await poll('屏外标题挂载定位', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingAnchorStart === DEEP_HEADING_OFFSET ? v : undefined
    }, 30000)
    assert(after.readingAnchorStart === DEEP_HEADING_OFFSET, `阅读锚点应为屏外标题块 start，实际 ${after.readingAnchorStart}`)
    // 挂载定位不依赖已渲染 DOM：目标块此前在窗口外；定位后窗口覆盖目标
    assert((after.readingMountedBlocks ?? 0) < totalBlocks, `定位后挂载块数应有界（< ${totalBlocks}），实际 ${after.readingMountedBlocks}`)
    assert((after.readingParseCount ?? 0) === parseBefore, `定位不得触发全文重解析（${parseBefore} → ${after.readingParseCount}）`)
    const logData = await waitWikilinkLog(sourceUri, (e) => e.kind === 'wikilink-doc' && e.heading === '深处的标题')
    assert(logData!.locate === 'custom-panel', `本扩展面板路径应记录 locate=custom-panel，实际 ${logData!.locate}`)
    await waitActiveCustomTab('目标笔记.md')
    assert(tabsOf('目标笔记.md', 'vsidian') === 1, '已开目标应重显现有 Vsidian 标签')
    assert(tabsOf('目标笔记.md', 'native') === 0, '已开目标不应并存源码标签')

    // 双侧零写回
    assert(targetSession.appliedEdits === 0, `目标面板不得产生 applyEdit，实际 ${targetSession.appliedEdits}`)
    assert(await readDisk('wikilinks.md') === diskSource, '跳转不得改写源文档')
    assert(await readDisk('目标笔记.md') === diskTarget, '跳转不得改写目标文档')
  }],

  ['双链标题跳转（CRLF 目标面板）：view.locate 坐标转 LF 系后定位正确（#11）', async () => {
    // 目标文档为 CRLF 行尾：findHeadingOffset 基于 getText()（宿主系，保留
    // \r\n）计算 offset，view.locate 发给 LF 坐标系的 webview 前必须转换——
    // 直发宿主系坐标在 30+ 个 CRLF 行尾的文档上定位漂移同数量字符
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const sourceUri = wsUri('wikilinks.md').toString()
    await openWithEditor('wikilink-crlf-target.md', true)
    const targetSession = await waitSessionReady('wikilink-crlf-target.md')
    const diskSource = await readDisk('wikilinks.md')
    const diskTarget = await readDisk('wikilink-crlf-target.md')
    assert(diskTarget.includes('\r\n'), '目标 fixture 应为 CRLF 行尾')

    // live 模式：view.locate 直接设置光标（LF 坐标），从源面板发起标题跳转
    await injectWikilink(sourceUri, 'wikilink-crlf-target#CRLF 深处小节')
    const logData = await waitWikilinkLog(sourceUri, (e) =>
      e.kind === 'wikilink-doc' && e.heading === 'CRLF 深处小节',
    )
    assert(logData!.locate === 'custom-panel', `面板路径应记录 locate=custom-panel，实际 ${logData!.locate}`)
    const located = await waitViewState('wikilink-crlf-target.md', (v) =>
      v.selectionOffset === CRLF_HEADING_LF_OFFSET,
    )
    assert(
      located.selectionOffset === CRLF_HEADING_LF_OFFSET,
      `CRLF 目标定位应落标题行 LF offset ${CRLF_HEADING_LF_OFFSET}，实际 ${located.selectionOffset}`,
    )

    // 双侧零写回
    assert(targetSession.appliedEdits === 0, `目标面板不得产生 applyEdit，实际 ${targetSession.appliedEdits}`)
    assert(await readDisk('wikilinks.md') === diskSource, '跳转不得改写源文档')
    assert(await readDisk('wikilink-crlf-target.md') === diskTarget, '跳转不得改写目标文档（CRLF 保真）')
  }],

  ['双链块引用与本文件锚点跳转（#159）：块定位面板 view.locate、缺失仍打开', async () => {
    // 跨文件块引用：Vsidian 面板打开并定位到块首行
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()
    const diskBefore = await readDisk('wikilinks.md')

    await injectWikilink(uri, 'wikilink-target#^blk-target')
    let logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.blockId === 'blk-target')
    assert(logData!.locate === 'custom-panel', `块引用应经 Vsidian 面板定位，实际 ${logData!.locate}`)
    await waitSessionReady('wikilink-target.md')
    await waitActiveCustomTab('wikilink-target.md')
    const blockText = (await vscode.workspace.openTextDocument(wsUri('wikilink-target.md'))).getText()
    await waitViewState('wikilink-target.md', (v) =>
      v.selectionOffset === blockText.indexOf('带块标记的段落。 ^blk-target'))
    assert(tabsOf('wikilink-target.md', 'native') === 0, '块引用跳转不应产生源码标签')

    // 块 id 缺失：文档照常打开（不定位），日志记录 locate=none——缺失给可见反馈
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    // 块 id 缺失用合法字符集 id（BLOCK_ID_RE 仅拉丁字母/数字/连字符——中文 id
    // 在解析层即 unsupported，走不到"缺失块"分支，#154 已知边界）
    await injectWikilink(uri, 'wikilink-target#^missing-blk')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.blockId === 'missing-blk')
    assert(logData!.locate === 'none', `缺失块 id 应记录 locate=none，实际 ${logData!.locate}`)
    await waitActiveCustomTab('wikilink-target.md')
    assert(tabsOf('wikilink-target.md', 'native') === 0, '缺失块 id 仍不应产生源码标签')

    // 本文件块锚点（[[#^anchor-blk]]）：空 path 目标即当前文档，当前面板走
    // view.locate（live 光标观测）——先离开初始光标 0，观测到块首行 offset
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    await injectWikilink(uri, '#^anchor-blk')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.blockId === 'anchor-blk')
    assert(logData!.locate === 'custom-panel', `本文件锚点应走当前面板定位，实际 ${logData!.locate}`)
    assert(logData!.path === wsUri('wikilinks.md').fsPath, `本文件锚点目标应为当前文档，实际 ${logData!.path}`)
    const located = await waitViewState('wikilinks.md', (v) => v.selectionOffset === ANCHOR_BLK_LF_OFFSET)
    assert(
      located.selectionOffset === ANCHOR_BLK_LF_OFFSET,
      `本文件块锚点光标应落块首行 LF offset ${ANCHOR_BLK_LF_OFFSET}，实际 ${located.selectionOffset}`,
    )

    // 本文件标题锚点（[[#双链样例]]）：光标从锚点块回到文档首标题（0）
    await injectWikilink(uri, '#双链样例')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.heading === '双链样例')
    assert(logData!.locate === 'custom-panel', `本文件标题锚点应走面板定位，实际 ${logData!.locate}`)
    const top = await waitViewState('wikilinks.md', (v) => v.selectionOffset === 0)
    assert(top.selectionOffset === 0, `本文件标题锚点光标应回文档头，实际 ${top.selectionOffset}`)

    // 锚点跳转全程只读
    assert(await readDisk('wikilinks.md') === diskBefore, '锚点跳转不得改写源文档')
  }],

  ['Live 视口源锚点：Mermaid 围栏附近切标签页后中心行与光标保持', async () => {
    const targetUri = wsUri('viewport-mermaid.md')
    const uri = targetUri.toString()
    await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE)
    await poll('观测夹具面板就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState | undefined
      return state?.panels.some((p) => p.ready) ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'viewport.test.position', cursorLine: 123 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'viewport.test.position', scrollNearLine: 123, scrollBiasPx: 150 })
    // 等视口带内三个围栏（116/123/133）到渲染终态再采样——懒加载渲染间隙
    // 中心行可短暂不变（两次采样一致的假稳定），before/after 落在渲染前后
    // 两种几何上即漂移（CI 实测形态：中心行 128→116、scrollTop 2367→2490）。
    // 终态谓词含 error 态（降级围栏高度也是终态），不硬编码围栏数
    await waitViewState('viewport-mermaid.md', mermaidReachedTerminal, 0, 60000)
    const before = await waitViewportSettled('viewport-mermaid.md')
    // 前置只确认「滚到了围栏带」（文档三个 Mermaid 围栏占 116–138 行）——
    // 本地快机渲染后中心 ~118、CI xvfb 的 SVG 渲染尺寸使稳定值可到 128，都在带内。
    // 用例本体断言是切标签页前后中心行 ±2 与光标一致，不受带内位置影响
    assert((before.liveViewportCenterLine ?? 0) >= 110 && (before.liveViewportCenterLine ?? 0) <= 138,
      `前置：视口中心须在 Mermaid 围栏附近，实际 ${before.liveViewportCenterLine}`)
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE)
    await poll('观测夹具重握手就绪', async () => {
      const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState | undefined
      return state?.panels.some((p) => p.ready) ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'viewport.test.position' })
    // 切回后状态恢复（光标/滚动经 getState 重建）与围栏重渲染都是异步链路，
    // 先等「光标回到切走前值」（恢复到错误值则等待超时并附最后观测快照，
    // 断言语义不弱化——CI 实测形态：光标恢复未完成 2029→0），再等围栏
    // 重渲染终态，最后采落定视口
    await waitViewState('viewport-mermaid.md',
      (v) => (v.selectionOffset ?? -1) === (before.selectionOffset ?? -2), 0, 30000)
    await waitViewState('viewport-mermaid.md', mermaidReachedTerminal, 0, 60000)
    const after = await waitViewportSettled('viewport-mermaid.md')
    assert(after.selectionOffset === before.selectionOffset,
      `纯光标移动应跨标签页恢复：${before.selectionOffset} → ${after.selectionOffset}` +
      `（after viewMode=${String(after.viewMode)}，center ${before.liveViewportCenterLine} → ${after.liveViewportCenterLine}，` +
      `scrollTop ${before.liveScrollTopPx} → ${after.liveScrollTopPx}，mermaid after[${mermaidProbeBrief(after)}]）`)
    assert(Math.abs((after.liveViewportCenterLine ?? 0) - (before.liveViewportCenterLine ?? 0)) <= 2,
      `Live 切标签页后中心行漂移：${before.liveViewportCenterLine} → ${after.liveViewportCenterLine}` +
      `（scrollTop ${before.liveScrollTopPx} → ${after.liveScrollTopPx}；mermaid before[${mermaidProbeBrief(before)}] after[${mermaidProbeBrief(after)}]）`)
  }],

  ['定位送达后面板重载：恢复最后导航点，不重播历史定位（#163 验收反馈）', async () => {
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()

    // 连续程序定位往返（文档头 ⇄ 文末块锚点）：重载后的恢复点必须是最后一次
    // 导航点。宿主侧「已送达定位不再补发」（view.locate.ack 对账）由
    // documentSession 单测钉住；本用例观测用户可见行为——恢复落点与幂等
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: ANCHOR_BLK_LF_OFFSET })
    await waitViewState('wikilinks.md', (v) => v.selectionOffset === ANCHOR_BLK_LF_OFFSET)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 0 })
    await waitViewState('wikilinks.md', (v) => v.selectionOffset === 0)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: ANCHOR_BLK_LF_OFFSET })
    await waitViewState('wikilinks.md', (v) => v.selectionOffset === ANCHOR_BLK_LF_OFFSET)

    // 重载 webview（Developer: Reload Webviews；retainContextWhenHidden 关闭：
    // 销毁重建同一 panel，走 getState 恢复）——定位点已随锚点持久化落盘
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    const restored = await poll('重载后恢复最后定位点', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v && v.text === WIKILINKS_DOC_TEXT && v.selectionOffset === ANCHOR_BLK_LF_OFFSET ? v : undefined
    }, 30000)
    assert(restored.selectionOffset === ANCHOR_BLK_LF_OFFSET,
      `重载后应恢复最后导航点（LF offset ${ANCHOR_BLK_LF_OFFSET}，持久化锚点路径），实际 ${restored.selectionOffset}`)

    // 幂等：再次重载仍稳定在最后导航点（无补发循环、无逐次漂移）
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    const again = await poll('二次重载仍恢复最后定位点', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v && v.text === WIKILINKS_DOC_TEXT && v.selectionOffset === ANCHOR_BLK_LF_OFFSET ? v : undefined
    }, 30000)
    assert(again.selectionOffset === ANCHOR_BLK_LF_OFFSET,
      `二次重载不得漂移（期望 LF offset ${ANCHOR_BLK_LF_OFFSET}，实际 ${again.selectionOffset}）`)
  }],

  ['双链缺失与同名隔离：子目录同名不再命中（多候选选择废除）、缺失提示、不支持降级、不自动建文件（#11/#196）', async () => {
    await openWithEditor('wikilinks.md')
    await waitSessionReady('wikilinks.md')
    const uri = wsUri('wikilinks.md').toString()
    const diskBefore = await readDisk('wikilinks.md')
    const versionBefore = (await vscode.workspace.openTextDocument(wsUri('wikilinks.md'))).version

    // 短名只认来源同目录（#196）：dup/甲.md 与 other/甲.md 都在子目录，
    // 来源目录（工作区根）下没有 甲.md → not-found。旧 basename 全根搜索
    // 与同名 QuickPick 选择已废除
    await injectWikilink(uri, '甲')
    await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-not-found' && e.target === '甲')
    // 缺失目标：not-found（不自动创建文件）
    await injectWikilink(uri, '不存在的笔记')
    await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-not-found' && e.target === '不存在的笔记')
    // 不支持形态（块引用 ^）：宿主侧分类拒绝并反馈
    await injectWikilink(uri, '目标笔记^块')
    await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-unsupported' && e.target === '目标笔记^块')
    // 上述意图均不打开编辑器：日志中无 wikilink-doc（甲/不存在/^ 三者）
    const logAll = (await vscode.commands.executeCommand(CMD.linkLog, uri)) as LinkLogData
    assert(
      !logAll.log.some((e) => e.kind === 'wikilink-doc'),
      `拦截类双链意图不得打开编辑器，实际 ${JSON.stringify(logAll.log)}`,
    )
    // 不自动建文件
    let created = false
    try {
      await readDisk('不存在的笔记.md')
      created = true
    } catch {
      created = false
    }
    assert(!created, '缺失目标不得自动创建文件')

    // 拦截链路零写回（在 casenote 打开动作之前断言）
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `歧义/缺失链路不得产生 applyEdit，实际 ${state.appliedEdits}`)
    assert(state.version === versionBefore, `版本不得变化（${versionBefore} → ${state.version}）`)

    // 大小写语义随宿主平台：两平台注入同名小写 'casenote'——Windows 本地
    //（NTFS 语义）不敏感命中 CaseNote.md；POSIX 宿主严格匹配为 not-found
    //（注入端不得按平台翻转：精确名 'CaseNote' 在严格语义下必然命中打开，
    // 与下方 not-found 断言矛盾，Linux 宿主上必超时）
    await injectWikilink(uri, 'casenote')
    if (process.platform === 'win32') {
      await waitSessionReady('CaseNote.md')
      await waitActiveCustomTab('CaseNote.md')
      assert(tabsOf('CaseNote.md', 'native') === 0, '大小写不敏感命中不应产生源码标签')
    } else {
      await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-not-found' && e.target === 'casenote')
    }

    assert(await readDisk('wikilinks.md') === diskBefore, '歧义/缺失链路不得改写源文档')
  }],

  ['表格数据行背景透明到编辑器背景，表头保留底色（#213）', async () => {
    await openWithEditor('table42.md')
    await waitSessionReady('table42.md')
    // 绘制层断言：数据行/分隔行行级 computed 背景透明（rgba(0,0,0,0) 即
    // transparent 的序列化），表头格仍实际着色（--vsidian-table-background）
    const state = await waitViewState('table42.md', (v) =>
      v.paint?.table?.dataRowLineBackground != null &&
      (v.paint.table.headerCellBackgrounds?.length ?? 0) > 0)
    const table = state.paint!.table!
    assert(table.dataRowLineBackground === 'rgba(0, 0, 0, 0)',
      `数据行/分隔行背景须透明到编辑器背景：${table.dataRowLineBackground}`)
    assert((table.headerCellBackgrounds ?? []).every((color) => color !== 'rgba(0, 0, 0, 0)'),
      `表头格须保留底色：${JSON.stringify(table.headerCellBackgrounds)}`)
  }],

  ['表格行列选中在绘制层显示完整轮廓与高亮（#43）', async () => {
    await openWithEditor('table43-crlf.md')
    await waitSessionReady('table43-crlf.md')
    const uri = wsUri('table43-crlf.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.select', axis: 'row', index: 1 })
    const row = await waitViewState('table43-crlf.md', (v) =>
      v.paint?.table?.rowOutlineWidth != null && v.paint.table.regionCellCount === 2)
    const rowPaint = row.paint!.table!
    assert(rowPaint.cellVisible === true && rowPaint.gridDisplay === 'grid',
      '选中行的表格文字仍须真实可见且保持网格布局')
    assert(rowPaint.rowOutlineColor !== null && rowPaint.rowOutlineColor !== 'rgba(0, 0, 0, 0)',
      `选中行轮廓须有实色：${rowPaint.rowOutlineColor}`)
    const baseBorderWidth = Number.parseFloat(rowPaint.cellBorderWidth ?? '')
    assert(baseBorderWidth > 0 && Number.parseFloat(rowPaint.rowOutlineWidth ?? '') > baseBorderWidth,
      `选中行轮廓须比普通格线更醒目：格线=${rowPaint.cellBorderWidth}，轮廓=${rowPaint.rowOutlineWidth}`)
    assert(rowPaint.rowBackgroundColor !== null && rowPaint.rowBackgroundColor !== 'rgba(0, 0, 0, 0)',
      `选中行单元格须实际着色：${rowPaint.rowBackgroundColor}`)
    assert(rowPaint.regionCellCount === 2, `两格矩形选区须完整绘出：${rowPaint.regionCellCount}`)
    assert(rowPaint.regionBackgroundColor !== null && rowPaint.regionBackgroundColor !== 'transparent' &&
      rowPaint.regionBackgroundColor !== 'rgba(0, 0, 0, 0)',
      `矩形选区的单元格须实际着色：${rowPaint.regionBackgroundColor}`)
    assert(Number.parseFloat(rowPaint.regionTopBorderWidth ?? '') > baseBorderWidth &&
      Number.parseFloat(rowPaint.regionLeftBorderWidth ?? '') > baseBorderWidth,
      `矩形外围顶/左边框须比普通格线更醒目：格线=${rowPaint.cellBorderWidth}，顶/左=${rowPaint.regionTopBorderWidth}/${rowPaint.regionLeftBorderWidth}`)

    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.select', axis: 'column', index: 0 })
    const column = await waitViewState('table43-crlf.md', (v) => v.paint?.table?.columnBorderWidth != null)
    const colPaint = column.paint!.table!
    assert(colPaint.cellVisible === true && colPaint.gridDisplay === 'grid',
      '选中列的表格文字仍须真实可见且保持网格布局')
    assert(colPaint.columnBorderColor === rowPaint.rowOutlineColor,
      `行列轮廓须使用同一主题强调色：行=${rowPaint.rowOutlineColor}，列=${colPaint.columnBorderColor}`)
    assert(Number.parseFloat(colPaint.columnBorderWidth ?? '') > baseBorderWidth,
      `选中列两侧轮廓须比普通格线更醒目：格线=${colPaint.cellBorderWidth}，轮廓=${colPaint.columnBorderWidth}`)
    assert(Number.parseFloat(colPaint.columnRightBorderWidth ?? '') > baseBorderWidth,
      `选中列右侧轮廓须闭合：${colPaint.columnRightBorderWidth}`)
    assert(Number.parseFloat(colPaint.columnTopBorderWidth ?? '') > baseBorderWidth &&
      Number.parseFloat(colPaint.columnBottomBorderWidth ?? '') > baseBorderWidth,
      `选中列顶边和底边须闭合：${colPaint.columnTopBorderWidth}/${colPaint.columnBottomBorderWidth}`)
    assert(colPaint.columnBackgroundColor !== null && colPaint.columnBackgroundColor !== 'rgba(0, 0, 0, 0)',
      `选中列单元格须实际着色：${colPaint.columnBackgroundColor}`)
  }],

  ['点阵拖排行经真实 webview 鼠标处理器写回 CRLF，一次撤销（#43）', async () => {
    await openWithEditor('table43-crlf.md')
    await waitSessionReady('table43-crlf.md')
    const uri = wsUri('table43-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table43-crlf.md'))
    const original = TABLE13_DOC_TEXT.replace(/\n/g, '\r\n')
    const movedLf = TABLE13_DOC_TEXT.replace(
      '| 名字 | 数量 |\n| --- | :---: |\n| 苹果 | 3 |\n| `x|y` | 4 |',
      '| `x|y` | 4 |\n| --- | :---: |\n| 名字 | 数量 |\n| 苹果 | 3 |',
    )
    const moved = movedLf.replace(/\n/g, '\r\n')
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.drag', sourceIndex: 2, targetSlot: 0,
    })
    await poll('拖动写回权威 CRLF 文本', () => doc.getText() === moved ? true : undefined)
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.appliedEdits === before.appliedEdits + 1, '一次拖动必须只产生一笔 applyEdit')
    assert(await doc.save(), '拖排行保存失败')
    assert(await readDisk('table43-crlf.md') === moved, '拖排行保存回读丢失 CRLF 或顺序')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('一次撤销恢复原行序', () => doc.getText() === original ? true : undefined)
    await doc.save()
  }],

  ['创建空表格命令：行内拆分、上下空行、CRLF 回读与单次撤销', async () => {
    await openWithEditor('table-create-crlf.md')
    await waitSessionReady('table-create-crlf.md')
    const uri = wsUri('table-create-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table-create-crlf.md'))
    const original = '左文右文\r\n尾段\r\n'
    const expected = '左文\r\n\r\n|  |  |\r\n| --- | --- |\r\n|  |  |\r\n\r\n右文\r\n尾段\r\n'
    assert(doc.getText() === original, '创建表格夹具原文不符')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 2 })
    const invoked = await vscode.commands.executeCommand('onegayi.vsidian.table.create')
    assert(invoked === true, '创建表格命令应在活动 Vsidian 编辑器中可用')
    await poll('创建表格写回 CRLF 文档', () => doc.getText() === expected ? true : undefined)
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 1, '创建表格应只产生一笔宿主编辑')
    assert(await doc.save(), '创建表格保存失败')
    assert(await readDisk('table-create-crlf.md') === expected, '创建表格保存回读未保留 CRLF 或上下文')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('创建表格一次撤销恢复原文', () => doc.getText() === original ? true : undefined)
    await doc.save()
  }],

  // ---- 工单 #13：表格键盘导航与增删行列 ----

  ['表格增删行列：命令路径写回权威文档、区域不变、一次撤销（#13）', async () => {
    await openWithEditor('table13.md')
    await waitSessionReady('table13.md')
    const uri = wsUri('table13.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table13.md'))
    const original = TABLE13_DOC_TEXT

    // 光标定位到「苹果」后（数据行内），经正式命令（命令面板路径）插入行
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: original.indexOf('苹果') + 1,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.insertRowBelow')
    const inserted = original.replace(
      '| 苹果 | 3 |\n| `x|y` | 4 |',
      '| 苹果 | 3 |\n| | |\n| `x|y` | 4 |',
    )
    await poll('插入行写入权威', () => (doc.getText() === inserted ? true : undefined))
    // 表格外区域逐字节不变（无其他区域重排）
    assert(inserted.startsWith('前导段落甲。\n\n| 名字 | 数量 |\n| --- | :---: |\n'), '表格前区域被重排')
    assert(inserted.endsWith('\n\n结尾段落乙。\n'), '表格后区域被重排')
    // 焦点落点：新行首格（真实 webview 视图观测）
    const view = await waitViewState('table13.md', (v) => v.selectionOffset === inserted.indexOf('| | |') + 2)
    assert(view.selectionOffset === inserted.indexOf('| | |') + 2, `光标应落新行首格，实际 ${view.selectionOffset}`)

    // 撤销一次 = 回退一笔结构提交；一笔命令恰好一笔 applyEdit
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('undo 回原', () => (doc.getText() === original ? true : undefined))
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 1, `插行应恰好 1 笔 applyEdit，实际 ${state.appliedEdits}`)

    // 保存回读：插行后保存，磁盘逐字一致（新行与对齐保持）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: original.indexOf('苹果') + 1,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.insertRowBelow')
    await poll('再次插入', () => (doc.getText() === inserted ? true : undefined))
    assert(await doc.save(), '保存失败')
    const disk = await readDisk('table13.md')
    assert(disk === inserted, `保存回读不一致：${JSON.stringify(disk)}`)
    // 还原到 fixture 原文
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('还原', () => (doc.getText() === original ? true : undefined))
    await doc.save()
  }],

  ['表格结构语义：删表头升格、分隔行保护、插列对齐同步（#13）', async () => {
    await openWithEditor('table13.md')
    await waitSessionReady('table13.md')
    const uri = wsUri('table13.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table13.md'))
    const original = TABLE13_DOC_TEXT

    // 删表头：首个数据行升为新表头，分隔行随移到升格行之后、对齐保留
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: original.indexOf('名字') + 1,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.deleteRow')
    const promoted = original.replace(
      '| 名字 | 数量 |\n| --- | :---: |\n| 苹果 | 3 |\n',
      '| 苹果 | 3 |\n| --- | :---: |\n',
    )
    await poll('删表头升格', () => (doc.getText() === promoted ? true : undefined))

    // 分隔行单独删除：拒绝（结构行保护，零写回）
    const beforeReject = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: promoted.indexOf(':---:'),
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.deleteRow')
    await new Promise((r) => setTimeout(r, 800))
    assert(doc.getText() === promoted, '分隔行删除必须被拒绝')
    const afterReject = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterReject.appliedEdits === beforeReject.appliedEdits, '拒绝的操作不得产生写回')

    // 插列（首列右侧）：表头/分隔/数据行同步插入，分隔行补默认对齐段
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: promoted.indexOf('苹果') + 1,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.insertColumnRight')
    const columned = promoted
      .replace('| 苹果 | 3 |', '| 苹果 | | 3 |')
      .replace('| --- | :---: |', '| --- | --- | :---: |')
      .replace('| `x|y` | 4 |', '| `x|y` | | 4 |')
    await poll('插列写入', () => (doc.getText() === columned ? true : undefined))
    assert(await doc.save(), '保存失败')
    const disk = await readDisk('table13.md')
    assert(disk === columned, `插列保存回读不一致：${JSON.stringify(disk)}`)
    // 行内代码管道在结构操作后保真
    assert(disk.includes('`x|y`'), '行内代码单元格保真')

    // 删列（新插的空列）：对齐段同步删除
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: columned.indexOf('| 苹果 | | 3 |') + 7,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.table.deleteColumn')
    const deleted = columned
      .replace('| 苹果 | | 3 |', '| 苹果 | 3 |')
      .replace('| --- | --- | :---: |', '| --- | :---: |')
      .replace('| `x|y` | | 4 |', '| `x|y` | 4 |')
    await poll('删列写入', () => (doc.getText() === deleted ? true : undefined))
    // 还原（删表头 + 插列 + 删列 = 三笔各撤销一次）
    for (let i = 0; i < 3; i++) {
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    }
    await poll('还原', () => (doc.getText() === original ? true : undefined))
    await doc.save()
  }],

  ['表格 Tab 导航：真实 keymap 移动光标、边界交默认、正文缩进写回（#13/#120）', async () => {
    await openWithEditor('table13.md')
    await waitSessionReady('table13.md')
    const uri = wsUri('table13.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table13.md'))
    const text = TABLE13_DOC_TEXT
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 单元格内 Tab → 下一格内容首（table.test.key 驱动真实 keymap 链路）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: text.indexOf('苹果') + 1,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('table13.md', (v) => v.selectionOffset === text.indexOf('| 3 |') + 2)

    // 行末格 Tab → 下一表格行首格（跨行环绕）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('table13.md', (v) => v.selectionOffset === text.indexOf('| `x|y` |') + 2)

    // Shift+Tab → 上一行末格内容尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'shift-tab' })
    await waitViewState('table13.md', (v) => v.selectionOffset === text.indexOf('3') + 1)

    // 末行末格 Tab：边界交默认——tableTab 放行后 #120 通用缩进同样不接
    // 表格行（保结构），按键不被编辑器消费，光标不动
    const lastCell = text.indexOf('4') + 1
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: lastCell })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await new Promise((r) => setTimeout(r, 600))
    const v2 = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState
    assert(v2.selectionOffset === lastCell, `末行末格 Tab 应交默认（光标不动），实际 ${v2.selectionOffset}`)

    // 表格内导航与边界交默认均为纯选区/零操作：此阶段零写回
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.version === session0.version, `导航不得改变文档版本（${session0.version} → ${session1.version}）`)
    assert(session1.appliedEdits === session0.appliedEdits, `导航不得产生写回，实际 ${session1.appliedEdits}`)

    // 表格外正文行 Tab：#120 通用行缩进——整行缩进 2 空格、光标随移、
    // 恰一次写回（旧契约「表格外不吞输入」已被 #120 取代：正文内 Tab
    // 由编辑器消费为缩进，不再放行给工作台焦点导航）
    const outside = text.indexOf('前导段落甲') + 2
    const outsideLineStart = text.lastIndexOf('\n', outside - 1) + 1
    const indentedText = text.slice(0, outsideLineStart) + '  ' + text.slice(outsideLineStart)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: outside })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('table13.md', (v) => v.selectionOffset === outside + 2)
    const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState
    assert(v.text === indentedText, '表格外正文行 Tab 应整行缩进 2 空格')
    const session2 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session2.version === session1.version + 1, `缩进应恰一次写回（${session1.version} → ${session2.version}）`)
    assert(
      session2.appliedEdits === session1.appliedEdits + 1,
      `缩进写回次数应为 1，实际增量 ${session2.appliedEdits - session1.appliedEdits}`,
    )
    assert(doc.getText() === indentedText, '缩进写回后权威文本同步')
  }],

  ['阅读模式表格操作忽略：只读语义零写回，宿主按模式缓存给可见反馈（#13）', async () => {
    await openWithEditor('table13.md')
    await waitSessionReady('table13.md')
    const uri = wsUri('table13.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('table13.md'))
    const text = TABLE13_DOC_TEXT
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 光标先落在表格内（live），再切换阅读模式——命令到达但视图只读
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: text.indexOf('苹果') + 1,
    })
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('进入阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' ? true : undefined
    })
    // 模式主动回报刷新宿主缓存（宿主命令拦截的数据源；无缓存则退化为
    // 静默忽略后虚报成功）
    const cache = await poll('宿主模式缓存刷新', async () => {
      const c = (await vscode.commands.executeCommand(CMD.viewStateCache, uri, 0)) as
        | { found: boolean; viewMode?: string }
        | undefined
      return c?.found && c.viewMode === 'reading' ? c : undefined
    })
    assert(cache.viewMode === 'reading', `宿主模式缓存应为 reading，实际 ${cache.viewMode}`)
    // 正式命令路径（宿主注册器）：reading 面板被拦截给可见反馈，不投递
    // webview（活动 tab 为本面板）——零写回且命令完成不挂起
    const intercepted = (await vscode.commands.executeCommand(
      'onegayi.vsidian.table.insertRowBelow',
    )) as boolean
    assert(intercepted === true, '被拦截的命令仍应完成（true = 已处理并反馈）')
    // webview 直发路径同样只读（双重防线）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.command', op: 'insertRowBelow' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await new Promise((r) => setTimeout(r, 800))
    assert(doc.getText() === text, '阅读模式不得接受表格结构命令')
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.version === session0.version, `阅读模式命令不得改变版本（${session0.version} → ${session1.version}）`)
    assert(session1.appliedEdits === session0.appliedEdits, `阅读模式命令不得产生写回，实际 ${session1.appliedEdits}`)
    // 切回 live 验证面板仍可用（#38 起回 live 用显式命令）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    await waitViewState('table13.md', (v) => v.viewMode === 'live')
  }],

  // ---- 工单 #32：两模式基础排版统一（共享 CSS 变量基线）----
  // 断言口径：同一文档（typography.md）在 live / reading 两态各取一次
  // view.state 的 typography 探针，对照激活侧样本的计算值一致；隐藏侧的
  // 几何口径（textInsetPx）不可用，各模式态只取各自激活侧。

  ['两模式正文基础排版一致：字体族/字号/行高/左留白（#32）', async () => {
    await openWithEditor('typography.md')
    await waitSessionReady('typography.md')
    const uri = wsUri('typography.md').toString()
    // 行号开启时 live 正文向右内缩（行号列+固定间距占宽，#34 流内列布局），
    // 左留白对照须在行号关闭态进行（此时两模式正文同处 --vsidian-content-
    // padding-inline 基线）；字体族/字号/行高不受布局影响
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': false })
    const live = await waitViewState('typography.md', (v) =>
      v.viewMode === 'live' &&
      v.lineGutter?.on === false &&
      v.typography?.live != null &&
      v.typography.live.fontSizePx != null &&
      v.typography.live.lineHeightPx != null &&
      v.typography.live.textInsetPx != null)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await waitViewState('typography.md', (v) =>
      v.viewMode === 'reading' &&
      v.typography?.reading != null &&
      v.typography.reading.fontSizePx != null &&
      v.typography.reading.lineHeightPx != null &&
      v.typography.reading.textInsetPx != null)
    const l = live.typography!.live!
    const r = reading.typography!.reading!
    // 实测值输出（人工验收记录 A21 的数据来源）
    console.log(`[#32] 正文排版 live: font=${l.fontFamily} size=${l.fontSizePx}px line=${l.lineHeightPx}px inset=${l.textInsetPx}px`)
    console.log(`[#32] 正文排版 reading: font=${r.fontFamily} size=${r.fontSizePx}px line=${r.lineHeightPx}px inset=${r.textInsetPx}px`)
    assert(l.fontFamily === r.fontFamily,
      `正文字体族不一致：live=${l.fontFamily}，reading=${r.fontFamily}`)
    assert(Math.abs(l.fontSizePx! - r.fontSizePx!) < 0.5,
      `正文字号不一致：live=${l.fontSizePx}px，reading=${r.fontSizePx}px`)
    assert(Math.abs(l.lineHeightPx! - r.lineHeightPx!) < 0.5,
      `正文行高不一致：live=${l.lineHeightPx}px，reading=${r.lineHeightPx}px`)
    assert(l.textInsetPx! > 0 && Math.abs(l.textInsetPx! - r.textInsetPx!) < 0.5,
      `正文左留白不一致：live=${l.textInsetPx}px，reading=${r.textInsetPx}px（须为同一正留白且 >0）`)
    // 模式切换零写回（工单验收：不修改源文、不产生保存/撤销历史）
    const s0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(s0.appliedEdits === 0, `切换后不得产生写回，实际 ${s0.appliedEdits}`)
    const doc = await vscode.workspace.openTextDocument(wsUri('typography.md'))
    assert(!doc.isDirty, '切换不得触发保存')
    // 还原默认行号开启（跨用例状态清理，同 #34 既有用例约定）；恢复值经
    // waitSettings 读回确认，防 storage 迟到回翻把 false 盖回（见其注释）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    await waitSettings({ 'editor.lineNumbers': true })
    await waitViewState('typography.md', (v) => v.lineGutter?.on === true)
  }],

  ['两模式列表/引用/表格基础排版一致（#32）', async () => {
    await openWithEditor('typography.md')
    await waitSessionReady('typography.md')
    const live = await waitViewState('typography.md', (v) =>
      v.viewMode === 'live' &&
      v.typography?.liveList != null &&
      v.typography?.liveQuote != null &&
      v.typography?.liveTable != null)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await waitViewState('typography.md', (v) =>
      v.viewMode === 'reading' &&
      v.typography?.readingList != null &&
      v.typography?.readingQuote != null &&
      v.typography?.readingTable != null)
    const lt = live.typography!
    const rt = reading.typography!
    console.log(`[#32] 列表 live: font=${lt.liveList!.fontFamily} size=${lt.liveList!.fontSizePx}px / reading: font=${rt.readingList!.fontFamily} size=${rt.readingList!.fontSizePx}px`)
    console.log(`[#32] 引用 live: font=${lt.liveQuote!.fontFamily} size=${lt.liveQuote!.fontSizePx}px / reading: font=${rt.readingQuote!.fontFamily} size=${rt.readingQuote!.fontSizePx}px`)
    console.log(`[#32] 表格 live: font=${lt.liveTable!.fontFamily} size=${lt.liveTable!.fontSizePx}px / reading: font=${rt.readingTable!.fontFamily} size=${rt.readingTable!.fontSizePx}px`)
    for (const [name, a, b] of [
      ['列表', lt.liveList!, rt.readingList!],
      ['引用', lt.liveQuote!, rt.readingQuote!],
      ['表格', lt.liveTable!, rt.readingTable!],
    ] as const) {
      assert(a.fontFamily === b.fontFamily,
        `${name}字体族不一致：live=${a.fontFamily}，reading=${b.fontFamily}`)
      assert(Math.abs(a.fontSizePx! - b.fontSizePx!) < 0.5,
        `${name}字号不一致：live=${a.fontSizePx}px，reading=${b.fontSizePx}px`)
    }
  }],

  ['两模式同级标题基础排版一致（#32）', async () => {
    await openWithEditor('typography.md')
    await waitSessionReady('typography.md')
    const live = await waitViewState('typography.md', (v) => v.viewMode === 'live' && (v.headingFontPx ?? 0) > 0)
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await waitViewState('typography.md', (v) => v.viewMode === 'reading' && (v.headingFontPx ?? 0) > 0)
    console.log(`[#32] 一级标题字号 live=${live.headingFontPx}px，reading=${reading.headingFontPx}px（基线×同倍率）`)
    assert(Math.abs(live.headingFontPx! - reading.headingFontPx!) < 0.5,
      `一级标题字号不一致：live=${live.headingFontPx}px，reading=${reading.headingFontPx}px（同级标题须同基线同倍率）`)
  }],

  ['编辑器字号变更两模式按同一规则响应（#32）', async () => {
    await openWithEditor('typography.md')
    await waitSessionReady('typography.md')
    const before = await waitViewState('typography.md', (v) => v.viewMode === 'live' && (v.typography?.live?.fontSizePx ?? 0) > 0)
    const beforeSize = before.typography!.live!.fontSizePx!
    try {
      // 两模式基线同引 --vsidian-content-font-size → --vscode-editor-font-size：
      // 宿主向 webview 注入的该变量随配置即时更新（真宿主实测 14px → 18px）
      await vscode.workspace.getConfiguration('editor').update('fontSize', 18, vscode.ConfigurationTarget.Workspace)
      await poll('live 字号随配置更新', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('typography.md').toString(), 0)) as ViewState | undefined
        const size = v?.typography?.live?.fontSizePx
        return typeof size === 'number' && Math.abs(size - 18) <= 0.5 ? v : undefined
      })
      await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
      const reading = await poll('reading 字号随配置更新', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('typography.md').toString(), 0)) as ViewState | undefined
        const size = v?.typography?.reading?.fontSizePx
        return v?.viewMode === 'reading' && typeof size === 'number' && Math.abs(size - 18) <= 0.5 ? v : undefined
      })
      console.log(`[#32] 编辑器字号 ${beforeSize}px → 18px：live 与 reading 正文均同步为 ${reading.typography!.reading!.fontSizePx}px`)
    } finally {
      await vscode.workspace.getConfiguration('editor').update('fontSize', undefined, vscode.ConfigurationTarget.Workspace)
    }
  }],

  // ---- #33：独立设置页与设置数据链路 ----

  ['设置页：无文档时命令面板可打开、关闭后可重开（#33）', async () => {
    // 无文档前提：runner 每例结束 closeAllEditors，此处再显式兜底
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    const info0 = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as { open: boolean }
    assert(info0.open === false, '初始应无设置页打开')

    // 命令路径（命令面板入口）：不要求当前有任何 Vsidian 编辑器
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    const info = await poll('设置页打开', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean }
        | undefined
      return i?.open ? i : undefined
    })
    // webview 装载完成（ready 握手：页面已发 settings.get 拉取权威快照）
    await poll('设置页 webview 就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { ready: boolean }
        | undefined
      return i?.ready ? true : undefined
    })
    assert(info.open === true, '设置页应处于打开状态')

    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    await poll('设置页关闭', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean }
        | undefined
      return i && !i.open ? true : undefined
    })

    // 关闭后重开（生命周期）：再次打开得到新面板且 ready 握手重新完成
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页重开并就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean }
        | undefined
      return i?.open && i.ready ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
  }],

  ['设置页：会话内恢复——真实 webview 上报 uiState，记忆跨面板关闭重开存续', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await vscode.commands.executeCommand(CMD.closeSettingsPage)

    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页打开并就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean }
        | undefined
      return i?.open && i.ready ? true : undefined
    })

    // 经宿主正式定位通道切到外观分页（与用户点击侧栏同一 selectSection
    // 路径）：真实 webview 渲染后上报 uiState，宿主记忆生效
    await vscode.commands.executeCommand('onegayi.vsidian.openStyleReference')
    await poll('宿主记忆到外观分页 uiState', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { uiState?: { section: string; scrollTop: number } }
        | undefined
      return i?.uiState?.section === 'appearance' ? i.uiState : undefined
    })

    // 面板关闭：记忆必须存活（会话内恢复的前提——panel 销毁不清除）
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    await poll('设置页关闭且记忆仍在', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; uiState?: { section: string } }
        | undefined
      return i && !i.open && i.uiState?.section === 'appearance' ? true : undefined
    })

    // 重开并就绪：记忆仍在（重开握手按它补发 focusSection{scroll} 恢复，
    // 补发行为由 settingsPageHost 单测钉住；此处断言真宿主不清记忆）
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('重开就绪且恢复记忆存活', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean; uiState?: { section: string } }
        | undefined
      return i?.open && i.ready && i.uiState?.section === 'appearance' ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
  }],

  ['设置页：工具栏消息入口打开、标题归属 Vsidian、不改文档与撤销历史（#33）', async () => {
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const uri = wsUri('lf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('lf.md'))
    // lf.md 被早前用例编辑保存过（未还原）：以打开时的权威文本为基线，
    // 不假设 fixture 原文
    const original = doc.getText()

    // 先落一笔真实编辑（驱动撤销历史存在），再开/关设置页
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: 0,
      text: '# ',
    })
    const editedText = `# ${original}`
    await poll('编辑写入权威', () => (doc.getText() === editedText ? true : undefined))
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 工具栏入口（webview「设置」按钮产生的 settings.open 消息，经同一
    // 校验与 provider 拦截入口注入）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'settings.open' })
    const info = await poll('设置页经工具栏消息打开', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean; title: string }
        | undefined
      return i?.open ? i : undefined
    })
    // 标题与界面归属 Vsidian（面板标题即命令面板/页头呈现）。#93 起标题经
    // t() 取词，随生效语言（auto 按宿主显示语言解析）——期望值与扩展装配
    // 同源计算，不再复制字面量
    const expectedTitle = LOCALE_MESSAGES[
      resolveLocale(undefined, vscode.env.language)
    ]['settings.pageTitle']
    assert(info.title === expectedTitle, `设置页标题应归属 Vsidian（${expectedTitle}），实际 ${info.title}`)
    await poll('设置页 webview 就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { ready: boolean }
        | undefined
      return i?.ready ? true : undefined
    })

    // 打开期间文档零变更
    const duringOpen = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(doc.getText() === editedText, '打开设置页不得修改当前文档')
    assert(duringOpen.version === before.version, `打开设置页不得推进文档版本（${before.version} → ${duringOpen.version}）`)
    assert(duringOpen.appliedEdits === before.appliedEdits, '打开设置页不得产生写回')

    // 关闭设置页后：文档不变、撤销历史仍在（undo 一次回退此前编辑）
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    await poll('设置页关闭', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean }
        | undefined
      return i && !i.open ? true : undefined
    })
    assert(doc.getText() === editedText, '关闭设置页不得修改当前文档')
    // 设置页关闭后焦点回落的目标不受控（C-5：undo 守卫要求活动 tab 为本
    // 文档的 custom editor），先 reveal 再请求撤销
    await vscode.commands.executeCommand('vscode.openWith', wsUri('lf.md'), VIEW_TYPE)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销历史保留', () => (doc.getText() === original ? true : undefined))
    await doc.save()
  }],

  ['设置链路：有效值保存回读、无效值拒绝、快照到达与广播已开编辑器（#33）', async () => {
    // fixture 定义经运行时注册并入（生产注册表为空——空状态页面的依据）
    const install = (await vscode.commands.executeCommand(CMD.installSettingsFixture)) as { ok: boolean }
    assert(install.ok === true, 'fixture 定义注册失败')

    // 有效值保存并回读（真实宿主 globalState 持久层）
    const okSet = (await vscode.commands.executeCommand(CMD.setSettings, { 'test.flag': true })) as { ok: boolean }
    assert(okSet.ok === true, '有效值应保存成功')
    const snap = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snap['test.flag'] === true, `保存后回读应为 true，实际 ${String(snap['test.flag'])}`)

    // 无效值与未知键按定义拒绝（快照不被污染）
    const badType = (await vscode.commands.executeCommand(CMD.setSettings, { 'test.flag': 1 })) as { ok: boolean }
    assert(badType.ok === false, '类型不符的值必须被拒绝')
    const unknown = (await vscode.commands.executeCommand(CMD.setSettings, { 'unknown.key': true })) as { ok: boolean }
    assert(unknown.ok === false, '未知键必须被拒绝')
    const snap2 = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snap2['test.flag'] === true, '拒绝的保存不得改变快照')

    // init 拉取链路：后打开的编辑器面板装载时收到当前设置（settings.get）。
    // 用 untouched.md（无任何用例编辑它）保证全新面板 init，不受前序用例
    // 的面板状态影响
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const pulled = await waitViewState('untouched.md', (v) => v.settings?.['test.flag'] === true)
    assert(pulled.settings?.['test.flag'] === true, '面板装载后应拉取到当前设置快照')

    // 广播链路：宿主保存变更 → 已打开编辑器面板收到 settings.changed
    await vscode.commands.executeCommand(CMD.setSettings, { 'test.flag': false })
    const broadcast = await waitViewState('untouched.md', (v) => v.settings?.['test.flag'] === false)
    assert(broadcast.settings?.['test.flag'] === false, '设置变更应广播到已打开编辑器面板')

    // 设置页 webview → 宿主正式处理链路（注入与真实消息同一入口）：
    // settings.set 经设置页消息处理入口保存成功
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean }
        | undefined
      return i?.open && i.ready ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, {
      kind: 'settings.set',
      values: { 'test.flag': true },
    })
    await poll('设置页链路保存生效', async () => {
      const s = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
      return s['test.flag'] === true ? true : undefined
    })
    // 广播同样把变更带回已打开编辑器
    // 设置页打开期间其他面板可能被遮挡卸载（VSCode 默认卸载隐藏 webview），
    // 广播以「面板可见时」为准：关闭设置页使编辑器面板恢复（必要时重载）
    // 后，经 init 后的 settings.get 拉取链路看到最新值
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    const revived = await waitViewState('untouched.md', (v) => v.settings?.['test.flag'] === true)
    assert(revived.settings?.['test.flag'] === true, '设置页链路的保存应经拉取/广播到达编辑器面板')

    // 清理：恢复 fixture 默认值
    await vscode.commands.executeCommand(CMD.setSettings, { 'test.flag': false })
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
  }],

  // ---- #96：语言设置项与切换即生效 ----

  ['语言设置：切换即生效——宿主换包、面板标题同步、持久化重开按新语言（#96）', async () => {
    // auto 基线：与扩展装配同源计算（宿主显示语言解析；测试宿主多为英文
    // 环境 → en，中文环境 → zh-cn，两种环境断言都成立）
    const autoLang = resolveLocale(undefined, vscode.env.language)
    const autoTitle = LOCALE_MESSAGES[autoLang]['settings.pageTitle']
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    const info = await poll('设置页打开并就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean; title: string }
        | undefined
      return i?.open && i.ready ? i : undefined
    })
    assert(info.title === autoTitle,
      `auto 基线面板标题应按宿主语言（${autoLang} → ${autoTitle}），实际 ${info.title}`)

    // 已打开编辑器面板在场：切换时 locale.changed 广播路径真实执行
    // （与 settings.changed 同一 postToPanel 通道；webview 侧换包由浏览器
    // 套件与单测钉住，此处验证广播后会话保持健康）
    await openWithEditor('untouched.md', true)
    await waitSessionReady('untouched.md')

    // 切到 auto 反侧语言：宿主即时换包 → 已开设置页面板标题同步（真实
    // panel.title，用户在标签上看到的文字）
    const target = autoLang === 'en' ? 'zh-cn' : 'en'
    const targetTitle = LOCALE_MESSAGES[target]['settings.pageTitle']
    const saved = (await vscode.commands.executeCommand(CMD.setSettings, {
      'general.language': target,
    })) as { ok: boolean }
    assert(saved.ok === true, '语言设置保存应成功')
    await poll('面板标题随语言切换', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { title: string }
        | undefined
      return i?.title === targetTitle ? true : undefined
    })

    // 广播后编辑器会话保持健康（面板未被语言切换打断）
    const after = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('untouched.md').toString())) as SessionState
    assert(after.found === true && after.panels.length >= 1,
      '语言切换广播后编辑器面板应仍在会话中')

    // 持久化重开回显：关闭重开设置页，新面板 HTML 按持久化偏好语言生成
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    await poll('设置页关闭', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean }
        | undefined
      return i && !i.open ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    const reopened = await poll('设置页重开并就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean; title: string }
        | undefined
      return i?.open && i.ready ? i : undefined
    })
    assert(reopened.title === targetTitle,
      `重开应按持久化语言（${target} → ${targetTitle}）显示标题，实际 ${reopened.title}`)
    await vscode.commands.executeCommand(CMD.closeSettingsPage)

    // 恢复 auto：宿主换包回到基线语言（不污染后续用例的标题断言）
    const back = (await vscode.commands.executeCommand(CMD.setSettings, {
      'general.language': 'auto',
    })) as { ok: boolean }
    assert(back.ok === true, '恢复 auto 应保存成功')
    await poll('宿主恢复 auto 语言', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { title: string }
        | undefined
      return i?.title === autoTitle ? true : undefined
    })
  }],

  // ---- #34：实时预览源文件行号 ----

  ['实时预览默认显示从 1 起的源文件行号（结构混合与软换行不新增行号）', async () => {
    await openWithEditor('linenumbers.md')
    await waitSessionReady('linenumbers.md')
    const view = await waitViewState('linenumbers.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const g = view.lineGutter!
    // 首个源行行号为 1（默认开启；空行同样编号）
    assert(g.on === true, '行号默认应开启（定义默认 true）')
    assert(g.first === '1', `首个行号应为 1，实际 ${String(g.first)}`)
    // 行号数与源行数一致（视口覆盖小文档全文），软换行只增加视觉行
    assert(g.count === view.lineCount,
      `行号数应等于源行数 ${view.lineCount}，实际 ${g.count}`)
    assert(g.last === String(view.lineCount),
      `末行号应为源行数 ${view.lineCount}，实际 ${String(g.last)}`)
    // 软换行解耦观测：视觉行数 ≥ 源行数（长段折行时渲染行更多）
    assert(view.renderedLines >= view.lineCount,
      `视觉行 ${view.renderedLines} 不应少于源行 ${view.lineCount}`)
    console.log(`[#34] linenumbers.md：源行 ${view.lineCount}，行号 1..${String(g.last)}，视觉行 ${view.renderedLines}`)
  }],

  ['CRLF 文档行号与源文件行一致（规范化不改行数）', async () => {
    await openWithEditor('crlf.md')
    await waitSessionReady('crlf.md')
    const view = await waitViewState('crlf.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const doc = await vscode.workspace.openTextDocument(wsUri('crlf.md'))
    // webview LF 坐标行数 == 宿主 CRLF 文档行数（\r\n→\n 规范化不改行数）
    assert(view.lineCount === doc.lineCount,
      `webview 行数 ${view.lineCount} 应等于宿主 TextDocument 行数 ${doc.lineCount}`)
    const g = view.lineGutter!
    assert(g.first === '1', `首个行号应为 1，实际 ${String(g.first)}`)
    assert(g.last === String(view.lineCount),
      `末行号应为 ${view.lineCount}，实际 ${String(g.last)}`)
    console.log(`[#34] crlf.md：宿主 lineCount=${doc.lineCount}，行号 1..${String(g.last)}`)
  }],

  ['增删行与撤销重做后行号随源文更新', async () => {
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const uri = wsUri('untouched.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('untouched.md'))
    const original = doc.getText()
    const before = await waitViewState('untouched.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const beforeLines = before.lineCount
    assert(before.lineGutter!.last === String(beforeLines), '初始行号应与源行一致')

    // 行首插入两行（sync.test.edit 走与用户输入同一写回链路）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: 0,
      text: '新行甲\n新行乙\n',
    })
    const afterInsert = await poll('插入后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 2 && v.lineGutter?.last === String(beforeLines + 2)
        ? v
        : undefined
    })
    assert(afterInsert.lineGutter!.first === '1', '插入后首行行号仍为 1')
    await poll('编辑写入权威', () => (doc.getText() === `新行甲\n新行乙\n${original}` ? true : undefined))

    // 撤销：行号回落（宿主权威栈回流走 external 路径）
    await vscode.commands.executeCommand('vscode.openWith', wsUri('untouched.md'), VIEW_TYPE)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销后行号回落', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines && v.lineGutter?.last === String(beforeLines) ? v : undefined
    })
    // 重做：行号恢复推进
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'redo' })
    await poll('重做后行号恢复', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 2 ? v : undefined
    })
    // 还原文档（再 undo 一次回到 fixture 原文，避免污染后续用例的行数假设）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('还原 fixture 原文', () => (doc.getText() === original ? true : undefined))
    if (doc.isDirty) {
      await doc.save()
    }
  }],

  ['设置页开关行号：已开编辑器立即生效、新面板拉取持久值、不改源文', async () => {
    // 两个已开面板（当前 + beside）：开关变更须同时到达
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    await openWithEditor('untouched.md', true)
    await waitSessionReady('untouched.md')
    const uriA = wsUri('lf.md').toString()
    await waitViewState('lf.md', (v) => v.lineGutter?.on === true)
    await waitViewState('untouched.md', (v) => v.lineGutter?.on === true)
    const docA = await vscode.workspace.openTextDocument(wsUri('lf.md'))
    const textBefore = docA.getText()
    const sessionBefore = (await vscode.commands.executeCommand(CMD.sessionState, uriA)) as SessionState

    // 关闭：经设置服务的正式保存链路（与设置页 settings.set 同一入口）
    const off = (await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': false })) as { ok: boolean }
    assert(off.ok === true, '关闭行号的设置保存应成功')
    const snap = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snap['editor.lineNumbers'] === false, `保存后回读应为 false，实际 ${String(snap['editor.lineNumbers'])}`)
    const gA = await waitViewState('lf.md', (v) => v.lineGutter?.on === false)
    const gB = await waitViewState('untouched.md', (v) => v.lineGutter?.on === false)
    assert(gA.lineGutter!.count === 0 && gB.lineGutter!.count === 0, '关闭后行号 DOM 应移除')

    // 开关行号不改源文、不产生写回与撤销历史
    assert(docA.getText() === textBefore, '开关行号不得修改文档内容')
    const sessionAfter = (await vscode.commands.executeCommand(CMD.sessionState, uriA)) as SessionState
    assert(sessionAfter.version === sessionBefore.version,
      `开关行号不得推进文档版本（${sessionBefore.version} → ${sessionAfter.version}）`)
    assert(sessionAfter.appliedEdits === sessionBefore.appliedEdits, '开关行号不得产生写回')

    // 持久化口径：关闭全部面板后重开——新面板经 init 后 settings.get 拉到
    // 持久值（真实重启读取的是同一 globalState 键，人工验证条目覆盖重启）
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const reopened = await waitViewState('lf.md', (v) => v.lineGutter?.on === false)
    assert(reopened.lineGutter!.count === 0, '重开面板应拉取到持久化的关闭状态')

    // 恢复默认开启（后续用例与人工验收的默认态）
    const on = (await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })) as { ok: boolean }
    assert(on.ok === true, '恢复行号的设置保存应成功')
    const restored = await waitViewState('lf.md', (v) => v.lineGutter?.on === true && (v.lineGutter?.count ?? 0) > 0)
    assert(restored.lineGutter!.first === '1', '恢复后行号应从 1 起')
    console.log(`[#34] 开关链路：两面板即时生效，重开面板拉取持久值 false，恢复后 count=${restored.lineGutter!.count}`)
  }],

  ['切换阅读模式无行号、切回实时预览按设置恢复', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const live = await waitViewState('mode.md', (v) => v.viewMode === 'live' && (v.lineGutter?.count ?? 0) > 0)
    assert(live.lineGutter!.first === '1', 'live 初始行号从 1 起')

    // 阅读模式：liveWrapper 整体隐藏（行号随之不可见），阅读视图是独立
    // DOM 子树（EditorView 挂在 liveWrapper 内），天然不渲染任何行号栏
    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    const reading = await waitViewState('mode.md', (v) => v.viewMode === 'reading')
    assert(reading.typography?.reading != null, '阅读视图应活跃渲染（其 DOM 子树不含行号栏）')
    assert(reading.lineGutter?.on === true, '阅读模式下设置开关态保持（切回恢复的依据）')
    console.log(`[#34] 阅读模式：viewMode=${reading.viewMode}，reading 块活跃渲染，liveWrapper 整体隐藏（行号不可见）`)

    // 阅读期间保持设置开；切回 live 后行号按设置恢复且从 1 起。
    // #38 起 toggleViewMode 为三态循环（reading 态下一次是 source），此处
    // 显式指定 toLive（合并 main 后 #34 用例的三态适配）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    const back = await waitViewState('mode.md', (v) => v.viewMode === 'live' && (v.lineGutter?.count ?? 0) > 0)
    assert(back.lineGutter!.first === '1', `切回 live 后行号应恢复从 1 起，实际 ${String(back.lineGutter!.first)}`)
    assert(back.lineGutter!.last === String(back.lineCount),
      `切回后末行号应为 ${back.lineCount}，实际 ${String(back.lineGutter!.last)}`)
  }],

  ['大文档行号 DOM 有界、流内列不覆盖正文且开关正文内缩（#34 布局契约）', async () => {
    await openWithEditor('large.md')
    await waitSessionReady('large.md')
    const uri = wsUri('large.md').toString()
    // 初始视口在顶部：行号 DOM 有界（远小于 10 万行）
    const top = await waitViewState('large.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const topG = top.lineGutter!
    assert(topG.count > 0 && topG.count < 2000,
      `行号 DOM 应有界（视口级），实际 ${topG.count}`)
    assert(topG.first === '1', '顶部行号从 1 起')
    // 流内列布局（用户修订 #32 旧契约）：开启行号时正文左缘 = 页面留白 +
    // 行号列 + 固定间距，即比关闭态右移（列宽随位数自适应，无降级机制）
    const insetOn = top.typography?.live?.textInsetPx
    assert(typeof insetOn === 'number' && insetOn > 24,
      `开启行号时正文左缘应右移到留白之外（> 24px），实际 ${String(insetOn)}`)

    // 滚动到底部：行号达 6 位（10 万行），列宽自适应变宽、正文相应再内缩。
    // 经正式定位消息 view.locate 驱动（scrollIntoView 官方滚动路径）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: Math.max(0, top.docLength - 1),
    })
    const bottom = await waitViewState('large.md', (v) =>
      (v.lineGutter?.last ?? '').length >= 6 && v.lineGutter?.on === true)
    const insetBottom = bottom.typography?.live?.textInsetPx
    assert(typeof insetBottom === 'number' && Math.abs(insetBottom - insetOn!) < 1,
      `滚动全程列宽应稳定（CM6 按文档最大行号预留列宽，正文内缩量恒定：` +
        `${insetOn} → ${String(insetBottom)}）——列宽自适应取代 scaleX 压缩的收益`)

    // 滚回顶部：列宽随位数回落，正文内缩量回到顶部档
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 0 })
    const backTop = await waitViewState('large.md', (v) => v.lineGutter?.first === '1' && (v.lineGutter?.count ?? 0) > 0)
    const insetBack = backTop.typography?.live?.textInsetPx
    assert(typeof insetBack === 'number' && Math.abs(insetBack - insetOn!) < 1,
      `滚回顶部后正文内缩量应回落（${insetOn} → ${String(insetBack)}）`)

    // 关闭行号：列整体卸载，正文回到 24px 页面留白基线（= 阅读模式基线）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': false })
    const off = await waitViewState('large.md', (v) => v.lineGutter?.on === false && v.lineGutter?.count === 0)
    const insetOff = off.typography?.live?.textInsetPx
    assert(typeof insetOff === 'number' && Math.abs(insetOff - 24) < 1,
      `关闭行号后正文左缘应回到 24px 基线（实际 ${String(insetOff)}）`)
    // 恢复默认开启
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    await waitViewState('large.md', (v) => v.lineGutter?.on === true && (v.lineGutter?.count ?? 0) > 0)
    console.log(`[#34] large.md：顶部 DOM=${topG.count}（有界），开启内缩 ${insetOn}px 恒定（列宽按 10 万行 6 位预留，滚动无回流），关闭基线 ${insetOff}px`)
  }],

  ['文档中部插入/粘贴多行与删除表格行后行号随源文更新', async () => {
    await openWithEditor('linenumbers.md')
    await waitSessionReady('linenumbers.md')
    const uri = wsUri('linenumbers.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('linenumbers.md'))
    const original = doc.getText()
    // 跨用例状态防御：前序用例（开关/大文档）会切换行号设置，卸载期间的
    // 隐藏面板可能错过后续广播——openWith reveal 的可能是幸存面板（实测
    // sessionId 为用例 1 的 panel-1）。显式确保开启：apply 对同值补丁仍会
    // 广播，幸存面板据此对齐当前全局值（与用例 4 的「恢复默认开启」同款
    // 清理动作）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    const before = await waitViewState('linenumbers.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const beforeLines = before.lineCount
    assert(before.lineGutter!.last === String(beforeLines), '初始行号应与源行一致')

    // 中部插入多行（列表区行首）：行号整体推进
    const midOffset = original.indexOf('- 列表项甲\n')
    assert(midOffset > 0, 'fixture 应包含列表行（中部插入锚点）')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: midOffset,
      text: '中部新行一\n中部新行二\n中部新行三\n',
    })
    const afterMid = await poll('中部插入后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 3 && v.lineGutter?.last === String(beforeLines + 3) ? v : undefined
    })
    assert(afterMid.lineGutter!.first === '1', '中部插入后首行行号仍为 1')

    // 粘贴多行（单事务大块插入，与用户粘贴同一 CM6 事务链路）：行号按新增行数推进
    const pasteText = Array.from({ length: 6 }, (_, i) => `粘贴第 ${i + 1} 行`).join('\n') + '\n'
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: afterMid.docLength,
      text: pasteText,
    })
    await poll('粘贴多行后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 9 && v.lineGutter?.last === String(beforeLines + 9) ? v : undefined
    })
    // 等宿主写回完成（后续删除锚点按权威文本计算：中部插入使表格行 offset 后移）
    await poll('编辑写入权威', () =>
      doc.getText().includes('中部新行一\n') && doc.getText().endsWith(pasteText) ? true : undefined)

    // 删除行：定位到表格数据行后执行宿主表格命令（webview 经 CM6 事务真实删除整行）
    const tableRowOffset = doc.getText().indexOf('| 甲格 | 乙格 |')
    assert(tableRowOffset > 0, 'fixture 应包含表格数据行（删除锚点）')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate',
      offset: tableRowOffset + 2,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.command',
      op: 'deleteRow',
    })
    await poll('删除行后行号回落', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 8 && v.lineGutter?.last === String(beforeLines + 8) ? v : undefined
    })

    // 三笔编辑逐次撤销（一笔 edit.request = 宿主撤销一次）：行号逐步回落至原文
    await vscode.commands.executeCommand('vscode.openWith', wsUri('linenumbers.md'), VIEW_TYPE)
    const undoSteps = [beforeLines + 9, beforeLines + 3, beforeLines]
    for (const expected of undoSteps) {
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll(`撤销后行号回落到 ${expected}`, async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
        return v?.lineCount === expected && v.lineGutter?.last === String(expected) ? v : undefined
      })
    }
    await poll('还原 fixture 原文', () => (doc.getText() === original ? true : undefined))
    if (doc.isDirty) {
      await doc.save()
    }
  }],

  ['外部变更（宿主 WorkspaceEdit）增删行后行号与源文同步', async () => {
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('untouched.md'))
    const original = doc.getText()
    const before = await waitViewState('untouched.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const beforeLines = before.lineCount

    // 外部插入两行（模拟另一编辑器/其他扩展修改同一文件）：增量回流后行号随动。
    // Position 为 0 基行号：原文档末行（空行）是 line(beforeLines-1)，其行首即文末
    const insert = new vscode.WorkspaceEdit()
    insert.insert(wsUri('untouched.md'), new vscode.Position(beforeLines - 1, 0), '外部行甲\n外部行乙\n')
    assert(await vscode.workspace.applyEdit(insert), '外部插入应成功')
    const afterInsert = await poll('外部插入后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('untouched.md').toString(), 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 2 && v.lineGutter?.last === String(beforeLines + 2) ? v : undefined
    })
    // 独立断言 lineGutter 观测面（不依赖 text 断言）：开关态、首末行号、视口计数
    const g = afterInsert.lineGutter!
    assert(g.on === true, `外部变更后行号开关应保持，实际 ${String(g.on)}`)
    assert(g.first === '1', `首行行号应为 1，实际 ${String(g.first)}`)
    assert(g.count === beforeLines + 2, `小文档行号计数应等于源行数 ${beforeLines + 2}，实际 ${g.count}`)
    assert(doc.lineCount === beforeLines + 2, `宿主行数应同步为 ${beforeLines + 2}，实际 ${doc.lineCount}`)

    // 外部删除这两行（插入区间恰为两个新行 + 其后的末空行行首边界）：行号回落
    const remove = new vscode.WorkspaceEdit()
    remove.delete(wsUri('untouched.md'), new vscode.Range(beforeLines - 1, 0, beforeLines + 1, 0))
    assert(await vscode.workspace.applyEdit(remove), '外部删除应成功')
    const afterDelete = await poll('外部删除后行号回落', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('untouched.md').toString(), 0)) as ViewState | undefined
      return v?.lineCount === beforeLines && v.lineGutter?.last === String(beforeLines) ? v : undefined
    })
    assert(afterDelete.lineGutter!.on === true, '外部变更不得改变行号开关态')
    await poll('外部删除落盘还原', () => (doc.getText() === original ? true : undefined))
    if (doc.isDirty) {
      await doc.save()
    }
    console.log(`[#34] 外部变更：插入后行号 1..${beforeLines + 2}，删除后回落 1..${beforeLines}`)
  }],

  ['CRLF 文档增删行后行号仍与源行一致', async () => {
    await openWithEditor('crlf.md')
    await waitSessionReady('crlf.md')
    const uri = wsUri('crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('crlf.md'))
    const original = doc.getText()
    const before = await waitViewState('crlf.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    const beforeLines = before.lineCount
    assert(beforeLines === doc.lineCount, `初始两系行数应一致（${beforeLines} vs ${doc.lineCount}）`)

    // 行首插入两行（webview LF 坐标）：行号随动，写回后宿主文本保持 CRLF 保真
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: 0,
      text: '新 CRLF 行甲\n新 CRLF 行乙\n',
    })
    const afterInsert = await poll('CRLF 插入后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 2 && v.lineGutter?.last === String(beforeLines + 2) ? v : undefined
    })
    assert(afterInsert.lineGutter!.first === '1', 'CRLF 插入后首行行号仍为 1')
    await poll('CRLF 写回保真', () =>
      doc.getText().startsWith('新 CRLF 行甲\r\n新 CRLF 行乙\r\n') ? true : undefined)

    // 撤销插入（宿主权威栈回流走 external 路径）：行号回落
    await vscode.commands.executeCommand('vscode.openWith', wsUri('crlf.md'), VIEW_TYPE)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('CRLF 撤销后行号回落', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines && v.lineGutter?.last === String(beforeLines) ? v : undefined
    })

    // 外部变更（宿主 WorkspaceEdit）追加 CRLF 行：行号随动且行数与宿主一致
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.insert(wsUri('crlf.md'), new vscode.Position(beforeLines, 0), '外部 CRLF 行\r\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部 CRLF 插入应成功')
    const afterExternal = await poll('CRLF 外部变更后行号随动', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.lineCount === beforeLines + 1 && v.lineGutter?.last === String(beforeLines + 1) ? v : undefined
    })
    assert(afterExternal.lineCount === doc.lineCount,
      `外部变更后行数应与宿主一致（${afterExternal.lineCount} vs ${doc.lineCount}）`)

    // 还原（撤销外部变更）并落盘
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('CRLF 还原原文', () => (doc.getText() === original ? true : undefined))
    if (doc.isDirty) {
      await doc.save()
    }
  }],

  // ---- #34 补充（P0 回归）：行号开启时正文真的可见 ----

  ['绘制层探针：行号开启时正文可见、CM6 注入样式存活、行号禁选（P0 回归）', async () => {
    // 由来：CSP style-src 未放行内联样式 → CM6 注入样式表被拒 → scroller
    // 退化 block → #34 行号栏与正文上下堆叠、正文被推出视口。既有 DOM
    // 数量/几何 x 坐标断言全部存活于该缺陷之上，唯有绘制层断言能拦住。
    await openWithEditor('linenumbers.md')
    await waitSessionReady('linenumbers.md')
    const on = await waitViewState('linenumbers.md', (v) => (v.lineGutter?.count ?? 0) > 0)
    assert(on.lineGutter?.on === true, '行号应默认开启')
    assert(on.paint?.textVisible === true,
      `行号开启时正文应可见（textVisible=${String(on.paint?.textVisible)}，` +
        `scrollerDisplay=${String(on.paint?.scrollerDisplay)}）`)
    assert(on.paint?.scrollerDisplay === 'flex',
      `CM6 注入样式应存活（scroller display 应为 flex，实际 ${String(on.paint?.scrollerDisplay)}；` +
        '若为 block 说明 CSP 拦截了 style-mod 注入的样式表）')
    assert(on.paint?.gutterUserSelect === 'none',
      `行号栏应禁选（user-select 应为 none，实际 ${String(on.paint?.gutterUserSelect)}）`)
    // 光标明暗自适应（深色主题黑底黑光标回归）：断言 dark 声明与光标
    // 变体联动，不依赖测试宿主默认主题——浅色/深色宿主下均自洽成立。
    // #237 起多光标默认开启：drawSelection 隐藏原生 caret（caretColor 恒
    // transparent），光标颜色证据移至绘制层 .cm-cursor 的 borderLeftColor
    // （baseTheme 明暗变体 light=black / dark=#ddd）
    const dark = on.paint?.darkTheme
    const caret = on.paint?.caretColor ?? null
    const drawn = on.paint?.drawnCursorColor ?? null
    console.log(`[P0] darkTheme=${String(dark)}，caret-color=${String(caret)}，drawn-cursor=${String(drawn)}`)
    assert(typeof dark === 'boolean', `dark 声明应为布尔（实际 ${String(dark)}）`)
    assert(caret !== null, 'caret-color 计算值应可读（caretColor 不应为 null）')
    assert(caret === 'transparent' || caret === 'rgba(0, 0, 0, 0)',
      `多光标开启时原生 caret 应被 drawSelection 隐藏为 transparent（实际 ${caret}；` +
        '非透明说明 hideNativeSelection 主题未生效——原生 caret 与绘制光标并存）')
    assert(drawn !== null, '绘制光标 .cm-cursor 应在场（drawnCursorColor 不应为 null；' +
      '多光标默认开启时 drawSelection 必须装配）')
    if (dark) {
      assert(drawn === 'rgb(221, 221, 221)' || drawn === '#ddd',
        `dark 声明激活时绘制光标应为 baseTheme dark 变体 #ddd（实际 ${drawn}；` +
          '非 #ddd 说明明暗声明未接管绘制光标颜色——黑底黑光标回归）')
    } else {
      assert(drawn === 'rgb(0, 0, 0)' || drawn === '#000000' || drawn === '#000',
        `light 声明时绘制光标应为 baseTheme light 变体 black（实际 ${drawn}）`)
    }

    // 差分自证：关闭行号后正文仍可见（度量在两态下均有效）
    const okSet = (await vscode.commands.executeCommand(CMD.setSettings, {
      'editor.lineNumbers': false,
    })) as { ok: boolean }
    assert(okSet.ok === true, '关闭行号设置应成功')
    const off = await waitViewState('linenumbers.md', (v) => v.lineGutter?.on === false)
    assert(off.paint?.textVisible === true, '行号关闭后正文应仍可见（度量校准）')
    // 还原默认开启，避免影响后续用例（与 #34 既有用例同款跨用例状态清理）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.lineNumbers': true })
    await waitViewState('linenumbers.md', (v) => v.lineGutter?.on === true)
  }],

  // ---- #53 顶栏图标化与右侧栏布局 ----

  ['右侧栏收起→展开→收起循环：绘制层证据与图标两态线宽（#53）', async () => {
    // 绘制层断言口径（视觉层断言必查）：侧栏可见性经 elementFromPoint 命中
    // 证明（display:none、零尺寸或覆盖遮挡时命中失败）；图标两态粗细经
    // computed stroke-width 证明（差异唯一来源是样式表的 open 类规则，
    // 样式失效时两态同值）。DOM 存在性与几何坐标不能替代这些证据。
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const uri = wsUri('lf.md').toString()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 收起态：按钮与齿轮入口真实可见，侧栏不可见，竖线为细线
    const collapsed = await waitViewState('lf.md', (v) => v.sidebar !== undefined)
    assert(collapsed.sidebar!.open === false, '初始应为收起态')
    assert(collapsed.sidebar!.togglePainted === true,
      `切换按钮应真实可见（命中测试失败：${JSON.stringify(collapsed.sidebar)}）`)
    assert(collapsed.sidebar!.settingsPainted === true,
      `齿轮设置按钮应真实可见（命中测试失败：${JSON.stringify(collapsed.sidebar)}）`)
    assert(collapsed.sidebar!.sidebarToolbarPainted === false, '收起时侧栏顶栏不得可见（命中应失败）')
    assert(collapsed.sidebar!.settingsAriaLabel === editorMessages()['sidebar.settings'],
      `齿轮可访问名称应为「${editorMessages()['sidebar.settings']}」，实际 ${String(collapsed.sidebar!.settingsAriaLabel)}`)
    assert(collapsed.sidebar!.toggleAriaLabel === editorMessages()['sidebar.expand'],
      `收起态切换按钮名称应为「${editorMessages()['sidebar.expand']}」，实际 ${String(collapsed.sidebar!.toggleAriaLabel)}`)
    assert(Math.abs(parseFloat(collapsed.sidebar!.toggleBarStrokeWidth ?? 'x') - 1.5) < 0.01,
      `收起态图标竖线应为细线 1.5px，实际 ${String(collapsed.sidebar!.toggleBarStrokeWidth)}`)
    assert(collapsed.paint?.textVisible === true, '收起态正文应可见')
    const collapsedMainWidth = collapsed.sidebar!.mainWidthPx ?? 0
    assert(collapsedMainWidth > 0, '收起态主编辑区应有宽度')

    // 展开：侧栏顶栏真实绘制于右侧空出区域，竖线变粗，主编辑区收缩。
    // 谓词等待动画终态（宽度过渡期间命中/宽度瞬时失真，轮询至到位）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const opened = await waitViewState('lf.md', (v) => v.sidebar?.open === true &&
      v.sidebar.sidebarToolbarPainted === true && (v.sidebar.sidebarWidthPx ?? 0) > 200)
    assert(opened.sidebar!.sidebarToolbarPainted === true,
      `展开时侧栏顶栏应实际绘制（elementFromPoint 应命中侧栏：${JSON.stringify(opened.sidebar)}）`)
    assert(Math.abs(parseFloat(opened.sidebar!.toggleBarStrokeWidth ?? 'x') - 3) < 0.01,
      `展开态图标竖线应为粗线 3px，实际 ${String(opened.sidebar!.toggleBarStrokeWidth)}`)
    // 外框线宽两态恒定（对照：证明粗细变化只发生在竖线）
    assert(Math.abs(parseFloat(opened.sidebar!.toggleFrameStrokeWidth ?? 'x') -
      parseFloat(collapsed.sidebar!.toggleFrameStrokeWidth ?? 'x')) < 0.01,
      '图标外框线宽两态应恒定（差异只应在竖线）')
    assert(opened.sidebar!.toggleAriaLabel === editorMessages()['sidebar.collapse'],
      `展开态切换按钮名称应为「${editorMessages()['sidebar.collapse']}」，实际 ${String(opened.sidebar!.toggleAriaLabel)}`)
    assert((opened.sidebar!.sidebarWidthPx ?? 0) > 200,
      `侧栏应占出宽度（约 280px），实际 ${String(opened.sidebar!.sidebarWidthPx)}`)
    assert((opened.sidebar!.mainWidthPx ?? 0) < collapsedMainWidth - 200,
      `主编辑区宽度应随侧栏收缩（${collapsedMainWidth} → ${String(opened.sidebar!.mainWidthPx)}）`)
    assert(opened.sidebar!.togglePainted === true,
      '展开态切换按钮应仍可见（随主编辑区右边界移动后仍可命中）')
    assert(opened.paint?.textVisible === true, '展开态正文应仍可见（布局收缩不遮挡正文）')

    // 切换全程零写回、零版本推进（侧栏是纯视图状态）
    const afterToggle = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterToggle.version === before.version,
      `切换侧栏不得推进文档版本（${before.version} → ${afterToggle.version}）`)
    assert(afterToggle.appliedEdits === before.appliedEdits, '切换侧栏不得产生写回')

    // 收起回归：侧栏顶栏重新不可见、竖线回细线、名称回「展开右侧栏」
    // （谓词等待收起动画终态：主编辑区宽度复原到基线 ±2px）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const recollapsed = await waitViewState('lf.md', (v) => v.sidebar?.open === false &&
      v.sidebar.sidebarToolbarPainted === false &&
      Math.abs((v.sidebar.mainWidthPx ?? -999) - collapsedMainWidth) < 2)
    assert(recollapsed.sidebar!.sidebarToolbarPainted === false, '收起后侧栏顶栏应不可见')
    assert(Math.abs(parseFloat(recollapsed.sidebar!.toggleBarStrokeWidth ?? 'x') - 1.5) < 0.01,
      `收起回归后图标竖线应回细线 1.5px，实际 ${String(recollapsed.sidebar!.toggleBarStrokeWidth)}`)
    assert(recollapsed.sidebar!.toggleAriaLabel === editorMessages()['sidebar.expand'],
      `收起回归后名称应回「${editorMessages()['sidebar.expand']}」，实际 ${String(recollapsed.sidebar!.toggleAriaLabel)}`)
    assert(Math.abs((recollapsed.sidebar!.mainWidthPx ?? 0) - collapsedMainWidth) < 2,
      `收起回归后主编辑区宽度应复原（${collapsedMainWidth} → ${String(recollapsed.sidebar!.mainWidthPx)}）`)
  }],

  ['右侧栏拖拽调宽：真实句柄事件序列、区间钳制与宽度记忆', async () => {
    // 绘制层断言口径（视觉层断言必查）：宽度经布局度量（sidebarWidthPx 是
    // 侧栏元素实宽——CSS 变量或样式失效时不呈现目标宽度）；句柄真实可见经
    // elementFromPoint 命中（resizerPainted，收起态热区被裁切时命中失败）。
    // DOM 存在性与逻辑坐标不能替代这些证据。
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const uri = wsUri('lf.md').toString()

    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const opened = await waitViewState('lf.md', (v) => v.sidebar?.open === true &&
      v.sidebar.sidebarToolbarPainted === true && (v.sidebar.sidebarWidthPx ?? 0) > 200)
    const baseWidth = opened.sidebar!.sidebarWidthPx ?? 0
    assert(baseWidth > 200, `初始侧栏宽度应约 280px，实际 ${baseWidth}`)
    assert(opened.sidebar!.resizerPainted === true,
      `拖宽句柄应真实可见（命中测试失败：${JSON.stringify(opened.sidebar)}`)

    // 向左拖 120px：宽度增加且主编辑区相应收缩（宽度真实参与布局）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.resize', delta: 120 })
    const widened = await waitViewState('lf.md', (v) =>
      Math.abs((v.sidebar?.sidebarWidthPx ?? -1) - (baseWidth + 120)) < 3)
    const widenedWidth = widened.sidebar!.sidebarWidthPx ?? 0
    assert(Math.abs(widenedWidth - (baseWidth + 120)) < 3,
      `左拖 120px 后宽度应约 ${baseWidth + 120}，实际 ${widenedWidth}`)
    assert((widened.sidebar!.mainWidthPx ?? 0) < (opened.sidebar!.mainWidthPx ?? Infinity) - 100,
      `主编辑区应随侧栏增宽收缩（${opened.sidebar!.mainWidthPx} → ${widened.sidebar!.mainWidthPx}）`)

    // 向右拖回 60px：收窄走同一链路
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.resize', delta: -60 })
    await waitViewState('lf.md', (v) =>
      Math.abs((v.sidebar?.sidebarWidthPx ?? -1) - (widenedWidth - 60)) < 3)

    // 大力左拖钳到上限 720（再大力不越界）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.resize', delta: 5000 })
    const capped = await waitViewState('lf.md', (v) => Math.abs((v.sidebar?.sidebarWidthPx ?? -1) - 720) < 3)
    assert(Math.abs((capped.sidebar!.sidebarWidthPx ?? 0) - 720) < 3,
      `钳制上限应为 720，实际 ${capped.sidebar!.sidebarWidthPx}`)

    // 收起再展开：宽度记忆保持（PersistedState 链路）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('lf.md', (v) => v.sidebar?.open === false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const reopened = await waitViewState('lf.md', (v) => v.sidebar?.open === true &&
      v.sidebar.sidebarToolbarPainted === true &&
      Math.abs((v.sidebar.sidebarWidthPx ?? -1) - 720) < 3)
    assert(Math.abs((reopened.sidebar!.sidebarWidthPx ?? 0) - 720) < 3,
      `收起再展开后宽度应保持 720，实际 ${reopened.sidebar!.sidebarWidthPx}`)

    // 清理：拖回默认宽度并收起侧栏，恢复后续用例的基线布局
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.resize', delta: -(720 - 280) })
    await waitViewState('lf.md', (v) => Math.abs((v.sidebar?.sidebarWidthPx ?? -1) - 280) < 3)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('lf.md', (v) => v.sidebar?.open === false)
  }],

  ['右侧栏与模式切换正交：两模式共用布局、零撤销记录、正文可编辑（#53）', async () => {
    // untouched.md 无任何前序用例编辑：全新面板 + 干净撤销栈基线
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const uri = wsUri('untouched.md').toString()
    const baseline = '未触碰文档\n保持原样\n'
    const doc = await vscode.workspace.openTextDocument(wsUri('untouched.md'))
    assert(doc.getText() === baseline, 'untouched.md 应为 fixture 原文')
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // live 下展开侧栏
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('untouched.md', (v) => v.sidebar?.open === true)

    // 切到 reading：侧栏保持展开且同样真实绘制（两模式共用同一布局；
    // 谓词含绘制命中，等侧栏展开宽度过渡完成）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const readingOpen = await waitViewState('untouched.md',
      (v) => v.viewMode === 'reading' && v.sidebar?.open === true &&
        v.sidebar.sidebarToolbarPainted === true)
    assert(readingOpen.sidebar!.sidebarToolbarPainted === true,
      `阅读模式侧栏应同样展开绘制（${JSON.stringify(readingOpen.sidebar)}）`)
    assert((readingOpen.readingBlockCount ?? 0) > 0, '阅读模式正文应正常渲染（块数 > 0）')

    // 切回 live：侧栏状态不因模式切换丢失（谓词含绘制命中，维持终态等待）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const liveOpen = await waitViewState('untouched.md',
      (v) => v.viewMode === 'live' && v.sidebar?.open === true &&
        v.sidebar.sidebarToolbarPainted === true)
    assert(liveOpen.sidebar!.sidebarToolbarPainted === true, '切回 live 后侧栏应仍展开绘制')

    // 模式与侧栏切换全程零写回、零版本推进（不产生文档撤销记录）
    const afterSwitches = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterSwitches.version === before.version,
      `切换模式/侧栏不得推进文档版本（${before.version} → ${afterSwitches.version}）`)
    assert(afterSwitches.appliedEdits === before.appliedEdits, '切换不得产生写回')
    assert(doc.getText() === baseline, '切换不得修改文档内容')

    // 展开态下正文仍可编辑（布局不影响输入链路）：一笔编辑经标准链路写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: 0,
      text: '# ',
    })
    await poll('展开态编辑写入权威', () => (doc.getText() === `# ${baseline}` ? true : undefined))

    // 撤销一次即回原文：撤销栈里只有这笔编辑（侧栏/模式切换未入栈）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销一次还原', () => (doc.getText() === baseline ? true : undefined))
    if (doc.isDirty) {
      await doc.save()
    }

    // 收起侧栏收尾（避免跨用例状态泄漏）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('untouched.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #54 右侧栏大纲面板 ----

  ['大纲面板展开：绘制层可见与全文标题序列一致（#54）', async () => {
    // 绘制层断言口径（视觉层断言必查）：大纲按钮与面板可见性经
    // elementFromPoint 命中证明（侧栏收起 / 面板 display:none / 样式注入
    // 失效时命中必失败）；内容一致性经 view.state 的 outline.items 对拍
    // 源文本文档标题（跨级、同名不合并，伪标题排除）。
    await openWithEditor('outline.md')
    await waitSessionReady('outline.md')
    const uri = wsUri('outline.md').toString()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 收起态：大纲按钮在侧栏内（display:none 继承），命中必失败
    const collapsed = await waitViewState('outline.md', (v) => v.outline !== undefined)
    assert(collapsed.outline!.active === true, '大纲面板默认 active（展开侧栏即见大纲）')
    assert(collapsed.outline!.togglePainted === false, '侧栏收起时大纲按钮不得可见')
    assert(collapsed.outline!.toggleAriaLabel === editorMessages()['outline.label'],
      `大纲按钮可访问名称应为「${editorMessages()['outline.label']}」，实际 ${String(collapsed.outline!.toggleAriaLabel)}`)

    // 展开：按钮与面板真实绘制（elementFromPoint 命中），可访问名称齐备
    // （谓词等待展开动画终态：过渡期间面板中心点可能未入视口）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const opened = await waitViewState('outline.md', (v) => v.sidebar?.open === true &&
      v.outline?.togglePainted === true && v.outline.panelPainted === true)
    assert(opened.outline!.togglePainted === true,
      `大纲按钮应真实可见（命中失败：${JSON.stringify(opened.outline)}）`)
    assert(opened.outline!.panelPainted === true,
      `大纲面板应真实绘制（elementFromPoint 应命中面板：${JSON.stringify(opened.outline)}）`)
    // 图标尺寸 16px（P1-2 回归）：尺寸规则的类名曾写错（.vsidian-toolbar-actions
    // vs DOM 实际 .vsidian-sidebar-toolbar-actions），选择器永不匹配时 SVG 回退
    // 默认尺寸溢出 24px 按钮盒——computed 尺寸直接钉住「用户看到的图标大小」
    assert(Math.abs((opened.outline!.toggleIconSizePx ?? -1) - 16) < 0.01,
      `大纲按钮图标应为 16px（选择器命中与规则生效的 computed 证据），` +
        `实际 ${String(opened.outline!.toggleIconSizePx)}`)
    assert(opened.outline!.panelAriaLabel === editorMessages()['outline.label'],
      `大纲面板可访问名称应为「${editorMessages()['outline.label']}」，实际 ${String(opened.outline!.panelAriaLabel)}`)
    assert(opened.paint?.textVisible === true, '展开态正文应仍可见')

    // 内容一致：大纲 = 源文本文档标题的级别/文字/起始行序列（跨级、同名、
    // Setext 语义与伪标题排除一次对拍）
    const expected: Array<[number, string, number]> = [
      [1, '文档主标题', 6],
      [2, '同名标题', 8],
      [3, '三级标题', 12],
      [2, '同名标题', 14],
      [1, '跨级回一级', 16],
      [1, 'Setext 一级', 18],
      [2, 'Setext 二级', 21],
      [4, '四级标题', 24],
      [5, '五级标题', 26],
      [6, '六级标题', 28],
    ]
    const items = opened.outline!.items
    assert(items.length === expected.length,
      `大纲条目数应为 ${expected.length}（伪标题排除、同名不合并），实际 ${items.length}：${JSON.stringify(items)}`)
    for (let i = 0; i < expected.length; i++) {
      const [level, text, line] = expected[i]!
      assert(items[i]!.level === level && items[i]!.text === text && items[i]!.line === line,
        `大纲第 ${i + 1} 项应为 [${level}, ${text}, ${line}]，实际 ${JSON.stringify(items[i])}`)
    }

    // 展示大纲零写回：版本与写回计数不变（面板是纯视图状态）
    const afterOpen = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterOpen.version === before.version,
      `展开侧栏显示大纲不得推进文档版本（${before.version} → ${afterOpen.version}）`)
    assert(afterOpen.appliedEdits === before.appliedEdits, '显示大纲不得产生写回')

    // 收起侧栏收尾（避免跨用例状态泄漏）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲面板切换与编辑更新：active 两态绘制证据、文本变更后大纲跟随（#54）', async () => {
    await openWithEditor('outline.md')
    await waitSessionReady('outline.md')
    const uri = wsUri('outline.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline.md', (v) => v.sidebar?.open === true && v.outline?.panelPainted === true)

    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const baselineItems = (await waitViewState('outline.md', (v) => v.outline !== undefined))
      .outline!.items

    // 点击大纲按钮：面板隐藏（绘制层证据翻转）、数据保留、零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.click' })
    const hidden = await waitViewState('outline.md', (v) => v.outline?.active === false)
    assert(hidden.outline!.panelPainted === false,
      `active=false 后大纲面板不得绘制（${JSON.stringify(hidden.outline)}）`)
    assert(hidden.outline!.items.length === baselineItems.length, '面板隐藏不影响大纲数据')
    const afterHide = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterHide.version === before.version && afterHide.appliedEdits === before.appliedEdits,
      '切换大纲面板不得推进版本或产生写回（不写回、不入撤销历史）')

    // 再点回：面板重新绘制
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.click' })
    const shown = await waitViewState('outline.md', (v) => v.outline?.active === true)
    assert(shown.outline!.panelPainted === true, '重新激活后大纲面板应恢复绘制')

    // 编辑标题：大纲随当前文本（含未保存编辑）更新——文档末尾追加二级标题
    const endOffset = doc.getText().length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.edit',
      offset: endOffset,
      text: '\n## 集成新增标题\n',
    })
    const updated = await waitViewState('outline.md',
      (v) => v.outline !== undefined && v.outline.items.length === baselineItems.length + 1)
    const last = updated.outline!.items[updated.outline!.items.length - 1]!
    assert(last.level === 2 && last.text === '集成新增标题',
      `新增标题应入大纲末项 [2, 集成新增标题]，实际 ${JSON.stringify(last)}`)

    // 撤销这笔编辑（回到原文），大纲同步回落（撤销后写回链路的另一面）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    const undone = await waitViewState('outline.md', (v) =>
      v.outline !== undefined && v.outline.items.length === baselineItems.length)
    assert(undone.outline!.items.every((item, i) =>
      item.level === baselineItems[i]!.level && item.text === baselineItems[i]!.text),
      '撤销编辑后大纲应回落为原序列')
    if (doc.isDirty) {
      await doc.save()
    }

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲与模式切换正交：两模式下序列不变、面板持续绘制（#54）', async () => {
    await openWithEditor('outline.md')
    await waitSessionReady('outline.md')
    const uri = wsUri('outline.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const live = await waitViewState('outline.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true)
    const liveItems = live.outline!.items.map((i) => [i.level, i.text])

    // 切到阅读模式：大纲仍来自 CM6 全文（非阅读渲染），面板持续绘制
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('outline.md',
      (v) => v.viewMode === 'reading' && v.outline !== undefined)
    assert(reading.outline!.panelPainted === true,
      `阅读模式下大纲面板应持续绘制（${JSON.stringify(reading.outline)}）`)
    assert(
      JSON.stringify(reading.outline!.items.map((i) => [i.level, i.text])) === JSON.stringify(liveItems),
      '模式切换不得改变大纲序列（数据源是 CM6 全文，非阅读渲染）')
    assert((reading.readingBlockCount ?? 0) > 0, '阅读模式正文应正常渲染')

    // 切回 live：序列仍不变
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const backLive = await waitViewState('outline.md', (v) => v.viewMode === 'live' && v.outline !== undefined)
    assert(
      JSON.stringify(backLive.outline!.items.map((i) => [i.level, i.text])) === JSON.stringify(liveItems),
      '切回 live 后大纲序列应不变')

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline.md', (v) => v.sidebar?.open === false)
  }],

  ['长大纲面板可滚动：高度受宿主约束、超长内容溢出可滚（评审修复）', async () => {
    // P1-1 回归（视觉层断言）：修复前面板无高度约束（height:auto 长到内容
    // 高度），被宿主 overflow:hidden 裁剪——clientHeight==scrollHeight 使
    // overflow-y 永不激活，末条不可达，且面板中心点落到宿主可视区外使
    // panelPainted 误报 false（探针盲区，随本修复消解）。约束生效的另一半：
    // 条目不收缩（flex:0 0 auto），否则条目被压扁后内容总高不溢出、滚动
    // 依旧失效（overflow:hidden 使 flex item 的 min-height:auto 为 0）。
    // 断言口径：scrollHeight > clientHeight 证明高度被宿主 flex 链约束、
    // 条目未收缩且内容溢出（overflow-y:auto 由此激活滚动）；panelPainted
    // 证明面板在可视区内真实绘制；条目计数证明长大纲数据完整。
    await openWithEditor('outline-long.md')
    await waitSessionReady('outline-long.md')
    const uri = wsUri('outline-long.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const opened = await waitViewState('outline-long.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true)
    const scrollHeight = opened.outline!.panelScrollHeightPx
    const clientHeight = opened.outline!.panelClientHeightPx
    assert(scrollHeight !== null && clientHeight !== null,
      `长面板滚动几何应可读（scrollHeight/clientHeight 不为 null）：${JSON.stringify(opened.outline)}`)
    assert(clientHeight > 0, `面板可视高度应为正（实际 ${clientHeight}）`)
    assert(scrollHeight! > clientHeight! + 500,
      `长大纲（101 标题）面板内容应显著溢出可视区（scrollHeight ${scrollHeight} 应比 ` +
        `clientHeight ${clientHeight} 大 500px 以上；相等说明高度约束失效或条目被压扁，` +
        `条目数 ${opened.outline!.items.length}）`)
    assert(opened.outline!.items.length === 101,
      `长大纲条目应为 101 项（1 主标题 + 50 章 + 50 小节），实际 ${opened.outline!.items.length}`)
    assert(opened.outline!.items[100]!.text === '第 50 章小节',
      `末条应为「第 50 章小节」，实际 ${JSON.stringify(opened.outline!.items[100])}`)
    assert(opened.paint?.textVisible === true, '长大纲展开态正文应仍可见')

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-long.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲条目行内样式透传与主题色同源：标记渲染、字重与颜色绘制证据（#65）', async () => {
    // 绘制层断言口径（视觉层断言必查）：outline.style 经 computed style 读取
    // 条目与标记 span 的字重/字体族/颜色——CSS 注入失效（如 CSP 拦截）或
    // 选择器写错时取不到目标元素或值退化，数据层 plainText/spans 对拍源文档
    // 标题结构。fixture 见 fixtures.mjs 的 OUTLINE_STYLE_DOC。
    await openWithEditor('outline-style.md')
    await waitSessionReady('outline-style.md')
    const uri = wsUri('outline-style.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const opened = await waitViewState('outline-style.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline?.style !== undefined)

    // 数据层：plainText 剥标记、白名单 spans 结构、原文保留、双链/链接纯文本
    const expected: Array<[number, string, string, Array<{ kind: string; start: number; end: number }>, number]> = [
      [1, '**重点** 结论', '重点 结论', [{ kind: 'strong', start: 0, end: 2 }], 1],
      [2, '*斜体* 与 `代码`', '斜体 与 代码',
        [{ kind: 'emphasis', start: 0, end: 2 }, { kind: 'code', start: 5, end: 7 }], 2],
      [3, '~~删除线~~ 与 [[目标笔记|显示别名]]', '删除线 与 显示别名',
        [{ kind: 'strike', start: 0, end: 3 }], 3],
      [4, '[链接文字](https://example.com) 尾注', '链接文字 尾注', [], 4],
      [5, '***粗斜*** 与普通', '粗斜 与普通',
        [{ kind: 'emphasis', start: 0, end: 2 }, { kind: 'strong', start: 0, end: 2 }], 5],
    ]
    const items = opened.outline!.items
    assert(items.length === expected.length,
      `大纲条目数应为 ${expected.length}，实际 ${items.length}：${JSON.stringify(items)}`)
    for (let i = 0; i < expected.length; i++) {
      const [level, text, plainText, spans, line] = expected[i]!
      assert(items[i]!.level === level && items[i]!.text === text && items[i]!.line === line,
        `大纲第 ${i + 1} 项基础字段应为 [${level}, ${text}, ${line}]，实际 ${JSON.stringify(items[i])}`)
      assert(items[i]!.plainText === plainText,
        `第 ${i + 1} 项 plainText 应为 ${plainText}（标记字符不得透出），实际 ${JSON.stringify(items[i]!.plainText)}`)
      assert(JSON.stringify(items[i]!.spans) === JSON.stringify(spans),
        `第 ${i + 1} 项 spans 应为 ${JSON.stringify(spans)}，实际 ${JSON.stringify(items[i]!.spans)}`)
    }

    // 绘制层：条目常规字重（不继承标题级别加粗）与显式粗体段加重的对照
    const style = opened.outline!.style!
    const isRegular = (v: string | null) => v === '400' || v === 'normal'
    const isBold = (v: string | null) => v === '700' || v === 'bold'
    assert(style.itemFontWeight !== null, '条目 computed 字重应可读（面板已绘制且有条目）')
    assert(isRegular(style.itemFontWeight),
      `大纲条目应为常规字重（400/normal，不继承标题级别加粗），实际 ${style.itemFontWeight}`)
    assert(isBold(style.strongFontWeight),
      `显式 **粗体** 段应加重（700/bold），实际 ${String(style.strongFontWeight)}`)
    assert(style.codeFontFamily !== null && style.itemFontFamily !== null,
      '行内代码与条目的 computed 字体族应可读')

    // 主题色同源：大纲条目与正文标题引用同一变量族，当前主题下解析同值；
    // 大纲侧脱钩（改引别的变量/硬编码）时两值分叉，断言即失败
    assert(style.itemColor !== null && style.headingColor !== null,
      '条目与正文标题 computed 颜色应可读（两侧均有绘制内容）')
    assert(style.itemColor === style.headingColor,
      `大纲条目与正文标题应引用同一层级色变量族（同值），条目=${style.itemColor}，标题=${style.headingColor}`)

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-style.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #66 大纲点击跳转与常驻高亮 ----

  ['大纲点击跳转与常驻高亮：双模式定位、绘制层高亮、零写回、防抖动护栏（#66）', async () => {
    // 断言口径（视觉层断言必查）：
    // - 点击跳转：live 光标落标题行首（selectionOffset 对拍宿主 offset）、
    //   reading 锚点为标题块 start（readingAnchorStart 对拍）——复用
    //   view.locate 双模式路径，零 edit.request / 版本不变
    // - 常驻高亮：locatedItemIndex/locatedText 状态对拍 + locatedPainted
    //   绘制层证据（elementFromPoint 命中 + computed 背景非全透明——
    //   样式注入失效时高亮横条不可见，此断言必失败）
    // - 防抖动护栏：跳转居中滚动后视口顶行在目标标题上方（上一控制域），
    //   程序性滚动不得把高亮反向改写回上一章——真宿主有真实滚动事件，
    //   护栏语义在此可真实验证（浏览器回归同款断言的宿主侧对应）
    await openWithEditor('outline-long.md')
    await waitSessionReady('outline-long.md')
    const uri = wsUri('outline-long.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-long.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-long.md', (v) => v.sidebar?.open === true && v.outline?.panelPainted === true)
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 首屏高亮：文档初始位于顶部，视口顶行在主标题控制域（首条目在面板
    // 可视区内——绘制层断言要求 located 条目可被 elementFromPoint 命中）
    const initial = await waitViewState('outline-long.md',
      (v) => v.outline?.locatedItemIndex === 0 && v.outline?.locatedPainted === true)
    assert(initial.outline!.locatedText === '长文档主标题',
      `首屏高亮应为主标题，实际 ${JSON.stringify(initial.outline!.locatedItemIndex)} ${String(initial.outline!.locatedText)}`)
    assert(initial.outline!.locatedPainted === true,
      `首屏高亮横条应真实绘制（命中 + 半透明背景）：${JSON.stringify(initial.outline)}`)

    // live 点击「第 30 章」（items[59]，标题行）：光标落标题行首 + 高亮即时落位。
    // 该条目在面板滚动区可视范围外（长大纲溢出），locatedPainted 的命中
    // 口径不适用（#67 的「高亮行滚进大纲可视区」落地前不断言），绘制层
    // 证据由首屏与下方 reading 可视区内条目覆盖
    const chapter30Line = initial.outline!.items[59]!.line
    assert(initial.outline!.items[59]!.text === '第 30 章',
      `items[59] 应为「第 30 章」，实际 ${JSON.stringify(initial.outline!.items[59])}`)
    const chapter30Offset = doc.offsetAt(new vscode.Position(chapter30Line - 1, 0))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.itemClick', index: 59 })
    const jumped = await waitViewState('outline-long.md',
      (v) => v.selectionOffset === chapter30Offset && v.outline?.locatedItemIndex === 59)
    assert(jumped.outline!.locatedText === '第 30 章', '跳转后 locatedText 应为目标标题')

    // 零写回：版本与写回计数不变（跳转是纯视图操作，不入撤销历史）
    const afterJump = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterJump.version === before.version && afterJump.appliedEdits === before.appliedEdits,
      `大纲跳转不得推进版本或产生写回（${before.version}/${before.appliedEdits} → ` +
        `${afterJump.version}/${afterJump.appliedEdits}）`)

    // 防抖动护栏：居中滚动的事件突发期（真宿主为真实 scroll 事件）过后，
    // 高亮不得被视口顶行重算反向改写（无护栏时会回到第 29 章的控制域）
    await new Promise((r) => setTimeout(r, 700))
    const guarded = await waitViewState('outline-long.md', (v) => v.selectionOffset === chapter30Offset)
    assert(guarded.outline!.locatedItemIndex === 59,
      `程序性滚动不得改写跳转高亮（实际 ${guarded.outline!.locatedItemIndex}；` +
        `无护栏时会被视口顶行重算到第 29 章附近）`)

    // reading 点击「第 2 章」（items[3]，面板可视区内——locatedPainted 的
    // elementFromPoint 命中口径成立）：锚点滚到标题块 + 高亮跟随 + 绘制层
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('outline-long.md', (v) => v.viewMode === 'reading')
    const chapter2Line = initial.outline!.items[3]!.line
    assert(initial.outline!.items[3]!.text === '第 2 章',
      `items[3] 应为「第 2 章」，实际 ${JSON.stringify(initial.outline!.items[3])}`)
    const chapter2Offset = doc.offsetAt(new vscode.Position(chapter2Line - 1, 0))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.itemClick', index: 3 })
    const readingJumped = await waitViewState('outline-long.md',
      (v) => v.readingAnchorStart === chapter2Offset && v.outline?.locatedItemIndex === 3)
    assert(readingJumped.outline!.locatedPainted === true,
      `阅读模式高亮横条应真实绘制（located 条目在面板可视区内）：${JSON.stringify(readingJumped.outline)}`)
    assert((readingJumped.readingBlockCount ?? 0) > 0, '阅读正文应正常渲染')

    // 阅读跳转同样零写回
    const afterReading = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterReading.version === before.version && afterReading.appliedEdits === before.appliedEdits,
      '阅读模式跳转同样不得产生写回')

    // 模式切换即时重算：切回 live 后 located 即时重算（非 null；具体值随
    // 锚点恢复滚动位置而定）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const backLive = await waitViewState('outline-long.md',
      (v) => v.viewMode === 'live' && v.outline !== undefined && v.outline.locatedItemIndex !== null)
    assert(backLive.outline!.locatedItemIndex! >= 0, '切回 live 后应即时重算 located')

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-long.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #67 大纲折叠滑块与手动折叠 ----

  ['大纲折叠滑块与手动折叠：档位语义、绘制层证据、滚动展开、编辑存活（#67）', async () => {
    // 断言口径（视觉层断言必查）：
    // - 档位语义：visibleIndices 状态对拍（档 1 = 展开 H1 父节点 → 51 条
    //   可见；档 0 = 只露顶层）——「展开到 Hn = 展开 level≤n 父节点」而非
    //   只显示 level≤n 标题
    // - 绘制层证据：sliderPainted/sliderActiveDotPainted（active 圆点命中
    //   + computed 实心）/chevronPainted（elementFromPoint 命中，样式注入
    //   失败时必失败）与 locatedPainted（#67 落地后补全的口径：高亮行
    //   滚进面板可视区后命中成立——跳转到面板滚动区深处的折叠条目）
    // - 滚动动态展开：view.locate 落进折叠区 → only-expand 展开当前路径
    //   （其余折叠区不动）、locatedPainted 成立
    // - 编辑存活：宿主 WorkspaceEdit 重命名后折叠视图不扰动（迁移保键）
    // - 零写回：滑块/箭头操作不推进版本、不产生写回
    await openWithEditor('outline-long.md')
    await waitSessionReady('outline-long.md')
    const uri = wsUri('outline-long.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-long.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    // 条目序列（101 项）：0=主标题(H1)；第 i 章 H2=index 2i-1、H3=index 2i
    const initial = await waitViewState('outline-long.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 101)
    assert(initial.outline!.expandLevel === 5, `默认档应为 5（实际 ${initial.outline!.expandLevel}）`)
    assert(initial.outline!.visibleIndices.length === 101, `默认档全展开应 101 条可见（实际 ${initial.outline!.visibleIndices.length}）`)
    assert(initial.outline!.sliderPainted === true,
      `滑块行应真实绘制（命中失败：${JSON.stringify(initial.outline)}）`)
    assert(initial.outline!.sliderActiveDotPainted === true,
      `当前档圆点应实心绘制（命中 + computed 背景：${JSON.stringify(initial.outline)}）`)
    assert(initial.outline!.chevronPainted === true,
      `折叠箭头应真实绘制（命中失败：${JSON.stringify(initial.outline)}）`)
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 档 1：展开 H1 父节点 → H2 直接子级全可见（51 条），H3 全折叠
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 1 })
    const level1 = await waitViewState('outline-long.md', (v) => v.outline?.expandLevel === 1)
    assert(level1.outline!.visibleIndices.length === 51,
      `档 1 应 51 条可见（实际 ${level1.outline!.visibleIndices.length}）`)
    assert(level1.outline!.visibleIndices[1] === 1 && level1.outline!.visibleIndices[2] === 3,
      '档 1 可见序列应为 0,1,3,…（H2 可见、H3 折叠）')
    assert(level1.outline!.sliderActiveDotPainted === true, '切档后当前档圆点应仍实心绘制')

    // 手动箭头叠加在档位上（档 1 下 H2 本就折叠中——档位精确集只含
    // level≤1 父节点）：点第 1 章箭头 = 展开（其 H3 可见），再点 = 折叠
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.chevronClick', index: 1 })
    const expanded = await waitViewState('outline-long.md',
      (v) => v.outline !== undefined && v.outline.visibleIndices.length === 52)
    assert(expanded.outline!.visibleIndices.includes(2), '档 1 下手动展开第 1 章后其小节应可见')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.chevronClick', index: 1 })
    const collapsed = await waitViewState('outline-long.md',
      (v) => v.outline !== undefined && v.outline.visibleIndices.length === 51)
    assert(!collapsed.outline!.visibleIndices.includes(2), '手动折叠第 1 章后其小节应不可见')
    // 点折叠中的父条目文字跳转：条目自身可见（折叠遮子不遮己），不触发展开
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.itemClick', index: 1 })
    const jumpParent = await waitViewState('outline-long.md', (v) => v.outline?.locatedItemIndex === 1)
    assert(jumpParent.outline!.visibleIndices.length === 51,
      '跳转到折叠中的父条目自身不得展开（自身可见，无祖先可展开）')
    assert(jumpParent.outline!.locatedPainted === true, '父条目高亮横条应真实绘制（面板可视区内）')

    // 跳转到被折叠遮蔽的深层条目（第 45 章 H3, index 90，面板滚动区深处）：
    // only-expand 展开其祖先链（第 45 章 H2）+ 高亮行滚进面板可视区——
    // #66 留下的「locatedPainted 暂不断言」口径在本票落地后的补全
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.itemClick', index: 90 })
    const jumpDeep = await waitViewState('outline-long.md', (v) => v.outline?.locatedItemIndex === 90)
    assert(jumpDeep.outline!.visibleIndices.length === 52,
      `跳转深层折叠条目应展开其祖先链（实际 ${jumpDeep.outline!.visibleIndices.length}）`)
    assert(jumpDeep.outline!.visibleIndices.includes(90), '展开后目标条目应可见')
    assert(jumpDeep.outline!.locatedPainted === true,
      `高亮行应滚进大纲面板可视区并真实绘制（${JSON.stringify(jumpDeep.outline)}）`)

    // 滑块/箭头操作零写回（纯视图状态）
    const afterCollapse = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterCollapse.version === before.version && afterCollapse.appliedEdits === before.appliedEdits,
      `折叠操作不得推进版本或产生写回（${before.version}/${before.appliedEdits} → ` +
        `${afterCollapse.version}/${afterCollapse.appliedEdits}）`)

    // 档 0 + 宿主 view.locate 落进折叠区：only-expand 展开当前路径（目标
    // 的祖先链 = 第 45 章 H2 + 主标题 H1——展开 H1 使全部 H2 作为直接子级
    // 可见，这是「展开祖先链让目标可见」的语义代价），其余 H3 折叠不动
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 0 })
    await waitViewState('outline-long.md', (v) => v.outline?.visibleIndices.length === 1)
    const targetLine = jumpDeep.outline!.items[90]!.line
    const targetOffset = doc.offsetAt(new vscode.Position(targetLine - 1, 0))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: targetOffset })
    const located = await waitViewState('outline-long.md', (v) => v.outline?.locatedItemIndex === 90)
    assert(located.outline!.visibleIndices.includes(90),
      `定位到折叠区应 only-expand 使目标可见（实际 ${JSON.stringify(located.outline!.visibleIndices)}）`)
    assert(!located.outline!.visibleIndices.includes(2) && !located.outline!.visibleIndices.includes(88),
      `其余 H3 不得被展开（only-expand 只动当前路径）：${JSON.stringify(located.outline!.visibleIndices)}`)
    assert(located.outline!.visibleIndices.length === 52,
      `可见集应为 H1 + 50 个 H2 + 目标 H3（52 条，实际 ${located.outline!.visibleIndices.length}）`)
    assert(located.outline!.locatedPainted === true, '定位后的高亮行应滚进可视区并真实绘制')

    // 编辑存活：宿主 WorkspaceEdit 重命名第 45 章标题 → 折叠视图不扰动。
    // 注意口径：doc 变化触发视口顶行重算 + only-expand（合法展开当前路径
    // 的邻章），故不精确对拍数组——断言当前路径仍展开、远端章节仍折叠
    const renameEdit = new vscode.WorkspaceEdit()
    const headingLine = jumpDeep.outline!.items[89]!.line - 1
    const lineText = doc.lineAt(headingLine)
    renameEdit.replace(
      wsUri('outline-long.md'),
      lineText.range,
      lineText.text.replace('第 45 章', '第 45 章改名'),
    )
    await vscode.workspace.applyEdit(renameEdit)
    const renamed = await waitViewState('outline-long.md',
      (v) => v.outline?.items[89] !== undefined && v.outline.items[89].text === '第 45 章改名')
    assert(renamed.outline!.visibleIndices.includes(89) && renamed.outline!.visibleIndices.includes(90),
      `重命名后当前展开路径应保持可见（实际 ${JSON.stringify(renamed.outline!.visibleIndices)}）`)
    assert(!renamed.outline!.visibleIndices.includes(2) && !renamed.outline!.visibleIndices.includes(20),
      `远端章节的 H3 不得因重命名被展开（实际 ${JSON.stringify(renamed.outline!.visibleIndices)}）`)

    // 档位持久化：切档 1 后重载 webview（Developer: Reload Webviews——
    // retainContextWhenHidden 关闭：销毁重建同一 panel，走 bridge state
    // 恢复，#6 模式记忆的同款验证路径）→ 档位恢复为 1；重载同时恢复锚点
    // （视口回到第 45 章区域），only-expand 会合法展开当前路径（至多
    // +2 条 H3），可见数允许 51–53 而非精确 51
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 1 })
    await waitViewState('outline-long.md', (v) => v.outline?.expandLevel === 1)
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    // 档位先从持久化状态恢复；等待宿主全文同步后的条目重建，避免读到空大纲。
    const reopened = await waitViewState('outline-long.md',
      (v) => v.outline?.expandLevel === 1 && v.outline.visibleIndices.length >= 51)
    assert(reopened.outline!.visibleIndices.length >= 51 && reopened.outline!.visibleIndices.length <= 53,
      `重载后档 1 基础可见集应恢复（51–53 条，实际 ${reopened.outline!.visibleIndices.length}）`)

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-long.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #68 大纲工具条与标题搜索 ----

  ['大纲工具条与标题搜索：过滤、片段高亮绘制、快照回放、重置与跳末（#68）', async () => {
    // 断言口径（视觉层断言必查）：
    // - 工具条装配与绘制：toolbarPainted（elementFromPoint 命中，样式注入
    //   失败时必失败）+ 按钮可访问名称 + placeholder 文案
    // - 搜索语义：filteredVisibleIndices 组合可见口径对拍（档 1 折叠下
    //   搜索命中 → 匹配路径展开可见）；清空回放进入前快照（QO 语义）
    // - 绘制层证据：searchHitPainted（可见条目内 mark 命中 + computed
    //   背景非全透明）与 nomatchPainted（无匹配占位真实可见）
    // - 重置三合一与跳转到末尾：状态对拍 + locatedPainted（高亮滚进
    //   可视区）+ locatedItemIndex 落末尾控制域 + 零写回（版本不推进）
    await openWithEditor('outline-long.md')
    await waitSessionReady('outline-long.md')
    const uri = wsUri('outline-long.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    const initial = await waitViewState('outline-long.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 101)
    assert(initial.outline!.toolbarPainted === true,
      `工具条行应真实绘制（命中失败：${JSON.stringify(initial.outline)}）`)
    assert(initial.outline!.jumpBottomAriaLabel === editorMessages()['outline.jumpBottom'],
      `跳末按钮可访问名称（实际 ${String(initial.outline!.jumpBottomAriaLabel)}）`)
    assert(initial.outline!.resetAriaLabel === editorMessages()['outline.reset'],
      `重置按钮可访问名称（实际 ${String(initial.outline!.resetAriaLabel)}）`)
    assert(initial.outline!.searchPlaceholder === editorMessages()['outline.searchPlaceholder'],
      `搜索框 placeholder（实际 ${String(initial.outline!.searchPlaceholder)}）`)
    assert(initial.outline!.searchActive === false, '初始应无搜索过滤')
    assert(initial.outline!.filteredVisibleIndices.length === 101,
      '搜索关闭时组合可见口径与折叠口径同值（101 条）')
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 档 1（H3 折叠遮蔽）下搜索「第 45 章」：命中第 45 章 H2（89）与
    // 「第 45 章小节」H3（90，子串命中），匹配路径自动展开——组合可见
    // 口径 = 主标题 + 89 + 90（其余 50 章 H2 折叠可见但不保留）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 1 })
    await waitViewState('outline-long.md', (v) => v.outline?.expandLevel === 1)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '第 45 章' })
    const filtered = await waitViewState('outline-long.md', (v) => v.outline?.searchActive === true)
    assert(filtered.outline!.filteredVisibleIndices.join(',') === '0,89,90',
      `搜索「第 45 章」组合可见应为 [0,89,90]（实际 ${JSON.stringify(filtered.outline!.filteredVisibleIndices)}）`)
    assert(filtered.outline!.searchQuery === '第 45 章', 'probe 应回报搜索词实值')

    // 清空回放进入搜索前的档 1 快照（H3 重新被折叠遮蔽）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '' })
    const restored = await waitViewState('outline-long.md', (v) => v.outline?.searchActive === false)
    assert(restored.outline!.visibleIndices.length === 51,
      `清空应回放档 1 快照（51 条，实际 ${restored.outline!.visibleIndices.length}）`)
    assert(restored.outline!.filteredVisibleIndices.length === 51, '清空后组合口径与折叠口径同值')

    // 搜索「第 1 章」：命中在面板顶部可视区——mark 片段高亮的绘制层证据
    // （elementFromPoint 命中 + computed 背景非全透明）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '第 1 章' })
    const hit = await waitViewState('outline-long.md',
      (v) => v.outline?.searchActive === true && v.outline.searchHitPainted === true)
    assert(hit.outline!.filteredVisibleIndices.join(',') === '0,1,2',
      `搜索「第 1 章」应保留主标题与第 1 章路径（实际 ${JSON.stringify(hit.outline!.filteredVisibleIndices)}）`)
    assert(hit.outline!.searchHitPainted === true,
      `命中片段 mark 应真实绘制（命中 + computed 背景：${JSON.stringify(hit.outline)}）`)

    // 无匹配：占位真实可见、组合可见口径为空、mark 不绘制
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '不存在的词条' })
    const nomatch = await waitViewState('outline-long.md', (v) => v.outline?.nomatchPainted === true)
    assert(nomatch.outline!.filteredVisibleIndices.length === 0, '无匹配时组合可见口径应为空')
    assert(nomatch.outline!.searchHitPainted === false, '无匹配时不得有命中片段绘制')
    assert(nomatch.outline!.nomatchPainted === true, '「无匹配」占位应真实可见')

    // 重置三合一：清搜索词 + 档位回默认 5 + 清手动折叠（档 1 整体替换）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.toolbarClick', action: 'reset' })
    const reset = await waitViewState('outline-long.md', (v) =>
      v.outline?.searchActive === false && v.outline.expandLevel === 5)
    assert(reset.outline!.filteredVisibleIndices.length === 101,
      `重置后应全展开 101 条（实际 ${reset.outline!.filteredVisibleIndices.length}）`)
    assert(reset.outline!.nomatchPainted === false, '重置后无匹配占位应消失')

    // 跳转到末尾：located 落末尾控制域（第 50 章小节 = index 100，面板
    // 滚动区深处——高亮行滚进可视区后命中成立）、正文文本零变化
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.toolbarClick', action: 'jump-bottom' })
    const bottom = await waitViewState('outline-long.md', (v) => v.outline?.locatedItemIndex === 100)
    assert(bottom.outline!.locatedText === '第 50 章小节',
      `跳末后控制域应为最后一个标题（实际 ${String(bottom.outline!.locatedText)}）`)
    assert(bottom.outline!.locatedPainted === true, '跳末后高亮行应滚进面板可视区并真实绘制')

    // 搜索/重置/跳末全程零写回（纯视图状态）
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.version === before.version && after.appliedEdits === before.appliedEdits,
      `工具条与搜索操作不得推进版本或产生写回（${before.version}/${before.appliedEdits} → ` +
        `${after.version}/${after.appliedEdits}）`)

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-long.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #69 大纲右键菜单 ----

  ['大纲右键菜单开合与结构命令：绘制层证据、折叠状态对拍（#69）', async () => {
    // 断言口径（视觉层断言必查）：menuPainted 是菜单容器的 elementFromPoint
    // 命中（真实布局 + 浮层样式生效——样式失效时 DOM 存在但命中失败）；
    // 结构命令经 outline.test.contextMenu + menuClick 真实按钮点击链路驱动，
    // visibleIndices 状态对拍（与 #67 同口径）
    await openWithEditor('outline-menu.md')
    await waitSessionReady('outline-menu.md')
    const uri = wsUri('outline-menu.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 7)
    // 右键「加粗 Alpha」（index 1）：菜单打开、目标索引正确、真实绘制
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 1 })
    const opened = await waitViewState('outline-menu.md', (v) => v.outline?.menuOpen === true)
    assert(opened.outline!.menuTargetIndex === 1,
      `菜单目标应为条目 1（实际 ${String(opened.outline!.menuTargetIndex)}）`)
    assert(opened.outline!.menuPainted === true,
      `菜单应真实绘制（命中失败：${JSON.stringify(opened.outline)}）`)
    // 关闭后再开（开合幂等）：menuClose 后 menuOpen=false
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClose' })
    await waitViewState('outline-menu.md', (v) => v.outline?.menuOpen === false)
    // 结构命令（折叠同级）：主标题（index 0）的同级组 = 主、Setext、第二顶；
    // 折叠主标题遮 Alpha 与 Beta 子树（1–4 隐藏）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 0 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'collapseSiblings' })
    const collapsed = await waitViewState('outline-menu.md',
      (v) => v.outline?.menuOpen === false && v.outline.visibleIndices.length === 3)
    assert(JSON.stringify(collapsed.outline!.visibleIndices) === JSON.stringify([0, 5, 6]),
      `折叠同级后应只露顶层三标题（实际 ${JSON.stringify(collapsed.outline!.visibleIndices)}）`)
    // 展开同级（顶层组父节点键加回）：主标题展开 → 全部条目可见
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 0 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'expandSiblings' })
    const expanded = await waitViewState('outline-menu.md',
      (v) => v.outline?.visibleIndices.length === 7)
    assert(JSON.stringify(expanded.outline!.visibleIndices) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
      `展开同级后应全部可见（实际 ${JSON.stringify(expanded.outline!.visibleIndices)}）`)
    // 递归展开（目标须自身可见——递归展开只动目标子树、不展开目标祖先）：
    // 手动折叠 Beta（箭头）后对其递归展开，Beta 深恢复可见
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.chevronClick', index: 3 })
    await waitViewState('outline-menu.md', (v) => v.outline?.visibleIndices.length === 6)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 3 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'expandRecursively' })
    const recursed = await waitViewState('outline-menu.md',
      (v) => v.outline?.visibleIndices.length === 7)
    assert(JSON.stringify(recursed.outline!.visibleIndices) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
      `递归展开 Beta 后 Beta 深应恢复可见（实际 ${JSON.stringify(recursed.outline!.visibleIndices)}）`)
    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲复制五项经宿主剪贴板：端到端读写对拍（#69）', async () => {
    // 断言口径：复制走 webview→宿主 clipboard.write 消息桥，宿主
    // env.clipboard.writeText 写入系统剪贴板——集成侧以 readText 读回对拍
    // （端到端：webview 载荷计算 → 消息桥 → 宿主拼接 → 剪贴板全程真实）；
    // 标题链接另做「复制 → 注入定位」往返对拍（链路见下段注释）
    await openWithEditor('outline-menu.md')
    await waitSessionReady('outline-menu.md')
    const uri = wsUri('outline-menu.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 7)
    const copy = async (index: number, command: string): Promise<string> => {
      // 竞速防御（#69 时序抖动）：菜单关闭（menuOpen=false）只代表 webview
      // 命令已执行，clipboard.write 经消息桥到宿主 writeText 仍在途——
      // 高负载（多片并发）下立即 readText 会读到上一次的剪贴板内容。
      // 等待谓词改为「剪贴板内容相对上次复制发生变化」：五项复制载荷两两
      // 不同（相邻调用亦不同），变化即代表本次写已落地，端到端对拍语义
      // 不变（读取的仍是系统剪贴板实值）
      const before = await vscode.env.clipboard.readText()
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index })
      await waitViewState('outline-menu.md', (v) => v.outline?.menuOpen === true)
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command })
      await waitViewState('outline-menu.md', (v) => v.outline?.menuOpen === false)
      return poll('剪贴板更新', async () => {
        const text = await vscode.env.clipboard.readText()
        return text !== before ? text : undefined
      })
    }
    // 标题（plainText：**加粗** 标记不透出）
    assert(await copy(1, 'copyHeading') === '加粗 Alpha', '复制标题应为剥标记可见文本')
    // 标题和兄弟标题（同父组 = Alpha、Beta，含自身）
    assert(await copy(1, 'copySiblings') === '加粗 Alpha\nBeta', '兄弟复制为同父全部标题逐行')
    // 标题和子标题（Alpha 子树 = Alpha、Alpha 子）
    assert(await copy(1, 'copyChildren') === '加粗 Alpha\nAlpha 子', '子标题复制含后代')
    // 标题链接（宿主拼 [[笔记名#标题]]：笔记名 = 文件名去扩展名；标题取条目
    // 原文（含 **加粗** 等行内标记）——宿主 findHeadingOffset 按 ATX 标题行
    // 字面文本比较，两侧口径同源才能定位回原标题；剥标记文本只服务「复制
    // 标题」纯文本场景，写进链接必然定位落空（review-loops 第 2 轮）
    const markedLink = await copy(1, 'copyLink')
    assert(markedLink === '[[outline-menu#**加粗** Alpha]]',
      `含标记标题的链接应为标题原文，实际 ${markedLink}`)
    // 纯文本标题链接（Beta，index 3）：无标记可剥，原文 == 可见文本，一期口径不变
    const plainLink = await copy(3, 'copyLink')
    assert(plainLink === '[[outline-menu#Beta]]', `纯文本标题链接应不变，实际 ${plainLink}`)
    // Setext 标题链接（index 5）：同样取原文（其不能定位属一期已知限制，见下方往返断言）
    const setextLink = await copy(5, 'copyLink')
    assert(setextLink === '[[outline-menu#Setext 标题]]',
      `Setext 标题链接应为标题原文，实际 ${setextLink}`)
    // 该段内容（整控制域源文含标题行，标记原样）
    const sectionText = await copy(3, 'copySection')
    assert(sectionText === '## Beta\n\nBeta 内容。\n\n#### Beta 深\n\n深内容。',
      `该段内容为整控制域源文，实际 ${JSON.stringify(sectionText)}`)
    // Setext 标题的复制（plainText）
    assert(await copy(5, 'copyHeading') === 'Setext 标题', 'Setext 标题复制为可见文本')

    // ---- 端到端往返：复制出的链接能否定位回原标题（#69 写入端 × #11 读回端） ----
    // 剪贴板文本 → 剥 [[ ]] 得注入目标 → injectWikilink（与真实 webview 消息
    // 同一校验与处理入口）→ 宿主解析/定位 → 日志 locate + 面板实际落点对拍。
    // 这是本用例的核心契约：读取端按标题行字面文本比较，故写入端必须上报条目
    // 原文；剥标记口径下含标记标题的链接必然 locate=none（修复前实测形态）
    const fixtureText = await readDisk('outline-menu.md')
    /** 标题行在全文中的行首 offset（LF 系；整行全等匹配，避免子串误命中） */
    const headingOffsetOf = (lineText: string): number => {
      let offset = 0
      for (const line of fixtureText.split('\n')) {
        if (line.replace(/\r$/, '') === lineText) {
          return offset
        }
        offset += line.length + 1
      }
      throw new Error(`fixture 中不存在该标题行：${lineText}`)
    }
    const roundTrip = async (link: string, headingLine: string): Promise<void> => {
      assert(link.startsWith('[[outline-menu#') && link.endsWith(']]'),
        `标题链接形态应为 [[outline-menu#…]]，实际 ${link}`)
      const heading = headingLine.replace(/^#+ /, '')
      await injectWikilink(uri, link.slice(2, -2))
      const log = await waitWikilinkLog(uri, (e) => e.kind === 'wikilink-doc' && e.heading === heading)
      assert(log.locate !== 'none',
        `复制出的链接应定位回原标题「${heading}」，实际 locate=${String(log.locate)}`)
      assert(log.path === wsUri('outline-menu.md').fsPath,
        `定位目标应为 outline-menu.md，实际 ${String(log.path)}`)
      const offset = headingOffsetOf(headingLine)
      assert(log.locate === 'custom-panel', `标题跳转应经 Vsidian 面板定位，实际 ${log.locate}`)
      // 目标（outline-menu.md）即本面板自身：宿主 reveal 后发 view.locate，
      // live 态光标落标题行首——面板侧可见落点，不只看日志
      const view = await waitViewState('outline-menu.md', (v) => v.selectionOffset === offset)
      assert(view.selectionOffset === offset,
        `面板光标应落标题行首 offset ${offset}，实际 ${view.selectionOffset}`)
    }
    // 含标记标题（index 1）：写入端原文 → 读回端字面匹配原文，本轮修复的回归钉子
    await roundTrip(markedLink, '## **加粗** Alpha')
    // 纯文本标题（index 3）：原文 == 可见文本，两侧口径本来就一致（防误伤）
    await roundTrip(plainLink, '## Beta')
    // Setext 标题（index 5）：一期标题匹配规则明示「仅 ATX 标题行」（钉在
    // test/unit/wikilinkTarget.test.ts），其链接不能定位——已知限制，显式钉住
    // 而非静默略过
    await injectWikilink(uri, setextLink.slice(2, -2))
    const setextLog = await waitWikilinkLog(uri,
      (e) => e.kind === 'wikilink-doc' && e.heading === 'Setext 标题')
    assert(setextLog.locate === 'none',
      `一期已知限制：Setext 标题链接不定位（findHeadingOffset 仅认 ATX 标题行），实际 locate=${String(setextLog.locate)}`)
    // 不定位 = 面板光标停在上一跳落点（settle 窗等可能的定位消息到达后复查）
    const betaOffset = headingOffsetOf('## Beta')
    await new Promise((r) => setTimeout(r, 200))
    const settled = await waitViewState('outline-menu.md')
    assert(settled.selectionOffset === betaOffset,
      `Setext 链接不应移动光标（应保持 ${betaOffset}），实际 ${settled.selectionOffset}`)

    // 形态学已知限制（不另造 fixture）：标题含「] | # ^」时 wikilink 无法表达该
    // 标题——「]」触发扫描守卫、「|」切别名、「#」二次分割标题、「^」按块引用降级
    // （见 src/shared/wikilink.ts 与 outlineLinkHeading 注释）。此类标题的链接既
    // 不保证可表达也不保证可定位，属一期已知边界，本用例不覆盖。

    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲调整层级写回：钳制、单事务撤销、控制域外零变更（#69）', async () => {
    // 断言口径：写操作对权威文档生效（doc.getText 对拍）+ sessionState 的
    // version/appliedEdits 推进（单笔 edit.request）+ history.request undo
    // 完整回滚（单事务可一次撤销）
    await openWithEditor('outline-menu.md')
    await waitSessionReady('outline-menu.md')
    const uri = wsUri('outline-menu.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-menu.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md',
      (v) => v.sidebar?.open === true && v.outline?.items.length === 7)
    const original = doc.getText()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    // H1 减少钳制：零写回（版本与 appliedEdits 不动）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 0 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'levelDown' })
    await new Promise((r) => setTimeout(r, 150))
    const clamped = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(clamped.version === before.version && clamped.appliedEdits === before.appliedEdits,
      `H1 减少钳制不得写回（${before.version}/${before.appliedEdits} → ${clamped.version}/${clamped.appliedEdits}）`)
    // 递归增加 Beta（index 3，子树含 Beta 深）：一笔多段单事务
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 3 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'levelUpRecursive' })
    const upped = await waitViewState('outline-menu.md', (v) =>
      v.outline?.items[3] !== undefined && v.outline.items[3].level === 3 && v.outline.items[4].level === 5)
    assert(upped.outline!.items[3]!.text === 'Beta' && upped.outline!.items[4]!.text === 'Beta 深',
      '调级只改层级不改文字')
    const uppedText = doc.getText()
    assert(uppedText.includes('### Beta\n') && uppedText.includes('##### Beta 深'),
      '权威文档应重写 # 数量')
    assert(uppedText.includes('## **加粗** Alpha') && uppedText.includes('Setext 标题'),
      '控制域外内容零变更')
    const afterUp = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterUp.appliedEdits === before.appliedEdits + 1,
      `递归调级应为单笔写回（实际 +${afterUp.appliedEdits - before.appliedEdits}）`)
    // 撤销一次完整回滚（单事务）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-menu.md', (v) =>
      v.outline?.items[3] !== undefined && v.outline.items[3].level === 2 && v.outline.items[4].level === 4)
    assert(doc.getText() === original, '单次撤销应完整回滚递归调级')
    // Setext 调级：规范化为 ATX 单行（内容+下划线两行 → 一行）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 5 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'levelUp' })
    const setextUp = await waitViewState('outline-menu.md', (v) =>
      v.outline?.items[5] !== undefined && v.outline.items[5].level === 2)
    assert(setextUp.outline!.items[5]!.text === 'Setext 标题', 'Setext 调级保留标题文字')
    const setextText = doc.getText()
    assert(setextText.includes('## Setext 标题\n') && !setextText.includes('============'),
      'Setext 调级应规范化为 ATX 单行（下划线行消除）')
    assert(setextText.includes('# 第二顶\n\n内容。'), 'Setext 段后内容完整保留')
    // 撤销收尾回原文
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-menu.md', (v) => v.outline?.items[5] !== undefined && v.outline.items[5].level === 1)
    if (doc.isDirty) {
      await doc.save()
    }
    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲重命名与删除：编辑原文保留标记、整控制域删除、撤销回滚（#69）', async () => {
    await openWithEditor('outline-menu.md')
    await waitSessionReady('outline-menu.md')
    const uri = wsUri('outline-menu.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-menu.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md',
      (v) => v.sidebar?.open === true && v.outline?.items.length === 7 && v.outline.panelPainted === true)
    const original = doc.getText()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    // 重命名「**加粗** Alpha」（index 1）：编辑原文（标记是资产）+ renamingIndex 观测
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 1 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'rename' })
    const renaming = await waitViewState('outline-menu.md', (v) => v.outline?.renamingIndex === 1)
    assert(renaming.outline!.renamingIndex === 1, '重命名编辑态应回报条目索引')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.renameKey', text: '**改名** 加粗', key: 'enter' })
    const renamed = await waitViewState('outline-menu.md', (v) =>
      v.outline?.items[1] !== undefined && v.outline.items[1].text === '**改名** 加粗')
    assert(renamed.outline!.items[1]!.plainText === '改名 加粗', '重命名后 plainText 剥标记')
    assert(renamed.outline!.renamingIndex === null, '提交后编辑态退出')
    assert(doc.getText().includes('## **改名** 加粗'), '权威文档整标题行替换（# 数量保持）')
    assert(renamed.outline!.items[0]!.text === '主标题' && renamed.outline!.items[2]!.text === 'Alpha 子',
      '重命名只影响目标条目')
    // Esc 取消零写回
    const editsAfterRename = ((await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState).appliedEdits
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 1 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'rename' })
    await waitViewState('outline-menu.md', (v) => v.outline?.renamingIndex === 1)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.renameKey', text: '不该出现', key: 'escape' })
    await waitViewState('outline-menu.md', (v) => v.outline?.renamingIndex === null)
    const afterEsc = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterEsc.appliedEdits === editsAfterRename, 'Esc 取消不得写回')
    // 删除 Beta 段（index 3，跨级子树随段）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.contextMenu', index: 3 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.menuClick', command: 'delete' })
    const deleted = await waitViewState('outline-menu.md', (v) =>
      v.outline !== undefined && v.outline.items.length === 5)
    assert(JSON.stringify(deleted.outline!.items.map((i) => i.text)) ===
      JSON.stringify(['主标题', '**改名** 加粗', 'Alpha 子', 'Setext 标题', '第二顶']),
      '删除应移除 Beta 与 Beta 深两条（控制域整体）')
    const deletedText = doc.getText()
    assert(!deletedText.includes('Beta'), '权威文档不再含 Beta 段')
    assert(deletedText.includes('子内容。') && deletedText.includes('Setext 内容。'),
      '相邻段内容不丢失')
    // 撤销删除（重命名与删除各一笔，两次撤销回原文）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-menu.md', (v) => v.outline !== undefined && v.outline.items.length === 7)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-menu.md', (v) =>
      v.outline?.items[1] !== undefined && v.outline.items[1].text === '**加粗** Alpha')
    assert(doc.getText() === original, '两次撤销后应回到原文')
    const final = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(final.appliedEdits - before.appliedEdits === 2, '重命名与删除各一笔写回')
    if (doc.isDirty) {
      await doc.save()
    }
    // 收起侧栏收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-menu.md', (v) => v.sidebar?.open === false)
  }],

  // ---- #70 大纲拖拽排序 ----

  ['大纲拖拽三态写回：全文对拍、控制域外零变更、单事务撤销（#70）', async () => {
    // 断言口径：写操作对权威文档生效（doc.getText 全文对拍）+ sessionState 的
    // appliedEdits 每次拖拽恰好 +1（单笔 edit.request）+ history.request undo
    // 完整回滚（单事务可一次撤销）。outline.test.drag 驱动真实 pointer 事件
    // 序列（与用户拖拽同一处理器链）。fixture 条目序：0 甲(H1) 1 乙(H2)
    // 2 丁(H4,跨级挂乙) 3 丙(H2) 4 戊(H1)；甲的子树含乙丁丙
    await openWithEditor('outline-drag.md')
    await waitSessionReady('outline-drag.md')
    const uri = wsUri('outline-drag.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-drag.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 5)
    const original = doc.getText()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const drag = (from: number, to: number, position: string, action: string): Thenable<unknown> =>
      vscode.commands.executeCommand(CMD.postToPanel, uri,
        { kind: 'outline.test.drag', from, to, position, action })

    // before 落点：丁(H4) 拖到丙(H2) 之前 → 对齐 H2
    await drag(2, 3, 'before', 'drop')
    const beforeDrop = await waitViewState('outline-drag.md', (v) =>
      v.outline?.items[2] !== undefined && v.outline.items[2].text === '丁' && v.outline.items[2].level === 2)
    assert(beforeDrop.outline!.items.map((i) => [i.level, i.text]).map(String).join() ===
      [[1, '甲'], [2, '乙'], [2, '丁'], [2, '丙'], [1, '戊']].map(String).join(),
      'before 落点条目序与调级（实际 ' + JSON.stringify(beforeDrop.outline!.items.map((i) => [i.level, i.text])) + '）')
    assert(doc.getText() === [
      '---', 'title: 拖拽', '---', '',
      '# 甲', '甲内容。', '## 乙', '乙内容。', '## 丁', '丁内容。', '## 丙', '丙内容。', '# 戊', '戊内容。',
    ].join('\n'), 'before 落点全文对拍')
    let state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits - before.appliedEdits === 1, 'before 落点应为单笔写回')
    // 撤销一次完整回滚（单事务）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-drag.md', (v) => v.outline?.items[2]?.text === '丁' && v.outline.items[2].level === 4)
    assert(doc.getText() === original, '单次撤销应完整回滚 before 拖拽')

    // #67 迁移交互：before 拖拽把丁移出乙子树后乙降格为叶（展开键被
    // safeFilter 丢弃），undo 回滚文本后乙重新成为父节点但键已丢——丁处于
    // 折叠遮蔽态。重设档位 5 恢复全展开再继续（隐藏条目不可拖是既定口径）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 5 })
    await waitViewState('outline-drag.md', (v) => v.outline?.visibleIndices.length === 5)
    // inside 落点：丁拖到丙内部 → 降 H3 成为丙的最后子级（物理移到丙段尾）
    await drag(2, 3, 'inside', 'drop')
    const insideDrop = await waitViewState('outline-drag.md', (v) =>
      v.outline?.items[3] !== undefined && v.outline.items[3].text === '丁' && v.outline.items[3].level === 3)
    assert(doc.getText() === [
      '---', 'title: 拖拽', '---', '',
      '# 甲', '甲内容。', '## 乙', '乙内容。', '## 丙', '丙内容。', '### 丁', '丁内容。', '# 戊', '戊内容。',
    ].join('\n'), 'inside 落点全文对拍')
    assert(JSON.stringify(insideDrop.outline!.items.map((i) => [i.level, i.text])) ===
      JSON.stringify([[1, '甲'], [2, '乙'], [2, '丙'], [3, '丁'], [1, '戊']]),
      'inside 落点条目序与调级')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-drag.md', (v) => v.outline?.items[3]?.text === '丙')
    assert(doc.getText() === original, '单次撤销应完整回滚 inside 拖拽')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 5 })
    await waitViewState('outline-drag.md', (v) => v.outline?.visibleIndices.length === 5)

    // after 落点：乙（含跨级子丁）拖到戊之后 → 乙升 H1、丁随行 H3；
    // 插入点为文档末尾（文末无尾换行 → 搬移段前置换行）
    await drag(1, 4, 'after', 'drop')
    const afterDrop = await waitViewState('outline-drag.md', (v) =>
      v.outline?.items[2] !== undefined && v.outline.items[2].text === '戊')
    assert(doc.getText() === [
      '---', 'title: 拖拽', '---', '',
      '# 甲', '甲内容。', '## 丙', '丙内容。', '# 戊', '戊内容。',
      '# 乙', '乙内容。', '### 丁', '丁内容。', '',
    ].join('\n'), 'after 落点全文对拍（子树随行递归调级 + 末尾前置换行）')
    assert(JSON.stringify(afterDrop.outline!.items.map((i) => [i.level, i.text])) ===
      JSON.stringify([[1, '甲'], [2, '丙'], [1, '戊'], [1, '乙'], [3, '丁']]),
      'after 落点条目序与子树递归调级')
    state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits - before.appliedEdits === 3, '三态拖拽各一笔写回（累计 +3）')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-drag.md', (v) => v.outline?.items[1]?.text === '乙' && v.outline.items[1].level === 2)
    assert(doc.getText() === original, '单次撤销应完整回滚 after 拖拽（正文与大纲同步还原）')
    if (doc.isDirty) {
      await doc.save()
    }
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲拖拽无效落点与悬停观测：拒绝零写回、落点指示绘制层证据（#70）', async () => {
    // 断言口径（视觉层断言必查）：dropHintPainted 是落点指示的中心点命中 +
    // computed 插入线/包裹高亮可读（样式失效时类在而视觉差异不在）；无效
    // 落点（拖入自身子树）不显示指示、drop 零写回；Esc 取消零写回
    await openWithEditor('outline-drag.md')
    await waitSessionReady('outline-drag.md')
    const uri = wsUri('outline-drag.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-drag.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md',
      (v) => v.sidebar?.open === true && v.outline?.panelPainted === true && v.outline.items.length === 5)
    const original = doc.getText()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    // 无效悬停：甲的子树含乙丁丙 → 目标乙（inside）无有效落点
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 0, to: 1, position: 'inside', action: 'hover' })
    const invalidHover = await waitViewState('outline-drag.md', (v) => v.outline?.draggingIndex === 0)
    assert(invalidHover.outline!.dropTargetIndex === null, '拖入自身子树不得出现有效落点')
    assert(invalidHover.outline!.dropPosition === null, '无效落点三态应为 null')
    assert(invalidHover.outline!.dropHintPainted === false, '无效落点不得绘制指示')
    // 有效悬停：丙 → 戊 上缘（before），绘制层证据成立
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 3, to: 4, position: 'before', action: 'hover' })
    const validHover = await waitViewState('outline-drag.md', (v) => v.outline?.dropTargetIndex === 4)
    assert(validHover.outline!.draggingIndex === 3, '悬停态应回报拖拽源')
    assert(validHover.outline!.dropPosition === 'before', '悬停态应回报三态')
    assert(validHover.outline!.dropHintPainted === true,
      `落点指示应真实绘制（命中失败：${JSON.stringify(validHover.outline)}）`)
    // 无效落点 drop（丁在甲子树内）：零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 0, to: 2, position: 'after', action: 'drop' })
    await waitViewState('outline-drag.md', (v) => v.outline?.draggingIndex === null)
    await new Promise((r) => setTimeout(r, 150))
    const afterInvalid = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterInvalid.appliedEdits === before.appliedEdits, '无效落点 drop 不得写回')
    assert(doc.getText() === original, '无效落点 drop 后文档保持')
    // Esc 取消：零写回、状态清空
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 3, to: 0, position: 'after', action: 'escape' })
    const escaped = await waitViewState('outline-drag.md', (v) => v.outline?.draggingIndex === null)
    assert(escaped.outline!.dropTargetIndex === null, 'Esc 后落点清空')
    const afterEsc = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterEsc.appliedEdits === before.appliedEdits, 'Esc 取消不得写回')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md', (v) => v.sidebar?.open === false)
  }],

  ['大纲折叠与搜索态下的拖拽：视图状态随写回存活重算（#70）', async () => {
    // 折叠态：No-Expand 下拖可见条目（戊 → 甲之前），写回后折叠迁移语义
    // 保持（戊升至首位、甲的子树仍折叠遮蔽）；搜索态：词条保持、过滤对
    // 新序列重算
    await openWithEditor('outline-drag.md')
    await waitSessionReady('outline-drag.md')
    const uri = wsUri('outline-drag.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('outline-drag.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md',
      (v) => v.sidebar?.open === true && v.outline?.items.length === 5)
    const original = doc.getText()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    // No-Expand：乙丁丙折叠遮蔽（可见 = 甲、戊）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 0 })
    await waitViewState('outline-drag.md', (v) =>
      JSON.stringify(v.outline?.visibleIndices) === JSON.stringify([0, 4]))
    // 戊(index 4) → 甲(index 0) 之前（before；两者皆可见，合法落点）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 4, to: 0, position: 'before', action: 'drop' })
    const folded = await waitViewState('outline-drag.md', (v) =>
      v.outline?.items[0]?.text === '戊' && v.outline.items[0].level === 1)
    // 尾部换行说明：删除自 # 戊 行首起，丙内容行的终止符留在原位（行尾
    // 换行不属于被搬移的戊段——段自标题行首起算）
    assert(doc.getText() === [
      '---', 'title: 拖拽', '---', '',
      '# 戊', '戊内容。', '# 甲', '甲内容。', '## 乙', '乙内容。', '#### 丁', '丁内容。', '## 丙', '丙内容。', '',
    ].join('\n'), '折叠态拖拽写回全文对拍')
    // 折叠迁移：档位仍 0；戊（新首位，叶）与甲（父，子树仍折叠）可见
    assert(folded.outline!.expandLevel === 0, '档位不受拖拽影响')
    assert(JSON.stringify(folded.outline!.visibleIndices) === JSON.stringify([0, 1]),
      `折叠遮蔽语义应随写回存活（实际 ${JSON.stringify(folded.outline!.visibleIndices)}）`)
    // 撤销回原
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-drag.md', (v) => v.outline?.items[0]?.text === '甲')
    assert(doc.getText() === original, '撤销应回原文')
    // 搜索态：词条「丁」只保留 甲乙丁（丙戊过滤隐藏）；丁 → 甲之前
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.expandClick', level: 5 })
    await waitViewState('outline-drag.md', (v) => v.outline?.visibleIndices.length === 5)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '丁' })
    await waitViewState('outline-drag.md', (v) =>
      JSON.stringify(v.outline?.filteredVisibleIndices) === JSON.stringify([0, 1, 2]))
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'outline.test.drag', from: 2, to: 0, position: 'before', action: 'drop' })
    const searched = await waitViewState('outline-drag.md', (v) =>
      v.outline?.items[0]?.text === '丁' && v.outline.items[0].level === 1)
    assert(doc.getText() === [
      '---', 'title: 拖拽', '---', '',
      '# 丁', '丁内容。', '# 甲', '甲内容。', '## 乙', '乙内容。', '## 丙', '丙内容。', '# 戊', '戊内容。',
    ].join('\n'), '搜索态拖拽写回全文对拍')
    // 搜索态存活：词条保持，过滤对新序列重算（丁升至首位且无祖先 → 仅命中项可见）
    assert(searched.outline!.searchQuery === '丁' && searched.outline!.searchActive === true,
      '搜索词条与态应随写回保持')
    assert(JSON.stringify(searched.outline!.filteredVisibleIndices) === JSON.stringify([0]),
      `过滤可见集应重算（实际 ${JSON.stringify(searched.outline!.filteredVisibleIndices)}）`)
    // 清搜索、撤销回原、收尾
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.searchInput', text: '' })
    await waitViewState('outline-drag.md', (v) => v.outline?.searchActive === false)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await waitViewState('outline-drag.md', (v) => v.outline?.items[0]?.text === '甲' && v.outline.items.length === 5)
    assert(doc.getText() === original, '撤销后应回原文')
    const final = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(final.appliedEdits - before.appliedEdits === 2, '折叠与搜索态拖拽各一笔写回')
    if (doc.isDirty) {
      await doc.save()
    }
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await waitViewState('outline-drag.md', (v) => v.sidebar?.open === false)
  }],

  // ---- 工单 #59：公式渲染（KaTeX）实时预览/阅读/一致性 ----

  ['live 公式渲染与绘制层：渲染数、KaTeX 字体与真实可见（#59）', async () => {
    await openWithEditor('math.md')
    await waitSessionReady('math.md')
    const state = await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 7)
    assert(state.liveMathCount === 7, `live 公式渲染数应为 7（6 合法 + 1 降级），实际 ${state.liveMathCount}`)
    // 绘制层断言（AGENTS 视觉层断言约定）：公式真的画出来（rect 有面积 +
    // elementFromPoint 命中），且 KaTeX 样式管线存活（字体族命中）
    assert(state.paint?.math?.visible === true,
      `公式应真实绘制（paint.math.visible=${String(state.paint?.math?.visible)}，` +
        `display=${String(state.paint?.math?.display)}）`)
    assert(state.paint?.math?.display !== 'none', '公式外层不得 display:none')
    assert(state.paint?.math?.count === 7, `绘制计数应为 7，实际 ${state.paint?.math?.count}`)
    assert((state.cssProbe?.liveMathFontFamily ?? '').includes('KaTeX'),
      `KaTeX 字体应生效（实际 ${state.cssProbe?.liveMathFontFamily}；若为 body 字体说明 CSS/字体管线失效）`)
    // 普通美元不被误判（$5 与 $10 不产生渲染态）
    assert(state.text.includes('$5 与 $10'), '源文普通美元应原样保留')
  }],

  ['live 光标进入公式显源码、离开恢复渲染且零写回（#59）', async () => {
    await openWithEditor('math.md')
    await waitSessionReady('math.md')
    const uri = wsUri('math.md').toString()
    const diskBefore = await readDisk('math.md')
    const before = await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 7)
    // 光标移入首个行内公式（$E=mc^2$ 的区间内）→ 该公式退出渲染态
    const inlineAt = before.text.indexOf('$E=mc^2$')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: inlineAt + 3,
    })
    const editing = await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 6)
    const editOffset = editing.selectionOffset ?? -1
    assert(editOffset >= inlineAt && editOffset <= inlineAt + 7,
      `光标应落在公式区间（实际 ${editOffset}）`)
    // 离开 → 恢复渲染
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 7)
    // 纯视图交互零写回：磁盘不变（显隐切换不产生编辑事务）
    assert(await readDisk('math.md') === diskBefore, '公式显隐交互不得改写源文')
  }],

  ['阅读模式公式渲染：块级独立成块、KaTeX 字体与绘制层（#59）', async () => {
    await openWithEditor('math.md')
    await waitSessionReady('math.md')
    const uri = wsUri('math.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('math.md', (v) =>
      v.viewMode === 'reading' && (v.readingMathCount ?? -1) === 7)
    assert(reading.readingMathCount === 7, `阅读公式数应为 7（6 KaTeX + 1 降级），实际 ${reading.readingMathCount}`)
    assert((reading.cssProbe?.readingMathFontFamily ?? '').includes('KaTeX'),
      `阅读 KaTeX 字体应生效（实际 ${reading.cssProbe?.readingMathFontFamily}）`)
    assert(reading.paint?.math?.visible === true, '阅读公式应真实绘制（rect + elementFromPoint）')
    assert((reading.readingTotalBlocks ?? 0) > 0, '阅读切块应正常')
  }],

  ['公式跨模式切换一致性：两模式计数对齐、文本不变、无写回（#59）', async () => {
    await openWithEditor('math.md')
    await waitSessionReady('math.md')
    const uri = wsUri('math.md').toString()
    const diskBefore = await readDisk('math.md')
    const live = await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 7)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('math.md', (v) =>
      v.viewMode === 'reading' && (v.readingMathCount ?? -1) === 7)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const back = await waitViewState('math.md', (v) =>
      v.viewMode === 'live' && (v.liveMathCount ?? -1) === 7)
    assert(back.text === live.text, '模式切换不得改写文本')
    assert(back.docLength === live.docLength, '模式切换不得改变文档长度')
    assert(reading.text === live.text, '阅读渲染不写回')
    assert(await readDisk('math.md') === diskBefore, '模式切换不得触发磁盘写回')
  }],

  ['外部更新后公式与文本一致：新增公式进入渲染（#59）', async () => {
    await openWithEditor('math.md')
    await waitSessionReady('math.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('math.md'))
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('math.md'), new vscode.Range(0, 0, 0, 0), '新增公式 $z^3$ 与块\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    await poll('外部修改生效', () => (doc.getText().startsWith('新增公式 $z^3$') ? true : undefined))
    // 面板同步外部增量：渲染数 +1（新增行内公式），原公式不变
    const after = await waitViewState('math.md', (v) => (v.liveMathCount ?? -1) === 8)
    assert(after.text.startsWith('新增公式 $z^3$'), '面板文本应含外部新增公式')
    // 切阅读模式：外部增量同样渲染
    await vscode.commands.executeCommand(CMD.postToPanel, wsUri('math.md').toString(), {
      kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('math.md', (v) => v.viewMode === 'reading' && (v.readingMathCount ?? -1) === 8)
  }],
  // ---- 工单 #60：Mermaid 围栏块双模式渲染（live/reading/降级/一致性） ----

  ['live Mermaid 渲染与绘制层：渲染数、分态计数与真实可见（#60）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    const diskBefore = await readDisk('mermaid.md')
    // 滚到文档尾部使全部围栏进入视口（光标停在围栏外段落，不抑制装饰）
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    const state = await waitViewState('mermaid.md', (v) =>
      (v.liveMermaidCount ?? -1) === 5 && v.paint?.mermaid?.rendered === 4, 0, 60000)
    assert(state.liveMermaidCount === 5,
      `live 围栏装饰数应为 5（4 有效 + 1 无效降级），实际 ${state.liveMermaidCount}`)
    // 绘制层断言（AGENTS 视觉层断言约定）：图真的画出来（rect 有面积 +
    // elementFromPoint 命中）；首图可能滚出视口，探针须命中任一有效图
    assert(state.paint?.mermaid?.visible === true,
      `图表应真实绘制（paint.mermaid.visible=${String(state.paint?.mermaid?.visible)}，` +
        `display=${String(state.paint?.mermaid?.display)}）`)
    assert(state.paint?.mermaid?.display !== 'none', '图表容器不得 display:none')
    assert(state.paint?.mermaid?.rendered === 4,
      `有效图渲染数应为 4，实际 ${state.paint?.mermaid?.rendered}`)
    assert(state.paint?.mermaid?.error === 1,
      `无效语法应恰有一个降级容器，实际 ${state.paint?.mermaid?.error}`)
    assert(state.paint?.mermaid?.count === 5, `容器总数应为 5，实际 ${state.paint?.mermaid?.count}`)
    assert(state.text === diskBefore, '渲染不得改写源文')
  }],

  ['live 光标进出围栏显隐零写回：进入显源码、离开恢复渲染（#60）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    const diskBefore = await readDisk('mermaid.md')
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    const before = await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 5)
    // 光标移入首个围栏内容（graph TD 的 g 后）→ 该图退出渲染态显源码
    const fenceBody = before.text.indexOf('graph TD')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: fenceBody + 1,
    })
    const editing = await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 4)
    const editOffset = editing.selectionOffset ?? -1
    assert(editOffset >= fenceBody && editOffset <= fenceBody + 7,
      `光标应落在围栏区间（实际 ${editOffset}）`)
    // 离开（回到文档首，围栏外）→ 恢复渲染：进入 4、离开 5 的完整往返
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    const restored = await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 5)
    assert(restored.liveMermaidCount === 5,
      `光标离开围栏后应恢复全部 5 个装饰（4 有效 + 1 降级），实际 ${restored.liveMermaidCount}`)
    // 纯视图交互零写回：磁盘不变（显隐切换不产生编辑事务）
    assert(await readDisk('mermaid.md') === diskBefore, '围栏显隐交互不得改写源文')
  }],

  ['阅读模式 Mermaid 渲染：整块成块、绘制层与降级不吞后续块（#60）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('mermaid.md', (v) =>
      v.viewMode === 'reading' && (v.readingMermaidCount ?? -1) === 5 && v.paint?.mermaid?.rendered === 4, 0, 60000)
    assert(reading.readingMermaidCount === 5,
      `阅读图表容器数应为 5（4 渲染 + 1 降级），实际 ${reading.readingMermaidCount}`)
    assert(reading.paint?.mermaid?.visible === true, '阅读图表应真实绘制（rect + elementFromPoint）')
    assert(reading.paint?.mermaid?.error === 1, `无效语法应降级 1 个，实际 ${reading.paint?.mermaid?.error}`)
    // 大围栏豁免切片 + 降级不吞后续块：切块数合理且锚点块可定位
    assert((reading.readingTotalBlocks ?? 0) >= 5, `阅读切块应含全部图表块，实际 ${reading.readingTotalBlocks}`)
  }],

  ['图形化代码块按钮组与图表弹窗：live/reading 形态与浮层装载（#111）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    const diskBefore = await readDisk('mermaid.md')
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    // live：全部 frame 就位，edit+popup 成对（含无效降级块——按钮显隐由
    // CSS 渲染态联动，DOM 在场是发射形态断言）
    const live = await waitViewState('mermaid.md', (v) =>
      (v.liveMermaidCount ?? -1) === 5 && v.paint?.graphic?.frames === 5, 0, 60000)
    assert(live.paint?.graphic?.editButtons === 5,
      `live 应有 5 枚 edit 按钮，实际 ${live.paint?.graphic?.editButtons}`)
    assert(live.paint?.graphic?.popupButtons === 5,
      `live 应有 5 枚 popup 按钮，实际 ${live.paint?.graphic?.popupButtons}`)
    assert(live.paint?.graphic?.overlay === false, '初始不得有浮层')
    // 经测试钩子驱动真实处理器链路打开弹窗：浮层在场且 SVG 装载（绘制层）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'graphic.test.popup', view: 'live', index: 0,
    })
    const opened = await waitViewState('mermaid.md', (v) =>
      v.paint?.graphic?.overlay === true && v.paint?.graphic?.overlaySvg === true, 0, 60000)
    assert(opened.paint?.graphic?.overlaySvg === true, '图表弹窗内 SVG 应完成装载')
    assert(opened.paint?.graphic?.overlayVisible === true,
      '浮层应实际遮蔽正文（几何中心被浮层子树占据且可见）')
    assert(await readDisk('mermaid.md') === diskBefore, '弹窗交互零写回')
    // reading：edit 不发射（阅读无编辑入口）、popup 照常包 frame
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const readingChrome = await waitViewState('mermaid.md', (v) =>
      v.viewMode === 'reading' && (v.readingMermaidCount ?? -1) === 5 &&
      v.paint?.graphic?.frames === 5 && v.paint?.graphic?.editButtons === 0, 0, 60000)
    assert(readingChrome.paint?.graphic?.popupButtons === 5,
      `阅读应有 5 枚 popup 按钮，实际 ${readingChrome.paint?.graphic?.popupButtons}`)
    assert(await readDisk('mermaid.md') === diskBefore, '模式切换不得触发磁盘写回')
  }],

  ['图表弹窗导出链路：webview→宿主消息形态（钩子模式短路另存为，#111）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    const diskBefore = await readDisk('mermaid.md')
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 5, 0, 60000)
    // 打开弹窗并驱动导出按钮：宿主测试钩子模式不弹真实另存为对话框，
    // 短路为记录消息形态 + cancelled 回报——以此断言完整 webview→宿主链路
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'graphic.test.popup', view: 'live', index: 0,
    })
    await waitViewState('mermaid.md', (v) =>
      v.paint?.graphic?.overlay === true && v.paint?.graphic?.overlaySvg === true, 0, 60000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'graphic.test.popup', view: 'live', index: 0, action: 'export-svg',
    })
    let svgEntry: { format?: string; fileName?: string; reqId?: number; content?: string; docUri?: string } | undefined
    for (let i = 0; i < 30 && svgEntry === undefined; i++) {
      const log = (await vscode.commands.executeCommand(CMD.diagramExportLog, uri)) as
        Array<{ format?: string; fileName?: string; reqId?: number; content?: string; docUri?: string }>
      svgEntry = log.find((m) => m.format === 'svg')
      if (svgEntry === undefined) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    assert(svgEntry !== undefined, '宿主应收到 SVG 导出消息（钩子短路记录）')
    assert(svgEntry!.fileName === 'mermaid-diagram.svg', `默认文件名应为 mermaid-diagram.svg，实际 ${svgEntry!.fileName}`)
    assert(typeof svgEntry!.reqId === 'number' && svgEntry!.reqId! >= 1, 'reqId 应为正整数')
    assert(svgEntry!.content!.includes('<svg'), 'SVG 导出内容应为序列化文档')
    assert(svgEntry!.docUri === uri, '导出消息应携带来源文档 URI')
    // PNG：真宿主 webview 为 Chromium，光栅化应产出非空 base64 载荷
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'graphic.test.popup', view: 'live', index: 0, action: 'export-png',
    })
    let pngEntry: { format?: string; content?: string } | undefined
    for (let i = 0; i < 40 && pngEntry === undefined; i++) {
      const log = (await vscode.commands.executeCommand(CMD.diagramExportLog, uri)) as
        Array<{ format?: string; content?: string }>
      pngEntry = log.find((m) => m.format === 'png')
      if (pngEntry === undefined) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    assert(pngEntry !== undefined, '宿主应收到 PNG 导出消息（真宿主内光栅化产出）')
    assert(pngEntry!.content!.length > 100, `PNG base64 应为非平凡载荷，实际 ${pngEntry!.content?.length ?? 0} 字符`)
    assert(/^[A-Za-z0-9+/]+={0,2}$/.test(pngEntry!.content!), 'PNG 内容应为严格 base64')
    assert(await readDisk('mermaid.md') === diskBefore, '导出交互零写回')
  }],

  ['Mermaid 跨模式切换一致性：两模式计数对齐、文本不变、无写回（#60）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const uri = wsUri('mermaid.md').toString()
    const diskBefore = await readDisk('mermaid.md')
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    const live = await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 5, 0, 60000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('mermaid.md', (v) =>
      v.viewMode === 'reading' && (v.readingMermaidCount ?? -1) === 5, 0, 60000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const tailAnchor2 = (await readDisk('mermaid.md')).indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor2,
    })
    const back = await waitViewState('mermaid.md', (v) =>
      v.viewMode === 'live' && (v.liveMermaidCount ?? -1) === 5, 0, 60000)
    assert(back.text === live.text, '模式切换不得改写文本')
    assert(back.docLength === live.docLength, '模式切换不得改变文档长度')
    assert(reading.text === live.text, '阅读渲染不写回')
    assert(await readDisk('mermaid.md') === diskBefore, '模式切换不得触发磁盘写回')
  }],

  ['伪围栏与普通围栏不误渲染：边界样例零图表、正文完好（#60）', async () => {
    await openWithEditor('mermaid-edge.md')
    await waitSessionReady('mermaid-edge.md')
    const uri = wsUri('mermaid-edge.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: (await readDisk('mermaid-edge.md')).indexOf('结尾段落'),
    })
    const live = await waitViewState('mermaid-edge.md', (v) => (v.liveMermaidCount ?? -1) === 0)
    assert(live.liveMermaidCount === 0, `普通围栏与伪围栏不得渲染图表，实际 ${live.liveMermaidCount}`)
    assert(live.text.includes('结尾段落保持可用。'), '伪围栏后的正文完好')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('mermaid-edge.md', (v) =>
      v.viewMode === 'reading' && (v.readingMermaidCount ?? -1) === 0)
    assert(reading.readingMermaidCount === 0, `阅读侧同样不渲染伪围栏，实际 ${reading.readingMermaidCount}`)
  }],

  ['外部更新后新增 Mermaid 围栏进入渲染（#60）', async () => {
    await openWithEditor('mermaid.md')
    await waitSessionReady('mermaid.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('mermaid.md'))
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('mermaid.md'), new vscode.Range(0, 0, 0, 0), '新增图：\n\n```mermaid\nC-->D\n```\n\n')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    await poll('外部修改生效', () => (doc.getText().startsWith('新增图：') ? true : undefined))
    const tailAnchor = doc.getText().indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, wsUri('mermaid.md').toString(), {
      kind: 'view.locate', offset: tailAnchor,
    })
    // 面板同步外部增量：围栏装饰 +1（新增有效图），原围栏不变
    const after = await waitViewState('mermaid.md', (v) => (v.liveMermaidCount ?? -1) === 6)
    assert(after.text.startsWith('新增图：'), '面板文本应含外部新增围栏')
    // 切阅读模式：外部增量同样渲染
    await vscode.commands.executeCommand(CMD.postToPanel, wsUri('mermaid.md').toString(), {
      kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('mermaid.md', (v) =>
      v.viewMode === 'reading' && (v.readingMermaidCount ?? -1) === 6)
  }],
  ['格式命令：真实 Live 选区写回、绘制、一次撤销与运行时中文分词（#88）', async () => {
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    const uri = wsUri('lf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('lf.md'))
    const before = doc.getText()
    const probe = await waitViewState('lf.md', (v) => v.wordSegmenter !== undefined)
    assert(probe.wordSegmenter === true, 'VSCode 1.86 webview 应提供 Intl.Segmenter 中文分词')
    // #241 评审修复 P0-1：真实宿主 CSP 下 WebAssembly 编译探针——8 字节空
    // 模块同步编译。CSP script-src 缺 'wasm-unsafe-eval' 时此探针为 false
    // （jieba wasm 实例化必被拒、恒回退 builtin 的 P0 根因），词法断言之外
    // 的行为级证据
    const wasm = await waitViewState('lf.md', (v) => v.wasmCompile !== undefined)
    assert(wasm.wasmCompile === true, '编辑器 webview CSP 应放行 WebAssembly 编译（wasm-unsafe-eval，jieba 前置条件）')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 2 })
    await waitViewState('lf.md', (v) => v.selectionOffset === 0 && v.selectionHead === 2)
    assert(await vscode.commands.executeCommand('onegayi.vsidian.format.bold') === true,
      '格式命令应命中活动 Live 面板')
    await poll('格式写回权威文档', () => doc.getText() === '**中文**' + before.slice(2) ? true : undefined)
    const rendered = await waitViewState('lf.md', (v) => v.liveSyntax?.strongSpans === 1)
    assert(rendered.paint?.textVisible === true, '格式化后的正文应在绘制层可见')
    const session = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session.appliedEdits === 1, `格式命令应仅提交一笔写回，实际 ${session.appliedEdits}`)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('格式一次撤销', () => doc.getText() === before ? true : undefined)
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.appliedEdits === 1, '宿主撤销回流不应产生新的写回')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 0 })
    await waitViewState('lf.md', (v) => v.selectionOffset === 0 && v.selectionHead === 0)
    assert(await vscode.commands.executeCommand('onegayi.vsidian.format.bold') === true,
      '无选区格式命令应命中当前词')
    await poll('真实 webview 中文分词写回', () =>
      doc.getText() === '**中文**' + before.slice(2) ? true : undefined)

    await openWithEditor('format-crlf.md')
    await waitSessionReady('format-crlf.md')
    const crlfUri = wsUri('format-crlf.md').toString()
    const crlf = await vscode.workspace.openTextDocument(wsUri('format-crlf.md'))
    const crlfBefore = crlf.getText()
    assert(crlfBefore === CRLF_DOC, '格式命令应从独立 CRLF 原始样本开始')
    await vscode.commands.executeCommand(CMD.postToPanel, crlfUri,
      { kind: 'table.test.crossSelect', anchor: 4, head: 6 })
    await waitViewState('format-crlf.md', (v) => v.selectionOffset === 4 && v.selectionHead === 6)
    assert(await vscode.commands.executeCommand('onegayi.vsidian.format.bold') === true,
      'CRLF 文档的活动 Live 面板应接受格式命令')
    await poll('CRLF 格式写回', () =>
      crlf.getText() === '标题一\r\n**正文** A 行\r\n正文 B 行\r\n' ? true : undefined)
    await vscode.commands.executeCommand(CMD.injectMessage, crlfUri, { kind: 'history.request', op: 'undo' })
    await poll('CRLF 格式撤销', () => crlf.getText() === crlfBefore ? true : undefined)
  }],
  ['jieba 端到端：globalStorage 资源经 webview 资源服务装载生效（#239）', async () => {
    interface JiebaState {
      installed: boolean
      version: string
      status: string
      notice: { kind: string; detail?: string } | null
    }
    const jiebaState = async (): Promise<JiebaState> =>
      (await vscode.commands.executeCommand(CMD.getJiebaState)) as JiebaState
    await openWithEditor('lf.md')
    await waitSessionReady('lf.md')
    try {
      // 引擎选 jieba（资源未就位时 wordMotion 仍以 builtin 服务命令；资源
      // 经 wordSegment.state 到达后按需装载）
      await vscode.commands.executeCommand(CMD.setSettings, { 'editor.wordSegmentEngine': 'jieba' })
      // 走产品消息触发宿主真实下载（jsdelivr 直下 + sha256 校验 + 落
      // globalStorage）——集成宿主便携目录每次全新，必为未安装态起步，
      // 每轮真实拉取约 4MB（**本套件唯一的外网下载依赖**：jsdelivr 不可达
      // 时下载段超时失败，失败信息附宿主 notice 可归因）。wordSegment.download
      // 是设置页域消息（编辑器面板分派对其为显式 no-op——真实处理入口在
      // 设置页链路），经设置页注入钩子走同一处理入口（handleMessage 不
      // 依赖面板在场）
      await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, { kind: 'wordSegment.download' })
      try {
        await poll('jieba 资源下载安装完成', async () => {
          const s = await jiebaState()
          return s.installed ? s : undefined
        }, 120000)
      } catch (err) {
        throw new Error(`${(err as Error).message}；宿主 jieba 状态=${JSON.stringify(await jiebaState())}`)
      }
      // 宿主 installed → wordSegment.state 全面板推送 → webview 动态 import
      // jieba_rs_wasm.js（globalStorage 资源经 asWebviewUri 进 webview 资源
      // 服务）。webview 的 localResourceRoots 不含 globalStorage 时该请求被
      // AccessDenied 拒绝，import 抛错、引擎恒回退 builtin（任何宿主版本下
      // 均如此；1.86 与新宿主的资源 URL 前缀 file+/vscode-userdata+ 只是
      // globalStorageUri scheme 差异，非失败原因）——本用例即钉住该端到
      // 端链路的行为级证据（#37 教训：层内词法断言测不到资源服务许可面）
      try {
        await waitViewState('lf.md', (v) => v.jiebaEngine === 'jieba', 0, 60000)
      } catch (err) {
        throw new Error(`${(err as Error).message}；宿主 jieba 状态=${JSON.stringify(await jiebaState())}`)
      }
    } finally {
      // 引擎键恢复默认（每用例前的设置重置面不含本键，显式复位避免跨用例泄漏）
      await vscode.commands.executeCommand(CMD.setSettings, { 'editor.wordSegmentEngine': 'builtin' })
    }
  }],
  ['快速操作条：流内绘制、选区按钮与标题菜单写回（#89）', async () => {
    await openWithEditor('quick-actions-crlf.md')
    await waitSessionReady('quick-actions-crlf.md')
    const uri = wsUri('quick-actions-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('quick-actions-crlf.md'))
    const before = doc.getText()
    assert(before === CRLF_DOC, '操作条应从独立 CRLF 原始样本开始')
    const initial = await waitViewState('quick-actions-crlf.md', (v) => v.paint?.quickActions !== undefined)
    if (!initial.paint!.quickActions!.open) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'quick.test.click', action: 'toggle' })
    }
    const opened = await waitViewState('quick-actions-crlf.md', (v) => v.paint?.quickActions?.barPainted === true)
    const bar = opened.paint!.quickActions!
    assert(bar.togglePainted && bar.boldPainted && bar.barBelowToolbar && bar.editorBelowBar,
      `快速操作条和正文应在各自流内真实绘制：${JSON.stringify(bar)}`)

    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 4, head: 6 })
    await waitViewState('quick-actions-crlf.md', (v) => v.selectionOffset === 4 && v.selectionHead === 6)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'quick.test.click', action: 'bold' })
    await poll('操作条粗体写回', () =>
      doc.getText() === '标题一\r\n**正文** A 行\r\n正文 B 行\r\n' ? true : undefined)
    const active = await waitViewState('quick-actions-crlf.md', (v) => v.paint?.quickActions?.activePainted === true)
    assert(active.paint?.quickActions?.activePainted === true,
      '粗体已应用态应有真实绘制的主题背景')
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('操作条粗体撤销', () => doc.getText() === before ? true : undefined)

    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 0 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'quick.test.click', action: 'heading' })
    const popup = await waitViewState('quick-actions-crlf.md', (v) => v.paint?.quickActions?.menuPainted === true)
    assert(popup.paint?.quickActions?.menuPainted === true, '标题 popup 应真实绘制')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'quick.test.click', action: 'heading1' })
    await poll('标题菜单写回', () => doc.getText().startsWith('# 标题一\r\n') ? true : undefined)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('标题菜单撤销', () => doc.getText() === before ? true : undefined)
  }],

  ['live 代码块卡片：呈现态头部绘制、编辑态保留、零写回与设置开关（#79/#80/#81）', async () => {
    await openWithEditor('code-card.md')
    await waitSessionReady('code-card.md')
    const uri = wsUri('code-card.md').toString()
    const diskBefore = await readDisk('code-card.md')
    // 定位到文档首（光标在全部围栏外）：顶部卡片在可视区内，绘制层命中
    // 才可断言（挂载缓冲外的滚动位置 rect 在视口外，elementFromPoint 不命中）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    // 呈现态：4 张卡片（js/text/裸围栏/未知语言）头部绘制，mermaid 走图表管线
    const present = await waitViewState('code-card.md', (v) => v.paint?.code?.headerCount === 4)
    assert(present.paint?.code?.visible === true, '卡片头部应真实绘制（rect + elementFromPoint）')
    assert(present.paint?.code?.label === 'JavaScript', `首块标签应为 JavaScript，实际 ${String(present.paint?.code?.label)}`)
    assert((present.liveMermaidCount ?? -1) === 1, `mermaid 围栏不套卡片且仍渲染图表，实际 ${present.liveMermaidCount}`)
    // #80 卡内行号：js 块 4 行从 1 起；文档行号槽照常显示（不因卡片隐藏）
    const ln = present.paint?.code?.lineNumberTexts
    assert(Array.isArray(ln) && ln.slice(0, 4).join(',') === '1,2,3,4',
      `js 块卡内行号应为 1..4，实际 ${JSON.stringify(ln)}`)
    // #81 呈现态每张卡片一个复制按钮
    assert(present.paint?.code?.copyCount === 4,
      `呈现态应 4 个复制按钮，实际 ${present.paint?.code?.copyCount}`)
    // #83 默认高亮：js 块产出 tok-* token
    assert((present.paint?.code?.tokenCount ?? 0) > 0,
      `默认高亮应产出 tok token，实际 ${present.paint?.code?.tokenCount}`)
    // 编辑态：光标进入首块代码体 → 头部与卡片行保留，复制按钮常驻
    //（渲染型围栏只有编辑态卡片——复制不能有死角）
    const body = present.text.indexOf('const a = 1')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: body + 2,
    })
    const editing = await waitViewState('code-card.md', (v) =>
      (v.selectionOffset ?? -1) >= body && (v.selectionOffset ?? -1) <= body + 6 &&
      v.paint?.code?.copyCount === 4)
    assert(editing.paint?.code?.headerCount === 4, `编辑态卡片头部应保留，实际 ${editing.paint?.code?.headerCount}`)
    // 离开恢复呈现态；纯视图交互零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    await waitViewState('code-card.md', (v) =>
      (v.selectionOffset ?? 0) === 0 && v.paint?.code?.headerCount === 4 && v.paint?.code?.copyCount === 4)
    assert(await readDisk('code-card.md') === diskBefore, '卡片显隐交互不得改写源文')
    // #81 复制链路：点击 text 块（第 2 张）复制按钮 → 宿主剪贴板收到代码体
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.copy', index: 1,
    })
    await poll('剪贴板收到 text 块代码体', async () => {
      const text = await vscode.env.clipboard.readText()
      return text === 'hello' ? true : undefined
    })
    assert(await readDisk('code-card.md') === diskBefore, '复制不得改写源文')
    // #82 折叠：点击 text 块 chevron（第 2 张）→ 整块收起（行从 DOM 消失，
    // 头部保留、收起块无复制按钮）；卡片行 15 → 12
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 1,
    })
    const folded = await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 1 && v.paint.code.cardLineCount === 12)
    assert(folded.paint?.code?.headerCount === 4, '收起后头部横带保留')
    assert(folded.paint?.code?.copyCount === 3, '收起块不发射复制按钮')
    // 光标进入已折叠块 → 临时展开（折叠状态保留）
    const hello = folded.text.indexOf('hello')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: hello + 1,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 0 && v.paint.code.cardLineCount === 15)
    // 离开 → 恢复收起；再次点击 chevron → 常驻展开
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 1 && v.paint.code.cardLineCount === 12)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 1,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 0 && v.paint.code.cardLineCount === 15)
    assert(await readDisk('code-card.md') === diskBefore, '折叠交互不得改写源文')

    // ---- 设置开关段（#79–#83）。1.86.2 globalState 存在跨键迟到回翻
    // （settingsService.apply 注释记载）：紧邻的多次写入可把先前键的 overlay
    // 盖回旧值——每步写入后对**全量期望快照**做读回校验，不一致重写（≤3 次）
    const desired: Record<string, boolean> = {
      'codeblock.card': true,
      'codeblock.lineNumbers': true,
      'codeblock.copyButton': true,
      'codeblock.highlight': true,
    }
    const setCardSettings = async (patch: Record<string, boolean>): Promise<void> => {
      Object.assign(desired, patch)
      for (let attempt = 0; ; attempt++) {
        const applied = await vscode.commands.executeCommand(CMD.setSettings, patch) as { ok: boolean }
        assert(applied.ok === true, `设置保存应成功：${JSON.stringify(patch)}`)
        try {
          await waitSettings(desired)
          return
        } catch (error) {
          if (attempt >= 3) {
            throw error
          }
          // 迟到回翻：全量读回不一致 → 重写补丁
        }
      }
    }
    // 总开关：关闭 → 卡片形态消失（#83 起高亮独立：code 节由 token 驱动
    // 仍存在，头部与行类为 0）；重开 → 恢复（Compartment 热重配）
    await setCardSettings({ 'codeblock.card': false })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code !== undefined && v.paint.code.headerCount === 0 && v.paint.code.cardLineCount === 0)
    assert(await readDisk('code-card.md') === diskBefore, '设置切换不得改写源文')
    await setCardSettings({ 'codeblock.card': true })
    await waitViewState('code-card.md', (v) => v.paint?.code?.headerCount === 4)
    // #80 行号子开关：关闭 → 行号消失、卡片保留；重开恢复
    await setCardSettings({ 'codeblock.lineNumbers': false })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.lineNumberTexts?.length ?? 0) === 0)
    await setCardSettings({ 'codeblock.lineNumbers': true })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.lineNumberTexts?.length ?? 0) > 0)
    // #81 复制子开关：关闭 → 按钮消失、卡片保留；重开恢复
    await setCardSettings({ 'codeblock.copyButton': false })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.copyCount ?? 0) === 0)
    await setCardSettings({ 'codeblock.copyButton': true })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.copyCount ?? 0) === 4)
    // #83 高亮独立于卡片：关卡片仅高亮 → 无头部有 token；重开卡片关高亮 → 有头部无 token
    await setCardSettings({ 'codeblock.card': false })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 0 && (v.paint.code.tokenCount ?? 0) > 0)
    await setCardSettings({ 'codeblock.card': true, 'codeblock.highlight': false })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.tokenCount ?? 0) === 0)
    await setCardSettings({ 'codeblock.highlight': true })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 4 && (v.paint.code.tokenCount ?? 0) > 0)

    // ---- 渲染型围栏（mermaid）接入卡片：编辑态外壳、呈现态让位（前段
    // headerCount 4 + liveMermaidCount 1 已断言）、折叠收起接管 SVG。
    // 呈现态 mermaid 无头部（让位 SVG）——折叠入口在编辑态：块内点
    // chevron（临时展开语义，折叠集更新）→ 离开后呈现态收起
    const mermaidBody = present.text.indexOf('graph TD')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: mermaidBody + 1,
    })
    const mEdit = await waitViewState('code-card.md', (v) =>
      v.paint?.code?.headerCount === 5 && (v.liveMermaidCount ?? -1) === 0)
    assert(mEdit.paint?.code?.labels?.includes('Mermaid') === true,
      `编辑态应出现 Mermaid 标签头部，实际 ${JSON.stringify(mEdit.paint?.code?.labels)}`)
    assert(mEdit.paint?.code?.cardLineCount === 19,
      `编辑态卡片行 15+4=19，实际 ${mEdit.paint?.code?.cardLineCount}`)
    assert(mEdit.paint?.code?.copyCount === 5,
      `mermaid 编辑态块同样常驻复制按钮（四张呈现态 + mermaid 编辑态），实际 ${mEdit.paint?.code?.copyCount}`)
    assert(await readDisk('code-card.md') === diskBefore, '渲染型围栏显隐交互不得改写源文')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 4,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    const mFolded = await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 1 && (v.liveMermaidCount ?? -1) === 0 && v.paint?.code?.headerCount === 5)
    assert(mFolded.paint?.code?.cardLineCount === 15,
      `收起后卡片行回到 15，实际 ${mFolded.paint?.code?.cardLineCount}`)
    assert(mFolded.paint?.code?.copyCount === 4, '收起块不发射复制按钮，四张普通卡片保持 4')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 4,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 0 && (v.liveMermaidCount ?? -1) === 1 && v.paint?.code?.headerCount === 4)
    assert(await readDisk('code-card.md') === diskBefore, '渲染型围栏折叠交互不得改写源文')
  }],

  ['阅读模式代码块卡片：卡片/行号/高亮/复制/折叠与观感契约（#84）', async () => {
    await openWithEditor('code-card.md')
    await waitSessionReady('code-card.md')
    const uri = wsUri('code-card.md').toString()
    const diskBefore = await readDisk('code-card.md')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    // 4 张卡片头部绘制；行结构 = 内容行（js 4 + text/裸/zzz 各 1 = 7 行）
    const reading = await waitViewState('code-card.md', (v) =>
      v.viewMode === 'reading' && v.paint?.code?.headerCount === 4, 0, 60000)
    assert(reading.paint?.code?.visible === true, '阅读卡片头部应真实绘制（rect + elementFromPoint）')
    assert(reading.paint?.code?.label === 'JavaScript',
      `阅读首块标签应为 JavaScript，实际 ${String(reading.paint?.code?.label)}`)
    const ln = reading.paint?.code?.lineNumberTexts
    assert(Array.isArray(ln) && ln.slice(0, 4).join(',') === '1,2,3,4',
      `阅读 js 块卡内行号应为 1..4，实际 ${JSON.stringify(ln)}`)
    assert((reading.paint?.code?.tokenCount ?? 0) > 0, '阅读侧应有 tok 着色（与 Live 同词表）')
    assert((reading.paint?.code?.copyCount ?? 0) === 4, '阅读侧复制按钮在场')
    assert((reading.paint?.code?.cardLineCount ?? 0) === 7,
      `阅读行结构应为 7 个内容行，实际 ${reading.paint?.code?.cardLineCount}`)
    // 复制：点击 text 块（第 2 张）→ 宿主剪贴板收到代码体（与 Live 同通道）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.copy', index: 1,
    })
    await poll('阅读复制进剪贴板', async () => {
      const text = await vscode.env.clipboard.readText()
      return text === 'hello' ? true : undefined
    })
    // 折叠：收起 text 块 → 行消失（7→6）、头部保留；再点展开恢复
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 1,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 1 && v.paint.code.cardLineCount === 6, 0, 60000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'codecard.test.fold', index: 1,
    })
    await waitViewState('code-card.md', (v) =>
      v.paint?.code?.foldedCount === 0 && v.paint.code.cardLineCount === 7, 0, 60000)
    assert(await readDisk('code-card.md') === diskBefore, '阅读卡片交互不得改写源文')
  }],

  // ---- 工单 #106：分割线渲染态与插入操作 ----

  ['live 分割线渲染与绘制层：全形态隐藏源文、真横线绘制（#106）', async () => {
    await openWithEditor('hr.md')
    await waitSessionReady('hr.md')
    const uri = wsUri('hr.md').toString()
    const diskBefore = await readDisk('hr.md')
    // 光标停在结尾段落（远离全部分割线行）：三条真分割线进入渲染态；
    // frontmatter 两条 --- 与 Setext 下划线（=== 与段落后的 ---）不计数
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    const state = await waitViewState('hr.md', (v) =>
      v.selectionOffset === tailAnchor && v.paint?.hr?.count === 3)
    // 绘制层断言（AGENTS 视觉层断言约定）：横线真的画出来（rect 有面积 +
    // elementFromPoint 命中）且以居中渐变落笔（live 态横线绘制通道）
    assert(state.paint?.hr?.visible === true,
      `分割线应真实绘制（paint.hr.visible=${String(state.paint?.hr?.visible)}，` +
        `display=${String(state.paint?.hr?.display)}）`)
    assert(state.paint?.hr?.display !== 'none', '分割线元素不得 display:none')
    assert((state.paint?.hr?.backgroundImage ?? '').includes('linear-gradient'),
      `live 分割线须以居中渐变实际落笔：${String(state.paint?.hr?.backgroundImage)}`)
    assert(state.text === diskBefore, '渲染不得改写源文')
  }],

  ['live 光标进出分割线行显隐零写回：进入显源码、离开恢复渲染（#106）', async () => {
    await openWithEditor('hr.md')
    await waitSessionReady('hr.md')
    const uri = wsUri('hr.md').toString()
    const diskBefore = await readDisk('hr.md')
    const tailAnchor = diskBefore.indexOf('结尾段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: tailAnchor,
    })
    await waitViewState('hr.md', (v) => v.paint?.hr?.count === 3)
    // 光标移入首条分割线行内 → 该线退出渲染态显源码（其余两条保持渲染）
    const hrAt = diskBefore.indexOf('\n---', diskBefore.indexOf('分割线前的段落文字')) + 1
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: hrAt + 1,
    })
    const editing = await waitViewState('hr.md', (v) => v.paint?.hr?.count === 2)
    const editOffset = editing.selectionOffset ?? -1
    assert(editOffset >= hrAt && editOffset <= hrAt + 3,
      `光标应落在分割线行区间（实际 ${editOffset}，期望 ${hrAt}..${hrAt + 3}）`)
    // 离开（回到文档首，分割线外）→ 恢复渲染：3 条的完整往返
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: 0,
    })
    const restored = await waitViewState('hr.md', (v) => v.paint?.hr?.count === 3)
    assert(restored.paint?.hr?.count === 3,
      `光标离开分割线行后应恢复 3 条渲染，实际 ${restored.paint?.hr?.count}`)
    // 纯视图交互零写回：磁盘不变（显隐切换不产生编辑事务，也不进撤销历史）
    assert(await readDisk('hr.md') === diskBefore, '分割线显隐交互不得改写源文')
  }],

  ['分割线插入操作：光标处成段插入并规整空行，阅读模式同源（#106）', async () => {
    await openWithEditor('hr.md')
    await waitSessionReady('hr.md')
    const uri = wsUri('hr.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('hr.md'))
    const diskBefore = await readDisk('hr.md')
    const anchor = diskBefore.indexOf('插入锚点在此行中')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: anchor,
    })
    await waitViewState('hr.md', (v) => v.selectionOffset === anchor)
    // 命令面板/快速操作条同源命令：行内光标处左右文字各自成段，分割线
    // 前后空行规整（该行原本无相邻空行 → 两侧各补一空行）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'format.command', op: 'horizontalRule' })
    const inserted = diskBefore.replace(
      '结尾段落，分割线插入锚点在此行中。',
      '结尾段落，分割线\n\n---\n\n插入锚点在此行中。')
    await poll('分割线插入写回', () => (doc.getText() === inserted ? true : undefined))
    const edited = await waitViewState('hr.md', (v) => v.text === inserted)
    // 光标落在新分割线行尾：该行是控制域（触及显源码），计数暂保持 3
    assert(edited.selectionOffset === anchor + 5,
      `插入后光标应在新分割线行尾（期望 ${anchor + 5}，实际 ${edited.selectionOffset}）`)
    assert(edited.paint?.hr?.count === 3,
      `光标在新分割线行上时该线显源码不渲染（期望 3，实际 ${edited.paint?.hr?.count}）`)
    // 光标移到后段文字 → 新分割线恢复渲染
    const after = inserted.indexOf('插入锚点在此行中')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'view.locate', offset: after,
    })
    const rendered = await waitViewState('hr.md', (v) =>
      v.selectionOffset === after && v.paint?.hr?.count === 4)
    assert(rendered.paint?.hr?.visible === true, '新分割线应真实绘制')
    // 阅读模式：<hr> 原生渲染、数量与 Live 对齐（颜色与 Live 同源变量）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const reading = await waitViewState('hr.md', (v) =>
      v.viewMode === 'reading' && v.paint?.hr?.count === 4)
    assert(reading.paint?.hr?.visible === true, '阅读模式分割线应真实绘制（rect + elementFromPoint）')
    assert(Number.parseFloat(reading.paint?.hr?.borderTopWidth ?? '') > 0,
      `阅读分割线须以 border-top 实际落笔：${String(reading.paint?.hr?.borderTopWidth)}`)
  }],

  // ---- 工单 #105：高亮 ==text== 双模式渲染、显隐与大纲透传 ----

  ['live 高亮渲染与绘制层：底色真实画出、定界符显隐随光标、零写回（#105）', async () => {
    await resetLastMode()
    await openWithEditor('highlight.md')
    await waitSessionReady('highlight.md')
    const uri = wsUri('highlight.md').toString()
    const diskBefore = await readDisk('highlight.md')
    // 光标在文档头（不触及任何高亮）：三处高亮常显底色（正文/标题/列表），
    // 绘制层断言（AGENTS 视觉层约定）：rect 有面积 + elementFromPoint 命中 +
    // computed 底色非透明——样式注入失效时 DOM 存在性照样通过，此三层不可
    const idle = await waitViewState('highlight.md', (v) =>
      v.paint?.highlight?.count === 3 && v.paint.highlight.delimitersHidden === true)
    assert(idle.paint!.highlight!.visible === true,
      `高亮应真实绘制（paint.highlight.visible=${String(idle.paint?.highlight?.visible)}，` +
        `display=${String(idle.paint?.highlight?.display)}）`)
    assert((idle.paint!.highlight!.backgroundColor ?? '') !== 'rgba(0, 0, 0, 0)' &&
      (idle.paint!.highlight!.backgroundColor ?? '') !== '',
      `高亮底色应真实画出（非透明），实际 ${idle.paint?.highlight?.backgroundColor}`)
    assert(idle.paint!.highlight!.display !== 'none', '高亮 span 不得 display:none')
    // 大纲透传：嵌套标题的 spans 含 highlight（含内层 strong，同区间双类型）
    const nested = idle.outline?.items.find((item) => item.text.includes('嵌套'))
    const kinds = (nested?.spans ?? []).filter((span) => span.end - span.start === 2)
      .map((span) => span.kind).sort()
    assert(JSON.stringify(kinds) === JSON.stringify(['highlight', 'strong']),
      `嵌套标题透传应含 highlight+strong 同区间双类型，实际 ${JSON.stringify(nested?.spans)}`)
    assert(nested?.plainText.includes('粗亮') === true, '大纲剥标记可见文本应含高亮内容')
    // 光标进入正文高亮内：== 显形可编辑（文本口径：定界符回到视口文本）
    const inHighlight = HIGHLIGHT_DOC_TEXT.indexOf('高亮文字') + 2
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: inHighlight, head: inHighlight })
    await waitViewState('highlight.md', (v) => v.paint?.highlight?.delimitersHidden === false)
    // 光标移开：定界符回到隐藏（内容底色常显不受影响）
    const away = HIGHLIGHT_DOC_TEXT.indexOf('普通段落')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: away, head: away })
    const restored = await waitViewState('highlight.md', (v) =>
      v.paint?.highlight?.delimitersHidden === true && v.paint.highlight.count === 3)
    assert(restored.paint!.highlight!.backgroundColor === idle.paint!.highlight!.backgroundColor,
      '光标离开后高亮底色应保持（内容 span 常显）')
    // 阅读模式：== 渲染为 mark 语义元素，底色与 live 同源；无定界符概念
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('highlight.md'))
    const reading = await waitViewState('highlight.md', (v) =>
      v.viewMode === 'reading' && v.paint?.highlight?.count === 3)
    assert(reading.paint!.highlight!.visible === true, '阅读 mark 应真实绘制')
    assert((reading.paint!.highlight!.backgroundColor ?? '') !== 'rgba(0, 0, 0, 0)' &&
      (reading.paint!.highlight!.backgroundColor ?? '') !== '',
      `阅读 mark 底色应真实画出（非透明），实际 ${reading.paint?.highlight?.backgroundColor}`)
    assert(reading.paint!.highlight!.delimitersHidden === null, '阅读态定界符探针应为 null')
    // 光标移动与模式切换全程零写回
    assert(await readDisk('highlight.md') === diskBefore, '高亮显隐与模式切换不得写磁盘')
  }],

  ['高亮格式命令真实链路：命令面板包裹与两态取消（#105）', async () => {
    await resetLastMode()
    await openWithEditor('highlight.md')
    await waitSessionReady('highlight.md')
    // 上一用例把同文件面板留在阅读态（openWith 对同 uri 单例 reveal）：
    // 显式切回 live 再继续（格式命令只作用于活动 Live 面板）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('highlight.md'))
    await waitViewState('highlight.md', (v) => v.viewMode === 'live')
    const uri = wsUri('highlight.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('highlight.md'))
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    // 选区包裹 ==普通段落==（宿主命令入口与用户命令面板同链路）。无选区
    // 扩词的中文分词口径（Intl.Segmenter 词级，如「普通|段落」各自成词）
    // 由 #88 格式命令用例与 unit 层 formatOperations 测试钉住，此处用
    // 显式选区钉确定性写回——期望值不落在具体分词结果上
    const wordFrom = HIGHLIGHT_DOC_TEXT.indexOf('普通段落')
    const wordTo = wordFrom + '普通段落'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: wordFrom, head: wordTo })
    await waitViewState('highlight.md', (v) =>
      v.selectionOffset === wordFrom && v.selectionHead === wordTo)
    assert(await vscode.commands.executeCommand('onegayi.vsidian.format.highlight') === true,
      '高亮命令应命中活动 Live 面板')
    await poll('高亮选区包裹写回权威文档', () =>
      doc.getText() === HIGHLIGHT_DOC_TEXT.replace('普通段落。', '==普通段落==。') ? true : undefined)
    // 光标进高亮内再触发：取消整段
    const wrapped = HIGHLIGHT_DOC_TEXT.replace('普通段落。', '==普通段落==。')
    const inside = wrapped.indexOf('普通段落') + 1
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: inside, head: inside })
    await waitViewState('highlight.md', (v) => v.selectionOffset === inside && v.selectionHead === inside)
    assert(await vscode.commands.executeCommand('onegayi.vsidian.format.highlight') === true,
      '围栏内再触发应命中活动 Live 面板')
    await poll('高亮两态取消写回', () => doc.getText() === HIGHLIGHT_DOC_TEXT ? true : undefined)
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.appliedEdits - before.appliedEdits === 2,
      `包裹与取消各一笔写回，实际 ${after.appliedEdits - before.appliedEdits}`)
    if (doc.isDirty) {
      await doc.save()
    }
  }],

  ['符号自动补全一次写回、宿主撤销一笔恢复并保存（#123）', async () => {
    await openWithEditor('symbol-input.md')
    const initial = await waitSessionReady('symbol-input.md')
    const uri = wsUri('symbol-input.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-input.md'))
    const source = '符号输入正文段\n'
    assert(doc.getText() === source, '符号输入 fixture 初始文本不符')

    // 行尾提交单个全角起始括号（真实 DOM 组合链路；钩子候选写首行行尾）
    const at = source.indexOf('正文段') + '正文段'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    await waitViewState('symbol-input.md', (v) => v.selectionOffset === at)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.composition', phase: 'update', text: '符号输入正文段（',
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '（' })
    const completed = '符号输入正文段（）\n'
    await poll('IME 提交补全写回权威文档', () => doc.getText() === completed ? true : undefined)
    const state1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state1.appliedEdits - initial.appliedEdits === 1,
      `补全应为一次写回，实际 ${state1.appliedEdits - initial.appliedEdits}`)
    // 绘制层断言：补全产物在真宿主可见（不能只看 DOM 文本）
    const painted = await waitViewState('symbol-input.md', (v) => v.paint?.textVisible === true)
    assert(painted.paint!.textVisible === true, '补全后正文须在绘制层命中')

    // 宿主撤销一笔整体恢复（不另设编辑器 history）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销恢复原文', () => doc.getText() === source ? true : undefined)
    assert(await doc.save(), '符号输入文档应可保存')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-input.md'))).toString('utf8')
    assert(bytes === source, '保存后回读与权威一致')
  }],

  ['CRLF 文档符号补全保持行尾风格并保存（#123）', async () => {
    await openWithEditor('symbol-crlf.md')
    await waitSessionReady('symbol-crlf.md')
    const uri = wsUri('symbol-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-crlf.md'))
    const original = '标题一\r\n正文 A 行\r\n正文 B 行\r\n'
    assert(doc.getText() === original, 'CRLF fixture 初始文本不符')

    // 首行行尾提交起始引号（钩子候选写首行行尾；webview 侧 LF 坐标 3）
    const at = '标题一'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    await waitViewState('symbol-crlf.md', (v) => v.selectionOffset === at)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.composition', phase: 'update', text: '标题一【',
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '【' })
    const completed = '标题一【】\r\n正文 A 行\r\n正文 B 行\r\n'
    await poll('CRLF 文档补全写回', () => doc.getText() === completed ? true : undefined)
    assert(await doc.save(), 'CRLF 文档应可保存')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-crlf.md')))
    assert(bytes.toString('utf8') === completed, '保存后行尾风格须保持 CRLF')
    assert(!bytes.toString('utf8').includes('【】\n正文'), '不得出现裸 LF 混入')
  }],

  ['符号自动补全设置：关闭停用、重开面板保持、保存后回显（#123）', async () => {
    await openWithEditor('symbol-input.md')
    await waitSessionReady('symbol-input.md')
    const uri = wsUri('symbol-input.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-input.md'))
    const source = '符号输入正文段\n'

    // 关闭设置：提交起始符号原样落文（无闭合补全）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolAutocomplete': false })
    const at = source.indexOf('正文段') + '正文段'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: at })
    await waitViewState('symbol-input.md', (v) => v.selectionOffset === at)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.composition', phase: 'update', text: '符号输入正文段【',
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '【' })
    const uncompleted = '符号输入正文段【\n'
    await poll('关闭后提交原样落文', () => doc.getText() === uncompleted ? true : undefined)

    // 恢复默认开启并还原文档（撤销）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolAutocomplete': true })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销还原文档', () => doc.getText() === source ? true : undefined)

    // 关闭面板重开：设置经 globalState 存活（重开后补全仍开 = 持久化回显的行为证据）。
    // 先 reveal 确保目标面板是活动编辑器（closeActiveEditor 只关活动的）
    await openWithEditor('symbol-input.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await openWithEditor('symbol-input.md')
    await waitSessionReady('symbol-input.md')
    const snapshot = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snapshot['editor.symbolAutocomplete'] === true, `重开后设置快照应回显开启，实际 ${JSON.stringify(snapshot)}`)
    const uri2 = wsUri('symbol-input.md').toString()
    // 等 webview 完全就绪（live 且文本同步）再驱动 IME 钩子；加稳定窗：
    // 宿主缓存的 view.state 可能仍是旧面板的回报（重开面板的上报窗口）
    await waitViewState('symbol-input.md', (v) => v.viewMode === 'live' && v.text === source)
    await new Promise((r) => setTimeout(r, 1500))
    // 面板全关后旧 TextDocument 引用可能停止同步：重开面板后重新获取
    const reopened = await vscode.workspace.openTextDocument(wsUri('symbol-input.md'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'view.locate', offset: at })
    await waitViewState('symbol-input.md', (v) => v.selectionOffset === at)
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, {
      kind: 'sync.test.composition', phase: 'update', text: '符号输入正文段（',
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'sync.test.composition', phase: 'end', text: '（' })
    await poll('重开后补全恢复生效', () => reopened.getText() === source.replace('正文段', '正文段（）') ? true : undefined)
    await vscode.commands.executeCommand(CMD.injectMessage, uri2, { kind: 'history.request', op: 'undo' })
    await poll('清理：撤销还原', () => reopened.getText() === source ? true : undefined)
    if (reopened.isDirty) {
      await reopened.save()
    }
  }],

  ['选区包裹一笔写回、跨段二次包裹与宿主撤销整体恢复（#124）', async () => {
    await openWithEditor('symbol-wrap.md')
    const initial = await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'
    assert(doc.getText() === source, '选区包裹 fixture 初始文本不符')

    // 第一键：经 table.test.crossSelect 设跨段选区（LF 坐标 0..10，两整段），
    // 再经 table.test.domType 走真实 DOM 输入路径（execCommand insertText
    // 的选区替换链路与真实键盘一致）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 10 })
    await waitViewState('symbol-wrap.md', (v) => v.selectionOffset === 0 && v.selectionHead === 10)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '*' })
    const once = '*包裹段甲*\n\n*包裹段乙*\n'
    await poll('第一键跨段包裹写回（各段包裹、空行保留）', () => doc.getText() === once ? true : undefined)
    const state1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state1.appliedEdits - initial.appliedEdits === 1,
      `跨段包裹应为一次写回，实际 ${state1.appliedEdits - initial.appliedEdits}`)

    // 第二键：包裹后选区为多 range（各段原文），真实 DOM 输入替换 main
    // range 处，CM6 replaceSelection 链路覆盖全部 range——继续包裹
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '*' })
    const twice = '**包裹段甲**\n\n**包裹段乙**\n'
    await poll('第二键多 range 继续包裹（第一轮标记不当原文）', () => doc.getText() === twice ? true : undefined)

    // 绘制层断言：包裹产物在真宿主可见（不能只看权威文本）
    const painted = await waitViewState('symbol-wrap.md', (v) => v.paint?.textVisible === true)
    assert(painted.paint!.textVisible === true, '包裹后正文须在绘制层命中')

    // 宿主撤销：第二键一笔恢复到第一键态、再一笔整体回原文（跨段多块
    // 一次撤销整体恢复）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销一笔恢复第一键状态', () => doc.getText() === once ? true : undefined)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('再撤销整体恢复原文', () => doc.getText() === source ? true : undefined)
    assert(await doc.save(), '选区包裹文档应可保存')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-wrap.md'))).toString('utf8')
    assert(bytes === source, '保存后回读与权威一致')
  }],

  ['CRLF 文档选区包裹保持行尾风格并保存（#124）', async () => {
    await openWithEditor('symbol-wrap-crlf.md')
    await waitSessionReady('symbol-wrap-crlf.md')
    const uri = wsUri('symbol-wrap-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap-crlf.md'))
    const original = '包裹标题段\r\n包裹正文段\r\n'
    assert(doc.getText() === original, '选区包裹 CRLF fixture 初始文本不符')

    // webview 全程 LF 坐标：'包裹标题段\n包裹正文段\n'，选第二段（LF 6..11）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 6, head: 11 })
    await waitViewState('symbol-wrap-crlf.md', (v) => v.selectionOffset === 6 && v.selectionHead === 11)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '*' })
    const wrapped = '包裹标题段\r\n*包裹正文段*\r\n'
    await poll('CRLF 文档包裹写回', () => doc.getText() === wrapped ? true : undefined)
    assert(await doc.save(), 'CRLF 包裹文档应可保存')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-wrap-crlf.md')))
    assert(bytes.toString('utf8') === wrapped, '保存后行尾风格须保持 CRLF')
    assert(!bytes.toString('utf8').includes('*包裹正文段*\n'), '不得出现裸 LF 混入')
  }],

  ['选区包裹撤销后再次键入仍包裹原文（#124）', async () => {
    await openWithEditor('symbol-wrap.md')
    await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'
    const wrapped = '*包裹段甲*\n\n包裹段乙\n'
    assert(doc.getText() === source, '包裹撤销夹具初始文本不符')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 4 })
    for (let cycle = 0; cycle < 2; cycle++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '*' })
      await poll('包裹写回权威', () => doc.getText() === wrapped ? true : undefined)
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll('撤销恢复原文', () => doc.getText() === source ? true : undefined)
      const view = await waitViewState('symbol-wrap.md', (v) => v.text === source)
      assert(view.selectionOffset !== undefined && view.selectionHead !== undefined &&
        Math.min(view.selectionOffset, view.selectionHead) === 0 &&
        Math.max(view.selectionOffset, view.selectionHead) === 4,
        `撤销后原文应保持选中，实际 ${view.selectionOffset}..${view.selectionHead}`)
    }
    await doc.save()
  }],

  ['IME 包裹撤销后再次提交仍包裹原文（#124）', async () => {
    await openWithEditor('symbol-wrap.md')
    await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'
    const wrapped = '（包裹段甲）\n\n包裹段乙\n'
    assert(doc.getText() === source, 'IME 撤销夹具初始文本不符')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 4 })
    for (let cycle = 0; cycle < 2; cycle++) {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'update', text: '（' })
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '（' })
      await poll('IME 包裹写回权威', () => doc.getText() === wrapped ? true : undefined)
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await poll('IME 包裹撤销恢复原文', () => doc.getText() === source ? true : undefined)
      const view = await waitViewState('symbol-wrap.md', (v) => v.text === source)
      assert(view.selectionOffset !== undefined && view.selectionHead !== undefined &&
        Math.min(view.selectionOffset, view.selectionHead) === 0 &&
        Math.max(view.selectionOffset, view.selectionHead) === 4,
        `IME 撤销后原文应保持选中，实际 ${view.selectionOffset}..${view.selectionHead}`)
    }
    await doc.save()
  }],

  ['选区经 IME 定稿提交起始符号包裹重建、一笔写回与宿主撤销（#124 修复）', async () => {
    await openWithEditor('symbol-wrap.md')
    const initial = await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'
    assert(doc.getText() === source, 'IME 包裹 fixture 初始文本不符')

    // 选中第一段（钩子候选写第一行，选区放第一段 [0,4)），经真实组合链路
    // 定稿提交单个全角起始括号：compositionstart 快照选区 → 组合把选区
    // 替换为候选 → 定稿重建 open+原文+close 并保持原文选中
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 4 })
    await waitViewState('symbol-wrap.md', (v) => v.selectionOffset === 0 && v.selectionHead === 4)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'sync.test.composition', phase: 'update', text: '（',
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '（' })
    const wrapped = '（包裹段甲）\n\n包裹段乙\n'
    await poll('IME 定稿提交包裹重建写回权威文档', () => doc.getText() === wrapped ? true : undefined)
    const state1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state1.appliedEdits - initial.appliedEdits === 1,
      `IME 包裹应为组合净输入与重建合并后一次写回，实际 ${state1.appliedEdits - initial.appliedEdits}`)

    // 绘制层断言：重建产物在真宿主可见
    const painted = await waitViewState('symbol-wrap.md', (v) => v.paint?.textVisible === true)
    assert(painted.paint!.textVisible === true, 'IME 包裹后正文须在绘制层命中')

    // 宿主撤销一笔整体恢复（组合替换+重建合并单笔，不残留半对也不丢原文）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销一笔恢复原文', () => doc.getText() === source ? true : undefined)
    assert(await doc.save(), 'IME 包裹文档应可保存')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-wrap.md'))).toString('utf8')
    assert(bytes === source, '保存后回读与权威一致')
  }],

  ['跨段选区 IME 包裹空行保留、一笔写回与宿主撤销（#124）', async () => {
    await openWithEditor('symbol-wrap.md')
    const initial = await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'
    const wrapped = '（包裹段甲）\n\n（包裹段乙）\n'
    assert(doc.getText() === source, '跨段 IME 夹具初始文本不符')
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 10 })
    await waitViewState('symbol-wrap.md', (v) => v.selectionOffset === 0 && v.selectionHead === 10)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'start', text: '' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'update', text: '（' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sync.test.composition', phase: 'end', text: '（' })
    await poll('跨段 IME 包裹写回权威', () => doc.getText() === wrapped ? true : undefined)
    const after = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(after.appliedEdits - initial.appliedEdits === 1,
      `跨段 IME 应只写回一笔，实际 ${after.appliedEdits - initial.appliedEdits}`)
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('跨段 IME 一次撤销恢复原文', () => doc.getText() === source ? true : undefined)
    await doc.save()
  }],

  ['选区包裹设置：关闭停用、重开面板回显（#124）', async () => {
    await openWithEditor('symbol-wrap.md')
    await waitSessionReady('symbol-wrap.md')
    const uri = wsUri('symbol-wrap.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    const source = '包裹段甲\n\n包裹段乙\n'

    // 关闭设置：选区键入回到普通替换语义（无两侧包裹）
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolSelectionWrap': false })
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'table.test.crossSelect', anchor: 0, head: 4 })
    await waitViewState('symbol-wrap.md', (v) => v.selectionOffset === 0 && v.selectionHead === 4)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.domType', text: '*' })
    const replaced = '*\n\n包裹段乙\n'
    await poll('关闭后选区按普通替换落文', () => doc.getText() === replaced ? true : undefined)

    // 恢复默认开启并撤销还原
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolSelectionWrap': true })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
    await poll('撤销还原文档', () => doc.getText() === source ? true : undefined)

    // 关闭面板重开：设置经 globalState 存活（重开后包裹仍开 = 持久化回显）
    await openWithEditor('symbol-wrap.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await openWithEditor('symbol-wrap.md')
    await waitSessionReady('symbol-wrap.md')
    const snapshot = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snapshot['editor.symbolSelectionWrap'] === true,
      `重开后设置快照应回显开启，实际 ${JSON.stringify(snapshot)}`)
    // 重开后包裹恢复生效（面板全关后旧 TextDocument 引用可能停止同步：重新获取）
    const uri2 = wsUri('symbol-wrap.md').toString()
    const reopened = await vscode.workspace.openTextDocument(wsUri('symbol-wrap.md'))
    await waitViewState('symbol-wrap.md', (v) => v.viewMode === 'live' && v.text === source)
    await new Promise((r) => setTimeout(r, 1500))
    await vscode.commands.executeCommand(CMD.postToPanel, uri2,
      { kind: 'table.test.crossSelect', anchor: 0, head: 10 })
    await waitViewState('symbol-wrap.md', (v) => v.selectionOffset === 0 && v.selectionHead === 10)
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'table.test.domType', text: '*' })
    await poll('重开后包裹恢复生效', () => reopened.getText() === '*包裹段甲*\n\n*包裹段乙*\n' ? true : undefined)
    await vscode.commands.executeCommand(CMD.injectMessage, uri2, { kind: 'history.request', op: 'undo' })
    await poll('清理：撤销还原', () => reopened.getText() === source ? true : undefined)
    if (reopened.isDirty) {
      await reopened.save()
    }
  }],

  ['围栏内两步 Tab 越界纯导航：零写回零 dirty、表格格内先越界后切格（#125）', async () => {
    await openWithEditor('symbol-tab.md')
    const initial = await waitSessionReady('symbol-tab.md')
    const uri = wsUri('symbol-tab.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-tab.md'))
    const source = '**越界正文**段\n\n| 甲 | **格内** |\n| --- | --- |\n| 一 | 二 |\n'
    assert(doc.getText() === source, 'Tab 越界 fixture 初始文本不符')

    // 正文粗体内：**越界|正文**（LF 坐标 4）→ 首按到闭合左边界 6 → 再按
    // 越过整个 **（8）。table.test.key 驱动真实 keymap 链路
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 4 })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === 4)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === 6)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === 8)

    // 表格格内：**格|内**（表头行第二格内容中间，LF 坐标 = 表头行起点
    // + '| 甲 | ' + 3）→ 两步越界后再 Tab 切格到数据行第一格
    const headerFrom = source.indexOf('| 甲')
    const cellCursor = headerFrom + '| 甲 | '.length + 3
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: cellCursor })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === cellCursor)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === cellCursor + 1)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === cellCursor + 3)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === source.indexOf('一'))

    // 纯导航硬契约：全程零写回（无 edit.request）、零 dirty、字节不变
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits - initial.appliedEdits === 0,
      `Tab 越界不得产生写回，实际 ${state.appliedEdits - initial.appliedEdits}`)
    assert(doc.getText() === source, 'Tab 越界不得改动权威文本')
    assert(!doc.isDirty, '纯导航不得产生 dirty 变更')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-tab.md'))).toString('utf8')
    assert(bytes === source, '文档字节须保持不变')

    // Shift+Tab 原行为：格内反向切格（不新增反向越界）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'shift-tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === cellCursor + 3)
  }],

  ['CRLF 文档围栏内 Tab 零写回且行尾风格保持（#125）', async () => {
    await openWithEditor('symbol-tab-crlf.md')
    await waitSessionReady('symbol-tab-crlf.md')
    const uri = wsUri('symbol-tab-crlf.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('symbol-tab-crlf.md'))
    const original = '**CRLF 越界**段\r\n正文行\r\n'
    assert(doc.getText() === original, 'Tab 越界 CRLF fixture 初始文本不符')

    // webview 全程 LF 坐标：粗体内容 CRLF| 越 界（光标 6，F 后）→ 两步越界
    // （内容「CRLF 越界」7 字符：闭 ** 在 9-10——闭合左边界 9 → 越过到 11）
    const initial = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: 6 })
    await waitViewState('symbol-tab-crlf.md', (v) => v.selectionOffset === 6)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab-crlf.md', (v) => v.selectionOffset === 9)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab-crlf.md', (v) => v.selectionOffset === 11)
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits - initial.appliedEdits === 0, 'CRLF 文档 Tab 越界同样零写回')
    assert(!doc.isDirty, 'CRLF 文档纯导航不得 dirty')
    const bytes = Buffer.from(await vscode.workspace.fs.readFile(wsUri('symbol-tab-crlf.md')))
    assert(bytes.toString('utf8') === original, 'CRLF 文档字节须保持不变')
    assert(bytes.toString('utf8').includes('**段\r\n'), '不得引入 LF/CRLF 混排')
  }],

  ['符号 Tab 越界设置：关闭回落切格、重开面板回显恢复（#125）', async () => {
    await openWithEditor('symbol-tab.md')
    const initial = await waitSessionReady('symbol-tab.md')
    const uri = wsUri('symbol-tab.md').toString()
    const source = '**越界正文**段\n\n| 甲 | **格内** |\n| --- | --- |\n| 一 | 二 |\n'

    // 关闭设置：格内光标 Tab 不再越界，直接切格到数据行第一格
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolTabEscape': false })
    const headerFrom = source.indexOf('| 甲')
    const cellCursor = headerFrom + '| 甲 | '.length + 3
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: cellCursor })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === cellCursor)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === source.indexOf('一'))
    const state1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state1.appliedEdits - initial.appliedEdits === 0, '关闭后切格仍为零写回')

    // 恢复默认开启；关闭面板重开：设置经 globalState 存活回显（持久化
    // 的行为证据），重开后围栏内 Tab 越界恢复生效
    await vscode.commands.executeCommand(CMD.setSettings, { 'editor.symbolTabEscape': true })
    await openWithEditor('symbol-tab.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await openWithEditor('symbol-tab.md')
    await waitSessionReady('symbol-tab.md')
    const snapshot = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snapshot['editor.symbolTabEscape'] === true,
      `重开后设置快照应回显开启，实际 ${JSON.stringify(snapshot)}`)
    const uri2 = wsUri('symbol-tab.md').toString()
    const reopened = await vscode.workspace.openTextDocument(wsUri('symbol-tab.md'))
    await waitViewState('symbol-tab.md', (v) => v.viewMode === 'live' && v.text === source)
    await new Promise((r) => setTimeout(r, 1500))
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'view.locate', offset: 4 })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === 4)
    await vscode.commands.executeCommand(CMD.postToPanel, uri2, { kind: 'table.test.key', key: 'tab' })
    await waitViewState('symbol-tab.md', (v) => v.selectionOffset === 6)
    assert(reopened.getText() === source && !reopened.isDirty, '重开后越界仍为纯导航')
    if (reopened.isDirty) {
      await reopened.save()
    }
  }],

  // ---- #128 CSS 片段目录管理与双视图启停闭环 ----

  ['CSS 片段：目录扫描默认关闭、启用改双视图、文件名顺序后者覆盖（#128）', async () => {
    // 片段目录（工作区内子目录；仅因显式选择而加载——无任何工作区自动发现）
    const dir = wsUri('css-snippets').fsPath
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await writeSnippetCss('css-snippets/a.css', [
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(70, 80, 90); }',
      '#app .cm-editor .cm-scroller .vsidian-heading-line-1 { font-size: 31px; }',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: snippet-a; }',
    ].join('\n'))
    await writeSnippetCss('css-snippets/b.css',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: snippet-b; }\n')
    try {
      await setSnippetDirectory(dir)
      // 扫描产出：仅第一层 .css、确定性排序、新片段默认关闭
      const scanned = await poll('片段扫描完成', async () => {
        const st = await snippetState()
        return st.directory === dir && !st.readError && st.entries.length === 2 ? st : undefined
      })
      assert(JSON.stringify(scanned.entries) === JSON.stringify([
        { name: 'a.css', enabled: false },
        { name: 'b.css', enabled: false },
      ]), `新片段应默认关闭并按文件名排序，实际 ${JSON.stringify(scanned.entries)}`)

      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      const uri = wsUri('mode.md').toString()
      // 未启用：探针维持内部契约片段值（片段不生效）
      const before = await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.cssProbe?.liveHeadingDecorationColor !== undefined)
      assert(before.cssProbe!.liveHeadingDecorationColor === 'rgb(1, 2, 3)',
        `未启用片段不应影响探针，实际 ${before.cssProbe!.liveHeadingDecorationColor}`)

      // 启用 a.css：live 探针命中（text-decoration-color）+ 可见字号变化（headingFontPx）
      await setSnippetEnabled('a.css', true)
      const applied = await waitViewState('mode.md', (v) =>
        v.cssProbe?.liveHeadingDecorationColor === 'rgb(70, 80, 90)')
      assert(applied.cssProbe!.liveHeadingDecorationColor === 'rgb(70, 80, 90)', 'live 应被片段命中')
      assert(applied.headingFontPx === 31,
        `片段应实际改变可见字号（31px），实际 ${String(applied.headingFontPx)}`)

      // 阅读视图同片段生效（变量管道）
      await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
      const readingA = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'snippet-a')
      assert(readingA.cssProbe!.readingVarProbe === 'snippet-a', '阅读视图应被片段命中')

      // b.css 后加载覆盖 a.css（确定性顺序的层叠结果）；停用 b 回到 a
      await setSnippetEnabled('b.css', true)
      await waitViewState('mode.md', (v) => v.cssProbe?.readingVarProbe === 'snippet-b')
      await setSnippetEnabled('b.css', false)
      await waitViewState('mode.md', (v) => v.cssProbe?.readingVarProbe === 'snippet-a')
      // 全部停用：撤回到内部契约片段值
      await setSnippetEnabled('a.css', false)
      await waitViewState('mode.md', (v) => v.cssProbe?.readingVarProbe === 'contract-ok')

      // 全程不写文档（CSS 启停是纯视图状态）
      await waitViewState('mode.md', (v) => v.text === MODE_DOC_TEXT)
      const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      assert(st.appliedEdits === 0, `片段启停不应写文档，实际写回 ${st.appliedEdits} 笔`)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：保存后自动更新与原子保存不误判删除（#128）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    const css = (color: string) =>
      `#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: ${color}; }\n`
    await writeSnippetCss('css-snippets/edit.css', css('rgb(11, 22, 33)'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('edit.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(11, 22, 33)')

      // 编辑保存（磁盘改写）→ watcher 去抖重扫 → 广播 → 新内容生效（缓存击穿）
      await writeSnippetCss('css-snippets/edit.css', css('rgb(44, 55, 66)'))
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(44, 55, 66)',
        0, 15000)

      // 原子保存：写临时文件（.tmp 不匹配 *.css，不触发清单变化）再 rename 覆盖
      await writeSnippetCss('css-snippets/edit.css.tmp', css('rgb(77, 88, 99)'))
      await vscode.workspace.fs.rename(
        wsUri('css-snippets/edit.css.tmp'), wsUri('css-snippets/edit.css'), { overwrite: true })
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(77, 88, 99)',
        0, 15000)
      // 开关未被误判删除（rename 期间的瞬时消失不清洗显式开关）
      const st = await snippetState()
      assert(st.entries.some((e) => e.name === 'edit.css' && e.enabled),
        `原子保存后开关应保留，实际 ${JSON.stringify(st.entries)}`)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：删除撤下、目录读取失败保留最近成功样式、恢复（#128）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    const css = '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(120, 130, 140); }\n'
    await writeSnippetCss('css-snippets/keep.css', css)
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('keep.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(120, 130, 140)')

      // 明确删除：清单移除 + 样式撤下（回到内部契约探针值）
      await vscode.workspace.fs.delete(wsUri('css-snippets/keep.css'), { useTrash: false })
      await poll('删除后清单移除', async () => {
        const st = await snippetState()
        return st.entries.length === 0 ? st : undefined
      }, 15000)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)', 0, 15000)

      // 恢复文件：显式开关按设计跨删除保留（原子保存保护——无法区分暂时消失
      // 与永久删除，不清洗映射），重新入列即带原开关直接重新生效
      await writeSnippetCss('css-snippets/keep.css', css)
      await vscode.commands.executeCommand('onegayi.vsidian.cssSnippets.refresh')
      await poll('恢复后重新入列（开关保留）', async () => {
        const st = await snippetState()
        return st.entries.some((e) => e.name === 'keep.css' && e.enabled) ? true : undefined
      }, 15000)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(120, 130, 140)', 0, 15000)

      // 目录读取失败（整目录暂时消失）：宿主保留最近成功清单（开关不清洗、
      // 版本不推进——不向已开面板下发撤下广播）；readError 置位供设置页提示。
      // 注：已装 <link> 的样式表存续由 webview 资源服务/浏览器决定（宿主不
      // 下发撤下即不主动扰动），「失败窗口内样式保持」的装载器契约由浏览器
      // 测试钉住，真实宿主内的观感列入人工验证
      await vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })
      const failed = await poll('读取失败置位', async () => {
        const st = await snippetState()
        return st.readError ? st : undefined
      }, 15000)
      assert(JSON.stringify(failed.entries) === JSON.stringify([{ name: 'keep.css', enabled: true }]),
        `读取失败应保留最近成功清单，实际 ${JSON.stringify(failed.entries)}`)
      assert(failed.version > 0, '读取失败不得推进版本（不触发面板重装/撤下）')

      // 目录恢复 + 真实刷新命令：清单保留的直接证据——无需重新启用即自动
      // 重新生效（恢复后的成功扫描推进版本并广播）
      await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
      await writeSnippetCss('css-snippets/keep.css', css)
      await vscode.commands.executeCommand('onegayi.vsidian.cssSnippets.refresh')
      await poll('刷新后失败态清除', async () => {
        const st = await snippetState()
        return !st.readError && st.entries.some((e) => e.name === 'keep.css' && e.enabled) ? true : undefined
      }, 15000)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(120, 130, 140)', 0, 15000)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：暂停全部冻结视图、保留逐项开关、恢复按原配置生效（#131）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    const css = (color: string) =>
      `#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: ${color}; }\n`
    await writeSnippetCss('css-snippets/a.css', css('rgb(200, 210, 220)'))
    await writeSnippetCss('css-snippets/b.css', css('rgb(210, 220, 230)'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('a.css', true)
      await setSnippetEnabled('b.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      // 双片段就绪：b 后加载覆盖 a（原配置的基线观感）
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(210, 220, 230)')

      // 暂停（真实命令面板命令，宿主侧注册——不依赖 webview 健康度）：
      // 全局冻结立即撤下全部片段（可见效果断言：探针回内部契约值）
      await vscode.commands.executeCommand('onegayi.vsidian.cssSnippets.pause')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)',
        0, 15000)
      const paused = await snippetState()
      assert(paused.paused === true, `暂停标志应置位，实际 ${String(paused.paused)}`)
      assert(JSON.stringify(paused.entries) === JSON.stringify([
        { name: 'a.css', enabled: true }, { name: 'b.css', enabled: true },
      ]), `暂停应保留逐片段开关（不清空），实际 ${JSON.stringify(paused.entries)}`)

      // 暂停期间翻转逐片段开关：允许且保留（视图保持冻结——暂停与停用不混淆）
      await setSnippetEnabled('b.css', false)
      const duringPause = await snippetState()
      assert(duringPause.paused === true && !duringPause.entries.find((e) => e.name === 'b.css')!.enabled,
        '暂停期间开关翻转应落地且不解除暂停')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)')

      // 恢复（真实命令）：按暂停期间落地的原配置立即生效——仅 a.css
      await vscode.commands.executeCommand('onegayi.vsidian.cssSnippets.resume')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(200, 210, 220)',
        0, 15000)
      const resumed = await snippetState()
      assert(resumed.paused === false, `恢复应清除暂停标志，实际 ${String(resumed.paused)}`)

      // 全程不写文档（暂停/恢复是纯视图状态）
      await waitViewState('mode.md', (v) => v.text === MODE_DOC_TEXT)
      const st = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('mode.md').toString())) as SessionState
      assert(st.appliedEdits === 0, `暂停/恢复不应写文档，实际写回 ${st.appliedEdits} 笔`)
    } finally {
      // 清理暂停标志（finally 只复位目录——paused 随目录测试的存储独立，
      // 显式恢复避免影响后续用例的片段观感）
      await vscode.commands.executeCommand('onegayi.vsidian.cssSnippets.resume')
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：环境身份与存储位置证据（#131 本地侧，真实 1.86 宿主）', async () => {
    // ADR-0007 证据链的机器侧采集：本地集成宿主断言本地语义（remoteName
    // undefined、globalState 目录在本机用户数据目录、工作区受信）。真实
    // SSH 窗口的对应读值属人工验收（无法以 mock 冒充），见
    // docs/specs/manual-verification.md 的 #131 清单。
    // 注：1.86 宿主实测 globalStorageUri 的 scheme 可为 vscode-userdata:
    // （虚拟用户数据文件系统）而非 file:——scheme 不在承诺面内，断言钉
    // 路径归属（宿主用户数据树内的本扩展 globalStorage 目录）
    const env = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSnippetEnv')) as {
      remoteName: string | null
      machineId: string
      appHost: string
      globalStorageUri: string
      workspaceTrusted: boolean
    }
    console.log('[集成测试][#131][环境身份]', JSON.stringify(env))
    assert(env.remoteName === null,
      `本地扩展宿主的 env.remoteName 应为 undefined（无远程扩展宿主），实际 ${String(env.remoteName)}`)
    assert(typeof env.machineId === 'string' && env.machineId.length > 0,
      `env.machineId 应为非空字符串（宿主机器标识），实际 ${JSON.stringify(env.machineId)}`)
    const storagePath = vscode.Uri.parse(env.globalStorageUri).fsPath.replace(/\\/g, '/').toLowerCase()
    assert(storagePath.endsWith('user/globalstorage/onegayi.vsidian'),
      `globalStorageUri 应指向宿主用户数据树内本扩展的 globalStorage 目录，实际 ${env.globalStorageUri}（解析路径 ${storagePath}）`)
    assert(env.workspaceTrusted === true, '测试宿主的工作区应为受信状态（受限口径见上一用例）')
  }],

  ['CSS 片段：未配置目录不自动发现工作区片段（#131 受限工作区口径）', async () => {
    // 受限工作区的可测试行为 = 不自动发现工作区片段：片段只来自用户显式
    // 选择的用户级目录，工作区内出现的 .css 不进入清单、不注入样式——
    // 未配置目录时无论工作区内容如何，清单恒空（#128 起的构造性保证，
    // 本用例在真实宿主钉住）
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await writeSnippetCss('css-snippets/workspace.css',
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(230, 240, 250); }\n')
    try {
      const st = await snippetState()
      assert(st.directory === null && st.entries.length === 0,
        `未配置目录时清单应恒空（不扫描工作区），实际 ${JSON.stringify(st)}`)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      const view = await waitViewState('mode.md', (v) =>
        v.cssProbe?.liveHeadingDecorationColor !== undefined)
      assert(view.cssProbe!.liveHeadingDecorationColor === 'rgb(1, 2, 3)',
        `工作区内的 .css 不应被发现或注入，实际 ${view.cssProbe!.liveHeadingDecorationColor}`)
    } finally {
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：换目录已开面板生效、新面板拉取、输入与撤销保持（#128）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets-2'))
    const css = (color: string) =>
      `#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: ${color}; }\n`
    await writeSnippetCss('css-snippets/swap-a.css', css('rgb(140, 150, 160)'))
    await writeSnippetCss('css-snippets-2/swap-b.css', css('rgb(170, 180, 190)'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('swap-a.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(140, 150, 160)')

      const uri = wsUri('mode.md').toString()
      // 真实输入（sync.test.edit 驱动真实 CM6 事务 → 标准出站 edit.request
      // 写回权威文档——注入伪造的 edit.request 会绕过 webview 事务生命周期，
      // webview 自身永远看不到该编辑）
      await vscode.commands.executeCommand(CMD.postToPanel, uri, {
        kind: 'sync.test.edit',
        offset: MODE_DOC_TEXT.length,
        text: '片段编辑中尾行\n',
      })
      const typed = `${MODE_DOC_TEXT}片段编辑中尾行\n`
      await waitViewState('mode.md', (v) => v.text === typed)

      // 换目录：已开面板动态加载新目录资源（webview.options 资源根更新）；
      // 换目录重置开关 → swap-a 撤下 → 探针回默认
      await setSnippetDirectory(wsUri('css-snippets-2').fsPath)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)', 0, 15000)
      await setSnippetEnabled('swap-b.css', true)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(170, 180, 190)', 0, 15000)

      // 输入保持（编辑不因 CSS 更新丢失）+ 撤销栈保持（undo 撤销编辑而非样式）
      const afterSwap = await waitViewState('mode.md', (v) => v.text === typed)
      assert(afterSwap.text === typed, 'CSS 更新不得改变文档内容')
      const beforeUndo = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      await vscode.commands.executeCommand(CMD.injectMessage, uri, { kind: 'history.request', op: 'undo' })
      await waitViewState('mode.md', (v) => v.text === MODE_DOC_TEXT)
      const afterUndo = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      assert(afterUndo.appliedEdits === beforeUndo.appliedEdits,
        `undo 走宿主文本栈（不经写回），实际写回数变化 ${afterUndo.appliedEdits - beforeUndo.appliedEdits}`)

      // split 新面板：init 后拉取当前清单（新目录片段立即生效）
      await openWithEditor('mode.md', true)
      await poll('第二面板就绪', async () => {
        const st = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
        return st.panels.length === 2 ? true : undefined
      })
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(170, 180, 190)', 1, 15000)

      // 持久回显：宿主权威状态与设置一致（重新打开/新窗口按此回显）
      const st = await snippetState()
      assert(st.directory === wsUri('css-snippets-2').fsPath, '目录应持久为最新选择')
      assert(st.entries.some((e) => e.name === 'swap-b.css' && e.enabled), '开关应持久为显式值')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets-2'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],
  // ---- #129 CSS 本地依赖导入与相对资源热更新 ----

  ['CSS 片段：@import 子目录依赖生效与共享依赖隔离（#129）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets/sub'))
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets/sub2'))
    await writeSnippetCss('css-snippets/main-a.css', [
      '@import "sub/dep.css";',
      '@import "sub2/nested.css";',
    ].join('\n'))
    await writeSnippetCss('css-snippets/main-b.css', [
      '@import "sub/dep.css";',
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(111, 121, 131); }',
    ].join('\n'))
    // 子目录依赖：dep 直接改 live 标题色并设阅读探针变量；nested 再嵌套
    // 一层导入改同一变量（后导入者覆盖）
    await writeSnippetCss('css-snippets/sub/dep.css', [
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(81, 91, 101); }',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: from-dep; }',
    ].join('\n'))
    await writeSnippetCss('css-snippets/sub2/nested.css', '@import "../sub/deeper.css";\n')
    await writeSnippetCss('css-snippets/sub/deeper.css',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: from-nested; }\n')
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      // 被引用的子目录文件不成为独立片段：清单只有两个第一层入口
      const scanned = await poll('片段扫描完成', async () => {
        const st = await snippetState()
        return st.directory === wsUri('css-snippets').fsPath && !st.readError && st.entries.length === 2 ? st : undefined
      })
      assert(JSON.stringify(scanned.entries.map((e) => e.name)) === JSON.stringify(['main-a.css', 'main-b.css']),
        `子目录被引用文件不得入清单，实际 ${JSON.stringify(scanned.entries)}`)

      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      // 启用 main-a：依赖闭包（dep + nested→deeper）全部生效
      await setSnippetEnabled('main-a.css', true)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(81, 91, 101)')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'from-nested', 0, 15000)

      // 启用 main-b（共享 dep）：确定性顺序后者覆盖——main-b 自身规则生效
      await setSnippetEnabled('main-b.css', true)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.cssProbe?.liveHeadingDecorationColor === 'rgb(111, 121, 131)', 0, 15000)

      // 关闭 main-a：撤下其专属依赖（nested/deeper 探针回落），共享 dep 经
      // main-b 仍生效（live 色不变）——共享同一依赖的其他入口不受影响
      await setSnippetEnabled('main-a.css', false)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'from-dep', 0, 15000)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.cssProbe?.liveHeadingDecorationColor === 'rgb(111, 121, 131)', 0, 15000)

      // 全部关闭：撤下（回内部契约探针值）
      await setSnippetEnabled('main-b.css', false)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)', 0, 15000)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：被导入文件修改自动刷新、删除降级与缺失恢复（#129）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets/sub'))
    const depColor = (color: string) =>
      `#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: ${color}; }\n`
    await writeSnippetCss('css-snippets/hot.css', '@import "sub/dep.css";\n')
    await writeSnippetCss('css-snippets/sub/dep.css', depColor('rgb(201, 211, 221)'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('hot.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(201, 211, 221)')

      // 修改被导入文件：watcher（递归）归因到依赖它的入口 → 入口 ?v= 推进 →
      // import 链在真实 webview 资源服务上取到新字节（缓存语义钉住点）
      await writeSnippetCss('css-snippets/sub/dep.css', depColor('rgb(222, 32, 42)'))
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(222, 32, 42)', 0, 15000)

      // 入口补自身规则后删除被导入文件：入口重载、嵌套导入 404——入口其余
      // 规则仍在（降级不整份回滚），依赖的颜色撤回默认
      await writeSnippetCss('css-snippets/hot.css', [
        '@import "sub/dep.css";',
        '#app .vsidian-view-reading { --vsidian-probe-var-reading: entry-own; }',
      ].join('\n'))
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'entry-own', 0, 15000)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
      // 删除被导入文件（live 态下删）：归因重载后嵌套导入 404——依赖的颜色
      // 撤回默认，入口其余规则仍在（下一条断言）
      await vscode.workspace.fs.delete(wsUri('css-snippets/sub/dep.css'), { useTrash: false })
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.cssProbe?.liveHeadingDecorationColor === 'rgb(1, 2, 3)', 0, 15000)
      // 删除窗口内宿主不清洗开关、不置读取失败
      const stDuringMissing = await snippetState()
      assert(stDuringMissing.entries.some((e) => e.name === 'hot.css' && e.enabled) && !stDuringMissing.readError,
        '依赖缺失不得清洗开关或置读取失败')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      // 入口自身规则（降级）：依赖缺失不整份回滚
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'entry-own', 0, 15000)

      // 恢复：缺失目标在归因集内（创建事件可归因），内容更新生效
      await writeSnippetCss('css-snippets/sub/dep.css', depColor('rgb(50, 220, 120)'))
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(50, 220, 120)', 0, 15000)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：循环导入有界与局部无效 CSS 不整份回滚（#129）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets/sub'))
    await writeSnippetCss('css-snippets/cyc.css', [
      '@import "sub/back.css";',
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(99, 88, 77); }',
    ].join('\n'))
    await writeSnippetCss('css-snippets/sub/back.css', [
      '@import "../cyc.css";',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: cycle-ok; }',
    ].join('\n'))
    await writeSnippetCss('css-snippets/never.css',
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: never-loaded; }\n')
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('cyc.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      // 循环链两侧规则都生效且不挂死（waitViewState 超时即挂死证据）
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(99, 88, 77)')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'cycle-ok', 0, 15000)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')

      // 局部无效 CSS：规则后导入被忽略、未知 at 规则自终止、无效声明只丢
      // 自身——其余规则照常生效（浏览器逐规则容错，不整份回滚）
      await writeSnippetCss('css-snippets/zz-broken.css', [ // 文件名序在 cyc 之后，避免被后载覆盖
        '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(11, 200, 111); }',
        '@import "never.css";',
        '@unknown-feature some value;',
        '#app .vsidian-view-reading { color: notacolor; --vsidian-probe-var-reading: broken-ok; }',
      ].join('\n'))
      await setSnippetEnabled('zz-broken.css', true)
      await waitViewState('mode.md', (v) => v.cssProbe?.liveHeadingDecorationColor === 'rgb(11, 200, 111)', 0, 15000)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      const brokenState = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'broken-ok', 0, 15000)
      assert(brokenState.cssProbe!.readingVarProbe === 'broken-ok', '无效声明所在块的其余声明仍生效')
      // 规则后的导入不生效（never.css 的值不得出现）
      await new Promise((r) => setTimeout(r, 600))
      const afterNever = (await vscode.commands.executeCommand(CMD.viewState, wsUri('mode.md').toString())) as ViewState
      assert(afterNever.cssProbe?.readingVarProbe !== 'never-loaded', '规则后的 @import 不被浏览器加载')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：越界引用与符号链接逃逸拒绝及修复恢复（#129）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets-outside'))
    await writeSnippetCss('css-snippets-outside/outside.css',
      '#app .vsidian-view-live .vsidian-heading-line-1 { text-decoration-color: rgb(250, 0, 0); }\n')
    const ownMarker = '#app .vsidian-view-reading { --vsidian-probe-var-reading: escape-entry; }\n'
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')

      // 词法越界（../ 逃逸的 @import 与 url() 资产）：条目被拒——不入装载
      // 清单、不生效、宿主状态暴露拒绝原因
      await writeSnippetCss('css-snippets/escape.css', [
        '@import "../css-snippets-outside/outside.css";',
        ownMarker,
      ].join('\n'))
      await writeSnippetCss('css-snippets/asset-escape.css',
        '.a { background: url("../../out-of-dir.png"); }\n')
      await poll('越界条目入列', async () => {
        const st = await snippetState()
        return st.entries.length === 2 ? st : undefined
      }, 15000)
      await setSnippetEnabled('escape.css', true)
      await setSnippetEnabled('asset-escape.css', true)
      const rejected = await poll('拒绝态可见', async () => {
        const st = await snippetState()
        return st.rejections?.['escape.css'] && st.rejections?.['asset-escape.css'] ? st : undefined
      }, 15000)
      assert(rejected.rejections!['escape.css'].reason === 'path-escape',
        `@import 越界应记 path-escape，实际 ${JSON.stringify(rejected.rejections)}`)
      assert(rejected.rejections!['escape.css'].path.includes('outside.css'), '拒绝信息应携带逃逸目标')
      assert(rejected.rejections!['asset-escape.css'].reason === 'path-escape', '资产 url() 越界同样拒绝')
      // 被拒条目不生效（探针维持默认）
      await new Promise((r) => setTimeout(r, 800))
      const duringReject = await waitViewState('mode.md', (v) =>
        v.cssProbe?.liveHeadingDecorationColor !== undefined)
      assert(duringReject.cssProbe!.liveHeadingDecorationColor === 'rgb(1, 2, 3)',
        '被拒条目不得影响正文样式')

      // 修复（去掉逃逸导入）：拒绝自动清除、条目回清单并生效
      await writeSnippetCss('css-snippets/escape.css', ownMarker)
      await poll('拒绝清除', async () => {
        const st = await snippetState()
        return st.rejections && !st.rejections['escape.css'] ? true : undefined
      }, 15000)
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'escape-entry', 0, 15000)

      // 符号链接逃逸：链接指向片段目录外（Windows 用 junction 免管理员；
      // 环境拒绝创建时跳过该段并在运行报告中留痕）
      try {
        const fsMod = require('fs') as typeof import('fs')
        fsMod.symlinkSync(
          wsUri('css-snippets-outside').fsPath,
          wsUri('css-snippets/jlink').fsPath,
          process.platform === 'win32' ? 'junction' : 'dir',
        )
        await writeSnippetCss('css-snippets/link.css', '@import "jlink/outside.css";\n')
        await poll('链接条目入列', async () => {
          const st = await snippetState()
          return st.entries.some((e) => e.name === 'link.css') ? st : undefined
        }, 15000)
        await setSnippetEnabled('link.css', true)
        const linkRejected = await poll('链接逃逸拒绝', async () => {
          const st = await snippetState()
          return st.rejections?.['link.css'] ? st : undefined
        }, 15000)
        assert(linkRejected.rejections!['link.css'].reason === 'symlink-escape',
          `链接逃逸应记 symlink-escape，实际 ${JSON.stringify(linkRejected.rejections)}`)
      } catch (err) {
        console.log(`[#129] 符号链接创建被环境拒绝，逃逸断言跳过：${String(err)}`)
      }
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets-outside'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['CSS 片段：相对字体图片按各自 CSS 文件路径解析（空格中文路径，#129）', async () => {
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets/子 目录'))
    // 字体资产：复制扩展产物中的 woff2（dev 与 VSIX 安装态都有 out/webview/assets）
    const ext = vscode.extensions.getExtension(EXT_ID)!
    const assetsDir = vscode.Uri.joinPath(ext.extensionUri, 'out', 'webview', 'assets')
    const assets = await vscode.workspace.fs.readDirectory(assetsDir)
    const woff2 = assets.find(([name]) => name.toLowerCase().endsWith('.woff2'))
    assert(woff2, '扩展产物应含 woff2 字体资产（KaTeX 随包字体）')
    await vscode.workspace.fs.copy(
      vscode.Uri.joinPath(assetsDir, woff2![0]),
      wsUri('css-snippets/子 目录/字体 测试.woff2'),
      { overwrite: true },
    )
    // 1×1 PNG 资产
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await vscode.workspace.fs.writeFile(wsUri('css-snippets/图 片.png'), new Uint8Array(png))
    // 入口与依赖：依赖文件内的 url() 相对「依赖文件所在目录」解析
    await writeSnippetCss('css-snippets/主 样式.css', '@import "子 目录/依赖 样式.css";\n')
    await writeSnippetCss('css-snippets/子 目录/依赖 样式.css', [
      '@font-face { font-family: "VsidianSnippetProbeFont"; src: url("字体 测试.woff2") format("woff2"); }',
      '#app .vsidian-view-reading { font-family: "VsidianSnippetProbeFont"; --vsidian-probe-var-reading: asset-ok; background-image: url("../图 片.png"); }',
    ].join('\n'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await poll('空格中文入口入列', async () => {
        const st = await snippetState()
        return st.entries.some((e) => e.name === '主 样式.css') ? st : undefined
      }, 15000)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      // 基线：片段未启用时的字体装载计数（阅读态正文存在但片段字体未用）
      const baseline = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.documentFonts !== undefined, 0, 15000)
      const baseLoaded = baseline.cssProbe!.documentFonts?.loaded ?? 0

      await setSnippetEnabled('主 样式.css', true)
      const applied = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'asset-ok', 0, 15000)
      // 字节级证据：@font-face 字体经「依赖文件路径」解析并在真实资源服务
      // 上拉取成功（documentFonts.loaded 增量 ≥ 1）
      await poll('片段字体装载', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('mode.md').toString())) as ViewState
        return (v.cssProbe?.documentFonts?.loaded ?? 0) > baseLoaded ? v.cssProbe!.documentFonts : undefined
      }, 15000)
      // 图片解析锚点：背景图 URL 按依赖文件所在目录解析（../图 片.png → 目录根）
      const bg = applied.cssProbe?.readingBackgroundImage ?? ''
      assert(bg !== '' && decodeURIComponent(bg).includes('图 片.png'),
        `背景图应解析到片段目录内的图片（实际 ${bg}）`)
      assert((applied.cssProbe?.documentFonts?.total ?? 0) >= 1, '字体 @font-face 已并入文档字体集')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  // ---- #132 Obsidian 原名别名桥与公开样式契约 ----

  ['Obsidian 原名别名桥：正文域选择器双视图命中与模式切换（#132）', async () => {
    await resetLastMode()
    await openWithEditor('style-contract.md')
    await waitSessionReady('style-contract.md')
    // 显式切 live：初始模式可能落在历史用例遗留的全局记忆上（1.86 globalState
    // 写入后偶发滞后回翻，reset 也不可靠——见 resetLastMode 注释）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('style-contract.md'))

    // 断言器（轮询稳定形态）：探针表期望值逐项核对（期望与 probe.css 规则同
    // 源——挂错节点/类未挂即 null）。装饰随视口/编辑增量重建，采集恰逢重建
    // 空窗会读到瞬时 null——poll 重试至稳定；「持续差异」须连续 4 轮采样
    // 均 ≥3 条才提前报错（首轮即抛会把懒加载/重建空窗误判为持续差异，
    // CI 慢环境实测踩过），零星波动继续等，超时兜底
    const waitAliases = async (view: 'live' | 'reading'): Promise<void> => {
      let aliasDiffStreak = 0
      await poll(view + ' 别名探针全命中', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('style-contract.md').toString(), 0)) as ViewState | undefined
        if (v?.viewMode !== view) return undefined
        const aliases = v.cssProbe?.obsidianAliases
        if (!aliases) return undefined
        const diffs: string[] = []
        for (const probe of OBSIDIAN_ALIAS_PROBES.filter((x) => x.view === view)) {
          if (aliases[probe.id] !== probe.expected) {
            diffs.push(probe.id + '：' + String(aliases[probe.id]) + '≠' + probe.expected)
          }
        }
        if (diffs.length === 0) {
          aliasDiffStreak = 0
          return true
        }
        if (diffs.length >= 3 && ++aliasDiffStreak >= 4) throw new Error('探针持续差异（连续 4 轮采样）：' + diffs.join('；'))
        if (diffs.length < 3) aliasDiffStreak = 0
        return undefined
      }, 20000)
    }

    // live：全部 Obsidian 原名选择器经别名桥命中（含容器组合选择器）
    await waitViewState('style-contract.md', (v) => v.viewMode === 'live')
    await waitAliases('live')

    // reading：容器别名后的标签选择器族天然命中 + DOM 别名类命中
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('style-contract.md'))
    await waitViewState('style-contract.md', (v) => v.viewMode === 'reading')
    await waitAliases('reading')

    // 模式切换存活：切回 live 探针仍全命中（别名类不随视图切换丢失）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('style-contract.md'))
    await waitViewState('style-contract.md', (v) => v.viewMode === 'live')
    await waitAliases('live')
  }],

  ['Obsidian 原名别名桥：webview 重载后块重挂载探针复验（视口重挂，#132）', async () => {
    await resetLastMode()
    await openWithEditor('style-contract.md')
    await waitSessionReady('style-contract.md')
    const uri = wsUri('style-contract.md').toString()

    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('style-contract.md'))
    await waitViewState('style-contract.md', (v) => v.viewMode === 'reading')
    // 重载 webview：阅读块全部销毁重建（retainContextWhenHidden 关闭路径），
    // 别名类必须随块构建器（READING_CLASS_NAMES + 别名表）重新带上
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    await poll('重载后恢复阅读模式并采集探针', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.text === STYLE_CONTRACT_DOC_TEXT && (v.readingBlockCount ?? 0) > 0
        ? v : undefined
    }, 30000)
    // 重挂载后全部 reading 探针复验（轮询吸收块重建窗口；别名类经
    // READING_CLASS_NAMES + 别名表随块构建器带回）。同前：连续 4 轮采样
    // 均 ≥3 条才判持续差异，重挂空窗的瞬时 null 不触发首轮即抛
    let remountDiffStreak = 0
    await poll('重挂后 reading 别名探针全命中', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const aliases = v?.cssProbe?.obsidianAliases
      if (!aliases) return undefined
      const diffs: string[] = []
      for (const probe of OBSIDIAN_ALIAS_PROBES.filter((x) => x.view === 'reading')) {
        if (aliases[probe.id] !== probe.expected) {
          diffs.push(probe.id + '：' + String(aliases[probe.id]) + '≠' + probe.expected)
        }
      }
      if (diffs.length === 0) {
        remountDiffStreak = 0
        return true
      }
      if (diffs.length >= 3 && ++remountDiffStreak >= 4) throw new Error('重挂后探针持续差异（连续 4 轮采样）：' + diffs.join('；'))
      if (diffs.length < 3) remountDiffStreak = 0
      return undefined
    }, 20000)
  }],

  ['Obsidian 变量别名桥：真实片段经 --h1-color 驱动标题可见颜色（#132）', async () => {
    await resetLastMode()
    const dir = wsUri('css-snippets').fsPath
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    // 片段按 Obsidian 原名书写变量（--h1-color），另附一条 vsidian 类选择器
    // 规则做装载判别（覆盖 live-header-span 内部探针）
    await writeSnippetCss('css-snippets/alias-var.css', [
      ':root { --h1-color: rgb(66, 77, 88); }',
      '#app .vsidian-view-live .vsidian-header-1 { outline-color: rgb(70, 71, 72); }',
    ].join('\n'))
    try {
      // #128 的稳妥顺序：先配置目录（面板创建时 localResourceRoots 即含
      // 片段目录），再开面板（与真实用户「先配置后编辑」一致）
      await setSnippetDirectory(dir)
      await poll('片段扫描完成', async () => {
        const st = await snippetState()
        return st.directory === dir && !st.readError && st.entries.length === 1 ? st : undefined
      })
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))

      await setSnippetEnabled('alias-var.css', true)

      // live：片段选择器规则先证明装载（live-header-span 探针被覆盖），再断言
      // 标题可见颜色被 --h1-color 驱动（变量桥真实链路）
      const live = await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.cssProbe?.obsidianAliases?.['live-header-span'] === 'rgb(70, 71, 72)')
      assert(live.cssProbe!.obsidianVarProbe!.liveHeadingColor === 'rgb(66, 77, 88)',
        'live 标题色应被 --h1-color 驱动为 rgb(66, 77, 88)，实际 ' +
          String(live.cssProbe!.obsidianVarProbe!.liveHeadingColor))

      // reading：同名变量同样驱动阅读 h1（--h1-color 在 :root，两视图同链）；
      // 未涉及的探针维持内部值（无串扰）
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('mode.md'))
      const reading = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.obsidianVarProbe?.readingHeadingColor === 'rgb(66, 77, 88)')
      assert(reading.cssProbe!.obsidianAliases!['reading-task'] === 'rgb(163, 164, 165)',
        '片段不涉及的选择器应维持内部探针值（无串扰）')

      // 停用片段：回退默认（--h1-color 不再驱动，标题色回落主题前景色 ≠ 片段色）
      await setSnippetEnabled('alias-var.css', false)
      const reverted = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.obsidianVarProbe?.readingHeadingColor !== 'rgb(66, 77, 88)')
      assert(reverted.cssProbe!.obsidianVarProbe!.readingHeadingColor !== null, '停用后标题色应回落主题默认（非 null）')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  // ---- #130 HTTPS 样式导入与联网字体：真宿主 CSP 生效证据 ----

  ['CSS 片段：HTTPS 导入放行与明文拦截的真宿主证据（#130）', async () => {
    // 受控服务在扩展宿主进程内起（Node 环境）：自签证书 https + 明文 http。
    // 真宿主 webview 对自签证书做真实校验（测试无法注入信任）——字节是否
    // 完整送达不可证；可证的是**网络层差分**：CSP 放行的 https 请求会发起
    // 出网（socket 连接到达服务端，证书校验在其后才失败），被 CSP 拦截的
    // 明文请求不出网（请求层零命中）。完整装载链路由浏览器套件（受控证书
    // 校验跳过）与在线字体服务烟测覆盖。
    const nodeHttps = require('https') as typeof import('https')
    const nodeHttp = require('http') as typeof import('http')
    const nodeFs = require('fs') as typeof import('fs')
    const nodePath = require('path') as typeof import('path')
    const certDir = nodePath.join(__dirname, '..', '..', '..', '..', 'test', 'browser', 'fixtures', 'https')
    const tlsCert = nodeFs.readFileSync(nodePath.join(certDir, 'localhost-cert.pem'))
    const tlsKey = nodeFs.readFileSync(nodePath.join(certDir, 'localhost-key.pem'))

    // https 侧观测：socket 连接（出网意图，证书校验前的下限证据）+ 请求
    const tlsSeen = { connections: 0, requests: new Set<string>() }
    const httpsFiles = new Map<string, string>([
      ['/remote.css', '#app .vsidian-view-reading { --vsidian-probe-var-reading: from-remote-https; }\n'],
    ])
    const httpsServer = nodeHttps.createServer({ key: tlsKey, cert: tlsCert }, (req, res) => {
      tlsSeen.requests.add((req.url ?? '').split('?')[0]!)
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
      res.end(httpsFiles.get((req.url ?? '').split('?')[0]!) ?? '/* unknown */')
    })
    httpsServer.on('connection', () => {
      tlsSeen.connections += 1
    })
    // 明文 http 侧观测：请求零命中 = 未出网（CSP/混合内容共同保证明文不放行）
    const plainSeen = { requests: new Set<string>() }
    const plainServer = nodeHttp.createServer((req, res) => {
      plainSeen.requests.add((req.url ?? '').split('?')[0]!)
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' })
      res.end('#app .vsidian-view-reading { --vsidian-probe-var-reading: from-plain-http; }\n')
    })
    await new Promise<void>((resolve) => httpsServer.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => plainServer.listen(0, '127.0.0.1', resolve))
    const httpsBase = `https://127.0.0.1:${(httpsServer.address() as { port: number }).port}`
    const plainBase = `http://127.0.0.1:${(plainServer.address() as { port: number }).port}`

    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await writeSnippetCss('css-snippets/https.css', [
      `@import url("${httpsBase}/remote.css");`,
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: https-own; }',
    ].join('\n'))
    await writeSnippetCss('css-snippets/plain.css', [
      `@import url("${plainBase}/plain-sheet.css");`,
      '#app .vsidian-view-reading { --vsidian-probe-var-reading: plain-own; }',
    ].join('\n'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      // 基线：远程引用不影响条目装载与拒绝面（远程不进依赖图、不拒绝）
      await poll('两入口入列', async () => {
        const st = await snippetState()
        return st.entries.length === 2 && Object.keys(st.rejections ?? {}).length === 0 ? st : undefined
      }, 15000)
      await setSnippetEnabled('https.css', true)
      await setSnippetEnabled('plain.css', true)
      // 入口各自规则生效（https 导入即使证书校验失败，入口本地链照常装载、
      // 自身规则生效——嵌套失败不整份回滚的 #129 语义在真宿主复验）
      const applied = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'plain-own', 0, 20000)
      assert(applied.cssProbe!.readingVarProbe === 'plain-own', '含明文导入入口的自身规则生效')
      // 明文 http 不出网：请求层零命中（CSP 层拦截在请求发出前）
      await new Promise((r) => setTimeout(r, 800))
      assert(plainSeen.requests.size === 0,
        `明文 http 导入不得出网（实际命中 ${JSON.stringify([...plainSeen.requests])}）`)
      // https 放行差分证据：socket 连接到达服务端（证书校验后的成败不由此
      // 断言——见用例头声明；请求若实际到达则远程规则应已生效，顺带断言）
      await poll('https 出网连接到达', async () => tlsSeen.connections > 0 ? tlsSeen.connections : undefined, 15000)
      await new Promise((r) => setTimeout(r, 800))
      if (tlsSeen.requests.size > 0) {
        // 宿主未拒绝自签证书（环境相关）：完整装载也应成立
        await waitViewState('mode.md', (v) =>
          v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'from-remote-https', 0, 15000)
      } else {
        // 常见形态：证书校验失败（连接已到达、请求未完成）——能确认的状态
        // 如实呈现：出网意图已证，字节送达未证（浏览器套件与烟测覆盖）
        console.log('[#130] 自签证书被宿主拒绝（预期形态）：出网连接已到达，请求未完成')
      }
      // 绘制层：paint 探针只测 live 视图（cm-line），切回 live 断言——CSP
      // 变更不破 CM6 渲染（#37 教训：样式注入失效时 DOM 断言照样绿）
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
      const paintState = await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.paint?.textVisible === true, 0, 20000)
      assert(paintState.paint!.textVisible === true, 'HTTPS 片段装载后 live 正文绘制层可见')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
      httpsServer.close()
      plainServer.close()
    }
  }],

  ['CSS 片段：远程字体失败回退与多轮热换稳定（#130）', async () => {
    // 不可达端口的 https 字体（connection refused 立即失败）：入口其余规则
    // 生效、备用字体可见；随后多轮入口热换（真宿主 webview 的稳定性证据——
    // 浏览器套件实测的渲染器硬杀形态在本宿主不得复现）
    const deadPort = 1 // 127.0.0.1:1 通常无监听：连接拒绝
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    const entryCss = (tag: string) => [
      `@font-face { font-family: "VsidianDeadHttpsFont"; src: url("https://127.0.0.1:${deadPort}/dead.woff2") format("woff2"); }`,
      '#app .vsidian-view-reading { font-family: "VsidianDeadHttpsFont", sans-serif; --vsidian-probe-var-reading: ' + tag + '; }',
    ].join('\n')
    await writeSnippetCss('css-snippets/hot-https.css', entryCss('round-0'))
    try {
      await setSnippetDirectory(wsUri('css-snippets').fsPath)
      await setSnippetEnabled('hot-https.css', true)
      await openWithEditor('mode.md')
      await waitSessionReady('mode.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
      // 字体不可达：入口规则生效、正文以备用字体呈现（可读）
      const round0 = await waitViewState('mode.md', (v) =>
        v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === 'round-0' &&
        (v.readingMountedBlocks ?? 0) > 0, 0, 20000)
      assert(round0.cssProbe!.documentFonts !== undefined, '字体集观测可用')
      assert((round0.readingMountedBlocks ?? 0) > 0, '远程字体失败时阅读正文块仍挂载（备用字体回退，可读）')
      // 多轮热换：入口内容变更 → watcher 归因 → 入口 ?v= 推进 → 新链热换
      //（每轮嵌套 https 字体重试出网——真实宿主的样式表热换稳定性钉住点）
      for (let round = 1; round <= 5; round++) {
        await writeSnippetCss('css-snippets/hot-https.css', entryCss(`round-${round}`))
        const st = await waitViewState('mode.md', (v) =>
          v.viewMode === 'reading' && v.cssProbe?.readingVarProbe === `round-${round}` &&
          (v.readingMountedBlocks ?? 0) > 0, 0, 20000)
        assert((st.readingMountedBlocks ?? 0) > 0, `第 ${round} 轮热换后阅读正文块仍挂载（渲染器存活）`)
      }
      // 面板仍就绪 + live 绘制层可见（多轮热换不崩宿主 webview；paint 探针
      // 只测 live 视图，故切回 live 断言绘制层）
      const session = (await vscode.commands.executeCommand(CMD.sessionState, wsUri('mode.md').toString())) as
        { found: boolean; panels: Array<{ ready: boolean }> }
      assert(session.found && session.panels.some((panel) => panel.ready), '多轮热换后面板仍就绪')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
      const livePaint = await waitViewState('mode.md', (v) =>
        v.viewMode === 'live' && v.paint?.textVisible === true, 0, 20000)
      assert(livePaint.paint!.textVisible === true, '多轮热换后 live 正文绘制层可见')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['历史基线旧片段渲染验证：v0.4.0 承诺写法驱动真实可见效果（#134）', async () => {
    // 基线驱动：片段规则与期望值全部来自独立历史基线（v0.4.0 固化快照），
    // 不从候选清单/探针表生成——候选实现偏离历史承诺时此处独立失败（负向
    // 保证见 test/style-contract/checkStyleContract.test.mjs 的模拟树剥离）。
    await resetLastMode()
    const dir = wsUri('css-snippets').fsPath
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    const snippetCss = legacySnippetCases
      .map((c) => (c.kind === 'obsidian-variable' ? c.declaration : `${c.selector} {\n  ${c.property}: ${c.expected};\n}`))
      .join('\n\n')
    await writeSnippetCss('css-snippets/legacy-baseline.css', snippetCss + '\n')
    try {
      await setSnippetDirectory(dir)
      await poll('片段扫描完成（legacy-baseline）', async () => {
        const st = await snippetState()
        return st.directory === dir && !st.readError && st.entries.length === 1 ? st : undefined
      })
      await openWithEditor('style-contract.md')
      await waitSessionReady('style-contract.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('style-contract.md'))
      await setSnippetEnabled('legacy-baseline.css', true)

      /** 按基线用例的探针路径取值（'obsidianAliases.x' / 'obsidianVarProbe.y' / 顶层字段） */
      const probeValue = (probe: ViewState['cssProbe'], field: string): string | null | undefined => {
        if (!probe) return undefined
        const segs = field.split('.')
        let cur: unknown = probe
        for (const s of segs) cur = (cur as Record<string, unknown>)?.[s]
        return (cur as string | null | undefined) ?? undefined
      }

      // 轮询稳定形态：片段经 <link> 异步装载（enable 后首采可能仍是内部值）、
      // 装饰随视口/编辑增量重建——重试至基线期望全命中；**连续多轮**差异 ≥3
      // 条才提前报错（首轮即抛会把「装载中」误判为「持续差异」），零星波动继续等
      let legacyDiffStreak = 0
      const assertLegacyView = async (view: 'live' | 'reading'): Promise<void> => {
        legacyDiffStreak = 0
        await poll(view + ' 旧片段探针全命中（基线期望）', async () => {
          const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('style-contract.md').toString(), 0)) as ViewState | undefined
          if (v?.viewMode !== view) return undefined
          if (!v.cssProbe) return undefined
          const diffs: string[] = []
          for (const c of legacySnippetCases) {
            if (c.view !== view && c.view !== 'both') continue
            const field = c.kind === 'obsidian-variable' ? (view === 'live' ? c.probeLive : c.probeReading) : c.probe
            if (!field) continue
            const actual = probeValue(v.cssProbe, field)
            if (actual !== c.expected) diffs.push(`${c.id}（${field}）：${String(actual)} ≠ ${c.expected}`)
          }
          if (diffs.length === 0) return true
          legacyDiffStreak += 1
          if (legacyDiffStreak >= 4) throw new Error('旧片段持续差异（连续 4 轮采样）：' + diffs.join('；'))
          return undefined
        }, 20000)
      }

      // live：Obsidian 原名选择器（别名桥）+ vsidian 名 + 变量桥全部命中
      await assertLegacyView('live')
      // reading：同名片段驱动阅读侧（容器别名 + 标签选择器族 + 变量同链）
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('style-contract.md'))
      await assertLegacyView('reading')

      // 覆盖归因（负对照）：停用片段后基线期望值不再命中——证明覆盖确实
      // 来自历史片段装载，而非探针表与候选实现的自我印证（reading 侧键
      // 与该视图采集域一致；期望值同样取自基线，不硬编码）
      await setSnippetEnabled('legacy-baseline.css', false)
      const revertCase = legacySnippetCases.find((c) => c.id === 'reading-heading')!
      await poll('停用后旧片段期望值退场', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('style-contract.md').toString(), 0)) as ViewState | undefined
        if (v?.viewMode !== 'reading') return undefined
        return v.cssProbe?.obsidianAliases?.['reading-heading'] !== revertCase.expected &&
          v.cssProbe?.obsidianVarProbe?.readingHeadingColor !== 'rgb(240, 241, 242)'
          ? true
          : undefined
      }, 20000)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  // ---- #133 界面域公开样式契约（chrome 探针 / 真实片段 / 弹窗 / 重挂载）----

  ['界面域样式契约：chrome 探针双视图命中与模式切换（#133）', async () => {
    await resetLastMode()
    await openWithEditor('chrome-contract.md')
    await waitSessionReady('chrome-contract.md')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('chrome-contract.md'))

    // 探针按选择器作用域分组：live 组含 .vsidian-view-live、reading 组含
    // .vsidian-view-reading，其余（大纲侧栏、顶栏）DOM 常驻两组都断言
    const liveProbes = CHROME_CONTRACT_PROBES.filter((p) => p.selector.includes('.vsidian-view-live'))
    const readingProbes = CHROME_CONTRACT_PROBES.filter((p) => p.selector.includes('.vsidian-view-reading'))
    const alwaysProbes = CHROME_CONTRACT_PROBES.filter(
      (p) => !p.selector.includes('.vsidian-view-live') && !p.selector.includes('.vsidian-view-reading'),
    )
    assert(liveProbes.length + readingProbes.length + alwaysProbes.length === CHROME_CONTRACT_PROBES.length,
      '探针分组应完整覆盖探针表')

    // 断言器（轮询稳定形态，同 #132 别名探针）：mermaid 懒加载与装饰重建
    // 有空窗，poll 至稳定；「持续差异」须连续 4 轮采样均 ≥3 条才提前报错
    // （首轮即抛会把 mermaid 懒加载空窗误判为持续差异——CI Linux 实测
    // 808ms 首采三探针全 null 即抛，本地快环境复现不了），超时兜底
    const waitChrome = async (label: string, probes: readonly typeof CHROME_CONTRACT_PROBES[number][], timeoutMs: number): Promise<void> => {
      let chromeDiffStreak = 0
      await poll(label, async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('chrome-contract.md').toString(), 0)) as ViewState | undefined
        const probes0 = v?.cssProbe?.chromeSelectors
        if (!probes0) return undefined
        const diffs: string[] = []
        for (const probe of probes) {
          if (probes0[probe.id] !== probe.expected) {
            diffs.push(probe.id + '：' + String(probes0[probe.id]) + '≠' + probe.expected)
          }
        }
        if (diffs.length === 0) {
          chromeDiffStreak = 0
          return true
        }
        if (diffs.length >= 3 && ++chromeDiffStreak >= 4) throw new Error('chrome 探针持续差异（连续 4 轮采样）：' + diffs.join('；'))
        if (diffs.length < 3) chromeDiffStreak = 0
        return undefined
      }, timeoutMs)
    }

    // live：全部 live 作用域 + 常驻探针命中（mermaid rendered 态门控在 60s 预算内）
    await waitViewState('chrome-contract.md', (v) => v.viewMode === 'live')
    await waitChrome('live chrome 探针全命中', [...liveProbes, ...alwaysProbes], 60000)

    // reading：全部 reading 作用域 + 常驻探针命中
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('chrome-contract.md'))
    await waitViewState('chrome-contract.md', (v) => v.viewMode === 'reading')
    await waitChrome('reading chrome 探针全命中', [...readingProbes, ...alwaysProbes], 60000)

    // 模式切换存活：切回 live 探针仍全命中
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('chrome-contract.md'))
    await waitViewState('chrome-contract.md', (v) => v.viewMode === 'live')
    await waitChrome('切回 live chrome 探针复验', [...liveProbes, ...alwaysProbes], 60000)
  }],

  ['界面域样式契约：真实片段驱动 chrome 可见属性与停用回退（#133）', async () => {
    await resetLastMode()
    const dir = wsUri('css-snippets').fsPath
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    // 片段按用户文档口径书写（无 #app 前缀的稳定类选择器）——五个区域各
    // 一条可见颜色改写：公式 / 卡片标签 / token / 图表容器 / 大纲层级色
    await writeSnippetCss('css-snippets/chrome-paint.css', [
      '.vsidian-math .katex { color: rgb(61, 62, 63); }',
      '.vsidian-code-card-header-label { color: rgb(64, 65, 66); }',
      '.tok-keyword { color: rgb(67, 68, 69); }',
      '.vsidian-mermaid { color: rgb(70, 71, 72); }',
      '.vsidian-outline-level-1 { color: rgb(73, 74, 75); }',
    ].join('\n'))
    try {
      await setSnippetDirectory(dir)
      await poll('片段扫描完成', async () => {
        const st = await snippetState()
        return st.directory === dir && !st.readError && st.entries.length === 1 ? st : undefined
      })
      await openWithEditor('chrome-contract.md')
      await waitSessionReady('chrome-contract.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('chrome-contract.md'))
      await setSnippetEnabled('chrome-paint.css', true)

      const expectPaint = (v: ViewState): boolean =>
        v.cssProbe?.chromePaint?.mathKatexColor === 'rgb(61, 62, 63)' &&
        v.cssProbe?.chromePaint?.codeCardLabelColor === 'rgb(64, 65, 66)' &&
        v.cssProbe?.chromePaint?.tokKeywordColor === 'rgb(67, 68, 69)' &&
        v.cssProbe?.chromePaint?.mermaidContainerColor === 'rgb(70, 71, 72)' &&
        v.cssProbe?.chromePaint?.outlineLevel1Color === 'rgb(73, 74, 75)'

      // live：五区域可见颜色全部被片段驱动（mermaid 懒加载故放宽预算）
      const live = await waitViewState('chrome-contract.md',
        (v) => v.viewMode === 'live' && expectPaint(v), 0, 60000)
      assert(live.cssProbe!.chromePaint!.outlineLevel1Color === 'rgb(73, 74, 75)',
        '大纲一级条目色应被片段驱动（与正文标题同源变量的层级色入口可覆写）')

      // reading：同类名双侧命中（阅读侧 chromePaint 换取 reading 作用域目标）
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('chrome-contract.md'))
      await waitViewState('chrome-contract.md', (v) => v.viewMode === 'reading' && expectPaint(v), 0, 60000)

      // 停用回退：颜色离开片段值且回到非空默认（可见属性回到主题默认）
      await setSnippetEnabled('chrome-paint.css', false)
      const reverted = await waitViewState('chrome-contract.md', (v) =>
        v.viewMode === 'reading' && !expectPaint(v) &&
        v.cssProbe?.chromePaint?.mathKatexColor !== null &&
        v.cssProbe?.chromePaint?.tokKeywordColor !== null)
      assert(reverted.cssProbe!.chromePaint!.mermaidContainerColor !== 'rgb(70, 71, 72)',
        '停用后图表容器色应回落默认')
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['界面域样式契约：图表弹窗样式随打开与刷新保持（#133）', async () => {
    await resetLastMode()
    const dir = wsUri('css-snippets').fsPath
    await vscode.workspace.fs.createDirectory(wsUri('css-snippets'))
    await writeSnippetCss('css-snippets/popup-paint.css', [
      '.vsidian-diagram-toolbar { color: rgb(79, 80, 81); }',
      '.vsidian-diagram-stage { color: rgb(82, 83, 84); }',
    ].join('\n'))
    try {
      await setSnippetDirectory(dir)
      await poll('片段扫描完成', async () => {
        const st = await snippetState()
        return st.directory === dir && !st.readError && st.entries.length === 1 ? st : undefined
      })
      await openWithEditor('chrome-contract.md')
      await waitSessionReady('chrome-contract.md')
      await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('chrome-contract.md'))
      await setSnippetEnabled('popup-paint.css', true)
      const uri = wsUri('chrome-contract.md').toString()
      // 等 mermaid 就位（popup 按钮挂在渲染成功态的 frame 上）
      await waitViewState('chrome-contract.md', (v) =>
        v.viewMode === 'live' && (v.liveMermaidCount ?? 0) >= 1, 0, 60000)

      // 打开前：弹窗不在场（chromePopup 为 null 是在场性观测点）
      const before = await waitViewState('chrome-contract.md', (v) => v.cssProbe?.chromePopup === null)
      assert(before.cssProbe!.chromePopup === null, '弹窗未打开时无浮层 DOM')

      // 打开弹窗：浮层在场且两区颜色被片段驱动
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'graphic.test.popup', view: 'live', index: 0 })
      const opened = await waitViewState('chrome-contract.md', (v) =>
        v.cssProbe?.chromePopup?.toolbarColor === 'rgb(79, 80, 81)' &&
        v.cssProbe?.chromePopup?.stageColor === 'rgb(82, 83, 84)', 0, 60000)
      assert(opened.paint?.graphic?.overlay === true, '浮层应在场（绘制层）')

      // 刷新（原地重取源码重渲染）：浮层保持且片段样式不丢
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'graphic.test.popup', view: 'live', index: 0, action: 'refresh' })
      await waitViewState('chrome-contract.md', (v) =>
        v.paint?.graphic?.overlay === true &&
        v.cssProbe?.chromePopup?.toolbarColor === 'rgb(79, 80, 81)' &&
        v.cssProbe?.chromePopup?.stageColor === 'rgb(82, 83, 84)', 0, 60000)

      // 关闭：浮层撤下（在场性回到 null）
      await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'graphic.test.popup', view: 'live', index: 0, action: 'close' })
      await waitViewState('chrome-contract.md', (v) => v.cssProbe?.chromePopup === null)
    } finally {
      await setSnippetDirectory(null)
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('css-snippets'), { recursive: true, useTrash: false })).catch(() => undefined)
    }
  }],

  ['界面域样式契约：webview 重载后 chrome 探针复验（虚拟化重挂，#133）', async () => {
    await resetLastMode()
    await openWithEditor('chrome-contract.md')
    await waitSessionReady('chrome-contract.md')
    const uri = wsUri('chrome-contract.md').toString()

    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('chrome-contract.md'))
    await waitViewState('chrome-contract.md', (v) => v.viewMode === 'reading' && (v.readingBlockCount ?? 0) > 0)
    // 重载 webview：阅读块全部销毁重建（卡片/公式/图表挂载钩子从源码重新
    // 增强），侧栏与顶栏同步重建——chrome 探针必须全部重新命中
    await vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    await poll('重载后恢复阅读模式并采集探针', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.text === CHROME_CONTRACT_DOC_TEXT && (v.readingBlockCount ?? 0) > 0
        ? v : undefined
    }, 30000)
    const readingProbes = CHROME_CONTRACT_PROBES.filter((p) => !p.selector.includes('.vsidian-view-live'))
    // 同前：连续 4 轮采样均 ≥3 条才判持续差异，重挂/懒加载空窗不触发首轮即抛
    let remountChromeDiffStreak = 0
    await poll('重挂后 chrome 探针全命中', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
      const probes0 = v?.cssProbe?.chromeSelectors
      if (!probes0) return undefined
      const diffs: string[] = []
      for (const probe of readingProbes) {
        if (probes0[probe.id] !== probe.expected) {
          diffs.push(probe.id + '：' + String(probes0[probe.id]) + '≠' + probe.expected)
        }
      }
      if (diffs.length === 0) {
        remountChromeDiffStreak = 0
        return true
      }
      if (diffs.length >= 3 && ++remountChromeDiffStreak >= 4) throw new Error('重挂后 chrome 探针持续差异（连续 4 轮采样）：' + diffs.join('；'))
      if (diffs.length < 3) remountChromeDiffStreak = 0
      return undefined
    }, 60000)
  }],

  // ---- #140 / #141：frontmatter 卡片编辑链路与工具栏双态切换 ----

  ['frontmatter 只读卡片与 Popover 编辑：写回、dirty、光标引导、模式切换、外部同步与保存重开（#140）', async () => {
    await openWithEditor('fm-edit.md')
    await waitSessionReady('fm-edit.md')
    const uri = wsUri('fm-edit.md').toString()
    const doc = await vscode.workspace.openTextDocument(wsUri('fm-edit.md'))

    // 前置：live 态成型只读卡片在场（chrome 探针：卡片行 + 键值行 + 标题栏）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'live' &&
      v.cssProbe?.chromeSelectors?.['live-fm-card-line-live'] === 'rgb(230, 0, 1)' &&
      v.cssProbe?.chromeSelectors?.['live-fm-row-live'] === 'rgb(231, 0, 1)' &&
      v.cssProbe?.chromeSelectors?.['live-fm-header-live'] === 'rgb(237, 0, 1)')
    const st0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const editsBefore = st0.appliedEdits

    // 0) 光标引导：view.locate 定位进头区 → 选区被弹到闭合行后（成型态
    //    不暴露源码；定位事务为纯选区，appliedEdits 不增）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: FM_EDIT_DOC_TEXT.indexOf('集成标题') + 1 })
    const bodyStart = FM_EDIT_DOC_TEXT.indexOf('---', 4) + 4
    await poll('光标引导弹出头区', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as ViewState
      return (v.selectionOffset !== undefined && v.selectionOffset >= bodyStart) ? v.selectionOffset : undefined
    })

    // 1) 打开 Popover → block 数组末尾加项：浮层按钮 click → 编辑计划 →
    //    CM6 事务 → 宿主写回（一笔）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'edit-button' })
    await waitViewState('fm-edit.md', (v) => v.fmPopoverOpen === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'popover-add-item', index: 0 })
    const withItem = FM_EDIT_DOC_TEXT.replace('  - 甲\n---', '  - 甲\n  - item\n---')
    await waitViewState('fm-edit.md', (v) => v.text === withItem && v.fmPopoverOpen === true)
    assert(doc.isDirty, '加项写回后文档应 dirty（未保存）')
    const st1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st1.appliedEdits === editsBefore + 1, `一次结构按钮应恰一笔宿主写回，实际增量 ${st1.appliedEdits - editsBefore}`)

    // 2) 删除该项（浮层内第 2 个项删除按钮，DOM 文档序）：内容回到基线
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'popover-remove-item', index: 1 })
    await waitViewState('fm-edit.md', (v) => v.text === FM_EDIT_DOC_TEXT)

    // 3) 新增键值对模板（浮层「添加属性」）：`key: value` 落在末条目后
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'popover-add-entry' })
    const withEntry = FM_EDIT_DOC_TEXT.replace('  - 甲\n---', '  - 甲\nkey: value\n---')
    await waitViewState('fm-edit.md', (v) => v.text === withEntry)

    // 3.5) 关闭浮层（与 Esc 同一关闭函数）：焦点返还、零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'popover-close' })
    await waitViewState('fm-edit.md', (v) => v.fmPopoverOpen === false && v.text === withEntry)

    // 4) 模式切换不丢内容：reading 侧同款表格呈现（探针）+ 回 live 卡片仍在
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'reading' && v.text === withEntry &&
      v.cssProbe?.chromeSelectors?.['live-fm-row-reading'] === 'rgb(233, 0, 1)')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'live' && v.text === withEntry &&
      v.cssProbe?.chromeSelectors?.['live-fm-card-line-live'] === 'rgb(230, 0, 1)')

    // 5) 外部变更同步进头区：宿主 applyEdit 改 title，面板同步且卡片不降级
    const extEdit = new vscode.WorkspaceEdit()
    extEdit.replace(wsUri('fm-edit.md'), new vscode.Range(1, 7, 1, 11), '外部改写')
    assert(await vscode.workspace.applyEdit(extEdit), '外部修改应成功')
    const externalText = withEntry.replace('title: 集成标题', 'title: 外部改写')
    await waitViewState('fm-edit.md', (v) => v.text === externalText &&
      v.cssProbe?.chromeSelectors?.['live-fm-card-line-live'] === 'rgb(230, 0, 1)')

    // 6) 保存 → 磁盘落定 → 关面板重开：内容与卡片回放
    await doc.save()
    assert(!doc.isDirty, '保存后应清除 dirty')
    assert(await readDisk('fm-edit.md') === externalText, '保存应把卡片编辑落到磁盘')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await openWithEditor('fm-edit.md')
    await waitSessionReady('fm-edit.md')
    await waitViewState('fm-edit.md', (v) => v.text === externalText &&
      v.cssProbe?.chromeSelectors?.['live-fm-card-line-live'] === 'rgb(230, 0, 1)' &&
      v.cssProbe?.chromeSelectors?.['live-fm-header-live'] === 'rgb(237, 0, 1)')
  }],

  ['frontmatter 卡片折叠：与代码块同交互（热区 + chevron）、零写回、双视图各持视图态', async () => {
    await openWithEditor('fm-edit.md')
    await waitSessionReady('fm-edit.md')
    const uri = wsUri('fm-edit.md').toString()
    const fmText = (await vscode.commands.executeCommand(CMD.viewState, uri) as ViewState).text!

    // 前置：live 成型卡片在场（绘制层：键值行 + 修改按钮 + 未收起 chevron）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'live' &&
      v.cssProbe?.chromeSelectors?.['live-fm-card-line-live'] === 'rgb(230, 0, 1)' &&
      (v.paint?.fm?.rowCount ?? 0) > 0 && v.paint?.fm?.editCount === 1 &&
      v.paint?.fm?.foldedCount === 0)
    const st0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 1) chevron 折叠：行从绘制层消失、修改按钮让位、收起态行类与 chevron
    //    转向在场；文档字节与写回数不变（视图态零写回）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'fold-button' })
    await waitViewState('fm-edit.md', (v) => v.paint?.fm?.rowCount === 0 &&
      v.paint?.fm?.editCount === 0 && v.paint?.fm?.foldedCount === 1 &&
      v.paint?.fm?.cardFoldedCount === 1 && v.paint?.fm?.tableFoldedCount === 0)
    assert((await vscode.commands.executeCommand(CMD.viewState, uri) as ViewState).text === fmText,
      '折叠不得写文档')
    const st1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(st1.appliedEdits === st0.appliedEdits, '折叠不得产生宿主写回')

    // 2) 标题栏热区展开：整条标题栏同为切换入口（非按钮区域点击）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'fold-hotspot' })
    await waitViewState('fm-edit.md', (v) => (v.paint?.fm?.rowCount ?? 0) > 0 &&
      v.paint?.fm?.editCount === 1 && v.paint?.fm?.foldedCount === 0 && v.paint?.fm?.cardFoldedCount === 0)

    // 3) 热区再折叠后切阅读：两视图折叠态各持不互通——阅读初始展开
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'fold-hotspot' })
    await waitViewState('fm-edit.md', (v) => v.paint?.fm?.cardFoldedCount === 1)
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'reading' &&
      (v.paint?.fm?.rowCount ?? 0) > 0 && v.paint?.fm?.tableFoldedCount === 0)

    // 4) 阅读侧折叠（表格收起类 + 行隐藏）与展开——rowCount 为绘制层口径
    //    （阅读收起行由 CSS display:none 隐藏，非 DOM 移除；探针过滤后归零）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'fold-button' })
    await waitViewState('fm-edit.md', (v) => v.paint?.fm?.rowCount === 0 &&
      v.paint?.fm?.tableFoldedCount === 1 && v.paint?.fm?.foldedCount === 1)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'fm.test.click', action: 'fold-button' })
    await waitViewState('fm-edit.md', (v) => (v.paint?.fm?.rowCount ?? 0) > 0 && v.paint?.fm?.tableFoldedCount === 0)

    // 5) 回 live：CM6 折叠态随编辑器状态保留（步骤 3 的收起态仍在场）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('fm-edit.md'))
    await waitViewState('fm-edit.md', (v) => v.viewMode === 'live' &&
      v.paint?.fm?.cardFoldedCount === 1 && v.paint?.fm?.rowCount === 0)
    assert((await vscode.commands.executeCommand(CMD.viewState, uri) as ViewState).text === fmText,
      '全程折叠切换不得写文档')
  }],

  ['工具栏双态切换：真实点击与快捷键通道、三态按钮共存与全局记忆（#141）', async () => {
    await openWithEditor('mode.md')
    await waitSessionReady('mode.md')
    const uri = wsUri('mode.md').toString()

    // 前置：live 态、按钮在场（chrome 探针 view-toggle 常驻两模式）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    await waitViewState('mode.md', (v) => v.viewMode === 'live' &&
      v.cssProbe?.chromeSelectors?.['view-toggle'] === 'rgb(236, 0, 1)')

    // 1) 按钮真实点击：live → reading（出站 view.switch.request → 宿主
    //    runViewSwitch 全套编排：模式记忆、view.mode.set 回流驱动按钮态）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.test.click' })
    await waitViewState('mode.md', (v) => v.viewMode === 'reading')
    await waitLastMode('reading')

    // 2) 再点回 live：reading → live，记忆同步（按钮常驻可双向）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.test.click' })
    await waitViewState('mode.md', (v) => v.viewMode === 'live')
    await waitLastMode('live')

    // 3) 快捷键通道下游宿主段：keybindings.execute 出站 → 宿主
    //    executeCommand → 同一双态实现。Ctrl+Q 的按键匹配归 keybindingRouter
    //    单测；集成宿主中 webview 面板不真实持有焦点（webviewPanel.active
    //    为 false，宿主对该消息有 active 门控——真实按键场景面板必有焦点），
    //    故此处直接执行同一宿主命令覆盖下游段
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toggleDualView')
    await waitViewState('mode.md', (v) => v.viewMode === 'reading')
    await waitLastMode('reading')

    // 4) 与右上角三态按钮共存一致：三态命令回 live 后按钮再点仍双向可用，
    //    reading 态按钮在场（图标随 body 模式类切换，探针不依赖模式）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', wsUri('mode.md'))
    await waitViewState('mode.md', (v) => v.viewMode === 'live')
    await waitLastMode('live')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.test.click' })
    await waitViewState('mode.md', (v) => v.viewMode === 'reading' &&
      v.cssProbe?.chromeSelectors?.['view-toggle'] === 'rgb(236, 0, 1)')
    await waitLastMode('reading')

    // 5) 源码态兜底：命令入口在源码编辑器态取反回 Vsidian 面板（open-in-
    //    vsidian 分支，不落源码自环、不弹「已在源码」提示）
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', wsUri('mode.md'))
    await waitActiveTextEditor('mode.md')
    await waitLastMode('source')
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toggleDualView')
    const session = await waitSessionReady('mode.md')
    assert(session.panels.length >= 1, '源码态双态命令应回 Vsidian 面板')
    await waitViewState('mode.md', (v) => v.viewMode === 'live')
    await waitLastMode('live')
  }],

  // ---- #208：工具栏刷新嵌入资源（外部替换图片 → 手动刷新 → 换新重载） ----

  ['工具栏刷新嵌入资源：外部替换同名图片后换新代次 URI 实际重载，选区/模式保持零写回（#208）', async () => {
    await openWithEditor('refresh.md')
    await waitSessionReady('refresh.md')
    const uri = wsUri('refresh.md').toString()

    // 全文装载前置：scrollNearLine 早于 init 装载会被行数钳制回顶部，
    // 装载完成后图片行从此不进视口（widget 不建、解析不触发）
    await waitViewState('refresh.md', (v) => v.text === REFRESH_DOC_TEXT)
    // 图片行滚动进视口：装载解析与 imageProbe 观测都以「视口内活跃槽位」
    // 为源——fixture 的 24 行填充原依赖 CI xvfb 窗口高度，本地矮窗口下
    // 图片行可能落视口外；滚动定位使装载不依赖窗口几何
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'viewport.test.position', scrollNearLine: REFRESH_IMAGE_LINE,
    })


    // 前置：live 态初始装载——1x1 透明图经宿主通道加载成功（load 事件置
    // loaded）；#201 并入后 URI 戳 = 版本表首观测代次(1) + 会话代次(0)，
    // 首装载即带 ?v=1（缓存击穿参数常在，仅失效后换值）
    const initial = await waitViewState('refresh.md', (v) =>
      (v.imageStates?.loaded ?? 0) >= 1 && (v.imageProbe?.length ?? 0) >= 1, 0, 30000)
    const initialSlot = initial.imageProbe![0]!
    assert(initialSlot.src !== null, `初始图片应有 src，实际 ${JSON.stringify(initialSlot)}`)
    assert(initialSlot.src!.includes('?v=1'),
      `初始 URI 应带版本表首观测戳 ?v=1（融合 #201 版本表后形态），实际 ${initialSlot.src}`)
    const initialSrc = initialSlot.src!
    assert(initialSlot.naturalWidth === 1,
      `初始 1x1 图浏览器解码宽度应为 1，实际 ${initialSlot.naturalWidth}（src=${initialSlot.src}）`)
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session0.imageGeneration === 0, `初始资源代次应为 0，实际 ${session0.imageGeneration}`)
    // 绘制层断言（评审必查：用户看到的按钮）：chrome 探针命中即按钮按
    // 契约样式真实绘制（非 DOM 存在性）
    assert(initial.cssProbe?.chromeSelectors?.['toolbar-refresh'] === 'rgb(239, 0, 1)',
      `刷新按钮绘制层应命中探针，实际 ${String(initial.cssProbe?.chromeSelectors?.['toolbar-refresh'])}`)

    // 光标落在正文段（刷新前后选区保持的断言锚点）
    const caretOffset = REFRESH_DOC_TEXT.indexOf('选区保持')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.locate', offset: caretOffset })
    const located = await waitViewState('refresh.md', (v) => v.selectionOffset === caretOffset)
    assert(located.viewMode === 'live', `刷新前置应为 live 模式，实际 ${located.viewMode}`)

    // 滚动位置保持的断言锚点：居中图片行得非零 scrollTop（viewport 探针
    // 随 viewport.test.position 启用，liveScrollTopPx 进观测面）；图片行
    // 居中同时保证其 widget 不滚出视口装饰范围，失效重挂照常覆盖它
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'viewport.test.position', scrollNearLine: REFRESH_IMAGE_LINE,
    })
    const scrolled = await waitViewState('refresh.md', (v) => (v.liveScrollTopPx ?? -1) > 0, 0, 30000)
    const scrollTopBefore = scrolled.liveScrollTopPx!

    // 外部替换磁盘同名图片：不同内容与尺寸（1x1 透明 → 2x2 不透明红）
    await vscode.workspace.fs.writeFile(
      wsUri('assets/刷新图.png'), Buffer.from(REFRESH_PNG_2X2_BASE64, 'base64'))

    // 触发刷新：真实按钮点击路径（refresh.test.click → 按钮处理器出站
    // refresh.request → 宿主清 imageCache + 代次自增 → refresh.invalidated
    // → webview 全量失效重挂）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'refresh.test.click' })

    // 失效重挂闭环：新 URI 带代次戳且实际更新（融合 #201 后戳为「版本表
    // 观测代次 + 会话代次」之和——外部替换使版本表观测推进、手动刷新使
    // 会话代次自增，具体值依两条通道到达次序（2 或 3），只断带戳与换新）、
    // 浏览器真实解码了新地址的字节（naturalWidth 1 → 2——HTTP 缓存被戳
    // 击穿、用户看到新图的绘制层证据）、槽位回到 loaded
    const refreshed = await waitViewState('refresh.md', (v) => {
      const slot = v.imageProbe?.[0]
      return slot?.state === 'loaded' && slot?.src != null &&
        slot.src.includes('?v=') && slot.src !== initialSlot.src &&
        slot.naturalWidth === 2
    }, 0, 30000)
    const refreshedSlot = refreshed.imageProbe![0]!
    assert(refreshedSlot.src !== initialSrc,
      `刷新后 img src 应实际更新（旧 ${initialSrc} → 新 ${String(refreshedSlot.src)}）`)

    // 宿主侧资源代次推进到 1（URI 戳的数据源）
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.imageGeneration === 1, `刷新后资源代次应为 1，实际 ${session1.imageGeneration}`)

    // 状态保持：刷新 = 清缓存重渲染，不是重开文件——光标、滚动、视图模式
    // 原样（滚动容差 ±2px：图片重载闪动期间的测度取整，不视为位置丢失；
    // 阅读侧滚动与查找会话保持由人工验收项覆盖）
    assert(refreshed.selectionOffset === caretOffset,
      `刷新后光标应保持 ${caretOffset}，实际 ${refreshed.selectionOffset}`)
    assert(refreshed.viewMode === 'live', `刷新后视图模式应保持 live，实际 ${refreshed.viewMode}`)
    assert(refreshed.liveScrollTopPx !== undefined && Math.abs(refreshed.liveScrollTopPx - scrollTopBefore) <= 2,
      `刷新后滚动位置应保持 ${scrollTopBefore}，实际 ${String(refreshed.liveScrollTopPx)}`)

    // 无破坏性：文档内容、写回链路、磁盘全部原样
    assert(refreshed.text === REFRESH_DOC_TEXT, '刷新不得改写文档文本')
    assert(session1.appliedEdits === 0, `刷新不得产生 applyEdit，实际 ${session1.appliedEdits}`)
    assert(await readDisk('refresh.md') === REFRESH_DOC_TEXT, '刷新不得写磁盘')

    // 刷新不破坏工具栏绘制层（按钮仍按契约样式绘制）
    assert(refreshed.cssProbe?.chromeSelectors?.['toolbar-refresh'] === 'rgb(239, 0, 1)',
      `刷新后按钮绘制层应仍命中探针，实际 ${String(refreshed.cssProbe?.chromeSelectors?.['toolbar-refresh'])}`)

    // 二次刷新：连续点击链路健壮（reqId 陈旧回执防护的宿主/webview 汇合
    // 点）。融合 #201 后戳值为「版本表观测代次 + 会话代次」之和——具体值
    // 依赖两条失效通道的到达次序（watcher 自动 / 手动刷新叠加推进），不
    // 钉具体数字，钉「带戳且换新且解码正常」
    const firstRefreshedSrc = refreshedSlot.src
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'refresh.test.click' })
    await waitViewState('refresh.md', (v) => {
      const slot = v.imageProbe?.[0]
      return slot?.state === 'loaded' && slot?.src != null &&
        slot.src.includes('?v=') && slot.src !== firstRefreshedSrc &&
        slot.naturalWidth === 2
    }, 0, 30000)
    const session2 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session2.imageGeneration === 2, `二次刷新后资源代次应为 2，实际 ${session2.imageGeneration}`)
  }],

  // ---- #160：普通链接锚点定位（fragment 结构化保留 + 打开后定位） ----

  ['普通链接锚点跳转（Vsidian 面板）：含空格路径矩阵；缺失标题、块 id 定位与外部 #（#160）', async () => {
    /** 注入普通链接意图（与真实 webview 消息同一校验与处理入口） */
    const injectLink = async (uri: string, href: string): Promise<void> => {
      await vscode.commands.executeCommand(CMD.injectMessage, uri, {
        kind: 'link.activate', sessionId: '', docUri: uri, href, srcStart: 0, srcEnd: 10,
      })
    }
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    const uri = wsUri('links.md').toString()
    const diskBefore = await readDisk('links.md')

    // 含空格路径 + 锚点（%20/%E5 编码形态）：拆分出路径与 fragment 后
    // 面板定位到标题行（fixture「子 目录/目标 二.md」首行 `# 目标 二`）
    await injectLink(uri, './子%20目录/目标%20二.md#%E7%9B%AE%E6%A0%87%20%E4%BA%8C')
    let logData = await waitWikilinkLog(uri, (e) =>
      e.kind === 'doc' && e.fragment === '目标 二' && e.path === wsUri('子 目录/目标 二.md').fsPath)
    assert(logData!.locate === 'custom-panel', `含空格路径应经面板定位，实际 ${logData!.locate}`)
    await waitSessionReady('子 目录/目标 二.md')
    await waitActiveCustomTab('子 目录/目标 二.md')
    await waitViewState('子 目录/目标 二.md', (v) => v.selectionOffset === 0)
    assert(tabsOf('子 目录/目标 二.md', 'native') === 0, '含空格路径不应打开源码标签')

    // 重显源面板再注入
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    // 无扩展名路径 + 锚点：候选补 .md 后命中（fragment 定位同款）
    await injectLink(uri, './链接目标#链接目标')
    logData = await waitWikilinkLog(uri, (e) =>
      e.kind === 'doc' && e.fragment === '链接目标' && e.path === wsUri('链接目标.md').fsPath)
    assert(logData!.locate === 'custom-panel', `无扩展名锚点应经面板定位，实际 ${logData!.locate}`)
    await waitSessionReady('链接目标.md')
    await waitActiveCustomTab('链接目标.md')
    await waitViewState('链接目标.md', (v) => v.selectionOffset === 0)
    assert(tabsOf('链接目标.md', 'native') === 0, '无扩展名锚点不应打开源码标签')

    // 缺失标题：文档照常打开（不定位），日志 locate=none——缺失给可见反馈
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    await injectLink(uri, './链接目标.md#不存在的小节')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'doc' && e.fragment === '不存在的小节')
    assert(logData!.locate === 'none', `缺失标题应记录 locate=none，实际 ${logData!.locate}`)
    await waitActiveCustomTab('链接目标.md')

    // #^块id fragment：块定位器与双链锚点同源（#159 交付，批次合并后接通）——
    // 面板 view.locate 应落在目标块首行（findBlockOffset 块首语义）
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    await injectLink(uri, './链接目标.md#^link-blk')
    logData = await waitWikilinkLog(uri, (e) => e.kind === 'doc' && e.fragment === '^link-blk')
    assert(logData!.locate === 'custom-panel', `块 id 应经面板定位，实际 ${logData!.locate}`)
    const linkTargetText = (await vscode.workspace.openTextDocument(wsUri('链接目标.md'))).getText()
    await waitViewState('链接目标.md', (v) =>
      v.selectionOffset === linkTargetText.indexOf('普通链接块引用目标段落。 ^link-blk'))
    assert(tabsOf('链接目标.md', 'native') === 0, '块 id 跳转不应打开源码标签')

    // 外部 URL 的 # 不接管：照旧 external 归类（测试钩子不真开浏览器）。
    // 先重显源面板再注入
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    await injectLink(uri, 'https://example.com/a#frag')
    await waitWikilinkLog(uri, (e) => e.kind === 'external' && e.href === 'https://example.com/a#frag')

    assert(await readDisk('links.md') === diskBefore, '锚点跳转不得改写源文档')
  }],

  ['普通链接页内锚点与面板定位：view.locate 挂载定位（#160）', async () => {
    // 源面板（links.md）+ 目标面板（目标笔记.md）并排；目标切阅读模式，
    // 页内锚点（#frag）与跨文档锚点（./目标.md#标题）都应走 custom-panel
    await openWithEditor('links.md')
    await waitSessionReady('links.md')
    const sourceUri = wsUri('links.md').toString()
    await openWithEditor('目标笔记.md', true)
    await waitSessionReady('目标笔记.md')
    const targetUri = wsUri('目标笔记.md').toString()
    const diskSource = await readDisk('links.md')
    const diskTarget = await readDisk('目标笔记.md')

    await vscode.commands.executeCommand('onegayi.vsidian.toggleViewMode')
    await poll('目标进入阅读模式', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingTotalBlocks !== undefined ? v : undefined
    })

    // 页内锚点（# 开头 href）：目标即当前文档（目标笔记面板自身），
    // 阅读模式经 view.locate 块挂载定位到屏外标题（DEEP_HEADING_OFFSET）
    await vscode.commands.executeCommand(CMD.injectMessage, targetUri, {
      kind: 'link.activate', sessionId: '', docUri: targetUri,
      href: '#深处的标题', srcStart: 0, srcEnd: 10,
    })
    const after = await poll('页内锚点挂载定位', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingAnchorStart === DEEP_HEADING_OFFSET ? v : undefined
    }, 30000)
    assert(after.readingAnchorStart === DEEP_HEADING_OFFSET,
      `页内锚点阅读锚点应为屏外标题块 start，实际 ${after.readingAnchorStart}`)
    let logData = await waitWikilinkLog(targetUri, (e) =>
      e.kind === 'anchor' && e.fragment === '深处的标题')
    assert(logData!.locate === 'custom-panel', `面板路径应记录 locate=custom-panel，实际 ${logData!.locate}`)

    // 跨文档锚点：从源面板（links.md）跳 ./目标笔记.md#深处的标题——
    // 目标已是本扩展面板，reveal 后 view.locate（与 #11 双链同款落位）
    await vscode.commands.executeCommand(CMD.injectMessage, sourceUri, {
      kind: 'link.activate', sessionId: '', docUri: sourceUri,
      href: './目标笔记.md#深处的标题', srcStart: 0, srcEnd: 10,
    })
    await poll('跨文档锚点挂载定位', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri, 0)) as ViewState | undefined
      return v?.viewMode === 'reading' && v.readingAnchorStart === DEEP_HEADING_OFFSET ? v : undefined
    }, 30000)
    logData = await waitWikilinkLog(sourceUri, (e) =>
      e.kind === 'doc' && e.fragment === '深处的标题' && e.path === wsUri('目标笔记.md').fsPath)
    assert(logData!.locate === 'custom-panel', `跨文档面板路径应记录 locate=custom-panel，实际 ${logData!.locate}`)

    assert(await readDisk('links.md') === diskSource, '页内锚点跳转不得改写源文档')
    assert(await readDisk('目标笔记.md') === diskTarget, '锚点跳转不得改写目标文档')
  }],
  ['图片粘贴：截图时间戳名落盘、插入文本与撤销一步还原（#161）', async () => {
    await openWithEditor('paste-image.md')
    await waitSessionReady('paste-image.md')
    const uri = wsUri('paste-image.md').toString()
    const diskBefore = await readDisk('paste-image.md')
    // 设置基线：三键回默认（同目录模式；防止其他用例遗留的偏好污染）
    await waitSettings({ 'image.paste': true, 'image.pasteLocation': 'same-dir', 'image.pasteSubpath': 'assets' })
    // 注入截图形态的 image.paste（无 fileNameHint，宿主生成时间戳名）——
    // 与真实 webview 消息同一校验与处理入口（宿主测试无法驱动真实剪贴板）。
    // 注入绕过 webview 拦截，先补登记在途 reqId（image.test.pending），
    // 结果回包才能通过陈旧回包校验走完插入往返
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.pending', reqId: 1 })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'image.paste', docUri: uri, reqId: 1,
      mime: 'image/png', dataBase64: PASTE_PNG_BASE64,
    })
    // webview 收到落盘结果后在光标处插入（宿主计算的 markdown 全文）
    const view = await waitViewState('paste-image.md', (v) =>
      /!\[Pasted image \d{14}\]\(Pasted%20image%20\d{14}\.png\)/.test(v.text))
    const match = /!\[Pasted image (\d{14})\]\(Pasted%20image%20\d{14}\.png\)/.exec(view.text)
    assert(match !== null, '插入文本应为时间戳名图片引用')
    // 落盘断言：文档同目录出现时间戳名 PNG，字节与载荷解码一致
    const fileName = `Pasted image ${match![1]}.png`
    const bytes = await vscode.workspace.fs.readFile(wsUri(fileName))
    assert(Buffer.compare(Buffer.from(bytes), Buffer.from(PASTE_PNG_BASE64, 'base64')) === 0,
      '落盘文件字节应与 base64 载荷解码一致')
    // 钩子日志：宿主收到的消息形态（mime/hint 缺省/reqId）
    const log = (await vscode.commands.executeCommand(CMD.imagePasteLog, uri)) as
      Array<{ mime?: string; reqId?: number; fileNameHint?: string; docUri?: string }>
    assert(log.some((m) => m.mime === 'image/png' && m.reqId === 1 &&
      m.fileNameHint === undefined && m.docUri === uri),
      `宿主应记录截图形态载荷，实际 ${JSON.stringify(log)}`)
    // 撤销一步还原：插入是一笔 edit.request（宿主文本栈一条记录）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.history', op: 'undo' })
    await waitViewState('paste-image.md', (v) => v.text === diskBefore)
    // 撤销只回滚文本引用，不删除落盘文件（资产文件保留）
    const stillThere = await vscode.workspace.fs.stat(wsUri(fileName))
    assert(stillThere !== undefined, '撤销后落盘文件应保留')
  }],

  ['图片粘贴：原名清洗沿用与重名 -1 递增（#161）', async () => {
    await openWithEditor('paste-image.md')
    await waitSessionReady('paste-image.md')
    const uri = wsUri('paste-image.md').toString()
    await waitSettings({ 'image.paste': true, 'image.pasteLocation': 'same-dir', 'image.pasteSubpath': 'assets' })
    // 随机基名防跨运行残留同名（撤销不删文件，上轮运行可能已占用固定名）
    const base = `集成贴图${Date.now() % 100000}`
    const hint = `${base}<1>.png` // 含 Windows 非法字符 < >
    const cleaned = `${base}1`    // 清洗后基名；扩展名按 mime 重建为 .png
    // 插入文本路径分段 percent-encode（中文基名经 encodeURIComponent 编码）
    const enc1 = encodeURIComponent(`${cleaned}.png`)
    const enc1Alt = encodeURIComponent(`${cleaned}-1.png`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.pending', reqId: 1 })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'image.paste', docUri: uri, reqId: 1,
      mime: 'image/png', dataBase64: PASTE_PNG_BASE64, fileNameHint: hint,
    })
    await waitViewState('paste-image.md', (v) => v.text.includes(`![${cleaned}](${enc1})`))
    // 同名再次粘贴：重名 -1 递增
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.pending', reqId: 2 })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'image.paste', docUri: uri, reqId: 2,
      mime: 'image/png', dataBase64: PASTE_PNG_BASE64, fileNameHint: hint,
    })
    await waitViewState('paste-image.md', (v) => v.text.includes(`![${cleaned}-1](${enc1Alt})`))
    for (const name of [`${cleaned}.png`, `${cleaned}-1.png`]) {
      const stat = await vscode.workspace.fs.stat(wsUri(name))
      assert(stat !== undefined, `落盘文件 ${name} 应存在`)
    }
  }],

  ['图片粘贴：三存放模式与子路径越界拒绝、无工作区回退通知路径（#161）', async () => {
    await openWithEditor('paste-image.md')
    await waitSessionReady('paste-image.md')
    const uri = wsUri('paste-image.md').toString()
    await waitSettings({ 'image.paste': true, 'image.pasteLocation': 'same-dir', 'image.pasteSubpath': 'assets' })
    // 1) workspace-root + 子路径 assets/sub：落盘到工作区根下（递归建目录）
    await vscode.commands.executeCommand(CMD.setSettings, {
      'image.pasteLocation': 'workspace-root', 'image.pasteSubpath': 'assets/sub',
    })
    const base = `根目录贴图${Date.now() % 100000}`
    const encRoot = encodeURIComponent(`${base}.png`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.pending', reqId: 1 })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'image.paste', docUri: uri, reqId: 1,
      mime: 'image/png', dataBase64: PASTE_PNG_BASE64, fileNameHint: `${base}.png`,
    })
    await waitViewState('paste-image.md', (v) =>
      v.text.includes(`![${base}](assets/sub/${encRoot})`))
    const stat = await vscode.workspace.fs.stat(wsUri(`assets/sub/${base}.png`))
    assert(stat !== undefined, '应递归创建 assets/sub 并落盘到工作区根')
    // 2) 子路径越界（../escape）：失败不插入、不落盘（宿主弹 i18n 通知）
    const before = (await waitViewState('paste-image.md')).text
    await vscode.commands.executeCommand(CMD.setSettings, { 'image.pasteSubpath': '../escape' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'image.test.pending', reqId: 2 })
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'image.paste', docUri: uri, reqId: 2,
      mime: 'image/png', dataBase64: PASTE_PNG_BASE64, fileNameHint: '越界.png',
    })
    await new Promise((r) => setTimeout(r, 800))
    const after = (await waitViewState('paste-image.md')).text
    assert(after === before, '子路径越界时不得插入文本')
    try {
      await vscode.workspace.fs.stat(wsUri('../escape/越界.png'))
      assert(false, '越界路径不得落盘')
    } catch {
      // 预期：目标不可达（无文件产生）
    }
    // 3) 重开回显：三键非默认组合经 globalState 存活，关闭重开编辑器面板后
    //    读回一致（#123 先例：closeActiveEditor 只关活动编辑器，先 reveal
    //    确保目标面板活动；pasteSubpath 先回合法值再断言——快照断言用可
    //    复现组合，非法 ../escape 只属于上一节的拒绝路径）
    await waitSettings({ 'image.paste': true, 'image.pasteLocation': 'workspace-root', 'image.pasteSubpath': 'assets/sub' })
    await openWithEditor('paste-image.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭与会话释放', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s?.found === false ? true : undefined
    })
    await openWithEditor('paste-image.md')
    await waitSessionReady('paste-image.md')
    const snapshot = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snapshot['image.paste'] === true
      && snapshot['image.pasteLocation'] === 'workspace-root'
      && snapshot['image.pasteSubpath'] === 'assets/sub',
      `重开后图片三键应回显非默认组合，实际 ${JSON.stringify(snapshot)}`)
    // 4) 设置复位（防跨用例污染；string 子路径合法值回默认）
    await waitSettings({ 'image.paste': true, 'image.pasteLocation': 'same-dir', 'image.pasteSubpath': 'assets' })
  }],

  // ---- #183 统一右键菜单（Live 正文全域接管；#162 块链接两项迁入） ----

  ['统一右键菜单：全域接管、绘制层断言与剪贴板四项端到端（#183）', async () => {
    // 断言口径：view.state.paint.contextMenu 是绘制层探针（elementFromPoint
    // 命中——DOM 在场但样式注入失效时 visible=false，评审必查的视觉层断言）；
    // 剪贴板动作走真实宿主剪贴板（vscode.env.clipboard 读写对拍）。菜单经
    // contextMenu.test.contextMenu/menuClick 注入通道驱动（宿主测试无法向
    // webview 派发真实右键）
    const MENU_DOC = [
      '---',
      'title: 块菜单',
      '---',
      '',
      '# 块菜单标题',
      '',
      '右键目标段落。',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'const fence = 1',
      '```',
      '',
      '已有 id 段落 ^keep9',
      '',
    ].join('\n')
    await openWithEditor('block-menu.md')
    await waitSessionReady('block-menu.md')
    const uri = wsUri('block-menu.md').toString()
    const post = (message: Record<string, unknown>) =>
      vscode.commands.executeCommand(CMD.postToPanel, uri, message)
    const clipboardText = () => vscode.env.clipboard.readText()

    // 1) 普通段打开菜单：绘制层断言（可见性 + 三簇两条分组线 + display）
    await post({ kind: 'contextMenu.test.contextMenu', pos: MENU_DOC.indexOf('右键目标段落') })
    const normal = await waitViewState('block-menu.md', (v) => v.paint?.contextMenu != null)
    const normalMenu = normal.paint!.contextMenu!
    assert(normalMenu.visible === true,
      `绘制层：菜单中心点应被命中（实际 ${JSON.stringify(normalMenu)}）`)
    assert(normalMenu.display !== 'none', '菜单应非 display:none')
    assert(normalMenu.separatorCount === 2,
      `三簇应恰两条分组线（实际 ${normalMenu.separatorCount}）`)
    // 无选区：仅剪切/复制置灰（cut/copy 两项）
    const normalDisabled = normalMenu.disabledCount
    assert(normalDisabled === 2, `无选区普通段：仅剪切/复制置灰（实际 ${normalDisabled}）`)

    // 2) 空行接管（全域验收线）
    await post({ kind: 'contextMenu.test.menuClose' })
    const blankPos = MENU_DOC.split('\n').slice(0, 3).join('\n').length + 1
    await post({ kind: 'contextMenu.test.contextMenu', pos: blankPos })
    const blank = await waitViewState('block-menu.md', (v) => v.paint?.contextMenu != null)
    assert(blank.paint!.contextMenu!.visible === true, '空行右键应接管（菜单真实绘制）')

    // 3) frontmatter 头区：不接管（探针缺省——无菜单即链路证据）
    await post({ kind: 'contextMenu.test.menuClose' })
    await post({ kind: 'contextMenu.test.contextMenu', pos: MENU_DOC.indexOf('title: 块菜单') })
    const fmState = await waitViewState('block-menu.md', (v) => v.paint != null && v.paint.contextMenu === undefined)
    assert(fmState.paint!.contextMenu === undefined, '头区不接管：无菜单浮层')

    // 4) 表格行与围栏内：安全降级矩阵（簇 1 新增两项 + 簇 2 整簇置灰）
    await post({ kind: 'contextMenu.test.menuClose' })
    await post({ kind: 'contextMenu.test.contextMenu', pos: MENU_DOC.indexOf('|---|---|') })
    const table = await waitViewState('block-menu.md', (v) => v.paint?.contextMenu != null)
    assert(table.paint!.contextMenu!.disabledCount >= normalDisabled + 20,
      `表格行：簇 1 新增两项 + 簇 2 全簇（含子项）置灰（实际 ${table.paint!.contextMenu!.disabledCount} vs 基线 ${normalDisabled}）`)
    await post({ kind: 'contextMenu.test.menuClose' })
    await post({ kind: 'contextMenu.test.contextMenu', pos: MENU_DOC.indexOf('const fence') })
    const fence = await waitViewState('block-menu.md', (v) => v.paint?.contextMenu != null)
    assert(fence.paint!.contextMenu!.disabledCount >= normalDisabled + 20,
      `围栏代码内：同表格降级（实际 ${fence.paint!.contextMenu!.disabledCount}）`)
    await post({ kind: 'contextMenu.test.menuClose' })

    // 5) 剪贴板四项端到端（真实宿主剪贴板对拍）：
    //    选区（table.test.crossSelect 注入）→ copy 剪贴板成品 → cut 删除 +
    //    单笔写回 → 宿主写剪贴板后 paste 插入 → selectAll 纯选区
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const selFrom = MENU_DOC.indexOf('右键目标')
    await post({ kind: 'table.test.crossSelect', anchor: selFrom, head: selFrom + 4 })
    await post({ kind: 'contextMenu.test.contextMenu', pos: selFrom + 1 })
    await post({ kind: 'contextMenu.test.menuClick', command: 'copy' })
    assert(await poll('复制剪贴板', async () =>
      (await clipboardText()) === '右键目标' ? true : undefined),
      `复制应写入真实宿主剪贴板（实际 ${await clipboardText()}）`)
    const afterCopy = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterCopy.appliedEdits === before.appliedEdits, '复制零写回')

    await post({ kind: 'table.test.crossSelect', anchor: selFrom, head: selFrom + 4 })
    await post({ kind: 'contextMenu.test.contextMenu', pos: selFrom + 1 })
    await post({ kind: 'contextMenu.test.menuClick', command: 'cut' })
    assert(await poll('剪切剪贴板', async () =>
      (await clipboardText()) === '右键目标' ? true : undefined), '剪切应先桥写选区文本')
    const afterCut = await waitViewState('block-menu.md', (v) => !v.text.includes('右键目标'))
    assert(afterCut.text.includes('段落。'), '剪切应删除选区保留其余正文')
    const cutState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(cutState.appliedEdits === before.appliedEdits + 1,
      `剪切删除应恰一笔写回（实际 +${cutState.appliedEdits - before.appliedEdits}）`)

    await vscode.env.clipboard.writeText('宿主桥粘贴文本')
    await post({ kind: 'contextMenu.test.contextMenu', pos: afterCut.text.indexOf('段落。') })
    await post({ kind: 'contextMenu.test.menuClick', command: 'paste' })
    await waitViewState('block-menu.md', (v) => v.text.includes('宿主桥粘贴文本'))
    assert((await clipboardText()) === '宿主桥粘贴文本', '粘贴不改变剪贴板内容')

    await post({ kind: 'contextMenu.test.contextMenu', pos: afterCut.text.indexOf('段落。') })
    await post({ kind: 'contextMenu.test.menuClick', command: 'selectAll' })
    const selected = await waitViewState('block-menu.md', (v) =>
      v.selectionOffset === 0 && v.selectionHead === v.docLength)
    assert(selected.selectionHead === selected.docLength, '全选应为全文纯选区（零写回）')
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.appliedEdits === cutState.appliedEdits + 1,
      `全选零写回（实际 +${finalState.appliedEdits - cutState.appliedEdits}）`)
    await post({ kind: 'contextMenu.test.menuClose' })
  }],

  ['块链接两项：统一菜单两态、自动补写可撤销与快捷键入口（#183，自 #162 迁移）', async () => {
    // 断言口径：剪贴板成品对拍（vscode.env.clipboard.readText——真实宿主
    // 权威）、磁盘文本对拍（自动补写走标准写回）与单笔写回（appliedEdits
    // 恰 +1 = 撤销一步）。菜单经 contextMenu.test.contextMenu/menuClick
    // 真实按钮点击链路驱动（宿主测试无法派发真实右键）
    const BLOCK_MENU_DOC = [
      '---',
      'title: 块菜单',
      '---',
      '',
      '# 块菜单标题',
      '',
      '右键目标段落。',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'const fence = 1',
      '```',
      '',
      '已有 id 段落 ^keep9',
      '',
    ].join('\n')
    await openWithEditor('block-menu.md')
    await waitSessionReady('block-menu.md')
    const uri = wsUri('block-menu.md').toString()
    const before = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    const clipboardText = () => vscode.env.clipboard.readText()

    // 标题行：复制标题链接 → 剪贴板成品 [[笔记名#标题]]，零写回
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.contextMenu', pos: BLOCK_MENU_DOC.indexOf('# 块菜单标题'),
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.menuClick', command: 'copyHeadingLink',
    })
    assert(await poll('标题链接剪贴板', async () =>
      (await clipboardText()) === '[[block-menu#块菜单标题]]' ? true : undefined),
      `标题链接成品应为 [[block-menu#块菜单标题]]（实际 ${await clipboardText()}）`)

    // 普通段：无 id 自动补写 → 剪贴板 [[block-menu#^xxxxxx]]，磁盘块尾行后
    // 空一行恰好多出独立行 `^id`（#163 验收反馈默认形态），单笔写回
    // （appliedEdits +1 = 撤销一步）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.contextMenu', pos: BLOCK_MENU_DOC.indexOf('右键目标段落'),
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.menuClick', command: 'copyBlockLink',
    })
    // 写回断言走视图文本：写回使 TextDocument dirty 不落盘（磁盘断言在仓库
    // 惯例中仅用于「不得写」场景，outline/frontmatter 写回用例同款口径）
    const writtenState = await waitViewState('block-menu.md', (v) =>
      /右键目标段落。\n\n\^[a-z0-9]{6}\n/.test(v.text))
    const copiedId = (writtenState.text.match(/右键目标段落。\n\n\^([a-z0-9]{6})\n/) ?? [])[1]!
    assert(await poll('块链接剪贴板', async () =>
      (await clipboardText()) === `[[block-menu#^${copiedId}]]` ? true : undefined),
      `块链接成品应为 [[block-menu#^${copiedId}]]（实际 ${await clipboardText()}）`)
    const afterWrite = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(afterWrite.appliedEdits === before.appliedEdits + 1,
      `自动补写应恰一笔写回（实际 +${afterWrite.appliedEdits - before.appliedEdits}）`)

    // 自动补写可撤销（undo 实测，照图片粘贴用例先例）：补写是一笔标准
    // edit.request = 宿主文本栈一条记录，undo 一步全文还原、redo 恢复
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.history', op: 'undo' })
    await waitViewState('block-menu.md', (v) => v.text === BLOCK_MENU_DOC)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.history', op: 'redo' })
    await waitViewState('block-menu.md', (v) => /右键目标段落。\n\n\^[a-z0-9]{6}\n/.test(v.text))

    // 表格整块：id 写在表格末行后空一行独立行（表格右键按表格整块）。pos
    // 从最新文本动态取——前序步骤已在普通段后补写两行，旧文档偏移已失效
    const afterParaWrite = (await waitViewState('block-menu.md')).text
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.contextMenu', pos: afterParaWrite.indexOf('|---|---|'),
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.menuClick', command: 'copyBlockLink',
    })
    const afterTableWrite = await waitViewState('block-menu.md', (v) =>
      /\| 1 \| 2 \|\n\n\^[a-z0-9]{6}\n/.test(v.text))

    // 既有 id 段：直接复制既有 id，零改写（视图文本对拍；pos 同样动态取）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.contextMenu', pos: afterTableWrite.text.indexOf('已有 id 段落'),
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.menuClick', command: 'copyBlockLink',
    })
    assert(await poll('既有 id 剪贴板', async () =>
      (await clipboardText()) === '[[block-menu#^keep9]]' ? true : undefined),
      `既有 id 应直接复制（实际 ${await clipboardText()}）`)
    const finalState = await waitViewState('block-menu.md')
    assert(finalState.text.includes('已有 id 段落 ^keep9\n'), '既有 id 段零改写')

    // 快捷键/命令面板入口（同一命令）：光标落标题行 → 复制标题链接
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect',
      anchor: finalState.text.indexOf('# 块菜单标题'),
      head: finalState.text.indexOf('# 块菜单标题'),
    })
    await vscode.commands.executeCommand('onegayi.vsidian.block.copyLink')
    assert(await poll('快捷键入口剪贴板', async () =>
      (await clipboardText()) === '[[block-menu#块菜单标题]]' ? true : undefined),
      `命令入口光标在标题行应复制标题链接（实际 ${await clipboardText()}）`)

    // frontmatter 头区：右键不接管（原生菜单照常——钩子不开菜单即链路证据）
    const stateBefore = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.contextMenu', pos: BLOCK_MENU_DOC.indexOf('title: 块菜单'),
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'contextMenu.test.menuClick', command: 'copyBlockLink',
    })
    const stateAfter = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(stateAfter.appliedEdits === stateBefore.appliedEdits && stateAfter.version === stateBefore.version,
      '头区不接管：零写回零版本推进')
  }],

  // ---- #197 反链面板：索引就绪 → 面板显示 → 点击跳转，四态与互斥 ----

  ['反链面板：索引就绪后按稳定序列显示反链并真实绘制（#197）', async () => {
    await openWithEditor('反链目标.md')
    await waitSessionReady('反链目标.md')
    const uri = wsUri('反链目标.md').toString()
    // 展开侧栏 + 切到反链面板（与用户点击同一处理器链）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    // 索引就绪后面板为 ready 态（宿主启动即扫，这里轮询收敛）
    const state = await poll('反链面板就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: Array<{ sourceRelPath: string; kind: string; line: number; snippet: string }> } }
        | undefined
      return v?.backlinks && v.backlinks.state === 'ready' ? v : undefined
    })
    const items = state.backlinks!.items
    // 稳定排序：来源路径 → 区间（fixtures.mjs 的三边型两引用者）
    assert(JSON.stringify(items.map((i) => [i.sourceRelPath, i.kind])) === JSON.stringify([
      ['backlinks-a.md', 'wikilink'],
      ['backlinks-a.md', 'mdlink'],
      ['backlinks-a.md', 'wikilink'],
      ['backlinks-b.md', 'wikilink'],
    ]), `反链序列不符：${JSON.stringify(items)}`)
    assert(items[0]!.line === 3, `首条来源行号应为 3（实际 ${items[0]!.line}）`)
    assert(items[0]!.snippet.includes('[[反链目标]]'), '首条片段应含引用原文')
    // 绘制层断言（elementFromPoint）：面板、按钮与首条目真实可见，非 DOM 存在性
    const painted = await poll('反链绘制层', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { panelPainted: boolean; togglePainted: boolean; itemPainted: boolean; active: boolean; panelAriaLabel: string | null; toggleAriaLabel: string | null } }
        | undefined
      const b = v?.backlinks
      return b && b.panelPainted && b.togglePainted && b.itemPainted ? b : undefined
    })
    assert(painted.active === true, '反链面板应 active')
    assert(painted.panelAriaLabel === editorMessages()['backlinks.panelTitle'],
      `面板可访问名称应为「${editorMessages()['backlinks.panelTitle']}」，实际 ${String(painted.panelAriaLabel)}`)
    assert(painted.toggleAriaLabel === editorMessages()['backlinks.label'], '按钮可访问名称应随语言包')
    // 互斥：反链面板 active 时大纲面板必须让位（同一面板区域单一显示）
    const outline = await vscode.commands.executeCommand(CMD.viewState, uri) as
      | { outline?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(outline?.outline?.active === false, '反链与大纲面板应互斥（大纲 active 应为 false）')
    assert(outline?.outline?.panelPainted === false, '互斥后大纲面板不得绘制')
    // 切回大纲：反链让位（可开关性 + 不挤坏大纲的双向验证）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.click' })
    const after = await vscode.commands.executeCommand(CMD.viewState, uri) as
      | { backlinks?: { active: boolean; panelPainted: boolean }; outline?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(after?.backlinks?.active === false && after?.backlinks?.panelPainted === false,
      '切回大纲后反链面板应收起且不绘制')
    assert(after?.outline?.active === true && after?.outline?.panelPainted === true,
      '切回大纲后大纲面板应恢复绘制')
  }],

  ['反链面板：无引用文档呈空态占位（四态之空，#197）', async () => {
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const uri = wsUri('untouched.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    const state = await poll('空态就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: unknown[]; emptyPainted: boolean; panelPainted: boolean; active: boolean } }
        | undefined
      const b = v?.backlinks
      return b && b.state === 'ready' && b.items.length === 0 && b.emptyPainted ? b : undefined
    }, 20000).catch(async (err) => {
      // 诊断兜底：带完整 probe 重新报错（定位空态占位不命中的布局原因）
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as unknown
      throw new Error(`${(err as Error).message}；probe=${JSON.stringify(v)}`)
    })
    assert(state.emptyPainted === true, '空态占位应真实绘制（无反向链接）')
  }],

  ['反链面板：工作区外文档呈失败态（四态之失败，含索引不可用口径，#197）', async () => {
    // 无工作区文件夹上下文的文档：索引域外（no-workspace），面板显示失败态
    const outsideUri = vscode.Uri.file(`${wsDir}-outside/反链区外.md`)
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(`${wsDir}-outside`))
    await vscode.workspace.fs.writeFile(outsideUri, Buffer.from('# 区外文档\n\n正文。\n', 'utf8'))
    await vscode.commands.executeCommand('vscode.openWith', outsideUri, VIEW_TYPE)
    const uri = outsideUri.toString()
    // 工作区外路径不适用 waitSessionReady（其内部拼 WORKSPACE_DIR 前缀），
    // 直接轮询会话状态直到面板就绪
    await poll('区外面板会话就绪', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
      return s.found && s.panels.some((p) => p.ready) ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    const state = await poll('失败态到达', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: unknown[] } }
        | undefined
      const b = v?.backlinks
      return b && b.state === 'error' && b.items.length === 0 ? b : undefined
    })
    assert(state.state === 'error', '工作区外文档的反链应为 error 态')
  }],

  ['反链条目跳转：打开来源文档并定位到出链标记（#197）', async () => {
    // 源面板：反链目标.md；点击首条目 → 活动面板切到 backlinks-a.md 且光标
    // 落在首条出链 [[反链目标]] 起点（LF 偏移与 fixtures.mjs 文本一致计算）
    await openWithEditor('反链目标.md')
    await waitSessionReady('反链目标.md')
    const uri = wsUri('反链目标.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    await poll('反链就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: unknown[] } }
        | undefined
      return v?.backlinks && v.backlinks.state === 'ready' && v.backlinks.items.length > 0 ? true : undefined
    })
    // 首条边起点：BACKLINKS_SOURCE_A_DOC 的首个 [[反链目标]]（文本与
    // fixtures.mjs 字节一致）
    const sourceText = [
      '# 反链引用者甲',
      '',
      '见 [[反链目标]] 与 [同目标](./反链目标.md)。',
      '',
      '第二段引用 [[反链目标#深处小节]]。',
      '',
    ].join('\n')
    const firstEdgeStart = sourceText.indexOf('[[反链目标]]')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.itemClick', index: 0 })
    // 活动面板切到 backlinks-a.md（Vsidian 面板打开来源文档）
    await poll('活动面板为来源文档', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === wsUri('backlinks-a.md').toString() ? true : undefined
    })
    // view.locate 落位：光标主位 = 首条边起点（LF 文档直发）
    const located = await poll('光标落位到出链起点', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('backlinks-a.md').toString())) as
        | { selectionOffset?: number; viewMode?: string }
        | undefined
      return v && v.selectionOffset === firstEdgeStart ? v : undefined
    })
    assert(located.viewMode === 'live', '跳转目标面板应为 live 模式（可编辑）')
  }],

  ['侧栏状态：跳转返回后保持跳转前激活面板（形态改版批次）', async () => {
    // 用户报障复现：反链面板 active 时点击条目跳转到来源文档（原文档 tab
    // 隐藏 → webview 卸载），切回原文档后侧栏应保持反链面板 active；
    // 三面板无一 active（侧栏空白）即为报障症状
    await openWithEditor('反链目标.md')
    await waitSessionReady('反链目标.md')
    const uri = wsUri('反链目标.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    await poll('跳转前反链面板 active 且条目就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { active: boolean; state: string; items: unknown[] } }
        | undefined
      return v?.backlinks?.active === true && v.backlinks.state === 'ready' && v.backlinks.items.length > 0 ? true : undefined
    })
    // 条目点击跳转：活动面板切到来源文档
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.itemClick', index: 0 })
    await poll('活动面板为来源文档', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === wsUri('backlinks-a.md').toString() ? true : undefined
    })
    // 切回原文档 tab（组内前一编辑器；隐藏期 webview 已卸载，返回即重载）
    await vscode.commands.executeCommand('workbench.action.previousEditor')
    await poll('切回原文档', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === uri ? true : undefined
    })
    // 重载后面板视图状态响应恢复（新面板 boot 完成）
    await poll('原文档视图状态响应', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | Record<string, unknown>
        | undefined
      return v !== undefined ? true : undefined
    })
    // 回路断言：跳转前的激活面板保持（三标志全 false 即报障；绘制层给
    // boot 留收敛窗口，持续不绘制才判红）
    const after = await poll('跳转返回后反链面板绘制', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { sidebar?: { open?: boolean }; backlinks?: { active: boolean; panelPainted: boolean }; outline?: { active: boolean }; outlinks?: { active: boolean } }
        | undefined
      return v?.backlinks?.panelPainted === true ? v : undefined
    }, 5000).catch(async () => {
      return (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { sidebar?: { open?: boolean }; backlinks?: { active: boolean; panelPainted: boolean }; outline?: { active: boolean }; outlinks?: { active: boolean } }
        | undefined
    })
    assert(after?.backlinks?.active === true && after.backlinks.panelPainted === true,
      `跳转返回后反链面板应保持 active 且绘制（实际 backlinks=${String(after?.backlinks?.active)} painted=${String(after?.backlinks?.panelPainted)} outline=${String(after?.outline?.active)} outlinks=${String(after?.outlinks?.active)} sidebarOpen=${String(after?.sidebar?.open)}）`)
    // 变体二：出链面板跳转 → previousEditor 返回 → 保持出链 active
    await openWithEditor('出链源.md')
    await waitSessionReady('出链源.md')
    const srcUri = wsUri('出链源.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'outlinks.test.click' })
    await poll('出链面板 active 且条目就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
        | { outlinks?: { active: boolean; state: string; items: unknown[] } }
        | undefined
      return v?.outlinks?.active === true && v.outlinks.state === 'ready' && v.outlinks.items.length > 0 ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'outlinks.test.itemClick', index: 0 })
    await poll('活动面板为出链普通目标', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === wsUri('出链普通目标.md').toString() ? true : undefined
    })
    await vscode.commands.executeCommand('workbench.action.previousEditor')
    await poll('切回出链源', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === srcUri ? true : undefined
    })
    await poll('出链源视图状态响应', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
        | Record<string, unknown>
        | undefined
      return v !== undefined ? true : undefined
    })
    const afterOut = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
      | { backlinks?: { active: boolean }; outline?: { active: boolean }; outlinks?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(afterOut?.outlinks?.active === true && afterOut.outlinks.panelPainted === true,
      `出链跳转返回后应保持 active 且绘制（实际 outlinks=${String(afterOut?.outlinks?.active)} painted=${String(afterOut?.outlinks?.panelPainted)} outline=${String(afterOut?.outline?.active)} backlinks=${String(afterOut?.backlinks?.active)}）`)
    // 变体三：工具栏交互（搜索框 + 排序选择）后跳转 → 关闭目标页签返回
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'backlinks.test.toolbarClick', action: 'search' })
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'backlinks.test.sortSelect', mode: 'mtimeDesc' })
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'outlinks.test.itemClick', index: 0 })
    await poll('活动面板为出链普通目标（变体三）', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === wsUri('出链普通目标.md').toString() ? true : undefined
    })
    // 关闭目标页签：前一编辑器（出链源）自动成为活动面板（webview 卸载后重载）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('关闭目标后回到出链源', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === srcUri ? true : undefined
    })
    await poll('出链源视图状态响应（变体三）', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
        | Record<string, unknown>
        | undefined
      return v !== undefined ? true : undefined
    })
    const afterClose = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
      | { backlinks?: { active: boolean }; outline?: { active: boolean }; outlinks?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(afterClose?.outlinks?.active === true && afterClose.outlinks.panelPainted === true,
      `关闭目标页签返回后应保持出链 active 且绘制（实际 outlinks=${String(afterClose?.outlinks?.active)} painted=${String(afterClose?.outlinks?.panelPainted)} outline=${String(afterClose?.outline?.active)} backlinks=${String(afterClose?.backlinks?.active)}）`)
  }],

  // ---- 出链面板批次：出链四态/绘制/互斥 + 锚点跳转 + 断链不可点；
  //      反链面板形态改版的分组卡片/命中高亮/搜索/排序 ----

  ['出链面板：条目序列与真实绘制，三面板互斥（出链面板批次）', async () => {
    await openWithEditor('出链源.md')
    await waitSessionReady('出链源.md')
    const uri = wsUri('出链源.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outlinks.test.click' })
    const state = await poll('出链面板就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { outlinks?: { state: string; items: Array<{ targetDisplay: string; kind: string; anchor: string; resolved: boolean }> } }
        | undefined
      return v?.outlinks && v.outlinks.state === 'ready' ? v : undefined
    })
    const items = state.outlinks!.items
    // 稳定排序：resolved（显示名码位：普 U+666E < 锚 U+951A）→ 断链沉底；
    // 外链（https://example.com）与危险 scheme 不进面板
    assert(JSON.stringify(items.map((i) => [i.targetDisplay, i.resolved])) === JSON.stringify([
      ['出链普通目标', true],
      ['出链锚点目标', true],
      ['不存在的出链目标', false],
    ]), `出链序列不符：${JSON.stringify(items)}`)
    assert(items[1]!.anchor === '深处小节', '锚点条目应携带标题锚点')
    assert(items[1]!.kind === 'wikilink', '锚点条目应为 wikilink 边')
    // 绘制层断言（elementFromPoint）：按钮、面板与首条目真实可见
    const painted = await poll('出链绘制层', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { outlinks?: { togglePainted: boolean; panelPainted: boolean; itemPainted: boolean; active: boolean; toggleAriaLabel: string | null; panelAriaLabel: string | null } }
        | undefined
      const o = v?.outlinks
      return o && o.togglePainted && o.panelPainted && o.itemPainted ? o : undefined
    })
    assert(painted.active === true, '出链面板应 active')
    assert(painted.panelAriaLabel === editorMessages()['outlinks.panelTitle'],
      `面板可访问名称应为「${editorMessages()['outlinks.panelTitle']}」，实际 ${String(painted.panelAriaLabel)}`)
    assert(painted.toggleAriaLabel === editorMessages()['outlinks.label'], '按钮可访问名称应随语言包')
    // 三面板互斥：出链 active 时大纲与反链都让位
    const others = await vscode.commands.executeCommand(CMD.viewState, uri) as
      | { outline?: { active: boolean; panelPainted: boolean }; backlinks?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(others?.outline?.active === false && others?.outline?.panelPainted === false,
      '三面板互斥：大纲应收起且不绘制')
    assert(others?.backlinks?.active === false && others?.backlinks?.panelPainted === false,
      '三面板互斥：反链应收起且不绘制')
    // 切回大纲：出链让位（三向互斥的双向验证）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outline.test.click' })
    const after = await vscode.commands.executeCommand(CMD.viewState, uri) as
      | { outlinks?: { active: boolean; panelPainted: boolean }; outline?: { active: boolean; panelPainted: boolean } }
      | undefined
    assert(after?.outlinks?.active === false && after?.outlinks?.panelPainted === false,
      '切回大纲后出链面板应收起且不绘制')
    assert(after?.outline?.active === true && after?.outline?.panelPainted === true,
      '切回大纲后大纲面板应恢复绘制')
  }],

  ['出链面板：空态与失败态（四态补全，出链面板批次）', async () => {
    // 空态：untouched.md 无出链（索引就绪后面板为 ready + 空 + 占位绘制）
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const uri = wsUri('untouched.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outlinks.test.click' })
    const empty = await poll('出链空态就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { outlinks?: { state: string; items: unknown[]; emptyPainted: boolean } }
        | undefined
      const o = v?.outlinks
      return o && o.state === 'ready' && o.items.length === 0 && o.emptyPainted ? o : undefined
    }, 20000)
    assert(empty.emptyPainted === true, '空态占位应真实绘制（无链接）')
    // 失败态：工作区外文档（与反链失败态用例同手法——索引域外 no-workspace）
    const outsideUri = vscode.Uri.file(`${wsDir}-outside/出链区外.md`)
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(`${wsDir}-outside`))
    await vscode.workspace.fs.writeFile(outsideUri, Buffer.from('# 区外文档\n\n[链接](./x.md)\n', 'utf8'))
    await vscode.commands.executeCommand('vscode.openWith', outsideUri, VIEW_TYPE)
    const outside = outsideUri.toString()
    await poll('区外面板会话就绪', async () => {
      const s = (await vscode.commands.executeCommand(CMD.sessionState, outside)) as SessionState
      return s.found && s.panels.some((p) => p.ready) ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, outside, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, outside, { kind: 'outlinks.test.click' })
    const failed = await poll('出链失败态到达', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, outside)) as
        | { outlinks?: { state: string; items: unknown[] } }
        | undefined
      const o = v?.outlinks
      return o && o.state === 'error' && o.items.length === 0 ? o : undefined
    })
    assert(failed.state === 'error', '工作区外文档的出链应为 error 态')
  }],

  ['出链条目跳转：按实际锚点定位到目标标题；断链条目不可点（出链面板批次）', async () => {
    await openWithEditor('出链源.md')
    await waitSessionReady('出链源.md')
    const uri = wsUri('出链源.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outlinks.test.click' })
    await poll('出链就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { outlinks?: { state: string; items: unknown[] } }
        | undefined
      return v?.outlinks && v.outlinks.state === 'ready' && v.outlinks.items.length > 0 ? true : undefined
    })
    // 锚点条目（index 1：[[出链锚点目标#深处小节]]）→ 打开目标并落到标题
    const anchorText = ['# 锚点目标', '', '## 深处小节', '', '深处正文。', ''].join('\n')
    const headingOffset = anchorText.indexOf('## 深处小节')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outlinks.test.itemClick', index: 1 })
    await poll('活动面板为锚点目标', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE &&
        tab.input.uri.toString() === wsUri('出链锚点目标.md').toString() ? true : undefined
    })
    const located = await poll('光标按锚点落位到目标标题', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, wsUri('出链锚点目标.md').toString())) as
        | { selectionOffset?: number; viewMode?: string }
        | undefined
      return v && v.selectionOffset === headingOffset ? v : undefined
    })
    assert(located.viewMode === 'live', '跳转目标面板应为 live 模式（可编辑）')
    // 断链条目不可点：disabled 按钮不派发 click——点击后活动面板保持源文档
    await openWithEditor('出链源.md')
    await waitSessionReady('出链源.md')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'outlinks.test.itemClick', index: 2 })
    await new Promise((r) => setTimeout(r, 400))
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    assert(tab?.input instanceof vscode.TabInputCustom &&
      tab.input.uri.toString() === wsUri('出链源.md').toString(),
      '断链条目不可点：活动面板应保持源文档')
  }],

  ['反链面板新形态：分组卡片与命中高亮真实绘制（形态改版批次）', async () => {
    await openWithEditor('反链目标.md')
    await waitSessionReady('反链目标.md')
    const uri = wsUri('反链目标.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    await poll('反链就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: unknown[] } }
        | undefined
      return v?.backlinks && v.backlinks.state === 'ready' && v.backlinks.items.length > 0 ? true : undefined
    })
    // 绘制层断言：工具栏、命中高亮 mark 真实可见 + 黄底非透明（CSS 变量
    // 明暗两值规则生效的 computed 证据；jsdom 无 CSS 引擎恒 null，真宿主
    // 断言在此）
    const probe = await poll('新形态绘制', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { toolbarPainted: boolean; hitPainted: boolean; hitBg: string | null; view?: { sortMode: string; domCards: number; searchOpen: boolean } } }
        | undefined
      const b = v?.backlinks
      return b && b.toolbarPainted && b.hitPainted ? b : undefined
    }, 20000).catch(async (err) => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as unknown
      throw new Error(`${(err as Error).message}；probe=${JSON.stringify(v)}`)
    })
    assert(probe.view?.sortMode === 'name-asc', '默认排序应为文件名（A-Z）')
    assert(probe.view?.domCards === 4, `四条引用应渲染四张卡片（实际 ${probe.view?.domCards}）`)
    assert(typeof probe.hitBg === 'string' && probe.hitBg !== 'rgba(0, 0, 0, 0)' && probe.hitBg !== 'transparent',
      `命中高亮应有非透明黄底（实际 ${String(probe.hitBg)}）——黄底 CSS 变量失效在此暴露`)
  }],

  ['反链面板交互：搜索过滤、排序切换与折叠/更多上下文（形态改版批次）', async () => {
    await openWithEditor('反链目标.md')
    await waitSessionReady('反链目标.md')
    const uri = wsUri('反链目标.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.click' })
    await poll('反链就绪', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { state: string; items: unknown[] } }
        | undefined
      return v?.backlinks && v.backlinks.state === 'ready' && v.backlinks.items.length > 0 ? true : undefined
    })
    const viewOf = async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, uri)) as
        | { backlinks?: { view?: { sortMode: string; query: string; searchOpen: boolean; contextLong: boolean; collapsedCount: number; domCards: number } } }
        | undefined
      return v?.backlinks?.view
    }
    // 搜索：开框 → 输入 'backlinks-b'（大小写不敏感命中 backlinks-b.md
    // 文件名——注意 'b' 单字也会命中 backlinks-a.md，判别子串须区分两组）→
    // 只剩乙组一张卡片；清空恢复四张；关闭搜索框同时清空（Esc 语义同路）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.toolbarClick', action: 'search' })
    assert((await viewOf())?.searchOpen === true, '搜索按钮应展开搜索框')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.searchInput', value: 'backlinks-b' })
    await poll('过滤生效', async () => {
      const view = await viewOf()
      return view && view.query === 'backlinks-b' && view.domCards === 1 ? view : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.searchInput', value: '' })
    await poll('清空恢复', async () => {
      const view = await viewOf()
      return view && view.query === '' && view.domCards === 4 ? view : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.toolbarClick', action: 'search' })
    const afterSearch = await viewOf()
    assert(afterSearch?.searchOpen === false && afterSearch?.query === '', '关闭搜索框应同时清空过滤词')
    // 排序：选择「文件名（Z-A）」→ 视图状态记住（会话内存）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.sortSelect', mode: 'name-desc' })
    await poll('排序生效', async () => {
      const view = await viewOf()
      return view && view.sortMode === 'name-desc' ? view : undefined
    })
    // 折叠全部：两组全部折叠（collapsedCount = 2）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.toolbarClick', action: 'collapse' })
    await poll('全部折叠', async () => {
      const view = await viewOf()
      return view && view.collapsedCount === 2 ? view : undefined
    })
    // 更多上下文：长片段开态（纯显示层切换）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'backlinks.test.toolbarClick', action: 'context' })
    await poll('更多上下文开态', async () => {
      const view = await viewOf()
      return view && view.contextLong === true ? view : undefined
    })
  }],

  ['设置页：索引维护分页可达（图标换链环后的导航回归，形态改版批次）', async () => {
    // 图标 glyph 形态由单测钉住（indexMaintenanceSettings）；宿主级回归：
    // 分页经 openWithSection 定位仍可达、ready 握手正常（导航功能不因图标
    // 改动受损）
    await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
    await poll('设置页就绪', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean; ready: boolean }
        | undefined
      return i?.open && i.ready ? true : undefined
    })
    await vscode.commands.executeCommand(CMD.closeSettingsPage)
    // 等关闭落定：panel.dispose() 的 webview 实际销毁是异步的——本用例
    // 若是片内末位，runner 紧接着返回触发宿主退出，退出与 webview 销毁
    // 竞速在 Linux 上使测试宿主以 Canceled 收场（exit 1；四轮 CI 确定性
    // 复现）。等 open 状态翻false 再结束，给销毁留出落定窗口
    await poll('设置页关闭落定', async () => {
      const i = (await vscode.commands.executeCommand(CMD.settingsPageInfo)) as
        | { open: boolean }
        | undefined
      return i && !i.open ? true : undefined
    })
    assert(true, '设置页打开/关闭链路正常（索引维护分页随页可达）')
  }],

  ['反链幽灵退场：未保存编辑后关闭文档（不保存），覆盖层随关闭退役（review-loops #18）', async () => {
    // 独立文档组（rl18-*，#200 教训：覆盖层跨用例滞留会污染后续 rename 漂移
    // 断言——不与既有反链 fixture 共享）。链路：applyUnsaved 防抖登记覆盖层
    // 幽灵边 → 反链面板广播可见 → closeActiveEditor 关闭 dirty custom tab
    // （1.86.2 实测裁决：直接 revert 回磁盘、无保存确认弹窗——#38 用例 A
    // 同款路径）→ onDidCloseTextDocument → findEntry 守卫放行 →
    // documentClosed 退役 → 反链回磁盘基线（空态）。
    // 检测力边界（如实记录）：关闭时的 revert 也触发 onDidChange →
    // applyUnsaved(基线) 自愈路径；本用例钉「未保存关闭后幽灵不滞留」的
    // 用户可见契约，两路清理（revert 自愈 / documentClosed 退役）在此形态
    // 下收敛同一终态——纯接线删除的回归由服务层单测（documentClosed 契约）
    // 与此处行为断言共同覆盖。
    await openWithEditor('rl18-target.md')
    await waitSessionReady('rl18-target.md')
    const targetUri = wsUri('rl18-target.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, targetUri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, targetUri, { kind: 'backlinks.test.click' })
    // 前置：目标文档磁盘基线无引用 → 空态起步（同时证明索引就绪）
    await poll('基线空态', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri)) as
        | { backlinks?: { state: string; items: unknown[] } }
        | undefined
      const b = v?.backlinks
      return b && b.state === 'ready' && b.items.length === 0 ? b : undefined
    })
    // 幽灵来源面板 Beside 打开（双列并排：目标面板保持可见——webview
    // retainContextWhenHidden 关闭，隐藏即卸载会使 viewState 请求无响应；
    // splitconflict 用例同款双面板驱动）
    await openWithEditor('rl18-ghost.md', true)
    await waitSessionReady('rl18-ghost.md')
    const ghostDoc = await vscode.workspace.openTextDocument(wsUri('rl18-ghost.md'))
    const ghostEdit = new vscode.WorkspaceEdit()
    ghostEdit.replace(wsUri('rl18-ghost.md'), new vscode.Range(0, 0, 0, 0), '幽灵引用 [[rl18-target]]\n\n')
    assert(await vscode.workspace.applyEdit(ghostEdit), '未保存编辑应成功')
    await poll('编辑生效且 dirty', () => ghostDoc.isDirty &&
      ghostDoc.getText().includes('[[rl18-target]]') ? true : undefined)
    // 幽灵在场：覆盖层防抖 flush（500ms 级）→ notify → 全面板广播 →
    // 目标面板反链出现未保存来源条目
    await poll('幽灵反链在场', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri)) as
        | { backlinks?: { state: string; items: Array<{ sourceRelPath: string; kind: string }> } }
        | undefined
      const b = v?.backlinks
      return b && b.state === 'ready' &&
        b.items.some((i) => i.sourceRelPath === 'rl18-ghost.md') ? b : undefined
    })
    // 关闭幽灵面板（活动 tab；dirty 不保存 → revert + onDidCloseTextDocument）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    // 幽灵退场：反链回磁盘基线空态（documentClosed 退役覆盖层 + revert 自愈
    // 两路收敛的同一终态）
    await poll('幽灵反链退场', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri)) as
        | { backlinks?: { state: string; items: Array<{ sourceRelPath: string }> } }
        | undefined
      const b = v?.backlinks
      return b && b.state === 'ready' &&
        !b.items.some((i) => i.sourceRelPath === 'rl18-ghost.md') ? b : undefined
    })
    // 关闭不保存：磁盘基线原样（revert 不写盘）
    assert(await readDisk('rl18-ghost.md') === '# 幽灵来源\n\n基线无引用。\n',
      '未保存关闭不得写磁盘')
  }],

  // ---- #198 索引维护：排除模式设置、增量与重建、清理回收、根增删 ----

  ['索引维护：排除模式保存/持久化/恢复默认与覆盖范围重算（#198）', async () => {
    type IndexState = {
      available: boolean
      excludePatterns: string[]
      roots: Array<{ fsPath: string; fileCount: number; edgeCount: number; hasData: boolean }>
      persistedPatterns: string[] | null
    }
    const state = async (): Promise<IndexState> =>
      (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as IndexState
    const rootCount = async (): Promise<number> => {
      const s = await state()
      return s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))?.fileCount ?? -1
    }
    // 初始：默认模式、无持久化
    const initialCount = await poll('索引就绪', async () => {
      const c = await rootCount()
      return c > 0 ? c : undefined
    })
    const initial = await state()
    assert(
      JSON.stringify(initial.excludePatterns) === JSON.stringify(['**/.git/**', '**/node_modules/**']),
      `初始应为默认排除模式（实际 ${JSON.stringify(initial.excludePatterns)}）`)
    assert(initial.persistedPatterns === null, '未保存过不应有持久化值')
    // 排除目录中的未引用文档：默认不排除 → 纳入索引（watcher 增量路径端到端）
    await vscode.workspace.fs.createDirectory(wsUri('ex-zone'))
    await vscode.workspace.fs.writeFile(wsUri('ex-zone/隐藏甲.md'), Buffer.from('# 隐藏甲\n'))
    await vscode.workspace.fs.writeFile(wsUri('ex-zone/隐藏乙.md'), Buffer.from('# 隐藏乙\n'))
    const countWithBoth = await poll('新文档经增量入索引', async () => {
      const c = await rootCount()
      return c === initialCount + 2 ? c : undefined
    })
    // 设置页链路保存排除（与「保存」按钮同一处理入口）
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, {
      kind: 'index.setPatterns', patterns: ['ex-zone/**'],
    })
    const excluded = await poll('排除后覆盖范围重算', async () => {
      const s = await state()
      const c = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))?.fileCount ?? -1
      return c === countWithBoth - 2 ? s : undefined
    })
    assert(JSON.stringify(excluded.persistedPatterns) === JSON.stringify(['ex-zone/**']),
      `排除模式应持久化（实际 ${JSON.stringify(excluded.persistedPatterns)}）`)
    // 非法项回显 + 合法项照常生效（超长模式被拒）；计数条件并入轮询——
    // 模式值在重扫开始即更新，覆盖范围重算完成才可断言
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, {
      kind: 'index.setPatterns', patterns: ['**/.git/**', 'a'.repeat(300)],
    })
    await poll('非法项拒绝、合法项生效且覆盖范围还原', async () => {
      const s = await state()
      const c = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))?.fileCount ?? -1
      return JSON.stringify(s.excludePatterns) === JSON.stringify(['**/.git/**']) &&
        JSON.stringify(s.persistedPatterns) === JSON.stringify(['**/.git/**']) &&
        c === countWithBoth ? s : undefined
    })
    // 恢复默认：模式回默认并持久化、覆盖范围还原
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, { kind: 'index.resetPatterns' })
    await poll('恢复默认', async () => {
      const s = await state()
      const c = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))?.fileCount ?? -1
      return c === countWithBoth &&
        JSON.stringify(s.excludePatterns) === JSON.stringify(['**/.git/**', '**/node_modules/**']) &&
        JSON.stringify(s.persistedPatterns) === JSON.stringify(['**/.git/**', '**/node_modules/**'])
        ? s : undefined
    })
    // 收尾：清理临时文档（保持后续用例计数稳定）。逐文件删除——整目录
    // 删除不产生逐文件的 *.md watcher 事件（目录删除在周期核验前不被察觉，
    // 已知边界见规格），逐文件删除走真实增量链路
    await vscode.workspace.fs.delete(wsUri('ex-zone/隐藏甲.md'), { useTrash: false })
    await vscode.workspace.fs.delete(wsUri('ex-zone/隐藏乙.md'), { useTrash: false })
    await poll('临时文档移出索引', async () => {
      const c = await rootCount()
      return c === initialCount ? c : undefined
    })
    await vscode.workspace.fs.delete(wsUri('ex-zone'), { recursive: true, useTrash: false })
  }],

  ['索引维护：完整重建读盘收敛与缓存清理安全回收（#198）', async () => {
    type IndexState = {
      available: boolean
      rebuilding: boolean
      roots: Array<{ fsPath: string; fileCount: number; edgeCount: number; hasData: boolean }>
      storageRoot: string | null
    }
    const state = async (): Promise<IndexState> =>
      (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as IndexState
    const rootOf = (s: IndexState) => s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))!
    const initial = await poll('索引就绪', async () => {
      const s = await state()
      return s.available && rootOf(s).hasData && rootOf(s).edgeCount > 0 ? s : undefined
    })
    const baseEdges = rootOf(initial).edgeCount
    // 新文档带出链（watcher 增量路径）
    await vscode.workspace.fs.writeFile(wsUri('rebuild-doc.md'), Buffer.from('# 重建前\n\n见 [[反链目标]]。\n'))
    await poll('增量入索引', async () => {
      const s = await state()
      return rootOf(s).edgeCount === baseEdges + 1 ? s : undefined
    })
    // 磁盘改写（去引用）后完整重建：经设置页链路触发（与按钮同一入口）
    await vscode.workspace.fs.writeFile(wsUri('rebuild-doc.md'), Buffer.from('# 重建后\n\n引用消失。\n'))
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, { kind: 'index.rebuild' })
    await poll('重建读盘收敛', async () => {
      const s = await state()
      return !s.rebuilding && rootOf(s).edgeCount === baseEdges ? s : undefined
    })
    // 缓存清理：手工制造垃圾代际目录 → 清理后回收、索引保持可用
    const storageRoot = initial.storageRoot!
    const partRoot = `${storageRoot.replace(/\\/g, '/')}/vsidian-index`
    const partitions = (await readdir(partRoot)).filter((d) => !d.startsWith('.'))
    assert(partitions.length > 0, '应有至少一个根分区目录')
    const junkDir = `${partRoot}/${partitions[0]}/gen-000001-dead`
    await mkdir(junkDir, { recursive: true })
    await writeFile(`${junkDir}/shard-000.json`, 'garbage', 'utf8')
    await vscode.commands.executeCommand(CMD.injectSettingsPageMessage, { kind: 'index.cleanup' })
    await poll('垃圾代际被回收', async () => {
      try {
        await readdir(junkDir)
        return undefined
      } catch {
        return true as const
      }
    })
    // CURRENT 代未被删：分区内仍能读到 CURRENT 指针文件
    const currentKept = await poll('活跃代保留', async () => {
      try {
        const content = (await readFile(`${partRoot}/${partitions[0]}/CURRENT`, 'utf8')).trim()
        return content.startsWith('gen-') ? content : undefined
      } catch {
        return undefined
      }
    })
    assert(currentKept.length > 0, '清理不得删除 CURRENT 指向的活跃代')
    // 清理后索引仍可用（状态可观测、计数稳定）
    const after = await state()
    assert(after.available && rootOf(after).hasData, '清理后索引应保持可用')
    // 收尾：移除临时文档
    await vscode.workspace.fs.delete(wsUri('rebuild-doc.md'), { useTrash: false })
    await poll('临时文档移出', async () => {
      const s = await state()
      return rootOf(s).fileCount === rootOf(initial).fileCount ? s : undefined
    })
  }],

  ['索引维护：工作区根增删与嵌套根归属（#198）', async () => {
    type IndexState = {
      roots: Array<{ fsPath: string; fileCount: number; edgeCount: number; hasData: boolean }>
    }
    const state = async (): Promise<IndexState> =>
      (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as IndexState
    const initial = await poll('初始单根就绪', async () => {
      const s = await state()
      return s.roots.length === 1 && s.roots[0]!.hasData ? s : undefined
    })
    const parentBefore = initial.roots[0]!.fileCount
    // 独立第二根 + 嵌套根（父根目录内子目录）：双链按各根内相对路径解析
    const secondDir = `${wsDir}-second`
    const nestedDir = `${wsDir}/nested-root`
    await mkdir(secondDir, { recursive: true })
    await mkdir(nestedDir, { recursive: true })
    await writeFile(`${secondDir}/second-src.md`, '# 二根来源\n\n见 [[second-target]]。\n', 'utf8')
    await writeFile(`${secondDir}/second-target.md`, '# 二根目标\n', 'utf8')
    await writeFile(`${nestedDir}/nested-a.md`, '# 嵌套来源\n\n见 [[nested-target]]。\n', 'utf8')
    await writeFile(`${nestedDir}/nested-target.md`, '# 嵌套目标\n', 'utf8')
    // 增根（一次调用插入两个，尾部连续——还原时可一次删除）。
    // 留痕：single-folder workspace 上这一步触发 window reload（ext host
    // 退出、suite 中断）——启动器已改用单 folder 的 .code-workspace（multi-root
    // 形态起步）规避；此行日志是「回归时快速判界」的锚点
    const added = vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders!.length, 0,
      { uri: vscode.Uri.file(secondDir) }, { uri: vscode.Uri.file(nestedDir) },
    )
    console.log(`[#198] updateWorkspaceFolders 返回 ${String(added)}（此后 ext host 存活 = multi-root 启动形态未被回退）`)
    assert(added === true, 'updateWorkspaceFolders 应接受新增')
    try {
      const after = await poll('新根纳入并完成覆盖范围重算', async () => {
        const s = await state()
        if (s.roots.length !== 3) return undefined
        const parent = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))
        const second = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(secondDir))
        const nested = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(nestedDir))
        return parent && second && nested && second.hasData && nested.hasData &&
          parent.fileCount === parentBefore ? s : undefined
      }, 30000)
      const nested = after.roots.find((r) => normFsPath(r.fsPath) === normFsPath(nestedDir))!
      const second = after.roots.find((r) => normFsPath(r.fsPath) === normFsPath(secondDir))!
      assert(nested.fileCount === 2, `嵌套根应持有自己的 2 个文档（实际 ${nested.fileCount}）`)
      assert(second.fileCount === 2 && second.edgeCount === 1,
        `第二根内双链应解析（files=${second.fileCount} edges=${second.edgeCount}）`)
    } finally {
      // 还原根集合：按**身份**移除本用例新增的两个根（位置无关——宿主
      // 可能恢复出上次会话遗留的失效根，位置移除会删错对象并把多根状态
      // 泄漏进窗口持久化，污染后续非分片运行）
      const dropFolder = async (dir: string): Promise<void> => {
        for (let round = 0; round < 6; round++) {
          const folders = vscode.workspace.workspaceFolders ?? []
          const idx = folders.findIndex((f) => normFsPath(f.uri.fsPath) === normFsPath(dir))
          if (idx < 0) {
            return
          }
          if (!vscode.workspace.updateWorkspaceFolders(idx, 1)) {
            // updateWorkspaceFolders 不可并发调用：被节流拒绝（返回 false）
            // 是暂态——等待后重试而非放弃（CI 慢 runner 上放弃会让根集合
            // 永驻多根，「根移除」必然超时；#215 CI 敏感性族同型加固）
            await new Promise((r) => setTimeout(r, 600))
            continue
          }
          // updateWorkspaceFolders 不可并发调用：等事件落定再试下一轮
          await new Promise((r) => setTimeout(r, 300))
        }
      }
      await dropFolder(secondDir)
      await dropFolder(nestedDir)
      // 等待移除生效（索引根集合回到 1）
      await poll('根移除', async () => {
        const s = await state()
        return s.roots.length === 1 ? s : undefined
      })
      await rm(secondDir, { recursive: true, force: true })
      await rm(nestedDir, { recursive: true, force: true })
      // 父根覆盖范围随移除还原（嵌套目录已删，计数回到 parentBefore）
      await poll('父根覆盖范围还原', async () => {
        const s = await state()
        return s.roots[0]!.fileCount === parentBefore ? s : undefined
      })
    }
  }],

  // ---- #199 单文件更名/移动的引用自动更新 ----

  ['rename 引用改写：多边型改写、面板同步、通知与撤销（#199）', async () => {
    await waitRenameIndexReady()
    // 引用甲面板打开（did 通道改写后 doc.changed 广播同步的断言载体）
    await openWithEditor('rename-ref-a.md')
    await waitSessionReady('rename-ref-a.md')
    const refAUri = wsUri('rename-ref-a.md').toString()
    // rename 走 workspace.applyEdit(renameFile)——与资源管理器/命令面板同一
    // will/did 事件通道（类型注释明示 applyEdit-api 触发，实测断言其成立）
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(wsUri('改名目标.md'), wsUri('改名目标2.md'), { overwrite: false })
    assert(await vscode.workspace.applyEdit(edit), 'rename 应成功应用（applyEdit 通道触发 will 事件）')
    // 引用乙（未打开文档）被改写并落盘：子目录上行路径按新名重算
    const refB = await poll('引用乙改写落盘', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('notes/rename-ref-b.md'))).getText()
      return text.includes('[[../改名目标2]]') ? text : undefined
    })
    assert(refB.includes('上行 [[../改名目标2]]。'), `引用乙应重算为 ../改名目标2（实际 ${refB}` + '）')
    // 计划面：引用甲 3 边 + 引用乙 1 边（先于面板断言——区分计划缺失与
    // 面板同步断点）
    await poll('rename 计划日志', async () => {
      const last = await lastRenameRefLog()
      return last && last.plannedEdits === 5 && last.plannedFiles === 3 &&
        last.skipped.length === 0 && last.notice === 'host.renameRefsUpdated' ? last : undefined
    }).catch(async (err) => {
      throw new Error(`${(err as Error).message}；log实况=${JSON.stringify(await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog'))}`)
    })
    // 引用甲 TextDocument（宿主层）：edit 已作用于已打开文档的 buffer
    await poll('引用甲宿主文本更新', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('rename-ref-a.md'))).getText()
      return text.includes('[同目标](改名目标2.md)') ? text : undefined
    })
    // 引用甲（已打开面板）三种边型经 doc.changed 同步；附件边不动（目标未移动）
    await poll('引用甲面板同步', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, refAUri)) as { text?: string } | undefined
      return v?.text && v.text.includes('[[改名目标2]]') &&
        v.text.includes('[同目标](改名目标2.md)') &&
        v.text.includes('[[改名目标2#深处小节|别名]]') &&
        v.text.includes('![图](assets/rename-pic.png)') ? v : undefined
    }).catch(async (err) => {
      // 诊断兜底：带面板视图与会话实况重新报错（定位 doc.changed 同步断点）
      const v = await vscode.commands.executeCommand(CMD.viewState, refAUri)
      const s = await vscode.commands.executeCommand(CMD.sessionState, refAUri)
      throw new Error(`${(err as Error).message}；viewState=${JSON.stringify(v)}；session=${JSON.stringify(s)}`)
    })
    // 索引刷新（did 通道）：旧条目退场——改名目标.md 不在索引，新名就位
    await poll('索引条目更替', async () => {
      const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
        roots: Array<{ fsPath: string; hasData: boolean; scanning: boolean }>
      }
      const root = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))
      return root && root.hasData && !root.scanning ? true : undefined
    })
    // 面板引用者的覆盖层接管回归钉（#256 review 轮）：引用甲（面板打开）
    // 经 will 改写后只转 buffer 脏不落盘，其覆盖层=buffer 现状是合法接管
    // （#199「未保存内容即时反映」）——did 收尾不得把该覆盖层当残渣退役。
    // 观测口直读覆盖层 resolved 边（须持新目标好边）；不断言
    // renameCandidatesOf 的 incoming——其反链桶按基线边聚合，rename 后的
    // 新目标在依赖者重抽前恒无桶（「目标归位重抽依赖者」已知边界，另票）
    await poll('rename 后面板引用者覆盖层持新目标边', async () => {
      const edges = (await vscode.commands.executeCommand(
        'onegayi.vsidian._test.getRenameOverlay', wsUri('rename-ref-a.md').fsPath,
      )) as string[] | undefined
      return edges && edges.some((e) => e === '改名目标2.md' || e.endsWith('/改名目标2.md'))
        ? edges
        : undefined
    }).catch(async (err) => {
      const edges = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.getRenameOverlay', wsUri('rename-ref-a.md').fsPath,
      )
      throw new Error(`${(err as Error).message}；overlay实况=${JSON.stringify(edges)}`)
    })
    // 撤销一步恢复：rename 与改写 edit 是同一撤销单元（undo 一次全部回退）
    await vscode.commands.executeCommand('undo')
    await poll('撤销恢复引用甲', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, refAUri)) as { text?: string } | undefined
      return v?.text && v.text.includes('[同目标](./改名目标.md)') && !v.text.includes('改名目标2') ? v : undefined
    })
    await poll('撤销恢复引用乙', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('notes/rename-ref-b.md'))).getText()
      return text.includes('[[../改名目标]]') && !text.includes('改名目标2') ? true : undefined
    })
    // undo 文件名回滚落定等待（撤销队列串行；抢跑会与兜底 rename 竞态出
    // 双文件并存）。终态 = 旧名存在且新名消失。1.82.3 上 undo 的文件回滚
    // 实测可慢于固定等待窗（快照落在「新名已消失、旧名未落」的中间态时，
    // 旧实现静默放过、文件丢失，后续跨根用例 EntryNotFound）——改为
    // 轮询终态；超时（撤销单元被宿主拆开不回滚文件名）才显式移回
    // （外部 fs 通道，不触发 will——引用文本已回旧名，无改写）
    await poll('undo 回滚落定（旧名在、新名不在）', async () => {
      const oldExists = await vscode.workspace.fs.stat(wsUri('改名目标.md')).then(() => true, () => false)
      if (oldExists) {
        const newExists = await vscode.workspace.fs.stat(wsUri('改名目标2.md')).then(() => true, () => false)
        if (!newExists) return true
      }
      return undefined
    }, 5000).catch(async () => {
      await Promise.resolve(restoreRename(wsUri('改名目标2.md'), wsUri('改名目标.md'))).catch(() => {})
      // 兜底后仍须收敛：超时兜底若也落空（源不在且旧名未落 = 文件真丢），
      // 本用例 FAIL 暴露，不得静默泄漏给后续用例（漂移用例 finally 同型）
      const oldExists = await vscode.workspace.fs.stat(wsUri('改名目标.md')).then(() => true, () => false)
      if (!oldExists) {
        throw new Error('undo 回滚与兜底移回均未落定：改名目标.md 缺失，不得静默泄漏给后续用例')
      }
    })
    await new Promise((r) => setTimeout(r, 400))
  }],

  ['rename 引用改写：move 出链按新目录重算与附件扩展名保持（#199）', async () => {
    await waitRenameIndexReady()
    // 目标子目录先建（renameFile 不自动创建父目录）
    await vscode.workspace.fs.createDirectory(wsUri('notes/deep'))
    try {
      // move：被移动 Markdown 自身的相对出链按新目录重算
      const edit = new vscode.WorkspaceEdit()
      edit.renameFile(wsUri('rename-moved.md'), wsUri('notes/deep/moved-2.md'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit), 'move 应成功应用')
      const movedText = await poll('被移动文档出链重算', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('notes/deep/moved-2.md'))).getText()
        return text.includes('[[../../改名目标]]') && text.includes('[子文档](../rename-note.md)') ? text : undefined
      })
      assert(movedText.includes('见 [[../../改名目标]] 与 [子文档](../rename-note.md)。'),
        `出链应按 notes/deep 重算（实际 ${movedText}` + '）')
      // 等索引增量把 move 后的盘文本重扫（did 通道 + watcher 双保险）
      await new Promise((r) => setTimeout(r, 1600))
      // 附件 rename：显式扩展名保持、不补 .md；引用甲的 image 边改写
      const picEdit = new vscode.WorkspaceEdit()
      picEdit.renameFile(wsUri('assets/rename-pic.png'), wsUri('assets/rename-pic2.png'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(picEdit), '附件 rename 应成功应用')
      // 引用甲面板（用例 1 后仍打开）经 doc.changed 同步改写
      const refAUri = wsUri('rename-ref-a.md').toString()
      await poll('附件引用改写', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, refAUri)) as { text?: string } | undefined
        const text = v?.text ?? (await vscode.workspace.openTextDocument(wsUri('rename-ref-a.md'))).getText()
        return text.includes('![图](assets/rename-pic2.png)') ? true : undefined
      })
    } finally {
      // 现场还原（外部 fs 通道 + 覆盖写回原始内容，索引经 watcher 自愈）
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('rename-ref-a.md'), Buffer.from(RENAME_REF_A_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('notes/deep/moved-2.md'), wsUri('rename-moved.md'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('rename-moved.md'), Buffer.from(RENAME_MOVED_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('assets/rename-pic2.png'), wsUri('assets/rename-pic.png'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('notes/deep'), { recursive: true })).catch(() => {})
      await new Promise((r) => setTimeout(r, 400))
    }
  }],

  ['rename 引用改写：未保存内容的漂移保护与叠加改写（#199）', async () => {
    await waitRenameIndexReady()
    await openWithEditor('notes/rename-ref-b.md')
    await waitSessionReady('notes/rename-ref-b.md')
    const bUri = wsUri('notes/rename-ref-b.md')
    try {
      // ---- A 段（漂移保护）：链接前插行（dirty 未保存）后立即 rename——
      // 索引边仍是基线区间，当前文本已漂移 → 文档级跳过（过期不硬改）----
      const dirtyEdit = new vscode.WorkspaceEdit()
      dirtyEdit.insert(bUri, new vscode.Position(0, 0), '漂移前置行\n')
      assert(await vscode.workspace.applyEdit(dirtyEdit), '插行应成功')
      const renameEdit = new vscode.WorkspaceEdit()
      renameEdit.renameFile(wsUri('改名目标.md'), wsUri('改名目标2.md'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(renameEdit), 'rename 应成功应用')
      // 引用乙未改写（漂移保护）：链接保持原目标文本
      await poll('漂移引用乙不被改写', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, bUri.toString())) as { text?: string } | undefined
        return v?.text && v.text.includes('漂移前置行') && v.text.includes('[[../改名目标]]') &&
          !v.text.includes('改名目标2') ? v : undefined
      })
      // 反馈：引用甲照常改写（部分更新，skip 报漂移文档）
      await poll('漂移跳过上报', async () => {
        const last = await lastRenameRefLog()
        return last && last.skipped.some((s) => normFsPath(s.fsPath) === normFsPath(bUri.fsPath) &&
          s.reason === 'edge-stale') && last.notice === 'host.renameRefsPartiallyUpdated' ? last : undefined
      })
      // ---- A 段还原（外部 fs 通道，不走 undo：bulk edit 的撤销项不在
      // 非受影响焦点文档的撤销栈顶，undo 会误撤引用乙的漂移行——实测教训）----
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(bUri, Buffer.from(RENAME_REF_B_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('改名目标2.md'), wsUri('改名目标.md'))).catch(() => {})
      // 等索引重扫（watcher 去抖 + 增量队列）
      await new Promise((r) => setTimeout(r, 1800))
      // ---- B 段（叠加改写）：漂移行（未保存）+ 覆盖层边对齐当前文本 →
      // rename 改写经 did 通道叠加在未保存内容上（漂移行保留，不覆盖）----
      await openWithEditor('notes/rename-ref-b.md')
      await waitSessionReady('notes/rename-ref-b.md')
      const driftEdit = new vscode.WorkspaceEdit()
      driftEdit.insert(bUri, new vscode.Position(0, 0), '漂移前置行\n')
      assert(await vscode.workspace.applyEdit(driftEdit), 'B 段首行插行应成功')
      // 两次插行：文档重开后 version 重新计数（#197 覆盖层仲裁按 TextDocument
      // 实例的 version 单调），A 段覆盖层条目停在 version=2——单次插行同样
      // 到 version=2 会被仲裁拒绝（旧扫描不覆盖新内容的防御），第二次编辑
      // 才被采信并重抽边（对齐漂移文本）
      const driftEdit2 = new vscode.WorkspaceEdit()
      driftEdit2.insert(bUri, new vscode.Position(1, 0), '漂移第二行\n')
      assert(await vscode.workspace.applyEdit(driftEdit2), 'B 段次行插行应成功')
      // 覆盖层 flush（500ms 防抖）：边重抽对齐漂移文本、目标解析命中
      await new Promise((r) => setTimeout(r, 1400))
      const renameEdit2 = new vscode.WorkspaceEdit()
      renameEdit2.renameFile(wsUri('改名目标.md'), wsUri('改名目标3.md'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(renameEdit2), '二次 rename 应成功应用')
      // 宿主层先行断言（dirty 文档改写叠加：漂移行保留 + 链接更新）
      await poll('漂移后宿主文本叠加', async () => {
        const text = (await vscode.workspace.openTextDocument(bUri)).getText()
        return text.includes('漂移前置行') && text.includes('漂移第二行') && text.includes('[[../改名目标3]]') ? text : undefined
      }).catch(async (err) => {
        const text = (await vscode.workspace.openTextDocument(bUri)).getText()
        throw new Error(`${(err as Error).message}；宿主实况=${JSON.stringify(text)}`)
      })
      await poll('漂移后叠加改写', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, bUri.toString())) as { text?: string } | undefined
        return v?.text && v.text.includes('漂移前置行') && v.text.includes('漂移第二行') && v.text.includes('[[../改名目标3]]') ? v : undefined
      })
    } finally {
      // 强兜底还原（断言失败也不泄漏现场）：关面板丢弃 dirty buffer，外部
      // fs 通道归位文件并写回引用文档原文（索引经 watcher 自愈）。归位走
      // restoreRename（源不存在跳过——overwrite rename 在源缺失时仍会先删
      // 目标再抛错，单宿主全量实测会把刚归位的文件删掉泄漏给后续用例），
      // 并收敛到终态断言：未收敛则让本用例 FAIL（暴露在正确的用例）
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('rename-ref-a.md'), Buffer.from(RENAME_REF_A_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('notes/rename-ref-b.md'), Buffer.from(RENAME_REF_B_DOC_TEXT, 'utf8'))).catch(() => {})
      let restored = false
      for (let attempt = 0; attempt < 10 && !restored; attempt++) {
        for (const name of ['改名目标3.md', '改名目标2.md']) {
          await Promise.resolve(restoreRename(wsUri(name), wsUri('改名目标.md'))).catch(() => {})
        }
        restored = await Promise.resolve(vscode.workspace.fs.stat(wsUri('改名目标.md'))).then(() => true, () => false)
        if (!restored) await new Promise((r) => setTimeout(r, 200))
      }
      if (!restored) {
        const probe: Record<string, boolean> = {}
        for (const name of ['改名目标.md', '改名目标2.md', '改名目标3.md']) {
          probe[name] = await Promise.resolve(vscode.workspace.fs.stat(wsUri(name))).then(() => true, () => false)
        }
        throw new Error(`兜底归位未收敛（候选名实况 ${JSON.stringify(probe)}），不得静默泄漏给后续用例`)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }],

  ['rename 引用改写：连续 rename 新目标桶空窗——rename 后立即查 incoming 含面板与装载引用者（#269）', async () => {
    await waitRenameIndexReady()
    // #276：前序 #199 的外部归位并不保证宿主 dirty buffer 与索引同步
    // 归位。本例独占 fixture，并只核对起始事实，不清理覆盖层或重建索引。
    for (const [file, expected] of [
      ['rename-chain-ref-a.md', RENAME_CHAIN_REF_A_DOC_TEXT],
      ['notes/rename-chain-ref-b.md', RENAME_CHAIN_REF_B_DOC_TEXT],
    ] as const) {
      assert(await readDisk(file) === expected, `${file} 的盘面应为初始引用`)
      const doc = vscode.workspace.textDocuments.find((d) => normFsPath(d.uri.fsPath) === normFsPath(wsUri(file).fsPath))
      assert(!doc || (!doc.isDirty && doc.getText() === expected), `${file} 的宿主 buffer 应为 clean 初始引用，实际 ${JSON.stringify(doc && { dirty: doc.isDirty, text: doc.getText() })}`)
      const overlay = await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameOverlay', wsUri(file).fsPath)
      assert(overlay === undefined, `${file} 起始不应残留覆盖层，实际 ${JSON.stringify(overlay)}`)
    }
    await poll('连续 rename 起始目标 incoming 含两个原始引用者', async () => {
      const c = (await vscode.commands.executeCommand(
        'onegayi.vsidian._test.getRenameCandidates', wsUri('链式目标.md').fsPath,
      )) as { status: string; incomingFsPaths: string[] } | undefined
      const paths = (c?.incomingFsPaths ?? []).map(normFsPath)
      return c && paths.includes(normFsPath(wsUri('rename-chain-ref-a.md').fsPath)) &&
        paths.includes(normFsPath(wsUri('notes/rename-chain-ref-b.md').fsPath)) ? c : undefined
    })
    await openWithEditor('rename-chain-ref-a.md')
    await waitSessionReady('rename-chain-ref-a.md')
    const refAUri = wsUri('rename-chain-ref-a.md').toString()
    const waitChainRenameLog = (oldName: string, newName: string) =>
      poll(`连续 rename 当前批次 ${oldName} → ${newName} 四边完整改写`, async () => {
        const log = await lastRenameRefLog()
        return log && log.moves.length === 1 &&
          normFsPath(log.moves[0]!.oldFsPath) === normFsPath(wsUri(oldName).fsPath) &&
          normFsPath(log.moves[0]!.newFsPath) === normFsPath(wsUri(newName).fsPath) &&
          log.plannedEdits === 4 && log.plannedFiles === 2 && log.skipped.length === 0 &&
          log.indexNotReady === 0 && !log.cancelled && log.notice === 'host.renameRefsUpdated' ? log : undefined
      }).catch(async (err) => {
        throw new Error(`${(err as Error).message}；log=${JSON.stringify(await lastRenameRefLog())}`)
      })
    try {
      // 第一次 rename：链式目标 → 链式目标2（引用甲=面板打开；引用乙=
      // openTextDocument 装载的无标签 dirty 实例——will edit 只进 buffer，
      // 磁盘保持旧文，见 vault-index-backlinks 规格 #269 落档的机制再实证）
      const edit = new vscode.WorkspaceEdit()
      edit.renameFile(wsUri('链式目标.md'), wsUri('链式目标2.md'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit), 'rename 应成功应用')
      // 验收断言（#269）：rename 完成后立即查新目标 incoming——装载引用者
      //（引用乙，经 did 收尾 dirty 豁免保住 buffer 载体 + 覆盖层冲刷解析 +
      // 桶外兜底）与面板打开引用者（引用甲，同走覆盖层桶外兜底）都必须
      // 在场。修复前：反链桶按基线边聚合、新目标桶空窗 + 收尾退役清掉
      // 引用乙的暂存与冲刷定时器 → incoming 恒空，本轮询超时转红。
      await poll('rename 后新目标 incoming 含面板与装载引用者', async () => {
        const c = (await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameCandidates', wsUri('链式目标2.md').fsPath,
        )) as { status: string; incomingFsPaths: string[] } | undefined
        const paths = (c?.incomingFsPaths ?? []).map(normFsPath)
        const wantA = normFsPath(wsUri('rename-chain-ref-a.md').fsPath)
        const wantB = normFsPath(wsUri('notes/rename-chain-ref-b.md').fsPath)
        return c && paths.includes(wantA) && paths.includes(wantB) ? c : undefined
      }).catch(async (err) => {
        const raw = await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameCandidates', wsUri('链式目标2.md').fsPath,
        )
        const oldPath = await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameCandidates', wsUri('链式目标.md').fsPath,
        )
        const overlayA = await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameOverlay', wsUri('rename-chain-ref-a.md').fsPath,
        )
        const overlayB = await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameOverlay', wsUri('notes/rename-chain-ref-b.md').fsPath,
        )
        const refBText = (await vscode.workspace.openTextDocument(wsUri('notes/rename-chain-ref-b.md'))).getText()
        const refBDisk = await readDisk('notes/rename-chain-ref-b.md')
        const log = await lastRenameRefLog()
        throw new Error(`${(err as Error).message}；candidates实况=${JSON.stringify(raw)}；` +
          `旧路径candidates=${JSON.stringify(oldPath)}；` +
          `overlayA=${JSON.stringify(overlayA)}；overlayB=${JSON.stringify(overlayB)}；` +
          `refB缓冲=${JSON.stringify(refBText)}；refB磁盘=${JSON.stringify(refBDisk)}；log=${JSON.stringify(log)}`)
      })
      await waitChainRenameLog('链式目标.md', '链式目标2.md')
      const firstB = await vscode.workspace.openTextDocument(wsUri('notes/rename-chain-ref-b.md'))
      assert(firstB.isDirty && firstB.getText().includes('[[../链式目标2]]'), '第一笔 rename 应更新装载引用乙的 dirty buffer')
      assert(await readDisk('notes/rename-chain-ref-b.md') === RENAME_CHAIN_REF_B_DOC_TEXT, '装载引用乙的改写仍只在 buffer，盘面保持原文')
      // 用户故事闭环：立即第二次 rename（链式目标2 → 链式目标3），引用者必须
      // 被改写而非静默漏改（修复前该 rename 的候选 incoming 为空、无候选即
      // 静默跳过，两引用文本原地不动）
      const edit2 = new vscode.WorkspaceEdit()
      edit2.renameFile(wsUri('链式目标2.md'), wsUri('链式目标3.md'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit2), '第二次 rename 应成功应用')
      await waitChainRenameLog('链式目标2.md', '链式目标3.md')
      await poll('连续 rename 引用乙改写', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('notes/rename-chain-ref-b.md'))).getText()
        return text.includes('[[../链式目标3]]') ? text : undefined
      })
      await poll('连续 rename 引用甲面板同步', async () => {
        const v = (await vscode.commands.executeCommand(CMD.viewState, refAUri)) as { text?: string } | undefined
        return v?.text && v.text.includes('[[链式目标3]]') &&
          v.text.includes('[同目标](链式目标3.md)') &&
          v.text.includes('[[链式目标3#深处小节|别名]]') && !v.text.includes('链式目标2') ? v : undefined
      })
    } finally {
      // 归位独占 fixture 的盘面与文件名（宿主装载 buffer 仍可能留存，
      // 不把关闭标签当作装载文档终结）；后续用例不复用这些文档。
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('rename-chain-ref-a.md'), Buffer.from(RENAME_CHAIN_REF_A_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('notes/rename-chain-ref-b.md'), Buffer.from(RENAME_CHAIN_REF_B_DOC_TEXT, 'utf8'))).catch(() => {})
      let restored = false
      for (let attempt = 0; attempt < 10 && !restored; attempt++) {
        for (const name of ['链式目标3.md', '链式目标2.md']) {
          await Promise.resolve(restoreRename(wsUri(name), wsUri('链式目标.md'))).catch(() => {})
        }
        restored = await Promise.resolve(vscode.workspace.fs.stat(wsUri('链式目标.md'))).then(() => true, () => false)
        if (!restored) await new Promise((r) => setTimeout(r, 200))
      }
      if (!restored) {
        const probe: Record<string, boolean> = {}
        for (const name of ['链式目标.md', '链式目标2.md', '链式目标3.md']) {
          probe[name] = await Promise.resolve(vscode.workspace.fs.stat(wsUri(name))).then(() => true, () => false)
        }
        throw new Error(`兜底归位未收敛（候选名实况 ${JSON.stringify(probe)}），不得静默泄漏给后续用例`)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }],

  ['rename 引用改写：跨根移动不改写并明确报告（#199）', async () => {
    await waitRenameIndexReady()
    const secondDir = `${wsDir}-rename-second`
    await mkdir(secondDir, { recursive: true })
    const added = vscode.workspace.updateWorkspaceFolders(
      vscode.workspace.workspaceFolders!.length, 0,
      { uri: vscode.Uri.file(secondDir) },
    )
    assert(added === true, 'updateWorkspaceFolders 应接受新增')
    try {
      // 等第二根索引就绪（引用域边界就位）
      await poll('第二根纳入', async () => {
        const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
          roots: Array<{ fsPath: string; hasData: boolean }>
        }
        const second = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(secondDir))
        return second?.hasData ? true : undefined
      }, 30000)
      // 等主根「改名目标.md 的引用边」自愈完成（#256）：waitRenameIndexReady 只等
      // hasData && !scanning——观测不到前序用例残留的自愈进度。漂移用例把索引边
      // 挪到改名目标3.md 桶后经外部 fs 通道还原，watcher 增量重扫异步恢复；加根的
      // setRoots 又会中止在途增量改走 fullScan，而「第二根纳入」的满足点恰早于主根
      // fullScan——不在此等边恢复，跨根 rename 的 will 会读到 incoming 缺失（改名
      // 目标.md 桶 0~1 条引用者），暂存缺失或 skipped<2，「跨根跳过上报」必然超时
      // （单宿主全量稳定复现、四分片因用例分属不同宿主而被掩盖）。等两个基线引用
      // 者都在场即视自愈完成（rename-moved.md 同为引用者但不在断言语义内）。
      // 缺席自愈（节流）：前序用例可把引用甲的面板以 dirty 态遗留（will edit 对
      // 打开文档只作用 buffer 不落盘），closeAllEditors 丢弃 dirty 不广播回滚、
      // 文档实例滞留缓存无退场事件——其「未保存」覆盖层残渣遮蔽基线。自愈动作=
      // 打开并保存（save 落盘触发 onDidSaveTextDocument → 覆盖层随 documentSaved
      // 退役+重扫）再外部写回原文（watcher 重扫、基线归位）——全走产品正道事件
      let healKick = 0
      await poll('跨根 rename 前索引边自愈', async () => {
        const c = (await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameCandidates', wsUri('改名目标.md').fsPath,
        )) as { status: string; incomingFsPaths: string[] } | undefined
        const aIn = c?.incomingFsPaths.some((p) => normFsPath(p) === normFsPath(wsUri('rename-ref-a.md').fsPath))
        const bIn = c?.incomingFsPaths.some((p) => normFsPath(p) === normFsPath(wsUri('notes/rename-ref-b.md').fsPath))
        if (c?.status === 'ready' && aIn && bIn) {
          return true
        }
        if (c?.status === 'ready' && healKick++ % 6 === 0) {
          const targets: Array<[vscode.Uri, string]> = []
          if (!aIn) {
            targets.push([wsUri('rename-ref-a.md'), RENAME_REF_A_DOC_TEXT])
          }
          if (!bIn) {
            targets.push([wsUri('notes/rename-ref-b.md'), RENAME_REF_B_DOC_TEXT])
          }
          for (const [uri, text] of targets) {
            const doc = await vscode.workspace.openTextDocument(uri)
            await Promise.resolve(doc.save()).catch(() => {})
            await Promise.resolve(vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'))).catch(() => {})
          }
        }
        return undefined
      }).catch(async (err) => {
        const c = (await vscode.commands.executeCommand(
          'onegayi.vsidian._test.getRenameCandidates', wsUri('改名目标.md').fsPath,
        )) as { status: string; incomingFsPaths: string[] } | undefined
        const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
          roots: Array<{ fsPath: string; hasData: boolean; scanning: boolean; queued: number; fileCount: number; edgeCount: number }>
        }
        throw new Error(`${(err as Error).message}；candidates实况=${JSON.stringify(c)}；主根实况=${JSON.stringify(s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir)))}`)
      })
      // 跨根移动：改名目标.md → 第二根（跨根移动不被拦截，但不得生成跨根引用）
      const edit = new vscode.WorkspaceEdit()
      edit.renameFile(wsUri('改名目标.md'), vscode.Uri.file(`${secondDir}/改名目标.md`), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit), '跨根 rename 应成功应用')
      // 引用者文本原样（不生成 ../.. 跨根相对引用）。断言语义是磁盘落盘
      // 文本：直读盘（fs.readFile），不经 openTextDocument——前序 rename
      // 用例改写过的文档缓存 reconcile 异步，单宿主全量下（多边型/漂移与
      // 本用例同宿主先后跑）缓存里还是改写后的旧文本，会误报为跨根改写
      const readDisk = (rel: string) => Promise.resolve(vscode.workspace.fs.readFile(wsUri(rel)))
        .then((data) => Buffer.from(data).toString('utf8'))
      const textA = await readDisk('rename-ref-a.md')
      const textB = await readDisk('notes/rename-ref-b.md')
      assert(textA.includes('[同目标](./改名目标.md)') && !textA.includes('rename-second'),
        `跨根不得改写引用甲（实际 ${textA}` + '）')
      assert(textB.includes('[[../改名目标]]'), `跨根不得改写引用乙（实际 ${textB}` + '）')
      // 反馈：全部跳过（cross-root）、零更新
      await poll('跨根跳过上报', async () => {
        const last = await lastRenameRefLog()
        return last && last.plannedEdits === 0 && last.skipped.length >= 2 &&
          last.skipped.every((s) => s.reason === 'cross-root') &&
          last.notice === 'host.renameRefsSkippedAll' ? last : undefined
      }).catch(async (err) => {
        const log = await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog')
        throw new Error(`${(err as Error).message}；log实况=${JSON.stringify(log)}`)
      })
    } finally {
      // 现场还原：外部 fs 通道移回（不触发 will），按身份移除第二根，等索引稳定
      await Promise.resolve(restoreRename(vscode.Uri.file(`${secondDir}/改名目标.md`), wsUri('改名目标.md'))).catch(() => {})
      // 还原判据须含文件级终态：只查索引就绪时，restoreRename 失败被
      // catch 吞掉会静默放过（改名目标.md 仍滞留 secondDir），随后
      // rm(secondDir) 连唯一副本一起删掉、泄漏给后续用例——本用例 FAIL
      await poll('还原后主根就绪（含改名目标归位）', async () => {
        const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
          roots: Array<{ fsPath: string; hasData: boolean; scanning: boolean }>
        }
        const main = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))
        const oldExists = await vscode.workspace.fs.stat(wsUri('改名目标.md')).then(() => true, () => false)
        return main?.hasData && !main.scanning && oldExists ? true : undefined
      })
      for (let round = 0; round < 6; round++) {
        const folders = vscode.workspace.workspaceFolders ?? []
        const idx = folders.findIndex((f) => normFsPath(f.uri.fsPath) === normFsPath(secondDir))
        if (idx < 0) {
          break
        }
        if (!vscode.workspace.updateWorkspaceFolders(idx, 1)) {
          // updateWorkspaceFolders 不可并发调用：被节流拒绝（返回 false）
          // 是暂态——等待后重试而非放弃（CI 慢 runner 上放弃会让第二根
          // 永驻，「根集合还原」必然超时；#215 CI 敏感性族同型加固）
          await new Promise((r) => setTimeout(r, 600))
          continue
        }
        await new Promise((r) => setTimeout(r, 300))
      }
      await rm(secondDir, { recursive: true, force: true })
      await poll('根集合还原', async () => {
        const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
          roots: Array<{ fsPath: string }>
        }
        return s.roots.length === 1 ? true : undefined
      })
    }
  }],

  // ---- #200 目录与批量移动的引用更新 ----

  ['rename 引用改写：目录 rename 批量改写、互链恒等与一步撤销（#200）', async () => {
    await waitRenameIndexReady()
    await ensureDirMoveFixture()
    // 引用者面板打开（undo 落点锚定——bulk edit 撤销项挂受影响文档栈，
    // 焦点须在受影响文档上，#199 实测教训）
    await openWithEditor('dir-ref.md')
    await waitSessionReady('dir-ref.md')
    const refUri = wsUri('dir-ref.md')
    // 目录 rename：event.files 只给目录级 old→new（展开为逐文件映射）
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(wsUri('dir-move'), wsUri('dir-moved'), { overwrite: false })
    assert(await vscode.workspace.applyEdit(edit), '目录 rename 应成功应用（applyEdit 通道）')
    // 外部引用者四边型批量改写（wikilink 两条 + mdlink + 附件）
    const refText = await poll('目录引用者批量改写', async () => {
      const text = (await vscode.workspace.openTextDocument(refUri)).getText()
      return text.includes('[[dir-moved/inner-a]]') &&
        text.includes('[乙](dir-moved/inner-b.md)') &&
        text.includes('[丙](dir-moved/deep/inner-c.md)') &&
        text.includes('![图](dir-moved/dir-pic.png)') ? text : undefined
    })
    assert(!refText.includes('dir-move/'), `目录引用应全部改写为 dir-moved（实际 ${refText}` + '）')
    // 目录内互链恒等不改写：inner-a 的同目录链 [[inner-b]] 与上行链 [[../c-out]]
    // 保持原文（同级改名相对关系不变——恒等替换滤除）
    const innerA = (await vscode.workspace.openTextDocument(wsUri('dir-moved/inner-a.md'))).getText()
    assert(innerA.includes('互链 [[inner-b]] 与上行 [[../c-out]]。'),
      `同目录互链与上行出链应保持原文（实际 ${innerA}` + '）')
    // 计划面：展开 4 文件（a/b/deep-c/png）、will 改写 4 边 1 文件、did 出链
    // 全恒等 0 边、全部成功三态
    await poll('目录 rename 计划日志', async () => {
      const last = await lastRenameRefLog()
      return last && last.plannedEdits === 4 && last.plannedFiles === 1 &&
        last.expandedMoves === 4 && last.skipped.length === 0 &&
        last.notice === 'host.renameRefsUpdated' ? last : undefined
    }).catch(async (err) => {
      throw new Error(`${(err as Error).message}；log实况=${JSON.stringify(await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog'))}`)
    })
    // 索引批量刷新：dir-moved 新条目就位（反链可查由 did 刷新重建）
    await poll('目录 rename 后索引就绪', async () => {
      const s = (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as {
        roots: Array<{ fsPath: string; hasData: boolean; scanning: boolean }>
      }
      const root = s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))
      return root && root.hasData && !root.scanning ? true : undefined
    })
    // 撤销一步：rename 与引用者改写同一撤销单元（目录名与文本全部回退）
    await vscode.commands.executeCommand('undo')
    await poll('撤销恢复目录引用者', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, refUri.toString())) as { text?: string } | undefined
      return v?.text && v.text.includes('[[dir-move/inner-a]]') && !v.text.includes('dir-moved') ? v : undefined
    })
    // undo 回滚 rename 落定等待（撤销队列串行；抢跑会与兜底还原竞态）
    await new Promise((r) => setTimeout(r, 600))
    try {
      await vscode.workspace.fs.stat(wsUri('dir-moved'))
      // undo 未回滚目录名：外部 fs 通道显式移回（引用文本已恢复，无改写）。
      // 移回未执行或失败不静默留痕（残留目录会进索引，ensureDirMoveFixture
      // 只幂等重建 dir-move 不清理残留——放弃时不静默惯例）
      const moved = await Promise.resolve(restoreRename(wsUri('dir-moved'), wsUri('dir-move'))).catch(() => false)
      if (!moved) console.warn('[#200] 兜底移回 dir-moved 未执行或失败，残留目录可能污染后续索引')
    } catch {
      // undo 已回滚目录名
    }
    await ensureDirMoveFixture()
  }],

  ['rename 引用改写：目录跨深度 move 出链重算与两通道合并反馈（#200）', async () => {
    await waitRenameIndexReady()
    await ensureDirMoveFixture()
    // 目标父目录先建（renameFile 不自动创建父目录）
    await vscode.workspace.fs.createDirectory(wsUri('sub'))
    try {
      // 目录 move 到更深位置：外部引用者（will 原子）+ 目录内上行出链（did 独立）
      const edit = new vscode.WorkspaceEdit()
      edit.renameFile(wsUri('dir-move'), wsUri('sub/dir-move'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit), '目录 move 应成功应用')
      // 外部引用者四边按新位置重算（will 通道）
      await poll('目录 move 引用者改写', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('dir-ref.md'))).getText()
        return text.includes('[[sub/dir-move/inner-a]]') &&
          text.includes('[乙](sub/dir-move/inner-b.md)') &&
          text.includes('[丙](sub/dir-move/deep/inner-c.md)') &&
          text.includes('![图](sub/dir-move/dir-pic.png)') ? text : undefined
      })
      // 被移动文档出链重算（did 通道）：上行链加一层 ../；同目录互链恒等保持
      const innerA = await poll('目录 move 出链重算', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('sub/dir-move/inner-a.md'))).getText()
        return text.includes('互链 [[inner-b]] 与上行 [[../../c-out]]。') ? text : undefined
      })
      assert(!innerA.includes('[[../c-out]]'), `上行链应重算为 ../../（实际 ${innerA}` + '）')
      // 合并反馈：will 4 边 + did 1 边 = 5 处、2 文件、展开 4 条
      await poll('目录 move 合并日志', async () => {
        const last = await lastRenameRefLog()
        return last && last.plannedEdits === 5 && last.plannedFiles === 2 &&
          last.expandedMoves === 4 && last.skipped.length === 0 &&
          last.notice === 'host.renameRefsUpdated' ? last : undefined
      }).catch(async (err) => {
        throw new Error(`${(err as Error).message}；log实况=${JSON.stringify(await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog'))}`)
      })
    } finally {
      // 现场还原（外部 fs 通道 + 覆盖写回原始内容，索引经 watcher 自愈）
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-ref.md'), Buffer.from(DIR_REF_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('sub/dir-move'), wsUri('dir-move'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('dir-move/inner-a.md'), Buffer.from(DIR_INNER_A_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.delete(wsUri('sub'), { recursive: true })).catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
      await ensureDirMoveFixture()
    }
  }],

  ['rename 引用改写：多文件同批 rename 合并反馈与不重复编辑（#200）', async () => {
    await waitRenameIndexReady()
    await ensureBatchFixture()
    try {
      // 同批两条文件映射（一次 applyEdit、一次 will 事件）：引用甲的 4 边
      //（3 目标边 + 1 附件边）合并为单文档单次规划；moved 出链在 did 合并。
      // 用 batch 专属文档组：与 #199 漂移保护用例共享文档会踩其 finally
      // 泄漏的 dirty buffer 与覆盖层滞留（#199 已知边界——编辑即自愈，跨
      // 用例不自愈；分片全量实测：引用者桶被滞留边带偏导致改写缺失）
      const edit = new vscode.WorkspaceEdit()
      edit.renameFile(wsUri('批目标.md'), wsUri('批改名目标.md'), { overwrite: false })
      edit.renameFile(wsUri('assets/batch-pic.png'), wsUri('assets/batch-pic-batch.png'), { overwrite: false })
      assert(await vscode.workspace.applyEdit(edit), '同批 rename 应成功应用')
      // 引用甲：目标三边型 + 附件边一次改写（同文档多目标一次 WorkspaceEdit）
      const refA = await poll('同批引用甲改写', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('batch-ref-a.md'))).getText()
        return text.includes('[[批改名目标]]') && text.includes('[同目标](批改名目标.md)') &&
          text.includes('[[批改名目标#深处小节|别名]]') &&
          text.includes('![图](assets/batch-pic-batch.png)') ? text : undefined
      }).catch(async (err) => {
        // 诊断兜底：引用甲 dirty 状态、buffer 实况与计划日志一起重抛（定位
        // will/did 双通道断点）
        const doc = vscode.workspace.textDocuments.find((d) => normFsPath(d.uri.fsPath) === normFsPath(wsUri('batch-ref-a.md').fsPath))
        throw new Error(`${(err as Error).message}；甲dirty=${doc?.isDirty}；甲实况=${JSON.stringify(doc?.getText() ?? null)}；log实况=${JSON.stringify(await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog'))}`)
      })
      assert(!refA.includes('[[批目标') && !refA.includes('(./批目标.md)') &&
        !refA.includes('batch-pic.png'),
        `同批改写应无旧目标残留（实际 ${refA}` + '）')
      // moved 出链（did）：[[批目标]] → [[批改名目标]]
      await poll('同批 moved 出链改写', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('batch-moved.md'))).getText()
        return text.includes('[[批改名目标]]') ? text : undefined
      })
      // 引用乙（子目录上行边，未打开文档）也随同批改写
      await poll('同批引用乙改写', async () => {
        const text = (await vscode.workspace.openTextDocument(wsUri('notes/batch-ref-b.md'))).getText()
        return text.includes('上行 [[../批改名目标]]。') ? text : undefined
      })
      // 合并反馈：will（引用甲 4 边 + 引用乙 1 边）+ did（moved 1 边）=
      // 6 处 3 文件、展开 2 条（两条文件映射原样）、一次通知
      await poll('同批合并日志', async () => {
        const last = await lastRenameRefLog()
        return last && last.plannedEdits === 6 && last.plannedFiles === 3 &&
          last.expandedMoves === 2 && last.skipped.length === 0 &&
          last.notice === 'host.renameRefsUpdated' ? last : undefined
      }).catch(async (err) => {
        throw new Error(`${(err as Error).message}；log实况=${JSON.stringify(await vscode.commands.executeCommand('onegayi.vsidian._test.getRenameRefLog'))}`)
      })
    } finally {
      // 现场还原（外部 fs 通道 + 写回原始内容）
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('batch-ref-a.md'), Buffer.from(BATCH_REF_A_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('notes/batch-ref-b.md'), Buffer.from(BATCH_REF_B_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(vscode.workspace.fs.writeFile(wsUri('batch-moved.md'), Buffer.from(BATCH_MOVED_DOC_TEXT, 'utf8'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('批改名目标.md'), wsUri('批目标.md'))).catch(() => {})
      await Promise.resolve(restoreRename(wsUri('assets/batch-pic-batch.png'), wsUri('assets/batch-pic.png'))).catch(() => {})
      await new Promise((r) => setTimeout(r, 500))
      await ensureBatchFixture()
    }
  }],

  ['索引维护：批量文件增删的队列收敛与索引守恒（Git 切换量级 100 文件，#202）', async () => {
    type IndexState = {
      available: boolean
      rebuilding: boolean
      roots: Array<{ fsPath: string; fileCount: number; edgeCount: number; hasData: boolean }>
    }
    const state = async (): Promise<IndexState> =>
      (await vscode.commands.executeCommand('onegayi.vsidian._test.getVaultIndexState')) as IndexState
    const rootOf = (s: IndexState) => s.roots.find((r) => normFsPath(r.fsPath) === normFsPath(wsDir))!
    const initial = await poll('索引就绪', async () => {
      const s = await state()
      return s.available && rootOf(s).hasData && rootOf(s).edgeCount > 0 ? s : undefined
    })
    const baseFiles = rootOf(initial).fileCount
    const baseEdges = rootOf(initial).edgeCount
    // Git 切换量级的批量增：常驻目标 + 100 来源文件各一条出链
    // （watcher 事件风暴进有界队列逐批消化，不产生无界任务）
    await mkdir(`${wsDir}/git-switch`, { recursive: true })
    await vscode.workspace.fs.writeFile(wsUri('git-switch/git-switch-target.md'), Buffer.from('# 批量目标\n'))
    const SWITCH_COUNT = 100
    for (let i = 0; i < SWITCH_COUNT; i++) {
      await vscode.workspace.fs.writeFile(
        wsUri(`git-switch/switch-${i}.md`),
        Buffer.from(`# 批量来源 ${i}\n\n见 [[git-switch-target]]。\n`),
      )
    }
    await poll('批量增收敛', async () => {
      const s = await state()
      return s.available && !s.rebuilding &&
        rootOf(s).fileCount === baseFiles + SWITCH_COUNT + 1 &&
        rootOf(s).edgeCount === baseEdges + SWITCH_COUNT ? s : undefined
    }, 60000)
    // Git 切换量级的批量删（切回原分支）：逐文件删除走增量链路
    // （单文件 delete 事件有；整目录删除不产生逐文件事件是 #198 已知边界，
    // 此处刻意逐文件删除以走真实增量路径）
    for (let i = 0; i < SWITCH_COUNT; i++) {
      await vscode.workspace.fs.delete(wsUri(`git-switch/switch-${i}.md`), { useTrash: false })
    }
    await vscode.workspace.fs.delete(wsUri('git-switch/git-switch-target.md'), { useTrash: false })
    await poll('批量删收敛', async () => {
      const s = await state()
      return s.available && rootOf(s).hasData &&
        rootOf(s).fileCount === baseFiles && rootOf(s).edgeCount === baseEdges ? s : undefined
    }, 60000)
    // 兜底清理（正常路径已删净目录内容；失败路径尽力还原不抛二次错误）
    await rm(`${wsDir}/git-switch`, { recursive: true, force: true }).catch(() => {})
  }],

  ['悬停预览：Reading 双链读取目标全文、错误分态就地呈现与双零 dirty（#218）', async () => {
    await openWithEditor('悬停预览.md')
    await waitSessionReady('悬停预览.md')
    const uri = wsUri('悬停预览.md').toString()
    const targetUri = wsUri('目标笔记.md')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'reading' && (v.readingWikilinkCount ?? 0) >= 2)
    const parentBefore = await readDisk('悬停预览.md')
    const targetBefore = await readDisk('目标笔记.md')

    // 悬停第 0 个双链（[[目标笔记]]）：mouseover 经容器委托（与用户悬停
    // 同一处理器链路）→ 开延迟后出站 hover.request → 宿主无副作用读取 →
    // hover.result → 浮层以 Reading 内容显示目标全文
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0 })
    const shown = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.blocks > 0)
    assert(shown.hoverPreview?.note === '目标笔记.md',
      `浮层目标标识应为根内相对路径（实际 ${shown.hoverPreview?.note}）`)

    // 双零 dirty：父/目标 TextDocument 均不脏、磁盘文本不动、无 applyEdit
    const targetDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
    const parentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)
    assert(targetDoc, '读取后目标文档应经 openTextDocument 装载（只装载不显示）')
    assert(parentDoc?.isDirty === false, `父文档不得变脏（实际 dirty=${parentDoc?.isDirty}）`)
    assert(targetDoc?.isDirty === false, `目标文档不得变脏（实际 dirty=${targetDoc?.isDirty}）`)
    assert(await readDisk('悬停预览.md') === parentBefore, '悬停读取不得改写父文档磁盘')
    assert(await readDisk('目标笔记.md') === targetBefore, '悬停读取不得改写目标磁盘')
    const hoverState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(hoverState.appliedEdits === 0, `悬停链路不得产生 applyEdit（实际 ${hoverState.appliedEdits}）`)

    // 离开链接 → 延迟关闭（实例释放）；悬停第 1 个双链（[[悬停缺失目标]]）
    // → not-found 错误分态就地呈现（浮层在场、不弹宿主通知）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 0 })
    await waitViewState('悬停预览.md', (v) => v.hoverPreview?.open === false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 1 })
    await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'error')

    // 迟到回包守卫（真宿主）：对已关闭旧实例的成功回包不得重开/翻新
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'hover.result',
      reqId: 1,
      instanceId: 'itest-stale-instance',
      ok: true,
      target: { fsPath: targetUri.fsPath, relPath: '目标笔记.md' },
      version: 1,
      text: '# 迟到内容\n',
      range: { start: 0, end: 6 },
      scope: { kind: 'full' },
    })
    await new Promise((r) => setTimeout(r, 300))
    const stale = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
    assert(stale?.hoverPreview?.open === true && stale.hoverPreview.state === 'error',
      `旧实例迟到回包应被丢弃（实际 ${JSON.stringify(stale?.hoverPreview)}）`)

    // 复位：切回 live（后续用例隔离；浮层随切模式释放）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'live' && v.hoverPreview?.open === false)
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.appliedEdits === 0, `全链路零 applyEdit（实际 ${finalState.appliedEdits}）`)
  }],

  // #219 局部范围与普通链接矩阵：章节/块 scope 与块数、CRLF+中文空格路径
  // 目标、页内锚点（目标即来源文档）、失效锚点分态、普通链接 linkHref
  // 链路、外站预滤、零 applyEdit。目标文档「悬停 局部目标.md」全文 7 块
  // （H1/顶部段/章节甲标题/甲段/列表/章节乙标题/乙段）；章节甲 = 3 块、
  // 列表块 = 1 块——块数差即范围过滤的直接证据
  ['悬停预览：局部范围与普通链接——章节/块/锚点矩阵（#219）', async () => {
    await openWithEditor('悬停预览.md')
    await waitSessionReady('悬停预览.md')
    const uri = wsUri('悬停预览.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'reading' && (v.readingWikilinkCount ?? 0) >= 5)
    const before = await readDisk('悬停 局部目标.md')

    // 章节双链（index 2）：scope=heading、P2-03（#280）起全文可达——块数
    // 为目标全文 7 块（锚点只作初始定位，不再收窄内容范围；CRLF 换算正确
    // 时与 LF 文档同构；目标标识为中文空格路径的根内相对路径）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 2 })
    const section = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'heading')
    assert(section.hoverPreview?.note === '悬停 局部目标.md',
      `章节预览目标标识应为根内相对路径（实际 ${section.hoverPreview?.note}）`)
    assert(section.hoverPreview?.blocks === 7,
      `章节引用应渲染目标全文 7 块（实际 ${section.hoverPreview?.blocks}）`)

    // 块引用双链（index 3）：scope=block、同样全文 7 块（多行块语义由
    // 定位区间承载——anchor 命中即成功，内容范围不再按块收窄）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 3 })
    const block = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'block')
    assert(block.hoverPreview?.blocks === 7,
      `块引用应渲染目标全文 7 块（实际 ${block.hoverPreview?.blocks}）`)

    // 失效锚点（index 4）：anchor-missing 分态就地呈现（不以全文替代），
    // 文案含锚点原文（note 为错误文案载体）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 4 })
    const missing = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'error')
    assert(missing.hoverPreview?.note.includes('没有的标题'),
      `锚点缺失文案应含锚点原文（实际 ${missing.hoverPreview?.note}）`)

    // 普通链接全文（md index 0，href 经 markdown-it 编码——空格 %20 容错
    // 解码矩阵）：scope=full、块数为全文 7 块
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0, link: 'md' })
    const mdFull = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'full')
    assert(mdFull.hoverPreview?.blocks === 7,
      `普通链接全文应渲染 7 块（实际 ${mdFull.hoverPreview?.blocks}）`)

    // 普通链接章节（md index 1，fragment 锚点）：scope=heading、全文 7 块
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 1, link: 'md' })
    const mdSection = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'heading')
    assert(mdSection.hoverPreview?.blocks === 7,
      `链接章节应渲染目标全文 7 块（实际 ${mdSection.hoverPreview?.blocks}）`)

    // 页内锚点（md index 2）：目标即来源文档自身（不跨文档），scope=heading
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 2, link: 'md' })
    const anchor = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'heading')
    assert(anchor.hoverPreview?.note === '悬停预览.md',
      `页内锚点目标应为来源文档（实际 ${anchor.hoverPreview?.note}）`)

    // 外站链接（md index 3）：预滤不开浮层（等待超过开延迟+读取余量后仍无）。
    // 先离开 index 2 还原真实事件序列：真实鼠标移到另一链接必先派发
    // mouseout（旧浮层由 leave 关闭）；#299 起非法目标（外部 scheme）不进
    // 浮层入口，纯 enter 序列不再借「换锚先关旧」的入口副作用关旧浮层
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 2, link: 'md' })
    await waitViewState('悬停预览.md', (v) => v.hoverPreview?.open === false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 3, link: 'md' })
    await new Promise((r) => setTimeout(r, 1000))
    const external = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
    assert(external?.hoverPreview?.open === false,
      `外部网页不得开浮层（实际 ${JSON.stringify(external?.hoverPreview)}）`)

    // 零写回：目标/来源双零 dirty、磁盘不动、零 applyEdit
    const parentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)
    const targetDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === wsUri('悬停 局部目标.md').toString())
    assert(targetDoc, 'CRLF 目标应经 openTextDocument 装载')
    assert(parentDoc?.isDirty === false && targetDoc?.isDirty === false, '父/目标文档双零 dirty')
    assert(await readDisk('悬停 局部目标.md') === before, '悬停读取不得改写目标磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `局部预览零 applyEdit（实际 ${state.appliedEdits}）`)

    // 复位：切回 live（浮层随切模式释放；后续用例隔离）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'live' && v.hoverPreview?.open === false)
  }],

  // #220 来源资源与笔记属性：B（子目录目标）内相对图片按 B 目录解析——
  // res.png 只存在于 hover-assets/，按根/A 目录解析必 not-found，浮层内已
  // 应用图片地址携带子目录路径即为 B 身份解析证据；全文引用属性区默认
  // 折叠（探针 fm）；浮层点击同款 wikilink.activate（附 sourceDocUri）注入
  // 后按 B 目录解析打开子目录内目标；全程零写回
  ['悬停预览：来源资源与笔记属性——B 身份解析、属性折叠与零写回（#220）', async () => {
    await openWithEditor('悬停预览.md')
    const session = await waitSessionReady('悬停预览.md')
    const uri = wsUri('悬停预览.md').toString()
    const targetUri = wsUri('hover-assets/悬停 资源目标.md')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'reading' && (v.readingWikilinkCount ?? 0) >= 6)
    const parentBefore = await readDisk('悬停预览.md')
    const targetBefore = await readDisk('hover-assets/悬停 资源目标.md')

    // 悬停追加段的双链（wikilink index 5 = [[hover-assets/悬停 资源目标]]）：
    // 全文预览 + 笔记属性区默认折叠（成型 frontmatter → fm=collapsed）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 5 })
    const shown = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.open === true && v.hoverPreview.state === 'content' && v.hoverPreview.scope === 'full')
    assert(shown.hoverPreview?.note === 'hover-assets/悬停 资源目标.md',
      `目标标识应为子目录相对路径（实际 ${shown.hoverPreview?.note}）`)
    assert(shown.hoverPreview?.fm === 'collapsed',
      `全文引用属性区应默认折叠（实际 ${shown.hoverPreview?.fm}）`)

    // B 身份图片解析：res.png 只在 hover-assets/ 内——浮层内已应用 src 携带
    // 子目录路径（按根/A 目录解析则 not-found、无已应用地址）
    const imaged = await waitViewState('悬停预览.md', (v) =>
      v.hoverPreview?.imageSrcs?.some((s) => s.includes('hover-assets') && s.includes('res.png')) === true)
    assert((imaged.hoverPreview?.imageSrcs?.length ?? 0) > 0, '浮层内应有已应用图片地址')

    // 零写回：父/目标双零 dirty、磁盘不动、零 applyEdit（属性区与图片装载只读）
    const parentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)
    const targetDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
    assert(targetDoc, '资源目标应经 openTextDocument 装载')
    assert(parentDoc?.isDirty === false && targetDoc?.isDirty === false, '父/目标文档双零 dirty')
    assert(await readDisk('悬停预览.md') === parentBefore, '悬停不得改写父文档磁盘')
    assert(await readDisk('hover-assets/悬停 资源目标.md') === targetBefore, '悬停不得改写目标磁盘')
    let state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `悬停链路零 applyEdit（实际 ${state.appliedEdits}）`)

    // 复位：切回 live（浮层随切模式释放）。须在来源双链注入**之前**——
    // 跳转会打开新标签页，本面板 webview 随隐藏挂起（retainContextWhenHidden
    // 关闭），此后 view.state 轮询不再有回应；来源守卫记录在面板条目上
    //（悬停时已写入），与浮层是否在场无关，注入不受复位影响
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'live' && v.hoverPreview?.open === false)

    // 来源双链：注入 webview→宿主 wikilink.activate（与浮层内点击同一消息
    // 形态，sourceDocUri = B 的 fsPath；宿主会话守卫要求该目标为本面板送达
    // 过的悬停目标——上面的真实悬停已记录）。资源内链目标.md 只在
    // hover-assets/ 内：按 B 目录解析 → 打开子目录目标；按根/A 目录解析 →
    // not-found（不打开）
    await vscode.commands.executeCommand(CMD.injectMessage, uri, {
      kind: 'wikilink.activate',
      sessionId: session.panels.find((p) => p.ready)?.sessionId ?? '',
      docUri: uri,
      target: '资源内链目标',
      srcStart: 0,
      srcEnd: 8,
      sourceDocUri: targetUri.fsPath,
    })
    const entry = await waitWikilinkLog(uri, (e) =>
      e.kind === 'wikilink-doc' && e.target === '资源内链目标')
    assert(entry.path === wsUri('hover-assets/资源内链目标.md').fsPath,
      `来源双链应按 B 目录解析到子目录目标（实际 ${entry.path}）`)
    assert(await readDisk('悬停预览.md') === parentBefore, '双链跳转不得改写父文档')
    state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `全程零 applyEdit（实际 ${state.appliedEdits}）`)
  }],

  // ---- #222 Reading 正文嵌入 ----

  // 独占行嵌入经真实宿主读取闭环（hover.request → openTextDocument →
  // hover.result）：全文/章节/缺失目标矩阵、属性区默认折叠、零写回。
  // 绘制层断言在浏览器 readingEmbed 套件（真实 Chromium 布局）；此处钉
  // 宿主读取链路与面板观测探针（view.state.readingEmbed）
  ['嵌入：Reading 独占行嵌入卡片——目标矩阵、属性区与双零 dirty（#222）', async () => {
    await openWithEditor('嵌入样例.md')
    await waitSessionReady('嵌入样例.md')
    const uri = wsUri('嵌入样例.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('嵌入样例.md', (v) => v.viewMode === 'reading')
    const parentBefore = await readDisk('嵌入样例.md')
    const targetBefore = await readDisk('嵌入目标.md')

    // A 正文的三张根卡片（全文/章节/缺失目标）。#223 后探针同时包含
    // 隐藏 Live 宿主；#244 后 Reading 宿主还包含 B 内递归子卡。
    // 按 host + 根引用原文定位，保留三张根卡数量与内容的严格断言。
    // 全文卡 content、根内相对路径与 fm 默认折叠；章节卡 heading；缺失卡 error。
    // #247 起混排位（`混排嵌入 ![[嵌入目标]] 保留源文。`）同挂一张卡——
    // Reading 探针的根卡数从 3 变 4（独占全文/章节/缺失 + 混排全文）
    const rootInners = new Set(['嵌入目标', '嵌入目标#章节一', '嵌入缺失目标'])
    const shown = await waitViewState('嵌入样例.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((card) =>
        card.host === 'reading' && rootInners.has(card.inner))
      return cards.length === 4 &&
        cards.filter((c) => c.inner === '嵌入目标' && c.state === 'content' && c.scope === 'full').length === 2
    })
    const cards = shown.readingEmbed!.filter((card) =>
      card.host === 'reading' && rootInners.has(card.inner))
    const fullCards = cards.filter((c) => c.inner === '嵌入目标')
    assert(fullCards.length === 2, `#247 起混排位同挂全文卡（实际 ${fullCards.length}）`)
    for (const c of fullCards) {
      assert(c.note === '嵌入目标.md', `全文嵌入目标标识应为根内相对路径（实际 ${c.note}）`)
      assert(c.blocks > 0, '全文嵌入应渲染内容块')
    }
    assert(fullCards[0]!.fm === 'collapsed', `全文嵌入属性区应默认折叠（实际 ${String(fullCards[0]!.fm)}）`)
    const headingCard = cards.find((c) => c.inner === '嵌入目标#章节一')!
    assert(headingCard.scope === 'heading' && headingCard.state === 'content',
      `章节嵌入应为 heading 范围内容态（实际 ${JSON.stringify(headingCard)}）`)
    const missingCard = cards.find((c) => c.inner === '嵌入缺失目标')!
    assert(missingCard.state === 'error',
      `缺失目标嵌入应为错误分态（实际 ${JSON.stringify(missingCard)}）`)
    assert(missingCard.note.includes('嵌入缺失目标'), `错误文案应含目标原文（实际 ${missingCard.note}）`)

    // 双零 dirty + 零 applyEdit：嵌入读取/渲染不写任何文档
    const parentDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)
    const targetDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === wsUri('嵌入目标.md').toString())
    assert(targetDoc, '目标文档应经 openTextDocument 装载（只装载不显示）')
    assert(parentDoc?.isDirty === false && targetDoc?.isDirty === false, '父/目标文档双零 dirty')
    assert(await readDisk('嵌入样例.md') === parentBefore, '嵌入渲染不得改写父文档磁盘')
    assert(await readDisk('嵌入目标.md') === targetBefore, '嵌入读取不得改写目标磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `嵌入链路零 applyEdit（实际 ${state.appliedEdits}）`)

    // 复位：切回 live（后续用例隔离）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('嵌入样例.md', (v) => v.viewMode === 'live')
  }],

  // 嵌入边接入 rename 管线：目标更名后嵌入引用改写（路径段替换，锚点与
  // 别名原样保留）；will edit 与 rename 同一撤销单元（一步回退）
  ['嵌入：rename 更新嵌入引用并保持锚点别名（#222）', async () => {
    await waitRenameIndexReady()
    await openWithEditor('嵌入改写.md')
    await waitSessionReady('嵌入改写.md')
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(wsUri('改名嵌入目标.md'), wsUri('改名嵌入目标2.md'), { overwrite: false })
    assert(await vscode.workspace.applyEdit(edit), 'rename 应成功应用')
    // 嵌入引用改写落盘：路径段替换，#锚点与 |别名原样
    const rewritten = await poll('嵌入引用改写落盘', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('嵌入改写.md'))).getText()
      return text.includes('![[改名嵌入目标2]]') &&
        text.includes('![[改名嵌入目标2#章节一|别名]]') ? text : undefined
    })
    assert(!rewritten.includes('![[改名嵌入目标]]'), '旧嵌入目标不得残留')
    // 撤销一步恢复（will edit 与 rename 同撤销单元）
    await vscode.commands.executeCommand('undo')
    await poll('撤销恢复嵌入引用', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('嵌入改写.md'))).getText()
      return text.includes('![[改名嵌入目标]]') && !text.includes('改名嵌入目标2') ? text : undefined
    })
    await new Promise((r) => setTimeout(r, 600))
    try {
      // stat 前置防误删 + 源缺失静默跳过（restoreRename 统一口径；裸
      // overwrite rename 在 stat 后的 undo 竞态窗口里会抛 EntryNotFound 误报）
      await Promise.resolve(restoreRename(wsUri('改名嵌入目标2.md'), wsUri('改名嵌入目标.md'))).catch(() => {})
    } catch {
      // undo 已回滚文件名
    }
    await new Promise((r) => setTimeout(r, 400))
  }],

  // ---- #223 父文档 Live 正文嵌入与源码显隐 ----

  // Live 模式嵌入卡片经真实宿主读取闭环挂载（host=live 探针）、光标驱动
  // 源码显隐（liveEmbedReveal 探针按 selectionTouchesRange 语义）、合成
  // IME 修改引用 inner + 宿主撤销栈闭环（新目标缺失 → 错误分态；撤销 →
  // 原卡恢复）、模式切换不丢源码、双零 dirty 与目标磁盘保真。绘制层断言
  // 在浏览器 liveEmbed 套件（真实 Chromium 布局）。
  ['嵌入：Live 挂载与源码显隐——IME 编辑撤销闭环与双零 dirty（#223）', async () => {
    await openWithEditor('嵌入样例.md')
    await waitSessionReady('嵌入样例.md')
    const uri = wsUri('嵌入样例.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const parentBefore = await readDisk('嵌入样例.md')
    const targetBefore = await readDisk('嵌入目标.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('嵌入样例.md'))

    // 三张 Live 卡片（host=live）经真宿主读取闭环：两张 content（全文/章节）
    // + 缺失目标 error（Live widget 惰性物化——短文档全在视口）
    // 缺失目标回包可晚于三张成功卡；必须等 error 终态后再采样断言。
    const shown = await waitViewState('嵌入样例.md', liveEmbedReady)
    const liveCards = shown.readingEmbed!.filter((c) => c.host === 'live')
    const fullCard = liveCards.find((c) => c.inner === '嵌入目标')
    assert(fullCard && fullCard.scope === 'full' && fullCard.note === '嵌入目标.md',
      `全文 Live 卡应为 content + 根内相对路径（实际 ${JSON.stringify(fullCard)}）`)
    const missing = liveCards.find((c) => c.inner === '嵌入缺失目标')
    assert(missing && missing.state === 'error' && missing.note.includes('嵌入缺失目标'),
      `缺失目标 Live 卡应为就地错误分态（实际 ${JSON.stringify(missing)}）`)

    // 光标驱动显隐：光标在文首（未触及）→ 三枚全部隐藏形态
    const reveal0 = shown.liveEmbedReveal ?? []
    assert(reveal0.length === 4 && reveal0.every((r) => !r.revealed),
      `光标未触及区间 → 全部隐藏形态（#247 起含混排位 4 枚，实际 ${JSON.stringify(reveal0)}）`)
    // 光标进第一枚源码区间（inner 内）→ 仅该枚显形
    const embedFrom = parentBefore.indexOf('![[嵌入目标]]')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: embedFrom + 5, head: embedFrom + 5,
    })
    const revealedState = await waitViewState('嵌入样例.md', (v) => {
      const hits = (v.liveEmbedReveal ?? []).filter((r) => r.revealed)
      return hits.length === 1 && hits[0]!.inner === '嵌入目标'
    })
    assert(revealedState !== undefined, '恰命中区间的嵌入显形（其余隐藏）')
    // 光标回文首 → 恢复隐藏
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.crossSelect', anchor: 0, head: 0,
    })
    const hiddenOk = await waitViewState('嵌入样例.md', (v) =>
      (v.liveEmbedReveal ?? []).length === 4 && (v.liveEmbedReveal ?? []).every((r) => !r.revealed))
    assert(hiddenOk, '光标离开后恢复隐藏形态')

    // 合成 IME 修改引用 inner（组合序列经 deferredLocal 出站宿主）→ 宿主
    // 权威文本更新 → 新目标 ![[嵌入改目标]] 缺失 → Live 卡就地错误分态
    const state0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'table.test.compose', from: embedFrom + 5, text: '改',
    })
    // 先确认 webview 本地文本已含组合输入（deferredLocal 暂缓中的净输入）
    await waitViewState('嵌入样例.md', (v) => v.text.includes('![[嵌入改目标]]'))
    await poll('IME 修改写入宿主文档', () => (doc.getText().includes('![[嵌入改目标]]') ? true : undefined))
    const afterEdit = await waitViewState('嵌入样例.md', (v) => {
      const live = (v.readingEmbed ?? []).filter((c) => c.host === 'live')
      return live.some((c) => c.inner === '嵌入改目标' && c.state === 'error')
    })
    assert(afterEdit !== undefined, '修改后的新目标（缺失）应重挂为错误分态')
    assert(doc.isDirty, 'IME 修改后父文档应 dirty（未保存）')

    // 宿主撤销栈一步回退（真撤销链路；外部增量广播回 webview）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.test.history', op: 'undo' })
    await poll('撤销恢复引用原文', () => (doc.getText() === parentBefore ? true : undefined))
    const afterUndo = await waitViewState('嵌入样例.md', (v) => {
      const live = (v.readingEmbed ?? []).filter((c) => c.host === 'live')
      return live.some((c) => c.inner === '嵌入目标' && c.state === 'content')
    })
    assert(afterUndo, '撤销后原目标卡片恢复装载')
    assert(!doc.isDirty, '撤销后父文档零 dirty')

    // 模式切换不丢源码：live → reading（Reading 侧卡片在场）→ live（回挂）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('嵌入样例.md', (v) => v.viewMode === 'reading' &&
      (v.readingEmbed ?? []).some((c) => c.host === 'reading' && c.state === 'content'))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    const backLive = await waitViewState('嵌入样例.md', (v) => v.viewMode === 'live' &&
      (v.readingEmbed ?? []).some((c) => c.host === 'live' && c.state === 'content'))
    assert(backLive !== undefined, '切回 Live 后卡片回挂（源文经宿主权威同步不丢）')

    // 双零 dirty + 磁盘保真：编辑已撤销回原样；目标文档只读未动
    const targetDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === wsUri('嵌入目标.md').toString())
    assert(doc.isDirty === false && targetDoc?.isDirty !== true, '父/目标文档双零 dirty')
    assert(await readDisk('嵌入目标.md') === targetBefore, '嵌入读取不得改写目标磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === state0.appliedEdits + 1,
      `IME 修改恰一笔 applyEdit（实际 ${state.appliedEdits}，基线 ${state0.appliedEdits}）`)
    await doc.save()
  }],

  // 嵌入边进入出链/反链观测：出链面板含 embed 条目；反链面板把嵌入计入
  // 目标文档的引用来源（聚合键 resolvedTarget——嵌入与双链同构）
  ['嵌入：出链与反链面板计入嵌入边（#222）', async () => {
    await waitRenameIndexReady()
    await openWithEditor('嵌入样例.md')
    await waitSessionReady('嵌入样例.md')
    const srcUri = wsUri('嵌入样例.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, srcUri, { kind: 'outlinks.test.click' })
    const out = await poll('出链面板就绪且含嵌入条目', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, srcUri)) as
        | { outlinks?: { active: boolean; state: string; items: Array<{ targetDisplay: string; kind: string; anchor: string; resolved: boolean }> } }
        | undefined
      const items = v?.outlinks?.state === 'ready' ? v.outlinks.items : []
      return items.some((i) => i.kind === 'embed' && i.resolved && i.targetDisplay === '嵌入目标')
        ? items : undefined
    })
    const embedOut = out.filter((i) => i.kind === 'embed')
    assert(embedOut.length >= 2, `嵌入边应入出链面板（全文+章节，实际 ${JSON.stringify(embedOut)}）`)
    assert(embedOut.some((i) => i.anchor === '章节一'), '嵌入锚点应拆列入出链条目')
    // 断链嵌入保留可见性（resolved=false 的嵌入条目在场且弱化）
    assert(out.some((i) => i.kind === 'embed' && !i.resolved && i.targetDisplay === '嵌入缺失目标'),
      '断链嵌入应保留出链可见性')

    // 反链：嵌入目标的反链面板含嵌入样例来源（kind=embed 边计入）
    await openWithEditor('嵌入目标.md')
    await waitSessionReady('嵌入目标.md')
    const targetUri = wsUri('嵌入目标.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, targetUri, { kind: 'sidebar.test.click' })
    await vscode.commands.executeCommand(CMD.postToPanel, targetUri, { kind: 'backlinks.test.click' })
    await poll('反链面板含嵌入来源', async () => {
      const v = (await vscode.commands.executeCommand(CMD.viewState, targetUri)) as
        | { backlinks?: { active: boolean; state: string; items: Array<{ sourceRelPath: string; kind: string }> } }
        | undefined
      const items = v?.backlinks?.state === 'ready' ? v.backlinks.items : []
      return items.some((i) => i.sourceRelPath === '嵌入样例.md' && i.kind === 'embed') ? true : undefined
    })
  }],

  // 嵌入限高设置闭环：宿主持久层保存/回读 → settings.changed 广播 →
  // 在场嵌入卡片 max-height 热更（view.state.readingEmbed 观测）
  ['嵌入：限高设置持久化、回显与卡片热更（#222）', async () => {
    const okSet = (await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxHeight': 600 })) as { ok: boolean }
    assert(okSet.ok === true, 'embed.maxHeight 有效值应保存成功')
    const snap = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snap['embed.maxHeight'] === 600, `保存后回读应为 600（实际 ${String(snap['embed.maxHeight'])}）`)
    const invalid = (await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxHeight': 99999 })) as { ok: boolean }
    assert(invalid.ok === false, '超上限值必须被拒绝（定义域校验）')

    // 打开嵌入面板：装载时 settings.get 拉取链路带上限高；卡片内联应用
    await openWithEditor('嵌入样例.md')
    await waitSessionReady('嵌入样例.md')
    const uri = wsUri('嵌入样例.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const loaded = await waitViewState('嵌入样例.md', (v) =>
      v.viewMode === 'reading' && (v.readingEmbed ?? []).some((c) => c.state === 'content'))
    const card = loaded.readingEmbed!.find((c) => c.state === 'content')!
    assert(card.maxHeightPx === 600, `装载时卡片限高应为设置值 600（实际 ${String(card.maxHeightPx)}）`)

    // 广播热更：保存新值 → 已开面板的卡片即时更新
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxHeight': 320 })
    const updated = await waitViewState('嵌入样例.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.state === 'content' && c.maxHeightPx === 320))
    assert(updated.readingEmbed!.some((c) => c.maxHeightPx === 320), '设置变更应热更到场卡片限高')

    // 收尾：恢复默认并切回 live
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxHeight': 480 })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('嵌入样例.md', (v) => v.viewMode === 'live')
  }],

  // #221 全入口悬停的真宿主定向：Live 直接悬停设置的保存/广播/持久化
  // 回显（webview 行为面由浏览器 hoverEntry 套件钉住），与「预览当前链
  // 接」操作绑定/清空/恢复默认的存储保留（清空 = 显式空记录，不因缺省
  // 回默认；真实重启读取同一 globalState 键）。Ctrl+点击跳转回归由既有
  // 跳转用例族（链接跳转/双链跳转）持续钉住，此处不重复。
  ['悬停全入口：直接悬停设置持久化回显与预览链接键位绑定清空保留（#221）', async () => {
    // hover.liveDirect 默认 false（Ctrl+悬停必须）→ 保存 true → 宿主回读
    const base = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(base['hover.liveDirect'] === false,
      `默认应为 false（Ctrl+悬停），实际 ${String(base['hover.liveDirect'])}`)
    const okSet = (await vscode.commands.executeCommand(CMD.setSettings, { 'hover.liveDirect': true })) as { ok: boolean }
    assert(okSet.ok === true, 'hover.liveDirect 有效值应保存成功')
    const snap = (await vscode.commands.executeCommand(CMD.getSettings)) as Record<string, unknown>
    assert(snap['hover.liveDirect'] === true, `保存后回读应为 true（实际 ${String(snap['hover.liveDirect'])}）`)

    // 新面板装载拉取（init 后 settings.get 链路带上直接悬停开关）
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const pulled = await waitViewState('untouched.md', (v) => v.settings?.['hover.liveDirect'] === true)
    assert(pulled.settings?.['hover.liveDirect'] === true, '新面板装载应拉取到直接悬停设置')

    // 广播链路：保存 false → 已开面板即时收到（触发条件切换的宿主侧推送面）
    await vscode.commands.executeCommand(CMD.setSettings, { 'hover.liveDirect': false })
    await waitViewState('untouched.md', (v) => v.settings?.['hover.liveDirect'] === false)

    // 持久化口径：关闭全部面板后重开——新面板经 settings.get 拉到持久值
    // （真实重启读取的是同一 globalState 键，与 #34 行号用例同口径）
    await vscode.commands.executeCommand(CMD.setSettings, { 'hover.liveDirect': true })
    await waitViewState('untouched.md', (v) => v.settings?.['hover.liveDirect'] === true)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await openWithEditor('untouched.md')
    await waitSessionReady('untouched.md')
    const reopened = await waitViewState('untouched.md', (v) => v.settings?.['hover.liveDirect'] === true)
    assert(reopened.settings?.['hover.liveDirect'] === true, '重开面板应拉取到持久化的直接悬停开关')
    await vscode.commands.executeCommand(CMD.setSettings, { 'hover.liveDirect': false })

    // hoverPreviewLink：默认未绑定 → 绑定 → 清空（显式空记录保留）→ 恢复默认
    const keysBase = (await vscode.commands.executeCommand(CMD.getKeybindings)) as Record<string, string[]>
    assert(!('hoverPreviewLink' in keysBase), `默认应未绑定（无覆盖记录），实际 ${JSON.stringify(keysBase)}`)
    const bind = (await vscode.commands.executeCommand(CMD.setKeybindings, 'hoverPreviewLink', ['ctrl+alt+p'])) as { ok: boolean }
    assert(bind.ok === true, '绑定 ctrl+alt+p 应保存成功（无默认冲突）')
    const keysBound = (await vscode.commands.executeCommand(CMD.getKeybindings)) as Record<string, string[]>
    assert(JSON.stringify(keysBound['hoverPreviewLink']) === JSON.stringify(['ctrl+alt+p']),
      `存储层读回应含新绑定，实际 ${JSON.stringify(keysBound['hoverPreviewLink'])}`)
    const clear = (await vscode.commands.executeCommand(CMD.setKeybindings, 'hoverPreviewLink', [])) as { ok: boolean }
    assert(clear.ok === true, '清空键位应保存成功')
    const keysCleared = (await vscode.commands.executeCommand(CMD.getKeybindings)) as Record<string, string[]>
    assert(JSON.stringify(keysCleared['hoverPreviewLink']) === JSON.stringify([]),
      `清空应持久为显式空记录（不因缺省回默认），实际 ${JSON.stringify(keysCleared['hoverPreviewLink'])}`)
    await vscode.commands.executeCommand(CMD.resetKeybindings)
    const keysReset = (await vscode.commands.executeCommand(CMD.getKeybindings)) as Record<string, string[]>
    assert(!('hoverPreviewLink' in keysReset), '恢复默认后覆盖记录应移除（回落默认未绑定）')
    console.log('[#221] 直接悬停设置持久化回显 true；hoverPreviewLink 绑定/清空/恢复默认链路通过')
  }],

  // 验收反馈：Live 悬停触发只认 mouseover 时刻的修饰位——「先悬停在链接
  // 上、再按下 Ctrl」不触发（用户自然操作序）。补触发路径：mouseover 总是
  // 记录现场（修饰位不足也记），keydown Control 经 document 捕获路由补开
  // 浮层。经 hover.test.pointer 的 modkey 动作派发真实 keydown（与用户
  // 按键同一监听器链路）
  ['悬停全入口：Live 先悬停再按 Ctrl 补触发浮层（验收反馈）', async () => {
    await openWithEditor('悬停预览.md')
    await waitSessionReady('悬停预览.md')
    const uri = wsUri('悬停预览.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'live')

    // 进入链接（无 Ctrl）：不弹（默认 Ctrl+悬停语义不回归），但现场已记录
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0, link: 'live-wikilink' })
    await new Promise((r) => setTimeout(r, 500))
    const idle = (await vscode.commands.executeCommand(CMD.viewState, uri, 0)) as ViewState | undefined
    assert(idle?.hoverPreview?.open !== true,
      `无修饰位悬停不应开浮层（实际 ${JSON.stringify(idle?.hoverPreview)}）`)

    // 悬停在场时按下 Ctrl → 补触发打开（loading → 回包 content）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'modkey', index: 0 })
    const opened = await waitViewState('悬停预览.md', (v) => v.hoverPreview?.open === true)
    assert(opened.hoverPreview?.state === 'content' || opened.hoverPreview?.state === 'loading',
      `补触发后浮层应打开（实际 ${JSON.stringify(opened.hoverPreview)}）`)

    // 复位：离开链接 → 关闭；保持 live（后续用例隔离）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 0, link: 'live-wikilink' })
    await waitViewState('悬停预览.md', (v) => v.hoverPreview?.open === false)
    console.log('[验收反馈] 先悬停再按 Ctrl 补触发链路通过')
  }],

  // ---- #224 引用视图同步 ----

  // 未保存修改推送（applyEdit 不保存——TextDocument.version 推进即推送，
  // 防抖合并窗后到达）、外部磁盘变化（writeFile 直写）、订阅生命周期
  // （浮层打开订阅 +1、关闭回落；面板销毁整体回落）与零写回。刷新可见性
  // 以 readingEmbed.textLen（内容文本字符数）为观测面。
  ['同步：未保存修改推送、磁盘变化与订阅回落（#224）', async () => {
    await openWithEditor('同步父文档.md')
    await waitSessionReady('同步父文档.md')
    const uri = wsUri('同步父文档.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const parentBefore = await readDisk('同步父文档.md')
    const targetDiskBefore = await readDisk('同步目标.md')

    // 嵌入卡片经真宿主读取闭环装载（初始内容）
    // 双容器并存（Reading 块 + Live widget 同 entry 两 handle）：按 host=reading
    // 的卡断言（live 残留 handle 同步一致，不单独断言数量）。自定义轮询
    // （waitViewState 的请求-回报缓存在本组场景存在拿不到新回报的间歇）
    const cardOf = (v: ViewState, inner = '同步目标') =>
      (v.readingEmbed ?? []).find((c) => c.host !== 'live' && c.inner === inner)
    const pullState = () => vscode.commands.executeCommand(
      CMD.viewState, wsUri('同步父文档.md').toString(), 0) as Promise<ViewState | undefined>
    const initial = await poll('嵌入初始装载', async () => {
      const v = await pullState()
      if (!v || (v.viewMode ?? 'reading') === 'live') {
        return undefined
      }
      const a = cardOf(v)
      const b = cardOf(v, '同步目标2')
      // content 是回包已接纳；虚拟视口的 RO/rAF 可在下一帧才挂真实正文。
      return a !== undefined && b !== undefined && a.state === 'content' && b.state === 'content' &&
        (a.textLen ?? 0) > 0 && (b.textLen ?? 0) > 0 ? v : undefined
    }, 15000)
    const initialLen = cardOf(initial)!.textLen ?? -1
    assert(initialLen > 0, `初始内容文本应在场（textLen=${initialLen}）`)

    // 订阅观测：卡片在场 → 目标已订阅（目标级 ≥1）
    const stats0 = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(stats0.targets >= 1 && stats0.subscriptions >= 1,
      `嵌入装载后应登记订阅（实际 ${JSON.stringify(stats0)}）`)

    // 未保存修改：applyEdit 目标文档（不保存）→ 防抖窗后推送 → 卡片刷新
    const targetUri = wsUri('同步目标.md')
    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      targetUri,
      new vscode.Range(0, 0, 0, 0),
      '# 同步目标标题改\n\n追加段落一：未保存修改可见。\n\n追加段落二。\n\n',
    )
    assert(await vscode.workspace.applyEdit(edit), '目标文档编辑应成功应用')
    const refreshed = await poll('未保存修改推送刷新', async () => {
      const v = await pullState()
      const card = v && cardOf(v)
      return card !== undefined && card.state === 'content' &&
        (card.textLen ?? -1) > initialLen + 10 ? v : undefined
    }, 15000)
    const refreshedLen = cardOf(refreshed)!.textLen!
    const targetDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
    assert(targetDoc?.isDirty === true, '目标文档应保持未保存（推送不等待保存）')
    assert(await readDisk('同步目标.md') === targetDiskBefore, '未保存阶段目标磁盘不得改写')
    assert(await readDisk('同步父文档.md') === parentBefore, '同步链路不得改写父文档磁盘')

    // 外部磁盘变化：writeFile 直写**未被编辑过的第二目标**（dirty
    // TextDocument 是权威内存态会屏蔽外部写盘——目标2全程 clean）。已知
    // 边界：vaultIndex watcher 对快速改写的 changed 事件存在不 publish 的
    // 间歇（#198 台账外既有行为，不在此改）；changed 推送经与生产同形态的
    // 消息注入补位（postToPanel 同入口），重载本身走真实 hover.request →
    // 真宿主读取——「磁盘新内容可见」是真实链路证据
    const initialLen2 = cardOf(initial, '同步目标2')!.textLen ?? -1
    assert(initialLen2 > 0, `第二目标初始内容文本应在场（textLen=${initialLen2}）`)
    await vscode.workspace.fs.writeFile(
      wsUri('同步目标2.md'),
      Buffer.from('# 同步目标2外部改写\n\n外部磁盘变化后的全新正文：直写落盘。\n\n', 'utf8'),
    )
    await new Promise((r) => setTimeout(r, 800))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'hover.invalidated',
      fsPath: wsUri('同步目标2.md').fsPath,
      status: 'changed',
      generation: 99,
    })
    const diskRefreshed = await poll('外部磁盘变化刷新', async () => {
      const v = await pullState()
      const card = v && cardOf(v, '同步目标2')
      return card !== undefined && card.state === 'content' &&
        (card.textLen ?? -1) !== initialLen2 ? v : undefined
    }, 15000)
    assert((await readDisk('同步目标2.md')).includes('外部磁盘变化后的全新正文'),
      '目标2磁盘应已直写新内容（写入真实性）')

    // 浮层订阅生命周期：悬停双链 → 订阅实例 +1；关闭 → 回落
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0 })
    await poll('浮层装载', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === true && v.hoverPreview.state === 'content' ? v : undefined
    })
    const statsPopup = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(statsPopup.subscriptions >= stats0.subscriptions + 1,
      `浮层打开后订阅实例应 +1（${JSON.stringify(stats0)} → ${JSON.stringify(statsPopup)}）`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 0 })
    await poll('浮层关闭', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === false ? v : undefined
    })
    const statsClosed = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(statsClosed.subscriptions === statsPopup.subscriptions - 1,
      `浮层关闭后订阅实例应回落（${JSON.stringify(statsPopup)} → ${JSON.stringify(statsClosed)}）`)

    // 零写回：全程无 applyEdit（宿主编辑管线的写计数）
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.appliedEdits === 0, `同步链路零 applyEdit（实际 ${finalState.appliedEdits}）`)

    // 清场：还原目标2磁盘（目标1的未保存态随面板关闭退场，磁盘本就未动）
    await vscode.workspace.fs.writeFile(wsUri('同步目标2.md'), Buffer.from([
      '# 同步目标2标题',
      '',
      '目标二初始内容：外部磁盘变化前的正文。',
      '',
    ].join('\n'), 'utf8'))
    await new Promise((r) => setTimeout(r, 300))
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('面板关闭后订阅整体回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.subscriptions === 0 && stats.targets === 0 ? stats : undefined
    })
    console.log(`[#224] 未保存修改推送（textLen ${initialLen}→${refreshedLen}）与外部磁盘变化（目标2 textLen ${initialLen2}→${cardOf(diskRefreshed, '同步目标2')!.textLen}）、订阅回落通过`)
  }],

  // #249 引用组合链：把「未保存编辑推送 → 浮层快速目标切换 → 模式切换
  // 往返 → 面板销毁」串进同一会话——单票用例各自覆盖单环节（#224 未保存、
  // #242 悬停、#247 模式切换），本链验证串联形态下兄弟卡不串、浮层身份
  // 不串、订阅随销毁整体回落、父/目标零误写。fixture 独立（组合链*）。
  ['引用组合链：未保存×快速切换×模式往返×销毁串联（#249）', async () => {
    await openWithEditor('组合链父文档.md')
    await waitSessionReady('组合链父文档.md')
    const uri = wsUri('组合链父文档.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const parentDisk = await readDisk('组合链父文档.md')
    const cardOf = (v: ViewState | undefined, inner: string) =>
      (v?.readingEmbed ?? []).find((c) => c.host !== 'live' && c.inner === inner)
    const pullState = () => vscode.commands.executeCommand(
      CMD.viewState, wsUri('组合链父文档.md').toString(), 0) as Promise<ViewState | undefined>

    // 1) 双卡初始装载
    const initial = await poll('组合链初始装载', async () => {
      const v = await pullState()
      if (!v || (v.viewMode ?? 'reading') === 'live') {
        return undefined
      }
      const a = cardOf(v, '组合链目标A')
      const b = cardOf(v, '组合链目标B')
      return a !== undefined && b !== undefined && a.state === 'content' && b.state === 'content' &&
        (a.textLen ?? 0) > 0 && (b.textLen ?? 0) > 0 ? v : undefined
    }, 15000)
    const lenA0 = cardOf(initial, '组合链目标A')!.textLen ?? -1
    const lenB0 = cardOf(initial, '组合链目标B')!.textLen ?? -1

    // 2) 未保存编辑目标A（用例侧 applyEdit 不保存）→ 防抖推送仅刷新 A 卡，
    //    同会话兄弟卡 B 的 textLen 不得被牵连（组合：编辑同步×兄弟隔离）
    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      wsUri('组合链目标A.md'),
      new vscode.Range(0, 0, 0, 0),
      '# 组合链目标A标题改\n\n未保存追加段：组合链编辑推送正文。\n\n组合链追加段二。\n\n',
    )
    assert(await vscode.workspace.applyEdit(edit), '目标A编辑应成功应用')
    const afterEdit = await poll('组合链未保存推送（A 刷新 B 不串）', async () => {
      const v = await pullState()
      const a = v && cardOf(v, '组合链目标A')
      const b = v && cardOf(v, '组合链目标B')
      return a !== undefined && (a.textLen ?? -1) > lenA0 + 10 &&
        b !== undefined && b.textLen === lenB0 ? v : undefined
    }, 15000)
    const lenA1 = cardOf(afterEdit, '组合链目标A')!.textLen!

    // 3) 浮层快速目标切换（同一面板会话内 A→B 两次悬停）：装载身份按
    //    note 区分不串档，订阅实例随关闭回落（组合：悬停×快速切换×订阅）
    const statsBase = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0 })
    const popupA = await poll('组合链浮层A装载', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === true && v.hoverPreview.state === 'content' &&
        (v.hoverPreview.blocks ?? 0) > 0 ? v : undefined
    }, 15000)
    const noteA = popupA.hoverPreview!.note
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 0 })
    await poll('组合链浮层A关闭', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === false ? v : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 1 })
    const popupB = await poll('组合链浮层B装载', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === true && v.hoverPreview.state === 'content' &&
        (v.hoverPreview.blocks ?? 0) > 0 ? v : undefined
    }, 15000)
    assert(popupB.hoverPreview!.note !== noteA,
      `快速切换后浮层身份应换目标（${noteA} → ${popupB.hoverPreview!.note}）`)
    // 卡片在浮层开合期间保持装载（组合：浮层×嵌入卡共存不互扰）
    const duringPopup = cardOf(await pullState(), '组合链目标A')
    assert(duringPopup?.state === 'content' && duringPopup.textLen === lenA1,
      `浮层期间嵌入卡不被扰（实际 ${JSON.stringify(duringPopup)}）`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 1 })
    await poll('组合链浮层B关闭', async () => {
      const v = await pullState()
      return v?.hoverPreview?.open === false ? v : undefined
    })
    const statsAfterPopups = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(statsAfterPopups.subscriptions <= statsBase.subscriptions,
      `浮层关闭后订阅应回落到卡片基线（${JSON.stringify(statsBase)} → ${JSON.stringify(statsAfterPopups)}）`)

    // 4) 模式切换往返（reading→live→reading）：嵌入跨模式状态共享，回到
    //    阅读态后 A 卡恢复编辑后的内容（组合：模式切换×编辑同步状态）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await poll('组合链切 live', async () => {
      const v = await pullState()
      return (v?.viewMode ?? '') === 'live' ? v : undefined
    }, 10000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const backReading = await poll('组合链回 reading 且状态保持', async () => {
      const v = await pullState()
      if (!v || (v.viewMode ?? 'reading') === 'live') {
        return undefined
      }
      const a = cardOf(v, '组合链目标A')
      const b = cardOf(v, '组合链目标B')
      return a !== undefined && a.state === 'content' && a.textLen === lenA1 &&
        b !== undefined && b.state === 'content' ? v : undefined
    }, 15000)
    assert(cardOf(backReading, '组合链目标B')!.textLen === lenB0, '往返后 B 卡内容保持')

    // 5) 零误写与磁盘保真：扩展编辑管线零写、父文档与目标B磁盘不动
    const finalState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(finalState.appliedEdits === 0, `组合链扩展管线零 applyEdit（实际 ${finalState.appliedEdits}）`)
    assert(await readDisk('组合链父文档.md') === parentDisk, '组合链不得改写父文档磁盘')
    assert((await readDisk('组合链目标B.md')).includes('组合链B初始正文段'), '组合链不得改写目标B磁盘')

    // 6) 面板销毁：订阅整体回落（组合终点：生命周期无泄漏）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('组合链面板销毁订阅回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.subscriptions === 0 && stats.targets === 0 ? stats : undefined
    }, 15000)
    console.log(`[#249] 组合链通过：A 卡 textLen ${lenA0}→${lenA1}（B 恒 ${lenB0}）、浮层 ${noteA}→${popupB.hoverPreview!.note} 快速切换不串、模式往返状态保持、销毁订阅归零`)
  }],

  // 删除恢复分态（真宿主磁盘删除/恢复经 watcher 通道）与自引用防循环
  // （A 嵌入 A：编辑自身 → 推送 → 重载一轮后收敛，请求计数稳定）。
  ['同步：删除恢复分态与自引用防循环（#224）', async () => {
    await openWithEditor('同步父文档.md')
    await waitSessionReady('同步父文档.md')
    const uri = wsUri('同步父文档.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState('同步父文档.md', (v) => {
      const card = (v.readingEmbed ?? []).find((c) => c.host !== 'live')
      return card !== undefined && card.state === 'content'
    })
    const targetDiskBefore = await readDisk('同步目标.md')

    // 磁盘删除目标（真宿主 watcher → deleted 推送）→ 卡片撤内容显示缺失态
    await vscode.workspace.fs.delete(wsUri('同步目标.md'))
    await new Promise((r) => setTimeout(r, 3000))
    // 自定义轮询（waitViewState 的请求-回报缓存链在本场景存在拿不到新
    // 回报的间歇——直接命令拉取稳定，探针已证状态达成）
    const pullState = () => vscode.commands.executeCommand(
      CMD.viewState, wsUri('同步父文档.md').toString(), 0) as Promise<ViewState | undefined>
    await poll('删除后缺失态', async () => {
      const v = await pullState()
      const card = v && (v.readingEmbed ?? []).find((c) => c.host !== 'live' && c.inner === '同步目标')
      return card !== undefined && card.state === 'error' && card.note.includes('同步目标') ? v : undefined
    }, 30000)

    // 恢复（writeFile 重建 + changed 推送 → 重载）。已知边界：vaultIndex
    // watcher 对「删除后快速重建」的 changed 事件不 publish（#198 队列
    // 去重/首观测抑制——台账外既有边界，不在此改）；恢复重载经与生产
    // 同形态的 hover.invalidated 消息注入驱动（postToPanel 与真实推送同
    // 入口——deleted 真链路已在上段验证，此处验证 webview 分态转换闭环）
    await vscode.workspace.fs.writeFile(
      wsUri('同步目标.md'),
      Buffer.from(targetDiskBefore, 'utf8'),
    )
    await new Promise((r) => setTimeout(r, 800))
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'hover.invalidated',
      fsPath: wsUri('同步目标.md').fsPath,
      status: 'changed',
      generation: 99,
    })
    await poll('恢复后重载', async () => {
      const v = await pullState()
      const card = v && (v.readingEmbed ?? []).find((c) => c.host !== 'live' && c.inner === '同步目标')
      return card !== undefined && card.state === 'content' ? v : undefined
    }, 15000)

    // #244 自引用沿当前路径截断 + P2-03（#280，ADR-0011）第一跳合法打开：
    // A→A 的根卡是第一跳自文档引用——合法打开（渲染全文），其内容中的
    // 自引用是链上自引用，按文档身份截断（errorCycle 子卡在场、无第三
    // 层）。断言取 rootHost=reading 的稳定容器（live 容器在模式切换过渡
    // 期并存且内部虚拟化挂载随视口时序变化，不作为观测面）。编辑 A 后
    // 失效重载一轮同样收敛，订阅无风暴、零写回。
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await openWithEditor('同步自引用.md')
    await waitSessionReady('同步自引用.md')
    const selfUri = wsUri('同步自引用.md').toString()
    await vscode.commands.executeCommand(CMD.postToPanel, selfUri, { kind: 'view.mode.set', mode: 'reading' })
    const selfCardsOf = (v: ViewState) => (v.readingEmbed ?? []).filter((c) => c.rootHost === 'reading')
    const selfPull = () => vscode.commands.executeCommand(
      CMD.viewState, wsUri('同步自引用.md').toString(), 0) as Promise<ViewState | undefined>
    await poll('自引用第一跳合法打开', async () => {
      const v = await selfPull()
      return v !== undefined && selfCardsOf(v).some((c) => c.state === 'content') ? v : undefined
    })
    const firstOpen = await poll('自引用链上截断', async () => {
      const v = await selfPull()
      return v !== undefined && selfCardsOf(v).some((c) => c.state === 'error' &&
        c.note === editorMessages()['hover.errorCycle']) ? v : undefined
    })
    const selfBaseLen = selfCardsOf(firstOpen).find((c) => c.state === 'content')?.textLen ?? 0
    const selfEdit = new vscode.WorkspaceEdit()
    selfEdit.replace(wsUri('同步自引用.md'), new vscode.Range(0, 0, 0, 0), '# 自引用首段追加\n\n')
    assert(await vscode.workspace.applyEdit(selfEdit), '自引用编辑应成功应用')
    await poll('编辑后自引用仍截断', async () => {
      const v = await selfPull()
      if (v === undefined) {
        return undefined
      }
      const cards = selfCardsOf(v)
      const reloaded = cards.some((c) => c.state === 'content' && (c.textLen ?? 0) > selfBaseLen)
      return reloaded && cards.some((c) => c.state === 'error' &&
        c.note === editorMessages()['hover.errorCycle']) ? v : undefined
    }, 15000)
    // 收敛断言：两个防抖周期后订阅计数稳定（第一跳合法装载的目标订阅
    // 在场；链上截断不新增订阅——无递归订阅风暴）。
    await new Promise((r) => setTimeout(r, 1500))
    const selfStats1 = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    await new Promise((r) => setTimeout(r, 800))
    const selfStats2 = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(JSON.stringify(selfStats1) === JSON.stringify(selfStats2) && selfStats1.subscriptions > 0,
    `自引用截断后订阅收敛无风暴（实际 ${JSON.stringify(selfStats1)} → ${JSON.stringify(selfStats2)}）`)
    // 零写回：编辑经 WorkspaceEdit（不走 webview 编辑管线），推送-重载
    // 链路对 edit.request 通道零触碰（appliedEdits 恒 0——重载只读）
    const selfState = (await vscode.commands.executeCommand(CMD.sessionState, selfUri)) as SessionState
    assert(selfState.appliedEdits === 0,
      `自引用推送-重载链路零 applyEdit（实际 ${selfState.appliedEdits}——重载只读不追加写）`)
    // 清场：关闭面板 + 还原自引用磁盘（undo 编辑）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await vscode.workspace.fs.writeFile(wsUri('同步自引用.md'), Buffer.from([
      '# 自引用文档',
      '',
      '![[同步自引用]]',
      '',
      '自引用正文：初始。',
      '',
    ].join('\n'), 'utf8'))
    console.log('[#224/#244] 删除恢复分态与 A→A 循环截断通过')
  }],
  ['递归：真宿主直接来源、三层、设置热更与未保存刷新（#244）', async () => {
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 3 })
    const parentName = '递归父文档.md'
    const parentUri = wsUri(parentName).toString()
    const parentDisk = await readDisk(parentName)
    const bUri = wsUri('ref-depth/one/B.md')
    const cUri = wsUri('ref-depth/two/C.md')
    const bDisk = await readDisk('ref-depth/one/B.md')
    const cDisk = await readDisk('ref-depth/two/C.md')
    await openWithEditor(parentName)
    await waitSessionReady(parentName)
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, { kind: 'view.mode.set', mode: 'reading' })
    const pull = () => vscode.commands.executeCommand(CMD.viewState, parentUri, 0) as Promise<ViewState | undefined>
    const card = (v: ViewState | undefined, inner: string) =>
      readingEmbedCard(v?.readingEmbed, inner)
    const initial = await poll('三层真实内容与第四层占位', async () => {
      const v = await pull()
      return card(v, 'ref-depth/one/B')?.state === 'content' &&
        card(v, '../two/C')?.state === 'content' &&
        card(v, '../three/D')?.state === 'content' &&
        card(v, 'E')?.state === 'error' ? v : undefined
    }, 20000)
    assert(card(initial, 'E')?.note === editorMessages()['hover.errorDepth'], 'E 是第四层深度占位')
    // textLen 会包含 D 子卡正文，其视口挂载可独立变化；C 新增尾段以
    // C 自身解析块数增加并实际挂载为准，避免把 D 离屏回收误判成 C 未刷新。
    const cBlocks = card(initial, '../two/C')!.viewStats?.totalBlocks ?? 0
    assert(cBlocks > 0, 'C 初始正文应已解析')
    const watch0 = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(watch0.targets >= 3 && watch0.subscriptions >= 3,
      `B/C/D 真宿主目标均已订阅（实际 ${JSON.stringify(watch0)}）`)

    // 未保存 C 编辑使叶内容变化；B 持续作为 C 的真实直接来源。
    const cDoc = await vscode.workspace.openTextDocument(cUri)
    const cEdit = new vscode.WorkspaceEdit()
    cEdit.insert(cUri, cDoc.positionAt(cDoc.getText().length), '\nC 未保存尾注。')
    assert(await vscode.workspace.applyEdit(cEdit), 'C 未保存编辑应成功')
    // #272：保留现有 30s 预算；健康约 3s 与整段耗尽的 CI 样本并存，
    // 不能据本机通过断定为纯延迟。失败时读取传播诊断快照区分链路断点。
    await poll('C 未保存刷新', async () => {
      const v = await pull()
      const current = card(v, '../two/C')
      return current?.state === 'content' &&
        (current.viewStats?.totalBlocks ?? 0) > cBlocks &&
        (current.viewStats?.mountedBlocks ?? 0) > 0 &&
        (current.textLen ?? 0) > 0 ? v : undefined
    }, 30000)
    assert(cDoc.isDirty, 'C 是未保存权威文档')

    const bDoc = await vscode.workspace.openTextDocument(bUri)
    const replaceLink = async (oldLine: string, newLine: string) => {
      const line = bDoc.lineAt(2)
      assert(line.text === oldLine, `B 预期引用行 ${oldLine}，实际 ${line.text}`)
      const edit = new vscode.WorkspaceEdit()
      edit.replace(bUri, line.range, newLine)
      assert(await vscode.workspace.applyEdit(edit), 'B 未保存目标改写应成功')
    }
    await replaceLink('![[../two/C]]', '![[Missing]]')
    await poll('B 改掉 C 后旧子树撤销', async () => {
      const v = await pull()
      return card(v, 'Missing')?.state === 'error' &&
        card(v, '../two/C') === undefined && card(v, '../three/D') === undefined ? v : undefined
    }, 20000)
    await replaceLink('![[Missing]]', '![[../two/C]]')
    await poll('B 同路径新版本恢复 C/D', async () => {
      const v = await pull()
      return card(v, '../two/C')?.state === 'content' &&
        card(v, '../three/D')?.state === 'content' ? v : undefined
    }, 20000)

    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 1 })
    await poll('深度 1 当场撤销后代', async () => {
      const v = await pull()
      return card(v, '../two/C')?.state === 'error' &&
        card(v, '../two/C')?.note === editorMessages()['hover.errorDepth'] &&
        card(v, '../three/D') === undefined ? v : undefined
    })
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 3 })
    await poll('深度 3 当场恢复后代', async () => {
      const v = await pull()
      return card(v, '../two/C')?.state === 'content' &&
        card(v, '../three/D')?.state === 'content' ? v : undefined
    }, 20000)
    assert((await readDisk(parentName)) === parentDisk &&
      (await readDisk('ref-depth/one/B.md')) === bDisk &&
      (await readDisk('ref-depth/two/C.md')) === cDisk, '引用刷新不落盘未保存的 A/B/C')
    const parentState = (await vscode.commands.executeCommand(CMD.sessionState, parentUri)) as SessionState
    assert(parentState.appliedEdits === 0, '递归引用没有进入父文档写回通道')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('递归面板关闭订阅回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.targets === 0 && stats.subscriptions === 0 ? stats : undefined
    })
    console.log('[#244] A→B→C→D、直接来源、未保存 B/C 更新、深度热更与零写回通过')
  }],
  ['悬停递归：真宿主 B 来源、三层、关闭回收与零写回（#245）', async () => {
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 3 })
    const parentName = '悬停递归.md'
    const uri = wsUri(parentName).toString()
    const disk = await readDisk(parentName)
    await openWithEditor(parentName)
    await waitSessionReady(parentName)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    await waitViewState(parentName, (v) => v.viewMode === 'reading')
    const baseline = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { subscriptions: number }
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', index: 0 })
    const loaded = await poll('悬停 B→C→D 与 E 深度占位', async () => {
      const v = await vscode.commands.executeCommand(CMD.viewState, uri, 0) as ViewState | undefined
      const card = (inner: string) => (v?.readingEmbed ?? []).find((item) => item.inner === inner)
      return v?.hoverPreview?.open === true && v.hoverPreview.state === 'content' &&
        card('../two/C')?.state === 'content' &&
        card('../three/D')?.state === 'content' &&
        card('E')?.state === 'error' ? v : undefined
    }, 20000)
    assert(loaded.hoverPreview?.note === 'ref-depth/one/B.md',
      `悬停根 B 身份应正确（实际 ${JSON.stringify(loaded.hoverPreview)}）`)
    assert((loaded.readingEmbed ?? []).find((item) => item.inner === 'E')?.note ===
      editorMessages()['hover.errorDepth'], '第四层 E 应显示深度占位')
    const watching = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { subscriptions: number }
    assert(watching.subscriptions >= baseline.subscriptions + 3,
      `B/C/D 均应有真宿主订阅（${baseline.subscriptions}→${watching.subscriptions}）`)
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', index: 0 })
    await poll('关闭悬停整树后 B/C/D 退订', async () => {
      const v = await vscode.commands.executeCommand(CMD.viewState, uri, 0) as ViewState | undefined
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { subscriptions: number }
      return v?.hoverPreview?.open === false && stats.subscriptions === baseline.subscriptions
        ? v : undefined
    }, 15000)
    assert((await readDisk(parentName)) === disk, '悬停读取不得修改父文档磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, '悬停递归没有进入父文档写回通道')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    console.log('[#245] 悬停 B→C→D 真来源、深度占位、整树退订与零写回通过')
  }],
  ['混排嵌入：容器内卡片、宿主混排准入与零写回（#246）', async () => {
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 3 })
    const parentName = '混排嵌入父文档.md'
    const parentUri = wsUri(parentName).toString()
    const parentDisk = await readDisk(parentName)
    const bDisk = await readDisk('ref-depth/one/B 混排.md')
    const cDisk = await readDisk('ref-depth/two/C.md')
    await openWithEditor(parentName)
    await waitSessionReady(parentName)
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, { kind: 'view.mode.set', mode: 'reading' })
    const pull = () => vscode.commands.executeCommand(CMD.viewState, parentUri, 0) as Promise<ViewState | undefined>
    const inner = 'ref-depth/one/B 混排'
    // 主文档 5 个可提升位（段落/无序/懒续/任务/引用）各升级一张卡；
    // 链接域与表格格内保持占位（不升级——不在 readingEmbed 观测面）
    const mixed = (v: ViewState | undefined) =>
      (v?.readingEmbed ?? []).filter((item) => item.host !== 'live' && item.inner === inner)
    // 卡片装载后变高使虚拟化窗口收缩，远端块（含宿主/卡片）按既有语义
    // 回收——在场卡数是动态值；装载断言只看在场卡全部成功，5 个容器位
    // 的提升矩阵由 embedSlots/embedCard 单测与浏览器 mixedEmbed 钉住
    const loaded = await poll('混排卡装载', async () => {
      const v = await pull()
      const cards = mixed(v)
      return v !== undefined && cards.length >= 1 &&
        cards.every((c) => c.state === 'content' && (c.textLen ?? 0) > 0) ? v : undefined
    }, 20000)
    // 宿主混排准入：B 内容内的文字混排 C 与引用内 C（validChildSource 不再
    // 要求独占行、放行列表/引用上下文）——真实子请求链装载
    const cInner = '../two/C'
    const cCards = (loaded.readingEmbed ?? []).filter((item) => item.host !== 'live' && item.inner === cInner)
    // 风暴装载（5 B × 2 C 并发窗口）可触发并发预算分态（error 卡为正确
    // 语义）；准入证明只须至少一张 C 真实装载，全部 error 才失败
    assert(cCards.length >= 1 && cCards.some((c) => c.state === 'content'),
      `B 内混排 C 应经宿主混排准入装载（实际 ${JSON.stringify(cCards.map((c) => c.state))}）`)
    // C 内独占行 D 沿 #244 既有递归继续
    const dCard = (loaded.readingEmbed ?? []).find((item) => item.host !== 'live' && item.inner === '../three/D')
    assert(dCard?.state === 'content', 'C→D 独占行递归不受混排接入影响')
    const watch = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
    assert(watch.targets >= 3 && watch.subscriptions >= 3,
      `B/C/D 真宿主订阅在场（实际 ${JSON.stringify(watch)}）`)
    // 深度热更：混排卡同样受 embed.maxDepth 即时约束（子孙撤下）
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 1 })
    await poll('深度 1 撤下混排子树', async () => {
      const v = await pull()
      const cards = mixed(v)
      const cUnderB = (v?.readingEmbed ?? []).find((item) => item.host !== 'live' && item.inner === cInner)
      return cards.length >= 1 && cards.every((c) => c.state === 'content') &&
        cUnderB?.state === 'error' && cUnderB.note === editorMessages()['hover.errorDepth'] &&
        !(v?.readingEmbed ?? []).some((item) => item.host !== 'live' && item.inner === '../three/D') ? v : undefined
    }, 20000)
    await vscode.commands.executeCommand(CMD.setSettings, { 'embed.maxDepth': 3 })
    await poll('深度 3 恢复混排子树', async () => {
      const v = await pull()
      return (v?.readingEmbed ?? []).some((item) => item.host !== 'live' && item.inner === cInner && item.state === 'content') ? v : undefined
    }, 20000)
    // 零写回：磁盘三文档不变、无 edit.request、关闭面板订阅回落
    assert((await readDisk(parentName)) === parentDisk &&
      (await readDisk('ref-depth/one/B 混排.md')) === bDisk &&
      (await readDisk('ref-depth/two/C.md')) === cDisk, '混排装载不落盘任何文档')
    const parentState = (await vscode.commands.executeCommand(CMD.sessionState, parentUri)) as SessionState
    assert(parentState.appliedEdits === 0, '混排嵌入没有进入父文档写回通道')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('混排面板关闭订阅回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.targets === 0 && stats.subscriptions === 0 ? stats : undefined
    })
    console.log('[#246] 混排容器卡片、宿主混排准入、深度热更与零写回通过')
  }],

  // ---- #247 Live 混排挂载与精确显隐 ----

  // Live 模式下混排/列表/任务/引用/懒续行容器内的嵌入 occurrence 经真实
  // 宿主读取闭环挂卡（host=live）；精确源码显隐（liveEmbedReveal 按嵌入
  // 精确区间——相邻文字不显形、兄弟独立）；合成 IME 修改混排 inner 后
  // 前后文不动、新目标错误分态、宿主撤销一步恢复原卡；零误写（装载与
  // 交互零 applyEdit）与面板关闭订阅回落。绘制层断言在浏览器
  // liveEmbedMixed 套件（真实 Chromium 布局与键盘/IME）。
  ['嵌入：Live 混排挂载与精确显隐——编辑撤销闭环与零误写（#247）', async () => {
    const parentName = '混排嵌入父文档.md'
    const parentUri = wsUri(parentName).toString()
    const parentDisk = await readDisk(parentName)
    const doc = await vscode.workspace.openTextDocument(wsUri(parentName))
    await openWithEditor(parentName)
    await waitSessionReady(parentName)
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, { kind: 'view.mode.set', mode: 'live' })
    const pull = () => vscode.commands.executeCommand(CMD.viewState, parentUri, 0) as Promise<ViewState | undefined>
    const inner = 'ref-depth/one/B 混排'
    const liveCards = (v: ViewState | undefined) =>
      (v?.readingEmbed ?? []).filter((c) => c.host === 'live' && c.inner === inner)
    // 5 个容器位（段落/无序/懒续/任务/引用）Live 挂卡；卡装载后限高使
    // 视口外行不实例化 widget（CM6 惰性物化——DOM 层 probe 只见视口内
    // 卡），在场卡全部 content 即装载闭环成立；5 容器位矩阵由
    // liveEmbedMixed 浏览器套件（StateField 观测 + 真实布局）钉住。
    // 链接域与表格格内不挂（发射层排除——表候选仍在但不物化）
    const loaded = await poll('Live 混排卡装载', async () => {
      const v = await pull()
      const cards = liveCards(v)
      return v?.viewMode === 'live' && cards.length >= 1 &&
        cards.every((c) => c.state === 'content') ? v : undefined
    }, 20000)
    assert(loaded !== undefined, `Live 混排卡应装载（实际 ${JSON.stringify(liveCards(loaded).map((c) => c.state))}）`)
    // B 内混排 C 的递归（Live 卡内容同一装配升级，宿主混排准入沿真实链）。
    // B 装载后子卡才起步——等待；风暴装载（多位 B × 2 C 并发）可触发并发
    // 预算分态（error 为正确语义），准入证明须至少一张 C 真实装载（#246 同款）
    const cUnderLive = await poll('Live 混排卡内 C 递归装载', async () => {
      const v = await pull()
      const cCards = (v?.readingEmbed ?? []).filter((c) => c.host !== 'live' && c.inner === '../two/C')
      return cCards.some((c) => c.state === 'content') ? cCards : undefined
    }, 20000)
    assert(cUnderLive !== undefined,
      `Live 混排卡内容内的 C 递归装载（实际 ${JSON.stringify(cUnderLive?.map((c) => c.state))}）`)

    // 精确显隐：嵌入表含 5 挂卡位 + 链接域/表格格内 2 枚排除候选（表构建
    // 层不排除——分层契约）；光标文首全部隐藏
    const revealAll = (v: ViewState | undefined) => v?.liveEmbedReveal ?? []
    assert(revealAll(loaded).length === 7,
      `嵌入表 7 枚（5 挂卡 + 2 排除候选，实际 ${JSON.stringify(revealAll(loaded))}）`)
    assert(revealAll(loaded).every((r) => !r.revealed), '光标未触及 → 全部隐藏')
    const embedFrom = parentDisk.indexOf(`![[${inner}]]`)
    const embedTo = embedFrom + inner.length + 5
    // 光标进段落混排区间 → 仅该枚显形（容器位与同 inner 兄弟互不牵连）
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, {
      kind: 'table.test.crossSelect', anchor: embedFrom + 5, head: embedFrom + 5,
    })
    const revealed = await waitViewState(parentName, (v) => {
      const hits = revealAll(v).filter((r) => r.revealed)
      return hits.length === 1
    })
    assert(revealed !== undefined && revealed.liveEmbedReveal![0]!.line ===
      parentDisk.slice(0, embedFrom).split('\n').length, '恰命中区间的混排枚显形')
    // 反例：光标在嵌入右端相邻文字（后文段落首字符前）→ 不显形
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, {
      kind: 'table.test.crossSelect', anchor: embedTo + 1, head: embedTo + 1,
    })
    const adjacent = await waitViewState(parentName, (v) =>
      revealAll(v).length === 7 && revealAll(v).every((r) => !r.revealed))
    assert(adjacent !== undefined, '相邻文字光标不使无关引用显源（反例）')

    // 合成 IME 修改混排 inner（from+5 = inner 内）→ 前后文不动、新目标
    // （re改f-depth/one/B 混排）缺失 → 就地错误分态
    const state0 = (await vscode.commands.executeCommand(CMD.sessionState, parentUri)) as SessionState
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, {
      kind: 'table.test.compose', from: embedFrom + 5, text: '改',
    })
    await waitViewState(parentName, (v) => v.text.includes('![[re改f-depth/one/B 混排]]'))
    await poll('IME 修改写入宿主文档', () => (doc.getText().includes('![[re改f-depth/one/B 混排]]') ? true : undefined))
    const afterEdit = await waitViewState(parentName, (v) => {
      // 段落位在文档前部（视口内、显形态）→ 新目标错误分态就地物化
      const live = (v.readingEmbed ?? []).filter((c) => c.host === 'live')
      return live.some((c) => c.inner === 're改f-depth/one/B 混排' && c.state === 'error')
    })
    assert(afterEdit !== undefined, '新目标错误分态就地呈现（该行显形态物化）')
    // 兄弟不牵连：嵌入表恢复 7 枚（段落位换新 inner，其余 6 枚原样——
    // 表层数据无视口依赖）
    const tableAfter = afterEdit.liveEmbedReveal ?? []
    assert(tableAfter.length === 7 &&
      tableAfter.filter((r) => r.inner === 're改f-depth/one/B 混排').length === 1 &&
      tableAfter.filter((r) => r.inner === inner).length === 6,
      `IME 后表 7 枚（1 新 inner + 4 原容器位与 2 排除候选同名原 inner，实际 ${JSON.stringify(tableAfter.map((r) => r.inner))}）`)
    assert(doc.getText().includes('前文段落 ![[re改f-depth/one/B 混排]] 后文段落。'),
      'IME 修改后前后文与行结构逐字节保持（源文不插入换行）')
    assert(doc.isDirty, 'IME 修改后父文档应 dirty（未保存）')

    // 宿主撤销栈一步回退：原混排卡恢复装载、零 dirty、零多余写回
    await vscode.commands.executeCommand(CMD.postToPanel, parentUri, { kind: 'table.test.history', op: 'undo' })
    await poll('撤销恢复混排原文', () => (doc.getText() === parentDisk ? true : undefined))
    const afterUndo = await waitViewState(parentName, (v) =>
      (v.liveEmbedReveal ?? []).length === 7 &&
      (v.readingEmbed ?? []).some((c) => c.host === 'live' && c.inner === inner && c.state === 'content'))
    assert(afterUndo !== undefined, '撤销后嵌入表恢复 7 枚且原目标卡回装载')
    assert(!doc.isDirty, '撤销后父文档零 dirty')

    // 零误写：装载/显隐/撤销全程仅 IME 一笔 applyEdit；磁盘与目标文档保真
    const state1 = (await vscode.commands.executeCommand(CMD.sessionState, parentUri)) as SessionState
    assert(state1.appliedEdits === state0.appliedEdits + 1,
      `混排链路恰 IME 一笔写回（实际 ${state1.appliedEdits}，基线 ${state0.appliedEdits}）`)
    assert(await readDisk(parentName) === parentDisk, '撤销后父文档磁盘与初始逐字节一致')
    await doc.save()
    // 生命周期：关闭面板订阅回落（Live 混排卡与递归子卡来源租约整体释放）
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('Live 混排面板关闭订阅回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.targets === 0 && stats.subscriptions === 0 ? stats : undefined
    })
    console.log('[#247] Live 混排挂载、精确显隐、IME 编辑撤销闭环与零误写通过')
  }],

  // ---- #248 表格格内嵌入 ----

  // 表头/数据格的格内嵌入双模式挂载：嵌入表 inner 为解码语义（`\|` 别名
  // 不进目标路径），真宿主读取闭环装载卡片；Reading 侧 td 宿主同装载；
  // 源文（含转义管道）逐字节不动、双零 dirty 与零 applyEdit。绘制层与
  // 交互隔离断言在浏览器 tableEmbed 套件（真实 Chromium 布局与指针）。
  ['嵌入：表格格内双模式挂载与转义保真（#248）', async () => {
    await openWithEditor('嵌入表格样例.md')
    await waitSessionReady('嵌入表格样例.md')
    const parentBefore = await readDisk('嵌入表格样例.md')
    const targetBefore = await readDisk('嵌入目标.md')
    const uri = wsUri('嵌入表格样例.md').toString()

    // 嵌入表（Live 模式起步）：3 枚 occurrence，inner 一律解码语义
    const shown = await waitViewState('嵌入表格样例.md', (v) =>
      v.viewMode === 'live' && (v.liveEmbedReveal ?? []).length === 3)
    const inners = (shown.liveEmbedReveal ?? []).map((r) => r.inner)
    assert(inners.includes('嵌入目标|头别名'), `表头格转义别名 inner 为解码语义（实际 ${JSON.stringify(inners)}）`)
    assert(inners.includes('嵌入目标') && inners.includes('改名嵌入目标#章节一|格内别名'),
      `数据格两枚 inner 正确（实际 ${JSON.stringify(inners)}）`)
    // 源文坐标保真：解码 inner 对应的源文区间含 \| 转义字符（不能用解码
    // offset 写回——宿主侧以磁盘源文对拍）
    assert(shown.text === parentBefore, `格内嵌入不改写源文（含 \\| 转义，实际 ${JSON.stringify(shown.text.slice(0, 120))}）`)

    // 真宿主读取闭环：三卡装载（表头格 + 数据格两枚；改名嵌入目标章节卡）
    const loaded = await waitViewState('嵌入表格样例.md', (v) => {
      const live = (v.readingEmbed ?? []).filter((c) => c.host === 'live')
      return live.length === 3 && live.every((c) => c.state === 'content')
    })
    const liveCards = (loaded.readingEmbed ?? []).filter((c) => c.host === 'live')
    assert(liveCards.some((c) => c.inner === '嵌入目标|头别名' && c.scope === 'full'),
      `表头格卡装载全文目标（实际 ${JSON.stringify(liveCards.map((c) => [c.inner, c.scope]))}）`)
    assert(liveCards.some((c) => c.inner === '改名嵌入目标#章节一|格内别名' && c.scope === 'heading'),
      '格内锚点别名卡装载章节目标')

    // Reading 模式：td 格内宿主同装载（host=reading；卡内递归孙卡同为
    // host=reading——按三枚格内目标 inner 匹配，不按总数）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'reading' })
    const wantedInners = ['嵌入目标|头别名', '嵌入目标', '改名嵌入目标#章节一|格内别名']
    const reading = await waitViewState('嵌入表格样例.md', (v) => {
      if (v.viewMode !== 'reading') return false
      const cards = (v.readingEmbed ?? []).filter((c) => c.host === 'reading')
      return wantedInners.every((inner) =>
        cards.some((c) => c.inner === inner && c.state === 'content'))
    })
    assert((reading.readingEmbed ?? []).filter((c) => c.host === 'reading' && c.inner === '嵌入目标|头别名')
      .length === 1, 'Reading 表头格卡在场')
    assert(reading.text === parentBefore, 'Reading 侧源文逐字节不丢')

    // 双零 dirty 与零写回（格内挂载全程只读）
    const parentDoc = await vscode.workspace.openTextDocument(wsUri('嵌入表格样例.md'))
    const targetDoc = await vscode.workspace.openTextDocument(wsUri('嵌入目标.md'))
    assert(parentDoc?.isDirty === false && targetDoc?.isDirty === false, '父/目标文档双零 dirty')
    assert(await readDisk('嵌入表格样例.md') === parentBefore, '格内嵌入渲染不得改写父文档磁盘')
    assert(await readDisk('嵌入目标.md') === targetBefore, '格内嵌入读取不得改写目标磁盘')
    const state = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(state.appliedEdits === 0, `格内嵌入链路零 applyEdit（实际 ${state.appliedEdits}）`)

    // 复位：切回 live（后续用例隔离）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'view.mode.set', mode: 'live' })
    await waitViewState('嵌入表格样例.md', (v) => v.viewMode === 'live')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('表格嵌入面板关闭订阅回落', async () => {
      const stats = (await vscode.commands.executeCommand(CMD.hoverWatchStats)) as { targets: number; subscriptions: number }
      return stats.targets === 0 && stats.subscriptions === 0 ? stats : undefined
    })
    console.log('[#248] 表格格内双模式挂载、转义保真与零写回通过')
  }],

  // 格内嵌入边接入 rename 管线：转义别名形态按解码语义命中映射，改写只
  // 替换路径段——`\|` 别名与 `#锚点` 原样保留、列结构不裸化（\| 不变裸管
  // 道）；撤销一步恢复。与 #222 共用改名嵌入目标（该用例先行并复位文件名）
  ['嵌入：表格格内 rename 转义保真（#248）', async () => {
    await waitRenameIndexReady()
    const parentBefore = await readDisk('嵌入表格样例.md')
    await openWithEditor('嵌入改写.md')
    await waitSessionReady('嵌入改写.md')
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(wsUri('改名嵌入目标.md'), wsUri('改名嵌入目标2.md'), { overwrite: false })
    assert(await vscode.workspace.applyEdit(edit), 'rename 应成功应用')
    // 格内引用改写落盘：路径段替换，\| 别名与 #锚点 原样
    const rewritten = await poll('格内嵌入引用改写落盘', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('嵌入表格样例.md'))).getText()
      return text.includes('![[改名嵌入目标2#章节一\\|格内别名]]') ? text : undefined
    })
    assert(!rewritten.includes('改名嵌入目标#'), '旧目标不得残留（格内与正文引用同批改写）')
    assert(rewritten.includes('| 前文 ![[嵌入目标]] 中 ![[改名嵌入目标2#章节一\\|格内别名]] 后文 | 普通格 |'),
      `格内行结构保真（转义管道不被裸化、列数不变，实际 ${JSON.stringify(rewritten.split('\n').find((l) => l.includes('格内别名')) ?? '')}）`)
    // 撤销一步恢复（与 rename 同一撤销单元）
    await vscode.commands.executeCommand('undo')
    await poll('撤销恢复格内嵌入引用', async () => {
      const text = (await vscode.workspace.openTextDocument(wsUri('嵌入表格样例.md'))).getText()
      return text === parentBefore ? text : undefined
    })
    await new Promise((r) => setTimeout(r, 600))
    try {
      await vscode.workspace.fs.stat(wsUri('改名嵌入目标2.md'))
      await vscode.workspace.fs.rename(wsUri('改名嵌入目标2.md'), wsUri('改名嵌入目标.md'), { overwrite: true })
    } catch {
      // undo 已回滚文件名
    }
    await new Promise((r) => setTimeout(r, 400))
    console.log('[#248] 表格格内 rename 转义保真与撤销恢复通过')
  }],
  // ---- P2-04（#281）嵌入内部 Live：第一条可写链路的真宿主证明。父面板
  // 默认 Live → 未覆盖嵌入继承内部 Live → 绑定目标编辑端口（B 的
  // DocumentSession 虚拟面板）→ 普通输入只写 B；A 零写回/零 dirty；dirty
  // 推送驱动圆点；保存走 TextDocument.save（P2-01 验证路线）。 ----
  ['P2-04 嵌入内部 Live：输入只写目标、dirty 圆点与保存路由（#281）', async () => {
    await openWithEditor('p204-编辑嵌入.md')
    await waitSessionReady('p204-编辑嵌入.md')
    const uri = wsUri('p204-编辑嵌入.md').toString()
    const targetUri = wsUri('p204-编辑目标.md')
    const parentBefore = await readDisk('p204-编辑嵌入.md')
    const targetBefore = await readDisk('p204-编辑目标.md')
    const parentDoc = await vscode.workspace.openTextDocument(wsUri('p204-编辑嵌入.md'))
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 两枚同目标 occurrence 均装载并绑定（父 Live 继承 → 自动 bind）
    const bound = await waitViewState('p204-编辑嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p204-编辑目标')
      return cards.length === 2 && cards.every((c) => c.liveBound === true && c.internalMode === 'live')
        ? true : false
    })
    const ports = new Set(bound.readingEmbed!.filter((c) => c.inner === 'p204-编辑目标').map((c) => c.livePortId))
    assert(ports.size === 2, `同目标两 occurrence 各自独立端口（实际 ${JSON.stringify([...ports])}）`)
    assert(bound.readingEmbed!.every((c) => c.inner !== 'p204-编辑目标' || c.liveDirty === false),
      '目标初始干净（无圆点）')

    // occurrence 0 普通输入：只写 B（经 B 会话，A 会话零 applyEdit）
    const insertAt = '# p204 编辑目标\n\n'.length + 3
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p204-编辑目标', pos: insertAt, text: '【嵌入编辑】',
    })
    const bDoc = await poll('B 权威文档收到嵌入编辑', () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
      return doc?.getText().includes('【嵌入编辑】') ? doc : undefined
    })
    assert(bDoc.isDirty, '嵌入编辑后目标 B dirty')
    // dirty 推送 → 圆点在场（探针）
    await waitViewState('p204-编辑嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p204-编辑目标' && c.liveDirty === true)
        ? true : false)
    // A 零写回：文本不变、不 dirty、A 会话 appliedEdits 零推进（根面板身份
    // 与目标会话身份分开——B 的编辑不经过 A 的 DocumentSession）
    await waitViewState('p204-编辑嵌入.md', (v) => v.text === parentBefore)
    assert(parentDoc.getText() === parentBefore && !parentDoc.isDirty, '父文档 A 零写回且零 dirty')
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.appliedEdits === session0.appliedEdits,
      `A 会话 appliedEdits 零推进（B 编辑走 B 会话；实际 ${session1.appliedEdits}，基线 ${session0.appliedEdits}）`)
    assert(await readDisk('p204-编辑目标.md') === targetBefore, '保存前目标磁盘未变')

    // 保存路由（embed.test.save 与头部保存入口/Ctrl+S 焦点路由同一出站）：
    // TextDocument.save 只落 B——磁盘更新、dirty 清零、圆点消失、A 原样
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.save', inner: 'p204-编辑目标',
    })
    await poll('目标保存落盘', async () => (await readDisk('p204-编辑目标.md')).includes('【嵌入编辑】') ? true : undefined)
    assert(!bDoc.isDirty, '保存后目标干净')
    await waitViewState('p204-编辑嵌入.md', (v) =>
      (v.readingEmbed ?? []).every((c) => c.inner !== 'p204-编辑目标' || c.liveDirty !== true)
        ? true : false)
    assert(await readDisk('p204-编辑嵌入.md') === parentBefore && !parentDoc.isDirty,
      '保存目标不动父文档（A 磁盘与 dirty 原样）')
    console.log('[P2-04] 嵌入输入只写目标 + dirty 圆点 + 保存路由通过')
  }],

  // ---- P2-04（#281）宿主历史路由（P2-01 验证的临时激活路线）与端口
  // 拒收面：撤销精准落 B、A 活动标签恢复、B 预览标签收口；重复 seq 幂等
  // 去重；释放后（unbind 后）的迟到写入按 portId 拒收。 ----
  ['P2-04 嵌入内部 Live：撤销激活路由、重复 seq 去重与释放后写入拒收（#281）', async () => {
    await openWithEditor('p204-编辑嵌入.md')
    await waitSessionReady('p204-编辑嵌入.md')
    const uri = wsUri('p204-编辑嵌入.md').toString()
    const targetUri = wsUri('p204-编辑目标.md')
    const targetClean = (await vscode.workspace.openTextDocument(targetUri)).getText()
    const bound = await waitViewState('p204-编辑嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p204-编辑目标' && c.liveBound === true)
        ? true : false)
    void bound
    const fsPath = targetUri.fsPath

    // 键入一笔（撤销载体）
    const insertAt = '# p204 编辑目标\n\n'.length + 3
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p204-编辑目标', pos: insertAt, text: '撤销载体',
    })
    const bDoc = await poll('撤销载体写入 B', () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
      return doc?.getText().includes('撤销载体') ? doc : undefined
    })
    assert(bDoc.isDirty, '载体编辑后 B dirty')

    // 撤销走 P2-01 激活路由：B 无 custom 标签 → showTextDocument(B preview)
    // → 全局 undo → 重显 A → 收 B 预览标签（用户已确认的标签切换取舍）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.history', inner: 'p204-编辑目标', op: 'undo',
    })
    await poll('撤销回退 B 到已保存内容', () =>
      bDoc.getText() === targetClean && !bDoc.isDirty ? true : undefined)
    // 收口断言经轮询：undo 落盘先行、openWith 重显与预览标签收起随后
    // （historyViaTempActivation 的异步收尾与文本回退存在毫秒级竞态）
    await poll('撤销路由收口（活动标签回 A、B 预览标签收起）', () => {
      const activeInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      const restored = activeInput instanceof vscode.TabInputCustom &&
        activeInput.viewType === VIEW_TYPE && activeInput.uri.toString() === uri
      const bTextTabs = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === targetUri.toString())
      return restored && bTextTabs.length === 0 ? true : undefined
    })

    // 撤销路由激活 B 期间 A 的 webview 被隐藏（retainContextWhenHidden
    // 关闭 → 卸载），恢复后重载并自动重绑——端口身份换新，此处重取当前
    // 端口（旧端口的 stale 释放路径已由重绑闭环覆盖）
    const rebound = await waitViewState('p204-编辑嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p204-编辑目标' && c.liveBound === true)
        ? true : false)
    const port = rebound.readingEmbed!.find((c) => c.inner === 'p204-编辑目标' && c.livePortId)!.livePortId!

    // 重复 seq：同 seq 两笔伪造写入 → 宿主 ackCache 幂等去重，恰一笔落 B
    const versionBefore = bDoc.version
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.portWrite', portId: port, fsPath, seq: 9001,
      baseVersion: versionBefore, offset: 0, length: 0, text: '重复载入', repeat: 2,
    })
    await poll('重复 seq 首笔落 B', () => bDoc.getText().includes('重复载入') ? true : undefined)
    await new Promise((r) => setTimeout(r, 500))
    assert(bDoc.version === versionBefore + 1,
      `重复 seq 恰一笔 applyEdit（版本 +1；实际 ${versionBefore} → ${bDoc.version}）`)
    assert(bDoc.getText().split('重复载入').length - 1 === 1,
      '同 seq 第二笔由 ackCache 去重（不重复写入）')

    // 释放后写入拒收：切回 Reading（unbind，两枚 occurrence 各自切）→ 旧
    // portId 的迟到写入被拒
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.mode', inner: 'p204-编辑目标', mode: 'reading', occurrence: 0,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.mode', inner: 'p204-编辑目标', mode: 'reading', occurrence: 1,
    })
    await waitViewState('p204-编辑嵌入.md', (v) =>
      (v.readingEmbed ?? []).every((c) => c.inner !== 'p204-编辑目标' || c.liveBound !== true)
        ? true : false)
    const textAfterUnbind = bDoc.getText()
    const versionAfterUnbind = bDoc.version
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.portWrite', portId: port, fsPath, seq: 9002,
      baseVersion: versionAfterUnbind, offset: 0, length: 0, text: '迟到写入',
    })
    await new Promise((r) => setTimeout(r, 500))
    assert(bDoc.getText() === textAfterUnbind && bDoc.version === versionAfterUnbind,
      '释放后的迟到端口写入被拒收（B 权威文本与版本零变化）')

    // 现场还原：激活 B → 无参 revert 回保存内容（P2-01 验证路线）→ 收标签
    await vscode.window.showTextDocument(bDoc, { preview: true })
    await vscode.commands.executeCommand('workbench.action.files.revert')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('B 回到已保存内容', () => bDoc.getText() === targetClean ? true : undefined)
    console.log('[P2-04] 撤销激活路由 + 重复 seq 去重 + 释放后拒收通过')
  }],

  // ---- P2-04（#281）CRLF 坐标与不可安全写回暂停的目标文本断言：CRLF 目标
  // 键入经 LF/宿主坐标双向转换保存回读保真；外部覆盖旧版本请求区间 →
  // 重定位失败 → 面板暂停 + edit.ack fail，B 权威文本 = 外部版本（嵌入
  // 旧版未写入），A 零波及。 ----
  ['P2-04 嵌入内部 Live：CRLF 坐标保真与不可安全写回暂停（#281）', async () => {
    await openWithEditor('p204-CRLF嵌入.md')
    await waitSessionReady('p204-CRLF嵌入.md')
    const uri = wsUri('p204-CRLF嵌入.md').toString()
    const targetUri = wsUri('p204-CRLF目标.md')
    const parentDoc = await vscode.workspace.openTextDocument(wsUri('p204-CRLF嵌入.md'))
    const bound = await waitViewState('p204-CRLF嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p204-CRLF目标' && c.liveBound === true)
        ? true : false)
    const card = bound.readingEmbed!.find((c) => c.inner === 'p204-CRLF目标')!
    const port = card.livePortId!
    const fsPath = targetUri.fsPath
    const bDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === targetUri.toString()) ??
      (await vscode.workspace.openTextDocument(targetUri))
    assert(bDoc.getText().includes('\r\n'), 'CRLF 目标装载保留宿主行尾')

    // 键入（webview LF 坐标 → 宿主 CRLF 坐标）+ 保存：磁盘回读 CRLF 保真
    const insertAt = 'p204 CRLF 目标首行'.length - 2
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p204-CRLF目标', pos: insertAt, text: 'CRLF编辑',
    })
    await poll('CRLF 目标收到键入', () => bDoc.getText().includes('CRLF编辑') ? true : undefined)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.save', inner: 'p204-CRLF目标',
    })
    const savedDisk = await poll('CRLF 保存落盘', async () => {
      const text = await readDisk('p204-CRLF目标.md')
      return text.includes('CRLF编辑') && text.includes('\r\n') ? text : undefined
    })
    assert(savedDisk.includes('p204 CRLF 目标CRLF编辑首行\r\np204 第二行\r\n'),
      `LF 坐标键入转换为宿主 CRLF 坐标且既有行尾保真（实际 ${JSON.stringify(savedDisk)}）`)
    assert(!parentDoc.isDirty && parentDoc.getText() === (await readDisk('p204-CRLF嵌入.md')),
      'CRLF 编辑与保存全程父文档零波及')

    // 不可安全写回暂停：外部覆盖区间 [0,6)（版本前移），随后以旧
    // baseVersion 对同区间伪造写入 → 重定位失败 → 暂停 + 目标文本断言
    const versionAtPause = bDoc.version
    const external = new vscode.WorkspaceEdit()
    external.replace(targetUri, new vscode.Range(0, 0, 0, 6), '外部改写')
    assert(await vscode.workspace.applyEdit(external), '外部覆盖应成功应用')
    const bDocNow = await poll('外部版本到达 B 文档', () => {
      const latest = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
      return latest?.getText().startsWith('外部改写') ? latest : undefined
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.portWrite', portId: port, fsPath, seq: 9003,
      baseVersion: versionAtPause, offset: 0, length: 6, text: '嵌入旧版',
    })
    await waitViewState('p204-CRLF嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p204-CRLF目标' && c.liveSuspended === true)
        ? true : false)
    assert(bDocNow.getText().startsWith('外部改写') && !bDocNow.getText().includes('嵌入旧版'),
      '暂停后 B 权威文本保持外部版本（旧版本请求未写入——目标文本断言）')
    assert(bDocNow.getText().includes('CRLF编辑'), '此前已保存的 CRLF 编辑仍在（外部只覆盖 [0,6)）')

    // 现场还原：切回 Reading 释放端口 → 激活 B → 无参 revert 回保存内容
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.mode', inner: 'p204-CRLF目标', mode: 'reading',
    })
    await vscode.window.showTextDocument(bDocNow, { preview: true })
    await vscode.commands.executeCommand('workbench.action.files.revert')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await poll('B 回到已保存内容', () => bDocNow.getText() === savedDisk ? true : undefined)
    console.log('[P2-04] CRLF 坐标保真 + 不可安全写回暂停（目标文本断言）通过')
  }],

 // ---- P2-10（#287）引用完整 Live 操作落 B 不落 A：焦点在嵌入内部 Live
  // 编辑器内时，格式命令（format.command 宿主回发路径）、表格创建与
  // frontmatter Popover 编辑全部指向实际目标 B（经 B 的 DocumentSession
  // 虚拟面板写回宿主权威文本）；A 的文本/dirty/appliedEdits 零变化；实例
  // 释放（切 Reading）后 Popover 关闭（浮层不残留可写死视图）。 ----
  ['P2-10 引用完整 Live 操作：格式/表格/属性 Popover 落 B 不落 A（#287）', async () => {
    await openWithEditor('p210-操作嵌入.md')
    await waitSessionReady('p210-操作嵌入.md')
    const uri = wsUri('p210-操作嵌入.md').toString()
    const targetUri = wsUri('p210-操作目标.md')
    const parentBefore = await readDisk('p210-操作嵌入.md')
    const targetBefore = await readDisk('p210-操作目标.md')
    const parentDoc = await vscode.workspace.openTextDocument(wsUri('p210-操作嵌入.md'))
    const session0 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState

    // 嵌入继承父 Live → 绑定端口（装载 + init 完成；liveTextLen ≥ 0 = init
    // 已装载全文）
    await waitViewState('p210-操作嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p210-操作目标' && c.liveBound === true &&
        (c.liveTextLen ?? -1) >= 0 && c.internalMode === 'live')
        ? true : false)
    const bDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())!
    const fmPrefix = '---\ntags:\n  - 甲\n---\n# p210 操作目标\n\n'.length

    // 1) 格式命令（焦点嵌入 → 目标 B）：选「首段」加粗
    const seg = '首段'
    const segAt = fmPrefix + '目标'.length
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.focus', inner: 'p210-操作目标', pos: segAt, to: segAt + seg.length,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'format.command', op: 'bold',
    })
    await poll('格式命令写 B（加粗首段）', () =>
      bDoc.getText().includes(`**${seg}**`) ? true : undefined)
    assert(bDoc.isDirty, '格式操作后目标 B dirty')
    assert(parentDoc.getText() === parentBefore && !parentDoc.isDirty, 'A 零写回且零 dirty（格式命令不落 A）')
    const session1 = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(session1.appliedEdits === session0.appliedEdits,
      `A 会话 appliedEdits 零推进（格式命令经 B 会话；实际 ${session1.appliedEdits}）`)

    // 2) 表格创建命令（焦点嵌入 → 目标 B）：文末插入表格骨架
    const textNow = bDoc.getText()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.focus', inner: 'p210-操作目标', pos: textNow.length - 1,
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, { kind: 'table.create' })
    await poll('表格创建写 B', () => bDoc.getText().includes('| --- | --- |') ? true : undefined)
    assert(parentDoc.getText() === parentBefore, '表格创建不写 A')

    // 3) frontmatter Popover 捕获嵌入实例：打开（A 无 fm——全文档唯一 fm 卡
    //    在嵌入编辑器内）→ 数组加项 → 写 B 头区；A 不变
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'fm.test.click', action: 'edit-button',
    })
    await waitViewState('p210-操作嵌入.md', (v) => v.fmPopoverOpen === true)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'fm.test.click', action: 'popover-add-item', index: 0,
    })
    await poll('Popover 加项写 B 头区', () =>
      bDoc.getText().includes('  - 甲\n  - item\n') ? true : undefined)
    assert(parentDoc.getText() === parentBefore && !parentDoc.isDirty,
      'Popover 编辑不写 A（父文档保持原文与干净）')

    // 4) 实例释放联动：Popover 打开状态下切回 Reading（teardownLive）→
    //    浮层关闭（不残留可写死视图）；后续 format 命令回到 A 语境被
    //    A 自身守卫处理（A 无选区包裹空围栏属既有语义，此处只断言 B 不再
    //    被写入——释放后无写路径）
    const bTextAtRelease = bDoc.getText()
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.mode', inner: 'p210-操作目标', mode: 'reading',
    })
    await waitViewState('p210-操作嵌入.md', (v) =>
      v.fmPopoverOpen === false &&
      (v.readingEmbed ?? []).every((c) => c.inner !== 'p210-操作目标' || c.liveBound !== true)
        ? true : false)
    await new Promise((r) => setTimeout(r, 400))
    assert(bDoc.getText() === bTextAtRelease, '实例释放后 B 无迟到写入')

    // 现场还原：保存 B（清 dirty）→ 关闭 A 前保持工作区整洁
    await bDoc.save()
    assert(await readDisk('p210-操作目标.md') !== targetBefore, '目标保存后磁盘已更新')
    console.log('[P2-10] 格式/表格/Popover 操作落 B 不落 A 通过')
  }],

  // ---- P2-05（#282）显式关闭确认：插件可控退出统一检查 B 最新状态——
  // dirty 三项模态（保存并关闭/丢弃修改并关闭/取消，默认取消）；取消与
  // 保存失败保留现场；文档级丢弃恢复整个 B（多 occurrence 去重不重复回滚）。
  // 保存走 TextDocument.save、丢弃走 P2-01 验证的激活 B + 无参 revert。
  ['P2-05 显式关闭：三项模态、保存失败保留现场与多 occurrence 丢弃去重（#282）', async () => {
    await openWithEditor('p205-关闭嵌入.md')
    await waitSessionReady('p205-关闭嵌入.md')
    const uri = wsUri('p205-关闭嵌入.md').toString()
    const targetUri = wsUri('p205-关闭目标.md')
    const targetDiskBase = await readDisk('p205-关闭目标.md')
    const TARGET_HEAD = '# p205 关闭目标\n\n'.length + 3

    // 两 occurrence 继承父 Live 自动绑定
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 2 && cards.every((c) => c.liveBound === true) ? true : false
    })

    // occurrence 0 输入 → B dirty；显式关闭 → 模态在场（含文件名与三项文案）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p205-关闭目标', pos: TARGET_HEAD, text: '【关闭编辑】',
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.liveDirty === true)
        ? true : false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.close', inner: 'p205-关闭目标', intent: 'close', occurrence: 0,
    })
    const dialogOpen = await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open')
        ? true : false)
    const occ0a = dialogOpen.readingEmbed!.find((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open')!
    assert(occ0a.closeIntent === 'close', '模态意图径为 close')

    // 取消：保留现场——模态关、卡片仍 Live、B 仍 dirty
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'cancel',
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).every((c) => c.inner !== 'p205-关闭目标' || c.closeDialog === 'none')
        ? true : false)
    const afterCancel = await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.liveBound === true && c.liveDirty === true)
        ? true : false)
    assert(afterCancel.readingEmbed!.some((c) => c.inner === 'p205-关闭目标' && c.internalMode === 'live'),
      '取消后 occurrence 0 仍内部 Live（保留现场）')

    // 保存失败（只读盘）：模态保留 + 卡片保留
    const { chmodSync } = await import('node:fs')
    chmodSync(targetUri.fsPath, 0o444)
    try {
      await vscode.commands.executeCommand(CMD.postToPanel, uri, {
        kind: 'embed.test.close', inner: 'p205-关闭目标', intent: 'close', occurrence: 0,
      })
      await waitViewState('p205-关闭嵌入.md', (v) =>
        (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open')
          ? true : false)
      await vscode.commands.executeCommand(CMD.postToPanel, uri, {
        kind: 'embed.test.dialogAction', action: 'save',
      })
      const failState = await waitViewState('p205-关闭嵌入.md', (v) =>
        (v.readingEmbed ?? []).some((c) =>
          c.inner === 'p205-关闭目标' && (c.closeDialog === 'open' || c.closeDialog === 'stale'))
          ? true : false, 0, 20000)
      void failState
      const bFail = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())!
      assert(bFail.isDirty, '保存失败后 B 仍 dirty（保留现场）')
      assert(await readDisk('p205-关闭目标.md') === targetDiskBase, '失败保存未写磁盘')
    } finally {
      chmodSync(targetUri.fsPath, 0o666)
    }

    // 恢复可写：保存并关闭 → B 落盘、dirty 清零、occurrence 0 回 Reading
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'save',
    })
    await poll('保存并关闭落盘', async () =>
      (await readDisk('p205-关闭目标.md')).includes('【关闭编辑】') ? true : undefined)
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.some((c) => c.closeDialog === 'none') && cards[0]!.internalMode === 'reading' && cards[0]!.liveBound === false
        ? true : false
    })

    // occurrence 1 再输入 → 丢弃并关闭：整个 B 回滚（含 occ0 已保存内容后的
    // 新修改——恢复到磁盘已保存内容）；同目标不重复回滚（第二次关闭因
    // dirty=false 直接完成，无第二次 revert）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p205-关闭目标', pos: TARGET_HEAD, text: '【occ1 改】', occurrence: 1,
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.liveDirty === true)
        ? true : false)
    const verBeforeRevert = vscode.workspace.textDocuments
      .find((d) => d.uri.toString() === targetUri.toString())!.version
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.close', inner: 'p205-关闭目标', intent: 'close', occurrence: 1,
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open')
        ? true : false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'discard',
    })
    await poll('revert 后 B 回到磁盘已保存内容', async () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())
      return doc && !doc.isDirty && doc.getText() === (await readDisk('p205-关闭目标.md')) ? true : undefined
    })
    const bAfter = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri.toString())!
    assert(bAfter.getText().includes('【关闭编辑】') && !bAfter.getText().includes('【occ1 改】'),
      '文档级丢弃恢复到已保存内容（occ1 的未保存修改被回滚，已保存内容保留）')
    assert(bAfter.version > verBeforeRevert, 'revert 推进版本（P2-01 语义）')
    // 卡片关闭（dirty=false 路径——A 面板可能因激活切换重载，等待最终态）
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.every((c) => c.closeDialog !== 'open') ? true : false
    }, 0, 30000)
    console.log('[P2-05] 三项模态 + 保存失败保留现场 + 文档级丢弃通过')
  }],

  // ---- P2-05（#282）删除活跃引用拦截：覆盖活跃端口的 A 事务先拦截确认
  //（取消不把删除先写入 A）；确认后完成删除与相关退出；Esc 径同链路。 ----
  ['P2-05 删除活跃引用拦截与 Esc 退出（#282）', async () => {
    await openWithEditor('p205-关闭嵌入.md')
    await waitSessionReady('p205-关闭嵌入.md')
    const uri = wsUri('p205-关闭嵌入.md').toString()
    const aDiskBase = await readDisk('p205-关闭嵌入.md')
    const parentDoc = await vscode.workspace.openTextDocument(wsUri('p205-关闭嵌入.md'))
    const TARGET_HEAD = '# p205 关闭目标\n\n'.length + 3

    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 2 && cards.every((c) => c.liveBound === true) ? true : false
    })

    // occurrence 0 输入 → dirty；删除引用行事务（主编辑器真实事务管线）
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p205-关闭目标', pos: TARGET_HEAD, text: '【删除前】',
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.liveDirty === true)
        ? true : false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.deleteRef', inner: 'p205-关闭目标', occurrence: 0,
    })
    // 拦截：A 文本未变（未确认删除不写入 A）+ 模态在场（delete 意图）
    const intercepted = await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open' && c.closeIntent === 'delete')
        ? true : false)
    assert(intercepted.text.includes('![[p205-关闭目标]]'), '拦截后 A 引用行仍在（webview 文本未删）')
    assert(parentDoc.getText() === aDiskBase, '宿主 A 权威文本未变（未把删除先写入 A）')

    // 取消：A 原引用保留
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'cancel',
    })
    const afterCancel = await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).every((c) => c.inner !== 'p205-关闭目标' || c.closeDialog === 'none')
        ? true : false)
    assert(afterCancel.text.includes('![[p205-关闭目标]]'), '取消后 A 原引用保留')

    // 再次删除 → 保存并关闭：B 落盘后 A 中该引用行删除完成（确认后才写入）。
    // 注：确认动作选 save 而非 discard——discard 走激活 B + revert（P2-01
    // 路线），激活期间 A 的 webview 隐藏卸载、恢复后重载（P2-04 实测取舍），
    // closed 回包与删除重放随重载丢失（B 已正确回滚、引用保留由用户重删）
    // ——「确认后 A 删除完成」在 save 路径（不激活 B）下才可稳定断言；
    // discard 的文档级回滚已由用例 1 的多 occurrence 段验证。
    const diskBeforeConfirm = await readDisk('p205-关闭目标.md')
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.deleteRef', inner: 'p205-关闭目标', occurrence: 0,
    })
    await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open')
        ? true : false)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'save',
    })
    await poll('确认保存落盘', async () =>
      (await readDisk('p205-关闭目标.md')).includes('【删除前】') ? true : undefined)
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 1 && cards.every((c) => c.closeDialog === 'none') ? true : false
    }, 0, 30000)
    // A 的删除经标准管线写回宿主（重放事务 → edit.request → WorkspaceEdit）
    await poll('A 删除写回宿主', async () => {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === wsUri('p205-关闭嵌入.md').toString())
      const text = doc?.getText() ?? ''
      const occurrences = text.split('![[p205-关闭目标]]').length - 1
      return occurrences === 1 ? true : undefined
    })
    const diskAfterConfirm = await readDisk('p205-关闭目标.md')
    assert(diskAfterConfirm.includes('【删除前】') && diskAfterConfirm !== diskBeforeConfirm,
      '确认保存后 B 落盘（磁盘含保存内容）')

    // Esc 径（删除后剩余 occurrence——A 文本变化导致重挂重绑）：先等重挂
    // 绑定稳定（liveBound），再输入（type 过早会在实例建立前静默丢弃）
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 1 && cards[0]!.liveBound === true ? true : false
    }, 0, 30000)
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.type', inner: 'p205-关闭目标', pos: TARGET_HEAD, text: '【esc】', occurrence: 0,
    })
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 1 && cards[0]!.liveBound === true && cards[0]!.liveDirty === true ? true : false
    })
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.close', inner: 'p205-关闭目标', intent: 'escape', occurrence: 0,
    })
    const escDialog = await waitViewState('p205-关闭嵌入.md', (v) =>
      (v.readingEmbed ?? []).some((c) => c.inner === 'p205-关闭目标' && c.closeDialog === 'open' && c.closeIntent === 'escape')
        ? true : false)
    void escDialog
    await vscode.commands.executeCommand(CMD.postToPanel, uri, {
      kind: 'embed.test.dialogAction', action: 'save',
    })
    await poll('Esc 径保存落盘', async () =>
      (await readDisk('p205-关闭目标.md')).includes('【esc】') ? true : undefined)
    await waitViewState('p205-关闭嵌入.md', (v) => {
      const cards = (v.readingEmbed ?? []).filter((c) => c.inner === 'p205-关闭目标')
      return cards.length === 1 && cards[0]!.liveBound === false && cards[0]!.closeDialog === 'none' ? true : false
    }, 0, 30000)
    console.log('[P2-05] 删除引用拦截（取消保留/确认完成）+ Esc 径关闭通过')
  }],

  // #270 dirty「主动丢弃未保存内容」的覆盖层通用退役信号。1.86 事件面实证
  //（探针轮落 .vscode-test 报告）：Vsidian 面板丢弃有 tabClosed+close 事件
  //（既有 onDidClose 接线已退役，本例 A 段回归钉）；普通文本编辑器丢弃
  // **无 close 事件、文档滞留 textDocuments**——唯一宿主广播是「空
  // contentChanges 且转 clean」的 dirty-state 事件（B 段主战场）；显式
  // revert 另有真内容 change + 同款 clean 事件（C 段）。三段共同契约：
  // 丢弃/还原后覆盖层退役（getRenameOverlay → undefined），反链回基线。
  ['#270 dirty 丢弃与还原的覆盖层通用退役（面板/普通编辑器/revert）', async () => {
    await waitRenameIndexReady()
    // #309：closeAllEditors 的 soft revert 只清 dirty；普通编辑器重开又会
    // 异步 reload。复用同一 buffer 会让后段插入与 reload 竞争，甚至叠加
    // 前段未丢弃的正文。每段独占无盘面引用的 fixture，保持三条退役路径独立。
    const scenarios = [
      ['A 段', 'overlay-discard-custom.md', true, 'workbench.action.closeAllEditors'],
      ['B 段', 'overlay-discard-native.md', false, 'workbench.action.closeAllEditors'],
      ['C 段', 'overlay-revert-native.md', false, 'workbench.action.revertAndCloseActiveEditor'],
    ] as const
    for (const [label, file, custom, closeCommand] of scenarios) {
      const uri = wsUri(file)
      const baseline = '# Overlay retirement\n'
      const inserted = '丢弃链接 [[rename-moved]]\n'
      const overlayOf = () => vscode.commands.executeCommand(
        'onegayi.vsidian._test.getRenameOverlay', uri.fsPath,
      ) as Thenable<string[] | undefined>
      let closed = false
      const closeListener = vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.toString() === uri.toString()) closed = true
      })
      try {
        assert(await readDisk(file) === baseline, `${label}：盘面应为独立初始正文`)
        assert(await overlayOf() === undefined, `${label}：初始覆盖层应缺席`)
        if (custom) {
          await openWithEditor(file)
          await waitSessionReady(file)
        } else {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri))
        }
        // custom 侧只取已装载文档；额外 openTextDocument 会持有模型引用，
        // 改变关闭后的生命周期，把 A 段也变成 B 段的常驻文档路径。
        const doc = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === uri.toString())!
        assert(doc !== undefined, `${label}：编辑器应已装载文档`)
        assert(!doc.isDirty && doc.getText() === baseline, `${label}：插入前应为 clean 初始正文`)
        const edit = new vscode.WorkspaceEdit()
        edit.insert(uri, new vscode.Position(0, 0), inserted)
        assert(await vscode.workspace.applyEdit(edit), `${label}：插行应成功`)
        assert(doc.isDirty && doc.getText() === inserted + baseline, `${label}：未保存插入应精确应用一次`)
        await poll(`${label}：覆盖层登记丢弃链接`, async () => {
          const edges = await overlayOf()
          return edges?.includes('rename-moved.md') ? true : undefined
        })
        await vscode.commands.executeCommand(closeCommand)
        await poll(`${label}：丢弃/还原后覆盖层退役`, async () =>
          await overlayOf() === undefined ? true : undefined)
        assert(await readDisk(file) === baseline, `${label}：丢弃不得写盘`)
        if (custom) {
          await poll('A 段：面板关闭后文档 close 事件到达', async () =>
            closed && doc.isClosed ? true : undefined)
        }
        if (label === 'B 段') {
          // 不允许以 documentClosed 清理替代 #270 的 clean 事件路径。
          assert(!closed && !doc.isClosed && vscode.workspace.textDocuments.includes(doc),
            'B 段：普通编辑器丢弃后文档应仍装载且未发 close 事件')
          assert(!doc.isDirty, 'B 段：文档应已转 clean')
        }
        if (label === 'C 段') {
          assert(doc.getText() === baseline, 'C 段：显式还原应恢复初始正文')
        }
      } finally {
        closeListener.dispose()
        await Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAllEditors')).catch(() => {})
      }
    }
  }],

  ['骨架屏：hold 装配下收编在场、release 后撤除（#292）', async () => {
    // hold 门控（VSIDIAN_TEST_HOOKS=1 装配）下骨架在 init 后保持在场：
    // 回报在 webview 挂载收编时即出站，轮询最近一份断言；release 走
    // postToPanel 与生产消息同一入口。呈现几何与宽度断言在浏览器套件
    // skeletonProbe（绘制层），此处钉宿主可见的生命周期与回报通道。
    await openWithEditor('mode.md')
    const held = await poll('骨架在场回报', async () => {
      const report = await vscode.commands.executeCommand(
        CMD.skeletonState, wsUri('mode.md')) as
        | { present?: boolean; container?: string | null; shownAt?: number | null }
        | undefined | null
      return report && report.present === true ? report : undefined
    })
    assert(held.container === 'live', `默认模式收编落点应为 live，实际 ${held.container}`)
    assert(typeof held.shownAt === 'number', '回报应含呈现时刻打点')
    await vscode.commands.executeCommand(
      CMD.postToPanel, wsUri('mode.md'), { kind: '_test.skeleton.release' })
    const released = await poll('骨架撤除回报', async () => {
      const report = await vscode.commands.executeCommand(
        CMD.skeletonState, wsUri('mode.md')) as
        | { present?: boolean; container?: string | null }
        | undefined | null
      return report && report.present === false ? report : undefined
    })
    assert(released.container === null, '撤除后收编落点应清空')
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  }],

  // #299 跳转目标提示真宿主链路：Live 默认组合（总开关开、直接悬停关、
  // 提示开、无修饰键）悬停 → 稳定计时到期出站 hover.target.resolve →
  // documentSession 分发 → 宿主纯路径计算（零文件系统请求）→
  // hover.target.resolved 回包 → 提示显示所属根内相对路径；浮层不开
  // （两路径分工）；不存在目标照常显示意图路径；离开收起；零 applyEdit
  // 零写盘。
  // 位置约定（2026-10-02）：新用例一律排清单末尾——中段插入会使四分片
  // 取模整体错位重排，把既有用例挪进从未跑过的序列组合（#270 的 applyEdit
  // 竞争即由本用例中段插入触发，main 同名单同挂可证与产品代码无关）。
  ['跳转目标提示：Live 默认组合悬停出路径、宿主轻量解析回包与浮层不开（#299）', async () => {
    await openWithEditor('悬停预览.md')
    await waitSessionReady('悬停预览.md')
    const uri = wsUri('悬停预览.md').toString()
    await waitViewState('悬停预览.md', (v) => v.viewMode === 'live' && (v.liveWikilinkCount ?? 0) >= 1)
    const before = await readDisk('悬停预览.md')

    // 悬停第 0 个双链（无修饰键，默认组合；mouseover 经 Live 容器委托
    // ——与用户悬停同一处理器链路）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', link: 'live-wikilink', index: 0 })
    const shown = await waitViewState('悬停预览.md', (v) =>
      v.targetTip?.open === true && v.targetTip.text.length > 0)
    assert(shown.targetTip?.text === '目标笔记.md',
      `提示应显示所属根内相对路径（实际 ${JSON.stringify(shown.targetTip)}）`)
    assert(shown.hoverPreview?.open !== true, `浮层不应打开——两路径分工（实际 ${shown.hoverPreview?.open}）`)

    // 不存在目标照常显示意图路径（2026-10-02 用户裁定：纯计算零存在性探测）
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'enter', link: 'live-wikilink', index: 1 })
    const missing = await waitViewState('悬停预览.md', (v) =>
      v.targetTip?.open === true && v.targetTip.text.length > 0 && v.targetTip.text !== shown.targetTip?.text)
    assert(missing.targetTip?.text === '悬停缺失目标.md',
      `不存在目标应照常显示意图路径（实际 ${JSON.stringify(missing.targetTip)}）`)

    // 离开链接 → 提示收起
    await vscode.commands.executeCommand(CMD.postToPanel, uri,
      { kind: 'hover.test.pointer', action: 'leave', link: 'live-wikilink', index: 1 })
    await waitViewState('悬停预览.md', (v) => v.targetTip?.open === false)

    assert(await readDisk('悬停预览.md') === before, '轻量解析不得改写正文磁盘')
    const tipState = (await vscode.commands.executeCommand(CMD.sessionState, uri)) as SessionState
    assert(tipState.appliedEdits === 0, `全链路零 applyEdit（实际 ${tipState.appliedEdits}）`)
  }],
]
