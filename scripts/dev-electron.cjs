#!/usr/bin/env node
/**
 * Cross-platform Electron dev launcher.
 * Waits for BOTH:
 *  - Vite dev server reachable (TCP and HTTP probe)
 *  - Compiled Electron main process bundle (dist-electron/main.js)
 * Then launches Electron with VITE_DEV_SERVER_URL injected.
 * Provides periodic status logs and a safety timeout fallback.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const DIST_ELECTRON = path.join(ROOT, 'dist-electron');
const MAIN_JS = path.join(DIST_ELECTRON, 'main.js');
const DEV_URL = 'http://127.0.0.1:8080';
const PORT = 8080;

let didLaunch = false;
let electronProcess = null;

function log(msg) {
  const ts = new Date().toISOString().split('T')[1].replace('Z','');
  console.log(`[dev-electron ${ts}] ${msg}`);
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function waitForTcp(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = ok => { if (!done){ done=true; socket.destroy(); resolve(ok);} };
    socket.setTimeout(timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host, () => finish(true));
  });
}

function waitForHttp(url, timeoutMs = 500) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      // consider any HTTP status a success for readiness purposes
      res.resume();
      resolve(true);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function pollReadiness({ hardTimeoutMs = 60000, logIntervalMs = 1500, minStablePolls = 2 }) {
  const start = Date.now();
  let stableCount = 0;
  while (!didLaunch) {
    const file = fileExists(MAIN_JS);
    const tcp = await waitForTcp(PORT);
    const httpOk = tcp ? await waitForHttp(DEV_URL) : false;

    if (file && tcp) {
      if (httpOk) stableCount++; else stableCount = 0; // ensure at least minStablePolls with HTTP responding
    } else {
      stableCount = 0;
    }

    const elapsed = Date.now() - start;
    if (elapsed > hardTimeoutMs) {
      log(`Hard timeout (${hardTimeoutMs}ms) reached – launching anyway (file=${file} tcp=${tcp} http=${httpOk}).`);
      break;
    }

    if (stableCount >= minStablePolls) {
      log(`All readiness checks passed (file tcp http stable x${stableCount}). Launching Electron.`);
      break;
    }

    log(`Waiting... file:${file?'yes':'no'} tcp:${tcp?'yes':'no'} http:${httpOk?'yes':'no'} stable:${stableCount}/${minStablePolls}`);
    await new Promise(r => setTimeout(r, logIntervalMs));
  }
}

function resolveElectronBinary() {
  try {
    // electron package exports the path to the binary as default export when required
    const electronPath = require('electron');
    if (typeof electronPath === 'string') return electronPath;
    if (electronPath && electronPath.default) return electronPath.default;
  } catch (e) {
    log('Failed to resolve electron binary from dependency. Ensure electron is installed.');
  }
  return 'electron'; // fallback; rely on PATH
}

function launchElectron() {
  if (didLaunch) return;
  didLaunch = true;
  const electronBin = resolveElectronBinary();
  log(`Spawning Electron: ${electronBin}`);
  electronProcess = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_URL,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  });

  electronProcess.on('exit', (code) => {
    log(`Electron exited with code=${code}`);
    if (code === 0) {
      log('Electron closed normally. Dev processes (vite/tsc) continue running. Ctrl+C to stop entire dev session.');
    } else {
      log('Electron exited with non-zero code; terminating dev orchestrator.');
      process.exit(code || 1);
    }
  });
}

(async () => {
  try {
    await pollReadiness({});
    launchElectron();
  } catch (err) {
    log('Unexpected error during readiness polling: ' + (err && err.stack || err));
    launchElectron();
  }
})();
