// #619（V01）PDF 导出探针 · 路线 B 核心：零依赖 CDP 直连客户端。
// 宿主 Node 18.15 没有全局 WebSocket（Node 22 才默认开启），因此用
// node:net + node:crypto 手写最小 RFC 6455 文本帧客户端：
// - 握手：HTTP/1.1 Upgrade + Sec-WebSocket-Key（16 随机字节 base64）；
// - 发送：客户端帧必须掩码（opcode 1 文本帧，7/16/64 位长度）；
// - 接收：服务端帧不掩码，支持分片（continuation）、ping/pong、close；
// - 大消息（printToPDF 返回数 MB base64）跨 TCP 分片按 Buffer 状态机累积。
// 在其上封装 CdpConnection（browser 级 WS）与 CdpSession
// （Target.attachToTarget flatten 模式，sessionId 路由）。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

import { connect as netConnect, Socket } from 'node:net'
import { randomBytes } from 'node:crypto'

/** 最小 WebSocket 客户端事件接口。 */
export interface MiniWebSocketOptions {
  url: string
  /** 握手失败或 socket 错误时的错误回调。 */
  onError?: (error: Error) => void
  /** 连接关闭（含服务端主动 close 帧）。 */
  onClose?: (code: number | null, reason: string) => void
}

interface FrameHeader {
  fin: boolean
  opcode: number
  masked: boolean
  length: number
  headerSize: number
}

/** 解析缓冲区头部一个帧的元信息；字节不足时返回 null。 */
function parseFrameHeader(buf: Buffer): FrameHeader | null {
  if (buf.length < 2) return null
  const b0 = buf[0]
  const b1 = buf[1]
  const fin = (b0 & 0x80) !== 0
  const opcode = b0 & 0x0f
  const masked = (b1 & 0x80) !== 0
  let length = b1 & 0x7f
  let headerSize = 2
  if (length === 126) {
    if (buf.length < 4) return null
    length = buf.readUInt16BE(2)
    headerSize = 4
  } else if (length === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket 帧长度超过安全整数')
    length = Number(big)
    headerSize = 10
  }
  if (masked) headerSize += 4
  return { fin, opcode, masked, length, headerSize }
}

export class MiniWebSocket {
  private socket: Socket
  private buffer: Buffer = Buffer.alloc(0)
  private established = false
  private closed = false
  private fragments: Buffer[] = []
  private fragmentOpcode = 0
  private pendingClose = false
  readonly ready: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  /** 收到完整文本消息（已按 UTF-8 解码）。 */
  onMessage: ((text: string) => void) | null = null

  constructor(private options: MiniWebSocketOptions) {
    const url = new URL(options.url)
    if (url.protocol !== 'ws:') throw new Error(`仅支持 ws://（探针场景为 127.0.0.1 本地调试端口），收到 ${url.protocol}`)
    const port = Number(url.port) || 80
    const key = randomBytes(16).toString('base64')
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.socket = netConnect({ host: url.hostname, port }, () => {
      this.socket.write(
        `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
        `Host: ${url.hostname}:${port}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n',
      )
    })
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk))
    this.socket.on('error', (error) => {
      if (!this.established) this.rejectReady(new Error(`WebSocket socket 错误：${error.message}`))
      else this.options.onError?.(new Error(`WebSocket socket 错误：${error.message}`))
      this.destroy()
    })
    this.socket.on('close', () => {
      if (!this.established) this.rejectReady(new Error('WebSocket 握手前 socket 关闭'))
      if (!this.closed) {
        this.closed = true
        this.options.onClose?.(null, 'socket 关闭')
      }
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    if (!this.established) {
      // 握手阶段：解析到 \r\n\r\n 为止
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      this.buffer = this.buffer.subarray(headerEnd + 4)
      if (!/^HTTP\/1\.1 101/.test(header)) {
        this.rejectReady(new Error(`WebSocket 握手失败（非 101）：${header.split('\r\n')[0]}`))
        this.destroy()
        return
      }
      this.established = true
      this.resolveReady()
    }
    // 帧解析循环
    for (;;) {
      const header = parseFrameHeader(this.buffer)
      if (!header) return
      if (this.buffer.length < header.headerSize + header.length) return
      let payload = this.buffer.subarray(header.headerSize, header.headerSize + header.length)
      if (header.masked) {
        const mask = this.buffer.subarray(header.headerSize - 4, header.headerSize)
        const unmasked = Buffer.allocUnsafe(header.length)
        for (let i = 0; i < header.length; i++) unmasked[i] = payload[i] ^ mask[i & 3]
        payload = unmasked
      }
      this.buffer = this.buffer.subarray(header.headerSize + header.length)
      this.handleFrame(header.fin, header.opcode, payload)
    }
  }

  private handleFrame(fin: boolean, opcode: number, payload: Buffer): void {
    if (opcode === 0x9) { // ping → 回 pong
      this.sendRaw(0x0a, payload)
      return
    }
    if (opcode === 0x0a) return // pong，忽略
    if (opcode === 0x8) { // close → 回 close 并关 socket
      if (!this.pendingClose) {
        this.pendingClose = true
        try { this.sendRaw(0x8, payload) } catch { /* 对端已关 */ }
      }
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : null
      this.closed = true
      this.destroy()
      this.options.onClose?.(code, payload.subarray(2).toString('utf8'))
      return
    }
    if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
      if (opcode !== 0x0) this.fragmentOpcode = opcode
      this.fragments.push(payload)
      if (fin) {
        const whole = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments)
        this.fragments = []
        const text = this.fragmentOpcode === 0x1 ? whole.toString('utf8') : ''
        this.onMessage?.(text)
      }
    }
  }

  /** 发送一个文本帧（客户端掩码）。 */
  send(text: string): void {
    if (!this.established || this.closed) throw new Error('WebSocket 未就绪或已关闭，不能发送')
    this.sendRaw(0x1, Buffer.from(text, 'utf8'))
  }

  private sendRaw(opcode: number, payload: Buffer): void {
    const mask = randomBytes(4)
    const masked = Buffer.allocUnsafe(payload.length)
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3]
    let header: Buffer
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length])
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  close(): void {
    if (!this.closed && this.established) {
      try { this.sendRaw(0x8, Buffer.alloc(0)) } catch { /* 已关 */ }
    }
    this.closed = true
    this.destroy()
  }

  private destroy(): void {
    this.fragments = []
    this.buffer = Buffer.alloc(0)
    this.socket.destroy()
  }
}

/** CDP 协议消息（flatten 模式：命令与事件都可携带 sessionId）。 */
interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  sessionId?: string
  error?: { code: number; message: string; data?: unknown }
  result?: unknown
}

export class CdpConnection {
  private ws: MiniWebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; method: string }>()
  private handlers = new Map<string, Array<(params: unknown, sessionId: string | undefined) => void>>()
  private closeListeners: Array<() => void> = []
  /** 连接断开时置 true；此后 send 立即 reject，不悬挂。 */
  disconnected = false

  static async connect(wsUrl: string): Promise<CdpConnection> {
    const connection = new CdpConnection()
    const ws = new MiniWebSocket({
      url: wsUrl,
      onClose: () => {
        connection.disconnected = true
        for (const { reject, method } of connection.pending.values()) {
          reject(new Error(`连接已断开，命令 ${method} 未完成`))
        }
        connection.pending.clear()
        for (const listener of connection.closeListeners.splice(0)) listener()
      },
    })
    ws.onMessage = (text) => connection.handleMessage(text)
    await ws.ready
    connection.ws = ws
    return connection
  }

  private handleMessage(text: string): void {
    let message: CdpMessage
    try {
      message = JSON.parse(text) as CdpMessage
    } catch {
      console.error(`[cdp] 无法解析消息（长度 ${text.length}）：${text.slice(0, 200)}`)
      return
    }
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(`CDP ${entry.method} 失败（${message.error.code}）：${message.error.message}`))
      else entry.resolve(message.result)
      return
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {}, message.sessionId)
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.disconnected || !this.ws) return Promise.reject(new Error(`连接不可用，命令 ${method} 被拒`))
    const id = this.nextId++
    const payload: CdpMessage = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      // pending 的 resolve 以 unknown 收纳（命令结果类型由调用方收窄）
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, method })
      try {
        this.ws!.send(JSON.stringify(payload))
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }) as Promise<Record<string, unknown>>
  }

  on(method: string, handler: (params: unknown, sessionId: string | undefined) => void): void {
    const list = this.handlers.get(method) ?? []
    list.push(handler)
    this.handlers.set(method, list)
  }

  /** 连接断开回调（一次性）。 */
  onDisconnected(listener: () => void): void {
    if (this.disconnected) listener()
    else this.closeListeners.push(listener)
  }

  close(): void {
    this.ws?.close()
    this.disconnected = true
  }
}

/** attach 到单个 target 的会话封装（flat 协议）。 */
export class CdpSession {
  constructor(private connection: CdpConnection, readonly sessionId: string) {}

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.connection.send(method, params, this.sessionId)
  }

  /** 在本 session 内订阅事件（session 事件带有相同 sessionId）。 */
  on(method: string, handler: (params: Record<string, unknown>) => void): void {
    this.connection.on(method, (params, sessionId) => {
      if (sessionId === this.sessionId) handler(params as Record<string, unknown>)
    })
  }
}
