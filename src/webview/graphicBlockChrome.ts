// 图形化代码块右上角按钮组（工单 #111）：edit（编辑源码，仅实时预览）
// 与 popup（弹窗预览，双视图）两枚纯图标按钮，悬停显现由 CSS 承担（规格
// 契约 1）。实时预览 widget 与阅读挂载钩子共用（liveCodeCard.buildCopyButton
// 同款风格：内联 SVG、mousedown preventDefault 防抢焦点、aria-label/title
// 走 t()）。按钮 DOM 是路径级通用件——语言差异只体现在回调，由注册表
// 驱动的调用方注入。
import { t } from '../shared/i18n'
import { IMAGE_CLASS_NAMES } from './imageResource'

export const GRAPHIC_CHROME_CLASS_NAMES = {
  /** 渲染容器与按钮组的定位包裹层（position:relative 宿主） */
  frame: 'vsidian-graphic-frame',
  /** 按钮组根（absolute 右上；仅在渲染成功态显示，CSS 兄弟选择器驱动） */
  chrome: 'vsidian-graphic-chrome',
  edit: 'vsidian-graphic-chrome-edit',
  popup: 'vsidian-graphic-chrome-popup',
} as const

export interface GraphicChromeActions {
  /** 编辑源码（仅实时预览装配——派发选区进围栏触发源码显形；阅读视图
   *  不提供该按钮） */
  onEdit?: () => void
  /** 弹窗预览（打开图表弹窗） */
  onPopup: () => void
}

function buildChromeButton(
  className: string,
  labelKey: 'graphic.editSource' | 'graphic.popup',
  icon: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  const label = t(labelKey)
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.innerHTML = icon
  // 阻断 CM6 的点击落位（live 侧防误触；阅读侧无副作用），与卡片按钮同款
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  btn.addEventListener('click', () => {
    onClick()
  })
  return btn
}

const EDIT_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5.5 4L2 8l3.5 4"></path><path d="M10.5 4L14 8l-3.5 4"></path>' +
  '<path d="M8.8 3.5L7.2 12.5"></path></svg>'

const POPUP_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"></rect>' +
  '<path d="M6 2.5v3M2.5 6h3"></path><path d="M9.5 13.5v-3M13.5 9.5h-3"></path></svg>'

/** 按钮组 DOM：edit（可选，居左）+ popup（居右） */
export function buildGraphicChrome(actions: GraphicChromeActions): HTMLElement {
  const chrome = document.createElement('div')
  chrome.className = GRAPHIC_CHROME_CLASS_NAMES.chrome
  chrome.setAttribute('role', 'group')
  if (actions.onEdit) {
    chrome.appendChild(
      buildChromeButton(GRAPHIC_CHROME_CLASS_NAMES.edit, 'graphic.editSource', EDIT_ICON, actions.onEdit),
    )
  }
  chrome.appendChild(
    buildChromeButton(GRAPHIC_CHROME_CLASS_NAMES.popup, 'graphic.popup', POPUP_ICON, actions.onPopup),
  )
  return chrome
}

/** 把既有渲染容器包进定位 frame 并挂按钮组（阅读挂载钩子用；幂等——
 *  已是 frame 子节点则原样返回）。frame 上不携带渲染语义，仅承担
 *  position:relative 与按钮宿主，重渲染只清空内层容器。 */
export function wrapGraphicFrame(inner: HTMLElement, actions: GraphicChromeActions): HTMLElement {
  const existing = inner.parentElement
  if (existing && existing.classList.contains(GRAPHIC_CHROME_CLASS_NAMES.frame)) {
    return existing
  }
  const frame = document.createElement('div')
  frame.className = GRAPHIC_CHROME_CLASS_NAMES.frame
  inner.replaceWith(frame)
  frame.append(inner, buildGraphicChrome(actions))
  return frame
}

/** 图片 frame 的贴图收缩标记（#212 按钮贴图修复，live/阅读两侧装配处
 *  共用）：loaded 后按「图渲染宽窄于 frame 宽」toggle sized 修饰类——
 *  chrome 是 absolute 右上、贴 frame 右缘，独行块级 frame 撑满行宽时
 *  图窄于行按钮就飞离图面；sized 令 frame 收缩贴图。判定用渲染几何而
 *  非 naturalWidth：百分比宽 SVG（width='100%'）的 naturalWidth 是 300
 *  伪值且渲染宽跟随包含块撑满（撑满即正确），被钳制大图渲染宽也等于
 *  行宽（收缩与否同果）——两者都不满足「窄于」条件天然不挂，前者的
 *  块级撑满基准（塌缩修复语义）因此不被 fit-content 化破坏。load 监听
 *  常驻（invalidate 重取后新 load 重算）随 img 生命周期回收；离屏构建
 *  期（阅读虚拟化）rect 全 0，经 ResizeObserver 等获得布局后首算 */
export function markImageFrameSized(frame: HTMLElement, img: HTMLElement): void {
  // 分母用父级 content 宽（clientWidth 减水平 padding）而非 frame 自身
  // 宽：它是 frame 撑满宽的精确对应（live 父级 .cm-line 带 2px 水平
  // padding，直接取 rect 宽会大出 padding，撑满图被误判「窄于行」），
  // 也不用 frame 当前宽——sized 生效后 frame 收缩贴图，用自身宽重算
  // 「图窄于 frame」自我否定（挂上即翻转的振荡）。content 宽不受
  // fit-content 影响，判定幂等收敛且可逆（重取后换成百分比宽 SVG 时
  // 正确退出收缩、恢复撑满基准）。首算必须等图真装载完成：百分比宽
  // SVG 装载前以 naturalWidth 伪值（如 300）呈现，早算会误挂 sized，
  // fit-content 下其百分比语义随后解析为 0 且 load 后重算 0<可用宽
  // 死锁保持挂（塌缩回归）——装载完成交由 load 监听首算
  const apply = () => {
    const parent = frame.parentElement
    let available = 0
    if (parent) {
      const style = getComputedStyle(parent)
      available = parent.clientWidth
        - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
    }
    frame.classList.toggle(
      IMAGE_CLASS_NAMES.sized,
      img.getBoundingClientRect().width < available - 1,
    )
  }
  const ready = img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
  // load 常驻（invalidate 重取后新 load 重算标记；监听随 img 回收）
  img.addEventListener('load', apply)
  // error 摘除（review-loops P3-4）：成功→失效→重取失败链上没有新
  // load，sized 残留会让 error 呈现（src 已清、内容收缩）从撑满行窄化
  // 成小点、重试点击目标随之缩小——error 态摘类恢复撑满框；重试成功
  // 后随新 load 重挂
  img.addEventListener('error', () => frame.classList.remove(IMAGE_CLASS_NAMES.sized))
  if (frame.getBoundingClientRect().width > 0) {
    if (ready) {
      apply()
    }
    return // 布局就绪但图未装载：等 load 首算
  }
  // 离屏构建期（阅读虚拟化块先构建后插入文档、live widget 插入前的
  // toDOM 期）：rect 全 0，几何判定不可信且此后无触发点——ResizeObserver
  // 等 frame 获得布局后（图已装载才）首算并撤观察（元素退场即撤）；
  // jsdom 等无 RO 环境退化为仅 load 重算（布局后首个 load 事件兜底）
  if (typeof ResizeObserver === 'undefined') {
    return
  }
  const ro = new ResizeObserver(() => {
    if (!frame.isConnected) {
      ro.disconnect()
      return
    }
    if (frame.getBoundingClientRect().width > 0) {
      ro.disconnect()
      if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) {
        apply()
      }
    }
  })
  ro.observe(frame)
}
