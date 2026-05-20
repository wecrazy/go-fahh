import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * How long (ms) to keep the PowerShell audio process alive on Windows.
 * The fahh clip is ~3 s; 5 s gives a comfortable buffer.
 */
const AUDIO_PLAYBACK_TIMEOUT_MS = 5000;


// ─── State ───────────────────────────────────────────────────────────────────

/** Tracks the error count per file URI so we only react to *new* errors. */
const prevErrorCountByUri = new Map<string, number>();

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
    prevErrorCountByUri.clear();
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

/**
 * Play the Fahh sound using the native OS audio player.
 * No WebviewPanel or tab is opened — audio runs entirely in the background.
 */
function playFahh(context: vscode.ExtensionContext): void {
    const cfg = vscode.workspace.getConfiguration('goFahh');
    const volume = cfg.get<number>('volume', 0.7);
    const soundPath = path.join(context.extensionPath, 'media', 'fahhh.mp3');

    playAudioNative(soundPath, volume);
}

/**
 * Spawn a platform-specific audio player to play an MP3 file in the
 * background without opening any VS Code tab or UI element.
 *
 * - macOS  : `afplay`  (built-in)
 * - Windows: PowerShell `System.Windows.Media.MediaPlayer`
 * - Linux  : tries `paplay` → `mpg123` → `ffplay` in order
 */
function playAudioNative(soundPath: string, volume: number): void {
    try {
        const opts: cp.SpawnOptions = { detached: true, stdio: 'ignore' };

        switch (process.platform) {
            case 'darwin': {
                // afplay -v accepts a floating-point multiplier (1.0 = normal)
                const child = cp.spawn('afplay', ['-v', String(volume), soundPath], opts);
                child.unref();
                break;
            }

            case 'win32': {
                // Use PowerShell's WPF MediaPlayer – hidden window, no extra installs needed.
                const safePath = soundPath.replace(/\\/g, '/');
                const script = [
                    'Add-Type -AssemblyName PresentationCore;',
                    `$p = New-Object System.Windows.Media.MediaPlayer;`,
                    `$p.Open([Uri]'file:///${safePath}');`,
                    `$p.Volume = ${volume};`,
                    // Poll until NaturalDuration is available (media is loaded) or 3 s pass.
                    `$i = 0; while ($p.NaturalDuration.HasTimeSpan -eq $false -and $i -lt 30) { Start-Sleep -Milliseconds 100; $i++ };`,
                    `$p.Play();`,
                    `Start-Sleep -Milliseconds ${AUDIO_PLAYBACK_TIMEOUT_MS};`,
                ].join(' ');
                const child = cp.spawn(
                    'powershell',
                    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
                    { ...opts, windowsHide: true }
                );
                child.unref();
                break;
            }

            default: {
                // Linux / other – try players in order of preference
                spawnWithFallbacks(soundPath, volume, opts);
                break;
            }
        }
    } catch {
        // Audio is non-critical; silently swallow any spawn errors.
    }
}

/**
 * On Linux, try audio players one by one until one succeeds.
 * Preference order: paplay (PulseAudio/PipeWire) → mpg123 → ffplay
 *
 * Volume mappings:
 *  - paplay  : --volume 0–65536 (65536 = 100 %)
 *  - mpg123  : -f 0–32768 (32768 = 100 %)
 *  - ffplay  : -volume 0–100
 */
function spawnWithFallbacks(soundPath: string, volume: number, opts: cp.SpawnOptions): void {
    const paVolume = String(Math.round(volume * 65536));
    const mpg123Scale = String(Math.round(volume * 32768));
    const ffVolume = String(Math.round(volume * 100));

    const players: Array<{ cmd: string; args: string[] }> = [
        { cmd: 'paplay', args: [`--volume=${paVolume}`, soundPath] },
        { cmd: 'mpg123', args: ['-q', '-f', mpg123Scale, soundPath] },
        { cmd: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', ffVolume, soundPath] },
    ];

    function tryNext(index: number): void {
        if (index >= players.length) {
            return;
        }
        const { cmd, args } = players[index];
        const child = cp.spawn(cmd, args, opts);

        // Guard so that 'error' (ENOENT) and 'exit' (non-zero) don't both
        // trigger the fallback when a command is simply not installed.
        let advanced = false;
        const advance = () => {
            if (!advanced) {
                advanced = true;
                tryNext(index + 1);
            }
        };

        child.on('error', advance);
        child.on('exit', (code) => { if (code !== 0 && code !== null) { advance(); } });
        child.unref();
    }

    tryNext(0);
}
