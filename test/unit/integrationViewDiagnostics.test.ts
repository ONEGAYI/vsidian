import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('视图等待超时保留最后一帧图表与弹窗探针（#446 条目12）', async () => {
  const source = ts.createSourceFile('cases.ts', readFileSync('test/integration/suite/cases.ts', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'waitViewState')!
  const code = ts.transpile(`${declaration.getText(source)}; return waitViewState;`,
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const states = [
    { viewMode: 'live', selectionOffset: 0, liveMermaidCount: 2,
      paint: { mermaid: { rendered: 0, error: 0, count: 2 }, graphic: { frames: 2, overlay: false } } },
    { viewMode: 'live', selectionOffset: 256, liveMermaidCount: 5, readingMermaidCount: 0,
      tableGrid: { visibleRows: 3, rowHandles: 3 },
      paint: { mermaid: { rendered: 4, error: 1, count: 5 },
        table: { regionCellCount: 0, rowOutlineWidth: null },
        docStyle: { mainRules: 3, readingParagraphColor: null, readingHeadingColor: null },
        graphic: { frames: 5, editButtons: 5, popupButtons: 5, overlay: true, overlaySvg: false } } },
  ]
  let index = 0
  const wait = new Function('vscode', 'CMD', 'wsUri', 'poll', code)(
    { commands: { executeCommand: async () => states[index++] } }, { viewState: 'probe' },
    () => ({ toString: () => 'fixture:mermaid.md' }),
    async (_label: string, sample: () => Promise<unknown>) => {
      await sample()
      await sample()
      throw new Error('等待超时：视图状态 mermaid.md')
    },
  )
  const error = await wait('mermaid.md', () => false).catch((failure: Error) => failure)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toContain('等待超时：视图状态 mermaid.md')
  const observed = JSON.parse(error.message.split('最后观测：')[1])
  expect(observed).toMatchObject({ viewMode: 'live', selectionOffset: 256,
    liveMermaidCount: 5, readingMermaidCount: 0,
    tableGrid: { visibleRows: 3, rowHandles: 3 },
    table: { regionCellCount: 0, rowOutlineWidth: null },
    mermaid: { rendered: 4, error: 1, count: 5 },
    docStyle: { mainRules: 3, readingParagraphColor: null, readingHeadingColor: null },
    graphic: { frames: 5, editButtons: 5, popupButtons: 5, overlay: true, overlaySvg: false } })
})
