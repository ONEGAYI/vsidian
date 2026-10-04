// 编辑器 webview 的 CSP 装配纯逻辑（#130 抽出为可单测模块；此前内联在
// textEditorProvider.buildWebviewHtml）。不依赖 vscode/DOM——期望字符串由
// test/unit/editorCsp.test.ts 词法钉住，真实宿主内的生效（拦截与放行）由
// 集成测试验证（#37 教训：CSP 层断言必须落真实 webview 宿主）。
//
// #130 变更（HTTPS 样式导入与联网字体）：
// - style-src 追加 `https:`——片段内 `@import url(https://…)` 与远程样式
//   表 `<link>` 可加载。浏览器对跨源样式表不做 CORS 要求（加载不因跨源被
//   拒），但 cssRules 跨源不可读——装载器三态分流已有 opaque 分支承接。
// - font-src 追加 `https:`——`@font-face{src:url(https://…)}`。注意字体
//   是 CORS 强制资源（CSS Fonts 规范）：远程字体服务须回 Access-Control-
//   Allow-Origin（Google Fonts 等主流服务已带）；这是浏览器标准行为，
//   本扩展不做宿主代理绕过。
// - 远程样式表内的相对字体 URL 由浏览器按「该远程 CSS 的 URL」解析锚定
//   （与本地片段的相对路径同一浏览器语义，无需扩展参与）。
//
// #239 变更（jieba wasm 按需加载）：
// - connect-src 追加 `${cspSource}`——jieba-wasm 浏览器产物的 init(url)
//   内部经 fetch 拉取 wasm（宿主已下载到 globalStorage 并 sha256 校验，经
//   asWebviewUri 转入本资源域）。只放行 webview 自有资源域，不开
//   https:/http: 外网——「CSP 不开外网」红线维持（下载在宿主侧 Node fetch
//   执行，不经 webview）。
// - script-src 追加 `'wasm-unsafe-eval'`（#241 评审修复）——jieba 的加载
//   链路是动态 import 产物 + `WebAssembly.instantiate`，Chromium 在 CSP
//   无 wasm-unsafe-eval/unsafe-eval 时直接拒绝 wasm 编译（资源下载与
//   校验全正常、实例化必抛、恒回退 Intl.Segmenter）。该项只放行
//   WebAssembly 编译/实例化，不放行 JS eval，也不改变脚本装载的 nonce
//   门控；官方 webview 指南允许按需为 wasm 放开此源表达式。
//
// #343 变更（外链原网页 iframe）：
// - frame-src 追加 `https:`——悬停浮层 page 形态以跨源沙箱 iframe 装载
//   远程站点（sandbox 只给 allow-scripts，见 src/webview/webPage.ts 模块
//   头的隔离边界）。只放行 https 源表达式：HTTP 最终地址在宿主预检层已
//   判 reason=http 退回卡片（安全上下文中的混合内容无法安全内嵌），
//   生产路径不会也不得挂 http iframe。iframe 子文档自身的资源装载由
//   目标站点响应自带的 CSP 管辖（父文档 CSP 不作用于子文档），故本指令
//   只约束「iframe 能导航到哪」，不扩大父文档的 script/connect 面。
//
// 不放宽的面（验收红线）：
// - script-src 维持 nonce 门控——不因字体/样式需求扩大脚本权限，不放
//   https:/unsafe-inline/unsafe-eval（'wasm-unsafe-eval' 是 #239 jieba
//   wasm 实例化的最小必要放行，仅覆盖 WebAssembly，见文件头）；
// - 明文 `http:` 源不放行（样式与字体都只认 https；frame-src 同口径）；
// - connect-src 仅 cspSource（自有资源域）——除 jieba wasm 的装载外，
//   webview JS 不经 fetch/XHR 拉取任何远程资源，其余远程装载走浏览器
//   原生管线，CSP 逐源把关。
export function buildEditorCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    // data: 供 #111 图表弹窗 PNG 光栅化（自有 mermaid SVG 经 data URL
    // 装载到 canvas；位图不可执行，风险面限于解码）；https: 为既有放行
    `img-src ${cspSource} https: data:`,
    `script-src ${cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    // 'unsafe-inline' 仅放行样式：CodeMirror 6（style-mod）在运行时向
    // document 注入 <style> 元素承载 baseTheme 与扩展样式，不放行则整个
    // CM6 注入样式表被拒（PR #37 P0 实证）。脚本仍由 nonce 门控。
    // https: 为 #130 远程样式表与 @import（见文件头）。
    `style-src ${cspSource} 'unsafe-inline' https:`,
    // https: 为 #130 远程 @font-face 字体（CORS 由字体服务侧回应，见文件头）
    `font-src ${cspSource} https:`,
    // #239 jieba wasm：init(url) 的 fetch 只指向 cspSource 资源域
    `connect-src ${cspSource}`,
    // #343 外链原网页 iframe：只放行 https 源（见文件头 #343 变更说明）
    `frame-src https:`,
  ].join('; ')
}
