// V02 验证票（#349）：测试附加组件构建脚本（SDK 构建辅助工具的最小形态）。
// 产物（.build/，git 忽略，运行时构建）：
// - test-addon/dist/{page.js, page.css, logo.png}——主测试组件（IIFE +
//   独立样式 + 资源子目录内容）；
// - throw-addon/dist/throw.js——故障注入组件（工厂同步抛错）；
// - outside/{denied.js, denied.css, denied.png}——越界对照资源（不注册进
//   任何 localResourceRoots，资源服务应拒绝）。
// 构建目标 chrome114：对齐实测下界宿主（1.82.3 = Electron 25 / Chromium
// 114）——组件产物在下界宿主真实执行是本票证据的一部分（生产 webview
// 产物仍为 chrome118，两者含义见结论文档）。
// 静态红线：组件产物不得包含 CM6 运行时标记串——出现即构建失败（构建桥
// 拒绝 @codemirror/* 值导入是第一道防线，此处是第二道）。
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSdkBridgePlugin } from './sdkBridge.mjs'

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = path.join(fixtureRoot, '.build')

/** @codemirror/state 与 @codemirror/view 发行产物中的稳定标记串：
 *  组件产物若含任一即证明打包进了第二份 CM6 运行时 */
export const CM6_RUNTIME_MARKERS = [
  'Unrecognized extension value',
  'Widget decorations can only have zero-length ranges',
]

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const DENIED_JS = `// 越界对照脚本：执行即落标记（探针断言装载失败后该标记始终不存在）
;(globalThis.__vsidianAddonPages ??= []).push({
  addonId: 'onegayi.vsidian-denied-addon',
  factory: () => { globalThis.__vsa2DeniedExecuted = true },
  registeredAt: Date.now(),
})
`

const DENIED_CSS = '/* 越界对照样式 */\n.vsa2-denied { color: rgb(255, 0, 0); }\n'

/** #351 T02 夹具组件样式：编辑器页首字符标记（绘制层断言锚——计算色
 *  rgb(0, 200, 120)，与 V02 的 rgb(255,0,127) 区分）与设置页标题 */
const T02_EDITOR_CSS = '.t02-mark { background-color: rgb(0, 200, 120); }\n'
/** #358 T09 夹具组件样式：渲染器容器内 t09-box（绘制层断言锚——计算色
 *  rgb(9, 96, 246)，与 t02 标记色区分） */
const T09_EDITOR_CSS = '.t09-box { background-color: rgb(9, 96, 246); color: rgb(255, 255, 255); padding: 4px 8px; display: inline-block; }\n'
const T02_SETTINGS_CSS = '.t02-settings-root .t02-title { color: rgb(0, 120, 200); }\n'

/** 断言产物不含 CM6 运行时标记（组件未重打包共享运行时） */
export function assertNoCm6Runtime(productPath) {
  const text = readFileSync(productPath, 'utf8')
  for (const marker of CM6_RUNTIME_MARKERS) {
    if (text.includes(marker)) {
      throw new Error(`${productPath} 含 CM6 运行时标记「${marker}」——组件产物不得重打包 @codemirror/*（构建桥应拒绝其值导入）`)
    }
  }
}

export async function buildTestAddons({ log = console.log } = {}) {
  rmSync(buildRoot, { recursive: true, force: true })
  const sdkBridge = createSdkBridgePlugin()
  const targets = [
    {
      entry: path.join(fixtureRoot, 'addon', 'page.ts'),
      outfile: path.join(buildRoot, 'test-addon', 'dist', 'page.js'),
      note: 'test-addon（主组件）',
    },
    {
      entry: path.join(fixtureRoot, 'addon', 'throw.ts'),
      outfile: path.join(buildRoot, 'throw-addon', 'dist', 'throw.js'),
      note: 'throw-addon（故障注入）',
    },
    // #351 T02：生产路径集成夹具组件（编辑器页与自身设置页两个入口）
    {
      entry: path.join(fixtureRoot, 'addon', 't02Editor.ts'),
      outfile: path.join(buildRoot, 't02-addon', 'dist', 'editor.js'),
      note: 't02-addon 编辑器页',
    },
    {
      entry: path.join(fixtureRoot, 'addon', 't02Settings.ts'),
      outfile: path.join(buildRoot, 't02-addon', 'dist', 'settings.js'),
      note: 't02-addon 设置页',
    },
    // #355 T06：统一视图编辑 API 夹具组件（编辑器页长轮询驱动消费）
    {
      entry: path.join(fixtureRoot, 'addon', 't06Editor.ts'),
      outfile: path.join(buildRoot, 't06-addon', 'dist', 'editor.js'),
      note: 't06-addon 编辑器页',
    },
    // #356 T07：可组合输入行为夹具组件（编辑器页行为注册 + 事件上报）
    {
      entry: path.join(fixtureRoot, 'addon', 't07Editor.ts'),
      outfile: path.join(buildRoot, 't07-addon', 'dist', 'editor.js'),
      note: 't07-addon 编辑器页',
    },
    // #358 T09：渲染提供者夹具组件（编辑器页 renderers.register 消费）
    {
      entry: path.join(fixtureRoot, 'addon', 't09Renderer.ts'),
      outfile: path.join(buildRoot, 't09-addon', 'dist', 'editor.js'),
      note: 't09-addon 编辑器页',
    },
    // #359 T10：命令/菜单/快捷键夹具组件（编辑器页——commands/menus 面
    // 注册 + 负向对照 + views 真实业务；短轮询驱动与 T06 同款）
    {
      entry: path.join(fixtureRoot, 'addon', 't10Editor.ts'),
      outfile: path.join(buildRoot, 't10-addon', 'dist', 'editor.js'),
      note: 't10-addon 编辑器页',
    },
    // #360 T11：界面贡献夹具组件（编辑器页——ui 面注册按钮/面板 + 负向
    // 对照 + target 句柄真实业务；短轮询驱动与 T06/T10 同款）
    {
      entry: path.join(fixtureRoot, 'addon', 't11Editor.ts'),
      outfile: path.join(buildRoot, 't11-addon', 'dist', 'editor.js'),
      note: 't11-addon 编辑器页',
    },
  ]
  for (const target of targets) {
    const result = await build({
      entryPoints: [target.entry],
      outfile: target.outfile,
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'chrome114',
      minify: true,
      sourcemap: false,
      logLevel: 'silent',
      plugins: [sdkBridge],
    })
    assertNoCm6Runtime(target.outfile)
    const bytes = statSync(target.outfile).size
    log(`[buildAddon] ${target.note} -> ${path.relative(fixtureRoot, target.outfile)}（${bytes} B，无 CM6 标记）`)
  }
  // 资源与对照产物
  const distDir = path.join(buildRoot, 'test-addon', 'dist')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(path.join(distDir, 'page.css'), readFileSync(path.join(fixtureRoot, 'addon', 'page.css')))
  writeFileSync(path.join(distDir, 'logo.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  // #351 T02 夹具组件资源：两页样式 + 资源子目录（resourceUri 锚）
  const t02Dist = path.join(buildRoot, 't02-addon', 'dist')
  const t09Dist = path.join(buildRoot, 't09-addon', 'dist')
  mkdirSync(t09Dist, { recursive: true })
  writeFileSync(path.join(t09Dist, 'editor.css'), T09_EDITOR_CSS)
  mkdirSync(path.join(t02Dist, 'assets'), { recursive: true })
  writeFileSync(path.join(t02Dist, 'editor.css'), T02_EDITOR_CSS)
  writeFileSync(path.join(t02Dist, 'settings.css'), T02_SETTINGS_CSS)
  writeFileSync(path.join(t02Dist, 'assets', 'logo.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  const outsideDir = path.join(buildRoot, 'outside')
  mkdirSync(outsideDir, { recursive: true })
  writeFileSync(path.join(outsideDir, 'denied.js'), DENIED_JS)
  writeFileSync(path.join(outsideDir, 'denied.css'), DENIED_CSS)
  writeFileSync(path.join(outsideDir, 'denied.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  return {
    buildRoot,
    testAddon: {
      installDir: path.join(buildRoot, 'test-addon'),
      entry: path.join(distDir, 'page.js'),
      css: path.join(distDir, 'page.css'),
      resourceDir: distDir,
    },
    throwAddon: {
      installDir: path.join(buildRoot, 'throw-addon'),
      entry: path.join(buildRoot, 'throw-addon', 'dist', 'throw.js'),
    },
    // #351 T02：集成夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t02）
    t02Addon: {
      installDir: path.join(buildRoot, 't02-addon'),
      distDir: t02Dist,
    },
    // #355 T06：夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t06）
    t06Addon: {
      installDir: path.join(buildRoot, 't06-addon'),
      distDir: path.join(buildRoot, 't06-addon', 'dist'),
    },
    // #356 T07：夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t07）
    t07Addon: {
      installDir: path.join(buildRoot, 't07-addon'),
      distDir: path.join(buildRoot, 't07-addon', 'dist'),
    },
    // #358 T09：夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t09）
    t09Addon: {
      installDir: path.join(buildRoot, 't09-addon'),
      distDir: path.join(buildRoot, 't09-addon', 'dist'),
    },
    // #359 T10：夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t10）
    t10Addon: {
      installDir: path.join(buildRoot, 't10-addon'),
      distDir: path.join(buildRoot, 't10-addon', 'dist'),
    },
    // #360 T11：夹具组件布局（runTest.mjs 拷入 addonFixtures/addon-t11）
    t11Addon: {
      installDir: path.join(buildRoot, 't11-addon'),
      distDir: path.join(buildRoot, 't11-addon', 'dist'),
    },
    outsideDir,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  buildTestAddons()
    .then((layout) => console.log(`[buildAddon] 完成：${layout.buildRoot}`))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
