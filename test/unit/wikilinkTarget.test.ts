// 宿主侧双链锚点定位契约（工单 #11 起；#196 后单一职责）：
// - findHeadingOffset：目标文档内标题定位——trim、空白折叠、大小写不敏感、
//   剥离 ATX 收尾 #、跳过围栏代码内伪标题；setext 标题不匹配（一期规则）
// - findBlockOffset / normalizeHeadingText：块定位与标题比较键
// 文件目标解析契约（#196 根内相对路径语义）已迁移至
// test/unit/vaultLink.test.ts（单一实现 src/shared/vaultLink.ts）。
import { describe, it, expect } from 'vitest'
import {
  findBlockOffset,
  findHeadingOffset,
  normalizeHeadingText,
} from '../../src/host/wikilinkTarget'

describe('findHeadingOffset：目标文档标题定位（标题规范化写入测试）', () => {
  const DOC = [
    '# 顶部标题',
    '',
    '正文一。',
    '',
    '## 中部  小节', // 内部双空格
    '',
    '```text',
    '# 围栏内伪标题',
    '```',
    '',
    '## 中部小节', // 折叠空白后与上行同名——首个（围栏前）命中
    '',
    '### 带 收尾 #',
    '',
    '####### 七个井号不是标题',
    '',
    '    # 四空格缩进是代码块',
    '',
    '收尾段。',
    '',
  ].join('\n')

  it('trim + 内部空白折叠 + 大小写不敏感；首个命中（围栏内伪标题跳过）', () => {
    const hit = findHeadingOffset(DOC, '中部  小节')
    expect(hit).not.toBeNull()
    expect(DOC.slice(hit!.offset, hit!.end)).toBe('## 中部  小节')
    // 大小写不敏感命中英文
    const doc2 = '# Alpha Section\n\n正文\n'
    const hit2 = findHeadingOffset(doc2, 'alpha SECTION')
    expect(doc2.slice(hit2!.offset, hit2!.end)).toBe('# Alpha Section')
  })

  it('ATX 收尾 # 序列剥离后匹配；七个井号不是标题；缩进代码不是标题', () => {
    const hit = findHeadingOffset(DOC, '带 收尾')
    expect(hit).not.toBeNull()
    expect(DOC.slice(hit!.offset, hit!.end)).toBe('### 带 收尾 #')
    expect(findHeadingOffset(DOC, '七个井号不是标题')).toBeNull()
    expect(findHeadingOffset(DOC, '四空格缩进是代码块')).toBeNull()
  })

  it('围栏内的 # 行不作为标题（``` 与 ~~~ 两种围栏）', () => {
    const doc = '# 真\n\n~~~\n# 假\n~~~\n\n```js\n// 注释\n```\n'
    expect(DOC && findHeadingOffset(doc, '真')).not.toBeNull()
    expect(findHeadingOffset(doc, '假')).toBeNull()
  })

  it('setext 标题不匹配（一期规则：仅 ATX）；无命中返回 null', () => {
    const doc = '小节文本\n===\n\n正文\n'
    expect(findHeadingOffset(doc, '小节文本')).toBeNull()
    expect(findHeadingOffset(doc, '不存在')).toBeNull()
  })

  it('CRLF 行尾容错（宿主 TextDocument 可能保留 CRLF）', () => {
    const doc = '# 标题甲\r\n正文\r\n## 标题乙\r\n'
    const hit = findHeadingOffset(doc, '标题乙')
    expect(hit).not.toBeNull()
    expect(doc.slice(hit!.offset, hit!.end)).toBe('## 标题乙')
  })

  it('end 为标题行行尾（不含换行）——selection reveal 的区间依据', () => {
    const doc = '# 甲\n正文行\n'
    const hit = findHeadingOffset(doc, '甲')!
    expect(hit.end - hit.offset).toBe('# 甲'.length)
  })
})

describe('normalizeHeadingText：标题比较键', () => {
  it('trim + 空白折叠 + 小写', () => {
    expect(normalizeHeadingText('  中部   小节 ')).toBe('中部 小节')
    expect(normalizeHeadingText('ABC')).toBe('abc')
  })
})

describe('findBlockOffset：目标文档块定位（#159，块 id 行尾标记扫描）', () => {
  const DOC = [
    '# 文档标题', // 0
    '',
    '开头段落末行。 ^first-blk', // 2：文件头之后首个块（前无空行边界=文档首行）
    '',
    '列表引导行：', // 4
    '- 项目一', // 5
    '- 项目二 ^list-blk', // 6：列表块尾，块首=引导行
    '',
    '```js', // 8：开围栏
    'const x = 1 ^in-fence', // 9：围栏内部——不视为块标记
    'const y = 2', // 10
    '``` ^code-blk', // 11：闭围栏行行尾 id——围栏代码块标记（块首=开围栏行）
    '',
    '段落乙第一行', // 13
    '段落乙第二行 ^second-blk', // 14：多行段落块，id 在块尾行
    '',
    '行内代码 `a ^in-code` 原文', // 16：行内代码内字面 ^id 不是行尾标记
    '',
    '重复块甲 ^dup-blk', // 18
    '',
    '重复块乙 ^dup-blk', // 20：同 id 多命中取首
    '',
  ].join('\n')

  it('单行块：offset/end 为块首行行首到行尾（不含换行）', () => {
    const hit = findBlockOffset(DOC, 'first-blk')!
    expect(hit).not.toBeNull()
    expect(DOC.slice(hit.offset, hit.end)).toBe('开头段落末行。 ^first-blk')
    expect(hit.end - hit.offset).toBe('开头段落末行。 ^first-blk'.length)
  })

  it('列表块尾：命中行向上回溯到块首行（引导行与列表项之间无空行）', () => {
    const hit = findBlockOffset(DOC, 'list-blk')!
    expect(DOC.slice(hit.offset, hit.end)).toBe('列表引导行：')
  })

  it('围栏内部不命中；闭围栏行行尾 id 命中且块首=开围栏行', () => {
    expect(findBlockOffset(DOC, 'in-fence')).toBeNull()
    const hit = findBlockOffset(DOC, 'code-blk')!
    expect(DOC.slice(hit.offset, hit.end)).toBe('```js')
  })

  it('围栏与相邻普通块互不吞并（与 blockRangeOfLine 同款文本对拍）', () => {
    // 无空行紧贴：段落 ^p1 下贴开围栏、para2 上贴闭围栏——围栏行是块边界，
    // 两段落各自成块（CommonMark 围栏是独立 leaf block）。修复前 para2 的
    // 回溯会穿过围栏吞到文件头（块首=para ^p1 行），与 webview 右键写入
    // id 的块（blockRangeOfLine：块首=para2 自身）不一致——#159/#162 闭环
    const doc = ['para ^p1', '```', 'code', '```', 'para2 ^p2'].join('\n')
    const h1 = findBlockOffset(doc, 'p1')!
    expect(doc.slice(h1.offset, h1.end)).toBe('para ^p1')
    const h2 = findBlockOffset(doc, 'p2')!
    expect(doc.slice(h2.offset, h2.end)).toBe('para2 ^p2')
  })

  it('段落紧邻闭围栏无空行：多行段落块首=段落首行而非围栏开行', () => {
    const doc = [
      '```js',
      'const x = 1',
      '```',
      '段落甲', // 紧贴闭围栏（无空行）——段落块首
      '段落乙 ^adj-blk',
    ].join('\n')
    const hit = findBlockOffset(doc, 'adj-blk')!
    expect(doc.slice(hit.offset, hit.end)).toBe('段落甲')
  })

  it('多行段落：id 在块尾行，块首为段落首行', () => {
    const hit = findBlockOffset(DOC, 'second-blk')!
    expect(DOC.slice(hit.offset, hit.end)).toBe('段落乙第一行')
  })

  it('行内代码内的字面 ^id 不视为块标记（其后有反引号，不是行尾）', () => {
    expect(findBlockOffset(DOC, 'in-code')).toBeNull()
  })

  it('同 id 多命中取首；未命中与空 id 返回 null', () => {
    const hit = findBlockOffset(DOC, 'dup-blk')!
    expect(DOC.slice(hit.offset, hit.end)).toBe('重复块甲 ^dup-blk')
    expect(findBlockOffset(DOC, '不存在')).toBeNull()
    expect(findBlockOffset(DOC, '')).toBeNull()
  })

  it('id 全字匹配：`^abc-def` 不被 `abc` 或 `def` 命中', () => {
    const doc = '正文 ^abc-def\n'
    expect(findBlockOffset(doc, 'abc')).toBeNull()
    expect(findBlockOffset(doc, 'def')).toBeNull()
    const hit = findBlockOffset(doc, 'abc-def')!
    expect(doc.slice(hit.offset, hit.end)).toBe('正文 ^abc-def')
  })

  it('文件首行即块标记：块首=文件头 offset 0', () => {
    const doc = '首行文字。 ^head-blk\n\n后续\n'
    const hit = findBlockOffset(doc, 'head-blk')!
    expect(hit.offset).toBe(0)
    expect(doc.slice(hit.offset, hit.end)).toBe('首行文字。 ^head-blk')
  })

  it('CRLF 行尾容错：宿主系坐标（\\r 计入 offset，end 不含行尾）', () => {
    const doc = '# 标题\r\n\r\n段落甲\r\n第二行 ^crlf-blk\r\n\r\n尾部\r\n'
    const hit = findBlockOffset(doc, 'crlf-blk')!
    expect(doc.slice(hit.offset, hit.end)).toBe('段落甲')
    // 块首行 offset 为宿主系（含前文 \r\n 计数）
    expect(hit.offset).toBe('# 标题\r\n\r\n'.length)
  })

  it('id 与正文之间至少一个空格：行首 `^id` 或紧贴正文不命中', () => {
    expect(findBlockOffset('^bare-id\n', 'bare-id')).toBeNull()
    expect(findBlockOffset('正文^no-space\n', 'no-space')).toBeNull()
  })
})

describe('findBlockOffset：独立行块 id 形态（#163 验收反馈，增集不改行尾行为）', () => {
  it('空行隔开的独立行（Obsidian 默认写入形态）：命中并归属上方块', () => {
    const doc = '段落甲\n第二行\n\n^std-blk\n\n后文\n'
    const hit = findBlockOffset(doc, 'std-blk')!
    expect(doc.slice(hit.offset, hit.end)).toBe('段落甲')
    expect(hit.offset).toBe(0)
  })

  it('紧贴块尾的独立行（无空行）：命中并归属上方块', () => {
    const doc = '前置\n\n段落甲\n^tight-blk\n\n后文\n'
    const hit = findBlockOffset(doc, 'tight-blk')!
    expect(doc.slice(hit.offset, hit.end)).toBe('段落甲')
    expect(hit.offset).toBe('前置\n\n'.length)
  })

  it('围栏块的独立行 id（闭围栏后空行 + ^id）：块首=开围栏行', () => {
    const doc = '```js\nconst a = 1\n```\n\n^fence-std\n'
    const hit = findBlockOffset(doc, 'fence-std')!
    expect(doc.slice(hit.offset, hit.end)).toBe('```js')
    expect(hit.offset).toBe(0)
  })

  it('围栏内部的独立行 ^id 是代码内容：不命中', () => {
    const doc = '```js\n^inside-std\n```\n'
    expect(findBlockOffset(doc, 'inside-std')).toBeNull()
  })

  it('文件头悬挂的独立行（上方无块）：不命中', () => {
    expect(findBlockOffset('^orphan-blk\n\n正文\n', 'orphan-blk')).toBeNull()
    expect(findBlockOffset('\n\n^orphan-blk\n', 'orphan-blk')).toBeNull()
  })

  it('行尾与独立行双形态并存：各自命中各块；同 id 多命中取文档序首', () => {
    const doc = '块甲 ^tail-blk\n\n块乙\n\n^std-blk\n\n块丙 ^tail-blk\n'
    // 行尾形态的块首行区间含标记（#159 既有口径：行首到行尾整行）
    const tailHit = findBlockOffset(doc, 'tail-blk')!
    expect(doc.slice(tailHit.offset, tailHit.end)).toBe('块甲 ^tail-blk')
    // 独立行形态的块首行区间不含标记行（标记行不属于块）
    const stdHit = findBlockOffset(doc, 'std-blk')!
    expect(doc.slice(stdHit.offset, stdHit.end)).toBe('块乙')
  })

  it('列表块的独立行 id：跨空行回溯列表块首行', () => {
    const doc = '前言\n\n- 项一\n- 项二\n\n^list-std\n'
    const hit = findBlockOffset(doc, 'list-std')!
    expect(doc.slice(hit.offset, hit.end)).toBe('- 项一')
  })

  it('CRLF 行尾容错：宿主系坐标（\\r 计入 offset）', () => {
    const doc = '段落甲\r\n\r\n^crlf-std\r\n\r\n尾部\r\n'
    const hit = findBlockOffset(doc, 'crlf-std')!
    expect(doc.slice(hit.offset, hit.end)).toBe('段落甲')
    expect(hit.offset).toBe(0) // 块首=段落甲行首（文件头），\r 计入 end 之后各偏移
    expect(hit.end).toBe('段落甲'.length) // 行尾 \r 不计入 end（剥 \r 后行宽）
  })
})
