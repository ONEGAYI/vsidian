# V01 探针结论：已安装浏览器 PDF 后端在最低真实宿主可用（Chrome/Edge 155 + VSCode 1.82.3 + 宿主 Node 18.15）

调研日期：2026-10-21。状态：[#619](https://github.com/ONEGAYI/vsidian/issues/619)（V01）技术验证交付——探针已在 1.82.3 真实宿主（Windows、独立桌面模式、宿主 Node 18.15.0 / Electron 25.8.1）运行并留痕，**10/10 用例、49/49 步全部通过，宿主退出码 0**；自动化证据不等于用户人工验收，Remote SSH 通道归 V02（#620）待验。

复现入口：

```bash
node esbuild.mjs                                                                # 探针三产物（suite/verify/verifyWorker）
VSIDIAN_TEST_VSCODE_PATH=<1.82.3 便携宿主 Code.exe> \
  node test/integration/pdfExportProbe/runProbe.mjs                              # 全量探针
# 报告自动落盘 .vscode-test/pdf-export-probe.log（宿主完整输出 + 退出码）
#           .vscode-test/pdf-export-probe-report.json（测量数据）
#           .vscode-test/pdf-export-probe-run.log（启动器输出）
# 首跑若无可复用宿主会下载 1.82.3（downloadAndUnzipVSCode）；本机网络对
# update.code.visualstudio.com 直连失败时，用主工作树既有缓存
# （.vscode-test/vscode-win32-x64-archive-1.82.3/Code.exe）传入环境变量即可。
# 路线 A 依赖（puppeteer-core@24.43.1 闭包）由 runProbe 自动装入
# .vscode-test/routeA-deps/（npm --prefix 独立目录，不动仓库 package.json）。
```

本文引用的数值均摘自 2026-10-21 16:36 实跑产物（`.vscode-test/pdf-export-probe-report.json`）。

## 1. 总结论

**技术路线可用**：在最低真实宿主内，用已安装 Chrome/Edge 经纯 CDP 直连生成并验证了含中文、样式、图片与异步图形的多页 PDF。推荐后端为**路线 B（纯 CDP 直连，零依赖）**。

| 验证面 | 结论 | 一句话证据 |
| --- | --- | --- |
| 浏览器发现 | **通过** | Chrome 155.0.8059.85 与 Edge 155.0.4283.62 均经注册表 App Paths（HKLM）发现并实测 |
| 路线 B（纯 CDP） | **通过（推荐）** | 零依赖（node:net 手写 RFC6455 文本帧客户端 + flat 协议会话），宿主 Node 18.15.0 内 10 用例全绿 |
| 路线 A（puppeteer-core） | **可用但劣选** | 24.43.1（node>=18 的最后主版本）在宿主 Node 18.15 require/launch/pdf 全通；闭包 52 MB、bundle 3.97 MB、25.x 起要求 node>=22.12 与宿主断代 |
| 最小 PDF（最低宿主） | **通过** | Chrome 与 Edge 各生成 1 页中文 PDF，pdfjs 6.4.299 页数与文本双断言命中 |
| 完整样本 | **通过** | 3 页 111 KB（打印 356ms）：中文标题/多页正文/CSS/file:// 图片/data URL 图片/延迟注入 SVG+文本全部入版；首中末页 PNG 视觉证据落盘 |
| 完成信号 | **通过（固定延迟证伪）** | 同页面三策略对照：loadEventFired 即打印与固定 500ms 均缺延迟内容，组合信号（asyncReady && fonts.status==='loaded' && 全图 complete）拿到全部内容 |
| 排版矩阵 | **通过（一项语义修正）** | 纸张/方向/边距/缩放/页眉页脚页码/printBackground 逐项实测过；preferCSSPageSize:false 时 @page 方向渗透（见 §6，已按实测语义记录） |
| 标题书签 | **通过** | 文本定位（pdfjs 逐页匹配，含部首码位归一）页码 1/2/3 全对；pdf-lib 手写 /Outlines 后 pdfjs getOutline 读回标题与目标页全对 |
| 进程与释放 | **通过** | Browser.close 退出码 0 + 临时 user-data-dir 清理；缺路径 ENOENT、非浏览器 4s 超时、中途 taskkill 悬挂命令立即 reject；既有浏览器进程数前后不变（edge 19→19、chrome 0→0） |
| 产物验证引擎 | **通过** | pdfjs-dist 6.4.299（与生产阅读同源）跑在被测浏览器页面内：页数/逐页文本/大纲/PNG/文本几何/像素采样全链路可用 |

## 2. 证据分层

| 能力 | 静态核验（包/源码） | 1.82.3 真宿主实测 | Remote SSH |
| --- | --- | --- | --- |
| 浏览器发现（App Paths/常见路径/PATH） | — | Chrome/Edge 双双发现，版本与 CDP 回报一致 | 待验（V02） |
| 零依赖 WebSocket + CDP 会话 | cdpClient.ts（~230 行，RFC6455 文本帧 + 掩码 + 分片 + ping/pong） | 握手/命令/事件/数 MB 大帧（printToPDF base64）往返实测 | 同左（通道不同） |
| 最小中文 PDF | — | Chrome 与 Edge 独立实例各一轮 | 待验 |
| 多页/CSS/图片/异步图形 | — | 3 页样本：背景采样 RGB [37,99,235]（#2563eb 精确入版）、LATE-TEXT-MARKER 全文命中 | 待验 |
| 完成信号组合 | — | 三策略对照 + 页面时间线（load 20ms → svg 注入 3233ms → 慢字体就绪 3258ms） | 待验 |
| 排版矩阵 | — | 9 步逐项（§6） | 待验 |
| 书签（定位 + 写入） | pdf-lib 低层 /Outlines API | 定位 3/3、读回 3/3 | 待验 |
| 生命周期与失败分态 | — | 5 步全过（§8） | 待验 |
| puppeteer-core@24.43.1 | npm 元数据（engines node>=18、Apache-2.0、7 个运行时依赖） | require 153ms / launch / page.pdf / 交叉验证 / esbuild bundle 3.97 MB 加载全过 | 待验 |

## 3. 后端选型：推荐路线 B（纯 CDP 直连）

### 3.1 两条路线实测对比

| 维度 | 路线 A：puppeteer-core 24.43.1 | 路线 B：纯 CDP 直连（cdpClient.ts） |
| --- | --- | --- |
| 宿主 Node 18.15 可用性 | 可用（engines node>=18；25.x 起要 node>=22.12.0，**随上游断代**） | 可用（只用 node:net/node:crypto，无 engines 面问题） |
| 依赖面 | 7 个运行时依赖（ws、@puppeteer/browsers、chromium-bidi 等），闭包解压 **52 MB** | **零依赖** |
| bundle 进宿主 CJS 产物 | 可以：esbuild node18/cjs 单文件 **3.97 MB**，宿主内加载成功（顶层 launch 可用） | 探针 bundle 总量主要来自 pdf-lib（书签后处理）与 pdfjs（验证引擎），CDP 客户端本身 ~10 KB |
| 许可 | Apache-2.0 | 自研代码（MIT 仓库内） |
| 版本锁定风险 | 高：主版本断代已发生（24.x 是 node>=18 末代），升级窗口被封死 | 低：CDP 协议（Browser/Target/Page/Runtime 域）是 Chromium 稳定接口，本探针只用十余个方法 |
| 能力面 | 全量高级 API（等待选择器、网络拦截等），对导出场景大部分闲置 | 打印所需方法集完整覆盖（spawn、createTarget、navigate、loadEventFired、evaluate、printToPDF、Browser.close） |
| 结论 | **可用但劣选**：断代 + 依赖面 + 体积 | **推荐**：与本票「不默认下载/捆绑浏览器、最小依赖」的票面约束最贴合 |

### 3.2 路线 A 的保留价值

若产品后续要网络请求拦截、复杂等待语义或 BiDi，puppeteer-core 24.43.1 是已实测的可用退路（精确版本，Apache-2.0，无 `^`）。探针的路线 A 依赖装在 `.vscode-test/routeA-deps/`（独立 npm prefix，不触仓库清单）。

### 3.3 puppeteer 已知差异（实测记录）

- `page.pdf()` 在 puppeteer 22+ 返回 **Uint8Array 而非 Buffer**——`toString('base64')` 会得到垃圾串，必须 `Buffer.from(...)` 显式转换（探针第一轮实错）。

## 4. 版本与环境矩阵

| 项 | 值 |
| --- | --- |
| 宿主 | VSCode 1.82.3 便携宿主（Electron 25.8.1），宿主 Node **18.15.0**（suite 内 `process.versions` 回报） |
| Chrome | 155.0.8059.85（`C:\Program Files\Google\Chrome\Application\chrome.exe`，注册表 App Paths 发现） |
| Edge | 155.0.4283.62（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，注册表 App Paths 发现） |
| headless 标志 | `--headless=new` 与 `--headless` 在 155 上**等价且 stderr 均无 deprecation 警告**（Chrome 129+ 已统一为单一 headless） |
| DevTools 端口 | `--remote-debugging-port=0` 动态分配，stderr「DevTools listening on ws://127.0.0.1:…」提取；`/json/version` HTTP 通道交叉确认 |
| 版本一致性 | CDP `Browser.getVersion` 回报 `Chrome/155.0.8059.85`、`Edg/155.0.4283.62`，与二进制 ProductVersion 逐位一致 |
| 验证引擎 | pdfjs-dist **6.4.299**（生产阅读依赖同源，legacy 主库 + legacy worker 单文件 iife） |

**下界注意**：本探针只实测了 155。旧版 Chrome/Edge（如用户环境常见的 120–130 代）未实测；`--headless=new` 语义在 <129 与 155 不同（旧版存在双 headless 模式），产品实现若需支持下界应按发现到的版本分支选择标志。这是「未验证项」（§9），不是已证能力。

## 5. 完成信号实测（固定延迟证伪）

同一样本页面（延迟注入点 2500ms：慢字体文本 + SVG + 第二张图）三种打印策略对照，全部在同一页面依序执行：

| 策略 | PDF 是否含延迟内容 | 实测依据 |
| --- | --- | --- |
| loadEventFired 即打印 | **缺**（不含 LATE-SLOW-FONT-TEXT） | load 在 20ms 发生，注入点远未到 |
| 固定延迟 500ms | **缺** | 500ms < 2500ms 注入点 |
| 组合信号 | **含**（文本命中，慢字体文本与红色圆 SVG 见 PNG） | 轮询谓词就绪耗时 2513ms |

页面自记时间线（performance.now，ms）：

```
loadEventAt 20 → fontsInitialReadyAt 20.3 → svgInjectedAt 3232.6
→ lateImgCompleteAt 3236.3 → fontsAfterInjectionReadyAt 3258.3
（慢字体：file:///C:/Windows/Fonts/msyh.ttc 经 @font-face 引用，19MB 本地 ttc，
 .slow-font 元素注入后触发加载，fonts.ready 二次就绪点晚于注入点 26ms）
```

**给 T02 的语义结论**：任何固定延迟都存在「大于它的真实注入/加载点」（本样本 2500ms 是构造值，真实场景的网络图片、图形渲染与字体加载不可预知）；组合信号（`window.__probe.asyncReady` 型业务就绪位 && `document.fonts.status === 'loaded'` && 全部 `img.complete && naturalWidth > 0`）在构造样本上收敛于就绪。两个实现细节：

1. `document.fonts.ready` 已 resolve 的 promise 不会因新 pending 字体重挂——注入后要**重新 await** 或轮询 `fonts.status`；初始就绪与二次就绪是两个时间点（20.3ms vs 3258.3ms）。
2. 完成信号必须区分「源资源解析成功」（宿主已解析的图片/资源数据）与「页面实际装载」（complete/naturalWidth）——探针样本两者都验，规格 §3.1 的要求以页面侧状态为准。

## 6. printToPDF 排版能力矩阵（逐项实测）

| 参数 | 实测 | 断言结果 |
| --- | --- | --- |
| paperWidth/Height 8.27×11.69in | 595.92×841.92pt | 通过（期望 595.44×841.68±2，实测偏 0.3–0.5pt 系 Chromium pt 取整） |
| landscape: true | 841.92×595.92pt（宽高互换） | 通过 |
| marginLeft 0.3 vs 1.2in（其余同） | 首行 x 86.35 → 151.6pt，差 65.3pt | 通过（期望 64.8±14；断言基于 pdfjs 文本项 transform 几何） |
| scale 1.0 vs 0.5 | 同文本字高 10.5 → 5.25pt，比值 0.500 | 通过（0.5±0.08） |
| displayHeaderFooter + headerTemplate（中文） | 页眉标记出现在第 1、2 页 | 通过 |
| footerTemplate `<span class="pageNumber">`/`totalPages` | 页 1 提取「第 1 页 / 共 3 页」 | 通过（Chromium 原生替换，无需自算页码） |
| printBackground false/true | 中心采样 RGB [255,255,255] / [37,99,235] | 通过（#2563eb 精确入版） |
| preferCSSPageSize: true（@page A5 landscape） | 594.96×420pt（CSS 尺寸生效） | 通过 |
| preferCSSPageSize: false + A4 + **显式 landscape:false** | 841.92×595.92pt | **语义修正后通过**（见下） |

**@page 方向渗透（本探针重要新发现）**：页面 CSS 声明 `@page { size: A5 landscape }` 时，`preferCSSPageSize:false` 下**纸张两维取 paper 参数，但输出方向仍被 @page 的 landscape 渗透为横版，显式 `landscape:false` 也不能覆盖**（省略与显式 false 输出逐位一致）。含义：

- 模态的方向参数在用户文档含 @page size 声明时**不可达**；
- 产品 T05 的导出装配必须**剥离用户 CSS 的 @page size**（由导出模态的纸张分页样式单独负责，与规格 §2.3「纸张分页样式单独负责页边距、分页和页眉页脚等布局」的既有决策互为印证），除非显式选择 preferCSSPageSize 路线。

页眉页脚另一实现注意：header/footerTemplate 只认 inline 样式，模板字号建议显式（探针用 9px）；displayHeaderFooter 时上下边距要留足（探针 1in）。

## 7. 标题书签：两方案互补，均已实测

Chromium `Page.printToPDF` **不生成 PDF outline**（探针起始产物无书签，实测确认），书签须后处理：

1. **标题→页码定位（实测通过）**：渲染 HTML 时给标题埋 `data-vsidian-heading` 标记，打印后用 pdfjs 逐页 `getTextContent()` 匹配标题文本首个出现页。三标题定位 1/2/3 全对。
   - **必备归一化**：Chromium 产物的 ToUnicode 会把部分中文映射到部首兼容码位——康熙部首区（U+2F00–2FDF，如「文」→U+2F42「⽂」）NFKC 可归一；**CJK 部首补充区（U+2E80–2EFF，如「页」→「⻚」U+2E9A）NFKC 无映射**，需显式对照表（探针内建样本覆盖子集 + 常用 C 简化部首，suite.ts `RADICAL_FIX`；完整表是 T05 实现事项）。
   - 备选方案（未做全量）：CDP `Runtime.evaluate` 测标题 DOM 分页位置换算页码——需要自行建模分页规则，脆弱不推荐；文本匹配方案已足够。
2. **outline 写入（实测通过）**：pdf-lib 1.17.1（现有 devDependency）无高层 outline API，低层手写 /Outlines 树（`PDFHexString.fromText` 中文标题 + `[pageRef /XYZ null null null]` dest + First/Last/Count 链）完全可行；后处理产物经 pdfjs `getOutline()` 读回，3 条中文标题与目标页全对。

## 8. 进程、释放与用户会话

| 场景 | 实测 |
| --- | --- |
| 正常关闭 | `Browser.close` → 进程退出码 0 → 临时 user-data-dir（mkdtemp）删除成功 |
| 缺浏览器路径 | spawn 即 `ENOENT`，错误形态明确（可区分「未安装」与「配置错」） |
| 非浏览器可执行文件（notepad） | 4058ms 内以「等待 DevTools 监听超时」失败（短档 timeout 4s），进程回收无残留 |
| 中途强制取消（taskkill /F /T） | 悬挂中的 `Runtime.evaluate`（awaitPromise）**立即 reject**，连接标记 disconnected，探针不悬挂 |
| 用户会话隔离 | spawn 前后既有进程数不变（msedge 19→19、chrome 0→0，探针实例全部退出） |

**用户会话不受影响的论证**（结构性保证，非概率保证）：探针 spawn 一律显式传独立临时 `--user-data-dir`（mkdtemp）+ `--remote-debugging-port=0`。Chromium 的 profile 数据（会话 cookie、登录态、扩展、单例锁）全部读写该目录；默认 profile（`%LOCALAPPDATA%` 下 User Data）不被触碰。Chromium 的单实例复用机制（新进程 attach 到既有实例）仅在未指定独立 user-data-dir 时发生，独立目录从机制上排除该路径。规格 §2.5「不终止用户原有浏览器会话」由此满足。

## 9. 未验证项（如实记录，不冒充通过）

1. **Remote SSH 到本机**：完全未执行，归 V02（#620）——远端正文/资源到达本机、本机执行端分发与调用是独立验证面。
2. **旧版 Chrome/Edge 下界**：只实测 155。120–154 的 `--headless=new` 语义差异、printToPDF 参数面（preferCSSPageSize 于 108+ 支持）未验证；产品若声明支持旧版需补矩阵。
3. **非 Windows 发现通道**：注册表 App Paths / 常见路径 / PATH 三通道是 Windows 语义；macOS/Linux 的发现（`/Applications`、`which`）未实现未验证。
4. **mermaid/KaTeX 复杂图形端到端**：异步图形用构造 SVG 模拟；真实 mermaid 渲染队列与 KaTeX 字体装载的完成信号接线归 T02（探针的信号谓词可复用，但未在真实图形上跑过）。
5. **puppeteer-core 完整 API 面**：只测了 launch/newPage/setContent/pdf/close；等待语义、网络拦截等产品外能力未测。
6. **千页级长文档与批量内存压力**：归 T04/T06 的性能验证；本探针最大样本 3 页 111KB。
7. **探针发现的两个浏览器侧坑**（opaque origin 下 Worker 不可用、printToPDF 后后台 target 光栅化挂起，见 §10）只在 155 实测；下界版本是否同型未验证。

## 10. 探针实测发现的接缝坑（对 T01/T02/T05/T07 直接生效）

以下都是探针开发过程中**实际踩中并修复**的坑，产品实现绕不开：

1. **opaque origin 下 Blob 不能承载 Worker**：about:blank / data: URL 页面（opaque origin）里 `URL.createObjectURL(blob)` 的 URL 无法 `new Worker`——PDF.js 回退 fake worker 后失败（`Cannot read properties of undefined (reading 'setup')`）。凡是要在浏览器页面里跑 Worker 的链路（本探针的 pdf.js 验证引擎、T07 的预览如走浏览器侧），页面必须有 http(s) origin——探针方案是宿主起仅绑 127.0.0.1 随机端口的微型资源服务（pdfVerify.ts）。
2. **printToPDF 之后非前台 target 的 canvas 光栅化被挂起**：打印完成后，后台 target 里的渲染类操作（pdf.js render → toDataURL）**await 永不完成**（文本提取不受影响）——实测卡死宿主 12 分钟直到超时。任何「打印后又在同浏览器别的 target 做渲染」的链路，渲染前必须 `Page.bringToFront`；且**一次性前台化不够**（printToPDF 会把被打印 target 顶回前台），每次渲染前都要前台化（探针在 `PdfVerifier.verify` 每次调用前执行）。
3. **CDP 命令必须带超时**：光栅化挂起类故障表现为「永不返回」，无超时保护的命令会拖死整个导出任务。探针对 printToPDF（90s）与 Runtime.evaluate（60s）加了 `withTimeout` 显式报错。
4. **Chromium ToUnicode 的部首兼容码位**：文本提取/书签定位的中文匹配必须过「NFKC + CJK 部首补充区对照表」双归一（§7）。
5. **@page 方向渗透**（§6）：导出装配剥离用户 @page size，否则模态方向参数不可达。
6. **puppeteer `page.pdf()` 返回 Uint8Array**（§3.3）。
7. **Runtime.evaluate 的 exceptionDetails 不在 result 里**：页面函数抛错时 `result.value` 为 undefined 且无报错——必须显式检查 `exceptionDetails` 字段并透传（探针第一轮全部 verify 结果为 undefined 的根因）。

## 11. 给 T01 的实施指令（下游只读本节即可开工）

**推荐后端**：路线 B，纯 CDP 直连。直接移植探针模块 `test/integration/pdfExportProbe/cdpClient.ts`（MiniWebSocket + CdpConnection/CdpSession，零依赖）与 `browser.ts`（launchHeadlessBrowser/createPageSession/navigateAndWaitLoad/printToPdf/evaluate/withTimeout）。生产接线建议收编进 `src/host/`（如 `src/host/pdfExport/`），语义不变。

**浏览器发现**：移植 `browserFind.ts` 的三通道（注册表 App Paths → 常见路径 → PATH），版本读取用 PowerShell `VersionInfo`（GUI 程序 `--version` 不落控制台）。本机实测形态：HKLM `App Paths\chrome.exe/msedge.exe` 的 `(default)` 即完整路径。缺浏览器时的提示按规格 §2.5（提示配置 Chrome/Edge，不自动下载）。

**依赖与版本**：
- **零新增生产依赖**（路线 B）；`pdf-lib@1.17.1` 若 T05 需要书签后处理，从 devDependency 转正为精确版本生产依赖（探针已实测其低层 /Outlines 可行）。
- 若最终选路线 A（不推荐）：精确版本 `puppeteer-core@24.43.1`（Apache-2.0，engines node>=18 末代；25.x 要 node>=22.12 不可用），esbuild node18/cjs bundle 3.97 MB 可行，`page.pdf()` 返回值必须 `Buffer.from()` 包一层。

**spawn 纪律**（探针实测参数，直接复用）：

```
<browser> --headless=new --remote-debugging-port=0 --user-data-dir=<mkdtemp 临时目录>
  --no-first-run --no-default-browser-check --disable-extensions
  --disable-background-networking --disable-component-update --disable-sync
  --disable-features=Translate about:blank
```

- 动态端口从 stderr「DevTools listening on ws://…」提取（`browser.ts` 的 `DEVTOOLS_LINE` 正则）；
- 每次导出独立临时 user-data-dir，结束 `Browser.close` → 等退出 → 删目录（探针 close() 全链路实测）；
- 页面会话用 flat 协议：`Target.createTarget` + `Target.attachToTarget({flatten:true})`；
- 导航等待先订阅 `Page.loadEventFired` 再 `Page.navigate`（事件不丢）。

**完成信号方案**（T01 先埋基础位，T02 扩全量）：页面注入就绪位（业务异步完成置 `window.__probe.asyncReady` 类标记）+ `document.fonts.status === 'loaded'`（注意已 resolve 的 fonts.ready 不会重挂，轮询 status 或注入后重新 await）+ 全部 `img.complete && naturalWidth > 0`，三条件与（探针 `waitForCompositeReady` 轮询实现）。**禁止固定延迟**（§5 已证伪）。

**打印参数**：`Page.printToPDF`，`printBackground: true` 为默认（阅读样式背景需要）；纸张/方向/边距/缩放/页眉页脚矩阵直接查 §6；**导出装配必须剥离用户 @page size**（§6 渗透发现）；footerTemplate 页码用原生 `<span class="pageNumber">`/`<span class="totalPages">`。

**超时与取消**：所有 CDP 命令包 `withTimeout`（探针：evaluate 60s、printToPDF 90s）；用户取消走 `taskkill /F /T /PID` 等价探针路径（proc.kill('SIGKILL') + killSync 清目录），悬挂命令会立即 reject 不悬挂任务（实测）。

**如果同浏览器做二次渲染**（T07 预览若在打印浏览器内）：渲染前 `Page.bringToFront`，且每次渲染前都要（§10.2）；预览推荐继续走 webview 的 pdfRender.ts（现有 PDF.js 阅读），无此坑。

**产物验证/测试接线**：探针的 verify 引擎（verifyEntry/verifyWorker + 宿主 http 资源服务）可作为 T 票集成测试的断言基建复用；断言中文文本前过 NFKC + 部首对照（§10.4）。

**明确不做**：不下载/捆绑浏览器；不提升 Playwright 1.62.1（node>=20）为生产依赖；探针不动 package.json/package-lock.json（路线 A 闭包在 .vscode-test/routeA-deps，复现由 runProbe 自动准备）。

依据：本仓库 `test/integration/pdfExportProbe/`（探针源码与全部实测数据）、`.vscode-test/pdf-export-probe-report.json`（2026-10-21 16:36 实跑）、[ADR-0021](../adr/0021-pdf-export-installed-browser.md)（浏览器依赖与运行侧决策）、[pdf-export 规格 §3.1](../specs/pdf-export.md)。
