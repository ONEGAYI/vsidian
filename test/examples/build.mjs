// #364 T15 样例聚合构建入口：node test/examples/build.mjs [--name=<工程名>]
// （缺省构建全部三工程；产物在各工程 dist/，git 忽略）。单工程构建入口
// 在各工程自己的 build.mjs。产物扫描（CM6/内部路径/裸 require）随构建
// 逐产物执行——构建通过即扫描通过。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAllExamples, buildExample, EXAMPLE_PROJECTS } from './tools/buildLib.mjs'

const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

const nameArg = process.argv.find((arg) => arg.startsWith('--name='))
if (nameArg) {
  const name = nameArg.slice('--name='.length)
  if (!EXAMPLE_PROJECTS.includes(name)) {
    console.error(`[examples] 未知样例工程 ${name}（可选：${EXAMPLE_PROJECTS.join(' / ')}）`)
    process.exit(1)
  }
  await buildExample({
    exampleDir: path.join(examplesRoot, name),
    pages: name === 'ui-command'
      ? [
          { entry: 'src/page-editor.ts', out: 'dist/editor.js' },
          { entry: 'src/page-settings.ts', out: 'dist/settings.js' },
        ]
      : [{ entry: 'src/page-editor.ts', out: 'dist/editor.js' }],
    host: 'src/extension.ts',
  })
  console.log(`[examples] ${name} 构建完成`)
} else {
  await buildAllExamples()
  console.log(`[examples] 全部样例构建完成：${EXAMPLE_PROJECTS.join(' / ')}`)
}
