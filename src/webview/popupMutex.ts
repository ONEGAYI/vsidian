// 弹窗互斥协调（工单 #212）：图表弹窗（#111）与图片弹窗（#212）是两个
// 平行单例模块，规格要求同时只允许一个弹窗实例。互斥在此去中心化协调——
// 各弹窗打开时 claim（先关掉在场的另一个），关闭时 release。避免两个弹窗
// 模块互相 import 对方的 close 造成循环依赖。
type PopupCloser = () => void

let current: PopupCloser | null = null

/** 占用弹窗位：在场的其他弹窗先被关闭，随后登记自己 */
export function claimPopup(closer: PopupCloser): void {
  if (current !== null && current !== closer) {
    current()
  }
  current = closer
}

/** 释放弹窗位：仅当在场者是自己（关闭自身路径；别人的 claim 已先行接管） */
export function releasePopup(closer: PopupCloser): void {
  if (current === closer) {
    current = null
  }
}
