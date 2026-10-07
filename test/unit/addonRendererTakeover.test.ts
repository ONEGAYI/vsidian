// #358 T09 两表适配与热切换契约：动态渲染型围栏语言集、生效提供者分派
// （接管/回退/模式过滤）、容器所有权切换（释放旧提供者、换新容器、迟到
// 结果写脱离节点不回潮）、live 装饰发射 gate、内置 mermaid 扫描跳过组件
// 容器。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  GRAPHIC_LANG_ATTR,
  GRAPHIC_MODE_ATTR,
  GRAPHIC_PROVIDER_ATTR,
  MERMAID_CLASS_NAMES,
  MERMAID_CODE_ATTR,
  MERMAID_STATE_ATTR,
  dynamicRenderedFenceLanguageSnapshot,
  isRenderedFenceInfo,
  scanFenceSpans,
  setDynamicRenderedFenceLanguages,
} from '../../src/shared/mermaid'
import {
  bindAddonFaultReporter,
  effectiveGraphicRendererFor,
  hasEffectiveGraphicRenderer,
  remountChangedGraphicBlocks,
  remountGraphicContainer,
  renderGraphicIntoContainer,
  refreshAddonGraphicBlocks,
} from '../../src/webview/graphicRenderers'
import { buildMermaidDecorationRanges, mermaidFencesField } from '../../src/webview/liveMermaid'
import { setAddonRenderersBridge, type AddonRenderersBridgeHandle, type AddonRenderersOutboundMessage } from '../../src/webview/addonRenderers'
import type { AddonRendererRegistration } from '../../src/shared/addonRenderers'

function specOf(rendererId: string, languages: string[], opts: Partial<AddonRendererRegistration> = {}): AddonRendererRegistration {
  return {
    rendererId,
    label: `${rendererId} 标签`,
    languages,
    modes: ['live', 'reading'],
    exportFormats: ['svg', 'png'],
    mount: () => {},
    exportSvg: async () => `<svg data-r="${rendererId}"></svg>`,
    ...opts,
  }
}

/** 装桥 + 应用生效表的测试装配（返回桥与出站箱） */
function harness(): { bridge: AddonRenderersBridgeHandle; outbox: AddonRenderersOutboundMessage[] } {
  const outbox: AddonRenderersOutboundMessage[] = []
  const bridge = setAddonRenderersBridge((message) => outbox.push(message))
  return { bridge, outbox }
}

function table(languages: Array<{ language: string; effective: string }>, providers: Array<{ addonId: string; rendererId: string; languages: string[] }> = [], version = 1) {
  return {
    version,
    providers: providers.map((p) => ({
      addonId: p.addonId,
      rendererId: p.rendererId,
      providerId: `${p.addonId}/${p.rendererId}`,
      label: `${p.rendererId} 标签`,
      languages: p.languages,
      modes: ['live' as const, 'reading' as const],
      exportFormats: ['svg' as const, 'png' as const],
    })),
    languages: languages.map((l) => ({ language: l.language, effective: l.effective, source: 'auto' as const })),
  }
}

/** 挂载回调记录形态 */
interface MountRecord {
  event: 'mount' | 'release' | 'refresh'
  container: HTMLElement
  code: string
  language: string
  mode: string
}

function recordingSpec(rendererId: string, languages: string[], log: MountRecord[], opts: Partial<AddonRendererRegistration> = {}): AddonRendererRegistration {
  return specOf(rendererId, languages, {
    mount: (container, code, ctx) => {
      container.dataset['content'] = `${rendererId}:${code}`
      log.push({ event: 'mount', container, code, language: ctx.language, mode: ctx.mode })
    },
    release: (container, ctx) => {
      log.push({ event: 'release', container, code: '', language: ctx.language, mode: ctx.mode })
    },
    refresh: (container, code, ctx) => {
      log.push({ event: 'refresh', container, code, language: ctx.language, mode: ctx.mode })
    },
    ...opts,
  })
}

describe('动态渲染型围栏语言集（shared）', () => {
  it('动态集计入 fence 判定与围栏扫描；重设等值返回 false', () => {
    expect(setDynamicRenderedFenceLanguages(['draw', ' draw '])).toBe(true)
    expect(isRenderedFenceInfo('draw')).toBe(true)
    expect(isRenderedFenceInfo('Draw')).toBe(false)
    const spans = scanFenceSpans('```draw\nX\n```\n'.split('\n'), 0)
    expect(spans[0]).toMatchObject({ rendered: true, info: 'draw' })
    expect(setDynamicRenderedFenceLanguages(['draw'])).toBe(false)
    expect(setDynamicRenderedFenceLanguages([])).toBe(true)
    expect(isRenderedFenceInfo('draw')).toBe(false)
    expect(dynamicRenderedFenceLanguageSnapshot().size).toBe(0)
  })
})

describe('生效提供者分派（两表适配）', () => {
  it('无桥生效表：内置注册表口径不变（mermaid 内置、未知语言无管线）', () => {
    harness()
    expect(hasEffectiveGraphicRenderer('mermaid', 'live')).toBe(true)
    expect(hasEffectiveGraphicRenderer('draw', 'live')).toBe(false)
  })

  it('组件接管 mermaid：live/reading 分派走组件 mount（携带语言与模式）', () => {
    const { bridge } = harness()
    const log: MountRecord[] = []
    bridge.register('pub.a', 1, recordingSpec('r1', ['mermaid'], log))
    bridge.applyTable(table([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    const container = document.createElement('div')
    renderGraphicIntoContainer(container, 'graph TD', 'mermaid', 'live')
    expect(container.dataset['content']).toBe('r1:graph TD')
    expect(container.getAttribute(GRAPHIC_PROVIDER_ATTR)).toBe('pub.a/r1')
    expect(container.getAttribute(GRAPHIC_MODE_ATTR)).toBe('live')
    expect(log[0]).toMatchObject({ event: 'mount', code: 'graph TD', language: 'mermaid', mode: 'live' })
    // renderSvg 走组件导出能力
    return effectiveGraphicRendererFor('mermaid', 'live')!.renderSvg('graph TD').then((result) => {
      expect(result).toEqual({ ok: true, svg: '<svg data-r="r1"></svg>' })
    })
  })

  it('停用（生效表回 builtin）：内置管线接管同容器路径', () => {
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['mermaid']))
    bridge.applyTable(table([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    bridge.applyTable(table([{ language: 'mermaid', effective: 'builtin' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }], 2))
    const container = document.createElement('div')
    renderGraphicIntoContainer(container, 'graph TD', 'mermaid', 'live')
    expect(container.getAttribute(GRAPHIC_PROVIDER_ATTR)).toBe('builtin')
    expect(container.getAttribute(MERMAID_STATE_ATTR)).not.toBe('error')
  })

  it('live 发射 gate 按动态语言 + 生效管线：附加语言接入即发射、停用即回落源码', () => {
    const { bridge } = harness()
    const doc = '```draw\nX\n```\n'
    const state = EditorState.create({ doc, extensions: [mermaidFencesField] })
    const fences = state.field(mermaidFencesField).spans
    expect(fences[0]!.rendered).toBe(false)
    // 生效表带来 draw 语言 → 动态集 + 管线就位 → 发射
    bridge.register('pub.a', 1, specOf('r1', ['draw']))
    bridge.applyTable(table([{ language: 'draw', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] }]))
    setDynamicRenderedFenceLanguages(bridge.renderedFenceLanguages())
    const withProvider = buildMermaidDecorationRanges(EditorSelection.single(100), null, fences.map((f) => ({ ...f, rendered: true })))
    expect(withProvider).toHaveLength(1)
    // 停用：生效表回 none → 动态集与管线同时撤下 → 不发射
    bridge.applyTable(table([{ language: 'draw', effective: 'none' }], [], 2))
    setDynamicRenderedFenceLanguages(bridge.renderedFenceLanguages())
    const withoutProvider = buildMermaidDecorationRanges(EditorSelection.single(100), null, fences.map((f) => ({ ...f, rendered: true })))
    expect(withoutProvider).toHaveLength(0)
  })
})

describe('容器所有权热切换（旧结果不回潮）', () => {
  it('remountGraphicContainer：释放旧提供者、换新容器、旧容器脱离文档', () => {
    const { bridge } = harness()
    const log: MountRecord[] = []
    bridge.register('pub.a', 1, recordingSpec('r1', ['draw'], log))
    bridge.applyTable(table([{ language: 'draw', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] }]))
    const frame = document.createElement('div')
    const old = document.createElement('div')
    old.className = MERMAID_CLASS_NAMES.diagram
    old.setAttribute(GRAPHIC_LANG_ATTR, 'draw')
    old.setAttribute(MERMAID_CODE_ATTR, 'X')
    old.setAttribute(GRAPHIC_MODE_ATTR, 'reading')
    old.setAttribute(MERMAID_STATE_ATTR, 'rendered')
    old.setAttribute(GRAPHIC_PROVIDER_ATTR, 'pub.a/r1')
    frame.appendChild(old)
    document.body.appendChild(frame)
    // 切换生效者 → 换新容器
    bridge.applyTable(table([{ language: 'draw', effective: 'builtin' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] }], 2))
    const fresh = remountGraphicContainer(old, 'reading')
    expect(fresh).not.toBe(old)
    expect(old.isConnected).toBe(false)
    expect(fresh.isConnected).toBe(true)
    expect(log.map((e) => e.event)).toEqual(['release'])
    expect(fresh.getAttribute(GRAPHIC_PROVIDER_ATTR)).toBe('builtin')
  })

  it('remountChangedGraphicBlocks：仅重挂所有者已变的容器（等值幂等）', () => {
    document.body.innerHTML = ''
    const { bridge } = harness()
    const log: MountRecord[] = []
    bridge.register('pub.a', 1, recordingSpec('r1', ['mermaid'], log))
    bridge.applyTable(table([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    const container = document.createElement('div')
    container.className = MERMAID_CLASS_NAMES.diagram
    container.setAttribute(GRAPHIC_LANG_ATTR, 'mermaid')
    container.setAttribute(MERMAID_CODE_ATTR, 'X')
    container.setAttribute(GRAPHIC_MODE_ATTR, 'reading')
    container.setAttribute(MERMAID_STATE_ATTR, 'rendered')
    container.setAttribute(GRAPHIC_PROVIDER_ATTR, 'pub.a/r1')
    document.body.appendChild(container)
    remountChangedGraphicBlocks(document.body)
    // 生效者未变：零动作
    expect(log).toHaveLength(0)
    expect(document.querySelector(`[${GRAPHIC_LANG_ATTR}]`)).toBe(container)
    // 生效者变化：换新容器重挂（新提供者 builtin 接管 mermaid）
    bridge.applyTable(table([{ language: 'mermaid', effective: 'builtin' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }], 2))
    remountChangedGraphicBlocks(document.body)
    expect(log.map((e) => e.event)).toEqual(['release'])
    const next = document.querySelector<HTMLElement>(`[${GRAPHIC_LANG_ATTR}]`)!
    expect(next).not.toBe(container)
    expect(next.getAttribute(GRAPHIC_PROVIDER_ATTR)).toBe('builtin')
  })

  it('旧代次迟到结果只写脱离节点：接管后旧容器写入不进文档', () => {
    document.body.innerHTML = ''
    const { bridge } = harness()
    const log: MountRecord[] = []
    bridge.register('pub.a', 1, recordingSpec('r1', ['draw'], log))
    bridge.applyTable(table([{ language: 'draw', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] }]))
    const frame = document.createElement('div')
    const old = document.createElement('div')
    old.setAttribute(GRAPHIC_LANG_ATTR, 'draw')
    old.setAttribute(MERMAID_CODE_ATTR, 'X')
    old.setAttribute(GRAPHIC_MODE_ATTR, 'reading')
    old.setAttribute(GRAPHIC_PROVIDER_ATTR, 'pub.a/r1')
    frame.appendChild(old)
    document.body.appendChild(frame)
    bridge.applyTable(table([{ language: 'draw', effective: 'builtin' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] }], 2))
    const stale = remountGraphicContainer(old, 'reading')
    // 旧提供者的迟到写入（异步完成场景）落在脱离节点上——文档不受影响
    old.textContent = 'stale-late-result'
    expect(stale.textContent).not.toBe('stale-late-result')
    expect(old.isConnected).toBe(false)
  })
})

describe('主题联动 refresh（组件回调异常隔离）', () => {
  it('refresh 抛错不中断其余容器：退化重挂保内容、健康容器照常联动', () => {
    document.body.innerHTML = ''
    const { bridge } = harness()
    const log: MountRecord[] = []
    bridge.register('pub.a', 1, recordingSpec('r1', ['draw'], log, {
      refresh: () => { throw new Error('boom') },
    }))
    bridge.register('pub.a', 1, recordingSpec('r2', ['flow'], log))
    bridge.applyTable(table([
      { language: 'draw', effective: 'pub.a/r1' },
      { language: 'flow', effective: 'pub.a/r2' },
    ], [
      { addonId: 'pub.a', rendererId: 'r1', languages: ['draw'] },
      { addonId: 'pub.a', rendererId: 'r2', languages: ['flow'] },
    ]))
    const mk = (lang: string, provider: string) => {
      const el = document.createElement('div')
      el.className = MERMAID_CLASS_NAMES.diagram
      el.setAttribute(GRAPHIC_LANG_ATTR, lang)
      el.setAttribute(MERMAID_CODE_ATTR, 'X')
      el.setAttribute(GRAPHIC_MODE_ATTR, 'reading')
      el.setAttribute(MERMAID_STATE_ATTR, 'rendered')
      el.setAttribute(GRAPHIC_PROVIDER_ATTR, provider)
      document.body.appendChild(el)
      return el
    }
    const broken = mk('draw', 'pub.a/r1')
    const healthy = mk('flow', 'pub.a/r2')
    expect(() => refreshAddonGraphicBlocks(document.body)).not.toThrow()
    // 抛错容器：release 旧容器 → 换新 → 组件 mount 重建；健康容器：refresh 照常
    expect(log.map((e) => e.event)).toEqual(['release', 'mount', 'refresh'])
    expect(broken.isConnected).toBe(false)
    expect(healthy.isConnected).toBe(true)
  })
})

describe('内置 mermaid 扫描跳过组件容器', () => {
  it('isAddonOwned 语义经 setMermaidDarkTheme 路径钉住（组件容器不被内置重渲）', async () => {
    document.body.innerHTML = ''
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['mermaid']))
    bridge.applyTable(table([{ language: 'mermaid', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['mermaid'] }]))
    const addonOwned = document.createElement('div')
    addonOwned.className = MERMAID_CLASS_NAMES.diagram
    addonOwned.setAttribute(MERMAID_CODE_ATTR, 'graph TD')
    addonOwned.setAttribute(GRAPHIC_PROVIDER_ATTR, 'pub.a/r1')
    const builtinOwned = document.createElement('div')
    builtinOwned.className = MERMAID_CLASS_NAMES.diagram
    builtinOwned.setAttribute(MERMAID_CODE_ATTR, 'graph TD')
    builtinOwned.setAttribute(GRAPHIC_PROVIDER_ATTR, 'builtin')
    document.body.append(addonOwned, builtinOwned)
    // setMermaidDarkTheme 经 mermaid 模块的导出面驱动（暗色切换触发扫描）
    const { setMermaidDarkTheme, __setMermaidApiForTest, __resetMermaidRenderStateForTest } = await import('../../src/webview/mermaidRender')
    __resetMermaidRenderStateForTest()
    __setMermaidApiForTest({
      initialize: () => {},
      render: async () => ({ svg: '<svg data-builtin></svg>' }),
    })
    setMermaidDarkTheme(true)
    // 内置容器进入渲染（异步——等一拍后检查状态推进）；组件容器保持原样
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(addonOwned.getAttribute(GRAPHIC_PROVIDER_ATTR)).toBe('pub.a/r1')
    expect(addonOwned.querySelector('svg')).toBeNull()
    expect(builtinOwned.getAttribute(MERMAID_STATE_ATTR)).toBe('rendered')
    expect(builtinOwned.querySelector('svg')?.getAttribute('data-builtin')).not.toBeUndefined()
    setMermaidDarkTheme(false)
    __resetMermaidRenderStateForTest()
  })
})

describe('T12 渲染 mount 异常升级为全组件故障上报', () => {
  /** 故障上报收件（模块级注入槽——main.ts 在装载器安装后绑定） */
  function bindFaultSpy() {
    const faults: Array<{ addonId: string; stage: string; detail: string }> = []
    bindAddonFaultReporter((addonId, stage, detail) => {
      faults.push({ addonId, stage, detail })
      return true
    })
    return faults
  }

  it('生效提供者 mount 抛出未捕获异常 → 归因上报（组件/提供者/原因）且容器停留 error 态', () => {
    const faults = bindFaultSpy()
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['t12graph'], {
      mount: () => {
        throw new Error('mount boom')
      },
    }))
    bridge.applyTable(table([{ language: 't12graph', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['t12graph'] }]))
    const container = document.createElement('div')
    renderGraphicIntoContainer(container, 'X', 't12graph', 'live')
    expect(faults).toEqual([
      { addonId: 'pub.a', stage: 'renderer-mount', detail: 'pub.a/r1: Error: mount boom' },
    ])
    // 容器即时反馈保持 T09 口径（error 态）；停用与内置接管由宿主链路完成
    expect(container.getAttribute(MERMAID_STATE_ATTR)).toBe('error')
  })

  it('自处理渲染失败（组件捕获自己的异常画降级内容）→ 不上报：仍运行的 bug 不伪造停用（Q30 负向对照）', () => {
    const faults = bindFaultSpy()
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['t12graph'], {
      mount: (container) => {
        try {
          throw new Error('self-handled')
        } catch {
          ;(container as HTMLElement).dataset['content'] = 'DEGRADED'
        }
      },
    }))
    bridge.applyTable(table([{ language: 't12graph', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['t12graph'] }]))
    const container = document.createElement('div')
    expect(() => renderGraphicIntoContainer(container, 'X', 't12graph', 'live')).not.toThrow()
    expect(faults).toEqual([])
    expect(container.dataset['content']).toBe('DEGRADED')
    expect(container.getAttribute(MERMAID_STATE_ATTR)).toBe('rendered')
  })

  it('导出（exportSvg）异常返回失败结果不升级——导出失败是业务结局（T09 既定边界）', async () => {
    const faults = bindFaultSpy()
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['t12graph'], {
      exportSvg: async () => {
        throw new Error('export boom')
      },
    }))
    bridge.applyTable(table([{ language: 't12graph', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['t12graph'] }]))
    const result = await effectiveGraphicRendererFor('t12graph', 'live')!.renderSvg('X')
    expect(result).toEqual({ ok: false, message: 'Error: export boom' })
    expect(faults).toEqual([])
  })

  it('弹窗路径（GraphicRenderer.renderInto）mount 异常同样上报且不外溢', () => {
    const faults = bindFaultSpy()
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['t12graph'], {
      mount: () => {
        throw new Error('popup mount boom')
      },
    }))
    bridge.applyTable(table([{ language: 't12graph', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['t12graph'] }]))
    const renderer = effectiveGraphicRendererFor('t12graph', 'live')!
    const container = document.createElement('div')
    expect(() => renderer.renderInto(container, 'X')).not.toThrow()
    expect(faults).toEqual([
      { addonId: 'pub.a', stage: 'renderer-mount', detail: 'pub.a/r1: Error: popup mount boom' },
    ])
  })

  it('未绑定上报槽（旧装配）不炸——异常本地留痕保持 T09 容器口径', () => {
    bindAddonFaultReporter(undefined)
    const { bridge } = harness()
    bridge.register('pub.a', 1, specOf('r1', ['t12graph'], {
      mount: () => {
        throw new Error('no reporter')
      },
    }))
    bridge.applyTable(table([{ language: 't12graph', effective: 'pub.a/r1' }], [{ addonId: 'pub.a', rendererId: 'r1', languages: ['t12graph'] }]))
    const container = document.createElement('div')
    expect(() => renderGraphicIntoContainer(container, 'X', 't12graph', 'live')).not.toThrow()
    expect(container.getAttribute(MERMAID_STATE_ATTR)).toBe('error')
  })
})
