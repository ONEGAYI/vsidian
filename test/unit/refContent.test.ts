// 引用内容类型分派共享内核契约（#333 / P3-01）：目标类型分类学（kind
// 集合与本地文件分类——宿主读取分派与 webview 内容装载按同一 kind）、
// Markdown 载荷类型与导航选择器结构留位（PDF #page、文本 #line/#range
// ——本票不实现非 Markdown 锚点解析，仅结构与字段位，P3-05/P3-08 接入）。
import { describe, expect, it } from 'vitest'
import {
  MEDIA_FILE_EXTENSIONS,
  REF_CONTENT_KINDS,
  classifyLinkOpenChannel,
  classifyLocalRefContentKind,
  isRefContentKind,
  refEmbedTargetIsImage,
  type RefContentKind,
  type RefImageContent,
  type RefMarkdownContent,
  type RefNavSelector,
} from '../../src/shared/refContent'

describe('引用内容类型集合（#333 三期五类）', () => {
  it('kind 集合：markdown / pdf / image / text / web', () => {
    expect([...REF_CONTENT_KINDS]).toEqual(['markdown', 'pdf', 'image', 'text', 'web'])
  })

  it('isRefContentKind：已知类型放行；未知类型与非字符串拒绝', () => {
    for (const kind of REF_CONTENT_KINDS) {
      expect(isRefContentKind(kind), `kind=${kind} 应放行`).toBe(true)
    }
    expect(isRefContentKind('video'), '未知类型拒绝').toBe(false)
    expect(isRefContentKind('')).toBe(false)
    expect(isRefContentKind(3)).toBe(false)
    expect(isRefContentKind(null)).toBe(false)
    expect(isRefContentKind(undefined)).toBe(false)
  })
})

describe('本地目标类型分类（classifyLocalRefContentKind）', () => {
  it('.md → markdown（大小写不敏感）', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\目标.md')).toBe('markdown')
    expect(classifyLocalRefContentKind('D:\\notes\\NOTE.MD')).toBe('markdown')
  })

  it('.pdf → pdf', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\资料.pdf')).toBe('pdf')
    expect(classifyLocalRefContentKind('D:\\notes\\资料.PDF')).toBe('pdf')
  })

  it('图片扩展名 → image（与图片管线 IMAGE_WATCH_GLOB_SEGMENTS 同源）', () => {
    for (const ext of ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']) {
      expect(classifyLocalRefContentKind(`D:\\notes\\图.${ext}`), `.${ext} 应归 image`).toBe('image')
    }
  })

  it('其余本地文件（代码/配置/无扩展名）→ text', () => {
    expect(classifyLocalRefContentKind('D:\\notes\\src\\main.ts')).toBe('text')
    expect(classifyLocalRefContentKind('D:\\notes\\.vscode\\settings.json')).toBe('text')
    expect(classifyLocalRefContentKind('D:\\notes\\LICENSE')).toBe('text')
  })
})

describe('Markdown 载荷与导航选择器结构（类型留位）', () => {
  it('RefMarkdownContent：kind 标记 + TextDocument 权威版本 + LF 全文 + 定位区间 + Markdown 选择器', () => {
    const content: RefMarkdownContent = {
      kind: 'markdown',
      version: 7,
      lfText: '# 目标\n\n正文',
      range: { start: 0, end: 8 },
      selector: { kind: 'full' },
    }
    expect(content.kind).toBe('markdown')
    expect(content.version).toBe(7)
    expect(content.lfText).toBe('# 目标\n\n正文')
    expect(content.range).toEqual({ start: 0, end: 8 })
    expect(content.selector).toEqual({ kind: 'full' })
  })

  it('导航选择器留位：PDF page / 文本 line+range 字段位与 Markdown 选择器同一联合（本票不解析）', () => {
    const selectors: RefNavSelector[] = [
      { kind: 'full' },
      { kind: 'heading', anchor: '章节' },
      { kind: 'block', anchor: '^blk1' },
      { kind: 'pdf', page: 3 },
      { kind: 'text', line: 10 },
      { kind: 'text', range: { begin: 10, end: 20 } },
      { kind: 'text', line: 12, range: { begin: 10, end: 20 } },
      { kind: 'plain' },
    ]
    expect(selectors.map((s) => s.kind)).toEqual([
      'full', 'heading', 'block', 'pdf', 'text', 'text', 'text', 'plain',
    ])
  })

  it('kind 联合覆盖五类（编译期完备性——pdf/image/text/web 由后续票登记载荷形态）', () => {
    const kinds: RefContentKind[] = ['markdown', 'pdf', 'image', 'text', 'web']
    expect(kinds).toHaveLength(REF_CONTENT_KINDS.length)
  })

  it('RefImageContent：kind 标记 + 来源相对图源 + 文件资源版本（#336 登记形态）', () => {
    const content: RefImageContent = { kind: 'image', src: 'assets/图.png', version: 5 }
    expect(content.kind).toBe('image')
    expect(content.src).toBe('assets/图.png')
    expect(content.version).toBe(5)
  })
})

// #608（链接跳转打开通道）：宿主两个跳转执行体与出链面板按同一分派打开
// 目标——markdown 进 Vsidian 面板；可读文本走原生文本编辑器（#340 口径，
// 行号锚点在该通道解析）；图片/PDF/音视频交 vscode.open 默认编辑器解析
// （内置图片/媒体预览器或用户扩展接管，尊重 workbench.editorAssociations）。
// 分类不改变内容类型（classifyLocalRefContentKind 不动）——媒体扩展只在
// 打开通道层从「可读文本」分出，悬停/引用读取路径不受影响。
describe('#608 链接跳转打开通道 classifyLinkOpenChannel', () => {
  it('markdown 目标进 Vsidian 面板（.md 与 .markdown 同口径，大小写不敏感）', () => {
    expect(classifyLinkOpenChannel('D:\\notes\\笔记.md')).toBe('vsidian-panel')
    expect(classifyLinkOpenChannel('D:\\notes\\NOTE.MD')).toBe('vsidian-panel')
    expect(classifyLinkOpenChannel('D:\\notes\\笔记.markdown')).toBe('vsidian-panel')
    expect(classifyLinkOpenChannel('D:\\notes\\NOTE.MARKDOWN')).toBe('vsidian-panel')
  })

  it('可读文本走原生文本编辑器（代码/配置/无扩展名；#340 行号锚点通道）', () => {
    expect(classifyLinkOpenChannel('D:\\notes\\src\\main.ts')).toBe('native-text')
    expect(classifyLinkOpenChannel('D:\\notes\\.vscode\\settings.json')).toBe('native-text')
    expect(classifyLinkOpenChannel('D:\\notes\\笔记.txt')).toBe('native-text')
    expect(classifyLinkOpenChannel('D:\\notes\\LICENSE')).toBe('native-text')
  })

  it('图片与 PDF 交原生默认编辑器解析（不再按文本装载二进制）', () => {
    for (const ext of ['png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']) {
      expect(classifyLinkOpenChannel(`D:\\notes\\图.${ext}`), `.${ext} 应交原生解析`).toBe('native-default')
      expect(classifyLinkOpenChannel(`D:\\notes\\图.${ext.toUpperCase()}`), `大写 .${ext} 同口径`).toBe('native-default')
    }
    expect(classifyLinkOpenChannel('D:\\notes\\资料.pdf')).toBe('native-default')
    expect(classifyLinkOpenChannel('D:\\notes\\资料.PDF')).toBe('native-default')
  })

  it('音视频媒体交原生默认编辑器解析（内置媒体预览器，不当文本装载）', () => {
    for (const ext of MEDIA_FILE_EXTENSIONS) {
      expect(classifyLinkOpenChannel(`D:\\notes\\媒体.${ext}`), `.${ext} 应交原生解析`).toBe('native-default')
    }
    expect(classifyLinkOpenChannel('D:\\notes\\播客.MP3')).toBe('native-default')
    // CHANGELOG 明示覆盖的 Opus 系格式：显式钉住防白名单回缩
    expect(classifyLinkOpenChannel('D:\\notes\\录音.opus')).toBe('native-default')
    expect(classifyLinkOpenChannel('D:\\notes\\录音.OGA')).toBe('native-default')
  })
})

// #336（P3-04）嵌入目标图片判定：webview 渲染路径的形态学分流判据——
// `![[图.png]]` 与 `![](图.png)` 同源呈现的前提是两侧（Reading inline 规
// 则产 img、Live 嵌入装饰分流图片 widget、占位配对扫描跳过）共用同一判
// 定。判据与宿主 classifyLocalRefContentKind 的扩展名口径对齐：带扩展名
// 目标的解析不补 .md（implicitMd 只对无扩展名生效），书写扩展名 = 解析后
// 扩展名，webview 预判与宿主分类结构性一致（宿主回包 contentKind 仍是
// 权威——预判只选渲染路径）。
describe('#336 嵌入目标图片判定 refEmbedTargetIsImage', () => {
  it('图片扩展名目标为图片（大小写不敏感；含目录前缀与别名形态）', () => {
    expect(refEmbedTargetIsImage('图.png')).toBe(true)
    expect(refEmbedTargetIsImage('assets/子 目录/图.JPEG')).toBe(true)
    expect(refEmbedTargetIsImage('a/b.gif')).toBe(true)
    expect(refEmbedTargetIsImage('x.webp')).toBe(true)
    expect(refEmbedTargetIsImage('x.svg')).toBe(true)
    expect(refEmbedTargetIsImage('x.bmp')).toBe(true)
    expect(refEmbedTargetIsImage('x.avif')).toBe(true)
    expect(refEmbedTargetIsImage('x.apng')).toBe(true)
    expect(refEmbedTargetIsImage('图.png|别名文字')).toBe(true)
  })

  it('锚点不改变图片判定（图片目标无锚点定位语义——与宿主按 fsPath 分派一致）', () => {
    expect(refEmbedTargetIsImage('图.png#任意锚')).toBe(true)
    expect(refEmbedTargetIsImage('图.png#^blk-id|别名')).toBe(true)
  })

  it('非图片目标：markdown/无扩展名/未受支持扩展名/本文件锚点/非法形态', () => {
    expect(refEmbedTargetIsImage('笔记')).toBe(false)
    expect(refEmbedTargetIsImage('笔记.md')).toBe(false)
    expect(refEmbedTargetIsImage('资料.pdf')).toBe(false)
    expect(refEmbedTargetIsImage('脚本.ts')).toBe(false)
    expect(refEmbedTargetIsImage('照片.tif')).toBe(false)
    expect(refEmbedTargetIsImage('照片.heic')).toBe(false)
    expect(refEmbedTargetIsImage('#本文件锚')).toBe(false)
    expect(refEmbedTargetIsImage('a#b#c')).toBe(false)
    expect(refEmbedTargetIsImage('')).toBe(false)
  })
})
