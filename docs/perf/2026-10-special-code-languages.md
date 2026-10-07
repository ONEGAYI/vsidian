# 新词法语言验证记录（#390）

日期：2026-10-07。实现范围与来源见[词法来源与范围](../specs/code-language-sources.md)。

## 基线

基线为已测试 T01 提交 `0808e529f83c5104698ddece8e8bc310f062906f`：production `out/webview/main.js` 2,240,210 B，总随包解压体积 12,304,446 B。现有总量警告/失败阈值为 13/13.5 MiB，单文件警告/失败阈值为 3/4 MiB；本次不修改门禁。

## 红绿与类型

- SPICE：路由/标签/词法/视图/后缀缺失时 6 项红；补齐后 203 项目标测试通过
- GNU Makefile：嵌套变量/注释/recipe 与路由缺失时 3 项红；补齐后 209 项通过
- GraphQL：操作/SDL/块字符串和路由缺失时 4 项红；补齐后 216 项通过
- PHP：plain/tagged/HTML 与路由缺失时 4 项红；官方 heredoc 标签缺失另有真实红例，补 styleTags 后 223 项通过
- 后片先挂、Live 连续性、共享引用、4096/4097 边界和异常长行增加后，239 项目标测试通过
- 初次全仓类型检查进程被杀；768 MiB 限制重试明确 V8 堆不足。共享验证锁串行、2048 MiB 重新运行 `tsc --noEmit` 通过，不把资源失败当代码通过或忽略

本记录不把 DOM 单测视为真实绘制证据。正式绘制、完整单测、包体和样式门禁结果在完成后追加；真实宿主与全量浏览器仍由整批合并前验收负责。

## 第一轮绘制与评审修复

- 生产浏览器单套 `codeCardChrome` 通过，20.96 秒：四语言明暗词类/徽标、PHP/GraphQL 跨 60 行与阅读视口重挂。报告位于本地 `out/test/browser-runs/run-ENNevd/`；此结果早于后续三个评审修复，最终候选需重新执行
- 两轴评审发现并用公开入口红绿修复：SPICE/GraphQL 无效数字逐字符回退的二次方扫描、PHP 把前导自然语言撇号恢复为字符串而遮住真实开标签、Makefile 变量赋值的分号误进入 recipe
- 无效数字回归为单行 32,000 位数字加下划线：修复前 SPICE 3,535.8ms、GraphQL 2,627.2ms，均超过新测试的 1,000ms 同步处理上界；改为先消费整个数字形态片段再完整校验，目标测试通过。4096 行门禁和既有包体门禁均未放宽
- PHP 覆盖撇号未闭合和后续闭合两种前导文本，同时保留有效 PHP 字符串/注释/heredoc 里的开标签示例；Makefile 覆盖普通赋值、目标专属赋值和合法行内 recipe
- 三项修复后 245 项目标测试通过。此前排队的全量验证已取消，避免将旧候选结果冒充最终结果；下一轮必须先 compile 再跑全量单测（字节预算测试依赖构建产物）
- 后续检查确认 PHP 同一有效字符串含 64,000 个开标签示例时重复扫描，公开测试修复前 1,614.6ms。保护区间结束偏移避免重复检查同一字面量；该测试与其余回归全部通过，最终目标集为 246 项。此修复没有删除或放宽前三项回归

- 最终 compile 另捕获官方 LanguageSupport 的静态类型边界：其 language.parser 仅声明为 Parser，不能直接调用 LRParser.configure。适配改为显式 LRLanguage 运行时窄化后配置 heredoc 标签；没有类型断言或静默跳过。246 项目标测试仍通过，compile-first 序列重新开始

## 最终候选验证

- `npm run compile`（含 2048 MiB 串行 `tsc --noEmit`）通过；生成的 NLS 与双语样式指南无变化
- 所有评审修复后的 `codeCardChrome` 再次通过：18.60 秒，明暗双模式、四种语言徽标以及 PHP/GraphQL 跨片重挂均保持真实绘制
- 全量 Vitest：`npx vitest run --maxWorkers=1 --reporter=default`，293 文件 / 6,692 用例全部通过，355.45 秒
- 随后按默认文件并发执行 Node 契约时，`test/browser/runner.test.mjs:41` 的 150ms 子进程重叠断言出现 `peak=1`、期望 `2`；原始记录保留，未修改 fixture、延时或断言，也未按已知抖动豁免
- 据该实际失败检查原实现（本批没有改动 runner），单独运行 `node --test test/browser/runner.test.mjs`：5/5 通过；再以 `node --test --test-concurrency=1` 执行原五个 Node 契约文件：115 通过 / 6 项平台条件跳过 / 0 失败。只消除文件间进程争用，runner 内部两并发及 peak=2 断言仍在；CI 默认命令仍是独立门禁，不能用本地串行结果代替
- `npm run check:stylecontract`、双语指南 `--check`、文件树 `check --strict`、`git diff --check` 均通过；公开样式历史基线和阈值未修改
- 最终绘制报告：本地 `out/test/browser-runs/run-5whbTi/`。原始编译、红绿、串行契约及包体 JSON 存于本次本地验证产物，不随 VSIX 分发


## Production 包体

通过 `vsce package --no-dependencies` 触发既有 production 构建，使用仓库原 `inspectVsixEntries` 对实际归档执行必需清单、禁止模式和原体积阈值检查：314 个归档条目，零错误、零警告。

| 指标 | T01 基线 | T02 候选 | 增量 |
| --- | ---: | ---: | ---: |
| `out/webview/main.js` | 2,240,210 B | 2,344,437 B | +104,227 B |
| 总随包解压体积 | 12,304,446 B | 12,411,615 B | +107,169 B |
| 候选 VSIX 压缩体积 | — | 4,981,567 B | — |

主包低于 3 MiB 警告线，总量低于 13 MiB 警告线；保留既有同步引擎和 64 项 LRU，不引入异步 grammar 协议或懒加载。本次总包增量包含 PHP grammar、三个原创 mode、标签选择/修复、徽标、随包 README/CHANGELOG 与两份 MIT 许可原文。`npm ls` 验证 PHP 复用既有 CodeMirror/Lezer 版本，没有重复 CodeMirror 实例或额外语言服务依赖。

## 剩余验收

两轴代码/规格评审均已复核通过。以上为本地 T02 独立工作树证据；本轮没有执行真实 VS Code 宿主全量集成或整个浏览器脚本清单，不宣称它们通过。整批合并树的默认 CI、真实宿主、全量浏览器及最终包体仍须独立验收；本次没有合并、发布或调整任何通过门槛。
