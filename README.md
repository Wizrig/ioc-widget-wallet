# IOC Widget Wallet (macOS Electron)

Minimal Electron front-end for **I/O Coin (IOC)** on macOS.  
Provides a lightweight GUI to interact with `iocoind`.

---

## ✨ Features

- Frontend for `iocoind` on macOS (start/stop, background mode)
- Overview with:
  - Balance  
  - Staking amount & status  
  - Peer connections  
  - Sync progress (blocks/headers with adaptive polling)
- Lock/Unlock with passphrase modal (staking-aware)
- Send IOC flow (prompts to unlock if wallet is locked)
- **Backup Tools**: dump, import, open default path, backup wallet.dat
- **Debug Tools**: start/stop live debug log tail
- **Theme Panel** (now styled consistently with Wallet Tools in RC1)

---

## 📦 Installation

Clone the repo and install dependencies:

```bash
git clone https://github.com/Wizrig/ioc-widget-wallet.git
cd ioc-widget-wallet
npm install
