// 引用索引基准语料生成器（工单 #195）。
//
// 生成 1千/1万/10万篇三档 Markdown 语料（确定性随机，seed 固定可复现），
// 链接形态混排：双链（根内相对路径 + 同目录短名）/普通内联链接/图片/
// 引用式链接定义/断链/HTTPS；另生成少量附件占位文件作为非 Markdown 目标。
//
// 语料本身不提交进仓库，落工作树外的独立目录（默认
// D:\CODE\Project\_ForExplore\vsidian-194-bench，可用 --out 覆盖）；
// 本脚本提交进仓库保证可复现。生成统计写 <out>/gen-stats-<tier>.json，
// 基准侧抽取计数与它交叉验证。
//
// 用法：node test/perf/vaultIndexGen.mjs [--out <dir>] [--only 1k|10k|100k]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** mulberry32 确定性 PRNG：同 seed 同序列，保证语料可复现。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TIERS = {
  '1k': { files: 1_000, seed: 20260928 },
  '10k': { files: 10_000, seed: 20260929 },
  '100k': { files: 100_000, seed: 20260930 },
}

const AREA_COUNT = 24
const TOPIC_WORDS = ['设计', '研究', '笔记', '会议', '架构', '方案', '调研', '复盘', '总结', '草稿', '规范', '索引',
  '实验', '计划', '评审', '资料', '手册', '日志', '提案', '任务', '模板', '清单', '指南', '概述']
const SENTENCE_POOL = [
  '工作区引用索引需要在不拖慢编辑的前提下持续更新。', '反向链接面板按来源路径与位置稳定排序。',
  '链接只按来源文档的相对路径解析，各根是独立资源边界。', '索引是可重建缓存，Markdown 正文才是事实来源。',
  '同目录双链可省略扩展名，跨根引用不得解析。', '未保存内容走内存覆盖层，不写入已保存快照。',
  '批量移动按旧新路径映射统一规划替换区间。', '图片变更以 mtime、size 与变化代次判定失效。',
  '排除规则变更触发覆盖范围重算，排除目录不递归扫描。', '快照提交成功后回收旧代际与残留临时文件。',
]

/** 档位内文件名池：中英混合，名字取材固定（PRNG 决定组合）。 */
function fileNameFor(i, rnd) {
  const w = TOPIC_WORDS[Math.floor(rnd() * TOPIC_WORDS.length)]
  return `${w}-${String(i).padStart(6, '0')}`
}

function relPathOf(i) {
  const area = i % AREA_COUNT
  const sub = Math.floor(i / AREA_COUNT) % 4
  return `area-${area}/topic-${sub}/${fileNameFor(i, mulberry32(i))}.md`
}

/** 为第 i 篇生成正文；linksOut 回填本篇链接形态计数。 */
function bodyFor(i, totalFiles, attachmentCount, rnd, linksOut) {
  const selfDir = path.posix.dirname(relPathOf(i))
  const paras = []
  const paraCount = 4 + Math.floor(rnd() * 5)
  for (let p = 0; p < paraCount; p++) {
    const sentences = []
    const sentCount = 2 + Math.floor(rnd() * 3)
    for (let s = 0; s < sentCount; s++) sentences.push(SENTENCE_POOL[Math.floor(rnd() * SENTENCE_POOL.length)])
    paras.push(sentences.join(''))
  }
  // 链接 8~20 条，形态按固定比例混排
  const linkCount = 8 + Math.floor(rnd() * 13)
  const links = []
  const refdefs = []
  for (let l = 0; l < linkCount; l++) {
    const roll = rnd()
    let text
    if (roll < 0.55) {
      // 双链：70% 根内路径形式（#194：[[项目甲/设计]] 为根内子路径），
      // 30% 同目录短名（省略扩展名默认 Markdown）
      const j = Math.floor(rnd() * totalFiles)
      const anchor = rnd() < 0.15 ? `#${TOPIC_WORDS[Math.floor(rnd() * TOPIC_WORDS.length)]}概要` : ''
      const stem = relPathOf(j).replace(/\.md$/, '')
      text = rnd() < 0.3 ? `[[${path.posix.basename(stem)}${anchor}]]` : `[[${stem}${anchor}]]`
      linksOut.wikilink++
    } else if (roll < 0.7) {
      // 普通内联链接：库内 md / 附件 / https
      const r2 = rnd()
      if (r2 < 0.4) {
        const j = Math.floor(rnd() * totalFiles)
        const rel = path.posix.relative(selfDir, relPathOf(j))
        text = `[文档 ${j}](${rel})`
      } else if (r2 < 0.8) {
        const a = Math.floor(rnd() * attachmentCount)
        const ext = a % 3 === 0 ? 'pdf' : 'png'
        text = `[附件 ${a}](attachments/att-${a}.${ext})`
        linksOut.attachment++
      } else {
        text = '[外部文档](https://example.com/docs)'
        linksOut.https++
      }
      linksOut.mdlink++
    } else if (roll < 0.8) {
      // 图片：85% 附件，15% 断链附件
      if (rnd() < 0.85) {
        const a = Math.floor(rnd() * attachmentCount)
        text = `![插图](attachments/att-${a}.png)`
        linksOut.attachment++
      } else {
        text = `![丢失插图](attachments/missing-${Math.floor(rnd() * 1000)}.png)`
        linksOut.broken++
      }
      linksOut.image++
    } else if (roll < 0.85) {
      // 引用式链接定义（Markdown 语法要求行首，单独成行不揉段）
      const j = Math.floor(rnd() * totalFiles)
      const rel = path.posix.relative(selfDir, relPathOf(j))
      refdefs.push(`[ref-${l}]: ${rel}`)
      linksOut.refdef++
      continue
    } else {
      // 断链双链
      text = `[[缺失页面 ${Math.floor(rnd() * 5000)}]]`
      linksOut.broken++
      linksOut.wikilink++
    }
    links.push(text)
  }
  // 把链接按 2~3 条一段揉进段落（步长与段长一致，不重叠不丢条）
  const outParas = [...paras]
  for (let k = 0; k < links.length;) {
    const take = 2 + Math.floor(rnd() * 2)
    const chunk = links.slice(k, k + take).join(' ')
    k += take
    const at = Math.min(outParas.length, 1 + Math.floor(rnd() * outParas.length))
    outParas.splice(at, 0, chunk)
  }
  const body = outParas.join('\n\n')
  return refdefs.length ? `${body}\n\n${refdefs.join('\n')}` : body
}

export function generateTier(tier, outDir) {
  const conf = TIERS[tier]
  if (!conf) throw new Error(`未知档位：${tier}`)
  const corpusDir = path.join(outDir, `corpus-${tier}`)
  rmSync(corpusDir, { recursive: true, force: true })
  const rnd = mulberry32(conf.seed)
  const totalFiles = conf.files
  const attachmentCount = Math.max(24, Math.floor(totalFiles / 20))
  const stats = { tier, files: totalFiles, attachmentFiles: attachmentCount, bytes: 0, links: { wikilink: 0, mdlink: 0, image: 0, refdef: 0, attachment: 0, https: 0, broken: 0 } }

  const madeDirs = new Set()
  for (let i = 0; i < totalFiles; i++) {
    const rel = relPathOf(i)
    const dir = path.posix.dirname(rel)
    if (!madeDirs.has(dir)) {
      mkdirSync(path.join(corpusDir, dir), { recursive: true })
      madeDirs.add(dir)
    }
    const frontmatter = `---\ntags: [bench, ${tier}]\ncreated: 2026-09-28\n---\n\n`
    const body = `# ${fileNameFor(i, mulberry32(i))}\n\n` + bodyFor(i, totalFiles, attachmentCount, rnd, stats.links)
    const text = frontmatter + body + '\n'
    writeFileSync(path.join(corpusDir, rel), text, 'utf8')
    stats.bytes += Buffer.byteLength(text, 'utf8')
  }
  // 附件占位文件：pdf/png 各半 + 少量 jpg（非 Markdown 目标真实落盘）
  mkdirSync(path.join(corpusDir, 'attachments'), { recursive: true })
  const placeholder = Buffer.from('bench-attachment-placeholder')
  for (let a = 0; a < attachmentCount; a++) {
    const ext = a % 3 === 0 ? 'pdf' : a % 3 === 1 ? 'png' : 'jpg'
    writeFileSync(path.join(corpusDir, 'attachments', `att-${a}.${ext}`), placeholder)
    stats.bytes += placeholder.length
  }
  // 排除目录样例（验证排除不扫；放两个 md 保证内容存在）
  mkdirSync(path.join(corpusDir, 'node_modules', 'demo-pkg'), { recursive: true })
  writeFileSync(path.join(corpusDir, 'node_modules', 'demo-pkg', 'readme.md'), '# should be excluded\n', 'utf8')
  stats.directories = madeDirs.size + 1
  const statsPath = path.join(outDir, `gen-stats-${tier}.json`)
  writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8')
  return { corpusDir, statsPath, stats }
}

// CLI 直跑（被 import 时不执行——基准脚本与子进程会带自己的 argv）
const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isDirectRun) {
  const args = process.argv.slice(2)
  const onlyIdx = args.indexOf('--only')
  const outIdx = args.indexOf('--out')
  const outDir = outIdx >= 0 ? args[outIdx + 1] : 'D:/CODE/Project/_ForExplore/vsidian-194-bench'
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
  mkdirSync(outDir, { recursive: true })
  for (const tier of Object.keys(TIERS)) {
    if (only && tier !== only) continue
    const t0 = performance.now()
    const { corpusDir, stats } = generateTier(tier, outDir)
    console.log(`[gen] ${tier}: ${stats.files} 篇 + ${stats.attachmentFiles} 附件 → ${corpusDir}（${(performance.now() - t0).toFixed(0)} ms，正文 ${(stats.bytes / 1048576).toFixed(1)} MB）`)
  }
}
