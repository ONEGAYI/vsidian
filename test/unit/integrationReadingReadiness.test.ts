import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// 直接执行集成用例的实际采样回调，回放切换模式后先到达的未挂载快照。
// 不导入 VSCode 宿主，也不复制谓词，避免测试与真实等待条件各自维护。
const source = ts.createSourceFile('cases.ts', readFileSync('test/integration/suite/cases.ts', 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function readingPoll(label: string): (state: unknown) => Promise<unknown> {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'poll' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === label) callbacks.push(node.arguments[1]!)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`const sample = ${callbacks[0]!.getText(source)}; return sample();`,
    { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const sample = new Function('vscode', 'CMD', 'uri', code)
  return state => sample({ commands: { executeCommand: async () => state } }, { viewState: 'probe' }, 'fixture.md')
}

it('阅读双链采样拒绝未挂载的 0，等到三个双链才完成（#446 / #11）', async () => {
  const sample = readingPoll('阅读模式双链观测')
  await expect(sample({ viewMode: 'reading', readingWikilinkCount: 0 })).resolves.toBeUndefined()
  const ready = { viewMode: 'reading', readingWikilinkCount: 3 }
  await expect(sample(ready)).resolves.toBe(ready)
})

it('阅读链接与图片采样等待两类内容全部挂载（#446 / #10）', async () => {
  const sample = readingPoll('阅读模式链接/图片观测')
  await expect(sample({ viewMode: 'reading', readingLinkCount: 0, readingImageCount: 0 })).resolves.toBeUndefined()
  await expect(sample({ viewMode: 'reading', readingLinkCount: 5, readingImageCount: 0 })).resolves.toBeUndefined()
  const ready = { viewMode: 'reading', readingLinkCount: 5, readingImageCount: 1 }
  await expect(sample(ready)).resolves.toBe(ready)
})

it.each(['阅读模式语义', '阅读模式 frontmatter'])(
  '%s 采样拒绝空的语义计数，等到三个标题才完成（#446 / #8）', async (label) => {
    const sample = readingPoll(label)
    await expect(sample({ viewMode: 'reading', readingSyntax: { headings: 0, taskCheckboxes: 0 } })).resolves.toBeUndefined()
    const ready = { viewMode: 'reading', readingSyntax: { headings: 3, taskCheckboxes: 2 } }
    await expect(sample(ready)).resolves.toBe(ready)
  },
)

it('阅读表格采样拒绝默认的 0 张表，等到目标表格挂载（#446 / #12）', () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitViewState' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === 'table.md' &&
      node.arguments[1]?.getText(source).includes('readingSyntax')) callbacks.push(node.arguments[1])
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})(state);`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('state', code)
  expect(sample({ viewMode: 'reading', readingSyntax: { tables: 0 } })).toBe(false)
  expect(sample({ viewMode: 'reading', readingSyntax: { tables: 1 } })).toBe(true)
})
