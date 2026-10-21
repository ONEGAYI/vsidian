// T08（#628）跨宿主协议纯逻辑单元测试：错误编解码（Error.code 跨端丢失——
// 机器码进 message 前缀）、资源去重键、marker 钩子解析、执行端挂起资源
// 队列（去重/回填/超时/终结收口）与失败分态映射的 remote 分支。

import { describe, expect, it } from 'vitest'
import { encodePdfRemoteError, decodePdfRemoteError, pdfRemoteResourceKey } from '../../src/shared/pdfRemote'
import { RemoteResourceQueue } from '../../src/pdfExecutor/resourceQueue'
import { readPdfRemoteTestHooks } from '../../src/host/pdfExport/pdfRemoteTestHooks'
import { PdfExportRemoteChannelError, mapBrowserErrorToFailReason } from '../../src/host/pdfExport/pdfExportJob'

describe('pdfRemote 错误编解码', () => {
  it('编码后 message 携带机器码前缀，解码还原 code 与原文', () => {
    const error = encodePdfRemoteError('not-ready', '导出页未就绪：细节')
    expect(error).toBeInstanceOf(Error)
    const decoded = decodePdfRemoteError(error)
    expect(decoded).toEqual({ code: 'not-ready', message: '导出页未就绪：细节' })
  })

  it('非协议形态（普通 Error）解码返回 undefined', () => {
    expect(decodePdfRemoteError(new Error('普通错误'))).toBeUndefined()
    expect(decodePdfRemoteError('字符串')).toBeUndefined()
    expect(decodePdfRemoteError(undefined)).toBeUndefined()
  })

  it('message 含多行/特殊字符时仍可还原', () => {
    const error = encodePdfRemoteError('write-failed', 'line1\nline2: [bracket]')
    expect(decodePdfRemoteError(error)).toEqual({ code: 'write-failed', message: 'line1\nline2: [bracket]' })
  })
})

describe('pdfRemote 资源去重键', () => {
  it('doc + src 组合；doc 缺省与空串同键（server 侧空串归一为无身份）', () => {
    expect(pdfRemoteResourceKey('a.png', '/d/x.md')).toBe(`/d/x.md\u0000a.png`)
    expect(pdfRemoteResourceKey('a.png', undefined)).toBe(`\u0000a.png`)
    expect(pdfRemoteResourceKey('a.png', undefined)).toBe(pdfRemoteResourceKey('a.png', ''))
    expect(pdfRemoteResourceKey('a.png', '/d/x.md')).not.toBe(pdfRemoteResourceKey('b.png', '/d/x.md'))
  })
})

describe('readPdfRemoteTestHooks（marker 文件）', () => {
  it('hooks=true 且路径合法时解析出注入面', () => {
    const hooks = readPdfRemoteTestHooks(
      () => JSON.stringify({ hooks: true, saveTarget: 'D:/out/a.pdf', targetDir: 'D:/out' }),
      '/ws',
    )
    expect(hooks).toEqual({ hooks: true, saveTarget: 'D:/out/a.pdf', targetDir: 'D:/out' })
  })

  it('缺席/损坏/hooks 非 true 返回 undefined（不静默扩大钩子面）', () => {
    const boom = (): string => {
      throw new Error('ENOENT')
    }
    expect(readPdfRemoteTestHooks(boom, '/ws')).toBeUndefined()
    expect(readPdfRemoteTestHooks(() => 'not json', '/ws')).toBeUndefined()
    expect(readPdfRemoteTestHooks(() => JSON.stringify({ hooks: false }), '/ws')).toBeUndefined()
    expect(readPdfRemoteTestHooks(() => JSON.stringify({ hooks: true }), undefined)).toBeUndefined()
  })

  it('空串路径字段被剔除', () => {
    expect(readPdfRemoteTestHooks(() => JSON.stringify({ hooks: true, saveTarget: '' }), '/ws'))
      .toEqual({ hooks: true })
  })
})

describe('RemoteResourceQueue（执行端挂起资源队列）', () => {
  it('同 key 并发请求共享一条目，回填一次唤醒全部等待者', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 5_000 })
    const p1 = queue.request('img.png', '/d/a.md')
    const p2 = queue.request('img.png', '/d/a.md')
    expect(queue.pendingList()).toEqual([
      { key: pdfRemoteResourceKey('img.png', '/d/a.md'), src: 'img.png', doc: '/d/a.md' },
    ])
    queue.provide([{ key: pdfRemoteResourceKey('img.png', '/d/a.md'), ok: true, contentType: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') }])
    expect(await p1).toEqual({ ok: true, contentType: 'image/png', bytes: Buffer.from([1, 2, 3]) })
    expect(await p2).toEqual({ ok: true, contentType: 'image/png', bytes: Buffer.from([1, 2, 3]) })
    expect(queue.pendingList()).toEqual([])
  })

  it('等待超时以 inaccessible 收口（远端不响应不悬挂）', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 20 })
    const outcome = await queue.request('img.png', undefined)
    expect(outcome).toEqual({ ok: false, reason: 'inaccessible' })
  })

  it('失败回填按给定 reason 呈现；未知 key 迟到回填忽略', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 5_000 })
    const p = queue.request('x.png', undefined)
    queue.provide([{ key: pdfRemoteResourceKey('x.png', undefined), ok: false, reason: 'not-found' }])
    expect(await p).toEqual({ ok: false, reason: 'not-found' })
    queue.provide([{ key: pdfRemoteResourceKey('x.png', undefined), ok: true, contentType: 'image/png', base64: '' }])
    expect(queue.pendingList()).toEqual([])
  })

  it('failAll 收口全部在途等待（任务终结路径）', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 5_000 })
    const p1 = queue.request('a.png', undefined)
    const p2 = queue.request('b.png', undefined)
    queue.failAll({ ok: false, reason: 'blocked' })
    expect(await p1).toEqual({ ok: false, reason: 'blocked' })
    expect(await p2).toEqual({ ok: false, reason: 'blocked' })
    expect(queue.pendingList()).toEqual([])
  })

  it('dispose 后新请求直接 blocked', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 5_000 })
    queue.dispose()
    expect(await queue.request('a.png', undefined)).toEqual({ ok: false, reason: 'blocked' })
  })

  it('空 src 直接 blocked（与 /res 守卫同口径）', async () => {
    const queue = new RemoteResourceQueue({ timeoutMs: 5_000 })
    expect(await queue.request('', undefined)).toEqual({ ok: false, reason: 'blocked' })
  })
})

describe('mapBrowserErrorToFailReason 的 remote 分支', () => {
  it('missing → executor-missing；unreachable → executor-unreachable', () => {
    expect(mapBrowserErrorToFailReason(new PdfExportRemoteChannelError('x', 'missing'))).toBe('executor-missing')
    expect(mapBrowserErrorToFailReason(new PdfExportRemoteChannelError('x', 'unreachable'))).toBe('executor-unreachable')
    expect(mapBrowserErrorToFailReason(new PdfExportRemoteChannelError('x'))).toBe('executor-unreachable')
  })
})
