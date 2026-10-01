---
name: release
description: 在 vsidian 仓库准备或执行版本发布时使用：升版本与 CHANGELOG 段落校验、VSIX 打包、体积红线与包内容双重防线、图标约定、发版步骤、CI 自动发布（v* 标签触发）、marketplace 发布配置与失败兜底、README 双语镜像。日常开发不涉及发版时不需要。
---

# 打包与发布

（本技能 2026-09-27 自 AGENTS.md「打包与发布」节迁入，AGENTS.md 留触发指针；内容未改。通用发布规范（提交、CHANGELOG 语言等）另见用户全局 `suian-release` 技能与工程根 AGENTS.md。）

## 体积红线

VSIX 解压总量警告 8.5 MB / 上限 9.5 MB（#85 代码块高亮后基线约 4.45 MB 时首次上调；v0.5.0 后基线约 5.44 MB，距警告线 5.5 MB 仅约 66 KB，用户决策两条线各上调 1 MB；v0.8.0 批次（查找引擎、悬停预览、文档嵌入与中文分词）后基线约 6.54 MB，距警告线 6.5 MB 仅约 109 KB，用户决策两条线各上调 2 MB），一般单文件警告 3 MB / 上限 4 MB，图标上限 100 KB（256×256）。阈值定义在 `scripts/release.mjs` 的 `SIZE_LIMITS`；修改阈值视同变更本约定，需同步本技能。#60 起基线含 mermaid 独立产物 `out/webview/mermaid.js`（minify 后约 2.6 MB，刻意 vendored 的按需懒加载渲染器，单文件与总量阈值据此上调）；主 bundle main.js 现约 1.94 MB（v0.8.0 实测，含 CM6 + KaTeX、Lezer 语言表、查找引擎、悬停/嵌入与分词），不触发单文件警告——其增长由总量线约束，属已接受取舍。

## 双重防线

`.vscodeignore` 挡打包输入，`scripts/release.mjs` 的 `inspectVsixEntries` 检查最终产物（必需清单 + `out/` 白名单 + 禁止模式 + 体积阈值），每次发布前必跑（`npm run release:check`，或随 `npm run release` / CI 自动执行）。新增运行时资产时两处同步维护：`.vscodeignore` 放行 + `REQUIRED_EXTENSION` 登记；漏登记（缺失）与 out/ 未登记产物（多余，如调试遗留）都会被发布检查拦下（`.github/` 混入包内即此类事故，实测发生过）。字体只随包 woff2（chrome118 目标足够），`.woff`/`.ttf` 混入即硬错误——它是字体裁剪失效的信号。

## 图标

`media/vsidian-icon.png` 为原图（1254×1254），仅存仓库溯源、**不进 VSIX**；打包用 `media/vsidian-icon-256.png`（package.json `icon` 指向它）。替换图标时重新生成 256 版（PIL LANCZOS + optimize 即可），保持两文件同名关系。

## 发布流程

`CHANGELOG.md` 最新 `## <版本> - <日期>` 段落必须与 package.json `version` 一致（`scripts/release.mjs` 强校验，并以该段落作为 GitHub Release 说明；顶部常驻的 `## Unreleased` 段被提取跳过，可与版本段共存）。发版步骤：升 `version` + **Unreleased 段转正**为 `## <版本> - <日期>`，并**同笔在顶部重建空的 `## Unreleased - 开发中` 段**（发布后批次条目自断有段可记——v0.5.0 后无人重建，四个批次把条目回填进已定案的 0.5.0 段，靠 0.6.0 手工迁回）→ **重跑 `npm run gen:styleguide`**（三份指南产物内嵌版本戳与 `generatedAt` 随版本段变化，须在版本段落定后跑——v0.5.0 实证漏跑 tag 推送失败；v0.6.0 实证转正前跑产出 fallback 日期，同样被 guide-consistency 拦）→ 连同指南产物提交 → `npm run release:check` 本地过检查（含与 CI 发布链相同的契约复验链）→ `git tag v<版本>` → `npm run release`（或推 tag 由 CI 执行）。已发布版本段落随 tag 定案不得回填删改：契约检查器 `changelog-section-mutated` 以 tag 时点快照比对段落正文（排版与折行差异豁免，条目增删必拦），本地与 CI 同拦。发布提交直推 main 会 bypass 远端必需状态检查——推送后跟踪该次 CI 运行至全绿再离手（失败先 `gh run rerun <id> --failed` 判别间歇性，非间歇失败需修复并重新评估 tag 指向）。

## CI 自动发布

`.github/workflows/release.yml` 由 `v*` 标签触发。`release` job 在 `npm run release` 前先跑契约复验链（`check:stylecontract:baseline` + `check:stylecontract`，#135：30 天期限/发布跨度/兼容性复验，失败即不打包不产出 Release），随后跑 `npm run release`（检查失败即中止，不产出 Release）；`marketplace` job 从 Release 下载同一 VSIX 发布到 Marketplace（上市场的与 Release 附带的是同一份字节），需先配置仓库 secret `VSCE_PAT`（Azure DevOps PAT：Organization 选 All accessible organizations，Scope 选 Marketplace → Manage）并将 variable `MARKETPLACE_PUBLISH` 设为 `true`——两道开关配置前，推 tag 只产出 GitHub Release。

## marketplace 失败的兜底

v0.1.0 首发实测两坑——job 级 `if` 隐式 `success() &&` 前缀会跳过 dispatch 场景（已用 `!cancelled()` 豁免）；给已注册 workflow 新增触发器后平台注册实体可能滞留旧解析（dispatch 持续 422，对文件做字节变更推送也未能刷新）。**已验证的补发路径**：本地 `gh release download <tag> --pattern '*.vsix'` 下载同一 VSIX 后 `npx @vscode/vsce publish --no-dependencies --packagePath <vsix>`（依赖本地 `vsce login onegayi` 凭证）；dispatch 入口保留，注册表自愈后仍可用。

## README 双语

`README.md`（中文，Marketplace 渲染这份）与 `README.en.md` 互为镜像，文首以**绝对 URL** 互指（相对链接在 Marketplace 页面会失效）。功能与用法变更两边同步维护；`README.en.md` 不进 VSIX（`.vscodeignore` 排除）。
