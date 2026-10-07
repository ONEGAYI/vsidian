// #351 T02 宿主侧附加组件页面入口登记校验的单元测试（断言自 V02 验证件
// #349 移植——登记校验已生产化为 src/host/addons/addonPageRegistry，本文件
// 改为消费生产实现；fixtures 内的原型仅供 addonV02Probe 历史探针复跑）。
// 「组件只登记安装目录内的相对入口及资源子目录，平台拒绝越出该目录的
// 路径」的宿主侧第一层（词法包含性）矩阵。符号链接逃逸的 realpath 校验
// 属 T05 安装侧实施，本票不含（见 V02 报告未验项）。
import { describe, expect, it } from 'vitest'
import { resolveAddonPageEntry } from '../../src/host/addons/addonPageRegistry'

const INSTALL = process.platform === 'win32' ? 'C:\\addons\\test-addon' : '/addons/test-addon'

describe('T02 页面入口登记校验：resolveAddonPageEntry', () => {
  it('合法登记解析出绝对路径（入口 + 样式 + 资源基址）', () => {
    const result = resolveAddonPageEntry(INSTALL, {
      entry: 'dist/page.js',
      css: ['dist/page.css'],
      resources: ['dist', 'dist/assets'],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entryFsPath.endsWith(['dist', 'page.js'].join(process.platform === 'win32' ? '\\' : '/'))).toBe(true)
      expect(result.cssFsPaths).toHaveLength(1)
      // 首个资源子目录作为 resourceUri 基址
      expect(result.resourceBaseFsPath?.endsWith('dist')).toBe(true)
    }
  })

  it('无样式/资源子目录时：css 空、resourceBase 为 null', () => {
    const result = resolveAddonPageEntry(INSTALL, { entry: 'dist/page.js' })
    expect(result).toMatchObject({ ok: true, cssFsPaths: [], resourceBaseFsPath: null })
  })

  it('入口越界拒绝：.. 上跳 / 绝对路径 / 协议形态 / 混合分隔符上跳', () => {
    const escapes = ['../other/page.js', '..\\other\\page.js', '/etc/passwd', 'C:\\Windows\\evil.js', 'https://evil.test/x.js', 'dist/../../escape.js']
    for (const entry of escapes) {
      expect(resolveAddonPageEntry(INSTALL, { entry })).toMatchObject({ ok: false, reason: 'escape-entry', detail: entry })
    }
  })

  it('样式与资源子目录越界拒绝（escape-css / escape-resource 分开点名）', () => {
    expect(resolveAddonPageEntry(INSTALL, { entry: 'dist/page.js', css: ['../outside/x.css'] })).toMatchObject({ ok: false, reason: 'escape-css' })
    expect(resolveAddonPageEntry(INSTALL, { entry: 'dist/page.js', resources: ['..\\outside'] })).toMatchObject({ ok: false, reason: 'escape-resource' })
    // 逐条校验：任一越界整体拒绝（不留半登记状态）
    expect(resolveAddonPageEntry(INSTALL, { entry: 'dist/page.js', css: ['dist/ok.css', 'dist/../../bad.css'] })).toMatchObject({ ok: false, reason: 'escape-css' })
    expect(resolveAddonPageEntry(INSTALL, { entry: 'dist/page.js', resources: ['dist', '../secret'] })).toMatchObject({ ok: false, reason: 'escape-resource', detail: '../secret' })
  })

  it('空入口拒绝', () => {
    expect(resolveAddonPageEntry(INSTALL, { entry: '' })).toMatchObject({ ok: false, reason: 'escape-entry' })
  })
})
