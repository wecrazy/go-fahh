import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── State ───────────────────────────────────────────────────────────────────

/** Tracks the error count per file URI so we only react to *new* errors. */
const prevErrorCountByUri = new Map<string, number>();

/**
 * URIs that have received a diagnostic change event and are waiting to be
 * evaluated once the burst of rapid updates has settled.
 */
const pendingUris = new Set<string>();

/** Debounce handle for the diagnostic listener. */
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Output channel for Go Fahh logs — visible in the Output panel. */
let log: vscode.OutputChannel;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    log = vscode.window.createOutputChannel('Go Fahh');
    context.subscriptions.push(log);
    log.appendLine('Go Fahh extension activated.');

    // Watch diagnostics for any file – filter to Go inside the handler.
    //
    // VS Code (and gopls) fires onDidChangeDiagnostics several times in rapid
    // succession for the same save/edit — once per diagnostic source and
    // sometimes with intermediate partial states (e.g. 0 errors, then 2 errors,
    // then 1 error as they settle).  Processing each event individually would
    // play the sound multiple times for a single real error.
    //
    // Fix: collect affected URIs and only evaluate + play after a short quiet
    // period (200 ms).  The count we compare against (prevErrorCountByUri) is
    // the count from *before* the burst, so a net new error is detected
    // correctly even when the count temporarily dips to 0 mid-burst.
    const diagListener = vscode.languages.onDidChangeDiagnostics((event) => {
        const cfg = vscode.workspace.getConfiguration('goFahh');
        if (!cfg.get<boolean>('enabled', true)) {
            return;
        }

        for (const uri of event.uris) {
            if (uri.fsPath.endsWith('.go')) {
                pendingUris.add(uri.toString());
            }
        }

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = undefined;

            let newErrorFound = false;

            for (const uriStr of pendingUris) {
                const uri = vscode.Uri.parse(uriStr);
                const diagnostics = vscode.languages.getDiagnostics(uri);
                const errorCount = diagnostics.filter(
                    (d) => d.severity === vscode.DiagnosticSeverity.Error
                ).length;

                const prevCount = prevErrorCountByUri.get(uriStr) ?? 0;

                if (errorCount > prevCount) {
                    newErrorFound = true;
                }

                prevErrorCountByUri.set(uriStr, errorCount);
            }

            pendingUris.clear();

            if (newErrorFound) {
                playFahh(context);
            }
        }, 200);
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

    // Command: play test sound – shows the output panel so you can see any errors.
    const testCmd = vscode.commands.registerCommand('goFahh.test', () => {
        log.show(true);
        log.appendLine('--- Test Sound triggered ---');
        playFahh(context);
    });

    context.subscriptions.push(diagListener, toggleCmd, testCmd);
}

export function deactivate(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
    }
    pendingUris.clear();
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

    log.appendLine(`Platform: ${process.platform}  |  Volume: ${volume}  |  Sound: ${soundPath}`);

    if (!fs.existsSync(soundPath)) {
        log.appendLine(`ERROR: Sound file not found at "${soundPath}"`);
        log.show(true);
        vscode.window.showErrorMessage(`Go Fahh: sound file not found – check the Output panel (Go Fahh) for details.`);
        return;
    }

    playAudioNative(soundPath, volume);
}

/**
 * Spawn a platform-specific audio player to play an MP3 file in the
 * background without opening any VS Code tab or UI element.
 *
 * - macOS  : `afplay`  (built-in)
 * - Windows: PowerShell + inline C# calling mciSendString (winmm.dll)
 * - Linux  : tries `paplay` → `mpg123` → `ffplay` in order
 */
function playAudioNative(soundPath: string, volume: number): void {
    try {
        switch (process.platform) {
            case 'darwin': {
                const opts: cp.SpawnOptions = { detached: true, stdio: 'ignore' };
                // afplay -v accepts a floating-point multiplier (1.0 = normal)
                const child = cp.spawn('afplay', ['-v', String(volume), soundPath], opts);
                child.unref();
                break;
            }

            case 'win32': {
                // First try: WMPlayer.OCX COM object.
                // Unlike mciSendString this requires NO inline C# compilation
                // (Add-Type -TypeDefinition JIT overhead is ~500–1500 ms), so
                // playback starts noticeably faster.
                //
                // Volume unit for WMPlayer: 0–100 (integer percentage).
                // Volume unit for mciSendString fallback: 0–1000.
                const volPct = Math.round(volume * 100);
                const volInt = Math.round(volume * 1000);

                // The sound path is passed through an environment variable so
                // that backslashes and spaces never need escaping inside the
                // script.
                const ps = [
                    `try {`,
                    `  # Fast path: WMPlayer COM object (no C# compilation needed)`,
                    `  $wmp = New-Object -ComObject WMPlayer.OCX -ErrorAction Stop`,
                    `  $wmp.settings.volume = ${volPct}`,
                    `  $wmp.URL = $env:GOFAHH_PATH`,
                    `  $wmp.controls.play()`,
                    `  # Wait for playback to start (state 3 = Playing)`,
                    `  $start = Get-Date`,
                    `  while ($wmp.playState -ne 3 -and ((Get-Date) - $start).TotalSeconds -lt 5) {`,
                    `    Start-Sleep -Milliseconds 50`,
                    `  }`,
                    `  # Wait for playback to finish (state 1 = Stopped)`,
                    `  $timeout = (Get-Date).AddSeconds(30)`,
                    `  while ($wmp.playState -ne 1 -and (Get-Date) -lt $timeout) {`,
                    `    Start-Sleep -Milliseconds 100`,
                    `  }`,
                    `  $wmp.controls.stop()`,
                    `} catch {`,
                    `  # Fallback: mciSendString via inline C# (slower first call due to JIT)`,
                    `  Add-Type -TypeDefinition @'`,
                    `using System;`,
                    `using System.Runtime.InteropServices;`,
                    `using System.Text;`,
                    `public class WinAudio {`,
                    `    [DllImport("winmm.dll", CharSet=CharSet.Auto)]`,
                    `    public static extern int mciSendString(string cmd, StringBuilder ret, int retLen, IntPtr cb);`,
                    `}`,
                    `'@ -ErrorAction SilentlyContinue`,
                    `  $p = $env:GOFAHH_PATH`,
                    `  $r = [WinAudio]::mciSendString("open ""$p"" type mpegvideo alias snd", $null, 0, [IntPtr]::Zero)`,
                    `  if ($r -ne 0) { throw "mciSendString open failed (code $r)" }`,
                    `  [WinAudio]::mciSendString("setaudio snd volume to ${volInt}", $null, 0, [IntPtr]::Zero) | Out-Null`,
                    `  [WinAudio]::mciSendString("play snd wait", $null, 0, [IntPtr]::Zero) | Out-Null`,
                    `  [WinAudio]::mciSendString("close snd", $null, 0, [IntPtr]::Zero) | Out-Null`,
                    `}`,
                ].join('\r\n');

                // -EncodedCommand expects UTF-16LE base64; avoids any shell-quoting issues.
                const encoded = Buffer.from(ps, 'utf-16le').toString('base64');
                const env = { ...process.env, GOFAHH_PATH: soundPath };

                const child = cp.spawn(
                    'powershell',
                    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
                    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env }
                );

                const errChunks: Buffer[] = [];
                child.stderr?.on('data', (d: Buffer) => { errChunks.push(d); });
                child.stdout?.on('data', (d: Buffer) => {
                    const msg = d.toString().trim();
                    if (msg) { log.appendLine(`[win32 stdout] ${msg}`); }
                });
                child.on('close', (code) => {
                    // Only treat as an error when the process itself failed.
                    // PowerShell sometimes writes a "#< CLIXML" header to stderr
                    // even on success (exit code 0); logging that as an error
                    // produces confusing noise with no actionable information.
                    if (code !== 0) {
                        const errBuf = Buffer.concat(errChunks).toString().trim();
                        log.appendLine(`[win32 error] exit code=${code}  stderr: ${errBuf}`);
                        log.show(true);
                    } else {
                        log.appendLine('[win32] Playback complete.');
                    }
                });
                child.on('error', (err) => {
                    log.appendLine(`[win32 spawn error] ${err.message}`);
                    log.show(true);
                });
                break;
            }

            default: {
                const opts: cp.SpawnOptions = { detached: true, stdio: 'ignore' };
                // Linux / other – try players in order of preference
                spawnWithFallbacks(soundPath, volume, opts);
                break;
            }
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.appendLine(`[error] Failed to start audio: ${msg}`);
        log.show(true);
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
        child.on('exit', (code, signal) => {
            if ((code !== 0 && code !== null) || signal !== null) { advance(); }
        });
        child.unref();
    }

    tryNext(0);
}
