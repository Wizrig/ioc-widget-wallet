# IOC Widget Wallet
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)


![IOC Widget Wallet](assets/IOCoin_Widget_Wallet.png)

Lightweight Electron wallet for **I/O Coin (IOC)**.
Designed for simplicity, fast sync, and safe wallet management without running a full desktop client.
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

At minimum, back up `wallet.dat`, losing this file means losing access to your funds. Copying the full directory ensures you can restore everything if needed. Store the backup on a separate drive or external media. This applies to fresh installs, upgrades, and switching between wallet versions.

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

The IOCoin daemon requires the **Microsoft Visual C++ Redistributable (x64)**. Most Windows systems already have it, but if the wallet fails to start the daemon, install it from [Microsoft's download page](https://aka.ms/vs/17/release/vc_redist.x64.exe).

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

### Core Wallet
- Full-node IOC wallet with automatic daemon management (start or attach, with PID tracking)
- Reliable shutdown options:
  - Close Wallet Completely (stops daemon and exits)
  - Close UI Only (keeps daemon running in background)
- Runtime warmup and loading states with progressive messaging
- Real-time sync progress (current height vs network tip with adaptive polling)
- Automatic recovery after system sleep/hibernate

### Sync & Bootstrap
- Integrated bootstrap flow (download, extract, apply with progress display)
- Automatic detection of newer bootstrap checkpoints
- Guided rebootstrap flow with estimated time savings and confirmation step
- Safe rebootstrap with automatic backup (wallet.dat, iocoin.conf, manifest)
- Improved daemon startup with explicit readiness timeouts and clear failure handling

### Sending & Transactions
- Send IOC with unlock-on-demand flow
- Fee modes: Fee on top / Fee included
- Pre-send address validation (validateaddress)
- Final confirmation step with full transaction breakdown
- Sending disabled until full sync to prevent invalid transactions

### Address Management
- Manage "My Addresses" with editable labels and per-address balance
- Local address book ("Recipients") with create/edit/delete
- Quick recipient selection directly from Send flow
- Click-to-copy addresses and improved UX interactions

### Balance, Staking & History
- Immediate balance display once daemon responds
- Staking display with correct availability logic (greyed when inactive)
- Full-width transaction history with columns: When, Amount, Address, Transaction
- Direct "Open Tx" action for blockchain explorer
- Improved balance formatting (whole/fraction split)
- Consistent data across full view and compact widget

### Security & Encryption
- Wallet encryption flow with automatic daemon restart
- Lock / Unlock behavior:
  Clear feedback for wrong passphrase
  Instant unlock without false errors
  Immediate locking with UI feedback
- Safe daemon handling (no unsafe process killing, attach-aware logic)

### Tools & Diagnostics
- Wallet backup tools (dump, import, open data folder, backup wallet.dat)
- Integrated Help Center with troubleshooting guidance and quick access (F1)
- Live debug log viewer (start/stop + recent logs)
- Reduced RPC load via queued requests with priority bypass for critical actions

### UI & Experience
- Modernized interface with improved layout and interaction flows
- Compact widget mode (always-on-top with live balance and staking)
- Improved modal behavior, focus states, and responsiveness
- Organized settings sections (Wallet Tools, Explorer, Debug)

### Windows Support
- Native Windows menu (File, Edit, Help)
- Quick access to wallet data folder via Explorer
- Improved daemon startup guidance (VC++ runtime handling)
- Fixed splash-screen text encoding issues

### Integrity
- SHA256 checksums published for all release binaries

---

## Release Notes (v0.1.1 — RC10)

### Sync & Startup
- Reworked splash sync experience with clearer status flow, ETA, and live progress information
- Improved recovery behavior after system resume (sleep/hibernate)
- Daemon startup now uses explicit readiness timeouts with clear failure handling instead of silent fallback
- Fixed splash/status text encoding issues

### Send & Receive
- Sending is now blocked until full sync, with clear user-facing warning state
- Send modal redesigned with recipient picker, fee mode (Fee on top / Fee included), and live summary
- Added optional pre-send address validation (validateaddress) for early error detection
- Final confirmation step added before broadcast, including fee and total debit breakdown

### Balance & Display
- History redesigned to a full-width 4-column layout (When, Amount, Address, Transaction)
- Added direct "Open Tx" action from history rows
- Improved balance rendering with clearer whole/fraction formatting
- Compact widget now mirrors overview values more reliably

### Address Book
- Refined "My Addresses" labeling and edit flow
- Added "Recipients" section with local saved recipient management
- Saved recipients integrated into Send flow

### Bootstrap / Recovery
- Added daily bootstrap metadata check to detect newer checkpoints
- Rebootstrap advisory now includes estimated time savings and explicit confirmation flow
- Added safety backup creation before rebootstrap apply (wallet.dat, iocoin.conf, manifest)
- Improved bootstrap apply flow with proper daemon stop and file-lock handling

### Daemon Management
- Improved diagnostic logging and wallet backup handling
- Replaced legacy injected patch-style code with centralized, maintainable logic

### UI / UX Polish
- Refined header, tabs, compact toggle behavior, and general layout
- Reorganized settings into Wallet Tools, Chain Explorer, and Live Debug
- Added in-app Wallet Help Center with structured navigation
- Modal action order standardized so primary action appears first and Cancel appears second
- Improved modal layout and positioning in compact mode

### Windows
- Added explicit Windows app menu (File, Edit, Help)
- Added Help menu shortcuts for Wallet Help Center (F1) and Open Explorer
- Fixed splash-screen text encoding issue
- Improved daemon startup guidance for missing runtime dependencies

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
