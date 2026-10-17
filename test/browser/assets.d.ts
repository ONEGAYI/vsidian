// 浏览器测试夹具的静态资产类型声明（esbuild dataurl/file loader 的运行时
// 形态——tsc 类型检查面）
declare module '*.woff2' {
  const url: string
  export default url
}
