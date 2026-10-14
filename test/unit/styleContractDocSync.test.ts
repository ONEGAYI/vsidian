import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'

// #132 重挂用例曾因双源漂移红灯：fixtures.mjs 的 STYLE_CONTRACT_DOC（宿主
// 写盘）更新后，cases.ts 的 STYLE_CONTRACT_DOC_TEXT（用例对拍副本）未同步，
// text 对拍永不成立、确定性 30 秒超时。此钉子读两侧源文件比对数组文本，
// 漂移在单测层即拦截，不必等集成重挂用例超时才发现。
function extractArrayLiteral(source: string, constName: string): string | null {
  const marker = `const ${constName} = [`
  const at = source.indexOf(marker)
  if (at < 0) return null
  const start = source.indexOf('[', at)
  const end = source.indexOf('].join', start)
  return end < 0 ? null : source.slice(start + 1, end).trim()
}

describe('样式契约对拍文本双源同步', () => {
  it('fixtures.mjs 的 STYLE_CONTRACT_DOC 与 cases.ts 的 STYLE_CONTRACT_DOC_TEXT 逐字一致', () => {
    const root = path.resolve(__dirname, '../integration')
    const fixtures = readFileSync(path.join(root, 'fixtures.mjs'), 'utf8')
    const cases = readFileSync(path.join(root, 'suite/cases.ts'), 'utf8')
    const written = extractArrayLiteral(fixtures, 'STYLE_CONTRACT_DOC')
    const expected = extractArrayLiteral(cases, 'STYLE_CONTRACT_DOC_TEXT')
    // 提取失败即结构变化（改名/去 join），钉子须随之更新而不是静默通过
    expect(written, 'fixtures.mjs 的 STYLE_CONTRACT_DOC 应为 .join 结尾的数组字面量').not.toBeNull()
    expect(expected, 'cases.ts 的 STYLE_CONTRACT_DOC_TEXT 应为 .join 结尾的数组字面量').not.toBeNull()
    expect(expected?.split('\n').length).toBe(written?.split('\n').length)
    expect(expected).toBe(written)
  })
})
