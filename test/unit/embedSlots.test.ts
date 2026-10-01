// #246 混排嵌入的识别配对与 DOM 提升（模块级 jsdom 直驱）：
// - blockEmbedOccurrences：块区间内嵌入 occurrence 扫描（lezer 语法上下文
//   排除代码/表格/注释——与 refExpansion/vaultLinkExtract 同源边界）
// - pairEmbedSlots：块 DOM 内占位 span 与源文 occurrence 的顺序配对
//   （inner 计数匹配；不一致整块降级不升级）
// - promoteEmbedSlot：占位提升为块级卡片宿主——p 拆分保合法 DOM、行内
//   格式祖先拆壳（粗体/斜体/高亮横跨时前后半各自完整）、列表/引用容器
//   内直接落位（编号/缩进/边条容器不拆）、链接域与表格内不提升（#248 前
//   表格保持占位文本）
// 真实指针/观感在 test/browser；本文件只钉 DOM 形态契约。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  blockEmbedOccurrences,
  directEmbedSlots,
  pairEmbedSlots,
  promoteEmbedSlot,
  promoteEmbedSlotsInBlock,
  promotedHostsOf,
  type EmbedSlotOccurrence,
} from '../../src/webview/embedSlots'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { createReadingBlockElement } from '../../src/webview/readingView'

/** 构造一个块的挂载现场：splitReadingBlocks + createReadingBlockElement */
function mountedBlockOf(text: string, index = 0): { el: HTMLElement; text: string } {
  const blocks = splitReadingBlocks(text)
  expect(blocks.length).toBeGreaterThan(index)
  const block = blocks[index]!
  return { el: createReadingBlockElement(block, text), text }
}

/** 块内直属占位（升级前查询；排除卡片内嵌套） */
function slotsOf(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('[data-vsidian-embed-inner]'))
    .filter((n) => n.closest('.vsidian-embed-card') === null)
}

beforeEach(() => {
  document.body.textContent = ''
})

describe('blockEmbedOccurrences：块区间嵌入 occurrence 扫描', () => {
  it('混排行命中：区间为嵌入原文精确边界，inner 未 trim', () => {
    const text = '前文 ![[笔记乙]] 后文'
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inner).toBe('笔记乙')
    expect(hits[0]!.start).toBe(text.indexOf('![['))
    expect(hits[0]!.end).toBe(text.indexOf('![[') + '![[笔记乙]]'.length)
  })

  it('同块多嵌入保持源顺序', () => {
    const text = '起 ![[甲]] 中 ![[乙]] 末 ![[甲]] 收'
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['甲', '乙', '甲'])
    expect(hits[0]!.start).toBeLessThan(hits[1]!.start)
    expect(hits[1]!.start).toBeLessThan(hits[2]!.start)
  })

  it('行内代码/围栏/缩进代码内的字面量不命中', () => {
    const text = [
      '段 `code ![[x]]` 段',
      '',
      '```md',
      '![[x]]',
      '```',
      '',
      '    ![[x]]',
      '',
      '真 ![[y]]',
    ].join('\n')
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['y'])
  })

  it('HTML 注释内的嵌入不命中（注释排除与渲染侧剥离同源）', () => {
    const text = '前 <!-- ![[x]] --> 中 ![[y]] 后'
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['y'])
  })

  it('表格行格内命中（#248 开放：格内解码扫描，区间为源文精确边界）', () => {
    const text = '| a | ![[x]] |\n| --- | --- |\n| b | ![[y\\|别名]] |'
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['x', 'y|别名'])
    for (const hit of hits) {
      // 区间 slice 回源文恰为嵌入原文（含转义管道）
      expect(text.slice(hit.start, hit.end)).toBe(
        hit.inner === 'x' ? '![[x]]' : '![[y\\|别名]]')
    }
  })

  it('列表与引用前缀行照常命中（含任务与懒续行形态）', () => {
    const text = [
      '- [ ] 任务 ![[甲]] 完成',
      '  续行 ![[乙]]',
      '> 引用 ![[丙]] 文',
    ].join('\n')
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['甲', '乙', '丙'])
    for (const hit of hits) {
      expect(text.slice(hit.start, hit.end)).toBe(`![[${hit.inner}]]`)
    }
  })

  it('frontmatter 区间不命中', () => {
    const text = '---\nkey: v\n---\n\n正文 ![[甲]]'
    const fmEnd = text.indexOf('\n\n')
    expect(blockEmbedOccurrences(text, 0, fmEnd)).toHaveLength(0)
  })
})

describe('pairEmbedSlots：占位与 occurrence 顺序配对', () => {
  it('渲染占位与扫描命中按 inner 分组计数配对', () => {
    const text = '前 ![[甲]] 中 ![[乙]] 后 ![[甲]] 尾'
    const { el } = mountedBlockOf(text)
    const slots = slotsOf(el)
    expect(slots).toHaveLength(3)
    const paired = pairEmbedSlots(slots, blockEmbedOccurrences(text, 0, text.length))
    expect(paired).not.toBeNull()
    expect(paired!.map((p) => p.slot)).toEqual(slots)
    expect(paired![0]!.occ.inner).toBe('甲')
    expect(paired![1]!.occ.inner).toBe('乙')
    expect(paired![2]!.occ.start).toBeGreaterThan(paired![1]!.occ.start)
  })

  it('inner 序列不一致（识别面分叉）返回 null——整块降级不升级', () => {
    const text = '前 ![[甲]] 后'
    const { el } = mountedBlockOf(text)
    const slots = slotsOf(el)
    const wrong: EmbedSlotOccurrence[] = [{ inner: '乙', start: 0, end: 7 }]
    expect(pairEmbedSlots(slots, wrong)).toBeNull()
  })

  it('代码内字面量不出占位：扫描侧由语法排除保证序列一致', () => {
    const text = '用 `![[x]]` 语法嵌入真 ![[y]] 目标'
    const { el } = mountedBlockOf(text)
    const slots = slotsOf(el)
    expect(slots).toHaveLength(1)
    expect(pairEmbedSlots(slots, blockEmbedOccurrences(text, 0, text.length))).not.toBeNull()
  })
})

describe('promoteEmbedSlot：占位提升为块级卡片宿主', () => {
  it('p 内混排：拆为 p(前) + 宿主 + p(后)，前后文文本与行内标记保留', () => {
    const text = '前文 **加粗** ![[甲]] 后文 *斜体*'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, 0, text.length)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    const ps = el.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    expect(ps[0]!.textContent).toBe('前文 加粗 ')
    expect(ps[1]!.textContent).toBe(' 后文 斜体')
    expect(ps[0]!.querySelector('strong')?.textContent).toBe('加粗')
    expect(ps[1]!.querySelector('em')?.textContent).toBe('斜体')
    expect(host!.previousElementSibling).toBe(ps[0])
    expect(host!.nextElementSibling).toBe(ps[1])
    // 宿主带与独占行 embed 块同构的 dataset（挂载适配复用）
    expect(host!.dataset['vsidianEmbedInner']).toBe('甲')
    expect(host!.dataset['vsidianSrcStart']).toBe(String(occ.start))
    expect(host!.dataset['vsidianSrcEnd']).toBe(String(occ.end))
  })

  it('p 拆分保留原段落的类与属性；空半边不产出空 p', () => {
    const text = '段落类保留 ![[甲]]'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const p = el.querySelector('p')!
    p.classList.add('marker-class')
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, 0, text.length)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    const ps = el.querySelectorAll('p')
    expect(ps).toHaveLength(1) // 后半为空：不产出
    expect(ps[0]!.classList.contains('marker-class')).toBe(true)
    expect(host!.nextElementSibling).toBeNull()
  })

  it('横跨嵌入的粗体拆壳：前后各成完整 strong（合法 DOM、可视语义不破坏）', () => {
    const text = '**粗 ![[甲]] 续**'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, 0, text.length)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    const strongs = el.querySelectorAll('strong')
    expect(strongs).toHaveLength(2)
    expect(strongs[0]!.textContent).toBe('粗 ')
    expect(strongs[1]!.textContent).toBe(' 续')
    // 占位不再处于行内格式祖先内
    expect(host!.parentElement).toBe(el)
  })

  it('tight 列表项内：宿主直接落位 li（编号与列表结构不拆）', () => {
    const text = '- 项甲\n- 项乙 ![[甲]] 丙\n- 项丁'
    const blocks = splitReadingBlocks(text)
    const listBlock = blocks.find((b) => b.kind === 'list')!
    const el = createReadingBlockElement(listBlock, text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, listBlock.start, listBlock.end)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    expect(el.querySelectorAll('ul > li')).toHaveLength(3) // 列表结构保真
    expect(host!.parentElement?.tagName).toBe('LI')
    const li = host!.parentElement!
    expect(li.textContent).toContain('项乙')
    expect(li.textContent).toContain('丙')
    expect(host!.previousSibling?.textContent).toContain('项乙 ')
  })

  it('loose 列表（li > p）：宿主随 p 拆分落位 li 内', () => {
    const text = '- 项甲\n\n- 项乙 ![[甲]] 丙\n\n- 项丁'
    const blocks = splitReadingBlocks(text)
    const listBlock = blocks.find((b) => b.kind === 'list')!
    const el = createReadingBlockElement(listBlock, text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, listBlock.start, listBlock.end)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    expect(el.querySelectorAll('ul > li')).toHaveLength(3)
    expect(host!.closest('li')).not.toBeNull()
  })

  it('任务列表项内提升：checkbox 与任务态不被破坏', () => {
    const text = '- [ ] 任务 ![[甲]] 完成'
    const blocks = splitReadingBlocks(text)
    const listBlock = blocks.find((b) => b.kind === 'list')!
    const el = createReadingBlockElement(listBlock, text)
    document.body.appendChild(el)
    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, listBlock.start, listBlock.end)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    const after = el.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(after).toBe(checkbox)
    // 主文档任务入口沿用既有行为（可交互；引用内容内才由装配层禁用）
    expect(after.closest('li')).toBe(host!.closest('li'))
    expect(after.closest('li')!.textContent).toContain('任务')
  })

  it('blockquote 内：p 拆分发生在 blockquote 内部（边条容器不拆）', () => {
    const text = '> 引用前 ![[甲]] 引用后'
    const blocks = splitReadingBlocks(text)
    const quote = blocks.find((b) => b.kind === 'blockquote')!
    const el = createReadingBlockElement(quote, text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, quote.start, quote.end)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    expect(el.querySelector('blockquote')).not.toBeNull()
    expect(host!.closest('blockquote')).toBe(el.querySelector('blockquote'))
    const ps = el.querySelectorAll('blockquote > p')
    expect(ps).toHaveLength(2)
  })

  it('链接域内的占位不提升（保持 span 文本形态，返回 null）', () => {
    const text = '[文字 ![[甲]] 形态](https://e.example/x)'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    expect(slot.closest('a')).not.toBeNull()
    const occ = blockEmbedOccurrences(text, 0, text.length)[0]!
    const host = promoteEmbedSlot(slot, occ)
    expect(host).toBeNull()
    expect(slotsOf(el)).toHaveLength(1) // 占位原样保留
  })

  it('表格 td 内的占位提升为格内宿主（#248 开放：原位替换，容器不拆）', () => {
    const text = '| a | b |\n| --- | --- |\n| c ![[甲]] | d |'
    const blocks = splitReadingBlocks(text)
    const table = blocks.find((b) => b.kind === 'table')!
    const el = createReadingBlockElement(table, text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    expect(slot.closest('table')).not.toBeNull()
    const occ: EmbedSlotOccurrence = { inner: '甲', start: 0, end: 7 }
    const host = promoteEmbedSlot(slot, occ)
    expect(host).not.toBeNull()
    expect(host!.closest('td')).not.toBeNull()
    // 表格结构不拆：占位被宿主原位替换
    expect(el.querySelectorAll('tr')).toHaveLength(2)
    expect(el.querySelectorAll('th')).toHaveLength(2)
    expect(el.querySelectorAll('td')).toHaveLength(2)
  })

  it('同段两个嵌入：两次提升各自独立落位，顺序与源一致', () => {
    const text = '起 ![[甲]] 中 ![[乙]] 末'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const slots = slotsOf(el)
    const occs = blockEmbedOccurrences(text, 0, text.length)
    const paired = pairEmbedSlots(slots, occs)!
    const hostA = promoteEmbedSlot(paired[0]!.slot, paired[0]!.occ)
    const hostB = promoteEmbedSlot(paired[1]!.slot, paired[1]!.occ)
    expect(hostA).not.toBeNull()
    expect(hostB).not.toBeNull()
    expect(el.compareDocumentPosition(hostB!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(el.querySelectorAll('p')).toHaveLength(3) // 起 | 中 | 末
    expect(el.querySelector('p')!.textContent).toBe('起 ')
  })

  it('宿主类名与独占行 embed 块同构并携带混排修饰类', () => {
    const text = '前 ![[甲]] 后'
    const { el } = mountedBlockOf(text)
    document.body.appendChild(el)
    const slot = slotsOf(el)[0]!
    const occ = blockEmbedOccurrences(text, 0, text.length)[0]!
    const host = promoteEmbedSlot(slot, occ)!
    expect(host.classList.contains('vsidian-reading-embed')).toBe(true)
    expect(host.classList.contains('vsidian-reading-embed-mixed')).toBe(true)
    expect(host.dataset['vsidianEmbedPromoted']).toBe('1')
  })
})

describe('readingBlocks：混排占位的渲染产出（识别面）', () => {
  it('混排段落产占位 span：携带 inner 与显示文本，前后文与软换行保留', () => {
    const text = '前文 ![[乙/笔记#节|显示]] 后文'
    const blocks = splitReadingBlocks(text)
    expect(blocks[0]!.kind).toBe('paragraph')
    expect(blocks[0]!.html).toContain('data-vsidian-embed-inner="乙/笔记#节|显示"')
    expect(blocks[0]!.html).toContain('![[显示]]')
    expect(blocks[0]!.html).toContain('前文')
    expect(blocks[0]!.html).toContain('后文')
    expect(blocks[0]!.html).not.toContain('<a ') // 占位是 span 不是嵌套 a
  })

  it('未闭合与非法形态不产占位（原文可读降级）', () => {
    const text = '残缺 ![[未闭合 与 ![[笔记|]] 非法'
    const blocks = splitReadingBlocks(text)
    expect(blocks[0]!.html).not.toContain('vsidian-embed-slot')
    expect(blocks[0]!.html).toContain('![[未闭合')
  })

  it('代码字面量不产占位（行内代码优先消费）', () => {
    const text = '用 `![[x]]` 语法'
    const blocks = splitReadingBlocks(text)
    expect(blocks[0]!.html).not.toContain('vsidian-embed-slot')
    expect(blocks[0]!.html).toContain('<code>')
  })

  it('表格格内产占位 span（合法行内；提升由 #248 前的容器排除拦下）', () => {
    const text = '| a | b |\n| --- | --- |\n| c | ![[甲]] |'
    const blocks = splitReadingBlocks(text)
    const table = blocks.find((b) => b.kind === 'table')!
    expect(table.html).toContain('vsidian-embed-slot')
  })

  it('列表与引用块内产占位', () => {
    const text = '- 项 ![[甲]]\n\n> 引 ![[乙]] 文'
    const blocks = splitReadingBlocks(text)
    const list = blocks.find((b) => b.kind === 'list')!
    const quote = blocks.find((b) => b.kind === 'blockquote')!
    expect(list.html).toContain('data-vsidian-embed-inner="甲"')
    expect(quote.html).toContain('data-vsidian-embed-inner="乙"')
  })

  it('独占行嵌入块路径不回归：仍为块级 embed 块与 a 占位行', () => {
    const text = '![[甲]]'
    const blocks = splitReadingBlocks(text)
    expect(blocks[0]!.kind).toBe('embed')
    expect(blocks[0]!.embedInner).toBe('甲')
    expect(blocks[0]!.html).toContain('vsidian-embed-ref')
    expect(blocks[0]!.html).toContain('<a ')
  })
})

describe('#246 审查修复：配对集合的结构性对齐（P1-A/P1-B）', () => {
  it('P1-A 容器内表格：#248 起表格占位进配对集合并升级——li 内混排与 td 格内嵌入都挂载', () => {
    const text = [
      '- 项甲 ![[乙]] 余',
      '- 表格项',
      '  | 列甲 | 列乙 |',
      '  | --- | --- |',
      '  | 格 | 格内 ![[丙]] 占 |',
    ].join('\n')
    const blocks = splitReadingBlocks(text)
    const listBlock = blocks.find((b) => b.kind === 'list')!
    const el = createReadingBlockElement(listBlock, text)
    document.body.appendChild(el)
    // 直属占位包含表格格内成员（#248 开放：table 祖先剔除退役）
    const slots = directEmbedSlots(el)
    expect(slots.map((s) => s.dataset['vsidianEmbedInner'])).toEqual(['乙', '丙'])
    // occurrence 侧格内解码扫描同集合——配对可达
    const occs = blockEmbedOccurrences(text, listBlock.start, listBlock.end)
    expect(occs.map((o) => o.inner)).toEqual(['乙', '丙'])
    expect(pairEmbedSlots(slots, occs)).not.toBeNull()
    // 批量提升：乙落 li 内流宿主，丙落 td 内（表格结构不拆）
    const hosts = promoteEmbedSlotsInBlock(el, text, listBlock.start, listBlock.end)
    expect(hosts).toHaveLength(2)
    expect(hosts[0]!.dataset['vsidianEmbedInner']).toBe('乙')
    expect(hosts[0]!.closest('li')).not.toBeNull()
    expect(hosts[1]!.dataset['vsidianEmbedInner']).toBe('丙')
    expect(hosts[1]!.closest('td')).not.toBeNull()
    expect(el.querySelectorAll('tr')).toHaveLength(2)
  })

  it('P1-B 引用内跨行注释：CommentBlock 排除后配对可达——尾部嵌入升级、注释内嵌入不产占位不挂载', () => {
    const text = ['> 引用前文', '> <!-- 注释开始', '> ![[戊]]', '> -->', '> 尾部 ![[丁]] 终'].join('\n')
    const blocks = splitReadingBlocks(text)
    // 注释剥离使引用分作两块（注释行成空行）——尾部块承载丁的占位
    const quoteBlocks = blocks.filter((b) => b.kind === 'blockquote')
    expect(quoteBlocks.length).toBe(2)
    const tail = quoteBlocks[1]!
    const el = createReadingBlockElement(tail, text)
    document.body.appendChild(el)
    const slots = directEmbedSlots(el)
    expect(slots.map((s) => s.dataset['vsidianEmbedInner'])).toEqual(['丁'])
    // 修复点：CommentBlock 在排除集合内——注释内的戊不产 occurrence
    const occs = blockEmbedOccurrences(text, tail.start, tail.end)
    expect(occs.map((o) => o.inner)).toEqual(['丁'])
    const hosts = promoteEmbedSlotsInBlock(el, text, tail.start, tail.end)
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.dataset['vsidianEmbedInner']).toBe('丁')
    // 全文范围核对：戊无占位（markdown-it 剥离）也无 occurrence（lezer 排除）
    expect(el.textContent).not.toContain('戊')
    expect(blockEmbedOccurrences(text, 0, text.length).map((o) => o.inner)).toEqual(['丁'])
  })
})

describe('#246 审查顺手修：边角与用例文本', () => {
  it('未闭合注释内的嵌入按三侧自洽行为钉住：呈现产占位、扫描命中（无 Comment 节点）', () => {
    const text = '前 <!-- ![[己]] 后'
    // lezer 对未闭合残缺不建 Comment 节点（与 htmlComment 的保守保护一致
    // ——开标记原样保留）；三侧同树自洽：呈现产占位（提升升级）、宿主
    // 准入放行（chain 无排除项）、索引产边（同一 chainAt 判定）
    const blocks = splitReadingBlocks(text)
    expect(blocks[0]!.html).toContain('data-vsidian-embed-inner="己"')
    const hits = blockEmbedOccurrences(text, 0, text.length)
    expect(hits.map((h) => h.inner)).toEqual(['己'])
    const el = createReadingBlockElement(blocks[0]!, text)
    document.body.appendChild(el)
    const hosts = promoteEmbedSlotsInBlock(el, text, blocks[0]!.start, blocks[0]!.end)
    expect(hosts).toHaveLength(1)
  })

  it('真软换行（同段跨行）混排：前文 p 含换行文本，占位升级、后文独立成 p', () => {
    const text = '行一文字\n行二 ![[庚]] 行三'
    const blocks = splitReadingBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('paragraph')
    expect(blocks[0]!.html).toContain('data-vsidian-embed-inner="庚"')
    const el = createReadingBlockElement(blocks[0]!, text)
    document.body.appendChild(el)
    const hosts = promoteEmbedSlotsInBlock(el, text, blocks[0]!.start, blocks[0]!.end)
    expect(hosts).toHaveLength(1)
    const ps = el.querySelectorAll('p')
    expect(ps).toHaveLength(2)
    // 前半 p 保留软换行（源文换行未丢、未新增）
    expect(ps[0]!.textContent).toBe('行一文字\n行二 ')
    expect(ps[1]!.textContent).toBe(' 行三')
  })
})

describe('#248 表格格内嵌入的配对与提升', () => {
  const TABLE = [
    '| ![[头甲\\|头别名]] | 普通表头 |',
    '| --- | --- |',
    '| 前文 ![[甲]] 后文 ![[乙\\|e]] | 单元格 |',
  ].join('\n')

  it('blockEmbedOccurrences：表格块的格内 occurrence 命中（inner 解码语义、区间为源文）', () => {
    const hits = blockEmbedOccurrences(TABLE, 0, TABLE.length)
    expect(hits.map((h) => h.inner)).toEqual(['头甲|头别名', '甲', '乙|e'])
    // 区间 slice 回源文恰为嵌入原文（含 \\| 转义）
    expect(TABLE.slice(hits[0]!.start, hits[0]!.end)).toBe('![[头甲\\|头别名]]')
    expect(TABLE.slice(hits[2]!.start, hits[2]!.end)).toBe('![[乙\\|e]]')
  })

  it('表格块的行内代码与跨格伪形态不产 occurrence', () => {
    const text = '| `![[甲]]` | a ![[x |\n| --- | --- |\n| b | y]] c |'
    expect(blockEmbedOccurrences(text, 0, text.length)).toHaveLength(0)
  })

  it('directEmbedSlots：table 内的占位不再被排除（升级为真挂载）', () => {
    const blocks = splitReadingBlocks(TABLE)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.kind).toBe('table')
    const el = createReadingBlockElement(blocks[0]!, TABLE)
    document.body.appendChild(el)
    const slots = directEmbedSlots(el)
    expect(slots.length).toBe(3)
  })

  it('promoteEmbedSlotsInBlock：表格块整链提升——td/th 内原位替换宿主（容器不拆）', () => {
    const blocks = splitReadingBlocks(TABLE)
    const el = createReadingBlockElement(blocks[0]!, TABLE)
    document.body.appendChild(el)
    const hosts = promoteEmbedSlotsInBlock(el, TABLE, blocks[0]!.start, blocks[0]!.end)
    expect(hosts).toHaveLength(3)
    // 表头格（th）与数据格（td）内直接落位：宿主是格单元格的子节点
    const th = el.querySelector('th')!
    const td = el.querySelector('tbody td')!
    expect(th.querySelector('[data-vsidian-embed-promoted]')).toBe(hosts[0])
    expect(td.querySelector('[data-vsidian-embed-promoted]')).toBe(hosts[1])
    // 宿主 dataset 与独占行/混排同构（挂载适配复用的通道）
    expect(hosts[0]!.dataset['vsidianEmbedInner']).toBe('头甲|头别名')
    expect(Number(hosts[0]!.dataset['vsidianSrcStart'])).toBe(TABLE.indexOf('![[头甲\\|头别名]]'))
    expect(Number(hosts[0]!.dataset['vsidianSrcEnd']))
      .toBe(TABLE.indexOf('![[头甲\\|头别名]]') + '![[头甲\\|头别名]]'.length)
    // 同格多引用按源顺序（hosts[1] 甲 在 hosts[2] 乙 之前）
    expect(hosts[1]!.dataset['vsidianEmbedInner']).toBe('甲')
    expect(hosts[2]!.dataset['vsidianEmbedInner']).toBe('乙|e')
    // 表格结构未拆：行数与列数保持
    expect(el.querySelectorAll('tr')).toHaveLength(2)
    expect(el.querySelectorAll('tbody tr td')).toHaveLength(2)
  })

  it('配对失败整块降级：表格占位保持文本形态不升级', () => {
    const blocks = splitReadingBlocks(TABLE)
    const el = createReadingBlockElement(blocks[0]!, TABLE)
    document.body.appendChild(el)
    // 伪造 occurrence 缺口（只给一个块区间命中不了的窄区间）
    const hosts = promoteEmbedSlotsInBlock(el, TABLE, 0, TABLE.indexOf('| 普通表头 |'))
    expect(hosts).toHaveLength(0)
    // 占位仍以 span 形态在场（文本可读降级）
    expect(el.querySelectorAll('span[data-vsidian-embed-inner]')).toHaveLength(3)
    expect(el.querySelector('[data-vsidian-embed-promoted]')).toBeNull()
  })

  it('promotedHostsOf：表格块内宿主可被卸载配对查询', () => {
    const blocks = splitReadingBlocks(TABLE)
    const el = createReadingBlockElement(blocks[0]!, TABLE)
    document.body.appendChild(el)
    promoteEmbedSlotsInBlock(el, TABLE, blocks[0]!.start, blocks[0]!.end)
    expect(promotedHostsOf(el)).toHaveLength(3)
  })
})

describe('#248 P1-1 消费者一致性：`]]` 紧贴转义管道的格内 occurrence', () => {
  it('occurrence 区间与提升宿主 dataset 锚点 slice 严格等于嵌入原文', () => {
    const text = '| ![[B]]\\|尾 | y |\n| --- | --- |\n| a | b |'
    const occs = blockEmbedOccurrences(text, 0, text.length)
    expect(occs).toHaveLength(1)
    expect(occs[0]!.inner).toBe('B')
    expect(text.slice(occs[0]!.start, occs[0]!.end)).toBe('![[B]]')
    expect(text[occs[0]!.end]).toBe('\\')
    // 提升宿主 dataset（hover.request sourceStart/End 的单一来源）同区间
    const blocks = splitReadingBlocks(text)
    const el = createReadingBlockElement(blocks[0]!, text)
    document.body.appendChild(el)
    const hosts = promoteEmbedSlotsInBlock(el, text, blocks[0]!.start, blocks[0]!.end)
    expect(hosts).toHaveLength(1)
    expect(Number(hosts[0]!.dataset['vsidianSrcStart'])).toBe(occs[0]!.start)
    expect(Number(hosts[0]!.dataset['vsidianSrcEnd'])).toBe(occs[0]!.end)
  })
})
