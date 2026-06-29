# I/O Coin Light Wallet

A lightweight desktop wallet for **I/O Coin (IOC)**. It runs and manages the IOCoin full‑node daemon (`iocoind`) for you in the background and gives you a clean interface for balance, send/receive, staking, an address book, saved recipients, and automatic blockchain sync. Available for **macOS, Windows, and Linux**.

---

## Downloads

| Platform | File |
|----------|------|
| macOS (Apple Silicon / M‑series) | `IOC.Widget.Wallet-0.1.1-RC10-arm64.dmg` |
| macOS (Intel) | `IOC.Widget.Wallet-0.1.1-RC10.dmg` |
| Windows 10/11 (x64) | `IOC.Widget.Wallet.Setup.0.1.1-RC10.exe` |
| Linux (x64, AppImage) | `IOC.Widget.Wallet-0.1.1-RC10.AppImage` |
| Linux (ARM64, AppImage) | `IOC.Widget.Wallet-0.1.1-RC10-arm64.AppImage` |
| Debian / Ubuntu (x64) | `ioc-widget-wallet_0.1.1-RC10_amd64.deb` |
| Debian / Ubuntu (ARM64) | `ioc-widget-wallet_0.1.1-RC10_arm64.deb` |

**Always verify your download** against `SHA256SUMS.txt` before running it.

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS.txt
```
```powershell
# Windows
CertUtil -hashfile "IOC.Widget.Wallet.Setup.0.1.1-RC10.exe" SHA256
```

---

## How the wallet works

The Light Wallet is two pieces working together:

1. **The wallet app** (what you see) — the window, balance, send screens, settings.
2. **The daemon `iocoind`** (the engine) — a full I/O Coin node that talks to the network, validates blocks, holds your keys in `wallet.dat`, and does the staking. The app starts, monitors, and stops it for you.

The app talks to the daemon locally over JSON‑RPC on `127.0.0.1:33765`. **Nothing is exposed to the internet** — the RPC port is bound to localhost only, and the password is a random 64‑character value generated on first run.

### First launch — daemon install

On the very first run the app installs the bundled `iocoind` engine to a standard location and then starts it:

| Platform | Engine install path | Method |
|----------|--------------------|--------|
| **macOS** | `/usr/local/bin/iocoind` | Asks once for your password (admin) to copy it in |
| **Windows** | `%LOCALAPPDATA%\IOCoin\iocoind.exe` (with its DLL runtime folder) | Per‑user, normally **no admin needed** |
| **Linux** | `/usr/local/bin/iocoind` | Uses `pkexec` (PolicyKit) once to copy it in |

> **macOS (Apple Silicon):** if the engine needs Rosetta 2 you'll be told to run
> `softwareupdate --install-rosetta --agree-to-license` once.
> **Windows:** the engine needs the **Microsoft Visual C++ Redistributable (x64)**. If it's missing the wallet will point you to <https://aka.ms/vs/17/release/vc_redist.x64.exe>.

### First launch — blockchain bootstrap

A fresh node would normally take many hours to download the whole chain from peers. Instead, on first run the wallet downloads a **bootstrap snapshot** (pre‑built block data) and applies it, so you start near the current tip:

- Snapshot source: `https://iocbootstrap.s3.us-east-2.amazonaws.com/bootstrap.zip`
- It downloads to a **temporary folder** (never into your wallet folder), extracts, copies the block files into your data directory, then starts the engine.
- **Your `wallet.dat` is never touched** by this process.

You'll see a splash screen move through these phases:

1. **Loading daemon…** – the engine is starting / loading the block index (can take a few minutes the first time).
2. **Downloading bootstrap… X%** – the snapshot is being fetched (first run only).
3. **Installing blockchain files…** – the snapshot is being applied.
4. **Syncing with the network** – the last blocks are pulled from peers; an ETA is shown.

There's a **Show live debug** button on the splash if you want to watch the engine's log directly.

### Staying in sync — automatic re‑bootstrap

A fresh bootstrap snapshot is published nightly. If you leave the wallet closed for a while and reopen it well behind the network, the wallet can fast‑forward instead of grinding through every block:

- **At launch**, before starting the engine, the wallet reads your last block height from the engine's `debug.log` and compares it to the height of the latest published snapshot (read from the official release **IOCoin/DIONS → `DIONS-BootStrap`**).
- If the snapshot is ahead of you, the wallet **stops the engine cleanly**, removes only the **chain data** (`blk0001.dat`, `blk0002.dat`, `blkindex.dat`, `txleveldb/`), then re‑runs the standard download‑and‑apply flow to jump to the fresh snapshot.
- **What is preserved:** your `wallet.dat`, your `iocoin.conf`, the wallet database (`database/`), and the alias cache (`aliascache.dat`) are **never** removed.
- The engine is always shut down **gracefully** (it's given up to 5 minutes to flush its databases) — it is never force‑killed during a flush, which protects the chain database from corruption.

### Peers / network connection

The engine finds the network through two supernodes written into your config:

```
addnode=amer.supernode.iocoin.io
addnode=emea.supernode.iocoin.io
```

If you ever see 0 peers and no sync, it usually means those hosts are temporarily unreachable from your network (firewall / DNS). The wallet will keep retrying.

---

## The interface

The full wallet has five tabs. There is also a **compact widget mode** (a small always‑handy panel) you can toggle from the icon in the top‑right.

### Header status icons (top‑right)

| Icon | States | Meaning |
|------|--------|---------|
| **Lock** | open (encrypt) / closed‑grey (locked) / open‑blue (unlocked) | Click to encrypt, lock, or unlock the wallet |
| **Peers (signal bars)** | grey = 0 peers · blue = connected | Network connectivity; hover shows peer count + block height |
| **Staking (diamond/arrow)** | grey = off · blue = active | Lights up only when unlocked **and** synced **and** funded |
| **Compact toggle** | — | Switches between the full window and the small widget |

### 1. Overview
- **TOTAL I/O AVAILABLE** – your spendable balance, updated live.
- **Pending** – unconfirmed incoming coins, shown with a pulsing "+X pending".
- **STAKING** – the amount currently staking.
- **Send** button – opens the send screen (see below).
- A **sync bar** appears underneath while the chain is still catching up.

### 2. History
A table of your transactions — when, amount, and address/txid. Rows link out to the block explorer.

### 3. Address Book
Your **receiving** addresses.
- **+ New Address** – create a fresh receiving address with an optional label.
- Click a **label** to rename it inline (Enter to save, Esc to cancel).
- Click an **address** to copy it (shows "Copied!").
- Internal change addresses are shown dimmed.

### 4. Recipients
A personal list of people/services you send to often.
- **+ Add** – save a label + address (the address is validated against the network before saving).
- Each card has **Send** (jumps to the send screen pre‑filled), **Edit**, and **Del**.
- Stored locally on your machine (browser localStorage); it persists across restarts.

### 5. Settings
- **Wallet Tools:** Backup Wallet · Dump Wallet · Import Wallet · Open Data Folder · Explorer (covered in **Backup & Recovery** below).
- **Diagnostics:** a live tail of the engine's `debug.log` (Start / Stop), useful for support.
- **Wallet Version** is shown here.

---

## Sending I/O

1. Click **Send** (Overview tab or the compact widget).
2. If the wallet is **encrypted but locked**, you'll be asked to unlock first. If it's **not yet encrypted**, you'll be prompted to set a passphrase first (recommended).
3. Enter the **recipient address** and **amount**, then confirm.
4. Sending is **blocked until the wallet is fully synced** — this prevents spending against a stale balance.

---

## Securing your wallet (encrypt / lock / unlock)

- **Encrypt:** click the lock icon while the wallet is unencrypted, choose a passphrase, confirm. The engine **shuts down and restarts automatically** to apply encryption — this is expected. After that the wallet is encrypted and locked.
- **Unlock:** click the lock icon, enter your passphrase. Needed for staking and sending. A wrong passphrase shakes the box and is rejected.
- **Lock:** click the lock icon again to lock immediately.

> Write your passphrase down and keep it safe. **If you lose it, your coins cannot be recovered** — there is no reset.

---

## Backup & Recovery (important)

You back up and restore from **Settings → Wallet Tools**. There are three tools plus an automatic safety net.

### Backup Wallet  (recommended, do this regularly)
Makes a **copy of `wallet.dat`** — your keys and balances — to a location you choose.

1. **Settings → Backup Wallet.**
2. Enter a **full absolute path** for the copy (no `~`). Example default: `/tmp/wallet-backup-YYYYMMDD.dat` — change it to somewhere permanent, e.g. an external drive.
3. The wallet writes the copy and confirms the path.

Keep this `.dat` file safe and offline. To restore it later, copy it back over `wallet.dat` in your data folder (see locations below) while the wallet is closed.

### Dump Wallet  (text export of your private keys)
Exports **all private keys + addresses** to a human‑readable `.txt` file. Useful for cold storage or moving to another wallet.

1. **Settings → Dump Wallet.**
2. Enter your **wallet passphrase** — it is **always required and verified first**, even if the wallet is currently unlocked. A wrong passphrase is rejected.
3. Enter a **full absolute path** ending in `.txt`.
4. The keys are written to that file. The wallet then re‑locks itself.

> A wallet dump is **plain text and unencrypted** — anyone with the file can take your coins. Store it offline and treat it like cash.

### Import Wallet  (restore from a dump)
Loads keys from a previously dumped `.txt` file back into the wallet.

1. **Settings → Import Wallet.**
2. Enter the **full absolute path** to your `.txt` dump.
3. The engine imports the keys and rescans the chain for matching history (this can take a few minutes; your balance may look incomplete until the rescan finishes).

### Automatic safety backup (during re‑bootstrap)
Whenever the wallet refreshes its chain data from a snapshot, **before** it removes anything it automatically copies your **`wallet.dat`** and **`iocoin.conf`** into:

```
<data folder>/wallet_backup.rebootstrap/<timestamp>/
```

along with a `manifest.json` describing the backup. Chain data is the only thing ever removed; **your keys are never deleted**.

### Open Data Folder
Opens your data directory in your file manager so you can grab `wallet.dat`, the automatic backups, or the logs yourself.

### Explorer
Opens the I/O Coin block explorer (<https://iocexplorer.online/>) in your browser.

---

## Where your files live

| Platform | Data folder |
|----------|-------------|
| **macOS** | `~/Library/Application Support/IOCoin/` |
| **Windows** | `%APPDATA%\IOCoin\`  (`C:\Users\<you>\AppData\Roaming\IOCoin\`) |
| **Linux** | `~/.iocoin/` |

Key files inside it:

| File / folder | What it is |
|---------------|-----------|
| `wallet.dat` | **Your wallet** — keys, addresses, history. **Back this up.** |
| `iocoin.conf` | Engine config (RPC login, supernodes). See below. |
| `wallet_backup.rebootstrap/` | Automatic wallet.dat + conf backups made before each re‑bootstrap |
| `blk0001.dat`, `blk0002.dat`, `blkindex.dat` | Raw blockchain data (replaceable, re‑downloadable) |
| `txleveldb/` | Transaction index (replaceable) |
| `database/` | Wallet database environment (do **not** delete) |
| `aliascache.dat` | DIONS alias cache (rebuilt automatically) |
| `debug.log` | Engine log (used by the splash and Diagnostics) |
| `iocoind.pid` | The running engine's process id |

**Generated `iocoin.conf`** (first run):
```
rpcuser=iocoinrpc
rpcpassword=<random 64-char value>
synctime=0
addnode=amer.supernode.iocoin.io
addnode=emea.supernode.iocoin.io
```
You may add your own settings to this file; the wallet won't overwrite an existing config.

---

## Windows build — extra features

The Windows installer is a dedicated build with several Windows‑specific improvements on top of everything above:

- **Native menu bar** — **File / Edit / Help**. Standard Edit shortcuts (cut/copy/paste/undo) work everywhere.
- **Built‑in Help Center** — press **F1** (or **Help → Wallet Help Center**) to open an in‑app guide with topics: Getting Started, Overview & Sync, Sending I/O, My Addresses, Recipients, Wallet Tools, Security, Restore Wallet, Peer Connections, Troubleshooting. **Esc** closes it.
- **Smarter Send screen** — a **fee mode** toggle ("fee on top" vs "fee included"), a live **payment summary** (recipient receives / network fee / total debited), and a **recipient picker** to drop in a saved address.
- **Runtime self‑check** — before starting the engine it confirms the required DLLs are present next to `iocoind.exe`; if not, it tells you instead of failing silently, and points you to the VC++ Redistributable.
- **No false "failed to start" error** — on first boot the engine can take a while to load the block index; the Windows build proceeds as long as the process is actually alive and lets the UI keep polling.
- **Window handling fixes** — the window is kept on‑screen when moved (title bar can't be lost above the top edge), resizes from the center, restores keyboard focus after resizing, and resets zoom on load so it renders correctly across monitors and Windows DPI scaling settings.
- **Cleaner splash text** — the bootstrap status text wraps correctly and no longer overflows.

> These extras are specific to the Windows installer. The macOS and Linux builds share the same core wallet, daemon management, bootstrap/auto‑re‑bootstrap, and backup tools described above.

---

## Quitting

When you close the window you can choose:

- **Close Wallet Completely** — stops the engine and quits.
- **Close UI Only** — quits the window but leaves the engine running in the background (keeps staking).
- **Cancel** — keep using the wallet.

---

## Troubleshooting

| Symptom | What to do |
|--------|-----------|
| Stuck on **Loading daemon…** for a long time on first run | Normal while the block index loads/bootstrap applies. Open **Show live debug** to watch progress. |
| **0 peers**, not syncing | Supernodes temporarily unreachable, or a local firewall/VPN is blocking port `33764`. Retry / check network. |
| Windows: engine won't start | Install **Microsoft Visual C++ Redistributable (x64)**: <https://aka.ms/vs/17/release/vc_redist.x64.exe> |
| macOS: "Bad CPU type" / engine won't run | Install Rosetta 2: `softwareupdate --install-rosetta --agree-to-license` |
| Balance looks wrong after an import | A chain **rescan** is still running; give it a few minutes. |
| Want to start completely fresh | Close the wallet, back up `wallet.dat`, then you may delete the chain files (`blk*.dat`, `blkindex.dat`, `txleveldb/`) — **never** delete `wallet.dat` or `database/`. |

---

*Verify every download against `SHA256SUMS.txt`. Your `wallet.dat` and your passphrase are the only things that can recover your coins — back them up and keep them safe.*
