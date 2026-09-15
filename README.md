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
- Optional launch at Windows startup
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

### Default keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Alt+Space` | Show or hide the island |
| `Ctrl+Alt+M` | Mute or unmute system audio |
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

The `src-tauri/target/` directory is excluded from Git. To let users install the application without building it from source, upload the generated `.exe` or `.msi` file to **GitHub Releases**.

## Notes

- Media controls use Windows Global System Media Transport Controls. Spotify, Chrome, or Edge must be playing media with media integration enabled.
- If another application already uses a default shortcut, change it in the **Settings** tab.
- Only one instance of Dynamic Island can run at a time.
