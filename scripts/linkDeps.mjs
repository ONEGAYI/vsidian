#!/usr/bin/env node
// linkDeps.mjs — 把工作树 node_modules 以 junction 指向按 lockfile 哈希
// 寻址的共享依赖缓存（多 worktree 并行开发的依赖预置工具）。
//
// 用法：node scripts/linkDeps.mjs [工作树目录=当前目录] [--cache-root <目录>]
//
//   缓存默认在 <工作树父目录>/.deps/<sha256(package-lock.json) 前 12 位>/，
//   缓存未建时先复制 package.json + package-lock.json 进哈希目录并在其中
//   npm ci。幂等：junction 已指向该缓存 → 直接退出；指向别处 → 重建；
//   真实 node_modules 在场 → 中止不删（防误删本地真实依赖）。
//   junction 在场时禁止在工作树内 npm ci/install（会写穿共享缓存）。
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const cacheRootFlag = argv.indexOf('--cache-root')
const cacheRootArg = cacheRootFlag >= 0 ? argv.splice(cacheRootFlag, 2)[1] : undefined
const target = resolve(argv[0] ?? process.cwd())
const cacheRoot = resolve(cacheRootArg ?? join(dirname(target), '.deps'))

const die = (msg) => {
  console.error(`linkDeps: ${msg}`)
  process.exit(1)
}

for (const f of ['package.json', 'package-lock.json']) {
  if (!existsSync(join(target, f))) die(`<${target}> 缺 ${f}，不是 npm 工程根`)
}

const hash = createHash('sha256').update(readFileSync(join(target, 'package-lock.json'))).digest('hex').slice(0, 12)
const cacheDir = join(cacheRoot, hash)
const cacheNm = join(cacheDir, 'node_modules')
const link = join(target, 'node_modules')

if (!existsSync(cacheNm)) {
  mkdirSync(cacheDir, { recursive: true })
  for (const f of ['package.json', 'package-lock.json']) {
    const src = readFileSync(join(target, f))
    writeFileSync(join(cacheDir, f), src)
  }
  console.log(`缓存未建，在 ${cacheDir} 内 npm ci（首次较慢）…`)
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: cacheDir,
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) die(`缓存内 npm ci 失败（exit ${r.status}）；可删除 ${cacheDir} 后重试`)
}

if (existsSync(link)) {
  const st = lstatSync(link)
  if (!st.isSymbolicLink()) {
    die(`<${link}> 是真实目录（曾本地安装），中止不删；确认可弃后手动删除再重跑`)
  }
  if (realpathSync(link) === realpathSync(cacheNm)) {
    console.log(`已链接（幂等）：${link} → ${cacheNm}`)
    console.log(`提醒：junction 在场时禁止在 <${target}> 内 npm ci/install（会写穿共享缓存）。`)
    process.exit(0)
  }
  rmSync(link, { recursive: true, force: true })
}

mkdirSync(dirname(link), { recursive: true })
const r = spawnSync('cmd', ['/c', 'mklink', '/J', link, cacheNm])
if (r.status !== 0 || !existsSync(link)) die(`mklink /J 失败：${r.stdout?.toString()?.trim() ?? ''} ${r.stderr?.toString()?.trim() ?? ''}`)
console.log(`已链接：${link} → ${cacheNm}`)
console.log(`提醒：junction 在场时禁止在 <${target}> 内 npm ci/install（会写穿共享缓存）。`)
