# IOC Widget Wallet

Minimal Electron wallet for **I/O Coin (IOC)**.
Provides a lightweight GUI to interact with `iocoind`.

**Supported Platforms:**
- macOS arm64 (Apple Silicon)
- Windows x64 (Windows 10/11)

---

## ✨ Features

- Frontend for `iocoind` (start/stop, background mode)
- Overview with:
  - Balance
  - Staking amount & status
  - Peer connections
  - Sync progress (blocks/headers with adaptive polling)
- Lock/Unlock with passphrase modal (staking-aware)
- Send IOC flow (prompts to unlock if wallet is locked)
- **Backup Tools**: dump, import, open default path, backup wallet.dat
- **Debug Tools**: start/stop live debug log tail
- **Address Book**: manage contacts and labels

---

## 📦 Download & Install

### Download

Download the latest release from [GitHub Releases](https://github.com/Wizrig/ioc-widget-wallet/releases/latest).

### macOS Installation

1. Open the downloaded DMG file
2. Drag **IOC Widget Wallet.app** to your Applications folder
3. Drag **iocoind** to the **bin** folder (installs to `/usr/local/bin`)
4. If macOS shows a security warning on first launch, right-click the app and select "Open"

### Windows Installation

1. Run the downloaded `.exe` installer
2. Follow the setup wizard
3. Choose your installation directory
4. Select whether to create desktop/start menu shortcuts

---

## 🔧 Development / Build from Source

### Prerequisites

- Node.js (v16 or higher recommended)
- npm

### Clone and Install

```bash
git clone https://github.com/Wizrig/ioc-widget-wallet.git
cd ioc-widget-wallet
npm install
```

### Run in Development Mode

```bash
npm start
```

### Build for Production

**macOS:**
```bash
npm run build
```

**Windows:**
```bash
npm run build -- --win --x64
```

---

## 📄 License

See [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

This is widget like wallet for I/O Coin. Contributions and feedback are welcome.

