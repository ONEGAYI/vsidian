// i18n 防回潮契约（#93）：扫描 src 用户可见面字符串字面量，含 CJK 即失败。
// 永久合法存量（语言自名、探针徽标）以显式白名单登记（文件 → 字面量集合）；
// 条目在源文件中不再出现时报失效（防腐化）。扫描器自身有自证用例：人为
// 违规样例被拦截、console/throw/new Error 直接参数与 console 转发 helper
// 的豁免样例放行、闭包边界与 helper 逃逸样例拦截（#101 语义）。
//
// 白名单再生（迁移工单用）：清项后运行
//   VSIDIAN_I18N_DUMP_WHITELIST=1 npx vitest run test/unit/i18nNoHardcodedCjk.test.ts
// 将打印最新白名单 TS 内容，整体替换 test/unit/i18nCjkWhitelist.ts 即可。
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { scanRepoCjk, scanSourceCjkLiterals } from './i18nScan'
import { CJK_LITERALS_WHITELIST } from './i18nCjkWhitelist'

const REPO_ROOT = path.resolve(process.cwd())
const violations = scanRepoCjk(REPO_ROOT)

const actualByFile = new Map<string, Set<string>>()
for (const v of violations) {
  const set = actualByFile.get(v.file) ?? new Set<string>()
  set.add(v.literal)
  actualByFile.set(v.file, set)
}

describe('防回潮扫描（src 用户可见面 CJK 字面量）', () => {
  it('现状存量全部入白名单：无未登记违规', () => {
    const unlisted: string[] = []
    for (const v of violations) {
      if (!CJK_LITERALS_WHITELIST[v.file]?.includes(v.literal)) {
        unlisted.push(`${v.file}:${v.line} 「${v.literal}」`)
      }
    }
    expect(
      unlisted,
      `发现未登记的 CJK 硬编码字面量（新文案须经 src/shared/locales/ 语言包 + t() 添加；\n` +
        '既有存量请登记白名单或随迁移工单清除）：\n' +
        unlisted.join('\n'),
    ).toEqual([])
  })

  it('白名单无失效条目：登记的字面量仍在源文件中（清项后须同步删除）', () => {
    const stale: string[] = []
    for (const [file, literals] of Object.entries(CJK_LITERALS_WHITELIST)) {
      const actual = actualByFile.get(file)
      for (const literal of literals) {
        if (!actual?.has(literal)) {
          stale.push(`${file} 「${literal}」`)
        }
      }
    }
    expect(
      stale,
      `白名单失效条目（对应字面量已不在源文件，应删除登记）：\n${stale.join('\n')}`,
    ).toEqual([])
  })
})

describe('扫描器自证（拦截与豁免语义）', () => {
  it('普通 CJK 字符串字面量被拦截（人为违规样例）', () => {
    const found = scanSourceCjkLiterals(
      `const title = '打开设置'\nconst tpl = \`搜索设置\`\nconst en = 'plain'\n`,
      'sample.ts',
    )
    expect(found.map((v) => v.literal)).toEqual(['打开设置', '搜索设置'])
    expect(found[0]!.line).toBe(1)
  })

  it('ASCII 字符串不报；含 CJK 的对象键也报', () => {
    const found = scanSourceCjkLiterals(
      `const a = 'ok'\nconst map = { '中文键': 1 }\n`,
      'sample.ts',
    )
    expect(found.map((v) => v.literal)).toEqual(['中文键'])
  })

  it('console.* 调用参数豁免（含嵌套表达式）', () => {
    const found = scanSourceCjkLiterals(
      `console.warn('内部警告')\nconsole.error('a' + f('嵌套'))\n`,
      'sample.ts',
    )
    expect(found).toEqual([])
  })

  it('throw 语句与 new Error 参数豁免（含未 throw 的 new Error）', () => {
    const found = scanSourceCjkLiterals(
      `throw new Error('抛错文案')\nfunction f() { throw '裸抛' }\nconst e = new Error('错误对象')\n`,
      'sample.ts',
    )
    expect(found).toEqual([])
  })

  it('闭包边界停止：console.* 子树内跨越函数边界的延迟求值不再豁免', () => {
    const found = scanSourceCjkLiterals(
      `console.log(() => '闭包延迟文案')\n` +
        `console.log(wrap(() => '嵌套调用里的闭包文案'))\n` +
        `console.warn('直接参数仍豁免')\n`,
      'sample.ts',
    )
    expect(found.map((v) => v.literal)).toEqual(['闭包延迟文案', '嵌套调用里的闭包文案'])
  })

  it('helper 转发放行：参数只流向 console.* 参数子树的局部函数，调用点字面量豁免', () => {
    const found = scanSourceCjkLiterals(
      `function warnDropped(tr: unknown, reason: string): void {\n` +
        `  console.warn(\`[vsidian] 拒绝（\${reason}）: \` + JSON.stringify({ mark: 1 }))\n` +
        `}\n` +
        `const warnArrow = (tr: unknown, reason: string): void => {\n` +
        `  console.warn(\`[vsidian] 箭头（\${reason}）\`)\n` +
        `}\n` +
        `warnDropped(tr, '多段变更')\n` +
        `warnDropped(tr, cond ? '结构无法保持' : '选区无可见表格内容交集')\n` +
        `warnArrow(tr, '箭头直通')\n`,
      'sample.ts',
    )
    expect(found).toEqual([])
  })

  it('helper 逃逸拦截：参数流向返回值 / 其他调用 / 再赋值时调用点不豁免', () => {
    const found = scanSourceCjkLiterals(
      `function escapeReturn(reason: string): string { return reason }\n` +
        `const a = escapeReturn('逃逸返回值')\n` +
        `function escapeCall(reason: string): void { track(reason) }\n` +
        `escapeCall('逃逸其他调用')\n` +
        `function escapeReassign(reason: string): void { reason = reason + '追加'; console.warn(reason) }\n` +
        `escapeReassign('逃逸再赋值')\n` +
        `function escapeUnused(reason: string): void { console.warn('未使用参数') }\n` +
        `escapeUnused('参数未流向任何位置')\n` +
        `function escapeClosure(reason: string): void { const f = () => track(reason); f() }\n` +
        `escapeClosure('逃逸进闭包')\n`,
      'sample.ts',
    )
    expect(found.map((v) => v.literal)).toEqual([
      '逃逸返回值',
      '逃逸其他调用',
      '追加',
      '逃逸再赋值',
      '参数未流向任何位置',
      '逃逸进闭包',
    ])
  })
})

// 白名单再生模式：打印最新内容后正常跑完（打印件人工替换文件，不入库逻辑）
if (process.env.VSIDIAN_I18N_DUMP_WHITELIST === '1') {
  const byFile = new Map<string, Set<string>>()
  for (const v of violations) {
    const set = byFile.get(v.file) ?? new Set<string>()
    set.add(v.literal)
    byFile.set(v.file, set)
  }
  const lines = [
    '// i18n 防回潮扫描白名单（#93 生成；由 i18nNoHardcodedCjk.test.ts 契约钉住）。',
    '// 文件（仓库相对路径）→ 允许在案的 CJK 字面量（集合语义）。',
    '// 条目失效时契约测试报错，须同步清除；在案类别说明见手工维护的头注释。',
    '// 再生：VSIDIAN_I18N_DUMP_WHITELIST=1 npx vitest run test/unit/i18nNoHardcodedCjk.test.ts',
    'export const CJK_LITERALS_WHITELIST: Readonly<Record<string, readonly string[]>> = {',
  ]
  for (const file of [...byFile.keys()].sort()) {
    lines.push(`  '${file}': [`)
    for (const literal of [...byFile.get(file)!].sort()) {
      lines.push(`    ${JSON.stringify(literal)},`)
    }
    lines.push('  ],')
  }
  lines.push('}', '')
  console.info('==== WHITELIST BEGIN ====')
  console.info(lines.join('\n'))
  console.info('==== WHITELIST END ====')
}
