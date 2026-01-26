/**
 * Bootstrap module for first-run chain data download.
 * Downloads and extracts bootstrap.zip to speed up initial sync.
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createWriteStream, createReadStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { DATA_DIR, CONF_PATH, isFirstRun } = require('../shared/constants');

const BOOTSTRAP_URL = 'https://iocbootstrap.s3.us-east-2.amazonaws.com/bootstrap.zip';
const BOOTSTRAP_ZIP_PATH = path.join(DATA_DIR, 'bootstrap.zip');

/**
 * Check if bootstrap is needed.
 * Returns true if:
 * - This is a first run (no iocoin.conf), OR
 * - Chain data is missing/empty (no blk*.dat files)
 *
 * Does NOT return true if user already has chain data.
 */
function needsBootstrap() {
  // If first run (no config), definitely needs bootstrap
  if (isFirstRun()) {
    return true;
  }

  // Check if chain data exists
  if (!fs.existsSync(DATA_DIR)) {
    return true;
  }

  // Look for block files (blk0001.dat, blk0002.dat, etc.)
  try {
    const files = fs.readdirSync(DATA_DIR);
    const hasBlockFiles = files.some(f => /^blk\d+\.dat$/i.test(f));
    if (!hasBlockFiles) {
      return true;
    }

    // Check if blk0001.dat has meaningful size (> 1MB means synced)
    const blk1Path = path.join(DATA_DIR, 'blk0001.dat');
    if (fs.existsSync(blk1Path)) {
      const stats = fs.statSync(blk1Path);
      // If blk0001.dat is > 1MB, user has started syncing
      if (stats.size > 1024 * 1024) {
        return false;
      }
    }

    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Check if a bootstrap download is already in progress or completed.
 */
function hasBootstrapZip() {
  return fs.existsSync(BOOTSTRAP_ZIP_PATH);
}

/**
 * Download bootstrap.zip with progress callback.
 * @param {Function} onProgress - Called with { downloaded, total, percent }
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
function downloadBootstrap(onProgress) {
  return new Promise((resolve) => {
    // Ensure data dir exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const file = createWriteStream(BOOTSTRAP_ZIP_PATH);

    https.get(BOOTSTRAP_URL, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(BOOTSTRAP_ZIP_PATH);
          // Recursively follow redirect
          https.get(redirectUrl, handleResponse).on('error', handleError);
          return;
        }
      }

      handleResponse(response);
    }).on('error', handleError);

    function handleResponse(response) {
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(BOOTSTRAP_ZIP_PATH); } catch (_) {}
        resolve({ ok: false, error: `HTTP ${response.statusCode}` });
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (onProgress && totalSize > 0) {
          onProgress({
            downloaded: downloadedSize,
            total: totalSize,
            percent: Math.round((downloadedSize / totalSize) * 100)
          });
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve({ ok: true, path: BOOTSTRAP_ZIP_PATH });
      });

      file.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(BOOTSTRAP_ZIP_PATH); } catch (_) {}
        resolve({ ok: false, error: err.message });
      });
    }

    function handleError(err) {
      file.close();
      try { fs.unlinkSync(BOOTSTRAP_ZIP_PATH); } catch (_) {}
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Extract bootstrap.zip to DATA_DIR.
 * Uses Node.js built-in zlib for .zip extraction.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function extractBootstrap() {
  if (!fs.existsSync(BOOTSTRAP_ZIP_PATH)) {
    return { ok: false, error: 'Bootstrap zip not found' };
  }

  try {
    // We need to use a simple unzip approach
    // Node.js doesn't have built-in zip extraction, so we'll use the unzip command
    const { execFile } = require('node:child_process');

    return new Promise((resolve) => {
      // Use system unzip command (available on macOS, Linux, and Windows with Git Bash)
      const unzipArgs = ['-o', BOOTSTRAP_ZIP_PATH, '-d', DATA_DIR];

      execFile('unzip', unzipArgs, { timeout: 600000 }, (err, stdout, stderr) => {
        if (err) {
          // Try ditto on macOS as fallback
          if (process.platform === 'darwin') {
            execFile('ditto', ['-xk', BOOTSTRAP_ZIP_PATH, DATA_DIR], { timeout: 600000 }, (err2) => {
              if (err2) {
                resolve({ ok: false, error: `Extract failed: ${err2.message}` });
              } else {
                resolve({ ok: true });
              }
            });
          } else {
            resolve({ ok: false, error: `Extract failed: ${err.message}` });
          }
        } else {
          resolve({ ok: true });
        }
      });
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Clean up downloaded bootstrap zip file.
 */
function cleanupBootstrap() {
  try {
    if (fs.existsSync(BOOTSTRAP_ZIP_PATH)) {
      fs.unlinkSync(BOOTSTRAP_ZIP_PATH);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Get bootstrap zip path for external use.
 */
function getBootstrapZipPath() {
  return BOOTSTRAP_ZIP_PATH;
}

module.exports = {
  BOOTSTRAP_URL,
  needsBootstrap,
  hasBootstrapZip,
  downloadBootstrap,
  extractBootstrap,
  cleanupBootstrap,
  getBootstrapZipPath
};
