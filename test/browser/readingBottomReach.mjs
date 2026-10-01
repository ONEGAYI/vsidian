// #259 长文档滚动到底回归套件：真实 Chromium + 生产控制器 + 产物 CSS。
// Reading 主视图滚轮式滚动到平衡点后，断言用户能到达真实文档末尾：
//   B1 末块（唯一标记段）可见：rect.bottom 进入容器视口
//   B2 底部 spacer 已收缩（窗口覆盖尾块后 spacer ≈ 0）
//   B3 scrollTop 达到 scrollHeight − clientHeight（恒差 ≤ 2px）
// 诊断输出：平衡点恒差数值与滚动尾部 spacer 高度序列（估计↔实测翻转
// 视为漂移重估覆写形态，恒定偏大视为静态高估形态——修复验证取证用）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, artifactPath, chromium } from './runtime.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const output = artifactPath(root, 'readingBottomReach/readingBottomReach.js')
await build({ entryPoints: [path.join(root, 'test/browser/readingBottomReachFixture.ts')],
  bundle: true, outfile: output, format: 'iife',
  loader: { '.svg': 'file' }, assetNames: 'assets/[name]' })

const browser = await chromium.launch({ headless: true,
  channel: process.env.VSIDIAN_TEST_BROWSER_CHANNEL || undefined })
const failures = []
const check = (name, ok, detail) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`)
  if (!ok) failures.push(`${name}: ${detail}`)
}
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent('<div id="app"></div>')
  await page.addStyleTag({ path: output.replace(/\.js$/, '.css') })
  await page.addScriptTag({ path: output })

  // 300 段异质长文：交替单行短段与多行（显式换行）长段，穿插标题——
  // 制造换行率的区域差异（标定中位数随窗口样本摆动的真实载体）；
  // 末尾放唯一标记段，滚到底的可见性判据。
  const paras = []
  for (let i = 0; i < 300; i++) {
    if (i % 10 === 0) paras.push(`## 章节 ${i}`)
    if (i % 2 === 0) {
      paras.push(`第 ${i} 段短文本。`)
    } else {
      paras.push(`第 ${i} 段长文本首行。\n第二行内容用来拉开块高。\n第三行继续增加行数差异。`)
    }
  }
  paras.push('ZZLASTZZ 唯一末段标记')
  const DOC = paras.join('\n\n') + '\n'
  await page.evaluate((text) => window.initBottomReach(text), DOC)
  await page.evaluate(() => window.setBrMode('reading'))
  await page.waitForSelector('.vsidian-reading-block p')

  // 滚轮式循环滚动到平衡点：每轮 +120px（约 3-4 格滚轮），双 rAF 等
  // scroll→rAF→updateNow 收敛；连续 5 轮 scrollTop 不变视为平衡点。
  const result = await page.evaluate(async () => {
    const container = document.querySelector('.vsidian-view-reading')
    if (!container) return { error: '未找到 .vsidian-view-reading' }
    const spacerOf = (cls) => Number.parseFloat(
      container.querySelector(`.vsidian-reading-spacer-${cls}`)?.style.height || '0')
    const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const trace = []
    let stall = 0
    let last = -1
    for (let i = 0; i < 500; i++) {
      container.scrollTop = Math.min(container.scrollTop + 120, container.scrollHeight)
      await raf2()
      if (container.scrollTop === last) {
        stall += 1
        if (stall >= 5) break
      } else {
        stall = 0
      }
      last = container.scrollTop
      trace.push({
        i, scrollTop: container.scrollTop, scrollHeight: container.scrollHeight,
        spTop: spacerOf('top'), spBottom: spacerOf('bottom'),
      })
    }
    // 尾部 spacer 序列（诊断输出：估计↔实测翻转 vs 恒定偏大的形态区分）
    const tail = trace.slice(-24)
    // 强制顶到底后逐帧观测（回归 #259 次级缺陷：回收-占位中间态使浏览器
    // clamp 压低 scrollTop 且无人补回——末尾意图保持修复后应稳定在末端）
    const probe = []
    container.scrollTop = container.scrollHeight
    for (let f = 0; f < 8; f++) {
      await raf2()
      probe.push({
        f, st: container.scrollTop, H: container.scrollHeight,
        spT: spacerOf('top'), spB: spacerOf('bottom'),
        mounted: container.querySelectorAll('.vsidian-reading-block').length,
      })
    }
    const lastBlock = [...container.querySelectorAll('.vsidian-reading-block')]
      .find((b) => b.textContent?.includes('ZZLASTZZ')) ?? null
    const cRect = container.getBoundingClientRect()
    const bRect = lastBlock?.getBoundingClientRect() ?? null
    return {
      rounds: trace.length,
      tail,
      probe,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      lastBlockVisible: lastBlock !== null && bRect !== null
        && bRect.bottom <= cRect.bottom + 2,
      lastBlockBottom: bRect ? bRect.bottom - cRect.bottom : null,
      spTop: spacerOf('top'),
      spBottom: spacerOf('bottom'),
    }
  })

  if (result.error) {
    check('B0 Reading 容器就绪', false, result.error)
  } else {
    const gap = result.scrollHeight - result.clientHeight - result.scrollTop
    const tailStr = result.tail.map((t) =>
      `#${t.i} st=${t.scrollTop.toFixed(0)} H=${t.scrollHeight.toFixed(0)} spB=${t.spBottom.toFixed(0)}`).join(' | ')
    console.log(`[诊断] 滚动轮次=${result.rounds} 尾部序列：${tailStr}`)
    console.log(`[诊断] 强制到底逐帧：${result.probe.map((p) =>
      `f${p.f} st=${p.st.toFixed(0)} H=${p.H.toFixed(0)} spT=${p.spT.toFixed(0)} spB=${p.spB.toFixed(0)} m=${p.mounted}`).join(' | ')}`)
    const ch = result.clientHeight
    const probeMin = Math.min(...result.probe.map((p) => p.st))
    const probeEnd = Math.max(...result.probe.map((p) => p.H - ch))
    check('B1 末块可见（滚到真实文档末尾）',
      result.lastBlockVisible,
      `末块 bottom 超出容器底 ${result.lastBlockBottom === null ? 'null（未挂载）' : result.lastBlockBottom.toFixed(1)}px`)
    check('B2 底部 spacer 收缩至 ≈0（尾块进入窗口实测）',
      result.spBottom < 2,
      `spacerBottom=${result.spBottom.toFixed(1)}px`)
    check('B3 scrollTop 到达滚动末端（恒差消除）',
      gap <= 2,
      `恒差=${gap.toFixed(1)}px`)
    // B4：强制顶到底（程序化 scrollTop=scrollHeight，等效 clamp 到末端）后
    // 连续帧不得回退——回收-占位中间态的 clamp 损失必须被末尾意图保持补回
    check('B4 强制到底后不回退（末尾意图保持）',
      result.probe.every((p) => p.H - ch - p.st <= 2),
      `8 帧内最小 scrollTop=${probeMin.toFixed(1)}（末端 ${probeEnd.toFixed(1)}）`)
  }
  check('页面无脚本错误', errors.length === 0, JSON.stringify(errors))
  if (failures.length > 0) {
    console.error(`readingBottomReach: ${failures.length} 条断言红`)
    process.exitCode = 1
  } else {
    console.log('readingBottomReach: 全部断言通过（长文档可滚到真实末尾）')
  }
} finally {
  await browser.close()
}
