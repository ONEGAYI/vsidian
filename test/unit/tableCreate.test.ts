import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { readFileSync } from 'node:fs'
import { planCreateTable } from '../../src/webview/tableCreate'

const TABLE = '|  |  |\n| --- | --- |\n|  |  |'

function apply(doc: string, from: number, to = from): { text: string; selection: number } {
  const plan = planCreateTable(doc, from, to)
  return {
    text: doc.slice(0, plan.changes.from) + plan.changes.insert + doc.slice(plan.changes.to),
    selection: plan.selection,
  }
}

describe('planCreateTable：光标处建立两列两内容行的空表格', () => {
  it('在行内把左右文字分到表格上下，并各留一空行', () => {
    const result = apply('左文右文\n尾段', 2)
    expect(result.text).toBe(`左文\n\n${TABLE}\n\n右文\n尾段`)
    expect(result.selection).toBe(result.text.indexOf(TABLE) + 2)
  })

  it('在已有空行插入时不累积多余空行', () => {
    expect(apply('前段\n\n后段', 3).text).toBe(`前段\n\n${TABLE}\n\n后段`)
  })

  it('在行尾、文首与空文档插入时保持周边内容', () => {
    expect(apply('上文\n下一段', 2).text).toBe(`上文\n\n${TABLE}\n\n下一段`)
    expect(apply('后段', 0).text).toBe(`${TABLE}\n\n后段`)
    expect(apply('', 0).text).toBe(TABLE)
  })

  it('选区替换仍只产生一笔变更，并保留选区两端的文字', () => {
    expect(apply('前缀待替换后缀', 2, 5).text).toBe(`前缀\n\n${TABLE}\n\n后缀`)
  })

  it('生成合法 GFM：两个空表头格与两个空数据格', () => {
    const html = new MarkdownIt().render(apply('', 0).text)
    expect(html.match(/<th>/g)).toHaveLength(2)
    expect(html.match(/<td>/g)).toHaveLength(2)
  })
})

describe('容器前缀感知（#296）：引用块与列表内插入保持容器层级', () => {
  it('引用空行上插入：整行替换为引用内表格，前后不补空行', () => {
    expect(apply('> ', 2).text).toBe('> |  |  |\n> | --- | --- |\n> |  |  |')
  })

  it('引用正文行行尾插入：正文段落化，表格与分隔空行保持引用层级', () => {
    expect(apply('> 引用文', 5).text)
      .toBe('> 引用文\n>\n> |  |  |\n> | --- | --- |\n> |  |  |')
  })

  it('多层引用逐层还原', () => {
    expect(apply('> > ', 4).text).toBe('> > |  |  |\n> > | --- | --- |\n> > |  |  |')
  })

  it('列表空项上插入：首行带标记，后续行按内容列缩进', () => {
    expect(apply('- ', 2).text).toBe('- |  |  |\n  | --- | --- |\n  |  |  |')
  })

  it('引用内列表组合前缀', () => {
    expect(apply('> - ', 4).text).toBe('> - |  |  |\n>   | --- | --- |\n>   |  |  |')
  })

  it('列表正文行行尾插入：表格成为该项内容，用内容列缩进不带标记', () => {
    expect(apply('- 项目', 4).text)
      .toBe('- 项目\n  \n  |  |  |\n  | --- | --- |\n  |  |  |')
  })

  it('引用内表格为合法 GFM：blockquote 内渲染出 table', () => {
    const html = new MarkdownIt().render(apply('> ', 2).text)
    expect(html).toContain('<table>')
    const nested = new MarkdownIt().render(apply('> > ', 4).text)
    expect(nested).toContain('<table>')
  })

  it('普通行与裸空行行为不变（不猜测容器层级）', () => {
    expect(apply('', 0).text).toBe(TABLE)
    expect(apply('正文', 2).text).toBe(`正文\n\n${TABLE}`)
  })
})

describe('创建层边缘形态（#296 审查轮）', () => {
  it('裸无序标记行（-）建表：标记后保底空格，不产出 -| 粘连形态', () => {
    expect(apply('-', 1).text).toBe('- |  |  |\n  | --- | --- |\n  |  |  |')
  })

  it('裸有序标记行（1.）建表：同保底，内容列缩进对齐标记宽', () => {
    expect(apply('1.', 2).text).toBe('1. |  |  |\n   | --- | --- |\n   |  |  |')
  })

  it('裸引用标记行（>）建表：引用标记后补空格，不产出 >| 紧贴形态', () => {
    expect(apply('>', 1).text).toBe('> |  |  |\n> | --- | --- |\n> |  |  |')
  })

  it('引用正文行中部建表：右侧文字保持引用层级（不落顶层裸行）', () => {
    const out = apply('> 左右', 3)
    expect(out.text.split('\n').at(-1)).toBe('> 右')
    expect(out.text).toContain('> 左\n>\n> |  |  |')
  })

  it('引用列表正文行中部建表：右段保持列表项形态（含标记）', () => {
    const out = apply('> - abcd', 6)
    expect(out.text.split('\n').at(-1)).toBe('> - cd')
  })

  it('产物为合法 GFM：引用与列表内的表格真实渲染', () => {
    expect(new MarkdownIt().render(apply('-', 1).text)).toContain('<table>')
    expect(new MarkdownIt().render(apply('>', 1).text)).toContain('<table>')
    expect(new MarkdownIt().render(apply('> 左右', 3).text)).toContain('<table>')
  })
})

it('命令面板按界面语言显示 Create a table / 创建表格', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    contributes: { commands: Array<{ command: string; title: string; category: string }> }
  }
  const command = manifest.contributes.commands.find((item) => item.command === 'onegayi.vsidian.table.create')
  expect(command).toMatchObject({ title: '%command.table.create.title%', category: 'Vsidian' })
  const english = JSON.parse(readFileSync('package.nls.json', 'utf8')) as Record<string, string>
  const chinese = JSON.parse(readFileSync('package.nls.zh-cn.json', 'utf8')) as Record<string, string>
  // #97 起 nls 值由字典生成（sentence case 文风，见 docs/specs/i18n.md），
  // 旧 Title Case「Create a Table」随之修正；43 条全量契约见 nlsManifest.test.ts
  expect(english['command.table.create.title']).toBe('Create a table')
  expect(chinese['command.table.create.title']).toBe('创建表格')
})
