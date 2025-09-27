import { app, dialog } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Persistent editable install & shared toolchain home for uFBT.
// Layout default (under Documents/KiisuBlocks-Projects):
//  .ufbt_env/  -> Python venv (editable install of ufbt)
//  .ufbt_home/ -> UFBT_HOME (SDK/toolchain cache)
//
// Windows storage strategy:
//  We now ALWAYS place the uFBT Python editable venv + UFBT_HOME (toolchain cache)
//  inside %LOCALAPPDATA%/KiisuBlocks/ufbt to avoid issues with OneDrive or other
//  synced / redirected Documents folders (permission errors, file locking, long
//  path sync delays). Project files remain under Documents/KiisuBlocks-Projects
//  for user discoverability. On macOS/Linux we keep everything under Documents
//  (standard user expectation) unless future issues arise.
//  This code returns the chosen env/home directories; downstream only relies on
//  UFBT_HOME so no consumer changes required.

function resolveUfbtBaseDirs() {
  const projectsBase = getProjectsBase() // existing location for user projects
  if (process.platform === 'win32') {
    // Electron does not expose 'localAppData' as a key; derive via ENV or userData parent.
    const localAppData = process.env.LOCALAPPDATA || join(app.getPath('appData'), '..', 'Local')
    const localBase = join(localAppData, 'KiisuBlocks', 'ufbt')
    return {
      projectsBase,
      envDir: join(localBase, '.ufbt_env'),
      homeDir: join(localBase, '.ufbt_home'),
      fallback: true,
      reason: 'using %LOCALAPPDATA% for uFBT on Windows'
    }
  }
  // macOS & Linux: keep under Documents with the projects
  return {
    projectsBase,
    envDir: join(projectsBase, '.ufbt_env'),
    homeDir: join(projectsBase, '.ufbt_home'),
    fallback: false,
    reason: ''
  }
}

export interface EnsureEnvResult { ready: boolean; created: boolean; envDir: string; homeDir: string; python: string; error?: string }

function getProjectsBase(): string {
  // Mirror logic in projectManager.ensureBaseDir (keep in sync if changed there)
  const docs = app.getPath('documents')
  return join(docs, 'KiisuBlocks-Projects')
}

function pythonCandidates(): string[] {
  const c: string[] = []
  if (process.env.KIISU_PYTHON) c.push(process.env.KIISU_PYTHON)
  if (process.env.PYTHON) c.push(process.env.PYTHON)
  if (process.platform === 'win32') c.push('py -3')
  c.push('python3', 'python')
  return c
}

import { execSync } from 'node:child_process'
function resolveSystemPython(): string | null {
  for (const cand of pythonCandidates()) {
    try {
      // Use --version to validate; for 'py -3' we run a command shell style.
      execSync(`${cand} --version`, { stdio: 'ignore' })
      return cand
    } catch { /* ignore */ }
  }
  return null
}

function envPythonPath(envDir: string): string {
  return process.platform === 'win32' ? join(envDir, 'Scripts', 'python.exe') : join(envDir, 'bin', 'python')
}

export async function ensureUfbtEnv(): Promise<EnsureEnvResult> {
  try {
  const { projectsBase, envDir, homeDir, fallback, reason } = resolveUfbtBaseDirs()
  if (!existsSync(projectsBase)) mkdirSync(projectsBase, { recursive: true })
    const marker = join(envDir, '.installed')
    let created = false

    if (!existsSync(envDir)) {
      // Show a one-time informational warning before starting the potentially long first-time install,
      // unless explicitly skipped via env flag (packaged automation or tests could set KIISU_SKIP_UFBT_WARNING=1).
      if (!process.env.KIISU_SKIP_UFBT_WARNING) {
        try {
          dialog.showMessageBoxSync({
            type: 'info',
            buttons: ['OK'],
            defaultId: 0,
            title: 'Installing uFBT (one-time setup)',
            message: 'Setting up the Flipper build tool (uFBT)...',
            detail: `Kiisu Blocks needs to download and prepare the uFBT Python environment and SDK/toolchain. This can take several minutes the very first time depending on your internet speed and hardware. Additional command windows may appear and the app UI might seem frozen temporarily. This is normal and only happens once; future compilations will be much faster.`
          })
        } catch { /* non-fatal */ }
      }
      const sysPy = resolveSystemPython()
      if (!sysPy) return { ready: false, created: false, envDir, homeDir, python: '', error: 'No system Python (>=3.8) found' }
      mkdirSync(envDir, { recursive: true })
      // create venv
      execSync(`${sysPy} -m venv "${envDir}"`, { stdio: 'inherit' })
      created = true
    }
    const py = envPythonPath(envDir)
    if (!existsSync(py)) return { ready: false, created, envDir, homeDir, python: '', error: 'Venv python missing' }

    if (fallback) {
      // Lightweight log file to help diagnose path decisions
      try {
        const noteFile = join(envDir, '..', 'PATH_DECISION.txt')
        if (!existsSync(noteFile)) {
          writeFileSync(noteFile, `uFBT directories placed here (${new Date().toISOString()})\nReason: ${reason}\nEnvDir: ${envDir}\nHomeDir: ${homeDir}\n`, 'utf-8')
        }
      } catch { /* non-fatal */ }
    }

    // If marker missing OR ufbt not importable, (re)install
    const needsInstall = !existsSync(marker) || (() => {
      try {
        execSync(`"${py}" -c "import ufbt,sys;print(getattr(ufbt,'__version__','unknown'))"`, { stdio: 'ignore' })
        return false
      } catch { return true }
    })()

    if (needsInstall) {
      try {
        execSync(`"${py}" -m pip install --upgrade pip`, { stdio: 'inherit' })
        // Install latest ufbt from PyPI (optionally allow pin via env KIISU_UFBT_VERSION)
        const pin = process.env.KIISU_UFBT_VERSION ? `==${process.env.KIISU_UFBT_VERSION}` : ''
        execSync(`"${py}" -m pip install --upgrade ufbt${pin}`, { stdio: 'inherit' })
        // Record installed version in marker for future diagnostics
        try {
          const ver = execSync(`"${py}" -c "import ufbt,sys;print(getattr(ufbt,'__version__','unknown'))"`, { stdio: 'pipe' }).toString().trim()
          writeFileSync(marker, `${new Date().toISOString()}\nufbt_version=${ver}\n`, 'utf-8')
        } catch {
          writeFileSync(marker, new Date().toISOString(), 'utf-8')
        }
      } catch (e) {
        return { ready: false, created, envDir, homeDir, python: py, error: 'Failed to install or import ufbt: ' + (e instanceof Error ? e.message : String(e)) }
      }
    }
  if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true })
    return { ready: true, created, envDir, homeDir, python: py }
  } catch (e) {
    return { ready: false, created: false, envDir: '', homeDir: '', python: '', error: e instanceof Error ? e.message : String(e) }
  }
}

// Lightweight probe that reports whether an install will be needed, without performing it.
// Used by the renderer to warn the user before the potentially long first-time install.
export async function probeUfbtEnv(): Promise<{
  envDir: string; homeDir: string; exists: boolean; needsInstall: boolean; pythonFound: boolean; error?: string
}> {
  try {
    const { projectsBase, envDir, homeDir } = resolveUfbtBaseDirs()
    if (!existsSync(projectsBase)) mkdirSync(projectsBase, { recursive: true })
    const py = envPythonPath(envDir)
    const marker = join(envDir, '.installed')
    const exists = existsSync(envDir) && existsSync(py)
    let pythonFound = false
    let needsInstall = true
    if (exists) {
      pythonFound = true
      // Replicate importability check
      try {
        execSync(`"${py}" -c "import ufbt,sys;print(getattr(ufbt,'__version__','unknown'))"`, { stdio: 'ignore' })
        needsInstall = !existsSync(marker) // if import works but marker missing we still treat as needsInstall to create marker
      } catch {
        needsInstall = true
      }
    } else {
      // If env does not exist, we still want to know if a system python is present so we can proceed after confirmation
      pythonFound = resolveSystemPython() != null
      needsInstall = true
    }
    if (!pythonFound) {
      return { envDir, homeDir, exists, needsInstall: true, pythonFound, error: 'No Python interpreter found for uFBT installation.' }
    }
    return { envDir, homeDir, exists, needsInstall, pythonFound }
  } catch (e) {
    return { envDir: '', homeDir: '', exists: false, needsInstall: true, pythonFound: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Build management
interface ActiveBuild { id: string; proc: ChildProcessWithoutNullStreams; started: number; projectPath: string }
const activeBuilds = new Map<string, ActiveBuild>()

export interface StartBuildResult { id: string; started: boolean; error?: string }

export async function startBuild(projectPath: string): Promise<StartBuildResult> {
  if (!projectPath) return { id: '', started: false, error: 'projectPath required' }
  // single build at a time for now
  if (activeBuilds.size > 0) return { id: '', started: false, error: 'Another build is already running' }
  const ensure = await ensureUfbtEnv()
  if (!ensure.ready) return { id: '', started: false, error: ensure.error || 'uFBT env not ready' }
  const appManifest = join(projectPath, 'application.fam')
  if (!existsSync(appManifest)) return { id: '', started: false, error: 'application.fam not found in project' }

  const id = randomUUID()
  const env = { ...process.env, UFBT_HOME: ensure.homeDir }
  const proc = spawn(ensure.python, ['-m', 'ufbt'], { cwd: projectPath, env })
  const record: ActiveBuild = { id, proc, started: Date.now(), projectPath }
  activeBuilds.set(id, record)
  wireStreaming(record)
  return { id, started: true }
}

// Build & Launch (uses 'ufbt launch' which builds if needed, then launches via USB)
export async function startBuildAndLaunch(projectPath: string): Promise<StartBuildResult> {
  if (!projectPath) return { id: '', started: false, error: 'projectPath required' }
  if (activeBuilds.size > 0) return { id: '', started: false, error: 'Another build is already running' }
  const ensure = await ensureUfbtEnv()
  if (!ensure.ready) return { id: '', started: false, error: ensure.error || 'uFBT env not ready' }
  const appManifest = join(projectPath, 'application.fam')
  if (!existsSync(appManifest)) return { id: '', started: false, error: 'application.fam not found in project' }

  const id = randomUUID()
  const env = { ...process.env, UFBT_HOME: ensure.homeDir }
  const proc = spawn(ensure.python, ['-m', 'ufbt', 'launch'], { cwd: projectPath, env })
  const record: ActiveBuild = { id, proc, started: Date.now(), projectPath }
  activeBuilds.set(id, record)
  wireStreaming(record)
  return { id, started: true }
}

export function cancelBuild(id: string): { id: string; cancelled: boolean; error?: string } {
  const rec = activeBuilds.get(id)
  if (!rec) return { id, cancelled: false, error: 'Not found' }
  try {
    rec.proc.kill()
    return { id, cancelled: true }
  } catch (e) {
    return { id, cancelled: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function listFaps(projectPath: string): string[] {
  const dist = join(projectPath, 'dist')
  if (!existsSync(dist)) return []
  try {
    return readdirSync(dist).filter(f => f.toLowerCase().endsWith('.fap')).map(f => join(dist, f))
  } catch { return [] }
}

import { BrowserWindow, ipcMain, shell } from 'electron'
function wireStreaming(build: ActiveBuild) {
  const win = BrowserWindow.getAllWindows()[0]
  const send = (ch: string, payload: Record<string, unknown>) => win?.webContents.send(ch, payload)

  const pushLines = (data: Buffer, stream: 'stdout' | 'stderr') => {
    const text = data.toString('utf-8')
    text.split(/\r?\n/).forEach(line => {
      if (!line) return
      send('ufbt:compile:output', { id: build.id, stream, line, ts: Date.now() })
    })
  }
  build.proc.stdout.on('data', d => pushLines(d, 'stdout'))
  build.proc.stderr.on('data', d => pushLines(d, 'stderr'))
  build.proc.on('error', err => {
    send('ufbt:compile:output', { id: build.id, stream: 'stderr', line: '[spawn error] ' + err.message, ts: Date.now() })
  })
  build.proc.on('close', (code) => {
    const success = code === 0
    const faps = listFaps(build.projectPath)
    send('ufbt:compile:done', { id: build.id, success, code, durationMs: Date.now() - build.started, faps })
    activeBuilds.delete(build.id)
  })
}

// IPC registration helper (called from main.ts)
export function registerUfbtIpc(ipc: typeof ipcMain) {
  ipc.handle('ufbt:ensureEnv', async () => ensureUfbtEnv())
  ipc.handle('ufbt:probeEnv', async () => probeUfbtEnv())
  ipc.handle('ufbt:compile:start', async (_e, projectPath: string) => startBuild(projectPath))
  ipc.handle('ufbt:compileLaunch:start', async (_e, projectPath: string) => startBuildAndLaunch(projectPath))
  ipc.handle('ufbt:compile:cancel', async (_e, id: string) => cancelBuild(id))
  ipc.handle('ufbt:openItem', async (_e, p: string) => {
    if (!p) return { opened: false, error: 'path required' }
    try {
      const res = await shell.showItemInFolder(p)
      return { opened: true, result: res }
    } catch (e) {
      return { opened: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}