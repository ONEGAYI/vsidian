import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CdpConnection } from '../../src/host/pdfExport/cdpClient'

const network = vi.hoisted(() => ({ connect: vi.fn() }))
vi.mock('node:net', () => ({ connect: network.connect }))

function serverSocket() {
  const socket = Object.assign(new EventEmitter(), {
    write: vi.fn((_bytes: string | Buffer) => true),
    destroy: vi.fn(() => { socket.emit('close') }),
  })
  network.connect.mockImplementation((_options: unknown, connected: () => void) => {
    queueMicrotask(connected)
    return socket
  })
  return socket
}

async function connectedClient() {
  const socket = serverSocket()
  const opening = CdpConnection.connect('ws://127.0.0.1:9222/devtools/browser/test')
  socket.emit('data', Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n'))
  return { socket, connection: await opening }
}

function frame(payload: Buffer, opcode = 1, fin = true, masked = false): Buffer {
  const size = payload.length < 126 ? 2 : payload.length <= 0xffff ? 4 : 10
  const header = Buffer.alloc(size)
  header[0] = (fin ? 0x80 : 0) | opcode
  header[1] = (masked ? 0x80 : 0) | (size === 2 ? payload.length : size === 4 ? 126 : 127)
  if (size === 4) header.writeUInt16BE(payload.length, 2)
  if (size === 10) header.writeBigUInt64BE(BigInt(payload.length), 2)
  if (!masked) return Buffer.concat([header, payload])
  const mask = Buffer.from([1, 2, 3, 4])
  return Buffer.concat([header, mask, Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))])
}

describe('CDP 连接关闭', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('主动关闭立即拒绝在途命令并只通知一次断连', async () => {
    const { socket, connection } = await connectedClient()
    const disconnected = vi.fn()
    connection.onDisconnected(disconnected)
    const outcome = connection.send('Target.createTarget', { url: 'about:blank' })
      .then(() => 'resolved', (error: Error) => error.message)
    connection.close()
    connection.close()
    socket.emit('close')
    expect(disconnected).toHaveBeenCalledTimes(1)
    expect(await outcome).toContain('Target.createTarget')
    await expect(connection.send('Browser.getVersion')).rejects.toThrow('connection unavailable')
    const late = vi.fn()
    connection.onDisconnected(late)
    expect(late).toHaveBeenCalledTimes(1)
  })

  it('对端断开同样拒绝在途命令，随后主动释放不重复通知', async () => {
    const { socket, connection } = await connectedClient()
    const disconnected = vi.fn()
    connection.onDisconnected(disconnected)
    const outcome = connection.send('Page.printToPDF').catch((error: Error) => error.message)
    socket.emit('close')
    connection.close()
    expect(await outcome).toContain('Page.printToPDF')
    expect(disconnected).toHaveBeenCalledTimes(1)
  })
})

describe('CDP 分块收包', () => {
  it('大回包的复制量随消息字节线性增长，结果完整', async () => {
    const { socket, connection } = await connectedClient()
    const value = 'x'.repeat(1024 * 1024)
    const packet = frame(Buffer.from(JSON.stringify({ id: 1, result: { value } })))
    const result = connection.send('Runtime.evaluate')
    const concat = Buffer.concat
    let copied = 0
    const copying = vi.spyOn(Buffer, 'concat').mockImplementation((list, totalLength) => {
      copied += totalLength ?? list.reduce((sum, buffer) => sum + buffer.length, 0)
      return concat(list, totalLength)
    })
    try {
      for (let pos = 0; pos < packet.length; pos += 1024) {
        socket.emit('data', packet.subarray(pos, pos + 1024))
      }
    } finally {
      copying.mockRestore()
      connection.close()
    }
    expect(await result).toEqual({ value })
    expect(copied).toBeLessThan(packet.length * 3)
  })

  it('拆开的帧头、UTF-8 continuation、ping 及同包后续消息不丢失', async () => {
    const { socket, connection } = await connectedClient()
    const text = Buffer.from(JSON.stringify({ id: 1, result: { value: '猫😀' } }))
    const split = text.indexOf(Buffer.from('😀')) + 1
    const result = connection.send('Runtime.evaluate')
    const event = vi.fn()
    connection.on('Page.loadEventFired', event)
    const packet = Buffer.concat([
      frame(text.subarray(0, split), 1, false, true),
      frame(Buffer.from('ping'), 9),
      frame(text.subarray(split), 0),
      frame(Buffer.from(JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 1 } }))),
    ])
    for (let pos = 0; pos < 12; pos++) socket.emit('data', packet.subarray(pos, pos + 1))
    socket.emit('data', packet.subarray(12))
    expect(await result).toEqual({ value: '猫😀' })
    expect(event).toHaveBeenCalledWith({ timestamp: 1 }, undefined)
    expect(socket.write.mock.calls.some(([bytes]) => Buffer.isBuffer(bytes) && bytes[0] === 0x8a)).toBe(true)
    connection.close()
  })
})
