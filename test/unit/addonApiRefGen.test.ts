// 附加组件 API 参考生成一致性契约（#362 T13）：参考产物
// （docs/addons/api-reference.md）由 scripts/genAddonApiRef.mjs 从语义清单
// 与发行台账单一事实源（src/shared/addonApiCatalog.ts）+ 各事实源模块的
// TypeScript 声明生成，本测试以 --check 模式复跑生成器比对磁盘——手改产物、
// 改清单后未再生成、签名源符号缺失或生成器回归都会失败。
// 同时钉住台账诚实性（候选不带日期、已发布必有日期）与生成器纯函数
// （文档结构要素），防产物内容空洞化。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
// @ts-expect-error mjs 无类型声明（运行时由 vitest ESM 加载；类型面不消费）
import { buildApiReferenceMarkdown, extractSymbolDeclarations } from '../../scripts/genAddonApiRef.mjs'
import {
  ADDON_API_ENTRIES,
  ADDON_API_GROUPS,
  ADDON_API_RELEASES,
  validateAddonApiCatalog,
  type AddonApiEntry,
  type AddonApiGroup,
  type AddonApiReleaseRecord,
} from '../../src/shared/addonApiCatalog'

const root = path.resolve(process.cwd())

describe('addonApiRefGen 生成器与产物一致性', () => {
  it('--check 复跑与磁盘产物一致（清单 → 参考可复现）', () => {
    execFileSync('node', [path.join(root, 'scripts', 'genAddonApiRef.mjs'), '--check'], {
      cwd: root,
      stdio: 'pipe',
    })
  })

  it('产物在磁盘上存在且含生成器落款（防路径漂移）', () => {
    const doc = readFileSync(path.join(root, 'docs', 'addons', 'api-reference.md'), 'utf8')
    expect(doc).toContain('scripts/genAddonApiRef.mjs')
    expect(doc).toContain('src/shared/addonApiCatalog.ts')
  })
})

describe('addonApiCatalog 清单自洽与台账诚实性', () => {
  it('真实清单通过自洽校验', () => {
    expect(validateAddonApiCatalog(ADDON_API_GROUPS, ADDON_API_ENTRIES, ADDON_API_RELEASES)).toEqual([])
  })

  it('六组各有条目、条目分组全部合法', () => {
    expect(ADDON_API_GROUPS).toHaveLength(6)
    for (const group of ADDON_API_GROUPS) {
      const count = ADDON_API_ENTRIES.filter((entry) => entry.group === group.id).length
      expect(count, `分组 ${group.id} 应有条目`).toBeGreaterThan(0)
    }
  })

  it('当前全部版本与实验入口均为候选——无任何已发布状态或日期（发行时须显式更新本断言并人工落账）', () => {
    for (const record of ADDON_API_RELEASES) {
      expect(record.status).toBe('candidate')
      expect(record.releasedAt).toBeUndefined()
      for (const exp of record.experimental) {
        expect(exp.status).toBe('candidate')
        expect(exp.releasedAt).toBeUndefined()
      }
    }
  })

  it('实验入口 cm6 在案且与实验条目互相咬合', () => {
    const expEntries = ADDON_API_RELEASES.flatMap((r) => r.experimental.map((e) => e.entry))
    expect(expEntries).toContain('cm6')
    const experimentalLayer = ADDON_API_ENTRIES.filter((entry) => entry.layer === 'experimental')
    expect(experimentalLayer.length).toBeGreaterThan(0)
    for (const entry of experimentalLayer) {
      expect(expEntries).toContain(entry.experimentalEntry)
    }
  })

  it('候选携带发布日期被拒绝（未发行不伪造历史）', () => {
    const releases: AddonApiReleaseRecord[] = [
      { ...ADDON_API_RELEASES[0], releasedAt: '2026-10-08' },
    ]
    const problems = validateAddonApiCatalog(ADDON_API_GROUPS, ADDON_API_ENTRIES, releases)
    expect(problems.some((p) => p.includes('不得携带发布日期'))).toBe(true)
  })

  it('已发布状态缺日期或日期格式非法被拒绝', () => {
    const noDate: AddonApiReleaseRecord[] = [{ ...ADDON_API_RELEASES[0], status: 'released' }]
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, ADDON_API_ENTRIES, noDate).some((p) => p.includes('必须携带实际发布日期')),
    ).toBe(true)
    const badDate: AddonApiReleaseRecord[] = [{ ...ADDON_API_RELEASES[0], status: 'released', releasedAt: '2026/10/08' }]
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, ADDON_API_ENTRIES, badDate).some((p) => p.includes('YYYY-MM-DD')),
    ).toBe(true)
  })

  it('实验条目缺 experimentalEntry、稳定条目携带 experimentalEntry 均被拒绝', () => {
    const broken = ADDON_API_ENTRIES.map((entry) =>
      entry.layer === 'experimental' ? { ...entry, experimentalEntry: undefined } : entry,
    )
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, broken, ADDON_API_RELEASES).some((p) => p.includes('缺 experimentalEntry')),
    ).toBe(true)
    const polluted = ADDON_API_ENTRIES.map((entry) =>
      entry.layer === 'stable-candidate' ? { ...entry, experimentalEntry: 'cm6' } : entry,
    )
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, polluted, ADDON_API_RELEASES).some((p) => p.includes('不应携带 experimentalEntry')),
    ).toBe(true)
  })

  it('未知分组、重复条目 ID、越界签名源与空分组被拒绝', () => {
    const groups: AddonApiGroup[] = [...ADDON_API_GROUPS, { id: 'extra', title: '越界组', scope: 'x', order: 99 }]
    expect(
      validateAddonApiCatalog(groups, ADDON_API_ENTRIES, ADDON_API_RELEASES).some((p) => p.includes('没有条目')),
    ).toBe(true)

    const dupEntries: AddonApiEntry[] = [...ADDON_API_ENTRIES, { ...ADDON_API_ENTRIES[0] }]
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, dupEntries, ADDON_API_RELEASES).some((p) => p.includes('条目 ID 重复')),
    ).toBe(true)

    const strayEntries: AddonApiEntry[] = ADDON_API_ENTRIES.map((entry, index) =>
      index === 0
        ? { ...entry, signatures: [{ module: 'src/webview/liveInstance.ts', symbols: ['LiveInstance'] }] }
        : entry,
    )
    expect(
      validateAddonApiCatalog(ADDON_API_GROUPS, strayEntries, ADDON_API_RELEASES).some((p) => p.includes('签名源模块越界')),
    ).toBe(true)
  })
})

describe('addonApiRefGen 生成器纯函数', () => {
  const signatures = new Map([
    ['src/shared/addonIdentity.ts', new Map([['ADDON_MANIFEST_FIELD', "export const ADDON_MANIFEST_FIELD = 'vsidianAddon'"]])],
  ])
  const sampleEntries: AddonApiEntry[] = [
    {
      id: 'manifest-declaration',
      group: 'discovery',
      title: '私有身份声明',
      layer: 'stable-candidate',
      endpoints: ['host'],
      signatures: [{ module: 'src/shared/addonIdentity.ts', symbols: ['ADDON_MANIFEST_FIELD'] }],
      purpose: '声明身份。',
      semantics: { errors: '四种拒绝' },
      verification: ['test/unit/addonIdentity.test.ts'],
      introduced: '#350（T01）',
    },
    {
      id: 'cm6-experimental',
      group: 'page-sdk',
      title: '实验入口',
      layer: 'experimental',
      experimentalEntry: 'cm6',
      endpoints: ['editor-page'],
      signatures: [{ module: 'src/shared/addonPage.ts', symbols: ['AddonCm6Runtime'] }],
      purpose: '共享运行时。',
      semantics: {},
      verification: ['test/unit/addonPageLoader.test.ts'],
      introduced: '#351（T02）',
    },
  ]
  const sampleGroups: AddonApiGroup[] = [
    { id: 'discovery', title: '发现与安装', scope: '宿主发现', order: 1 },
    { id: 'page-sdk', title: '页面 SDK', scope: '页面装载', order: 2 },
  ]
  const sampleReleases: AddonApiReleaseRecord[] = [
    {
      version: '1.0.0',
      status: 'candidate',
      summary: '首个候选。',
      experimental: [{ entry: 'cm6', version: '1.0.0', status: 'candidate', note: '共享运行时' }],
    },
  ]

  it('渲染含诚实声明、六组骨架、条目锚点、签名代码块与台账', () => {
    const md = buildApiReferenceMarkdown(
      { groups: sampleGroups, entries: sampleEntries, releases: sampleReleases, removalRule: '移除规则正文' },
      signatures,
    )
    expect(md).toContain('候选状态，尚未对外发布')
    expect(md).toContain('## 1. 发现与安装')
    expect(md).toContain('### `manifest-declaration` 私有身份声明')
    expect(md).toContain('(#manifest-declaration)')
    expect(md).toContain('```ts')
    expect(md).toContain("export const ADDON_MANIFEST_FIELD = 'vsidianAddon'")
    expect(md).toContain('| 1.0.0 | 候选（未发行） | —（未发行不携带日期）')
    expect(md).toContain('| `cm6` | 1.0.0 | 候选（未发行）')
    expect(md).toContain('移除规则正文')
    expect(md).toContain('实验入口兼容清单')
    expect(md).toContain('`test/unit/addonIdentity.test.ts`')
  })

  it('实验条目渲染清单声明名与兼容边界提示', () => {
    const md = buildApiReferenceMarkdown(
      { groups: sampleGroups, entries: sampleEntries, releases: sampleReleases, removalRule: '规则' },
      signatures,
    )
    expect(md).toContain('**实验入口**：清单 `experimental` 声明名 `cm6`')
    expect(md).toContain('实验入口（不随稳定 API 弃用期限承诺）')
  })

  it('声明提取：含紧邻前导注释、declare module 内缩进对齐、缺失符号不出现', () => {
    const dts = [
      "declare module 'vsidian-addon-sdk' {",
      '  /** 登记工厂 */',
      '  export function defineAddonPage(',
      '    addonId: string,',
      '    factory: () => void,',
      '  ): void',
      '  export function currentSdk(): unknown',
      '}',
    ].join('\n')
    const found = extractSymbolDeclarations(dts, 'x.d.ts', ['defineAddonPage', 'not-exist'])
    expect([...found.keys()].sort()).toEqual(['defineAddonPage'])
    expect([...found.values()][0]).toBe(
      ['/** 登记工厂 */', 'export function defineAddonPage(', '  addonId: string,', '  factory: () => void,', '): void'].join(
        '\n',
      ),
    )
  })
})
