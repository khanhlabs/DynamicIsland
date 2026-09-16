# Dynamic Island for Windows 11

A lightweight, always-on-top Dynamic Island for everyday tasks on Windows 11.

## Features

- Transparent, borderless window that stays above other applications
- Expands when you hover over the header and collapses when the pointer leaves the island
- Draggable position that is remembered between sessions
- Battery percentage and charging status
- System volume control and mute/unmute
- Current media information with previous, play/pause, and next controls
- Current time and date
- Customizable focus and break Pomodoro durations
- Quick actions to lock Windows and open Spotify
- Customizable global keyboard shortcuts
- Launches with Windows by default and remembers when the user turns it off
- System tray controls to show, hide, open Settings, or quit the application
- Native Windows notifications for Pomodoro and battery events
- Signed automatic updates delivered through GitHub Releases
- A power button in the header to quit the application completely

## Install on Windows 11

The easiest option is to install a published release. Node.js and Rust are not required for this method.

1. Open the repository's [latest release](../../releases/latest).
2. Under **Assets**, download the file named like `Dynamic Island_*_x64-setup.exe`.
3. Open the downloaded file and complete the installation.
4. Find **Dynamic Island** in the Start menu and launch it.

Windows 11 normally includes Microsoft Edge WebView2 Runtime. If the application reports that WebView2 is missing, install WebView2 Runtime and launch the application again.

> Personal releases may not be digitally signed, so Windows SmartScreen might display a warning. Only select **More info → Run anyway** when you downloaded the file from a repository you trust.

## Usage

- Hover over the header to open the full dashboard.
- Move the pointer outside the island to collapse it.
- Select the power button in the header to quit the application.
- Open the **Settings** tab to enable launch at startup, choose visible modules, or change keyboard shortcuts.
- Left-click the system tray icon to show or hide the island. Right-click it for Settings and Quit.
- Configure Pomodoro, low-battery, and fully-charged notifications in **Settings**.
- Use **Settings → Update** to check for and install a release manually. The app also checks shortly after startup.

### Default keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` | Show or hide the island |
| `Ctrl+Alt+P` | Play or pause media |
| `Ctrl+Alt+L` | Lock Windows |
| `Ctrl+Alt+S` | Open Spotify |

## Uninstall

Open **Settings → Apps → Installed apps**, find **Dynamic Island**, open its three-dot menu, and select **Uninstall**.

## Run from source

### Requirements

- Node.js LTS
- Rust with the MSVC toolchain
- Visual Studio Build Tools with the **Desktop development with C++** workload
- Microsoft Edge WebView2 Runtime

Clone the repository and start the development build:

```powershell
git clone <REPOSITORY_URL>
cd <REPOSITORY_DIRECTORY>
npm ci
npm run tauri dev
```

## Build an installer

```powershell
npm run tauri build
```

The generated installers are located at:

```text
src-tauri/target/release/bundle/nsis/Dynamic Island_*_x64-setup.exe
src-tauri/target/release/bundle/msi/Dynamic Island_*_x64_en-US.msi
```

The `src-tauri/target/` directory is excluded from Git. Local builds are suitable for testing; publish distributable builds with the signed release workflow below so automatic updates receive the required signature and `latest.json` metadata.

## Publish a signed release

Automatic updates require every update bundle to be signed with the same private key. The release workflow creates the GitHub Release, so do not create a duplicate release or tag manually before running it.

### One-time GitHub setup

1. Back up `.tauri/dynamic-island.key` in a secure location. Losing this key prevents existing installations from accepting future updates.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
3. Select **New repository secret**.
4. Enter `TAURI_SIGNING_PRIVATE_KEY` as the name.
5. Paste the complete contents of `.tauri/dynamic-island.key` as the value and save it.

The private key is excluded from Git. Never commit it, upload it as a release asset, or share it publicly.

### Create a release

1. Choose a new version number, for example `0.2.1`.
2. Set the same version in:
   - `package.json` and `package-lock.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
3. Verify the release locally:

   ```powershell
   npm run build
   cargo test --manifest-path src-tauri/Cargo.toml
   ```

4. Commit and push all release changes to the default branch.
5. On GitHub, open **Actions → Release Dynamic Island**.
6. Select **Run workflow**, choose the branch containing the version change, and confirm **Run workflow**.
7. Wait for the workflow to finish successfully, then open the generated release.
8. Confirm that the release contains the NSIS installer, its updater signature, and `latest.json`.

The workflow in `.github/workflows/release.yml` creates the `v<version>` tag, builds the Windows installer, signs the updater bundle, publishes the release, and uploads the metadata used by installed copies to find new versions.

## Notes

- Media controls use Windows Global System Media Transport Controls. Spotify, Chrome, or Edge must be playing media with media integration enabled.
- Windows notifications display the installed application name and icon. Development builds can display a PowerShell identity instead.
- If another application already uses a default shortcut, change it in the **Settings** tab.
- Only one instance of Dynamic Island can run at a time.
