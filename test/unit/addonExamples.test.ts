// #364 T15 样例工程的结构契约（防回潮）：
// 1. 三工程 manifest：vsidianAddon 身份声明（manifestVersion 1 + api
//    ^1.0.0）、对 onegayi.vsidian 的原生依赖、同宿主偏好（workspace）、
//    engines 与 Vsidian 下界一致（^1.82.3）、main 指向构建产物；
// 2. 源码导入纪律：样例源码对主仓库事实源（src/shared、src/host）只允许
//    type-only 导入——值导入会把内部代码打进 bundle（构建期产物扫描是
//    第二道防线，此处钉源码层）；vsidian-addon-sdk 是构建桥虚拟模块，
//    页面入口的 defineAddonPage 值导入是唯一合法值导入形态；
// 3. 主 VSIX 不夹带样例：样例位于 test/examples/（.vscodeignore 的 test/
//    排除面覆盖——与 addonApiSurface 的 docs/scripts 断言互为补充）。
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const examplesRoot = path.join(root, 'test', 'examples')
const PROJECTS = ['input-behavior', 'renderer', 'ui-command'] as const

function readProjectFile(project: string, file: string): string {
  const full = path.join(examplesRoot, project, file)
  expect(existsSync(full), `${project}/${file} 应存在`).toBe(true)
  return readFileSync(full, 'utf8')
}

/** 递归收集样例源码文件（ts；构建脚本 mjs 与清单不在导入纪律面内） */
function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'dist') {
        continue // 构建产物
      }
      out.push(...collectSources(full))
    } else if (name.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('T15 样例工程结构契约（#364）', () => {
  it('三工程 manifest 声明身份、依赖、宿主偏好与产物入口', () => {
    for (const project of PROJECTS) {
      const manifest = JSON.parse(readProjectFile(project, 'package.json')) as {
        name: string
        publisher: string
        engines: { vscode: string }
        extensionKind: string[]
        extensionDependencies: string[]
        main: string
        vsidianAddon: { manifestVersion: number; api: string }
      }
      expect(manifest.publisher, `${project} 发布者`).toBe('vsidian-example')
      expect(manifest.engines.vscode, `${project} engines 下界`).toBe('^1.82.3')
      expect(manifest.extensionKind, `${project} 同宿主偏好`).toContain('workspace')
      expect(manifest.extensionDependencies, `${project} 原生依赖`).toContain('onegayi.vsidian')
      expect(manifest.main, `${project} 产物入口`).toBe('./dist/extension.js')
      expect(manifest.vsidianAddon.manifestVersion, `${project} 身份声明版本`).toBe(1)
      expect(manifest.vsidianAddon.api, `${project} 稳定 API 范围`).toBe('^1.0.0')
    }
  })

  it('样例源码对主仓库事实源仅 type-only 导入（值导入防回潮）', () => {
    const importPattern = /^import\s+(type\s+)?\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/gm
    for (const source of collectSources(examplesRoot)) {
      const text = readFileSync(source, 'utf8')
      for (const match of text.matchAll(importPattern)) {
        const isTypeOnly = match[1] !== undefined
        const specifier = match[2]
        if (specifier.includes('/src/shared/') || specifier.includes('/src/host/')) {
          expect(isTypeOnly, `${path.relative(root, source)} 对事实源 ${specifier} 必须 import type（值导入会打进内部代码）`).toBe(true)
        }
        if (!isTypeOnly && !specifier.startsWith('./') && !specifier.startsWith('vscode')) {
          // 值导入只允许 vscode 与构建桥虚拟模块
          expect(specifier === 'vsidian-addon-sdk', `${path.relative(root, source)} 的值导入 ${specifier} 不在白名单（vscode / vsidian-addon-sdk）`).toBe(true)
        }
      }
    }
  })

  it('主 VSIX 不夹带样例（.vscodeignore 的 test/ 排除面覆盖 test/examples）', () => {
    const ignore = readFileSync(path.join(root, '.vscodeignore'), 'utf8')
    expect(ignore, '.vscodeignore 须排除 test/（样例位于 test/examples）').toContain('test/')
    // 样例全部位于 test/ 之下（排除断言的前提）
    for (const project of PROJECTS) {
      const relative = path.relative(root, path.join(examplesRoot, project))
      expect(relative.startsWith(path.join('test', 'examples')), `${project} 应位于 test/examples/ 下`).toBe(true)
    }
  })

  it('三工程各自有构建入口与共享构建库', () => {
    for (const project of PROJECTS) {
      readProjectFile(project, 'build.mjs')
    }
    expect(existsSync(path.join(examplesRoot, 'tools', 'buildLib.mjs')), '共享构建库应在场').toBe(true)
    expect(existsSync(path.join(examplesRoot, 'build.mjs')), '聚合构建入口应在场').toBe(true)
  })
})
