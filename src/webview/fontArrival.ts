// 字体晚到监听（#130）：CSS 片段样式表经 <link> 装载成功时，其中的
// @font-face 字体（本地相对路径或远程 https）通常尚未装载完成——浏览器
// 在样式应用后按需拉取字体，完成时机晚于 link 的 load 事件。#128 的即时
// 重测（scheduleSnippetMeasure）可能早于字体生效，行高/字号变化后的视口
// 测量与滚动锚定需要等字体集稳定再补一轮。
//
// 语义（jsdom 假件驱动契约见 test/unit/fontArrival.test.ts；真实 Chromium
// 布局上的重测与锚定效果由 test/browser/cssHttpsImports.mjs 验证）：
// - 以 document.fonts.ready 为时机信号：resolve 即当前批次装载结束
//  （成功或失败——字体加载失败也会让 ready settle，回调照常执行，正文
//   以备用字体可读即达成）；
// - 有界多轮（上限 3）：ready 后等一帧（布局消费字体，可能启动新装载，
//   如阅读视口重挂载用到第二个字体族），status 回到 loading 则再等一批；
// - 环境无 FontFaceSet（旧 jsdom）退化为立即回调；
// - running 期间重复 schedule 合并（不并发两轮）；dispose 后不再回调。
export interface FontSetLike {
  readonly status?: string
  readonly ready: Promise<unknown>
}

export interface FontArrivalWatch {
  /** 请求一次「字体集稳定后」回调；装载成功回调已在途时合并 */
  schedule(): void
  dispose(): void
}

/** 多轮上限：一轮 ready + 帧间隙重启 + 收尾，防御异常字体集空转 */
const MAX_PASSES = 3

export function createFontArrivalWatch(
  getFonts: () => FontSetLike | undefined,
  onSettled: () => void,
): FontArrivalWatch {
  let running = false
  let rerunRequested = false
  let disposed = false

  const nextFrame = (): Promise<void> =>
    new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
      } else {
        setTimeout(resolve, 0)
      }
    })

  const run = async (): Promise<void> => {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const fonts = getFonts()
      if (!fonts) {
        break // 无字体集：立即稳定（退化路径）
      }
      try {
        await fonts.ready
      } catch {
        break // 异常字体集：不吞回调，仍重测一次（正文可读优先）
      }
      await nextFrame()
      const after = getFonts()
      if (!after || after.status !== 'loading') {
        break
      }
      // 帧间隙有新装载启动（晚到的第二个字体族）：再等一批
    }
    if (!disposed) {
      onSettled()
    }
  }

  return {
    schedule(): void {
      if (disposed) {
        return
      }
      if (running) {
        rerunRequested = true
        return
      }
      running = true
      void run().finally(() => {
        running = false
        // running 期间的重复 schedule 只在「确有新装载在途」时补一轮
        // （新片段应用启动了新批次）；空闲时的重复请求合并进本次回调
        if (rerunRequested && !disposed && getFonts()?.status === 'loading') {
          rerunRequested = false
          this.schedule()
        } else {
          rerunRequested = false
        }
      })
    },
    dispose(): void {
      disposed = true
    },
  }
}
