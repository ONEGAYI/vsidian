// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clipboardPlainText, readClipboardSnapshot } from '../../src/webview/clipboardPaste'

describe('剪贴板快照与纯文本', () => {
  it('纯文本优先且不把 Markdown 重新解释', () => {
    expect(clipboardPlainText({ text: '**原文**', html: '<b>原文</b>', images: [] })).toBe('**原文**')
    expect(clipboardPlainText({ text: '', html: '<b>原文</b>', images: [] })).toBe('')
  })
  it('缺失纯文本时按 HTML 块与换行提取，不执行脚本与图片', () => {
    expect(clipboardPlainText({ html: '<p>甲<br>乙</p><p><b>丙</b><img src="https://bad.test/x" alt="图"><script>bad()</script></p>', images: [] })).toBe('甲\n乙\n丙图')
  })
  it('读取完整多格式快照：文本、HTML 和独立图片', async () => {
    const blobs = { 'text/plain': new Blob(['原文']), 'text/html': new Blob(['<b>原文</b>']), 'image/png': new Blob(['x'], { type: 'image/png' }) }
    const snapshot = await readClipboardSnapshot({ read: async () => [{ types: Object.keys(blobs), getType: async (type: string) => blobs[type as keyof typeof blobs] }] })
    expect(snapshot.text).toBe('原文')
    expect(snapshot.html).toBe('<b>原文</b>')
    expect(snapshot.images).toHaveLength(1)
    expect(snapshot.images[0]?.type).toBe('image/png')
  })
})
