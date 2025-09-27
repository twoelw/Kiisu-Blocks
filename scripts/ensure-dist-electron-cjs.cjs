// Ensures dist-electron is treated as CommonJS by Node/Electron
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'dist-electron')
const pkgPath = path.join(dir, 'package.json')

try {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const data = { type: 'commonjs' }
  fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2))
  console.log('Wrote', pkgPath)
} catch (e) {
  console.error('Failed to write dist-electron/package.json', e)
  process.exitCode = 1
}
