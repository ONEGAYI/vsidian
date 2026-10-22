// #620（V02）Remote SSH 探针 · 空壳占位扩展：1.82.3 的 --extensionTestsPath
// 依赖 --extensionDevelopmentPath 同时存在（缺则静默挂起，仓库既有实测）；
// VSIX 形态轮（B/C）里全部受测扩展经 VSIX 安装，dev path 用本空壳占位，
// 避免同名扩展 dev/VSIX 双份装载造成命令重复注册。探针代码，不定义产品行为。

export function activate(): void {
  /* no-op */
}
