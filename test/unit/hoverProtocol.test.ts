// 悬停预览消息协议契约（#218）：hover.request / hover.result 的运行期
// 校验器行为——校验器与联合类型三处不同步 = 静默丢消息（protocol-notes
// 陷阱清单），此处钉住合法形态放行、非法形态整体拒绝（不部分读取）。
// #220 扩展：来源资源通道（image.request / link.activate / wikilink.activate
// 的可选 sourceDocUri——B 文档身份）与 view.state hoverPreview 探针的
// 属性区/图片观测字段。
// #224 扩展：订阅与推送消息族（hover.watch / hover.unwatch /
// hover.invalidated——引用视图跟随目标变更的通道）。
import { describe, expect, it } from 'vitest'
import {
  isHostToWebview,
  isWebviewToHost,
  type HostToWebview,
  type WebviewToHost,
} from '../../src/shared/protocol'

/** 合法 hover.request 基线（会话守卫字段 + 实例身份 + 源位置 + 目标原文） */
function validRequest(): WebviewToHost {
  return {
    kind: 'hover.request',
    sessionId: 'panel-1',
    docUri: 'file:///d%3A/notes/a.md',
    reqId: 1,
    instanceId: 'hover-1',
    sourceStart: 12,
    sourceEnd: 24,
    target: '目标笔记',
  }
}

/** 合法 hover.result 成功形态基线（规范目标身份 + 版本 + LF 全文 + 范围） */
function validResultOk(): HostToWebview {
  return {
    kind: 'hover.result',
    reqId: 1,
    instanceId: 'hover-1',
    ok: true,
    target: { fsPath: 'D:\\notes\\目标笔记.md', relPath: '目标笔记.md' },
    version: 3,
    text: '# 标题\n\n正文\n',
    range: { start: 0, end: 13 },
    scope: { kind: 'full' },
  }
}

/** 合法 hover.result 失败形态基线（就地错误分态） */
function validResultFail(): HostToWebview {
  return {
    kind: 'hover.result',
    reqId: 1,
    instanceId: 'hover-1',
    ok: false,
    reason: 'not-found',
  }
}

describe('hover.request 校验（webview → 宿主）', () => {
  it('合法形态放行', () => {
    expect(isWebviewToHost(validRequest())).toBe(true)
  })

  it('缺任一会话守卫/身份字段整体拒绝', () => {
    const base = validRequest() as Record<string, unknown>
    for (const key of ['sessionId', 'docUri', 'reqId', 'instanceId', 'sourceStart', 'sourceEnd', 'target']) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isWebviewToHost(broken), `缺 ${key} 应拒绝`).toBe(false)
    }
  })

  it('reqId 须为正整数；offset 与身份须为非负整数/非空字符串', () => {
    expect(isWebviewToHost({ ...validRequest(), reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), reqId: 1.5 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), sourceStart: -1 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), sourceEnd: -1 })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), instanceId: '' })).toBe(false)
    expect(isWebviewToHost({ ...validRequest(), target: 3 })).toBe(false)
  })

  it('P3-5 源区间有序：sourceStart 不得大于 sourceEnd（两字段同在时拒绝倒置）', () => {
    expect(isWebviewToHost({ ...validRequest(), sourceStart: 20, sourceEnd: 12 })).toBe(false)
    // 相等合法（空区间/中性值——反链悬停的 sourceStart=sourceEnd=0 先例）
    expect(isWebviewToHost({ ...validRequest(), sourceStart: 12, sourceEnd: 12 })).toBe(true)
  })

  it('#219 普通链接形态：linkHref 可选字符串（缺省双链；非字符串拒绝）', () => {
    expect(isWebviewToHost({ ...validRequest(), linkHref: 'relative.md#章' })).toBe(true)
    expect(isWebviewToHost(validRequest()), '缺省仍为双链形态').toBe(true)
    expect(isWebviewToHost({ ...validRequest(), linkHref: 3 })).toBe(false)
  })

  it('P2-03 刷新宽容：anchorOptional 可选布尔（非布尔整体拒绝）', () => {
    expect(isWebviewToHost({ ...validRequest(), anchorOptional: true })).toBe(true)
    expect(isWebviewToHost(validRequest()), '缺省仍为严格锚点验证').toBe(true)
    expect(isWebviewToHost({ ...validRequest(), anchorOptional: 'yes' })).toBe(false)
  })
})

describe('hover.result 校验（宿主 → webview）', () => {
  it('成功与失败两形态均放行', () => {
    expect(isHostToWebview(validResultOk())).toBe(true)
    expect(isHostToWebview(validResultFail())).toBe(true)
  })

  it('reqId/instanceId 缺失或非法整体拒绝', () => {
    expect(isHostToWebview({ ...validResultOk(), reqId: 0 } as unknown as Record<string, unknown>)).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), instanceId: '' } as unknown as Record<string, unknown>)).toBe(false)
    const noReq: Record<string, unknown> = { ...(validResultOk() as unknown as Record<string, unknown>) }
    delete noReq['reqId']
    expect(isHostToWebview(noReq)).toBe(false)
  })

  it('成功形态须携带完整目标身份/版本/全文/范围/范围选择器', () => {
    const base = validResultOk() as unknown as Record<string, unknown>
    for (const key of ['target', 'version', 'text', 'range', 'scope']) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isHostToWebview(broken), `成功形态缺 ${key} 应拒绝`).toBe(false)
    }
    expect(isHostToWebview({ ...base, version: -1 })).toBe(false)
    expect(isHostToWebview({ ...base, range: { start: 5, end: 2 } })).toBe(false)
    expect(isHostToWebview({ ...base, scope: { kind: 'unknown' } })).toBe(false)
    expect(
      isHostToWebview({ ...base, target: { fsPath: 'x.md' } }),
      '目标身份缺 relPath 应拒绝',
    ).toBe(false)
  })

  it('失败形态 reason 限定错误分态枚举；未知 reason 拒绝', () => {
    const base = validResultFail() as unknown as Record<string, unknown>
    for (const reason of ['unsupported', 'no-workspace', 'escape', 'not-found', 'non-markdown', 'read-failed', 'anchor-missing']) {
      expect(isHostToWebview({ ...base, reason }), `reason=${reason} 应放行`).toBe(true)
    }
    expect(isHostToWebview({ ...base, reason: 'whatever' })).toBe(false)
    expect(isHostToWebview({ ...base, ok: true, reason: 'not-found' })).toBe(false)
  })

  it('#219 失败形态 anchor（锚点原文）可选字符串；非字符串拒绝', () => {
    const base = validResultFail() as unknown as Record<string, unknown>
    expect(isHostToWebview({ ...base, reason: 'anchor-missing', anchor: '不存在的标题' })).toBe(true)
    expect(isHostToWebview({ ...base, reason: 'anchor-missing' }), 'anchor 可缺省').toBe(true)
    expect(isHostToWebview({ ...base, anchor: 3 })).toBe(false)
  })

  it('#219 成功形态 scope 三态：full / heading（附锚点）/ block（附 ^ 前缀锚点）', () => {
    const base = validResultOk() as unknown as Record<string, unknown>
    expect(isHostToWebview({ ...base, scope: { kind: 'heading', anchor: '章节' } })).toBe(true)
    expect(isHostToWebview({ ...base, scope: { kind: 'block', anchor: '^blk1' } })).toBe(true)
    expect(isHostToWebview({ ...base, scope: { kind: 'heading' } }), 'heading 缺 anchor 应拒绝').toBe(false)
    expect(isHostToWebview({ ...base, scope: { kind: 'block', anchor: 3 } })).toBe(false)
  })
})

// #333（P3-01）类型分派校验：hover.result 成功载荷携带可选 contentKind
// （缺省 = markdown——旧合法 Markdown 消息兼容识别）。运行期契约：未知
// 类型拒绝；非 markdown 类型本票未登记载荷形态，携带 Markdown 全文/
// LF 范围/Markdown 选择器即为「类型与载荷不匹配」整体拒绝（pdf/image/
// text/web 的载荷由 P3-04/P3-05/P3-08/P3-10 扩展校验器时放开）；失败
// 分态无载荷，contentKind 不出现在失败形态。
describe('#333 contentKind 类型分派校验（hover.result 成功载荷）', () => {
  it('显式 contentKind: markdown 放行（生产类型化入口的出站形态）', () => {
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'markdown' })).toBe(true)
  })

  it('缺省 contentKind 放行（旧合法 Markdown 消息兼容识别）', () => {
    expect(isHostToWebview(validResultOk())).toBe(true)
  })

  it('未知类型拒绝（video / 非字符串）', () => {
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'video' })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 3 })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: null })).toBe(false)
  })

  it('非 markdown 类型 + Markdown 载荷拒绝（类型与载荷不匹配——本票未登记这些载荷形态）', () => {
    for (const kind of ['pdf', 'image', 'web']) {
      expect(isHostToWebview({ ...validResultOk(), contentKind: kind }), `contentKind=${kind} 应拒绝`).toBe(false)
    }
  })

  it('失败形态携带 contentKind 拒绝（失败分态无载荷，类型字段不出现在失败形态）', () => {
    expect(isHostToWebview({ ...validResultFail(), contentKind: 'markdown' })).toBe(false)
  })
})

// #337（P3-05）PDF 载荷校验：contentKind 'pdf' 的成功形态——PDF 源经
// webview 资源域 fetch（pdf.uri + 源字节），text 恒空（无 LF 全文），range
// 不适用（零区间占位），scope 为 PDF 导航选择器（{kind:'pdf', page?}——
// 1-based 正整数或缺失=第一页）；version 为文件状态代次（非 TextDocument）。
// 失败形态新增 anchor-invalid（双链锚点语法非法，附锚点原文）。
/** 合法 hover.result pdf 成功形态基线 */
function validResultPdf(): HostToWebview {
  return {
    kind: 'hover.result',
    reqId: 1,
    instanceId: 'hover-1',
    ok: true,
    contentKind: 'pdf',
    target: { fsPath: 'D:\\notes\\资料.pdf', relPath: '资料.pdf' },
    version: 3,
    text: '',
    range: { start: 0, end: 0 },
    scope: { kind: 'pdf', page: 3 },
    pdf: { uri: 'https://vscode-cdn.net/path/%E8%B5%84%E6%96%99.pdf?v=3', bytes: 709 },
  }
}

describe('#337 PDF 载荷校验（hover.result contentKind=pdf）', () => {
  it('合法 pdf 载荷放行（含 page 指定页与无页两形态）', () => {
    expect(isHostToWebview(validResultPdf())).toBe(true)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'pdf' } })).toBe(true)
  })

  it('pdf 载荷字段契约：uri 非空字符串 + bytes 正整数；缺失或非法整体拒绝', () => {
    const base = validResultPdf() as Record<string, unknown>
    for (const broken of [
      { ...base, pdf: undefined },
      { ...base, pdf: { uri: '', bytes: 10 } },
      { ...base, pdf: { uri: 3, bytes: 10 } },
      { ...base, pdf: { uri: 'x' } },
      { ...base, pdf: { uri: 'x', bytes: 0 } },
      { ...base, pdf: { uri: 'x', bytes: -1 } },
      { ...base, pdf: null },
    ]) {
      expect(isHostToWebview(broken), 'pdf 字段非法应整体拒绝').toBe(false)
    }
  })

  it('pdf 载荷与 Markdown 字段互斥：text 须为空串；scope 须为 pdf 选择器', () => {
    expect(isHostToWebview({ ...validResultPdf(), text: '# 不是全文' })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'full' } })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'heading', anchor: 'x' } })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'pdf', page: 0 } })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'pdf', page: -1 } })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'pdf', page: 1.5 } })).toBe(false)
    expect(isHostToWebview({ ...validResultPdf(), scope: { kind: 'pdf', page: '3' } })).toBe(false)
  })

  it('anchor-invalid 失败分态：新增 reason 放行（附锚点原文）；未知 reason 仍拒绝', () => {
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchor: 'page=0' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'made-up' })).toBe(false)
  })
})

// #340（P3-08）text 载荷形态登记：contentKind === 'text' 的成功形态必须
// 携带结构合法的 textNav（行号 1-based 正整数、窗口/落点约束成立），
// markdown 成功形态不得携带 textNav；失败形态新增 text 通道分态（准入与
// 锚点），anchorDetail 仅 anchor-invalid 可带。token 消息族（hover.tokens /
// hover.tokens.request）与 appearance.changed 的形态契约同区钉住。
describe('#340 text 载荷与 token 消息校验', () => {
  const validTextNav = () => ({
    languageId: 'typescript',
    hasWindow: false,
    beginLine: 1,
    endLine: 40,
    locateLine: 1,
    jumpLine: 1,
    totalLines: 40,
    lineNumbers: true,
  })

  it('contentKind: text + 合法 textNav 放行；缺 textNav / 非法 textNav 拒绝', () => {
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: validTextNav() })).toBe(true)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text' }), 'text 缺 textNav 应拒绝').toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: null })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), languageId: '' } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), beginLine: 0 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), beginLine: 10, endLine: 5 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), endLine: 41, totalLines: 40 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), locateLine: 41 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), jumpLine: 0 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), lineNumbers: 'on' } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), fontSize: 0 } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...validTextNav(), fontFamily: 14 } })).toBe(false)
  })

  it('markdown 成功形态携带 textNav 拒绝（类型与载荷不匹配）', () => {
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'markdown', textNav: validTextNav() })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), textNav: validTextNav() })).toBe(false)
  })

  it('窗口形态放行（硬窗口 + 定位在窗口内 + 字体可选字段）', () => {
    const nav = { ...validTextNav(), hasWindow: true, beginLine: 10, endLine: 20, locateLine: 12, jumpLine: 12 }
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: nav })).toBe(true)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...nav, fontFamily: "Consolas, 'Courier New', monospace", fontSize: 15, fontLigatures: true } })).toBe(true)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'text', textNav: { ...nav, locateLine: 21 } }), '定位越窗应拒绝').toBe(false)
  })

  it('text 通道失败分态：准入与锚点 reason 放行；anchorDetail 限定 anchor-invalid', () => {
    for (const reason of ['binary-file', 'invalid-encoding', 'file-too-large', 'line-too-long', 'anchor-invalid']) {
      expect(isHostToWebview({ ...validResultFail(), reason }), `reason=${reason} 应放行`).toBe(true)
    }
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchor: 'line=0' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchorDetail: 'format' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchorDetail: 'range-order' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchorDetail: 'out-of-bounds' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchorDetail: 'line-outside-window' })).toBe(true)
    expect(isHostToWebview({ ...validResultFail(), reason: 'anchor-invalid', anchorDetail: 'nonsense' })).toBe(false)
    expect(isHostToWebview({ ...validResultFail(), reason: 'read-failed', anchorDetail: 'format' }), '非 anchor-invalid 带 detail 应拒绝').toBe(false)
  })

  it('hover.tokens：成功形态（双层数组契约）放行、非法拒绝；失败形态限定 stale/unavailable', () => {
    const base = { kind: 'hover.tokens', reqId: 1, instanceId: 'hover-1', ok: true, fsPath: 'd:/a.ts', version: 3, layer: 'textmate' } as const
    expect(isHostToWebview({ ...base, colors: ['#cccccc'], tokens: [0, 0, 4, 0, 0] })).toBe(true)
    expect(isHostToWebview({ ...base, layer: 'semantic', colors: ['#00ffaa'], tokens: [1, 0, 2, 0, 0, 0, 3, 1, 1, 0] })).toBe(true)
    expect(isHostToWebview({ ...base, colors: [], tokens: [] })).toBe(true)
    expect(isHostToWebview({ ...base, colors: ['#cccccc'], tokens: [0, 0] }), '5 元组截断应拒绝').toBe(false)
    expect(isHostToWebview({ ...base, colors: ['#cccccc'], tokens: [0, 0, 4, 0, -1] }), '负数应拒绝').toBe(false)
    expect(isHostToWebview({ ...base, layer: 'both', colors: [], tokens: [] })).toBe(false)
    expect(isHostToWebview({ ...base, colors: [3], tokens: [] })).toBe(false)
    expect(isHostToWebview({ kind: 'hover.tokens', reqId: 1, instanceId: 'hover-1', ok: false, reason: 'stale' })).toBe(true)
    expect(isHostToWebview({ kind: 'hover.tokens', reqId: 1, instanceId: 'hover-1', ok: false, reason: 'unavailable' })).toBe(true)
    expect(isHostToWebview({ kind: 'hover.tokens', reqId: 1, instanceId: 'hover-1', ok: false, reason: 'other' })).toBe(false)
    expect(isHostToWebview({ kind: 'hover.tokens', reqId: 1, instanceId: 'hover-1', ok: false, reason: 'stale', tokens: [] }), '失败形态无载荷').toBe(false)
  })

  it('hover.tokens.request：合法放行、窗口倒置拒绝', () => {
    const base = { kind: 'hover.tokens.request', sessionId: 's', docUri: 'file:///d:/a.md', reqId: 1, instanceId: 'hover-1', fsPath: 'd:/a.ts', version: 3 } as const
    expect(isWebviewToHost({ ...base, beginLine: 1, endLine: 40 })).toBe(true)
    expect(isWebviewToHost({ ...base, beginLine: 10, endLine: 5 })).toBe(false)
    expect(isWebviewToHost({ ...base, beginLine: 0, endLine: 5 })).toBe(false)
    expect(isWebviewToHost({ ...base, beginLine: 1, endLine: 40, version: -1 })).toBe(false)
  })

  it('appearance.changed：非负整数代次放行、非法拒绝', () => {
    expect(isHostToWebview({ kind: 'appearance.changed', generation: 1 })).toBe(true)
    expect(isHostToWebview({ kind: 'appearance.changed', generation: 0 })).toBe(true)
    expect(isHostToWebview({ kind: 'appearance.changed', generation: -1 })).toBe(false)
    expect(isHostToWebview({ kind: 'appearance.changed', generation: 'x' })).toBe(false)
    expect(isHostToWebview({ kind: 'appearance.changed' })).toBe(false)
  })
})

// #220 来源资源：悬停浮层内 B 文档的图片/链接以 B 为来源解析——webview
// 在既有通道上附可选 sourceDocUri（B 的 fsPath；缺省 = 面板自身文档，
// 向后兼容）。此处钉住三条消息的校验器行为。
describe('#220 来源资源通道：sourceDocUri 可选字段校验', () => {
  const SRC = 'D:\\notes\\sub\\b.md'

  it('image.request：sourceDocUri 可选非空字符串；缺省与非法形态', () => {
    const base = {
      kind: 'image.request',
      sessionId: 'panel-1',
      docUri: 'file:///d%3A/notes/a.md',
      reqId: 1,
      src: './img.png',
    } as Record<string, unknown>
    expect(isWebviewToHost({ ...base, sourceDocUri: SRC })).toBe(true)
    expect(isWebviewToHost(base), '缺省 = 面板自身文档（向后兼容）').toBe(true)
    expect(isWebviewToHost({ ...base, sourceDocUri: '' }), '空串拒绝').toBe(false)
    expect(isWebviewToHost({ ...base, sourceDocUri: 3 })).toBe(false)
  })

  it('link.activate / wikilink.activate：sourceDocUri 同一口径', () => {
    const link = {
      kind: 'link.activate',
      sessionId: 'panel-1',
      docUri: 'file:///d%3A/notes/a.md',
      href: 'relative.md',
      srcStart: 0,
      srcEnd: 5,
    } as Record<string, unknown>
    expect(isWebviewToHost({ ...link, sourceDocUri: SRC })).toBe(true)
    expect(isWebviewToHost(link)).toBe(true)
    expect(isWebviewToHost({ ...link, sourceDocUri: '' })).toBe(false)

    const wikilink = {
      kind: 'wikilink.activate',
      sessionId: 'panel-1',
      docUri: 'file:///d%3A/notes/a.md',
      target: '另一笔记',
      srcStart: 0,
      srcEnd: 5,
    } as Record<string, unknown>
    expect(isWebviewToHost({ ...wikilink, sourceDocUri: SRC })).toBe(true)
    expect(isWebviewToHost(wikilink)).toBe(true)
    expect(isWebviewToHost({ ...wikilink, sourceDocUri: null })).toBe(false)
  })

  it('view.state hoverPreview 探针：#220 新增 fm（三态枚举）与 imageSrcs（字符串数组）', () => {
    const state = {
      kind: 'view.state',
      text: 'x',
      docLength: 1,
      lineCount: 1,
      renderedLines: 1,
      hoverPreview: {
        open: true,
        state: 'content',
        note: 'sub/b.md',
        blocks: 3,
        scope: 'full',
        fm: 'collapsed',
        imageSrcs: ['vscode-webview://res/img.png'],
      },
    } as Record<string, unknown>
    expect(isWebviewToHost(state)).toBe(true)
    // 旧形态（无新字段）仍放行——探针字段可选，宿主侧向后兼容
    const legacy = {
      ...state,
      hoverPreview: { open: false, state: 'loading', note: '', blocks: 0, scope: '' },
    }
    expect(isWebviewToHost(legacy)).toBe(true)
    // 非法形态：fm 枚举外取值 / imageSrcs 非字符串数组
    expect(
      isWebviewToHost({ ...state, hoverPreview: { ...(state.hoverPreview as object), fm: 'half' } }),
    ).toBe(false)
    expect(
      isWebviewToHost({ ...state, hoverPreview: { ...(state.hoverPreview as object), imageSrcs: ['a', 3] } }),
    ).toBe(false)
  })
})

// #221 全入口悬停：面板条目（反链/出链）的目标身份是宿主快照携带的
// 绝对 fsPath（± 锚点），不走 target/linkHref 文本解析——hover.request
// 增可选 directTarget 承载；hover.test.pointer 钩子扩展 Live 与面板
// 入口（宿主测试无法派发真实鼠标，经钩子走同一委托处理器）。
describe('#221 全入口悬停：directTarget 与 hover.test.pointer 扩展校验', () => {
  it('hover.request 可选 directTarget：形态合法放行、非法整体拒绝、旧形态不变', () => {
    const base = validRequest()
    // 反链面板条目：直接目标无锚点（来源文档全文）
    expect(isWebviewToHost({ ...base, directTarget: { fsPath: 'D:\\notes\\来源.md' } })).toBe(true)
    // 出链面板条目：锚点（标题原文或 ^块id）
    expect(isWebviewToHost({ ...base, directTarget: { fsPath: 'D:\\notes\\目标.md', anchor: '^blk1' } })).toBe(true)
    // 断链出链条目：空串 fsPath 合法（宿主回 not-found 分态，条目仍可悬停）
    expect(isWebviewToHost({ ...base, directTarget: { fsPath: '', anchor: 'x' } })).toBe(true)
    // anchor 可选；旧形态（无 directTarget）仍放行——Reading 双链/普通链接路径不变
    expect(isWebviewToHost(base)).toBe(true)
    // 非法形态：anchor 非字符串 / directTarget 非对象 / fsPath 非字符串
    expect(isWebviewToHost({ ...base, directTarget: { fsPath: 'D:\\notes\\x.md', anchor: 3 } })).toBe(false)
    expect(isWebviewToHost({ ...base, directTarget: 'D:\\notes\\x.md' })).toBe(false)
    expect(isWebviewToHost({ ...base, directTarget: null })).toBe(false)
    expect(isWebviewToHost({ ...base, directTarget: { anchor: 'x' } })).toBe(false)
  })

  it('hover.test.pointer：link 枚举扩展 Live/面板入口与 ctrlKey 修饰位', () => {
    // 宿主 → webview 方向的注入钩子（集成测试经 postToPanel 派发真实
    // mouseover/mouseout 的通道）
    const base = { kind: 'hover.test.pointer', action: 'enter' as const, index: 0 }
    // 既有枚举不回归
    expect(isHostToWebview(base)).toBe(true)
    expect(isHostToWebview({ ...base, link: 'wikilink' })).toBe(true)
    expect(isHostToWebview({ ...base, link: 'md' })).toBe(true)
    // #221 扩展：Live 双链/普通链接与反链/出链条目
    expect(isHostToWebview({ ...base, link: 'live-wikilink' })).toBe(true)
    expect(isHostToWebview({ ...base, link: 'live-md' })).toBe(true)
    expect(isHostToWebview({ ...base, link: 'backlink' })).toBe(true)
    expect(isHostToWebview({ ...base, link: 'outlink' })).toBe(true)
    // Live Ctrl+悬停钩子的修饰位（缺省不带 = 直接悬停口径）
    expect(isHostToWebview({ ...base, link: 'live-wikilink', ctrlKey: true })).toBe(true)
    expect(isHostToWebview({ ...base, link: 'live-wikilink', ctrlKey: false })).toBe(true)
    expect(isHostToWebview({ ...base, ctrlKey: 'yes' })).toBe(false)
    // 补触发路径（验收反馈：指针已在链接上再按 Ctrl）——modkey 动作
    expect(isHostToWebview({ ...base, action: 'modkey' })).toBe(true)
    expect(isHostToWebview({ ...base, action: 'unknown' })).toBe(false)
    // 非法枚举拒绝
    expect(isHostToWebview({ ...base, link: 'unknown' })).toBe(false)
  })
})

// #224 引用视图同步：订阅（webview → 宿主）与失效推送（宿主 → webview）
// 消息族。watch 的 fsPath 为 hover.result 成功回包送达的目标身份（webview
// 不自行解析路径）；invalidated 的 status 三态与 vaultIndex onTargetChange
// 同口径（changed/deleted/stale），generation 单调递增。
describe('#224 订阅与推送：hover.watch / hover.unwatch / hover.invalidated', () => {
  const baseWatch = {
    kind: 'hover.watch',
    sessionId: 'panel-1',
    docUri: 'file:///d%3A/notes/a.md',
    fsPath: 'D:\\notes\\b.md',
    instanceId: 'embed-1',
  } as Record<string, unknown>

  it('hover.watch / hover.unwatch：合法形态放行；缺任一字段整体拒绝', () => {
    expect(isWebviewToHost(baseWatch)).toBe(true)
    expect(isWebviewToHost({ ...baseWatch, kind: 'hover.unwatch' })).toBe(true)
    for (const key of ['sessionId', 'docUri', 'fsPath', 'instanceId']) {
      for (const kind of ['hover.watch', 'hover.unwatch']) {
        const broken: Record<string, unknown> = { ...baseWatch, kind }
        delete broken[key]
        expect(isWebviewToHost(broken), `${kind} 缺 ${key} 应拒绝`).toBe(false)
      }
    }
    // 空串拒绝（fsPath/instanceId 是身份字段；docUri/sessionId 同既有口径）
    expect(isWebviewToHost({ ...baseWatch, fsPath: '' })).toBe(false)
    expect(isWebviewToHost({ ...baseWatch, instanceId: '' })).toBe(false)
    expect(isWebviewToHost({ ...baseWatch, fsPath: 3 })).toBe(false)
  })

  it('hover.invalidated：status 三态放行、generation 非负整数；非法形态拒绝', () => {
    const base = {
      kind: 'hover.invalidated',
      fsPath: 'D:\\notes\\b.md',
      status: 'changed',
      generation: 1,
    } as Record<string, unknown>
    expect(isHostToWebview(base)).toBe(true)
    expect(isHostToWebview({ ...base, status: 'deleted' })).toBe(true)
    expect(isHostToWebview({ ...base, status: 'stale' })).toBe(true)
    for (const key of ['fsPath', 'status', 'generation']) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isHostToWebview(broken), `缺 ${key} 应拒绝`).toBe(false)
    }
    expect(isHostToWebview({ ...base, status: 'whatever' })).toBe(false)
    expect(isHostToWebview({ ...base, generation: -1 })).toBe(false)
    expect(isHostToWebview({ ...base, generation: 1.5 })).toBe(false)
    expect(isHostToWebview({ ...base, fsPath: '' })).toBe(false)
  })
})

// ---- 修 2（review 第二轮 P3）：view.state readingEmbed 观测条目的 host 字段 ----
// #223 起 host 区分容器（reading 块挂载 / live widget 挂载），类型已声明
// host?: 'reading' | 'live' 但校验器未跟随——非法 host 值（联合外字符串/
// 非字符串）会被放行进宿主，观测面与联合类型三处不同步即静默脏数据。
describe('view.state readingEmbed 探针：host 字段入校验器', () => {
  function stateWithEmbed(entry: Record<string, unknown>): Record<string, unknown> {
    return {
      kind: 'view.state',
      text: '# t',
      docLength: 4,
      lineCount: 1,
      renderedLines: 1,
      readingEmbed: [
        {
          inner: '![[x]]',
          state: 'content',
          note: 'x.md',
          blocks: 2,
          scope: 'full',
          fm: 'none',
          maxHeightPx: 200,
          ...entry,
        },
      ],
    }
  }

  it('合法形态放行（host 缺省 / reading / live）', () => {
    expect(isWebviewToHost(stateWithEmbed({}))).toBe(true)
    expect(isWebviewToHost(stateWithEmbed({ host: 'reading' }))).toBe(true)
    expect(isWebviewToHost(stateWithEmbed({ host: 'live' }))).toBe(true)
  })

  it('host 非法值整体拒绝（联合外字符串 / 非字符串）', () => {
    expect(isWebviewToHost(stateWithEmbed({ host: 'panel' }))).toBe(false)
    expect(isWebviewToHost(stateWithEmbed({ host: 42 }))).toBe(false)
  })
})

it('#242 来源租约字段兼容旧协议，非法token与retainSource整体拒绝', () => {
  expect(isWebviewToHost({ ...validRequest(), retainSource: true })).toBe(true)
  expect(isWebviewToHost({ ...validRequest(), retainSource: 'true' })).toBe(false)
  expect(isHostToWebview({ ...validResultOk(), sourceLeaseId: 'lease-1' })).toBe(true)
  expect(isHostToWebview({ ...validResultOk(), sourceLeaseId: '' })).toBe(false)
  const release = { kind: 'hover.source.release', sessionId: 'panel', docUri: 'file:///a.md', sourceLeaseId: 'lease-1' }
  expect(isWebviewToHost(release)).toBe(true)
  expect(isWebviewToHost({ ...release, sourceLeaseId: null })).toBe(false)
  expect(isWebviewToHost({ ...release, sourceLeaseId: '' })).toBe(false)
  const watch = { kind: 'hover.watch', sessionId: 'panel', docUri: 'file:///a.md', instanceId: 'occ', fsPath: 'D:/notes/b.md' }
  expect(isWebviewToHost(watch)).toBe(true)
  expect(isWebviewToHost({ ...watch, sourceLeaseId: 'lease-1' })).toBe(true)
  expect(isWebviewToHost({ ...watch, sourceLeaseId: {} })).toBe(false)
})


describe('跳转目标提示消息协议（#299：hover.target.resolve / hover.target.resolved）', () => {
  it('合法三形态出站请求放行（target 双链 / linkHref 普通链接 / directTarget 面板直接目标）', () => {
    const base = {
      kind: 'hover.target.resolve' as const,
      sessionId: 'panel-1',
      docUri: 'file:///d%3A/notes/a.md',
      reqId: 1,
    }
    expect(isWebviewToHost({ ...base, target: '目标笔记' })).toBe(true)
    expect(isWebviewToHost({ ...base, linkHref: 'b.md#锚' })).toBe(true)
    expect(isWebviewToHost({ ...base, directTarget: { fsPath: 'D:/notes/c.md', anchor: '^blk' } })).toBe(true)
  })

  it('出站请求非法形态整体拒绝（缺会话守卫 / 非法 reqId / 载荷形态错误）', () => {
    expect(isWebviewToHost({ kind: 'hover.target.resolve', docUri: 'x', reqId: 1 })).toBe(false)
    expect(isWebviewToHost({ kind: 'hover.target.resolve', sessionId: 's', reqId: 1 })).toBe(false)
    expect(isWebviewToHost({ kind: 'hover.target.resolve', sessionId: 's', docUri: 'x', reqId: -1 })).toBe(false)
    expect(isWebviewToHost({ kind: 'hover.target.resolve', sessionId: 's', docUri: 'x', reqId: 1, target: 42 })).toBe(false)
    expect(isWebviewToHost({
      kind: 'hover.target.resolve', sessionId: 's', docUri: 'x', reqId: 1,
      directTarget: { fsPath: 7 },
    })).toBe(false)
  })

  it('应答两形态放行：成功必带非空 relPath（anchor 可选），失败仅 ok:false', () => {
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: true, relPath: 'sub/b.md' })).toBe(true)
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: true, relPath: 'b.md', anchor: '#标题' })).toBe(true)
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: false })).toBe(true)
  })

  it('应答非法形态整体拒绝（成功缺 relPath / 空 relPath / anchor 类型错误）', () => {
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: true })).toBe(false)
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: true, relPath: '' })).toBe(false)
    expect(isHostToWebview({ kind: 'hover.target.resolved', reqId: 1, ok: true, relPath: 'b.md', anchor: 5 })).toBe(false)
  })
})

// ---- #342（P3-10）web 载荷与取消通道 ----

describe('#342 web 载荷校验（hover.result 成功形态）', () => {
  const validWebResult = (): Record<string, unknown> => ({
    ...validResultOk(),
    contentKind: 'web',
    // web 形态的 Markdown 专属字段为占位值（target 空身份 / version 0 /
    // 空文本 / 全文区间 / full 选择器——校验器仍要求字段形态合法）
    target: { fsPath: '', relPath: '' },
    version: 0,
    text: '',
    range: { start: 0, end: 0 },
    scope: { kind: 'full' },
    web: { url: 'https://example.com/page', domain: 'example.com', title: '示例', description: '摘要' },
  })

  it('contentKind=web + web 载荷放行', () => {
    expect(isHostToWebview(validWebResult())).toBe(true)
  })

  it('contentKind=web 缺 web 载荷拒绝（类型与载荷不匹配）', () => {
    const msg = validWebResult()
    delete msg.web
    expect(isHostToWebview(msg)).toBe(false)
  })

  it('web 载荷字段类型错误拒绝（url/title/description 非字符串）', () => {
    expect(isHostToWebview({ ...validWebResult(), web: { url: 42, domain: 'example.com', title: '', description: '' } })).toBe(false)
    expect(isHostToWebview({ ...validWebResult(), web: { url: 'https://a/', domain: 1, title: '', description: '' } })).toBe(false)
    expect(isHostToWebview({ ...validWebResult(), web: { url: 'https://a/', domain: 'a', title: null, description: '' } })).toBe(false)
    expect(isHostToWebview({ ...validWebResult(), web: [] })).toBe(false)
  })

  it('markdown 形态（缺省/markdown）携带 web 载荷拒绝（互斥）', () => {
    expect(isHostToWebview({ ...validResultOk(), web: { url: 'https://a/', domain: 'a', title: '', description: '' } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'markdown', web: { url: 'https://a/', domain: 'a', title: '', description: '' } })).toBe(false)
  })

  it('失败形态携带 web 或 contentKind 拒绝', () => {
    expect(isHostToWebview({
      kind: 'hover.result', reqId: 1, instanceId: 'i', ok: false, reason: 'web-timeout', contentKind: 'web',
    })).toBe(false)
  })
})

describe('#342 hover.cancel 出站消息（webview → 宿主）', () => {
  const base = { kind: 'hover.cancel', sessionId: 's', docUri: 'file:///d/a.md' }

  it('合法形态放行（instanceId + reqId 配对）', () => {
    expect(isWebviewToHost({ ...base, instanceId: 'hover-1', reqId: 3 })).toBe(true)
  })

  it('缺会话守卫 / 非法 reqId / instanceId 拒绝', () => {
    expect(isWebviewToHost({ kind: 'hover.cancel', docUri: 'x', instanceId: 'i', reqId: 1 })).toBe(false)
    expect(isWebviewToHost({ kind: 'hover.cancel', sessionId: 's', instanceId: 'i', reqId: 1 })).toBe(false)
    expect(isWebviewToHost({ ...base, instanceId: 'i', reqId: 0 })).toBe(false)
    expect(isWebviewToHost({ ...base, instanceId: '', reqId: 1 })).toBe(false)
  })
})

// #336（P3-04）image 载荷校验：contentKind 'image' 的成功形态登记——
// imageSrc 必填非空（webview 经 image.request 解析装载），Markdown 全文/
// 定位区间退化为空载荷（text 恒空串、range 零区间）、选择器为 plain（图
// 片无锚点定位语义）。markdown 形态携带 imageSrc 或 plain 选择器为类型
// 与载荷不匹配，整体拒绝。
describe('#336 image 载荷校验（hover.result 成功载荷）', () => {
  function validImageResult(): HostToWebview {
    return {
      kind: 'hover.result',
      reqId: 1,
      instanceId: 'hover-1',
      ok: true,
      contentKind: 'image',
      target: { fsPath: 'D:\notes\图.png', relPath: '图.png' },
      version: 1760000000123,
      imageSrc: 'assets/图.png',
      text: '',
      range: { start: 0, end: 0 },
      scope: { kind: 'plain' },
    }
  }

  it('合法 image 形态放行（contentKind + imageSrc + 空文本/零区间/plain 选择器）', () => {
    expect(isHostToWebview(validImageResult())).toBe(true)
  })

  it('imageSrc 缺省/空串/非字符串拒绝', () => {
    const base = validImageResult() as Record<string, unknown>
    const without = { ...base }
    delete without.imageSrc
    expect(isHostToWebview(without)).toBe(false)
    expect(isHostToWebview({ ...base, imageSrc: '' })).toBe(false)
    expect(isHostToWebview({ ...base, imageSrc: 3 })).toBe(false)
  })

  it('image 载荷不匹配拒绝：携带 Markdown 全文 / Markdown 选择器', () => {
    const base = validImageResult() as Record<string, unknown>
    expect(isHostToWebview({ ...base, text: '# 不是空载荷\n' })).toBe(false)
    expect(isHostToWebview({ ...base, scope: { kind: 'full' } })).toBe(false)
    expect(isHostToWebview({ ...base, range: { start: 0, end: 5 } })).toBe(false)
  })

  it('markdown 形态携带 imageSrc 或 plain 选择器拒绝（类型与载荷不匹配）', () => {
    expect(isHostToWebview({ ...validResultOk(), imageSrc: 'assets/图.png' })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), scope: { kind: 'plain' } })).toBe(false)
    expect(isHostToWebview({ ...validResultOk(), contentKind: 'markdown', imageSrc: 'assets/图.png' })).toBe(false)
  })
})
