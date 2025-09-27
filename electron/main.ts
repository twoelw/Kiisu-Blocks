import { app, BrowserWindow, shell, Menu, ipcMain, globalShortcut, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerUfbtIpc } from './ufbtManager'
import { writeProject, listProjects, readProject } from './projectManager'

// Dev server URL injected by npm script when running in dev
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
// With CommonJS build target, __dirname is available

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 900,
		minHeight: 600,
		title: 'Kiisu Blocks',
		webPreferences: {
			preload: join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
		show: false,
		autoHideMenuBar: true,
	})

	mainWindow.once('ready-to-show', () => mainWindow?.show())

		if (devServerUrl) {
			mainWindow.loadURL(devServerUrl)
				mainWindow.webContents.openDevTools({ mode: 'detach' })
		} else {
			// When packaged or running built files locally, dist-electron and dist are siblings.
			const indexHtml = join(__dirname, '../dist/index.html')
			if (process.env.KIISU_DEBUG?.includes('main')) {
				console.log('[main] Loading index.html from', indexHtml)
			}
			mainWindow.loadFile(indexHtml, { hash: '/' }).catch(err => {
				console.error('Failed to load index.html', err)
			})
		}

	// Hide the menu bar entirely
	mainWindow.setMenuBarVisibility(false)

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url)
		return { action: 'deny' }
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

app.whenReady().then(() => {
	// Remove application menu (Windows/Linux). On macOS you might keep a minimal menu.
	if (process.platform !== 'darwin') {
		Menu.setApplicationMenu(null)
	}
	createWindow()

	// Register global shortcut for DevTools in production
	globalShortcut.register('F12', () => {
		if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' })
	})
	globalShortcut.register('CommandOrControl+Shift+I', () => {
		if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' })
	})

	// Extra logging for white screen diagnosis
	ipcMain.on('renderer:ready', () => {
		if (process.env.KIISU_DEBUG?.includes('main')) {
			console.log('Renderer signaled ready')
		}
	})

	// uFBT environment + build IPC
	registerUfbtIpc(ipcMain)

	ipcMain.handle('project:write', async (_evt, req) => {
		try {
			return writeProject(req)
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})

	ipcMain.handle('project:list', async () => {
		try {
			return listProjects()
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})

	ipcMain.handle('project:read', async (_evt, id: string) => {
		try {
			return readProject(id)
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})

	// Import workspace JSON: show open dialog, read file contents
	ipcMain.handle('workspace:importJson', async () => {
		if (!mainWindow) return { error: 'No window' }
		try {
			const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
				title: 'Import Workspace JSON',
				filters: [ { name: 'Workspace JSON', extensions: ['json'] } ],
				properties: ['openFile']
			})
			if (canceled || filePaths.length === 0) return { cancelled: true }
			const filePath = filePaths[0]
			let raw: string
			try { raw = readFileSync(filePath, 'utf-8') } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
			return { filePath, raw }
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})

	// Export workspace JSON: show save dialog, write contents provided by renderer
	ipcMain.handle('workspace:exportJson', async (_evt, json: string) => {
		if (!mainWindow) return { error: 'No window' }
		try {
			const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
				title: 'Export Workspace JSON',
				filters: [ { name: 'Workspace JSON', extensions: ['json'] } ],
				defaultPath: 'workspace.json'
			})
			if (canceled || !filePath) return { cancelled: true }
			try { writeFileSync(filePath, json, 'utf-8') } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
			return { filePath, saved: true }
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) }
		}
	})

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

