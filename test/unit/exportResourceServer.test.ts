// T02（#622）PDF 导出资源服务单元测试：token 根守卫、静态产物、/res 与
// /resource 的身份守卫与失败分态（真起 127.0.0.1 服务，fetch 探测）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startExportResourceServer, type ExportResourceResolvePort } from '../../src/host/pdfExport/exportResourceServer'

const staticDir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-server-test-'))
const knownDocs = new Set(['D:/vault/笔记甲.md'])
writeFileSync(path.join(staticDir, 'pdfExportPage.js'), '// export page bundle', 'utf8')
writeFileSync(path.join(staticDir, 'pdfExportPage.css'), 'body{}', 'utf8')
mkdirSync(path.join(staticDir, 'assets'), { recursive: true })
writeFileSync(path.join(staticDir, 'assets', 'KaTeX_Main-Regular.woff2'), Buffer.from([0x00, 0x01]))

const ports: ExportResourceResolvePort = {
  resolve: async (src) => {
    if (src === 'ok.png') {
      return { ok: true, fsPath: path.join(staticDir, 'assets', 'ok.png'), contentType: 'image/png' }
    }
    if (src === 'missing.png') {
      return { ok: false, reason: 'not-found' }
    }
    if (src === 'denied.png') {
      return { ok: false, reason: 'inaccessible' }
    }
    return { ok: false, reason: 'blocked' }
  },
  knownDocFsPaths: () => knownDocs,
}

let server: Awaited<ReturnType<typeof startExportResourceServer>>
const assetRoot = path.join(staticDir, 'assets')

beforeAll(async () => {
  writeFileSync(path.join(assetRoot, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  server = await startExportResourceServer(staticDir, ports)
})

afterAll(() => {
  server.close()
  rmSync(staticDir, { recursive: true, force: true, maxRetries: 3 })
})

describe('exportResourceServer：token 根与静态产物', () => {
  it('token 根之外的路径 404 且不暴露服务存在', async () => {
    const origin = server.baseUrl.slice(0, server.baseUrl.lastIndexOf('/'))
    const probe = await fetch(`${origin}/`)
    expect(probe.status).toBe(404)
    const wrongToken = await fetch(`${origin}/deadbeef/export.html`)
    expect(wrongToken.status).toBe(404)
  })

  it('静态产物按 Content-Type 供给（js/css/woff2）', async () => {
    const js = await fetch(`${server.baseUrl}/pdfExportPage.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')
    const font = await fetch(`${server.baseUrl}/assets/KaTeX_Main-Regular.woff2`)
    expect(font.status).toBe(200)
    expect(font.headers.get('content-type')).toContain('font/woff2')
  })

  it('export.html 未设置时 503；设置后返回装配页', async () => {
    const before = await fetch(`${server.baseUrl}/export.html`)
    expect(before.status).toBe(503)
    server.setExportPage('<!DOCTYPE html><p>page</p>')
    const after = await fetch(`${server.baseUrl}/export.html`)
    expect(after.status).toBe(200)
    expect(await after.text()).toContain('page')
  })

  it('路径穿越被拒（../ 序列不出静态目录）', async () => {
    const probe = await fetch(`${server.baseUrl}/..%2F..%2Fpackage.json`)
    expect([403, 404]).toContain(probe.status)
  })
})

describe('exportResourceServer：/res 资源端点', () => {
  it('解析成功供字节流（Content-Type 与 no-store）', async () => {
    const res = await fetch(`${server.baseUrl}/res?src=ok.png&doc=${encodeURIComponent('D:/vault/笔记甲.md')}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('image/png')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.arrayBuffer()).byteLength).toBe(4)
  })

  it('解析失败回 JSON 分态（not-found）', async () => {
    const res = await fetch(`${server.baseUrl}/res?src=missing.png`)
    expect(res.status).toBe(404)
    const body = await res.json() as { ok: boolean; reason: string }
    expect(body.reason).toBe('not-found')
  })

  it('未登记 doc 身份被拒（blocked——不信任任意 URI）', async () => {
    const res = await fetch(`${server.baseUrl}/res?src=ok.png&doc=${encodeURIComponent('D:/other/evil.md')}`)
    const body = await res.json() as { reason: string }
    expect(body.reason).toBe('blocked')
  })

  it('空 src 拒绝', async () => {
    const res = await fetch(`${server.baseUrl}/res?src=`)
    expect((await res.json() as { reason: string }).reason).toBe('blocked')
  })
})

describe('exportResourceServer：/resource htmlResource 通道', () => {
  it('reqId 配对回包：成功 URL 指向 /res 同端点', async () => {
    const res = await fetch(`${server.baseUrl}/resource`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reqId: 41, url: 'ok.png', sourceDocUri: 'D:/vault/笔记甲.md' }),
    })
    const body = await res.json() as { reqId: number; ok: boolean; url: string }
    expect(body).toMatchObject({ reqId: 41, ok: true })
    expect(body.url).toContain('/res?')
  })

  it('失败分态透传（not-found）；未登记 sourceDocUri 拒绝', async () => {
    const fail = await fetch(`${server.baseUrl}/resource`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reqId: 42, url: 'missing.png' }),
    })
    expect((await fail.json() as { ok: boolean; reason: string }).reason).toBe('not-found')
    const denied = await fetch(`${server.baseUrl}/resource`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reqId: 43, url: 'ok.png', sourceDocUri: 'D:/other/evil.md' }),
    })
    expect((await denied.json() as { ok: boolean; reason: string }).reason).toBe('blocked')
  })

  it('非法载荷 400', async () => {
    const res = await fetch(`${server.baseUrl}/resource`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })
})
