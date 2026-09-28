// 图片粘贴 webview 适配层（#161）：paste 事件拦截 image/* 剪贴板项 →
// base64 出站 image.paste（宿主落盘）→ 收 image.paste.result 单事务插入。
//
// 守卫（任一不满足即放行默认粘贴，不吞输入）：
// - IME 组合中（view.compositionStarted）——放行为默认粘贴，组合结束后
//   再粘贴即可（规格交互契约 4）
// - 总开关关 / 无会话（init 前）/ 视图只读或不可编辑
// - live 模式与非暂停由 controller 的 isEnabled 注入（阅读模式不接管，
//   规格交互契约 1；暂停面板不产生新写回链路）
//
// clipboardData 仅事件同步窗口可用：同步取 File 引用（getAsFile 返回的
// File 生命周期独立于事件），preventDefault 亦须同步；base64 读取异步。
// 一次粘贴只处理首个图片项，图片优先于同剪贴板文本（preventDefault 后
// 默认文本粘贴不再发生）。模板：tableEditing 的 copy handler（#12）。
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { WebviewToHost } from '../shared/protocol'

export interface ImagePasteDeps {
  /** 拦截前置守卫：总开关开 + live 模式 + 非暂停（controller 状态注入） */
  isEnabled(): boolean
  /** 当前会话标识；init 前为 null（无出站对象） */
  getSession(): { sessionId: string; docUri: string } | null
  /** 面板内自增 reqId（与 image.paste.result 配对路由） */
  nextReqId(): number
  post(message: WebviewToHost): void
}

/** Uint8Array → base64（分块避免大数组 spread 栈溢出） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** 首个 image/* 剪贴板文件项（kind=file 且 mime 为 image/*；多图取首） */
interface ClipboardImageItem {
  kind: string
  type: string
  getAsFile(): File | null
}

function findImageItem(items: ArrayLike<ClipboardImageItem>): ClipboardImageItem | undefined {
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item
    }
  }
  return undefined
}

/**
 * 结果插入守卫（纯函数，供单测钉住）：与格式操作（runFormatOperation）
 * 同口径——live、非暂停、可编辑。撤销链路即标准 edit.request（一笔撤销）。
 */
export function imagePasteCanInsertAt(state: {
  live: boolean
  suspended: boolean
  editable: boolean
}): boolean {
  return state.live && !state.suspended && state.editable
}

/**
 * 图片粘贴扩展：装配于 live 编辑器（domEventHandlers 无 keymap 顺序语义，
 * paste 与其他 domEventHandlers 互不竞争）。返回值语义照 copy 先例：
 * 命中 preventDefault + true；未命中 false 放行。
 */
export function createImagePaste(deps: ImagePasteDeps): Extension {
  return EditorView.domEventHandlers({
    paste: (event, view) => {
      // IME 组合中放行默认粘贴（不吞输入）
      if (view.compositionStarted) {
        return false
      }
      if (!deps.isEnabled() || view.state.readOnly || !view.state.facet(EditorView.editable)) {
        return false
      }
      const clipboard = event.clipboardData
      if (!clipboard) {
        return false
      }
      const item = findImageItem(clipboard.items as unknown as ArrayLike<ClipboardImageItem>)
      if (!item) {
        return false
      }
      const file = item.getAsFile()
      if (!file) {
        return false
      }
      const mime = item.type
      const fileNameHint = file.name
      // preventDefault 必须在事件同步窗口内（返回后不可再改）；命中即
      // 忽略同剪贴板文本（图片优先，规格已确认决策 3）
      event.preventDefault()
      // base64 读取异步进行（File 引用独立于事件生命周期）
      void file
        .arrayBuffer()
        .then((buffer) => {
          const session = deps.getSession()
          if (!session) {
            return // init 前/已失联：丢弃（不产生孤立出站）
          }
          deps.post({
            kind: 'image.paste',
            sessionId: session.sessionId,
            docUri: session.docUri,
            reqId: deps.nextReqId(),
            mime,
            dataBase64: bytesToBase64(new Uint8Array(buffer)),
            fileNameHint,
          })
        })
        .catch(() => {
          // 读取失败：静默放弃（剪贴板数据不可用时无用户可行动的提示面）
        })
      return true
    },
  })
}
