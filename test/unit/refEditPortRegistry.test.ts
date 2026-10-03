// P2-13（#290）目标编辑端口注册表的「曾成功写入」记账契约：父标签关闭
// 交接的目标集合 = 关闭时活跃端口（含在途写回）∪ 该面板 edit.ack(ok) 过
// 的目标。记账弥补端口释放（离屏回收 / 切 Reading）后活跃集合丢失曾编辑
// 目标的缺口——ADR-0010「引用编辑涉及且仍有未保存修改的 B」的宿主簿记面。
// 生命周期：随面板销毁（releasePanel）整体清账；单个端口释放（releasePort，
// 离屏回收路径）不清——曾编辑事实与端口在场是两个概念。
import { describe, expect, it } from 'vitest'
import { isRefEditClientMessage, RefEditPortRegistry, type RefEditBinding } from '../../src/host/refEditPorts'

const PANEL_A = { panelSessionId: 'panel-1', panelDocUri: 'file:///d%3A/notes/a.md' }
const TARGET_B = 'file:///d%3A/notes/b.md'
const TARGET_C = 'file:///d%3A/notes/c.md'

function bindingOf(portId: string, targetUri: string, panel = PANEL_A): RefEditBinding {
  return {
    portId,
    targetUri,
    fsPath: `D:\\notes\\${targetUri.slice(targetUri.lastIndexOf('/') + 1)}`,
    virtualSessionId: `virtual-${portId}`,
    occurrence: `0::![[x]]`,
    lastDirty: undefined,
    ...panel,
  }
}

function registryWithTwoTargets(): RefEditPortRegistry {
  const registry = new RefEditPortRegistry()
  registry.register(bindingOf(registry.allocate(), TARGET_B))
  registry.register(bindingOf(registry.allocate(), TARGET_C))
  return registry
}

describe('P2-13 noteEditAck：面板级「曾成功写入」记账', () => {
  it('登记后 panelEditTargets 返回该面板写入过的目标集合（去重）', () => {
    const registry = new RefEditPortRegistry()
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_B)
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_B) // 重复登记去重
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_C)
    expect(new Set(registry.panelEditTargets(PANEL_A.panelSessionId, PANEL_A.panelDocUri)))
      .toEqual(new Set([TARGET_B, TARGET_C]))
  })

  it('不同面板的记账互不串扰（同目标被两个 A 编辑各自记）', () => {
    const registry = new RefEditPortRegistry()
    const panelB = { panelSessionId: 'panel-9', panelDocUri: 'file:///d%3A/notes/other.md' }
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_B)
    registry.noteEditAck(panelB.panelSessionId, panelB.panelDocUri, TARGET_B)
    expect(registry.panelEditTargets(PANEL_A.panelSessionId, PANEL_A.panelDocUri)).toEqual([TARGET_B])
    expect(registry.panelEditTargets(panelB.panelSessionId, panelB.panelDocUri)).toEqual([TARGET_B])
    // 未登记面板查询为空
    expect(registry.panelEditTargets('panel-none', 'file:///d%3A/notes/none.md')).toEqual([])
  })

  it('releasePanel（面板销毁）整体清账；releasePort（单端口释放）不清', () => {
    const registry = registryWithTwoTargets()
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_B)

    // 单端口释放（离屏回收 / 切 Reading）：曾编辑事实保留——交接判定仍覆盖
    const stale = registry.findOccurrence(PANEL_A.panelSessionId, PANEL_A.panelDocUri, '0::![[x]]')!
    registry.release(stale.portId)
    expect(registry.panelEditTargets(PANEL_A.panelSessionId, PANEL_A.panelDocUri)).toEqual([TARGET_B])

    // 面板销毁：清账
    registry.releasePanel(PANEL_A.panelSessionId, PANEL_A.panelDocUri)
    expect(registry.panelEditTargets(PANEL_A.panelSessionId, PANEL_A.panelDocUri)).toEqual([])
  })

  it('releasePanel 只清本面板记账（另一面板的记账保留）', () => {
    const registry = new RefEditPortRegistry()
    const panelB = { panelSessionId: 'panel-9', panelDocUri: 'file:///d%3A/notes/other.md' }
    registry.noteEditAck(PANEL_A.panelSessionId, PANEL_A.panelDocUri, TARGET_B)
    registry.noteEditAck(panelB.panelSessionId, panelB.panelDocUri, TARGET_C)
    registry.releasePanel(PANEL_A.panelSessionId, PANEL_A.panelDocUri)
    expect(registry.panelEditTargets(panelB.panelSessionId, panelB.panelDocUri)).toEqual([TARGET_C])
  })
})

describe('isRefEditClientMessage：refEdit.message 内消息白名单', () => {
  it('P2-14 codeblock.copy 放行（嵌入内代码卡复制经端口走宿主剪贴板）', () => {
    expect(isRefEditClientMessage({
      kind: 'codeblock.copy', sessionId: 'panel-9', docUri: TARGET_B, text: 'x\n',
    })).toBe(true)
  })

  it('编辑通道与资源消息照旧放行（既有回归）', () => {
    expect(isRefEditClientMessage({ kind: 'history.request', op: 'undo' })).toBe(true)
    expect(isRefEditClientMessage({ kind: 'sync.request' })).toBe(true)
    expect(isRefEditClientMessage({
      kind: 'refresh.request', sessionId: 'panel-9', docUri: TARGET_B, reqId: 1,
    })).toBe(true)
  })

  it('面板级消息仍拒绝（settings/view 族不走目标端口）', () => {
    expect(isRefEditClientMessage({ kind: 'view.switch.request', target: 'reading' })).toBe(false)
    expect(isRefEditClientMessage({ kind: 'settings.open' })).toBe(false)
  })
})
