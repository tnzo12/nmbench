import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runRscriptFileInTerminal } from './rscriptRunner';

/**
 * Payload emitted by the AMD form when the user clicks "Generate".
 * Field names mirror pharmpy's run_amd() kwargs. Only modality-relevant fields
 * are read when building the R script, so extra keys are harmless.
 */
interface AmdConfig {
    modeltype: string;                     // basic_pk | pkpd | tmdd | drug_metabolite
    input: string;
    administration: string;                // iv | oral | iv+oral
    strategy: string;                      // default | reevaluation | SIR | SRI | RSI
    retriesStrategy: string;               // skip | all_final | final
    parameterUncertaintyMethod: string;    // SANDWICH | SMAT | RMAT | EFIM | none
    searchSpace: string;
    seed?: number;
    estTool: string;                       // pharmpy esttool: nonmem | nlmixr | dummy | pharmpy
    clInit?: number;
    vcInit?: number;
    matInit?: number;
    bInit?: number;
    emaxInit?: number;
    ec50Init?: number;
    metInit?: number;
    dvTypes?: string;                      // "drug:1,target:2,complex:3" -> R list(...)
    occasion?: string;                     // occasion / visit column name for IOV
    lloqMethod?: string;                   // m1 | m3 | m4 | m5 | m6 | m7 (transform_blq)
    lloqLimit?: number;                    // LLOQ threshold
    allometricVariable?: string;           // body-weight column for allometric scaling
    mechanisticCovariates?: string;        // comma-separated list of mechanistic covariates
}

const MODELTYPE_LABELS: Record<string, string> = {
    basic_pk: 'PK (basic_pk)',
    pkpd: 'PK-PD (pkpd)',
    tmdd: 'TMDD (tmdd)',
    drug_metabolite: 'Drug Metabolite (drug_metabolite)'
};

function escapeR(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseDvTypes(raw: string): string | undefined {
    // Accept "drug:1, target:2, complex:3" and emit an R list("drug" = 1, ...) fragment.
    const pairs = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (pairs.length === 0) { return undefined; }
    const parts: string[] = [];
    for (const pair of pairs) {
        const [k, v] = pair.split(':').map(s => s?.trim());
        if (!k || !v || isNaN(Number(v))) { return undefined; }
        parts.push(`"${k}" = ${Number(v)}`);
    }
    return `list(${parts.join(', ')})`;
}

/**
 * Extract the specific covariate column names named in the `search_space`'s
 * COVARIATE clauses. Skips group symbols (@CONTINUOUS / @CATEGORICAL) since
 * those aren't specific columns. Returns lowercase-ish set for case-insensitive
 * comparison against `mechanistic_covariates`.
 *
 * Example:
 *   "COVARIATE?(@IIV,[AGE,WT],EXP); COVARIATE?(@IIV,@CATEGORICAL,CAT)"
 *   → ["AGE", "WT"]
 */
function extractCovariateNames(searchSpace: string): string[] {
    if (!searchSpace) { return []; }
    const found = new Set<string>();
    // Match COVARIATE(...) or COVARIATE?(...) — capture the SECOND slot
    // (parameter, covariate, effect[, op]). Bracketed lists too: [WT,AGE].
    const re = /COVARIATE\??\s*\(\s*[^,()]+\s*,\s*(\[[^\]]+\]|[^,()]+)\s*,/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(searchSpace)) !== null) {
        const slot = m[1].trim();
        const inner = slot.startsWith('[') && slot.endsWith(']') ? slot.slice(1, -1) : slot;
        inner.split(',').map(s => s.trim()).filter(Boolean).forEach(name => {
            if (!name.startsWith('@')) { found.add(name); }
        });
    }
    return [...found];
}

/**
 * Preflight validation before Generate / Generate & Run.
 *
 * Two related pharmpy 2.1 bugs in `_mechanistic_cov_extraction`, both raising
 * `ValueError: Cannot be performed with reference value`:
 *
 *   (a) name collision — the SAME covariate listed in both
 *       `mechanistic_covariates` and a `COVARIATE?(…)` clause. Removing it
 *       from either side fixes it.
 *
 *   (b) reference-symbol collision — `mechanistic_covariates` is set AND any
 *       `COVARIATE?(…)` clause uses a `@`-prefixed reference symbol
 *       (`@IIV`, `@PK`, `@CONTINUOUS`, `@CATEGORICAL`, etc.). The subtraction
 *       pharmpy performs internally can't run against un-expanded references,
 *       so it throws even when there's no overlap on names. Users hitting
 *       this are usually blindsided because it doesn't look like a conflict.
 *
 * `allometric_variable` appearing anywhere is intentional and NOT flagged —
 * allometric scaling is a fixed transform applied at a different step and
 * does not go through the mechanistic subtraction path.
 */
export function validateAmdConfig(cfg: AmdConfig): string[] {
    const warnings: string[] = [];
    const mech = (cfg.mechanisticCovariates || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (mech.length === 0) { return warnings; }

    const searchSpace = cfg.searchSpace || '';
    const searchCovs = extractCovariateNames(searchSpace);

    // (a) Name overlap
    if (searchCovs.length > 0) {
        const mechSet = new Set(mech.map(s => s.toLowerCase()));
        const overlap = searchCovs.filter(c => mechSet.has(c.toLowerCase()));
        if (overlap.length > 0) {
            warnings.push(
                `Covariate(s) ${overlap.join(', ')} appear in BOTH mechanistic_covariates ` +
                `AND a search_space COVARIATE clause. This triggers a pharmpy 2.1 crash ` +
                `("Cannot be performed with reference value"). Remove them from one side — ` +
                `easiest is usually to drop them from the search_space COVARIATE clause.`
            );
        }
    }

    // (b) Reference-symbol presence in any COVARIATE clause
    const hasReferenceInCovariate = /COVARIATE\??\s*\(\s*(?:@\w+|[^,()]+)\s*,\s*(?:@\w+|[^,()]+|\[[^\]]+\])/i.test(searchSpace)
        && /COVARIATE\??\s*\([^)]*@\w+/i.test(searchSpace);
    if (hasReferenceInCovariate) {
        warnings.push(
            `mechanistic_covariates is set AND the search_space still contains a ` +
            `COVARIATE?(...) clause using a reference symbol (@IIV / @PK / @CONTINUOUS / @CATEGORICAL). ` +
            `pharmpy 2.1 crashes on this combination even when the covariate names do not overlap. ` +
            `Fix options: (1) drop mechanistic_covariates, (2) drop the COVARIATE clause from search_space, ` +
            `or (3) replace @-symbols with explicit column names (e.g. CL, VC, WT, AGE).`
        );
    }
    return warnings;
}

/**
 * Build an editable R script that mirrors the form state as a run_amd() call.
 * We intentionally omit optional args that are on their default so the emitted
 * script stays readable and doesn't hardcode pharmr's shifting defaults.
 */
function generateRScript(cfg: AmdConfig): string {
    const lines: string[] = [];
    const label = MODELTYPE_LABELS[cfg.modeltype] ?? cfg.modeltype;
    lines.push('# Auto-generated by nmbench — AMD Script Generator');
    lines.push(`# Modality: ${label} | Estimation tool: ${cfg.estTool || 'nonmem'}`);
    lines.push('# See ?pharmr::run_amd for argument reference.');
    lines.push('');
    lines.push('# Environment setup (managed by nmbench — do not edit) ----');
    lines.push('local({');
    lines.push('  Sys.setenv(PYTHONUNBUFFERED = "1")');
    lines.push('  if (nzchar(Sys.getenv("RETICULATE_PYTHON")) &&');
    lines.push('      !grepl("r-reticulate", Sys.getenv("RETICULATE_PYTHON"), fixed = TRUE)) {');
    lines.push('    Sys.unsetenv("RETICULATE_PYTHON")');
    lines.push('  }');
    lines.push('  reticulate::use_condaenv("r-reticulate", required = TRUE)');
    lines.push('  if (Sys.info()[["sysname"]] == "Darwin") {');
    lines.push('    for (b in c("/opt/homebrew/bin", "/usr/local/bin")) {');
    lines.push('      if (dir.exists(b) && !grepl(b, Sys.getenv("PATH"), fixed = TRUE)) {');
    lines.push('        Sys.setenv(PATH = paste0(b, ":", Sys.getenv("PATH")))');
    lines.push('      }');
    lines.push('    }');
    lines.push('    sdk <- tryCatch(system2("xcrun", "--show-sdk-path",');
    lines.push('                            stdout = TRUE, stderr = FALSE),');
    lines.push('                    error = function(e) character(0))');
    lines.push('    if (length(sdk) && dir.exists(sdk[[1]])) Sys.setenv(SDKROOT = sdk[[1]])');
    lines.push('  }');
    lines.push('})');
    lines.push('');
    lines.push('# Run ----');
    lines.push('library(pharmr)');
    if (cfg.input && cfg.input.trim()) {
        lines.push(`setwd(dirname("${escapeR(cfg.input.trim())}"))  # outputs land next to the dataset`);
    }
    lines.push('');

    const args: string[] = [];
    args.push(`  input = "${escapeR(cfg.input || 'path/to/data.csv')}"`);
    args.push(`  modeltype = "${cfg.modeltype}"`);
    args.push(`  administration = "${cfg.administration}"`);

    if (cfg.clInit !== undefined) { args.push(`  cl_init = ${cfg.clInit}`); }
    if (cfg.vcInit !== undefined) { args.push(`  vc_init = ${cfg.vcInit}`); }
    if (cfg.administration === 'oral' || cfg.administration === 'iv+oral') {
        if (cfg.matInit !== undefined) { args.push(`  mat_init = ${cfg.matInit}`); }
    }

    if (cfg.modeltype === 'pkpd') {
        if (cfg.bInit !== undefined) { args.push(`  b_init = ${cfg.bInit}`); }
        if (cfg.emaxInit !== undefined) { args.push(`  emax_init = ${cfg.emaxInit}`); }
        if (cfg.ec50Init !== undefined) { args.push(`  ec50_init = ${cfg.ec50Init}`); }
        if (cfg.metInit !== undefined) { args.push(`  met_init = ${cfg.metInit}`); }
    }
    if (cfg.modeltype === 'tmdd' && cfg.dvTypes) {
        const rList = parseDvTypes(cfg.dvTypes);
        if (rList) { args.push(`  dv_types = ${rList}`); }
    }

    if (cfg.searchSpace && cfg.searchSpace.trim()) {
        // MFL is whitespace-insensitive between tokens, but pharmpy's parser
        // trips on embedded newlines when the string is emitted multi-line in
        // R. Collapse all whitespace (including \n) to single spaces so the
        // emitted `search_space = "…"` is a single-line R literal.
        const oneLine = cfg.searchSpace.trim().replace(/\s+/g, ' ');
        args.push(`  search_space = "${escapeR(oneLine)}"`);
    }
    if (cfg.strategy && cfg.strategy !== 'default') {
        args.push(`  strategy = "${cfg.strategy}"`);
    }
    if (cfg.retriesStrategy && cfg.retriesStrategy !== 'skip') {
        args.push(`  retries_strategy = "${cfg.retriesStrategy}"`);
    }
    if (cfg.parameterUncertaintyMethod && cfg.parameterUncertaintyMethod !== 'none') {
        args.push(`  parameter_uncertainty_method = "${cfg.parameterUncertaintyMethod}"`);
    }
    if (cfg.estTool && cfg.estTool !== 'nonmem') {
        args.push(`  esttool = "${cfg.estTool}"`);
    }
    if (cfg.occasion && cfg.occasion.trim()) {
        args.push(`  occasion = "${escapeR(cfg.occasion.trim())}"`);
    }
    if (cfg.lloqMethod && cfg.lloqMethod !== 'none') {
        args.push(`  lloq_method = "${cfg.lloqMethod}"`);
    }
    if (cfg.lloqLimit !== undefined) {
        args.push(`  lloq_limit = ${cfg.lloqLimit}`);
    }
    if (cfg.allometricVariable && cfg.allometricVariable.trim()) {
        args.push(`  allometric_variable = "${escapeR(cfg.allometricVariable.trim())}"`);
    }
    if (cfg.mechanisticCovariates && cfg.mechanisticCovariates.trim()) {
        const items = cfg.mechanisticCovariates
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => `"${escapeR(s)}"`)
            .join(', ');
        if (items) {
            args.push(`  mechanistic_covariates = c(${items})`);
        }
    }
    if (cfg.seed !== undefined) { args.push(`  seed = ${cfg.seed}`); }

    lines.push('result <- run_amd(');
    lines.push(args.join(',\n'));
    lines.push(')');
    lines.push('');
    lines.push('# Summary tables');
    lines.push('print(result$summary_tool)');
    lines.push('print(result$summary_models)');
    lines.push('print(result$summary_errors)');
    lines.push('');

    return lines.join('\n');
}

export class AmdViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'amdView';
    private _view?: vscode.WebviewView;
    private _previewDoc?: vscode.TextDocument;
    private _previewContent?: string;

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        this._view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.getHtml();

        view.webview.onDidReceiveMessage((msg) => this.handleMessage(msg, view));
    }

    /**
     * Public message handler so a wrapping provider (see modelDevView.ts) can
     * dispatch to us without re-implementing the routing table.
     * @param reply optional override for sending back to the webview — used by
     *              the wrapper so replies get tagged with the panel id and
     *              routed to the correct iframe instead of leaking to the
     *              sibling panel.
     */
    public async handleMessage(
        msg: { command?: string; config?: unknown; [k: string]: unknown },
        view: vscode.WebviewView,
        reply?: (m: Record<string, unknown>) => void,
    ): Promise<void> {
        const send = reply ?? ((m: Record<string, unknown>) => view.webview.postMessage(m));

        if (msg.command === 'browseInput') {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Select data / model file',
                filters: {
                    'Datasets & models': ['csv', 'tsv', 'txt', 'mod', 'ctl', 'lst'],
                    'All files': ['*']
                }
            });
            if (picked && picked[0]) {
                send({ command: 'inputPicked', path: picked[0].fsPath });
            }
            return;
        }

        if (msg.command === 'generate') {
            const cfg = msg.config as AmdConfig;
            if (!(await this.confirmWithWarnings(cfg, 'Generate Code'))) { return; }
            const script = generateRScript(cfg);
            await this.openPreviewDoc(script, cfg.input || '');
            return;
        }

        if (msg.command === 'generateAndRun') {
            const cfg = msg.config as AmdConfig;
            if (!(await this.confirmWithWarnings(cfg, 'Generate & Run'))) { return; }
            const script = generateRScript(cfg);
            await this.writeAndRun(script, cfg.input || '');
            return;
        }

        if (msg.command === 'runPharmpyInstall') {
            await vscode.commands.executeCommand('extension.openPharmrSetup');
            return;
        }
    }

    /**
     * Run pre-flight validation on the form config. If any warnings surface,
     * ask the user whether to proceed. Returns true when it's OK to continue,
     * false when the user chose to cancel and go fix the form.
     */
    private async confirmWithWarnings(cfg: AmdConfig, action: string): Promise<boolean> {
        const warnings = validateAmdConfig(cfg);
        if (warnings.length === 0) { return true; }
        const proceed = 'Proceed anyway';
        const cancel = 'Cancel';
        const choice = await vscode.window.showWarningMessage(
            `${action}: ${warnings.length} potential issue${warnings.length === 1 ? '' : 's'} found.\n\n${warnings.join('\n\n')}`,
            { modal: true },
            proceed, cancel,
        );
        return choice === proceed;
    }

    /**
     * Open the generated script as an untitled R document named
     * `amd_<dataset-basename>.R`. If a previous tab is still open AND still holds
     * our last-emitted content (user hasn't edited it), we replace its contents in
     * place so successive Generate clicks don't spam new tabs. If the user has
     * edited that tab we create a fresh one so their edits are preserved. On
     * Cmd/Ctrl+S, VS Code pre-fills the Save-As dialog with this name.
     */
    private async openPreviewDoc(script: string, inputPath: string): Promise<void> {
        const canReuse = !!this._previewDoc
            && !this._previewDoc.isClosed
            && this._previewDoc.getText() === this._previewContent;
        if (canReuse && this._previewDoc) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(this._previewDoc.uri, new vscode.Range(0, 0, this._previewDoc.lineCount, 0), script);
            await vscode.workspace.applyEdit(edit);
            this._previewContent = script;
            await vscode.window.showTextDocument(this._previewDoc, { viewColumn: vscode.ViewColumn.One, preview: false });
            return;
        }
        const baseName = this.computeAmdName(inputPath);
        // Anchor the untitled URI at the dataset's directory (falling back to
        // the workspace folder, then the cwd) so VS Code's Save-As dialog
        // defaults there instead of the filesystem root. Without an anchor the
        // save target resolves to "/amd_xxx.R" which is read-only on macOS/Linux.
        //
        // Bump the counter until the candidate name collides with neither an
        // already-open untitled doc NOR an on-disk file. Untitled URIs whose
        // fsPath maps to an existing file silently no-op in openTextDocument,
        // which manifested as "Generate Code does nothing on second click".
        const anchorDir = this.pickAnchorDir(inputPath);
        const buildCandidate = (name: string) => {
            const abs = path.join(anchorDir, name);
            return { uri: vscode.Uri.file(abs).with({ scheme: 'untitled' }), abs };
        };
        let candidate = buildCandidate(baseName);
        let n = 2;
        while (
            vscode.workspace.textDocuments.some(d => d.uri.toString() === candidate.uri.toString()) ||
            fs.existsSync(candidate.abs)
        ) {
            candidate = buildCandidate(baseName.replace(/\.R$/, '_' + n + '.R'));
            n++;
        }
        const uri = candidate.uri;
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(uri, new vscode.Position(0, 0), script);
        await vscode.workspace.applyEdit(edit);
        await vscode.languages.setTextDocumentLanguage(doc, 'r');
        this._previewDoc = doc;
        this._previewContent = script;
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
    }

    /**
     * Write the generated R script to disk next to the input dataset (using
     * the same `amd_<basename>.R` naming convention) and immediately execute
     * it in a fresh terminal. Bumps `_2.R`, `_3.R` on collision instead of
     * overwriting so a repeat click doesn't clobber a running job.
     */
    private async writeAndRun(script: string, inputPath: string): Promise<void> {
        const anchorDir = this.pickAnchorDir(inputPath);
        const baseName = this.computeAmdName(inputPath);
        let target = path.join(anchorDir, baseName);
        let n = 2;
        while (fs.existsSync(target)) {
            target = path.join(anchorDir, baseName.replace(/\.R$/, `_${n}.R`));
            n++;
        }
        try {
            await fs.promises.mkdir(anchorDir, { recursive: true });
            await fs.promises.writeFile(target, script, 'utf-8');
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to write ${target}: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        runRscriptFileInTerminal(target, anchorDir, path.basename(target));
    }

    private pickAnchorDir(inputPath: string): string {
        const trimmed = (inputPath || '').trim();
        if (trimmed) {
            const dir = path.dirname(trimmed);
            if (dir && dir !== '.') { return dir; }
        }
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (ws) { return ws; }
        return process.cwd();
    }

    private computeAmdName(inputPath: string): string {
        const trimmed = (inputPath || '').trim();
        if (!trimmed) { return 'amd_dataset.R'; }
        const base = trimmed.split(/[\\/]/).pop() || 'dataset';
        let stem = base.replace(/\.[^.]+$/, '') || 'dataset';
        stem = stem.replace(/[^\w\-.]/g, '_');
        return 'amd_' + stem + '.R';
    }

    public getHtml(): string {
        // The form covers all four modalities up-front; modality-specific sections are toggled by JS.
        // Only PK is treated as "validated" today — the others are flagged as beta so users know to
        // review the emitted script before running.
        return /* html */`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <style>
        body {
            /* estview-inspired muted palette — kept as literals so the
               Pharmpy/R form has the same sober feel as the Estimates view
               regardless of the active VS Code theme. */
            --nmb-blue:   #6699cc;
            --nmb-green:  #3bb273;
            --nmb-yellow: #f2c94c;
            --nmb-purple: #b191d6;
            --nmb-red:    #e24c4b;

            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 8px 10px;
            margin: 0;
        }
        h3 {
            margin: 22px 0 8px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--nmb-blue);
            padding: 3px 0 4px 10px;
            border-left: 3px solid var(--nmb-blue);
        }
        /* First h3 in the panel doesn't need a big top margin — visual header. */
        body > h3:first-of-type,
        body > *:first-child h3 { margin-top: 6px; }
        /* Semantic color roles by section role. */
        h3.section-search {
            color: var(--nmb-blue);
            border-left-color: var(--nmb-blue);
        }
        /* Initial estimates + Advanced share yellow — both are numerical
           tuning knobs rather than model-structure decisions. */
        h3.section-initial {
            color: var(--nmb-yellow);
            border-left-color: var(--nmb-yellow);
        }
        /* Modality picker + the modality-triggered sub-sections (PK-PD, TMDD,
           Drug Metabolite) share red so users can see at a glance which
           blocks reconfigure themselves based on modality choice. */
        h3.section-modality {
            color: var(--nmb-red);
            border-left-color: var(--nmb-red);
        }
        details.advanced-block { margin: 22px 0 8px; }
        details.advanced-block > summary {
            cursor: pointer;
            list-style: none;
            outline: none;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        details.advanced-block > summary::-webkit-details-marker { display: none; }
        details.advanced-block > summary::before {
            content: '▸';
            color: var(--nmb-yellow);
            transition: transform 0.15s;
            display: inline-block;
        }
        details.advanced-block[open] > summary::before { transform: rotate(90deg); }
        details.advanced-block > summary > h3 {
            border-left: none !important;
            padding: 0 !important;
            margin: 0 !important;
            color: var(--nmb-yellow) !important;
        }
        /* Labels of the tuning knobs under Advanced pick up the same yellow. */
        details.advanced-block label {
            color: var(--nmb-yellow);
        }
        label {
            display: block;
            margin: 8px 0 3px;
            font-size: 12px;
        }
        input[type="text"], input[type="number"], select, textarea {
            width: 100%;
            box-sizing: border-box;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 4px 5px;
            font-family: var(--vscode-font-family);
            font-size: 12px;
        }
        textarea { min-height: 44px; font-family: var(--vscode-editor-font-family); }
        .row { display: flex; gap: 6px; align-items: end; margin-bottom: 3px; }
        .row > * { flex: 1; }
        /* When labels can differ in width, .row.aligned forces the label row
           and the input row to line up cell-by-cell instead of drifting by a
           pixel or two. Labels are single-line + fixed line-height, and inputs
           get a shared min-height so <select> (which is intrinsically ~1px
           taller than <input>) doesn't shove its neighbour up. */
        .row.aligned > * { display: flex; flex-direction: column; }
        .row.aligned label {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.4;
            min-height: 1.4em;
        }
        /* Explicit height (not min-height) so <select> — which is usually a
           pixel or two taller than <input> in Chromium because of the
           internal arrow-button padding — matches the text inputs exactly. */
        .row.aligned input,
        .row.aligned select {
            height: 26px;
            line-height: 18px;
            padding: 3px 5px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            line-height: 1.2;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        /* Setup Env / Generate Code / Generate & Run all share the purple role —
           they're the panel's primary action row and read as one group. */
        button.secondary,
        button.primary {
            background: transparent;
            color: var(--nmb-purple);
            border: 1px solid var(--nmb-purple);
        }
        button.secondary:hover,
        button.primary:hover {
            background: rgba(177, 145, 214, 0.14);
        }
        /* "Edit as text" toggle sits inside the Search space (blue) section,
           so override the shared secondary/primary purple to blue. Same
           treatment for Setup Env — it's a Rscript / conda setup helper,
           not a code-generation action, so it belongs with the panel's
           blue role rather than the purple action row. */
        button#mfl-toggle-text,
        button#setup-env {
            color: var(--nmb-blue);
            border-color: var(--nmb-blue);
        }
        button#mfl-toggle-text:hover,
        button#setup-env:hover {
            background: rgba(102, 153, 204, 0.12);
        }
        .modality-section { display: none; }
        .modality-section.active {
            display: block;
            padding: 6px 10px 8px;
            background: rgba(226, 76, 75, 0.05);
            border-left: 2px solid var(--nmb-red);
            margin: 4px 0 8px;
            border-radius: 0 4px 4px 0;
        }
        .beta-badge {
            display: inline-block;
            font-size: 10px;
            background: var(--nmb-yellow);
            color: var(--vscode-editor-background, #000);
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 6px;
            vertical-align: middle;
        }
        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .actions {
            display: flex;
            gap: 6px;
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        button.run-full {
            width: 100%;
            margin-top: 6px;
            background: transparent;
            color: var(--nmb-purple);
            border: 1px solid var(--nmb-purple);
            border-radius: 3px;
        }
        button.run-full:hover { background: rgba(177, 145, 214, 0.14); }
        .actions > button { flex: 1 1 0; }
        .status {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 6px;
            min-height: 14px;
        }
        .mfl-toolbar { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
        .mfl-toolbar > select { flex: 1; }
        .mfl-cards { display: flex; flex-direction: column; gap: 6px; }
        .mfl-card {
            border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
            border-radius: 4px;
            padding: 6px 8px;
            background: rgba(128,128,128,0.03);
        }
        .mfl-card.disabled { opacity: 0.55; }
        .mfl-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            flex-wrap: wrap;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            letter-spacing: 0.3px;
            /* MFL cards live inside the Search space section, which is blue. */
            color: var(--nmb-blue);
            margin-bottom: 4px;
        }
        .mfl-card-header > .mfl-help-btn { flex: 0 0 auto; }
        .mfl-card[data-feat="metabolite"] .mfl-card-header {
            color: var(--nmb-yellow);
        }
        .mfl-include { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
        .mfl-include input { margin: 0; }
        /* Checked-state color for all MFL / covariate checkboxes — they live
           inside the Search space section, so blue keeps the visual family. */
        .mfl-include input[type="checkbox"],
        .mfl-card input[type="checkbox"] {
            accent-color: var(--nmb-blue);
        }
        .mfl-card-body { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .chip-group { display: flex; flex-wrap: wrap; gap: 3px; }
        .chip {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
            padding: 1px 8px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 11px;
            line-height: 1.6;
            font-family: var(--vscode-editor-font-family);
        }
        .chip:focus { outline: none; }
        .chip:hover:not(.active) {
            background: rgba(128, 128, 128, 0.08);
            color: var(--vscode-foreground);
            border-color: var(--vscode-input-border, rgba(128,128,128,0.55));
        }
        .chip.active {
            border-color: var(--nmb-blue);
            background: rgba(102, 153, 204, 0.15);
            color: var(--nmb-blue);
        }
        .chip.active:hover {
            background: rgba(102, 153, 204, 0.22);
        }
        .chip.removable { padding-right: 4px; }
        .chip .rm { margin-left: 4px; opacity: 0.55; cursor: pointer; }
        .chip .rm:hover { opacity: 1; }
        input.mfl-inline-input {
            box-sizing: border-box;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            padding: 1px 4px;
            font-size: 11px;
            field-sizing: content;
            width: auto;
            min-width: 22px;
            max-width: 90px;
        }
        input.mfl-inline-input::-webkit-inner-spin-button,
        input.mfl-inline-input::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        .mfl-sublabel { opacity: 0.7; font-size: 11px; margin-left: 4px; }
        .mfl-inline-adder { display: inline-flex; gap: 4px; align-items: center; }
        .mfl-btn-mini {
            background: transparent;
            color: var(--nmb-blue);
            border: 1px dashed var(--nmb-blue);
            padding: 1px 8px;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
            line-height: 1.5;
        }
        .mfl-btn-mini:hover { background: rgba(102, 153, 204, 0.1); }
        .mfl-help-btn {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.4));
            border-radius: 50%;
            width: 16px;
            height: 16px;
            padding: 0;
            font-size: 10px;
            line-height: 1;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .mfl-help-btn:hover {
            background: rgba(128,128,128,0.08);
            color: var(--vscode-foreground);
            border-color: var(--nmb-blue);
        }
        .mfl-help-btn:focus { outline: none; }
        .mfl-card-header-right { display: inline-flex; align-items: center; gap: 6px; }
        .mfl-preview-wrap { margin-top: 8px; }
        .mfl-preview-wrap > label { display: block; font-size: 11px; opacity: 0.75; margin: 0 0 3px; }
        .mfl-preview {
            background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.08));
            border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
            padding: 6px 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--vscode-editor-foreground);
            margin: 0;
            min-height: 30px;
            max-height: 200px;
            overflow: auto;
        }
        .mfl-cov-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 6px;
            padding: 5px 6px;
            border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
            border-radius: 3px;
            background: rgba(128,128,128,0.02);
        }
        .mfl-cov-target {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            align-items: center;
        }
        .mfl-cov-target > .mfl-combo {
            flex: 1 1 90px;
            min-width: 80px;
            position: relative;
            display: flex;
            align-items: stretch;
        }
        .mfl-combo > input[type="text"] {
            flex: 1 1 auto;
            width: 100%;
            box-sizing: border-box;
            font-size: 11px;
            padding: 2px 22px 2px 4px;
            min-width: 0;
        }
        .mfl-combo-btn {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 18px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: none;
            padding: 0;
            font-size: 10px;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .mfl-combo-btn:hover {
            color: var(--nmb-blue);
            background: rgba(128, 128, 128, 0.08);
        }
        .mfl-combo-btn:focus { outline: none; }
        .mfl-combo-menu {
            position: absolute;
            top: 100%;
            left: 0;
            min-width: 100%;
            width: max-content;
            max-width: 220px;
            z-index: 20;
            background: var(--vscode-dropdown-background, var(--vscode-editor-background));
            color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, rgba(128,128,128,0.4)));
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            max-height: 220px;
            overflow-y: auto;
            padding: 2px 0;
            margin-top: 1px;
        }
        .mfl-combo-item {
            padding: 3px 8px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            cursor: pointer;
            white-space: nowrap;
            color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
        }
        .mfl-combo-item:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-list-hoverForeground);
        }
        .mfl-cov-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
        }
        .mfl-cov-effects { display: flex; gap: 3px; flex-wrap: wrap; }
        .mfl-cov-op { display: flex; gap: 3px; }
        .mfl-cov-optional {
            display: inline-flex; align-items: center; gap: 3px; font-size: 11px;
            font-family: var(--vscode-editor-font-family);
        }
        .mfl-cov-actions .mfl-btn-mini { margin-left: auto; }
        .mfl-text-mode { display: none; }
        .mfl-text-mode.active { display: block; }
    </style>
</head>
<body>
    <h3 class="section-modality" title="Passed to run_amd(modeltype = ...) — basic_pk | pkpd | tmdd | drug_metabolite">Modality</h3>
    <select id="modeltype">
        <option value="basic_pk">PK — basic_pk</option>
        <option value="pkpd">PK-PD — pkpd (beta)</option>
        <option value="tmdd">TMDD — tmdd (beta)</option>
        <option value="drug_metabolite">Drug Metabolite — drug_metabolite (beta)</option>
    </select>
    <div id="beta-note" class="hint" style="display:none;">
        Beta modality — cross-check emitted script against <code>?pharmr::run_amd</code> before running.
    </div>

    <h3>Input</h3>
    <div class="row" style="align-items: stretch;">
        <input type="text" id="input" placeholder="Path to dataset (or start model for PK-PD)">
        <button class="secondary" id="browse-input" style="flex:0 0 auto;">Browse…</button>
    </div>

    <h3 title="administration + esttool + occasion + lloq_* passed to run_amd()">Common</h3>
    <div class="row">
        <div>
            <label for="administration">Administration</label>
            <select id="administration">
                <option value="iv">iv</option>
                <option value="oral" selected>oral</option>
                <option value="iv+oral">iv+oral</option>
            </select>
        </div>
        <div>
            <label for="estTool">Estimation tool</label>
            <select id="estTool" title="pharmpy's esttool arg — accepted values: nonmem, nlmixr, dummy, pharmpy">
                <option value="nonmem" selected>nonmem (default)</option>
                <option value="nlmixr">nlmixr</option>
                <option value="dummy">dummy (skip fit)</option>
                <option value="pharmpy">pharmpy (native)</option>
            </select>
        </div>
    </div>
    <div class="row aligned">
        <div>
            <label for="occasion" title="Column name in the dataset that flags occasions/visits. Enables the IOV step in run_amd(). Leave blank to skip.">occasion</label>
            <input type="text" id="occasion" placeholder="e.g. VISI (blank = no IOV)">
        </div>
        <div>
            <label for="lloqLimit" title="Numeric LLOQ threshold. If blank, pharmpy uses the LLOQ column in the dataset (when available).">lloq_limit</label>
            <input type="number" id="lloqLimit" step="any" placeholder="e.g. 0.1">
        </div>
        <div>
            <label for="lloqMethod" title="How to handle observations below the lower limit of quantification. See pharmpy.modeling.transform_blq.">lloq_method</label>
            <select id="lloqMethod">
                <option value="none" selected>(none)</option>
                <option value="m1">m1 (drop BLQ rows)</option>
                <option value="m3">m3 (likelihood-based)</option>
                <option value="m4">m4 (m3 + IPRED &gt; 0)</option>
                <option value="m5">m5 (replace with LLOQ/2)</option>
                <option value="m6">m6 (replace with 0)</option>
                <option value="m7">m7 (replace with LLOQ)</option>
            </select>
        </div>
    </div>
    <div class="row aligned">
        <div>
            <label for="allometricVariable" title="Body-weight column. Setting this enables allometric scaling (CL∝WT^0.75, V∝WT^1.0) AND registers the column as a covariate so @CONTINUOUS resolves.">allometric_variable</label>
            <input type="text" id="allometricVariable" placeholder="e.g. WT (blank = skip allometry)">
        </div>
        <div>
            <label for="mechanisticCovariates" title="Comma-separated covariate columns to test in the mechanistic step (structural_covariates). Also registers them so @CONTINUOUS/@CATEGORICAL resolve when no .datainfo is present.">mechanistic_covariates</label>
            <input type="text" id="mechanisticCovariates" placeholder="e.g. CRCL, AGE">
        </div>
    </div>

    <h3 class="section-initial" title="cl_init / vc_init / mat_init passed to run_amd() — used to seed the base model">Initial estimates</h3>
    <div class="row">
        <div>
            <label for="clInit">cl_init</label>
            <input type="number" id="clInit" step="any" placeholder="e.g. 2.0">
        </div>
        <div>
            <label for="vcInit">vc_init</label>
            <input type="number" id="vcInit" step="any" placeholder="e.g. 5.0">
        </div>
        <div id="matInitCell">
            <label for="matInit">mat_init <span class="hint">(oral)</span></label>
            <input type="number" id="matInit" step="any" placeholder="e.g. 3.0">
        </div>
    </div>

    <div id="section-pkpd" class="modality-section">
        <h3 class="section-modality" title="b_init / emax_init / ec50_init passed to run_amd() for PK-PD modality">PK-PD initial estimates <span class="beta-badge">beta</span></h3>
        <div class="row">
            <div>
                <label for="bInit">b_init</label>
                <input type="number" id="bInit" step="any">
            </div>
            <div>
                <label for="emaxInit">emax_init</label>
                <input type="number" id="emaxInit" step="any">
            </div>
        </div>
        <div class="row">
            <div>
                <label for="ec50Init">ec50_init</label>
                <input type="number" id="ec50Init" step="any">
            </div>
            <div>
                <label for="metInit">met_init</label>
                <input type="number" id="metInit" step="any">
            </div>
        </div>
        <div class="hint">Input should be a fully-built PK model (not a raw dataset). Dataset must have DVID = 1 (PK) / 2 (PD).</div>
    </div>

    <div id="section-tmdd" class="modality-section">
        <h3 class="section-modality" title="dv_types dict passed to run_amd() — maps DV components (drug/target/complex) to DVID integers">TMDD <span class="beta-badge">beta</span></h3>
        <label for="dvTypes">dv_types</label>
        <input type="text" id="dvTypes" placeholder="drug:1, target:2, complex:3">
        <div class="hint">Comma-separated key:value pairs mapping DV components to DVID integers.</div>
    </div>

    <div id="section-drug_metabolite" class="modality-section">
        <h3 class="section-modality" title="Dataset must have DVID = 1 (parent) / 2 (metabolite); MFL METABOLITE + PERIPHERALS=MET drive the search">Drug Metabolite <span class="beta-badge">beta</span></h3>
        <div class="hint">Dataset must have DVID = 1 (parent) / 2 (metabolite). Use the <b>METABOLITE</b> card below and set PERIPHERALS scope to <b>MET</b> to search metabolite peripherals.</div>
    </div>

    <details class="advanced-block">
        <summary title="strategy / retries_strategy / parameter_uncertainty_method / seed passed to run_amd()"><h3 style="display:inline-block;margin:0;">Advanced</h3></summary>
        <div class="row" style="margin-top:8px;">
            <div>
                <label for="strategy">strategy</label>
                <select id="strategy">
                    <option value="default" selected>default</option>
                    <option value="reevaluation">reevaluation</option>
                    <option value="SIR">SIR</option>
                    <option value="SRI">SRI</option>
                    <option value="RSI">RSI</option>
                </select>
            </div>
            <div>
                <label for="retriesStrategy">retries_strategy</label>
                <select id="retriesStrategy">
                    <option value="skip" selected>skip</option>
                    <option value="all_final">all_final</option>
                    <option value="final">final</option>
                </select>
            </div>
        </div>
        <div class="row">
            <div>
                <label for="parameterUncertaintyMethod">parameter_uncertainty_method</label>
                <select id="parameterUncertaintyMethod">
                    <option value="none" selected>(none)</option>
                    <option value="SANDWICH">SANDWICH</option>
                    <option value="SMAT">SMAT</option>
                    <option value="RMAT">RMAT</option>
                    <option value="EFIM">EFIM</option>
                </select>
            </div>
            <div>
                <label for="seed">seed</label>
                <input type="number" id="seed" step="1" value="123456" placeholder="e.g. 1234">
            </div>
        </div>
    </details>
    <h3 class="section-search" title="MFL DSL string passed to run_amd(search_space = ...) — controls which variants pharmpy explores">Search space (MFL)</h3>
    <div class="mfl-toolbar">
        <select id="mflPreset">
            <option value="empty" selected>Preset: Default</option>
            <option value="basic-pk">Preset: Basic PK</option>
            <option value="exhaustive-pk">Preset: Exhaustive PK</option>
            <option value="covariate-only">Preset: Covariates only</option>
            <option value="custom" disabled>Preset: Custom</option>
        </select>
        <button class="secondary" id="mfl-toggle-text" style="flex: 0 0 auto;">Edit as text</button>
    </div>

    <div id="mfl-cards" class="mfl-cards">
        <div class="mfl-card" data-feat="absorption">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="absorption"> ABSORPTION</label>
            </div>
            <div class="mfl-card-body">
                <div class="chip-group" data-multi="absorption">
                    <button class="chip" data-val="FO" title="First-order absorption">FO</button>
                    <button class="chip" data-val="ZO" title="Zero-order absorption">ZO</button>
                    <button class="chip" data-val="SEQ-ZO-FO" title="Sequential zero-order then first-order absorption">SEQ-ZO-FO</button>
                    <button class="chip" data-val="INST" title="Instantaneous absorption (bolus-like)">INST</button>
                    <button class="chip" data-val="WEIBULL" title="Weibull absorption">WEIBULL</button>
                </div>
            </div>
        </div>

        <div class="mfl-card" data-feat="elimination">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="elimination"> ELIMINATION</label>
            </div>
            <div class="mfl-card-body">
                <div class="chip-group" data-multi="elimination">
                    <button class="chip" data-val="FO" title="First-order elimination">FO</button>
                    <button class="chip" data-val="ZO" title="Zero-order elimination">ZO</button>
                    <button class="chip" data-val="MM" title="Michaelis–Menten (saturable) elimination">MM</button>
                    <button class="chip" data-val="MIX-FO-MM" title="Mixed first-order + Michaelis–Menten elimination">MIX-FO-MM</button>
                </div>
            </div>
        </div>

        <div class="mfl-card" data-feat="lagtime">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="lagtime"> LAGTIME</label>
            </div>
            <div class="mfl-card-body">
                <div class="chip-group" data-single="lagtime">
                    <button class="chip" data-val="OFF" title="Do not include a lag time">OFF only</button>
                    <button class="chip" data-val="ON" title="Always include a lag time (ALAG)">ON only</button>
                    <button class="chip" data-val="BOTH" title="Search both with and without lag time">Both</button>
                </div>
            </div>
        </div>

        <div class="mfl-card" data-feat="transits">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="transits"> TRANSITS</label>
            </div>
            <div class="mfl-card-body">
                <div class="chip-group" id="transits-row" style="align-items:center;">
                    <span class="mfl-inline-adder" id="transits-adder">
                        <input class="mfl-inline-input" type="number" id="transits-new" min="0" step="1" placeholder="+n">
                        <button class="mfl-btn-mini" id="transits-add">Add</button>
                    </span>
                </div>
                <span class="mfl-inline-adder">
                    <span class="mfl-sublabel" style="margin-left:0;">depot:</span>
                    <div class="chip-group" data-multi="transitsDepots">
                        <button class="chip" data-val="DEPOT" title="Include an explicit depot compartment before the transits">DEPOT</button>
                        <button class="chip" data-val="NODEPOT" title="No depot compartment before the transits">NODEPOT</button>
                    </div>
                </span>
            </div>
        </div>

        <div class="mfl-card" data-feat="peripherals">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="peripherals"> PERIPHERALS</label>
            </div>
            <div class="mfl-card-body">
                <span class="mfl-sublabel">min</span>
                <input class="mfl-inline-input" type="number" id="peripherals-min" min="0" step="1" value="0">
                <span class="mfl-sublabel">..</span>
                <span class="mfl-sublabel">max</span>
                <input class="mfl-inline-input" type="number" id="peripherals-max" min="0" step="1" value="1">
                <span class="mfl-inline-adder" data-peripherals-scope-wrap style="display:none;">
                    <span class="mfl-sublabel" data-peripherals-scope-label style="margin-left:0;">scope:</span>
                    <div class="chip-group" data-single="peripheralsScope" data-peripherals-scope-group>
                        <button class="chip" data-val="" title="Default scope (parent drug)">(any)</button>
                        <button class="chip" data-val="DRUG" title="Search peripherals on the parent drug">DRUG</button>
                        <button class="chip" data-val="MET" title="Search peripherals on the metabolite">MET</button>
                    </div>
                </span>
            </div>
        </div>

        <div class="mfl-card" data-feat="covariates">
            <div class="mfl-card-header">
                <label class="mfl-include"><input type="checkbox" data-include="covariates"> COVARIATE</label>
                <span class="mfl-card-header-right">
                    <button type="button" class="mfl-help-btn" data-help-toggle="covariates" title="Show help">?</button>
                    <button class="mfl-btn-mini" id="cov-add">+ Add row</button>
                </span>
            </div>
            <div class="mfl-card-body" style="display:block;">
                <div id="cov-rows"></div>
                <div class="hint" data-help-panel="covariates" hidden style="margin-top: 4px; line-height: 1.5;">
                    Each row emits one <code>COVARIATE</code> statement.<br>
                    <code>?</code> = optional (search space; unchecked = always included).<br>
                    <code>@</code> = symbol group (e.g. <code>@IIV</code> = all params with IIV, <code>@CONTINUOUS</code> = all continuous covariates).<br>
                    <code>×</code> / <code>+</code> = how the effect combines with the parameter — <code>×</code>: <code>PARAM · effect</code> (default), <code>+</code>: <code>PARAM + effect</code>.
                </div>
            </div>
        </div>

        <div class="mfl-card" data-feat="metabolite" data-metabolite-card style="display:none;">
            <div class="mfl-card-header">
                <label class="mfl-include" title="Available only for drug_metabolite modality"><input type="checkbox" data-include="metabolite"> METABOLITE</label>
                <button type="button" class="mfl-help-btn" data-help-toggle="metabolite" title="Show help">?</button>
            </div>
            <div class="mfl-card-body" style="display:block;">
                <div class="chip-group" data-multi="metabolite">
                    <button class="chip" data-val="BASIC" title="Basic metabolite — parent → metabolite conversion (100%) into a systemic metabolite compartment (with its own elimination). Standard model for drugs whose active metabolite appears after distribution.">BASIC</button>
                    <button class="chip" data-val="PSC" title="Presystemic (first-pass) metabolite — parent → metabolite conversion (100%) inside a presystemic compartment, so the metabolite is formed during absorption before reaching systemic circulation. Fits oral drugs with strong first-pass metabolism.">PSC</button>
                </div>
                <div class="hint" data-help-panel="metabolite" hidden style="margin-top: 4px;">
                    <b>BASIC</b>: parent → systemic metabolite compartment (normal).<br>
                    <b>PSC</b>: parent → presystemic (first-pass) metabolite — formed during absorption. Both allow peripherals via <code>PERIPHERALS(...,MET)</code>.
                </div>
            </div>
        </div>
    </div>

    <div id="mfl-text-mode" class="mfl-text-mode">
        <label for="searchSpace" style="margin-top:6px;">Raw MFL text</label>
        <textarea id="searchSpace" placeholder="Leave blank to use pharmpy's default"></textarea>
        <div class="hint">Advanced mode — hand-write MFL. Card state is preserved; switching back to cards discards edits made only in text mode.</div>
    </div>

    <div class="mfl-preview-wrap">
        <label>Compiled <code>search_space</code></label>
        <pre id="mfl-preview" class="mfl-preview"></pre>
    </div>

    <div class="actions">
        <button class="secondary" id="setup-env" title="Run pharmpy_install.R in a terminal — checks conda env, installs pharmr/pharmpy if missing">Setup Env.</button>
        <button class="primary" id="generate">Generate Code</button>
    </div>
    <button class="run-full" id="generate-and-run" title="Save the R script next to the dataset and run it now in a terminal">Generate &amp; Run</button>

    <script>
        const vscode = acquireVsCodeApi();

        const modeltypeEl = document.getElementById('modeltype');
        const betaNote = document.getElementById('beta-note');
        const administrationEl = document.getElementById('administration');
        const matCell = document.getElementById('matInitCell');

        function refreshModality() {
            const value = modeltypeEl.value;
            for (const key of ['pkpd', 'tmdd', 'drug_metabolite']) {
                const section = document.getElementById('section-' + key);
                if (section) { section.classList.toggle('active', value === key); }
            }
            betaNote.style.display = value === 'basic_pk' ? 'none' : 'block';
        }
        function refreshAdministration() {
            const isOral = administrationEl.value === 'oral' || administrationEl.value === 'iv+oral';
            matCell.style.opacity = isOral ? '1' : '0.4';
        }
        modeltypeEl.addEventListener('change', () => { refreshModality(); refreshMflModality(); });
        administrationEl.addEventListener('change', refreshAdministration);

        // ---------- MFL search-space builder ----------
        const MFL_PRESETS = {
            'basic-pk': {
                absorption: { include: true, values: ['FO','ZO','SEQ-ZO-FO'] },
                elimination: { include: true, values: ['FO'] },
                lagtime:     { include: true, mode: 'BOTH' },
                transits:    { include: true, counts: [0,1,3,10], depots: ['DEPOT','NODEPOT'] },
                peripherals: { include: true, min: 0, max: 1, scope: '' },
                covariates:  { include: true, rows: [
                    { optional: true, parameter: '@IIV', covariate: '@CONTINUOUS', effects: ['EXP'], op: '*' },
                    { optional: true, parameter: '@IIV', covariate: '@CATEGORICAL', effects: ['CAT'], op: '*' }
                ]},
                metabolite:  { include: false, values: ['BASIC','PSC'] }
            },
            'exhaustive-pk': {
                absorption: { include: true, values: ['FO','ZO','SEQ-ZO-FO','INST','WEIBULL'] },
                elimination:{ include: true, values: ['FO','ZO','MM','MIX-FO-MM'] },
                lagtime:    { include: true, mode: 'BOTH' },
                transits:   { include: true, counts: [0,1,3,5,10], depots: ['DEPOT','NODEPOT'] },
                peripherals:{ include: true, min: 0, max: 2, scope: '' },
                covariates: { include: false, rows: [] },
                metabolite: { include: false, values: ['BASIC','PSC'] }
            },
            'covariate-only': {
                absorption: { include: false, values: [] },
                elimination:{ include: false, values: [] },
                lagtime:    { include: false, mode: 'BOTH' },
                transits:   { include: false, counts: [], depots: ['DEPOT','NODEPOT'] },
                peripherals:{ include: false, min: 0, max: 1, scope: '' },
                covariates: { include: true, rows: [
                    { optional: true, parameter: '@IIV', covariate: '@CONTINUOUS', effects: ['EXP'], op: '*' },
                    { optional: true, parameter: '@IIV', covariate: '@CATEGORICAL', effects: ['CAT'], op: '*' }
                ]},
                metabolite: { include: false, values: ['BASIC','PSC'] }
            },
            'empty': {
                absorption: { include: false, values: [] },
                elimination:{ include: false, values: [] },
                lagtime:    { include: false, mode: 'BOTH' },
                transits:   { include: false, counts: [], depots: ['DEPOT','NODEPOT'] },
                peripherals:{ include: false, min: 0, max: 1, scope: '' },
                covariates: { include: false, rows: [] },
                metabolite: { include: false, values: ['BASIC','PSC'] }
            }
        };
        const EFFECT_OPTIONS = ['EXP','POW','LIN','CAT','PIECE_LIN'];
        const EFFECT_TIPS = {
            EXP: 'Exponential (continuous): coveff = exp(θ · (cov − median))',
            POW: 'Power (continuous): coveff = (cov / median)^θ',
            LIN: 'Linear (continuous): coveff = 1 + θ · (cov − median)',
            CAT: 'Categorical: 1 for reference category, 1 + θᵢ for each other category',
            PIECE_LIN: 'Piecewise linear (continuous): different slopes below and above median'
        };
        const PARAM_OPTIONS = ['@IIV','@PK','@PD','@PK_IIV','@PD_IIV','@ABSORPTION','@ELIMINATION','@DISTRIBUTION','@BIOAVAIL','CL','VC','V','MAT','K12','K21'];
        const COV_OPTIONS = ['@CONTINUOUS','@CATEGORICAL'];
        function renderComboItems(opts) {
            return opts.map(function(o) {
                return '<div class="mfl-combo-item" data-val="' + o + '">' + o + '</div>';
            }).join('');
        }
        let mflState = JSON.parse(JSON.stringify(MFL_PRESETS['empty']));
        let mflTextMode = false;
        let mflAdvancedText = '';

        const ABSORPTION_OPTS = ['FO','ZO','SEQ-ZO-FO','INST','WEIBULL'];
        const ELIMINATION_OPTS = ['FO','ZO','MM','MIX-FO-MM'];
        const METABOLITE_OPTS = ['BASIC','PSC'];
        function wrapVals(vs) {
            return vs.length === 1 ? String(vs[0]) : '[' + vs.join(',') + ']';
        }
        function wrapOrStar(vals, all) {
            return vals.length === all.length ? '*' : wrapVals(vals);
        }
        /*
         * User-typed COVARIATE parameter/covariate slot can be:
         *   - a single token (group symbol or column name):  "@IIV"  "WT"
         *   - a comma-separated list to wrap in brackets:    "WT, AGE" -> "[WT,AGE]"
         *   - already-bracketed:                              "[WT,AGE]" -> passes through
         * MFL grammar wants the bracketed form for a list, otherwise the bare token.
         */
        function wrapMflItems(text) {
            const raw = String(text || '').trim();
            if (!raw) { return ''; }
            if (raw.startsWith('[') && raw.endsWith(']')) { return raw; }
            if (raw.indexOf(',') === -1) { return raw; }
            const items = raw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            if (items.length === 0) { return ''; }
            if (items.length === 1) { return items[0]; }
            return '[' + items.join(',') + ']';
        }
        function compileMfl(s) {
            const parts = [];
            // pharmpy MFL supports the * wildcard on PERIPHERALS / TRANSITS /
            // LAGTIME / COVARIATE, but NOT on ABSORPTION / ELIMINATION -- the
            // parser accepts them but downstream code iterates the raw
            // Wildcard object and throws "Wildcard object is not iterable"
            // (pharmpy 2.1.x). Emit the explicit list for those two.
            if (s.absorption.include && s.absorption.values.length) {
                parts.push('ABSORPTION(' + wrapVals(s.absorption.values) + ')');
            }
            if (s.elimination.include && s.elimination.values.length) {
                parts.push('ELIMINATION(' + wrapVals(s.elimination.values) + ')');
            }
            if (s.lagtime.include) {
                parts.push(s.lagtime.mode === 'BOTH' ? 'LAGTIME([OFF,ON])' : 'LAGTIME(' + s.lagtime.mode + ')');
            }
            if (s.transits.include && s.transits.counts.length && s.transits.depots.length) {
                const counts = [...s.transits.counts].sort((a,b) => a - b);
                const depot = s.transits.depots.length === 2 ? '*' : s.transits.depots[0];
                parts.push('TRANSITS(' + wrapVals(counts.map(String)) + ',' + depot + ')');
            }
            if (s.peripherals.include) {
                const range = s.peripherals.min === s.peripherals.max
                    ? String(s.peripherals.min)
                    : s.peripherals.min + '..' + s.peripherals.max;
                const scope = s.peripherals.scope ? ',' + s.peripherals.scope : '';
                parts.push('PERIPHERALS(' + range + scope + ')');
            }
            if (s.covariates.include) {
                for (const r of s.covariates.rows) {
                    const paramStr = wrapMflItems(r.parameter);
                    const covStr = wrapMflItems(r.covariate);
                    if (!paramStr || !covStr || !r.effects.length) { continue; }
                    const q = r.optional ? '?' : '';
                    const op = r.op && r.op !== '*' ? ',' + r.op : '';
                    const effStr = r.effects.length === EFFECT_OPTIONS.length ? '*' : wrapVals(r.effects);
                    parts.push('COVARIATE' + q + '(' + paramStr + ',' + covStr + ',' + effStr + op + ')');
                }
            }
            if (s.metabolite.include && s.metabolite.values.length) {
                parts.push('METABOLITE(' + wrapOrStar(s.metabolite.values, METABOLITE_OPTS) + ')');
            }
            return parts.join(';\\n');
        }
        function currentMflText() {
            return mflTextMode ? mflAdvancedText : compileMfl(mflState);
        }
        function updatePreview() {
            const text = currentMflText();
            document.getElementById('mfl-preview').textContent = text || '(no search space — pharmpy default will be used)';
        }
        function markCustom() {
            const sel = document.getElementById('mflPreset');
            const opt = sel.querySelector('option[value="custom"]');
            if (opt) { opt.disabled = false; }
            sel.value = 'custom';
        }
        function loadPreset(name) {
            if (!MFL_PRESETS[name]) { return; }
            mflState = JSON.parse(JSON.stringify(MFL_PRESETS[name]));
            const sel = document.getElementById('mflPreset');
            const opt = sel.querySelector('option[value="custom"]');
            if (opt) { opt.disabled = true; }
            sel.value = name;
            renderAllCards();
        }
        function refreshMflModality() {
            const isMet = modeltypeEl.value === 'drug_metabolite';
            const card = document.querySelector('[data-metabolite-card]');
            if (card) { card.style.display = isMet ? '' : 'none'; }
            const scopeWrap = document.querySelector('[data-peripherals-scope-wrap]');
            if (scopeWrap) { scopeWrap.style.display = isMet ? '' : 'none'; }
            if (!isMet) {
                mflState.metabolite.include = false;
                mflState.peripherals.scope = '';
            }
            updatePreview();
            renderIncludeAndScope();
        }
        function renderIncludeAndScope() {
            for (const key of ['absorption','elimination','lagtime','transits','peripherals','covariates','metabolite']) {
                const cb = document.querySelector('input[data-include="' + key + '"]');
                if (!cb) { continue; }
                cb.checked = mflState[key].include;
                const card = cb.closest('.mfl-card');
                if (card) { card.classList.toggle('disabled', !mflState[key].include); }
            }
            setSingleActive('lagtime', mflState.lagtime.mode);
            setSingleActive('peripheralsScope', mflState.peripherals.scope);
        }
        function setSingleActive(attr, val) {
            const group = document.querySelector('.chip-group[data-single="' + attr + '"]');
            if (!group) { return; }
            for (const chip of group.querySelectorAll('.chip')) {
                chip.classList.toggle('active', chip.dataset.val === val);
            }
        }
        function setMultiActive(attr, vals) {
            const group = document.querySelector('.chip-group[data-multi="' + attr + '"]');
            if (!group) { return; }
            for (const chip of group.querySelectorAll('.chip')) {
                chip.classList.toggle('active', vals.includes(chip.dataset.val));
            }
        }
        function renderTransitCounts() {
            const row = document.getElementById('transits-row');
            const adder = document.getElementById('transits-adder');
            for (const b of Array.from(row.querySelectorAll('.chip.removable'))) { b.remove(); }
            for (const n of [...mflState.transits.counts].sort((a,b) => a - b)) {
                const b = document.createElement('button');
                b.className = 'chip active removable';
                b.type = 'button';
                b.innerHTML = n + ' <span class="rm" data-rm-transit="' + n + '">×</span>';
                row.insertBefore(b, adder);
            }
        }
        function renderCovRows() {
            const host = document.getElementById('cov-rows');
            host.innerHTML = '';
            mflState.covariates.rows.forEach((r, i) => {
                const row = document.createElement('div');
                row.className = 'mfl-cov-row';
                const esc = (v) => String(v).replace(/"/g, '&quot;');
                row.innerHTML =
                    '<div class="mfl-cov-target">' +
                        '<label class="mfl-cov-optional"><input type="checkbox" data-cov-optional="' + i + '"' + (r.optional ? ' checked' : '') + '> ?</label>' +
                        '<div class="mfl-combo">' +
                            '<input type="text" data-cov-param="' + i + '" value="' + esc(r.parameter) + '" placeholder="@IIV or CL,VC">' +
                            '<button type="button" class="mfl-combo-btn" data-combo-toggle tabindex="-1">▾</button>' +
                            '<div class="mfl-combo-menu" hidden>' + renderComboItems(PARAM_OPTIONS) + '</div>' +
                        '</div>' +
                        '<div class="mfl-combo">' +
                            '<input type="text" data-cov-cov="' + i + '" value="' + esc(r.covariate) + '" placeholder="@CONTINUOUS or WT,AGE">' +
                            '<button type="button" class="mfl-combo-btn" data-combo-toggle tabindex="-1">▾</button>' +
                            '<div class="mfl-combo-menu" hidden>' + renderComboItems(COV_OPTIONS) + '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="mfl-cov-actions">' +
                        '<div class="mfl-cov-effects" data-cov-effects="' + i + '">' +
                            EFFECT_OPTIONS.map(function(e) {
                                return '<button type="button" class="chip' + (r.effects.includes(e) ? ' active' : '') + '" data-cov-effect="' + i + ':' + e + '" title="' + (EFFECT_TIPS[e] || '') + '">' + e + '</button>';
                            }).join('') +
                        '</div>' +
                        '<span class="mfl-sublabel">operation:</span>' +
                        '<div class="mfl-cov-op" data-cov-op-group="' + i + '">' +
                            '<button type="button" class="chip' + (r.op !== '+' ? ' active' : '') + '" data-cov-op-val="' + i + ':*">×</button>' +
                            '<button type="button" class="chip' + (r.op === '+' ? ' active' : '') + '" data-cov-op-val="' + i + ':+">+</button>' +
                        '</div>' +
                        '<button type="button" class="mfl-btn-mini" data-cov-rm="' + i + '">Remove</button>' +
                    '</div>';
                host.appendChild(row);
            });
        }
        function renderAllCards() {
            renderIncludeAndScope();
            setMultiActive('absorption', mflState.absorption.values);
            setMultiActive('elimination', mflState.elimination.values);
            setMultiActive('metabolite', mflState.metabolite.values);
            setMultiActive('transitsDepots', mflState.transits.depots);
            renderTransitCounts();
            document.getElementById('peripherals-min').value = mflState.peripherals.min;
            document.getElementById('peripherals-max').value = mflState.peripherals.max;
            renderCovRows();
            updatePreview();
        }

        // Preset selector
        document.getElementById('mflPreset').addEventListener('change', (e) => {
            if (e.target.value !== 'custom' && MFL_PRESETS[e.target.value]) {
                loadPreset(e.target.value);
                refreshMflModality();
            }
        });

        // Text/cards toggle
        document.getElementById('mfl-toggle-text').addEventListener('click', () => {
            mflTextMode = !mflTextMode;
            if (mflTextMode) {
                mflAdvancedText = compileMfl(mflState);
                document.getElementById('searchSpace').value = mflAdvancedText;
            }
            document.getElementById('mfl-cards').style.display = mflTextMode ? 'none' : 'flex';
            document.getElementById('mfl-text-mode').classList.toggle('active', mflTextMode);
            document.getElementById('mfl-toggle-text').textContent = mflTextMode ? 'Edit as cards' : 'Edit as text';
            updatePreview();
        });
        document.getElementById('searchSpace').addEventListener('input', (e) => {
            mflAdvancedText = e.target.value;
            updatePreview();
        });

        // Include checkboxes
        document.querySelectorAll('input[data-include]').forEach((cb) => {
            cb.addEventListener('change', () => {
                mflState[cb.dataset.include].include = cb.checked;
                const card = cb.closest('.mfl-card');
                if (card) { card.classList.toggle('disabled', !cb.checked); }
                markCustom();
                updatePreview();
            });
        });

        // Multi-select chip groups
        document.querySelectorAll('.chip-group[data-multi]').forEach((group) => {
            group.addEventListener('click', (e) => {
                const chip = e.target.closest('.chip');
                if (!chip) { return; }
                const key = group.dataset.multi;
                const val = chip.dataset.val;
                const arr = key === 'transitsDepots' ? mflState.transits.depots : mflState[key].values;
                const idx = arr.indexOf(val);
                if (idx >= 0) { arr.splice(idx, 1); chip.classList.remove('active'); }
                else { arr.push(val); chip.classList.add('active'); }
                markCustom();
                updatePreview();
            });
        });

        // Single-select chip groups
        document.querySelectorAll('.chip-group[data-single]').forEach((group) => {
            group.addEventListener('click', (e) => {
                const chip = e.target.closest('.chip');
                if (!chip) { return; }
                const attr = group.dataset.single;
                const val = chip.dataset.val;
                if (attr === 'lagtime') { mflState.lagtime.mode = val; }
                else if (attr === 'peripheralsScope') { mflState.peripherals.scope = val; }
                setSingleActive(attr, val);
                markCustom();
                updatePreview();
            });
        });

        // Transits count add/remove
        document.getElementById('transits-add').addEventListener('click', () => {
            const raw = document.getElementById('transits-new').value;
            const n = Number(raw);
            if (raw === '' || !Number.isFinite(n) || n < 0 || Math.floor(n) !== n) { return; }
            if (!mflState.transits.counts.includes(n)) {
                mflState.transits.counts.push(n);
                renderTransitCounts();
                markCustom();
                updatePreview();
            }
            document.getElementById('transits-new').value = '';
        });
        document.getElementById('transits-new').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); document.getElementById('transits-add').click(); }
        });
        document.getElementById('transits-row').addEventListener('click', (e) => {
            const rm = e.target.closest('[data-rm-transit]');
            if (!rm) { return; }
            const n = Number(rm.dataset.rmTransit);
            mflState.transits.counts = mflState.transits.counts.filter((x) => x !== n);
            renderTransitCounts();
            markCustom();
            updatePreview();
        });

        // Peripherals min/max
        document.getElementById('peripherals-min').addEventListener('input', (e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 0) { return; }
            mflState.peripherals.min = n;
            if (mflState.peripherals.max < n) {
                mflState.peripherals.max = n;
                document.getElementById('peripherals-max').value = n;
            }
            markCustom();
            updatePreview();
        });
        document.getElementById('peripherals-max').addEventListener('input', (e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 0) { return; }
            mflState.peripherals.max = Math.max(n, mflState.peripherals.min);
            markCustom();
            updatePreview();
        });

        // Covariate rows
        document.getElementById('cov-add').addEventListener('click', () => {
            mflState.covariates.rows.push({ optional: true, parameter: '', covariate: '', effects: ['EXP'], op: '*' });
            mflState.covariates.include = true;
            renderIncludeAndScope();
            renderCovRows();
            markCustom();
            updatePreview();
        });
        document.getElementById('cov-rows').addEventListener('click', (e) => {
            const toggle = e.target.closest('[data-combo-toggle]');
            if (toggle) {
                const menu = toggle.parentElement.querySelector('.mfl-combo-menu');
                document.querySelectorAll('.mfl-combo-menu').forEach((m) => { if (m !== menu) { m.hidden = true; } });
                menu.hidden = !menu.hidden;
                return;
            }
            const item = e.target.closest('.mfl-combo-item');
            if (item) {
                const combo = item.closest('.mfl-combo');
                const input = combo.querySelector('input[type="text"]');
                input.value = item.dataset.val;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                combo.querySelector('.mfl-combo-menu').hidden = true;
                return;
            }
            const effBtn = e.target.closest('[data-cov-effect]');
            if (effBtn) {
                const parts = effBtn.dataset.covEffect.split(':');
                const row = mflState.covariates.rows[Number(parts[0])];
                const eff = parts[1];
                const idx = row.effects.indexOf(eff);
                if (idx >= 0) { row.effects.splice(idx, 1); effBtn.classList.remove('active'); }
                else { row.effects.push(eff); effBtn.classList.add('active'); }
                markCustom();
                updatePreview();
                return;
            }
            const opBtn = e.target.closest('[data-cov-op-val]');
            if (opBtn) {
                const parts = opBtn.dataset.covOpVal.split(':');
                const idx = Number(parts[0]);
                const op = parts[1];
                mflState.covariates.rows[idx].op = op;
                const group = opBtn.closest('.mfl-cov-op');
                if (group) {
                    for (const c of group.querySelectorAll('.chip')) { c.classList.remove('active'); }
                }
                opBtn.classList.add('active');
                markCustom();
                updatePreview();
                return;
            }
            const rm = e.target.closest('[data-cov-rm]');
            if (rm) {
                mflState.covariates.rows.splice(Number(rm.dataset.covRm), 1);
                renderCovRows();
                markCustom();
                updatePreview();
                return;
            }
        });
        document.getElementById('cov-rows').addEventListener('change', (e) => {
            const opt = e.target.closest('[data-cov-optional]');
            if (opt) { mflState.covariates.rows[Number(opt.dataset.covOptional)].optional = opt.checked; markCustom(); updatePreview(); return; }
        });
        document.getElementById('cov-rows').addEventListener('input', (e) => {
            const par = e.target.closest('[data-cov-param]');
            if (par) { mflState.covariates.rows[Number(par.dataset.covParam)].parameter = par.value; markCustom(); updatePreview(); return; }
            const cov = e.target.closest('[data-cov-cov]');
            if (cov) { mflState.covariates.rows[Number(cov.dataset.covCov)].covariate = cov.value; markCustom(); updatePreview(); return; }
        });

        document.querySelectorAll('[data-help-toggle]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.helpToggle;
                const panel = document.querySelector('[data-help-panel="' + target + '"]');
                if (panel) { panel.hidden = !panel.hidden; }
            });
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.mfl-combo')) {
                document.querySelectorAll('.mfl-combo-menu').forEach((m) => { m.hidden = true; });
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.mfl-combo-menu').forEach((m) => { m.hidden = true; });
            }
        });

        refreshModality();
        refreshAdministration();
        renderAllCards();
        refreshMflModality();

        function collect() {
            const num = (id) => {
                const raw = document.getElementById(id).value;
                if (raw === '' || raw === null || raw === undefined) { return undefined; }
                const n = Number(raw);
                return Number.isFinite(n) ? n : undefined;
            };
            const str = (id) => document.getElementById(id).value;
            return {
                modeltype: str('modeltype'),
                input: str('input'),
                administration: str('administration'),
                strategy: str('strategy'),
                retriesStrategy: str('retriesStrategy'),
                parameterUncertaintyMethod: str('parameterUncertaintyMethod'),
                searchSpace: currentMflText(),
                estTool: str('estTool'),
                seed: num('seed'),
                clInit: num('clInit'),
                vcInit: num('vcInit'),
                matInit: num('matInit'),
                bInit: num('bInit'),
                emaxInit: num('emaxInit'),
                ec50Init: num('ec50Init'),
                metInit: num('metInit'),
                dvTypes: str('dvTypes'),
                occasion: str('occasion'),
                lloqMethod: str('lloqMethod'),
                lloqLimit: num('lloqLimit'),
                allometricVariable: str('allometricVariable'),
                mechanisticCovariates: str('mechanisticCovariates')
            };
        }

        document.getElementById('browse-input').addEventListener('click', () => {
            vscode.postMessage({ command: 'browseInput' });
        });
        document.getElementById('setup-env').addEventListener('click', () => {
            vscode.postMessage({ command: 'runPharmpyInstall' });
        });
        document.getElementById('generate').addEventListener('click', () => {
            vscode.postMessage({ command: 'generate', config: collect() });
        });
        document.getElementById('generate-and-run').addEventListener('click', () => {
            vscode.postMessage({ command: 'generateAndRun', config: collect() });
        });

        window.addEventListener('message', (event) => {
            const msg = event.data;
            if (msg.command === 'inputPicked') {
                document.getElementById('input').value = msg.path;
            }
        });
    </script>
</body>
</html>`;
    }
}
