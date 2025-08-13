#!/usr/bin/env bash
set -e
cat > src/main/main.js <<'JS'
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFile } = require('child_process')

let win = null
let tray = null
let daemonPid = null

const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
const isDev = !app.isPackaged

const resBase = isDev
  ? path.join(__dirname, '..', '..', 'assets', 'bin')
  : path.join(process.resourcesPath, 'bin')
const binDir = path.join(resBase, arch)

const cliName = process.platform === 'win32' ? 'iocoin-cli.exe' : 'iocoin-cli'
const dName = process.platform === 'win32' ? 'iocoind.exe' : 'iocoind'

const cliPath = path.join(binDir, cliName)
const dPath = path.join(binDir, dName)

const userBin = path.join(app.getPath('userData'), 'bin')
const userCli = path.join(userBin, cliName)
const userD = path.join(userBin, dName)

const dataDir = process.platform === 'darwin'
  ? path.join(app.getPath('home'), 'Library', 'Application Support', 'IOCoin')
  : path.join(app.getPath('home'), '.iocoin')

function ensureCopy(src, dst) {
  if (!fs.existsSync(src)) return false
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try { fs.copyFileSync(src, dst); fs.chmodSync(dst, 0o755) } catch {}
  return fs.existsSync(dst)
}

function cli(args) {
  return new Promise((res, rej) => {
    const a = [...args, `-datadir=${dataDir}`]
    execFile(userCli, a, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return rej(stderr || err)
      res(stdout)
    })
  })
}

async function rpc(method, params) {
  try {
    const out = await cli([method, ...(params || []).map(x => typeof x === 'object' ? JSON.stringify(x) : String(x))])
    try { return JSON.parse(out) } catch {
      const t = String(out).trim()
      if (t === 'true') return true
      if (t === 'false') return false
      const n = Number(t)
      return Number.isNaN(n) ? t : n
    }
  } catch (e) {
    throw new Error(String(e))
  }
}

async function status() {
  const r = {}
  try {
    const [info, stake, conn, bc, lock] = await Promise.allSettled([
      rpc('getinfo', []),
      rpc('getstakinginfo', []),
      rpc('getconnectioncount', []),
      rpc('getblockchaininfo', []),
      rpc('walletlockstatus', [])
    ])
    if (info.value) r.info = info.value
    if (stake.value) r.staking = stake.value
    if (conn.value != null) r.peers = Number(conn.value) || 0
    if (bc.value) r.chain = { blocks: bc.value.blocks, headers: bc.value.headers, verificationprogress: bc.value.verificationprogress }
    if (lock.value) r.lockst = lock.value
  } catch {}
  return r
}

function startDaemon() {
  if (daemonPid) return
  if (!fs.existsSync(userD)) ensureCopy(dPath, userD)
  if (!fs.existsSync(userCli)) ensureCopy(cliPath, userCli)
  fs.mkdirSync(dataDir, { recursive: true })
  const args = [`-datadir=${dataDir}`, '-daemon=1']
  const child = spawn(userD, args, { detached: true, stdio: 'ignore' })
  try { child.unref(); daemonPid = child.pid } catch {}
}

async function stopDaemon() {
  try { await rpc('stop', []) } catch {}
  daemonPid = null
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 680,
    frame: true,
    title: 'I/O Coin',
    backgroundColor: '#141b24',
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: { color: '#1f2732cc', symbolColor: '#11ceb8', height: 52 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

function createTray() {
  const i = nativeImage.createEmpty()
  tray = new Tray(i)
  const menu = Menu.buildFromTemplate([
    { label: 'Open Wallet', click: () => { if (!win) { createWindow() } else { win.show() } } },
    { label: 'Quit Frontend', click: () => { if (win) win.destroy(); win = null } },
    { label: 'Quit All', click: async () => { await stopDaemon(); app.quit() } }
  ])
  tray.setToolTip('IOC Wallet')
  tray.setContextMenu(menu)
}

app.whenReady().then(() => {
  startDaemon()
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {})

ipcMain.handle('ioc:rpc', async (_e, m, p) => await rpc(m, p))
ipcMain.handle('ioc:status', async () => await status())
JS
