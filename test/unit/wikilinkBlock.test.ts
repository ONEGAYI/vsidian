// 双链联想块候选纯逻辑（#380 T05）：可引用块枚举边界矩阵、片段/已有 id
// 过滤、目标块补写计划（V01 探针 planTargetBlockId 的生产提炼）与撤回
// 守卫判定。块边界与 id 形态学单一事实源在 src/shared/blockId.ts——本
// 模块只在其上组合，不建第二套边界判定。
import { describe, expect, it } from 'vitest'
import {
  enumerateReferableBlocks,
  filterWikilinkBlocks,
  planTargetBlockId,
  withdrawalGuard,
} from '../../src/shared/wikilinkBlock'

/** 确定性随机（探针同款 LCG；id 可预期） */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const summary = (text: string) =>
  enumerateReferableBlocks(text).map((b) => `${b.line}:${b.lineCount}:${b.snippet}${b.blockId ? `:^${b.blockId}` : ''}`)

describe('enumerateReferableBlocks：块边界矩阵', () => {
  it('空行分界的多个段落各自成块，空文本/全空白为空', () => {
    expect(enumerateReferableBlocks('')).toEqual([])
    expect(enumerateReferableBlocks('\n\n  \n')).toEqual([])
    expect(summary('段一行一\n段一行二\n\n段二行一\n')).toEqual([
      '1:2:段一行一',
      '4:1:段二行一',
    ])
  })

  it('无空行连续列表整体一块', () => {
    const text = '- 项一\n- 项二\n- 项三\n\n后续段落\n'
    expect(summary(text)).toEqual(['1:3:- 项一', '5:1:后续段落'])
  })

  it('代码围栏整体一块（含内部空行），紧邻段落互不吞并', () => {
    const text = '段落一\n```js\nconst a = 1\n\nconst b = 2\n```\n段落二\n'
    expect(summary(text)).toEqual(['1:1:段落一', '2:5:```js', '7:1:段落二'])
  })

  it('闭围栏行行尾标记是围栏块自身的 id', () => {
    const text = '```js\ncode\n``` ^fence01\n'
    const blocks = enumerateReferableBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.blockId).toBe('fence01')
    expect(blocks[0]!.line).toBe(1)
  })

  it('围栏内部的伪 id 与伪块不被当作独立块', () => {
    const text = '```\n^inside01\n伪块行\n```\n'
    const blocks = enumerateReferableBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.blockId).toBe('')
    expect(blocks[0]!.lineCount).toBe(4) // 开围栏 + 2 内容行 + 闭围栏
  })

  it('未闭合围栏延伸到文件末行为一块', () => {
    const text = '前段落\n\n```\n未闭合内容\n'
    // 行 3-4（含尾部空行）属未闭合围栏——与宿主「其后内容全部跳过」同口径
    expect(summary(text)).toEqual(['1:1:前段落', '3:3:```'])
  })

  it('已有 id 三落点：行尾、紧贴独立行（并入上方块）、跨空行独立行', () => {
    const text = [
      '已有行尾 id 段落 ^tail01', // 行尾形态
      '',
      '独立行上方段落', // 跨空行独立行归属
      '',
      '^stand01',
      '',
      '紧贴独立行段落', // 紧贴：标记行被块区间吞并
      '^tight01',
    ].join('\n')
    const blocks = enumerateReferableBlocks(text)
    expect(blocks.map((b) => [b.line, b.blockId])).toEqual([
      [1, 'tail01'],
      [3, 'stand01'],
      [7, 'tight01'],
    ])
    // 紧贴形态：标记行并入块区间（块行数含标记行）
    expect(blocks[2]!.lineCount).toBe(2)
  })

  it('跨空行独立标记行自身不成为可引用块（标记归属上方块）', () => {
    const text = '段落\n\n^lone01\n\n另一段\n'
    expect(summary(text)).toEqual(['1:1:段落:^lone01', '5:1:另一段'])
  })

  it('文件头 frontmatter 不进入块候选，正文正常枚举', () => {
    const text = '---\ntitle: x\n---\n\n正文段落\n'
    expect(summary(text)).toEqual(['5:1:正文段落'])
  })

  it('frontmatter 未闭合（无第二 ---）时只按普通块处理', () => {
    const text = '---\n不是 frontmatter\n'
    expect(summary(text)).toEqual(['1:2:---'])
  })

  it('F12：`...` 收尾的 frontmatter 不进入块候选（与 markdownDoc 口径同源）', () => {
    const text = '---\ntitle: x\n...\n\n正文段落\n'
    expect(summary(text)).toEqual(['5:1:正文段落'])
  })

  it('F12：`...` 收尾 frontmatter 内层围栏/段落均不产生候选（选中写坏 YAML 的入口关闭）', () => {
    const text = '---\nlayout: table\n```js\ncode: true\n```\n...\n\n正文段落\n'
    expect(summary(text)).toEqual(['8:1:正文段落'])
  })

  it('F12：CRLF 形态的 `...` 收尾 frontmatter 同样跳过', () => {
    const text = '---\r\ntitle: x\r\n...\r\n\r\n正文段落\r\n'
    expect(summary(text)).toEqual(['5:1:正文段落'])
  })

  it('CRLF 文本与 LF 同口径枚举', () => {
    const text = '段一\r\n\r\n段二\r\n'
    expect(summary(text)).toEqual(['1:1:段一', '3:1:段二'])
  })
})

describe('filterWikilinkBlocks：片段与已有 id 搜索', () => {
  const text = [
      '预算编制说明', // 无 id
      '',
      '会议记录 ^meet01', // 已有 id
      '',
      '```js', // 围栏
      'code',
      '```',
    ].join('\n')
  const blocks = enumerateReferableBlocks(text)

  it('空查询返回全部（含无 id 块——不能偷换为仅列已有 id）', () => {
    expect(filterWikilinkBlocks(blocks, '')).toHaveLength(3)
    expect(filterWikilinkBlocks(blocks, '   ')).toHaveLength(3)
  })

  it('按显示文本片段包含匹配（大小写不敏感、trim）', () => {
    expect(filterWikilinkBlocks(blocks, '预算').map((b) => b.line)).toEqual([1])
    expect(filterWikilinkBlocks(blocks, 'MEETING')).toEqual([])
    expect(filterWikilinkBlocks(blocks, '会议')).toHaveLength(1)
  })

  it('按已有 id 包含匹配', () => {
    expect(filterWikilinkBlocks(blocks, 'meet01').map((b) => b.blockId)).toEqual(['meet01'])
    expect(filterWikilinkBlocks(blocks, 'meet').map((b) => b.blockId)).toEqual(['meet01'])
  })

  it('无匹配返回空（空态真实呈现）', () => {
    expect(filterWikilinkBlocks(blocks, '不存在')).toEqual([])
  })
})

describe('planTargetBlockId：补写计划（V01 planTargetBlockId 生产提炼）', () => {
  it('已有 id 三落点全部复用、零计划', () => {
    const text = '行尾段落 ^keep01\n\n独立行段落\n\n^stand02\n\n紧贴段落\n^tight03\n'
    expect(planTargetBlockId(text, 1, seeded(1))).toEqual({ kind: 'reused', id: 'keep01' })
    expect(planTargetBlockId(text, 3, seeded(1))).toEqual({ kind: 'reused', id: 'stand02' })
    expect(planTargetBlockId(text, 7, seeded(1))).toEqual({ kind: 'reused', id: 'tight03' })
  })

  it('无 id 块生成查重 id，插入文本为空一行 + 独立行标记（LF 形态）', () => {
    const text = '目标段行一\n目标段行二\n\n后续段\n'
    const plan = planTargetBlockId(text, 1, seeded(42))
    expect(plan?.kind).toBe('planned')
    if (plan?.kind !== 'planned') return
    expect(plan.id).toMatch(/^[a-z0-9]{6}$/)
    expect(plan.insertText).toBe(`\n\n^${plan.id}`)
    // 插入点 = 块尾行行尾序列之前（LF：行 2 的 \n 之前）
    expect(plan.insertOffset).toBe('目标段行一\n目标段行二'.length)
  })

  it('生成的 id 避让全文已有 id（碰撞即重生成）', () => {
    const text = '目标段落\n\n他块 ^aaaaaa\n'
    // 首个随机 id 恰为 aaaaaa（全零随机）→ 碰撞后重生成；第二次返回非零
    // 使重生成成功（恒零随机会令查重永真，属测试设计缺陷而非产品行为）
    let calls = 0
    const zeroOnce = () => (calls++ === 0 ? 0 : 0.5)
    const plan = planTargetBlockId(text, 1, zeroOnce)
    expect(plan?.kind).toBe('planned')
    if (plan?.kind !== 'planned') return
    expect(plan.id).not.toBe('aaaaaa')
    expect(plan.id).toMatch(/^[a-z0-9]{6}$/)
  })

  it('紧贴块尾的独立标记行作为块尾，插入点在标记行行尾', () => {
    const text = '段落\n^tailid\n\n后续\n'
    const plan = planTargetBlockId(text, 1, seeded(7))
    expect(plan?.kind).toBe('reused')
    expect(plan?.kind === 'reused' && plan.id).toBe('tailid')
  })

  it('CRLF 文本：插入点在块尾行 \r\n 之前（宿主系，\r 计入前文）', () => {
    const text = '段一\r\n段二\r\n\r\n后续\r\n'
    const plan = planTargetBlockId(text, 1, seeded(9))
    expect(plan?.kind).toBe('planned')
    if (plan?.kind !== 'planned') return
    // '段一\r\n'（4）+ '段二'（2）= 6：行 2 的 \r 之前
    expect(plan.insertOffset).toBe(6)
    expect(plan.insertText).toBe(`\n\n^${plan.id}`)
  })

  it('空行/越界/空白行返回 null（不可引用目标）', () => {
    expect(planTargetBlockId('正文\n\n另一段\n', 2, seeded(1))).toBeNull()
    expect(planTargetBlockId('正文\n', 99, seeded(1))).toBeNull()
    expect(planTargetBlockId('正文\n', 0, seeded(1))).toBeNull()
  })
})

describe('withdrawalGuard：V01 双守卫纯函数（正向 delete，绝不 undo）', () => {
  const markerText = '\n\n^abc123'
  const base = { id: 'abc123', marker: markerText, offset: 4, versionAfterInsert: 3 }

  it('版本未变且标记逐字在场 → 允许撤回（给出精确删除区间）', () => {
    const text = '正文块尾' + markerText + '后续'
    const verdict = withdrawalGuard(base, { text, version: 3 })
    expect(verdict).toEqual({
      action: 'withdraw',
      offset: 4,
      length: markerText.length,
    })
  })

  it('版本自补 ID 后已变 → 保留（version-changed）', () => {
    const verdict = withdrawalGuard(base, { text: '正文块尾' + markerText, version: 4 })
    expect(verdict).toEqual({ action: 'keep', reason: 'version-changed' })
  })

  it('版本相同但标记被改写 → 保留（marker-changed，防御纵深）', () => {
    const text = '正文块尾\n\n^mutated'
    expect(withdrawalGuard(base, { text, version: 3 })).toEqual({ action: 'keep', reason: 'marker-changed' })
  })

  it('标记位置内容为空/部分匹配 → 保留', () => {
    expect(withdrawalGuard(base, { text: '正文块尾\n\n^ab', version: 3 }))
      .toEqual({ action: 'keep', reason: 'marker-changed' })
  })
})
