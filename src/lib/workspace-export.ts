import * as Blockly from 'blockly'
import { repairSerialization } from './serialization-repair'

interface SerializedWorkspaceState {
  blocks?: { blocks?: unknown[] }
  variables?: unknown[]
  // Allow unknown extra properties without using any
  [key: string]: unknown
}

let currentWorkspace: Blockly.WorkspaceSvg | null = null
let lastSerializedState: SerializedWorkspaceState | null = null

export function registerWorkspace(ws: Blockly.WorkspaceSvg | null) {
  currentWorkspace = ws
  if (ws) {
    try {
      const state = Blockly.serialization.workspaces.save(ws) as SerializedWorkspaceState
      if (state && state.blocks) {
        lastSerializedState = state
      }
    } catch { /* ignore */ }
  }
}

export function getWorkspace(): Blockly.WorkspaceSvg | null {
  return currentWorkspace
}

export function exportWorkspaceXml(pretty = true): string {
  if (!currentWorkspace) return '<xml></xml>'
  const dom = Blockly.Xml.workspaceToDom(currentWorkspace, true)
  return Blockly.Xml.domToPrettyText(dom)
}

function isMeaningful(state: SerializedWorkspaceState | null): boolean {
  if (!state) return false
  const blocks = state.blocks
  if (!blocks) return false
  if (Array.isArray(blocks.blocks) && blocks.blocks.length > 0) return true
  if (state.variables && Array.isArray(state.variables) && state.variables.length > 0) return true
  return false
}

export function exportWorkspaceJson(): string {
  let state: SerializedWorkspaceState | null = null

  if (currentWorkspace) {
    try {
      state = Blockly.serialization.workspaces.save(currentWorkspace) as SerializedWorkspaceState
      if (isMeaningful(state)) {
        lastSerializedState = state
        return JSON.stringify(state, null, 2)
      }
    } catch { /* ignore */ }
  }

  if (!state && isMeaningful(lastSerializedState)) {
    return JSON.stringify(lastSerializedState, null, 2)
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('kiisu.blocks.workspace')
      if (saved) {
        const parsed = JSON.parse(saved) as SerializedWorkspaceState
        if (isMeaningful(parsed)) {
          lastSerializedState = parsed
          return JSON.stringify(parsed, null, 2)
        }
      }
    }
  } catch { /* ignore */ }

  return JSON.stringify({ blocks: {} }, null, 2)
}

/**
 * Load (or queue) a workspace serialization JSON.
 * If the Blockly workspace isn't mounted yet, we queue the raw JSON in localStorage so the
 * next BlocklyWorkspace mount will consume it (similar to pending demo logic).
 */
export function loadWorkspaceFromJson(raw: string): { ok: boolean; queued?: boolean; error?: string } {
  // Fast validation first (always parse so we can queue only valid JSON)
  let parsed: SerializedWorkspaceState
  try {
    parsed = JSON.parse(raw) as SerializedWorkspaceState
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Invalid structure' }
  }

  // If workspace not ready yet -> queue it
  if (!currentWorkspace) {
    try {
      localStorage.setItem('kiisu.blocks.pendingWorkspace', JSON.stringify({ raw, ts: Date.now() }))
      // Also remember as last serialized so exportWorkspaceJson() can still surface it
      lastSerializedState = parsed
    } catch { /* ignore */ }
    return { ok: true, queued: true }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ser = (Blockly as any).serialization
    if (!ser?.workspaces?.load) {
      return { ok: false, error: 'Serialization API unavailable' }
    }
    try {
      ser.workspaces.load(parsed, currentWorkspace)
    } catch {
      // Attempt repair once
      const repaired = repairSerialization(parsed as unknown as Record<string, unknown>, currentWorkspace)
      ser.workspaces.load(repaired, currentWorkspace)
    }
    lastSerializedState = parsed
    try { localStorage.setItem('kiisu.blocks.workspace', JSON.stringify(parsed)) } catch { /* ignore */ }
    // Clear any previously queued pending workspace now that we've loaded
    try { localStorage.removeItem('kiisu.blocks.pendingWorkspace') } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('kiisu.blocks.generate'))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
