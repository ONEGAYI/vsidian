// 悬停预览消息协议契约（#218）：hover.request / hover.result 的运行期
// 校验器行为——校验器与联合类型三处不同步 = 静默丢消息（protocol-notes
// 陷阱清单），此处钉住合法形态放行、非法形态整体拒绝（不部分读取）。
// #220 扩展：来源资源通道（image.request / link.activate / wikilink.activate
// 的可选 sourceDocUri——B 文档身份）与 view.state hoverPreview 探针的
// 属性区/图片观测字段。
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

  it('#219 普通链接形态：linkHref 可选字符串（缺省双链；非字符串拒绝）', () => {
    expect(isWebviewToHost({ ...validRequest(), linkHref: 'relative.md#章' })).toBe(true)
    expect(isWebviewToHost(validRequest()), '缺省仍为双链形态').toBe(true)
    expect(isWebviewToHost({ ...validRequest(), linkHref: 3 })).toBe(false)
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
    // 非法枚举拒绝
    expect(isHostToWebview({ ...base, link: 'unknown' })).toBe(false)
  })
})
