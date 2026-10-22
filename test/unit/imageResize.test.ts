// 图片拖动手柄契约（#636）：拖动目标计算、光晕延伸、手柄几何与源文尾缀
// 改写纯逻辑。规格单一事实源：docs/specs/image-resize.md §5、§6、§9.1。
//
// 纯函数部分不依赖真实布局与 DOM（jsdom 仅用于 attach 的静态断言）；
// 拖动期间「只改视觉、松手一次性写回」的交互时序由浏览器验收覆盖。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { cssRule } from './cssContract'
import {
  IMAGE_RESIZE_CLASS_NAMES,
  IMAGE_RESIZE_HANDLE_SIZE,
  IMAGE_RESIZE_HIT_SIZE,
  IMAGE_RESIZE_MIN_WIDTH,
  attachResizeHandle,
  computeResizeTarget,
  glowExtension,
  innerSpanOfImageSource,
  planSizeSuffixRewrite,
  replaceSizeSuffix,
  resizeHandleLayout,
  rewriteImageSourceSuffix,
} from '../../src/webview/imageResize'

beforeEach(() => {
  installLocale('zh-cn', zhCn)
})

describe('computeResizeTarget：等比模式', () => {
  const natural = { width: 200, height: 100 }

  it('无后缀拖动 → 像素宽度、等比（height 为 null）', () => {
    expect(computeResizeTarget({
      startWidth: 120,
      startHeight: 60,
      dx: 30,
      dy: 0,
      mode: 'proportional',
      declared: null,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      containerWidth: 800,
    })).toEqual({ width: 150, height: null, unit: 'px' })
  })

  it('已有 |W 声明 → 保持像素单位、只写宽度', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 50,
      dx: 60,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'px' },
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      containerWidth: 800,
    })).toEqual({ width: 160, height: null, unit: 'px' })
  })

  it('原写作为百分比 → 结果仍是百分比（按同一缩放因子推进）', () => {
    // 固有宽 200，50% 起始渲染 100px；拖到 150px = 75%
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 50,
      dx: 50,
      dy: 0,
      mode: 'proportional',
      declared: { width: 50, height: null, unit: 'percent' },
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      containerWidth: 800,
    })).toEqual({ width: 75, height: null, unit: 'percent' })
  })

  it('原写作为 |WxH → 两轴等比缩放，不丢高度（|100x80 拖到 200 写 200x160）', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 80,
      dx: 100,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: 80, unit: 'px' },
      naturalWidth: 200,
      naturalHeight: 160,
      containerWidth: 800,
    })).toEqual({ width: 200, height: 160, unit: 'px' })
  })

  it('等比模式忽略纵向位移（宽度驱动）', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 50,
      dx: 20,
      dy: 500,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'px' },
      naturalWidth: 200,
      naturalHeight: 100,
      containerWidth: 800,
    })).toEqual({ width: 120, height: null, unit: 'px' })
  })
})

describe('computeResizeTarget：自由双轴（Shift）', () => {
  it('两轴各自跟随位移，一律像素 |WxH', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 50,
      dx: 40,
      dy: 30,
      mode: 'free',
      declared: { width: 100, height: null, unit: 'px' },
      naturalWidth: 200,
      naturalHeight: 100,
      containerWidth: 800,
    })).toEqual({ width: 140, height: 80, unit: 'px' })
  })

  it('百分比声明下 Shift 也写像素双轴（显式框语义）', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 50,
      dx: 25,
      dy: -10,
      mode: 'free',
      declared: { width: 50, height: null, unit: 'percent' },
      naturalWidth: 200,
      naturalHeight: 100,
      containerWidth: 800,
    })).toEqual({ width: 125, height: 40, unit: 'px' })
  })
})

describe('computeResizeTarget：尺寸界', () => {
  const base = {
    startWidth: 100,
    startHeight: 50,
    mode: 'proportional' as const,
    declared: { width: 100, height: null, unit: 'px' as const },
    naturalWidth: 200,
    naturalHeight: 100,
    containerWidth: 800,
  }

  it('最小宽 24px 保底（等比）', () => {
    expect(computeResizeTarget({ ...base, dx: -500, dy: 0 }).width).toBe(IMAGE_RESIZE_MIN_WIDTH)
  })

  it('最小宽 24px 保底（自由模式）', () => {
    expect(computeResizeTarget({ ...base, mode: 'free', dx: -500, dy: 0 })).toEqual({
      width: 24,
      height: 50,
      unit: 'px',
    })
  })

  it('最大宽钳到容器内容宽', () => {
    expect(computeResizeTarget({ ...base, dx: 5000, dy: 0, containerWidth: 300 }).width).toBe(300)
  })

  it('容器宽小于 24 时最小宽优先（不产出小于 24 的框）', () => {
    expect(computeResizeTarget({ ...base, dx: 5000, dy: 0, containerWidth: 10 }).width).toBe(24)
  })

  it('容器宽未知（0 / 非有限）时不做最大宽钳制', () => {
    expect(computeResizeTarget({ ...base, dx: 5000, dy: 0, containerWidth: 0 }).width).toBe(5100)
    expect(computeResizeTarget({ ...base, dx: 5000, dy: 0, containerWidth: Number.NaN }).width).toBe(5100)
  })

  it('自由模式高度不低于 1px', () => {
    expect(computeResizeTarget({ ...base, mode: 'free', dx: 0, dy: -500 }).height).toBe(1)
  })

  it('WxH 等比高度同样不低于 1px（极端扁框）', () => {
    // 起点 100×1（用户显式声明了极扁的框）：拖到最小宽 24 时按 0.01 比例
    // 只剩 0.24px，必须钳到 1px 而不是产出 0
    const result = computeResizeTarget({
      ...base,
      startHeight: 1,
      dx: -500,
      dy: 0,
      declared: { width: 100, height: 1, unit: 'px' },
    })
    expect(result.width).toBe(24)
    expect(result.height).toBe(1)
  })
})

describe('glowExtension：光晕延伸距离', () => {
  it('小图走 24px 保底', () => {
    expect(glowExtension(100, 100)).toBe(24)
    expect(glowExtension(200, 50)).toBe(24)
  })

  it('大图走短边 10%', () => {
    expect(glowExtension(1000, 1000)).toBe(100)
    expect(glowExtension(600, 800)).toBe(60)
  })

  it('宽图以短边为基数（982x169 → max(24, 16.9) = 24）', () => {
    expect(glowExtension(982, 169)).toBe(24)
  })

  it('退化输入回落到保底值', () => {
    expect(glowExtension(0, 0)).toBe(24)
    expect(glowExtension(Number.NaN, 500)).toBe(24)
    expect(glowExtension(-10, 500)).toBe(24)
  })
})

describe('resizeHandleLayout：贴右下角内侧、与圆角同心', () => {
  it('无圆角时贴角（right/bottom 为 0）', () => {
    expect(resizeHandleLayout({ width: 300, height: 200 })).toEqual({ right: 0, bottom: 0 })
  })

  it('圆角半径大于热区半径时按同心偏移（中心落在弧心）', () => {
    // 热区 20，弧心距边 16 → 热区盒 right/bottom = 16 - 10 = 6
    expect(resizeHandleLayout({ width: 300, height: 200, radius: 16 })).toEqual({ right: 6, bottom: 6 })
  })

  it('圆角小于热区半径时钳到 0（不产出负偏移）', () => {
    expect(resizeHandleLayout({ width: 300, height: 200, radius: 4 })).toEqual({ right: 0, bottom: 0 })
  })

  it('几何常量：视觉 12×12、热区 20×20', () => {
    expect(IMAGE_RESIZE_HANDLE_SIZE).toBe(12)
    expect(IMAGE_RESIZE_HIT_SIZE).toBe(20)
  })
})

describe('planSizeSuffixRewrite / replaceSizeSuffix：尾缀改写', () => {
  it('无后缀 → 追加 |W（改动文本含竖线，写回形态与手写一致）', () => {
    const plan = planSizeSuffixRewrite('图.png', { width: 160, height: null, unit: 'px' })
    expect(plan).toEqual({ inner: '图.png|160', from: 5, to: 5, text: '|160' })
    expect(replaceSizeSuffix('图.png', { width: 160, height: null, unit: 'px' })).toBe('图.png|160')
  })

  it('已有 |W → 替换末段', () => {
    expect(planSizeSuffixRewrite('图.png|100', { width: 160, height: null, unit: 'px' }))
      .toEqual({ inner: '图.png|160', from: 5, to: 9, text: '|160' })
  })

  it('别名 + 尺寸 → 只替换末段，别名原样保留', () => {
    expect(replaceSizeSuffix('图.png|说明|100x80', { width: 200, height: 160, unit: 'px' }))
      .toBe('图.png|说明|200x160')
  })

  it('别名无尺寸 → 追加，不动别名', () => {
    expect(replaceSizeSuffix('图.png|说明', { width: 160, height: null, unit: 'px' }))
      .toBe('图.png|说明|160')
  })

  it('尾名为非法尺寸值（|0、|2000%）时仍按别名追加，不吞用户写的段', () => {
    // 解析侧（parseImageSizeSuffix）判非法即归别名——写回侧必须同口径，
    // 否则用户写的 `|0` 会被静默替换成尺寸
    expect(replaceSizeSuffix('图.png|0', { width: 160, height: null, unit: 'px' }))
      .toBe('图.png|0|160')
    expect(replaceSizeSuffix('图.png|2000%', { width: 160, height: null, unit: 'px' }))
      .toBe('图.png|2000%|160')
  })

  it('尾部空竖线 → 替换空段而不是拼出 ||', () => {
    expect(replaceSizeSuffix('图.png|', { width: 160, height: null, unit: 'px' })).toBe('图.png|160')
  })

  it('百分比写回带 %，双轴写回带 x', () => {
    expect(replaceSizeSuffix('图.png', { width: 75, height: null, unit: 'percent' })).toBe('图.png|75%')
    expect(replaceSizeSuffix('图.png|100', { width: 120, height: 90, unit: 'px' })).toBe('图.png|120x90')
  })
})

describe('innerSpanOfImageSource：定位内层（最小编辑的前提）', () => {
  it('双链嵌入：内层起点为 3（跳过 ![[）', () => {
    expect(innerSpanOfImageSource('![[图.png|100]]')).toEqual({ text: '图.png|100', start: 3 })
  })

  it('Markdown 直链：内层为 alt 文本，起点为 2（跳过 ![）', () => {
    expect(innerSpanOfImageSource('![图注|100](img.png)')).toEqual({ text: '图注|100', start: 2 })
  })

  it('形态不可识别返回 null', () => {
    expect(innerSpanOfImageSource('[[图.png]]')).toBeNull()
    expect(innerSpanOfImageSource('![a](x.png')).toBeNull()
    expect(innerSpanOfImageSource('![a]x.png)')).toBeNull()
  })
})

describe('rewriteImageSourceSuffix：整段源文改写只动内层', () => {
  it('双链嵌入保留 ![[…]] 包裹', () => {
    expect(rewriteImageSourceSuffix('![[图.png|100]]', { width: 200, height: null, unit: 'px' }))
      .toBe('![[图.png|200]]')
    expect(rewriteImageSourceSuffix('![[图.png]]', { width: 200, height: null, unit: 'px' }))
      .toBe('![[图.png|200]]')
  })

  it('Markdown 直链保留目标路径与括号（目标内含成对括号）', () => {
    expect(rewriteImageSourceSuffix('![图注](img.png)', { width: 200, height: null, unit: 'px' }))
      .toBe('![图注|200](img.png)')
    expect(rewriteImageSourceSuffix('![a|100](x(1).png)', { width: 50, height: null, unit: 'percent' }))
      .toBe('![a|50%](x(1).png)')
  })

  it('形态不可识别返回 null（不猜、不改）', () => {
    expect(rewriteImageSourceSuffix('`![[图.png]]`', { width: 1, height: null, unit: 'px' })).toBeNull()
    expect(rewriteImageSourceSuffix('[[图.png]]', { width: 1, height: null, unit: 'px' })).toBeNull()
    expect(rewriteImageSourceSuffix('![a](x.png', { width: 1, height: null, unit: 'px' })).toBeNull()
  })
})


describe('attachResizeHandle：DOM 装配', () => {
  let frame: HTMLElement

  beforeEach(() => {
    frame = document.createElement('span')
    frame.className = 'vsidian-image vsidian-graphic-frame'
    frame.dataset['vsidianImgState'] = 'loaded'
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    frame.append(img)
    document.body.append(frame)
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('挂手柄、光晕与读数三件套，幂等不重复', () => {
    const opts = {
      resolveStart: () => ({ declared: null }),
      onCommit: () => undefined,
      containerWidth: () => 800,
    }
    expect(attachResizeHandle(frame, opts)).toBe(true)
    expect(attachResizeHandle(frame, opts)).toBe(true)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)).toHaveLength(1)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.glow}`)).toHaveLength(1)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.readout}`)).toHaveLength(1)
  })

  it('手柄 aria-label 经 t()（中文包）', () => {
    attachResizeHandle(frame, {
      resolveStart: () => ({ declared: null }),
      onCommit: () => undefined,
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)
    expect(handle?.getAttribute('aria-label')).toBe('调整图片大小')
  })

  it('光晕延伸距离写入自定义属性（无布局的 jsdom 走 24 保底）', () => {
    attachResizeHandle(frame, {
      resolveStart: () => ({ declared: null }),
      onCommit: () => undefined,
    })
    expect(frame.style.getPropertyValue('--vsidian-image-resize-glow')).toBe('24px')
  })
})

describe('main.css 手柄与光晕规则（#636 契约）', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

  it('手柄 20×20 热区、4px 透明边框收出 12×12 视觉、光标 nwse-resize', () => {
    const rule = cssRule(css, '#app .vsidian-image-resize-handle')
    expect(rule).toMatch(/width:\s*20px/)
    expect(rule).toMatch(/height:\s*20px/)
    expect(rule).toMatch(/border:\s*4px solid transparent/)
    expect(rule).toMatch(/background-clip:\s*padding-box/)
    expect(rule).toMatch(/cursor:\s*nwse-resize/)
    // 默认不常驻
    expect(rule).toMatch(/opacity:\s*0/)
    expect(rule).toMatch(/visibility:\s*hidden/)
  })

  it('光晕沿圆角轮廓、不占布局（absolute + pointer-events:none + 半径变量）', () => {
    const rule = cssRule(css, '#app .vsidian-image-resize-glow')
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/pointer-events:\s*none/)
    expect(rule).toMatch(/box-shadow:[^;]*var\(--vsidian-image-resize-glow/)
    expect(rule).toMatch(/clip-path:\s*circle\(/)
  })

  it('悬停显现且拖动中排除光晕（互斥不靠层叠顺序）', () => {
    const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
    const hover = blocks.filter((block) => (block.split('{')[0] ?? '').includes(
      ':not(.vsidian-image-resizing):hover > .vsidian-image-resize-handle',
    ))
    expect(hover, '悬停显现规则应存在且拖动中排除').toHaveLength(1)
    expect(hover[0]).toMatch(/opacity:\s*1/)
    expect(hover[0]).toMatch(/visibility:\s*visible/)
  })

  it('拖动中整框 focusBorder 描边，同时光晕隐去（互斥）', () => {
    const frame = cssRule(css, '#app .vsidian-image.vsidian-image-resizing')
    expect(frame).toMatch(/outline:\s*1px solid var\(--vscode-focusBorder/)
    const glow = cssRule(css, '#app .vsidian-image.vsidian-image-resizing > .vsidian-image-resize-glow')
    expect(glow).toMatch(/opacity:\s*0/)
    expect(glow).toMatch(/visibility:\s*hidden/)
  })

  it('loaded 态门控：加载中/失败态不呈现手柄与光晕', () => {
    const rule = cssRule(
      css,
      '#app .vsidian-image:not([data-vsidian-img-state="loaded"]) > .vsidian-image-resize-glow',
    )
    expect(rule).toMatch(/display:\s*none/)
  })

  it('读数默认隐藏、拖动中显示（data-visible），配色走浮层变量', () => {
    const readout = cssRule(css, '#app .vsidian-image-resize-readout')
    expect(readout).toMatch(/display:\s*none/)
    expect(readout).toMatch(/background:\s*var\(--vscode-editorWidget-background/)
    expect(cssRule(css, '#app .vsidian-image-resize-readout[data-visible="true"]')).toMatch(/display:\s*block/)
  })
})
