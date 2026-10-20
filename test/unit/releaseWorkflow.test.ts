// Release 工作流 marketplace gate 契约测试（#615）：钉住
// .github/workflows/release.yml 中 marketplace job 的 if 条件三处回归
// 锚点，均对应主仓 git 历史实证过的踩坑先例：
// - gate 在场（ccf285b0 重写 if 支持 dispatch 补跑时 `vars.MARKETPLACE_PUBLISH`
//   == 'true'` 丢失，推 tag 绕过双开关直发市场——本票修复的缺陷）；
// - 表达式以 ${{ }} 整体包裹（2f972f7f：裸 ! 开头被 YAML 解释为标签锚点，
//   工作流解析失败）；
// - !cancelled() 豁免位于 gate 之前（86535e71：gate 放在前面会被 job 级
//   if 隐式 success() && 前缀在 dispatch 场景判 false，补跑入口失效）。
// 双开关语义的事实源：release 技能「CI 自动发布」节与本 yml 头注释——
// 未配置 VSCE_PAT secret 与 MARKETPLACE_PUBLISH variable 时，推 tag 只产出
// GitHub Release。文本断言模式对齐 chromeContract.test.ts（无 YAML 解析
// 依赖）；断言粒度对齐 easy-typing 的 release-workflow.test.ts，只钉 gate
// 相关锚点，不钉场景区分等其他细节。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = path.resolve(process.cwd(), '.github/workflows/release.yml')
const workflowText = existsSync(workflowPath)
  ? readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
  : ''

/** marketplace job 的 job 级 if 条件值（release job 也有 if，不能全文取第一个） */
function marketplaceIfValue(): string {
  const jobHeader = workflowText.match(/^ {2}marketplace:\s*$/m)
  expect(jobHeader, '未找到 marketplace job').not.toBeNull()
  const tail = workflowText.slice(jobHeader!.index! + jobHeader![0].length)
  const ifLine = tail.match(/^\s*if:\s*(.+)$/m)
  expect(ifLine, 'marketplace job 缺少 job 级 if 条件').not.toBeNull()
  return ifLine![1]!.trim()
}

describe('Release 工作流 marketplace gate 契约（#615）', () => {
  it('gate 在场：if 条件含 MARKETPLACE_PUBLISH 双开关', () => {
    const ifValue = marketplaceIfValue()
    expect(
      ifValue,
      'marketplace 的 if 缺少 vars.MARKETPLACE_PUBLISH gate——双开关语义丢失，'
        + '已配 VSCE_PAT 未设 variable 时推 tag 会直发 Marketplace',
    ).toContain("vars.MARKETPLACE_PUBLISH == 'true'")
  })

  it('if 表达式以 ${{ }} 整体包裹（裸 ! 被 YAML 解释为标签锚点）', () => {
    const ifValue = marketplaceIfValue()
    expect(ifValue.startsWith('${{'), 'if 值应以 ${{ 开头').toBe(true)
    expect(ifValue.endsWith('}}'), 'if 值应以 }} 结尾').toBe(true)
  })

  it('!cancelled() 豁免位于 gate 之前（隐式 success() 前缀会否决 dispatch 补跑）', () => {
    const ifValue = marketplaceIfValue()
    const exempt = ifValue.indexOf('!cancelled()')
    const gate = ifValue.indexOf('vars.MARKETPLACE_PUBLISH')
    expect(exempt, 'if 条件缺少 !cancelled() 豁免').toBeGreaterThanOrEqual(0)
    expect(gate, 'if 条件缺少 MARKETPLACE_PUBLISH gate').toBeGreaterThanOrEqual(0)
    expect(gate, 'gate 须位于 !cancelled() 之后').toBeGreaterThan(exempt)
  })
})
