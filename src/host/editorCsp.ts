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
// 不放宽的面（验收红线）：
// - script-src 维持 nonce 门控——不因字体/样式需求扩大脚本权限，不放
//   https:/unsafe-inline/unsafe-eval；
// - 明文 `http:` 源不放行（样式与字体都只认 https）；
// - 无 connect-src（default-src 'none' 兜底）——webview JS 不经 fetch/XHR
//   拉取远程资源，全部远程装载走浏览器原生管线，CSP 逐源把关。
export function buildEditorCsp(cspSource: string, nonce: string): string {
  return [
    `default-src 'none'`,
    // data: 供 #111 图表弹窗 PNG 光栅化（自有 mermaid SVG 经 data URL
    // 装载到 canvas；位图不可执行，风险面限于解码）；https: 为既有放行
    `img-src ${cspSource} https: data:`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    // 'unsafe-inline' 仅放行样式：CodeMirror 6（style-mod）在运行时向
    // document 注入 <style> 元素承载 baseTheme 与扩展样式，不放行则整个
    // CM6 注入样式表被拒（PR #37 P0 实证）。脚本仍由 nonce 门控。
    // https: 为 #130 远程样式表与 @import（见文件头）。
    `style-src ${cspSource} 'unsafe-inline' https:`,
    // https: 为 #130 远程 @font-face 字体（CORS 由字体服务侧回应，见文件头）
    `font-src ${cspSource} https:`,
  ].join('; ')
}
