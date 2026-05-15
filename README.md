# Go Fahh 😱🔊

A Visual Studio Code extension that plays the **"Fahh" meme sound effect** the instant a Go error is detected as you type — **zero latency** between the error appearing and the sound firing.

---

## Features

- **Real-time error detection** — uses `onDidChangeDiagnostics` so the sound fires the moment the Go language server (gopls) reports a new error. No save required.
- **Synthesised "Fahh" sound** — the meme's signature descending bass drop is produced entirely via the **Web Audio API** (no audio files needed):
  - A high-frequency noise burst simulates the initial "F" fricative
  - A sawtooth oscillator sweeps from ~330 Hz down to ~90 Hz for the "AAAH" vowel
  - A sub-bass sine thump gives it that gut-punch meme impact
- **Animated mascot panel** — a small panel displays a 😱 emoji that shakes on every fahh.
- **Volume control** — adjust loudness through the setting `goFahh.volume` (0.0 – 1.0).
- **Quick toggle** — use the command palette command `Go Fahh: Toggle Sound On/Off` to mute/unmute without changing any settings.
- **Test command** — `Go Fahh: Test Sound` lets you preview the sound at any time.

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
Web Audio API synthesises "FAAAH" 🔊  +  😱 emoji shakes
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

## License

MIT
