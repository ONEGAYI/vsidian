// 界面域公开样式契约资产一致性契约测试（#133）：chrome 域探针表、
// probe.css 探针规则与清单条目三处同源；数据纠错（mode-toggle 陈旧行）
// 与设置页片段隔离的架构性证据亦在此钉住。与 #132 的
// obsidianAlias.test.ts「探针资产一致性」同模式。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROME_CONTRACT_PROBES } from '../../src/shared/chromeContract'
import { STYLE_CONTRACT_BY_ID, STYLE_CONTRACT_ENTRIES } from '../../src/shared/styleContract'

const readRepo = (rel: string): string =>
  readFileSync(path.resolve(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

const probeCss = readRepo('media/css-contract-probe.css')

describe('chromeContract 探针资产一致性', () => {
  it('探针表每条在 probe.css 有同形规则（选择器 + 期望色）', () => {
    for (const probe of CHROME_CONTRACT_PROBES) {
      const rule = `${probe.selector} {\n  --vsidian-chrome-probe: ${probe.expected};\n}`
      expect(probeCss.includes(rule), `probe.css 缺少 ${probe.id} 的探针规则`).toBe(true)
    }
  })

  it('探针 id 唯一且期望值互不相同（失败时可定位到具体条目）', () => {
    const ids = CHROME_CONTRACT_PROBES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    const expecteds = CHROME_CONTRACT_PROBES.map((p) => p.expected)
    expect(new Set(expecteds).size).toBe(expecteds.length)
  })

  it('探针 id 对应清单 chrome 域条目（-live/-reading 为视图消歧后缀）', () => {
    for (const probe of CHROME_CONTRACT_PROBES) {
      const entryId = probe.id.replace(/-(live|reading)$/, '')
      const entry = STYLE_CONTRACT_BY_ID.get(entryId)
      expect(entry, `${probe.id} 应对应清单条目 ${entryId}`).toBeDefined()
      expect(entry!.domain, `${probe.id}`).toBe('chrome')
    }
  })

  it('探针选择器只用 vsidian 稳定类名（chrome 域不承诺 Obsidian 原名命中）', () => {
    for (const probe of CHROME_CONTRACT_PROBES) {
      // Obsidian 原名类（cm-/HyperMD-/markdown-preview-view 等）不出现在
      // 界面域探针里——语义对应条目必须用 vsidian 名（诚实边界）
      expect(probe.selector).toMatch(/^#app /)
      expect(probe.selector).not.toMatch(/\.(cm-|HyperMD-|markdown-preview-view|task-list-item|internal-link)/)
    }
  })
})

/**
 * chrome 域 selector 条目的验证覆盖分工：静态可命中的条目由探针表覆盖
 * （本表派生断言）；交互态条目（类只在用户操作期间在场）由既有浏览器/
 * 集成套件按行为路径验证——两边合成「每条公开承诺有验证」的机器保证。
 */
const DYNAMIC_STATE_ENTRIES: ReadonlySet<string> = new Set([
  'live-math-source', // 光标进入公式范围时
  'outline-located', // 跟随光标
  'outline-collapsed', // 折叠态
  'outline-hidden', // 折叠遮蔽/搜索过滤
  'outline-search-hit', // 搜索命中
  'outline-nomatch', // 搜索零命中
  'outline-menu', // 右键唤出
  'context-menu', // 右键唤出（#183 统一菜单；瞬态挂载，行为路径验证）
  'outline-rename-input', // 重命名态
  'outline-dragging', // 拖动中
  'outline-drop-edge', // 拖拽悬停
  'outline-drop-inside', // 拖拽悬停中部
  'live-code-card-copy', // 复制按钮（悬停显现 + 点击态）
  'live-code-card-fold', // 折叠 chevron
  'live-code-card-edge', // 首末行修饰（首行由头部覆盖，CSS 契约钉）
  'live-fm-popover', // #140 Popover 改版：属性编辑浮层（打开时挂载 body，开闭与写回由浏览器套件验证）
  'suspend-banner', // 暂停态横幅
  'diagram-popup', // 弹窗在场期间（chromePopup 观测）
  'hover-popup', // #218 悬停预览浮层（悬停延迟打开期间挂载，开闭/保活/绘制由浏览器 hoverPreview 套件验证）
  'hover-fm-section', // #220 悬停浮层笔记属性区（浮层在场期间的结构；折叠/热区/键盘由浏览器套件验证）
  'mode-toggle', // 已移除（历史记录条目）
  'mode-body', // 模式态类（live/reading 互斥，两态必居其一——无静态单值可断言）
])

describe('chromeContract 覆盖分工', () => {
  it('chrome selector 条目：静态条目全部有探针，动态条目在豁免表', () => {
    const probedIds = new Set(
      CHROME_CONTRACT_PROBES.map((p) => p.id.replace(/-(live|reading)$/, '')),
    )
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.domain !== 'chrome' || entry.kind !== 'selector') {
        continue
      }
      const covered = probedIds.has(entry.id) || DYNAMIC_STATE_ENTRIES.has(entry.id)
      expect(covered, `${entry.id} 应有探针覆盖或列入动态态豁免表`).toBe(true)
    }
  })

  it('variable/limitation 条目不经探针（变量经片段驱动用例、限制即边界）', () => {
    const probedIds = new Set(CHROME_CONTRACT_PROBES.map((p) => p.id))
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.domain === 'chrome' && (entry.kind === 'variable' || entry.kind === 'limitation')) {
        expect(probedIds.has(entry.id), `${entry.id} 不应有探针`).toBeFalsy()
      }
    }
  })
})

describe('chromeContract 数据纠错钉（#133 核实依据）', () => {
  it('mode-toggle 类已不在 webview 源码（#38 移除，从未随发布版存在）', () => {
    const sources = ['src/webview/syncController.ts', 'src/webview/main.css']
    for (const rel of sources) {
      expect(readRepo(rel).includes('vsidian-mode-toggle'), rel).toBe(false)
    }
  })

  it('阅读侧同发射类在 readingCodeCard/readingMarkdown 在场（views 修正的依据）', () => {
    const card = readRepo('src/webview/readingCodeCard.ts')
    expect(card).toContain("CODE_CARD_CLASS_NAMES.line")
    expect(card).toContain("CODE_CARD_CLASS_NAMES.linenumber")
    const math = readRepo('src/webview/readingMarkdown.ts')
    expect(math).toContain('${MATH_CLASS_NAMES.math}')
    expect(math).toContain('${MATH_CLASS_NAMES.mathBlock}')
  })
})

describe('设置页片段隔离（#133：用户片段不影响设置页）', () => {
  it('设置页 webview 入口不装配片段装载器（snippets.snapshot 无消费）', () => {
    for (const rel of ['src/webview/settingsMain.ts', 'src/webview/settingsPageView.ts']) {
      const source = readRepo(rel)
      expect(source.includes('snippets.snapshot'), rel).toBe(false)
      expect(source.includes('snippetLoader'), rel).toBe(false)
    }
  })

  it('片段快照只发编辑器面板（宿主侧按面板注入，无全局广播）', () => {
    const host = readRepo('src/host/textEditorProvider.ts')
    expect(host.includes('panel.webview.postMessage')).toBe(true)
    // 片段 link 清单按编辑器面板构建（asWebviewUri 依赖各面板 origin）
    expect(host.includes('buildSnippetLinkList')).toBe(true)
    const settingsHost = readRepo('src/host/settingsPage.ts')
    expect(settingsHost.includes('buildSnippetLinkList')).toBe(false)
  })
})
