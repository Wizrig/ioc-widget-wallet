const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, dialog } = require('electron');
const { DATA_DIR, CONF_PATH, LAUNCH_AGENT } = require('../shared/constants');

function ensureConf() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONF_PATH)) {
    const rpcuser = 'ioc_' + crypto.randomBytes(6).toString('hex');
    const rpcpassword = crypto.randomBytes(24).toString('base64');
    const conf = [
      'server=1',
      `rpcuser=${rpcuser}`,
      `rpcpassword=${rpcpassword}`,
      'rpcallowip=127.0.0.1',
      'rpcport=33765'
    ].join('\n');
    fs.writeFileSync(CONF_PATH, conf);
  }
}

function writeLaunchAgent(iocoindPath) {
  const out = path.join(DATA_DIR, 'iocoind.out.log');
  const err = path.join(DATA_DIR, 'iocoind.err.log');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.iocoin.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${iocoindPath}</string>
    <string>-datadir=${DATA_DIR}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${out}</string>
  <key>StandardErrorPath</key><string>${err}</string>
</dict></plist>`;
  const dir = path.dirname(LAUNCH_AGENT);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT, plist);
}

async function installLaunchAgent(iocoindPath) {
  ensureConf();
  writeLaunchAgent(iocoindPath);
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['load', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

async function unloadLaunchAgent() {
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['unload', LAUNCH_AGENT], (e) => e ? reject(e) : resolve(true));
  });
}

let child;

function startDetached(iocoindPath) {
  ensureConf();
  if (child?.pid) return true;
  try {
    child = spawn(iocoindPath, [`-datadir=${DATA_DIR}`], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (e) {
    dialog.showErrorBox('Daemon start failed', String(e));
    return false;
  }
}

function stopViaCli(iocCliPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(iocCliPath, ['stop', `-datadir=${DATA_DIR}`], { stdio: 'ignore' });
    p.on('exit', (code) => code === 0 ? resolve(true) : reject(new Error('stop failed')));
  });
}

module.exports = { ensureConf, installLaunchAgent, unloadLaunchAgent, startDetached, stopViaCli };
