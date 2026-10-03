import './contextMenuFixture'
import { ToastChannel, type ToastSeverity } from '../../src/webview/toast'
import type { WebviewSyncController } from '../../src/webview/syncController'
const testWindow = window as unknown as { controller: WebviewSyncController; showLocalToast(text: string, severity?: ToastSeverity): void }
testWindow.showLocalToast = (text, severity) => (testWindow.controller as unknown as { toast: ToastChannel }).toast.show(text, severity)
