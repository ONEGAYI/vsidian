# 围栏词法来源与范围（#390）

本页记录 SPICE、Makefile、PHP、GraphQL 的来源、许可及词法边界。共同装配、缓存、4096 行降级与两视图/Markdown 引用的约定仍以[代码块规格](code-block-card.md#语法高亮)为准。高亮不代表语法、schema 或仿真有效性。

## 来源与运行时依赖

| 语言 | 实现与精确来源 | 许可与新增依赖 |
| --- | --- | --- |
| SPICE | `src/webview/codeLanguages/spice.ts` 原创 StreamParser；依据 [ngspice 46 手册](https://ngspice.sourceforge.io/docs/ngspice-46-manual.pdf) §2.1.3、§2.4.3–5 与[控制语言教程](https://ngspice.sourceforge.io/ngspice-control-language-tutorial.html) | 项目 MIT；无新增 npm 依赖 |
| Makefile | `src/webview/codeLanguages/makefile.ts` 原创 StreamParser；依据 [GNU make 手册](https://www.gnu.org/software/make/manual/make.html) §3.1、§5.1、变量引用与自动变量章节 | 项目 MIT；无新增 npm 依赖 |
| GraphQL | `src/webview/codeLanguages/graphql.ts` 原创 StreamParser；依据 [September 2025 规范](https://spec.graphql.org/September2025/#sec-Language.Source-Text.Lexical-Tokens)与 StringValue/BlockString 规则 | 项目 MIT；无新增 npm 依赖，不打包 graphql-language-service |
| PHP | 官方 [`@codemirror/lang-php` 6.0.2](https://github.com/codemirror/lang-php)，锁文件固定其解析器 [`@lezer/php` 1.0.6](https://github.com/lezer-parser/php)；`codeLanguages/php.ts` 仅选择顶层规则并补 heredoc 标签 | 两包均 MIT；完整上游许可保留于随包 `LICENSE` |

三个原创 mode 仅参考公开语言规则，没有复制第三方 tokenizer 或手册文本。它们使用已锁定的 `@codemirror/language` 6.12.4 StreamLanguage。PHP 包的其余依赖复用现有 `@codemirror/lang-html` 6.4.12、`@codemirror/language` 6.12.4、`@codemirror/state` 6.7.6、`@lezer/common` 1.5.2、`@lezer/highlight` 1.2.3 和 `@lezer/lr` 1.4.10。本次安装仅新增上述两个 PHP 包，未升级既有依赖。

所有词法模块均在本地随包提供，不联网装载 grammar，不执行 `eval`，不读取 `.include`/Makefile include 目标，不执行 recipe、PHP、GraphQL 请求或 SPICE 控制命令。未进行独立安全审计，不据此宣称没有漏洞。

## 路由与文件后缀

| 规范 id / 标签 | 围栏别名 | 显式文本后缀 | 字形徽标 |
| --- | --- | --- | --- |
| `spice` / SPICE | `sp`、`ngspice`、`hspice` | `.spice`、`.sp`、`.cir` | SP |
| `makefile` / Makefile | `make`、`mk` | `.mk`、`.mak` | MK |
| `php` / PHP | 无 | `.php`、`.phtml` | PHP |
| `graphql` / GraphQL | `gql` | `.graphql`、`.gql` | GQL |

大小写、info string 首词遵循公共注册表。别名不会自动成为文件后缀：`.ngspice`、`.hspice`、`.make`、`.makefile` 不因此纳入文本分类；仿真输出 `.raw`、SQLite 数据库 `.sqlite`/`.db` 及无扩展名 `Makefile`/`Dockerfile` 仍保持原分类。

## 词法边界

### SPICE

- 覆盖 ngspice 与常见 HSPICE 风格网表的首词器件/实例名、点指令、参数、十进制/指数/工程单位数、单/双引号表达式、前导 `*` 注释、`;`/`//`/网表 `$` 行尾注释、`+` 续行
- `.control`/`.endc` 跨行保留状态，控制块内 `$inputdir`、`$&gain` 是变量；字符串内的注释符号不截断内容，表达式中的 `*` 不当整行注释
- 围栏常为局部代码，不把首行强制当作仿真标题。不解析模型参数意义、器件类型、厂商专有语法或完整仿真方言；不承诺 Spectre/PSpice 兼容。未闭合引号在物理行末恢复，不跨 `+` 拼接字符串

### GNU Makefile

- 覆盖目标/依赖、常见赋值、条件/include/define 等指令、`$(...)`/`${...}` 嵌套引用、自动变量、tab recipe 和分号行内 recipe
- 引用中的 `#`、转义 `\#` 不是 make 注释；recipe 引号和 shell 词中间的 `#` 不当注释。make 注释与引用在反斜杠续行时保留状态，状态快照独立复制嵌套栈
- 这是 make 词法与基础 shell 引号/注释，非完整 shell parser；不支持 `.RECIPEPREFIX` 自定义 recipe 前缀、复杂 shell heredoc/命令替换或 make 宏展开。未续行的未闭合引用在下一行恢复，不把余下文件吞成变量

### PHP

- 无开标签用官方 `Program`（`plain: true`、无 HTML baseLanguage）；带 `<?php`/`<?=` 与 HTML 模板用官方 `Template` 和 HTML 混合解析器
- 显式开标签或以 HTML 标签开始的模板直接进入 Template；其他含候选开标签的内容先用 Program 识别字符串/注释/heredoc 节点，只保护解析错误前的有效字符串/注释/heredoc 节点，普通字符串还须有真实闭引号；自然语言撇号被错误恢复成字符串时，不遮住后面的真实开标签。同一已保护字面量只检查一次，避免大量开标签示例重复扫描。普通前导文本后的真实开标签也可进入 Template
- 官方 `@lezer/php` 1.0.6 能解析 heredoc，但未给 `HeredocString` 配置高亮标签；适配层仅补 `tags.string`，不改 grammar。已覆盖标签/短 echo、混合 HTML、变量、注释、数字、普通字符串、heredoc
- 不启用短开标签 `<?`，不保证所有 PHP 版本语法或异常片段的恢复外观。上游对未闭合块注释可能恢复为错误表达式；高亮不是 PHP 验证器，自动模板选择也受其恢复树约束

### GraphQL

- 覆盖 query/mutation/subscription、片段、变量、指令、SDL 常见关键字、布尔/null、数字、普通字符串、跨行三引号块字符串和 `#` 注释
- 块字符串内 `#` 保持字符串，转义三引号 `\"""` 不提前结束；普通未闭合双引号在下一物理行恢复，未闭合块字符串延续到围栏末尾
- 名称类别是词法近似：关键字按拼写识别，大写起始名称按 typeName 着色，不做上下文角色或 schema 推断；类型/字段/枚举值等语义校验不在本次范围

## 验证与兼容性

- 独立词法夹具：`test/fixtures/specialCodeLanguages.ts`；正反/边界：`test/unit/specialCodeHighlight.test.ts`
- 相同夹具同时验证引擎、Live、阅读、Markdown 悬停/嵌入共用路径、标签/徽标与文件分类；额外覆盖跨 60 行状态、后片先挂、重挂、原文/行号和 4096/4097 全围栏边界
- `test/browser/codeCardChrome.mjs` 增加四种语言的明暗绘制与徽标色，PHP/GraphQL 跨片绘制及视口回收；真实 VS Code 宿主用例也增加相同四语言样本
- 公开入口以 T01 提交 `0808e529f83c5104698ddece8e8bc310f062906f` 为比较基线：现有 `.tok-*`、卡片类、属性、DOM 关系和主题色不变；仅增加语言 id 和徽标。无新设置、操作或快捷键
- 测试执行与包体成本见[验证记录](../perf/2026-10-special-code-languages.md)。未运行的宿主/全量浏览器验收不得计为通过
