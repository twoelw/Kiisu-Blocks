// Centralized project import logic so UI buttons can reuse it later.
// Provides an event-based API to broadcast imported workspace data.

export interface ImportedProjectData {
  id: string
  projectPath: string
  manifest?: string
  code?: string
  workspaceJson?: string
}

const listeners = new Set<(p: ImportedProjectData) => void>()
let lastImported: ImportedProjectData | null = null

export function onProjectImported(cb: (p: ImportedProjectData) => void) {
  listeners.add(cb)
  // Immediately replay the last imported project (if any) so late subscribers still load it
  if (lastImported) {
    try { cb(lastImported) } catch { /* ignore */ }
  }
  return () => listeners.delete(cb)
}

// Allow other features (e.g., manual workspace JSON import) to override the cached
// last imported workspace so that remounting the editor doesn't revert to an older project.
export function overrideLastImportedWorkspace(workspaceJson: string) {
  if (lastImported) {
    lastImported = { ...lastImported, workspaceJson }
  } else {
    lastImported = { id: 'manual', projectPath: '', workspaceJson }
  }
}

export async function importProject(id: string): Promise<ImportedProjectData | { error: string }> {
  if (!window.projects?.read) return { error: 'projects.read API unavailable' }
  try {
  console.debug('[importProject] reading project', id)
    const res = await window.projects.read(id)
    if (res.error || !res.id) return { error: res.error || 'Unknown error' }
    const data: ImportedProjectData = {
      id: res.id,
      projectPath: res.projectPath || '',
      manifest: res.manifest,
      code: res.code,
      workspaceJson: res.workspaceJson,
    }
    // Broadcast
    lastImported = data
  if (listeners.size === 0) {
      console.debug('[importProject] no listeners yet – queued for later')
    }
  for (const l of [...listeners]) {
      try { l(data) } catch { /* isolate listener errors */ }
    }
  console.debug('[importProject] broadcast complete', id)
    return data
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Window typing augmentation
// Note: Window.projects with 'read' already declared in other ambient declarations.
