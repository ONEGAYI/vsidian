// @vitest-environment jsdom
// Callout 图标装载契约（#657/T06）：--callout-icon 公开变量的净化、决策与
// DOM 应用机制。净化复用 htmlSanitize 单一事实源（DOMPurify），图标语境
// 追加外链/引用元素剥离；非法值保留默认图标并给出可查诊断（console.warn
// 既有口径 + 可注入诊断 sink——TestDiagnostics 观测面）。jsdom 只验证机制
// （inline 自定义属性计算值可用），真实层叠（:where 类型表 → 继承 → 计算值）
// 与绘制证据在浏览器用例 calloutIcon.mjs。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CALLOUT_ICON_CUSTOM_CLASS,
  applyCalloutIcon,
  decideCalloutIcon,
  mountCalloutIcons,
  sanitizeCalloutIconSvg,
  setCalloutIconDiagnosticsSink,
} from '../../src/webview/calloutIconMount'

afterEach(() => {
  setCalloutIconDiagnosticsSink(undefined)
  vi.restoreAllMocks()
})

/** 造一个带 --callout-icon 计算值的图标元素（挂进 DOM 才有 computed 值） */
function makeIcon(type: string, value?: string): HTMLElement {
  const line = document.createElement('div')
  line.setAttribute('data-callout', type)
  const icon = document.createElement('span')
  icon.className = 'callout-icon'
  line.append(icon)
  document.body.append(line)
  if (value !== undefined) {
    line.style.setProperty('--callout-icon', value)
  }
  return icon
}

describe('sanitizeCalloutIconSvg：净化面与图标语境剥离', () => {
  it('纯几何 SVG 原样保留（描边/填充/viewBox）', () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='10' /></svg>"
    expect(sanitizeCalloutIconSvg(svg)).toContain('<circle')
  })

  it('脚本与事件被剥离（不越净化面：剩几何可呈现）', () => {
    const out = sanitizeCalloutIconSvg(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' onload='alert(1)'><script>alert(2)</script><path d='M1 2' /></svg>")
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onload')
    expect(out).toContain('<path')
  })

  it('外链一律剥离：a/image/use 元素移除，非 # 片段的 href 属性移除', () => {
    const out = sanitizeCalloutIconSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<a href="https://evil.example/x"><path d="M0 0"/></a>' +
      '<image href="http://evil.example/track.png" />' +
      '<use xlink:href="http://evil.example/glyph" />' +
      '<defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs>' +
      '<rect fill="url(#g)" width="4" height="4"/></svg>')
    expect(out).not.toContain('<a')
    expect(out).not.toContain('<image')
    expect(out).not.toContain('<use')
    expect(out).not.toContain('evil.example')
    // 内部引用（渐变 url(#g)）保留——非外链
    expect(out).toContain('linearGradient')
    expect(out).toContain('url(#g)')
  })

  it('净化后无有效 svg 根 → null（调用方按非法值处理）', () => {
    expect(sanitizeCalloutIconSvg('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeCalloutIconSvg('')).toBeNull()
  })
})

describe('decideCalloutIcon：默认/注入/非法三态', () => {
  it('空值与「等于该类型默认图标」→ default（默认 mask 通道已画同款，零 DOM 改动）', () => {
    expect(decideCalloutIcon('', 'lucide-pencil')).toEqual({ action: 'default' })
    expect(decideCalloutIcon('lucide-flame', 'lucide-flame')).toEqual({ action: 'default' })
    // 默认值经别名/大小写归一后相等同样跳过
    expect(decideCalloutIcon('Flame', 'lucide-flame')).toEqual({ action: 'default' })
  })

  it('锁版集合内的 ID → 注入库内 SVG', () => {
    const d = decideCalloutIcon('lucide-bug', 'lucide-pencil')
    expect(d.action).toBe('inject')
    if (d.action === 'inject') {
      expect(d.svg).toContain('<svg')
      expect(d.svg).toContain("stroke='currentColor'")
    }
  })

  it('未知 ID → invalid（保留默认 + 可查诊断语义）', () => {
    const d = decideCalloutIcon('lucide-rocket', 'lucide-pencil')
    expect(d.action).toBe('invalid')
    if (d.action === 'invalid') {
      expect(d.reason).toContain('lucide-rocket')
    }
  })

  it('SVG 字符串：净化成功注入，净化后无内容 → invalid', () => {
    const ok = decideCalloutIcon(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M1 1' /></svg>",
      'lucide-pencil')
    expect(ok.action).toBe('inject')
    const bad = decideCalloutIcon(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><script>alert(1)</script><a href='https://x.example'>y</a></svg>",
      'lucide-pencil')
    expect(bad.action).toBe('invalid')
  })

  it('垃圾值 → invalid', () => {
    expect(decideCalloutIcon('!!!', 'lucide-pencil').action).toBe('invalid')
  })
})

describe('applyCalloutIcon / mountCalloutIcons：DOM 应用与诊断', () => {
  it('注入：加内部类 + innerHTML 装配 SVG；值清除后恢复默认（类移除、内容清空）', () => {
    const icon = makeIcon('note', 'lucide-bug')
    applyCalloutIcon(icon)
    expect(icon.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(true)
    expect(icon.innerHTML).toContain('<svg')

    ;(icon.parentElement as HTMLElement).style.setProperty('--callout-icon', '')
    applyCalloutIcon(icon)
    expect(icon.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(false)
    expect(icon.innerHTML).toBe('')
  })

  it('默认值跳过注入（类型表自带的默认 --callout-icon 与默认图标一致 → mask 通道）', () => {
    const icon = makeIcon('note', 'lucide-pencil')
    applyCalloutIcon(icon)
    expect(icon.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(false)
    expect(icon.innerHTML).toBe('')
  })

  it('非法值保留默认图标并给可查诊断（console.warn + sink；同键去重不刷屏）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: Array<{ stage: string; data: Record<string, unknown> }> = []
    setCalloutIconDiagnosticsSink((stage, data) => events.push({ stage, data }))
    const icon = makeIcon('note', 'lucide-rocket')
    applyCalloutIcon(icon)
    applyCalloutIcon(icon) // 第二次同值：去重
    expect(icon.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(false)
    expect(icon.innerHTML).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain('[vsidian]')
    expect(String(warn.mock.calls[0]![0])).toContain('lucide-rocket')
    expect(events).toHaveLength(1)
    expect(events[0]!.stage).toBe('callout.icon.invalid')
    expect(events[0]!.data).toMatchObject({ type: 'note', value: 'lucide-rocket' })
    // 值变化后同类型再诊断（新键）
    ;(icon.parentElement as HTMLElement).style.setProperty('--callout-icon', 'lucide-star')
    applyCalloutIcon(icon)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('mountCalloutIcons：批量解析 root 下全部图标（阅读块挂载口径）', () => {
    const root = document.createElement('div')
    for (const [type, value] of [['note', 'lucide-bug'], ['tip', undefined]] as const) {
      const line = document.createElement('div')
      line.setAttribute('data-callout', type)
      const icon = document.createElement('span')
      icon.className = 'callout-icon'
      line.append(icon)
      root.append(line)
      if (value) {
        line.style.setProperty('--callout-icon', value)
      }
    }
    document.body.append(root)
    mountCalloutIcons(root)
    const [noteIcon, tipIcon] = [...root.querySelectorAll('.callout-icon')]
    expect(noteIcon!.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(true)
    expect(tipIcon!.classList.contains(CALLOUT_ICON_CUSTOM_CLASS)).toBe(false)
  })
})
