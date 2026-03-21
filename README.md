# I/O Coin Widget Wallet

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)

![IOC Widget Wallet](assets/IOCoin_Widget_Wallet.png)

A lightweight desktop wallet built for serious I/O Coin holders.
Compact widget mode for live balance and staking, one-click expand for full wallet access.

**Supported Platforms:**
- macOS arm64 (Apple Silicon)
- macOS x64 (Intel)
- Windows x64 (Windows 10/11)
- Linux x64 / arm64 (AppImage, deb)

---

## Before You Install

**Back up your existing wallet data before installing or running this application.** If you have an existing I/O Coin wallet (legacy or otherwise), copy the entire data directory to a safe location first:

- **macOS:** `~/Library/Application Support/IOCoin/`
- **Windows:** `%APPDATA%\IOCoin\`
- **Linux:** `~/.iocoin/`

At minimum, back up `wallet.dat` — losing this file means losing access to your funds. Store the backup on a separate drive or external media.

---

## Download & Install

Download the latest release from [GitHub Releases](https://github.com/Wizrig/ioc-widget-wallet/releases/latest).

SHA256 checksums are published alongside each installer for verification.

### macOS

1. Open the downloaded `.dmg` file
2. Drag **IOC Widget Wallet** to your **Applications** folder
3. On first launch macOS may show a security prompt — click **Open** (the app is signed and notarized by Apple)
4. The wallet will auto-detect or prompt to install `iocoind`

### Windows

The IOCoin daemon requires the **Microsoft Visual C++ Redistributable (x64)**. Most Windows systems already have it, but if the wallet fails to start the daemon, install it from [Microsoft's download page](https://aka.ms/vs/17/release/vc_redist.x64.exe).

1. Run the downloaded `.exe` installer
2. Follow the setup wizard
3. Windows SmartScreen may appear on first run — click **More info** then **Run anyway**

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

## Features

### Instant Send
Fast, direct IOC transfers with address validation, fee mode selection (fee on top / fee included), and confirmation breakdown before broadcast.

### Proof-of-Stake
Earn while idle. Live staking display with real-time balance updates in both compact widget and full wallet views.

### Live Debug
Full node transparency. Built-in debug log viewer during splash sync and in Settings for real-time daemon diagnostics.

### Compact Widget
Always-on-top mini view with live balance, staking status, and quick send. One-click expand to full wallet.

### Bootstrap Sync
Integrated bootstrap download on first run for fast chain sync. Automatic detection of newer daily bootstraps with guided rebootstrap flow and automatic wallet backup.

### Address Book & Recipients
Manage your own addresses with labels and per-address balances. Save frequently-used recipient addresses for quick access when sending.

### Security
Wallet encryption with passphrase, lock/unlock with shake feedback on wrong password. Dump wallet (exports private keys with passphrase verification), import wallet, and backup wallet.dat.

### Block Explorer
Direct link to [iocexplorer.online](https://iocexplorer.online/) from Settings. Open any transaction in the explorer directly from History.

---

## Installation Modes

### Easy Mode (Recommended)
On first run with no existing blockchain data, the wallet offers to download a bootstrap archive. The bootstrap is downloaded, extracted, and applied automatically. After bootstrap, the wallet syncs remaining blocks from the network.

### Expert Mode
Skip the bootstrap prompt to sync the entire blockchain from scratch (slower but fully trustless).

---

## Release Notes (v0.1.1 — RC10)

### Sync & Startup
- Instant window launch — splash appears immediately, daemon loads in background
- Live debug panel during splash with real-time log output
- ETA display and sync progress during block download
- Automatic detection of newer bootstrap checkpoints with rebootstrap advisor

### Wallet Tools
- Dump Wallet — exports private keys (requires passphrase verification)
- Import Wallet — import from dump file
- Backup Wallet — saves wallet.dat to chosen location
- Open Data Folder — quick access to chain data
- Explorer — opens iocexplorer.online

### UI & Icons
- Uniform status bar icons (lock, peers, staking, compact toggle)
- Clean icon styling with accent color when active
- Shake animation on incorrect passphrase across all inputs

### Recipients
- Save frequently-used addresses with labels
- Send directly to saved recipients
- Edit and delete saved entries
- Address validation via RPC on save

### Bootstrap & Recovery
- Rebootstrap advisor with estimated time savings
- Automatic wallet backup before bootstrap apply
- Fixed stale pidfile detection on macOS for reliable daemon stop
- System resume recovery after sleep/hibernate

### Windows
- Native Windows menu (File, Edit, Help)
- VC++ runtime detection and guidance
- Fixed splash-screen text encoding

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

Contributions and feedback are welcome.
