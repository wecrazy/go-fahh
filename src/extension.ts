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
        const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
        audioPanel = vscode.window.createWebviewPanel(
            'goFahhAudio',
            '🔊 Go Fahh',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [mediaRoot],
                retainContextWhenHidden: true, // keep AudioContext alive when hidden
            }
        );

        const soundUri = audioPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(mediaRoot, 'fahhh.mp3')
        );
        audioPanel.webview.html = buildWebviewHtml(soundUri.toString());

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
 * It listens for `{ command: 'playFahh', volume }` messages and plays the
 * bundled "Fahh" sound effect.
 */
function buildWebviewHtml(soundUrl: string): string {
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
  <audio id="fahh-audio" preload="auto"></audio>

  <script>
    const soundUrl = ${JSON.stringify(soundUrl)};
    const audioUnlockPrompt = 'Click inside the panel once to enable audio playback.';
    const audioUnlockedStatus = 'Audio unlocked – awaiting Go errors…';
    const audioLoadErrorStatus = 'Unable to load the bundled Fahh sound clip.';
    const audio = document.getElementById('fahh-audio');
    const status = document.getElementById('status');
    let audioLoadFailed = false;
    audio.src = soundUrl;
    audio.addEventListener('error', () => {
      audioLoadFailed = true;
      status.textContent = audioLoadErrorStatus;
      console.error('Unable to load Fahh sound', audio.error);
    });

    async function playFahh(volume) {
      if (audioLoadFailed) {
        status.textContent = audioLoadErrorStatus;
        return;
      }

      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(0, Math.min(1, volume ?? 0.7));

      try {
        await audio.play();
      } catch (error) {
        status.textContent = audioUnlockPrompt;
        console.error('Unable to play Fahh sound', error);
      }
    }

    // ── Shake mascot ──────────────────────────────────────────────────────────
    function shakeMascot() {
      const el = document.getElementById('mascot');
      el.classList.remove('fahh-shake');
      // Force reflow so the animation restarts even if already shaking
      void el.offsetWidth;
      el.classList.add('fahh-shake');

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

    // ── Click anywhere to unlock HTML audio playback ──────────────────────────
    document.addEventListener('click', async () => {
      try {
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        status.textContent = audioUnlockedStatus;
      } catch (error) {
        audio.muted = false;
        console.error('Unable to unlock Fahh audio', error);
      }
    }, { once: true });
  </script>
</body>
</html>`;
}
