export {}

declare global {
	interface Window {
		api: {
			ping: () => string
		}
		ufbt: {
			ensureEnv: () => Promise<{ ready?: boolean; created?: boolean; envDir?: string; homeDir?: string; python?: string; error?: string }>
			probeEnv: () => Promise<{ envDir: string; homeDir: string; exists: boolean; needsInstall: boolean; pythonFound: boolean; error?: string }>
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

