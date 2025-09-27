import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('api', {
	ping: () => 'pong',
})

contextBridge.exposeInMainWorld('ufbt', {
	ensureEnv: () => ipcRenderer.invoke('ufbt:ensureEnv') as Promise<{
		ready?: boolean; created?: boolean; envDir?: string; homeDir?: string; python?: string; error?: string
	}>,
	compile: (projectPath: string) => ipcRenderer.invoke('ufbt:compile:start', projectPath) as Promise<{ id: string; started: boolean; error?: string }>,
	compileLaunch: (projectPath: string) => ipcRenderer.invoke('ufbt:compileLaunch:start', projectPath) as Promise<{ id: string; started: boolean; error?: string }>,
	cancel: (id: string) => ipcRenderer.invoke('ufbt:compile:cancel', id) as Promise<{ id: string; cancelled: boolean; error?: string }>,
	openItem: (p: string) => ipcRenderer.invoke('ufbt:openItem', p) as Promise<{ opened: boolean; error?: string }>,
	onOutput: (cb: (o: { id: string; stream: 'stdout' | 'stderr'; line: string; ts: number }) => void) => {
		const listener = (_: Electron.IpcRendererEvent, payload: { id: string; stream: 'stdout' | 'stderr'; line: string; ts: number }) => cb(payload)
		ipcRenderer.on('ufbt:compile:output', listener)
		return () => ipcRenderer.removeListener('ufbt:compile:output', listener)
	},
	onDone: (cb: (d: { id: string; success: boolean; code: number; durationMs: number; faps: string[] }) => void) => {
		const listener = (_: Electron.IpcRendererEvent, payload: { id: string; success: boolean; code: number; durationMs: number; faps: string[] }) => cb(payload)
		ipcRenderer.on('ufbt:compile:done', listener)
		return () => ipcRenderer.removeListener('ufbt:compile:done', listener)
	},
})

contextBridge.exposeInMainWorld('projects', {
	writeProject: (req: { appId: string; manifest: string; code: string; workspaceJson: string }) =>
		ipcRenderer.invoke('project:write', req) as Promise<{
			basePath?: string
			projectPath?: string
			files?: { application: string; code: string; workspace: string }
			overwritten?: boolean
			error?: string
		}>,
	list: () => ipcRenderer.invoke('project:list') as Promise<{
		basePath?: string
		projects?: {
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
		}[]
		error?: string
	}>,
	read: (id: string) => ipcRenderer.invoke('project:read', id) as Promise<{
		id?: string
		projectPath?: string
		manifest?: string
		code?: string
		workspaceJson?: string
		error?: string
	}>
})

// Standalone workspace import/export (raw JSON of Blockly serialization state)
contextBridge.exposeInMainWorld('workspaceFS', {
	importJson: () => ipcRenderer.invoke('workspace:importJson') as Promise<{ filePath?: string; raw?: string; cancelled?: boolean; error?: string }> ,
	exportJson: (json: string) => ipcRenderer.invoke('workspace:exportJson', json) as Promise<{ filePath?: string; saved?: boolean; cancelled?: boolean; error?: string }> ,
})

declare global {
	interface Window {
		api: {
			ping: () => string
		}
		ufbt: {
			ensureEnv: () => Promise<{ ready?: boolean; created?: boolean; envDir?: string; homeDir?: string; python?: string; error?: string }>
			compile: (projectPath: string) => Promise<{ id: string; started: boolean; error?: string }>
			compileLaunch: (projectPath: string) => Promise<{ id: string; started: boolean; error?: string }>
			cancel: (id: string) => Promise<{ id: string; cancelled: boolean; error?: string }>
			openItem: (p: string) => Promise<{ opened: boolean; error?: string }>
			onOutput: (cb: (o: { id: string; stream: 'stdout' | 'stderr'; line: string; ts: number }) => void) => () => void
			onDone: (cb: (d: { id: string; success: boolean; code: number; durationMs: number; faps: string[] }) => void) => () => void
		}
		projects: {
			writeProject: (req: { appId: string; manifest: string; code: string; workspaceJson: string }) => Promise<{
				basePath?: string
				projectPath?: string
				files?: { application: string; code: string; workspace: string }
				overwritten?: boolean
				error?: string
			}>
			list: () => Promise<{
				basePath?: string
				projects?: {
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
				}[]
				error?: string
			}>
			read: (id: string) => Promise<{
				id?: string
				projectPath?: string
				manifest?: string
				code?: string
				workspaceJson?: string
				error?: string
			}>
		}
		workspaceFS: {
			importJson: () => Promise<{ filePath?: string; raw?: string; cancelled?: boolean; error?: string }>
			exportJson: (json: string) => Promise<{ filePath?: string; saved?: boolean; cancelled?: boolean; error?: string }>
		}
	}
}

