# P3-02 PDF 引擎兼容性探针结论：PDF.js 锁定候选、真实绘制与包体红线（VSCode 1.82.3）

调研日期：2026-10-04。状态：[#334](https://github.com/ONEGAYI/vsidian/issues/334)（P3-02）研究交付——探针已在 1.82.3 真实宿主（Windows、独立桌面模式）运行并留痕；自动化证据不等于用户人工验收，Remote SSH 与 wasm 增强通道按第 8 节单列待验。

复现入口：`node test/integration/pdfProbe/runProbe.mjs`（真宿主探针，报告自动落盘 `.vscode-test/pdf-probe.log` 与 `.vscode-test/pdf-probe-report.json`）；`node test/integration/pdfProbe/genSamples.mjs <目录>`（样本矩阵生成）；`node test/integration/pdfProbe/vsixProbe.mjs`（VSIX 体积核算）。本文引用的数值均摘自 2026-10-04 实跑产物。

## 1. 总结论

**技术路线可用，包体红线击穿**。二者共同构成对 P3-05 的裁决输入：

| 验证面 | 结论 | 一句话证据 |
| --- | --- | --- |
| 引擎锁定 | **pdfjs-dist 6.4.299（精确版本，Apache-2.0），legacy 主库 + legacy worker** | 主库与 worker 出自同一 npm 包同一版本；许可为 Apache-2.0，附带 Foxit/Liberation/OpenJPEG/QCMS 分许可随包文件 |
| 下界真实绘制 | **通过**（需双 polyfill） | 1.82.3 真宿主 webview 内 5 类样本 canvas 实际绘制（非白像素比例 0.007–1.0），PDF.js 版本回报 `6.4.299` |
| 官方支持范围 | **超出**（自担风险点） | 官方 FAQ 声明 legacy 下界 Chrome 125+；1.82.3 为 Electron 25 / Chromium 114，低 11 个大版本，靠 polyfill 补齐（第 3 节） |
| worker 装配 | **通过** | blob 单文件 worker（esbuild iife）在 `worker-src blob:` 下创建、渲染、终止全链路实测（第 4 节） |
| CSP 增量 | **最小必要新增仅一条：`worker-src blob:`** | 生产 CSP 原样时 `new Worker(blob:)` 抛 `SecurityError`（必要性证明）；追加后全矩阵通过 |
| 文本提取（P3-07 预留） | **通过**（依赖第二枚 polyfill） | `getTextContent()` 在内嵌中文、CMap 中文、西文样本上命中预期文本；Chromium 114 缺 `ReadableStream` async iteration，不注入则文本层完全不可用 |
| 失败分态 | **通过** | 损坏/非 PDF → `InvalidPDFException`；加密 → `PasswordException`（正确区分，不静默） |
| 生命周期 | **通过** | 最后消费者释放后 worker 计数 13/13、blob 计数 2/2 归零；销毁后迟到 `getPage` 被拒 |
| VSIX 包体 | **红线击穿（硬冲突）** | 「资产本地随包」口径下解压总量 10.78 MB，超现有失败线 9.5 MB 约 1.28 MB（第 6 节）；需用户决策，探针无权也不曾上调阈值 |
| 宿主零渲染 | **通过** | 宿主侧 suite 产物 12 KB 且不含任何 PDF.js 代码；全部绘制证据来自 webview 回报的 canvas 像素 |

**给 #337（P3-05）的裁决表述**：绘制、文本、取消、并发、释放、失败分态的技术路线全部实测成立，但**在包体决策落地前 P3-05 维持阻塞**——规格要求「现有总包及单文件硬阈值内通过；不能擅自提高阈值或兼容下界」，而按当前规格的「资产本地随包」口径无法满足（第 6.3 节给出三个待用户取舍的方案）。

## 2. 证据分层

| 能力 | 静态核验（包/源码） | 真宿主实测（1.82.3） | Remote SSH |
| --- | --- | --- | --- |
| 版本一致性（核心=worker） | 同包 `legacy/build/pdf.mjs` 与 `legacy/build/pdf.worker.mjs` | 运行时回报 `pdfjsVersion: "6.4.299"` | 同左（不涉及） |
| blob worker CSP | 指南允许 data:/blob:，未给 worker-src 细则 | 变体 A 被拒（SecurityError）、变体 B 通过（echo pong） | 待验 |
| canvas 绘制（含中文/CMap/扫描页） | — | 5 样本非白像素比例 > 0 | 待验 |
| 文本提取 | — | 三类样本命中预期文本；扫描页如实为空 | 待验 |
| 按页取消 | — | `RenderingCancelledException` + 取消后第 3 页仍可渲染 | 待验 |
| 并发装载与计数归零 | — | 3 文档 = 3 worker，destroy 后增量归零；全程 13/13、2/2 | 待验 |
| 失败分态 | — | InvalidPDF / PasswordException 各归其位 | 待验 |
| wasm 通道（JP2/JBIG2/ICC） | 包结构核验（wasm/ 与 iccs/ 目录） | **未触发**（无样本，见 8.2） | 待验 |
| VSIX 体积 | 两次真实 vsce 打包核算 | — | 同左 |

## 3. 版本锁定与下界差距

### 3.1 锁定候选

**pdfjs-dist@6.4.299**（2026-10-03 发布，npm 精确版本安装，无 `^`）。主库取 `legacy/build/pdf.mjs`、worker 取 `legacy/build/pdf.worker.mjs`——同一包产物，版本天然一致。许可 Apache-2.0；其 standard_fonts / wasm 资产附带 Foxit、Liberation、OpenJPEG、QCMS、JBIG2 分许可文件，随包路径下已核对存在（`node_modules/pdfjs-dist/wasm/LICENSE*`、`standard_fonts/LICENSE_*`）。

不选 modern 产物的依据：modern `pdf.mjs` 直接调用 `Promise.try`（Chromium 128+）且无任何 polyfill，下界宿主必然崩；legacy 产物内嵌 core-js 36 个模块（`es.promise.try`、iterator helpers、Set methods、Uint8Array base64/hex 等），面更宽。

### 3.2 与 Chromium 114 的差距（本探针的核心技术发现）

1.82.3 = Electron 25.x = **Chromium 114**。对 6.4.299 legacy 产物做 API 特征扫描与真宿主实测后，差距收敛为**恰好两枚**，均以 esbuild banner 注入（存在性检测，主线程与 worker 全局作用域独立、两侧同注）：

| 缺口 API | 宿主所需版本 | 缺它时的实际后果 | polyfill |
| --- | --- | --- | --- |
| `Promise.withResolvers` | Chromium 119+ | 主库与 worker 顶层即抛 `ReferenceError`，探针首轮复现（语法无关） | 4 行，MDN 官方形态 |
| `ReadableStream.prototype[Symbol.asyncIterator]` | Chromium 124+ | `getTextContent()` 抛 `TypeError: readableStream is not async iterable`——**文本层完全不可用**（探针第二轮实测复现） | 8 行 async generator 包装 `getReader()` 循环 |

已排除的疑似缺口：`Float16Array` 在产物中仅作特性检测（`typeof Float16Array !== "undefined"`），114 下安全返回 false；`Object.groupBy`/`Array.fromAsync` 未被使用；语法面经 esbuild `target: chrome114` 转译。**quickjs-eval.wasm 仅被 sandbox 产物（`pdf.sandbox.mjs`，PDF JavaScript 执行引擎）引用，worker 产物零引用**——不随包即天然拒绝 PDF JS，与规格一致。

### 3.3 「超出官方支持范围」的定性

[官方 FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions) 现行声明 legacy 支持 **Chrome 125+**。本路线在 125 之下运行，属于**经实测验证的自担风险**：上游后续 6.x 补丁版若引入新的 125+ API，可能再现「缺一枚 polyfill」型回归。缓解手段（P3-05 若采纳本路线应一并落实）：

- 升级 pdfjs-dist 时必须重跑本探针（`runProbe.mjs` 即回归门禁，11 用例含两枚 polyfill 的失效检测——`worker-csp-probe` 与全部文本提取用例会直接暴露）；
- 锁版本策略沿用仓库「精确版本 + lockfile」现状，不经主动升级不会漂移。

若用户不接受该风险，替代路线是锁定 4.x/5.x 旧版（其 legacy 下界覆盖 114），代价是脱离上游安全修复——**本探针未对旧版本做同等实测，不宣称其可用**。

## 4. 装配路线（生产候选形态）

### 4.1 worker：单文件 blob 装配

```
esbuild: workerEntry.ts（import legacy pdf.worker.mjs）
  -> iife 单文件（bundle、无 import/importScripts——官方指南要求）
  -> VSIX 静态资产 out/webview/pdfWorker.js
  -> webview 首次使用时 fetch 该资源文本（connect-src: cspSource 放行）
  -> Blob -> URL.createObjectURL -> GlobalWorkerOptions.workerSrc
  -> PDF.js 内部 new Worker(url, { type: "module" })（iife 在 module 语义下照常执行）
```

实测行为：blob URL 与 webview location 同 origin（`_isSameOrigin` 判定通过，不走 CDN wrapper 分支）；每文档一个 worker，`loadingTask.destroy()` 后由 PDF.js 终止。**失败装载也持有 worker**——探针曾实测 created 13 / terminated 6，根因是失败路径未 `destroy()`；补上后 13/13 归零。这是 P3-05 必须遵守的接线纪律（`getDocument` reject 的 catch 里也要 destroy）。

### 4.2 CSP：最小新增一条

生产 `buildEditorCsp`（`src/host/editorCsp.ts`）之上**仅追加 `worker-src blob:`**：

- **必要性**：变体 A（生产 CSP 原样）实测 `new Worker(blob:)` 抛 `SecurityError: Failed to construct 'Worker'`——`worker-src` 缺省回落 `script-src`，而 nonce 门控的 script-src 不放行 blob:。
- **充分性**：变体 B 全矩阵通过。已放行面无需再动——`connect-src ${cspSource}`（#239 jieba 先例）覆盖 worker 文本 fetch、cMap/字体/ICC 装载；`'wasm-unsafe-eval'`（script-src，#241）覆盖 wasm 编译；worker 继承 owner 文档 CSP，cMap 装载实测可达。
- **未引入**：外网 script、JS unsafe-eval、假 worker 主线程兜底（探针全程真 worker，`workersCreated > 0` 与渲染成功互为印证）。

### 4.3 资源通道

cmaps / standard_fonts / wasm / iccs 经 `asWebviewUri` 目录 URI + 尾斜杠拼装（PDF.js 内部拼 `${url}${name}`，`asWebviewUri().toString()` 无尾斜杠须补），四个 `getDocument` 参数：`cMapUrl`（配 `cMapPacked: true`）、`standardFontDataUrl`、`wasmUrl`、`iccUrl`。PDF 源字节同样经资源 URI fetch（`fetch -> arrayBuffer -> getDocument({data})`）。**`data` 的底层 buffer 会被 transfer 给 worker**——源字节须在传入前记录（探针实测 transfer 后主线程 `byteLength` 归零）。

另有一个 API 形态记录：6.x 的 `page.render()` 以 `{ canvas, viewport }` 为主参（`canvasContext` 降为兼容参数），P3-07 接线按此写。

## 5. 实测费用初值（供 P3-05–07 锁参）

样本与数值均见 `.vscode-test/pdf-probe-report.json`（探针每次运行覆写）：

| 维度 | 实测值 |
| --- | --- |
| 源文件字节 | 709 B（西文）– 312,397 B（扫描页）；装载耗时 38–44 ms（小样本，含 fetch + worker 启动） |
| 页 canvas 费用 | scale 1.5 → 892×1263×4 ≈ **4.31 MiB/页**；scale 2 → 1190×1684×4 ≈ **7.64 MiB/页** |
| 渲染耗时 | 11–42 ms/页（scale 1.5–2，样本为单页轻内容） |
| 并发装载 | 3 文档并发 = 3 worker 并行，全部渲染成功；destroy 后 worker 增量归零 |
| worker 生命周期 | 全程 created 13 / terminated 13；blob URL created 2 / revoked 2（探针收尾统一 revoke） |
| 按页取消 | 发起即取消 → `RenderingCancelledException`；后续页不受影响 |

注意两点口径：其一，探针为取证保留全部 canvas（10 块共 46.3 MiB），生产按「仅可见页 + 有限相邻页」回收，不应以探针总量外推；其二，以上为单页轻样本初值，千页级长文档与内存压力未在本票范围（归 P3-06/P3-12 压测）。

## 6. VSIX 包体核算（红线冲突）

### 6.1 实测数字

两次真实 `vsce package --no-dependencies`（`vsixProbe.mjs`，资产注入为临时操作、跑完清理，仓库无残留）：

| 口径 | 解压总量 | vsix 文件 | 红线判定（warn 8.5 / max 9.5 MB） |
| --- | --- | --- | --- |
| 基线（当前 main 产物） | 6.77 MB | 2.22 MB | 总量线内 |
| PDF 装配（生产候选布局） | **10.78 MB** | 4.41 MB | **超失败线 1.28 MB** |

注入构成 4.00 MB：`out/webview/pdfWorker.js` 1226 KB + `pdfMain.js` 480 KB（minified）、cmaps 全量 1387 KB、standard_fonts 820 KB（含 4 个 LiberationSans `.ttf`）、wasm 451 KB（已裁剪 quickjs 与 nowasm fallback）、iccs 20 KB。单文件最大项 pdfWorker.js 1226 KB，距单文件警告线 3 MB 余量充足。

### 6.2 登记冲突（生产接线清单，非本票修改）

PDF 版打包相对基线新增 11 条检查 errors，全部是**预期中的登记缺口**而非探针缺陷：

- `out/webview/pdfMain.js`、`out/webview/pdfWorker.js` 未在 `REQUIRED_EXTENSION` 登记（out/ 白名单拦截，预期行为）；
- 4 个 `media/pdfjs/standard_fonts/LiberationSans*.ttf` 触发 `FORBIDDEN_PATTERNS` 的 `.ttf` 禁止模式——该模式语义是「KaTeX 字体裁剪失效信号」，与 pdfjs 字体是两回事，且 **PDF.js 内建了字体文件名、不可改名或转格式**，唯一出路是给 `media/pdfjs/` 加白名单例外。

另有一个**与本票无关的 main 现状缺口**顺带暴露：基线打包已有 4 个未登记产物（`light/dark-pointerLink.svg`、`light/dark-dbLink.svg`，上次发布后新增批次的资产未同步 `REQUIRED_QUICK_ACTION_SVGS`），建议在相应批次票补登记。

### 6.3 冲突的三个出路（需用户决策，探针不代选）

1. **上调阈值**：失败线 9.5 → ~11.5 MB（警告线同步）。守住的是「防意外塞大文件」语义，但改变了已发布包体的既有承诺；
2. **裁剪资产**：cmaps 从全量收缩到 CJK Unicode 映射族等常用子集——估算最多省约 0.7 MB，总量仍约 10.1 MB，**单靠裁剪到不了 9.5 MB 线内**（standard_fonts 与 wasm 已是最小必要集）；
3. **资产改为宿主按需下载**（#239 jieba wasm 先例：宿主 Node fetch + sha256 校验 + globalStorage）：VSIX 只随 pdfMain/pdfWorker（+1.7 MB → 总量约 8.47 MB，贴警告线下）——但这与规格「PDF 主库、worker 与必要资产本地随包」直接冲突，且引入首用联网与校验链路，**属规格修订级决策**。

在用户裁决前，P3-05 的「包体红线内通过」验收项无法成立——这是本探针对依赖链的唯一保留。

## 7. 宿主零渲染与 Node 18 边界

探针架构上 PDF 解析、渲染、文本提取全部发生在 webview（主线程 + blob worker）；宿主侧只做文件 URI 装配与消息收发。证据：宿主 suite 产物 `out/test/integration/pdfProbe/suite.js` 仅 12 KB 且不含任何 PDF.js 特征码（grep 零命中）；全部绘制证据为 webview 回报的 canvas 像素采样。Node 18 宿主进程无需也未曾执行 PDF 代码——`pdfjs-dist@6.4.299` 的 `engines.node >= 22` 声明只约束 Node 侧使用，与 webview 路线无关。

## 8. 未验证项（如实记录，不冒充通过）

### 8.1 Remote SSH（票据允许单列待验）

未实际执行。通道分析（无实测背书）：全部资源（worker 文本、cmap、字体、wasm、icc、PDF 源）走 `asWebviewUri` 的 vscode-cdn 资源域，remote 形态由宿主 webview 服务转发；blob worker 在 webview 进程本地构造，不经网络。风险点集中在 worker 内 `fetchSync`（ICC 装载用同步 XHR）在 remote 转发链路上的行为，以及 remote 下资源往返延迟对按页装载节奏的影响。待 P3-05 或 P3-12 在真 Remote SSH 环境复跑 `runProbe.mjs`。

### 8.2 wasm 增强通道（JP2 / JBIG2 / ICC）

openjpeg（JPEG2000）、jbig2、qcms（ICC 色彩管理）三个 wasm 均未触发——样本矩阵用 FlateDecode 位图，构造 JP2/JBIG2 编码样本超出本票最小绘制探针范围。基础阅读门禁（canvas 绘制、文本提取、CMap、标准字体）不依赖它们；且 wasm 失败时 PDF.js 有 nowasm 回退路径（未随包，属待验降级面）。遗留到需要这些格式的真实样本时再验。

### 8.3 其他

- 1.86 上界复测未跑（engines `^1.82.3` 的另一端）；polyfill 为存在性检测，更高 Chromium 下自动跳过，设计上安全，但按口径仍列待验；
- 千页长文档、大内存 PDF、图片密集型的压力行为（P3-06/P3-12）；
- 用户人工观感（字体渲染质量、滚动流畅度）按人工验证清单口径另列。

## 9. 样本矩阵与生成方式

八样本全部由脚本生成（`genSamples.mjs`，node:zlib + 手写 PDF 语法 + 手写 RC4 40-bit R2 加密器 + pdf-lib/fontkit 生成内嵌中文字体样本），**不引入二进制样本入库**；写出到临时工作区，随探针运行临时生成、用后清理：

| 样本 | 覆盖 | 实测结果 |
| --- | --- | --- |
| zh-embedded.pdf | 内嵌 TrueType 子集（SimHei），2 页 | 绘制 + 文本提取命中 |
| zh-cmap.pdf | 非内嵌 Type0/STSong-Light/UniGB-UCS2-H | CMap 装载 + 绘制 + 文本提取命中 |
| latin-standard.pdf | 非内嵌 Helvetica | standard_fonts 装载 + 绘制 |
| scanned.pdf | 纯图扫描页（Flate RGB 位图） | 绘制（非白比例 1.0）+ 文本如实为空 |
| multipage.pdf | 5 页文本 | 翻页/取消/并发载体 |
| corrupt.pdf / garbage.pdf | 截断 / 非 PDF 字节 | InvalidPDFException |
| encrypted.pdf | RC4 40-bit R2 | PasswordException（正确分态） |

## 10. 探针资产的去留与复现

探针代码位于 `test/integration/pdfProbe/`（`.vscodeignore` 已排除 test/，不进 VSIX）：`genSamples.mjs`、`suite.ts`、`webviewMain.ts`、`workerEntry.ts`、`workerPatches.ts`、`runProbe.mjs`、`vsixProbe.mjs`。`esbuild.mjs` 的 dev-only 段新增三个构建 target（suite / main / worker，browser 侧 `target: chrome114`——比生产 webviewBase 的 chrome118 更保守；生产 target 是否调整归 P3-05 决策）。

依赖去留建议：`pdfjs-dist` 若用户确认本路线则转正为生产依赖（版本精确锁定）；`pdf-lib` 与 `@pdf-lib/fontkit` 仅为样本生成服务，建议保留为 devDependency（探针复现链路的一部分），不进生产。

复现顺序（各命令首跑即落盘日志与退出码）：

```bash
npm ci                                                        # .vscode-test/npm-ci.log
node esbuild.mjs                                              # 探针三产物（dev 构建）
node test/integration/pdfProbe/runProbe.mjs                   # .vscode-test/pdf-probe.log + pdf-probe-report.json
node test/integration/pdfProbe/vsixProbe.mjs                  # .vscode-test/pdf-vsix-probe.log + pdf-vsix-probe.json
```

依据：[PDF.js 官方 FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)（legacy 支持声明）、[Webview Worker 官方指南](https://code.visualstudio.com/api/extension-guides/webview#using-web-workers)（blob/data 装配与单文件要求）、以及本仓库 `src/host/editorCsp.ts`、`scripts/release.mjs`、`test/integration/testHost.mjs` 的既有实现。
