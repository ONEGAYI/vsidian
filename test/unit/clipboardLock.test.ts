import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withClipboardLock } from '../integration/suite/clipboardLock'

describe.skipIf(process.platform !== 'win32')('Windows 真实剪贴板跨进程互斥', () => {
  it('并发请求的用例正文不得交错', async () => {
    const mutexName = `Local\\VsidianClipboardUnit-${randomUUID()}`
    const events: string[] = []
    await Promise.all(['A', 'B'].map((name) => withClipboardLock(async () => {
      events.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      events.push(`${name}:end`)
    }, mutexName)))
    expect(events).toEqual(events[0] === 'A:start'
      ? ['A:start', 'A:end', 'B:start', 'B:end']
      : ['B:start', 'B:end', 'A:start', 'A:end'])
  })

  it('用例抛错后释放互斥量，后续用例仍能执行', async () => {
    const mutexName = `Local\\VsidianClipboardUnit-${randomUUID()}`
    const failure = new Error('用例失败')
    await expect(withClipboardLock(async () => { throw failure }, mutexName)).rejects.toBe(failure)
    let executed = false
    await withClipboardLock(async () => { executed = true }, mutexName)
    expect(executed).toBe(true)
  })

  it('不同命名互斥量独立执行，单测不等待集成测试的长用例', async () => {
    const mutexName = `Local\\VsidianClipboardUnit-${randomUUID()}`
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { started = resolve })
    const holder = withClipboardLock(async () => { started(); await gate }, mutexName)
    await entered
    const probe = withClipboardLock(async () => {}, `${mutexName}-independent`)
    let timer!: ReturnType<typeof setTimeout>
    let completed: boolean
    try {
      completed = await Promise.race([
        probe.then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 3000) }),
      ])
    } finally {
      clearTimeout(timer)
      release()
      await holder
    }
    await probe
    expect(completed).toBe(true)
  })
})
