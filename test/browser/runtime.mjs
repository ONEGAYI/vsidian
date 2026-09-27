import { build as esbuild } from 'esbuild'
import { chromium as playwrightChromium } from 'playwright'
import { appendFileSync } from 'node:fs'
import path from 'node:path'

export function artifactPath(root, ...parts) {
  return path.join(process.env.VSIDIAN_BROWSER_ARTIFACTS || path.join(root, 'out/test/browser'), ...parts)
}

function record(phase) {
  if (process.env.VSIDIAN_BROWSER_PHASES) appendFileSync(process.env.VSIDIAN_BROWSER_PHASES, JSON.stringify(phase) + '\n')
}

let requestId = 0
async function requestBuild(options) {
  const id = ++requestId
  return await new Promise((resolve, reject) => {
    const cleanup = () => { process.off('message', receive); process.off('disconnect', disconnected) }
    const disconnected = () => { cleanup(); reject(new Error('构建调度进程已断开')) }
    const receive = message => {
      if (message?.kind !== 'build.result' || message.id !== id) return
      cleanup()
      if (message.error) reject(new Error(message.error))
      else resolve(message.timing)
    }
    process.on('message', receive)
    process.once('disconnect', disconnected)
    process.send({ kind: 'build', id, options }, error => {
      if (error) { cleanup(); reject(error) }
    })
  })
}

// 当前脚本只消费写出的文件，不消费 esbuild BuildResult。
// 含函数的插件配置不能经 IPC 序列化，保留本进程构建并计时。
export async function build(options) {
  const start = performance.now()
  try {
    let timing
    if (process.env.VSIDIAN_BROWSER_BROKER === '1' && process.send && !options.plugins?.length) {
      timing = await requestBuild(options)
    } else {
      await esbuild(options)
      timing = { cacheHit: false, buildMs: performance.now() - start, waitMs: 0 }
    }
    record({ kind: 'build', output: options.outfile, ...timing, durationMs: performance.now() - start, status: 'passed' })
  } catch (error) {
    record({ kind: 'build', output: options.outfile, durationMs: performance.now() - start, status: 'failed' })
    throw error
  }
}

export const chromium = {
  async launch(options) {
    const start = performance.now()
    try {
      const browser = await playwrightChromium.launch(options)
      record({ kind: 'launch', durationMs: performance.now() - start, status: 'passed' })
      return browser
    } catch (error) {
      record({ kind: 'launch', durationMs: performance.now() - start, status: 'failed' })
      throw error
    }
  },
}
