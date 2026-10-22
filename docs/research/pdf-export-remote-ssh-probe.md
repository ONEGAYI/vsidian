# V02 探针结论：Remote SSH 读取到本机生成保存 PDF 的最小闭环可用（跨 ext host 命令路由 + 双 VSIX 分发 + 本机执行端）

调研日期：2026-10-21。状态：[#620](https://github.com/ONEGAYI/vsidian/issues/620)（V02）技术验证交付。探针在真实 Remote SSH 窗口（VSCode 1.82.3 便携宿主 + remote-ssh 0.105.0 + `ssh localhost` OpenSSH Server）中跑通**远端读取 Markdown 与相对图片 → 跨扩展宿主命令 → 本机执行端 Chrome 生成 PDF → 本机落盘**的完整闭环；主套件 11 用例 10 项通过（1 项为探针断言笔误，能力无缺失，见 §3.7），断连轮按判定通过。

复现入口：

```bash
node test/integration/pdfRemoteProbe/build.mjs            # 扩展族/套件/VSIX/fixture
node test/integration/pdfRemoteProbe/runRemoteProbe.mjs   # 轮 A/B/C 全跑
node test/integration/pdfRemoteProbe/runRemoteProbe.mjs --round=B   # 定向单轮
# 前置（首跑准备，全部留痕于 .vscode-test/pdf-remote-probe/）：
#   - remote-ssh 0.105.0 vsix（marketplace 拉取，0.107+ engines ^1.84 不兼容 1.82.3）
#   - VSCode 1.82.3 commit fdb98833 的 server（update.code.visualstudio.com 直连下载，
#     断点续传重试；server 实际由全局 code CLI 通道拉起，见 §2.3）
# 报告：.vscode-test/pdf-remote-probe/pdf-remote-probe-report.json（驱动器聚合）
#       .vscode-test/pdf-remote-probe/run-{a,b,c}-*/（每轮完整日志：宿主输出、
#       remote-ssh 日志、激活标志、artifacts、断连观察）
```

## 1. 总结论

**技术路线可用**。Remote SSH 窗口中，workspace 侧扩展（跑在 vscode-server）经 `vscode.commands.executeCommand` 调用 ui 扩展（跑在本机 ext host）注册的命令是**真实跨 ext host 路由**：对象/大字符串/base64 参数双向序列化可靠（8MB 实测通过），错误按 Error 形态传播，本机执行端用已安装 Chrome 生成 PDF 并经 `vscode.workspace.fs` 落盘本机 `file:` 路径。**分发形态必须是双 VSIX（或等价的双扩展安装）+ extensionKind 声明**——dev 模式与单 VSIX 双扩展均不可行（§4）。

| 验证面 | 结论 | 一句话证据 |
| --- | --- | --- |
| 跨 ext host 命令路由（双向） | **通过** | workspace 扩展 execPath 为 `~/.vscode/cli/servers/.../server/node.exe`（remote），ui 扩展 execPath 为宿主 `Code.exe` + Electron 25.8.1（local）；同一命令链 remote→local→remote 全通 |
| 参数/返回序列化 | **通过** | remote→local echo sha256 逐字节一致：1KB 3ms / 128KB 11ms / 1MB 99ms / 4MB 203ms / 8MB 354ms；返回方向 4MB 完整 |
| 核心闭环（远端读→本机生成→落盘） | **通过** | 端到端 1367ms：Chrome 155 生成 42982B PDF，sha256 远端解码一致，落盘 `file:///d%3A/...artifacts/remote-loop.pdf`，pdfjs 验证 2 页 + 双标记文本 + 中文逐字命中（含 NFKC 归一） |
| 错误传播 | **通过（语义记录）** | Error 实例跨 ext host 保持（instanceof + message + name）；**code 等非标准字段丢失**；未知命令报 `command 'x' not found` |
| 双扩展模型与分发 | **通过（VSIX 形态）** | VSIX 安装后 workspace 扩展自动分发到 server 端 extensions 目录、ui/dual 留本机；dev 模式全部落本机（§4.1） |
| extensionKind 数组语义 | **实测明确** | `["ui","workspace"]` 在 1.82.3 **只激活 ui（本机）端**，无双激活：两端调用 dual.identity 均落 local，激活标志仅 1 条 |
| 本机落盘（file: URI） | **通过** | ui 侧 `workspace.fs` 对 `file:` URI write/stat/read 全通，磁盘字节数与生成一致 |
| showSaveDialog | **部分实测** | 两端调用均成功发起、无用户交互时 pending（对话框已弹出）；**返回路径形态需交互实测，未验证** |
| 远端读取身份 | **通过** | workspace 侧读到 `vscode-remote://ssh-remote+localhost/d%3A%5C...` URI 原样保持；正文/图片以 base64 随命令参数传输不丢字节 |
| 异常与生命周期 | **通过（断连轮）** | 杀 server 后：宿主停重连界面不自退；**本机执行端不受影响，hang 中的任务到期继续完成并落盘**（disconnect-round.pdf 42982B）；远端 await 的回包无处可去（窗口断连） |
| 进度回报 | **可行（轮询方案）** | executeCommand 无进度参数；**轮询查询命令**实测：ui 端任务态命令 + remote 端 120ms 间隔轮询，6 阶段 2107ms 收敛，单次轮询 RTT 1-4ms |

## 2. 环境与准备（含三个实测踩坑）

### 2.1 基本环境

| 项 | 值 |
| --- | --- |
| 宿主（本机窗口） | VSCode 1.82.3 便携宿主（commit `fdb98833154679dbaa7af67a5a29fe19e55c2b73`），独立桌面模式 |
| Remote SSH 扩展 | **ms-vscode-remote.remote-ssh 0.105.0**（engines `^1.82.0-insider`，与 1.82.3 匹配；marketplace `vsextensions` URL 拉取，响应是 **gzip 编码需解压**） |
| 不兼容警示 | 0.107.1 的 engines 是 `^1.84.0-insider`，装不进 1.82.3；版本对齐关系：0.105↔1.82 |
| SSH 通道 | 本机 OpenSSH Server（Windows），`ssh localhost` 免密（BatchMode 验证通过）；`remote.SSH.remotePlatform` 预设绕过首连平台选择 |
| vscode-server | 远端即本机（物理同机，§6.1 边界）；server 经 **code CLI 通道**拉起（§2.3） |
| 浏览器 | Chrome 155.0.8059.85（V01 browserFind 注册表 App Paths 发现），零依赖 CDP 直连（V01 路线 B 模块直接复用） |

### 2.2 踩坑一：remotePlatform 枚举值必须小写

remote-ssh 0.105 归一化代码只认 `"windows"`/`"macOS"`/`"linux"`（小写 w 开头的 windows）；设置里写 `"Windows"`（VSCode 设置 UI 显示值）会被**静默忽略**，首连即弹「Select the platform of the remote host」QuickPick——无头自动化窗口无人应答，`resolveAuthority` 永久 waiting（实测 180s+ 卡死定位）。预设写法：

```json
{ "remote.SSH.remotePlatform": { "localhost": "windows" } }
```

### 2.3 踩坑二：1.82 的 Windows 远端走 code CLI 通道，不是经典 server tarball 安装

remote-ssh 0.105 连 Windows 远端的实际链路：`<installPath>\.vscode-server\code-<commit>.exe`（**unified code CLI**，约 16MB，扩展自动从 update.code.visualstudio.com 下载或可预置）→ CLI 从**全局** `C:\Users\<user>\.vscode\cli\servers\Stable-<commit>\server\` 拉起真正的 server node 进程。从 update 下载的经典 `server-win32-x64` tarball（bin/<commit> 布局）**不是**该通道使用的形态。`remote.SSH.serverInstallPath` 设置有效（探针用它做每轮独立 server 数据目录），但语义是**根目录**（其下自动建 `.vscode-server`），且只重定向数据目录——server **进程二进制**仍在全局 cli/servers（多窗口共享）。

### 2.4 踩坑三：CLI 安装与 Node 24

宿主 CLI（`bin/Code.cmd`）经 node spawn 直调报 `EINVAL`（Node 20.12+ 对 .cmd 的 CVE-2024-27980 收紧）；须 `spawnSync('cmd.exe', ['/c', codeCli, ...])`。VSIX 安装（`--install-extension --force` + 隔离 `--user-data-dir`/`--extensions-dir`）自动拉齐依赖扩展（remote-ssh-edit、remote-explorer）。

## 3. 六大接缝实测矩阵

### 3.1 跨 ext host 命令路由（接缝 1）——通过

- **端判据（铁证）**：`process.execPath` 与 `process.versions.electron`。remote ext host 的 execPath 是 server node 路径、无 electron 版本；local ext host 的 execPath 是宿主 Code.exe、electron 25.8.1。`vscode.env.remoteName` **两端都返回** `'ssh-remote'`（窗口级 authority，1.82.3 值形态且非完整 authority 字符串），不能单独作端判据。
- **路由实测**：suite（local）调 workspace 扩展命令（local→remote）+ workspace 扩展调 ui 命令（remote→local）+ 返回值逐层回传，一条调用链双向全通。
- **序列化**：echo 矩阵（对象/字符串/base64）sha256 双侧一致，1KB→8MB 无大小限制断点（8MB RTT 354ms）；返回方向 4MB 字符串完整（PDF base64 实际产物 43KB×4/3 经同通道返回）。
- **错误传播**：ui 命令 throw 的 Error 跨 ext host 保持 instanceof/message/name；**code 自定义字段丢失**（通道只序列化标准形态）；未知命令 → `Error: command 'x' not found`。
- **在途命令对通道的影响**：长命令挂起时其他命令并行可用（并行执行，不排队）。

### 3.2 双扩展模型与 extensionKind（接缝 2）——结论：双 VSIX

- **dev 模式（--extensionDevelopmentPath 指多目录）不可用于本机执行端验证**：1.82.3 把 dev 扩展（无论 extensionKind 声明）**全部装载本机 ext host**（轮 A 实测：workspace 扩展命令在 remote 端 not found，ui/dual 与 suite 同 ext host 进程）。
- **VSIX 形态是生产语义**：CLI 装入本机 extensions-dir 后连接 remote——ui/dual（kind ui）留本机并激活，workspace（kind workspace）出现在 server 端 extensions 目录并激活。探针以「目录放置 + extensions.json 注册」到独立 serverInstallPath 模拟 marketplace 自动分发（探针扩展不在 marketplace；用户 `~/.vscode-server/extensions` 已有 `onegayi.vsidian-0.11.0` 证明 marketplace 分发通路在真实环境存在且被使用过）。
- **extensionKind 数组语义实测**：`["ui","workspace"]` 无双激活——两端 executeCommand 同名命令都解析到 local 端注册，激活标志仅 local 一条。数组是**偏好顺序**（ui 优先、workspace 兜底），不是双端运行。
- **分发形态结论**（供 T08，详见 §7）：**主 VSIX（workspace）+ 执行端 VSIX（ui）双包**。单 VSIX 双扩展不可行（VSIX 安装单元 = extension/ 目录单 manifest）；单扩展改 kind 为 ui 会把整个 Vsidian 拉到本机端，违背「不为导出把 Vsidian 改成 ui 运行侧」（规格 §3.2）。`workbench.extensions.installExtension` 命令存在且可从远端发起（经 ui 侧 helper 中转，返回值 null 但安装成功——**安装后需 reload 才激活**，实测立即可见=false）。

### 3.3 本机落盘（接缝 3）——通过

- ui 扩展侧 `vscode.workspace.fs.writeFile/stat/readFile` 对 `file:` URI 全通（探针写入 `file:///d%3A/...`，stat 回读 size 一致，read 前 8 字节一致）。
- **showSaveDialog（供 T08 保存链路设计）**：remote 窗口里 local 端与 remote 端调用都成功发起、无用户交互时 pending（对话框已弹出等待用户）；**返回的是本机路径还是远端路径未验证**（需人工交互确认）。架构上 workbench 与原生对话框都在本机侧，倾向本机路径，但报告不据此断言——T08 实现时以交互实测或显式双路径设计（远端文档导出到本机：**默认落本机下载/指定目录 + 可选回传远端**）。

### 3.4 远端读取身份（接缝 4）——通过

- workspace 侧读到的文档 URI 形态实录：`vscode-remote://ssh-remote+localhost/d%3A%5C.zcode%5C...%5Cfixture%5Csample.md`（Windows 路径 `\` 编码为 `%5C`）；正文与图片字节（`workspace.fs.readFile`）→ base64 随命令参数传输，ui 侧 sha256 与远端一致。
- **传输通道就是 executeCommand 参数本身**（base64 over 命令通道），8MB 级实测无压力；PDF 导出典型载荷（文档正文 + 内联图片）远低于此。
- **不得把远端 URI 转成本机 file: 路径**：探针全程保持 vscode-remote URI 字符串原样传递（唯一例外是探针聚合用共享日志文件，见 §6.1 物理同机边界）。
- **环境变量边界（实测）**：宿主 env（`VSIDIAN_*`）在 local ext host 可见、在 server（remote ext host）**不可见**——远端发起方不能靠环境变量传配置，参数要走消息/命令通道。

### 3.5 异常与生命周期（接缝 5）——通过

| 场景 | 实测行为 |
| --- | --- |
| 断连（杀掉探针连接的 sshd 会话进程 = 网络中断语义；不动 sshd 服务本身） | 宿主 20s 检出 socket timeout → 进入重连循环 → 重连失败即**放弃**（`permanent error ... will give up now`）→ 窗口停在断连界面不自退；remote 端在途命令的 await 无终态（回包无处可去）；**本机执行端完全不受影响**：hang 中的 renderPdf 到期继续执行，Chrome 正常生成 PDF 并落盘本机（disconnect-round.pdf 42982B，断连后约 56s 生成）——已接收任务的迟到完成是本机侧行为，产品语义上「断连后本机产物仍在，重连后远端需重新发起/对账」 |
| 迟到回包 | 调用方放弃 await（executeCommand 无取消参数）后 promise 最终仍 resolve，不污染通道；并行命令不受影响 |
| 用户取消 | 无跨端取消原语；**协作式取消实测可行**：取消经第二条命令（cancelTask）送达 ui 侧，浏览器 killSync、临时 user-data-dir 无残留、chrome 进程计数不增 |
| 浏览器/临时目录释放 | 复用 V01 释放纪律（独立临时 user-data-dir + Browser.close + 目录清理），轮 B/C 全程无残留 |
| 未知命令/参数错误 | `command not found` Error 形态明确，可区分「ui 扩展未装/未激活」与「命令签名错误」 |

**断连注入的实现边界（对复现者）**：remote-ssh 0.105 在 Windows 客户端用内建 ssh2 库直连（**无 ssh.exe 子进程**）；sshd 会话内的 server/CLI 进程对本机非提升 WMI 查询**完全不可见**（CommandLine/ExecutablePath 均 null，进程树按 ParentProcessId 可遍历但无属性）——杀 server 进程不可行。可行锚点是**会话进程树的进程名**：探针连接的会话子树必含 1.82.3 专属的 `code-fdb98833*` CLI 进程，按该名字定位连接会话进程并断开（驱动器 `killProbeSshSession`，实测命中 4 个会话进程、断连证据链完整）。

### 3.6 进度回报通道（接缝 6）——轮询方案可行

executeCommand 无进度参数。实测方案：**ui 扩展维护任务注册表 + 查询命令**，remote 端 `withProgress` 内轮询（120ms 间隔）：6 阶段全部捕获、总收敛 2107ms、单次轮询命令 RTT 1-4ms。取消信号与进度同通道（都是普通命令）。T08 可直接采用；`onDidExecuteCommand` 事件无跨端保证，不依赖。

### 3.7 主套件 11 用例结果（轮 B，VSIX 形态）

| 用例 | 结果 |
| --- | --- |
| tests-host-facts | PASS（extensionTestsPath 装载 local ext host；两端 workspaceFolders 均空——见下） |
| remote-identity | PASS（workspace 扩展在 server node 端；vscode-remote URI 保持；宿主 env 隔离） |
| ui-presence-and-routing | PASS（ui 扩展在本机 Electron 端；注册表 kind/激活可见） |
| dual-kind-matrix | PASS（数组 kind 只激活 ui 端） |
| payload-roundtrip | PASS（1KB→8MB + 返回 4MB 全绿） |
| error-propagation | PASS（Error 形态保持、code 丢失实测语义） |
| **core-pdf-loop** | **PASS**（§1 核心闭环数据） |
| local-save-probe | FAIL×1 步——**探针断言笔误**（read 头 8 字节 vs 9 字符前缀），write/stat/dialog 数据全部留证，能力无缺失；断言已修正 |
| progress-channel | PASS |
| late-reply-and-cancel | PASS |
| vsix-install-helper | PASS（installExtension 远端发起成功，激活需 reload） |

**两个 1.82.3 固有事实**（测试与扩展设计都受影响，如实记录）：

1. **`--extensionTestsPath` 装载在本机 ext host**（extensionHostProcess 栈路径 + execPath 实证），且 remote 窗口下 **两端 ext host 的 `workspace.workspaceFolders` 均为空数组**（窗口资源 external URI 虽是 fixture 文件夹）。remote 集成测试须用「本机 suite + 远端扩展命令族中转」结构，fixture 路径经参数构造 vscode-remote URI 传入——探针 suite 即此结构。
2. `--extensionTestsPath` 依赖 `--extensionDevelopmentPath` 同时存在（1.82.3 既有实测，仓库集成测试已知；VSIX 形态轮用空壳扩展占位）。

## 4. 分发方案结论（接缝 2 续）

| 形态 | 可行性 | 依据 |
| --- | --- | --- |
| dev 双目录（--extensionDevelopmentPath×2） | **不可用于产品**：全部扩展落本机 ext host，远端永远收不到 workspace 扩展 | 轮 A 实测 |
| 单 VSIX 双扩展 | **不可行**：VSIX 安装单元 = extension/ 目录单 manifest；VSCode 安装器不扫描子扩展 | VSIX 结构 + 实测安装行为 |
| 主 VSIX（workspace）+ 执行端 VSIX（ui） | **推荐**：与 1.82.3 分发语义完全一致，实测全链路通过 | 轮 B/C |
| 主 VSIX + 内嵌第二 VSIX + `workbench.extensions.installExtension` 自动安装 | **可行补充**：命令实测可用（远端发起、经 ui 侧或首装引导），**安装后需 reload 激活**——首装引导流（「检测到执行端未安装，是否安装？」）需 reload 提示 | vsix-install-helper 实测 |
| 单扩展 `extensionKind: ["ui", "workspace"]` 双激活 | **不可行**：1.82.3 数组语义是偏好顺序，无跨端双激活 | dual 实测 |

**vsce/.vscodeignore 影响**：双 VSIX = 两份 package.json/两个构建产物；主包维持现状（workspace kind），执行端包新增（ui kind、`extensionDependencies` 可声明主包、体积小——CDP 客户端 ~10KB + 命令面）。探针的 VSIX 为手工打包（vsixmanifest + [Content_Types].xml + extension/），vsce 同构。

## 5. 最小协议（T08 可直接采用）

```
远端（主扩展，workspace 侧）                    本机（执行端扩展，ui 侧）
─────────────────────────────                ─────────────────────────────
workspace.fs.readFile(vscode-remote URI)
  -> markdown 正文 + 图片字节（base64）
装配打印 HTML（资源内联 data URL 或
  资源清单随载荷）
executeCommand('exec.renderPdf', {
    doc: { uri: <vscode-remote 原样>, name },
    html, resources: [{ name, base64 }],
    options: { paper, margin, headerFooter, ... },
    save: { dir?: <本机目录提示>, fileName },
    progress: { taskId }
}) ──────────[跨 ext host 路由]───────────>  发现浏览器（V01 三通道）
                                             CDP 生成（V01 spawn 纪律）
                                             whileProgress: 轮询查询命令
                                             workspace.fs.writeFile(file: URI)
<──────── { pdfSha256, pdfBytes, savedTo,
    savedBytesOnDisk, verify? } ──────────   （PDF base64 返回可选——
                                              远端另存用；本机已有产物）
取消：executeCommand('exec.cancelTask', {taskId})
错误：Error(message/name) 跨端保持；code 用 message 编码或错误码前缀
```

## 6. 未验证项（如实记录，不冒充通过）

### 6.1 物理同机的如实性

「远端」物理上是本机 localhost：SSH 传输、vscode-server 进程模型、双 ext host 分离、vscode-remote URI 形态、跨 ext host 命令路由**都是真实架构**（进程与 URI 证据见 §3.1/§3.4）。但以下方面受同机便利影响，**不等价于真实异机环境**：

- 网络延迟/带宽（localhost 回环 vs 真实 SSH 链路）：8MB 354ms 的 RTT 在真实网络会显著增大；载荷设计应以「几 MB 级、一次性传输」为预算而非「尽量大」。
- 探针的激活标志聚合与 fixture 路径共享依赖同一磁盘；真实异机不可用（对产品协议无影响——协议只走命令通道与 workspace.fs）。
- **CentOS 7（用户真实远端）：未验证**。remote-ssh 对 Linux 远端的 server 通道（经典 tarball 安装）、glibc 兼容、`remotePlatform: "linux"` 行为、路径形态（POSIX 路径的 vscode-remote URI 编码）均未实测；探针的 windows 小写枚举坑说明平台分支须逐一实测，不能从 Windows 结论外推。建议 T08 实施时在用户 CentOS 7 环境做一轮真实冒烟（探针脚本可直接复用）。

### 6.2 其余未验证项

1. **showSaveDialog 返回路径形态**：需交互实测（§3.3）。
2. **marketplace 自动分发全链路**：探针用目录放置模拟（探针扩展不在 marketplace）；用户环境已有 onegayi.vsidian-0.11.0 在 server 端证明通路存在，但「执行端 VSIX 发布后用户 zero-config 体验」未端到端跑过。
3. **installExtension 后的 reload 激活流**：命令安装成功但立即查询不可见（需 reload），reload 后激活未实测（探针窗口生命周期短）。
4. **1.82.3 之外的版本矩阵**（含 vscode-server/CLI 通道的版本差异）。
5. **双远端/多窗口并发**：server 进程共享与 extensions.json 竞态未测。
6. **超大文档（几十 MB 正文/图片）**：只测到 8MB 级；更大载荷的内存与序列化上限未探。
7. 断连后**重连成功**的路径：实测只覆盖「重连失败即放弃」（§3.5）；重连成功后远端在途命令是否复活/重发、ext host 状态重建语义未验证。

## 7. 给 T08 的实施指令（下游只读本节即可开工）

**架构**：主扩展（workspace，现有 Vsidian）保持不动；新增执行端扩展 `vsidian-pdf-executor`（ui kind，双 VSIX 分发的第二个包）。远端主扩展负责：读取与固定输入（复用 `documentSession`/阅读样式装配，规格 §3.3 入口表）、装配打印 HTML、调执行端命令、落盘结果记账。本机执行端负责：浏览器发现与 CDP 生成（**整体复用 V01 `test/integration/pdfExportProbe/` 的 browserFind/browser/cdpClient 模块**，收编进执行端包）、本机落盘、任务注册表（进度/取消查询命令）。

**协议**：按 §5 最小协议实现；载荷用 base64 over executeCommand（8MB 实测无碍，正文+内联图片预算内）；来源身份（vscode-remote URI 原样字符串）随载荷传递并在结果记账中回显；PDF 字节**不必**回传远端（本机已有产物），远端另存需求再启用返回通道。

**保存链路**：默认落本机（执行端 `workspace.fs` + `file:` URI；目标目录来自用户设置/上次选择，存执行端 globalState）。showSaveDialog 的返回形态先按「需交互实测」处理：T08 实现时人工验证一轮（预期本机路径——workbench 对话框在本机侧），若实测为远端路径则改「默认本机下载目录 + 设置项自定义」的纯设置流，不依赖对话框。

**进度与取消**：任务注册表 + 轮询查询命令（120-200ms 间隔实测够用）；取消走独立命令触发浏览器 killSync（V01 释放纪律）；`withProgress` 放发起侧（remote）展示。

**错误设计**：跨端只保证 message/name——错误码编进 message 前缀（如 `[ENOENT] ...`），不要依赖 Error.code。

**执行端安装引导（可选增强）**：主扩展激活时检查 `vscode.extensions.getExtension('vsidian.pdf-executor')`，缺失则提示 + `workbench.extensions.installExtension`（VSIX URI 从扩展目录/下载）——**安装后需 reload**，引导文案要含 reload；或 marketplace 双包让 VSCode 的扩展依赖机制处理（`extensionDependencies`）。

**测试基建**：复用本探针的驱动器与轮结构（build.mjs 产 VSIX + runRemoteProbe.mjs 轮 B 形态）；注意 §3.7 两个 1.82.3 固有事实（tests 装载 local、两端 folders 空）。CI 化需先解决：本机 OpenSSH 服务存在性与 serverInstallPath 隔离目录的生命周期（探针已给出全部实现）。

**明确不做**：不把 Vsidian 主扩展改成 ui 运行侧；不在远端生成/保存 PDF；不依赖宿主环境变量向远端传配置；不做单 VSIX 双扩展。

依据：本仓库 `test/integration/pdfRemoteProbe/`（探针源码）、`.vscode-test/pdf-remote-probe/`（全部轮次日志与聚合报告）、[V01 探针报告](pdf-export-browser-probe.md)（浏览器后端与接缝坑）、[ADR-0021](../adr/0021-pdf-export-installed-browser.md)、[pdf-export 规格 §3.2](../specs/pdf-export.md)。
