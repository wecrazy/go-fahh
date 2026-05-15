# Go Fahh 😱🔊

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/go-fahh.go-fahh?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=go-fahh.go-fahh)
[![CI](https://github.com/wecrazy/go-fahh/actions/workflows/ci.yml/badge.svg)](https://github.com/wecrazy/go-fahh/actions/workflows/ci.yml)

A Visual Studio Code extension that plays the **"Fahh" meme sound effect** the instant a Go error is detected as you type — **zero latency** between the error appearing and the sound firing.

---

## Features

- **Real-time error detection** — uses `onDidChangeDiagnostics` so the sound fires the moment the Go language server (gopls) reports a new error. No save required.
- **Uses the requested "Fahh" clip** — the extension plays the Myinstants sound effect from the original page <https://www.myinstants.com/en/instant/fahhhhhhhhhhhhhh-3525/> using its direct MP3 source at <https://www.myinstants.com/media/sounds/fahhhhhhhhhhhhhh.mp3>.
- **Animated mascot panel** — a small panel displays a 😱 emoji that shakes on every fahh.
- **Volume control** — adjust loudness through the setting `goFahh.volume` (0.0 – 1.0).
- **Quick toggle** — use the command palette command `Go Fahh: Toggle Sound On/Off` to mute/unmute without changing any settings.
- **Test command** — `Go Fahh: Test Sound` lets you preview the sound at any time.

---

## Installation

### From the VS Code Marketplace (recommended)

Search **"Go Fahh"** in the Extensions panel (`Ctrl+Shift+X`) or go directly to:

> <https://marketplace.visualstudio.com/items?itemName=go-fahh.go-fahh>

### From a VSIX file (alternative)

Download `go-fahh-<version>.vsix` from the [latest GitHub Release](https://github.com/wecrazy/go-fahh/releases/latest), then:

1. Open VS Code → `Ctrl+Shift+X` → `…` (top-right) → **Install from VSIX…**
2. Select the downloaded file.

---

## Requirements

- VS Code **1.74+**
- The [Go extension](https://marketplace.visualstudio.com/items?itemName=golang.go) (or any Go language server such as **gopls**) should be installed so that errors are surfaced as diagnostics.

---

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `goFahh.enabled` | `true` | Enable / disable the sound effect |
| `goFahh.volume` | `0.7` | Volume (0.0 – 1.0) |

---

## Usage

1. Install the extension.
2. Open a `.go` file.
3. Type code that causes a Go error — the "Fahh" panel opens automatically and plays the sound the moment the error is detected.
4. Fix the error — silence returns.

> **First-run note:** Modern browsers (including VS Code's webview) may require at least one user interaction before an `AudioContext` can start. If the sound doesn't play on the very first error, click anywhere inside the **Go Fahh** panel once to unlock audio, then trigger the error again.

---

## Commands

| Command | Description |
|---------|-------------|
| `Go Fahh: Toggle Sound On/Off` | Mute / unmute the sound globally |
| `Go Fahh: Test Sound` | Play the Fahh sound immediately (for testing) |

---

## How it works

```
Go file edited
      │
      ▼
gopls / language server detects error
      │
      ▼
VS Code fires `onDidChangeDiagnostics`
      │  (extension compares new error count > previous count)
      ▼
WebviewPanel receives `postMessage({ command: 'playFahh', volume })`
      │
      ▼
Webview plays the requested "FAHH" clip 🔊  +  😱 emoji shakes
```

---

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode (auto-recompile on save)
npm run watch
```

Open the project in VS Code and press **F5** to launch the Extension Development Host.

---

## Publishing to the VS Code Marketplace

The GitHub Actions [release workflow](.github/workflows/release.yml) handles publishing automatically when you push a version tag.

### One-time setup

1. **Create a publisher account** at <https://marketplace.visualstudio.com/manage>.  
   The publisher ID must match the `"publisher"` field in `package.json` (`go-fahh`).

2. **Generate a Personal Access Token (PAT)**  
   Go to <https://dev.azure.com> → *User Settings* → *Personal access tokens*.  
   Scope: **Marketplace → Manage** (full access).  
   Copy the token — it is shown only once.

3. **Add the PAT as a repository secret**  
   GitHub repo → *Settings* → *Secrets and variables* → *Actions* → **New repository secret**:  
   - Name: `VSCE_PAT`  
   - Value: *your PAT*

### Releasing a new version

```bash
# Bump the version in package.json (patch | minor | major)
npm version patch          # → 0.1.1

# Push the commit and the new tag
git push && git push --tags
```

The release workflow will:
1. Compile and package the `.vsix`
2. Publish to the VS Code Marketplace (if `VSCE_PAT` secret is set)
3. Create a GitHub Release with the `.vsix` attached

---

## License

MIT
