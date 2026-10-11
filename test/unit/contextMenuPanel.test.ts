// @vitest-environment jsdom
// 正文统一右键菜单交互契约（#183）：contentDOM contextmenu 全域接管装配
// （空行/普通文本/表格行/围栏内/图形块上均接管，frontmatter 头区与阅读态
// 放行原生菜单）、安全降级矩阵（结构敏感区写操作置灰）、块链接两项（自
// blockMenuPanel.test.ts 迁移，断言语义不变：复制标题链接 = linkHeading
// 出站；复制块链接 = 无 id 先自动补写单笔 edit.request 再 linkBlock 出站、
// 有 id 直接 linkBlock 零写回）、剪贴板四项（cut/copy = 选区文本桥写 +
// cut 单笔删除；paste = clipboard.read 桥往返插入；selectAll = 纯选区
// 事务）、Esc/外点/命令后关闭、锚点过期防御、测试钩子（contextMenu.test.*）。
import { describe, it, expect, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'
import {
  __resetContextMenuRegistryForTest,
  overrideContextMenuItem,
  registerContextMenuItem,
} from '../../src/shared/contextMenu'
import { activateLinkAtPos, activateLooseLinkAtPos, activateWikilinkAtPos } from '../../src/webview/liveLinks'
import { zhCn } from '../../src/shared/locales/zh-cn'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

// 统一菜单挂 document.body（视口系 fixed），不随测试各自的 parent 挂载点
// 回收——逐用例清理，防止跨用例残留被 querySelector 命中；parent 挂
// body（keydown 链路需事件冒泡到 document 的捕获监听）一并回收
const mountedParents: HTMLElement[] = []
afterEach(() => {
  document.querySelectorAll('.vsidian-context-menu').forEach((el) => el.remove())
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
  __resetContextMenuRegistryForTest()
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

const menuEl = () => document.querySelector<HTMLElement>('.vsidian-context-menu')

/** 顶级命令序列（不含子菜单项；分组容器 → 项宿主 → button 的稳定层级） */
const topCommands = () =>
  menuEl()
    ? [...menuEl()!.querySelectorAll<HTMLButtonElement>(
        '.vsidian-context-menu-group > .vsidian-context-menu-host > button')]
        .map((b) => b.dataset['vsidianCommand'])
    : []

/** 全部命令按钮（含子菜单内叶命令，DOM 序） */
const allCommands = () =>
  menuEl()
    ? [...menuEl()!.querySelectorAll<HTMLButtonElement>('button')]
        .map((b) => b.dataset['vsidianCommand'])
    : []

const buttonOf = (command: string) =>
  menuEl()?.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${command}"]`)

/** doc 偏移便捷值（与 DOC 常量对齐计算） */
const POS = {
  fmLine: DOC.indexOf('title'), // 头区行内
  heading: DOC.indexOf('# 标题甲'),
  para: DOC.indexOf('段落甲'),
  paraLine2: DOC.indexOf('段落甲第二行'),
  tableRow: DOC.indexOf('|---|---|'),
  withId: DOC.indexOf('已有 id'),
}

describe('全域接管与不接管位（contextMenu.test.contextMenu 钩子）', () => {
  it('普通段落：弹统一菜单（role=menu，三簇顶级项齐全）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(menuEl(), 'body 应挂载统一菜单').toBeTruthy()
    expect(menuEl()!.getAttribute('role')).toBe('menu')
    expect(topCommands()).toEqual([
      'wikilink', 'link', 'copyBlockLink',
      'textFormat', 'paragraphStyle', 'insert',
      'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
    ])
  })

  it('标题行：簇 1 含复制标题链接在前；空行：接管但块链接两项隐藏', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.heading })
    expect(topCommands().slice(0, 4)).toEqual([
      'wikilink', 'link', 'copyHeadingLink', 'copyBlockLink',
    ])
    const blankPos = DOC.split('\n').slice(0, 3).join('\n').length + 1
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: blankPos })
    expect(menuEl(), '空行同样接管（全域接管验收线）').toBeTruthy()
    expect(topCommands()).not.toContain('copyBlockLink')
    expect(topCommands()).not.toContain('copyHeadingLink')
  })

  it('frontmatter 头区不接管（无菜单，原生菜单照常）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.fmLine })
    expect(menuEl()).toBeNull()
  })

  it('分组线恰两条（三簇，限定顶级直接子级——子菜单内另有分组线）；子菜单按钮与叶命令同级可达', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    // jsdom 对 :scope > 支持不可靠，用 children 过滤等价判定直接子级
    const topSeps = [...menuEl()!.children].filter((el) =>
      el.classList.contains('vsidian-context-menu-separator'))
    expect(topSeps).toHaveLength(2)
    // 子菜单内的叶命令（文本格式/段落设置/插入）经 data-vsidian-command 可定位
    for (const command of ['bold', 'heading1', 'insertTable', 'clearInline']) {
      expect(allCommands(), `${command} 应在子菜单中`).toContain(command)
    }
  })
})

describe('安全降级矩阵（结构敏感区写操作置灰）', () => {
  it('表格行：新增链接两项与簇 2 全部置灰；块链接与剪贴板可用', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.tableRow })
    expect(buttonOf('wikilink')!.disabled).toBe(true)
    expect(buttonOf('link')!.disabled).toBe(true)
    expect(buttonOf('textFormat')!.disabled, '簇 2 父项置灰').toBe(true)
    expect(buttonOf('bold')!.disabled, '簇 2 子项随父置灰').toBe(true)
    expect(buttonOf('insert')!.disabled).toBe(true)
    expect(buttonOf('copyBlockLink')!.disabled).toBe(false)
    expect(buttonOf('paste')!.disabled).toBe(false)
    expect(buttonOf('selectAll')!.disabled).toBe(false)
  })

  it('围栏代码区：同表格降级；置灰项点击零写回', () => {
    const h = makeBridge()
    const doc = '```js\nconst a = 1\n```\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('const') })
    expect(buttonOf('wikilink')!.disabled).toBe(true)
    expect(buttonOf('textFormat')!.disabled).toBe(true)
    // 置灰父项点击只展开/无操作，不出站不写回
    buttonOf('textFormat')!.click()
    buttonOf('bold')!.click()
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('无选区：剪切/复制置灰；有选区：亮', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(buttonOf('cut')!.disabled).toBe(true)
    expect(buttonOf('copy')!.disabled).toBe(true)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: POS.para, head: POS.para + 3 } })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(buttonOf('cut')!.disabled).toBe(false)
    expect(buttonOf('copy')!.disabled).toBe(false)
  })
})

describe('段落设置勾选（行结构采集 + checked DOM 渲染，#184）', () => {
  /** 命令按钮的勾选三态（role / aria-checked / ✓ 槽有无） */
  const checkedOf = (command: string) => {
    const btn = buttonOf(command)
    if (!btn) {
      return null
    }
    return {
      role: btn.getAttribute('role'),
      ariaChecked: btn.getAttribute('aria-checked'),
      hasCheckSlot: !!btn.querySelector('.vsidian-context-menu-check'),
    }
  }

  it('H2 行：heading2 勾选（menuitemcheckbox + ✓ 槽）；heading1 未勾选回落 menuitem', () => {
    const h = makeBridge()
    const text = '## 二级标题\n正文'
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: 0 })
    expect(checkedOf('heading2')).toEqual({
      role: 'menuitemcheckbox', ariaChecked: 'true', hasCheckSlot: true,
    })
    const h1 = checkedOf('heading1')!
    expect(h1.role).toBe('menuitem')
    expect(h1.ariaChecked).toBeNull()
    expect(h1.hasCheckSlot).toBe(false)
  })

  it('任务行：taskList 勾选且 bulletList 不勾（族互斥）', () => {
    const h = makeBridge()
    const text = '- [ ] 待办事项'
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: text.indexOf('待办') })
    expect(checkedOf('taskList')!.ariaChecked).toBe('true')
    expect(checkedOf('bulletList')!.ariaChecked).toBeNull()
  })

  it('普通段落：正文（headingNone）勾选；quote 不勾', () => {
    const h = makeBridge()
    const { c } = mountPanel(h) // DOC 段落甲
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(checkedOf('headingNone')!.ariaChecked).toBe('true')
    expect(checkedOf('quote')!.ariaChecked).toBeNull()
  })

  it('引用行：quote 勾选', () => {
    const h = makeBridge()
    const quoted = '> 引用一行'
    const { c } = mountPanel(h, quoted)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: quoted.indexOf('引用') })
    expect(checkedOf('quote')!.ariaChecked).toBe('true')
    expect(checkedOf('headingNone')!.ariaChecked).toBeNull()
  })

  it('围栏内 # 行是代码内容：中性态不点亮任何段落勾选（采集侧约定）', () => {
    const h = makeBridge()
    const text = '```md\n# 伪标题\n```'
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: text.indexOf('# 伪') })
    for (const command of ['heading1', 'heading2', 'headingNone', 'quote', 'bulletList', 'taskList']) {
      const state = checkedOf(command)!
      expect(state.ariaChecked, `${command} 围栏内不点亮`).toBeNull()
      expect(state.hasCheckSlot, `${command} 围栏内无 ✓ 槽`).toBe(false)
    }
  })

  it('空行：不点亮任何段落勾选（含正文）', () => {
    const h = makeBridge()
    const text = '正文\n\n结尾'
    const blankPos = text.indexOf('\n\n') + 1
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: blankPos })
    expect(checkedOf('headingNone')!.ariaChecked).toBeNull()
    expect(checkedOf('quote')!.ariaChecked).toBeNull()
  })
})

describe('菜单开合（Esc / 外点 / 命令后 / 钩子关闭 / 模式切换）', () => {
  it('Esc 关闭；菜单内 pointerdown 不关闭；外点关闭；contextMenu.test.menuClose 钩子关闭', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menuEl(), 'Esc 后菜单应移除').toBeNull()
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    menuEl()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(menuEl(), '菜单内按下不得关闭').toBeTruthy()
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(menuEl(), '外点应关闭菜单').toBeNull()
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClose' })
    expect(menuEl()).toBeNull()
  })

  it('执行命令后菜单关闭；切阅读模式菜单关闭且入口不执行', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(menuEl(), '命令执行后菜单应关闭').toBeNull()
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(menuEl(), '切模式后菜单应移除').toBeNull()
    h.sent.length = 0 // 前序 copyBlockLink 的出站不属于本断言对象
    c.handleHostMessage({ kind: 'blockLink.copy' })
    expect(h.sent.filter((m) => m.kind === 'clipboard.write')).toHaveLength(0)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('菜单打开期间文档被外部改写：命令放弃（锚点过期防御，零写回）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, changes: [{ offset: 0, length: 0, text: 'x' }], origin: 'external',
    })
    h.sent.length = 0 // 外部变更自身的事务不属于被测对象
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    expect(h.sent.filter((m) => m.kind === 'clipboard.write')).toHaveLength(0)
    expect(menuEl(), '放弃路径也应关闭菜单').toBeNull()
  })

  it('还焦 prevFocus：打开前焦点在菜单外控件时，关闭还回该控件而非硬编码编辑器（review-loops 修复）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    const outside = document.createElement('button')
    outside.type = 'button'
    document.body.appendChild(outside)
    mountedParents.push(outside)
    outside.focus()
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(document.activeElement, '打开菜单应夺焦到菜单容器').not.toBe(outside)
    c.handleHostMessage({ kind: 'contextMenu.test.menuClose' })
    expect(document.activeElement, '关闭应还焦打开前的控件').toBe(outside)
  })

  it('menuClick command 含选择器元字符时不抛异常（CSS.escape 拼接安全，review-loops 修复）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(() =>
      c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'a"b]c' }),
    ).not.toThrow()
    expect(menuEl(), '未命中按钮的点击是 no-op，菜单不受影响').toBeTruthy()
  })

  it('段落设置子菜单分组线：正文+标题｜列表｜引用 两条（#183 验收反馈）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    // 定位段落设置父项宿主下的子菜单（DOM 首个 submenu 属文本格式——单组无分组线）
    const host = buttonOf('paragraphStyle')!.closest('.vsidian-context-menu-host')!
    const submenu = host.querySelector<HTMLElement>('.vsidian-context-menu-submenu')!
    // jsdom 对 :scope > 支持不可靠，用 children 过滤等价判定直接子级
    const submenuSeps = [...submenu.children].filter((el) =>
      el.classList.contains('vsidian-context-menu-separator'))
    expect(submenuSeps).toHaveLength(2)
    // 顶级三簇口径不受子菜单分组线影响（两条）
    const topSeps = [...menuEl()!.children].filter((el) =>
      el.classList.contains('vsidian-context-menu-separator'))
    expect(topSeps).toHaveLength(2)
  })
})

describe('剪贴板四项（宿主桥链路）', () => {
  // tsconfig target 低于 es2023（无 findLast）——倒序找最后一条
  const lastOf = <T>(arr: readonly T[], pred: (item: T) => boolean): T | undefined => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (pred(arr[i]!)) {
        return arr[i]
      }
    }
    return undefined
  }

  it('copy：选区文本经 clipboard.write 直写，零写回', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.getView()!.dispatch({ selection: { anchor: POS.para, head: POS.para + 3 } })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copy' })
    expect(h.sent).toContainEqual({ kind: 'clipboard.write', text: '段落甲' })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    expect(c.getView()!.state.doc.toString()).toBe(DOC)
  })

  it('cut：桥写选区文本后单笔事务删选区（一笔 edit.request）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.getView()!.dispatch({ selection: { anchor: POS.para, head: POS.para + 3 } })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'cut' })
    expect(h.sent).toContainEqual({ kind: 'clipboard.write', text: '段落甲' })
    const edits = h.sent.filter((m) => m.kind === 'edit.request')
    expect(edits).toHaveLength(1)
    expect(edits[0]!.changes[0]).toEqual({ offset: POS.para, length: 3, text: '' })
    // 删除 3 字符后「段落甲」只在「段落甲第二行」中出现一次（原两次）
    expect(c.getView()!.state.doc.toString().match(/段落甲/g)).toHaveLength(1)
  })

  it('paste：clipboard.read 出站 → 宿主回包 → 光标处单笔插入；陈旧 reqId 丢弃', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.getView()!.dispatch({ selection: { anchor: POS.para, head: POS.para } })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'paste' })
    const read = lastOf(h.sent, (m) => m.kind === 'clipboard.read') as
      Extract<WebviewToHost, { kind: 'clipboard.read' }>
    expect(read, '粘贴应经宿主剪贴板读桥').toBeTruthy()
    // 陈旧回包（伪造旧 reqId）不生效
    c.handleHostMessage({ kind: 'clipboard.read.result', reqId: read.reqId - 1, ok: true, text: '旧包' })
    expect(c.getView()!.state.doc.toString()).toBe(DOC)
    // 真实回包：光标处插入（选区零宽 → 原 pos 起插入）
    c.handleHostMessage({ kind: 'clipboard.read.result', reqId: read.reqId, ok: true, text: '插入文本' })
    expect(c.getView()!.state.doc.toString()).toContain('插入文本段落甲')
    const edits = h.sent.filter((m) => m.kind === 'edit.request')
    expect(edits).toHaveLength(1)
    // 再次粘贴（新 reqId）：旧 reqId 回包丢弃
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'paste' })
    const read2 = lastOf(h.sent, (m) => m.kind === 'clipboard.read') as
      Extract<WebviewToHost, { kind: 'clipboard.read' }>
    c.handleHostMessage({ kind: 'clipboard.read.result', reqId: read.reqId, ok: true, text: '旧包' })
    expect(c.getView()!.state.doc.toString()).not.toContain('旧包')
    expect(read2.reqId).toBeGreaterThan(read.reqId)
  })

  it('selectAll：CM6 纯选区事务（零写回，全文选中）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'selectAll' })
    const sel = c.getView()!.state.selection.main
    expect(sel.from).toBe(0)
    expect(sel.to).toBe(DOC.length)
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})

describe('格式命令与插入表格（复用快速操作条执行路径）', () => {
  it('menuClick bold（子菜单项）：走 runFormatOperation 同一路径，写回一笔', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: POS.para, head: POS.para + 3 } })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'bold' })
    expect(c.getView()!.state.doc.toString()).toContain('**段落甲**')
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })

  it('menuClick insertTable：与快速操作条建表同源入口（光标处建表写回）', () => {
    const h = makeBridge()
    const doc = '正文一行\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: 0 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'insertTable' })
    expect(c.getView()!.state.doc.toString()).toContain('| --- | --- |')
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })
})

describe('handler 承载（覆写语义：分派先查运行期 handler，未命中走内置白名单）', () => {
  it('注册带 handler 的新命令：菜单渲染该项且 menuClick 执行 handler（零内置出站）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    let calls = 0
    const cleanup = registerContextMenuItem({
      id: 'customTool', group: 'link', order: 99,
      command: 'customTool', labelKey: 'contextMenu.copy',
      handler: () => { calls++ },
    }, 'test-extension')
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    expect(topCommands(), '注册项应渲染进菜单').toContain('customTool')
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'customTool' })
    expect(calls, 'handler 应被执行').toBe(1)
    expect(h.sent.filter((m) => m.kind === 'edit.request' || m.kind === 'clipboard.write'),
      '运行期命令不走内置编辑/剪贴板出站').toHaveLength(0)
    expect(menuEl(), '命令执行后菜单关闭').toBeNull()
    cleanup()
    __resetContextMenuRegistryForTest()
  })

  it('覆写内置 id 的 handler：替换执行体（内置格式路径不触发）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: POS.para, head: POS.para + 3 } })
    let calls = 0
    expect(overrideContextMenuItem('bold', { handler: () => { calls++ } }, 'ext-a')).toBe(true)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'bold' })
    expect(calls, '覆写 handler 替换内置执行体').toBe(1)
    expect(c.getView()!.state.doc.toString(), '内置格式路径不触发（无 ** 写回）').not.toContain('**段落甲**')
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
    __resetContextMenuRegistryForTest()
  })

  it('无 handler 非白名单命令：console.warn 不抛错（不再静默）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    registerContextMenuItem({
      id: 'ghostTool', group: 'link', order: 98,
      command: 'ghostTool', labelKey: 'contextMenu.copy',
    }, 'test-extension')
    const warns: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(String(args[0])) }
    try {
      c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.para })
      c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'ghostTool' })
    } finally {
      console.warn = originalWarn
    }
    expect(warns.some((w) => w.includes('ghostTool')), '应 warn 命令名（开发期可见）').toBe(true)
    expect(menuEl(), '未知命令路径也应关闭菜单').toBeNull()
    __resetContextMenuRegistryForTest()
  })
})

describe('复制标题链接（linkHeading 变体，宿主拼 [[笔记名#标题]]）', () => {
  it('标题取行面字面文本（含行内标记），零写回', () => {
    const h = makeBridge()
    const doc = '# 用 **重点** 说明\n\n正文\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: 0 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyHeadingLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkHeading: { docUri: DOC_URI, heading: '用 **重点** 说明' },
    })
    expect(h.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})

describe('复制块链接（linkBlock 变体，自 blockMenuPanel 迁移）', () => {
  const editRequests = (h: BridgeHarness) => h.sent.filter((m) => m.kind === 'edit.request')

  it('块已有行尾 id：直接复制既有 id，零写回', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.withId })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkBlock: { docUri: DOC_URI, blockId: 'keep1' },
    })
    expect(editRequests(h)).toHaveLength(0)
  })

  it('无 id：块尾行后空一行写独立行 ^id（Obsidian 默认形态，单笔 edit.request，可撤销一步）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.paraLine2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    const edits = editRequests(h)
    expect(edits).toHaveLength(1)
    const change = edits[0]!.changes[0]!
    expect(change.offset, '写入位置 = 块尾行行尾').toBe(DOC.indexOf('段落甲第二行') + '段落甲第二行'.length)
    expect(change.length).toBe(0)
    expect(change.text).toMatch(/^\n\n\^[a-z0-9]{6}$/)
    expect(c.getView()!.state.doc.toString()).toContain('段落甲第二行\n\n^')
    // 剪贴板 id 与写入 id 一致
    const linkMsg = h.sent.find((m) => m.kind === 'clipboard.write' && 'linkBlock' in m) as
      Extract<WebviewToHost, { kind: 'clipboard.write'; linkBlock: { docUri: string; blockId: string } }>
    expect(linkMsg.linkBlock.blockId).toBe(change.text.slice(3))
    expect(linkMsg.linkBlock.docUri).toBe(DOC_URI)
  })

  it('块已有独立行 id（空行隔开，用户手写形态）：直接复用零写回', () => {
    const h = makeBridge()
    const doc = '---\ntitle: 头区\n---\n\n目标段落\n\n^keepstd\n\n后文\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('目标段落') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkBlock: { docUri: DOC_URI, blockId: 'keepstd' },
    })
    expect(editRequests(h)).toHaveLength(0)
  })

  it('块已有紧贴独立行 id：直接复用零写回', () => {
    const h = makeBridge()
    const doc = '---\ntitle: 头区\n---\n\n目标段落\n^keeptight\n\n后文\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('目标段落') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(h.sent).toContainEqual({
      kind: 'clipboard.write',
      linkBlock: { docUri: DOC_URI, blockId: 'keeptight' },
    })
    expect(editRequests(h)).toHaveLength(0)
  })

  it('表格按整块：块尾行后空一行写独立行 ^id', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: POS.tableRow })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    const text = c.getView()!.state.doc.toString()
    expect(text).toMatch(/\| 1 \| 2 \|\n\n\^[a-z0-9]{6}$/m)
    expect(editRequests(h)).toHaveLength(1)
  })

  it('围栏块：id 写在闭围栏行后空一行独立行（新默认形态）', () => {
    const h = makeBridge()
    const doc = '```js\nconst a = 1\n```\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('const') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    expect(c.getView()!.state.doc.toString()).toMatch(/```\n\n\^[a-z0-9]{6}\n/)
  })

  it('生成 id 与全文已有 id 查重（不撞车；行尾与独立行形态都进查重域）', () => {
    const h = makeBridge()
    // 两个既有 id 分属别的块（行尾形态 + 独立行形态），目标段落自身无 id
    const doc = '已有甲 ^aaaaaa\n\n目标段落\n\n后文块\n\n^bbbbbb\n'
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('目标段落') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyBlockLink' })
    const text = c.getView()!.state.doc.toString()
    const ids = [...text.matchAll(/\^([a-z0-9]{6})/g)].map((m) => m[1])
    expect(ids.length, '应有三个 6 位 id（两个既有 + 一个生成）').toBe(3)
    expect(new Set(ids).size, 'id 不得重复').toBe(ids.length)
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
    expect(c.getView()!.state.doc.toString()).toMatch(/正文段落内容\n\n\^[a-z0-9]{6}/)
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

// ---- #439 链接场景三项（打开链接 / 复制链接地址 / 复制显示文字）----

describe('链接场景三项：呈现与显隐（#439）', () => {
  const LINK_DOC = [
    '---',
    'title: 头区',
    '---',
    '',
    '看 [[双链 笔记|别名]] 尾',
    '',
    '普通段落一行',
    '',
  ].join('\n')

  it('链接文字上：三项呈现于簇 1 顶部且可用；措辞键与块链接两项区分', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, LINK_DOC)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: LINK_DOC.indexOf('别名') })
    expect(topCommands().slice(0, 6)).toEqual([
      'openLink', 'copyLinkAddress', 'copyLinkText',
      'wikilink', 'link', 'copyBlockLink',
    ])
    for (const command of ['openLink', 'copyLinkAddress', 'copyLinkText']) {
      expect(buttonOf(command)!.disabled, `${command} enable 恒可用`).toBe(false)
    }
    // 措辞红线（CONTEXT.md 术语约束）：新词条不得泛称「复制链接」——jsdom
    // 无语言岛时标签回退键名，中文措辞直接对拍语言包词条
    const texts = [...menuEl()!.querySelectorAll('.vsidian-context-menu-label')]
      .map((el) => el.textContent ?? '')
    expect(texts).toContain('contextMenu.openLink')
    expect(texts).toContain('contextMenu.copyLinkAddress')
    expect(texts).toContain('contextMenu.copyLinkText')
    expect(zhCn['contextMenu.openLink']).toBe('打开链接')
    expect(zhCn['contextMenu.copyLinkAddress']).toBe('复制链接地址')
    expect(zhCn['contextMenu.copyLinkText']).toBe('复制显示文字')
    expect(Object.values(zhCn).some((v) => v === '复制链接'), '语言包不得出现泛称「复制链接」词条').toBe(false)
  })

  it('普通文本与空行：三项不显示（无命中隐藏而非置灰）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, LINK_DOC)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: LINK_DOC.indexOf('普通段落') })
    expect(topCommands()).not.toContain('openLink')
    expect(topCommands()).not.toContain('copyLinkAddress')
    expect(topCommands()).not.toContain('copyLinkText')
    const blankPos = LINK_DOC.split('\n').slice(0, 3).join('\n').length + 1
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: blankPos })
    expect(topCommands()).not.toContain('openLink')
  })

  it('表格格内链接不接三项（zone=table 维持降级矩阵简化）', () => {
    const text = '| [[格内链]] | b |\n|---|---|\n| 1 | 2 |'
    const h = makeBridge()
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: text.indexOf('格内链') })
    expect(allCommands()).not.toContain('openLink')
    expect(allCommands()).not.toContain('copyLinkAddress')
    expect(allCommands()).not.toContain('copyLinkText')
  })

  it('裸 URL 文本按普通正文处理（不识别为链接，三项不显示）', () => {
    const text = '裸 https://example.com/a 尾'
    const h = makeBridge()
    const { c } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: text.indexOf('example') })
    expect(topCommands()).not.toContain('openLink')
  })
})

describe('链接场景三项：打开链接与 Ctrl+单击同构（#439）', () => {
  /** 与 Ctrl+单击判定族同源的期望载荷收集：activate 族回调只收集不上报，
   *  菜单出站消息须与之同 kind 同载荷（jsdom 无布局，真实 Ctrl+单击路径
   *  的同构对拍在浏览器套件） */
  const cases: Array<[string, 'wikilink.activate' | 'link.activate', (doc: string) => number]> = [
    ['看 [[双链 笔记|别名]] 尾', 'wikilink.activate', (doc) => doc.indexOf('别名')],
    ['看 [链接文字](https://example.com/a%20b?q=1) 尾', 'link.activate', (doc) => doc.indexOf('链接文字')],
    ['见 <https://example.com/auto> 尾', 'link.activate', (doc) => doc.indexOf('auto')],
    ['开 [文字段](my note.md) 尾', 'link.activate', (doc) => doc.indexOf('文字段')],
  ]

  for (const [docLine, expectedKind, posOf] of cases) {
    it(`${expectedKind}：menuClick openLink 出站与 activate 判定族同构（${docLine.slice(0, 12)}…）`, async () => {
      const h = makeBridge()
      const { c } = mountPanel(h, `${docLine}\n`)
      const view = c.getView()!
      const pos = posOf(docLine)
      // 期望载荷：activate 族收集回调（零副作用查询，与 Ctrl+单击同一判定内核）
      let expected: { target?: string; href?: string; from: number; to: number } | null = null
      activateWikilinkAtPos(view, pos, (target, from, to) => { expected = { target, from, to } })
      if (!expected) {
        activateLinkAtPos(view, pos, (href, from, to) => { expected = { href, from, to } }) ||
          activateLooseLinkAtPos(view, pos, (href, from, to) => { expected = { href, from, to } })
      }
      expect(expected, '前置：光标处应命中链接（activate 判定族）').not.toBeNull()
      c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos })
      c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'openLink' })
      const activate = h.sent.find((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate')
      expect(activate, '应出站激活消息').toBeTruthy()
      expect(activate!.kind).toBe(expectedKind)
      expect(expectedKind === 'wikilink.activate' ? (activate as { target: string }).target
        : (activate as { href: string }).href).toBe(
          expectedKind === 'wikilink.activate' ? expected!.target : expected!.href)
      expect((activate as { srcStart: number }).srcStart).toBe(expected!.from)
      expect((activate as { srcEnd: number }).srcEnd).toBe(expected!.to)
      expect((activate as { sessionId: string }).sessionId).toBeTruthy()
      expect((activate as { docUri: string }).docUri).toBe(DOC_URI)
      expect(menuEl(), '命令执行后菜单关闭').toBeNull()
    })
  }

  it('无命中直发 openLink（防覆写层放开 when 的直发路径）：零出站', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, '普通段落\n')
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: 0 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'openLink' })
    expect(h.sent.filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate'
      || m.kind === 'clipboard.write')).toHaveLength(0)
  })

  it('执行前重验：菜单打开期间文档被外部改写，openLink 放弃（零出站）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, '看 [[目标笔记]] 尾\n')
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: 4 })
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, changes: [{ offset: 0, length: 0, text: 'x' }], origin: 'external',
    })
    h.sent.length = 0
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'openLink' })
    expect(h.sent.filter((m) => m.kind === 'wikilink.activate' || m.kind === 'clipboard.write')).toHaveLength(0)
    expect(menuEl(), '放弃路径也应关闭菜单').toBeNull()
  })
})

describe('链接场景三项：复制取材与键位入口（#439）', () => {
  it('复制链接地址：双链 target 未 trim、外部 href 原样不解码', () => {
    const wiki = '看 [[双链 笔记 |别名]] 尾\n'
    const h = makeBridge()
    const { c } = mountPanel(h, wiki)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: wiki.indexOf('别名') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyLinkAddress' })
    expect(h.sent).toContainEqual({ kind: 'clipboard.write', text: '双链 笔记 ' })

    const ext = '看 [链接文字](https://example.com/a%20b?q=1) 尾\n'
    const h2 = makeBridge()
    const { c: c2 } = mountPanel(h2, ext)
    c2.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: ext.indexOf('链接文字') })
    c2.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyLinkAddress' })
    expect(h2.sent).toContainEqual({ kind: 'clipboard.write', text: 'https://example.com/a%20b?q=1' })
  })

  it('复制显示文字：双链别名优先 / 普通链接链接文字', () => {
    const wiki = '看 [[双链 笔记|别名]] 尾\n'
    const h = makeBridge()
    const { c } = mountPanel(h, wiki)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: wiki.indexOf('别名') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyLinkText' })
    expect(h.sent).toContainEqual({ kind: 'clipboard.write', text: '别名' })

    const ext = '看 [链接文字](https://example.com/a) 尾\n'
    const h2 = makeBridge()
    const { c: c2 } = mountPanel(h2, ext)
    c2.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: ext.indexOf('链接文字') })
    c2.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyLinkText' })
    expect(h2.sent).toContainEqual({ kind: 'clipboard.write', text: '链接文字' })
    // 复制零写回
    expect(h2.sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })

  it('键位入口：绑定后光标在双链上按键 → 同一执行体出站（无命中静默）', () => {
    const text = '看 [[目标 笔记]] 与普通段 尾\n'
    const h = makeBridge()
    const { c, parent } = mountPanel(h, text)
    c.handleHostMessage({ kind: 'keybindings.snapshot', overrides: { openLink: ['ctrl+alt+o'] } })
    const view = c.getView()!
    view.dispatch({ selection: { anchor: text.indexOf('目标'), head: text.indexOf('目标') } })
    view.focus()
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'o', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }))
    expect(h.sent).toContainEqual({
      kind: 'wikilink.activate',
      sessionId: 's1',
      docUri: DOC_URI,
      target: '目标 笔记',
      srcStart: text.indexOf('[['),
      srcEnd: text.indexOf(']]') + 2,
    })
    // 无命中（光标在普通文本）：零出站
    h.sent.length = 0
    view.dispatch({ selection: { anchor: text.indexOf('普通段'), head: text.indexOf('普通段') } })
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'o', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }))
    expect(h.sent.filter((m) => m.kind === 'wikilink.activate' || m.kind === 'link.activate')).toHaveLength(0)
    expect(parent.isConnected).toBe(true)
  })
})

// ---- #436 场景命中负载（采集层：contextSnapshotAt 的三类负载）----

import { type MenuContextSnapshot } from '../../src/shared/contextMenu'
import { selectTableRegion, tableRegionField } from '../../src/webview/tableRegionSelection'

describe('场景命中负载采集（表格/链接/图形块进快照，#436）', () => {
  /** 打开菜单并捕获快照探针：注册一个 when 恒隐藏的临时项（不改变菜单
   *  呈现），openContextMenu → buildContextMenuModel 求值 when 时捕获的
   *  ctx 即控制器收到的同一份快照引用 */
  function snapshotAt(c: ReturnType<typeof mountPanel>['c'], pos: number): MenuContextSnapshot | null {
    let captured: MenuContextSnapshot | null = null
    const cleanup = registerContextMenuItem({
      id: '__snapshotProbe436', group: 'clipboard', order: 99,
      command: '__snapshotProbe436', labelKey: 'contextMenu.copy',
      when: (ctx) => { captured = ctx; return false },
    })
    try {
      c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos })
    } finally {
      cleanup()
    }
    return captured
  }

  describe('表格负载（zone=table）', () => {
    const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'

    it('命中数据行：内容行/列坐标、行列总数、行区间与顶层层级', () => {
      const pos = TABLE.indexOf('| 3 |') + 2 // `3` 字符处
      const h = makeBridge()
      const { c } = mountPanel(h, TABLE)
      const snap = snapshotAt(c, pos)!
      expect(snap.zone).toBe('table')
      expect(snap.table).toEqual({
        rowIndex: 2, columnIndex: 0, inHeader: false,
        rowCount: 3, columnCount: 2,
        lines: { start: 0, end: 3 },
        pos,
        quoteUniform: true, quoteDepth: 0, hitQuoteDepth: 0,
      })
      expect(snap.link, '结构敏感区不采链接').toBeUndefined()
      expect(snap.graphic).toBeUndefined()
    })

    it('命中表头：rowIndex=0；命中列随命中位置', () => {
      const h = makeBridge()
      const { c } = mountPanel(h, TABLE)
      const snap = snapshotAt(c, TABLE.indexOf('b |') + 1)!
      expect(snap.table!.rowIndex).toBe(0)
      expect(snap.table!.inHeader).toBe(true)
      expect(snap.table!.columnIndex).toBe(1)
    })

    it('命中分隔行：无内容行身份（rowIndex/columnIndex null），快照仍构造', () => {
      const h = makeBridge()
      const { c } = mountPanel(h, TABLE)
      const snap = snapshotAt(c, TABLE.indexOf('---'))!
      expect(snap.zone).toBe('table')
      expect(snap.table!.rowIndex).toBeNull()
      expect(snap.table!.columnIndex).toBeNull()
      expect(snap.table!.inHeader).toBe(false)
      expect(snap.table!.rowCount).toBe(3)
    })

    it('引用内表格：层级一致 1 层（quoteDepthOfLine 口径）', () => {
      const quoted = '> | a | b |\n> |---|---|\n> | 1 | 2 |'
      const h = makeBridge()
      const { c } = mountPanel(h, quoted)
      const snap = snapshotAt(c, quoted.indexOf('1'))!
      expect(snap.table).toMatchObject({
        rowIndex: 1, quoteUniform: true, quoteDepth: 1, hitQuoteDepth: 1,
      })
    })

    it('gridPlans 缓存缺失回退：引用表列数按分隔行声明（前缀剥离后解析）', () => {
      // 表外一次编辑 → liveDecorations 增量重建换新 Map（未重建的表不在
      // 缓存）→ 采集走 parseTableDelimiter 回退分支（review F1 回归钉住）
      const quoted = '> | a | b |\n> |---|---|\n> | 1 | 2 |\n\n表外段落'
      const h = makeBridge()
      const { c } = mountPanel(h, quoted)
      const view = c.getView()!
      const outside = quoted.indexOf('表外段落')
      view.dispatch({ changes: { from: outside, to: outside, insert: '前' } })
      const snap = snapshotAt(c, quoted.indexOf('1'))!
      expect(snap.table, '回退解析失败会整体缺省——树接管时负载应在场').toBeDefined()
      expect(snap.table!.columnCount).toBe(2)
      expect(snap.table!.columnIndex).toBe(0)
      expect(snap.table!.quoteDepth).toBe(1)
    })

    it('列钳制：行首落首列、行尾落末列（越出格区钳到最近格）', () => {
      const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |'
      const h = makeBridge()
      const { c } = mountPanel(h, TABLE)
      const view = c.getView()!
      const lastLine = view.state.doc.lineAt(TABLE.length) // 末数据行
      const head = snapshotAt(c, TABLE.indexOf('| a'))! // 行首管道前 → 首列
      expect(head.table!.columnIndex).toBe(0)
      const tail = snapshotAt(c, lastLine.to)! // 行尾（末管道上）→ 末列
      expect(tail.table!.columnIndex).toBe(1)
    })

    it('源码降级表（分隔行在组尾，树不认）：负载缺省不阻塞菜单', () => {
      const degraded = '| a | b |\n| 1 | 2 |\n|---|---|'
      const h = makeBridge()
      const { c } = mountPanel(h, degraded)
      const snap = snapshotAt(c, degraded.indexOf('1'))
      expect(snap, '快照仍构造（zone 形态学判定）').not.toBeNull()
      expect(snap!.zone).toBe('table')
      expect(snap!.table, '树解析失败负载缺省').toBeUndefined()
    })
  })

  describe('链接负载（zone=normal）', () => {
    it('双链含别名：kind/target 未 trim/display 别名优先', () => {
      const text = '看 [[笔记 一|显示名]] 尾'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('显示名'))!
      expect(snap.link).toEqual({
        kind: 'wikilink',
        target: '笔记 一',
        display: '显示名',
        range: { from: text.indexOf('[['), to: text.indexOf(']]') + 2 },
      })
    })

    it('普通链接：href 原样 + 链接文字', () => {
      const text = '前 [链接文字](https://example.com/x?y=1) 后'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('链接文字'))!
      expect(snap.link).toEqual({
        kind: 'link',
        target: 'https://example.com/x?y=1',
        display: '链接文字',
        range: { from: text.indexOf('['), to: text.indexOf(')') + 1 },
      })
    })

    it('autolink：URL 本身即显示文字', () => {
      const text = '见 <https://example.com/a> 尾'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('example'))!
      expect(snap.link).toEqual({
        kind: 'autolink',
        target: 'https://example.com/a',
        display: 'https://example.com/a',
        range: { from: text.indexOf('<'), to: text.indexOf('>') + 1 },
      })
    })

    it('宽松链接（目标含空格）：文字段为显示文字', () => {
      const text = '开 [文字段](my note.md) 尾'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('文字段'))!
      expect(snap.link).toEqual({
        kind: 'loose',
        target: 'my note.md',
        display: '文字段',
        range: { from: text.indexOf('['), to: text.indexOf(')') + 1 },
      })
    })

    it('裸 URL 不命中；嵌入 ![[…]] 不采集（守卫排除前置 !）', () => {
      const bare = '裸 https://example.com/a 尾'
      const h = makeBridge()
      const { c } = mountPanel(h, bare)
      expect(snapshotAt(c, bare.indexOf('example'))!.link).toBeUndefined()

      const embed = '嵌 ![[嵌入目标]] 尾'
      const h2 = makeBridge()
      const { c: c2 } = mountPanel(h2, embed)
      expect(snapshotAt(c2, embed.indexOf('嵌入目标'))!.link, '嵌入不产生链接负载').toBeUndefined()
    })

    it('行内代码内链接文本不采集（inlineScanSuppressed 同口径）', () => {
      const text = '码 `[t](u)` 尾'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('(u)'))!
      expect(snap.zone).toBe('normal')
      expect(snap.link).toBeUndefined()
    })

    it('表格格内链接不采集链接负载（zone=table 优先）', () => {
      const text = '| [[格内链]] | b |\n|---|---|\n| 1 | 2 |'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('格内链'))!
      expect(snap.zone).toBe('table')
      expect(snap.link).toBeUndefined()
    })
  })

  describe('图形块负载（zone=graphic）', () => {
    it('mermaid 渲染态：行区间/语言/源码/svg 能力', () => {
      const text = '```mermaid\ngraph TD\nA-->B\n```'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('graph'))!
      expect(snap.zone).toBe('graphic')
      expect(snap.graphic).toEqual({
        lines: { start: 0, end: 3 },
        language: 'mermaid',
        code: 'graph TD\nA-->B',
        svgExport: true, // 内置 mermaid 恒有 renderSvg
      })
      expect(snap.link).toBeUndefined()
      expect(snap.table).toBeUndefined()
    })

    it('mermaid 错误态源码：负载数据面同构（能力 ≠ 渲染成功）', () => {
      const text = '```mermaid\nthis is ( not [ valid\n```'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('valid'))!
      expect(snap.graphic).toEqual({
        lines: { start: 0, end: 2 },
        language: 'mermaid',
        code: 'this is ( not [ valid',
        svgExport: true,
      })
    })

    it('未闭合图形围栏：区间到末行、源码取到末行（closed=false 分支）', () => {
      const text = '```mermaid\ngraph TD\nA-->B'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('graph'))!
      expect(snap.graphic).toEqual({
        lines: { start: 0, end: 2 },
        language: 'mermaid',
        code: 'graph TD\nA-->B',
        svgExport: true,
      })
    })

    it('普通围栏（zone=fence）无任何场景负载', () => {
      const text = '```js\nconst a = 1\n```'
      const h = makeBridge()
      const { c } = mountPanel(h, text)
      const snap = snapshotAt(c, text.indexOf('const'))!
      expect(snap.zone).toBe('fence')
      expect(snap.graphic).toBeUndefined()
      expect(snap.link).toBeUndefined()
      expect(snap.table).toBeUndefined()
    })
  })

  it('执行期通道：打开菜单持有完整快照（含负载），关闭即清理（#436）', () => {
    const text = '```mermaid\ngraph TD\n```'
    const h = makeBridge()
    const { c } = mountPanel(h, text)
    expect(c.getContextMenuSnapshot()).toBeNull()
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: text.indexOf('graph') })
    const held = c.getContextMenuSnapshot()
    expect(held?.zone).toBe('graphic')
    expect(held?.graphic?.language).toBe('mermaid')
    c.handleHostMessage({ kind: 'contextMenu.test.menuClose' })
    expect(c.getContextMenuSnapshot()).toBeNull()
  })
})

// ---- #437 表格专属簇：执行链（菜单注入通道逐项执行——结构/删除/选择/复制/层级）----

describe('表格专属簇执行链（#437）', () => {
  const TOP = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'
  const QUOTED = '> | a | b |\n> |---|---|\n> | 1 | 2 |'
  const editRequests = (h: BridgeHarness) => h.sent.filter((m) => m.kind === 'edit.request')
  const clipboardWrites = (h: BridgeHarness) =>
    h.sent.filter((m) => m.kind === 'clipboard.write' && typeof (m as { text?: string }).text === 'string')
  const CLUSTER = ['insertRowAbove', 'insertRowBelow', 'insertColumnLeft', 'insertColumnRight',
    'deleteRow', 'deleteColumn', 'deleteTable', 'selectTableRow', 'selectTableColumn',
    'selectWholeTable', 'copyTableMarkdown', 'tableQuoteRemove', 'tableQuoteAdd']

  it('表格区开菜单：tableOps 簇 13 项在场（顶层表 quoteRemove 置灰），项序与簇位正确', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 3 |') + 2 })
    expect(topCommands()).toEqual([
      'wikilink', 'link', 'copyBlockLink',
      ...CLUSTER,
      'textFormat', 'paragraphStyle', 'insert',
      'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
    ])
    expect(buttonOf('tableQuoteRemove')!.disabled, '顶层表 0 层不可减').toBe(true)
    expect(buttonOf('tableQuoteAdd')!.disabled).toBe(false)
    expect(buttonOf('deleteTable')!.disabled).toBe(false)
  })

  it('结构项：命中数据行执行 insertRowAbove——命中行上方插空行，单笔写回', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 3 |') + 2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'insertRowAbove' })
    expect(c.getView()!.state.doc.toString())
      .toBe('| a | b |\n|---|---|\n| 1 | 2 |\n| | |\n| 3 | 4 |')
    expect(editRequests(h)).toHaveLength(1)
    expect(menuEl(), '命令执行后菜单关闭').toBeNull()
  })

  it('结构项：insertColumnRight 在命中列右插列（表格形状正确）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('a') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'insertColumnRight' })
    // 分隔行新列段沿用既有引擎最小插入形态（` --- ` 带空格）
    expect(c.getView()!.state.doc.toString())
      .toBe('| a | | b |\n|---| --- |---|\n| 1 | | 2 |\n| 3 | | 4 |')
    expect(editRequests(h)).toHaveLength(1)
  })

  it('删除表格：整表层单笔删除，前后正文保留', () => {
    const doc = `前文\n\n${TOP}\n\n后文`
    const h = makeBridge()
    const { c } = mountPanel(h, doc)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: doc.indexOf('| 1 |') + 2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'deleteTable' })
    expect(c.getView()!.state.doc.toString()).toBe('前文\n\n\n\n后文')
    expect(editRequests(h)).toHaveLength(1)
  })

  it('选择行：格区 region 落命中行全列（零写回），选择整表同理', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    const view = c.getView()!
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 3 |') + 2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'selectTableRow' })
    const region = view.state.field(tableRegionField, false)
    expect(region).toMatchObject({
      tableFrom: 0, rowFrom: 2, rowTo: 2, columnFrom: 0, columnTo: 1,
    })
    expect(editRequests(h)).toHaveLength(0)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('a') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'selectWholeTable' })
    expect(view.state.field(tableRegionField, false)).toMatchObject({
      tableFrom: 0, rowFrom: 0, rowTo: 2, columnFrom: 0, columnTo: 1,
    })
    expect(editRequests(h)).toHaveLength(0)
  })

  it('复制表格 Markdown：无活跃格区 → 整表（含重造表头）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 3 |') + 2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyTableMarkdown' })
    expect(clipboardWrites(h)).toEqual([{
      kind: 'clipboard.write',
      text: '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
    }])
    expect(editRequests(h)).toHaveLength(0)
  })

  it('复制优先语义：活跃格区包含命中格 → 复制格区；不含命中格 → 整表', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    const view = c.getView()!
    // 活跃格区：数据行 1-2 × 全列（selectTableRegion 同通道建立——蒙版态）
    selectTableRegion(view, {
      tableFrom: 0, rowFrom: 1, rowTo: 2, columnFrom: 0, columnTo: 1,
    })
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 3 |') + 2 })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyTableMarkdown' })
    expect(clipboardWrites(h).map((m) => (m as { text: string }).text))
      .toEqual(['| 1 | 2 |\n| --- | --- |\n| 3 | 4 |'])
    // 命中表头行（不在格区内）→ 回落整表
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('a') })
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'copyTableMarkdown' })
    const texts = clipboardWrites(h).map((m) => (m as { text: string }).text)
    expect(texts[1]).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
  })

  it('引用层级：增一层/减一层逐行独立变换，各一笔事务（单层引用表往返）', () => {
    // 增层：单次派发 = 单笔 edit.request（一次菜单操作 = 宿主撤销一次）
    const h = makeBridge()
    const { c } = mountPanel(h, QUOTED)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: QUOTED.indexOf('1') })
    expect(buttonOf('tableQuoteRemove')!.disabled).toBe(false)
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'tableQuoteAdd' })
    const added = c.getView()!.state.doc.toString()
    expect(added).toBe('> > | a | b |\n> > |---|---|\n> > | 1 | 2 |')
    expect(editRequests(h)).toHaveLength(1)
    // 减层：独立挂载（两次快速派发会被出站去抖合并成一条消息——粒度按
    // 每次菜单操作单独钉），往返还原原文
    const h2 = makeBridge()
    const { c: c2 } = mountPanel(h2, added)
    c2.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: added.indexOf('1') })
    c2.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'tableQuoteRemove' })
    expect(c2.getView()!.state.doc.toString()).toBe(QUOTED)
    expect(editRequests(h2)).toHaveLength(1)
  })

  it('源码降级表（树不认）：簇在场全置灰，点击零写回', () => {
    const degraded = '| a | b |\n| 1 | 2 |\n|---|---|'
    const h = makeBridge()
    const { c } = mountPanel(h, degraded)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: degraded.indexOf('1') })
    for (const command of CLUSTER) {
      expect(buttonOf(command)!.disabled, `${command} 解析失败置灰不隐藏`).toBe(true)
    }
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'deleteTable' })
    expect(editRequests(h)).toHaveLength(0)
    expect(clipboardWrites(h)).toHaveLength(0)
  })

  it('锚点过期防御：菜单打开期间外部改文档，deleteTable 放弃执行（零写回）', () => {
    const h = makeBridge()
    const { c } = mountPanel(h, TOP)
    c.handleHostMessage({ kind: 'contextMenu.test.contextMenu', pos: TOP.indexOf('| 1 |') + 2 })
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, changes: [{ offset: 0, length: 0, text: 'x' }], origin: 'external',
    })
    h.sent.length = 0
    c.handleHostMessage({ kind: 'contextMenu.test.menuClick', command: 'deleteTable' })
    expect(editRequests(h)).toHaveLength(0)
    expect(menuEl(), '放弃路径关闭菜单').toBeNull()
  })

  it('命令面板/快捷键入口（ui.command）：光标处表格执行删除（与菜单同一实现）', () => {
    const doc = `前文\n\n${TOP}\n\n后文`
    const h = makeBridge()
    const { c } = mountPanel(h, doc)
    const view = c.getView()!
    view.dispatch({ selection: { anchor: doc.indexOf('| 3 |') + 2 } })
    c.handleHostMessage({ kind: 'ui.command', op: 'deleteTable' })
    expect(c.getView()!.state.doc.toString()).toBe('前文\n\n\n\n后文')
    expect(editRequests(h)).toHaveLength(1)
  })
})
