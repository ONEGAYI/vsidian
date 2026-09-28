// @vitest-environment jsdom
// 正文右键菜单纯函数契约（blockMenu.ts，#162）：命中判定（标题行/普通块/
// 围栏块/frontmatter 排除/空行不接管）、菜单结构（标题行两项、普通块一项）、
// DOM 装配（role=menu、button、data-vsidian-command）与视口定位 clamp。
// 控制器交互链路（contextmenu 装配/命令执行/写回）在 blockMenuPanel.test.ts。
import { describe, expect, it } from 'vitest'
import {
  blockMenuTargetAt,
  blockMenuSpec,
  buildBlockMenu,
  blockMenuPosition,
  BLOCK_MENU_CLASS_NAMES,
  type BlockMenuCommand,
} from '../../src/webview/blockMenu'

describe('命中判定（blockMenuTargetAt）', () => {
  const DOC = [
    '---',
    'title: 头区行',
    '---',
    '',
    '# 标题一',
    '',
    '普通段落甲',
    '段落甲第二行',
    '',
    '```js',
    'const a = 1',
    '```',
  ]

  it('标题行：命中块 = 标题行自身，heading 非空（字面文本）', () => {
    expect(blockMenuTargetAt(DOC, 4, 2)).toEqual({
      block: { start: 4, end: 4 },
      heading: { level: 1, text: '标题一' },
    })
  })

  it('普通块：命中块 = 空行分界的连续行组，heading 为 null', () => {
    expect(blockMenuTargetAt(DOC, 6, 2)).toEqual({
      block: { start: 6, end: 7 },
      heading: null,
    })
    expect(blockMenuTargetAt(DOC, 7, 2)).toEqual({ block: { start: 6, end: 7 }, heading: null })
  })

  it('围栏块：点击围栏内部任一行 = 整个围栏块，且无标题语义', () => {
    for (const i of [9, 10, 11]) {
      expect(blockMenuTargetAt(DOC, i, 2)).toEqual({ block: { start: 9, end: 11 }, heading: null })
    }
  })

  it('围栏内的 # 行不是标题（代码内容）', () => {
    const lines = ['```md', '# 伪标题', '```', '', '# 真标题']
    expect(blockMenuTargetAt(lines, 1, -1)).toEqual({ block: { start: 0, end: 2 }, heading: null })
    expect(blockMenuTargetAt(lines, 4, -1)).toEqual({
      block: { start: 4, end: 4 },
      heading: { level: 1, text: '真标题' },
    })
  })

  it('frontmatter 头区（含结束行）不接管；头区后的正文照常', () => {
    expect(blockMenuTargetAt(DOC, 0, 2)).toBeNull()
    expect(blockMenuTargetAt(DOC, 1, 2)).toBeNull()
    expect(blockMenuTargetAt(DOC, 2, 2)).toBeNull()
    expect(blockMenuTargetAt(DOC, 3, 2)).toBeNull() // 头区后空行也不属于块
    expect(blockMenuTargetAt(DOC, 4, 2)).not.toBeNull()
  })

  it('空行与越界：不接管', () => {
    expect(blockMenuTargetAt(DOC, 3, 2)).toBeNull()
    expect(blockMenuTargetAt(DOC, -1, 2)).toBeNull()
    expect(blockMenuTargetAt(DOC, DOC.length, 2)).toBeNull()
  })

  it('表格整块：无空行连续行为一块', () => {
    const lines = ['| a | b |', '|---|---|', '| 1 | 2 |', '', '后文']
    expect(blockMenuTargetAt(lines, 1, -1)).toEqual({ block: { start: 0, end: 2 }, heading: null })
  })

  it('标题行带行内标记：heading.text 保留标记字面（与宿主字面比较同源）', () => {
    const lines = ['', '## 用 **重点** 说明 ##']
    expect(blockMenuTargetAt(lines, 1, -1)).toEqual({
      block: { start: 1, end: 1 },
      heading: { level: 2, text: '用 **重点** 说明' },
    })
  })
})

describe('菜单结构（blockMenuSpec）', () => {
  it('标题行：复制标题链接 + 复制块链接（两项）', () => {
    expect(blockMenuSpec(true).map((item) => item.id)).toEqual(['copyHeadingLink', 'copyBlockLink'])
  })
  it('普通块：仅复制块链接', () => {
    expect(blockMenuSpec(false).map((item) => item.id)).toEqual(['copyBlockLink'])
  })
})

describe('DOM 装配（buildBlockMenu）', () => {
  it('容器 role=menu；项为 button 携带 data-vsidian-command；点击回调命令', () => {
    const got: BlockMenuCommand[] = []
    const menu = buildBlockMenu(blockMenuSpec(true), (id) => got.push(id))
    expect(menu.className).toBe(BLOCK_MENU_CLASS_NAMES.menu)
    expect(menu.getAttribute('role')).toBe('menu')
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.map((b) => b.dataset['vsidianCommand'])).toEqual(['copyHeadingLink', 'copyBlockLink'])
    expect(buttons.every((b) => b.className === BLOCK_MENU_CLASS_NAMES.item)).toBe(true)
    buttons[0]!.click()
    buttons[1]!.click()
    expect(got).toEqual(['copyHeadingLink', 'copyBlockLink'])
  })
})

describe('菜单定位（blockMenuPosition）', () => {
  it('点击点起位；右缘 clamp；底部放不下翻到点击点上方', () => {
    expect(blockMenuPosition({ x: 100, y: 200 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 100, top: 200 })
    // 右缘 clamp
    expect(blockMenuPosition({ x: 1100, y: 200 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 1040, top: 200 })
    // 底部放不下：上翻（点击点成为菜单底缘）
    expect(blockMenuPosition({ x: 100, y: 780 }, { w: 160, h: 60 }, { width: 1200, height: 800 }))
      .toEqual({ left: 100, top: 720 })
    // 上翻也放不下（点击点近顶，上翻为负）：clamp 到 0
    expect(blockMenuPosition({ x: 100, y: 30 }, { w: 160, h: 60 }, { width: 1200, height: 80 }))
      .toEqual({ left: 100, top: 0 })
  })
})
