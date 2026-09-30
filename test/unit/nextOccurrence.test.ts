// 选下一处相同词（工单 #238）纯函数契约：匹配语义对齐 VSCode 1.86.2
// MultiCursorSession.create——面板开且词非空沿用面板三开关；面板未开 +
// 无选区以「大小写敏感 + 全字」override 档为种子；面板未开 + 有选区沿
// 用面板开关记忆档、选区文本为搜索词；多选区文本不一致（按 matchCase
// 比较）不加选、空光标扩为词；跳过链（Ctrl+K Ctrl+D）把最后加的选区
// 换成其后下一处（净数量不变）；全选（Ctrl+Shift+L）一次选中全部匹配。
// 匹配引擎复用 findSession 的 computeFindMatches（码点边界过滤 + 头区
// 排除 + literal 口径同源），此处只做选区计划。
import { describe, expect, it } from 'vitest'
import {
  OCCURRENCE_OVERRIDE_OPTIONS,
  nextOccurrenceMatch,
  planExpandWords,
  planSelectAllOccurrences,
  planSelectNext,
  planSelectPrevious,
  planSkipCurrent,
  resolveOccurrenceSeed,
  type OccurrenceRange,
  type WordAtFn,
} from '../../src/webview/nextOccurrence'
import { FIND_OPTIONS_DEFAULT, type FindOptions } from '../../src/shared/findOptions'

/**
 * 文本布局（UTF-16 offset）：
 * 'foo bar foo\nfood Foo bar\nfoo end'
 *  foo:0-3  bar:4-7  foo:8-11  \n:11  food:12-16（内含 foo:12-15）
 *  Foo:17-20  bar:21-24  \n:24  foo:25-28
 * 各档 'foo' 匹配数：matchCase=3（0/8/25，food 内非全字不计入 override 档；
 * 字面量非全字档 matchCase 时为 4：0/8/12-15/25）；不敏感=5（+Foo）；
 * 敏感+全字=3（0/8/25）。
 */
const TEXT = 'foo bar foo\nfood Foo bar\nfoo end'

const opts = (matchCase: boolean, wholeWord: boolean, regexp = false): FindOptions =>
  ({ matchCase, wholeWord, regexp })

/** 拉丁词边界 wordAt 替身（CM6 语义近似：边界处返回紧邻词，两侧空白 null） */
const latinWordAt = (text: string): WordAtFn => (pos: number) => {
  const isWord = (i: number) => i >= 0 && i < text.length && /[A-Za-z0-9_]/.test(text[i]!)
  if (!isWord(pos) && !isWord(pos - 1)) return null
  let from = pos
  while (isWord(from - 1)) from--
  let to = pos + 1
  while (isWord(to)) to++
  return { from, to }
}

const wordAt = latinWordAt(TEXT)

const sel = (...rs: Array<[number, number]>): OccurrenceRange[] =>
  rs.map(([from, to]) => ({ from, to }))

describe('会话种子决策（VSCode MultiCursorSession.create 对齐）', () => {
  it('面板开且词非空：沿用面板三开关与面板词', () => {
    const panelOptions = opts(true, false, true)
    const seed = resolveOccurrenceSeed({
      panelOpen: true, panelQuery: 'f.o', panelOptions,
      text: TEXT, selection: sel([0, 0]), wordAt,
    })
    expect(seed).toEqual({ options: panelOptions, searchText: 'f.o' })
  })

  it('面板开但词空：回落选区路径（空选区走 override 种子档）', () => {
    const seed = resolveOccurrenceSeed({
      panelOpen: true, panelQuery: '', panelOptions: FIND_OPTIONS_DEFAULT,
      text: TEXT, selection: sel([0, 0]), wordAt,
    })
    // 空选区：override 档 + 光标所在词
    expect(seed).toEqual({ options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' })
  })

  it('面板未开 + 无选区：override 档（敏感 + 全字）+ 光标所在词', () => {
    const seed = resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: FIND_OPTIONS_DEFAULT,
      text: TEXT, selection: sel([26, 26]), wordAt,
    })
    expect(seed).toEqual({ options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' })
  })

  it('光标两侧均非词字符（空白中心）：null（无法建会话，命令无效果）', () => {
    // CM6 wordAt 口径：紧邻词的边界光标返回该词（词右界 pos=3 选 'foo'），
    // 两侧都是非词字符才 null——双空格中间即无词可选
    const text = 'foo  bar'
    const seed = resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: FIND_OPTIONS_DEFAULT,
      text, selection: sel([4, 4]), wordAt: latinWordAt(text),
    })
    expect(seed).toBeNull()
  })

  it('面板未开 + 有选区：沿用面板开关记忆档，选区文本为搜索词', () => {
    const seed = resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([0, 3]), wordAt,
    })
    expect(seed).toEqual({ options: opts(false, false), searchText: 'foo' })
  })

  it('多选区文本一致（matchCase 关：忽略大小写比较）→ 正常建会话', () => {
    const seed = resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([0, 3], [17, 20]), wordAt,
    })
    expect(seed).toEqual({ options: opts(false, false), searchText: 'foo' })
  })

  it('多选区文本不一致（按面板 matchCase 比较）→ inconsistent', () => {
    expect(resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(true, false),
      text: TEXT, selection: sel([0, 3], [17, 20]), wordAt,
    })).toBe('inconsistent')
    expect(resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([0, 3], [4, 7]), wordAt,
    })).toBe('inconsistent')
  })

  it('多个空光标各自扩词：词一致建会话（override 档，一致性按敏感比较）、词不一致 inconsistent', () => {
    // 光标 9 与 26 都在 'foo' 内：词一致 → override 档（敏感+全字）建会话
    const consistent = resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([9, 9], [26, 26]), wordAt,
    })
    expect(consistent).toEqual({ options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' })
    // 光标 9（foo）与 19（Foo）：会话档为 override（敏感）→ 词文本不一致
    expect(resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([9, 9], [19, 19]), wordAt,
    })).toBe('inconsistent')
    // 光标 9（foo）与 5（bar）：不一致
    expect(resolveOccurrenceSeed({
      panelOpen: false, panelQuery: '', panelOptions: opts(false, false),
      text: TEXT, selection: sel([9, 9], [5, 5]), wordAt,
    })).toBe('inconsistent')
  })
})

describe('空光标扩词计划', () => {
  it('单空光标在词上：扩为整词', () => {
    const plan = planExpandWords(sel([9, 9]), wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11]), mainIndex: 0 })
  })

  it('单空光标在空白中心（两侧非词字符）：none', () => {
    const text = 'foo  bar'
    expect(planExpandWords(sel([4, 4]), latinWordAt(text))).toEqual({ kind: 'none' })
  })

  it('空与非空混合：仅空光标扩词，非空选区保持', () => {
    const plan = planExpandWords(sel([0, 3], [26, 26]), wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([0, 3], [25, 28]), mainIndex: 0 })
  })

  it('无空 range：none（无事可做）', () => {
    expect(planExpandWords(sel([0, 3]), wordAt)).toEqual({ kind: 'none' })
  })
})

describe('选下一处（Ctrl+D 步进）', () => {
  it('首次（空光标在词上）：只选中该词（种子行为，不加选）', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' }
    const plan = planSelectNext(TEXT, sel([9, 9]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11]), mainIndex: 0 })
  })

  it('有选区：追加下一处相同词，新选区为主光标', () => {
    const seed = { options: opts(true, false), searchText: 'foo' }
    // 已选 0-3，从 3 起下一处 = 8-11（字面量敏感非全字：food 内 12-15 也在其后）
    const plan = planSelectNext(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11]), mainIndex: 1 })
  })

  it('连按追加：选区按文档序增长', () => {
    const seed = { options: opts(true, false), searchText: 'foo' }
    const step1 = planSelectNext(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(step1).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11]), mainIndex: 1 })
    const step2 = planSelectNext(TEXT, (step1 as { ranges: OccurrenceRange[] }).ranges, seed, 0, wordAt)
    // 下一处越过 food 内非全字命中 12-15（matchCase 非全字档它算命中）
    expect(step2).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11], [12, 15]), mainIndex: 2 })
  })

  it('文档尾 wrap 回头部（已选的跳过）', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    // 敏感+全字：命中 0-3 / 8-11 / 25-28。已选 25-28（末位），下一处 wrap 回 0-3
    const plan = planSelectNext(TEXT, sel([8, 11], [25, 28]), seed, 0, wordAt)
    expect(plan).toEqual({
      kind: 'select',
      ranges: sel([0, 3], [8, 11], [25, 28]),
      mainIndex: 0,
    })
  })

  it('全部命中已选：none（不重复加选）', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    const plan = planSelectNext(TEXT, sel([0, 3], [8, 11], [25, 28]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'none' })
  })

  it('override 档（敏感+全字）不匹配 Foo 与 food 内 foo（VSCode 默认档语义）', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' }
    // 已选 0-3：下一处（全字）为 8-11；再下一处为 25-28——Foo:17-20 与
    // food 内 12-15 均不进候选
    const step1 = planSelectNext(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(step1).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11]), mainIndex: 1 })
    const step2 = planSelectNext(TEXT, (step1 as { ranges: OccurrenceRange[] }).ranges, seed, 0, wordAt)
    expect(step2).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11], [25, 28]), mainIndex: 2 })
  })

  it('matchCase 关（面板记忆档）：Foo 也是候选', () => {
    const seed = { options: opts(false, false), searchText: 'foo' }
    // 不敏感非全字命中序：0-3, 8-11, 12-15, 17-20, 25-28。已选 12-15，下一处 17-20
    const plan = planSelectNext(TEXT, sel([12, 15]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([12, 15], [17, 20]), mainIndex: 1 })
  })

  it('正则档：搜索词按正则匹配', () => {
    const seed = { options: opts(true, false, true), searchText: 'f.o' }
    const plan = planSelectNext(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([0, 3], [8, 11]), mainIndex: 1 })
  })

  it('非法正则：none（不抛错）', () => {
    const seed = { options: opts(true, false, true), searchText: '[bad' }
    expect(planSelectNext(TEXT, sel([0, 3]), seed, 0, wordAt)).toEqual({ kind: 'none' })
  })

  it('多选区文本不一致（会话档 matchCase 比较）：none 不加选', () => {
    const seed = { options: opts(true, false), searchText: 'foo' }
    expect(planSelectNext(TEXT, sel([0, 3], [17, 20]), seed, 0, wordAt)).toEqual({ kind: 'none' })
  })

  it('成型头区排除：excludeEnd 之前的命中不进候选', () => {
    // 'foo bar\nfoo end'：foo 0-3 / 8-11。头区覆盖首个 foo（excludeEnd=8）
    const text = 'foo bar\nfoo end'
    const seed = { options: opts(true, true), searchText: 'foo' }
    const w = latinWordAt(text)
    // 已选 8-11：唯一头区外命中已选 → none
    expect(planSelectNext(text, sel([8, 11]), seed, 8, w)).toEqual({ kind: 'none' })
  })

  it('选区落在头区内：计划不产生（多光标不进头区的防御层）', () => {
    const text = 'foo bar\nfoo end'
    const seed = { options: opts(true, true), searchText: 'foo' }
    const plan = planSelectNext(text, sel([0, 3]), seed, 8, latinWordAt(text))
    expect(plan).toEqual({ kind: 'none' })
  })
})

describe('选上一处（无默认键位的对称操作）', () => {
  it('有选区：从最前选区往前追加上一处', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    const plan = planSelectPrevious(TEXT, sel([25, 28]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11], [25, 28]), mainIndex: 0 })
  })

  it('文档头 wrap 回尾部（已选跳过）', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    // 已选 0-3（最前），上一处 wrap 到尾部 25-28
    const plan = planSelectPrevious(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(plan).toEqual({
      kind: 'select',
      ranges: sel([0, 3], [25, 28]),
      mainIndex: 1,
    })
  })

  it('首次（空光标）：与 Ctrl+D 同款种子选词', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' }
    const plan = planSelectPrevious(TEXT, sel([9, 9]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11]), mainIndex: 0 })
  })
})

describe('跳过链（Ctrl+K Ctrl+D）', () => {
  it('首次（空光标在词上）：种子选词并立即追加下一处（两步合一）', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' }
    const plan = planSkipCurrent(TEXT, sel([9, 9]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11], [25, 28]), mainIndex: 1 })
  })

  it('只有种子选区（单 range）：与 Ctrl+D 同款追加', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    const plan = planSkipCurrent(TEXT, sel([8, 11]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11], [25, 28]), mainIndex: 1 })
  })

  it('有加选：最后一个选区被替换为其后下一处（净数量不变）', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    // 已选 0-3 与 8-11：跳过 → 8-11 被去掉、换 25-28
    const plan = planSkipCurrent(TEXT, sel([0, 3], [8, 11]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'select', ranges: sel([0, 3], [25, 28]), mainIndex: 1 })
  })

  it('替换目标不存在（其余命中全被占）：选区不变 none', () => {
    const seed = { options: opts(true, true), searchText: 'foo' }
    // 末位 25-28，其后无未选命中（0/8 已选）
    const plan = planSkipCurrent(TEXT, sel([0, 3], [8, 11], [25, 28]), seed, 0, wordAt)
    expect(plan).toEqual({ kind: 'none' })
  })

  it('光标在空白处：none', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: '' }
    expect(planSkipCurrent(TEXT, sel([4, 4]), seed, 0, wordAt)).toEqual({ kind: 'none' })
  })
})

describe('全选（Ctrl+Shift+L）', () => {
  it('有选区：一次选中全部匹配转多光标', () => {
    const seed = { options: opts(true, false), searchText: 'foo' }
    const plan = planSelectAllOccurrences(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(plan).toEqual({
      kind: 'select',
      ranges: sel([0, 3], [8, 11], [12, 15], [25, 28]),
      mainIndex: 0,
    })
  })

  it('空光标在词上：override 档全选（全字，不含 food/Foo）', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: 'foo' }
    const plan = planSelectAllOccurrences(TEXT, sel([9, 9]), seed, 0, wordAt)
    expect(plan).toEqual({
      kind: 'select',
      ranges: sel([0, 3], [8, 11], [25, 28]),
      mainIndex: 0,
    })
  })

  it('matchCase 关：Foo 一并选中', () => {
    const seed = { options: opts(false, false), searchText: 'foo' }
    const plan = planSelectAllOccurrences(TEXT, sel([0, 3]), seed, 0, wordAt)
    expect(plan).toEqual({
      kind: 'select',
      ranges: sel([0, 3], [8, 11], [12, 15], [17, 20], [25, 28]),
      mainIndex: 0,
    })
  })

  it('光标在空白处：none', () => {
    const seed = { options: OCCURRENCE_OVERRIDE_OPTIONS, searchText: '' }
    expect(planSelectAllOccurrences(TEXT, sel([4, 4]), seed, 0, wordAt)).toEqual({ kind: 'none' })
  })

  it('头区排除生效', () => {
    // 'foo bar\nfoo end'：光标 9（第二个 foo 内）扩词 8-11；excludeEnd=8
    // 排除头区命中，全选仅剩 8-11
    const text = 'foo bar\nfoo end'
    const seed = { options: opts(true, true), searchText: 'foo' }
    const plan = planSelectAllOccurrences(text, sel([9, 9]), seed, 8, latinWordAt(text))
    expect(plan).toEqual({ kind: 'select', ranges: sel([8, 11]), mainIndex: 0 })
  })
})

describe('环形匹配内核（nextOccurrenceMatch）', () => {
  it('afterPos 之后无命中时回绕，已选 from 跳过', () => {
    const text = 'a a a'
    // 命中 0-1 / 2-3 / 4-5；afterPos=5 wrap 回 0-1；0-1 已选 → 2-3
    const m = nextOccurrenceMatch(text, 'a', opts(true, true), 0, 5, new Set([0]))
    expect(m).toEqual({ from: 2, to: 3 })
  })

  it('无命中返回 null', () => {
    expect(nextOccurrenceMatch(TEXT, 'zzz', opts(true, false), 0, 0, new Set())).toBeNull()
  })
})
