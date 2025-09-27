import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WriteProjectRequest {
  appId: string
  manifest: string
  code: string
  workspaceJson: string
}

export interface WriteProjectResult {
  basePath: string
  projectPath: string
  files: { application: string; code: string; workspace: string }
  overwritten: boolean
}

export interface ProjectInfo {
  id: string
  name: string
  path: string
  manifestPath: string
  hasCode: boolean
  fileCount: number
  sizeBytes: number
  mtimeMs: number
  createdMs: number
  manifestTitle?: string
  error?: string
}

export interface ReadProjectResult {
  id: string
  projectPath: string
  manifest?: string
  code?: string
  workspaceJson?: string
  error?: string
}

function getBaseProjectsDir(): string {
  // Assumption: store in user's Documents for visibility (cross-platform path via app.getPath('documents')).
  const docs = app.getPath('documents')
  return join(docs, 'KiisuBlocks-Projects')
}

export function ensureBaseDir(): string {
  const base = getBaseProjectsDir()
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  return base
}

export function writeProject(req: WriteProjectRequest): WriteProjectResult {
  const base = ensureBaseDir()
  const projectDir = join(base, req.appId)
  const existed = existsSync(projectDir)
  if (!existed) mkdirSync(projectDir, { recursive: true })

  const appManifestPath = join(projectDir, 'application.fam')
  const codePath = join(projectDir, 'app.c')
  const workspacePath = join(projectDir, 'project.json')

  writeFileSync(appManifestPath, req.manifest, 'utf-8')
  writeFileSync(codePath, req.code, 'utf-8')
  writeFileSync(workspacePath, req.workspaceJson, 'utf-8')

  return {
    basePath: base,
    projectPath: projectDir,
    files: { application: appManifestPath, code: codePath, workspace: workspacePath },
    overwritten: existed,
  }
}

export function listProjects(): { basePath: string; projects: ProjectInfo[] } {
  const base = ensureBaseDir()
  const entries = readdirSync(base, { withFileTypes: true })
  const projects: ProjectInfo[] = []
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue
    const projectDir = join(base, dirent.name)
    const manifestPath = join(projectDir, 'application.fam')
    if (!existsSync(manifestPath)) continue // skip non-project directories
    try {
      const st = statSync(projectDir)
      // gather file stats recursively (shallow: top-level only for speed)
      let fileCount = 0
      let sizeBytes = 0
      const stack: string[] = [projectDir]
      while (stack.length) {
        const current = stack.pop()!
        const ds = readdirSync(current, { withFileTypes: true })
        for (const d of ds) {
          const full = join(current, d.name)
            try {
              const fst = statSync(full)
              if (d.isDirectory()) {
                stack.push(full)
              } else {
                fileCount++
                sizeBytes += fst.size
              }
            } catch { /* ignore individual file errors */ }
        }
      }
      let manifestTitle: string | undefined
      try {
        const manifestRaw = readFileSync(manifestPath, 'utf-8')
        // very small heuristic: title line like 'App(<name>)' or 'name: xyz'
        const titleMatch = /name\s*[:=]\s*"?([A-Za-z0-9_\- ]+)"?/i.exec(manifestRaw) || /App\(([^)]+)\)/i.exec(manifestRaw)
        if (titleMatch) manifestTitle = titleMatch[1].trim()
      } catch { /* ignore manifest parse errors */ }
      projects.push({
        id: dirent.name,
        name: manifestTitle || dirent.name,
        path: projectDir,
        manifestPath,
        hasCode: existsSync(join(projectDir, 'app.c')),
        fileCount,
        sizeBytes,
        mtimeMs: st.mtimeMs,
        createdMs: st.ctimeMs,
        manifestTitle,
      })
    } catch (e) {
      projects.push({
        id: dirent.name,
        name: dirent.name,
        path: projectDir,
        manifestPath,
        hasCode: false,
        fileCount: 0,
        sizeBytes: 0,
        mtimeMs: 0,
        createdMs: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  // sort by modified desc
  projects.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { basePath: base, projects }
}

export function readProject(id: string): ReadProjectResult {
  const base = ensureBaseDir()
  const projectDir = join(base, id)
  if (!existsSync(projectDir)) return { id, projectPath: projectDir, error: 'Project not found' }
  try {
    const manifestPath = join(projectDir, 'application.fam')
    const codePath = join(projectDir, 'app.c')
    const workspacePath = join(projectDir, 'project.json')
    const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : undefined
    const code = existsSync(codePath) ? readFileSync(codePath, 'utf-8') : undefined
    const workspaceJson = existsSync(workspacePath) ? readFileSync(workspacePath, 'utf-8') : undefined
    return { id, projectPath: projectDir, manifest, code, workspaceJson }
  } catch (e) {
    return { id, projectPath: projectDir, error: e instanceof Error ? e.message : String(e) }
  }
}
