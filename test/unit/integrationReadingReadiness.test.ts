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
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text.startsWith('孙目标保存落盘') &&
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

it('P2-04 保存采样不能把磁盘更新当成 dirty 已清零（#552 / #281）', async () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'poll' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === '目标保存落盘' &&
      node.arguments[1]?.getText(source).includes('p204-编辑目标.md')) callbacks.push(node.arguments[1])
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})();`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('readDisk', 'bDoc', code)
  await expect(sample(async () => '【嵌入编辑】', { isDirty: true })).resolves.toBeUndefined()
  await expect(sample(async () => '旧内容', { isDirty: false })).resolves.toBeUndefined()
  await expect(sample(async () => '【嵌入编辑】', { isDirty: false })).resolves.toBe(true)
})

it('文档样式采样等待 Reading 标签挂载，错误颜色仍交给原断言报告（#552 / #569）', () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitViewState' &&
      node.arguments[1]?.getText(source).includes('docStyle.mainRules > 0')) callbacks.push(node.arguments[1])
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})(state);`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('state', code)
  const ready = { mainRules: 3, readingParagraphColor: 'rgb(0, 0, 205)',
    readingHeadingColor: 'rgb(75, 0, 130)', toolbarColor: 'rgb(1, 2, 3)' }
  const state = (docStyle: unknown) => ({ viewMode: 'reading', paint: { docStyle } })
  for (const field of ['readingParagraphColor', 'readingHeadingColor', 'toolbarColor']) {
    expect(sample(state({ ...ready, [field]: null }))).toBe(false)
  }
  expect(sample(state({ ...ready, mainRules: 0 }))).toBe(false)
  expect(sample(state(ready))).toBe(true)
  expect(sample(state({ ...ready, readingParagraphColor: 'rgb(255, 0, 0)' }))).toBe(true)
})

it('删表头采样等到写回计数结算，再建立拒绝操作的零写回基线（#552 条目33）', async () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'poll' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === '删表头升格') callbacks.push(node.arguments[1]!)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)})();`, { target: ts.ScriptTarget.ES2022 })
  const sample = new Function('doc', 'promoted', 'vscode', 'CMD', 'uri', 'beforePromote', code)
  let state = { appliedEdits: 4 }
  const document = { getText: () => '新表头' }
  const commands = { commands: { executeCommand: async () => state } }
  const check = async () => sample(document, '新表头', commands, { sessionState: 'probe' }, 'table13.md', { appliedEdits: 4 })
  // VSCode 的 onDidChangeTextDocument 可早于 applyEdit 的 Promise 完成：
  // 新文本已在场，宿主计数仍属于前一帧。
  await expect(check()).resolves.toBeUndefined()
  state = { appliedEdits: 5 }
  await expect(check()).resolves.toBe(true)
  document.getText = () => '旧表头'
  await expect(check()).resolves.toBeUndefined()
})

it('图片尺寸采样等待目标锚点完成视觉补偿，高度增长不能单独放行（#446 条目22）', async () => {
  const callbacks: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'poll' &&
      ts.isStringLiteral(node.arguments[0]!) && node.arguments[0].text === '图片尺寸变化生效') {
      callbacks.push(node.arguments[1]!)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(callbacks).toHaveLength(1)
  const code = ts.transpile(`return (${callbacks[0]!.getText(source)});`, { target: ts.ScriptTarget.ES2022 })
  const before = { readingScrollHeightPx: 2000, readingAnchorTopPx: 1000, readingScrollTopPx: 1000 }
  let state: Record<string, number> = {
    readingScrollHeightPx: 2240, readingAnchorStart: 201, readingAnchorTopPx: 1240, readingScrollTopPx: 1000,
  }
  const sample = new Function('vscode', 'CMD', 'uri', 'before', 'grow', 'anchorOffset', 'offsetBefore', code)(
    { commands: { executeCommand: async () => state } }, { viewState: 'probe' }, 'fixture.md', before, 240, 201, 0,
  )
  await expect(sample()).resolves.toBeUndefined()
  state = { ...state, readingScrollTopPx: 1240 }
  await expect(sample()).resolves.toBe(state)
  state = { ...state, readingScrollHeightPx: 2020 }
  await expect(sample()).resolves.toBeUndefined()
  state = { ...state, readingScrollHeightPx: 2240, readingAnchorStart: 191 }
  await expect(sample()).resolves.toBeUndefined()
  state = { ...state, readingAnchorStart: 201 }
  delete state.readingAnchorTopPx
  await expect(sample()).resolves.toBeUndefined()
})

it('T15 装载等待读取目标页面当前状态，日志淘汰不能造成永久等待（#446 条目 7/17）', async () => {
  const addonId = 'vsidian-example.ui-command'
  // 公开事件命令返回的截断快照，不依赖宿主记录器的私有实现。
  const events: unknown[] = Array.from({ length: 200 }, () => ({
    panel: 'editor', kind: 'outbound.request', addonId: 'other-addon', topic: 'next',
  }))

  const cases = ts.createSourceFile('addonT15Cases.ts', readFileSync('test/integration/suite/addonT15Cases.ts', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const waiters = cases.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'waitForPageLoaded')
  expect(waiters).toHaveLength(1)
  let snapshot: unknown = { addonPage: { active: [{ addonId, generation: 1 }] } }
  const wait = new Function('vscode', 'poll', 'wsUri', ts.transpile(`${waiters[0]!.getText(cases)}; return waitForPageLoaded;`,
    { target: ts.ScriptTarget.ES2022 }))(
    { commands: { executeCommand: async (command: string, uri: string) => {
      if (command === 'onegayi.vsidian._test.addonPageEvents') return events
      expect(command).toBe('onegayi.vsidian._test.requestViewState')
      expect(uri).toBe('file:///t15-ui.md')
      return snapshot
    } } },
    async (_label: string, sample: () => Promise<unknown>) => {
      if (await sample() === undefined) throw new Error('页面已装载，等待仍未完成')
    },
    (file: string) => ({ toString: () => `file:///${file}` }),
  )
  await expect(wait(addonId, 't15-ui.md')).resolves.toBeUndefined()
  // 旧成功日志不能放行已卸载的当前页面，其他组件活跃也不能抵数。
  events.push({ kind: 'outbound.loaded', addonId, ok: true })
  for (snapshot of [undefined, { addonPage: { active: [] } }, { addonPage: { active: [{ addonId: 'other-addon' }] } }]) {
    await expect(wait(addonId, 't15-ui.md')).rejects.toThrow('页面已装载，等待仍未完成')
  }
})

it('T15 的装载采样必须指向刚打开的目标文件', () => {
  const cases = ts.createSourceFile('addonT15Cases.ts', readFileSync('test/integration/suite/addonT15Cases.ts', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let checked = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'waitForPageLoaded') {
      const statement = node.parent.parent
      const block = statement.parent
      expect(ts.isBlock(block)).toBe(true)
      if (!ts.isBlock(block)) throw new Error('装载等待必须位于用例块')
      const previous = block.statements[block.statements.indexOf(statement as ts.Statement) - 1]!
      expect(ts.isExpressionStatement(previous) && previous.expression.getText(cases)).toContain('openEditorPanel')
      const open = (previous as ts.ExpressionStatement).expression as ts.AwaitExpression
      expect(node.arguments[1]!.getText(cases)).toBe((open.expression as ts.CallExpression).arguments[0]!.getText(cases))
      checked++
    }
    ts.forEachChild(node, visit)
  }
  visit(cases)
  expect(checked).toBe(7)
})
