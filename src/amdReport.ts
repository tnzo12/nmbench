import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * nmbench — AMD Report (Phase 1)
 * ---------------------------------------------------------------------------
 * Renders a self-contained HTML report from a pharmpy tool context directory
 * on disk. Workaround for pharmpy's built-in report generator crashing on
 * Windows under reticulate (issue pharmpy/pharmpy#3399).
 *
 * Real pharmpy 2.x layout (observed):
 *   amd1/
 *   ├── metadata.json         (nested: tool_options / common_options / dispatching_options / stats / seed)
 *   ├── log.csv               (path,time,severity,message  — broadcaster messages)
 *   ├── annotations
 *   ├── models/               (symlinks: base, final_<subtool>, ...)
 *   ├── subcontexts/          (subtool sub-contexts, recursive)
 *   │   └── modelsearch/
 *   │       ├── metadata.json
 *   │       ├── results.json  (pandas orient='table': {schema.fields[], data[]})
 *   │       ├── results.csv
 *   │       ├── results.html
 *   │       ├── models/       (symlinks: base, final, input, modelsearch_run1..N, ...)
 *   │       └── subcontexts/
 *   └── .modeldb/             (content-addressed model store)
 *
 * We treat any directory containing `metadata.json` AND (`subcontexts/` OR
 * `models/` OR `results.json`) as a pharmpy tool context — same detector
 * accepts the AMD root and each subtool.
 */

interface PandasField { name: string; type?: string; }
interface PandasTable {
    schema?: { fields?: PandasField[] };
    data?: Record<string, unknown>[];
    __class__?: string;
}

interface AmdMetadata {
    pharmpy_version?: string;
    tool_name?: string;
    stats?: { start_time?: string; end_time?: string };
    tool_options?: {
        modeltype?: string;
        administration?: string;
        cl_init?: number;
        vc_init?: number;
        mat_init?: number;
        search_space?: string | null;
        strategy?: string;
        [key: string]: unknown;
    };
    common_options?: { esttool?: string };
    dispatching_options?: {
        broadcaster?: string;
        dispatcher?: string;
        ncores?: number;
        [key: string]: unknown;
    };
    seed?: number;
    [key: string]: unknown;
}

interface DerivedAnalysis {
    name: string;
    kind: 'vpc' | 'bootstrap' | 'simulation';
    dirAbs: string;
    reportHtmlAbs?: string;
}
interface ModelEntry { name: string; targetAbs: string; files: string[]; analyses: DerivedAnalysis[]; }

/**
 * pharmpy stores standalone tool results (VPC, Bootstrap, Simulation) as
 * pharmpy contexts nested INSIDE the target model's `.modeldb/<hash>/`
 * directory — e.g. `<hash>/vpc2/`. Discover these so the report can link
 * straight to them without the user hunting through opaque hash dirs.
 */
const DERIVED_RE = /^(vpc|bootstrap|simulation)(\d+)?$/i;
async function findDerivedAnalyses(modelDir: string): Promise<DerivedAnalysis[]> {
    try {
        const entries = await fs.promises.readdir(modelDir, { withFileTypes: true });
        const out: DerivedAnalysis[] = [];
        for (const ent of entries) {
            if (!(ent.isDirectory() || ent.isSymbolicLink())) { continue; }
            if (!isPharmpyRelevantName(ent.name)) { continue; }
            const m = DERIVED_RE.exec(ent.name);
            if (!m) { continue; }
            const kind = m[1].toLowerCase() as 'vpc' | 'bootstrap' | 'simulation';
            const dirAbs = path.join(modelDir, ent.name);
            const htmlPath = path.join(dirAbs, 'results.html');
            let reportHtmlAbs: string | undefined;
            try { await fs.promises.stat(htmlPath); reportHtmlAbs = htmlPath; } catch { /* absent */ }
            out.push({ name: ent.name, kind, dirAbs, reportHtmlAbs });
        }
        return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
        return [];
    }
}

interface SubcontextData {
    name: string;
    dirAbs: string;
    metadata?: AmdMetadata;
    results?: Record<string, unknown>;
    hasResultsHtml: boolean;
    modelDirs: ModelEntry[];
}

interface LogEntry { path: string; time: string; severity: string; message: string; }

interface AmdData {
    folderUri: vscode.Uri;
    folderName: string;
    metadata?: AmdMetadata;
    modelSymlinks: ModelEntry[];
    subcontexts: SubcontextData[];
    log: LogEntry[];
    hasResultsHtml: boolean;
}

/**
 * Directory qualifies as a pharmpy tool context. We match pharmpy's own
 * detector (LocalDirectoryContext.exists in workflows/contexts/local_directory.py):
 * requires a `subcontexts/` directory AND an `annotations` file. Same test
 * accepts the AMD root and every nested subcontext.
 */
export async function isAmdFolder(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await fs.promises.stat(uri.fsPath);
        if (!stat.isDirectory()) { return false; }
        const files = await fs.promises.readdir(uri.fsPath);
        return files.includes('subcontexts') && files.includes('annotations');
    } catch {
        return false;
    }
}

/**
 * Anything a normal pharmpy run does not create. Keeps macOS / Windows / IDE
 * junk out of every listing we walk.
 */
function isPharmpyRelevantName(name: string): boolean {
    if (!name || name.startsWith('.')) { return false; } // hidden (.DS_Store, .modeldb, .pharmpy)
    if (name === 'Thumbs.db' || name === 'desktop.ini') { return false; } // Windows Explorer junk
    if (name.endsWith('.lock')) { return false; } // pharmpy lock files (log.lock, annotations.lock)
    return true;
}

/**
 * pharmpy serializes THETA bounds and similar with Python-style `Infinity`,
 * `-Infinity`, and `NaN`, which are NOT valid RFC 8259 JSON — `JSON.parse`
 * throws on them. Walk the text with a tiny state machine that only touches
 * these tokens outside of string literals and rewrites them as `null`.
 */
function scrubNonStandardJson(text: string): string {
    let out = '';
    let inString = false;
    let escape = false;
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (inString) {
            out += c;
            if (escape) { escape = false; }
            else if (c === '\\') { escape = true; }
            else if (c === '"') { inString = false; }
            i++;
            continue;
        }
        if (c === '"') { out += c; inString = true; i++; continue; }
        if (text.startsWith('-Infinity', i)) { out += 'null'; i += 9; continue; }
        if (text.startsWith('Infinity', i)) { out += 'null'; i += 8; continue; }
        if (text.startsWith('NaN', i)) { out += 'null'; i += 3; continue; }
        out += c; i++;
    }
    return out;
}

async function loadJson<T>(filePath: string): Promise<T | undefined> {
    try {
        const buf = await fs.promises.readFile(filePath, 'utf-8');
        try {
            return JSON.parse(buf) as T;
        } catch {
            // Retry after replacing Infinity/NaN literals with null
            return JSON.parse(scrubNonStandardJson(buf)) as T;
        }
    } catch {
        return undefined;
    }
}

/**
 * Naive CSV row parser that handles the pharmpy log.csv shape
 * (path,time,severity,message with quoted messages that may contain commas
 * and doubled "" for escaped quotes). Not a general CSV parser.
 */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuote) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else { inQuote = false; }
            } else { cell += c; }
        } else {
            if (c === '"') { inQuote = true; }
            else if (c === ',') { row.push(cell); cell = ''; }
            else if (c === '\n') {
                row.push(cell); cell = '';
                if (row.length > 1 || row[0]) { rows.push(row); }
                row = [];
            } else if (c === '\r') {
                // skip
            } else { cell += c; }
        }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

async function loadLog(folder: string): Promise<LogEntry[]> {
    try {
        const txt = await fs.promises.readFile(path.join(folder, 'log.csv'), 'utf-8');
        const rows = parseCsv(txt);
        if (rows.length < 2) { return []; }
        const header = rows[0].map(h => h.trim());
        const idx = {
            path: header.indexOf('path'),
            time: header.indexOf('time'),
            severity: header.indexOf('severity'),
            message: header.indexOf('message'),
        };
        return rows.slice(1)
            .filter(r => r.length >= 2)
            .map(r => ({
                path: idx.path >= 0 ? r[idx.path] : '',
                time: idx.time >= 0 ? r[idx.time] : '',
                // Normalize to lower-case here so downstream filter / CSS
                // class lookups aren't sensitive to broadcaster casing quirks.
                severity: (idx.severity >= 0 ? r[idx.severity] : '').toLowerCase(),
                message: idx.message >= 0 ? r[idx.message] : '',
            }));
    } catch {
        return [];
    }
}

async function loadModelSymlinks(folder: string): Promise<ModelEntry[]> {
    try {
        const dir = path.join(folder, 'models');
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const out: ModelEntry[] = [];
        for (const ent of entries) {
            if (!isPharmpyRelevantName(ent.name)) { continue; }
            // pharmpy stores models as symlinks (into .modeldb/<hash>/) but
            // in unusual cases they may be real dirs.
            if (!ent.isSymbolicLink() && !ent.isDirectory()) { continue; }
            try {
                const targetAbs = await fs.promises.realpath(path.join(dir, ent.name));
                // Read the actual files the model dir contains so the report
                // links to what really exists (not a hardcoded list). Filter
                // pharmpy junk (.pharmpy, .lock, .DS_Store, ...) and keep only
                // real files, sorted so *.lst appears first.
                let files: string[] = [];
                try {
                    const inner = await fs.promises.readdir(targetAbs, { withFileTypes: true });
                    files = inner
                        .filter(f => f.isFile() && isPharmpyRelevantName(f.name))
                        .map(f => f.name)
                        .sort((a, b) => {
                            const rank = (n: string) => n.endsWith('.lst') ? 0
                                : n.endsWith('.ctl') || n.endsWith('.mod') ? 1
                                : n.endsWith('.ext') ? 2
                                : n.endsWith('.phi') ? 3
                                : 9;
                            const ra = rank(a), rb = rank(b);
                            return ra !== rb ? ra - rb : a.localeCompare(b);
                        });
                } catch {
                    // model dir vanished — skip files but keep the symlink entry
                }
                const analyses = await findDerivedAnalyses(targetAbs);
                out.push({ name: ent.name, targetAbs, files, analyses });
            } catch {
                // dangling symlink — skip
            }
        }
        return out;
    } catch {
        return [];
    }
}

async function loadSubcontext(folder: string, name: string): Promise<SubcontextData> {
    const dirAbs = path.join(folder, 'subcontexts', name);
    const metadata = await loadJson<AmdMetadata>(path.join(dirAbs, 'metadata.json'));
    const results = await loadJson<Record<string, unknown>>(path.join(dirAbs, 'results.json'));
    let hasResultsHtml = false;
    try {
        await fs.promises.stat(path.join(dirAbs, 'results.html'));
        hasResultsHtml = true;
    } catch {
        // no HTML
    }
    const modelDirs = await loadModelSymlinks(dirAbs);
    return { name, dirAbs, metadata, results, hasResultsHtml, modelDirs };
}

async function loadAmdData(uri: vscode.Uri): Promise<AmdData> {
    const folder = uri.fsPath;
    const folderName = path.basename(folder);
    const metadata = await loadJson<AmdMetadata>(path.join(folder, 'metadata.json'));
    const log = await loadLog(folder);
    const modelSymlinks = await loadModelSymlinks(folder);
    let subcontextNames: string[] = [];
    try {
        const entries = await fs.promises.readdir(path.join(folder, 'subcontexts'), { withFileTypes: true });
        subcontextNames = entries
            .filter(e => (e.isDirectory() || e.isSymbolicLink()) && isPharmpyRelevantName(e.name))
            .map(e => e.name);
    } catch {
        // no subcontexts dir
    }
    const subcontexts = await Promise.all(subcontextNames.map(n => loadSubcontext(folder, n)));
    let hasResultsHtml = false;
    try {
        await fs.promises.stat(path.join(folder, 'results.html'));
        hasResultsHtml = true;
    } catch { /* none */ }
    return { folderUri: uri, folderName, metadata, modelSymlinks, subcontexts, log, hasResultsHtml };
}

function escapeR(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const ENV_PREAMBLE = `local({
  Sys.setenv(PYTHONUNBUFFERED = "1")
  if (nzchar(Sys.getenv("RETICULATE_PYTHON")) &&
      !grepl("r-reticulate", Sys.getenv("RETICULATE_PYTHON"), fixed = TRUE)) {
    Sys.unsetenv("RETICULATE_PYTHON")
  }
  reticulate::use_condaenv("r-reticulate", required = TRUE)
  if (Sys.info()[["sysname"]] == "Darwin") {
    for (b in c("/opt/homebrew/bin", "/usr/local/bin")) {
      if (dir.exists(b) && !grepl(b, Sys.getenv("PATH"), fixed = TRUE)) {
        Sys.setenv(PATH = paste0(b, ":", Sys.getenv("PATH")))
      }
    }
    sdk <- tryCatch(system2("xcrun", "--show-sdk-path",
                            stdout = TRUE, stderr = FALSE),
                    error = function(e) character(0))
    if (length(sdk) && dir.exists(sdk[[1]])) Sys.setenv(SDKROOT = sdk[[1]])
  }
})`;

function generateVpcScript(modelPath: string, label: string): string {
    return `# Auto-generated by nmbench — VPC on ${label} final model
# Reads the model + fit results directly from disk so this stays runnable
# even when run_amd() crashed at the report step on Windows.

# Environment setup (managed by nmbench — do not edit) ----
${ENV_PREAMBLE}

# Run ----
library(pharmr)
setwd(dirname("${escapeR(modelPath)}"))

model   <- read_model("${escapeR(modelPath)}")
results <- read_modelfit_results("${escapeR(modelPath)}")

vpc_result <- run_vpc(
  model   = model,
  results = results,
  samples = 300
)

if (!is.null(vpc_result)) {
  message("VPC finished. Open the vpc* folder next to this script from nmbench BROWSER to view the plot.")
} else {
  message("VPC did not return a result — check errors above.")
}
`;
}

function generateBootstrapScript(modelPath: string, label: string): string {
    return `# Auto-generated by nmbench — Bootstrap on ${label} final model
# Reads the model + fit results directly from disk so this stays runnable
# even when run_amd() crashed at the report step on Windows.

# Environment setup (managed by nmbench — do not edit) ----
${ENV_PREAMBLE}

# Run ----
library(pharmr)
setwd(dirname("${escapeR(modelPath)}"))

model   <- read_model("${escapeR(modelPath)}")
results <- read_modelfit_results("${escapeR(modelPath)}")

boot_result <- run_bootstrap(
  model   = model,
  results = results,
  samples = 200
)

if (!is.null(boot_result)) {
  message("Bootstrap finished. Open the bootstrap* folder next to this script from nmbench BROWSER to view results.")
} else {
  message("Bootstrap did not return a result — check errors above.")
}
`;
}

/** Walk up from a model file until we find the directory holding .modeldb. That is the AMD run root; untitled scripts anchor there so Save As lands next to the run. Uses parent-equals-self as the termination condition so relative paths (`.` etc.) can't spin forever. */
function findRunRoot(modelPath: string): string {
    let cur = path.dirname(modelPath);
    while (true) {
        if (fs.existsSync(path.join(cur, '.modeldb'))) { return cur; }
        const parent = path.dirname(cur);
        if (parent === cur) { break; } // reached filesystem root (or relative-path base)
        cur = parent;
    }
    return path.dirname(modelPath);
}

async function openGeneratedScript(scriptText: string, baseName: string, anchorDir: string): Promise<void> {
    let uri = vscode.Uri.file(path.join(anchorDir, baseName)).with({ scheme: 'untitled' });
    let n = 2;
    while (
        vscode.workspace.textDocuments.some(d => d.uri.toString() === uri.toString())
        || fs.existsSync(uri.fsPath)
    ) {
        const withCounter = baseName.replace(/\.R$/, '_' + n + '.R');
        uri = vscode.Uri.file(path.join(anchorDir, withCounter)).with({ scheme: 'untitled' });
        n++;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), scriptText);
    await vscode.workspace.applyEdit(edit);
    await vscode.languages.setTextDocumentLanguage(doc, 'r');
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
}

interface VegaScripts { vega: string; vegaLite: string; vegaEmbed: string; }

/**
 * Export the current report as a self-contained .html file. The three Vega
 * libraries are read from the extension resources and inlined so the file
 * works offline in any browser — no CDN, no VS Code webview API. Interactive
 * hooks that only make sense inside VS Code (openFile, revealFolder,
 * generateVpc, ...) are still emitted but silently no-op when the file is
 * loaded outside a webview, since `acquireVsCodeApi` is absent.
 */
async function exportReportToHtml(folderUri: vscode.Uri, extensionUri: vscode.Uri, folderName: string): Promise<void> {
    const vegaDir = vscode.Uri.joinPath(extensionUri, 'resources', 'lib', 'vega');
    const dec = new TextDecoder('utf-8');
    const readOne = async (name: string): Promise<string> =>
        dec.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vegaDir, name)));
    let inlineScripts: VegaScripts;
    try {
        inlineScripts = {
            vega: await readOne('vega.min.js'),
            vegaLite: await readOne('vega-lite.min.js'),
            vegaEmbed: await readOne('vega-embed.min.js'),
        };
    } catch (err) {
        vscode.window.showErrorMessage(`Could not read bundled Vega libraries: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    const data = await loadAmdData(folderUri);
    const html = renderReport(data, inlineScripts, /* standalone */ true);
    const suggested = `${folderName || 'amd'}_report.html`;
    // Default to saving next to the AMD folder so the user sees the file
    // right alongside the pharmpy run it describes.
    const defaultDir = path.dirname(folderUri.fsPath);
    const dest = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(defaultDir, suggested)),
        filters: { 'HTML files': ['html'] },
        saveLabel: 'Export AMD Report',
    });
    if (!dest) { return; }
    try {
        await vscode.workspace.fs.writeFile(dest, Buffer.from(html, 'utf-8'));
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to write ${dest.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    const openAction = 'Open in browser';
    const revealAction = 'Reveal in Explorer';
    const pick = await vscode.window.showInformationMessage(
        `Exported to ${path.basename(dest.fsPath)}.`,
        openAction, revealAction
    );
    if (pick === openAction) { vscode.env.openExternal(dest); }
    else if (pick === revealAction) { vscode.commands.executeCommand('revealFileInOS', dest); }
}

function vegaScriptUris(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): VegaScripts {
    const asUri = (p: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'lib', 'vega', p)).toString();
    return { vega: asUri('vega.min.js'), vegaLite: asUri('vega-lite.min.js'), vegaEmbed: asUri('vega-embed.min.js') };
}

// Reuse one panel per folder path so successive Report clicks focus rather
// than pile up tabs; disposed panels are removed from the map.
const openPanels = new Map<string, vscode.WebviewPanel>();

export async function openAmdReport(uri: vscode.Uri, extensionUri: vscode.Uri): Promise<void> {
    if (!(await isAmdFolder(uri))) {
        const proceed = 'Open anyway';
        const pick = await vscode.window.showWarningMessage(
            `This folder doesn't look like a pharmpy tool context (no metadata.json + subcontexts/models/results).`,
            proceed
        );
        if (pick !== proceed) { return; }
    }

    const key = uri.toString();
    const existing = openPanels.get(key);
    if (existing) {
        // Between dispose() firing and onDidDispose clearing the map there's
        // a small window where the map still holds a disposed panel. reveal()
        // and webview.html assignment both throw in that case; drop the stale
        // entry and fall through to create a fresh panel.
        try {
            const data = await loadAmdData(uri);
            existing.webview.html = renderReport(data, vegaScriptUris(existing, extensionUri));
            existing.reveal();
            return;
        } catch {
            openPanels.delete(key);
        }
    }

    const data = await loadAmdData(uri);
    const panel = vscode.window.createWebviewPanel(
        'nmbenchAmdReport',
        `AMD Report: ${data.folderName}`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            // Allow the webview to load our bundled vega libraries. Without
            // this asWebviewUri() paths outside the workspace fail CSP.
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')],
        }
    );
    openPanels.set(key, panel);
    panel.onDidDispose(() => openPanels.delete(key));

    panel.webview.onDidReceiveMessage(async (msg: { command: string; path?: string; modelPath?: string; label?: string }) => {
        if (msg.command === 'openFile' && msg.path) {
            try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.path));
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Two, preview: false });
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to open ${msg.path}: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else if (msg.command === 'refresh') {
            panel.webview.html = renderReport(await loadAmdData(uri), vegaScriptUris(panel, extensionUri));
        } else if (msg.command === 'revealFolder' && msg.path) {
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
        } else if (msg.command === 'openReportHtml' && msg.path) {
            vscode.env.openExternal(vscode.Uri.file(msg.path));
        } else if (msg.command === 'generateVpc' && msg.modelPath) {
            const label = msg.label || 'model';
            const script = generateVpcScript(msg.modelPath, label);
            await openGeneratedScript(script, `vpc_${label}.R`, findRunRoot(msg.modelPath));
        } else if (msg.command === 'generateBootstrap' && msg.modelPath) {
            const label = msg.label || 'model';
            const script = generateBootstrapScript(msg.modelPath, label);
            await openGeneratedScript(script, `boot_${label}.R`, findRunRoot(msg.modelPath));
        } else if (msg.command === 'openReport' && msg.path) {
            // Re-enter openAmdReport on a nested vpc/bootstrap/simulation folder.
            // The panel-per-uri cache handles re-focus vs new tab automatically.
            await openAmdReport(vscode.Uri.file(msg.path), extensionUri);
        } else if (msg.command === 'exportHtml') {
            await exportReportToHtml(uri, extensionUri, data.folderName);
        }
    });

    panel.webview.html = renderReport(data, vegaScriptUris(panel, extensionUri));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(v: unknown): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtCell(v: unknown): string {
    if (v == null || v === '') { return '—'; }
    if (typeof v === 'number' && Number.isFinite(v)) {
        if (Number.isInteger(v)) { return String(v); }
        const abs = Math.abs(v);
        if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) { return v.toExponential(3); }
        return v.toFixed(4);
    }
    if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
    if (typeof v === 'object') { return esc(JSON.stringify(v)); }
    return esc(v);
}

function isNumeric(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v);
}

// Small folder icon (codicon "folder" path) rendered inline so it can inherit
// currentColor via CSS and stay theme-aware.
const FOLDER_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.5 3H7.71l-2-2H1.5l-.5.5v11l.5.5h13l.5-.5v-9l-.5-.5zM14 14H2V2h3.29l2 2H14v10z"/></svg>';

function revealButton(absPath: string, label: string = 'Reveal in file explorer'): string {
    return `<button class="icon-btn" data-reveal="${esc(absPath)}" title="${esc(label)}" aria-label="${esc(label)}">${FOLDER_SVG}</button>`;
}

/**
 * Normalize pharmpy's DataFrame JSON (`orient='table'`) into (columns, rows).
 * Falls back to array-of-rows or dict-of-dicts if the input isn't a
 * DataFrame envelope.
 */
function normalizeTable(src: unknown): { cols: string[]; rows: Record<string, unknown>[] } {
    if (!src) { return { cols: [], rows: [] }; }
    // pandas orient='table'
    if (typeof src === 'object' && 'schema' in (src as object) && 'data' in (src as object)) {
        const t = src as PandasTable;
        const cols = t.schema?.fields?.map(f => f.name) ?? Object.keys((t.data && t.data[0]) || {});
        return { cols, rows: t.data ?? [] };
    }
    if (Array.isArray(src)) {
        const rows = src as Record<string, unknown>[];
        return { cols: rows.length > 0 ? Object.keys(rows[0]) : [], rows };
    }
    if (typeof src === 'object') {
        const entries = Object.entries(src as Record<string, unknown>);
        if (entries.length > 0 && entries[0][1] && typeof entries[0][1] === 'object' && !Array.isArray(entries[0][1])) {
            const innerCols = Object.keys(entries[0][1] as Record<string, unknown>);
            return {
                cols: ['name', ...innerCols],
                rows: entries.map(([k, v]) => ({ name: k, ...(v as Record<string, unknown>) })),
            };
        }
    }
    return { cols: [], rows: [] };
}

function renderTable(
    rows: Record<string, unknown>[],
    cols: string[],
    rowAttr?: (row: Record<string, unknown>) => string,
    cellClass?: (row: Record<string, unknown>, col: string) => string,
): string {
    if (rows.length === 0) { return '<div class="hint">(empty)</div>'; }
    const th = cols.map(c => `<th>${esc(c)}</th>`).join('');
    const trs = rows.map(r => {
        const tds = cols.map(c => {
            const v = r[c];
            const numCls = isNumeric(v) ? 'num' : '';
            const extraCls = cellClass ? cellClass(r, c) : '';
            const cls = [numCls, extraCls].filter(Boolean).join(' ');
            return `<td${cls ? ` class="${cls}"` : ''}>${fmtCell(v)}</td>`;
        }).join('');
        const extra = rowAttr ? ' ' + rowAttr(r) : '';
        return `<tr${extra}>${tds}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/**
 * Classify a NONMEM parameter name into theta/omega/sigma so the estviewer
 * palette (blue/green/red) can be reused. Uses pharmpy's default naming
 * conventions (POP_, IIV_, IOV_, RUV_, EPS_, plus THETA/OMEGA/SIGMA
 * literals). Falls back to `other` for names that don't match.
 */
function paramKind(name: string): 'theta' | 'omega' | 'sigma' | 'other' {
    const u = name.toUpperCase();
    if (u.startsWith('POP_') || u.startsWith('TV') || u.startsWith('THETA')) { return 'theta'; }
    if (u.startsWith('IIV_') || u.startsWith('IOV_') || u.startsWith('ETA_') || u.startsWith('OMEGA')) { return 'omega'; }
    if (u.startsWith('EPS_') || u.startsWith('SIGMA') || u.startsWith('RUV_')) { return 'sigma'; }
    return 'other';
}

/**
 * Per-cell colouring rules for pharmpy's summary_tool / summary_models tables:
 * winner (rank=1) gets a green tint, top-3 a subtler shade, dBIC / dOFV
 * columns lean green when negative (improvement) and red when positive.
 */
function summaryCellClass(row: Record<string, unknown>, col: string): string {
    const v = row[col];
    if (col === 'rank' && typeof v === 'number') {
        if (v === 1) { return 'rank-best'; }
        if (v <= 3) { return 'rank-top'; }
    }
    if ((col === 'dbic' || col === 'd_ofv' || col === 'dofv' || col === 'd_params') && typeof v === 'number') {
        if (v < -0.5) { return 'delta-improve'; }
        if (v > 0.5) { return 'delta-worse'; }
    }
    if (col === 'minimization_successful' && typeof v === 'boolean') {
        return v ? 'ok-cell' : 'fail-cell';
    }
    return '';
}

type StageKind = 'fit' | 'analysis' | 'skipped';

interface ProgressionStage {
    name: string;
    kind: StageKind;
    ofv?: number;
    nParams?: number;
    numCandidates?: number;
    minSuccessful?: boolean;
    runtime?: number;
}

/**
 * Sort subcontexts by execution order using `metadata.stats.start_time`.
 * Subcontexts without a start_time keep their original filesystem order and
 * are appended after the timed ones, so a skipped/crashed subtool (no
 * metadata) never jumps ahead of the tools that actually ran. Shared by both
 * the progression card and the subtool-render pass so the on-screen order
 * matches the tree/table order exactly.
 */
function sortSubcontextsByStart(subcontexts: SubcontextData[]): SubcontextData[] {
    const withTime: { sc: SubcontextData; t: string }[] = [];
    const withoutTime: SubcontextData[] = [];
    for (const sc of subcontexts) {
        const t = sc.metadata?.stats?.start_time;
        if (typeof t === 'string' && t) { withTime.push({ sc, t }); }
        else { withoutTime.push(sc); }
    }
    withTime.sort((a, b) => a.t.localeCompare(b.t));
    return [...withTime.map(x => x.sc), ...withoutTime];
}

/**
 * Extract one progression stage per subcontext in execution order. Stages
 * are classified:
 *   - fit:      results.json carries any fit-shaped signal (ofv / log_likelihood / parameter_estimates)
 *   - analysis: has results.json but no fit signal (qa / simulation / ...)
 *   - skipped:  no results.json at all
 */
function extractProgression(data: AmdData): ProgressionStage[] {
    return sortSubcontextsByStart(data.subcontexts).map(sc => {
        if (!sc.results) { return { name: sc.name, kind: 'skipped' }; }
        const fr = sc.results.final_results as Record<string, unknown> | undefined;
        const hasOfv = typeof fr?.ofv === 'number';
        // Broader "did this actually fit a model?" test: any of the classic
        // fit signals is enough. Guards against pharmpy renaming just `ofv`
        // in a future release silently downgrading everything to 'analysis'.
        const hasFitSignal = fr != null && (
            hasOfv
            || typeof fr.log_likelihood === 'number'
            || fr.parameter_estimates != null
        );
        const st = normalizeTable(sc.results.summary_tool);
        const bestRow = st.rows.find(r => (r as { rank?: unknown }).rank === 1) ?? st.rows[0];
        return {
            name: sc.name,
            kind: hasFitSignal ? 'fit' : 'analysis',
            ofv: hasOfv ? (fr!.ofv as number) : undefined,
            nParams: typeof (bestRow as { n_params?: unknown } | undefined)?.n_params === 'number'
                ? (bestRow as { n_params: number }).n_params
                : undefined,
            numCandidates: st.rows.length > 0 ? st.rows.length : undefined,
            minSuccessful: typeof fr?.minimization_successful === 'boolean'
                ? fr.minimization_successful
                : undefined,
            runtime: typeof fr?.runtime_total === 'number' ? fr.runtime_total : undefined,
        };
    });
}

function renderProgressionTable(stages: ProgressionStage[]): string {
    if (stages.length === 0) { return ''; }
    let prevOfv: number | undefined;
    const rows = stages.map(s => {
        const dOfv = (s.ofv !== undefined && prevOfv !== undefined) ? s.ofv - prevOfv : undefined;
        const ofvCell = s.kind === 'fit' ? fmtCell(s.ofv)
            : s.kind === 'analysis' ? '<span class="inline-hint">analysis</span>'
            : '<span class="inline-hint">skipped</span>';
        const html = `<tr>
            <td><span class="progression-link" data-scroll-to="subctx-${esc(s.name)}" title="Jump to ${esc(s.name)}">${esc(s.name)}</span></td>
            <td class="num">${ofvCell}</td>
            <td class="num">${s.nParams !== undefined ? s.nParams : '—'}</td>
            <td class="num">${dOfv !== undefined ? fmtCell(dOfv) : '—'}</td>
            <td class="num">${s.numCandidates ?? '—'}</td>
            <td>${s.minSuccessful === undefined ? '—' : (s.minSuccessful ? '<span class="ok">✓</span>' : '<span class="fail">✗</span>')}</td>
            <td class="num">${s.runtime !== undefined ? fmtCell(s.runtime) : '—'}</td>
          </tr>`;
        if (s.ofv !== undefined) { prevOfv = s.ofv; }
        return html;
    }).join('');
    return `<div class="subsec">
        <h3>Progression table</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Stage</th><th>Final OFV</th><th>n_params</th><th>ΔOFV vs prev</th><th>Candidates</th><th>Min ✓</th><th>Runtime (s)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
}

/**
 * Indented tree layout: each stage sits on its own line with progressively
 * deeper padding to convey pipeline order. Compact (~22px per stage) so it
 * scales to many stages without eating vertical real estate. Kind-specific
 * glyphs:  ● fit   ◆ analysis (no OFV)   ○ skipped.
 * Depth is capped so very long pipelines don't scroll horizontally.
 */
function renderProgressionTree(stages: ProgressionStage[]): string {
    if (stages.length === 0) { return ''; }
    const INDENT_PX = 16;
    const MAX_DEPTH = 6;
    let prevOfv: number | undefined;
    const parts: string[] = [];
    stages.forEach((s, i) => {
        const glyph = s.kind === 'fit' ? '●' : s.kind === 'analysis' ? '◆' : '○';
        const depth = Math.min(i, MAX_DEPTH);
        const connector = i === 0 ? '' : '└';
        let metric = '';
        if (s.kind === 'fit' && s.ofv !== undefined) {
            const dOfv = (prevOfv !== undefined) ? ` (Δ${fmtCell(s.ofv - prevOfv)})` : '';
            metric = `${fmtCell(s.ofv)}${dOfv}`;
        } else if (s.kind === 'analysis') {
            metric = 'analysis';
        } else if (s.kind === 'skipped') {
            metric = 'skipped';
        }
        const candLabel = s.kind === 'fit' && s.numCandidates !== undefined ? `${s.numCandidates} fits`
            : (s.kind === 'analysis' && s.numCandidates !== undefined ? `${s.numCandidates} results` : '');
        const paramLabel = s.nParams !== undefined ? `${s.nParams} params` : '';
        const meta = [candLabel, paramLabel].filter(Boolean).join(' · ');
        parts.push(`<div class="ptree-row" style="padding-left: ${depth * INDENT_PX}px;">
            <span class="ptree-connector">${connector}</span>
            <span class="pcrumb pcrumb-${s.kind}" data-scroll-to="subctx-${esc(s.name)}" title="Jump to ${esc(s.name)}">
              <span class="pcrumb-dot">${glyph}</span>
              <span class="pcrumb-name">${esc(s.name)}</span>
              ${metric ? `<span class="pcrumb-metric">${esc(metric)}</span>` : ''}
              ${meta ? `<span class="pcrumb-meta">${esc(meta)}</span>` : ''}
            </span>
          </div>`);
        if (s.ofv !== undefined) { prevOfv = s.ofv; }
    });
    return `<div class="subsec">
        <h3>Model evolution</h3>
        <div class="ptree">${parts.join('')}</div>
        <div class="hint">● fit &nbsp;·&nbsp; ◆ analysis &nbsp;·&nbsp; ○ skipped &nbsp;·&nbsp; click to jump</div>
      </div>`;
}

function renderProgressionCard(data: AmdData): string {
    const stages = extractProgression(data);
    if (stages.length === 0) { return ''; }
    return `<section class="card">
        <h2>Model progression</h2>
        <div class="progression-body">
          ${renderProgressionTree(stages)}
          ${renderProgressionTable(stages)}
        </div>
      </section>`;
}

function renderOverview(data: AmdData): string {
    const m = data.metadata || {};
    const to = m.tool_options || {};
    const co = m.common_options || {};
    const disp = m.dispatching_options || {};
    const st = m.stats || {};

    // Logical groups (my re-org for user-facing hierarchy, not pharmpy's
    // internal JSON layout). Each group gets a monochrome Unicode glyph so
    // wrapped rows stay visually distinguishable.
    interface OvGroup { icon: string; label: string; items: [string, unknown][]; }
    const groups: OvGroup[] = [
        {
            icon: '⌂', label: 'Setup',
            items: [
                ['Folder', data.folderName],
                ['Tool', m.tool_name],
                ['pharmpy', m.pharmpy_version],
                ['Modeltype', to.modeltype],
                ['Administration', to.administration],
                ['Estimation', co.esttool],
                ['Strategy', to.strategy],
            ],
        },
        {
            icon: '∑', label: 'Initial estimates',
            items: [
                ['cl_init', to.cl_init],
                ['vc_init', to.vc_init],
                ['mat_init', to.mat_init],
            ],
        },
        {
            icon: '⚙', label: 'Compute',
            items: [
                ['Dispatcher', disp.dispatcher],
                ['Broadcaster', disp.broadcaster],
                ['ncores', disp.ncores],
                ['Seed', m.seed],
            ],
        },
        {
            icon: '⧗', label: 'Timing',
            items: [
                ['Started', st.start_time],
                ['Ended', st.end_time],
            ],
        },
    ];

    const rows = groups.map(g => {
        const inner = g.items
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `<span class="ov-item"><span class="ov-k">${esc(k)}</span> <span class="ov-v">${esc(v)}</span></span>`)
            .join('');
        if (!inner) { return ''; }
        return `<div class="ov-row"><span class="ov-icon" title="${esc(g.label)}">${g.icon}</span><span class="ov-row-body">${inner}</span></div>`;
    }).filter(Boolean).join('');
    return `<section class="card"><h2>Overview</h2><div class="ov-inline">${rows}</div></section>`;
}

function shortLabel(f: string): string {
    return f.startsWith('model.') ? f.slice(5) : f;
}

function renderAnalysisChips(analyses: DerivedAnalysis[]): string {
    if (analyses.length === 0) { return ''; }
    const chips = analyses.map(a => {
        // Unicode geometric symbols instead of emoji so the icon inherits
        // currentColor and stays consistent across macOS / Windows / Linux.
        const icon = a.kind === 'vpc' ? '◎' : a.kind === 'bootstrap' ? '↻' : '✱';
        // Prefer pharmpy's own results.html when present (opens external
        // browser). Fall back to our AMD Report viewer on the folder for the
        // Windows-crash case where results.html was never generated.
        const attrs = a.reportHtmlAbs
            ? `data-report-html="${esc(a.reportHtmlAbs)}" title="Open ${esc(a.name)}/results.html in browser"`
            : `data-open-report="${esc(a.dirAbs)}" title="No results.html — open ${esc(a.name)} in nmbench viewer"`;
        return `<span class="analysis-chip analysis-${a.kind}" ${attrs}>${icon} ${esc(a.name)}</span>`;
    }).join(' ');
    return `<span class="analyses-inline">${chips}</span>`;
}

function renderModelFileLinks(entry: ModelEntry): string {
    // pharmpy names most NONMEM artifacts `model.<ext>`; strip the redundant
    // `model` prefix so the row reads as .lst .ctl .ext .phi mytab stdout.
    const links = entry.files.length > 0
        ? entry.files.map(f => `<a href="#" data-open="${esc(path.join(entry.targetAbs, f))}" title="${esc(f)}">${esc(shortLabel(f))}</a>`).join(' ')
        : '<span class="inline-hint">no files</span>';
    return `${revealButton(entry.targetAbs, 'Reveal model folder')} ${links} ${renderAnalysisChips(entry.analyses)}`;
}

/**
 * Compact final-model row for a subtool section: only .lst/.ctl/.ext (the
 * user's most-opened set) plus Script buttons (VPC / Bootstrap) that generate
 * an R script targeting this specific model. The extra artifacts (.phi/.grd/
 * mytab/stdout/stderr) are still reachable via the Reveal icon.
 */
function renderSubtoolFinalRow(entry: ModelEntry, contextName: string): string {
    const keep = new Set(['.lst', '.ctl', '.mod', '.ext']);
    const kept = entry.files.filter(f => {
        const dot = f.lastIndexOf('.');
        return dot >= 0 && keep.has(f.slice(dot));
    });
    const links = kept.length > 0
        ? kept.map(f => `<a href="#" data-open="${esc(path.join(entry.targetAbs, f))}" title="${esc(f)}">${esc(shortLabel(f))}</a>`).join(' ')
        : '<span class="inline-hint">no model files</span>';
    // Pick the source file to feed into pharmr::read_model — prefer .ctl (real
    // NONMEM control), fall back to .mod.
    const source = entry.files.find(f => f === 'model.ctl') ?? entry.files.find(f => f === 'model.mod');
    const scripts = source ? `
        <span class="subtool-scripts">
          <span class="script-label">Script:</span>
          <button class="script-btn" data-gen-vpc="${esc(path.join(entry.targetAbs, source))}" data-model-label="${esc(contextName)}" title="Generate VPC script targeting this final model">VPC</button>
          <button class="script-btn" data-gen-bootstrap="${esc(path.join(entry.targetAbs, source))}" data-model-label="${esc(contextName)}" title="Generate Bootstrap script targeting this final model">Bootstrap</button>
        </span>` : '';
    return `${revealButton(entry.targetAbs, 'Reveal model folder')} ${links} ${scripts} ${renderAnalysisChips(entry.analyses)}`;
}

/**
 * Show only the AMD's starting model (`base`). The other top-level symlinks
 * (`final_modelsearch`, `final_structural_retries`, ...) are duplicates of
 * each subtool's own final model and are shown inline within their subtool
 * section instead, keeping the "one place to look" per subtool.
 */
function renderStartingModel(data: AmdData): string {
    const base = data.modelSymlinks.find(m => m.name === 'base');
    if (!base) { return ''; }
    return `
      <section class="card">
        <h2>Starting model (base)</h2>
        <div class="model-row">
          <div class="model-name">base</div>
          <div class="model-actions">${renderModelFileLinks(base)}</div>
        </div>
        <div class="hint">Input model AMD started from. The final model of each subtool is shown inside its section below.</div>
      </section>`;
}

function renderSubcontexts(data: AmdData): string {
    if (data.subcontexts.length === 0) { return ''; }
    // Render in execution order (same helper as extractProgression) so the
    // tree / table jump targets line up with what the user scrolls past.
    const secs = sortSubcontextsByStart(data.subcontexts).map(sc => renderOneSubcontext(sc)).join('');
    return `<section class="card">
      <h2>Subtool results</h2>
      ${secs}
    </section>`;
}

function subcontextTitle(sc: SubcontextData): string {
    // Short summary in the collapsed header: OFV, minimization status, model count.
    const parts: string[] = [];
    const fr = sc.results?.final_results as Record<string, unknown> | undefined;
    if (fr && typeof fr.ofv === 'number') { parts.push(`OFV ${fmtCell(fr.ofv)}`); }
    if (fr && typeof fr.minimization_successful === 'boolean') {
        parts.push(fr.minimization_successful ? 'min✓' : 'min✗');
    }
    const st = normalizeTable(sc.results?.summary_tool);
    if (st.rows.length > 0) { parts.push(`${st.rows.length} models`); }
    if (!sc.results) { parts.push('no results.json'); }
    return parts.length ? ` — <span class="subcontext-meta">${esc(parts.join(' · '))}</span>` : '';
}

function renderOneSubcontext(sc: SubcontextData): string {
    const summaryTool = normalizeTable(sc.results?.summary_tool);
    const summaryModels = normalizeTable(sc.results?.summary_models);
    const errs = sc.results?.summary_errors;
    let errBlock = '';
    if (errs && typeof errs === 'object') {
        const norm = normalizeTable(errs);
        if (norm.rows.length > 0) {
            errBlock = `<div class="subsec"><h3>Errors / warnings</h3>${renderTable(norm.rows, norm.cols)}</div>`;
        }
    }
    const htmlLink = sc.hasResultsHtml
        ? `<a href="#" data-report-html="${esc(path.join(sc.dirAbs, 'results.html'))}">pharmpy results.html →</a>`
        : `<span class="inline-hint">no pharmpy report</span>`;
    // For summary_tool, make each row clickable — jumps straight to the .lst
    // of the candidate model inside this subcontext's models/ dir.
    const rowLinkResolver = (row: Record<string, unknown>): string => {
        const modelName = row.model;
        if (typeof modelName !== 'string') { return ''; }
        const md = sc.modelDirs.find(m => m.name === modelName);
        if (!md) { return ''; }
        const lstFile = md.files.find(f => f.endsWith('.lst'));
        if (!lstFile) { return ''; }
        const abs = path.join(md.targetAbs, lstFile);
        return `class="clickable-row" data-open="${esc(abs)}" title="Open ${esc(modelName)}/${esc(lstFile)}"`;
    };
    const summaryToolBlock = summaryTool.rows.length > 0
        ? `<details class="subsec collapsible"><summary><h3>Model ranking (summary_tool) — ${summaryTool.rows.length} rows</h3></summary>${renderTable(summaryTool.rows, summaryTool.cols, rowLinkResolver, summaryCellClass)}</details>`
        : '';
    const summaryModelsBlock = summaryModels.rows.length > 0
        ? `<details class="subsec collapsible"><summary><h3>Summary models — ${summaryModels.rows.length} rows</h3></summary>${renderTable(summaryModels.rows, summaryModels.cols, undefined, summaryCellClass)}</details>`
        : '';
    const noResults = !sc.results
        ? `<div class="hint warn">This subtool has no <code>results.json</code> — it may have been skipped or crashed before writing results.</div>`
        : '';
    const finalStatus = renderFinalStatus(sc.results?.final_results);
    const finalParams = renderFinalParams(sc.results?.final_results);
    const shrinkage = renderShrinkage(sc.results);
    const plots = renderPlots(sc);
    // Every subcontext has a `final` symlink inside its models/ dir that
    // points at the model this subtool selected. Surfacing its files here
    // (rather than lumping them into the top-level Model roles card) keeps
    // subtool inputs & outputs colocated.
    // Prefer the canonical aliases; last resort accept any `final*` symlink
    // in case pharmpy renames the standard label in a future release.
    const finalModel = sc.modelDirs.find(m => m.name === 'final')
        ?? sc.modelDirs.find(m => m.name === `final_${sc.name}`)
        ?? sc.modelDirs.find(m => m.name.startsWith('final'));
    const finalInline = finalModel
        ? `<div class="subcontext-final"><span class="subcontext-final-label">Final:</span> ${renderSubtoolFinalRow(finalModel, sc.name)}</div>`
        : '';
    return `
      <details class="subcontext" id="subctx-${esc(sc.name)}">
        <summary class="subcontext-head">
          <div class="subcontext-head-row">
            <span class="subcontext-name">${esc(sc.name)}${subcontextTitle(sc)}</span>
            <span class="subcontext-actions">
              ${revealButton(sc.dirAbs, 'Reveal subcontext folder')}
              ${htmlLink}
            </span>
          </div>
          ${finalInline}
        </summary>
        ${noResults}
        ${finalStatus}
        ${finalParams}
        ${shrinkage}
        ${renderSearchTree(sc)}
        ${summaryToolBlock}
        ${summaryModelsBlock}
        ${errBlock}
        ${plots}
        ${renderExtraFields(sc)}
      </details>`;
}

/**
 * Compact inline groups (same visual style as Overview) so headline numbers
 * (OFV, log-likelihood, sig-digits, min-successful, runtime, warnings) sit
 * in ~4 rows instead of a 8-column KPI grid.
 */
function renderFinalStatus(fr: unknown): string {
    if (!fr || typeof fr !== 'object') { return ''; }
    const f = fr as Record<string, unknown>;

    interface StItem { k: string; html: string; }
    interface StGroup { icon: string; label: string; items: StItem[]; extraClass?: string; }

    const scalarItem = (k: string, v: unknown): StItem | null =>
        (v == null || v === '') ? null : { k, html: esc(fmtCell(v)) };
    const conv = f.minimization_successful;
    const convItem: StItem | null = typeof conv === 'boolean'
        ? { k: 'Minimization', html: conv ? '<span class="ok">✓</span>' : '<span class="fail">✗</span>' }
        : null;

    const groups: StGroup[] = [
        {
            icon: '⊙', label: 'Fit metrics',
            items: [
                scalarItem('OFV', f.ofv),
                scalarItem('Log-likelihood', f.log_likelihood),
                scalarItem('Sig. digits', f.significant_digits),
            ].filter((x): x is StItem => x !== null),
        },
        {
            icon: '◉', label: 'Convergence',
            items: [
                convItem,
                scalarItem('Termination', f.termination_cause),
            ].filter((x): x is StItem => x !== null),
        },
        {
            icon: '⧗', label: 'Runtime',
            items: [
                scalarItem('Estimation (s)', f.estimation_runtime),
                scalarItem('Total (s)', f.runtime_total),
                scalarItem('Function evals', f.function_evaluations),
            ].filter((x): x is StItem => x !== null),
        },
    ];

    const warnings = Array.isArray(f.warnings) ? (f.warnings as unknown[]) : [];
    if (warnings.length > 0) {
        groups.push({
            icon: '⚠', label: 'Warnings', extraClass: 'ov-row-warn',
            items: warnings.map(w => ({ k: '', html: `<code>${esc(String(w))}</code>` })),
        });
    }

    const rows = groups.filter(g => g.items.length > 0).map(g => {
        const inner = g.items.map(it => {
            const kLabel = it.k ? `<span class="ov-k">${esc(it.k)}</span> ` : '';
            return `<span class="ov-item">${kLabel}<span class="ov-v">${it.html}</span></span>`;
        }).join('');
        const cls = g.extraClass ? ` ${g.extraClass}` : '';
        return `<div class="ov-row${cls}"><span class="ov-icon" title="${esc(g.label)}">${g.icon}</span><span class="ov-row-body">${inner}</span></div>`;
    }).join('');
    if (!rows) { return ''; }
    return `<div class="subsec"><h3>Final results — status</h3><div class="ov-inline">${rows}</div></div>`;
}

/**
 * pharmpy Series JSON (orient='table', single value column): the value column
 * is usually named '0'. Zip several Series by their `index` value into one
 * per-parameter table so estimate / SE / RSE / sd-corr sit in adjacent columns.
 */
function seriesToMap(src: unknown): Map<string, number | string> {
    const out = new Map<string, number | string>();
    if (!src || typeof src !== 'object') { return out; }
    const t = src as PandasTable;
    if (!t.data) { return out; }
    for (const row of t.data) {
        const rec = row as Record<string, unknown>;
        const idx = rec.index ?? rec.name ?? Object.values(rec)[0];
        // Find first non-index value key
        const valKey = Object.keys(rec).find(k => k !== 'index' && k !== 'name') ?? '';
        const val = rec[valKey];
        if (idx != null && (typeof val === 'number' || typeof val === 'string')) {
            out.set(String(idx), val);
        }
    }
    return out;
}

function renderFinalParams(fr: unknown): string {
    if (!fr || typeof fr !== 'object') { return ''; }
    const f = fr as Record<string, unknown>;
    const est = seriesToMap(f.parameter_estimates);
    if (est.size === 0) { return ''; }
    const se = seriesToMap(f.standard_errors);
    const rse = seriesToMap(f.relative_standard_errors);
    const sdcorr = seriesToMap(f.parameter_estimates_sdcorr);
    // Hand-render so the parameter name cell can carry its theta/omega/sigma
    // colour class (renderTable's cellClass hook applies to values, not to
    // the visual grouping we want here).
    const numOrDash = (v: unknown) => v == null ? '—' : fmtCell(v);
    const bodyRows = Array.from(est.entries()).map(([name, val]) => {
        const kind = paramKind(name);
        return `<tr>
            <td class="param-name p-${kind}">${esc(name)}</td>
            <td class="num">${esc(numOrDash(val))}</td>
            <td class="num">${esc(numOrDash(se.get(name) ?? null))}</td>
            <td class="num">${esc(numOrDash(rse.get(name) ?? null))}</td>
            <td class="num">${esc(numOrDash(sdcorr.get(name) ?? null))}</td>
          </tr>`;
    }).join('');
    return `<div class="subsec">
        <h3>Parameter estimates</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>parameter</th><th>estimate</th><th>se</th><th>rse</th><th>estimate_sdcorr</th></tr></thead>
          <tbody>${bodyRows}</tbody>
        </table></div>
      </div>`;
}

function renderShrinkage(results: unknown): string {
    if (!results || typeof results !== 'object') { return ''; }
    const r = results as Record<string, unknown>;
    // The subcontext-level shrinkage sits either inside final_results or as a
    // top-level `final_model_eta_shrinkage` Series depending on tool. Try both.
    const src = (r.final_model_eta_shrinkage)
        ?? ((r.final_results as Record<string, unknown> | undefined)?.eta_shrinkage);
    const eps = (r.final_results as Record<string, unknown> | undefined)?.eps_shrinkage;
    const parts: string[] = [];
    const etaMap = seriesToMap(src);
    if (etaMap.size > 0) {
        const rows = Array.from(etaMap.entries()).map(([k, v]) => ({ eta: k, shrinkage: v }));
        parts.push(`<div class="subsec"><h3>ETA shrinkage</h3>${renderTable(rows as Record<string, unknown>[], ['eta', 'shrinkage'])}</div>`);
    }
    const epsMap = seriesToMap(eps);
    if (epsMap.size > 0) {
        const rows = Array.from(epsMap.entries()).map(([k, v]) => ({ epsilon: k, shrinkage: v }));
        parts.push(`<div class="subsec"><h3>EPS shrinkage</h3>${renderTable(rows as Record<string, unknown>[], ['epsilon', 'shrinkage'])}</div>`);
    }
    return parts.join('');
}

const KNOWN_PLOTS: [string, string][] = [
    ['DV vs IPRED', 'final_model_dv_vs_ipred_plot'],
    ['DV vs PRED', 'final_model_dv_vs_pred_plot'],
    ['CWRES vs IDV', 'final_model_cwres_vs_idv_plot'],
    ['|CWRES| vs IPRED', 'final_model_abs_cwres_vs_ipred_plot'],
    ['ETA distribution', 'final_model_eta_distribution_plot'],
];

// Fields we already surface via a dedicated renderer above the generic pass.
// Anything not in this set gets picked up by renderExtraFields() — that's how
// tool-specific outputs (qa's dofv/boxcox_parameters/tdist_plot, structsearch's
// candidates, ...) show up without hardcoding.
const HANDLED_RESULT_FIELDS = new Set<string>([
    '__version__', '__module__', '__class__',
    'summary_tool', 'summary_models', 'summary_errors',
    'final_model', 'final_results', 'models',
    'final_model_eta_shrinkage',
    ...KNOWN_PLOTS.map(([, key]) => key),
]);

/**
 * Serialise a Vega-Lite spec so it can be embedded inside `<script type="application/json">`
 * without letting any character sequence flip the HTML tokenizer into
 * script-data-double-escaped state. Covers the well-known trio
 * (`</script`, `<!--`, `-->`); pharmpy specs aren't hostile, this is
 * belt-and-braces.
 */
function safeSpecJson(v: unknown): string {
    return JSON.stringify(v)
        .replace(/<\/script/gi, '<\\/script')
        .replace(/<!--/g, '<\\!--')
        .replace(/-->/g, '--\\>')
        .replace(/<script/gi, '<\\script');
}

function isPandasTable(v: unknown): boolean {
    if (!v || typeof v !== 'object') { return false; }
    const cls = (v as { __class__?: unknown }).__class__;
    return cls === 'DataFrame' || cls === 'Series';
}

function isVegaSpec(v: unknown): boolean {
    if (!v || typeof v !== 'object') { return false; }
    const o = v as { __class__?: unknown; $schema?: unknown };
    const cls = o.__class__;
    if (cls === 'Chart' || cls === 'LayerChart' || cls === 'FacetChart'
        || cls === 'RepeatChart' || cls === 'ConcatChart'
        || cls === 'HConcatChart' || cls === 'VConcatChart') { return true; }
    // Fallback: any object carrying a Vega-Lite $schema URL is a spec even
    // if altair introduced a chart subclass we don't know yet.
    return typeof o.$schema === 'string' && o.$schema.includes('vega-lite');
}

/**
 * Search tree for modelsearch / structsearch etc. — parses `summary_tool`'s
 * `parent_model` column into the actual candidate family tree and renders
 * it as SVG. The winner (rank 1) is highlighted; every node clicks through
 * to the candidate's model.lst so users can inspect the code that produced
 * each fit.
 */
interface TreeNode {
    name: string;
    description?: string;
    rank?: number;
    dbic?: number;
    nParams?: number;
    parent?: string;
    children: TreeNode[];
    depth: number;
    x?: number;
    y?: number;
}

function buildSearchTree(rows: Record<string, unknown>[]): TreeNode | undefined {
    const byName = new Map<string, TreeNode>();
    for (const r of rows) {
        const name = typeof r.model === 'string' ? r.model : '';
        if (!name) { continue; }
        byName.set(name, {
            name,
            description: typeof r.description === 'string' ? r.description : undefined,
            rank: typeof r.rank === 'number' ? r.rank : undefined,
            dbic: typeof r.dbic === 'number' ? r.dbic : undefined,
            nParams: typeof r.n_params === 'number' ? r.n_params : undefined,
            parent: typeof r.parent_model === 'string' ? r.parent_model : undefined,
            children: [],
            depth: 0,
        });
    }
    // Wire children into named parents; anything whose parent isn't in the set
    // (e.g. "input" — the base model — that isn't listed as a candidate row)
    // is treated as a top-level orphan.
    const orphans: TreeNode[] = [];
    for (const n of byName.values()) {
        if (n.parent && byName.has(n.parent)) {
            byName.get(n.parent)!.children.push(n);
        } else {
            orphans.push(n);
        }
    }
    if (orphans.length === 0) { return undefined; }
    // Single virtual root labelled with the shared external parent name (usually "input")
    const virtualParent = orphans.every(o => o.parent === orphans[0].parent) && orphans[0].parent
        ? orphans[0].parent
        : 'root';
    const root: TreeNode = {
        name: virtualParent,
        description: virtualParent === 'input' ? '(base model)' : undefined,
        children: orphans,
        depth: 0,
    };
    // Depths (BFS)
    const bfs = (n: TreeNode, d: number): void => {
        n.depth = d;
        for (const c of n.children) { bfs(c, d + 1); }
    };
    bfs(root, 0);
    return root;
}

function layoutSearchTree(root: TreeNode, nodeW: number, nodeH: number, hGap: number, vGap: number): { width: number; height: number } {
    const subtreeWidth = (n: TreeNode): number => {
        if (n.children.length === 0) { return nodeW; }
        const sum = n.children.reduce((s, c) => s + subtreeWidth(c), 0);
        return Math.max(nodeW, sum + (n.children.length - 1) * hGap);
    };
    const place = (n: TreeNode, xLeft: number, y: number): void => {
        n.y = y;
        if (n.children.length === 0) {
            n.x = xLeft + nodeW / 2;
        } else {
            let cx = xLeft;
            for (const c of n.children) {
                place(c, cx, y + nodeH + vGap);
                cx += subtreeWidth(c) + hGap;
            }
            n.x = (n.children[0].x! + n.children[n.children.length - 1].x!) / 2;
        }
    };
    place(root, 0, 0);
    const maxDepth = (n: TreeNode): number => n.children.length === 0 ? n.depth : Math.max(...n.children.map(maxDepth));
    return { width: subtreeWidth(root), height: (maxDepth(root) + 1) * (nodeH + vGap) - vGap };
}

function collectNodes(root: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (n: TreeNode): void => { out.push(n); for (const c of n.children) { walk(c); } };
    walk(root);
    return out;
}

function renderSearchTree(sc: SubcontextData): string {
    if (!sc.results) { return ''; }
    const st = normalizeTable(sc.results.summary_tool);
    if (st.rows.length === 0) { return ''; }
    if (!st.rows.some(r => 'parent_model' in r)) { return ''; }
    const root = buildSearchTree(st.rows);
    if (!root) { return ''; }
    const nodeW = 130, nodeH = 44, hGap = 10, vGap = 24;
    const { width, height } = layoutSearchTree(root, nodeW, nodeH, hGap, vGap);
    const pad = 12;
    const svgW = width + pad * 2;
    const svgH = height + pad * 2;
    const nodes = collectNodes(root);
    // Edges (drawn first so nodes sit on top)
    const edges: string[] = [];
    for (const n of nodes) {
        for (const c of n.children) {
            const y1 = n.y! + nodeH + pad;
            const y2 = c.y! + pad;
            const midY = (y1 + y2) / 2;
            edges.push(`<path d="M ${n.x! + pad},${y1} C ${n.x! + pad},${midY} ${c.x! + pad},${midY} ${c.x! + pad},${y2}" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"/>`);
        }
    }
    const nodeSvg: string[] = nodes.map(n => {
        const isBest = n.rank === 1;
        const isVirtualRoot = n === root && !n.rank;
        const cx = n.x! + pad;
        const y = n.y! + pad;
        const fill = isVirtualRoot ? 'rgba(128,128,128,0.08)'
            : isBest ? 'rgba(71,212,90,0.15)'
            : 'rgba(100,170,255,0.06)';
        const strokeVar = isBest ? 'var(--vscode-charts-green, currentColor)' : 'currentColor';
        const strokeOp = isBest ? '0.9' : '0.4';
        const modelDir = sc.modelDirs.find(m => m.name === n.name);
        const lstFile = modelDir?.files.find(f => f.endsWith('.lst'));
        const clickAttrs = (modelDir && lstFile)
            ? `data-open="${esc(path.join(modelDir.targetAbs, lstFile))}" style="cursor:pointer;"`
            : '';
        const label = n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name;
        const primary = (isBest ? '★ ' : '') + label;
        // Secondary line: dBIC for candidates, description for the virtual root
        const secondary = n.dbic !== undefined ? `dBIC ${fmtCell(n.dbic)}`
            : (isVirtualRoot && n.description) ? n.description
            : '';
        const title = [n.name, n.description, n.rank !== undefined ? `rank ${n.rank}` : '', n.dbic !== undefined ? `dBIC ${fmtCell(n.dbic)}` : '', n.nParams !== undefined ? `${n.nParams} params` : '']
            .filter(Boolean).join(' · ');
        return `<g class="tree-node" ${clickAttrs}><title>${esc(title)}</title>
          <rect x="${cx - nodeW / 2}" y="${y}" width="${nodeW}" height="${nodeH}" rx="4" fill="${fill}" stroke="${strokeVar}" stroke-opacity="${strokeOp}" stroke-width="${isBest ? 1.5 : 1}"/>
          <text x="${cx}" y="${y + 18}" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">${esc(primary)}</text>
          <text x="${cx}" y="${y + 34}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity="0.65">${esc(secondary)}</text>
        </g>`;
    });
    return `<details class="subsec collapsible">
        <summary><h3>Search tree — ${st.rows.length} candidates</h3></summary>
        <div class="tree-toolbar">
          <button class="tree-mode-toggle" data-mode="actual">Actual size</button>
          <span class="hint" style="margin: 0;">★ = selected best. Click any node to open its <code>.lst</code>. Hover for details.</span>
        </div>
        <div class="search-tree-wrap tree-fit" style="--tree-natural-w: ${svgW}px; --tree-natural-h: ${svgH}px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="xMidYMid meet">
            ${edges.join('')}
            ${nodeSvg.join('')}
          </svg>
        </div>
      </details>`;
}

/**
 * Catch-all for result fields we don't render via a dedicated section — any
 * DataFrame becomes a collapsible table, any Vega-Lite chart becomes a plot
 * card. Keeps qa / structsearch / future subtools working without adding
 * per-tool code paths.
 */
function renderExtraFields(sc: SubcontextData): string {
    if (!sc.results) { return ''; }
    const tables: string[] = [];
    const plots: string[] = [];
    for (const [key, value] of Object.entries(sc.results)) {
        if (HANDLED_RESULT_FIELDS.has(key)) { continue; }
        if (value == null) { continue; }
        if (isPandasTable(value)) {
            const norm = normalizeTable(value);
            if (norm.rows.length > 0) {
                tables.push(`<details class="subsec collapsible"><summary><h3>${esc(key)} — ${norm.rows.length} rows</h3></summary>${renderTable(norm.rows, norm.cols)}</details>`);
            }
        } else if (isVegaSpec(value)) {
            const uniqId = `${sc.name}--${key}`;
            const specJson = safeSpecJson(value);
            plots.push(`<div class="plot-card"><h3>${esc(key)}</h3><div class="vega-plot" data-plot-id="${esc(uniqId)}"></div><script type="application/json" id="plot-data-${esc(uniqId)}">${specJson}</script></div>`);
        }
    }
    let out = tables.join('');
    if (plots.length > 0) {
        out += `<div class="subsec"><h3>Additional plots (${plots.length})</h3><div class="plot-grid">${plots.join('')}</div></div>`;
    }
    return out;
}

/**
 * Render each Vega-Lite / altair chart spec inline. pharmpy stores these as
 * fully-resolved Vega-Lite specs (LayerChart / FacetChart), so we can pass
 * them straight to vega-embed with no translation. Colors are re-themed at
 * render time using the current VS Code CSS variables so plots follow
 * light/dark automatically.
 */
function renderPlots(sc: SubcontextData): string {
    if (!sc.results) { return ''; }
    const r = sc.results as Record<string, unknown>;
    const found = KNOWN_PLOTS.filter(([, key]) => r[key] != null);
    if (found.length === 0) { return ''; }
    const items = found.map(([label, key]) => {
        const uniqId = `${sc.name}--${key}`;
        // Escape </script inside JSON to prevent premature script termination.
        const specJson = safeSpecJson(r[key]);
        return `
          <div class="plot-card">
            <h3>${esc(label)}</h3>
            <div class="vega-plot" data-plot-id="${esc(uniqId)}"></div>
            <script type="application/json" id="plot-data-${esc(uniqId)}">${specJson}</script>
          </div>`;
    }).join('');
    return `<div class="subsec"><h3>Diagnostic plots (${found.length})</h3><div class="plot-grid">${items}</div></div>`;
}

function renderLog(data: AmdData): string {
    if (data.log.length === 0) { return ''; }
    // Only show WARNING+ by default to keep the report scannable
    const filtered = data.log.filter(e => e.severity !== 'info');
    const shown = filtered.length > 0 ? filtered : data.log;
    const rows = shown.map(e => {
        const cls = e.severity === 'error' || e.severity === 'critical' ? 'sev-err'
            : e.severity === 'warning' ? 'sev-warn'
            : e.severity === 'info' ? 'sev-info'
            : '';
        return `<tr class="${cls}"><td>${esc(e.severity)}</td><td>${esc(e.path)}</td><td>${esc(e.time)}</td><td class="msg">${esc(e.message)}</td></tr>`;
    }).join('');
    const noteInfoHidden = filtered.length !== data.log.length
        ? `<div class="hint">Showing ${shown.length} non-info entries (${data.log.length - shown.length} info hidden).</div>`
        : '';
    return `
      <section class="card log-card">
        <details>
          <summary>Log (from log.csv) — ${shown.length} entries</summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Severity</th><th>Path</th><th>Time</th><th>Message</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${noteInfoHidden}
        </details>
      </section>`;
}

function renderRaw(data: AmdData): string {
    const raw = { metadata: data.metadata, subcontexts: data.subcontexts.map(s => ({ name: s.name, has_results: !!s.results })) };
    return `
      <section class="card">
        <details>
          <summary>Raw top-level metadata (click)</summary>
          <pre class="raw">${esc(JSON.stringify(raw, null, 2))}</pre>
        </details>
      </section>`;
}

function renderReport(data: AmdData, scripts: VegaScripts, standalone: boolean = false): string {
    const nothing = !data.metadata && data.subcontexts.length === 0;
    const missing = nothing
        ? `<section class="card warn">
             <h2>No data</h2>
             <p>No <code>metadata.json</code> or <code>subcontexts/</code> found. If AMD is still running, wait and click <b>Refresh</b>. Otherwise the run may have crashed before storing anything.</p>
           </section>`
        : '';
    // Allow inline script (for our bootstrap + JSON data blocks) and images
    // (vega renders to canvas, sometimes uses data: images). Scripts must
    // also load from the webview scheme so the bundled vega libs work.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 20px; margin: 0; font-size: 13px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); border-left: 3px solid currentColor; padding: 2px 0 3px 10px; margin: 0 0 10px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--vscode-descriptionForeground); margin: 12px 0 6px; }
  .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap; }
  button { background: transparent; color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); border: 1px solid var(--vscode-charts-blue, var(--vscode-textLink-foreground)); padding: 3px 10px; cursor: pointer; font-size: 12px; border-radius: 3px; }
  button:hover { background: rgba(100, 170, 255, 0.1); }
  .card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3)); border-radius: 4px; padding: 12px 14px; margin-bottom: 12px; background: rgba(128,128,128,0.03); }
  .card.warn { border-color: var(--vscode-charts-yellow, #f2c94c); }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
  .kpi { padding: 6px 8px; background: rgba(128,128,128,0.06); border-radius: 3px; }
  .kpi-k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
  .kpi-v { font-family: var(--vscode-editor-font-family); font-size: 12px; word-break: break-word; }
  .ov-inline { display: flex; flex-direction: column; gap: 2px; }
  .ov-row { display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 18px; }
  .ov-row + .ov-row { padding-top: 4px; margin-top: 2px; border-top: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.2)); }
  .ov-icon { flex: 0 0 16px; height: 18px; display: inline-flex; align-items: center; justify-content: center; text-align: center; font-size: 13px; color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); line-height: 1; user-select: none; }
  .ov-row-body { display: flex; flex-wrap: wrap; gap: 4px 14px; flex: 1 1 auto; align-items: center; }
  .ov-item { white-space: nowrap; }
  .ov-k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); margin-right: 3px; }
  .ov-v { font-family: var(--vscode-editor-font-family); }
  .ov-row-warn { color: var(--vscode-charts-yellow, #e6c34a); }
  .ov-row-warn .ov-icon { color: inherit; }
  .ov-row-warn code { background: rgba(230, 195, 74, 0.1); padding: 0 4px; border-radius: 2px; font-family: var(--vscode-editor-font-family); }
  .table-wrap { overflow-x: auto; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2)); white-space: nowrap; }
  th { color: var(--vscode-descriptionForeground); font-weight: normal; text-transform: uppercase; font-size: 10px; letter-spacing: 0.4px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.msg { white-space: normal; max-width: 600px; }
  tbody tr:hover { background: rgba(128,128,128,0.08); }
  /* Summary tables — light tint on ranks + delta columns to reveal trend at a glance */
  td.rank-best { background: rgba(71,212,90,0.18); font-weight: 600; }
  td.rank-top { background: rgba(71,212,90,0.08); }
  td.delta-improve { color: var(--vscode-charts-green, #47d45a); }
  td.delta-worse { color: var(--vscode-charts-red, #e06666); }
  td.ok-cell { color: var(--vscode-charts-green, #47d45a); }
  td.fail-cell { color: var(--vscode-charts-red, #e06666); }
  /* Parameter names — theta/omega/sigma palette from estviewer */
  td.param-name { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  td.p-theta { color: #6699cc; }
  td.p-omega { color: #66cc99; }
  td.p-sigma { color: #ff6666; }
  tr.sev-err td { color: var(--vscode-charts-red, #e06666); }
  tr.sev-warn td { color: var(--vscode-charts-yellow, #f2c94c); }
  tr.sev-info td { color: var(--vscode-descriptionForeground); }
  .chip { padding: 2px 10px; border: 1px solid var(--vscode-charts-purple, var(--vscode-textLink-foreground)); border-radius: 10px; color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); font-size: 11px; cursor: pointer; font-family: var(--vscode-editor-font-family); }
  .chip:hover { background: rgba(160, 120, 220, 0.1); }
  .icon-btn { background: transparent; border: none; padding: 2px 4px; color: var(--vscode-descriptionForeground); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 3px; }
  .icon-btn:hover { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); background: rgba(128,128,128,0.1); }
  .icon-btn:focus { outline: none; }
  .chip-flat { padding: 1px 8px; background: rgba(128,128,128,0.08); border-radius: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; font-family: var(--vscode-editor-font-family); }
  .model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; }
  .model-row { padding: 6px 8px; background: rgba(128,128,128,0.06); border-radius: 3px; display: flex; flex-direction: column; gap: 4px; }
  .model-name { font-weight: 600; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .model-actions { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 11px; }
  .model-actions a { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); text-decoration: none; }
  .model-actions a:hover { text-decoration: underline; }
  details.subcontext { border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2)); padding: 10px 0; }
  details.subcontext:first-of-type { border-top: none; padding-top: 0; }
  details.subcontext > summary { list-style: none; cursor: pointer; padding: 4px 0; display: block; }
  details.subcontext > summary::-webkit-details-marker { display: none; }
  /* Sticky when open — click summary to collapse without scrolling back up. */
  details.subcontext[open] > summary {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
    padding: 6px 0;
    margin-bottom: 6px;
  }
  .subcontext-head-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  .subcontext-head-row::before { content: '▸'; display: inline-block; margin-right: 6px; transition: transform 0.15s; color: var(--vscode-descriptionForeground); }
  details.subcontext[open] > summary .subcontext-head-row::before { transform: rotate(90deg); }
  .subcontext-name { font-weight: 600; font-family: var(--vscode-editor-font-family); font-size: 13px; flex: 1 1 auto; }
  .subcontext-meta { font-weight: normal; color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: 6px; }
  .subcontext-actions { display: inline-flex; gap: 6px; align-items: center; font-size: 11px; }
  .subcontext-actions a { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); text-decoration: none; }
  .subcontext-actions a:hover { text-decoration: underline; }
  .subcontext-final { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 4px 0 0 16px; font-size: 11px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }
  .subcontext-final-label { text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; }
  .subcontext-final a { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); text-decoration: none; }
  .subcontext-final a:hover { text-decoration: underline; }
  .subtool-scripts { display: inline-flex; align-items: center; gap: 4px; margin-left: 12px; padding-left: 12px; border-left: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25)); }
  .script-label { font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .script-btn { background: transparent; color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); border: 1px solid var(--vscode-charts-purple, var(--vscode-textLink-foreground)); padding: 1px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; font-family: var(--vscode-editor-font-family); }
  .script-btn:hover { background: rgba(160, 120, 220, 0.12); }
  .script-btn:focus { outline: none; }
  .analyses-inline { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 8px; }
  .analysis-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 8px; border-radius: 10px; font-size: 11px; cursor: pointer; font-family: var(--vscode-editor-font-family); border: 1px solid transparent; }
  .analysis-chip:hover { background: rgba(128,128,128,0.1); border-color: currentColor; }
  .analysis-vpc { color: var(--vscode-charts-green, #47d45a); }
  .analysis-bootstrap { color: var(--vscode-charts-yellow, #e6c34a); }
  .analysis-simulation { color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); }
  .subsec { margin: 6px 0; }
  details.collapsible > summary { list-style: none; cursor: pointer; padding: 2px 0; }
  details.collapsible > summary::-webkit-details-marker { display: none; }
  details.collapsible > summary::before { content: '▸'; display: inline-block; margin-right: 6px; color: var(--vscode-descriptionForeground); transition: transform 0.15s; }
  details.collapsible[open] > summary::before { transform: rotate(90deg); }
  details.collapsible > summary h3 { display: inline; margin: 0; padding: 0; }
  details summary { cursor: pointer; padding: 4px 0; color: var(--vscode-descriptionForeground); }
  h2.inline-h2 { display: inline; margin: 0; padding: 0; }
  .search-tree-wrap { color: var(--vscode-foreground); padding: 4px 0; }
  .search-tree-wrap svg { display: block; }
  .search-tree-wrap.tree-fit svg { width: 100%; height: auto; }
  .search-tree-wrap.tree-actual { overflow-x: auto; }
  .search-tree-wrap.tree-actual svg { width: var(--tree-natural-w); height: var(--tree-natural-h); }
  .tree-toolbar { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .tree-mode-toggle { background: transparent; border: 1px solid var(--vscode-charts-blue, var(--vscode-textLink-foreground)); color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); padding: 2px 10px; border-radius: 3px; font-size: 11px; cursor: pointer; font-family: var(--vscode-editor-font-family); }
  .tree-mode-toggle:hover { background: rgba(100,170,255,0.1); }
  .tree-mode-toggle:focus { outline: none; }
  .tree-node:hover rect { fill-opacity: 0.4 !important; stroke-opacity: 0.8 !important; }
  .plot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 4px; }
  .plot-card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2)); border-radius: 3px; padding: 8px; background: rgba(128,128,128,0.04); }
  .plot-card h3 { margin: 0 0 6px; font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.4px; }
  .vega-plot { min-height: 200px; width: 100%; }
  .vega-plot canvas, .vega-plot svg { max-width: 100%; }
  .progression-body { display: flex; flex-direction: column; gap: 8px; }
  .ptree { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .ptree-row { display: flex; align-items: center; gap: 4px; }
  .ptree-connector { color: var(--vscode-descriptionForeground); opacity: 0.5; width: 10px; text-align: center; user-select: none; }
  .pcrumb { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 12px; cursor: pointer; border: 1px solid transparent; }
  .pcrumb:hover { background: rgba(128,128,128,0.1); border-color: var(--vscode-panel-border, rgba(128,128,128,0.35)); }
  .pcrumb-name { font-weight: 600; }
  .pcrumb-metric { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .pcrumb-meta { color: var(--vscode-descriptionForeground); opacity: 0.75; font-size: 11px; }
  .pcrumb-dot { font-size: 11px; line-height: 1; }
  .pcrumb-fit .pcrumb-dot { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); }
  .pcrumb-analysis .pcrumb-dot { color: var(--vscode-charts-purple, var(--vscode-textLink-foreground)); }
  .pcrumb-skipped { opacity: 0.55; }
  .pcrumb-skipped .pcrumb-dot { color: var(--vscode-descriptionForeground); }
  tr.clickable-row { cursor: pointer; }
  tr.clickable-row:hover { background: rgba(100,170,255,0.1); }
  .progression-link { color: var(--vscode-charts-blue, var(--vscode-textLink-foreground)); text-decoration: none; cursor: pointer; }
  .progression-link:hover { text-decoration: underline; }
  .ok { color: var(--vscode-charts-green, #47d45a); font-weight: 600; }
  .fail { color: var(--vscode-charts-red, #e06666); font-weight: 600; }
  .log-card { color: var(--vscode-descriptionForeground); }
  .log-card summary { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; padding: 4px 0; }
  .log-card table { font-size: 10px; }
  .log-card th { font-size: 9px; }
  pre.raw { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08)); padding: 8px 10px; border-radius: 3px; overflow-x: auto; font-size: 11px; max-height: 400px; margin: 6px 0 0; }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  .hint.warn { color: var(--vscode-charts-yellow, #f2c94c); }
  .inline-hint { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
  <div class="top">
    <h1>AMD Report — ${esc(data.folderName)}</h1>
    <div style="display:flex;gap:6px;">
      <button id="collapseAll" title="Collapse every subtool section">Collapse subtools</button>
      <button id="refresh" title="Re-read files from disk">Refresh</button>
      <button id="exportHtml" title="Save the current report as a self-contained HTML file (viewable in any browser)">Export HTML</button>
    </div>
  </div>
  ${missing}
  ${renderOverview(data)}
  ${renderProgressionCard(data)}
  ${renderStartingModel(data)}
  ${renderSubcontexts(data)}
  ${renderLog(data)}
  ${renderRaw(data)}
  ${standalone
    ? `<script>${scripts.vega}</script>\n<script>${scripts.vegaLite}</script>\n<script>${scripts.vegaEmbed}</script>`
    : `<script src="${scripts.vega}"></script>\n<script src="${scripts.vegaLite}"></script>\n<script src="${scripts.vegaEmbed}"></script>`}
  <script>
    // Guarded so the same HTML can be loaded either inside a VS Code webview
    // (acquireVsCodeApi present) or as a standalone file in the browser
    // (function absent). vscode-dependent calls funnel through post(); if
    // the API isn't there they no-op.
    const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
    const post = (msg) => { if (vscode) vscode.postMessage(msg); };
    document.getElementById('refresh')?.addEventListener('click', () => post({ command: 'refresh' }));
    document.getElementById('exportHtml')?.addEventListener('click', () => post({ command: 'exportHtml' }));
    document.getElementById('collapseAll')?.addEventListener('click', () => {
      document.querySelectorAll('details.subcontext[open]').forEach(d => { d.open = false; });
    });
    // Clicks on interactive elements inside a <summary> should NOT toggle the
    // <details>; but they still need to bubble up so the delegated openFile /
    // revealFolder handlers on document.body fire. preventDefault() cancels
    // the native summary-activation without stopping propagation.
    document.querySelectorAll('details.subcontext > summary').forEach(sum => {
      sum.addEventListener('click', (e) => {
        if (e.target.closest('[data-open], [data-reveal], [data-report-html], [data-gen-vpc], [data-gen-bootstrap], [data-open-report], .icon-btn, .script-btn, .analysis-chip, a')) {
          e.preventDefault();
        }
      });
    });
    document.body.addEventListener('click', (e) => {
      const openLink = e.target.closest('[data-open]');
      if (openLink) { e.preventDefault(); post({ command: 'openFile', path: openLink.dataset.open }); return; }
      const reveal = e.target.closest('[data-reveal]');
      if (reveal) { e.preventDefault(); post({ command: 'revealFolder', path: reveal.dataset.reveal }); return; }
      const html = e.target.closest('[data-report-html]');
      if (html) { e.preventDefault(); post({ command: 'openReportHtml', path: html.dataset.reportHtml }); return; }
      const vpc = e.target.closest('[data-gen-vpc]');
      if (vpc) { e.preventDefault(); post({ command: 'generateVpc', modelPath: vpc.dataset.genVpc, label: vpc.dataset.modelLabel }); return; }
      const boot = e.target.closest('[data-gen-bootstrap]');
      if (boot) { e.preventDefault(); post({ command: 'generateBootstrap', modelPath: boot.dataset.genBootstrap, label: boot.dataset.modelLabel }); return; }
      const rpt = e.target.closest('[data-open-report]');
      if (rpt) { e.preventDefault(); post({ command: 'openReport', path: rpt.dataset.openReport }); return; }
      const treeToggle = e.target.closest('.tree-mode-toggle');
      if (treeToggle) {
        e.preventDefault();
        const wrap = treeToggle.parentElement.nextElementSibling; // .search-tree-wrap
        if (wrap && wrap.classList.contains('search-tree-wrap')) {
          const goingActual = wrap.classList.contains('tree-fit');
          wrap.classList.toggle('tree-fit', !goingActual);
          wrap.classList.toggle('tree-actual', goingActual);
          treeToggle.textContent = goingActual ? 'Fit view' : 'Actual size';
          treeToggle.dataset.mode = goingActual ? 'fit' : 'actual';
        }
        return;
      }
      // Progression tree / progression table row → scroll to the matching
      // subcontext and expand it. SVG uses closest() too because groups
      // (<g>) carry the data attribute.
      const jump = e.target.closest('[data-scroll-to]');
      if (jump) {
        e.preventDefault();
        const id = jump.getAttribute('data-scroll-to');
        const target = document.getElementById(id);
        if (target) {
          if (target.tagName.toLowerCase() === 'details') { target.open = true; }
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
    });

    // Vega-Lite bootstrap. Reads VS Code CSS variables at render time so plots
    // pick up the current light/dark theme; re-renders on theme change since
    // details/summary expansion or webview focus can flip colors.
    function currentThemeConfig() {
      const cs = getComputedStyle(document.body);
      const fg = cs.getPropertyValue('--vscode-foreground').trim() || '#ccc';
      const grid = 'rgba(128,128,128,0.15)';
      const stroke = 'rgba(128,128,128,0.25)';
      return {
        background: null,
        axis: { labelColor: fg, titleColor: fg, domainColor: fg, tickColor: fg, gridColor: grid },
        legend: { labelColor: fg, titleColor: fg },
        title: { color: fg },
        view: { stroke: stroke },
        header: { labelColor: fg, titleColor: fg },
        mark: { color: cs.getPropertyValue('--vscode-charts-blue').trim() || '#4aa' }
      };
    }
    function mergeThemeIntoSpec(spec) {
      const t = currentThemeConfig();
      spec.config = spec.config || {};
      spec.config.background = t.background;
      spec.config.axis = Object.assign({}, spec.config.axis || {}, t.axis);
      spec.config.legend = Object.assign({}, spec.config.legend || {}, t.legend);
      spec.config.title = Object.assign({}, spec.config.title || {}, t.title);
      spec.config.view = Object.assign({}, spec.config.view || {}, t.view);
      spec.config.header = Object.assign({}, spec.config.header || {}, t.header);
      // Do NOT override .mark globally — pharmpy specs often use encoding.color
      // for series which would collide. Only default color falls back to blue
      // when no color encoding is present.
      if (!spec.config.mark) { spec.config.mark = t.mark; }
      // Cap plot heights so a dense grid of diagnostic plots doesn't dominate
      // vertical space. Top-level height applies to Chart/LayerChart; nested
      // spec.height applies to FacetChart's per-facet cell.
      if (typeof spec.height === 'number' && spec.height > 160) { spec.height = 160; }
      if (spec.spec && typeof spec.spec.height === 'number' && spec.spec.height > 120) { spec.spec.height = 120; }
      return spec;
    }
    async function renderPlotContainer(c) {
      if (typeof vegaEmbed === 'undefined') { return; }
      if (c.dataset.rendered === '1') { return; }
      const id = c.dataset.plotId;
      const dataEl = document.getElementById('plot-data-' + id);
      if (!dataEl) { return; }
      let spec;
      try { spec = JSON.parse(dataEl.textContent); } catch (e) {
        c.innerHTML = '<div class="hint warn">Plot spec parse failed: ' + (e && e.message ? e.message : e) + '</div>';
        c.dataset.rendered = '1';
        return;
      }
      mergeThemeIntoSpec(spec);
      spec.width = 'container';
      try {
        await vegaEmbed(c, spec, { actions: false, renderer: 'canvas' });
        c.dataset.rendered = '1';
      } catch (e) {
        c.innerHTML = '<div class="hint warn">Plot failed: ' + (e && e.message ? e.message : e) + '</div>';
        c.dataset.rendered = '1';
      }
    }
    // Lazy render: only draw the plots inside a subcontext the first time it
    // gets expanded. Rendering while the <details> is closed produces 0-width
    // canvases because the container has no layout yet.
    document.querySelectorAll('details.subcontext').forEach(det => {
      det.addEventListener('toggle', () => {
        if (!det.open) { return; }
        det.querySelectorAll('[data-plot-id]').forEach(c => { renderPlotContainer(c).catch(err => console.warn('plot render failed:', err)); });
      });
    });
    // Also render plots that live outside any subcontext (e.g. added later) or
    // in subcontexts opened by default.
    document.querySelectorAll('details.subcontext[open] [data-plot-id], details:not(.subcontext) [data-plot-id]').forEach(c => {
      renderPlotContainer(c).catch(err => console.warn('plot render failed:', err));
    });
  </script>
</body>
</html>`;
}
