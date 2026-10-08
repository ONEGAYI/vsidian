// V02 验证票（#349）：故障注入测试组件——工厂同步抛出可归因异常，
// 验证装载器按「factory-error」完整释放（不留半初始化注册）。
import { defineAddonPage } from 'vsidian-addon-sdk'

defineAddonPage('onegayi.vsidian-throw-addon', () => {
  throw new Error('vsa2-throw-addon: intentional factory fault')
})
