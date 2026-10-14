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

it('P2-09 等待五个唯一孙位，重复卡片不能抵掉尚未绑定的格内位（#446 条目 10）', () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitViewState' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === 'p209-递归父A.md' &&
      node.arguments[1]?.getText(source).includes('grandInners')) callbacks.push(node.arguments[1])
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})(state);`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('state', 'grandInners', code)
  const inners = ['main', 'mixed', 'list', 'quote', 'table']
  const cards = inners.map((inner, index) => ({ inner, internalMode: 'live', liveBound: true,
    liveTextLen: 10, livePortId: `port-${index}` }))
  const parent = { inner: 'p209-递归B', internalMode: 'live', liveBound: true, liveTextLen: 10 }
  // 四个唯一位置 + 一个重复位置，正好凑到旧谓词要求的五张卡。
  const incomplete = [parent, ...cards.slice(0, 4), { ...cards[0]!, livePortId: 'duplicate-main' }]
  expect(sample({ readingEmbed: incomplete }, inners)).toBe(false)
  expect(sample({ readingEmbed: [...incomplete, { ...cards[4]!, liveBound: false }] }, inners)).toBe(false)
  expect(sample({ readingEmbed: [parent, ...cards] }, inners)).toBe(true)
})

it('大纲初始采样等待当前档圆点绘制，拒绝侧栏过渡期的裁切快照（#446 条目 11）', () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitViewState' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === 'outline-long.md' &&
      node.arguments[1]?.getText(source).includes('items.length === 101')) {
      let scope: ts.Node | undefined = node.parent
      while (scope && !ts.isArrayLiteralExpression(scope)) scope = scope.parent
      if (scope && ts.isArrayLiteralExpression(scope) && ts.isStringLiteral(scope.elements[0]!) &&
        scope.elements[0].text.startsWith('大纲折叠滑块与手动折叠：')) callbacks.push(node.arguments[1])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})(state);`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('state', code)
  const outline = { panelPainted: true, sliderPainted: true, sliderActiveDotPainted: true,
    chevronPainted: true, items: Array.from({ length: 101 }, () => ({})) }
  // 真实 Chromium 过渡期：面板与滑块中心已命中，最右圆点仍被裁在视口外。
  expect(sample({ sidebar: { open: true }, outline: { ...outline, sliderActiveDotPainted: false } })).toBe(false)
  expect(sample({ sidebar: { open: true }, outline: { ...outline, sliderPainted: false } })).toBe(false)
  expect(sample({ sidebar: { open: true }, outline: { ...outline, chevronPainted: false } })).toBe(false)
  expect(sample({ sidebar: { open: true }, outline })).toBe(true)
})

it('P2-14 保存采样同时等待目标文档干净和新内容落盘（#446 条目 20）', async () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'poll' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === '孙目标保存落盘' &&
      node.arguments[1]?.getText(source).includes('p214-组合C.md')) {
      callbacks.push(node.arguments[1]!)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})();`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('readDisk', 'cDoc', code)
  await expect(sample(async () => '【三层孙】', { isDirty: true })).resolves.toBeUndefined()
  await expect(sample(async () => '旧内容', { isDirty: false })).resolves.toBeUndefined()
  await expect(sample(async () => '【三层孙】', { isDirty: false })).resolves.toBe(true)
})
