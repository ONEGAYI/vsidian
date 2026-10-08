// #364 T15 界面样例——单工程构建入口（编辑器页 + 自有设置页两个页面产物）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExample } from '../tools/buildLib.mjs'

const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

buildExample({
  exampleDir,
  pages: [
    { entry: 'src/page-editor.ts', out: 'dist/editor.js' },
    { entry: 'src/page-settings.ts', out: 'dist/settings.js' },
  ],
  host: 'src/extension.ts',
})
  .then(() => console.log(`[ui-command] 构建完成：${path.join(exampleDir, 'dist')}`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
