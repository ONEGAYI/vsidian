// #571（T06）表单与音视频的原生交互防线（Reading 承载原生交互的边界件）：
// - 表单提交守卫：编辑器 webview 是编辑器本体，任何 submit（渲染自笔记
//   HTML 的 form——Reading 块/嵌入卡/悬停浮层/Live widget 内容）都会把
//   整个 webview 导航走且无表单后端可接——一律 preventDefault（规格「不
//   承诺表单后端」「提交/导航遵循真实宿主策略」：视图内输入/选择/展开/
//   播放保留，提交动作不产生导航）。document 捕获相位单一守卫覆盖全部
//   现有与未来承载面（编辑器 UI 自身无 form 元素，零误伤）。
// - 媒体释放：块卸载/视图释放（binding.dispose）后无持续播放——DOM 移除
//   不自动暂停（Chromium 实测语义），须显式 pause + src 剥除 + load()
//   复位（重跑资源选择算法且无候选——中止在途请求、释放解码器；图片
//   槽位 src 清空同款纪律）。模式切换暂停（pauseHtmlMedia）：只停不释
//   放——块仍挂载，回切不重置装载与进度。

/** 装载期剥离记忆属性名（htmlResourceMount 媒体装载语义写入；释放时清理） */
const MEDIA_MEMO_ATTRS = ['data-vsidian-media-src', 'data-vsidian-media-poster']

/** 守卫已安装标记（幂等——同 document 重复安装零动作） */
const guardedDocuments = new WeakSet<Document>()

/**
 * 安装表单提交守卫（幂等）：document 捕获相位拦截 submit 事件。捕获相位
 * 不依赖容器层级——浮层（document.body 直挂）与阅读容器/Live widget 内容
 * 同一守卫覆盖。生产装配点：WebviewSyncController.mount（生产控制器唯一
 * 入口——浏览器测试 fixture 直驱控制器时同样生效）。
 */
export function installHtmlSubmitGuard(doc: Document): void {
  if (guardedDocuments.has(doc)) {
    return
  }
  guardedDocuments.add(doc)
  doc.addEventListener('submit', (event) => {
    // 不区分 target：编辑器 webview 内不存在合法的表单提交后端
    event.preventDefault()
  }, true)
}

/** 收集子树（含根自身）的媒体元素 */
function mediaElementsOf(root: ParentNode): Array<HTMLMediaElement> {
  const out: HTMLMediaElement[] = []
  const visit = (el: Element): void => {
    if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
      out.push(el as HTMLMediaElement)
    }
  }
  visit(root as Element)
  for (const el of Array.from(root.querySelectorAll('video, audio'))) {
    visit(el)
  }
  return out
}

/** 已释放媒体登记（幂等——重复释放零动作；元素随 DOM 丢弃自动失键） */
const releasedMedia = new WeakSet<HTMLMediaElement>()

/**
 * 释放一个 DOM 子树的媒体（块卸载/视图释放/Live widget destroy）：pause +
 * src 剥除（video/audio 与 source 子元素）+ load() 复位 + 剥离记忆清理。
 * 幂等（binding dispose 与 widget destroy 双路径可达——同元素只释放一次）；
 * 无媒体子树零动作。元素即将被丢弃——不恢复原文（重挂载路径从块
 * html 字符串重建 DOM，见 VirtualReadingView/widget toDOM）。
 */
export function releaseHtmlMedia(root: ParentNode): void {
  for (const el of mediaElementsOf(root)) {
    if (releasedMedia.has(el)) {
      continue
    }
    releasedMedia.add(el)
    el.pause()
    el.removeAttribute('src')
    for (const source of Array.from(el.querySelectorAll('source'))) {
      source.removeAttribute('src')
    }
    for (const attr of MEDIA_MEMO_ATTRS) {
      el.removeAttribute(attr)
    }
    // 复位资源选择：无候选 → networkState 归零、在途请求中止、解码器释放
    el.load()
  }
}

/**
 * 暂停一个 DOM 子树的媒体（模式切换：reading↔live 双向）。只 pause 不剥
 * 离 src——块仍挂载（隐藏容器），回切原模式不重置装载与播放进度。
 */
export function pauseHtmlMedia(scope: ParentNode): void {
  for (const el of mediaElementsOf(scope)) {
    el.pause()
  }
}
