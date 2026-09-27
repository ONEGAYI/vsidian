import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runSuites } from './runner.mjs'

test('有限并行继续收集失败，完整输出与退出码写入报告', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vsidian-browser-runner-'))
  try {
    const events = path.join(dir, 'events.jsonl')
    const suites = await Promise.all([0, 1, 2].map(async (id) => {
      const script = path.join(dir, `suite-${id}.mjs`)
      await writeFile(script, `import { appendFileSync, readFileSync } from 'node:fs';
        const report = JSON.parse(readFileSync(${JSON.stringify(path.join(dir, 'report/report.json'))}, 'utf8'));
        if (!report.suites.some(s => s?.name === 'suite-${id}' && s.status === 'running')) throw new Error('未写入运行中报告');
        const emit = kind => appendFileSync(${JSON.stringify(events)}, JSON.stringify({kind,id:${id}})+'\\n');
        emit('start'); console.log('stdout-${id}'); console.error('stderr-${id}');
        await new Promise(r => setTimeout(r, 150)); emit('end'); process.exitCode = ${id === 1 ? 7 : 0};`)
      return { name: `suite-${id}`, script }
    }))
    const reportDir = path.join(dir, 'report')
    const report = await runSuites({ suites, workers: 2, reportDir, root: dir, timeoutMs: 5000 })
    assert.equal(report.exitCode, 1)
    assert.deepEqual(report.suites.map(s => s.exitCode), [0, 7, 0])
    assert.ok(report.durationMs > 0)
    let active = 0, peak = 0
    for (const event of (await readFile(events, 'utf8')).trim().split('\n').map(JSON.parse)) {
      active += event.kind === 'start' ? 1 : -1
      peak = Math.max(peak, active)
    }
    assert.equal(peak, 2)
    assert.equal(active, 0)
    for (const suite of report.suites) {
      const log = await readFile(suite.logPath, 'utf8')
      assert.match(log, /stdout-/)
      assert.match(log, /stderr-/)
      assert.match(log, /EXIT=/)
      assert.ok(suite.durationMs > 0)
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(reportDir, 'report.json'), 'utf8')), report)
    assert.match(await readFile(path.join(reportDir, 'report.md'), 'utf8'), /suite-2/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('超时脚本标记失败并释放名额，后续脚本照常执行', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vsidian-browser-timeout-'))
  try {
    const hang = path.join(dir, 'hang.mjs'), pass = path.join(dir, 'pass.mjs')
    await writeFile(hang, 'setInterval(() => {}, 1000)')
    await writeFile(pass, 'console.log("after-timeout")')
    const report = await runSuites({ suites: [{ name: 'hang', script: hang }, { name: 'pass', script: pass }],
      workers: 1, reportDir: path.join(dir, 'report'), root: dir, timeoutMs: 1000 })
    assert.equal(report.exitCode, 1)
    assert.equal(report.suites[0].timedOut, true)
    assert.equal(report.suites[0].status, 'failed')
    assert.equal(report.suites[1].status, 'passed')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('取消时停止当前进程树，不再启动排队套件，并保留取消报告', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vsidian-browser-abort-'))
  try {
    const script = path.join(dir, 'hang.mjs')
    await writeFile(script, 'setInterval(() => {}, 1000)')
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 200)
    const report = await runSuites({ suites: [{ name: 'active', script }, { name: 'queued', script }],
      workers: 1, reportDir: path.join(dir, 'report'), root: dir, timeoutMs: 600, signal: abort.signal })
    clearTimeout(timer)
    assert.equal(report.exitCode, 130)
    assert.deepEqual(report.suites.map(s => s.status), ['cancelled', 'skipped'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('子进程通过运行器共享构建，并在报告中区分构建与缓存命中', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vsidian-browser-ipc-'))
  try {
    const entry = path.join(dir, 'entry.js'), outfile = path.join(dir, 'bundle.js')
    await writeFile(entry, 'console.log("shared-output")')
    const runtime = new URL('./runtime.mjs', import.meta.url).href
    const suites = await Promise.all([0, 1].map(async id => {
      const script = path.join(dir, `suite-${id}.mjs`)
      await writeFile(script, `import { build } from ${JSON.stringify(runtime)};
        await build(${JSON.stringify({ entryPoints: [entry], outfile, bundle: true })});
        await import(${JSON.stringify(pathToFileURL(outfile).href)});`)
      return { name: `suite-${id}`, script }
    }))
    const report = await runSuites({ suites, workers: 2, reportDir: path.join(dir, 'report'), root: dir })
    assert.equal(report.exitCode, 0)
    const builds = report.suites.flatMap(s => s.phases ?? []).filter(p => p.kind === 'build')
    assert.equal(builds.length, 2)
    assert.equal(builds.filter(p => p.cacheHit).length, 1)
    assert.ok(builds.every(p => p.durationMs >= 0 && p.buildMs >= 0 && p.waitMs >= 0))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
