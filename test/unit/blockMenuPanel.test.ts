// @vitest-environment jsdom
// 正文右键菜单交互契约（#162）：contentDOM contextmenu 装配、块链接菜单项
// 命令（复制标题链接 = linkHeading 出站；复制块链接 = 无 id 先自动补写单笔
// edit.request 再 linkBlock 出站、有 id 直接 linkBlock 零写回）、Esc/外点/
// 命令后关闭、frontmatter 头区与阅读模式不接管、快捷键链路（keybindings.
// execute 出站 + blockLink.copy 消息入口 = 同一执行路径）、测试钩子
// （block.test.*）。菜单模型与命中判定纯函数在 blockMenu.test.ts。
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

// 块菜单挂 document.body（视口系 fixed），不随测试各自的 parent 挂载点
// 回收——逐用例清理，防止跨用例残留被 querySelector 命中；parent 挂
// body（keydown 链路需事件冒泡到 document 的捕获监听）一并回收
const mountedParents: HTMLElement[] = []
afterEach(() => {
  document.querySelectorAll('.vsidian-block-menu').forEach((el) => el.remove())
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
})

const DOC_URI = 'file:///d%3A/notes/block.md'

// 行号（0 基）：0 `---` 1 头区行 2 `---` 3 空行 4 H1 5 空行 6 段落 7 段落二行
// 8 空行 9 表格三行 12 空行 13 已有 id 的段落
const DOC = [
  '---',
  'title: 头区',
  '---',
  '',
  '# 标题甲',
  '',
  '段落甲',
  '段落甲第二行',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '已有 id 的段落 ^keep1',
].join('\n')

interface BridgeHarness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): BridgeHarness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

function mountPanel(h: BridgeHarness, text = DOC) {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  mountedParents.push(parent)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  return { c, parent }
}

const menuEl = () => document.querySelector<HTMLElement>('.vsidian-block-menu')

const menuCommands = () =>
  menuEl() ? [...menuEl()!.querySelectorAll<HTMLButtonElement>('button')]
    .map((b) => b.dataset['vsidianCommand']) : []

/** doc 偏移便捷值（与 DOC 常量对齐计算） */
const POS = {
  fmLine: DOC.indexOf('title'), // 头区行内
  heading: DOC.indexOf('# 标题甲'),
  para: DOC.indexOf('段落甲'),
  paraLine2: DOC.indexOf('段落甲第二行'),
  tableRow: DOC.indexOf('|---|---|'),
  withId: DOC.indexOf('已有 id'),
}

describe('菜单开合（contextmenu 弹出 / Esc / 外点 / 命令后关闭）', () => {
  it('block.test.contextMenu 钩子在正文块上弹出菜单（role=menu）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    expect(menuEl(), 'body 应挂载块菜单').toBeTruthy()
    expect(menuEl()!.getAttribute('role')).toBe('menu')
    expect(menuCommands()).toEqual(['copyBlockLink'])
  })

  it('标题行：两项（复制标题链接在前）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.heading })
    expect(menuCommands()).toEqual(['copyHeadingLink', 'copyBlockLink'])
  })

  it('frontmatter 头区与空行不接管（无菜单）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.fmLine })
    expect(menuEl()).toBeNull()
    const blankPos = DOC.split('\n').slice(0, 3).join('\n').length + 1
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: blankPos })
    expect(menuEl()).toBeNull()
  })

  it('Esc 关闭；菜单外 pointerdown 关闭；block.test.menuClose 钩子关闭', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menuEl(), 'Esc 后菜单应移除').toBeNull()
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    menuEl()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(menuEl(), '菜单内按下不得关闭').toBeTruthy()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(menuEl(), '外点应关闭菜单').toBeNull()
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'block.test.menuClose' })
    expect(menuEl()).toBeNull()
  })

  it('执行命令后菜单关闭', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    expect(menuEl(), '命令执行后菜单应关闭').toBeNull()
  })

  it('切阅读模式菜单关闭，且阅读态右键/快捷键入口不执行', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(menuEl(), '切模式后菜单应移除').toBeNull()
    c.handleHostMessage({ kind: 'blockLink.copy' })
    expect(h.sent.filter((m) => m.kind === 'clipboard.write')).toHaveLength(0)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('菜单打开期间文档被外部改写：命令放弃（锚点过期防御，零写回）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.para })
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, changes: [{ offset: 0, length: 0, text: 'x' }], origin: 'external',
    })
    h.sent.length = 0 // 外部变更自身的事务不属于被测对象
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    expect(h.sent.filter((m) => m.kind === 'clipboard.write')).toHaveLength(0)
    expect(menuEl(), '放弃路径也应关闭菜单').toBeNull()
  })
})

describe('复制标题链接（linkHeading 变体，宿主拼 [[笔记名#标题]]）', () => {
  it('标题取行面字面文本（含行内标记），零写回', () => {
    const h = makeBridge()
    const doc = '# 用 **重点** 说明\n\n正文\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: 0 })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyHeadingLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkHeading: { docUri: DOC_URI, heading: '用 **重点** 说明' },
    })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})

describe('复制块链接（linkBlock 变体）', () => {
  const editRequests = (h: BridgeHarness) => h.sent.filter((m) => m.kind === 'edit.request')

  it('块已有行尾 id：直接复制既有 id，零写回', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.withId })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkBlock: { docUri: DOC_URI, blockId: 'keep1' },
    })
    expect(editRequests(h)).toHaveLength(0)
  })

  it('无 id：块尾行行尾自动补写 4 位小写字母 id（单笔 edit.request，可撤销一步）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.paraLine2 })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    const edits = editRequests(h)
    expect(edits).toHaveLength(1)
    const change = edits[0]!.changes[0]!
    expect(change.offset, '写入位置 = 块尾行行尾').toBe(DOC.indexOf('段落甲第二行') + '段落甲第二行'.length)
    expect(change.length).toBe(0)
    expect(change.text).toMatch(/^ \^[a-z]{4}$/)
    expect(c.getView()!.state.doc.toString()).toContain('段落甲第二行 ^')
    // 剪贴板 id 与写入 id 一致
    const linkMsg = h.sent.find((m) => m.kind === 'clipboard.write' && 'linkBlock' in m) as
      Extract<WebviewToHost, { kind: 'clipboard.write'; linkBlock: { docUri: string; blockId: string } }>
    expect(linkMsg.linkBlock.blockId).toBe(change.text.slice(2))
    expect(linkMsg.linkBlock.docUri).toBe(DOC_URI)
  })

  it('行尾不足一个空格先补一个空格；表格按整块写入末行行尾', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: POS.tableRow })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    const text = c.getView()!.state.doc.toString()
    expect(text).toMatch(/\| 1 \| 2 \| \^[a-z]{4}$/m)
    expect(editRequests(h)).toHaveLength(1)
  })

  it('围栏块：id 写在闭围栏行行尾（Obsidian 形态）', () => {
    const h = makeBridge()
    const doc = '```js\nconst a = 1\n```\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: doc.indexOf('const') })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    expect(c.getView()!.state.doc.toString()).toMatch(/``` \^[a-z]{4}\n$/)
  })

  it('生成 id 与全文已有 id 查重（不撞车）', () => {
    const h = makeBridge()
    const doc = '已有甲 ^aaaa\n\n目标段落\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'block.test.contextMenu', pos: doc.indexOf('目标') })
    c.handleHostMessage({ kind: 'block.test.menuClick', command: 'copyBlockLink' })
    const text = c.getView()!.state.doc.toString()
    const ids = [...text.matchAll(/\^([a-z]{4})/g)].map((m) => m[1])
    expect(new Set(ids).size, '两次 id 不得重复').toBe(ids.length)
  })
})

describe('快捷键入口（同一命令的两个入口汇到同一执行）', () => {
  it('live 正文 ctrl+shift+c 出站 keybindings.execute blockCopyLink（经宿主命令回流）', () => {
    const h = makeBridge()
    const { c, parent } = mountPanel(h)
    const view = c.getView()!
    view.focus()
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'c', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))
    expect(h.sent).toContainEqual({ kind: 'keybindings.execute', id: 'blockCopyLink' })
    expect(parent.isConnected).toBe(true)
  })

  it('blockLink.copy 消息（宿主命令回流）：光标在标题行 = 复制标题链接', () => {
    const h = makeBridge()
    const doc = '# 标题行\n\n正文段\n'
    const { c } = mountPanel(h, doc)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: 0, head: 0 } })
    h.sent.length = 0
    c.handleHostMessage({ kind: 'blockLink.copy' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkHeading: { docUri: DOC_URI, heading: '标题行' },
    })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('blockLink.copy 消息：光标在普通块 = 自动补写 + 复制块链接', () => {
    const h = makeBridge()
    const doc = '# 标题行\n\n正文段落内容\n'
    const { c } = mountPanel(h, doc)
    const view = c.getView()!
    const pos = doc.indexOf('正文段落内容')
    view.dispatch({ selection: { anchor: pos, head: pos } })
    h.sent.length = 0
    c.handleHostMessage({ kind: 'blockLink.copy' })
    expect(c.getView()!.state.doc.toString()).toMatch(/正文段落内容 \^[a-z]{4}/)
    expect(h.sent.some((m) => m.kind === 'clipboard.write' && 'linkBlock' in m)).toBe(true)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })

  it('光标在 frontmatter 头区或空行：静默不执行（零写回零剪贴板）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: POS.fmLine, head: POS.fmLine } })
    c.handleHostMessage({ kind: 'blockLink.copy' })
    expect(h.sent.filter((m) => m.kind === 'clipboard.write')).toHaveLength(0)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})
