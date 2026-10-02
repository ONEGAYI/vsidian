// #292 骨架屏内联装配契约（TDD 先行）：样式/标记由宿主 buildWebviewHtml
// 拼入初始 HTML（覆盖外链 CSS/JS 到达前的空窗①）。本文件钉住装配形态——
// 宽度口径引用 Live 变量（Q4/Q9）、扫光延时/周期与撤除计划同源常量、
// reduced-motion 降级、provider 打点与测试冻结门控的接线。
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildSkeletonBodyHtml,
  buildSkeletonStyleHtml,
  readableLineWidthPreset,
} from '../../src/host/skeletonScreen'
import {
  SKELETON_ELEMENT_ID,
  SKELETON_SHIMMER_CYCLE_MS,
  SKELETON_SHIMMER_DELAY_MS,
} from '../../src/shared/skeletonTiming'

const providerSource = readFileSync(
  new URL('../../src/host/textEditorProvider.ts', import.meta.url),
  'utf8',
)

describe('buildSkeletonStyleHtml（#292 内联样式）', () => {
  const css = buildSkeletonStyleHtml()

  it('宽度口径：骨架列引用 Live 限宽变量，不复制读值', () => {
    expect(css).toContain('max-width: var(--vsidian-live-preview-max-width)')
  })

  it('扫光延时与周期来自共享常量（与撤除计划同源）', () => {
    expect(css).toContain(`animation: vsidian-skeleton-sweep ${SKELETON_SHIMMER_CYCLE_MS}ms linear infinite`)
    expect(css).toContain(`animation-delay: ${SKELETON_SHIMMER_DELAY_MS}ms`)
  })

  it('reduced-motion 降级：关闭扫光（等价动画未开始，就绪即撤）', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/)
  })

  it('纯内联自包含：不引用任何外部资源（外链 CSS 未到达也要有骨架）', () => {
    expect(css).not.toContain('url(')
  })

  it('挂载收编定位包含块类在场（宿主类把模式容器变为 relative）', () => {
    expect(css).toContain('.vsidian-skeleton-host')
    expect(css).toContain('position: relative')
  })

  it('骨架本体不拦截指针事件（正文未就绪前无可交互内容）', () => {
    expect(css).toContain('pointer-events: none')
  })
})

describe('buildSkeletonBodyHtml（#292 内联标记）', () => {
  const html = buildSkeletonBodyHtml()

  it('单实例容器：稳定 id + 公开类 + 对辅助技术隐藏', () => {
    expect(html).toContain(`id="${SKELETON_ELEMENT_ID}"`)
    expect(html).toContain('class="vsidian-skeleton"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('通用固定灰块序列（不读文档内容）：块数充足且只含骨架类', () => {
    const blocks = html.match(/class="vsidian-skeleton-block"/g) ?? []
    expect(blocks.length).toBeGreaterThanOrEqual(6)
    expect(html).toContain('vsidian-skeleton-column')
  })
})

describe('readableLineWidthPreset（#292 宽度预注入取值）', () => {
  it('非 0 有效值返回整数像素', () => {
    expect(readableLineWidthPreset(600)).toBe(600)
    expect(readableLineWidthPreset(620.0)).toBe(620)
  })

  it('0（铺满档）、缺失与非数值一律不预注入', () => {
    expect(readableLineWidthPreset(0)).toBeNull()
    expect(readableLineWidthPreset(undefined)).toBeNull()
    expect(readableLineWidthPreset('600')).toBeNull()
    expect(readableLineWidthPreset(-20)).toBeNull()
  })
})

describe('宿主装配接线（provider 词法钉住）', () => {
  it('buildWebviewHtml 拼入骨架样式与标记', () => {
    expect(providerSource).toContain('buildSkeletonStyleHtml()')
    expect(providerSource).toContain('buildSkeletonBodyHtml()')
  })

  it('呈现时刻打点：main.js 之前写骨架呈现时刻全局（模板插值形态）', () => {
    expect(providerSource).toContain('window.${SKELETON_SHOWN_AT_GLOBAL} = performance.now()')
  })

  it('测试冻结门控：hold 全局仅在 VSIDIAN_TEST_HOOKS=1 时嵌入', () => {
    // 门控两段钉住：调用侧以 env 判定传参；模板内按参数条件拼接嵌入脚本
    expect(providerSource).toContain('window.${SKELETON_HOLD_GLOBAL} = true')
    expect(providerSource).toContain("holdSkeleton: process.env.VSIDIAN_TEST_HOOKS === '1'")
  })
})
