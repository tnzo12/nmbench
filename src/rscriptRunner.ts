import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';

export interface RscriptLoc { path: string; onPath: boolean; }

/**
 * Compare two `R-<version>` directory names so `R-10.0.0` beats `R-4.4.2`.
 * Falls back to lexicographic order for anything the version regex can't
 * parse.  Exported for reuse by tests.
 */
export function compareRVersions(a: string, b: string): number {
    const parse = (name: string): number[] | null => {
        const m = /^R-(\d+(?:\.\d+)*)/i.exec(name);
        if (!m) { return null; }
        return m[1].split('.').map(n => parseInt(n, 10));
    };
    const va = parse(a);
    const vb = parse(b);
    if (!va || !vb) { return a.localeCompare(b); }
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const ai = va[i] ?? 0;
        const bi = vb[i] ?? 0;
        if (ai !== bi) { return ai - bi; }
    }
    return 0;
}

/**
 * Locate the `Rscript` executable across platforms. Order:
 *   1. `nmbench.rscript.executablePath` setting (when set to an existing file)
 *   2. PATH (`where` on Windows, `command -v` elsewhere)
 *   3. Windows-only fallback: standard R install roots
 *      (`C:\Program Files\R\R-*\bin\[x64\]\Rscript.exe`) so users who forgot
 *      "Add R to PATH" during install still work. Versions are sorted
 *      numerically so R-10 > R-4 (a plain `.sort()` would rank them
 *      lexicographically and pick the older one).
 * Returns the absolute path if found, otherwise null.
 */
export function findRscript(): RscriptLoc | null {
    const settingPath = vscode.workspace
        .getConfiguration('nmbench')
        .get<string>('rscript.executablePath', '')
        .trim();
    if (settingPath && fs.existsSync(settingPath)) {
        return { path: settingPath, onPath: false };
    }

    const isWin = process.platform === 'win32';
    const binName = isWin ? 'Rscript.exe' : 'Rscript';
    try {
        const cmd = isWin ? `where ${binName}` : `command -v ${binName}`;
        const out = childProcess.execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], shell: isWin ? undefined : '/bin/sh' }).trim();
        const first = out.split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) { return { path: first, onPath: true }; }
    } catch {
        // not on PATH — fall through to platform-specific lookup
    }
    if (isWin) {
        const roots = ['C:\\Program Files\\R', 'C:\\Program Files (x86)\\R'];
        for (const root of roots) {
            if (!fs.existsSync(root)) { continue; }
            let versions: string[] = [];
            try { versions = fs.readdirSync(root).filter(n => n.startsWith('R-')); } catch { continue; }
            versions.sort(compareRVersions).reverse();
            for (const v of versions) {
                for (const sub of ['bin\\x64', 'bin']) {
                    const candidate = path.join(root, v, sub, 'Rscript.exe');
                    if (fs.existsSync(candidate)) { return { path: candidate, onPath: false }; }
                }
            }
        }
    }
    return null;
}

/**
 * Format the terminal command that runs `Rscript <script>` for the given
 * `RscriptLoc`. The `&` call operator only prefixes fallback absolute-path
 * invocations on Windows because PowerShell (the default shell) treats a bare
 * `"C:\..."` line as a string expression rather than executing it. cmd.exe
 * silently tolerates the leading `&` (empty command + real command);
 * zsh / bash / fish never see it.
 */
export function formatRscriptCommand(loc: RscriptLoc, scriptPath: string): string {
    if (loc.onPath) {
        return `Rscript "${scriptPath}"`;
    }
    if (process.platform === 'win32') {
        return `& "${loc.path}" "${scriptPath}"`;
    }
    return `"${loc.path}" "${scriptPath}"`;
}

/**
 * Locate Rscript and run the given script file in a fresh terminal. Returns
 * true if the terminal was spawned. On failure to find Rscript, shows an
 * error prompt pointing at CRAN and returns false.
 */
export function runRscriptFileInTerminal(scriptPath: string, cwd: string, terminalName?: string): boolean {
    const loc = findRscript();
    if (!loc) {
        const install = 'Open CRAN download page';
        vscode.window.showErrorMessage(
            'Rscript could not be found. Install R first — on Windows, be sure to tick "Add R to PATH" during the installer.',
            install
        ).then(choice => {
            if (choice === install) {
                vscode.env.openExternal(vscode.Uri.parse('https://cran.r-project.org/'));
            }
        });
        return false;
    }
    const term = vscode.window.createTerminal({ name: terminalName ?? path.basename(scriptPath), cwd });
    term.show(true);
    term.sendText(formatRscriptCommand(loc, scriptPath));
    return true;
}
