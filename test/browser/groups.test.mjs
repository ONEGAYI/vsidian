// 浏览器测试分组契约（仿集成第五敏感组，2026-10-14）：钉住分组环境变量
// 语义、敏感名单内容、名单与 run.mjs 全量清单不失配，以及 run.mjs/ci.yml
// 的接线在场。名单与维护口径的正文见 docs/specs/integration-test-groups.md
// 「浏览器测试分组」节；未定性失败跟踪在 #446（条目 9）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BROWSER_SENSITIVE_SUITES, parseBrowserGroupEnv, selectBrowserSuites } from './groups.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('分组环境变量只接受 all/core/sensitive，缺省 all（本地默认全量不变）', () => {
  assert.equal(parseBrowserGroupEnv(undefined), 'all')
  assert.equal(parseBrowserGroupEnv(''), 'all')
  assert.equal(parseBrowserGroupEnv('all'), 'all')
  assert.equal(parseBrowserGroupEnv('core'), 'core')
  assert.equal(parseBrowserGroupEnv('sensitive'), 'sensitive')
  assert.throws(() => parseBrowserGroupEnv('cor'), /VSIDIAN_TEST_BROWSER_GROUP/)
  assert.throws(() => parseBrowserGroupEnv('SENSITIVE'), /VSIDIAN_TEST_BROWSER_GROUP/)
})

test('组别过滤保持文档序：core 排除敏感、sensitive 只留敏感', () => {
  const names = ['alpha', 'tableCaret', 'beta', 'addonT10Commands', 'addonRendererTakeover']
  assert.deepEqual(selectBrowserSuites(names, names, 'all'), names)
  assert.deepEqual(selectBrowserSuites(names, names, 'core'), ['alpha', 'beta'])
  assert.deepEqual(selectBrowserSuites(names, names, 'sensitive'),
    ['tableCaret', 'addonT10Commands', 'addonRendererTakeover'])
})

test('敏感名单引用全量清单之外的套件时立即失败（任意组别，防拼写漂移）', () => {
  assert.throws(() => selectBrowserSuites(['alpha'], ['alpha'], 'all'), /未知套件/)
  assert.throws(() => selectBrowserSuites(['alpha'], ['alpha'], 'core'), /未知套件/)
  assert.throws(() => selectBrowserSuites(['tableCaret'], ['tableCaret'], 'sensitive'), /未知套件/)
})

test('定向 --suite 与组别取交集，空集报错（不静默跑空）', () => {
  const names = ['alpha', 'tableCaret', 'beta', 'addonT10Commands', 'addonRendererTakeover']
  assert.deepEqual(selectBrowserSuites(names, ['tableCaret'], 'sensitive'), ['tableCaret'])
  assert.deepEqual(selectBrowserSuites(names, ['alpha'], 'all'), ['alpha'])
  assert.deepEqual(selectBrowserSuites(names, ['beta', 'alpha'], 'core'), ['beta', 'alpha'])
  assert.throws(() => selectBrowserSuites(names, ['tableCaret'], 'core'), /交集为空/)
})

test('当前敏感名单钉住三个套件（增删须同步文档台账与 #446，不自动归类新失败）', () => {
  assert.deepEqual(BROWSER_SENSITIVE_SUITES, ['tableCaret', 'addonT10Commands', 'addonRendererTakeover'])
})

test('真实全量清单包含全部敏感套件（run.mjs 的 names 与名单不失配）', async () => {
  const source = await readFile(path.join(root, 'test/browser/run.mjs'), 'utf8')
  const namesMatch = source.match(/const names = \[([\s\S]*?)\]/)
  assert.ok(namesMatch, 'run.mjs 应保留 names 数组字面量')
  const listed = new Set(namesMatch[1].split(/['",\s]+/).filter(Boolean))
  for (const name of BROWSER_SENSITIVE_SUITES) {
    assert.ok(listed.has(name), `run.mjs names 缺敏感套件 ${name}`)
  }
})

test('接线契约：run.mjs 消费组别环境变量，ci.yml 双 job 按组运行并分名上传报告', async () => {
  const runSource = await readFile(path.join(root, 'test/browser/run.mjs'), 'utf8')
  assert.match(runSource, /VSIDIAN_TEST_BROWSER_GROUP/)
  assert.match(runSource, /selectBrowserSuites/)
  const ci = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /browser-sensitive:/)
  assert.match(ci, /VSIDIAN_TEST_BROWSER_GROUP: core/)
  assert.match(ci, /VSIDIAN_TEST_BROWSER_GROUP: sensitive/)
  assert.match(ci, /browser-core-reports-a\$\{\{ github\.run_attempt \}\}/)
  assert.match(ci, /browser-sensitive-reports-a\$\{\{ github\.run_attempt \}\}/)
})
