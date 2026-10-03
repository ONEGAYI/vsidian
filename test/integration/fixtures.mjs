// 集成测试 fixture 单一事实源（工单 #15 抽取）：生成临时工作区全部样例文档。
// runTest.mjs（开发模式加载）与 runInstalled.mjs（VSIX 安装态回归）共用，
// 两条路径跑同一套 fixture，保证安装态与开发态断言的是同一组文档。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const LF_DOC = '中文编辑测试\n\n包含 emoji：🎉 与组合 emoji 👨‍👩‍👧‍👦\n\n- 列表项一\n- 列表项二\n'
const CRLF_DOC = '标题一\r\n正文 A 行\r\n正文 B 行\r\n'
const SPLIT_DOC = 'split 起始行\n'
const UNDO_DOC = '撤销链路第一行\n撤销链路第二行\n'
const UNDO2_DOC = '全局命令撤销甲行\n全局命令撤销乙行\n'
const UNDO3_DOC = '撤销守卫甲行\n撤销守卫乙行\n'
const UNDO4_DOC = '撤销竞态甲行\n撤销竞态乙行\n'
const ACKORDER_DOC = '顺序观测起始行\n顺序观测第二行\n'
const RESYNC_DOC = '重同步起始内容\n重同步第二段\n'
const IME_ESC_DOC = 'A文B\n'
// #123 符号输入辅助：单行正文（IME 钩子的候选写在首行行尾）；行内代码
// 口径由 unit/browser 两层覆盖，不在集成侧设样本
const SYMBOL_INPUT_DOC = '符号输入正文段\n'
// #124 选区包裹：跨段样本（两段 + 空行；真实 DOM 输入驱动选区替换链路）
const SYMBOL_WRAP_DOC = '包裹段甲\n\n包裹段乙\n'
// #124 CRLF 独立样本（同 #123 教训：共用样本会被早期用例修改保存）
const SYMBOL_WRAP_CRLF_DOC = '包裹标题段\r\n包裹正文段\r\n'
// #125 Tab 越界：正文粗体行 + 格内围栏表格（纯导航零写回，断言全程
// 字节不变；表格覆盖「格内先越界后切格」优先级链。空行不可省——GFM
// 表格不能中断段落，紧贴段落时整块退化为 Paragraph、切格链无从验证）
const SYMBOL_TAB_DOC = '**越界正文**段\n\n| 甲 | **格内** |\n| --- | --- |\n| 一 | 二 |\n'
// #125 CRLF 独立样本（webview LF 坐标换算下的零写回与字节保持）
const SYMBOL_TAB_CRLF_DOC = '**CRLF 越界**段\r\n正文行\r\n'
const CONFLICT_DOC = '第一段原文甲\n第二段原文乙\n'
const SPLIT_CONFLICT_DOC = '分裂测试行一\n分裂测试行二\n'
const HEADING_DOC = '# 顶部一级标题\n普通段落第一行内容\n普通段落第二行内容\n## 中部二级标题\n另一段普通内容结尾\n'
// #32 排版对照：标题/正文/列表/引用/表格齐全（两模式基础排版一致性断言载体）
const TYPOGRAPHY_DOC = [
  '# 排版对照标题',
  '',
  '普通段落正文，两模式基础排版对照载体。',
  '',
  '## 二级标题',
  '',
  '- 列表项甲',
  '- 列表项乙',
  '',
  '> 引用块内容，用于引用排版对照。',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲格 | 乙格 |',
  '',
  '结尾段落。',
  '',
].join('\n')
// #6 模式切换：标题/段落/任务列表/代码围栏（围栏内含伪语法）
const MODE_DOC = [
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
// 视口重载回归：真实观测夹具的表格、公式与 Mermaid 组合使相同像素高度
// 在 webview 重建前后对应不同源码行。固定文本见同目录资产。
const VIEWPORT_MERMAID_DOC = readFileSync(new URL('./viewport-mermaid.md', import.meta.url), 'utf8')
// #6 锚点恢复：无特殊语法的多段落（块边界清晰）
const MODE_ANCHOR_DOC = '模式锚点第一段文字\n\n中间段落文本\n\n最后段落结束\n'
// #8 双模式显示一致性样例：覆盖标题/粗斜体/列表/任务/引用/行内代码/围栏/
// frontmatter/水平线 + 代码内伪语法 + 未支持语法（脚注、原始 HTML）
const SYNTAX_DOC = [
  '---',
  'title: 语法样例',
  '# frontmatter 内伪标题',
  '---',
  '',
  '# 一级标题',
  '',
  '正文有 **加粗**、*斜体* 与 `行内代码`，还有转义 \\*不斜体\\*。',
  '',
  '## 二级标题',
  '',
  '- 普通列表项',
  '- [ ] 未完成任务',
  '- [x] 已完成任务',
  '',
  '> 引用第一行',
  '> 引用内 **粗体**',
  '',
  '行内注释 <!-- 注释文字 --> 淡化呈现。',
  '',
  '1. 有序项一',
  '2. 有序项二',
  '',
  '```js',
  'const x = 1 // # 伪标题 与 [[伪双链]] 与 - [ ] 伪任务',
  '```',
  '',
  '主题行',
  '===',
  '',
  '---',
  '',
  '未支持语法样例：脚注 [^1] 文本。',
  '',
  '<script>alert(1)</script> 与 <b>原始 HTML</b>',
  '',
  '结尾段落。',
  '',
].join('\n')
// #12 表格单元格编辑：转义管道、代码内管道、GFM 对齐全样例
const TABLE_DOC = [
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
// #296 引用块内表格样例：单层引用网格 + lazy 分隔行 + 多层引用
const BLOCKQUOTE_TABLE_DOC = [
  '# 引用块内表格样例',
  '',
  '> | 名字 | 数量 |',
  '> | --- | --- |',
  '> | 苹果 | 3 |',
  '',
  '> | 甲 | 乙 |',
  '| --- | --- |',
  '> | 1 | 2 |',
  '',
  '> > | 层级 | 深度 |',
  '> > | --- | --- |',
  '> > | 外层 | 2 |',
  '',
  '结尾段落。',
  '',
].join('\n')
const TABLE42_EMPTY_DOC = '| A | B |\n| --- | --- |\n| | 空 |\n'
// #13 表格导航/结构操作样例：表格前后有段落（区域不变断言），含对齐、
// 行内代码管道与转义管道
const TABLE13_DOC = [
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
const TABLE43_CRLF_DOC = TABLE13_DOC.replace(/\n/g, '\r\n')
const TABLE_CREATE_CRLF_DOC = '左文右文\r\n尾段\r\n'
// #8 大围栏细分样例：120 行围栏（超过 FENCE_CHUNK_LINES=60，切为 3 片）
const FENCE_CHUNK_DOC = (() => {
  const out = ['# 大围栏样例', '', '```text']
  for (let i = 1; i <= 120; i++) {
    out.push(`围栏内第 ${i} 行：大围栏细分挂载样本文本。`)
  }
  out.push('```', '', '结尾段。', '')
  return out.join('\n')
})()
// #79 代码块卡片样例：js/text/裸围栏/未知语言各一块 + mermaid（排除）+
// 缩进代码（不套卡片）——卡片头部计数 4 的断言载体
const CODE_CARD_DOC = [
  '# 代码块卡片样例',
  '',
  '```js',
  'const a = 1;',
  'function hi() {',
  '  return a + 1;',
  '}',
  '```',
  '',
  '```text',
  'hello',
  '```',
  '',
  '```',
  '裸围栏内容',
  '```',
  '',
  '```zzz',
  '未知语言内容',
  '```',
  '',
  '```mermaid',
  'graph TD',
  'A-->B',
  '```',
  '',
  '    缩进代码一行',
  '',
  '结尾段落。',
  '',
].join('\n')
// #9 任务勾选样例：含重复任务行（定位安全验证）与已勾选项
const TASK_DOC = [
  '# 任务清单标题',
  '',
  '- [ ] 未完成任务甲',
  '- [ ] 未完成任务甲',
  '- [x] 已完成任务',
  '',
  '结尾段落。',
  '',
].join('\n')
// #10 链接样例：中文/空格目录（%20 编码形态——CommonMark 无尖括号目标
// 不允许裸空格）、无扩展名目标、危险 scheme、自动链接与本地图片
// #199 rename 引用改写样例：目标文档被根目录/子目录引用者以三种边型引用
// （短名双链 / 显式路径 mdlink / 带标题锚与别名双链 / 子目录上行双链）+
// 附件引用 + 被移动文档自身出链（改写、撤销、未保存保护与跨根断言载体）
const RENAME_REF_A_DOC = [
  '# 改名引用甲',
  '',
  '见 [[改名目标]] 与 [同目标](./改名目标.md)。',
  '',
  '带锚 [[改名目标#深处小节|别名]]。',
  '',
  '附件 ![图](assets/rename-pic.png)。',
  '',
].join('\n')
const RENAME_REF_B_DOC = [
  '# 改名引用乙',
  '',
  '上行 [[../改名目标]]。',
  '',
].join('\n')
const RENAME_MOVED_DOC = [
  '# 移动自测',
  '',
  '见 [[改名目标]] 与 [子文档](notes/rename-note.md)。',
  '',
].join('\n')
const RENAME_NOTE_DOC = [
  '# 子文档',
  '',
].join('\n')
const RENAME_TARGET_DOC_WITH_ANCHOR = [
  '# 改名目标',
  '',
  '## 深处小节',
  '',
  '小节内容。',
  '',
].join('\n')
// #269/#276 连续 rename：独立文档组，前序 #199 的 dirty 装载实例与外部
// 归位过程不能成为本用例的起始内容或索引候选。
const RENAME_CHAIN_REF_A_DOC = [
  '# 链式引用甲',
  '',
  '见 [[链式目标]] 与 [同目标](./链式目标.md)。',
  '',
  '带锚 [[链式目标#深处小节|别名]]。',
  '',
].join('\n')
const RENAME_CHAIN_REF_B_DOC = [
  '# 链式引用乙',
  '',
  '上行 [[../链式目标]]。',
  '',
].join('\n')
const RENAME_CHAIN_TARGET_DOC = [
  '# 链式目标',
  '',
  '## 深处小节',
  '',
  '小节内容。',
  '',
].join('\n')
// #200 目录/批量移动样例：目录（含嵌套层与被引用附件）+ 外部引用者 +
// 目录内互链与上行出链（目录 rename/move、批量合并反馈的断言载体）
const DIR_INNER_A_DOC = [
  '# 互链甲',
  '',
  '互链 [[inner-b]] 与上行 [[../c-out]]。',
  '',
].join('\n')
const DIR_INNER_B_DOC = [
  '# 互链乙',
  '',
].join('\n')
const DIR_INNER_C_DOC = [
  '# 嵌套丙',
  '',
].join('\n')
const DIR_OUTSIDE_C_DOC = [
  '# 目录外目标',
  '',
].join('\n')
const DIR_REF_DOC = [
  '# 目录引用者',
  '',
  '外部 [[dir-move/inner-a]]、[乙](dir-move/inner-b.md) 与 [丙](dir-move/deep/inner-c.md)。',
  '',
  '附件 ![图](dir-move/dir-pic.png)。',
  '',
].join('\n')
// #200 多文件同批 rename 专属样例：与 #199 漂移保护用例共享文档会踩其
// finally 泄漏的 dirty buffer 与覆盖层滞留（#199 已知边界——编辑即自愈，
// 跨用例不自愈），独立文档组保证同批改写断言不受前序用例污染
const BATCH_TARGET_DOC = [
  '# 批目标',
  '',
  '## 深处小节',
  '',
  '小节内容。',
  '',
].join('\n')
const BATCH_REF_A_DOC = [
  '# 批引用甲',
  '',
  '见 [[批目标]] 与 [同目标](./批目标.md)。',
  '',
  '带锚 [[批目标#深处小节|别名]]。',
  '',
  '附件 ![图](assets/batch-pic.png)。',
  '',
].join('\n')
const BATCH_REF_B_DOC = [
  '# 批引用乙',
  '',
  '上行 [[../批目标]]。',
  '',
].join('\n')
const BATCH_MOVED_DOC = [
  '# 批移动自测',
  '',
  '见 [[批目标]]。',
  '',
].join('\n')

// #197 反链样例：目标文档被两个引用者以三种边型引用（wikilink 短名 /
// mdlink 显式路径 / wikilink 带标题锚）——反链面板与跳转的断言载体。
// 目标文档的反链期望（sortEdges 序：来源路径 → 区间）：
//   backlinks-a.md: [[反链目标]]、[同目标](./反链目标.md)、[[反链目标#深处小节]]
//   backlinks-b.md: [[反链目标]]
const BACKLINKS_SOURCE_A_DOC = [
  '# 反链引用者甲',
  '',
  '见 [[反链目标]] 与 [同目标](./反链目标.md)。',
  '',
  '第二段引用 [[反链目标#深处小节]]。',
  '',
].join('\n')
const BACKLINKS_SOURCE_B_DOC = [
  '# 反链引用者乙',
  '',
  '上行引用 [[反链目标]]。',
  '',
].join('\n')
const BACKLINKS_TARGET_DOC = [
  '# 反链目标',
  '',
  '开篇段落。',
  '',
  '## 深处小节',
  '',
  '小节内容。',
  '',
].join('\n')

// 出链面板样例（出链面板批次）：源文档覆盖命中（普通/带锚点）、断链与
// 外链四形态——出链面板条目序与锚点跳转的断言载体。
// 出链期望（resolved 优先 → 显示名码位 → 区间；外链不进面板）：
//   出链普通目标（resolved）、出链锚点目标（resolved，anchor=深处小节）、
//   不存在的出链目标（断链，display 用原文）
const OUTLINKS_SOURCE_DOC = [
  '# 出链源',
  '',
  '锚点引用 [[出链锚点目标#深处小节]] 与普通引用 [[出链普通目标]]。',
  '断链 [[不存在的出链目标]] 与外链 [外部](https://example.com)。',
  '',
].join('\n')
const OUTLINKS_ANCHOR_DOC = [
  '# 锚点目标',
  '',
  '## 深处小节',
  '',
  '深处正文。',
  '',
].join('\n')
const OUTLINKS_PLAIN_DOC = [
  '# 普通目标',
  '',
  '正文。',
  '',
].join('\n')

const LINKS_DOC = [
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
// #10 图片样例：工作区图片（中文+空格文件名，%20 形态）与缺失图
const IMAGES_DOC = [
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
// 1x1 透明 PNG（合法可解码位图，供真实 webview 装载断言）
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
// #201 图片刷新：1x1 纯绿 / 1x1 纯蓝 PNG（覆盖保存后内容真实不同——
// 代次推进 + 新版本 URL 返回新内容的链路载体）
const REFRESH_GREEN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaGAAAAEEAIFw9selAAAAAElFTkSuQmCC'
const REFRESH_BLUE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC'
export const LARGE_DOC_LINES = 100_000

// #133 界面域样式契约样例：公式（行内/块级/错误）、mermaid（有效/无效）、
// 代码卡片（js keyword token）、大纲（嵌套标题 + 行内标记）、frontmatter
// 成型卡片（#140 探针：card-line/row/cell/add-entry 与阅读侧同款表格）
// 各一—— chrome 探针的目标元素全部由本文档产出
const CHROME_CONTRACT_DOC = [
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

// #14 查找样例：'目标词' 出现 4 次（段落 2 次、列表项 1 次、emoji 行 1 次）
const STYLE_CONTRACT_DOC = [
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

const FIND_DOC = [
  '# 查找集成标题',
  '',
  '第一段：这里有一个目标词，后续还有。',
  '',
  '中间段落没有命中内容。',
  '',
  '第二段：又出现目标词了。',
  '',
  '- 列表项包含目标词',
  '',
  '包含 emoji：🎉 与目标词相邻。',
  '',
  '结尾段落。',
  '',
].join('\n')

// #34 行号样例：标题/软换行长段/列表/表格/代码块/空行混合——源行编号
// 与视觉行解耦的断言载体（长段折行时 renderedLines 超过源行数）
const LINENUMBERS_DOC = [
  '# 行号样例',
  '',
  '这是一个故意写得很长的段落，用于验证软换行只是视觉折行、不新增源文件行号：当段落宽度超过编辑器视口宽度时文本发生折行，行号栏仍按源文件的物理行逐一编号，与渲染后的视觉行数解耦，阅读模式与实时预览共用同一份源文本行语义。',
  '',
  '- 列表项甲',
  '- 列表项乙',
  '',
  '| 列一 | 列二 |',
  '| --- | --- |',
  '| 甲格 | 乙格 |',
  '',
  '```text',
  '代码块第一行',
  '代码块第二行',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

// #54 大纲样例：跨级标题、同名标题（不丢失不合并）、ATX 全级别、Setext
// 两级别、frontmatter 与代码围栏内伪标题（排除断言载体）
const OUTLINE_DOC = [
  '---',
  'title: 大纲样例',
  '# frontmatter 内伪标题',
  '---',
  '',
  '# 文档主标题',
  '',
  '## 同名标题',
  '',
  '普通段落。',
  '',
  '### 三级标题',
  '',
  '## 同名标题',
  '',
  '# 跨级回一级',
  '',
  'Setext 一级',
  '===========',
  '',
  'Setext 二级',
  '-----------',
  '',
  '#### 四级标题',
  '',
  '##### 五级标题',
  '',
  '###### 六级标题',
  '',
  '```text',
  '# 围栏内伪标题',
  'Setext 伪标题',
  '=============',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

// #54 长大纲样例（评审修复）：101 个标题（约 22px/条 ≈ 2230px）远超任何
// 合理窗口下的侧栏可视高度，是面板高度约束与纵向滚动的断言载体——修复
// 前面板长到内容高度被宿主裁剪末条不可达；高度约束生效后条目还须不收缩
// （否则内容被压扁仍不溢出）
const OUTLINE_LONG_DOC = (() => {
  const out = ['# 长文档主标题', '']
  for (let i = 1; i <= 50; i++) {
    out.push(`## 第 ${i} 章`, '', `第 ${i} 章的正文段落。`, '', `### 第 ${i} 章小节`, '', `小节 ${i} 的正文。`, '')
  }
  out.push('结尾段落。', '')
  return out.join('\n')
})()

// #65 大纲样式透传样例：白名单四标记（粗体/斜体/行内代码/删除线）、
// 嵌套粗斜体、双链别名与链接文字的纯文本降级——plainText/spans 断言载体
const OUTLINE_STYLE_DOC = [
  '# **重点** 结论',
  '## *斜体* 与 `代码`',
  '### ~~删除线~~ 与 [[目标笔记|显示别名]]',
  '#### [链接文字](https://example.com) 尾注',
  '##### ***粗斜*** 与普通',
  '',
].join('\n')
// #69 右键菜单样例：多级嵌套 + 跨级（H4 挂 H2 下）+ 行内标记标题（重命名
// 的资产保留断言）+ Setext（调级/重命名规范化 ATX 的载体）+ 文末段。
// 条目序列：0 主(H1) 1 加粗 Alpha(H2) 2 Alpha 子(H3) 3 Beta(H2) 4 Beta 深(H4)
//           5 Setext 标题(H1) 6 第二顶(H1)
const OUTLINE_MENU_DOC = [
  '# 主标题',
  '',
  '## **加粗** Alpha',
  '',
  'Alpha 内容。',
  '',
  '### Alpha 子',
  '',
  '子内容。',
  '',
  '## Beta',
  '',
  'Beta 内容。',
  '',
  '#### Beta 深',
  '',
  '深内容。',
  '',
  'Setext 标题',
  '============',
  '',
  'Setext 内容。',
  '',
  '# 第二顶',
  '',
  '内容。',
  '',
].join('\n')

// #70 拖拽排序样例：frontmatter（控制域外零变更锚点）+ 跨级（H4 挂 H2 下）
// + 文末段无尾换行（插入补换行/前置换行的边界载体）。
// 条目序列：0 甲(H1) 1 乙(H2) 2 丁(H4,跨级挂乙) 3 丙(H2) 4 戊(H1)
// 子树：甲=[甲,乙,丁,丙]（乙丁丙全挂甲下）、乙=[乙,丁]、丁=[丁]、丙=[丙]、戊=[戊]
const OUTLINE_DRAG_DOC = [
  '---',
  'title: 拖拽',
  '---',
  '',
  '# 甲',
  '甲内容。',
  '## 乙',
  '乙内容。',
  '#### 丁',
  '丁内容。',
  '## 丙',
  '丙内容。',
  '# 戊',
  '戊内容。',
].join('\n')

// #105 高亮样例：正文/标题/列表三处 ==高亮==（含嵌套粗体）；文档中 ==
// 字符只出现在成对高亮定界符中（live delimitersHidden 探针的文本口径依据）
const HIGHLIGHT_DOC = [
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

// #11 双链样例：合法四形态（按名/显式路径/别名/标题）+ 降级形态
// （嵌入/块引用/残缺）+ 代码上下文（围栏与行内代码内不解析）
const WIKILINKS_DOC = [
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
// #11 按名跳转目标：长文使「深处的标题」位于首屏外（阅读挂载定位的屏外目标）
const TARGET_NOTE_DOC = (() => {
  const out = ['# 目标笔记标题', '', '开篇段落。', '']
  for (let i = 1; i <= 200; i++) {
    out.push(`填充段落 ${i}：足够多的正文让「深处的标题」位于首屏之外。`, '')
  }
  out.push('# 深处的标题', '', '标题下的正文。', '')
  return out.join('\n')
})()
// #11 文本编辑器 reveal 目标：中部小节标题；#159 块引用目标：末尾块标记
const WIKILINK_TARGET_DOC = (() => {
  const out = ['# 双链跳转目标', '', '顶部段落。', '']
  for (let i = 2; i <= 30; i++) {
    out.push(`第 ${i} 段正文。`, '')
  }
  out.push('## 深处小节', '', '小节内容。', '')
  out.push('带块标记的段落。 ^blk-target', '')
  return out.join('\n')
})()
// CRLF 目标（view.locate 坐标系断言载体）：宿主系 offset 与 LF offset 在
// CRLF 文档上按行数差漂移，面板定位链路发送前必须转换（行内容与 LF 文档
// 同构，仅行尾为 \r\n）
const WIKILINK_CRLF_TARGET_DOC = (() => {
  const out = ['# CRLF 目标标题', '', '开篇段落。', '']
  for (let i = 2; i <= 30; i++) {
    out.push(`第 ${i} 段正文。`, '')
  }
  out.push('## CRLF 深处小节', '', '小节内容。', '')
  return out.join('\r\n')
})()
// #59 公式样例：混排段落、相邻行内公式、段内 $$、跨行块、普通美元、
// 行内代码/围栏排除、非法公式降级
const MATH_DOC = [
  '# 公式样例',
  '',
  '质量能量关系 $E=mc^2$ 出现在行内，段内块 $$a^2+b^2=c^2$$ 紧随其后。',
  '',
  '相邻公式 $x_1$ 与 $x_2$ 互不影响，普通价格 $5 与 $10 不是公式。',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '非法公式 $\\notdefined{x}$ 显示原文降级。',
  '',
  '`行内代码 $不渲染$` 与正文公式 $y=kx+b$。',
  '',
  '```text',
  '围栏内 $不渲染$',
  '```',
  '',
  '结尾段落。',
  '',
].join('\n')

// #60 Mermaid 主样例：流程图、时序图、相邻（含同源）多图、无效语法降级。
// live 侧围栏装饰 5 个（第 3 个语法无效——装饰照常发射，渲染层降级 error 态）；
// 计数断言口径：liveMermaidCount = 5、paint.mermaid.rendered = 4、error = 1。
// 紧凑排版（30 行内）保证默认视口可完整物化全部 widget。
const MERMAID_DOC = [
  '# Mermaid 图表样例',
  '',
  '```mermaid',
  'graph TD',
  'A[开始]-->B{判断}',
  'B-->|是| C[结束]',
  '```',
  '',
  '正文段落，图表之间保持可读文本。',
  '',
  '```mermaid',
  'sequenceDiagram',
  'Alice->>Bob: 你好',
  'Bob-->>Alice: 很好',
  '```',
  '',
  '```mermaid',
  '这不是合法的 mermaid 语法',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  'X-->Y',
  '```',
  '',
  '```mermaid',
  'flowchart LR',
  'X-->Y',
  '```',
  '',
  '结尾段落保持可用。',
  '',
].join('\n')

// #60 Mermaid 边界样例：普通代码围栏与外层长围栏内的伪 mermaid 围栏都不
// 得渲染图表（liveMermaidCount = 0），后续正文不受影响。
const MERMAID_EDGE_DOC = [
  '# 边界样例',
  '',
  '```js',
  'let a = 1',
  '```',
  '',
  '````md',
  '```mermaid',
  'A-->B',
  '```',
  '````',
  '',
  '结尾段落保持可用。',
  '',
].join('\n')

// #106 分割线样例：frontmatter 头块的两条 --- 与 Setext 标题下划线（=== 与
// 紧跟段落的 ---）都不判为分割线，正文真分割线三条（---/***/___ 各一）。
// 计数断言口径：paint.hr.count = 3（frontmatter/Setext 均不计数）。
const HR_DOC = [
  '---',
  'title: 分割线样例',
  '---',
  '',
  '分割线前的段落文字。',
  '',
  '---',
  '',
  '星号形态段落。',
  '',
  '***',
  '',
  '下划线形态段落。',
  '',
  '___',
  '',
  'Setext 标题正文',
  '===',
  '',
  '次级 Setext 标题正文',
  '---',
  '',
  '结尾段落，分割线插入锚点在此行中。',
  '',
].join('\n')

/**
 * 向目录写入全部集成测试 fixture（字节由脚本直接生成，不经 git 检出，
 * 避免 autocrlf 干扰断言）。返回 { largeDocLines } 供启动器注入环境变量。
 */
export function writeFixtures(wsDir, { generatePerfSample, generateReadingSample, generateMermaidDenseSample }) {
  writeFileSync(path.join(wsDir, 'lf.md'), LF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'find.md'), FIND_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'find-hidden-source.md'),
    '| name | state |\n| --- | --- |\n| build | ok |\n\nBelow the table.\n', 'utf8')
  // #241 替换头区排除样例：成型 frontmatter（title 值与 tags 项各含一次
  // 「目标词」——头区命中载体）与正文 3 处命中（替换排除断言载体）
  writeFileSync(path.join(wsDir, 'find-fm.md'), [
    '---',
    'title: 头区目标词样本',
    'tags:',
    '  - 目标词',
    '---',
    '',
    '第一段：这里有一个目标词，后续还有。',
    '',
    '第二段：又出现目标词了。',
    '',
    '结尾目标词三。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'style-contract.md'), STYLE_CONTRACT_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'chrome-contract.md'), CHROME_CONTRACT_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'untouched.md'), '未触碰文档\n保持原样\n', 'utf8')
  writeFileSync(path.join(wsDir, 'crlf.md'), CRLF_DOC, 'utf8')
  // #88/#89 独立 CRLF 样本：早期坐标测试会保存修改后的 crlf.md。
  writeFileSync(path.join(wsDir, 'format-crlf.md'), CRLF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'quick-actions-crlf.md'), CRLF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'split.md'), SPLIT_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'undo.md'), UNDO_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'undo2.md'), UNDO2_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'undo3.md'), UNDO3_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'undo4.md'), UNDO4_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'ackorder.md'), ACKORDER_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'resync.md'), RESYNC_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'ime-escape.md'), IME_ESC_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'symbol-input.md'), SYMBOL_INPUT_DOC, 'utf8')
  // #123 CRLF 补全用独立样本：crlf.md 会被早期坐标用例修改保存
  writeFileSync(path.join(wsDir, 'symbol-crlf.md'), CRLF_DOC, 'utf8')
  // #124 选区包裹：跨段与 CRLF 独立样本
  writeFileSync(path.join(wsDir, 'symbol-wrap.md'), SYMBOL_WRAP_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'symbol-wrap-crlf.md'), SYMBOL_WRAP_CRLF_DOC, 'utf8')
  // #125 Tab 越界：LF 与 CRLF 独立样本
  writeFileSync(path.join(wsDir, 'symbol-tab.md'), SYMBOL_TAB_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'symbol-tab-crlf.md'), SYMBOL_TAB_CRLF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'conflict.md'), CONFLICT_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'splitconflict.md'), SPLIT_CONFLICT_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'heading.md'), HEADING_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'typography.md'), TYPOGRAPHY_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'mode.md'), MODE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'viewport-mermaid.md'), VIEWPORT_MERMAID_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'mode-anchor.md'), MODE_ANCHOR_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'syntax.md'), SYNTAX_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'fence-chunk.md'), FENCE_CHUNK_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'task.md'), TASK_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table.md'), TABLE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'blockquote-table.md'), BLOCKQUOTE_TABLE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table42.md'), TABLE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table-cell-delete.md'), TABLE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table42-empty.md'), TABLE42_EMPTY_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table13.md'), TABLE13_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table43-crlf.md'), TABLE43_CRLF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'table-create-crlf.md'), TABLE_CREATE_CRLF_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'math.md'), MATH_DOC, 'utf8')
  // #60 Mermaid 样例：主样例（流程图/时序图/相邻同源多图/无效降级）与
  // 边界样例（普通围栏与伪围栏不误渲染）
  writeFileSync(path.join(wsDir, 'mermaid.md'), MERMAID_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'mermaid-edge.md'), MERMAID_EDGE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'hr.md'), HR_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'code-card.md'), CODE_CARD_DOC, 'utf8')
  // #60 图表密集性能样例（generateMermaidDenseSample 可选注入；缺省跳过）
  if (generateMermaidDenseSample) {
    writeFileSync(path.join(wsDir, 'perf-mermaid.md'), generateMermaidDenseSample(), 'utf8')
  }
  const largeLines = Array.from({ length: LARGE_DOC_LINES }, (_, i) => `第 ${i + 1} 行 ——固定宽度填充文本，用于长文档视口渲染验证——`)
  writeFileSync(path.join(wsDir, 'large.md'), largeLines.join('\n') + '\n', 'utf8')
  // 性能体量对比样例（#5）：同构普通段落 + 每 50 行一个二级标题
  const perfSizes = [['1k', 1_000], ['100k', 100_000]]
  for (const [name, lines] of perfSizes) {
    writeFileSync(path.join(wsDir, `perf-${name}.md`), generatePerfSample(lines), 'utf8')
  }
  // #7 阅读视图按需挂载：每行一块的样例（空行分隔），1k 与 100k 只差体量
  for (const [name, blocks] of [['reading-1k', 1_000], ['reading-100k', 100_000]]) {
    writeFileSync(path.join(wsDir, `${name}.md`), generateReadingSample(blocks), 'utf8')
  }
  // #7 图片尺寸变化定位样例：400 块中等体量，目标块上方有充足的已挂载缓冲块
  writeFileSync(path.join(wsDir, 'reading-image.md'), generateReadingSample(400), 'utf8')
  // #10 链接/图片样例：中文目标、空格目录（磁盘真实空格 + 文档内 %20 形态）、
  // 无扩展名目标与本地图片资源
  writeFileSync(path.join(wsDir, 'links.md'), LINKS_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'links2.md'), LINKS_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'linenumbers.md'), LINENUMBERS_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'outline.md'), OUTLINE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'outline-long.md'), OUTLINE_LONG_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'outline-style.md'), OUTLINE_STYLE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'outline-menu.md'), OUTLINE_MENU_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'outline-drag.md'), OUTLINE_DRAG_DOC, 'utf8')
  // #140 frontmatter 卡片编辑链路样例：成型头区（标量 + block 数组）与正文
  writeFileSync(path.join(wsDir, 'fm-edit.md'), [
    '---',
    'title: 集成标题',
    'tags:',
    '  - 甲',
    '---',
    '',
    '正文段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'highlight.md'), HIGHLIGHT_DOC, 'utf8')
  // #161 图片粘贴：落盘目标文档（默认 same-dir 模式下与本文档同目录）
  writeFileSync(path.join(wsDir, 'paste-image.md'), '# 图片粘贴样例\n\n正文段落。\n\n结尾。\n', 'utf8')
  writeFileSync(path.join(wsDir, '链接目标.md'), '# 链接目标\n中文目标文档内容。\n\n普通链接块引用目标段落。 ^link-blk\n', 'utf8')
  writeFileSync(path.join(wsDir, '无扩展名目标.md'), '# 无扩展名目标\n省略扩展名解析目标。\n', 'utf8')
  mkdirSync(path.join(wsDir, '子 目录'), { recursive: true })
  writeFileSync(path.join(wsDir, '子 目录', '目标 二.md'), '# 目标 二\n含空格路径的目标文档。\n', 'utf8')
  writeFileSync(path.join(wsDir, 'images.md'), IMAGES_DOC, 'utf8')
  // #208 手动刷新样例：图片行上方垫 24 行填充（图片行保持在 CM6 视口装饰
  // 范围内，装载即解析），下方 40 行尾部保证文档可滚动（刷新前后滚动位置
  // 保持断言需要非零 scrollTop）；图片资产独立文件名（用例会外部覆写该图
  // 字节，不得与 images/links 样例共用）
  writeFileSync(path.join(wsDir, 'refresh.md'), [
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
  ].join('\n'), 'utf8')
  mkdirSync(path.join(wsDir, 'assets'), { recursive: true })
  writeFileSync(path.join(wsDir, 'assets', '图片 一.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  // #201 图片刷新：初始绿图 + 备用蓝图（覆盖保存的新内容载体）+ 引用文档
  writeFileSync(path.join(wsDir, 'assets', '刷新甲.png'), Buffer.from(REFRESH_GREEN_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'assets', '刷新乙.png'), Buffer.from(REFRESH_GREEN_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'image-refresh.md'), [
    '# 图片刷新样例',
    '',
    '![刷新甲](assets/刷新甲.png)',
    '',
    '![刷新乙](assets/刷新乙.png)',
    '',
    '结尾段。',
    '',
  ].join('\n'), 'utf8')
  // #208 初始 1x1 透明图（刷新后用例覆写为 2x2 红色，naturalWidth 1→2
  // 证明浏览器实际解码了新代次地址的字节）
  writeFileSync(path.join(wsDir, 'assets', '刷新图.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  // #11 双链：源文档、按名/屏外标题目标、文本编辑器 reveal 目标、重名候选
  // 与大小写目标（Windows 宿主大小写不敏感匹配的断言载体）
  // #197 反链：两个引用者 + 被引目标（反链面板、四态与跳转断言载体）
  writeFileSync(path.join(wsDir, 'backlinks-a.md'), BACKLINKS_SOURCE_A_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'backlinks-b.md'), BACKLINKS_SOURCE_B_DOC, 'utf8')
  writeFileSync(path.join(wsDir, '反链目标.md'), BACKLINKS_TARGET_DOC, 'utf8')
  // 出链面板批次：源文档（命中/锚点/断链/外链四形态）+ 两个目标
  writeFileSync(path.join(wsDir, '出链源.md'), OUTLINKS_SOURCE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, '出链锚点目标.md'), OUTLINKS_ANCHOR_DOC, 'utf8')
  writeFileSync(path.join(wsDir, '出链普通目标.md'), OUTLINKS_PLAIN_DOC, 'utf8')
  // review-loops #18 宿主级退役用例：独立文档组（目标基线无引用 → 空态起
  // 步；幽灵来源基线不含目标引用 → 未保存编辑制造的引用是纯覆盖层幽灵）
  writeFileSync(path.join(wsDir, 'rl18-target.md'), [
    '# 退役目标',
    '',
    '正文。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'rl18-ghost.md'), [
    '# 幽灵来源',
    '',
    '基线无引用。',
    '',
  ].join('\n'), 'utf8')
  // #199 rename 引用改写：目标 + 根/子目录引用者 + 被移动文档与子文档 + 附件
  writeFileSync(path.join(wsDir, '改名目标.md'), RENAME_TARGET_DOC_WITH_ANCHOR, 'utf8')
  writeFileSync(path.join(wsDir, 'rename-ref-a.md'), RENAME_REF_A_DOC, 'utf8')
  mkdirSync(path.join(wsDir, 'notes'), { recursive: true })
  writeFileSync(path.join(wsDir, 'notes', 'rename-ref-b.md'), RENAME_REF_B_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'rename-moved.md'), RENAME_MOVED_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'notes', 'rename-note.md'), RENAME_NOTE_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'assets', 'rename-pic.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  // #269/#276：仅此连续 rename 用例使用这三篇文档。
  writeFileSync(path.join(wsDir, '链式目标.md'), RENAME_CHAIN_TARGET_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'rename-chain-ref-a.md'), RENAME_CHAIN_REF_A_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'notes', 'rename-chain-ref-b.md'), RENAME_CHAIN_REF_B_DOC, 'utf8')
  // #270/#309：三条退役路径各自独占文档，不继承 rename 或前一段的 soft revert buffer。
  for (const name of ['overlay-discard-custom.md', 'overlay-discard-native.md', 'overlay-revert-native.md']) {
    writeFileSync(path.join(wsDir, name), '# Overlay retirement\n', 'utf8')
  }
  // #200 目录/批量移动：目录（互链 + 嵌套 + 被引用附件）+ 外部引用者 + 上行目标
  mkdirSync(path.join(wsDir, 'dir-move', 'deep'), { recursive: true })
  writeFileSync(path.join(wsDir, 'dir-move', 'inner-a.md'), DIR_INNER_A_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'dir-move', 'inner-b.md'), DIR_INNER_B_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'dir-move', 'deep', 'inner-c.md'), DIR_INNER_C_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'dir-move', 'dir-pic.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'c-out.md'), DIR_OUTSIDE_C_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'dir-ref.md'), DIR_REF_DOC, 'utf8')
  // #200 多文件同批 rename：独立文档组（目标 + 根/子目录引用者 + 附件 + 出链载体）
  writeFileSync(path.join(wsDir, '批目标.md'), BATCH_TARGET_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'batch-ref-a.md'), BATCH_REF_A_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'notes', 'batch-ref-b.md'), BATCH_REF_B_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'batch-moved.md'), BATCH_MOVED_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'assets', 'batch-pic.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'wikilinks.md'), WIKILINKS_DOC, 'utf8')
  // #218 悬停预览：独立父文档（存在目标 + 缺失目标双链；不与共享样本的
  // 双链计数断言互相干扰——wikilinks.md 有 liveWikilinkCount===4 钉住（3 双链
  // + 1 混排嵌入 mark，#217 验收反馈起嵌入挂双链类））。
  // #219 追加局部锚点（章节/块/失效）与普通链接（全文/章节/页内/外站）
  // 段落——前两个双链序号不变（#218 用例 index 0/1 依赖）
  writeFileSync(path.join(wsDir, '悬停预览.md'), [
    '# 悬停预览样例',
    '',
    '指向 [[目标笔记]] 与缺失目标 [[悬停缺失目标]]。',
    '',
    '局部：[[悬停 局部目标#章节甲]]、块 [[悬停 局部目标#^hover-blk]] 与失效 [[悬停 局部目标#没有的标题]]。',
    '',
    '链接 [全文](悬停 局部目标.md)、[章节](悬停 局部目标.md#章节甲) 与 [页内](#悬停预览样例)。',
    '',
    '外部 [外站](https://example.com) 不预览。',
    '',
    // #220 来源资源段（追加在尾部：既有 #218/#219 用例的双链 index 0-4 与
    // 普通链接 index 0-2 不受影响）；目标在子目录 hover-assets/ 内（双链走
    // 根内相对路径）——其内相对图片/双链只有按 B 目录解析才能命中（按根/
    // A 目录解析即 not-found——B 身份解析的直接证据）
    '资源 [[hover-assets/悬停 资源目标]] 与 [资源链接](hover-assets/悬停 资源目标.md)。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '目标笔记.md'), TARGET_NOTE_DOC, 'utf8')
  // #222 嵌入：父文档（独占行全文/章节嵌入 + 混排 + 缺失目标）与目标文档
  // （frontmatter + 任务 + 章节结构 + 二层嵌入——一层展开场景）；二层目标
  // 文件名含空格（嵌入 inner 字面路径解析）。嵌入改写文档独立成组（rename
  // 用例的引用者，与漂移保护用例不共享）
  writeFileSync(path.join(wsDir, '嵌入样例.md'), [
    '# 嵌入样例',
    '',
    '![[嵌入目标]]',
    '',
    '混排嵌入 ![[嵌入目标]] 保留源文。',
    '',
    '![[嵌入目标#章节一]]',
    '',
    '![[嵌入缺失目标]]',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '嵌入目标.md'), [
    '---',
    'title: 嵌入目标',
    '---',
    '',
    '# 嵌入目标总览',
    '',
    '- [ ] 嵌入内任务',
    '',
    '## 章节一',
    '',
    '章节一段落。',
    '',
    '## 章节二',
    '',
    '![[嵌入 二层目标]]',
    '',
    '乙段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '嵌入 二层目标.md'), [
    '# 二层目标',
    '',
    '二层正文。',
    '',
  ].join('\n'), 'utf8')
  // P2-04（#281）嵌入内部 Live 编辑：独立文件对（不与 #222 嵌入样例共
  // 享目标——写回断言互不干扰）。父文档两枚同目标 occurrence（多端口
  // 隔离）；CRLF 目标为 CRLF 字节（坐标转换断言）。
  writeFileSync(path.join(wsDir, 'p204-编辑嵌入.md'), [
    '# P2-04 编辑嵌入',
    '',
    '![[p204-编辑目标]]',
    '',
    '中间段落。',
    '',
    '![[p204-编辑目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p207-容器混排.md'), [
    '# P2-07 容器混排',
    '',
    '前文混排 ![[p207-容器目标]] 后文混排。',
    '',
    '- 无序项 ![[p207-容器目标]] 无序余文',
    '- [ ] 任务项 ![[p207-容器目标]] 任务余文',
    '',
    '> 引用文 ![[p207-容器目标]] 引用余文',
    '',
    '收尾段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p207-容器目标.md'), [
    '# p207 容器目标',
    '',
    '容器目标首段。',
    '',
    '容器目标次段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p204-编辑目标.md'), [
    '# p204 编辑目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p204-CRLF嵌入.md'), [
    '# P2-04 CRLF 嵌入',
    '',
    '![[p204-CRLF目标]]',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p204-CRLF目标.md'),
    'p204 CRLF 目标首行\r\np204 第二行\r\n', 'utf8')
  // P2-08（#285）表格格内嵌入的内部 Live：父表格含转义别名（表头 + 数据
  // 格混排）与 #标题 形态——结构编辑不误伤、删行拦截与保存路由的宿主侧
  writeFileSync(path.join(wsDir, 'p208-表格嵌入.md'), [
    '# P2-08 表格格内 Live',
    '',
    '| ![[p208-表格目标\\|头别名]] | 头B | 头C |',
    '| --- | --- | --- |',
    '| 甲 ![[p208-表格目标\\|别名]] 乙 | ![[p208-表格目标#小节]] | 普通格 |',
    '| 数据行 | ![[p208-表格目标]] | 普通格二 |',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p208-表格目标.md'), [
    '# p208 表格目标',
    '',
    '目标首段。',
    '',
    '## 小节',
    '',
    '小节正文一段。',
    '',
  ].join('\n'), 'utf8')
  // P2-10（#287）引用完整 Live 操作：A 含唯一嵌入且自身无 frontmatter
  //（嵌入编辑器内的 fm 卡是全文档唯一的 Popover 目标）；B 带 frontmatter
  //（Popover 编辑链路）与正文（格式/表格命令目标）
  writeFileSync(path.join(wsDir, 'p210-操作嵌入.md'), [
    '# P2-10 操作嵌入',
    '',
    '![[p210-操作目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p210-操作目标.md'), [
    '---',
    'tags:',
    '  - 甲',
    '---',
    '# p210 操作目标',
    '',
    '目标首段文字。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  // P2-05（#282）显式关闭确认：独立文件对（同目标两 occurrence——多端口
  // 丢弃去重断言；不与 p204 共享目标——dirty/回滚断言互不干扰）
  writeFileSync(path.join(wsDir, 'p205-关闭嵌入.md'), [
    '# P2-05 关闭嵌入',
    '',
    '![[p205-关闭目标]]',
    '',
    '中间段落。',
    '',
    '![[p205-关闭目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p205-关闭目标.md'), [
    '# p205 关闭目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  // P2-12（#289）写入冲突三项选择：独立文件对（外部交错修改制造真实
  // 冲突暂停；compare 的 untitled/diff、discard、cancel 分径断言素材）
  writeFileSync(path.join(wsDir, 'p212-冲突嵌入.md'), [
    '# P2-12 冲突嵌入',
    '',
    '![[p212-冲突目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p212-冲突目标.md'), [
    '# p212 冲突目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  // P2-13（#290）父标签关闭交接：交接嵌入（同目标两 occurrence + 一个从未
  // 编辑的干净目标——去重与「干净不开」断言素材）与冲突嵌入（关闭时未
  // 提交输入的当次三项选择素材）；各自独立文件对，不与 p204/p205/p212
  // 共享目标——dirty/回滚断言互不干扰
  writeFileSync(path.join(wsDir, 'p213-交接嵌入.md'), [
    '# P2-13 交接嵌入',
    '',
    '![[p213-交接目标]]',
    '',
    '中间段落。',
    '',
    '![[p213-交接目标]]',
    '',
    '![[p213-干净目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p213-交接目标.md'), [
    '# p213 交接目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p213-干净目标.md'), [
    '# p213 干净目标',
    '',
    '干净目标首段。',
    '',
  ].join('\n'), 'utf8')
  // P2-09（#286）递归引用直接父模式与逐层目标编辑：A→B→C 三份可区分文本；
  // B 内多形态孙位（独占行/混排/列表/引用/表格格内——嵌套跟随与逐层编辑
  // 的组合素材；装载/来源校验/循环走生产真链路）
  writeFileSync(path.join(wsDir, 'p209-递归父A.md'), [
    '# P2-09 递归父 A',
    '',
    '![[p209-递归B]]',
    '',
    'A 尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p209-递归B.md'), [
    '# p209 递归 B',
    '',
    '![[p209-递归C]]',
    '',
    '前文混排 ![[p209-递归C|混排位]] 后文混排。',
    '',
    '- 列表项 ![[p209-递归C|列表位]] 列表余文',
    '',
    '> 引用文 ![[p209-递归C|引用位]] 引用余文',
    '',
    '| 格内头 | 普通头 |',
    '| --- | --- |',
    '| ![[p209-递归C\\|格内位]] | 普通格 |',
    '',
    'B 尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p209-递归C.md'), [
    '# p209 递归 C',
    '',
    'C 首段正文。',
    '',
    'C 次段正文。',
    '',
  ].join('\n'), 'utf8')
  // P2-14（#291）组合收口：表格格内三层递归（A 表格 → B → C）组合素材 +
  // B 含代码块（代码卡复制经端口落宿主剪贴板的端到端素材）
  writeFileSync(path.join(wsDir, 'p214-组合父A.md'), [
    '# P2-14 组合父 A',
    '',
    '| 格头 | 普通头 |',
    '| --- | --- |',
    '| ![[p214-组合B\\|格内位]] | 普通格 |',
    '',
    'A 尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p214-组合B.md'), [
    '# p214 组合 B',
    '',
    '![[p214-组合C]]',
    '',
    '```js',
    'const combo = 1',
    '```',
    '',
    'B 尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p214-组合C.md'), [
    '# p214 组合 C',
    '',
    'C 首段正文。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p213-冲突嵌入.md'), [
    '# P2-13 冲突嵌入',
    '',
    '![[p213-冲突目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p213-冲突目标.md'), [
    '# p213 冲突目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')

  // P2-06/#283 悬停浮窗根引用内部 Live：Live 父继承与手动切换/位置记忆链路
  writeFileSync(path.join(wsDir, 'p206-悬停Live.md'), [
    '# P2-06 悬停 Live',
    '',
    '指向 [[p206-编辑目标]] 的双链（Live 正文 Ctrl+悬停进入）。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'p206-编辑目标.md'), [
    '# p206 编辑目标',
    '',
    '目标首段。',
    '',
    '目标次段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '嵌入改写.md'), [
    '# 嵌入改写',
    '',
    '嵌入 ![[改名嵌入目标]] 与锚点 ![[改名嵌入目标#章节一|别名]]。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '改名嵌入目标.md'), [
    '# 改名嵌入目标',
    '',
    '正文。',
    '',
    '## 章节一',
    '',
    '章节内容。',
    '',
  ].join('\n'), 'utf8')
  // #248 表格格内嵌入：表头/数据格、转义别名与锚点形态（双模式挂载 +
  // 格内索引边与 rename 的转义保真观测素材）。别名管道一律写成 `\|`
  // （GFM 格内转义——不切列），rename 用例与 #222 的改名嵌入目标共用目标
  writeFileSync(path.join(wsDir, '嵌入表格样例.md'), [
    '# 嵌入表格样例',
    '',
    '| ![[嵌入目标\\|头别名]] | 短列 | 备注列 |',
    '| --- | --- | --- |',
    '| 前文 ![[嵌入目标]] 中 ![[改名嵌入目标#章节一\\|格内别名]] 后文 | 普通格 |',
    '| 无嵌入行 | 123 |',
    '',
  ].join('\n'), 'utf8')
  // #224 引用视图同步：独立父文档组（嵌入 + 悬停双链）与目标文档——
  // 未保存修改推送（applyEdit 不保存）、外部磁盘变化（writeFile/unlink/
  // 恢复）、订阅计数回落与自引用防循环的观测素材。目标正文含可断言的
  // 修改前/后标记文本
  writeFileSync(path.join(wsDir, '同步父文档.md'), [
    '# 同步父文档',
    '',
    '悬停 [[同步目标]] 与嵌入：',
    '',
    '![[同步目标]]',
    '',
    '![[同步目标2]]',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '同步目标.md'), [
    '# 同步目标标题',
    '',
    '修改前正文：同步目标初始内容。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '同步目标2.md'), [
    '# 同步目标2标题',
    '',
    '目标二初始内容：外部磁盘变化前的正文。',
    '',
  ].join('\n'), 'utf8')
  // #249 引用组合链：生命周期串联（未保存编辑推送×浮层快速目标切换×
  // 模式切换往返×面板销毁）的独立观测素材——不与 #224 文档共用（共用
  // 样本会被早期用例修改保存，SYMBOL_WRAP_CRLF_DOC 教训）。正文含可
  // 断言的修改前标记文本；父文档两个普通双链作浮层快速切换的目标序列
  writeFileSync(path.join(wsDir, '组合链父文档.md'), [
    '# 组合链父文档',
    '',
    '悬停目标序列：[[组合链目标A]] 与 [[组合链目标B]]。',
    '',
    '![[组合链目标A]]',
    '',
    '![[组合链目标B]]',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '组合链目标A.md'), [
    '# 组合链目标A标题',
    '',
    '组合链A初始正文段：修改前标记。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, '组合链目标B.md'), [
    '# 组合链目标B标题',
    '',
    '组合链B初始正文段。',
    '',
  ].join('\n'), 'utf8')
  // #244 真宿主递归：B/C 分别位于不同目录，下一层同名相对链接只能
  // 从直接父文件目录解析；D 的 E 为第四层深度占位。
  mkdirSync(path.join(wsDir, 'ref-depth', 'one'), { recursive: true })
  mkdirSync(path.join(wsDir, 'ref-depth', 'two'), { recursive: true })
  mkdirSync(path.join(wsDir, 'ref-depth', 'three'), { recursive: true })
  writeFileSync(path.join(wsDir, '递归父文档.md'), '![[ref-depth/one/B]]\n', 'utf8')
  // #245 悬停根 B 复用同一 B→C→D 链；正文父文档自身不挂卡。
  writeFileSync(path.join(wsDir, '悬停递归.md'), '[[ref-depth/one/B]]\n', 'utf8')
  writeFileSync(path.join(wsDir, 'ref-depth', 'one', 'B.md'), '# B 一层\n\n![[../two/C]]\n', 'utf8')
  writeFileSync(path.join(wsDir, 'ref-depth', 'two', 'C.md'), '# C 二层\n\n![[../three/D]]\n', 'utf8')
  writeFileSync(path.join(wsDir, 'ref-depth', 'three', 'D.md'), '# D 三层\n\n![[E]]\n', 'utf8')
  writeFileSync(path.join(wsDir, 'ref-depth', 'three', 'E.md'), '# E 四层\n', 'utf8')
  // #246 混排/列表/引用容器：父文档 A 的嵌入与文字混排、在列表/引用/任务
  // 项与懒续行内；B 内含「文字混排的 C 引用」——宿主 validChildSource 的
  // 混排准入（不再要求独占行）沿真实子请求链验证。表格格内与链接域内
  // 保持占位文本不升级（#248 前）。
  writeFileSync(path.join(wsDir, '混排嵌入父文档.md'), [
    '# 混排嵌入父文档',
    '',
    '前文段落 ![[ref-depth/one/B 混排]] 后文段落。',
    '',
    '- 无序项 ![[ref-depth/one/B 混排]] 项内余文',
    '- 懒续项',
    '  续行 ![[ref-depth/one/B 混排]] 续余',
    '',
    '- [ ] 任务项 ![[ref-depth/one/B 混排]] 完成度',
    '',
    '> 引用前文 ![[ref-depth/one/B 混排]] 引用后文',
    '',
    '链接域 [文字 ![[ref-depth/one/B 混排]] 形态](https://e.example/x) 保持占位。',
    '',
    '| 列甲 | 列乙 |',
    '| --- | --- |',
    '| 单元 | 格内 ![[ref-depth/one/B 混排]] 占位 |',
    '',
  ].join('\n'), 'utf8')
  // B 的混排形态：文字混排 C + 引用内 C（宿主对 B 内混排子来源的准入）
  writeFileSync(path.join(wsDir, 'ref-depth', 'one', 'B 混排.md'), [
    '# B 混排一层',
    '',
    'B 前文 ![[../two/C]] B 后文。',
    '',
    '> 引用内 ![[../two/C]] 引用余',
    '',
  ].join('\n'), 'utf8')
  // 自引用：文档嵌入自身（A 嵌入 A——编辑自身后推送-重载不得循环）
  writeFileSync(path.join(wsDir, '同步自引用.md'), [
    '# 自引用文档',
    '',
    '![[同步自引用]]',
    '',
    '自引用正文：初始。',
    '',
  ].join('\n'), 'utf8')
  // #219 局部范围矩阵目标：文件名含中文与空格（链接 percent-decode 与
  // 双链字面路径两种写法解析到同一目标），行尾 CRLF（宿主 LF 换算矩阵：
  // 章节/块 range 经 NewlineCoordinator 换算后过滤结果与 LF 文档同构）
  writeFileSync(path.join(wsDir, '悬停 局部目标.md'), [
    '# 局部目标总览',
    '',
    '顶部段（章节甲外）。',
    '',
    '## 章节甲',
    '',
    '甲段一。',
    '',
    '- 列表项一',
    '- 列表项二 ^hover-blk',
    '',
    '## 章节乙',
    '',
    '乙段（章节甲外）。',
    '',
  ].join('\r\n'), 'utf8')
  // #220 来源资源目标：位于子目录 hover-assets/（成型 frontmatter + 相对
  // 图片 + 内部双链）——图片 res.png 与双链目标 资源内链目标.md 都只在该
  // 子目录内存在，按 A 目录/根解析必 not-found，B 身份解析才能命中
  mkdirSync(path.join(wsDir, 'hover-assets'), { recursive: true })
  writeFileSync(path.join(wsDir, 'hover-assets', '悬停 资源目标.md'), [
    '---',
    'title: 资源目标',
    'kind: note',
    '---',
    '',
    '# 资源目标标题',
    '',
    '![资源图](res.png)',
    '',
    '内部双链 [[资源内链目标]] 与子目录说明段。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'hover-assets', 'res.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'hover-assets', '资源内链目标.md'), [
    '# 资源内链目标',
    '',
    '只在 hover-assets 子目录内存在的目标（B 身份解析的命中判据）。',
    '',
  ].join('\n'), 'utf8')
  // P2-11（#288）嵌入内部 Live 的 B 目录资源：父文档在根目录、目标 B 在
  // 子目录 embed-assets/ 内——图片 only-in-b.png、内链目标（普通链接与双链
  // 双形态）都只在该子目录存在，按 A 目录/根解析必 not-found；B 粘贴资产
  // 的 same-dir+assets 目录（embed-assets/assets/）也按 B 归属（磁盘位置
  // 断言：根目录不得出现新资产）
  writeFileSync(path.join(wsDir, 'p211-资源嵌入.md'), [
    '# 嵌入资源父文档',
    '',
    '![[embed-assets/嵌入资源目标]]',
    '',
    '尾部段落。',
    '',
  ].join('\n'), 'utf8')
  mkdirSync(path.join(wsDir, 'embed-assets'), { recursive: true })
  writeFileSync(path.join(wsDir, 'embed-assets', '嵌入资源目标.md'), [
    '# 嵌入资源目标标题',
    '',
    '![B 图](only-in-b.png)',
    '',
    '[B 链接](内链目标.md) 与双链 [[B内双链目标]]。',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(path.join(wsDir, 'embed-assets', 'only-in-b.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 'embed-assets', '内链目标.md'), '# 内链目标\n\n只在 embed-assets 内的普通链接目标。\n', 'utf8')
  writeFileSync(path.join(wsDir, 'embed-assets', 'B内双链目标.md'), '# B内双链目标\n\n只在 embed-assets 内的双链目标。\n', 'utf8')
  writeFileSync(path.join(wsDir, 'wikilink-target.md'), WIKILINK_TARGET_DOC, 'utf8')
  writeFileSync(path.join(wsDir, 'wikilink-crlf-target.md'), WIKILINK_CRLF_TARGET_DOC, 'utf8')
  // #162 复制块链接：frontmatter 头区（不接管断言）、标题行/普通段/表格/
  // 既有 id 段（菜单两态与零写回断言载体）；#183 补围栏行（统一菜单降级
  // 矩阵的围栏区断言载体）
  writeFileSync(path.join(wsDir, 'block-menu.md'), [
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
  ].join('\n'), 'utf8')
  mkdirSync(path.join(wsDir, 'dup'), { recursive: true })
  writeFileSync(path.join(wsDir, 'dup', '甲.md'), '# 重名甲（dup 目录）\n', 'utf8')
  mkdirSync(path.join(wsDir, 'other'), { recursive: true })
  writeFileSync(path.join(wsDir, 'other', '甲.md'), '# 重名甲（other 目录）\n', 'utf8')
  writeFileSync(path.join(wsDir, 'CaseNote.md'), '# 大小写目标\n英文命名的目标笔记。\n', 'utf8')
  // #278 P2-01 真宿主探针 fixture：每用例独立文件对（-a.md = 面板甲 A，
  // -b.md = 引用目标乙 B；hand 用例另有 -c.md 旁观丙）。用例各自把缓冲与
  // 磁盘还原回以下字节后结束，跨用例零污染。
  for (const name of ['save', 'guard', 'route', 'pf', 'share', 'atomic', 'revert', 'late', 'ro', 'diff', 'diff-fail', 'recycle', 'hand', 'hand2', 'inflight', 'clean']) {
    writeFileSync(path.join(wsDir, `p201-${name}-a.md`), `# P2-01 ${name} 甲面板\n\n甲正文行\n`, 'utf8')
    writeFileSync(path.join(wsDir, `p201-${name}-b.md`), `P2-01 ${name} 乙第一行\n乙第二行\n`, 'utf8')
  }
  writeFileSync(path.join(wsDir, 'p201-hand-c.md'), 'P2-01 hand 旁观丙\n', 'utf8')
  return { largeDocLines: LARGE_DOC_LINES }
}
