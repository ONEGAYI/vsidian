// P2-11（#288）嵌入内部 Live 的目标资源接线契约（模块级 jsdom 直驱）：
// - 图片解析 / 粘贴 / 链接 / 双链 / 手动刷新全部经宿主验证的目标端口
//   （refEdit.message 信封）传递 B 身份，不走 A 面板直发通道
// - 资源回包（image.result / image.paste.result / image.invalidate /
//   refresh.invalidated）经 refEdit.push 信封按 portId 定向路由到实例；
//   A 面板广播的直发回包不投递实例管理器（reqId 空间隔离——两管理器
//   reqId 撞号时不得错插错图）
// - 图片粘贴按实例在途表路由：成功在光标处插入，未知/迟到 reqId 丢弃；
//   释放（切 Reading / unbind）后的迟到结果不写任何实例；Reading 态
//   粘贴不拦截（isLiveActive 真实化，不再恒 false）
// - 图片弹窗实例上下文随实例注册/注销（打开时捕获 B 身份，不读主正文）
// 真实键鼠与磁盘落盘在 test/browser（embedLiveResources.mjs）与集成层。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import {
  EMBED_CARD_CLASS_NAMES,
  EmbedCardManager,
  type EmbedCardContext,
} from '../../src/webview/embedCard'
import { imagePopupOptsOfView } from '../../src/webview/imagePopup'
import { createReadingBlockElement } from '../../src/webview/readingView'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'

installLocale('zh-cn', zhCn)

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains(EMBED_CARD_CLASS_NAMES.scroll) ? 400 : 0
  })
})

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\embed-assets\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/embed-assets/%E7%9B%AE%E6%A0%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = [
  '# 目标笔记',
  '',
  '![图](res.png)',
  '',
  '[链接说明](inner-target.md) 与 [[双链目标]]',
  '',
].join('\n')

interface Harness {
  manager: EmbedCardManager
  sent: WebviewToHost[]
  setParentMode(m: 'reading' | 'live'): void
}

function harness(): Harness {
  const sent: WebviewToHost[] = []
  let parentMode: 'reading' | 'live' = 'reading'
  const context: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => parentMode,
  }
  const manager = new EmbedCardManager(context)
  return {
    manager,
    sent,
    setParentMode(mode) {
      parentMode = mode
      manager.notifyParentModeChanged()
    },
  }
}

async function settle(times = 14): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

function mountEmbedBlock(manager: EmbedCardManager, text: string): HTMLElement {
  const blocks = splitReadingBlocks(text)
  const embed = blocks.find((b) => b.kind === 'embed')
  if (!embed) {
    throw new Error('文本未产生 embed 块')
  }
  const el = createReadingBlockElement(embed, text)
  document.body.appendChild(el)
  manager.mountBlock(el)
  return el
}

function hoverRequestOf(sent: WebviewToHost[]) {
  const req = [...sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function resultOk(
  req: { reqId: number; instanceId: string },
  text = TARGET_TEXT,
): Extract<HoverPreviewResult, { ok: true }> {
  return {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    target: { fsPath: B_FS, relPath: 'embed-assets/目标笔记.md' },
    version: 2,
    text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' },
    depth: 1,
    expansionPath: [],
    sourceLeaseId: 'panel-1:source-1',
  }
}

function bindReqIdOf(sent: WebviewToHost[]): number {
  const req = [...sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req.reqId
}

type RefEditMessage = Extract<WebviewToHost, { kind: 'refEdit.message' }>

function envelopesOf(sent: WebviewToHost[], inner: string): RefEditMessage[] {
  return sent.filter((m): m is RefEditMessage =>
    m.kind === 'refEdit.message' && m.message.kind === inner)
}

/** 挂载 → 装载 → 父 Live → bind → init（返回端口 id） */
async function bindLiveCard(h: Harness, docText = '![[目标笔记]]\n'): Promise<{ portId: string; el: HTMLElement }> {
  const el = mountEmbedBlock(h.manager, docText)
  h.manager.notifyResult(resultOk(hoverRequestOf(h.sent)))
  h.setParentMode('live')
  const portId = 'panel-9'
  h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h.sent), ok: true, portId, fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false })
  h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: 2, text: TARGET_TEXT } })
  await settle()
  return { portId, el }
}

function editorRootOf(el: HTMLElement): HTMLElement {
  const root = el.querySelector('.cm-editor')
  if (!root) {
    throw new Error('内部 Live 编辑器不在场')
  }
  return root as HTMLElement
}

function embedImages(el: HTMLElement): HTMLImageElement[] {
  return Array.from(el.querySelectorAll<HTMLImageElement>('.vsidian-image img'))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('P2-11 图片解析：经端口信封以 B 为来源', () => {
  it('image.request 经 refEdit.message 信封出站（B 身份 docUri）', async () => {
    const h = harness()
    await bindLiveCard(h)
    const envs = envelopesOf(h.sent, 'image.request')
    expect(envs.length).toBeGreaterThanOrEqual(1)
    const env = envs[0]!
    expect(env.portId).toBe('panel-9')
    expect(env.fsPath).toBe(B_FS)
    expect(env.message).toMatchObject({ kind: 'image.request', docUri: B_DOC_URI, src: 'res.png' })
    // Reading 容器（双容器并存）的同图直发（sourceDocUri 形态，#220 既有
    // 语义）可并存；Live 实例管理器的失效重挂只产生信封形态（见 invalidate 用例）
  })

  it('image.result 经信封定向路由应用；A 面板广播（撞 reqId）不投递实例管理器', async () => {
    const h = harness()
    const { portId } = await bindLiveCard(h)
    const req = envelopesOf(h.sent, 'image.request')[0]!
    const reqId = (req.message as Extract<WebviewToHost, { kind: 'image.request' }>).reqId

    // A 面板广播的直发回包（reqId 撞号）：不得应用——这是「资源结果关联
    // 实例」的防错插契约（主面板管理器与实例管理器 reqId 空间独立从 0 自增）
    h.manager.notifyImageResult({ reqId, ok: true, src: 'a-panel-wrong-uri' })
    await settle()
    expect(embedImages(document.body).length).toBe(0) // 未应用（无 img 子元素）

    // 信封回包：定向应用到 B 管理器
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'image.result', reqId, ok: true, src: 'https://cdn.test/b/res.png' } })
    await settle()
    const imgs = embedImages(document.body)
    expect(imgs.length).toBe(1)
    expect(imgs[0]!.src).toBe('https://cdn.test/b/res.png')
  })

  it('image.invalidate 经信封失效重发（新请求只有信封形态——实例管理器不走 A 直发）', async () => {
    const h = harness()
    const { portId } = await bindLiveCard(h)
    h.sent.length = 0 // 清掉 Reading 容器装载期的直发请求
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'image.invalidate', srcs: ['res.png'] } })
    await settle()
    // 信封失效只驱动实例管理器（notifyPush 不触 Reading 内容）：其重挂请求
    // 全部经目标端口，无一条 A 直发（sourceDocUri 形态）
    const envs = envelopesOf(h.sent, 'image.request')
    expect(envs.length).toBeGreaterThanOrEqual(1)
    expect((envs[envs.length - 1]!.message as Extract<WebviewToHost, { kind: 'image.request' }>).docUri)
      .toBe(B_DOC_URI)
    expect(h.sent.some((m) => m.kind === 'image.request')).toBe(false)
  })

  it('refresh.invalidated 经信封全量失效重挂', async () => {
    const h = harness()
    const { portId } = await bindLiveCard(h)
    const before = envelopesOf(h.sent, 'image.request').length
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'refresh.invalidated', reqId: 1, generation: 5 } })
    await settle()
    expect(envelopesOf(h.sent, 'image.request').length).toBeGreaterThan(before)
  })

  it('手动刷新向全部活跃端口广播 refresh.request（B 会话清缓存推进代次）', async () => {
    const h = harness()
    await bindLiveCard(h)
    h.manager.refreshLiveResources()
    const envs = envelopesOf(h.sent, 'refresh.request')
    expect(envs.length).toBe(1)
    expect(envs[0]!.portId).toBe('panel-9')
    expect((envs[0]!.message as Extract<WebviewToHost, { kind: 'refresh.request' }>).docUri)
      .toBe(B_DOC_URI)
  })
})

describe('P2-11 链接与双链：经端口信封以 B 为解析来源', () => {
  /** 渲染态点击驱动（linkInteraction.test.ts 同款惯例：mock posAtCoords
   *  到目标区间——jsdom 无布局，坐标→位置映射无法真实计算） */
  function clickRendered(h: Harness, pos: number, selector: string, content: HTMLElement): void {
    const view = h.manager.focusedLive()?.getView()
    if (!view) {
      throw new Error('实例视图不在场')
    }
    const hit = vi.spyOn(view, 'posAtCoords').mockReturnValue(pos)
    try {
      const rendered = content.querySelector<HTMLElement>(selector)
      expect(rendered).not.toBeNull()
      rendered!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
      content.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    } finally {
      hit.mockRestore()
    }
  }

  it('渲染态链接点击出站 link.activate 信封（B 身份）', async () => {
    const h = harness()
    const { el } = await bindLiveCard(h)
    const content = editorRootOf(el).querySelector('.cm-content') as HTMLElement
    // 光标移到文档末尾（远离链接区间 → 渲染态）
    h.manager.focusEmbed('目标笔记', TARGET_TEXT.length)
    clickRendered(h, TARGET_TEXT.indexOf('链接说明'), '[data-vsidian-rendered-link="true"]', content)
    const envs = envelopesOf(h.sent, 'link.activate')
    expect(envs.length).toBe(1)
    expect(envs[0]!.portId).toBe('panel-9')
    expect(envs[0]!.message).toMatchObject({ kind: 'link.activate', docUri: B_DOC_URI, href: 'inner-target.md' })
  })

  it('渲染态双链点击出站 wikilink.activate 信封（B 身份）', async () => {
    const h = harness()
    const { el } = await bindLiveCard(h)
    const content = editorRootOf(el).querySelector('.cm-content') as HTMLElement
    h.manager.focusEmbed('目标笔记', TARGET_TEXT.length)
    clickRendered(h, TARGET_TEXT.indexOf('双链目标'), '[data-vsidian-rendered-wikilink="true"]', content)
    const envs = envelopesOf(h.sent, 'wikilink.activate')
    expect(envs.length).toBe(1)
    expect(envs[0]!.message).toMatchObject({ kind: 'wikilink.activate', docUri: B_DOC_URI, target: '双链目标' })
  })
})

describe('P2-11 图片粘贴：按 B 身份经端口，结果关联实例', () => {
  const PASTE = { mime: 'image/png', dataBase64: 'iVBORw0KGgo=' }

  it('粘贴出站经 refEdit.message 信封（B 身份 docUri）', async () => {
    const h = harness()
    await bindLiveCard(h)
    const ok = h.manager.testPasteImage('目标笔记', PASTE)
    expect(ok).toBe(true)
    const envs = envelopesOf(h.sent, 'image.paste')
    expect(envs.length).toBe(1)
    expect(envs[0]!.portId).toBe('panel-9')
    expect(envs[0]!.message).toMatchObject({ kind: 'image.paste', docUri: B_DOC_URI, mime: 'image/png' })
    // 不走 A 面板直发
    expect(h.sent.some((m) => m.kind === 'image.paste')).toBe(false)
  })

  it('落盘结果经信封路由：光标处插入 markdown；未知 reqId 迟到回包丢弃', async () => {
    const h = harness()
    const { portId } = await bindLiveCard(h)
    h.manager.testPasteImage('目标笔记', PASTE)
    const env = envelopesOf(h.sent, 'image.paste')[0]!
    const reqId = (env.message as Extract<WebviewToHost, { kind: 'image.paste' }>).reqId

    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'image.paste.result', reqId, ok: true, markdown: '![image](assets/pasted.png)' } })
    await settle()
    // 插入经实例标准出站链：edit.request 信封（目标 = B）
    const edits = envelopesOf(h.sent, 'edit.request')
    expect(edits.length).toBe(1)
    expect((edits[0]!.message as { changes: Array<{ text: string }> }).changes[0]!.text)
      .toBe('![image](assets/pasted.png)')

    // 未知 reqId 的迟到回包：丢弃（不再插入）
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'image.paste.result', reqId: reqId + 99, ok: true, markdown: '![late](x.png)' } })
    await settle()
    expect(envelopesOf(h.sent, 'edit.request').length).toBe(1)
  })

  it('释放（切 Reading）后的迟到结果不写任何实例；重绑后旧 reqId 也不插入', async () => {
    const h = harness()
    const { portId } = await bindLiveCard(h)
    h.manager.testPasteImage('目标笔记', PASTE)
    const reqId = (envelopesOf(h.sent, 'image.paste')[0]!.message as { reqId: number }).reqId

    // 释放端口（切 Reading → teardownLive → unbind）
    h.manager.testSetMode('目标笔记', 'reading')
    expect(h.sent.some((m) => m.kind === 'refEdit.unbind')).toBe(true)

    // 释放后迟到回包：实例已销毁——不得产生任何编辑出站
    h.manager.notifyPush({ kind: 'refEdit.push', portId, fsPath: B_FS, message: { kind: 'image.paste.result', reqId, ok: true, markdown: '![stale](x.png)' } })
    await settle()
    expect(envelopesOf(h.sent, 'edit.request').length).toBe(0)

    // 重新 Live（重绑新端口/新实例，reqId 空间重置）：旧 reqId 仍不插入
    h.manager.testSetMode('目标笔记', 'live')
    const port2 = 'panel-10'
    h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h.sent), ok: true, portId: port2, fsPath: B_FS, docUri: B_DOC_URI, version: 3, dirty: false })
    h.manager.notifyPush({ kind: 'refEdit.push', portId: port2, fsPath: B_FS, message: { kind: 'init', sessionId: port2, docUri: B_DOC_URI, version: 3, text: TARGET_TEXT } })
    await settle()
    h.manager.notifyPush({ kind: 'refEdit.push', portId: port2, fsPath: B_FS, message: { kind: 'image.paste.result', reqId, ok: true, markdown: '![stale](x.png)' } })
    await settle()
    expect(envelopesOf(h.sent, 'edit.request').length).toBe(0)
  })

  it('Reading 态不拦截粘贴（isLiveActive 真实化，不再恒 false）', async () => {
    const h = harness()
    await bindLiveCard(h)
    h.manager.testSetMode('目标笔记', 'reading')
    const before = h.sent.length
    const ok = h.manager.testPasteImage('目标笔记', PASTE)
    expect(ok).toBe(false)
    expect(h.sent.length).toBe(before) // 无出站（含无信封）
  })
})

describe('P2-11 设置快照补发：实例创建晚于面板装载', () => {
  it('实例收到最近一次 settings 快照（粘贴总开关等实例内守卫不回退默认）', async () => {
    const PASTE = { mime: 'image/png', dataBase64: 'iVBORw0KGgo=' }
    const h = harness()
    // 面板装载期先到一次快照（彼时无实例）
    h.manager.applySettings({ 'image.paste': false })
    const { el } = await bindLiveCard(h)
    void el
    h.manager.focusEmbed('目标笔记', TARGET_TEXT.length)
    const before = h.sent.length
    // 总开关 false：粘贴被实例守卫拒绝（不出站）
    expect(h.manager.testPasteImage('目标笔记', PASTE)).toBe(false)
    expect(h.sent.length).toBe(before)
    // 快照更新为开：后续粘贴放行
    h.manager.applySettings({ 'image.paste': true })
    expect(h.manager.testPasteImage('目标笔记', PASTE)).toBe(true)
    expect(envelopesOf(h.sent, 'image.paste').length).toBe(1)
  })
})

describe('P2-11 图片弹窗实例上下文：随实例注册与注销', () => {
  it('实例在场时注册 B 身份上下文；释放后注销', async () => {
    const h = harness()
    const { el } = await bindLiveCard(h)
    void el
    h.manager.focusEmbed('目标笔记', TARGET_TEXT.length)
    const view = h.manager.focusedLive()?.getView()
    expect(view).toBeDefined()
    const ctx = imagePopupOptsOfView(view!)
    expect(ctx).toBeDefined()
    expect(ctx!.docSource()).toBe(TARGET_TEXT)
    // 导出走 A 面板通道 + B 来源（sourceDocUri）
    const before = h.sent.length
    ctx!.sendExport({ reqId: 1, src: 'res.png', fileName: 'res.png' })
    expect(h.sent.length).toBe(before + 1)
    const exportMsg = h.sent[h.sent.length - 1]!
    expect(exportMsg).toMatchObject({ kind: 'image.export', sessionId: 'panel-1', src: 'res.png' })
    expect((exportMsg as { sourceDocUri?: string }).sourceDocUri).toBe(B_FS)

    h.manager.testSetMode('目标笔记', 'reading')
    expect(imagePopupOptsOfView(view!)).toBeUndefined()
  })
})

describe('P2-14 代码卡复制：经目标端口走宿主剪贴板', () => {
  const CODE_TEXT = ['# 目标笔记', '', '```js', 'const x = 1', 'const y = 2', '```', ''].join('\n')

  /** 挂载含代码块的 B 并进入内部 Live（返回卡元素与端口 id） */
  async function bindCodeCardLive(h: Harness): Promise<HTMLElement> {
    const el = mountEmbedBlock(h.manager, '![[目标笔记]]\n')
    h.manager.notifyResult(resultOk(hoverRequestOf(h.sent), CODE_TEXT))
    h.setParentMode('live')
    h.manager.notifyBound({ kind: 'refEdit.bound', reqId: bindReqIdOf(h.sent), ok: true, portId: 'panel-9', fsPath: B_FS, docUri: B_DOC_URI, version: 2, dirty: false })
    h.manager.notifyPush({ kind: 'refEdit.push', portId: 'panel-9', fsPath: B_FS, message: { kind: 'init', sessionId: 'panel-9', docUri: B_DOC_URI, version: 2, text: CODE_TEXT } })
    await settle()
    return el
  }

  it('嵌入 Live 内代码卡复制按钮点击 → codeblock.copy 经 refEdit.message 信封出站（B 身份）', async () => {
    const h = harness()
    const el = await bindCodeCardLive(h)
    const btn = editorRootOf(el).querySelector<HTMLButtonElement>('.vsidian-code-card-copy')
    expect(btn).not.toBeNull()
    btn!.click()
    await settle()
    const envelopes = envelopesOf(h.sent, 'codeblock.copy')
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.portId).toBe('panel-9')
    expect(envelopes[0]!.fsPath).toBe(B_FS)
    expect(envelopes[0]!.message).toMatchObject({ kind: 'codeblock.copy', docUri: B_DOC_URI, text: 'const x = 1\nconst y = 2' })
  })

  it('端口释放（切 Reading）后的迟到点击不产生信封出站', async () => {
    const h = harness()
    const el = await bindCodeCardLive(h)
    h.manager.testSetMode('目标笔记', 'reading')
    await settle()
    const before = h.sent.length
    // Live 编辑器已销毁：复制按钮随编辑器消失，无信封出站
    expect(el.querySelector('.vsidian-code-card-copy')).toBeNull()
    expect(h.sent.filter((m) => m.kind === 'refEdit.message')).toHaveLength(0)
    expect(h.sent.length).toBe(before)
  })
})
