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
  IMAGE_RESIZE_HANDLE_BORDER,
  IMAGE_RESIZE_MIN_WIDTH,
  IMAGE_RESIZE_RESIZING_CLASS,
  attachResizeHandle,
  attachResizeHandleToLiveImage,
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

  it('百分比域内放大（150%）维持百分比（101%–1000% 合法域，规格 §3.4）', () => {
    // 固有宽 200，100% 起始渲染 200px；拖到 300px = 150%
    expect(computeResizeTarget({
      startWidth: 200,
      startHeight: 100,
      dx: 100,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: natural.width,
      naturalHeight: natural.height,
      containerWidth: 800,
    })).toEqual({ width: 150, height: null, unit: 'percent' })
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

describe('computeResizeTarget：百分比写回域（1–1000，越域改写像素形态）', () => {
  it('超上限：固有宽 20 拖到 210px → 写像素 210（不写 1050%——解析侧会判非法降级为别名，垃圾段累积）', () => {
    expect(computeResizeTarget({
      startWidth: 20,
      startHeight: 10,
      dx: 190,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: 20,
      naturalHeight: 10,
      containerWidth: 800,
    })).toEqual({ width: 210, height: null, unit: 'px' })
  })

  it('下溢：固有宽 4000 拖到 24px → 写像素 24（不钳 1% 导致松手渲染跳回 40px）', () => {
    expect(computeResizeTarget({
      startWidth: 4000,
      startHeight: 2000,
      dx: -3976,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: 4000,
      naturalHeight: 2000,
      containerWidth: 800,
    })).toEqual({ width: 24, height: null, unit: 'px' })
  })

  it('域内不变：固有宽 200 拖到 300px → 150%（维持百分比写回）', () => {
    expect(computeResizeTarget({
      startWidth: 200,
      startHeight: 100,
      dx: 100,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: 200,
      naturalHeight: 100,
      containerWidth: 800,
    })).toEqual({ width: 150, height: null, unit: 'percent' })
  })

  it('恰 1000%：固有宽 100 拖到 1000px → 1000%（边界含于域，走百分比不改像素）', () => {
    expect(computeResizeTarget({
      startWidth: 100,
      startHeight: 100,
      dx: 900,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: 100,
      naturalHeight: 100,
      containerWidth: 2000,
    })).toEqual({ width: 1000, height: null, unit: 'percent' })
  })

  it('恰 1%：固有宽 2400 拖到下界 24px → 1%（边界含于域，走百分比不改像素）', () => {
    expect(computeResizeTarget({
      startWidth: 2400,
      startHeight: 1200,
      dx: -2376,
      dy: 0,
      mode: 'proportional',
      declared: { width: 100, height: null, unit: 'percent' },
      naturalWidth: 2400,
      naturalHeight: 1200,
      containerWidth: 800,
    })).toEqual({ width: 1, height: null, unit: 'percent' })
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

  it('几何常量：视觉 12×12、热区 20×20、透明边框 4（TS 字面量锚点）', () => {
    expect(IMAGE_RESIZE_HANDLE_SIZE).toBe(12)
    expect(IMAGE_RESIZE_HIT_SIZE).toBe(20)
    expect(IMAGE_RESIZE_HANDLE_BORDER).toBe(4)
  })

  it('几何派生：热区 − 2×边框 = 视觉（三常量联动，改任一侧即漂移暴露）', () => {
    expect(IMAGE_RESIZE_HIT_SIZE - 2 * IMAGE_RESIZE_HANDLE_BORDER).toBe(IMAGE_RESIZE_HANDLE_SIZE)
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

  it('bareAlt（直链单段）：无管道且整段即尺寸 → 整段替换，不留旧数字进别名位', () => {
    const plan = planSizeSuffixRewrite('100', { width: 160, height: null, unit: 'px' }, { bareAlt: true })
    expect(plan).toEqual({ inner: '160', from: 0, to: 3, text: '160' })
    expect(replaceSizeSuffix('100', { width: 160, height: null, unit: 'px' }, { bareAlt: true })).toBe('160')
  })

  it('bareAlt：无管道且非尺寸（普通图注）→ 追加竖线段（既有行为不变）', () => {
    expect(replaceSizeSuffix('图注', { width: 160, height: null, unit: 'px' }, { bareAlt: true }))
      .toBe('图注|160')
  })

  it('双链路径（默认 bareAlt=false）：无管道的纯数字段是目标路径，不整段替换', () => {
    // `![[100]]` 的 100 是文件名不是尺寸段——整段替换会吞掉目标路径
    expect(replaceSizeSuffix('100', { width: 160, height: null, unit: 'px' })).toBe('100|160')
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

  it('嵌套方括号图注：配对到外层 ]，内层括号留在 alt（vsidianPR641-002）', () => {
    expect(innerSpanOfImageSource('![a [b] c](a.png)')).toEqual({ text: 'a [b] c', start: 2 })
    expect(innerSpanOfImageSource('![a [b [c] d] e](a.png)')).toEqual({ text: 'a [b [c] d] e', start: 2 })
  })

  it('转义方括号图注：\\[ \\] 不计入配对（vsidianPR641-002）', () => {
    expect(innerSpanOfImageSource('![a \\[b\\] c](a.png)')).toEqual({ text: 'a \\[b\\] c', start: 2 })
  })

  it('图注括号配不平（嵌套 [ 未闭合）返回 null（与 CommonMark 一致，不猜）', () => {
    expect(innerSpanOfImageSource('![a [b](a.png)')).toBeNull()
  })

  it('转义开括号不增深度：label 在其后首个 ] 正常闭合（CommonMark：\\[ 是字面 [）', () => {
    expect(innerSpanOfImageSource('![a \\[b](a.png)')).toEqual({ text: 'a \\[b', start: 2 })
  })

  it('成对反斜杠（\\\\ 是字面反斜杠）不转义后续字符：其后的 ] 是真括号参与配对（vsidianPR641-002 残余）', () => {
    // `![a \\](x.png)`：\\ 消费为一对（字面 \），] 未被转义 → label 在此闭合
    expect(innerSpanOfImageSource('![a \\\\](x.png)')).toEqual({ text: 'a \\\\', start: 2 })
  })

  it('成对反斜杠后的 ] 归零处不跟 (（CommonMark 判非图片）：降级 null，不把 b] 卷进 label', () => {
    // `![a \\] b](x.png)`：label [a \\] 闭合处后是空格 → 整体不是 inline image
    expect(innerSpanOfImageSource('![a \\\\] b](x.png)')).toBeNull()
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

  it('直链单段尺寸：![100](图.png) 拖到 160 → ![160](图.png)（alt 不残留旧数字）', () => {
    expect(rewriteImageSourceSuffix('![100](图.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![160](图.png)')
  })

  it('双链 ![[100]]（目标名恰为纯数字）仍追加，不吞目标路径', () => {
    expect(rewriteImageSourceSuffix('![[100]]', { width: 160, height: null, unit: 'px' }))
      .toBe('![[100|160]]')
  })

  it('形态不可识别返回 null（不猜、不改）', () => {
    expect(rewriteImageSourceSuffix('`![[图.png]]`', { width: 1, height: null, unit: 'px' })).toBeNull()
    expect(rewriteImageSourceSuffix('[[图.png]]', { width: 1, height: null, unit: 'px' })).toBeNull()
    expect(rewriteImageSourceSuffix('![a](x.png', { width: 1, height: null, unit: 'px' })).toBeNull()
  })

  it('嵌套方括号图注写回：尺寸追加到外层 label，内层括号与目标原样（vsidianPR641-002）', () => {
    expect(rewriteImageSourceSuffix('![a [b] c](a.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![a [b] c|160](a.png)')
    expect(rewriteImageSourceSuffix('![a [b [c] d] e](a.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![a [b [c] d] e|160](a.png)')
  })

  it('转义方括号图注写回：\\[ \\] 原样保留（vsidianPR641-002）', () => {
    expect(rewriteImageSourceSuffix('![a \\[b\\] c](a.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![a \\[b\\] c|160](a.png)')
  })

  it('目标 URL 含 ]：label 配对先于目标，既有行为不回归', () => {
    expect(rewriteImageSourceSuffix('![a](b]c.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![a|160](b]c.png)')
  })

  it('图注括号配不平时返回 null（不猜、不改）', () => {
    expect(rewriteImageSourceSuffix('![a [b](a.png)', { width: 160, height: null, unit: 'px' })).toBeNull()
  })

  it('成对反斜杠图注写回：label 在真 ] 闭合、\\\\ 原样保留（vsidianPR641-002 残余回归，R1 旧实现可通过）', () => {
    expect(rewriteImageSourceSuffix('![a \\\\](x.png)', { width: 160, height: null, unit: 'px' }))
      .toBe('![a \\\\|160](x.png)')
  })

  it('成对反斜杠后 ] 归零处不跟 (：非图片形态返回 null（旧栈式实现误把 b] 卷进 label）', () => {
    expect(rewriteImageSourceSuffix('![a \\\\] b](x.png)', { width: 160, height: null, unit: 'px' })).toBeNull()
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

describe('attachResizeHandle：拖动时序（jsdom + rect stub）', () => {
  /** jsdom 无指针事件几何与布局：rect 以实例覆写、事件以带 pointerId 的
   *  MouseEvent 模拟（listener 只读 button/clientX/clientY/shiftKey/pointerId） */
  class FakePointerEvent extends MouseEvent {
    readonly pointerId: number
    constructor(type: string, init: { pointerId: number; button?: number; clientX?: number; clientY?: number; shiftKey?: boolean; bubbles?: boolean }) {
      super(type, { button: init.button ?? 0, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, shiftKey: init.shiftKey ?? false, bubbles: init.bubbles ?? true })
      this.pointerId = init.pointerId
    }
  }

  const fire = (target: Window | Element, type: string, init: ConstructorParameters<typeof FakePointerEvent>[1]): void => {
    target.dispatchEvent(new FakePointerEvent(type, init))
  }

  /** 布局就绪的图相框（beginDrag 要求 rect 尺寸 > 0） */
  function laidOutFrame(): { frame: HTMLElement; img: HTMLImageElement } {
    const frame = document.createElement('span')
    frame.className = 'vsidian-image vsidian-graphic-frame'
    frame.dataset['vsidianImgState'] = 'loaded'
    const img = document.createElement('img')
    const rect = { width: 100, height: 50, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50, toJSON: () => ({}) } as DOMRect
    Object.defineProperty(img, 'getBoundingClientRect', { value: () => rect })
    Object.defineProperty(frame, 'getBoundingClientRect', { value: () => rect })
    frame.append(img)
    document.body.append(frame)
    return { frame, img }
  }

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('F5：containerWidth 仅 beginDrag 解析一次，pointermove 复用缓存值', () => {
    const { frame } = laidOutFrame()
    let resolves = 0
    attachResizeHandle(frame, {
      resolveStart: () => ({ declared: null }),
      onCommit: () => undefined,
      containerWidth: () => {
        resolves += 1
        return 800
      },
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    expect(resolves).toBe(1) // beginDrag 解析一次
    fire(window, 'pointermove', { pointerId: 7, clientX: 140, clientY: 70 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 180, clientY: 90 })
    expect(resolves).toBe(1) // move 路径不再解析（容器宽拖动期间不变）
    fire(window, 'pointerup', { pointerId: 7, clientX: 180, clientY: 90 })
    // 下一轮拖动重新解析（用户可能改了窗口/行宽）
    fire(handle, 'pointerdown', { pointerId: 8, clientX: 100, clientY: 50 })
    expect(resolves).toBe(2)
    fire(window, 'pointerup', { pointerId: 8, clientX: 100, clientY: 50 })
  })

  it('B6：拖动中源文滑移（commit 时读出与快照不一致）→ 安全放弃提交', () => {
    const { frame } = laidOutFrame()
    let source = '![[img.png|100]]'
    const committed: string[] = []
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    attachResizeHandleToLiveImage(frame, {
      readInner: () => source,
      commitInner: (_frame, _range, inner) => {
        committed.push(inner)
      },
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 160, clientY: 80 })
    // 模拟拖动中并发编辑滑移该区间：等长的另一条图片引用滑进来（形态
    // 仍合法——只靠 ![ 形态校验挡不住，会把无关引用的尾缀写坏）
    source = '![[tiny.png|75]]'
    fire(window, 'pointerup', { pointerId: 7, clientX: 160, clientY: 80 })
    expect(committed).toEqual([])
  })

  it('B6 对照：源文未变 → 正常提交（快照比对不误伤正常路径）', () => {
    const { frame } = laidOutFrame()
    const source = '![[img.png|100]]'
    const committed: string[] = []
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    attachResizeHandleToLiveImage(frame, {
      readInner: () => source,
      commitInner: (_frame, _range, inner) => {
        committed.push(inner)
      },
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 160, clientY: 80 })
    fire(window, 'pointerup', { pointerId: 7, clientX: 160, clientY: 80 })
    expect(committed).toEqual(['img.png|160'])
  })

  it('B6 直链单段尺寸提交走整段替换（内层 alt 100 → 160，不残留旧数字）', () => {
    const { frame } = laidOutFrame()
    const source = '![100](图.png)'
    const committed: string[] = []
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    attachResizeHandleToLiveImage(frame, {
      readInner: () => source,
      commitInner: (_frame, _range, inner) => {
        committed.push(inner)
      },
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 160, clientY: 80 })
    fire(window, 'pointerup', { pointerId: 7, clientX: 160, clientY: 80 })
    expect(committed).toEqual(['160'])
  })

  it('vsidianPR641-002：嵌套方括号图注的拖动写回不再静默失败', () => {
    const { frame } = laidOutFrame()
    const source = '![a [b] c](a.png)'
    const committed: string[] = []
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    attachResizeHandleToLiveImage(frame, {
      readInner: () => source,
      commitInner: (_frame, _range, inner) => {
        committed.push(inner)
      },
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 160, clientY: 80 })
    fire(window, 'pointerup', { pointerId: 7, clientX: 160, clientY: 80 })
    // 嵌套层首个 ] 不再被误判为 label 结束：内层括号原样、尺寸段完整
    expect(committed).toEqual(['a [b] c|160'])
  })

  it('vsidianPR641-001：资源刷新（slot 清空重建 img）后手柄重装且仅一份、操作新 img', () => {
    const source = '![[img.png|100]]'
    const committed: string[] = []
    const { frame } = laidOutFrame()
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    const attach = (): void => {
      attachResizeHandleToLiveImage(frame, {
        readInner: () => source,
        commitInner: (_frame, _range, inner) => {
          committed.push(inner)
        },
      })
    }
    attach()
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)).toHaveLength(1)
    const handle1 = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!

    // 模拟 LiveImageWidget 的资源 render 回调（invalidateAll/invalidate 后重
    // 走）：slot.textContent='' 删旧 img 与三件套，frame 不换、换新 img
    const refresh = (): HTMLImageElement => {
      frame.textContent = ''
      const img = document.createElement('img')
      const rect = { width: 100, height: 50, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50, toJSON: () => ({}) } as DOMRect
      Object.defineProperty(img, 'getBoundingClientRect', { value: () => rect })
      frame.append(img)
      attach()
      return img
    }
    const img2 = refresh()
    const handlesAfterRefresh = frame.querySelectorAll<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)
    expect(handlesAfterRefresh).toHaveLength(1)
    const handle2 = handlesAfterRefresh[0]!
    expect(handle2).not.toBe(handle1) // 重建而非复用
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.glow}`)).toHaveLength(1)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.readout}`)).toHaveLength(1)

    // 再刷一次仍恰好一份（连续多次刷新不堆积）
    const img3 = refresh()
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)).toHaveLength(1)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.glow}`)).toHaveLength(1)
    expect(frame.querySelectorAll(`.${IMAGE_RESIZE_CLASS_NAMES.readout}`)).toHaveLength(1)

    // 事件发往刷新后实际在场的当前手柄（按类名从 frame 重新查询）——向已
    // 离树的旧 handle2 发事件证明不了「最后在场的手柄可用」；写回须作用于
    // 本次刷新的新 img3，且不被旧手柄闭包改到 img2
    const handle3 = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    expect(handle3).not.toBe(handle2) // 又是一次重建，handle2 已离树
    fire(handle3, 'pointerdown', { pointerId: 9, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 9, clientX: 140, clientY: 70 })
    expect(img3.style.width).toBe('140px') // 拖动视觉落在当前在场 img 上
    expect(img2.style.width).toBe('') // 旧 img 不被已离树旧手柄的闭包改动
    fire(window, 'pointerup', { pointerId: 9, clientX: 140, clientY: 70 })
    expect(committed).toEqual(['img.png|140'])
  })

  it('vsidianPR641-001 残余：拖动进行中资源刷新，拆除链同步清 frame 拖动态类与读数显隐', () => {
    const source = '![[img.png|100]]'
    const { frame } = laidOutFrame()
    frame.dataset['vsidianSrcFrom'] = '0'
    frame.dataset['vsidianSrcTo'] = String(source.length)
    const attach = (): void => {
      attachResizeHandleToLiveImage(frame, {
        readInner: () => source,
        commitInner: () => undefined,
      })
    }
    attach()
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    fire(window, 'pointermove', { pointerId: 7, clientX: 130, clientY: 60 })
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(true) // beginDrag 挂类
    expect(
      frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.readout}`)?.dataset['visible'],
    ).toBe('true') // 读数显示中

    // 拖动进行中恰逢资源刷新：slot 清空重建 img 后重装。拆除链已卸下 window
    // 监听，此后无人处理 pointerup、不走 cleanupDrag——拖动态修饰类与读数
    // 显隐必须由拆除链同步复位，否则相框停在异色描边/手柄常显的拖动态
    frame.textContent = ''
    const img = document.createElement('img')
    const rect = { width: 100, height: 50, x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 50, toJSON: () => ({}) } as DOMRect
    Object.defineProperty(img, 'getBoundingClientRect', { value: () => rect })
    frame.append(img)
    attach()
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(false) // 类已清
    expect(
      frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.readout}`)?.dataset['visible'],
    ).toBeUndefined() // 新装配的读数不残留显示态

    // 迟到的 pointerup 已无监听消费，不影响已恢复的正常悬停态
    fire(window, 'pointerup', { pointerId: 7, clientX: 130, clientY: 60 })
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(false)
  })

  it('正常拖动路径：松手与 Esc 均清拖动态类（cleanupDrag 行为不因拆除链改动）', () => {
    const { frame } = laidOutFrame()
    attachResizeHandle(frame, {
      resolveStart: () => ({ declared: null }),
      onCommit: () => undefined,
    })
    const handle = frame.querySelector<HTMLElement>(`.${IMAGE_RESIZE_CLASS_NAMES.handle}`)!
    // 松手清类
    fire(handle, 'pointerdown', { pointerId: 7, clientX: 100, clientY: 50 })
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(true)
    fire(window, 'pointerup', { pointerId: 7, clientX: 120, clientY: 60 })
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(false)
    // Esc 取消同样清类
    fire(handle, 'pointerdown', { pointerId: 8, clientX: 100, clientY: 50 })
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(frame.classList.contains(IMAGE_RESIZE_RESIZING_CLASS)).toBe(false)
  })
})

describe('main.css 手柄与光晕规则（#636 契约）', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

  it('手柄热区/边框/视觉与 TS 常量联动（改常量即暴露 CSS 漂移）', () => {
    const rule = cssRule(css, '#app .vsidian-image-resize-handle')
    // 断言值由 TS 常量派生：调任一常量而 CSS 未跟，本断言随常量联动失败，
    // 防止 TS 与 CSS 各改各的（border 值同源于 IMAGE_RESIZE_HANDLE_BORDER）
    expect(rule).toMatch(new RegExp(`width:\\s*${IMAGE_RESIZE_HIT_SIZE}px`))
    expect(rule).toMatch(new RegExp(`height:\\s*${IMAGE_RESIZE_HIT_SIZE}px`))
    expect(rule).toMatch(new RegExp(`border:\\s*${IMAGE_RESIZE_HANDLE_BORDER}px solid transparent`))
    expect(rule).toMatch(/background-clip:\s*padding-box/)
    expect(rule).toMatch(/cursor:\s*nwse-resize/)
    // 默认不常驻
    expect(rule).toMatch(/opacity:\s*0/)
    expect(rule).toMatch(/visibility:\s*hidden/)
  })

  it('光晕为边线光带、不占布局（absolute + pointer-events:none + 深度变量）', () => {
    const rule = cssRule(css, '#app .vsidian-image-resize-glow')
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/pointer-events:\s*none/)
    // 底边与右边两条向内递减的渐变光带：色标含深度变量（无该变量的漂移即暴露）
    expect(rule).toMatch(/linear-gradient\(to top,[^;]*calc\(var\(--vsidian-image-resize-glow/)
    expect(rule).toMatch(/linear-gradient\(to left,[^;]*calc\(var\(--vsidian-image-resize-glow/)
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
