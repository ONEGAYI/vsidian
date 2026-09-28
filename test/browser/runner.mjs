import { fork, execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { createBuildBroker } from './buildBroker.mjs'

export function parseBrowserRunOptions(args, names) {
  let workers = 3, reuseBuilds = true, selected = names
  for (const arg of args) {
    if (/^--workers=\d+$/.test(arg)) workers = Number(arg.slice('--workers='.length))
    else if (arg === '--no-reuse') reuseBuilds = false
    else if (arg.startsWith('--suite=')) selected = arg.slice('--suite='.length).split(',')
    else throw new Error(`未知参数: ${arg}`)
  }
  if (!Number.isInteger(workers) || workers < 1 || workers > 16) throw new Error('--workers 范围为 1..16')
  if (new Set(selected).size !== selected.length || selected.some(name => !names.includes(name))) {
    throw new Error(`--suite 必须是不重复的套件名，可选: ${names.join(',')}`)
  }
  return { workers, reuseBuilds, selected }
}

// 每个脚本保留独立进程/浏览器；一个失败仍收集其他脚本的结果。
export async function runSuites({ suites, workers, reportDir, root, timeoutMs = 120000, reuseBuilds = true, signal }) {
  if (!Number.isInteger(workers) || workers < 1) throw new Error('workers 必须为正整数')
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs 必须为正数')
  if (new Set(suites.map(s => s.name)).size !== suites.length || suites.some(s => !/^[\w-]+$/.test(s.name))) {
    throw new Error('套件名必须唯一，且只含字母、数字、下划线或连字符')
  }
  await mkdir(reportDir, { recursive: true })
  const start = performance.now()
  const broker = createBuildBroker({ build, reuse: reuseBuilds })
  const report = { startedAt: new Date().toISOString(), workers, reuseBuilds,
    environment: { platform: process.platform, arch: process.arch, node: process.version,
      browserChannel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || 'chromium' },
    durationMs: 0, exitCode: null, suites: [] }
  let writing = Promise.resolve()
  const save = () => {
    report.durationMs = Math.round(performance.now() - start)
    const snapshot = JSON.stringify(report, null, 2) + '\n'
    writing = writing.then(async () => {
      await writeFile(path.join(reportDir, 'report.json.tmp'), snapshot)
      await rename(path.join(reportDir, 'report.json.tmp'), path.join(reportDir, 'report.json'))
    })
    return writing
  }
  await save()
  let next = 0
  async function runOne(suite, index) {
    const started = performance.now()
    const logPath = path.join(reportDir, `${suite.name}.log`)
    const phasesPath = path.join(reportDir, `${suite.name}.phases.jsonl`)
    await writeFile(phasesPath, '')
    const log = createWriteStream(logPath)
    const result = { name: suite.name, status: 'running', startMs: Math.round(started - start),
      durationMs: 0, exitCode: null, signal: null, timedOut: false, logPath, phases: [] }
    report.suites[index] = result
    await save()
    return await new Promise((resolve, reject) => {
      const child = fork(suite.script, [], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: process.platform !== 'win32', windowsHide: true, execArgv: [], env: { ...process.env,
          VSIDIAN_BROWSER_BROKER: '1', VSIDIAN_BROWSER_PHASES: phasesPath,
          VSIDIAN_BROWSER_ARTIFACTS: path.join(reportDir, 'artifacts', ...(reuseBuilds ? [] : [suite.name])) } })
      child.on('message', async message => {
        if (message?.kind !== 'build') return
        let reply
        try { reply = { timing: await broker(message.options) } }
        catch (error) { reply = { error: error.stack ?? String(error) } }
        if (child.connected) child.send({ kind: 'build.result', id: message.id, ...reply }, () => {})
      })
      child.stdout.pipe(log, { end: false })
      child.stderr.pipe(log, { end: false })
      let stopping = false
      const stop = () => {
        if (stopping || !child.pid) return
        stopping = true
        // 仅清理本运行器创建的进程树，避免超时后遗留 Chromium。
        if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
        else { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
      }
      const cancel = () => { result.status = 'cancelled'; stop() }
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      const timer = setTimeout(() => {
        result.timedOut = true
        stop()
      }, timeoutMs)
      log.on('error', error => { stop(); reject(error) })
      child.on('error', error => log.write(`${error.stack}\n`))
      child.on('close', async (code, exitSignal) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        try {
          result.phases = (await readFile(phasesPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
        } catch (error) { log.write(`读取阶段报告失败: ${error.message}\n`); code = 1 }
        Object.assign(result, { durationMs: Math.round(performance.now() - started), exitCode: code,
          signal: exitSignal, status: result.status === 'cancelled' ? 'cancelled'
            : code === 0 && !result.timedOut ? 'passed' : 'failed' })
        log.end(`\nEXIT=${code} SIGNAL=${exitSignal ?? ''} TIMEOUT=${result.timedOut}\n`, () => resolve(result))
      })
    })
  }
  async function worker() {
    while (next < suites.length && !signal?.aborted) {
      const index = next++
      report.suites[index] = await runOne(suites[index], index)
      await save()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, suites.length) }, worker))
  for (let index = next; index < suites.length; index++) {
    report.suites[index] = { name: suites[index].name, status: 'skipped', durationMs: 0, exitCode: null, phases: [] }
  }
  report.exitCode = signal?.aborted ? 130 : report.suites.every(s => s.status === 'passed') ? 0 : 1
  const phases = report.suites.flatMap(s => s.phases)
  report.builds = { requests: phases.filter(p => p.kind === 'build').length,
    cacheHits: phases.filter(p => p.kind === 'build' && p.cacheHit).length,
    buildMs: Math.round(phases.reduce((sum, p) => sum + (p.buildMs ?? 0), 0)),
    waitMs: Math.round(phases.reduce((sum, p) => sum + (p.waitMs ?? 0), 0)) }
  await save()
  const seconds = ms => (ms / 1000).toFixed(2)
  const rows = report.suites.map(s => {
    const buildMs = s.phases.filter(p => p.kind === 'build').reduce((sum, p) => sum + p.durationMs, 0)
    const launchMs = s.phases.filter(p => p.kind === 'launch').reduce((sum, p) => sum + p.durationMs, 0)
    return `| ${s.name} | ${s.status} | ${seconds(s.durationMs)} | ${seconds(buildMs)} | ${seconds(launchMs)} | ${seconds(Math.max(0, s.durationMs - buildMs - launchMs))} | ${s.exitCode} |`
  })
  await writeFile(path.join(reportDir, 'report.md'), `# 浏览器测试报告\n\n总耗时：${seconds(report.durationMs)} 秒；并发：${workers}；退出码：${report.exitCode}。\n\n构建请求 ${report.builds.requests} 次，命中 ${report.builds.cacheHits} 次；实际构建 ${seconds(report.builds.buildMs)} 秒。\n\n各列单位为秒；构建列含排队/IPC 等待，其他列含测试交互、进程启动与清理。并发套件耗时不能直接相加当作总耗时。\n\n| 套件 | 结果 | 总计 | 构建及等待 | 浏览器启动 | 其他 | 退出码 |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n`)
  return report
}
