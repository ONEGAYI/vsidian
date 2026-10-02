// 悬停词防回潮契约（#300）：原生 title 自绘接管后全面退役——属性在场时
// 浏览器气泡无法阻止，任何新写悬停 title 都会造成双气泡。扫描源码三种
// 写入形态；豁免名单仅收非悬停语义（字段引用等），新增豁免须注明理由。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/webview', 'src/shared']
const EXEMPT_FILES = new Set<string>([
  // readingFindSource 的 this.title 是 DOM 元素引用字段（存 <span>），
  // 非悬停属性写入——文件内类字段命名与属性扫描正则同形，文件级豁免
  'src/webview/readingFindSource.ts',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** 禁令形态：DOM 悬停 title 的三种写入 */
const BANS: readonly { name: string; pattern: RegExp }[] = [
  { name: '属性赋值 .title =', pattern: /(?<![\w$.])\w+\.title\s*=[^=]/ },
  { name: "setAttribute('title')", pattern: /setAttribute\(\s*(['"])title\1/ },
  { name: '模板内联 title="', pattern: /\stitle=\\"/ },
]

describe('悬停词防回潮（#300：原生 title 退役）', () => {
  const files = ROOTS.flatMap((root) => walk(root))

  it('源码内无任何悬停 title 写入（data-tooltip 是唯一承载）', () => {
    const violations: string[] = []
    for (const file of files) {
      if (EXEMPT_FILES.has(file.replace(/\\/g, '/'))) continue
      const lines = readFileSync(file, 'utf-8').split('\n')
      lines.forEach((line, idx) => {
        for (const ban of BANS) {
          if (ban.pattern.test(line)) {
            violations.push(`${file}:${idx + 1} [${ban.name}] ${line.trim()}`)
          }
        }
      })
    }
    expect(violations, '发现原生 title 悬停写入（应写 data-tooltip，见 docs/specs/tooltip.md）:\n' + violations.join('\n')).toEqual([])
  })
})
