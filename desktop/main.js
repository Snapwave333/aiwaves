// AIWaves desktop: starts the AIWaves server (the Rust binary) on a free local port with a fresh
// token, waits until it is healthy, and shows the read-only workspace in a native window.
// Closing the app stops the server. Agents on this machine drive the same server through the
// `aiwaves` CLI with the token written to <userData>/agent-token.txt (menu: Copy agent token).

const { app, BrowserWindow, Menu, clipboard, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const DEV = !app.isPackaged;
const REPO = path.resolve(__dirname, '..');
const RES = DEV ? REPO : process.resourcesPath;

/** Where things are: the repo while developing, the app's resources once packaged. */
const paths = {
  server: DEV
    ? [path.join(REPO, 'backend/target/release/aiwaves.exe'), path.join(REPO, 'backend/target/debug/aiwaves.exe')]
    : [path.join(RES, 'bin/aiwaves.exe')],
  frontend: path.join(RES, DEV ? 'frontend/dist/frontend/browser' : 'frontend'),
  engines: path.join(RES, 'engines'),
  demo: path.join(RES, 'fixtures'),
};

let server = null;
let win = null;
let log = null;
const token = crypto.randomBytes(24).toString('hex');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Projects live in the user's data folder; the first run copies the Longing demo there. */
function dataDir() {
  const dir = path.join(app.getPath('userData'), 'projects');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(paths.demo)) fs.cpSync(paths.demo, dir, { recursive: true });
  }
  return dir;
}

async function startServer() {
  const exe = paths.server.find((p) => fs.existsSync(p));
  if (!exe) throw new Error(`AIWaves server not found (looked in: ${paths.server.join(', ')}). Build it: cargo build --release`);
  if (!fs.existsSync(path.join(paths.frontend, 'index.html'))) {
    throw new Error(`Workspace not built (${paths.frontend}). Build it: cd frontend && npx ng build`);
  }
  const port = await freePort();
  const data = DEV && process.env.AIWAVES_DATA ? process.env.AIWAVES_DATA : dataDir();
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  log = fs.createWriteStream(path.join(logDir, 'server.log'), { flags: 'a' });
  fs.writeFileSync(path.join(app.getPath('userData'), 'agent-token.txt'), `${token}\n`, { mode: 0o600 });
  server = spawn(exe, ['serve', '--data', data, '--bind', `127.0.0.1:${port}`, '--static', paths.frontend], {
    env: {
      ...process.env,
      AIWAVES_TOKEN: token,
      AIWAVES_ART_ENGINE: path.join(paths.engines, 'art/cover_art.py'),
      AIWAVES_SURGE_ENGINE: path.join(paths.engines, 'surge/surge_engine.py'),
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on('exit', (code) => {
    log?.write(`\n[server exited with ${code}]\n`);
    if (win && !app.isQuitting) {
      dialog.showErrorBox('AIWaves', `The AIWaves server stopped (exit ${code}). See ${path.join(logDir, 'server.log')}`);
    }
  });
  for (let i = 0; i < 150; i++) {
    if (await healthy(port)) return { port, data };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The AIWaves server did not become healthy within 15 s (see logs/server.log).');
}

function menu(data) {
  return Menu.buildFromTemplate([
    {
      label: 'AIWaves',
      submenu: [
        { label: 'Copy agent token', click: () => clipboard.writeText(token) },
        { label: 'Open projects folder', click: () => shell.openPath(data) },
        { label: 'Open logs folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
  ]);
}

async function createWindow() {
  let started;
  try {
    started = await startServer();
  } catch (e) {
    dialog.showErrorBox('AIWaves could not start', String(e.message || e));
    app.quit();
    return;
  }
  const origin = `http://127.0.0.1:${started.port}`;
  Menu.setApplicationMenu(menu(started.data));
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1024,
    minHeight: 680,
    title: 'AIWaves',
    backgroundColor: '#05070d',
    icon: path.join(__dirname, 'build/icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // the window only ever shows the local server; anything else opens in the user's browser
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  console.log(`AIWaves workspace: ${origin}/  data: ${started.data}`);
  await win.loadURL(`${origin}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('before-quit', () => {
    app.isQuitting = true;
    if (server && server.exitCode === null) server.kill();
  });
  app.on('window-all-closed', () => app.quit());
}
