// AIWaves desktop: starts the AIWaves server (the Rust binary) on a free local port with a fresh
// token, waits until it is healthy, and shows the read-only workspace in a native window.
// Closing the app stops the server. Agents on this machine drive the same server through the
// `aiwaves` CLI with the token written to <userData>/agent-token.txt (menu: Copy agent token).
// The menu is the right-click menu (the window has no OS title bar). The opening animation can be
// turned off there ("Play intro on launch"), with --no-intro, or with AIWAVES_NO_INTRO=1.

const { app, BrowserWindow, Menu, clipboard, dialog, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const DEV = !app.isPackaged;
// the opening animation plays with sound, without waiting for a click
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
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

/** <userData>/settings.json; anything unreadable or of the wrong type falls back to the default. */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() {
  let v = {};
  try { v = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) || {}; } catch { /* first run or unreadable */ }
  return { playIntro: typeof v.playIntro === 'boolean' ? v.playIntro : true };
}
function writeSettings(patch) {
  fs.writeFileSync(SETTINGS_FILE(), `${JSON.stringify({ ...readSettings(), ...patch }, null, 2)}
`);
}
const introWanted = () =>
  readSettings().playIntro && !process.argv.includes('--no-intro') && process.env.AIWAVES_NO_INTRO !== '1';

const SPLASH = path.join(__dirname, 'splash', 'index.html');
/** Play the opening animation; resolves when it ends or is skipped (or after 20 s, or at once if it is missing). */
async function playSplash() {
  if (!fs.existsSync(SPLASH)) return;
  const done = new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); win.webContents.off('did-navigate-in-page', onNav); resolve(); };
    const onNav = (_e, url) => { if (url.endsWith('#done')) finish(); };
    const timer = setTimeout(finish, 20000);
    win.webContents.on('did-navigate-in-page', onNav);
  });
  await win.loadFile(SPLASH);
  await done;
}

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

function menu(data, origin) {
  return Menu.buildFromTemplate([
    {
      label: 'AIWaves',
      submenu: [
        { label: 'Copy agent token', click: () => clipboard.writeText(token) },
        { label: 'Open projects folder', click: () => shell.openPath(data) },
        { label: 'Open logs folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')) },
        { type: 'separator' },
        {
          label: 'Play intro on launch',
          type: 'checkbox',
          checked: readSettings().playIntro,
          click: (item) => writeSettings({ playIntro: item.checked }),
        },
        { label: 'Replay intro', click: async () => { await playSplash(); await win.loadURL(`${origin}/`); } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
  ]);
}

// Shown while the server starts: no remote content, no scripts.
const BOOT_SCREEN = `<!doctype html><meta charset="utf-8"><title>AIWaves</title><style>
html,body{margin:0;height:100%;background:#07090d;color:#cfe9ff;font:600 12px/1.4 'Segoe UI',sans-serif;
  display:grid;place-items:center;-webkit-app-region:drag;overflow:hidden}
.c{display:grid;justify-items:center;gap:22px}
.hex{width:92px;height:106px;background:linear-gradient(160deg,#00e5ff,#b14dff);
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);filter:drop-shadow(0 0 18px #00e5ff);
  animation:b 2.4s ease-in-out infinite}
.hex::after{content:'';position:absolute}
h1{margin:0;font-size:22px;letter-spacing:.42em;padding-left:.42em;color:#e8f6ff}
.bar{width:260px;height:3px;background:#151a22;overflow:hidden}
.bar i{display:block;width:40%;height:100%;background:#00e5ff;box-shadow:0 0 12px #00e5ff;animation:s 1.2s ease-in-out infinite}
p{margin:0;letter-spacing:.3em;color:#6b7a90}
@keyframes b{50%{filter:drop-shadow(0 0 30px #b14dff)}}@keyframes s{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style><div class="c"><div class="hex"></div><h1>AIWAVES</h1><div class="bar"><i></i></div><p>INITIALIZING ENGINE</p></div>`;

function lockDown() {
  // the workspace needs no camera, microphone, location, notifications...: deny every request
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}

async function createWindow() {
  lockDown();
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1024,
    minHeight: 680,
    title: 'AIWaves',
    backgroundColor: '#07090d',
    // Alienware-style chrome: no OS title bar; the workspace's own top bar is the title bar
    // (it marks itself draggable when it sees Electron), with native controls tinted to match
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#07090d', symbolColor: '#00e5ff', height: 40 },
    icon: path.join(__dirname, 'build/icon.png'),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // the opening animation plays while the server starts; whichever finishes last opens the workspace
  const serverStart = startServer();
  serverStart.catch(() => {});                        // reported below, once the splash is done
  const splashDone = introWanted() ? playSplash() : Promise.resolve();
  let started;
  try {
    await splashDone;
    if (!(await Promise.race([serverStart.then(() => true), new Promise((r) => setTimeout(() => r(false), 50))]))) {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BOOT_SCREEN)}`);   // still starting
    }
    started = await serverStart;
  } catch (e) {
    dialog.showErrorBox('AIWaves could not start', String(e.message || e));
    app.quit();
    return;
  }
  const origin = `http://127.0.0.1:${started.port}`;
  const appMenu = menu(started.data, origin);
  Menu.setApplicationMenu(appMenu);
  // no OS title bar, so the menu lives on right-click (with Copy when text is selected)
  win.webContents.on('context-menu', (_e, params) => {
    const items = params.selectionText ? [{ role: 'copy' }, { type: 'separator' }] : [];
    Menu.buildFromTemplate([...items, ...appMenu.items.map((m) => ({ label: m.label, submenu: m.submenu }))]).popup({ window: win });
  });
  // a crashed page reloads instead of leaving a dead window
  win.webContents.on('render-process-gone', (_e, details) => {
    log?.write(`[desktop] page process gone (${details.reason}); reloading
`);
    if (!app.isQuitting) win.loadURL(`${origin}/`);
  });
  // the window only ever shows the local server; anything else opens in the user's browser
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${origin}/`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`${origin}/`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  console.log(`AIWaves workspace: ${origin}/  data: ${started.data}`);
  log?.write(`[desktop] workspace at ${origin}/ (data: ${started.data})
`);
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
