import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { createBuildBroker } from './buildBroker.mjs'

test('并发的相同构建只执行一次，配置差异与新一轮源码变更不误用缓存', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vsidian-browser-build-'))
  try {
    const entry = path.join(dir, 'entry.js'), outfile = path.join(dir, 'bundle.js')
    await writeFile(entry, 'console.log("original")')
    let calls = 0
    const countedBuild = async options => { calls++; return await build(options) }
    const broker = createBuildBroker({ build: countedBuild })
    const options = { entryPoints: [entry], outfile, bundle: true }
    const results = await Promise.all([broker(options), broker({ bundle: true, outfile, entryPoints: [entry] })])
    assert.equal(calls, 1)
    assert.deepEqual(results.map(r => r.cacheHit), [false, true])
    assert.match(await readFile(outfile, 'utf8'), /original/)
    await assert.rejects(broker({ ...options, minify: true }), /构建配置冲突/)
    await broker({ ...options, outfile: path.join(dir, 'min.js'), minify: true })
    assert.equal(calls, 2)
    await writeFile(entry, 'console.log("changed")')
    await createBuildBroker({ build: countedBuild })(options)
    assert.equal(calls, 3)
    assert.match(await readFile(outfile, 'utf8'), /changed/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('关闭复用时每次构建；失败传播给全部等待者且不阻塞其他构建', async () => {
  let calls = 0
  const build = async options => { calls++; if (options.outfile === 'bad.js') throw new Error('build failed') }
  const uncached = createBuildBroker({ build, reuse: false })
  await Promise.all([uncached({ outfile: 'good.js' }), uncached({ outfile: 'good.js' })])
  assert.equal(calls, 2)
  const cached = createBuildBroker({ build })
  const results = await Promise.allSettled([cached({ outfile: 'bad.js' }), cached({ outfile: 'bad.js' }), cached({ outfile: 'good.js' })])
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected', 'fulfilled'])
  assert.match(results[0].reason.message, /build failed/)
  assert.equal(calls, 4)
})
