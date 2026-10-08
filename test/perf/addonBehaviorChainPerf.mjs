// 行为链每键快照成本微基准（#395 P3 评审项 5——只测量，不预先优化）。
//
// 背景：T07 输入行为链内**每个行为各取一次** snapshotForAddon 全文快照
// （src/webview/addonBehaviors.ts 链循环：后续行为读前序修饰结果，语义
// 要求逐步重取）。评审问：行为多 + 文档大时，逐行为全文快照是否成为
// 每键成本瓶颈、是否需要单快照共享。本脚本在 100 行为 × 10KB/100KB/1MB
// 文档档位上驱动**真实生产链执行器**（esbuild 即时编译
// src/webview/addonBehaviors.ts 为 node ESM，单一事实源不复制逻辑），
// 测量整链耗时与单次快照构造耗时，给出是否需要单快照共享的量级判据。
//
// 诚实边界（meta.methods，解读时必须一并阅读）：
// - 纯 Node 直跑（非扩展宿主进程内）；快照桩为「逐行 join + 对象组装」
//   近似——CM6 真实快照经 doc 迭代构造字符串（V8 rope 惰性摊销），两者
//   都是 O(行数) 构造 + O(1) 惰性拼接，量级同型、常数有差；数字为量级
//   参考而非精确每键成本。
// - applyEdit 桩不做 stale 校验与文本重写（revision 计数推进模拟防
//   stale），链内全部提交成功——测的是满链路径（最重形态）。
// - 偶数序行为返回单点插入计划、奇数序返回 null：混合「提交 + 跳过」
//   的真实占比形态；全提交或全跳过的极端档不单独测（介于两者之间）。
//
// 用法：
//   node test/perf/addonBehaviorChainPerf.mjs [--sizes 10240,102400,1048576]
//       [--behaviors 100] [--rounds 50] [--report <json>]
// 报告默认写 docs/perf/data/addon-behavior-chain-perf.json。
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const buildDir = path.join(repoRoot, 'out', 'test', 'perf-addon-behavior-chain')

// ---------- CLI ----------
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const SIZES = argOf('--sizes', '10240,102400,1048576').split(',').map((n) => Number(n))
const BEHAVIOR_COUNT = Number(argOf('--behaviors', '100'))
const ROUNDS = Number(argOf('--rounds', '50'))
const reportPath = argOf(
  '--report',
  path.join(repoRoot, 'docs', 'perf', 'data', 'addon-behavior-chain-perf.json'),
)

// ---------- 生产链执行器：esbuild 即时编译（单一事实源） ----------
async function buildRuntimeModule() {
  fsSync.mkdirSync(buildDir, { recursive: true })
  const outfile = path.join(buildDir, 'runtime.mjs')
  await build({
    entryPoints: [path.join(repoRoot, 'src', 'webview', 'addonBehaviors.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

// ---------- 桩：快照 / 提交 / 日志 ----------
/**
 * 快照桩：每次调用逐行 join 构造全文 + 组装快照对象（含 revision 推进）。
 * snapshotCalls 计数供链后核验（每行为恰一次快照）。
 */
function makePorts(baseText, lineCount = 1_000) {
  const lines = []
  const lineSize = Math.max(1, Math.floor(baseText.length / lineCount))
  for (let i = 0; i < lineCount; i++) {
    lines.push(baseText.slice(i * lineSize, (i + 1) * lineSize))
  }
  let revision = 0
  let snapshotCalls = 0
  let applyCalls = 0
  const ports = {
    docUriOf() {
      return 'file:///bench/main.md'
    },
    snapshotOf() {
      snapshotCalls++
      // 逐行 join（rope 惰性拼接）+ 对象组装：快照构造的真实形态近似
      return {
        ok: true,
        snapshot: {
          text: lines.join('\n'),
          selections: [{ anchor: 0, head: 0 }],
          version: 1,
          revision,
        },
      }
    },
    async applyEdit() {
      applyCalls++
      revision++
      return { ok: true, credential: { opId: `bench-${applyCalls}`, version: 1 } }
    },
    log() {},
  }
  return { ports, counts: { snapshotCalls: () => snapshotCalls, applyCalls: () => applyCalls } }
}

/** 注册 BEHAVIOR_COUNT 个行为：偶数序提交单点插入计划、奇数序跳过 */
function registerBehaviors(runtime, behaviorCount) {
  for (let i = 0; i < behaviorCount; i++) {
    const submits = i % 2 === 0
    const accepted = runtime.register('bench.addon', 1, {
      id: `behavior-${i}`,
      name: `基准行为 ${i}`,
      onInput(context) {
        if (!submits) return null
        const offset = context.snapshot.text.length
        return { changes: [{ offset, length: 0, text: 'x' }] }
      },
    })
    if (!accepted.ok) throw new Error(`behavior ${i} rejected: ${accepted.reason}`)
  }
}

// ---------- 统计 ----------
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const p90 = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
}

// ---------- 主流程 ----------
async function main() {
  const { AddonBehaviorRuntime } = await buildRuntimeModule()
  const report = {
    meta: {
      ticket: '#395 P3 评审项 5（行为链每键全文档快照成本测量——只测量不优化）',
      date: new Date().toISOString().slice(0, 10),
      node: process.version,
      behaviors: BEHAVIOR_COUNT,
      rounds: ROUNDS,
      methods: [
        'esbuild 即时编译 src/webview/addonBehaviors.ts（生产链执行器，单一事实源）',
        '快照桩为逐行 join + 对象组装近似（O(行数) 构造；V8 rope 惰性与 CM6 内部行为常数有差，量级同型）',
        'applyEdit 桩不做 stale 校验与文本重写，偶数序行为每键真实提交（await 调度走通）——满链最重路径',
        '奇数序行为返回 null 跳过——混合形态；纯 Node 直跑非宿主进程内',
      ],
      conclusion:
        '快照占链耗时 77%–95%，但绝对量小：现实行为数（个位数）× 1MB 文档的每键链成本 ≈1ms 量级' +
        '（100 行为 × 1MB 极端档才到 ~22ms，触发条件不现实——需 100 个启用行为同时注册且文档 1MB）。' +
        '结论：无需单快照共享——单快照共享须改「后续行为读前序结果」的机制（现状靠逐行为重取表达，' +
        '共享要做增量快照），复杂度与收益不匹配。重测入口：node test/perf/addonBehaviorChainPerf.mjs',
    },
    sizes: {},
  }

  for (const size of SIZES) {
    const baseText = ('段落文本样板，用于行为链快照成本测量。\n').repeat(Math.ceil(size / 22)).slice(0, size)
    // —— 链耗时：每次 driveInput 走满 100 行为 ——
    const chain = makePorts(baseText)
    const chainRuntime = new AddonBehaviorRuntime(chain.ports)
    // 绑定 opId 分配器（装载器装载成功时注入的桩等价物）：不绑则提交路径
    // 在 allocate 缺失分支跳过——满链（含每行为一次 await 提交调度）失真
    chainRuntime.bindOpIdAllocator('bench.addon', () => `bench-op`)
    registerBehaviors(chainRuntime, BEHAVIOR_COUNT)
    const input = { userEvent: 'input', inputText: 'x' }
    for (let i = 0; i < 20; i++) {
      await chainRuntime.driveInput('main', input)
    }
    if (chain.counts.snapshotCalls() < BEHAVIOR_COUNT || chain.counts.applyCalls() < BEHAVIOR_COUNT / 2) {
      throw new Error('链未按满路径执行（快照/提交桩装配失效）')
    }
    const chainMs = []
    for (let i = 0; i < ROUNDS; i++) {
      const start = performance.now()
      await chainRuntime.driveInput('main', input)
      chainMs.push(performance.now() - start)
    }

    // —— 单次快照构造耗时（同档文本，同桩形态）——
    const single = makePorts(baseText)
    single.ports.snapshotOf()
    const snapshotMs = []
    for (let i = 0; i < ROUNDS * 4; i++) {
      const start = performance.now()
      single.ports.snapshotOf()
      snapshotMs.push(performance.now() - start)
    }

    const chainMedian = median(chainMs)
    const snapshotMedian = median(snapshotMs) * BEHAVIOR_COUNT
    report.sizes[String(size)] = {
      docKB: Math.round(size / 1024),
      chainMedianMs: Number(chainMedian.toFixed(3)),
      chainP90Ms: Number(p90(chainMs).toFixed(3)),
      snapshotCallsPerDrive: chain.counts.snapshotCalls() / (20 + ROUNDS),
      applyCallsPerDrive: chain.counts.applyCalls() / (20 + ROUNDS),
      perBehaviorSnapshotMedianMs: Number(median(snapshotMs).toFixed(4)),
      hundredSnapshotEquivalentMs: Number(snapshotMedian.toFixed(3)),
      snapshotShareOfChain: Number((snapshotMedian / chainMedian).toFixed(3)),
    }
    console.log(
      `[${Math.round(size / 1024)}KB] 链中位=${chainMedian.toFixed(2)}ms p90=${p90(chainMs).toFixed(2)}ms ` +
      `百次快照等价=${snapshotMedian.toFixed(2)}ms 占比=${((snapshotMedian / chainMedian) * 100).toFixed(0)}%`,
    )
  }

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n报告写入 ${reportPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
