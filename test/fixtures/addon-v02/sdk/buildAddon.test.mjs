import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTestAddons } from './buildAddon.mjs'

test('后一套件构建期间，前一套件的组件资源必须仍可读取', async t => {
  const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.build')
  const owned = []
  t.after(async () => {
    for (const target of owned) await rm(target, { recursive: true })
  })
  const first = await buildTestAddons({ log: () => {} })
  const entry = path.join(first.t10Addon.distDir, 'editor.js')
  const expected = await readFile(entry, 'utf8')
  const rebuilding = buildTestAddons({ log: () => {} })
  const [resource, rebuilt] = await Promise.allSettled([readFile(entry, 'utf8'), rebuilding])
  assert.equal(resource.status, 'fulfilled', '前一套件正在服务的脚本被后一构建删除')
  assert.equal(rebuilt.status, 'fulfilled')
  assert.equal(resource.value, expected, '构建期间不得改写前一套件的组件资源')
  for (const layout of [first, rebuilt.value]) {
    const target = path.resolve(layout.buildRoot)
    assert.equal(path.dirname(target), cacheRoot, '只清理本用例拥有的独立构建目录')
    owned.push(target)
  }
})
