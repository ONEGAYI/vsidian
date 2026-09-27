// @vitest-environment jsdom
// Obsidian 原名别名桥契约测试（#132）：direct 级承诺的 Obsidian 原名类
// 必须与 vsidian 稳定类**挂在同一 DOM 上**——发射侧（live 装饰 / 阅读块 /
// 容器）一律经 shared/styleContract 的别名表拼类名，保证「清单承诺」与
// 「DOM 实际承接」同源。变量桥（CSS fallback 形态）由
// obsidianAliasCssContract.test.ts 钉 main.css；本文件钉 DOM 侧发射。
import { describe, expect, it } from 'vitest'
import { EditorSelection, Text } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { buildLivePreviewDecorations } from '../../src/webview/liveDecorations'
import { buildLinkImageDecorationRanges, buildWikilinkDecorationRanges } from '../../src/webview/liveLinks'
import { docInput, markdownTreeParser } from '../../src/webview/markdownDoc'
import { splitReadingBlocks } from '../../src/webview/readingBlocks'
import { createReadingBlockElement, createReadingContainer } from '../../src/webview/readingView'
import {
  applyObsidianDomAlias,
  OBSIDIAN_DOM_ALIASES,
} from '../../src/shared/styleContract'

// ---- 断言辅助（与 liveDecorations.test.ts 同模式） ----

function classesOf(set: DecorationSet): Set<string> {
  const out = new Set<string>()
  set.between(0, Infinity, (_from, _to, value) => {
    const spec = value.spec as { class?: string }
    if (spec['class'] !== undefined) {
      for (const cls of spec['class'].split(' ')) {
        out.add(cls)
      }
    }
  })
  return out
}

function build(doc: string): DecorationSet {
  return buildLivePreviewDecorations(Text.of(doc.split('\n')), EditorSelection.single(0, 0))
}

describe('applyObsidianDomAlias（别名表展开）', () => {
  it('已知 vsidian 类返回「vsidian 名 + Obsidian 别名」串', () => {
    expect(applyObsidianDomAlias('vsidian-strong')).toBe('vsidian-strong cm-strong')
    expect(applyObsidianDomAlias('vsidian-heading-line-2')).toBe('vsidian-heading-line-2 HyperMD-header-2')
    expect(applyObsidianDomAlias('vsidian-header-3')).toBe('vsidian-header-3 cm-header-3')
    expect(applyObsidianDomAlias('vsidian-view-reading')).toBe('vsidian-view-reading markdown-preview-view')
    expect(applyObsidianDomAlias('vsidian-view-live')).toBe('vsidian-view-live markdown-source-view mod-cm6 cm-s-obsidian')
  })

  it('未知类与多类串逐 token 处理（未承诺的类保持原样）', () => {
    expect(applyObsidianDomAlias('vsidian-list-bullet')).toBe('vsidian-list-bullet')
    expect(applyObsidianDomAlias('vsidian-quote-line vsidian-x')).toBe('vsidian-quote-line HyperMD-quote vsidian-x')
    // 深度/状态修饰类不映射（只有基类承诺别名）
    expect(applyObsidianDomAlias('vsidian-list-line-d2')).toBe('vsidian-list-line-d2')
    expect(applyObsidianDomAlias('vsidian-heading-active')).toBe('vsidian-heading-active')
  })
})

describe('live 装饰发射含 Obsidian 别名', () => {
  const DOC = [
    '---', 'title: fm', '---', '',
    '# 标题一', '',
    '**粗** *斜* `码` ==高== ~~删~~', '',
    '> 引用行', '',
    '- 列表项', '  - 嵌套项', '',
    '---', '',
    '```js', 'const a = 1', '```', '',
    '| 列A | 列B |', '| --- | --- |', '| 甲 | 乙 |', '',
    '[链接](https://example.com)', '',
    '[[双链目标|别名]]', '',
  ].join('\n')

  it('行级与 span 级装饰同时携带 vsidian 名与 Obsidian 原名', () => {
    const set = build(DOC)
    const classes = classesOf(set)
    // 标题
    expect(classes.has('vsidian-heading-line-1')).toBe(true)
    expect(classes.has('HyperMD-header-1')).toBe(true)
    expect(classes.has('vsidian-header-1')).toBe(true)
    expect(classes.has('cm-header-1')).toBe(true)
    // 行内格式
    expect(classes.has('cm-strong')).toBe(true)
    expect(classes.has('cm-emphasis')).toBe(true)
    expect(classes.has('cm-inline-code')).toBe(true)
    expect(classes.has('cm-highlight')).toBe(true)
    // 块级行
    expect(classes.has('HyperMD-quote')).toBe(true)
    expect(classes.has('HyperMD-list-line')).toBe(true)
    expect(classes.has('HyperMD-codeblock')).toBe(true)
    expect(classes.has('cm-hr')).toBe(true)
    expect(classes.has('cm-hmd-frontmatter')).toBe(true)
    // 表格
    expect(classes.has('HyperMD-table-line')).toBe(true)
    expect(classes.has('cm-table-cell')).toBe(true)
  })

  it('同一装饰的类串成对出现（vsidian 名与别名同元素，非各挂一处）', () => {
    const set = build(DOC)
    let paired = false
    set.between(0, Infinity, (_from, _to, value) => {
      const spec = value.spec as { class?: string }
      const cls = spec['class'] ?? ''
      if (cls.split(' ').includes('vsidian-strong') && cls.split(' ').includes('cm-strong')) {
        paired = true
      }
    })
    expect(paired).toBe(true)
  })

  it('链接与双链装饰携带 cm-link / cm-hmd-internal-link', () => {
    const text = Text.of(DOC.split('\n'))
    const tree = markdownTreeParser.parse(docInput(text))
    // 光标放进双链范围 → 源码 mark 路径（class 直接携带别名）
    const wikilinkStart = DOC.indexOf('[[双链')
    const selectionInside = EditorSelection.single(wikilinkStart + 2, wikilinkStart + 2)
    const visible = [{ from: 0, to: text.length }]
    const ranges = [
      ...buildLinkImageDecorationRanges(text, tree, selectionInside, visible, undefined),
      ...buildWikilinkDecorationRanges(text, tree, selectionInside, visible, null),
    ]
    const linkClasses = new Set<string>()
    for (const range of ranges) {
      const spec = (range.value.spec as { class?: string }).class
      if (spec) {
        for (const cls of spec.split(' ')) linkClasses.add(cls)
      }
    }
    expect(linkClasses.has('cm-link')).toBe(true)
    expect(linkClasses.has('vsidian-link')).toBe(true)
    expect(linkClasses.has('cm-hmd-internal-link')).toBe(true)
    expect(linkClasses.has('vsidian-wikilink')).toBe(true)
  })

  it('双链显示态 widget 的 DOM 元素携带 cm-hmd-internal-link（范围外整替换路径）', () => {
    const text = Text.of(DOC.split('\n'))
    const tree = markdownTreeParser.parse(docInput(text))
    const ranges = buildWikilinkDecorationRanges(
      text,
      tree,
      EditorSelection.single(0, 0),
      [{ from: 0, to: text.length }],
      null,
    )
    const widgetRanges = ranges.filter((r) => (r.value.spec as { widget?: unknown }).widget !== undefined)
    expect(widgetRanges.length).toBeGreaterThan(0)
    for (const range of widgetRanges) {
      const widget = (range.value.spec as { widget: { toDOM(): HTMLElement } }).widget
      const el = widget.toDOM()
      expect(el.classList.contains('vsidian-wikilink')).toBe(true)
      expect(el.classList.contains('cm-hmd-internal-link')).toBe(true)
    }
  })
})

describe('阅读视图发射含 Obsidian 别名', () => {
  const DOC = '---\ntitle: t\n---\n\n# 标题\n\n- [ ] 任务\n\n[[目标|别名]]\n'

  it('容器携带 markdown-preview-view；任务 li 携带 task-list-item；frontmatter 块携带 markdown-frontmatter；双链 a 携带 internal-link', () => {
    const container = createReadingContainer()
    expect(container.classList.contains('markdown-preview-view')).toBe(true)
    expect(container.classList.contains('vsidian-view-reading')).toBe(true)

    let blocks = splitReadingBlocks(DOC)
    // jsdom 环境：markdown-it 渲染走真实 DOM
    const els: HTMLElement[] = []
    for (const block of blocks) {
      els.push(createReadingBlockElement(block, DOC))
    }
    container.append(...els)

    const taskLi = container.querySelector('li.task-list-item')
    expect(taskLi, '任务 li 应携带 task-list-item 别名').not.toBeNull()
    expect(taskLi!.classList.contains('vsidian-reading-task')).toBe(true)

    const fm = container.querySelector('.markdown-frontmatter')
    expect(fm, 'frontmatter 块应携带 markdown-frontmatter 别名').not.toBeNull()
    expect(fm!.classList.contains('vsidian-reading-frontmatter')).toBe(true)

    const wikilink = container.querySelector('a.internal-link')
    expect(wikilink, '双链 a 应携带 internal-link 别名').not.toBeNull()
    expect(wikilink!.classList.contains('vsidian-wikilink')).toBe(true)
    void blocks
  })
})

describe('别名常量表完整性（发射侧不手写 Obsidian 字面量的前提）', () => {
  it('OBSIDIAN_DOM_ALIASES 覆盖清单全部 DOM 类别名承诺', () => {
    // 派生映射应包含全部正文域发射点（spot check 代表性键）
    expect(applyObsidianDomAlias('vsidian-quote-line')).toContain('HyperMD-quote')
    expect(applyObsidianDomAlias('vsidian-code-line')).toContain('HyperMD-codeblock')
    expect(applyObsidianDomAlias('vsidian-list-line')).toContain('HyperMD-list-line')
    expect(applyObsidianDomAlias('vsidian-table-line')).toContain('HyperMD-table-line')
    expect(applyObsidianDomAlias('vsidian-table-cell')).toContain('cm-table-cell')
    expect(applyObsidianDomAlias('vsidian-hr-line')).toContain('cm-hr')
    expect(applyObsidianDomAlias('vsidian-frontmatter-line')).toContain('cm-hmd-frontmatter')
    expect(applyObsidianDomAlias('vsidian-link')).toContain('cm-link')
    expect(applyObsidianDomAlias('vsidian-wikilink')).toContain('cm-hmd-internal-link')
    expect(applyObsidianDomAlias('vsidian-highlight')).toContain('cm-highlight')
    expect(applyObsidianDomAlias('vsidian-inline-code')).toContain('cm-inline-code')
    expect(applyObsidianDomAlias('vsidian-emphasis')).toContain('cm-emphasis')
    expect(applyObsidianDomAlias('vsidian-reading-task')).toContain('task-list-item')
    expect(applyObsidianDomAlias('vsidian-reading-frontmatter')).toContain('markdown-frontmatter')
    expect(OBSIDIAN_DOM_ALIASES.readingContainer).toContain('markdown-preview-view')
  })
})

// ---- 探针资产一致性：探针表 ↔ media/css-contract-probe.css ↔ 读取实现 ----

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { OBSIDIAN_ALIAS_PROBES } from '../../src/shared/obsidianAlias'

// 读入后规范化 CRLF（Windows autocrlf 检出形态与 CI LF 等价；规则比对不受影响）
const probeCss = readFileSync(path.resolve(process.cwd(), 'media/css-contract-probe.css'), 'utf8').replace(/\r\n/g, '\n')

describe('别名探针资产一致性', () => {
  it('探针表每条在 probe.css 有同形规则（选择器按 Obsidian 原名 + 期望色）', () => {
    expect(OBSIDIAN_ALIAS_PROBES.length).toBe(29)
    for (const probe of OBSIDIAN_ALIAS_PROBES) {
      // probe.css 规则形态：live 探针带 #app .vsidian-view-live 前缀
      //（container-live 的组合选择器除外），reading 探针带 #app 前缀
      const prefix = probe.view === 'live' && probe.id !== 'container-live'
        ? '#app .vsidian-view-live '
        : '#app '
      const rule = `${prefix}${probe.selector} {
  outline-color: ${probe.expected};
}`
      expect(probeCss.includes(rule), `probe.css 缺少 ${probe.id} 的探针规则`).toBe(true)
    }
  })

  it('探针键唯一（cssProbe.obsidianAliases 的 record 键）', () => {
    const ids = OBSIDIAN_ALIAS_PROBES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('探针期望值互不相同（失败时可定位到具体条目）', () => {
    const expecteds = OBSIDIAN_ALIAS_PROBES.map((p) => p.expected)
    expect(new Set(expecteds).size).toBe(expecteds.length)
  })
})
