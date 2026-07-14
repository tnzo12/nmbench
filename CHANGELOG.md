# Change Log

All notable changes to the "nmbench" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.4.2] - 2026-07-14

### Added
- **AMD Common** — new inputs for `allometric_variable` and `mechanistic_covariates` passed to `run_amd()`.
- **AMD Search space** — COVARIATE parameter/covariate slots accept free-text now; a comma-separated list (e.g. `WT, AGE`) is auto-wrapped as `[WT,AGE]` in emitted MFL.
- **Pre-flight check** — Generate Code / Generate & Run warn (with option to proceed) when `mechanistic_covariates` overlaps with the `COVARIATE?(...)` clauses in `search_space`, a combination that trips a pharmpy 2.1 crash.

### Changed
- **AMD Report** — a subcontext with no `results.json` now reads *no data* in the progression tree/table instead of *skipped*, so a mid-run crash isn't mistaken for a completed step.

## [0.4.1] - 2026-07-13

### Added
- **AMD Common** — new inputs for `occasion` (IOV column), `lloq_limit`, and `lloq_method` (m1 / m3 / m4 / m5 / m6 / m7) passed straight to `run_amd()`.

### Fixed
- **AMD Search space (MFL)** — `ABSORPTION` and `ELIMINATION` no longer collapse to `*` when every option is selected. pharmpy 2.1.x accepts the wildcard for `TRANSITS` / `PERIPHERALS` / `LAGTIME` / `COVARIATE` but throws `'Wildcard' object is not iterable` for these two, so we emit the explicit list instead.
- **AMD Common** — dropdown and text inputs in the new row now align at the same height (Chromium's intrinsic `<select>` height was one pixel off from `<input>`).

## [0.4.0] - 2026-07-13

### Added
- **Unified activity-bar view** `nmbench: Pharmpy/R` — Model Builder and AMD Script Generator now live as tabs inside one webview instead of two side-by-side views, so only one panel is expanded at a time. Sub-panels are DOM-isolated via IIFE-scoped `document` / `window` / `acquireVsCodeApi` proxies.
- **Shared dataset / model file input** at the top of the Pharmpy/R view — routes to AMD's `#input` and to Model Builder's `#dataset` or `#modelFile` (auto-switching the base tab by file extension).
- **Generate & Run** button (both tabs) — writes the R script to disk next to the source (`amd_<name>.R` / `mb_<name>.R`, `_2.R` on collision) and immediately runs it in a new terminal via `Rscript`.
- **Setting** `nmbench.rscript.executablePath` — user-configurable `Rscript` path; used first, then `PATH`, then Windows `C:\Program Files\R\R-*\bin\[x64\]\Rscript.exe`. Windows version fallback now sorts numerically (R-10 > R-4) instead of lexicographically.
- **Context menu** *Monitor estimation* on `modelfit_dir*` folders in the BROWSER tree — opens the Estimation Monitor scoped to that folder with the most-recent run auto-selected. Workspace-wide scan (existing toolbar entry replaced by *Show R Scripts*) still available via the command palette.
- **AMD Advanced section** collapsed by default (`strategy` / `retries_strategy` / `parameter_uncertainty_method` / `seed`). `seed` default is now `123456` instead of pharmpy's overwhelming random default.
- **Section header tooltips** (Pharmpy/R view) — hover shows which pharmpy function(s) each section maps to.

### Changed
- **Estimation Monitor** now walks the workspace recursively (skips `node_modules`, `.git`, `.venv`, `.modeldb`, `subcontexts`, `annotations`, and other heavy dirs; depth-capped) so PsN runs in subdirectories are picked up, not just workspace-root ones. Sub-`modelfit_dir` folder-scoped launches skip the walk entirely. The 10-second poll now only emits `addRun` for newly discovered runs instead of re-posting `populate`, so the user's current selection is no longer reset every tick.
- **BROWSER title bar** — Estimation Monitor button removed (now folder-scoped via context menu); **Show R Scripts** (`$(files)` icon) added in its place, opening the extension's `Rscripts` folder for editing.
- **Model Builder** — dropped the redundant *Model name* input; the emitted script no longer calls `set_name`. The base-file inputs are hidden inside the tabbed layout because the shared picker above drives them.
- **Palette** — Pharmpy/R view adopts the muted estview colors (`#6699cc` blue / `#3bb273` green / `#f2c94c` yellow / `#b191d6` purple / `#e24c4b` red) via CSS custom properties. Section header colors signal role: MB (Basic/Structural blue, IIV green, Residual error red, Output purple), AMD (Modality + PK-PD/TMDD/Drug Metabolite red, Common blue, Initial estimates + Advanced yellow, Search space blue).
- **Header stays stuck to the top** while the sub-panel scrolls (previously the tab bar was hidden behind the shared input row).

### Removed
- Dead code cleanup: `extension.showSumoCommand`, `extension.watchLiveExtFromTreeView`, `getWebviewContent_echarts`, legacy `nonmemPath` globalState fallback, orphan `sdtab/patab` filename filter comments.

### Fixed
- **Context menu** *Generate AMD Report* now only appears on folders whose name starts with `amd` (case-insensitive) — no longer clutters every folder's menu.
- **AMD Advanced chevron** rotates on toggle (▸ → ▾).

## [0.3.6] - 2026-07-11

### Added
- **AMD Script Generator — MFL search-space builder**. The single `search_space` textarea is replaced by a card-based GUI. Presets (`Default` / `Basic PK` / `Exhaustive PK` / `Covariates only`) plus editable per-statement cards for `ABSORPTION`, `ELIMINATION`, `LAGTIME`, `TRANSITS`, `PERIPHERALS`, `COVARIATE`, and `METABOLITE`. Chips are hover-tooltipped (short one-liner per option); `?` help buttons on `COVARIATE` and `METABOLITE` expand a longer explanation panel. Multi-select chip groups collapse to `*` when all options are selected (aligned with pharmpy docs); TRANSITS depot uses a two-chip multi-select where selecting both auto-emits `*`. Live compiled-MFL preview is always visible; an *Edit as text* toggle exposes the raw MFL for advanced users.
- **Setup Env. button** in both AMD Script Generator and Model Builder views, plus a `$(tools)` toolbar action, that runs a new bundled `resources/pharmpy_install.R` script in a terminal. The script is idempotent: reports OS, tools, PATH state, and each of 6 install steps with colored `[OK] / [FAIL]` markers, tracks the failure count, and prints a big green *ALL CHECKS PASSED* / red *N STEPS FAILED* summary. Non-interactive and cross-platform (macOS / Windows / Linux). On Windows, `Rscript` is auto-detected under `C:\Program Files\R\R-*\bin\[x64\]\Rscript.exe` when it isn't on PATH; the PowerShell call-operator (`&`) is used when invoking an absolute path so the command actually executes.
- **`Preset: Custom`** — the preset dropdown auto-switches to *Custom* the moment any chip / row / number is changed by hand.

### Changed
- **Generated R scripts (AMD, Model Builder)** now include a `RETICULATE_PYTHON` / `use_condaenv("r-reticulate", required = TRUE)` preamble emitted *before* `library(pharmr)`, so pharmpy resolves from the installer-created conda env regardless of shell state.
- **`search_space` is emitted as a single-line R string** (whitespace collapsed to single spaces) — the pharmpy MFL parser does not tolerate embedded newlines inside the passed string.
- **Generated scripts run `setwd(dirname(<input>))`** immediately after `library(pharmr)`, so `run_amd()` / model-write outputs land next to the dataset instead of the R session's ambient cwd.
- **Untitled scripts are anchored at the dataset directory** (fallback: workspace root, then process cwd) so *Save As* defaults to the right folder rather than resolving to filesystem root (which was read-only on macOS/Linux — the "EROFS" error).
- **File naming** — AMD emits `amd_<dataset-basename>.R`, Model Builder emits `mb_<source-여basename>.R`. Special characters are sanitised; name collisions add `_2`, `_3`, ....
- **Chip / help styling** — inline-flex keeps `[+n input][Add]` and `depot: […]` chips grouped on the same line at any sidebar width; TRANSITS number input is now responsive-width via CSS `field-sizing: content` (22–90 px); disabled-card chips still fire hover tooltips (removed `pointer-events: none`); `?` help panels replace always-visible hint text on `COVARIATE` and `METABOLITE`; `METABOLITE` header text is yellow to signal drug_metabolite-only.
- **COVARIATE row** wraps to two visual rows on narrow widths; the `×` / `+` operation control is now a two-chip toggle instead of a select (arrow no longer clashes with the glyph).

### Fixed
- **Hover tooltips on chips** were suppressed in the default *Empty / Default* preset because `.mfl-card.disabled .mfl-card-body { pointer-events: none }` blocked all pointer events.
- **`.fails` counter in `pharmpy_install.R`** — the post-verify branches (`requireNamespace` / `py_module_available` / `file.exists`) previously printed `[FAIL]` without incrementing `.fails`, so the final summary could read *ALL PASSED* even when pharmr or pharmpy failed to install. Now routed through a `.mark_fail()` helper that bumps the counter.
- **Rscript invocation on Windows PowerShell** — a line starting with `"C:\..."` was parsed as a string expression rather than executed. Bare `Rscript` is used when it resolves on PATH; the call operator `&` is prepended when a fallback absolute path is used.

## [0.3.5] - 2026-07-06

### Changed
- **Plotly is now bundled locally** at `resources/lib/plotly-2.32.0.min.js` (~3.5 MB) and every webview (`getWebviewContent_plotly`, `getWebviewContent_heatmap_plotly`, `getWebviewContent_hist`, `getWebviewContent_liveExt`) resolves it via `panel.webview.asWebviewUri()`. Previously the script tag pointed at `https://cdn.plot.ly/plotly-2.32.0.min.js`; bundling removes the network dependency so plots work offline and are unaffected if the CDN URL ever changes.

## [0.3.3] - 2026-07-06

### Added
- **Setting** `nmbench.browser.fileExtensions` (default `["mod", "ctl"]`) — file extensions displayed in the **NMBENCH: BROWSER** tree view. The tree view refreshes automatically when the value changes.
- **Setting** `nmbench.nonmem.executablePath` (default `/opt/nm75/util/nmfe75`) — path to the NONMEM executable used by *Run NONMEM command*. Editable from the Settings UI. Backward-compatible: values previously stored in `globalState` under `nonmemPath` are used as a fallback if the setting is empty.
- **Activity Bar container** *Model Development* — a new view container in the Activity Bar (icon: `resources/model-development.svg`) that groups model-development side-tools separately from the Explorer views.
- **View** *AMD Script Generator* under *Model Development* — a form-driven GUI that produces an editable R script for Pharmpy's Automatic Model Development workflow (`run_amd()` via pharmr). Full-modality skeleton (PK / PK-PD / TMDD / Drug Metabolite); PK is validated first, the other three are marked as beta so users cross-check the emitted script against `?pharmr::run_amd` before executing. NONMEM is the default estimation tool and is left implicit in the emitted script so as not to hardcode pharmpy's default.
- **View** *Model Builder* under *Model Development* — a form-driven GUI that produces an editable R script inspired by the upstream pharmpy [Model Builder](https://github.com/pharmpy/modelbuilder) Dash app. Supports base model creation from a dataset (`create_basic_pk_model`) or from an existing `.mod`/`.ctl` file (`read_model`), structural features (absorption FO/ZO/SEQ-ZO-FO, transit compartments, lag time, elimination FO/ZO/MM/MIX-FO-MM, peripheral compartments), between-subject variability (`add_iiv`), residual error model (additive / proportional / combined), covariate effects (multi-row table for `add_covariate_effect`), and output conversion (`convert_model` → NONMEM by default). MVP scope covers the most common transformations; IOV, initial-estimate/bounds table, PD indirect/direct effects, and multi-language export beyond NONMEM/nlmixr2 are deferred to follow-up iterations. Emits direct function calls (rather than pharmpy's internal MFL representation) so the script stays readable when hand-edited.
- **Generate Code button** in both *AMD Script Generator* and *Model Builder* — a single unified action that emits the R script into an untitled editor tab. The user reviews/edits and then saves wherever they want using VS Code's standard `Cmd/Ctrl+S` (which brings up a Save As dialog for untitled documents). Consecutive Generate clicks reuse the same tab as long as the user hasn't edited it; if they have, a fresh tab is opened so their edits are preserved.
- **Colored view styling** aligned with the *NMBENCH: BROWSER* palette — section headers use `charts.blue`, the primary Generate button uses `charts.green`, beta badges use `charts.yellow`, and modality reveal / base-tab selection use `charts.purple` — so the two Model Development views share visual language with the run-status colors elsewhere in the extension.
- **Toolbar button** *Open nmbench Settings* (gear icon) on the **NMBENCH: BROWSER** view title bar — jumps directly into the Settings UI filtered to nmbench's contributions.

### Changed
- **Positron compatibility** for the lastest version
- Bumped `@types/vscode` to `^1.93.0` to match.

## [0.3.1] - 2026-05-26

### Added
- **BROWSER context menu**: *Update inits* shortcut — runs `update_inits` directly without going through the full PsN tool picker
- **BROWSER context menu**: *Delete with outputs* — deletes the model file along with associated output files (`.lst`, `.ext`, `.cov`, `.cor`, `.coi`, `.phi`, `.shk`, `.grd`, `.xml`) and PsN run directories identified via `command.txt`
- **PsN tools / Run NONMEM**: launch mode selector at command-confirm step — choose between *Terminal* (default) or *Run in tmux* (requires separate tmux installation) with icons

### Changed
- **Coffee icon** now reverts automatically when a job finishes, using VS Code shell integration events (`onDidStartTerminalShellExecution` / `onDidEndTerminalShellExecution`); falls back to previous behavior when shell integration is unavailable
- **Terminal refresh** only triggers on terminals whose name matches a model file, preventing unnecessary tree rebuilds during normal terminal use

### Fixed
- Idle model file icon restored to standard file icon in the BROWSER tree view

## [0.3.0] - 2026-05-26

### Added
- **Data Inspector**: mode selector (lines+markers / markers / lines)
- **Data Inspector**: Log X / Log Y axis toggle
- **Data Inspector**: Row Filter panel — column selector with value multiselect, EVID=0 and MDV=0 quick-filter buttons
- **Data Inspector**: GOF presets — DV/PRED, DV/IPRED, CWRES/TIME, CWRES/PRED with automatic y=x diagonal line

### Changed
- **BROWSER tree view**: run status color-coding — Minimization Terminated → red file icon; S + rounding/boundary/matrix error combinations → yellow file icon and badge
- **Live Estimation Monitor**: multi-column subplot layout that adapts to panel width; reduced margins; icon changed to monitor
- **Heatmap viewer**: axis tick color now respects VS Code theme (light/dark) instead of hardcoded grey; pre-computed z-value matrices for faster filter/selection updates

### Fixed
- Heatmap viewer data parsing regression (slice offset)

## [Unreleased]

- Initial release