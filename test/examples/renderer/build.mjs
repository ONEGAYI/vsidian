// #364 T15 渲染样例——单工程构建入口（共享构建库见 ../tools/buildLib.mjs）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExample } from '../tools/buildLib.mjs'

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

buildExample({
  exampleDir,
  pages: [{ entry: 'src/page-editor.ts', out: 'dist/editor.js' }],
  host: 'src/extension.ts',
})
  .then(() => console.log(`[renderer] 构建完成：${path.join(exampleDir, 'dist')}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
