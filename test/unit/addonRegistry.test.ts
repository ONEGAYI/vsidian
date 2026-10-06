// V02（#349）宿主侧附加组件登记与路径包含性校验的单元测试：
// 「组件只登记安装目录内的相对入口及资源子目录，平台拒绝越出该目录的
// 路径」的宿主侧第一层（词法包含性）矩阵。符号链接逃逸的 realpath 校验
// 属 T05 安装侧实施，本票不含（见结论文档未验项）。
import { describe, expect, it } from 'vitest'
import {
  resolveAddonRegistration,
  resolveAddonResource,
} from '../fixtures/addon-v02/registry/addonRegistry'

const INSTALL = process.platform === 'win32' ? 'C:\\addons\\test-addon' : '/addons/test-addon'

describe('V02 宿主登记校验：resolveAddonRegistration', () => {
  it('合法登记解析出绝对路径（入口 + 资源子目录）', () => {
    const result = resolveAddonRegistration({ id: 'onegayi.vsidian-test-addon', installDir: INSTALL, entry: 'dist/page.js', resourceDirs: ['dist', 'dist/assets'] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entryFsPath.endsWith(['dist', 'page.js'].join(process.platform === 'win32' ? '\\' : '/'))).toBe(true)
      expect(result.resourceDirFsPaths).toHaveLength(2)
    }
  })

  it('非法 ID（空/含空白）拒绝', () => {
    expect(resolveAddonRegistration({ id: '', installDir: INSTALL, entry: 'dist/page.js' })).toMatchObject({ ok: false, reason: 'invalid-id' })
    expect(resolveAddonRegistration({ id: 'a b', installDir: INSTALL, entry: 'dist/page.js' })).toMatchObject({ ok: false, reason: 'invalid-id' })
  })

  it('入口越界拒绝：.. 上跳 / 绝对路径 / 协议形态 / 混合分隔符上跳', () => {
    const escapes = ['../other/page.js', '..\\other\\page.js', '/etc/passwd', 'C:\\Windows\\evil.js', 'https://evil.test/x.js', 'dist/../../escape.js']
    for (const entry of escapes) {
      expect(resolveAddonRegistration({ id: 'x.y', installDir: INSTALL, entry })).toMatchObject({ ok: false, reason: 'escape-entry' })
    }
  })

  it('资源子目录越界拒绝（任一越界即整体拒绝，不留半登记）', () => {
    const result = resolveAddonRegistration({ id: 'x.y', installDir: INSTALL, entry: 'dist/page.js', resourceDirs: ['dist', '../secret'] })
    expect(result).toMatchObject({ ok: false, reason: 'escape-resource', detail: '../secret' })
  })
})

describe('V02 宿主登记校验：resolveAddonResource', () => {
  const registration = { id: 'x.y', installDir: INSTALL, entry: 'dist/page.js', resourceDirs: ['dist'] }

  it('资源子目录内的相对资源通过', () => {
    const result = resolveAddonResource(registration, 'dist/assets/logo.png')
    expect(result.ok).toBe(true)
  })

  it('安装目录内但资源子目录外的路径拒绝（越出登记面）', () => {
    const result = resolveAddonResource(registration, 'package.json')
    expect(result).toMatchObject({ ok: false, reason: 'escape-resource' })
  })

  it('词法越界拒绝：.. / 绝对 / 协议', () => {
    for (const bad of ['../secret.txt', '/etc/passwd', 'https://evil.test/x.js']) {
      expect(resolveAddonResource(registration, bad)).toMatchObject({ ok: false, reason: 'escape-resource' })
    }
  })
})
