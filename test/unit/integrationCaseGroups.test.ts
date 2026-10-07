import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { parse } from 'yaml'

const fixture = vi.hoisted(() => {
  const sensitive = [
    'CSS 片段：被导入文件修改自动刷新、删除降级与缺失恢复（#129）',
    '索引维护：批量文件增删的队列收敛与索引守恒（Git 切换量级 100 文件，#202）',
    '嵌入：Live 挂载与源码显隐——IME 编辑撤销闭环与双零 dirty（#223）',
    '递归：真宿主直接来源、三层、设置热更与未保存刷新（#244）',
  ]
  const names = ['普通甲', sensitive[0]!, '普通乙', sensitive[1]!, '普通丙', sensitive[2]!, '普通丁', sensitive[3]!]
  const executed: string[] = []
  const cases: Array<[string, () => Promise<void>]> = names.map((name) => [name, async () => { executed.push(name) }])
  return { sensitive, names, cases, executed }
})

vi.mock('../integration/suite/cases', () => ({ cases: fixture.cases }))
vi.mock('vscode', () => ({
  extensions: { getExtension: () => ({ isActive: true }) },
  commands: {
    executeCommand: async (command: string) => {
      if (command.endsWith('.getLastMode')) return 'live'
      if (command.endsWith('.getSettings')) return {
        'editor.lineNumbers': true, 'general.language': 'auto',
        'image.pasteLocation': 'same-dir', 'image.pasteSubpath': 'assets',
      }
      if (command.endsWith('.getSnippetState')) return { directory: null, entries: [] }
      // #322 守护面重置（suite/index.ts 每用例前读回校验）：mock 已清空态
      if (command.endsWith('.getEditorGuardState')) return { versionLock: null, rejections: [] }
      return undefined
    },
  },
  window: { tabGroups: { all: [], close: async () => {} } },
  TabInputCustom: class {},
}))

import { run } from '../integration/suite/index'
import { selectIntegrationCases, SENSITIVE_CASES } from '../integration/suite/caseSelection'

beforeEach(() => {
  fixture.executed.length = 0
  vi.useFakeTimers()
  vi.stubEnv('VSIDIAN_TEST_GROUP', '')
  vi.stubEnv('VSIDIAN_TEST_CASES', '')
  vi.stubEnv('VSIDIAN_TEST_SHARD', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function runSuite(): Promise<void> {
  // 立即挂拒绝处理器，配置校验失败时不产生暂时的 unhandled rejection。
  const running = run().then(() => undefined, (error: unknown) => error)
  await vi.runAllTimersAsync()
  const error = await running
  if (error) throw error
}

it('真实套件入口的 core 组排除四项敏感用例，普通用例仍执行', async () => {
  vi.stubEnv('VSIDIAN_TEST_GROUP', 'core')
  await runSuite()
  expect(fixture.executed).toEqual(['普通甲', '普通乙', '普通丙', '普通丁'])
})

it('第五组只执行四项敏感用例，默认运行仍覆盖全部用例', async () => {
  vi.stubEnv('VSIDIAN_TEST_GROUP', 'sensitive')
  await runSuite()
  expect(fixture.executed).toEqual(fixture.sensitive)
  fixture.executed.length = 0
  vi.stubEnv('VSIDIAN_TEST_GROUP', '')
  await runSuite()
  expect(fixture.executed).toEqual(fixture.names)
})

it('移出敏感用例后仍按原来的位置切片，不重新分配普通用例', async () => {
  vi.stubEnv('VSIDIAN_TEST_GROUP', 'core')
  vi.stubEnv('VSIDIAN_TEST_SHARD', '1/4')
  await runSuite()
  expect(fixture.executed).toEqual(['普通甲', '普通丙'])
  fixture.executed.length = 0
  vi.stubEnv('VSIDIAN_TEST_SHARD', '2/4')
  await runSuite()
  expect(fixture.executed).toEqual([])
})

it('明确指定的用例不属于当前组时拒绝空通过', async () => {
  vi.stubEnv('VSIDIAN_TEST_GROUP', 'core')
  vi.stubEnv('VSIDIAN_TEST_CASES', '#244')
  await expect(runSuite()).rejects.toThrow(/未命中.*core/)
  expect(fixture.executed).toEqual([])
})

it('定向筛选保留多子串语义，默认模式先筛选再切片', async () => {
  vi.stubEnv('VSIDIAN_TEST_CASES', '普通甲, 普通乙, #244')
  vi.stubEnv('VSIDIAN_TEST_SHARD', '2/2')
  await runSuite()
  expect(fixture.executed).toEqual(['普通乙'])
})

it('未知组、错误分片和未命中的定向筛选都拒绝执行', () => {
  expect(() => selectIntegrationCases(fixture.cases, { group: 'cor' })).toThrow(/VSIDIAN_TEST_GROUP/)
  for (const shard of ['bad', '0/4', '5/4', '1/0']) {
    expect(() => selectIntegrationCases(fixture.cases, { shard })).toThrow(/VSIDIAN_TEST_SHARD/)
  }
  expect(() => selectIntegrationCases(fixture.cases, { filter: '无此用例' })).toThrow(/未命中/)
  expect(() => selectIntegrationCases(fixture.cases, { filter: ', , ' })).toThrow(/未命中/)
})

it('敏感名单成员改名、消失或重复时立即失败，不静默缩减第五组', () => {
  const absent = fixture.cases.filter(([name]) => name !== fixture.sensitive[0])
  expect(() => selectIntegrationCases(absent)).toThrow(/须存在且唯一/)
  const duplicate = [...fixture.cases, fixture.cases[1]!]
  expect(() => selectIntegrationCases(duplicate)).toThrow(/须存在且唯一/)
  expect(SENSITIVE_CASES.map((entry) => entry.name)).toEqual(fixture.sensitive)
  for (const entry of SENSITIVE_CASES) {
    expect(entry.issue).not.toBe('')
    expect(entry.reason).not.toBe('')
    expect(entry.evidence).toMatch(/^https:\/\/github\.com\/ONEGAYI\/vsidian\//)
  }
})

it('第五组用例失败仍记录 FAIL、继续收集其余结果并返回失败', async () => {
  vi.stubEnv('VSIDIAN_TEST_GROUP', 'sensitive')
  const body = fixture.cases[1]![1]
  fixture.cases[1]![1] = async () => { throw new Error('模拟敏感用例失败') }
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(runSuite()).rejects.toThrow(/集成测试失败 1 项/)
    expect(fixture.executed).toEqual(fixture.sensitive.slice(1))
    expect(errorLog).toHaveBeenCalledWith(`[集成测试][FAIL] ${fixture.sensitive[0]}`, expect.any(Error))
  } finally {
    fixture.cases[1]![1] = body
  }
})

/** 只读真实 cases 声明的名称；不加载 vscode，也不执行任何用例正文。 */
function parseCaseArray(fileName: string, varName: string): Array<[string, null]> {
  const source = ts.createSourceFile(fileName,
    readFileSync(`test/integration/suite/${fileName}`, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: Array<[string, null]> = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== varName) continue
      const array = declaration.initializer
      if (!array || !ts.isArrayLiteralExpression(array)) throw new Error(`${varName} 须为明确的用例数组`)
      for (const entry of array.elements) {
        if (!ts.isArrayLiteralExpression(entry) || !ts.isStringLiteral(entry.elements[0]!)) {
          throw new Error('用例须登记唯一的字面量名称')
        }
        names.push([entry.elements[0].text, null])
      }
    }
  }
  if (!names.length) throw new Error(`未读取到 ${fileName} 的 ${varName} 清单`)
  return names
}

function productionCases(): Array<[string, null]> {
  // 探针清单独立成文件，经 cases.ts 数组内展开合入——解析器允许**登记过**
  // 的探针展开（#278 probe278、#375 probe375）并按运行时顺序内联其字面量
  // 名；其余展开形态仍立即失败
  const probeSpreads = new Map<string, Array<[string, null]>>([
    ['probe278Cases', parseCaseArray('probe278.ts', 'probe278Cases')],
    ['probe375Cases', parseCaseArray('probe375.ts', 'probe375Cases')],
    ['wikilinkBlockCases', parseCaseArray('wikilinkBlock.ts', 'wikilinkBlockCases')],
    ['wikilinkEmbedCases', parseCaseArray('wikilinkEmbed.ts', 'wikilinkEmbedCases')],
    ['addonHistoryCases', parseCaseArray('addonHistoryCases.ts', 'addonHistoryCases')],
    ['addonT02Cases', parseCaseArray('addonT02Cases.ts', 'addonT02Cases')],
    ['addonT04Cases', parseCaseArray('addonT04Cases.ts', 'addonT04Cases')],
    ['addonT05Cases', parseCaseArray('addonT05Cases.ts', 'addonT05Cases')],
    ['addonT06Cases', parseCaseArray('addonT06Cases.ts', 'addonT06Cases')],
    ['addonT07Cases', parseCaseArray('addonT07Cases.ts', 'addonT07Cases')],
    ['addonT08Cases', parseCaseArray('addonT08Cases.ts', 'addonT08Cases')],
    ['addonT09Cases', parseCaseArray('addonT09Cases.ts', 'addonT09Cases')],
    ['addonT10Cases', parseCaseArray('addonT10Cases.ts', 'addonT10Cases')],
    ['addonT11Cases', parseCaseArray('addonT11Cases.ts', 'addonT11Cases')],
    ['addonT12Cases', parseCaseArray('addonT12Cases.ts', 'addonT12Cases')],
  ])
  const source = ts.createSourceFile('cases.ts', readFileSync('test/integration/suite/cases.ts', 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: Array<[string, null]> = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'cases') continue
      const array = declaration.initializer
      if (!array || !ts.isArrayLiteralExpression(array)) throw new Error('cases 须为明确的用例数组')
      for (const entry of array.elements) {
        if (ts.isSpreadElement(entry)) {
          const inlined = ts.isIdentifier(entry.expression) ? probeSpreads.get(entry.expression.text) : undefined
          if (inlined) {
            names.push(...inlined)
            continue
          }
          throw new Error('用例数组不支持未知展开')
        }
        if (!ts.isArrayLiteralExpression(entry) || !ts.isStringLiteral(entry.elements[0]!)) {
          throw new Error('用例须登记唯一的字面量名称')
        }
        names.push([entry.elements[0].text, null])
      }
    }
  }
  if (!names.length) throw new Error('未读取到生产用例清单')
  return names
}

it('四个 core 分片与第五组无交集、无漏项，其他同领域用例仍保留强制检查', () => {
  const all = productionCases()
  const core = [1, 2, 3, 4].flatMap((shard) =>
    selectIntegrationCases(all, { group: 'core', shard: `${shard}/4` }).selected.map(([name]) => name))
  const sensitive = selectIntegrationCases(all, { group: 'sensitive' }).selected.map(([name]) => name)
  const names = all.map(([name]) => name)
  expect(sensitive).toEqual(fixture.sensitive)
  expect(new Set([...core, ...sensitive]).size).toBe(all.length)
  expect([...core, ...sensitive].sort()).toEqual([...names].sort())
  expect(core.filter((name) => sensitive.includes(name))).toEqual([])
  expect(selectIntegrationCases(all).selected).toEqual(all)
  expect(core).toContain('CSS 片段：@import 子目录依赖生效与共享依赖隔离（#129）')
  expect(core).toContain('嵌入：限高设置持久化、回显与卡片热更（#222）')
  expect(core).toContain('Live 视口源锚点：Mermaid 围栏附近切标签页后中心行与光标保持')
  expect(core).toContain('搜索定位恢复（#318）：显式命令矩阵——首次/重复/多匹配/CRLF/剪贴板恢复')
  expect(core).toContain('搜索定位打开提示（#318）：首次激活提示/会话去重/设置门控')
  for (let shard = 1; shard <= 4; shard++) {
    const legacy = selectIntegrationCases(all, { shard: `${shard}/4` }).selected.map(([name]) => name)
    const actual = selectIntegrationCases(all, { group: 'core', shard: `${shard}/4` }).selected.map(([name]) => name)
    expect(actual).toEqual(legacy.filter((name) => !sensitive.includes(name)))
  }
})

it('CI 分开运行四个强制分片和第五组，敏感失败不被汇总或吞掉，双方留报告', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const jobs = workflow.jobs
  expect(jobs.integration_shard.strategy.matrix.shard).toEqual([1, 2, 3, 4])
  const coreRun = jobs.integration_shard.steps.find((step: { run?: string }) => step.run === 'xvfb-run -a npm run test:integration')
  expect(coreRun.env.VSIDIAN_TEST_GROUP).toBe('core')
  expect(jobs.integration.needs).toBe('integration_shard')
  const sensitive = jobs['integration-sensitive']
  expect(sensitive).toBeDefined()
  const sensitiveRun = sensitive.steps.find((step: { run?: string }) => step.run === 'xvfb-run -a npm run test:integration')
  expect(sensitiveRun.env.VSIDIAN_TEST_GROUP).toBe('sensitive')
  expect(sensitiveRun.env.VSIDIAN_TEST_SHARD).toBeUndefined()
  expect(sensitive['continue-on-error']).toBeUndefined()
  expect(sensitiveRun['continue-on-error']).toBeUndefined()
  for (const job of [jobs.integration_shard, sensitive]) {
    const upload = job.steps.find((step: { uses?: string }) => step.uses === 'actions/upload-artifact@v4')
    expect(upload.if).toBe('${{ always() }}')
    expect(upload.with.name).toContain('github.run_attempt')
    expect(upload.with.path).toMatch(/\.vscode-test\/integration-/)
  }
})
