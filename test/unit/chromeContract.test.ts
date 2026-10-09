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
  'live-fm-fold', // 2026-10 卡片折叠：chevron 两态常驻但收起态形态由行为切换，折叠/热区/浮层联动由浏览器与集成套件验证
  'live-fm-degraded-hint', // #424 降级源码态轻提示：依赖文档形态（fm 成型/降级互斥、文档首唯一），探针 fixture 为成型头区不可静态命中；浏览器 frontmatterTable 断可见性/穿透/左对齐
  // #414 T03 标题折叠 UI：箭头显隐（悬停武装/折叠常显）与省略号占位是
  // 行为驱动形态——headingFoldCssContract 静态钉规则、浏览器 headingFoldUi
  // 绘制层断言显隐与点击
  'fold-gutter', // 零宽承载列（marker 绝对定位脱流）
  'fold-arrow', // 悬停武装显现 / 折叠态常显
  'fold-arrow-collapsed', // 折叠态修饰（常显 + 右向）
  'fold-hover', // 悬停武装类（指针驱动瞬态）
  'fold-ellipsis', // 折叠态占位 widget（装饰物化）
  'suspend-banner', // 暂停态横幅
  'diagram-popup', // 弹窗在场期间（chromePopup 观测）
  'hover-popup', // #218 悬停预览浮层（悬停延迟打开期间挂载，开闭/保活/绘制由浏览器 hoverPreview 套件验证）
  'hover-fm-section', // #220 悬停浮层笔记属性区（浮层在场期间的结构；折叠/热区/键盘由浏览器套件验证）
  'hover-pdf-view', // #337 悬停 PDF 内容视图（浮层在场期间的结构；canvas 绘制层可见性由浏览器/集成按实际像素断言）
  'mode-toggle', // 已移除（历史记录条目）
  'mode-body', // 模式态类（live/reading 互斥，两态必居其一——无静态单值可断言）
  'find-match-highlight', // #236 匹配装饰（查找会话打开且命中时在场；计数/序号/定位由集成 find 用例按行为路径验证）
  'reading-find-source', // 隐藏源码当前命中时挂载；浏览器像素与真宿主 paint 探针验证。
  'skeleton-block', // #292 装载窗口瞬态（撤除后不存在）：探针无法常态采集；单元 skeletonScreen 钉装配形态、浏览器 skeletonProbe 断绘制与撤除
  'skeleton-column', // #292 同骨架族瞬态：宽度跟随由浏览器 skeletonProbe S3 绘制断言承接
  'tooltip-card', // #300 悬停瞬态（shown 类仅悬停/焦点在场）：单元 tooltipCard 钉委托行为、浏览器 tooltipCard 断可见性与主题跟随绘制
  'tooltip-key', // #300 键位徽章随提示渲染（keys 区 :empty 时不存在）：单元 tooltipCard 钉多段徽章渲染
  'toast', // #305 仅反馈期间存在：plainPaste 浏览器及 plainPasteHost 真宿主 paint.toast 可见性验证
  'toast-severity', // #305 同一瞬态卡片的严重性分支：plainPaste 对三种背景与高对比/片段覆盖绘制验证
  'paste-dialog', // #306 询问会话瞬态：richPaste 浏览器断背景、焦点和局部键盘；richPasteHost断宿主编辑及偏好记忆
  'hover-text-view', // #340 悬停浮层 text 形态（text 回包期间挂载，着色/行号/窗口由浏览器 textHover 套件按绘制层验证）
  'wikilink-suggest-item', // #376 双链联想候选（会话开启期间挂载 document.body，行为路径由浏览器 wikilinkSuggest 与真宿主 paint.wikilinkSuggest 验证）
  'wikilink-suggest-item-active', // #376 键盘高亮修饰类（随会话与方向键切换）
  'wikilink-suggest-status', // #376 状态行（随查询结果与索引就绪态切换）
  'wikilink-suggest-hints', // 2026-10-06 验收反馈：底部键提示条（随会话挂载 document.body，三阶段段落数切换；browser wikilinkSuggest 断言可见性与分割线）
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

  it('阅读侧发射类在场：readingCodeCard 仅行结构（2026-10 起卡内行号不发射），readingMarkdown 双类在（views 修正的依据）', () => {
    const card = readRepo('src/webview/readingCodeCard.ts')
    expect(card).toContain("CODE_CARD_CLASS_NAMES.line")
    expect(card).not.toContain("CODE_CARD_CLASS_NAMES.linenumber")
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
