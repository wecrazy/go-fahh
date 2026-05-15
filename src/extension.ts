import * as vscode from 'vscode';

// ─── State ───────────────────────────────────────────────────────────────────

/** Tracks the error count per file URI so we only react to *new* errors. */
const prevErrorCountByUri = new Map<string, number>();

/** The single persistent WebviewPanel used for audio playback. */
let audioPanel: vscode.WebviewPanel | undefined;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    // Watch diagnostics for any file – filter to Go inside the handler.
    const diagListener = vscode.languages.onDidChangeDiagnostics((event) => {
        const cfg = vscode.workspace.getConfiguration('goFahh');
        if (!cfg.get<boolean>('enabled', true)) {
            return;
        }

        let newErrorFound = false;

        for (const uri of event.uris) {
            if (!uri.fsPath.endsWith('.go')) {
                continue;
            }

            const diagnostics = vscode.languages.getDiagnostics(uri);
            const errorCount = diagnostics.filter(
                (d) => d.severity === vscode.DiagnosticSeverity.Error
            ).length;

            const prevCount = prevErrorCountByUri.get(uri.toString()) ?? 0;

            if (errorCount > prevCount) {
                newErrorFound = true;
            }

            prevErrorCountByUri.set(uri.toString(), errorCount);
        }

        if (newErrorFound) {
            playFahh(context);
        }
    });

    // Command: toggle the extension on/off
    const toggleCmd = vscode.commands.registerCommand('goFahh.toggle', () => {
        const cfg = vscode.workspace.getConfiguration('goFahh');
        const current = cfg.get<boolean>('enabled', true);
        cfg.update('enabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            `Go Fahh sound is now ${!current ? 'ON 🔊' : 'OFF 🔇'}`
        );
    });

    // Command: play test sound
    const testCmd = vscode.commands.registerCommand('goFahh.test', () => {
        playFahh(context);
    });

    context.subscriptions.push(diagListener, toggleCmd, testCmd);
}

export function deactivate(): void {
    if (audioPanel) {
        audioPanel.dispose();
        audioPanel = undefined;
    }
    prevErrorCountByUri.clear();
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

/**
 * Send a play-sound message to the persistent WebviewPanel.
 * Creates the panel if it does not yet exist (e.g. first error or after user closes it).
 */
function playFahh(context: vscode.ExtensionContext): void {
    const cfg = vscode.workspace.getConfiguration('goFahh');
    const volume = cfg.get<number>('volume', 0.7);

    const panel = getOrCreateAudioPanel(context);
    panel.webview.postMessage({ command: 'playFahh', volume });
}

/**
 * Returns the existing WebviewPanel or creates a fresh one.
 * The panel is placed in an inactive column so it does not steal focus.
 */
function getOrCreateAudioPanel(
    context: vscode.ExtensionContext
): vscode.WebviewPanel {
    if (!audioPanel) {
        audioPanel = vscode.window.createWebviewPanel(
            'goFahhAudio',
            '🔊 Go Fahh',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true, // keep AudioContext alive when hidden
            }
        );

        audioPanel.webview.html = buildWebviewHtml();

        audioPanel.onDidDispose(() => {
            audioPanel = undefined;
        }, null, context.subscriptions);
    }

    return audioPanel;
}

// ─── Webview HTML ─────────────────────────────────────────────────────────────

/**
 * Returns the HTML page that lives inside the WebviewPanel.
 *
 * It listens for `{ command: 'playFahh', volume }` messages and synthesises
 * the "Fahh" meme sound entirely via the Web Audio API – no external audio
 * files required.
 *
 * The sound mimics the classic descending "FAAAH" meme drop:
 *   • A buzzy sawtooth oscillator (voice) sweeping 380 Hz → 80 Hz over ~0.6 s
 *   • A low-pass filter that closes quickly, giving that "wah-wah" muffling
 *   • A sub-bass sine thump underneath for impact
 *   • A brief noise burst at the start to simulate the "F" fricative
 */
function buildWebviewHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Go Fahh</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      overflow: hidden;
      user-select: none;
    }
    #mascot {
      font-size: 80px;
      line-height: 1;
      transition: transform 0.05s;
    }
    #label {
      margin-top: 12px;
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 2px;
      color: #569cd6;
    }
    #status {
      margin-top: 8px;
      font-size: 12px;
      color: #6a9955;
      height: 18px;
    }

    /* Shake animation triggered on each fahh */
    @keyframes shake {
      0%   { transform: translate(0,0)   rotate(0deg);   }
      15%  { transform: translate(-8px, 4px) rotate(-6deg);  }
      30%  { transform: translate(8px, -4px) rotate(6deg);   }
      45%  { transform: translate(-6px, 4px) rotate(-4deg);  }
      60%  { transform: translate(6px, -2px) rotate(4deg);   }
      75%  { transform: translate(-3px, 2px) rotate(-2deg);  }
      90%  { transform: translate(3px, -1px) rotate(1deg);   }
      100% { transform: translate(0,0)   rotate(0deg);   }
    }
    .fahh-shake {
      animation: shake 0.55s ease-in-out;
    }
  </style>
</head>
<body>
  <div id="mascot">😱</div>
  <div id="label">GO FAHH</div>
  <div id="status">Ready – awaiting Go errors…</div>

  <script>
    // ── Audio context (lazy-init to respect browser autoplay policy) ──────────
    let ctx = null;

    function getCtx() {
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContext();
      }
      return ctx;
    }

    // ── Fahh sound synthesis ──────────────────────────────────────────────────
    /**
     * Synthesises the "FAAAH" meme sound:
     *   1. Short white-noise burst  → the "F" fricative consonant
     *   2. Sawtooth + low-pass sweep → the descending "AAH" vowel
     *   3. Sub-bass sine thump       → gut-punch impact
     */
    async function playFahh(volume) {
      const ac = getCtx();
      if (ac.state === 'suspended') {
        await ac.resume();
      }

      const now = ac.currentTime;
      const master = ac.createGain();
      master.gain.setValueAtTime(Math.max(0, Math.min(1, volume ?? 0.7)), now);
      master.connect(ac.destination);

      // ── 1. "F" fricative – filtered white noise (0 – 0.06 s) ───────────────
      const bufSize = ac.sampleRate * 0.07;
      const noiseBuffer = ac.createBuffer(1, bufSize, ac.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        noiseData[i] = Math.random() * 2 - 1;
      }
      const noiseSource = ac.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const noiseFilter = ac.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.setValueAtTime(3000, now);

      const noiseGain = ac.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);
      noiseSource.start(now);
      noiseSource.stop(now + 0.07);

      // ── 2. "AAH" vowel – sawtooth + low-pass sweep (0.03 – 0.65 s) ─────────
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      // Frequency sweep: starts around E4 (~330 Hz), drops to ~90 Hz
      osc.frequency.setValueAtTime(330, now + 0.03);
      osc.frequency.setValueAtTime(300, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.62);

      const lpf = ac.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(1800, now + 0.03);
      lpf.frequency.exponentialRampToValueAtTime(280, now + 0.55);
      lpf.Q.setValueAtTime(4, now + 0.03);

      const oscGain = ac.createGain();
      oscGain.gain.setValueAtTime(0.0,  now + 0.03);
      oscGain.gain.linearRampToValueAtTime(0.75, now + 0.07); // attack
      oscGain.gain.setValueAtTime(0.75, now + 0.15);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65); // decay

      osc.connect(lpf);
      lpf.connect(oscGain);
      oscGain.connect(master);
      osc.start(now + 0.03);
      osc.stop(now + 0.68);

      // ── 3. Sub-bass thump – sine (0 – 0.30 s) ───────────────────────────────
      const sub = ac.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(100, now);
      sub.frequency.exponentialRampToValueAtTime(40, now + 0.28);

      const subGain = ac.createGain();
      subGain.gain.setValueAtTime(0.5, now);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

      sub.connect(subGain);
      subGain.connect(master);
      sub.start(now);
      sub.stop(now + 0.32);
    }

    // ── Shake mascot ──────────────────────────────────────────────────────────
    function shakeMascot() {
      const el = document.getElementById('mascot');
      el.classList.remove('fahh-shake');
      // Force reflow so the animation restarts even if already shaking
      void el.offsetWidth;
      el.classList.add('fahh-shake');

      const status = document.getElementById('status');
      status.textContent = '💥 FAHH! Go error detected at ' + new Date().toLocaleTimeString();
    }

    // ── Message listener (from VS Code extension host) ───────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.command === 'playFahh') {
        playFahh(msg.volume);
        shakeMascot();
      }
    });

    // ── Click anywhere to unlock AudioContext (browser autoplay policy) ──────
    document.addEventListener('click', () => {
      const ac = getCtx();
      if (ac.state === 'suspended') {
        ac.resume();
      }
    }, { once: true });
  </script>
</body>
</html>`;
}
