// T02（#622）PDF 导出嵌入目标预取单元测试：超集枚举（形态学同源、图片
// 排除、去重保序）、预取分派（markdown/媒体/失败）与单目标异常不中断。
import { describe, expect, it } from 'vitest'
import {
  enumerateEmbedTargets,
  prefetchEmbedTargets,
  type PdfExportEmbedReadPort,
} from '../../src/host/pdfExport/pdfExportEmbeds'

describe('enumerateEmbedTargets：超集枚举', () => {
  it('块级与混排嵌入均枚举（超集语义）、按出现顺序去重', () => {
    const text = [
      '# 标题',
      '',
      '![[笔记甲]]',
      '',
      '段落中 ![[笔记乙]] 混排嵌入。',
      '',
      '![[笔记甲]]',
      '',
      '- 列表项 ![[笔记丙]]',
    ].join('\n')
    expect(enumerateEmbedTargets(text)).toEqual(['笔记甲', '笔记乙', '笔记丙'])
  })

  it('图片目标排除（走正文图片管线，不升级嵌入）', () => {
    expect(enumerateEmbedTargets('![[photo.png]]\n![[笔记甲]]')).toEqual(['笔记甲'])
  })

  it('代码围栏内的字面嵌入也在超集内（页面消费不命中即静默）', () => {
    expect(enumerateEmbedTargets('```md\n![[围栏内]]\n```')).toEqual(['围栏内'])
  })

  it('非法形态（未闭合/嵌套括号）不命中', () => {
    expect(enumerateEmbedTargets('![[未闭合\n!![[双感叹]]')).toEqual([])
  })

  it('别名与锚点形态保留 inner 原文（页面按 inner 精确消费）', () => {
    expect(enumerateEmbedTargets('![[笔记甲|显示名]]')).toEqual(['笔记甲|显示名'])
  })
})

describe('prefetchEmbedTargets：预取分派', () => {
  it('markdown 成功进 embeds（全文+版本固定）、media/pdf/web 进 mediaEmbeds、失败登记', async () => {
    const port: PdfExportEmbedReadPort = {
      readTarget: async (inner) => {
        if (inner === '笔记甲') {
          return { ok: true, kind: 'markdown', fsPath: 'D:/vault/笔记甲.md', docName: '笔记甲.md', text: '# B 全文', version: 7 }
        }
        if (inner === 'video.mp4') {
          return { ok: true, kind: 'media', fsPath: 'D:/vault/video.mp4' }
        }
        if (inner === 'doc.pdf') {
          return { ok: true, kind: 'pdf', fsPath: 'D:/vault/doc.pdf' }
        }
        if (inner === 'https://example.com') {
          return { ok: true, kind: 'web', url: 'https://example.com' }
        }
        return { ok: false, reason: 'not-found' }
      },
    }
    const result = await prefetchEmbedTargets('![[笔记甲]]\n![[video.mp4]]\n![[doc.pdf]]\n![[https://example.com]]\n![[缺失]]', port)
    expect(result.embeds).toEqual([
      { inner: '笔记甲', fsPath: 'D:/vault/笔记甲.md', docName: '笔记甲.md', text: '# B 全文', version: 7 },
    ])
    expect(result.mediaEmbeds).toEqual([
      { inner: 'video.mp4', kind: 'media', fsPath: 'D:/vault/video.mp4' },
      { inner: 'doc.pdf', kind: 'pdf', fsPath: 'D:/vault/doc.pdf' },
      { inner: 'https://example.com', kind: 'web', url: 'https://example.com' },
    ])
    expect(result.embedFailures).toEqual([{ inner: '缺失', reason: 'not-found' }])
  })

  it('单目标读取抛错不中断批次（收敛 read-failed）', async () => {
    const port: PdfExportEmbedReadPort = {
      readTarget: async (inner) => {
        if (inner === '坏目标') {
          throw new Error('boom')
        }
        return { ok: true, kind: 'markdown', fsPath: 'D:/v/b.md', docName: 'b.md', text: 'b', version: 1 }
      },
    }
    const result = await prefetchEmbedTargets('![[坏目标]]\n![[好目标]]', port)
    expect(result.embedFailures).toEqual([{ inner: '坏目标', reason: 'read-failed' }])
    expect(result.embeds).toHaveLength(1)
  })

  it('同一 inner 多处引用只预取一次（固定输入一致性）', async () => {
    let reads = 0
    const port: PdfExportEmbedReadPort = {
      readTarget: async () => {
        reads += 1
        return { ok: true, kind: 'markdown', fsPath: 'D:/v/x.md', docName: 'x.md', text: 'x', version: 1 }
      },
    }
    await prefetchEmbedTargets('![[x]]\n![[x]]\n![[x]]', port)
    expect(reads).toBe(1)
  })
})
