// 围栏内两步 Tab 越界的纯逻辑（工单 #125）：行内括号/引号配对扫描、
// 与语法树围栏（调用方提取后传入）合并取最内层、两步目标推导
// （闭合标记左边界 → 越过整个闭合标记）。坐标一律为行内偏移。
import { describe, expect, it } from 'vitest'
import {
  inlineTabEscapePairs,
  matchInlineFences,
  planTabEscapeTarget,
  type TabEscapeFenceSpan,
} from '../../src/shared/tabEscape'

const fence = (openFrom: number, openTo: number, closeFrom: number, closeTo: number): TabEscapeFenceSpan =>
  ({ openFrom, openTo, closeFrom, closeTo })

describe('行内括号/引号配对（matchInlineFences）', () => {
  it('单个括号对给出两侧标记边界：openFrom/openTo/closeFrom/closeTo', () => {
    expect(matchInlineFences('(a)', inlineTabEscapePairs())).toEqual([fence(0, 1, 2, 3)])
  })

  it('嵌套括号产出内外两层配对（内层先闭合先产出，顺序无语义）', () => {
    expect(matchInlineFences('(a [b] c)', inlineTabEscapePairs()))
      .toEqual([fence(3, 4, 5, 6), fence(0, 1, 8, 9)])
  })

  it.each([
    ['（中文）', 0, 1, 3, 4],
    ['【x】', 0, 1, 2, 3],
    ['《书》', 0, 1, 2, 3],
    ['「引」', 0, 1, 2, 3],
    ['『引』', 0, 1, 2, 3],
    ['{花}', 0, 1, 2, 3],
  ])('%s 全角/花括号配对', (line, a, b, c, d) => {
    expect(matchInlineFences(line, inlineTabEscapePairs())).toEqual([fence(a, b, c, d)])
  })

  it('弯引号开闭异字符，直接配对', () => {
    expect(matchInlineFences('“话”', inlineTabEscapePairs())).toEqual([fence(0, 1, 2, 3)])
    expect(matchInlineFences('‘话’', inlineTabEscapePairs())).toEqual([fence(0, 1, 2, 3)])
  })

  it('英文自反引号按出现顺序交替配对', () => {
    expect(matchInlineFences('"a" and "b"', inlineTabEscapePairs()))
      .toEqual([fence(0, 1, 2, 3), fence(8, 9, 10, 11)])
  })

  it('未闭合的 open 不产出围栏（无闭合标记可越过）', () => {
    expect(matchInlineFences('（中文', inlineTabEscapePairs())).toEqual([])
    expect(matchInlineFences('((a', inlineTabEscapePairs())).toEqual([])
  })

  it('孤立 close 与栈顶不匹配的 close 按普通字符忽略', () => {
    expect(matchInlineFences('a) b', inlineTabEscapePairs())).toEqual([])
    expect(matchInlineFences('(a] b', inlineTabEscapePairs())).toEqual([])
  })

  it('wikilink 经方括号行内匹配纳入（[[..]] 双层配对，显式决策）', () => {
    expect(matchInlineFences('[[Note|alias]]', inlineTabEscapePairs()))
      .toEqual([fence(1, 2, 12, 13), fence(0, 1, 13, 14)])
  })

  it('围栏外无注册符号的行产出空集', () => {
    expect(matchInlineFences('plain text', inlineTabEscapePairs())).toEqual([])
  })

  it('Markdown 强调触发符不参与行内匹配（树围栏路径专属）', () => {
    expect(matchInlineFences('**bold**', inlineTabEscapePairs())).toEqual([])
    expect(matchInlineFences('`code`', inlineTabEscapePairs())).toEqual([])
  })
})

describe('两步目标推导（planTabEscapeTarget）', () => {
  it('规格样例：**some|thing** 首按到闭合左边界、再按越过整个闭合标记', () => {
    // 树围栏（webview 提取后传入）：**something** → StrongEmphasis[0,13)
    const fences = [fence(0, 2, 11, 13)]
    expect(planTabEscapeTarget(fences, 6)).toBe(11)
    expect(planTabEscapeTarget(fences, 11)).toBe(13)
    expect(planTabEscapeTarget(fences, 13)).toBeNull()
  })

  it('目标是闭合边界而非词尾：**some| thing** 首按落在空格后', () => {
    // **some thing** 的树围栏：openTo=2, closeFrom=12
    const fences = [fence(0, 2, 12, 14)]
    expect(planTabEscapeTarget(fences, 6)).toBe(12)
  })

  it('规格样例：嵌套逐层退出 (a **b|c** d) 四步链', () => {
    // (a **bc** d)：括号 (0,1,11,12)，StrongEmphasis (3,5,7,9)
    const fences = [fence(0, 1, 11, 12), fence(3, 5, 7, 9)]
    expect(planTabEscapeTarget(fences, 6)).toBe(7) // **bc|**
    expect(planTabEscapeTarget(fences, 7)).toBe(9) // **bc**|
    expect(planTabEscapeTarget(fences, 9)).toBe(11) // (a **bc** d|
    expect(planTabEscapeTarget(fences, 11)).toBe(12) // (a **bc** d)|
    expect(planTabEscapeTarget(fences, 12)).toBeNull()
  })

  it('最内层按内容区间宽度取最窄（行内与树围栏混合）', () => {
    // `(a `b|` c)`：InlineCode [3,6)，括号 (0,10)
    const fences = [fence(0, 1, 9, 10), fence(3, 4, 5, 6)]
    expect(planTabEscapeTarget(fences, 4)).toBe(5) // 行内代码闭 ` 左边界
    expect(planTabEscapeTarget(fences, 5)).toBe(6) // 越出行内代码
    expect(planTabEscapeTarget(fences, 6)).toBe(9) // 括号内容尾
  })

  it('空内容围栏同样两步（`|` → 闭标记左 → 越出）', () => {
    const fences = [fence(0, 1, 2, 3)]
    expect(planTabEscapeTarget(fences, 1)).toBe(2)
    expect(planTabEscapeTarget(fences, 2)).toBe(3)
  })

  it('光标贴开标记右侧算围栏内部；停在多字符闭/开标记中间不命中', () => {
    const fences = [fence(0, 2, 11, 13)]
    expect(planTabEscapeTarget(fences, 2)).toBe(11) // 贴开标记右侧
    expect(planTabEscapeTarget(fences, 1)).toBeNull() // 开标记字符中间
    expect(planTabEscapeTarget(fences, 12)).toBeNull() // 闭标记字符中间（不越界，交落穿）
  })

  it('未命中返回 null（围栏外不向右搜索）', () => {
    expect(planTabEscapeTarget([fence(8, 9, 13, 14)], 3)).toBeNull()
    expect(planTabEscapeTarget([], 3)).toBeNull()
  })
})

describe('行内配对清单（inlineTabEscapePairs）', () => {
  it('只含括号与引号（12 项、全部单字符），Markdown 触发符不在其中', () => {
    const pairs = inlineTabEscapePairs()
    expect(pairs.map((p) => p.open)).toEqual(['(', '[', '{', '（', '【', '《', '「', '『', '“', '‘', '"', "'"])
    for (const p of pairs) {
      expect(p.open.length).toBe(1)
      expect(p.close.length).toBe(1)
    }
  })

  it('$ 美元符不在行内配对（无语法节点结构，显式决策不纳入 Tab 越界）', () => {
    expect(matchInlineFences('a $x$ b', inlineTabEscapePairs())).toEqual([])
  })
})
