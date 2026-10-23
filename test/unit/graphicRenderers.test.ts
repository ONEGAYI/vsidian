// 图形化代码块渲染器注册表契约（工单 #111）：双侧键集一致性、「登记即
// 继承」（假想第二渲染器不引入真实依赖）与管线消费路径。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  GRAPHIC_LANG_ATTR,
  GRAPHIC_PROVIDER_ATTR,
  MERMAID_CODE_ATTR,
  MERMAID_STATE_ATTR,
  RENDERED_FENCE_LABELS,
  scanFenceSpans,
} from '../../src/shared/mermaid'
import {
  __registerGraphicRendererForTest,
  graphicRendererContentEl,
  graphicRendererFor,
  graphicRendererLanguages,
  graphicSvgCountByOwner,
  renderGraphicBlockInto,
} from '../../src/webview/graphicRenderers'
import { buildMermaidDecorationRanges, mermaidFencesField } from '../../src/webview/liveMermaid'

describe('注册表一致性', () => {
  it('mermaid 在共享标签表与 webview 管线表双侧登记', () => {
    expect(RENDERED_FENCE_LABELS['mermaid']).toBe('Mermaid')
    expect(graphicRendererLanguages()).toContain('mermaid')
    expect(graphicRendererFor('mermaid')).toBeDefined()
    expect(graphicRendererFor(' mermaid ')).toBeDefined()
    expect(graphicRendererFor('plantuml')).toBeUndefined()
  })

  it('每个 webview 管线语言都有共享标签（卡片头部与弹窗标题依赖）', () => {
    for (const lang of graphicRendererLanguages()) {
      expect(RENDERED_FENCE_LABELS[lang], `${lang} 应有显示名标签`).toBeDefined()
    }
  })
})

describe('登记即继承（假想第二渲染器）', () => {
  it('登记 renderlang 后 live 装饰发射 widget；注销后回落源码', () => {
    const restore = __registerGraphicRendererForTest('renderlang', {
      renderInto: () => undefined,
      renderSvg: async () => ({ ok: true, svg: '<svg></svg>' }),
    })
    const doc = '```renderlang\nX\n```\n'
    const spans = scanFenceSpans(doc.split('\n'), 0)
    expect(spans).toHaveLength(1)
    const state = EditorState.create({ doc, extensions: [mermaidFencesField] })
    const fences = state.field(mermaidFencesField).spans.map((s) => ({ ...s, rendered: true, info: 'renderlang' }))
    const withRenderer = buildMermaidDecorationRanges(EditorSelection.single(100), null, fences)
    expect(withRenderer).toHaveLength(1)
    restore()
    const withoutRenderer = buildMermaidDecorationRanges(EditorSelection.single(100), null, fences)
    expect(withoutRenderer).toHaveLength(0)
  })

  it('未登记管线的语言不发射（共享标签存在但管线缺失 → 源码+卡片降级）', () => {
    const fences = [
      { from: 0, to: 10, char: '`' as const, run: 3, rendered: true, info: 'nostack', code: 'X' },
    ]
    expect(buildMermaidDecorationRanges(EditorSelection.single(100), null, fences)).toHaveLength(0)
  })

  it('阅读渲染分派走注册表：块容器扫描后代 pending 容器，命中管线即渲染，未登记跳过', () => {
    const calls: Array<{ lang: string; code: string }> = []
    const restore = __registerGraphicRendererForTest('renderlang', {
      renderInto: (el, code) => {
        calls.push({ lang: el.getAttribute(GRAPHIC_LANG_ATTR) ?? '', code })
      },
      renderSvg: async () => ({ ok: true, svg: '<svg></svg>' }),
    })
    // 挂载钩子传入的是块容器，图形容器是其后代（同 renderMermaidIn 扫描语义）
    const block = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute(GRAPHIC_LANG_ATTR, 'renderlang')
    el.setAttribute(MERMAID_CODE_ATTR, 'X')
    el.setAttribute(MERMAID_STATE_ATTR, 'pending')
    block.appendChild(el)
    renderGraphicBlockInto(block)
    expect(calls).toEqual([{ lang: 'renderlang', code: 'X' }])
    // 共享标签在而管线缺失的语言：不得回落 mermaid 管线误渲（停留降级）；
    // renderlang 容器 mock 下仍为 pending 会被重扫，属扫描语义而非缺陷
    const unknown = document.createElement('div')
    unknown.setAttribute(GRAPHIC_LANG_ATTR, 'nostack')
    unknown.setAttribute(MERMAID_CODE_ATTR, 'X')
    unknown.setAttribute(MERMAID_STATE_ATTR, 'pending')
    block.appendChild(unknown)
    renderGraphicBlockInto(block)
    expect(calls.some((entry) => entry.lang === 'nostack')).toBe(false)
    restore()
  })
})

// #629 renderers 探针纯函数：builtinSvg 按容器所有权分桶（组件渲染出的
// SVG 不得误计入内置计数）、代表元素选择序绕开 display:none 的内嵌
// <style>（真 SVG 组件场景 width 恒 0 的根因）
describe('renderers 探针纯函数（#629）', () => {
  /** 按真实挂载形态构造图形容器（类名/语言/提供者/状态齐全） */
  function makeContainer(provider: string | null, innerHtml = ''): HTMLElement {
    const el = document.createElement('div')
    el.className = 'vsidian-mermaid'
    el.setAttribute(GRAPHIC_LANG_ATTR, 'mermaid')
    el.setAttribute(MERMAID_CODE_ATTR, 'graph TD')
    if (provider !== null) {
      el.setAttribute(GRAPHIC_PROVIDER_ATTR, provider)
    }
    el.setAttribute(MERMAID_STATE_ATTR, 'rendered')
    el.innerHTML = innerHtml
    return el
  }

  describe('graphicSvgCountByOwner：svg 按所有权分桶', () => {
    it('组件接管容器渲染出的 SVG 不计入 builtin、计入 addon（#629 主缺陷）', () => {
      const scope = document.createElement('div')
      scope.appendChild(makeContainer('test.addon/mermaid-alt', '<svg><g><text>A</text></g></svg>'))
      expect(graphicSvgCountByOwner(scope)).toEqual({ builtin: 0, addon: 1 })
    })

    it('内置容器与无所有权标记的历史容器计入 builtin', () => {
      const scope = document.createElement('div')
      scope.appendChild(makeContainer('builtin', '<svg></svg>'))
      scope.appendChild(makeContainer(null, '<svg><g><text>B</text></g></svg>'))
      expect(graphicSvgCountByOwner(scope)).toEqual({ builtin: 2, addon: 0 })
    })

    it('非图形容器内的 svg 不参与计数；两类容器并存时分桶各自正确', () => {
      const scope = document.createElement('div')
      const plain = document.createElement('div')
      plain.innerHTML = '<svg></svg>'
      scope.appendChild(plain)
      scope.appendChild(makeContainer('test.addon/r1', '<svg></svg><svg></svg>'))
      scope.appendChild(makeContainer('builtin', '<svg></svg>'))
      expect(graphicSvgCountByOwner(scope)).toEqual({ builtin: 1, addon: 2 })
    })
  })

  describe('graphicRendererContentEl：代表元素选择序', () => {
    it('显式断言锚（t09-box / data-t09-renderer）最优先——fixture 断言锚兼容', () => {
      const el = makeContainer('test.addon/mermaid-alt', '<div class="t09-box" data-t09-renderer="mermaid-alt">alt</div>')
      const content = graphicRendererContentEl(el)
      expect(content?.classList.contains('t09-box')).toBe(true)
    })

    it('真 SVG 组件场景代表元素是 svg 本体而非内嵌 <style>（width 恒 0 的根因）', () => {
      // Codex 预设把 themeCSS 烘焙进内嵌 <style>——UA 样式 display:none，
      // 旧「首个非空文本叶子」fallback 恰命中它
      const el = makeContainer('test.addon/mermaid', '<svg viewBox="0 0 40 20"><style>.node{fill:#333}</style><g><text>节点</text></g></svg>')
      const content = graphicRendererContentEl(el)
      expect(content?.tagName.toLowerCase()).toBe('svg')
    })

    it('error 占位场景命中可见文本叶子：跳过 UA 隐藏标签与 display:none 元素', () => {
      const el = makeContainer('test.addon/mermaid', '<style>.x{}</style><span style="display: none">隐藏占位</span><span>渲染失败：语法错误</span>')
      const content = graphicRendererContentEl(el)
      expect(content?.tagName.toLowerCase()).toBe('span')
      expect((content?.textContent ?? '').includes('渲染失败')).toBe(true)
    })

    it('空容器无代表元素（null，width 探针回 0）', () => {
      expect(graphicRendererContentEl(makeContainer('test.addon/r', ''))).toBeNull()
    })
  })
})
