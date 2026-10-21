// PDF 导出页微型资源服务（T02/#622）：仅绑 127.0.0.1 随机端口的 http 服务
//（V01 探针 pdfVerify.ts 的模式收编产品化）。
//
// 职责：
// - `GET /<token>/export.html`：骨架页（payload 内联注入——pdfExportPage
//   装配产物；服务端持有当前任务的固定输入，页面零回读）；
// - 静态产物：pdfExportPage.js|css、KaTeX 字体 assets/、mermaid.js 与
//   mermaid-chunks/（懒加载产物同源供——ESM 动态分块相对路径天然同源）；
// - `GET /<token>/res?src&doc`：资源解析 + 字节流（图片正文装载通道——
//   classifyImageTarget 白名单与路径规则经注入端口复用，**只换装载地址
//   构造层**：asWebviewUri → 本服务 URL，不建第二套路径解析）；
// - `POST /<token>/resource`：htmlResource.request 的 http 通道（reqId 配对
//   空间与 /res 独立——对齐 htmlResourceHub 的消息种隔离纪律）。
//
// 安全面：随机 token 根（16 字节 hex——非 token 前缀一律 404，防本机其他
// 页面探测枚举）；绑定 127.0.0.1；doc 身份须为本次固定输入登记过的 fsPath
//（与 webview 面的「不信任前端任意 URI」同口径）。每次任务一个服务实例，
// close 即释放（连接摧毁）。

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

/** 资源解析端口（生产 = provider 的 classifyImageTarget + stat + readFile 组合） */
export interface ExportResourceResolvePort {
  /**
   * 解析一个资源图源（以 sourceFsPath 身份——原文档目录/根边界）。
   * 成功给出 fsPath 与 MIME（字节由服务端自读——不把字节经端口搬运两次）。
   */
  resolve(src: string, sourceFsPath: string | undefined): Promise<
    | { ok: true; fsPath: string; contentType: string }
    | { ok: false; reason: 'not-found' | 'inaccessible' | 'blocked' }
  >
  /** 本次固定输入登记过的文档身份集合（/res 与 /resource 的 doc 守卫） */
  knownDocFsPaths(): ReadonlySet<string>
}

export interface ExportResourceServer {
  /** 服务根（含 token：http://127.0.0.1:<port>/<token>） */
  baseUrl: string
  /** 设置当前任务的导出页 HTML（export.html 的应答体；新一轮任务整页替换） */
  setExportPage(html: string): void
  /** 关闭服务（销毁连接；幂等） */
  close(): void
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

function contentTypeOf(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 起资源服务。staticDir = out/webview（产物与资产根）。 */
export async function startExportResourceServer(
  staticDir: string,
  ports: ExportResourceResolvePort,
): Promise<ExportResourceServer> {
  const token = randomBytes(16).toString('hex')
  let exportPageHtml = ''
  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, reason: 'internal' })
      // eslint-disable-next-line no-console -- 服务端错误入 stderr 供诊断
      console.error('[vsidian] PDF 导出资源服务异常', error)
    })
  })

  async function serveStatic(res: ServerResponse, rel: string): Promise<void> {
    const safe = path.normalize(rel).replace(/^([.][.][\\/])+/, '')
    const full = path.join(staticDir, safe)
    if (!full.startsWith(path.resolve(staticDir))) {
      sendJson(res, 404, { ok: false, reason: 'not-found' })
      return
    }
    try {
      const info = await stat(full)
      if (!info.isFile()) throw new Error('not a file')
      const bytes = await readFile(full)
      res.writeHead(200, { 'content-type': contentTypeOf(full), 'content-length': bytes.length })
      res.end(bytes)
    } catch {
      sendJson(res, 404, { ok: false, reason: 'not-found' })
    }
  }

  async function resolveResourceUrl(rawUrl: string): Promise<
    { ok: true; fsPath: string; contentType: string } | { ok: false; reason: string }
  > {
    const url = new URL(rawUrl, 'http://127.0.0.1')
    const src = url.searchParams.get('src') ?? ''
    const doc = url.searchParams.get('doc') ?? undefined
    if (src === '') return { ok: false, reason: 'blocked' }
    if (doc !== undefined && doc !== '' && !ports.knownDocFsPaths().has(doc)) {
      return { ok: false, reason: 'blocked' }
    }
    const outcome = await ports.resolve(src, doc === '' ? undefined : doc)
    if (!outcome.ok) return outcome
    return outcome
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/'
    const prefix = `/${token}/`
    if (!rawUrl.startsWith(prefix)) {
      // token 根之外的任何路径不透露服务存在
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const route = rawUrl.slice(prefix.length).split('?')[0]!

    if (route === 'export.html' && (req.method === 'GET' || req.method === 'HEAD')) {
      if (exportPageHtml === '') {
        sendJson(res, 503, { ok: false, reason: 'no-export' })
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(exportPageHtml)
      return
    }

    // T05（#625）书签定位页：装载同源 pdfMain.js（#337 随包产物，挂全局
    // __vsidianPdfjs）的最小页面。无 CSP——与 V01 探针验证引擎宿主页同形态
    //（worker 经 fetch→Blob→objectURL 装配需要；页面必须 http origin，V01
    // §10.1 opaque origin 坑）。仅书签开启时由宿主定向创建 target 访问。
    if (route === 'locate.html' && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>locate</title>'
        + '<script src="pdfMain.js"></script></head><body></body></html>')
      return
    }

    if (route === 'res' && req.method === 'GET') {
      const outcome = await resolveResourceUrl(rawUrl)
      if (!outcome.ok) {
        sendJson(res, 404, { ok: false, reason: outcome.reason })
        return
      }
      try {
        const bytes = await readFile(outcome.fsPath)
        res.writeHead(200, {
          'content-type': outcome.contentType,
          'content-length': bytes.length,
          'cache-control': 'no-store',
        })
        res.end(bytes)
      } catch {
        sendJson(res, 404, { ok: false, reason: 'inaccessible' })
      }
      return
    }

    if (route === 'resource' && req.method === 'POST') {
      let body: { reqId?: unknown; url?: unknown; sourceDocUri?: unknown }
      try {
        body = JSON.parse(await readBody(req)) as typeof body
      } catch {
        sendJson(res, 400, { ok: false, reason: 'bad-request' })
        return
      }
      const reqId = typeof body.reqId === 'number' ? body.reqId : null
      if (reqId === null) {
        sendJson(res, 400, { ok: false, reason: 'bad-request' })
        return
      }
      const sourceDocUri = typeof body.sourceDocUri === 'string' ? body.sourceDocUri : undefined
      if (sourceDocUri !== undefined && !ports.knownDocFsPaths().has(sourceDocUri)) {
        sendJson(res, 403, { reqId, ok: false, reason: 'blocked' })
        return
      }
      const src = typeof body.url === 'string' ? body.url : ''
      const outcome = await ports.resolve(src, sourceDocUri)
      if (!outcome.ok) {
        sendJson(res, 200, { reqId, ok: false, reason: outcome.reason })
        return
      }
      // 解析成功的装载地址：/res 同一端点（身份参数一致——图片与 HTML
      // 资源同一解析面，reqId 空间隔离只约束回包路由）
      const q = new URLSearchParams({ src })
      if (sourceDocUri !== undefined && sourceDocUri !== '') q.set('doc', sourceDocUri)
      sendJson(res, 200, { reqId, ok: true, url: `${prefix}res?${q.toString()}` })
      return
    }

    // 静态产物（pdfExportPage.js|css、assets/、mermaid.js、mermaid-chunks/）
    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(res, route)
      return
    }
    sendJson(res, 405, { ok: false, reason: 'method-not-allowed' })
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  const baseUrl = `http://127.0.0.1:${port}/${token}`
  return {
    baseUrl,
    setExportPage: (html) => {
      exportPageHtml = html
    },
    close: () => {
      server.closeAllConnections?.()
      server.close()
    },
  }
}
