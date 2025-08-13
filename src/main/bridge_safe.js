const { spawn } = require('child_process');

const CANDIDATES = [
  process.env.IOC_BIN && process.env.IOC_BIN.trim(),
  'iocoind', 'ioc-cli', 'iocoin-cli', 'ioc'
].filter(Boolean);

const TIMEOUT_MS   = 5000;
const BASE_DELAY   = 1000;
const BACKOFF_STEP = 600;
const MAX_DELAY    = 5000;

let cliPath = null;
let q = [];
let busy = false;
let lastSnap = null;
let failCount = 0;
let timer = null;

function parseJSON(s){ try { return JSON.parse(s); } catch { return null; } }
function n(x, d=0){ return (typeof x === 'number' && isFinite(x)) ? x : d; }

function execRaw(bin, method, params=[]) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [method, ...params.map(String)], { stdio: ['ignore','pipe','pipe'] });
    let out='', err='';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, TIMEOUT_MS);
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('error', reject);
    p.on('close', code => {
      clearTimeout(t);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `cli exit ${code}`));
    });
  });
}

async function resolveCli() {
  if (cliPath) return cliPath;
  for (const bin of CANDIDATES) {
    try {
      const raw = await execRaw(bin, 'getblockchaininfo', []);
      const j = parseJSON(raw);
      if (j && typeof j.blocks === 'number') { cliPath = bin; return cliPath; }
    } catch {}
  }
  throw new Error('No working IOC CLI found: ' + CANDIDATES.join(', '));
}

async function execCli(method, params=[]) {
  const bin = await resolveCli();
  const raw = await execRaw(bin, method, params);
  return parseJSON(raw) ?? raw;
}

function rpc(method, params=[]) {
  return new Promise((resolve, reject) => {
    q.push({ method, params, resolve, reject });
    pump();
  });
}

async function pump(){
  if (busy) return;
  const job = q.shift();
  if (!job) return;
  busy = true;
  try { job.resolve(await execCli(job.method, job.params)); }
  catch (e) { job.reject(e); }
  finally { busy = false; if (q.length) setImmediate(pump); }
}

async function snapshotOnce(){
  const r = {};
  const calls = [
    ['getblockchaininfo', []],
    ['getwalletinfo', []],
    ['getinfo', []],
    ['getstakinginfo', []],
    ['getconnectioncount', []],
    ['walletlockstatus', []],
  ];
  for (const [m,p] of calls) {
    try { r[m] = await rpc(m,p); } catch { r[m] = null; }
  }

  const bc = r.getblockchaininfo || {};
  const wi = r.getwalletinfo     || {};
  const gi = r.getinfo           || {};
  const si = r.getstakinginfo    || {};

  const balance = (typeof wi.balance === 'number') ? wi.balance
                 : (typeof gi.balance === 'number') ? gi.balance
                 : (lastSnap?.balance || 0);

  const blocks  = n(bc.blocks,  n(gi.blocks, lastSnap?.blocks || 0));
  const headers = n(bc.headers, blocks);
  const vprog   = (typeof bc.verificationprogress === 'number') ? bc.verificationprogress : null;

  const isLocked = (r.walletlockstatus && typeof r.walletlockstatus.isLocked === 'boolean')
      ? r.walletlockstatus.isLocked
      : (lastSnap?.isLocked ?? null);

  const peers     = n(r.getconnectioncount, n(gi.connections, lastSnap?.peers || 0));
  const stakingOn = !isLocked && !!(si.staking || si.enabled);
  const weight    = stakingOn ? n(si.weight, n(si.stake)) : 0;

  lastSnap = {
    balance, peers, blocks, headers,
    pct: (vprog!=null) ? vprog : (headers ? (blocks/headers) : (lastSnap?.pct || 0)),
    isLocked, stakingOn, staking: weight
  };
  failCount = 0;
}

function startStatusBus(push){
  if (timer) clearTimeout(timer);
  const tick = async () => {
    try { await snapshotOnce(); if (lastSnap) push(lastSnap); }
    catch { failCount++; if (lastSnap) push(lastSnap); }
    const delay = Math.min(MAX_DELAY, BASE_DELAY + failCount * BACKOFF_STEP);
    timer = setTimeout(tick, delay);
  };
  tick();
}

function getSnap(){ return lastSnap; }

module.exports = { rpc, startStatusBus, getSnap };
