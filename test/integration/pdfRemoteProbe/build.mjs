// #620（V02）Remote SSH 探针构建器：esbuild 五产物（三/四扩展 + 主套件 +
// 断连套件 + fixtureGen）-> fixture 生成 -> 手工 VSIX（ui/dual/installee）。
// 不改 esbuild.mjs（产品构建入口）与 package.json；esbuild 经仓库
// node_modules（junction 预置）。探针代码，不定义产品行为。
//
//   node test/integration/pdfRemoteProbe/build.mjs
//
// 产物布局（全在 out/，gitignore 排除）：
//   out/test/integration/pdfRemoteProbe/
//     suite.js / disconnectSuite.js / fixtureGen.js
//     exts/{workspace,ui,dual,installee}/{package.json,out/extension.js}
//     vsix/{ui,dual,installee}-0.0.1.vsix
//     fixture/（sample.md + probe-img.png + installee.vsix）

import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const probeDir = path.join(root, 'test', 'integration', 'pdfRemoteProbe')
const outRoot = path.join(root, 'out', 'test', 'integration', 'pdfRemoteProbe')
const extNames = ['workspace', 'ui', 'dual', 'installee', 'shell']

mkdirSync(outRoot, { recursive: true })

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'], sourcemap: false, logLevel: 'info' }
await build({ ...common, entryPoints: [path.join(probeDir, 'suite.ts')], outfile: path.join(outRoot, 'suite.js') })
await build({ ...common, entryPoints: [path.join(probeDir, 'disconnectSuite.ts')], outfile: path.join(outRoot, 'disconnectSuite.js') })
await build({ ...common, entryPoints: [path.join(probeDir, 'fixtureGen.ts')], outfile: path.join(outRoot, 'fixtureGen.js') })
for (const name of extNames) {
  const extOut = path.join(outRoot, 'exts', name, 'out')
  mkdirSync(extOut, { recursive: true })
  await build({
    ...common,
    entryPoints: [path.join(probeDir, `ext${name.charAt(0).toUpperCase()}${name.slice(1)}`, 'extension.ts')],
    outfile: path.join(extOut, 'extension.js'),
  })
  copyFileSync(path.join(probeDir, `ext${name.charAt(0).toUpperCase()}${name.slice(1)}`, 'package.json'), path.join(outRoot, 'exts', name, 'package.json'))
}

// fixture
const fixtureDir = path.join(outRoot, 'fixture')
rmSync(fixtureDir, { recursive: true, force: true })
mkdirSync(fixtureDir, { recursive: true })
const gen = spawnSync(process.execPath, [path.join(outRoot, 'fixtureGen.js'), fixtureDir], { stdio: 'inherit' })
if (gen.status !== 0) throw new Error(`fixtureGen 失败（${gen.status}）`)

// VSIX（python zipfile 手工打包：vsixmanifest + [Content_Types].xml + extension/）
const vsixDir = path.join(outRoot, 'vsix')
mkdirSync(vsixDir, { recursive: true })
for (const name of ['ui', 'dual', 'installee', 'workspace']) {
  const manifest = extensionVsixManifest(name)
  const py = spawnSync('python', ['-c', makeZipScript(name), manifest.replace(/'/g, "\\'")], {
    cwd: root,
    env: { ...process.env, PROBE_EXT_DIR: path.join(outRoot, 'exts', name), PROBE_VSIX_OUT: path.join(vsixDir, `${name}-0.0.1.vsix`) },
  })
  if (py.status !== 0) throw new Error(`VSIX 打包失败（${name}，${py.status}）：${py.stdout}${py.stderr}`)
  console.log(`[build] vsix/${name}-0.0.1.vsix`)
}
copyFileSync(path.join(vsixDir, 'installee-0.0.1.vsix'), path.join(fixtureDir, 'installee.vsix'))
console.log('[build] 全部产物就绪')

function extensionVsixManifest(name) {
  const display = name === 'ui' ? 'PDF Remote Probe UI' : name === 'dual' ? 'PDF Remote Probe Dual' : name === 'workspace' ? 'PDF Remote Probe Workspace' : 'PDF Remote Probe Installee'
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="pdf-remote-probe-${name}" Version="0.0.1" Publisher="vsidian"/>
    <DisplayName>${display}</DisplayName>
    <Description xml:space="preserve">V02 Remote SSH probe fixture extension</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.82.0"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.License" Value=""/>
    </Properties>
  </Metadata>
  <Installation InstalledByMsi="false">
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>`
}

function makeZipScript(name) {
  // 读 PROBE_EXT_DIR 打包为 PROBE_VSIX_OUT；manifest 经 argv 注入
  return [
    'import os, sys, zipfile',
    'manifest = sys.argv[1]',
    'ext_dir = os.environ["PROBE_EXT_DIR"]',
    'out = os.environ["PROBE_VSIX_OUT"]',
    'with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:',
    `    z.writestr("extension.vsixmanifest", manifest)`,
    '    z.writestr("[Content_Types].xml", \'<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/></Types>\')',
    '    pkg = os.path.join(ext_dir, "package.json")',
    '    z.write(pkg, "extension/package.json")',
    '    js = os.path.join(ext_dir, "out", "extension.js")',
    '    z.write(js, "extension/out/extension.js")',
    '    map = js + ".map"',
    'print("vsix ok:", out)',
  ].join('\n')
}
