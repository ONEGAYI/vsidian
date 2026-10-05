# VSCode Ctrl+P 文件匹配规则核查

## 结论与核查范围

2026-10-05 为双链输入联想核查 VSCode 官方源码和官方测试。可参考其按顺序模糊匹配、文件名／前缀加权和路径查询分支；Vsidian 继续使用已确认的文件范围、排除规则及 mtime 排序。交互共识见[专项记录](../specs/wikilink-completion.md)。

当前参照固定为 [main 提交 `2dca67a07aba894351849f39d337a921758722e8`](https://github.com/microsoft/vscode/commit/2dca67a07aba894351849f39d337a921758722e8)，另对照 [1.82.3 提交 `fdb98833154679dbaa7af67a5a29fe19e55c2b73`](https://github.com/microsoft/vscode/commit/fdb98833154679dbaa7af67a5a29fe19e55c2b73)。当前源码参照与本项目宿主下界分别记录，不宣称两者全部行为相同。

本次只做源码与测试阅读，未运行 VSCode Ctrl+P 交互探针或官方测试，也未验证 Vsidian 的匹配实现或大库性能。

## 已核实的匹配事实

1. **文件候选允许按顺序跳字符匹配**。Quick Open 对文件候选调用评分器时允许不连续匹配；逐字符评分还给连续命中、相同大小写、词首和驼峰边界加分。[文件调用](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L452-L493)、[字符评分规则](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L158-L227)

2. **普通查询对文件名和前缀有加权**。无路径分隔符时，文件名命中采用独立基础分，前缀匹配还有奖励；完整路径相等另有高优先级分支。[评分分支](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L450-L531)

3. **带路径分隔符时使用路径分支**。`/`、`\` 按平台规范化，文件名优先分支关闭，结合目录描述与文件名评分。[规范化](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L920-L934)、[路径评分](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L499-L575)

4. **空格多词要求每片都命中，词序可交换**。查询按字面空格拆片，独立评分并累加；任一片未命中则整项不匹配。[拆片与准备](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L877-L917)、[多片评分](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L467-L495)

5. **片段首尾的双引号要求连续子串**。引号控制是否允许跳字符，不表示整个名称必须相等；因查询先按空格拆片，不能概括为支持带空格的完整短语解析。[引号与拆片](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L844-L917)

核心文件匹配分支在 1.82.3 已存在；本次对照读取了该版本的 [Quick Open 调用](https://github.com/microsoft/vscode/blob/fdb98833154679dbaa7af67a5a29fe19e55c2b73/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L459-L502)、[评分器](https://github.com/microsoft/vscode/blob/fdb98833154679dbaa7af67a5a29fe19e55c2b73/src/vs/base/common/fuzzyScorer.ts#L423-L504)及[测试](https://github.com/microsoft/vscode/blob/fdb98833154679dbaa7af67a5a29fe19e55c2b73/src/vs/base/test/common/fuzzyScorer.test.ts#L228-L270)。

## 排序与候选范围的区别

Ctrl+P 的完整比较器在匹配分数之外，还比较命中紧凑程度、名称长度、路径长度和文本。连续子串和跳字符匹配共享字符评分；源码不能简化为“所有精确／前缀／包含／模糊结果分别排成四档”。[完整比较顺序](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/common/fuzzyScorer.ts#L648-L814)

空查询的 Ctrl+P 主要使用编辑历史；有查询时，历史与文件结果也分别取得再组合。历史的匹配参数和近期排序与文件候选不同，不能称为统一的 mtime 文件排序。[历史与文件分组](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L402-L445)、[历史规则](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L502-L569)

Ctrl+P 另有跨工作区根的路径直达查询，目录参与匹配但不成为独立目录候选。Vsidian 的联想仍限定直接来源所属根，并沿用自身索引排除范围。[路径直达](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L622-L632)、[文件判定和各根解析](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts#L758-L802)

## 官方测试示例

| 查询／对象 | 测试覆盖的行为 |
| --- | --- |
| `HW` → `HelLo-World`；`edcda` → `abcde` | 前者能跳字符匹配；后者字符顺序不成立。[测试](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/test/common/fuzzyScorer.test.ts#L113-L143)、[逆序例](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/test/common/fuzzyScorer.test.ts#L482-L487) |
| `xyz some`／`some xyz` → `/xyz/some/path/someFile123.txt` | 词序交换仍命中并同分。[测试](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/test/common/fuzzyScorer.test.ts#L250-L270) |
| `url/def` | 路径分支让 `djangosite/urls/default.py` 优于 `djangosite/ufrela/def.py`。[测试](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/test/common/fuzzyScorer.test.ts#L1191-L1204) |
| `"contguous"`／`"contiguous"` → `contiguous` | 成对引号限制为连续匹配，缺字的前者不命中。[测试](https://github.com/microsoft/vscode/blob/2dca67a07aba894351849f39d337a921758722e8/src/vs/base/test/common/fuzzyScorer.test.ts#L1380-L1386) |

## 已确认采用方向与技术提议

2026-10-05 用户已从“参考 Ctrl+P”进一步确认“直接基于 VSCode 查询逻辑做候选联想，少量按需要修改”，见 [ADR-0014](../adr/0014-vscode-query-matching-for-wikilinks.md)。以下为该方向的适配提议，尚未形成获批准的完整实施规格。

- 以现有查询准备、逐字符评分、文件名／前缀奖励与路径分支为基线；适配范围、空格多词和引号的支持在技术规格中写明，不另造替代评分规则。
- 有查询时按匹配分数下降，再按 mtime 下降，最后以稳定路径／身份破同分。避免直接套用完整比较器，否则其长度和文本比较会先决定次序，使 mtime 难以生效。
- 候选输入仍来自自身文件清单和排除范围；插入路径由直接来源文档计算，匹配文本不扩大资源解析或加载权限。
- 正式实现需为查询前缀、目录输入、大小写／路径平台语义、UTF-16 高亮区间、大文件清单响应与迟到结果补契约证据。源码阅读不替代这些验证。
