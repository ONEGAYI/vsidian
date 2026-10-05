// #340（P3-08）webview 文本装载与渲染契约（jsdom）：refLoadedContentOf
// Result 的 text 投影、RefContentMount 的 text 分派（视图结构/行号/字体/
// 定位/窗口）、token 分层应用与版本竞态仲裁（迟到/过期 token 不覆盖新
// 正文）、token 请求出站（reqId/instanceId/窗口载荷）与预算准入。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  RefContentInstance,
  refLoadedContentOfResult,
  type RefLoadedTextContent,
} from '../../src/webview/refContentInstance'
import { TEXT_VIEW_CLASS_NAMES } from '../../src/webview/textRefView'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'

function textLoaded(overrides: Partial<RefLoadedTextContent> = {}): RefLoadedTextContent {
  return {
    kind: 'text',
    fsPath: 'D:/notes/code.ts',
    relPath: 'code.ts',
    version: 7,
    text: 'const alpha = 1;\nconst bravo = 2;\nconst charlie = 3',
    languageId: 'typescript',
    hasWindow: false,
    beginLine: 1,
    endLine: 3,
    locateLine: 1,
    totalLines: 3,
    font: {},
    lineNumbers: true,
    ...overrides,
  }
}

function fixture(occurrence: string, sent: WebviewToHost[]) {
  const instance = new RefContentInstance({
    panelDocUri: 'file:///a.md', sourceDocUri: 'file:///a.md',
    range: { start: 0, end: 10 }, occurrence,
  })
  const contentEl = document.createElement('div')
  const scrollEl = document.createElement('div')
  scrollEl.appendChild(contentEl)
  document.body.appendChild(scrollEl)
  const mount = instance.mount({ contentEl, scrollEl, strategy: 'virtual',
    session: () => ({ sessionId: 'panel', docUri: 'file:///a.md' }),
    send: (msg) => sent.push(msg), codeHighlight: () => true,
  })
  return { instance, mount, contentEl, scrollEl }
}

afterEach(() => { document.body.textContent = '' })

describe('refLoadedContentOfResult：text 投影', () => {
  const okMessage = (nav: Record<string, unknown>): Extract<HostToWebview, { kind: 'hover.result'; ok: boolean }> & { ok: true; textNav?: Record<string, unknown> } => ({
    kind: 'hover.result', reqId: 1, instanceId: 'hover-1', ok: true, contentKind: 'text',
    target: { fsPath: 'D:/notes/code.ts', relPath: 'code.ts' },
    version: 7, text: 'a\nb\n', range: { start: 0, end: 4 }, scope: { kind: 'full' },
    textNav: {
      languageId: 'typescript', hasWindow: false, beginLine: 1, endLine: 2, locateLine: 1,
      jumpLine: 1, totalLines: 2, fontFamily: 'Fira Code', fontSize: 15, fontLigatures: true,
      lineNumbers: true,
      ...nav,
    },
  })

  it('textNav 全字段投影（含字体三件套）', () => {
    const loaded = refLoadedContentOfResult(okMessage({}))
    expect(loaded).toEqual(textLoaded({
      text: 'a\nb\n', languageId: 'typescript', endLine: 2, totalLines: 2,
      font: { family: 'Fira Code', size: 15, ligatures: true },
    }))
  })

  it('text 缺 textNav（防御路径）与未知 kind 返回 null', () => {
    const full = okMessage({})
    const { textNav: _omit, ...broken } = full
    void _omit
    expect(refLoadedContentOfResult(broken)).toBeNull()
    expect(refLoadedContentOfResult({ ...okMessage({}), contentKind: 'pdf' })).toBeNull()
  })
})

describe('RefContentMount：text 渲染与 token 管线', () => {
  it('render text：视图结构（gutter+code）、行号（绝对行）、字体内联、token 请求出站', () => {
    const sent: WebviewToHost[] = []
    const f = fixture('hover-1', sent)
    expect(f.mount.render(textLoaded({ font: { family: 'Cascadia Code', size: 20 }, locateLine: 2 }))).toBe(true)
    const view = f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)
    expect(view).not.toBeNull()
    expect(f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line}`).length).toBe(3)
    expect(f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.gutterLine}`).length).toBe(3)
    expect((view as HTMLElement).style.fontFamily).toContain('Cascadia Code')
    expect((view as HTMLElement).style.fontSize).toBe('20px')
    // token 请求：instanceId = occurrence、窗口与版本
    const req = sent.find((m) => m.kind === 'hover.tokens.request')
    expect(req).toBeDefined()
    if (req?.kind === 'hover.tokens.request') {
      expect(req.instanceId).toBe('hover-1')
      expect(req.fsPath).toBe('D:/notes/code.ts')
      expect(req.version).toBe(7)
      expect(req.beginLine).toBe(1)
      expect(req.endLine).toBe(3)
      expect(req.sessionId).toBe('panel')
    }
    expect(f.mount.isTextContent).toBe(true)
    f.instance.dispose()
  })

  it('range 硬窗口：行号从 beginLine 起算（窗口外结构性不可达——不进载荷）', () => {
    const sent: WebviewToHost[] = []
    const f = fixture('hover-2', sent)
    f.mount.render(textLoaded({
      text: 'bravo line\ncharlie line',
      hasWindow: true, beginLine: 10, endLine: 11, totalLines: 40, locateLine: 11,
    }))
    const gutters = f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.gutterLine}`)
    expect([...gutters].map((g) => g.textContent)).toEqual(['10', '11'])
    expect(f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line}`).length).toBe(2)
    const req = sent.find((m) => m.kind === 'hover.tokens.request')
    if (req?.kind === 'hover.tokens.request') {
      expect(req.beginLine).toBe(10)
      expect(req.endLine).toBe(11)
    }
    f.instance.dispose()
  })

  it('lineNumbers off：gutter 隐藏', () => {
    const f = fixture('hover-3', [])
    f.mount.render(textLoaded({ lineNumbers: false }))
    const gutter = f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.gutter}`) as HTMLElement
    expect(gutter.style.display).toBe('none')
    f.instance.dispose()
  })

  it('token 分层：语法层先染（内联颜色），语义层到达后按区间覆盖', () => {
    const f = fixture('hover-4', [])
    f.mount.render(textLoaded({ text: 'const alpha = 1;', endLine: 1 }))
    // 语法层：'const'（0-5）#569cd6，'alpha'（6-11）#9cdcfe
    f.mount.applyTextTokens({
      instanceId: 'hover-4', ok: true, layer: 'textmate', version: 7,
      colors: ['#569cd6', '#9cdcfe'], tokens: [0, 0, 5, 0, 0, 0, 6, 5, 1, 0],
    })
    const spans = f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line} span`)
    expect(spans.length).toBe(2)
    expect((spans[0] as HTMLElement).style.color).toContain('86, 156, 214')
    expect(spans[0].textContent).toBe('const')
    expect((spans[1] as HTMLElement).style.color).toContain('156, 220, 254')
    expect(spans[1].textContent).toBe('alpha')
    // 语义层：'alpha' 覆盖为 #00ffaa（区间 [6,11)）
    f.mount.applyTextTokens({
      instanceId: 'hover-4', ok: true, layer: 'semantic', version: 7,
      colors: ['#00ffaa'], tokens: [0, 6, 5, 0, 0],
    })
    const after = f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line} span`)
    expect(after[0].textContent).toBe('const')
    expect((after[0] as HTMLElement).style.color).toContain('86, 156, 214')
    expect(after[1].textContent).toBe('alpha')
    expect((after[1] as HTMLElement).style.color).toContain('0, 255, 170')
    f.instance.dispose()
  })

  it('版本竞态仲裁：instanceId 不配对拒绝；版本不匹配丢弃（不覆盖新正文）', () => {
    const f = fixture('hover-5', [])
    f.mount.render(textLoaded())
    // instanceId 不配对：整体不消费（返回 false）
    expect(f.mount.applyTextTokens({
      instanceId: 'other', ok: true, layer: 'textmate', version: 7,
      colors: ['#569cd6'], tokens: [0, 0, 5, 0, 0],
    })).toBe(false)
    // 版本过期（装载 7、回包 6）：配对成功但不应用——行内容为无内联色的
    // 整行单 span（无 token 形态），无着色 span
    expect(f.mount.applyTextTokens({
      instanceId: 'hover-5', ok: true, layer: 'textmate', version: 6,
      colors: ['#569cd6'], tokens: [0, 0, 5, 0, 0],
    })).toBe(true)
    const plainSpan = f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.line} span`) as HTMLElement | null
    expect(plainSpan?.style.color ?? '').toBe('')
    // 失败回包（unavailable）：不渲染，纯文本保持
    expect(f.mount.applyTextTokens({ instanceId: 'hover-5', ok: false })).toBe(true)
    expect((f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.line} span`) as HTMLElement | null)?.style.color ?? '').toBe('')
    f.instance.dispose()
  })

  it('刷新重渲染：clear 后重挂 text 视图；markdown 装载后 isTextContent 复位', () => {
    const f = fixture('hover-6', [])
    f.mount.render(textLoaded())
    expect(f.mount.isTextContent).toBe(true)
    f.mount.render(textLoaded({ version: 8, text: 'new content', endLine: 1 }))
    expect(f.mount.isTextContent).toBe(true)
    expect(f.contentEl.querySelectorAll(`.${TEXT_VIEW_CLASS_NAMES.line}`).length).toBe(1)
    f.mount.clear()
    expect(f.mount.isTextContent).toBe(false)
    expect(f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).toBeNull()
    f.instance.dispose()
  })

  it('预算准入拒绝：beforeMount 返回 false 不装载', () => {
    const f = fixture('hover-7', [])
    expect(f.mount.render(textLoaded(), () => false)).toBe(false)
    expect(f.contentEl.querySelector(`.${TEXT_VIEW_CLASS_NAMES.view}`)).toBeNull()
    f.instance.dispose()
  })

  it('定位：locateLine > beginLine 时滚动到目标行（延迟一帧后）', async () => {
    const f = fixture('hover-8', [])
    const text = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join('\n')
    f.mount.render(textLoaded({ text, endLine: 60, totalLines: 60, locateLine: 30 }))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    // 行高 21（14*1.5），定位 30 行 → scrollTop = 29*21 = 609
    expect(f.scrollEl.scrollTop).toBe(29 * 21)
    f.instance.dispose()
  })
})
