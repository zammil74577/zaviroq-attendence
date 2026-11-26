# Zaviroq Desktop Agent

Lightweight Tauri v2 tray app for Windows (`.msi` / `.exe` x64) and macOS (`.dmg` universal) that reports OS presence (`active`, `idle`, `break`) to Zaviroq Workforce.

## Privacy Guarantee
The Desktop Agent **never** captures screenshots, keystrokes, mouse coordinates, window titles, URLs, or application names.
- **Windows:** reads OS idle duration via `GetLastInputInfo` + `GetTickCount`.
- **macOS:** reads OS idle duration via `CGEventSourceSecondsSinceLastEventType`.
- **Token storage:** the long-lived `device_token` is stored exclusively in the OS keychain (Windows Credential Manager / macOS Keychain), never in plain files.

## Local Build Prerequisites
1. Install Node.js 20+ and Rust (`rustup`).
2. On Windows: install Visual Studio C++ Build Tools + WebView2.
3. On macOS: install Xcode Command Line Tools and add both targets:
   ```bash
   rustup target add aarch64-apple-darwin x86_64-apple-darwin
   ```
4. Build:
   ```bash
   cd desktop-agent
   npm install
   npm run build
   ```
   Unit tests for OS idle debouncing and 8-hour offline queue replay:
   ```bash
   cd desktop-agent/src-tauri
   cargo test
   ```

## Code Signing & Auto-Updater Setup (GitHub Actions)
Do **not** commit private keys or certificates to the repository. Configure these GitHub Repository Secrets before tagging `desktop-v1.0.0`:

### 1. Tauri Updater Signing Keys
Generate a keypair locally:
```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/zaviroq.key
```
- Put the **public key** into `desktop-agent/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
- Save the **private key** and password in GitHub Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 2. macOS Developer ID & Notarization
- `APPLE_CERTIFICATE`: base64-encoded `.p12` Developer ID Application certificate
- `APPLE_CERTIFICATE_PASSWORD`: `.p12` export password
- `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Zaviroq Inc (TEAMID)`
- `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`

### 3. Windows Code Signing (EV/OV Certificate)
- Configure your Windows EV/OV certificate thumbprint or Azure Trusted Signing / DigiCert KeyLocker in `.github/workflows/release-desktop-agent.yml` and `tauri.conf.json` (`bundle.windows.certificateThumbprint`).

## Employee Install Guide
1. Download the installer from **Admin Settings → Desktop App** (or the GitHub Releases page).
2. Run the Windows `.msi`/`.exe` installer or drag **Zaviroq Workforce** to Applications on macOS.
3. Open the app and sign in with your **Employee Code + PIN**, or generate a 6-digit pairing code from **Connect desktop app** in your web dashboard (valid for 10 minutes).
4. Once connected, **Auto-start when I sign in** is enabled by default and can be toggled in the app window.
