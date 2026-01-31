# IOC Widget Wallet

Minimal Electron wallet for **I/O Coin (IOC)**.
Provides a lightweight GUI to interact with `iocoind`.

**Supported Platforms:**
- macOS arm64 (Apple Silicon)
- macOS x64 (Intel)
- Windows x64 (Windows 10/11)
- Linux x64 (AppImage, deb)

---

## Before You Install

**Back up your existing wallet data before installing or running this application.** If you have an existing I/O Coin wallet (legacy or otherwise), copy the entire data directory to a safe location first:

- **macOS:** `~/Library/Application Support/IOCoin/`
- **Windows:** `%APPDATA%\IOCoin\`
- **Linux:** `~/.iocoin/`

At minimum, back up `wallet.dat` — but copying the full directory ensures you can restore everything if needed. Store the backup on a separate drive or external media. This applies to fresh installs, upgrades, and switching between wallet versions.

---

## Download & Install

Download the latest release from [GitHub Releases](https://github.com/Wizrig/ioc-widget-wallet/releases/latest).

SHA256 checksums are published alongside each installer for verification.

### macOS

1. Open the downloaded `.dmg` file
2. Drag **IOC Widget Wallet** to your **Applications** folder
3. On first launch macOS may show "downloaded from the internet" prompt — click **Open** (the app is signed and notarized by Apple)
4. The wallet will auto-detect or prompt to install `iocoind`

### Windows

1. Run the downloaded `.exe` installer
2. Follow the setup wizard
3. Windows SmartScreen may appear on first run depending on signing — click **More info** then **Run anyway**

### Linux

AppImage requires FUSE. Most distributions include it by default, but on Fedora you may need:
```bash
sudo dnf install fuse fuse-libs
```

**AppImage:**
```bash
chmod +x IOC.Widget.Wallet-*.AppImage
./IOC.Widget.Wallet-*.AppImage
```

**Debian/Ubuntu (.deb):**
```bash
sudo dpkg -i ioc-widget-wallet_*.deb
```

---

## Installation Modes

### Easy Mode (Recommended)
On first run with no existing blockchain data, the wallet offers to download a bootstrap archive. This allows fast sync — the bootstrap is downloaded, extracted, and applied automatically. After bootstrap, the wallet syncs remaining blocks from the network.

### Expert Mode
Skip the bootstrap prompt to perform a clean sync from the network. The wallet will sync the entire blockchain from scratch (slower but fully trustless).

---

## Wallet Features

- **Automatic daemon management** — starts `iocoind` on launch or attaches to an already-running instance; prevents double-spawn via PID tracking
- **Close Wallet Completely** — stops the daemon reliably and exits
- **Close UI Only** — fully closes the Electron frontend while leaving the daemon running in the background; relaunching the wallet attaches to the running daemon
- **Runtime warmup display** — shows "Loading daemon..." on startup, then "Loading daemon... this may take a few minutes" after 8 seconds, and "Loading blockchain index..." after 1 minute if the wallet has not fully loaded
- **Bootstrap flow** — download, extract, and apply bootstrap archive with progress display, then continue syncing from the network
- **Sync progress** — displays current block height vs network tip with adaptive polling intervals
- **Balance display** — shows wallet balance immediately once daemon responds
- **Staking display** — shows staking amount (not weight) with correct rules: greyed out when no coins are available
- **Lock / Unlock**
  - Wrong password: shakes the password prompt and shows "Wrong passphrase" — does not shake the lock icon
  - Correct password: unlocks immediately with no shake and no false error
  - Locking works immediately after unlock with instant UI feedback
- **Wallet encryption** — unencrypted wallets show a grey lock icon with prompt to encrypt; encryption flow restarts the daemon automatically
- **Send IOC** — send flow prompts to unlock if wallet is locked
- **Address book** — manage contacts and labels
- **Backup tools** — dump, import, open default data path, backup wallet.dat
- **Debug tools** — start/stop live debug log tail
- **Reduced polling load** — RPC calls are serialized through a queue to avoid flooding the daemon; user-initiated actions (lock/unlock) bypass the queue for instant response
- **Security** — PID tracking for app-started daemon only; no unsafe process killing; safe attach logic for externally-started daemons
- **Checksums** — SHA256 checksums published for all release binaries

---

## Latest Patches (v0.1.0)

- Lock/unlock responsiveness: all RPC switched from CLI subprocess to HTTP JSON-RPC; serialized queue prevents daemon contention; user actions bypass queue
- Lock state grace period: UI responds instantly on lock/unlock click without being overwritten by stale polling data
- Wrong-password shake: only the password prompt shakes, not the lock icon; correct password never triggers shake
- Daemon stop behavior: "Close Wallet Completely" reliably stops daemon; "Close UI Only" fully exits Electron process
- Double-spawn prevention: PID check via pidfile/pgrep when RPC is unresponsive during startup
- Warmup messaging: progressive status display (Loading daemon / this may take a few minutes / Loading blockchain index)
- Polling load reduced: wallet state cached for 15s and refreshed in background; fast path polls only chain height and peer count
- DMG installer: proper icon spacing, signed and notarized, light arrow background with readable text

---

## Development / Build from Source

### Prerequisites

- Node.js (v16 or higher)
- npm

### Clone and Install

```bash
git clone https://github.com/Wizrig/ioc-widget-wallet.git
cd ioc-widget-wallet
npm install
```

### Run in Development Mode

```bash
npm run dev
```

### Build for Production

**macOS:**
```bash
npm run build:mac
```

**Windows:**
```bash
npm run build:win
```

**Linux:**
```bash
npm run build:linux
```

---

## License

See [LICENSE](LICENSE) file for details.

---

## Contributing

This is a widget-style wallet for I/O Coin. Contributions and feedback are welcome.
