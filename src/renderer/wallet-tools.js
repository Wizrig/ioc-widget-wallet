const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

document.getElementById('backupWalletBtn').onclick = () => {
  try {
    const walletPath = path.join(process.env.HOME, 'Library', 'Application Support', 'IOCoin', 'wallet.dat');
    const desktopPath = path.join(process.env.HOME, 'Desktop', 'wallet.dat');
    fs.copyFileSync(walletPath, desktopPath);
    console.log('Wallet backed up to Desktop');
  } catch (err) {
    console.error('Backup failed', err);
  }
};
