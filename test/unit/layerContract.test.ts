// shared 层分层防回潮契约（#266）：src/shared 是两端共享纯逻辑，不依赖
// 任何一侧实现层（src/webview 与 src/host）。#266 前曾由 refExpansion
// 反向 import webview 的 tableCellEmbed/markdownDoc（已随三模块下沉治
// 疗）。本测试递归扫描 shared 全部源文件（含 locales 子目录），把相对
// 说明符按文件位置解析后判定落点——防的是新增代码顺手回潮，不是对抗
// 性规避（alias/包名不经相对路径，天然不在此列）。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SHARED_ROOT = resolve(__dirname, '../../src/shared')
const IMPL_DIRS = [
  resolve(__dirname, '../../src/webview'),
  resolve(__dirname, '../../src/host'),
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** 说明符提取：静态 import/export-from 的 `from '...'`、副作用
 *  `import '...'` 与动态 `import('...')` 三形态；`from` 前限定行首/
 *  空白/}（多行 import 收尾），避免正文英文句子里的字面量误报。 */
const SPEC_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;}])from\s+['"]([^'"]+)['"]/,
  /(?:^|[\s;])import\s+['"]([^'"]+)['"]/,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
]

function isImplPath(specifier: string, file: string): boolean {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false
  const target = resolve(file, '..', specifier).replace(/\\/g, '/')
  return IMPL_DIRS.some((dir) => {
    const normalized = dir.replace(/\\/g, '/')
    return target === normalized || target.startsWith(`${normalized}/`)
  })
}

describe('shared 层分层契约（#266：不依赖实现层）', () => {
  const files = walk(SHARED_ROOT)

  it('src/shared 全部源文件无指向 src/webview 或 src/host 的模块引用', () => {
    const violations: string[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n')
      lines.forEach((line, idx) => {
        for (const pattern of SPEC_PATTERNS) {
          const match = pattern.exec(line)
          const specifier = match?.[1]
          if (specifier && isImplPath(specifier, file)) {
            violations.push(`${file}:${idx + 1} [${specifier}] ${line.trim()}`)
            break
          }
        }
      })
    }
    expect(
      violations,
      'shared 层出现指向实现层（webview/host）的引用——共享纯逻辑不得依赖任何一侧实现，' +
        '公共依赖应下沉到 src/shared（见 docs/specs/ 与 #266）:\n' +
        violations.join('\n'),
    ).toEqual([])
  })
})
