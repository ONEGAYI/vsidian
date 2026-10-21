// @vitest-environment jsdom
// T02（#622）PDF 导出页正文装配单元测试（jsdom 控制器先例）：嵌入展开
// （一层边界/循环断链）、失败降级形态、媒体/PDF/iframe 静态说明与真实
// 链接、完成信号谓词分层（图片/图形——固定延迟证伪的信号面）。
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  evaluateExportReadiness,
  fileLinkOf,
  mountExportDocument,
  PDF_EXPORT_CLASS_NAMES,
  type PdfExportAssemblyHandle,
} from '../../src/webview/pdfExportAssembly'
import { MERMAID_CODE_ATTR, MERMAID_STATE_ATTR, GRAPHIC_LANG_ATTR } from '../../src/shared/mermaid'
import type { PdfExportPagePayload } from '../../src/shared/pdfExportPayload'

beforeAll(() => {
  installLocale('zh-cn', zhCn)
})

interface ImageProbe {
  src: string
  sourceFsPath: string | undefined
}

function payloadOf(overrides: Partial<PdfExportPagePayload> = {}): PdfExportPagePayload {
  return {
    docs: [{
      fsPath: 'D:/vault/笔记甲.md',
      docName: '笔记甲.md',
      text: [
        '# 首段标题',
        '',
        '起始段文本。',
        '',
        '![[嵌入乙]]',
        '',
        '![[missing-note]]',
        '',
        '![[视频丙.mp4]]',
        '',
        '![[文档丁.pdf]]',
        '',
        '中段：![本地图](local.png) 与 ![缺失图](gone.png)。',
        '',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        '',
        '尾段文本 PDF-ASSEMBLY-TAIL。',
      ].join('\n'),
      version: 3,
    }],
    embeds: [{
      inner: '嵌入乙',
      fsPath: 'D:/vault/嵌入乙.md',
      docName: '嵌入乙.md',
      text: '## 乙标题\n\n乙正文（未保存版本固定）。\n\n![[笔记甲]]',
      version: 9,
    }],
    mediaEmbeds: [
      { inner: '视频丙.mp4', kind: 'media', fsPath: 'D:/vault/视频丙.mp4' },
      { inner: '文档丁.pdf', kind: 'pdf', fsPath: 'D:/vault/文档丁.pdf' },
    ],
    embedFailures: [{ inner: 'missing-note', reason: 'not-found' }],
    style: { dark: false, vars: {}, reading: {} },
    snippets: [],
    breaks: false,
    mermaidUri: '',
    resBase: '',
    locale: 'zh-cn',
    ...overrides,
  }
}

function setup(overrides: Partial<PdfExportPagePayload> = {}): {
  handle: PdfExportAssemblyHandle
  root: HTMLElement
  images: ImageProbe[]
} {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const images: ImageProbe[] = []
  const handle = mountExportDocument(root, payloadOf(overrides), {
    images: {
      resolve: async (src, sourceFsPath) => {
        images.push({ src, sourceFsPath })
        if (src.includes('gone')) {
          return { ok: false, reason: 'not-found' }
        }
        return { ok: true, url: `mock://${src}` }
      },
    },
    channel: {
      send: async (message) => ({ reqId: message.reqId, ok: false, reason: 'blocked' }),
    },
  })
  return { handle, root, images }
}

/** jsdom 不做真实图片装载：对 loading 槽位补装载终态（complete/
 *  naturalWidth 以属性定义模拟浏览器已装载态）并派发 load 事件 */
async function settleImages(root: HTMLElement): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-vsidian-img-state="loading"]'))) {
    Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(img, 'complete', { configurable: true, get: () => true })
    img.dispatchEvent(new Event('load'))
  }
}

afterEach(() => {
  document.body.textContent = ''
})

describe('mountExportDocument：全量装配与嵌入展开', () => {
  it('主文档全量块装配（标题/段落/嵌入/代码块不依赖视口）', () => {
    const { root } = setup()
    expect(root.querySelectorAll('.vsidian-reading-block').length).toBeGreaterThan(5)
    expect(root.textContent).toContain('首段标题')
    expect(root.textContent).toContain('尾段文本 PDF-ASSEMBLY-TAIL。')
  })

  it('T05 标题书签埋点：heading 块挂 level 标记且 DOM 序即文档序', () => {
    const { root } = setup({
      docs: [{
        fsPath: 'D:/vault/笔记甲.md',
        docName: '笔记甲.md',
        text: [
          '# 顶层标题',
          '',
          '### 三级小节',
          '',
          '## 二级小节',
          '',
          '正文段。',
        ].join('\n'),
        version: 4,
      }],
    })
    const marks = Array.from(root.querySelectorAll<HTMLElement>('[data-vsidian-heading-level]'))
    expect(marks.map((el) => el.getAttribute('data-vsidian-heading-level'))).toEqual(['1', '3', '2'])
    // 文档序 = querySelectorAll 序（宿主 readHeadingMarks 的书签顺序依据）；
    // 标题文本取 textContent（行内标记天然剥离；宿主拉取时 trim——断言同口径）
    expect(marks.map((el) => (el.textContent ?? '').trim())).toEqual(['顶层标题', '三级小节', '二级小节'])
    // 非标题块不挂标记
    expect(root.querySelector('p[data-vsidian-heading-level]')).toBeNull()
  })

  it('T05 埋点覆盖嵌入展开目标：B 的标题块同样携带 level 标记', () => {
    const { root } = setup()
    const embedBox = root.querySelector('.vsidian-pdf-embed-expanded')
    expect(embedBox).not.toBeNull()
    expect(embedBox!.querySelectorAll('[data-vsidian-heading-level]').length).toBeGreaterThan(0)
  })

  it('嵌入目标展开：B 全文进场、来源标识行在场、B 的 docScope 标记', () => {
    const { root } = setup()
    const expanded = root.querySelector(`.${PDF_EXPORT_CLASS_NAMES.embedExpanded}`)
    expect(expanded).not.toBeNull()
    expect(expanded!.textContent).toContain('乙标题')
    expect(expanded!.textContent).toContain('乙正文（未保存版本固定）。')
    expect(expanded!.querySelector(`.${PDF_EXPORT_CLASS_NAMES.embedSourceLabel}`)?.textContent).toBe('嵌入乙.md')
    expect(expanded!.getAttribute('data-vsidian-doc-scope')).toBeTruthy()
  })

  it('一层展开边界：B 内嵌块保留占位引用行（A→B→A 循环断链）', () => {
    const { root } = setup()
    const expanded = root.querySelector(`.${PDF_EXPORT_CLASS_NAMES.embedExpanded}`)!
    // B 内 ![[笔记甲]] 不再展开（无嵌套 expanded 容器），保留占位引用文本
    expect(expanded.querySelectorAll(`.${PDF_EXPORT_CLASS_NAMES.embedExpanded}`)).toHaveLength(0)
    expect(expanded.textContent).toContain('![[笔记甲]]')
  })

  it('预取失败嵌入：占位替换为可见失败说明，登记 failure（embed/not-found）', () => {
    const { handle, root } = setup()
    expect(root.textContent).toContain('missing-note')
    expect(handle.failures).toEqual([{ kind: 'embed', item: 'missing-note', reason: 'not-found' }])
  })

  it('媒体/PDF 嵌入：静态说明 + 真实链接（本地 file:///，不伪装）', () => {
    const { root } = setup()
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(`a.${PDF_EXPORT_CLASS_NAMES.noticeLink}`))
    const hrefs = links.map((a) => a.getAttribute('href') ?? '')
    expect(hrefs).toContain(fileLinkOf('D:/vault/视频丙.mp4'))
    expect(hrefs).toContain(fileLinkOf('D:/vault/文档丁.pdf'))
    expect(hrefs.some((href) => href.startsWith('file:///D:/vault/'))).toBe(true)
  })

  it('正文 video/audio/iframe 元素降级为说明+链接（远端原 URL 不伪装本机路径）', () => {
    const payload = payloadOf()
    payload.docs[0]!.text = '<video src="https://example.com/v.mp4"></video>\n\n<iframe src="https://example.com/page"></iframe>'
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountExportDocument(root, payload, {
      images: { resolve: async () => ({ ok: false, reason: 'blocked' }) },
      channel: { send: async (m) => ({ reqId: m.reqId, ok: false, reason: 'blocked' }) },
    })
    expect(root.querySelector('video')).toBeNull()
    expect(root.querySelector('iframe')).toBeNull()
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(`a.${PDF_EXPORT_CLASS_NAMES.noticeLink}`))
    expect(links.map((a) => a.href)).toEqual(['https://example.com/v.mp4', 'https://example.com/page'])
  })
})

describe('mountExportDocument：完成信号分层', () => {
  it('图片解析请求以来源身份发起（主文档 A 身份）', async () => {
    const { images } = setup()
    await Promise.resolve()
    expect(images.some((probe) => probe.src.includes('local.png') && probe.sourceFsPath === 'D:/vault/笔记甲.md')).toBe(true)
  })

  it('失败图片终态登记 failure（image/not-found）且不阻塞就绪', async () => {
    const { handle, root } = setup()
    await settleImages(root)
    const readiness = evaluateExportReadiness(handle)
    expect(readiness.images).toBe(true)
    expect(readiness.failures).toContainEqual({ kind: 'image', item: 'gone.png', reason: 'not-found' })
    expect(readiness.asyncReady).toBe(true)
  })

  it('图形容器非终态（pending/rendering）时 graphics=false——信号谓词而非固定延迟', async () => {
    const { handle, root } = setup()
    await settleImages(root)
    // 注入一个 pending 容器（模拟慢渲染中的真实形态）
    const pending = document.createElement('div')
    pending.setAttribute(GRAPHIC_LANG_ATTR, 'mermaid')
    pending.setAttribute(MERMAID_CODE_ATTR, 'graph TD')
    pending.setAttribute(MERMAID_STATE_ATTR, 'pending')
    root.querySelector('.vsidian-view-reading')!.appendChild(pending)
    let readiness = evaluateExportReadiness(handle)
    expect(readiness.graphics).toBe(false)
    expect(readiness.asyncReady).toBe(false)
    pending.setAttribute(MERMAID_STATE_ATTR, 'rendered')
    readiness = evaluateExportReadiness(handle)
    expect(readiness.graphics).toBe(true)
    expect(readiness.asyncReady).toBe(true)
  })

  it('图片槽位未终态（loading）时 images=false', async () => {
    const { handle, root } = setup()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const img = document.createElement('img')
    img.setAttribute('data-vsidian-img-state', 'loading')
    root.querySelector('.vsidian-view-reading')!.appendChild(img)
    const readiness = evaluateExportReadiness(handle)
    expect(readiness.images).toBe(false)
  })
})

describe('mountExportDocument：T03（#623）选区片段装配', () => {
  /** 选区导出样例：标题 + 表格 + 列表（两组）+ 围栏 + 图片段 + 尾段。
   *  片段切片只取选中字符（与 pdfExportSelection 单测同一「不扩大」口径）。 */
  const SELECTION_DOC = [
    '# T03 选区样例标题',
    '',
    '| 列甲 | 列乙 |',
    '| --- | --- |',
    '| 值一 | 值二 |',
    '',
    '- 列表组一根',
    '',
    '- 列表组二根',
    '',
    '```js',
    'const half = 1',
    'const outside = 2',
    '```',
    '',
    '中段：![选区图](sel.png)。',
    '',
    '选区外尾段：T03-OUTSIDE-TAIL。',
  ].join('\n')

  function selectionPayload(fragments: Array<{ start: number; end: number; text: string }>): PdfExportPagePayload {
    return payloadOf({
      docs: [{
        fsPath: 'D:/vault/笔记甲.md',
        docName: '笔记甲.md',
        text: SELECTION_DOC,
        version: 7,
      }],
      embeds: [],
      mediaEmbeds: [],
      embedFailures: [],
      fragments,
    })
  }

  function slice(text: string, start: number, end: number): { start: number; end: number; text: string } {
    return { start, end, text: text.slice(start, end) }
  }

  function mountFragments(payload: PdfExportPagePayload, images: ImageProbe[] = []): HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountExportDocument(root, payload, {
      images: {
        resolve: async (src, sourceFsPath) => {
          images.push({ src, sourceFsPath })
          return { ok: true, url: `mock://${src}` }
        },
      },
      channel: { send: async (m) => ({ reqId: m.reqId, ok: false, reason: 'blocked' }) },
    })
    return root
  }

  it('片段在场时全文不挂载：选区外文字（标题/闭合围栏/尾段）不进入正文', () => {
    const head = SELECTION_DOC.indexOf('| 值一')
    const root = mountFragments(selectionPayload([slice(SELECTION_DOC, head, head + 4)]))
    expect(root.textContent).toContain('值一')
    expect(root.textContent).not.toContain('选区样例标题')
    expect(root.textContent).not.toContain('outside')
    expect(root.textContent).not.toContain('T03-OUTSIDE-TAIL')
  })

  it('半表格行：只输出实际选中文字（不扩成完整表格网格）', () => {
    const rowStart = SELECTION_DOC.indexOf('| 值一 | 值二 |')
    // 行中「值一 | 值二」字符区间（含管道）：独立解析后无表头，不构成表格
    const root = mountFragments(selectionPayload([slice(SELECTION_DOC, rowStart + 2, rowStart + 11)]))
    expect(root.querySelector('table')).toBeNull()
    expect(root.textContent).toContain('值一 | 值二')
    expect(root.textContent).not.toContain('列甲')
  })

  it('半围栏：从围栏标记起选中到首行代码结尾——无闭合围栏按开放围栏真实降级', () => {
    const open = SELECTION_DOC.indexOf('```js')
    const inside = SELECTION_DOC.indexOf('const half = 1')
    // 片段 = '```js\nconst half = 1'：独立解析为未闭合围栏（代码块），
    // 不暗中补齐闭合围栏，选区外的第二行代码不进入
    const root = mountFragments(selectionPayload([slice(SELECTION_DOC, open, inside + 'const half = 1'.length)]))
    expect(root.textContent).toContain('const half = 1')
    expect(root.textContent).not.toContain('outside')
    // 未闭合围栏按真实降级呈现为代码块（而非段落或补齐的完整卡片）
    expect(root.querySelectorAll('pre, code').length).toBeGreaterThan(0)
  })

  it('围栏中段切片：标记不在片段内按普通文本呈现（真实降级，不补围栏）', () => {
    const inside = SELECTION_DOC.indexOf('const half = 1')
    // 片段只含代码行本身（无 ``` 标记）：独立解析为普通段落文本
    const root = mountFragments(selectionPayload([slice(SELECTION_DOC, inside, inside + 'const half = 1'.length)]))
    expect(root.textContent).toContain('const half = 1')
    expect(root.querySelectorAll('pre, code').length).toBe(0)
  })

  it('多选区按文档顺序装配，两个列表片段不连结成同一列表', () => {
    const listA = SELECTION_DOC.indexOf('- 列表组一根')
    const listB = SELECTION_DOC.indexOf('- 列表组二根')
    const root = mountFragments(selectionPayload([
      slice(SELECTION_DOC, listA, listA + '- 列表组一根'.length),
      slice(SELECTION_DOC, listB, listB + '- 列表组二根'.length),
    ]))
    const lists = Array.from(root.querySelectorAll('ul'))
    expect(lists).toHaveLength(2)
    // 顺序：组一在组二之前（DOM 顺序 = 文档顺序）
    const orderA = root.textContent!.indexOf('列表组一根')
    const orderB = root.textContent!.indexOf('列表组二根')
    expect(orderA).toBeGreaterThan(-1)
    expect(orderA).toBeLessThan(orderB)
  })

  it('片段间无意外语法连结：表头行片段与数据行片段保持独立（不拼成新表格行）', () => {
    const header = SELECTION_DOC.indexOf('| 列甲 | 列乙 |')
    const row = SELECTION_DOC.indexOf('| 值一 | 值二 |')
    // 表头行片段 + 数据行片段分别独立解析：各自是孤立管道行，不构成表格
    const root = mountFragments(selectionPayload([
      slice(SELECTION_DOC, header, header + '| 列甲 | 列乙 |'.length),
      slice(SELECTION_DOC, row, row + '| 值一 | 值二 |'.length),
    ]))
    expect(root.querySelector('table')).toBeNull()
    expect(root.textContent).toContain('列甲')
    expect(root.textContent).toContain('值一')
  })

  it('片段内相对图片以主文档身份解析（sourceFsPath=原文档 fsPath）', async () => {
    const imgLine = SELECTION_DOC.indexOf('中段：![选区图](sel.png)。')
    const images: ImageProbe[] = []
    mountFragments(selectionPayload([slice(SELECTION_DOC, imgLine, imgLine + '中段：![选区图](sel.png)。'.length)]), images)
    await Promise.resolve()
    expect(images).toContainEqual({ src: 'sel.png', sourceFsPath: 'D:/vault/笔记甲.md' })
  })

  it('片段内块级嵌入仍展开（嵌入消费对片段装配生效，一层边界不变）', () => {
    const text = '前段。\n\n![[嵌入乙]]\n\n后段。'
    const at = text.indexOf('![[嵌入乙]]')
    const payload = payloadOf({
      docs: [{ fsPath: 'D:/vault/笔记甲.md', docName: '笔记甲.md', text, version: 7 }],
      mediaEmbeds: [],
      embedFailures: [],
      fragments: [{ start: at, end: at + '![[嵌入乙]]'.length, text: text.slice(at, at + '![[嵌入乙]]'.length) }],
    })
    const root = mountFragments(payload)
    const expanded = root.querySelector(`.${PDF_EXPORT_CLASS_NAMES.embedExpanded}`)
    expect(expanded).not.toBeNull()
    expect(expanded!.textContent).toContain('乙正文')
    expect(root.textContent).not.toContain('前段')
    expect(root.textContent).not.toContain('后段')
  })

  it('fragments 在场但为空：不回落全文（零片段零正文，不误触发全文导出）', () => {
    const root = mountFragments(selectionPayload([]))
    expect(root.querySelector('.vsidian-reading-block')).toBeNull()
  })
})

describe('fileLinkOf：本机真实路径链接', () => {
  it('Windows 盘符与 POSIX 均归一为 file:/// 三斜杠形态', () => {
    expect(fileLinkOf('D:/vault/a b/图.png')).toBe('file:///D:/vault/a b/图.png')
    expect(fileLinkOf('D:\\vault\\图.png')).toBe('file:///D:/vault/图.png')
    expect(fileLinkOf('/home/u/note.pdf')).toBe('file:///home/u/note.pdf')
  })
})
