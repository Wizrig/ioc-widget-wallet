const $ = id => document.getElementById(id);

let state = { unlocked: false, encrypted: null, peers: 0, synced: false, blocks: 0 };
let lockOverrideUntil = 0; // timestamp — suppress polling lock overwrite until this time
let refreshing = false;
let nextTimer = null;
let last = { bal: null, stakeAmt: null, stakeOn: null, vp: 0, blocks: 0, headers: 0 };

// ===== Splash State =====
let splashState = {
  visible: true,
  validStatusReceived: false,
  startTime: Date.now(),
  initialBlocks: null,  // Track initial blocks to detect movement
  longWaitShown: false,
  blockchainIndexShown: false,
  syncStartTime: null,  // When sync phase started (for ETA calculation)
  syncStartBlocks: null, // Blocks when sync phase started
  phase: 'connecting'   // 'connecting' | 'downloading' | 'installing' | 'syncing'
};

// Constants for splash behavior
const SPLASH_BLOCKS_THRESHOLD = 25; // Hide splash when within this many blocks of tip

function showSplash(text) {
  const overlay = $('splashOverlay');
  const status = $('splashStatus');
  if (overlay) overlay.classList.remove('hidden');
  if (status && text) status.textContent = text;
  document.body.classList.add('splash-active');
  splashState.visible = true;
}

function hideSplash() {
  const overlay = $('splashOverlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('splash-active');
  splashState.visible = false;
}

function updateSplashStatus(text) {
  const status = $('splashStatus');
  if (status && text) status.textContent = text;
}

// Check if splash should show progressive loading messages
function checkSplashLongWait() {
  if (!splashState.visible) return;
  if (splashState.phase !== 'connecting') return; // Only for connecting phase
  const elapsed = Date.now() - splashState.startTime;
  if (!splashState.blockchainIndexShown && elapsed > 60000) {
    splashState.blockchainIndexShown = true;
    updateSplashStatus('Loading blockchain index\u2026');
  } else if (!splashState.longWaitShown && elapsed > 8000) {
    splashState.longWaitShown = true;
    updateSplashStatus('Loading daemon\u2026 this may take a few minutes');
  }
}

/**
 * Update splash with sync progress and ETA.
 * @param {number} blocks - current block height
 * @param {number} targetHeight - network tip height
 */
function updateSplashSyncStatus(blocks, targetHeight) {
  if (!splashState.visible || splashState.phase !== 'syncing') return;

  const blocksRemaining = targetHeight - blocks;
  let statusText = `Syncing blocks… ${blocks.toLocaleString()}`;

  // Calculate ETA if we have sync start data
  if (splashState.syncStartTime && splashState.syncStartBlocks !== null) {
    const elapsedMs = Date.now() - splashState.syncStartTime;
    const blocksSynced = blocks - splashState.syncStartBlocks;

    if (blocksSynced > 10 && elapsedMs > 5000) {
      // Calculate blocks per second and ETA
      const blocksPerSec = blocksSynced / (elapsedMs / 1000);
      if (blocksPerSec > 0) {
        const secondsRemaining = blocksRemaining / blocksPerSec;
        const etaText = formatETA(secondsRemaining);
        statusText = `Syncing blocks… ${blocks.toLocaleString()} (~${etaText} remaining)`;
      }
    }
  }

  updateSplashStatus(statusText);

  // Update progress bar if deterministic progress is possible
  const splashBar = document.querySelector('.splash-bar');
  if (splashBar && targetHeight > 0 && blocks > 0) {
    const pct = Math.min(100, Math.round((blocks / targetHeight) * 100));
    splashBar.style.width = pct + '%';
    splashBar.style.animation = 'none'; // Stop indeterminate animation
  }
}

/**
 * Format seconds into human-readable ETA.
 */
function formatETA(seconds) {
  if (seconds < 60) return 'less than a minute';
  if (seconds < 120) return '~1 minute';
  if (seconds < 3600) return `~${Math.round(seconds / 60)} minutes`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours === 1) return mins > 0 ? `~1 hour ${mins} min` : '~1 hour';
  return mins > 0 ? `~${hours} hours ${mins} min` : `~${hours} hours`;
}

/**
 * Start the syncing phase of splash screen.
 */
function startSplashSyncPhase(blocks) {
  splashState.phase = 'syncing';
  splashState.syncStartTime = Date.now();
  splashState.syncStartBlocks = blocks;
  console.log('[splash] Started sync phase at block:', blocks);
}
// ===== End Splash State =====

// ===== Connection State (Step B3) =====
let connectionState = {
  connected: false,
  attempts: 0,
  maxAttempts: 8,       // ~30s total with backoff: 1+2+4+8+8+8+8+8 = 47s capped
  startTime: null,
  lastError: null
};

function showConnectBanner(text, isError, errorDetail) {
  const banner = $('connectBanner');
  const textEl = $('connectText');
  const errorEl = $('connectError');
  const helpEl = $('connectHelp');
  if (!banner) return;

  banner.classList.remove('hidden');
  banner.classList.toggle('error', !!isError);
  if (textEl) textEl.textContent = text || 'Loading daemon...';

  if (isError && errorDetail) {
    if (errorEl) {
      errorEl.textContent = errorDetail;
      errorEl.classList.remove('hidden');
    }
    if (helpEl) helpEl.classList.remove('hidden');
  } else {
    if (errorEl) errorEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
  }
}

function hideConnectBanner() {
  const banner = $('connectBanner');
  if (banner) banner.classList.add('hidden');
  connectionState.connected = true;
}

function getRetryDelay(attempt) {
  // Backoff: 1s, 2s, 4s, 8s, then cap at 8s
  const delays = [1000, 2000, 4000, 8000, 8000, 8000, 8000, 8000];
  return delays[Math.min(attempt, delays.length - 1)];
}
// ===== End Connection State =====

// ===== Bootstrap State (Step C5) =====
let bootstrapState = {
  checked: false,
  needed: false,
  inProgress: false,
  completed: false,
  error: null
};

function showBootstrapModal() {
  const modal = $('bootstrapModal');
  if (modal) modal.classList.remove('hidden');
}

function hideBootstrapModal() {
  const modal = $('bootstrapModal');
  if (modal) modal.classList.add('hidden');
}

function updateBootstrapUI(status, percent, error) {
  const statusEl = $('bootstrapStatus');
  const barEl = $('bootstrapBar');
  const percentEl = $('bootstrapPercent');
  const errorEl = $('bootstrapError');
  const actionsEl = $('bootstrapActions');

  if (statusEl && status) statusEl.textContent = status;
  if (barEl && typeof percent === 'number') barEl.style.width = percent + '%';
  if (percentEl && typeof percent === 'number') percentEl.textContent = percent + '%';

  if (error) {
    if (errorEl) {
      errorEl.textContent = error;
      errorEl.classList.remove('hidden');
    }
    if (actionsEl) actionsEl.classList.remove('hidden');
  } else {
    if (errorEl) errorEl.classList.add('hidden');
    if (actionsEl) actionsEl.classList.add('hidden');
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function runBootstrapFlow() {
  if (bootstrapState.checked) return bootstrapState.needed;

  try {
    // Check if bootstrap is needed (no blk0001.dat in data folder)
    const needed = await window.ioc.needsBootstrap();
    bootstrapState.checked = true;
    bootstrapState.needed = needed;

    if (!needed) {
      console.log('[bootstrap] Not needed, chain data exists');
      return false;
    }

    console.log('[bootstrap] No chain data found, starting bootstrap flow');
    bootstrapState.inProgress = true;

    // STEP 1: Download bootstrap (daemon has NOT been started yet)
    splashState.phase = 'downloading';
    updateSplashStatus('Downloading blockchain data…');
    showBootstrapModal();
    updateBootstrapUI('Downloading blockchain data...', 0, null);

    // Listen for progress events
    window.ioc.onBootstrapProgress((progress) => {
      if (progress.step && progress.message) {
        updateBootstrapUI(progress.message, 100, null);
        updateSplashStatus(progress.message);
        return;
      }
      const pct = progress.percent || 0;
      const downloaded = formatBytes(progress.downloaded || 0);
      const total = formatBytes(progress.total || 0);
      updateBootstrapUI(`Downloading blockchain data... (${downloaded} / ${total})`, pct, null);
      updateSplashStatus(`Downloading blockchain… ${pct}%`);
    });

    const downloadResult = await window.ioc.downloadBootstrap();
    if (!downloadResult.ok) {
      throw new Error(downloadResult.error || 'Download failed');
    }

    // STEP 2: Extract, install bootstrap files, then start daemon (with 30s timeout)
    splashState.phase = 'installing';
    updateSplashStatus('Installing blockchain files…');
    updateBootstrapUI('Installing blockchain files...', 100, null);

    const applyResult = await window.ioc.applyBootstrap();
    if (!applyResult.ok) {
      // applyBootstrap only returns ok:false when the daemon process dies.
      // It never returns ok:false for RPC timeout (it polls indefinitely while alive).
      throw new Error(applyResult.error || 'Install failed');
    }

    // Done — daemon started and responded
    bootstrapState.inProgress = false;
    bootstrapState.completed = true;
    updateBootstrapUI('Setup complete! Starting sync...', 100, null);
    splashState.phase = 'connecting';
    updateSplashStatus('Starting sync…');

    await new Promise(r => setTimeout(r, 1500));
    hideBootstrapModal();
    return true;

  } catch (err) {
    console.error('[bootstrap] Error:', err);
    bootstrapState.error = err.message || String(err);
    bootstrapState.inProgress = false;
    splashState.phase = 'connecting';
    updateBootstrapUI('Setup failed', 0, bootstrapState.error);
    return false;
  }
}


function setupBootstrapHandlers() {
  const skipBtn = $('bootstrapSkip');
  const retryBtn = $('bootstrapRetry');

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      console.log('[bootstrap] User skipped bootstrap, using manual sync');
      hideBootstrapModal();
      bootstrapState.inProgress = false;
      // Continue to normal refresh loop
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      bootstrapState.checked = false;
      bootstrapState.error = null;
      updateBootstrapUI('Retrying...', 0, null);
      await runBootstrapFlow();
    });
  }
}
// ===== End Bootstrap State =====

/**
 * Update sync bar and text based on chain state.
 * @param {number} blocks - current local block height
 * @param {number} targetHeight - network tip height (from explorer or headers)
 * @param {number} verificationProgress - 0-1 progress value (optional)
 * @param {number} remoteTip - explicit remote tip if available (used only for progress bar math)
 */
function updateSyncDisplay(blocks, targetHeight, verificationProgress, remoteTip) {
  const bar = $('syncbar');
  const t = $('syncText');
  const wrap = document.querySelector('#tab-overview .sync-wrap');

  // A) Always store blocks in state immediately (before any conditional logic)
  state.blocks = blocks;

  // B) Calculate progress bar percentage (remoteTip can be used here for smoother pct)
  const pctTarget = remoteTip > 0 ? remoteTip : (targetHeight > 0 ? targetHeight : 1);
  let pct;
  if (pctTarget > 0 && blocks > 0) {
    pct = Math.round((blocks / pctTarget) * 100);
  } else if (typeof verificationProgress === 'number' && verificationProgress > 0) {
    pct = Math.round(verificationProgress * 100);
  } else {
    pct = 0;
  }
  pct = Math.max(0, Math.min(100, pct));

  // C) Synced check uses ONLY targetHeight (NOT remoteTip)
  const isSynced = targetHeight > 0 && blocks >= targetHeight;

  // Store synced state for staking icon
  state.synced = isSynced;

  if (isSynced) {
    // When synced: hide the entire sync row (no gap left behind)
    if (wrap) wrap.style.display = 'none';
  } else {
    // While NOT synced: always show the bottom sync row
    if (wrap) wrap.style.display = '';
    if (bar) {
      bar.style.display = '';
      bar.style.width = pct + '%';
    }
    // Text: "Syncing wallet (BLOCK)" - plain integer, no commas
    if (t) {
      t.textContent = `Syncing wallet (${blocks})`;
    }
  }

  if (wrap) wrap.classList.toggle('synced', isSynced);

  const syncChip = $('ic-sync');
  if (syncChip) syncChip.classList.toggle('ok', isSynced);
}

// Legacy wrapper for compatibility
function setSync(pct, text) {
  // This function is kept for any external calls but updateSyncDisplay is preferred
  const bar = $('syncbar');
  const t = $('syncText');
  const wrap = document.querySelector('#tab-overview .sync-wrap');

  if ((pct || 0) >= 100) {
    if (bar) bar.style.display = 'none';
    if (t) {
      const syncedText = (text || '').trim().replace(/^Syncing wallet/i, 'Synced');
      t.textContent = syncedText || 'Synced';
    }
    if (wrap) wrap.classList.add('synced');
  } else {
    if (bar) {
      bar.style.display = '';
      bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    }
    if (t) t.textContent = text || '';
    if (wrap) wrap.classList.remove('synced');
  }

  const syncChip = $('ic-sync');
  if (syncChip) syncChip.classList.toggle('ok', (pct || 0) >= 100);
}


function setPeers(n) {
  state.peers = n || 0;
  const chip = $('ic-peers');
  if (chip) {
    // Tooltip shows peers + single local block height (no commas, no network tip)
    let tooltip = `Peers: ${state.peers}`;
    if (state.blocks > 0) {
      tooltip += `\nBlocks: ${state.blocks}`;
    }
    chip.title = tooltip;
    chip.classList.toggle('ok', state.peers > 0);
  }
}

function setLock(unlocked, encrypted) {
  state.unlocked = !!unlocked;
  if (typeof encrypted === 'boolean') state.encrypted = encrypted;
  const p = $('p-lock'); if (!p) return;
  const chip = $('ic-lock');

  if (state.encrypted === false) {
    // Unencrypted wallet — grey lock, open padlock shape
    p.setAttribute('d', 'M9 10V7a3 3 0 0 1 6 0h2a5 5 0 1 0-10 0v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H9zm3 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z');
    if (chip) { chip.classList.remove('ok'); chip.title = 'Wallet is unencrypted (click to encrypt it)'; }
  } else if (state.unlocked) {
    p.setAttribute('d', 'M9 10V7a3 3 0 0 1 6 0h2a5 5 0 1 0-10 0v3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H9zm3 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z');
    if (chip) { chip.classList.add('ok'); chip.title = 'Wallet unlocked'; }
  } else {
    p.setAttribute('d', 'M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm3 8H9V7a3 3 0 016 0v3z');
    if (chip) { chip.classList.remove('ok'); chip.title = 'Wallet locked'; }
  }
}

function setStaking(on, amount, stakingInfo, balance) {
  const chip = $('ic-stake');
  if (chip) {
    // Staking icon is green ONLY when ALL are true:
    // 1. Wallet unlocked for staking
    // 2. Chain synced (near tip)
    // 3. Daemon reports actively staking (not just enabled)
    // 4. Balance > 0 (stakeable amount)
    const bal = typeof balance === 'number' ? balance : 0;
    const isActivelyStaking = !!on && state.unlocked && state.synced && bal > 0;
    chip.classList.toggle('ok', isActivelyStaking);

    // Build tooltip with staking info
    let tooltip = isActivelyStaking ? 'Staking on' : 'Staking off';
    if (stakingInfo && typeof stakingInfo === 'object') {
      const parts = [];
      if (typeof stakingInfo.weight === 'number' && stakingInfo.weight > 0) {
        parts.push(`Weight: ${stakingInfo.weight}`);
      }
      if (typeof stakingInfo.netstakeweight === 'number' && stakingInfo.netstakeweight > 0) {
        parts.push(`Network: ${stakingInfo.netstakeweight}`);
      }
      if (typeof stakingInfo.expectedtime === 'number' && stakingInfo.expectedtime > 0) {
        const hours = Math.round(stakingInfo.expectedtime / 3600);
        const days = Math.round(stakingInfo.expectedtime / 86400);
        if (days > 1) {
          parts.push(`Expected: ~${days} days`);
        } else if (hours > 0) {
          parts.push(`Expected: ~${hours} hours`);
        }
      }
      if (parts.length > 0) {
        tooltip += '\n' + parts.join('\n');
      }
    }
    // Show reason if daemon says staking enabled but not actively staking
    if (on && !isActivelyStaking) {
      if (!state.unlocked) tooltip += '\n(Wallet locked)';
      else if (!state.synced) tooltip += '\n(Syncing)';
      else if (bal <= 0) tooltip += '\n(No balance)';
    }
    chip.title = tooltip;
  }
  const s = $('staking'); if (s) s.textContent = on ? Number(amount || 0).toLocaleString() : '0';
}

let __resizeRAF=null;
function fitBalance() {
  const box = $('bignum'), span = $('big-balance');
  if (!box || !span) return;
  // Guard: don't run if Overview tab is hidden or not properly laid out
  const overview = $('tab-overview');
  if (!overview || overview.classList.contains('hidden')) return;
  if (span.offsetParent === null) return; // not visible
  const boxWidth = box.clientWidth;
  if (!boxWidth || boxWidth < 100) return; // layout not settled

  const ctx = document.createElement('canvas').getContext('2d');
  const font = s => `800 ${s}px -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif`;
  let size = 84, max = boxWidth - 30;
  while (size > 36) { ctx.font = font(size); if (ctx.measureText(span.textContent).width <= max) break; size -= 2; }
  span.style.setProperty('font-size', size + 'px', 'important');
}

function scheduleRefresh(ms) {
  if (nextTimer) clearTimeout(nextTimer);
  nextTimer = setTimeout(refresh, ms);
}

async function refresh() {
  if (refreshing) {
    console.warn('[refresh] Already in progress, skipping');
    return;
  }
  refreshing = true;
  const startTime = Date.now();
  let timedOut = false;
  let connectionFailed = false;

  try {
    console.log('[refresh] Starting status fetch');
    const statusPromise = window.ioc.status();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IPC timeout after 8000ms')), 8000)
    );
    const st = await Promise.race([statusPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;
    console.log(`[refresh] Completed in ${elapsed}ms`);

    // Extract chain data
    const blocks = st?.chain?.blocks || 0;
    const headers = st?.chain?.headers || 0;
    const remoteTip = st?.remoteTip || 0;  // Network tip from explorer API
    const vp = typeof st?.chain?.verificationprogress === 'number' ? st.chain.verificationprogress : 0;

    // BALANCE MUST DISPLAY IMMEDIATELY - before any other logic
    // Render as soon as first wallet RPC responds, even while syncing
    // Do NOT gate on synced, networkTip, or verification progress
    const info = st?.info || {};
    // Only update if we have actual balance data from RPC (not defaulted 0)
    const hasBalance = typeof info.balance === 'number' || typeof info.walletbalance === 'number';
    if (hasBalance) {
      const bal = Number(info.balance ?? info.walletbalance);
      // NEVER overwrite a known non-zero balance with 0 (protects against stale cache/RPC gaps)
      // Only allow 0 if: (1) first load, or (2) we already had 0, or (3) we never had a balance
      const allowZero = last.bal === null || last.bal === 0;
      if (bal === 0 && !allowZero && last.bal > 0) {
        // Skip: don't flash 0 when we know user has funds
        console.log('[balance] Ignoring 0 balance - preserving known balance:', last.bal);
      } else if (last.bal === null || last.bal !== bal) {
        // Update when changed OR on first valid balance (last.bal is null)
        const balText = (Math.round(bal * 1000) / 1000).toLocaleString();
        const el = $('big-balance');
        if (el) el.textContent = balText;
        // Also update widget balance directly (compact mode)
        const wBal = $('widget-balance');
        if (wBal) wBal.textContent = balText;
        last.bal = bal;
        fitBalance();
      }
    }

    // Check if we have valid chain data (not 0/0)
    const hasValidChainData = blocks > 0 || headers > 0;

    // Handle splash visibility - wait until within 25 blocks of network tip
    if (splashState.visible) {
      // Check if we should show "this may take a few minutes"
      checkSplashLongWait();

      if (hasValidChainData) {
        // Track initial blocks to detect movement
        if (splashState.initialBlocks === null) {
          splashState.initialBlocks = blocks;
          console.log('[splash] Initial blocks:', blocks);
        }

        // Use remoteTip (from explorer) as authoritative network height
        const networkTip = remoteTip > 0 ? remoteTip : headers;
        const blocksRemaining = networkTip > 0 ? networkTip - blocks : 0;

        // Determine if we're close enough to hide splash
        const closeEnough = networkTip > 0 && blocksRemaining <= SPLASH_BLOCKS_THRESHOLD;

        if (closeEnough) {
          // Within 25 blocks of tip - hide splash and show wallet
          console.log(`[splash] Within ${SPLASH_BLOCKS_THRESHOLD} blocks of tip (${blocksRemaining} remaining), hiding splash`);
          splashState.validStatusReceived = true;
          hideSplash();
          hideConnectBanner();
          connectionState.connected = true;
          connectionState.attempts = 0;
          connectionState.lastError = null;
        } else if (blocks > 0) {
          // Have blocks but still syncing - show sync progress in splash
          if (splashState.phase === 'connecting') {
            // Transition from connecting to syncing phase
            startSplashSyncPhase(blocks);
          }
          // Update splash with sync progress and ETA
          updateSplashSyncStatus(blocks, networkTip);
          // Mark as connected (daemon is responding)
          connectionState.connected = true;
          connectionState.attempts = 0;
        } else {
          // Have headers but no blocks yet - still warming up
          updateSplashStatus('Loading daemon…');
        }
      } else {
        // No chain data yet - still warming up
        if (!splashState.longWaitShown) {
          updateSplashStatus('Loading daemon…');
        }
      }
    } else {
      // Splash already hidden - normal connection handling
      if (!connectionState.connected) {
        hideConnectBanner();
        connectionState.connected = true;
        connectionState.attempts = 0;
        connectionState.lastError = null;
      }
    }

    // Update sync display only if we have valid data
    // Use remoteTip as target if available, otherwise fall back to headers
    const targetHeight = remoteTip > 0 ? remoteTip : (headers > 0 ? headers : blocks);
    if (hasValidChainData && (last.vp !== vp || last.blocks !== blocks || last.headers !== targetHeight)) {
      updateSyncDisplay(blocks, targetHeight, vp, remoteTip);
      last.vp = vp;
      last.blocks = blocks;
      last.headers = targetHeight;
    }

    setPeers(st?.peers || 0);

    const locked = st?.lockst?.isLocked;
    const isEncrypted = st?.lockst?.isEncrypted;
    // Skip lock state overwrite during grace period after user action
    if (typeof locked === 'boolean' && Date.now() >= lockOverrideUntil) {
      setLock(!locked, typeof isEncrypted === 'boolean' ? isEncrypted : undefined);
    }

    // staking ON flag — only true when daemon reports actively staking (not just enabled)
    const stakingOn = !!(st?.staking?.staking);
    // staking AMOUNT (prefer getinfo.stake, fallback to getstakinginfo fields)
    const stakingAmt = Number(
      (typeof info.stake !== 'undefined') ? info.stake :
      (st?.staking && typeof st.staking.stake !== 'undefined') ? st.staking.stake :
      (st?.staking && typeof st.staking.stakingbalance !== 'undefined') ? st.staking.stakingbalance : 0
    );

    // Always update staking display since it depends on unlocked, synced, and balance
    const stakingInfo = st?.staking || {};
    const currentBalance = last.bal != null ? last.bal : 0;
    setStaking(stakingOn, stakingAmt, stakingInfo, currentBalance);
    last.stakeOn = stakingOn; last.stakeAmt = stakingAmt;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    connectionFailed = true;
    connectionState.lastError = (err && err.message) ? err.message : String(err);

    if (err && err.message && err.message.includes('timeout')) {
      timedOut = true;
      console.error(`[refresh] Timed out after ${elapsed}ms`);
    } else {
      console.error(`[refresh] Failed after ${elapsed}ms:`, connectionState.lastError);
    }

    // Handle connection failure with retry/backoff (RC3-style)
    if (!connectionState.connected) {
      connectionState.attempts++;
      if (splashState.visible) {
        if (connectionState.attempts >= connectionState.maxAttempts) {
          hideSplash();
          showConnectBanner(
            'Daemon not responding',
            true,
            'Could not connect to iocoind. Ensure the daemon is installed and running.'
          );
        } else {
          updateSplashStatus(`Starting daemon… (attempt ${connectionState.attempts}/${connectionState.maxAttempts})`);
        }
      } else {
        if (connectionState.attempts >= connectionState.maxAttempts) {
          showConnectBanner(
            'Daemon not responding',
            true,
            'Could not connect to iocoind. Ensure the daemon is installed and running.'
          );
        } else {
          showConnectBanner(`Loading daemon… (attempt ${connectionState.attempts}/${connectionState.maxAttempts})`);
        }
      }
    }
  }
  finally {
    refreshing = false;
    // Adaptive polling: faster while syncing, slower when synced; extra-slow when tab/window hidden
    const isHidden = document.hidden;
    const vp = last.vp || 0;
    let delay;

    if (connectionFailed && !connectionState.connected) {
      // Use backoff delay when not connected
      delay = getRetryDelay(connectionState.attempts);
      console.log(`[refresh] Connection failed, retry in ${delay}ms (attempt ${connectionState.attempts})`);
    } else {
      // Intel Macs need slower polling to avoid daemon performance issues
      const isIntel = !navigator.userAgent.includes('ARM') && !navigator.platform?.includes('arm');
      // Faster polling during splash sync phase so block count updates quickly
      const isSplashSync = splashState.visible && splashState.phase === 'syncing';
      const base = isSplashSync
        ? (isIntel ? 2000 : 1000)   // splash sync: 2s Intel, 1s ARM
        : vp < 0.999
          ? (isIntel ? 5000 : 1500)   // syncing: 5s Intel, 1.5s ARM
          : (isIntel ? 8000 : 4000);  // synced:  8s Intel, 4s ARM
      delay = isHidden ? Math.max(base, 10000) : base;
      if (timedOut) {
        delay = Math.max(delay, 6000);
      }
      console.log(`[refresh] Next refresh in ${delay}ms (vp=${vp.toFixed(3)}, hidden=${isHidden}, timedOut=${timedOut})`);
    }
    scheduleRefresh(delay);
  }
}

async function loadHistory_OLD() {
  const rows = await window.ioc.listTx(50);
  const tbody = $('txrows'); if (!tbody) return;
  tbody.innerHTML = '';

  const reversed = rows.slice().reverse();

  reversed.forEach(t => {
    const tr = document.createElement('tr');
    const when = new Date((t.timereceived || t.time || 0) * 1000).toLocaleString();
    tr.innerHTML = `<td class="col-when">${when}</td><td class="col-amt">${t.amount || 0}</td><td class="col-addr">${t.address || t.txid || ""}</td>`;
    tbody.appendChild(tr);
  });
}

async function loadAddrs() {
  const grid = $('addrGrid'); if (!grid) return;
  grid.innerHTML = '';
  const xs = await window.ioc.listAddrs();
  xs.forEach(x => {
    const card = document.createElement('div');
    card.className = 'addr-card';
    const balText = typeof x.amount === 'number' ? `Balance: ${x.amount} IOC — Click to copy` : 'Click to copy';
    card.innerHTML = `<div class="label" title="Click to edit label" style="cursor:pointer">${x.label || 'Address'}</div>
      <div class="addr" title="${balText}" style="cursor:pointer;user-select:text">${x.address}</div>`;
    const labelEl = card.querySelector('.label');
    const addrEl = card.querySelector('.addr');
    // Click label to edit
    labelEl.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = x.label || '';
      input.placeholder = 'Label';
      input.style.cssText = 'width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:inherit;font:inherit;padding:2px 6px;';
      labelEl.replaceWith(input);
      input.focus();
      input.select();
      const save = async () => {
        const newLabel = (input.value || '').trim();
        const res = await window.ioc.setLabel(x.address, newLabel);
        if (res?.ok) x.label = newLabel;
        const newEl = document.createElement('div');
        newEl.className = 'label';
        newEl.title = 'Click to edit label';
        newEl.style.cursor = 'pointer';
        newEl.textContent = x.label || 'Address';
        input.replaceWith(newEl);
        newEl.addEventListener('click', () => labelEl.click());
        // Reload to get fresh data
        loadAddrs();
      };
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = x.label || ''; input.blur(); } });
    });
    // Click address to copy
    addrEl.addEventListener('click', () => {
      navigator.clipboard.writeText(x.address).then(() => {
        addrEl.textContent = 'Copied!';
        setTimeout(() => { addrEl.textContent = x.address; }, 1200);
      });
    });
    grid.appendChild(card);
  });
}

function switchTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $('tab-' + name).classList.remove('hidden');
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  if (name === 'history') loadHistory();
  if (name === 'address') loadAddrs();
  // Re-fit balance after switching to Overview (double RAF ensures layout is settled)
  if (name === 'overview') {
    requestAnimationFrame(() => requestAnimationFrame(() => fitBalance()));
  }
}

async function doUnlock() {
  const pass = ($('pass').value || '').trim(); if (!pass) return;
  $('unlockErr').textContent = '';
  const btn = $('doUnlock');
  if (btn) { btn.textContent = 'Unlocking\u2026'; btn.disabled = true; }
  const r = await window.ioc.tryRpc('walletpassphrase', [pass, 9999999]);
  if (btn) { btn.textContent = 'Unlock'; btn.disabled = false; }
  if (!r || !r.ok) {
    $('unlockErr').textContent = 'Wrong passphrase';
    const sheet = $('unlockSheet');
    if (sheet) { sheet.classList.remove('shake'); void sheet.offsetWidth; sheet.classList.add('shake'); }
    return;
  }
  lockOverrideUntil = Date.now() + 20000;
  setLock(true);
  $('unlockModal').classList.add('hidden');
  $('pass').value = '';
  refresh();
  window.ioc.tryRpc('reservebalance', [false]);
}

async function doEncrypt() {
  const pass = ($('encryptPass').value || '').trim();
  const confirm = ($('encryptPassConfirm').value || '').trim();
  $('encryptErr').textContent = '';
  if (!pass) { $('encryptErr').textContent = 'Passphrase is required'; return; }
  if (pass !== confirm) { $('encryptErr').textContent = 'Passphrases do not match'; return; }
  try {
    await window.ioc.rpc('encryptwallet', [pass]);
  } catch (_) {
    // encryptwallet may error because daemon shuts down mid-RPC — that's expected
  }
  // Close modal, show splash, restart daemon
  $('encryptModal').classList.add('hidden');
  $('encryptPass').value = '';
  $('encryptPassConfirm').value = '';
  updateSplashStatus('Wallet encrypted. Daemon is restarting…');
  showSplash();
  try {
    const result = await window.ioc.restartDaemon();
    if (result?.ok) {
      updateSplashStatus('Daemon restarted. Loading…');
      // Reset state so polling picks up the new encrypted status
      state.encrypted = null;
      connectionState.connected = false;
      connectionState.attempts = 0;
    }
  } catch (e) {
    updateSplashStatus('Restart failed: ' + (e?.message || 'unknown error'));
  }
}

async function onLockClick() {
  if (state.encrypted === false) {
    // Wallet not encrypted — show encrypt modal
    $('encryptPass').value = '';
    $('encryptPassConfirm').value = '';
    $('encryptErr').textContent = '';
    $('encryptModal').classList.remove('hidden');
    setTimeout(() => $('encryptPass').focus(), 0);
    return;
  }
  if (state.unlocked) {
    lockOverrideUntil = Date.now() + 20000;
    setLock(false);
    setStaking(false, 0, {}, 0);
    window.ioc.tryRpc('walletlock', []);
    window.ioc.tryRpc('reservebalance', [true, 999999999]);
  } else {
    $('unlockModal').classList.remove('hidden');
    setTimeout(() => $('pass').focus(), 0);
  }
}

/** New Address flow */
function openNewAddrModal() {
  $('newLabel').value = '';
  $('newAddrErr').textContent = '';
  $('newAddrResult').classList.add('hidden');
  $('newAddrResult').textContent = '';
  $('newAddrModal').classList.remove('hidden');
  setTimeout(() => $('newLabel').focus(), 0);
}

let _creatingAddr = false;
async function createNewAddr() {
  if (_creatingAddr) return;
  _creatingAddr = true;
  try {
    const label = ($('newLabel').value || '').trim();
    $('newAddrErr').textContent = '';
    const res = await window.ioc.newAddr(label);
    if (!res?.ok) { $('newAddrErr').textContent = 'Could not create address (daemon not ready?)'; return; }
    const out = $('newAddrResult');
    out.textContent = res.address;
    out.classList.remove('hidden');
    setTimeout(loadAddrs, 300);
    setTimeout(() => { $('newAddrModal').classList.add('hidden'); }, 1200);
  } finally {
    setTimeout(() => { _creatingAddr = false; }, 1500);
  }
}

function main() {
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  window.addEventListener('resize',()=>{if(__resizeRAF)cancelAnimationFrame(__resizeRAF);__resizeRAF=requestAnimationFrame(()=>{__resizeRAF=null;fitBalance();});});

  document.addEventListener('visibilitychange', () => {
    // When returning to the app, refresh immediately; when hiding, the next tick will stretch.
    if (!document.hidden) refresh();
  });

  $('ic-lock').addEventListener('click', onLockClick);
  $('cancelUnlock').addEventListener('click', () => { $('unlockModal').classList.add('hidden'); $('pass').value=''; });
  $('doUnlock').addEventListener('click', doUnlock);
  $('pass').addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); if (e.key === 'Escape') {$('unlockModal').classList.add('hidden');} });

  $('cancelEncrypt').addEventListener('click', () => { $('encryptModal').classList.add('hidden'); $('encryptPass').value=''; $('encryptPassConfirm').value=''; });
  $('doEncrypt').addEventListener('click', doEncrypt);
  $('encryptPassConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') doEncrypt(); if (e.key === 'Escape') {$('encryptModal').classList.add('hidden');} });

  $('sendBtn').addEventListener('click', () => $('sendModal').classList.remove('hidden'));
  // Widget send button (compact mode)
  const widgetSendBtn = $('widget-send-btn');
  if (widgetSendBtn) {
    widgetSendBtn.addEventListener('click', () => $('sendModal').classList.remove('hidden'));
  }
  $('cancelSend').addEventListener('click', () => $('sendModal').classList.add('hidden'));
  $('doSend').addEventListener('click', async () => {
    const a = ($('sendAddr').value||'').trim();
    const n = parseFloat(($('sendAmt').value||'').trim());
    if (!a || !(n>0)) return;
    if (!state.unlocked) { $('unlockModal').classList.remove('hidden'); return; }
    try { await window.ioc.rpc('sendtoaddress', [a, n]); $('sendModal').classList.add('hidden'); setTimeout(refresh, 400); } catch {}
  });

  $('newAddrBtn').addEventListener('click', openNewAddrModal);
  $('cancelNewAddr').addEventListener('click', () => $('newAddrModal').classList.add('hidden'));
  $('createNewAddr').addEventListener('click', createNewAddr);
  $('newLabel').addEventListener('keydown', e => { if (e.key === 'Enter') createNewAddr(); if (e.key === 'Escape') {$('newAddrModal').classList.add('hidden');}});

  // Setup help link to open externally via IPC
  const helpLink = $('connectHelp');
  if (helpLink) {
    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.ioc && window.ioc.openExternal) {
        window.ioc.openExternal(helpLink.href);
      }
    });
  }

  // Setup bootstrap handlers (skip/retry buttons)
  setupBootstrapHandlers();

  // Check for first-run bootstrap before starting normal refresh loop
  (async () => {
    try {
      await runBootstrapFlow();
    } catch (err) {
      console.error('[main] Bootstrap flow error:', err);
    }

    // After bootstrap (or if not needed), splash is already visible
    // Start refresh loop - splash will hide when valid status is received
    connectionState.startTime = Date.now();
    // Don't show connect banner - splash handles warmup display
    refresh();
  })();
}
document.addEventListener('DOMContentLoaded', ()=>{ main(); try{ ensureHistoryLayout(); }catch(_){}});

(function(){
  if (document.getElementById("hist-cols-css")) return;
  var css = `
    /* History table column sizing */
    #history-pane table{ table-layout:auto; width:100%; }
    #history-pane th, #history-pane td{ white-space:nowrap; }
    /* When column ~260px */
    #history-pane .col-when{ width:260px; }
    /* Amount column ~80px, right aligned */
    #history-pane .col-amt{ width:80px; text-align:right; }
    /* Address column uses the rest, no clipping/ellipsis */
    #history-pane .col-addr{ white-space:nowrap; overflow:visible; }
  `;
  var el = document.createElement("style");
  el.id = "hist-cols-css";
  el.textContent = css;
  document.head.appendChild(el);
})();


;(function(){
  function q(id){return document.getElementById(id)}
  async function rpc(m, a){ try { return await window.ioc.rpc(m, a||[]) } catch(e){ throw e } }

  function setupWalletTools(){
    var d=q('btnDump'), imp=q('btnImport'), op=q('btnOpenPath');
    if (op && window.sys) op.addEventListener('click', function(){ window.sys.openFolder() });

    if (d) d.addEventListener('click', async function(){
      var pass = prompt('Enter wallet passphrase');
      if (!pass) return;
      var path = prompt('Enter full .txt path to save (e.g. /Users/you/Desktop/wallet_dump.txt)');
      if (!path || !/\.txt$/i.test(path)) { alert('Path must end with .txt'); return; }
      try {
        await rpc('walletpassphrase',[pass,60]);
        await rpc('dumpwalletRT',[path]);
        alert('Dump complete to:\n'+path);
      } catch(e){ alert('Dump failed'); }
      try{ await rpc('walletlock',[]) }catch(e){}
    });

    if (imp) imp.addEventListener('click', async function(){
      var pass = prompt('Enter wallet passphrase');
      if (!pass) return;
      var path = prompt('Enter full path of dump .txt to import');
      if (!path || !/\.txt$/i.test(path)) { alert('Path must end with .txt'); return; }
      try {
        await rpc('walletpassphrase',[pass,120]);
        await rpc('importwallet',[path]);
        alert('Import started');
      } catch(e){ alert('Import failed'); }
      try{ await rpc('walletlock',[]) }catch(e){}
    });
  }

  function setupLiveTail(){
    var box=q('live-tail'), st=q('start-tail'), sp=q('stop-tail');
    if (!box || !st || !sp || !window.diag) return;
    window.diag.onData(function(line){
      box.classList.remove('empty');
      box.textContent += line;
      box.scrollTop = box.scrollHeight;
    });
    st.addEventListener('click', function(){
      box.classList.remove('empty');
      box.textContent = '';
      window.diag.startTail();
    });
    sp.addEventListener('click', function(){
      window.diag.stopTail();
      if (!box.textContent.trim()) box.classList.add('empty');
    });
  }

  function init(){ setupWalletTools(); setupLiveTail(); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* IOC_WIDGET_TOOLS_MODAL_HOOK */
function __ioc_modal(opts){
  return new Promise(function(res){
    var wrap=document.createElement('div');wrap.style.position='fixed';wrap.style.inset='0';wrap.style.background='rgba(0,0,0,.45)';wrap.style.display='flex';wrap.style.alignItems='center';wrap.style.justifyContent='center';wrap.style.zIndex='9999';
    var box=document.createElement('div');box.style.background='#0B1A33';box.style.border='1px solid #1A3352';box.style.borderRadius='12px';box.style.padding='16px 18px';box.style.minWidth='340px';box.style.boxShadow='0 10px 30px rgba(0,0,0,.55)';
    var h=document.createElement('div');h.textContent=opts&&opts.title?opts.title:'Input';h.style.color='#d9e5ea';h.style.fontWeight='600';h.style.margin='0 0 10px';h.style.textAlign='center';
    var inp=document.createElement('input');inp.type=(opts&&opts.type)||'text';inp.placeholder=(opts&&opts.placeholder)||'';inp.value=(opts&&opts.value)||'';inp.style.width='100%';inp.style.padding='10px';inp.style.borderRadius='8px';inp.style.border='1px solid #1A3352';inp.style.background='#040C1A';inp.style.color='#d9e5ea';
    var row=document.createElement('div');row.style.display='flex';row.style.gap='10px';row.style.marginTop='12px';row.style.justifyContent='center';
    var ok=document.createElement('button');ok.textContent='OK';ok.className='btn';
    var ca=document.createElement('button');ca.textContent='Cancel';ca.className='btn';
    ok.onclick=function(){var v=inp.value;document.body.removeChild(wrap);res(v||null);};
    ca.onclick=function(){document.body.removeChild(wrap);res(null);};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')ok.click();if(e.key==='Escape')ca.click();});
    row.appendChild(ok);row.appendChild(ca);box.appendChild(h);box.appendChild(inp);box.appendChild(row);wrap.appendChild(box);document.body.appendChild(wrap);setTimeout(function(){inp.focus();inp.select&&inp.select();},0);
  });
}
function __ioc_defaultDumpPath(){
  var d=new Date(),y=d.getFullYear(),m=('0'+(d.getMonth()+1)).slice(-2),da=('0'+d.getDate()).slice(-2);
  return '/tmp/ioc-wallet-dump-'+y+m+da+'.txt';
}
async function __ioc_dump(){
  try{
    var pass=await __ioc_modal({title:'Enter wallet passphrase',type:'password',placeholder:'passphrase'}); if(!pass) return;
    var path=await __ioc_modal({title:'Save dump as absolute path (.txt) — no ~',type:'text',value:__ioc_defaultDumpPath()}); if(!path) return;
    if (/^~\//.test(path)) { alert('Use a full absolute path (no ~). Example: '+__ioc_defaultDumpPath()); return; }
    try{ await window.ioc.rpc('walletpassphrase',[pass,300]); }catch(_){}
    try{ await window.ioc.rpc('dumpwalletRT',[path]); }
    catch(e1){
      var msg=''+(e1&&e1.message?e1.message:e1);
      if(/not.*found/i.test(msg)){ await window.ioc.rpc('dumpwallet',[path]); }
      else { alert('Dump failed: '+msg); return; }
    }
    try{ await window.ioc.rpc('walletlock',[]); }catch(_){}
    alert('Dump written to:\n'+path);
  }catch(e){ alert('Dump failed'); }
}
async function __ioc_import(){
  try{
    var path=await __ioc_modal({title:'Absolute path to dump (.txt) — no ~',type:'text',placeholder:'/full/path/to/wallet-dump.txt'});
    if(!path) return;
    if (/^~\//.test(path)) { alert('Use a full absolute path (no ~)'); return; }
    await window.ioc.rpc('importwallet',[path]);
    alert('Import started:\n'+path);
  }catch(e){ alert('Import failed'); }
}
document.addEventListener('DOMContentLoaded',function(){
  var d=document.getElementById('btnDump'); if(d&&!d.__wired){ d.addEventListener('click',function(ev){ev.preventDefault();__ioc_dump();}); d.__wired=1; }
  var i=document.getElementById('btnImport'); if(i&&!i.__wired){ i.addEventListener('click',function(ev){ev.preventDefault();__ioc_import();}); i.__wired=1; }
});
/* END_IOC_WIDGET_TOOLS_MODAL_HOOK */

function __ensureHistoryScroller(){
  const pane = document.querySelector('#history-pane');
  if(!pane) return;
  let scroller = pane.querySelector('.history-scroller');
  if(!scroller){
    const table = pane.querySelector('table');
    if(!table) return;
    scroller = document.createElement('div');
    scroller.className = 'history-scroller';
    const parent = table.parentNode;
    parent.replaceChild(scroller, table);
    scroller.appendChild(table);
  }
  const rect = pane.getBoundingClientRect();
  const available = Math.max(260, window.innerHeight - rect.top - 160);
  scroller.style.maxHeight = available + 'px';
}
window.addEventListener('resize', __ensureHistoryScroller);
document.addEventListener('DOMContentLoaded', __ensureHistoryScroller);
window.addEventListener('hashchange', __ensureHistoryScroller);
new MutationObserver(__ensureHistoryScroller).observe(document.documentElement,{subtree:true,childList:true});

(() => {
  console.log("BACKUP button injector runs here");
})();


/* ===== Wallet Tools layout normalizer ===== */
(() => {
  const normalizeWalletTools = () => {
    // Find the Wallet Tools button row
    const tools =
      document.querySelector('[data-panel="wallet-tools"]') ||
      document.getElementById('wallet-tools') ||
      Array.from(document.querySelectorAll('.panel,.card,.group,.section'))
        .find(el => /wallet\s*tools/i.test(el.textContent || ''));

    if (!tools) return false;

    let row = tools.querySelector('.btn-row');
    if (!row) {
      row = tools.querySelector('div');
    }
    if (!row) return false;

    // Row layout
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'center';
    row.style.gap = '16px';

    // Normalize every button inside Wallet Tools
    const btns = Array.from(row.querySelectorAll('button'));
    btns.forEach(b => {
      b.style.flex = '0 0 auto';   // don't stretch
      b.style.width = 'auto';
      b.style.minWidth = '';       // clear any minWidth left over
      b.style.padding = '6px 16px';
      b.style.margin = '0';
      b.style.boxSizing = 'border-box';
    });

    // Ensure our BACKUP button specifically is not wider than others
    const backup = document.getElementById('backupWalletBtn');
    if (backup) {
      backup.style.flex = '0 0 auto';
      backup.style.width = 'auto';
      backup.style.minWidth = '';
      backup.style.padding = '6px 16px';
    }

    return true;
  };

  // Run now and also when Settings mounts
  if (!normalizeWalletTools()) {
    const mo = new MutationObserver(() => { if (normalizeWalletTools()) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(normalizeWalletTools, 500);
    setTimeout(normalizeWalletTools, 1200);
  }
})();
/// ===== end normalizer =====


(function(){
  if(window.__accentRuntimeInit)return; window.__accentRuntimeInit=true;

  function ensureStyle(){
    if(document.getElementById('accent-style')) return;
    var css = `
:root{--accent:#33A2DA}
.btn,.btn.primary{background:var(--accent) !important;border-color:var(--accent) !important}
.btn:hover{filter:brightness(1.05)}
.tab.is-active,.tab.active{box-shadow:0 0 0 2px var(--accent) inset !important}
.rule-accent,.accent{background:var(--accent) !important}
#syncbar{background:var(--accent) !important}
svg [data-accent="fill"]{fill:var(--accent) !important}
svg [data-accent="stroke"]{stroke:var(--accent) !important}
#accentPick{width:44px;height:32px;border:1px solid var(--border,#1A3352);border-radius:6px;background:#040C1A;padding:0}
.accent-row{display:flex;gap:10px;align-items:center;margin-top:8px}
.theme-card{margin-top:14px}
.theme-card .card-title{font-weight:600;margin-bottom:8px}
`;
    var el = document.createElement('style'); el.id='accent-style'; el.textContent = css; document.head.appendChild(el);
  }

  function setAccent(c){
    document.documentElement.style.setProperty('--accent', c);
    try{ localStorage.setItem('accent', c) }catch(e){}
  }
  function getAccent(){
    try{ return localStorage.getItem('accent') || '' }catch(e){ return '' }
  }

  function injectSettings(){
    var tab = document.getElementById('tab-settings');
    if(!tab || document.getElementById('accentPick')) return;

    var card = document.createElement('div');
    card.className = 'card theme-card';
    card.innerHTML =
      '<div class="card-title">Theme</div>' +
      '<div class="accent-row">' +
        '<input type="color" id="accentPick" value="#33A2DA">' +
        '<button id="accentApply" class="btn">APPLY</button>' +
        '<button id="accentReset" class="btn">RESET</button>' +
      '</div>';

    // Prefer placing after Wallet Tools; else append at end
    var anchor = Array.from(tab.querySelectorAll('.card,.section')).find(x=>{
      return /wallet\s*tools/i.test(x.textContent||'');
    });
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }else{
      tab.appendChild(card);
    }

    var saved = getAccent();
    if(saved){ setAccent(saved); var p=document.getElementById('accentPick'); if(p) p.value=saved; }

    var a = document.getElementById('accentApply');
    if(a){ a.addEventListener('click', function(){
      var v = (document.getElementById('accentPick')||{}).value || '#33A2DA';
      setAccent(v);
    });}
    var r = document.getElementById('accentReset');
    if(r){ r.addEventListener('click', function(){
      setAccent('#33A2DA');
      var p=document.getElementById('accentPick'); if(p) p.value='#33A2DA';
    });}
  }

  // Known teal colors that must be overridden to IOCoin blue
  var TEAL_OVERRIDES = ['#20e0d0','#1fe0d0','#21dfd0','#20dfcf','#22e1d1','#2ae2d4','#14e1d0','#24e0d1','#23e0d1','#1fd6c1','#2da1dd','#00b3a0'];
  var IOCOIN_BLUE = '#33A2DA';

  function init(){
    ensureStyle();
    var saved = getAccent();
    // ALWAYS force IOCoin blue on boot - no exceptions
    // This ensures no stale teal can ever reappear from localStorage
    setAccent(IOCOIN_BLUE);
    // Update picker to match if it exists
    var p = document.getElementById('accentPick');
    if (p) p.value = IOCOIN_BLUE;
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', init, {once:true});
  }else{
    init();
  }
})();


// === Global Accent Recolor (teal -> var(--accent)) ===
(function(){
  if (window.__accentGlobalRecolor) return; window.__accentGlobalRecolor = true;

  // Old teal palette (hex & rgb variants) we want to override
  const TEALS_HEX = new Set([
    '#20e0d0','#1fe0d0','#21dfd0','#20dfcf','#22e1d1','#2ae2d4','#14e1d0',
    '#24e0d1','#23e0d1'
  ].map(s=>s.toLowerCase()));

  // Parse "rgb(...)" or "rgba(...)" to [r,g,b,a]
  function toRGBA(s){
    if(!s) return null;
    s = (''+s).trim().toLowerCase();
    const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/i);
    if(!m) return null;
    return [parseInt(m[1]),parseInt(m[2]),parseInt(m[3]), m[4]==null?1:parseFloat(m[4])];
  }
  function rgbToHex([r,g,b]) {
    return '#' + [r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  // Is “roughly teal”? (tolerance for slight theme variations)
  function approxTeal(r,g,b){
    // target ~ (32,224,208)
    const t = [32,224,208], tol = 20;
    return Math.abs(r-t[0])<=tol && Math.abs(g-t[1])<=tol && Math.abs(b-t[2])<=tol;
  }
  function isTealColor(val) {
    if(!val) return false;
    let v = (''+val).trim().toLowerCase();
    if (TEALS_HEX.has(v)) return true;
    const rgba = toRGBA(v);
    if (rgba){
      const [r,g,b] = rgba;
      if (approxTeal(r,g,b)) return true;
      const hex = rgbToHex([r,g,b]);
      if (TEALS_HEX.has(hex)) return true;
    }
    return false;
  }

  // Box-shadow can carry color strings; replace teal-like pieces
  function normalizeShadow(sh){
    if(!sh) return sh;
    let v = (''+sh);
    // Replace any rgb(a) teal-ish with var(--accent)
    v = v.replace(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[0-9.]+)?\s*\)/gi, (m)=>{
      const rgba = toRGBA(m);
      return (rgba && approxTeal(rgba[0],rgba[1],rgba[2])) ? 'var(--accent)' : m;
    });
    // Replace direct hex teals
    TEALS_HEX.forEach(hex=>{
      v = v.replace(new RegExp(hex,'gi'),'var(--accent)');
    });
    return v;
  }

  // Apply inline overrides to any element that uses teal
  const COLOR_PROPS = [
    'color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor'
  ];
  function recolorElement(el){
    try{
      const cs = getComputedStyle(el);
      let changed = false;

      // Colors
      COLOR_PROPS.forEach(prop=>{
        const val = cs[prop];
        if (isTealColor(val)) {
          el.style[prop] = 'var(--accent)';
          changed = true;
        }
      });

      // Box shadow
      if (cs.boxShadow && /rgb|#/.test(cs.boxShadow)) {
        const replaced = normalizeShadow(cs.boxShadow);
        if (replaced !== cs.boxShadow) {
          el.style.boxShadow = replaced;
          changed = true;
        }
      }

      // SVG: map teal fills/strokes to currentColor, then set color to var(--accent)
      if (el.tagName === 'SVG' || el.querySelector && el.querySelector('svg')){
        const svgs = el.tagName==='SVG' ? [el] : el.querySelectorAll('svg');
        svgs.forEach(svg=>{
          svg.querySelectorAll('*').forEach(n=>{
            const gs = getComputedStyle(n);
            const f = gs.fill, st = gs.stroke;
            if (isTealColor(f)) { n.style.fill = 'currentColor'; svg.style.color='var(--accent)'; changed=true; }
            if (isTealColor(st)) { n.style.stroke = 'currentColor'; svg.style.color='var(--accent)'; changed=true; }
          });
        });
      }

      return changed;
    }catch(e){ return false; }
  }

  function walk(root){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node = root.nodeType===1 ? root : walker.nextNode();
    if(root.nodeType===1) recolorElement(root);
    while(node = walker.nextNode()){
      recolorElement(node);
    }
  }

  function recolorAll(){ walk(document.body || document); }

  // Observe future DOM changes so new nodes get the accent too
  const mo = new MutationObserver((muts)=>{
    for(const m of muts){
      for(const n of m.addedNodes){
        if (n.nodeType===1) walk(n);
      }
    }
  });

  if (document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', ()=>{
      recolorAll();
      try{ mo.observe(document.body, {childList:true, subtree:true}); }catch(e){}
    }, {once:true});
  } else {
    recolorAll();
    try{ mo.observe(document.body, {childList:true, subtree:true}); }catch(e){}
  }
})();





/* ===== BACKUP button injector (clean, single handler, no status text) ===== */
(()=>{ if(window.__IOC_BACKUP_ONE) return; window.__IOC_BACKUP_ONE = true;
  const getInvoke = () => (
    (window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.invoke) ? window.electron.ipcRenderer.invoke.bind(window.electron.ipcRenderer)
    : (window.api && window.api.invoke) ? window.api.invoke.bind(window.api)
    : null
  );
  function install(){
    const panel = document.querySelector('[data-panel="wallet-tools"]') || document;
    const btns  = Array.from(panel.querySelectorAll('button,.btn'));
    const open  = btns.find(b => ((b.textContent||'').trim().toUpperCase())==='IOC FOLDER')
               || btns.find(b => /OPEN DEFAULT PATH/i.test(b.textContent||''));
    if(!open) return false;

    let bak = document.getElementById('backupWalletBtn');
    if(!bak){
      bak = document.createElement('button');
      bak.id = 'backupWalletBtn';
      bak.className = open.className || 'btn';
      bak.textContent = 'BACKUP';
      open.parentElement && open.parentElement.insertBefore(bak, open.nextSibling);
    }
    if(bak.__wired) return true;
    bak.__wired = true;
    bak.addEventListener('click', async (e)=>{
      e.preventDefault();
      const invoke = getInvoke(); if(!invoke) return;
      bak.disabled = true;
      try { await invoke('ioc:wallet:backup'); } finally { bak.disabled = false; }
    }, true);
    return true;
  }
  if(!install()){
    const mo = new MutationObserver(()=>{ if(install()) mo.disconnect(); });
    mo.observe(document.documentElement, {childList:true, subtree:true});
  }
})();
/// ===== end injector =====



// /* HISTORY_AMT_ALIGN */
document.addEventListener('DOMContentLoaded', function(){
  try{
    var s=document.createElement('style');
    s.textContent = '.tx-amt{text-align:right;min-width:64px;padding-right:8px;} .tx-when{padding-right:10px;} .tx-addr{word-break:break-all;}';
    document.head.appendChild(s);
  }catch(_){}
});


/* --- History table layout (When | Amount | Address/Txid) --- */
function ensureHistoryLayout(){
  try{
    const tbody = document.getElementById('txrows'); if(!tbody) return;
    const table = tbody.closest('table'); if(!table) return;

    // Inject styles once
    if(!document.getElementById('hist-col-style')){
      const css = `
        /* history table: fix column widths + right-align numbers + let addresses show fully */
        #tab-history table col.when { width: 240px; }     /* Date/Time */
        #tab-history table col.amt  { width: 90px; }      /* Amount   */
        #tab-history td.num { text-align: right; padding-right: 12px; }
        #tab-history td.addr {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          white-space: nowrap; overflow: visible; text-overflow: unset;
        }
      `;
      const st = document.createElement('style');
      st.id = 'hist-col-style'; st.textContent = css;
      document.head.appendChild(st);
    }

    // Add a colgroup that locks the first two column widths; address flexes
    if(!table.querySelector('colgroup')){
      const cg = document.createElement('colgroup');
      const c1 = document.createElement('col'); c1.className = 'when';
      const c2 = document.createElement('col'); c2.className = 'amt';
      const c3 = document.createElement('col'); // address/txid takes remaining width
      cg.appendChild(c1); cg.appendChild(c2); cg.appendChild(c3);
      table.insertBefore(cg, table.firstChild);
    }
  }catch(_){}
}

// === History table (When / Amount / Address) ===
async function loadHistory() {
  try {
    const rows = await window.ioc.listTx(50);
    const tbody = document.getElementById('txrows');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Newest-first (sort by timereceived/time descending)
    const sorted = (rows || []).slice().sort((a, b) => ((b.timereceived ?? b.time) || 0) - ((a.timereceived ?? a.time) || 0));
    sorted.forEach(t => {
      const tr = document.createElement('tr');
      const when = new Date(((t.timereceived ?? t.time) || 0) * 1000).toLocaleString();
      const amt  = Number(t.amount || 0);

      const addr = (t.address || t.txid || '').toString();

      tr.innerHTML = `
        <td class="c-when">${when}</td>
        <td class="c-amt">${amt}</td>
        <td class="c-addr" title="${addr}">${addr}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (_) {
    // no-op; keep UI responsive even if daemon isn't ready
  }
}

// One-time CSS for history column widths/alignment
(() => {
  if (document.getElementById('history-cols-style')) return;
  const css = `
    #history-pane table { table-layout: fixed; width: 100%; }
    #history-pane th, #history-pane td { padding: 10px 12px; }
    /* column widths: When ~38%, Amount ~12%, Address gets the rest */
    #history-pane thead th:nth-child(1),
    #history-pane tbody td.c-when { width: 38%; text-align: left; }
    #history-pane thead th:nth-child(2),
    #history-pane tbody td.c-amt  { width: 12%; text-align: right; }
    #history-pane thead th:nth-child(3),
    #history-pane tbody td.c-addr { width: 50%; text-align: left; white-space: nowrap; overflow: visible; text-overflow: clip; }
  `;
  const el = document.createElement('style');
  el.id = 'history-cols-style';
  el.textContent = css;
  document.head.appendChild(el);
})();
;(function(){
  try{
    if(document.getElementById('history-align-patch')) return;
    const st = document.createElement('style');
    st.id = 'history-align-patch';
    st.textContent = `
      section[data-panel="history"] table th,
      section[data-panel="history"] table td{
        text-align: left !important;
      }
      /* Address / Txid is the 3rd column after removing Type */
      section[data-panel="history"] table td:nth-child(3),
      section[data-panel="history"] table th:nth-child(3){
        text-align: left !important;
        white-space: normal !important;
        word-break: break-all !important;
        overflow: visible !important;
        text-overflow: clip !important;
        max-width: none !important;
      }
    `;
    document.addEventListener('DOMContentLoaded', ()=>document.head.appendChild(st));
  }catch(_){}
})();
;(function(){
  try{
    if(document.getElementById('history-realalign-v2')) return;
    const st = document.createElement('style');
    st.id = 'history-realalign-v2';
    st.textContent = `
      /* Make the history table fill the panel and align left */
      section[data-panel="history"] table{
        width:100% !important;
        table-layout:auto !important;
        margin:0 !important;
      }
      /* Left-align everything and reduce heavy left padding */
      section[data-panel="history"] table th,
      section[data-panel="history"] table td{
        text-align:left !important;
        padding-left:12px !important;
        padding-right:12px !important;
        white-space:normal !important;
        overflow:visible !important;
        text-overflow:clip !important;
        max-width:none !important;
      }
      /* Allocate widths: When ~260px, Amount ~80px, Address takes the rest */
      section[data-panel="history"] table th:nth-child(1),
      section[data-panel="history"] table td:nth-child(1){ width:260px !important; }
      section[data-panel="history"] table th:nth-child(2),
      section[data-panel="history"] table td:nth-child(2){ width:80px !important; }
      section[data-panel="history"] table th:nth-child(3),
      section[data-panel="history"] table td:nth-child(3){
        width:auto !important;
        white-space:normal !important;
        word-break:break-all !important;   /* show full address/txid by wrapping */
      }
    `;
    const mount = () => document.head.appendChild(st);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once:true });
    } else { mount(); }
  }catch(_){}
})();
/* history-force-left-v3: robust column control for History table */
;(function(){
  const ID = 'history-force-left-v3';
  if (window[ID]) return; window[ID] = true;

  function findHistoryTable(){
    // Look for a heading that says "History", then grab the first table inside same card/container.
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,.title,.card-title'));
    const histHead = headings.find(h => /history/i.test(h.textContent || ''));
    if(!histHead) return null;
    // Walk up to the card/container
    let card = histHead.closest('.card, section, div');
    if(!card) card = histHead.parentElement;
    if(!card) return null;
    const tbl = card.querySelector('table');
    return tbl || null;
  }

  function ensureColgroup(table){
    // Remove any previous colgroup we added
    const old = table.querySelector('colgroup[data-history-cols]');
    if (old) old.remove();
    const cg = document.createElement('colgroup');
    cg.setAttribute('data-history-cols','');
    // When ~260px, Amount ~80px, Address auto (fills remaining)
    const cWhen = document.createElement('col');   cWhen.style.width = '260px';
    const cAmt  = document.createElement('col');   cAmt.style.width  = '80px';
    const cAddr = document.createElement('col');   cAddr.style.width = 'auto';
    cg.append(cWhen, cAmt, cAddr);
    table.prepend(cg);
  }

  function leftAlign(table){
    table.style.width = '100%';
    table.style.tableLayout = 'auto';
    table.style.margin = '0';

    const cells = table.querySelectorAll('th,td');
    cells.forEach(el => {
      el.style.textAlign   = 'left';
      el.style.paddingLeft = '12px';
      el.style.paddingRight= '12px';
      el.style.whiteSpace  = 'normal';
      el.style.overflow    = 'visible';
      el.style.textOverflow= 'clip';
      el.style.maxWidth    = 'none';
      el.style.wordBreak   = 'break-all'; // long address/txid wraps
    });
  }

  function normalizeHeaders(table){
    const ths = Array.from(table.querySelectorAll('thead th'));
    // If headers exist and still include a stray "Type", remove that column from DOM
    const typeIdx = ths.findIndex(th => /type/i.test(th.textContent||''));
    if (typeIdx >= 0){
      // remove header + matching td in each row
      ths[typeIdx].remove();
      table.querySelectorAll('tbody tr').forEach(tr=>{
        const tds = tr.querySelectorAll('td');
        if (tds[typeIdx]) tds[typeIdx].remove();
      });
    }
    // If headers are fewer than 3, we can't assign widths reliably
    // but we still try to left-align.
  }

  function apply(){
    const table = findHistoryTable();
    if(!table) return;
    normalizeHeaders(table);
    ensureColgroup(table);
    leftAlign(table);
  }

  const run = ()=>{ try{ apply(); }catch(e){} };

  // Initial + DOM readiness
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else { run(); }

  // Keep it sticky across resizes, tab switches, or live updates
  window.addEventListener('resize', run);
  window.addEventListener('hashchange', run);
  new MutationObserver(()=>run()).observe(document.documentElement, {subtree:true, childList:true});
})();
/* history-columns-v4: force 3-column History and remove "Type" */
;(function(){
  const ID='history-columns-v4';
  if (window[ID]) return; window[ID]=true;

  function findHistoryTable(){
    // Prefer tables whose header cells contain When/Amount
    const tables=[...document.querySelectorAll('table')];
    for (const tbl of tables){
      const ths=[...tbl.querySelectorAll('thead th')].map(th=>th.textContent.trim().toLowerCase());
      if (ths.length && ths.some(t=>t.includes('when')) && ths.some(t=>t.includes('amount'))) {
        return tbl;
      }
    }
    // Fallback: heading "History" then first table under same card
    const head=[...document.querySelectorAll('h1,h2,h3,h4,h5,.title,.card-title')].find(h=>/history/i.test(h.textContent||''));
    if(head){
      const card=head.closest('.card, section, div')||head.parentElement;
      if(card){ const t=card.querySelector('table'); if(t) return t; }
    }
    return null;
  }

  function removeTypeColumn(table){
    const ths=[...table.querySelectorAll('thead th')];
    const idx=ths.findIndex(th=>/^\s*type\s*$/i.test(th.textContent||''));
    if(idx>=0){
      ths[idx].remove();
      table.querySelectorAll('tbody tr').forEach(tr=>{
        const cells=tr.querySelectorAll('td');
        if(cells[idx]) cells[idx].remove();
      });
    }
  }

  function installStyleOnce(){
    if(document.getElementById('history-columns-v4-style')) return;
    const css=`
      /* Force layout & left alignment, show full address (wrap if needed) */
      table[data-history-forced]{
        table-layout:fixed !important;
        width:100% !important;
        border-collapse:separate !important;
      }
      table[data-history-forced] thead th,
      table[data-history-forced] tbody td{
        text-align:left !important;
        padding-left:12px !important;
        padding-right:12px !important;
        white-space:normal !important;
        overflow:visible !important;
        text-overflow:clip !important;
        max-width:none !important;
        word-break:break-all !important; /* ensures long base58 wraps */
      }
      /* Column widths: When ~260px, Amount ~80px (right-aligned), Address fills */
      table[data-history-forced] thead th:nth-child(1),
      table[data-history-forced] tbody td:nth-child(1){
        width:260px !important; white-space:nowrap !important;
      }
      table[data-history-forced] thead th:nth-child(2),
      table[data-history-forced] tbody td:nth-child(2){
        width:80px !important; text-align:right !important; white-space:nowrap !important;
      }
      table[data-history-forced] thead th:nth-child(3),
      table[data-history-forced] tbody td:nth-child(3){
        width:auto !important;
      }
      /* Kill common truncation classes if present */
      table[data-history-forced] .truncate,
      table[data-history-forced] .ellipsis{
        overflow:visible !important; text-overflow:clip !important; white-space:normal !important; max-width:none !important;
      }
    `.replace(/\s+/g,' ');
    const style=document.createElement('style');
    style.id='history-columns-v4-style';
    style.textContent=css;
    document.head.appendChild(style);
  }

  function apply(){
    installStyleOnce();
    const tbl=findHistoryTable();
    if(!tbl) return;
    removeTypeColumn(tbl);
    // Mark and enforce 3 columns by ensuring exactly 3 header cells
    tbl.setAttribute('data-history-forced','1');

    // If headers aren’t exactly 3 (e.g., extra blank th), trim to 3
    const ths=[...tbl.querySelectorAll('thead th')];
    if (ths.length>3){
      // keep When, Amount, Address columns by position heuristics:
      // Find the first th that matches /when/i, first matching /amount/i, and last one for address
      const when = ths.find(th=>/when/i.test(th.textContent||'')) || ths[0];
      const amt  = ths.find(th=>/amount/i.test(th.textContent||'')) || ths[1] || ths[0];
      const addr = ths.find(th=>/addr|tx/i.test(th.textContent||'')) || ths[2] || ths[ths.length-1];
      const keep=[when,amt,addr];
      ths.forEach(th=>{ if(!keep.includes(th)) th.remove(); });
      // remove matching body cells by index gaps
      const idxs = keep.map(k=>[...k.parentElement.children].indexOf(k));
      tbl.querySelectorAll('tbody tr').forEach(tr=>{
        const tds=[...tr.children];
        tds.forEach((td,i)=>{ if(!idxs.includes(i)) td.remove(); });
      });
    }
  }

  const run=()=>{ try{ apply(); }catch(_){} };
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', run, {once:true}); } else { run(); }
  window.addEventListener('hashchange', run);
  window.addEventListener('resize', run);
  new MutationObserver(()=>run()).observe(document.documentElement,{subtree:true, childList:true});
})();

// --- begin: enforced History column layout (id=history-columns) ---
(function historyColumnsInstaller(){
  function ensureHistoryColumns(){
    try{
      // remove older injections if any
      for (const id of ['history-columns','amount-left-tight']) {
        const old = document.getElementById(id); if (old) old.remove();
      }
      const s = document.createElement('style');
      s.id = 'history-columns';
      s.textContent = `
        /* Lock table width rules for History only */
        #history table, .history table { table-layout: fixed !important; width: 100% !important; }

        /* Normalize cell padding */
        #history table th, #history table td,
        .history table th, .history table td { padding: 6px 8px !important; }

        /* Column 1: When (fit the timestamp, left aligned) */
        #history table th:nth-child(1), #history table td:nth-child(1),
        .history table th:nth-child(1), .history table td:nth-child(1) {
          width: 200px !important; min-width: 200px !important; max-width: 220px !important;
          text-align: left !important;
        }

        /* Column 2: Amount (make very narrow, left aligned) */
        #history table th:nth-child(2), #history table td:nth-child(2),
        .history table th:nth-child(2), .history table td:nth-child(2) {
          width: 56px !important; min-width: 48px !important; max-width: 64px !important;
          text-align: left !important; padding-left: 4px !important; padding-right: 4px !important;
        }

        /* Column 3: Address / Txid (take everything else, wrap nicely) */
        #history table th:nth-child(3), #history table td:nth-child(3),
        .history table th:nth-child(3), .history table td:nth-child(3) {
          width: calc(100% - 256px) !important;   /* 200 (when) + ~56 (amount) */
          white-space: normal !important;          /* allow multi-line */
          word-break: break-word !important;       /* wrap long strings */
          overflow: visible !important;
          text-align: left !important;
        }
      `;
      document.head.appendChild(s);
    }catch(e){ console.warn('History column styler skipped:', e); }
  }
  document.addEventListener('DOMContentLoaded', ensureHistoryColumns);
  window.addEventListener('hashchange', ensureHistoryColumns);
  // In case History is already rendered
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    requestAnimationFrame(ensureHistoryColumns);
  }
})();
// --- end: enforced History column layout ---

// ===== History table colgroup enforcer (id: hist-colgroup-enforcer) =====
(function installHistColgroupEnforcer(){
  const ID = 'hist-colgroup-enforcer';
  if (window[ID]) return; // avoid double-install
  window[ID] = true;

  function headerText(th){ return (th?.textContent || '').trim().toLowerCase(); }
  function looksLikeHistoryTable(tbl){
    const ths = tbl.querySelectorAll('thead th');
    if (!ths.length) return false;
    let names = Array.from(ths).map(headerText);
    // accept "address" or "address / txid" style headers
    const hasWhen   = names.some(t => t.startsWith('when'));
    const hasAmount = names.some(t => t.startsWith('amount'));
    const hasAddr   = names.some(t => t.startsWith('address'));
    return hasWhen && hasAmount && hasAddr;
  }

  function applyColgroup(tbl){
    if (!tbl || tbl.__histColsApplied) return;

    // Ensure table layout is fixed so col widths are respected
    tbl.style.tableLayout = 'fixed';
    tbl.style.width = '100%';

    // Remove any previous colgroup we added
    const old = tbl.querySelector('colgroup[data-hist="1"]');
    if (old) old.remove();

    const cg = document.createElement('colgroup');
    cg.setAttribute('data-hist','1');

    const cWhen   = document.createElement('col');
    const cAmount = document.createElement('col');
    const cAddr   = document.createElement('col');

    cWhen.style.width   = '200px';
    cWhen.style.minWidth= '200px';
    cAmount.style.width = '64px';
    cAmount.style.minWidth = '56px';
    cAddr.style.width   = 'auto';

    cg.append(cWhen, cAmount, cAddr);
    tbl.insertBefore(cg, tbl.firstChild);

    // Force left align on amount, wrap address
    const rows = tbl.querySelectorAll('tbody tr');
    rows.forEach(tr=>{
      const tds = tr.children;
      if (tds[1]) {
        tds[1].style.textAlign = 'left';
        tds[1].style.paddingLeft = '4px';
        tds[1].style.paddingRight= '4px';
      }
      if (tds[2]) {
        Object.assign(tds[2].style, {
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          overflow: 'visible',
          textAlign: 'left'
        });
      }
    });

    // Header alignment to match
    const ths = tbl.querySelectorAll('thead th');
    if (ths[1]) ths[1].style.textAlign = 'left';
    if (ths[2]) ths[2].style.textAlign = 'left';

    tbl.__histColsApplied = true;
  }

  function scan(){
    document.querySelectorAll('table').forEach(tbl=>{
      if (looksLikeHistoryTable(tbl)) applyColgroup(tbl);
    });
  }

  // Run now & on view changes/renders
  const kickoff = ()=> requestAnimationFrame(scan);
  document.addEventListener('DOMContentLoaded', kickoff);
  window.addEventListener('hashchange', kickoff);
  new MutationObserver(() => { scan(); }).observe(document.documentElement, {subtree:true, childList:true});

  // If already interactive, apply once immediately
  if (document.readyState !== 'loading') kickoff();
})();
 // ===== end history colgroup enforcer =====

(function(){
  if(document.getElementById("history-col-tune")) return;
  const s=document.createElement("style");
  s.id="history-col-tune";
  s.textContent=`
    .history-table th, .history-table td { vertical-align: middle; }
    .history-table .col-amount { width:44px; text-align:left; }
    .history-table td.col-amount, .history-table th.col-amount { text-align:left; }
    .history-table .col-address { min-width:420px; }
  `;
  document.addEventListener("DOMContentLoaded",()=>document.head.appendChild(s));
})();

// __HIST_COL_FIX__: keep history columns readable without touching daemon/render logic.
(() => {
  const css = `
    /* Scope to the History view only */
    #history table { table-layout: fixed; width: 100%; }

    /* Amount column (2nd): narrower and left-aligned */
    #history table thead th:nth-child(2),
    #history table tbody td:nth-child(2) {
      width: 76px;         /* compact */
      padding-left: 8px;   /* nudge left */
      text-align: left;    /* no right centering */
      white-space: nowrap;
    }

    /* Address / Txid column (3rd): use the rest, avoid wrapping */
    #history table thead th:nth-child(3),
    #history table tbody td:nth-child(3) {
      padding-left: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `.trim();

  const style = document.createElement('style');
  style.setAttribute('data-tag', '__HIST_COL_FIX__');
  style.textContent = css;
  document.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(style);
  });
})();

// __HIST_FONT_FIX__: adjust font size + column widths for History table
(() => {
  const css = `
    #history table {
      table-layout: fixed;
      width: 100%;
      font-size: 12px; /* smaller font */
    }
    /* Amount column */
    #history table thead th:nth-child(2),
    #history table tbody td:nth-child(2) {
      width: 76px;
      padding-left: 8px;
      text-align: left;
      white-space: nowrap;
    }
    /* Address / Txid column */
    #history table thead th:nth-child(3),
    #history table tbody td:nth-child(3) {
      padding-left: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `.trim();

  const style = document.createElement('style');
  style.setAttribute('data-tag', '__HIST_FONT_FIX__');
  style.textContent = css;
  document.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(style);
  });
})();
;(function(){
  if (window['topbar-static-v1']) return; window['topbar-static-v1']=true;

  function pickHeader(){
    return document.querySelector('header,[role="banner"],.topbar,.navbar,.app-header,.header');
  }
  function pickMain(hdr){
    if (!hdr) return null;
    const p = hdr.parentElement;
    const next = hdr.nextElementSibling;
    if (next) return next;
    if (p && p.children.length>1) return p.children[1];
    return document.querySelector('main,.main,.content,#content,.app-content') || p;
  }
  function apply(){
    const hdr = pickHeader(); if(!hdr) return;
    const main = pickMain(hdr); if(!main) return;

    hdr.style.position = 'sticky';
    hdr.style.top = '0';
    hdr.style.zIndex = '1000';
    if (!getComputedStyle(hdr).backgroundColor || getComputedStyle(hdr).backgroundColor==='rgba(0, 0, 0, 0)'){
      hdr.style.background = 'var(--bg, #040C1A)';
    }

    const h = Math.ceil(hdr.getBoundingClientRect().height) || 64;
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const targetH = Math.max(200, vh - h) + 'px';

    main.style.height = targetH;
    main.style.maxHeight = targetH;
    main.style.overflowY = 'auto';
    main.style.overflowX = 'hidden';

    document.querySelectorAll('section[data-panel], .tab-panel, .pane, .card-body').forEach(el=>{
      if (el === hdr) return;
      if (el.closest('header,[role="banner"],.topbar,.navbar,.app-header,.header')) return;
      el.style.overflowY = el.style.overflowY || 'auto';
      el.style.maxHeight = el.style.maxHeight || '100%';
    });
  }

  const run = ()=>{ try{ apply(); }catch(e){} };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
  window.addEventListener('resize', run);
  window.addEventListener('hashchange', run);
  new MutationObserver(()=>run()).observe(document.documentElement,{subtree:true,childList:true});
})();
// FIXED_TOP_SCROLL_V2
(function(){
  const ID='fixed-top-scroll-v2'; if (window[ID]) return; window[ID]=true;

  // Inject high-specificity CSS once
  if (!document.getElementById('fixed-top-scroll-style')) {
    const st = document.createElement('style'); st.id='fixed-top-scroll-style';
    st.textContent = `
      html, body { height:100% !important; overflow:hidden !important; }
      header, [role="banner"], .topbar, .navbar, .app-header, .header {
        position: sticky !important; top: 0 !important; z-index: 1000 !important;
        /* ensure the bar paints over content */
        background: var(--hdr-bg, rgba(0,0,0,0.8)) !important;
        backdrop-filter: saturate(120%) blur(0.5px);
      }
      /* Only the chosen region scrolls */
      .__ioc_scroll_region__ {
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        height: calc(100vh - var(--hdrH, 64px)) !important;
        max-height: calc(100vh - var(--hdrH, 64px)) !important;
      }
      /* Prevent nested panes from introducing second scrollbars */
      .__ioc_scroll_region__ .pane, 
      .__ioc_scroll_region__ .tab-panel,
      .__ioc_scroll_region__ .card-body {
        overscroll-behavior: contain;
        max-height: none !important;
        overflow: visible !important;
      }
    `;
    document.head.appendChild(st);
  }

  function pickHeader(){
    return document.querySelector('header,[role="banner"],.topbar,.navbar,.app-header,.header');
  }

  function pickScrollRegion(hdr){
    if (!hdr) return null;
    // Prefer the immediate sibling after header
    let cand = hdr.nextElementSibling;
    // Fallbacks if layout nests content deeper
    const fbs = [
      cand,
      document.querySelector('main'),
      document.querySelector('#content'),
      document.querySelector('.content'),
      document.querySelector('.app-content'),
      document.querySelector('.container'),
      document.querySelector('section[data-panel]')?.parentElement
    ].filter(Boolean);
    // Choose the first element that is not the header and is displayed
    return fbs.find(el => el && el !== hdr && getComputedStyle(el).display !== 'none') || null;
  }

  function apply(){
    const hdr = pickHeader(); if (!hdr) return;
    const H = Math.ceil(hdr.getBoundingClientRect().height) || 64;
    document.documentElement.style.setProperty('--hdrH', H + 'px');
    // Ensure header paints solid background (avoid transparency over content)
    const bg = getComputedStyle(hdr).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') {
      hdr.style.setProperty('--hdr-bg', '#040C1A');
    }

    const region = pickScrollRegion(hdr);
    if (!region) return;

    // Make ONLY this region scroll
    region.classList.add('__ioc_scroll_region__');

    // Ensure ancestors don’t re-enable scrolling on body
    document.body.style.overflow = 'hidden';

    // Remove overflow from nested containers that might fight our rule
    region.querySelectorAll('[style*="overflow"]').forEach(el=>{
      // Keep explicit component behaviors; just avoid global y-scrolls on wrappers
      if (/(auto|scroll)/i.test(el.style.overflowY)) {
        el.style.overflowY = '';
      }
    });
  }

  const run = () => { try { apply(); } catch {} };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  window.addEventListener('resize', run);
  window.addEventListener('hashchange', run);
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
// FIXED_PANES_SCROLL_V3
(function(){
  const ID='FIXED_PANES_SCROLL_V3'; if (window[ID]) return; window[ID]=true;

  // High-specificity CSS: fixed header; content root fills viewport minus header; panes scroll inside.
  function injectCSS(){
    if (document.getElementById('fixed-panes-style')) return;
    const st = document.createElement('style'); st.id='fixed-panes-style';
    st.textContent = `
      /* Header stays fixed */
      header, [role="banner"], .topbar, .navbar, .app-header, .header {
        position: sticky !important;
        top: 0 !important;
        z-index: 1000 !important;
        background: var(--hdr-bg, rgba(0,0,0,0.85)) !important;
      }
      /* Root content area under header: owns layout height; not scrollable itself */
      .__ioc-content {
        position: relative !important;
        height: calc(100vh - var(--hdrH, 64px)) !important;
        max-height: calc(100vh - var(--hdrH, 64px)) !important;
        overflow: hidden !important;
      }
      /* Each pane (Overview/History/Settings): fills content area and scrolls */
      .__ioc-content > section[data-panel],
      .__ioc-content > .tab-panel,
      .__ioc-content > .pane,
      .__ioc-content > .card-body,
      .__ioc-pane {
        height: 100% !important;
        max-height: 100% !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
      }
      /* Prevent nested containers from re-introducing page scrollbars */
      html, body {
        height: 100% !important;
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(st);
  }

  function pickHeader(){
    return document.querySelector('header,[role="banner"],.topbar,.navbar,.app-header,.header');
  }

  function pickContentRoot(hdr){
    if (!hdr) return null;
    // Prefer the immediate sibling under the header
    let root = hdr.nextElementSibling;
    // Robust fallbacks if layout differs
    if (!root || getComputedStyle(root).display === 'none') {
      root = document.querySelector('main,#content,.content,.app-content,.container,.page,.body');
    }
    // As a last resort, try the header's parent (minus header)
    if (!root && hdr.parentElement && hdr.parentElement.children.length > 1) {
      root = hdr.parentElement.children[1];
    }
    return root || null;
  }

  function tagPanes(root){
    // Mark the root
    root.classList.add('__ioc-content');

    // Ensure direct panes are scrollable
    const directPanes = root.querySelectorAll(':scope > section[data-panel], :scope > .tab-panel, :scope > .pane, :scope > .card-body');
    if (directPanes.length) {
      directPanes.forEach(el => el.classList.add('__ioc-pane'));
    } else {
      // If panes are nested one level deeper (common), tag them too
      const nested = root.querySelectorAll('section[data-panel], .tab-panel, .pane, .card-body');
      nested.forEach(el => el.classList.add('__ioc-pane'));
    }
  }

  function apply(){
    injectCSS();

    const hdr = pickHeader();
    if (!hdr) return;

    // Measure header height and expose it as CSS var
    const H = Math.max(48, Math.ceil(hdr.getBoundingClientRect().height) || 64);
    document.documentElement.style.setProperty('--hdrH', H + 'px');

    // Ensure header has a solid background behind it
    const bg = getComputedStyle(hdr).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') {
      hdr.style.setProperty('--hdr-bg', '#040C1A');
    }

    const root = pickContentRoot(hdr);
    if (!root) return;

    tagPanes(root);
  }

  const run = () => { try { apply(); } catch(e){} };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
  window.addEventListener('resize', run);
  window.addEventListener('hashchange', run);
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
// IOC_SCROLL_WRAPPER_V1
(function(){
  const KEY='IOC_SCROLL_WRAPPER_V1'; if (window[KEY]) return; window[KEY]=true;

  function getHeader(){
    return document.querySelector('header,[role="banner"],.topbar,.navbar,.app-header,.header');
  }

  function makeStickyHeader(hdr){
    hdr.style.position = 'sticky';
    hdr.style.top = '0';
    hdr.style.zIndex = '1000';
    // ensure it paints (avoid transparent overlap)
    const bg = getComputedStyle(hdr).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') hdr.style.background = '#040C1A';
  }

  function ensureScrollContainer(hdr){
    let sc = document.getElementById('ioc-scroll-container');
    if (!sc){
      sc = document.createElement('div');
      sc.id = 'ioc-scroll-container';
      sc.style.overflowY = 'auto';
      sc.style.overflowX = 'hidden';
      sc.style.webkitOverflowScrolling = 'touch';
      sc.style.position = 'relative';

      const parent = hdr.parentNode;
      // insert right after header
      if (hdr.nextSibling) parent.insertBefore(sc, hdr.nextSibling);
      else parent.appendChild(sc);

      // move all nodes after header into the scroll container
      let n = sc.nextSibling; // after inserting, sc is after header
      while (n){
        const next = n.nextSibling;
        sc.appendChild(n);
        n = next;
      }
    }
    return sc;
  }

  function resize(sc, hdr){
    const H = Math.ceil(hdr.getBoundingClientRect().height) || 64;
    sc.style.height = `calc(100vh - ${H}px)`;
    sc.style.maxHeight = `calc(100vh - ${H}px)`;
  }

  function apply(){
    const hdr = getHeader();
    if (!hdr) return;
    makeStickyHeader(hdr);
    const sc = ensureScrollContainer(hdr);
    resize(sc, hdr);

    // lock page scroll; only container scrolls
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  const run = ()=>{ try{ apply(); }catch(e){} };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once:true });
  } else {
    run();
  }
  window.addEventListener('resize', run);
  window.addEventListener('hashchange', run);
  new MutationObserver(run).observe(document.documentElement, {subtree:true, childList:true});
})();
// IOC_SCROLL_TABS_V1
(function(){
  const KEY='IOC_SCROLL_TABS_V1'; if (window[KEY]) return; window[KEY]=true;

  const targetTabs = ['history', 'address', 'settings'];

  function getHeader(){
    return document.querySelector('header,[role="banner"],.topbar,.navbar,.app-header,.header');
  }

  function makeStickyHeader(hdr){
    hdr.style.position = 'sticky';
    hdr.style.top = '0';
    hdr.style.zIndex = '1000';
    const bg = getComputedStyle(hdr).backgroundColor;
    if (!bg || bg === 'rgba(0, 0, 0, 0)') hdr.style.background = '#040C1A';
  }

  function ensureScrollContainer(pane){
    let sc = pane.querySelector('.ioc-scroll-container');
    if (!sc){
      sc = document.createElement('div');
      sc.className = 'ioc-scroll-container';
      sc.style.overflowY = 'auto';
      sc.style.overflowX = 'hidden';
      sc.style.webkitOverflowScrolling = 'touch';
      sc.style.position = 'relative';
      sc.style.height = '100%';
      sc.style.maxHeight = '100%';

      while (pane.firstChild) {
        sc.appendChild(pane.firstChild);
      }
      pane.appendChild(sc);
    }
    return sc;
  }

  function resizeScroll(pane){
    const hdr = getHeader();
    if (!hdr) return;
    const sc = ensureScrollContainer(pane);
    const H = Math.ceil(hdr.getBoundingClientRect().height) || 64;
    sc.style.height = `calc(100vh - ${H}px)`;
    sc.style.maxHeight = `calc(100vh - ${H}px)`;
  }

  function apply(){
    const activeTab = (location.hash || '').replace('#','').toLowerCase();
    if (!targetTabs.includes(activeTab)) return;
    const hdr = getHeader();
    if (hdr) makeStickyHeader(hdr);
    const pane = document.querySelector(`[data-tab="${activeTab}"]`) || document.querySelector(`#${activeTab}`);
    if (pane) resizeScroll(pane);
  }

  window.addEventListener('hashchange', apply);
  window.addEventListener('resize', apply);
  document.addEventListener('DOMContentLoaded', apply);
  new MutationObserver(apply).observe(document.body,{subtree:true,childList:true});
})();
// --- Generic pane scroller (keeps top bar static, scrolls inside each pane) ---
(function(){
  if (window.__IOC_PANE_SCROLLER__) return; window.__IOC_PANE_SCROLLER__ = true;

  function ensureOnePaneScroller(pane){
    if (!pane) return;

    // We keep the first heading (H2/H3 with the pane title) above the scroller.
    // All other siblings become scrollable content.
    let scroller = pane.querySelector(':scope > .pane-scroller');
    if (!scroller){
      scroller = document.createElement('div');
      scroller.className = 'pane-scroller';

      // Pick a stable header node if present
      const header = Array.from(pane.children).find(n=>{
        if (!n || n.nodeType!==1) return false;
        const tag = (n.tagName||'').toUpperCase();
        if (tag==='H1' || tag==='H2' || tag==='H3') return true;
        // Some themes use a title div; keep anything that literally says History / Wallet Tools / Address / Settings at the top.
        const txt = (n.textContent||'').trim().toLowerCase();
        return /^history$|wallet\s*tools|address\s*book|settings/.test(txt);
      });

      // Move the rest of the nodes into the scroller, keep header in place
      const kids = Array.from(pane.children);
      kids.forEach(k=>{
        if (k!==header) scroller.appendChild(k);
      });
      pane.appendChild(scroller);
    }

    // Compute max height available under the pane's top
    const rect = pane.getBoundingClientRect();
    // Space to keep for bottom shadow/margins
    const bottomPad = 32;
    let maxH = window.innerHeight - rect.top - bottomPad;
    if (maxH < 180) maxH = 180;

    scroller.style.maxHeight = Math.floor(maxH) + 'px';
  }

  function ensureAll(){
    // Work on all visible pages (tabs)
    const panes = document.querySelectorAll('.page:not(.hidden)');
    if (!panes.length) return;
    panes.forEach(ensureOnePaneScroller);
  }

  // Run now and on layout mutations
  const kick = ()=>{ try { ensureAll(); } catch(e){} };
  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', kick, {once:true});
  } else {
    kick();
  }
  window.addEventListener('resize', kick);
  window.addEventListener('hashchange', kick);
  new MutationObserver(kick).observe(document.documentElement, {childList:true, subtree:true});
})();

// --- IOC pane scroller (History / Address / Settings) ---
(() => {
  if (window.__IOC_PANE_SCROLLERS__) return;  // guard against double-inject
  window.__IOC_PANE_SCROLLERS__ = true;

  // Light CSS, injected once
  function ensurePaneScrollCSS() {
    if (document.getElementById('ioc-pane-scroll-css')) return;
    const css = document.createElement('style');
    css.id = 'ioc-pane-scroll-css';
    css.textContent = `
      /* only affect our internal wrapper */
      .pane-scroller {
        overflow: auto;
        -webkit-overflow-scrolling: touch;
      }
    `;
    document.head.appendChild(css);
  }

  // Make a single tab's inner content scroll within the window
  function ensureOneTabScroll(tab) {
    if (!tab) return;

    // Wrap existing children into a single scrolling container (once).
    let wrap = tab.querySelector(':scope > .pane-scroller');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'pane-scroller';
      // Move all existing children into the wrapper to preserve visuals
      while (tab.firstChild) wrap.appendChild(tab.firstChild);
      tab.appendChild(wrap);
    }

    // Compute available height from the tab's top down to window bottom
    const top = tab.getBoundingClientRect().top;
    const pad = 24; // bottom padding so content doesn't touch the edge
    const avail = Math.max(260, window.innerHeight - top - pad);

    wrap.style.maxHeight = avail + 'px';
  }

  function ensurePaneScrollers() {
    ensurePaneScrollCSS();
    ['tab-history','tab-address','tab-settings'].forEach(id => {
      const tab = document.getElementById(id);
      if (tab && !tab.classList.contains('hidden')) {
        ensureOneTabScroll(tab);
      }
    });
  }

  // Run on load and whenever layout can change
  const kick = () => { try { ensurePaneScrollers(); } catch(_){} };
  document.addEventListener('DOMContentLoaded', kick, { once: true });
  window.addEventListener('resize', kick);
  window.addEventListener('hashchange', kick);
  new MutationObserver(kick).observe(document.documentElement, { subtree: true, childList: true, attributes: true });

  // Also kick after a short delay in case tabs mount late
  setTimeout(kick, 200);
  setTimeout(kick, 600);
})();

(function HOTFIX_BALANCE_CAP(){
  var tries=0;
  function install(){
    tries++;
    if (!document.head) { if(tries<50) return setTimeout(install,50); return; }
    if (!document.getElementById("hotfix-balance-cap")) {
      var s=document.createElement("style"); s.id="hotfix-balance-cap";
      s.textContent = `
        :root{ --balance-max:84px; }
        /* Cover common + fallback selectors for the big balance heading */
        #overview .big-number h1,
        #overview .total-balance h1,
        #overview h1.big,
        #overview .balance-h1,
        #overview [data-role="balance-h1"],
        .big-balance,
        .total-balance .balance-figure,
        .overview-card .balance-figure {
          font-size: clamp(48px, 8vh, var(--balance-max)) !important;
          line-height: 1.06 !important;
        }
        /* Make the content area and status line safe at bottom */
        .tab-content, .main-content, #content, #root { padding-bottom: 28px !important; }
        #overview .sync-status, .sync-status, [data-role="sync-status"] {
          display:block; margin-bottom: 6px !important;
        }
      `;
      try{ document.head.appendChild(s); console.log("HOTFIX_BALANCE_CAP: style attached"); }catch(e){ console.warn("HOTFIX_BALANCE_CAP: attach failed",e); }
    } else { console.log("HOTFIX_BALANCE_CAP: style already present"); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();

// BEGIN HOTFIX_BALANCE_FIT
(function () {
  if (window.__BALANCE_FIT_INSTALLED__) return;
  window.__BALANCE_FIT_INSTALLED__ = true;

  // Slight bottom padding so the sync line is always above the window edge
  const styleId = 'hotfix-balance-fit-style';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      /* Keep a little safety space for the bottom sync line */
      #overview, #overview .tab-content, #overview .main-content {
        padding-bottom: 28px !important;
      }
      /* Don’t let the big balance exceed its card */
      #overview .total-balance, #overview .overview-card { 
        overflow: hidden !important;
      }
    `;
    document.head && document.head.appendChild(s);
  }

  // Heuristic: find the "big number" element on the Overview tab
  function findBalanceEl() {
    const candidates = document.querySelectorAll(
      [
        '#overview .big-number h1',
        '#overview .total-balance h1',
        '#overview .overview-card h1',
        '#overview .balance-h1',
        '#overview [data-role="balance-h1"]',
        '#overview .balance-figure',
      ].join(','),
    );

    let best = null;
    let bestFont = 0;
    candidates.forEach((el) => {
      const txt = (el.textContent || '').trim();
      // looks like a number (digits, commas, decimal point)
      if (/^[\d,]+(\.\d+)?$/.test(txt)) {
        const size = parseFloat(window.getComputedStyle(el).fontSize) || 0;
        if (size > bestFont) { best = el; bestFont = size; }
      }
    });
    return best;
  }

  function fitTextToBox(el) {
    if (!el) return;
    // Guard: don't run if Overview tab is hidden or not properly laid out
    const overview = document.getElementById('tab-overview');
    if (!overview || overview.classList.contains('hidden')) return;
    if (el.offsetParent === null) return; // not visible

    const container = el.parentElement || el;
    // Guard: skip if container not properly sized yet
    if (!container.clientWidth || container.clientWidth < 100) return;

    // We'll try to fit BOTH width and height within the container
    const maxPx = 84;                 // absolute cap
    const minPx = 38;                 // don't get unreadably small
    const padW = 24;                  // horizontal safety
    const padH = 16;                  // vertical safety

    // Available room inside the parent container
    const availW = Math.max(0, container.clientWidth - padW);
    const availH = Math.max(0, container.clientHeight - padH);

    // Always start from maxPx so the font can grow back after shrinking
    let target = maxPx;
    el.style.whiteSpace = 'nowrap';
    el.style.lineHeight = '1.06';

    // Quick two-pass tighten: height, then width
    const fits = () => (el.scrollHeight <= availH && el.scrollWidth <= availW);

    // First coarse downstep if needed
    if (!fits()) {
      target = Math.min(maxPx, Math.max(minPx, Math.min(availH / 1.1, availW / 7))); // rough guess
      el.style.fontSize = `${target}px`;
    }

    // Fine tune: step down until it fits or we hit the floor
    let guard = 120;
    while (!fits() && target > minPx && --guard > 0) {
      target -= 1;
      el.style.fontSize = `${target}px`;
    }
  }

  function install() {
    const el = findBalanceEl();
    if (!el) { setTimeout(install, 150); return; }

    const doFit = () => fitTextToBox(el);

    // Refit on number changes and resizes
    const mo = new MutationObserver(doFit);
    mo.observe(el, { childList: true, characterData: true, subtree: true });

    const ro = new ResizeObserver(doFit);
    ro.observe(el);
    el.parentElement && ro.observe(el.parentElement);

    window.addEventListener('resize', doFit);
    document.addEventListener('visibilitychange', doFit);

    // Initial fit (after layout settles)
    setTimeout(doFit, 0);
    setTimeout(doFit, 150);
    setTimeout(doFit, 400);
    console.log('HOTFIX_BALANCE_FIT installed');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})();
 // END HOTFIX_BALANCE_FIT
// BEGIN HOTFIX_BALANCE_SIZE
(function () {
  const STYLE_ID = 'hotfix-balance-size-style';
  if (document.getElementById(STYLE_ID)) return;

  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    /* Cap the giant balance number so it never crowds out the footer/sync line */
    /* Try several likely selectors and catch-all for big H1 in Overview card */
    #overview .overview-card h1,
    #overview .total-balance h1,
    #overview h1.big-number,
    #overview h1.balance-figure,
    #overview h1[data-role="balance-h1"],
    #overview .big-number h1 {
      font-size: clamp(44px, 6.2vw, 92px) !important;
      line-height: 1.06 !important;
      white-space: nowrap !important;
    }

    /* Keep the big number area from overflowing vertically */
    #overview .overview-card,
    #overview .total-balance,
    #overview .big-number {
      overflow: hidden !important;
    }

    /* Give the bottom area a little safety space so the sync line stays visible */
    #overview .tab-content,
    #overview .main-content,
    #overview .overview-card {
      padding-bottom: 28px !important;
    }
  `;
  document.head && document.head.appendChild(s);
})();
 // END HOTFIX_BALANCE_SIZE



(function ensureBalanceHeroTag(){
  const root = document.querySelector("#overview, [data-pane=\"overview\"], .tab-content-overview") || document.body;
  if (!root) return;

  function tag() {
    // if already tagged, done
    if (document.getElementById("balanceHero")) return;

    // heuristics: find the biggest text element that looks like the balance
    let best = null, bestFs = 0;
    root.querySelectorAll("*").forEach(el => {
      const txt = (el.textContent || "").trim();
      if (!txt) return;
      if (!/[0-9][0-9,]*\.[0-9]{3}$/.test(txt)) return; // looks like "1,902,315.961"
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize || "0");
      if (fs > bestFs) { best = el; bestFs = fs; }
    });
    if (best) best.id = "balanceHero";
  }

  const mo = new MutationObserver(() => { try { tag(); } catch(e){} });
  mo.observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true});
  document.addEventListener("DOMContentLoaded", () => { try { tag(); } catch(e){} });
  // also try immediately
  try { tag(); } catch(e){}
})();

/* __BALANCE_FONT_LOCK__ */
(function lockBalanceFont(){
  // 1) Inject a scoped CSS block for the big balance
  const cssId = 'balance-font-lock-style';
  if (!document.getElementById(cssId)) {
    const style = document.createElement('style');
    style.id = cssId;
    style.textContent = `
      .balance-font-lock {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text",
                      "Segoe UI", Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif !important;
        font-weight: 700 !important;
        font-variant-numeric: tabular-nums lining-nums;
        font-feature-settings: "tnum" 1, "lnum" 1;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
    `;
    document.head.appendChild(style);
  }

  // 2) Find the big balance element safely and tag it.
  //    Try common selectors first; fall back to a heuristic (largest number-like block on Overview).
  function mark() {
    const candidates = document.querySelectorAll(
      '.hero-amount, .big-amount, .balance-amount, #balance, #balance-amount'
    );
    let el = candidates[0];

    if (!el) {
      // Heuristic: look for a large text node of digits/commas/periods inside the main overview card
      const overview = document.querySelector('#tab-overview, .tab-overview, [data-tab="overview"]') || document;
      const all = overview.querySelectorAll('*');
      let best = null, bestScore = 0;
      all.forEach(n => {
        if (!n.childElementCount && n.textContent && /[0-9][0-9,.\s]+/.test(n.textContent)) {
          const rect = n.getBoundingClientRect();
          const score = Math.round((rect.width * rect.height) / 1000); // rough size heuristic
          if (score > bestScore) { bestScore = score; best = n; }
        }
      });
      el = best || null;
    }

    if (el) el.classList.add('balance-font-lock');
  }

  // Run ASAP and after potential re-renders
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mark, { once: true });
  } else {
    mark();
  }
  // Also re-apply occasionally while syncing so live updates keep the lock
  const interval = setInterval(mark, 2000);
  window.addEventListener('beforeunload', () => clearInterval(interval));
})();
 /* __BALANCE_FONT_LOCK__ */

// ----- injected: bold largest balance text -----
function __boldBigBalance(){
  try {
    const all = Array.from(document.querySelectorAll("body *"));
    let max = 0, tgt = null;
    for (const el of all) {
      const cs = getComputedStyle(el);
      // ignore invisible/zero-size/controls
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (!cs.fontSize.endsWith("px")) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs > max) { max = fs; tgt = el; }
    }
    if (tgt) { tgt.style.fontWeight = "700"; }
  } catch(e) { /* no-op */ }
}
document.addEventListener("DOMContentLoaded", __boldBigBalance);
new MutationObserver(() => __boldBigBalance()).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
// ----- end injected -----

// --- hotfix: nudge sync line closer to staking (upwards) ---



// --- hotfix: precisely nudge "Syncing wallet" line up and trim bottom padding ---
(() => {
  function nudgeSync() {
    // Find the visible element that shows "Syncing wallet ..."
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
    let syncEl = null;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!el || !el.textContent) continue;
      const txt = el.textContent.trim();
      if (/^Syncing wallet\s*\(/i.test(txt)) { syncEl = el; break; }
    }
    if (!syncEl) return;

    // Pull the line upward
    syncEl.style.transform = "translateY(-6px)";
    syncEl.style.display   = "block";       // ensure transform applies cleanly

    // Also trim extra bottom padding on its nearest section/card to avoid clipping
    let host = syncEl.closest('.card, .panel, .section, .overview, .content');
    if (host) {
      host.style.paddingBottom = "12px";
      host.style.marginBottom  = "0px";
      host.style.overflow      = "visible";
    }

    // Guard against live updates resetting layout
    const obs = new MutationObserver(() => {
      syncEl.style.transform = "translateY(-6px)";
      if (host) {
        host.style.paddingBottom = "12px";
        host.style.marginBottom  = "0px";
        host.style.overflow      = "visible";
      }
    });
    obs.observe(syncEl, {childList:true, subtree:true, characterData:true});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", nudgeSync);
  } else {
    nudgeSync();
  }
})();

// THEME-SECTION-FIX START
(function(){
  const run = () => {
    try {
      // Try to scope to the Settings pane
      const settingsPane =
        document.getElementById('settingsPane') ||
        document.querySelector('[data-pane="settings"], #settings, .settings-pane') ||
        document.querySelector('*[class*="settings"]');

      if (!settingsPane) return;

      // Find the Theme heading
      const headers = settingsPane.querySelectorAll('h1,h2,h3,h4,div,span,label');
      let themeHeader = null;
      headers.forEach(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        if (!themeHeader && t === 'theme') themeHeader = el;
      });
      if (!themeHeader) return;

      // Get a reasonable container for the theme controls
      const card = themeHeader.closest('.card, .panel, .section, .box') || themeHeader.parentElement;
      if (!card) return;

      // Locate the color input and the two buttons
      const color = card.querySelector('input[type="color"]');
      const btns = Array.from(card.querySelectorAll('button'));
      const applyBtn = btns.find(b => /apply/i.test(b.textContent || ''));
      const resetBtn = btns.find(b => /reset/i.test(b.textContent || ''));

      if (!color || !applyBtn || !resetBtn) return;

      // Prevent running twice
      if (card.dataset.themeFixApplied === '1') return;
      card.dataset.themeFixApplied = '1';

      // Center header
      Object.assign(themeHeader.style, {
        textAlign: 'center',
        margin: '6px 0 10px',
        fontWeight: '600',
        letterSpacing: '0.3px'
      });

      // Card aesthetics to match other inner cards - dark blue theme
      Object.assign(card.style, {
        borderRadius: '18px',
        background: 'rgba(11, 26, 51, 0.85)',
        boxShadow: 'inset 0 0 0 1px rgba(26,51,82,0.3), 0 10px 24px rgba(0,0,0,0.35)',
        padding: '18px 22px 24px'
      });

      // Build a fresh, centered row and place controls APPLY – COLOR – RESET
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '18px',
        marginTop: '8px',
        flexWrap: 'wrap'
      });

      // Keep any existing rows intact; add ours at the end for stability
      card.appendChild(row);
      row.appendChild(applyBtn);
      row.appendChild(color);
      row.appendChild(resetBtn);

      // Style the color picker like a small control chip - dark blue theme
      Object.assign(color.style, {
        width: '56px',
        height: '32px',
        border: '1px solid rgba(26,51,82,0.5)',
        borderRadius: '10px',
        background: '#122844',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.3)',
        padding: '0',
        cursor: 'pointer'
      });

      // Nudge buttons for visual balance
      [applyBtn, resetBtn].forEach(b => {
        b.style.minWidth = '110px';
      });
    } catch (_) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  // Also try again when switching tabs if your UI swaps panes dynamically
  window.addEventListener('hashchange', run);
})();
// THEME-SECTION-FIX END

// ==== THEME_CARD_ENHANCER_V2 ===============================================
// Wrap the existing Theme controls in a Wallet-Tools-style "card", center the
// title, and place the color picker between APPLY and RESET. Non-destructive.
(() => {
  const STYLE_ID = 'theme-card-enhancer-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = `
      /* Card shell (match Wallet Tools look) - dark blue theme */
      .card.theme-card{
        background: #0B1A33;
        border-radius: 20px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.02), 0 18px 28px rgba(0,0,0,0.4);
        padding: 22px 22px 26px;
        margin: 24px 18px 28px;
      }
      .theme-card .card-inner{
        background: #0F223D;
        border-radius: 16px;
        padding: 22px;
      }
      .theme-card .card-title{
        color: #d9e5ea;
        text-align: center;
        font-weight: 700;
        letter-spacing: .2px;
        font-size: 20px;
        margin: 4px 0 18px;
      }
      /* Row with APPLY [picker] RESET centered */
      .theme-card .accent-row{
        display:flex; align-items:center; justify-content:center; gap:22px;
      }
      /* Give the picker a compact, pill-like frame to match buttons */
      .theme-card input[type="color"]{
        -webkit-appearance: none; appearance: none;
        width: 58px; height: 34px;
        border-radius: 10px; border: 2px solid #1A3352;
        background: var(--accent,#33A2DA); padding:0; cursor:pointer;
      }
      .theme-card input[type="color"]::-webkit-color-swatch-wrapper{ padding:0; }
      .theme-card input[type="color"]::-webkit-color-swatch{
        border: none; border-radius: 8px;
      }
    `;
    document.head.appendChild(st);
  }

  // Try to locate the Settings tab container and theme controls robustly
  function findSettingsHost() {
    return (
      document.querySelector('#tab-settings') ||
      document.querySelector('[data-tab="settings"]') ||
      document.getElementById('settings') ||
      document.body
    );
  }

  function ensureCard() {
    const host = findSettingsHost();
    if (!host || document.getElementById('themeCard')) return;

    // Find existing Theme bits (label/title, color input, buttons)
    const allButtons = Array.from(host.querySelectorAll('button'));
    const btnApply = allButtons.find(b => /apply/i.test(b.textContent || ''));
    const btnReset = allButtons.find(b => /reset/i.test(b.textContent || ''));
    const colorInput =
      host.querySelector('input[type="color"]') ||
      host.querySelector('#accentPick') ||
      host.querySelector('#accentPicker');

    // Find an existing "Theme" header near the controls if present
    let themeTitle =
      Array.from(host.querySelectorAll('h1,h2,h3,h4,label,div'))
        .find(el => /^\s*theme\s*$/i.test(el.textContent || ''));

    // If we don't have at least APPLY + RESET + a color input, bail quietly.
    if (!(btnApply && btnReset && colorInput)) return;

    injectStyle();

    // Build card
    const card = document.createElement('div');
    card.className = 'card theme-card';
    card.id = 'themeCard';
    const inner = document.createElement('div');
    inner.className = 'card-inner';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = 'Theme';

    const row = document.createElement('div');
    row.className = 'accent-row';

    // Re-home existing nodes into the centered row: APPLY [picker] RESET
    row.appendChild(btnApply);
    row.appendChild(colorInput);
    row.appendChild(btnReset);

    inner.appendChild(row);
    card.appendChild(title);
    card.appendChild(inner);

    // Insert card just before any existing footer space of the settings pane
    // or at the end of host as a fallback.
    const anchor =
      host.querySelector('.settings-footer') ||
      host.lastElementChild;
    if (anchor && anchor.parentNode === host) {
      host.insertBefore(card, anchor.nextSibling);
    } else {
      host.appendChild(card);
    }

    // If there was a free-floating Theme label/row, hide its original wrapper
    // to avoid duplicate UI (best-effort; safe to ignore if not found).
    
    if (themeTitle) {
      // Find the card/panel container that originally held Theme
      let wrap = themeTitle.closest(".panel, .card, .section, .pane, div");
      if (wrap && wrap !== card && !wrap.contains(card)) {
        const container = wrap.closest(".panel, .card, .section, .pane") || wrap;
        // Remove the whole empty container (not just its inner div)
        if (container.remove) { container.remove(); } else { container.style.display = "none"; }
        // Also remove an immediately previous empty card/panel that might be acting as a spacer
        const prev = container.previousElementSibling;
        const isCardLike = p => p && p.classList && /(?:panel|card|section|pane)/.test(p.className);
        const isEmpty    = p => p && !(p.querySelector("button,input,select,textarea")) && ((p.textContent||"").trim().length === 0);
        if (isCardLike(prev) && isEmpty(prev)) {
          if (prev.remove) { prev.remove(); } else { prev.parentNode && prev.parentNode.removeChild(prev); }
        }
      }
    }
  
  }

  // Run once at load, and again when Settings becomes visible (cheap observer)
  function init() {
    ensureCard();
    // Re-check when user switches tabs or DOM mutates
    let armed = false;
    const obs = new MutationObserver(() => {
      if (armed) return;
      armed = true;
      setTimeout(() => { armed = false; ensureCard(); }, 60);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
// ===========================================================================


// === IOC UI: Theme paddings = Wallet Tools paddings (auto-sync) ===
(function(){
  if (window.__IOC_THEME_PAD_SYNC__) return; window.__IOC_THEME_PAD_SYNC__ = true;

  function text(el){ return (el && el.textContent || '').trim(); }
  function byHeading(root, exact){
    const hs = root.querySelectorAll('h1,h2,h3,h4,.card-title');
    for (const h of hs){ if (text(h).toLowerCase() === exact) return h.closest('.card,.panel,.section,div'); }
    return null;
  }
  function getTools(){
    return document.querySelector('.wallet-tools,.tools-card,#walletTools,[data-section="wallet-tools"]')
        || byHeading(document,'wallet tools');
  }
  function getTheme(){
    return document.querySelector('.theme-card,#themeBlock,.theme,[data-section="theme"]')
        || byHeading(document,'theme');
  }

  function copyBoxModel(fromEl, toEl){
    if (!fromEl || !toEl) return;
    const cs = getComputedStyle(fromEl);
    toEl.style.padding      = cs.padding;
    toEl.style.borderRadius = cs.borderRadius;
    toEl.style.border       = cs.border;
    toEl.style.boxShadow    = cs.boxShadow;
    // keep margins untouched; panel spacing is handled elsewhere
    // do not set width/height/display to avoid layout regressions
  }

  function syncThemePads(){
    const tools = getTools();
    const theme = getTheme();
    if (!tools || !theme) return;

    // outer panel paddings/border/shadow
    copyBoxModel(tools, theme);

    // inner well paddings if both sides have one
    const toolsInner = tools.querySelector('.tools-inner,.card-body,.inner,.well') || tools.firstElementChild;
    const themeInner = theme.querySelector('.theme-inner,.card-body,.inner,.well');
    if (toolsInner && themeInner){
      const ci = getComputedStyle(toolsInner);
      themeInner.style.padding      = ci.padding;
      themeInner.style.borderRadius = ci.borderRadius;
      themeInner.style.backgroundColor = ci.backgroundColor;
    }

    // button row spacing to mirror tools (gap + top margin if present)
    const toolsBtns = tools.querySelector('.btn-row,.actions,.buttons') || null;
    const themeBtns = theme.querySelector('.btn-row,.actions,.buttons') || null;
    if (toolsBtns && themeBtns){
      const cb = getComputedStyle(toolsBtns);
      themeBtns.style.gap       = cb.gap;
      themeBtns.style.marginTop = cb.marginTop;
      themeBtns.style.justifyContent = cb.justifyContent;
      themeBtns.style.alignItems     = cb.alignItems;
      themeBtns.style.display        = 'flex';
    }
  }

  // run now and keep in sync on re-renders
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncThemePads, {once:true});
  } else {
    syncThemePads();
  }
  new MutationObserver(syncThemePads).observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('hashchange', syncThemePads, false);
})();
// === /IOC UI ===

// [__IOC_THEME_MATCH_TOOLS_PADS__] Copy Wallet Tools paddings to Theme panel (outer + inner)
(function(){
  if (window.__IOC_THEME_MATCH_TOOLS_PADS__) return;
  window.__IOC_THEME_MATCH_TOOLS_PADS__ = true;

  function txt(n){ return (n && n.textContent || '').trim().toLowerCase(); }
  function byHeading(root, key){
    const hs = root.querySelectorAll('h1,h2,h3,h4,.card-title');
    for (const h of hs) if (txt(h) === key) return h.closest('.card,.panel,.section,div');
    return null;
  }
  function getTools(root){
    return root.querySelector('.wallet-tools,.tools-card,#walletTools,[data-section="wallet-tools"]')
        || byHeading(root,'wallet tools');
  }
  function getTheme(root){
    return root.querySelector('.theme-card,#themeBlock,.theme,[data-section="theme"]')
        || byHeading(root,'theme');
  }
  function sync(){
    const root = document;
    const tools = getTools(root);
    const theme = getTheme(root);
    if (!tools || !theme) return;

    // Outer paddings/border radius/border/shadow – exact copy
    const cs = getComputedStyle(tools);
    theme.style.padding      = cs.padding;
    theme.style.borderRadius = cs.borderRadius;
    theme.style.border       = cs.border;
    theme.style.boxShadow    = cs.boxShadow;
    theme.style.backgroundColor = cs.backgroundColor;

    // Inner well paddings – copy if both sides have one, otherwise make one
    const toolsInner = tools.querySelector('.tools-inner,.card-body,.inner,.well') || tools.firstElementChild;
    let   themeInner = theme.querySelector('.theme-inner,.card-body,.inner,.well');

    if (!themeInner){
      // create a wrapper to receive inner paddings without affecting header
      themeInner = document.createElement('div');
      themeInner.className = 'theme-inner';
      // move buttons/content into the inner wrapper
      const toMove = [];
      for (const ch of Array.from(theme.childNodes)) {
        if (!(ch.matches && ch.matches('h1,h2,h3,.card-title'))) toMove.push(ch);
      }
      toMove.forEach(n => themeInner.appendChild(n));
      theme.appendChild(themeInner);
    }

    if (toolsInner){
      const ci = getComputedStyle(toolsInner);
      themeInner.style.padding      = ci.padding;
      themeInner.style.borderRadius = ci.borderRadius;
      themeInner.style.backgroundColor = ci.backgroundColor;
    }

    // Button row spacing (gap + top margin) – mirrors Tools if present
    const toolsBtns = tools.querySelector('.btn-row,.actions,.buttons');
    const themeBtns = theme.querySelector('.btn-row,.actions,.buttons');
    if (toolsBtns && themeBtns){
      const cb = getComputedStyle(toolsBtns);
      themeBtns.style.display        = 'flex';
      themeBtns.style.justifyContent = cb.justifyContent;
      themeBtns.style.alignItems     = cb.alignItems;
      themeBtns.style.gap            = cb.gap;
      themeBtns.style.marginTop      = cb.marginTop;
    }
  }

  // run now and on any re-render/nav
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, {once:true});
  } else {
    sync();
  }
  new MutationObserver(sync).observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('hashchange', sync, false);
})();

// [__IOC_THEME_WIDTH_MATCH_TOOLS__] Copy Wallet Tools width to Theme panel
(function(){
  if (window.__IOC_THEME_WIDTH_MATCH_TOOLS__) return;
  window.__IOC_THEME_WIDTH_MATCH_TOOLS__ = true;

  function byHeading(root, key){
    const hs = root.querySelectorAll('h1,h2,h3,h4,.card-title');
    for (const h of hs) if ((h.textContent||'').trim().toLowerCase() === key) return h.closest('.card,.panel,div');
    return null;
  }
  function getTools(root){
    return root.querySelector('.wallet-tools,#walletTools,[data-section="wallet-tools"]')
        || byHeading(root,'wallet tools');
  }
  function getTheme(root){
    return root.querySelector('.theme-card,#themeBlock,[data-section="theme"]')
        || byHeading(root,'theme');
  }
  function sync(){
    const root = document;
    const tools = getTools(root);
    const theme = getTheme(root);
    if (!tools || !theme) return;
    const cs = getComputedStyle(tools);
    theme.style.maxWidth = cs.maxWidth !== 'none' ? cs.maxWidth : cs.width;
    theme.style.width    = cs.width;
    theme.style.marginLeft = cs.marginLeft;
    theme.style.marginRight = cs.marginRight;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, {once:true});
  } else {
    sync();
  }
  new MutationObserver(sync).observe(document.documentElement, {childList:true, subtree:true});
})();

// [__IOC_THEME_FILL_MATCH_TOOLS_STRICT__]
// Make Theme's inner well a single FILLED block identical to Wallet Tools.
// - Finds cards by heading text ("Wallet Tools" / "Theme") or common classes
// - Copies computed styles from Tools' inner well to Theme's innermost well
// - Neutralizes any middle wrapper that causes a hollow/inset look
(function(){
  if (window.__IOC_THEME_FILL_MATCH_TOOLS_STRICT__) return;
  window.__IOC_THEME_FILL_MATCH_TOOLS_STRICT__ = true;

  function lower(n){ return (n && n.textContent || '').trim().toLowerCase(); }
  function byHeading(root, name){
    const hs = root.querySelectorAll('h1,h2,h3,h4,.card-title');
    name = (name||'').toLowerCase();
    for (const h of hs){ if (lower(h) === name) return h.closest('.card,.panel,.section,.pane,div'); }
    return null;
  }
  function getTools(root){
    return root.querySelector('.wallet-tools,.tools-card,#walletTools,[data-section="wallet-tools"]')
        || byHeading(root,'wallet tools');
  }
  function getTheme(root){
    return root.querySelector('.theme-card,#themeBlock,.theme,[data-section="theme"]')
        || byHeading(root,'theme');
  }
  function firstInner(el){
    // Prefer named inner wells; else use first element child
    return el && ( el.querySelector('.tools-inner,.theme-inner,.card-body,.inner,.well') || el.firstElementChild );
  }
  function deepest(el){
    // Walk down single-child chains to the deepest content box (buttons live here)
    let cur = el;
    while (cur && cur.firstElementChild && cur.children.length === 1) cur = cur.firstElementChild;
    return cur || el;
  }
  function copyStyles(from, to){
    const cs = getComputedStyle(from);
    to.style.backgroundColor = cs.backgroundColor;
    to.style.borderRadius    = cs.borderRadius;
    to.style.padding         = cs.padding;
    to.style.boxShadow       = cs.boxShadow;
    to.style.border          = cs.border;
    to.style.width           = '100%';
    to.style.display         = 'block';
    to.style.margin          = '0';
  }
  function neutralizeMiddle(theme, innerFilled){
    // Any ancestors between theme and innerFilled should not draw a ring
    let p = innerFilled.parentElement;
    while (p && p !== theme){
      p.style.background   = 'transparent';
      p.style.boxShadow    = 'none';
      p.style.border       = '0';
      p.style.padding      = '0';
      p.style.margin       = '0';
      p = p.parentElement;
    }
  }
  function moveButtonsInside(inner){
    const buttonsRow = inner.querySelector('.btn-row,.actions,.buttons') ||
                       inner.querySelector('button')?.parentElement;
    if (!buttonsRow) return;
    // Ensure spacing like Tools (centered w/ gap)
    const s = buttonsRow.style;
    s.display        = 'flex';
    s.justifyContent = 'center';
    s.alignItems     = 'center';
    if (!s.gap) s.gap = '18px';
    if (!s.marginTop) s.marginTop = '16px';
  }

  function sync(){
    const root  = document;
    const tools = getTools(root);
    const theme = getTheme(root);
    if (!tools || !theme) return;

    const toolsInner = deepest(firstInner(tools)) || tools;
    // For Theme: use deepest existing inner; if not present, wrap content
    let themeInner = deepest(firstInner(theme));
    if (!themeInner || themeInner === theme){
      const wrap = document.createElement('div');
      wrap.className = 'theme-inner';
      const keep = [];
      for (const ch of Array.from(theme.childNodes)){
        if (!(ch.matches && ch.matches('h1,h2,h3,.card-title'))) keep.push(ch);
      }
      keep.forEach(n => wrap.appendChild(n));
      theme.appendChild(wrap);
      themeInner = wrap;
    }

    copyStyles(toolsInner, themeInner);
    neutralizeMiddle(theme, themeInner);
    moveButtonsInside(themeInner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, {once:true});
  } else {
    sync();
  }
  new MutationObserver(sync).observe(document.documentElement, {childList:true, subtree:true});
  window.addEventListener('hashchange', sync, false);
})();

/* ===== Compact Widget Mode ===== */
(function() {
  let isCompact = false;

  function updateWidgetValues() {
    // Sync balance from main display to widget
    const mainBalance = document.getElementById('big-balance');
    const widgetBalance = document.getElementById('widget-balance');
    if (mainBalance && widgetBalance) {
      widgetBalance.textContent = mainBalance.textContent;
    }

    // Sync staking from main display to widget
    const mainStaking = document.getElementById('staking');
    const widgetStaking = document.getElementById('widget-staking');
    if (mainStaking && widgetStaking) {
      widgetStaking.textContent = mainStaking.textContent;
    }
  }

  function setCompactMode(compact) {
    isCompact = compact;
    document.body.classList.toggle('compact-mode', isCompact);
    if (isCompact) updateWidgetValues();
    // Save state
    try {
      localStorage.setItem('ioc-compact-mode', isCompact ? '1' : '0');
    } catch (e) {}
  }

  async function toggleCompact() {
    isCompact = !isCompact;
    document.body.classList.toggle('compact-mode', isCompact);
    if (isCompact) updateWidgetValues();

    // Tell main process to resize window
    if (window.ioc && window.ioc.setCompactMode) {
      await window.ioc.setCompactMode(isCompact);
    }

    // Save state
    try {
      localStorage.setItem('ioc-compact-mode', isCompact ? '1' : '0');
    } catch (e) {}
  }

  function init() {
    // Listen for compact mode changes from main process
    if (window.ioc && window.ioc.onCompactModeChanged) {
      window.ioc.onCompactModeChanged((compact) => {
        setCompactMode(compact);
      });
    }

    // Add click handler for compact button (stars icon)
    const compactBtn = document.getElementById('ic-compact');
    if (compactBtn) {
      compactBtn.addEventListener('click', toggleCompact);
    }

    // Start in compact mode (window starts compact)
    isCompact = true;
    document.body.classList.add('compact-mode');
    updateWidgetValues();

    // Observe balance/staking changes to keep widget in sync
    const mainBalance = document.getElementById('big-balance');
    if (mainBalance) {
      new MutationObserver(() => {
        if (isCompact) updateWidgetValues();
      }).observe(mainBalance, { childList: true, characterData: true, subtree: true });
    }

    const mainStaking = document.getElementById('staking');
    if (mainStaking) {
      new MutationObserver(() => {
        if (isCompact) updateWidgetValues();
      }).observe(mainStaking, { childList: true, characterData: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
